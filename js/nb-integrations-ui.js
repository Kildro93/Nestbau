/* Nestbau v2 – Oberflaeche fuer Verbindungen in den Profileinstellungen.
   Haengt sich an den Container #nb-integrations im Einstellungs-Overlay. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("ui");
  var root = null;
  var busy = {};

  // ---------- kleine Helfer ----------
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
  function relTime(ts) {
    if (!ts) return "noch nie";
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "gerade eben";
    if (s < 3600) return "vor " + Math.round(s / 60) + " Min.";
    if (s < 86400) return "vor " + Math.round(s / 3600) + " Std.";
    return "vor " + Math.round(s / 86400) + " Tagen";
  }

  var STATE_COLORS = {
    connected: "var(--teal)", disconnected: "var(--line)", reauth: "var(--amber)",
    unconfigured: "var(--ink-soft)", blocked: "var(--maroon)", error: "var(--maroon)"
  };

  function injectStyle() {
    if (document.getElementById("nb-int-style")) return;
    var css =
      "#nb-integrations .nb-card{border:1px solid var(--line);border-radius:14px;padding:12px;margin-top:10px;background:var(--surface-sunken);}" +
      "#nb-integrations .nb-head{display:flex;align-items:center;gap:8px;}" +
      "#nb-integrations .nb-dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto;}" +
      "#nb-integrations .nb-title{font-weight:700;font-size:0.88rem;flex:1;}" +
      "#nb-integrations .nb-sub{font-size:0.72rem;color:var(--ink-soft);margin-top:2px;line-height:1.4;}" +
      "#nb-integrations .nb-msg{font-size:0.72rem;margin-top:8px;line-height:1.4;}" +
      "#nb-integrations .nb-msg.err{color:var(--maroon);}" +
      "#nb-integrations .nb-cals{margin-top:10px;display:flex;flex-direction:column;gap:6px;}" +
      "#nb-integrations .nb-cal{display:flex;align-items:center;gap:8px;font-size:0.78rem;}" +
      // Die App stylt input global auf width:100% – das wuerde die Checkbox die ganze
      // Zeile fuellen lassen und die Beschriftung an den Rand druecken.
      "#nb-integrations .nb-cal input[type=checkbox]{width:auto;flex:0 0 auto;margin:0;}" +
      "#nb-integrations .nb-cal>span{flex:1;}" +
      "#nb-integrations .nb-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}" +
      "#nb-integrations .nb-actions .btn{flex:1;min-width:120px;}" +
      "#nb-integrations .nb-field{display:flex;flex-direction:column;gap:4px;margin-top:8px;}" +
      "#nb-integrations .nb-field label{font-size:0.7rem;color:var(--ink-soft);}" +
      "#nb-integrations code{font-family:ui-monospace,Menlo,monospace;font-size:0.68rem;word-break:break-all;background:var(--surface);padding:2px 4px;border-radius:4px;}" +
      "#nb-integrations .nb-bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:8px;}" +
      "#nb-integrations .nb-bar>i{display:block;height:100%;background:var(--teal);transition:width .25s;}";
    document.head.appendChild(el("style", { id: "nb-int-style" }, css));
  }

  // ---------- Kalender-Anbieter ----------
  function providerCard(p) {
    var st = p.status();
    var sum = NB.sync.summary(p.id);
    var card = el("div", { class: "nb-card" });

    card.appendChild(el("div", { class: "nb-head" },
      '<span class="nb-dot" style="background:' + (STATE_COLORS[st.state] || STATE_COLORS.disconnected) + '"></span>' +
      '<span class="nb-title">' + esc(p.label) + "</span>" +
      '<span style="font-size:0.72rem;color:var(--ink-soft)">' + esc(st.text) + "</span>"));

    if (st.state === "blocked") {
      card.appendChild(el("div", { class: "nb-msg err" },
        "Die App laeuft ueber <code>" + esc(location.protocol) + "</code>. OAuth braucht http(s) – " +
        "die App per lokalem Server oder ueber die gehostete Adresse oeffnen."));
      return card;
    }
    if (st.state === "unconfigured") {
      card.appendChild(el("div", { class: "nb-msg" },
        "Client-ID fehlt. In <code>js/nb-config.local.js</code> eintragen. Redirect-URI fuer die Registrierung:<br><code>" +
        esc(NB.oauth.redirectUri()) + "</code>"));
      return card;
    }

    if (st.state === "connected" || st.state === "reauth") {
      card.appendChild(el("div", { class: "nb-sub" },
        "Letzter Abgleich: " + relTime(sum.lastRun) +
        (sum.enabledCount ? " · " + sum.enabledCount + " Kalender aktiv" : " · kein Kalender ausgewaehlt")));

      if (sum.calendars.length) {
        var cals = el("div", { class: "nb-cals" });
        sum.calendars.forEach(function (c) {
          var row = el("label", { class: "nb-cal" });
          var cb = el("input", { type: "checkbox" });
          cb.checked = !!c.enabled;
          cb.addEventListener("change", function () {
            NB.sync.toggleCalendar(p.id, c.id, cb.checked);
            render();
          });
          row.appendChild(cb);
          row.appendChild(el("span", {}, esc(c.label) + (c.writable ? "" : " <span style='color:var(--ink-soft)'>(nur lesen)</span>")));
          cals.appendChild(row);
        });
        card.appendChild(cals);
      }

      if (sum.lastError) {
        card.appendChild(el("div", { class: "nb-msg err" }, esc(sum.lastError.text || sum.lastError.code)));
      } else if (sum.report && (sum.report.added || sum.report.updated || sum.report.removed)) {
        var r = sum.report;
        card.appendChild(el("div", { class: "nb-msg" },
          "Zuletzt: " + r.added + " neu, " + r.updated + " geaendert, " + r.removed + " entfernt" +
          (r.conflicts ? " · " + r.conflicts + " Konflikte" : "")));
      }
    }

    var actions = el("div", { class: "nb-actions" });
    if (st.state === "connected") {
      actions.appendChild(button("Jetzt abgleichen", function (btn) {
        return NB.sync.run(p.id).then(function (rep) {
          msg(card, "Abgleich fertig: " + rep.added + " neu, " + rep.updated + " geaendert.", false);
        });
      }));
      actions.appendChild(button("Kalender neu laden", function () {
        return p.listCalendars().then(function (cals) { NB.sync.setCalendars(p.id, cals); });
      }, true));
      actions.appendChild(button("Trennen", function () {
        if (!window.confirm("Verbindung zu " + p.label + " trennen? Importierte Termine werden aus Nestbau entfernt.")) {
          return Promise.reject(NB.error(NB.CODES.ABORTED, ""));
        }
        NB.sync.purge(p.id);
        return p.disconnect();
      }, true));
    } else {
      actions.appendChild(button(st.state === "reauth" ? "Neu anmelden" : "Verbinden", function () {
        return p.connect().then(function () { return p.listCalendars(); })
          .then(function (cals) { NB.sync.setCalendars(p.id, cals); return NB.sync.run(p.id, { full: true }); })
          .then(function (rep) { msg(card, rep.added + " Termine importiert.", false); });
      }));
    }
    card.appendChild(actions);
    return card;
  }

  function button(label, fn, ghost) {
    var b = el("button", { class: "btn" + (ghost ? " btn-ghost" : ""), type: "button" }, esc(label));
    b.addEventListener("click", function () {
      if (busy[label]) return;
      busy[label] = true;
      var old = b.textContent;
      b.textContent = "…"; b.disabled = true;
      Promise.resolve().then(function () { return fn(b); })
        .catch(function (e) {
          if (e && e.code === NB.CODES.ABORTED && !e.message) return;
          var card = b.closest(".nb-card");
          if (card) msg(card, NB.errorText(e), true);
          else window.alert(NB.errorText(e));
        })
        .then(function () {
          busy[label] = false;
          b.textContent = old; b.disabled = false;
          render();
        });
    });
    return b;
  }

  function msg(card, text, isErr) {
    var old = card.querySelector(".nb-msg-live");
    if (old) old.remove();
    card.appendChild(el("div", { class: "nb-msg nb-msg-live" + (isErr ? " err" : "") }, esc(text)));
  }

  // ---------- Sync-Einstellungen ----------
  function prefsCard() {
    var p = NB.syncPrefs();
    var card = el("div", { class: "nb-card" });
    card.appendChild(el("div", { class: "nb-head" }, '<span class="nb-title">Abgleich-Einstellungen</span>'));

    function field(label, node) {
      var f = el("div", { class: "nb-field" });
      f.appendChild(el("label", {}, esc(label)));
      f.appendChild(node);
      return f;
    }
    function select(options, value, onChange) {
      var s = el("select", {});
      options.forEach(function (o) {
        var opt = el("option", { value: o[0] }, esc(o[1]));
        s.appendChild(opt);
      });
      s.value = value;
      s.addEventListener("change", function () { onChange(s.value); });
      return s;
    }

    card.appendChild(field("Richtung", select([
      ["read", "Nur importieren (empfohlen)"],
      ["both", "Importieren und Nestbau-Termine exportieren"]
    ], p.direction, function (v) { NB.setSyncPrefs({ direction: v }); render(); })));

    var cats = (NB.app && NB.app.categories ? NB.app.categories() : [{ id: "sonstiges", label: "Sonstiges" }])
      .map(function (c) { return [c.id, c.label]; });
    card.appendChild(field("Kategorie fuer importierte Termine",
      select(cats, p.defaultCategory, function (v) { NB.setSyncPrefs({ defaultCategory: v }); })));

    var people = NB.app && NB.app.people ? NB.app.people() : { a: { name: "Ich" }, b: { name: "Partnerin" } };
    card.appendChild(field("Sichtbar fuer", select([
      ["both", "Gemeinsam"], ["a", people.a.name], ["b", people.b.name]
    ], p.defaultAssignee, function (v) { NB.setSyncPrefs({ defaultAssignee: v }); })));

    card.appendChild(field("Automatisch abgleichen", select([
      [0, "Aus"], [15, "Alle 15 Minuten"], [30, "Alle 30 Minuten"], [60, "Stuendlich"]
    ], String(p.autoSyncMinutes), function (v) {
      NB.setSyncPrefs({ autoSyncMinutes: parseInt(v, 10) || 0 });
      NB.sync.startAuto();
    })));

    card.appendChild(el("div", { class: "nb-sub" },
      "Zeitfenster: " + p.pastDays + " Tage rueckwaerts, " + p.futureDays + " Tage vorwaerts."));

    if (p.direction === "both") {
      card.appendChild(el("div", { class: "nb-msg" },
        "Achtung: Nestbau-Termine werden in den ausgewaehlten, beschreibbaren Kalender geschrieben. " +
        "Loeschen in Nestbau loescht auch dort."));
    }
    return card;
  }

  // ---------- Cloud / Kochbuch ----------
  function cloudCard() {
    var card = el("div", { class: "nb-card" });
    var configured = NB.cloud.available();
    var user = NB.cloud.user && NB.cloud.user();
    var hid = NB.cloud.householdId();
    var state = !NB.env.secure() ? "blocked" : !configured ? "unconfigured" : user ? "connected" : "disconnected";

    card.appendChild(el("div", { class: "nb-head" },
      '<span class="nb-dot" style="background:' + STATE_COLORS[state] + '"></span>' +
      '<span class="nb-title">Kochbuch in der Cloud</span>' +
      '<span style="font-size:0.72rem;color:var(--ink-soft)">' +
      (state === "connected" ? esc(user.email || "angemeldet") : state === "unconfigured" ? "nicht eingerichtet" :
       state === "blocked" ? "braucht http(s)" : "nicht angemeldet") + "</span>"));

    if (state === "blocked") {
      card.appendChild(el("div", { class: "nb-msg err" }, "Firebase braucht http(s). Die App ueber einen Server oeffnen."));
      return card;
    }
    if (state === "unconfigured") {
      card.appendChild(el("div", { class: "nb-msg" },
        "Firebase-Konfiguration in <code>js/nb-config.local.js</code> eintragen. Anleitung: <code>docs/INTEGRATIONEN.md</code>"));
      return card;
    }

    var actions = el("div", { class: "nb-actions" });

    if (!user) {
      card.appendChild(el("div", { class: "nb-sub" },
        "Anmelden, damit Zutaten, Rezepte und Menueplan auf beiden Geraeten gleich sind."));
      actions.appendChild(button("Mit Google anmelden", function () {
        return NB.cloud.signInGoogle();
      }));
      card.appendChild(actions);
      return card;
    }

    card.appendChild(el("div", { class: "nb-sub" },
      hid ? "Haushalt: <code>" + esc(hid) + "</code>" : "Noch kein Haushalt – anlegen oder mit Code beitreten."));

    if (!hid) {
      actions.appendChild(button("Haushalt anlegen", function () {
        return NB.cloud.ensureHousehold("Nestbau");
      }));
      var codeInput = el("input", { type: "text", placeholder: "Beitrittscode", maxlength: "12", style: "flex:1;min-width:120px;" });
      actions.appendChild(codeInput);
      actions.appendChild(button("Beitreten", function () {
        var v = codeInput.value.trim();
        if (!v) return Promise.reject(NB.error(NB.CODES.ABORTED, "Bitte Code eingeben."));
        return NB.cloud.joinHousehold(v);
      }, true));
      card.appendChild(actions);
      return card;
    }

    // Haushalt vorhanden
    var migrated = NB.migrate.isMigrated();
    var plan = null;
    try { plan = NB.migrate.plan(); } catch (e) {}

    if (plan) {
      card.appendChild(el("div", { class: "nb-sub" },
        "Lokal: " + plan.counts.ingredients + " Zutaten, " + plan.counts.recipes + " Rezepte, " +
        plan.counts.menuPlanDays + " Menueplan-Tage, " + plan.images.count + " Bilder (" +
        NB.util.bytes(plan.images.bytes) + ")."));
    }

    var bar = el("div", { class: "nb-bar", style: "display:none" }, "<i style='width:0%'></i>");
    var barMsg = el("div", { class: "nb-msg", style: "display:none" });
    card.appendChild(bar); card.appendChild(barMsg);

    function onProgress(p) {
      bar.style.display = "block"; barMsg.style.display = "block";
      bar.querySelector("i").style.width = (p.pct || 0) + "%";
      barMsg.textContent = p.text;
      barMsg.className = "nb-msg" + (p.phase === "error" ? " err" : "");
    }

    // Liegt im Haushalt schon ein Kochbuch? Beim zweiten Geraet lautet die
    // Antwort ja – dort darf nur heruntergeladen, nicht hochgeladen werden.
    var remote = NB.cloud.remoteMigrated();
    if (remote === null) NB.cloud.checkRemote();   // Ergebnis loest ein erneutes Zeichnen aus

    if (!migrated && remote) {
      card.appendChild(el("div", { class: "nb-msg" },
        "In diesem Haushalt liegt bereits ein Kochbuch. Dieses Geraet uebernimmt es – " +
        "der lokale Bestand wird dabei durch den gemeinsamen ersetzt."));
      actions.appendChild(button("Kochbuch uebernehmen", function () {
        if (!window.confirm("Das Kochbuch aus der Cloud ersetzt den lokalen Bestand dieses Geraets. Vorher wird eine Sicherungsdatei heruntergeladen. Fortfahren?")) {
          return Promise.reject(NB.error(NB.CODES.ABORTED, ""));
        }
        NB.migrate.backup();
        return NB.cloud.watch({ force: true }).then(function () {
          NB.store.set("cloud-migrated", { at: Date.now(), household: NB.cloud.householdId(), joined: true });
        });
      }));
    } else if (!migrated) {
      actions.appendChild(button("Kochbuch hochladen", function () {
        if (!window.confirm("Zutaten, Rezepte und Menueplan werden in die Cloud uebertragen. Vorher wird eine Sicherungsdatei heruntergeladen. Fortfahren?")) {
          return Promise.reject(NB.error(NB.CODES.ABORTED, ""));
        }
        return NB.migrate.run({ onProgress: onProgress });
      }));
      actions.appendChild(button("Testlauf", function () {
        return NB.migrate.run({ dryRun: true, onProgress: onProgress });
      }, true));
    } else {
      card.appendChild(el("div", { class: "nb-sub" },
        NB.cloud.isWatching() ? "Live-Abgleich laeuft." : "Migriert, Live-Abgleich pausiert."));
      actions.appendChild(button(NB.cloud.isWatching() ? "Abgleich pausieren" : "Abgleich starten", function () {
        if (NB.cloud.isWatching()) { NB.cloud.unwatch(); return Promise.resolve(); }
        return NB.cloud.watch();
      }));
      actions.appendChild(button("Erneut hochladen", function () {
        if (!window.confirm("Der lokale Stand ueberschreibt die Cloud. Fortfahren?")) {
          return Promise.reject(NB.error(NB.CODES.ABORTED, ""));
        }
        return NB.migrate.run({ onProgress: onProgress });
      }, true));
    }

    actions.appendChild(button("Abmelden", function () { return NB.cloud.signOut(); }, true));
    card.appendChild(actions);

    // Beitrittscode zum Weitergeben
    var codeBox = el("div", { class: "nb-sub", style: "margin-top:8px" }, "Beitrittscode wird geladen …");
    card.appendChild(codeBox);
    NB.cloud.householdInfo().then(function (info) {
      codeBox.innerHTML = info && info.joinCode
        ? "Beitrittscode fuer das zweite Geraet: <code>" + esc(info.joinCode) + "</code>"
        : "";
    }).catch(function () { codeBox.textContent = ""; });

    // Rueckwege
    var backups = NB.migrate.backups();
    if (backups.length) {
      var b0 = backups[0];
      var restore = el("div", { class: "nb-actions" });
      restore.appendChild(button("Auf Stand vor der Migration zuruecksetzen", function () {
        if (!window.confirm("Der lokale Stand wird auf die Sicherung von " + new Date(b0.savedAt).toLocaleString("de-CH") + " zurueckgesetzt. Die App laedt danach neu.")) {
          return Promise.reject(NB.error(NB.CODES.ABORTED, ""));
        }
        return NB.migrate.rollback(b0.key).then(function () { location.reload(); });
      }, true));
      card.appendChild(restore);
    }

    return card;
  }

  // ---------- Aufbau ----------
  function render() {
    root = document.getElementById("nb-integrations");
    if (!root) return;
    injectStyle();
    root.innerHTML = "";

    root.appendChild(el("p", { class: "eyebrow", style: "margin-top:24px;" }, "Kalender verbinden"));
    ["google", "outlook"].forEach(function (id) {
      var p = NB.providers && NB.providers[id];
      if (p) root.appendChild(providerCard(p));
    });
    if (NB.providers && (NB.providers.google.isConnected() || NB.providers.outlook.isConnected())) {
      root.appendChild(prefsCard());
    }

    root.appendChild(el("p", { class: "eyebrow", style: "margin-top:24px;" }, "Cloud"));
    root.appendChild(cloudCard());
  }

  NB.ui = { render: render };

  ["auth:changed", "provider:connected", "provider:disconnected", "cloud:auth", "cloud:household", "cloud:watching", "cloud:remote", "sync:done", "sync:error"]
    .forEach(function (evt) { NB.bus.on(evt, function () { if (document.getElementById("nb-integrations")) render(); }); });

  document.addEventListener("DOMContentLoaded", function () {
    var open = document.getElementById("open-settings");
    if (open) open.addEventListener("click", function () { setTimeout(render, 0); });
    render();
  });

  log.debug("Integrations-UI geladen");
})();
