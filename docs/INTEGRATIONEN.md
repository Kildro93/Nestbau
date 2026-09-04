# Nestbau v2 – Integrationen einrichten

Betrifft: Google Kalender, Outlook Kalender, Kochbuch in der Cloud (Firebase).

---

## 0. Voraussetzung: die App muss über einen Server laufen

Das ist der Punkt, an dem sonst alles scheitert. Doppelklick auf `index.html`
öffnet die Seite als `file://`. Weder Google noch Microsoft noch Firebase
akzeptieren `file://` als Herkunft – es gibt dort keinen Origin, den man
registrieren könnte. Die App zeigt in dem Fall bei jeder Verbindung
„Braucht http(s)" und bietet gar nicht erst einen Anmeldeknopf an.

Kochbuch, Aufgaben, Kalender und Finanzen funktionieren weiterhin ohne Server.
Nur die Verbindungen brauchen einen.

**Lokal zum Ausprobieren:**

```bash
python -m http.server 8000
```

Dann `http://localhost:8000` öffnen. `localhost` gilt bei allen drei Anbietern
als sichere Herkunft, auch ohne HTTPS.

**Dauerhaft (empfohlen, weil das Handy sonst nicht mitkommt):** Firebase Hosting
oder GitHub Pages. Beides liefert HTTPS. Die Adresse, die dabei herauskommt,
wird unten überall als *deine Adresse* bezeichnet.

Die **Redirect-URI** ist immer:

```
<deine Adresse>/oauth-callback.html
```

Die App zeigt sie in den Profileinstellungen an, sobald sie über http(s) läuft –
von dort kopieren statt abtippen.

---

## 1. Konfigurationsdatei anlegen

```bash
cp js/nb-config.local.example.js js/nb-config.local.js
```

Diese Datei ist per `.gitignore` (`*.local.*`) vom Repository ausgeschlossen.
Sie enthält keine Geheimnisse – Client-IDs öffentlicher OAuth-Clients und der
Firebase-Web-Key gehören in den Browser. Geschützt wird nicht durch
Geheimhaltung, sondern durch die erlaubten Redirect-URIs und die
Firestore-Regeln. Die Datei bleibt trotzdem lokal, damit nicht jeder Fork auf
dasselbe Projekt zeigt.

Fehlt die Datei, laden alle Module trotzdem und melden „nicht eingerichtet".

---

## 2. Google Kalender

1. [Google Cloud Console](https://console.cloud.google.com) → Projekt anlegen.
2. **APIs & Dienste → Bibliothek** → *Google Calendar API* aktivieren.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm**
   - Nutzertyp *Extern*, App-Name „Nestbau"
   - Bereiche hinzufügen:
     `.../auth/calendar.events` und `.../auth/calendar.readonly`
   - Unter **Testnutzer** die eigene Adresse und die der Partnerin eintragen.
     Solange die App im Status *Test* steht, kommt sonst „Zugriff blockiert".
4. **Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**
   - Anwendungstyp: **Webanwendung**
   - *Autorisierte JavaScript-Quellen*: deine Adresse (z. B.
     `http://localhost:8000`, dazu die HTTPS-Adresse)
   - *Autorisierte Weiterleitungs-URIs*: nicht nötig – Google Identity Services
     arbeitet ohne Redirect-Seite.
5. Client-ID in `js/nb-config.local.js` unter `google.clientId` eintragen.

**Warum kein Refresh-Token:** Googles Token-Endpunkt verlangt für Web-Clients
ein Client-Secret, und ein Secret gehört nicht in eine Frontend-App. Der für
SPAs vorgesehene Weg ist das GIS-Token-Modell: Access-Tokens mit einer Stunde
Laufzeit, still erneuert, solange die Google-Sitzung im Browser besteht. Ist sie
weg, meldet die Karte „Neu anmelden nötig" – ein Klick genügt.

---

## 3. Outlook Kalender

1. [Entra-Portal](https://entra.microsoft.com) → **App-Registrierungen → Neue Registrierung**
   - Name: „Nestbau"
   - Unterstützte Kontotypen: *Konten in einem beliebigen Organisationsverzeichnis
     und persönliche Microsoft-Konten*
2. **Authentifizierung → Plattform hinzufügen → Single-Page-Anwendung**
   - Redirect-URI: `<deine Adresse>/oauth-callback.html`

   > Nicht „Web" wählen. Bei „Web" verlangt der Token-Endpunkt ein Secret und
   > antwortet mit `AADSTS9002326` (cross-origin token redemption). Die App
   > erkennt diesen Fall und sagt es in der Fehlermeldung ausdrücklich.
3. **API-Berechtigungen → Microsoft Graph → Delegierte Berechtigungen**:
   `User.Read`, `Calendars.ReadWrite`, `offline_access`
4. Die **Anwendungs-(Client-)ID** in `js/nb-config.local.js` unter
   `outlook.clientId` eintragen.
5. `outlook.tenant` bleibt auf `"common"`, solange private Microsoft-Konten
   mitspielen sollen.

Hier gibt es echte Refresh-Tokens (Laufzeit rund 24 Stunden, bei jedem Einlösen
rotierend). Erneuerung läuft still im Hintergrund.

---

## 4. Kochbuch in der Cloud (Firebase)

1. [Firebase Console](https://console.firebase.google.com) → Projekt anlegen.
2. **Authentifizierung** → Anmeldemethode **Google** aktivieren.
3. **Authentifizierung → Einstellungen → Autorisierte Domains**: deine Adresse
   eintragen (`localhost` steht dort schon).
4. **Firestore Database** anlegen (Modus *Produktion*).
5. **Storage** anlegen.
6. **Projekteinstellungen → Meine Apps → Web-App hinzufügen**. Den
   `firebaseConfig`-Block in `js/nb-config.local.js` unter `firebase` übertragen.
7. Regeln einspielen:

   ```bash
   firebase deploy --only firestore:rules,storage
   ```

   Die Dateien liegen als `firestore.rules` und `storage.rules` im
   Projektverzeichnis. Ohne diesen Schritt bleibt die Datenbank gesperrt und die
   App meldet „Zugriff verweigert".

### Datenmodell

```
households/{hid}                        Name, Besitzer, Beitrittscode, memberUids
households/{hid}/members/{uid}          Mitglieder
households/{hid}/ingredients/{id}       Zutaten
households/{hid}/recipes/{id}           Rezepte
households/{hid}/ingredientCategories/{id}
households/{hid}/ingredientGroups/{id}
households/{hid}/dishCategories/{id}    eigene Rezeptkategorien
households/{hid}/menuPlan/{JJJJ-MM-TT}  ein Dokument pro Tag
households/{hid}/meta/migration         Migrationsmarker
joinCodes/{CODE}                        Code → Haushalt (nur gezielt lesbar)
```

Bilder liegen im Storage unter `households/{hid}/images/{hash}.{ext}`, nicht im
Dokument: Firestore erlaubt 1 MiB pro Dokument, ein einzelnes Kamerafoto sprengt
das. Der Dateiname ist der Inhalts-Hash, identische Bilder landen deshalb nur
einmal.

---

## 5. Migration des Kochbuchs

Profileinstellungen → **Cloud** → *Mit Google anmelden* → *Haushalt anlegen* →
**Kochbuch hochladen**.

Ablauf:

1. **Testlauf** zählt nur und schreibt nichts – erst damit anfangen.
2. **Sicherung**: eine Datei `nestbau-vor-migration-JJJJ-MM-TT.json` landet im
   Download-Ordner, zusätzlich (wenn der Platz reicht) im localStorage.
3. **Bilder** werden nacheinander in den Storage geladen und im lokalen Zustand
   durch URLs ersetzt. Der localStorage wird dadurch spürbar kleiner.
4. **Dokumente** gehen in Stapeln zu 400 nach Firestore. Die Dokument-IDs sind
   die bestehenden lokalen IDs – ein zweiter Lauf überschreibt also, statt zu
   verdoppeln.
5. **Gegenlesen**: die Anzahl der Dokumente wird lokal und in Firestore
   verglichen. Abweichungen stehen im Bericht.
6. Danach läuft der **Live-Abgleich**: Änderungen auf einem Gerät erscheinen auf
   dem anderen.

**Zweites Gerät:** dort anmelden, den *Beitrittscode* aus den
Profileinstellungen des ersten Geräts eingeben, fertig. Nicht noch einmal
hochladen – das zweite Gerät bekommt alles über den Live-Abgleich.

**Zurück:** *Auf Stand vor der Migration zurücksetzen* stellt den lokalen Stand
wieder her und stoppt den Abgleich. Die Cloud-Daten bleiben dabei liegen.

---

## 6. Kalender abgleichen

Profileinstellungen → **Kalender verbinden** → *Verbinden*. Danach die Kalender
ankreuzen, die in Nestbau erscheinen sollen.

- **Richtung** steht auf *Nur importieren*. Das ist bewusst der Standard.
  *Importieren und exportieren* schreibt Nestbau-Termine in den ausgewählten,
  beschreibbaren Kalender – und Löschen in Nestbau löscht dort mit.
- **Zeitfenster**: 30 Tage rückwärts, 180 Tage vorwärts (in der Konfiguration
  änderbar).
- **Inkrementell**: nach dem ersten Durchlauf holt Google nur noch Änderungen
  über den `syncToken`, Graph über den `deltaLink`. Läuft die Marke ab
  (HTTP 410), lädt die App den Kalender automatisch einmal vollständig neu.
- Importierte Termine tragen im Kalender ein kleines Herkunftszeichen
  („Google" / „Outlook") und sind schreibgeschützt.
- Beim **Trennen** werden die importierten Termine wieder aus Nestbau entfernt.

Automatischer Abgleich alle 15 Minuten, zusätzlich beim Start und sobald das
Gerät wieder online ist. Bei ausgeblendetem Tab pausiert er.

---

## 7. Wenn etwas nicht geht

| Meldung | Ursache | Abhilfe |
|---|---|---|
| „Braucht http(s)" | App per Doppelklick geöffnet | Über Server öffnen, siehe Abschnitt 0 |
| „Client-ID fehlt" | `js/nb-config.local.js` fehlt oder leer | Abschnitt 1 |
| Google: „Zugriff blockiert" | Konto nicht als Testnutzer eingetragen | Zustimmungsbildschirm → Testnutzer |
| `AADSTS9002326` | Redirect-URI in Entra als „Web" statt „SPA" | Plattform löschen und als *Single-Page-Anwendung* neu anlegen |
| `AADSTS50011` | Redirect-URI stimmt nicht exakt | Adresse aus den Profileinstellungen kopieren |
| „Popup wurde blockiert" | Popup-Blocker | Popups für die Adresse erlauben |
| „Anmeldung abgelaufen" | Google-Sitzung weg / Refresh-Token widerrufen | *Neu anmelden* |
| Firebase: „nicht als autorisierte Domain eingetragen" | Adresse fehlt in der Auth-Konfiguration | Firebase → Authentifizierung → Einstellungen |
| „Zugriff verweigert – Firestore-Regeln prüfen" | Regeln nicht eingespielt | `firebase deploy --only firestore:rules,storage` |
| „Dokument zu gross" | Ein Foto blieb als Base64 im Dokument | Bild in der App neu aufnehmen; der Upload verkleinert nichts von allein |
| Offline-Cache nicht aktiv | Mehrere Tabs offen | Unkritisch, betrifft nur das Lesen ohne Netz |

Mehr Details in der Konsole: in `js/nb-config.local.js`
`logLevel: "debug"` setzen.

---

## 8. Wo was steckt

| Datei | Aufgabe |
|---|---|
| `js/nb-core.js` | Fehlercodes, Retry mit Backoff, HTTP, Speicher, Event-Bus |
| `js/nb-config.js` | Standardwerte, `NB.configure()`, Abgleich-Einstellungen |
| `js/nb-oauth.js` | PKCE, Popup-Flow, Token-Speicher |
| `js/nb-google-calendar.js` | Google Identity Services + Calendar API v3 |
| `js/nb-outlook-calendar.js` | PKCE gegen Entra ID + Microsoft Graph |
| `js/nb-calendar-sync.js` | Abgleich-Motor, Abbildung, Konflikte |
| `js/nb-firebase.js` | Firebase-Anbindung, Haushalt, Live-Abgleich |
| `js/nb-migrate.js` | Migration, Sicherung, Gegenlesen, Rückweg |
| `js/nb-integrations-ui.js` | Karten in den Profileinstellungen |
| `oauth-callback.html` | Empfängt den Redirect, reicht ihn ans Hauptfenster |
| `firestore.rules`, `storage.rules` | Zugriffsregeln |

Die App selbst liegt weiterhin vollständig in `index.html`. Die Verbindung
dorthin ist bewusst schmal: `window.NB.app` mit `getState`, `persist`, `render`,
`categories`, `people`. Fehlen die Module, läuft die App unverändert weiter.

---

## 9. Was bewusst nicht gemacht wurde

- **Kein Client-Secret, nirgends.** Ohne Backend gibt es keinen Ort, an dem
  eines sicher läge.
- **Tokens im localStorage.** Üblich für SPAs, aber ehrlich benannt: Wer fremdes
  JavaScript in die Seite bekommt, bekommt auch die Tokens. Deshalb keine
  fremden Skripte in `index.html` einbinden.
- **Kein serverseitiger Widerruf beim Trennen von Outlook.** Ohne Backend nicht
  möglich. Vollständig entfernen lässt sich die App unter
  [myaccount.microsoft.com](https://myaccount.microsoft.com/apps-and-services).
- **Keine Serientermin-Regeln.** Importiert werden aufgelöste Einzeltermine
  (Google `singleEvents`, Graph `calendarView`). Beim Export werden nur
  Einzeltermine geschrieben.
