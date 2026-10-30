/* Responsive header navigation. Below 820 px the CSS collapses nav#site-nav once <html> carries
   the class "js"; the menu button (button[data-nav-toggle][aria-controls="site-nav"]) opens and
   closes it. A button reacts to mouse, touch, Enter and Space alike through its "click" event;
   Escape, a click on a navigation link and a click outside the open menu close it again.
   Without the button or the navigation nothing is wired and nothing throws. */

const OPEN_CLASS = "is-open";

/** Toggles that are already wired, so a second initNav() call adds no second listener. */
const wired = new WeakSet();

/**
 * Find the navigation a toggle controls.
 * @param {Document} root
 * @param {Element} toggle
 * @returns {Element | null}
 */
function findNav(root, toggle) {
  const id = toggle.getAttribute("aria-controls") || "site-nav";
  if (typeof root.getElementById === "function") return root.getElementById(id);
  return root.querySelector(`#${id}`);
}

/**
 * True when `node` is `container` or lies inside it. Without `contains` it cannot tell, and
 * answers true so an outside click never closes a menu it cannot place.
 * @param {Element} container
 * @param {unknown} node
 * @returns {boolean}
 */
function within(container, node) {
  if (!node) return false;
  if (typeof container.contains !== "function") return true;
  return container.contains(/** @type {Node} */ (node));
}

/**
 * Wire every menu toggle of a document to the navigation it controls.
 * @param {Document} [root=document]
 * @returns {void}
 */
export function initNav(root = globalThis.document) {
  if (!root || typeof root.querySelectorAll !== "function") return;

  for (const toggle of root.querySelectorAll("[data-nav-toggle]")) {
    if (wired.has(toggle)) continue;
    const nav = findNav(root, toggle);
    if (!nav) continue;
    wired.add(toggle);

    const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
    const set = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle(OPEN_CLASS, open);
    };

    // Start closed and in sync, whatever the markup said.
    set(false);

    toggle.addEventListener("click", () => set(!isOpen()));

    nav.addEventListener("click", (event) => {
      const target = event.target;
      const link = target && typeof target.closest === "function" ? target.closest("a[href]") : null;
      if (link && isOpen()) set(false);
    });

    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isOpen()) return;
      set(false);
      if (typeof toggle.focus === "function") toggle.focus();
    });

    root.addEventListener("click", (event) => {
      if (!isOpen()) return;
      const target = event.target;
      if (within(toggle, target) || within(nav, target)) return;
      set(false);
    });
  }
}
