/** Temporary page-load performance instrumentation (enable with ?debug=perf). */
window.BookMindPerf = {
  enabled: false,
  _requests: [],
  _started: false,

  startPageLoad() {
    this.enabled =
      new URLSearchParams(window.location.search).has("debug") ||
      localStorage.getItem("bookmind_debug_perf") === "1";
    if (!this.enabled || this._started) return;
    this._started = true;
    console.time("page-load");
    console.time("auth-load");
    console.time("books-load");
    console.time("covers-load");
    console.time("recommendations-load");
    this._hookFetch();
  },

  endAuthLoad() {
    if (!this.enabled) return;
    try {
      console.timeEnd("auth-load");
    } catch {
      /* timer not started */
    }
  },

  endBooksLoad() {
    if (!this.enabled) return;
    try {
      console.timeEnd("books-load");
    } catch {
      /* timer not started */
    }
  },

  endCoversLoad() {
    if (!this.enabled) return;
    try {
      console.timeEnd("covers-load");
    } catch {
      /* timer not started */
    }
  },

  endRecommendationsLoad() {
    if (!this.enabled) return;
    try {
      console.timeEnd("recommendations-load");
    } catch {
      /* timer not started */
    }
  },

  endPageLoad() {
    if (!this.enabled) return;
    try {
      console.timeEnd("page-load");
    } catch {
      /* timer not started */
    }
    this.report();
  },

  trackRequest(path, durationMs) {
    this._requests.push({ path, durationMs });
  },

  _hookFetch() {
    if (!this.enabled || window.__bookmindPerfFetchHooked) return;
    window.__bookmindPerfFetchHooked = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const started = performance.now();
      const input = args[0];
      const path =
        typeof input === "string"
          ? input
          : input && typeof input.url === "string"
            ? input.url
            : "unknown";
      try {
        return await originalFetch(...args);
      } finally {
        const durationMs = Math.round(performance.now() - started);
        window.BookMindPerf?.trackRequest(path, durationMs);
      }
    };
  },

  report() {
    const sorted = [...this._requests].sort((a, b) => b.durationMs - a.durationMs);
    const slowest = sorted[0];
    const duplicates = this._findDuplicates();
    console.log("[BookMindPerf] slowest frontend request:", slowest || "none");
    console.log("[BookMindPerf] request count:", this._requests.length);
    console.log("[BookMindPerf] duplicate requests:", duplicates);
  },

  _findDuplicates() {
    const counts = new Map();
    this._requests.forEach(({ path }) => {
      const key = String(path).split("?")[0];
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([path, count]) => ({ path, count }));
  },
};

document.addEventListener("DOMContentLoaded", () => {
  window.BookMindPerf?.startPageLoad?.();
});
