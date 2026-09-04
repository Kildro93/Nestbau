/* Nestbau v2 – Kern: Namespace, Speicher, Fehler, Retry, Event-Bus.
   Bewusst ES5 + Promises, damit die App weiterhin ohne Build-Schritt laeuft. */
(function () {
  "use strict";

  var NB = window.NB = window.NB || {};
  NB.VERSION = "2.0.0";

  // ---------- Logging ----------
  var LEVELS = { debug: 10, info: 20, warn: 30, error: 40, off: 99 };
  NB.log = function (ns) {
    function out(level, args) {
      var cfg = (NB.config && NB.config.logLevel) || "info";
      if (LEVELS[level] < LEVELS[cfg]) return;
      var pre = "[nb:" + ns + "]";
      var fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      fn.apply(console, [pre].concat(Array.prototype.slice.call(args)));
    }
    return {
      debug: function () { out("debug", arguments); },
      info: function () { out("info", arguments); },
      warn: function () { out("warn", arguments); },
      error: function () { out("error", arguments); }
    };
  };
  var log = NB.log("core");

  // ---------- Fehler ----------
  /* Alle Integrationsfehler werden auf diese Codes normalisiert, damit UI und
     Sync-Engine nicht jeden Anbieter einzeln kennen muessen. */
  NB.CODES = {
    NOT_CONFIGURED: "NOT_CONFIGURED",   // Client-ID / Firebase-Config fehlt
    INSECURE_ORIGIN: "INSECURE_ORIGIN", // file:// – OAuth unmoeglich
    AUTH_REQUIRED: "AUTH_REQUIRED",     // noch nie verbunden
    AUTH_EXPIRED: "AUTH_EXPIRED",       // Token abgelaufen, stiller Refresh gescheitert
    PERMISSION: "PERMISSION",           // 403, fehlender Scope
    NOT_FOUND: "NOT_FOUND",             // 404
    CONFLICT: "CONFLICT",               // 409/412 – etag stimmt nicht
    GONE: "GONE",                       // 410 – syncToken/deltaLink ungueltig
    RATE_LIMIT: "RATE_LIMIT",           // 429
    SERVER: "SERVER",                   // 5xx
    NETWORK: "NETWORK",                 // offline / fetch fehlgeschlagen
    ABORTED: "ABORTED",                 // Nutzer hat Popup geschlossen
    QUOTA: "QUOTA",                     // localStorage / Firestore Limit
    UNKNOWN: "UNKNOWN"
  };

  function NbError(code, message, meta) {
    var e = new Error(message || code);
    e.name = "NbError";
    e.code = code;
    e.meta = meta || {};
    e.retryable = code === NB.CODES.RATE_LIMIT || code === NB.CODES.SERVER || code === NB.CODES.NETWORK;
    return e;
  }
  NB.error = NbError;
  NB.isNbError = function (e) { return !!(e && e.name === "NbError"); };

  /* Deutsche Klartextmeldung fuer die Oberflaeche. */
  NB.errorText = function (e) {
    if (!e) return "Unbekannter Fehler.";
    var C = NB.CODES, c = e.code;
    if (c === C.NOT_CONFIGURED) return "Nicht eingerichtet – Client-ID fehlt in js/nb-config.local.js.";
    if (c === C.INSECURE_ORIGIN) return "Anmeldung braucht http(s). Die App per Server starten, nicht per Doppelklick.";
    if (c === C.AUTH_REQUIRED) return "Nicht verbunden.";
    if (c === C.AUTH_EXPIRED) return "Anmeldung abgelaufen – bitte neu verbinden.";
    if (c === C.PERMISSION) return "Zugriff verweigert – fehlende Berechtigung im Konto.";
    if (c === C.NOT_FOUND) return "Kalender oder Termin nicht gefunden.";
    if (c === C.CONFLICT) return "Termin wurde anderswo geaendert – Konflikt.";
    if (c === C.GONE) return "Sync-Marke abgelaufen – volle Synchronisation noetig.";
    if (c === C.RATE_LIMIT) return "Zu viele Anfragen – bitte spaeter erneut.";
    if (c === C.SERVER) return "Der Dienst antwortet gerade nicht.";
    if (c === C.NETWORK) return "Keine Verbindung.";
    if (c === C.ABORTED) return "Abgebrochen.";
    if (c === C.QUOTA) return "Speicherplatz erschoepft.";
    return e.message || "Unbekannter Fehler.";
  };

  NB.classifyHttp = function (status, bodyText, headers) {
    var C = NB.CODES;
    var meta = { status: status, body: bodyText };
    if (headers && headers.get) {
      var ra = headers.get("Retry-After");
      if (ra) meta.retryAfterMs = (/^\d+$/.test(ra) ? parseInt(ra, 10) * 1000 : Math.max(0, new Date(ra) - Date.now()));
    }
    if (status === 401) return NbError(C.AUTH_EXPIRED, "HTTP 401", meta);
    if (status === 403) {
      // Google meldet Rate-Limits historisch als 403 mit reason rateLimitExceeded.
      if (bodyText && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(bodyText)) return NbError(C.RATE_LIMIT, "HTTP 403 rate", meta);
      return NbError(C.PERMISSION, "HTTP 403", meta);
    }
    if (status === 404) return NbError(C.NOT_FOUND, "HTTP 404", meta);
    if (status === 409 || status === 412) return NbError(C.CONFLICT, "HTTP " + status, meta);
    if (status === 410) return NbError(C.GONE, "HTTP 410", meta);
    if (status === 429) return NbError(C.RATE_LIMIT, "HTTP 429", meta);
    if (status >= 500) return NbError(C.SERVER, "HTTP " + status, meta);
    return NbError(C.UNKNOWN, "HTTP " + status + " " + (bodyText || "").slice(0, 200), meta);
  };

  // ---------- Retry mit Backoff ----------
  NB.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* Fuehrt fn() aus und wiederholt bei retryable-Fehlern. Respektiert Retry-After.
     Voller Jitter, damit zwei Geraete nicht im Gleichtakt erneut anfragen. */
  NB.retry = function (fn, opts) {
    opts = opts || {};
    var tries = opts.tries || 4;
    var base = opts.baseMs || 600;
    var maxMs = opts.maxMs || 20000;
    var attempt = 0;
    function step() {
      attempt++;
      return Promise.resolve().then(fn).catch(function (e) {
        var retryable = NB.isNbError(e) ? e.retryable : (e && e.name === "TypeError");
        if (!retryable || attempt >= tries) throw e;
        var wait = Math.min(maxMs, base * Math.pow(2, attempt - 1));
        if (e.meta && e.meta.retryAfterMs) wait = Math.max(wait, e.meta.retryAfterMs);
        wait = Math.round(Math.random() * wait); // full jitter
        log.warn("Versuch " + attempt + " fehlgeschlagen (" + (e.code || e.message) + "), neuer Versuch in " + wait + "ms");
        return NB.sleep(wait).then(step);
      });
    }
    return step();
  };

  /* fetch mit Timeout, JSON-Parsing und normalisierten Fehlern. */
  NB.http = function (url, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 20000) : null;
    var init = {
      method: opts.method || "GET",
      headers: opts.headers || {},
      body: opts.body,
      signal: ctrl ? ctrl.signal : undefined
    };
    if (!navigator.onLine) { if (timer) clearTimeout(timer); return Promise.reject(NbError(NB.CODES.NETWORK, "offline")); }
    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      var isJson = (res.headers.get("content-type") || "").indexOf("json") !== -1;
      var read = res.status === 204 ? Promise.resolve(null)
        : (isJson ? res.json().catch(function () { return null; }) : res.text());
      return read.then(function (body) {
        if (!res.ok) throw NB.classifyHttp(res.status, typeof body === "string" ? body : JSON.stringify(body), res.headers);
        return { body: body, headers: res.headers, status: res.status };
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      if (NB.isNbError(e)) throw e;
      if (e && e.name === "AbortError") throw NbError(NB.CODES.NETWORK, "Zeitueberschreitung");
      throw NbError(NB.CODES.NETWORK, (e && e.message) || "Netzwerkfehler");
    });
  };

  // ---------- Speicher ----------
  /* Integrationsdaten liegen bewusst NICHT im grossen nestbau-state-v1 Blob:
     Tokens sollen bei "Sicherung laden" nicht mitwandern und nicht im Export landen. */
  NB.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem("nb2:" + key);
        return raw ? JSON.parse(raw) : (fallback === undefined ? null : fallback);
      } catch (e) { return fallback === undefined ? null : fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem("nb2:" + key, JSON.stringify(value)); return true; }
      catch (e) { log.error("Speichern fehlgeschlagen", key, e); return false; }
    },
    del: function (key) { try { localStorage.removeItem("nb2:" + key); } catch (e) {} },
    keys: function (prefix) {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("nb2:" + (prefix || "")) === 0) out.push(k.slice(4));
        }
      } catch (e) {}
      return out;
    }
  };

  // ---------- Event-Bus ----------
  var handlers = {};
  NB.bus = {
    on: function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return function () { NB.bus.off(evt, fn); }; },
    off: function (evt, fn) { handlers[evt] = (handlers[evt] || []).filter(function (h) { return h !== fn; }); },
    emit: function (evt, payload) {
      (handlers[evt] || []).forEach(function (h) {
        try { h(payload); } catch (e) { log.error("Bus-Handler " + evt, e); }
      });
    }
  };

  // ---------- Umgebung ----------
  NB.env = {
    secure: function () {
      return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    },
    origin: function () { return location.origin; },
    /* Wirft, wenn OAuth technisch unmoeglich ist (Doppelklick auf index.html). */
    requireSecure: function () {
      if (!NB.env.secure()) throw NbError(NB.CODES.INSECURE_ORIGIN, "OAuth braucht http(s)");
    }
  };

  NB.online = { is: function () { return navigator.onLine !== false; } };
  window.addEventListener("online", function () { NB.bus.emit("online"); });
  window.addEventListener("offline", function () { NB.bus.emit("offline"); });

  // ---------- Hilfen ----------
  NB.util = {
    uid: function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    pad2: function (n) { return (n < 10 ? "0" : "") + n; },
    dateKey: function (d) { return d.getFullYear() + "-" + NB.util.pad2(d.getMonth() + 1) + "-" + NB.util.pad2(d.getDate()); },
    hhmm: function (d) { return NB.util.pad2(d.getHours()) + ":" + NB.util.pad2(d.getMinutes()); },
    addDays: function (d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; },
    /* Lokale Zeit als RFC3339 mit Offset – Google/Graph brauchen die Zone explizit. */
    toRfc3339: function (dateKey, hhmm) {
      var p = String(dateKey).split("-");
      var t = String(hhmm || "00:00").split(":");
      var d = new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1], 0);
      var off = -d.getTimezoneOffset();
      var sign = off >= 0 ? "+" : "-";
      return d.getFullYear() + "-" + NB.util.pad2(d.getMonth() + 1) + "-" + NB.util.pad2(d.getDate()) +
        "T" + NB.util.pad2(d.getHours()) + ":" + NB.util.pad2(d.getMinutes()) + ":00" +
        sign + NB.util.pad2(Math.floor(Math.abs(off) / 60)) + ":" + NB.util.pad2(Math.abs(off) % 60);
    },
    /* Graph liefert Zeiten ohne Offset ("2026-09-03T10:00:00.0000000"), aber in der
       via Prefer-Header angeforderten Zone. Deshalb hier nicht als UTC parsen. */
    parseNaive: function (s) {
      var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || "");
      return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
    },
    /* Deterministischer Hash – fuer Bild-Deduplizierung bei der Migration. */
    hash: function (str) {
      var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (var i = 0; i < str.length; i++) {
        var ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    },
    bytes: function (n) {
      if (n < 1024) return n + " B";
      if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
      return (n / 1048576).toFixed(1) + " MB";
    },
    /* Grobe Groesse eines Objekts, wie Firestore es speichern wuerde. */
    approxSize: function (obj) {
      try { return new Blob([JSON.stringify(obj)]).size; } catch (e) { return JSON.stringify(obj).length; }
    }
  };

  log.info("Kern geladen, Version " + NB.VERSION + (NB.env.secure() ? "" : " – Achtung: unsicherer Origin, OAuth deaktiviert"));
})();
