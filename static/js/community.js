/* Community — tabbed feed: For You, Discussions, Reviews, Book Clubs */

const feed = document.getElementById("communityFeed");
const toastEl = document.getElementById("communityToast");

const state = {
  tab: "for-you",
  reviews: [],
  loading: false,
};

const DEMO_DISCUSSIONS = [
  {
    id: "disc-1",
    title: "Was the ending fair to the narrator?",
    book: "The Silent Patient",
    bookAuthor: "Alex Michaelides",
    user: "Maya R.",
    replies: 24,
    genre: "Thriller",
  },
  {
    id: "disc-2",
    title: "Best first book for a book club?",
    book: "Tomorrow, and Tomorrow, and Tomorrow",
    bookAuthor: "Gabriel Zevin",
    user: "Chris L.",
    replies: 18,
    genre: "Literary Fiction",
  },
  {
    id: "disc-3",
    title: "How dark is too dark for cozy fantasy?",
    book: "Legends & Lattes",
    bookAuthor: "Travis Baldree",
    user: "Priya S.",
    replies: 31,
    genre: "Fantasy",
  },
  {
    id: "disc-4",
    title: "Does the romance subplot help or hurt the mystery?",
    book: "The Seven Husbands of Evelyn Hugo",
    bookAuthor: "Taylor Jenkins Reid",
    user: "Sam T.",
    replies: 42,
    genre: "Romance",
  },
  {
    id: "disc-5",
    title: "Hard sci-fi pacing — worth the slow burn?",
    book: "Project Hail Mary",
    bookAuthor: "Andy Weir",
    user: "Jordan K.",
    replies: 56,
    genre: "Sci-Fi",
  },
  {
    id: "disc-6",
    title: "Which character deserved a standalone novel?",
    book: "Fourth Wing",
    bookAuthor: "Rebecca Yarros",
    user: "Elena V.",
    replies: 37,
    genre: "Fantasy",
  },
];

const DEMO_CLUBS = [
  {
    id: "club-1",
    name: "Cozy Mystery Circle",
    book: "The Thursday Murder Club",
    bookAuthor: "Richard Osman",
    members: 128,
    genre: "Mystery",
    theme: "Whodunits & weekend reads",
  },
  {
    id: "club-2",
    name: "Literary Fiction Salon",
    book: "Klara and the Sun",
    bookAuthor: "Kazuo Ishiguro",
    members: 86,
    genre: "Literary Fiction",
    theme: "Character-driven stories",
  },
  {
    id: "club-3",
    name: "Sci-Fi Explorers",
    book: "The Three-Body Problem",
    bookAuthor: "Liu Cixin",
    members: 214,
    genre: "Sci-Fi",
    theme: "Big ideas & world-building",
  },
  {
    id: "club-4",
    name: "Romance Readers Guild",
    book: "Beach Read",
    bookAuthor: "Emily Henry",
    members: 167,
    genre: "Romance",
    theme: "Feel-good & emotional arcs",
  },
  {
    id: "club-5",
    name: "Dark Academia Society",
    book: "If We Were Villains",
    bookAuthor: "M. L. Rio",
    members: 93,
    genre: "Thriller",
    theme: "Atmospheric campus mysteries",
  },
];

const DEMO_SIMILAR_READERS = [
  {
    id: "reader-1",
    name: "Jordan K.",
    avatar: "JK",
    overlap: "Sci-Fi & Fantasy",
    books: ["Project Hail Mary", "Fourth Wing"],
  },
  {
    id: "reader-2",
    name: "Maya R.",
    avatar: "MR",
    overlap: "Thriller",
    books: ["The Silent Patient", "The Guest List"],
  },
  {
    id: "reader-3",
    name: "Priya S.",
    avatar: "PS",
    overlap: "Cozy Fantasy",
    books: ["Legends & Lattes", "The House in the Cerulean Sea"],
  },
];

const DEMO_REVIEWS = [
  {
    book_title: "Project Hail Mary",
    author: "Andy Weir",
    genre: "Sci-Fi",
    rating: 5,
    review_title: "Could not put it down",
    review_text:
      "The friendship at the center of this book is everything. Funny, tense, and surprisingly emotional.",
    user: "Jordan K.",
    updated: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    book_title: "The Seven Husbands of Evelyn Hugo",
    author: "Taylor Jenkins Reid",
    genre: "Romance",
    rating: 5,
    review_title: "Hollywood glamour with heart",
    review_text:
      "A sweeping story about love, ambition, and the stories we tell ourselves. Stayed with me for days.",
    user: "Sam T.",
    updated: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    book_title: "Legends & Lattes",
    author: "Travis Baldree",
    genre: "Fantasy",
    rating: 4,
    review_title: "Perfect comfort read",
    review_text: "Low stakes, warm characters, and a coffee shop I wish were real.",
    user: "Priya S.",
    updated: new Date(Date.now() - 8 * 86400000).toISOString(),
  },
];

document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  void loadReviews().then(() => renderActiveTab());
});

function bindTabs() {
  document.querySelectorAll(".community-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const next = tab.dataset.tab;
      if (!next || next === state.tab) return;
      state.tab = next;
      document.querySelectorAll(".community-tab").forEach(t => {
        const active = t.dataset.tab === next;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      renderActiveTab();
    });
  });
}

async function loadReviews() {
  state.loading = true;
  renderSkeleton();

  try {
    if (!window.BookMindAPI?.get) {
      throw new Error("BookMindAPI is not loaded.");
    }
    const data = await BookMindAPI.get("/api/reviews/community?limit=30", { auth: false });
    state.reviews = data.reviews?.length ? data.reviews : DEMO_REVIEWS;
  } catch {
    state.reviews = DEMO_REVIEWS;
  } finally {
    state.loading = false;
  }
}

function getProfileGenres() {
  const profile = BookMindUI?.readStorageJson?.("readerProfile", null);
  return profile?.favorite_genres || [];
}

function pickForYouDiscussions() {
  const genres = getProfileGenres().map(g => g.toLowerCase());
  if (!genres.length) return DEMO_DISCUSSIONS.slice(0, 3);
  const matched = DEMO_DISCUSSIONS.filter(d =>
    genres.some(g => d.genre.toLowerCase().includes(g) || g.includes(d.genre.toLowerCase()))
  );
  return (matched.length ? matched : DEMO_DISCUSSIONS).slice(0, 3);
}

function pickForYouClubs() {
  const genres = getProfileGenres().map(g => g.toLowerCase());
  const sorted = [...DEMO_CLUBS].sort((a, b) => b.members - a.members);
  if (!genres.length) return sorted.slice(0, 2);
  const matched = sorted.filter(c =>
    genres.some(g => c.genre.toLowerCase().includes(g) || g.includes(c.genre.toLowerCase()))
  );
  return (matched.length ? matched : sorted).slice(0, 2);
}

function renderActiveTab() {
  if (!feed) return;

  feed.className = "community-feed";
  if (state.tab === "for-you") {
    feed.classList.add("community-for-you");
    feed.innerHTML = renderForYou();
  } else if (state.tab === "discussions") {
    feed.classList.add("community-grid", "community-discussions-grid");
    feed.innerHTML = DEMO_DISCUSSIONS.map(renderDiscussionCard).join("");
  } else if (state.tab === "reviews") {
    feed.classList.add("community-grid");
    feed.innerHTML =
      state.reviews.length > 0
        ? state.reviews.map(renderReviewCard).join("")
        : `<div class="empty-library card"><h2>No reviews yet.</h2><p>Write a review on any book and share it publicly.</p></div>`;
  } else if (state.tab === "clubs") {
    feed.classList.add("community-grid", "community-clubs-grid");
    feed.innerHTML = DEMO_CLUBS.map(renderClubCard).join("");
  }

  bindFeedActions();
  hydrateCovers();
}

function renderForYou() {
  const recent = state.reviews.slice(0, 3);
  const discussions = pickForYouDiscussions();
  const clubs = pickForYouClubs();

  return `
    <div class="community-for-you-layout">
      <section class="community-section card">
        <div class="community-section-head">
          <h2>Recent reviews</h2>
          <button type="button" class="community-link-btn" data-action="filter-tab" data-tab="reviews">See all</button>
        </div>
        <div class="community-grid community-grid-compact">
          ${recent.map(renderReviewCard).join("")}
        </div>
      </section>

      <section class="community-section card">
        <div class="community-section-head">
          <h2>Recommended discussions</h2>
          <button type="button" class="community-link-btn" data-action="filter-tab" data-tab="discussions">Browse</button>
        </div>
        <div class="community-stack">
          ${discussions.map(renderDiscussionCard).join("")}
        </div>
      </section>

      <section class="community-section card">
        <div class="community-section-head">
          <h2>Popular book clubs</h2>
          <button type="button" class="community-link-btn" data-action="filter-tab" data-tab="clubs">View clubs</button>
        </div>
        <div class="community-grid community-grid-compact">
          ${clubs.map(renderClubCard).join("")}
        </div>
      </section>

      <section class="community-section card">
        <div class="community-section-head">
          <h2>Readers like you</h2>
        </div>
        <div class="community-similar-grid">
          ${DEMO_SIMILAR_READERS.map(renderSimilarReaderCard).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderDiscussionCard(discussion) {
  return `
    <article class="community-discussion-card card" data-discussion-id="${escapeAttr(discussion.id)}">
      <div class="community-discussion-body">
        <p class="eyebrow">${escapeHtml(discussion.genre)}</p>
        <h3>${escapeHtml(discussion.title)}</h3>
        <p class="community-discussion-book">
          <span>${escapeHtml(discussion.book)}</span>
          <span class="community-discussion-by">by ${escapeHtml(discussion.bookAuthor)}</span>
        </p>
        <div class="community-discussion-meta">
          <span>Started by ${escapeHtml(discussion.user)}</span>
          <span class="community-reply-count">${discussion.replies} replies</span>
        </div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="join-discussion" data-id="${escapeAttr(discussion.id)}">
        Join discussion
      </button>
    </article>
  `;
}

function renderClubCard(club) {
  const joined = getJoinedClubs().includes(club.id);
  return `
    <article class="community-club-card card" data-club-id="${escapeAttr(club.id)}">
      <div class="community-club-icon" aria-hidden="true">📖</div>
      <div class="community-club-body">
        <p class="eyebrow">${escapeHtml(club.genre)}</p>
        <h3>${escapeHtml(club.name)}</h3>
        <p class="community-club-book">Now reading: <strong>${escapeHtml(club.book)}</strong></p>
        <p class="community-club-theme">${escapeHtml(club.theme)}</p>
        <div class="community-club-meta">
          <span>${club.members} members</span>
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-action="join-club" data-id="${escapeAttr(club.id)}" ${joined ? "disabled" : ""}>
        ${joined ? "On waitlist" : "Join club"}
      </button>
    </article>
  `;
}

function renderSimilarReaderCard(reader) {
  return `
    <article class="community-similar-card">
      <div class="community-similar-avatar" aria-hidden="true">${escapeHtml(reader.avatar)}</div>
      <div>
        <strong>${escapeHtml(reader.name)}</strong>
        <p class="community-similar-overlap">Also reads ${escapeHtml(reader.overlap)}</p>
        <p class="community-similar-books">${reader.books.map(b => escapeHtml(b)).join(" · ")}</p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="view-reader" data-id="${escapeAttr(reader.id)}">
        View shelf
      </button>
    </article>
  `;
}

function renderReviewCard(review) {
  const rating = Number(review.rating) || 0;
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const date = review.updated || review.created;
  const dateStr = date ? new Date(date).toLocaleDateString() : "";

  const cover = window.BookCover
    ? BookCover.html(
        {
          title: review.book_title,
          author: review.author,
          genre: review.genre,
          coverUrl: review.cover_url,
        },
        {
          imgClass: "community-cover-img book-cover-img",
          wrapClass: "community-card-cover book-cover-wrap",
          placeholderClass: "community-card-fallback book-cover-placeholder",
        }
      )
    : `<span class="community-card-fallback"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg></span>`;

  const bookData = escapeAttr(
    JSON.stringify({
      title: review.book_title,
      author: review.author,
      genre: review.genre,
      cover_url: review.cover_url,
    })
  );

  return `
    <article class="community-card card community-review-card" data-book="${bookData}" data-action="open-book">
      ${cover}
      <div class="community-card-body">
        <div class="community-card-head">
          <div>
            <h3>${escapeHtml(review.book_title)}</h3>
            <p class="book-author">${escapeHtml(review.author || "Unknown Author")}</p>
          </div>
          <span class="community-stars" aria-label="${rating} out of 5 stars">${stars}</span>
        </div>
        ${review.review_title ? `<p class="community-review-title">${escapeHtml(review.review_title)}</p>` : ""}
        ${review.review_text ? `<p class="community-review-text">${escapeHtml(review.review_text)}</p>` : ""}
        <div class="community-card-foot">
          <span>${escapeHtml(review.user || "Anonymous Reader")}</span>
          <span>${dateStr}</span>
        </div>
      </div>
    </article>
  `;
}

function bindFeedActions() {
  feed.querySelectorAll('[data-action="filter-tab"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      const tabBtn = document.querySelector(`.community-tab[data-tab="${tab}"]`);
      tabBtn?.click();
    });
  });

  feed.querySelectorAll('[data-action="open-book"], .community-card[data-book]').forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      const bookJson = card.dataset.book;
      if (!bookJson) return;
      openBookDetails(JSON.parse(bookJson));
    });
  });

  feed.querySelectorAll('[data-action="join-discussion"]').forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const discussion = DEMO_DISCUSSIONS.find(d => d.id === id);
      if (!discussion) return;
      showCommunityToast(
        `"${discussion.title}" — full discussion threads are coming soon. We'll save your spot.`
      );
    });
  });

  feed.querySelectorAll('[data-action="join-club"]').forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const club = DEMO_CLUBS.find(c => c.id === id);
      if (!club) return;
      saveJoinedClub(id);
      btn.textContent = "On waitlist";
      btn.disabled = true;
      showCommunityToast(
        `You're on the waitlist for ${club.name}. Book club rooms are coming soon.`
      );
    });
  });

  feed.querySelectorAll('[data-action="view-reader"]').forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const reader = DEMO_SIMILAR_READERS.find(r => r.id === btn.dataset.id);
      showCommunityToast(
        reader
          ? `${reader.name}'s public shelf is coming soon.`
          : "Reader profiles are coming soon."
      );
    });
  });
}

function openBookDetails(book) {
  localStorage.setItem(
    "selectedBook",
    JSON.stringify({
      ai_recommendation: {
        title: book.title,
        author: book.author,
        genre: book.genre,
        difficulty: "Community pick",
        reason: "",
      },
      book_data: book.cover_url ? { cover_url: book.cover_url } : null,
    })
  );
  window.location.href = "book-details.html";
}

function getJoinedClubs() {
  return BookMindUI?.readStorageJson?.("bookmind_joined_clubs", []) || [];
}

function saveJoinedClub(clubId) {
  const joined = getJoinedClubs();
  if (!joined.includes(clubId)) {
    joined.push(clubId);
    localStorage.setItem("bookmind_joined_clubs", JSON.stringify(joined));
  }
}

function hydrateCovers() {
  if (!window.BookCover || !feed) return;
  const books = state.reviews.map(r => ({
    title: r.book_title,
    author: r.author,
    genre: r.genre,
    cover_url: r.cover_url,
  }));
  BookCover.resolveMissing(books, feed, { imgClass: "community-cover-img book-cover-img" });
}

function renderSkeleton() {
  if (!feed) return;
  feed.className = "community-feed community-grid";
  feed.innerHTML = `
    <div class="community-skeleton-grid" aria-hidden="true">
      ${Array.from({ length: 6 }, () => `
        <div class="community-card card skeleton-card">
          <div class="skeleton skeleton-cover community-card-cover"></div>
          <div class="community-card-body">
            <div class="skeleton skeleton-line skeleton-line-lg"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line skeleton-line-sm"></div>
          </div>
        </div>
      `).join("")}
    </div>`;
}

function showCommunityToast(message, isError = false) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle("error", isError);
  toastEl.classList.add("show");
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.classList.remove("show");
    if (!isError) toastEl.hidden = true;
  }, 3800);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
