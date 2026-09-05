# Phase 3: OAuth Integration Setup
**Zweck:** Google Calendar und Outlook Calendar mit Nestbau verbinden

## 📋 Was ist zu tun?
Du brauchst **3 Credentials** um die OAuth-Integration abzuschließen:
1. **Google OAuth Client ID** (aus Google Cloud Console)
2. **Outlook/Microsoft Client ID** (aus Azure Portal)

Diese werden in `js/nb-config.local.js` eintragen.

---

## 🔵 Schritt 1: Google OAuth Client ID eintragen

### A) Google Client ID beschaffen
1. Gehe zu **Google Cloud Console** → https://console.cloud.google.com
2. Wähle das Nestbau-Projekt aus (oder erstelle ein neues)
3. Gehe zu **APIs & Services → Credentials**
4. Klicke **"Create Credentials" → "OAuth 2.0 Client ID"**
5. Wenn OAuth-Zustimmungsbildschirm nicht konfiguriert: 
   - Klicke **"Configure Consent Screen"**
   - Wähle **"External"** User Type
   - Fülle das Formular aus (App-Name, Support-Email)
   - Unter **"Scopes"** füge hinzu:
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
   - Unter **"Test users"** (bei dev): füge deine Email hinzu
6. Zurück zu **Credentials → OAuth 2.0 Client ID**
7. Wähle **Application Type: "Web application"**
8. Unter **"Authorized JavaScript origins"** füge hinzu:
   - `http://localhost:8000` (für lokale Entwicklung)
   - `https://your-domain.com` (für Produktion)
9. Unter **"Authorized redirect URIs"** füge hinzu:
   - `http://localhost:8000/oauth-callback.html`
   - `https://your-domain.com/oauth-callback.html`
10. Speichern – kopiere die **Client ID** (sieht so aus: `123456789-abc.apps.googleusercontent.com`)

### B) Client ID in nb-config.local.js eintragen
Erzeugt die Datei `js/nb-config.local.js`:
```javascript
/* Nestbau v2 – Lokale Konfiguration (nicht ins Repo commiten) */
NB.configure({
  google: {
    clientId: "YOUR_GOOGLE_CLIENT_ID"  // z.B. "123456789-abc.apps.googleusercontent.com"
  }
});
```

Ersetze `YOUR_GOOGLE_CLIENT_ID` mit deiner echten Client ID von Google.

---

## 🟣 Schritt 2: Outlook OAuth Client ID eintragen

### A) Outlook Client ID beschaffen
1. Gehe zu **Azure Portal** → https://portal.azure.com
2. Gehe zu **Azure Entra ID (ehemals Active Directory)**
3. Im Menü links: **App registrations**
4. Klicke **"New registration"**
5. Fülle aus:
   - **Name:** `Nestbau` (oder beliebig)
   - **Supported account types:** `Accounts in any organizational directory and personal Microsoft accounts`
6. Klicke **Register**
7. Du siehst jetzt die **Application (Client) ID** – kopiere diese
8. Im Menü links: **Authentication**
9. Klicke **"Add a platform"** → **"Single-page application"**
10. Unter **Redirect URIs** füge hinzu:
    - `http://localhost:8000/oauth-callback.html` (lokal)
    - `https://your-domain.com/oauth-callback.html` (Produktion)
11. Speichern ✓
12. Im Menü links: **API permissions**
13. Klicke **"Add a permission"** → **Microsoft Graph**
14. Wähle **Delegated permissions** und füge hinzu:
    - `Calendars.ReadWrite`
    - `User.Read`
    - `offline_access`
15. Klicke **"Grant admin consent"** (falls du Admin bist)

### B) Client ID in nb-config.local.js eintragen
Aktualisiere `js/nb-config.local.js`:
```javascript
/* Nestbau v2 – Lokale Konfiguration (nicht ins Repo commiten) */
NB.configure({
  google: {
    clientId: "YOUR_GOOGLE_CLIENT_ID"  // z.B. "123456789-abc.apps.googleusercontent.com"
  },
  outlook: {
    clientId: "YOUR_OUTLOOK_CLIENT_ID"  // z.B. "a1b2c3d4-1234-1234-1234-a1b2c3d4e5f6"
  }
});
```

Ersetze:
- `YOUR_GOOGLE_CLIENT_ID` mit deiner Google Client ID
- `YOUR_OUTLOOK_CLIENT_ID` mit deiner Azure Entra ID Application (Client) ID

---

## ✅ Verifizierung

### 1) Konsole überprüfen
Starte Nestbau lokal:
```bash
python -m http.server 8000  # oder: npx serve -p 8000
```
Öffne http://localhost:8000 und überprüfe Browser-Konsole (F12):
- Es sollte KEINE Fehler kommen
- Es sollte eine Info wie `[nb] Konfiguration geladen` stehen

### 2) Konfiguration testen
Gehe zu **Einstellungen (⚙️) → Integrationen**:
- Unter **Google Kalender** sollte der Button grün sein ✓
- Unter **Outlook Kalender** sollte der Button grün sein ✓
- Wenn noch rot: `nb-config.local.js` wurde nicht richtig geladen

### 3) OAuth-Flow testen
1. Klicke **"Google Kalender verbinden"**
2. Es öffnet sich ein Google-Login-Popup
3. Nach erfolgreichem Login: Status ändert zu **"Verbunden"**
4. Wiederhole für Outlook

### 4) .gitignore überprüfen
Stelle sicher, dass `.gitignore` folgende Zeile hat:
```
js/nb-config.local.js
```
So wird deine lokale Config nicht versehentlich ins Repo gepusht.

---

## 📁 Zusammenfassung der Dateien

| Datei | Zweck |
|-------|-------|
| `js/nb-config.js` | Standard-Konfiguration (ins Repo) |
| `js/nb-config.local.js` | **NEU** – Deine lokalen Credentials (NICHT ins Repo) |
| `src/firebase-config.js` | Firebase-Credentials (bereits konfiguriert) |
| `firestore.rules` | Firestore Security Rules (lokal deployen mit `firebase deploy`) |
| `storage.rules` | Storage Security Rules (lokal deployen mit `firebase deploy`) |

---

## 🚀 Nächste Schritte

Nach OAuth-Setup:
1. ✅ Firebase Rules deployen: `firebase deploy --only firestore:rules,storage`
2. ✅ Offline-Mode testen (Cache, Service Worker)
3. ✅ QA-Tests durchführen (siehe QA_VALIDATION_REPORT.md)

---

## ❓ Fehlerbehebung

**"Client ID fehlt" Fehlermeldung?**
- Überprüfe `js/nb-config.local.js` Syntax
- Stelle sicher, dass die Datei im richtigen Verzeichnis liegt: `js/nb-config.local.js`
- Aktualisiere die Browser-Seite (Ctrl+Shift+R)

**OAuth-Popup wird blockiert?**
- Überprüfe PopUp-Blocker im Browser
- Überprüfe Redirect-URI in Google/Azure Console (muss EXAKT matchen)

**"Redirect URI nicht registriert"?**
- Google/Azure erkennt die URI nicht
- Stelle sicher, dass Protokoll (http/https), Domain und Pfad EXAKT übereinstimmen
- Beispiel: Wenn lokal `http://localhost:8000/`, dann muss auch genau so in Google/Azure stehen

---

**Erstellt von:** Claude Design Architect  
**Status:** Phase 3 - OAuth Integration  
**Letzte Änderung:** 2026-09-05
