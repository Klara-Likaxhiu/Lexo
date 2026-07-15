const LexoIcons = {
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

  const reading = LexoLibrary.getLibrary().reading || [];
  if (!reading.length) {
    section.hidden = true;
    return;
  }

  const book = reading[0];
  const { current, total, percent } = LexoLibrary.getProgressInfo(book);
  const pagesLeft = total > 0 ? Math.max(0, total - current) : null;

  const coverHtml = window.BookCover
    ? BookCover.html(book, { imgClass: "book-cover-img", wrapClass: "continue-cover book-cover-wrap" })
    : `<div class="continue-cover"><div class="premium-book-placeholder mystery-cover"></div></div>`;

  card.innerHTML = `
    ${coverHtml}
    <div class="continue-reading-info">
      <p class="eyebrow">Continue Reading</p>
      <h2>${BookCover?.escape?.(book.title) || book.title}</h2>
      <p class="book-author">${book.author || "Unknown Author"}</p>
      <div class="continue-progress-bar"><div class="continue-progress-fill" style="width:${percent}%"></div></div>
      <p class="continue-progress-meta">${percent}% complete${pagesLeft != null ? ` · ${pagesLeft} pages left` : ""}</p>
    </div>
    <div class="continue-reading-actions">
      <button class="btn btn-primary" type="button" id="continueReadingBtn">Continue</button>
    </div>
  `;

  section.hidden = false;
  document.getElementById("continueReadingBtn")?.addEventListener("click", () => {
    localStorage.setItem("selectedBook", JSON.stringify({ ai_recommendation: book, book_data: null }));
    window.location.href = "book-details.html";
  });

  if (window.BookCover) {
    BookCover.resolveMissing([book], card, { imgClass: "book-cover-img" });
  }
}

function renderRecentlyAdded() {
  const shelf = document.getElementById("recentlyAdded");
  if (!shelf) return;

  const books = LexoLibrary.getBooks().slice(0, 8);
  if (!books.length) {
    shelf.innerHTML = `<p class="small-muted" style="padding:12px 0">Add books from Discovery to see them here.</p>`;
    return;
  }

  shelf.innerHTML = books
    .map(book => {
      const cover = window.BookCover
        ? BookCover.html(book, { imgClass: "book-cover-img", wrapClass: "shelf-book-cover book-cover-wrap" })
        : `<div class="shelf-book-cover"></div>`;
      return `
        <div class="shelf-book" data-title="${BookCover?.escape?.(book.title) || book.title}">
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

  if (window.BookCover) {
    BookCover.resolveMissing(books, shelf, { imgClass: "book-cover-img" });
  }
}

function goalProgressPct(value, goal) {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.round((value / goal) * 100));
}

function goalProgressRow(label, value, goal) {
  const pct = goalProgressPct(value, goal);
  return `
    <div class="reading-goal-row">
      <div class="reading-goal-row-top">
        <span class="reading-goal-row-label">${label}</span>
        <span class="reading-goal-row-count">${value} / ${goal}</span>
      </div>
      <div class="challenge-bar"><div style="width:${pct}%"></div></div>
      <p class="reading-goal-row-pct">${pct}% complete</p>
    </div>
  `;
}

function renderReadingGoal() {
  const body = document.getElementById("readingGoalBody");
  if (!body || !window.LexoLibrary) return;

  const { goals, booksThisYear, booksThisMonth } = LexoLibrary.getGoalProgress();
  const hasYearly = goals.yearly > 0;
  const hasMonthly = goals.monthly > 0;

  if (!hasYearly && !hasMonthly) {
    body.innerHTML = `
      <div class="reading-goal-empty">
        <p class="reading-goal-empty-text">You haven't set a reading goal yet. Set one to track your progress here.</p>
        <button type="button" class="btn btn-primary" id="setReadingGoalsBtn">Set Reading Goals</button>
      </div>
    `;
    document.getElementById("setReadingGoalsBtn")?.addEventListener("click", () => {
      window.location.href = "challenges.html#goalsSection";
    });
    return;
  }

  body.innerHTML = [
    hasYearly ? goalProgressRow("Books this year", booksThisYear, goals.yearly) : "",
    hasMonthly ? goalProgressRow("Books this month", booksThisMonth, goals.monthly) : "",
  ].join("");
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

document.addEventListener("DOMContentLoaded", () => {
  window.LexoPerf?.startPageLoad?.();

  const welcomeEl = document.getElementById("welcomeText");
  const recommendationsEl = document.getElementById("recommendations");
  if (recommendationsEl) {
    recommendationsEl.innerHTML = recommendationsSkeleton(3);
  }

  // Shell first: greet from any already-synced session without awaiting network auth.
  const paintWelcome = () => {
    const user = window.LexoAuth?.getCurrentUser?.();
    const name = user?.username || "Reader";
    if (welcomeEl) {
      welcomeEl.textContent = window.LexoAuth?.isLoggedIn?.()
        ? getTimeGreeting(name)
        : "Welcome to Lexo";
    }
  };
  paintWelcome();

  let profile = LexoUI.readStorageJson("readerProfile");

  function paintLibrarySections() {
    const stats = LexoLibrary.getStats();
    const readEl = document.getElementById("readCount");
    const readingEl = document.getElementById("readingCount");
    const wantEl = document.getElementById("wantCount");
    if (readEl) readEl.textContent = stats.read;
    if (readingEl) readingEl.textContent = stats.reading;
    if (wantEl) wantEl.textContent = stats.want;

    const streakEl = document.getElementById("streakCount");
    if (streakEl) {
      streakEl.textContent = computeStreak(LexoLibrary.getReadingData().activity);
    }

    renderContinueReading();
    renderRecentlyAdded();
    renderReadingGoal();
    updateDNAProgress();
  }

  // Apply stale-while-revalidate library cache immediately (no await).
  try {
    const persisted = LexoLibrary._readPersistentCache?.();
    if (persisted) {
      LexoLibrary._applyPayload?.(persisted);
      paintLibrarySections();
    }
  } catch (_) {
    /* ignore */
  }

  document.getElementById("refreshRecommendationsBtn")?.addEventListener("click", () => {
    fetchFreshRecommendations();
  });

  document.getElementById("editGoalsBtn")?.addEventListener("click", () => {
    window.location.href = "challenges.html#goalsSection";
  });

  document.addEventListener("lexo:library-changed", event => {
    if (event.detail?.action === "background-refresh" || event.detail?.action === "refresh") {
      paintLibrarySections();
    }
    if (event.detail?.action === "goals-updated" || event.detail?.action === "progress") {
      renderReadingGoal();
    }
  });

  window.addEventListener("storage", event => {
    if (event.key === "lexo_reading_data") {
      renderReadingGoal();
    }
  });

  // Background hydrate — does not block first paint.
  void (async () => {
    if (window.LexoAuth?.whenReady) {
      await window.LexoAuth.whenReady();
    }
    window.LexoPerf?.endAuthLoad?.();
    paintWelcome();

    await Promise.allSettled([
      window.LexoUserData?.hydrate?.().catch(() => {}),
      LexoLibrary.ensureLoaded().catch(() => {}),
    ]);
    window.LexoPerf?.endBooksLoad?.();
    profile = LexoUI.readStorageJson("readerProfile") || profile;
    paintLibrarySections();
    window.LexoPerf?.endPageLoad?.();
  })();

  function renderTopPickCover(topPick) {
    const slot = document.getElementById("topPickCover");
    if (!slot || !window.BookCover) return;

    if (!topPick?.title) {
      slot.innerHTML = "";
      slot.hidden = true;
      return;
    }

    slot.hidden = false;
    slot.innerHTML = BookCover.html(
      {
        title: topPick.title,
        author: topPick.author,
        genre: topPick.genre,
        coverUrl: topPick.cover_url,
      },
      {
        imgClass: "ai-pick-cover-img book-cover-img",
        wrapClass: "ai-pick-cover-wrap book-cover-wrap",
        placeholderClass: "ai-pick-cover-ph book-cover-placeholder",
      }
    );
    BookCover.resolveMissing(
      [{ title: topPick.title, author: topPick.author, genre: topPick.genre, coverUrl: topPick.cover_url }],
      slot,
      { imgClass: "ai-pick-cover-img book-cover-img" }
    );
  }

  function applyIntelligence(intelligence) {
    const subtitle = document.getElementById("homeSubtitle");
    const mission = document.getElementById("todayMission");
    const topPickTitle = document.getElementById("topPickTitle");
    const topPickReason = document.getElementById("topPickReason");
    const topPickLabel = document.getElementById("topPickLabel");

    const dashboard = intelligence?.dashboard || {};
    const topPick = dashboard.top_pick || {};

    if (subtitle) {
      subtitle.textContent = dashboard.greeting_subtitle || "Your personalized reading world is ready.";
    }
    if (mission) {
      mission.textContent = dashboard.today_mission || "Choose a book that matches your current mood.";
    }
    if (topPickLabel) topPickLabel.textContent = "AI Pick of the Day";
    if (topPickTitle) {
      topPickTitle.textContent = topPick.title || "Ask Lexo for a recommendation";
    }
    if (topPickReason) {
      topPickReason.textContent = topPick.reason || "Your AI pick will appear here.";
    }
    renderTopPickCover(topPick);

    const topPickBtn = document.getElementById("topPickBtn");
    if (topPickBtn) {
      topPickBtn.onclick = function () {
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
  }

  function buildLocalIntelligenceFallback() {
    const mood = localStorage.getItem("lexo_today_mood");
    const goal = localStorage.getItem("lexo_today_goal");
    let topPick = {
      title: "Ask Lexo for a recommendation",
      author: "",
      genre: "",
      reason: "Choose a mood or generate recommendations to unlock today's AI pick.",
    };

    try {
      const recs = JSON.parse(localStorage.getItem("lexo_recommendations_v1") || "null");
      const first = recs?.items?.[0]?.ai_recommendation || recs?.items?.[0];
      if (first?.title) {
        topPick = {
          title: first.title,
          author: first.author || "",
          genre: first.genre || "",
          reason: first.reason || "From your latest Lexo recommendations.",
          cover_url: recs.items[0]?.book_data?.cover_url || first.cover_url || null,
        };
      }
    } catch (_) {
      /* ignore */
    }

    const missionParts = [];
    if (mood) missionParts.push(`Match your ${mood} mood`);
    if (goal) missionParts.push(`work toward ${goal}`);
    const today_mission = missionParts.length
      ? `${missionParts.join(" and ")} with a focused reading session.`
      : "Choose a book that matches your current mood.";

    return {
      dashboard: {
        greeting_subtitle: "Your personalized reading world is ready.",
        today_mission,
        top_pick: topPick,
      },
      fallback: true,
    };
  }

  function paintIntelligenceNow() {
    const mood = localStorage.getItem("lexo_today_mood");
    const goal = localStorage.getItem("lexo_today_goal");
    const contextHint = {
      today_mood: mood,
      today_goal: goal,
      library: LexoLibrary?.getLibrary?.() || {},
      profile_completion: localStorage.getItem("reader_profile_completion") || "0",
    };
    const fresh = LexoAPI._readIntelligenceCache?.(contextHint);
    if (fresh?.dashboard) {
      console.log("[Lexo] AI Pick: applying fresh cache");
      applyIntelligence(fresh);
      return { source: "cache", payload: fresh };
    }

    const stale = LexoAPI._readIntelligenceCache?.(contextHint, { allowStale: true });
    if (stale?.dashboard) {
      console.log("[Lexo] AI Pick: applying stale cache, will refresh");
      applyIntelligence(stale);
      return { source: "stale", payload: stale };
    }

    const fallback = buildLocalIntelligenceFallback();
    console.log("[Lexo] AI Pick: applying local fallback (no cache)");
    applyIntelligence(fallback);
    return { source: "fallback", payload: fallback };
  }

  let intelligenceInFlight = null;

  async function loadHomeIntelligence({ force = false } = {}) {
    console.log("[Lexo] Loading AI Pick…", { force });
    const painted = paintIntelligenceNow();

    // Unauthenticated: keep fallback / cache only.
    if (!window.LexoAuth?.isLoggedIn?.()) {
      updateDNAProgress();
      return;
    }

    // Fresh matching cache: skip network on normal open.
    if (!force && painted.source === "cache") {
      updateDNAProgress();
      return;
    }

    if (intelligenceInFlight) return intelligenceInFlight;

    intelligenceInFlight = (async () => {
      try {
        const intelligence = await LexoAPI.getReaderIntelligence({
          force: Boolean(force),
          timeoutMs: 12000,
        });
        console.log("[Lexo] AI Pick response", intelligence);
        if (intelligence?.dashboard) applyIntelligence(intelligence);
      } catch (err) {
        console.error("[Lexo] AI Pick / mission failed", err);
        if (!painted.payload?.dashboard) {
          applyIntelligence(buildLocalIntelligenceFallback());
        }
      } finally {
        intelligenceInFlight = null;
        updateDNAProgress();
      }
    })();

    const safety = setTimeout(() => {
      const title = document.getElementById("topPickTitle")?.textContent || "";
      if (/^loading/i.test(title.trim())) {
        console.warn("[Lexo] AI Pick safety timeout — forcing fallback UI");
        applyIntelligence(painted.payload || buildLocalIntelligenceFallback());
      }
    }, 8000);

    try {
      await intelligenceInFlight;
    } finally {
      clearTimeout(safety);
    }
  }

  function updateDNAProgress() {
    if (window.LexoReaderDna?.applyHomeVisibility()) {
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

    const savedMood = localStorage.getItem("lexo_today_mood");
    const savedGoal = localStorage.getItem("lexo_today_goal");

    moodButtons.forEach(button => {
      if (button.dataset.mood === savedMood) button.classList.add("active-mood");

      button.addEventListener("click", function () {
        moodButtons.forEach(btn => btn.classList.remove("active-mood"));
        this.classList.add("active-mood");
        localStorage.setItem("lexo_today_mood", this.dataset.mood);
        localStorage.removeItem("lexo_reader_intelligence");
        localStorage.removeItem("lexo_intelligence_meta");
        loadHomeIntelligence({ force: true });
      });
    });

    goalButtons.forEach(button => {
      if (button.dataset.goal === savedGoal) button.classList.add("active-mood");

      button.addEventListener("click", function () {
        goalButtons.forEach(btn => btn.classList.remove("active-mood"));
        this.classList.add("active-mood");
        localStorage.setItem("lexo_today_goal", this.dataset.goal);
        localStorage.removeItem("lexo_reader_intelligence");
        localStorage.removeItem("lexo_intelligence_meta");
        loadHomeIntelligence({ force: true });
      });
    });
  }

  setupMoodAndGoal();

  // Resolve AI Pick + mission immediately (cache / fallback), then soft-refresh if needed.
  void loadHomeIntelligence({ force: false });

  const RECOMMENDATION_BATCH_SIZE = 3;
  const RECOMMENDATION_QUESTION =
    "Recommend exactly 3 books I haven't read yet, based on my Reader DNA, favorite genres, ratings, and reviews. Only suggest books that are not already in my library.";
  const RECS_CACHE_KEY = "lexo_recommendations_v1";
  const LEGACY_RECS_KEYS = [
    "bookmind_recommendations_v1",
    "bookmindai_recommendations",
    "bookmind_recommendations",
  ];

  let recommendationsGenerateInFlight = false;
  let currentRecBatchMeta = { batch_id: null, generated_at: null };

  function migrateLegacyRecommendationCache() {
    try {
      if (localStorage.getItem(RECS_CACHE_KEY) != null) return;
      for (const key of LEGACY_RECS_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;
        localStorage.setItem(RECS_CACHE_KEY, raw);
        localStorage.removeItem(key);
        return;
      }
    } catch (_) {
      /* ignore */
    }
  }

  function readLocalRecommendationCache() {
    migrateLegacyRecommendationCache();
    try {
      const parsed = JSON.parse(localStorage.getItem(RECS_CACHE_KEY) || "null");
      if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeLocalRecommendationCache({ items, batch_id, generated_at, expires_at, stale }) {
    const payload = {
      items: items || [],
      batch_id: batch_id || null,
      generated_at: generated_at || null,
      expires_at: expires_at || null,
      stale: Boolean(stale),
      saved_at: new Date().toISOString(),
    };
    localStorage.setItem(RECS_CACHE_KEY, JSON.stringify(payload));

    // Keep readerProfile.recommendations in sync for older helpers.
    try {
      const stored = JSON.parse(localStorage.getItem("readerProfile")) || {};
      stored.recommendations = payload.items;
      localStorage.setItem("readerProfile", JSON.stringify(stored));
      profile = stored;
    } catch (_) {
      /* ignore */
    }
    return payload;
  }

  function normalizeTitleKey(title) {
    return (title || "").toLowerCase().trim();
  }

  function recommendationItemsFromBooks(books) {
    return books.map(book => ({
      ai_recommendation: {
        title: book.title,
        author: book.author,
        genre: book.genre,
        difficulty: book.difficulty || "AI Pick",
        reason: book.reason || book.description || "",
        cover_url: book.cover_url || null,
        match: book.match_score || book.match || 90,
        isbn: book.isbn || null,
      },
      book_data: book.cover_url
        ? {
            title: book.title,
            author: book.author,
            genre: book.genre,
            cover_url: book.cover_url,
            isbn: book.isbn || null,
          }
        : null,
    }));
  }

  function filterRecommendationsForDisplay(books, { excludeStoredTitles = new Set() } = {}) {
    return books
      .filter(book => book?.title)
      .filter(book => !LexoLibrary.findShelf(book))
      .filter(book => !excludeStoredTitles.has(normalizeTitleKey(book.title)));
  }

  function itemsFromServerPayload(payload) {
    if (Array.isArray(payload?.items) && payload.items.length) return payload.items;
    if (Array.isArray(payload?.recommendations) && payload.recommendations.length) {
      const first = payload.recommendations[0];
      if (first?.ai_recommendation) return payload.recommendations;
      return recommendationItemsFromBooks(payload.recommendations);
    }
    return [];
  }

  function setGenerateBusy(isBusy, label) {
    const refreshBtn = document.getElementById("refreshRecommendationsBtn");
    if (refreshBtn) {
      refreshBtn.disabled = isBusy;
      refreshBtn.textContent = isBusy ? label || "Generating…" : "Refresh";
    }
    document.querySelectorAll("#generateMoreBtn, #retryRecommendationsBtn").forEach(btn => {
      btn.disabled = isBusy;
      if (isBusy && btn.id === "generateMoreBtn") {
        btn.dataset.prevLabel = btn.textContent;
        btn.textContent = label || "Generating…";
      } else if (!isBusy && btn.dataset.prevLabel) {
        btn.textContent = btn.dataset.prevLabel;
        delete btn.dataset.prevLabel;
      }
    });
  }

  function showRecommendationToast(message, isError = false) {
    let el = document.getElementById("recommendationToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "recommendationToast";
      el.className = "recommendation-toast";
      document.querySelector(".home-recommendations")?.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.hidden = true;
    }, 4200);
  }

  function renderRecommendationsEmptyState({ title, message, buttonLabel = null }) {
    const container = document.getElementById("recommendations");
    if (!container) return;
    container.innerHTML = `
      <div class="empty-library card">
        <h2>${title}</h2>
        <p>${message}</p>
        ${buttonLabel ? `<button class="btn btn-primary" id="generateMoreBtn" type="button">${buttonLabel}</button>` : ""}
      </div>
    `;
    document.getElementById("generateMoreBtn")?.addEventListener("click", () => {
      fetchFreshRecommendations();
    });
  }

  function renderRecommendationsErrorState(message) {
    const container = document.getElementById("recommendations");
    if (!container) return;
    const hasCards = container.querySelector(".recommendation-card-modern");
    if (hasCards) {
      showRecommendationToast(message || "Could not generate new recommendations.", true);
      return;
    }
    container.innerHTML = `
      <div class="empty-library card">
        <h2>Couldn't load recommendations.</h2>
        <p>${message}</p>
        <button class="btn btn-primary" id="retryRecommendationsBtn" type="button">Try again</button>
      </div>
    `;
    document.getElementById("retryRecommendationsBtn")?.addEventListener("click", () => {
      fetchFreshRecommendations();
    });
  }

  async function renderRecommendations(items) {
    const list = Array.isArray(items) ? items : [];

    document.getElementById("readerType").textContent = profile?.reader_type || "Not available";
    document.getElementById("readingLevel").textContent =
      profile?.confirmed_reading_level || "Not available";
    document.getElementById("genres").textContent = (profile?.favorite_genres || []).join(", ");

    if (!profile && list.length === 0) {
      renderRecommendationsEmptyState({
        title: "No reader profile yet.",
        message: "Complete your Reader DNA quiz to get personalized book recommendations.",
      });
      window.LexoPerf?.endRecommendationsLoad?.();
      return;
    }

    if (list.length === 0) {
      renderRecommendationsEmptyState({
        title: "You're all caught up.",
        message: "Want Lexo to find more books you haven't read, aren't reading, and haven't marked \"not interested\"?",
        buttonLabel: "Yes, generate 3 more",
      });
      window.LexoPerf?.endRecommendationsLoad?.();
      return;
    }

    const visibleRecommendations = list.filter(item => {
      const rec = item.ai_recommendation || item;
      return !LexoLibrary.findShelf(rec);
    }).slice(0, 6);

    const container = document.getElementById("recommendations");
    if (!container) return;

    if (visibleRecommendations.length === 0) {
      renderRecommendationsEmptyState({
        title: "You're all caught up.",
        message: "Want Lexo to find more books you haven't read, aren't reading, and haven't marked \"not interested\"?",
        buttonLabel: "Yes, generate 3 more",
      });
      window.LexoPerf?.endRecommendationsLoad?.();
      return;
    }

    container.innerHTML = "";

    visibleRecommendations.forEach(item => {
      const aiBook = item.ai_recommendation;
      const bookData = item.book_data;
      const genre = aiBook.genre || "Lexo";

      const card = document.createElement("div");
      card.className = "recommendation-card-modern card";

      const coverHTML = window.BookCover
        ? BookCover.html(
            { ...aiBook, ...bookData, genre },
            {
              imgClass: "recommendation-cover book-cover-img",
              wrapClass: "recommendation-cover-wrap book-cover-wrap",
              placeholderClass: "recommendation-cover book-cover-placeholder",
            }
          )
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
          <button class="mini-btn save-btn" data-status="reading">${LexoIcons.book} Reading</button>
          <button class="mini-btn save-btn" data-status="want">${LexoIcons.heart} Want</button>
          <button class="mini-btn save-btn" data-status="read">${LexoIcons.check} Finished</button>
          <button class="mini-btn save-btn" data-status="not_interested">${LexoIcons.ban} Not Interested</button>
          <button class="mini-btn buy-btn">${LexoIcons.cart} Buy</button>
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
            await LexoLibrary.addBook(aiBook, this.dataset.status);
            profile = JSON.parse(localStorage.getItem("readerProfile"));
            const cache = readLocalRecommendationCache();
            await renderRecommendations(cache?.items || profile?.recommendations || []);
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

    if (window.BookCover) {
      const coverBooks = visibleRecommendations.map(item => ({
        ...item.ai_recommendation,
        ...item.book_data,
        genre: item.ai_recommendation?.genre || "Lexo",
      }));
      const coverOptions = { imgClass: "recommendation-cover book-cover-img" };
      BookCover.seedFromBooks(coverBooks);
      BookCover.resolveMissing(coverBooks, container, coverOptions).then(() => {
        persistRecommendationCovers(visibleRecommendations, coverBooks);
      });
    }
    window.LexoPerf?.endRecommendationsLoad?.();
  }

  function persistRecommendationCovers(items, resolvedBooks) {
    try {
      const cache = readLocalRecommendationCache();
      if (!cache?.items?.length) return;

      let changed = false;
      cache.items.forEach(item => {
        const ai = item.ai_recommendation;
        if (!ai?.title) return;
        const match = resolvedBooks.find(
          book => book.title === ai.title && (book.author || "") === (ai.author || "")
        );
        if (!match?.cover_url) return;
        if (!item.book_data) item.book_data = {};
        item.book_data.cover_url = match.cover_url;
        item.book_data.title = ai.title;
        item.book_data.author = ai.author;
        item.book_data.genre = ai.genre;
        ai.cover_url = match.cover_url;
        changed = true;
      });

      if (changed) {
        writeLocalRecommendationCache(cache);
      }
    } catch {
      /* ignore */
    }
  }

  async function loadPersistedRecommendations() {
    const local = readLocalRecommendationCache();
    const profileRecs = Array.isArray(profile?.recommendations) ? profile.recommendations : [];

    if (local?.items?.length) {
      currentRecBatchMeta = {
        batch_id: local.batch_id || null,
        generated_at: local.generated_at || null,
      };
      await renderRecommendations(local.items);
    } else if (profileRecs.length) {
      writeLocalRecommendationCache({ items: profileRecs });
      await renderRecommendations(profileRecs);
    } else {
      await renderRecommendations([]);
    }

    if (!window.LexoAuth?.isLoggedIn?.()) return;

    try {
      const remoteFetch = () => LexoAPI.get("/api/reader/recommendations");
      const remote = window.LexoApiCache?.dedupe
        ? await LexoApiCache.dedupe("recommendations", "latest", remoteFetch, {
            ttlMs: 60 * 1000,
          })
        : await remoteFetch();
      const remoteItems = itemsFromServerPayload(remote);
      if (!remoteItems.length) return;

      const remoteAt = remote.generated_at || "";
      const localAt = currentRecBatchMeta.generated_at || local?.generated_at || "";
      const remoteIsNewer =
        !localAt ||
        (remoteAt && remoteAt > localAt) ||
        (remote.batch_id && remote.batch_id !== currentRecBatchMeta.batch_id);

      if (remoteIsNewer || !local?.items?.length) {
        writeLocalRecommendationCache({
          items: remoteItems,
          batch_id: remote.batch_id,
          generated_at: remote.generated_at,
          expires_at: remote.expires_at,
          stale: remote.stale,
        });
        currentRecBatchMeta = {
          batch_id: remote.batch_id || null,
          generated_at: remote.generated_at || null,
        };
        await renderRecommendations(remoteItems);
      }
    } catch (_) {
      /* offline / unauthenticated — keep local cards */
    }
  }

  /**
   * Explicitly generates a new batch of exactly 3 books and persists it.
   * Keeps existing cards visible while generating.
   */
  async function fetchFreshRecommendations() {
    if (recommendationsGenerateInFlight) return;
    recommendationsGenerateInFlight = true;
    setGenerateBusy(true, "Generating…");

    const container = document.getElementById("recommendations");
    const hadCards = Boolean(container?.querySelector(".recommendation-card-modern"));

    try {
      if (!window.LexoAuth?.isLoggedIn?.()) {
        throw new Error("Please log in to generate and save recommendations.");
      }

      const readerContext = await LexoAPI.getReaderContext();
      const result = await LexoAPI.post("/api/reader/recommendations/generate", {
        question: RECOMMENDATION_QUESTION,
        reader_profile: readerContext,
        recommendation_count: RECOMMENDATION_BATCH_SIZE,
      });

      let items = itemsFromServerPayload(result);
      if (!items.length) {
        const apiBooks = Array.isArray(result?.recommendations) ? result.recommendations : [];
        const fresh = filterRecommendationsForDisplay(apiBooks).slice(0, RECOMMENDATION_BATCH_SIZE);
        items = recommendationItemsFromBooks(fresh);
      }

      if (items.length < RECOMMENDATION_BATCH_SIZE) {
        throw new Error(
          `Only received ${items.length} of ${RECOMMENDATION_BATCH_SIZE} recommendations. Please try again.`
        );
      }

      writeLocalRecommendationCache({
        items,
        batch_id: result.batch_id,
        generated_at: result.generated_at,
        expires_at: result.expires_at,
        stale: false,
      });
      currentRecBatchMeta = {
        batch_id: result.batch_id || null,
        generated_at: result.generated_at || null,
      };
      window.LexoApiCache?.invalidate?.("recommendations");
      await renderRecommendations(items);
    } catch (error) {
      if (hadCards) {
        showRecommendationToast(
          error?.message ? error.message : "Could not generate new recommendations.",
          true
        );
      } else {
        renderRecommendationsErrorState(
          error?.message ? error.message : "Please check your connection and try again."
        );
      }
    } finally {
      recommendationsGenerateInFlight = false;
      setGenerateBusy(false);
    }
  }

  void loadPersistedRecommendations();
});
