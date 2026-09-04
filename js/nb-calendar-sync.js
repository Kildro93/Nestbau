/* Nestbau v2 – Sync-Motor fuer Google und Outlook.

   Ablauf je Durchlauf und Kalender:
     1. pull()  – inkrementell ueber syncToken (Google) bzw. deltaLink (Graph),
                  beim ersten Mal oder nach 410 GONE ueber das Zeitfenster.
     2. merge() – neutrale Termine in state.events spiegeln. Importierte Termine
                  bekommen stabile IDs "ext:<anbieter>:<externeId>[#datum]", damit
                  wiederholte Durchlaeufe nichts doppeln.
     3. push()  – nur wenn Richtung "both": lokale Termine anlegen/aendern/loeschen.

   Konfliktregel: der externe Kalender gewinnt beim Lesen (er ist die Quelle fuer
   importierte Termine). Beim Schreiben gewinnt Nestbau nur, wenn das etag noch
   passt; sonst wird der Termin als Konflikt markiert und nicht ueberschrieben. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("sync");

  var sync = NB.sync = {};
  var running = {};
  var autoTimer = null;

  function providers() { return NB.providers || {}; }
  function provider(id) {
    var p = providers()[id];
    if (!p) throw NB.error(NB.CODES.UNKNOWN, "Unbekannter Anbieter: " + id);
    return p;
  }

  // ---------- Zustand je Anbieter ----------
  /* { calendars: [{id,label,writable,enabled}], tokens: {calId: syncToken|deltaLink},
       pushed: {localId: {extId, calId, etag, hash}}, lastRun, lastError, lastReport } */
  function syncState(id) {
    return NB.store.get("sync:" + id, { calendars: [], tokens: {}, pushed: {}, lastRun: null, lastError: null, lastReport: null });
  }
  function saveSyncState(id, s) { NB.store.set("sync:" + id, s); }
  sync.state = syncState;
  sync.saveState = saveSyncState;

  sync.setCalendars = function (id, calendars) {
    var s = syncState(id);
    var prevEnabled = {};
    s.calendars.forEach(function (c) { prevEnabled[c.id] = c.enabled; });
    s.calendars = calendars.map(function (c) {
      return { id: c.id, label: c.label, writable: c.writable, primary: c.primary,
               enabled: prevEnabled[c.id] !== undefined ? prevEnabled[c.id] : !!c.primary };
    });
    saveSyncState(id, s);
    return s.calendars;
  };
  sync.toggleCalendar = function (id, calId, enabled) {
    var s = syncState(id);
    s.calendars.forEach(function (c) { if (c.id === calId) c.enabled = !!enabled; });
    if (!enabled) {
      delete s.tokens[calId];
      removeImported(id, calId);       // abgewaehlte Kalender raeumen sofort auf
    }
    saveSyncState(id, s);
    if (NB.app) { NB.app.persist(); NB.app.render(); }
  };

  // ---------- Bruecke zur App ----------
  function app() {
    if (!NB.app || !NB.app.getState) throw NB.error(NB.CODES.UNKNOWN, "App-Bruecke fehlt (NB.app)");
    return NB.app;
  }
  function events() { return app().getState().events; }

  function window_() {
    var p = NB.syncPrefs();
    var now = new Date();
    return {
      timeMin: NB.util.addDays(now, -Math.abs(p.pastDays)),
      timeMax: NB.util.addDays(now, Math.abs(p.futureDays))
    };
  }

  // ---------- Abbildung neutral -> Nestbau ----------
  var MAX_SPAN_DAYS = 60; // Schutz vor Terminen mit absurd langer Dauer

  function localId(providerId, externalId, dayKey, isSpan) {
    return "ext:" + providerId + ":" + externalId + (isSpan ? "#" + dayKey : "");
  }

  /* Ein neutraler Termin wird zu 1..n Nestbau-Terminen: mehrtaegige Eintraege
     werden auf Tage aufgeteilt, weil die Kalenderansicht nach e.date rendert. */
  function toLocalEvents(n, prefs) {
    var out = [];
    var start = n.startDate, end = n.endDate || n.startDate;
    var days = [];
    var d = new Date(start), guard = 0;
    while (NB.util.dateKey(d) <= end && guard++ < MAX_SPAN_DAYS) {
      days.push(NB.util.dateKey(d));
      d.setDate(d.getDate() + 1);
    }
    if (!days.length) days = [start];
    var isSpan = days.length > 1;

    days.forEach(function (key, i) {
      out.push({
        id: localId(n.provider, n.externalId, key, isSpan),
        title: n.title,
        allday: n.allday || isSpan,
        date: key,
        start: isSpan ? (i === 0 ? n.start : null) : n.start,
        end: isSpan ? (i === days.length - 1 ? n.end : null) : n.end,
        location: n.location || "",
        desc: n.desc || "",
        category: prefs.defaultCategory,
        assignee: prefs.defaultAssignee,
        reminder: null,
        recur: null,
        // Sync-Metadaten
        source: n.provider,
        externalId: n.externalId,
        externalCalendarId: n.calendarId,
        externalEtag: n.etag,
        externalLink: n.link,
        externalUpdated: n.updated,
        readonly: true,
        syncedAt: Date.now()
      });
    });
    return out;
  }

  function removeImported(providerId, calId, keepIds) {
    var st = app().getState();
    var keep = keepIds || null;
    st.events = st.events.filter(function (e) {
      if (e.source !== providerId) return true;
      if (calId && e.externalCalendarId !== calId) return true;
      if (keep && keep[e.id]) return true;
      return false;
    });
  }

  function mergeNeutral(providerId, calId, neutrals, deletedIds, fullResync) {
    var prefs = NB.syncPrefs();
    var st = app().getState();
    var byId = {};
    st.events.forEach(function (e) { byId[e.id] = e; });

    var seen = {};
    var added = 0, updated = 0;

    neutrals.forEach(function (n) {
      if (!n) return;
      toLocalEvents(n, prefs).forEach(function (le) {
        seen[le.id] = true;
        var prev = byId[le.id];
        if (!prev) { st.events.push(le); byId[le.id] = le; added++; return; }
        // Vom Nutzer lokal gesetzte Kategorie/Zuordnung nicht bei jedem Sync ueberschreiben.
        if (prev.categoryPinned) le.category = prev.category;
        if (prev.assigneePinned) le.assignee = prev.assignee;
        le.categoryPinned = prev.categoryPinned;
        le.assigneePinned = prev.assigneePinned;
        var changed = prev.externalEtag !== le.externalEtag || prev.title !== le.title ||
          prev.date !== le.date || prev.start !== le.start || prev.end !== le.end ||
          prev.location !== le.location || prev.desc !== le.desc || prev.allday !== le.allday;
        if (changed) updated++;
        Object.keys(le).forEach(function (k) { prev[k] = le[k]; });
      });
    });

    var removed = 0;
    if (fullResync) {
      // Vollabgleich: alles aus diesem Kalender, was nicht mehr geliefert wurde, faellt weg.
      var before = st.events.length;
      removeImported(providerId, calId, seen);
      removed = before - st.events.length;
    } else if (deletedIds && deletedIds.length) {
      var del = {};
      deletedIds.forEach(function (x) { del[x] = true; });
      var before2 = st.events.length;
      st.events = st.events.filter(function (e) {
        return !(e.source === providerId && e.externalCalendarId === calId && del[e.externalId]);
      });
      removed = before2 - st.events.length;
    }
    return { added: added, updated: updated, removed: removed };
  }

  // ---------- Lokal -> extern ----------
  /* Fingerabdruck der uebertragenen Felder: entscheidet, ob ein PATCH noetig ist. */
  function localHash(e) {
    return NB.util.hash([e.title, e.allday ? 1 : 0, e.date, e.start || "", e.end || "", e.location || "", e.desc || ""].join("|"));
  }
  function localToNeutral(e) {
    return {
      title: e.title, allday: !!e.allday, startDate: e.date, endDate: e.date,
      start: e.start, end: e.end, location: e.location || "", desc: e.desc || ""
    };
  }

  /* s wird vom Aufrufer durchgereicht, nicht neu geladen: run() speichert am Ende
     seine eigene Kopie: eine zweite hier wuerde die gerade ergaenzte
     pushed-Zuordnung wieder ueberschreiben und bei jedem Lauf neu anlegen. */
  function pushLocal(providerId, calId, s) {
    var p = provider(providerId);
    var prefs = NB.syncPrefs();
    var st = app().getState();
    var win = window_();
    var minKey = NB.util.dateKey(win.timeMin), maxKey = NB.util.dateKey(win.timeMax);

    var candidates = st.events.filter(function (e) {
      return !e.source && !e.readonly && e.date >= minKey && e.date <= maxKey && e.exportSkip !== true;
    }).slice(0, prefs.maxPushPerRun);

    var alive = {};
    st.events.forEach(function (e) { if (!e.source) alive[e.id] = e; });

    var created = 0, patched = 0, deleted = 0, conflicts = 0;
    var chain = Promise.resolve();

    candidates.forEach(function (e) {
      chain = chain.then(function () {
        var rec = s.pushed[e.id];
        var hash = localHash(e);
        var body = p.fromNeutral(localToNeutral(e));

        if (!rec) {
          return p.create(calId, body).then(function (res) {
            s.pushed[e.id] = { extId: res.id, calId: calId, etag: res.etag || res["@odata.etag"] || null, hash: hash };
            created++;
          });
        }
        if (rec.hash === hash) return null;   // unveraendert
        return p.update(rec.calId, rec.extId, body, rec.etag).then(function (res) {
          rec.etag = (res && (res.etag || res["@odata.etag"])) || rec.etag;
          rec.hash = hash;
          patched++;
        }).catch(function (err) {
          if (err.code === NB.CODES.CONFLICT) {
            e.syncConflict = true; conflicts++;   // extern geaendert – nicht ueberschreiben
            return null;
          }
          if (err.code === NB.CODES.NOT_FOUND) {
            delete s.pushed[e.id];                // extern geloescht – naechster Lauf legt neu an
            return null;
          }
          throw err;
        });
      });
    });

    // Lokal geloescht -> extern loeschen.
    Object.keys(s.pushed).forEach(function (lid) {
      if (alive[lid]) return;
      var rec = s.pushed[lid];
      chain = chain.then(function () {
        return p.remove(rec.calId, rec.extId).then(function () {
          delete s.pushed[lid];
          deleted++;
        }).catch(function (err) {
          if (err.code === NB.CODES.NOT_FOUND) { delete s.pushed[lid]; return null; }
          throw err;
        });
      });
    });

    return chain.then(function () {
      saveSyncState(providerId, s);
      return { created: created, patched: patched, deleted: deleted, conflicts: conflicts };
    });
  }

  // ---------- Durchlauf ----------
  sync.run = function (providerId, opts) {
    opts = opts || {};
    if (running[providerId]) return running[providerId];

    var p;
    try { p = provider(providerId); } catch (e) { return Promise.reject(e); }

    var prefs = NB.syncPrefs();
    var s = syncState(providerId);
    var report = { provider: providerId, startedAt: Date.now(), calendars: [], added: 0, updated: 0, removed: 0,
                   created: 0, patched: 0, deleted: 0, conflicts: 0, errors: [] };

    NB.bus.emit("sync:start", { provider: providerId });

    var run = Promise.resolve().then(function () {
      if (!p.isConfigured()) throw NB.error(NB.CODES.NOT_CONFIGURED, providerId + " nicht eingerichtet");
      if (!p.isConnected()) throw NB.error(NB.CODES.AUTH_REQUIRED, providerId + " nicht verbunden");
      if (!NB.online.is()) throw NB.error(NB.CODES.NETWORK, "offline");
      // Kalenderliste beim ersten Lauf holen.
      if (!s.calendars.length) return p.listCalendars().then(function (cals) { s.calendars = sync.setCalendars(providerId, cals); });
    }).then(function () {
      var enabled = s.calendars.filter(function (c) { return c.enabled; });
      if (!enabled.length) { report.errors.push({ code: "NO_CALENDAR", text: "Kein Kalender ausgewaehlt." }); return; }

      var chain = Promise.resolve();
      enabled.forEach(function (cal) {
        chain = chain.then(function () { return syncOneCalendar(p, cal, s, prefs, opts, report); });
      });
      return chain;
    }).then(function () {
      s.lastRun = Date.now();
      s.lastError = report.errors.length ? report.errors[0] : null;
      s.lastReport = report;
      saveSyncState(providerId, s);
      if (NB.app) { NB.app.persist(); NB.app.render(); }
      report.finishedAt = Date.now();
      NB.bus.emit("sync:done", report);
      log.info("Sync " + providerId + " fertig", report);
      return report;
    }).catch(function (e) {
      s.lastRun = Date.now();
      s.lastError = { code: e.code || "UNKNOWN", text: NB.errorText(e) };
      s.lastReport = report;
      saveSyncState(providerId, s);
      report.finishedAt = Date.now();
      report.fatal = s.lastError;
      NB.bus.emit("sync:error", { provider: providerId, error: e, report: report });
      log.error("Sync " + providerId + " fehlgeschlagen", e.code, e.message);
      throw e;
    }).then(function (r) { delete running[providerId]; return r; },
            function (e) { delete running[providerId]; throw e; });

    running[providerId] = run;
    return run;
  };

  function syncOneCalendar(p, cal, s, prefs, opts, report) {
    var win = window_();
    var tokenKey = cal.id;
    var saved = opts.full ? null : s.tokens[tokenKey];

    function doPull(withToken) {
      var arg = { calendarId: cal.id, timeMin: win.timeMin, timeMax: win.timeMax };
      if (p.id === "google") arg.syncToken = withToken || null;
      else arg.deltaLink = withToken || null;
      return p.pull(arg);
    }

    return doPull(saved).then(function (res) {
      // Token abgelaufen -> einmal vollstaendig nachladen.
      if (res.fullResync) {
        log.warn("Sync-Marke fuer " + cal.label + " ungueltig, lade vollstaendig neu");
        delete s.tokens[tokenKey];
        return doPull(null).then(function (r2) { return { res: r2, full: true }; });
      }
      return { res: res, full: !saved };
    }).then(function (w) {
      var res = w.res;
      var neutrals = res.raw.map(function (r) { return p.toNeutral(r, cal.id); }).filter(Boolean);
      var m = mergeNeutral(p.id, cal.id, neutrals, res.deletedIds, w.full);
      report.added += m.added; report.updated += m.updated; report.removed += m.removed;
      var newToken = res.nextSyncToken || res.nextDeltaLink || null;
      if (newToken) s.tokens[tokenKey] = newToken; else delete s.tokens[tokenKey];
      report.calendars.push({ id: cal.id, label: cal.label, added: m.added, updated: m.updated, removed: m.removed, full: w.full });

      if (prefs.direction === "both" && cal.writable) {
        return pushLocal(p.id, cal.id, s).then(function (pr) {
          report.created += pr.created; report.patched += pr.patched;
          report.deleted += pr.deleted; report.conflicts += pr.conflicts;
        });
      }
    }).catch(function (e) {
      // Ein kaputter Kalender darf die anderen nicht mitreissen.
      report.errors.push({ calendar: cal.label, code: e.code || "UNKNOWN", text: NB.errorText(e) });
      if (e.code === NB.CODES.AUTH_EXPIRED || e.code === NB.CODES.NOT_CONFIGURED) throw e;
    });
  }

  sync.runAll = function (opts) {
    var ids = Object.keys(providers()).filter(function (id) { return providers()[id].isConnected(); });
    var reports = [];
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return sync.run(id, opts).then(function (r) { reports.push(r); }, function (e) { reports.push({ provider: id, fatal: { code: e.code, text: NB.errorText(e) } }); });
      });
    });
    return chain.then(function () { return reports; });
  };

  /* Alle importierten Termine eines Anbieters entfernen – beim Trennen. */
  sync.purge = function (providerId) {
    if (!NB.app) return;
    var st = app().getState();
    var before = st.events.length;
    st.events = st.events.filter(function (e) { return e.source !== providerId; });
    NB.store.del("sync:" + providerId);
    NB.app.persist(); NB.app.render();
    log.info("Entfernt: " + (before - st.events.length) + " importierte Termine von " + providerId);
  };

  // ---------- Automatik ----------
  sync.startAuto = function () {
    sync.stopAuto();
    var mins = NB.syncPrefs().autoSyncMinutes;
    if (!mins) return;
    autoTimer = setInterval(function () {
      if (!NB.online.is() || document.hidden) return;
      sync.runAll().catch(function () {});
    }, mins * 60 * 1000);
    log.debug("Auto-Sync alle " + mins + " Minuten");
  };
  sync.stopAuto = function () { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } };

  // Nach Rueckkehr ins Netz einmal nachziehen.
  NB.bus.on("online", function () { setTimeout(function () { sync.runAll().catch(function () {}); }, 2000); });

  /* Zusammenfassung fuer die Oberflaeche. */
  sync.summary = function (providerId) {
    var s = syncState(providerId);
    return {
      lastRun: s.lastRun,
      lastError: s.lastError,
      calendars: s.calendars,
      enabledCount: s.calendars.filter(function (c) { return c.enabled; }).length,
      report: s.lastReport
    };
  };
})();
