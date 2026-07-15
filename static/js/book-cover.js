/** Lexo centralized cover component — hosted Supabase URLs only. */

const HOSTED_COVER_MARKER = "/storage/v1/object/public/book-covers/";
const COVER_RESOLVE_STALE_MS = 30000;

function normalizeCoverUrlFromBook(book) {
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
}

function getFinalCoverUrl(book) {
  return normalizeCoverUrlFromBook(book);
}

function isHostedCoverUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.includes(HOSTED_COVER_MARKER);
}

function isOpenLibraryUrl(url) {
  if (!url || typeof url !== "string") return false;
  const lowered = url.toLowerCase();
  return lowered.includes("openlibrary.org") || lowered.includes("archive.org");
}

function isExternalCoverUrl(url) {
  if (!url || typeof url !== "string") return false;
  return isOpenLibraryUrl(url) || url.includes("books.google") || url.includes("googleusercontent.com");
}

function applyCoverToBook(book, url, meta = {}) {
  if (!book || typeof book !== "object" || !url) return book;
  book.cover_url = url;
  book.coverUrl = url;
  book.cover_status = meta.cover_status || "ready";
  if (meta.cover_source) book.cover_source = meta.cover_source;
  if (book.book_data && typeof book.book_data === "object") {
    book.book_data.cover_url = url;
    book.book_data.cover_status = book.cover_status;
  }
  if (book.ai_recommendation && typeof book.ai_recommendation === "object") {
    book.ai_recommendation.cover_url = url;
    book.ai_recommendation.cover_status = book.cover_status;
  }
  return book;
}

function stripExternalCoverFromBook(book) {
  if (!book || typeof book !== "object") return;
  const raw = normalizeCoverUrlFromBook(book);
  if (raw) book._sourceCoverUrl = raw;

  const hosted = isHostedCoverUrl(raw) ? raw : isHostedCoverUrl(book.cover_url) ? book.cover_url : null;
  if (hosted) {
    book.cover_url = hosted;
    book.coverUrl = hosted;
    return;
  }

  if (book.cover_url && !isHostedCoverUrl(book.cover_url)) {
    book.cover_url = null;
    book.coverUrl = null;
  }
  if (book.book_data && book.book_data.cover_url && !isHostedCoverUrl(book.book_data.cover_url)) {
    book.book_data.cover_url = null;
  }
  if (book.ai_recommendation && book.ai_recommendation.cover_url && !isHostedCoverUrl(book.ai_recommendation.cover_url)) {
    book.ai_recommendation.cover_url = null;
  }
}

const COVER_BATCH_SIZE = 8;

const LexoCoverQueue = {
  _books: new Map(),
  _roots: new Map(),
  _options: {},
  _scheduled: false,
  _flushing: false,

  enqueue(books, root = document, options = {}) {
    (books || []).forEach(book => {
      LexoCoverService.registerBook(book);
      const ref = LexoCoverImage.bookRef(book);
      if (LexoCoverImage.getKnownUrl(book)) return;
      if (!LexoCoverImage._shouldAttemptResolve(book)) return;
      const key = LexoCoverImage.cacheKey(ref);
      this._books.set(key, book);
      this._roots.set(key, root);
      this._options = { ...this._options, ...options };
    });
    this._schedule();
  },

  _schedule() {
    if (this._scheduled || this._flushing) return;
    this._scheduled = true;
    const run = () => {
      this._scheduled = false;
      this._flush();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 1500);
    }
  },

  async _flush() {
    if (this._flushing || !this._books.size) return;
    this._flushing = true;

    const entries = [...this._books.entries()];
    this._books.clear();

    for (let i = 0; i < entries.length; i += COVER_BATCH_SIZE) {
      const chunk = entries.slice(i, i + COVER_BATCH_SIZE);
      const books = chunk.map(([, book]) => book);
      await LexoCoverImage._batchResolveBooks(books);
      chunk.forEach(([key, book]) => {
        const root = this._roots.get(key) || document;
        LexoCoverImage._renderBookCover(book, root, this._options);
      });
    }

    this._flushing = false;
    if (this._books.size) {
      this._schedule();
    } else {
      window.LexoPerf?.endCoversLoad?.();
    }
  },
};

const LexoCoverService = {
  _bookRegistry: new Map(),
  _pending: new Map(),

  registerBook(book) {
    if (!book || typeof book !== "object") return book;
    const ref = LexoCoverImage.bookRef(book);
    stripExternalCoverFromBook(book);
    this._bookRegistry.set(LexoCoverImage.cacheKey(ref), book);
    return book;
  },

  getBook(refOrBook) {
    if (!refOrBook) return null;
    const ref = LexoCoverImage.bookRef(refOrBook);
    return this._bookRegistry.get(LexoCoverImage.cacheKey(ref)) || refOrBook;
  },

  localUrl(book) {
    const url = getFinalCoverUrl(book);
    return isHostedCoverUrl(url) ? url : null;
  },

  async resolve(book) {
    this.registerBook(book);
    const existing = this.localUrl(book);
    if (existing) {
      applyCoverToBook(book, existing, { cover_status: book.cover_status || "ready", cover_source: book.cover_source });
      return { url: existing, book, cover_status: "ready", placeholder: false };
    }

    const ref = LexoCoverImage.bookRef(book);
    const key = LexoCoverImage.cacheKey(ref);
    if (this._pending.has(key)) return this._pending.get(key);

    const payload = {
      title: ref.title,
      author: ref.author,
      isbn: ref.isbn,
      bookId: key.includes("|") ? null : ref.isbn ? `isbn:${String(ref.isbn).replace(/[^0-9Xx]/g, "").toLowerCase()}` : null,
      google_id: ref.google_id,
      open_library_key: ref.open_library_key,
    };

    const promise = fetch("/api/books/resolve-cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        bookId: LexoCoverImage.cacheKey(ref),
        google_id: ref.google_id,
        open_library_key: ref.open_library_key,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(result => {
        const url = result?.cover_url;
        if (url && isHostedCoverUrl(url)) {
          applyCoverToBook(book, url, {
            cover_status: result.cover_status || "ready",
            cover_source: result.cover_source,
          });
          return { url, book, cover_status: result.cover_status || "ready", placeholder: false };
        }
        return { url: null, book, cover_status: result?.cover_status || "failed", placeholder: true };
      })
      .catch(() => ({ url: null, book, cover_status: "failed", placeholder: true }))
      .finally(() => this._pending.delete(key));

    this._pending.set(key, promise);
    return promise;
  },

  async resolveMany(books, root = document, options = {}) {
    return LexoCoverImage.resolveMissing(books, root, options);
  },
};

const LexoCoverImage = {
  _pendingBatch: new Map(),

  isMissingCoverUrl(url) {
    if (url == null) return true;
    const value = String(url).trim();
    if (!value) return true;
    return ["null", "undefined", "none", "n/a", "false", "0"].includes(value.toLowerCase());
  },

  bookRef(book) {
    const ai = book?.ai_recommendation || {};
    return {
      title: book?.title || ai.title || "Untitled Book",
      author: book?.author || ai.author || "Unknown Author",
      genre: book?.genre || ai.genre || (book?.categories && book.categories[0]) || "Book",
      isbn: book?.isbn || book?.metadata?.isbn || book?.book_data?.isbn || null,
      cover_url: LexoCoverService.localUrl(book),
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
      cover_url: isHostedCoverUrl(wrap.dataset.coverUrl) ? wrap.dataset.coverUrl : null,
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

  escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  getKnownUrl(book) {
    return LexoCoverService.localUrl(book);
  },

  _shouldAttemptResolve(book) {
    if (this.getKnownUrl(book)) return false;
    const status = (book?.cover_status || "").toLowerCase();
    if (status === "failed") return !book._coverRetried;
    if (status === "resolving") {
      const started = book._resolveStartedAt || 0;
      return !started || Date.now() - started > COVER_RESOLVE_STALE_MS;
    }
    return true;
  },

  _isResolveStale(book) {
    const status = (book?.cover_status || "").toLowerCase();
    if (status !== "resolving") return false;
    const started = book._resolveStartedAt || 0;
    return started && Date.now() - started > COVER_RESOLVE_STALE_MS;
  },

  placeholderHtml(ref, options = {}) {
    const phClass = options.placeholderClass || "book-cover-placeholder";
    const resolving = options.resolving ? " book-cover-resolving" : "";
    const unavailable = options.unavailable ? " book-cover-unavailable" : "";
    return `
      <div class="${phClass} book-cover-placeholder${resolving}${unavailable}" data-cover-fallback="true" role="img" aria-label="${this.escape(ref.title)} cover">
        <strong class="book-cover-title">${this.escape(ref.title || "Untitled Book")}</strong>
        <span class="book-cover-author">${this.escape(ref.author || "Unknown Author")}</span>
      </div>`;
  },

  wrapHtml(inner, ref, options = {}) {
    const wrapClass = options.wrapClass || "book-cover-wrap";
    const knownUrl = isHostedCoverUrl(ref.cover_url) ? ref.cover_url : "";
    return `<div class="${wrapClass} book-cover-wrap book-cover-wrapper"
      data-cover-key="${this.escape(this.cacheKey(ref))}"
      data-title="${this.escape(ref.title)}"
      data-author="${this.escape(ref.author)}"
      data-genre="${this.escape(ref.genre || "Book")}"
      data-isbn="${this.escape(ref.isbn || "")}"
      data-img-class="${this.escape(options.imgClass || "book-cover-img")}"
      ${ref.library_id ? `data-library-id="${this.escape(ref.library_id)}"` : ""}
      ${knownUrl ? `data-cover-url="${this.escape(knownUrl)}"` : ""}
      data-cover-status="${knownUrl ? "ready" : "missing"}">${inner}</div>`;
  },

  html(book, options = {}) {
    LexoCoverService.registerBook(book);
    const ref = this.bookRef(book);
    const imgClass = options.imgClass || "book-cover-img";
    const knownUrl = this.getKnownUrl(book);
    const rawCover = getFinalCoverUrl(book);

    if (typeof console !== "undefined" && console.info) {
      console.info("[CoverDebug] render", {
        title: ref.title,
        cover_url: book.cover_url ?? null,
        rawCover,
        finalCover: knownUrl,
        cover_status: book.cover_status || null,
        reason: knownUrl ? "hosted_url" : rawCover ? "external_pending_resolve" : "no_known_url_at_render",
      });
    }

    if (knownUrl) {
      return this.wrapHtml(
        `<img class="${imgClass} book-cover-image" src="${this.escape(knownUrl)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async" onerror="BookCover.onError(this)">`,
        { ...ref, cover_url: knownUrl },
        options
      );
    }

    return this.wrapHtml(this.placeholderHtml(ref, options), ref, options);
  },

  renderUnavailable(wrap, ref, options = {}) {
    if (!wrap) return;
    wrap.classList.remove("cover-has-image", "cover-loaded", "book-cover-resolving");
    wrap.dataset.coverResolved = "unavailable";
    wrap.dataset.coverStatus = "failed";
    wrap.innerHTML = this.placeholderHtml(ref, { ...options, unavailable: true });
    wrap.__bookRef = ref;
  },

  renderPlaceholder(wrap, ref, options = {}) {
    if (!wrap) return;
    wrap.classList.remove("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "placeholder";
    wrap.dataset.coverStatus = "missing";
    wrap.innerHTML = this.placeholderHtml(ref, options);
    wrap.__bookRef = ref;
  },

  renderResolving(wrap, ref, options = {}) {
    if (!wrap) return;
    wrap.classList.remove("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "resolving";
    wrap.dataset.coverStatus = "resolving";
    wrap.innerHTML = this.placeholderHtml(ref, { ...options, resolving: true });
    wrap.__bookRef = ref;
  },

  renderImage(wrap, ref, url, options = {}) {
    if (!wrap || !url || !isHostedCoverUrl(url)) {
      if (wrap) this.renderPlaceholder(wrap, ref, options);
      return;
    }
    const imgClass = options.imgClass || wrap.dataset.imgClass || "book-cover-img";
    const sourceBook = options.book || wrap.__sourceBook || ref;
    applyCoverToBook(sourceBook, url, { cover_status: "ready", cover_source: sourceBook.cover_source });
    wrap.__sourceBook = sourceBook;
    wrap.__bookRef = { ...this.bookRef(sourceBook), cover_url: url };
    wrap.dataset.coverUrl = url;
    wrap.dataset.coverStatus = "ready";
    wrap.dataset.title = ref.title || "";
    wrap.dataset.author = ref.author || "";
    const lazyAttrs =
      options.lazy === false
        ? 'loading="eager" fetchpriority="high"'
        : 'loading="lazy" decoding="async"';
    wrap.innerHTML = `<img class="${imgClass} book-cover-image" src="${this.escape(url)}" alt="${this.escape(ref.title)} cover" ${lazyAttrs} onerror="BookCover.onError(this)">`;
    wrap.classList.add("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "true";
    this._persistCoverUrl(this.bookRef(sourceBook), url);
  },

  onError(img) {
    const wrap = img?.closest("[data-cover-key]");
    if (!wrap || wrap.dataset.coverLoading === "true") return;
    const book = wrap.__sourceBook || LexoCoverService.getBook(this.refFromWrap(wrap));
    wrap.dataset.coverLoading = "true";
    this.renderResolving(wrap, this.bookRef(book));
    LexoCoverService.resolve(book).then(result => {
      wrap.dataset.coverLoading = "false";
      if (result.url) {
        this.renderImage(wrap, this.bookRef(result.book), result.url, { book: result.book, imgClass: wrap.dataset.imgClass });
      } else if ((result.cover_status || "").toLowerCase() === "failed") {
        this.renderUnavailable(wrap, this.bookRef(result.book));
      } else {
        this.renderPlaceholder(wrap, this.bookRef(result.book));
      }
    });
  },

  async _persistCoverUrl(ref, url) {
    if (!ref.library_id || !isHostedCoverUrl(url)) return;
    const headers = { "Content-Type": "application/json" };
    if (window.LexoAuth?.getAuthHeaders) Object.assign(headers, LexoAuth.getAuthHeaders());
    try {
      const response = await fetch("/api/library/cover", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: ref.title,
          author: ref.author,
          cover_url: url,
          library_id: ref.library_id || null,
          isbn: ref.isbn || null,
        }),
      });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.book && window.LexoLibrary?._upsertBookInCache) {
          LexoLibrary._upsertBookInCache(data.book);
        }
        console.info("[CoverDebug] persisted", {
          title: ref.title,
          library_id: ref.library_id,
          cover_url: url,
        });
      }
    } catch {
      /* best-effort */
    }
  },

  _batchResolveBooks(books, { force = false } = {}) {
    const missing = [];
    const sourceBooks = [];

    (books || []).forEach(book => {
      LexoCoverService.registerBook(book);
      const ref = this.bookRef(book);
      if (this.getKnownUrl(book)) return;
      if (!force && !this._shouldAttemptResolve(book)) return;
      if (sourceBooks.some(item => this.cacheKey(this.bookRef(item)) === this.cacheKey(ref))) return;
      book._resolveStartedAt = Date.now();
      missing.push({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        bookId: this.cacheKey(ref),
        google_id: ref.google_id,
        open_library_key: ref.open_library_key,
        force: Boolean(force || book._coverRetried),
      });
      sourceBooks.push(book);
    });

    if (!missing.length) return Promise.resolve(sourceBooks);

    const signature = `${force ? "force:" : ""}${missing.map(b => `${b.bookId}|${b.title}|${b.author}`).sort().join(";;")}`;
    if (this._pendingBatch.has(signature)) return this._pendingBatch.get(signature);

    const promise = fetch("/api/books/resolve-covers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ books: missing }),
    })
      .then(r => (r.ok ? r.json() : { results: [] }))
      .then(async data => {
        const retries = [];
        (data.results || []).forEach((result, index) => {
          const source = sourceBooks[index];
          if (!source) return;
          const url = result?.cover_url;
          const status = (result?.cover_status || (url ? "ready" : "missing")).toLowerCase();
          source.cover_status = status;
          if (url && isHostedCoverUrl(url)) {
            applyCoverToBook(source, url, {
              cover_status: status,
              cover_source: result.cover_source,
            });
            this._persistCoverUrl(this.bookRef(source), url);
          } else if (status === "failed" && !source._coverRetried) {
            source._coverRetried = true;
            retries.push(source);
          }
        });
        if (retries.length) {
          await this._batchResolveBooks(retries, { force: true });
        }
        return sourceBooks;
      })
      .catch(() => sourceBooks)
      .finally(() => this._pendingBatch.delete(signature));

    this._pendingBatch.set(signature, promise);
    return promise;
  },

  _renderBookCover(book, root = document, options = {}) {
    LexoCoverService.registerBook(book);
    const ref = this.bookRef(book);
    const url = this.getKnownUrl(book);
    const key = this.cacheKey(ref);
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const wraps = [...scope.querySelectorAll("[data-cover-key]")].filter(el => el.dataset.coverKey === key);
    const status = (book.cover_status || "").toLowerCase();
    wraps.forEach(wrap => {
      wrap.__sourceBook = book;
      if (url) {
        this.renderImage(wrap, ref, url, { ...options, book });
      } else if (status === "failed" || (status === "resolving" && this._isResolveStale(book))) {
        this.renderUnavailable(wrap, ref, options);
      } else if (status === "resolving" || options.resolving) {
        this.renderResolving(wrap, ref, options);
      } else {
        this.renderPlaceholder(wrap, ref, options);
      }
    });
  },

  resolveMissing(books, root = document, options = {}) {
    (books || []).forEach(book => this._renderBookCover(book, root, options));
    const needsResolve = (books || []).filter(book => this._shouldAttemptResolve(book));
    if (needsResolve.length) {
      LexoCoverQueue.enqueue(needsResolve, root, options);
    }
    return Promise.resolve(books);
  },

  hydrateWrap(wrap, book, options = {}) {
    if (!wrap) return Promise.resolve(null);
    LexoCoverService.registerBook(book);
    wrap.__sourceBook = book;
    return LexoCoverService.resolve(book).then(result => {
      const ref = this.bookRef(result.book || book);
      if (result.url) {
        this.renderImage(wrap, ref, result.url, { ...options, book: result.book });
        return result.url;
      }
      if ((result.cover_status || "").toLowerCase() === "failed") {
        this.renderUnavailable(wrap, ref, options);
      } else {
        this.renderPlaceholder(wrap, ref, options);
      }
      return null;
    });
  },

  hydrateLazy(root = document, options = {}) {
    root.querySelectorAll(".book-cover-wrap[data-cover-key]").forEach(wrap => {
      const book = wrap.__sourceBook || LexoCoverService.getBook(this.refFromWrap(wrap));
      const ref = this.bookRef(book);
      wrap.__sourceBook = book;
      const url = this.getKnownUrl(book);
      if (url) {
        this.renderImage(wrap, ref, url, { ...options, book });
      } else if (wrap.dataset.coverLoading !== "true" && this._shouldAttemptResolve(book)) {
        this.renderResolving(wrap, ref, options);
        book._resolveStartedAt = Date.now();
        LexoCoverService.resolve(book).then(result => {
          wrap.dataset.coverLoading = "false";
          if (result.url) {
            this.renderImage(wrap, this.bookRef(result.book), result.url, { ...options, book: result.book });
            this._persistCoverUrl(this.bookRef(result.book), result.url);
          } else if ((result.cover_status || "").toLowerCase() === "failed") {
            this.renderUnavailable(wrap, this.bookRef(result.book), options);
          } else {
            this.renderPlaceholder(wrap, this.bookRef(result.book), options);
          }
        });
      }
    });
  },

  hydrate(root = document, options = {}) {
    return this.hydrateLazy(root, options);
  },

  async hydrateMany(books, root = document, options = {}) {
    await this.resolveMissing(books, root, options);
    return books;
  },

  seedFromBooks(books) {
    (books || []).forEach(book => LexoCoverService.registerBook(book));
  },
};

const BookCover = {
  isHostedCoverUrl,
  isOpenLibraryUrl,

  html(bookOrProps, options = {}) {
    const props = bookOrProps || {};
    const book =
      props.title !== undefined && !props.ai_recommendation
        ? {
            title: props.title,
            author: props.author,
            cover_url: normalizeCoverUrlFromBook(props),
            genre: props.genre,
            isbn: props.isbn,
            library_id: props.libraryId ?? props.library_id ?? null,
            google_id: props.googleId ?? props.google_id ?? null,
            open_library_key: props.openLibraryKey ?? props.open_library_key ?? null,
          }
        : props;
    return LexoCoverImage.html(book, options);
  },

  resolve: book => LexoCoverService.resolve(book),
  resolveMany: (books, root, options) => LexoCoverService.resolveMany(books, root, options),
  resolveMissing: (books, root, options) => LexoCoverImage.resolveMissing(books, root, options),
  hydrate: (root, options) => LexoCoverImage.hydrate(root, options),
  hydrateLazy: (root, options) => LexoCoverImage.hydrateLazy(root, options),
  hydrateMany: (books, root, options) => LexoCoverImage.hydrateMany(books, root, options),
  hydrateWrap: (wrap, book, options) => LexoCoverImage.hydrateWrap(wrap, book, options),
  hydrateEager: (books, root, options) => LexoCoverImage.resolveMissing(books, root, options),
  seedFromBooks: books => LexoCoverImage.seedFromBooks(books),
  onError: img => LexoCoverImage.onError(img),
  escape: value => LexoCoverImage.escape(value),
  getBookCover: book => getFinalCoverUrl(book),
  normalizeCoverUrl: book => getFinalCoverUrl(book),
  normalizeCoverUrlFromBook,
  isMissingCoverUrl: url => LexoCoverImage.isMissingCoverUrl(url),
  applyCoverToBook,
};

window.LexoCoverImage = LexoCoverImage;
window.LexoCoverService = LexoCoverService;
window.BookCover = BookCover;

// Remove legacy browser-side broken URL caches.
try {
  localStorage.removeItem("lexo_cover_broken_v6");
  localStorage.removeItem("lexo_cover_broken_v5");
  localStorage.removeItem("lexo_cover_cache_v5");
  localStorage.removeItem("lexo_cover_broken_migrated_v6");
  sessionStorage.removeItem("lexo_cover_broken_v6");
  sessionStorage.removeItem("lexo_cover_broken_v5");
  sessionStorage.removeItem("lexo_cover_cache_v5");
} catch {
  /* ignore */
}
