#!/usr/bin/env node
/**
 * Nestbau - lokaler Static-Server.
 * Zero-Dependency. Serviert das Repo-Root auf http://localhost:3000
 *
 *   node scripts/server.mjs [--port 3000] [--host 0.0.0.0]
 *
 * --host 0.0.0.0 macht die App im WLAN erreichbar (PWA-Test am Handy).
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg("--port", process.env.PORT || 3000));
const HOST = arg("--host", "127.0.0.1");
const QUIET = process.argv.includes("--quiet");

/**
 * Pfade, die auch innerhalb des Repos nie ausgeliefert werden duerfen.
 * `.git` enthaelt die vollstaendige Historie samt evtl. frueher committeter
 * Geheimnisse -- beim Testen im WLAN (--host 0.0.0.0) waere das oeffentlich.
 */
const BLOCKED_SEGMENTS = new Set([".git", "node_modules", ".github", "reports", ".env"]);

/** Verhindert Path-Traversal: loest auf und prueft, dass das Ziel unter ROOT bleibt. */
function safeResolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null; // kaputtes Percent-Encoding
  }
  if (decoded.includes("\0")) return null;

  const rel = decoded.replace(/^\/+/, "");
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;

  const segmente = path.relative(ROOT, abs).split(/[\\/]/).filter(Boolean);
  if (segmente.some((s) => BLOCKED_SEGMENTS.has(s) || s.startsWith("."))) return null;

  return abs;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let status = 200;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      status = 405;
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
      return res.end("405 Method Not Allowed");
    }

    let file = safeResolve(req.url || "/");
    if (!file) {
      status = 403;
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      return res.end("403 Forbidden");
    }

    let stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) {
      file = path.join(file, "index.html");
      stat = await fs.stat(file).catch(() => null);
    }

    if (!stat?.isFile()) {
      status = 404;
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found: " + req.url);
    }

    const ext = path.extname(file).toLowerCase();
    const headers = {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": stat.size,
      // Dev-Server: nichts cachen, damit Aenderungen sofort sichtbar sind.
      "cache-control": "no-store, must-revalidate",
      // Der Service Worker darf den ganzen Scope kontrollieren.
      "service-worker-allowed": "/",
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    return res.end(await fs.readFile(file));
  } catch (err) {
    status = 500;
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("500 Internal Server Error");
    console.error("[server] " + err.stack);
  } finally {
    if (!QUIET) {
      console.log(`[server] ${status} ${req.method} ${req.url} (${Date.now() - started}ms)`);
    }
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} ist belegt.`);
    console.error(`  Anderen Port nutzen:  node scripts/server.mjs --port 3001\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Nestbau laeuft.\n`);
  console.log(`  Lokal:    http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === "IPv4" && !net.internal) {
          console.log(`  Netzwerk: http://${net.address}:${PORT}   (fuer Handy/PWA)`);
        }
      }
    }
  } else {
    console.log(`  Netzwerk: node scripts/server.mjs --host 0.0.0.0\n            (macht die App im WLAN sichtbar)`);
  }
  console.log(`\n  Beenden mit Strg+C\n`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\n[server] beendet.");
    server.close(() => process.exit(0));
  });
}
