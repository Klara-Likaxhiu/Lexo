/** Shared authentication UI helpers: loading states, toasts, password toggle. */
const BookMindAuthUI = {
  setLoading(button, loading, idleText, loadingText) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    button.dataset.idleText = idleText || button.textContent;
    button.textContent = loading ? loadingText || "Please wait…" : button.dataset.idleText;
  },

  showToast(message, type = "success") {
    let container = document.getElementById("authToast");
    if (!container) {
      container = document.createElement("div");
      container.id = "authToast";
      container.className = "auth-toast";
      document.body.appendChild(container);
    }
    container.textContent = message;
    container.className = `auth-toast auth-toast-${type} show`;
    clearTimeout(container._hideTimer);
    container._hideTimer = setTimeout(() => container.classList.remove("show"), 4200);
  },

  showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 400);
  },

  hideError(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.hidden = true;
  },

  showSuccess(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  },

  hideSuccess(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.hidden = true;
  },

  showStatusMessage(elementId, message, type = "info") {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    const tone =
      type === "success" ? "auth-success-inline" : type === "warn" ? "auth-warn-inline" : "";
    el.className = tone ? `auth-status-message ${tone}` : "auth-status-message";
    el.hidden = false;
  },

  hideStatusMessage(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.hidden = true;
  },

  clearAuthMessages({ errorId, successId, statusId } = {}) {
    if (errorId) this.hideError(errorId);
    if (successId) this.hideSuccess(successId);
    if (statusId) this.hideStatusMessage(statusId);
  },

  initPasswordToggles() {
    document.querySelectorAll("[data-toggle-password]").forEach(button => {
      const targetId = button.getAttribute("data-toggle-password");
      const input = document.getElementById(targetId);
      if (!input) return;

      button.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.setAttribute("aria-label", show ? "Hide password" : "Show password");
        button.classList.toggle("is-visible", show);
      });
    });
  },

  passwordField(id, placeholder, autocomplete) {
    return `
      <div class="password-field">
        <input type="password" id="${id}" placeholder="${placeholder}" autocomplete="${autocomplete}" required>
        <button type="button" class="password-toggle" data-toggle-password="${id}" aria-label="Show password">
          <svg class="icon-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg class="icon-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
        </button>
      </div>
    `;
  },

  socialDivider() {
    return `<div class="auth-divider"><span>or continue with</span></div>`;
  },

  async loadOAuthButtons(containerId, onSuccess, rememberMeSelector) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
      const response = await fetch("/api/auth/config");
      const config = await response.json();
      container.innerHTML = "";

      if (config.google_client_id) {
        const googleBtn = document.createElement("button");
        googleBtn.type = "button";
        googleBtn.className = "btn btn-oauth btn-google";
        googleBtn.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Continue with Google';
        googleBtn.addEventListener("click", async () => {
          BookMindAuthUI.setLoading(googleBtn, true, "Continue with Google", "Signing in…");
          try {
            await BookMindAuth.signInWithGoogle(config.google_client_id, rememberMeSelector, onSuccess);
            BookMindAuthUI.showToast("Signed in with Google!");
            if (onSuccess) onSuccess();
          } catch (error) {
            if (error && error.message) {
              BookMindAuthUI.showToast(error.message, "error");
            }
          } finally {
            BookMindAuthUI.setLoading(googleBtn, false, "Continue with Google");
          }
        });
        container.appendChild(googleBtn);
      }

      if (config.apple_client_id) {
        const appleBtn = document.createElement("button");
        appleBtn.type = "button";
        appleBtn.className = "btn btn-oauth btn-apple";
        appleBtn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg> Continue with Apple';
        appleBtn.addEventListener("click", async () => {
          BookMindAuthUI.setLoading(appleBtn, true, "Continue with Apple", "Signing in…");
          try {
            await BookMindAuth.signInWithApple(config.apple_client_id, rememberMeSelector, onSuccess);
            BookMindAuthUI.showToast("Signed in with Apple!");
            if (onSuccess) onSuccess();
          } catch (error) {
            if (error && error.message && error.error !== "popup_closed_by_user") {
              BookMindAuthUI.showToast(error.message, "error");
            }
          } finally {
            BookMindAuthUI.setLoading(appleBtn, false, "Continue with Apple");
          }
        });
        container.appendChild(appleBtn);
      }

      if (!container.children.length) {
        container.hidden = true;
      } else {
        const divider = document.createElement("div");
        divider.className = "auth-divider";
        divider.innerHTML = "<span>or continue with email</span>";
        container.insertAdjacentElement("afterend", divider);
      }
    } catch {
      container.hidden = true;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => BookMindAuthUI.initPasswordToggles());
