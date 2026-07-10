/** My Library — Supabase-backed via /api/library with stale-while-revalidate cache. */
const BookMindLibrary = {
  _cache: null,
  _books: [],
  _loaded: false,
  _loading: null,
  _bgRefresh: null,
  _backfillStarted: false,
  _lastError: null,
  _persistKey: "bookmind_library_cache_v3",
  _persistAtKey: "bookmind_library_cache_at",
  _persistTtlMs: 5 * 60 * 1000,

  SHELVES: ["read", "reading", "want", "not_interested"],

  normalizeCoverUrl(book) {
    if (!book || typeof book !== "object") return null;
    const imageLinks = book.imageLinks && typeof book.imageLinks === "object" ? book.imageLinks : {};
    const volumeInfo = book.volumeInfo && typeof book.volumeInfo === "object" ? book.volumeInfo : {};
    const volumeLinks =
      volumeInfo.imageLinks && typeof volumeInfo.imageLinks === "object" ? volumeInfo.imageLinks : {};
    const bookData = book.book_data && typeof book.book_data === "object" ? book.book_data : {};
    const ai =
      book.ai_recommendation && typeof book.ai_recommendation === "object" ? book.ai_recommendation : {};
    const candidates = [
      book.cover_url,
      book.coverUrl,
      book.image,
      book.thumbnail,
      imageLinks.thumbnail,
      volumeLinks.thumbnail,
      bookData.cover_url,
      bookData.coverUrl,
      ai.cover_url,
    ];
    for (const value of candidates) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed || ["null", "undefined", "none", "n/a"].includes(trimmed.toLowerCase())) continue;
      return trimmed;
    }
    return null;
  },

  emptyLibrary() {
    return { read: [], reading: [], want: [], not_interested: [] };
  },

  _authHeaders() {
    if (!window.BookMindAuth) return {};
    return window.BookMindAuth.getAuthHeaders();
  },

  apiUrl(path) {
    if (window.BookMindAuth?.apiUrl) {
      return window.BookMindAuth.apiUrl(path);
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
      return window.BookMindAuth.extractErrorMessage(data, rawBody, status);
    }
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail.map(item => (typeof item === "string" ? item : item?.msg || JSON.stringify(item))).join("; ");
    }
    if (rawBody && rawBody.length < 600) return rawBody;
    return `Request failed (HTTP ${status}).`;
  },

  async _hasAuth() {
    if (!window.BookMindAPI?.ensureAuth) {
      return false;
    }
    const token = await BookMindAPI.ensureAuth({ redirect: false });
    return Boolean(token);
  },

  async _request(path, { method = "GET", body = null } = {}) {
    if (!window.BookMindAPI?.request) {
      throw new Error("BookMindAPI is not loaded. Include js/api.js before js/library.js.");
    }

    const token = await BookMindAPI.ensureAuth({ redirect: true });
    if (!token) {
      throw new Error("Sign in to save books to your library.");
    }

    const data = await BookMindAPI.request(path, { method, body, auth: true, redirect: true });
    if (data === null) {
      throw new Error("Redirecting to login.");
    }
    return data;
  },

  async ensureLoaded(force = false) {
    if (window.BookMindAuth?.whenReady) {
      await window.BookMindAuth.whenReady();
    }

    if (!(await this._hasAuth())) {
      this._cache = this.emptyLibrary();
      this._books = [];
      this._loaded = true;
      this._lastError = null;
      return this._cache;
    }

    if (this._loaded && !force) return this._cache;
    if (this._loading) return this._loading;

    if (!force && !this._loaded) {
      const persisted = this._readPersistentCache();
      if (persisted) {
        this._applyPayload(persisted);
        this._scheduleBackgroundRefresh();
        return this._cache;
      }
    }

    this._loading = this._fetchLibrary().finally(() => {
      this._loading = null;
    });
    return this._loading;
  },

  normalizeLibraryBook(row) {
    if (!row || typeof row !== "object") return row;
    const nested = row.books || row.book || null;
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return {
      ...row,
      library_id: row.library_id || row.id || nested?.id || null,
      title: row.title || nested?.title || "Untitled Book",
      author: row.author || nested?.author || "Unknown Author",
      isbn: row.isbn || metadata.isbn || nested?.isbn || null,
      cover_url:
        row.cover_url ||
        nested?.cover_url ||
        row.coverUrl ||
        nested?.coverUrl ||
        null,
    };
  },

  _applyPayload(data) {
    const books = Array.isArray(data.books) ? data.books.map(book => this.normalizeLibraryBook(book)) : [];
    this._cache = data.library || this.emptyLibrary();
    if (this._cache && typeof this._cache === "object") {
      Object.keys(this._cache).forEach(key => {
        this._cache[key] = (this._cache[key] || []).map(book => this.normalizeLibraryBook(book));
      });
    }
    this._books = books;
    this._loaded = true;
    this._lastError = null;
  },

  _readPersistentCache() {
    try {
      const at = Number(localStorage.getItem(this._persistAtKey) || 0);
      if (!at || Date.now() - at > this._persistTtlMs) return null;
      const raw = localStorage.getItem(this._persistKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  },

  _writePersistentCache() {
    try {
      localStorage.setItem(
        this._persistKey,
        JSON.stringify({ library: this._cache, books: this._books })
      );
      localStorage.setItem(this._persistAtKey, String(Date.now()));
    } catch {
      /* storage full or unavailable */
    }
  },

  _scheduleBackgroundRefresh() {
    if (this._bgRefresh) return;
    this._bgRefresh = this._fetchLibrary({ silent: true })
      .catch(() => this._cache)
      .finally(() => {
        this._bgRefresh = null;
      });
  },

  async _fetchLibrary({ silent = false } = {}) {
    const prevBooks = this._books.slice();
    const data = await this._request("/api/library");
    this._applyPayload(data);
    this._writePersistentCache();
    const coversChanged = silent && this._coversChanged(prevBooks, this._books);
    if (!silent || coversChanged) {
      this._emitChange({ action: silent ? "background-refresh" : "refresh" });
    }
    this._maybeBackfillCovers();
    return this._cache;
  },

  _maybeBackfillCovers() {
    if (this._backfillStarted) return;
    this._backfillStarted = true;
    this._request("/api/library/backfill-covers", {
      method: "POST",
      body: { limit: 100, force: true },
    })
      .then(result => {
        if (result?.repaired > 0) {
          return this._fetchLibrary({ silent: true });
        }
      })
      .catch(() => {});
  },

  _coversChanged(prev, next) {
    if (prev.length !== next.length) return true;
    const prevMap = new Map(prev.map(book => [book.library_id, book.cover_url || ""]));
    return next.some(book => (book.cover_url || "") !== (prevMap.get(book.library_id) || ""));
  },

  _upsertBookInCache(book) {
    if (!book?.library_id) return;
    const index = this._books.findIndex(entry => entry.library_id === book.library_id);
    if (index >= 0) {
      this._books[index] = { ...this._books[index], ...book };
    } else {
      this._books.push(book);
    }
    const status = this.normalizeStatus(book.status);
    Object.keys(this._cache).forEach(key => {
      this._cache[key] = (this._cache[key] || []).filter(entry => entry.library_id !== book.library_id);
    });
    if (!this._cache[status]) this._cache[status] = [];
    this._cache[status].unshift(book);
    this._writePersistentCache();
  },

  _removeBookFromCache(libraryId) {
    this._books = this._books.filter(entry => entry.library_id !== libraryId);
    Object.keys(this._cache).forEach(key => {
      this._cache[key] = (this._cache[key] || []).filter(entry => entry.library_id !== libraryId);
    });
    this._writePersistentCache();
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

  getBooksByStatus(status) {
    const shelf = this.normalizeStatus(status);
    return (this.getLibrary()[shelf] || []).slice();
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

  isFinished(book) {
    const entry = this.findBook(book);
    if (!entry) return false;
    const status = String(entry.status || "").toLowerCase();
    const progress = Number(entry.progress) || 0;
    return status === "read" || progress >= 100;
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
    if (!(await this._hasAuth())) {
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

    const book = data.book;
    if (book) this._upsertBookInCache(book);
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

  async recordBookOpened(libraryId, options = {}) {
    if (!libraryId || !(await this._hasAuth())) return null;

    try {
      const data = await this._request(
        `/api/library/${encodeURIComponent(libraryId)}/open`,
        { method: "POST" }
      );
      if (!options.skipRefresh && data.book) {
        this._upsertBookInCache(data.book);
      }
      return data.book;
    } catch {
      return null;
    }
  },

  _bookPayload(book, status, meta = {}) {
    const shelf = this.normalizeStatus(status);
    let progress = Number(meta.progress ?? book.progress ?? 0) || 0;
    if (shelf === "read") {
      progress = 100;
    }

    const coverUrl = this.normalizeCoverUrl(book);
    const payload = {
      title: book.title,
      author: book.author || "Unknown Author",
      genre: book.genre || "Book",
      cover_url: coverUrl,
      description: book.description || book.description_preview || null,
      status: shelf,
      progress,
      favorite: Boolean(meta.favorite ?? book.favorite),
    };

    console.info("[BookMindLibrary] save payload", {
      title: payload.title,
      author: payload.author,
      cover_url: payload.cover_url,
      status: payload.status,
    });

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

    if (data.book) this._upsertBookInCache(data.book);
    this.syncFinishState(book, shelf);
    this._emitChange({ action: "save", book: data.book, status: shelf, created: data.created });
    return data;
  },

  async addBook(book, status, meta = {}) {
    const shelf = this.normalizeStatus(status);
    const saveMeta = shelf === "read" ? { ...meta, progress: 100 } : meta;
    const data = await this.saveBook(book, shelf, saveMeta);
    if (meta.silent !== true) {
      this._notify(data.message || `"${book.title}" saved.`, "success");
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
      if (body.status === "read" && body.progress == null) {
        body.progress = 100;
      }
    }

    const data = await this._request(`/api/library/${encodeURIComponent(libraryId)}`, {
      method: "PATCH",
      body,
    });

    const book = data.book;
    if (book) this._upsertBookInCache(book);
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

    await this._request(`/api/library/${encodeURIComponent(entry.library_id)}`, {
      method: "DELETE",
    });

    this._removeBookFromCache(entry.library_id);
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
      /* toast unavailable — error already surfaced in UI when possible */
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
