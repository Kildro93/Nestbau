# Play Store — Konfiguration und Weg zum Upload

Nestbau ist eine PWA. Der von Google unterstützte Weg in den Play Store ist
eine **Trusted Web Activity (TWA)**: ein dünner Android-Container, der die
Seite in einem Chrome ohne Adressleiste lädt.

Daraus folgen zwei harte Voraussetzungen, die keine Abkürzung kennen:

1. **Die App muss unter einer öffentlichen HTTPS-URL laufen.** `localhost`
   funktioniert nicht. Dafür ist der Pages-Workflow da.
2. **Unter `https://<domain>/.well-known/assetlinks.json` muss der
   SHA-256-Fingerprint des Signaturschlüssels liegen.** Fehlt er, zeigt
   Android die Adressleiste — die App wirkt wie ein Browserfenster und
   fällt in der Review meist durch.

---

## Status

| Punkt | Stand |
|---|---|
| Test-Suite | 43/43 grün |
| Health-Check (inkl. echtem Chromium) | 11/11 grün |
| Security-Check | 0 blockierende Befunde |
| Performance-Budgets | alle eingehalten (37,7 KB gzip) |
| Icons (13 Größen, inkl. maskable) | erzeugt |
| Play-Icon 512×512 | erzeugt |
| Feature-Graphic 1024×500 | erzeugt |
| Phone-Screenshots 1080×1920 | 5 Stück erzeugt |
| `twa-manifest.json` | vorbereitet |
| **Öffentliche HTTPS-URL** | **offen — Pages aktivieren** |
| **Signatur-Keystore** | **offen — muss ein Mensch anlegen** |
| AAB gebaut | blockiert durch die zwei Punkte darüber |

Aktuellen Stand jederzeit abfragen:

```bash
node scripts/build-twa.mjs --check
```

---

## Schritt 1 — App online stellen

In den Repo-Einstellungen: **Settings → Pages → Source: „GitHub Actions"**.

Danach veröffentlicht `.github/workflows/pages.yml` bei jedem Push auf `main`
nach `https://kildro93.github.io/Nestbau/`.

Prüfen:

```bash
curl -sI https://kildro93.github.io/Nestbau/manifest.json
```

### Achtung: assetlinks.json und Unterverzeichnisse

Android sucht `assetlinks.json` **immer in der Domain-Wurzel**, nie im
Projektpfad. Bei `kildro93.github.io/Nestbau/` muss die Datei also nach
`https://kildro93.github.io/.well-known/assetlinks.json` — und das geht nur
über ein Repo namens `kildro93.github.io`.

Drei Wege:

- **Eigene Domain** auf das Pages-Repo zeigen lassen (sauberste Lösung).
- Ein Repo `kildro93.github.io` anlegen und dort nur die `assetlinks.json`
  ablegen; die App bleibt, wo sie ist.
- Die App direkt ins Repo `kildro93.github.io` legen, dann liegt alles in der
  Wurzel und `startUrl` wird zu `/`.

Für welchen Weg auch immer: `host`, `startUrl` und `fullScopeUrl` in
`twa-manifest.json` müssen danach stimmen.

---

## Schritt 2 — Signaturschlüssel anlegen

Das macht ein Mensch, nicht ein Skript: hier werden Passwörter vergeben.

```bash
mkdir android
keytool -genkeypair -v -storetype PKCS12 -keystore android/upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Der Keystore ist gitignored und darf **nie** ins Repo. Geht er verloren,
lässt sich die App im Store nicht mehr aktualisieren. Sichern, Passwort in
einen Passwortmanager.

Fingerprint auslesen:

```bash
keytool -list -v -keystore android/upload-keystore.jks -alias upload
```

Die `SHA256:`-Zeile übernehmen:

```bash
node scripts/make-assetlinks.mjs AB:CD:...:EF
```

> **Play App Signing:** Für neue Apps signiert Google die Auslieferung mit
> einem eigenen Schlüssel. Dann muss zusätzlich der Fingerprint aus der Play
> Console (*Setup → App-Integrität → App-Signaturschlüssel*) in
> `assetlinks.json`. Beide einzutragen ist erlaubt und der sichere Weg —
> sonst zeigt die installierte App die Adressleiste, obwohl sie lokal
> funktioniert hat.

---

## Schritt 3 — Bauen

```bash
node scripts/build-twa.mjs --check    # muss grün sein
node scripts/build-twa.mjs --init     # Android-Projekt erzeugen
node scripts/build-twa.mjs --build    # AAB + APK
```

Ergebnis: `android/app-release-bundle.aab` — das lädst du in der Play Console hoch.

---

## Store-Listing

### Texte

**App-Name (max. 30):**
```
Nestbau
```

**Kurzbeschreibung (max. 80):**
```
Aufgaben, Termine, Finanzen und Kochbuch für den gemeinsamen Haushalt.
```

**Vollständige Beschreibung (max. 4000):**
```
Nestbau bringt den gemeinsamen Haushalt an einen Ort.

HEUTE
Der Tag auf einen Blick: was ansteht, wer dran ist, was auf dem Speiseplan
steht.

AUFGABEN
Mehrere Listen für Aufgaben und Einkäufe. Einträge lassen sich einer Person
zuweisen oder gemeinsam führen. Die Wochenübersicht zeigt, was noch offen ist.

KALENDER
Termine in Wochen- und Monatsansicht, mit farbiger Zuordnung pro Person.

FINANZEN
Wiederkehrende Zahlungen erfassen — monatlich, vierteljährlich, halbjährlich
oder jährlich. Nestbau rechnet den Monats- und Jahresschnitt aus und zeigt,
wann die nächste Zahlung fällig ist.

KOCHBUCH
Zutaten, Rezepte und Menüplan. Aus dem Wochenplan entsteht die Einkaufsliste.

OHNE KONTO, OHNE CLOUD
Alle Daten bleiben auf dem Gerät. Kein Konto, keine Anmeldung, keine
Übertragung an Server. Die App funktioniert vollständig offline.

Für Sicherungen und den Wechsel auf ein neues Gerät lassen sich alle Daten
als Datei exportieren und wieder einlesen.
```

### Grafiken

| Element | Datei | Format |
|---|---|---|
| App-Icon | `assets/play/icon-512.png` | 512×512 PNG |
| Feature-Graphic | `assets/play/feature-graphic.png` | 1024×500 PNG |
| Phone-Screenshots | `assets/play/screenshots/*.png` | 1080×1920 PNG, 5 Stück |

Neu erzeugen:

```bash
npm run playstore:assets
node scripts/capture-screenshots.mjs
node scripts/capture-screenshots.mjs --dark
```

### Einstufung

- **Kategorie:** Produktivität
- **Inhaltsfreigabe:** Jeder / PEGI 3 — keine nutzergenerierten öffentlichen
  Inhalte, keine Werbung, keine Käufe
- **Zielgruppe:** ab 13 Jahren

### Datensicherheit

Der Fragebogen in der Play Console lässt sich für diese App durchweg mit
„nein" beantworten:

| Frage | Antwort |
|---|---|
| Werden Daten erhoben? | Nein |
| Werden Daten geteilt? | Nein |
| Werden Daten übertragen? | Nein — die App hat keine Netzwerkaufrufe |
| Verschlüsselung bei Übertragung | entfällt |
| Löschung möglich | Ja, über App-Daten löschen |

Belegt durch den Security-Check: `index.html` enthält keine externen
Ressourcen und keinen einzigen `fetch()` an eine fremde Adresse.

Gespeichert wird ausschließlich im `localStorage` des Geräts, unter den
Schlüsseln `nestbau-state-v1` und `nestbau-active-profile`.

### Datenschutzerklärung

Play verlangt eine öffentlich erreichbare URL. Vorschlag: `PRIVACY.md` in
diesem Repo, veröffentlicht über Pages unter
`https://kildro93.github.io/Nestbau/privacy.html`.

---

## Wenn die Review etwas beanstandet

**„App wirkt wie eine Website"** — `assetlinks.json` fehlt, liegt am falschen
Ort oder enthält den falschen Fingerprint (siehe Play App Signing oben).
Prüfen mit dem Statement-List-Tester von Google.

**„Mindest-Funktionalität"** — passiert bei sehr dünnen Web-Wrappern. Hier
unwahrscheinlich: fünf ausgebaute Bereiche, Offline-Betrieb, Datenexport.

**„targetSdkVersion zu niedrig"** — steht auf 35 und erfüllt die Vorgabe
seit August 2025.
