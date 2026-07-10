/** Centralized book cover rendering, lookup, and caching for BookMindAI. */

function getBookCover(book) {
  if (!book || typeof book !== "object") return null;
  const ai = book.ai_recommendation || {};
  const bookData = book.book_data || {};
  const images = book.volumeInfo?.imageLinks || book.volume_info?.imageLinks || {};

  return (
    book.cover_url ||
    book.coverUrl ||
    book.image ||
    book.thumbnail ||
    bookData.cover_url ||
    bookData.coverUrl ||
    ai.cover_url ||
    ai.coverUrl ||
    images.thumbnail ||
    images.smallThumbnail ||
    images.medium ||
    images.large ||
    images.extraLarge ||
    null
  );
}

function normalizeCoverUrl(url) {
  if (!url || typeof url !== "string") return null;
  if (BookMindCoverImage.isMissingCoverUrl(url)) return null;

  let normalized = url.trim().replace(/^http:/i, "https:").replace("&edge=curl", "");

  if (normalized.includes("books.google") || normalized.includes("googleusercontent.com")) {
    normalized = normalized.replace(/zoom=\d+/i, "zoom=0");
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
}

const BookMindCoverImage = {
  _memoryCache: new Map(),
  _brokenUrls: new Map(),
  _pending: new Map(),
  _batchTimer: null,
  _persistTimer: null,
  _persistedKeys: new Set(),
  _storageKey: "bookmind_cover_cache_v5",
  _brokenStorageKey: "bookmind_cover_broken_v5",

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

  _brokenSet(key) {
    this._loadCaches();
    if (!this._brokenUrls.has(key)) this._brokenUrls.set(key, new Set());
    return this._brokenUrls.get(key);
  },

  _rememberBrokenUrl(key, url) {
    const normalized = normalizeCoverUrl(url);
    if (!normalized) return;
    const broken = this._brokenSet(key);
    if (broken.has(normalized)) return;
    broken.add(normalized);
    if (this._memoryCache.get(key) === normalized) this._memoryCache.delete(key);
    this._schedulePersist();
  },

  _isBrokenUrl(key, url) {
    const normalized = normalizeCoverUrl(url);
    return Boolean(normalized && this._brokenSet(key).has(normalized));
  },

  bookRef(book) {
    const ai = book?.ai_recommendation || {};
    const rawCover = getBookCover(book);
    return {
      title: book?.title || ai.title || "Untitled Book",
      author: book?.author || ai.author || "Unknown Author",
      genre: book?.genre || ai.genre || (book?.categories && book.categories[0]) || "Book",
      isbn: book?.isbn || book?.metadata?.isbn || book?.book_data?.isbn || null,
      cover_url: this.isMissingCoverUrl(rawCover) ? null : rawCover,
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
      cover_url: this.isMissingCoverUrl(wrap.dataset.coverUrl) ? null : wrap.dataset.coverUrl || null,
      google_id: wrap.dataset.googleId || null,
      open_library_key: wrap.dataset.openLibraryKey || null,
      library_id: wrap.dataset.libraryId || null,
    };
  },

  cacheKey(ref) {
    const isbn = String(ref.isbn || "").replace(/[^0-9Xx]/g, "");
    if (isbn) return `isbn:${isbn.toLowerCase()}`;
    return `${(ref.title || "").toLowerCase()}|${(ref.author || "unknown").toLowerCase()}`;
  },

  normalizeUrl(url) {
    return normalizeCoverUrl(url);
  },

  escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  debugCoverState(book, resolvedCover, extra = {}) {
    console.table({
      title: book?.title,
      author: book?.author,
      isbn: book?.isbn,
      cover_url: book?.cover_url,
      coverUrl: book?.coverUrl,
      image: book?.image,
      thumbnail: book?.thumbnail,
      finalCover: resolvedCover ?? null,
      ...extra,
    });
  },

  _logMissingCover(book, ref, resolvedCover, reason) {
    this.debugCoverState(book || ref, resolvedCover, { reason });
  },

  seedFromBooks(books) {
    this._loadCaches();
    (books || []).forEach(book => {
      const ref = this.bookRef(book);
      const url = normalizeCoverUrl(ref.cover_url);
      if (!url) return;
      const key = this.cacheKey(ref);
      if (this._isBrokenUrl(key, url)) return;
      this._rememberSuccess(key, url, { persist: false });
    });
  },

  getKnownUrl(ref) {
    this._loadCaches();
    const key = this.cacheKey(ref);
    const candidates = [normalizeCoverUrl(ref.cover_url), this._memoryCache.get(key)].filter(Boolean);
    for (const url of candidates) {
      if (!this._isBrokenUrl(key, url)) return url;
    }
    return null;
  },

  _rememberSuccess(key, url, options = {}) {
    const { persist = true, ref = null } = options;
    const normalized = normalizeCoverUrl(url);
    if (!normalized) return;
    const unchanged = this._memoryCache.get(key) === normalized;
    this._memoryCache.set(key, normalized);
    if (!unchanged) this._schedulePersist();
    if (persist && ref) this._persistCoverUrl(ref, normalized);
  },

  placeholderHtml(ref, options = {}) {
    const phClass = options.placeholderClass || "book-cover-placeholder";
    return `
      <div class="${phClass} book-cover-placeholder" data-cover-fallback="true" role="img" aria-label="${this.escape(ref.title)} cover">
        <strong class="book-cover-title">${this.escape(ref.title || "Untitled Book")}</strong>
        <span class="book-cover-author">${this.escape(ref.author || "Unknown Author")}</span>
      </div>`;
  },

  wrapHtml(inner, ref, options = {}) {
    const wrapClass = options.wrapClass || "book-cover-wrap";
    const imgClass = options.imgClass || "book-cover-img";
    const key = this.cacheKey(ref);
    const knownUrl = this.getKnownUrl(ref);
    return `<div class="${wrapClass} book-cover-wrap book-cover-wrapper"
      data-cover-key="${this.escape(key)}"
      data-title="${this.escape(ref.title)}"
      data-author="${this.escape(ref.author)}"
      data-genre="${this.escape(ref.genre || "Book")}"
      data-isbn="${this.escape(ref.isbn || "")}"
      data-img-class="${this.escape(imgClass)}"
      ${ref.library_id ? `data-library-id="${this.escape(ref.library_id)}"` : ""}
      ${knownUrl ? `data-cover-url="${this.escape(knownUrl)}"` : ""}>${inner}</div>`;
  },

  html(book, options = {}) {
    const ref = this.bookRef(book);
    const imgClass = options.imgClass || "book-cover-img";
    const knownUrl = this.getKnownUrl(ref);

    if (knownUrl) {
      const key = this.cacheKey(ref);
      if (!this._memoryCache.has(key)) {
        this._rememberSuccess(key, knownUrl, { persist: false, ref });
      }
      return this.wrapHtml(
        `<img class="${imgClass} book-cover-image" src="${this.escape(knownUrl)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async" onerror="BookCover.onError(this)">`,
        { ...ref, cover_url: knownUrl },
        options
      );
    }

    this._logMissingCover(book, ref, null, "no_known_url_at_render");
    return this.wrapHtml(this.placeholderHtml(ref, options), ref, options);
  },

  _markImageSuccess(img, wrap) {
    wrap.classList.add("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "true";
  },

  _activateImage(img, wrap, book) {
    if (!img || !wrap) return;

    const ref = this.refFromWrap(wrap);
    const src = normalizeCoverUrl(img.getAttribute("src") || img.dataset.coverSrc);
    if (!src) {
      this.renderPlaceholder(wrap, ref, { imgClass: wrap.dataset.imgClass });
      this._logMissingCover(book, ref, null, "activate_no_src");
      return;
    }

    img.dataset.coverSrc = src;
    if (!img.getAttribute("src")) img.setAttribute("src", src);

    const onSuccess = () => {
      this._markImageSuccess(img, wrap);
      this.debugCoverState(book || ref, src, { reason: "image_loaded" });
    };

    const onFail = () => {
      this.debugCoverState(book || ref, src, { reason: "image_error" });
      this.onError(img, book);
    };

    img.onload = onSuccess;
    img.onerror = onFail;
    img.classList.add("book-cover-image");

    // Root cause fix: cached images fire onload before handlers if src was set early.
    if (img.complete) {
      if (img.naturalWidth > 0) onSuccess();
      else onFail();
    }
  },

  renderPlaceholder(wrap, ref, options = {}) {
    if (!wrap) return;
    wrap.classList.remove("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "placeholder";
    wrap.innerHTML = this.placeholderHtml(ref, options);
    wrap.__bookRef = ref;
  },

  renderImage(wrap, ref, url, options = {}) {
    if (!wrap || !url) return;
    const imgClass = options.imgClass || wrap.dataset.imgClass || "book-cover-img";
    const normalized = normalizeCoverUrl(url);
    const key = this.cacheKey(ref);

    if (!normalized || this._isBrokenUrl(key, normalized)) {
      this.renderPlaceholder(wrap, ref, options);
      this._logMissingCover(ref, ref, normalized, "broken_or_invalid_url");
      return;
    }

    this._rememberSuccess(key, normalized, { ref });
    wrap.__bookRef = { ...ref, cover_url: normalized };
    wrap.dataset.coverUrl = normalized;
    wrap.dataset.title = ref.title || "";
    wrap.dataset.author = ref.author || "";

    wrap.innerHTML = `<img class="${imgClass} book-cover-image" src="${this.escape(normalized)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async">`;
    const img = wrap.querySelector("img");
    this._activateImage(img, wrap, ref);
  },

  onError(img, book) {
    const wrap = img?.closest("[data-cover-key]");
    if (!wrap) return;

    const ref = this.refFromWrap(wrap);
    const key = this.cacheKey(ref);
    const failedUrl = normalizeCoverUrl(img.getAttribute("src") || img.dataset.coverSrc);

    if (failedUrl) {
      this._rememberBrokenUrl(key, failedUrl);
      ref.cover_url = null;
      wrap.__bookRef = { ...ref, cover_url: null };
      delete wrap.dataset.coverUrl;
    }

    this.renderPlaceholder(wrap, ref);
    this._logMissingCover(book, ref, null, "onerror_retry_resolve");
    this._queueResolve(wrap);
  },

  applyUrlToWrap(wrap, ref, url, imgClass = "book-cover-img", options = {}) {
    this.renderImage(wrap, ref, url, { ...options, imgClass });
  },

  async _persistCoverUrl(ref, url) {
    const key = this.cacheKey(ref);
    if (this._persistedKeys.has(key)) return;
    this._persistedKeys.add(key);

    const normalized = normalizeCoverUrl(url);
    if (!normalized) return;

    if (ref.library_id && window.BookMindLibrary?._books) {
      const book = BookMindLibrary._books.find(item => item.library_id === ref.library_id);
      if (book) book.cover_url = normalized;
    }

    const headers = { "Content-Type": "application/json" };
    if (window.BookMindAuth?.getAuthHeaders) Object.assign(headers, BookMindAuth.getAuthHeaders());

    try {
      await fetch("/api/library/cover", {
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
    } catch {
      /* best-effort */
    }
  },

  _batchResolveBooks(books) {
    this._loadCaches();
    const missing = [];
    const refs = [];

    books.forEach(book => {
      const ref = this.bookRef(book);
      const known = this.getKnownUrl(ref);
      if (known) {
        ref.cover_url = known;
        return;
      }
      if (this._pending.has(this.cacheKey(ref))) return;
      if (refs.some(item => this.cacheKey(item) === this.cacheKey(ref))) return;

      missing.push({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        cover_url: null,
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
          const url = normalizeCoverUrl(result.cover_url);
          if (url && !this._isBrokenUrl(key, url)) {
            ref.cover_url = url;
            this._rememberSuccess(key, url, { ref });
            this.debugCoverState(ref, url, {
              reason: "api_resolved",
              source: result.cover_source || result.cover_debug?.final_source,
            });
          } else {
            this._logMissingCover(ref, ref, null, "api_no_cover");
          }
        });
        return refs;
      })
      .catch(err => {
        refs.forEach(ref => this._logMissingCover(ref, ref, null, `api_error:${err}`));
        return refs;
      })
      .finally(() => {
        this._pending.delete(signature);
        refs.forEach(ref => this._pending.delete(this.cacheKey(ref)));
      });

    refs.forEach(ref => this._pending.set(this.cacheKey(ref), promise));
    this._pending.set(signature, promise);
    return promise;
  },

  _queueResolve(wrap) {
    if (!wrap || wrap.dataset.coverLoading === "true") return;
    const ref = this.refFromWrap(wrap);
    const known = this.getKnownUrl(ref);
    if (known) {
      this.renderImage(wrap, ref, known, { imgClass: wrap.dataset.imgClass });
      return;
    }

    wrap.dataset.coverLoading = "true";
    this._batchResolveBooks([ref]).then(() => {
      if (!wrap.isConnected) return;
      const url = this.getKnownUrl(this.refFromWrap(wrap));
      wrap.dataset.coverLoading = "false";
      if (url) {
        this.renderImage(wrap, this.refFromWrap(wrap), url, { imgClass: wrap.dataset.imgClass });
      } else {
        this.renderPlaceholder(wrap, this.refFromWrap(wrap));
      }
    });
  },

  hydrateWrap(wrap, book, options = {}) {
    if (!wrap) return Promise.resolve(null);
    const ref = book ? this.bookRef(book) : this.refFromWrap(wrap);
    wrap.__bookRef = ref;

    const known = this.getKnownUrl(ref);
    if (known) {
      this.renderImage(wrap, ref, known, options);
      return Promise.resolve(known);
    }

    return this._batchResolveBooks([ref]).then(() => {
      const url = this.getKnownUrl(ref);
      if (url) {
        this.renderImage(wrap, ref, url, options);
        return url;
      }
      this.renderPlaceholder(wrap, ref, options);
      return null;
    });
  },

  hydrateLazy(root = document, options = {}) {
    this._loadCaches();
    root.querySelectorAll(".book-cover-wrap[data-cover-key]").forEach(wrap => {
      const ref = this.refFromWrap(wrap);
      wrap.__bookRef = ref;

      const img = wrap.querySelector("img");
      const known = this.getKnownUrl(ref);

      if (known) {
        if (!img || normalizeCoverUrl(img.getAttribute("src")) !== known) {
          this.renderImage(wrap, ref, known, options);
        } else {
          this._activateImage(img, wrap, ref);
        }
        return;
      }

      if (img) {
        this._activateImage(img, wrap, ref);
        return;
      }

      if (!wrap.querySelector("[data-cover-fallback]")) {
        this.renderPlaceholder(wrap, ref, options);
      }
      this._queueResolve(wrap);
    });
  },

  async hydrate(root = document, options = {}) {
    this.hydrateLazy(root, options);
  },

  async hydrateMany(books, root = document, options = {}) {
    this.seedFromBooks(books);
    await this.resolveMissing(books, root, options);
    return books;
  },

  async resolveMissing(books, root = document, options = {}) {
    await this._batchResolveBooks(books || []);

    (books || []).forEach(book => {
      const ref = this.bookRef(book);
      const url = this.getKnownUrl(ref);
      if (url) {
        book.cover_url = url;
        if (book.book_data && typeof book.book_data === "object") {
          book.book_data.cover_url = url;
        }
      }

      const key = this.cacheKey(ref);
      const wrap = [...root.querySelectorAll("[data-cover-key]")].find(el => el.dataset.coverKey === key);
      if (!wrap) return;
      if (url) this.renderImage(wrap, { ...ref, cover_url: url }, url, options);
      else this.renderPlaceholder(wrap, ref, options);
    });

    return books;
  },
};

const BookCover = {
  getBookCover,
  normalizeCoverUrl,

  html(bookOrProps, options = {}) {
    const props = bookOrProps || {};
    const book =
      props.title !== undefined && !props.ai_recommendation
        ? {
            title: props.title,
            author: props.author,
            cover_url: getBookCover(props),
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

  hydrateEager(books, root, options) {
    return BookMindCoverImage.resolveMissing(books, root, options);
  },

  resolveMissing(books, root, options) {
    return BookMindCoverImage.resolveMissing(books, root, options);
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

  debugCoverState(book, resolvedCover, extra) {
    return BookMindCoverImage.debugCoverState(book, resolvedCover, extra);
  },
};

window.BookMindCoverImage = BookMindCoverImage;
window.BookCover = BookCover;
