/** Discovery UI — cover rendering delegated to BookCover. */
const LexoCover = {
  coverMeta(book) {
    const genre = book.genre || (book.categories && book.categories[0]) || "Book";
    return {
      title: book.title || "Book",
      coverClass:
        typeof LexoUI !== "undefined" ? LexoUI.getCoverClass(genre) : "mystery-cover",
      icon: typeof LexoUI !== "undefined" ? LexoUI.getCoverIcon(genre) : "⌕",
    };
  },

  html(book, variant = "card") {
    if (!window.BookCover) {
      const { title, coverClass, icon } = this.coverMeta(book);
      const isModal = variant === "modal";
      const phClass = isModal ? "discovery-detail-ph" : "discovery-card-ph";
      return `<div class="discovery-cover-slot">${this.placeholderHtml(phClass, coverClass, icon)}</div>`;
    }

    return BookCover.html(book, {
      imgClass: variant === "modal" ? "discovery-detail-img book-cover-img" : "discovery-card-img book-cover-img",
      wrapClass: variant === "modal" ? "discovery-modal-cover-slot book-cover-wrap" : "discovery-cover-slot book-cover-wrap",
      placeholderClass: variant === "modal" ? "discovery-detail-ph book-cover-placeholder" : "discovery-card-ph book-cover-placeholder",
    });
  },

  onImageError(img) {
    if (window.BookCover) {
      BookCover.onError(img);
    }
  },

  placeholderHtml(phClass, coverClass, icon) {
    return `<div class="discovery-cover-placeholder custom-cover ${coverClass} ${phClass}" aria-hidden="true"><span>${icon}</span></div>`;
  },

  escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
};

const LexoDiscoveryFormat = {
  ratingHtml(book) {
    const rating = Number(book.average_rating);
    if (!rating || Number.isNaN(rating)) return "";

    const count = book.ratings_count ? ` (${Number(book.ratings_count).toLocaleString()})` : "";
    return `<span class="discovery-rating" aria-label="Rating ${rating} out of 5">${rating.toFixed(1)} ★${count}</span>`;
  },

  categoriesText(book) {
    const cats = book.categories || (book.genre ? [book.genre] : []);
    return cats.filter(Boolean).slice(0, 6).join(", ");
  },

  publishedText(book) {
    if (book.published_date) return book.published_date;
    if (book.first_publish_year) return String(book.first_publish_year);
    return null;
  },

  libraryEntry(book) {
    return {
      title: book.title,
      author: book.author || "Unknown Author",
      genre: book.genre || (book.categories && book.categories[0]) || "Book",
      cover_url: book.cover_url || null,
      description: book.description || book.description_preview || null,
      id: book.id || book.open_library_key || null,
      book_id: book.book_id || book.open_library_key || book.id || null,
      categories: book.categories,
      publisher: book.publisher,
      published_date: book.published_date,
      first_publish_year: book.first_publish_year,
      average_rating: book.average_rating,
      ratings_count: book.ratings_count,
      isbn: book.isbn,
      open_library_key: book.open_library_key,
    };
  },
};

/** Reusable discovery result card. */
const LexoDiscoveryCard = {
  render(book) {
    const preview =
      book.description_preview ||
      book.description ||
      "Open details for the full description and add this book to your library.";

    const rating = LexoDiscoveryFormat.ratingHtml(book);

    return `
      <article class="discovery-card card">
        <div class="discovery-card-cover">
          ${LexoCover.html(book, "card")}
        </div>
        <div class="discovery-card-body">
          <h3>${LexoCover.escape(book.title)}</h3>
          <p class="discovery-card-author">${LexoCover.escape(book.author || "Unknown Author")}</p>
          ${rating ? `<div class="discovery-card-rating">${rating}</div>` : ""}
          <p class="discovery-card-preview">${LexoCover.escape(preview)}</p>
          <button type="button" class="btn btn-secondary discovery-card-action">View Details</button>
        </div>
      </article>`;
  },

  attach(cardEl, book, onOpen) {
    const open = e => {
      e.preventDefault();
      e.stopPropagation();
      onOpen(book);
    };
    cardEl.querySelector(".discovery-card-action")?.addEventListener("click", open);
    cardEl.addEventListener("click", e => {
      if (e.target.closest(".discovery-card-action")) return;
      open(e);
    });
  },
};

/** Book detail modal with shelf actions. */
const LexoDetailModal = {
  selectedBook: null,
  isOpen: false,
  _ignoreOpenUntil: 0,

  init(rootId = "bookDetailModal") {
    this.root = document.getElementById(rootId);
    if (!this.root) return;

    this.els = {
      backdrop: this.root.querySelector("[data-modal-backdrop]"),
      dialog: this.root.querySelector("[data-modal-dialog]"),
      closeBtn: this.root.querySelector("[data-modal-close]"),
      cover: this.root.querySelector("[data-modal-cover]"),
      title: this.root.querySelector("[data-modal-title]"),
      author: this.root.querySelector("[data-modal-author]"),
      rating: this.root.querySelector("[data-modal-rating]"),
      details: this.root.querySelector("[data-modal-details]"),
      description: this.root.querySelector("[data-modal-description]"),
      hint: this.root.querySelector("[data-modal-hint]"),
      shelfBtns: this.root.querySelectorAll(".discovery-shelf-btn"),
      toast: document.getElementById("discoveryToast"),
    };

    this.els.closeBtn?.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    this.els.backdrop?.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
    });

    this.els.backdrop?.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    this.els.dialog?.addEventListener("click", e => e.stopPropagation());

    this.els.shelfBtns?.forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        this.saveShelf(btn.dataset.shelf, btn.dataset.label || btn.textContent.trim());
      });
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    });

    this.close();
  },

  async open(book) {
    if (!book || Date.now() < this._ignoreOpenUntil) return;

    if (window.LexoAuth?.whenReady) {
      await window.LexoAuth.whenReady();
    }

    if (window.LexoAuth?.isLoggedIn()) {
      try {
        await LexoLibrary.ensureLoaded();
      } catch {
        /* library optional for discovery */
      }
    }

    this.selectedBook = { ...book };
    this.isOpen = true;
    this.renderBook(this.selectedBook);

    this.root.classList.add("is-open");
    this.root.setAttribute("aria-hidden", "false");
    document.body.classList.add("discovery-modal-open");
    this.els.closeBtn?.focus();

    const enriched = await this.fetchDetail(this.selectedBook);
    if (enriched && this.isOpen && this.selectedBook?.id === enriched.id) {
      this.selectedBook = enriched;
      this.renderBook(enriched);
    }
  },

  async fetchDetail(book) {
    const id = book.id || book.book_id || book.open_library_key;
    if (!id) return book;

    try {
      const source = book.source || "google_books";
      const response = await fetch(
        `/api/books/detail?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`
      );
      if (!response.ok) return book;
      const data = await response.json();
      return { ...book, ...(data.book || {}) };
    } catch {
      return book;
    }
  },

  renderBook(book) {
    const existing = LexoLibrary.findShelf(book);

    this.els.title.textContent = book.title || "Untitled";
    this.els.author.textContent = book.author || "Unknown Author";
    this.els.description.textContent =
      book.description || book.description_preview || "No description available for this book.";

    const ratingHtml = LexoDiscoveryFormat.ratingHtml(book);
    if (ratingHtml) {
      this.els.rating.innerHTML = ratingHtml;
      this.els.rating.hidden = false;
    } else {
      this.els.rating.innerHTML = "";
      this.els.rating.hidden = true;
    }

    this.els.details.innerHTML = this.renderDetailsGrid(book);
    this.els.cover.innerHTML = LexoCover.html(book, "modal");
    if (window.BookCover) {
      const wrap = this.els.cover.querySelector(".book-cover-wrap");
      if (wrap) BookCover.hydrateWrap(wrap, book, { imgClass: "discovery-detail-img book-cover-img" });
    }

    this.els.shelfBtns?.forEach(btn => {
      btn.classList.toggle("active-shelf", existing === btn.dataset.shelf);
      btn.disabled = false;
    });

    if (existing) {
      this.els.hint.textContent = `In your library as “${LexoLibrary.getShelfLabel(existing)}”. Choose a shelf to update.`;
      this.els.hint.hidden = false;
    } else {
      this.els.hint.hidden = true;
    }
  },

  renderDetailsGrid(book) {
    const rows = [
      ["Published", LexoDiscoveryFormat.publishedText(book)],
      ["Categories", LexoDiscoveryFormat.categoriesText(book)],
      ["Pages", book.total_pages ? String(book.total_pages) : null],
      ["Publisher", book.publisher || null],
    ];

    return rows
      .filter(([, value]) => value)
      .map(
        ([label, value]) =>
          `<div class="discovery-detail-item"><dt>${LexoCover.escape(label)}</dt><dd>${LexoCover.escape(value)}</dd></div>`
      )
      .join("");
  },

  close() {
    this.isOpen = false;
    this.selectedBook = null;
    this._ignoreOpenUntil = Date.now() + 350;

    this.root.classList.remove("is-open");
    this.root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("discovery-modal-open");

    if (this.els.title) this.els.title.textContent = "";
    if (this.els.author) this.els.author.textContent = "";
    if (this.els.description) this.els.description.textContent = "";
    if (this.els.cover) this.els.cover.innerHTML = "";
    if (this.els.details) this.els.details.innerHTML = "";
    if (this.els.rating) {
      this.els.rating.innerHTML = "";
      this.els.rating.hidden = true;
    }
    if (this.els.hint) this.els.hint.hidden = true;
  },

  async saveShelf(status, label) {
    if (!window.LexoAPI?.ensureAuth) {
      window.location.href = "/login.html";
      return;
    }

    const token = await LexoAPI.ensureAuth({ redirect: true });
    if (!token) return;

    const book = this.selectedBook;
    if (!book) return;

    await LexoLibrary.ensureLoaded();

    const entry = LexoDiscoveryFormat.libraryEntry(book);
    const existing = LexoLibrary.findShelf(entry);

    this.els.shelfBtns?.forEach(btn => {
      btn.disabled = true;
    });

    const shelf = LexoLibrary.normalizeStatus(status);
    try {
      const data = await LexoLibrary.saveBook(entry, shelf, {
        source: book.source || "google_books",
        totalPages: book.total_pages,
        progress: shelf === "read" ? 100 : undefined,
      });

      const shelfLabel = LexoLibrary.getShelfLabel(data.book?.status || shelf);
      this.showToast(
        data.message ||
          (!existing
            ? `"${entry.title}" added to ${shelfLabel}.`
            : `"${entry.title}" moved to ${shelfLabel}.`)
      );

      this.els.shelfBtns?.forEach(btn => {
        btn.disabled = false;
        btn.classList.toggle("active-shelf", btn.dataset.shelf === status);
      });
      this.els.hint.textContent = `In your library as “${LexoLibrary.getShelfLabel(status)}”. Choose a shelf to update.`;
      this.els.hint.hidden = false;

      window.LexoLibraryPage?.refresh?.();
    } catch (error) {
      this.showToast(error.message || "Could not save book.", true);
      this.els.shelfBtns?.forEach(btn => {
        btn.disabled = false;
      });
    }
  },

  showToast(message, isError = false) {
    const toast = this.els.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("show");
      if (!isError) toast.hidden = true;
    }, 3200);
  },
};

/** Discovery page search controller. */
const LexoDiscovery = {
  searchMode: "all",

  init() {
    this.els = {
      form: document.getElementById("discoverySearchForm"),
      input: document.getElementById("discoverySearchInput"),
      clearBtn: document.getElementById("discoverySearchClear"),
      status: document.getElementById("discoverySearchStatus"),
      results: document.getElementById("discoveryResults"),
      filters: document.querySelectorAll(".discovery-filter"),
    };

    LexoDetailModal.init("bookDetailModal");

    if (!this.els.form) return;

    this.els.form.addEventListener("submit", e => {
      e.preventDefault();
      this.search();
    });

    this.els.input.addEventListener("input", () => {
      this.els.clearBtn.hidden = !this.els.input.value.trim();
    });

    this.els.clearBtn.addEventListener("click", () => {
      this.els.input.value = "";
      this.els.clearBtn.hidden = true;
      this.els.results.innerHTML = "";
      this.setStatus("");
      this.els.input.focus();
    });

    this.els.filters.forEach(btn => {
      btn.addEventListener("click", () => {
        this.searchMode = btn.dataset.mode || "all";
        this.els.filters.forEach(el => el.classList.toggle("active", el === btn));
        if (this.els.input.value.trim()) this.search();
      });
    });
  },

  async search() {
    const query = this.els.input.value.trim();
    if (!query) {
      this.setStatus("Enter a title, author, or genre.", "hint");
      return;
    }

    this.setStatus("Searching Google Books & Open Library…", "loading");
    this.els.results.innerHTML = `<div class="discovery-state card"><p>Searching…</p></div>`;

    try {
      const response = await fetch(
        `/api/books/search?q=${encodeURIComponent(query)}&limit=12&mode=${encodeURIComponent(this.searchMode)}`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Search failed.");
      this.renderResults(data.results || [], query);
    } catch (error) {
      this.els.results.innerHTML = "";
      this.setStatus(error.message || "Could not search right now.", "error");
    }
  },

  renderResults(books, query) {
    if (!books.length) {
      this.setStatus(`No books found for “${query}”.`, "empty");
      this.els.results.innerHTML = `
        <div class="discovery-empty card">
          <p>Try another search, switch filters (Title / Author / Genre), or use fewer words.</p>
        </div>`;
      return;
    }

    this.setStatus(`${books.length} result${books.length === 1 ? "" : "s"}`, "success");
    this.els.results.innerHTML = "";

    books.forEach(book => {
      const wrap = document.createElement("div");
      wrap.innerHTML = LexoDiscoveryCard.render(book);
      const card = wrap.firstElementChild;
      LexoDiscoveryCard.attach(card, book, b => {
        if (Date.now() < LexoDetailModal._ignoreOpenUntil) return;
        LexoDetailModal.open(b);
      });
      this.els.results.appendChild(card);
    });

    if (window.BookCover) {
      BookCover.resolveMissing(books, this.els.results, {
        imgClass: "discovery-card-img book-cover-img",
      });
    }
  },

  setStatus(message, type = "idle") {
    this.els.status.textContent = message;
    this.els.status.className = `discovery-search-status discovery-search-status-${type}`;
    this.els.status.hidden = !message;
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  if (window.LexoAuth?.whenReady) {
    await window.LexoAuth.whenReady();
  }

  if (window.LexoAuth?.isLoggedIn()) {
    try {
      await LexoLibrary.ensureLoaded();
    } catch {
      /* optional */
    }
  }
  LexoDiscovery.init();

  document.getElementById("surpriseMeBtn")?.addEventListener("click", () => {
    const genres = ["mystery", "fantasy", "romance", "literary fiction", "thriller", "historical"];
    const pick = genres[Math.floor(Math.random() * genres.length)];
    const input = document.getElementById("discoverySearchInput");
    if (input) {
      input.value = pick;
      document.getElementById("discoverySearchForm")?.requestSubmit();
    }
  });
});
