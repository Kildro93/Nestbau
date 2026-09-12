# Nestbau – Lokale App mit optionaler Firestore-Integration (v2)

Die App läuft lokal ohne Cloud, mit optionalen Verbindungen zu Kalenderanbietern (Google, Outlook) und Firebase für gemeinsames Kochbuch + Aufgaben/Events/Finanzen.

## ⚡ Start

**Am PC:** Doppelklick auf `index.html`. Läuft sofort lokal.

**Mit lokalem Server** (für Handy-Installation oder Cloud-Verbindungen):
```bash
python -m http.server 8000
# Browser: http://localhost:8000
```

## 📱 Android-App

Nestbau laeuft zusaetzlich als native Android-App (Capacitor 7). Der Web-Code ist
derselbe – `index.html` und `js/` werden in die App gepackt.

```bash
npm install
npm run sync                          # PWA -> www/ -> android/
node tools/android-build.js debug     # APK zum Testen
node tools/android-build.js release   # signiertes AAB fuer den Play Store
```

| Dokument | Inhalt |
|---|---|
| [`BUILD-GUIDE.md`](BUILD-GUIDE.md) | Build, Signatur, Berechtigungen, Play Console, Stolpersteine |
| [`VERSIONING.md`](VERSIONING.md) | versionCode/versionName, Release-Ablauf |
| [`CHANGELOG.md`](CHANGELOG.md) | Was in welcher Version dazugekommen ist |
| [`play-store/`](play-store/) | Store-Texte, Grafiken, Screenshots, Datenschutz-Vorlage |

Zwei Punkte, die man vor dem ersten Store-Upload kennen sollte: die
Cloud-Funktionen sind im gebauten Paket noch **nicht** aktiv, und der
Release-Keystore liegt ausserhalb des Repositories und braucht ein Backup.
Beides steht ausfuehrlich in `BUILD-GUIDE.md`.

## 📁 Struktur

| Datei | Zweck |
|---|---|
| `index.html` | Komplette App (HTML, CSS, JS in einer) |
| `js/nb-core.js` | Kern: Error Handling, Retry-Logik, HTTP-Wrapper |
| `js/nb-oauth.js` | PKCE-Flow für Google & Microsoft |
| `js/nb-google-calendar.js` | Google Calendar API Integration |
| `js/nb-outlook-calendar.js` | Outlook/Microsoft Graph Integration |
| `js/nb-calendar-sync.js` | Kalender-Abgleich (inkrementell, Konflikt-Handling) |
| `js/nb-firebase.js` | Firestore für Kochbuch + Aufgaben + Events + Finanzen |
| `js/nb-profile.js` | Nutzerprofil (`users/{uid}`), Sync-Präferenzen, mehrere Haushalte |
| `js/nb-auth-gate.js` | Verpflichtendes Anmelde-Gate – nur aktiv, wenn Firebase konfiguriert ist |
| `js/nb-migrate.js` | Migration vom localStorage zu Firebase |
| `js/nb-integrations-ui.js` | Karten im Zahnrad-Menü (Login, Profil, Sync-Bereiche, Haushalte) |
| `js/nb-config.js` | Config-Struktur (leer, Platzhalter) |
| `js/nb-config.local.js` | **← NICHT IM REPO:** Client-IDs hier eintragen |
| `oauth-callback.html` | Redirect-URL für OAuth-Flow |
| `firestore.rules`, `storage.rules` | Firestore & Storage Sicherheitsregeln |
| `docs/INTEGRATIONEN.md` | Setup-Anleitung (Client-IDs, Firebase-Projekt) |
| `src/`, `firebase-*.js` | *Älterer Ansatz (ES-Module), kann ignoriert werden* |

## 🔄 Firestore-Integration (Optional)

Ohne Einrichtung (`js/nb-config.local.js` fehlt): App läuft lokal, alles im
`localStorage`, ganz ohne Konto.

**Sobald Firebase konfiguriert ist**, verlangt `js/nb-auth-gate.js` beim Start:
Anmelden (Google oder Email/Passwort) → Profil (Name, optional Alter/Gewicht)
→ Haushalt anlegen, per Code beitreten oder einen bekannten waehlen. Erst
danach ist die App zu sehen. Wer die App also ohne Konto nutzen will, lässt
Firebase in der eigenen Installation einfach unkonfiguriert.

Mit Firebase:
1. Aufgaben, Events, Finanzen werden zu Firestore synchronisiert
2. Kalender werden in beide Richtungen abgeglichen (Google/Outlook ↔ Nestbau)
3. Kochbuch ist gemeinsam über Beitrittscode teilbar
4. Pro Bereich (Aufgaben/Kalender/Finanzen/Kochbuch) laesst sich der Sync im
   Zahnrad-Menü einzeln abschalten – abgewaehlte Bereiche bleiben rein lokal
5. Ein Konto kann mehrere Haushalte anlegen/joinen und im Zahnrad-Menü
   zwischen ihnen wechseln

**Setup:** Siehe [`docs/INTEGRATIONEN.md`](docs/INTEGRATIONEN.md)

### Was wird synchronisiert?

| Bereich | lokal | Firebase | Bemerkung |
|---|---|---|---|
| Heute / Aufgaben | ✅ localStorage | ✅ Firestore collections | Abschaltbar (Sync-Bereich "Aufgaben") |
| Kalender (lokal) | ✅ localStorage | ✅ Firestore | Live-Sync mit Google/Outlook, abschaltbar |
| Finanzen (Abos) | ✅ localStorage | ✅ Firestore | Abschaltbar (Sync-Bereich "Finanzen") |
| Kochbuch | ✅ localStorage | ✅ Firestore | Mit Bilderspeicher, abschaltbar (inkl. Menüplan) |

## 💾 Daten sichern & laden

**Zahnrad** → Abschnitt **Daten**:
- **Sicherung speichern** – JSON-Datei im Download-Ordner
- **Sicherung laden** – Alte Datei zurückschreiben
- **Als Text kopieren/einfügen** – Für Browser ohne Downloads

Lokal: `localStorage["nestbau-state-v1"]`
Firebase: Alle COLLECTIONS im Haushalt

## 🚀 Migration: localStorage → Firebase

1. **Benutzer anmelden** (Firebase)
2. **Haushalt erstellen/beitreten**
3. **Zahnrad** → **Cloud** → **Hochladen**
   - Sicherung wird angelegt
   - Bilder in Storage hochgeladen
   - Listen, Events, Subscriptions, Kochbuch → Firestore
   - Live-Sync startet

Nach der Migration: Alle Geräte sync automatisch.

## 📝 Lokal bearbeiten

Alles steckt in `index.html`. Bearbeiten, speichern, Seite mit Strg+F5 neu laden.

## ⚙️ Fehlerbehandlung

- **14 normalisierte Error-Codes** (nb-core.js)
- **Retry mit Backoff + Jitter** (bis 30s Pause)
- **Honoert `Retry-After`-Header**
- **Offline-Cache** (Firestore: Tab-übergreifend)

## 🔒 Repository-Regeln

Gilt für alle, die an diesem Projekt arbeiten (Menschen und Chat-Sessions/Bots):

- Der Branch `main` ist ueber ein GitHub-Ruleset namens **`main-guard`**
  geschuetzt (Settings → Rules → Rulesets). Stand beim Anlegen: Enforcement
  "Disabled", Regel "Restrict deletions" aktiv, Target-Branch `main` noch
  einzutragen.
- Wer das Ruleset weiter konfiguriert oder den Enforcement-Status aendert,
  sollte diesen Abschnitt hier aktuell halten.
