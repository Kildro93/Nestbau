#!/usr/bin/env node
/**
 * Holt den aktuellen Stand von GitHub und prueft sofort, ob die App
 * danach noch gesund ist.
 *
 *   node scripts/update.mjs            pull, dann Health-Check und Tests
 *   node scripts/update.mjs --check    nur nachsehen, ob es Neues gibt
 *
 * Bricht ab, statt lokale Aenderungen zu ueberschreiben.
 */
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NUR_PRUEFEN = process.argv.includes("--check");

async function git(...args) {
  const { stdout } = await run("git", args, { cwd: ROOT, shell: false, timeout: 120000 });
  return stdout.trim();
}

async function main() {
  console.log("\n  Nestbau aktualisieren\n  " + "=".repeat(56) + "\n");

  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  const vorher = await git("rev-parse", "--short", "HEAD");
  console.log(`  Branch:  ${branch}`);
  console.log(`  Stand:   ${vorher}`);

  // Lokale Aenderungen nie stillschweigend wegwerfen.
  const schmutzig = await git("status", "--porcelain");
  if (schmutzig) {
    console.log(`\n  Lokale Aenderungen vorhanden:\n`);
    for (const z of schmutzig.split("\n").slice(0, 15)) console.log("    " + z);
    if (!NUR_PRUEFEN) {
      console.log(`\n  Update abgebrochen -- sonst gehen diese Aenderungen verloren.`);
      console.log(`  Erst committen oder wegstashen:\n`);
      console.log(`    git stash push -u -m "vor update"\n`);
      process.exit(1);
    }
  }

  console.log("\n  Hole von origin ...");
  await git("fetch", "origin", "--prune");

  const hinter = await git("rev-list", "--count", `HEAD..origin/${branch}`).catch(() => "0");
  const voraus = await git("rev-list", "--count", `origin/${branch}..HEAD`).catch(() => "0");

  if (hinter === "0") {
    console.log(`  Bereits aktuell.` + (voraus !== "0" ? ` (${voraus} eigene Commits noch nicht gepusht)` : ""));
    if (NUR_PRUEFEN) { console.log(""); return; }
  } else {
    console.log(`  ${hinter} neue Commit(s) auf origin/${branch}:\n`);
    const log = await git("log", "--oneline", "--no-decorate", `HEAD..origin/${branch}`);
    for (const z of log.split("\n").slice(0, 15)) console.log("    " + z);

    if (NUR_PRUEFEN) {
      console.log(`\n  Nur geprueft -- nichts geaendert. Zum Holen: npm run update\n`);
      return;
    }

    console.log("\n  Ziehe ...");
    await git("pull", "--ff-only", "origin", branch);
    const nachher = await git("rev-parse", "--short", "HEAD");
    console.log(`  Neuer Stand: ${nachher}`);

    // Abhaengigkeiten nachziehen, falls package.json sich geaendert hat.
    const geaendert = await git("diff", "--name-only", `${vorher}..${nachher}`);
    if (geaendert.includes("package.json") || geaendert.includes("package-lock.json")) {
      console.log("\n  package.json hat sich geaendert -- npm install ...");
      await run("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, shell: true, timeout: 600000 });
    }
  }

  // Nach jedem Update pruefen, ob noch alles laeuft.
  console.log("\n  Health-Check ...\n");
  try {
    const { stdout } = await run(process.execPath, [path.join(ROOT, "scripts", "health-check.mjs")],
      { cwd: ROOT, timeout: 180000 });
    console.log(stdout.split("\n").filter((z) => /OK|ROT|Pruefungen|gesund/.test(z)).join("\n"));
  } catch (e) {
    console.log(e.stdout || e.message);
    console.log("\n  Der neue Stand ist NICHT gesund. Details oben.\n");
    process.exit(1);
  }

  console.log("\n  Tests ...\n");
  try {
    const { stdout } = await run(process.execPath, ["--test", "tests/**/*.test.mjs"],
      { cwd: ROOT, shell: true, timeout: 300000 });
    const pass = (stdout.match(/# pass (\d+)/) || [])[1];
    const fail = (stdout.match(/# fail (\d+)/) || [])[1];
    console.log(`    ${pass} gruen, ${fail} rot`);
    if (fail !== "0") {
      console.log(stdout.split("\n").filter((z) => z.startsWith("not ok")).join("\n"));
      process.exit(1);
    }
  } catch (e) {
    console.log((e.stdout || "").split("\n").filter((z) => z.startsWith("not ok")).join("\n") || e.message);
    process.exit(1);
  }

  console.log("\n  Update fertig, alles gruen.\n");
}

main().catch((e) => { console.error("\n  Fehler: " + (e.stderr || e.message) + "\n"); process.exit(1); });
