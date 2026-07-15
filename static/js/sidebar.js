/** Shared app sidebar — premium editorial layout with profile card. */
window.LexoSidebar = {
  NAV: [
    { page: "home", href: "home.html", label: "Home", icon: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>' },
    { page: "discovery", href: "discovery.html", label: "Discovery", icon: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>' },
    { page: "library", href: "library.html", label: "My Library", icon: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>' },
    { page: "reading-paths", href: "reading-paths.html", label: "Reading Paths", icon: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>' },
    { page: "reader-journey", href: "reader-journey.html", label: "Reader DNA", icon: '<path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/>' },
    { page: "community", href: "community.html", label: "Community", icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { page: "challenges", href: "challenges.html", label: "Challenges", icon: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>' },
    { page: "ai-companion", href: "ai-companion.html", label: "AI Companion", icon: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>' },
  ],

  icon(svgPath) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgPath}</svg>`;
  },

  brandIcon() {
    return this.icon('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
  },

  getUser() {
    const user = window.LexoAuth?.getCurrentUser?.();
    const profile = (() => {
      try {
        return JSON.parse(localStorage.getItem("lexo_user_profile") || "null");
      } catch {
        return null;
      }
    })();
    const name = profile?.nickname || user?.username || "Reader";
    const initial = name.charAt(0).toUpperCase();
    const avatar = profile?.avatarUrl || null;
    return { name, initial, avatar };
  },

  render(activePage) {
    const nav = this.NAV.map(item => {
      const active = item.page === activePage ? ' class="active"' : "";
      return `<a href="${item.href}"${active}>${this.icon(item.icon)}<span>${item.label}</span></a>`;
    }).join("");

    const { name, initial, avatar } = this.getUser();
    const avatarHtml = avatar
      ? `<img src="${avatar}" alt="" class="sidebar-profile-avatar-img">`
      : `<span class="sidebar-profile-initial" aria-hidden="true">${initial}</span>`;

    return `
      <div class="sidebar-brand">${this.brandIcon()}<span>Lexo</span></div>
      <nav class="sidebar-nav" aria-label="Main">${nav}</nav>
      <div class="sidebar-footer">
        <a href="profile.html" class="sidebar-profile-card">
          ${avatarHtml}
          <div class="sidebar-profile-meta">
            <strong>${name}</strong>
            <span>View Profile</span>
          </div>
        </a>
        <a href="#" class="sidebar-logout">${this.icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>')}<span>Logout</span></a>
      </div>`;
  },

  mount(el) {
    if (!el) return;
    const page = el.dataset.page || "";
    el.classList.add("sidebar", "sidebar-editorial");
    el.innerHTML = this.render(page);
    window.LexoAuth?.setupLogoutLinks?.();
  },

  refreshProfile() {
    const el = document.querySelector(".sidebar-editorial[data-page]");
    if (el) this.mount(el);
  },
};

document.addEventListener("lexo:auth-ready", () => {
  LexoSidebar.refreshProfile();
});

document.addEventListener("DOMContentLoaded", () => {
  const el = document.querySelector("[data-page].sidebar-editorial, aside[data-page]");
  if (el) LexoSidebar.mount(el);
});
