/**
 * Nestbau v2 – Cloud Functions
 *
 * WICHTIG: Diese Functions sind OPTIONAL. Die App läuft auch ohne sie!
 * Sie können später deployed werden, wenn nötig.
 *
 * Deployment:
 *   npm install -g firebase-tools
 *   cd ./functions
 *   npm install
 *   firebase deploy --only functions
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// Firebase Admin SDK initialisieren
admin.initializeApp();
const db = admin.firestore();

/**
 * 1. HAUSHALT ERSTELLT – Initialisierung + Metadaten
 *
 * Wird ausgelöst, wenn ein neuer Haushalt angelegt wird.
 * Optional: Logging, Cleanup, oder Willkommens-Email
 */
exports.onHouseholdCreated = functions.firestore
  .document('households/{householdId}')
  .onCreate(async (snap, context) => {
    const householdId = context.params.householdId;
    const houseData = snap.data();

    console.log(`Haushalt erstellt: ${householdId} (${houseData.name})`);

    // Optional: Willkommens-Email an Besitzer senden
    // (würde Admin SDK + Email-Service benötigen)

    return {
      status: 'initialized',
      householdId: householdId
    };
  });

/**
 * 2. HAUSHALT GELÖSCHT – Cleanup
 *
 * Wenn ein Haushalt gelöscht wird, auch die Subsammlungen aufräumen.
 * (Firestore macht das nicht automatisch)
 */
exports.onHouseholdDeleted = functions.firestore
  .document('households/{householdId}')
  .onDelete(async (snap, context) => {
    const householdId = context.params.householdId;

    console.log(`Haushalt gelöscht: ${householdId} - Aufräumen...`);

    // Alle Subsammlungen löschen
    const collections = [
      'members', 'ingredients', 'recipes', 'ingredientCategories',
      'ingredientGroups', 'dishCategories', 'menuPlan', 'events',
      'subscriptions', 'meta'
    ];

    for (const collName of collections) {
      await deleteCollection(db, `households/${householdId}/${collName}`);
    }

    // Beitrittscode ebenfalls löschen
    const hhRef = db.collection('households').doc(householdId);
    const hhData = snap.data();
    if (hhData.joinCode) {
      await db.collection('joinCodes').doc(hhData.joinCode).delete();
    }

    console.log(`Haushalt ${householdId} komplett gelöscht`);
  });

/**
 * 3. MITGLIED HINZUGEFÜGT – Willkommens-Event (Optional)
 *
 * Wenn jemand einem Haushalt beitritt, optional ein Welcome-Event erstellen.
 */
exports.onMemberJoined = functions.firestore
  .document('households/{householdId}/members/{userId}')
  .onCreate(async (snap, context) => {
    const { householdId, userId } = context.params;
    const member = snap.data();

    console.log(`Mitglied beigetreten: ${member.name || member.email} zu ${householdId}`);

    // Optional: Welcome-Event erstellen
    // const hhRef = db.collection('households').doc(householdId);
    // await hhRef.collection('events').add({
    //   title: `${member.name} ist beigetreten`,
    //   date: admin.firestore.FieldValue.serverTimestamp(),
    //   source: 'system',
    //   completed: false
    // });

    return { status: 'welcomed' };
  });

/**
 * 4. REZEPT AKTUALISIERT – Konsistenz-Checks (Optional)
 *
 * Wenn ein Rezept aktualisiert wird, optional Validierungen durchführen.
 * Z.B. Zutat-Referenzen prüfen.
 */
exports.onRecipeUpdated = functions.firestore
  .document('households/{householdId}/recipes/{recipeId}')
  .onUpdate(async (change, context) => {
    const { householdId, recipeId } = context.params;
    const oldRecipe = change.before.data();
    const newRecipe = change.after.data();

    // Nur Debugging für jetzt
    console.log(`Rezept aktualisiert: ${recipeId} in ${householdId}`);

    // Optional: Validierungen durchführen
    // z.B. Zutaten prüfen, die nicht existieren

    return { status: 'validated' };
  });

/**
 * 5. BILD GELÖSCHT – Storage-Cleanup (Optional)
 *
 * Wenn ein Rezept gelöscht wird, auch die Bilder aus Storage entfernen.
 * (Verhindert verwaiste Dateien)
 */
exports.onRecipeDeleted = functions.firestore
  .document('households/{householdId}/recipes/{recipeId}')
  .onDelete(async (snap, context) => {
    const { householdId } = context.params;
    const recipe = snap.data();

    // Wenn das Rezept ein Bild-URL hat, könnte man dieses löschen
    // (aber nur wenn keine anderen Rezepte dasselbe Bild benutzen)
    console.log(`Rezept gelöscht: ${recipe.name}`);

    // Optional: Image löschen (komplex, da Hashing)

    return { status: 'cleaned' };
  });

/**
 * HILFSFUNKTIONEN
 */

/**
 * Rekursiv alle Dokumente einer Collection löschen
 * (Firestore hat keinen CASCADE DELETE)
 */
async function deleteCollection(db, path, batchSize = 100) {
  const collRef = db.collection(path);
  const query = collRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve, reject);
  });
}

async function deleteQueryBatch(db, query, resolve, reject) {
  try {
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
      resolve();
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    // Rekursiv bis alle gelöscht sind
    process.nextTick(() => {
      deleteQueryBatch(db, query, resolve, reject);
    });
  } catch (error) {
    reject(error);
  }
}

/**
 * ADVANCED: Volltextsuche via Algolia (optional)
 *
 * Falls später Suche wichtig wird:
 *
 * exports.indexRecipe = functions.firestore
 *   .document('households/{householdId}/recipes/{recipeId}')
 *   .onWrite(async (change, context) => {
 *     const index = client.initIndex('recipes');
 *     const recipe = change.after.data();
 *
 *     await index.saveObject({
 *       objectID: context.params.recipeId,
 *       householdId: context.params.householdId,
 *       ...recipe
 *     });
 *   });
 */
