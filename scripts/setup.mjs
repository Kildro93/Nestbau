#!/usr/bin/env node
/**
 * Einmaliges Setup fuer eine frische Arbeitskopie.
 *
 *   node scripts/setup.mjs
 *
 * Prueft die Werkzeuge, holt die Abhaengigkeiten, erzeugt die Store-Assets
 * und laesst Health-Check und Tests einmal durchlaufen. Am Ende steht,
 * was funktioniert und was noch fehlt.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schritte = [];

async function schritt(name, fn, { optional = false } = {}) {
  process.stdout.write(`  ${name} ... `);
  try {
    const info = await fn();
    console.log("OK" + (info ? ` (${info})` : ""));
    schritte.push({ name, ok: true, info });
  } catch (e) {
    console.log(optional ? "uebersprungen" : "FEHLER");
    if (!optional) console.log(`      ${e.message.split("\n")[0]}`);
    schritte.push({ name, ok: optional, optional, fehler: e.message });
  }
}

async function npm(...args) {
  const { stdout, stderr } = await run("npm", args, { cwd: ROOT, shell: true, timeout: 900000 });
  return stdout || stderr;
}

async function main() {
  console.log("\n  Setup Nestbau\n  " + "=".repeat(56) + "\n");

  await schritt("Node-Version", async () => {
    const [major] = process.versions.node.split(".").map(Number);
    if (major < 20) throw new Error(`Node ${process.versions.node} -- mindestens 20 noetig`);
    return "v" + process.versions.node;
  });

  await schritt("git vorhanden", async () => {
    const { stdout } = await run("git", ["--version"], { shell: true });
    return stdout.trim();
  });

  await schritt("Abhaengigkeiten installieren", async () => {
    await npm("install", "--no-audit", "--no-fund");
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
    return Object.keys(pkg.devDependencies || {}).length + " Pakete";
  });

  await schritt("Chromium fuer Playwright", async () => {
    await run("npx", ["playwright", "install", "chromium"], { cwd: ROOT, shell: true, timeout: 900000 });
    return "installiert";
  }, { optional: true });

  await schritt("Store-Assets erzeugen", async () => {
    await run(process.execPath, [path.join(ROOT, "scripts", "generate-store-assets.mjs")],
      { cwd: ROOT, timeout: 300000 });
    const icons = await fs.readdir(path.join(ROOT, "assets", "icons"));
    return icons.length + " Icons";
  });

  await schritt("manifest.json auf die Icons zeigen lassen", async () => {
    await run(process.execPath, [path.join(ROOT, "scripts", "update-manifest-icons.mjs")], { cwd: ROOT });
    const m = JSON.parse(await fs.readFile(path.join(ROOT, "manifest.json"), "utf8"));
    return m.icons.length + " Eintraege";
  });

  await schritt("Health-Check", async () => {
    await run(process.execPath, [path.join(ROOT, "scripts", "health-check.mjs")], { cwd: ROOT, timeout: 180000 });
    return "gruen";
  });

  await schritt("Test-Suite", async () => {
    const { stdout } = await run(process.execPath,
      ["--test", "tests/**/*.test.mjs"], { cwd: ROOT, timeout: 300000, shell: true });
    const m = stdout.match(/# pass (\d+)/);
    return (m ? m[1] : "?") + " Tests gruen";
  });

  await schritt("Screenshots aufnehmen", async () => {
    await run(process.execPath, [path.join(ROOT, "scripts", "capture-screenshots.mjs")],
      { cwd: ROOT, timeout: 300000 });
    const shots = await fs.readdir(path.join(ROOT, "assets", "play", "screenshots"));
    return shots.length + " Stueck";
  }, { optional: true });

  // --- Abschluss ---------------------------------------------------------
  const kaputt = schritte.filter((s) => !s.ok);
  console.log("\n  " + "=".repeat(56));
  console.log(`  ${schritte.length - kaputt.length}/${schritte.length} Schritte erledigt\n`);

  if (kaputt.length === 0) {
    console.log("  Alles bereit. Loslegen mit:\n");
    console.log("    npm run dev        App auf http://localhost:3000");
    console.log("    npm test           Test-Suite");
    console.log("    npm run health     schneller Gesundheitscheck");
    console.log("    npm run ci         alles zusammen\n");
    console.log("  Fuer den Play Store:\n");
    console.log("    node scripts/build-twa.mjs --check\n");
  } else {
    console.log("  Offen:\n");
    for (const s of kaputt) console.log(`    - ${s.name}: ${s.fehler.split("\n")[0]}`);
    console.log("");
  }

  process.exitCode = kaputt.length > 0 ? 1 : 0;
}

main().catch((e) => { console.error("\n  Setup abgebrochen: " + e.message + "\n"); process.exit(1); });
