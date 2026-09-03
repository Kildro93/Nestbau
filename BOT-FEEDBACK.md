# Bot-Feedback — Play-Store-Bereitschaft Nestbau v2.0

**Stand:** 2026-09-03
**Geprüfter Commit:** `38d84e8` (main)
**Absender:** Build Optimizer & Play Store Manager

Dieses Dokument sagt anderen Bots, was zu tun ist. Alles hier ist mit
laufenden Prüfungen belegt, nicht geschätzt. Jeder Punkt nennt das Kommando,
mit dem sich das Ergebnis nachvollziehen lässt.

---

## Kurzfassung

Die App selbst ist **in gutem Zustand und Play-Store-tauglich**. Es gibt
keinen Code-Blocker.

Was den Upload blockiert, sind zwei Dinge **außerhalb des Codes**, die ein
Mensch erledigen muss. Kein Bot kann sie übernehmen.

---

## Was geprüft wurde — alles grün

| Prüfung | Ergebnis | Kommando |
|---|---|---|
| Test-Suite | 43/43 grün | `npm test` |
| Health-Check inkl. echtem Chromium | 11/11 grün | `npm run health:live` |
| Security-Check | 0 blockierende Befunde | `npm run audit:security` |
| Performance-Budgets | alle eingehalten | `npm run audit:perf` |
| Konsolenfehler im echten Browser | keine | `node scripts/capture-screenshots.mjs` |

Messwerte:

- **37,7 KB** gzip für die gesamte App (Budget 60 KB)
- **178 ms** Boot bis zur ersten Ansicht
- **≤ 6 ms** pro Tab-Wechsel
- **12 ms** um 200 Aufgaben zu rendern
- **0,34 %** des localStorage-Limits bei 200 Aufgaben

Die App braucht **keine** Performance-Optimierung. Wer hier etwas „verbessert",
riskiert nur Regressionen.

---

## BLOCKER 1 — Die App ist nicht öffentlich erreichbar

**Wer:** ein Mensch mit Repo-Rechten. **Nicht automatisierbar.**

Eine TWA lädt die App von einer öffentlichen HTTPS-URL. `localhost`
funktioniert nicht. Ohne diesen Schritt lässt sich kein brauchbares AAB bauen.

**Zu tun:** Repo-Einstellungen → **Settings → Pages → Source: „GitHub Actions"**

Der Workflow liegt bereit: `.github/workflows/pages.yml`. Er veröffentlicht
bei jedem Push auf `main` nach `https://kildro93.github.io/Nestbau/`.

Prüfen:
```bash
curl -sI https://kildro93.github.io/Nestbau/manifest.json
```

### Nachgelagerte Falle — bitte nicht übersehen

Android sucht `assetlinks.json` **immer in der Domain-Wurzel**, nie im
Projektpfad. Bei `kildro93.github.io/Nestbau/` muss die Datei also nach
`https://kildro93.github.io/.well-known/assetlinks.json`.

Das geht nur über ein Repo namens `kildro93.github.io` oder eine eigene
Domain. Details in [PLAY-STORE.md](PLAY-STORE.md).

Wer das übersieht, baut ein AAB, das installiert — aber die App zeigt die
Adressleiste und fällt in der Review durch.

---

## BLOCKER 2 — Es gibt keinen Signaturschlüssel

**Wer:** ein Mensch. **Kein Bot darf das tun** — hier werden Passwörter
vergeben, und der Schlüssel ist unwiederbringlich.

```bash
mkdir android
keytool -genkeypair -v -storetype PKCS12 -keystore android/upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Danach:

```bash
keytool -list -v -keystore android/upload-keystore.jks -alias upload
node scripts/make-assetlinks.mjs <SHA256 aus der Ausgabe>
```

**An alle Bots:** `android/`, `*.jks`, `*.keystore` sind gitignored. Wer
einen Keystore commitet, macht ihn öffentlich und damit wertlos — dann ist
die Store-Identität der App kompromittiert. Bitte nie einchecken.

---

## Was Bots übernehmen können

### 1. Foto-Data-URLs landen ungefiltert in `src="…"`

**Stufe:** niedrig — kein Store-Blocker, aber sauber zu beheben.

Belegt durch `npm run audit:security`. Betroffene Stellen in `index.html`:

| Zeile | Ausdruck |
|---|---|
| 1959 | `dataUrl` |
| 2079 | `ing.photo` |
| 2389 | `dataUrl` |
| 2446 | `r.photo` |
| 2748 | `r.photo` |

Diese Werte werden per String-Verkettung in ein `src="…"`-Attribut
geschrieben. Enthält der Wert selbst ein `"`, bricht er aus dem Attribut aus.

**Praktisch relevant beim Import einer präparierten Sicherungsdatei** — der
einzige Weg, wie ein fremder Wert in diese Felder kommt. Aus der Kamera
stammen die Werte aus `canvas.toDataURL()` und sind immer sauber.

**Fix:** Die betroffenen Werte durch `escapeHtml()` schicken, so wie es die
19 anderen `innerHTML`-Stellen im Code bereits tun. Die Funktion existiert
(`index.html:1004`).

Danach muss `npm run audit:security` diese Befunde nicht mehr melden.

### 2. Datenschutzerklärung als Seite bereitstellen

Play verlangt eine öffentlich erreichbare URL. Inhaltlich ist der Fall
einfach und in [PLAY-STORE.md](PLAY-STORE.md) unter *Datensicherheit* schon
ausformuliert: Die App erhebt nichts, überträgt nichts, hat keine
Netzwerkaufrufe.

**Zu tun:** `privacy.html` anlegen, in `pages.yml` beim Kopieren mitnehmen,
URL in der Play Console eintragen.

### 3. Screenshots nach inhaltlichen Änderungen neu aufnehmen

Die Store-Screenshots zeigen Demo-Daten. Wer die Oberfläche ändert, nimmt sie
neu auf:

```bash
node scripts/capture-screenshots.mjs
node scripts/capture-screenshots.mjs --dark
```

Das Skript ist zugleich ein Smoke-Test: Es bricht ab, wenn im echten Browser
ein Konsolenfehler auftritt.

---

## Regeln für alle Bots, die an diesem Repo arbeiten

**Vor jedem Commit:**

```bash
npm run ci
```

Das ist Health-Check + Tests + Security + Performance in einem Lauf. Läuft es
nicht durch, gehört der Stand nicht ins Repo.

**Wenn `icon.svg` geändert wird**, müssen die abgeleiteten PNGs mit:

```bash
npm run playstore:assets && npm run playstore:build -- --check
git add assets manifest.json
```

Die CI prüft das und schlägt fehl, wenn die eingecheckten Icons nicht mehr
zur Quelle passen.

**Wenn Markup in `index.html` geändert wird:** `tests/unit/structure.test.mjs`
prüft, dass jede per `getElementById` angesprochene ID auch existiert. Das ist
in einer Single-File-App die häufigste Fehlerquelle — eine umbenannte ID wird
zur Laufzeit still zu `null`.

**Nicht anfassen ohne Grund:**

- Die Performance-Budgets in `scripts/perf-audit.mjs`. Sie sind aktuell mit
  großem Abstand eingehalten. Wer sie hochsetzt, verdeckt Regressionen.
- `targetSdkVersion: 35` in `twa-manifest.json`. Play verlangt das seit
  August 2025; niedriger wird abgelehnt.
- Die `.gitignore`-Einträge für Keystore und Build-Artefakte.

---

## Ein Hinweis zum Arbeitsstand

Neben diesem Repo liegt lokal `C:\KI Programme\nestbau-app` — eine
**neuere, nicht gepushte Fassung** mit Funktionen, die es hier nicht gibt:
OAuth-Anbindung an Google- und Outlook-Kalender sowie eine Cloud-Ablage fürs
Kochbuch (`js/`, `oauth-callback.html`, beide uncommitted).

Das ist relevant, weil es die Store-Angaben umkehrt:

- **Diese Fassung** hat keine Netzwerkaufrufe. Datensicherheit: alles „nein".
- **Jene Fassung** überträgt Daten an Google und Microsoft. Sie braucht eine
  echte Datenschutzerklärung, OAuth-Verifizierung und andere Angaben im
  Play-Datensicherheitsformular.

**Wer entscheidet, welche Fassung in den Store geht, entscheidet damit auch
über den gesamten Compliance-Aufwand.** Diese Prüfung bezieht sich
ausschließlich auf den Stand in diesem Repo.

---

## Zum Nachlesen

| Datei | Inhalt |
|---|---|
| [PLAY-STORE.md](PLAY-STORE.md) | vollständiger Weg zum Upload, Store-Texte, Datensicherheit |
| `reports/latest.json` | maschinenlesbarer Stand aller Prüfungen |
| `reports/report-*.md` | ausführlicher Bericht mit allen Ausgaben |

Bericht neu erzeugen:

```bash
npm run report
```
