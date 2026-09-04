/* Nestbau v2 – Firebase-Schicht fuer das Kochbuch.

   Datenmodell (Firestore):
     households/{hid}                      – Name, Besitzer, Beitrittscode
     households/{hid}/members/{uid}        – Mitglieder (Indra + Partnerin)
     households/{hid}/ingredients/{id}     – Zutaten
     households/{hid}/recipes/{id}         – Rezepte
     households/{hid}/ingredientCategories/{id}
     households/{hid}/ingredientGroups/{id}
     households/{hid}/dishCategories/{id}  – eigene Rezeptkategorien
     households/{hid}/menuPlan/{JJJJ-MM-TT} – ein Dokument pro Tag
     households/{hid}/meta/{doc}           – Migrationsmarker u. a.

   Bilder liegen NICHT als Base64 im Dokument (Firestore-Limit 1 MiB pro
   Dokument), sondern im Storage unter households/{hid}/images/{hash}.

   Es wird bewusst das compat-SDK vom CDN geladen: die App bleibt damit ohne
   Bundler lauffaehig, so wie index.html es bisher auch ist. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("cloud");

  var cloud = NB.cloud = {};
  var fb = null, auth = null, db = null, storage = null;
  var initPromise = null;
  var unsubs = [];
  var applyingRemote = false;
  var pushTimer = null;

  /* Sammlungen im Firestore <-> Felder im lokalen State.
     Aufgaben/Listen: lists (top-level), Aufgaben in items[] gepacked.
     Events, Subscriptions: top-level Arrays.
     Kochbuch: Subsammlungen pro Haushalt. */
  var COLLECTIONS = [
    // Aufgaben & Listen (Haushalts-Level)
    { key: "lists", coll: "lists", household: true },
    // Events & Kalender (Haushalts-Level)
    { key: "events", coll: "events", household: true },
    // Finanzen (Haushalts-Level)
    { key: "subscriptions", coll: "subscriptions", household: true },
    // Kochbuch (Haushalts-Subsammlungen, wie zuvor)
    { key: "ingredients", coll: "ingredients", household: true },
    { key: "recipes", coll: "recipes", household: true },
    { key: "ingredientCategories", coll: "ingredientCategories", household: true },
    { key: "ingredientGroups", coll: "ingredientGroups", household: true },
    { key: "customDishCategories", coll: "dishCategories", household: true }
  ];
  cloud.COLLECTIONS = COLLECTIONS;

  // ---------- SDK laden ----------
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(NB.error(NB.CODES.NETWORK, "Firebase-SDK konnte nicht geladen werden: " + src)); };
      document.head.appendChild(s);
    });
  }

  function loadSdk() {
    if (window.firebase && window.firebase.firestore) return Promise.resolve();
    var v = NB.config.firebase.sdkVersion;
    var base = "https://www.gstatic.com/firebasejs/" + v + "/";
    // Reihenfolge zaehlt: app zuerst, dann die Module.
    return loadScript(base + "firebase-app-compat.js")
      .then(function () { return loadScript(base + "firebase-auth-compat.js"); })
      .then(function () { return loadScript(base + "firebase-firestore-compat.js"); })
      .then(function () { return loadScript(base + "firebase-storage-compat.js"); });
  }

  cloud.available = function () { return NB.configured.firebase(); };

  cloud.init = function () {
    if (initPromise) return initPromise;
    initPromise = Promise.resolve().then(function () {
      if (!cloud.available()) throw NB.error(NB.CODES.NOT_CONFIGURED, "Firebase-Konfiguration fehlt");
      NB.env.requireSecure();
      return loadSdk();
    }).then(function () {
      fb = window.firebase;
      if (!fb.apps.length) fb.initializeApp(NB.config.firebase);
      auth = fb.auth();
      db = fb.firestore();
      storage = fb.storage();

      // Emulator-Modus (für lokales Testing)
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        log.info("Verwende Firebase Emulatoren...");
        db.useEmulator('localhost', 8080);
        auth.useEmulator('http://localhost:9099', { disableWarnings: true });
        storage.useEmulator('localhost', 5000);
      }

      // Offline-Cache: Kochbuch bleibt ohne Netz lesbar; scheitert bei mehreren
      // gleichzeitig offenen Tabs – das ist unkritisch, dann eben ohne Cache.
      return db.enablePersistence({ synchronizeTabs: true }).catch(function (e) {
        log.warn("Offline-Cache nicht aktiv:", e.code);
      });
    }).then(function () {
      auth.onAuthStateChanged(function (u) {
        NB.bus.emit("cloud:auth", { user: u ? { uid: u.uid, email: u.email, name: u.displayName } : null });
      });
      log.info("Firebase bereit, Projekt " + NB.config.firebase.projectId);
      return true;
    }).catch(function (e) {
      initPromise = null;
      throw e;
    });
    return initPromise;
  };

  // ---------- Anmeldung ----------
  cloud.user = function () { return auth && auth.currentUser; };
  cloud.requireUser = function () {
    var u = cloud.user();
    if (!u) throw NB.error(NB.CODES.AUTH_REQUIRED, "Nicht bei der Cloud angemeldet");
    return u;
  };

  cloud.signInGoogle = function () {
    return cloud.init().then(function () {
      var provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      return auth.signInWithPopup(provider);
    }).then(function (res) { return res.user; })
      .catch(function (e) { throw mapAuthError(e); });
  };

  cloud.signOut = function () {
    cloud.unwatch();
    return cloud.init().then(function () { return auth.signOut(); });
  };

  function mapAuthError(e) {
    if (NB.isNbError(e)) return e;
    var c = (e && e.code) || "";
    if (/popup-closed-by-user|cancelled-popup-request/.test(c)) return NB.error(NB.CODES.ABORTED, "Anmeldung abgebrochen.");
    if (/popup-blocked/.test(c)) return NB.error(NB.CODES.ABORTED, "Popup wurde blockiert.");
    if (/unauthorized-domain/.test(c)) return NB.error(NB.CODES.NOT_CONFIGURED, "Diese Adresse ist in Firebase nicht als autorisierte Domain eingetragen.");
    if (/network-request-failed/.test(c)) return NB.error(NB.CODES.NETWORK, "Keine Verbindung zu Firebase.");
    if (/permission-denied/.test(c)) return NB.error(NB.CODES.PERMISSION, "Zugriff verweigert – Firestore-Regeln pruefen.");
    return NB.error(NB.CODES.UNKNOWN, (e && e.message) || "Firebase-Fehler");
  }
  cloud.mapError = mapAuthError;

  // ---------- Haushalt ----------
  cloud.householdId = function () { return NB.store.get("household-id"); };
  cloud.setHouseholdId = function (id) {
    NB.store.set("household-id", id);
    NB.store.del("cloud-remote-migrated");   // gilt nur fuer den vorherigen Haushalt
    NB.bus.emit("cloud:household", { id: id });
  };

  function hhRef() {
    var hid = cloud.householdId();
    if (!hid) throw NB.error(NB.CODES.NOT_CONFIGURED, "Kein Haushalt gewaehlt");
    return db.collection("households").doc(hid);
  }
  cloud.ref = hhRef;

  /* Legt einen Haushalt an oder gibt den bestehenden zurueck. Der Beitrittscode
     ist bewusst kurz und menschenlesbar – die Partnerin gibt ihn einmal ein. */
  cloud.ensureHousehold = function (name) {
    return cloud.init().then(function () {
      var u = cloud.requireUser();
      var hid = cloud.householdId();
      if (hid) {
        return hhRef().get().then(function (snap) {
          if (snap.exists) return joinIfNeeded(hid, u).then(function () { return hid; });
          return createHousehold(name, u);
        });
      }
      return createHousehold(name, u);
    });
  };

  function createHousehold(name, u) {
    var ref = db.collection("households").doc();
    var code = (Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    return ref.set({
      name: name || "Nestbau",
      ownerUid: u.uid,
      joinCode: code,
      memberUids: [u.uid],
      createdAt: fb.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 2
    }).then(function () {
      // Nachschlagetabelle Code -> Haushalt. Damit muss beim Beitritt nicht die
      // Sammlung "households" durchsucht werden – die Regeln koennen jedes
      // Auflisten von Haushalten verbieten und nur den gezielten Zugriff auf
      // einen bekannten Code erlauben.
      return db.collection("joinCodes").doc(code).set({ householdId: ref.id, ownerUid: u.uid });
    }).then(function () {
      return ref.collection("members").doc(u.uid).set({
        uid: u.uid, email: u.email || null, name: u.displayName || null,
        role: "owner", joinedAt: fb.firestore.FieldValue.serverTimestamp()
      });
    }).then(function () {
      cloud.setHouseholdId(ref.id);
      log.info("Haushalt angelegt", ref.id, "Beitrittscode", code);
      return ref.id;
    }).catch(function (e) { throw mapAuthError(e); });
  }

  function joinIfNeeded(hid, u) {
    var mref = db.collection("households").doc(hid).collection("members").doc(u.uid);
    return mref.get().then(function (s) {
      if (s.exists) return null;
      return mref.set({
        uid: u.uid, email: u.email || null, name: u.displayName || null,
        role: "member", joinedAt: fb.firestore.FieldValue.serverTimestamp()
      });
    });
  }

  /* Beitritt ueber den Code der Partnerin: erst Code aufloesen, dann sich selbst
     zur Mitgliederliste hinzufuegen. Wer die Haushalts-ID kennt, kennt den Code –
     darauf bauen die Firestore-Regeln auf. */
  cloud.joinHousehold = function (code) {
    return cloud.init().then(function () {
      var u = cloud.requireUser();
      var norm = String(code || "").trim().toUpperCase();
      if (!norm) throw NB.error(NB.CODES.NOT_FOUND, "Kein Code eingegeben.");
      return db.collection("joinCodes").doc(norm).get().then(function (s) {
        if (!s.exists) throw NB.error(NB.CODES.NOT_FOUND, "Kein Haushalt mit diesem Code gefunden.");
        var hid = s.data().householdId;
        var ref = db.collection("households").doc(hid);
        return ref.update({ memberUids: fb.firestore.FieldValue.arrayUnion(u.uid) })
          .then(function () { return joinIfNeeded(hid, u); })
          .then(function () { cloud.setHouseholdId(hid); return hid; });
      });
    }).catch(function (e) { throw mapAuthError(e); });
  };

  cloud.householdInfo = function () {
    return cloud.init().then(function () { return hhRef().get(); }).then(function (s) {
      return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
    });
  };

  /* Steht im Haushalt schon ein Kochbuch? Entscheidend fuer das zweite Geraet:
     dort darf nicht "hochladen" angeboten werden – sonst ueberschreibt ein
     frisch beigetretenes, leeres Geraet den gemeinsamen Bestand. Das Ergebnis
     wird zwischengespeichert, damit die Oberflaeche synchron darauf zugreifen kann. */
  cloud.remoteMigrated = function () { return NB.store.get("cloud-remote-migrated"); };

  cloud.checkRemote = function () {
    return cloud.init().then(function () {
      cloud.requireUser();
      if (!cloud.householdId()) return null;
      return hhRef().collection("meta").doc("migration").get();
    }).then(function (s) {
      var has = !!(s && s.exists);
      if (cloud.remoteMigrated() !== has) {
        NB.store.set("cloud-remote-migrated", has);
        NB.bus.emit("cloud:remote", { migrated: has });
      }
      return has;
    }).catch(function (e) {
      log.warn("Fernstand nicht pruefbar", e.code || e.message);
      return null;
    });
  };

  // ---------- Bilder ----------
  var DATA_URL_RE = /^data:(image\/[a-z+]+);base64,/i;
  cloud.isDataUrl = function (v) { return typeof v === "string" && DATA_URL_RE.test(v); };

  function dataUrlToBlob(dataUrl) {
    var m = DATA_URL_RE.exec(dataUrl);
    var mime = m[1];
    var bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  var uploadCache = {}; // hash -> URL, spart doppelte Uploads gleicher Bilder

  /* Laedt ein Base64-Bild hoch und liefert die oeffentliche Download-URL.
     Der Dateiname ist der Inhalts-Hash: identische Bilder landen einmal. */
  cloud.uploadImage = function (dataUrl) {
    if (!cloud.isDataUrl(dataUrl)) return Promise.resolve(dataUrl);
    var h = NB.util.hash(dataUrl);
    if (uploadCache[h]) return Promise.resolve(uploadCache[h]);
    var blob = dataUrlToBlob(dataUrl);
    var ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    var path = "households/" + cloud.householdId() + "/images/" + h + "." + ext;
    var ref = storage.ref(path);
    return ref.put(blob, { cacheControl: "public,max-age=31536000", contentType: blob.type })
      .then(function () { return ref.getDownloadURL(); })
      .then(function (url) { uploadCache[h] = url; return url; })
      .catch(function (e) { throw mapAuthError(e); });
  };

  /* Ersetzt alle Base64-Bilder in einem Objekt rekursiv durch Storage-URLs. */
  cloud.externalizeImages = function (obj) {
    var jobs = [];
    function walk(node) {
      if (!node || typeof node !== "object") return;
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (cloud.isDataUrl(v)) {
          jobs.push(cloud.uploadImage(v).then(function (url) { node[k] = url; }));
        } else if (v && typeof v === "object") walk(v);
      });
    }
    walk(obj);
    return Promise.all(jobs).then(function () { return obj; });
  };

  // ---------- Lesen / Schreiben ----------
  function stripUndefined(o) {
    // Firestore lehnt undefined ab; JSON-Roundtrip raeumt das mit auf.
    return JSON.parse(JSON.stringify(o, function (k, v) { return v === undefined ? null : v; }));
  }

  cloud.saveDoc = function (coll, id, data) {
    return cloud.init().then(function () {
      var payload = stripUndefined(data);
      return cloud.externalizeImages(payload);
    }).then(function (payload) {
      payload.updatedAt = fb.firestore.FieldValue.serverTimestamp();
      payload.updatedBy = (cloud.user() || {}).uid || null;
      var size = NB.util.approxSize(payload);
      if (size > 900 * 1024) {
        throw NB.error(NB.CODES.QUOTA, "Dokument zu gross (" + NB.util.bytes(size) + "). Bild verkleinern.");
      }
      return hhRef().collection(coll).doc(String(id)).set(payload, { merge: false });
    }).catch(function (e) { throw mapAuthError(e); });
  };

  cloud.deleteDoc = function (coll, id) {
    return cloud.init()
      .then(function () { return hhRef().collection(coll).doc(String(id)).delete(); })
      .catch(function (e) { throw mapAuthError(e); });
  };

  cloud.getAll = function (coll) {
    return cloud.init().then(function () { return hhRef().collection(coll).get(); })
      .then(function (qs) {
        var out = [];
        qs.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
        return out;
      }).catch(function (e) { throw mapAuthError(e); });
  };

  cloud.batch = function () { return db.batch(); };
  cloud.serverTime = function () { return fb.firestore.FieldValue.serverTimestamp(); };
  cloud.raw = function () { return { fb: fb, db: db, auth: auth, storage: storage }; };

  // ---------- Live-Abgleich ----------
  /* Ein onSnapshot je Sammlung. Eingehende Daten ersetzen den jeweiligen
     State-Zweig; danach wird gerendert. applyingRemote verhindert, dass der
     dadurch ausgeloeste persist() sofort wieder hochlaedt. */
  cloud.watch = function (opts) {
    if (unsubs.length) return Promise.resolve();
    opts = opts || {};
    return cloud.init().then(function () {
      cloud.requireUser();
      // Schutz vor Datenverlust: ein leerer Haushalt wuerde beim ersten Snapshot
      // die lokalen Zutaten und Rezepte durch eine leere Liste ersetzen.
      if (opts.force) return true;
      return cloud.checkRemote().then(function (has) {
        if (!has) throw NB.error(NB.CODES.NOT_CONFIGURED,
          "Im Haushalt liegt noch kein Kochbuch. Erst hochladen, dann abgleichen.");
        return true;
      });
    }).then(function () {
      COLLECTIONS.forEach(function (c) {
        unsubs.push(hhRef().collection(c.coll).onSnapshot(function (qs) {
          var arr = [];
          qs.forEach(function (d) { arr.push(Object.assign({ id: d.id }, stripMeta(d.data()))); });
          applyRemote(function (st) { st[c.key] = arr; });
        }, function (e) { log.error("Snapshot " + c.coll, e.code); NB.bus.emit("cloud:error", mapAuthError(e)); }));
      });

      unsubs.push(hhRef().collection("menuPlan").onSnapshot(function (qs) {
        var plan = {};
        qs.forEach(function (d) { plan[d.id] = stripMeta(d.data()); });
        applyRemote(function (st) { st.menuPlan = plan; });
      }, function (e) { log.error("Snapshot menuPlan", e.code); }));

      log.info("Live-Abgleich aktiv");
      NB.bus.emit("cloud:watching", { on: true });
    });
  };

  cloud.unwatch = function () {
    unsubs.forEach(function (u) { try { u(); } catch (e) {} });
    unsubs = [];
    NB.bus.emit("cloud:watching", { on: false });
  };
  cloud.isWatching = function () { return unsubs.length > 0; };

  function stripMeta(d) {
    var o = Object.assign({}, d);
    delete o.updatedAt; delete o.updatedBy;
    return o;
  }

  function applyRemote(fn) {
    if (!NB.app) return;
    applyingRemote = true;
    try {
      fn(NB.app.getState());
      snapshotHashes();          // Fernstand ist jetzt der Referenzstand
      NB.app.persist();
      NB.app.render();
    } finally { applyingRemote = false; }
  }

  // ---------- Schreiben aus der App heraus ----------
  /* Statt jeden Aufrufer in index.html umzubauen, wird nach jedem persist()
     verglichen, was sich geaendert hat, und nur das hochgeladen. */
  function hashesKey() { return "cloud-hashes"; }
  function currentHashes() {
    var st = NB.app ? NB.app.getState() : null;
    var h = {};
    if (!st) return h;
    COLLECTIONS.forEach(function (c) {
      (st[c.key] || []).forEach(function (item) {
        if (item && item.id) h[c.coll + "/" + item.id] = NB.util.hash(JSON.stringify(item));
      });
    });
    Object.keys(st.menuPlan || {}).forEach(function (day) {
      h["menuPlan/" + day] = NB.util.hash(JSON.stringify(st.menuPlan[day]));
    });
    return h;
  }
  function snapshotHashes() { NB.store.set(hashesKey(), currentHashes()); }
  cloud.snapshotHashes = snapshotHashes;

  cloud.pushChanges = function () {
    if (!cloud.isWatching() || applyingRemote) return Promise.resolve({ skipped: true });
    var prev = NB.store.get(hashesKey(), {});
    var now = currentHashes();
    var st = NB.app.getState();
    var writes = [], deletes = [];

    Object.keys(now).forEach(function (path) { if (prev[path] !== now[path]) writes.push(path); });
    Object.keys(prev).forEach(function (path) { if (now[path] === undefined) deletes.push(path); });
    if (!writes.length && !deletes.length) return Promise.resolve({ changed: 0 });

    function itemFor(path) {
      var i = path.indexOf("/");
      var coll = path.slice(0, i), id = path.slice(i + 1);
      if (coll === "menuPlan") return { coll: coll, id: id, data: st.menuPlan[id] };
      var c = COLLECTIONS.filter(function (x) { return x.coll === coll; })[0];
      if (!c) return null;
      var item = (st[c.key] || []).filter(function (x) { return String(x.id) === id; })[0];
      return item ? { coll: coll, id: id, data: item } : null;
    }

    var chain = Promise.resolve();
    writes.forEach(function (path) {
      chain = chain.then(function () {
        var it = itemFor(path);
        return it ? cloud.saveDoc(it.coll, it.id, it.data) : null;
      });
    });
    deletes.forEach(function (path) {
      chain = chain.then(function () {
        var i = path.indexOf("/");
        return cloud.deleteDoc(path.slice(0, i), path.slice(i + 1));
      });
    });

    return chain.then(function () {
      snapshotHashes();
      log.debug("Hochgeladen: " + writes.length + " geaendert, " + deletes.length + " geloescht");
      return { changed: writes.length, removed: deletes.length };
    }).catch(function (e) {
      log.error("Hochladen fehlgeschlagen", e.code, e.message);
      NB.bus.emit("cloud:error", e);
      throw e;
    });
  };

  /* Von der App-Bruecke nach jedem persist() aufgerufen – gebuendelt, damit
     Stepper-Klicks nicht je einen Schreibvorgang ausloesen. */
  cloud.schedulePush = function () {
    if (!cloud.isWatching() || applyingRemote) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      cloud.pushChanges().catch(function () {});
    }, 1200);
  };

  NB.bus.on("app:persist", function () { cloud.schedulePush(); });
})();
