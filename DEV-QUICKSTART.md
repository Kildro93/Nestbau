# 🚀 Nestbau v2 – Developer Quickstart

**Für:** Entwickler, die Phase 2 (Testing & Implementation) machen  
**Zeit:** 5 Minuten zum Überblick, 30 Minuten zum Setup  
**Level:** Alle (Anfänger OK, komplexe Teile sind dokumentiert)

---

## 📚 Dokumente im Überblick

Lese diese **in dieser Reihenfolge:**

1. **Dieses Dokument** (5 min) – Überblick
2. **IMPLEMENTATION-STATUS.md** (10 min) – Was ist fertig, was nicht?
3. **FIREBASE-ARCHITECTURE.md** (15 min) – Wie funktioniert es?
4. **DEPLOYMENT.md** (20 min) – Wie teste ich lokal?

---

## ⚡ In 2 Minuten

**Nestbau = Gemeinsames Kochbuch mit Kalender**

- 💾 Speichert lokal im `localStorage`
- ☁️ Synced mit Firestore (optional)
- 🚀 Real-time Updates auf allen Geräten
- 📱 Works offline
- 🔐 Secure: Firestore Rules, kein Backend nötig

---

## 🏗️ Struktur

```
Nestbau/
├── index.html                    # Ganze App (HTML + CSS + JS)
├── js/
│   ├── nb-core.js               # Error, Retry, Utils
│   ├── nb-config.js             # Config (Defaults)
│   ├── nb-firebase.js           # ⭐ Firebase Sync (850 Zeilen)
│   ├── nb-migrate.js            # Migration + Backup
│   ├── nb-calendar-sync.js      # Google/Outlook Kalender
│   ├── nb-oauth.js              # Login-Flow
│   └── ...
├── js/nb-config.local.js        # ⭐ NICHT TRACKED (deine Secrets!)
├── firestore.rules              # ⭐ Security (schon OK)
├── storage.rules                # ⭐ Image Security (schon OK)
├── functions/
│   ├── index.js                 # Cloud Functions (Optional)
│   └── package.json
├── firestore.indexes.json       # Performance Indexes
├── FIREBASE-ARCHITECTURE.md     # Design Doc ⭐
├── DEPLOYMENT.md                # Setup Guide ⭐
└── IMPLEMENTATION-STATUS.md     # Wo wir stehen ⭐
```

⭐ = Most wichtig

---

## 🎯 Deine Aufgaben (Phase 2)

### Task 1: Lokal testen (2-3h)

```bash
# 1. Emulator starten
firebase emulators:start --only firestore,auth,storage

# 2. Server starten (anderes Terminal)
python -m http.server 8000

# 3. Browser öffnen
# http://localhost:8000
```

**Checklist:**
- [ ] App lädt, keine Fehler in Konsole
- [ ] Rezepte können lokal hinzugefügt werden
- [ ] localStorage speichert
- [ ] Offline-Mode funktioniert (DevTools → offline)

### Task 2: Firebase Emulator Sync testen (1-2h)

**Was ist zu testen:**
1. Login via Emulator Auth
2. Haushalt erstellen
3. Rezept hochladen → Firestore
4. Real-time Listener prüfen: `NB.cloud.isWatching()` → true?

**Wenn es nicht funktioniert:**
- Konsole (F12) öffnen → Error-Messages suchen
- `NB.cloud.raw()` → Firebase SDK direkt prüfen
- `NB.app.getState()` → Aktueller State anschauen

### Task 3: Zwei-Gerät Sync Test (1-2h)

```
Gerät 1 (Browser Tab 1):
- Login
- Haushalt erstellen
- Rezept "Test1" hinzufügen
- Subscribe (Cloud → Sync starten)

Gerät 2 (Browser Tab 2):
- Login
- Beitrittscode von Gerät 1
- Subscribe
- → "Test1" sollte nach ~2sec sichtbar sein
- Dort Rezept "Test2" hinzufügen
- → Gerät 1 sollte "Test2" sehen
```

**Wenn es nicht funktioniert:**
- Beide Tabs den gleichen Haushalt? `NB.cloud.householdId()` prüfen
- Listener aktiv? `NB.cloud.isWatching()` → true?
- Firestore Console: Sind die Rezepte dort?

### Task 4: Offline Mode testen (30 min)

```
1. Rezepte hochladen + Subscribe
2. DevTools → Network → Offline
3. Neue Rezepte hinzufügen lokal
4. Online schalten
5. → Rezepte sollten zu Firestore synced werden
6. → Anderer Tab sollte sie sehen
```

### Task 5: Fehlerszenarien (1-2h)

**Teste diese Fehler:**
- [ ] Bild zu groß (>10 MB) → Clear error
- [ ] Firebase-Verbindung weg → Offline cache greift
- [ ] Gleichzeitiges Edit auf 2 Geräten → Last-write-wins
- [ ] Permission denied (falsche Rules) → User-Benachrichtigung

---

## 🔧 Wichtige Code-Abschnitte

### Real-time Listener starten

```javascript
// In: js/nb-firebase.js:349
NB.cloud.watch()  // Startet alle Listener
NB.cloud.isWatching()  // Status prüfen
NB.cloud.unwatch()  // Stop
```

### State ändern & Sync

```javascript
// 1. App ändert State
NB.app.state.recipes[id] = {...}

// 2. Speichern (lokal + optional Cloud)
await NB.app.persist()

// 3. Das triggert automatisch:
// → localStorage wird geschrieben
// → cloud.pushChanges() wird gecallt
// → Firestore wird aktualisiert
// → Real-time Listener triggert bei anderen Geräten
```

### Change Detection Debuggen

```javascript
// Was wurde changed?
NB.cloud.pushChanges().then(result => {
  console.log("Changed:", result.changed, "Removed:", result.removed)
})

// Current Hashes (sollten mit Firestore Snapshots matchen)
NB.store.get("cloud-hashes")
```

### Fehler abfangen

```javascript
try {
  await NB.cloud.watch()
} catch (err) {
  // NB.error Code (z.B. PERMISSION, NETWORK, AUTH_REQUIRED)
  console.log(err.code, err.message)
  
  // Oder allgemein:
  if (NB.isNbError(err)) {
    // Meine Fehler
  } else {
    // Firebase Fehler
  }
}
```

---

## 🪲 Debugging-Tipps

### 1. Konsole ist dein Freund

```javascript
// Alles loggen
NB.configure({ logLevel: "debug" })

// Spezifische Logs
const cloud = NB.log("cloud")
const migrate = NB.log("migrate")
```

### 2. State inspizieren

```javascript
// Aktueller State
NB.app.getState()

// Recipes filtern
NB.app.getState().recipes.filter(r => r.name.includes("Pasta"))

// Finanzen
NB.app.getState().subscriptions
```

### 3. Firebase direkt prüfen

```javascript
// Raw Firebase SDK
const { fb, db, auth, storage } = NB.cloud.raw()

// Alle Rezepte in Firestore
db.collection("households").doc(NB.cloud.householdId())
  .collection("recipes")
  .get()
  .then(snap => snap.docs.map(d => d.data()))
```

### 4. Network-Requests anschauen

DevTools → Network → Filter auf "firestore" oder "googleapis"

**Sollte sehen:**
- `POST .../runQuery` – Daten laden
- `POST .../documents` – Daten speichern
- Responses sollten Dokumente enthalten

---

## 📋 Common Issues & Fixes

| Problem | Fehler | Fix |
|---------|--------|-----|
| Login geht nicht | "popup-blocked" | Popups im Browser erlauben |
| Haushalt leer | "noch kein Kochbuch" | Erst hochladen, dann sync |
| Sync funktioniert nicht | `isWatching()` = false | `cloud.watch()` aufrufen |
| Offline-Cache funktioniert nicht | Nur leere Seite | Multiple Tabs? (Known Issue, unkritisch) |
| Bilder werden nicht hochgeladen | "Dokument zu groß" | Größer als 1 MiB? Komprimieren |
| "Zugriff verweigert" | PERMISSION error | Firestore Rules prüfen (Playground) |
| Timestamps merkwürdig | "Invalid date" | Server-Timestamps sind Numbers, nicht Dates |

---

## 🚀 Production Checklist

Vor Go-Live alle abhaken:

```
BEFORE DEPLOYMENT
[ ] Lokal mit Emulator erfolgreich getestet
[ ] Zwei-Gerät Sync funktioniert
[ ] Offline Mode funktioniert
[ ] Fehlerszenarien gehandhabt
[ ] nb-config.local.js NICHT im Repo (.gitignore)
[ ] Alle Regeln verstanden und getestet

FIREBASE SETUP
[ ] Firestore Database erstellt (Production)
[ ] Storage aktiviert
[ ] Auth (Google) configured
[ ] firestore.rules deployed
[ ] storage.rules deployed
[ ] Authorized Domains gesetzt
[ ] OAuth Redirect-URIs korrekt

FINAL CHECKS
[ ] HTTPS überall (outside localhost)
[ ] Keine Console-Warnungen
[ ] Real-time Sync funktioniert production
[ ] Offline Cache funktioniert
```

---

## 📞 Debugging-Hotline

### "Es funktioniert nicht lokal"

1. **Emulator läuft?** `ps aux | grep firebase`
2. **Server läuft?** Port 8000 frei?
3. **Localhost im Browser?** `http://localhost:8000`
4. **Konsole geöffnet?** F12 → siehe Errors

### "Sync funktioniert nicht"

1. `NB.cloud.isWatching()` → true?
2. `NB.cloud.householdId()` → hat ID?
3. Firestore Console → Documents dort?
4. Alle Rule-Checks erfüllt? (isMember, memberUids)

### "Firebase-Fehler"

```javascript
// Fehler lesen
NB.error.lastError  // ← Letzter Fehler
NB.error.lastError.code  // ← Code (z.B. PERMISSION)
```

### "Ich weiß nicht, was falsch ist"

1. `NB.configure({ logLevel: "debug" })`
2. DevTools → Console → Alles lesen
3. Network Tab → Requests anschauen
4. Firestore Console → Rules Playground testen

---

## 📖 Weiterführende Ressourcen

- **Firestore Doku:** https://firebase.google.com/docs/firestore
- **Security Rules:** https://firebase.google.com/docs/firestore/security/start
- **Real-time Listeners:** https://firebase.google.com/docs/firestore/query-data/listen
- **Offline Persistence:** https://firebase.google.com/docs/firestore/manage-data/enable-offline

---

## 💡 Pro-Tips

1. **DevTools Snippets:** Erstelle JS-Snippets für häufige Debuggings-Commands
2. **Console Favorites:** `NB.cloud`, `NB.app`, `NB.error` als Favs
3. **Firestore Emulator UI:** `http://localhost:4000` (wenn aktiviert)
4. **Backup vor Änderungen:** `localStorage.getItem("nestbau-state-v1")` speichern

---

## ✨ Next Steps

**Jetzt:** Nimm dir 30 Minuten, lies IMPLEMENTATION-STATUS.md und FIREBASE-ARCHITECTURE.md

**Dann:** Starte den Emulator und teste lokal (Task 1-2)

**Danach:** Zwei-Gerät Sync testen (Task 3)

**Zuletzt:** Fehlerszenarien durchspielen (Task 4-5)

**Finally:** Production Setup durchführen (DEPLOYMENT.md)

---

**Fragen?** Schau auf die entsprechende Dokumentation oben oder öffne eine GitHub-Issue.

**Viel Erfolg!** 🎉
