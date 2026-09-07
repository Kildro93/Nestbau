#!/usr/bin/env node
/**
 * Security-Check vor dem Play-Store-Release.
 *
 *   node scripts/security-check.mjs [--json]
 *
 * Prueft die Klassen von Problemen, die bei einer clientseitigen PWA
 * ueberhaupt auftreten koennen: eingecheckte Geheimnisse, XSS ueber
 * innerHTML, unsichere externe Aufrufe, fehlende Transportsicherheit.
 * Exit-Code 1, sobald ein Befund der Stufe "hoch" vorliegt.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const befunde = [];

function melde(stufe, regel, text, ort) {
  befunde.push({ stufe, regel, text, ort });
}

/** Dateien, die zum ausgelieferten Produkt gehoeren (nicht Tests/Tooling). */
const AUSGELIEFERT = ["index.html", "sw.js", "manifest.json", "icon.svg"];

async function lies(rel) {
  return fs.readFile(path.join(ROOT, rel), "utf8").catch(() => null);
}

/** Zeilennummer zu einem Zeichen-Offset. */
function zeileVon(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

// --- 1. Eingecheckte Geheimnisse ------------------------------------------
const SECRET_MUSTER = [
  { name: "Google-API-Key", re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "AWS Access Key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "Private Key Block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Slack-Token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: "GitHub-Token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g },
  { name: "Passwort-Zuweisung", re: /(?:password|passwort|secret|api[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/gi },
];

async function pruefeGeheimnisse() {
  for (const rel of AUSGELIEFERT) {
    const inhalt = await lies(rel);
    if (!inhalt) continue;
    for (const { name, re } of SECRET_MUSTER) {
      for (const m of inhalt.matchAll(re)) {
        melde("hoch", "secret", `${name} im ausgelieferten Code`, `${rel}:${zeileVon(inhalt, m.index)}`);
      }
    }
  }
}

// --- 2. XSS ueber innerHTML -----------------------------------------------
async function pruefeXss() {
  const html = await lies("index.html");
  if (!html) return;

  // innerHTML mit Template-Literal, das eine Variable einsetzt, ist die
  // klassische XSS-Stelle -- ausser der Wert lief vorher durch escapeHtml.
  const hatEscape = /function\s+escapeHtml/.test(html);
  if (!hatEscape) {
    melde("hoch", "xss", "kein escapeHtml() im Code -- Nutzereingaben landen ungefiltert im DOM", "index.html");
  }

  // Nur Felder, die tatsaechlich Freitext aus der Oberflaeche tragen.
  // Generische Bezeichner wie "value" oder "text" erzeugen sonst nur
  // Fehlalarme (Datumsschluessel, Uhrzeit-Ziffern) und entwerten den Report.
  const NUTZERFELDER = /\b(?:\w+\.)?(title|note|notiz|comment|kommentar|beschreibung|photo|url)\b/i;

  let escaped = 0;
  for (const m of html.matchAll(/\.innerHTML\s*=\s*([^;]{0,400});/g)) {
    const zuweisung = m[1];
    if (!/\$\{|["']\s*\+\s*[A-Za-z_$]/.test(zuweisung)) continue;
    if (/escapeHtml\s*\(/.test(zuweisung)) { escaped++; continue; }
    if (NUTZERFELDER.test(zuweisung)) {
      melde("mittel", "xss", "innerHTML mit interpoliertem Nutzerwert ohne sichtbares escapeHtml()",
        `index.html:${zeileVon(html, m.index)}`);
    }
  }
  if (escaped > 0) {
    console.log(`  Hinweis: ${escaped} innerHTML-Zuweisungen nutzen escapeHtml() korrekt.`);
  }

  // Attribut-Injection: ein Nutzerwert direkt zwischen zwei Anfuehrungszeichen
  // eines HTML-Attributs. Enthaelt der Wert selbst ein ", bricht er aus dem
  // Attribut aus -- escapeHtml() an dieser Stelle deckt das ab, ein blosser
  // String-Concat nicht. Relevant beim Import fremder Sicherungsdateien.
  for (const m of html.matchAll(/["']\s*<[a-z]+[^"']*\b(?:src|href|style|value|title)="'\s*\+\s*([A-Za-z_$][\w.$]*)/g)) {
    const ausdruck = m[1];
    if (/escapeHtml/.test(ausdruck)) continue;
    melde("niedrig", "attribut-injection",
      `"${ausdruck}" wird ungefiltert in ein HTML-Attribut geschrieben -- ein praeparierter Wert (etwa aus einer importierten Sicherung) kann aus dem Attribut ausbrechen`,
      `index.html:${zeileVon(html, m.index)}`);
  }
}

// --- 3. Gefaehrliche Konstrukte -------------------------------------------
async function pruefeKonstrukte() {
  for (const rel of AUSGELIEFERT) {
    const inhalt = await lies(rel);
    if (!inhalt) continue;

    for (const m of inhalt.matchAll(/\beval\s*\(/g)) {
      melde("hoch", "eval", "eval() im ausgelieferten Code", `${rel}:${zeileVon(inhalt, m.index)}`);
    }
    for (const m of inhalt.matchAll(/new\s+Function\s*\(/g)) {
      melde("hoch", "eval", "new Function() -- dynamische Codeausfuehrung", `${rel}:${zeileVon(inhalt, m.index)}`);
    }
    for (const m of inhalt.matchAll(/document\.write\s*\(/g)) {
      melde("mittel", "document-write", "document.write() -- blockiert Parsing und ist XSS-anfaellig",
        `${rel}:${zeileVon(inhalt, m.index)}`);
    }
    // target="_blank" ohne rel=noopener gibt der Zielseite window.opener.
    for (const m of inhalt.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/g)) {
      if (!/rel=["'][^"']*noopener/.test(m[0])) {
        melde("mittel", "tabnabbing", 'target="_blank" ohne rel="noopener" -- Reverse Tabnabbing',
          `${rel}:${zeileVon(inhalt, m.index)}`);
      }
    }
  }
}

// --- 4. Transport und externe Aufrufe -------------------------------------
async function pruefeNetzwerk() {
  for (const rel of AUSGELIEFERT) {
    const inhalt = await lies(rel);
    if (!inhalt) continue;

    for (const m of inhalt.matchAll(/http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org)[^\s"'<>]+/g)) {
      melde("hoch", "klartext", "Klartext-HTTP-Ziel -- Android blockt das ab API 28 per Default",
        `${rel}:${zeileVon(inhalt, m.index)}`);
    }
    for (const m of inhalt.matchAll(/(?:src|href)\s*=\s*["'](https:\/\/[^"']+)["']/g)) {
      if (m[1].startsWith("https://www.w3.org/")) continue;
      melde("niedrig", "extern", `externe Ressource: ${m[1]} -- bricht den Offline-Betrieb`,
        `${rel}:${zeileVon(inhalt, m.index)}`);
    }
    for (const m of inhalt.matchAll(/\bfetch\s*\(\s*["'`](https?:\/\/[^"'`]+)/g)) {
      melde("mittel", "extern", `Netzwerkaufruf nach ${m[1]} -- Datenschutzerklaerung im Store noetig`,
        `${rel}:${zeileVon(inhalt, m.index)}`);
    }
  }
}

// --- 5. Was liegt in der Auslieferung, das nicht dahin gehoert? -----------
async function pruefeAuslieferung() {
  const heikel = [".env", ".env.local", "keystore.jks", "upload-keystore.jks", "google-services.json",
    "service-account.json", "id_rsa", ".npmrc"];
  for (const f of heikel) {
    const da = await fs.access(path.join(ROOT, f)).then(() => true, () => false);
    if (da) {
      const gitignored = await istGitignored(f);
      melde(gitignored ? "niedrig" : "hoch", "artefakt",
        `${f} liegt im Repo-Verzeichnis${gitignored ? " (immerhin gitignored)" : " und ist NICHT gitignored"}`, f);
    }
  }
}

async function istGitignored(datei) {
  const gi = await lies(".gitignore");
  if (!gi) return false;
  return gi.split("\n").some((z) => z.trim() && !z.startsWith("#") &&
    (z.trim() === datei || datei.endsWith(z.trim().replace(/^\*/, ""))));
}

// --- 6. localStorage: was speichert die App? ------------------------------
async function pruefeSpeicher() {
  const html = await lies("index.html");
  if (!html) return;
  const keys = [...html.matchAll(/localStorage\.(?:setItem|getItem)\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const eindeutig = [...new Set(keys)];
  if (eindeutig.length) {
    console.log(`  Hinweis: App speichert unter ${eindeutig.map((k) => `"${k}"`).join(", ")} im localStorage.`);
    console.log(`           Diese Daten sind unverschluesselt und muessen in der Play-Datensicherheitserklaerung stehen.`);
  }
}

// --- Ausgabe --------------------------------------------------------------
async function main() {
  console.log("\n  Security-Check Nestbau\n" + "  " + "-".repeat(50));

  await pruefeGeheimnisse();
  await pruefeXss();
  await pruefeKonstrukte();
  await pruefeNetzwerk();
  await pruefeAuslieferung();
  await pruefeSpeicher();

  const nachStufe = (s) => befunde.filter((b) => b.stufe === s);
  const hoch = nachStufe("hoch"), mittel = nachStufe("mittel"), niedrig = nachStufe("niedrig");

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ befunde, zusammenfassung: { hoch: hoch.length, mittel: mittel.length, niedrig: niedrig.length } }, null, 2));
  } else {
    for (const [label, liste] of [["HOCH", hoch], ["MITTEL", mittel], ["NIEDRIG", niedrig]]) {
      if (!liste.length) continue;
      console.log(`\n  ${label} (${liste.length})`);
      for (const b of liste) console.log(`    [${b.regel}] ${b.text}\n        ${b.ort}`);
    }
    console.log(`\n  ${"-".repeat(50)}`);
    console.log(`  Ergebnis: ${hoch.length} hoch, ${mittel.length} mittel, ${niedrig.length} niedrig`);
    console.log(hoch.length === 0
      ? "  Keine blockierenden Sicherheitsbefunde -- Play-Store-tauglich.\n"
      : "  BLOCKIEREND: Befunde der Stufe hoch vor dem Release beheben.\n");
  }

  process.exitCode = hoch.length > 0 ? 1 : 0;
}

main().catch((e) => { console.error("Fehler: " + e.stack); process.exit(2); });
