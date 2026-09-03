#!/usr/bin/env node
/**
 * Erzeugt .well-known/assetlinks.json aus dem SHA-256-Fingerprint des
 * Signaturschluessels.
 *
 *   node scripts/make-assetlinks.mjs AB:CD:EF:...:12
 *
 * Diese Datei ist der Beweis, dass Website und Android-App zusammengehoeren.
 * Fehlt sie oder passt der Fingerprint nicht, zeigt Android in der TWA die
 * Adressleiste an -- die App sieht dann aus wie ein Browser-Fenster und
 * Play lehnt sie in der Review haeufig ab.
 *
 * Den Fingerprint liefert:
 *   keytool -list -v -keystore android/upload-keystore.jks -alias upload
 *
 * Wichtig: Wenn du Play App Signing nutzt (Standard fuer neue Apps), signiert
 * Google die Auslieferung mit einem EIGENEN Schluessel. Dann muss hier der
 * Fingerprint aus der Play Console stehen (Setup > App-Integritaet >
 * App-Signaturschluessel), nicht der des lokalen Upload-Keystores. Beide
 * einzutragen ist erlaubt und der sichere Weg.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fingerprints = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (fingerprints.length === 0) {
  console.error(`
  Kein Fingerprint angegeben.

    node scripts/make-assetlinks.mjs <SHA256> [weiterer SHA256 ...]

  Fingerprint auslesen:
    keytool -list -v -keystore android/upload-keystore.jks -alias upload

  Die Zeile beginnt mit "SHA256:" und sieht so aus:
    AB:CD:12:34:...:EF   (32 Byte-Paare, durch Doppelpunkte getrennt)
`);
  process.exit(1);
}

const NORM = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

const geprueft = fingerprints.map((f) => {
  const norm = f.trim().toUpperCase().replace(/^SHA-?256:\s*/i, "");
  if (!NORM.test(norm)) {
    console.error(`\n  "${f}" ist kein gueltiger SHA-256-Fingerprint.`);
    console.error(`  Erwartet: 32 Byte-Paare in Hex, durch Doppelpunkte getrennt.\n`);
    process.exit(1);
  }
  return norm;
});

const twa = JSON.parse(await fs.readFile(path.join(ROOT, "twa-manifest.json"), "utf8"));

const assetlinks = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: twa.packageId,
      sha256_cert_fingerprints: geprueft,
    },
  },
];

const dir = path.join(ROOT, ".well-known");
await fs.mkdir(dir, { recursive: true });
const ziel = path.join(dir, "assetlinks.json");
await fs.writeFile(ziel, JSON.stringify(assetlinks, null, 2) + "\n", "utf8");

console.log(`
  .well-known/assetlinks.json geschrieben.

    Package:      ${twa.packageId}
    Fingerprints: ${geprueft.length}
${geprueft.map((f) => "                  " + f).join("\n")}

  Damit die Datei wirkt, muss sie unter dieser exakten URL liegen:
    ${new URL("/.well-known/assetlinks.json", twa.fullScopeUrl).href}

  ACHTUNG bei GitHub Pages in einem Unterverzeichnis:
  assetlinks.json wird immer in der DOMAIN-Wurzel gesucht, nie im
  Projektpfad. Bei ${twa.fullScopeUrl}
  muss die Datei also nach https://${twa.host}/.well-known/assetlinks.json --
  das geht nur ueber das Repo "${twa.host.split(".")[0]}.github.io".
  Alternative: eigene Domain, oder die App auf eine Subdomain legen.

  Pruefen, sobald sie online ist:
    curl -s ${new URL("/.well-known/assetlinks.json", twa.fullScopeUrl).href}
`);
