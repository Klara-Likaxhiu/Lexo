const BookMindAPI = {
    async post(url, body) {
      const headers = {
        "Content-Type": "application/json"
      };
      if (window.BookMindAuth) {
        Object.assign(headers, BookMindAuth.getAuthHeaders());
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
  
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
  
      return await response.json();
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
        today_goal: localStorage.getItem("bookmind_today_goal")
      };
    },
  
    async getReaderIntelligence() {
      const context = await this.getReaderContext();
  
      return await this.post("/api/reader/intelligence", {
        reader_profile: context,
        library: context.library,
        today_mood: context.today_mood,
        today_goal: context.today_goal
      });
    }
  };