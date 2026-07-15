/**
 * Lexo API client — attaches Supabase Bearer token to protected requests.
 * Refreshes expired sessions automatically via window.LexoAuth.refreshSession().
 * Requires js/auth.js loaded first.
 */
const LexoAPI = {
  url(path) {
    if (window.LexoAuth?.apiUrl) {
      return window.LexoAuth.apiUrl(path);
    }
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${window.location.origin}${normalized}`;
  },

  _parseJsonBody(rawBody) {
    if (!rawBody) return {};
    try {
      return JSON.parse(rawBody);
    } catch {
      return { raw: rawBody };
    }
  },

  _isAuthExpired(status, data, rawBody) {
    if (window.LexoAuth?.isAuthExpiredError) {
      return window.LexoAuth.isAuthExpiredError(status, data, rawBody);
    }
    return status === 401;
  },

  async _refreshAndRetry({ redirect = false } = {}) {
    if (!window.LexoAuth?.refreshSession) return false;
    const refreshed = await window.LexoAuth.refreshSession({ clearOnFailure: false });
    if (refreshed) return true;

    if (redirect && window.LexoAuth.handleAuthFailure) {
      window.LexoAuth.handleAuthFailure();
      return false;
    }
    return false;
  },

  async ensureAuth({ redirect = false } = {}) {
    if (window.LexoAuth?.whenReady) {
      await window.LexoAuth.whenReady();
    }
    if (window.LexoAuth?._syncSessionFromStorage && !window.LexoAuth._session?.ready) {
      window.LexoAuth._syncSessionFromStorage();
    }

    let token =
      window.LexoAuth?.getAccessToken?.() ||
      localStorage.getItem(window.LexoAuth?.ACCESS_KEY || "lexo_access_token") ||
      null;

    if (!token) {
      if (redirect && window.LexoAuth?.handleAuthFailure) {
        window.LexoAuth.handleAuthFailure();
      }
      return null;
    }

    if (window.LexoAuth?.isAccessTokenExpired?.(token)) {
      const fresh = await window.LexoAuth.ensureFreshSession({ clearOnFailure: redirect });
      if (!fresh) {
        if (redirect && window.LexoAuth.handleAuthFailure) {
          window.LexoAuth.handleAuthFailure();
        }
        return null;
      }
      token = window.LexoAuth.getAccessToken();
    }

    return token;
  },

  _extractError(data, rawBody, status) {
    if (window.LexoAuth?.extractErrorMessage) {
      return window.LexoAuth.extractErrorMessage(data, rawBody, status);
    }
    if (typeof data?.detail === "string") return data.detail;
    return `Request failed (HTTP ${status}).`;
  },

  async request(path, { method = "GET", body = null, auth = true, redirect = false, _retried = false, timeoutMs = 15000 } = {}) {
    let token = null;
    if (auth) {
      token = await this.ensureAuth({ redirect });
      if (!token) {
        if (redirect) return null;
        throw new Error("Not authenticated. Please sign in.");
      }
    } else if (window.LexoAuth?.whenReady) {
      await window.LexoAuth.whenReady();
      if (window.LexoAuth?._syncSessionFromStorage && !window.LexoAuth._session?.ready) {
        window.LexoAuth._syncSessionFromStorage();
      }
      token = window.LexoAuth.getAccessToken() || null;
    }

    const url = this.url(path);
    const headers = {};
    if (body != null || method !== "GET") {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout =
      controller && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms (${path}).`);
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const rawBody = await response.text();
    const data = this._parseJsonBody(rawBody);

    if (auth && !_retried && this._isAuthExpired(response.status, data, rawBody)) {
      const refreshed = await this._refreshAndRetry({ redirect });
      if (refreshed) {
        return this.request(path, { method, body, auth, redirect, _retried: true, timeoutMs });
      }
      if (redirect) return null;
      throw new Error("Your session has expired. Please sign in again.");
    }

    if (!response.ok) {
      throw new Error(this._extractError(data, rawBody, response.status));
    }

    return data;
  },

  get(path, options = {}) {
    return this.request(path, { ...options, method: "GET" });
  },

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: "POST", body });
  },

  put(path, body, options = {}) {
    return this.request(path, { ...options, method: "PUT", body });
  },

  patch(path, body, options = {}) {
    return this.request(path, { ...options, method: "PATCH", body });
  },

  delete(path, options = {}) {
    return this.request(path, { ...options, method: "DELETE" });
  },

  async getMe({ redirect = false, force = false } = {}) {
    const token = window.LexoAuth?.getAccessToken?.();
    const cachedUser = window.LexoAuth?.getCurrentUser?.();
    if (
      !force &&
      token &&
      cachedUser?.id &&
      !window.LexoAuth.isAccessTokenExpired?.(token)
    ) {
      return cachedUser;
    }

    const data = await this.get("/api/auth/me", { redirect });
    if (!data) return null;
    if (data.user && window.LexoAuth?._persistUser) {
      window.LexoAuth._persistUser(data.user);
      if (window.LexoAuth._meCache && token) {
        window.LexoAuth._meCache = { token, user: data.user, at: Date.now() };
      }
    }
    return data.user || null;
  },

  async getReaderContext() {
    if (window.LexoLibrary) {
      // Never block AI widgets forever on library load.
      await Promise.race([
        LexoLibrary.ensureLoaded().catch(() => null),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    }

    const parseJson = key => {
      try {
        return JSON.parse(localStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    };

    const readerProfile = parseJson("readerProfile");
    const quizAnswers = parseJson("reader_quiz_answers");
    const discoveryAnswers = quizAnswers || parseJson("reader_discovery_answers");
    const extraDiscoveryAnswers = quizAnswers ? {} : parseJson("reader_extra_discovery_answers");

    const library = LexoLibrary?.getLibrary?.() || { read: [], reading: [], want: [], not_interested: [] };
    const reviews = parseJson("book_reviews") || [];

    return {
      profile: readerProfile,
      discovery_answers: discoveryAnswers,
      extra_discovery_answers: extraDiscoveryAnswers,
      quiz_answers: quizAnswers,
      profile_completion: localStorage.getItem("reader_profile_completion") || "0",
      library: library,
      excluded_books: LexoLibrary?.getExcludedBooks?.() || [],
      reviews: reviews,
      today_mood: localStorage.getItem("lexo_today_mood"),
      today_goal: localStorage.getItem("lexo_today_goal"),
    };
  },

  _intelligenceCacheKey(context) {
    const library = context.library || {};
    const shelves = ["read", "reading", "want", "not_interested"];
    const librarySig = shelves
      .map(shelf => `${shelf}:${(library[shelf] || []).length}`)
      .join("|");
    return `${context.today_mood || ""}|${context.today_goal || ""}|${librarySig}|${context.profile_completion || "0"}`;
  },

  _migrateIntelligenceCacheKeys() {
    try {
      if (localStorage.getItem("lexo_reader_intelligence") != null) return;
      for (const key of ["bookmind_reader_intelligence", "bookmindai_reader_intelligence"]) {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;
        localStorage.setItem("lexo_reader_intelligence", raw);
        localStorage.removeItem(key);
        break;
      }
      if (localStorage.getItem("lexo_intelligence_meta") != null) return;
      for (const key of ["bookmind_intelligence_meta", "bookmindai_intelligence_meta"]) {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;
        localStorage.setItem("lexo_intelligence_meta", raw);
        localStorage.removeItem(key);
        break;
      }
    } catch (_) {
      /* ignore */
    }
  },

  _readIntelligenceCache(context, { allowStale = false } = {}) {
    this._migrateIntelligenceCacheKeys();
    try {
      const payload = JSON.parse(localStorage.getItem("lexo_reader_intelligence") || "null");
      if (!payload) return null;
      const meta = JSON.parse(localStorage.getItem("lexo_intelligence_meta") || "null");
      if (!meta) return allowStale ? payload : null;
      const keyMatches = meta.key === this._intelligenceCacheKey(context);
      const fresh = Date.now() - meta.at <= 30 * 60 * 1000;
      if (keyMatches && fresh) return payload;
      if (allowStale && payload?.dashboard) return payload;
      return null;
    } catch {
      return null;
    }
  },

  _writeIntelligenceCache(context, intelligence) {
    localStorage.setItem("lexo_reader_intelligence", JSON.stringify(intelligence));
    localStorage.setItem(
      "lexo_intelligence_meta",
      JSON.stringify({ key: this._intelligenceCacheKey(context), at: Date.now() })
    );
  },

  async getReaderIntelligence({ force = false, timeoutMs = 12000 } = {}) {
    const context = await this.getReaderContext();
    if (!force) {
      const cached = this._readIntelligenceCache(context);
      if (cached) return cached;
    }

    const fetchIntelligence = async () => {
      console.log("[Lexo] Loading AI Pick / mission via /api/reader/intelligence…");
      const intelligence = await this.post(
        "/api/reader/intelligence",
        {
          reader_profile: context,
          library: context.library,
          today_mood: context.today_mood,
          today_goal: context.today_goal,
        },
        { timeoutMs }
      );
      console.log("[Lexo] Intelligence response", intelligence);
      this._writeIntelligenceCache(context, intelligence);
      return intelligence;
    };

    if (window.LexoApiCache?.dedupe && !force) {
      return LexoApiCache.dedupe(
        "intelligence",
        this._intelligenceCacheKey(context),
        fetchIntelligence,
        { ttlMs: 5 * 60 * 1000 }
      );
    }
    return fetchIntelligence();
  },
};

window.LexoAPI = LexoAPI;
