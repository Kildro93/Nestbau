#!/usr/bin/env node
/**
 * Traegt die von generate-store-assets.mjs erzeugten PNG-Icons in
 * manifest.json ein und ergaenzt die Felder, die Play/TWA verlangen.
 *
 * Warum PNG statt nur SVG: Android akzeptiert fuer Launcher-Icons und
 * fuer die Play-Store-Pruefung keine SVGs. Das SVG bleibt als erstes
 * Icon erhalten (scharf auf allen Displays), die PNGs kommen dazu.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "manifest.json");

const PWA_SIZES = [48, 72, 96, 128, 144, 152, 192, 256, 384, 512];
const MASKABLE_SIZES = [192, 512];

async function main() {
  const m = JSON.parse(await fs.readFile(MANIFEST, "utf8"));

  const icons = [];

  // SVG zuerst -- Browser, die es koennen, nehmen die scharfe Vektorfassung.
  icons.push({ src: "./icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" });

  for (const s of PWA_SIZES) {
    const rel = `./assets/icons/icon-${s}.png`;
    if (await exists(rel)) icons.push({ src: rel, sizes: `${s}x${s}`, type: "image/png", purpose: "any" });
  }
  for (const s of MASKABLE_SIZES) {
    const rel = `./assets/icons/maskable-${s}.png`;
    if (await exists(rel)) icons.push({ src: rel, sizes: `${s}x${s}`, type: "image/png", purpose: "maskable" });
  }

  m.icons = icons;

  // Felder, die Play/TWA und die Installierbarkeit betreffen.
  m.id = m.id || "/index.html";
  m.dir = m.dir || "ltr";
  m.display_override = m.display_override || ["standalone", "minimal-ui"];
  m.prefer_related_applications = false;

  await fs.writeFile(MANIFEST, JSON.stringify(m, null, 2) + "\n", "utf8");

  console.log(`\n  manifest.json aktualisiert: ${icons.length} Icons eingetragen`);
  console.log(`    ${icons.filter((i) => i.purpose === "any").length} x any, ${icons.filter((i) => i.purpose === "maskable").length} x maskable\n`);
}

async function exists(rel) {
  return fs.access(path.join(ROOT, rel.replace(/^\.\//, ""))).then(() => true, () => false);
}

main().catch((e) => { console.error("Fehler: " + e.message); process.exit(1); });
