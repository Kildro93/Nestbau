/* Nestbau v2 – Migration des Kochbuchs vom localStorage nach Firebase.

   Grundsaetze:
   - Vorher wird gesichert. Die Sicherung geht als Datei in den Download-Ordner
     und zusaetzlich (wenn der Platz reicht) in den localStorage.
   - Idempotent: Dokument-IDs sind die vorhandenen lokalen IDs. Ein zweiter Lauf
     ueberschreibt dieselben Dokumente statt Duplikate anzulegen.
   - Bilder wandern zuerst in den Storage, weil ein Firestore-Dokument nur
     1 MiB fassen darf – ein einziges Kamerafoto sprengt das sonst.
   - Am Ende wird gegengelesen und die Anzahl verglichen. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("migrate");
  var migrate = NB.migrate = {};

  var BATCH_LIMIT = 400;          // Firestore erlaubt 500 Operationen; Puffer fuer Sicherheit
  var STATE_KEY = "nestbau-state-v1";

  function state() {
    if (!NB.app) throw NB.error(NB.CODES.UNKNOWN, "App-Bruecke fehlt (NB.app)");
    return NB.app.getState();
  }

  function countImages(obj, acc) {
    acc = acc || { count: 0, bytes: 0 };
    if (!obj || typeof obj !== "object") return acc;
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (NB.cloud.isDataUrl(v)) { acc.count++; acc.bytes += Math.round(v.length * 0.75); }
      else if (v && typeof v === "object") countImages(v, acc);
    });
    return acc;
  }

  /* Was wuerde migriert? Ohne jeden Schreibvorgang – fuer die Vorschau in der UI. */
  migrate.plan = function () {
    var st = state();
    var days = Object.keys(st.menuPlan || {}).filter(function (d) {
      var day = st.menuPlan[d];
      return day && Object.keys(day).some(function (slot) { return (day[slot] || []).length; });
    });
    var tasks = 0;
    (st.lists || []).forEach(function (l) { tasks += (l.items || []).length; });
    var img = countImages({
      ingredients: st.ingredients, recipes: st.recipes, ingredientCategories: st.ingredientCategories
    });
    var counts = {
      lists: (st.lists || []).length,
      tasks: tasks,
      events: (st.events || []).length,
      subscriptions: (st.subscriptions || []).length,
      ingredients: (st.ingredients || []).length,
      recipes: (st.recipes || []).length,
      ingredientCategories: (st.ingredientCategories || []).length,
      ingredientGroups: (st.ingredientGroups || []).length,
      customDishCategories: (st.customDishCategories || []).length,
      menuPlanDays: days.length
    };
    var docs = counts.lists + counts.tasks + counts.events + counts.subscriptions +
      counts.ingredients + counts.recipes + counts.ingredientCategories +
      counts.ingredientGroups + counts.customDishCategories + counts.menuPlanDays;
    return { counts: counts, documents: docs, images: img, days: days, stateBytes: NB.util.approxSize(st) };
  };

  // ---------- Sicherung ----------
  migrate.backup = function () {
    var st = state();
    var key = "migration-backup:" + new Date().toISOString().replace(/[:.]/g, "-");
    var json = JSON.stringify(st);
    var stored = NB.store.set(key, { savedAt: Date.now(), state: st });
    if (!stored) log.warn("Sicherung passt nicht in den localStorage – nur die Datei zaehlt.");
    // Datei-Download als zweite, verlaessliche Kopie.
    var name = "nestbau-vor-migration-" + NB.util.dateKey(new Date()) + ".json";
    try {
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    } catch (e) { log.warn("Download der Sicherung nicht moeglich", e); }
    return { key: stored ? key : null, file: name, bytes: json.length };
  };

  migrate.backups = function () {
    return NB.store.keys("migration-backup:").map(function (k) {
      var b = NB.store.get(k) || {};
      return { key: k, savedAt: b.savedAt || null };
    }).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
  };

  /* Setzt den kompletten lokalen Zustand auf eine Sicherung zurueck.
     Trennt vorher den Live-Abgleich, damit der alte Stand nicht sofort
     wieder von der Cloud ueberschrieben wird. */
  migrate.rollback = function (backupKey) {
    var b = NB.store.get(backupKey);
    if (!b || !b.state) return Promise.reject(NB.error(NB.CODES.NOT_FOUND, "Sicherung nicht gefunden."));
    if (NB.cloud) NB.cloud.unwatch();
    try { localStorage.setItem(STATE_KEY, JSON.stringify(b.state)); }
    catch (e) { return Promise.reject(NB.error(NB.CODES.QUOTA, "Zurueckschreiben fehlgeschlagen.")); }
    NB.store.del("cloud-hashes");
    log.info("Zurueckgesetzt auf", backupKey);
    return Promise.resolve(true);
  };

  // ---------- Migration ----------
  /* opts: { onProgress(step), dryRun } */
  migrate.run = function (opts) {
    opts = opts || {};
    var progress = opts.onProgress || function () {};
    var report = {
      startedAt: Date.now(), dryRun: !!opts.dryRun,
      uploadedImages: 0, writtenDocs: 0, skipped: 0, errors: [], verify: null, backup: null
    };

    function step(phase, text, pct) {
      progress({ phase: phase, text: text, pct: pct });
      NB.bus.emit("migrate:progress", { phase: phase, text: text, pct: pct });
    }

    return Promise.resolve().then(function () {
      step("check", "Voraussetzungen pruefen …", 2);
      if (!NB.cloud.available()) throw NB.error(NB.CODES.NOT_CONFIGURED, "Firebase-Konfiguration fehlt.");
      return NB.cloud.init();
    }).then(function () {
      NB.cloud.requireUser();
      if (!NB.cloud.householdId()) throw NB.error(NB.CODES.NOT_CONFIGURED, "Kein Haushalt gewaehlt.");

      var plan = migrate.plan();
      report.plan = plan;
      if (!plan.documents) throw NB.error(NB.CODES.UNKNOWN, "Es gibt lokal nichts zu migrieren.");

      step("backup", "Sicherung anlegen …", 6);
      if (!opts.dryRun) report.backup = migrate.backup();

      step("images", "Bilder hochladen (" + plan.images.count + ", " + NB.util.bytes(plan.images.bytes) + ") …", 10);
      if (opts.dryRun) return null;
      return uploadAllImages(report, step);
    }).then(function () {
      if (opts.dryRun) { step("done", "Testlauf – nichts geschrieben.", 100); return report; }

      step("write", "Kochbuch schreiben …", 55);
      return writeAll(report, step).then(function () {
        step("verify", "Gegenlesen …", 88);
        return verify(report);
      }).then(function () {
        step("mark", "Migration vermerken …", 94);
        return NB.cloud.ref().collection("meta").doc("migration").set({
          schemaVersion: 2,
          migratedAt: NB.cloud.serverTime(),
          migratedBy: (NB.cloud.user() || {}).uid || null,
          counts: report.plan.counts,
          images: report.uploadedImages,
          appVersion: NB.VERSION
        }, { merge: true });
      }).then(function () {
        // Ab jetzt ist die Cloud fuehrend: Hashes als Referenz setzen und live gehen.
        NB.cloud.snapshotHashes();
        NB.store.set("cloud-migrated", { at: Date.now(), household: NB.cloud.householdId() });
        NB.store.set("cloud-remote-migrated", true);
        step("watch", "Live-Abgleich starten …", 97);
        // force: der Marker wurde soeben geschrieben, die Gegenpruefung waere
        // nur eine zusaetzliche Runde uebers Netz.
        return NB.cloud.watch({ force: true });
      }).then(function () {
        report.finishedAt = Date.now();
        step("done", "Fertig: " + report.writtenDocs + " Dokumente, " + report.uploadedImages + " Bilder.", 100);
        NB.bus.emit("migrate:done", report);
        log.info("Migration fertig", report);
        return report;
      });
    }).catch(function (e) {
      report.finishedAt = Date.now();
      report.fatal = { code: e.code || "UNKNOWN", text: NB.errorText(e) };
      step("error", NB.errorText(e), 100);
      NB.bus.emit("migrate:error", { error: e, report: report });
      log.error("Migration fehlgeschlagen", e);
      throw e;
    });
  };

  /* Bilder zuerst – in Serie, damit ein schwaches Mobilnetz nicht an zwanzig
     parallelen Uploads erstickt. Der Zustand wird dabei direkt umgeschrieben,
     die Base64-Daten verschwinden also auch lokal aus dem State. */
  function uploadAllImages(report, step) {
    var st = state();
    var targets = []
      .concat(st.ingredients || [])
      .concat(st.recipes || [])
      .concat(st.ingredientCategories || []);
    var total = targets.length || 1;
    var chain = Promise.resolve();

    targets.forEach(function (item, i) {
      chain = chain.then(function () {
        var before = countImages(item).count;
        if (!before) return null;
        return NB.cloud.externalizeImages(item).then(function () {
          report.uploadedImages += before;
          step("images", "Bilder hochladen … " + report.uploadedImages, 10 + Math.round(45 * (i / total)));
        }).catch(function (e) {
          // Ein misslungenes Bild darf die Migration nicht abbrechen.
          report.errors.push({ stage: "image", item: item.id || item.name, code: e.code, text: NB.errorText(e) });
          log.warn("Bild uebersprungen", item.id, e.code);
        });
      });
    });

    return chain.then(function () {
      if (NB.app) NB.app.persist();   // ohne Base64 ist der lokale State deutlich kleiner
      return null;
    });
  }

  /* Alles in Stapeln schreiben. Ein Dokument, das das Groessenlimit reisst,
     wird uebersprungen und im Bericht genannt statt den Stapel zu sprengen. */
  function writeAll(report, step) {
    var st = state();
    var raw = NB.cloud.raw();
    var hh = NB.cloud.ref();
    var ops = [];

    NB.cloud.COLLECTIONS.forEach(function (c) {
      (st[c.key] || []).forEach(function (item) {
        if (!item || !item.id) { report.skipped++; return; }
        ops.push({ ref: hh.collection(c.coll).doc(String(item.id)), data: item, label: c.coll + "/" + item.id });
      });
    });
    (report.plan.days || []).forEach(function (day) {
      ops.push({ ref: hh.collection("menuPlan").doc(day), data: st.menuPlan[day], label: "menuPlan/" + day });
    });

    var chain = Promise.resolve();
    for (var i = 0; i < ops.length; i += BATCH_LIMIT) {
      (function (slice, idx) {
        chain = chain.then(function () {
          var batch = raw.db.batch();
          var used = 0;
          slice.forEach(function (op) {
            var payload = JSON.parse(JSON.stringify(op.data, function (k, v) { return v === undefined ? null : v; }));
            var size = NB.util.approxSize(payload);
            if (size > 900 * 1024) {
              report.errors.push({ stage: "write", item: op.label, code: NB.CODES.QUOTA, text: "Zu gross: " + NB.util.bytes(size) });
              report.skipped++;
              return;
            }
            payload.updatedAt = NB.cloud.serverTime();
            payload.updatedBy = (NB.cloud.user() || {}).uid || null;
            batch.set(op.ref, payload, { merge: false });
            used++;
          });
          if (!used) return null;
          return NB.retry(function () { return batch.commit(); }, { tries: 3 }).then(function () {
            report.writtenDocs += used;
            step("write", "Kochbuch schreiben … " + report.writtenDocs + "/" + ops.length,
              55 + Math.round(30 * ((idx + slice.length) / ops.length)));
          }).catch(function (e) {
            var err = NB.cloud.mapError(e);
            report.errors.push({ stage: "batch", code: err.code, text: NB.errorText(err) });
            throw err;
          });
        });
      })(ops.slice(i, i + BATCH_LIMIT), i);
    }
    return chain;
  }

  /* Gegenlesen: Anzahl lokal vs. in Firestore. Abweichungen landen im Bericht,
     brechen die Migration aber nicht ab – die Sicherung existiert. */
  function verify(report) {
    var checks = NB.cloud.COLLECTIONS.map(function (c) { return { coll: c.coll, key: c.key }; });
    checks.push({ coll: "menuPlan", key: null });
    var result = {};
    var st = state();

    return checks.reduce(function (chain, c) {
      return chain.then(function () {
        return NB.cloud.ref().collection(c.coll).get().then(function (qs) {
          var local = c.key ? (st[c.key] || []).length : (report.plan.days || []).length;
          result[c.coll] = { local: local, remote: qs.size, ok: qs.size >= local };
          if (qs.size < local) {
            report.errors.push({ stage: "verify", item: c.coll, text: "Nur " + qs.size + " von " + local + " Dokumenten angekommen." });
          }
        });
      });
    }, Promise.resolve()).then(function () {
      report.verify = result;
      return result;
    });
  }

  migrate.isMigrated = function () { return !!NB.store.get("cloud-migrated"); };
})();
