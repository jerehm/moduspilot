import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// experimentalForceLongPolling avoids the WebSocket watch-stream assertion
// bug in Firebase 11.x (INTERNAL ASSERTION FAILED ca9 / b815).
//
// persistentLocalCache backs Firestore with IndexedDB, so onSnapshot listeners
// serve last-known data from disk instantly on repeat visits (then revalidate
// against the server in the background). persistentMultipleTabManager keeps that
// cache consistent across multiple open tabs. This makes every Firestore read in
// the app fast on subsequent loads with no per-component changes.
export const db = initializeFirestore(app, {
  // A message field that is undefined (a tool record with no server label) made
  // Firestore reject the whole conversation save. Drop undefined fields instead.
  ignoreUndefinedProperties: true,
  experimentalForceLongPolling: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
