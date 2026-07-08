/** Reading Passport — secret paths, stamps, reviews, journey stats. */
window.BookMindPathPassport = {
  REVIEWS_KEY: "bookmind_path_reviews",
  UNLOCKS_KEY: "bookmind_path_unlocks",

  SECRET_PATHS: [
    {
      secret_id: "around-the-world",
      path_name: "Around the World",
      path_icon: "📚",
      tier: "advanced",
      why_this_path: "Travel the globe through fiction — from Tokyo alleyways to Parisian cafés to Lagos markets.",
      difficulty_progression: "Intermediate",
      unlock: { pathsCompleted: 1 },
      unlockLabel: "Complete 1 Reading Path",
      books: [
        { title: "Kitchen", author: "Banana Yoshimoto", level: "Beginner", difficulty: "Accessible", reason: "A tender Japanese entry point about grief and renewal." },
        { title: "The Shadow of the Wind", author: "Carlos Ruiz Zafón", level: "Intermediate", difficulty: "Moderate", reason: "Barcelona mystery with literary romance." },
        { title: "Americanah", author: "Chimamanda Ngozi Adichie", level: "Intermediate", difficulty: "Moderate", reason: "Nigeria, America, and the politics of belonging." },
        { title: "The Kite Runner", author: "Khaled Hosseini", level: "Intermediate", difficulty: "Emotional", reason: "Afghanistan through friendship and redemption." },
        { title: "One Hundred Years of Solitude", author: "Gabriel García Márquez", level: "Advanced", difficulty: "Challenging", reason: "The definitive magical-realist world tour." },
        { title: "Pachinko", author: "Min Jin Lee", level: "Advanced", difficulty: "Epic", reason: "A sweeping Korean-Japanese family saga." },
      ],
    },
    {
      secret_id: "ancient-classics",
      path_name: "Ancient Classics",
      path_icon: "🏛",
      tier: "advanced",
      why_this_path: "Walk with the voices that shaped Western literature — myth, tragedy, and timeless human questions.",
      difficulty_progression: "Advanced",
      unlock: { pathsCompleted: 2 },
      unlockLabel: "Complete 2 Reading Paths",
      books: [
        { title: "The Odyssey", author: "Homer", level: "Intermediate", difficulty: "Classic", reason: "The original journey home." },
        { title: "Medea", author: "Euripides", level: "Intermediate", difficulty: "Tragic", reason: "Passion, betrayal, and impossible choices." },
        { title: "The Aeneid", author: "Virgil", level: "Advanced", difficulty: "Epic", reason: "Empire, destiny, and sacrifice." },
        { title: "The Oresteia", author: "Aeschylus", level: "Advanced", difficulty: "Dense", reason: "Justice evolving from vengeance to law." },
        { title: "The Histories", author: "Herodotus", level: "Advanced", difficulty: "Scholarly", reason: "Stories of nations, wars, and wonder." },
        { title: "The Golden Ass", author: "Apuleius", level: "Intermediate", difficulty: "Playful", reason: "Metamorphosis and mythic adventure." },
      ],
    },
    {
      secret_id: "nobel-prize",
      path_name: "Nobel Prize Winners",
      path_icon: "👑",
      tier: "legendary",
      why_this_path: "Read the voices the world agreed changed literature forever.",
      difficulty_progression: "Advanced to Legendary",
      unlock: { pathsCompleted: 3 },
      unlockLabel: "Complete 3 Reading Paths",
      books: [
        { title: "Beloved", author: "Toni Morrison", level: "Advanced", difficulty: "Challenging", reason: "Mythic, devastating American masterpiece." },
        { title: "One Hundred Years of Solitude", author: "Gabriel García Márquez", level: "Advanced", difficulty: "Legendary", reason: "The novel that defined a continent." },
        { title: "The Stranger", author: "Albert Camus", level: "Intermediate", difficulty: "Philosophical", reason: "Existential clarity in spare prose." },
        { title: "The Remains of the Day", author: "Kazuo Ishiguro", level: "Intermediate", difficulty: "Subtle", reason: "Repression, duty, and missed life." },
        { title: "The Old Man and the Sea", author: "Ernest Hemingway", level: "Beginner", difficulty: "Accessible", reason: "Endurance distilled to its essence." },
        { title: "Disgrace", author: "J.M. Coetzee", level: "Advanced", difficulty: "Unflinching", reason: "Moral collapse in post-apartheid South Africa." },
      ],
    },
    {
      secret_id: "psychology-essentials",
      path_name: "Psychology Essentials",
      path_icon: "🧠",
      tier: "advanced",
      why_this_path: "Understand the mind — through science, story, and the mysteries of human behavior.",
      difficulty_progression: "Intermediate",
      unlock: { pathsCompleted: 1 },
      unlockLabel: "Complete 1 Reading Path",
      books: [
        { title: "Thinking, Fast and Slow", author: "Daniel Kahneman", level: "Intermediate", difficulty: "Informative", reason: "How we decide — and how we fool ourselves." },
        { title: "The Man Who Mistook His Wife for a Hat", author: "Oliver Sacks", level: "Beginner", difficulty: "Accessible", reason: "Neurology as human storytelling." },
        { title: "Quiet", author: "Susan Cain", level: "Beginner", difficulty: "Relatable", reason: "The power of introverts in a loud world." },
        { title: "The Body Keeps the Score", author: "Bessel van der Kolk", level: "Advanced", difficulty: "Intense", reason: "Trauma, healing, and the brain-body link." },
        { title: "Influence", author: "Robert Cialdini", level: "Intermediate", difficulty: "Practical", reason: "The psychology of persuasion." },
        { title: "Man's Search for Meaning", author: "Viktor Frankl", level: "Intermediate", difficulty: "Profound", reason: "Purpose under impossible conditions." },
      ],
    },
    {
      secret_id: "scifi-master",
      path_name: "Sci-Fi Master Collection",
      path_icon: "🌌",
      tier: "legendary",
      why_this_path: "From dystopia to distant galaxies — the ideas that imagined our futures.",
      difficulty_progression: "Intermediate to Legendary",
      unlock: { pathsCompleted: 2, legendaryCompleted: 0 },
      unlockLabel: "Complete 2 Reading Paths",
      books: [
        { title: "Dune", author: "Frank Herbert", level: "Advanced", difficulty: "Epic", reason: "Politics, ecology, and prophecy on Arrakis." },
        { title: "Neuromancer", author: "William Gibson", level: "Advanced", difficulty: "Cyberpunk", reason: "The novel that named cyberspace." },
        { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", level: "Intermediate", difficulty: "Philosophical", reason: "Gender, diplomacy, and alien worlds." },
        { title: "Foundation", author: "Isaac Asimov", level: "Intermediate", difficulty: "Classic", reason: "Psychohistory and the fall of empires." },
        { title: "Kindred", author: "Octavia E. Butler", level: "Intermediate", difficulty: "Powerful", reason: "Time travel as reckoning with history." },
        { title: "Hyperion", author: "Dan Simmons", level: "Advanced", difficulty: "Ambitious", reason: "Pilgrimage, myth, and far-future mystery." },
      ],
    },
    {
      secret_id: "changed-history",
      path_name: "Books That Changed History",
      path_icon: "📖",
      tier: "legendary",
      why_this_path: "Texts that shifted nations, minds, and the course of civilization.",
      difficulty_progression: "Advanced",
      unlock: { pathsCompleted: 3 },
      unlockLabel: "Complete 3 Reading Paths",
      books: [
        { title: "The Communist Manifesto", author: "Karl Marx & Friedrich Engels", level: "Intermediate", difficulty: "Foundational", reason: "The pamphlet that reshaped the 20th century." },
        { title: "On the Origin of Species", author: "Charles Darwin", level: "Advanced", difficulty: "Scientific", reason: "Evolution and the transformation of biology." },
        { title: "The Feminine Mystique", author: "Betty Friedan", level: "Intermediate", difficulty: "Revolutionary", reason: "Sparked second-wave feminism." },
        { title: "Silent Spring", author: "Rachel Carson", level: "Intermediate", difficulty: "Urgent", reason: "Launched the modern environmental movement." },
        { title: "The Diary of a Young Girl", author: "Anne Frank", level: "Beginner", difficulty: "Essential", reason: "Humanity preserved against horror." },
        { title: "Uncle Tom's Cabin", author: "Harriet Beecher Stowe", level: "Advanced", difficulty: "Historical", reason: "Literature that intensified abolition." },
      ],
    },
  ],

  FEATURED_JOURNEYS: [
    { path_name: "Dark Academia Journey", rating: 4.9, completions: 1284, genre: "Literary Fiction" },
    { path_name: "Cosy Mystery Trail", rating: 4.8, completions: 956, genre: "Mystery" },
    { path_name: "Epic Fantasy Quest", rating: 4.9, completions: 2103, genre: "Fantasy" },
    { path_name: "Literary Fiction Deep Dive", rating: 4.7, completions: 742, genre: "Literary Fiction" },
  ],

  readUnlocks() {
    try {
      return JSON.parse(localStorage.getItem(this.UNLOCKS_KEY) || "null") || [];
    } catch {
      return [];
    }
  },

  saveUnlocks(ids) {
    localStorage.setItem(this.UNLOCKS_KEY, JSON.stringify(ids));
  },

  readReviews() {
    try {
      return JSON.parse(localStorage.getItem(this.REVIEWS_KEY) || "null") || {};
    } catch {
      return {};
    }
  },

  saveReview(pathId, review) {
    const all = this.readReviews();
    all[pathId] = { ...review, submittedAt: new Date().toISOString() };
    localStorage.setItem(this.REVIEWS_KEY, JSON.stringify(all));
    return all[pathId];
  },

  getReview(pathId) {
    return this.readReviews()[pathId] || null;
  },

  isLegendary(path) {
    const diff = (path.difficulty_progression || path.tier || "").toLowerCase();
    return path.tier === "legendary" || /legendary|advanced to legendary/.test(diff);
  },

  countLegendaryCompleted(paths) {
    return (paths || []).filter(p => p.path_completed && this.isLegendary(p)).length;
  },

  totalBooksThroughPaths(paths) {
    return (paths || [])
      .filter(p => p.path_completed)
      .reduce((sum, p) => sum + (p.books?.length || 0), 0);
  },

  formatMonthYear(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    } catch {
      return iso;
    }
  },

  checkUnlock(secret, stats, paths) {
    const req = secret.unlock || {};
    if (req.pathsCompleted && stats.pathsCompleted < req.pathsCompleted) return false;
    if (req.legendaryCompleted != null) {
      const legendary = this.countLegendaryCompleted(paths);
      if (legendary < req.legendaryCompleted) return false;
    }
    return true;
  },

  getUnlockedSecrets(stats, paths) {
    return this.SECRET_PATHS.filter(s => this.checkUnlock(s, stats, paths));
  },

  getLockedSecrets(stats, paths) {
    return this.SECRET_PATHS.filter(s => !this.checkUnlock(s, stats, paths));
  },

  secretToPath(secret) {
    return {
      id: `secret-${secret.secret_id}`,
      secret_id: secret.secret_id,
      path_name: secret.path_name,
      path_icon: secret.path_icon,
      why_this_path: secret.why_this_path,
      difficulty_progression: secret.difficulty_progression,
      tier: secret.tier,
      is_secret: true,
      books: (secret.books || []).map(book => ({
        ...book,
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10),
        completed: false,
      })),
    };
  },

  discoverSecret(secretId, existingPaths) {
    const secret = this.SECRET_PATHS.find(s => s.secret_id === secretId);
    if (!secret) return null;
    if (existingPaths.some(p => p.secret_id === secretId || p.id === `secret-${secretId}`)) {
      return existingPaths.find(p => p.secret_id === secretId || p.id === `secret-${secretId}`);
    }
    const unlocks = this.readUnlocks();
    if (!unlocks.includes(secretId)) {
      unlocks.push(secretId);
      this.saveUnlocks(unlocks);
    }
    return this.secretToPath(secret);
  },

  passportStats(paths, stats) {
    const C = window.BookMindPathCompletion;
    const agg = C?.computeAggregateStats(paths) || {};
    const completed = (paths || []).filter(p => p.path_completed);
    const totalStarted = (paths || []).filter(p => !p.path_completed).length +
      completed.length;
    const completionPct = totalStarted
      ? Math.round((completed.length / totalStarted) * 100)
      : 0;

    return {
      pathsCompleted: stats.pathsCompleted || completed.length,
      activePaths: agg.activePaths || 0,
      avgCompletionDays: agg.avgCompletionDays || 0,
      totalBooks: this.totalBooksThroughPaths(paths),
      legendaryFinished: this.countLegendaryCompleted(paths),
      completionPct,
      totalXp: stats.totalXp || 0,
    };
  },

  favoriteCompletedPath(completions) {
    if (!completions?.length) return null;
    const rated = completions.filter(c => c.rating >= 4);
    return rated[0] || completions[0];
  },

  latestStamp(completions) {
    return completions?.[0] || null;
  },

  avgRating(pathId) {
    const review = this.getReview(pathId);
    return review?.rating || null;
  },

  highlyRatedUserPaths(paths) {
    return (paths || [])
      .filter(p => p.path_completed)
      .map(p => ({ path: p, review: this.getReview(p.id) }))
      .filter(({ review }) => review && review.rating >= 4)
      .sort((a, b) => (b.review.rating || 0) - (a.review.rating || 0));
  },
};
