'use strict';

// Nestbau v2.0 – Mengen- und Einheiten-Logik fuer den Rezept-Import.
//
// Die Pauschal-Umrechnungen sind bewusst identisch zu denen, die die App
// bereits fuer Einkaufsliste und Naehrwerte nutzt (Stueck≈100 g, EL≈15 g,
// TL≈5 g, Prise≈1 g). Sonst haette ein importiertes Rezept andere Kalorien
// als dasselbe Rezept von Hand erfasst.

/** Kanonische Einheiten -> Gramm-Aequivalent. */
const UNIT_GRAMS = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  ml: 1,          // Annahme Dichte 1 – fuer Oel/Sirup leicht zu hoch
  cl: 10,
  dl: 100,
  l: 1000,
  el: 15,
  tl: 5,
  msp: 0.5,
  prise: 1,
  stk: 100,
  bund: 50,
  zehe: 5,
  scheibe: 25,
  stange: 100,
  blatt: 2,
  dose: 400,
  packung: 250,
  becher: 200,
  tasse: 240,
  glas: 200,
  handvoll: 30,
  schuss: 10,
  kugel: 50,
  wuerfel: 10
};

/** Schreibweisen (klein, ohne Punkt) -> kanonische Einheit. */
const UNIT_ALIASES = {
  g: 'g', gr: 'g', gramm: 'g', gramms: 'g',
  kg: 'kg', kilo: 'kg', kilogramm: 'kg',
  mg: 'mg', milligramm: 'mg',
  ml: 'ml', milliliter: 'ml',
  cl: 'cl', centiliter: 'cl', zentiliter: 'cl',
  dl: 'dl', deziliter: 'dl',
  l: 'l', liter: 'l', lt: 'l',
  el: 'el', essloffel: 'el', esl: 'el', tbsp: 'el', tablespoon: 'el',
  tl: 'tl', teeloffel: 'tl', tsp: 'tl', teaspoon: 'tl', kl: 'tl',
  msp: 'msp', messerspitze: 'msp',
  prise: 'prise', prisen: 'prise', pinch: 'prise',
  stk: 'stk', stuck: 'stk', st: 'stk', pc: 'stk', piece: 'stk', pieces: 'stk',
  bund: 'bund', bundel: 'bund',
  zehe: 'zehe', zehen: 'zehe', clove: 'zehe', cloves: 'zehe',
  scheibe: 'scheibe', scheiben: 'scheibe', slice: 'scheibe', slices: 'scheibe',
  stange: 'stange', stangen: 'stange', stalk: 'stange',
  blatt: 'blatt', blatter: 'blatt',
  dose: 'dose', dosen: 'dose', can: 'dose', konserve: 'dose',
  packung: 'packung', packungen: 'packung', pkg: 'packung', packchen: 'packung', pck: 'packung',
  becher: 'becher',
  tasse: 'tasse', tassen: 'tasse', cup: 'tasse', cups: 'tasse',
  glas: 'glas', glaser: 'glas',
  handvoll: 'handvoll', hand: 'handvoll',
  schuss: 'schuss', spritzer: 'schuss', dash: 'schuss',
  kugel: 'kugel', kugeln: 'kugel',
  wurfel: 'wuerfel'
};

/** Anzeige-Label je kanonischer Einheit (was der Nutzer im Formular sieht). */
const UNIT_LABELS = {
  g: 'g', kg: 'kg', mg: 'mg', ml: 'ml', cl: 'cl', dl: 'dl', l: 'l',
  el: 'EL', tl: 'TL', msp: 'Msp.', prise: 'Prise', stk: 'Stück',
  bund: 'Bund', zehe: 'Zehe', scheibe: 'Scheibe', stange: 'Stange',
  blatt: 'Blatt', dose: 'Dose', packung: 'Packung', becher: 'Becher',
  tasse: 'Tasse', glas: 'Glas', handvoll: 'Handvoll', schuss: 'Schuss',
  kugel: 'Kugel', wuerfel: 'Würfel'
};

const UNICODE_FRACTIONS = {
  '\u00BD': 0.5, '\u2153': 1 / 3, '\u2154': 2 / 3, '\u00BC': 0.25, '\u00BE': 0.75,
  '\u2155': 0.2, '\u2156': 0.4, '\u2157': 0.6, '\u2158': 0.8, '\u2159': 1 / 6,
  '\u215B': 0.125, '\u215C': 0.375, '\u215D': 0.625, '\u215E': 0.875
};

/** Fuellwoerter, die im Zutaten-Namen nichts zur Identitaet beitragen. */
const NAME_NOISE = [
  'frisch', 'frische', 'frischer', 'frisches', 'frischen',
  'getrocknet', 'getrocknete', 'getrockneter', 'getrocknetes',
  'gehackt', 'gehackte', 'gehackter', 'gehacktes',
  'gewurfelt', 'gewurfelte', 'gewurfelter', 'gewurfeltes',
  'gerieben', 'geriebene', 'geriebener', 'geriebenes',
  'gemahlen', 'gemahlene', 'gemahlener', 'gemahlenes',
  'bio', 'fein', 'feine', 'feiner', 'grob', 'grobe', 'grober',
  'gross', 'grosse', 'grosser', 'grosses', 'klein', 'kleine', 'kleiner', 'kleines',
  'nach', 'geschmack', 'belieben', 'etwas', 'ca', 'evtl', 'optional',
  'zum', 'zur', 'fur', 'die', 'der', 'das', 'den', 'dem', 'ein', 'eine', 'einen'
];

function foldGerman(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/\u00E4/g, 'a').replace(/\u00F6/g, 'o').replace(/\u00FC/g, 'u')
    .replace(/\u00DF/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalisierte Form eines Zutaten-Namens fuer den Abgleich mit der
 * Zutaten-Datenbank. Bewusst aggressiv: lieber ein Treffer zu viel, den der
 * Nutzer im Editor korrigiert, als gar keiner.
 */
function normalizeIngredientName(value) {
  const folded = foldGerman(value).replace(/[^a-z0-9\s-]/g, ' ');
  const tokens = folded.split(/[\s-]+/).filter(Boolean).filter((t) => !NAME_NOISE.includes(t));
  return (tokens.length ? tokens : folded.split(/\s+/).filter(Boolean)).join(' ').trim();
}

function normalizeUnit(token) {
  if (!token) return null;
  const key = foldGerman(token).replace(/\./g, '').trim();
  return UNIT_ALIASES[key] || null;
}

/** "1", "1,5", "1/2", "1 1/2", Bruchzeichen, "2-3" -> Zahl (Bereiche gemittelt). */
function parseAmountToken(token) {
  if (!token) return null;
  const t = String(token).trim();
  if (UNICODE_FRACTIONS[t] != null) return UNICODE_FRACTIONS[t];

  const range = t.match(/^([0-9]+(?:[.,][0-9]+)?)\s*[-\u2013\u2014]\s*([0-9]+(?:[.,][0-9]+)?)$/);
  if (range) {
    return (parseFloat(range[1].replace(',', '.')) + parseFloat(range[2].replace(',', '.'))) / 2;
  }

  const frac = t.match(/^([0-9]+)\s*\/\s*([0-9]+)$/);
  if (frac) {
    const denominator = parseFloat(frac[2]);
    return denominator ? parseFloat(frac[1]) / denominator : null;
  }

  const plain = t.match(/^([0-9]+(?:[.,][0-9]+)?)$/);
  if (plain) return parseFloat(plain[1].replace(',', '.'));

  return null;
}

const GLUED_RE = /^([0-9]+(?:[.,][0-9]+)?)([a-zA-Z\u00E4\u00F6\u00FC]+)$/;

/**
 * Zerlegt eine Zutatenzeile in Menge / Einheit / Name.
 * Deckt sowohl "200 g Mehl" als auch das auf Instagram uebliche
 * "Mehl 200g" ab. Ohne erkennbare Menge bleibt amount null – die Zeile
 * geht trotzdem durch, damit der Nutzer nicht blockiert wird.
 */
function parseIngredientLine(raw) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return null;

  let note = '';
  let text = original
    .replace(/^[\s\-\u2013\u2014\u2022*\u00B7o\u25A2\u25A1\u2610+]+/, '')
    .replace(/\(([^)]*)\)/g, (_m, inner) => { note = note ? `${note}, ${inner}` : inner; return ' '; })
    .replace(/\s+/g, ' ')
    .trim();

  // Nachgestellte Zubereitungshinweise abtrennen: "Zwiebel, fein gehackt"
  const commaParts = text.split(',');
  if (commaParts.length > 1 && commaParts[0].trim().length >= 3) {
    const tail = commaParts.slice(1).join(',').trim();
    if (tail && !/[0-9]/.test(tail)) {
      note = note ? `${note}, ${tail}` : tail;
      text = commaParts[0].trim();
    }
  }

  let amount = null;
  let unit = null;
  let tokens = text.split(' ').filter(Boolean);
  if (!tokens.length) return null;

  // Fall A: Menge steht vorne ("200 g Mehl", "1 1/2 EL Oel", "1/2 Bund Petersilie")
  const leading = parseAmountToken(tokens[0]);
  if (leading != null) {
    let consumed = 1;
    amount = leading;

    const second = parseAmountToken(tokens[1]);
    if (second != null && second < 1 && Number.isInteger(leading)) {
      amount = leading + second;   // gemischter Bruch "1 1/2"
      consumed = 2;
    }

    const maybeUnit = normalizeUnit(tokens[consumed]);
    if (maybeUnit) {
      unit = maybeUnit;
      consumed += 1;
    }
    tokens = tokens.slice(consumed);
  } else {
    // Zahl und Einheit kleben zusammen ("200g Mehl")
    const glued = tokens[0].match(GLUED_RE);
    if (glued && normalizeUnit(glued[2])) {
      amount = parseAmountToken(glued[1]);
      unit = normalizeUnit(glued[2]);
      tokens = tokens.slice(1);
    }
  }

  // Fall B: Menge steht hinten ("Mehl 200 g", "Milch 2dl") – Instagram-Stil
  if (amount == null && tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    const glued = last.match(GLUED_RE);
    if (glued && normalizeUnit(glued[2])) {
      amount = parseAmountToken(glued[1]);
      unit = normalizeUnit(glued[2]);
      tokens = tokens.slice(0, -1);
    } else {
      const trailingUnit = normalizeUnit(last);
      const trailingAmount = parseAmountToken(tokens[tokens.length - 2]);
      if (trailingUnit && trailingAmount != null) {
        amount = trailingAmount;
        unit = trailingUnit;
        tokens = tokens.slice(0, -2);
      }
    }
  }

  if (amount != null && !unit) unit = 'stk';

  const name = tokens.join(' ').replace(/^[\s:\u2013-]+|[\s:\u2013-]+$/g, '').trim();
  if (!name) return null;

  return {
    raw: original,
    amount: amount != null ? Math.round(amount * 1000) / 1000 : null,
    unit,
    unitLabel: unit ? UNIT_LABELS[unit] : null,
    name,
    normalizedName: normalizeIngredientName(name),
    note: note.trim() || null
  };
}

/** Menge in Gramm – null, wenn keine Menge bekannt ist. */
function toGrams(amount, unit) {
  if (amount == null || !Number.isFinite(amount)) return null;
  const factor = UNIT_GRAMS[unit || 'stk'];
  if (factor == null) return null;
  return amount * factor;
}

// ---------------------------------------------------------- App-Einheiten

/**
 * Die App kennt nur diese acht Einheiten (index.html: UNIT_GRAMS/UNIT_LABELS).
 * Der Parser erkennt bewusst viel mehr – ein Rezept schreibt nun mal "1 Bund
 * Petersilie". Vor dem Speichern muss aber alles auf die App-Einheiten
 * abgebildet werden, sonst zeigt die App eine Einheit an, die sie nicht kennt.
 */
const APP_UNITS = { g: 1, kg: 1000, ml: 1, l: 1000, stueck: 100, el: 15, tl: 5, prise: 1 };

const APP_UNIT_DIRECT = {
  g: 'g', kg: 'kg', ml: 'ml', l: 'l', stk: 'stueck', el: 'el', tl: 'tl', prise: 'prise'
};

/**
 * Rechnet (Menge, Parser-Einheit) in (Menge, App-Einheit) um.
 * Alles, was die App nicht kennt, wird zu Gramm – die Originalangabe wandert
 * als Notiz mit, damit "1 Bund" im Rezept nicht einfach verschwindet.
 *
 * Rueckgabe: { amount, unit, note } – note ist null, wenn nichts verloren ging.
 */
function toAppUnit(amount, unit) {
  if (amount == null || !Number.isFinite(amount)) {
    return { amount: null, unit: unit && APP_UNIT_DIRECT[unit] ? APP_UNIT_DIRECT[unit] : 'g', note: null };
  }

  const direct = APP_UNIT_DIRECT[unit || 'stk'];
  if (direct) return { amount: Math.round(amount * 100) / 100, unit: direct, note: null };

  const grams = toGrams(amount, unit);
  if (grams == null) return { amount: Math.round(amount * 100) / 100, unit: 'g', note: null };

  const label = UNIT_LABELS[unit] || unit;
  const shown = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  return {
    amount: Math.round(grams * 10) / 10,
    unit: unit === 'cl' || unit === 'dl' ? 'ml' : 'g',
    note: `${shown} ${label}`
  };
}

module.exports = {
  UNIT_GRAMS, UNIT_ALIASES, UNIT_LABELS, APP_UNITS, APP_UNIT_DIRECT,
  foldGerman, normalizeIngredientName, normalizeUnit,
  parseAmountToken, parseIngredientLine, toGrams, toAppUnit
};
