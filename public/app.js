(() => {
  const els = {
    draft: document.querySelector("#draft"),
    charCount: document.querySelector("#charCount"),
    marginNotes: document.querySelector("#marginNotes"),
    readGaze: document.querySelector("#readGaze"),
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
      draftHint: "Live, unsent paper",
      chars: "chars",
      draftPlaceholder:
        "I keep noticing that AI replies arrive too late, after the thought has already hardened...",
      draftHelp:
        "Start typing. After a short pause, provisional AI readings appear as faint marginal notes.",
      aiOn: "AI on",
      interval: "Delay",
      densityLegend: "Reading density",
      densityThin: "Thin",
      densityQuestion: "Question",
      densitySpecific: "Specific",
      languageLegend: "Language",
      advancedSummary: "Advanced",
      emptyStart: "A faint reading will appear in the margin.",
      markersLabel: "kept fragments",
      historyLabel: "recent traces",
      clear: "clear",
      reads: "reads",
      tokens: "tokens",
      dailyCap: "daily cap",
      aiPaused: "AI readings are paused. Your draft stays here.",
      tooShort: "Write a little more and the margin will begin to answer.",
      fetchFailed: "The reading stalled. Wait a moment and keep writing.",
      rateLimited: "A little too fast. Keeping this draft for the next interval.",
      authRequired: "Sign in to Codex with ChatGPT, then start the app again.",
      budgetExhausted: "Today's reading limit is reached. You can keep writing with AI off.",
      unchanged: "When the draft moves a little more, the next reading will appear.",
      genericError: "Not ready yet. Check the Codex connection.",
      readingNow: "reading",
      noReading: "No marginal reading this time.",
      noMarks: "No marks",
      pinNote: "Pin this marginal reading",
      unpinNote: "Unpin this marginal reading",
    },
    ja: {
      eyebrow: "local co-speech",
      draftLabel: "下書き",
      draftHint: "未送信の紙面",
      chars: "文字",
      draftPlaceholder: "最近AIを使っていて、便利すぎることについて、なんというか...",
      draftHelp: "書き始めると、短い間のあとに、淡い読みが余白へ置かれます。",
      aiOn: "AI on",
      interval: "間隔",
      densityLegend: "読みの濃さ",
      densityThin: "薄い",
      densityQuestion: "問い",
      densitySpecific: "具体",
      languageLegend: "言語",
      advancedSummary: "詳細",
      emptyStart: "余白に薄い読みが置かれます。",
      markersLabel: "残した断片",
      historyLabel: "最近の痕跡",
      clear: "消す",
      reads: "回",
      tokens: "トークン",
      dailyCap: "日次上限",
      aiPaused: "AIの読みを止めています。文章はここに残ります。",
      tooShort: "もう少し書くと、余白が応答し始めます。",
      fetchFailed: "読みの取得で止まりました。少し待ってからまた書いてみてください。",
      rateLimited: "少し速すぎます。今の文を保ったまま、次の間で読みます。",
      authRequired: "CodexにChatGPTでサインインしてから、もう一度起動してください。",
      budgetExhausted: "今日の読み上限に達しました。AIを止めて書き続けられます。",
      unchanged: "もう少し文が動いたら、次の読みを置きます。",
      genericError: "まだ読めません。Codexの状態を確認してください。",
      readingNow: "読んでいます",
      noReading: "今回は余白に置ける読みがありませんでした。",
      noMarks: "印なし",
      pinNote: "この余白の読みを残す",
      unpinNote: "この余白の読みの固定を外す",
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

  const noteOffsets = [
    { x: "0px", y: "0px", r: "-0.2deg" },
    { x: "9px", y: "4px", r: "0.18deg" },
    { x: "-4px", y: "10px", r: "-0.08deg" },
  ];

  const app = {
    status: null,
    timer: null,
    controller: null,
    gazeTimer: null,
    lastSentText: "",
    lastSentAt: 0,
    history: loadHistory(),
    markers: loadMarkers(),
    language: validLanguage(localStorage.getItem(storage.language)),
    currentText: "",
    currentLines: [],
    inFlight: false,
    notes: [],
    noteId: 0,
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
    showMarginHint(t("emptyStart"));
    await refreshStatus();
    scheduleRead({ immediate: false });
  }

  function bindEvents() {
    els.draft.addEventListener("input", () => {
      localStorage.setItem(storage.draft, els.draft.value);
      updateDraftMeter();
      ageNotesByDraft();
      scheduleRead({ immediate: false });
    });

    els.draft.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types.includes("text/plain")) {
        event.preventDefault();
      }
    });

    els.draft.addEventListener("drop", (event) => {
      const text = event.dataTransfer?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      insertAtCursor(text);
    });

    els.activeToggle.addEventListener("change", () => {
      localStorage.setItem(storage.active, String(els.activeToggle.checked));
      if (els.activeToggle.checked) {
        scheduleRead({ immediate: true });
      } else {
        cancelInFlight();
        fadeUnpinnedNotes();
        showMarginHint(t("aiPaused"));
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
        showMarginHint(t("emptyStart"));
        scheduleRead({ immediate: true });
      });
    }

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
    flashReadGaze();
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
          renderFinal(linesForHistory);
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
    removeNotes((note) => note.hint, true);
    const safeText = text.trim() || t("readingNow");
    const note = findNote((item) => item.streaming) || createNote("", 0, {
      className: "is-streaming",
      streaming: true,
      draftLength: els.draft.value.trim().length,
    });
    note.text = safeText;
    note.element.innerHTML = `${escapeHtml(safeText)}<span class="blinker" aria-hidden="true"></span>`;
  }

  function renderFinal(lines) {
    removeNotes((note) => note.streaming || note.hint, true);
    if (!lines.length) {
      renderEmpty(t("noReading"));
      return;
    }

    app.currentLines = lines;
    fadeUnpinnedNotes();
    lines.forEach((line, index) => {
      const note = createNote(line, index, {
        draftLength: els.draft.value.trim().length,
      });
      scheduleNoteLifecycle(note, index);
    });
  }

  function renderEmpty(message) {
    app.currentLines = [];
    showMarginHint(message);
  }

  function showMarginHint(message) {
    const existing = findNote((note) => note.hint);
    if (existing) {
      existing.text = message;
      existing.element.textContent = message;
      clearNoteTimers(existing);
      scheduleHintLifecycle(existing);
      return;
    }

    const note = createNote(message, 0, {
      className: "is-hint",
      hint: true,
      draftLength: els.draft.value.trim().length,
    });
    scheduleHintLifecycle(note);
  }

  function createNote(text, index, options = {}) {
    const note = {
      id: ++app.noteId,
      text,
      bornAt: Date.now(),
      draftLength: options.draftLength || 0,
      pinned: false,
      streaming: Boolean(options.streaming),
      hint: Boolean(options.hint),
      timers: [],
      element: document.createElement(options.hint ? "p" : "button"),
    };

    const offset = noteOffsets[index % noteOffsets.length];
    const top = anchorTopForDraft() + index * 112;
    note.element.className = `margin-note ${options.className || ""}`.trim();
    note.element.dataset.noteId = String(note.id);
    note.element.style.setProperty("--note-top", `${top}px`);
    note.element.style.setProperty("--note-x", offset.x);
    note.element.style.setProperty("--note-y", offset.y);
    note.element.style.setProperty("--note-r", offset.r);
    note.element.textContent = text;

    if (!note.hint) {
      note.element.type = "button";
      note.element.draggable = true;
      note.element.setAttribute("aria-label", t("pinNote"));
      note.element.addEventListener("click", () => toggleNotePin(note));
      note.element.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", note.text);
        event.dataTransfer.effectAllowed = "copy";
      });
    }

    app.notes.push(note);
    els.marginNotes.appendChild(note.element);
    return note;
  }

  function scheduleNoteLifecycle(note, index = 0) {
    clearNoteTimers(note);
    note.timers.push(
      window.setTimeout(() => {
        if (!note.pinned) note.element.dataset.state = "fading";
      }, 12_000 + index * 1_500),
    );
    note.timers.push(
      window.setTimeout(() => {
        if (!note.pinned) fadeAndRemove(note);
      }, 25_000 + index * 1_700),
    );
  }

  function scheduleHintLifecycle(note) {
    clearNoteTimers(note);
    note.timers.push(window.setTimeout(() => fadeAndRemove(note), 4_000));
  }

  function toggleNotePin(note) {
    if (note.streaming || note.hint) return;
    note.pinned = !note.pinned;
    clearNoteTimers(note);
    note.element.dataset.state = note.pinned ? "pinned" : "";
    note.element.setAttribute("aria-label", note.pinned ? t("unpinNote") : t("pinNote"));
    if (note.pinned) {
      keepLines([note.text]);
    } else {
      scheduleNoteLifecycle(note);
    }
  }

  function ageNotesByDraft() {
    const draftLength = els.draft.value.trim().length;
    for (const note of [...app.notes]) {
      if (note.pinned || note.streaming || note.hint) continue;
      if (draftLength - note.draftLength > 60) fadeAndRemove(note);
    }
  }

  function fadeUnpinnedNotes() {
    for (const note of [...app.notes]) {
      if (!note.pinned) fadeAndRemove(note);
    }
  }

  function fadeAndRemove(note) {
    if (!app.notes.includes(note)) return;
    clearNoteTimers(note);
    note.element.dataset.state = "gone";
    note.timers.push(window.setTimeout(() => removeNote(note), 720));
  }

  function removeNotes(predicate, instant = false) {
    for (const note of [...app.notes]) {
      if (predicate(note)) removeNote(note, instant);
    }
  }

  function removeNote(note, instant = false) {
    clearNoteTimers(note);
    app.notes = app.notes.filter((item) => item !== note);
    if (instant) {
      note.element.remove();
      return;
    }
    note.element.remove();
  }

  function clearNoteTimers(note) {
    for (const timer of note.timers) {
      window.clearTimeout(timer);
    }
    note.timers = [];
  }

  function findNote(predicate) {
    return app.notes.find(predicate);
  }

  function anchorTopForDraft() {
    const marginHeight = els.marginNotes.clientHeight || 648;
    const beforeCursor = els.draft.value.slice(0, els.draft.selectionStart || els.draft.value.length);
    const hardBreaks = beforeCursor.split("\n").length - 1;
    const softWraps = Math.floor(beforeCursor.length / 58);
    const approximateLine = hardBreaks + softWraps;
    const top = 72 + approximateLine * 18 - els.draft.scrollTop * 0.35;
    return clamp(top, 72, Math.max(92, marginHeight - 286));
  }

  function flashReadGaze() {
    window.clearTimeout(app.gazeTimer);
    els.readGaze.classList.remove("flash");
    void els.readGaze.offsetWidth;
    els.readGaze.classList.add("flash");
    app.gazeTimer = window.setTimeout(() => els.readGaze.classList.remove("flash"), 1500);
  }

  function renderTotals(totals = {}, limits = {}) {
    const tokenTotal =
      Number(totals.totalTokens || totals.total_tokens || 0) ||
      Number(totals.inputTokens || totals.input_tokens || 0) +
        Number(totals.outputTokens || totals.output_tokens || 0);
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

  function keepLines(lines) {
    if (!lines.length) return;
    const key = lines.join("\n");
    const existing = app.markers.find((item) => item.key === key);
    if (existing) return;

    app.markers.unshift({
      key,
      at: Date.now(),
      lines,
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
          : `${Number(item.usage?.total_tokens || item.usage?.totalTokens || 0)} ${t("tokens")}`;
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
