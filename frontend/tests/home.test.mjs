// Start page (AC-02): the main content holds the word mark, claim, mission, the three teasers with
// their link targets and the kept rendering — and none of the other pages' content.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const main = html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));

test("start page shows word mark, claim and mission", () => {
  assert.match(main, /<h1 class="mark">equicrew<\/h1>/);
  assert.ok(main.includes("smarte energie - fair verteilte ki"));
  assert.ok(main.includes("EquiCrew hat sich zum Ziel gesetzt"));
});

test("teasers and call to action link to their pages", () => {
  assert.match(main, /href="\/ueber-uns\/"/);
  assert.match(main, /href="\/equicube\/"/);
  assert.match(main, /class="btn-primary" href="\/kontakt\/"/);
  assert.ok(main.includes("Neugierig geworden?"));
});

test("rendering is kept with size and German alt text", () => {
  const img = main.match(/<img [^>]*equicube-offen-draft-reverse\.png[^>]*>/);
  assert.ok(img, "rendering missing");
  assert.match(img[0], /width="1215" height="1172"/);
  assert.match(img[0], /alt="Der EquiCube, geöffnet[^"]+"/);
  assert.ok(existsSync(new URL("assets/img/equicube-offen-draft-reverse.png", root)));
});

test("start page repeats no form, team cards or feature lists", () => {
  assert.doesNotMatch(main, /<form/);
  assert.doesNotMatch(main, /class="person/);
  assert.doesNotMatch(main, /class="(tiles|adv__list)/);
});
