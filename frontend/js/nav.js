/* Responsive header navigation: the menu button opens and closes nav#site-nav on narrow
   screens (CSS collapses it below 820 px once <html> carries the class "js").
   The UI kit ticket refines this module; the signature is part of the shared contract. */

/**
 * Wire the menu toggle(s) of a document.
 * @param {Document} [root=document]
 * @returns {void}
 */
export function initNav(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("[data-nav-toggle]").forEach((toggle) => {
    const nav = root.getElementById(toggle.getAttribute("aria-controls") || "site-nav");
    if (!nav) return;
    const set = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", () => set(toggle.getAttribute("aria-expanded") !== "true"));
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        set(false);
        toggle.focus();
      }
    });
  });
}
