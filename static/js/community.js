/* Community review feed — shows public reviews shared by readers. */

const feed = document.getElementById("communityFeed");

document.addEventListener("DOMContentLoaded", () => {
  loadCommunityFeed();
});

async function loadCommunityFeed() {
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

  try {
    if (!window.BookMindAPI?.get) {
      throw new Error("BookMindAPI is not loaded. Include js/api.js before js/community.js.");
    }

    const data = await BookMindAPI.get("/api/reviews/community?limit=30", { auth: false });
    renderFeed(data.reviews || []);
  } catch (error) {
    console.error(error);
    feed.innerHTML = `
      <div class="empty-library card">
        <h2>Couldn't load the feed.</h2>
        <p>${escapeHtml(error.message || "Please refresh the page in a moment.")}</p>
      </div>
    `;
  }
}

function renderFeed(reviews) {
  if (reviews.length === 0) {
    feed.innerHTML = `
      <div class="empty-library card">
        <h2>No community reviews yet.</h2>
        <p>Be the first — open any book, write a review, and tick "Share publicly".</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = reviews.map(renderCard).join("");
  if (window.BookMindCoverImage) {
    const coverBooks = reviews.map(review => ({
      title: review.book_title,
      author: review.author,
      genre: review.genre,
      cover_url: review.cover_url,
    }));
    BookMindCoverImage.seedFromBooks(coverBooks);
    BookMindCoverImage.hydrateLazy(feed, {
      imgClass: "community-cover-img book-cover-img",
    });
  }

  feed.querySelectorAll(".community-card").forEach(card => {
    card.addEventListener("click", () => {
      const book = JSON.parse(card.dataset.book);
      localStorage.setItem(
        "selectedBook",
        JSON.stringify({
          ai_recommendation: {
            title: book.title,
            author: book.author,
            genre: book.genre,
            difficulty: "Community pick",
            reason: ""
          },
          book_data: book.cover_url ? { cover_url: book.cover_url } : null
        })
      );
      window.location.href = "book-details.html";
    });
  });
}

function renderCard(review) {
  const rating = Number(review.rating) || 0;
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const date = review.updated || review.created;
  const dateStr = date ? new Date(date).toLocaleDateString() : "";

  const cover = window.BookMindCoverImage
    ? BookMindCoverImage.html(
        {
          title: review.book_title,
          author: review.author,
          genre: review.genre,
          cover_url: review.cover_url,
        },
        {
          imgClass: "community-cover-img book-cover-img",
          wrapClass: "community-card-cover book-cover-wrap",
          placeholderClass: "community-card-fallback book-cover-placeholder",
        }
      )
    : review.cover_url
    ? `<img src="${escapeAttr(review.cover_url)}" alt="${escapeAttr(review.book_title)} cover" loading="lazy">`
    : `<span class="community-card-fallback"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg></span>`;

  const bookData = escapeAttr(
    JSON.stringify({
      title: review.book_title,
      author: review.author,
      genre: review.genre,
      cover_url: review.cover_url
    })
  );

  return `
    <article class="community-card card" data-book="${bookData}">
      ${window.BookMindCoverImage ? cover : `<div class="community-card-cover">${cover}</div>`}
      <div class="community-card-body">
        <div class="community-card-head">
          <div>
            <h3>${escapeHtml(review.book_title)}</h3>
            <p class="book-author">${escapeHtml(review.author || "Unknown Author")}</p>
          </div>
          <span class="community-stars">${stars}</span>
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
