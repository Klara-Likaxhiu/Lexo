/** My Library — Supabase-backed via /api/library (no localStorage for shelf data). */
const BookMindLibrary = {
  _cache: null,
  _books: [],
  _loaded: false,
  _loading: null,
  _lastError: null,

  SHELVES: ["read", "reading", "want", "not_interested"],

  emptyLibrary() {
    return { read: [], reading: [], want: [], not_interested: [] };
  },

  _authHeaders() {
    if (!window.BookMindAuth) return {};
    return BookMindAuth.getAuthHeaders();
  },

  apiUrl(path) {
    if (window.BookMindAuth?.apiUrl) {
      return BookMindAuth.apiUrl(path);
    }
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${window.location.origin}${normalized}`;
  },

  normalizeStatus(status) {
    const value = String(status || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, "_");
    const map = {
      want: "want",
      want_to_read: "want",
      "want to read": "want",
      reading: "reading",
      currently_reading: "reading",
      "currently reading": "reading",
      read: "read",
      finished: "read",
      "not interested": "not_interested",
      not_interested: "not_interested",
      not_recommend: "not_interested",
      "not recommend": "not_interested",
    };
    const normalized = map[value] || value;
    if (!this.SHELVES.includes(normalized)) {
      throw new Error(`Invalid shelf status: ${status}`);
    }
    return normalized;
  },

  _extractError(data, rawBody, status) {
    if (window.BookMindAuth?.extractErrorMessage) {
      return BookMindAuth.extractErrorMessage(data, rawBody, status);
    }
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail.map(item => (typeof item === "string" ? item : item?.msg || JSON.stringify(item))).join("; ");
    }
    if (rawBody && rawBody.length < 600) return rawBody;
    return `Request failed (HTTP ${status}).`;
  },

  async _request(path, { method = "GET", body = null } = {}) {
    if (!window.BookMindAuth?.isLoggedIn()) {
      throw new Error("Sign in to save books to your library.");
    }

    const url = this.apiUrl(path);
    const headers = { ...this._authHeaders() };
    if (body != null) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });

    const rawBody = await response.text();
    let data = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { raw: rawBody };
      }
    }

    if (!response.ok) {
      const detail = this._extractError(data, rawBody, response.status);
      const message = `[HTTP ${response.status}] ${detail}`;
      console.error("[BookMindLibrary] API error", {
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        requestBody: body,
        responseBody: data,
        rawBody,
      });
      throw new Error(message);
    }

    return data;
  },

  async ensureLoaded(force = false) {
    if (!window.BookMindAuth?.isLoggedIn()) {
      this._cache = this.emptyLibrary();
      this._books = [];
      this._loaded = true;
      this._lastError = null;
      return this._cache;
    }

    if (this._loaded && !force) return this._cache;
    if (this._loading) return this._loading;

    this._loading = this._fetchLibrary().finally(() => {
      this._loading = null;
    });
    return this._loading;
  },

  async _fetchLibrary() {
    const data = await this._request("/api/library");
    this._cache = data.library || this.emptyLibrary();
    this._books = Array.isArray(data.books) ? data.books : [];
    this._loaded = true;
    this._lastError = null;
    return this._cache;
  },

  async refresh() {
    return this.ensureLoaded(true);
  },

  getLibrary() {
    if (!this._cache) this._cache = this.emptyLibrary();
    return this._cache;
  },

  getBooks() {
    return this._books.slice();
  },

  getLastError() {
    return this._lastError;
  },

  normalizeTitle(title) {
    return (title || "").toLowerCase().trim();
  },

  findBook(book) {
    if (!book) return null;

    const bookId = book.book_id || book.library_id || book.id;
    if (bookId) {
      const byId = this._books.find(
        entry =>
          entry.book_id === String(bookId) ||
          entry.library_id === String(bookId)
      );
      if (byId) return byId;
    }

    const key = this.normalizeTitle(book.title);
    if (!key) return null;
    return this._books.find(entry => this.normalizeTitle(entry.title) === key) || null;
  },

  findShelf(book) {
    const entry = this.findBook(book);
    return entry ? entry.status : null;
  },

  getShelfLabel(status) {
    const labels = {
      read: "Finished",
      reading: "Currently Reading",
      want: "Want to Read",
      not_interested: "Not Interested",
    };
    return labels[status] || status;
  },

  getStats() {
    const library = this.getLibrary();
    return {
      read: (library.read || []).length,
      reading: (library.reading || []).length,
      want: (library.want || []).length,
      not_interested: (library.not_interested || []).length,
    };
  },

  getExcludedBooks() {
    return this.getBooks().map(book => book.title);
  },

  getProgressInfo(book) {
    const total = Number(book?.total_pages ?? book?.metadata?.total_pages) || 0;
    let current = Number(book?.current_page) || 0;
    let percent = Number(book?.progress) || 0;

    if (!current && percent > 0 && total > 0) {
      current = Math.round((percent / 100) * total);
    }
    if (!percent && current > 0 && total > 0) {
      percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
    }

    return { current, total, percent };
  },

  computePercent(current, total) {
    const c = Number(current);
    const t = Number(total);
    if (!t || t <= 0) return 0;
    if (c < 0) return 0;
    if (c > t) return null;
    return Math.max(0, Math.min(100, Math.round((c / t) * 100)));
  },

  async updateReadingProgress(libraryId, currentPage, totalPages, options = {}) {
    if (!libraryId) throw new Error("Missing library entry.");
    if (!window.BookMindAuth?.isLoggedIn()) {
      throw new Error("Sign in to save reading progress.");
    }

    const current = Number(currentPage);
    const total = Number(totalPages);
    if (!total || total <= 0) {
      throw new Error("Enter total pages.");
    }
    if (current < 0) {
      throw new Error("Current page cannot be negative.");
    }
    if (current > total) {
      throw new Error("Current page cannot be greater than total pages.");
    }

    const data = await this._request(
      `/api/library/${encodeURIComponent(libraryId)}/progress`,
      {
        method: "PUT",
        body: { current_page: current, total_pages: total },
      }
    );

    await this.refresh();
    const book = data.book;
    if (book?.status === "read") {
      this.syncFinishState(book, "read");
    }
    this.logActivity();
    this._emitChange({ action: "progress", book, finished: data.finished });

    if (options.silent !== true) {
      this._notify(data.message || "Reading progress saved.", "success");
    }
    return data;
  },

  async recordBookOpened(libraryId) {
    if (!libraryId || !window.BookMindAuth?.isLoggedIn()) return null;

    try {
      const data = await this._request(
        `/api/library/${encodeURIComponent(libraryId)}/open`,
        { method: "POST" }
      );
      await this.refresh();
      return data.book;
    } catch (error) {
      console.error("[BookMindLibrary] recordBookOpened failed", error);
      return null;
    }
  },

  _bookPayload(book, status, meta = {}) {
    const shelf = this.normalizeStatus(status);
    const payload = {
      title: book.title,
      author: book.author || "Unknown Author",
      genre: book.genre || "Book",
      cover_url: book.cover_url || null,
      description: book.description || book.description_preview || null,
      status: shelf,
      progress: Number(meta.progress ?? book.progress ?? 0) || 0,
      favorite: Boolean(meta.favorite ?? book.favorite),
    };

    if (book.book_id) payload.book_id = book.book_id;
    else if (book.id) payload.id = book.id;
    else if (book.open_library_key) payload.book_id = book.open_library_key;

    if (meta.source) payload.source = meta.source;
    else if (book.source) payload.source = book.source;

    const totalPages = meta.totalPages ?? meta.total_pages ?? book.total_pages;
    const totalNum = Number(totalPages);
    if (Number.isFinite(totalNum) && totalNum > 0) {
      payload.total_pages = totalNum;
    }

    const currentPage = meta.currentPage ?? meta.current_page ?? book.current_page;
    const currentNum = Number(currentPage);
    if (Number.isFinite(currentNum) && currentNum >= 0) {
      payload.current_page = currentNum;
    }

    return payload;
  },

  async saveBook(book, status, meta = {}) {
    const shelf = this.normalizeStatus(status);
    const data = await this._request("/api/library", {
      method: "POST",
      body: this._bookPayload(book, shelf, meta),
    });

    await this.refresh();
    this.syncFinishState(book, shelf);
    this._emitChange({ action: "save", book: data.book, status: shelf, created: data.created });
    return data;
  },

  async addBook(book, status, meta = {}) {
    const shelf = this.normalizeStatus(status);
    const data = await this.saveBook(book, shelf, meta);
    if (meta.silent !== true) {
      const label = this.getShelfLabel(shelf);
      const verb = data.created ? "added to" : "moved to";
      this._notify(`"${book.title}" ${verb} ${label}.`, "success");
    }
    return data.book;
  },

  async addBookWithMeta(book, status, meta = {}) {
    return this.addBook(book, status, { ...meta, silent: true });
  },

  async patchBook(libraryId, patch) {
    if (!libraryId) throw new Error("Missing library entry.");

    const body = { ...patch };
    if (body.status != null) {
      body.status = this.normalizeStatus(body.status);
    }

    const data = await this._request(`/api/library/${encodeURIComponent(libraryId)}`, {
      method: "PATCH",
      body,
    });

    await this.refresh();
    const book = data.book;
    if (book && patch.status) {
      this.syncFinishState(book, patch.status);
    }
    this._emitChange({ action: "patch", book, patch });
    return book;
  },

  async removeBook(book, options = {}) {
    const entry = this.findBook(book);
    if (!entry?.library_id) {
      throw new Error("Book is not in your library.");
    }

    const data = await this._request(`/api/library/${encodeURIComponent(entry.library_id)}`, {
      method: "DELETE",
    });

    await this.refresh();
    this.clearFinish(book);
    this._emitChange({ action: "remove", book: entry });

    if (options.silent !== true) {
      this._notify(`"${book.title || entry.title}" removed from your library.`, "success");
    }
    return true;
  },

  _emitChange(detail) {
    document.dispatchEvent(new CustomEvent("bookmind:library-changed", { detail }));
  },

  _notify(message, type = "success") {
    const toast = document.getElementById("libraryToast");
    if (toast) {
      toast.textContent = message;
      toast.hidden = false;
      toast.classList.remove("error");
      if (type === "error") toast.classList.add("error");
      toast.classList.add("show");
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => {
          toast.hidden = true;
        }, 250);
      }, 3200);
      return;
    }

    if (type === "error") {
      console.error(message);
    }
  },

  /* ------------------------------------------- reading challenges (local) */

  getReadingData() {
    const data = JSON.parse(localStorage.getItem("bookmind_reading_data")) || {};
    return {
      finishes: data.finishes || {},
      activity: Array.isArray(data.activity) ? data.activity : [],
      goals: {
        yearly: Number(data.goals && data.goals.yearly) || 12,
        monthly: Number(data.goals && data.goals.monthly) || 0,
      },
    };
  },

  saveReadingData(data) {
    localStorage.setItem("bookmind_reading_data", JSON.stringify(data));
  },

  todayKey() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now - offset).toISOString().slice(0, 10);
  },

  recordFinish(book) {
    const key = this.normalizeTitle(book.title);
    if (!key) return;

    const data = this.getReadingData();
    if (!data.finishes[key]) {
      data.finishes[key] = new Date().toISOString();
    }
    this.saveReadingData(data);
    this.logActivity();
  },

  clearFinish(book) {
    const key = this.normalizeTitle(book.title);
    const data = this.getReadingData();
    if (data.finishes[key]) {
      delete data.finishes[key];
      this.saveReadingData(data);
    }
  },

  logActivity() {
    const data = this.getReadingData();
    const today = this.todayKey();
    if (!data.activity.includes(today)) {
      data.activity.push(today);
      this.saveReadingData(data);
    }
  },

  syncFinishState(book, status) {
    if (status === "read") {
      this.recordFinish(book);
    } else {
      this.clearFinish(book);
    }
  },

  getGoals() {
    return this.getReadingData().goals;
  },

  setGoals(goals) {
    const data = this.getReadingData();
    data.goals = {
      yearly: Math.max(0, Math.round(Number(goals.yearly) || 0)),
      monthly: Math.max(0, Math.round(Number(goals.monthly) || 0)),
    };
    this.saveReadingData(data);
    return data.goals;
  },
};
