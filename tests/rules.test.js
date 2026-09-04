'use strict';

/**
 * Security-Rules-Tests gegen den Firestore-Emulator.
 *
 *   firebase emulators:start --only firestore
 *   cd tests && npm install && npm test
 *
 * Geprueft wird vor allem das, was bei einem Fehler wehtut:
 * fremde Haushalte, fremde Gesundheitsdaten, OAuth-Tokens, Rollenwechsel.
 */

const { test, before, after, beforeEach, describe } = require('node:test');
const {
  initializeTestEnvironment, assertFails, assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

let testEnv;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const MALLORY = 'uid-mallory';
const HID = 'hh-1';

const verified = (uid, hh = {}) => testEnv.authenticatedContext(uid, {
  email: `${uid}@example.com`, email_verified: true, hh,
});
const unverified = (uid) => testEnv.authenticatedContext(uid, {
  email: `${uid}@example.com`, email_verified: false,
});

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'nestbau-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `households/${HID}`), {
      name: 'Haushalt Test',
      createdBy: ALICE,
      memberUids: [ALICE, BOB],
      roles: { [ALICE]: 'admin', [BOB]: 'member' },
    });
    await setDoc(doc(db, `households/${HID}/members/${ALICE}`), { uid: ALICE, role: 'admin' });
    await setDoc(doc(db, `households/${HID}/members/${BOB}`), { uid: BOB, role: 'member' });
    await setDoc(doc(db, `households/${HID}/recipes/r1`), {
      title: 'Rösti', categories: ['mittagabend'], ingredients: [], steps: [], portions: 2,
    });
    await setDoc(doc(db, `users/${ALICE}`), { email: 'uid-alice@example.com', householdIds: [HID] });
    await setDoc(doc(db, `users/${ALICE}/private/health`), { allergyIds: ['nuesse'], weightKg: 75 });
    await setDoc(doc(db, `secureTokens/${ALICE}_google`), { uid: ALICE, cipherText: 'x' });
  });
});

describe('Haushaltsdaten', () => {
  test('Mitglied darf Rezepte lesen', async () => {
    const db = verified(BOB, { [HID]: 'member' }).firestore();
    await assertSucceeds(getDoc(doc(db, `households/${HID}/recipes/r1`)));
  });

  test('Fremde kommen nicht an Rezepte', async () => {
    const db = verified(MALLORY).firestore();
    await assertFails(getDoc(doc(db, `households/${HID}/recipes/r1`)));
  });

  test('Ohne Email-Verifikation kein Zugriff', async () => {
    const db = unverified(BOB).firestore();
    await assertFails(getDoc(doc(db, `households/${HID}/recipes/r1`)));
  });

  test('Rollen-Claim wirkt auch ohne Haushalts-Dokument-Lookup', async () => {
    const db = verified(BOB, { [HID]: 'member' }).firestore();
    await assertSucceeds(setDoc(doc(db, `households/${HID}/recipes/r2`), {
      title: 'Zopf', categories: ['fruehstueck'], ingredients: [], steps: [], portions: 4,
    }));
  });

  test('Base64-Foto im Dokument wird abgelehnt', async () => {
    const db = verified(ALICE, { [HID]: 'admin' }).firestore();
    await assertFails(setDoc(doc(db, `households/${HID}/recipes/r3`), {
      title: 'Kuchen', categories: ['dessert'], ingredients: [], steps: [], portions: 8,
      photo: 'data:image/jpeg;base64,AAAA',
    }));
  });

  test('Mitglied darf die Mitgliederliste nicht selbst aendern', async () => {
    const db = verified(BOB, { [HID]: 'member' }).firestore();
    await assertFails(updateDoc(doc(db, `households/${HID}`), {
      roles: { [BOB]: 'admin' },
    }));
  });

  test('Admin darf den Haushaltsnamen aendern, Mitglied nicht', async () => {
    const adminDb = verified(ALICE, { [HID]: 'admin' }).firestore();
    await assertSucceeds(updateDoc(doc(adminDb, `households/${HID}`), { name: 'Neuer Name' }));

    const memberDb = verified(BOB, { [HID]: 'member' }).firestore();
    await assertFails(updateDoc(doc(memberDb, `households/${HID}`), { name: 'Kaputt' }));
  });

  test('Systemliste kann nicht geloescht werden', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `households/${HID}/lists/l-aufgaben`), {
        name: 'Aufgaben', kind: 'todo', system: true, order: 0,
      });
    });
    const db = verified(ALICE, { [HID]: 'admin' }).firestore();
    await assertFails(deleteDoc(doc(db, `households/${HID}/lists/l-aufgaben`)));
  });

  test('Menueplan-Dokument braucht einen Datumsschluessel', async () => {
    const db = verified(ALICE, { [HID]: 'admin' }).firestore();
    await assertSucceeds(setDoc(doc(db, `households/${HID}/menuPlan/2026-09-15`),
      { date: '2026-09-15', slots: {} }));
    await assertFails(setDoc(doc(db, `households/${HID}/menuPlan/montag`),
      { date: 'montag', slots: {} }));
  });
});

describe('Private Daten', () => {
  test('Gesundheitsdaten sind fuer Mitbewohner gesperrt', async () => {
    const db = verified(BOB, { [HID]: 'member' }).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/private/health`)));
  });

  test('Auch der Admin kommt nicht an fremde Gesundheitsdaten', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${BOB}/private/health`), { allergyIds: ['soja'] });
    });
    const db = verified(ALICE, { [HID]: 'admin' }).firestore();
    await assertFails(getDoc(doc(db, `users/${BOB}/private/health`)));
  });

  test('Eigene Gesundheitsdaten sind les- und schreibbar', async () => {
    const db = verified(ALICE, { [HID]: 'admin' }).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}/private/health`)));
    await assertSucceeds(setDoc(doc(db, `users/${ALICE}/private/health`),
      { allergyIds: ['gluten'], shareAllergiesWithHousehold: true }, { merge: true }));
  });

  test('OAuth-Tokens sind fuer jeden Client gesperrt', async () => {
    const db = verified(ALICE, { [HID]: 'admin' }).firestore();
    await assertFails(getDoc(doc(db, `secureTokens/${ALICE}_google`)));
    await assertFails(setDoc(doc(db, `secureTokens/${ALICE}_google`), { cipherText: 'neu' }));
  });

  test('Benachrichtigungen kann niemand fuer andere anlegen', async () => {
    const db = verified(BOB, { [HID]: 'member' }).firestore();
    await assertFails(setDoc(doc(db, `users/${ALICE}/notifications/n1`),
      { type: 'system', title: 'Hallo' }));
  });

  test('Neues Konto legt sein eigenes Basisdokument an', async () => {
    const db = verified(MALLORY).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${MALLORY}`), {
      email: 'uid-mallory@example.com', displayName: 'Mallory', color: 'teal',
      status: 'active', householdIds: [], schemaVersion: 2,
    }));
  });

  test('Basisdokument mit fremder Email wird abgelehnt', async () => {
    const db = verified(MALLORY).firestore();
    await assertFails(setDoc(doc(db, `users/${MALLORY}`), {
      email: 'uid-alice@example.com', displayName: 'Mallory', householdIds: [],
    }));
  });

  test('householdIds kann sich niemand selbst setzen', async () => {
    const db = verified(MALLORY).firestore();
    await assertFails(setDoc(doc(db, `users/${MALLORY}`), {
      email: 'uid-mallory@example.com', householdIds: [HID],
    }, { merge: true }));
  });
});
