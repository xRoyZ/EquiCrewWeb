// Logic of js/contact-form.js: validation rules and timing, the meaning of each server answer,
// and the form's state transitions (sending, 200, 422, 429, 503, network error) against a
// minimal fake document.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  alertCopy,
  buildPayload,
  contactUrl,
  createTouchState,
  initContactForm,
  markLeft,
  markSubmitted,
  markTyped,
  outcomeFromResponse,
  sendContact,
  sendingState,
  validateField,
  validateValues,
  visibleErrors,
} from "../js/contact-form.js";

const VALID = { first_name: "Anna", last_name: "Muster", email: "anna.muster@example.at", message: "Hallo!" };

// ------------------------------------------------------------------ pure rules

test("valid values pass", () => {
  assert.deepEqual(validateValues(VALID), {});
});

test("each empty required field has a German message", () => {
  const errors = validateValues({ first_name: "", last_name: "  ", email: "", message: "" });
  assert.equal(errors.first_name, "Bitte gib deinen Vornamen ein.");
  assert.equal(errors.last_name, "Bitte gib deinen Nachnamen ein.");
  assert.equal(errors.email, "Bitte gib deine E-Mail-Adresse ein.");
  assert.equal(errors.message, "Bitte gib eine Nachricht ein.");
});

test("an invalid email, a message over 5000 characters and a long name are rejected", () => {
  assert.equal(validateField("email", "anna@"), "Bitte gib eine gültige E-Mail-Adresse ein.");
  assert.equal(validateField("email", "anna example.at"), "Bitte gib eine gültige E-Mail-Adresse ein.");
  assert.match(validateField("message", "a".repeat(5001)), /höchstens 5000 Zeichen/);
  assert.equal(validateField("message", "a".repeat(5000)), "");
  assert.match(validateField("first_name", "a".repeat(101)), /höchstens 100 Zeichen/);
});

test("an untouched form shows nothing; typing alone shows nothing; typed and left shows", () => {
  const state = createTouchState();
  const empty = { first_name: "", last_name: "", email: "", message: "" };
  assert.deepEqual(visibleErrors(state, empty), {});

  markLeft(state, "first_name"); // focused and left without typing
  assert.deepEqual(visibleErrors(state, empty), {});

  markTyped(state, "first_name");
  assert.deepEqual(visibleErrors(state, empty), {});

  markLeft(state, "first_name");
  assert.deepEqual(Object.keys(visibleErrors(state, empty)), ["first_name"]);
});

test("a submit attempt shows every invalid field", () => {
  const state = createTouchState();
  markSubmitted(state);
  assert.deepEqual(Object.keys(visibleErrors(state, { ...VALID, email: "x" })), ["email"]);
});

test("payload, url and sending state", () => {
  assert.deepEqual(buildPayload({ ...VALID, first_name: " Anna ", website: "" }), { ...VALID, website: "" });
  assert.equal(contactUrl(""), "/api/contact");
  assert.equal(contactUrl("http://localhost:8000/"), "http://localhost:8000/api/contact");
  assert.equal(sendingState(true).disabled, true);
  assert.equal(sendingState(false).label, "Senden");
});

test("server answers map to outcomes", () => {
  assert.deepEqual(outcomeFromResponse(200, { ok: true }), { kind: "success" });
  assert.deepEqual(
    outcomeFromResponse(422, { error: { code: "validation_error", message: "x", fields: { email: "Ungültig.", other: "y" } } }),
    { kind: "fields", fields: { email: "Ungültig." } },
  );
  assert.deepEqual(outcomeFromResponse(422, { error: { message: "Nicht lesbar." } }), { kind: "error", message: "Nicht lesbar." });
  assert.deepEqual(outcomeFromResponse(429, null), { kind: "rate_limited" });
  assert.deepEqual(outcomeFromResponse(503, null), { kind: "unavailable" });
  assert.deepEqual(outcomeFromResponse(500, null), { kind: "error" });
  assert.deepEqual(outcomeFromResponse(413, null), { kind: "error" });
});

test("alert copy is German and the unavailable hint names the office mail", () => {
  assert.match(alertCopy("rate_limited").title, /zu viele Anfragen/i);
  assert.equal(alertCopy("unavailable").mailto, "office@equicrew.com");
  assert.match(alertCopy("error").text, /Eingaben bleiben erhalten/);
});

test("sendContact posts JSON and turns a network failure into an error", async () => {
  let call;
  const ok = await sendContact(VALID, {
    apiBase: "http://api.test",
    fetch: async (url, init) => {
      call = { url, init };
      return { status: 200, json: async () => ({ ok: true }) };
    },
  });
  assert.deepEqual(ok, { kind: "success" });
  assert.equal(call.url, "http://api.test/api/contact");
  assert.equal(call.init.method, "POST");
  assert.equal(JSON.parse(call.init.body).email, VALID.email);

  const failed = await sendContact(VALID, { apiBase: "", fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(failed, { kind: "error" });

  const unreadable = await sendContact(VALID, { apiBase: "", fetch: async () => ({ status: 502, json: async () => { throw new SyntaxError("x"); } }) });
  assert.deepEqual(unreadable, { kind: "error" });
});

// ------------------------------------------------------------------ the page, faked

class Node {
  constructor(doc, tag, attrs = {}) {
    this.doc = doc;
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.text = "";
    this.focused = false;
  }
  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get innerHTML() {
    throw new Error("innerHTML must not be used");
  }
  set innerHTML(_value) {
    throw new Error("innerHTML must not be used");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  async fire(type) {
    const event = { type, target: this, preventDefault() { this.prevented = true; } };
    await Promise.all((this.listeners[type] ?? []).map((fn) => fn(event)));
    return event;
  }
  focus() {
    this.doc.active = this;
    this.focused = true;
  }
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const hit = child.find?.(predicate);
      if (hit) return hit;
    }
    return null;
  }
  querySelector(selector) {
    const parts = selector.split(" ");
    let node = this;
    for (const part of parts) {
      const tagOnly = /^[a-z]+$/.test(part);
      const attr = part.replace(/^\[|\]$/g, "");
      node = node?.find((n) => (tagOnly ? n.tag === part : attr in n.attrs)) ?? null;
    }
    return node;
  }
}

function page() {
  const doc = {
    byId: {},
    active: null,
    createElement: (tag) => new Node(doc, tag),
    createElementNS: (_ns, tag) => new Node(doc, tag),
    createTextNode: (text) => {
      const n = new Node(doc, "#text");
      n.text = text;
      return n;
    },
    getElementById: (id) => doc.byId[id] ?? null,
  };
  const sheet = new Node(doc, "div");
  const form = new Node(doc, "form", { "data-contact-form": "" });
  form.ownerDocument = doc;
  form.parentElement = sheet;
  form.elements = {};
  for (const name of ["first_name", "last_name", "email", "message", "website"]) {
    const input = new Node(doc, name === "message" ? "textarea" : "input", { name });
    form.elements[name] = input;
    form.append(input);
    if (name !== "website") {
      const slot = new Node(doc, "p", { id: `${name}-error` });
      doc.byId[`${name}-error`] = slot;
      form.append(slot);
    }
  }
  form.reset = () => {
    for (const input of Object.values(form.elements)) input.value = "";
  };
  const button = new Node(doc, "button", { "data-submit": "" });
  const label = new Node(doc, "span", { "data-submit-label": "" });
  label.text = "Senden";
  const svg = new Node(doc, "svg", { "data-submit-icon": "" });
  svg.append(new Node(doc, "path", { d: "send" }));
  button.append(label, svg);
  form.append(button);
  const alertBox = new Node(doc, "div", { "data-form-alert": "" });
  alertBox.hidden = true;
  const alertBody = new Node(doc, "p", { "data-alert-body": "" });
  alertBox.append(alertBody);
  const success = new Node(doc, "div", { "data-form-success": "" });
  success.hidden = true;
  sheet.append(form, alertBox, success);
  return { doc, form, button, label, alertBox, alertBody, success, slot: (n) => doc.byId[`${n}-error`] };
}

function fill(form, values) {
  for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
}

function respondWith(status, body) {
  return async () => ({ status, json: async () => body });
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("the page: neutral at start, an emptied and left field shows its message", async () => {
  const p = page();
  initContactForm(p.form, { apiBase: "" });
  assert.equal(p.slot("first_name").textContent, "");

  const input = p.form.elements.first_name;
  await input.fire("blur");
  assert.equal(p.slot("first_name").textContent, "", "focus and leave without typing stays neutral");

  input.value = "A";
  await input.fire("input");
  input.value = "";
  await input.fire("input");
  assert.equal(p.slot("first_name").textContent, "", "no message while still typing");
  await input.fire("blur");
  assert.equal(p.slot("first_name").textContent, "Bitte gib deinen Vornamen ein.");
  assert.equal(input.getAttribute("aria-invalid"), "true");

  input.value = "Anna";
  await input.fire("input");
  assert.equal(p.slot("first_name").textContent, "");
  assert.equal(input.getAttribute("aria-invalid"), null);
});

test("the page: an invalid submit sends nothing and shows every message", async () => {
  const p = page();
  initContactForm(p.form, { apiBase: "" });
  let calls = 0;
  await withFetch(async () => { calls += 1; return { status: 200, json: async () => ({}) }; }, async () => {
    fill(p.form, { ...VALID, email: "kein-at" });
    await p.form.fire("submit");
  });
  assert.equal(calls, 0);
  assert.equal(p.slot("email").textContent, "Bitte gib eine gültige E-Mail-Adresse ein.");
  assert.equal(p.doc.active, p.form.elements.email);
});

test("the page: sending disables the button, 200 clears the form and shows success", async () => {
  const p = page();
  initContactForm(p.form, { apiBase: "http://api.test" });
  fill(p.form, VALID);
  let seenUrl;
  await withFetch(async (url) => {
    seenUrl = url;
    assert.equal(p.button.disabled, true, "disabled while sending");
    assert.equal(p.button.getAttribute("aria-busy"), "true");
    assert.equal(p.label.textContent, "Wird gesendet …");
    await new Promise((resolve) => setImmediate(resolve));
    return { status: 200, json: async () => ({ ok: true }) };
  }, () => p.form.fire("submit"));
  assert.equal(seenUrl, "http://api.test/api/contact");
  assert.equal(p.button.disabled, false);
  assert.equal(p.label.textContent, "Senden");
  assert.equal(p.form.elements.first_name.value, "");
  assert.equal(p.form.elements.message.value, "");
  assert.equal(p.form.hidden, true);
  assert.equal(p.success.hidden, false);
  assert.equal(p.alertBox.hidden, true);
  assert.equal(p.slot("first_name").textContent, "", "no error after clearing");
});

test("the page: 422 shows the server's field messages as text", async () => {
  const p = page();
  initContactForm(p.form, { apiBase: "" });
  fill(p.form, VALID);
  const hostile = "<img src=x onerror=alert(1)>";
  await withFetch(respondWith(422, { error: { code: "validation_error", message: "x", fields: { email: hostile } } }), () =>
    p.form.fire("submit"),
  );
  assert.equal(p.slot("email").textContent, hostile, "shown literally");
  assert.equal(p.form.elements.email.value, VALID.email, "values kept");
  assert.equal(p.success.hidden, true);
});

test("the page: 429 shows the 'zu viele Anfragen' alert, values kept", async () => {
  const p = page();
  initContactForm(p.form, { apiBase: "" });
  fill(p.form, VALID);
  await withFetch(respondWith(429, { error: { code: "rate_limited", message: "x" } }), () => p.form.fire("submit"));
  assert.equal(p.alertBox.hidden, false);
  assert.match(p.alertBody.textContent, /zu viele Anfragen/i);
  assert.equal(p.form.elements.message.value, VALID.message);
});

test("the page: 503 shows the hint with a mailto link to the office", async () => {
  const p = page();
  initContactForm(p.form, { apiBase: "" });
  fill(p.form, VALID);
  await withFetch(respondWith(503, { error: { code: "mail_unavailable", message: "x" } }), () => p.form.fire("submit"));
  assert.equal(p.alertBox.hidden, false);
  const link = p.alertBody.find((n) => n.tag === "a");
  assert.equal(link.getAttribute("href"), "mailto:office@equicrew.com");
  assert.match(p.alertBody.textContent, /office@equicrew\.com/);
  assert.equal(p.form.hidden, false);
});

test("the page: a network error shows a German error and keeps the values", async () => {
  const p = page();
  initContactForm(p.form, { apiBase: "" });
  fill(p.form, VALID);
  await withFetch(async () => { throw new TypeError("Failed to fetch"); }, () => p.form.fire("submit"));
  assert.equal(p.alertBox.hidden, false);
  assert.match(p.alertBody.textContent, /nicht geklappt/);
  assert.equal(p.form.elements.first_name.value, VALID.first_name);
  assert.equal(p.button.disabled, false);

  // a new submit hides the old alert first
  await withFetch(respondWith(200, { ok: true }), () => p.form.fire("submit"));
  assert.equal(p.alertBox.hidden, true);
  assert.equal(p.success.hidden, false);
});

test("the module never writes HTML strings", () => {
  const source = readFileSync(new URL("../js/contact-form.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("the Kontakt page carries the contract's form markup and the privacy note", () => {
  const html = readFileSync(new URL("../kontakt/index.html", import.meta.url), "utf8");
  assert.match(html, /<form data-contact-form novalidate/);
  for (const name of ["first_name", "last_name", "email"]) {
    assert.match(html, new RegExp(`<label for="f-${name}">[^<]+</label>\\s*<input[^>]*id="f-${name}" name="${name}"`));
  }
  assert.match(html, /<label for="f-message">Nachricht<\/label>\s*<textarea[^>]*id="f-message" name="message"/);
  assert.match(html, /<div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off">/);
  assert.match(html, /<span data-submit-label>Senden<\/span>/);
  const actions = html.match(/<div class="form-actions">([\s\S]*?)<\/div>/)[1];
  assert.match(actions, /<a href="\/datenschutz\/">Datenschutzerklärung<\/a>/);
  assert.match(html, /ÖSTERREICH/);
  assert.match(html, /href="mailto:office@equicrew\.com"/);
  assert.match(html, /href="tel:\+436504593129">\+43 650 4593 129</);
  assert.match(html, /Danke für deine Nachricht!/);
});
