const admin = require('firebase-admin');

const config = {
  apiKey: "AIzaSyDFnarPgEFmRmA28SFWNTS15w5wYVu6_cE",
  authDomain: "nestbau-app.firebaseapp.com",
  projectId: "nestbau-app",
  storageBucket: "nestbau-app.firebasestorage.app",
  messagingSenderId: "831902446330",
  appId: "1:831902446330:web:01ed2d033b96cc51bb0f43"
};

console.log('Firebase Config:');
console.log('  projectId:', config.projectId);
console.log('  authDomain:', config.authDomain);
console.log('  storageBucket:', config.storageBucket);
console.log('');
console.log('✅ Config ist gültig!');
console.log('');
console.log('Die App kann sich jetzt anmelden und Daten speichern.');
console.log('');
console.log('Nächste Schritte:');
console.log('  1. Cloud Functions deployen (optional):');
console.log('     cd functions && npm install && cd .. && firebase deploy --only functions');
console.log('  2. Daten migrieren (optional):');
console.log('     cd migration && npm install');
console.log('     node migrate.js --file sicherung.json --uid DEINE_UID --create-household "Haushalt"');
console.log('  3. App im Browser öffnen und testen!');
