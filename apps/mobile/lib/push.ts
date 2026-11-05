import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Expo push registration. The iOS app registers an Expo push token saved to
 * users/{uid}/expoPushTokens; the server (lib/fcm-admin.ts sendExpo) delivers
 * briefing / check-in notifications via Expo's push service.
 *
 * Requires the expo-notifications native module (dev rebuild) AND an EAS
 * projectId (extra.eas.projectId in app.json, via `eas init`). Without the
 * projectId, getExpoPushTokenAsync can't issue a token, so we skip gracefully.
 */

// Show notifications while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getProjectId(): string | null {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

export async function registerPush(uid: string): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators can't receive a real push token

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    const projectId = getProjectId();
    if (!projectId) {
      console.warn('[push] No EAS projectId (extra.eas.projectId), run `eas init`; skipping push registration.');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    const id = token.replace(/[/#.[\]]/g, '_');
    await setDoc(doc(db, 'users', uid, 'expoPushTokens', id), {
      token,
      platform: Platform.OS,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[push] registerPush failed', e);
  }
}
