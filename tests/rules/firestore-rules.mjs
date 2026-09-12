/* Nestbau v2 – Regeltests gegen den Firestore-Emulator.
 *
 * Ausfuehren:  npm run test:rules
 * (startet die Emulatoren, laeuft ohne Firebase-Projekt und ohne Netz)
 *
 * Bewusst NICHT *.test.mjs benannt: `npm test` faehrt ueber
 * tests/(**)/*.test.mjs und soll ohne laufende Emulatoren durchlaufen.
 *
 * Die Tests bilden ab, was die App wirklich tut: zwei Konten, ein gemeinsamer
 * Haushalt, ein Fremder ohne Zugriff. Jede Sammlung aus NB.cloud.COLLECTIONS
 * kommt vor - im September 2026 fielen lists, events und subscriptions in den
 * Auffangblock am Ende der Regeln, und der Sync scheiterte erst beim Schreiben.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, arrayUnion,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const HID = 'haushalt-1';
const A = 'uid-indra';       // Besitzer
const B = 'uid-partnerin';   // beigetreten
const X = 'uid-fremder';     // gehoert nicht dazu

/* Muss zu NB.cloud.COLLECTIONS in js/nb-firebase.js passen, plus menuPlan und
   meta. Neue Sammlung? Hier UND in firestore.rules eintragen. */
const MEMBER_COLLECTIONS = [
  'lists', 'events', 'subscriptions',
  'ingredients', 'recipes', 'ingredientCategories', 'ingredientGroups',
  'dishCategories', 'menuPlan', 'meta',
];

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'nestbau-rules-test',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Ausgangslage ohne Regelpruefung herstellen.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households', HID), {
      name: 'Nestbau', ownerUid: A, joinCode: 'ABCD1234',
      memberUids: [A, B], schemaVersion: 2,
    });
    await setDoc(doc(db, 'joinCodes', 'ABCD1234'), { householdId: HID, ownerUid: A });
    await setDoc(doc(db, 'households', HID, 'members', A), { uid: A, role: 'owner' });
    await setDoc(doc(db, 'households', HID, 'members', B), { uid: B, role: 'member' });
  });
});

const asA = () => testEnv.authenticatedContext(A).firestore();
const asB = () => testEnv.authenticatedContext(B).firestore();
const asX = () => testEnv.authenticatedContext(X).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

describe('Haushaltsdaten', () => {
  it('Mitglied liest den Haushalt, Fremder nicht', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'households', HID)));
    await assertSucceeds(getDoc(doc(asB(), 'households', HID)));
    await assertFails(getDoc(doc(asX(), 'households', HID)));
    await assertFails(getDoc(doc(asAnon(), 'households', HID)));
  });

  it('Haushalte lassen sich nicht auflisten', async () => {
    await assertFails(getDocs(collection(asA(), 'households')));
  });

  it('Besitzer bleibt Besitzer – niemand stuft sich hoch', async () => {
    await assertFails(updateDoc(doc(asB(), 'households', HID), { ownerUid: B }));
  });

  it('Mitglied wirft kein anderes Mitglied raus, der Besitzer schon', async () => {
    await assertFails(updateDoc(doc(asB(), 'households', HID), { memberUids: [B] }));
    await assertSucceeds(updateDoc(doc(asA(), 'households', HID), { memberUids: [A] }));
  });

  it('auch der Besitzer kann sich nicht selbst herausloeschen', async () => {
    await assertFails(updateDoc(doc(asA(), 'households', HID), { memberUids: [B] }));
  });

  it('nur der Besitzer loescht den Haushalt', async () => {
    await assertFails(deleteDoc(doc(asB(), 'households', HID)));
    await assertSucceeds(deleteDoc(doc(asA(), 'households', HID)));
  });
});

describe('Beitritt', () => {
  it('Fremder loest einen bekannten Code auf und tritt sich selbst hinzu', async () => {
    await assertSucceeds(getDoc(doc(asX(), 'joinCodes', 'ABCD1234')));
    await assertSucceeds(
      updateDoc(doc(asX(), 'households', HID), { memberUids: arrayUnion(X) }));
  });

  it('Codes lassen sich nicht durchprobieren (kein list)', async () => {
    await assertFails(getDocs(collection(asX(), 'joinCodes')));
    await assertFails(getDoc(doc(asAnon(), 'joinCodes', 'ABCD1234')));
  });

  it('beim Beitritt laesst sich nichts anderes mitaendern', async () => {
    await assertFails(updateDoc(doc(asX(), 'households', HID), {
      memberUids: arrayUnion(X), name: 'Uebernommen',
    }));
  });

  it('niemand schmuggelt beim Beitritt einen fremden uid hinein', async () => {
    await assertFails(updateDoc(doc(asX(), 'households', HID), {
      memberUids: [A, B, 'uid-noch-jemand'],
    }));
  });
});

describe('Sammlungen der Features', () => {
  for (const coll of MEMBER_COLLECTIONS) {
    it(`${coll}: beide Partner lesen und schreiben, Fremde nicht`, async () => {
      await assertSucceeds(setDoc(doc(asA(), 'households', HID, coll, 'd1'), { t: 1 }));
      // Partner-Sync: B sieht und aendert, was A geschrieben hat.
      await assertSucceeds(getDoc(doc(asB(), 'households', HID, coll, 'd1')));
      await assertSucceeds(setDoc(doc(asB(), 'households', HID, coll, 'd1'), { t: 2 }));
      await assertSucceeds(getDocs(collection(asB(), 'households', HID, coll)));
      await assertSucceeds(deleteDoc(doc(asB(), 'households', HID, coll, 'd1')));

      await assertFails(getDocs(collection(asX(), 'households', HID, coll)));
      await assertFails(setDoc(doc(asX(), 'households', HID, coll, 'd2'), { t: 3 }));
      await assertFails(getDocs(collection(asAnon(), 'households', HID, coll)));
    });
  }

  it('eine nicht vorgesehene Sammlung bleibt gesperrt', async () => {
    await assertFails(setDoc(doc(asA(), 'households', HID, 'schattendaten', 'd1'), { t: 1 }));
  });

  it('Aufgaben der Partnerin darf man abhaken', async () => {
    await assertSucceeds(setDoc(doc(asA(), 'households', HID, 'lists', 'l1'), {
      name: 'Aufgaben', kind: 'todo', items: [{ id: 'i1', text: 'Muell', done: false }],
    }));
    await assertSucceeds(updateDoc(doc(asB(), 'households', HID, 'lists', 'l1'), {
      items: [{ id: 'i1', text: 'Muell', done: true }],
    }));
  });
});

describe('Mitgliedereintraege', () => {
  it('jeder pflegt nur den eigenen Eintrag', async () => {
    await assertSucceeds(setDoc(doc(asB(), 'households', HID, 'members', B), { uid: B, name: 'Partnerin' }));
    await assertFails(setDoc(doc(asB(), 'households', HID, 'members', A), { uid: A, name: 'gekapert' }));
  });

  it('der Besitzer darf einen Eintrag entfernen', async () => {
    await assertSucceeds(deleteDoc(doc(asA(), 'households', HID, 'members', B)));
  });

  it('Fremde sehen die Mitglieder nicht', async () => {
    await assertFails(getDocs(collection(asX(), 'households', HID, 'members')));
  });
});

describe('Nutzerprofile', () => {
  it('nur das eigene Profil ist les- und schreibbar', async () => {
    await assertSucceeds(setDoc(doc(asA(), 'users', A), { uid: A, displayName: 'Indra' }));
    await assertSucceeds(getDoc(doc(asA(), 'users', A)));
    await assertFails(getDoc(doc(asB(), 'users', A)));
    await assertFails(setDoc(doc(asB(), 'users', A), { uid: A, displayName: 'gekapert' }));
  });

  it('Profile lassen sich nicht auflisten', async () => {
    await assertFails(getDocs(collection(asA(), 'users')));
  });

  it('eigene Unterebenen sind erreichbar, fremde nicht', async () => {
    await assertSucceeds(setDoc(doc(asA(), 'users', A, 'geraete', 'handy'), { lastSync: 1 }));
    await assertFails(setDoc(doc(asB(), 'users', A, 'geraete', 'handy'), { lastSync: 2 }));
  });

  it('die uid im Profil bleibt fest', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', A), { uid: A });
    });
    await assertFails(updateDoc(doc(asA(), 'users', A), { uid: B }));
  });
});

describe('Alles andere', () => {
  it('Sammlungen ausserhalb des Schemas sind gesperrt', async () => {
    await assertFails(setDoc(doc(asA(), 'irgendwas', 'd1'), { t: 1 }));
    await assertFails(getDoc(doc(asA(), 'irgendwas', 'd1')));
  });
});
