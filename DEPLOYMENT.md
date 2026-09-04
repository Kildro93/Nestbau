# Nestbau v2 – Deployment Checklist

Diese Anleitung führt durch den kompletten Setup-Prozess von Lokal bis Production.

---

## 📋 Phase 1: Lokal testen (Firebase Emulator)

### 1.1 Voraussetzungen

```bash
# Node.js 18+ installiert?
node --version

# Firebase CLI installieren
npm install -g firebase-tools

# Anmelden bei Google
firebase login
```

### 1.2 Emulator starten

```bash
cd /pfad/zu/Nestbau
firebase emulators:start --only firestore,auth,storage
```

Erwartet:
```
✔ Firestore Emulator läuft auf localhost:8080
✔ Auth Emulator läuft auf localhost:9099
✔ Storage Emulator läuft auf localhost:4000
```

### 1.3 Test-App laden

1. **js/nb-config.local.js** erstellen:

```javascript
NB.configure({
  logLevel: "debug",
  
  firebase: {
    // Firebase Emulator Settings
    apiKey: "test-key",
    authDomain: "localhost",
    projectId: "test-project",
    storageBucket: "test-bucket.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456",
    sdkVersion: "10.14.1"
    // Emulator-Einstellung später in index.html
  }
});
```

2. **index.html** öffnen über lokalen Server:

```bash
python -m http.server 8000
# Oder: npx http-server .
```

3. Browser: `http://localhost:8000`

### 1.4 Lokal testen

- [ ] App lädt ohne Fehler (Konsole prüfen)
- [ ] Rezepte können lokal hinzugefügt werden
- [ ] localStorage speichert Daten
- [ ] Offline-Modus funktioniert (DevTools → offline)

### 1.5 Firebase Emulator testen (optional)

Um mit Emulator zu testen (statt echtem Firebase):

```javascript
// Vor firebase.initializeApp():
if (location.hostname === 'localhost') {
  firebase.firestore().useEmulator('localhost', 8080);
  firebase.auth().useEmulator('http://localhost:9099');
  firebase.storage().useEmulator('localhost', 4000);
}
```

---

## 📦 Phase 2: Production Firebase Projekt

### 2.1 Projekt erstellen

1. **Firebase Console:** https://console.firebase.google.com
2. **Neues Projekt anlegen:**
   - Name: "Nestbau" (oder dein Name)
   - Google Analytics: Optional (deaktivierbar)
   - Region: Europe (z.B. "europe-west1")
3. **Warten** bis Projekt erstellt ist (~1 Min)

### 2.2 Firestore einrichten

1. **Firestore Database:**
   - Klick: "Create Database"
   - Modus: **Production** (nicht Test-Modus!)
   - Region: Deine Nähe (z.B. "europe-west1")
   - Sicherheitsregeln: Später deployed

2. **Sicherheitsregeln:**
   - Klick: "Rules" Tab
   - Den Inhalt von `firestore.rules` (aus Repo) Copy-Paste
   - Publish

### 2.3 Storage einrichten

1. **Cloud Storage:**
   - Klick: "Create Bucket"
   - Location: Gleiche Region wie Firestore
   - Public/Private: Standard (wird durch Rules geschützt)

2. **Sicherheitsregeln:**
   - Klick: "Rules" Tab
   - Den Inhalt von `storage.rules` (aus Repo) Copy-Paste
   - Publish

### 2.4 Authentication einrichten

1. **Authentication → Einstellungen:**
   - Klick: "Get Started"
   - Anmeldemethode: Google aktivieren
   - Google-Projekt wird automatisch linked

2. **Authorized Domains:**
   - Füge hinzu: `localhost` (schon vorhanden)
   - Füge hinzu: Deine Produktions-Domain (z.B. `nestbau.example.com`)

### 2.5 Firebase Config abrufen

1. **Project Settings (Zahnrad):**
2. **"My apps" Section:**
   - Klick: "Add App" → Web
   - App-Name: "Nestbau Web"
   - Nach Registration: Config-Objekt kopieren

3. **js/nb-config.local.js** aktualisieren:

```javascript
NB.configure({
  firebase: {
    apiKey: "AIzaSyDxxx...",
    authDomain: "nestbau-12345.firebaseapp.com",
    projectId: "nestbau-12345",
    storageBucket: "nestbau-12345.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
  }
});
```

### 2.6 OAuth (Google Kalender, Outlook)

**Falls später benötigt:** Siehe `docs/INTEGRATIONEN.md`

---

## 🚀 Phase 3: Deployment (Production)

### 3.1 Hosting-Option wählen

**Option A: Firebase Hosting (empfohlen)**
```bash
firebase init hosting
# Standard-Einstellungen übernehmen, Ordner: .
firebase deploy --only hosting
```

**Option B: GitHub Pages**
- Fork auf GitHub
- Settings → Pages → Deploy from branch
- Branch: main, Folder: /

**Option C: Eigener Server**
- `index.html` + `js/` + `manifest.json` hochladen
- HTTPS verwenden (wichtig für OAuth!)

### 3.2 Domain konfigurieren

Falls eigene Domain (z.B. `nestbau.example.com`):

1. **Firebase Hosting:**
   - Custom Domain verbinden in Console
   - DNS-Records aktualisieren (Firebase zeigt Anleitung)

2. **OAuth Konfiguration aktualisieren:**
   - Google Cloud Console → Authorized JavaScript origins: `https://nestbau.example.com`
   - Microsoft Entra → Redirect URIs: `https://nestbau.example.com/oauth-callback.html`

3. **Firebase Auth → Authorized Domains:**
   - Domain eintragen: `nestbau.example.com`

### 3.3 Sicherheitsregeln finale Prüfung

```bash
# Regeln aus Repo deployen
firebase deploy --only firestore:rules,storage
```

**Prüfen:**
- [ ] Im Firebase Console sind Regeln aktiv
- [ ] Test-Zugriff im Firestore → Rules Playground

### 3.4 Indexes deployen (optional)

Falls `firestore.indexes.json` vorhanden:

```bash
firebase deploy --only firestore:indexes
```

---

## 🧪 Phase 4: Produktiv-Testing

### 4.1 Vorabchecks

- [ ] App lädt über HTTPS (nicht HTTP)
- [ ] Keine Console-Fehler
- [ ] `nb-config.local.js` ist nicht im Repo (.gitignore prüfen)

### 4.2 Authentifizierung testen

1. Öffne `https://deine-domain.com`
2. Klick "Mit Google anmelden"
3. Google-Login-Popup öffnet sich
4. Nach Login: UID wird angezeigt
5. Logout funktioniert

### 4.3 Haushalt erstellen

1. Nach Login: "Haushalt anlegen"
2. Name eingeben: "Testhaushalt"
3. Haushalt sollte in Firestore Console sichtbar sein:
   ```
   databases/default/documents/households/{hid}
   ```

### 4.4 Rezept hochladen (Test-Upload)

1. Haushalt auswählen
2. Ein Rezept lokal hinzufügen
3. Zahnrad → Cloud → "Hochladen (Testlauf)"
   - [ ] "0 Fehler" Meldung
4. Klick "Hochladen (echt)"
   - [ ] Rezept erscheint in Firestore Console
   - [ ] `households/{hid}/recipes/{id}` ist vorhanden

### 4.5 Live-Sync testen (2 Geräte)

**Gerät 1:**
1. Login + Haushalt erstellen
2. Rezept "Test1" hinzufügen

**Gerät 2 (Handy/anderer Browser):**
1. Login + Beitrittscode von Gerät 1 eingeben
2. "Cloud" → "Abgleichen"
   - [ ] "Test1" sollte nach ~2 Sekunden sichtbar sein
3. Dort ein neues Rezept "Test2" hinzufügen

**Gerät 1:**
- [ ] "Test2" sollte nach ~2 Sekunden sichtbar sein

### 4.6 Offline testen

1. DevTools → Network: Offline
2. App sollte weiterhin funktionieren (gecachte Daten)
3. Neue Rezepte hinzufügen (lokal)
4. Network: Online
   - [ ] Neue Rezepte werden zu Firestore synchronisiert

---

## 📊 Phase 5: Monitoring & Maintenance

### 5.1 Firebase Console Übersichtlich nutzen

1. **Firestore:**
   - Datenbank → Collections durchschauen
   - Regeln → Playground zum Testen
   - Indexes → Werden automatisch vorgeschlagen

2. **Storage:**
   - Dateien → Hochgeladene Bilder
   - Regeln → Sicherheit prüfen

3. **Authentication:**
   - Nutzer → Wer ist angemeldet?
   - Anmeldemethoden → Google aktiviert?

### 5.2 Fehlerbehandlung

| Fehler | Lösung |
|--------|--------|
| "Zugriff verweigert" | Firestore-Regeln in Console prüfen |
| "Diese Adresse ist nicht autorisiert" | Authorized Domains + OAuth Redirect-URIs prüfen |
| Bilder laden nicht | Storage-Regeln + isMember-Check |
| Live-Sync funktioniert nicht | `cloud.isWatching()` in Konsole → sollte true sein |

### 5.3 Performance optimieren

- Firestore ist kostenlos bis 50k Reads/Tag
- Batch writes reduzieren Kosten (bis zu 500 ops/batch)
- Real-time Listener nur für aktive Tabs (in nb-config.js einstellbar)

---

## 🔐 Sicherheit-Checkliste

- [ ] **Kein Client-Secret** in index.html
- [ ] **Tokens im localStorage** – OK für SPA (gehört dazu)
- [ ] **HTTPS** überall (außer localhost)
- [ ] **CORS** nicht nötig (Firebase regelt das)
- [ ] **nb-config.local.js** nicht im Repo (.gitignore ✓)
- [ ] **Firestore-Regeln** verhindern enumeration (list = false)
- [ ] **Join-Codes** ermöglichen Zugriff ohne Liste durchsuchen
- [ ] **Storage-Regeln** checken memberUids in Firestore

---

## 📝 Notizen für Production

### Backup-Strategie

- Automatischer Export (Firebase bietet das):
  ```bash
  gcloud firestore export gs://nestbau-backups/backup-YYYY-MM-DD
  ```
- Download-Funktion in App nutzen (lokal als JSON)

### Skalierung

- Firestore: Auto-skaliert (kein Setup nötig)
- Storage: Auto-skaliert (kein Setup nötig)
- Alte Daten archivieren? → Später bei Bedarf

### Kosten-Monitoring

- Firebase Console: Blaze Plan kostenlos bis:
  - 50k Reads/Tag
  - 20k Writes/Tag
  - 20k Deletes/Tag
  - 1 GB Storage/Tag
- Danach: Pay-per-use (meist <1€/Monat bei privater Nutzung)

---

## 🚨 Häufige Fehler

### ❌ "App lädt nicht"
→ Konsole prüfen (F12), Firebase-Fehler-Codes suchen

### ❌ "Anmeldung geht nicht"
→ OAuth Client-ID in `nb-config.local.js`? Authorized JavaScript origins in Google Cloud?

### ❌ "Bilder werden nicht hochgeladen"
→ Storage.rules korrekt deployed? Size <10 MB?

### ❌ "Zweit-Gerät sieht Daten nicht"
→ Cloud-Sync aktiv? (Zahnrad → Cloud → Status prüfen)

---

## ✅ Finales Checklist

```
PRE-DEPLOYMENT
[ ] Lokal mit Emulator getestet
[ ] nb-config.local.js mit echtem Firebase Project
[ ] HTTPS-Domain (oder localhost für Testing)
[ ] Alle Fehler in Console behoben

DEPLOYMENT
[ ] Firestore Database erstellt (Production Mode)
[ ] Storage aktiviert
[ ] Auth (Google) eingerichtet
[ ] firestore.rules deployed
[ ] storage.rules deployed
[ ] Authorized Domains gesetzt
[ ] OAuth Redirect-URIs gesetzt

PRODUCTION TESTS
[ ] Login funktioniert
[ ] Haushalt erstellen/beitreten funktioniert
[ ] Rezept-Upload funktioniert
[ ] Real-time Sync (2 Geräte) funktioniert
[ ] Offline-Mode funktioniert
[ ] Bilder hochladen funktioniert

SECURITY
[ ] nb-config.local.js nicht im Repo
[ ] Firestore-Regeln blocken list()
[ ] Storage-Regeln prüfen memberUids
[ ] HTTPS überall (außer localhost)
```

---

## 📞 Support & Debugging

### Logging aktivieren

In `js/nb-config.local.js`:
```javascript
NB.configure({
  logLevel: "debug"  // Statt "info"
});
```

### Firestore Playground testen

Firebase Console → Firestore → Rules → Playground:

```javascript
// Teste: Kann ein User mit UID=abc ein Rezept lesen?
match /databases/{database}/documents {
  allow read: if request.auth.uid == "abc"
              && "abc" in get(/databases/$(database)/documents/households/hid123).data.memberUids;
}
```

### Netzwerk-Debugging

Browser DevTools → Network → Filter "firestore":
- Sollte sehen: `POST queries?..._method=runQuery`
- Response sollte Dokumente enthalten (oder 404)

---

## 🎓 Nächste Schritte

1. ✅ **Lokal testen** (Phase 1-2)
2. ✅ **Production aufsetzen** (Phase 3)
3. ✅ **Live testen** (Phase 4)
4. 📊 **Monitoring einrichten** (Phase 5)
5. 🔧 **Cloud Functions optional deployen** (später)

Viel Erfolg! 🚀
