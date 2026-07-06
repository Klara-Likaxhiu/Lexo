let currentBook = null;
let selectedRating = 0;
let selectedRecommend = "";
let bookKey = "";
let bookCover = null;

initialize();

function getUserId() {
  const user = window.BookMindAuth?.getCurrentUser();
  return user?.id || "anonymous";
}

function getUserName() {
  const user = window.BookMindAuth?.getCurrentUser();
  return user?.username || "Anonymous Reader";
}

function reviewId() {
  return `${getUserId()}:${bookKey}`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initialize() {
  void initBookDetails();
}

async function initBookDetails() {
  if (window.BookMindAuth?.whenReady) {
    await BookMindAuth.whenReady();
  }

  const saved = JSON.parse(localStorage.getItem("selectedBook"));

  if (!saved || !saved.ai_recommendation) {
    window.location.href = "library.html";
    return;
  }

  currentBook = saved.ai_recommendation;
  bookKey = BookMindLibrary.normalizeTitle(currentBook.title);
  bookCover = (saved.book_data && saved.book_data.cover_url) || currentBook.cover_url || null;

  renderBook(saved);

  setupShelfButtons();
  setupAddDropdown();
  setupRating();
  setupRecommend();
  setupProgress();
  setupReview();
  setupDeleteReview();
  setupReadingSource();
  setupSidebarDna();

  BookMindLibrary.ensureLoaded()
    .then(() => {
      restoreShelf();
      restoreProgress();
      restoreSource();
      refreshMotivation();
      const entry = BookMindLibrary.findBook(currentBook);
      if (entry?.library_id) {
        BookMindLibrary.recordBookOpened(entry.library_id);
      }
    })
    .catch(error => console.error(error));

  restoreReview();
  loadBookCommunity();
}

function setupSidebarDna() {
  const percentEl = document.getElementById("sidebarDnaPercent");
  const fillEl = document.getElementById("sidebarDnaFill");
  if (!percentEl || !fillEl) return;

  const completion = Number(localStorage.getItem("reader_profile_completion")) || 25;
  percentEl.textContent = completion + "%";
  fillEl.style.width = completion + "%";
}

/* ---------------------------------------------------------------- render */

function renderBook(data) {
  const aiBook = data.ai_recommendation;
  const book = data.book_data;

  setText("detailTitle", aiBook.title || "Untitled Book");
  setText("detailAuthor", aiBook.author || "Unknown Author");
  setText("detailGenre", aiBook.genre || "Book");
  setText("detailDifficulty", aiBook.difficulty || "Recommended");
  setText("detailReason", aiBook.reason || "No description available yet.");

  const year = book && book.first_publish_year;
  if (year) {
    setText("detailYear", year);
    const chip = document.getElementById("detailYearChip");
    if (chip) chip.hidden = false;
  }

  renderCover(aiBook, book);

  const encoded = encodeURIComponent(aiBook.title || "");
  document.getElementById("googleBooksLink").href =
    `https://books.google.com/books?q=${encoded}`;
  document.getElementById("openLibraryLink").href =
    `https://openlibrary.org/search?q=${encoded}`;
  document.getElementById("mapsLink").href =
    `https://www.google.com/maps/search/${encodeURIComponent((aiBook.title || "") + " bookstore near me")}`;
}

function renderCover(aiBook, book) {
  const cover = document.getElementById("detailCover");
  const coverUrl = (book && book.cover_url) || aiBook.cover_url;

  if (coverUrl) {
    const img = document.createElement("img");
    img.className = "bd-cover-img";
    img.src = coverUrl;
    img.alt = `${aiBook.title || "Book"} cover`;
    img.onerror = () => {
      cover.innerHTML = `<div class="bd-cover-fallback"></div>`;
    };
    cover.innerHTML = "";
    cover.appendChild(img);
  } else {
    cover.innerHTML = `<div class="bd-cover-fallback"></div>`;
  }
}

/* --------------------------------------------------------------- shelves */

function setupShelfButtons() {
  document.querySelectorAll(".status-btn-modern").forEach(button => {
    button.addEventListener("click", async () => {
      const status = button.dataset.status;

      if (window.BookMindAuth?.logShelfAuthDebug) {
        await BookMindAuth.logShelfAuthDebug("book-details shelf button click", {
          status,
          currentShelf: getCurrentShelf(),
          book: currentBook?.title,
        });
      }

      button.disabled = true;

      try {
        await BookMindLibrary.ensureLoaded();
        const current = getCurrentShelf();
        if (current === status) {
          await BookMindLibrary.removeBook(currentBook, { silent: true });
          toast(`Removed "${currentBook.title}" from your shelves.`);
        } else {
          const saved = await moveToShelf(status);
          toast(saved?.message || `Moved to ${BookMindLibrary.getShelfLabel(status)}.`);
        }

        await BookMindLibrary.refresh();
        restoreShelf();
        refreshMotivation();
        window.BookMindLibraryPage?.refresh?.();
      } catch (error) {
        console.error("[BookDetails] shelf update failed", error);
        toast(error.message || "Could not update shelf.", true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function setupAddDropdown() {
  const select = document.getElementById("addToLibrary");
  if (!select) return;
  select.addEventListener("change", async () => {
    const status = select.value;
    if (!status) return;
    try {
      const saved = await moveToShelf(status);
      toast(saved?.message || `Moved to ${BookMindLibrary.getShelfLabel(status)}.`);
      await BookMindLibrary.refresh();
      restoreShelf();
      refreshMotivation();
    } catch (error) {
      console.error("[BookDetails] shelf dropdown update failed", error);
      toast(error.message || "Could not update shelf.", true);
    }
  });
}

async function moveToShelf(status) {
  const shelf = BookMindLibrary.normalizeStatus(status);
  const meta = {
    source: getSavedSource() || undefined,
    totalPages: document.getElementById("totalPages")?.value,
    progress: shelf === "read" ? 100 : getSavedPercent(),
  };
  const data = await BookMindLibrary.saveBook(currentBook, shelf, meta);
  return data;
}

function getSavedSource() {
  const entry = BookMindLibrary.findBook(currentBook);
  if (entry?.metadata?.source) return entry.metadata.source;

  const sources = JSON.parse(localStorage.getItem("reading_sources")) || {};
  return sources[bookKey] || "";
}

function getCurrentShelf() {
  return BookMindLibrary.findShelf(currentBook);
}

function restoreShelf() {
  const current = getCurrentShelf();

  document.querySelectorAll(".status-btn-modern").forEach(button => {
    button.classList.toggle("active", button.dataset.status === current);
  });

  const addSelect = document.getElementById("addToLibrary");
  if (addSelect) addSelect.value = current || "";
}

/* -------------------------------------------------------------- progress */

function setupProgress() {
  const currentInput = document.getElementById("currentPage");
  const totalInput = document.getElementById("totalPages");

  const preview = () => setProgressUI(computePercent(currentInput.value, totalInput.value));
  currentInput.addEventListener("input", preview);
  totalInput.addEventListener("input", preview);

  document.getElementById("saveProgressBtn").addEventListener("click", async () => {
    const current = Number(currentInput.value);
    const total = Number(totalInput.value);

    if (!total || total <= 0) {
      toast("Enter total pages.", true);
      return;
    }
    if (current < 0) {
      toast("Current page cannot be negative.", true);
      return;
    }
    if (current > total) {
      toast("Current page cannot be greater than total pages.", true);
      return;
    }

    const percent = computePercent(current, total);
    setProgressUI(percent);

    const entry = BookMindLibrary.findBook(currentBook);
    if (!entry?.library_id) {
      toast("Add this book to your library first.", true);
      return;
    }

    try {
      const result = await BookMindLibrary.updateReadingProgress(
        entry.library_id,
        current,
        total,
        { silent: true }
      );

      restoreShelf();
      if (result.finished) {
        toast("🎉 Finished! Moved to your Finished shelf.");
      } else {
        toast(result.message || "Reading progress saved.");
      }
      refreshMotivation();
    } catch (error) {
      toast(error.message || "Could not save progress.", true);
    }
  });
}

function computePercent(current, total) {
  const c = Number(current);
  const t = Number(total);
  if (!c || !t || t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((c / t) * 100)));
}

function setProgressUI(percent) {
  document.getElementById("bookProgressFill").style.width = percent + "%";
  document.getElementById("progressText").textContent = percent + "%";
}

function getSavedPercent() {
  const entry = BookMindLibrary.findBook(currentBook);
  return entry ? Number(entry.progress) || 0 : 0;
}

function restoreProgress() {
  const entry = BookMindLibrary.findBook(currentBook);
  const { current, total, percent } = BookMindLibrary.getProgressInfo(entry || {});

  if (!entry || (!total && !percent)) {
    setProgressUI(0);
    return;
  }

  document.getElementById("currentPage").value = current || "";
  document.getElementById("totalPages").value = total || "";
  setProgressUI(percent);
}

/* ---------------------------------------------------------------- source */

function setupReadingSource() {
  document.getElementById("readingSource").addEventListener("change", updateOpenAction);

  document.getElementById("saveSourceBtn").addEventListener("click", () => {
    const source = document.getElementById("readingSource").value;

    if (!source) {
      toast("Please choose a reading source.", true);
      return;
    }

    const sources = JSON.parse(localStorage.getItem("reading_sources")) || {};
    sources[bookKey] = source;
    localStorage.setItem("reading_sources", JSON.stringify(sources));

    updateOpenAction();
    toast("Reading source saved.");
  });

  const fileInput = document.getElementById("localFileInput");
  if (fileInput) {
    fileInput.addEventListener("change", event => {
      const file = event.target.files[0];
      if (!file) return;
      window.open(URL.createObjectURL(file), "_blank");
    });
  }
}

function restoreSource() {
  const sources = JSON.parse(localStorage.getItem("reading_sources")) || {};
  if (sources[bookKey]) {
    document.getElementById("readingSource").value = sources[bookKey];
  }
  updateOpenAction();
}

function updateOpenAction() {
  const openBtn = document.getElementById("openBookBtn");
  const fileWrap = document.getElementById("fileOpenWrap");
  if (!openBtn || !fileWrap) return;

  const source = document.getElementById("readingSource").value;
  const title = encodeURIComponent(currentBook.title || "");

  openBtn.hidden = true;
  fileWrap.hidden = true;

  const storeLinks = {
    kindle: { label: "Open in Kindle", url: `https://www.amazon.com/s?k=${title}&i=digital-text` },
    apple_books: { label: "Open in Apple Books", url: `https://books.apple.com/search?term=${title}` },
    google_books: { label: "Read on Google Books", url: `https://books.google.com/books?q=${title}` },
    kobo: { label: "Open in Kobo", url: `https://www.kobo.com/search?query=${title}` },
    audiobook: { label: "Find Audiobook", url: `https://www.audible.com/search?keywords=${title}` }
  };

  if (storeLinks[source]) {
    openBtn.textContent = storeLinks[source].label;
    openBtn.href = storeLinks[source].url;
    openBtn.hidden = false;
  } else if (source === "pdf" || source === "epub") {
    fileWrap.hidden = false;
  }
}

/* ---------------------------------------------------------------- rating */

function setupRating() {
  document.querySelectorAll("#starRating button").forEach(button => {
    button.addEventListener("click", () => {
      selectedRating = Number(button.dataset.rating);
      paintStars(selectedRating);
      const hint = document.getElementById("ratingHint");
      if (hint) hint.textContent = `You rated this ${selectedRating}/5`;
    });
  });
}

function paintStars(rating) {
  document.querySelectorAll("#starRating button").forEach(star => {
    const isOn = Number(star.dataset.rating) <= rating;
    star.textContent = isOn ? "★" : "☆";
    star.classList.toggle("on", isOn);
  });
}

/* ------------------------------------------------------------- recommend */

function setupRecommend() {
  const select = document.getElementById("recommendBook");
  if (!select) return;
  select.addEventListener("change", () => {
    selectedRecommend = select.value;
  });
}

function paintRecommend(value) {
  const select = document.getElementById("recommendBook");
  if (select) select.value = value || "";
}

/* ---------------------------------------------------------------- review */

function setupReview() {
  const textarea = document.getElementById("reviewText");
  const counter = document.getElementById("reviewCount");
  if (counter) {
    textarea.addEventListener("input", () => {
      counter.textContent = textarea.value.length;
    });
  }

  document.getElementById("saveReviewBtn").addEventListener("click", async () => {
    if (selectedRating === 0) {
      toast("Please choose a star rating first.", true);
      return;
    }

    const saveBtn = document.getElementById("saveReviewBtn");
    saveBtn.disabled = true;

    const reviews = JSON.parse(localStorage.getItem("book_reviews")) || [];
    const existingIndex = reviews.findIndex(
      r => BookMindLibrary.normalizeTitle(r.title) === bookKey
    );
    const existing = existingIndex >= 0 ? reviews[existingIndex] : null;
    const isPublic = document.getElementById("reviewPublic").checked;

    const review = {
      id: reviewId(),
      key: bookKey,
      title: currentBook.title,
      author: currentBook.author || "",
      genre: currentBook.genre || "",
      cover_url: bookCover,
      rating: selectedRating,
      recommend: selectedRecommend,
      difficulty: document.getElementById("difficultyFeedback").value,
      reviewTitle: document.getElementById("reviewTitle").value,
      reviewText: textarea.value,
      visibility: isPublic ? "public" : "private",
      created: (existing && existing.created) || new Date().toISOString(),
      updated: new Date().toISOString()
    };

    try {
      if (existingIndex >= 0) {
        reviews[existingIndex] = review;
      } else {
        reviews.push(review);
      }

      localStorage.setItem("book_reviews", JSON.stringify(reviews));

      const deleteBtn = document.getElementById("deleteReviewBtn");
      if (deleteBtn) deleteBtn.hidden = false;

      await syncReviewVisibility(review);
      await loadBookCommunity();
      toast(isPublic ? "Review saved and shared with the community." : "Review saved.");
    } catch (error) {
      console.error("[BookDetails] save review failed", error);
      toast(error.message || "Could not save review.", true);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

async function syncReviewVisibility(review) {
  if (!window.BookMindAPI?.post) {
    throw new Error("BookMindAPI is not loaded.");
  }

  const me = await BookMindAPI.getMe({ redirect: true });
  if (!me) {
    throw new Error("Sign in to share reviews with the community.");
  }

  if (review.visibility === "public") {
    await BookMindAPI.post("/api/reviews/publish", {
      id: review.id,
      user: me.username || "Reader",
      book_title: review.title,
      author: review.author,
      genre: review.genre,
      cover_url: review.cover_url,
      rating: review.rating,
      review_title: review.reviewTitle,
      review_text: review.reviewText,
      recommend: review.recommend,
      created: review.created,
    });
  } else {
    await BookMindAPI.post("/api/reviews/unpublish", { id: review.id });
  }
}

function setupDeleteReview() {
  const button = document.getElementById("deleteReviewBtn");
  if (!button) return;

  button.addEventListener("click", async () => {
    button.disabled = true;

    const reviews = JSON.parse(localStorage.getItem("book_reviews")) || [];
    const remaining = reviews.filter(
      r => BookMindLibrary.normalizeTitle(r.title) !== bookKey
    );
    const removedId = reviewId();

    try {
      localStorage.setItem("book_reviews", JSON.stringify(remaining));

      selectedRating = 0;
      paintStars(0);
      selectedRecommend = "";
      paintRecommend("");
      document.getElementById("reviewPublic").checked = false;
      document.getElementById("reviewTitle").value = "";
      document.getElementById("reviewText").value = "";
      document.getElementById("difficultyFeedback").value = "";
      const hint = document.getElementById("ratingHint");
      if (hint) hint.textContent = "Click a star to rate";
      button.hidden = true;

      if (window.BookMindAPI?.post) {
        await BookMindAPI.post("/api/reviews/unpublish", { id: removedId });
      }

      await loadBookCommunity();
      toast("Review deleted.");
    } catch (error) {
      console.error("[BookDetails] delete review failed", error);
      toast(error.message || "Could not delete review.", true);
    } finally {
      button.disabled = false;
    }
  });
}

/* ------------------------------------------------------ community reviews */

async function loadBookCommunity() {
  const section = document.getElementById("bookCommunitySection");
  const list = document.getElementById("bookCommunityList");
  if (!section || !list || !currentBook) return;

  try {
    if (!window.BookMindAPI?.get) {
      throw new Error("BookMindAPI is not loaded.");
    }

    const data = await BookMindAPI.get(
      `/api/reviews/community?book=${encodeURIComponent(currentBook.title || "")}`,
      { auth: false }
    );

    updateAverageRating(data.average_rating, data.rating_count);

    const reviews = data.reviews || [];
    if (reviews.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    list.innerHTML = reviews.map(renderCommunityCard).join("");
  } catch (error) {
    console.error(error);
  }
}

function updateAverageRating(average, count) {
  const starsEl = document.getElementById("avgStars");
  const ratingEl = document.getElementById("avgRating");
  const labelEl = document.getElementById("avgRatingLabel");
  if (!starsEl || !ratingEl || !labelEl) return;

  if (!count || !average) {
    starsEl.textContent = "☆ ☆ ☆ ☆ ☆";
    ratingEl.textContent = "—";
    labelEl.textContent = "No ratings yet";
    return;
  }

  const rounded = Math.round(average);
  starsEl.textContent = ("★ ".repeat(rounded) + "☆ ".repeat(5 - rounded)).trim();
  ratingEl.textContent = Number(average).toFixed(1);
  labelEl.textContent = `${count} community rating${count === 1 ? "" : "s"}`;
}

function renderCommunityCard(review) {
  const rating = Number(review.rating) || 0;
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const date = review.updated || review.created;
  const dateStr = date ? new Date(date).toLocaleDateString() : "";

  return `
    <div class="community-review">
      <div class="community-review-head">
        <strong>${escapeHtml(review.user || "Anonymous Reader")}</strong>
        <span class="community-stars">${stars}</span>
      </div>
      ${review.review_title ? `<p class="community-review-title">${escapeHtml(review.review_title)}</p>` : ""}
      ${review.review_text ? `<p class="community-review-text">${escapeHtml(review.review_text)}</p>` : ""}
      <span class="community-review-date">${dateStr}</span>
    </div>
  `;
}

function restoreReview() {
  const reviews = JSON.parse(localStorage.getItem("book_reviews")) || [];
  const saved = reviews.find(
    r => BookMindLibrary.normalizeTitle(r.title) === bookKey
  );

  if (!saved) return;

  selectedRating = saved.rating || 0;
  paintStars(selectedRating);
  const hint = document.getElementById("ratingHint");
  if (selectedRating && hint) {
    hint.textContent = `You rated this ${selectedRating}/5`;
  }

  selectedRecommend = saved.recommend || "";
  paintRecommend(selectedRecommend);

  document.getElementById("difficultyFeedback").value = saved.difficulty || "";
  document.getElementById("reviewTitle").value = saved.reviewTitle || "";

  const textarea = document.getElementById("reviewText");
  textarea.value = saved.reviewText || "";
  const counter = document.getElementById("reviewCount");
  if (counter) counter.textContent = textarea.value.length;

  const publicToggle = document.getElementById("reviewPublic");
  if (publicToggle) publicToggle.checked = saved.visibility === "public";

  const deleteBtn = document.getElementById("deleteReviewBtn");
  if (deleteBtn) deleteBtn.hidden = false;

  renderSavedReview(saved);
}

function renderSavedReview(review) {
  const box = document.getElementById("savedReview");
  if (!box) return;
  box.hidden = false;

  document.getElementById("savedReviewStars").textContent =
    "★".repeat(review.rating) + "☆".repeat(5 - review.rating);

  document.getElementById("savedReviewDate").textContent =
    review.created ? new Date(review.created).toLocaleDateString() : "";

  document.getElementById("savedReviewTitle").textContent =
    review.reviewTitle || "Your review";

  document.getElementById("savedReviewText").textContent =
    review.reviewText || "No written review.";

  const tags = document.getElementById("savedReviewTags");
  tags.innerHTML = "";

  if (review.recommend) {
    const tag = document.createElement("span");
    tag.textContent = review.recommend === "yes" ? "👍 Recommends" : "👎 Wouldn't recommend";
    tags.appendChild(tag);
  }

  if (review.difficulty) {
    const tag = document.createElement("span");
    tag.textContent = difficultyLabel(review.difficulty);
    tags.appendChild(tag);
  }
}

function difficultyLabel(value) {
  const labels = {
    much_easier: "Much easier",
    easier: "Easier than expected",
    just_right: "Just right",
    hard: "Hard",
    very_difficult: "Very difficult"
  };
  return labels[value] || value;
}

/* -------------------------------------------------------- motivation card */

function refreshMotivation() {
  const title = document.getElementById("motivationTitle");
  const subtitle = document.getElementById("motivationSubtitle");
  if (!title || !subtitle) return;
  const percent = getSavedPercent();
  const shelf = getCurrentShelf();

  if (shelf === "read" || percent === 100) {
    title.textContent = "🎉 Finished!";
    subtitle.textContent = "Great job. Leave a review to help BookMindAI learn your taste.";
  } else if (percent >= 60) {
    title.textContent = "🔥 Almost there!";
    subtitle.textContent = `You're ${percent}% through. The finish line is close.`;
  } else if (percent > 0) {
    title.textContent = "📈 Keep going!";
    subtitle.textContent = "You're making great progress. Consistency is the key.";
  } else if (shelf) {
    title.textContent = "🌱 Ready to start";
    subtitle.textContent = "Set your current page to begin tracking your progress.";
  } else {
    title.textContent = "🏆 Start reading!";
    subtitle.textContent = "Add this book to a shelf and track your progress.";
  }
}

/* ----------------------------------------------------------------- utils */

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

let toastTimer = null;
function toast(message, isError = false) {
  const el = document.getElementById("bdToast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  el.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2200);
}
