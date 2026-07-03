/* Reading challenges & achievements: goals, streaks, monthly/yearly counts, badges. */

const ICONS = {
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  check: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>'
};

function svg(name, cls) {
  return `<svg class="icon ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

function dateKey(dt) {
  const offset = dt.getTimezoneOffset() * 60000;
  return new Date(dt - offset).toISOString().slice(0, 10);
}

function computeStreak(activity) {
  const set = new Set(activity || []);
  if (set.size === 0) return 0;

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

function gatherStats() {
  const library = BookMindLibrary.getLibrary();
  const data = BookMindLibrary.getReadingData();
  const reviews = JSON.parse(localStorage.getItem("book_reviews")) || [];

  const totalFinished = (library.read || []).length;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  let booksThisYear = 0;
  let booksThisMonth = 0;
  Object.values(data.finishes).forEach(iso => {
    const d = new Date(iso);
    if (d.getFullYear() === year) {
      booksThisYear += 1;
      if (d.getMonth() === month) booksThisMonth += 1;
    }
  });

  const genres = new Set(
    (library.read || [])
      .map(book => (book.genre || "").trim())
      .filter(Boolean)
  );

  const publicReviews = reviews.filter(r => r.visibility === "public").length;

  return {
    totalFinished,
    booksThisYear,
    booksThisMonth,
    streak: computeStreak(data.activity),
    goals: data.goals,
    genreCount: genres.size,
    reviewCount: reviews.length,
    publicReviews
  };
}

function progressCard({ icon, label, value, goal, unit }) {
  const hasGoal = goal && goal > 0;
  const pct = hasGoal ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const meta = hasGoal
    ? `<div class="challenge-bar"><div style="width:${pct}%"></div></div><p class="challenge-goal">${value} of ${goal} ${unit}</p>`
    : `<p class="challenge-goal">${unit}</p>`;

  return `
    <div class="progress-card card">
      <div class="progress-card-icon">${svg(icon)}</div>
      <strong class="progress-card-value">${value}</strong>
      <p class="progress-card-label">${label}</p>
      ${meta}
    </div>
  `;
}

function renderProgressCards(stats) {
  const container = document.getElementById("progressCards");
  container.innerHTML = [
    progressCard({
      icon: "calendar",
      label: "This year",
      value: stats.booksThisYear,
      goal: stats.goals.yearly,
      unit: stats.goals.yearly ? "books" : "books finished this year"
    }),
    progressCard({
      icon: "book",
      label: "This month",
      value: stats.booksThisMonth,
      goal: stats.goals.monthly,
      unit: stats.goals.monthly ? "books" : "books finished this month"
    }),
    progressCard({
      icon: "flame",
      label: "Current streak",
      value: stats.streak,
      goal: 0,
      unit: stats.streak === 1 ? "day of reading" : "days of reading"
    }),
    progressCard({
      icon: "trophy",
      label: "All time",
      value: stats.totalFinished,
      goal: 0,
      unit: stats.totalFinished === 1 ? "book finished" : "books finished"
    })
  ].join("");
}

function buildBadges(stats) {
  return [
    { icon: "book", label: "First Finish", desc: "Finish your first book", value: stats.totalFinished, goal: 1 },
    { icon: "book", label: "Bookworm", desc: "Finish 5 books", value: stats.totalFinished, goal: 5 },
    { icon: "book", label: "Bibliophile", desc: "Finish 10 books", value: stats.totalFinished, goal: 10 },
    { icon: "trophy", label: "Scholar", desc: "Finish 25 books", value: stats.totalFinished, goal: 25 },
    { icon: "compass", label: "Genre Explorer", desc: "Read across 3 genres", value: stats.genreCount, goal: 3 },
    { icon: "message", label: "Reviewer", desc: "Write your first review", value: stats.reviewCount, goal: 1 },
    { icon: "message", label: "Critic", desc: "Write 5 reviews", value: stats.reviewCount, goal: 5 },
    { icon: "compass", label: "Community Voice", desc: "Share a public review", value: stats.publicReviews, goal: 1 },
    { icon: "flame", label: "On Fire", desc: "Reach a 3-day streak", value: stats.streak, goal: 3 },
    { icon: "flame", label: "Consistent", desc: "Reach a 7-day streak", value: stats.streak, goal: 7 },
    { icon: "target", label: "Goal Crusher", desc: "Hit your yearly goal", value: stats.booksThisYear, goal: stats.goals.yearly || 0 }
  ];
}

function renderBadges(stats) {
  const grid = document.getElementById("badgeGrid");
  const badges = buildBadges(stats);

  grid.innerHTML = badges
    .map(badge => {
      const target = badge.goal && badge.goal > 0 ? badge.goal : null;
      const earned = target != null && badge.value >= target;
      const status = target == null
        ? "Set a yearly goal to unlock"
        : earned
          ? "Earned"
          : `${Math.min(badge.value, target)} / ${target}`;

      return `
        <div class="badge ${earned ? "earned" : "locked"}">
          <div class="badge-icon">${svg(badge.icon)}</div>
          <div class="badge-body">
            <strong>${badge.label}</strong>
            <p>${badge.desc}</p>
            <span class="badge-status">${earned ? svg("check", "icon-inline") + " " : ""}${status}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function setupGoals() {
  const goals = BookMindLibrary.getGoals();
  const yearlyInput = document.getElementById("goalYearly");
  const monthlyInput = document.getElementById("goalMonthly");
  const message = document.getElementById("goalMessage");

  if (goals.yearly) yearlyInput.value = goals.yearly;
  if (goals.monthly) monthlyInput.value = goals.monthly;

  document.getElementById("saveGoalsBtn").addEventListener("click", () => {
    BookMindLibrary.setGoals({
      yearly: yearlyInput.value,
      monthly: monthlyInput.value
    });
    message.textContent = "Goals saved.";
    render();
    setTimeout(() => (message.textContent = ""), 2500);
  });
}

function render() {
  const stats = gatherStats();
  renderProgressCards(stats);
  renderBadges(stats);
}

setupGoals();

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await BookMindLibrary.ensureLoaded();
  } catch (error) {
    console.error(error);
  }
  render();
});
