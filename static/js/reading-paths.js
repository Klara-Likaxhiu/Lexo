const generateBtn = document.getElementById("generateBtn");
const pathsGrid = document.getElementById("pathsGrid");
const pathsMessage = document.getElementById("pathsMessage");

const STORE_KEY = "bookmind_reading_paths";

const ICONS = {
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  check: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
};

function svg(name, cls) {
  return `<svg class="icon ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function loadPaths() {
  const raw = JSON.parse(localStorage.getItem(STORE_KEY));
  return raw ? normalize(raw) : null;
}

function savePaths(result) {
  localStorage.setItem(STORE_KEY, JSON.stringify(result));
}

// Ensure every path/book has a stable id and a completion flag so we can track
// progress across reloads even for AI output that lacks them.
function normalize(result) {
  const paths = (result.paths || []).map(path => ({
    ...path,
    id: path.id || uid(),
    books: (path.books || []).map(book => ({
      ...book,
      id: book.id || uid(),
      completed: Boolean(book.completed)
    }))
  }));
  return { ...result, paths };
}

let state = loadPaths();

void (async () => {
  if (window.BookMindAPI?.ensureAuth) {
    const token = await BookMindAPI.ensureAuth({ redirect: false });
    if (token) {
      await BookMindLibrary.ensureLoaded();
    }
  }

  if (state) {
    renderPaths(state);
    generateBtn.textContent = "Regenerate Paths";
  }
})();

generateBtn.addEventListener("click", async () => {
  generateBtn.textContent = "Generating...";
  generateBtn.disabled = true;

  pathsGrid.innerHTML = "";
  pathsMessage.style.display = "block";
  pathsMessage.innerHTML = `
    <h2>Building your personalized reading journeys...</h2>
    <p>BookMindAI is analyzing your Reader DNA, library, mood, and goal.</p>
  `;

  const readerProfile = JSON.parse(localStorage.getItem("readerProfile"));

  try {
    await BookMindLibrary.ensureLoaded();
    const library = BookMindLibrary.getLibrary();

    const result = await BookMindAPI.post("/api/reader/paths", {
      reader_profile: readerProfile,
      library: library,
      today_mood: localStorage.getItem("bookmind_today_mood"),
      today_goal: localStorage.getItem("bookmind_today_goal")
    });

    state = normalize(result);
    savePaths(state);
    renderPaths(state);
  } catch (error) {
    console.error(error);
    pathsMessage.innerHTML = `
      <h2>Couldn't generate paths right now.</h2>
      <p>Please try again in a moment.</p>
    `;
  }

  generateBtn.textContent = "Regenerate Paths";
  generateBtn.disabled = false;
});

/* ---------------------------------------------------------------- actions */

function findPath(pathId) {
  return state.paths.find(p => p.id === pathId);
}

function showPathToast(message, isError = false) {
  const toast = document.getElementById("pathsToast");
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
}

function toggleComplete(pathId, bookId) {
  const path = findPath(pathId);
  if (!path) return;
  const book = path.books.find(b => b.id === bookId);
  if (!book) return;

  void (async () => {
    if (!window.BookMindAPI?.ensureAuth) {
      showPathToast("BookMindAPI is not loaded.", true);
      return;
    }

    const token = await BookMindAPI.ensureAuth({ redirect: true });
    if (!token) {
      showPathToast("Sign in to update your library.", true);
      return;
    }

    await BookMindLibrary.ensureLoaded();

    const nextCompleted = !book.completed;
    const payload = {
      title: book.title,
      author: book.author || "",
      genre: book.genre || "Book",
    };

    try {
      if (nextCompleted) {
        const existing = BookMindLibrary.findBook(payload);
        if (existing?.library_id) {
          await BookMindLibrary.patchBook(existing.library_id, {
            status: "read",
            progress: 100,
          });
        } else {
          await BookMindLibrary.addBook(payload, "read", { progress: 100, silent: true });
        }
        book.completed = true;
        showPathToast(`"${book.title}" marked as Finished in your library.`);
      } else {
        const entry = BookMindLibrary.findBook(payload);
        if (entry?.library_id) {
          await BookMindLibrary.patchBook(entry.library_id, {
            status: "reading",
            progress: entry.progress || 0,
          });
        } else {
          BookMindLibrary.clearFinish(payload);
        }
        book.completed = false;
        showPathToast(`"${book.title}" moved back to Currently Reading.`);
      }

      savePaths(state);
      renderPaths(state);
      window.BookMindLibraryPage?.refresh?.();
    } catch (error) {
      console.error("[ReadingPaths] toggleComplete failed", error);
      showPathToast(error.message || "Could not update your library.", true);
    }
  })();
}

function completeNext(pathId) {
  const path = findPath(pathId);
  if (!path) return;
  const next = path.books.find(b => !b.completed);
  if (next) toggleComplete(pathId, next.id);
}

function addBookToPath(pathId, title, author) {
  const path = findPath(pathId);
  if (!path || !title.trim()) return;

  path.books.push({
    id: uid(),
    title: title.trim(),
    author: (author || "").trim(),
    level: "Added by you",
    reason: "You added this book to the path.",
    completed: false
  });

  savePaths(state);
  renderPaths(state);
}

function removeBookFromPath(pathId, bookId) {
  const path = findPath(pathId);
  if (!path) return;
  path.books = path.books.filter(b => b.id !== bookId);
  savePaths(state);
  renderPaths(state);
}

/* ---------------------------------------------------------------- render */

function libraryTitleOptions() {
  const library = BookMindLibrary.getLibrary();
  const titles = new Set();
  Object.values(library).forEach(shelf =>
    (shelf || []).forEach(book => book && book.title && titles.add(book.title))
  );
  return [...titles].map(t => `<option value="${escapeHtml(t)}"></option>`).join("");
}

function milestoneStrip(completed, total) {
  const half = Math.ceil(total / 2);
  const milestones = [
    { label: "Started", reached: completed >= 1 },
    { label: "Halfway", reached: total > 0 && completed >= half },
    { label: "Completed", reached: total > 0 && completed >= total }
  ];

  return `
    <div class="path-milestones">
      ${milestones
        .map(
          m => `
        <span class="milestone ${m.reached ? "reached" : ""}">
          ${m.reached ? svg("check", "icon-inline") : svg("flag", "icon-inline")}
          ${m.label}
        </span>
      `
        )
        .join("")}
    </div>
  `;
}

function renderPaths(result) {
  const paths = result.paths || [];

  pathsMessage.style.display = "block";
  pathsMessage.innerHTML = `<h2>${escapeHtml(result.message || "Here are your personalized reading paths.")}</h2>`;

  if (paths.length === 0) {
    pathsGrid.innerHTML = "";
    pathsMessage.innerHTML += `<p>No paths yet — click "Generate My Journey" to create some.</p>`;
    return;
  }

  const datalistOptions = libraryTitleOptions();

  pathsGrid.innerHTML = paths
    .map((path, pathIndex) => {
      const books = path.books || [];
      const completed = books.filter(b => b.completed).length;
      const total = books.length;
      const percent = total ? Math.round((completed / total) * 100) : 0;
      const done = total > 0 && completed === total;

      return `
      <div class="path-card card" data-path="${path.id}">
        <div class="path-header">
          <div class="path-icon">${svg("route")}</div>
          <div>
            <p class="eyebrow">Path ${pathIndex + 1}</p>
            <h2>${escapeHtml(path.path_name || "Personalized Reading Path")}</h2>
            <p>${escapeHtml(path.why_this_path || "A personalized path created from your Reader DNA.")}</p>
          </div>
        </div>

        ${milestoneStrip(completed, total)}

        <div class="path-progress">
          <div style="width: ${percent}%;"></div>
        </div>
        <p class="path-count">${escapeHtml(path.difficulty_progression || "Personalized progression")} · ${completed} / ${total} books completed${done ? " · Path complete" : ""}</p>

        <div class="path-timeline">
          ${books
            .map(
              (book, index) => `
            <div class="path-book ${book.completed ? "done" : ""}">
              <div class="path-step">${book.completed ? svg("check", "icon-inline") : index + 1}</div>
              <div class="path-book-cover">
                ${
                  window.BookMindCoverImage
                    ? BookMindCoverImage.html(book, {
                        imgClass: "path-book-cover-img book-cover-img",
                        wrapClass: "book-cover-wrap path-cover-wrap",
                        placeholderClass: "path-book-cover-ph book-cover-placeholder",
                      })
                    : svg("book")
                }
              </div>
              <div class="path-book-info">
                <span>${escapeHtml(book.level || "Recommended")}</span>
                <h3>${escapeHtml(book.title || "Untitled Book")}</h3>
                <p>${escapeHtml(book.author || "Unknown Author")}</p>
                <small>${escapeHtml(book.reason || "")}</small>
              </div>
              <div class="path-book-actions">
                <button class="btn btn-secondary btn-sm" data-action="toggle" data-book="${book.id}">
                  ${book.completed ? "Completed" : "Mark complete"}
                </button>
                <button class="path-book-remove" data-action="remove" data-book="${book.id}" title="Remove from path">${svg("x", "icon-inline")}</button>
              </div>
            </div>
          `
            )
            .join("")}
        </div>

        <div class="path-add">
          <input type="text" class="path-add-title" list="libraryTitles" placeholder="Add a book by title">
          <input type="text" class="path-add-author" placeholder="Author (optional)">
          <button class="btn btn-secondary" data-action="add">${svg("plus", "icon-inline")} Add</button>
        </div>

        <button class="btn btn-primary complete-next-btn" data-action="next" ${done ? "disabled" : ""}>
          ${done ? svg("trophy", "icon-inline") + " Path complete" : "Mark next book complete"}
        </button>
      </div>
    `;
    })
    .join("");

  let datalist = document.getElementById("libraryTitles");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "libraryTitles";
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = datalistOptions;

  if (window.BookMindCoverImage) {
    const allBooks = paths.flatMap(path => path.books || []);
    BookMindCoverImage.seedFromBooks(allBooks);
    BookMindCoverImage.hydrateLazy(pathsGrid, {
      imgClass: "path-book-cover-img book-cover-img",
    });
  }
}

/* ------------------------------------------------------- event delegation */

pathsGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const card = button.closest(".path-card");
  const pathId = card.dataset.path;
  const action = button.dataset.action;

  if (action === "toggle") {
    toggleComplete(pathId, button.dataset.book);
  } else if (action === "remove") {
    removeBookFromPath(pathId, button.dataset.book);
  } else if (action === "next") {
    completeNext(pathId);
  } else if (action === "add") {
    const titleInput = card.querySelector(".path-add-title");
    const authorInput = card.querySelector(".path-add-author");
    addBookToPath(pathId, titleInput.value, authorInput.value);
  }
});
