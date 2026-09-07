/**
 * Kopiert die PWA-Dateien in www/ - das ist der webDir fuer Capacitor.
 *
 * Warum ein Kopierschritt und nicht webDir: "."? Capacitor wuerde sonst
 * node_modules/, android/ und die Build-Artefakte mit ins APK packen. www/ haelt
 * exakt das, was die App im WebView braucht - und nichts sonst.
 *
 * Am Ende prueft das Skript, ob jede lokale Datei, die index.html einbindet,
 * auch wirklich in www/ liegt. Diese Pruefung gibt es, weil genau das schon
 * schiefgegangen ist: eine neue nestbau-design.css kam ins Projekt, stand nicht
 * in FILES, und das APK haette die App ohne ihr Stylesheet ausgeliefert - ohne
 * dass irgendein Build-Schritt gemeckert haette.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "www");

// Einzeldateien und ganze Ordner, die in die App gehoeren.
const FILES = [
  "index.html",
  "manifest.json",
  "nestbau-design.css",
  "icon.svg",
  "sw.js",
  "oauth-callback.html",
  "firebase-bridge.html"
];
// assets/ enthaelt die PWA-Icons, auf die manifest.json verweist. Fehlt der
// Ordner im Build, laufen die Manifest-Icons im verpackten App-Bundle ins Leere.
const DIRS = ["js", "src", "assets"];

// nb-config.local.js zeigt auf den Firebase-Emulator (localhost) und wuerde die
// installierte App ins Leere laufen lassen. index.html faengt die fehlende Datei
// per onerror ab, deshalb bleibt sie bewusst draussen - und deshalb darf die
// Verweispruefung unten daran auch keinen Anstoss nehmen.
const EXCLUDE = new Set(["nb-config.local.js"]);
const OPTIONAL = new Set(["js/nb-config.local.js"]);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/**
 * Sammelt alle lokalen src=/href=-Ziele aus index.html. Absolute Adressen
 * (https://, //cdn, data:) sind fremde Ressourcen und werden uebergangen.
 */
function referencedFiles(html) {
  // Inline-Skripte zuerst entfernen: index.html baut dort <img src="..."> per
  // String-Verkettung zusammen, was sonst als Dateiverweis durchginge.
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, "");

  const refs = new Set();
  const pattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(markup)) !== null) {
    const ref = match[1].trim();
    if (/^([a-z]+:|\/\/|#)/i.test(ref)) continue;
    refs.add(ref.replace(/^\.\//, "").split(/[?#]/)[0]);
  }
  return [...refs];
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let count = 0;
for (const file of FILES) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) {
    console.warn(`[build-web] uebersprungen (fehlt): ${file}`);
    continue;
  }
  fs.copyFileSync(src, path.join(OUT, file));
  count++;
}
for (const dir of DIRS) {
  const src = path.join(ROOT, dir);
  if (!fs.existsSync(src)) continue;
  copyDir(src, path.join(OUT, dir));
  count += fs.readdirSync(path.join(OUT, dir)).length;
}

// Gegenprobe: bindet index.html etwas ein, das nicht mitkopiert wurde?
const missing = referencedFiles(fs.readFileSync(path.join(OUT, "index.html"), "utf8"))
  .filter((ref) => !OPTIONAL.has(ref) && !fs.existsSync(path.join(OUT, ref)));

if (missing.length) {
  console.error("[build-web] index.html bindet Dateien ein, die nicht in www/ liegen:");
  for (const ref of missing) console.error(`  - ${ref}`);
  console.error("[build-web] In FILES bzw. DIRS in dieser Datei ergaenzen.");
  process.exit(1);
}

console.log(`[build-web] ${count} Dateien nach www/ kopiert, alle Verweise aufgeloest.`);
