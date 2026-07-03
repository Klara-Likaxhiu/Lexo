(function () {
  try {
    const settings = JSON.parse(localStorage.getItem("bookmind_settings") || "{}");
    const appearance = settings.appearance || {};
    if (appearance.theme === "dark") document.documentElement.classList.add("theme-dark");
    if (appearance.readingFontSize) {
      document.documentElement.dataset.readingFont = appearance.readingFontSize;
    }
  } catch (_) {
    /* ignore */
  }
})();

/**
 * BookMindAI authentication client.
 * JWT access tokens + server-side refresh tokens, email verification, OAuth.
 */
const BookMindAuth = {
  ACCESS_KEY: "bookmind_access_token",
  REFRESH_KEY: "bookmind_refresh_token",
  USER_KEY: "bookmind_auth_user",
  REMEMBER_KEY: "bookmind_remember_me",

  PROTECTED_PAGES: new Set([
    "home.html",
    "discovery.html",
    "library.html",
    "book-details.html",
    "profile.html",
    "settings.html",
    "reader-journey.html",
    "reading-paths.html",
    "ai-companion.html",
    "community.html",
    "challenges.html",
    "want-to-read.html",
    "reader-quiz.html"
  ]),

  PUBLIC_AUTH_PAGES: new Set([
    "login.html",
    "signup.html",
    "forgot-password.html",
    "reset-password.html",
    "verify-email.html",
    "verify-email-pending.html"
  ]),

  EMAIL_FEATURE_PAGES: new Set([
    "forgot-password.html",
    "reset-password.html",
    "verify-email.html",
    "verify-email-pending.html"
  ]),

  storage(remember) {
    return remember ? localStorage : sessionStorage;
  },

  isRemembered() {
    return localStorage.getItem(this.REMEMBER_KEY) === "true";
  },

  getActiveStorage() {
    return this.isRemembered() ? localStorage : sessionStorage;
  },

  saveSession({ access_token, refresh_token, remember_me, user }) {
    if (!access_token || !refresh_token) return;
    const remember = Boolean(remember_me);
    localStorage.setItem(this.REMEMBER_KEY, remember ? "true" : "false");

    const primary = this.storage(remember);
    const secondary = remember ? sessionStorage : localStorage;

    primary.setItem(this.ACCESS_KEY, access_token);
    primary.setItem(this.REFRESH_KEY, refresh_token);
    primary.setItem(this.USER_KEY, JSON.stringify(user));

    secondary.removeItem(this.ACCESS_KEY);
    secondary.removeItem(this.REFRESH_KEY);
    secondary.removeItem(this.USER_KEY);

    if (user && user.username) {
      localStorage.setItem("bookmind_user_name", user.username);
    }
  },

  clearSession() {
    [localStorage, sessionStorage].forEach(store => {
      store.removeItem(this.ACCESS_KEY);
      store.removeItem(this.REFRESH_KEY);
      store.removeItem(this.USER_KEY);
    });
    localStorage.removeItem(this.REMEMBER_KEY);
  },

  getAccessToken() {
    return (
      this.getActiveStorage().getItem(this.ACCESS_KEY) ||
      sessionStorage.getItem(this.ACCESS_KEY) ||
      localStorage.getItem(this.ACCESS_KEY)
    );
  },

  getRefreshToken() {
    return (
      this.getActiveStorage().getItem(this.REFRESH_KEY) ||
      sessionStorage.getItem(this.REFRESH_KEY) ||
      localStorage.getItem(this.REFRESH_KEY)
    );
  },

  getUser() {
    const raw =
      this.getActiveStorage().getItem(this.USER_KEY) ||
      sessionStorage.getItem(this.USER_KEY) ||
      localStorage.getItem(this.USER_KEY);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  isEmailVerified(user) {
    if (!user) return false;
    return Boolean(user.email_verified);
  },

  getAuthHeaders() {
    const token = this.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  isLoggedIn() {
    return Boolean(this.getAccessToken());
  },

  async api(path, body, method = "POST") {
    const response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeaders()
      },
      body: body == null ? undefined : JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.detail || "Request failed.";
      throw new Error(typeof message === "string" ? message : JSON.stringify(message));
    }
    return data;
  },

  async getConfig() {
    const response = await fetch("/api/auth/config");
    return response.json();
  },

  async signup(username, email, password) {
    const data = await this.api("/api/auth/signup", { username, email, password });
    if (data.access_token) {
      this.saveSession(data);
    }
    return data;
  },

  async login(login, password, rememberMe) {
    const data = await this.api("/api/auth/login", {
      login,
      password,
      remember_me: rememberMe
    });
    if (!data.verification_required) {
      this.saveSession(data);
    }
    return data;
  },

  async verifyEmail(token, type = "signup") {
    const data = await this.api("/api/auth/verify-email", { token, type });
    this.saveSession(data);
    return data;
  },

  async resendVerification(email) {
    return this.api("/api/auth/resend-verification", { email });
  },

  async checkVerificationStatus(email) {
    return this.api("/api/auth/verification-status", { email });
  },

  async getDevEmailPreview(email) {
    const response = await fetch(
      `/api/auth/dev/email-preview?email=${encodeURIComponent(email)}`
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "No preview available.");
    }
    return data;
  },

  async forgotPassword(email) {
    return this.api("/api/auth/forgot-password", { email });
  },

  async resetPassword(token, password, type = "recovery") {
    return this.api("/api/auth/reset-password", { token, password, type });
  },

  async changePassword(currentPassword, newPassword) {
    return this.api("/api/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword
    });
  },

  async deleteAccount(password, confirmation = "DELETE") {
    return this.api(
      "/api/auth/account",
      { password: password || null, confirmation },
      "DELETE"
    );
  },

  async oauthSignIn(provider, idToken, rememberMe) {
    const data = await this.api(`/api/auth/${provider}`, {
      id_token: idToken,
      remember_me: rememberMe
    });
    this.saveSession(data);
    return data;
  },

  loadGoogleScript() {
    if (document.getElementById("google-gsi")) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "google-gsi";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  loadAppleScript() {
    if (document.getElementById("apple-auth-js")) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "apple-auth-js";
      script.src = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  rememberMeChecked(selector) {
    const el = document.querySelector(selector);
    return el ? el.checked : true;
  },

  async signInWithGoogle(clientId, rememberMeSelector, onSuccess) {
    await this.loadGoogleScript();
    const rememberMe = this.rememberMeChecked(rememberMeSelector);

    return new Promise((resolve, reject) => {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: async response => {
          try {
            const data = await this.oauthSignIn("google", response.credential, rememberMe);
            if (onSuccess) onSuccess(data);
            resolve(data);
          } catch (error) {
            reject(error);
          }
        }
      });
      google.accounts.id.prompt(notification => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          const temp = document.createElement("div");
          temp.style.display = "none";
          document.body.appendChild(temp);
          google.accounts.id.renderButton(temp, { theme: "outline", size: "large" });
          temp.querySelector("div[role=button]")?.click();
          setTimeout(() => temp.remove(), 1000);
        }
      });
    });
  },

  async signInWithApple(clientId, rememberMeSelector, onSuccess) {
    await this.loadAppleScript();
    const rememberMe = this.rememberMeChecked(rememberMeSelector);

    AppleID.auth.init({
      clientId,
      scope: "name email",
      redirectURI: window.location.origin,
      usePopup: true
    });

    try {
      const response = await AppleID.auth.signIn();
      const idToken = response.authorization.id_token;
      const data = await this.oauthSignIn("apple", idToken, rememberMe);
      if (onSuccess) onSuccess(data);
      return data;
    } catch (error) {
      if (error && error.error === "popup_closed_by_user") return;
      throw error;
    }
  },

  async refreshSession() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const data = await this.api("/api/auth/refresh", { refresh_token: refreshToken });
      const remember = this.isRemembered();
      const store = this.storage(remember);
      store.setItem(this.ACCESS_KEY, data.access_token);
      if (data.user) {
        store.setItem(this.USER_KEY, JSON.stringify(data.user));
        localStorage.setItem("bookmind_user_name", data.user.username);
      }
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  },

  async verifySession() {
    const token = this.getAccessToken();
    if (!token) return false;

    try {
      const response = await fetch("/api/auth/me", {
        headers: this.getAuthHeaders()
      });
      if (response.status === 403) {
        const config = await this.getConfig();
        if (config.email_verification_required && config.email_sending_enabled) {
          const user = this.getUser();
          const email = user?.email ? `?email=${encodeURIComponent(user.email)}` : "";
          window.location.replace(`verify-email-pending.html${email}`);
        }
        return false;
      }
      if (response.ok) {
        const data = await response.json();
        const store = this.getActiveStorage();
        store.setItem(this.USER_KEY, JSON.stringify(data.user));
        localStorage.setItem("bookmind_user_name", data.user.username);

        const config = await this.getConfig();
        if (
          config.email_verification_required &&
          config.email_sending_enabled &&
          !data.user.email_verified
        ) {
          const email = data.user.email ? `?email=${encodeURIComponent(data.user.email)}` : "";
          window.location.replace(`verify-email-pending.html${email}`);
          return false;
        }
        return true;
      }
    } catch {
      /* fall through */
    }

    return this.refreshSession();
  },

  async applyAuthUiConfig() {
    try {
      const config = await this.getConfig();
      document.querySelectorAll("[data-requires-email]").forEach(el => {
        el.hidden = !config.email_sending_enabled;
      });
      return config;
    } catch {
      return {};
    }
  },

  async guardEmailFeaturePage() {
    const page = this.currentPage();
    if (!this.EMAIL_FEATURE_PAGES.has(page)) return;

    const config = await this.getConfig();
    if (!config.email_sending_enabled) {
      window.location.replace("/login");
    }
  },

  async logout() {
    const refreshToken = this.getRefreshToken();
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.getAuthHeaders()
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
    } catch {
      /* always clear locally */
    }
    this.clearSession();
    window.location.href = "/login";
  },

  redirectAfterLogin() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const hasProfile = localStorage.getItem("readerProfile");
    if (next && !next.includes("login") && !next.includes("signup")) {
      window.location.href = next.startsWith("/") ? next : `/${next}`;
    } else if (hasProfile) {
      window.location.href = "/home";
    } else {
      window.location.href = "/reader-quiz";
    }
  },

  setupLogoutLinks() {
    document.querySelectorAll(".sidebar-logout").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        this.logout();
      });
    });
  },

  /** Map clean URLs and legacy .html paths to a canonical page id. */
  ROUTE_ALIASES: {
    "/": "landing.html",
    "/home": "home.html",
    "/login": "login.html",
    "/signup": "signup.html",
    "/discovery": "discovery.html",
    "/library": "library.html",
    "/settings": "settings.html",
    "/reader-dna": "reader-journey.html",
    "/profile": "profile.html",
    "/reader-journey": "reader-journey.html",
    "/reader-quiz": "reader-quiz.html",
    "/ai-companion": "ai-companion.html",
    "/reading-paths": "reading-paths.html",
    "/community": "community.html",
    "/challenges": "challenges.html",
    "/forgot-password": "forgot-password.html",
    "/reset-password": "reset-password.html",
    "/verify-email": "verify-email.html",
    "/verify-email-pending": "verify-email-pending.html"
  },

  currentPath() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    return path;
  },

  currentPage() {
    const path = this.currentPath();
    if (this.ROUTE_ALIASES[path]) return this.ROUTE_ALIASES[path];
    const tail = path.split("/").pop() || "";
    return tail || "landing.html";
  },

  async guardPage() {
    const page = this.currentPage();
    if (!this.PROTECTED_PAGES.has(page)) return true;

    document.documentElement.classList.add("auth-pending");

    const ok = await this.verifySession();
    if (!ok) {
      if (this.currentPage() === "verify-email-pending.html") {
        document.documentElement.classList.remove("auth-pending");
        return true;
      }
      const next = encodeURIComponent(this.currentPath() + window.location.search);
      window.location.replace(`/login?next=${next}`);
      return false;
    }

    document.documentElement.classList.remove("auth-pending");
    this.setupLogoutLinks();
    return true;
  },

  async guardPublicAuthPage() {
    const page = this.currentPage();
    if (!this.PUBLIC_AUTH_PAGES.has(page)) return;
    if (page === "verify-email-pending.html" || page === "reset-password.html" || page === "verify-email.html") {
      return;
    }

    const ok = await this.verifySession();
    if (ok) {
      window.location.replace("/home");
    }
  },

  showError: (id, msg) => BookMindAuthUI.showError(id, msg),
  hideError: id => BookMindAuthUI.hideError(id)
};

(function initAuth() {
  const page = BookMindAuth.currentPage();

  if (BookMindAuth.EMAIL_FEATURE_PAGES.has(page)) {
    BookMindAuth.guardEmailFeaturePage();
  } else if (BookMindAuth.PROTECTED_PAGES.has(page)) {
    BookMindAuth.guardPage();
  } else if (BookMindAuth.PUBLIC_AUTH_PAGES.has(page)) {
    BookMindAuth.guardPublicAuthPage();
    if (page === "login.html" || page === "signup.html") {
      document.addEventListener("DOMContentLoaded", () => BookMindAuth.applyAuthUiConfig());
    }
  } else {
    document.addEventListener("DOMContentLoaded", () => BookMindAuth.setupLogoutLinks());
  }
})();
