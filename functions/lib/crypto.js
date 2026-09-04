'use strict';

// Token-Tresor: OAuth Refresh/Access Tokens werden nie im Klartext gespeichert.
// Verfahren: AES-256-GCM, Schluessel aus dem Secret Manager (TOKEN_ENC_KEY, 32 Byte base64).
// Schluessel erzeugen:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Setzen:               firebase functions:secrets:set TOKEN_ENC_KEY

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function keyFrom(secretValue) {
  const key = Buffer.from(String(secretValue || ''), 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENC_KEY muss 32 Byte base64 sein (256 Bit).');
  }
  return key;
}

/** @returns {{cipherText: string, iv: string, authTag: string, keyVersion: number}} */
function encryptJson(payload, secretValue, keyVersion = 1) {
  const key = keyFrom(secretValue);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  // Die Schluesselversion wandert in die AAD: ein Ciphertext laesst sich damit nicht
  // unbemerkt einer anderen Version unterschieben.
  cipher.setAAD(Buffer.from(String(keyVersion), 'utf8'));
  const buf = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  return {
    cipherText: buf.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

function decryptJson(record, secretValue) {
  const key = keyFrom(secretValue);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(record.iv, 'base64'));
  decipher.setAAD(Buffer.from(String(record.keyVersion || 1), 'utf8'));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  const buf = Buffer.concat([
    decipher.update(Buffer.from(record.cipherText, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(buf.toString('utf8'));
}

/** Einladungstoken: Klartext geht nur in die Email, in Firestore liegt der Hash. */
function newInviteToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Zeitkonstanter Vergleich, damit Tokens nicht ueber die Antwortzeit erratbar werden. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { encryptJson, decryptJson, newInviteToken, hashToken, safeEqual };
