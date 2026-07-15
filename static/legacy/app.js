// Lexo — frontend logic
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    engineBadge: $("#engineBadge"),
    engineText: $("#engineText"),
    dropzone: $("#dropzone"),
    fileInput: $("#fileInput"),
    browseBtn: $("#browseBtn"),
    fileName: $("#fileName"),
    textInput: $("#textInput"),
    charCount: $("#charCount"),
    analyzeBtn: $("#analyzeBtn"),
    sampleBtn: $("#sampleBtn"),
    emptyState: $("#emptyState"),
    summaryText: $("#summaryText"),
    keywordsBox: $("#keywordsBox"),
    takeawaysList: $("#takeawaysList"),
    chatLog: $("#chatLog"),
    chatForm: $("#chatForm"),
    chatInput: $("#chatInput"),
    toast: $("#toast"),
  };

  // Application state.
  const state = {
    context: "",
    analyzed: false,
    history: [],
  };

  const SAMPLE_TEXT = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair.

We had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way. In short, the period was so far like the present period that some of its noisiest authorities insisted on its being received, for good or for evil, in the superlative degree of comparison only.

There were a king with a large jaw and a queen with a plain face on the throne of England; there were a king with a large jaw and a queen with a fair face on the throne of France. In both countries it was clearer than crystal to the lords of the State preserves of loaves and fishes, that things in general were settled for ever.

It was the year of Our Lord one thousand seven hundred and seventy-five. Spiritual revelations were conceded to England at that favoured period, as at this. France, less favoured on the whole as to matters spiritual than her sister of the shield and trident, rolled with exceeding smoothness down hill, making paper money and spending it.`;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function toast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle("error", isError);
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (els.toast.hidden = true), 3500);
  }

  function setLoading(loading) {
    const label = els.analyzeBtn.querySelector(".btn-label");
    const spinner = els.analyzeBtn.querySelector(".spinner");
    els.analyzeBtn.disabled = loading;
    label.textContent = loading ? "Analyzing…" : "Analyze";
    spinner.hidden = !loading;
  }

  function updateCharCount() {
    const n = els.textInput.value.length;
    els.charCount.textContent = `${n.toLocaleString()} character${n === 1 ? "" : "s"}`;
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body.detail) detail = body.detail;
      } catch (_) {}
      throw new Error(detail);
    }
    return res.json();
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function renderResults(data) {
    els.summaryText.textContent = data.summary || "No summary available.";

    els.keywordsBox.innerHTML = "";
    (data.keywords || []).forEach((kw) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = kw;
      els.keywordsBox.appendChild(chip);
    });
    if (!(data.keywords || []).length) {
      els.keywordsBox.innerHTML = '<span class="dz-hint">No keywords detected.</span>';
    }

    els.takeawaysList.innerHTML = "";
    (data.takeaways || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      els.takeawaysList.appendChild(li);
    });
    if (!(data.takeaways || []).length) {
      els.takeawaysList.innerHTML = "<li>No takeaways extracted.</li>";
    }

    els.emptyState.hidden = true;
    showTab("summary");
    state.analyzed = true;
    resetChat();
  }

  function showTab(name) {
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === name)
    );
    document.querySelectorAll(".tab-pane").forEach((p) => (p.hidden = true));
    if (!state.analyzed && name !== "chat") {
      els.emptyState.hidden = false;
      return;
    }
    els.emptyState.hidden = true;
    const pane = $(`#pane-${name}`);
    if (pane) pane.hidden = false;
  }

  // ---------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------

  function resetChat() {
    state.history = [];
    els.chatLog.innerHTML = "";
    addChatMessage(
      "assistant",
      "I've read your text. Ask me anything — summaries, themes, characters, or specific details."
    );
  }

  function addChatMessage(role, content) {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${role}`;
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? "🧑" : "📖";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;
    msg.append(avatar, bubble);
    els.chatLog.appendChild(msg);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    return msg;
  }

  async function sendChat(question) {
    addChatMessage("user", question);
    state.history.push({ role: "user", content: question });

    const typing = addChatMessage("assistant", "Thinking…");
    typing.classList.add("typing");

    try {
      const data = await api("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          context: state.context,
          history: state.history.slice(0, -1),
        }),
      });
      typing.remove();
      addChatMessage("assistant", data.answer);
      state.history.push({ role: "assistant", content: data.answer });
    } catch (err) {
      typing.remove();
      addChatMessage("assistant", `Sorry, something went wrong: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  async function analyzeText() {
    const text = els.textInput.value.trim();
    if (!text) {
      toast("Please paste some text or upload a file first.", true);
      return;
    }
    setLoading(true);
    try {
      const data = await api("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      state.context = text;
      renderResults(data);
      toast("Analysis complete.");
    } catch (err) {
      toast(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function uploadFile(file) {
    els.fileName.textContent = `Reading ${file.name}…`;
    setLoading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const data = await api("/api/upload", { method: "POST", body: form });
      els.textInput.value = data.text || "";
      updateCharCount();
      state.context = data.text || "";
      els.fileName.textContent = `${data.filename} · ${(data.char_count || 0).toLocaleString()} chars`;
      renderResults(data);
      toast("File analyzed.");
    } catch (err) {
      els.fileName.textContent = "No file selected";
      toast(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function loadEngineInfo() {
    try {
      const data = await api("/api/health");
      els.engineText.textContent = data.engine;
      els.engineBadge.classList.toggle("offline", !data.using_openai);
    } catch (_) {
      els.engineText.textContent = "Offline";
      els.engineBadge.classList.add("offline");
    }
  }

  // ---------------------------------------------------------------------
  // Wire up events
  // ---------------------------------------------------------------------

  els.textInput.addEventListener("input", updateCharCount);
  els.analyzeBtn.addEventListener("click", analyzeText);
  els.sampleBtn.addEventListener("click", () => {
    els.textInput.value = SAMPLE_TEXT;
    updateCharCount();
    toast("Sample loaded — hit Analyze.");
  });

  els.browseBtn.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("click", (e) => {
    if (e.target === els.browseBtn) return;
    els.fileInput.click();
  });
  els.fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) uploadFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    })
  );
  els.dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });

  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => showTab(tab.dataset.tab))
  );

  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = els.chatInput.value.trim();
    if (!q) return;
    if (!state.context) {
      toast("Analyze a text first so I have something to read.", true);
      return;
    }
    els.chatInput.value = "";
    sendChat(q);
  });

  // Init
  updateCharCount();
  loadEngineInfo();
})();
