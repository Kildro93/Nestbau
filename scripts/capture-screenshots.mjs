#!/usr/bin/env node
/**
 * Erzeugt die Play-Store-Screenshots aus der echten laufenden App.
 *
 *   node scripts/capture-screenshots.mjs [--port 3100] [--dark]
 *
 * Play verlangt mindestens 2 Phone-Screenshots, 16:9 oder 9:16,
 * kuerzere Kante mindestens 320 px, laengere hoechstens 3840 px.
 * Wir liefern 1080x1920 -- das gaengige Format, das Play unveraendert uebernimmt.
 *
 * Startet den Dev-Server selbst, falls auf dem Port noch keiner laeuft.
 */
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "play", "screenshots");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(arg("--port", 3100));
const DARK = process.argv.includes("--dark");
const BASE = `http://127.0.0.1:${PORT}`;

// Play-Store-Format. deviceScaleFactor 3 auf 360x640 ergibt exakt 1080x1920.
const VIEWPORT = { width: 360, height: 640 };
const SCALE = 3;

/** Realistische Demo-Daten -- keine echten Personendaten im Store-Listing. */
function demoState() {
  const heute = new Date();
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plus = (n) => { const d = new Date(heute); d.setDate(d.getDate() + n); return key(d); };

  return {
    people: { a: { name: "Lena", color: "teal" }, b: { name: "Jonas", color: "flame" } },
    lists: [
      { id: "l-aufgaben", name: "Aufgaben", kind: "todo", items: [
        { id: "t1", title: "Wäsche aufhängen", done: false, assignee: "a", date: key(heute) },
        { id: "t2", title: "Fenster putzen", done: false, assignee: "b", date: key(heute) },
        { id: "t3", title: "Rechnung Krankenkasse", done: false, assignee: "both", date: plus(2) },
        { id: "t4", title: "Balkonpflanzen giessen", done: true, assignee: "a", date: key(heute) },
        { id: "t5", title: "Altglas wegbringen", done: false, assignee: "b", date: plus(1) },
      ] },
      { id: "l-einkaufen", name: "Einkäufe", kind: "shopping", items: [
        { id: "s1", title: "Milch", done: false, assignee: "both" },
        { id: "s2", title: "Vollkornbrot", done: false, assignee: "both" },
        { id: "s3", title: "Tomaten", done: true, assignee: "a" },
      ] },
    ],
    activeListId: "l-aufgaben",
    events: [
      { id: "e1", title: "Zahnarzt", date: key(heute), start: "14:30", end: "15:15", assignee: "a", visibility: "both" },
      { id: "e2", title: "Abendessen bei Mama", date: plus(1), start: "18:00", end: "21:00", assignee: "both", visibility: "both" },
      { id: "e3", title: "Yoga", date: plus(3), start: "19:00", end: "20:00", assignee: "b", visibility: "both" },
    ],
    subscriptions: [
      { id: "a1", name: "Krankenkasse", amount: 412.5, frequency: "monthly", day: 1, person: "a", category: "versicherung" },
      { id: "a2", name: "Wohnungsmiete", amount: 1780, frequency: "monthly", day: 1, person: "both", category: "wohnen" },
      { id: "a3", name: "Handyabo", amount: 39.9, frequency: "monthly", day: 15, person: "b", category: "kommunikation" },
      { id: "a4", name: "Serafe", amount: 335, frequency: "yearly", day: 1, month: 3, person: "both", category: "wohnen" },
      { id: "a5", name: "Streaming", amount: 24.9, frequency: "monthly", day: 8, person: "both", category: "unterhaltung" },
    ],
    ingredients: [], ingredientCategories: [], ingredientGroups: [], recipes: [], menuPlan: {},
  };
}

function portBelegt(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  let server = null;
  if (!(await portBelegt(PORT))) {
    console.log(`  Kein Server auf ${PORT} -- starte einen.`);
    server = spawn(process.execPath, [path.join(ROOT, "scripts", "server.mjs"), "--port", String(PORT), "--quiet"],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("Server startet nicht")), 10000);
      server.stdout.on("data", (b) => { if (String(b).includes("Nestbau laeuft")) { clearTimeout(t); res(); } });
    });
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices["Pixel 5"],
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: DARK ? "dark" : "light",
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
  });

  // Konsolenfehler mitschneiden: ein Screenshot-Lauf ist auch ein Smoke-Test.
  const fehler = [];
  ctx.on("weberror", (e) => fehler.push(String(e.error())));

  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });
  page.on("pageerror", (e) => fehler.push(String(e)));

  // State vor dem ersten Rendern setzen, sonst oeffnet die App den Profil-Dialog.
  await page.addInitScript((s) => {
    localStorage.setItem("nestbau-state-v1", JSON.stringify(s));
    localStorage.setItem("nestbau-active-profile", "a");
  }, demoState());

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForSelector(".view.active", { timeout: 5000 });

  const suffix = DARK ? "-dark" : "";
  const aufnahmen = [
    { tab: "heute", name: `01-heute${suffix}.png` },
    { tab: "aufgaben", name: `02-aufgaben${suffix}.png` },
    { tab: "kalender", name: `03-kalender${suffix}.png` },
    { tab: "finanzen", name: `04-finanzen${suffix}.png` },
    { tab: "kochbuch", name: `05-kochbuch${suffix}.png` },
  ];

  console.log(`\n  Screenshots (${VIEWPORT.width * SCALE}x${VIEWPORT.height * SCALE}, ${DARK ? "dunkel" : "hell"})\n`);

  for (const a of aufnahmen) {
    await page.click(`.tab-btn[data-view="${a.tab}"]`);
    // Der Wechsel rendert synchron; ein kurzer Moment fuer Schrift und Layout.
    await page.waitForTimeout(250);
    const ziel = path.join(OUT, a.name);
    await page.screenshot({ path: ziel });
    const { size } = await fs.stat(ziel);
    console.log(`    ${a.name.padEnd(24)} ${(size / 1024).toFixed(1).padStart(7)} KB`);
  }

  await browser.close();
  server?.kill();

  if (fehler.length) {
    console.log(`\n  ACHTUNG: ${fehler.length} Konsolenfehler waehrend der Aufnahme:`);
    for (const f of [...new Set(fehler)].slice(0, 10)) console.log("    - " + f);
    process.exitCode = 1;
  } else {
    console.log(`\n  Keine Konsolenfehler im echten Browser.`);
  }

  console.log(`\n  Ablage: ${path.relative(ROOT, OUT)}`);
  console.log(`  Play verlangt mindestens 2 Phone-Screenshots -- ${aufnahmen.length} erzeugt.\n`);
}

main().catch((e) => { console.error("\n  Fehler: " + e.message + "\n"); process.exit(1); });
