/**
 * Unit-Tests: DOM-Struktur und Referenz-Integritaet.
 * Faengt die haeufigste Fehlerklasse dieser Single-File-App:
 * das JS greift per getElementById auf ein Element zu, das im Markup
 * umbenannt oder geloescht wurde -- was zur Laufzeit still zu null wird.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractInlineScripts } from "../helpers/load-app.mjs";

const html = readIndexHtml();

/** Alle im Markup vergebenen id-Attribute. */
function markupIds(source) {
  return new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

/** Alle per getElementById("x") im JS abgefragten IDs. */
function referencedIds(source) {
  const ids = new Set();
  for (const m of source.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) ids.add(m[1]);
  for (const m of source.matchAll(/querySelector\(\s*["']#([A-Za-z0-9_-]+)["']\s*\)/g)) ids.add(m[1]);
  return ids;
}

test("die fuenf Haupt-Views sind im Markup vorhanden", () => {
  for (const view of ["heute", "aufgaben", "kalender", "finanzen", "kochbuch"]) {
    assert.ok(html.includes(`id="view-${view}"`), `View "${view}" fehlt`);
  }
});

test("zu jedem Tab-Button gibt es genau eine passende View", () => {
  const tabs = [...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(tabs.length, 5, `erwartet 5 Tabs, gefunden ${tabs.length}: ${tabs}`);
  const ids = markupIds(html);
  for (const t of tabs) {
    assert.ok(ids.has(`view-${t}`), `Tab "${t}" zeigt auf View "view-${t}", die es nicht gibt`);
  }
});

test("keine doppelt vergebenen id-Attribute", () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Map();
  const dupes = [];
  for (const id of all) {
    if (seen.has(id)) dupes.push(id);
    seen.set(id, true);
  }
  assert.deepEqual([...new Set(dupes)], [],
    "doppelte IDs -- getElementById trifft dann willkuerlich das erste Element");
});

test("jede im JS referenzierte Element-ID existiert auch im Markup", () => {
  const ids = markupIds(html);
  const js = extractInlineScripts(html).map((s) => s.code).join("\n");
  const missing = [...referencedIds(js)].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [],
    "das JS greift auf Elemente zu, die es im Markup nicht gibt -- stille null-Referenzen zur Laufzeit");
});

test("alle Formulare mit submit-Handler haben eine id", () => {
  const forms = [...html.matchAll(/<form([^>]*)>/g)].map((m) => m[1]);
  const ohneId = forms.filter((attrs) => !/\sid=/.test(attrs));
  assert.deepEqual(ohneId, [], "Formular ohne id laesst sich vom JS nicht anbinden");
});

test("jedes required-Input steckt in einem Formular", () => {
  // Grobe, aber wirksame Pruefung: required ausserhalb von <form> wird nie validiert.
  const formBlocks = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]).join("\n");
  const alleRequired = (html.match(/\srequired[\s>]/g) || []).length;
  const inFormular = (formBlocks.match(/\srequired[\s>]/g) || []).length;
  assert.equal(alleRequired, inFormular,
    `${alleRequired - inFormular} required-Felder liegen ausserhalb eines <form> und werden nie geprueft`);
});

test("jedes Overlay hat einen Schliessen-Button", () => {
  // Overlay-Bloecke aus dem Markup schneiden und darin nach einem Close-Control suchen.
  // Die IDs folgen keiner einheitlichen Konvention (close-settings, clock-close, ...),
  // deshalb wird der Block-Inhalt geprueft, nicht der Name.
  const blocks = [...html.matchAll(/<div class="overlay"[^>]*id="([^"]+)"[\s\S]*?<div class="overlay-head">([\s\S]*?)<\/div>/g)];
  assert.ok(blocks.length > 0, "keine Overlays gefunden");
  for (const [, id, head] of blocks) {
    const hatClose = /aria-label="Schliessen"/.test(head) || /id="[^"]*close[^"]*"/i.test(head);
    assert.ok(hatClose, `Overlay "${id}" hat keinen Schliessen-Button im Kopf -- Sackgasse fuer Nutzer`);
  }
});

test("interaktive Icon-Buttons haben ein aria-label", () => {
  const iconBtns = [...html.matchAll(/<button class="[^"]*icon-btn[^"]*"([^>]*)>/g)].map((m) => m[1]);
  const ohneLabel = iconBtns.filter((a) => !/aria-label=/.test(a));
  assert.equal(ohneLabel.length, 0,
    `${ohneLabel.length} Icon-Buttons ohne aria-label -- fuer Screenreader unbenannt`);
});

test("die Sprache ist am html-Element gesetzt", () => {
  assert.match(html, /<html[^>]+lang="de"/i, 'lang="de" fehlt -- Screenreader liest englisch vor');
});
