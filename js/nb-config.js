/* Nestbau v2 – Konfiguration.
   Diese Datei liegt im Repository und enthaelt KEINE Geheimnisse.
   Client-IDs und Firebase-Keys sind oeffentlich (PKCE/SPA), gehoeren aber pro
   Installation gesetzt: dafuer js/nb-config.local.js anlegen (ist per .gitignore
   ausgeschlossen) und dort NB.configure({...}) aufrufen. */
(function () {
  "use strict";
  var NB = window.NB = window.NB || {};

  var defaults = {
    logLevel: "info",                 // debug | info | warn | error | off
    timeZone: "Europe/Zurich",

    // ---- Google Kalender ----
    google: {
      clientId: "",                   // "1234-abc.apps.googleusercontent.com"
      scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
      apiBase: "https://www.googleapis.com/calendar/v3"
    },

    // ---- Outlook / Microsoft Graph ----
    outlook: {
      clientId: "",                   // Anwendungs-(Client-)ID aus Entra ID
      tenant: "common",               // common | organizations | consumers | <tenant-guid>
      scopes: "openid profile offline_access User.Read Calendars.ReadWrite",
      graphBase: "https://graph.microsoft.com/v1.0"
    },

    // ---- Firebase (Kochbuch-Cloud) ----
    firebase: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: "",
      sdkVersion: "10.14.1"           // compat-Builds vom Google-CDN
    },

    // ---- Sync-Verhalten ----
    sync: {
      pastDays: 30,                   // Importfenster rueckwaerts
      futureDays: 180,                // Importfenster vorwaerts
      autoSyncMinutes: 15,            // 0 = kein Hintergrund-Sync
      direction: "read",              // "read" = nur importieren, "both" = auch exportieren
      defaultCategory: "sonstiges",   // Nestbau-Kategorie fuer importierte Termine
      defaultAssignee: "both",        // a | b | both
      maxPushPerRun: 50               // Schutz vor versehentlichen Massen-Uploads
    }
  };

  function deepMerge(target, patch) {
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        target[k] = deepMerge(target[k] && typeof target[k] === "object" ? target[k] : {}, v);
      } else if (v !== undefined) {
        target[k] = v;
      }
    });
    return target;
  }

  NB.config = deepMerge({}, defaults);

  /* Aus nb-config.local.js aufrufen. Mehrfach aufrufbar (wird gemerged). */
  NB.configure = function (patch) {
    deepMerge(NB.config, patch || {});
    if (NB.bus) NB.bus.emit("config:changed", NB.config);
    return NB.config;
  };

  /* Nutzer-Einstellungen aus der Oberflaeche ueberschreiben die sync-Defaults. */
  NB.syncPrefs = function () {
    var saved = (NB.store && NB.store.get("sync-prefs")) || {};
    var out = {};
    Object.keys(NB.config.sync).forEach(function (k) { out[k] = saved[k] !== undefined ? saved[k] : NB.config.sync[k]; });
    return out;
  };
  NB.setSyncPrefs = function (patch) {
    var cur = (NB.store && NB.store.get("sync-prefs")) || {};
    NB.store.set("sync-prefs", deepMerge(cur, patch));
    NB.bus.emit("config:changed", NB.config);
  };

  NB.configured = {
    google: function () { return !!NB.config.google.clientId; },
    outlook: function () { return !!NB.config.outlook.clientId; },
    firebase: function () { return !!(NB.config.firebase.apiKey && NB.config.firebase.projectId); }
  };
})();
