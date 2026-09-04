/* Nestbau v2 – Outlook / Microsoft Graph.

   Anders als bei Google ist hier kein Fremd-SDK noetig: Entra ID erlaubt fuer
   Redirect-URIs vom Typ "Single-Page Application" den Authorization-Code-Flow
   mit PKCE ohne Client-Secret und liefert dabei einen Refresh-Token. Deshalb
   eigener, schlanker Flow statt MSAL – eine Abhaengigkeit weniger, und die App
   bleibt ohne Build-Schritt lauffaehig.

   Voraussetzung in Entra ID: App-Registrierung -> Authentifizierung ->
   Plattform "Single-Page-Anwendung" mit exakt der Redirect-URI aus
   NB.oauth.redirectUri(). Bei "Web" statt "SPA" scheitert der Token-Tausch mit
   AADSTS9002326 (cross-origin token redemption). */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("outlook");
  var store = NB.oauth.TokenStore("outlook");

  function authority() {
    return "https://login.microsoftonline.com/" + (NB.config.outlook.tenant || "common") + "/oauth2/v2.0";
  }

  var api = {
    id: "outlook",
    label: "Outlook Kalender",
    store: store,

    isConfigured: function () { return NB.configured.outlook(); },
    isConnected: function () { return store.isConnected(); },

    status: function () {
      var t = store.get();
      if (!NB.env.secure()) return { state: "blocked", text: "Braucht http(s)" };
      if (!this.isConfigured()) return { state: "unconfigured", text: "Client-ID fehlt" };
      if (!t) return { state: "disconnected", text: "Nicht verbunden" };
      if (t.needsReauth) return { state: "reauth", text: "Neu anmelden noetig" };
      return { state: "connected", text: t.account || "Verbunden", account: t.account };
    },

    // ---------- Anmeldung ----------
    connect: function () {
      NB.env.requireSecure();
      if (!this.isConfigured()) return Promise.reject(NB.error(NB.CODES.NOT_CONFIGURED, "outlook.clientId fehlt"));

      var redirectUri = NB.oauth.redirectUri();
      var state = NB.oauth.randomString(16);
      var pk;

      return NB.oauth.pkce().then(function (p) {
        pk = p;
        var url = authority() + "/authorize?" + NB.oauth.query({
          client_id: NB.config.outlook.clientId,
          response_type: "code",
          redirect_uri: redirectUri,
          response_mode: "query",
          scope: NB.config.outlook.scopes,
          state: state,
          code_challenge: pk.challenge,
          code_challenge_method: pk.method,
          prompt: "select_account"
        });
        return NB.oauth.authorizePopup(url, { state: state, provider: "outlook" });
      }).then(function (params) {
        if (!params.code) throw NB.error(NB.CODES.ABORTED, "Kein Autorisierungscode erhalten.");
        return NB.oauth.tokenRequest(authority() + "/token", {
          client_id: NB.config.outlook.clientId,
          grant_type: "authorization_code",
          code: params.code,
          redirect_uri: redirectUri,
          code_verifier: pk.verifier,
          scope: NB.config.outlook.scopes
        });
      }).then(function (resp) {
        store.save(resp);
        return api.loadAccount();
      }).then(function () {
        NB.bus.emit("provider:connected", { provider: "outlook" });
        return api.status();
      }).catch(function (e) {
        // Der Token-Endpunkt antwortet bei Fehlkonfiguration mit 400 + AADSTS-Code.
        var body = e.meta && e.meta.body;
        if (body && /AADSTS9002326/.test(body)) {
          throw NB.error(NB.CODES.NOT_CONFIGURED,
            "Die Redirect-URI ist in Entra ID als \"Web\" registriert. Sie muss als \"Single-Page-Anwendung\" eingetragen sein.");
        }
        if (body && /AADSTS50011/.test(body)) {
          throw NB.error(NB.CODES.NOT_CONFIGURED, "Redirect-URI stimmt nicht: " + NB.oauth.redirectUri() + " in Entra ID eintragen.");
        }
        throw e;
      });
    },

    /* Gueltiges Token liefern; sonst per Refresh-Token erneuern.
       Microsoft rotiert den Refresh-Token bei jedem Einloesen – parallele
       Refreshes wuerden sich gegenseitig invalidieren, daher NB.oauth.once. */
    ensureToken: function () {
      if (!this.isConfigured()) return Promise.reject(NB.error(NB.CODES.NOT_CONFIGURED, "outlook.clientId fehlt"));
      var t = store.get();
      if (!t) return Promise.reject(NB.error(NB.CODES.AUTH_REQUIRED, "Outlook nicht verbunden"));
      if (t.accessToken && !store.isExpired()) return Promise.resolve(t.accessToken);
      if (!t.refreshToken) {
        store.markReauth();
        return Promise.reject(NB.error(NB.CODES.AUTH_EXPIRED, "Kein Refresh-Token – bitte neu verbinden."));
      }

      return NB.oauth.once("outlook", function () {
        var cur = store.get();
        if (cur && cur.accessToken && !store.isExpired()) return cur.accessToken; // waehrend des Wartens erneuert
        return NB.oauth.tokenRequest(authority() + "/token", {
          client_id: NB.config.outlook.clientId,
          grant_type: "refresh_token",
          refresh_token: cur.refreshToken,
          scope: NB.config.outlook.scopes
        }).then(function (resp) {
          return store.save(resp).accessToken;
        }).catch(function (e) {
          var body = (e.meta && e.meta.body) || "";
          // invalid_grant = Token widerrufen, abgelaufen oder Passwort geaendert.
          if (/invalid_grant|AADSTS70008|AADSTS50173|AADSTS700082/.test(body) || e.code === NB.CODES.AUTH_EXPIRED) {
            store.markReauth();
            throw NB.error(NB.CODES.AUTH_EXPIRED, "Outlook-Anmeldung abgelaufen – bitte neu verbinden.");
          }
          throw e;
        });
      });
    },

    disconnect: function () {
      store.clear();
      NB.store.del("sync:outlook");
      NB.bus.emit("provider:disconnected", { provider: "outlook" });
      // Ein serverseitiger Widerruf ist ohne Backend nicht moeglich; der Nutzer
      // kann die App unter myaccount.microsoft.com jederzeit vollstaendig entfernen.
      return Promise.resolve();
    },

    // ---------- HTTP ----------
    call: function (path, opts) {
      opts = opts || {};
      return this.ensureToken().then(function (token) {
        var url = path.indexOf("http") === 0 ? path : NB.config.outlook.graphBase + path;
        var headers = {
          Authorization: "Bearer " + token,
          Prefer: 'outlook.timezone="' + NB.config.timeZone + '", outlook.body-content-type="text"'
        };
        if (opts.body) headers["Content-Type"] = "application/json";
        if (opts.etag) headers["If-Match"] = opts.etag;
        if (opts.pageSize) headers.Prefer = headers.Prefer + ", odata.maxpagesize=" + opts.pageSize;
        return NB.retry(function () {
          return NB.http(url, {
            method: opts.method || "GET",
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined
          });
        }, { tries: opts.tries || 4 });
      }).then(function (r) { return r.body; }).catch(function (e) {
        if (e.code === NB.CODES.AUTH_EXPIRED) store.markReauth();
        // Graph meldet abgelaufene Delta-Tokens als 410 mit syncStateNotFound.
        var body = (e.meta && e.meta.body) || "";
        if (/syncStateNotFound|resyncRequired/.test(body)) throw NB.error(NB.CODES.GONE, "Delta-Token ungueltig");
        throw e;
      });
    },

    loadAccount: function () {
      return this.call("/me?$select=displayName,mail,userPrincipalName").then(function (me) {
        var t = store.get();
        var label = me.mail || me.userPrincipalName || me.displayName;
        if (t) { t.account = label; store.set(t); }
        return label;
      }).catch(function (e) {
        log.warn("Konto konnte nicht ermittelt werden", e.code);
        return null;
      });
    },

    listCalendars: function () {
      return this.call("/me/calendars?$select=id,name,canEdit,isDefaultCalendar,hexColor&$top=100").then(function (res) {
        return (res.value || []).map(function (c) {
          return {
            id: c.id,
            label: c.name,
            primary: !!c.isDefaultCalendar,
            writable: c.canEdit !== false,
            color: c.hexColor && c.hexColor !== "auto" ? c.hexColor : null
          };
        });
      });
    },

    // ---------- Lesen ----------
    /* calendarView/delta liefert aufgeloeste Serientermine im Zeitfenster.
       Beim Erst-Sync mit startDateTime/endDateTime, danach nur noch deltaLink. */
    pull: function (o) {
      var out = [], deleted = [];
      var deltaLink = null;
      var select = "id,subject,isAllDay,start,end,location,bodyPreview,lastModifiedDateTime,webLink,organizer,isCancelled,seriesMasterId,type";

      var first = o.deltaLink
        ? o.deltaLink
        : "/me/calendars/" + encodeURIComponent(o.calendarId) + "/calendarView/delta?" + NB.oauth.query({
            startDateTime: new Date(o.timeMin).toISOString(),
            endDateTime: new Date(o.timeMax).toISOString(),
            "$select": select
          });

      function page(url) {
        return api.call(url, { pageSize: 100 }).then(function (res) {
          (res.value || []).forEach(function (it) {
            if (it["@removed"] || it.isCancelled) deleted.push(it.id);
            else out.push(it);
          });
          if (res["@odata.nextLink"]) return page(res["@odata.nextLink"]);
          deltaLink = res["@odata.deltaLink"] || null;
        });
      }

      return page(first).then(function () {
        return { raw: out, deletedIds: deleted, nextDeltaLink: deltaLink, fullResync: false };
      }).catch(function (e) {
        if (e.code === NB.CODES.GONE) return { raw: [], deletedIds: [], nextDeltaLink: null, fullResync: true };
        throw e;
      });
    },

    // ---------- Schreiben ----------
    create: function (calendarId, body) {
      return this.call("/me/calendars/" + encodeURIComponent(calendarId) + "/events", { method: "POST", body: body });
    },
    update: function (calendarId, eventId, body, etag) {
      return this.call("/me/events/" + encodeURIComponent(eventId), { method: "PATCH", body: body, etag: etag, tries: 1 });
    },
    remove: function (calendarId, eventId) {
      return this.call("/me/events/" + encodeURIComponent(eventId), { method: "DELETE", tries: 1 })
        .catch(function (e) {
          if (e.code === NB.CODES.NOT_FOUND) return null;
          throw e;
        });
    },

    // ---------- Abbildung ----------
    toNeutral: function (g, calendarId) {
      var allday = !!g.isAllDay;
      var s = NB.util.parseNaive(g.start && g.start.dateTime);
      var e2 = NB.util.parseNaive(g.end && g.end.dateTime) || s;
      if (!s) return null;
      var startDate = NB.util.dateKey(s), endDate = NB.util.dateKey(e2);
      if (allday) {
        // Graph liefert bei Ganztagsterminen ein exklusives Ende (naechster Tag 00:00).
        var ed = new Date(e2.getTime()); ed.setDate(ed.getDate() - 1);
        endDate = NB.util.dateKey(ed);
        if (endDate < startDate) endDate = startDate;
      }
      return {
        provider: "outlook",
        externalId: g.id,
        calendarId: calendarId,
        etag: g["@odata.etag"] || null,
        title: g.subject || "(ohne Titel)",
        allday: allday,
        startDate: startDate,
        endDate: endDate,
        start: allday ? null : NB.util.hhmm(s),
        end: allday ? null : NB.util.hhmm(e2),
        location: (g.location && g.location.displayName) || "",
        desc: g.bodyPreview || "",
        updated: g.lastModifiedDateTime || null,
        link: g.webLink || null,
        writable: g.type !== "occurrence" && g.type !== "exception", // Serieninstanzen nicht einzeln zurueckschreiben
        organizer: (g.organizer && g.organizer.emailAddress && (g.organizer.emailAddress.address || g.organizer.emailAddress.name)) || null
      };
    },

    fromNeutral: function (n) {
      var tz = NB.config.timeZone;
      var body = {
        subject: n.title,
        isAllDay: !!n.allday,
        body: { contentType: "text", content: n.desc || "" },
        location: n.location ? { displayName: n.location } : undefined
      };
      if (n.allday) {
        var end = new Date(n.endDate || n.startDate);
        end.setDate(end.getDate() + 1); // Graph erwartet exklusives Ende
        body.start = { dateTime: n.startDate + "T00:00:00", timeZone: tz };
        body.end = { dateTime: NB.util.dateKey(end) + "T00:00:00", timeZone: tz };
      } else {
        body.start = { dateTime: (n.startDate) + "T" + (n.start || "09:00") + ":00", timeZone: tz };
        body.end = { dateTime: (n.endDate || n.startDate) + "T" + (n.end || n.start || "10:00") + ":00", timeZone: tz };
      }
      return body;
    }
  };

  NB.providers = NB.providers || {};
  NB.providers.outlook = api;
  log.debug("Outlook-Modul geladen");
})();
