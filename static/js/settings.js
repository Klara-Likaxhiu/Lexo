/** Lexo Settings page controller. */
const LexoSettings = {
  STORAGE_KEY: "lexo_settings",
  THEME_KEY: "lexo_theme",
  READING_SIZE_KEY: "lexo_reading_size",
  get GENRES() {
    return window.LexoGenres?.ALL || [
      "Fantasy", "Romance", "Mystery", "Thriller", "Horror", "Sci-Fi",
      "Historical Fiction", "Literary Fiction", "Contemporary Fiction", "Classics",
      "Non-fiction", "Memoir", "Biography", "Self-help", "Poetry", "Young Adult"
    ];
  },

  defaults() {
    return {
      reading: {
        favoriteAuthors: "",
        booksPerYear: 12,
        aiRecommendations: "balanced"
      },
      appearance: {
        theme: "light",
        readingFontSize: "medium"
      },
      notifications: {
        readingReminders: false,
        recommendationAlerts: false,
        achievementAlerts: false
      },
      privacy: {
        profileVisibility: "public"
      }
    };
  },

  load() {
    const defaults = this.defaults();
    const prefs = this.readAppearancePrefs();
    try {
      const stored = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "{}");
      return {
        ...defaults,
        ...stored,
        reading: { ...defaults.reading, ...(stored.reading || {}) },
        appearance: { ...defaults.appearance, ...(stored.appearance || {}), ...prefs },
        notifications: { ...defaults.notifications, ...(stored.notifications || {}) },
        privacy: { ...defaults.privacy, ...(stored.privacy || {}) }
      };
    } catch {
      return { ...defaults, appearance: { ...defaults.appearance, ...prefs } };
    }
  },

  readAppearancePrefs() {
    let theme = localStorage.getItem(this.THEME_KEY);
    let readingFontSize = localStorage.getItem(this.READING_SIZE_KEY);

    if (!theme || !readingFontSize) {
      try {
        const stored = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "{}");
        const appearance = stored.appearance || {};
        if (!theme && appearance.theme) theme = appearance.theme;
        if (!readingFontSize && appearance.readingFontSize) {
          readingFontSize = appearance.readingFontSize;
        }
      } catch {
        /* ignore */
      }
    }

    const prefs = {
      theme: theme === "dark" ? "dark" : "light",
      readingFontSize: readingFontSize || "medium",
    };

    if (!localStorage.getItem(this.THEME_KEY)) {
      localStorage.setItem(this.THEME_KEY, prefs.theme);
    }
    if (!localStorage.getItem(this.READING_SIZE_KEY)) {
      localStorage.setItem(this.READING_SIZE_KEY, prefs.readingFontSize);
    }

    return prefs;
  },

  saveAppearancePrefs(appearance) {
    const theme = appearance.theme === "dark" ? "dark" : "light";
    const readingFontSize = appearance.readingFontSize || "medium";

    localStorage.setItem(this.THEME_KEY, theme);
    localStorage.setItem(this.READING_SIZE_KEY, readingFontSize);

    const settings = this.load();
    settings.appearance = { ...settings.appearance, theme, readingFontSize };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    return settings;
  },

  save(settings) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
  },

  applyAppearance(settings) {
    const appearance = settings?.appearance || settings || {};
    const theme = appearance.theme === "dark" ? "dark" : "light";
    const readingFontSize = appearance.readingFontSize || "medium";
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    document.documentElement.dataset.readingFont = readingFontSize;
  },

  showToast(message, type = "success") {
    const toast = document.getElementById("settingsToast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `settings-toast settings-toast-${type} show`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 3200);
  },

  showComingSoon(label) {
    this.showToast(`${label} is coming soon.`, "info");
  },

  async init() {
    if (window.LexoAuth) {
      await window.LexoAuth.whenReady();
    }

    const token = window.LexoAPI
      ? await LexoAPI.ensureAuth({ redirect: true })
      : null;
    if (!token) return;

    this.settings = this.load();
    this.applyAppearance(this.settings);
    this.authUser = window.LexoAuth ? window.LexoAuth.getCurrentUser() : null;
    this.readerProfile = JSON.parse(localStorage.getItem("readerProfile") || "null");
    this.userProfile = JSON.parse(localStorage.getItem("lexo_user_profile") || "{}");

    await this.loadAccount();
    this.renderGenres();
    this.bindNavigation();
    this.bindAccount();
    this.bindReading();
    this.bindAppearance();
    this.bindNotifications();
    this.bindPrivacy();
    this.bindAbout();
    this.bindModals();
  },

  async loadAccount() {
    const usernameEl = document.getElementById("settingsUsername");
    const emailEl = document.getElementById("settingsEmail");
    const avatarEl = document.getElementById("settingsAvatar");

    let user = null;
    try {
      if (!window.LexoAPI?.getMe) {
        throw new Error("LexoAPI is not loaded.");
      }
      user = await LexoAPI.getMe({ redirect: true });
    } catch (error) {
      user = window.LexoAuth?.getCurrentUser() || null;
    }

    if (usernameEl) usernameEl.textContent = user?.username || "—";
    if (emailEl) emailEl.textContent = user?.email || "—";

    if (avatarEl) {
      if (this.userProfile.profilePic) {
        avatarEl.innerHTML = `<img src="${this.userProfile.profilePic}" alt="Profile picture">`;
      } else {
        avatarEl.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      }
    }

    const isOAuth =
      user?.auth_provider && user.auth_provider !== "local";
    const changeBtn = document.getElementById("settingsChangePasswordBtn");
    if (changeBtn) {
      changeBtn.disabled = Boolean(isOAuth);
      changeBtn.title = isOAuth
        ? "Password is managed by your social sign-in provider."
        : "";
    }
  },

  bindNavigation() {
    const navLinks = document.querySelectorAll(".settings-nav-link");

    navLinks.forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        const id = link.dataset.section;
        navLinks.forEach(item => item.classList.toggle("active", item === link));
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  },

  bindAccount() {
    document.getElementById("settingsAvatarInput")?.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = event => {
        this.userProfile.profilePic = event.target.result;
        localStorage.setItem("lexo_user_profile", JSON.stringify(this.userProfile));
        document.getElementById("settingsAvatar").innerHTML =
          `<img src="${event.target.result}" alt="Profile picture">`;
        this.showToast("Profile picture updated.");
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("settingsLogoutBtn")?.addEventListener("click", () => {
      if (window.LexoAuth) window.LexoAuth.logout();
    });

    document.getElementById("settingsChangePasswordBtn")?.addEventListener("click", () => {
      this.openModal("passwordModal");
    });

    document.getElementById("settingsDeleteAccountBtn")?.addEventListener("click", () => {
      this.openModal("deleteModal");
    });
  },

  renderGenres() {
    const container = document.getElementById("settingsGenreTags");
    if (!container) return;

    const selected = new Set(this.readerProfile?.favorite_genres || []);
    container.innerHTML = "";

    this.GENRES.forEach(genre => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `settings-tag${selected.has(genre) ? " is-selected" : ""}`;
      btn.textContent = genre;
      btn.addEventListener("click", () => {
        btn.classList.toggle("is-selected");
      });
      container.appendChild(btn);
    });
  },

  bindReading() {
    const authorsInput = document.getElementById("settingsFavoriteAuthors");
    const goalInput = document.getElementById("settingsReadingGoal");
    const aiSelect = document.getElementById("settingsAiRecommendations");

    if (authorsInput) authorsInput.value = this.settings.reading?.favoriteAuthors || "";
    if (goalInput) goalInput.value = this.settings.reading?.booksPerYear ?? 12;
    if (aiSelect) aiSelect.value = this.settings.reading?.aiRecommendations || "balanced";

    document.getElementById("settingsSaveReadingBtn")?.addEventListener("click", () => {
      const selectedGenres = [...document.querySelectorAll("#settingsGenreTags .settings-tag.is-selected")]
        .map(el => el.textContent.trim());

      const profile = this.readerProfile || {};
      profile.favorite_genres = selectedGenres;
      localStorage.setItem("readerProfile", JSON.stringify(profile));
      this.readerProfile = profile;

      this.settings.reading = {
        favoriteAuthors: authorsInput?.value.trim() || "",
        booksPerYear: Math.max(1, Number(goalInput?.value) || 12),
        aiRecommendations: aiSelect?.value || "balanced"
      };
      this.save(this.settings);
      this.showToast("Reading preferences saved.");
    });
  },

  bindAppearance() {
    const themeToggle = document.getElementById("settingsThemeToggle");
    const fontSelect = document.getElementById("settingsFontSize");
    const prefs = this.readAppearancePrefs();

    if (themeToggle) themeToggle.checked = prefs.theme === "dark";
    if (fontSelect) fontSelect.value = prefs.readingFontSize;

    themeToggle?.addEventListener("change", () => {
      const theme = themeToggle.checked ? "dark" : "light";
      this.settings = this.saveAppearancePrefs({
        ...this.settings.appearance,
        theme,
        readingFontSize: fontSelect?.value || prefs.readingFontSize,
      });
      this.applyAppearance(this.settings);
      this.showToast(`${themeToggle.checked ? "Dark" : "Light"} mode enabled.`);
    });

    fontSelect?.addEventListener("change", () => {
      this.settings = this.saveAppearancePrefs({
        ...this.settings.appearance,
        theme: themeToggle?.checked ? "dark" : "light",
        readingFontSize: fontSelect.value,
      });
      this.applyAppearance(this.settings);
      this.showToast("Reading font size updated.");
    });
  },

  bindNotifications() {
    const map = {
      settingsReadingReminders: "readingReminders",
      settingsRecommendationAlerts: "recommendationAlerts",
      settingsAchievementAlerts: "achievementAlerts"
    };

    Object.entries(map).forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.checked = Boolean(this.settings.notifications?.[key]);
      input.addEventListener("change", () => {
        this.settings.notifications = this.settings.notifications || {};
        this.settings.notifications[key] = input.checked;
        this.save(this.settings);
        this.showToast("Preference saved. Notifications are coming soon.", "info");
      });
    });
  },

  bindPrivacy() {
    const visibility = document.getElementById("settingsProfileVisibility");
    if (visibility) {
      visibility.value = this.settings.privacy?.profileVisibility || "public";
      visibility.addEventListener("change", () => {
        this.settings.privacy = this.settings.privacy || {};
        this.settings.privacy.profileVisibility = visibility.value;
        this.save(this.settings);
        this.showToast("Preference saved. Public profiles are coming soon.", "info");
      });
    }

    document.getElementById("settingsExportBtn")?.addEventListener("click", () => {
      const payload = {
        exported_at: new Date().toISOString(),
        library: JSON.parse(localStorage.getItem("lexo_library") || "{}"),
        reader_profile: JSON.parse(localStorage.getItem("readerProfile") || "null"),
        user_profile: JSON.parse(localStorage.getItem("lexo_user_profile") || "{}"),
        reading_progress: JSON.parse(localStorage.getItem("reading_progress") || "{}"),
        reviews: JSON.parse(localStorage.getItem("book_reviews") || "[]"),
        settings: this.settings
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lexo-reading-data-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.showToast("Reading data exported.");
    });
  },

  async bindAbout() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      const versionEl = document.getElementById("settingsAppVersion");
      if (versionEl && data.version) versionEl.textContent = `v${data.version}`;
    } catch {
      /* keep default */
    }

    document.querySelectorAll("[data-coming-soon]").forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        this.showComingSoon(btn.dataset.comingSoonLabel || btn.textContent.trim());
      });
    });

    document.getElementById("settingsFeedbackBtn")?.addEventListener("click", e => {
      e.preventDefault();
      this.openModal("feedbackModal");
    });

    document.getElementById("feedbackForm")?.addEventListener("submit", e => {
      e.preventDefault();
      this.closeModal("feedbackModal");
      this.showToast("Thanks for your feedback! Support inbox is coming soon.", "info");
    });
  },

  bindModals() {
    document.querySelectorAll("[data-close-modal]").forEach(btn => {
      btn.addEventListener("click", () => this.closeModal(btn.dataset.closeModal));
    });

    document.querySelectorAll(".settings-modal-backdrop").forEach(backdrop => {
      backdrop.addEventListener("click", () => {
        this.closeModal(backdrop.dataset.closeModal);
      });
    });

    document.getElementById("passwordForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const current = document.getElementById("currentPassword").value;
      const next = document.getElementById("newPassword").value;
      const confirm = document.getElementById("confirmNewPassword").value;

      if (next !== confirm) {
        this.showToast("New passwords do not match.", "error");
        return;
      }

      try {
        await window.LexoAuth.changePassword(current, next);
        this.closeModal("passwordModal");
        this.showToast("Password updated. Signing you out…");
        setTimeout(() => window.LexoAuth.logout(), 1200);
      } catch (error) {
        this.showToast(error.message || "Could not change password.", "error");
      }
    });

    document.getElementById("deleteForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const confirmation = document.getElementById("deleteConfirmation").value.trim();
      const password = document.getElementById("deletePassword").value;

      if (confirmation !== "DELETE") {
        this.showToast('Type DELETE to confirm.', "error");
        return;
      }

      try {
        await window.LexoAuth.deleteAccount(password, confirmation);
        window.LexoAuth.clearSession();
        window.location.href = "/login.html";
      } catch (error) {
        this.showToast(error.message || "Could not delete account.", "error");
      }
    });
  },

  openModal(id) {
    document.getElementById(id)?.classList.add("is-open");
    document.body.classList.add("settings-modal-open");
  },

  closeModal(id) {
    document.getElementById(id)?.classList.remove("is-open");
    if (!document.querySelector(".settings-modal.is-open")) {
      document.body.classList.remove("settings-modal-open");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => LexoSettings.init());
