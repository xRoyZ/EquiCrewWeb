/* Contact form behaviour (validation, sending to POST `${apiBase}/api/contact`, result states).
   The Kontakt page ticket implements it; the signature is part of the shared contract.
   Until then a form[data-contact-form] keeps the browser's default submit behaviour. */

/**
 * Wire a contact form.
 * @param {HTMLFormElement} form
 * @param {{apiBase: string}} options
 * @returns {void}
 */
export function initContactForm(form, options) {
  if (!form || !options) return;
}
