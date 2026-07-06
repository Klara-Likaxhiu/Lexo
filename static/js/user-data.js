/** Sync user settings and reader profile with Supabase via API. */
const BookMindUserData = {
  async loadSettings() {
    if (!BookMindAuth.isLoggedIn()) return null;
    const data = await BookMindAPI.get("/api/user/settings");
    if (data.settings) {
      localStorage.setItem("bookmind_settings", JSON.stringify(data.settings));
    }
    return data.settings || null;
  },

  async saveSettings(settings) {
    if (!BookMindAuth.isLoggedIn()) {
      localStorage.setItem("bookmind_settings", JSON.stringify(settings));
      return settings;
    }
    const data = await BookMindAPI.put("/api/user/settings", { settings });
    localStorage.setItem("bookmind_settings", JSON.stringify(data.settings || settings));
    return data.settings || settings;
  },

  async loadReaderProfile() {
    if (!BookMindAuth.isLoggedIn()) {
      const raw = localStorage.getItem("readerProfile");
      return raw ? JSON.parse(raw) : null;
    }
    const data = await BookMindAPI.get("/api/user/reader-profile");
    if (data.profile) {
      localStorage.setItem("readerProfile", JSON.stringify(data.profile));
      return data.profile;
    }
    return null;
  },

  async saveReaderProfile(profile) {
    localStorage.setItem("readerProfile", JSON.stringify(profile));
    if (!BookMindAuth.isLoggedIn()) return profile;
    const data = await BookMindAPI.put("/api/user/reader-profile", {
      quiz_answers: profile.quiz_answers || profile.quizAnswers || "",
      books_read: profile.books_read || profile.booksRead || "",
      reading_level: profile.reading_level || profile.readingLevel || "",
      profile_data: profile,
    });
    return data.profile || profile;
  },

  async hydrate() {
    if (!BookMindAuth.isLoggedIn()) return;
    try {
      await Promise.all([this.loadSettings(), this.loadReaderProfile()]);
    } catch {
      /* offline or unverified */
    }
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  if (window.BookMindAuth?.whenReady) {
    await BookMindAuth.whenReady();
  }
  if (window.BookMindAuth?.isLoggedIn()) {
    BookMindUserData.hydrate();
  }
});
