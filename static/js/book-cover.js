/** Centralized book cover rendering, lookup, and caching for BookMindAI. */
const BookMindCoverImage = {
  _memoryCache: new Map(),
  _lookupFailedUntil: new Map(),
  _brokenUrls: new Map(),
  _pending: new Map(),
  _batchQueue: new Map(),
  _batchTimer: null,
  _imageObserver: null,
  _resolveObserver: null,
  _persistTimer: null,
  _persistedKeys: new Set(),
  _storageKey: "bookmind_cover_cache_v4",
  _failedStorageKey: "bookmind_cover_failed_v4",
  _brokenStorageKey: "bookmind_cover_broken_v4",
  _lookupFailedTtlMs: 30 * 60 * 1000,

  isMissingCoverUrl(url) {
    if (url == null) return true;
    const value = String(url).trim();
    if (!value) return true;
    return ["null", "undefined", "none", "n/a", "false", "0"].includes(value.toLowerCase());
  },

  _loadCaches() {
    if (this._cachesLoaded) return;
    this._cachesLoaded = true;
    try {
      const raw = localStorage.getItem(this._storageKey) || sessionStorage.getItem(this._storageKey);
      if (raw) {
        const entries = JSON.parse(raw);
        if (entries && typeof entries === "object") {
          Object.entries(entries).forEach(([key, url]) => {
            if (!this.isMissingCoverUrl(url)) this._memoryCache.set(key, url);
          });
        }
      }
      const failedRaw =
        localStorage.getItem(this._failedStorageKey) || sessionStorage.getItem(this._failedStorageKey);
      if (failedRaw) {
        const failed = JSON.parse(failedRaw);
        if (failed && typeof failed === "object") {
          Object.entries(failed).forEach(([key, until]) => {
            if (typeof until === "number" && until > Date.now()) {
              this._lookupFailedUntil.set(key, until);
            }
          });
        }
      }
      const brokenRaw =
        localStorage.getItem(this._brokenStorageKey) || sessionStorage.getItem(this._brokenStorageKey);
      if (brokenRaw) {
        const broken = JSON.parse(brokenRaw);
        if (broken && typeof broken === "object") {
          Object.entries(broken).forEach(([key, urls]) => {
            if (Array.isArray(urls) && urls.length) {
              this._brokenUrls.set(key, new Set(urls));
            }
          });
        }
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
      const failedPayload = JSON.stringify(Object.fromEntries(this._lookupFailedUntil));
      localStorage.setItem(this._failedStorageKey, failedPayload);
      sessionStorage.setItem(this._failedStorageKey, failedPayload);
      const brokenPayload = JSON.stringify(
        Object.fromEntries([...this._brokenUrls.entries()].map(([key, urls]) => [key, [...urls]]))
      );
      localStorage.setItem(this._brokenStorageKey, brokenPayload);
      sessionStorage.setItem(this._brokenStorageKey, brokenPayload);
    } catch {
      /* quota */
    }
  },

  _schedulePersist() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this._persistCaches(), 400);
  },

  _isLookupFailed(key) {
    this._loadCaches();
    const until = this._lookupFailedUntil.get(key);
    if (!until) return false;
    if (until <= Date.now()) {
      this._lookupFailedUntil.delete(key);
      this._schedulePersist();
      return false;
    }
    return true;
  },

  _rememberLookupFailure(key) {
    this._lookupFailedUntil.set(key, Date.now() + this._lookupFailedTtlMs);
    this._schedulePersist();
  },

  _brokenSet(key) {
    this._loadCaches();
    if (!this._brokenUrls.has(key)) this._brokenUrls.set(key, new Set());
    return this._brokenUrls.get(key);
  },

  _rememberBrokenUrl(key, url) {
    const normalized = this.normalizeUrl(url);
    if (!normalized) return;
    const broken = this._brokenSet(key);
    if (broken.has(normalized)) return;
    broken.add(normalized);
    if (this._memoryCache.get(key) === normalized) this._memoryCache.delete(key);
    this._schedulePersist();
  },

  _isBrokenUrl(key, url) {
    const normalized = this.normalizeUrl(url);
    return Boolean(normalized && this._brokenSet(key).has(normalized));
  },

  _sanitizeCoverUrl(url) {
    return this.isMissingCoverUrl(url) ? null : url;
  },

  bookRef(book) {
    const ai = book?.ai_recommendation || {};
    const rawCover = book?.cover_url ?? book?.coverUrl ?? book?.book_data?.cover_url ?? null;
    return {
      title: book?.title || ai.title || "Untitled Book",
      author: book?.author || ai.author || "Unknown Author",
      genre: book?.genre || ai.genre || (book?.categories && book.categories[0]) || "Book",
      isbn: book?.isbn || book?.metadata?.isbn || null,
      cover_url: this._sanitizeCoverUrl(rawCover),
      google_id: book?.google_id || book?.id || book?.book_id || null,
      open_library_key: book?.open_library_key || null,
      library_id: book?.library_id || null,
    };
  },

  refFromWrap(wrap) {
    if (wrap.__bookRef) return { ...wrap.__bookRef };
    return {
      title: wrap.dataset.title || "Untitled Book",
      author: wrap.dataset.author || "Unknown Author",
      genre: wrap.dataset.genre || "Book",
      isbn: wrap.dataset.isbn || null,
      cover_url: this._sanitizeCoverUrl(wrap.dataset.coverUrl || null),
      google_id: wrap.dataset.googleId || null,
      open_library_key: wrap.dataset.openLibraryKey || null,
      library_id: wrap.dataset.libraryId || null,
    };
  },

  _refSignature(ref) {
    return [
      ref.title || "",
      ref.author || "",
      ref.isbn || "",
      ref.cover_url || "",
      ref.library_id || "",
    ].join("||");
  },

  _resetWrapState(wrap, ref, options = {}) {
    const sig = this._refSignature(ref);
    if (wrap.dataset.coverSig === sig) return;
    wrap.dataset.coverSig = sig;
    wrap.classList.remove("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "";
    wrap.dataset.coverLoading = "false";
    wrap.querySelector("img[data-cover-src]")?.remove();
    this.ensurePlaceholder(wrap, ref, options);
    this.showPlaceholder(wrap);
  },

  attachRefToWrap(wrap, ref, options = {}) {
    if (!wrap || !ref) return;
    this._resetWrapState(wrap, ref, options);
    wrap.__bookRef = ref;
    wrap.dataset.title = ref.title || "";
    wrap.dataset.author = ref.author || "";
    wrap.dataset.genre = ref.genre || "Book";
    wrap.dataset.isbn = ref.isbn || "";
    if (ref.cover_url) wrap.dataset.coverUrl = ref.cover_url;
    else delete wrap.dataset.coverUrl;
    if (ref.library_id) wrap.dataset.libraryId = ref.library_id;
    else delete wrap.dataset.libraryId;
    if (options.imgClass) wrap.dataset.imgClass = options.imgClass;
  },

  cacheKey(ref) {
    const isbn = String(ref.isbn || "").replace(/[^0-9Xx]/g, "");
    if (isbn) return `isbn:${isbn.toLowerCase()}`;
    return `${(ref.title || "").toLowerCase()}|${(ref.author || "unknown").toLowerCase()}`;
  },

  normalizeUrl(url) {
    if (this.isMissingCoverUrl(url)) return null;
    let normalized = String(url).trim().replace(/^http:\/\//i, "https://");
    if (normalized.includes("books.google") || normalized.includes("googleusercontent.com")) {
      normalized = normalized.replace(/zoom=\d+/i, "zoom=0");
      normalized = normalized.replace("&edge=curl", "");
      normalized = normalized.replace(/w=\d+-h\d+/i, "w=800-h1200");
    }
    if (normalized.includes("openlibrary.org/b/")) {
      normalized = normalized
        .replace("-S.jpg", "-L.jpg")
        .replace("-M.jpg", "-L.jpg")
        .replace("-S.webp", "-L.jpg")
        .replace("-M.webp", "-L.jpg");
    }
    return normalized;
  },

  escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  _logResolution(ref, payload = {}) {
    const debug = payload.cover_debug || {};
    console.log("[BookCover]", {
      title: ref.title,
      savedCoverUrl: debug.saved_cover_url ?? ref.cover_url ?? null,
      googleBooks: debug.google_books ?? payload.google_books ?? null,
      openLibraryIsbn: debug.open_library_isbn ?? payload.open_library_isbn ?? null,
      openLibrarySearch: debug.open_library_search ?? payload.open_library_search ?? null,
      finalSource: debug.final_source ?? payload.final_source ?? payload.cover_source ?? "placeholder",
      coverUrl: payload.cover_url ?? null,
    });
  },

  seedFromBooks(books) {
    this._loadCaches();
    (books || []).forEach(book => {
      const ref = this.bookRef(book);
      const url = this.normalizeUrl(ref.cover_url);
      if (!url) return;
      const key = this.cacheKey(ref);
      if (this._isBrokenUrl(key, url)) return;
      this._rememberSuccess(key, url, { persist: false });
    });
  },

  getKnownUrl(ref) {
    this._loadCaches();
    const key = this.cacheKey(ref);
    const candidates = [this.normalizeUrl(ref.cover_url), this._memoryCache.get(key)].filter(Boolean);
    for (const url of candidates) {
      if (!this._isBrokenUrl(key, url)) return url;
    }
    return null;
  },

  _effectiveCoverUrl(ref) {
    const key = this.cacheKey(ref);
    const url = this.normalizeUrl(ref.cover_url);
    if (!url || this._isBrokenUrl(key, url)) return null;
    return url;
  },

  _rememberSuccess(key, url, options = {}) {
    const { persist = true, ref = null } = options;
    const normalized = this.normalizeUrl(url);
    if (!normalized) return;
    const unchanged = this._memoryCache.get(key) === normalized;
    this._memoryCache.set(key, normalized);
    this._lookupFailedUntil.delete(key);
    if (!unchanged) this._schedulePersist();
    if (persist && ref) this._persistCoverUrl(ref, normalized);
  },

  placeholderHtml(ref, options = {}) {
    const phClass = options.placeholderClass || "book-cover-placeholder";
    const genre = ref.genre || "Book";
    const coverClass =
      typeof BookMindUI !== "undefined" ? BookMindUI.getCoverClass(genre) : "mystery-cover";

    return `
      <div class="${phClass} premium-book-placeholder ${coverClass} book-cover-placeholder" role="img" aria-label="${this.escape(ref.title)} cover" data-cover-fallback="true">
        <div class="premium-book-spine" aria-hidden="true"></div>
        <div class="premium-book-face">
          <span class="premium-book-title book-cover-title">${this.escape(ref.title || "Untitled Book")}</span>
          <span class="premium-book-author book-cover-author">${this.escape(ref.author || "Unknown Author")}</span>
        </div>
      </div>`;
  },

  wrapHtml(inner, ref, options = {}) {
    const wrapClass = options.wrapClass || "book-cover-wrap";
    const imgClass = options.imgClass || "book-cover-img";
    const key = this.cacheKey(ref);
    const knownUrl = this.getKnownUrl(ref);
    return `<div class="${wrapClass} book-cover-wrap"
      data-cover-key="${this.escape(key)}"
      data-title="${this.escape(ref.title)}"
      data-author="${this.escape(ref.author)}"
      data-genre="${this.escape(ref.genre || "Book")}"
      data-isbn="${this.escape(ref.isbn || "")}"
      data-img-class="${this.escape(imgClass)}"
      data-cover-sig="${this.escape(this._refSignature(ref))}"
      ${ref.library_id ? `data-library-id="${this.escape(ref.library_id)}"` : ""}
      ${knownUrl ? `data-cover-url="${this.escape(knownUrl)}"` : ""}>${inner}</div>`;
  },

  ensurePlaceholder(wrap, ref, options = {}) {
    if (!wrap) return;
    if (!wrap.querySelector("[data-cover-fallback]")) {
      wrap.insertAdjacentHTML("afterbegin", this.placeholderHtml(ref, options));
    }
  },

  showPlaceholder(wrap) {
    if (!wrap) return;
    wrap.classList.remove("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "placeholder";
    const ph = wrap.querySelector("[data-cover-fallback]");
    if (ph) ph.hidden = false;
  },

  html(book, options = {}) {
    const ref = this.bookRef(book);
    const imgClass = options.imgClass || "book-cover-img";
    const placeholder = this.placeholderHtml(ref, options);
    const knownUrl = this.getKnownUrl(ref);

    if (knownUrl) {
      const key = this.cacheKey(ref);
      if (!this._memoryCache.has(key)) {
        this._rememberSuccess(key, knownUrl, { persist: false, ref });
      }
      return this.wrapHtml(
        `${placeholder}<img class="${imgClass} book-cover-image" data-cover-src="${this.escape(knownUrl)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async">`,
        { ...ref, cover_url: knownUrl },
        options
      );
    }

    return this.wrapHtml(placeholder, ref, options);
  },

  _attachImageHandlers(img, wrap) {
    if (!img || !wrap) return;
    img.onload = () => {
      wrap.classList.add("cover-has-image", "cover-loaded");
      wrap.dataset.coverResolved = "true";
      const ph = wrap.querySelector("[data-cover-fallback]");
      if (ph) ph.hidden = true;
    };
    img.onerror = () => this.onError(img);
  },

  onError(img) {
    const wrap = img.closest("[data-cover-key]");
    if (!wrap) return;

    const ref = this.refFromWrap(wrap);
    const key = this.cacheKey(ref);
    const failedUrl = this.normalizeUrl(img.dataset.coverSrc || img.src);

    if (failedUrl) {
      this._rememberBrokenUrl(key, failedUrl);
      if (ref.cover_url === failedUrl) {
        ref.cover_url = null;
        wrap.__bookRef = { ...ref, cover_url: null };
        delete wrap.dataset.coverUrl;
      }
    }

    img.remove();
    this.showPlaceholder(wrap);
    this.ensurePlaceholder(wrap, ref);
    this._logResolution(ref, { final_source: "image_error", cover_url: null });

    if (this._isLookupFailed(key)) return;

    wrap.dataset.coverResolved = "retry";
    this._queueWrap(wrap);
  },

  _ensureResolveObserver() {
    if (this._resolveObserver || typeof IntersectionObserver === "undefined") return;
    this._resolveObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          this._resolveObserver.unobserve(entry.target);
          this._queueWrap(entry.target);
        });
      },
      { rootMargin: "160px 0px", threshold: 0.01 }
    );
  },

  _observeWrapForResolve(wrap) {
    this._ensureResolveObserver();
    if (this._resolveObserver) {
      this._resolveObserver.observe(wrap);
      return;
    }
    this._queueWrap(wrap);
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
            this._attachImageHandlers(img, img.closest("[data-cover-key]"));
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
    const wrap = img.closest("[data-cover-key]");
    this._attachImageHandlers(img, wrap);
    this._ensureImageObserver();
    if (this._imageObserver) {
      this._imageObserver.observe(img);
      return;
    }
    img.src = src;
  },

  applyUrlToWrap(wrap, ref, url, imgClass = "book-cover-img", options = {}) {
    if (!wrap) return;
    this.ensurePlaceholder(wrap, ref, options);

    const key = this.cacheKey(ref);
    const normalized = this.normalizeUrl(url);
    if (!normalized || this._isBrokenUrl(key, normalized)) {
      this.showPlaceholder(wrap);
      return;
    }

    this._rememberSuccess(key, normalized, { ref });

    let img = wrap.querySelector("img[data-cover-src]");
    if (!img) {
      img = document.createElement("img");
      wrap.appendChild(img);
    }

    img.className = `${imgClass} book-cover-img book-cover-image`.trim();
    img.dataset.coverSrc = normalized;
    img.alt = `${ref.title} cover`;
    img.loading = "lazy";
    img.decoding = "async";
    img.removeAttribute("src");

    wrap.__bookRef = { ...ref, cover_url: normalized };
    wrap.dataset.coverUrl = normalized;
    wrap.dataset.coverSig = this._refSignature({ ...ref, cover_url: normalized });
    if (options.imgClass || imgClass) wrap.dataset.imgClass = options.imgClass || imgClass;

    this._lazyLoadImage(img);
  },

  hasPlaceholder(wrap) {
    return Boolean(wrap?.querySelector("[data-cover-fallback]"));
  },

  needsResolve(wrap) {
    if (!wrap) return false;
    if (wrap.dataset.coverResolved === "true") return false;
    const key = this.cacheKey(this.refFromWrap(wrap));
    if (this._isLookupFailed(key)) return false;
    if (wrap.dataset.coverResolved === "retry") return true;
    if (wrap.dataset.coverResolved === "placeholder") return true;
    if (!this.hasPlaceholder(wrap)) return true;
    return !this.getKnownUrl(this.refFromWrap(wrap));
  },

  _isInViewport(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return true;
    const rect = el.getBoundingClientRect();
    return rect.bottom >= -160 && rect.top <= window.innerHeight + 160;
  },

  async _persistCoverUrl(ref, url) {
    const key = this.cacheKey(ref);
    if (this._persistedKeys.has(key)) return;
    this._persistedKeys.add(key);

    const normalized = this.normalizeUrl(url);
    if (!normalized) return;

    if (ref.library_id && window.BookMindLibrary?._books) {
      const book = BookMindLibrary._books.find(item => item.library_id === ref.library_id);
      if (book && book.cover_url !== normalized) book.cover_url = normalized;
    }

    const headers = { "Content-Type": "application/json" };
    if (window.BookMindAuth?.getAuthHeaders) Object.assign(headers, BookMindAuth.getAuthHeaders());

    try {
      const response = await fetch("/api/library/cover", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: ref.title,
          author: ref.author,
          cover_url: normalized,
          library_id: ref.library_id || null,
          isbn: ref.isbn || null,
        }),
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (data?.book?.library_id && window.BookMindLibrary?._books) {
        const book = BookMindLibrary._books.find(item => item.library_id === data.book.library_id);
        if (book) book.cover_url = data.book.cover_url || normalized;
      }
    } catch {
      /* best-effort */
    }
  },

  _batchResolveBooks(books) {
    this._loadCaches();
    const missing = [];
    const refs = [];

    books.forEach(book => {
      const ref = typeof book.title === "string" && !book.ai_recommendation ? book : this.bookRef(book);
      const key = this.cacheKey(ref);
      const known = this.getKnownUrl(ref);
      if (known) {
        ref.cover_url = known;
        return;
      }
      if (this._isLookupFailed(key)) return;
      if (this._pending.has(key)) return;
      if (refs.some(item => this.cacheKey(item) === key)) return;

      missing.push({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        cover_url: this._effectiveCoverUrl(ref),
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
          this._logResolution(ref, result);
          if (url && !this._isBrokenUrl(key, url)) {
            ref.cover_url = url;
            this._rememberSuccess(key, url, { ref });
          } else {
            this._rememberLookupFailure(key);
            this._logResolution(ref, {
              ...(result.cover_debug || {}),
              final_source: "placeholder",
              cover_url: null,
            });
          }
        });
        return refs;
      })
      .catch(() => refs)
      .finally(() => {
        this._pending.delete(signature);
        refs.forEach(ref => this._pending.delete(this.cacheKey(ref)));
      });

    refs.forEach(ref => this._pending.set(this.cacheKey(ref), promise));
    this._pending.set(signature, promise);
    return promise;
  },

  _flushBatchQueue() {
    this._batchTimer = null;
    const wraps = [...this._batchQueue.values()];
    this._batchQueue.clear();
    if (!wraps.length) return;

    const refs = wraps.map(wrap => this.refFromWrap(wrap));
    this._batchResolveBooks(refs)
      .then(() => {
        wraps.forEach(wrap => {
          if (!wrap.isConnected) return;
          const ref = this.refFromWrap(wrap);
          const url = this.getKnownUrl(ref);
          const imgClass = wrap.dataset.imgClass || "book-cover-img";
          if (url) {
            this.applyUrlToWrap(wrap, ref, url, imgClass);
          } else {
            this.showPlaceholder(wrap);
            this.ensurePlaceholder(wrap, ref);
          }
          wrap.dataset.coverLoading = "false";
        });
      })
      .catch(() => {
        wraps.forEach(wrap => {
          this.showPlaceholder(wrap);
          wrap.dataset.coverLoading = "false";
        });
      });
  },

  _queueWrap(wrap) {
    if (!wrap) return;
    if (wrap.dataset.coverLoading === "true") return;

    const ref = this.refFromWrap(wrap);
    this.ensurePlaceholder(wrap, ref);

    const known = this.getKnownUrl(ref);
    if (known) {
      this.applyUrlToWrap(wrap, ref, known, wrap.dataset.imgClass || "book-cover-img");
      return;
    }

    if (!this.needsResolve(wrap)) {
      this.showPlaceholder(wrap);
      return;
    }

    const key = this.cacheKey(ref);
    if (this._isLookupFailed(key)) {
      this.showPlaceholder(wrap);
      return;
    }

    wrap.dataset.coverLoading = "true";
    this._batchQueue.set(key, wrap);
    clearTimeout(this._batchTimer);
    this._batchTimer = setTimeout(() => this._flushBatchQueue(), 50);
  },

  hydrateLazy(root = document, options = {}) {
    this._loadCaches();
    const wraps = root.querySelectorAll("[data-cover-key]");

    wraps.forEach(wrap => {
      const ref = this.refFromWrap(wrap);
      this.attachRefToWrap(wrap, ref, options);
      this.ensurePlaceholder(wrap, ref, options);

      const known = this.getKnownUrl(ref);
      const img = wrap.querySelector("img[data-cover-src]");

      if (known) {
        if (!img || img.dataset.coverSrc !== known) {
          this.applyUrlToWrap(
            wrap,
            ref,
            known,
            options.imgClass || wrap.dataset.imgClass || "book-cover-img",
            options
          );
        } else {
          this._lazyLoadImage(img);
        }
      } else if (img) {
        img.remove();
        this.showPlaceholder(wrap);
      }

      if (!this.needsResolve(wrap)) return;

      if (this._isInViewport(wrap)) this._queueWrap(wrap);
      else this._observeWrapForResolve(wrap);
    });
  },

  async hydrate(root = document, options = {}) {
    this.hydrateLazy(root, options);
  },

  async hydrateMany(books, root = document, options = {}) {
    this.seedFromBooks(books);
    this.hydrateLazy(root, options);
    return books;
  },

  async hydrateWrap(wrap, book, options = {}) {
    if (!wrap) return null;
    const ref = book ? this.bookRef(book) : this.refFromWrap(wrap);
    this.attachRefToWrap(wrap, ref, options);
    this.ensurePlaceholder(wrap, ref, options);

    const known = this.getKnownUrl(ref);
    if (known) {
      this.applyUrlToWrap(wrap, ref, known, options.imgClass || wrap.dataset.imgClass || "book-cover-img", options);
      return known;
    }

    if (!this.needsResolve(wrap)) {
      this.showPlaceholder(wrap);
      return null;
    }

    wrap.dataset.coverLoading = "true";
    await this._batchResolveBooks([ref]);
    const url = this.getKnownUrl(ref);
    wrap.dataset.coverLoading = "false";

    if (url) {
      this.applyUrlToWrap(wrap, ref, url, options.imgClass || wrap.dataset.imgClass || "book-cover-img", options);
      return url;
    }

    this.showPlaceholder(wrap);
    return null;
  },
};

/** Reusable cover component — saved URL → Google Books → Open Library → placeholder. */
const BookCover = {
  html(bookOrProps, options = {}) {
    const props = bookOrProps || {};
    const book =
      props.title !== undefined && !props.ai_recommendation
        ? {
            title: props.title,
            author: props.author,
            cover_url: props.coverUrl ?? props.cover_url ?? null,
            genre: props.genre,
            isbn: props.isbn,
            library_id: props.libraryId ?? props.library_id ?? null,
            google_id: props.googleId ?? props.google_id ?? null,
            open_library_key: props.openLibraryKey ?? props.open_library_key ?? null,
          }
        : props;
    return BookMindCoverImage.html(book, options);
  },

  hydrate(root, options) {
    return BookMindCoverImage.hydrate(root, options);
  },

  hydrateLazy(root, options) {
    return BookMindCoverImage.hydrateLazy(root, options);
  },

  hydrateMany(books, root, options) {
    return BookMindCoverImage.hydrateMany(books, root, options);
  },

  hydrateWrap(wrap, book, options) {
    return BookMindCoverImage.hydrateWrap(wrap, book, options);
  },

  seedFromBooks(books) {
    return BookMindCoverImage.seedFromBooks(books);
  },

  onError(img) {
    return BookMindCoverImage.onError(img);
  },

  escape(value) {
    return BookMindCoverImage.escape(value);
  },

  isMissingCoverUrl(url) {
    return BookMindCoverImage.isMissingCoverUrl(url);
  },
};

window.BookMindCoverImage = BookMindCoverImage;
window.BookCover = BookCover;
