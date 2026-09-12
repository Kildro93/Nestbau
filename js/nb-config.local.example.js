/* Vorlage fuer js/nb-config.local.js (per .gitignore ausgeschlossen).
 *
 *   cp js/nb-config.local.example.js js/nb-config.local.js
 *
 * Ohne diese Datei laeuft Nestbau rein lokal (localStorage): Cloud-Abgleich,
 * Google- und Outlook-Kalender bleiben aus, die App funktioniert trotzdem.
 * index.html faengt die fehlende Datei ab, und tools/build-web.js laesst sie
 * bewusst aus dem Android-Build heraus.
 *
 * KEINE Client-Secrets eintragen: Nestbau ist ein oeffentlicher OAuth-Client
 * und nutzt ausschliesslich PKCE (js/nb-oauth.js). Ein Secret im Frontend
 * waere fuer jeden Besucher lesbar.
 *
 * Der Firebase-apiKey ist dagegen kein Geheimnis - er identifiziert nur das
 * Projekt. Der Schutz kommt vollstaendig aus firestore.rules/storage.rules.
 */
NB.configure({
  // Firebase Console > Projekteinstellungen > Meine Apps > SDK-Konfiguration
  firebase: {
    apiKey: "",              // "AIzaSy..."
    authDomain: "",          // "<projekt-id>.firebaseapp.com"
    projectId: "",           // "<projekt-id>"
    storageBucket: "",       // "<projekt-id>.firebasestorage.app"
    messagingSenderId: "",
    appId: "",

    // Gegen die lokale Emulator-Suite testen statt gegen das echte Projekt:
    //   emulator: true          (Firestore 8080, Auth 9099, Storage 9199)
    //   emulator: { host: "localhost", firestore: 8080 }
    emulator: false,
  },

  // Google Cloud Console > APIs & Dienste > Anmeldedaten > OAuth-Client-ID (Web)
  // Redirect-URI dort: <origin>/oauth-callback.html
  google: {
    clientId: "",            // "1234-abc.apps.googleusercontent.com"
  },

  // Azure Portal > Entra ID > App-Registrierungen
  // Plattform "Single-page application" waehlen - nur die erlaubt PKCE ohne Secret.
  outlook: {
    clientId: "",            // GUID
    tenant: "common",        // common | organizations | consumers | <tenant-guid>
  },
});
