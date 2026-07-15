// pushService.js — SiteCall push notifications (the "doorbell").
//
// Registers a device's Expo push token against the signed-in user, following the exact
// order the platform requires (guard device → Android channel FIRST → permission → token),
// and hands taps back to the app for deep-linking.
//
// IMPORTANT — built to ACTIVATE later, not crash now:
// Remote push does NOT work in Expo Go / Snack (SDK 53+) — it needs a development/EAS build
// on a physical device, plus APNs (iOS) and FCM (Android) credentials. So every native call
// here is behind a soft require: if `expo-notifications` / `expo-device` aren't present, the
// functions no-op cleanly and the app runs exactly as before. The moment you do an EAS build
// with those packages installed, push comes alive with zero code changes.

import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

// ---- soft module loading (never throws in Snack) --------------------------------
let Notifications = null;
let Device = null;
let Constants = null;
try { Notifications = require('expo-notifications'); } catch (_) { Notifications = null; }
try { Device = require('expo-device'); } catch (_) { Device = null; }
try { Constants = require('expo-constants').default; } catch (_) { Constants = null; }

export const pushAvailable = !!(Notifications && Device);

// A stable-ish per-install id so we upsert one row per device instead of piling up tokens.
// (A real install-id lib is better; this is good enough and stays constant per session.)
let _deviceId = null;
function deviceId() {
  if (_deviceId) return _deviceId;
  _deviceId = (Constants?.sessionId) || (Constants?.installationId) ||
    `${Platform.OS}-${Math.random().toString(36).slice(2, 10)}`;
  return _deviceId;
}

// Set the foreground handler once (how a notification behaves while the app is open).
let _handlerSet = false;
function ensureHandler() {
  if (_handlerSet || !Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true, shouldShowList: true,
        shouldPlaySound: true, shouldSetBadge: false,
      }),
    });
    _handlerSet = true;
  } catch (_) {}
}

// The research-mandated order: device guard → Android channel BEFORE token (or Android 8+
// silently drops) → permission (iOS one-shot; degrade if denied) → token → upsert server-side.
export async function registerForPush(userId) {
  if (!pushAvailable) return { ok: false, reason: 'unavailable' };   // Snack / no native module
  try {
    if (!Device.isDevice) return { ok: false, reason: 'not_physical_device' };
    ensureHandler();

    // Android: channel MUST exist before requesting the token, importance HIGH for heads-up.
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Job updates',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 200, 100, 200],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC,
        });
      } catch (_) {}
    }

    // Permission — ask only if not already decided; never block the app if denied.
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return { ok: false, reason: 'denied' };

    // Token — tie to the EAS projectId so it survives account/slug renames.
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenResp?.data;
    if (!token) return { ok: false, reason: 'no_token' };

    // Persist server-side (lease lifecycle enforced in the DB function).
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token, p_device_id: deviceId(), p_platform: Platform.OS,
    });
    if (error) return { ok: false, reason: 'db', error };

    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: 'error', error: e };
  }
}

// Sign-out: deactivate this device's token so a signed-out user stops receiving pushes.
export async function unregisterPush() {
  if (!pushAvailable) return;
  try {
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenResp?.data;
    if (token) await supabase.rpc('deactivate_push_token', { p_token: token });
  } catch (_) {}
}

// Wire tap-handling. `onTap(data)` gets the notification's data payload (e.g. { request_id })
// so the app can deep-link to the job. Returns an unsubscribe fn. No-ops without the module.
export function addPushTapListener(onTap) {
  if (!Notifications) return () => {};
  try {
    // cold start: app opened FROM a notification
    Notifications.getLastNotificationResponseAsync?.().then((resp) => {
      const data = resp?.notification?.request?.content?.data;
      if (data) onTap && onTap(data);
    }).catch(() => {});
    // warm: tapped while running/background
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp?.notification?.request?.content?.data;
      if (data) onTap && onTap(data);
    });
    return () => { try { sub.remove(); } catch (_) {} };
  } catch (_) {
    return () => {};
  }
}
