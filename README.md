# Nestbau – Lokale App mit optionaler Firestore-Integration (v2)

Die App läuft lokal ohne Cloud, mit optionalen Verbindungen zu Kalenderanbietern (Google, Outlook) und Firebase für gemeinsames Kochbuch + Aufgaben/Events/Finanzen.

## ⚡ Start

**Am PC:** Doppelklick auf `index.html`. Läuft sofort lokal.

**Mit lokalem Server** (für Handy-Installation oder Cloud-Verbindungen):
```bash
python -m http.server 8000
# Browser: http://localhost:8000
```

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
| `js/nb-migrate.js` | Migration vom localStorage zu Firebase |
| `js/nb-integrations-ui.js` | Karten im Zahnrad-Menü |
| `js/nb-config.js` | Config-Struktur (leer, Platzhalter) |
| `js/nb-config.local.js` | **← NICHT IM REPO:** Client-IDs hier eintragen |
| `oauth-callback.html` | Redirect-URL für OAuth-Flow |
| `firestore.rules`, `storage.rules` | Firestore & Storage Sicherheitsregeln |
| `docs/INTEGRATIONEN.md` | Setup-Anleitung (Client-IDs, Firebase-Projekt) |
| `src/`, `firebase-*.js` | *Älterer Ansatz (ES-Module), kann ignoriert werden* |

## 🔄 Firestore-Integration (Optional)

Ohne Einrichtung: App läuft lokal, alles im `localStorage`.

Mit Firebase:
1. Aufgaben, Events, Finanzen werden zu Firestore synchronisiert
2. Kalender werden in beide Richtungen abgeglichen (Google/Outlook ↔ Nestbau)
3. Kochbuch ist gemeinsam über Beitrittscode teilbar

**Setup:** Siehe [`docs/INTEGRATIONEN.md`](docs/INTEGRATIONEN.md)

### Was wird synchronisiert?

| Bereich | lokal | Firebase | Bemerkung |
|---|---|---|---|
| Heute / Aufgaben | ✅ localStorage | ✅ Firestore collections | Wenn Firebase aktiv |
| Kalender (lokal) | ✅ localStorage | ✅ Firestore | Live-Sync mit Google/Outlook |
| Finanzen (Abos) | ✅ localStorage | ✅ Firestore | Wenn Firebase aktiv |
| Kochbuch | ✅ localStorage | ✅ Firestore | Mit Bilderspeicher |

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
