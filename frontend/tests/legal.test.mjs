// Content checks of the Impressum, Datenschutz and 404 pages (AC-11, AC-13, AC-22).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const main = (file) => {
  const match = read(file).match(/<main id="main"[^>]*>([\s\S]*?)<\/main>/);
  assert.ok(match, `${file}: <main id="main"> missing`);
  return match[1];
};
const todos = (html) => [...html.matchAll(/<span class="todo">[\s\S]*?<\/svg>([^<]+)<\/span>/g)].map((m) => m[1]);

test("Impressum shows the original company data and the § 25 MedienG disclosure", () => {
  const html = main("impressum/index.html");
  for (const text of [
    "EquiCrew FlexCo",
    "FlexCo",
    "Marktplatz 14",
    "4310 Mauthausen",
    "Österreich",
    'href="tel:+436504593129"',
    "+43 650 4593 129",
    'href="mailto:office@equicrew.com"',
    "FN 648043 f",
    "Wien",
    "ATU82132979",
    "Entwicklung von innovativen und nachhaltigen Produkten.",
    "Hochstöger Michael",
    "Dipl. Ing. (FH) Hinterdorfer Christian",
    "Hinterreiter Christian",
    "Offenlegung nach § 25 MedienG",
    "Medieninhaber",
    "Grundlegende Richtung der Website",
  ]) {
    assert.ok(html.includes(text), `Impressum lacks ${text}`);
  }
  const marked = todos(html).join(" | ");
  assert.match(marked, /Kammerzugehörigkeit – vom Kunden noch zu liefern/);
  assert.match(marked, /Aufsichtsbehörde – vom Kunden noch zu liefern/);
});

test("Datenschutz explains the Art. 13 items and marks every customer-supplied one", () => {
  const html = main("datenschutz/index.html");
  for (const text of [
    "Verantwortlicher",
    "Marktplatz 14, 4310 Mauthausen",
    "office@equicrew.com",
    "Vorname, Nachname, E-Mail-Adresse und Nachricht",
    "Bearbeitung der Anfrage",
    "Art. 6 Abs. 1 lit. b DSGVO",
    "Art. 6 Abs. 1 lit. f DSGVO",
    "Per E-Mail an office@equicrew.com",
    "Arbeitsspeicher",
    "höchstens 10 Minuten",
    "nicht gespeichert",
    "Server-Logs",
    "österreichischen Datenschutzbehörde",
  ]) {
    assert.ok(html.includes(text), `Datenschutz lacks ${text}`);
  }
  for (const right of ["Auskunft", "Berichtigung", "Löschung", "Einschränkung", "Datenübertragbarkeit", "Widerspruch"]) {
    assert.ok(html.includes(`<li>${right}</li>`), `right ${right} missing`);
  }
  const marked = todos(html).join(" | ");
  for (const item of ["Hosting-Anbieters", "SMTP-Dienstleisters", "Drittlandtransfer", "Log-Speicherdauer", "Aufbewahrungsdauer der E-Mails"]) {
    assert.match(marked, new RegExp(`${item}[^|]*vom Kunden noch zu liefern`), `${item} not marked`);
  }
});

test("404 page is German and links back to Start", () => {
  const html = main("404.html");
  assert.match(html, /Diese Seite gibt es nicht\./);
  assert.match(html, /<a class="btn-secondary" href="\/">Zur Startseite/);
  assert.match(html, /<h1[^>]*>Fehler 404<\/h1>/);
});
