/** Centralized book cover rendering, lookup, and caching for BookMindAI. */

function isOpenLibraryUrl(url) {
  if (!url || typeof url !== "string") return false;
  const lowered = url.toLowerCase();
  return lowered.includes("openlibrary.org") || lowered.includes("archive.org");
}

function pickGoogleImageUrl(images) {
  if (!images || typeof images !== "object") return null;
  const raw =
    images.extraLarge ||
    images.large ||
    images.medium ||
    images.small ||
    images.thumbnail ||
    images.smallThumbnail ||
    null;
  return raw ? normalizeCoverUrl(raw) : null;
}

function logProviderAttempt(title, provider, url) {
  console.log("[BookCover provider attempt]", { title, provider, url });
}

function logProviderSuccess(title, provider, url) {
  console.log("[BookCover provider success]", { title, provider, url });
}

function logProviderFailed(title, provider, url, reason) {
  console.warn("[BookCover provider failed]", { title, provider, url, reason });
}

function stripCoverUrlFromBook(book, url) {
  const normalized = normalizeCoverUrl(url);
  if (!book || !normalized) return;

  if (normalizeCoverUrl(book.cover_url) === normalized) book.cover_url = null;
  if (normalizeCoverUrl(book.coverUrl) === normalized) book.coverUrl = null;
  if (book.book_data && normalizeCoverUrl(book.book_data.cover_url) === normalized) {
    book.book_data.cover_url = null;
  }
  if (book.ai_recommendation && normalizeCoverUrl(book.ai_recommendation.cover_url) === normalized) {
    book.ai_recommendation.cover_url = null;
  }
}

function applyCoverToBook(book, url, provider) {
  if (!book || typeof book !== "object" || !url) return book;

  const normalized = normalizeCoverUrl(url);
  if (!normalized) return book;

  book.cover_url = normalized;
  book.coverUrl = normalized;
  if (book.book_data && typeof book.book_data === "object") {
    book.book_data.cover_url = normalized;
  }
  if (book.ai_recommendation && typeof book.ai_recommendation === "object") {
    book.ai_recommendation.cover_url = normalized;
  }
  if (provider) {
    book.cover_source = provider;
  }

  logProviderSuccess(book.title || book.ai_recommendation?.title, provider || "saved", normalized);
  return book;
}

function usableCoverUrl(url) {
  const normalized = normalizeCoverUrl(url);
  if (!normalized) return null;
  if (isBrokenUrl(normalized)) return null;
  return normalized;
}

function getBookCover(book) {
  if (!book || typeof book !== "object") return null;
  const ai = book.ai_recommendation || {};
  const bookData = book.book_data || {};
  const images = book.volumeInfo?.imageLinks || book.volume_info?.imageLinks || {};
  const googleUrl = pickGoogleImageUrl(images);

  return (
    book.cover_url ||
    book.coverUrl ||
    book.image ||
    book.thumbnail ||
    bookData.cover_url ||
    bookData.coverUrl ||
    ai.cover_url ||
    ai.coverUrl ||
    googleUrl ||
    images.thumbnail ||
    images.smallThumbnail ||
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

const BROKEN_CACHE_KEY = "bookmind_cover_broken_v6";
const BROKEN_TTL = 24 * 60 * 60 * 1000;
const BROKEN_MIGRATION_KEY = "bookmind_cover_broken_migrated_v6";

function getBrokenCache() {
  try {
    const raw = localStorage.getItem(BROKEN_CACHE_KEY) || sessionStorage.getItem(BROKEN_CACHE_KEY);
    const cache = JSON.parse(raw || "{}");
    return cache && typeof cache === "object" ? cache : {};
  } catch {
    return {};
  }
}

function saveBrokenCache(cache) {
  try {
    const payload = JSON.stringify(cache);
    localStorage.setItem(BROKEN_CACHE_KEY, payload);
    sessionStorage.setItem(BROKEN_CACHE_KEY, payload);
  } catch {
    /* quota */
  }
}

function isBrokenUrl(url) {
  const normalized = normalizeCoverUrl(url);
  if (!normalized) return false;

  const cache = getBrokenCache();
  const failedAt = cache[normalized];
  if (!failedAt) return false;

  if (Date.now() - failedAt > BROKEN_TTL) {
    delete cache[normalized];
    saveBrokenCache(cache);
    return false;
  }

  return true;
}

function markBrokenUrl(url) {
  const normalized = normalizeCoverUrl(url);
  if (!normalized) return;

  const cache = getBrokenCache();
  cache[normalized] = Date.now();
  saveBrokenCache(cache);
  console.log("[BookCover cache add]", normalized);
}

function clearBrokenUrl(url) {
  const normalized = normalizeCoverUrl(url);
  if (!normalized) return;

  const cache = getBrokenCache();
  if (!cache[normalized]) return;

  delete cache[normalized];
  saveBrokenCache(cache);
  console.log("[BookCover cache remove]", normalized);
}

function migrateBrokenCache() {
  if (localStorage.getItem(BROKEN_MIGRATION_KEY)) return;
  localStorage.removeItem("bookmind_cover_broken_v5");
  sessionStorage.removeItem("bookmind_cover_broken_v5");
  localStorage.setItem(BROKEN_MIGRATION_KEY, "1");
}

migrateBrokenCache();

const BookMindCoverService = {
  _bookRegistry: new Map(),

  registerBook(book) {
    if (!book || typeof book !== "object") return book;
    const ref = BookMindCoverImage.bookRef(book);
    const key = BookMindCoverImage.cacheKey(ref);
    this._bookRegistry.set(key, book);
    return book;
  },

  getBook(refOrBook) {
    if (!refOrBook) return null;
    const ref = BookMindCoverImage.bookRef(refOrBook);
    const key = BookMindCoverImage.cacheKey(ref);
    return this._bookRegistry.get(key) || refOrBook;
  },

  providerFromUrl(url, coverSource) {
    if (coverSource) return coverSource;
    if (!url) return "placeholder";
    if (isOpenLibraryUrl(url)) return "open_library";
    if (url.includes("books.google") || url.includes("googleusercontent.com")) return "google_books";
    return "saved";
  },

  localUrl(book) {
    return BookMindCoverImage.getKnownUrl(book);
  },

  async resolve(book) {
    this.registerBook(book);
    const ref = BookMindCoverImage.bookRef(book);
    const title = ref.title;

    const existing = this.localUrl(book);
    if (existing) {
      const provider = this.providerFromUrl(existing, book.cover_source);
      logProviderAttempt(title, provider, existing);
      applyCoverToBook(book, existing, provider);
      return { url: existing, provider, book, placeholder: false };
    }

    logProviderAttempt(title, "api_resolve", null);
    await BookMindCoverImage._batchResolveBooks([book]);

    const resolved = this.localUrl(book) || normalizeCoverUrl(book.cover_url);
    if (resolved) {
      const provider = this.providerFromUrl(resolved, book.cover_source);
      applyCoverToBook(book, resolved, provider);
      return { url: resolved, provider, book, placeholder: false };
    }

    logProviderFailed(title, "all", null, "no_cover_found");
    return { url: null, provider: "placeholder", book, placeholder: true };
  },

  async resolveMany(books, root = document, options = {}) {
    return BookMindCoverImage.resolveMissing(books, root, options);
  },
};

const BookMindCoverImage = {
  _memoryCache: new Map(),
  _pending: new Map(),
  _batchTimer: null,
  _persistTimer: null,
  _persistedKeys: new Set(),
  _storageKey: "bookmind_cover_cache_v5",

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
    } catch {
      /* ignore */
    }
  },

  _persistCaches() {
    try {
      const payload = JSON.stringify(Object.fromEntries(this._memoryCache));
      localStorage.setItem(this._storageKey, payload);
      sessionStorage.setItem(this._storageKey, payload);
    } catch {
      /* quota */
    }
  },

  _schedulePersist() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this._persistCaches(), 400);
  },

  _rememberBrokenUrl(key, url) {
    const normalized = normalizeCoverUrl(url);
    if (!normalized) return;
    markBrokenUrl(normalized);
    if (this._memoryCache.get(key) === normalized) {
      this._memoryCache.delete(key);
      this._schedulePersist();
    }
  },

  _isBrokenUrl(key, url) {
    return isBrokenUrl(url);
  },

  _isRealCover(img) {
    return Boolean(img && img.naturalWidth >= 40 && img.naturalHeight >= 60);
  },

  _getSourceBook(wrap, ref, fallback) {
    if (wrap?.__sourceBook) return wrap.__sourceBook;
    const registered = BookMindCoverService.getBook(ref);
    if (registered && registered !== ref) return registered;
    return fallback || registered || ref;
  },

  _linkWrapToBook(wrap, book) {
    if (!wrap || !book) return;
    wrap.__sourceBook = book;
    BookMindCoverService.registerBook(book);
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
      BookMindCoverService.registerBook(book);
      const ref = this.bookRef(book);
      const url = normalizeCoverUrl(ref.cover_url);
      if (!url) return;
      const key = this.cacheKey(ref);
      if (!this._memoryCache.has(key)) {
        this._rememberSuccess(key, url, { persist: false });
      }
    });
  },

  _logPipeline(book, ref, stage, extra = {}) {
    const subject = book || ref || {};
    const rawCover = getBookCover(subject);
    const normalizedRaw = normalizeCoverUrl(rawCover);
    const candidateUrl = extra.candidateUrl ?? extra.url ?? normalizedRaw ?? null;
    const blocked =
      candidateUrl && ref
        ? this._isBrokenUrl(this.cacheKey(ref), candidateUrl)
        : extra.blocked ?? null;

    console.group(`[BookCover] ${subject.title || ref?.title || "Unknown title"} — ${stage}`);
    console.log("raw book:", subject);
    console.log("raw cover_url:", rawCover);
    console.log("normalized raw:", normalizedRaw);
    console.log("known URL:", extra.knownUrl ?? null);
    console.log("is cached broken:", blocked);
    console.log("final candidate URL:", candidateUrl);
    console.log("render path:", extra.renderPath || "unknown");
    if (Object.keys(extra).length) console.log("extra:", extra);
    console.groupEnd();
  },

  getKnownUrl(book) {
    const images = book?.volumeInfo?.imageLinks || book?.volume_info?.imageLinks || {};
    const bookData = book?.book_data || {};
    const ai = book?.ai_recommendation || {};
    const googleUrl = pickGoogleImageUrl(images);

    const fieldCandidates = [
      book?.cover_url,
      book?.coverUrl,
      book?.image,
      book?.thumbnail,
      bookData?.cover_url,
      bookData?.coverUrl,
      ai?.cover_url,
      ai?.coverUrl,
      googleUrl,
    ];

    for (const raw of fieldCandidates) {
      const normalized = usableCoverUrl(raw);
      if (normalized && !isOpenLibraryUrl(normalized)) {
        logProviderAttempt(book?.title, BookMindCoverService.providerFromUrl(normalized), normalized);
        return normalized;
      }
    }

    this._loadCaches();
    const ref = this.bookRef(book || {});
    const key = this.cacheKey(ref);
    const cached = this._memoryCache.get(key);
    if (cached) {
      const normalized = usableCoverUrl(cached);
      if (normalized && !isOpenLibraryUrl(normalized)) {
        logProviderAttempt(book?.title, "memory_cache", normalized);
        return normalized;
      }
    }

    for (const raw of fieldCandidates) {
      const normalized = usableCoverUrl(raw);
      if (normalized && isOpenLibraryUrl(normalized)) {
        logProviderAttempt(book?.title, "open_library", normalized);
        return normalized;
      }
    }

    if (cached) {
      const normalized = usableCoverUrl(cached);
      if (normalized && isOpenLibraryUrl(normalized)) {
        logProviderAttempt(book?.title, "open_library_cache", normalized);
        return normalized;
      }
    }

    logProviderFailed(
      book?.title,
      "local",
      book?.cover_url ?? null,
      book?.cover_url ? "broken_or_open_library_blocked" : "missing_cover_url"
    );
    return null;
  },

  _rememberSuccess(key, url, options = {}) {
    const { persist = true, ref = null } = options;
    const normalized = normalizeCoverUrl(url);
    if (!normalized) return;
    clearBrokenUrl(normalized);
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

  renderResolving(wrap, ref, options = {}) {
    if (!wrap) return;
    wrap.classList.remove("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "resolving";
    wrap.innerHTML = `
      <div class="book-cover-resolving book-cover-placeholder" data-cover-resolving="true" role="status" aria-busy="true" aria-label="Resolving cover for ${this.escape(ref.title)}">
        <strong class="book-cover-title">${this.escape(ref.title || "Untitled Book")}</strong>
        <span class="book-cover-author">${this.escape(ref.author || "Unknown Author")}</span>
      </div>`;
    wrap.__bookRef = ref;
  },

  html(book, options = {}) {
    BookMindCoverService.registerBook(book);
    const ref = this.bookRef(book);
    const imgClass = options.imgClass || "book-cover-img";
    const knownUrl = this.getKnownUrl(book);

    if (knownUrl) {
      const key = this.cacheKey(ref);
      applyCoverToBook(book, knownUrl, BookMindCoverService.providerFromUrl(knownUrl, book.cover_source));
      if (!this._memoryCache.has(key)) {
        this._rememberSuccess(key, knownUrl, { persist: false, ref });
      }
      this._logPipeline(book, ref, "html", {
        candidateUrl: knownUrl,
        renderPath: "image",
      });
      return this.wrapHtml(
        `<img class="${imgClass} book-cover-image" src="${this.escape(knownUrl)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async" onerror="BookCover.onError(this)">`,
        { ...ref, cover_url: knownUrl },
        options
      );
    }

    this._logPipeline(book, ref, "html", {
      candidateUrl: null,
      renderPath: "placeholder",
    });
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
      console.log("[BookCover load]", {
        url: src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        currentSrc: img.currentSrc,
        complete: img.complete,
      });

      if (!this._isRealCover(img)) {
        markBrokenUrl(src);
        const key = this.cacheKey(ref);
        if (this._memoryCache.get(key) === src) {
          this._memoryCache.delete(key);
          this._schedulePersist();
        }
        const sourceBook = this._getSourceBook(wrap, ref, book);
        stripCoverUrlFromBook(sourceBook, src);
        logProviderFailed(sourceBook?.title || ref.title, BookMindCoverService.providerFromUrl(src), src, "tiny_placeholder_image");
        ref.cover_url = null;
        wrap.__bookRef = { ...ref, cover_url: null };
        delete wrap.dataset.coverUrl;
        this._logPipeline(sourceBook || ref, ref, "_activateImage", {
          candidateUrl: src,
          renderPath: "resolving",
          reason: "tiny_placeholder_image",
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
        this._retryAfterProviderFailure(wrap, sourceBook, ref);
        return;
      }

      clearBrokenUrl(src);
      this._markImageSuccess(img, wrap);
      const sourceBook = this._getSourceBook(wrap, ref, book);
      applyCoverToBook(sourceBook, src, BookMindCoverService.providerFromUrl(src));
      this._rememberSuccess(this.cacheKey(ref), src, { ref, persist: true });
      this._logPipeline(book || ref, ref, "_activateImage", {
        candidateUrl: src,
        renderPath: "image",
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
      this.debugCoverState(book || ref, src, { reason: "image_loaded" });
    };

    const onFail = (error) => {
      console.error("[BookCover error]", {
        url: src,
        error,
        currentSrc: img.currentSrc,
      });
      this.debugCoverState(book || ref, src, { reason: "image_error" });
      this.onError(img, book);
    };

    img.onload = onSuccess;
    img.onerror = onFail;
    img.classList.add("book-cover-image");

    // Cached images may be complete before handlers attach; only act when dimensions are known.
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      onSuccess();
    }
  },

  renderPlaceholder(wrap, ref, options = {}) {
    if (!wrap) return;
    this._logPipeline(ref, ref, "renderPlaceholder", {
      candidateUrl: null,
      renderPath: "placeholder",
      previousResolved: wrap.dataset.coverResolved,
    });
    wrap.classList.remove("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "placeholder";
    wrap.innerHTML = this.placeholderHtml(ref, options);
    wrap.__bookRef = ref;
  },

  renderImage(wrap, ref, url, options = {}) {
    if (!wrap || !url) {
      if (wrap) this.renderPlaceholder(wrap, ref, options);
      return;
    }
    const imgClass = options.imgClass || wrap.dataset.imgClass || "book-cover-img";
    const normalized = normalizeCoverUrl(url);
    const key = this.cacheKey(ref);
    const sourceBook = options.book || this._getSourceBook(wrap, ref);

    if (!normalized) {
      this._logPipeline(ref, ref, "renderImage", {
        candidateUrl: normalized,
        renderPath: "placeholder",
        reason: "broken_or_invalid_url",
      });
      this.renderPlaceholder(wrap, ref, options);
      this._logMissingCover(sourceBook, ref, normalized, "broken_or_invalid_url");
      return;
    }

    this._logPipeline(sourceBook || ref, ref, "renderImage", {
      candidateUrl: normalized,
      renderPath: "image",
      inputUrl: url,
    });
    applyCoverToBook(sourceBook, normalized, BookMindCoverService.providerFromUrl(normalized, sourceBook?.cover_source));
    this._linkWrapToBook(wrap, sourceBook);
    this._rememberSuccess(key, normalized, { ref });
    wrap.__bookRef = { ...this.bookRef(sourceBook), cover_url: normalized };
    wrap.dataset.coverUrl = normalized;
    wrap.dataset.title = ref.title || "";
    wrap.dataset.author = ref.author || "";

    wrap.innerHTML = `<img class="${imgClass} book-cover-image" src="${this.escape(normalized)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async" onerror="BookCover.onError(this)">`;
    const img = wrap.querySelector("img");
    this._activateImage(img, wrap, sourceBook);
  },

  _retryAfterProviderFailure(wrap, book, ref) {
    if (!wrap || wrap.dataset.coverLoading === "true") return;
    wrap.dataset.coverLoading = "true";
    this.renderResolving(wrap, ref, { imgClass: wrap.dataset.imgClass });
    BookMindCoverService.resolve(book).then(result => {
      if (!wrap.isConnected) return;
      wrap.dataset.coverLoading = "false";
      const resolvedBook = result.book || book;
      this._linkWrapToBook(wrap, resolvedBook);
      if (result.url) {
        this.renderImage(wrap, this.bookRef(resolvedBook), result.url, {
          imgClass: wrap.dataset.imgClass,
          book: resolvedBook,
        });
      } else {
        this.renderPlaceholder(wrap, this.bookRef(resolvedBook), { imgClass: wrap.dataset.imgClass });
      }
    });
  },

  onError(img, book) {
    const wrap = img?.closest("[data-cover-key]");
    if (!wrap) return;

    const ref = this.refFromWrap(wrap);
    const sourceBook = this._getSourceBook(wrap, ref, book);
    const key = this.cacheKey(ref);
    const failedUrl = normalizeCoverUrl(img.getAttribute("src") || img.dataset.coverSrc);

    if (failedUrl) {
      markBrokenUrl(failedUrl);
      if (this._memoryCache.get(key) === failedUrl) {
        this._memoryCache.delete(key);
        this._schedulePersist();
      }
      stripCoverUrlFromBook(sourceBook, failedUrl);
      logProviderFailed(
        sourceBook?.title || ref.title,
        isOpenLibraryUrl(failedUrl) ? "open_library" : BookMindCoverService.providerFromUrl(failedUrl),
        failedUrl,
        "network_or_load_error"
      );
      ref.cover_url = null;
      wrap.__bookRef = { ...this.bookRef(sourceBook), cover_url: null };
      delete wrap.dataset.coverUrl;
    }

    this._logMissingCover(sourceBook, ref, null, failedUrl && isOpenLibraryUrl(failedUrl)
      ? "open_library_network_error_retry_google"
      : "onerror_retry_resolve");
    this._retryAfterProviderFailure(wrap, sourceBook, ref);
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

    const sourceBook = BookMindCoverService.getBook(ref);
    if (sourceBook) {
      applyCoverToBook(sourceBook, normalized, BookMindCoverService.providerFromUrl(normalized, sourceBook.cover_source));
    }

    if (ref.library_id && window.BookMindLibrary?._books) {
      const book = BookMindLibrary._books.find(item => item.library_id === ref.library_id);
      if (book) applyCoverToBook(book, normalized, BookMindCoverService.providerFromUrl(normalized, book.cover_source));
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
    const sourceBooks = [];

    books.forEach(book => {
      BookMindCoverService.registerBook(book);
      const ref = this.bookRef(book);
      const known = this.getKnownUrl(book);
      if (known) {
        applyCoverToBook(book, known, BookMindCoverService.providerFromUrl(known, book.cover_source));
        return;
      }
      if (this._pending.has(this.cacheKey(ref))) return;
      if (refs.some(item => this.cacheKey(item) === this.cacheKey(ref))) return;

      const rawCover = getBookCover(book) || null;
      const normalizedCover = normalizeCoverUrl(rawCover);
      const coverForApi = isOpenLibraryUrl(normalizedCover) ? null : normalizedCover;

      logProviderAttempt(ref.title, "api_resolve", coverForApi);
      missing.push({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        cover_url: coverForApi,
        google_id: ref.google_id,
        open_library_key: ref.open_library_key,
      });
      refs.push(ref);
      sourceBooks.push(book);
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
          const source = sourceBooks[index];
          const key = this.cacheKey(ref);
          const url = normalizeCoverUrl(result.cover_url);
          if (url) {
            const provider = result.cover_source || BookMindCoverService.providerFromUrl(url);
            applyCoverToBook(source, url, provider);
            this._rememberSuccess(key, url, { ref });
            this.debugCoverState(source, url, {
              reason: "api_resolved",
              source: provider,
            });
          } else {
            logProviderFailed(source?.title || ref.title, "api_resolve", null, "api_no_cover");
            this._logMissingCover(source, ref, null, "api_no_cover");
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
    const book = this._getSourceBook(wrap, ref);
    const known = this.getKnownUrl(book);
    if (known) {
      this.renderImage(wrap, this.bookRef(book), known, { imgClass: wrap.dataset.imgClass, book });
      return;
    }

    this._retryAfterProviderFailure(wrap, book, ref);
  },

  hydrateWrap(wrap, book, options = {}) {
    if (!wrap) return Promise.resolve(null);
    BookMindCoverService.registerBook(book);
    this._linkWrapToBook(wrap, book);
    const ref = book ? this.bookRef(book) : this.refFromWrap(wrap);
    wrap.__bookRef = ref;

    return BookMindCoverService.resolve(book || ref).then(result => {
      const resolvedBook = result.book || book || ref;
      this._linkWrapToBook(wrap, resolvedBook);
      if (result.url) {
        this.renderImage(wrap, this.bookRef(resolvedBook), result.url, options);
        return result.url;
      }
      this.renderPlaceholder(wrap, this.bookRef(resolvedBook), options);
      return null;
    });
  },

  hydrateLazy(root = document, options = {}) {
    this._loadCaches();
    root.querySelectorAll(".book-cover-wrap[data-cover-key]").forEach(wrap => {
      const ref = this.refFromWrap(wrap);
      const book = this._getSourceBook(wrap, ref);
      wrap.__bookRef = this.bookRef(book);

      const img = wrap.querySelector("img");
      const known = this.getKnownUrl(book);

      if (known) {
        if (!img || normalizeCoverUrl(img.getAttribute("src")) !== known) {
          this.renderImage(wrap, this.bookRef(book), known, { ...options, book });
        } else {
          this._activateImage(img, wrap, book);
        }
        return;
      }

      if (img) {
        const src = normalizeCoverUrl(img.getAttribute("src") || img.dataset.coverSrc);
        if (src && isBrokenUrl(src)) {
          stripCoverUrlFromBook(book, src);
          wrap.__bookRef = { ...this.bookRef(book), cover_url: null };
          delete wrap.dataset.coverUrl;
          this._retryAfterProviderFailure(wrap, book, ref);
          return;
        }
        this._activateImage(img, wrap, book);
        return;
      }

      if (!wrap.querySelector("[data-cover-fallback]") && wrap.dataset.coverResolved !== "resolving") {
        this.renderPlaceholder(wrap, this.bookRef(book), options);
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
    this._logPipeline({ title: `batch(${books?.length || 0})` }, null, "resolveMissing:start", {
      bookTitles: (books || []).map(b => b?.title),
    });
    await this._batchResolveBooks(books || []);

    (books || []).forEach(book => {
      BookMindCoverService.registerBook(book);
      const ref = this.bookRef(book);
      const url = this.getKnownUrl(book);
      if (url) {
        applyCoverToBook(book, url, BookMindCoverService.providerFromUrl(url, book.cover_source));
      }

      const key = this.cacheKey(ref);
      const wrap = [...root.querySelectorAll("[data-cover-key]")].find(el => el.dataset.coverKey === key);
      if (!wrap) {
        this._logPipeline(book, ref, "resolveMissing", {
          candidateUrl: url,
          renderPath: "no_wrap",
        });
        return;
      }
      this._linkWrapToBook(wrap, book);
      this._logPipeline(book, ref, "resolveMissing", {
        candidateUrl: url,
        renderPath: url ? "image" : "placeholder",
        wrapResolved: wrap.dataset.coverResolved,
      });
      if (url) this.renderImage(wrap, this.bookRef(book), url, { ...options, book });
      else this.renderPlaceholder(wrap, this.bookRef(book), options);
    });

    return books;
  },
};

const BookCover = {
  getBookCover,
  normalizeCoverUrl,
  isOpenLibraryUrl,
  applyCoverToBook,

  resolve(book) {
    return BookMindCoverService.resolve(book);
  },

  resolveMany(books, root, options) {
    return BookMindCoverService.resolveMany(books, root, options);
  },

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
window.BookMindCoverService = BookMindCoverService;
window.BookCover = BookCover;
