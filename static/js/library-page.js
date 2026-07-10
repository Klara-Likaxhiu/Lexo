/** My Library page — loads shelves from Supabase and groups by status. */

let activeShelf = "reading";

const readingTotal = document.getElementById("readingTotal");
const wantTotal = document.getElementById("wantTotal");
const readTotal = document.getElementById("readTotal");
const notInterestedTotal = document.getElementById("notInterestedTotal");
const shelfTitle = document.getElementById("shelfTitle");
const libraryBooks = document.getElementById("libraryBooks");

document.addEventListener("DOMContentLoaded", () => {
  initLibraryPage();
});

document.addEventListener("bookmind:library-changed", () => {
  renderAll();
});

async function initLibraryPage() {
  bindTabs();
  showState("loading");

  try {
    await BookMindLibrary.ensureLoaded();
    showImportFlash();
    renderAll();
  } catch (error) {
    showState("error", error.message || "Could not load your library.");
  }
}

function bindTabs() {
  document.querySelectorAll(".library-tab").forEach(button => {
    button.addEventListener("click", function () {
      document.querySelectorAll(".library-tab").forEach(tab => {
        tab.classList.remove("active-tab");
      });
      this.classList.add("active-tab");
      activeShelf = this.dataset.shelf;
      renderShelf(activeShelf);
    });
  });
}

function renderAll() {
  const library = BookMindLibrary.getLibrary();

  if (readingTotal) readingTotal.textContent = (library.reading || []).length;
  if (wantTotal) wantTotal.textContent = (library.want || []).length;
  if (readTotal) readTotal.textContent = (library.read || []).length;
  if (notInterestedTotal) notInterestedTotal.textContent = (library.not_interested || []).length;

  const loading = document.getElementById("bookshelfLoading");
  if (loading) loading.hidden = true;

  renderBookshelves();
  renderShelf(activeShelf);
  scheduleLibraryCoverResolve();
}

function scheduleLibraryCoverResolve() {
  if (!window.BookCover) return;
  const library = BookMindLibrary.getLibrary();
  const allBooks = ["reading", "want", "read"].flatMap(key => (library[key] || []).slice(0, 20));
  if (!allBooks.length) return;
  BookCover.resolveMissing(allBooks, document, { imgClass: "book-cover-img" });
}

function renderBookshelves() {
  const shelves = [
    { id: "shelfReading", key: "reading" },
    { id: "shelfWant", key: "want" },
    { id: "shelfRead", key: "read" },
  ];

  const library = BookMindLibrary.getLibrary();

  shelves.forEach(({ id, key }) => {
    const container = document.getElementById(id);
    if (!container) return;

    const books = library[key] || [];
    container.innerHTML = "";

    books.forEach(book => {
      const standing = document.createElement("div");
      standing.className = "shelf-book-standing";
      standing.title = book.title;

      const coverHtml = window.BookCover
        ? BookCover.html(book, {
            imgClass: "book-cover-img",
            wrapClass: "shelf-standing-cover book-cover-wrap",
          })
        : `<div class="shelf-standing-cover premium-book-placeholder mystery-cover"></div>`;

      standing.innerHTML = coverHtml;
      standing.addEventListener("click", () => {
        if (book.library_id) {
          BookMindLibrary.recordBookOpened(book.library_id, { skipRefresh: true });
        }
        localStorage.setItem(
          "selectedBook",
          JSON.stringify({ ai_recommendation: book, book_data: null })
        );
        window.location.href = "book-details.html";
      });
      container.appendChild(standing);
    });

    const addSlot = document.createElement("button");
    addSlot.type = "button";
    addSlot.className = "shelf-add-slot";
    addSlot.innerHTML = `<span class="add-icon">+</span><span>Add Book</span>`;
    addSlot.addEventListener("click", () => {
      document.getElementById("openImportBtn")?.click();
    });
    container.appendChild(addSlot);
  });
}

function showState(type, message = "") {
  const loading = document.getElementById("bookshelfLoading");
  if (type === "loading") {
    if (loading) {
      loading.hidden = false;
      loading.innerHTML = `<p class="small-muted">Loading your library…</p>`;
    }
    return;
  }
  if (loading) loading.hidden = true;

  if (type === "error") {
    const main = document.querySelector(".library-bookshelf-page");
    if (main) {
      const err = document.createElement("div");
      err.className = "library-state card library-state-error";
      err.innerHTML = `
        <h2>Could not load library</h2>
        <p>${escapeHtml(message)}</p>
        <button class="btn btn-primary" type="button" id="libraryRetryBtn">Try again</button>
      `;
      main.prepend(err);
      document.getElementById("libraryRetryBtn")?.addEventListener("click", () => {
        err.remove();
        initLibraryPage();
      });
    }
  }
}

function showImportFlash() {
  const message = sessionStorage.getItem("bookmind_import_flash");
  if (!message) return;

  sessionStorage.removeItem("bookmind_import_flash");
  showToast(message);
}

function showToast(message, isError = false) {
  const toast = document.getElementById("libraryToast");
  if (!toast) return;

  toast.textContent = message;
  toast.hidden = false;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.hidden = true;
    }, 250);
  }, 3200);
}

const SHELF_PAGE_SIZE = 20;
const shelfVisibleCounts = {
  reading: SHELF_PAGE_SIZE,
  want: SHELF_PAGE_SIZE,
  read: SHELF_PAGE_SIZE,
  not_interested: SHELF_PAGE_SIZE,
};

function renderShelf(shelf) {
  const library = BookMindLibrary.getLibrary();
  const books = library[shelf] || [];
  const visibleCount = shelfVisibleCounts[shelf] || SHELF_PAGE_SIZE;
  const visibleBooks = books.slice(0, visibleCount);

  const titles = {
    reading: "Currently Reading",
    want: "Want to Read",
    read: "Finished Books",
    not_interested: "Not Interested",
  };

  const emptyCopy = {
    reading: {
      heading: "No books yet",
      body: "Start reading something new — search Discovery or add a book with the button above.",
    },
    want: {
      heading: "No books yet",
      body: "Save titles you want to read from Discovery, Home, or AI Companion.",
    },
    read: {
      heading: "No finished books yet",
      body: "Mark books as Finished when you're done — they'll show up here.",
    },
    not_interested: {
      heading: "Nothing here",
      body: "Books you mark as Not Interested will appear on this shelf.",
    },
  };

  shelfTitle.textContent = titles[shelf] || shelf;
  libraryBooks.innerHTML = "";

  if (visibleBooks.length === 0) {
    const copy = emptyCopy[shelf] || emptyCopy.want;
    libraryBooks.innerHTML = `
      <div class="empty-library card">
        <h2>${copy.heading}</h2>
        <p>${copy.body}</p>
        <a class="btn btn-primary" href="discovery.html">Browse Discovery</a>
      </div>
    `;
    return;
  }

  visibleBooks.forEach(book => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = BookMindBookCard.render(book, { showProgress: true });

    const card = wrapper.firstElementChild;

    card.addEventListener("click", function (e) {
      if (e.target.closest(".library-progress-form, .book-actions")) return;

      if (book.library_id) {
        BookMindLibrary.recordBookOpened(book.library_id, { skipRefresh: true });
      }

      localStorage.setItem(
        "selectedBook",
        JSON.stringify({
          ai_recommendation: book,
          book_data: null,
        })
      );
      window.location.href = "book-details.html";
    });

    BookMindBookCard.attachActions(card, book, {
      onChanged: () => {
        renderAll();
      },
      onError: msg => showToast(msg, true),
      onProgressSaved: (msg, finished) => {
        showToast(msg || (finished ? "Marked as Finished!" : "Reading progress saved."));
        if (finished && activeShelf !== "read") {
          setTimeout(() => renderAll(), 300);
        }
      },
    });

    libraryBooks.appendChild(card);
  });

  if (books.length > visibleBooks.length) {
    const loadMore = document.createElement("button");
    loadMore.type = "button";
    loadMore.className = "btn btn-secondary library-load-more";
    loadMore.textContent = `Load more (${books.length - visibleBooks.length} remaining)`;
    loadMore.addEventListener("click", () => {
      shelfVisibleCounts[shelf] = (shelfVisibleCounts[shelf] || SHELF_PAGE_SIZE) + SHELF_PAGE_SIZE;
      renderShelf(shelf);
    });
    libraryBooks.appendChild(loadMore);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.BookMindLibraryPage = {
  refresh: async () => {
    await BookMindLibrary.ensureLoaded(true);
    renderAll();
  },
  showToast,
};
