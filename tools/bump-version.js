/**
 * Hebt die App-Version an. Details und Regeln: VERSIONING.md
 *
 *   node tools/bump-version.js patch|minor|major
 *   node tools/bump-version.js 2.5.0
 *
 * Der versionCode steigt dabei immer um eins - er ist eine reine Zaehlnummer und
 * darf bei Google Play nie zweimal vorkommen, egal wie gross der Sprung im
 * versionName ausfaellt.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VERSION_FILE = path.join(ROOT, "android", "version.properties");
const PKG_FILE = path.join(ROOT, "package.json");

const arg = process.argv[2];
if (!arg) {
  console.error("Aufruf: node tools/bump-version.js patch|minor|major|<x.y.z>");
  process.exit(1);
}

const raw = fs.readFileSync(VERSION_FILE, "utf8");
const currentCode = parseInt(raw.match(/^versionCode=(\d+)$/m)[1], 10);
const currentName = raw.match(/^versionName=(.+)$/m)[1].trim();

function nextName(current, how) {
  if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(how)) return how;

  const [major, minor, patch] = current.replace(/-.*$/, "").split(".").map(Number);
  if (how === "major") return `${major + 1}.0.0`;
  if (how === "minor") return `${major}.${minor + 1}.0`;
  if (how === "patch") return `${major}.${minor}.${patch + 1}`;

  console.error(`Unbekannt: "${how}". Erlaubt: patch, minor, major oder eine Version wie 2.5.0`);
  process.exit(1);
}

const newName = nextName(currentName, arg);
const newCode = currentCode + 1;

// Gezielt ersetzen statt die Datei neu zu schreiben: die Kommentare darin
// erklaeren die Bedeutung der beiden Zeilen und sollen erhalten bleiben.
const updated = raw
  .replace(/^versionCode=\d+$/m, `versionCode=${newCode}`)
  .replace(/^versionName=.+$/m, `versionName=${newName}`);
fs.writeFileSync(VERSION_FILE, updated);

// package.json mitziehen, damit beide Dateien dasselbe sagen. Fuer den
// Android-Build ist das Feld ohne Bedeutung.
const pkg = JSON.parse(fs.readFileSync(PKG_FILE, "utf8"));
pkg.version = newName;
fs.writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2) + "\n");

console.log(`versionName  ${currentName} -> ${newName}`);
console.log(`versionCode  ${currentCode} -> ${newCode}`);
console.log("");
console.log("Naechste Schritte:");
console.log("  1. CHANGELOG.md ergaenzen");
console.log("  2. node tools/android-build.js release");
console.log(`  3. git commit && git tag v${newName}`);
