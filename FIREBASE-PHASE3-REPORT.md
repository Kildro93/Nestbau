# Firebase Phase 3 – Bericht

Stand: 2026-09-12 · Branch `claude/firebase-nestbau-setup-r2ierd`

---

## 1. Kurzfassung

Der Auftrag war, das Firebase-Backend zu konfigurieren und zu testen. Was im
Repository liegt, ist jetzt erledigt und mit den Emulatoren geprueft. Was in
der Firebase Console, der Google Cloud Console und im Azure Portal passiert,
ist es nicht – dafuer braucht es einen angemeldeten Browser. Abschnitt 6
listet diese Schritte einzeln auf.

Diese Runde bringt vor allem **Regeltests**, wo bisher keine waren, und
schliesst drei Luecken in den Regeln. Ausserdem faellt ein toter Prototyp weg.

## 2. Warum es Regeltests gibt

Am 8. September wurde in `firestore.rules` nachgetragen, dass `lists`, `events`
und `subscriptions` erlaubt sind (Commit `76cd20e`). Vorher fielen sie in den
Auffangblock `allow read, write: if false` am Ende der Datei – der Sync haette
nur fuer das Kochbuch funktioniert, Aufgaben, Termine und Finanzen waeren mit
`permission-denied` gescheitert.

Der Fehler war unsichtbar, bis jemand ihn von Hand suchte:

- Die Regeln sind syntaktisch fehlerfrei. Nichts warnt.
- Firestore schreibt offline in eine Warteschlange. Die Ablehnung kommt erst
  beim Reconnect, ohne Bezug zur ausloesenden Aktion.
- Ein Teil der App funktionierte weiter, was den Verdacht eher ablenkt.

Genau diese Klasse von Fehler faengt ein Test in Sekunden. `npm run test:rules`
geht jetzt ueber **alle** Sammlungen aus `NB.cloud.COLLECTIONS` und prueft fuer
jede: beide Partner duerfen lesen und schreiben, Fremde und Nichtangemeldete
nicht.

> **Wenn du eine neue Sammlung einfuehrst:** in `firestore.rules` freigeben
> **und** in `tests/rules/firestore-rules.mjs` in `MEMBER_COLLECTIONS`
> eintragen. Sonst wiederholt sich der September.

## 3. Was diese Runde aendert

### 3.1 Regeltests (neu)

`tests/rules/` – 38 Tests gegen die echten Emulatoren, ohne Netz und ohne
Firebase-Projekt:

```
ok 1 - Haushaltsdaten          ok 5 - Nutzerprofile
ok 2 - Beitritt                ok 6 - Alles andere
ok 3 - Sammlungen der Features ok 7 - Storage
ok 4 - Mitgliedereintraege
# tests 38   # pass 38   # fail 0
```

Die Dateien heissen bewusst `*-rules.mjs` und nicht `*.test.mjs`: `npm test`
faehrt ueber `tests/**/*.test.mjs` und soll ohne laufende Emulatoren
durchlaufen. Die bestehenden 43 Tests bleiben unberuehrt.

### 3.2 Drei Luecken in den Regeln

**Mitglieder konnten einander aussperren.** `allow update` auf
`households/{hid}` prueft, dass der Besitzer Besitzer bleibt – aber nicht, dass
`memberUids` niemanden verliert. Ein Mitglied konnte das andere aus der Liste
streichen und damit aus dem gemeinsamen Haushalt aussperren. Jetzt greift
`hasAll(resource.data.memberUids)`; zum Entfernen gibt es eine eigene Regel,
die nur der Besitzer erfuellt – und auch er kann sich nicht selbst
herausloeschen.

**`firestore.get()` in `storage.rules` brach ab, statt abzulehnen.** Fehlte das
Haushaltsdokument, lieferte der Aufruf `null` und die Auswertung endete in einer
`EvaluationException`. Ein `firestore.exists()` steht jetzt davor. Abgelehnt
wurde vorher auch – aber als Fehler, nicht als Entscheidung.

**`users/{uid}` war nicht vorgesehen.** Profile sind jetzt geregelt: nur das
eigene Konto liest und schreibt, kein `list`, und die `uid` im Dokument bleibt
fest.

Beim Schreiben der Tests fiel dabei eine Falle auf, die es wert ist, notiert zu
werden: `match /{sub=**}` innerhalb von `users/{uid}` trifft auch **null
Segmente** und damit das Profildokument selbst – die Regel „uid bleibt fest"
waere ausgehebelt gewesen. Es steht deshalb `match /{sub}/{rest=**}` dort, was
mindestens ein Segment verlangt. Im Console-Playground waere das kaum
aufgefallen.

### 3.3 Storage-Emulator auf 9199

`firebase.json` und `js/nb-firebase.js` hatten den Storage-Emulator auf Port
**5000**. Das ist der Port von Firebase Hosting – sobald Hosting dazukommt,
kollidieren die beiden. Jetzt ueberall 9199, der Standardport.

### 3.4 Der Bridge-Prototyp ist weg

Geloescht: `firebase-bridge.html`, `src/firebase-config.js`,
`src/nestbau-data.js`.

Warum: `src/firebase-config.js` enthielt einen `apiKey` aus Bullet-Zeichen –
kein gekuerzter echter Key, sondern ein unbrauchbarer Platzhalter. Auf die
Datei zeigte nur `firebase-bridge.html`, auf die wiederum nichts zeigte;
`src/nestbau-data.js` lud niemand. Gleichzeitig stand die Bridge in der
Kopierliste von `tools/build-web.js` und wanderte damit ins Android-Bundle.

Mit ihr verschwinden auch: ein zweites Firebase-SDK (11.0.2 modular neben
10.14.1 compat, ohne gemeinsamen Zustand) und elf `httpsCallable`-Verweise auf
Cloud Functions, die es in `functions/index.js` nie gab – ein Aufruf waere in
`functions/not-found` gelaufen.

**Die Konfiguration der echten App aendert sich dadurch nicht.** `index.html`
liest `js/nb-config.js` und ueberschreibt sie mit `js/nb-config.local.js` –
gitignored, per `onerror` abgefangen, vom Build ausgeschlossen. Neu ist nur
`js/nb-config.local.example.js` als Vorlage.

### 3.5 `.gitignore`

`*.local.*` haette jede `*.local.example.js` mitverschluckt. Eine Negation
steht jetzt daneben.

## 4. Firestore-Schema

```
users/{uid}                          – Profil, nur das Konto selbst
  └─ {sub}/…                         – Geraete-/Sync-Zustand

joinCodes/{code}                     – Nachschlagetabelle Code → Haushalt
  · householdId, ownerUid

households/{hid}                     – Vertrauensgrenze
  · name, ownerUid, joinCode, memberUids[], schemaVersion, createdAt
  │
  ├─ members/{uid}   · uid, email, name, role (owner|member), joinedAt
  │
  ├─ lists/{id}          – Aufgaben & Einkaeufe
  ├─ events/{id}         – Termine, auch importierte
  ├─ subscriptions/{id}  – Abos und Ausgaben
  │
  ├─ ingredients/{id}    ├─ recipes/{id}
  ├─ ingredientCategories/{id}  ├─ ingredientGroups/{id}
  ├─ dishCategories/{id} ├─ menuPlan/{JJJJ-MM-TT}
  └─ meta/{doc}          – Migrationsmarker
```

**Abweichung vom urspruenglichen Auftrag:** Der nannte `tasks`, `finances` und
`calendars`. Der Code schreibt `lists`, `events` und `subscriptions`, und die
Regeln folgen dem Code. Eine Umbenennung waere eine eigene Aufgabe – die
vorhandenen Dokumente muessten mitwandern, sonst sind die Daten unsichtbar.

**Zu den Indizes:** `firestore.indexes.json` bleibt, wie es ist. Der Client
stellt derzeit keine einzige zusammengesetzte Abfrage – er liest ganze
Sammlungen per `onSnapshot`. Indizes auf Vorrat kosten Schreibdurchsatz, ohne
etwas zu beschleunigen. Wenn Phase 4 echte Abfragen bringt, gehoeren sie dann
dazu.

## 5. Leitgedanke der Regeln

Der **Haushalt ist die Vertrauensgrenze**, nicht das einzelne Dokument. Wer in
`households/{hid}.memberUids` steht, darf die Daten dieses Haushalts lesen und
schreiben – Firestore *und* Storage schlagen an derselben Stelle nach.

Dass beide Partner jede Aufgabe abhaken duerfen, ist Absicht: `assignee`
steuert die Anzeige, nicht den Zugriff.

**Bewusst keine strenge Feldpruefung.** Die Regeln pruefen Zugehoerigkeit, kein
vollstaendiges Schema. Firestore stellt offline angelegte Schreibvorgaenge in
eine Warteschlange und spielt sie erst beim Reconnect ein – eine strenge
Feldpruefung wuerde sie **Stunden spaeter still verwerfen**. Genau das Verhalten,
das „Offline-Sync nicht blockieren" ausschliesst. Die Formpruefung gehoert in
die App.

## 6. Was noch zu tun ist (Console, nicht Code)

1. Firestore im **Production Mode** aktivieren, Region `europe-west`. Storage
   aktivieren.
   > Sammlungen muessen **nicht** von Hand angelegt werden – Firestore erzeugt
   > sie beim ersten Schreiben.
2. `cp js/nb-config.local.example.js js/nb-config.local.js`, Werte eintragen.
3. `npm run deploy:rules`
4. **Authentication → Sign-in method:** Email/Passwort, Google, Microsoft.
5. **Authentication → Settings → Authorized domains:** `localhost`, spaeter die
   echte Domain.
6. **Google Cloud Console → Anmeldedaten:** OAuth-Client (Web), Redirect-URI
   `http://localhost:3000/oauth-callback.html`. Client-ID nach
   `js/nb-config.local.js`. **Kein Secret ins Frontend.**
7. **Azure Portal → App-Registrierungen:** Plattform **Single-page
   application** – nur die erlaubt PKCE ohne Secret. Scopes
   `Calendars.ReadWrite`, `User.Read`, `offline_access`.
8. Erster Durchlauf: einloggen, Haushalt anlegen, Beitrittscode an die
   Partnerin, auf beiden Geraeten gegenpruefen.

### Zwei Redirect-URIs, die oft verwechselt werden

```
Anmeldung an Nestbau   → Firebase Auth  → https://<domain>/__/auth/handler
                                           (stellt Firebase bereit)
Kalender lesen         → OAuth 2.0 PKCE → https://<domain>/oauth-callback.html
                                           (js/nb-oauth.js:44)
```

Wer stattdessen eine Seite der App eintraegt, landet in
`redirect_uri_mismatch`.

Tokens fuer den Kalender liegen im `localStorage` – der uebliche Kompromiss
fuer SPAs. Konsequenz, die auch im Code steht: **keine fremden Skripte in
`index.html`**, denn wer dort Code einschleust, bekommt die Tokens.

## 7. Troubleshooting

| Symptom | Ursache | Abhilfe |
|---------|---------|---------|
| `permission-denied` auf einer Sammlung | Name fehlt in `firestore.rules` | freigeben **und** Test in `tests/rules/` ergaenzen |
| Schreiben klappt offline, verschwindet spaeter | Regel lehnt beim Reconnect ab | Emulator-Log lesen; Regeln nicht verschaerfen (Abschnitt 5) |
| `auth/unauthorized-domain` | Domain nicht freigegeben | Authentication → Settings → Authorized domains |
| `redirect_uri_mismatch` | falsche URI eingetragen | Abschnitt 6 |
| Auth funktioniert nicht ueber `file://` | Firebase braucht http(s) | `npm run serve` → http://localhost:3000 |
| Emulator wird nicht benutzt | Standard ist aus | `emulator: true` in `js/nb-config.local.js` |
| `Null value error` in storage.rules | Haushaltsdokument fehlt | behoben: `firestore.exists()` |
| Storage-Emulator startet nicht | Port 5000 = Hosting | behoben: 9199 |

### Befehle

```bash
npm run serve         # http://localhost:3000
npm run emulators     # Auth 9099, Firestore 8080, Storage 9199
npm test              # 43 Tests, ohne Emulatoren
npm run test:rules    # 38 Regeltests, startet die Emulatoren selbst
npm run deploy:rules  # Regeln + Indizes hochladen
```

## 8. Go / No-Go fuer Phase 4

**Bedingtes Go.** Die Regeln decken alle Features ab, sind getestet, und die
Luecken aus Abschnitt 3.2 sind zu. Phase 4 kann aber erst starten, wenn die
acht Schritte aus Abschnitt 6 erledigt sind – ohne Projekt und Credentials gibt
es nichts end-to-end zu testen. Geschaetzt eine knappe Stunde Console-Arbeit.

Was hier **nicht** geprueft werden konnte, weil es echte Konten braucht:
Login-Flow mit Google und Outlook, Sync gegen das echte Firestore,
Partner-Sync zwischen zwei Geraeten, der Uebergang offline → online. Die
Regeltests decken die Berechtigungslogik dieser Faelle ab, nicht das
Zusammenspiel mit den Anbietern.

Erster Test in Phase 4 sollte sein: **eine Aufgabe auf Geraet A anlegen und auf
Geraet B sehen.** Genau dieser Pfad war im September blockiert.
