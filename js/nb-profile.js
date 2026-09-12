/* Nestbau v2 – Nutzerprofil in Firestore.

   Datenmodell:
     users/{uid}   – email, name, age, weight, createdAt, updatedAt,
                     syncPrefs (Bereiche, die dieses Konto synchronisiert),
                     households (alle je beigetretenen Haushalte),
                     primaryHousehold (zuletzt aktiver Haushalt)

   Ein Dokument pro Konto, getrennt von den Haushalts-Sammlungen: das Profil
   gehoert der Person, nicht dem Haushalt, und bleibt beim Wechsel oder
   Verlassen eines Haushalts erhalten. Wird bei der ersten Anmeldung (Login
   oder Registrierung) automatisch angelegt, falls es noch fehlt. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("profile");

  var profile = NB.profile = {};
  var FEATURES = (NB.cloud && NB.cloud.FEATURES) || ["todos", "calendar", "budget", "meals"];

  function ref() {
    var u = NB.cloud.requireUser();
    return NB.cloud.raw().db.collection("users").doc(u.uid);
  }

  // ---------- Profil-Dokument ----------
  /* Legt beim ersten Login das Dokument an, ruehrt ein vorhandenes nicht an.
     Stellt ausserdem lokale Caches her (Sync-Praeferenzen, zuletzt aktiver
     Haushalt), damit auch ein zweites Geraet denselben Stand sieht. */
  profile.ensure = function () {
    return NB.cloud.init().then(function () {
      return ref().get();
    }).then(function (snap) {
      if (snap.exists) return snap.data();
      var u = NB.cloud.requireUser();
      var data = {
        email: u.email || null,
        name: u.displayName || null,
        age: null,
        weight: null,
        syncPrefs: defaultSyncPrefs(),
        households: [],
        primaryHousehold: null,
        createdAt: NB.cloud.raw().fb.firestore.FieldValue.serverTimestamp()
      };
      return ref().set(data).then(function () { return data; });
    }).then(function (data) {
      applyRemotePrefs(data.syncPrefs);
      // Geraetewechsel: kein lokaler Haushalt gemerkt, aber im Profil einer -
      // uebernehmen, damit man nicht auf jedem Geraet neu beitreten muss.
      if (!NB.cloud.householdId() && data.primaryHousehold) {
        NB.cloud.setHouseholdId(data.primaryHousehold);
      }
      return data;
    }).catch(function (e) { throw NB.cloud.mapError(e); });
  };

  profile.load = function () {
    return NB.cloud.init().then(function () {
      return ref().get();
    }).then(function (snap) { return snap.exists ? snap.data() : null; })
      .catch(function (e) { throw NB.cloud.mapError(e); });
  };

  /* Teilupdate - nur die uebergebenen Felder aendern sich. */
  profile.save = function (patch) {
    return NB.cloud.init().then(function () {
      var data = Object.assign({}, patch);
      data.updatedAt = NB.cloud.raw().fb.firestore.FieldValue.serverTimestamp();
      return ref().set(data, { merge: true });
    }).catch(function (e) { throw NB.cloud.mapError(e); });
  };

  // ---------- Sync-Praeferenzen (pro Bereich, nicht pro Sammlung) ----------
  /* Lokal gecacht, damit js/nb-firebase.js synchron entscheiden kann, welche
     Sammlungen abgeglichen werden - Firestore-Zugriffe sind immer async.
     Ohne Firestore-Wert (noch nicht geladen) gilt "alles an", das bisherige
     Verhalten. */
  function defaultSyncPrefs() {
    var out = {};
    FEATURES.forEach(function (f) { out[f] = true; });
    return out;
  }
  var cachedPrefs = Object.assign(defaultSyncPrefs(), NB.store.get("sync-feature-prefs") || {});

  function applyRemotePrefs(remote) {
    if (!remote) return;
    cachedPrefs = Object.assign(defaultSyncPrefs(), remote);
    NB.store.set("sync-feature-prefs", cachedPrefs);
  }

  profile.syncPrefs = function () { return cachedPrefs; };

  profile.setSyncPref = function (feature, enabled) {
    cachedPrefs = Object.assign({}, cachedPrefs);
    cachedPrefs[feature] = !!enabled;
    NB.store.set("sync-feature-prefs", cachedPrefs);
    var saved = profile.save({ syncPrefs: cachedPrefs });
    // Laeuft der Abgleich schon, deckt er die neue Auswahl erst nach Neustart
    // der Listener ab - unwatch() loescht keine lokalen Aenderungen.
    if (NB.cloud && NB.cloud.restartWatch) NB.cloud.restartWatch().catch(function () {});
    return saved;
  };

  // ---------- Mehrere Haushalte pro Konto ----------
  /* households: [{id, name}], primaryHousehold: zuletzt aktive id. Wird ueber
     das "cloud:household"-Ereignis automatisch nachgefuehrt - sowohl beim
     Anlegen/Beitreten (js/nb-firebase.js) als auch beim manuellen Wechsel
     (profile.switchHousehold unten), damit jeder Weg denselben Eintrag hinterlaesst. */
  profile.households = function () {
    return profile.load().then(function (data) { return (data && data.households) || []; });
  };

  profile.addHousehold = function (hid, name) {
    return profile.load().then(function (data) {
      var list = (data && data.households) || [];
      var existing = list.filter(function (h) { return h.id === hid; })[0];
      if (existing) { if (name) existing.name = name; }
      else list.push({ id: hid, name: name || hid });
      return profile.save({ households: list, primaryHousehold: hid });
    });
  };

  /* Zu einem bereits im Profil gemerkten Haushalt wechseln. */
  profile.switchHousehold = function (hid) {
    return NB.cloud.switchHousehold(hid).then(function () {
      return profile.save({ primaryHousehold: hid });
    });
  };

  // ---------- Ereignisse ----------
  // Nach jeder Anmeldung (Google, Email/Passwort, Sitzung wiederhergestellt)
  // dafuer sorgen, dass ein Nutzerdokument existiert und die Caches stimmen.
  NB.bus.on("cloud:auth", function (e) {
    if (!(e && e.user)) return;
    profile.ensure().catch(function (err) {
      log.warn("Profil nicht anlegbar:", err.code || err.message);
    });
  });

  // Haushalt angelegt, beigetreten oder gewechselt - im Profil vermerken,
  // damit ein zweites Geraet dieselbe Liste sieht.
  NB.bus.on("cloud:household", function (e) {
    if (!(e && e.id) || !NB.cloud.user()) return;
    NB.cloud.householdInfo().then(function (info) {
      return profile.addHousehold(e.id, info && info.name);
    }).catch(function (err) {
      log.warn("Haushalt nicht im Profil vermerkt:", err.code || err.message);
    });
  });

  log.debug("Profil-Modul geladen");
})();
