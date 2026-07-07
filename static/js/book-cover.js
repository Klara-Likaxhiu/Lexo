/** Centralized book cover rendering, lookup, and caching for BookMindAI. */
const BookMindCoverImage = {
  _memoryCache: new Map(),
  _failedKeys: new Set(),
  _pending: new Map(),
  _batchQueue: new Map(),
  _batchTimer: null,
  _observer: null,
  _storageKey: "bookmind_cover_cache_v2",
  _failedStorageKey: "bookmind_cover_failed_v2",

  _loadCaches() {
    if (this._cachesLoaded) return;
    this._cachesLoaded = true;
    try {
      const raw = localStorage.getItem(this._storageKey) || sessionStorage.getItem(this._storageKey);
      if (raw) {
        const entries = JSON.parse(raw);
        if (entries && typeof entries === "object") {
          Object.entries(entries).forEach(([key, url]) => {
            if (url) this._memoryCache.set(key, url);
          });
        }
      }
      const failedRaw =
        localStorage.getItem(this._failedStorageKey) || sessionStorage.getItem(this._failedStorageKey);
      if (failedRaw) {
        const failed = JSON.parse(failedRaw);
        if (Array.isArray(failed)) failed.forEach(key => this._failedKeys.add(key));
      }
    } catch {
      /* ignore */
    }
  },

  _persistCaches() {
    try {
      const payload = JSON.stringify(Object.fromEntries(this._memoryCache));
      localStorage.setItem(this._storageKey, payload);
      sessionStorage.setItem(this._storageKey, payload);
      const failedPayload = JSON.stringify([...this._failedKeys]);
      localStorage.setItem(this._failedStorageKey, failedPayload);
      sessionStorage.setItem(this._failedStorageKey, failedPayload);
    } catch {
      /* quota */
    }
  },

  bookRef(book) {
    const ai = book?.ai_recommendation || {};
    return {
      title: book?.title || ai.title || "Untitled Book",
      author: book?.author || ai.author || "Unknown Author",
      genre: book?.genre || ai.genre || (book?.categories && book.categories[0]) || "Book",
      isbn: book?.isbn || book?.metadata?.isbn || null,
      cover_url: book?.cover_url || book?.book_data?.cover_url || null,
      google_id: book?.google_id || book?.id || book?.book_id || null,
      open_library_key: book?.open_library_key || null,
    };
  },

  refFromWrap(wrap) {
    if (wrap.__bookRef) return { ...wrap.__bookRef };
    return {
      title: wrap.dataset.title || "Untitled Book",
      author: wrap.dataset.author || "Unknown Author",
      genre: wrap.dataset.genre || "Book",
      isbn: wrap.dataset.isbn || null,
      cover_url: wrap.dataset.coverUrl || null,
      google_id: wrap.dataset.googleId || null,
      open_library_key: wrap.dataset.openLibraryKey || null,
    };
  },

  attachRefToWrap(wrap, ref, options = {}) {
    if (!wrap || !ref) return;
    wrap.__bookRef = ref;
    wrap.dataset.title = ref.title || "";
    wrap.dataset.author = ref.author || "";
    wrap.dataset.genre = ref.genre || "Book";
    wrap.dataset.isbn = ref.isbn || "";
    if (ref.cover_url) wrap.dataset.coverUrl = ref.cover_url;
    if (options.imgClass) wrap.dataset.imgClass = options.imgClass;
  },

  cacheKey(ref) {
    const isbn = String(ref.isbn || "").replace(/[^0-9Xx]/g, "");
    if (isbn) return `isbn:${isbn.toLowerCase()}`;
    return `${(ref.title || "").toLowerCase()}|${(ref.author || "unknown").toLowerCase()}`;
  },

  normalizeUrl(url) {
    if (!url) return null;
    return String(url).replace(/^http:\/\//i, "https://");
  },

  escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  seedFromBooks(books) {
    this._loadCaches();
    (books || []).forEach(book => {
      const ref = this.bookRef(book);
      const url = this.normalizeUrl(ref.cover_url);
      if (!url) return;
      this._rememberSuccess(this.cacheKey(ref), url);
    });
  },

  getCachedUrl(ref) {
    this._loadCaches();
    const key = this.cacheKey(ref);
    if (this._failedKeys.has(key)) return null;
    return this.normalizeUrl(ref.cover_url) || this._memoryCache.get(key) || null;
  },

  _rememberSuccess(key, url) {
    if (!url) return;
    this._memoryCache.set(key, url);
    this._failedKeys.delete(key);
    this._persistCaches();
  },

  _rememberFailure(key) {
    this._failedKeys.add(key);
    this._memoryCache.delete(key);
    this._persistCaches();
  },

  placeholderHtml(ref, options = {}) {
    const phClass = options.placeholderClass || "book-cover-placeholder";
    const genre = ref.genre || "Book";
    const coverClass =
      typeof BookMindUI !== "undefined" ? BookMindUI.getCoverClass(genre) : "mystery-cover";

    return `
      <div class="${phClass} premium-book-placeholder ${coverClass}" role="img" aria-label="${this.escape(ref.title)} cover">
        <div class="premium-book-spine" aria-hidden="true"></div>
        <div class="premium-book-face">
          <span class="premium-book-title">${this.escape(ref.title)}</span>
          <span class="premium-book-author">${this.escape(ref.author)}</span>
        </div>
      </div>`;
  },

  wrapHtml(inner, ref, options = {}) {
    const wrapClass = options.wrapClass || "book-cover-wrap";
    const imgClass = options.imgClass || "book-cover-img";
    const key = this.cacheKey(ref);
    const cachedUrl = this.getCachedUrl(ref);
    return `<div class="${wrapClass} book-cover-wrap"
      data-cover-key="${this.escape(key)}"
      data-title="${this.escape(ref.title)}"
      data-author="${this.escape(ref.author)}"
      data-genre="${this.escape(ref.genre || "Book")}"
      data-isbn="${this.escape(ref.isbn || "")}"
      data-img-class="${this.escape(imgClass)}"
      ${cachedUrl ? `data-cover-url="${this.escape(cachedUrl)}" data-cover-resolved="true"` : ""}>${inner}</div>`;
  },

  html(book, options = {}) {
    const ref = this.bookRef(book);
    const imgClass = options.imgClass || "book-cover-img";
    const cachedUrl = this.getCachedUrl(ref);

    if (cachedUrl) {
      return this.wrapHtml(
        `<img class="${imgClass}" data-cover-src="${this.escape(cachedUrl)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async">`,
        { ...ref, cover_url: cachedUrl },
        options
      );
    }

    return this.wrapHtml(this.placeholderHtml(ref, options), ref, options);
  },

  onError(img) {
    const wrap = img.closest("[data-cover-key]");
    if (!wrap) {
      img.remove();
      return;
    }

    const ref = this.refFromWrap(wrap);
    const key = this.cacheKey(ref);
    this._rememberFailure(key);
    wrap.dataset.coverResolved = "failed";

    img.remove();
    if (!wrap.querySelector(".premium-book-placeholder")) {
      wrap.insertAdjacentHTML("beforeend", this.placeholderHtml(ref));
    }
  },

  _ensureImageObserver() {
    if (this._imageObserver || typeof IntersectionObserver === "undefined") return;
    this._imageObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          this._imageObserver.unobserve(img);
          const src = img.dataset.coverSrc;
          if (src && !img.src) {
            img.src = src;
            img.onerror = () => BookMindCoverImage.onError(img);
          }
        });
      },
      { rootMargin: "120px 0px", threshold: 0.01 }
    );
  },

  _lazyLoadImage(img) {
    if (!img) return;
    const src = img.dataset.coverSrc;
    if (!src) return;
    this._ensureImageObserver();
    if (this._imageObserver) {
      this._imageObserver.observe(img);
      return;
    }
    img.src = src;
    img.onerror = () => BookMindCoverImage.onError(img);
  },

  applyUrlToWrap(wrap, ref, url, imgClass = "book-cover-img") {
    if (!wrap || !url) return;
    const key = this.cacheKey(ref);
    this._rememberSuccess(key, url);

    wrap.innerHTML = "";
    const img = document.createElement("img");
    img.className = imgClass;
    img.dataset.coverSrc = url;
    img.alt = `${ref.title} cover`;
    img.loading = "lazy";
    img.decoding = "async";
    wrap.appendChild(img);
    this.attachRefToWrap(wrap, { ...ref, cover_url: url }, { imgClass });
    wrap.dataset.coverResolved = "true";
    wrap.classList.add("cover-loaded");
    this._lazyLoadImage(img);
  },

  showPlaceholder(wrap, ref) {
    if (!wrap || wrap.querySelector(".premium-book-placeholder")) return;
    wrap.innerHTML = "";
    wrap.insertAdjacentHTML("beforeend", this.placeholderHtml(ref));
    wrap.dataset.coverResolved = "failed";
  },

  needsLookup(wrap) {
    if (!wrap) return false;
    if (wrap.dataset.coverResolved === "true") return false;
    if (wrap.dataset.coverResolved === "failed") return false;

    const ref = this.refFromWrap(wrap);
    const key = this.cacheKey(ref);
    if (this._failedKeys.has(key)) return false;
    if (this.getCachedUrl(ref)) return false;
    return Boolean(wrap.querySelector(".premium-book-placeholder"));
  },

  _batchResolveBooks(books) {
    this._loadCaches();
    const missing = [];
    const refs = [];

    books.forEach(book => {
      const ref = typeof book.title === "string" ? book : this.bookRef(book);
      const key = this.cacheKey(ref);
      if (this._failedKeys.has(key)) return;
      const cached = this.getCachedUrl(ref);
      if (cached) {
        ref.cover_url = cached;
        return;
      }
      if (refs.some(item => this.cacheKey(item) === key)) return;
      missing.push({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        cover_url: ref.cover_url,
        google_id: ref.google_id,
        open_library_key: ref.open_library_key,
      });
      refs.push(ref);
    });

    if (!missing.length) return Promise.resolve(refs);

    const signature = missing
      .map(b => `${b.title}|${b.author}`)
      .sort()
      .join(";;");
    if (this._pending.has(signature)) return this._pending.get(signature);

    const promise = fetch("/api/books/resolve-covers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ books: missing }),
    })
      .then(response => (response.ok ? response.json() : { results: [] }))
      .then(data => {
        (data.results || []).forEach((result, index) => {
          const ref = refs[index];
          if (!ref) return;
          const key = this.cacheKey(ref);
          const url = this.normalizeUrl(result.cover_url);
          if (url) {
            ref.cover_url = url;
            this._rememberSuccess(key, url);
          } else {
            this._rememberFailure(key);
          }
        });
        refs.forEach(ref => {
          if (!ref.cover_url) this._rememberFailure(this.cacheKey(ref));
        });
        return refs;
      })
      .catch(() => refs)
      .finally(() => {
        this._pending.delete(signature);
      });

    this._pending.set(signature, promise);
    return promise;
  },

  _flushBatchQueue() {
    this._batchTimer = null;
    const wraps = [...this._batchQueue.values()];
    this._batchQueue.clear();
    if (!wraps.length) return;

    const refs = wraps.map(wrap => this.refFromWrap(wrap));
    this._batchResolveBooks(refs).then(() => {
      wraps.forEach(wrap => {
        if (!wrap.isConnected) return;
        const ref = this.refFromWrap(wrap);
        const url = this.getCachedUrl(ref);
        const imgClass = wrap.dataset.imgClass || "book-cover-img";
        if (url) {
          this.applyUrlToWrap(wrap, ref, url, imgClass);
        } else {
          this.showPlaceholder(wrap, ref);
        }
        wrap.dataset.coverLoading = "false";
      });
    });
  },

  _queueWrap(wrap) {
    if (!wrap || !this.needsLookup(wrap)) return;
    if (wrap.dataset.coverLoading === "true") return;

    const ref = this.refFromWrap(wrap);
    const cached = this.getCachedUrl(ref);
    if (cached) {
      this.applyUrlToWrap(wrap, ref, cached, wrap.dataset.imgClass || "book-cover-img");
      return;
    }

    wrap.dataset.coverLoading = "true";
    this._batchQueue.set(this.cacheKey(ref), wrap);
    clearTimeout(this._batchTimer);
    this._batchTimer = setTimeout(() => this._flushBatchQueue(), 40);
  },

  _ensureCoverObserver() {
    if (this._observer || typeof IntersectionObserver === "undefined") return;
    this._observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          this._observer.unobserve(entry.target);
          this._queueWrap(entry.target);
        });
      },
      { rootMargin: "160px 0px", threshold: 0.01 }
    );
  },

  hydrateLazy(root = document, options = {}) {
    this._loadCaches();
    this._ensureCoverObserver();

    root.querySelectorAll("[data-cover-key]").forEach(wrap => {
      const ref = this.refFromWrap(wrap);
      this.attachRefToWrap(wrap, ref, options);

      const cached = this.getCachedUrl(ref);
      if (cached && this.needsLookup(wrap)) {
        this.applyUrlToWrap(wrap, ref, cached, options.imgClass || wrap.dataset.imgClass || "book-cover-img");
        return;
      }

      const img = wrap.querySelector("img[data-cover-src]");
      if (img) this._lazyLoadImage(img);

      if (!this.needsLookup(wrap)) return;

      if (this._observer) {
        this._observer.observe(wrap);
      } else {
        this._queueWrap(wrap);
      }
    });
  },

  async hydrate(root = document, options = {}) {
    if (options.lazy !== false) {
      this.hydrateLazy(root, options);
      return;
    }

    this._loadCaches();
    const wraps = [...root.querySelectorAll("[data-cover-key]")].filter(w => this.needsLookup(w));
    if (!wraps.length) return;

    const refs = wraps.map(wrap => {
      const ref = this.refFromWrap(wrap);
      this.attachRefToWrap(wrap, ref, options);
      return ref;
    });

    await this._batchResolveBooks(refs);
    wraps.forEach(wrap => {
      const ref = this.refFromWrap(wrap);
      const url = this.getCachedUrl(ref);
      const imgClass = options.imgClass || wrap.dataset.imgClass || "book-cover-img";
      if (url) this.applyUrlToWrap(wrap, ref, url, imgClass);
      else this.showPlaceholder(wrap, ref);
    });
  },

  async hydrateMany(books, root = document, options = {}) {
    this.seedFromBooks(books);

    books.forEach((book, index) => {
      const ref = this.bookRef(book);
      const url = this.getCachedUrl(ref);
      if (url) {
        book.cover_url = url;
        if (book.book_data) book.book_data.cover_url = url;
      }
    });

    const needsApi = books.filter(book => !this.getCachedUrl(this.bookRef(book)));
    if (needsApi.length) {
      await this._batchResolveBooks(needsApi);
      needsApi.forEach(book => {
        const url = this.getCachedUrl(this.bookRef(book));
        if (url) {
          book.cover_url = url;
          if (book.book_data) book.book_data.cover_url = url;
        }
      });
    }

    this.hydrateLazy(root, { ...options, lazy: true });
    return books;
  },

  /** @deprecated use hydrateLazy — kept for compatibility */
  async hydrateWrap(wrap, book, options = {}) {
    if (!wrap) return null;
    const ref = book ? this.bookRef(book) : this.refFromWrap(wrap);
    this.attachRefToWrap(wrap, ref, options);
    const cached = this.getCachedUrl(ref);
    if (cached) {
      this.applyUrlToWrap(wrap, ref, cached, options.imgClass || wrap.dataset.imgClass || "book-cover-img");
      return cached;
    }
    if (!this.needsLookup(wrap)) return null;
    this._queueWrap(wrap);
    return null;
  },
};

window.BookMindCoverImage = BookMindCoverImage;
