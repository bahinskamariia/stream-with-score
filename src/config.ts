import { Platform } from 'react-native';

// Google OAuth client IDs (public identifiers, safe to commit).
// Create them in Google Cloud Console → Credentials:
//   iOS client     → bundle ID  com.streamwithscore.app
//   Android client → package    com.streamwithscore.app (+ SHA-1 of your signing key)
export const GOOGLE_IOS_CLIENT_ID = '26189677639-prvpdhv9ja5g5hlk0qr3lnu81v1h8qs9.apps.googleusercontent.com';
export const GOOGLE_ANDROID_CLIENT_ID = '';

export const BUNDLE_ID = 'com.streamwithscore.app';

export const GOOGLE_CLIENT_ID =
  Platform.OS === 'android' ? GOOGLE_ANDROID_CLIENT_ID : GOOGLE_IOS_CLIENT_ID;
