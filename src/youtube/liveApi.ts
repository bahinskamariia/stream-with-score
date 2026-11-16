const BASE = 'https://www.googleapis.com/youtube/v3';

export type LiveSession = {
  broadcastId: string;
  streamId: string;
  ingestionAddress: string;
  streamName: string;
  watchUrl: string;
  title: string;
};

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `YouTube API error ${res.status}`);
  return json as T;
}

/** Creates a broadcast + RTMP stream, binds them, and returns the ingest info. */
export type Privacy = 'public' | 'unlisted' | 'private';

export async function createLiveSession(
  token: string,
  title: string,
  privacyStatus: Privacy,
): Promise<LiveSession> {
  const broadcast = await call<{ id: string }>(token, 'liveBroadcasts?part=snippet,contentDetails,status', {
    snippet: { title, scheduledStartTime: new Date().toISOString() },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
    contentDetails: { enableAutoStart: true, enableAutoStop: true },
  });

  const stream = await call<{
    id: string;
    cdn: { ingestionInfo: { ingestionAddress: string; streamName: string } };
  }>(token, 'liveStreams?part=snippet,cdn,contentDetails', {
    snippet: { title },
    cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' },
  });

  await call(token, `liveBroadcasts/bind?id=${broadcast.id}&streamId=${stream.id}&part=id`);

  return {
    broadcastId: broadcast.id,
    streamId: stream.id,
    ingestionAddress: stream.cdn.ingestionInfo.ingestionAddress,
    streamName: stream.cdn.ingestionInfo.streamName,
    watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
    title,
  };
}

export async function endBroadcast(token: string, broadcastId: string) {
  await call(token, `liveBroadcasts/transition?broadcastStatus=complete&id=${broadcastId}&part=status`);
}

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/** Uploads a custom thumbnail (JPEG/PNG, max 2 MB). Requires a verified channel. */
export async function setThumbnail(token: string, videoId: string, imageUri: string) {
  const blob = await (await fetch(imageUri)).blob();
  if (blob.size > MAX_THUMBNAIL_BYTES) throw new Error('Thumbnail is larger than 2 MB');
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    },
  );
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error?.message ?? `Thumbnail upload failed (${res.status})`);
  }
}
