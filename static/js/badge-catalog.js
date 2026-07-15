/**
 * Badge metadata catalog — add new badges here only; evaluation logic lives in badge-engine.js.
 * Each entry: { id, category, title, description, icon, rarity, evaluate(ctx) -> { value, goal } }
 */
window.LexoBadgeCatalog = {
  CATEGORIES: {
    milestones: { label: "Reading Milestones", emoji: "📚" },
    streaks: { label: "Streaks", emoji: "🔥" },
    genres: { label: "Genre Explorer", emoji: "🌍" },
    dna: { label: "Reader DNA", emoji: "🧠" },
    personality: { label: "Reading Personality", emoji: "❤️" },
    ai: { label: "AI Personalized", emoji: "🤖" },
  },

  RARITIES: ["common", "rare", "epic", "legendary"],

  ICONS: {
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    chapter: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.09 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L1.85 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 0 0-8h-1"/><path d="M6 2v2"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287z"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    pages: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    robot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  },

  count(id, meta, metric, goal) {
    return {
      id,
      ...meta,
      evaluate(ctx) {
        return { value: Number(ctx[metric]) || 0, goal };
      },
    };
  },

  flag(id, meta, testFn) {
    return {
      id,
      ...meta,
      evaluate(ctx) {
        const earned = Boolean(testFn(ctx));
        return { value: earned ? 1 : 0, goal: 1 };
      },
    };
  },

  getStaticBadges() {
    const { count, flag } = this;

    return [
      /* ── Reading Milestones (10) ── */
      flag("ms-first-chapter", {
        category: "milestones",
        title: "First Chapter",
        description: "Start reading your first book",
        icon: "chapter",
        rarity: "common",
      }, ctx => ctx.booksStarted >= 1),

      count("ms-first-finish", {
        category: "milestones",
        title: "First Book Finished",
        description: "Complete your first book",
        icon: "book",
        rarity: "common",
      }, "totalFinished", 1),

      count("ms-five-club", {
        category: "milestones",
        title: "Five Book Club",
        description: "Finish five books",
        icon: "book",
        rarity: "common",
      }, "totalFinished", 5),

      count("ms-ten-books", {
        category: "milestones",
        title: "10 Books",
        description: "Finish ten books",
        icon: "book",
        rarity: "rare",
      }, "totalFinished", 10),

      count("ms-twenty-five", {
        category: "milestones",
        title: "25 Books",
        description: "Finish twenty-five books",
        icon: "trophy",
        rarity: "rare",
      }, "totalFinished", 25),

      count("ms-fifty-books", {
        category: "milestones",
        title: "50 Books",
        description: "Finish fifty books",
        icon: "trophy",
        rarity: "epic",
      }, "totalFinished", 50),

      count("ms-hundred-books", {
        category: "milestones",
        title: "100 Books",
        description: "Finish one hundred books",
        icon: "trophy",
        rarity: "legendary",
      }, "totalFinished", 100),

      count("ms-page-master", {
        category: "milestones",
        title: "Page Master",
        description: "Read 1,000 pages",
        icon: "pages",
        rarity: "rare",
      }, "totalPagesRead", 1000),

      count("ms-marathon", {
        category: "milestones",
        title: "Marathon Reader",
        description: "Read 5,000 pages",
        icon: "pages",
        rarity: "epic",
      }, "totalPagesRead", 5000),

      count("ms-lifetime", {
        category: "milestones",
        title: "Lifetime Reader",
        description: "Read 10,000 pages",
        icon: "star",
        rarity: "legendary",
      }, "totalPagesRead", 10000),

      /* ── Streaks (8) ── */
      count("st-three-day", {
        category: "streaks",
        title: "3-Day Streak",
        description: "Read three days in a row",
        icon: "flame",
        rarity: "common",
      }, "streak", 3),

      count("st-weekly", {
        category: "streaks",
        title: "Weekly Reader",
        description: "Maintain a 7-day reading streak",
        icon: "flame",
        rarity: "rare",
      }, "streak", 7),

      count("st-two-week", {
        category: "streaks",
        title: "Two Week Streak",
        description: "Read fourteen days straight",
        icon: "flame",
        rarity: "epic",
      }, "streak", 14),

      count("st-monthly", {
        category: "streaks",
        title: "Monthly Reader",
        description: "Keep reading for 30 days straight",
        icon: "flame",
        rarity: "legendary",
      }, "streak", 30),

      flag("st-night-owl", {
        category: "streaks",
        title: "Night Owl",
        description: "Finish a book after 10 PM",
        icon: "moon",
        rarity: "rare",
      }, ctx => ctx.nightFinishes >= 1),

      flag("st-early-bird", {
        category: "streaks",
        title: "Early Bird",
        description: "Finish a book before 8 AM",
        icon: "sun",
        rarity: "rare",
      }, ctx => ctx.morningFinishes >= 1),

      flag("st-weekend", {
        category: "streaks",
        title: "Weekend Warrior",
        description: "Finish a book on the weekend",
        icon: "star",
        rarity: "common",
      }, ctx => ctx.weekendFinishes >= 1),

      flag("st-monday", {
        category: "streaks",
        title: "Never Miss Monday",
        description: "Log reading activity on a Monday",
        icon: "target",
        rarity: "common",
      }, ctx => ctx.mondayActivity >= 1),

      /* ── Genre Explorer (10) ── */
      count("ge-fantasy", {
        category: "genres",
        title: "Fantasy Explorer",
        description: "Finish a fantasy novel",
        icon: "sparkles",
        rarity: "common",
      }, "genreFantasy", 1),

      count("ge-mystery", {
        category: "genres",
        title: "Mystery Detective",
        description: "Finish a mystery or thriller",
        icon: "compass",
        rarity: "common",
      }, "genreMystery", 1),

      count("ge-romance", {
        category: "genres",
        title: "Romance Collector",
        description: "Finish a romance novel",
        icon: "heart",
        rarity: "common",
      }, "genreRomance", 1),

      count("ge-horror", {
        category: "genres",
        title: "Horror Survivor",
        description: "Finish a horror book",
        icon: "moon",
        rarity: "rare",
      }, "genreHorror", 1),

      count("ge-scifi", {
        category: "genres",
        title: "Sci-Fi Voyager",
        description: "Finish a sci-fi story",
        icon: "star",
        rarity: "common",
      }, "genreScifi", 1),

      count("ge-historical", {
        category: "genres",
        title: "Historical Scholar",
        description: "Finish historical fiction",
        icon: "book",
        rarity: "rare",
      }, "genreHistorical", 1),

      count("ge-biography", {
        category: "genres",
        title: "Biography Lover",
        description: "Finish a biography or memoir",
        icon: "pages",
        rarity: "rare",
      }, "genreBiography", 1),

      count("ge-poetry", {
        category: "genres",
        title: "Poetry Soul",
        description: "Finish a poetry collection",
        icon: "heart",
        rarity: "epic",
      }, "genrePoetry", 1),

      count("ge-classics", {
        category: "genres",
        title: "Classic Reader",
        description: "Finish a classic novel",
        icon: "trophy",
        rarity: "rare",
      }, "genreClassics", 1),

      count("ge-hopper", {
        category: "genres",
        title: "Genre Hopper",
        description: "Read across five different genres",
        icon: "compass",
        rarity: "epic",
      }, "genreCount", 5),

      /* ── Reader DNA (10) — unlocked from quiz answers ── */
      flag("dna-deep-thinker", {
        category: "dna",
        title: "The Deep Thinker",
        description: "Your DNA leans toward literary, reflective reads",
        icon: "brain",
        rarity: "rare",
      }, ctx => ctx.dnaDeepThinker),

      flag("dna-emotional", {
        category: "dna",
        title: "Emotional Reader",
        description: "You seek stories that hit you in the feels",
        icon: "heart",
        rarity: "common",
      }, ctx => ctx.dnaEmotional),

      flag("dna-plot-twist", {
        category: "dna",
        title: "Plot Twist Hunter",
        description: "You live for shocking reveals",
        icon: "zap",
        rarity: "rare",
      }, ctx => ctx.dnaPlotTwist),

      flag("dna-world-builder", {
        category: "dna",
        title: "World Builder",
        description: "Rich worlds and immersive settings call to you",
        icon: "sparkles",
        rarity: "rare",
      }, ctx => ctx.dnaWorldBuilder),

      flag("dna-character", {
        category: "dna",
        title: "Character Lover",
        description: "Memorable characters are your favorite part",
        icon: "heart",
        rarity: "common",
      }, ctx => ctx.dnaCharacterLover),

      flag("dna-cozy", {
        category: "dna",
        title: "Cozy Reader",
        description: "Rainy-day comfort reads are your vibe",
        icon: "cloud",
        rarity: "common",
      }, ctx => ctx.dnaCozy),

      flag("dna-fast-paced", {
        category: "dna",
        title: "Fast-Paced Explorer",
        description: "You want breathless momentum on every page",
        icon: "zap",
        rarity: "common",
      }, ctx => ctx.dnaFastPaced),

      flag("dna-thoughtful", {
        category: "dna",
        title: "Slow & Thoughtful",
        description: "You savor leisurely, layered storytelling",
        icon: "book",
        rarity: "rare",
      }, ctx => ctx.dnaThoughtful),

      flag("dna-curious", {
        category: "dna",
        title: "Curious Mind",
        description: "You read to learn and discover new ideas",
        icon: "brain",
        rarity: "common",
      }, ctx => ctx.dnaCurious),

      flag("dna-adventure", {
        category: "dna",
        title: "Adventure Seeker",
        description: "High stakes and bold journeys energize you",
        icon: "compass",
        rarity: "common",
      }, ctx => ctx.dnaAdventure),

      /* ── Reading Personality (10) ── */
      count("rp-bookworm", {
        category: "personality",
        title: "Bookworm",
        description: "Finish at least three books",
        icon: "book",
        rarity: "common",
      }, "totalFinished", 3),

      count("rp-collector", {
        category: "personality",
        title: "Story Collector",
        description: "Save ten books to your library",
        icon: "library",
        rarity: "common",
      }, "librarySize", 10),

      count("rp-keeper", {
        category: "personality",
        title: "Library Keeper",
        description: "Curate twenty-five books on your shelves",
        icon: "library",
        rarity: "rare",
      }, "librarySize", 25),

      flag("rp-late-night", {
        category: "personality",
        title: "Late Night Reader",
        description: "Your reading mood skews after dark",
        icon: "moon",
        rarity: "common",
      }, ctx => ctx.moodNightOwl),

      flag("rp-coffee", {
        category: "personality",
        title: "Coffee & Chapters",
        description: "Morning reading sessions are your ritual",
        icon: "coffee",
        rarity: "common",
      }, ctx => ctx.moodMorning),

      flag("rp-rainy", {
        category: "personality",
        title: "Rainy Day Reader",
        description: "Cozy moods dominate your Reader DNA",
        icon: "cloud",
        rarity: "common",
      }, ctx => ctx.moodCozy),

      flag("rp-comfort", {
        category: "personality",
        title: "Comfort Reader",
        description: "You return to favorite genres again and again",
        icon: "heart",
        rarity: "rare",
      }, ctx => ctx.comfortReader),

      count("rp-page-turner", {
        category: "personality",
        title: "Page Turner",
        description: "Maintain a 70%+ completion rate",
        icon: "zap",
        rarity: "epic",
      }, "completionRate", 70),

      count("rp-shelf-builder", {
        category: "personality",
        title: "Shelf Builder",
        description: "Have five books on your Want to Read shelf",
        icon: "library",
        rarity: "common",
      }, "wantCount", 5),

      count("rp-reviewer", {
        category: "personality",
        title: "Community Voice",
        description: "Share three public reviews",
        icon: "message",
        rarity: "rare",
      }, "publicReviews", 3),

      /* ── Challenge participation (2 extras) ── */
      flag("ms-goal-year", {
        category: "milestones",
        title: "Goal Crusher",
        description: "Hit your yearly reading goal",
        icon: "target",
        rarity: "epic",
      }, ctx => ctx.goals.yearly > 0 && ctx.booksThisYear >= ctx.goals.yearly),

      count("ms-reviews-five", {
        category: "milestones",
        title: "Review Enthusiast",
        description: "Write five book reviews",
        icon: "message",
        rarity: "rare",
      }, "reviewCount", 5),

      /* ── Reading Path completion ── */
      count("path-journey-one", {
        category: "milestones",
        title: "Pathfinder",
        description: "Complete your first Reading Path",
        icon: "compass",
        rarity: "rare",
      }, "pathsCompleted", 1),

      count("path-journey-three", {
        category: "milestones",
        title: "Trailblazer",
        description: "Complete three Reading Paths",
        icon: "trophy",
        rarity: "epic",
      }, "pathsCompleted", 3),

      count("path-journey-five", {
        category: "milestones",
        title: "Master Navigator",
        description: "Complete five Reading Paths",
        icon: "flag",
        rarity: "legendary",
      }, "pathsCompleted", 5),

      flag("path-advanced-unlock", {
        category: "milestones",
        title: "Advanced Paths Unlocked",
        description: "Earned by completing a full Reading Path",
        icon: "sparkles",
        rarity: "epic",
      }, ctx => ctx.pathsCompleted >= 1),
    ];
  },
};
