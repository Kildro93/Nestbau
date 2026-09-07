/**
 * Laedt index.html in jsdom, fuehrt die Inline-Skripte aus und sammelt
 * alle Konsolen- und Laufzeitfehler ein.
 *
 * Die App ist eine Single-File-PWA: das gesamte JS steckt in einer IIFE in
 * index.html. Interne Funktionen sind deshalb von aussen nicht erreichbar --
 * getestet wird ueber das DOM, genau wie eine Nutzerin die App bedient.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const INDEX_HTML = path.join(ROOT, "index.html");

export function readIndexHtml() {
  return fs.readFileSync(INDEX_HTML, "utf8");
}

/** Extrahiert alle Inline-<script>-Bloecke ohne type-Attribut (also echtes JS). */
export function extractInlineScripts(html = readIndexHtml()) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || "";
    if (/\btype\s*=/.test(attrs) && !/type\s*=\s*["']?(text\/javascript|module)/i.test(attrs)) continue;
    if (/\bsrc\s*=/.test(attrs)) continue;
    out.push({ attrs: attrs.trim(), code: m[2], index: m.index });
  }
  return out;
}

/**
 * Baut eine frische App-Instanz.
 * @param {{ state?: object, url?: string, now?: Date }} opts
 * @returns {Promise<{ dom, window, document, errors, logs, localStorage, teardown }>}
 */
export async function loadApp(opts = {}) {
  const errors = [];
  const logs = [];

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push({ type: "jsdomError", message: e.message, stack: e.stack }));
  virtualConsole.on("error", (...a) => { errors.push({ type: "console.error", message: a.map(String).join(" ") }); });
  virtualConsole.on("warn", (...a) => logs.push({ level: "warn", message: a.map(String).join(" ") }));
  virtualConsole.on("log", (...a) => logs.push({ level: "log", message: a.map(String).join(" ") }));

  const dom = new JSDOM(readIndexHtml(), {
    url: opts.url || "http://localhost:3000/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // jsdom kennt weder Service Worker noch matchMedia/Canvas-Kontext.
      // Stubs, damit die App nicht an fehlenden Browser-APIs stirbt.
      if (!window.navigator.serviceWorker) {
        Object.defineProperty(window.navigator, "serviceWorker", {
          configurable: true,
          value: { register: () => Promise.resolve({ scope: "/" }), ready: Promise.resolve({}) },
        });
      }
      window.matchMedia = window.matchMedia || ((q) => ({
        matches: false, media: q, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      }));
      window.HTMLCanvasElement.prototype.getContext = function () {
        const noop = () => {};
        return new Proxy({}, {
          get: (_t, prop) => {
            if (prop === "canvas") return this;
            if (prop === "measureText") return () => ({ width: 0 });
            if (prop === "createLinearGradient" || prop === "createRadialGradient") {
              return () => ({ addColorStop: noop });
            }
            if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
            return noop;
          },
          set: () => true,
        });
      };
      window.scrollTo = window.scrollTo || (() => {});
      window.HTMLElement.prototype.scrollIntoView = () => {};

      // Vorbefuellter State fuer deterministische Tests.
      if (opts.state) {
        window.localStorage.setItem("nestbau-state-v1", JSON.stringify(opts.state));
      }
      // Uncaught-Errors einsammeln (jsdomError deckt nicht alles ab).
      window.addEventListener("error", (e) => errors.push({ type: "window.error", message: e.message }));
      window.addEventListener("unhandledrejection", (e) =>
        errors.push({ type: "unhandledrejection", message: String(e.reason) }));
    },
  });

  const { window } = dom;
  // Auf DOMContentLoaded warten -- die App initialisiert sich dort.
  if (window.document.readyState !== "complete") {
    await new Promise((resolve) => {
      const done = () => resolve();
      window.addEventListener("load", done);
      setTimeout(done, 3000);
    });
  }
  // Ein Tick fuer Microtasks/Timer der Initialisierung.
  await new Promise((r) => setTimeout(r, 50));

  return {
    dom,
    window,
    document: window.document,
    errors,
    logs,
    localStorage: window.localStorage,
    /** Aktueller persistierter State als Objekt (oder null). */
    readState() {
      const raw = window.localStorage.getItem("nestbau-state-v1");
      return raw ? JSON.parse(raw) : null;
    },
    /** Klickt ein Element und laesst den Event-Loop einmal durchlaufen. */
    async click(elOrSelector) {
      const el = typeof elOrSelector === "string" ? window.document.querySelector(elOrSelector) : elOrSelector;
      if (!el) throw new Error("click(): Element nicht gefunden: " + elOrSelector);
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
      return el;
    },
    /** Setzt einen Input-Wert und feuert input+change. */
    async fill(selector, value) {
      const el = window.document.querySelector(selector);
      if (!el) throw new Error("fill(): Element nicht gefunden: " + selector);
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
      return el;
    },
    teardown() {
      try { dom.window.close(); } catch { /* jsdom raeumt gelegentlich doppelt ab */ }
    },
  };
}

/** Fehler, die in jsdom erwartbar sind und keine echten App-Bugs darstellen. */
export const IGNORABLE_ERROR_PATTERNS = [
  /Not implemented: HTMLCanvasElement/i,
  /Not implemented: window\.scrollTo/i,
  /Could not parse CSS stylesheet/i,
  /is not a supported CSS/i,
];

export function realErrors(errors) {
  return errors.filter((e) => !IGNORABLE_ERROR_PATTERNS.some((p) => p.test(e.message || "")));
}
