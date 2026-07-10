/** BookMindAI centralized cover component — hosted Supabase URLs only. */
console.log("BOOK COVER BUILD VERSION: hosted-proxy-v1");

const HOSTED_COVER_MARKER = "/storage/v1/object/public/book-covers/";

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
  if (isExternalCoverUrl(book.cover_url) || (book.cover_url && !isHostedCoverUrl(book.cover_url))) {
    book.cover_url = null;
    book.coverUrl = null;
  }
  if (book.book_data && isExternalCoverUrl(book.book_data.cover_url)) book.book_data.cover_url = null;
  if (book.ai_recommendation && isExternalCoverUrl(book.ai_recommendation.cover_url)) {
    book.ai_recommendation.cover_url = null;
  }
}

const BookMindCoverService = {
  _bookRegistry: new Map(),
  _pending: new Map(),

  registerBook(book) {
    if (!book || typeof book !== "object") return book;
    const ref = BookMindCoverImage.bookRef(book);
    stripExternalCoverFromBook(book);
    this._bookRegistry.set(BookMindCoverImage.cacheKey(ref), book);
    return book;
  },

  getBook(refOrBook) {
    if (!refOrBook) return null;
    const ref = BookMindCoverImage.bookRef(refOrBook);
    return this._bookRegistry.get(BookMindCoverImage.cacheKey(ref)) || refOrBook;
  },

  localUrl(book) {
    const url = book?.cover_url || book?.coverUrl || book?.book_data?.cover_url || book?.ai_recommendation?.cover_url;
    return isHostedCoverUrl(url) ? url : null;
  },

  async resolve(book) {
    this.registerBook(book);
    const existing = this.localUrl(book);
    if (existing) {
      applyCoverToBook(book, existing, { cover_status: book.cover_status || "ready", cover_source: book.cover_source });
      return { url: existing, book, cover_status: "ready", placeholder: false };
    }

    const ref = BookMindCoverImage.bookRef(book);
    const key = BookMindCoverImage.cacheKey(ref);
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
        bookId: BookMindCoverImage.cacheKey(ref),
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
    return BookMindCoverImage.resolveMissing(books, root, options);
  },
};

const BookMindCoverImage = {
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
      cover_url: BookMindCoverService.localUrl(book),
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
    return BookMindCoverService.localUrl(book);
  },

  placeholderHtml(ref, options = {}) {
    const phClass = options.placeholderClass || "book-cover-placeholder";
    const resolving = options.resolving ? " book-cover-resolving" : "";
    return `
      <div class="${phClass} book-cover-placeholder${resolving}" data-cover-fallback="true" role="img" aria-label="${this.escape(ref.title)} cover">
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
    BookMindCoverService.registerBook(book);
    const ref = this.bookRef(book);
    const imgClass = options.imgClass || "book-cover-img";
    const knownUrl = this.getKnownUrl(book);

    if (knownUrl) {
      return this.wrapHtml(
        `<img class="${imgClass} book-cover-image" src="${this.escape(knownUrl)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async" onerror="BookCover.onError(this)">`,
        { ...ref, cover_url: knownUrl },
        options
      );
    }

    return this.wrapHtml(this.placeholderHtml(ref, { ...options, resolving: true }), ref, options);
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
    wrap.innerHTML = `<img class="${imgClass} book-cover-image" src="${this.escape(url)}" alt="${this.escape(ref.title)} cover" loading="lazy" decoding="async" onerror="BookCover.onError(this)">`;
    wrap.classList.add("cover-has-image", "cover-loaded");
    wrap.dataset.coverResolved = "true";
    this._persistCoverUrl(this.bookRef(sourceBook), url);
  },

  onError(img) {
    const wrap = img?.closest("[data-cover-key]");
    if (!wrap || wrap.dataset.coverLoading === "true") return;
    const book = wrap.__sourceBook || BookMindCoverService.getBook(this.refFromWrap(wrap));
    wrap.dataset.coverLoading = "true";
    this.renderResolving(wrap, this.bookRef(book));
    BookMindCoverService.resolve(book).then(result => {
      wrap.dataset.coverLoading = "false";
      if (result.url) {
        this.renderImage(wrap, this.bookRef(result.book), result.url, { book: result.book, imgClass: wrap.dataset.imgClass });
      } else {
        this.renderPlaceholder(wrap, this.bookRef(result.book));
      }
    });
  },

  async _persistCoverUrl(ref, url) {
    if (!ref.library_id || !isHostedCoverUrl(url)) return;
    const headers = { "Content-Type": "application/json" };
    if (window.BookMindAuth?.getAuthHeaders) Object.assign(headers, BookMindAuth.getAuthHeaders());
    try {
      await fetch("/api/library/cover", {
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
    } catch {
      /* best-effort */
    }
  },

  _batchResolveBooks(books) {
    const missing = [];
    const refs = [];
    const sourceBooks = [];

    (books || []).forEach(book => {
      BookMindCoverService.registerBook(book);
      const ref = this.bookRef(book);
      if (this.getKnownUrl(book)) return;
      if (refs.some(item => this.cacheKey(item) === this.cacheKey(ref))) return;
      missing.push({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        bookId: this.cacheKey(ref),
        google_id: ref.google_id,
        open_library_key: ref.open_library_key,
      });
      refs.push(ref);
      sourceBooks.push(book);
    });

    if (!missing.length) return Promise.resolve(sourceBooks);

    const signature = missing.map(b => `${b.title}|${b.author}`).sort().join(";;");
    if (this._pendingBatch.has(signature)) return this._pendingBatch.get(signature);

    const promise = fetch("/api/books/resolve-covers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ books: missing }),
    })
      .then(r => (r.ok ? r.json() : { results: [] }))
      .then(data => {
        (data.results || []).forEach((result, index) => {
          const source = sourceBooks[index];
          if (!source) return;
          const url = result?.cover_url;
          if (url && isHostedCoverUrl(url)) {
            applyCoverToBook(source, url, {
              cover_status: result.cover_status || "ready",
              cover_source: result.cover_source,
            });
          }
        });
        return sourceBooks;
      })
      .catch(() => sourceBooks)
      .finally(() => this._pendingBatch.delete(signature));

    this._pendingBatch.set(signature, promise);
    return promise;
  },

  async resolveMissing(books, root = document, options = {}) {
    await this._batchResolveBooks(books || []);

    (books || []).forEach(book => {
      BookMindCoverService.registerBook(book);
      const ref = this.bookRef(book);
      const url = this.getKnownUrl(book);
      const key = this.cacheKey(ref);
      const wrap = [...root.querySelectorAll("[data-cover-key]")].find(el => el.dataset.coverKey === key);
      if (!wrap) return;
      wrap.__sourceBook = book;
      if (url) this.renderImage(wrap, ref, url, { ...options, book });
      else this.renderPlaceholder(wrap, ref, options);
    });

    return books;
  },

  hydrateWrap(wrap, book, options = {}) {
    if (!wrap) return Promise.resolve(null);
    BookMindCoverService.registerBook(book);
    wrap.__sourceBook = book;
    return BookMindCoverService.resolve(book).then(result => {
      const ref = this.bookRef(result.book || book);
      if (result.url) {
        this.renderImage(wrap, ref, result.url, { ...options, book: result.book });
        return result.url;
      }
      this.renderPlaceholder(wrap, ref, options);
      return null;
    });
  },

  hydrateLazy(root = document, options = {}) {
    root.querySelectorAll(".book-cover-wrap[data-cover-key]").forEach(wrap => {
      const book = wrap.__sourceBook || BookMindCoverService.getBook(this.refFromWrap(wrap));
      const ref = this.bookRef(book);
      wrap.__sourceBook = book;
      const url = this.getKnownUrl(book);
      if (url) {
        this.renderImage(wrap, ref, url, { ...options, book });
      } else if (wrap.dataset.coverLoading !== "true") {
        this.renderResolving(wrap, ref, options);
        BookMindCoverService.resolve(book).then(result => {
          if (result.url) this.renderImage(wrap, this.bookRef(result.book), result.url, { ...options, book: result.book });
          else this.renderPlaceholder(wrap, this.bookRef(result.book), options);
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
    (books || []).forEach(book => BookMindCoverService.registerBook(book));
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
            cover_url: isHostedCoverUrl(props.cover_url || props.coverUrl) ? props.cover_url || props.coverUrl : null,
            genre: props.genre,
            isbn: props.isbn,
            library_id: props.libraryId ?? props.library_id ?? null,
            google_id: props.googleId ?? props.google_id ?? null,
            open_library_key: props.openLibraryKey ?? props.open_library_key ?? null,
          }
        : props;
    return BookMindCoverImage.html(book, options);
  },

  resolve: book => BookMindCoverService.resolve(book),
  resolveMany: (books, root, options) => BookMindCoverService.resolveMany(books, root, options),
  resolveMissing: (books, root, options) => BookMindCoverImage.resolveMissing(books, root, options),
  hydrate: (root, options) => BookMindCoverImage.hydrate(root, options),
  hydrateLazy: (root, options) => BookMindCoverImage.hydrateLazy(root, options),
  hydrateMany: (books, root, options) => BookMindCoverImage.hydrateMany(books, root, options),
  hydrateWrap: (wrap, book, options) => BookMindCoverImage.hydrateWrap(wrap, book, options),
  hydrateEager: (books, root, options) => BookMindCoverImage.resolveMissing(books, root, options),
  seedFromBooks: books => BookMindCoverImage.seedFromBooks(books),
  onError: img => BookMindCoverImage.onError(img),
  escape: value => BookMindCoverImage.escape(value),
  getBookCover: book => BookMindCoverService.localUrl(book),
  normalizeCoverUrl: url => (isHostedCoverUrl(url) ? url : null),
  isMissingCoverUrl: url => BookMindCoverImage.isMissingCoverUrl(url),
  applyCoverToBook,
};

window.BookMindCoverImage = BookMindCoverImage;
window.BookMindCoverService = BookMindCoverService;
window.BookCover = BookCover;

// Remove legacy browser-side broken URL caches.
try {
  localStorage.removeItem("bookmind_cover_broken_v6");
  localStorage.removeItem("bookmind_cover_broken_v5");
  localStorage.removeItem("bookmind_cover_cache_v5");
  localStorage.removeItem("bookmind_cover_broken_migrated_v6");
  sessionStorage.removeItem("bookmind_cover_broken_v6");
  sessionStorage.removeItem("bookmind_cover_broken_v5");
  sessionStorage.removeItem("bookmind_cover_cache_v5");
} catch {
  /* ignore */
}
