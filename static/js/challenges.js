/* Reading challenges & achievements: goals, streaks, badges via BookMindBadgeEngine. */

const ICONS = {
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
};

const state = {
  badges: [],
  tab: "all",
  category: "",
  rarity: "",
};

function showLoadingSkeletons() {
  const cards = document.getElementById("progressCards");
  const stats = document.getElementById("badgeStatsBar");
  const grid = document.getElementById("badgeGrid");

  if (cards) {
    cards.innerHTML = Array.from({ length: 4 }, () => `
      <div class="progress-card card skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-line skeleton-line-lg"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line skeleton-line-sm"></div>
      </div>
    `).join("");
  }

  if (stats) {
    stats.innerHTML = `
      <div class="skeleton skeleton-line skeleton-line-lg"></div>
      <div class="skeleton skeleton-line"></div>
    `;
  }

  if (grid) {
    grid.innerHTML = Array.from({ length: 8 }, () => `
      <div class="badge-card skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-line skeleton-line-lg"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    `).join("");
  }
}

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

function gatherGoalStats() {
  const library = BookMindLibrary.getLibrary();
  const data = BookMindLibrary.getReadingData();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  let booksThisYear = 0;
  let booksThisMonth = 0;
  Object.values(data.finishes || {}).forEach(iso => {
    const d = new Date(iso);
    if (d.getFullYear() === year) {
      booksThisYear += 1;
      if (d.getMonth() === month) booksThisMonth += 1;
    }
  });

  return {
    totalFinished: (library.read || []).length,
    booksThisYear,
    booksThisMonth,
    streak: computeStreak(data.activity),
    goals: data.goals,
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
  document.getElementById("progressCards").innerHTML = [
    progressCard({
      icon: "calendar",
      label: "This year",
      value: stats.booksThisYear,
      goal: stats.goals.yearly,
      unit: stats.goals.yearly ? "books" : "books finished this year",
    }),
    progressCard({
      icon: "book",
      label: "This month",
      value: stats.booksThisMonth,
      goal: stats.goals.monthly,
      unit: stats.goals.monthly ? "books" : "books finished this month",
    }),
    progressCard({
      icon: "flame",
      label: "Current streak",
      value: stats.streak,
      goal: 0,
      unit: stats.streak === 1 ? "day of reading" : "days of reading",
    }),
    progressCard({
      icon: "trophy",
      label: "All time",
      value: stats.totalFinished,
      goal: 0,
      unit: stats.totalFinished === 1 ? "book finished" : "books finished",
    }),
  ].join("");
}

function formatUnlockDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function rarityLabel(rarity) {
  return String(rarity || "common").charAt(0).toUpperCase() + String(rarity || "common").slice(1);
}

function categoryLabel(category) {
  const meta = BookMindBadgeCatalog.CATEGORIES[category];
  return meta ? `${meta.emoji} ${meta.label}` : category;
}

function renderBadgeCard(badge, compact) {
  const engine = BookMindBadgeEngine;
  const earned = badge.earned;
  const animate = badge.isNew ? " badge-pop" : "";
  const rarity = badge.rarity || "common";
  const cat = BookMindBadgeCatalog.CATEGORIES[badge.category];

  const progressHtml = !earned
    ? `
      <div class="badge-progress">
        <div class="badge-progress-fill" style="width:${badge.progress}%"></div>
      </div>
      <span class="achievement-progress badge-progress-label">${Math.min(badge.value, badge.goal)} / ${badge.goal}</span>
    `
    : "";

  const unlockHtml = earned && badge.unlockedAt
    ? `<span class="badge-unlock">Unlocked ${formatUnlockDate(badge.unlockedAt)}</span>`
    : "";

  const articleClass = `achievement-card badge-v2 ${earned ? "earned" : "locked"} rarity-${rarity}${animate}${compact ? " badge-v2-compact" : ""}`;

  return `
    <article class="${articleClass}" data-id="${badge.id}">
      <div class="badge-icon badge-icon-v2">${engine.svg(badge.icon)}</div>
      <div class="badge-body">
        <div class="badge-meta-row">
          <span class="badge-rarity rarity-${rarity}">${rarityLabel(rarity)}</span>
          ${cat ? `<span class="badge-category">${cat.emoji}</span>` : ""}
        </div>
        <strong class="achievement-title">${badge.title}</strong>
        <p class="achievement-description">${badge.description}</p>
        ${progressHtml}
        ${unlockHtml}
      </div>
    </article>
  `;
}

function filterBadges(badges) {
  return badges.filter(b => {
    if (state.tab === "earned" && !b.earned) return false;
    if (state.tab === "locked" && b.earned) return false;
    if (state.category && b.category !== state.category) return false;
    if (state.rarity && b.rarity !== state.rarity) return false;
    return true;
  });
}

function updateLevelHero(stats) {
  const pathXp = window.BookMindPathCompletion?.readXpBonus?.() || 0;
  const totalXp = stats.totalFinished * 50 + pathXp;
  const level = Math.max(1, Math.floor(totalXp / 150) + 1);
  const xpPct = stats.goals.yearly
    ? Math.min(100, Math.round((stats.booksThisYear / stats.goals.yearly) * 100))
    : Math.min(100, Math.round(((totalXp % 150) / 150) * 100));

  const badge = document.getElementById("readerLevelBadge");
  const title = document.getElementById("levelTitle");
  const fill = document.getElementById("levelXpFill");
  const daily = document.getElementById("dailyQuestText");
  const weekly = document.getElementById("weeklyQuestText");

  if (badge) badge.textContent = level;
  if (title) title.textContent = `Level ${level} Reader`;
  if (fill) fill.style.width = `${xpPct}%`;
  if (daily) daily.textContent = stats.streak > 0 ? `Keep your ${stats.streak}-day streak alive` : "Read for 15 minutes today";
  if (weekly) {
    weekly.textContent = stats.goals.monthly
      ? `${stats.booksThisMonth} of ${stats.goals.monthly} books this month`
      : "Finish 1 book this week";
  }
}

function renderBadgeStats(summary) {
  const bar = document.getElementById("badgeStatsBar");
  const rarityItems = BookMindBadgeCatalog.RARITIES.map(r => {
    const count = summary.byRarity[r] || 0;
    return `<span class="badge-stat-pill rarity-${r}">${rarityLabel(r)}: ${count}</span>`;
  }).join("");

  bar.innerHTML = `
    <div class="badge-stats-grid">
      <div class="badge-stat">
        <strong>${summary.earned}</strong>
        <span>Earned</span>
      </div>
      <div class="badge-stat">
        <strong>${summary.locked}</strong>
        <span>Locked</span>
      </div>
      <div class="badge-stat">
        <strong>${summary.total}</strong>
        <span>Total</span>
      </div>
      <div class="badge-stat badge-stat-wide">
        <div class="badge-overall-bar">
          <div style="width:${summary.percent}%"></div>
        </div>
        <span>${summary.percent}% collection complete</span>
      </div>
    </div>
    <div class="badge-rarity-stats">${rarityItems}</div>
  `;

  document.getElementById("badgeCompletion").textContent =
    `${summary.earned} of ${summary.total} badges earned (${summary.percent}%)`;
}

function renderNewestBadges(newest) {
  const section = document.getElementById("newestBadgesSection");
  const row = document.getElementById("newestBadgesRow");

  if (!newest.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  row.innerHTML = newest.map(b => renderBadgeCard(b, true)).join("");
}

function renderBadges() {
  const filtered = filterBadges(state.badges);
  const grid = document.getElementById("badgeGrid");
  const empty = document.getElementById("badgeEmpty");

  grid.innerHTML = filtered.map(b => renderBadgeCard(b, false)).join("");
  empty.hidden = filtered.length > 0;

  if (state.badges.some(b => b.isNew)) {
    setTimeout(() => {
      BookMindBadgeEngine.markSeen(state.badges.filter(b => b.isNew).map(b => b.id));
    }, 1200);
  }
}

function populateCategoryFilter() {
  const select = document.getElementById("filterCategory");
  Object.entries(BookMindBadgeCatalog.CATEGORIES).forEach(([key, meta]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${meta.emoji} ${meta.label}`;
    select.appendChild(opt);
  });
}

function setupFilters() {
  document.querySelectorAll(".badge-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".badge-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.tab = btn.dataset.tab;
      renderBadges();
    });
  });

  document.getElementById("filterCategory").addEventListener("change", e => {
    state.category = e.target.value;
    renderBadges();
  });

  document.getElementById("filterRarity").addEventListener("change", e => {
    state.rarity = e.target.value;
    renderBadges();
  });
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
      monthly: monthlyInput.value,
    });
    message.textContent = "Goals saved.";
    refresh();
    setTimeout(() => (message.textContent = ""), 2500);
  });
}

async function refresh() {
  const goalStats = gatherGoalStats();
  renderProgressCards(goalStats);

  updateLevelHero(goalStats);

  const ctx = BookMindBadgeEngine.buildContext();
  await BookMindBadgeEngine.fetchAiBadgesFromServer(ctx);

  const { badges } = BookMindBadgeEngine.evaluateAll(ctx);
  state.badges = badges;

  const summary = BookMindBadgeEngine.stats(badges);
  renderBadgeStats(summary);
  renderNewestBadges(summary.newest);
  renderBadges();
}

populateCategoryFilter();
setupFilters();
setupGoals();

document.addEventListener("DOMContentLoaded", async () => {
  showLoadingSkeletons();
  try {
    await BookMindLibrary.ensureLoaded();
  } catch {
    /* library optional on challenges page */
  }
  await refresh();
});
