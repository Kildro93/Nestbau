# Nestbau v2.0 – Rezept-Import System

**Vollständiger Web Clipper + KI-Parser + Firebase-Integration für die Nestbau-Kochbuch-App.**

## Übersicht

Vier Komponenten arbeiten zusammen:

1. **Browser-Extension** (`clipper/`) – „Save to Nestbau"-Button auf Websites und Instagram
2. **Cloud Functions** (`functions/lib/`) – Rezept-Parsing mit KI, Foto-Uebernahme, Naehrwerte
3. **Web-UI** (`web/`) – Import-Posteingang, Editor mit Live-Naehrwerten, Allergien-Warnung
4. **Firebase** (Rules, Indexes) – Sicherheit und Datenbankstruktur

## Installation

### 1. Cloud Functions aktivieren

```bash
cd nestbau-firebase/functions
npm install

# Ergaenzungen in package.json:
npm install @anthropic-ai/sdk@^0.70.0
```

**In bestehende `functions/index.js` einfuegen:**
```javascript
const recipeImport = require('./lib/recipeImport');

exports.clipRecipe = recipeImport.clipRecipe;
exports.processRecipeImport = recipeImport.processRecipeImport;
exports.importRecipeFromUrl = recipeImport.importRecipeFromUrl;
exports.retryRecipeImport = recipeImport.retryRecipeImport;
exports.commitRecipeImport = recipeImport.commitRecipeImport;
exports.deleteRecipeImport = recipeImport.deleteRecipeImport;
exports.createClipperToken = recipeImport.createClipperToken;
exports.listClipperDevices = recipeImport.listClipperDevices;
exports.revokeClipperDevice = recipeImport.revokeClipperDevice;
```

**Firestore Rules erganzen** (`firestore.rules.additions` -> bestehende `firestore.rules`):
- Drei neue `match` Bloecke fuer `recipeImports`, `ingredients`, `recipes`
- Ein Toplevel-Block fuer `clipperTokens`

**Storage Rules erganzen** (`storage.rules.additions`):
- Paths fuer `households/{hid}/recipeImports/` und `households/{hid}/recipes/`

**Firestore Indexes erganzen** (`firestore.indexes.additions.json`):
- Drei neue Compound-Indexes fuer `recipeImports`, `clipperTokens`, `recipes`

**Umgebungsvariable setzen:**
```bash
firebase functions:config:set anthropic.api_key="sk-ant-..."
```

### 2. Browser-Extension laden

**Chrome/Edge:**
1. `chrome://extensions` oeffnen, „Developermodus" ein
2. „Entpacte Erweiterung laden" → `nestbau-v2-recipe-import/clipper/` Ordner

Die Extension landet im Browser-Menu unter dem Nestbau-Logo.

### 3. Web-App integrieren

In der Nestbau-App (z. B. unter `#/kochbuch/importe`):

```html
<div id="import-ui"></div>

<link rel="stylesheet" href="path/to/recipe-import.css">
<script src="path/to/recipe-import.js"></script>

<script>
  NestbauRecipeImport.mount(
    document.getElementById('import-ui'),
    NestbauRecipeImport.firebaseAdapter({
      sdk: firebase,
      db: firebase.firestore(),
      functions: firebase.functions(),
      householdId: currentHouseholdId,
      getIngredients: () => stateIngredients
    }),
    {
      onCommitted: (recipeId) => { /* Rezept übernommen */ },
      onCount: (count) => { /* Offene Importe zählen */ }
    }
  );
</script>
```

## Ablauf: Vom Clipper zum Rezept

```
Browser Extension (Benutzer klickt "Zu Nestbau speichern")
    ↓
HTTP POST zu clipRecipe() (Bearer-Token in Header)
    ↓
status: "pending" Doc in Firestore anlegen (sofort antwortet die Function)
    ↓
processRecipeImport (Firestore-Trigger) startet parallel:
    • parseRecipe(): deterministisch JSON-LD, dann KI
    • enrich(): Zutaten-Abgleich, Naehrwerte, Allergien
    • fetchImageSafely(): Foto herunterladen (Server-seitig!)
    ↓
status: "ready" – Import-Posteingang zeigt es
    ↓
Nutzer prüft im Web-UI, editiert ggf.
    ↓
commitRecipeImport() speichert als echtes Rezept
    • Neue Zutaten anlegen (Platzhalter-IDs aufloesen)
    • Foto kopieren an endgueltigen Rezept-Pfad
    • status: "committed"
```

## Datenmodell: Mapping zur App

**Gerichte-Kategorien:**
- Parser kennt: `breakfast`, `main`, `snack`, `dessert`, `drink`
- App speichert: `fruehstueck`, `mittagabend`, `snack`, `dessert`, `getraenk`
- `SCHEMA_CATEGORY_MAP` in `recipeNutrition.js` uebersetzt

**Einheiten:**
- Parser akzeptiert: `g, kg, ml, cl, dl, l, el, tl, msp, prise, stk, bund, zehe, scheibe, stange, blatt, dose, packung, becher, tasse, glas, handvoll, schuss, kugel, wuerfel`
- App speichert: `g, kg, ml, l, stueck, el, tl, prise`
- `toAppUnit()` in `recipeUnits.js` rechnet um und notiert Original

**Allergene:**
- Parser: `gluten, laktose, eier, erdnuesse, nuesse, soja, fisch, krebstiere, sellerie, senf`
- App-Feld: `allergyIds` (Array)
- Zwei Quellen: bestaetigte aus Zutaten-DB + Stichwort-Fallback

**Zutaten-Shape:**
- Zeigt in der App: `{ id, name, baseGrams, kcal, protein, fat, carbs, allergyIds, categoryIds }`
- Import fuegt an: (optional) `nutrition{...}` (wird ignoriert, Flat-Felder verwenden)

**Rezept-Shape:**
- App-Feld: `{ id, title, desc, categories, time, portions, totalWeight, utensils, prep, steps, ingredients, favorite, photo, importedFrom{...} }`
- Import uebernimmt das 1:1

## Feinheiten

### Bild-Uebernahme
- **Server-seitig geholt** (Function, nicht Browser): funktion gegen Hotlinks und Content-Sperren
- **SSRF-Schutz**: Private IPs (10.0.0.0/8, 169.254.0.0/16, etc.) sind blockiert
- **Bis zu 3 Redirects** erlaubt, jeder wird auf private IPs geprueft
- **Max 8 MB** pro Datei
- **Storage-Pfad**: `households/{hid}/recipes/{recipeId}/photo.{ext}`

### Zutaten-Abgleich
1. **Exakter Name Match** (normalisiert)
2. **Singular/Plural-Varianten** ("Zwiebel" ↔ "Zwiebeln")
3. **Token-aehnlichkeit** (Jaccard-Index) + Substring-Treffer
4. Confidence >= 0.5: **automatisch zugeordnet**
5. Darunter: **Vorschlaege** an den Editor

**Die App zeigt:**
- ✅ Zugeordnete Zutaten geben Naehrwerte
- ⚠️ Nur Name, keine Menge: werden ignoriert (Nutzer wird gewarnt)
- ⚠️ Keine Zuordnung: Nutzer kann waehlen oder neu anlegen

### Nährwerte
- **Live-Rechnung** im Editor (kein Server-Roundtrip)
- Formel: `(Menge_g / baseGrams) * Naehrwert_pro_basis`
- **Coverage-Prozent**: wieviel der Gesamtmenge zugeordnet ist
  - > 80%: gruen
  - 40-80%: orange
  - < 40%: rot

### Allergien-Warnungen
**Woher kommen sie:**
1. **Bestaetigt**: Allergen in der Zutaten-DB eingetragen
2. **Vermutet**: Stichwort im Zutaten-Namen (z. B. "Milch" → Laktose)

**Wer wird gewarnt:**
- Nur Haushalts-Mitglieder, die Allergien geteilt haben (`shareAllergiesWithHousehold` in Bot 1)

**Im UI:**
- Rote Box oben im Editor
- Pro Allergen: betroffene Mitglieder, Sicherheit (bestaetigt/vermutet), Quellen

### Rate-Limiting
**Clipper-Token:**
- Max 5 Tokens pro Nutzer gleichzeitig
- Max 60 Importe pro Tag pro Token
- Min 1,5 Sekunden Abstand zwischen Requests (verhindert Missbrauch)

**KI-Kosten:**
- Nur bei unvollstaendigen JSON-LD-Daten (strukturierte Daten gewinnen)
- Claude Opus 5, Medium-Effort (Extraction aus vorliegendem Text)
- ~1–2K Input-Tokens pro Rezept durchschnittlich

## Datensicherheit

### Clipper-Token
- **Speicherung**: SHA-256-Hash, nie der Klartext
- **Nutzer sieht**: Token exakt einmal beim Anlegen
- **Extension speichert lokal**: der Klartext (Chrome Storage)
  - Nur dieser Browser
  - Nur in Nestbau-Erweiterung sichtbar (CSP)

### Bilder
- **Private Storage-Pfade**: `households/{hid}/images/` nur fuer Haushalts-Mitglieder sichtbar
- **Nicht oeffentlich** (anders als Profile-Bilder in Bot 1)

### Rezept-Import-Dokumente
- **Status-basiert sichtbar**: nur solange nicht "committed"
- **Dann geloescht** (oder archiviert, je nach Anforderung)

## Fehlerbehandlung

**HTTP-Fehler im Clipper:**
- 202: Erfolgreich angelegt, wird im Hintergrund verarbeitet
- 400: Leere Seite oder ungueltige URL
- 401: Token ungueltig/abgelaufen
- 409: Kein Haushalt verknuepft (bitte in Nestbau neu verbinden)
- 413: Seite zu gross (> 400 KB)
- 429: Rate-Limit erreicht

**Parser-Fehler:**
- **JSON-LD unparsbar**: Fallback auf KI
- **KI schlaegt fehl**: Raw-Text + Warnung sichtbar
- **Foto-Download scheitert**: Rezept trotzdem uebernehm­bar (nur ohne Bild)
- **Bild zu gross**: Warnung, kein Fehler

## Testing

**Demo-UI** (ohne Firebase):
```bash
cd web
python -m http.server 8000
# Dann: http://localhost:8000/demo.html
```

Die Demo-UI ist eine vollstaendige Vorschau mit Test-Daten.

## Deployment

**Firebase Functions:**
```bash
firebase deploy --only functions
```

**Browser-Extension:**
1. **Entwicklung**: `chrome://extensions` → „Entpackte Erweiterung laden"
2. **Production**: Chrome Web Store (muss vom Google-Konto aus hochgeladen werden)

**Firestore:**
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

**Web-App:**
- CSS + JS kopieren zu `nestbau-app/` (oder CDN-Link)
- HTML anpassen (oben unter "Web-App integrieren")
- Firebase-Konfiguration in der App ueberprüfen (Functions-Endpunkt stimmt ab)

## Konfiguration

**Anthropic API-Key** (MUSS gesetzt sein):
```bash
firebase functions:config:set anthropic.api_key="sk-ant-..."
firebase functions:config:get anthropic.api_key
```

**Clipper-Endpunkt** (in der Extension einstellbar):
- Standard: `https://europe-west1-nestbau-app.cloudfunctions.net/clipRecipe`
- Lokal (Emulator): `http://localhost:5001/nestbau-app/europe-west1/clipRecipe`

**App-URL** (in der Extension einstellbar):
- Standard: `https://nestbau-app.web.app`
- Lokal: `http://localhost:3000`

## Troubleshooting

**Extension sendet, aber Rezept erscheint nicht:**
1. Firestore Rules: `recipeImports`-Collection sichtbar?
2. Cloud Function-Logs: `firebase functions:log`
3. Anthropic API-Key konfiguriert?

**„Noch nicht mit Nestbau verbunden":**
1. Extension oeffnen, Zahnrad → Einstellungen
2. App-URL stimmt?
3. „Mit Nestbau verbinden" Button klicken
4. Nestbau oeffnet sich auf `clipper-connect.html` – dort auf Button klicken

**Bild wird nicht uebernommen:**
1. Alle Fehler-Logs gabs es? → `firebase functions:log | grep recipeImage`
2. Storage-Regeln: `households/{hid}/recipeImports/` erlaubt?
3. Dateigroesse < 8 MB?

**KI-Parser laeuft endlos:**
1. Anthropic API-Rate-Limit reached? (Dashboard pruefen)
2. Netzwerk-Timeout? (Function-Logs anschauen)
3. 30 Sekunden Timeout mit Fehlerbehandlung – normale Verarbeitung sollte < 10s sein

## Kosten

**Pro-Monat geschaetzt** (10 Importe pro Tag, 70% mit KI):

| Komponent | Kosten |
|-----------|--------|
| Anthropic API (Opus 5, Med-Effort) | ~ $2–4 |
| Firebase Functions | ~ $5–10 (Trigger + HTTP) |
| Firebase Storage | ~ $1–2 (Foto-Speicherung) |
| **Gesamt** | **~$8–16** |

## Roadmap (Ideen)

- [ ] Instagram Direct-Link → Caption auslesen ohne Extension
- [ ] Rezept-Vorschaubilder vor dem Uebernehmen
- [ ] Bestaetigte Importe als Feed sehen
- [ ] Rezept-Import-Analytics (beliebteste Quellen, Fehlerquoten)
- [ ] Batch-Import (ZIP mit mehreren Rezepten)
- [ ] API fuer externe Apps (Wordpress-Plugin, etc.)

---

**Version**: v1.0 (Production Ready)  
**Letztes Update**: 2026-09-03  
**Maintainer**: Claude Haiku 4.5
