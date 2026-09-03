/**
 * Integrationstests: der lokale Dev-Server.
 * Startet ihn auf einem freien Port und prueft Ausliefern, Fehlerfaelle
 * und die Absicherung gegen Path-Traversal.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { ROOT } from "../helpers/load-app.mjs";

const PORT = 34117; // unwahrscheinlich belegt, damit Tests nicht mit dem Dev-Server kollidieren
const BASE = `http://127.0.0.1:${PORT}`;

let proc;

test.before(async () => {
  proc = spawn(process.execPath, [path.join(ROOT, "scripts", "server.mjs"), "--port", String(PORT), "--quiet"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Auf die Startmeldung warten, statt blind zu schlafen.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server ist nicht innerhalb von 10s gestartet")), 10000);
    proc.stdout.on("data", (b) => {
      if (String(b).includes("Nestbau laeuft")) { clearTimeout(timer); resolve(); }
    });
    proc.on("error", reject);
  });
});

test.after(() => { proc?.kill(); });

test("Root liefert die App aus", async () => {
  const res = await fetch(BASE + "/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const body = await res.text();
  assert.match(body, /<title>/i);
  assert.match(body, /id="view-heute"/);
});

test("index.html ist direkt erreichbar", async () => {
  const res = await fetch(BASE + "/index.html");
  assert.equal(res.status, 200);
});

test("manifest.json wird mit JSON-Content-Type ausgeliefert", async () => {
  const res = await fetch(BASE + "/manifest.json");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  const m = await res.json();
  assert.equal(m.name, "Nestbau");
});

test("sw.js wird als JavaScript ausgeliefert", async () => {
  const res = await fetch(BASE + "/sw.js");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /javascript/,
    "falscher MIME-Type -- der Browser lehnt die Service-Worker-Registrierung ab");
});

test("Service-Worker-Allowed-Header erlaubt den vollen Scope", async () => {
  const res = await fetch(BASE + "/sw.js");
  assert.equal(res.headers.get("service-worker-allowed"), "/");
});

test("icon.svg wird mit SVG-Content-Type ausgeliefert", async () => {
  const res = await fetch(BASE + "/icon.svg");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /image\/svg/);
});

test("unbekannte Pfade liefern 404", async () => {
  const res = await fetch(BASE + "/gibt-es-nicht.html");
  assert.equal(res.status, 404);
});

/**
 * Schickt eine rohe HTTP-Zeile, ohne dass fetch() den Pfad vorher normalisiert.
 * Nur so laesst sich echtes Path-Traversal ueberhaupt testen.
 */
function rawGet(pfad) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, "127.0.0.1", () => {
      sock.write(`GET ${pfad} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`);
    });
    let daten = "";
    sock.on("data", (b) => { daten += b; });
    sock.on("end", () => resolve({
      status: Number((daten.match(/^HTTP\/1\.1 (\d+)/) || [])[1]),
      body: daten.split("\r\n\r\n").slice(1).join("\r\n\r\n"),
    }));
    sock.on("error", reject);
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error("Timeout bei " + pfad)); });
  });
}

test("Path-Traversal wird abgewiesen", async () => {
  // Der Dev-Server darf nichts ausserhalb des Repo-Roots ausliefern.
  // Besonders wichtig bei --host 0.0.0.0 (PWA-Test am Handy im WLAN).
  for (const angriff of [
    "/../../../../../../etc/passwd",
    "/../../../../Windows/win.ini",
    "/%2e%2e%2f%2e%2e%2f%2e%2e%2fWindows%2fwin.ini",
    "/..%2f..%2f..%2fpackage.json",
  ]) {
    const res = await rawGet(angriff);
    assert.ok(res.status === 403 || res.status === 404,
      `"${angriff}" wurde mit Status ${res.status} beantwortet -- Dateien ausserhalb des Roots sind erreichbar`);
  }
});

test("interne Verzeichnisse sind nicht abrufbar", async () => {
  // .git enthaelt die volle Historie, node_modules fremden Code.
  for (const pfad of ["/.git/config", "/.git/HEAD", "/node_modules/jsdom/package.json", "/.gitignore"]) {
    const res = await rawGet(pfad);
    assert.ok(res.status === 403 || res.status === 404,
      `"${pfad}" ist mit Status ${res.status} abrufbar -- im WLAN waere das oeffentlich einsehbar`);
  }
});

test("Schreibzugriffe werden abgelehnt", async () => {
  const res = await fetch(BASE + "/index.html", { method: "POST" });
  assert.equal(res.status, 405);
});

test("Dev-Server cached nicht", async () => {
  const res = await fetch(BASE + "/index.html");
  assert.match(res.headers.get("cache-control") || "", /no-store/,
    "ohne no-store sieht man Aenderungen an index.html nicht sofort");
});
