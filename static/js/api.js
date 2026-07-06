/**
 * BookMindAI API client — attaches Supabase Bearer token to protected requests.
 * Requires js/auth.js loaded first.
 */
const BookMindAPI = {
  url(path) {
    if (window.BookMindAuth?.apiUrl) {
      return BookMindAuth.apiUrl(path);
    }
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${window.location.origin}${normalized}`;
  },

  async ensureAuth({ redirect = false } = {}) {
    if (window.BookMindAuth?.whenReady) {
      await BookMindAuth.whenReady();
    }
    if (window.BookMindAuth?._syncSessionFromStorage) {
      BookMindAuth._syncSessionFromStorage();
    }

    const token =
      localStorage.getItem(BookMindAuth?.ACCESS_KEY || "bookmind_access_token") ||
      window.BookMindAuth?.getAccessToken?.() ||
      null;
    if (!token && redirect) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?next=${next}`);
    }
    return token;
  },

  _extractError(data, rawBody, status) {
    if (window.BookMindAuth?.extractErrorMessage) {
      return BookMindAuth.extractErrorMessage(data, rawBody, status);
    }
    if (typeof data?.detail === "string") return data.detail;
    return `Request failed (HTTP ${status}).`;
  },

  async request(path, { method = "GET", body = null, auth = true, redirect = false, _retried = false } = {}) {
    let token = null;
    if (auth) {
      token = await this.ensureAuth({ redirect });
      if (!token) {
        if (redirect) return null;
        throw new Error("Not authenticated. Please sign in.");
      }
    } else if (window.BookMindAuth?.whenReady) {
      await BookMindAuth.whenReady();
      if (window.BookMindAuth?._syncSessionFromStorage) {
        BookMindAuth._syncSessionFromStorage();
      }
      token = BookMindAuth.getAccessToken() || null;
    }

    const url = this.url(path);
    const headers = {};
    if (body != null || method !== "GET") {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (auth) {
      console.log("[BookMindAPI] request", { method, path, authHeader: headers.Authorization || "(missing)" });
      console.log("auth header:", headers.Authorization);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && auth && !_retried && window.BookMindAuth?.refreshSession) {
      const refreshed = await BookMindAuth.refreshSession();
      if (refreshed) {
        return this.request(path, { method, body, auth, redirect, _retried: true });
      }
      if (redirect) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login.html?next=${next}`);
        return null;
      }
      throw new Error("Your session has expired. Please sign in again.");
    }

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

  async getMe({ redirect = false } = {}) {
    const data = await this.get("/api/auth/me", { redirect });
    if (!data) return null;
    if (data.user && window.BookMindAuth?._persistUser) {
      BookMindAuth._persistUser(data.user);
    }
    return data.user || null;
  },

  async getReaderContext() {
    if (window.BookMindLibrary) {
      await BookMindLibrary.ensureLoaded();
    }

    const readerProfile = JSON.parse(localStorage.getItem("readerProfile"));
    const discoveryAnswers = JSON.parse(localStorage.getItem("reader_discovery_answers"));
    const extraDiscoveryAnswers = JSON.parse(localStorage.getItem("reader_extra_discovery_answers"));

    const library = BookMindLibrary.getLibrary();
    const reviews = JSON.parse(localStorage.getItem("book_reviews")) || [];

    return {
      profile: readerProfile,
      discovery_answers: discoveryAnswers,
      extra_discovery_answers: extraDiscoveryAnswers,
      profile_completion: localStorage.getItem("reader_profile_completion") || "25",
      library: library,
      excluded_books: BookMindLibrary.getExcludedBooks(),
      reviews: reviews,
      today_mood: localStorage.getItem("bookmind_today_mood"),
      today_goal: localStorage.getItem("bookmind_today_goal"),
    };
  },

  async getReaderIntelligence() {
    const context = await this.getReaderContext();
    return this.post("/api/reader/intelligence", {
      reader_profile: context,
      library: context.library,
      today_mood: context.today_mood,
      today_goal: context.today_goal,
    });
  },
};

window.BookMindAPI = BookMindAPI;
console.log("BookMindAPI created", window.BookMindAPI);
