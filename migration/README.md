# Migration: lokale Daten nach Firebase

## Vorbereitung

1. **Sicherung ziehen** – in der App: Zahnrad → *Daten* → *Sicherung speichern*.
   Ergebnis: `nestbau-sicherung-JJJJ-MM-TT.json`. Datei nach `migration/backups/` legen.
   Läuft die App im Artifact, stattdessen die Konsole (F12) öffnen und
   `copy(localStorage.getItem("nestbau-state-v1"))` ausführen, den Inhalt in eine
   `.json`-Datei einfügen.

2. **Service Account** – Firebase Console → Projekteinstellungen → Dienstkonten →
   *Neuen privaten Schlüssel generieren*. Datei als `serviceAccountKey.json` ablegen
   (steht in `.gitignore`, gehört nie ins Repository).

3. **Abhängigkeiten**

```bash
cd migration && npm install
```

4. **Eigene UID herausfinden** – nach der Registrierung in der App:
   Firebase Console → Authentication → Users → Spalte *User UID*.

## Ablauf

Immer erst als Probelauf:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node migrate.js --file ./backups/nestbau-sicherung-2026-09-03.json --uid DEINE_UID --create-household "Haushalt Zürich" --dry-run
```

Der Probelauf schreibt nichts, liest die ganze Datei durch und legt einen Bericht unter
`migration/reports/` ab: Anzahl je Kollektion, gefundene Fotos, und alle Warnungen
(kaputte Referenzen, ungültige Datumsangaben, zu grosse Bilder).

Sieht der Bericht gut aus, dieselbe Zeile ohne `--dry-run` ausführen.

## Optionen

| Option | Wirkung |
|---|---|
| `--file <pfad>` | Sicherungsdatei (Pflicht) |
| `--uid <uid>` | UID des Besitzers; wird zu `people.a` („Ich") |
| `--create-household "<name>"` | neuen Haushalt anlegen |
| `--household <id>` | in bestehenden Haushalt importieren |
| `--partner-uid <uid>` | UID der zweiten Person, falls sie schon registriert ist |
| `--dry-run` | nur Bericht, keine Schreibvorgänge |
| `--skip-photos` | Fotos auslassen (schneller Testlauf) |
| `--force` | dieselbe Datei erneut importieren |
| `--emulator` | gegen die lokalen Emulatoren laufen |

## Zweite Person nachziehen

Ist die Partnerin bei der Migration noch nicht registriert, bekommen ihre Einträge
`assignee: "pending:b"`. Nach ihrem Beitritt:

```bash
node reassign-partner.js --household <hid> --partner-uid <uid> --dry-run
```

Dann ohne `--dry-run`.

## Was passiert mit den Daten

| Lokal | Firebase |
|---|---|
| `state.people.a/.b` | `households/{hid}/members/{uid}` |
| `state.lists[]` + `items[]` | `lists/{listId}` + Unterkollektion `items` |
| `state.events[]` | `events/{eventId}` |
| `state.subscriptions[]` | `subscriptions/{subId}` |
| `state.ingredients[]` | `ingredients/{ingId}`, Foto → Storage |
| `state.ingredientCategories[]` | `ingredientCategories/{catId}`, `label`→`name`, `images[]` → Storage |
| `state.recipes[]` | `recipes/{recipeId}`, Foto → Storage, Allergene aggregiert |
| `state.menuPlan[tag]` | `menuPlan/{YYYY-MM-DD}` mit `slots`-Map |
| `state.activeListId` | `users/{uid}/private/settings` |

Dokument-IDs bleiben identisch zur lokalen App. Dadurch bleiben alle internen
Verweise gültig (Rezept → Zutat, Menüplan → Rezept, Aufgabe → Termin) und ein
zweiter Lauf überschreibt dieselben Dokumente, statt Dubletten anzulegen.

Base64-Fotos aus dem `localStorage` landen als JPEG in Cloud Storage, im Dokument
steht nur noch `photoPath`. Ein einzelnes Rezeptfoto als Data-URL würde sonst
schon einen guten Teil des 1-MiB-Dokumentlimits belegen und bei jeder Abfrage
mitübertragen.

## Nach der Migration prüfen

```bash
# Emulator-Variante zum gefahrlosen Üben
firebase emulators:start --only firestore,storage,auth
node migrate.js --file ./backups/... --uid test-uid --create-household "Test" --emulator
```

Danach in der Firebase Console stichprobenartig gegenprüfen: Anzahl Rezepte,
ein Rezept mit Foto, ein Menüplantag, eine Aufgabenliste mit erledigten Einträgen.
