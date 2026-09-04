/* Nestbau v2 – OAuth-Grundlagen: PKCE, Popup-Flow, Token-Verwaltung.

   Sicherheitshinweis: Nestbau ist eine reine Frontend-App ohne Backend. Es gibt
   deshalb kein Client-Secret – zulaessig ist ausschliesslich der PKCE-Flow fuer
   oeffentliche Clients. Tokens liegen im localStorage des Geraets; das ist der
   uebliche Kompromiss fuer SPAs (auch MSAL macht es so), bedeutet aber: wer
   fremden JavaScript-Code in die Seite bekommt, bekommt auch die Tokens.
   Deshalb keine fremden Skripte in index.html einbinden. */
(function () {
  "use strict";
  var NB = window.NB;
  var log = NB.log("oauth");

  var oauth = NB.oauth = {};

  // ---------- PKCE ----------
  function base64url(buf) {
    var bytes = new Uint8Array(buf), str = "";
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomString(len) {
    var arr = new Uint8Array(len || 32);
    crypto.getRandomValues(arr);
    return base64url(arr.buffer);
  }
  oauth.randomString = randomString;

  /* Erzeugt verifier + S256-challenge. */
  oauth.pkce = function () {
    var verifier = randomString(48);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
      .then(function (digest) { return { verifier: verifier, challenge: base64url(digest), method: "S256" }; });
  };

  oauth.query = function (params) {
    return Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
      .join("&");
  };

  oauth.redirectUri = function () {
    // Absolute URL auf die Callback-Seite neben index.html.
    return location.origin + location.pathname.replace(/[^/]*$/, "") + "oauth-callback.html";
  };

  // ---------- Popup-Flow ----------
  /* Oeffnet die Anmeldeseite in einem Popup und wartet auf die Rueckmeldung von
     oauth-callback.html (postMessage). Popup statt Voll-Redirect, damit der
     ungespeicherte App-Zustand (offene Overlays, Entwuerfe) nicht verloren geht. */
  oauth.authorizePopup = function (authUrl, opts) {
    opts = opts || {};
    NB.env.requireSecure();
    return new Promise(function (resolve, reject) {
      var expectedState = opts.state;
      var w = 520, h = 640;
      var left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
      var top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
      var popup = window.open(authUrl, "nb-oauth-" + (opts.provider || ""),
        "width=" + w + ",height=" + h + ",left=" + Math.round(left) + ",top=" + Math.round(top) + ",resizable=yes,scrollbars=yes");
      if (!popup) { reject(NB.error(NB.CODES.ABORTED, "Popup wurde blockiert – bitte Popups fuer diese Seite erlauben.")); return; }

      var done = false;
      function finish(fn, arg) {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        clearInterval(closedTimer);
        clearTimeout(timeoutTimer);
        try { popup.close(); } catch (e) {}
        fn(arg);
      }
      function onMessage(ev) {
        if (ev.origin !== location.origin) return;                 // nur eigene Callback-Seite
        if (!ev.data || ev.data.type !== "nb-oauth-callback") return;
        var p = ev.data.params || {};
        if (expectedState && p.state !== expectedState) {
          finish(reject, NB.error(NB.CODES.UNKNOWN, "State stimmt nicht – Anmeldung abgebrochen."));
          return;
        }
        if (p.error) {
          var code = p.error === "access_denied" ? NB.CODES.ABORTED : NB.CODES.PERMISSION;
          finish(reject, NB.error(code, p.error_description || p.error));
          return;
        }
        finish(resolve, p);
      }
      window.addEventListener("message", onMessage);

      var closedTimer = setInterval(function () {
        if (popup.closed) finish(reject, NB.error(NB.CODES.ABORTED, "Fenster wurde geschlossen."));
      }, 500);
      var timeoutTimer = setTimeout(function () {
        finish(reject, NB.error(NB.CODES.ABORTED, "Zeitueberschreitung bei der Anmeldung."));
      }, opts.timeoutMs || 5 * 60 * 1000);
    });
  };

  // ---------- Token-Speicher ----------
  /* Ein Speicher pro Anbieter. Haelt access_token, optional refresh_token,
     Ablaufzeitpunkt, gewaehrte Scopes und Kontoinfos. */
  oauth.TokenStore = function (providerId) {
    var key = "token:" + providerId;
    var SKEW_MS = 90 * 1000; // frueher erneuern, damit laufende Requests nicht mitten im Ablauf sterben

    return {
      get: function () { return NB.store.get(key); },
      set: function (tok) {
        NB.store.set(key, tok);
        NB.bus.emit("auth:changed", { provider: providerId, connected: !!tok });
        return tok;
      },
      /* Antwort vom Token-Endpunkt normalisieren und ablegen. */
      save: function (resp, extra) {
        var prev = NB.store.get(key) || {};
        var tok = {
          accessToken: resp.access_token,
          // Microsoft rotiert refresh_token bei jedem Refresh; Google (GIS) liefert keinen.
          refreshToken: resp.refresh_token || prev.refreshToken || null,
          idToken: resp.id_token || prev.idToken || null,
          scope: resp.scope || prev.scope || null,
          tokenType: resp.token_type || "Bearer",
          expiresAt: Date.now() + ((resp.expires_in || 3600) * 1000),
          account: (extra && extra.account) || prev.account || null,
          needsReauth: false,
          updatedAt: Date.now()
        };
        return this.set(tok);
      },
      clear: function () { NB.store.del(key); NB.bus.emit("auth:changed", { provider: providerId, connected: false }); },
      isConnected: function () { var t = this.get(); return !!(t && (t.accessToken || t.refreshToken)); },
      isExpired: function () { var t = this.get(); return !t || !t.expiresAt || t.expiresAt - SKEW_MS <= Date.now(); },
      /* Markiert die Verbindung als "Nutzer muss neu anmelden", ohne Kontoinfos zu verlieren. */
      markReauth: function () {
        var t = this.get(); if (!t) return;
        t.needsReauth = true; t.accessToken = null;
        this.set(t);
      },
      hasScope: function (scope) {
        var t = this.get();
        if (!t || !t.scope) return true; // unbekannt -> nicht blockieren
        return t.scope.split(/\s+/).indexOf(scope) !== -1;
      }
    };
  };

  /* Serialisiert parallele Refresh-Versuche: sonst holen fuenf gleichzeitige
     Requests fuenf Tokens und invalidieren gegenseitig den Refresh-Token. */
  var inflight = {};
  oauth.once = function (providerId, fn) {
    if (inflight[providerId]) return inflight[providerId];
    inflight[providerId] = Promise.resolve().then(fn).then(
      function (v) { delete inflight[providerId]; return v; },
      function (e) { delete inflight[providerId]; throw e; }
    );
    return inflight[providerId];
  };

  /* Standard-Token-Austausch (application/x-www-form-urlencoded). */
  oauth.tokenRequest = function (tokenUrl, params) {
    return NB.retry(function () {
      return NB.http(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: oauth.query(params)
      });
    }, { tries: 3 }).then(function (r) { return r.body; });
  };

  log.debug("Redirect-URI dieser Installation:", NB.env.secure() ? oauth.redirectUri() : "(unsicherer Origin)");
})();
