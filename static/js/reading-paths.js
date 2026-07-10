const generateBtn = document.getElementById("generateBtn");
const pathsGrid = document.getElementById("pathsGrid");
const pathsMessage = document.getElementById("pathsMessage");
const activePathsSection = document.getElementById("activePathsSection");
const activePathsGrid = document.getElementById("activePathsGrid");
const secretPathsSection = document.getElementById("secretPathsSection");
const secretPathsGrid = document.getElementById("secretPathsGrid");
const passportSection = document.getElementById("passportSection");
const passportStatsBar = document.getElementById("passportStatsBar");
const passportGrid = document.getElementById("passportGrid");
const ratedPathsSection = document.getElementById("ratedPathsSection");
const ratedPathsGrid = document.getElementById("ratedPathsGrid");
const pathCompletionModal = document.getElementById("pathCompletionModal");

const STORE_KEY = "bookmind_reading_paths";
const Completion = () => window.BookMindPathCompletion;
const Passport = () => window.BookMindPathPassport;
let focusPathId = new URLSearchParams(window.location.search).get("path");
let saveTimer = null;
let pendingReviewPathId = null;
let selectedStars = 0;
let confettiFrame = null;

const ICONS = {
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  check: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
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
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10);
}

function normalize(result) {
  const paths = (result.paths || []).map(path => ({
    ...path,
    id: path.id || uid(),
    started_at: path.started_at || null,
    path_completed: Boolean(path.path_completed),
    completed_at: path.completed_at || null,
    completion_badge_id: path.completion_badge_id || null,
    completion_badge_title: path.completion_badge_title || null,
    books: (path.books || []).map(book => ({
      ...book,
      id: book.id || uid(),
      completed: Boolean(book.completed),
    })),
  }));
  return { ...result, paths };
}

function loadLocalPaths() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    return raw ? normalize(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalPaths(result) {
  localStorage.setItem(STORE_KEY, JSON.stringify(result));
}

async function loadPathsFromServer() {
  if (!window.BookMindAPI?.get) return null;
  const token = await BookMindAPI.ensureAuth({ redirect: false });
  if (!token) return loadLocalPaths();
  try {
    const data = await BookMindAPI.get("/api/reading-paths");
    if (Array.isArray(data?.paths) && data.paths.length) return normalize(data);
    const local = loadLocalPaths();
    if (local?.paths?.length) {
      await persistPaths(local, { immediate: true });
      localStorage.removeItem(STORE_KEY);
      return local;
    }
    return normalize(data || { message: "Your saved reading paths.", paths: [] });
  } catch {
    return loadLocalPaths();
  }
}

async function persistPaths(result, { immediate = false } = {}) {
  saveLocalPaths(result);
  if (!window.BookMindAPI?.put) return;
  const run = async () => {
    try {
      const token = await BookMindAPI.ensureAuth({ redirect: false });
      if (!token) return;
      const data = await BookMindAPI.put("/api/reading-paths", {
        message: result.message,
        paths: result.paths,
      });
      if (Array.isArray(data?.paths)) {
        const savedByKey = new Map(data.paths.map(path => [path.id || path.path_name, path]));
        const merged = result.paths.map(path => {
          const saved = savedByKey.get(path.id) || savedByKey.get(path.path_name);
          return saved ? { ...path, ...saved } : path;
        });
        data.paths.forEach(path => {
          if (!merged.some(item => item.id === path.id)) merged.push(path);
        });
        state = normalize({ ...result, paths: merged });
      }
    } catch {
      /* local cache remains */
    }
  };
  if (immediate) await run();
  else {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(run, 400);
  }
}

function savePaths(result) {
  state = result;
  void persistPaths(result);
}

let state = normalize({ message: "", paths: [] });

function orderPaths(paths) {
  const list = paths.slice();
  if (!focusPathId) return list;
  list.sort((a, b) => (a.id === focusPathId ? -1 : b.id === focusPathId ? 1 : 0));
  return list;
}

function showPathFlash() {
  const flash = sessionStorage.getItem("bookmind_path_flash");
  if (!flash) return;
  sessionStorage.removeItem("bookmind_path_flash");
  showPathToast(flash);
}

void (async () => {
  if (window.BookMindAPI?.ensureAuth) {
    const token = await BookMindAPI.ensureAuth({ redirect: false });
    if (token) await BookMindLibrary.ensureLoaded();
  }
  const loaded = await loadPathsFromServer();
  if (loaded) {
    state = loaded;
    renderPaths(state);
    if (state.paths?.length) generateBtn.textContent = "Regenerate Paths";
  }
  showPathFlash();
})();

generateBtn.addEventListener("click", async () => {
  generateBtn.textContent = "Generating...";
  generateBtn.disabled = true;
  pathsMessage.style.display = "block";
  pathsMessage.innerHTML = `<h2>Building your personalized reading journeys...</h2><p>BookMindAI is analyzing your Reader DNA, library, mood, and goal.</p>`;
  try {
    await BookMindLibrary.ensureLoaded();
    const result = await BookMindAPI.post("/api/reader/paths", {
      reader_profile: JSON.parse(localStorage.getItem("readerProfile")),
      library: BookMindLibrary.getLibrary(),
      today_mood: localStorage.getItem("bookmind_today_mood"),
      today_goal: localStorage.getItem("bookmind_today_goal"),
    });
    state = normalize(result);
    const genrePaths = (await loadPathsFromServer())?.paths?.filter(p => p.genre_slug) || [];
    const ids = new Set(state.paths.map(p => p.id));
    genrePaths.forEach(path => {
      if (!ids.has(path.id)) state.paths.push(path);
    });
    await persistPaths(state, { immediate: true });
    renderPaths(state);
  } catch {
    pathsMessage.innerHTML = `<h2>Couldn't generate paths right now.</h2><p>Please try again in a moment.</p>`;
  }
  generateBtn.textContent = "Regenerate Paths";
  generateBtn.disabled = false;
});

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

function invalidatePathCompletion(path) {
  if (!path?.path_completed) return;
  path.path_completed = false;
  path.completed_at = null;
  path.completion_badge_id = null;
  path.completion_badge_title = null;
  path.passport_stamp = false;
}

function ensureStartedAt(path) {
  const prog = Completion()?.pathProgress(path);
  if (prog?.completed > 0 && !path.started_at) path.started_at = new Date().toISOString();
}

function toggleComplete(pathId, bookId) {
  const path = findPath(pathId);
  if (!path) return;
  const book = path.books.find(b => b.id === bookId);
  if (!book) return;

  void (async () => {
    const token = await BookMindAPI.ensureAuth({ redirect: true });
    if (!token) {
      showPathToast("Sign in to update your library.", true);
      return;
    }
    await BookMindLibrary.ensureLoaded();
    const nextCompleted = !book.completed;
    const payload = { title: book.title, author: book.author || "", genre: book.genre || path.genre || "Book" };
    try {
      if (nextCompleted) {
        const existing = BookMindLibrary.findBook(payload);
        if (existing?.library_id) await BookMindLibrary.patchBook(existing.library_id, { status: "read", progress: 100 });
        else await BookMindLibrary.addBook(payload, "read", { progress: 100, silent: true });
        book.completed = true;
        ensureStartedAt(path);
        showPathToast(`"${book.title}" marked as Finished.`);
      } else {
        const entry = BookMindLibrary.findBook(payload);
        if (entry?.library_id) await BookMindLibrary.patchBook(entry.library_id, { status: "reading", progress: entry.progress || 0 });
        else BookMindLibrary.clearFinish(payload);
        book.completed = false;
        invalidatePathCompletion(path);
        showPathToast(`"${book.title}" moved back to Currently Reading.`);
      }
      savePaths(state);
      renderPaths(state);
      window.BookMindLibraryPage?.refresh?.();
    } catch (error) {
      showPathToast(error.message || "Could not update your library.", true);
    }
  })();
}

function completeNext(pathId) {
  const path = findPath(pathId);
  const next = path?.books.find(b => !b.completed);
  if (next) toggleComplete(pathId, next.id);
}

function completeReadingPath(pathId) {
  const path = findPath(pathId);
  const C = Completion();
  if (!path || !C || !C.isReadyToComplete(path)) {
    showPathToast("Complete all books to finish this Reading Path.", true);
    return;
  }
  try {
    const result = C.completePath(path);
    savePaths(state);
    renderPaths(state);
    void showJourneyModal(result);
    showPathToast(`"${path.path_name}" completed! +${result.xp} XP`);
  } catch (error) {
    showPathToast(error.message || "Could not complete this path.", true);
  }
}

function discoverSecretPath(secretId) {
  const P = Passport();
  const C = Completion();
  if (!P || !C) return;
  const stats = C.readStats();
  const secret = P.SECRET_PATHS.find(s => s.secret_id === secretId);
  if (!secret || !P.checkUnlock(secret, stats, state.paths)) {
    showPathToast("This journey is still locked.", true);
    return;
  }
  if (state.paths.some(p => p.secret_id === secretId)) {
    focusPathId = state.paths.find(p => p.secret_id === secretId)?.id;
    renderPaths(state);
    return;
  }
  const newPath = P.discoverSecret(secretId, state.paths);
  if (newPath) {
    state.paths.push(newPath);
    focusPathId = newPath.id;
    savePaths(state);
    renderPaths(state);
    showPathToast(`Discovered: ${newPath.path_name}!`);
  }
}

function restartPath(pathId) {
  const path = findPath(pathId);
  if (!path || !window.confirm(`Restart "${path.path_name}"? All book progress will reset.`)) return;
  Completion()?.restartPath(path);
  savePaths(state);
  renderPaths(state);
  showPathToast(`"${path.path_name}" restarted.`);
}

function addBookToPath(pathId, title, author) {
  const path = findPath(pathId);
  if (!path || !title.trim()) return;
  invalidatePathCompletion(path);
  path.books.push({
    id: uid(), title: title.trim(), author: (author || "").trim(),
    level: "Added by you", difficulty: "Custom",
    reason: "You added this book to the path.", completed: false,
  });
  savePaths(state);
  renderPaths(state);
}

function removeBookFromPath(pathId, bookId) {
  const path = findPath(pathId);
  if (!path) return;
  path.books = path.books.filter(b => b.id !== bookId);
  invalidatePathCompletion(path);
  savePaths(state);
  renderPaths(state);
}

/* ----------------------------------------------------------- confetti */

function startConfetti() {
  const canvas = document.getElementById("journeyConfetti");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ["#c9a227", "#e8c547", "#6b8cae", "#b79ac8", "#3f9b7a", "#fff8e7"];
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    w: 6 + Math.random() * 6,
    h: 10 + Math.random() * 8,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 360,
    spin: (Math.random() - 0.5) * 8,
    vy: 2 + Math.random() * 4,
    vx: (Math.random() - 0.5) * 2,
    opacity: 1,
  }));
  let frame = 0;
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.y += p.vy;
      p.x += p.vx;
      p.rot += p.spin;
      if (frame > 90) p.opacity -= 0.012;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame += 1;
    if (frame < 180) confettiFrame = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  cancelAnimationFrame(confettiFrame);
  tick();
}

function stopConfetti() {
  cancelAnimationFrame(confettiFrame);
  const canvas = document.getElementById("journeyConfetti");
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

/* ----------------------------------------------------------- journey modal */

async function showJourneyModal({ path, badge, xp, daysTaken }) {
  if (!pathCompletionModal) return;
  const C = Completion();
  pendingReviewPathId = path.id;
  selectedStars = 0;

  document.getElementById("journeyModalTitle").textContent = path.path_name;
  document.getElementById("journeyModalStats").innerHTML = `
    <div class="journey-stat"><span>📚</span><strong>${path.books?.length || 0} Books</strong></div>
    <div class="journey-stat"><span>⏱</span><strong>${daysTaken} Days</strong></div>
    <div class="journey-stat"><span>⭐</span><strong>${C.difficultyLabel(path)}</strong></div>
  `;
  document.getElementById("journeyModalBadge").textContent = badge.title;
  document.getElementById("journeyModalRewards").innerHTML = `
    <div class="journey-reward">+${xp} XP</div>
    <div class="journey-reward">Reader DNA Updated</div>
    <div class="journey-reward">Passport Stamp Earned</div>
  `;

  const reflectionEl = document.getElementById("journeyReflectionText");
  const nextEl = document.getElementById("journeyNextSuggestion");
  reflectionEl.innerHTML = `<span class="journey-reflection-loading">BookMindAI is reflecting on your journey…</span>`;
  nextEl.textContent = "";

  document.getElementById("journeySurpriseInput").value = "";
  document.getElementById("journeyRecommendInput").checked = false;
  document.querySelectorAll("#journeyStarRating button").forEach(b => {
    b.classList.remove("active", "hover-preview");
  });

  pathCompletionModal.hidden = false;
  pathCompletionModal.setAttribute("aria-hidden", "false");
  pathCompletionModal.classList.add("is-open");
  document.body.classList.add("journey-modal-open");
  startConfetti();

  const reflection = await C.fetchReflection(path, daysTaken);
  path.ai_reflection = reflection.reflection;
  savePaths(state);
  reflectionEl.innerHTML = `<p>${escapeHtml(reflection.reflection).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  nextEl.textContent = reflection.next_path_suggestion
    ? `${reflection.next_path_suggestion}${reflection.next_path_name ? ` → ${reflection.next_path_name}` : ""}`
    : "";
}

function closeJourneyModal() {
  if (!pathCompletionModal) return;
  pathCompletionModal.classList.remove("is-open");
  pathCompletionModal.hidden = true;
  pathCompletionModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("journey-modal-open");
  stopConfetti();
  pendingReviewPathId = null;
}

(() => {
  const starBtns = [...document.querySelectorAll("#journeyStarRating button")];
  if (!starBtns.length) return;

  starBtns.forEach(starBtn => {
    starBtn.addEventListener("mouseenter", () => {
      const hover = Number(starBtn.dataset.star);
      starBtns.forEach(b => {
        b.classList.toggle("hover-preview", Number(b.dataset.star) <= hover);
      });
    });

    starBtn.addEventListener("mouseleave", () => {
      starBtns.forEach(b => b.classList.remove("hover-preview"));
    });

    starBtn.addEventListener("click", () => {
      selectedStars = Number(starBtn.dataset.star);
      starBtns.forEach(b => {
        b.classList.toggle("active", Number(b.dataset.star) <= selectedStars);
        b.classList.remove("hover-preview");
      });
    });
  });
})();

document.getElementById("journeySubmitReview")?.addEventListener("click", () => {
  if (!pendingReviewPathId || !Passport()) return;
  if (!selectedStars) {
    showPathToast("Please select a star rating.", true);
    return;
  }
  const review = Passport().saveReview(pendingReviewPathId, {
    rating: selectedStars,
    surprise: document.getElementById("journeySurpriseInput").value.trim(),
    recommend: document.getElementById("journeyRecommendInput").checked,
  });
  const path = findPath(pendingReviewPathId);
  if (path) {
    path.review = review;
    savePaths(state);
    renderPaths(state);
  }
  showPathToast("Thank you for your review!");
});

pathCompletionModal?.addEventListener("click", event => {
  if (event.target.closest("[data-action='close-modal']")) closeJourneyModal();
});

/* ---------------------------------------------------------------- render */

function libraryTitleOptions() {
  const library = BookMindLibrary.getLibrary();
  const titles = new Set();
  Object.values(library).forEach(shelf =>
    (shelf || []).forEach(book => book?.title && titles.add(book.title))
  );
  return [...titles].map(t => `<option value="${escapeHtml(t)}"></option>`).join("");
}

function renderCompletePathButton(path, { completed, total, allBooksDone }) {
  if (path.path_completed) return "";
  const ready = Completion()?.isReadyToComplete(path);
  return `
    <div class="path-journey-footer">
      <p class="path-books-progress ${allBooksDone ? "path-books-progress-done" : ""}">
        <strong>${completed} / ${total}</strong> Books Completed
      </p>
      ${!allBooksDone ? `<p class="path-complete-hint">Complete all books to finish this Reading Path.</p>` : ""}
      <button type="button" class="btn path-complete-btn ${ready ? "path-complete-btn-ready complete-path-button" : "path-complete-btn-disabled"}"
        data-action="complete-path" ${!allBooksDone ? "disabled" : ""}>
        🏆 Complete Reading Path
      </button>
    </div>
  `;
}

function renderActivePathCard(path, pathIndex) {
  const C = Completion();
  const prog = C?.pathProgress(path) || { completed: 0, total: 0, percent: 0, allBooksDone: false };
  const { completed, total, percent, allBooksDone } = prog;
  const isFocus = focusPathId && path.id === focusPathId;

  return `
    <div class="path-card card ${isFocus ? "path-card-focus" : ""}" data-path="${path.id}">
      <div class="path-header">
        <div class="path-icon ${path.path_icon ? "path-icon-emoji" : ""}">${path.path_icon ? escapeHtml(path.path_icon) : svg("route")}</div>
        <div>
          <p class="eyebrow">${path.is_secret ? "Secret Journey" : path.genre ? escapeHtml(path.genre) : `Path ${pathIndex + 1}`}</p>
          <h2>${escapeHtml(path.path_name || "Personalized Reading Path")}</h2>
          <p>${escapeHtml(path.why_this_path || "")}</p>
        </div>
      </div>
      <div class="path-progress"><div style="width:${percent}%;"></div></div>
      <div class="path-timeline">
        ${(path.books || []).map((book, index) => `
          <div class="path-book ${book.completed ? "done" : ""}">
            <div class="path-step">${book.completed ? svg("check", "icon-inline") : index + 1}</div>
            <div class="path-book-cover">${BookCover.html(book, { imgClass: "path-book-cover-img book-cover-img", wrapClass: "book-cover-wrap path-cover-wrap", placeholderClass: "path-book-cover-ph book-cover-placeholder" })}</div>
            <div class="path-book-info">
              <span>${escapeHtml(book.level || "Recommended")}${book.difficulty ? ` · ${escapeHtml(book.difficulty)}` : ""}</span>
              <h3>${escapeHtml(book.title || "Untitled")}</h3>
              <p>${escapeHtml(book.author || "Unknown")}</p>
              <small>${escapeHtml(book.reason || "")}</small>
            </div>
            <div class="path-book-actions">
              <button class="btn btn-secondary btn-sm" data-action="toggle" data-book="${book.id}">${book.completed ? "Finished" : "Mark complete"}</button>
              <button class="path-book-remove" data-action="remove" data-book="${book.id}">${svg("x", "icon-inline")}</button>
            </div>
          </div>`).join("")}
      </div>
      <div class="path-add">
        <input type="text" class="path-add-title" list="libraryTitles" placeholder="Add a book by title">
        <input type="text" class="path-add-author" placeholder="Author (optional)">
        <button class="btn btn-secondary" data-action="add">${svg("plus", "icon-inline")} Add</button>
      </div>
      <button class="btn btn-secondary complete-next-btn" data-action="next" ${allBooksDone ? "disabled" : ""}>Mark next book complete</button>
      ${renderCompletePathButton(path, { completed, total, allBooksDone })}
    </div>`;
}

function renderPassportStamp(path) {
  const C = Completion();
  const P = Passport();
  const daysTaken = C?.daysTaken(path, path.completed_at) || 0;
  const badgeTitle = path.completion_badge_title || "Path Scholar";
  const review = P?.getReview(path.id);

  return `
    <article class="passport-stamp card" data-path="${path.id}">
      <div class="passport-stamp-perforation"></div>
      <div class="passport-stamp-icon">${path.path_icon || "📖"}</div>
      <h3>${escapeHtml(path.path_name)}</h3>
      <p class="passport-stamp-status">Completed · ${P?.formatMonthYear(path.completed_at)}</p>
      <div class="passport-stamp-meta">
        <span>${path.books?.length || 0} Books</span>
        <span>${daysTaken} Days</span>
        <span>${escapeHtml(C?.difficultyLabel(path))}</span>
      </div>
      <div class="passport-stamp-badge">${svg("trophy", "icon-inline")} ${escapeHtml(badgeTitle)}</div>
      ${review ? `<p class="passport-stamp-review">${"★".repeat(review.rating)}${review.recommend ? " · Recommended" : ""}</p>` : ""}
      <button type="button" class="btn btn-secondary btn-sm" data-action="restart">${svg("refresh", "icon-inline")} Reread journey</button>
    </article>`;
}

function renderSecretCard(secret, unlocked, alreadyHas) {
  if (unlocked) {
    return `
      <div class="secret-path-card secret-path-unlocked card">
        <div class="secret-path-icon">${secret.path_icon}</div>
        <h3>${escapeHtml(secret.path_name)}</h3>
        <p>${escapeHtml(secret.why_this_path)}</p>
        <span class="secret-path-tier">${secret.tier === "legendary" ? "Legendary" : "Advanced"}</span>
        <button type="button" class="btn btn-primary btn-sm" data-action="discover-secret" data-secret="${secret.secret_id}">
          ${alreadyHas ? "View journey" : "Discover path"}
        </button>
      </div>`;
  }
  return `
    <div class="secret-path-card secret-path-locked card">
      <div class="secret-path-lock">${svg("lock", "icon-inline")}</div>
      <div class="secret-path-icon secret-path-icon-muted">${secret.path_icon}</div>
      <h3>???</h3>
      <p class="secret-unlock-hint">Unlock: ${escapeHtml(secret.unlockLabel)}</p>
    </div>`;
}

function renderRatedPathCard(item, isCommunity = false) {
  if (isCommunity) {
    return `
      <div class="rated-path-card card">
        <p class="eyebrow">${escapeHtml(item.genre)}</p>
        <h3>${escapeHtml(item.path_name)}</h3>
        <p class="rated-path-score">★ ${item.rating} · ${item.completions.toLocaleString()} readers</p>
        <span class="rated-path-tag">Community favorite</span>
      </div>`;
  }
  const { path, review } = item;
  return `
    <div class="rated-path-card card">
      <h3>${escapeHtml(path.path_name)}</h3>
      <p class="rated-path-score">${"★".repeat(review.rating)} <span>${review.rating}/5</span></p>
      ${review.surprise ? `<p class="rated-path-quote">"${escapeHtml(review.surprise)}"</p>` : ""}
      ${review.recommend ? `<span class="rated-path-tag">You'd recommend this</span>` : ""}
    </div>`;
}

function renderPassportStats(paths) {
  const C = Completion();
  const P = Passport();
  if (!passportStatsBar || !C || !P) return;
  const stats = C.readStats();
  const ps = P.passportStats(paths, stats);
  passportStatsBar.innerHTML = `
    <div class="passport-stat"><span>📖</span><strong>${ps.pathsCompleted}</strong><small>Paths Completed</small></div>
    <div class="passport-stat"><span>🔥</span><strong>${ps.activePaths}</strong><small>Active Paths</small></div>
    <div class="passport-stat"><span>⭐</span><strong>${ps.avgCompletionDays || "—"}${ps.avgCompletionDays ? "d" : ""}</strong><small>Avg. Completion</small></div>
    <div class="passport-stat"><span>📚</span><strong>${ps.totalBooks}</strong><small>Books Through Paths</small></div>
    <div class="passport-stat"><span>🏅</span><strong>${ps.legendaryFinished}</strong><small>Legendary Finished</small></div>
    <div class="passport-stat"><span>✓</span><strong>${ps.completionPct}%</strong><small>Completion</small></div>`;
}

function renderPaths(result) {
  const paths = orderPaths(result.paths || []);
  const C = Completion();
  const P = Passport();
  const activePaths = paths.filter(p => !p.path_completed);
  const completedPaths = paths.filter(p => p.path_completed);
  const stats = C?.readStats() || { pathsCompleted: 0 };

  pathsMessage.style.display = "block";
  pathsMessage.innerHTML = activePaths.length
    ? `<h2>${escapeHtml(result.message || "Your reading journeys await.")}</h2>`
    : completedPaths.length
      ? `<h2>All journeys complete — explore your passport below.</h2>`
      : `<h2>${escapeHtml(result.message || "Start your first reading journey.")}</h2>`;

  if (!paths.length) {
    pathsMessage.innerHTML += `<p>Click "Generate My Journey" or discover hidden paths as you read.</p>`;
    activePathsSection.hidden = true;
    passportSection.hidden = true;
    secretPathsSection.hidden = true;
    ratedPathsSection.hidden = true;
    return;
  }

  activePathsSection.hidden = !activePaths.length;
  activePathsGrid.innerHTML = activePaths.map((p, i) => renderActivePathCard(p, i)).join("");

  if (P) {
    secretPathsSection.hidden = false;
    secretPathsGrid.innerHTML = P.SECRET_PATHS.map(secret => {
      const unlocked = P.checkUnlock(secret, stats, paths);
      const alreadyHas = paths.some(p => p.secret_id === secret.secret_id);
      return renderSecretCard(secret, unlocked, alreadyHas);
    }).join("");
  }

  if (completedPaths.length) {
    passportSection.hidden = false;
    renderPassportStats(paths);
    passportGrid.innerHTML = completedPaths.map(renderPassportStamp).join("");
  } else {
    passportSection.hidden = true;
  }

  const userRated = P?.highlyRatedUserPaths(paths) || [];
  const community = P?.FEATURED_JOURNEYS || [];
  if (userRated.length || community.length) {
    ratedPathsSection.hidden = false;
    ratedPathsGrid.innerHTML =
      userRated.map(item => renderRatedPathCard(item)).join("") +
      community.map(item => renderRatedPathCard(item, true)).join("");
  } else {
    ratedPathsSection.hidden = true;
  }

  let datalist = document.getElementById("libraryTitles");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "libraryTitles";
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = libraryTitleOptions();

  if (window.BookCover) {
    BookCover.seedFromBooks(paths.flatMap(p => p.books || []));
    BookCover.hydrateLazy(activePathsGrid, { imgClass: "path-book-cover-img book-cover-img" });
  }

  activePathsGrid.querySelector(".path-card-focus")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handlePathGridClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const card = button.closest(".path-card, .passport-stamp");
  const pathId = card?.dataset?.path;
  const action = button.dataset.action;

  if (action === "toggle") toggleComplete(pathId, button.dataset.book);
  else if (action === "remove") removeBookFromPath(pathId, button.dataset.book);
  else if (action === "next") completeNext(pathId);
  else if (action === "add") {
    addBookToPath(pathId, card.querySelector(".path-add-title").value, card.querySelector(".path-add-author").value);
  } else if (action === "complete-path") completeReadingPath(pathId);
  else if (action === "restart") restartPath(pathId);
  else if (action === "discover-secret") discoverSecretPath(button.dataset.secret);
}

activePathsGrid?.addEventListener("click", handlePathGridClick);
passportGrid?.addEventListener("click", handlePathGridClick);
secretPathsGrid?.addEventListener("click", handlePathGridClick);
