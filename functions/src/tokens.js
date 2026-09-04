'use strict';

// Token-Tresor fuer Google Calendar und Microsoft Graph.
//
// Regel: das Frontend sieht nie ein OAuth-Token. Es liefert nur den Authorization Code,
// der Tausch gegen Access-/Refresh-Token passiert hier, die Tokens landen verschluesselt
// in /secureTokens (fuer Clients per Rules komplett gesperrt).
// Bot 3 nutzt getValidAccessToken() serverseitig fuer den Sync.

const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

const {
  db, REGION, TOKEN_ENC_KEY, now, requireVerified, assert, HttpsError,
} = require('../lib/common');
const { encryptJson, decryptJson } = require('../lib/crypto');

const GOOGLE_CLIENT_ID = defineSecret('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const MS_CLIENT_ID = defineSecret('MS_CLIENT_ID');
const MS_CLIENT_SECRET = defineSecret('MS_CLIENT_SECRET');

const PROVIDERS = {
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },
  outlook: {
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    revokeUrl: null,
    scopes: ['offline_access', 'Calendars.Read', 'User.Read'],
  },
};

const clientCreds = (provider) => provider === 'google'
  ? { id: GOOGLE_CLIENT_ID.value(), secret: GOOGLE_CLIENT_SECRET.value() }
  : { id: MS_CLIENT_ID.value(), secret: MS_CLIENT_SECRET.value() };

const tokenDocId = (uid, provider) => `${uid}_${provider}`;

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new HttpsError('failed-precondition', `OAuth-Fehler (${detail})`);
  }
  return body;
}

/** Authorization Code gegen Tokens tauschen und verschluesselt ablegen. */
exports.connectCalendar = onCall(
  {
    region: REGION,
    secrets: [TOKEN_ENC_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MS_CLIENT_ID, MS_CLIENT_SECRET],
    cors: true,
  },
  async (request) => {
    const auth = requireVerified(request);
    const { provider, code, redirectUri, codeVerifier } = request.data || {};
    assert(PROVIDERS[provider], 'Unbekannter Anbieter.');
    assert(typeof code === 'string' && code, 'Authorization Code fehlt.');
    assert(typeof redirectUri === 'string' && redirectUri.startsWith('https://'),
      'redirectUri muss https sein.');

    const creds = clientCreds(provider);
    const payload = {
      code,
      client_id: creds.id,
      client_secret: creds.secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    };
    if (codeVerifier) payload.code_verifier = codeVerifier;

    const tokens = await postForm(PROVIDERS[provider].tokenUrl, payload);
    if (!tokens.refresh_token) {
      logger.warn('Kein Refresh-Token erhalten', { provider, uid: auth.uid });
    }

    const expiresAt = new Date(Date.now() + (Number(tokens.expires_in || 3600) - 60) * 1000);
    const record = encryptJson({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      scope: tokens.scope || PROVIDERS[provider].scopes.join(' '),
    }, TOKEN_ENC_KEY.value());

    await db.doc(`secureTokens/${tokenDocId(auth.uid, provider)}`).set({
      uid: auth.uid, provider, ...record, expiresAt, updatedAt: now(),
    });

    await db.doc(`users/${auth.uid}/integrations/${provider}`).set({
      provider,
      status: 'connected',
      accountEmail: auth.token.email || null,
      calendarId: 'primary',
      scopes: (tokens.scope || '').split(' ').filter(Boolean),
      syncEnabled: true,
      syncDirection: 'read',
      lastSyncAt: null,
      lastError: null,
      expiresAt,
      connectedAt: now(),
    }, { merge: true });

    logger.info('Kalender verbunden', { provider, uid: auth.uid });
    return { connected: true, provider, expiresAt: expiresAt.toISOString() };
  }
);

/**
 * Gueltiges Access Token holen - erneuert bei Bedarf per Refresh Token.
 * Nur serverseitig aufrufen (Sync-Jobs), niemals an einen Client zurueckgeben.
 */
async function getValidAccessToken(uid, provider) {
  const ref = db.doc(`secureTokens/${tokenDocId(uid, provider)}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Keine Kalenderverbindung vorhanden.');

  const data = snap.data();
  const stored = decryptJson(data, TOKEN_ENC_KEY.value());
  const expired = !data.expiresAt || data.expiresAt.toMillis() <= Date.now();
  if (!expired) return stored.accessToken;

  if (!stored.refreshToken) {
    await db.doc(`users/${uid}/integrations/${provider}`)
      .set({ status: 'expired', lastError: 'Kein Refresh-Token' }, { merge: true });
    throw new HttpsError('failed-precondition', 'Verbindung abgelaufen, bitte neu verbinden.');
  }

  const creds = clientCreds(provider);
  const refreshed = await postForm(PROVIDERS[provider].tokenUrl, {
    refresh_token: stored.refreshToken,
    client_id: creds.id,
    client_secret: creds.secret,
    grant_type: 'refresh_token',
  });

  const expiresAt = new Date(Date.now() + (Number(refreshed.expires_in || 3600) - 60) * 1000);
  const record = encryptJson({
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || stored.refreshToken,
    scope: refreshed.scope || stored.scope,
  }, TOKEN_ENC_KEY.value());

  await ref.set({ ...record, expiresAt, updatedAt: now() }, { merge: true });
  await db.doc(`users/${uid}/integrations/${provider}`)
    .set({ status: 'connected', expiresAt, lastError: null }, { merge: true });

  return refreshed.access_token;
}

exports.disconnectCalendar = onCall(
  {
    region: REGION,
    secrets: [TOKEN_ENC_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MS_CLIENT_ID, MS_CLIENT_SECRET],
    cors: true,
  },
  async (request) => {
    const auth = requireVerified(request);
    const { provider } = request.data || {};
    assert(PROVIDERS[provider], 'Unbekannter Anbieter.');

    const ref = db.doc(`secureTokens/${tokenDocId(auth.uid, provider)}`);
    const snap = await ref.get();

    // Beim Anbieter widerrufen, nicht nur lokal vergessen.
    if (snap.exists && PROVIDERS[provider].revokeUrl) {
      try {
        const stored = decryptJson(snap.data(), TOKEN_ENC_KEY.value());
        await postForm(PROVIDERS[provider].revokeUrl,
          { token: stored.refreshToken || stored.accessToken });
      } catch (err) {
        logger.warn('Widerruf beim Anbieter fehlgeschlagen', { provider, err: err.message });
      }
    }

    await ref.delete().catch(() => {});
    await db.doc(`users/${auth.uid}/integrations/${provider}`).delete().catch(() => {});
    return { disconnected: true };
  }
);

exports.getValidAccessToken = getValidAccessToken;
exports.PROVIDERS = PROVIDERS;
exports.oauthSecrets = [
  TOKEN_ENC_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MS_CLIENT_ID, MS_CLIENT_SECRET,
];
