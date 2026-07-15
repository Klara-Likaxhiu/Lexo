/* Reader Journey — interactive genre chips that create reading paths. */

function genreSlug(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildGrowthSuggestions(profile) {
  const favoriteGenres = profile?.favorite_genres || [];
  const suggestions = [];

  if (favoriteGenres.includes("Mystery") || favoriteGenres.includes("Thriller")) {
    suggestions.push("Dark Academia", "Crime Fiction", "Psychological Horror");
  }
  if (favoriteGenres.includes("Romance")) {
    suggestions.push("Literary Romance", "Historical Romance", "Romantic Comedy");
  }
  if (favoriteGenres.includes("Fantasy")) {
    suggestions.push("Urban Fantasy", "Magical Realism", "Mythological Fiction");
  }
  if (!suggestions.length) {
    suggestions.push("Literary Fiction", "Contemporary Fiction", "Historical Mystery");
  }
  return suggestions;
}

function renderGrowthChips(suggestions) {
  const container = document.getElementById("growthList");
  if (!container) return;

  container.innerHTML = suggestions
    .map(
      genre => `
      <button type="button" class="growth-tag-btn" data-genre="${escapeHtml(genre)}">
        ${escapeHtml(genre)}
      </button>
    `
    )
    .join("");

  container.querySelectorAll(".growth-tag-btn").forEach(btn => {
    btn.addEventListener("click", () => void onGenreChipClick(btn));
  });
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function onGenreChipClick(button) {
  const genre = button.dataset.genre;
  if (!genre || button.classList.contains("is-loading")) return;

  if (!window.LexoAPI?.ensureAuth) {
    window.location.href = "/login.html?next=" + encodeURIComponent("/reader-journey.html");
    return;
  }

  button.classList.add("is-loading");
  button.disabled = true;

  try {
    if (window.LexoAuth?.whenReady) {
      await window.LexoAuth.whenReady();
    }

    const token = await LexoAPI.ensureAuth({ redirect: true });
    if (!token) return;

    await LexoLibrary.ensureLoaded();

    const profile = JSON.parse(localStorage.getItem("readerProfile") || "null");
    const result = await LexoAPI.post("/api/reader/genre-path", {
      genre,
      reader_profile: profile,
      library: LexoLibrary.getLibrary(),
      today_mood: localStorage.getItem("lexo_today_mood"),
      today_goal: localStorage.getItem("lexo_today_goal"),
    });

    const pathId = result?.path_id || result?.path?.id;
    if (!pathId) {
      throw new Error("Could not create reading path.");
    }

    sessionStorage.setItem(
      "lexo_path_flash",
      result.message ||
        (result.created
          ? `Created your "${genre} Starter Path".`
          : `Opened your existing "${genre}" path.`)
    );

    window.location.href = `/reading-paths.html?path=${encodeURIComponent(pathId)}`;
  } catch (error) {
    button.classList.remove("is-loading");
    button.disabled = false;
    const note = document.getElementById("growthNote");
    if (note) {
      note.textContent = error.message || "Could not create reading path. Try again.";
      note.hidden = false;
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.LexoUserData) {
    await LexoUserData.loadReaderProfile();
  }

  const profile = JSON.parse(localStorage.getItem("readerProfile") || "null");
  const mood = localStorage.getItem("lexo_today_mood");
  const goal = localStorage.getItem("lexo_today_goal");

  if (profile) {
    document.getElementById("journeyType").textContent = profile.reader_type || "The Curious Reader";
    document.getElementById("journeyLevel").textContent =
      profile.confirmed_reading_level || profile.reading_level || "Discover your reading level";
    const traits = document.getElementById("dnaTraits");
    if (traits && profile.favorite_genres?.length) {
      traits.innerHTML = profile.favorite_genres
        .slice(0, 4)
        .map(g => `<div class="dna-trait"><span>✦</span> ${escapeHtml(g)}</div>`)
        .join("");
    }
  }

  document.getElementById("todayMode").textContent =
    mood || goal ? `${mood || "any mood"} + ${goal || "any goal"}` : "No mode selected";

  let allBooks = [];
  try {
    await LexoLibrary.ensureLoaded();
    const library = LexoLibrary.getLibrary();
    allBooks = [
      ...(library.read || []),
      ...(library.reading || []),
      ...(library.want || []),
    ];
  } catch {
    allBooks = [];
  }

  function findTopGenre(books) {
    const counts = {};
    books.forEach(book => {
      const genre = book.genre || "Unknown";
      counts[genre] = (counts[genre] || 0) + 1;
    });
    let top = null;
    let max = 0;
    Object.keys(counts).forEach(genre => {
      if (counts[genre] > max) {
        top = genre;
        max = counts[genre];
      }
    });
    return top;
  }

  const topGenre = findTopGenre(allBooks);
  document.getElementById("topGenre").textContent = topGenre || "Not enough data";

  const insightList = document.getElementById("insightList");
  const favoriteGenres = profile?.favorite_genres || [];
  const insights = [
    profile?.reader_type ? `You are currently classified as a ${profile.reader_type}.` : null,
    favoriteGenres.length ? `Your strongest genres are ${favoriteGenres.join(", ")}.` : null,
    topGenre ? `Your library shows a strong interest in ${topGenre}.` : null,
    mood ? `Today you are leaning toward a ${mood} reading mood.` : null,
    goal ? `Your current reading goal is to ${goal}.` : null,
  ].filter(Boolean);

  insightList.innerHTML = insights.length
    ? insights
        .map(
          item =>
            `<p><svg class="icon icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ${item}</p>`
        )
        .join("")
    : `<p>Start saving books to build your Reader Journey.</p>`;

  renderGrowthChips(buildGrowthSuggestions(profile));
  populateWrappedStats(allBooks, profile);
});

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

function populateWrappedStats(books, profile) {
  const read = books.filter(b => b.status === "read" || (b.progress || 0) >= 100);
  const genres = new Set(books.map(b => b.genre).filter(Boolean));

  let pages = 0;
  books.forEach(b => {
    const { current, total } = LexoLibrary.getProgressInfo(b);
    pages += b.status === "read" ? total || current : current;
  });

  const streak = computeStreak(LexoLibrary.getReadingData?.().activity || []);

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set("statBooksRead", read.length);
  set("statPagesRead", pages > 0 ? pages.toLocaleString() : "0");
  set("statGenres", genres.size);
  set("statStreak", streak);

  const reviews = JSON.parse(localStorage.getItem("book_reviews") || "[]");
  if (reviews.length) {
    const avg = reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length;
    set("statRating", avg.toFixed(1));
  }

  const footer = document.getElementById("journeyFooterNote");
  if (footer && read.length > 0) {
    footer.textContent = `You've read ${read.length} book${read.length === 1 ? "" : "s"} this year. Keep going!`;
  }

  drawJourneyChart(read);
  renderGenreLegend(books);
}

function drawJourneyChart(finishedBooks) {
  const canvas = document.getElementById("journeyChart");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const counts = new Array(12).fill(0);
  finishedBooks.forEach(b => {
    const iso = LexoLibrary.getReadingData?.().finishes?.[LexoLibrary.normalizeTitle(b.title)];
    if (iso) {
      const m = new Date(iso).getMonth();
      counts[m] += 1;
    }
  });
  const max = Math.max(1, ...counts);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#E8E4DC";
  ctx.lineWidth = 1;
  counts.forEach((c, i) => {
    const x = 40 + (i / 11) * (w - 60);
    const barH = (c / max) * (h - 40);
    ctx.fillStyle = "#2F4A3A";
    ctx.beginPath();
    ctx.roundRect(x - 12, h - 20 - barH, 24, barH, 4);
    ctx.fill();
    ctx.fillStyle = "#7A848E";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(months[i], x, h - 4);
  });
}

function renderGenreLegend(books) {
  const legend = document.getElementById("genreLegend");
  if (!legend) return;
  const counts = {};
  books.forEach(b => {
    const g = b.genre || "Other";
    counts[g] = (counts[g] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const colors = ["#2F4A3A", "#C4A24A", "#A9C8E8", "#EDE8DF"];
  legend.innerHTML = sorted
    .map(
      ([genre, count], i) => `
      <div class="journey-legend-item">
        <span class="journey-legend-dot" style="background:${colors[i % colors.length]}"></span>
        ${escapeHtml(genre)} (${count})
      </div>`
    )
    .join("");
}
