const BookMindIcons = {
  book: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  heart: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  check: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>',
  ban: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  trash: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  cart: '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
};

const BookMindBookCard = {
  render(book, options = {}) {
    const { showProgress = false } = options;
    const title = book.title || "Untitled Book";
    const author = book.author || "Unknown Author";
    const genre = book.genre || "Book";
    const difficulty = book.difficulty || book.level || "Recommended";
    const reason = book.reason || "";

    const coverUrl = book.cover_url || book.book_data?.cover_url || null;

    const cover = window.BookMindCoverImage
      ? BookMindCoverImage.html(book, {
          imgClass: "shared-book-cover book-cover-img",
          wrapClass: "shared-book-cover-wrap book-cover-wrap",
          placeholderClass: "shared-book-cover book-cover-placeholder",
        })
      : coverUrl
      ? `<img class="shared-book-cover" src="${coverUrl}" alt="${title} cover"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
         <div class="shared-book-cover fallback-cover" style="display:none;"></div>`
      : `<div class="shared-book-cover fallback-cover"></div>`;

    const progressBlock = showProgress ? this.renderProgressBlock(book) : "";

    return `
      <div class="shared-book-card card library-book-card" data-library-id="${book.library_id || ""}">
        ${window.BookMindCoverImage ? cover : `<div class="shared-book-cover-wrap">${cover}</div>`}

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
            <button class="mini-btn save-btn" data-status="reading">${BookMindIcons.book} Reading</button>
            <button class="mini-btn save-btn" data-status="want">${BookMindIcons.heart} Want</button>
            <button class="mini-btn save-btn" data-status="read">${BookMindIcons.check} Finished</button>
            <button class="mini-btn save-btn" data-status="not_interested">${BookMindIcons.ban} Not Interested</button>
            <button class="mini-btn remove-btn">${BookMindIcons.trash} Remove</button>
            <button class="mini-btn buy-btn">${BookMindIcons.cart} Buy</button>
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
          const saved = await BookMindLibrary.addBook(book, this.dataset.status, { silent: true });
          const label = BookMindLibrary.getShelfLabel(this.dataset.status);
          const entry = BookMindLibrary.findBook(saved || book);
          const shelfLabel = entry ? BookMindLibrary.getShelfLabel(entry.status) : label;
          window.BookMindLibraryPage?.showToast?.(
            `"${book.title}" moved to ${shelfLabel}.`
          );
          if (onChanged) {
            await onChanged();
          } else {
            location.reload();
          }
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
