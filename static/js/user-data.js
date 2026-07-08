/** Sync user settings and reader profile with Supabase via API. */
const BookMindUserData = {
  _hydratePromise: null,
  _hydratedAt: 0,
  _hydrateTtlMs: 5 * 60 * 1000,

  async loadSettings() {
    if (!window.BookMindAuth?.isLoggedIn()) return null;

    let local = {};
    try {
      local = JSON.parse(localStorage.getItem("bookmind_settings") || "{}");
    } catch {
      local = {};
    }

    const localTheme = localStorage.getItem("bookmind_theme");
    const localSize = localStorage.getItem("bookmind_reading_size");

    const data = await BookMindAPI.get("/api/user/settings");
    const server = data.settings || {};
    const merged = {
      ...local,
      ...server,
      reading: { ...(local.reading || {}), ...(server.reading || {}) },
      appearance: {
        ...(local.appearance || {}),
        ...(server.appearance || {}),
        ...(localTheme ? { theme: localTheme } : {}),
        ...(localSize ? { readingFontSize: localSize } : {}),
      },
      notifications: { ...(local.notifications || {}), ...(server.notifications || {}) },
      privacy: { ...(local.privacy || {}), ...(server.privacy || {}) },
    };

    if (merged.appearance?.theme) {
      localStorage.setItem("bookmind_theme", merged.appearance.theme === "dark" ? "dark" : "light");
    }
    if (merged.appearance?.readingFontSize) {
      localStorage.setItem("bookmind_reading_size", merged.appearance.readingFontSize);
    }

    localStorage.setItem("bookmind_settings", JSON.stringify(merged));
    return merged;
  },

  async saveSettings(settings) {
    const localTheme = localStorage.getItem("bookmind_theme");
    const localSize = localStorage.getItem("bookmind_reading_size");
    const merged = {
      ...settings,
      appearance: {
        ...(settings.appearance || {}),
        ...(localTheme ? { theme: localTheme } : {}),
        ...(localSize ? { readingFontSize: localSize } : {}),
      },
    };

    if (!window.BookMindAuth?.isLoggedIn()) {
      localStorage.setItem("bookmind_settings", JSON.stringify(merged));
      return merged;
    }
    const data = await BookMindAPI.put("/api/user/settings", { settings: merged });
    localStorage.setItem("bookmind_settings", JSON.stringify(data.settings || merged));
    return data.settings || merged;
  },

  async loadReaderProfile() {
    if (!window.BookMindAuth?.isLoggedIn()) {
      const raw = localStorage.getItem("readerProfile");
      return raw ? JSON.parse(raw) : null;
    }
    const data = await BookMindAPI.get("/api/user/reader-profile");
    if (data.profile) {
      const row = data.profile;
      let profileData = row.profile_data || {};
      if (!profileData.reader_type && !profileData.recommendations && row.reader_type) {
        profileData = row;
      }
      localStorage.setItem("readerProfile", JSON.stringify(profileData));

      const quizState = profileData.quiz_state;
      if (quizState) {
        localStorage.setItem("reader_quiz_answers", JSON.stringify(quizState.answers || {}));
        localStorage.setItem("reader_quiz_step", String(quizState.current_step ?? 0));
        localStorage.setItem("reader_profile_completion", String(quizState.completion ?? 0));
      }

      return profileData;
    }
    return null;
  },

  async loadQuizProgress() {
    if (!window.BookMindAuth?.isLoggedIn()) return null;
    const data = await BookMindAPI.get("/api/user/reader-profile");
    const quizState = data.profile?.profile_data?.quiz_state;
    if (!quizState) return null;

    localStorage.setItem("reader_quiz_answers", JSON.stringify(quizState.answers || {}));
    localStorage.setItem("reader_quiz_step", String(quizState.current_step ?? 0));
    localStorage.setItem("reader_profile_completion", String(quizState.completion ?? 0));
    return quizState;
  },

  async saveQuizProgress({ answers, currentStep, completion }) {
    localStorage.setItem("reader_quiz_answers", JSON.stringify(answers));
    localStorage.setItem("reader_quiz_step", String(currentStep));
    localStorage.setItem("reader_profile_completion", String(completion));

    if (!window.BookMindAuth?.isLoggedIn()) return { answers, currentStep, completion };

    const existing = JSON.parse(localStorage.getItem("readerProfile") || "null") || {};
    const profileData = {
      ...existing,
      quiz_state: {
        answers,
        current_step: currentStep,
        completion,
        updated_at: new Date().toISOString(),
      },
    };

    await BookMindAPI.put("/api/user/reader-profile", {
      quiz_answers: typeof answers === "object"
        ? Object.entries(answers)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
            .join("\n")
        : "",
      books_read: existing.books_read || "",
      reading_level: answers.emotionalIntensity || answers.pacing || existing.confirmed_reading_level || "",
      profile_data: profileData,
    });

    localStorage.setItem("readerProfile", JSON.stringify(profileData));
    this._hydratedAt = 0;
    return { answers, currentStep, completion };
  },

  async saveReaderProfile(profile) {
    localStorage.setItem("readerProfile", JSON.stringify(profile));
    if (!window.BookMindAuth?.isLoggedIn()) return profile;
    const data = await BookMindAPI.put("/api/user/reader-profile", {
      quiz_answers: profile.quiz_answers || profile.quizAnswers || "",
      books_read: profile.books_read || profile.booksRead || "",
      reading_level: profile.reading_level || profile.readingLevel || "",
      profile_data: profile,
    });
    this._hydratedAt = 0;
    return data.profile || profile;
  },

  async hydrate({ force = false } = {}) {
    if (!window.BookMindAuth?.isLoggedIn()) return;

    const freshEnough = !force && this._hydratedAt && Date.now() - this._hydratedAt < this._hydrateTtlMs;
    if (freshEnough) return;

    if (this._hydratePromise) return this._hydratePromise;

    this._hydratePromise = Promise.all([this.loadSettings(), this.loadReaderProfile()])
      .then(() => {
        this._hydratedAt = Date.now();
      })
      .catch(() => {
        /* offline or unverified */
      })
      .finally(() => {
        this._hydratePromise = null;
      });

    return this._hydratePromise;
  },
};

window.BookMindUserData = BookMindUserData;
