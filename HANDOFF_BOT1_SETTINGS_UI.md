# Handoff: Bot 1 – Settings UI / OAuth / Deployment

**Für:** eine neue Claude-Session, die diesen Chat übernimmt
**Von:** Session vom 2026-09-05 bis 2026-09-12
**Branch:** `claude/bot-1-settings-ui-3voa7k` (kein offener PR)

---

## ⚠️ Wichtigste Lücke zuerst

Der ursprüngliche Auftragstext dieser Aufgabe lag als lokale Datei auf dem
Rechner der Nutzerin:
```
C:\KI Programme\Obsidion für Claud\Claude outputs\BOT_1_SETTINGS_UI.md
```
Diese Datei konnte in keiner der bisherigen Sessions gelesen werden – Claude
Code auf claude.ai läuft in einer isolierten Cloud-Umgebung ohne Zugriff auf
lokale Windows-Pfade oder die Obsidian-Vault der Nutzerin
(`MEMORY_INDEX.md`, `Regeln.md`, `Profil.md` etc.).

**Erste Aufgabe der neuen Session:** Nutzerin bitten, den Inhalt dieser Datei
per Copy-Paste oder Datei-Upload bereitzustellen, um die tatsächliche
Spezifikation für "Bot 1 Settings UI" gegenzuprüfen. Alles unten ist aus dem
Repo-Zustand und dem Chatverlauf rekonstruiert, nicht aus dem Originalauftrag.

---

## Repo-Zustand

- Branch `claude/bot-1-settings-ui-3voa7k` weicht von `main` nur um 2
  Doku-Commits ab (kein Funktionscode-Unterschied):
  - `6465a9c` – CSS-Link für Design-System gefixt + QA-Report
  - `4bbd515` – OAuth-Doku (Phase 3)
- Working tree sauber, alles gepusht.
- Kein Pull Request für diesen Branch vorhanden.

## Was bereits fertig aussieht

`js/nb-integrations-ui.js` implementiert die Settings-/Integrations-UI
vollständig:
- Kalender-Verbindungskarten (Google/Outlook): Status, Verbinden/Trennen,
  Kalenderauswahl, Fehleranzeige
- Abgleich-Einstellungen: Richtung, Kategorie, Sichtbarkeit, Auto-Sync-Intervall
- Cloud/Haushalt-Bereich: Google-Login, Haushalt anlegen/beitreten,
  Migration lokal → Cloud, Backup/Rollback, Beitrittscode-Anzeige

Projektfortschritt laut vorhandener Doku (`PHASE_3_STATUS.md`):

| Phase | Status |
|---|---|
| 1 – Design (warme Orange/Peach-Palette) | ✅ 100% |
| 2 – Firebase (Firestore, Functions) | ✅ 100% |
| 3 – OAuth (Google Calendar + Outlook) | 🟡 ~35% |
| 4 – Firebase Rules Deployment | ⏳ offen |
| 5 – QA-Testing | ⏳ offen |

## Offene Punkte für die neue Session

1. **Phase 3 – OAuth Client-IDs fehlen noch.**
   Code ist fertig (`js/nb-google-calendar.js`, `js/nb-outlook-calendar.js`,
   PKCE-Flow ohne Client Secret). Es fehlen von der Nutzerin:
   - Google OAuth Client ID (Google Cloud Console)
   - Outlook/Azure Client ID (Azure Entra ID App Registration)
   Anleitung dazu: `PHASE_3_OAUTH_SETUP.md`. Sobald vorhanden:
   `js/nb-config.local.js` anlegen (Datei ist in `.gitignore`, NICHT committen).

2. **Phase 4 – Firebase Rules Deploy: Status unbestätigt.**
   `firestore.rules` und `storage.rules` sind inhaltlich fertig und
   unverändert. Deploy-Befehl wurde der Nutzerin gegeben:
   ```bash
   firebase deploy --only firestore:rules,storage
   ```
   **Wichtig:** Dieser Deploy kann NICHT aus einer Claude-Code-Cloud-Session
   ausgeführt werden – der Login-Versuch (`firebase login --no-localhost`)
   scheiterte an der Netzwerk-Policy der Sandbox:
   ```
   Error: Failed to start login: Failed to make request to https://auth.firebase.tools/attest
   ```
   Firebase-Deploys müssen also der Nutzerin lokal überlassen werden – nicht
   erneut versuchen, das in einer Cloud-Session zu automatisieren.
   Bei Sessionstart nachfragen, ob der Deploy inzwischen gelaufen ist.

3. **Phase 5 – QA-Testing:** noch nicht begonnen (Offline-Modus,
   Kalender-Sync, Dark Mode, Responsive Design). `QA_VALIDATION_REPORT.md`
   deckt bisher nur die Design-Phase ab.

4. **Kein PR** für den Branch vorhanden – falls einer gewünscht ist, vorher
   mit der Nutzerin klären (nicht automatisch anlegen).

## Umgebungs-Einschränkungen, die für die neue Session relevant sind

- Diese Claude-Code-Session läuft remote/cloud, **kein Zugriff auf lokale
  Windows-Dateien oder Obsidian-Vault** der Nutzerin.
- Ausgehender Netzwerkzugriff läuft über einen Proxy mit eingeschränkter
  Policy – externe Auth-Flows wie `firebase login` funktionieren nicht.
- Falls die Nutzerin nach dem Obsidian-Vault-Workflow fragt (siehe ihre
  Präferenzen zu `MEMORY_INDEX.md`/`Regeln.md`/`Profil.md`): Diese Dateien
  müssen ihr manuell eingefügt werden, sie können nicht automatisch gelesen
  werden.

---

**Letzter Chat-Stand:** Nutzerin wollte diesen Chat schließen, ein anderer
Chat übernimmt. Dieses Dokument ist der Übergabepunkt.
