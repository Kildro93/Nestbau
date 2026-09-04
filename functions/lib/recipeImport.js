'use strict';

// Nestbau v2.0 – Rezept-Import: Endpunkte und Verarbeitungskette.
//
// Ablauf:
//   Clipper --POST--> clipRecipe        (schreibt Doc mit status "pending", antwortet sofort)
//                       |
//                       v
//               processRecipeImport     (Firestore-Trigger: Parsen, Bild, Naehrwerte)
//                       |
//                       v
//               status "ready"  --->  App zeigt Import-Posteingang
//                       |
//                       v
//               commitRecipeImport      (User hat editiert und uebernommen -> echtes Rezept)
//
// Die Trennung zwischen Endpunkt und Trigger ist Absicht: der Popup-Button
// soll nach ~300 ms fertig sein, nicht nach dem KI-Aufruf. Ausserdem ist der
// Trigger wiederholbar, ohne dass der Nutzer die Seite erneut oeffnen muss.

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

const { db, FieldValue, REGION, requireVerifiedAuth, assertString } = require('./common');
const clipperTokens = require('./clipperTokens');
const { parseRecipe } = require('./recipeParser');
const { enrich } = require('./recipeNutrition');
const { fetchImageSafely, storeImage, copyImage, deleteImage } = require('./recipeImage');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const MAX_BODY_CHARS = 400000;      // ~400 KB Rohtext reicht fuer jede Rezeptseite
const MAX_RAW_TEXT = 60000;

// ---------------------------------------------------------------- Helpers

/** Haushalt des Nutzers ermitteln – ohne den geht kein Import. */
async function resolveHousehold(uid, requestedId) {
  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : null;
  const householdId = requestedId || (user && user.activeHouseholdId) || null;

  if (!householdId) {
    throw new HttpsError('failed-precondition', 'Kein Haushalt ausgewaehlt. Bitte zuerst einen Haushalt anlegen.');
  }

  const hh = await db.collection('households').doc(householdId).get();
  if (!hh.exists || !hh.data().members || !hh.data().members[uid]) {
    throw new HttpsError('permission-denied', 'Kein Zugriff auf diesen Haushalt.');
  }
  return householdId;
}

async function assertMembership(uid, householdId) {
  const hh = await db.collection('households').doc(householdId).get();
  if (!hh.exists || !hh.data().members || !hh.data().members[uid]) {
    throw new HttpsError('permission-denied', 'Kein Zugriff auf diesen Haushalt.');
  }
  return hh.data();
}

function trimText(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

/** Was der Clipper schickt, auf eine feste Form bringen. */
function sanitizeClip(body) {
  const sourceType = ['web', 'instagram', 'manual'].includes(body.sourceType) ? body.sourceType : 'web';

  let url = null;
  if (body.url) {
    try {
      const parsed = new URL(String(body.url));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.toString().slice(0, 800);
    } catch { /* ungueltige URL wird einfach verworfen */ }
  }

  const jsonLd = Array.isArray(body.jsonLd)
    ? body.jsonLd.slice(0, 8).map((entry) => trimText(typeof entry === 'string' ? entry : JSON.stringify(entry), 60000))
    : [];

  return {
    sourceType,
    url,
    siteName: trimText(body.siteName, 120),
    title: trimText(body.title, 200),
    author: trimText(body.author, 80) || null,
    text: trimText(body.text, MAX_RAW_TEXT),
    jsonLd,
    imageUrl: trimText(body.imageUrl, 1000) || null,
    capturedAt: Date.now()
  };
}

async function createImportDoc(householdId, uid, clip, origin) {
  const ref = db.collection('households').doc(householdId).collection('recipeImports').doc();
  await ref.set({
    status: 'pending',
    source: {
      type: clip.sourceType,
      url: clip.url,
      siteName: clip.siteName || null,
      author: clip.author,
      origin,                       // "clipper" | "app"
      capturedAt: clip.capturedAt
    },
    raw: {
      title: clip.title,
      text: clip.text,
      jsonLd: clip.jsonLd,
      imageUrl: clip.imageUrl
    },
    parsed: null,
    matches: null,
    nutrition: null,
    allergyWarnings: [],
    categories: [],
    image: null,
    parser: null,
    error: null,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return ref;
}

// ------------------------------------------------- Verarbeitung (geteilt)

/**
 * Der eigentliche Import-Lauf. Bewusst so gebaut, dass jeder Teilschritt
 * einzeln scheitern darf: ein kaputtes Foto soll nicht das ganze Rezept
 * verlieren, eine fehlende Zutaten-DB nicht das Parsen.
 */
async function runImport(householdId, importId) {
  const ref = db.collection('households').doc(householdId).collection('recipeImports').doc(importId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data();
  if (data.status === 'committed') return;

  await ref.update({ status: 'parsing', error: null, updatedAt: FieldValue.serverTimestamp() });

  try {
    const raw = {
      sourceType: data.source ? data.source.type : 'web',
      url: data.source ? data.source.url : null,
      siteName: data.source ? data.source.siteName : null,
      author: data.source ? data.source.author : null,
      title: data.raw ? data.raw.title : '',
      text: data.raw ? data.raw.text : '',
      jsonLd: data.raw ? data.raw.jsonLd : [],
      imageUrl: data.raw ? data.raw.imageUrl : null
    };

    const apiKey = process.env.ANTHROPIC_API_KEY || null;
    const { parsed, meta } = await parseRecipe(raw, { apiKey });

    // Zutaten-DB und Mitglieder-Karten des Haushalts parallel holen.
    const [ingredientSnap, memberSnap] = await Promise.all([
      db.collection('households').doc(householdId).collection('ingredients').limit(2000).get(),
      db.collection('households').doc(householdId).collection('members').limit(20).get()
    ]);

    const ingredientDocs = ingredientSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const members = memberSnap.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));

    const enriched = enrich(parsed, ingredientDocs, members);

    // Foto: darf scheitern, ohne den Import zu kippen.
    let image = null;
    const warnings = [...meta.warnings];
    if (parsed.imageUrl) {
      try {
        const downloaded = await fetchImageSafely(parsed.imageUrl);
        image = await storeImage(
          `households/${householdId}/recipeImports/${importId}/original.${downloaded.extension}`,
          downloaded.buffer,
          downloaded.contentType
        );
        image.bytes = downloaded.bytes;
        image.sourceUrl = parsed.imageUrl;
      } catch (error) {
        logger.warn('Bild-Import fehlgeschlagen', { householdId, importId, message: error.message });
        warnings.push(`Foto konnte nicht uebernommen werden: ${error.message}`);
      }
    }

    await ref.update({
      status: 'ready',
      parsed: {
        title: parsed.title,
        description: parsed.description,
        servings: parsed.servings,
        timeMinutes: parsed.timeMinutes,
        totalWeightG: parsed.totalWeightG || enriched.nutrition.totalWeightG,
        ingredients: parsed.ingredients,
        prep: parsed.prep,
        steps: parsed.steps,
        utensils: parsed.utensils,
        notes: parsed.notes
      },
      matches: enriched.matches,
      nutrition: enriched.nutrition,
      allergyWarnings: enriched.allergyWarnings,
      categories: enriched.categories,
      image,
      parser: {
        engine: meta.engine,
        model: meta.model,
        confidence: meta.confidence,
        warnings: warnings.slice(0, 12),
        usage: meta.usage || null
      },
      error: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    logger.error('Import fehlgeschlagen', { householdId, importId, message: error.message, stack: error.stack });
    await ref.update({
      status: 'failed',
      error: { message: String(error.message || 'Unbekannter Fehler').slice(0, 400), at: Date.now() },
      updatedAt: FieldValue.serverTimestamp()
    });
  }
}

// -------------------------------------------------------------- Endpunkte

/**
 * HTTP-Endpunkt fuer den Web Clipper.
 * Auth ueber Bearer-Geraete-Token, nicht ueber Cookies – deshalb ist ein
 * offenes CORS hier unproblematisch (kein Browser schickt das Token
 * automatisch mit).
 */
const clipRecipe = onRequest(
  { region: REGION, cors: true, maxInstances: 10, memory: '256MiB', timeoutSeconds: 30 },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Nur POST.' }); return; }

    const header = String(req.get('Authorization') || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    let session;
    try {
      session = await clipperTokens.verifyAndConsume(token);
    } catch (error) {
      res.status(error.status || 401).json({ error: error.message });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (JSON.stringify(body).length > MAX_BODY_CHARS) {
      res.status(413).json({ error: 'Seiteninhalt zu gross.' });
      return;
    }

    const clip = sanitizeClip(body);
    if (!clip.text && !clip.jsonLd.length) {
      res.status(400).json({ error: 'Nichts zum Importieren gefunden.' });
      return;
    }

    try {
      const householdId = session.householdId
        || await resolveHousehold(session.uid, null).catch(() => null);
      if (!householdId) {
        res.status(409).json({ error: 'Kein Haushalt verknuepft. Bitte in Nestbau neu verbinden.' });
        return;
      }

      const ref = await createImportDoc(householdId, session.uid, clip, 'clipper');
      res.status(202).json({
        ok: true,
        importId: ref.id,
        householdId,
        title: clip.title || null,
        message: 'Rezept wird verarbeitet – in Nestbau unter "Importe" pruefen.'
      });
    } catch (error) {
      logger.error('clipRecipe fehlgeschlagen', { message: error.message });
      res.status(500).json({ error: 'Import konnte nicht angelegt werden.' });
    }
  }
);

/** Firestore-Trigger: parst jeden neu angelegten Import. */
const processRecipeImport = onDocumentCreated(
  {
    region: REGION,
    document: 'households/{householdId}/recipeImports/{importId}',
    secrets: [ANTHROPIC_API_KEY],
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 10
  },
  async (event) => {
    const { householdId, importId } = event.params;
    await runImport(householdId, importId);
  }
);

/** Import aus der App heraus (URL einfuegen statt Extension). */
const importRecipeFromUrl = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const { uid } = requireVerifiedAuth(request);
    const householdId = await resolveHousehold(uid, request.data && request.data.householdId);
    const url = assertString(request.data && request.data.url, 'url', { min: 8, max: 800 });

    let target;
    try {
      target = new URL(url);
      if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('bad protocol');
    } catch {
      throw new HttpsError('invalid-argument', 'Bitte eine gueltige http(s)-Adresse angeben.');
    }

    let html = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(target.toString(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'NestbauRecipeImporter/1.0', Accept: 'text/html' }
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = (await response.text()).slice(0, MAX_BODY_CHARS);
    } catch (error) {
      throw new HttpsError('unavailable', `Seite konnte nicht geladen werden (${error.message}).`);
    }

    const jsonLd = [];
    const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRe.exec(html)) !== null && jsonLd.length < 8) jsonLd.push(match[1]);

    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    const docTitle = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);

    const clip = sanitizeClip({
      sourceType: 'web',
      url: target.toString(),
      siteName: ogSite ? ogSite[1] : target.hostname,
      title: (ogTitle && ogTitle[1]) || (docTitle && docTitle[1]) || '',
      text: require('./recipeParser').htmlToText(html).slice(0, MAX_RAW_TEXT),
      jsonLd,
      imageUrl: ogImage ? ogImage[1] : null
    });

    const ref = await createImportDoc(householdId, uid, clip, 'app');
    // Direkt verarbeiten, damit der Nutzer nicht auf den Trigger warten muss.
    await runImport(householdId, ref.id);
    return { importId: ref.id, householdId };
  }
);

/** Erneut verarbeiten (z.B. nachdem neue Zutaten angelegt wurden). */
const retryRecipeImport = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const { uid } = requireVerifiedAuth(request);
    const householdId = await resolveHousehold(uid, request.data && request.data.householdId);
    const importId = assertString(request.data && request.data.importId, 'importId', { min: 6, max: 60 });
    await runImport(householdId, importId);
    return { ok: true };
  }
);

// ------------------------------------------------------------ Uebernehmen

const CATEGORY_IDS = ['breakfast', 'main', 'snack', 'dessert', 'drink'];

function sanitizeRecipeInput(input) {
  const list = (value, max, maxLen) => (Array.isArray(value) ? value : [])
    .map((entry) => String(entry == null ? '' : entry).trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, maxLen))
    .slice(0, max);

  const number = (value, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null;
  };

  const title = String((input && input.title) || '').trim();
  if (!title) throw new HttpsError('invalid-argument', 'Das Rezept braucht einen Titel.');

  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .slice(0, 60)
    .map((item) => {
      const name = String((item && item.name) || '').trim().slice(0, 80);
      if (!name) return null;
      return {
        ingredientId: item.ingredientId ? String(item.ingredientId).slice(0, 60) : null,
        name,
        amount: number(item.amount, 0, 100000),
        unit: item.unit ? String(item.unit).slice(0, 16) : null,
        note: item.note ? String(item.note).slice(0, 120) : null
      };
    })
    .filter(Boolean);

  return {
    title: title.slice(0, 120),
    description: String((input && input.description) || '').trim().slice(0, 400),
    servings: number(input.servings, 1, 50),
    timeMinutes: number(input.timeMinutes, 1, 6000),
    totalWeightG: number(input.totalWeightG, 1, 50000),
    categories: (Array.isArray(input.categories) ? input.categories : [])
      .filter((id) => CATEGORY_IDS.includes(id) || /^custom_[a-z0-9_-]{1,30}$/i.test(String(id)))
      .slice(0, 3),
    ingredients,
    prep: list(input.prep, 40, 600),
    steps: list(input.steps, 40, 600),
    utensils: list(input.utensils, 12, 60),
    notes: String((input && input.notes) || '').trim().slice(0, 1000),
    favorite: Boolean(input.favorite)
  };
}

/**
 * Uebernimmt einen bearbeiteten Import als echtes Rezept.
 * Laeuft serverseitig, weil dabei drei Dinge zusammen passieren muessen:
 * fehlende Zutaten anlegen, Bild an den Rezept-Pfad kopieren, Import schliessen.
 */
const commitRecipeImport = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const { uid } = requireVerifiedAuth(request);
    const data = request.data || {};
    const householdId = await resolveHousehold(uid, data.householdId);
    const importId = assertString(data.importId, 'importId', { min: 6, max: 60 });
    const recipe = sanitizeRecipeInput(data.recipe || {});

    const householdRef = db.collection('households').doc(householdId);
    const importRef = householdRef.collection('recipeImports').doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) throw new HttpsError('not-found', 'Import nicht gefunden.');
    if (importSnap.data().status === 'committed') {
      throw new HttpsError('failed-precondition', 'Dieser Import wurde bereits uebernommen.');
    }

    // Neue Zutaten anlegen, die der Nutzer im Editor bestaetigt hat.
    const newIngredients = (Array.isArray(data.createIngredients) ? data.createIngredients : []).slice(0, 30);
    const createdIds = new Map();
    if (newIngredients.length) {
      const batch = db.batch();
      for (const item of newIngredients) {
        const name = String((item && item.name) || '').trim().slice(0, 80);
        if (!name) continue;
        const ref = householdRef.collection('ingredients').doc();
        batch.set(ref, {
          name,
          categories: Array.isArray(item.categories) ? item.categories.slice(0, 5) : [],
          nutrition: {
            basisG: 100,
            kcal: Number(item.kcal) || 0,
            protein: Number(item.protein) || 0,
            fat: Number(item.fat) || 0,
            carbs: Number(item.carbs) || 0
          },
          allergens: Array.isArray(item.allergens) ? item.allergens.slice(0, 10) : [],
          createdBy: uid,
          createdAt: FieldValue.serverTimestamp(),
          source: 'recipe-import'
        });
        createdIds.set(String(item.key != null ? item.key : name), ref.id);
      }
      await batch.commit();
    }

    // Platzhalter-IDs der neu angelegten Zutaten aufloesen.
    recipe.ingredients = recipe.ingredients.map((item) => {
      if (item.ingredientId && item.ingredientId.startsWith('new:')) {
        const resolved = createdIds.get(item.ingredientId.slice(4));
        return { ...item, ingredientId: resolved || null };
      }
      return item;
    });

    // Bild an den endgueltigen Rezept-Pfad kopieren.
    const importData = importSnap.data();
    const recipeRef = householdRef.collection('recipes').doc();
    let image = null;
    if (importData.image && importData.image.path) {
      const extension = importData.image.path.split('.').pop();
      try {
        image = await copyImage(
          importData.image.path,
          `households/${householdId}/recipes/${recipeRef.id}/photo.${extension}`
        );
      } catch (error) {
        logger.warn('Bild-Uebernahme fehlgeschlagen', { householdId, importId, message: error.message });
      }
    }

    await recipeRef.set({
      ...recipe,
      image,
      photoUrl: image ? image.url : null,
      importedFrom: {
        importId,
        type: importData.source ? importData.source.type : null,
        url: importData.source ? importData.source.url : null,
        siteName: importData.source ? importData.source.siteName : null,
        author: importData.source ? importData.source.author : null,
        parserEngine: importData.parser ? importData.parser.engine : null
      },
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    await importRef.update({
      status: 'committed',
      recipeId: recipeRef.id,
      committedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    return { recipeId: recipeRef.id, createdIngredientIds: [...createdIds.values()] };
  }
);

/** Import verwerfen (inkl. hochgeladenem Bild). */
const deleteRecipeImport = onCall(
  { region: REGION, memory: '256MiB' },
  async (request) => {
    const { uid } = requireVerifiedAuth(request);
    const data = request.data || {};
    const householdId = await resolveHousehold(uid, data.householdId);
    const importId = assertString(data.importId, 'importId', { min: 6, max: 60 });

    const ref = db.collection('households').doc(householdId).collection('recipeImports').doc(importId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: true };

    const image = snap.data().image;
    if (image && image.path) await deleteImage(image.path).catch(() => {});
    await ref.delete();
    return { ok: true };
  }
);

// ------------------------------------------------------- Geraete-Verwaltung

const createClipperToken = onCall(
  { region: REGION, memory: '256MiB' },
  async (request) => {
    const { uid } = requireVerifiedAuth(request);
    const data = request.data || {};
    const householdId = await resolveHousehold(uid, data.householdId);
    await assertMembership(uid, householdId);

    const result = await clipperTokens.createToken({
      uid,
      householdId,
      label: data.label || 'Browser',
      userAgent: request.rawRequest ? request.rawRequest.get('user-agent') : ''
    });

    return {
      token: result.token,          // einmalig – danach nur noch der Hash
      tokenId: result.tokenId,
      householdId
    };
  }
);

const listClipperDevices = onCall(
  { region: REGION, memory: '256MiB' },
  async (request) => {
    const { uid } = requireVerifiedAuth(request);
    return { devices: await clipperTokens.listTokens(uid) };
  }
);

const revokeClipperDevice = onCall(
  { region: REGION, memory: '256MiB' },
  async (request) => {
    const { uid } = requireVerifiedAuth(request);
    const tokenId = assertString(request.data && request.data.tokenId, 'tokenId', { min: 16, max: 100 });
    await clipperTokens.revokeToken(uid, tokenId);
    return { ok: true };
  }
);

module.exports = {
  clipRecipe,
  processRecipeImport,
  importRecipeFromUrl,
  retryRecipeImport,
  commitRecipeImport,
  deleteRecipeImport,
  createClipperToken,
  listClipperDevices,
  revokeClipperDevice,
  // fuer Tests
  _internal: { sanitizeClip, sanitizeRecipeInput, runImport }
};
