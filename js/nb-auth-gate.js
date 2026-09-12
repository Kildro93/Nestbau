/* Nestbau v2 – Verpflichtendes Anmelde-Gate.

   Nur aktiv, wenn Firebase konfiguriert ist (js/nb-config.local.js). Eine
   frische Installation ohne Firebase-Projekt bleibt weiterhin ganz ohne
   Konto nutzbar - das ist der Standardfall und aendert sich hier nicht.

   Ist Firebase eingerichtet, verlangt dieses Modul vor dem ersten Blick auf
   die App: Anmeldung (Google oder Email/Passwort) -> Mindest-Profil (Name) ->
   Haushalt anlegen/beitreten/waehlen. Reine UI-Schicht; die eigentliche
   Logik liegt in NB.cloud (js/nb-firebase.js) und NB.profile (js/nb-profile.js). */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("authgate");

  var overlay = null;
  var panel = null;
  var mode = "login"; // login | register | profile | household
  var busy = {};

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "style") n.style.cssText = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function injectStyle() {
    if (document.getElementById("nb-gate-style")) return;
    var css =
      "#nb-auth-gate{position:fixed;inset:0;background:rgba(20,20,18,0.55);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px;}" +
      "#nb-auth-gate .nb-gate-panel{background:var(--surface);border-radius:18px;padding:20px;max-width:380px;width:100%;max-height:90vh;overflow:auto;}" +
      "#nb-auth-gate h2{margin:0 0 4px;font-size:1.1rem;}" +
      "#nb-auth-gate p.nb-gate-sub{margin:0 0 14px;font-size:0.8rem;color:var(--ink-soft);line-height:1.4;}" +
      "#nb-auth-gate input, #nb-auth-gate select{width:100%;margin-top:8px;}" +
      "#nb-auth-gate .nb-gate-actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;}" +
      "#nb-auth-gate .nb-gate-actions .btn{flex:1;min-width:120px;}" +
      "#nb-auth-gate .nb-gate-msg{font-size:0.75rem;margin-top:10px;line-height:1.4;}" +
      "#nb-auth-gate .nb-gate-msg.err{color:var(--maroon);}";
    document.head.appendChild(el("style", { id: "nb-gate-style" }, css));
  }

  function button(label, fn, ghost) {
    var b = el("button", { class: "btn" + (ghost ? " btn-ghost" : ""), type: "button" }, esc(label));
    b.addEventListener("click", function () {
      if (busy[label]) return;
      busy[label] = true;
      var old = b.textContent;
      b.textContent = "…"; b.disabled = true;
      Promise.resolve().then(fn)
        .catch(function (e) {
          if (e && e.code === NB.CODES.ABORTED && !e.message) return;
          showMsg(NB.errorText(e), true);
        })
        .then(function () {
          busy[label] = false;
          // Panel kann durch evaluate() inzwischen neu aufgebaut worden sein -
          // der alte Knopf haengt dann in keinem Dokument mehr, das ist ok.
          b.textContent = old; b.disabled = false;
        });
    });
    return b;
  }

  function showMsg(text, isErr) {
    if (!panel) return;
    var old = panel.querySelector(".nb-gate-msg-live");
    if (old) old.remove();
    panel.appendChild(el("div", { class: "nb-gate-msg nb-gate-msg-live" + (isErr ? " err" : "") }, esc(text)));
  }

  // ---------- Schritte ----------
  function loginPanel() {
    panel.appendChild(el("h2", {}, "Anmelden"));
    panel.appendChild(el("p", { class: "nb-gate-sub" },
      "Nestbau ist mit einem gemeinsamen Haushalt verbunden - bitte zuerst anmelden."));

    panel.appendChild(button("Mit Google anmelden", function () { return NB.cloud.signInGoogle(); }));
    panel.appendChild(el("p", { class: "nb-gate-sub", style: "margin-top:14px;" }, "oder mit Email und Passwort:"));

    var emailInput = el("input", { type: "email", placeholder: "Email", autocomplete: "email" });
    var passInput = el("input", { type: "password", placeholder: "Passwort", autocomplete: "current-password" });
    panel.appendChild(emailInput);
    panel.appendChild(passInput);

    var actions = el("div", { class: "nb-gate-actions" });
    actions.appendChild(button("Anmelden", function () {
      var email = emailInput.value.trim(), pass = passInput.value;
      if (!email || !pass) return Promise.reject(NB.error(NB.CODES.ABORTED, "Email und Passwort eingeben."));
      return NB.cloud.signInEmail(email, pass);
    }));
    actions.appendChild(button("Neuer Account", function () { mode = "register"; render(); return Promise.resolve(); }, true));
    panel.appendChild(actions);

    var forgot = el("div", { class: "nb-gate-actions" });
    forgot.appendChild(button("Passwort vergessen", function () {
      var email = emailInput.value.trim();
      if (!email) return Promise.reject(NB.error(NB.CODES.ABORTED, "Erst Email eintragen, dann nochmal klicken."));
      return NB.cloud.resetPassword(email).then(function () { showMsg("Email zum Zuruecksetzen wurde verschickt.", false); });
    }, true));
    panel.appendChild(forgot);
  }

  function registerPanel() {
    panel.appendChild(el("h2", {}, "Konto erstellen"));
    panel.appendChild(el("p", { class: "nb-gate-sub" }, "Fuer den gemeinsamen Haushalt braucht es ein Konto."));

    var nameInput = el("input", { type: "text", placeholder: "Name", autocomplete: "name" });
    var emailInput = el("input", { type: "email", placeholder: "Email", autocomplete: "email" });
    var passInput = el("input", { type: "password", placeholder: "Passwort (mind. 6 Zeichen)", autocomplete: "new-password" });
    panel.appendChild(nameInput); panel.appendChild(emailInput); panel.appendChild(passInput);

    var actions = el("div", { class: "nb-gate-actions" });
    actions.appendChild(button("Konto erstellen", function () {
      var email = emailInput.value.trim(), pass = passInput.value;
      if (!email || !pass) return Promise.reject(NB.error(NB.CODES.ABORTED, "Email und Passwort eingeben."));
      return NB.cloud.registerEmail(email, pass, nameInput.value.trim());
    }));
    actions.appendChild(button("Ich habe schon ein Konto", function () { mode = "login"; render(); return Promise.resolve(); }, true));
    panel.appendChild(actions);
  }

  function profilePanel() {
    panel.appendChild(el("h2", {}, "Profil"));
    panel.appendChild(el("p", { class: "nb-gate-sub" }, "Kurz vorstellen, bevor es weitergeht. Alter und Gewicht sind optional."));

    var nameInput = el("input", { type: "text", placeholder: "Name" });
    var ageInput = el("input", { type: "number", placeholder: "Alter (optional)", min: "0", max: "120" });
    var weightInput = el("input", { type: "number", placeholder: "Gewicht in kg (optional)", min: "0", max: "400", step: "0.1" });
    panel.appendChild(nameInput); panel.appendChild(ageInput); panel.appendChild(weightInput);

    NB.profile.load().then(function (data) {
      if (data && data.name) nameInput.value = data.name;
    }).catch(function () {});

    var actions = el("div", { class: "nb-gate-actions" });
    actions.appendChild(button("Weiter", function () {
      var name = nameInput.value.trim();
      if (!name) return Promise.reject(NB.error(NB.CODES.ABORTED, "Bitte einen Namen eintragen."));
      return NB.profile.save({
        name: name,
        age: ageInput.value !== "" ? Number(ageInput.value) : null,
        weight: weightInput.value !== "" ? Number(weightInput.value) : null
      }).then(function () { evaluate(); });
    }));
    panel.appendChild(actions);

    var signOut = el("div", { class: "nb-gate-actions", style: "margin-top:20px;" });
    signOut.appendChild(button("Abmelden", function () { return NB.cloud.signOut(); }, true));
    panel.appendChild(signOut);
  }

  function householdPanel() {
    panel.appendChild(el("h2", {}, "Haushalt"));
    panel.appendChild(el("p", { class: "nb-gate-sub" }, "Neuen Haushalt anlegen oder mit dem Code eines bestehenden beitreten."));

    panel.appendChild(button("Haushalt anlegen", function () { return NB.cloud.ensureHousehold("Nestbau"); }));

    var codeInput = el("input", { type: "text", placeholder: "Beitrittscode", maxlength: "12", style: "margin-top:14px;" });
    panel.appendChild(codeInput);
    var joinActions = el("div", { class: "nb-gate-actions" });
    joinActions.appendChild(button("Beitreten", function () {
      var v = codeInput.value.trim();
      if (!v) return Promise.reject(NB.error(NB.CODES.ABORTED, "Bitte Code eingeben."));
      return NB.cloud.joinHousehold(v);
    }));
    panel.appendChild(joinActions);

    NB.profile.households().then(function (list) {
      if (!list.length) return;
      panel.appendChild(el("p", { class: "nb-gate-sub", style: "margin-top:14px;" }, "oder einen bekannten Haushalt waehlen:"));
      list.forEach(function (h) {
        var row = el("div", { class: "nb-gate-actions" });
        row.appendChild(button(h.name || h.id, function () { return NB.profile.switchHousehold(h.id); }, true));
        panel.appendChild(row);
      });
    }).catch(function () {});

    var signOut = el("div", { class: "nb-gate-actions", style: "margin-top:20px;" });
    signOut.appendChild(button("Abmelden", function () { return NB.cloud.signOut(); }, true));
    panel.appendChild(signOut);
  }

  function render() {
    injectStyle();
    if (!overlay) {
      overlay = el("div", { id: "nb-auth-gate" });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = "";
    panel = el("div", { class: "nb-gate-panel" });
    overlay.appendChild(panel);

    if (mode === "register") registerPanel();
    else if (mode === "profile") profilePanel();
    else if (mode === "household") householdPanel();
    else loginPanel();
  }

  function hide() {
    if (overlay) { overlay.remove(); overlay = null; panel = null; }
  }

  // ---------- Ablauf pruefen ----------
  function evaluate() {
    if (!NB.cloud.available() || !NB.profile) { hide(); return; }
    NB.cloud.init().then(function () {
      var u = NB.cloud.user();
      if (!u) { mode = "login"; render(); return; }
      return NB.profile.load().then(function (data) {
        if (!data || !data.name) { mode = "profile"; render(); return; }
        if (!NB.cloud.householdId()) { mode = "household"; render(); return; }
        hide();
      });
    }).catch(function (e) {
      // Netzfehler o.ae. duerfen die App nicht dauerhaft aussperren.
      log.warn("Gate-Pruefung fehlgeschlagen, App bleibt nutzbar:", e.code || e.message);
      hide();
    });
  }

  NB.bus.on("cloud:auth", function () { mode = "login"; evaluate(); });
  NB.bus.on("cloud:household", evaluate);

  document.addEventListener("DOMContentLoaded", evaluate);

  log.debug("Auth-Gate geladen");
})();
