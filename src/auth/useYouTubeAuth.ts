import { useCallback, useEffect, useState } from 'react';
import { authorize, refresh, revoke, type AuthConfiguration } from 'react-native-app-auth';
import * as Keychain from 'react-native-keychain';

import { BUNDLE_ID, GOOGLE_CLIENT_ID } from '../config';

const KEYCHAIN_SERVICE = 'youtube_tokens';

const config: AuthConfiguration = {
  issuer: 'https://accounts.google.com',
  clientId: GOOGLE_CLIENT_ID,
  // Google native clients only accept `<bundle id | package>:/oauthredirect`.
  redirectUrl: `${BUNDLE_ID}:/oauthredirect`,
  // Required to create/manage live broadcasts and streams.
  scopes: ['https://www.googleapis.com/auth/youtube'],
  usePKCE: true,
  additionalParameters: { access_type: 'offline', prompt: 'consent' },
};

type Tokens = { accessToken: string; refreshToken?: string; expiresAt?: number };

async function saveTokens(t: Tokens) {
  await Keychain.setGenericPassword('youtube', JSON.stringify(t), { service: KEYCHAIN_SERVICE });
}

export function useYouTubeAuth() {
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE })
      .then((creds) => {
        if (creds) setTokens(JSON.parse(creds.password));
      })
      .catch(() => {});
  }, []);

  const signIn = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Set GOOGLE_IOS_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID in src/config.ts');
      return;
    }
    setError(null);
    try {
      const r = await authorize(config);
      const next: Tokens = {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken || undefined,
        expiresAt: new Date(r.accessTokenExpirationDate).getTime(),
      };
      await saveTokens(next);
      setTokens(next);
    } catch (e) {
      const msg = (e as Error).message ?? 'Authorization failed';
      // User closing the browser sheet is not an error worth showing.
      if (!/cancel|dismiss/i.test(msg)) setError(msg);
    }
  }, []);

  // Returns a valid access token, refreshing it when expired.
  const getAccessToken = useCallback(async (): Promise<string> => {
    if (!tokens) throw new Error('Not signed in to YouTube');
    if (!tokens.expiresAt || tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
    if (!tokens.refreshToken) throw new Error('Session expired, please sign in again');
    const r = await refresh(config, { refreshToken: tokens.refreshToken });
    const next: Tokens = {
      accessToken: r.accessToken,
      refreshToken: r.refreshToken || tokens.refreshToken,
      expiresAt: new Date(r.accessTokenExpirationDate).getTime(),
    };
    await saveTokens(next);
    setTokens(next);
    return next.accessToken;
  }, [tokens]);

  const signOut = useCallback(async () => {
    if (tokens) {
      await revoke(config, {
        tokenToRevoke: tokens.refreshToken ?? tokens.accessToken,
        sendClientId: true,
      }).catch(() => {});
    }
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE }).catch(() => {});
    setTokens(null);
  }, [tokens]);

  return { tokens, error, signIn, signOut, getAccessToken, ready: true };
}
