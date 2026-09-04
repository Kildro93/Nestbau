# Firebase Integration - Setup Guide

## Was ist neu

✅ **firebase-config.js** - Firebase-Initialisierung  
✅ **nestbau-data.js** - Daten-Zugriffschicht (vorbereitet)  
✅ **firebase-bridge.html** - Login Screen mit Firebase Auth  

## So funktioniert es jetzt

1. Öffne `firebase-bridge.html` statt `index.html`
2. Registriere dich oder melde dich an
3. Nach dem Login wird die alte App geladen
4. Die Daten werden (bald) in Firebase gespeichert

## Was noch zu tun ist (Phase 2)

Um **echte** Firebase-Integration (Daten von Firebase statt localStorage):

1. **index.html anpassen:**
   - `loadState()` → Daten von Firestore lesen
   - `persist()` → Daten in Firestore schreiben
   - `subscribeHousehold()` nutzen für Live-Updates

2. **Haushalt-Management:**
   - Haushalt auswählen/erstellen
   - Mitglieder einladen
   - Cloud Functions deployen (für Invites)

3. **Cloud Functions (optional):**
   ```bash
   cd ../nestbau-firebase/functions
   npm install
   firebase deploy --only functions
   ```

## Jetzt starten

```bash
# Terminal, im Repo-Ordner:
npx http-server .
# Browser: http://localhost:8080/firebase-bridge.html
```

Oder direkt:
```bash
open firebase-bridge.html
```

## Kontakt

Das ist noch Work-in-Progress. Wenn etwas nicht funktioniert → Bescheid sagen!
