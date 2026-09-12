# Datenschutzerklärung – Vorlage

> **Das ist eine Vorlage, kein fertiges Dokument und keine Rechtsberatung.**
>
> Vor der Veröffentlichung sind drei Dinge zu tun:
>
> 1. Alle `[[...]]`-Platzhalter ersetzen. Google Play verlangt eine benennbare
>    verantwortliche Stelle mit erreichbarem Kontakt.
> 2. Den Abschnitt „Optionale Verbindungen" an den tatsächlichen Build anpassen.
>    Im aktuellen Build sind Kalender-Abgleich und Cloud-Sync **nicht aktiv**
>    (`BUILD-GUIDE.md`, Abschnitt 7) – der Abschnitt ist deshalb als
>    vorsorgliche Beschreibung formuliert und muss gestrichen oder umgeschrieben
>    werden, sobald sich das ändert.
> 3. Das Ergebnis unter einer **öffentlich erreichbaren URL** veröffentlichen und
>    diese in der Play Console eintragen. Google ruft die Adresse tatsächlich auf;
>    ein toter Link führt zur Ablehnung. Naheliegend: GitHub Pages im Repository
>    `Kildro93/Nestbau` unter `docs/privacy.html`.
>
> Wer die App gewerblich anbietet oder Cloud-Funktionen freischaltet, sollte den
> Text juristisch prüfen lassen. Die Aussagen unten sind bewusst knapp und
> beschreiben nur, was die App nachweislich tut.

---

# Datenschutzerklärung für Nestbau

**Stand:** [[Datum]]
**App:** Nestbau – Haushalt Manager (`de.nestbau.app`)

## 1. Verantwortliche Stelle

```
[[Vorname Nachname]]
[[Straße und Hausnummer]]
[[PLZ Ort, Land]]
E-Mail: [[kontakt@example.com]]
```

## 2. Die kurze Fassung

Nestbau ist eine lokale App. Sämtliche Inhalte – Aufgaben, Termine, Fixkosten,
Rezepte und Fotos – werden ausschließlich im Speicher des Geräts abgelegt. Es
gibt kein Nutzerkonto, keine Registrierung, keine Werbung, kein Tracking und
keine Analysewerkzeuge. Die App überträgt diese Daten weder an die verantwortliche
Stelle noch an Dritte.

## 3. Welche Daten die App verarbeitet

Alles, was in der App eingegeben wird:

- Namen bzw. Bezeichnungen der beiden Profile
- Aufgaben und Listeneinträge samt Zuordnung und Datum
- Termine mit Titel, Zeit, Ort, Beschreibung, Erinnerung und Wiederholung
- Fixkosten und Abonnements mit Betrag, Zahlungsrhythmus und Zuordnung
- Zutaten, Rezepte, Menüpläne und dazu aufgenommene Fotos

**Speicherort:** ausschließlich lokal, im `localStorage` der App
(Schlüssel `nestbau-state-v1`). Diese Daten sind über Android nur der App selbst
zugänglich und werden beim Deinstallieren mitgelöscht.

**Nicht erhoben werden:** Standortdaten, Kontakte, Geräte- oder Werbe-IDs,
Nutzungsstatistiken, Absturzberichte, IP-Adressen.

## 4. Berechtigungen

| Berechtigung | Wofür |
|---|---|
| `INTERNET` | Nur für die optionalen Verbindungen aus Abschnitt 5. Ohne deren Einrichtung stellt die App keine Netzwerkverbindung her. |
| `ACCESS_NETWORK_STATE` | Prüft, ob überhaupt eine Verbindung besteht, bevor ein Abgleich versucht wird. |

Weitere Berechtigungen fordert die App nicht an – insbesondere keinen Zugriff auf
Kamera, Fotos, Kontakte oder den Gerätekalender. Fotos werden über die
Systemauswahl bzw. die System-Kamera aufgenommen; die App erhält dabei nur das
einzelne ausgewählte Bild.

## 5. Optionale Verbindungen

> ⚠️ **Anpassen an den tatsächlichen Build.** Im derzeit ausgelieferten Stand ist
> keine dieser Verbindungen aktiv, weil die dafür nötigen Client-IDs nicht
> mitgeliefert werden. Werden sie freigeschaltet, ist dieser Abschnitt zu
> übernehmen und der Data-Safety-Fragebogen in der Play Console entsprechend
> zu ändern.

Nestbau kann auf ausdrücklichen Wunsch mit externen Diensten verbunden werden.
Ohne diesen Schritt findet keine Übertragung statt.

**Google Kalender / Microsoft Outlook.** Nach der Anmeldung über das jeweilige
Konto (OAuth 2.0 mit PKCE) gleicht die App Termine in beide Richtungen ab.
Übertragen werden dabei Titel, Zeit, Ort und Beschreibung der Termine. Die
Zugangsdaten selbst sieht die App nie – die Anmeldung findet beim jeweiligen
Anbieter statt; gespeichert wird nur ein Zugriffstoken, lokal auf dem Gerät.
Die Verbindung lässt sich in den Einstellungen jederzeit trennen.

- Google: <https://policies.google.com/privacy>
- Microsoft: <https://privacy.microsoft.com/de-de/privacystatement>

**Firebase (Google Ireland Limited).** Wird der Cloud-Abgleich eingerichtet,
werden Aufgaben, Termine, Fixkosten, Rezepte und Rezeptfotos in Google Firestore
bzw. Firebase Storage gespeichert, um sie zwischen mehreren Geräten
abzugleichen. Für die Anmeldung wird eine E-Mail-Adresse verarbeitet. Die Ablage
erfolgt verschlüsselt; der Zugriff ist über Firestore Security Rules auf die
Mitglieder des jeweiligen Haushalts beschränkt.

- Firebase: <https://firebase.google.com/support/privacy>

**Rechtsgrundlage** für diese Verarbeitungen ist die Einwilligung
(Art. 6 Abs. 1 lit. a DSGVO), erteilt durch das bewusste Verbinden des
jeweiligen Dienstes. Sie ist jederzeit mit Wirkung für die Zukunft widerrufbar,
indem die Verbindung getrennt wird.

## 6. Weitergabe an Dritte

Es findet keine Weitergabe statt. Die verantwortliche Stelle erhält keinerlei
Nutzerdaten, weil die App keine überträgt. Werden die optionalen Verbindungen
aus Abschnitt 5 eingerichtet, werden die dort genannten Daten an den jeweiligen
Anbieter übermittelt – auf ausdrücklichen Wunsch der Nutzerin oder des Nutzers
und nur an den gewählten Dienst.

## 7. Speicherdauer

Lokale Daten bleiben, bis sie in der App gelöscht, die App-Daten über die
Android-Einstellungen geleert oder die App deinstalliert wird. Eine automatische
Löschfrist gibt es nicht – die App löscht nichts von selbst.

## 8. Rechte

Nach der DSGVO bestehen Rechte auf Auskunft, Berichtigung, Löschung,
Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch.

Da alle Daten lokal liegen, lassen sich diese Rechte unmittelbar in der App
ausüben:

- **Auskunft und Übertragbarkeit:** Zahnrad → „Sicherung speichern" gibt den
  vollständigen Bestand als JSON-Datei aus.
- **Berichtigung:** Jeder Eintrag ist in der App bearbeitbar.
- **Löschung:** Einzelne Einträge in der App löschen oder die App-Daten über
  Android-Einstellungen → Apps → Nestbau → Speicher → Daten löschen entfernen.

Für Daten bei den in Abschnitt 5 genannten Anbietern gelten zusätzlich deren
eigene Verfahren.

Es besteht ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde.

## 9. Kinder

Die App richtet sich an Erwachsene und erhebt wissentlich keine Daten von
Kindern. Da überhaupt keine Daten erhoben werden, entsteht auch kein besonderes
Risiko für minderjährige Nutzende.

## 10. Änderungen

Änderungen dieser Erklärung werden unter der oben genannten Adresse
veröffentlicht. Maßgeblich ist der jeweils angegebene Stand. Wesentliche
Änderungen – insbesondere die Aktivierung der Cloud-Funktionen – werden zusätzlich
in den Release-Hinweisen der jeweiligen Version benannt.

## 11. Kontakt

Fragen zum Datenschutz: [[kontakt@example.com]]
