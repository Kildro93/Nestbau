'use strict';

// Haushalte: erstellen, einladen, beitreten, verwalten.

const { onCall } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

const {
  db, REGION, SENDGRID_API_KEY, APP_BASE_URL, MAIL_FROM,
  now, arrayUnion, arrayRemove, requireVerified, requireAuth, assert,
  normalizeEmail, cleanText, setHouseholdClaims, requireMember, requireAdmin,
  ROLES, HttpsError,
} = require('../lib/common');
const mail = require('../lib/email');
const { newInviteToken, hashToken } = require('../lib/crypto');

const INVITE_DAYS = 7;
const MAX_PENDING_INVITES = 10;
const MAX_MEMBERS = 8;

// Identisch zu DEFAULT_LISTS / INGREDIENT_DEFAULT_CATEGORIES in index.html,
// damit ein frischer Haushalt genauso aussieht wie die lokale App.
const DEFAULT_LISTS = [
  { id: 'l-aufgaben', name: 'Aufgaben', kind: 'todo' },
  { id: 'l-einkaufen', name: 'Einkäufe', kind: 'shopping' },
  { id: 'l-geschenke', name: 'Geschenke', kind: 'todo' },
  { id: 'l-haushalt', name: 'Haushalt', kind: 'todo' },
  { id: 'l-arbeit', name: 'Arbeit', kind: 'todo' },
];

const DEFAULT_INGREDIENT_CATEGORIES = [
  { id: 'obst', name: 'Obst', shoppingGroup: 'obst', emoji: '🍎' },
  { id: 'gemuese', name: 'Gemüse', shoppingGroup: 'gemuese', emoji: '🥦' },
  { id: 'fleisch', name: 'Fleisch', shoppingGroup: 'fleisch_fisch', emoji: '🥩' },
  { id: 'gefluegel', name: 'Geflügel', shoppingGroup: 'fleisch_fisch', emoji: '🍗' },
  { id: 'fisch', name: 'Fisch', shoppingGroup: 'fleisch_fisch', emoji: '🐟' },
  { id: 'staerkebeilagen', name: 'Stärkebeilagen', shoppingGroup: 'trocken', emoji: '🍚' },
  { id: 'huelsenfruechte', name: 'Hülsenfrüchte', shoppingGroup: 'trocken', emoji: '🫘' },
  { id: 'nuesse', name: 'Nüsse', shoppingGroup: 'trocken', emoji: '🥜' },
  { id: 'milchprodukte', name: 'Milchprodukte', shoppingGroup: 'milchprodukte', emoji: '🧀' },
  { id: 'oele_fette', name: 'Öle & Fette', shoppingGroup: 'trocken', emoji: '🫒' },
  { id: 'gewuerze', name: 'Gewürze', shoppingGroup: 'gewuerze', emoji: '🌿' },
  { id: 'sonstiges', name: 'Sonstiges', shoppingGroup: 'nonfood', emoji: '🧺' },
];

/** Standardlisten und Zutatenkategorien in einen leeren Haushalt schreiben. */
async function seedHousehold(hid, uid) {
  const batch = db.batch();
  DEFAULT_LISTS.forEach((l, i) => {
    batch.set(db.doc(`households/${hid}/lists/${l.id}`), {
      name: l.name, kind: l.kind, order: i, system: true, createdBy: uid, createdAt: now(),
    });
  });
  DEFAULT_INGREDIENT_CATEGORIES.forEach((c, i) => {
    batch.set(db.doc(`households/${hid}/ingredientCategories/${c.id}`), {
      name: c.name, custom: false, emoji: c.emoji, shoppingGroup: c.shoppingGroup,
      imagePaths: [], order: i, createdAt: now(),
    });
  });
  await batch.commit();
}

exports.createHousehold = onCall({ region: REGION, cors: true }, async (request) => {
  const auth = requireVerified(request);
  const name = cleanText((request.data || {}).name, 120, 'Haushaltsname');
  const description = String((request.data || {}).description || '').trim().slice(0, 500);

  const userRef = db.doc(`users/${auth.uid}`);
  const userSnap = await userRef.get();
  assert((userSnap.get('householdIds') || []).length < 5,
    'Mehr als fuenf Haushalte pro Konto sind nicht vorgesehen.', 'failed-precondition');

  const hhRef = db.collection('households').doc();
  await hhRef.set({
    name,
    description,
    photoPath: null,
    createdBy: auth.uid,
    memberUids: [auth.uid],
    roles: { [auth.uid]: 'admin' },
    settings: { currency: 'CHF', locale: 'de-CH', weekStart: 1, timezone: 'Europe/Zurich' },
    createdAt: now(),
    updatedAt: now(),
  });

  await db.doc(`households/${hhRef.id}/members/${auth.uid}`).set({
    uid: auth.uid,
    displayName: userSnap.get('displayName') || 'Ich',
    color: userSnap.get('color') || 'flame',
    photoPath: userSnap.get('photoPath') || null,
    role: 'admin',
    legacyKey: 'a',
    sharedAllergyIds: [],
    joinedAt: now(),
  });

  await seedHousehold(hhRef.id, auth.uid);

  await userRef.set({
    householdIds: arrayUnion(hhRef.id),
    defaultHouseholdId: userSnap.get('defaultHouseholdId') || hhRef.id,
  }, { merge: true });

  await setHouseholdClaims(auth.uid);
  logger.info('Haushalt erstellt', { hid: hhRef.id, uid: auth.uid });
  return { householdId: hhRef.id };
});

exports.inviteToHousehold = onCall(
  { region: REGION, secrets: [SENDGRID_API_KEY], cors: true },
  async (request) => {
    const auth = requireVerified(request);
    const { householdId } = request.data || {};
    assert(typeof householdId === 'string' && householdId, 'householdId fehlt.');
    const email = normalizeEmail((request.data || {}).email);
    const role = (request.data || {}).role || 'member';
    assert(ROLES.includes(role), 'Unbekannte Rolle.');
    assert(email !== (auth.token.email || '').toLowerCase(), 'Du bist bereits Mitglied.');

    const { data: household } = await requireAdmin(householdId, auth.uid);
    assert((household.memberUids || []).length < MAX_MEMBERS,
      `Maximal ${MAX_MEMBERS} Mitglieder pro Haushalt.`, 'failed-precondition');

    const invitesRef = db.collection(`households/${householdId}/invites`);
    const pending = await invitesRef.where('status', '==', 'pending').get();
    assert(pending.size < MAX_PENDING_INVITES,
      'Zu viele offene Einladungen.', 'resource-exhausted');

    const duplicate = pending.docs.find((d) => d.get('email') === email);
    if (duplicate) await duplicate.ref.update({ status: 'revoked', updatedAt: now() });

    const { token, tokenHash } = newInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
    const inviterName = (await db.doc(`users/${auth.uid}`).get()).get('displayName') || 'Jemand';

    const inviteRef = await invitesRef.add({
      email,
      role,
      invitedBy: auth.uid,
      invitedByName: inviterName,
      householdName: household.name,
      tokenHash,
      status: 'pending',
      expiresAt,
      acceptedBy: null,
      createdAt: now(),
    });

    const link = `${APP_BASE_URL.value()}/?invite=${encodeURIComponent(inviteRef.id)}`
      + `&hh=${encodeURIComponent(householdId)}&token=${encodeURIComponent(token)}`;
    const tpl = mail.templates.invite({
      link, householdName: household.name, inviterName, expiresInDays: INVITE_DAYS,
    });
    await mail.send({
      apiKey: SENDGRID_API_KEY.value(),
      from: MAIL_FROM.value(),
      to: email,
      subject: tpl.subject,
      html: tpl.html,
    });

    logger.info('Einladung verschickt', { hid: householdId, inviteId: inviteRef.id });
    // Das Klartext-Token wird bewusst nicht zurueckgegeben - es existiert nur in der Email.
    return { inviteId: inviteRef.id, expiresAt: expiresAt.toISOString() };
  }
);

exports.acceptInvite = onCall(
  { region: REGION, secrets: [SENDGRID_API_KEY], cors: true },
  async (request) => {
    const auth = requireVerified(request);
    const { householdId, inviteId, token } = request.data || {};
    assert(householdId && inviteId && token, 'Einladungsdaten unvollstaendig.');

    const inviteRef = db.doc(`households/${householdId}/invites/${inviteId}`);
    const hhRef = db.doc(`households/${householdId}`);
    const userRef = db.doc(`users/${auth.uid}`);

    const result = await db.runTransaction(async (tx) => {
      const [inviteSnap, hhSnap, userSnap] = await Promise.all([
        tx.get(inviteRef), tx.get(hhRef), tx.get(userRef),
      ]);
      if (!inviteSnap.exists) throw new HttpsError('not-found', 'Einladung existiert nicht.');
      if (!hhSnap.exists) throw new HttpsError('not-found', 'Haushalt existiert nicht.');

      const invite = inviteSnap.data();
      if (invite.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Diese Einladung wurde bereits verwendet.');
      }
      if (invite.expiresAt.toMillis() < Date.now()) {
        tx.update(inviteRef, { status: 'expired' });
        throw new HttpsError('deadline-exceeded', 'Die Einladung ist abgelaufen.');
      }
      if (invite.tokenHash !== hashToken(token)) {
        throw new HttpsError('permission-denied', 'Einladungslink ungueltig.');
      }
      if (invite.email !== (auth.token.email || '').toLowerCase()) {
        throw new HttpsError('permission-denied',
          'Die Einladung gilt fuer eine andere Email-Adresse.');
      }

      const roles = { ...(hhSnap.get('roles') || {}) };
      if (roles[auth.uid]) throw new HttpsError('already-exists', 'Du bist bereits Mitglied.');
      roles[auth.uid] = invite.role;

      const memberCount = (hhSnap.get('memberUids') || []).length;
      if (memberCount >= MAX_MEMBERS) {
        throw new HttpsError('resource-exhausted', 'Der Haushalt ist voll.');
      }

      tx.update(hhRef, { roles, memberUids: arrayUnion(auth.uid), updatedAt: now() });
      tx.set(db.doc(`households/${householdId}/members/${auth.uid}`), {
        uid: auth.uid,
        displayName: userSnap.get('displayName') || 'Mitglied',
        color: userSnap.get('color') || 'teal',
        photoPath: userSnap.get('photoPath') || null,
        role: invite.role,
        legacyKey: memberCount === 1 ? 'b' : null,
        sharedAllergyIds: [],
        joinedAt: now(),
      });
      tx.set(userRef, {
        householdIds: arrayUnion(householdId),
        defaultHouseholdId: userSnap.get('defaultHouseholdId') || householdId,
      }, { merge: true });
      tx.update(inviteRef, {
        status: 'accepted', acceptedBy: auth.uid, tokenHash: null, acceptedAt: now(),
      });

      return {
        householdName: hhSnap.get('name'),
        inviterUid: invite.invitedBy,
        memberName: userSnap.get('displayName') || 'Ein neues Mitglied',
      };
    });

    await setHouseholdClaims(auth.uid);

    const inviter = await db.doc(`users/${result.inviterUid}`).get();
    if (inviter.exists && inviter.get('email')) {
      const tpl = mail.templates.memberJoined({
        memberName: result.memberName, householdName: result.householdName,
      });
      await mail.send({
        apiKey: SENDGRID_API_KEY.value(), from: MAIL_FROM.value(),
        to: inviter.get('email'), subject: tpl.subject, html: tpl.html,
      }).catch(() => {});
    }

    return { householdId, householdName: result.householdName };
  }
);

exports.revokeInvite = onCall({ region: REGION, cors: true }, async (request) => {
  const auth = requireVerified(request);
  const { householdId, inviteId } = request.data || {};
  assert(householdId && inviteId, 'Parameter fehlen.');
  await requireAdmin(householdId, auth.uid);
  await db.doc(`households/${householdId}/invites/${inviteId}`)
    .update({ status: 'revoked', tokenHash: null, updatedAt: now() });
  return { ok: true };
});

exports.setMemberRole = onCall({ region: REGION, cors: true }, async (request) => {
  const auth = requireVerified(request);
  const { householdId, memberUid, role } = request.data || {};
  assert(householdId && memberUid && ROLES.includes(role), 'Parameter fehlen oder sind ungueltig.');
  await requireAdmin(householdId, auth.uid);

  const hhRef = db.doc(`households/${householdId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(hhRef);
    const roles = { ...(snap.get('roles') || {}) };
    assert(roles[memberUid], 'Person ist kein Mitglied.', 'not-found');
    const admins = Object.keys(roles).filter((u) => roles[u] === 'admin');
    if (role === 'member' && admins.length === 1 && admins[0] === memberUid) {
      throw new HttpsError('failed-precondition', 'Der letzte Admin kann nicht herabgestuft werden.');
    }
    roles[memberUid] = role;
    tx.update(hhRef, { roles, updatedAt: now() });
    tx.set(db.doc(`households/${householdId}/members/${memberUid}`), { role }, { merge: true });
  });

  await setHouseholdClaims(memberUid);
  return { ok: true };
});

exports.removeMember = onCall({ region: REGION, cors: true }, async (request) => {
  const auth = requireAuth(request);
  const { householdId, memberUid } = request.data || {};
  assert(householdId && memberUid, 'Parameter fehlen.');

  // Sich selbst entfernen darf jedes Mitglied, andere nur ein Admin.
  if (memberUid !== auth.uid) await requireAdmin(householdId, auth.uid);
  else await requireMember(householdId, auth.uid);

  const hhRef = db.doc(`households/${householdId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(hhRef);
    const roles = { ...(snap.get('roles') || {}) };
    assert(roles[memberUid], 'Person ist kein Mitglied.', 'not-found');
    const admins = Object.keys(roles).filter((u) => roles[u] === 'admin');
    if (admins.length === 1 && admins[0] === memberUid && Object.keys(roles).length > 1) {
      throw new HttpsError('failed-precondition',
        'Bitte zuerst eine andere Person zum Admin machen.');
    }
    delete roles[memberUid];
    tx.update(hhRef, { roles, memberUids: arrayRemove(memberUid), updatedAt: now() });
    tx.delete(db.doc(`households/${householdId}/members/${memberUid}`));
    tx.set(db.doc(`users/${memberUid}`), { householdIds: arrayRemove(householdId) }, { merge: true });
  });

  await setHouseholdClaims(memberUid);
  logger.info('Mitglied entfernt', { householdId, memberUid, by: auth.uid });
  return { ok: true };
});

exports._internals = { DEFAULT_LISTS, DEFAULT_INGREDIENT_CATEGORIES, seedHousehold };
