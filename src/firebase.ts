// The Firebase app, Google sign-in and Firestore, shared by the whole site.
// `npm run dev:emu` runs against the local emulators (fake project, fake users), never real data.
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore/lite';
import { FIREBASE_CONFIG } from './firebase-config';

export const usingEmulators = import.meta.env.VITE_EMULATORS === '1';

export const app = initializeApp(usingEmulators ? { ...FIREBASE_CONFIG, projectId: 'demo-institute' } : FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
}

/** Emulators only: signs in as a made-up Google user ("Test Member", or any name given). */
async function signInFake(name = 'Test Member') {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const token = JSON.stringify({ sub: id, email: `${id}@example.com`, email_verified: true, name });
  await signInWithCredential(auth, GoogleAuthProvider.credential(token));
}
if (usingEmulators) (window as unknown as { signInAs: typeof signInFake }).signInAs = signInFake;

export async function signIn() {
  if (usingEmulators) return signInFake();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export const signOut = () => fbSignOut(auth);
