# Firebase – Einrichtung

## Wie die App an Firebase kommt

Die App ist `index.html`. Sie laedt ihre Konfiguration in dieser Reihenfolge:

```
js/nb-config.js          – Vorgaben, im Repository, ohne Werte
js/nb-config.local.js    – deine Werte, per .gitignore ausgeschlossen
```

Fehlt die zweite Datei, faengt `index.html` das ab und laeuft rein lokal
weiter (localStorage). Cloud, Google- und Outlook-Kalender bleiben dann aus –
die App funktioniert trotzdem.

## Einrichten

```bash
cp js/nb-config.local.example.js js/nb-config.local.js
```

Dann die Werte eintragen:

| Wert | Woher |
|------|-------|
| `firebase.*` | Firebase Console → Projekteinstellungen → Meine Apps → SDK-Konfiguration |
| `google.clientId` | Google Cloud Console → APIs & Dienste → Anmeldedaten → OAuth-Client-ID (Web) |
| `outlook.clientId` | Azure Portal → Entra ID → App-Registrierungen → Anwendungs-(Client-)ID |

**Keine Client-Secrets eintragen.** Nestbau ist ein oeffentlicher OAuth-Client
und nutzt ausschliesslich PKCE (`js/nb-oauth.js`). Ein Secret im Frontend waere
fuer jeden Besucher lesbar.

Der Firebase-`apiKey` ist dagegen kein Geheimnis – er identifiziert nur das
Projekt. Der Schutz kommt vollstaendig aus `firestore.rules` und
`storage.rules`.

## Starten

Firebase Auth funktioniert nicht ueber `file://`. Die App braucht http(s):

```bash
npm run serve        # http://localhost:3000
```

Die Domain muss in der Firebase Console unter
*Authentication → Settings → Authorized domains* eingetragen sein – fuer die
lokale Entwicklung also `localhost`.

## Gegen die Emulatoren testen

Standardmaessig spricht auch `localhost` mit dem **echten** Projekt. Das ist
Absicht. Fuer die lokale Suite in `js/nb-config.local.js` setzen:

```js
NB.configure({ firebase: { emulator: true } });
```

```bash
npm run emulators    # Auth 9099, Firestore 8080, Storage 9199
```

## Regeln

```bash
npm run test:rules     # 37 Regeltests gegen die Emulatoren, ohne Netz
npm run deploy:rules   # firestore:rules, firestore:indexes, storage
```

Wer eine neue Firestore-Sammlung einfuehrt, muss sie in `firestore.rules`
freigeben **und** in `tests/rules/firestore-rules.mjs` in die Liste
`MEMBER_COLLECTIONS` eintragen. Sonst faellt sie in den Auffangblock am Ende
der Regeln und der Sync scheitert erst beim Schreiben – wie im September 2026
bei `lists`, `events` und `subscriptions` geschehen.

## Weiteres

- `FIREBASE-ARCHITECTURE.md` – Datenmodell und Aufbau
- `FIREBASE-PHASE3-REPORT.md` – Stand der Einrichtung, offene Console-Schritte,
  Troubleshooting
