#!/usr/bin/env node
/**
 * Health-Check: laeuft in Sekunden und sagt, ob die App gesund ist.
 *
 *   node scripts/health-check.mjs            statische Pruefungen + jsdom-Boot
 *   node scripts/health-check.mjs --live     zusaetzlich echter Chromium
 *   node scripts/health-check.mjs --json     maschinenlesbar nach reports/
 *
 * Exit-Code 0 = gesund, 1 = mindestens eine Pruefung rot.
 */
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadApp, realErrors } from "../tests/helpers/load-app.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");
const JSON_OUT = process.argv.includes("--json");

const checks = [];

/** Fuehrt eine Pruefung aus und haelt Ergebnis + Dauer fest. */
async function check(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    checks.push({ name, status: "ok", detail: detail || "", ms: Math.round(performance.now() - t0) });
  } catch (e) {
    checks.push({ name, status: "fehler", detail: e.message, ms: Math.round(performance.now() - t0) });
  }
}

async function lies(rel) {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

function portFrei(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => { s.destroy(); resolve(false); });
    s.on("error", () => resolve(true));
    s.setTimeout(800, () => { s.destroy(); resolve(true); });
  });
}

// --- Pruefungen -----------------------------------------------------------

async function main() {
  console.log("\n  Health-Check Nestbau\n  " + "=".repeat(56));

  await check("Kern-Dateien vorhanden", async () => {
    const noetig = ["index.html", "manifest.json", "sw.js", "icon.svg"];
    const fehlend = [];
    for (const f of noetig) {
      await fs.access(path.join(ROOT, f)).catch(() => fehlend.push(f));
    }
    if (fehlend.length) throw new Error("fehlt: " + fehlend.join(", "));
    return noetig.length + " Dateien";
  });

  await check("manifest.json gueltig", async () => {
    const m = JSON.parse(await lies("manifest.json"));
    if (!m.name || !m.start_url || !m.icons?.length) throw new Error("Pflichtfelder fehlen");
    // Alle referenzierten Icons muessen existieren, sonst bricht die Installation.
    for (const ic of m.icons) {
      const rel = ic.src.replace(/^\.\//, "");
      await fs.access(path.join(ROOT, rel)).catch(() => {
        throw new Error(`Icon ${ic.src} fehlt auf der Platte`);
      });
    }
    return `${m.icons.length} Icons, display=${m.display}`;
  });

  await check("Service Worker vollstaendig", async () => {
    const sw = await lies("sw.js");
    const fehlend = ["install", "activate", "fetch"].filter(
      (ev) => !sw.includes(`addEventListener("${ev}"`) && !sw.includes(`addEventListener('${ev}'`)
    );
    if (fehlend.length) throw new Error("Events fehlen: " + fehlend.join(", "));
    return "install, activate, fetch";
  });

  await check("keine externen Ressourcen (offline-faehig)", async () => {
    const html = await lies("index.html");
    const extern = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/g)]
      .map((m) => m[1]).filter((u) => !u.startsWith("http://www.w3.org/"));
    if (extern.length) throw new Error(extern.length + " externe: " + extern.slice(0, 3).join(", "));
    return "keine";
  });

  await check("App bootet in jsdom", async () => {
    const app = await loadApp();
    try {
      const fehler = realErrors(app.errors);
      if (fehler.length) throw new Error(fehler.length + " Fehler: " + fehler[0].message);
      const views = app.document.querySelectorAll(".view").length;
      const aktiv = app.document.querySelectorAll(".view.active").length;
      if (views !== 5) throw new Error(`${views} Views statt 5`);
      if (aktiv !== 1) throw new Error(`${aktiv} Views gleichzeitig aktiv`);
      return `${views} Views, Startansicht steht`;
    } finally { app.teardown(); }
  });

  await check("alle fuenf Tabs schalten fehlerfrei um", async () => {
    const app = await loadApp();
    try {
      for (const ziel of ["aufgaben", "kalender", "finanzen", "kochbuch", "heute"]) {
        const btn = app.document.querySelector(`.tab-btn[data-view="${ziel}"]`);
        if (!btn) throw new Error(`Tab "${ziel}" fehlt`);
        btn.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
        const nunAktiv = app.document.querySelector(".view.active")?.id;
        if (nunAktiv !== `view-${ziel}`) throw new Error(`Tab "${ziel}" schaltet auf "${nunAktiv}"`);
      }
      const fehler = realErrors(app.errors);
      if (fehler.length) throw new Error(fehler[0].message);
      return "5/5";
    } finally { app.teardown(); }
  });

  await check("Aufgabe anlegen und speichern", async () => {
    const app = await loadApp();
    try {
      app.document.querySelector('.tab-btn[data-view="aufgaben"]')
        .dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
      app.document.getElementById("open-task-overlay")
        .dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
      const feld = app.document.getElementById("task-title");
      feld.value = "Health-Check";
      feld.dispatchEvent(new app.window.Event("input", { bubbles: true }));
      app.document.getElementById("task-form")
        .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));

      const state = app.readState();
      const da = state?.lists.flatMap((l) => l.items || []).some((i) => i.title === "Health-Check");
      if (!da) throw new Error("Aufgabe landet nicht im localStorage");
      return "Schreiben und Persistieren OK";
    } finally { app.teardown(); }
  });

  await check("Finanz-Berechnung stimmt", async () => {
    const app = await loadApp({
      state: {
        people: { a: { name: "A", color: "flame" }, b: { name: "B", color: "teal" } },
        lists: [{ id: "l1", name: "L", kind: "todo", items: [] }], activeListId: "l1",
        events: [],
        subscriptions: [
          { id: "s1", name: "X", amount: 100, frequency: "monthly", day: 1, person: "both", category: "wohnen" },
          { id: "s2", name: "Y", amount: 120, frequency: "yearly", day: 1, month: 1, person: "both", category: "wohnen" },
        ],
        ingredients: [], ingredientCategories: [], ingredientGroups: [], recipes: [], menuPlan: {},
      },
    });
    try {
      app.document.querySelector('.tab-btn[data-view="finanzen"]')
        .dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
      // 100/Monat + 120/Jahr = 110 pro Monat, 1320 pro Jahr.
      const monat = app.document.getElementById("fin-monthly").textContent;
      const jahr = app.document.getElementById("fin-yearly").textContent;
      if (!/110/.test(monat)) throw new Error(`Monatswert "${monat}", erwartet 110`);
      if (!/1320/.test(jahr)) throw new Error(`Jahreswert "${jahr}", erwartet 1320`);
      return `${monat.trim()} / ${jahr.trim()}`;
    } finally { app.teardown(); }
  });

  await check("beschaedigter Speicher bricht die App nicht", async () => {
    const app = await loadApp();
    try {
      app.window.localStorage.setItem("nestbau-state-v1", "{kein-json");
      const zweite = await loadApp();
      try {
        if (!zweite.document.querySelector(".view.active")) throw new Error("keine Ansicht mehr");
        return "faengt kaputten State ab";
      } finally { zweite.teardown(); }
    } finally { app.teardown(); }
  });

  await check("Play-Store-Assets vorhanden", async () => {
    const noetig = [
      "assets/play/icon-512.png",
      "assets/play/feature-graphic.png",
      "assets/play/screenshots",
    ];
    const fehlend = [];
    for (const f of noetig) await fs.access(path.join(ROOT, f)).catch(() => fehlend.push(f));
    if (fehlend.length) throw new Error("fehlt: " + fehlend.join(", ") + " -- npm run playstore:assets");

    const shots = await fs.readdir(path.join(ROOT, "assets/play/screenshots"));
    const pngs = shots.filter((f) => f.endsWith(".png"));
    if (pngs.length < 2) throw new Error(`nur ${pngs.length} Screenshots, Play verlangt mindestens 2`);
    return `Icon, Feature-Graphic, ${pngs.length} Screenshots`;
  });

  if (LIVE) {
    await check("echter Browser: Boot ohne Konsolenfehler", async () => {
      const { chromium } = await import("playwright").catch(() => {
        throw new Error("playwright nicht installiert -- npm install");
      });
      const PORT = 3199;
      let server = null;
      if (await portFrei(PORT)) {
        server = spawn(process.execPath, [path.join(ROOT, "scripts", "server.mjs"), "--port", String(PORT), "--quiet"],
          { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("Server startet nicht")), 10000);
          server.stdout.on("data", (b) => { if (String(b).includes("Nestbau laeuft")) { clearTimeout(t); res(); } });
        });
      }
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const fehler = [];
        page.on("pageerror", (e) => fehler.push(String(e)));
        page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });

        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForSelector(".view.active", { timeout: 5000 });

        // Erststart: die App oeffnet den Profil-Dialog modal und blockiert alles
        // andere, bis ein Profil gewaehlt ist. Genau diesen Weg gehen wir hier --
        // er ist der erste, den jede neue Nutzerin sieht.
        const dialogOffen = await page.evaluate(
          () => document.getElementById("settings-overlay")?.style.display === "flex"
        );
        if (dialogOffen) {
          const profil = page.locator("#settings-overlay .profile-pick, #settings-overlay button").first();
          await profil.click({ timeout: 5000 });
          await page.waitForTimeout(150);
          const nochOffen = await page.evaluate(
            () => document.getElementById("settings-overlay")?.style.display === "flex"
          );
          if (nochOffen) {
            await page.click("#close-settings", { timeout: 5000 });
            await page.waitForTimeout(150);
          }
        }

        for (const t of ["aufgaben", "kalender", "finanzen", "kochbuch", "heute"]) {
          await page.click(`.tab-btn[data-view="${t}"]`, { timeout: 10000 });
          await page.waitForTimeout(80);
        }
        // Bei Fehlern einen Screenshot ablegen -- macht die Diagnose sofort moeglich.
        if (fehler.length) {
          const dir = path.join(ROOT, "reports", "screenshots");
          await fs.mkdir(dir, { recursive: true });
          const ziel = path.join(dir, `fehler-${Date.now()}.png`);
          await page.screenshot({ path: ziel, fullPage: true });
          throw new Error(`${fehler.length} Fehler (Screenshot: ${path.relative(ROOT, ziel)}): ${fehler[0]}`);
        }
        return "Chromium, 5 Tabs, keine Fehler";
      } finally {
        await browser.close();
        server?.kill();
      }
    });
  }

  // --- Ausgabe ------------------------------------------------------------
  console.log("");
  for (const c of checks) {
    const marke = c.status === "ok" ? "  OK  " : " ROT  ";
    console.log(`  ${marke} ${c.name.padEnd(42)} ${String(c.ms).padStart(5)} ms`);
    if (c.detail) console.log(`         ${c.detail}`);
  }

  const rot = checks.filter((c) => c.status !== "ok");
  console.log("\n  " + "=".repeat(56));
  console.log(`  ${checks.length - rot.length}/${checks.length} Pruefungen gruen` + (LIVE ? " (inkl. echtem Browser)" : ""));
  console.log(rot.length === 0 ? "  App ist gesund.\n" : `  ${rot.length} Pruefung(en) rot.\n`);

  if (JSON_OUT) {
    await fs.mkdir(path.join(ROOT, "reports"), { recursive: true });
    const ziel = path.join(ROOT, "reports", "health-check.json");
    await fs.writeFile(ziel, JSON.stringify({
      zeitpunkt: new Date().toISOString(), live: LIVE,
      gesund: rot.length === 0, checks,
    }, null, 2));
    console.log(`  Report: ${path.relative(ROOT, ziel)}\n`);
  }

  process.exitCode = rot.length > 0 ? 1 : 0;
}

main().catch((e) => { console.error("Fehler: " + e.stack); process.exit(2); });
