/** BookMindAI Settings page controller. */
const BookMindSettings = {
  STORAGE_KEY: "bookmind_settings",
  get GENRES() {
    return window.BookMindGenres?.ALL || [
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
    try {
      const stored = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "{}");
      return {
        ...defaults,
        ...stored,
        reading: { ...defaults.reading, ...(stored.reading || {}) },
        appearance: { ...defaults.appearance, ...(stored.appearance || {}) },
        notifications: { ...defaults.notifications, ...(stored.notifications || {}) },
        privacy: { ...defaults.privacy, ...(stored.privacy || {}) }
      };
    } catch {
      return defaults;
    }
  },

  save(settings) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
  },

  applyAppearance(settings) {
    const appearance = settings.appearance || {};
    document.documentElement.classList.toggle("theme-dark", appearance.theme === "dark");
    if (appearance.readingFontSize) {
      document.documentElement.dataset.readingFont = appearance.readingFontSize;
    }
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
    if (window.BookMindAuth) {
      await BookMindAuth.whenReady();
    }

    const token = window.BookMindAPI
      ? await BookMindAPI.ensureAuth({ redirect: true })
      : null;
    if (!token) return;

    this.settings = this.load();
    this.authUser = window.BookMindAuth ? BookMindAuth.getCurrentUser() : null;
    this.readerProfile = JSON.parse(localStorage.getItem("readerProfile") || "null");
    this.userProfile = JSON.parse(localStorage.getItem("bookmind_user_profile") || "{}");

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
      if (!window.BookMindAPI?.getMe) {
        throw new Error("BookMindAPI is not loaded.");
      }
      user = await BookMindAPI.getMe({ redirect: true });
    } catch (error) {
      user = window.BookMindAuth?.getCurrentUser() || null;
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
        localStorage.setItem("bookmind_user_profile", JSON.stringify(this.userProfile));
        document.getElementById("settingsAvatar").innerHTML =
          `<img src="${event.target.result}" alt="Profile picture">`;
        this.showToast("Profile picture updated.");
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("settingsLogoutBtn")?.addEventListener("click", () => {
      if (window.BookMindAuth) BookMindAuth.logout();
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

    const isDark = this.settings.appearance?.theme === "dark";
    if (themeToggle) themeToggle.checked = isDark;
    if (fontSelect) fontSelect.value = this.settings.appearance?.readingFontSize || "medium";

    themeToggle?.addEventListener("change", () => {
      this.settings.appearance = this.settings.appearance || {};
      this.settings.appearance.theme = themeToggle.checked ? "dark" : "light";
      this.save(this.settings);
      this.applyAppearance(this.settings);
      this.showToast(`${themeToggle.checked ? "Dark" : "Light"} mode enabled.`);
    });

    fontSelect?.addEventListener("change", () => {
      this.settings.appearance = this.settings.appearance || {};
      this.settings.appearance.readingFontSize = fontSelect.value;
      this.save(this.settings);
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
        library: JSON.parse(localStorage.getItem("bookmind_library") || "{}"),
        reader_profile: JSON.parse(localStorage.getItem("readerProfile") || "null"),
        user_profile: JSON.parse(localStorage.getItem("bookmind_user_profile") || "{}"),
        reading_progress: JSON.parse(localStorage.getItem("reading_progress") || "{}"),
        reviews: JSON.parse(localStorage.getItem("book_reviews") || "[]"),
        settings: this.settings
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bookmind-reading-data-${Date.now()}.json`;
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
        await BookMindAuth.changePassword(current, next);
        this.closeModal("passwordModal");
        this.showToast("Password updated. Signing you out…");
        setTimeout(() => BookMindAuth.logout(), 1200);
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
        await BookMindAuth.deleteAccount(password, confirmation);
        BookMindAuth.clearSession();
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

document.addEventListener("DOMContentLoaded", () => BookMindSettings.init());
