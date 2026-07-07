const BookMindIcons = {
  book: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  heart: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  check: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>',
  ban: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  cart: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
};

function getTimeGreeting(name) {
  const hour = new Date().getHours();
  let period = "morning";
  if (hour >= 12 && hour < 17) period = "afternoon";
  else if (hour >= 17) period = "evening";
  return `Good ${period}, ${name}`;
}

function computeStreak(activity) {
  const set = new Set(activity || []);
  if (set.size === 0) return 0;
  const dateKey = dt => {
    const offset = dt.getTimezoneOffset() * 60000;
    return new Date(dt - offset).toISOString().slice(0, 10);
  };
  const cursor = new Date();
  if (!set.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(dateKey(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderContinueReading() {
  const section = document.getElementById("continueReadingSection");
  const card = document.getElementById("continueReadingCard");
  if (!section || !card) return;

  const reading = BookMindLibrary.getLibrary().reading || [];
  if (!reading.length) {
    section.hidden = true;
    return;
  }

  const book = reading[0];
  const { current, total, percent } = BookMindLibrary.getProgressInfo(book);
  const pagesLeft = total > 0 ? Math.max(0, total - current) : null;

  const coverHtml = window.BookMindCoverImage
    ? BookMindCoverImage.html(book, { imgClass: "book-cover-img", wrapClass: "continue-cover book-cover-wrap" })
    : `<div class="continue-cover"><div class="premium-book-placeholder mystery-cover"></div></div>`;

  card.innerHTML = `
    ${coverHtml}
    <div class="continue-reading-info">
      <p class="eyebrow">Continue Reading</p>
      <h2>${BookMindCoverImage?.escape?.(book.title) || book.title}</h2>
      <p class="book-author">${book.author || "Unknown Author"}</p>
      <div class="continue-progress-bar"><div class="continue-progress-fill" style="width:${percent}%"></div></div>
      <p class="continue-progress-meta">${percent}% complete${pagesLeft != null ? ` · ${pagesLeft} pages left` : ""}</p>
    </div>
    <button class="btn btn-primary" type="button" id="continueReadingBtn">Continue</button>
  `;

  section.hidden = false;
  document.getElementById("continueReadingBtn")?.addEventListener("click", () => {
    localStorage.setItem("selectedBook", JSON.stringify({ ai_recommendation: book, book_data: null }));
    window.location.href = "book-details.html";
  });

  if (window.BookMindCoverImage) {
    BookMindCoverImage.hydrateLazy(card, { imgClass: "book-cover-img" });
  }
}

function renderRecentlyAdded() {
  const shelf = document.getElementById("recentlyAdded");
  if (!shelf) return;

  const books = BookMindLibrary.getBooks().slice(0, 8);
  if (!books.length) {
    shelf.innerHTML = `<p class="small-muted" style="padding:12px 0">Add books from Discovery to see them here.</p>`;
    return;
  }

  shelf.innerHTML = books
    .map(book => {
      const cover = window.BookMindCoverImage
        ? BookMindCoverImage.html(book, { imgClass: "book-cover-img", wrapClass: "shelf-book-cover book-cover-wrap" })
        : `<div class="shelf-book-cover"></div>`;
      return `
        <div class="shelf-book" data-title="${BookMindCoverImage?.escape?.(book.title) || book.title}">
          ${cover}
          <div class="shelf-book-title">${book.title}</div>
          <div class="shelf-book-author">${book.author || ""}</div>
        </div>`;
    })
    .join("");

  shelf.querySelectorAll(".shelf-book").forEach((el, i) => {
    el.addEventListener("click", () => {
      const book = books[i];
      localStorage.setItem("selectedBook", JSON.stringify({ ai_recommendation: book, book_data: null }));
      window.location.href = "book-details.html";
    });
  });

  if (window.BookMindCoverImage) {
    BookMindCoverImage.seedFromBooks(books);
    BookMindCoverImage.hydrateLazy(shelf, { imgClass: "book-cover-img" });
  }
}

function recommendationsSkeleton(count = 3) {
  return Array.from({ length: count }, () => `
    <div class="recommendation-card-modern card skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-cover recommendation-cover-wrap"></div>
      <div class="recommendation-info">
        <div class="skeleton skeleton-line skeleton-line-lg"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line skeleton-line-sm"></div>
      </div>
    </div>
  `).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.BookMindAuth?.whenReady) {
    await BookMindAuth.whenReady();
  }

  const user = window.BookMindAuth?.getCurrentUser();
  const name = user?.username || "Reader";

  document.getElementById("welcomeText").textContent = window.BookMindAuth?.isLoggedIn()
    ? getTimeGreeting(name)
    : "Welcome to BookMindAI";

  const recommendationsEl = document.getElementById("recommendations");
  if (recommendationsEl) {
    recommendationsEl.innerHTML = recommendationsSkeleton(3);
  }

  await Promise.all([
    window.BookMindUserData?.hydrate?.().catch(() => {}),
    BookMindLibrary.ensureLoaded().catch(() => {}),
  ]);

  let profile = BookMindUI.readStorageJson("readerProfile");

  const stats = BookMindLibrary.getStats();
  document.getElementById("readCount").textContent = stats.read;
  document.getElementById("readingCount").textContent = stats.reading;
  document.getElementById("wantCount").textContent = stats.want;

  const streakEl = document.getElementById("streakCount");
  if (streakEl) {
    streakEl.textContent = computeStreak(BookMindLibrary.getReadingData().activity);
  }

  renderContinueReading();
  renderRecentlyAdded();

  updateDNAProgress();
  setupMoodAndGoal();
  renderRecommendations(profile);
  loadHomeIntelligence();

  function applyIntelligence(intelligence) {
    const subtitle = document.getElementById("homeSubtitle");
    const mission = document.getElementById("todayMission");
    const topPickTitle = document.getElementById("topPickTitle");
    const topPickReason = document.getElementById("topPickReason");
    const topPickLabel = document.getElementById("topPickLabel");

    const dashboard = intelligence?.dashboard || {};
    const topPick = dashboard.top_pick || {};

    subtitle.textContent = dashboard.greeting_subtitle || "Your personalized reading world is ready.";
    mission.textContent = dashboard.today_mission || "Choose a book that matches your current mood.";
    topPickLabel.textContent = "AI Pick of the Day";
    topPickTitle.textContent = topPick.title || "Ask BookMindAI for a recommendation";
    topPickReason.textContent = topPick.reason || "Your AI pick will appear here.";

    document.getElementById("topPickBtn").onclick = function () {
      const item = {
        ai_recommendation: {
          title: topPick.title,
          author: topPick.author,
          genre: topPick.genre,
          difficulty: "AI Pick",
          reason: topPick.reason,
        },
        book_data: topPick.cover_url ? { cover_url: topPick.cover_url } : null,
      };

      localStorage.setItem("selectedBook", JSON.stringify(item));
      window.location.href = "book-details.html";
    };
  }

  async function loadHomeIntelligence({ force = false } = {}) {
    const subtitle = document.getElementById("homeSubtitle");
    const mission = document.getElementById("todayMission");

    if (!force) {
      const mood = localStorage.getItem("bookmind_today_mood");
      const goal = localStorage.getItem("bookmind_today_goal");
      const cached = BookMindAPI._readIntelligenceCache({ today_mood: mood, today_goal: goal });
      if (cached?.dashboard) {
        applyIntelligence(cached);
        return;
      }
    }

    subtitle.textContent = "BookMindAI is personalizing your dashboard…";
    mission.textContent = "Building today's mission…";

    try {
      const intelligence = await BookMindAPI.getReaderIntelligence({ force });
      applyIntelligence(intelligence);
    } catch {
      subtitle.textContent = "Your personalized reading world is ready.";
      mission.textContent = "Choose a mood and ask BookMindAI for suggestions.";
    } finally {
      updateDNAProgress();
    }
  }

  function updateDNAProgress() {
    if (window.BookMindReaderDna?.applyHomeVisibility()) {
      return;
    }

    const progressCard = document.getElementById("dnaProgressCard");
    const continueButtons = ["continueDiscoveryTop", "continueDiscoveryMain"];

    if (!progressCard) return;

    const completion = Number(localStorage.getItem("reader_profile_completion")) || 0;

    document.getElementById("dnaProgressTitle").textContent =
      completion > 0 ? `${completion}% Complete` : "Start Your Reader DNA";
    document.getElementById("dnaProgressFill").style.width = `${completion}%`;

    const subtitle = document.getElementById("dnaProgressSubtitle");

    if (completion <= 0) {
      continueButtons.forEach(id => {
        const button = document.getElementById(id);
        if (button) button.textContent = "Start Reader DNA Quiz";
      });

      if (subtitle) {
        subtitle.textContent = "Take the quiz to unlock personalized recommendations.";
      }
      return;
    }

    continueButtons.forEach(id => {
      const button = document.getElementById(id);
      if (button) button.textContent = "Continue Quiz";
    });

    if (subtitle) {
      subtitle.textContent = "Pick up where you left off and finish your Reader DNA.";
    }
  }

  function setupMoodAndGoal() {
    const moodButtons = document.querySelectorAll(".mood-options button");
    const goalButtons = document.querySelectorAll(".goal-options button");

    const savedMood = localStorage.getItem("bookmind_today_mood");
    const savedGoal = localStorage.getItem("bookmind_today_goal");

    moodButtons.forEach(button => {
      if (button.dataset.mood === savedMood) button.classList.add("active-mood");

      button.addEventListener("click", function () {
        moodButtons.forEach(btn => btn.classList.remove("active-mood"));
        this.classList.add("active-mood");
        localStorage.setItem("bookmind_today_mood", this.dataset.mood);
        localStorage.removeItem("bookmind_reader_intelligence");
        localStorage.removeItem("bookmind_intelligence_meta");
        loadHomeIntelligence({ force: true });
      });
    });

    goalButtons.forEach(button => {
      if (button.dataset.goal === savedGoal) button.classList.add("active-mood");

      button.addEventListener("click", function () {
        goalButtons.forEach(btn => btn.classList.remove("active-mood"));
        this.classList.add("active-mood");
        localStorage.setItem("bookmind_today_goal", this.dataset.goal);
        localStorage.removeItem("bookmind_reader_intelligence");
        localStorage.removeItem("bookmind_intelligence_meta");
        loadHomeIntelligence({ force: true });
      });
    });
  }

  async function renderRecommendations(currentProfile = profile) {
    if (!currentProfile) {
      currentProfile = JSON.parse(localStorage.getItem("readerProfile"));
    }
    if (!currentProfile) return;

    document.getElementById("readerType").textContent = currentProfile.reader_type || "Not available";
    document.getElementById("readingLevel").textContent =
      currentProfile.confirmed_reading_level || "Not available";
    document.getElementById("genres").textContent = (currentProfile.favorite_genres || []).join(", ");

    const container = document.getElementById("recommendations");
    container.innerHTML = "";

    if (!currentProfile.recommendations) return;

    const visibleRecommendations = currentProfile.recommendations.filter(item => {
      const rec = item.ai_recommendation || item;
      return !BookMindLibrary.findShelf(rec);
    });

    if (visibleRecommendations.length === 0) {
      container.innerHTML = `
        <div class="empty-library card">
          <h2>You're all caught up.</h2>
          <p>Want BookMindAI to find more books you haven't read, aren't reading, and haven't marked "not interested"?</p>
          <button class="btn btn-primary" id="generateMoreBtn" type="button">Yes, generate 3 more</button>
        </div>
      `;

      const generateBtn = document.getElementById("generateMoreBtn");
      if (generateBtn) generateBtn.addEventListener("click", generateMoreRecommendations);
      return;
    }

    visibleRecommendations.forEach(item => {
      const aiBook = item.ai_recommendation;
      const bookData = item.book_data;
      const genre = aiBook.genre || "BookMindAI";

      const card = document.createElement("div");
      card.className = "recommendation-card-modern card";

      const coverHTML = window.BookMindCoverImage
        ? BookMindCoverImage.html(
            { ...aiBook, ...bookData, genre },
            {
              imgClass: "recommendation-cover book-cover-img",
              wrapClass: "recommendation-cover-wrap book-cover-wrap",
              placeholderClass: "recommendation-cover book-cover-placeholder",
            }
          )
        : bookData && bookData.cover_url
        ? `
          <div class="recommendation-cover-wrap">
            <img class="recommendation-cover" src="${bookData.cover_url}" alt="${aiBook.title} cover" loading="lazy" decoding="async">
          </div>`
        : `<div class="recommendation-cover-wrap"><div class="recommendation-cover fallback-cover"></div></div>`;

      card.innerHTML = `
      ${coverHTML}

      <div class="recommendation-info">
        <h3>${aiBook.title}</h3>
        <p class="book-author">${aiBook.author || "Unknown Author"}</p>

        <div class="book-meta">
          <span>${genre}</span>
          <span>${aiBook.difficulty || "Recommended"}</span>
        </div>

        <p class="reason">${aiBook.reason || ""}</p>

        <div class="book-actions">
          <button class="mini-btn save-btn" data-status="reading">${BookMindIcons.book} Reading</button>
          <button class="mini-btn save-btn" data-status="want">${BookMindIcons.heart} Want</button>
          <button class="mini-btn save-btn" data-status="read">${BookMindIcons.check} Finished</button>
          <button class="mini-btn save-btn" data-status="not_interested">${BookMindIcons.ban} Not Interested</button>
          <button class="mini-btn buy-btn">${BookMindIcons.cart} Buy</button>
        </div>
      </div>
    `;

      card.addEventListener("click", function () {
        localStorage.setItem("selectedBook", JSON.stringify(item));
        window.location.href = "book-details.html";
      });

      card.querySelectorAll(".save-btn").forEach(button => {
        button.addEventListener("click", async function (event) {
          event.stopPropagation();
          button.disabled = true;
          try {
            await BookMindLibrary.addBook(aiBook, this.dataset.status);
            profile = JSON.parse(localStorage.getItem("readerProfile"));
            renderRecommendations(profile);
          } catch {
            /* shelf update failed */
          } finally {
            button.disabled = false;
          }
        });
      });

      card.querySelector(".buy-btn").addEventListener("click", function (event) {
        event.stopPropagation();
        window.open(
          `https://www.google.com/maps/search/${encodeURIComponent(aiBook.title + " bookstore near me")}`,
          "_blank"
        );
      });

      container.appendChild(card);
    });

    if (window.BookMindCoverImage) {
      const coverBooks = visibleRecommendations.map(item => ({
        ...item.ai_recommendation,
        ...item.book_data,
        genre: item.ai_recommendation?.genre || "BookMindAI",
      }));
      BookMindCoverImage.seedFromBooks(coverBooks);
      BookMindCoverImage.hydrateLazy(container, {
        imgClass: "recommendation-cover book-cover-img",
      });
    }
  }

  async function generateMoreRecommendations() {
    const container = document.getElementById("recommendations");
    const button = document.getElementById("generateMoreBtn");

    if (button) {
      button.disabled = true;
      button.textContent = "Finding books…";
    }

    container.innerHTML = recommendationsSkeleton(3);

    try {
      const result = await BookMindAPI.post("/api/reader/companion", {
        question:
          "Recommend 3 books I haven't read yet, based on my Reader DNA, favorite genres, ratings, and reviews. Only suggest books that are not already in my library.",
        reader_profile: await BookMindAPI.getReaderContext(),
      });

      const fresh = (result.recommendations || [])
        .filter(book => !BookMindLibrary.findShelf(book))
        .slice(0, 3);

      if (fresh.length === 0) {
        container.innerHTML = `
        <div class="empty-library card">
          <h2>No new books right now.</h2>
          <p>Add a few ratings or reviews, or ask the AI Companion for ideas, then try again.</p>
        </div>
      `;
        return;
      }

      const mergeItems = fresh.map(book => ({
        title: book.title,
        author: book.author,
        genre: book.genre,
        reason: book.reason,
        difficulty: book.difficulty || "AI Pick",
        cover_url: book.cover_url || null,
      }));

      const newItems = mergeItems.map(book => ({
        ai_recommendation: {
          title: book.title,
          author: book.author,
          genre: book.genre,
          difficulty: book.difficulty || "AI Pick",
          reason: book.reason,
          cover_url: book.cover_url || null,
        },
        book_data: book.cover_url
          ? {
              title: book.title,
              author: book.author,
              genre: book.genre,
              cover_url: book.cover_url,
            }
          : null,
      }));

      const stored = JSON.parse(localStorage.getItem("readerProfile")) || {};
      stored.recommendations = [...(stored.recommendations || []), ...newItems];
      localStorage.setItem("readerProfile", JSON.stringify(stored));

      profile = stored;
      renderRecommendations(profile);
    } catch {
      container.innerHTML = `
      <div class="empty-library card">
        <h2>Couldn't generate more.</h2>
        <p>Please try again in a moment.</p>
      </div>
    `;
    }
  }
});
