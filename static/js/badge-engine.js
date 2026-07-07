/**
 * Badge evaluation engine — gathers reading context, evaluates catalog + dynamic badges,
 * persists unlock dates. Add new static badges in badge-catalog.js only.
 */
window.BookMindBadgeEngine = {
  STORAGE_KEY: "bookmind_earned_badges",
  AI_STORAGE_KEY: "bookmind_ai_badges",
  AI_FETCH_META_KEY: "bookmind_ai_badges_meta",
  SEEN_KEY: "bookmind_badges_seen",
  _aiBadgesTtlMs: 60 * 60 * 1000,

  svg(iconName, cls) {
    const paths = BookMindBadgeCatalog.ICONS[iconName] || BookMindBadgeCatalog.ICONS.star;
    return `<svg class="icon ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  },

  readJson(key, fallback = null) {
    return window.BookMindUI?.readStorageJson?.(key, fallback) ?? fallback;
  },

  genreBucket(raw) {
    const g = String(raw || "").toLowerCase();
    if (/fantasy|magical/.test(g)) return "fantasy";
    if (/mystery|thriller|crime|detective/.test(g)) return "mystery";
    if (/romance|love/.test(g)) return "romance";
    if (/horror|scary|gothic/.test(g)) return "horror";
    if (/sci[- ]?fi|science fiction|dystopian|space/.test(g)) return "scifi";
    if (/historical/.test(g)) return "historical";
    if (/biograph|memoir/.test(g)) return "biography";
    if (/poetry|poem/.test(g)) return "poetry";
    if (/classic/.test(g)) return "classics";
    if (/non-fiction|nonfiction|self-help/.test(g)) return "nonfiction";
    return "other";
  },

  dateKey(iso) {
    try {
      const d = new Date(iso);
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d - offset).toISOString().slice(0, 10);
    } catch {
      return "";
    }
  },

  computeStreak(activity) {
    const set = new Set(activity || []);
    if (set.size === 0) return 0;
    const cursor = new Date();
    if (!set.has(this.dateKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!set.has(this.dateKey(cursor))) return 0;
    }
    let streak = 0;
    while (set.has(this.dateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  },

  pagesForBook(book) {
    const total = Number(book.total_pages || book.totalPages) || 0;
    if (book.status === "read") return total || 280;
    const progress = Number(book.progress) || 0;
    if (total && progress) return Math.round((progress / 100) * total);
    return 0;
  },

  buildContext() {
    const library = window.BookMindLibrary?.getLibrary?.() || {
      read: [],
      reading: [],
      want: [],
      not_interested: [],
    };
    const data = window.BookMindLibrary?.getReadingData?.() || {
      finishes: {},
      activity: [],
      goals: { yearly: 0, monthly: 0 },
    };
    const reviews = this.readJson("book_reviews", []) || [];
    const answers = this.readJson("reader_quiz_answers", {}) || {};
    const profile = this.readJson("readerProfile", {}) || {};
    const todayMood = localStorage.getItem("bookmind_today_mood") || "";

    const allBooks = [
      ...(library.read || []),
      ...(library.reading || []),
      ...(library.want || []),
    ];

    const readBooks = library.read || [];
    const genreCounts = {};
    const authorCounts = {};
    let totalPagesRead = 0;
    let nightFinishes = 0;
    let morningFinishes = 0;
    let weekendFinishes = 0;

    readBooks.forEach(book => {
      const bucket = this.genreBucket(book.genre);
      genreCounts[bucket] = (genreCounts[bucket] || 0) + 1;
      totalPagesRead += this.pagesForBook(book);

      const author = (book.author || "").trim();
      if (author) authorCounts[author] = (authorCounts[author] || 0) + 1;

      const finishIso = data.finishes[BookMindLibrary.normalizeTitle(book.title)];
      if (finishIso) {
        const d = new Date(finishIso);
        const hour = d.getHours();
        const day = d.getDay();
        if (hour >= 22 || hour < 4) nightFinishes += 1;
        if (hour >= 5 && hour < 8) morningFinishes += 1;
        if (day === 0 || day === 6) weekendFinishes += 1;
      }
    });

    const activity = data.activity || [];
    const mondayActivity = activity.filter(d => {
      const day = new Date(d + "T12:00:00").getDay();
      return day === 1;
    }).length;

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

    const started = (library.reading || []).length + readBooks.length;
    const completionRate =
      started > 0 ? Math.round((readBooks.length / started) * 100) : 0;

    const pacing = String(answers.pacing || "").toLowerCase();
    const mood = String(answers.preferredMood || todayMood || "").toLowerCase();
    const plot = String(answers.plotStyle || "").toLowerCase();
    const world = String(answers.worldbuilding || "").toLowerCase();
    const chars = String(answers.characterTypes || "").toLowerCase();
    const emotional = String(answers.emotionalIntensity || "").toLowerCase();
    const goals = String(answers.readingGoals || "").toLowerCase();
    const style = String(answers.writingStyle || "").toLowerCase();

    const topGenreEntry = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
    const topAuthorEntry = Object.entries(authorCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      library,
      readBooks,
      allBooks,
      reviews,
      answers,
      profile,
      goals: data.goals || { yearly: 0, monthly: 0 },
      totalFinished: readBooks.length,
      booksStarted: started,
      booksThisYear,
      booksThisMonth,
      streak: this.computeStreak(activity),
      totalPagesRead,
      genreCount: Object.keys(genreCounts).filter(k => k !== "other" && genreCounts[k] > 0).length,
      genreCounts,
      genreFantasy: genreCounts.fantasy || 0,
      genreMystery: genreCounts.mystery || 0,
      genreRomance: genreCounts.romance || 0,
      genreHorror: genreCounts.horror || 0,
      genreScifi: genreCounts.scifi || 0,
      genreHistorical: genreCounts.historical || 0,
      genreBiography: genreCounts.biography || 0,
      genrePoetry: genreCounts.poetry || 0,
      genreClassics: genreCounts.classics || 0,
      reviewCount: reviews.length,
      publicReviews: reviews.filter(r => r.visibility === "public").length,
      librarySize: allBooks.length,
      wantCount: (library.want || []).length,
      readingCount: (library.reading || []).length,
      completionRate,
      nightFinishes,
      morningFinishes,
      weekendFinishes,
      mondayActivity,
      topGenre: topGenreEntry?.[0] || "",
      topGenreCount: topGenreEntry?.[1] || 0,
      topAuthor: topAuthorEntry?.[0] || "",
      topAuthorCount: topAuthorEntry?.[1] || 0,
      moodNightOwl: /night|dark|tension|gritty/.test(mood),
      moodMorning: /sunlit|optimism|coffee|morning/.test(mood),
      moodCozy: /cozy|rainy|dreamy|comfort/.test(mood),
      comfortReader: topGenreEntry && topGenreEntry[1] >= 3,
      dnaDeepThinker: /literary|dense|thoughtful/.test(style + goals),
      dnaEmotional: /high|intense|emotional/.test(emotional) || /emotional/.test(mood),
      dnaPlotTwist: /twist|surprise|unpredict/.test(plot),
      dnaWorldBuilder: /rich|immersive|high|world/.test(world),
      dnaCharacterLover: /complex|relatable|character|flawed/.test(chars),
      dnaCozy: /cozy|rainy|comfort/.test(mood),
      dnaFastPaced: /breathless|momentum|fast/.test(pacing),
      dnaThoughtful: /leisurely|slow|balanced/.test(pacing),
      dnaCurious: /learn|discover|non-fiction/.test(goals) || (answers.favoriteGenres || []).includes("Non-fiction"),
      dnaAdventure: /adventure|high-stakes|bold/.test(mood + goals),
      readerType: profile.reader_type || "",
      favoriteGenres: profile.favorite_genres || answers.favoriteGenres || [],
    };
  },

  loadEarned() {
    return this.readJson(this.STORAGE_KEY, {}) || {};
  },

  saveEarned(earned) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(earned));
  },

  loadSeen() {
    return this.readJson(this.SEEN_KEY, {}) || {};
  },

  saveSeen(seen) {
    localStorage.setItem(this.SEEN_KEY, JSON.stringify(seen));
  },

  loadAiBadges() {
    return this.readJson(this.AI_STORAGE_KEY, []) || [];
  },

  saveAiBadges(badges) {
    localStorage.setItem(this.AI_STORAGE_KEY, JSON.stringify(badges));
  },

  titleCase(str) {
    return String(str || "")
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  },

  /** Rule-based personalized badges from reading habits (AI-labeled category). */
  buildAiBadges(ctx) {
    const cached = this.loadAiBadges();
    const generated = [];
    const usedTitles = new Set(cached.map(b => b.title));

    const add = (title, description, icon, rarity, test) => {
      if (!test || usedTitles.has(title)) return;
      const id = "ai-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      generated.push({
        id,
        category: "ai",
        title,
        description,
        icon: icon || "robot",
        rarity: rarity || "rare",
        dynamic: true,
        evaluate(c) {
          return test(c);
        },
      });
      usedTitles.add(title);
    };

    const genreLabels = {
      fantasy: "Fantasy Worlds",
      mystery: "Mystery & Thrillers",
      romance: "Romance",
      horror: "Horror",
      scifi: "Sci-Fi",
      historical: "Historical Fiction",
      biography: "Biography",
      poetry: "Poetry",
      classics: "Classic Literature",
    };

    if (ctx.topGenre && ctx.topGenreCount >= 3 && genreLabels[ctx.topGenre]) {
      add(
        `Master of ${genreLabels[ctx.topGenre]}`,
        `You've finished ${ctx.topGenreCount} books in this lane`,
        "sparkles",
        ctx.topGenreCount >= 6 ? "legendary" : "epic",
        c => ({ value: c.topGenreCount, goal: 3 })
      );
    }

    if (ctx.topAuthor && ctx.topAuthorCount >= 2) {
      add(
        `${this.titleCase(ctx.topAuthor.split(" ").slice(-1)[0])} Devotee`,
        `Finished ${ctx.topAuthorCount} books by ${ctx.topAuthor}`,
        "book",
        ctx.topAuthorCount >= 4 ? "epic" : "rare",
        c => ({ value: c.topAuthorCount, goal: 2 })
      );
    }

    if (ctx.genreCount >= 4) {
      add(
        "Genre Nomad",
        "You explore widely across reading landscapes",
        "compass",
        "rare",
        c => ({ value: c.genreCount, goal: 4 })
      );
    }

    if (ctx.reviewCount >= 2 && ctx.publicReviews >= 1) {
      add(
        "Book Recommendation Magnet",
        "Your reviews help other readers discover gems",
        "message",
        "epic",
        c => ({ value: c.publicReviews, goal: 1 })
      );
    }

    if (ctx.completionRate >= 60 && ctx.totalFinished >= 3) {
      add(
        "Finisher Mentality",
        "You close the books you start",
        "target",
        "rare",
        c => ({ value: c.completionRate, goal: 60 })
      );
    }

    if (ctx.streak >= 5) {
      add(
        "Momentum Keeper",
        "Consistency is your superpower",
        "flame",
        "epic",
        c => ({ value: c.streak, goal: 5 })
      );
    }

    if (ctx.totalPagesRead >= 2000) {
      add(
        "Epic Saga Reader",
        "Thousands of pages conquered",
        "pages",
        "legendary",
        c => ({ value: c.totalPagesRead, goal: 2000 })
      );
    }

    if (/dark academia|academia/.test((ctx.favoriteGenres || []).join(" ").toLowerCase())) {
      add(
        "Dark Academia Enthusiast",
        "Campus secrets and moody libraries are your genre",
        "book",
        "rare",
        () => ({ value: 1, goal: 1 })
      );
    }

    if (ctx.dnaPlotTwist && ctx.genreMystery >= 2) {
      add(
        "Plot Twist Collector",
        "You hunt stories that surprise you",
        "zap",
        "epic",
        c => ({ value: c.genreMystery, goal: 2 })
      );
    }

    if (ctx.dnaEmotional && ctx.reviewCount >= 1) {
      add(
        "Emotional Journey Expert",
        "You feel every arc and share the experience",
        "heart",
        "rare",
        c => ({ value: c.reviewCount, goal: 1 })
      );
    }

    if (ctx.dnaCharacterLover) {
      add(
        "Character Psychologist",
        "You read for the people inside the pages",
        "brain",
        "rare",
        () => ({ value: 1, goal: 1 })
      );
    }

    if (ctx.readerType) {
      add(
        `${ctx.readerType} Badge`,
        "Earned from your unique Reader DNA profile",
        "robot",
        "legendary",
        () => ({ value: 1, goal: 1 })
      );
    }

    const merged = [...cached];
    generated.forEach(b => {
      if (!merged.some(m => m.id === b.id)) merged.push(b);
    });
    if (generated.length) this.saveAiBadges(merged);

    return merged.map(b => ({
      ...b,
      evaluate: b.evaluate || (() => ({ value: 0, goal: 1 })),
    }));
  },

  evaluateBadge(def, ctx) {
    const result = def.evaluate(ctx);
    const goal = Math.max(1, Number(result.goal) || 1);
    const value = Math.max(0, Number(result.value) || 0);
    const progress = Math.min(100, Math.round((value / goal) * 100));
    const earned = value >= goal;
    return { value, goal, progress, earned };
  },

  evaluateAll(ctx) {
    const staticBadges = BookMindBadgeCatalog.getStaticBadges();
    const aiBadges = this.buildAiBadges(ctx);
    const allDefs = [...staticBadges, ...aiBadges];

    const earnedStore = this.loadEarned();
    const seenStore = this.loadSeen();
    const now = new Date().toISOString();
    let newlyEarned = [];

    const badges = allDefs.map(def => {
      const { value, goal, progress, earned } = this.evaluateBadge(def, ctx);
      let unlockedAt = earnedStore[def.id] || null;

      if (earned && !unlockedAt) {
        unlockedAt = now;
        earnedStore[def.id] = unlockedAt;
        if (!seenStore[def.id]) newlyEarned.push(def.id);
      }

      return {
        ...def,
        value,
        goal,
        progress,
        earned,
        unlockedAt,
        isNew: earned && !seenStore[def.id],
      };
    });

    this.saveEarned(earnedStore);

    return { badges, newlyEarned, ctx };
  },

  markSeen(ids) {
    const seen = this.loadSeen();
    ids.forEach(id => {
      seen[id] = true;
    });
    this.saveSeen(seen);
  },

  stats(badges) {
    const earned = badges.filter(b => b.earned);
    const byRarity = { common: 0, rare: 0, epic: 0, legendary: 0 };
    earned.forEach(b => {
      if (byRarity[b.rarity] != null) byRarity[b.rarity] += 1;
    });
    const newest = earned
      .filter(b => b.unlockedAt)
      .sort((a, b) => new Date(b.unlockedAt) - new Date(a.unlockedAt))
      .slice(0, 3);

    return {
      total: badges.length,
      earned: earned.length,
      locked: badges.length - earned.length,
      percent: badges.length ? Math.round((earned.length / badges.length) * 100) : 0,
      byRarity,
      newest,
    };
  },

  async fetchAiBadgesFromServer(ctx, { force = false } = {}) {
    if (!window.BookMindAPI?.post || !window.BookMindAuth?.isLoggedIn?.()) return null;

    if (!force) {
      try {
        const meta = JSON.parse(localStorage.getItem(this.AI_FETCH_META_KEY) || "null");
        const cached = this.loadAiBadges();
        if (
          meta?.at &&
          Date.now() - meta.at < this._aiBadgesTtlMs &&
          Array.isArray(cached) &&
          cached.length
        ) {
          return cached;
        }
      } catch {
        /* ignore */
      }
    }

    try {
      const data = await BookMindAPI.post("/api/reader/badges", {
        reader_profile: ctx.profile,
        stats: {
          total_finished: ctx.totalFinished,
          total_pages: ctx.totalPagesRead,
          streak: ctx.streak,
          top_genre: ctx.topGenre,
          top_author: ctx.topAuthor,
          completion_rate: ctx.completionRate,
          review_count: ctx.reviewCount,
        },
        library: ctx.library,
      });
      if (Array.isArray(data?.badges) && data.badges.length) {
        const existing = this.loadAiBadges();
        const merged = [...existing];
        data.badges.forEach(b => {
          if (!merged.some(m => m.id === b.id)) {
            const metricMap = {
              totalFinished: "totalFinished",
              totalPagesRead: "totalPagesRead",
              streak: "streak",
              reviewCount: "reviewCount",
              total_finished: "totalFinished",
              total_pages: "totalPagesRead",
              review_count: "reviewCount",
            };
            const metricKey = metricMap[b.metric] || b.metric;
            merged.push({
              ...b,
              category: "ai",
              dynamic: true,
              evaluate(c) {
                const goal = Number(b.goal) || 1;
                const val = metricKey ? Number(c[metricKey]) || 0 : 1;
                return { value: val, goal };
              },
            });
          }
        });
        this.saveAiBadges(merged);
        localStorage.setItem(this.AI_FETCH_META_KEY, JSON.stringify({ at: Date.now() }));
        return merged;
      }
    } catch {
      /* rule-based AI badges still work offline */
    }
    return null;
  },
};
