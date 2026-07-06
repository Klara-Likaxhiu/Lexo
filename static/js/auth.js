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
  PENDING_EMAIL_KEY: "bookmind_pending_signup_email",
  PENDING_VERIFICATION_KEY: "pendingVerificationEmail",
  LEGACY_PENDING_SIGNUP_KEY: "pendingSignupEmail",

  /** Pages that require a verified login. */
  PROTECTED_PAGES: new Set([
    "library.html",
    "settings.html",
    "profile.html",
    "reader-journey.html",
    "community.html"
  ]),

  /** Public pages — never redirect to login or verify-email-pending on load. */
  PUBLIC_PAGES: new Set([
    "landing.html",
    "login.html",
    "signup.html",
    "forgot-password.html",
    "reset-password.html",
    "verify-email.html",
    "verify-email-pending.html"
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
      store.removeItem(this.PENDING_EMAIL_KEY);
      store.removeItem(this.PENDING_VERIFICATION_KEY);
      store.removeItem(this.LEGACY_PENDING_SIGNUP_KEY);
    });
    localStorage.removeItem(this.REMEMBER_KEY);
  },

  /** Clear auth session and pending signup/verification state (not user data like settings). */
  clearAllAuthState() {
    console.log("[BookMindAuth] clearAllAuthState");
    const authKeys = [
      this.ACCESS_KEY,
      this.REFRESH_KEY,
      this.USER_KEY,
      this.REMEMBER_KEY,
      this.PENDING_EMAIL_KEY,
      this.PENDING_VERIFICATION_KEY,
      this.LEGACY_PENDING_SIGNUP_KEY,
      "bookmind_user_name"
    ];
    [localStorage, sessionStorage].forEach(store => {
      authKeys.forEach(key => store.removeItem(key));
    });
  },

  /** Drop any stale auth from an unfinished signup — signup page must stay accessible. */
  clearPendingSignupState() {
    this.clearAllAuthState();
  },

  setPendingSignupEmail(email) {
    const value = (email || "").trim();
    if (!value) return;
    sessionStorage.setItem(this.PENDING_EMAIL_KEY, value);
  },

  getPendingSignupEmail() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get("email") || "").trim();
    if (fromQuery) return fromQuery;

    return (
      sessionStorage.getItem(this.PENDING_EMAIL_KEY) ||
      localStorage.getItem(this.PENDING_EMAIL_KEY) ||
      ""
    );
  },

  redirectToVerifyEmailPending(email, delivery = {}) {
    console.log("[BookMindAuth] redirectToVerifyEmailPending (explicit post-signup only)", email);
    const value = (email || "").trim();
    if (value) {
      this.setPendingSignupEmail(value);
    }

    const params = new URLSearchParams();
    if (value) params.set("email", value);

    const devUrl =
      delivery.dev_verification_url ||
      delivery.email_delivery?.dev_verification_url ||
      null;
    if (devUrl) params.set("dev_url", devUrl);

    const query = params.toString();
    window.location.href = `/verify-email-pending.html${query ? `?${query}` : ""}`;
  },

  restartSignupFlow() {
    console.log("[BookMindAuth] restartSignupFlow");
    this.clearAllAuthState();
    window.location.href = "/signup.html";
  },

  goToLoginPage(query = "") {
    console.log("[BookMindAuth] goToLoginPage");
    this.clearAllAuthState();
    window.location.href = `/login.html${query}`;
  },

  prepareSignupPage() {
    console.log("[BookMindAuth] prepareSignupPage — clearing stale auth");
    this.clearAllAuthState();
  },

  prepareLoginPage() {
    console.log("[BookMindAuth] prepareLoginPage");
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
      this.clearAllAuthState();
    }
  },

  resetSignupForm() {
    const form = document.getElementById("signupForm");
    if (!form) return;
    form.reset();
    this.hideError("signupError");
    const button = document.getElementById("signupBtn");
    if (button) {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.textContent = "Create Account";
    }
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
    if (data.verification_required) {
      this.clearPendingSignupState();
    } else if (data.access_token) {
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
    if (data.verification_required) {
      this.clearPendingSignupState();
    } else {
      this.saveSession(data);
    }
    return data;
  },

  async verifyEmail(payload, type = "signup") {
    const body =
      typeof payload === "string"
        ? { token: payload, type }
        : { ...payload, type: payload.type || type };

    const data = await this.api("/api/auth/verify-email", body);
    return data;
  },

  /** Read Supabase auth params from query string and URL hash. */
  parseAuthParams() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    const get = key => search.get(key) || hash.get(key);

    return {
      token_hash: get("token_hash") || get("token"),
      type: get("type") || "signup",
      access_token: get("access_token"),
      refresh_token: get("refresh_token"),
      error: get("error") || get("error_description"),
      error_code: get("error_code"),
    };
  },

  /** Send misrouted Supabase callbacks (e.g. landing `/`) to the handler page. */
  redirectAuthCallbackIfNeeded() {
    const params = this.parseAuthParams();
    if (!params.token_hash && !params.access_token && !params.error) {
      return false;
    }

    const page = this.currentPage();
    const type = (params.type || "signup").toLowerCase();
    const isRecovery = type === "recovery" || type === "invite";
    const targetPage = isRecovery ? "reset-password.html" : "verify-email.html";

    if (page === targetPage) {
      return false;
    }

    const suffix = `${window.location.search}${window.location.hash}`;
    window.location.replace(`/${targetPage}${suffix}`);
    return true;
  },

  async completeEmailVerification() {
    const params = this.parseAuthParams();

    if (params.error) {
      throw new Error(params.error || "Verification link is invalid or expired.");
    }

    if (params.access_token) {
      return this.verifyEmail({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
        type: params.type || "signup",
      });
    }

    if (!params.token_hash) {
      throw new Error("This verification link is missing a token.");
    }

    return this.verifyEmail({
      token: params.token_hash,
      token_hash: params.token_hash,
      type: params.type || "signup",
    });
  },

  redirectAfterVerification(user) {
    this.clearPendingSignupState();
    const email = user?.email ? encodeURIComponent(user.email) : "";
    const query = email ? `?verified=1&email=${email}` : "?verified=1";
    window.location.href = `/login.html${query}`;
  },

  async resendVerification(email) {
    return this.api("/api/auth/resend-verification", { email });
  },

  async checkVerificationStatus(email) {
    return this.api("/api/auth/verification-status", { email });
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
    if (!token) {
      console.log("[BookMindAuth] verifySession: no token");
      return false;
    }

    try {
      const response = await fetch("/api/auth/me", {
        headers: this.getAuthHeaders()
      });
      if (response.status === 403) {
        console.log("[BookMindAuth] verifySession: 403 unverified");
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
          console.log("[BookMindAuth] verifySession: email not verified");
          return false;
        }
        console.log("[BookMindAuth] verifySession: ok");
        return true;
      }
    } catch (error) {
      console.log("[BookMindAuth] verifySession: /me failed", error);
    }

    const refreshed = await this.refreshSession();
    if (!refreshed) {
      console.log("[BookMindAuth] verifySession: refresh failed");
      return false;
    }

    const user = this.getUser();
    if (!user?.email_verified) {
      console.log("[BookMindAuth] verifySession: user still unverified after refresh");
      return false;
    }
    console.log("[BookMindAuth] verifySession: ok after refresh");
    return Boolean(this.getAccessToken());
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

    if (page === "verify-email-pending.html" || page === "verify-email.html" || page === "reset-password.html") {
      return;
    }

    const config = await this.getConfig();
    if (!config.email_sending_enabled) {
      window.location.replace("/login.html");
    }
  },

  async logout() {
    console.log("[BookMindAuth] logout");
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
    this.clearAllAuthState();
    window.location.href = "/login.html";
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
    "/landing.html": "landing.html",
    "/home": "home.html",
    "/login": "login.html",
    "/signup": "signup.html",
    "/signup.html": "signup.html",
    "/login.html": "login.html",
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
    "/reset-password.html": "reset-password.html",
    "/verify-email": "verify-email.html",
    "/verify-email.html": "verify-email.html",
    "/verify-email-pending": "verify-email-pending.html",
    "/verify-email-pending.html": "verify-email-pending.html"
  },

  currentPath() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    return path;
  },

  currentPage() {
    const path = this.currentPath();
    if (this.ROUTE_ALIASES[path]) return this.ROUTE_ALIASES[path];

    const tail = path.split("/").pop() || "";
    const cleanNames = {
      login: "login.html",
      signup: "signup.html",
      "forgot-password": "forgot-password.html",
      "reset-password": "reset-password.html",
      "verify-email": "verify-email.html",
      "verify-email-pending": "verify-email-pending.html",
      landing: "landing.html"
    };
    if (cleanNames[tail]) return cleanNames[tail];
    if (tail.endsWith(".html")) return tail;
    return tail || "landing.html";
  },

  async guardPage() {
    const page = this.currentPage();
    if (!this.PROTECTED_PAGES.has(page)) return true;

    console.log("[BookMindAuth] guardPage: protecting", page);
    document.documentElement.classList.add("auth-pending");

    const ok = await this.verifySession();
    if (!ok) {
      const next = encodeURIComponent(this.currentPath() + window.location.search);
      console.log("[BookMindAuth] guardPage: redirect to login", next);
      window.location.replace(`/login.html?next=${next}`);
      return false;
    }

    document.documentElement.classList.remove("auth-pending");
    this.setupLogoutLinks();
    return true;
  },

  async guardPublicAuthPage() {
    const page = this.currentPage();
    if (!this.PUBLIC_AUTH_PAGES.has(page)) return;

    console.log("[BookMindAuth] guardPublicAuthPage:", page, "(no verify-email-pending redirect)");

    if (page === "signup.html") {
      this.prepareSignupPage();
      return;
    }

    if (
      page === "verify-email-pending.html" ||
      page === "reset-password.html" ||
      page === "verify-email.html" ||
      page === "forgot-password.html"
    ) {
      return;
    }

    if (page === "login.html") {
      this.prepareLoginPage();
      const params = new URLSearchParams(window.location.search);
      if (params.get("verified") === "1") {
        return;
      }
      if (this.getAccessToken()) {
        const ok = await this.verifySession();
        if (ok) {
          console.log("[BookMindAuth] guardPublicAuthPage: verified user on login, redirect home");
          window.location.replace("/home");
          return;
        }
        console.log("[BookMindAuth] guardPublicAuthPage: stale unverified session on login, clearing");
        this.clearAllAuthState();
      }
      return;
    }
  },

  initSignupPage() {
    this.prepareSignupPage();
    const params = new URLSearchParams(window.location.search);
    if (params.get("fresh") === "1") {
      this.resetSignupForm();
      if (window.history.replaceState) {
        const path = this.currentPath().endsWith(".html") ? this.currentPath() : "/signup.html";
        window.history.replaceState({}, "", path);
      }
    }
  },

  initVerifyEmailPendingPage() {
    const email = this.getPendingSignupEmail();
    const pendingEmailEl = document.getElementById("pendingEmail");
    const resendBtn = document.getElementById("resendBtn");
    const checkVerifiedBtn = document.getElementById("checkVerifiedBtn");
    const signupAgainLink = document.getElementById("signupAgainLink");
    const backToLoginLink = document.getElementById("backToLoginLink");

    if (email && pendingEmailEl) {
      pendingEmailEl.textContent = email;
      this.setPendingSignupEmail(email);
    } else if (pendingEmailEl) {
      pendingEmailEl.textContent = "your email address";
      BookMindAuthUI.showError(
        "resendError",
        "No email address provided. Use Sign up again to create a new account."
      );
      if (resendBtn) resendBtn.disabled = true;
      if (checkVerifiedBtn) checkVerifiedBtn.disabled = true;
    }

    if (signupAgainLink) {
      signupAgainLink.addEventListener("click", () => {
        console.log("[BookMindAuth] sign up again clicked — clearing state");
        BookMindAuth.clearAllAuthState();
      });
    }

    if (backToLoginLink) {
      backToLoginLink.addEventListener("click", () => {
        console.log("[BookMindAuth] back to login clicked — clearing state");
        BookMindAuth.clearAllAuthState();
      });
    }

    if (checkVerifiedBtn) {
      checkVerifiedBtn.addEventListener("click", async () => {
        if (!email) return;
        BookMindAuthUI.clearAuthMessages({
          errorId: "resendError",
          successId: "resendSuccess",
          statusId: "statusMessage"
        });

        BookMindAuthUI.setLoading(checkVerifiedBtn, true, "I've verified — continue", "Checking…");
        try {
          const status = await BookMindAuth.checkVerificationStatus(email);
          if (!status.account_exists) {
            BookMindAuthUI.showError(
              "resendError",
              "No account found for this email. Use Sign up again to create a new account."
            );
            return;
          }
          if (status.verified) {
            BookMindAuth.clearPendingSignupState();
            BookMindAuthUI.showStatusMessage(
              "statusMessage",
              "Email verified! Redirecting you to log in…",
              "success"
            );
            BookMindAuthUI.showToast("Email verified! You can log in now.");
            setTimeout(() => {
              window.location.href = `/login.html?verified=1&email=${encodeURIComponent(email)}`;
            }, 900);
            return;
          }
          BookMindAuthUI.showStatusMessage(
            "statusMessage",
            "Your email is not verified yet. Open the link in your inbox (check Spam/Junk), then try again.",
            "warn"
          );
        } catch (error) {
          BookMindAuthUI.showError(
            "resendError",
            error.message || "Could not check verification status."
          );
        } finally {
          BookMindAuthUI.setLoading(checkVerifiedBtn, false, "I've verified — continue");
        }
      });
    }

    if (resendBtn) {
      resendBtn.addEventListener("click", async () => {
        if (!email) return;
        BookMindAuthUI.clearAuthMessages({
          errorId: "resendError",
          successId: "resendSuccess",
          statusId: "statusMessage"
        });

        BookMindAuthUI.setLoading(resendBtn, true, "Resend verification email", "Sending…");
        try {
          const data = await BookMindAuth.resendVerification(email);
          if (data.already_verified) {
            BookMindAuth.clearPendingSignupState();
            window.location.href = `/login.html?verified=1&email=${encodeURIComponent(email)}`;
            return;
          }
          const successText = data.email_sent
            ? "Verification email sent. Check your inbox and Spam/Junk folder."
            : data.message || "Verification email queued.";
          BookMindAuthUI.showSuccess("resendSuccess", successText);
          BookMindAuthUI.showToast(data.email_sent ? "Verification email sent." : successText);
        } catch (error) {
          BookMindAuthUI.showError(
            "resendError",
            error.message || "Could not send verification email."
          );
        } finally {
          BookMindAuthUI.setLoading(resendBtn, false, "Resend verification email");
        }
      });
    }
  },

  _showDevLink(url) {
    const wrap = document.getElementById("devLinkWrap");
    const link = document.getElementById("devVerifyLink");
    const loadDevLinkBtn = document.getElementById("loadDevLinkBtn");
    if (link) link.href = url;
    if (wrap) wrap.hidden = false;
    if (loadDevLinkBtn) loadDevLinkBtn.hidden = true;
  },

  initVerifyEmailPage() {
    const title = document.getElementById("verifyTitle");
    const message = document.getElementById("verifyMessage");
    const successEl = document.getElementById("verifySuccess");
    const errorEl = document.getElementById("verifyError");
    const actions = document.getElementById("verifyActions");
    const footer = document.getElementById("verifyFooter");
    const resendBtn = document.getElementById("resendBtn");
    const goLoginBtn = document.getElementById("goLoginBtn");

    let pendingEmail = new URLSearchParams(window.location.search).get("email") || "";

    const params = this.parseAuthParams();
    const hasCallback = Boolean(params.token_hash || params.access_token || params.error);

    if (goLoginBtn) {
      goLoginBtn.addEventListener("click", () => {
        window.location.href = pendingEmail
          ? `/login.html?email=${encodeURIComponent(pendingEmail)}`
          : "/login.html";
      });
    }

    if (resendBtn) {
      resendBtn.addEventListener("click", async () => {
        if (!pendingEmail) {
          const entered = window.prompt("Enter your account email to resend verification:");
          if (!entered) return;
          pendingEmail = entered.trim();
        }

        this.hideError("verifyError");
        if (successEl) successEl.hidden = true;
        BookMindAuthUI.setLoading(resendBtn, true, "Resend verification email", "Sending…");

        try {
          const data = await this.resendVerification(pendingEmail);
          if (data.already_verified) {
            window.location.href = `/login.html?verified=1&email=${encodeURIComponent(pendingEmail)}`;
            return;
          }
          const text = data.email_sent
            ? "Verification email sent. Check your inbox and Spam/Junk folder."
            : data.message || "Verification email sent.";
          if (successEl) {
            successEl.textContent = text;
            successEl.hidden = false;
          }
          BookMindAuthUI.showToast(text);
        } catch (error) {
          this.showError("verifyError", error.message || "Could not resend verification email.");
        } finally {
          BookMindAuthUI.setLoading(resendBtn, false, "Resend verification email");
        }
      });
    }

    if (!hasCallback) {
      if (title) title.textContent = "Check your email";
      if (message) {
        message.textContent =
          "Open the verification link from your inbox to confirm your account.";
      }
      if (actions) actions.hidden = false;
      if (footer) footer.hidden = false;
      return;
    }

    if (window.history.replaceState) {
      window.history.replaceState({}, "", this.currentPath());
    }

    this.completeEmailVerification()
      .then(result => {
        pendingEmail = result.user?.email || pendingEmail;
        if (title) title.textContent = "Email verified!";
        if (message) message.textContent = "Your email address has been confirmed.";
        if (successEl) {
          successEl.textContent = "Redirecting you to log in…";
          successEl.hidden = false;
        }
        const icon = document.getElementById("verifyIcon");
        if (icon) icon.classList.add("auth-status-icon-success");
        BookMindAuthUI.showToast("Email verified successfully!");
        setTimeout(() => this.redirectAfterVerification(result.user), 1500);
      })
      .catch(error => {
        if (title) title.textContent = "Verification failed";
        if (message) {
          message.textContent = "We couldn't verify your email with this link.";
        }
        this.showError(
          "verifyError",
          error.message || "This link may be invalid or expired. Request a new verification email."
        );
        if (actions) actions.hidden = false;
        if (footer) footer.hidden = false;
      });
  },

  showError: (id, msg) => BookMindAuthUI.showError(id, msg),
  hideError: id => BookMindAuthUI.hideError(id)
};

function whenDomReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn);
  } else {
    fn();
  }
}

(function initAuth() {
  const page = BookMindAuth.currentPage();
  const path = BookMindAuth.currentPath();
  console.log("[BookMindAuth] initAuth page:", page, "path:", path);

  // Signup must never inherit stale auth — clear synchronously before any redirect logic.
  if (page === "signup.html") {
    BookMindAuth.clearAllAuthState();
    console.log("[BookMindAuth] initAuth: sync cleared stale auth on signup");
  }

  if (BookMindAuth.redirectAuthCallbackIfNeeded()) {
    console.log("[BookMindAuth] initAuth: auth callback redirect");
    return;
  }

  if (BookMindAuth.PUBLIC_PAGES.has(page) || page === "landing.html") {
    console.log("[BookMindAuth] initAuth: public page, no protected guard");
    if (BookMindAuth.EMAIL_FEATURE_PAGES.has(page)) {
      BookMindAuth.guardEmailFeaturePage();
      if (page === "verify-email-pending.html") {
        whenDomReady(() => BookMindAuth.initVerifyEmailPendingPage());
      } else if (page === "verify-email.html") {
        whenDomReady(() => BookMindAuth.initVerifyEmailPage());
      }
    } else if (BookMindAuth.PUBLIC_AUTH_PAGES.has(page)) {
      BookMindAuth.guardPublicAuthPage();
      if (page === "signup.html") {
        whenDomReady(() => {
          BookMindAuth.initSignupPage();
          BookMindAuth.applyAuthUiConfig();
        });
      } else if (page === "login.html") {
        whenDomReady(() => BookMindAuth.applyAuthUiConfig());
      }
    }
    return;
  }

  if (BookMindAuth.PROTECTED_PAGES.has(page)) {
    console.log("[BookMindAuth] initAuth: protected page");
    BookMindAuth.guardPage();
    return;
  }

  console.log("[BookMindAuth] initAuth: other page, setup logout only");
  whenDomReady(() => BookMindAuth.setupLogoutLinks());
})();
