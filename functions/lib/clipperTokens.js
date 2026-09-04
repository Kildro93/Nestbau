'use strict';

// Nestbau v2.0 – Geraete-Tokens fuer den Web Clipper.
//
// Warum nicht einfach Firebase Auth in der Extension?
// Eine Browser-Extension kann sich zwar anmelden, muesste dafuer aber ein
// eigenes OAuth-/Popup-Handling und die Firebase-Config mitschleppen. Fuer
// "ein Knopf, ein POST" ist das zu viel Apparat. Stattdessen: der Nutzer
// erzeugt in der eingeloggten App EINMAL ein Geraete-Token, die Extension
// speichert es lokal.
//
// Gespeichert wird nur der SHA-256-Hash – wer die Firestore-Daten sieht,
// kann daraus kein funktionierendes Token bauen. Die Dokument-ID IST der
// Hash, damit die Pruefung ein direkter get() ist und keine Query.

const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue } = require('./common');

const COLLECTION = 'clipperTokens';
const TOKEN_PREFIX = 'nb1_';
const MAX_TOKENS_PER_USER = 5;
const MAX_CLIPS_PER_DAY = 60;
const MIN_GAP_MS = 1500;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Erzeugt ein neues Geraete-Token. Der Klartext wird NUR hier einmal
 * zurueckgegeben und danach nie wieder – wie bei einem API-Key.
 */
async function createToken({ uid, householdId, label, userAgent }) {
  const existing = await db.collection(COLLECTION)
    .where('uid', '==', uid)
    .where('revokedAt', '==', null)
    .limit(MAX_TOKENS_PER_USER + 1)
    .get();

  if (existing.size >= MAX_TOKENS_PER_USER) {
    throw new HttpsError(
      'resource-exhausted',
      `Maximal ${MAX_TOKENS_PER_USER} Geraete gleichzeitig. Bitte zuerst ein altes Geraet trennen.`
    );
  }

  const rawToken = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const tokenId = hashToken(rawToken);

  await db.collection(COLLECTION).doc(tokenId).set({
    uid,
    householdId,
    label: String(label || 'Browser').slice(0, 60),
    userAgent: String(userAgent || '').slice(0, 200),
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
    revokedAt: null,
    usageDay: today(),
    usageCount: 0,
    clipCount: 0
  });

  return { tokenId, token: rawToken };
}

/**
 * Prueft ein Token und zaehlt die Nutzung in einer Transaktion mit.
 * Rate-Limit und Verifikation gehoeren zusammen: sonst kann ein geleaktes
 * Token beliebig oft Cloud-Function-Zeit und KI-Tokens verbrennen.
 */
async function verifyAndConsume(rawToken) {
  const value = String(rawToken || '').trim();
  if (!value.startsWith(TOKEN_PREFIX) || value.length < 20 || value.length > 200) {
    const error = new Error('Ungueltiges Token.');
    error.status = 401;
    throw error;
  }

  const ref = db.collection(COLLECTION).doc(hashToken(value));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const error = new Error('Token unbekannt – bitte in Nestbau neu verbinden.');
      error.status = 401;
      throw error;
    }

    const data = snap.data();
    if (data.revokedAt) {
      const error = new Error('Token wurde getrennt – bitte in Nestbau neu verbinden.');
      error.status = 401;
      throw error;
    }

    const now = Date.now();
    const lastUsed = data.lastUsedAt ? data.lastUsedAt.toMillis() : 0;
    if (now - lastUsed < MIN_GAP_MS) {
      const error = new Error('Zu schnell hintereinander – bitte kurz warten.');
      error.status = 429;
      throw error;
    }

    const day = today();
    const count = data.usageDay === day ? Number(data.usageCount || 0) : 0;
    if (count >= MAX_CLIPS_PER_DAY) {
      const error = new Error(`Tageslimit von ${MAX_CLIPS_PER_DAY} Importen erreicht.`);
      error.status = 429;
      throw error;
    }

    tx.update(ref, {
      lastUsedAt: FieldValue.serverTimestamp(),
      usageDay: day,
      usageCount: count + 1,
      clipCount: FieldValue.increment(1)
    });

    return { tokenId: snap.id, uid: data.uid, householdId: data.householdId, label: data.label };
  });
}

async function listTokens(uid) {
  const snap = await db.collection(COLLECTION)
    .where('uid', '==', uid)
    .where('revokedAt', '==', null)
    .limit(MAX_TOKENS_PER_USER)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      tokenId: doc.id,
      label: data.label,
      createdAt: data.createdAt ? data.createdAt.toMillis() : null,
      lastUsedAt: data.lastUsedAt ? data.lastUsedAt.toMillis() : null,
      clipCount: data.clipCount || 0
    };
  });
}

async function revokeToken(uid, tokenId) {
  const ref = db.collection(COLLECTION).doc(String(tokenId));
  const snap = await ref.get();
  if (!snap.exists || snap.data().uid !== uid) {
    throw new HttpsError('not-found', 'Geraet nicht gefunden.');
  }
  await ref.update({ revokedAt: FieldValue.serverTimestamp() });
}

module.exports = {
  COLLECTION, TOKEN_PREFIX, MAX_CLIPS_PER_DAY, MAX_TOKENS_PER_USER,
  hashToken, createToken, verifyAndConsume, listTokens, revokeToken
};
