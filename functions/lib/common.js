'use strict';

// Gemeinsame Basis fuer alle Functions: Admin-SDK, Region, Parameter, kleine Helfer.

const admin = require('firebase-admin');
const { defineSecret, defineString } = require('firebase-functions/params');
const { HttpsError } = require('firebase-functions/v2/https');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const REGION = 'europe-west1';

// Secrets werden mit `firebase functions:secrets:set <NAME>` gesetzt
// und liegen im Secret Manager, nicht im Code.
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');
const TOKEN_ENC_KEY = defineSecret('TOKEN_ENC_KEY'); // 32 Byte, base64
const APP_BASE_URL = defineString('APP_BASE_URL', { default: 'https://nestbau-app.web.app' });
const MAIL_FROM = defineString('MAIL_FROM', { default: 'nestbau@example.com' });

const COLORS = ['flame', 'teal', 'amber', 'maroon'];
const ROLES = ['admin', 'member'];

const now = () => admin.firestore.FieldValue.serverTimestamp();
const arrayUnion = (...v) => admin.firestore.FieldValue.arrayUnion(...v);
const arrayRemove = (...v) => admin.firestore.FieldValue.arrayRemove(...v);

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Bitte zuerst anmelden.');
  }
  return request.auth;
}

function requireVerified(request) {
  const auth = requireAuth(request);
  if (auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Bitte zuerst die Email-Adresse bestaetigen.');
  }
  return auth;
}

function assert(condition, message, code = 'invalid-argument') {
  if (!condition) throw new HttpsError(code, message);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  assert(typeof value === 'string' && EMAIL_RE.test(value.trim()), 'Ungueltige Email-Adresse.');
  return value.trim().toLowerCase();
}

function cleanText(value, max, fieldName) {
  const s = typeof value === 'string' ? value.trim() : '';
  assert(s.length > 0, `${fieldName} darf nicht leer sein.`);
  assert(s.length <= max, `${fieldName} ist zu lang (max. ${max} Zeichen).`);
  return s;
}

/**
 * Rollen aller Haushalte eines Nutzers als Custom Claim ablegen.
 * Damit kommen die Security Rules im Normalfall ohne get() aus - ein Firestore-Read
 * weniger pro Regelauswertung. Bis zum naechsten Token-Refresh (max. 1h) greift in den
 * Rules der get()-Fallback, deshalb ist der Claim eine Optimierung, keine Voraussetzung.
 */
async function setHouseholdClaims(uid) {
  const snap = await db.collection('households').where('memberUids', 'array-contains', uid).get();
  const hh = {};
  snap.forEach((doc) => {
    const role = (doc.get('roles') || {})[uid];
    if (role) hh[doc.id] = role;
  });
  const user = await admin.auth().getUser(uid);
  const existing = user.customClaims || {};
  await admin.auth().setCustomUserClaims(uid, { ...existing, hh });
  // Der Client hoert auf dieses Feld und ruft dann getIdToken(true) auf.
  await db.doc(`users/${uid}`).set({ claimsUpdatedAt: now() }, { merge: true });
  return hh;
}

async function getRole(householdId, uid) {
  const snap = await db.doc(`households/${householdId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Haushalt existiert nicht.');
  const role = (snap.get('roles') || {})[uid] || null;
  return { role, data: snap.data(), ref: snap.ref };
}

async function requireMember(householdId, uid) {
  const { role, data, ref } = await getRole(householdId, uid);
  if (!role) throw new HttpsError('permission-denied', 'Kein Mitglied dieses Haushalts.');
  return { role, data, ref };
}

async function requireAdmin(householdId, uid) {
  const res = await requireMember(householdId, uid);
  if (res.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Nur Haushalts-Admins duerfen das.');
  }
  return res;
}

/** Loescht eine Kollektion in Haeppchen - Firestore hat keine rekursive Client-Loeschung. */
async function deleteCollection(ref, batchSize = 300) {
  let deleted = 0;
  for (;;) {
    const snap = await ref.limit(batchSize).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) return deleted;
  }
}

module.exports = {
  admin,
  db,
  REGION,
  SENDGRID_API_KEY,
  TOKEN_ENC_KEY,
  APP_BASE_URL,
  MAIL_FROM,
  COLORS,
  ROLES,
  now,
  arrayUnion,
  arrayRemove,
  requireAuth,
  requireVerified,
  assert,
  normalizeEmail,
  cleanText,
  setHouseholdClaims,
  getRole,
  requireMember,
  requireAdmin,
  deleteCollection,
  HttpsError,
};
