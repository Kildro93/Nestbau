# Nestbau v2.0 – Architekturentscheidungen

## Firestore statt Realtime Database

Empfehlung: **Firestore**, die Realtime Database gar nicht erst aktivieren.

- Nestbau fragt gefiltert ab: Rezepte einer Kategorie, Termine einer Woche, Aufgaben
  einer Person. Die RTDB kann pro Abfrage nur nach einem Kind sortieren/filtern –
  alles Weitere müsste im Client passieren, also nach dem Herunterladen.
- Die Security Rules der RTDB kaskadieren: wer Lesezugriff auf einen Knoten hat, hat
  ihn auf alles darunter. Das Trennen von privaten Gesundheitsdaten und geteilten
  Haushaltsdaten wird damit unnötig fummelig.
- Firestore rechnet nach gelesenen Dokumenten ab, die RTDB nach übertragenen Bytes.
  Ein Kochbuch mit Bildern liest man selten ganz, aber oft teilweise – das spricht
  für Firestore.
- Offline-Persistenz gibt es in beiden; in Firestore mit Query-Unterstützung.

Der Setup-Guide nennt eine `databaseURL` in der Config. Die ist hier bewusst nicht
gesetzt: sie zeigt auf die RTDB und wird nicht gebraucht.

## Alles hängt am Haushalt

```
households/{hid}/
  members/{uid}          lists/{listId}/items/{itemId}
  invites/{inviteId}     events/{eventId}
  recipes/{recipeId}     subscriptions/{subId}
  ingredients/{ingId}    menuPlan/{YYYY-MM-DD}
  ingredientCategories/  ingredientGroups/  dishCategories/
  calendarEvents/{id}
```

Alternative wäre gewesen: alle Kollektionen auf oberster Ebene mit einem Feld
`householdId`. Das ist schlechter, weil dann jede einzelne Regelauswertung erst
das Dokument lesen muss, um zu wissen, zu welchem Haushalt es gehört – und weil ein
vergessener `where('householdId', ...)`-Filter sofort fremde Daten mitliest. Mit
Unterkollektionen steckt die Zugehörigkeit im Pfad.

Menüplan als ein Dokument pro Tag statt ein grosses Dokument pro Woche oder Monat:
so bleiben gleichzeitige Änderungen von zwei Personen konfliktfrei, und die
Wochenansicht ist eine Range-Query über sieben Dokument-IDs.

Rezeptzutaten liegen eingebettet im Rezept, nicht als Unterkollektion. Ein Rezept
wird immer vollständig gelesen; eine Unterkollektion wären pro Rezept 5–15
zusätzliche Reads.

## Rollen: Claim zuerst, Lookup als Fallback

Die Rules prüfen die Mitgliedschaft in dieser Reihenfolge:

1. `request.auth.token.hh[hid]` – ein Custom Claim, gesetzt von `setHouseholdClaims()`
   bei Erstellung, Beitritt, Rollenwechsel und Austritt. Kostet nichts.
2. Wenn der Claim fehlt: `get(/households/{hid})`. Das ist ein abgerechneter
   Dokument-Read pro Regelauswertung.

Der Fallback ist nötig, weil ein ID-Token bis zu einer Stunde alt sein darf. Nach
dem Beitritt ruft der Client `refreshClaims()` auf, danach greift wieder Pfad 1.

## Datenschutz

Die Anforderung war „Allergien sind privat". Umgesetzt in drei Stufen:

- **Gesundheitsdaten** (Alter, Grösse, Gewicht, Fitnesslevel, Allergien) liegen unter
  `users/{uid}/private/health`. Die Rules erlauben dort ausschliesslich dem Besitzer
  Zugriff – auch Haushalts-Admins kommen nicht heran. Getestet in `tests/rules.test.js`.
- **Freigabe ist opt-in.** Setzt jemand `shareAllergiesWithHousehold: true`, spiegelt
  `syncAllergyMirror` genau ein Feld – die Allergen-IDs – nach
  `households/{hid}/members/{uid}.sharedAllergyIds`. Gewicht, Alter und Fitnesslevel
  werden nie gespiegelt.
- **Warnungen funktionieren trotzdem ohne Freigabe.** `checkMenuPlanAllergies` rechnet
  serverseitig mit dem Admin SDK und schreibt das Ergebnis ausschliesslich in das
  private Postfach der betroffenen Person. Der Rest des Haushalts erfährt nichts.

OAuth-Tokens stehen in `secureTokens/{uid}_{provider}`, AES-256-GCM verschlüsselt,
Schlüssel im Secret Manager. Für Clients ist die Kollektion per Rules komplett
gesperrt (`allow read, write: if false`). Das Frontend sieht nie ein Token: es
schickt den Authorization Code an `connectCalendar`, alles Weitere passiert im
Backend. Beim Trennen wird das Refresh Token beim Anbieter widerrufen, nicht nur
lokal gelöscht.

Email-Verifikation ist Pflicht für jeden Zugriff auf Haushaltsdaten
(`request.auth.token.email_verified == true`). Ein nicht bestätigtes Konto kann sich
anmelden, sieht aber nichts.

## Cloud Functions

| Function | Auslöser | Zweck |
|---|---|---|
| `onUserCreated` | Auth | Basisdokumente anlegen, Verifikationsmail senden |
| `onUserDeleted` | Auth | Daten, Tokens, Bilder, Mitgliedschaften entfernen |
| `resendVerificationEmail` | Callable | erneut senden, gesperrt auf 1×/Minute |
| `updateDisplayProfile` | Callable | Name/Farbe/Bild, in alle Haushalte gespiegelt |
| `deleteAccount` | Callable | Konto löschen, blockiert den letzten Admin |
| `createHousehold` | Callable | Haushalt inkl. Standardlisten und Zutatenkategorien |
| `inviteToHousehold` | Callable | Einladung mit gehashtem Token, 7 Tage gültig |
| `acceptInvite` | Callable | transaktional beitreten, Claims setzen |
| `revokeInvite`, `setMemberRole`, `removeMember` | Callable | Verwaltung |
| `validateUpload` | Storage | Typ, Grösse und Pfad prüfen, sonst löschen |
| `onRecipeDeleted`, `onIngredientDeleted` | Firestore | Bilder mit aufräumen |
| `aggregateRecipeAllergens` | Firestore | Allergene aus Zutaten ins Rezept |
| `syncAllergyMirror` | Firestore | opt-in Spiegel der Allergene |
| `checkMenuPlanAllergies` | Firestore | private Warnung bei Konflikt |
| `connectCalendar`, `disconnectCalendar` | Callable | OAuth-Tausch und Widerruf |
| `cleanupExpiredInvites`, `pruneNotifications`, `purgeOrphanedHouseholds` | Zeitplan | Wartung |

Region durchgehend europe-west1, `maxInstances: 10` als Kostenbremse.

Der Einladungslink enthält ein zufälliges Token; in Firestore steht nur dessen
SHA-256-Hash. Wer die Datenbank lesen könnte, käme damit trotzdem nicht in einen
fremden Haushalt. Zusätzlich muss die Email-Adresse des Annehmenden zur Einladung
passen.

## Performance und Kosten

Was tatsächlich Geld kostet, sind Dokument-Reads. Die Massnahmen dagegen:

- **Offline-Cache** (`persistentLocalCache` mit Multi-Tab). Wiederholte Abfragen
  werden aus dem Cache bedient, `onSnapshot` liest beim Start aus dem Cache und holt
  nur die Änderungen nach.
- **Menüplan nur für den sichtbaren Zeitraum abonnieren** (`subscribeMenuPlan`).
  Ein Jahr wären 365 Dokumente, sichtbar sind 7 oder 31.
- **Denormalisierte Anzeigedaten** in `households/{hid}/members/{uid}`: eine Liste mit
  20 Aufgaben rendert die Namen ohne 20 Nachladevorgänge.
- **Claims statt Lookups** in den Rules, siehe oben. Ohne Claim kostet jede
  Regelauswertung auf Haushaltsdaten einen zusätzlichen Read.
- **`getAll()` statt Schleifen** in den Functions (`aggregateRecipeAllergens`,
  `checkMenuPlanAllergies`): ein Roundtrip statt n.
- **Index-Ausnahmen** in `firestore.indexes.json` für `steps`, `prep`, `ingredients`,
  `vitamins`, `notes`. Nach diesen Feldern wird nie sortiert oder gefiltert; ohne
  Ausnahme legt Firestore für jedes Array-Element einen Indexeintrag an – das kostet
  Speicher und macht jeden Schreibvorgang teurer.
- **Bilder mit `Cache-Control: private, max-age=604800`**, gesetzt von `validateUpload`.

Für zwei Personen liegt der Verbrauch damit deutlich im kostenlosen Kontingent
(50 000 Reads/Tag). Realistischer Treiber wären versehentliche Endlos-Listener –
deshalb gibt `subscribeHousehold()` eine Aufräumfunktion zurück, die beim
Abmelden aufgerufen werden muss.

Zusätzlich in der Console setzen: Abrechnung → Budget mit Benachrichtigung ab
etwa 5 CHF. Das ist die einzige wirksame Bremse, falls doch etwas ausser Kontrolle
gerät.

## Bewusst offen gelassen

- **Push-Benachrichtigungen** (Cloud Messaging): nicht aktiviert. Die Allergie-Hinweise
  landen in `users/{uid}/notifications`; die App kann sie beim Öffnen anzeigen. Push
  wäre ein eigener Schritt inkl. Service-Worker-Anpassung.
- **Volltextsuche** über Rezepte: derzeit Präfixsuche über `titleLower`. Für mehr
  bräuchte es einen externen Dienst – bei ein paar hundert Rezepten unnötig.
- **Zwei-Faktor-Authentifizierung**: erfordert Identity Platform (kostenpflichtig).
  Für einen Zwei-Personen-Haushalt ist der Nutzen gering.
- **Bidirektionaler Kalender-Sync**: die Struktur (`calendarEvents` mit `etag`) ist
  vorbereitet, `syncDirection` steht auf `read`. Schreiben in fremde Kalender braucht
  weitere Scopes und gehört zu Bot 3.
