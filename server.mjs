import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

const PORT = Number(process.env.PORT || 8787);
const CODEX_MODEL = process.env.KYOWA_CODEX_MODEL || "gpt-5.6-luna";
const CODEX_EFFORT = process.env.KYOWA_CODEX_EFFORT || "none";
const MAX_DRAFT_CHARS = clampInt(process.env.KYOWA_MAX_DRAFT_CHARS, 400, 6000, 1800);
const MAX_OUTPUT_CHARS = clampInt(process.env.KYOWA_MAX_OUTPUT_CHARS, 120, 1200, 520);
const MAX_READS_PER_DAY = clampInt(process.env.KYOWA_MAX_READS_PER_DAY, 5, 1000, 60);
const MAX_TOKENS_PER_DAY = clampInt(process.env.KYOWA_MAX_TOKENS_PER_DAY, 50_000, 5_000_000, 650_000);
const MIN_CHANGED_CHARS = clampInt(process.env.KYOWA_MIN_CHANGED_CHARS, 0, 200, 18);
const MIN_SECONDS_BETWEEN_REQUESTS = clampFloat(
  process.env.KYOWA_MIN_SECONDS_BETWEEN_REQUESTS,
  1,
  20,
  4,
);

const state = {
  day: dayKey(),
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  lastRequestAtByIp: new Map(),
  lastDraftByIp: new Map(),
  lastUsageByTurnId: new Map(),
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

let codex;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/status") {
      return sendJson(res, await statusPayload());
    }

    if (req.method === "POST" && req.url === "/api/read") {
      return handleRead(req, res);
    }

    if (req.method !== "GET") {
      return sendJson(res, { error: "Method not allowed" }, 405);
    }

    return serveStatic(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, { error: "Unexpected server error", message: friendlyError(error) }, 500);
    } else {
      res.end();
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Kyowa Sketch running at http://localhost:${PORT}`);
  console.log("Using Codex app-server. Sign in with Codex/ChatGPT before starting if needed.");
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function handleRead(req, res) {
  resetDailyCountersIfNeeded();

  const ip = req.socket.remoteAddress || "local";
  const now = Date.now();
  const lastRequestAt = state.lastRequestAtByIp.get(ip) || 0;
  const elapsedSeconds = (now - lastRequestAt) / 1000;

  if (elapsedSeconds < MIN_SECONDS_BETWEEN_REQUESTS) {
    return sendJson(
      res,
      {
        error: "rate_limited",
        retryAfterMs: Math.ceil((MIN_SECONDS_BETWEEN_REQUESTS - elapsedSeconds) * 1000),
      },
      429,
    );
  }

  const body = await readJsonBody(req);
  const draft = cleanDraft(String(body.draft || ""));
  const density = ["thin", "specific", "question"].includes(body.density) ? body.density : "thin";
  const language = body.language === "ja" ? "ja" : "en";

  if (draft.trim().length < 12) {
    return sendJson(res, { error: "draft_too_short" }, 400);
  }

  const budgetBlock = currentBudgetBlock(language);
  if (budgetBlock) {
    return sendJson(res, budgetBlock, 429);
  }

  const previousDraft = state.lastDraftByIp.get(ip);
  if (
    previousDraft?.density === density &&
    previousDraft?.language === language &&
    !draftChangedEnough(draft, previousDraft.draft)
  ) {
    return sendJson(
      res,
      {
        error: "draft_not_changed_enough",
        minChangedChars: MIN_CHANGED_CHARS,
      },
      409,
    );
  }

  const account = await codex.account();
  if (!account?.account) {
    return sendJson(
      res,
      {
        error: "codex_auth_required",
        message:
          language === "ja"
            ? "CodexにChatGPTでサインインしてから、もう一度起動してください。"
            : "Sign in to Codex with ChatGPT, then start the app again.",
      },
      401,
    );
  }

  state.lastRequestAtByIp.set(ip, now);
  state.lastDraftByIp.set(ip, { draft, density, language });
  state.requests += 1;

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  let threadId = null;
  let turnId = null;
  let outputChars = 0;
  let finished = false;
  let completionResolve;

  const completed = new Promise((resolve) => {
    completionResolve = resolve;
  });

  const finish = (payload = {}) => {
    if (finished) return;
    finished = true;
    if (payload.type) writeLine(res, payload);
    writeLine(res, { type: "done" });
    completionResolve();
  };

  const onNotification = (msg) => {
    const params = msg.params || {};
    if (params.threadId !== threadId) return;
    if (turnId && params.turnId && params.turnId !== turnId) return;
    if (!turnId && params.turnId) turnId = params.turnId;

    if (msg.method === "item/agentMessage/delta" && params.delta) {
      outputChars += params.delta.length;
      writeLine(res, { type: "delta", delta: params.delta });
      if (outputChars > MAX_OUTPUT_CHARS && threadId && turnId) {
        codex.request("turn/interrupt", { threadId, turnId }, { timeoutMs: 4000 }).catch(() => {});
      }
    }

    if (msg.method === "rawResponse/completed") {
      rememberUsage(turnId, params.usage);
    }

    if (msg.method === "thread/tokenUsage/updated") {
      rememberUsage(turnId, params.tokenUsage?.last);
    }

    if (msg.method === "turn/completed") {
      const usage = state.lastUsageByTurnId.get(turnId);
      updateTotals(usage);
      writeLine(res, {
        type: "usage",
        usage: usage || null,
        totals: publicTotals(),
        limits: publicLimits(),
      });
      finish();
    }

    if (msg.method === "error") {
      finish({
        type: "error",
        error: "codex_turn_failed",
        message: params.error?.message || "Codex turn failed.",
      });
    }
  };

  const cleanup = async () => {
    codex.off("notification", onNotification);
    if (!finished && threadId && turnId) {
      await codex.request("turn/interrupt", { threadId, turnId }, { timeoutMs: 4000 }).catch(() => {});
    }
    if (threadId) {
      await codex.request("thread/unsubscribe", { threadId }, { timeoutMs: 4000 }).catch(() => {});
    }
  };

  const closeHandler = () => {
    if (!finished) cleanup().catch(() => {});
  };

  res.on("close", closeHandler);
  codex.on("notification", onNotification);

  try {
    const thread = await codex.request(
      "thread/start",
      {
        model: CODEX_MODEL,
        cwd: __dirname,
        approvalPolicy: "never",
        sandbox: "read-only",
        config: {
          model_reasoning_effort: CODEX_EFFORT,
          model_verbosity: "low",
        },
        baseInstructions: buildDeveloperInstructions(density, language),
        ephemeral: true,
        threadSource: "kyowa-sketch",
        developerInstructions:
          language === "ja"
            ? "下書き読み専用。出力は条件に合う短い読みだけ。ツールは使わない。"
            : "Draft reading only. Output only short readings that match the constraints. Do not use tools.",
      },
      { timeoutMs: 20_000 },
    );

    threadId = thread.thread.id;
    writeLine(res, {
      type: "meta",
      mode: "codex",
      model: thread.model || CODEX_MODEL,
      effort: CODEX_EFFORT,
      accountType: account.account.type,
      planType: account.account.planType || null,
      language,
      limits: publicLimits(),
    });

    const turn = await codex.request(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text: buildDraftPrompt(draft, language), text_elements: [] }],
        model: CODEX_MODEL,
        effort: CODEX_EFFORT,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      },
      { timeoutMs: 30_000 },
    );

    turnId = turn.turn.id;
    await completed;
  } catch (error) {
    finish({ type: "error", error: "codex_error", message: friendlyError(error) });
  } finally {
    res.off("close", closeHandler);
    await cleanup();
    res.end();
  }
}

function buildDeveloperInstructions(density, language) {
  if (language === "ja") {
    const densityLine =
      density === "specific"
        ? "少しだけ具体度を上げ、押し返しやすい仮説にする。"
        : density === "question"
          ? "問いの形を優先し、答えや助言を書かない。"
          : "できるだけ薄く、短く、暫定的にする。";

    return [
      "あなたは共話型の下書き相手です。",
      "ユーザーはまだ送信していない文章を書いています。返答ではなく、横に置ける弱い読みだけを返してください。",
      "目的は、ユーザーの文を完成させることではなく、ユーザーが押し返せる小さな読みを出すことです。",
      densityLine,
      "制約:",
      "1. 日本語で書く。",
      "2. 1行に1つ、最大3行。",
      "3. 各行は32文字以内を目安にする。",
      "4. 断定しない。『かも？』『という感じ？』『もしかして？』など暫定形にする。",
      "5. 提案、添削、要約、励まし、結論、次に書くべき文を出さない。",
      "6. 箇条書き記号、見出し、説明文、引用符を付けない。",
      "7. ファイル、ターミナル、ブラウザ、外部ツールを使わない。",
    ].join("\n");
  }

  const densityLine =
    density === "specific"
      ? "Make the reading slightly more concrete, as a small hypothesis the writer can push back on."
      : density === "question"
        ? "Prefer the shape of a question. Do not answer or advise."
        : "Keep it as thin, short, and provisional as possible.";

  return [
    "You are a co-speech drafting partner.",
    "The user is writing text they have not sent yet. Do not reply as if it is a completed message.",
    "Offer only weak readings that can sit beside the draft.",
    "The goal is not to complete the user's sentence. The goal is to offer a small utterance they can ignore or push against.",
    densityLine,
    "Constraints:",
    "1. Write in English.",
    "2. One reading per line, maximum 3 lines.",
    "3. Keep each line around 12 words or fewer.",
    "4. Do not sound certain. Use provisional phrasing such as 'maybe?', 'something like?', or 'as if?'.",
    "5. Do not suggest, edit, summarize, encourage, conclude, or write the next sentence for the user.",
    "6. Do not use bullet marks, headings, explanations, or quotation marks.",
    "7. Do not use files, terminal, browser, or external tools.",
  ].join("\n");
}

function buildDraftPrompt(draft, language) {
  if (language === "ja") {
    return [
      "未完成の下書き:",
      draft,
      "",
      "上の下書きだけを読み、条件に合う行だけを出力してください。",
    ].join("\n");
  }

  return [
    "Unfinished draft:",
    draft,
    "",
    "Read only the draft above. Output only lines that match the constraints.",
  ].join("\n");
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return sendJson(res, { error: "Not found" }, 404);
  }

  const ext = path.extname(filePath);
  const type = mimeTypes.get(ext) || "application/octet-stream";
  const data = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(data);
}

async function statusPayload() {
  resetDailyCountersIfNeeded();
  const available = codex.isBinaryAvailable();
  let account = null;
  let authError = null;

  if (available) {
    try {
      account = await codex.account();
    } catch (error) {
      authError = friendlyError(error);
    }
  }

  return {
    mode: "codex",
    codexAvailable: available,
    codexReady: codex.ready,
    codexAuth: publicCodexAccount(account?.account),
    codexRequiresOpenaiAuth: Boolean(account?.requiresOpenaiAuth),
    codexError: authError,
    model: CODEX_MODEL,
    reasoningEffort: CODEX_EFFORT,
    maxDraftChars: MAX_DRAFT_CHARS,
    maxOutputChars: MAX_OUTPUT_CHARS,
    minSecondsBetweenRequests: MIN_SECONDS_BETWEEN_REQUESTS,
    totals: publicTotals(),
    limits: publicLimits(),
  };
}

function publicTotals() {
  return {
    day: state.day,
    requests: state.requests,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    totalTokens: state.totalTokens,
  };
}

function publicLimits() {
  return {
    maxReadsPerDay: MAX_READS_PER_DAY,
    maxTokensPerDay: MAX_TOKENS_PER_DAY,
    minChangedChars: MIN_CHANGED_CHARS,
    minSecondsBetweenRequests: MIN_SECONDS_BETWEEN_REQUESTS,
  };
}

function publicCodexAccount(account) {
  if (!account) return null;
  return {
    type: account.type,
    planType: account.planType || null,
  };
}

function rememberUsage(turnId, usage) {
  if (!turnId || !usage) return;
  state.lastUsageByTurnId.set(turnId, normalizeCodexUsage(usage));
}

function normalizeCodexUsage(usage = {}) {
  return {
    input_tokens: Number(usage.inputTokens || 0),
    output_tokens: Number(usage.outputTokens || 0),
    total_tokens: Number(usage.totalTokens || 0),
    cached_input_tokens: Number(usage.cachedInputTokens || 0),
    reasoning_output_tokens: Number(usage.reasoningOutputTokens || 0),
  };
}

function updateTotals(usage) {
  if (!usage) return;
  state.inputTokens += usage.input_tokens;
  state.outputTokens += usage.output_tokens;
  state.totalTokens += usage.total_tokens;
}

function currentBudgetBlock(language) {
  if (state.requests >= MAX_READS_PER_DAY) {
    return {
      error: "budget_exhausted",
      message:
        language === "ja"
          ? "今日の読み回数上限に達しました。"
          : "Today's read limit has been reached.",
      totals: publicTotals(),
      limits: publicLimits(),
    };
  }

  if (state.totalTokens >= MAX_TOKENS_PER_DAY) {
    return {
      error: "budget_exhausted",
      message:
        language === "ja"
          ? "今日のトークン上限に達しました。"
          : "Today's token limit has been reached.",
      totals: publicTotals(),
      limits: publicLimits(),
    };
  }

  return null;
}

function draftChangedEnough(next, previous) {
  if (!previous) return true;
  if (next === previous) return false;
  if (Math.abs(next.length - previous.length) >= MIN_CHANGED_CHARS) return true;
  if (!next.startsWith(previous) && !previous.startsWith(next)) return true;
  return false;
}

function cleanDraft(input) {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
    .slice(-MAX_DRAFT_CHARS);
}

function resolveCodexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const appBundled = "/Applications/ChatGPT.app/Contents/Resources/codex";
  if (existsSync(appBundled)) return appBundled;
  return "codex";
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function writeLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 32_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function resetDailyCountersIfNeeded() {
  const current = dayKey();
  if (state.day === current) return;
  state.day = current;
  state.requests = 0;
  state.inputTokens = 0;
  state.outputTokens = 0;
  state.totalTokens = 0;
  state.lastRequestAtByIp.clear();
  state.lastDraftByIp.clear();
  state.lastUsageByTurnId.clear();
}

function dayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampInt(raw, min, max, fallback) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampFloat(raw, min, max, fallback) {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function friendlyError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return String(error);
}

async function shutdown(code) {
  await codex.stop();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1000).unref();
}

class CodexBridge extends EventEmitter {
  constructor(binary) {
    super();
    this.binary = binary;
    this.proc = null;
    this.rl = null;
    this.pending = new Map();
    this.nextId = 1;
    this.starting = null;
    this.ready = false;
    this.accountCache = null;
    this.accountCacheAt = 0;
  }

  isBinaryAvailable() {
    return this.binary.includes("/") ? existsSync(this.binary) : true;
  }

  async account() {
    const freshEnough = Date.now() - this.accountCacheAt < 10_000;
    if (this.accountCache && freshEnough) return this.accountCache;
    await this.start();
    const account = await this.request("account/read", { refreshToken: false }, { timeoutMs: 15_000 });
    this.accountCache = account;
    this.accountCacheAt = Date.now();
    return account;
  }

  async start() {
    if (this.ready) return;
    if (this.starting) return this.starting;

    this.starting = new Promise((resolve, reject) => {
      if (!this.isBinaryAvailable()) {
        reject(new Error(`Codex binary not found: ${this.binary}`));
        return;
      }

      this.proc = spawn(this.binary, ["app-server"], {
        cwd: __dirname,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.once("error", reject);
      this.proc.once("exit", (code, signal) => {
        this.ready = false;
        this.rejectPending(new Error(`Codex app-server exited (${signal || code})`));
      });

      this.proc.stderr.on("data", (chunk) => {
        process.stderr.write(`[codex] ${chunk}`);
      });

      this.rl = readline.createInterface({ input: this.proc.stdout });
      this.rl.on("line", (line) => this.handleLine(line));

      this.request("initialize", {
        clientInfo: {
          name: "kyowa-sketch",
          title: "Kyowa Sketch",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      })
        .then(() => {
          this.notify("initialized");
          this.ready = true;
          resolve();
        })
        .catch(reject);
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  request(method, params, options = {}) {
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs || 60_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ method, id, params });
    });
  }

  notify(method, params) {
    this.send(params === undefined ? { method } : { method, params });
  }

  send(message) {
    if (!this.proc?.stdin?.writable) {
      throw new Error("Codex app-server is not running");
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleLine(line) {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write(`[codex] non-json: ${line}\n`);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message || `${pending.method} failed`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.emit("notification", message);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async stop() {
    if (!this.proc) return;
    this.proc.kill("SIGTERM");
    this.proc = null;
    this.ready = false;
  }
}

codex = new CodexBridge(resolveCodexBinary());
