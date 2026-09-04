'use strict';

// Allergien: Aggregation auf Rezeptebene, optionaler Haushalts-Spiegel, private Warnungen.
//
// Datenschutz-Leitgedanke: die Allergieliste selbst verlaesst users/{uid}/private/health
// nur, wenn die Person das ausdruecklich freigegeben hat (shareAllergiesWithHousehold).
// Die Warnung zum Menueplan funktioniert trotzdem fuer alle - sie wird serverseitig
// berechnet und landet ausschliesslich im privaten Postfach der betroffenen Person.

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');

const { db, REGION, now } = require('../lib/common');

const sameSet = (a = [], b = []) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Rezept geschrieben -> Allergene aus den verknuepften Zutaten aggregieren. */
exports.aggregateRecipeAllergens = onDocumentWritten(
  { region: REGION, document: 'households/{hid}/recipes/{recipeId}' },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;

    const { hid } = event.params;
    const recipe = after.data();
    const ingredientIds = [...new Set((recipe.ingredients || [])
      .map((i) => i && i.ingredientId).filter(Boolean))];

    const allergens = new Set();
    // getAll() statt einzelner get()-Aufrufe: ein Roundtrip statt n.
    for (let i = 0; i < ingredientIds.length; i += 100) {
      const refs = ingredientIds.slice(i, i + 100)
        .map((id) => db.doc(`households/${hid}/ingredients/${id}`));
      const snaps = await db.getAll(...refs);
      snaps.forEach((s) => (s.get('allergyIds') || []).forEach((a) => allergens.add(a)));
    }

    const next = [...allergens].sort();
    if (sameSet(next, recipe.allergyIds || [])) return; // verhindert Trigger-Schleife

    await after.ref.set({ allergyIds: next, allergensUpdatedAt: now() }, { merge: true });
    logger.debug('Rezept-Allergene aktualisiert', { hid, recipeId: event.params.recipeId, next });
  }
);

/** Gesundheitsprofil geaendert -> opt-in Spiegel in allen Haushalten nachziehen. */
exports.syncAllergyMirror = onDocumentWritten(
  { region: REGION, document: 'users/{uid}/private/health' },
  async (event) => {
    const { uid } = event.params;
    const after = event.data && event.data.after;
    const before = event.data && event.data.before;
    if (!after || !after.exists) return;

    const share = after.get('shareAllergiesWithHousehold') === true;
    const allergies = share ? (after.get('allergyIds') || []) : [];
    const prevShare = before && before.exists && before.get('shareAllergiesWithHousehold') === true;
    const prevAllergies = prevShare && before ? (before.get('allergyIds') || []) : [];
    if (share === prevShare && sameSet(allergies, prevAllergies)) return;

    const householdIds = (await db.doc(`users/${uid}`).get()).get('householdIds') || [];
    const batch = db.batch();
    householdIds.forEach((hid) => {
      batch.set(db.doc(`households/${hid}/members/${uid}`), {
        sharedAllergyIds: allergies, updatedAt: now(),
      }, { merge: true });
    });
    if (householdIds.length) await batch.commit();
    logger.info('Allergie-Spiegel aktualisiert', { uid, share, households: householdIds.length });
  }
);

/**
 * Menueplan geschrieben -> pro Mitglied pruefen, ob ein geplantes Rezept
 * ein eigenes Allergen enthaelt. Ergebnis geht nur an die betroffene Person.
 */
exports.checkMenuPlanAllergies = onDocumentWritten(
  { region: REGION, document: 'households/{hid}/menuPlan/{dayKey}' },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;
    const { hid, dayKey } = event.params;

    const slots = after.get('slots') || {};
    const recipeIds = [...new Set(Object.values(slots).flat()
      .filter((e) => e && e.type === 'recipe' && e.id).map((e) => e.id))];
    if (!recipeIds.length) return;

    const recipeSnaps = await db.getAll(
      ...recipeIds.map((id) => db.doc(`households/${hid}/recipes/${id}`))
    );
    const recipes = recipeSnaps.filter((s) => s.exists).map((s) => ({
      id: s.id, title: s.get('title'), allergyIds: s.get('allergyIds') || [],
    })).filter((r) => r.allergyIds.length);
    if (!recipes.length) return;

    const memberUids = (await db.doc(`households/${hid}`).get()).get('memberUids') || [];

    for (const uid of memberUids) {
      const health = await db.doc(`users/${uid}/private/health`).get();
      const own = health.exists ? (health.get('allergyIds') || []) : [];
      if (!own.length) continue;

      for (const recipe of recipes) {
        const hits = recipe.allergyIds.filter((a) => own.includes(a));
        if (!hits.length) continue;

        // Deterministische ID: derselbe Konflikt erzeugt keine zweite Meldung.
        const notifId = `allergy_${hid}_${dayKey}_${recipe.id}`;
        await db.doc(`users/${uid}/notifications/${notifId}`).set({
          type: 'allergy',
          title: 'Allergie-Hinweis zum Menueplan',
          body: `"${recipe.title}" am ${dayKey} enthaelt: ${hits.join(', ')}.`,
          data: { householdId: hid, dayKey, recipeId: recipe.id, allergyIds: hits },
          read: false,
          createdAt: now(),
        }, { merge: true });
      }
    }
  }
);
