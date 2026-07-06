const BookMindBookCard = {
  render(book, options = {}) {
    const { showProgress = false } = options;
    const title = book.title || "Untitled Book";
    const author = book.author || "Unknown Author";
    const genre = book.genre || "Book";
    const difficulty = book.difficulty || book.level || "Recommended";
    const reason = book.reason || "";

    const coverUrl = book.cover_url || book.book_data?.cover_url || null;

    const cover = coverUrl
      ? `<img class="shared-book-cover" src="${coverUrl}" alt="${title} cover"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
         <div class="shared-book-cover fallback-cover" style="display:none;">📖</div>`
      : `<div class="shared-book-cover fallback-cover">📖</div>`;

    const progressBlock = showProgress ? this.renderProgressBlock(book) : "";

    return `
      <div class="shared-book-card card library-book-card" data-library-id="${book.library_id || ""}">
        <div class="shared-book-cover-wrap">
          ${cover}
        </div>

        <div class="shared-book-info">
          <h3>${this.escape(title)}</h3>
          <p class="book-author">${this.escape(author)}</p>

          <div class="book-meta">
            <span>${this.escape(genre)}</span>
            <span>${this.escape(difficulty)}</span>
          </div>

          ${progressBlock}
          ${reason ? `<p class="reason">${this.escape(reason)}</p>` : ""}

          <div class="book-actions">
            <button class="mini-btn save-btn" data-status="reading">📖 Reading</button>
            <button class="mini-btn save-btn" data-status="want">❤️ Want</button>
            <button class="mini-btn save-btn" data-status="read">✅ Finished</button>
            <button class="mini-btn save-btn" data-status="not_interested">🚫 Not Interested</button>
            <button class="mini-btn remove-btn">🗑 Remove</button>
            <button class="mini-btn buy-btn">🛒 Buy</button>
          </div>
        </div>
      </div>
    `;
  },

  renderProgressBlock(book) {
    const { current, total, percent } = BookMindLibrary.getProgressInfo(book);
    const pageLabel =
      total > 0 ? `Page ${current} of ${total}` : percent > 0 ? `${percent}% complete` : "Not started";

    return `
      <div class="library-progress-section">
        <div class="library-progress-head">
          <span class="library-progress-caption">${pageLabel}</span>
          <span class="library-progress-pct">${percent}%</span>
        </div>
        <div class="library-progress-track" aria-hidden="true">
          <div class="library-progress-fill" style="width: ${percent}%"></div>
        </div>
        <form class="library-progress-form">
          <label class="library-progress-field">
            <span>Current</span>
            <input type="number" class="lib-current-page" min="0" step="1" value="${current || ""}" placeholder="0">
          </label>
          <label class="library-progress-field">
            <span>Total</span>
            <input type="number" class="lib-total-pages" min="1" step="1" value="${total || ""}" placeholder="Pages">
          </label>
          <button type="submit" class="mini-btn library-progress-save">Save progress</button>
          <p class="library-progress-error" hidden></p>
        </form>
      </div>
    `;
  },

  attachActions(cardElement, book, options = {}) {
    const { onChanged, onError, onProgressSaved } = options;

    cardElement.querySelectorAll(".save-btn").forEach(button => {
      button.addEventListener("click", async function (event) {
        event.stopPropagation();
        button.disabled = true;
        try {
          await BookMindLibrary.addBook(book, this.dataset.status, { silent: true });
          const label = BookMindLibrary.getShelfLabel(this.dataset.status);
          window.BookMindLibraryPage?.showToast?.(
            `"${book.title}" moved to ${label}.`
          );
          if (onChanged) onChanged();
          else location.reload();
        } catch (error) {
        console.error("[BookMindBookCard] shelf update failed", error);
        if (onError) onError(error.message);
          else alert(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    cardElement.querySelector(".remove-btn")?.addEventListener("click", async function (event) {
      event.stopPropagation();
      this.disabled = true;
      try {
        await BookMindLibrary.removeBook(book, { silent: true });
        window.BookMindLibraryPage?.showToast?.(
          `"${book.title}" removed from your library.`
        );
        if (onChanged) onChanged();
        else location.reload();
      } catch (error) {
        console.error(error);
        if (onError) onError(error.message);
        else alert(error.message);
      } finally {
        this.disabled = false;
      }
    });

    cardElement.querySelector(".buy-btn")?.addEventListener("click", function (event) {
      event.stopPropagation();
      window.open(
        `https://www.google.com/maps/search/${encodeURIComponent(book.title + " bookstore near me")}`,
        "_blank"
      );
    });

    this.attachProgressForm(cardElement, book, { onProgressSaved, onError, onChanged });
  },

  attachProgressForm(cardElement, book, options = {}) {
    const form = cardElement.querySelector(".library-progress-form");
    if (!form || !book.library_id) return;

    const currentInput = form.querySelector(".lib-current-page");
    const totalInput = form.querySelector(".lib-total-pages");
    const errorEl = form.querySelector(".library-progress-error");
    const fillEl = cardElement.querySelector(".library-progress-fill");
    const pctEl = cardElement.querySelector(".library-progress-pct");
    const captionEl = cardElement.querySelector(".library-progress-caption");
    const saveBtn = form.querySelector(".library-progress-save");

    const preview = () => {
      const total = Number(totalInput.value);
      const current = Number(currentInput.value) || 0;
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
      if (!total || total <= 0) return;
      if (current > total) {
        if (errorEl) {
          errorEl.textContent = "Current page cannot be greater than total pages.";
          errorEl.hidden = false;
        }
        return;
      }
      const percent = BookMindLibrary.computePercent(current, total) ?? 0;
      if (fillEl) fillEl.style.width = `${percent}%`;
      if (pctEl) pctEl.textContent = `${percent}%`;
      if (captionEl) captionEl.textContent = `Page ${current} of ${total}`;
    };

    form.addEventListener("click", e => e.stopPropagation());
    currentInput?.addEventListener("input", preview);
    totalInput?.addEventListener("input", preview);

    form.addEventListener("submit", async e => {
      e.preventDefault();
      e.stopPropagation();

      const current = Number(currentInput.value);
      const total = Number(totalInput.value);

      if (!total || total <= 0) {
        if (errorEl) {
          errorEl.textContent = "Enter total pages.";
          errorEl.hidden = false;
        }
        options.onError?.("Enter total pages.");
        return;
      }
      if (current > total) {
        if (errorEl) {
          errorEl.textContent = "Current page cannot be greater than total pages.";
          errorEl.hidden = false;
        }
        options.onError?.("Current page cannot be greater than total pages.");
        return;
      }

      saveBtn.disabled = true;
      if (errorEl) errorEl.hidden = true;

      try {
        const result = await BookMindLibrary.updateReadingProgress(
          book.library_id,
          current,
          total,
          { silent: true }
        );
        options.onProgressSaved?.(result.message, result.finished);
        options.onChanged?.();
      } catch (error) {
        console.error(error);
        if (errorEl) {
          errorEl.textContent = error.message;
          errorEl.hidden = false;
        }
        options.onError?.(error.message);
      } finally {
        saveBtn.disabled = false;
      }
    });
  },

  escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
};
