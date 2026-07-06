const BookMindIcons = {
  book: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  heart: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  check: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>',
  ban: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  cart: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
};

document.addEventListener("DOMContentLoaded", async () => {
  if (window.BookMindAuth?.whenReady) {
    await BookMindAuth.whenReady();
  }

  const user = window.BookMindAuth?.getCurrentUser();
  const name = user?.username || "Reader";
  let profile = JSON.parse(localStorage.getItem("readerProfile"));

  document.getElementById("welcomeText").textContent =
    window.BookMindAuth?.isLoggedIn() ? `Welcome back, ${name}` : "Welcome to BookMindAI";

  try {
    await BookMindLibrary.ensureLoaded();
  } catch (error) {
    console.error(error);
  }

  const stats = BookMindLibrary.getStats();
  document.getElementById("readCount").textContent = stats.read;
  document.getElementById("readingCount").textContent = stats.reading;
  document.getElementById("wantCount").textContent = stats.want;

  updateDNAProgress();
  setupMoodAndGoal();
  loadHomeIntelligence();
  renderRecommendations();

  async function loadHomeIntelligence() {
    const subtitle = document.getElementById("homeSubtitle");
    const mission = document.getElementById("todayMission");
    const topPickTitle = document.getElementById("topPickTitle");
    const topPickReason = document.getElementById("topPickReason");
    const topPickLabel = document.getElementById("topPickLabel");

    try {
      subtitle.textContent = "BookMindAI is personalizing your dashboard...";
      mission.textContent = "Building today's mission...";

      const intelligence = await BookMindAPI.getReaderIntelligence();
      localStorage.setItem("bookmind_reader_intelligence", JSON.stringify(intelligence));

      const dashboard = intelligence.dashboard || {};
      const topPick = dashboard.top_pick || {};

      subtitle.textContent = dashboard.greeting_subtitle || "Your personalized reading world is ready.";
      mission.textContent = dashboard.today_mission || "Choose a book that matches your current mood.";

      topPickLabel.textContent = "Today's AI Pick";
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
          book_data: null,
        };

        localStorage.setItem("selectedBook", JSON.stringify(item));
        window.location.href = "book-details.html";
      };
    } catch (error) {
      subtitle.textContent = "Your personalized reading world is ready.";
      mission.textContent = "Choose a mood and ask BookMindAI for suggestions.";
    }
  }

  function updateDNAProgress() {
    const completion = Number(localStorage.getItem("reader_profile_completion")) || 25;

    document.getElementById("dnaProgressTitle").textContent = `${completion}% Complete`;
    document.getElementById("dnaProgressFill").style.width = `${completion}%`;

    if (completion >= 100) {
      ["continueDiscoveryTop", "continueDiscoveryMain"].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.style.display = "none";
      });

      const subtitle = document.getElementById("dnaProgressSubtitle");
      if (subtitle) {
        subtitle.textContent = "Discovery complete — your reading profile is ready.";
      }
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
        loadHomeIntelligence();
      });
    });

    goalButtons.forEach(button => {
      if (button.dataset.goal === savedGoal) button.classList.add("active-mood");

      button.addEventListener("click", function () {
        goalButtons.forEach(btn => btn.classList.remove("active-mood"));
        this.classList.add("active-mood");
        localStorage.setItem("bookmind_today_goal", this.dataset.goal);
        localStorage.removeItem("bookmind_reader_intelligence");
        loadHomeIntelligence();
      });
    });
  }

  function renderRecommendations() {
    if (!profile) return;

    document.getElementById("readerType").textContent = profile.reader_type || "Not available";
    document.getElementById("readingLevel").textContent =
      profile.confirmed_reading_level || "Not available";
    document.getElementById("genres").textContent = (profile.favorite_genres || []).join(", ");

    const container = document.getElementById("recommendations");
    container.innerHTML = "";

    if (!profile.recommendations) return;

    const visibleRecommendations = profile.recommendations.filter(item => {
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

      const coverHTML =
        bookData && bookData.cover_url
          ? `
          <img
            class="recommendation-cover"
            src="${bookData.cover_url}"
            alt="${aiBook.title} cover"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"
          />
          <div class="recommendation-cover fallback-cover" style="display:none;"></div>
        `
          : `
          <div class="recommendation-cover fallback-cover"></div>
        `;

      card.innerHTML = `
      <div class="recommendation-cover-wrap">
        ${coverHTML}
      </div>

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
            renderRecommendations();
          } catch (error) {
            alert(error.message);
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
  }

  async function generateMoreRecommendations() {
    const container = document.getElementById("recommendations");
    const button = document.getElementById("generateMoreBtn");

    if (button) {
      button.disabled = true;
      button.textContent = "Finding books…";
    }

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

      const newItems = fresh.map(book => ({
        ai_recommendation: {
          title: book.title,
          author: book.author,
          genre: book.genre,
          difficulty: book.difficulty || "AI Pick",
          reason: book.reason,
        },
        book_data: null,
      }));

      const stored = JSON.parse(localStorage.getItem("readerProfile")) || {};
      stored.recommendations = [...(stored.recommendations || []), ...newItems];
      localStorage.setItem("readerProfile", JSON.stringify(stored));

      profile = stored;
      renderRecommendations();
    } catch (error) {
      console.error(error);
      container.innerHTML = `
      <div class="empty-library card">
        <h2>Couldn't generate more.</h2>
        <p>Please try again in a moment.</p>
      </div>
    `;
    }
  }
});
