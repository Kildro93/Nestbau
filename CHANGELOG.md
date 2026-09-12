# Changelog

Alle nennenswerten Änderungen an Nestbau. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/) – Regeln siehe `VERSIONING.md`.

---

## [2.0.0] – 2026-09-04

Erste Fassung als Android-App. Bis hierher lief Nestbau als PWA im Browser.

### Neu

**Android-App**
- Native Verpackung mit Capacitor 7; die App läuft im WebView aus dem
  Installationspaket, ohne Server und ohne Netz
- Launcher-Icon inklusive adaptivem Icon (Android 8+) und Startbildschirm,
  alles aus `icon.svg` erzeugt
- Signierter Release-Schlüssel (RSA 4096) und reproduzierbarer Build über
  `tools/android-build.js`
- Berechtigungen auf `INTERNET` und `ACCESS_NETWORK_STATE` beschränkt –
  ausdrücklich ohne Kamera-, Kontakt- oder Kalenderzugriff

**Kochbuch**
- Zutatenverwaltung mit Nährwerten, Allergenen, Kategorien und Fotos
- Rezepte mit Vorbereitung, Zubereitungsschritten, Utensilien, Portionen und
  Saison
- Menüplan für Woche und Monat mit Nährwertsummen je Tag
- Einkaufsliste aus dem Menüplan, nach Ladenbereichen gruppiert

**Finanzen**
- Fixkosten und Abos mit monatlichem, vierteljährlichem, halbjährlichem oder
  jährlichem Rhythmus
- Umrechnung auf die Monatsbelastung, aufgeteilt nach Person

**Kalender**
- Wochen- und Monatsansicht mit Kategorien, Erinnerungen und Wiederholungen
- Aufgaben lassen sich direkt an einen Termin hängen

**Integrationen (im Code vorhanden, im ausgelieferten Paket noch nicht aktiv)**
- Abgleich mit Google Kalender und Microsoft Outlook über OAuth 2.0 mit PKCE
- Firebase-Anmeldung, Firestore-Sync und Bildablage in Firebase Storage
- Migrationspfad vom lokalen Speicher in die Cloud

### Geändert
- Der Service Worker wird in der Android-App nicht mehr registriert. Die Dateien
  liegen dort bereits lokal im Paket; eine zweite Zwischenschicht brächte nur
  zusätzliche Fehlerquellen.

### Bekannte Einschränkungen
- **Cloud-Funktionen sind im ausgelieferten Paket inaktiv**, weil die Client-IDs
  bewusst nicht mitgeliefert werden (`BUILD-GUIDE.md`, Abschnitt 7). Aufgaben,
  Kalender, Finanzen und Kochbuch funktionieren vollständig lokal.
- **Beträge sind fest auf Schweizer Franken** eingestellt, inklusive Rundung auf
  5 Rappen. Eine wählbare Währung fehlt.
- **Mindestens Android 6.0** (API 23) statt der angestrebten Version 5.0 –
  Begründung in `BUILD-GUIDE.md`.
- **Noch kein Test auf einem echten Gerät.** Geprüft wurde auf dem Emulator
  (Android 16, x86_64): Start, Navigation, Bestehenbleiben des Profils und
  Kaltstart ohne Netzverbindung.

---

## Release-Hinweis für den Store

*Play erlaubt 500 Zeichen. Dieser Text erscheint unter „Was ist neu".*

```
Nestbau gibt es jetzt als App.

• Kochbuch: Zutaten mit Nährwerten, Rezepte, Menüplan und daraus die
  Einkaufsliste
• Finanzen: Fixkosten und Abos, umgerechnet auf den Monat
• Kalender: Woche und Monat, mit Erinnerungen und Wiederholungen
• Läuft vollständig offline – ohne Konto, ohne Werbung, ohne Tracking

Alle Daten bleiben auf dem Gerät.
```

340 Zeichen.

---

## Vor 2.0.0

Nestbau lief als PWA. Die Historie dieser Zeit steht im Git-Verlauf
(`git log --oneline`) und ist hier nicht rückwirkend aufgearbeitet worden –
lieber eine Lücke als eine erfundene Chronologie.
