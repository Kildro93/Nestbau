'use strict';

// Nestbau v2.0 – Zutaten-Abgleich, Naehrwerte, Allergien, Kategorie.
//
// Alles hier laeuft ohne KI: reine Zeichenketten- und Rechenarbeit auf der
// bestehenden Zutaten-Datenbank des Haushalts. Das ist schneller, kostenlos
// und – wichtiger – reproduzierbar. Die KI liefert nur den Rohtext-Aufbruch.

const { normalizeIngredientName, foldGerman, toGrams } = require('./recipeUnits');

/** Feste Allergen-Liste der App (identisch zum Zutaten-Formular). */
const ALLERGENS = {
  gluten: 'Gluten',
  laktose: 'Laktose',
  eier: 'Eier',
  erdnuesse: 'Erdnuesse',
  nuesse: 'Nuesse/Schalenfruechte',
  soja: 'Soja',
  fisch: 'Fisch',
  krebstiere: 'Krebstiere',
  sellerie: 'Sellerie',
  senf: 'Senf'
};

/**
 * Stichwort-Fallback fuer Zutaten, die (noch) nicht in der Datenbank stehen.
 * Bewusst als Warnung zweiter Klasse markiert – ein Treffer hier heisst
 * "koennte enthalten", nicht "enthaelt".
 */
const ALLERGEN_KEYWORDS = {
  gluten: ['mehl', 'weizen', 'dinkel', 'gerste', 'roggen', 'brot', 'brot chen', 'brotchen', 'semmel',
    'paniermehl', 'panko', 'nudel', 'nudeln', 'pasta', 'spaghetti', 'couscous', 'bulgur',
    'grie ss', 'griess', 'seitan', 'malz', 'bier', 'teig', 'blatterteig', 'cracker', 'zwieback'],
  laktose: ['milch', 'rahm', 'sahne', 'butter', 'kase', 'quark', 'joghurt', 'jogurt', 'mascarpone',
    'ricotta', 'mozzarella', 'parmesan', 'creme fraiche', 'schmand', 'buttermilch', 'kondensmilch'],
  eier: ['ei', 'eier', 'eigelb', 'eiweiss', 'eiklar', 'mayonnaise', 'meringue', 'baiser'],
  erdnuesse: ['erdnuss', 'erdnusse', 'erdnussbutter', 'peanut'],
  nuesse: ['mandel', 'mandeln', 'haselnuss', 'walnuss', 'cashew', 'pistazie', 'pekan', 'macadamia',
    'paranuss', 'nuss', 'nusse', 'marzipan', 'nougat'],
  soja: ['soja', 'sojasauce', 'sojasosse', 'tofu', 'edamame', 'miso', 'tempeh'],
  fisch: ['fisch', 'lachs', 'thunfisch', 'forelle', 'kabeljau', 'dorsch', 'hering', 'sardelle',
    'anchovis', 'sardine', 'zander', 'seelachs', 'fischsauce', 'worcester'],
  krebstiere: ['garnele', 'garnelen', 'crevette', 'crevetten', 'shrimp', 'scampi', 'hummer',
    'krebs', 'krabbe', 'langustine'],
  sellerie: ['sellerie', 'knollensellerie', 'staudensellerie'],
  senf: ['senf', 'dijon', 'senfkorner', 'senfsaat']
};

/** Stichworte fuer die automatische Gerichte-Kategorie. */
const CATEGORY_KEYWORDS = {
  fruehstueck: ['fruhstuck', 'breakfast', 'porridge', 'overnight oats', 'muesli', 'musli', 'granola',
    'pancake', 'pfannkuchen', 'ruhrei', 'rührei', 'omelett', 'brunch', 'smoothie bowl',
    'birchermuesli', 'birchermusli', 'zopf', 'croissant', 'toast'],
  dessert: ['dessert', 'nachtisch', 'kuchen', 'torte', 'creme', 'mousse', 'tiramisu', 'pudding',
    'eis', 'glace', 'sorbet', 'keks', 'cookie', 'brownie', 'muffin', 'waffel', 'crumble',
    'panna cotta', 'cheesecake', 'tarte', 'gebäck', 'geback', 'praline'],
  getraenk: ['getrank', 'getränk', 'drink', 'cocktail', 'smoothie', 'shake', 'limonade', 'punsch',
    'tee', 'kaffee', 'latte', 'sirup', 'bowle', 'saft', 'mocktail'],
  snack: ['snack', 'zwischenmahlzeit', 'dip', 'aufstrich', 'fingerfood', 'apero', 'apéro',
    'riegel', 'energy ball', 'popcorn', 'chips', 'cracker', 'hummus'],
  mittagabend: ['hauptgericht', 'mittagessen', 'abendessen', 'auflauf', 'pfanne', 'curry', 'eintopf',
    'suppe', 'braten', 'schnitzel', 'risotto', 'pasta', 'lasagne', 'pizza', 'burger',
    'gratin', 'wok', 'salat', 'bowl', 'ragout', 'geschnetzeltes']
};

/** schema.org recipeCategory -> Nestbau-Kategorie. */
const SCHEMA_CATEGORY_MAP = {
  breakfast: 'fruehstueck', fruhstuck: 'fruehstueck', brunch: 'fruehstueck',
  dessert: 'dessert', nachspeise: 'dessert', nachtisch: 'dessert', kuchen: 'dessert',
  backen: 'dessert', torte: 'dessert',
  drink: 'getraenk', beverage: 'getraenk', getrank: 'getraenk', cocktail: 'getraenk', smoothie: 'getraenk',
  snack: 'snack', appetizer: 'snack', vorspeise: 'snack', apero: 'snack',
  main: 'mittagabend', maincourse: 'mittagabend', maindish: 'mittagabend',
  hauptgericht: 'mittagabend', hauptspeise: 'mittagabend', dinner: 'mittagabend',
  lunch: 'mittagabend', mittagessen: 'mittagabend', abendessen: 'mittagabend'
};

// ---------------------------------------------------------- Zutaten-Match

function tokenSet(value) {
  return new Set(String(value || '').split(/\s+/).filter((t) => t.length > 2));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Ordnet eine geparste Zutat einem Datensatz aus der Zutaten-DB zu.
 * Vier Stufen, absteigende Sicherheit. Ab 0.5 gilt es als Treffer – darunter
 * werden nur Vorschlaege geliefert, die der Nutzer im Editor bestaetigt.
 */
function matchIngredient(parsedName, ingredientIndex) {
  const needle = normalizeIngredientName(parsedName);
  if (!needle) return { ingredientId: null, confidence: 0, candidates: [] };

  const exact = ingredientIndex.byName.get(needle);
  if (exact) return { ingredientId: exact.id, confidence: 1, candidates: [] };

  // Singular/Plural: "Zwiebeln" -> "Zwiebel", "Tomaten" -> "Tomate"
  for (const variant of [needle.replace(/n$/, ''), needle.replace(/en$/, ''), `${needle}n`, `${needle}e`]) {
    const hit = variant !== needle && ingredientIndex.byName.get(variant);
    if (hit) return { ingredientId: hit.id, confidence: 0.9, candidates: [] };
  }

  const needleTokens = tokenSet(needle);
  const scored = ingredientIndex.list
    .map((entry) => {
      const similarity = jaccard(needleTokens, entry.tokens);
      const contains = entry.normalized.includes(needle) || needle.includes(entry.normalized);
      return { entry, score: Math.max(similarity, contains ? 0.7 : 0) };
    })
    .filter((row) => row.score > 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return { ingredientId: null, confidence: 0, candidates: [] };

  const best = scored[0];
  return {
    ingredientId: best.score >= 0.5 ? best.entry.id : null,
    confidence: Math.round(best.score * 100) / 100,
    candidates: scored.map((row) => ({
      ingredientId: row.entry.id,
      name: row.entry.name,
      score: Math.round(row.score * 100) / 100
    }))
  };
}

/** Baut den Suchindex einmal pro Import statt pro Zutat. */
function buildIngredientIndex(ingredientDocs) {
  const byName = new Map();
  const list = [];

  for (const doc of ingredientDocs || []) {
    const name = String(doc.name || '').trim();
    if (!name) continue;
    const normalized = normalizeIngredientName(name);
    const entry = {
      id: doc.id,
      name,
      normalized,
      tokens: tokenSet(normalized),
      doc
    };
    if (!byName.has(normalized)) byName.set(normalized, entry);
    list.push(entry);
  }

  return { byName, list, byId: new Map(list.map((e) => [e.id, e])) };
}

// -------------------------------------------------------------- Naehrwerte

/**
 * Naehrwerte einer Zutat lesen.
 * Die App speichert flach: { baseGrams, kcal, protein, fat, carbs }.
 * Das verschachtelte `nutrition`-Objekt wird trotzdem akzeptiert, falls es
 * spaeter eingefuehrt wird – so bricht der Import nicht beim naechsten Umbau.
 */
function readNutrition(doc) {
  const source = doc.nutrition && typeof doc.nutrition === 'object' ? doc.nutrition : doc;
  const basis = Number(source.baseGrams != null ? source.baseGrams : source.basisG);
  return {
    basisG: Number.isFinite(basis) && basis > 0 ? basis : 100,
    kcal: Number(source.kcal) || 0,
    protein: Number(source.protein) || 0,
    fat: Number(source.fat) || 0,
    carbs: Number(source.carbs) || 0
  };
}

/** Allergene einer Zutat – App-Feld ist `allergyIds`. */
function readAllergens(doc) {
  const value = Array.isArray(doc.allergyIds) ? doc.allergyIds
    : Array.isArray(doc.allergens) ? doc.allergens : [];
  return value.filter((id) => ALLERGENS[id]);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Summiert die Naehrwerte aller zugeordneten Zutaten.
 * `coverage` sagt, welcher Gewichtsanteil des Rezepts abgedeckt ist – ohne
 * diese Zahl wirkt eine Summe aus drei von zwoelf Zutaten serioeser als sie ist.
 */
function computeNutrition(ingredients, matches, ingredientIndex, servings) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const unmatched = [];
  let matchedGrams = 0;
  let totalGrams = 0;

  ingredients.forEach((item, index) => {
    const grams = toGrams(item.amount, item.unit);
    if (grams != null) totalGrams += grams;

    const match = matches[index];
    const entry = match && match.ingredientId ? ingredientIndex.byId.get(match.ingredientId) : null;

    if (!entry) {
      unmatched.push({ index, name: item.name, reason: 'no_match' });
      return;
    }
    if (grams == null) {
      unmatched.push({ index, name: item.name, reason: 'no_amount' });
      return;
    }

    const nutrition = readNutrition(entry.doc);
    const factor = grams / nutrition.basisG;
    totals.kcal += nutrition.kcal * factor;
    totals.protein += nutrition.protein * factor;
    totals.fat += nutrition.fat * factor;
    totals.carbs += nutrition.carbs * factor;
    matchedGrams += grams;
  });

  const perServing = servings && servings > 0
    ? {
      kcal: Math.round(totals.kcal / servings),
      protein: round1(totals.protein / servings),
      fat: round1(totals.fat / servings),
      carbs: round1(totals.carbs / servings)
    }
    : null;

  return {
    total: {
      kcal: Math.round(totals.kcal),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbs: round1(totals.carbs)
    },
    perServing,
    totalWeightG: totalGrams > 0 ? Math.round(totalGrams) : null,
    coverage: totalGrams > 0 ? Math.round((matchedGrams / totalGrams) * 100) / 100 : 0,
    unmatched
  };
}

// --------------------------------------------------------------- Allergien

/**
 * Vergleicht die Rezept-Zutaten mit den Allergien der Haushalts-Mitglieder.
 * `members` sind die Member-Cards (households/{hid}/members) – die enthalten
 * Allergien nur, wenn das Mitglied sie freiwillig geteilt hat. Ungeteilte
 * Profile werden nicht angefasst.
 */
function detectAllergies(ingredients, matches, ingredientIndex, members) {
  // Member-Cards heissen in der App `name`; Bot 1 legt zusaetzlich
  // `displayName` und die freiwillig geteilten Allergien an.
  const relevant = (members || [])
    .map((m) => ({
      uid: m.uid || m.id,
      displayName: m.displayName || m.name || 'Mitglied',
      allergies: (Array.isArray(m.allergies) ? m.allergies
        : Array.isArray(m.allergyIds) ? m.allergyIds : []).filter((a) => ALLERGENS[a])
    }))
    .filter((m) => m.allergies.length);

  if (!relevant.length) return [];

  // allergen -> { certain: Set<zutatName>, likely: Set<zutatName> }
  const found = new Map();
  const add = (allergen, name, certain) => {
    if (!ALLERGENS[allergen]) return;
    if (!found.has(allergen)) found.set(allergen, { certain: new Set(), likely: new Set() });
    found.get(allergen)[certain ? 'certain' : 'likely'].add(name);
  };

  ingredients.forEach((item, index) => {
    const match = matches[index];
    const entry = match && match.ingredientId ? ingredientIndex.byId.get(match.ingredientId) : null;

    const known = entry ? readAllergens(entry.doc) : [];
    if (known.length) {
      known.forEach((allergen) => add(allergen, item.name, true));
      return;
    }

    // Kein Datensatz oder keine Allergen-Angabe: Stichwort-Heuristik
    const haystack = foldGerman(`${item.name} ${item.note || ''}`);
    for (const [allergen, keywords] of Object.entries(ALLERGEN_KEYWORDS)) {
      if (keywords.some((keyword) => haystack.includes(keyword))) add(allergen, item.name, false);
    }
  });

  const warnings = [];
  for (const [allergen, hits] of found) {
    const affected = relevant.filter((m) => m.allergies.includes(allergen));
    if (!affected.length) continue;

    const certain = [...hits.certain];
    const likely = [...hits.likely].filter((name) => !hits.certain.has(name));

    warnings.push({
      allergen,
      label: ALLERGENS[allergen],
      certainty: certain.length ? 'confirmed' : 'suspected',
      ingredients: [...certain, ...likely].slice(0, 8),
      members: affected.map((m) => ({ uid: m.uid, displayName: m.displayName }))
    });
  }

  // Bestaetigte Treffer zuerst – die sollen oben in der Warnung stehen.
  return warnings.sort((a, b) => (a.certainty === b.certainty ? 0 : a.certainty === 'confirmed' ? -1 : 1));
}

// -------------------------------------------------------------- Kategorie

/**
 * Automatische Gerichte-Kategorie. Reihenfolge der Evidenz:
 * schema.org-Kategorie > KI-Vorschlag > Stichworte im Titel > Fallback "main".
 */
function guessCategories(parsed) {
  const fromSchema = [];
  for (const keyword of parsed.keywords || []) {
    const key = foldGerman(keyword).replace(/[^a-z]/g, '');
    if (SCHEMA_CATEGORY_MAP[key]) fromSchema.push(SCHEMA_CATEGORY_MAP[key]);
  }
  if (fromSchema.length) return [...new Set(fromSchema)].slice(0, 2);

  if (Array.isArray(parsed.aiCategories) && parsed.aiCategories.length) {
    return [...new Set(parsed.aiCategories)].slice(0, 2);
  }

  const haystack = foldGerman(`${parsed.title} ${parsed.description}`);
  const scores = Object.entries(CATEGORY_KEYWORDS).map(([category, keywords]) => ({
    category,
    score: keywords.filter((keyword) => haystack.includes(foldGerman(keyword))).length
  })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score);

  return scores.length ? [scores[0].category] : ['mittagabend'];
}

/**
 * Alles zusammen – wird vom Import-Trigger aufgerufen.
 */
function enrich(parsed, ingredientDocs, members) {
  const index = buildIngredientIndex(ingredientDocs);
  const matches = parsed.ingredients.map((item) => matchIngredient(item.name, index));

  return {
    matches,
    nutrition: computeNutrition(parsed.ingredients, matches, index, parsed.servings),
    allergyWarnings: detectAllergies(parsed.ingredients, matches, index, members),
    categories: guessCategories(parsed)
  };
}

module.exports = {
  ALLERGENS, ALLERGEN_KEYWORDS, CATEGORY_KEYWORDS, SCHEMA_CATEGORY_MAP,
  buildIngredientIndex, matchIngredient, computeNutrition, readNutrition, readAllergens,
  detectAllergies, guessCategories, enrich
};
