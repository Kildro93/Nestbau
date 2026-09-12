# VERSIONING – Nestbau

Zwei Zahlen, zwei verschiedene Aufgaben. Sie zu verwechseln ist der häufigste
Grund, warum ein Play-Upload abgelehnt wird.

---

## Die zwei Zahlen

| | `versionCode` | `versionName` |
|---|---|---|
| Typ | Ganzzahl | Zeichenkette |
| Für wen | Google Play und Android | Menschen |
| Regel | Muss bei **jedem** Upload steigen | Semantic Versioning |
| Sichtbar | Nein | Ja (Store-Seite, Einstellungen) |
| Wiederverwendbar | **Nie** | Ja |
| Beispiel | `1` | `2.0.0` |

Beide stehen in **einer** Datei:

```properties
# android/version.properties
versionCode=1
versionName=2.0.0
```

`android/app/build.gradle` liest sie beim Build. Nirgendwo sonst steht eine
Versionsnummer – kein Nachziehen an mehreren Stellen, keine auseinanderlaufenden
Angaben.

> `package.json` führt ebenfalls ein `version`-Feld. Es ist für npm-Werkzeuge da
> und für den Android-Build ohne Bedeutung. `tools/bump-version.js` hält es
> trotzdem mit, damit beide Dateien dasselbe sagen.

---

## versionCode

Eine schlichte Zählnummer, hochgezählt bei jedem Upload in die Play Console –
auch bei einem verworfenen Testrelease. Google merkt sich jede jemals hochgeladene
Nummer; ein zweites Bundle mit `versionCode=3` wird abgelehnt, selbst wenn das
erste nie veröffentlicht wurde.

Deshalb: **keine Codierung hineinbauen** (nicht `20000` für 2.0.0). Sobald die
Zahl etwas bedeuten soll, gerät sie früher oder später in Konflikt mit der Regel
„immer größer als alles Bisherige". Einfach zählen.

## versionName

[Semantic Versioning](https://semver.org/lang/de/): `MAJOR.MINOR.PATCH`

| Teil | Wann | Beispiel |
|---|---|---|
| MAJOR | Umbau, der Nutzergewohnheiten oder Datenformat bricht | Datenmodell wechselt, Migration nötig |
| MINOR | Neue Funktion, alles Bisherige bleibt | Einkaufsliste aus dem Menüplan |
| PATCH | Fehlerbehebung, kein neues Verhalten | Falsche Summe in den Finanzen |

Vorabversionen mit Suffix: `2.1.0-beta.1`. Der Debug-Build hängt automatisch
`-debug` an, damit auf einem Testgerät sofort erkennbar ist, was läuft.

---

## Version anheben

```bash
node tools/bump-version.js patch   # 2.0.0 -> 2.0.1
node tools/bump-version.js minor   # 2.0.1 -> 2.1.0
node tools/bump-version.js major   # 2.1.0 -> 3.0.0
node tools/bump-version.js 2.5.0   # explizit
```

Der `versionCode` steigt dabei **immer** um eins, unabhängig von der Art des
Sprungs. Danach:

1. `CHANGELOG.md` ergänzen – der Text daraus wird zum Release-Hinweis im Store.
2. Bauen: `node tools/android-build.js release`
3. Committen und taggen:

```bash
git add android/version.properties package.json CHANGELOG.md
git commit -m "Release 2.0.1"
git tag v2.0.1
git push && git push --tags
```

Der Tag ist die Verbindung zwischen der Nummer im Store und dem Stand im
Repository. Ohne ihn lässt sich später nicht mehr sagen, welcher Code in einer
Version steckte.

---

## Verlauf

| versionName | versionCode | Datum | Track | Anmerkung |
|---|---|---|---|---|
| 2.0.0 | 1 | 2026-09-04 | – | Erster Android-Build, noch nicht hochgeladen |

Diese Tabelle bei jedem Upload fortschreiben. Sie ist die einzige Stelle, an der
sich nachlesen lässt, welcher `versionCode` in welchem Track gelandet ist – die
Play Console zeigt das nur eingeschränkt und nur online.

---

## Wenn etwas schiefgeht

**„Version code 1 has already been used."**
Der `versionCode` war schon einmal hochgeladen. Hochzählen und neu bauen; die
alte Nummer ist unwiederbringlich verbraucht.

**Ein fehlerhafter Release ist im Store.**
Ein Bundle lässt sich nicht zurückziehen und nicht ersetzen. Der Weg ist immer
vorwärts: Fehler beheben, `versionCode` hochzählen, neu hochladen. In der Play
Console lässt sich zusätzlich der Rollout des fehlerhaften Release stoppen
(„Rollout anhalten"), damit er keine weiteren Geräte erreicht.

**Ein Gerät bekommt die neue Version nicht.**
Play verteilt gestaffelt. Prüfen: Ist der Rollout-Prozentsatz kleiner als 100?
Ist das Gerät im richtigen Test-Track? Läuft dort ein Build mit einem *höheren*
`versionCode` als der neue? Android installiert grundsätzlich keine Version mit
niedrigerer Nummer über eine höhere.
