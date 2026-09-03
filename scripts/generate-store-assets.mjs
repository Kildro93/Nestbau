#!/usr/bin/env node
/**
 * Erzeugt alle Bild-Assets, die Play Store und PWA-Installation verlangen,
 * aus der einen Quelle icon.svg.
 *
 *   node scripts/generate-store-assets.mjs
 *
 * Ausgabe:
 *   assets/icons/icon-<groesse>.png     - PWA-Manifest-Icons
 *   assets/icons/maskable-<groesse>.png - mit Safe-Zone-Rand fuer Android
 *   assets/play/icon-512.png            - Play-Store-Listing (Pflicht)
 *   assets/play/feature-graphic.png     - Play-Store-Kopfgrafik (Pflicht, 1024x500)
 *
 * Screenshots werden NICHT hier erzeugt -- die muessen die echte laufende App
 * zeigen. Dafuer: npm run dev, dann scripts/capture-screenshots.mjs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "icon.svg");

// Groessen aus den PWA- und Play-Store-Anforderungen.
const PWA_SIZES = [48, 72, 96, 128, 144, 152, 192, 256, 384, 512];
const MASKABLE_SIZES = [192, 512];

const THEME = "#1c7d70";
const BACKGROUND = "#f4f2ee";

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

/** Normale Icons: SVG randlos auf Zielgroesse rastern. */
async function renderIcon(svg, size, out) {
  await sharp(svg, { density: 400 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

/**
 * Maskable Icons: Android schneidet bis zu 20% vom Rand weg (Kreis, Squircle,
 * Tropfen). Das Motiv muss deshalb in der inneren Safe-Zone liegen -- wir
 * skalieren auf 80% und legen es mittig auf eine deckende Flaeche.
 */
async function renderMaskable(svg, size, out) {
  // Die eigene gerundete Kachel des Icons wegnehmen: sonst sieht man auf dem
  // deckenden Hintergrund zwei ineinandergeschachtelte Rundungen.
  const ohneKachel = Buffer.from(
    String(svg).replace(/<rect[^>]*fill="url\(#g\)"[^>]*\/>/, "")
  );
  const inner = Math.round(size * 0.8);
  const motiv = await sharp(ohneKachel, { density: 400 }).resize(inner, inner).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: THEME },
  })
    .composite([{ input: motiv, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

/**
 * Feature Graphic: 1024x500, erscheint als Kopfgrafik im Store-Listing.
 * Play lehnt Uploads ohne sie ab. Kein Text im Bild -- Play rendert den
 * App-Namen selbst darueber und doppelter Text wirkt gedraengt.
 */
async function renderFeatureGraphic(svg, out) {
  const W = 1024, H = 500;
  const verlauf = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
       <defs>
         <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="${THEME}"/>
           <stop offset="1" stop-color="#4a6741"/>
         </linearGradient>
       </defs>
       <rect width="${W}" height="${H}" fill="url(#bg)"/>
     </svg>`
  );
  const logo = await sharp(svg, { density: 400 }).resize(300, 300).png().toBuffer();
  await sharp(verlauf)
    .composite([{ input: logo, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

async function main() {
  const svg = await fs.readFile(SRC).catch(() => {
    throw new Error(`icon.svg nicht gefunden unter ${SRC}`);
  });

  const iconDir = path.join(ROOT, "assets", "icons");
  const playDir = path.join(ROOT, "assets", "play");
  await ensureDir(iconDir);
  await ensureDir(playDir);

  const erzeugt = [];

  for (const s of PWA_SIZES) {
    const out = path.join(iconDir, `icon-${s}.png`);
    await renderIcon(svg, s, out);
    erzeugt.push(out);
  }

  for (const s of MASKABLE_SIZES) {
    const out = path.join(iconDir, `maskable-${s}.png`);
    await renderMaskable(svg, s, out);
    erzeugt.push(out);
  }

  // Play-Store-Listing verlangt genau 512x512, 32-bit PNG, kein Alpha.
  const playIcon = path.join(playDir, "icon-512.png");
  await sharp(svg, { density: 400 })
    .resize(512, 512)
    .flatten({ background: BACKGROUND })
    .png({ compressionLevel: 9 })
    .toFile(playIcon);
  erzeugt.push(playIcon);

  const feature = path.join(playDir, "feature-graphic.png");
  await renderFeatureGraphic(svg, feature);
  erzeugt.push(feature);

  console.log("\n  Store-Assets erzeugt:\n");
  for (const f of erzeugt) {
    const { size } = await fs.stat(f);
    console.log(`    ${path.relative(ROOT, f).padEnd(38)} ${(size / 1024).toFixed(1).padStart(7)} KB`);
  }

  // Pruefen, dass das Play-Icon die harten Vorgaben erfuellt.
  const meta = await sharp(playIcon).metadata();
  const okay = meta.width === 512 && meta.height === 512;
  console.log(`\n  Play-Icon: ${meta.width}x${meta.height} ${meta.format} -- ${okay ? "OK" : "FEHLER"}`);

  const featMeta = await sharp(feature).metadata();
  const featOkay = featMeta.width === 1024 && featMeta.height === 500;
  console.log(`  Feature-Graphic: ${featMeta.width}x${featMeta.height} ${featMeta.format} -- ${featOkay ? "OK" : "FEHLER"}`);

  console.log(`\n  Naechster Schritt: node scripts/update-manifest-icons.mjs\n  (traegt die neuen Icons in manifest.json ein)\n`);

  if (!okay || !featOkay) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\n  Fehler: " + e.message + "\n");
  process.exit(1);
});
