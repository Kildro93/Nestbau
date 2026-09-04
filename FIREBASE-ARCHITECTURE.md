# Nestbau v2 – Firebase Architektur & Implementation

## 📋 Überblick

Die App synchronisiert zwischen **localStorage** (lokal, schnell) und **Firestore** (Cloud, geteilt). Ohne Firebase läuft alles lokal; mit Firebase laufen alle Änderungen in beiden Richtungen.

---

## 🏛️ Firestore-Datenmodell

### Collections im Haushalt

```
households/{hid}
├── name: string                      # Haushaltsname
├── ownerUid: string                  # Besitzer-UID
├── joinCode: string (4-8 Zeichen)   # Menschenlesbarer Beitrittscode
├── memberUids: array<string>         # Mitglieder (UIDs)
├── createdAt: timestamp
├── schemaVersion: number             # Für Migrations-Tracking
│
├── members/{uid}                     # Sub-Collection: Mitglieder-Metadaten
│   ├── uid: string
│   ├── email: string
│   ├── name: string
│   ├── role: "owner" | "member"
│   └── joinedAt: timestamp
│
├── ingredients/{id}                  # Zutatenliste
│   ├── name: string
│   ├── icon: string | null          # Emoji oder URL (nicht Base64!)
│   ├── unit: string                 # "g", "ml", "Stück", etc.
│   ├── category: string              # Referenz zur Kategorie
│   ├── archived: boolean
│   └── updatedAt: timestamp
│
├── ingredientCategories/{id}         # Zutaten-Kategorien
│   ├── name: string
│   ├── color: string
│   ├── order: number
│   └── updatedAt: timestamp
│
├── recipes/{id}                      # Rezepte
│   ├── name: string
│   ├── image: string                 # URL (Storage), nicht Base64!
│   ├── category: string              # Referenz zur Kategorie
│   ├── servings: number
│   ├── ingredients: array            # [ { ingredientId, quantity, unit, checked } ]
│   ├── instructions: string          # Markdown erlaubt
│   ├── tags: array<string>
│   ├── archived: boolean
│   ├── createdAt: timestamp
│   └── updatedAt: timestamp
│
├── dishCategories/{id}               # Rezept-Kategorien
│   ├── name: string
│   ├── color: string
│   ├── order: number
│   └── updatedAt: timestamp
│
├── menuPlan/{YYYY-MM-DD}             # Wochenplan pro Tag
│   ├── date: string                  # ISO-Format
│   ├── breakfast: { recipeId, notes }
│   ├── lunch: { recipeId, notes }
│   ├── dinner: { recipeId, notes }
│   ├── notes: string
│   └── updatedAt: timestamp
│
├── events/{id}                       # Veranstaltungen/Events
│   ├── title: string
│   ├── date: timestamp
│   ├── time: string                  # "14:30"
│   ├── description: string
│   ├── assignee: "a" | "b" | "both"
│   ├── completed: boolean
│   ├── source: "nestbau" | "google" | "outlook"
│   ├── externalId: string            # Google/Outlook Event ID
│   ├── archived: boolean
│   ├── createdAt: timestamp
│   └── updatedAt: timestamp
│
├── subscriptions/{id}                # Abos/Ausgaben
│   ├── name: string
│   ├── amount: number
│   ├── currency: "EUR" | "CHF" | etc.
│   ├── frequency: "monthly" | "yearly" | "quarterly"
│   ├── paidBy: "a" | "b"
│   ├── category: string
│   ├── active: boolean
│   ├── createdAt: timestamp
│   └── updatedAt: timestamp
│
└── meta/migration                    # Migration-Marker
    ├── migratedAt: timestamp         # Zeitstempel der ersten Migration
    ├── remoteVersion: number         # Version der Cloud-Daten
    └── lastSyncAt: timestamp
```

### Globale Collections

```
joinCodes/{CODE}                      # Beitrittscodes (nur gezielter Zugriff)
├── householdId: string               # Referenz zu Haushalt
└── ownerUid: string                  # Wer hat den Code erzeugt?
```

---

## 🔐 Security Rules

✅ Bereits implementiert in `firestore.rules` und `storage.rules`:

- **Haushalt:** Nur Mitglieder dürfen lesen/schreiben
- **Join-Codes:** Nur gezielter Zugriff mit exaktem Code (kein List)
- **Bilder:** Nur Mitglieder des Haushalts dürfen hochladen (<10 MB, nur Images)
- **Alles andere:** Standardmäßig verweigert

---

## 🔄 Synchronisations-Architektur

### Zustandsfluss

```
localStorage
     ↓
[NB.app.state]  ←→  [Firebase Real-time Listeners]
     ↓
Firestore
```

### Phasen beim Start

1. **App lädt:** `index.html` wird geladen, JavaScript initialisiert sich
2. **State aus localStorage:** `NB.store.get("nestbau-state-v1")`
3. **Firebase Init (optional):** Cloud-Modul lädt Firebase-SDK nur wenn konfiguriert
4. **Login-Prüfung:** Wenn Benutzer angemeldet → Haushalt auswählen
5. **Real-time Listener starten:** `subscribeHousehold()` für alle Collections
6. **Offline-Cache aktivieren:** Firestore speichert lokal mit `synchronizeTabs: true`

### Schreib-Fluss

```
User ändert Rezept
    ↓
[App aktualisiert state.recipes[id]]
    ↓
app.persist() wird aufgerufen
    ↓
localStorage wird sofort geschrieben
    ↓
Wenn Firebase aktiv:
  - Firestore.update() wird aufgerufen
  - Listener triggert bei Antwort → state wird nochmal aktualisiert
  - Tab-übergreifender Cache synchronisiert
```

### Lese-Fluss

```
Anderes Gerät ändert Rezept in Firebase
    ↓
Real-time Listener triggert
    ↓
Event: cloud:collection:updated emitted
    ↓
App aktualisiert state.recipes[id]
    ↓
app.render() wird aufgerufen
    ↓
UI zeigt neue Daten
```

---

## 📡 Datenfluss: localStorage ↔ Firebase

### Beim Start (ohne Migration)

1. **localStorage gelesen** → `state = {...}`
2. **Firebase-Listener aktiv?**
   - Ja: Real-time Listener für alle Collections
   - Nein: Alles bleibt lokal

### Beim Upload (Erste Migration)

1. **Benutzer klickt "Hochladen"**
2. **Sicherung erstellt:** JSON-Datei im Download-Ordner
3. **Bilder:** Nacheinander in Storage hochgeladen, URLs durch externe URLs ersetzt
4. **Dokumente:** In Stapeln zu 400 nach Firestore
5. **Gegenlesen:** Lokal vs. Cloud wird verglichen
6. **Live-Sync startet:** Ab jetzt synchonisieren Änderungen beide Richtungen

### Nach der Migration (Normal-Betrieb)

```
Desktop ändert Rezept
    ↓
state.recipes[id] aktualisiert
    ↓
Firestore.update(path, data)
    ↓
Firestore sendet Update
    ↓
Handy empfängt real-time Update
    ↓
Handy aktualisiert state + localStorage
    ↓
Handy zeigt neue Daten
```

### Wenn beide Geräte gleichzeitig ändern

- **Last-write-wins:** Wer später schreibt, gewinnt
- **No Merge Logic:** Firestore timestamp entscheidet
- **User wird informiert:** "Daten von anderem Gerät überschrieben"

---

## 🛠️ Implementation (Cloud Functions)

### Geplante Cloud Functions

```typescript
// 1. onHouseholdCreated – Indizes vorbereiten
exports.onHouseholdCreated = functions.firestore
  .document('households/{hid}')
  .onCreate(async (snap, context) => {
    // Logging, Cleanup, optional Email an Owner
  });

// 2. onIngredientChanged – Konsistenz-Checks
// (Sollte optional sein – bei Performance-Problemen)

// 3. recipeSearch – Volltextsuche via Algolia
// (Später, wenn Suche wichtig wird)
```

**Wichtig:** Ohne diese Functions läuft die App weiter! Sie sind Optional.

---

## 📊 Firestore Indexes

Diese Indexes sollten manuell angelegt werden (oder Firebase schlägt automatisch vor):

```yaml
# 1. Rezepte nach Kategorie und Update-Datum (sortiert)
indexes:
  - collectionId: recipes
    fields:
      - fieldPath: category
        order: ASCENDING
      - fieldPath: updatedAt
        order: DESCENDING

  # 2. Events nach Datum (für Kalender)
  - collectionId: events
    fields:
      - fieldPath: date
        order: ASCENDING
      - fieldPath: completed
        order: ASCENDING

  # 3. Subscriptions nach aktiv/inaktiv
  - collectionId: subscriptions
    fields:
      - fieldPath: active
        order: DESCENDING
      - fieldPath: createdAt
        order: DESCENDING
```

---

## 🔗 Integration mit index.html

### Bisheriges Modell

```javascript
NB.app.state = {
  lists: [...],
  recipes: [...],
  ingredients: [...],
  // ... alles in localStorage
}

NB.app.persist()  // Speichert in localStorage
NB.app.render()   // Zeigt UI
```

### Neues Modell (mit Firebase)

```javascript
// 1. State bleibt gleich (für Offline-Support)
NB.app.state = { ... }

// 2. persist() macht jetzt mehr:
NB.app.persist = async function(data, collection) {
  // Lokal (immer)
  localStorage.set("nestbau-state-v1", JSON.stringify(NB.app.state))
  
  // Cloud (wenn Firebase aktiv)
  if (NB.cloud.available()) {
    await NB.cloud.updateCollection(collection, data)
  }
}

// 3. Real-time Listener starten nach Login
NB.cloud.subscribeHousehold()
  .on("ingredients", (data) => {
    NB.app.state.ingredients = data
    NB.app.render()
  })
```

---

## ⚡ Performance-Optimierungen

### Batch Writes

```javascript
// Statt 50 einzelne Writes:
batch = db.batch()
data.forEach((item, i) => {
  batch.set(ref.collection.doc(item.id), item)
})
await batch.commit()  // Ein Roundtrip statt 50
```

### Pagination (für große Listen)

```javascript
// Erste 50 Rezepte:
query1 = db.collection("recipes")
  .orderBy("updatedAt", "desc")
  .limit(50)

// Nächste 50:
query2 = query1.startAfter(lastDoc).limit(50)
```

### Offline Caching

```javascript
// Firebase enablePersistence() speichert automatisch
// → ohne Netz können lokal gecachte Daten gelesen werden
// → Schreibzugriffe werden gepuffert und später synchonisiert
```

---

## 🧪 Testing (lokal mit Emulator)

```bash
# Emulator starten
firebase emulators:start --only firestore,auth,storage

# In der App:
NB.configure({
  firebase: {
    ...config,
    // Für Emulator:
    // emulatorSettings: ["localhost", 8080]
  }
})
```

---

## 📝 Migrationsschritte

### Bestehende Daten hochladen

1. **Benutzer anmelden** (Google Auth)
2. **Haushalt erstellen/beitreten**
3. **Zahnrad → Cloud → "Hochladen"**
   - `NB.migrate.uploadRecipes()` → Firestore
   - `NB.migrate.uploadIngredients()` → Firestore
   - Alle anderen Collections
   - Gegenlesen (Counts vergleichen)
4. **Live-Sync startet automatisch**

### Code beim Upload

```javascript
NB.cloud.requestMigration = async function() {
  try {
    // 1. Testlauf
    const counts = await NB.migrate.countLocal()
    console.log("Hochzuladen:", counts)
    
    // 2. Sicherung
    await NB.migrate.backup()
    
    // 3. Upload in Stapeln
    for (const [collName, items] of Object.entries(toUpload)) {
      await NB.migrate.uploadBatch(collName, items)
    }
    
    // 4. Gegenlesen
    await NB.cloud.verifyMigration()
    
    // 5. Sync starten
    await NB.cloud.subscribeHousehold()
  } catch (e) {
    NB.error.show("Migration fehlgeschlagen", e)
    // Rückweg anbieten
  }
}
```

---

## 🎯 Implementierungs-Roadmap

### Phase 1: Cloud Functions (Basis)
- [x] Firestore-Regeln
- [x] Household-Management
- [ ] Real-time Listener für alle Collections
- [ ] localStorage → Firestore Sync
- [ ] Error Handling + Retry

### Phase 2: Migration
- [ ] Migration-UI in Profileinstellungen
- [ ] Backup vor Upload
- [ ] Batch-Upload (400er Stapel)
- [ ] Gegenlesen/Verifizierung

### Phase 3: Polish
- [ ] Offline-Cache testen
- [ ] Konflikt-Auflösung
- [ ] Performance Monitoring
- [ ] Cloud Functions (optional)

---

## 🚨 Fehlerbehandlung

### Kategorie 1: Auth-Fehler
```
UNAUTHORIZED → "Nicht angemeldet"
  Lösung: Neu anmelden
  
PERMISSION_DENIED → "Zugriff verweigert"
  Lösung: Firestore-Regeln prüfen
```

### Kategorie 2: Netz-Fehler
```
NETWORK_ERROR → "Keine Verbindung"
  Lösung: Offline-Cache aktivieren, später Sync
  
TIMEOUT → "Zu langsam"
  Lösung: Abbrechen, Batch kleiner machen
```

### Kategorie 3: Data-Fehler
```
CONFLICT → "Daten von anderem Gerät überschrieben"
  Lösung: Warnung zeigen, letzter Stand lokalisieren
  
SIZE_ERROR → "Datei zu groß (>10 MB)"
  Lösung: Bild verkleinern
```

---

## 📋 Checkliste für Deployment

- [ ] Firebase Console: Firestore Database erstellt
- [ ] Firebase Console: Storage aktiviert
- [ ] Firebase Console: Auth (Google) aktiviert
- [ ] `js/nb-config.local.js` mit firebaseConfig gefüllt
- [ ] `firestore.rules` deployed: `firebase deploy --only firestore:rules`
- [ ] `storage.rules` deployed: `firebase deploy --only storage`
- [ ] Authorized Domains in Firebase Auth eingetragen
- [ ] OAuth Redirect-URIs korrekt
- [ ] Tests mit Emulator erfolgreich
- [ ] Production Test mit echtem Projekt

---

## 📚 Relevante Dateien

| Datei | Beschreibung |
|---|---|
| `js/nb-firebase.js` | Firestore-API, Authentifizierung, Haushalt |
| `js/nb-migrate.js` | Migration localStorage → Firestore |
| `js/nb-core.js` | Error Handling, Retry-Logik |
| `index.html` | Integration aller Module |
| `firestore.rules` | Security & Access Control |
| `storage.rules` | Image Upload Security |
| `js/nb-config.local.js` | **GEHEIM:** Firebase Config (local nur) |

---

## 🔗 Externe Ressourcen

- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Security Rules](https://firebase.google.com/docs/firestore/security/start)
- [Real-time Listeners](https://firebase.google.com/docs/firestore/query-data/listen)
- [Offline Persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
