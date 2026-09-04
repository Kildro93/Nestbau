/**
 * Erzeugt alle Bitmap-Assets aus icon.svg:
 *   - PWA-Icons (192/512) in www/
 *   - Android-Launcher-Icons (mdpi..xxxhdpi, legacy + adaptive foreground)
 *   - Play-Store-Icon 512x512 und Feature-Graphic 1024x500
 *
 * Die Quelle bleibt icon.svg. Wer das Logo aendert, aendert nur diese eine Datei
 * und laesst `npm run assets` laufen - dann stimmen alle Groessen wieder ueberein.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SVG = path.join(ROOT, "icon.svg");
const BG = "#1c7d70";          // Deckfarbe des adaptiven Icons
const SPLASH_BG = "#f4f2ee";

// Android-Launcher: legacy (voll) und adaptiv (Vordergrund mit Sicherheitsrand).
const DENSITIES = {
  mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192
};

async function png(size, out, opts = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let img = sharp(SVG, { density: 512 }).resize(size, size, { fit: "contain" });
  if (opts.background) {
    img = img.flatten({ background: opts.background });
  }
  await img.png().toFile(out);
}

/**
 * Adaptives Icon: Android beschneidet das Vordergrundbild auf einen Kreis oder
 * Squircle. Nur die inneren ~66% sind garantiert sichtbar, deshalb wird das Logo
 * verkleinert und zentriert auf eine transparente Flaeche gelegt.
 */
async function adaptiveForeground(size, out) {
  const inner = Math.round(size * 0.62);
  const pad = Math.round((size - inner) / 2);
  const logo = await sharp(SVG, { density: 512 }).resize(inner, inner).png().toBuffer();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(out);
}

async function featureGraphic(out) {
  // Play Store Feature-Graphic: 1024x500, kein Alpha, Logo links, Flaeche in Markenfarbe.
  const logoSize = 300;
  const logo = await sharp(SVG, { density: 512 }).resize(logoSize, logoSize).png().toBuffer();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({
    create: { width: 1024, height: 500, channels: 3, background: SPLASH_BG }
  })
    .composite([{ input: logo, top: 100, left: 90 }])
    .png()
    .toFile(out);
}

async function splash(out) {
  // Capacitor-Splash: quadratisch, Logo mittig auf Markenhintergrund.
  const logo = await sharp(SVG, { density: 512 }).resize(600, 600).png().toBuffer();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({
    create: { width: 2732, height: 2732, channels: 3, background: SPLASH_BG }
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(out);
}

(async () => {
  // 1) PWA
  await png(192, path.join(ROOT, "assets/icons/icon-192.png"));
  await png(512, path.join(ROOT, "assets/icons/icon-512.png"));

  // 2) Play Store (kein Transparenz-Kanal erlaubt)
  await png(512, path.join(ROOT, "play-store/icon-512.png"), { background: BG });
  await featureGraphic(path.join(ROOT, "play-store/feature-graphic-1024x500.png"));

  // 3) Android Launcher
  const res = path.join(ROOT, "android/app/src/main/res");
  if (fs.existsSync(res)) {
    for (const [density, size] of Object.entries(DENSITIES)) {
      const dir = path.join(res, `mipmap-${density}`);
      await png(size, path.join(dir, "ic_launcher.png"), { background: BG });
      await png(size, path.join(dir, "ic_launcher_round.png"), { background: BG });
      await adaptiveForeground(size * 2, path.join(dir, "ic_launcher_foreground.png"));
    }
    await splash(path.join(res, "drawable/splash.png"));
    console.log("[assets] Android-Launcher-Icons + Splash geschrieben.");
  } else {
    console.warn("[assets] android/ fehlt - Launcher-Icons uebersprungen. Erst `npx cap add android`.");
  }

  console.log("[assets] fertig.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
