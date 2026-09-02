(() => {
  const els = {
    draft: document.querySelector("#draft"),
    charCount: document.querySelector("#charCount"),
    currentReading: document.querySelector("#currentReading"),
    history: document.querySelector("#history"),
    activeToggle: document.querySelector("#activeToggle"),
    delayRange: document.querySelector("#delayRange"),
    delayValue: document.querySelector("#delayValue"),
    runtimeText: document.querySelector("#runtimeText"),
    connectionDot: document.querySelector("#connectionDot"),
    requestCount: document.querySelector("#requestCount"),
    tokenCount: document.querySelector("#tokenCount"),
    runtimeMode: document.querySelector("#runtimeMode"),
    limitText: document.querySelector("#limitText"),
    markers: document.querySelector("#markers"),
    clearMarkers: document.querySelector("#clearMarkers"),
    clearHistory: document.querySelector("#clearHistory"),
  };

  const copy = {
    en: {
      eyebrow: "local co-speech",
      draftLabel: "draft",
      draftHint: "Unsent text",
      chars: "chars",
      draftPlaceholder:
        "I keep noticing that AI replies arrive too late, after the thought has already hardened...",
      draftHelp:
        "Start typing. After a short pause, provisional AI readings appear in the side rail.",
      readingLabel: "reading",
      readingHint: "Weak / provisional",
      aiOn: "AI on",
      interval: "Delay",
      densityLegend: "Reading density",
      densityThin: "Thin",
      densityQuestion: "Question",
      densitySpecific: "Specific",
      languageLegend: "Language",
      emptyStart: "Start typing and a weak reading appears here.",
      markersLabel: "kept fragments",
      historyLabel: "recent traces",
      clear: "clear",
      reads: "reads",
      tokens: "tokens",
      dailyCap: "daily cap",
      aiPaused: "AI readings are paused. Your draft stays here.",
      dismissed: "Passed. Keep writing and another reading will arrive.",
      tooShort: "Write a little more and a weak reading will appear.",
      fetchFailed: "The reading stalled. Wait a moment and keep writing.",
      rateLimited: "A little too fast. Keeping this draft for the next interval.",
      authRequired: "Sign in to Codex with ChatGPT, then start the app again.",
      budgetExhausted: "Today's reading limit is reached. You can keep writing with AI off.",
      unchanged: "When the draft moves a little more, the next reading will appear.",
      genericError: "Not ready yet. Check the Codex connection.",
      readingNow: "Reading...",
      noReading: "No reading to place this time.",
      keep: "Keep",
      push: "Push back",
      near: "Close",
      dismiss: "Let pass",
      noMarks: "No marks",
      pushInsert: "Not quite; ",
      nearInsert: "Close, but maybe ",
    },
    ja: {
      eyebrow: "local co-speech",
      draftLabel: "下書き",
      draftHint: "未送信の言葉",
      chars: "文字",
      draftPlaceholder: "最近AIを使っていて、便利すぎることについて、なんというか...",
      draftHelp: "書き始めると、短い間のあとにサイドレールへ暫定的な読みが出ます。",
      readingLabel: "読み",
      readingHint: "弱い / 暫定",
      aiOn: "AI on",
      interval: "間隔",
      densityLegend: "読みの濃さ",
      densityThin: "薄い",
      densityQuestion: "問い",
      densitySpecific: "具体",
      languageLegend: "言語",
      emptyStart: "書き始めると、ここに薄い読みが出ます。",
      markersLabel: "残した断片",
      historyLabel: "最近の痕跡",
      clear: "消す",
      reads: "回",
      tokens: "トークン",
      dailyCap: "日次上限",
      aiPaused: "AIの読みを止めています。文章はここに残ります。",
      dismissed: "流しました。書き続けるとまた別の読みが来ます。",
      tooShort: "もう少し書くと、薄い読みが置かれます。",
      fetchFailed: "読みの取得で止まりました。少し待ってからまた書いてみてください。",
      rateLimited: "少し速すぎます。今の文を保ったまま、次の間で読みます。",
      authRequired: "CodexにChatGPTでサインインしてから、もう一度起動してください。",
      budgetExhausted: "今日の読み上限に達しました。AIを止めて書き続けられます。",
      unchanged: "もう少し文が動いたら、次の読みを置きます。",
      genericError: "まだ読めません。Codexの状態を確認してください。",
      readingNow: "読んでいます...",
      noReading: "今回は置ける読みがありませんでした。",
      keep: "残す",
      push: "押し返す",
      near: "近い",
      dismiss: "流す",
      noMarks: "印なし",
      pushInsert: "いや、そこではなく、",
      nearInsert: "近いけれど、むしろ",
    },
  };

  const storage = {
    draft: "kyowa:draft",
    active: "kyowa:active",
    delay: "kyowa:delay",
    density: "kyowa:density",
    language: "kyowa:language",
    history: "kyowa:history",
    markers: "kyowa:markers",
  };

  const app = {
    status: null,
    timer: null,
    controller: null,
    lastSentText: "",
    lastSentAt: 0,
    history: loadHistory(),
    markers: loadMarkers(),
    language: validLanguage(localStorage.getItem(storage.language)),
    currentText: "",
    currentLines: [],
    inFlight: false,
  };

  init();

  async function init() {
    els.draft.value = localStorage.getItem(storage.draft) || "";
    els.activeToggle.checked = localStorage.getItem(storage.active) !== "false";
    els.delayRange.value = localStorage.getItem(storage.delay) || "4000";
    const density = localStorage.getItem(storage.density) || "thin";
    const densityInput = document.querySelector(`input[name="density"][value="${density}"]`);
    if (densityInput) densityInput.checked = true;
    const languageInput = document.querySelector(`input[name="language"][value="${app.language}"]`);
    if (languageInput) languageInput.checked = true;

    applyLanguage();
    updateDelayLabel();
    updateDraftMeter();
    renderMarkers();
    renderHistory();
    bindEvents();
    await refreshStatus();
    scheduleRead({ immediate: false });
  }

  function bindEvents() {
    els.draft.addEventListener("input", () => {
      localStorage.setItem(storage.draft, els.draft.value);
      updateDraftMeter();
      scheduleRead({ immediate: false });
    });

    els.activeToggle.addEventListener("change", () => {
      localStorage.setItem(storage.active, String(els.activeToggle.checked));
      if (els.activeToggle.checked) {
        scheduleRead({ immediate: true });
      } else {
        cancelInFlight();
        renderEmpty(t("aiPaused"));
      }
    });

    els.delayRange.addEventListener("input", () => {
      localStorage.setItem(storage.delay, els.delayRange.value);
      updateDelayLabel();
      scheduleRead({ immediate: false });
    });

    for (const input of document.querySelectorAll('input[name="density"]')) {
      input.addEventListener("change", () => {
        localStorage.setItem(storage.density, currentDensity());
        scheduleRead({ immediate: true });
      });
    }

    for (const input of document.querySelectorAll('input[name="language"]')) {
      input.addEventListener("change", () => {
        app.language = validLanguage(currentLanguage());
        localStorage.setItem(storage.language, app.language);
        app.lastSentText = "";
        applyLanguage();
        renderEmpty(t("emptyStart"));
        scheduleRead({ immediate: true });
      });
    }

    els.currentReading.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "dismiss") {
        renderEmpty(t("dismissed"));
      }
      if (button.dataset.action === "keep") {
        keepCurrentReading();
      }
      if (button.dataset.action === "push") {
        insertAtCursor(t("pushInsert"));
      }
      if (button.dataset.action === "near") {
        insertAtCursor(t("nearInsert"));
      }
    });

    els.clearMarkers.addEventListener("click", () => {
      app.markers = [];
      saveMarkers();
      renderMarkers();
    });

    els.clearHistory.addEventListener("click", () => {
      app.history = [];
      saveHistory();
      renderHistory();
    });
  }

  async function refreshStatus() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      app.status = await response.json();
      const signedIn = Boolean(app.status.codexAuth);
      els.connectionDot.className = `dot ${signedIn ? "ready" : "demo"}`;
      els.runtimeText.textContent = signedIn
        ? `${app.status.model} · Codex ${app.status.codexAuth.planType || ""}`.trim()
        : "Codex sign-in needed";
      renderTotals(app.status.totals, app.status.limits);
    } catch {
      els.connectionDot.className = "dot";
      els.runtimeText.textContent = "server unavailable";
    }
  }

  function scheduleRead({ immediate }) {
    clearTimeout(app.timer);
    if (!els.activeToggle.checked) return;

    const draft = els.draft.value.trim();
    if (draft.length < 12) {
      renderEmpty(t("tooShort"));
      return;
    }

    const changedEnough = significantChange(draft, app.lastSentText);
    const oldEnough = Date.now() - app.lastSentAt > 12_000;
    if (!changedEnough && !oldEnough) return;

    const delay = immediate ? 0 : Number(els.delayRange.value);
    app.timer = window.setTimeout(() => requestReading(draft), delay);
  }

  async function requestReading(draft) {
    if (!els.activeToggle.checked) return;
    cancelInFlight();

    app.controller = new AbortController();
    app.currentText = "";
    app.inFlight = true;
    app.lastSentText = draft;
    app.lastSentAt = Date.now();
    renderStreaming("");

    try {
      const response = await fetch("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, density: currentDensity(), language: app.language }),
        signal: app.controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/x-ndjson")) {
        const payload = await response.json().catch(() => ({}));
        handlePlainError(payload);
        return;
      }

      await readNdjson(response.body);
    } catch (error) {
      if (error.name !== "AbortError") {
        renderEmpty(t("fetchFailed"));
      }
    } finally {
      app.inFlight = false;
      app.controller = null;
    }
  }

  async function readNdjson(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let latestUsage = null;
    let demo = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "meta") {
          demo = Boolean(event.demo);
        }
        if (event.type === "delta") {
          app.currentText += event.delta;
          renderStreaming(app.currentText);
        }
        if (event.type === "usage") {
          latestUsage = event.usage;
          if (event.totals) renderTotals(event.totals, event.limits || app.status?.limits);
        }
        if (event.type === "error") {
          renderEmpty(event.message || t("genericError"));
        }
        if (event.type === "done") {
          const linesForHistory = parseReadingLines(app.currentText);
          renderFinal(linesForHistory, demo);
          addHistory(linesForHistory, latestUsage, demo);
        }
      }
    }
  }

  function handlePlainError(payload) {
    if (payload.error === "rate_limited") {
      renderEmpty(t("rateLimited"));
      window.setTimeout(() => scheduleRead({ immediate: true }), payload.retryAfterMs || 1500);
      return;
    }
    if (payload.error === "codex_auth_required") {
      renderEmpty(payload.message || t("authRequired"));
      return;
    }
    if (payload.error === "budget_exhausted") {
      renderTotals(payload.totals, payload.limits || app.status?.limits);
      renderEmpty(payload.message || t("budgetExhausted"));
      return;
    }
    if (payload.error === "draft_not_changed_enough") {
      renderEmpty(t("unchanged"));
      return;
    }
    renderEmpty(payload.message || t("genericError"));
  }

  function renderStreaming(text) {
    app.currentLines = [];
    const safeText = text.trim() || t("readingNow");
    els.currentReading.innerHTML = `
      <div class="reading-lines">
        <p class="reading-line streaming">${escapeHtml(safeText)}</p>
      </div>
    `;
  }

  function renderFinal(lines, demo) {
    if (!lines.length) {
      renderEmpty(t("noReading"));
      return;
    }

    app.currentLines = lines;
    const marker = demo ? "<p class=\"empty-state\">local demo</p>" : "";
    els.currentReading.innerHTML = `
      <div class="reading-lines">
        ${lines.map((line) => `<p class="reading-line">${escapeHtml(line)}</p>`).join("")}
      </div>
      <div class="reading-actions">
        <button type="button" data-action="keep">${t("keep")}</button>
        <button type="button" data-action="push">${t("push")}</button>
        <button type="button" data-action="near">${t("near")}</button>
        <button type="button" data-action="dismiss">${t("dismiss")}</button>
      </div>
      ${marker}
    `;
  }

  function renderEmpty(message) {
    app.currentLines = [];
    els.currentReading.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  }

  function renderTotals(totals = {}, limits = {}) {
    const tokenTotal =
      Number(totals.totalTokens || 0) ||
      Number(totals.inputTokens || 0) + Number(totals.outputTokens || 0);
    els.requestCount.textContent = String(totals.requests || 0);
    els.tokenCount.textContent = String(tokenTotal);
    els.runtimeMode.textContent = "Codex";
    if (els.limitText) {
      const readLimit = limits.maxReadsPerDay;
      const tokenLimit = limits.maxTokensPerDay;
      els.limitText.textContent =
        readLimit && tokenLimit
          ? `${totals.requests || 0}/${readLimit} ${t("reads")} · ${formatCompact(tokenTotal)}/${formatCompact(tokenLimit)}`
          : t("dailyCap");
    }
  }

  function addHistory(lines, usage, demo) {
    if (!lines.length) return;
    app.history.unshift({
      at: Date.now(),
      lines,
      demo,
      usage,
      excerpt: els.draft.value.trim().slice(-90),
    });
    app.history = app.history.slice(0, 8);
    saveHistory();
    renderHistory();
  }

  function keepCurrentReading() {
    if (!app.currentLines.length) return;
    const key = app.currentLines.join("\n");
    const existing = app.markers.find((item) => item.key === key);
    if (existing) return;

    app.markers.unshift({
      key,
      at: Date.now(),
      lines: app.currentLines,
      excerpt: els.draft.value.trim().slice(-90),
    });
    app.markers = app.markers.slice(0, 6);
    saveMarkers();
    renderMarkers();
  }

  function renderMarkers() {
    if (!app.markers.length) {
      els.markers.innerHTML = `<li class="empty-marker">${t("noMarks")}</li>`;
      return;
    }

    els.markers.innerHTML = app.markers
      .map(
        (item) => `
          <li>
            <time>${new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            <p>${item.lines.map(escapeHtml).join("<br>")}</p>
          </li>
        `,
      )
      .join("");
  }

  function renderHistory() {
    if (!app.history.length) {
      els.history.innerHTML = "";
      return;
    }

    els.history.innerHTML = app.history
      .map((item) => {
        const usageText = item.demo
          ? "demo"
          : `${Number(item.usage?.total_tokens || 0)} ${t("tokens")}`;
        return `
          <li>
            <time>${new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${usageText}</time>
            <p>${item.lines.map(escapeHtml).join("<br>")}</p>
          </li>
        `;
      })
      .join("");
  }

  function parseReadingLines(text) {
    return text
      .split(/\n+/)
      .map((line) => line.replace(/^[-*・\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  function significantChange(next, previous) {
    if (!previous) return true;
    if (Math.abs(next.length - previous.length) >= 16) return true;
    if (!next.startsWith(previous) && !previous.startsWith(next)) return true;
    return false;
  }

  function currentDensity() {
    return document.querySelector('input[name="density"]:checked')?.value || "thin";
  }

  function currentLanguage() {
    return document.querySelector('input[name="language"]:checked')?.value || "en";
  }

  function validLanguage(language) {
    return language === "ja" ? "ja" : "en";
  }

  function applyLanguage() {
    document.documentElement.lang = app.language;

    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n);
    }

    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
      element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
    }

    updateDelayLabel();
    renderTotals(app.status?.totals || {}, app.status?.limits || {});
    renderMarkers();
    renderHistory();
  }

  function t(key) {
    return copy[app.language]?.[key] || copy.en[key] || key;
  }

  function updateDelayLabel() {
    els.delayValue.textContent = `${(Number(els.delayRange.value) / 1000).toFixed(1)}s`;
  }

  function updateDraftMeter() {
    els.charCount.textContent = String(els.draft.value.length);
  }

  function insertAtCursor(text) {
    const start = els.draft.selectionStart;
    const end = els.draft.selectionEnd;
    const before = els.draft.value.slice(0, start);
    const after = els.draft.value.slice(end);
    const spacer = before && !before.endsWith("\n") ? "\n" : "";
    els.draft.value = `${before}${spacer}${text}${after}`;
    const cursor = before.length + spacer.length + text.length;
    els.draft.focus();
    els.draft.setSelectionRange(cursor, cursor);
    els.draft.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function cancelInFlight() {
    if (app.controller) app.controller.abort();
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(storage.history) || "[]");
    } catch {
      return [];
    }
  }

  function loadMarkers() {
    try {
      return JSON.parse(localStorage.getItem(storage.markers) || "[]");
    } catch {
      return [];
    }
  }

  function saveHistory() {
    localStorage.setItem(storage.history, JSON.stringify(app.history));
  }

  function saveMarkers() {
    localStorage.setItem(storage.markers, JSON.stringify(app.markers));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return entities[char];
    });
  }

  function formatCompact(value) {
    return new Intl.NumberFormat([], {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value || 0));
  }
})();
