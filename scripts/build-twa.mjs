#!/usr/bin/env node
/**
 * Play-Store-Build: verpackt die PWA als Trusted Web Activity (TWA) in ein AAB.
 *
 *   node scripts/build-twa.mjs --check     nur Voraussetzungen pruefen (Default)
 *   node scripts/build-twa.mjs --init      Android-Projekt aus twa-manifest.json erzeugen
 *   node scripts/build-twa.mjs --build     AAB und APK bauen (braucht Keystore)
 *   node scripts/build-twa.mjs --fingerprint  SHA-256 aus dem Keystore lesen
 *
 * Eine TWA ist die von Google unterstuetzte Art, eine PWA in den Play Store
 * zu bringen: ein duenner Android-Container, der die Seite in einem Chrome
 * ohne Adressleiste laedt. Zwei harte Voraussetzungen:
 *
 *   1. Die PWA muss unter einer oeffentlichen HTTPS-URL erreichbar sein.
 *      localhost geht nicht. Hier: GitHub Pages.
 *   2. Unter <url>/.well-known/assetlinks.json muss der SHA-256-Fingerprint
 *      des Signaturschluessels liegen. Sonst zeigt Android die Adressleiste
 *      an und die App wirkt wie ein Browser-Fenster.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = path.join(ROOT, "android");
const TWA_MANIFEST = path.join(ROOT, "twa-manifest.json");

const MODUS = process.argv.find((a) => a.startsWith("--"))?.slice(2) || "check";

async function existiert(p) {
  return fs.access(p).then(() => true, () => false);
}

async function befehlDa(cmd, args = ["--version"]) {
  try {
    const { stdout, stderr } = await run(cmd, args, { shell: true, timeout: 30000 });
    return (stdout || stderr).trim().split("\n")[0];
  } catch {
    return null;
  }
}

// --- Voraussetzungen ------------------------------------------------------

async function pruefeVoraussetzungen() {
  console.log("\n  Play-Store-Build: Voraussetzungen\n  " + "=".repeat(58));

  const zeilen = [];
  const fehlt = [];

  const java = await befehlDa("java", ["-version"]);
  zeilen.push(["JDK", java || "FEHLT", !!java]);
  if (!java) fehlt.push("JDK 17 oder neuer: https://adoptium.net");

  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const sdkDa = sdk && (await existiert(sdk));
  zeilen.push(["Android SDK", sdkDa ? sdk : "FEHLT", !!sdkDa]);
  if (!sdkDa) fehlt.push("Android SDK (Android Studio oder cmdline-tools)");

  if (sdkDa) {
    const plattformen = await fs.readdir(path.join(sdk, "platforms")).catch(() => []);
    const hat35 = plattformen.includes("android-35");
    zeilen.push(["Platform android-35", hat35 ? plattformen.join(", ") : `nur ${plattformen.join(", ")}`, hat35]);
    if (!hat35) fehlt.push("Platform android-35 (Play verlangt targetSdk 35): sdkmanager \"platforms;android-35\"");

    const bt = await fs.readdir(path.join(sdk, "build-tools")).catch(() => []);
    zeilen.push(["Build-Tools", bt.length ? bt.join(", ") : "FEHLT", bt.length > 0]);
    if (!bt.length) fehlt.push("Build-Tools: sdkmanager \"build-tools;35.0.0\"");
  }

  const bubblewrap = await befehlDa("npx", ["--yes", "@bubblewrap/cli", "--version"]);
  zeilen.push(["Bubblewrap CLI", bubblewrap || "wird bei Bedarf per npx geholt", true]);

  const manifestDa = await existiert(TWA_MANIFEST);
  zeilen.push(["twa-manifest.json", manifestDa ? "vorhanden" : "FEHLT", manifestDa]);

  let twa = null;
  if (manifestDa) {
    twa = JSON.parse(await fs.readFile(TWA_MANIFEST, "utf8"));
    zeilen.push(["Package-ID", twa.packageId, true]);
    zeilen.push(["Ziel-URL", twa.fullScopeUrl, true]);
    zeilen.push(["targetSdk", String(twa.targetSdkVersion), twa.targetSdkVersion >= 35]);
  }

  const keystore = twa ? path.resolve(ROOT, twa.signingKey.path) : null;
  const keystoreDa = keystore && (await existiert(keystore));
  zeilen.push(["Signatur-Keystore", keystoreDa ? path.relative(ROOT, keystore) : "FEHLT (muss der Mensch anlegen)", !!keystoreDa]);

  const assetlinks = path.join(ROOT, ".well-known", "assetlinks.json");
  const alDa = await existiert(assetlinks);
  zeilen.push([".well-known/assetlinks.json", alDa ? "vorhanden" : "FEHLT", alDa]);

  // Ist die Ziel-URL ueberhaupt schon online?
  if (twa) {
    try {
      const res = await fetch(twa.webManifestUrl, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      zeilen.push(["Manifest online", `HTTP ${res.status}`, res.ok]);
      if (!res.ok) fehlt.push(`PWA ist unter ${twa.fullScopeUrl} noch nicht erreichbar -- GitHub Pages aktivieren`);
    } catch {
      zeilen.push(["Manifest online", "nicht erreichbar", false]);
      fehlt.push(`PWA ist unter ${twa.fullScopeUrl} noch nicht erreichbar -- GitHub Pages aktivieren`);
    }
  }

  console.log("");
  for (const [name, wert, ok] of zeilen) {
    console.log(`  ${ok ? " OK " : "FEHLT"}  ${name.padEnd(28)} ${wert}`);
  }

  console.log("\n  " + "=".repeat(58));
  if (fehlt.length === 0) {
    console.log("  Alle Voraussetzungen erfuellt.");
    console.log("  Naechster Schritt: node scripts/build-twa.mjs --build\n");
  } else {
    console.log(`  ${fehlt.length} Punkt(e) offen:\n`);
    for (const f of fehlt) console.log("    - " + f);
    console.log("");
    if (!keystoreDa) zeigeKeystoreAnleitung(twa);
  }
  // Offene Punkte muessen sich im Exit-Code niederschlagen, sonst meldet
  // der Statusbericht faelschlich "bereit fuer den Store".
  if (fehlt.length > 0 || !keystoreDa) process.exitCode = 1;
  return { fehlt, twa, keystore };
}

function zeigeKeystoreAnleitung(twa) {
  const alias = twa?.signingKey?.alias || "upload";
  console.log("  " + "-".repeat(58));
  console.log("  Signatur-Keystore anlegen (macht der Mensch, nicht das Skript --");
  console.log("  hier werden Passwoerter vergeben, die niemand sonst sehen darf):\n");
  console.log("    mkdir android");
  console.log(`    keytool -genkeypair -v -storetype PKCS12 \\`);
  console.log(`      -keystore android/upload-keystore.jks \\`);
  console.log(`      -alias ${alias} -keyalg RSA -keysize 2048 -validity 10000`);
  console.log("\n  Der Keystore ist gitignored und darf NIE ins Repo. Geht er");
  console.log("  verloren, laesst sich die App im Store nicht mehr aktualisieren.");
  console.log("  Sichern und das Passwort in einen Passwortmanager legen.\n");
}

// --- Android-Projekt erzeugen --------------------------------------------

async function init() {
  const { twa } = await pruefeVoraussetzungen();
  console.log("\n  Erzeuge Android-Projekt aus twa-manifest.json ...\n");
  await fs.mkdir(ANDROID, { recursive: true });
  try {
    const { stdout, stderr } = await run("npx", ["--yes", "@bubblewrap/cli", "init", "--manifest", twa.webManifestUrl],
      { cwd: ANDROID, shell: true, timeout: 600000 });
    console.log(stdout || stderr);
  } catch (e) {
    console.error("\n  Bubblewrap init fehlgeschlagen:\n  " + (e.stdout || e.message));
    console.error("\n  Haeufigste Ursache: die PWA ist unter der HTTPS-URL noch nicht online.\n");
    process.exit(1);
  }
}

// --- Fingerprint ----------------------------------------------------------

async function fingerprint() {
  const twa = JSON.parse(await fs.readFile(TWA_MANIFEST, "utf8"));
  const keystore = path.resolve(ROOT, twa.signingKey.path);
  if (!(await existiert(keystore))) {
    console.error("\n  Keystore fehlt: " + path.relative(ROOT, keystore));
    zeigeKeystoreAnleitung(twa);
    process.exit(1);
  }
  console.log("\n  keytool fragt gleich nach dem Keystore-Passwort.\n");
  console.log("  Danach die SHA256-Zeile hier eintragen:");
  console.log("    node scripts/make-assetlinks.mjs <SHA256-FINGERPRINT>\n");
  console.log("  Befehl:");
  console.log(`    keytool -list -v -keystore "${path.relative(ROOT, keystore)}" -alias ${twa.signingKey.alias}\n`);
}

// --- Build ----------------------------------------------------------------

async function build() {
  const { fehlt, twa, keystore } = await pruefeVoraussetzungen();
  if (fehlt.length) {
    console.error("  Build abgebrochen -- offene Punkte zuerst erledigen.\n");
    process.exit(1);
  }
  if (!(await existiert(path.join(ANDROID, "build.gradle")))) {
    console.error("  Android-Projekt fehlt. Erst: node scripts/build-twa.mjs --init\n");
    process.exit(1);
  }

  console.log("\n  Baue AAB und APK ...\n");
  console.log("  Bubblewrap fragt nach dem Keystore-Passwort. Es wird nirgends");
  console.log("  gespeichert und laeuft nicht ueber dieses Skript.\n");

  try {
    const { stdout, stderr } = await run("npx", ["--yes", "@bubblewrap/cli", "build"],
      { cwd: ANDROID, shell: true, timeout: 1800000, stdio: "inherit" });
    console.log(stdout || stderr);
  } catch (e) {
    console.error("\n  Build fehlgeschlagen:\n" + (e.stdout || e.message) + "\n");
    process.exit(1);
  }

  for (const artefakt of ["app-release-bundle.aab", "app-release-signed.apk"]) {
    const p = path.join(ANDROID, artefakt);
    if (await existiert(p)) {
      const { size } = await fs.stat(p);
      console.log(`  ${artefakt.padEnd(30)} ${(size / 1024 / 1024).toFixed(2)} MB`);
    }
  }
  console.log("\n  Das .aab laedst du in der Play Console hoch.\n");
}

// --- Einstieg -------------------------------------------------------------

const aktionen = { check: pruefeVoraussetzungen, init, build, fingerprint };
const aktion = aktionen[MODUS];
if (!aktion) {
  console.error(`\n  Unbekannter Modus "--${MODUS}". Erlaubt: --check --init --build --fingerprint\n`);
  process.exit(1);
}
aktion().catch((e) => { console.error("\n  Fehler: " + e.message + "\n"); process.exit(1); });
