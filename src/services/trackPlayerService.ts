/**
 * TrackPlayerService - Audio Playback with Background Support
 *
 * Uses react-native-track-player as the primary audio engine for:
 * - Background playback (music plays when app is in background)
 * - Lock screen controls
 * - Notification controls (with artwork)
 * - Samsung Dynamic Island / Now Bar integration
 * - Bluetooth/headphone controls
 * - Android Auto support
 */

import TrackPlayer, {
  TrackType,
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  State,
} from "react-native-track-player";
import * as FileSystem from "expo-file-system";
import { getArtworkNotificationUri } from "./artworkThumbnails";
import { Track } from "../types/audio";
import { resolveContentUriToFileUriNative } from "./nativeLibraryIndexer";

let isInitialized = false;
let initializationPromise: Promise<boolean> | null = null;
const EXPLICITLY_UNSUPPORTED_CONTAINERS = new Set([
  "wma",
  "asf",
  "ra",
  "rm",
  "ape",
  "dsf",
  "dff",
  "mka",
  "tta",
  "wv",
]);
const KNOWN_PLAYABLE_CONTAINERS = new Set([
  "flac",
  "mp3",
  "mpeg",
  "m4a",
  "mp4",
  "aac",
  "alac",
  "wav",
  "ogg",
  "opus",
  "hls",
  "dash",
  "mpd",
]);
const runtimeUnsupportedTrackKeys = new Set<string>();
const mediaStoreFileUriCache = new Map<string, Promise<string | null>>();

function normalizeContainerToken(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/^\./, "");
}

function getUriContainerHint(uri?: string): string {
  const normalizedUri = (uri ?? "").trim().toLowerCase();
  const match = normalizedUri.match(/\.([a-z0-9]+)(\?|$)/);
  return normalizeContainerToken(match?.[1]);
}

function getTrackContainerHint(track: Track): string {
  const normalizedFormat = normalizeContainerToken(track.format);
  if (normalizedFormat) return normalizedFormat;
  return getUriContainerHint(track.uri);
}

function getRuntimeUnsupportedKeys(track: Track): string[] {
  const keys = new Set<string>();
  const id = track.id?.trim();
  if (id) keys.add(`id:${id}`);

  const normalizedUri = normalizePlaybackUri(track.uri || "").trim();
  if (normalizedUri) keys.add(`uri:${normalizedUri}`);

  return [...keys];
}

function isRuntimeUnsupportedTrack(track: Track): boolean {
  const keys = getRuntimeUnsupportedKeys(track);
  return keys.some((key) => runtimeUnsupportedTrackKeys.has(key));
}

export function shouldPersistRuntimeUnsupportedTrack(
  track: Track | null | undefined,
): boolean {
  if (!track) return false;
  const containerHint = getTrackContainerHint(track);
  if (!containerHint) return false;
  if (KNOWN_PLAYABLE_CONTAINERS.has(containerHint)) return false;
  return EXPLICITLY_UNSUPPORTED_CONTAINERS.has(containerHint);
}

export function markTrackAsUnsupported(
  track: Track | null | undefined,
  reason?: string,
): void {
  if (!track) return;
  const keys = getRuntimeUnsupportedKeys(track);
  if (keys.length === 0) return;
  keys.forEach((key) => runtimeUnsupportedTrackKeys.add(key));
  console.warn("[TrackPlayer] Marked track as unsupported in runtime session", {
    id: track.id,
    uri: track.uri,
    format: track.format,
    codec: track.codec,
    reason,
  });
}

function hasSupportedPlaybackUriScheme(uri: string): boolean {
  return (
    uri.startsWith("content://") ||
    uri.startsWith("file://") ||
    uri.startsWith("http://") ||
    uri.startsWith("https://") ||
    uri.startsWith("/") ||
    /^[a-z]:[\\/]/i.test(uri)
  );
}

function normalizePlaybackUri(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return trimmed;

  if (
    trimmed.startsWith("content://") ||
    trimmed.startsWith("file://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    return `file://${trimmed}`;
  }

  return trimmed;
}

function isMediaStoreAudioUri(uri: string): boolean {
  return /^content:\/\/media\/[^/]+\/audio\/media\/\d+/i.test(uri.trim());
}

function normalizeRelativePath(relativePath?: string): string {
  return (relativePath ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function encodePathSegments(pathValue: string): string {
  return pathValue
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildFilePlaybackUri(track: Track): string | null {
  const relativePath = normalizeRelativePath(track.relativePath);
  const fileName = (track._filename ?? "").trim();
  if (!relativePath || !fileName) return null;

  const safePath = encodePathSegments(relativePath);
  const safeFileName = encodeURIComponent(fileName);
  return `file:///storage/emulated/0/${safePath}/${safeFileName}`;
}

async function resolveNativePlaybackUrl(track: Track): Promise<string> {
  const normalizedUri = normalizePlaybackUri(track.uri);
  if (isMediaStoreAudioUri(normalizedUri)) {
    const fileUri = buildFilePlaybackUri(track);
    if (fileUri) {
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (info.exists) {
          return fileUri;
        }
      } catch {
        // Ignore and continue with safer fallbacks below.
      }
    }

    if (!mediaStoreFileUriCache.has(normalizedUri)) {
      mediaStoreFileUriCache.set(
        normalizedUri,
        resolveContentUriToFileUriNative(normalizedUri).catch(() => null),
      );
    }
    const nativeResolvedFileUri = await mediaStoreFileUriCache.get(normalizedUri)!;
    if (nativeResolvedFileUri) {
      const normalizedResolvedUri = normalizePlaybackUri(nativeResolvedFileUri);
      try {
        const info = await FileSystem.getInfoAsync(normalizedResolvedUri);
        if (info.exists) {
          return normalizedResolvedUri;
        }
      } catch {
        // Ignore and continue with content:// fallback.
      }
    }

    console.warn("[TrackPlayer] MediaStore URI without file fallback metadata", {
      id: track.id,
      uri: track.uri,
      relativePath: track.relativePath,
      filename: track._filename,
      format: track.format,
      codec: track.codec,
    });

    // Keep the original content:// URI as the final fallback.
    // On some devices, reconstructed file:/// paths can fail with Source error
    // while direct MediaStore access is still valid.
    return normalizedUri;
  }

  return normalizedUri;
}

export function isTrackPlayable(track: Track | null | undefined): boolean {
  const uri = track?.uri?.trim();
  if (!track || !uri || track.cloudOnly) return false;

  if (uri.startsWith("spotify://") || uri.startsWith("cloud://")) {
    return false;
  }

  if (isRuntimeUnsupportedTrack(track)) {
    return false;
  }

  const containerHint = getTrackContainerHint(track);
  if (
    containerHint &&
    EXPLICITLY_UNSUPPORTED_CONTAINERS.has(containerHint)
  ) {
    return false;
  }

  return hasSupportedPlaybackUriScheme(uri);
}

function normalizeArtworkUri(value?: string | null): string | undefined {
  const uri = value?.trim();
  if (!uri) return undefined;

  // Android Auto/Media3 frequently fails to render embedded data URIs.
  if (uri.startsWith("data:")) return undefined;

  if (
    uri.startsWith("content://") ||
    uri.startsWith("file://") ||
    uri.startsWith("http://") ||
    uri.startsWith("https://")
  ) {
    return uri;
  }

  if (uri.startsWith("/")) {
    return `file://${uri}`;
  }

  return undefined;
}

function resolveArtworkForQueue(track: Track): string | undefined {
  // Keep the native queue as light as possible on low-memory Android devices.
  // Artwork for the active item is injected separately via updateNowPlayingMetadata.
  return undefined;
}

async function resolveArtworkForNowPlaying(
  track: Track,
): Promise<string | undefined> {
  const notificationArtwork = await getArtworkNotificationUri(
    track.artwork,
  ).catch(() => undefined);
  if (notificationArtwork) {
    return normalizeArtworkUri(notificationArtwork);
  }

  return (
    normalizeArtworkUri(track.artworkThumb) ??
    normalizeArtworkUri(track.artwork)
  );
}

function getNativeStreamDescriptor(
  track: Track,
  playbackUriOverride?: string,
): {
  type?: TrackType;
  contentType?: string;
} {
  const uri = (playbackUriOverride ?? track.uri).trim().toLowerCase();
  const format = (track.format ?? "").trim().toLowerCase();
  const codec = (track.codec ?? "").trim().toLowerCase();

  if (uri.includes(".m3u8") || format === "hls") {
    return {
      type: TrackType.HLS,
      contentType: "application/vnd.apple.mpegurl",
    };
  }

  if (uri.includes(".mpd") || format === "dash" || format === "mpd") {
    return {
      type: TrackType.Dash,
      contentType: "application/dash+xml",
    };
  }

  // Local/MediaStore URIs frequently hide file extensions (content://.../media/<id>).
  // Provide a MIME hint from known format/codec metadata so ExoPlayer can parse reliably.
  if (
    format === "flac" ||
    codec.includes("flac") ||
    uri.includes(".flac")
  ) {
    return { contentType: "audio/flac" };
  }

  if (
    format === "mp3" ||
    codec.includes("mp3") ||
    codec.includes("mpeg") ||
    uri.includes(".mp3")
  ) {
    return { contentType: "audio/mpeg" };
  }

  if (
    format === "aac" ||
    format === "m4a" ||
    format === "alac" ||
    codec.includes("aac") ||
    codec.includes("alac") ||
    uri.includes(".m4a") ||
    uri.includes(".mp4")
  ) {
    return { contentType: "audio/mp4" };
  }

  if (format === "wav" || uri.includes(".wav")) {
    return { contentType: "audio/wav" };
  }

  if (
    format === "ogg" ||
    format === "opus" ||
    codec.includes("opus") ||
    uri.includes(".ogg") ||
    uri.includes(".opus")
  ) {
    return { contentType: "audio/ogg" };
  }

  return {};
}

async function buildNativeTrack(
  track: Track,
  options?: { artwork?: string },
): Promise<any> {
  if (!isTrackPlayable(track)) {
    throw new Error(
      `[TrackPlayer] Unsupported track URI for native playback: ${track.uri || "<empty>"}`,
    );
  }

  const playbackUrl = await resolveNativePlaybackUrl(track);
  const streamDescriptor = getNativeStreamDescriptor(track, playbackUrl);

  return {
    id: track.id,
    mediaId: track.id,
    url: playbackUrl,
    type: streamDescriptor.type,
    contentType: streamDescriptor.contentType,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    album: track.album || "Unknown Album",
    artwork: options?.artwork,
    duration: track.duration ? track.duration / 1000 : undefined,
    genre: track.genre,
    // Technical metadata preserved for UI
    format: track.format,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    quality: track.quality,
  };
}

/**
 * Initialize Track Player with full configuration
 */
export async function initializeTrackPlayer(): Promise<boolean> {
  if (isInitialized) return true;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      // Setup the player â€” optimized for local file playback
      await TrackPlayer.setupPlayer({
        // Buffer settings tuned for LOCAL files (not streaming)
        // Local files read from disk instantly, so minimal buffering needed
        minBuffer: 5,
        maxBuffer: 15,
        // CRITICAL: Start playing almost immediately
        playBuffer: 0.1,
        maxCacheSize: 1024 * 100,
        autoHandleInterruptions: true,
      });

      // Configure capabilities (what buttons to show)
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.PlayFromId,
          Capability.PlayFromSearch,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.Skip,
          Capability.Stop,
        ],
        // Android specific options
        android: {
          // Stop playback and remove notification when the app is swiped away
          appKilledPlaybackBehavior:
            AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        },
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.Skip,
          Capability.Stop,
        ],
        // Progress bar update interval in seconds
        progressUpdateEventInterval: 1,
      });

      isInitialized = true;
      console.log("[TrackPlayer] Initialized successfully");
      return true;
    } catch (error) {
      console.error("[TrackPlayer] Setup failed:", error);
      return false;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * Check if Track Player is ready
 */
export function isTrackPlayerReady(): boolean {
  return isInitialized;
}

/**
 * Play a single track â€” optimized for near-instant start.
 * BUG FIX: Uses reset()+add() instead of load() for absolute queue reliability.
 */
export async function playTrack(track: Track): Promise<void> {
  if (!isInitialized) {
    const initialized = await initializeTrackPlayer();
    if (!initialized) {
      throw new Error("Track Player initialization failed");
    }
  }

  try {
    if (!isTrackPlayable(track)) {
      throw new Error(
        `[TrackPlayer] Cannot play track with unsupported URI: ${track.uri || "<empty>"}`,
      );
    }

    // CRITICAL BUG FIX: reset() ensures the native queue is completely empty.
    // load() can sometimes preserve metadata from previous sessions on buggy Android versions.
    await TrackPlayer.reset();

    const trackData = await buildNativeTrack(track, {
      artwork: resolveArtworkForQueue(track),
    });

    await TrackPlayer.add([trackData]);
    await TrackPlayer.play();
    await updateNowPlayingTrackMetadata(track);
  } catch (error) {
    console.error("[TrackPlayer] Play error:", error);
    throw error;
  }
}

/**
 * Play a queue of tracks starting at a specific index
 */
export async function playQueue(
  tracks: Track[],
  startIndex: number = 0,
): Promise<void> {
  if (!isInitialized) {
    const initialized = await initializeTrackPlayer();
    if (!initialized) {
      throw new Error("Track Player initialization failed");
    }
  }

  try {
    if (tracks.length === 0) return;

    const safeRequestedIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const indexedTracks = tracks.map((track, index) => ({ track, index }));
    const unsupportedTracks = indexedTracks
      .filter(({ track }) => !isTrackPlayable(track))
      .map(({ track }) => track);
    if (unsupportedTracks.length > 0) {
      console.warn(
        "[TrackPlayer] Filtering unsupported native tracks from queue:",
        unsupportedTracks.map((track) => ({
          id: track.id,
          uri: track.uri,
          source: track.source,
          cloudOnly: track.cloudOnly,
        })),
      );
    }

    const playableEntries = indexedTracks.filter(({ track }) => isTrackPlayable(track));
    const playableTracks = playableEntries.map(({ track }) => track);
    if (playableTracks.length === 0) {
      throw new Error("[TrackPlayer] Queue does not contain any playable tracks");
    }

    let normalizedStartIndex = playableEntries.findIndex(
      ({ track }) => track.id === tracks[safeRequestedIndex]?.id,
    );
    if (normalizedStartIndex < 0) {
      normalizedStartIndex = playableEntries.findIndex(
        ({ index }) => index > safeRequestedIndex,
      );
    }
    if (normalizedStartIndex < 0) {
      normalizedStartIndex = Math.min(safeRequestedIndex, playableTracks.length - 1);
    }

    await TrackPlayer.reset();

    const trackPlayerTracks = await Promise.all(playableTracks.map((track) =>
      buildNativeTrack(track, {
        artwork: resolveArtworkForQueue(track),
      }),
    ));

    const safeIndex = Math.max(
      0,
      Math.min(normalizedStartIndex, trackPlayerTracks.length - 1),
    );

    await TrackPlayer.add(trackPlayerTracks);
    if (safeIndex > 0) {
      await TrackPlayer.skip(safeIndex);
    }
    await TrackPlayer.play();
    await updateNowPlayingTrackMetadata(playableTracks[safeIndex] ?? null);

    console.log(
      "[TrackPlayer] Playing queue, starting at:",
      playableTracks[safeIndex]?.title,
      {
        queueSize: trackPlayerTracks.length,
        nativeArtworkItems: trackPlayerTracks.filter((track) => !!track.artwork)
          .length,
      },
    );
  } catch (error) {
    console.error("[TrackPlayer] Play queue error:", error);
    throw error;
  }
}

/**
 * Pause playback
 */
export async function pause(): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.pause();
  console.log("[TrackPlayer] Paused");
}

/**
 * Resume playback
 */
export async function resume(): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.play();
  console.log("[TrackPlayer] Resumed");
}

/**
 * Toggle play/pause
 */
export async function togglePlayPause(): Promise<void> {
  if (!isInitialized) return;

  const state = await TrackPlayer.getPlaybackState();
  if (state.state === State.Playing) {
    await pause();
  } else {
    await resume();
  }
}

/**
 * Stop playback
 */
export async function stop(): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.stop();
  await TrackPlayer.reset();
  console.log("[TrackPlayer] Stopped");
}

/**
 * Seek to position in seconds
 */
export async function seekTo(positionSeconds: number): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.seekTo(positionSeconds);
  console.log("[TrackPlayer] Seeked to:", positionSeconds);
}

/**
 * Skip to next track
 */
export async function skipToNext(): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.skipToNext();
  console.log("[TrackPlayer] Skipped to next");
}

/**
 * Skip to previous track (or restart if more than 3 seconds in)
 */
export async function skipToPrevious(): Promise<void> {
  if (!isInitialized) return;

  const progress = await TrackPlayer.getProgress();
  if (progress.position > 3) {
    await TrackPlayer.seekTo(0);
  } else {
    await TrackPlayer.skipToPrevious();
  }
  console.log("[TrackPlayer] Skipped to previous");
}

/**
 * Skip to specific track in queue
 */
export async function skipToTrack(index: number): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.skip(index);
  console.log("[TrackPlayer] Skipped to track:", index);
}

/**
 * Skip to a track by its ID in the native engine queue.
 * This is the safe way to navigate when the store's queue order differs from the
 * native engine's queue order (e.g. after shuffle).
 *
 * @param trackId The ID of the track to skip to.
 * @returns Whether the skip was successful.
 */
export async function skipToTrackById(trackId: string): Promise<boolean> {
  if (!isInitialized) return false;

  try {
    const queue = (await TrackPlayer.getQueue()) as any[];
    const nativeIds = queue.map((t) => t.id?.toString() ?? "");
    const nativeIndex = nativeIds.indexOf(trackId);

    if (nativeIndex < 0) {
      console.warn(
        "[TrackPlayer] skipToTrackById: track NOT FOUND in native queue:",
        trackId,
      );
      console.log("[TrackPlayer] Native Queue Track IDs:", nativeIds);
      return false;
    }
    await TrackPlayer.skip(nativeIndex);
    console.log(
      "[TrackPlayer] skipToTrackById: skipped to index",
      nativeIndex,
      "for id",
      trackId,
    );
    return true;
  } catch (error) {
    console.error("[TrackPlayer] skipToTrackById error:", error);
    return false;
  }
}

/**
 * Synchronize the native engine queue order to match a target list of track IDs.
 * Uses TrackPlayer.move() to reorder without interrupting playback.
 * This ensures the engine's "Next" track is correctly aligned with the store's queue.
 */
export async function syncNativeQueue(targetTrackIds: string[]): Promise<void> {
  if (!isInitialized) return;
  if (targetTrackIds.length === 0) return;

  try {
    const nativeQueue = await TrackPlayer.getQueue();

    // Match only what's currently in the native queue
    const nativeIds = nativeQueue.map((t: any) => t.id?.toString() ?? "");

    // Local state tracking to update indices after each move
    let currentNativeQueueIds = [...nativeIds];

    for (let targetIdx = 0; targetIdx < targetTrackIds.length; targetIdx++) {
      const targetId = targetTrackIds[targetIdx];
      const currentIdx = currentNativeQueueIds.indexOf(targetId);

      if (currentIdx !== -1 && currentIdx !== targetIdx) {
        // Perform movement in native engine
        await TrackPlayer.move(currentIdx, targetIdx);

        // Locally track the move for the next iteration's index calculations
        const item = currentNativeQueueIds.splice(currentIdx, 1)[0];
        currentNativeQueueIds.splice(targetIdx, 0, item);
      }
    }

    console.log("[TrackPlayer] Native queue synced via moves");
  } catch (error) {
    console.error("[TrackPlayer] syncNativeQueue error:", error);
  }
}

/**
 * Remove tracks from native queue by index
 */
export async function removeTracks(indices: number[]): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.remove(indices);
  console.log("[TrackPlayer] Removed tracks at indices:", indices);
}

/**
 * Set volume (0-1)
 */
export async function setVolume(volume: number): Promise<void> {
  if (!isInitialized) return;
  await TrackPlayer.setVolume(Math.max(0, Math.min(1, volume)));
  console.log("[TrackPlayer] Volume set to:", volume);
}

/**
 * Set repeat mode
 */
export async function setRepeatMode(
  mode: "off" | "all" | "one",
): Promise<void> {
  if (!isInitialized) return;

  const repeatModes = {
    off: RepeatMode.Off,
    all: RepeatMode.Queue,
    one: RepeatMode.Track,
  };

  await TrackPlayer.setRepeatMode(repeatModes[mode]);
  console.log("[TrackPlayer] Repeat mode:", mode);
}

/**
 * Refresh the active notification / lock-screen metadata without bloating the
 * whole native queue payload.
 */
export async function updateNowPlayingTrackMetadata(
  track: Track | null,
): Promise<void> {
  if (!isInitialized || !track) return;

  try {
    const artwork = await resolveArtworkForNowPlaying(track);
    await TrackPlayer.updateNowPlayingMetadata({
      title: track.title || "Unknown Title",
      artist: track.artist || "Unknown Artist",
      album: track.album || "Unknown Album",
      artwork,
    });
  } catch (error) {
    console.warn(
      "[TrackPlayer] Failed to refresh now playing metadata:",
      error,
    );
  }
}

/**
 * Get current playback state
 */
export async function getPlaybackState(): Promise<State | null> {
  if (!isInitialized) return null;
  const state = await TrackPlayer.getPlaybackState();
  return state.state;
}

/**
 * Get current progress (position, duration, buffered)
 */
export async function getProgress(): Promise<{
  position: number;
  duration: number;
  buffered: number;
}> {
  if (!isInitialized) return { position: 0, duration: 0, buffered: 0 };
  return TrackPlayer.getProgress();
}

/**
 * Get current track
 * BUG FIX: Use getActiveTrack() exclusively for better metadata reliability.
 */
export async function getCurrentTrack(): Promise<Track | null> {
  if (!isInitialized) return null;

  try {
    const track = await TrackPlayer.getActiveTrack();
    if (!track) return null;

    return {
      id: track.id?.toString() || "",
      uri: track.url,
      title: track.title || "",
      artist: track.artist || "",
      album: track.album || "",
      artwork: track.artwork as string | undefined,
      duration: (track.duration || 0) * 1000,
      format: (track as any).format,
      sampleRate: (track as any).sampleRate,
      bitDepth: (track as any).bitDepth,
      quality: (track as any).quality,
      dateAdded: Date.now(),
    };
  } catch (error) {
    console.error("[TrackPlayer] Error getting current track:", error);
    return null;
  }
}

/**
 * Get current active track index
 */
export async function getActiveTrackIndex(): Promise<number> {
  if (!isInitialized) return -1;
  const index = await TrackPlayer.getActiveTrackIndex();
  return index ?? -1;
}

/**
 * Check if currently playing
 */
export async function isPlaying(): Promise<boolean> {
  if (!isInitialized) return false;
  const state = await TrackPlayer.getPlaybackState();
  return state.state === State.Playing;
}

/**
 * Add event listener for playback events
 */
export function addEventListener(event: Event, callback: (data: any) => void) {
  return TrackPlayer.addEventListener(event, callback);
}

/**
 * Destroy Track Player
 */
export async function destroyTrackPlayer(): Promise<void> {
  if (!isInitialized) return;

  try {
    await TrackPlayer.reset();
    isInitialized = false;
    console.log("[TrackPlayer] Destroyed");
  } catch (error) {
    console.error("[TrackPlayer] Destroy failed:", error);
  }
}

// Re-export types and enums for convenience
export { Event, RepeatMode, State };
