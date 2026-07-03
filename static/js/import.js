/* Book Import — search, manual entry, and file upload into My Library. */

const BookImport = {
  activeTab: "search",
  selectedResult: null,
  uploadedBook: null,

  els: {},

  init() {
    const modal = document.getElementById("importModal");
    if (!modal) return;

    this.els = {
      modal,
      openBtn: document.getElementById("openImportBtn"),
      closeBtn: document.getElementById("closeImportBtn"),
      tabs: modal.querySelectorAll(".import-tab"),
      panes: modal.querySelectorAll(".import-pane"),
      searchInput: document.getElementById("importSearchInput"),
      searchBtn: document.getElementById("importSearchBtn"),
      searchResults: document.getElementById("importSearchResults"),
      manualTitle: document.getElementById("manualTitle"),
      manualAuthor: document.getElementById("manualAuthor"),
      manualGenre: document.getElementById("manualGenre"),
      fileInput: document.getElementById("importFileInput"),
      fileName: document.getElementById("importFileName"),
      uploadFields: document.getElementById("importUploadFields"),
      uploadTitle: document.getElementById("uploadTitle"),
      uploadAuthor: document.getElementById("uploadAuthor"),
      shelf: document.getElementById("importShelf"),
      source: document.getElementById("importSource"),
      totalPages: document.getElementById("importTotalPages"),
      addBtn: document.getElementById("importAddBtn"),
      message: document.getElementById("importMessage"),
    };

    this.bindEvents();
  },

  bindEvents() {
    const e = this.els;

    if (e.openBtn) e.openBtn.addEventListener("click", () => this.open());
    if (e.closeBtn) e.closeBtn.addEventListener("click", () => this.close());

    e.modal.addEventListener("click", event => {
      if (event.target === e.modal) this.close();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !e.modal.hidden) this.close();
    });

    e.tabs.forEach(tab => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
    });

    if (e.searchBtn) e.searchBtn.addEventListener("click", () => this.runSearch());
    if (e.searchInput) {
      e.searchInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.runSearch();
        }
      });
    }

    if (e.fileInput) e.fileInput.addEventListener("change", () => this.onFileChosen());
    if (e.addBtn) e.addBtn.addEventListener("click", () => this.addBook());
  },

  open() {
    this.els.modal.hidden = false;
    document.body.classList.add("import-open");
    this.setMessage("");
    if (this.els.searchInput) this.els.searchInput.focus();
  },

  close() {
    this.els.modal.hidden = true;
    document.body.classList.remove("import-open");
  },

  switchTab(tab) {
    this.activeTab = tab;

    this.els.tabs.forEach(button => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });

    this.els.panes.forEach(pane => {
      pane.hidden = pane.dataset.pane !== tab;
    });

    this.setMessage("");
  },

  async runSearch() {
    const query = this.els.searchInput.value.trim();
    if (!query) {
      this.setMessage("Type something to search.", true);
      return;
    }

    this.els.searchResults.innerHTML = `<p class="import-hint">Searching…</p>`;
    this.selectedResult = null;

    try {
      const response = await fetch(`/api/books/google-search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(`Search failed: ${response.status}`);
      const data = await response.json();
      this.renderResults(data.results || []);
    } catch (error) {
      console.error(error);
      this.els.searchResults.innerHTML = `<p class="import-hint">Search failed. Please try again.</p>`;
    }
  },

  renderResults(results) {
    if (!results.length) {
      this.els.searchResults.innerHTML = `<p class="import-hint">No books found. Try a different search or add it manually.</p>`;
      return;
    }

    this.els.searchResults.innerHTML = "";

    results.forEach(result => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "import-result";

      const cover = result.cover_url
        ? `<img src="${result.cover_url}" alt="${this.escape(result.title)} cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"><span class="import-result-fallback" style="display:none;">
             <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
           </span>`
        : `<span class="import-result-fallback"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg></span>`;

      const meta = [result.author, result.first_publish_year, result.total_pages ? `${result.total_pages} pages` : null]
        .filter(Boolean)
        .join(" · ");

      item.innerHTML = `
        <span class="import-result-cover">${cover}</span>
        <span class="import-result-info">
          <span class="import-result-title">${this.escape(result.title)}</span>
          <span class="import-result-meta">${this.escape(meta)}</span>
        </span>
      `;

      item.addEventListener("click", () => this.selectResult(result, item));
      this.els.searchResults.appendChild(item);
    });
  },

  selectResult(result, element) {
    this.selectedResult = result;

    this.els.searchResults.querySelectorAll(".import-result").forEach(el => {
      el.classList.toggle("selected", el === element);
    });

    if (result.total_pages) this.els.totalPages.value = result.total_pages;
    if (result.source) this.els.source.value = result.source;

    this.setMessage(`Selected "${result.title}". Choose a shelf, then add it.`);
  },

  onFileChosen() {
    const file = this.els.fileInput.files[0];
    if (!file) return;

    this.els.fileName.textContent = file.name;

    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    const extension = (file.name.split(".").pop() || "").toLowerCase();

    this.uploadedBook = { title: baseName, author: "", genre: "Book" };

    this.els.uploadFields.hidden = false;
    this.els.uploadTitle.value = baseName;
    this.els.uploadAuthor.value = "";

    if (extension === "pdf") this.els.source.value = "pdf";
    else if (extension === "epub") this.els.source.value = "epub";

    this.setMessage("File ready. Edit the details if needed, then add it.");
  },

  buildBook() {
    if (this.activeTab === "search") {
      if (!this.selectedResult) return null;
      return {
        title: this.selectedResult.title,
        author: this.selectedResult.author || "Unknown Author",
        genre: this.selectedResult.genre || "Book",
        cover_url: this.selectedResult.cover_url || null,
        first_publish_year: this.selectedResult.first_publish_year || null,
      };
    }

    if (this.activeTab === "manual") {
      const title = this.els.manualTitle.value.trim();
      if (!title) return null;
      return {
        title,
        author: this.els.manualAuthor.value.trim() || "Unknown Author",
        genre: this.els.manualGenre.value.trim() || "Book",
      };
    }

    if (this.activeTab === "upload") {
      if (!this.uploadedBook) return null;
      const title = this.els.uploadTitle.value.trim();
      if (!title) return null;
      return {
        title,
        author: this.els.uploadAuthor.value.trim() || "Unknown Author",
        genre: "Book",
      };
    }

    return null;
  },

  async addBook() {
    const book = this.buildBook();

    if (!book) {
      const messages = {
        search: "Select a book from the search results first.",
        manual: "Enter at least a title.",
        upload: "Choose a file and enter a title.",
      };
      this.setMessage(messages[this.activeTab] || "Add a book first.", true);
      return;
    }

    if (!window.BookMindAuth?.isLoggedIn()) {
      this.setMessage("Sign in to add books to your library.", true);
      return;
    }

    const shelf = this.els.shelf.value;
    const source = this.els.source.value || undefined;
    const totalPages = this.els.totalPages.value || undefined;

    this.els.addBtn.disabled = true;
    this.setMessage("Saving to your library…");

    try {
      await BookMindLibrary.ensureLoaded();
      const existingShelf = BookMindLibrary.findShelf(book);

      await BookMindLibrary.addBookWithMeta(book, shelf, { source, totalPages });

      const label = BookMindLibrary.getShelfLabel(shelf);
      const verb = existingShelf ? "moved to" : "added to";
      const flash = `"${book.title}" ${verb} ${label}.`;

      sessionStorage.setItem("bookmind_import_flash", flash);
      this.close();

      if (window.BookMindLibraryPage) {
        window.BookMindLibraryPage.showToast(flash);
        window.BookMindLibraryPage.refresh();
      } else {
        location.reload();
      }
    } catch (error) {
      console.error(error);
      this.setMessage(error.message || "Could not save book.", true);
    } finally {
      this.els.addBtn.disabled = false;
    }
  },

  setMessage(text, isError = false) {
    if (!this.els.message) return;
    this.els.message.textContent = text;
    this.els.message.classList.toggle("error", isError);
  },

  escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
};

BookImport.init();
