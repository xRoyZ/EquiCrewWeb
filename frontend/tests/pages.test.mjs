// Checks of the website skeleton that stay true when the page tickets fill <main>:
// every document exists with its own German head, the shared header and footer, and
// serve.mjs serves pages, the generated config and the 404 page.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { configScript, startServer } from "../serve.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PAGES = [
  { file: "index.html", path: "/", css: "home", current: "/" },
  { file: "ueber-uns/index.html", path: "/ueber-uns/", css: "ueber-uns", current: "/ueber-uns/" },
  { file: "equicube/index.html", path: "/equicube/", css: "equicube", current: "/equicube/" },
  { file: "kontakt/index.html", path: "/kontakt/", css: "kontakt", current: "/kontakt/" },
  { file: "impressum/index.html", path: "/impressum/", css: "legal", current: "/impressum/" },
  { file: "datenschutz/index.html", path: "/datenschutz/", css: "legal", current: null },
  { file: "404.html", path: "/404.html", css: "legal", current: null },
];
const NAV = ["/", "/ueber-uns/", "/equicube/", "/kontakt/", "/impressum/"];
const NAV_LABELS = ["Start", "Über uns", "EquiCube", "Kontakt", "Impressum"];

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const region = (html, tag, cls) => {
  const match = html.match(new RegExp(`<${tag}[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</${tag}>`));
  assert.ok(match, `<${tag} class="${cls}"> missing`);
  return match[1];
};
const attr = (html, re) => html.match(re)?.[1];
const GERMAN = /[äöüÄÖÜß]|\b(der|die|das|und|für|uns|Seite|nicht|schreib)\b/;

test("every page document exists", () => {
  for (const page of PAGES) {
    assert.ok(existsSync(new URL(`../${page.file}`, import.meta.url)), `${page.file} missing`);
  }
});

test("each page has its own German title and meta description", () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const page of PAGES) {
    const html = read(page.file);
    assert.match(html, /<html lang="de">/, page.file);
    const title = attr(html, /<title>([^<]+)<\/title>/);
    const description = attr(html, /<meta name="description" content="([^"]+)">/);
    assert.ok(title && title.trim().length > 5, `${page.file}: title`);
    assert.ok(description && description.length > 40, `${page.file}: description`);
    assert.match(`${title} ${description}`, GERMAN, `${page.file}: German text`);
    titles.add(title);
    descriptions.add(description);
  }
  assert.equal(titles.size, PAGES.length, "titles are unique");
  assert.equal(descriptions.size, PAGES.length, "descriptions are unique");
});

test("each head carries canonical, Open Graph tags and the contract's assets", () => {
  for (const page of PAGES) {
    const html = read(page.file);
    const canonical = attr(html, /<link rel="canonical" href="([^"]+)">/);
    assert.ok(canonical?.endsWith(page.path), `${page.file}: canonical ${canonical}`);
    for (const prop of ["og:title", "og:description", "og:url", "og:type"]) {
      assert.match(html, new RegExp(`<meta property="${prop}" content="[^"]+">`), `${page.file}: ${prop}`);
    }
    const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    const config = attr(html, /<script src="([^"]+)"><\/script>/);
    const main = attr(html, /<script type="module" src="([^"]+)"><\/script>/);
    // Resolve every link the way a browser does for the URL this document is served at.
    const pageUrl = new URL(page.path, "http://site.test");
    const resolved = [...hrefs, config, main].map((href) => new URL(href, pageUrl).pathname);
    assert.deepEqual(resolved, [
      "/fonts/font.css",
      "/css/tokens.css",
      "/css/base.css",
      "/css/components.css",
      `/css/pages/${page.css}.css`,
      "/js/config.js",
      "/js/main.js",
    ]);
    for (const href of [...hrefs, config, main]) {
      const onDisk = href.startsWith("/") ? `${ROOT}${href.slice(1)}` : new URL(href, new URL(`../${page.file}`, import.meta.url));
      assert.ok(existsSync(onDisk), `${page.file}: ${href} exists`);
    }
  }
});

test("each page has the skip link, a main landmark and the menu markup", () => {
  for (const page of PAGES) {
    const html = read(page.file);
    assert.match(html, /<a class="skip-link" href="#main">Zum Inhalt springen<\/a>/, page.file);
    assert.equal(html.match(/<main id="main"/g)?.length, 1, `${page.file}: one main#main`);
    assert.match(
      html,
      /<button[^>]*data-nav-toggle[^>]*aria-controls="site-nav"[^>]*aria-expanded="false"/,
      `${page.file}: menu toggle`,
    );
    assert.match(html, /<nav id="site-nav"/, `${page.file}: nav#site-nav`);
  }
});

test("the header navigation has the five links and marks the current page", () => {
  for (const page of PAGES) {
    const nav = region(read(page.file), "nav", "site-nav");
    const links = [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)];
    assert.deepEqual(
      links.map((m) => m[1]),
      NAV,
      `${page.file}: nav targets`,
    );
    assert.deepEqual(
      links.map((m) => m[3]),
      NAV_LABELS,
      `${page.file}: nav labels`,
    );
    const current = links.filter((m) => m[2].includes('aria-current="page"')).map((m) => m[1]);
    assert.deepEqual(current, page.current ? [page.current] : [], `${page.file}: aria-current`);
  }
});

test("the footer shows address, mail, phone, Kontakt, Datenschutz, Impressum and the copyright", () => {
  for (const page of PAGES) {
    const footer = region(read(page.file), "footer", "site-footer");
    assert.match(footer, /EquiCrew FlexCo/, page.file);
    assert.match(footer, /Marktplatz 14, 4310 Mauthausen/, page.file);
    assert.match(footer, /<a href="mailto:office@equicrew\.com">office@equicrew\.com<\/a>/, page.file);
    assert.match(footer, /<a href="tel:\+436504593129">\+43 650 4593 129<\/a>/, page.file);
    assert.match(footer, /<a href="\/kontakt\/">Kontakt<\/a>/, page.file);
    assert.match(footer, /<a href="\/datenschutz\/">Datenschutz<\/a>/, page.file);
    assert.match(footer, /<a href="\/impressum\/">Impressum<\/a>/, page.file);
    assert.match(footer, /© EquiCrew FlexCo 2025/, page.file);
  }
});

test("config.js generation keeps the API base as data", () => {
  assert.equal(configScript(undefined), 'window.EQUICREW_CONFIG = {"apiBase":""};\n');
  assert.equal(
    configScript("http://localhost:8000/"),
    'window.EQUICREW_CONFIG = {"apiBase":"http://localhost:8000"};\n',
  );
  assert.ok(!configScript('";alert(1);"').includes('"";'), "value is JSON-escaped");
});

test("serve.mjs serves the pages, the generated config and a 404 page", async (t) => {
  const server = startServer({ port: 0, apiBase: "http://api.example.test" });
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const page of PAGES.slice(0, 6)) {
    const res = await fetch(base + page.path);
    assert.equal(res.status, 200, page.path);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.equal(await res.text(), read(page.file), `${page.path} serves ${page.file}`);
  }

  const config = await fetch(`${base}/js/config.js`);
  assert.equal(config.status, 200);
  assert.match(config.headers.get("content-type"), /javascript/);
  assert.equal(await config.text(), 'window.EQUICREW_CONFIG = {"apiBase":"http://api.example.test"};\n');

  const redirect = await fetch(`${base}/kontakt`, { redirect: "manual" });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "/kontakt/");

  for (const path of ["/gibt-es-nicht", "/a/b/c/", "/serve.mjs", "/package.json", "/tests/pages.test.mjs", "/%2e%2e/etc/passwd"]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 404, path);
    const body = await res.text();
    assert.equal(body, read("404.html"), `${path} shows the German 404 page`);
    assert.match(body, /<a[^>]*href="\/"/, "404 page links to Start");
  }

  const css = await fetch(`${base}/css/tokens.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);

  const font = await fetch(`${base}/fonts/font.css`);
  assert.equal(font.status, 200);
  for (const url of (await font.text()).matchAll(/url\("([^"]+)"\)/g)) {
    const res = await fetch(`${base}/fonts/${url[1]}`);
    assert.equal(res.status, 200, url[1]);
    assert.equal(res.headers.get("content-type"), "font/woff2");
    await res.arrayBuffer();
  }

  const post = await fetch(`${base}/`, { method: "POST" });
  assert.equal(post.status, 405);
});
