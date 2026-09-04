/* Nestbau v2 – Google Kalender.

   Warum Google Identity Services (GIS) statt eigenem PKCE-Flow:
   Googles Token-Endpunkt verlangt fuer "Web application"-Clients ein
   Client-Secret. Ein Secret darf nicht in eine reine Frontend-App. Der von
   Google fuer SPAs vorgesehene Weg ist das GIS-Token-Modell: es liefert
   kurzlebige Access-Tokens (1 h) ohne Refresh-Token; Erneuerung laeuft still
   ueber requestAccessToken({prompt:""}) solange die Google-Sitzung im Browser
   besteht. Genau das bildet ensureToken() ab. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("google");
  var store = NB.oauth.TokenStore("google");

  var GIS_SRC = "https://accounts.google.com/gsi/client";
  var gisPromise = null;
  var tokenClient = null;

  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = GIS_SRC; s.async = true; s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        gisPromise = null;
        reject(NB.error(NB.CODES.NETWORK, "Google-Anmeldebibliothek konnte nicht geladen werden."));
      };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function client() {
    if (tokenClient) return tokenClient;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: NB.config.google.clientId,
      scope: NB.config.google.scopes,
      prompt: "",
      callback: function () {}   // wird pro Anfrage ueberschrieben
    });
    return tokenClient;
  }

  /* GIS arbeitet mit Callbacks; hier als Promise gekapselt.
     prompt "" = still (keine Interaktion), "consent" = Zustimmungsdialog. */
  function requestToken(prompt) {
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        var c = client();
        var settled = false;
        c.callback = function (resp) {
          if (settled) return;
          settled = true;
          if (resp && resp.error) {
            var code = resp.error === "access_denied" ? NB.CODES.ABORTED : NB.CODES.AUTH_EXPIRED;
            reject(NB.error(code, resp.error_description || resp.error));
            return;
          }
          if (!resp || !resp.access_token) { reject(NB.error(NB.CODES.AUTH_EXPIRED, "Kein Token erhalten.")); return; }
          resolve(resp);
        };
        c.error_callback = function (err) {
          if (settled) return;
          settled = true;
          var msg = (err && (err.message || err.type)) || "Anmeldung fehlgeschlagen";
          // popup_closed / popup_failed_to_open kommen vom Nutzer bzw. Popup-Blocker
          reject(NB.error(/closed|failed_to_open/.test(String(msg)) ? NB.CODES.ABORTED : NB.CODES.AUTH_EXPIRED, msg));
        };
        try { c.requestAccessToken({ prompt: prompt }); }
        catch (e) { settled = true; reject(NB.error(NB.CODES.UNKNOWN, e.message)); }
      });
    });
  }

  var api = {
    id: "google",
    label: "Google Kalender",
    store: store,

    isConfigured: function () { return NB.configured.google(); },
    isConnected: function () { return store.isConnected(); },

    status: function () {
      var t = store.get();
      if (!NB.env.secure()) return { state: "blocked", text: "Braucht http(s)" };
      if (!this.isConfigured()) return { state: "unconfigured", text: "Client-ID fehlt" };
      if (!t) return { state: "disconnected", text: "Nicht verbunden" };
      if (t.needsReauth) return { state: "reauth", text: "Neu anmelden noetig" };
      return { state: "connected", text: t.account || "Verbunden", account: t.account };
    },

    /* Erstverbindung – zeigt bewusst den Zustimmungsdialog. */
    connect: function () {
      NB.env.requireSecure();
      if (!this.isConfigured()) return Promise.reject(NB.error(NB.CODES.NOT_CONFIGURED, "google.clientId fehlt"));
      return requestToken("consent").then(function (resp) {
        store.save(resp);
        return api.loadAccount();
      }).then(function () {
        NB.bus.emit("provider:connected", { provider: "google" });
        return api.status();
      });
    },

    /* Token besorgen: gueltiges nehmen, sonst still erneuern. */
    ensureToken: function () {
      if (!this.isConfigured()) return Promise.reject(NB.error(NB.CODES.NOT_CONFIGURED, "google.clientId fehlt"));
      var t = store.get();
      if (!t) return Promise.reject(NB.error(NB.CODES.AUTH_REQUIRED, "Google nicht verbunden"));
      if (t.accessToken && !store.isExpired()) return Promise.resolve(t.accessToken);

      return NB.oauth.once("google", function () {
        return requestToken("").then(function (resp) {
          return store.save(resp).accessToken;
        }).catch(function (e) {
          // Stille Erneuerung scheitert, wenn die Google-Sitzung weg ist oder
          // der Nutzer den Zugriff im Konto entzogen hat.
          store.markReauth();
          throw NB.error(NB.CODES.AUTH_EXPIRED, "Google-Anmeldung abgelaufen – bitte neu verbinden.", { cause: e.code });
        });
      });
    },

    disconnect: function () {
      var t = store.get();
      store.clear();
      NB.store.del("sync:google");
      NB.bus.emit("provider:disconnected", { provider: "google" });
      if (t && t.accessToken && window.google && window.google.accounts) {
        try { window.google.accounts.oauth2.revoke(t.accessToken, function () {}); } catch (e) {}
      }
      return Promise.resolve();
    },

    // ---------- HTTP ----------
    call: function (path, opts) {
      opts = opts || {};
      return this.ensureToken().then(function (token) {
        var url = path.indexOf("http") === 0 ? path : NB.config.google.apiBase + path;
        var headers = { Authorization: "Bearer " + token };
        if (opts.body) headers["Content-Type"] = "application/json";
        if (opts.etag) headers["If-Match"] = opts.etag;
        return NB.retry(function () {
          return NB.http(url, {
            method: opts.method || "GET",
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined
          });
        }, { tries: opts.tries || 4 });
      }).then(function (r) { return r.body; }).catch(function (e) {
        if (e.code === NB.CODES.AUTH_EXPIRED) store.markReauth();
        throw e;
      });
    },

    loadAccount: function () {
      return this.call("/users/me/calendarList/primary").then(function (cal) {
        var t = store.get();
        if (t) { t.account = cal.id; t.primaryCalendarId = cal.id; store.set(t); }
        return cal.id;
      }).catch(function (e) {
        log.warn("Konto konnte nicht ermittelt werden", e.code);
        return null;
      });
    },

    listCalendars: function () {
      return this.call("/users/me/calendarList?minAccessRole=reader&maxResults=250").then(function (res) {
        return (res.items || []).map(function (c) {
          return {
            id: c.id,
            label: c.summaryOverride || c.summary,
            primary: !!c.primary,
            writable: c.accessRole === "owner" || c.accessRole === "writer",
            color: c.backgroundColor || null
          };
        });
      });
    },

    // ---------- Lesen ----------
    /* Erst-Sync nutzt Zeitfenster, Folge-Syncs den syncToken.
       Wichtig: syncToken darf NICHT mit timeMin/orderBy kombiniert werden –
       Google antwortet sonst mit 400. */
    pull: function (o) {
      var calendarId = o.calendarId;
      var out = [], deleted = [];
      var nextSyncToken = null;

      function page(pageToken) {
        var params = { maxResults: 250, singleEvents: true, showDeleted: !!o.syncToken, pageToken: pageToken };
        if (o.syncToken && !pageToken) params.syncToken = o.syncToken;
        else if (o.syncToken && pageToken) params.syncToken = o.syncToken;
        if (!o.syncToken) {
          params.timeMin = new Date(o.timeMin).toISOString();
          params.timeMax = new Date(o.timeMax).toISOString();
          params.orderBy = "startTime";
        }
        var url = "/calendars/" + encodeURIComponent(calendarId) + "/events?" + NB.oauth.query(params);
        return api.call(url).then(function (res) {
          (res.items || []).forEach(function (it) {
            if (it.status === "cancelled") deleted.push(it.id);
            else out.push(it);
          });
          if (res.nextPageToken) return page(res.nextPageToken);
          nextSyncToken = res.nextSyncToken || null;
        });
      }

      return page(null).then(function () {
        return { raw: out, deletedIds: deleted, nextSyncToken: nextSyncToken, fullResync: false };
      }).catch(function (e) {
        // 410 GONE: syncToken zu alt -> Aufrufer muss ohne Token neu laden.
        if (e.code === NB.CODES.GONE) return { raw: [], deletedIds: [], nextSyncToken: null, fullResync: true };
        throw e;
      });
    },

    // ---------- Schreiben ----------
    create: function (calendarId, body) {
      return this.call("/calendars/" + encodeURIComponent(calendarId) + "/events", { method: "POST", body: body });
    },
    update: function (calendarId, eventId, body, etag) {
      return this.call("/calendars/" + encodeURIComponent(calendarId) + "/events/" + encodeURIComponent(eventId),
        { method: "PATCH", body: body, etag: etag, tries: 1 });
    },
    remove: function (calendarId, eventId) {
      return this.call("/calendars/" + encodeURIComponent(calendarId) + "/events/" + encodeURIComponent(eventId),
        { method: "DELETE", tries: 1 }).catch(function (e) {
          if (e.code === NB.CODES.NOT_FOUND || e.code === NB.CODES.GONE) return null; // schon geloescht
          throw e;
        });
    },

    // ---------- Abbildung ----------
    /* Google-Event -> neutrale Zwischenform (siehe nb-calendar-sync.js). */
    toNeutral: function (g, calendarId) {
      var allday = !!(g.start && g.start.date);
      var startDate, endDate, startTime = null, endTime = null;
      if (allday) {
        startDate = g.start.date;
        // end.date ist bei Google exklusiv -> letzter belegter Tag = end - 1
        var ed = new Date(g.end && g.end.date ? g.end.date : g.start.date);
        ed.setDate(ed.getDate() - 1);
        endDate = NB.util.dateKey(ed);
        if (endDate < startDate) endDate = startDate;
      } else {
        var s = new Date(g.start.dateTime);
        var e2 = g.end && g.end.dateTime ? new Date(g.end.dateTime) : s;
        startDate = NB.util.dateKey(s); endDate = NB.util.dateKey(e2);
        startTime = NB.util.hhmm(s); endTime = NB.util.hhmm(e2);
      }
      return {
        provider: "google",
        externalId: g.id,
        calendarId: calendarId,
        etag: g.etag || null,
        title: g.summary || "(ohne Titel)",
        allday: allday,
        startDate: startDate,
        endDate: endDate,
        start: startTime,
        end: endTime,
        location: g.location || "",
        desc: g.description || "",
        updated: g.updated || null,
        link: g.htmlLink || null,
        writable: !g.locked && g.status !== "cancelled",
        organizer: (g.organizer && (g.organizer.email || g.organizer.displayName)) || null
      };
    },

    /* Neutrale Form -> Google-Body fuer create/update. */
    fromNeutral: function (n) {
      var body = {
        summary: n.title,
        location: n.location || undefined,
        description: n.desc || undefined
      };
      if (n.allday) {
        var end = new Date(n.endDate || n.startDate);
        end.setDate(end.getDate() + 1); // Google erwartet exklusives Enddatum
        body.start = { date: n.startDate };
        body.end = { date: NB.util.dateKey(end) };
      } else {
        var tz = NB.config.timeZone;
        body.start = { dateTime: NB.util.toRfc3339(n.startDate, n.start || "09:00"), timeZone: tz };
        body.end = { dateTime: NB.util.toRfc3339(n.endDate || n.startDate, n.end || n.start || "10:00"), timeZone: tz };
      }
      return body;
    }
  };

  NB.providers = NB.providers || {};
  NB.providers.google = api;
  log.debug("Google-Modul geladen");
})();
