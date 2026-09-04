#!/usr/bin/env node
'use strict';

/**
 * Nestbau v2.0 - Migration localStorage -> Firebase
 *
 * Quelle: eine "nestbau-sicherung-JJJJ-MM-TT.json" (Zahnrad > Daten > Sicherung speichern)
 *         oder der rohe Inhalt von localStorage["nestbau-state-v1"].
 *
 * Beispiel:
 *   node migrate.js --file ./backups/nestbau-sicherung-2026-09-03.json \
 *                   --uid  abc123UID \
 *                   --create-household "Haushalt Zürich" \
 *                   --dry-run
 *
 * Danach ohne --dry-run erneut ausfuehren. Der Lauf ist idempotent: alle Dokument-IDs
 * stammen aus der Sicherung, wiederholte Laeufe ueberschreiben dieselben Dokumente.
 *
 * Voraussetzungen:
 *   npm install
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json   (Service-Account-Schluessel)
 *   oder --emulator, dann laeuft alles gegen die lokalen Emulatoren.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

// ---------------------------------------------------------------- Argumente

function parseArgs(argv) {
  const args = { photos: true };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--file': args.file = next(); break;
      case '--uid': args.uid = next(); break;
      case '--household': args.householdId = next(); break;
      case '--create-household': args.createHousehold = next(); break;
      case '--partner-uid': args.partnerUid = next(); break;
      case '--project': args.projectId = next(); break;
      case '--bucket': args.bucket = next(); break;
      case '--dry-run': args.dryRun = true; break;
      case '--skip-photos': args.photos = false; break;
      case '--force': args.force = true; break;
      case '--emulator': args.emulator = true; break;
      case '--help': args.help = true; break;
      default: throw new Error(`Unbekannte Option: ${a}`);
    }
  }
  return args;
}

const HELP = `
Nestbau Migration

  --file <pfad>              Sicherungsdatei (Pflicht)
  --uid <uid>                Firebase-UID des Besitzers (Pflicht) - wird zu "Ich" (people.a)
  --create-household <name>  neuen Haushalt anlegen
  --household <id>           in bestehenden Haushalt importieren
  --partner-uid <uid>        UID der zweiten Person (people.b), optional
  --project <id>             Projekt-ID (sonst aus dem Service Account)
  --bucket <name>            Storage-Bucket (Standard: <projectId>.firebasestorage.app)
  --dry-run                  nichts schreiben, nur Bericht erzeugen
  --skip-photos              Fotos nicht hochladen (schneller Testlauf)
  --force                    erneut importieren, obwohl diese Datei schon gelaufen ist
  --emulator                 gegen die lokalen Emulatoren arbeiten
`;

// ---------------------------------------------------------------- Helfer

const log = (...a) => console.log('[migration]', ...a);
const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn('  ! ' + msg); };

const DATA_URL_RE = /^data:(image\/[a-zA-Z+]+);base64,([\s\S]+)$/;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MENU_SLOTS = ['fruehstueck', 'mittagessen', 'abendessen', 'snacks'];
const VALID_FREQ = ['monthly', 'quarterly', 'halfyearly', 'yearly'];
const FREQ_MAP = { monthly: 'monthly', quarterly: 'quarterly', halfyearly: 'halfyearly', yearly: 'yearly' };

/** Firestore erlaubt max. 500 Operationen pro Batch - hier bewusst darunter. */
class BatchWriter {
  constructor(db, dryRun, limit = 400) {
    this.db = db; this.dryRun = dryRun; this.limit = limit;
    this.batch = dryRun ? null : db.batch();
    this.pending = 0; this.total = 0;
  }
  set(ref, data, options = { merge: true }) {
    this.total += 1;
    if (this.dryRun) return;
    this.batch.set(ref, data, options);
    this.pending += 1;
    if (this.pending >= this.limit) return this.flush();
    return null;
  }
  async flush() {
    if (this.dryRun || !this.pending) return;
    await this.batch.commit();
    this.batch = this.db.batch();
    this.pending = 0;
  }
}

function sanitizeId(raw, fallbackPrefix, index) {
  const s = String(raw == null ? '' : raw).trim();
  // Firestore-IDs duerfen keine Slashes enthalten und nicht "." / ".." sein.
  if (!s || s === '.' || s === '..' || s.includes('/') || s.length > 1500) {
    return `${fallbackPrefix}-${index}`;
  }
  return s;
}

const num = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const str = (v, def = '') => (typeof v === 'string' ? v : def);
const arr = (v) => (Array.isArray(v) ? v : []);
const lower = (v) => String(v || '').toLowerCase();

// ---------------------------------------------------------------- Fotos

/**
 * Base64-Bilder aus der Sicherung nach Cloud Storage schieben.
 * Grund: ein Firestore-Dokument darf 1 MiB gross sein, ein einziges Rezeptfoto
 * als Data-URL sprengt das schnell - und jede Query wuerde die Bytes mitschleppen.
 */
async function uploadDataUrl(bucket, dataUrl, destPath, dryRun) {
  const match = DATA_URL_RE.exec(String(dataUrl || ''));
  if (!match) return null;
  const [, contentType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 8 * 1024 * 1024) {
    warn(`Bild zu gross (${Math.round(buffer.length / 1024)} KB), uebersprungen: ${destPath}`);
    return null;
  }
  if (dryRun) return destPath;
  await bucket.file(destPath).save(buffer, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=604800', metadata: { source: 'migration-v2' } },
  });
  return destPath;
}

// ---------------------------------------------------------------- Migration

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.file || !args.uid) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }
  if (!args.householdId && !args.createHousehold) {
    console.error('Entweder --household <id> oder --create-household "<name>" angeben.');
    process.exit(1);
  }

  if (args.emulator) {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST =
      process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
    process.env.FIREBASE_AUTH_EMULATOR_HOST =
      process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    log('Emulator-Modus');
  }

  const raw = fs.readFileSync(path.resolve(args.file), 'utf8');
  const sourceHash = crypto.createHash('sha256').update(raw).digest('hex');
  let state;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    console.error('Die Datei ist kein gueltiges JSON:', err.message);
    process.exit(1);
  }
  if (!state || typeof state !== 'object' || !state.people || !state.lists) {
    console.error('Darin stecken keine Nestbau-Daten (people/lists fehlen).');
    process.exit(1);
  }

  admin.initializeApp({
    projectId: args.projectId || process.env.GOOGLE_CLOUD_PROJECT,
    storageBucket: args.bucket
      || `${args.projectId || process.env.GOOGLE_CLOUD_PROJECT || 'nestbau-app'}.firebasestorage.app`,
  });
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  const bucket = args.photos ? admin.storage().bucket() : null;
  const FieldValue = admin.firestore.FieldValue;
  const startedAt = new Date();

  // Doppelimport-Schutz
  const runId = `${args.uid}_${sourceHash.slice(0, 12)}`;
  const previous = await db.doc(`migrationRuns/${runId}`).get();
  if (previous.exists && !previous.get('dryRun') && !args.force && !args.dryRun) {
    console.error(`Diese Sicherung wurde bereits importiert (${previous.get('finishedAt') && previous.get('finishedAt').toDate().toISOString()}).`);
    console.error('Mit --force erneut ausfuehren (ueberschreibt dieselben Dokumente).');
    process.exit(1);
  }

  // ---- Haushalt bestimmen ----
  let hid = args.householdId;
  if (!hid) {
    const ref = db.collection('households').doc();
    hid = ref.id;
    if (!args.dryRun) {
      const roles = { [args.uid]: 'admin' };
      const memberUids = [args.uid];
      if (args.partnerUid) { roles[args.partnerUid] = 'member'; memberUids.push(args.partnerUid); }
      await ref.set({
        name: args.createHousehold,
        description: 'Aus der lokalen Nestbau-App uebernommen',
        photoPath: null,
        createdBy: args.uid,
        memberUids,
        roles,
        settings: { currency: 'CHF', locale: 'de-CH', weekStart: 1, timezone: 'Europe/Zurich' },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    log(`Haushalt: ${hid} (neu${args.dryRun ? ', dry-run' : ''})`);
  } else {
    const snap = await db.doc(`households/${hid}`).get();
    if (!snap.exists) { console.error(`Haushalt ${hid} existiert nicht.`); process.exit(1); }
    log(`Haushalt: ${hid} (bestehend, "${snap.get('name')}")`);
  }

  // ---- Personen a/b -> UIDs ----
  const people = state.people || {};
  const uidFor = {
    a: args.uid,
    b: args.partnerUid || null,
    both: 'both',
  };
  const mapAssignee = (value) => {
    const v = str(value, 'both');
    if (v === 'both') return 'both';
    if (uidFor[v]) return uidFor[v];
    if (v === 'b' && !args.partnerUid) {
      // Ohne Partner-UID bleibt der Eintrag der zweiten Person zugeordnet,
      // aber ohne Konto - die App zeigt ihn dann als "Partnerin" an.
      return 'pending:b';
    }
    return 'both';
  };
  if (!args.partnerUid) {
    warn('Keine --partner-uid angegeben: Eintraege von "' +
      (people.b && people.b.name || 'Partnerin') +
      '" bekommen assignee "pending:b" und werden beim Beitritt der zweiten Person umgeschrieben.');
  }

  const writer = new BatchWriter(db, args.dryRun);
  const counts = {};
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
  const hhDoc = (...segs) => db.doc([`households/${hid}`, ...segs].join('/'));
  const hhCol = (name) => db.collection(`households/${hid}/${name}`);
  let photosUploaded = 0;

  // ---- Mitglieder ----
  ['a', 'b'].forEach((key) => {
    const person = people[key];
    const memberUid = uidFor[key];
    if (!person || !memberUid) return;
    writer.set(hhDoc('members', memberUid), {
      uid: memberUid,
      displayName: str(person.name, key === 'a' ? 'Ich' : 'Partnerin'),
      color: str(person.color, key === 'a' ? 'flame' : 'teal'),
      photoPath: null,
      role: key === 'a' ? 'admin' : 'member',
      legacyKey: key,
      sharedAllergyIds: [],
      joinedAt: FieldValue.serverTimestamp(),
    });
    bump('members');
  });

  // ---- Listen und Positionen ----
  arr(state.lists).forEach((list, li) => {
    const listId = sanitizeId(list.id, 'liste', li);
    const isSystem = ['l-aufgaben', 'l-einkaufen', 'l-geschenke', 'l-haushalt', 'l-arbeit']
      .includes(listId);
    writer.set(hhDoc('lists', listId), {
      name: str(list.name, 'Liste'),
      kind: list.kind === 'shopping' ? 'shopping' : 'todo',
      order: li,
      system: isSystem,
      createdBy: args.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    bump('lists');

    arr(list.items).forEach((item, ii) => {
      const itemId = sanitizeId(item.id, `${listId}-item`, ii);
      writer.set(hhDoc('lists', listId, 'items', itemId), {
        title: str(item.title, '(ohne Titel)').slice(0, 300),
        assignee: mapAssignee(item.assignee),
        done: item.done === true,
        doneAt: null,
        date: DAY_KEY_RE.test(str(item.date)) ? item.date : null,
        time: str(item.time) || null,
        category: str(item.category) || null,
        recur: str(item.recur) || null,
        reminder: item.reminder != null ? String(item.reminder) : null,
        linkedEventId: str(item.linkedEventId) || null,
        sourceIngredientId: str(item.sourceIngredientId) || null,
        grams: item.grams != null ? num(item.grams) : null,
        shoppingGroup: str(item.shoppingGroup) || null,
        createdBy: args.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      bump('listItems');
    });
  });

  // ---- Termine ----
  arr(state.events).forEach((ev, i) => {
    const id = sanitizeId(ev.id, 'termin', i);
    if (!DAY_KEY_RE.test(str(ev.date))) {
      warn(`Termin "${str(ev.title, id)}" ohne gueltiges Datum - uebersprungen.`);
      return;
    }
    writer.set(hhDoc('events', id), {
      title: str(ev.title, '(ohne Titel)').slice(0, 300),
      date: ev.date,
      allday: ev.allday === true,
      start: str(ev.start) || null,
      end: str(ev.end) || null,
      location: str(ev.location),
      desc: str(ev.desc),
      category: str(ev.category, 'privat'),
      assignee: mapAssignee(ev.assignee),
      reminder: ev.reminder != null ? String(ev.reminder) : null,
      recur: str(ev.recur) || null,
      createdBy: args.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    bump('events');
  });

  // ---- Abos ----
  arr(state.subscriptions).forEach((sub, i) => {
    const id = sanitizeId(sub.id, 'abo', i);
    const freq = FREQ_MAP[str(sub.frequency)] || 'monthly';
    if (!VALID_FREQ.includes(freq)) warn(`Abo "${str(sub.name, id)}": Intervall unbekannt, auf monatlich gesetzt.`);
    writer.set(hhDoc('subscriptions', id), {
      name: str(sub.name, 'Abo'),
      amount: num(sub.amount),
      currency: 'CHF',
      frequency: freq,
      billingDay: Math.min(31, Math.max(1, num(sub.billingDay, 1))),
      billingMonth: Math.min(11, Math.max(0, num(sub.billingMonth, 0))),
      category: str(sub.category, 'abo'),
      assignee: mapAssignee(sub.assignee),
      createdAt: FieldValue.serverTimestamp(),
    });
    bump('subscriptions');
  });

  // ---- Zutatenkategorien (inkl. Kategoriebilder) ----
  const categoryIds = new Set();
  for (const [i, cat] of arr(state.ingredientCategories).entries()) {
    const id = sanitizeId(cat.id, 'kategorie', i);
    categoryIds.add(id);
    const imagePaths = [];
    if (args.photos) {
      for (const [j, image] of arr(cat.images).entries()) {
        const dest = `households/${hid}/ingredientCategories/${id}/img-${j}.jpg`;
        const stored = await uploadDataUrl(bucket, image, dest, args.dryRun);
        if (stored) { imagePaths.push(stored); photosUploaded += 1; }
      }
    }
    writer.set(hhDoc('ingredientCategories', id), {
      name: str(cat.label || cat.name, 'Kategorie'),
      custom: cat.custom === true,
      emoji: str(cat.emoji, cat.custom ? '🏷️' : '🧺'),
      shoppingGroup: str(cat.shoppingGroup, 'nonfood'),
      imagePaths,
      order: i,
      createdAt: FieldValue.serverTimestamp(),
    });
    bump('ingredientCategories');
  }

  arr(state.ingredientGroups).forEach((group, i) => {
    const id = sanitizeId(group.id, 'gruppe', i);
    writer.set(hhDoc('ingredientGroups', id), {
      name: str(group.label || group.name, 'Gruppe'),
      categoryIds: arr(group.categoryIds).map(String),
      order: i,
      createdAt: FieldValue.serverTimestamp(),
    });
    bump('ingredientGroups');
  });

  arr(state.customDishCategories).forEach((cat, i) => {
    const id = sanitizeId(cat.id, 'gericht-kategorie', i);
    writer.set(hhDoc('dishCategories', id), {
      name: str(cat.label || cat.name, 'Kategorie'),
      tok: str(cat.tok, 'teal'),
      emoji: str(cat.emoji, '🏷️'),
      createdAt: FieldValue.serverTimestamp(),
    });
    bump('dishCategories');
  });

  // ---- Zutaten ----
  const ingredientAllergens = new Map();
  const ingredientIds = new Set();
  for (const [i, ing] of arr(state.ingredients).entries()) {
    const id = sanitizeId(ing.id, 'zutat', i);
    ingredientIds.add(id);
    const allergyIds = arr(ing.allergyIds).map(String);
    ingredientAllergens.set(id, allergyIds);

    arr(ing.categoryIds).forEach((c) => {
      if (!categoryIds.has(String(c))) warn(`Zutat "${str(ing.name, id)}" verweist auf unbekannte Kategorie "${c}".`);
    });

    let photoPath = null;
    if (args.photos && ing.photo) {
      photoPath = await uploadDataUrl(bucket, ing.photo,
        `households/${hid}/ingredients/${id}/main.jpg`, args.dryRun);
      if (photoPath) photosUploaded += 1;
    }

    writer.set(hhDoc('ingredients', id), {
      name: str(ing.name, 'Zutat'),
      nameLower: lower(ing.name),
      categoryIds: arr(ing.categoryIds).map(String),
      baseGrams: num(ing.baseGrams, 100),
      kcal: num(ing.kcal),
      protein: num(ing.protein),
      fat: num(ing.fat),
      carbs: num(ing.carbs),
      fiber: num(ing.fiber),
      iron: num(ing.iron),
      minerals: str(ing.minerals),
      vitamins: arr(ing.vitamins).map((v) => ({
        name: str(v && v.name), amount: num(v && v.amount), unit: str(v && v.unit, 'mg'),
      })),
      aminoAcids: arr(ing.aminoAcids).map(String),
      allergyIds,
      description: str(ing.description),
      photoPath,
      createdAt: FieldValue.serverTimestamp(),
    });
    bump('ingredients');
  }

  // ---- Rezepte ----
  const recipeIds = new Set();
  for (const [i, r] of arr(state.recipes).entries()) {
    const id = sanitizeId(r.id, 'rezept', i);
    recipeIds.add(id);

    const ingredientRefs = arr(r.ingredients).map((ri) => ({
      ingredientId: str(ri && ri.ingredientId),
      amount: num(ri && ri.amount),
      unit: str(ri && ri.unit, 'g'),
    })).filter((ri) => ri.ingredientId);

    ingredientRefs.forEach((ri) => {
      if (!ingredientIds.has(ri.ingredientId)) {
        warn(`Rezept "${str(r.title, id)}" verweist auf geloeschte Zutat ${ri.ingredientId}.`);
      }
    });

    // Allergene gleich hier aggregieren, damit die Filter direkt nach der
    // Migration greifen - die Cloud Function rechnet sonst erst beim naechsten Schreiben.
    const allergyIds = [...new Set(ingredientRefs
      .flatMap((ri) => ingredientAllergens.get(ri.ingredientId) || []))].sort();

    let photoPath = null;
    if (args.photos && r.photo) {
      photoPath = await uploadDataUrl(bucket, r.photo,
        `households/${hid}/recipes/${id}/main.jpg`, args.dryRun);
      if (photoPath) photosUploaded += 1;
    }

    writer.set(hhDoc('recipes', id), {
      title: str(r.title, 'Rezept').slice(0, 200),
      titleLower: lower(r.title),
      desc: str(r.desc),
      categories: arr(r.categories).length ? arr(r.categories).map(String) : ['mittagabend'],
      time: r.time != null ? num(r.time) : null,
      portions: Math.max(1, num(r.portions, 2)),
      totalWeight: num(r.totalWeight),
      season: str(r.season) || null,
      notes: str(r.notes),
      utensils: arr(r.utensils).map(String),
      prep: arr(r.prep).map(String),
      steps: arr(r.steps).map(String),
      ingredients: ingredientRefs,
      favorite: r.favorite === true,
      photoPath,
      lastCookedAt: null,
      cookedCount: 0,
      allergyIds,
      createdBy: args.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    bump('recipes');
  }

  // ---- Menueplan ----
  Object.entries(state.menuPlan || {}).forEach(([dayKey, day]) => {
    if (!DAY_KEY_RE.test(dayKey)) { warn(`Menueplan-Schluessel "${dayKey}" ignoriert.`); return; }
    const slots = {};
    let entryCount = 0;
    MENU_SLOTS.forEach((slot) => {
      slots[slot] = arr(day && day[slot]).map((entry) => {
        // Alte Sicherungen speichern hier reine Rezept-ID-Strings.
        if (typeof entry === 'string') return { type: 'recipe', id: entry, qty: 1 };
        if (entry && entry.type === 'recipe') {
          if (!recipeIds.has(str(entry.id))) {
            warn(`Menueplan ${dayKey}/${slot}: Rezept ${entry.id} existiert nicht mehr.`);
          }
          return { type: 'recipe', id: str(entry.id), qty: num(entry.qty, 1) };
        }
        if (entry && entry.type === 'food') {
          return {
            type: 'food',
            ingredientId: str(entry.ingredientId) || null,
            freeName: str(entry.freeName) || null,
            amount: num(entry.amount),
            unit: str(entry.unit, 'g'),
          };
        }
        return null;
      }).filter(Boolean);
      entryCount += slots[slot].length;
    });
    if (!entryCount) return; // leere Tage nicht anlegen
    writer.set(hhDoc('menuPlan', dayKey), {
      date: dayKey,
      slots,
      updatedBy: args.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    bump('menuPlanDays');
  });

  // ---- Nutzer-Einstellungen ----
  if (state.activeListId) {
    writer.set(db.doc(`users/${args.uid}/private/settings`),
      { activeListId: str(state.activeListId, 'l-aufgaben') });
  }
  writer.set(db.doc(`users/${args.uid}`), {
    householdIds: FieldValue.arrayUnion(hid),
    defaultHouseholdId: hid,
  });

  await writer.flush();

  // ---- Bericht ----
  const finishedAt = new Date();
  const report = {
    runId,
    uid: args.uid,
    householdId: hid,
    sourceFile: path.basename(args.file),
    sourceHash,
    counts,
    photosUploaded,
    warnings,
    dryRun: !!args.dryRun,
    documentsWritten: writer.total,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
  };

  if (!args.dryRun) {
    await db.doc(`migrationRuns/${runId}`).set({
      ...report,
      startedAt: admin.firestore.Timestamp.fromDate(startedAt),
      finishedAt: admin.firestore.Timestamp.fromDate(finishedAt),
    });
  }

  const reportDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${runId}${args.dryRun ? '-dryrun' : ''}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  log('---------------------------------------------');
  log(args.dryRun ? 'PROBELAUF - es wurde nichts geschrieben' : 'Migration abgeschlossen');
  Object.entries(counts).forEach(([k, v]) => log(`  ${k}: ${v}`));
  log(`  Dokumente: ${writer.total}`);
  log(`  Fotos: ${photosUploaded}`);
  log(`  Hinweise: ${warnings.length}`);
  log(`  Bericht: ${reportPath}`);
  if (!args.dryRun) log(`  Haushalt: ${hid}`);
  log('---------------------------------------------');

  if (!args.dryRun && !args.partnerUid) {
    log('Naechster Schritt: die zweite Person einladen, danach');
    log(`  node reassign-partner.js --household ${hid} --partner-uid <neue-uid>`);
  }

  await admin.app().delete();
}

main().catch((err) => {
  console.error('\nMigration fehlgeschlagen:', err.message);
  console.error(err.stack);
  process.exit(1);
});
