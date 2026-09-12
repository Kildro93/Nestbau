# BUILD-GUIDE – Nestbau für Android

Wie aus der PWA ein APK bzw. ein Play-Store-AAB wird. Geschrieben für den
nächsten Release, nicht für den ersten – wer hier landet, will meistens nur
schnell eine neue Version bauen.

**Schnellweg:** [Release in fünf Schritten](#release-in-fünf-schritten)

---

## 1. Wie das Ganze aufgebaut ist

Nestbau ist eine PWA: eine einzelne `index.html` plus die Module unter `js/`.
Für Android wird sie mit **Capacitor 7** in eine native Hülle gepackt. Capacitor
startet eine `MainActivity`, die einen WebView öffnet und darin die Dateien aus
dem APK ausliefert – kein Server, kein Netz nötig.

```
index.html, js/, src/  ──[ tools/build-web.js ]──▶  www/
                                                     │
                                                     │ npx cap sync android
                                                     ▼
                                       android/app/src/main/assets/public/
                                                     │
                                                     │ tools/android-build.js
                                                     ▼
                                              dist/*.apk  dist/*.aab
```

Warum der Umweg über `www/`? Capacitor packt seinen gesamten `webDir` ins APK.
Zeigte er auf das Projektwurzelverzeichnis, lägen `node_modules/`, `android/`
und die Build-Artefakte mit im Paket. `tools/build-web.js` kopiert genau die
Dateien, die der WebView braucht – aktuell 378 KB.

**Bewusst nicht in `www/`:** `js/nb-config.local.js`. Die Datei zeigt auf den
Firebase-Emulator (`localhost`) und würde die installierte App ins Leere laufen
lassen. `index.html` fängt ihr Fehlen über `onerror` ab. Was das für den Release
bedeutet, steht unter [Cloud-Funktionen](#7-cloud-funktionen-sind-im-apk-noch-nicht-aktiv).

### Verzeichnisse

| Pfad | Zweck |
|---|---|
| `capacitor.config.json` | App-ID, Name, Splash, Statusbar |
| `android/` | Das native Projekt (im Repo, wird nicht neu generiert) |
| `android/version.properties` | **Einzige** Quelle für versionCode/versionName |
| `android/keystore.properties` | Signatur-Zugangsdaten – **lokal, nie im Repo** |
| `tools/build-web.js` | PWA → `www/` |
| `tools/android-build.js` | Gradle-Build über einen ASCII-Spiegel |
| `tools/generate-assets.js` | `icon.svg` → alle Bitmap-Größen |
| `tools/screenshots.js` | Play-Store-Screenshots aus der echten App |
| `dist/` | Fertige Artefakte (gitignored) |
| `play-store/` | Grafiken und Texte für die Store-Seite |

---

## 2. Voraussetzungen

| | Version | Prüfen mit |
|---|---|---|
| Node.js | 20+ | `node --version` |
| JDK | 17 oder 21 | `java -version` |
| Android SDK Platform | 35 | `ls %LOCALAPPDATA%\Android\Sdk\platforms` |
| Android Build-Tools | 35.0.0+ | `ls %LOCALAPPDATA%\Android\Sdk\build-tools` |

Gradle selbst muss **nicht** installiert sein – der Wrapper im Projekt lädt beim
ersten Build die passende Version (8.11.1) nach.

Der SDK-Pfad steht in `android/local.properties`:

```
sdk.dir=C:/Users/<benutzer>/AppData/Local/Android/Sdk
```

> **Vorwärts-Schrägstriche verwenden.** Gradle liest die Datei als Java-Properties,
> dort ist `\` ein Escape-Zeichen. `sdk.dir=C:\Users\indra\...` wird zu
> `C:UsersindraAppData...` und der Build bricht mit
> `java.io.IOException: Die Syntax für den Dateinamen ... ist falsch` ab –
> einer Meldung, die nirgends auf die Ursache zeigt.

Einmalig nach dem Klonen:

```bash
npm install
```

---

## 3. Release in fünf Schritten

```bash
# 1. Version hochzählen -> android/version.properties (siehe VERSIONING.md)
# 2. Web-Assets bauen und ins native Projekt spiegeln
npm run sync
# 3. Signiertes App Bundle bauen
node tools/android-build.js release
# 4. Debug-APK zum Gegentesten auf einem echten Gerät
node tools/android-build.js debug
# 5. dist/nestbau-<version>-release.aab in der Play Console hochladen
```

Die Artefakte landen in `dist/`:

| Datei | Wofür |
|---|---|
| `nestbau-2.0.0-debug.apk` | Lokales Testen, per `adb install` |
| `nestbau-2.0.0-release.aab` | Play-Store-Upload |
| `nestbau-2.0.0-releaseApk.apk` | Optional: signiertes APK zum Direktverteilen (`node tools/android-build.js releaseApk`) |

**Debug und Release lassen sich gleichzeitig installieren.** Der Debug-Build
trägt die Application-ID `de.nestbau.app.debug` und den Versionsnamen
`2.0.0-debug`, stört also eine installierte Produktivversion nicht.

---

## 4. Der ASCII-Spiegel – warum nicht direkt gebaut wird

Das Projekt liegt unter `C:\KI Programme\Obsidion für Claud\Nestbau`. Das „ü"
im Pfad reicht, damit das Android Gradle Plugin den Build verweigert:

```
Your project path contains non-ASCII characters.
```

`android.overridePathCheck=true` schaltet zwar die Warnung ab, danach scheitert
der Build aber trotzdem beim Auflösen der Java-Abhängigkeiten – getestet, es
hilft nicht.

`tools/android-build.js` spiegelt deshalb `android/` und die benötigten
`@capacitor`-Pakete nach `C:/nestbau-build` und ruft Gradle dort auf. Die
Artefakte kopiert es anschließend nach `dist/` zurück. Der Spiegel bleibt
zwischen Builds bestehen, damit Gradle inkrementell arbeiten kann (erster Build
~90 s, danach ~20 s); nur `app/src/` wird jedes Mal frisch übertragen, damit
gelöschte Web-Dateien nicht im Spiegel überleben.

Anderes Zielverzeichnis:

```bash
NESTBAU_BUILD_DIR=D:/build node tools/android-build.js release
```

> **Der saubere Weg wäre**, das Repository in einen Pfad ohne Sonderzeichen zu
> verschieben – dann kann `tools/android-build.js` entfallen und `cd android &&
> gradlew bundleRelease` genügt. Das ist eine Entscheidung über die Ablage des
> Obsidian-Vaults und deshalb bewusst nicht getroffen worden.

---

## 5. Signatur

Der Release-Key liegt **außerhalb des Repositories**:

```
C:\Users\indra\.nestbau-keys\nestbau-release.jks
```

| | |
|---|---|
| Format | PKCS12 |
| Algorithmus | RSA 4096, SHA384withRSA |
| Alias | `nestbau-release` |
| Gültigkeit | 10 000 Tage (bis ca. 2054) |
| SHA-256 | `62:2F:E2:3D:5B:24:FC:AF:6A:A0:18:AD:E2:7B:E9:A5:03:79:BD:C6:54:39:44:0C:F0:3C:DA:32:B0:61:70:C4` |

Die Zugangsdaten stehen in `android/keystore.properties` (per `.gitignore`
ausgeschlossen, Vorlage: `keystore.properties.example`). `android/app/build.gradle`
liest die Datei; fehlt sie, läuft `assembleDebug` weiter und nur der Release-Build
bricht ab.

> ### Ohne Backup ist die App tot
> Geht der Keystore verloren, lässt sich **keine Aktualisierung mehr
> veröffentlichen** – Google akzeptiert nur Uploads mit demselben Schlüssel. Es
> bliebe nur eine neue App unter neuer Package-ID, ohne Bestandsnutzer.
>
> Zwei Dinge tun, bevor die App im Store steht:
> 1. `nestbau-release.jks` **und** `keystore.properties` an einen zweiten Ort
>    sichern (Passwortmanager, verschlüsselter Offline-Datenträger). Nicht ins
>    Repo, nicht in einen Sync-Ordner ohne Verschlüsselung.
> 2. Bei der Einrichtung in der Play Console **Play App Signing** aktivieren.
>    Google verwahrt dann den eigentlichen Signaturschlüssel; der lokale Key wird
>    zum Upload-Key und kann im Notfall über den Support ersetzt werden. Das ist
>    das Sicherheitsnetz für genau diesen Fall.

Signatur eines fertigen Artefakts prüfen:

```bash
jarsigner -verify -certs dist/nestbau-2.0.0-release.aab
```

Erwartet: `JAR-Datei verifiziert.` und der oben genannte SHA-256-Fingerabdruck.
Steht dort `CN=Android Debug`, wurde versehentlich mit dem Debug-Key gebaut –
dieses Artefakt weist die Play Console zurück.

---

## 6. Berechtigungen

Die App fordert **zwei** Berechtigungen an:

| Berechtigung | Wofür |
|---|---|
| `INTERNET` | Firestore-Sync, Kalender-Abgleich, OAuth-Login |
| `ACCESS_NETWORK_STATE` | Erkennen, ob ein Sync überhaupt versucht werden soll |

Alles andere ist bewusst weggelassen. Die Begründungen stehen als Kommentar
direkt in `android/app/src/main/AndroidManifest.xml`, hier die wichtigste:

### Warum kein `CAMERA`, obwohl es Rezeptfotos gibt

Fotos laufen über `<input type="file" accept="image/*" capture="environment">`.
Capacitors `BridgeWebChromeClient` entscheidet in `isMediaCaptureSupported()`,
wie es damit umgeht:

```java
return (
    PermissionHelper.hasPermissions(context, permissions) ||
    !PermissionHelper.hasDefinedPermission(context, Manifest.permission.CAMERA)
);
```

Deklariert die App `CAMERA` **nicht**, gilt Kamera-Aufnahme sofort als
unterstützt und die System-Kamera startet direkt per `ACTION_IMAGE_CAPTURE` –
ganz ohne Dialog. Deklariert man sie, erzwingt dieselbe Methode einen
Berechtigungsdialog, der funktional nichts hinzufügt. Weniger Rechte, ein Klick
weniger, gleiche Funktion.

Notwendig ist dafür der `<queries>`-Block im Manifest: seit Android 11 findet
`resolveActivity()` fremde Apps nur, wenn sie dort genannt sind. Fehlt er,
fällt der Foto-Dialog stumm auf die Dateiauswahl zurück.

> Sollte später eine In-App-Kamera über `@capacitor/camera` dazukommen, gilt das
> nicht mehr – dann muss `CAMERA` deklariert **und** zur Laufzeit angefragt werden.

`READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` entfallen, weil die Auswahl eines
vorhandenen Bildes über `ACTION_GET_CONTENT` läuft: der System-Dialog übergibt
eine bereits freigegebene URI.

`READ_CALENDAR` / `WRITE_CALENDAR` entfallen, weil der Kalender-Abgleich über die
Google- und Microsoft-Graph-APIs mit OAuth läuft, nicht über den Gerätekalender.
`READ_CONTACTS` entfällt, weil Haushaltsmitglieder in der App angelegt werden.

---

## 7. Cloud-Funktionen sind im APK noch nicht aktiv

**Vor dem ersten echten Release prüfen.** Die Client-IDs für Google, Microsoft
und Firebase liegen in `js/nb-config.local.js`, und diese Datei wird bewusst
nicht mitgepackt. Im gebauten APK bedeutet das:

- Kalender-Abgleich (Google/Outlook): inaktiv, die Karten zeigen „Client-ID fehlt"
- Firebase-Anmeldung und Firestore-Sync: inaktiv
- Alles andere – Aufgaben, Kalender, Finanzen, Kochbuch – funktioniert
  vollständig lokal

Das ist für einen ersten lokalen Release eine tragfähige Ausgangslage und deckt
sich mit dem Store-Text in `play-store/STORE-LISTING.md`. Sollen die
Cloud-Funktionen mit ausgeliefert werden:

1. Eine `js/nb-config.prod.js` mit den Produktions-Client-IDs anlegen
   (OAuth-Client-IDs sind keine Geheimnisse, der Schutz kommt aus den Redirect-URIs
   und den Firestore Security Rules).
2. Sie in `tools/build-web.js` in `FILES` aufnehmen und in `index.html` einbinden.
3. In der Google Cloud Console und im Azure-Portal
   `https://localhost/oauth-callback.html` als Redirect-URI eintragen – das ist
   die Adresse, unter der Capacitor die App im WebView ausliefert.
4. Store-Listing und Datenschutzerklärung entsprechend ergänzen: sobald Daten das
   Gerät verlassen, ändert sich der Play-Data-Safety-Fragebogen.

---

## 8. Testen

### Emulator

Ohne `cmdline-tools` gibt es kein `avdmanager`. Ein AVD lässt sich trotzdem von
Hand anlegen – `~/.android/avd/NestbauTest.ini` plus
`~/.android/avd/NestbauTest.avd/config.ini` mit `image.sysdir.1` auf ein
vorhandenes System-Image. Danach:

```bash
%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe -avd NestbauTest -no-window -no-audio
adb install -r dist/nestbau-2.0.0-debug.apk
adb shell am start -n de.nestbau.app.debug/de.nestbau.app.MainActivity
adb exec-out screencap -p > screen.png
```

JavaScript-Fehler tauchen im Logcat unter `Capacitor/Console` auf:

```bash
adb logcat -d | grep -i "Capacitor/Console"
```

### Offline-Test

Der wichtigste Test, weil die App lokal arbeiten können muss:

```bash
adb shell svc wifi disable && adb shell svc data disable
adb shell am force-stop de.nestbau.app.debug
adb shell am start -n de.nestbau.app.debug/de.nestbau.app.MainActivity
```

Erwartet: Kaltstart ohne Netz, gewähltes Profil bleibt erhalten, alle fünf
Bereiche navigierbar. Danach `svc wifi enable` / `svc data enable`.

### Echtes Gerät

Steht noch aus – zum Zeitpunkt dieses Builds war kein Gerät angeschlossen
(`adb devices` leer). Auf einem Pixel oder Samsung gehören geprüft:

- Foto zu einem Rezept aufnehmen (der Kamera-Pfad aus Abschnitt 6 – im Emulator
  nicht sinnvoll prüfbar)
- Dateiauswahl für ein vorhandenes Bild
- „Sicherung speichern" / „Sicherung laden" (Download-Ordner und Dateidialog)
- Verhalten beim Drehen und mit sehr großer Systemschrift
- Dunkles Systemthema

---

## 9. Store-Assets neu erzeugen

```bash
npm run assets            # icon.svg -> Launcher-Icons, Play-Icon, Feature-Graphic
node tools/screenshots.js # 6 Screenshots aus der echten App, 1080x1920
```

`tools/screenshots.js` startet einen lokalen Server auf `www/`, schreibt den
Demo-Datensatz aus `tools/demo-data.js` in den `localStorage` und fotografiert
jede Ansicht. Es wird nichts montiert – was auf den Bildern steht, rendert die
App auf dem Gerät genauso. Wer die gezeigten Inhalte ändern will, ändert
`tools/demo-data.js`.

---

## 10. Bekannte Stolpersteine

| Symptom | Ursache | Lösung |
|---|---|---|
| `Your project path contains non-ASCII characters` | Umlaut im Projektpfad | `tools/android-build.js` benutzen (Abschnitt 4) |
| `java.io.IOException: Die Syntax für den Dateinamen ... ist falsch` | Backslashes in `local.properties` | Vorwärts-Schrägstriche (Abschnitt 2) |
| `Der Befehl "gradlew.bat" ... konnte nicht gefunden werden` | `cmd.exe` sucht nicht im Arbeitsverzeichnis | Absoluter Pfad – in `tools/android-build.js` bereits so gelöst |
| `spawnSync ... EINVAL` bei `.bat` | Node startet `.bat` seit 18.20 nur über die Shell | Aufruf über `cmd.exe /c` |
| Release-Build bricht mit fehlendem Keystore ab | `android/keystore.properties` fehlt | Aus `keystore.properties.example` anlegen |
| Store-Seite zeigt „App-Bundle abgelehnt" | Falscher Signaturschlüssel oder versionCode schon vergeben | Abschnitt 5 und `VERSIONING.md` |
| Neue Web-Datei fehlt in der App, ohne Fehlermeldung | Datei nicht in `FILES` in `tools/build-web.js` | `npm run build:web` bricht seitdem mit der Liste der unaufgelösten Verweise ab |

### `nestbau-design.css` wirkte nicht (behoben 2026-09-12)

`index.html` band `nestbau-design.css` ein, definierte aber im Inline-`<style>`
dieselben `:root`-Variablen (`--bg`, `--flame`, `--surface` …) noch einmal mit
den alten Werten. Bei gleicher Spezifität gewann die spätere Regel – das
Stylesheet wurde also für die gesamte Farbpalette überschrieben.

Behoben: der doppelte `:root`-Block und die duplizierten Komponenten-Regeln
(Buttons, Cards, Chips, Pills, Tabbar, Formulare …) sind aus `index.html`
entfernt; nur die dort einzigartigen App-Styles (Kalender, Uhr, Kochbuch,
Menüplan) bleiben inline. `capacitor.config.json` (Splash + Statusleiste),
`SPLASH_BG`/`BG` in `tools/generate-assets.js` und `icon.svg` sind auf die
neue Palette (Orange `#FF8C42` / Peach `#FFB84D` / Grün `#7EC483`) nachgezogen.
Screenshots (`node tools/screenshots.js`) und die PNG-Icons unter
`assets/icons/` sind noch mit der alten Palette gerendert und sollten bei
Gelegenheit neu erzeugt werden.

---

## 11. Play Console

Was hier nicht automatisiert werden kann und von Hand passieren muss:

1. **Entwicklerkonto** unter <https://play.google.com/console> anlegen. Einmalige
   Registrierungsgebühr, Google nennt den Betrag in Landeswährung an der Kasse.
   Erfordert eine Identitätsprüfung, die einige Tage dauern kann – früh starten.
2. **App anlegen:** Name „Nestbau – Haushalt Manager", Sprache Deutsch, Typ App,
   kostenlos.
3. **Store-Eintrag** aus `play-store/STORE-LISTING.md` übernehmen, Grafiken aus
   `play-store/` hochladen.
4. **Datenschutzerklärung** öffentlich erreichbar veröffentlichen und die URL
   eintragen – Google prüft, dass die Adresse antwortet. Vorlage:
   `play-store/PRIVACY-POLICY.md`.
5. **Data-Safety-Fragebogen** ausfüllen. Beim aktuellen Stand (Abschnitt 7,
   rein lokale App) lautet die Antwort auf „Werden Nutzerdaten erhoben oder
   geteilt?" **Nein**. Sobald Firebase aktiv ist, ändert sich das.
6. **Inhaltseinstufung**, Zielgruppe und Kategorie („Produktivität") ausfüllen.
7. **Release-Tracks** in dieser Reihenfolge:

   | Track | Zweck |
   |---|---|
   | Interner Test | Bis 100 Testende, sofort verfügbar, keine Prüfung |
   | Geschlossener Test (Alpha) | Ausgewählter Kreis, kurze Prüfung |
   | Offener Test (Beta) | Öffentlich sichtbar |
   | Produktion | Vollständige Prüfung, dauert bis zu mehrere Tage |

   Für neue Entwicklerkonten verlangt Google vor der ersten Produktionsfreigabe
   in der Regel eine Testphase mit einer Mindestzahl an Testenden über mehrere
   Tage. Das ist beim Zeitplan einzurechnen.

---

## 12. Größe im Blick behalten

| | Stand 2.0.0 | Grenze |
|---|---|---|
| Debug-APK | 6,4 MB | – |
| Release-AAB | 4,5 MB | 200 MB (Play) |
| Web-Assets in `www/` | 378 KB | – |

Sehr viel Luft. Deshalb ist `minifyEnabled` im Release bewusst **aus**: zu
schrumpfen gäbe es nur die dünne Capacitor-Java-Schicht, und R8 bringt bei
WebView-Apps vor allem Reflection-Risiko in den Plugins. Sollte die App eines
Tages größer werden, ist das der erste Hebel – dann aber mit vollem
Funktionstest, nicht nur mit einem Build-Durchlauf.

Was die Größe treiben würde: Rezeptfotos landen als Base64-Data-URL im
`localStorage`. Das betrifft nicht das APK, wohl aber das Speicherlimit des
WebViews (Größenordnung 5–10 MB). Wer viele Fotos erwartet, sollte auf Firebase
Storage ausweichen – die Anbindung liegt in `js/nb-firebase.js` bereits vor.
