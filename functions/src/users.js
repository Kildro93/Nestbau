'use strict';

// Konto-Lebenszyklus: Anlegen, Email-Verifikation, Loeschen.

const functionsV1 = require('firebase-functions/v1');
const { onCall } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

const {
  admin, db, REGION, SENDGRID_API_KEY, APP_BASE_URL, MAIL_FROM,
  now, requireAuth, assert, cleanText, deleteCollection, HttpsError,
} = require('../lib/common');
const mail = require('../lib/email');

const COLOR_ROTATION = ['flame', 'teal', 'amber', 'maroon'];

/**
 * Legt beim ersten Login die Basisdokumente an.
 * Der Auth-Trigger ist bewusst gen1 - fuer auth.user().onCreate gibt es in v2 kein
 * gleichwertiges Pendant (die v2-Blocking-Functions kosten Identity-Platform).
 */
exports.onUserCreated = functionsV1
  .region(REGION)
  .runWith({ secrets: ['SENDGRID_API_KEY'], memory: '256MB' })
  .auth.user()
  .onCreate(async (user) => {
    const uid = user.uid;
    const displayName = user.displayName || (user.email || '').split('@')[0] || 'Ich';
    const color = COLOR_ROTATION[Math.abs(hashCode(uid)) % COLOR_ROTATION.length];

    await db.doc(`users/${uid}`).set({
      email: (user.email || '').toLowerCase(),
      displayName,
      color,
      photoPath: null,
      emailVerified: !!user.emailVerified,
      status: 'active',
      householdIds: [],
      defaultHouseholdId: null,
      locale: 'de-CH',
      schemaVersion: 2,
      createdAt: now(),
      lastLoginAt: now(),
    }, { merge: true });

    // Gesundheitsprofil leer anlegen, damit der Client nur noch aktualisieren muss.
    await db.doc(`users/${uid}/private/health`).set({
      birthYear: null,
      heightCm: null,
      weightKg: null,
      fitnessLevel: 'medium',
      allergyIds: [],
      dietTags: [],
      shareAllergiesWithHousehold: false,
      updatedAt: now(),
    }, { merge: true });

    await db.doc(`users/${uid}/private/settings`).set({
      activeListId: 'l-aufgaben',
      calendarView: 'week',
      menuView: 'week',
      theme: 'system',
    }, { merge: true });

    if (user.email && !user.emailVerified) {
      await sendVerification(uid, user.email, displayName).catch((err) => {
        logger.error('Verifikationsmail fehlgeschlagen', { uid, err: err.message });
      });
    }
    logger.info('Konto angelegt', { uid });
  });

async function sendVerification(uid, email, name) {
  const link = await admin.auth().generateEmailVerificationLink(email, {
    url: `${APP_BASE_URL.value()}/?verified=1`,
    handleCodeInApp: false,
  });
  const tpl = mail.templates.verifyEmail({ link, name });
  await mail.send({
    apiKey: SENDGRID_API_KEY.value(),
    from: MAIL_FROM.value(),
    to: email,
    subject: tpl.subject,
    html: tpl.html,
  });
  await db.doc(`users/${uid}`).set({ lastVerificationSentAt: now() }, { merge: true });
}

/** Erneut senden - mit Sperre, damit der Endpunkt nicht als Mailschleuder dient. */
exports.resendVerificationEmail = onCall(
  { region: REGION, secrets: [SENDGRID_API_KEY], cors: true },
  async (request) => {
    const auth = requireAuth(request);
    if (auth.token.email_verified === true) return { sent: false, reason: 'already-verified' };

    const ref = db.doc(`users/${auth.uid}`);
    const snap = await ref.get();
    const last = snap.get('lastVerificationSentAt');
    if (last && Date.now() - last.toMillis() < 60 * 1000) {
      throw new HttpsError('resource-exhausted', 'Bitte eine Minute warten, dann erneut versuchen.');
    }
    await sendVerification(auth.uid, auth.token.email, snap.get('displayName'));
    return { sent: true };
  }
);

/** Anzeigename/Farbe aendern und in alle Haushalts-Mitgliederdokumente spiegeln. */
exports.updateDisplayProfile = onCall({ region: REGION, cors: true }, async (request) => {
  const auth = requireAuth(request);
  const data = request.data || {};
  const patch = { updatedAt: now() };

  if (data.displayName !== undefined) patch.displayName = cleanText(data.displayName, 60, 'Name');
  if (data.color !== undefined) {
    assert(COLOR_ROTATION.includes(data.color), 'Unbekannte Farbe.');
    patch.color = data.color;
  }
  if (data.photoPath !== undefined) {
    assert(data.photoPath === null || (typeof data.photoPath === 'string'
      && data.photoPath.startsWith(`users/${auth.uid}/avatar/`)), 'Ungueltiger Bildpfad.');
    patch.photoPath = data.photoPath;
  }

  const userRef = db.doc(`users/${auth.uid}`);
  await userRef.set(patch, { merge: true });

  const householdIds = (await userRef.get()).get('householdIds') || [];
  const batch = db.batch();
  householdIds.forEach((hid) => {
    batch.set(db.doc(`households/${hid}/members/${auth.uid}`), patch, { merge: true });
  });
  if (householdIds.length) await batch.commit();

  return { ok: true, mirroredTo: householdIds.length };
});

/** Konto loeschen: der Auth-Trigger onUserDeleted raeumt danach die Daten ab. */
exports.deleteAccount = onCall({ region: REGION, cors: true }, async (request) => {
  const auth = requireAuth(request);
  const householdIds = (await db.doc(`users/${auth.uid}`).get()).get('householdIds') || [];

  // Letzter Admin darf nicht verschwinden, sonst bleibt ein verwaister Haushalt zurueck.
  for (const hid of householdIds) {
    const snap = await db.doc(`households/${hid}`).get();
    if (!snap.exists) continue;
    const roles = snap.get('roles') || {};
    const admins = Object.keys(roles).filter((u) => roles[u] === 'admin');
    if (admins.length === 1 && admins[0] === auth.uid && Object.keys(roles).length > 1) {
      throw new HttpsError('failed-precondition',
        `Im Haushalt "${snap.get('name')}" bist du der einzige Admin. Bitte zuerst jemanden zum Admin machen.`);
    }
  }

  await admin.auth().deleteUser(auth.uid);
  return { ok: true };
});

exports.onUserDeleted = functionsV1
  .region(REGION)
  .auth.user()
  .onDelete(async (user) => {
    const uid = user.uid;
    const userRef = db.doc(`users/${uid}`);
    const householdIds = (await userRef.get()).get('householdIds') || [];

    for (const hid of householdIds) {
      const hhRef = db.doc(`households/${hid}`);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(hhRef);
        if (!snap.exists) return;
        const roles = { ...(snap.get('roles') || {}) };
        delete roles[uid];
        const memberUids = (snap.get('memberUids') || []).filter((u) => u !== uid);
        if (memberUids.length === 0) {
          tx.update(hhRef, { roles, memberUids, status: 'orphaned', updatedAt: now() });
        } else {
          tx.update(hhRef, { roles, memberUids, updatedAt: now() });
        }
      });
      await db.doc(`households/${hid}/members/${uid}`).delete().catch(() => {});
    }

    await deleteCollection(db.collection(`users/${uid}/private`));
    await deleteCollection(db.collection(`users/${uid}/integrations`));
    await deleteCollection(db.collection(`users/${uid}/notifications`));

    const tokens = await db.collection('secureTokens').where('uid', '==', uid).get();
    await Promise.all(tokens.docs.map((d) => d.ref.delete()));

    await admin.storage().bucket().deleteFiles({ prefix: `users/${uid}/` }).catch(() => {});
    await userRef.delete().catch(() => {});

    logger.info('Konto und Daten geloescht', { uid, households: householdIds.length });
  });

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
