// Checks of the Über uns page content: crew text, group photo and the three founder cards
// with their portraits, role and mailto links; every referenced image exists.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(new URL("../ueber-uns/index.html", import.meta.url), "utf8");
const main = html.match(/<main id="main">([\s\S]*?)<\/main>/)?.[1] ?? "";

const FOUNDERS = [
  ["Michael Hochstöger", "michael.hochstoeger@equicrew.com", "250717-michael-square.jpg"],
  ["Christian Hinterdorfer", "christian.hinterdorfer@equicrew.com", "250717-hinterdorfer-square.jpg"],
  ["Christian Hinterreiter", "christian.hinterreiter@equicrew.com", "250717-hinterreiter-square.jpg"],
];

test("intro shows the crew headline and text", () => {
  assert.match(main, /<h1[^>]*>Über die Crew<\/h1>/);
  assert.match(main, /Jedes Schiff braucht eine Crew/);
  assert.match(main, /<h2[^>]*>Das Team<\/h2>/);
});

test("three founder cards with portrait, role and mailto link", () => {
  const cards = [...main.matchAll(/<li class="person[^"]*">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(cards.length, 3);
  FOUNDERS.forEach(([name, mail, img], i) => {
    const card = cards[i];
    assert.match(card, new RegExp(`<h3[^>]*>${name}</h3>`));
    assert.match(card, />Founder</);
    assert.ok(card.includes(`href="mailto:${mail}"`), `${name}: mailto link`);
    assert.ok(card.includes(`src="/assets/img/${img}"`), `${name}: portrait`);
    assert.match(card, /loading="lazy"/);
  });
});

test("every image exists, has a German alt and its dimensions", () => {
  const imgs = [...main.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.equal(imgs.length, 4);
  for (const img of imgs) {
    const src = img.match(/src="([^"]+)"/)[1];
    assert.ok(existsSync(`${ROOT}${src.slice(1)}`), `${src} missing`);
    assert.match(img, /alt="[^"]{10,}"/);
    assert.match(img, /width="\d+" height="\d+"/);
  }
});

test("next links lead to existing pages", () => {
  for (const href of ["/equicube/", "/kontakt/"]) {
    assert.ok(main.includes(`href="${href}"`));
    assert.ok(existsSync(`${ROOT}${href.slice(1)}index.html`));
  }
});
