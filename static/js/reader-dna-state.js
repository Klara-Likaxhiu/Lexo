/** Shared Reader DNA completion detection for Home and quiz pages. */
window.LexoReaderDna = {
  REQUIRED_ANSWER_KEYS: [
    "favoriteGenres",
    "preferredMood",
    "pacing",
    "bookLength",
    "writingStyle",
    "characterTypes",
    "plotStyle",
    "emotionalIntensity",
    "worldbuilding",
    "endingPreference",
    "readingGoals",
    "dislikedTropes"
  ],

  safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  isAnswerFilled(key, answers) {
    if (key === "favoriteGenres") {
      const genres = [...(answers.favoriteGenres || []), ...(answers.customGenres || [])];
      return genres.length > 0;
    }

    const value = answers[key];
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  },

  isComplete() {
    const completion = Number(localStorage.getItem("reader_profile_completion")) || 0;
    if (completion >= 100) return true;

    const profile = this.safeParse(localStorage.getItem("readerProfile"));
    if (profile?.quiz_state?.completion >= 100) return true;
    if (profile?.quiz_state?.completed_at) return true;

    const answers = this.safeParse(localStorage.getItem("reader_quiz_answers"));
    if (answers) {
      return this.REQUIRED_ANSWER_KEYS.every(key => this.isAnswerFilled(key, answers));
    }

    return false;
  },

  hideHomeProgressUi() {
    document.documentElement.classList.add("reader-dna-complete");

    ["dnaProgressCard", "continueDiscoveryTop", "continueDiscoveryMain"].forEach(id => {
      document.getElementById(id)?.remove();
    });
  },

  applyHomeVisibility() {
    if (this.isComplete()) {
      this.hideHomeProgressUi();
      return true;
    }

    document.documentElement.classList.remove("reader-dna-complete");
    return false;
  }
};
