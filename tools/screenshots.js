/**
 * Erzeugt die Play-Store-Screenshots aus der echten App.
 *
 * Ablauf: www/ wird lokal ausgeliefert, der Demo-Datensatz aus tools/demo-data.js
 * landet vor dem ersten Rendern im localStorage, dann wird jede Ansicht
 * angesteuert und aufgenommen. Es wird nichts nachtraeglich gemalt oder montiert -
 * was auf den Bildern steht, rendert die App auch auf dem Geraet so.
 *
 * Format: 1080x1920 (9:16). Das ist das von Google empfohlene Telefon-Format und
 * liegt sicher innerhalb der Play-Grenzen (320-3840 px je Kante).
 *
 * Aufruf: node tools/screenshots.js
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");
const OUT = path.join(ROOT, "play-store", "screenshots");
const PORT = 8123;

// 360x640 CSS-Pixel bei dreifacher Aufloesung ergibt exakt 1080x1920.
const VIEWPORT = { width: 360, height: 640, deviceScaleFactor: 3 };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.join(WWW, rel);
      if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

const SHOTS = [
  {
    file: "01-login.png",
    caption: "Profil waehlen",
    profile: null,          // ohne Profil oeffnet die App die Profilauswahl von selbst
    view: null
  },
  { file: "02-aufgaben.png", caption: "Aufgaben & Listen", profile: "a", view: "aufgaben" },
  { file: "03-kalender.png", caption: "Gemeinsamer Kalender", profile: "a", view: "kalender" },
  // Das Kochbuch oeffnet standardmaessig den Menueplan; fuer den Store ist die
  // Rezeptliste die aussagekraeftigere Ansicht.
  { file: "04-kochbuch.png", caption: "Kochbuch & Rezepte", profile: "a", view: "kochbuch", sub: "rezepte" },
  { file: "05-heute.png",    caption: "Der Tag auf einen Blick", profile: "a", view: "heute" },
  { file: "06-finanzen.png", caption: "Fixkosten im Blick", profile: "a", view: "finanzen" }
];

(async () => {
  if (!fs.existsSync(path.join(WWW, "index.html"))) {
    console.error("[screenshots] www/ fehlt - erst `npm run build:web`.");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const demo = require("./demo-data.js");
  const server = await serve();
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      // Die App folgt prefers-color-scheme. Fuer den Store wird das helle Thema
      // festgelegt: es passt zu Icon, Feature-Graphic und manifest.background_color,
      // und alle sechs Bilder sehen dann wie eine Serie aus.
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

      // Der State muss stehen, bevor index.html sein IIFE ausfuehrt - sonst
      // rendert die App einmal leer und der Screenshot zeigt den Leerzustand.
      await page.evaluateOnNewDocument((state, profile) => {
        localStorage.setItem("nestbau-state-v1", JSON.stringify(state));
        if (profile) localStorage.setItem("nestbau-active-profile", profile);
        else localStorage.removeItem("nestbau-active-profile");
      }, demo, shot.profile);

      await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle0" });

      if (shot.view) {
        await page.click(`[data-view="${shot.view}"]`);
      }
      if (shot.sub) {
        await page.click(`[data-sub="${shot.sub}"]`);
      }
      // Kurz warten, bis Uebergaenge stehen - sonst landen halbe Animationen im Bild.
      await new Promise((r) => setTimeout(r, 400));

      const target = path.join(OUT, shot.file);
      await page.screenshot({ path: target });
      const kb = (fs.statSync(target).size / 1024).toFixed(0);
      console.log(`[screenshots] ${shot.file}  ${shot.caption}  (${kb} KB)`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`[screenshots] fertig -> ${path.relative(ROOT, OUT)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
