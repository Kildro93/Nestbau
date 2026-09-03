#!/usr/bin/env node
/**
 * Performance-Audit der ausgelieferten PWA.
 *
 *   node scripts/perf-audit.mjs [--json]
 *
 * Misst, was bei einer Single-File-App tatsaechlich zaehlt: Uebertragungs-
 * groesse (roh und gzip), Boot-Zeit bis zur ersten gerenderten Ansicht,
 * Renderdauer je Tab und Speicherbedarf des State.
 * Exit-Code 1, wenn ein Budget gerissen wird.
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadApp, realErrors } from "../tests/helpers/load-app.mjs";

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Budgets. Die Werte orientieren sich an dem, was eine Offline-First-PWA
 * auf einem Mittelklasse-Android in unter zwei Sekunden laedt.
 */
const BUDGETS = {
  htmlGzipKB: 60,      // uebertragene Groesse der App
  gesamtGzipKB: 90,    // alles, was der Service Worker vorcacht
  bootMs: 1500,        // bis die erste Ansicht steht (jsdom, kein echter Browser)
  tabWechselMs: 120,   // Renderdauer pro Tab
};

const ergebnisse = [];
const verstoesse = [];

function pruefe(name, wert, budget, einheit) {
  const ok = wert <= budget;
  ergebnisse.push({ name, wert, budget, einheit, ok });
  if (!ok) verstoesse.push(`${name}: ${wert}${einheit} > Budget ${budget}${einheit}`);
  return ok;
}

async function groessen() {
  const dateien = ["index.html", "manifest.json", "sw.js", "icon.svg"];
  let rohGesamt = 0, gzipGesamt = 0;
  const tabelle = [];

  for (const f of dateien) {
    const buf = await fs.readFile(path.join(ROOT, f));
    const gz = await gzip(buf, { level: 9 });
    const br = await brotli(buf);
    rohGesamt += buf.length;
    gzipGesamt += gz.length;
    tabelle.push({
      datei: f,
      rohKB: +(buf.length / 1024).toFixed(1),
      gzipKB: +(gz.length / 1024).toFixed(1),
      brotliKB: +(br.length / 1024).toFixed(1),
    });
  }

  console.log("\n  Uebertragungsgroessen\n  " + "-".repeat(56));
  console.log("    " + "Datei".padEnd(18) + "roh".padStart(10) + "gzip".padStart(10) + "brotli".padStart(10));
  for (const r of tabelle) {
    console.log("    " + r.datei.padEnd(18) +
      `${r.rohKB} KB`.padStart(10) + `${r.gzipKB} KB`.padStart(10) + `${r.brotliKB} KB`.padStart(10));
  }
  console.log("    " + "-".repeat(48));
  console.log("    " + "gesamt".padEnd(18) +
    `${(rohGesamt / 1024).toFixed(1)} KB`.padStart(10) + `${(gzipGesamt / 1024).toFixed(1)} KB`.padStart(10));

  const html = tabelle.find((t) => t.datei === "index.html");
  pruefe("index.html gzip", html.gzipKB, BUDGETS.htmlGzipKB, " KB");
  pruefe("Auslieferung gesamt gzip", +(gzipGesamt / 1024).toFixed(1), BUDGETS.gesamtGzipKB, " KB");

  return { tabelle, rohGesamt, gzipGesamt };
}

async function bootzeit() {
  console.log("\n  Boot und Rendering\n  " + "-".repeat(56));

  // Drei Laeufe, der Median zaehlt -- der erste Lauf enthaelt JIT-Aufwaermung.
  const laeufe = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const app = await loadApp();
    const t1 = performance.now();
    laeufe.push(t1 - t0);
    if (i === 2) {
      const fehler = realErrors(app.errors);
      if (fehler.length) console.log(`    WARNUNG: ${fehler.length} Fehler beim Boot`);
    }
    app.teardown();
  }
  laeufe.sort((a, b) => a - b);
  const median = Math.round(laeufe[1]);
  console.log(`    Boot bis erste Ansicht      ${String(median).padStart(6)} ms   (Median aus 3 Laeufen)`);
  pruefe("Bootzeit", median, BUDGETS.bootMs, " ms");

  return median;
}

async function tabWechsel() {
  const app = await loadApp();
  const zeiten = {};
  try {
    for (const ziel of ["aufgaben", "kalender", "finanzen", "kochbuch", "heute"]) {
      const btn = app.document.querySelector(`.tab-btn[data-view="${ziel}"]`);
      const t0 = performance.now();
      btn.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
      const t1 = performance.now();
      zeiten[ziel] = Math.round(t1 - t0);
      console.log(`    Tab "${ziel}"`.padEnd(32) + String(zeiten[ziel]).padStart(6) + " ms");
    }
    const langsamster = Math.max(...Object.values(zeiten));
    pruefe("langsamster Tab-Wechsel", langsamster, BUDGETS.tabWechselMs, " ms");
  } finally {
    app.teardown();
  }
  return zeiten;
}

async function speicher() {
  console.log("\n  Speicher\n  " + "-".repeat(56));
  const app = await loadApp();
  try {
    // Realistische Last: 200 Aufgaben, 50 Termine, 30 Abos.
    const gross = {
      people: { a: { name: "Ich", color: "flame" }, b: { name: "Partnerin", color: "teal" } },
      lists: [{
        id: "l-1", name: "Last", kind: "todo",
        items: Array.from({ length: 200 }, (_, i) => ({ id: "i" + i, title: "Aufgabe " + i, done: i % 3 === 0, assignee: "a" })),
      }],
      activeListId: "l-1",
      events: Array.from({ length: 50 }, (_, i) => ({ id: "e" + i, title: "Termin " + i, date: "2026-09-" + String((i % 28) + 1).padStart(2, "0") })),
      subscriptions: Array.from({ length: 30 }, (_, i) => ({ id: "s" + i, name: "Abo " + i, amount: 9.9, frequency: "monthly", day: 1, person: "a" })),
      ingredients: [], ingredientCategories: [], ingredientGroups: [], recipes: [], menuPlan: {},
    };
    const json = JSON.stringify(gross);
    console.log(`    State bei 200 Aufgaben      ${String((json.length / 1024).toFixed(1)).padStart(6)} KB`);
    console.log(`    localStorage-Limit                5120 KB   (5 MB pro Origin)`);
    console.log(`    Auslastung                  ${String(((json.length / 1024 / 5120) * 100).toFixed(2)).padStart(6)} %`);

    // Rendert die App diese Last noch fluessig?
    const belastet = await loadApp({ state: gross });
    const t0 = performance.now();
    belastet.document.querySelector('.tab-btn[data-view="aufgaben"]')
      .dispatchEvent(new belastet.window.MouseEvent("click", { bubbles: true }));
    const dauer = Math.round(performance.now() - t0);
    console.log(`    Rendern von 200 Aufgaben    ${String(dauer).padStart(6)} ms`);
    pruefe("Rendern unter Last", dauer, 400, " ms");
    belastet.teardown();

    return { stateKB: +(json.length / 1024).toFixed(1), renderMs: dauer };
  } finally {
    app.teardown();
  }
}

async function main() {
  console.log("\n  Performance-Audit Nestbau");

  const g = await groessen();
  const boot = await bootzeit();
  const tabs = await tabWechsel();
  const sp = await speicher();

  console.log("\n  Budgets\n  " + "-".repeat(56));
  for (const r of ergebnisse) {
    console.log(`    ${r.ok ? "OK  " : "RISS"}  ${r.name.padEnd(30)} ${String(r.wert).padStart(7)}${r.einheit}  / ${r.budget}${r.einheit}`);
  }

  console.log("\n  " + "-".repeat(56));
  if (verstoesse.length === 0) {
    console.log("  Alle Budgets eingehalten.\n");
  } else {
    console.log(`  ${verstoesse.length} Budget(s) gerissen:`);
    for (const v of verstoesse) console.log("    - " + v);
    console.log("");
  }

  if (process.argv.includes("--json")) {
    await fs.mkdir(path.join(ROOT, "reports"), { recursive: true });
    const ziel = path.join(ROOT, "reports", "perf-audit.json");
    await fs.writeFile(ziel, JSON.stringify({
      zeitpunkt: new Date().toISOString(),
      groessen: g.tabelle, bootMs: boot, tabWechselMs: tabs, speicher: sp,
      budgets: ergebnisse, verstoesse,
    }, null, 2));
    console.log(`  Report: ${path.relative(ROOT, ziel)}\n`);
  }

  process.exitCode = verstoesse.length > 0 ? 1 : 0;
}

main().catch((e) => { console.error("Fehler: " + e.stack); process.exit(2); });
