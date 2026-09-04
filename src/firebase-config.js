/**
 * Nestbau v2.0 - Firebase-Initialisierung fuer das Frontend.
 *
 * Einbinden als ES-Modul:
 *   <script type="module" src="./firebase-config.js"></script>
 * oder in index.html:
 *   import { auth, db, storage, fn } from './firebase-config.js';
 *
 * Wichtig: Firebase Auth funktioniert NICHT ueber file://. Die App muss ueber
 * http(s) laufen - lokal `firebase emulators:start` oder `python -m http.server`,
 * produktiv Firebase Hosting. Die Domain muss unter
 * Authentication > Settings > Authorized domains eingetragen sein.
 *
 * Die apiKey ist kein Geheimnis (sie identifiziert nur das Projekt) - der Schutz
 * kommt komplett aus den Security Rules. Echte Secrets liegen im Secret Manager
 * und werden ausschliesslich in Cloud Functions verwendet.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, onIdTokenChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendEmailVerification, sendPasswordResetEmail, updateProfile,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, connectFirestoreEmulator,
  persistentLocalCache, persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  getStorage, connectStorageEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import {
  getFunctions, connectFunctionsEmulator, httpsCallable,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js';

// --- Projektwerte aus der Firebase Console (Projekteinstellungen > Meine Apps) ---
export const firebaseConfig = window.__NESTBAU_FIREBASE_CONFIG__ || {
  apiKey: "AIzaSyDF•••••••••••••••••••••••••••••••",
  authDomain: "nestbau-app.firebaseapp.com",
  projectId: "nestbau-app",
  storageBucket: "nestbau-app.firebasestorage.app",
  messagingSenderId: "831902446330",
  appId: "1:831902446330:web:01ed2d033b96cc51bb0f43",
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Offline-Cache: die App bleibt im Zug ohne Empfang bedienbar und liest weniger.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
export const fn = getFunctions(app, 'europe-west1');

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if (isLocal && !window.__NESTBAU_NO_EMULATOR__) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  console.info('[nestbau] Firebase-Emulatoren aktiv');
}

// --- Callable Functions ---
export const callables = {
  createHousehold: httpsCallable(fn, 'createHousehold'),
  inviteToHousehold: httpsCallable(fn, 'inviteToHousehold'),
  acceptInvite: httpsCallable(fn, 'acceptInvite'),
  revokeInvite: httpsCallable(fn, 'revokeInvite'),
  setMemberRole: httpsCallable(fn, 'setMemberRole'),
  removeMember: httpsCallable(fn, 'removeMember'),
  updateDisplayProfile: httpsCallable(fn, 'updateDisplayProfile'),
  resendVerificationEmail: httpsCallable(fn, 'resendVerificationEmail'),
  deleteAccount: httpsCallable(fn, 'deleteAccount'),
  connectCalendar: httpsCallable(fn, 'connectCalendar'),
  disconnectCalendar: httpsCallable(fn, 'disconnectCalendar'),
};

// --- Auth-Helfer ---

/** Rollen aus dem ID-Token. Nach Beitritt zu einem Haushalt refreshClaims() aufrufen. */
export async function currentClaims(forceRefresh = false) {
  if (!auth.currentUser) return {};
  const res = await auth.currentUser.getIdTokenResult(forceRefresh);
  return res.claims || {};
}

export async function refreshClaims() {
  return currentClaims(true);
}

export async function householdRoles() {
  return (await currentClaims()).hh || {};
}

export async function register(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  // onUserCreated legt Firestore-Dokumente an und schickt die Verifikationsmail.
  return cred.user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const resendVerification = () => sendEmailVerification(auth.currentUser);

/**
 * Fehlermeldungen fuer die Oberflaeche - bewusst unspezifisch bei Login-Fehlern,
 * damit sich ueber die Meldung nicht pruefen laesst, welche Adressen registriert sind.
 */
export function authErrorText(err) {
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-email': 'Diese Email-Adresse sieht nicht richtig aus.',
    'auth/email-already-in-use': 'Fuer diese Adresse gibt es schon ein Konto.',
    'auth/weak-password': 'Das Passwort braucht mindestens 6 Zeichen.',
    'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten.',
    'auth/network-request-failed': 'Keine Verbindung. Offline gespeicherte Daten bleiben erhalten.',
  };
  if (map[code]) return map[code];
  if (code.startsWith('auth/')) return 'Email oder Passwort stimmt nicht.';
  return 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.';
}

export { onAuthStateChanged, onIdTokenChanged };
