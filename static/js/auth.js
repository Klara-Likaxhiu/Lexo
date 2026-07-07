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
class BookMindApiError extends Error {
  constructor(message, { status, url, data, rawBody, method } = {}) {
    super(message);
    this.name = "BookMindApiError";
    this.status = status ?? 0;
    this.url = url ?? "";
    this.data = data ?? {};
    this.rawBody = rawBody ?? "";
    this.method = method ?? "GET";
  }
}

const BookMindAuth = {
  ACCESS_KEY: "bookmind_access_token",
  REFRESH_KEY: "bookmind_refresh_token",
  USER_KEY: "bookmind_auth_user",
  REMEMBER_KEY: "bookmind_remember_me",
  PENDING_EMAIL_KEY: "bookmind_pending_signup_email",
  PENDING_VERIFICATION_KEY: "pendingVerificationEmail",
  LEGACY_PENDING_SIGNUP_KEY: "pendingSignupEmail",
  LEGACY_AUTH_KEYS: ["bookmind_user_id", "bookmind_session", "bookmind_user_name"],

  /** In-memory session — single source of truth after restoreSession(). */
  _session: {
    ready: false,
    accessToken: null,
    refreshToken: null,
    user: null
  },

  _sessionReadyPromise: null,
  _refreshPromise: null,

  _readStorageItem(key) {
    return localStorage.getItem(key) || sessionStorage.getItem(key);
  },

  _writeStorageItem(key, value) {
    localStorage.setItem(key, value);
    sessionStorage.removeItem(key);
  },

  _removeStorageItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },

  /** Move any sessionStorage auth tokens into localStorage (one canonical store). */
  _migrateLegacySession() {
    const access = sessionStorage.getItem(this.ACCESS_KEY);
    if (access && !localStorage.getItem(this.ACCESS_KEY)) {
      localStorage.setItem(this.ACCESS_KEY, access);
    }
    const refresh = sessionStorage.getItem(this.REFRESH_KEY);
    if (refresh && !localStorage.getItem(this.REFRESH_KEY)) {
      localStorage.setItem(this.REFRESH_KEY, refresh);
    }
    const user = sessionStorage.getItem(this.USER_KEY);
    if (user && !localStorage.getItem(this.USER_KEY)) {
      localStorage.setItem(this.USER_KEY, user);
    }
    sessionStorage.removeItem(this.ACCESS_KEY);
    sessionStorage.removeItem(this.REFRESH_KEY);
    sessionStorage.removeItem(this.USER_KEY);
  },

  _parseStoredUser() {
    const raw = this._readStorageItem(this.USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  _syncSessionFromStorage() {
    this._migrateLegacySession();
    this._session.accessToken = this._readStorageItem(this.ACCESS_KEY);
    this._session.refreshToken = this._readStorageItem(this.REFRESH_KEY);
    this._session.user = this._parseStoredUser();
  },

  _updateSession({ access_token, refresh_token, user } = {}) {
    if (access_token) {
      this._writeStorageItem(this.ACCESS_KEY, access_token);
      this._session.accessToken = access_token;
    }
    if (refresh_token) {
      this._writeStorageItem(this.REFRESH_KEY, refresh_token);
      this._session.refreshToken = refresh_token;
    }
    if (user) {
      this._persistUser(user);
      this._session.user = user;
    }
  },

  _clearLegacyAuthKeys() {
    this.LEGACY_AUTH_KEYS.forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  },

  _resetSessionState() {
    this._session = {
      ready: false,
      accessToken: null,
      refreshToken: null,
      user: null
    };
  },

  /** App pages that need session restore (not login/signup/public auth). */
  APP_PAGES: new Set([
    "home.html",
    "discovery.html",
    "library.html",
    "settings.html",
    "profile.html",
    "book-details.html",
    "reading-paths.html",
    "ai-companion.html",
    "challenges.html",
    "community.html",
    "reader-journey.html",
    "reader-quiz.html",
    "want-to-read.html",
  ]),

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
    return localStorage;
  },

  isRemembered() {
    return localStorage.getItem(this.REMEMBER_KEY) !== "false";
  },

  getActiveStorage() {
    return localStorage;
  },

  saveSession({ access_token, refresh_token, remember_me, user }) {
    if (!access_token) {
      console.warn("[BookMindAuth] saveSession: missing access_token");
      return;
    }
    if (!refresh_token) {
      console.warn("[BookMindAuth] saveSession: missing refresh_token — session cannot be refreshed");
    }

    const remember = remember_me !== undefined ? Boolean(remember_me) : true;
    localStorage.setItem(this.REMEMBER_KEY, remember ? "true" : "false");
    this._clearLegacyAuthKeys();
    this._updateSession({ access_token, refresh_token, user });

    this._session.ready = true;
    this._sessionReadyPromise = Promise.resolve(user || this.getCurrentUser());
    this._dispatchAuthReady(user || this.getCurrentUser());
  },

  _persistUser(user) {
    if (!user) return;
    this._writeStorageItem(this.USER_KEY, JSON.stringify(user));
    this._session.user = user;
  },

  _dispatchAuthReady(user) {
    document.dispatchEvent(
      new CustomEvent("bookmind:auth-ready", {
        detail: { user: user || null, loggedIn: this.isLoggedIn() }
      })
    );
  },

  /** Publish global auth state for api.js and other scripts. */
  _publishAuthState(phase) {
    const state = {
      phase,
      ready: this._session.ready,
      loggedIn: this.isLoggedIn(),
      hasAccessToken: Boolean(this.getAccessToken()),
      hasRefreshToken: Boolean(this.getRefreshToken()),
      user: this.getCurrentUser(),
      accessKey: this.ACCESS_KEY,
      refreshKey: this.REFRESH_KEY,
    };
    console.log("[BookMindAuth] auth state:", state);
    window.__BOOKMIND_AUTH_STATE__ = state;
    this._dispatchAuthReady(state.user);
    return state;
  },

  getAuthState() {
    this._syncSessionFromStorage();
    return {
      loggedIn: this.isLoggedIn(),
      hasAccessToken: Boolean(this.getAccessToken()),
      hasRefreshToken: Boolean(this.getRefreshToken()),
      user: this.getCurrentUser(),
      accessToken: this.getAccessToken(),
    };
  },

  whenReady() {
    if (!this._sessionReadyPromise) {
      this._sessionReadyPromise = this.restoreSession();
    }
    return this._sessionReadyPromise;
  },

  /** Supabase-compatible session accessor — validates via /api/auth/me. */
  async getSession() {
    await this.whenReady();
    const access_token = this.getAccessToken();
    const refresh_token = this.getRefreshToken();
    const user = this.getCurrentUser();
    if (!access_token) {
      return { data: { session: null } };
    }
    return { data: { session: { access_token, refresh_token, user } } };
  },

  async restoreSession() {
    const page = this.currentPage();
    this._syncSessionFromStorage();

    if (page === "signup.html") {
      this._session.ready = true;
      this._publishAuthState("signup-skip");
      return null;
    }

    if (!this._session.accessToken) {
      console.log("[BookMindAuth] restoreSession: no token");
      this._clearLegacyAuthKeys();
      this._session.ready = true;
      this._publishAuthState("no-token");
      return null;
    }

    if (this.isAccessTokenExpired(this._session.accessToken)) {
      console.log("[BookMindAuth] restoreSession: access token expired, refreshing");
      const refreshed = await this.ensureFreshSession({ clearOnFailure: false });
      if (!refreshed) {
        this._session.ready = true;
        this._publishAuthState("expired-token");
        this.updateAuthUi();
        return this._session.user;
      }
    }

    try {
      const user = await this.fetchCurrentUser({ allowRefresh: true });
      this._syncSessionFromStorage();
      this._session.ready = true;
      console.log("[BookMindAuth] restoreSession: ok", user?.username || user?.email || "(no profile)");
      this._publishAuthState("restored");
      this.updateAuthUi();
      return user;
    } catch (error) {
      console.warn("[BookMindAuth] restoreSession failed", error);
      this._session.ready = true;
      this._publishAuthState("restore-failed");
      this.updateAuthUi();
      return this._session.user;
    }
  },

  getCurrentUser() {
    if (this._session.user) return this._session.user;
    return this._parseStoredUser();
  },

  getUser() {
    return this.getCurrentUser();
  },

  async fetchCurrentUser({ allowRefresh = true } = {}) {
    let token = this.getAccessToken();
    if (!token) return null;

    if (allowRefresh && this.isAccessTokenExpired(token)) {
      const refreshed = await this.refreshSession({ clearOnFailure: false });
      if (!refreshed) {
        return this._session.user;
      }
      token = this.getAccessToken();
      if (!token) return this._session.user;
    }

    let response = await fetch(this.apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });

    let rawBody = await response.text();
    let data = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { raw: rawBody };
      }
    }

    if (allowRefresh && this.isAuthExpiredError(response.status, data, rawBody)) {
      const refreshed = await this.refreshSession({ clearOnFailure: false });
      if (!refreshed) {
        console.warn("[BookMindAuth] fetchCurrentUser: refresh failed, keeping stored token");
        return this._session.user;
      }
      response = await fetch(this.apiUrl("/api/auth/me"), {
        headers: this.getAuthHeaders(),
      });
      rawBody = await response.text();
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        data = { raw: rawBody };
      }
    }

    if (!response.ok) {
      if (response.status === 403) {
        return this._session.user;
      }
      throw new Error(`Failed to load user (HTTP ${response.status})`);
    }

    if (data.user) {
      this._persistUser(data.user);
    }
    return data.user || this._session.user;
  },

  clearSession() {
    this._removeStorageItem(this.ACCESS_KEY);
    this._removeStorageItem(this.REFRESH_KEY);
    this._removeStorageItem(this.USER_KEY);
    this._removeStorageItem(this.PENDING_EMAIL_KEY);
    this._removeStorageItem(this.PENDING_VERIFICATION_KEY);
    this._removeStorageItem(this.LEGACY_PENDING_SIGNUP_KEY);
    localStorage.removeItem(this.REMEMBER_KEY);
    this._resetSessionState();
    this._clearLegacyAuthKeys();
  },

  /** Clear auth session and pending signup/verification state (not user data like settings). */
  clearAllAuthState() {
    console.log("[BookMindAuth] clearAllAuthState");
    this.clearSession();
    this._sessionReadyPromise = null;
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
    this._syncSessionFromStorage();
    return this._session.accessToken;
  },

  decodeAccessToken(token) {
    if (!token) return null;
    try {
      const parts = String(token).split(".");
      if (parts.length < 2) return null;
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  },

  isAccessTokenExpired(token, skewSeconds = 30) {
    const payload = this.decodeAccessToken(token);
    if (!payload?.exp) return false;
    return Date.now() >= payload.exp * 1000 - skewSeconds * 1000;
  },

  isAuthExpiredError(status, data, rawBody = "") {
    if (status === 401) return true;
    const message = this.extractErrorMessage(data, rawBody, status).toLowerCase();
    if (status === 403 && message.includes("verify your email")) return false;
    return (
      message.includes("token is expired") ||
      message.includes("jwt expired") ||
      (message.includes("jwt") && message.includes("expired")) ||
      message.includes("invalid token") ||
      message.includes("session expired") ||
      message.includes("not authenticated")
    );
  },

  handleAuthFailure() {
    this.clearAllAuthState();
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?next=${next}`);
  },

  async ensureFreshSession({ clearOnFailure = false } = {}) {
    this._syncSessionFromStorage();
    const token = this.getAccessToken();
    if (!token) return false;
    if (!this.isAccessTokenExpired(token)) return true;

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      console.warn("[BookMindAuth] ensureFreshSession: access token expired, no refresh token");
      if (clearOnFailure) this.handleAuthFailure();
      return false;
    }

    return this.refreshSession({ clearOnFailure });
  },

  getRefreshToken() {
    this._syncSessionFromStorage();
    return this._session.refreshToken;
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

  hasAuthenticatedUser() {
    return this.isLoggedIn() && Boolean(this.getCurrentUser());
  },

  apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${window.location.origin}${normalized}`;
  },

  extractErrorMessage(data, rawBody, status) {
    if (typeof data?.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map(item => (typeof item === "string" ? item : item?.msg || JSON.stringify(item)))
        .join("; ");
    }
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message;
    }
    if (typeof data?.msg === "string" && data.msg.trim()) {
      return data.msg;
    }
    if (typeof data?.error === "string" && data.error.trim()) {
      return data.error;
    }
    if (data?.error && typeof data.error === "object") {
      return JSON.stringify(data.error);
    }
    if (typeof data?.raw === "string" && data.raw.trim()) {
      return data.raw.trim();
    }
    if (rawBody && rawBody.trim() && rawBody.length < 600) {
      return rawBody.trim();
    }
    return `Request failed (HTTP ${status}).`;
  },

  formatErrorForUser(error) {
    if (error instanceof BookMindApiError) {
      const detail = this.extractErrorMessage(error.data, error.rawBody, error.status);
      if (detail && !detail.startsWith("Request failed")) {
        return `[HTTP ${error.status}] ${detail}`;
      }
      return error.message;
    }
    if (error?.message) {
      return error.message;
    }
    return "Request failed.";
  },

  async api(path, body, method = "POST") {
    const url = this.apiUrl(path);
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeaders()
      },
      body: body == null ? undefined : JSON.stringify(body)
    });

    const rawBody = await response.text();
    let data = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { raw: rawBody };
      }
    }

    if (!response.ok) {
      const detail = this.extractErrorMessage(data, rawBody, response.status);
      const message = `[HTTP ${response.status}] ${detail}`;
      const error = new BookMindApiError(message, {
        status: response.status,
        url,
        data,
        rawBody,
        method
      });
      throw error;
    }

    return data;
  },

  async getConfig() {
    const response = await fetch("/api/auth/config");
    return response.json();
  },

  async signup(username, email, password) {
    const endpoint = this.apiUrl("/api/auth/signup");
    console.log("[BookMindAuth] signup →", endpoint, "(origin:", window.location.origin, ")");
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
    console.log("[BookMindAuth] login response", {
      verification_required: data.verification_required,
      hasAccessToken: Boolean(data.access_token),
      hasRefreshToken: Boolean(data.refresh_token),
      hasUser: Boolean(data.user),
    });
    if (data.verification_required) {
      this.clearPendingSignupState();
    } else if (data.access_token) {
      this.saveSession(data);
      console.log("[BookMindAuth] login after saveSession, getAccessToken:", Boolean(this.getAccessToken()));
    } else {
      throw new Error("Login succeeded but the server did not return a session token.");
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

  async completeEmailVerification(cachedParams) {
    const params = cachedParams || this.parseAuthParams();

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

  redirectAfterVerification(result) {
    this.clearPendingSignupState();
    const user = result?.user;
    if (result?.access_token && result?.refresh_token) {
      this.saveSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        remember_me: true,
        user
      });
      console.log("[BookMindAuth] verification complete — session saved, redirect home");
      window.location.href = "/home.html";
      return;
    }

    const email = user?.email ? encodeURIComponent(user.email) : "";
    const query = email ? `?verified=1&email=${email}` : "?verified=1";
    console.log("[BookMindAuth] verification complete — redirect login");
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

  async refreshSession({ clearOnFailure = false } = {}) {
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = this._performRefresh({ clearOnFailure }).finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  },

  async _performRefresh({ clearOnFailure = false } = {}) {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      console.warn("[BookMindAuth] refreshSession: no refresh token in storage");
      if (clearOnFailure) this.handleAuthFailure();
      return false;
    }

    try {
      const response = await fetch(this.apiUrl("/api/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      const rawBody = await response.text();
      let data = {};
      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          data = {};
        }
      }

      if (!response.ok) {
        console.warn("[BookMindAuth] refreshSession failed", response.status, rawBody);
        if (clearOnFailure) {
          this.handleAuthFailure();
        }
        return false;
      }

      if (!data.access_token) {
        console.warn("[BookMindAuth] refreshSession: missing access_token in response");
        if (clearOnFailure) this.handleAuthFailure();
        return false;
      }

      this._updateSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken,
        user: data.user,
      });
      this._session.ready = true;
      this._sessionReadyPromise = Promise.resolve(data.user || this.getCurrentUser());
      console.log("[BookMindAuth] refreshSession: ok");
      return true;
    } catch {
      if (clearOnFailure) this.handleAuthFailure();
      return false;
    }
  },

  async verifySession() {
    if (!this.getAccessToken()) {
      console.log("[BookMindAuth] verifySession: no token");
      return false;
    }

    const user = await this.fetchCurrentUser({ allowRefresh: true });
    if (!this.isLoggedIn() || !user?.id) {
      console.log("[BookMindAuth] verifySession: no valid session");
      return false;
    }

    try {
      const config = await this.getConfig();
      if (
        config.email_verification_required &&
        config.email_sending_enabled &&
        !user.email_verified
      ) {
        console.log("[BookMindAuth] verifySession: email not verified");
        return false;
      }
    } catch (error) {
      console.log("[BookMindAuth] verifySession: config check failed", error);
    }

    console.log("[BookMindAuth] verifySession: ok");
    return true;
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
    this._sessionReadyPromise = null;
    this.clearAllAuthState();
    window.location.href = "/login.html";
  },

  redirectAfterLogin() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const hasProfile = localStorage.getItem("readerProfile");
    const quizComplete = Number(localStorage.getItem("reader_profile_completion")) >= 100;
    if (next && !next.includes("login") && !next.includes("signup")) {
      window.location.href = next.startsWith("/") ? next : `/${next}`;
    } else if (hasProfile || quizComplete) {
      window.location.href = "/home";
    } else {
      window.location.href = "/reader-quiz";
    }
  },

  setupLogoutLinks() {
    const loggedIn = this.isLoggedIn();
    document.querySelectorAll(".sidebar-logout").forEach(link => {
      link.hidden = !loggedIn;
      link.style.display = loggedIn ? "" : "none";
      if (link.dataset.bookmindLogoutBound === "1") return;
      link.dataset.bookmindLogoutBound = "1";
      link.addEventListener("click", event => {
        event.preventDefault();
        this.logout();
      });
    });
  },

  updateAuthUi() {
    this.setupLogoutLinks();
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

    await this.whenReady();
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
        console.log("[BookMindAuth] guardPublicAuthPage: stale session on login, clearing tokens");
        this.clearSession();
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
              "Email verified! Redirecting…",
              "success"
            );
            BookMindAuthUI.showToast("Email verified! You can log in now.");
            setTimeout(() => {
              if (BookMindAuth.isLoggedIn()) {
                window.location.href = "/home.html";
              } else {
                window.location.href = `/login.html?verified=1&email=${encodeURIComponent(email)}`;
              }
            }, 900);
            return;
          }
          BookMindAuthUI.showError("resendError", "Please verify your email first.");
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
        BookMindAuth.clearAllAuthState();
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

        BookMindAuthUI.clearAuthMessages({ errorId: "verifyError", successId: "verifySuccess" });
        if (successEl) successEl.hidden = true;
        BookMindAuthUI.setLoading(resendBtn, true, "Resend verification email", "Sending…");

        try {
          const data = await this.resendVerification(pendingEmail);
          if (data.already_verified) {
            BookMindAuth.clearPendingSignupState();
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

    if (title) title.textContent = "Verifying your email…";
    if (message) message.textContent = "Please wait while we confirm your email address.";
    if (actions) actions.hidden = true;
    if (footer) footer.hidden = true;

    this.completeEmailVerification(params)
      .then(result => {
        pendingEmail = result.user?.email || pendingEmail;
        if (window.history.replaceState) {
          window.history.replaceState({}, "", this.currentPath());
        }
        if (title) title.textContent = "Email verified!";
        if (message) message.textContent = "Your email address has been confirmed.";
        if (successEl) {
          successEl.textContent = result.access_token
            ? "Redirecting you to your library…"
            : "Redirecting you to log in…";
          successEl.hidden = false;
        }
        const icon = document.getElementById("verifyIcon");
        if (icon) icon.classList.add("auth-status-icon-success");
        BookMindAuthUI.showToast("Email verified successfully!");
        setTimeout(() => this.redirectAfterVerification(result), 1500);
      })
      .catch(error => {
        if (window.history.replaceState) {
          const clean = pendingEmail
            ? `${this.currentPath()}?email=${encodeURIComponent(pendingEmail)}`
            : this.currentPath();
          window.history.replaceState({}, "", clean);
        }
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

(async function initAuth() {
  const page = BookMindAuth.currentPage();
  const path = BookMindAuth.currentPath();
  console.log("[BookMindAuth] initAuth page:", page, "path:", path);

  // Sync bookmind_access_token / bookmind_refresh_token from localStorage immediately.
  BookMindAuth._syncSessionFromStorage();
  console.log(
    "[BookMindAuth] initAuth bootstrap hasAccessToken:",
    Boolean(BookMindAuth.getAccessToken())
  );

  if (page === "signup.html") {
    BookMindAuth.clearAllAuthState();
    console.log("[BookMindAuth] initAuth: signup — cleared stale auth");
    BookMindAuth._publishAuthState("signup-cleared");
    return;
  }

  if (BookMindAuth.redirectAuthCallbackIfNeeded()) {
    console.log("[BookMindAuth] initAuth: auth callback redirect");
    return;
  }

  // Every non-signup page restores the Supabase session before app scripts call APIs.
  console.log("[BookMindAuth] initAuth: restoring session");
  BookMindAuth._sessionReadyPromise = null;
  await BookMindAuth.whenReady();
  BookMindAuth.updateAuthUi();

  if (BookMindAuth.PUBLIC_PAGES.has(page) || page === "landing.html") {
    console.log("[BookMindAuth] initAuth: public page");
    if (BookMindAuth.EMAIL_FEATURE_PAGES.has(page)) {
      await BookMindAuth.guardEmailFeaturePage();
      if (page === "verify-email-pending.html") {
        whenDomReady(() => BookMindAuth.initVerifyEmailPendingPage());
      } else if (page === "verify-email.html") {
        whenDomReady(() => BookMindAuth.initVerifyEmailPage());
      }
    } else if (BookMindAuth.PUBLIC_AUTH_PAGES.has(page)) {
      await BookMindAuth.guardPublicAuthPage();
      if (page === "login.html") {
        whenDomReady(() => BookMindAuth.applyAuthUiConfig());
      }
    }
    whenDomReady(() => BookMindAuth.setupLogoutLinks());
    return;
  }

  if (BookMindAuth.PROTECTED_PAGES.has(page)) {
    console.log("[BookMindAuth] initAuth: protected page");
    await BookMindAuth.guardPage();
    return;
  }

  console.log(
    "[BookMindAuth] initAuth: app page ready, hasAccessToken:",
    Boolean(BookMindAuth.getAccessToken())
  );
  whenDomReady(() => BookMindAuth.setupLogoutLinks());
})();

window.BookMindAuth = BookMindAuth;
window.BookMindApiError = BookMindApiError;
