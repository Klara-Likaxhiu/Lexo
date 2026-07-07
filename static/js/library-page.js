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

  readingTotal.textContent = (library.reading || []).length;
  wantTotal.textContent = (library.want || []).length;
  readTotal.textContent = (library.read || []).length;
  notInterestedTotal.textContent = (library.not_interested || []).length;

  renderShelf(activeShelf);
}

function showState(type, message = "") {
  if (!libraryBooks) return;

  if (type === "loading") {
    libraryBooks.innerHTML = `
      <div class="library-skeleton-grid" aria-hidden="true">
        ${Array.from({ length: 4 }, () => `
          <div class="shared-book-card card skeleton-card">
            <div class="skeleton skeleton-cover shared-book-cover"></div>
            <div class="shared-book-info">
              <div class="skeleton skeleton-line skeleton-line-lg"></div>
              <div class="skeleton skeleton-line"></div>
              <div class="skeleton skeleton-line skeleton-line-sm"></div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    return;
  }

  if (type === "error") {
    libraryBooks.innerHTML = `
      <div class="library-state card library-state-error">
        <h2>Could not load library</h2>
        <p>${escapeHtml(message)}</p>
        <button class="btn btn-primary" type="button" id="libraryRetryBtn">Try again</button>
      </div>
    `;
    document.getElementById("libraryRetryBtn")?.addEventListener("click", () => {
      initLibraryPage();
    });
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

function renderShelf(shelf) {
  const library = BookMindLibrary.getLibrary();
  const books = library[shelf] || [];

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

  if (books.length === 0) {
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

  books.forEach(book => {
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

  if (window.BookMindCoverImage) {
    const coverBooks = books.map(book => ({
      title: book.title,
      author: book.author,
      genre: book.genre,
      cover_url: book.cover_url,
      isbn: book.isbn,
    }));
    BookMindCoverImage.seedFromBooks(coverBooks);
    BookMindCoverImage.hydrateLazy(libraryBooks, {
      imgClass: "shared-book-cover book-cover-img",
    });
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
