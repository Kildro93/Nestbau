/**
 * Baut die Android-App ueber einen ASCII-Spiegel des Projekts.
 *
 * Hintergrund: Das Android Gradle Plugin kann nicht aus einem Pfad mit
 * Nicht-ASCII-Zeichen bauen (hier: "Obsidion fuer Claud"). Es meldet das zwar nur
 * als Warnung, scheitert danach aber hart beim Aufloesen der Java-Abhaengigkeiten.
 * android.overridePathCheck=true aendert daran nichts - getestet.
 *
 * Der Spiegel enthaelt exakt das, was Gradle braucht: android/ und die
 * @capacitor-Pakete, auf die android/capacitor.settings.gradle verweist. Gebaut
 * wird dort, die Artefakte landen anschliessend in dist/.
 *
 * Aufruf:  node tools/android-build.js debug
 *          node tools/android-build.js release
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MIRROR = process.env.NESTBAU_BUILD_DIR || "C:/nestbau-build";

const TASKS = {
  debug: { gradle: "assembleDebug", from: "app/build/outputs/apk/debug", ext: ".apk" },
  release: { gradle: "bundleRelease", from: "app/build/outputs/bundle/release", ext: ".aab" },
  releaseApk: { gradle: "assembleRelease", from: "app/build/outputs/apk/release", ext: ".apk" }
};

const which = process.argv[2] || "debug";
const task = TASKS[which];
if (!task) {
  console.error(`Unbekanntes Ziel "${which}". Erlaubt: ${Object.keys(TASKS).join(", ")}`);
  process.exit(1);
}

// Kein Spiegeln von build/ und .gradle/: das sind Ausgaben, keine Eingaben, und
// ein alter Stand von dort wuerde den frischen Build verfaelschen.
const SKIP_DIRS = new Set(["build", ".gradle", ".idea", "captures"]);

function mirror(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) mirror(src, dst);
    else if (entry.isSymbolicLink()) continue;
    else fs.copyFileSync(src, dst);
  }
}

console.log(`[android-build] Spiegel: ${MIRROR}`);

// Der Spiegel wird nicht komplett geloescht: build/ und .gradle/ bleiben stehen,
// damit Folgebuilds inkrementell laufen. app/src/ dagegen schon - dort liegen die
// Web-Assets, und eine im Original geloeschte Datei duerfte hier nicht ueberleben.
fs.rmSync(path.join(MIRROR, "android", "app", "src"), { recursive: true, force: true });
mirror(path.join(ROOT, "android"), path.join(MIRROR, "android"));
mirror(path.join(ROOT, "node_modules", "@capacitor"), path.join(MIRROR, "node_modules", "@capacitor"));

// keystore.properties liegt bewusst ausserhalb des Repos und wird nicht
// gespiegelt - der Pfad darin ist absolut und funktioniert auch im Spiegel.
const keystoreProps = path.join(ROOT, "android", "keystore.properties");
if (which !== "debug" && !fs.existsSync(keystoreProps)) {
  console.error("[android-build] android/keystore.properties fehlt - Release kann nicht signiert werden.");
  console.error("                Vorlage: android/keystore.properties.example");
  process.exit(1);
}

console.log(`[android-build] gradlew ${task.gradle} ...`);
// .bat-Dateien laesst Node seit 18.20 nur noch ueber die Shell starten,
// deshalb der Umweg ueber cmd.exe statt eines direkten gradlew.bat-Aufrufs.
// Absoluter Pfad, weil cmd.exe den Befehlsnamen nicht zuverlaessig im
// Arbeitsverzeichnis sucht (NoDefaultCurrentDirectoryInExePath).
execFileSync("cmd.exe", ["/c", path.join(MIRROR, "android", "gradlew.bat"), task.gradle, "--no-daemon"], {
  cwd: path.join(MIRROR, "android"),
  stdio: "inherit"
});

// Artefakte zurueckholen. dist/ ist gitignored - die Binaries gehoeren an ein
// GitHub Release, nicht in die Repo-Historie.
const version = fs
  .readFileSync(path.join(ROOT, "android", "version.properties"), "utf8")
  .match(/versionName=(.+)/)[1]
  .trim();

const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const srcDir = path.join(MIRROR, "android", task.from);
let copied = 0;
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith(task.ext)) continue;
  const target = path.join(outDir, `nestbau-${version}-${which}${task.ext}`);
  fs.copyFileSync(path.join(srcDir, file), target);
  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(2);
  console.log(`[android-build] ${path.relative(ROOT, target)}  (${mb} MB)`);
  copied++;
}
if (!copied) {
  console.error(`[android-build] Keine ${task.ext}-Datei in ${srcDir}`);
  process.exit(1);
}
