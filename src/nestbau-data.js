/**
 * Nestbau v2.0 - Datenzugriffsschicht.
 *
 * Kapselt alle Firestore-Pfade an einer Stelle, damit die UI nichts von der
 * Struktur wissen muss. Alle Funktionen sind haushalts-scoped.
 *
 * Grundmuster fuer die App: einmal subscribeHousehold() aufrufen, den lokalen
 * `state` aus den Snapshots fuellen und danach wie bisher rendern. Schreibende
 * Aktionen gehen direkt an Firestore - der Offline-Cache bestaetigt sofort,
 * der Server zieht nach, sobald wieder Verbindung besteht.
 */

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';

import { db, storage, auth } from './firebase-config.js';

const hh = (hid, ...rest) => ['households', hid, ...rest];
const col = (hid, name) => collection(db, ...hh(hid, name));
const uidNow = () => (auth.currentUser ? auth.currentUser.uid : null);
const stamp = () => ({ updatedAt: serverTimestamp() });

// ---------- Lesen: ein Abo pro Kollektion ----------

/**
 * Haengt Listener an alle Haushaltsdaten. Gibt eine unsubscribe-Funktion zurueck.
 * onChange(bereich, daten) wird bei jeder Aenderung aufgerufen.
 */
export function subscribeHousehold(hid, onChange, onError = console.error) {
  const subs = [];
  const simple = (name, mapper = (d) => ({ id: d.id, ...d.data() })) =>
    subs.push(onSnapshot(col(hid, name),
      (snap) => onChange(name, snap.docs.map(mapper)), onError));

  subs.push(onSnapshot(doc(db, ...hh(hid)),
    (snap) => onChange('household', snap.exists() ? { id: snap.id, ...snap.data() } : null), onError));

  simple('members');
  simple('events');
  simple('subscriptions');
  simple('ingredients');
  simple('ingredientCategories');
  simple('ingredientGroups');
  simple('dishCategories');
  simple('recipes');

  // Listen inkl. Positionen: pro Liste ein eigener Listener auf items.
  const itemSubs = new Map();
  subs.push(onSnapshot(query(col(hid, 'lists'), orderBy('order')), (snap) => {
    const lists = snap.docs.map((d) => ({ id: d.id, ...d.data(), items: [] }));
    onChange('lists', lists);
    lists.forEach((l) => {
      if (itemSubs.has(l.id)) return;
      itemSubs.set(l.id, onSnapshot(collection(db, ...hh(hid, 'lists', l.id, 'items')),
        (isnap) => onChange('listItems',
          { listId: l.id, items: isnap.docs.map((d) => ({ id: d.id, ...d.data() })) }), onError));
    });
    [...itemSubs.keys()].filter((id) => !lists.some((l) => l.id === id)).forEach((id) => {
      itemSubs.get(id)();
      itemSubs.delete(id);
    });
  }, onError));

  return () => {
    subs.forEach((u) => u());
    itemSubs.forEach((u) => u());
    itemSubs.clear();
  };
}

/**
 * Menueplan nur fuer den sichtbaren Zeitraum abonnieren - ein voller Jahresplan
 * sind 365 Dokumente, die niemand gleichzeitig sieht.
 */
export function subscribeMenuPlan(hid, fromKey, toKey, onChange, onError = console.error) {
  const q = query(col(hid, 'menuPlan'),
    where('date', '>=', fromKey), where('date', '<=', toKey), orderBy('date'));
  return onSnapshot(q, (snap) => {
    const plan = {};
    snap.docs.forEach((d) => { plan[d.id] = d.data().slots || {}; });
    onChange(plan);
  }, onError);
}

/** Rezepte einer Kategorie, aelteste Zubereitung zuerst ("Lange nicht mehr gekocht"). */
export async function recipesLongNotCooked(hid, category, max = 20) {
  const clauses = [orderBy('lastCookedAt', 'asc'), limit(max)];
  const q = category
    ? query(col(hid, 'recipes'), where('categories', 'array-contains', category), ...clauses)
    : query(col(hid, 'recipes'), ...clauses);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Schreiben ----------

export const lists = {
  create: (hid, data) => addDoc(col(hid, 'lists'), {
    name: data.name, kind: data.kind || 'todo', order: data.order ?? 99,
    system: false, createdBy: uidNow(), createdAt: serverTimestamp(),
  }),
  remove: (hid, listId) => deleteDoc(doc(db, ...hh(hid, 'lists', listId))),
};

export const items = {
  add: (hid, listId, data) => addDoc(collection(db, ...hh(hid, 'lists', listId, 'items')), {
    title: data.title,
    assignee: data.assignee || 'both',
    done: false,
    date: data.date || null,
    time: data.time || null,
    category: data.category || null,
    recur: data.recur || null,
    reminder: data.reminder || null,
    linkedEventId: data.linkedEventId || null,
    sourceIngredientId: data.sourceIngredientId || null,
    grams: data.grams ?? null,
    shoppingGroup: data.shoppingGroup || null,
    createdBy: uidNow(),
    createdAt: serverTimestamp(),
  }),
  toggle: (hid, listId, itemId, done) =>
    updateDoc(doc(db, ...hh(hid, 'lists', listId, 'items', itemId)),
      { done, doneAt: done ? serverTimestamp() : null }),
  update: (hid, listId, itemId, patch) =>
    updateDoc(doc(db, ...hh(hid, 'lists', listId, 'items', itemId)), patch),
  remove: (hid, listId, itemId) =>
    deleteDoc(doc(db, ...hh(hid, 'lists', listId, 'items', itemId))),
};

/**
 * Einkaufsliste aus dem Menueplan: alle Positionen in einem Batch,
 * damit die Liste nicht haeppchenweise in der UI auftaucht.
 */
export async function addShoppingItems(hid, listId, entries) {
  const batch = writeBatch(db);
  entries.forEach((e) => {
    const ref = doc(collection(db, ...hh(hid, 'lists', listId, 'items')));
    batch.set(ref, {
      title: e.title, assignee: 'both', done: false, date: null, time: null,
      sourceIngredientId: e.ingredientId || null, grams: e.grams ?? null,
      shoppingGroup: e.shoppingGroup || 'nonfood',
      createdBy: uidNow(), createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

const crud = (name, prepare) => ({
  add: (hid, data) => addDoc(col(hid, name), {
    ...prepare(data), createdBy: uidNow(), createdAt: serverTimestamp(), ...stamp(),
  }),
  set: (hid, id, data) => setDoc(doc(db, ...hh(hid, name, id)),
    { ...prepare(data), ...stamp() }, { merge: true }),
  update: (hid, id, patch) => updateDoc(doc(db, ...hh(hid, name, id)), { ...patch, ...stamp() }),
  remove: (hid, id) => deleteDoc(doc(db, ...hh(hid, name, id))),
  get: async (hid, id) => {
    const s = await getDoc(doc(db, ...hh(hid, name, id)));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  },
});

export const events = crud('events', (d) => d);
export const subscriptions = crud('subscriptions', (d) => d);
export const ingredientCategories = crud('ingredientCategories', (d) => d);
export const ingredientGroups = crud('ingredientGroups', (d) => d);
export const dishCategories = crud('dishCategories', (d) => d);

export const ingredients = crud('ingredients', (d) => ({
  ...d, nameLower: String(d.name || '').toLowerCase(),
}));

export const recipes = {
  ...crud('recipes', (d) => ({ ...d, titleLower: String(d.title || '').toLowerCase() })),
  /** Nach dem Kochen: treibt den Filter "Lange nicht mehr gekocht". */
  markCooked: (hid, recipeId) => updateDoc(doc(db, ...hh(hid, 'recipes', recipeId)), {
    lastCookedAt: serverTimestamp(),
    cookedCount: increment(1),
  }),
};

export const menuPlan = {
  /** Ganzen Tag setzen. dayKey = YYYY-MM-DD, slots = {fruehstueck:[],...}. */
  setDay: (hid, dayKey, slots) => setDoc(doc(db, ...hh(hid, 'menuPlan', dayKey)),
    { date: dayKey, slots, updatedBy: uidNow(), updatedAt: serverTimestamp() }, { merge: true }),
  setSlot: (hid, dayKey, slotId, entries) => setDoc(doc(db, ...hh(hid, 'menuPlan', dayKey)),
    { date: dayKey, slots: { [slotId]: entries }, updatedBy: uidNow(), updatedAt: serverTimestamp() },
    { merge: true }),
  clearDay: (hid, dayKey) => deleteDoc(doc(db, ...hh(hid, 'menuPlan', dayKey))),
};

// ---------- Bilder ----------

/**
 * Bild komprimieren und hochladen. Gibt {path, url} zurueck.
 * In Firestore wird nur `path` gespeichert - Base64 gehoert nicht in ein Dokument.
 */
export async function uploadImage(file, { hid, kind, docId }, maxEdge = 1280, quality = 0.72) {
  const blob = await compress(file, maxEdge, quality);
  const path = hid
    ? `households/${hid}/${kind}/${docId}/${Date.now()}.jpg`
    : `users/${uidNow()}/avatar/${Date.now()}.jpg`;
  const r = storageRef(storage, path);
  await uploadBytes(r, blob, { contentType: 'image/jpeg' });
  return { path, url: await getDownloadURL(r) };
}

export const imageUrl = (path) => (path ? getDownloadURL(storageRef(storage, path)) : null);
export const removeImage = (path) => deleteObject(storageRef(storage, path));

function compress(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Bildformat wird nicht unterstuetzt.'));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Komprimierung fehlgeschlagen.'))),
          'image/jpeg', quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
