// Toggle logic of js/nav.js against a minimal fake document: the menu button opens and closes
// nav#site-nav, aria-expanded stays in sync, Escape, a link click and an outside click close it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { initNav } from "../js/nav.js";

class FakeElement {
  constructor(tag, attrs = {}, parent = null) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.parent = parent;
    this.listeners = {};
    this.classes = new Set();
    this.focused = false;
    const classes = this.classes;
    this.classList = {
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name),
    };
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  contains(node) {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }
  closest(selector) {
    for (let n = this; n; n = n.parent) if (selector === "a[href]" && n.tag === "a" && "href" in n.attrs) return n;
    return null;
  }
  focus() {
    this.focused = true;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = {};
    this.toggles = [];
    this.byId = {};
  }
  querySelectorAll(selector) {
    return selector === "[data-nav-toggle]" ? this.toggles : [];
  }
  querySelector() {
    return null;
  }
  getElementById(id) {
    return this.byId[id] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
}

// Dispatch an event on `target` and let it bubble through its parents up to the document.
function dispatch(doc, target, type, extra = {}) {
  const event = { type, target, ...extra };
  for (let n = target; n; n = n.parent) for (const fn of n.listeners[type] ?? []) fn(event);
  for (const fn of doc.listeners[type] ?? []) fn(event);
  return event;
}

function page({ withToggle = true, withNav = true } = {}) {
  const doc = new FakeDocument();
  const body = new FakeElement("body");
  const toggle = new FakeElement("button", { "data-nav-toggle": "", "aria-controls": "site-nav", "aria-expanded": "false" }, body);
  const label = new FakeElement("span", {}, toggle);
  const nav = new FakeElement("nav", { id: "site-nav" }, body);
  const link = new FakeElement("a", { href: "/kontakt/" }, nav);
  const linkText = new FakeElement("span", {}, link);
  const outside = new FakeElement("main", {}, body);
  if (withToggle) doc.toggles.push(toggle);
  if (withNav) doc.byId["site-nav"] = nav;
  return { doc, toggle, label, nav, link, linkText, outside };
}

const expanded = (toggle) => toggle.getAttribute("aria-expanded");

test("a click on the menu button opens and a second click closes the navigation", () => {
  const { doc, toggle, nav } = page();
  initNav(doc);
  assert.equal(expanded(toggle), "false");
  assert.equal(nav.classList.contains("is-open"), false);

  dispatch(doc, toggle, "click");
  assert.equal(expanded(toggle), "true");
  assert.equal(nav.classList.contains("is-open"), true);

  dispatch(doc, toggle, "click");
  assert.equal(expanded(toggle), "false");
  assert.equal(nav.classList.contains("is-open"), false);
});

test("a click on the button's label opens the menu as well (touch and mouse hit the inner span)", () => {
  const { doc, toggle, label, nav } = page();
  initNav(doc);
  dispatch(doc, label, "click");
  assert.equal(expanded(toggle), "true");
  assert.equal(nav.classList.contains("is-open"), true);
});

test("Escape closes the open menu and returns focus to the button", () => {
  const { doc, toggle, nav } = page();
  initNav(doc);
  dispatch(doc, toggle, "click");
  dispatch(doc, toggle, "keydown", { key: "Escape" });
  assert.equal(expanded(toggle), "false");
  assert.equal(nav.classList.contains("is-open"), false);
  assert.equal(toggle.focused, true);
});

test("Escape on a closed menu and other keys change nothing", () => {
  const { doc, toggle, nav } = page();
  initNav(doc);
  dispatch(doc, toggle, "keydown", { key: "Escape" });
  assert.equal(expanded(toggle), "false");
  assert.equal(toggle.focused, false);

  dispatch(doc, toggle, "click");
  dispatch(doc, toggle, "keydown", { key: "Tab" });
  assert.equal(expanded(toggle), "true");
  assert.equal(nav.classList.contains("is-open"), true);
});

test("a click on a navigation link closes the menu", () => {
  const { doc, toggle, nav, linkText } = page();
  initNav(doc);
  dispatch(doc, toggle, "click");
  dispatch(doc, linkText, "click");
  assert.equal(expanded(toggle), "false");
  assert.equal(nav.classList.contains("is-open"), false);
});

test("a click inside the navigation but not on a link keeps it open", () => {
  const { doc, toggle, nav } = page();
  initNav(doc);
  dispatch(doc, toggle, "click");
  dispatch(doc, nav, "click");
  assert.equal(expanded(toggle), "true");
});

test("a click outside the open menu closes it", () => {
  const { doc, toggle, nav, outside } = page();
  initNav(doc);
  dispatch(doc, toggle, "click");
  dispatch(doc, outside, "click");
  assert.equal(expanded(toggle), "false");
  assert.equal(nav.classList.contains("is-open"), false);
});

test("a stale aria-expanded in the markup is brought in sync on start", () => {
  const { doc, toggle, nav } = page();
  toggle.setAttribute("aria-expanded", "true");
  initNav(doc);
  assert.equal(expanded(toggle), "false");
  assert.equal(nav.classList.contains("is-open"), false);
});

test("calling initNav twice wires the button only once", () => {
  const { doc, toggle } = page();
  initNav(doc);
  initNav(doc);
  dispatch(doc, toggle, "click");
  assert.equal(expanded(toggle), "true");
});

test("missing button, missing navigation or no document is harmless", () => {
  assert.doesNotThrow(() => initNav(page({ withToggle: false }).doc));
  const noNav = page({ withNav: false });
  assert.doesNotThrow(() => initNav(noNav.doc));
  assert.doesNotThrow(() => dispatch(noNav.doc, noNav.toggle, "click"));
  assert.equal(expanded(noNav.toggle), "false");
  assert.doesNotThrow(() => initNav(null));
  assert.doesNotThrow(() => initNav({}));
});
