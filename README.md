# Nestbau – lokale Version

Die App aus dem Claude-Artefakt, lokal lauffähig. Design, Tabs
(Heute / Aufgaben / Kalender / Finanzen / Kochbuch) und alle Funktionen sind unverändert.
Ergänzt wurde nur ein Bereich **Daten** in den Einstellungen (Sicherung speichern / laden).

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die komplette App (HTML, CSS, JS in einer Datei) |
| `manifest.json` | macht die App auf dem Handy installierbar |
| `icon.svg` | App-Icon für den Startbildschirm |
| `sw.js` | Offline-Support (nur bei Start über einen Server aktiv) |
| `js/nb-*.js` | Verbindungen: Google Kalender, Outlook, Kochbuch-Cloud |
| `oauth-callback.html` | Rückmeldeseite der Anmeldung |
| `firestore.rules`, `storage.rules` | Zugriffsregeln für die Cloud |
| `docs/INTEGRATIONEN.md` | Einrichtung der Verbindungen, Schritt für Schritt |

## Verbindungen (optional)

Google Kalender, Outlook Kalender und ein gemeinsames Kochbuch über Firebase.
Alles davon ist freiwillig: ohne Einrichtung läuft die App genau wie bisher,
lokal und ohne Konto. Die Karten dazu stehen im Zahnrad unter
**Kalender verbinden** und **Cloud**.

Wichtig: Diese Verbindungen brauchen einen Server (`http://localhost:…` oder
eine HTTPS-Adresse). Beim Doppelklick auf `index.html` läuft die Seite als
`file://` – dafür gibt es bei Google, Microsoft und Firebase keine
registrierbare Herkunft, die Karten melden dann „Braucht http(s)".

Einrichtung: [`docs/INTEGRATIONEN.md`](docs/INTEGRATIONEN.md).

## Starten

**Am PC:** Doppelklick auf `index.html`. Läuft sofort.

**Am Handy als richtige App** – dafür braucht es einen kleinen lokalen Server, sonst
erlaubt der Browser das Installieren nicht. In diesem Ordner ein Terminal öffnen und:

```bash
python -m http.server 8000
```

Dann am Handy (gleiches WLAN) `http://<PC-IP>:8000` öffnen →
Browsermenü → *Zum Startbildschirm hinzufügen*. Danach läuft sie offline und ohne Browserleiste.

## Daten sichern und übertragen

Zahnrad oben rechts → Abschnitt **Daten**:

- **Sicherung speichern** – legt `nestbau-sicherung-JJJJ-MM-TT.json` im Download-Ordner ab.
- **Sicherung laden** – Datei auswählen, Rückfrage bestätigen, fertig. Die App startet
  danach neu, damit ältere Sicherungen sauber nachgezogen werden.
- **Als Text kopieren / einfügen** – zeigt dieselben Daten als Text. Nötig überall dort,
  wo der Browser keine Downloads erlaubt (z. B. im Claude-Artefakt).

Alles liegt im `localStorage` des Browsers unter `nestbau-state-v1`.
Ohne eingerichtete Verbindungen braucht die App weder Cloud noch Konto noch Internet.

Die Verbindungen legen ihre Daten getrennt davon unter `nb2:…` ab – Tokens
wandern deshalb nicht in die Sicherungsdatei und lassen sich nicht versehentlich
auf ein anderes Gerät übertragen.

**Daten aus dem Claude-Artefakt holen:** Der Browser trennt den Speicher pro Adresse,
die lokale App startet deshalb leer. Im Artefakt die Konsole (F12) öffnen und
`copy(localStorage.getItem("nestbau-state-v1"))` ausführen, dann hier unter
*Als Text kopieren / einfügen* einsetzen und auf **Übernehmen** tippen.

Vor grösseren Änderungen lohnt sich eine Sicherung – Browser-Cache leeren löscht die Daten.

## Änderungen

Alles steckt in `index.html`. Bearbeiten, speichern, Seite mit Strg+F5 neu laden.
