/** Centralized book cover rendering, lookup, and caching for BookMindAI. */
const BookMindCoverImage = {
  _memoryCache: new Map(),
  _pending: new Map(),

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
    return `<div class="${wrapClass}" data-cover-key="${this.escape(this.cacheKey(ref))}">${inner}</div>`;
  },

  html(book, options = {}) {
    const ref = this.bookRef(book);
    const imgClass = options.imgClass || "book-cover-img";
    const lazy = options.lazy !== false;
    const initialUrl = this.normalizeUrl(ref.cover_url);

    if (initialUrl) {
      return this.wrapHtml(
        `<img class="${imgClass}" src="${this.escape(initialUrl)}" alt="${this.escape(ref.title)} cover" loading="${lazy ? "lazy" : "eager"}" decoding="async" onerror="BookMindCoverImage.onError(this)">`,
        ref,
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

    const book = wrap.__bookRef || {
      title: wrap.dataset.title || img.alt?.replace(/ cover$/, "") || "Book",
      author: wrap.dataset.author || "Unknown Author",
      genre: wrap.dataset.genre || "Book",
      isbn: wrap.dataset.isbn || null,
      cover_url: null,
    };

    if (wrap.dataset.coverRetry === "true") {
      img.remove();
      if (!wrap.querySelector(".premium-book-placeholder")) {
        wrap.insertAdjacentHTML("beforeend", this.placeholderHtml(book));
      }
      return;
    }

    wrap.dataset.coverRetry = "true";
    img.remove();
    wrap.__bookRef = { ...book, cover_url: null };
    this._memoryCache.delete(this.cacheKey(book));

    this.resolve({ ...book, cover_url: null }).then(url => {
      if (url && wrap.isConnected) {
        const imgClass = img.className || wrap.dataset.imgClass || "book-cover-img";
        this.applyUrlToWrap(wrap, book, url, imgClass);
        wrap.dataset.coverRetry = "false";
        return;
      }
      if (!wrap.querySelector(".premium-book-placeholder")) {
        wrap.insertAdjacentHTML("beforeend", this.placeholderHtml(book));
      }
    });
  },

  async resolve(ref, options = {}) {
    const key = this.cacheKey(ref);
    if (!options.skipCache && this._memoryCache.has(key)) return this._memoryCache.get(key);

    const existing = this.normalizeUrl(ref.cover_url);
    if (existing && !options.skipCache) {
      this._memoryCache.set(key, existing);
      return existing;
    }

    if (this._pending.has(key)) return this._pending.get(key);

    const promise = fetch("/api/books/resolve-cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ref.title,
        author: ref.author,
        isbn: ref.isbn,
        cover_url: ref.cover_url,
        google_id: ref.google_id,
        open_library_key: ref.open_library_key,
      }),
    })
      .then(response => (response.ok ? response.json() : {}))
      .then(data => {
        const url = this.normalizeUrl(data.cover_url) || null;
        this._memoryCache.set(key, url);
        this._pending.delete(key);
        return url;
      })
      .catch(() => {
        this._pending.delete(key);
        return null;
      });

    this._pending.set(key, promise);
    return promise;
  },

  applyUrlToWrap(wrap, ref, url, imgClass = "book-cover-img") {
    if (!wrap || !url) return;
    wrap.innerHTML = "";
    const img = document.createElement("img");
    img.className = imgClass;
    img.src = url;
    img.alt = `${ref.title} cover`;
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = () => BookMindCoverImage.onError(img);
    wrap.appendChild(img);
    wrap.__bookRef = ref;
    ref.cover_url = url;
  },

  async hydrateWrap(wrap, book, options = {}) {
    if (!wrap || wrap.dataset.coverHydrated === "true") return;
    const ref = this.bookRef(book);
    wrap.__bookRef = ref;

    const imgClass = options.imgClass || wrap.dataset.imgClass || "book-cover-img";
    const existing = wrap.querySelector("img");
    const existingUrl = this.normalizeUrl(existing?.src || ref.cover_url);

    if (existingUrl && existing) {
      wrap.dataset.coverHydrated = "true";
      return existingUrl;
    }

    const url = await this.resolve(ref);
    if (url && wrap.isConnected) {
      this.applyUrlToWrap(wrap, ref, url, imgClass);
    }
    wrap.dataset.coverHydrated = "true";
    return url;
  },

  hydrate(root = document, options = {}) {
    const wraps = root.querySelectorAll("[data-cover-key]");
    wraps.forEach(wrap => {
      const book = wrap.__bookRef || {
        title: wrap.dataset.title,
        author: wrap.dataset.author,
        genre: wrap.dataset.genre,
        isbn: wrap.dataset.isbn,
        cover_url: wrap.querySelector("img")?.src,
      };
      this.hydrateWrap(wrap, book, options);
    });
  },

  async hydrateMany(books, root = document, options = {}) {
    const refs = books.map(book => this.bookRef(book));
    const missing = refs.filter(ref => !this.normalizeUrl(ref.cover_url));

    if (missing.length) {
      try {
        const response = await fetch("/api/books/resolve-covers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            books: missing.map(ref => ({
              title: ref.title,
              author: ref.author,
              isbn: ref.isbn,
              cover_url: ref.cover_url,
              google_id: ref.google_id,
              open_library_key: ref.open_library_key,
            })),
          }),
        });

        if (response.ok) {
          const data = await response.json();
          (data.results || []).forEach((result, index) => {
            const url = this.normalizeUrl(result.cover_url);
            if (url) {
              this._memoryCache.set(this.cacheKey(missing[index]), url);
              missing[index].cover_url = url;
            }
          });
        }
      } catch {
        /* offline */
      }
    }

    refs.forEach((ref, index) => {
      const book = books[index];
      if (ref.cover_url) book.cover_url = ref.cover_url;
      if (book.book_data && ref.cover_url) book.book_data.cover_url = ref.cover_url;
    });

    this.hydrate(root, options);
    return books;
  },
};

window.BookMindCoverImage = BookMindCoverImage;
