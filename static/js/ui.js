const BookMindUI = {
    readStorageJson(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },

    getCoverClass(genre) {
      genre = (genre || "").toLowerCase();
  
      if (genre.includes("romance")) return "romance-cover";
      if (genre.includes("fantasy")) return "fantasy-cover";
      if (genre.includes("sci")) return "scifi-cover";
      if (genre.includes("horror")) return "horror-cover";
  
      return "mystery-cover";
    },
  
    getCoverIcon(genre) {
      genre = (genre || "").toLowerCase();
  
      if (genre.includes("romance")) return "♡";
      if (genre.includes("fantasy")) return "✦";
      if (genre.includes("sci")) return "✧";
      if (genre.includes("horror")) return "☾";
  
      return "⌕";
    },
  
    makeCustomCover(genre) {
      const coverClass = this.getCoverClass(genre);
      const coverIcon = this.getCoverIcon(genre);
  
      return `
        <div class="custom-cover ${coverClass}">
          <span>${coverIcon}</span>
          <p>${genre || "BookMindAI"}</p>
        </div>
      `;
    }
  };