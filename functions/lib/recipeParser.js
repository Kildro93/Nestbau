'use strict';

// Nestbau v2.0 – Rezept-Parser.
//
// Zwei Stufen, bewusst in dieser Reihenfolge:
//  1. Deterministisch aus schema.org/Recipe (JSON-LD oder Microdata). Fast
//     jede Rezept-Website liefert das mit – kostet nichts, ist exakt und
//     braucht keine KI.
//  2. KI-Parsing mit Claude, wenn Stufe 1 leer/unvollstaendig bleibt
//     (Instagram-Captions, Blog-Fliesstext, Foren-Posts).
//
// Der Grund fuer die Reihenfolge ist nicht nur Geld: Bei sauberem JSON-LD
// erfindet ein Modell im Zweifel Mengen, die im Original nie standen.

const Anthropic = require('@anthropic-ai/sdk');
const { parseIngredientLine } = require('./recipeUnits');

const MODEL = 'claude-opus-5';

/** Nestbau-Gerichte-Kategorien (IDs muessen zu DISH_CATEGORIES in der App passen). */
const DISH_CATEGORIES = ['breakfast', 'main', 'snack', 'dessert', 'drink'];

const MAX_TEXT_CHARS = 24000;      // was maximal ins Modell wandert
const MAX_INGREDIENTS = 60;
const MAX_STEPS = 40;

// ---------------------------------------------------------------- Helpers

function htmlToText(value) {
  return String(value == null ? '' : value)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function asText(value) {
  const v = first(value);
  if (v == null) return '';
  if (typeof v === 'string') return htmlToText(v);
  if (typeof v === 'object' && typeof v.name === 'string') return htmlToText(v.name);
  if (typeof v === 'object' && typeof v.text === 'string') return htmlToText(v.text);
  return '';
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

/** ISO-8601-Dauer ("PT1H30M") -> Minuten. */
function isoDurationToMinutes(value) {
  const raw = first(value);
  if (typeof raw === 'number') return clamp(Math.round(raw), 1, 6000);
  if (typeof raw !== 'string') return null;

  const iso = raw.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+(?:\.\d+)?S)?)?$/i);
  if (iso) {
    const minutes = (Number(iso[1] || 0) * 1440) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0);
    return minutes > 0 ? clamp(minutes, 1, 6000) : null;
  }

  // Freitext-Fallback: "35 Minuten", "1 Std 20 Min"
  const hours = raw.match(/(\d+)\s*(?:h|std|stunde)/i);
  const mins = raw.match(/(\d+)\s*(?:min)/i);
  const total = (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
  if (total > 0) return clamp(total, 1, 6000);

  const bare = raw.match(/(\d+)/);
  return bare ? clamp(Number(bare[1]), 1, 6000) : null;
}

function parseYield(value) {
  const raw = first(value);
  if (typeof raw === 'number') return clamp(Math.round(raw), 1, 50);
  if (typeof raw === 'object' && raw && raw.value != null) return parseYield(raw.value);
  if (typeof raw !== 'string') return null;
  const match = raw.match(/(\d+)/);
  return match ? clamp(Number(match[1]), 1, 50) : null;
}

/** recipeInstructions kann String, HowToStep[] oder HowToSection[] sein. */
function flattenInstructions(value, depth = 0) {
  if (value == null || depth > 3) return [];

  if (typeof value === 'string') {
    return htmlToText(value)
      .split(/\n+|(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenInstructions(entry, depth + 1));
  }

  if (typeof value === 'object') {
    if (value.itemListElement) return flattenInstructions(value.itemListElement, depth + 1);
    if (value.text) return flattenInstructions(value.text, depth + 1);
    if (value.name) return flattenInstructions(value.name, depth + 1);
  }

  return [];
}

function imageFromJsonLd(node) {
  const image = first(node.image);
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (typeof image === 'object') {
    if (typeof image.url === 'string') return image.url;
    if (Array.isArray(image.url)) return image.url[0];
    if (typeof image.contentUrl === 'string') return image.contentUrl;
  }
  return null;
}

/** Findet das erste Recipe-Objekt in beliebig verschachteltem JSON-LD. */
function findRecipeNode(input, depth = 0) {
  if (!input || depth > 6) return null;

  if (Array.isArray(input)) {
    for (const entry of input) {
      const found = findRecipeNode(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof input !== 'object') return null;

  const type = input['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe')) return input;

  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'hasPart']) {
    if (input[key]) {
      const found = findRecipeNode(input[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ------------------------------------------------------- Stufe 1: JSON-LD

/**
 * Baut ein Nestbau-Rezept aus schema.org/Recipe.
 * Gibt null zurueck, wenn kein Recipe-Knoten drin steckt.
 */
function fromJsonLd(jsonLdBlocks) {
  const blocks = Array.isArray(jsonLdBlocks) ? jsonLdBlocks : [jsonLdBlocks];
  let node = null;

  for (const block of blocks) {
    let data = block;
    if (typeof block === 'string') {
      try { data = JSON.parse(block); } catch { continue; }
    }
    node = findRecipeNode(data);
    if (node) break;
  }
  if (!node) return null;

  const ingredientLines = []
    .concat(node.recipeIngredient || node.ingredients || [])
    .map((line) => (typeof line === 'string' ? htmlToText(line) : asText(line)))
    .filter(Boolean)
    .slice(0, MAX_INGREDIENTS);

  const steps = flattenInstructions(node.recipeInstructions).slice(0, MAX_STEPS);

  const prepMinutes = isoDurationToMinutes(node.prepTime);
  const cookMinutes = isoDurationToMinutes(node.cookTime);
  const totalMinutes = isoDurationToMinutes(node.totalTime)
    || (prepMinutes || cookMinutes ? (prepMinutes || 0) + (cookMinutes || 0) : null);

  return {
    engine: 'jsonld',
    title: asText(node.name).slice(0, 120),
    description: asText(node.description).slice(0, 400),
    servings: parseYield(node.recipeYield),
    timeMinutes: totalMinutes,
    ingredientLines,
    prep: [],
    steps,
    utensils: [],
    notes: '',
    imageUrl: imageFromJsonLd(node),
    author: asText(node.author).slice(0, 80) || null,
    keywords: []
      .concat(node.keywords || [], node.recipeCategory || [], node.recipeCuisine || [])
      .flatMap((k) => (typeof k === 'string' ? k.split(',') : []))
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 20)
  };
}

/** Reicht das JSON-LD-Ergebnis ohne KI-Nachbearbeitung? */
function isJsonLdSufficient(result) {
  return Boolean(result
    && result.title
    && result.ingredientLines.length >= 2
    && result.steps.length >= 1);
}

// ------------------------------------------------------------ Stufe 2: KI

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    isRecipe: {
      type: 'boolean',
      description: 'false, wenn der Text gar kein Rezept beschreibt.'
    },
    title: { type: 'string', description: 'Kurzer Gerichtname ohne Hashtags und Emojis.' },
    description: { type: 'string', description: 'Ein Satz, hoechstens 200 Zeichen. Leer lassen, wenn nichts dasteht.' },
    servings: { type: ['integer', 'null'], description: 'Portionen, null wenn nicht angegeben.' },
    timeMinutes: { type: ['integer', 'null'], description: 'Gesamtzeit in Minuten, null wenn nicht angegeben.' },
    totalWeightG: { type: ['integer', 'null'], description: 'Gesamtgewicht in Gramm, nur wenn explizit angegeben.' },
    categories: {
      type: 'array',
      description: 'Passende Nestbau-Kategorien.',
      items: { type: 'string', enum: DISH_CATEGORIES },
      maxItems: 2
    },
    ingredients: {
      type: 'array',
      maxItems: MAX_INGREDIENTS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amount: { type: ['number', 'null'], description: 'Zahlenwert, null wenn keine Menge dasteht.' },
          unit: { type: ['string', 'null'], description: 'Einheit wie im Original: g, kg, ml, dl, l, EL, TL, Stück, Bund, Zehe, Dose, Prise. null wenn keine.' },
          name: { type: 'string', description: 'Reiner Zutatenname ohne Menge und ohne Zubereitungshinweis.' },
          note: { type: ['string', 'null'], description: 'Zubereitungshinweis wie "fein gehackt", sonst null.' }
        },
        required: ['amount', 'unit', 'name', 'note']
      }
    },
    prep: {
      type: 'array',
      description: 'Vorbereitungsschritte (Mise en place). Leer, wenn der Text nicht trennt.',
      maxItems: MAX_STEPS,
      items: { type: 'string' }
    },
    steps: {
      type: 'array',
      description: 'Zubereitungsschritte in Reihenfolge, je ein Schritt pro Eintrag.',
      maxItems: MAX_STEPS,
      items: { type: 'string' }
    },
    utensils: {
      type: 'array',
      description: 'Genannte Kuechengeraete, z.B. "Ofen", "Standmixer". Nur was im Text steht.',
      maxItems: 12,
      items: { type: 'string' }
    },
    notes: { type: 'string', description: 'Tipps/Varianten aus dem Text. Leer, wenn keine.' },
    confidence: { type: 'number', description: 'Selbsteinschaetzung 0..1, wie vollstaendig das Rezept rekonstruiert wurde.' },
    warnings: {
      type: 'array',
      description: 'Was unklar blieb, in einem kurzen deutschen Satz je Eintrag.',
      maxItems: 8,
      items: { type: 'string' }
    }
  },
  required: ['isRecipe', 'title', 'description', 'servings', 'timeMinutes', 'totalWeightG',
    'categories', 'ingredients', 'prep', 'steps', 'utensils', 'notes', 'confidence', 'warnings']
};

const SYSTEM_PROMPT = [
  'Du strukturierst Rezepte fuer die Haushalts-App Nestbau. Eingabe ist roher Text von',
  'einer Website oder einer Instagram-Caption: Hashtags, Emojis, Werbung und Geschwafel',
  'inklusive.',
  '',
  'Regeln:',
  '- Erfinde nichts. Fehlende Mengen, Zeiten oder Portionen bleiben null. Eine geratene',
  '  Menge ist schlimmer als eine fehlende, weil daraus Naehrwerte berechnet werden.',
  '- Uebernimm Mengen exakt so, wie sie dastehen (auch "1/2", "2-3", "etwas").',
  '  "etwas"/"nach Geschmack" bedeutet amount = null.',
  '- Trenne Zutatenname und Zubereitungshinweis: "2 Zwiebeln, fein gehackt" wird zu',
  '  name "Zwiebeln", note "fein gehackt".',
  '- Schritte in sinnvolle Einzelschritte teilen, aber Formulierungen des Autors behalten.',
  '- Antworte auf Deutsch, auch wenn das Original englisch ist. Zutatennamen uebersetzen.',
  '- categories: breakfast (Fruehstueck), main (Mittag-/Abendessen), snack, dessert, drink.',
  '- isRecipe = false, wenn der Text kein Rezept ist (z.B. reine Restaurantwerbung).'
].join('\n');

function buildUserPrompt(raw) {
  const parts = [];
  if (raw.sourceType) parts.push(`Quelle: ${raw.sourceType === 'instagram' ? 'Instagram-Beitrag' : 'Website'}`);
  if (raw.url) parts.push(`URL: ${raw.url}`);
  if (raw.siteName) parts.push(`Seite: ${raw.siteName}`);
  if (raw.title) parts.push(`Seitentitel: ${raw.title}`);
  parts.push('', 'Roher Text:', '---', String(raw.text || '').slice(0, MAX_TEXT_CHARS), '---');
  return parts.join('\n');
}

/**
 * KI-Parsing mit Claude. Structured Output erzwingt das Schema, damit der
 * Aufrufer nicht auf Freitext-Parsing angewiesen ist.
 */
async function aiParse(raw, apiKey) {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    // "medium" reicht: Extraktion aus vorliegendem Text, kein schweres Denken.
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: RECIPE_SCHEMA }
    },
    messages: [{ role: 'user', content: buildUserPrompt(raw) }]
  });

  if (response.stop_reason === 'refusal') {
    const err = new Error('Das Modell hat die Verarbeitung abgelehnt.');
    err.code = 'refusal';
    throw err;
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error('Antwort des Modells war kein gueltiges JSON.');
    err.code = 'bad_json';
    throw err;
  }

  return {
    data,
    usage: {
      inputTokens: response.usage ? response.usage.input_tokens : null,
      outputTokens: response.usage ? response.usage.output_tokens : null
    }
  };
}

// ------------------------------------------------------------ Kombination

function normalizeIngredients(lines, structured) {
  // Bevorzugt die strukturierten Zutaten der KI; ohne die zerlegt der
  // Regex-Parser die Rohzeilen.
  if (Array.isArray(structured) && structured.length) {
    return structured
      .map((item) => {
        const name = String(item && item.name ? item.name : '').trim();
        if (!name) return null;
        const composed = [
          item.amount != null ? String(item.amount) : '',
          item.unit || '',
          name
        ].filter(Boolean).join(' ');
        const parsed = parseIngredientLine(composed) || parseIngredientLine(name);
        if (!parsed) return null;
        // Der Name der KI ist sauberer als der Rest des Regex-Splits.
        parsed.name = name;
        parsed.raw = composed;
        parsed.note = item.note ? String(item.note).slice(0, 120) : parsed.note;
        return parsed;
      })
      .filter(Boolean)
      .slice(0, MAX_INGREDIENTS);
  }

  return (lines || [])
    .map((line) => parseIngredientLine(line))
    .filter(Boolean)
    .slice(0, MAX_INGREDIENTS);
}

function cleanStrings(list, max, maxLen) {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s == null ? '' : s).trim())
    .filter((s) => s.length > 1)
    .map((s) => s.slice(0, maxLen))
    .slice(0, max);
}

/**
 * Haupteinstieg. `raw` kommt genau so vom Web Clipper:
 *   { sourceType, url, siteName, title, text, jsonLd, imageUrl, author }
 *
 * Wirft nie wegen fehlender KI – ohne API-Key oder bei API-Fehlern kommt das
 * zurueck, was deterministisch herausgeholt werden konnte, mit Warnung.
 */
async function parseRecipe(raw, options = {}) {
  const apiKey = options.apiKey || null;
  const warnings = [];
  const jsonLd = fromJsonLd(raw.jsonLd);
  const jsonLdOk = isJsonLdSufficient(jsonLd);

  let ai = null;
  let usage = null;
  let engine = jsonLdOk ? 'jsonld' : 'none';

  if (!jsonLdOk) {
    if (!apiKey) {
      warnings.push('Kein KI-Schluessel konfiguriert – nur strukturierte Daten der Seite verwendet.');
    } else {
      try {
        const result = await aiParse(raw, apiKey);
        ai = result.data;
        usage = result.usage;
        engine = jsonLd ? 'jsonld+ai' : 'ai';
        if (ai && ai.isRecipe === false) {
          warnings.push('Der Text sieht nicht nach einem Rezept aus – bitte pruefen.');
        }
        warnings.push(...cleanStrings(ai && ai.warnings, 8, 200));
      } catch (error) {
        engine = jsonLd ? 'jsonld' : 'none';
        warnings.push(`KI-Parsing fehlgeschlagen (${error.code || error.name || 'Fehler'}) – Rohtext bleibt erhalten.`);
      }
    }
  }

  const ingredients = normalizeIngredients(
    jsonLd ? jsonLd.ingredientLines : [],
    ai ? ai.ingredients : null
  );

  const steps = (ai && ai.steps && ai.steps.length)
    ? cleanStrings(ai.steps, MAX_STEPS, 600)
    : cleanStrings(jsonLd ? jsonLd.steps : [], MAX_STEPS, 600);

  const title = (jsonLd && jsonLd.title)
    || (ai && String(ai.title || '').trim())
    || String(raw.title || '').trim().slice(0, 120)
    || 'Importiertes Rezept';

  const parsed = {
    title: title.slice(0, 120),
    description: ((jsonLd && jsonLd.description) || (ai && ai.description) || '').slice(0, 400),
    servings: (jsonLd && jsonLd.servings) || (ai && clamp(ai.servings, 1, 50)) || null,
    timeMinutes: (jsonLd && jsonLd.timeMinutes) || (ai && clamp(ai.timeMinutes, 1, 6000)) || null,
    totalWeightG: (ai && clamp(ai.totalWeightG, 1, 50000)) || null,
    ingredients,
    prep: cleanStrings(ai ? ai.prep : [], MAX_STEPS, 600),
    steps,
    utensils: cleanStrings(ai ? ai.utensils : [], 12, 60),
    notes: String((ai && ai.notes) || '').trim().slice(0, 1000),
    aiCategories: Array.isArray(ai && ai.categories)
      ? ai.categories.filter((c) => DISH_CATEGORIES.includes(c))
      : [],
    keywords: (jsonLd && jsonLd.keywords) || [],
    imageUrl: (jsonLd && jsonLd.imageUrl) || raw.imageUrl || null,
    author: (jsonLd && jsonLd.author) || raw.author || null
  };

  if (!parsed.ingredients.length) warnings.push('Keine Zutaten erkannt – bitte manuell ergaenzen.');
  if (!parsed.steps.length) warnings.push('Keine Zubereitungsschritte erkannt – bitte manuell ergaenzen.');

  return {
    parsed,
    meta: {
      engine,
      model: engine.includes('ai') ? MODEL : null,
      confidence: ai && Number.isFinite(ai.confidence)
        ? clamp(ai.confidence, 0, 1)
        : (jsonLdOk ? 0.95 : 0.3),
      warnings: warnings.slice(0, 12),
      usage
    }
  };
}

module.exports = {
  MODEL, DISH_CATEGORIES, RECIPE_SCHEMA,
  htmlToText, isoDurationToMinutes, parseYield, flattenInstructions,
  fromJsonLd, isJsonLdSufficient, aiParse, parseRecipe
};
