/* Contact form behaviour of the Kontakt page: validation, sending to POST `${apiBase}/api/contact`
   and the result states shown in design/mockups/kontakt.html, kontakt-gesendet.html and
   kontakt-fehler.html.

   The decisions (what is valid, when an error may show, what a server answer means) are pure,
   exported functions; initContactForm only applies them to the page. Every text that reaches the
   page — field messages, server messages, typed values — is inserted with textContent or as
   created nodes, never as HTML. */

export const FIELDS = ["first_name", "last_name", "email", "message"];
export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_MESSAGE_LENGTH = 5000;
export const CONTACT_EMAIL = "office@equicrew.com";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINE_BREAK = /[\r\n]/;
const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_SEND =
  "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zm7.318-19.539l-10.94 10.939";
const ICON_LOADER = "M21 12a9 9 0 1 1-6.219-8.56";
const ICON_ALERT = "M12 8v4m0 4h.01";

/** Count characters the way the server does (code points, not UTF-16 units). */
const length = (value) => [...value].length;

/**
 * The German message for one field, or "" when the value is valid.
 * Mirrors the backend's rules: required, trimmed, names ≤ 100, email valid, message ≤ 5000.
 * @param {string} name
 * @param {unknown} raw
 * @returns {string}
 */
export function validateField(name, raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  switch (name) {
    case "first_name":
      if (!value) return "Bitte gib deinen Vornamen ein.";
      if (length(value) > MAX_NAME_LENGTH) return `Der Vorname darf höchstens ${MAX_NAME_LENGTH} Zeichen lang sein.`;
      if (LINE_BREAK.test(value)) return "Der Vorname darf keine Zeilenumbrüche enthalten.";
      return "";
    case "last_name":
      if (!value) return "Bitte gib deinen Nachnamen ein.";
      if (length(value) > MAX_NAME_LENGTH) return `Der Nachname darf höchstens ${MAX_NAME_LENGTH} Zeichen lang sein.`;
      if (LINE_BREAK.test(value)) return "Der Nachname darf keine Zeilenumbrüche enthalten.";
      return "";
    case "email":
      if (!value) return "Bitte gib deine E-Mail-Adresse ein.";
      if (length(value) > MAX_EMAIL_LENGTH) return "Die E-Mail-Adresse ist zu lang.";
      if (!EMAIL_PATTERN.test(value)) return "Bitte gib eine gültige E-Mail-Adresse ein.";
      return "";
    case "message":
      if (!value) return "Bitte gib eine Nachricht ein.";
      if (length(value) > MAX_MESSAGE_LENGTH) return `Die Nachricht darf höchstens ${MAX_MESSAGE_LENGTH} Zeichen lang sein.`;
      return "";
    default:
      return "";
  }
}

/**
 * Messages for every invalid field of a submission.
 * @param {Record<string, string>} values
 * @returns {Record<string, string>}
 */
export function validateValues(values) {
  const errors = {};
  for (const name of FIELDS) {
    const message = validateField(name, values?.[name]);
    if (message) errors[name] = message;
  }
  return errors;
}

/**
 * Which fields the user has typed into and left, and whether they tried to submit.
 * @returns {{typed: Set<string>, left: Set<string>, submitted: boolean}}
 */
export function createTouchState() {
  return { typed: new Set(), left: new Set(), submitted: false };
}

export function markTyped(state, name) {
  state.typed.add(name);
}

/** A field counts as left only after it was typed into; focusing and leaving it does not. */
export function markLeft(state, name) {
  if (state.typed.has(name)) state.left.add(name);
}

export function markSubmitted(state) {
  state.submitted = true;
}

export function resetTouchState(state) {
  state.typed.clear();
  state.left.clear();
  state.submitted = false;
}

/**
 * Whether a field's validation feedback may be shown: after the user typed into it and left
 * it, or after a submit attempt. An untouched form stays neutral.
 */
export function isErrorVisible(state, name) {
  return state.submitted || (state.typed.has(name) && state.left.has(name));
}

/**
 * The messages to show right now, given the values and what the user has done.
 * @returns {Record<string, string>}
 */
export function visibleErrors(state, values) {
  const errors = validateValues(values);
  const shown = {};
  for (const [name, message] of Object.entries(errors)) {
    if (isErrorVisible(state, name)) shown[name] = message;
  }
  return shown;
}

/** The JSON body of POST /api/contact, the honeypot included as typed. */
export function buildPayload(values) {
  const text = (name) => (typeof values?.[name] === "string" ? values[name] : "");
  return {
    first_name: text("first_name").trim(),
    last_name: text("last_name").trim(),
    email: text("email").trim(),
    message: text("message").trim(),
    website: text("website"),
  };
}

/** The endpoint for an API base ("" means the same origin). */
export function contactUrl(apiBase) {
  const base = typeof apiBase === "string" ? apiBase.replace(/\/+$/, "") : "";
  return `${base}/api/contact`;
}

/**
 * What a server answer means for the form.
 * @param {number} status
 * @param {unknown} body the parsed JSON body, or null
 * @returns {{kind: "success"} | {kind: "fields", fields: Record<string, string>} |
 *   {kind: "rate_limited"} | {kind: "unavailable"} | {kind: "error", message?: string}}
 */
export function outcomeFromResponse(status, body) {
  if (status >= 200 && status < 300) return { kind: "success" };
  const error = body && typeof body === "object" ? body.error : null;
  if (status === 422) {
    const fields = {};
    const raw = error && typeof error.fields === "object" && error.fields ? error.fields : {};
    for (const name of FIELDS) {
      if (typeof raw[name] === "string" && raw[name]) fields[name] = raw[name];
    }
    if (Object.keys(fields).length) return { kind: "fields", fields };
    const message = error && typeof error.message === "string" ? error.message : "";
    return message ? { kind: "error", message } : { kind: "error" };
  }
  if (status === 429) return { kind: "rate_limited" };
  if (status === 503) return { kind: "unavailable" };
  return { kind: "error" };
}

/**
 * The German alert for a failed submission: a bold title, a text and, for the missing mail
 * configuration, a mailto link to the office.
 * @param {"rate_limited" | "unavailable" | "error"} kind
 * @param {string} [message] a server message that replaces the generic text
 */
export function alertCopy(kind, message) {
  if (kind === "rate_limited") {
    return {
      title: "Zu viele Anfragen.",
      text: "Bitte warte ein paar Minuten und versuche es dann noch einmal.",
      mailto: null,
    };
  }
  if (kind === "unavailable") {
    return {
      title: "Das Formular ist gerade nicht erreichbar.",
      text: "Schreib uns bitte direkt an ",
      mailto: CONTACT_EMAIL,
    };
  }
  return {
    title: "Das hat leider nicht geklappt.",
    text: message || "Bitte versuche es in ein paar Minuten noch einmal. Deine Eingaben bleiben erhalten.",
    mailto: null,
  };
}

/** The submit button while sending (disabled, busy, "Wird gesendet …") and otherwise. */
export function sendingState(sending) {
  return sending
    ? { disabled: true, busy: "true", label: "Wird gesendet …", icon: ICON_LOADER }
    : { disabled: false, busy: "false", label: "Senden", icon: ICON_SEND };
}

/**
 * POST the values to the contact API and say what happened. Never throws: a network failure
 * or an unreadable answer is an "error" outcome.
 * @param {Record<string, string>} values
 * @param {{apiBase: string, fetch?: typeof fetch}} options
 */
export async function sendContact(values, { apiBase, fetch: fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await doFetch(contactUrl(apiBase), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(buildPayload(values)),
    });
  } catch {
    return { kind: "error" };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return outcomeFromResponse(response.status, body);
}

/* ------------------------------------------------------------------ the page */

function readValues(form) {
  const values = {};
  for (const name of [...FIELDS, "website"]) {
    const input = form.elements[name];
    values[name] = input && typeof input.value === "string" ? input.value : "";
  }
  return values;
}

function alertIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const group = doc.createElementNS(SVG_NS, "g");
  for (const [key, value] of Object.entries({
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "2",
  })) {
    group.setAttribute(key, value);
  }
  const circle = doc.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICON_ALERT);
  group.append(circle, path);
  svg.append(group);
  return svg;
}

/**
 * Wire a contact form.
 * @param {HTMLFormElement} form
 * @param {{apiBase: string}} options
 * @returns {void}
 */
export function initContactForm(form, options) {
  if (!form || !options) return;
  const doc = form.ownerDocument;
  const container = form.parentElement;
  const button = form.querySelector("[data-submit]");
  const label = button?.querySelector("[data-submit-label]");
  const iconPath = button?.querySelector("[data-submit-icon] path");
  const alertBox = container?.querySelector("[data-form-alert]");
  const alertBody = alertBox?.querySelector("[data-alert-body]");
  const success = container?.querySelector("[data-form-success]");

  const touch = createTouchState();
  let serverErrors = {};
  let sending = false;

  function renderField(name, message) {
    const input = form.elements[name];
    const slot = doc.getElementById(`${name}-error`);
    if (slot) {
      slot.textContent = "";
      if (message) {
        const text = doc.createElement("span");
        text.textContent = message;
        slot.append(alertIcon(doc), text);
      }
    }
    if (!input) return;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function render() {
    const local = visibleErrors(touch, readValues(form));
    for (const name of FIELDS) renderField(name, local[name] || serverErrors[name] || "");
    return local;
  }

  function hideAlert() {
    if (alertBox) alertBox.hidden = true;
  }

  function showAlert(kind, message) {
    if (!alertBox || !alertBody) return;
    const copy = alertCopy(kind, message);
    alertBody.textContent = "";
    const strong = doc.createElement("strong");
    strong.textContent = copy.title;
    alertBody.append(strong, doc.createTextNode(copy.text));
    if (copy.mailto) {
      const link = doc.createElement("a");
      link.setAttribute("href", `mailto:${copy.mailto}`);
      link.textContent = copy.mailto;
      alertBody.append(link, doc.createTextNode("."));
    }
    alertBox.hidden = false;
  }

  function setSending(on) {
    sending = on;
    const state = sendingState(on);
    if (button) {
      button.disabled = state.disabled;
      button.setAttribute("aria-busy", state.busy);
    }
    if (label) label.textContent = state.label;
    if (iconPath) iconPath.setAttribute("d", state.icon);
  }

  function focusFirst(errors) {
    const name = FIELDS.find((field) => errors[field]);
    if (name) form.elements[name]?.focus();
  }

  for (const name of FIELDS) {
    const input = form.elements[name];
    if (!input) continue;
    input.addEventListener("input", () => {
      markTyped(touch, name);
      if (serverErrors[name]) {
        serverErrors = { ...serverErrors };
        delete serverErrors[name];
      }
      render();
    });
    input.addEventListener("blur", () => {
      markLeft(touch, name);
      render();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    hideAlert();
    serverErrors = {};
    markSubmitted(touch);
    const errors = render();
    if (Object.keys(errors).length) {
      focusFirst(errors);
      return;
    }

    setSending(true);
    const outcome = await sendContact(readValues(form), { apiBase: options.apiBase });
    setSending(false);

    if (outcome.kind === "success") {
      form.reset();
      resetTouchState(touch);
      render();
      form.hidden = true;
      if (success) {
        success.hidden = false;
        success.focus?.();
      }
    } else if (outcome.kind === "fields") {
      serverErrors = outcome.fields;
      render();
      focusFirst(serverErrors);
    } else {
      showAlert(outcome.kind, outcome.message);
    }
  });
}
