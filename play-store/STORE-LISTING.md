# Play Store – Eintrag für Nestbau

Alles, was in der Play Console in ein Feld kopiert werden muss. Die Zeichenlimits
stehen dabei, weil die Console beim Überschreiten abschneidet statt zu warnen.

Der Text beschreibt die App **so, wie sie im aktuellen Build tatsächlich läuft**:
vollständig lokal, ohne Konto, ohne Datenübertragung. Kalender-Abgleich und
Cloud-Sync sind im Code vorhanden, im ausgelieferten APK aber nicht aktiv
(siehe `BUILD-GUIDE.md`, Abschnitt 7). Werden sie freigeschaltet, müssen dieser
Text, die Datenschutzerklärung **und** der Data-Safety-Fragebogen nachgezogen
werden.

---

## App-Name

*Max. 30 Zeichen*

```
Nestbau – Haushalt Manager
```

26 Zeichen.

---

## Kurzbeschreibung

*Max. 80 Zeichen. Steht direkt unter dem Namen und entscheidet über den Klick.*

```
Intelligente Haushalts-App für 2 Personen
```

41 Zeichen.

<details>
<summary>Alternativen, falls „intelligent" zu unbestimmt wirkt</summary>

```
Aufgaben, Kalender, Finanzen und Kochbuch – für zwei, ohne Konto
```
63 Zeichen. Nennt den Inhalt statt eines Adjektivs.

```
Haushalt zu zweit organisieren – offline, ohne Konto, ohne Werbung
```
65 Zeichen. Stellt das heraus, was die App von den meisten Mitbewerbern trennt.

</details>

---

## Vollständige Beschreibung

*Max. 4000 Zeichen. Die ersten drei Zeilen sind vor dem „Weiterlesen" sichtbar.*

```
Nestbau bündelt, was ein Zweipersonenhaushalt täglich braucht: Aufgaben,
Termine, Fixkosten und das Kochbuch. Alles in einer App, alles auf dem Gerät –
ohne Konto, ohne Anmeldung, ohne Werbung.

━━━━━━━━━━━━━━━━━━━━━━━━━━

HEUTE
Der Tagesüberblick: was ansteht, wer dran ist, was gekocht wird. Eine Ansicht
statt fünf.

AUFGABEN & LISTEN
Fünf Listen ab Werk – Aufgaben, Einkäufe, Geschenke, Haushalt, Arbeit – und
beliebig viele eigene. Jede Aufgabe lässt sich einer Person zuweisen oder als
gemeinsam markieren. Die Wochenübersicht zeigt auf einen Blick, was liegen
geblieben ist.

KALENDER
Woche und Monat, farbig nach Kategorie: Privat, Schule, Arbeit, Haushalt,
Wichtig. Termine mit Ort, Erinnerung und Wiederholung. Zu einem Termin lassen
sich direkt Aufgaben anlegen – der Elternabend bringt die Vorbereitung gleich
mit.

FINANZEN
Fixkosten und Abos an einem Ort: monatlich, vierteljährlich, halbjährlich oder
jährlich. Nestbau rechnet daraus die Monatsbelastung und zeigt, was auf wen
entfällt. Beträge in Schweizer Franken.

KOCHBUCH
Zutaten mit Nährwerten, Rezepte mit Zubereitung und Menüplan für die Woche.
Aus dem Plan entsteht die Einkaufsliste auf Knopfdruck, nach Ladenbereichen
sortiert. Die Nährwerte eines Tages rechnet die App aus den geplanten Mahlzeiten
zusammen. Zu Rezepten und Zutaten lassen sich Fotos aufnehmen.

━━━━━━━━━━━━━━━━━━━━━━━━━━

OFFLINE, WEIL ES DAZUGEHÖRT
Nestbau braucht kein Netz. Nicht beim ersten Start, nicht im Keller, nicht im
Zug. Alle Daten liegen auf dem Gerät; die App startet und arbeitet vollständig
ohne Verbindung.

ZWEI PROFILE
Beim Start wird gewählt, wer gerade davorsitzt. Aufgaben und Termine lassen sich
dadurch persönlich, gemeinsam oder für die andere Person führen – ohne getrennte
Konten und ohne zweites Gerät.

DEINE DATEN BLEIBEN DEINE
Kein Konto. Keine Registrierung. Keine Werbung. Kein Tracking. Keine Analyse.
Nestbau überträgt nichts an uns oder an Dritte, weil es nichts zu übertragen
gibt: die Daten verlassen das Gerät nicht.

SICHERUNG IN EINER DATEI
Der gesamte Bestand – Listen, Termine, Finanzen, Rezepte – lässt sich als
JSON-Datei sichern und ebenso wieder einlesen. Für den Gerätewechsel, oder
einfach, um beruhigt zu sein. Kein fremder Dienst dazwischen.

━━━━━━━━━━━━━━━━━━━━━━━━━━

FÜR WEN
Für zwei Menschen, die einen Haushalt teilen und dafür keine Plattform mit
Abo-Modell wollen. Die Beträge sind in Schweizer Franken angelegt.

Nestbau ist ein privates Projekt. Keine Firma dahinter, keine Investoren, kein
Interesse an Daten.
```

Rund 2 300 Zeichen.

---

## Grafiken

| Datei | Größe | Wofür |
|---|---|---|
| `icon-512.png` | 512×512 | App-Symbol. PNG ohne Transparenz – Play weist Alpha-Kanäle zurück |
| `feature-graphic-1024x500.png` | 1024×500 | Kopfgrafik der Store-Seite |
| `screenshots/01-login.png` | 1080×1920 | Profilauswahl |
| `screenshots/02-aufgaben.png` | 1080×1920 | Aufgaben und Listen |
| `screenshots/03-kalender.png` | 1080×1920 | Kalender |
| `screenshots/04-kochbuch.png` | 1080×1920 | Rezepte |
| `screenshots/05-heute.png` | 1080×1920 | Tagesüberblick |
| `screenshots/06-finanzen.png` | 1080×1920 | Fixkosten |

Alle Screenshots stammen aus der laufenden App (`node tools/screenshots.js`) und
zeigen echte Ansichten mit echten Inhalten – keine Montagen, keine Attrappen.
Play verlangt mindestens zwei, erlaubt bis zu acht.

**Reihenfolge in der Console:** 02 (Aufgaben), 03 (Kalender), 05 (Heute),
04 (Kochbuch), 06 (Finanzen), 01 (Profilauswahl). Das erste Bild wird am
häufigsten gesehen und sollte den Nutzen zeigen, nicht den Einstieg.

---

## Einstufung

| Feld | Wert |
|---|---|
| Kategorie | Produktivität |
| Tags | Aufgabenverwaltung, Kalender, Finanzen, Rezepte |
| Preis | Kostenlos |
| In-App-Käufe | Nein |
| Werbung | Nein |
| Inhaltseinstufung | Alle Altersgruppen (Fragebogen: keine Gewalt, keine Nutzerkommunikation, keine Käufe, kein Standort) |
| Zielgruppe | 18+ |
| Länder | Schweiz, Deutschland, Österreich |
| Sprache | Deutsch (de-DE) |

> **Zur Länderauswahl:** Beträge sind in der App fest auf Schweizer Franken
> gesetzt, inklusive Rundung auf 5 Rappen (`fmtMoney` in `index.html`). Der
> Finanzbereich passt damit auf die Schweiz. Für den deutschen und
> österreichischen Markt wäre eine wählbare Währung die ehrlichere Lösung –
> bis dahin ist es besser, das im Store-Text zu benennen (ist oben geschehen),
> als es zu verschweigen.

---

## Data Safety

Der Fragebogen ist keine Formsache – Google gleicht die Antworten mit dem
tatsächlichen Verhalten der App ab.

Für den aktuellen Build:

| Frage | Antwort |
|---|---|
| Werden Nutzerdaten erhoben? | **Nein** |
| Werden Nutzerdaten geteilt? | **Nein** |
| Übertragung verschlüsselt? | Entfällt (keine Übertragung) |
| Löschung möglich? | Ja – App-Daten löschen oder deinstallieren |

Die App fordert `INTERNET` an, überträgt im aktuellen Build aber nichts. Das ist
kein Widerspruch: die Berechtigung ist für den Kalender- und Cloud-Abgleich
vorgesehen, der erst mit den Client-IDs aktiv wird.

> **Sobald Firebase oder der Kalender-Abgleich freigeschaltet werden**, ändern
> sich diese Antworten grundlegend: dann werden E-Mail-Adresse (Firebase Auth),
> Kalendereinträge, Aufgaben, Finanzdaten und Rezeptfotos an Google-Server
> übertragen. Fragebogen, Datenschutzerklärung und der Absatz „Deine Daten
> bleiben deine" oben müssen dann gemeinsam angepasst werden. Falsche Angaben
> hier sind einer der häufigsten Gründe für eine Sperrung.

---

## Vor dem Absenden prüfen

- [ ] Datenschutzerklärung ist öffentlich erreichbar und die URL eingetragen
      (Google ruft sie auf)
- [ ] Data-Safety-Fragebogen passt zum tatsächlichen Build
- [ ] Screenshots sind aktuell (nach jeder größeren Oberflächenänderung neu erzeugen)
- [ ] Release-Hinweise aus `CHANGELOG.md` übernommen
- [ ] App-Bundle mit dem Release-Key signiert (`jarsigner -verify`, siehe BUILD-GUIDE)
- [ ] `versionCode` ist höher als bei jedem vorherigen Upload
