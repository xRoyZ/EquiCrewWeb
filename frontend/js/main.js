/* Entry module of every page: marks <html> as scripted, wires the navigation and, on the
   Kontakt page, the contact form. Content is already in each page's HTML; this only enhances it. */
import { initContactForm } from "./contact-form.js";
import { initNav } from "./nav.js";

document.documentElement.classList.add("js");

function start() {
  initNav(document);
  const form = document.querySelector("form[data-contact-form]");
  if (form) {
    initContactForm(form, { apiBase: window.EQUICREW_CONFIG?.apiBase ?? "" });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
