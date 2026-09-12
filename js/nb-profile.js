/* Nestbau v2 – Nutzerprofil in Firestore.

   Datenmodell:
     users/{uid}   – email, name, age, weight, createdAt, updatedAt

   Ein Dokument pro Konto, getrennt von den Haushalts-Sammlungen: das Profil
   gehoert der Person, nicht dem Haushalt, und bleibt beim Wechsel oder
   Verlassen eines Haushalts erhalten. Wird bei der ersten Anmeldung (Login
   oder Registrierung) automatisch angelegt, falls es noch fehlt. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("profile");

  var profile = NB.profile = {};

  function ref() {
    var u = NB.cloud.requireUser();
    return NB.cloud.raw().db.collection("users").doc(u.uid);
  }

  /* Legt beim ersten Login das Dokument an, ruehrt ein vorhandenes nicht an. */
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
        createdAt: NB.cloud.raw().fb.firestore.FieldValue.serverTimestamp()
      };
      return ref().set(data).then(function () { return data; });
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

  // Nach jeder Anmeldung (Google, Email/Passwort, Sitzung wiederhergestellt)
  // dafuer sorgen, dass ein Nutzerdokument existiert.
  NB.bus.on("cloud:auth", function (e) {
    if (!(e && e.user)) return;
    profile.ensure().catch(function (err) {
      log.warn("Profil nicht anlegbar:", err.code || err.message);
    });
  });

  log.debug("Profil-Modul geladen");
})();
