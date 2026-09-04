/**
 * Kopiert die PWA-Dateien in www/ - das ist der webDir fuer Capacitor.
 *
 * Warum ein Kopierschritt und nicht webDir: "."? Capacitor wuerde sonst
 * node_modules/, android/ und die Build-Artefakte mit ins APK packen. www/ haelt
 * exakt das, was die App im WebView braucht - und nichts sonst.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "www");

// Einzeldateien und ganze Ordner, die in die App gehoeren.
const FILES = [
  "index.html",
  "manifest.json",
  "icon.svg",
  "sw.js",
  "oauth-callback.html",
  "firebase-bridge.html"
];
const DIRS = ["js", "src"];

// nb-config.local.js zeigt auf den Firebase-Emulator (localhost) und wuerde die
// installierte App ins Leere laufen lassen. index.html faengt die fehlende Datei
// per onerror ab, deshalb bleibt sie bewusst draussen.
const EXCLUDE = new Set(["nb-config.local.js"]);

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

console.log(`[build-web] ${count} Dateien nach www/ kopiert.`);
