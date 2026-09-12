/**
 * Unit-Tests: statische Assets der PWA.
 * Pruefen, dass Dateien existieren, syntaktisch gueltig sind und
 * untereinander konsistent referenziert werden.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT, readIndexHtml, extractInlineScripts } from "../helpers/load-app.mjs";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

test("alle Kern-Dateien der PWA sind vorhanden", () => {
  for (const f of ["index.html", "manifest.json", "sw.js", "icon.svg"]) {
    assert.ok(exists(f), `${f} fehlt im Repo-Root`);
  }
});

test("manifest.json ist gueltiges JSON mit PWA-Pflichtfeldern", () => {
  const m = JSON.parse(read("manifest.json"));
  assert.equal(typeof m.name, "string");
  assert.ok(m.name.length > 0, "name darf nicht leer sein");
  assert.equal(typeof m.start_url, "string");
  assert.ok(["standalone", "fullscreen", "minimal-ui"].includes(m.display),
    `display "${m.display}" macht die App nicht installierbar`);
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0, "mindestens ein Icon noetig");
  assert.match(m.theme_color, /^#[0-9a-f]{3,8}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{3,8}$/i);
});

test("jedes Icon aus dem Manifest existiert wirklich", () => {
  const m = JSON.parse(read("manifest.json"));
  for (const ic of m.icons) {
    const rel = ic.src.replace(/^\.?\//, "");
    assert.ok(exists(rel), `Icon "${ic.src}" ist im Manifest gelistet, fehlt aber auf der Platte`);
    assert.ok(ic.type, `Icon "${ic.src}" hat kein type-Feld`);
  }
});

test("start_url aus dem Manifest existiert", () => {
  const m = JSON.parse(read("manifest.json"));
  const rel = m.start_url.replace(/^\.?\//, "").split("?")[0] || "index.html";
  assert.ok(exists(rel), `start_url "${m.start_url}" zeigt ins Leere`);
});

test("sw.js ist syntaktisch gueltiges JavaScript", () => {
  assert.doesNotThrow(() => new vm.Script(read("sw.js"), { filename: "sw.js" }));
});

test("sw.js registriert die drei noetigen Lifecycle-Events", () => {
  const sw = read("sw.js");
  for (const ev of ["install", "activate", "fetch"]) {
    const registered = sw.includes(`addEventListener("${ev}"`) || sw.includes(`addEventListener('${ev}'`);
    assert.ok(registered, `Service Worker behandelt "${ev}" nicht -- Offline-Support unvollstaendig`);
  }
});

test("alle im Service Worker vorgecachten Assets existieren", () => {
  const sw = read("sw.js");
  const m = sw.match(/ASSETS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "ASSETS-Liste im Service Worker nicht gefunden");
  const assets = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  assert.ok(assets.length > 0, "ASSETS-Liste ist leer");
  for (const a of assets) {
    const rel = a.replace(/^\.?\//, "");
    if (rel === "" ) continue; // "./" = Verzeichnis-Root, wird auf index.html gemappt
    assert.ok(exists(rel), `Service Worker cached "${a}", die Datei existiert aber nicht`);
  }
});

test("index.html verlinkt Manifest und Icon", () => {
  const html = readIndexHtml();
  assert.match(html, /<link[^>]+rel=["']manifest["']/i, "manifest ist nicht verlinkt -- App nicht installierbar");
  assert.match(html, /<meta[^>]+name=["']viewport["']/i, "viewport-Meta fehlt -- Mobile-Darstellung bricht");
  assert.match(html, /<meta[^>]+charset=/i, "charset fehlt -- Umlaute brechen");
});

test("alle Inline-Skripte in index.html sind syntaktisch gueltig", () => {
  const scripts = extractInlineScripts();
  assert.ok(scripts.length > 0, "keine Inline-Skripte gefunden -- Extraktion kaputt?");
  scripts.forEach((s, i) => {
    assert.doesNotThrow(
      () => new vm.Script(s.code, { filename: `index.html:inline-script-${i}` }),
      `Inline-Skript #${i} hat einen Syntaxfehler`
    );
  });
});

test("der eingebettete Start-State ist gueltiges JSON", () => {
  const html = readIndexHtml();
  const m = html.match(/<script id="state-data"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, "state-data Block nicht gefunden");
  const state = JSON.parse(m[1]);
  for (const key of ["people", "lists", "events", "subscriptions", "recipes"]) {
    assert.ok(key in state, `Start-State hat kein Feld "${key}"`);
  }
  assert.ok(Array.isArray(state.lists) && state.lists.length > 0, "Start-State hat keine Listen");
});

test("index.html enthaelt keine externen Ressourcen (App muss offline laufen)", () => {
  const html = readIndexHtml();
  const external = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)]
    .map((m) => m[1])
    // Namespace-URLs in SVG sind keine Netzwerkabrufe.
    .filter((u) => !u.startsWith("http://www.w3.org/"));
  assert.deepEqual(external, [], "externe Ressourcen brechen den Offline-Betrieb");
});
