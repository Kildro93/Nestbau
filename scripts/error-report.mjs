#!/usr/bin/env node
/**
 * Sammelt alles, was die App gerade ueber ihren Zustand sagt, in einen
 * Bericht: Health-Check, Tests, Security, Performance, Build-Bereitschaft.
 * Bei Fehlern im echten Browser wird ein Screenshot mit abgelegt.
 *
 *   node scripts/error-report.mjs             Bericht nach reports/
 *   node scripts/error-report.mjs --quick     ohne echten Browser
 *
 * Ausgabe: reports/report-<zeitstempel>.md und reports/latest.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORTS = path.join(ROOT, "reports");
const QUICK = process.argv.includes("--quick");

/**
 * Fuehrt ein Skript aus und faengt dabei auch den Fehlerfall ein --
 * ein Bericht ueber Fehler darf nicht an Fehlern scheitern.
 */
async function fuehreAus(name, datei, args = []) {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join(ROOT, "scripts", datei), ...args],
      { cwd: ROOT, timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    return { name, exitCode: 0, ausgabe: (stdout || "") + (stderr || ""), ms: Date.now() - t0 };
  } catch (e) {
    return {
      name, exitCode: e.code ?? 1,
      ausgabe: (e.stdout || "") + (e.stderr || "") || e.message,
      ms: Date.now() - t0,
    };
  }
}

async function tests() {
  const t0 = Date.now();
  try {
    // shell:false ist wichtig -- sonst frisst die Shell das Glob-Muster
    // und der Test-Runner findet keine Dateien. Node expandiert es selbst.
    const { stdout } = await run(process.execPath, ["--test", "tests/**/*.test.mjs"],
      { cwd: ROOT, shell: false, timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    return auswerten(stdout, 0, Date.now() - t0);
  } catch (e) {
    return auswerten(e.stdout || "", e.code ?? 1, Date.now() - t0);
  }
}

function auswerten(stdout, exitCode, ms) {
  const zahl = (re) => Number((stdout.match(re) || [])[1] ?? 0);
  return {
    name: "Tests", exitCode, ms, ausgabe: stdout,
    gesamt: zahl(/# tests (\d+)/),
    gruen: zahl(/# pass (\d+)/),
    rot: zahl(/# fail (\d+)/),
    fehlgeschlagen: stdout.split("\n").filter((z) => z.startsWith("not ok")).map((z) => z.replace(/^not ok \d+ - /, "")),
  };
}

async function gitInfo() {
  const g = async (...a) => run("git", a, { cwd: ROOT }).then((r) => r.stdout.trim()).catch(() => "unbekannt");
  return {
    branch: await g("rev-parse", "--abbrev-ref", "HEAD"),
    commit: await g("rev-parse", "--short", "HEAD"),
    betreff: await g("log", "-1", "--pretty=%s"),
    datum: await g("log", "-1", "--pretty=%ci"),
    schmutzig: (await g("status", "--porcelain")).split("\n").filter(Boolean).length,
  };
}

function abschnitt(titel, r) {
  const marke = r.exitCode === 0 ? "gruen" : "ROT";
  return `### ${titel} — ${marke} (${(r.ms / 1000).toFixed(1)}s)\n\n\`\`\`\n${r.ausgabe.trim().slice(0, 6000)}\n\`\`\`\n`;
}

async function main() {
  await fs.mkdir(REPORTS, { recursive: true });
  console.log("\n  Sammle Berichte ...\n");

  const git = await gitInfo();

  const laeufe = [];
  for (const [titel, datei, args] of [
    ["Health-Check", "health-check.mjs", QUICK ? ["--json"] : ["--live", "--json"]],
    ["Security", "security-check.mjs", []],
    ["Performance", "perf-audit.mjs", ["--json"]],
    ["Play-Store-Bereitschaft", "build-twa.mjs", ["--check"]],
  ]) {
    process.stdout.write(`    ${titel} ... `);
    const r = await fuehreAus(titel, datei, args);
    console.log(r.exitCode === 0 ? "gruen" : "ROT");
    laeufe.push({ titel, ...r });
  }

  process.stdout.write("    Tests ... ");
  const t = await tests();
  console.log(`${t.gruen}/${t.gesamt} gruen`);

  const screenshots = await fs.readdir(path.join(REPORTS, "screenshots")).catch(() => []);

  const alleGruen = laeufe.every((l) => l.exitCode === 0) && t.rot === 0;
  const zeitstempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // --- Markdown ----------------------------------------------------------
  const md = `# Nestbau — Statusbericht

**Erstellt:** ${new Date().toLocaleString("de-CH")}
**Gesamtergebnis:** ${alleGruen ? "alles gruen" : "Handlungsbedarf"}

## Stand

| | |
|---|---|
| Branch | \`${git.branch}\` |
| Commit | \`${git.commit}\` — ${git.betreff} |
| Commit-Datum | ${git.datum} |
| Nicht committete Dateien | ${git.schmutzig} |
| Node | ${process.versions.node} |
| System | ${os.type()} ${os.release()} |

## Tests

${t.rot === 0
  ? `Alle **${t.gesamt}** Tests gruen.`
  : `**${t.rot}** von ${t.gesamt} Tests rot:\n\n${t.fehlgeschlagen.map((f) => `- ${f}`).join("\n")}`}

## Pruefungen

| Pruefung | Ergebnis | Dauer |
|---|---|---|
${laeufe.map((l) => `| ${l.titel} | ${l.exitCode === 0 ? "gruen" : "ROT"} | ${(l.ms / 1000).toFixed(1)}s |`).join("\n")}
| Tests | ${t.rot === 0 ? "gruen" : "ROT"} | ${(t.ms / 1000).toFixed(1)}s |

${screenshots.length ? `## Fehler-Screenshots\n\n${screenshots.map((s) => `- \`reports/screenshots/${s}\``).join("\n")}\n` : ""}
## Details

${laeufe.map((l) => abschnitt(l.titel, l)).join("\n")}

### Tests — Ausgabe

\`\`\`
${t.ausgabe.split("\n").filter((z) => /^(ok|not ok|# )/.test(z)).join("\n").slice(0, 6000)}
\`\`\`
`;

  const mdZiel = path.join(REPORTS, `report-${zeitstempel}.md`);
  await fs.writeFile(mdZiel, md, "utf8");

  const json = {
    zeitpunkt: new Date().toISOString(),
    alleGruen,
    git,
    node: process.versions.node,
    tests: { gesamt: t.gesamt, gruen: t.gruen, rot: t.rot, fehlgeschlagen: t.fehlgeschlagen },
    pruefungen: laeufe.map((l) => ({ titel: l.titel, exitCode: l.exitCode, ms: l.ms })),
    screenshots,
  };
  await fs.writeFile(path.join(REPORTS, "latest.json"), JSON.stringify(json, null, 2), "utf8");

  console.log(`\n  ${alleGruen ? "Alles gruen." : "Handlungsbedarf -- siehe Bericht."}`);
  console.log(`\n  ${path.relative(ROOT, mdZiel)}`);
  console.log(`  ${path.relative(ROOT, path.join(REPORTS, "latest.json"))}\n`);

  process.exitCode = alleGruen ? 0 : 1;
}

main().catch((e) => { console.error("Fehler: " + e.stack); process.exit(2); });
