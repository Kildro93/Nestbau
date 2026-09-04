'use strict';

// Upload-Validierung und Aufraeumen verwaister Bilder.

const { onObjectFinalized } = require('firebase-functions/v2/storage');
const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');

const { admin, db, REGION, now } = require('../lib/common');

const MAX_BYTES = { avatar: 5 * 1024 * 1024, household: 8 * 1024 * 1024 };
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// users/{uid}/avatar/{file}  |  households/{hid}/{kind}/{docId}/{file}
const AVATAR_RE = /^users\/([^/]+)\/avatar\/[^/]+$/;
const HOUSEHOLD_RE = /^households\/([^/]+)\/(recipes|ingredients|ingredientCategories|cover)\/([^/]+)\/[^/]+$/;

/**
 * Zweite Verteidigungslinie hinter den Storage Rules: die Rules pruefen die
 * angekuendigte Groesse und den Content-Type, hier steht das fertige Objekt.
 * Alles, was nicht passt, fliegt wieder raus - sonst sammelt der Bucket Muell,
 * fuer den weiter bezahlt wird.
 */
exports.validateUpload = onObjectFinalized(
  { region: REGION, memory: '256MiB' },
  async (event) => {
    const { name, contentType, size, bucket } = event.data;
    if (!name) return;

    const isAvatar = AVATAR_RE.test(name);
    const householdMatch = name.match(HOUSEHOLD_RE);
    if (!isAvatar && !householdMatch) {
      if (name.startsWith('migrations/')) return; // schreibt nur das Admin SDK
      logger.warn('Upload ausserhalb erlaubter Pfade - wird geloescht', { name });
      await admin.storage().bucket(bucket).file(name).delete().catch(() => {});
      return;
    }

    const limit = isAvatar ? MAX_BYTES.avatar : MAX_BYTES.household;
    const problems = [];
    if (!ALLOWED_TYPES.includes(contentType)) problems.push(`Content-Type ${contentType}`);
    if (Number(size) > limit) problems.push(`Groesse ${size} > ${limit}`);

    if (problems.length) {
      logger.warn('Ungueltiger Upload geloescht', { name, problems });
      await admin.storage().bucket(bucket).file(name).delete().catch(() => {});
      return;
    }

    // Cache-Header setzen: Rezeptfotos aendern sich selten, sparen so Bandbreite.
    await admin.storage().bucket(bucket).file(name)
      .setMetadata({ cacheControl: 'private, max-age=604800' })
      .catch((err) => logger.debug('setMetadata fehlgeschlagen', { name, err: err.message }));

    if (householdMatch) {
      const [, hid] = householdMatch;
      await db.doc(`households/${hid}`).set({ storageUpdatedAt: now() }, { merge: true })
        .catch(() => {});
    }
  }
);

/** Rezept geloescht -> zugehoerige Bilder loeschen. */
exports.onRecipeDeleted = onDocumentDeleted(
  { region: REGION, document: 'households/{hid}/recipes/{recipeId}' },
  async (event) => {
    const { hid, recipeId } = event.params;
    await admin.storage().bucket()
      .deleteFiles({ prefix: `households/${hid}/recipes/${recipeId}/` })
      .catch((err) => logger.warn('Bildloeschung fehlgeschlagen', { recipeId, err: err.message }));
  }
);

/** Zutat geloescht -> zugehoerige Bilder loeschen. */
exports.onIngredientDeleted = onDocumentDeleted(
  { region: REGION, document: 'households/{hid}/ingredients/{ingId}' },
  async (event) => {
    const { hid, ingId } = event.params;
    await admin.storage().bucket()
      .deleteFiles({ prefix: `households/${hid}/ingredients/${ingId}/` })
      .catch((err) => logger.warn('Bildloeschung fehlgeschlagen', { ingId, err: err.message }));
  }
);
