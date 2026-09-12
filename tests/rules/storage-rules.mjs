/* Nestbau v2 – Regeltests fuer Storage (Rezept- und Zutatenfotos).
 *
 * Ausfuehren:  npm run test:rules
 *
 * Die Storage-Regeln schlagen fuer die Mitgliedschaft in Firestore nach
 * (households/{hid}.memberUids). Deshalb laufen hier beide Emulatoren.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import { readFileSync } from 'node:fs';

const HID = 'haushalt-1';
const A = 'uid-indra';
const B = 'uid-partnerin';
const X = 'uid-fremder';

// Ein winziges, gueltiges GIF – reicht als "Bild" fuer die contentType-Pruefung.
const BILD = Uint8Array.from(
  atob('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='),
  (c) => c.charCodeAt(0));
const META = { contentType: 'image/gif' };

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'nestbau-rules-test',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1', port: 8080,
    },
    storage: {
      rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1', port: 9199,
    },
  });
});

after(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'households', HID), {
      name: 'Nestbau', ownerUid: A, memberUids: [A, B], joinCode: 'ABCD1234',
    });
  });
});

const stA = () => testEnv.authenticatedContext(A).storage();
const stB = () => testEnv.authenticatedContext(B).storage();
const stX = () => testEnv.authenticatedContext(X).storage();
const stAnon = () => testEnv.unauthenticatedContext().storage();

describe('Storage', () => {
  const PFAD = `households/${HID}/images/abc123.gif`;
  const REZEPT_PFAD = `households/${HID}/recipes/r1/images/titel.gif`;

  it('Mitglied laedt hoch, Partner liest und loescht', async () => {
    await assertSucceeds(uploadBytes(ref(stA(), PFAD), BILD, META));
    await assertSucceeds(getBytes(ref(stB(), PFAD)));
    await assertSucceeds(deleteObject(ref(stB(), PFAD)));
  });

  it('auch der Rezeptpfad funktioniert', async () => {
    await assertSucceeds(uploadBytes(ref(stA(), REZEPT_PFAD), BILD, META));
    await assertSucceeds(getBytes(ref(stB(), REZEPT_PFAD)));
  });

  it('Fremde kommen nicht heran', async () => {
    await assertSucceeds(uploadBytes(ref(stA(), PFAD), BILD, META));
    await assertFails(getBytes(ref(stX(), PFAD)));
    await assertFails(uploadBytes(ref(stX(), PFAD), BILD, META));
    await assertFails(deleteObject(ref(stX(), PFAD)));
  });

  it('ohne Anmeldung geht gar nichts', async () => {
    await assertFails(uploadBytes(ref(stAnon(), PFAD), BILD, META));
  });

  it('ohne Haushaltsdokument wird abgelehnt, nicht gecrasht', async () => {
    // Frueher lieferte firestore.get() hier null und die Auswertung brach mit
    // einer EvaluationException ab, statt sauber abzulehnen.
    await assertFails(
      uploadBytes(ref(stA(), 'households/gibt-es-nicht/images/x.gif'), BILD, META));
  });

  it('nur Bilder – kein PDF, kein Skript', async () => {
    await assertFails(uploadBytes(ref(stA(), `households/${HID}/images/x.pdf`),
      BILD, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(stA(), `households/${HID}/images/x.js`),
      BILD, { contentType: 'text/javascript' }));
  });

  it('Bilder ueber 10 MB werden abgewiesen', async () => {
    const zuGross = new Uint8Array(10 * 1024 * 1024 + 1);
    await assertFails(
      uploadBytes(ref(stA(), `households/${HID}/images/gross.gif`), zuGross, META));
  });

  it('ausserhalb von households/ ist alles gesperrt', async () => {
    await assertFails(uploadBytes(ref(stA(), 'irgendwo/x.gif'), BILD, META));
    await assertFails(uploadBytes(ref(stA(), `recipes/${HID}/r1/images/x.gif`), BILD, META));
  });
});
