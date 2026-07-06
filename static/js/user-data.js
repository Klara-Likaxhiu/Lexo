/** Sync user settings and reader profile with Supabase via API. */
const BookMindUserData = {
  async api(path, body, method = "GET") {
    const headers = { "Content-Type": "application/json", ...BookMindAuth.getAuthHeaders() };
    const response = await fetch(path, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Request failed.");
    }
    return data;
  },

  async loadSettings() {
    if (!BookMindAuth.isLoggedIn()) return null;
    const data = await this.api("/api/user/settings");
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
    const data = await this.api("/api/user/settings", { settings }, "PUT");
    localStorage.setItem("bookmind_settings", JSON.stringify(data.settings || settings));
    return data.settings || settings;
  },

  async loadReaderProfile() {
    if (!BookMindAuth.isLoggedIn()) {
      const raw = localStorage.getItem("readerProfile");
      return raw ? JSON.parse(raw) : null;
    }
    const data = await this.api("/api/user/reader-profile");
    if (data.profile) {
      localStorage.setItem("readerProfile", JSON.stringify(data.profile));
      return data.profile;
    }
    return null;
  },

  async saveReaderProfile(profile) {
    localStorage.setItem("readerProfile", JSON.stringify(profile));
    if (!BookMindAuth.isLoggedIn()) return profile;
    const data = await this.api(
      "/api/user/reader-profile",
      {
        quiz_answers: profile.quiz_answers || profile.quizAnswers || "",
        books_read: profile.books_read || profile.booksRead || "",
        reading_level: profile.reading_level || profile.readingLevel || "",
        profile_data: profile
      },
      "PUT"
    );
    return data.profile || profile;
  },

  async hydrate() {
    if (!BookMindAuth.isLoggedIn()) return;
    try {
      await Promise.all([this.loadSettings(), this.loadReaderProfile()]);
    } catch {
      /* offline or unverified */
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.BookMindAuth?.isLoggedIn()) {
    BookMindUserData.hydrate();
  }
});
