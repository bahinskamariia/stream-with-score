import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  Alert,
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ApiVideoLiveStreamView,
  type ApiVideoLiveStreamMethods,
} from '@api.video/react-native-livestream';

import { useYouTubeAuth } from './src/auth/useYouTubeAuth';
import {
  createLiveSession,
  endBroadcast,
  setThumbnail as setThumbnailApi,
  type LiveSession,
  type Privacy,
} from './src/youtube/liveApi';

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(
    Math.floor((total % 3600) / 60),
  )}:${pad(total % 60)}`;
}

export default function App() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [camera, setCamera] = useState<'back' | 'front'>('back');
  const [muted, setMuted] = useState(false);
  const { tokens, error, signIn, signOut, getAccessToken, ready } =
    useYouTubeAuth();
  const streamRef = useRef<ApiVideoLiveStreamMethods>(null);
  const [session, setSession] = useState<LiveSession | null>(null);
  // Set when the RTMP connection is established; drives the duration timer.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  // False while the RTMP link is down (e.g. app in background); the session itself stays alive.
  const [connected, setConnected] = useState(false);
  const sessionRef = useRef<LiveSession | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('unlisted');
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  const [team1, setTeam1] = useState('');
  const [team2, setTeam2] = useState('');
  const [score1, setScore1] = useState(0);
  const [score2, setScore2] = useState(0);

  const scoreOverlay = session
    ? JSON.stringify({
        t1: team1.trim() || 'Команда 1',
        t2: team2.trim() || 'Команда 2',
        s1: score1,
        s2: score2,
      })
    : '';

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  const resetSession = () => {
    clearRetry();
    sessionRef.current = null;
    setSession(null);
    setStartedAt(null);
    setConnected(false);
  };

  // Re-opens the RTMP connection with the same stream key; the YouTube broadcast is untouched.
  const reconnect = useCallback(() => {
    clearRetry();
    const s = sessionRef.current;
    if (!s || AppState.currentState !== 'active') return;
    streamRef.current?.startStreaming(s.streamName, s.ingestionAddress);
  }, []);

  // Link dropped but the user hasn't stopped: keep the session and keep retrying.
  const onLinkLost = useCallback(() => {
    setConnected(false);
    if (!sessionRef.current) return;
    clearRetry();
    retryTimer.current = setTimeout(reconnect, 3000);
  }, [reconnect]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && sessionRef.current) reconnect();
    });
    return () => sub.remove();
  }, [reconnect]);

  const pickThumbnail = async () => {
    const res = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: 1,
    });
    const uri = res.assets?.[0]?.uri;
    if (uri) setThumbnail(uri);
  };

  const startLive = async () => {
    setBusy(true);
    setStreamError(null);
    try {
      const token = await getAccessToken();
      const s = await createLiveSession(
        token,
        title.trim() || `StreamWithScore ${new Date().toLocaleString()}`,
        privacy,
      );
      setScore1(0);
      setScore2(0);
      sessionRef.current = s;
      setSession(s);
      if (thumbnail) {
        // A thumbnail failure should not block the stream.
        setThumbnailApi(token, s.broadcastId, thumbnail).catch((e: Error) =>
          setStreamError(`Thumbnail: ${e.message}`),
        );
      }
      await streamRef.current?.startStreaming(s.streamName, s.ingestionAddress);
    } catch (e) {
      setStreamError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shareLive = async () => {
    if (!session) return;
    try {
      // iOS shows `url` as a link; Android only shares `message`, so the link goes inside it.
      await Share.share(
        Platform.OS === 'ios'
          ? { message: session.title, url: session.watchUrl }
          : { message: `${session.title}\n${session.watchUrl}` },
      );
    } catch (e) {
      setStreamError((e as Error).message);
    }
  };

  const confirmStop = () => {
    Alert.alert(
      'Закінчити трансляцію?',
      'Трансляція буде завершена для всіх глядачів.',
      [
        { text: 'Скасувати', style: 'cancel' },
        { text: 'Закінчити', style: 'destructive', onPress: stopLive },
      ],
    );
  };

  const stopLive = async () => {
    setBusy(true);
    clearRetry();
    const ended = sessionRef.current;
    // Clear first so the disconnect callback doesn't trigger a reconnect.
    sessionRef.current = null;
    streamRef.current?.stopStreaming();
    try {
      if (ended)
        await endBroadcast(await getAccessToken(), ended.broadcastId);
    } catch (e) {
      setStreamError((e as Error).message);
    } finally {
      resetSession();
      setBusy(false);
    }
  };

  if (!tokens) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>StreamWithScore</Text>
        <Pressable
          style={[styles.button, !ready && styles.disabled]}
          onPress={signIn}
          disabled={!ready}
        >
          <Text style={styles.buttonText}>Sign in with YouTube</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
        <StatusBar barStyle="dark-content" />
      </View>
    );
  }

  return (
    <View style={styles.full}>
      <ApiVideoLiveStreamView
        ref={streamRef}
        style={styles.full}
        camera={camera}
        isMuted={muted}
        // Burned into the video frames (iOS); empty string hides it.
        scoreOverlay={scoreOverlay}
        video={{
          fps: 30,
          // The library swaps width/height itself to match the device orientation.
          resolution: { width: 1280, height: 720 },
          bitrate: 2 * 1024 * 1024,
          gopDuration: 1,
        }}
        audio={{ bitrate: 128000, sampleRate: 44100, isStereo: true }}
        onConnectionFailed={code => {
          if (!sessionRef.current) return;
          setStreamError(`Connection failed: ${code}`);
          onLinkLost();
        }}
        onConnectionSuccess={() => {
          setStreamError(null);
          setConnected(true);
          setStartedAt(prev => prev ?? Date.now());
        }}
        onDisconnect={onLinkLost}
      />
      {!session && (
        <SafeAreaView
          style={styles.top}
          edges={['top', 'left', 'right']}
          pointerEvents="box-none"
        >
          <ScrollView
            style={{ maxHeight: height * 0.6 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.topContent}
          >
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Stream title"
                placeholderTextColor="#aaa"
                value={title}
                onChangeText={setTitle}
                maxLength={100}
              />
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.teamInput]}
                  placeholder="Команда 1"
                  placeholderTextColor="#aaa"
                  value={team1}
                  onChangeText={setTeam1}
                  maxLength={20}
                />
                <TextInput
                  style={[styles.input, styles.teamInput]}
                  placeholder="Команда 2"
                  placeholderTextColor="#aaa"
                  value={team2}
                  onChangeText={setTeam2}
                  maxLength={20}
                />
              </View>
              <View style={styles.row}>
                {(['public', 'unlisted', 'private'] as const).map(p => (
                  <Pressable
                    key={p}
                    style={[styles.chip, privacy === p && styles.chipActive]}
                    onPress={() => setPrivacy(p)}
                  >
                    <Text style={styles.chipText}>{p}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hint}>
                Формат: {isLandscape ? 'горизонтальний' : 'вертикальний'} —
                поверніть телефон, щоб змінити
              </Text>
              <Pressable style={styles.thumbRow} onPress={pickThumbnail}>
                {thumbnail && (
                  <Image source={{ uri: thumbnail }} style={styles.thumb} />
                )}
                <Text style={styles.link}>
                  {thumbnail ? 'Change thumbnail' : 'Choose thumbnail'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      )}
      {session && Platform.OS === 'android' && (
        // Android has no in-video overlay yet: this banner is visible on the phone only.
        <SafeAreaView
          style={styles.scoreWrap}
          edges={['top', 'left']}
          pointerEvents="none"
        >
          <View style={styles.scoreBanner}>
            <Text style={styles.scoreText}>
              {team1.trim() || 'Команда 1'} {score1} - {score2}{' '}
              {team2.trim() || 'Команда 2'}
            </Text>
          </View>
        </SafeAreaView>
      )}
      <View style={styles.overlay}>
        {session && (
          <>
            <Pressable onPress={() => Linking.openURL(session.watchUrl)}>
              <Text style={styles.live}>
                {startedAt
                  ? connected
                    ? `● LIVE ${formatDuration(now - startedAt)}`
                    : 'Reconnecting…'
                  : 'Connecting…'}{' '}
                — tap to open on YouTube
              </Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.shareButton]}
              onPress={shareLive}
            >
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
            <View style={styles.scoreControlsPanel}>
              {[
                {
                  name: team1.trim() || 'Команда 1',
                  value: score1,
                  set: setScore1,
                },
                {
                  name: team2.trim() || 'Команда 2',
                  value: score2,
                  set: setScore2,
                },
              ].map((t, i) => (
                <View key={i} style={styles.scoreColumn}>
                  <Text style={styles.teamName} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <View style={styles.scoreControls}>
                    <Pressable
                      style={styles.scoreBtn}
                      onPress={() => t.set(v => Math.max(0, v - 1))}
                    >
                      <Text style={styles.scoreBtnText}>−</Text>
                    </Pressable>
                    <Text style={styles.scoreValue}>{t.value}</Text>
                    <Pressable
                      style={styles.scoreBtn}
                      onPress={() => t.set(v => v + 1)}
                    >
                      <Text style={styles.scoreBtnText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
            {privacy === 'private' && (
              <Text style={styles.hint}>
                Private streams can only be watched by you.
              </Text>
            )}
          </>
        )}
        <View style={styles.row}>
          <Pressable
            style={[styles.button, styles.controlButton]}
            onPress={() => setCamera(c => (c === 'back' ? 'front' : 'back'))}
          >
            <Text style={styles.buttonText}>Перевернути камеру</Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              styles.controlButton,
              muted && styles.mutedButton,
            ]}
            onPress={() => setMuted(m => !m)}
          >
            <Text style={styles.buttonText}>
              {muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
            </Text>
          </Pressable>
        </View>
        {(streamError || error) && (
          <Text style={styles.error}>{streamError ?? error}</Text>
        )}
        <Pressable
          style={[styles.button, busy && styles.disabled]}
          disabled={busy}
          onPress={session ? confirmStop : startLive}
        >
          <Text style={styles.buttonText}>
            {session ? 'Закінчити трансляцію' : 'Go live'}
          </Text>
        </Pressable>
        {!session && (
          <Pressable onPress={signOut}>
            <Text style={styles.link}>Disconnect YouTube</Text>
          </Pressable>
        )}
      </View>
      <StatusBar barStyle="light-content" />
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topContent: { flexGrow: 0 },
  teamInput: { flex: 1 },
  scoreWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  scoreBanner: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  scoreLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  teamName: { color: '#fff', fontSize: 14, fontWeight: '600', maxWidth: 90 },
  scoreText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  scoreControls: { flexDirection: 'row', gap: 6 },
  scoreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreControlsPanel: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    padding: 8,
  },
  scoreColumn: { alignItems: 'center', gap: 4 },
  scoreValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    minWidth: 30,
    textAlign: 'center',
  },
  scoreBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  overlay: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  title: { fontSize: 24, fontWeight: '700' },
  button: {
    backgroundColor: '#FF0000',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  live: {
    color: '#fff',
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 6,
  },
  form: {
    alignSelf: 'stretch',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 12,
    borderRadius: 10,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: '#fff',
    padding: 10,
    borderRadius: 6,
    fontSize: 16,
  },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fff',
  },
  chipActive: { backgroundColor: '#FF0000', borderColor: '#FF0000' },
  chipText: { color: '#fff', textTransform: 'capitalize' },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 64, height: 36, borderRadius: 4 },
  controlButton: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mutedButton: { backgroundColor: '#b00020' },
  shareButton: { backgroundColor: '#1a73e8' },
  hint: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 6,
    borderRadius: 6,
  },
  link: { color: '#fff', textDecorationLine: 'underline' },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 6,
  },
});
