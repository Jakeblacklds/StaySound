import type { Track } from '@staysound/types/audio';

export interface WebAudioState {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  position: number;
  duration: number;
  volume: number;
  repeatMode: 'off' | 'one' | 'all';
  shuffleEnabled: boolean;
  error: string | null;
}

type Listener = (state: WebAudioState) => void;

const initialState: WebAudioState = {
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  isLoading: false,
  position: 0,
  duration: 0,
  volume: 0.9,
  repeatMode: 'off',
  shuffleEnabled: false,
  error: null,
};

class WebAudioEngine {
  private audio = new Audio();
  private listeners = new Set<Listener>();
  private state: WebAudioState = { ...initialState };
  private lastLinearQueue: Track[] = [];
  private outputGain: GainNode | null = null;
  private handlingEnded = false;
  /** Resolves a playable URL for a track whose blob: URL died between sessions. */
  private resolveTrackUri?: (track: Track) => Promise<string | null>;

  setTrackUriResolver(resolver: (track: Track) => Promise<string | null>): void {
    this.resolveTrackUri = resolver;
  }

  /**
   * Some files cannot be seeked exactly by the platform's media stack — FLAC
   * in WKWebView lands seconds away from the requested time while
   * `currentTime` reports the request, and every lyric view follows
   * `currentTime`. The resolver returns a copy that seeks exactly (or null).
   * It is prepared while the track plays and swapped in on the first seek:
   * the listener asked for a jump there anyway, so the switch is not heard.
   */
  private resolvePreciseUri?: (track: Track) => Promise<string | null>;
  private precise: { trackId: string; settled: boolean; uri: string | null; request: Promise<string | null> } | null = null;
  /** The track whose precise copy is now the element's source. */
  private preciseActiveFor: string | null = null;
  /** Latest seek asked for while the precise copy was still being prepared. */
  private pendingPreciseSeek: number | null = null;

  /**
   * Some tracks' files were replaced (the library moved from FLAC to ALAC).
   * Queue entries get the new file; the song playing right now is reopened
   * from its new file at the same point, since the old one is gone.
   */
  replaceTrackSources(updated: Track[]): void {
    if (!updated.length) return;
    const byId = new Map(updated.map(track => [track.id, track]));
    const swap = (track: Track) => byId.get(track.id) ?? track;
    this.lastLinearQueue = this.lastLinearQueue.map(swap);
    const current = this.state.currentTrack;
    const replacement = current ? byId.get(current.id) : undefined;
    this.patch({ queue: this.state.queue.map(swap), currentTrack: replacement ?? current });
    if (!replacement || !replacement.uri) return;
    const positionMs = this.audio.currentTime * 1000;
    const resume = !this.audio.paused;
    this.audio.addEventListener('loadedmetadata', () => {
      this.audio.currentTime = positionMs / 1000;
      if (resume) void this.audio.play().catch(() => undefined);
    }, { once: true });
    this.audio.src = replacement.uri;
    this.audio.load();
    this.preparePreciseSource(replacement);
  }

  setPreciseSourceResolver(resolver: (track: Track) => Promise<string | null>): void {
    this.resolvePreciseUri = resolver;
  }

  private preparePreciseSource(track: Track): void {
    this.preciseActiveFor = null;
    this.pendingPreciseSeek = null;
    if (!this.resolvePreciseUri) {
      this.precise = null;
      return;
    }
    const request = this.resolvePreciseUri(track).catch(() => null);
    const entry = { trackId: track.id, settled: false, uri: null as string | null, request };
    this.precise = entry;
    void request.then(uri => {
      entry.settled = true;
      entry.uri = uri;
      if (this.precise !== entry || this.state.currentTrack?.id !== track.id) return;
      const target = this.pendingPreciseSeek;
      this.pendingPreciseSeek = null;
      if (target == null) return;
      if (uri) this.swapToPreciseSource(uri, target);
      else this.audio.currentTime = target / 1000;
    });
  }

  private swapToPreciseSource(uri: string, positionMs: number): void {
    const track = this.state.currentTrack;
    if (!track) return;
    const resume = this.state.isPlaying || !this.audio.paused;
    const fallback = this.audio.currentSrc || this.audio.src;
    this.preciseActiveFor = track.id;
    const cleanup = () => {
      this.audio.removeEventListener('loadedmetadata', handleReady);
      this.audio.removeEventListener('error', handleError);
    };
    const handleReady = () => {
      cleanup();
      this.audio.currentTime = positionMs / 1000;
      if (resume) void this.audio.play().catch(() => undefined);
    };
    // A copy that will not load must not cost the listener the song.
    const handleError = () => {
      cleanup();
      this.preciseActiveFor = null;
      if (this.precise?.trackId === track.id) this.precise = null;
      this.audio.src = fallback;
      this.audio.load();
      this.audio.addEventListener('loadedmetadata', () => {
        this.audio.currentTime = positionMs / 1000;
        if (resume) void this.audio.play().catch(() => undefined);
      }, { once: true });
    };
    this.audio.addEventListener('loadedmetadata', handleReady);
    this.audio.addEventListener('error', handleError);
    this.audio.src = uri;
    this.audio.load();
  }

  constructor() {
    this.audio.preload = 'metadata';
    this.audio.addEventListener('loadstart', () => this.patch({ isLoading: true, error: null }));
    this.audio.addEventListener('loadedmetadata', () => this.patch({ duration: this.secondsToMs(this.audio.duration), isLoading: false }));
    this.audio.addEventListener('timeupdate', () => this.patch({ position: this.secondsToMs(this.audio.currentTime) }));
    this.audio.addEventListener('play', () => this.patch({ isPlaying: true, isLoading: false }));
    this.audio.addEventListener('pause', () => this.patch({ isPlaying: false }));
    this.audio.addEventListener('waiting', () => this.patch({ isLoading: true }));
    this.audio.addEventListener('canplay', () => this.patch({ isLoading: false }));
    this.audio.addEventListener('ended', () => void this.handleEnded());
    this.audio.addEventListener('error', () => {
      this.patch({
        isPlaying: false,
        isLoading: false,
        error: 'No se pudo reproducir este archivo. Reimpórtalo o prueba otro formato.',
      });
    });
    // WKWebView can defer media events while its window is in the background.
    // Reconcile the native media element as soon as the app becomes active so
    // a deferred track ending cannot leave the queue stuck.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.recoverAfterBackground();
    });
    window.addEventListener('focus', () => void this.recoverAfterBackground());
    window.addEventListener('pageshow', () => void this.recoverAfterBackground());
    this.setVolume(initialState.volume);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): WebAudioState {
    return { ...this.state, queue: [...this.state.queue] };
  }

  getCurrentTime(): number {
    return this.audio.currentTime;
  }

  getAudioElement(): HTMLAudioElement {
    return this.audio;
  }

  /**
   * The URL a non-playback consumer (the waveform analyser) can fetch this
   * track from. The currently loaded element already holds a resolved URL, so
   * prefer it over re-running the relinker and re-prompting for file handles.
   */
  async resolvePlayableUri(track: Track): Promise<string | null> {
    if (this.state.currentTrack?.id === track.id && this.audio.currentSrc) return this.audio.currentSrc;
    if (track.uri) return track.uri;
    if (!this.resolveTrackUri) return null;
    try {
      return await this.resolveTrackUri(track);
    } catch {
      return null;
    }
  }

  /**
   * Once the media element is routed through Web Audio (for the spectrum
   * visualizer), control loudness in that graph. WebKit/WKWebView can ignore
   * HTMLMediaElement.volume after createMediaElementSource(), which made both
   * desktop volume sliders stop affecting a playing track.
   */
  attachOutputGain(gain: GainNode): void {
    this.outputGain = gain;
    this.audio.volume = 1;
    this.applyVolume(this.state.volume);
  }

  setQueue(track: Track, queue: Track[], autoPlay = false): void {
    const index = Math.max(0, queue.findIndex(item => item.id === track.id));
    this.lastLinearQueue = [...queue];
    this.patch({
      queue: [...queue],
      queueIndex: index,
      currentTrack: queue[index] ?? track,
      position: 0,
      duration: queue[index]?.duration ?? track.duration ?? 0,
      error: null,
    });
    void this.loadCurrentTrack(autoPlay);
  }

  async play(track?: Track, queue?: Track[]): Promise<void> {
    if (track) {
      // setQueue drives the (possibly async) load + play for us.
      this.setQueue(track, queue && queue.length > 0 ? queue : [track], true);
      return;
    }

    if (!this.state.currentTrack) return;

    // Resuming: if the current track was never linked this session, resolve it.
    if (!this.audio.src) {
      await this.loadCurrentTrack(true);
      return;
    }

    try {
      await this.audio.play();
      this.patch({ isPlaying: true, error: null });
    } catch (error) {
      const message = error instanceof Error && error.name === 'NotAllowedError'
        ? 'Toca play otra vez para iniciar audio en este navegador.'
        : 'No se pudo iniciar la reproducción.';
      this.patch({ isPlaying: false, isLoading: false, error: message });
    }
  }

  pause(): void {
    this.audio.pause();
  }

  toggle(): void {
    if (this.state.isPlaying) {
      this.pause();
      return;
    }
    void this.play();
  }

  seek(positionMs: number): void {
    const target = Math.max(0, positionMs);
    this.patch({ position: target });
    const precise = this.precise;
    const trackId = this.state.currentTrack?.id;
    // Seeking to the very start is exact in any file.
    if (precise && trackId === precise.trackId && this.preciseActiveFor !== trackId && target > 0) {
      if (!precise.settled) {
        this.pendingPreciseSeek = target;
        return;
      }
      if (precise.uri) {
        this.swapToPreciseSource(precise.uri, target);
        return;
      }
    }
    this.audio.currentTime = target / 1000;
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const nextVolume = Math.max(0, Math.min(1, volume));
    this.applyVolume(nextVolume);
    this.patch({ volume: nextVolume });
  }

  setRepeatMode(repeatMode: WebAudioState['repeatMode']): void {
    this.patch({ repeatMode });
  }

  setShuffleEnabled(shuffleEnabled: boolean): void {
    if (shuffleEnabled === this.state.shuffleEnabled) return;

    if (shuffleEnabled) {
      const current = this.state.currentTrack;
      const rest = this.state.queue.filter(track => track.id !== current?.id);
      const shuffled = [...rest].sort(() => Math.random() - 0.5);
      const nextQueue = current ? [current, ...shuffled] : shuffled;
      this.patch({ shuffleEnabled, queue: nextQueue, queueIndex: current ? 0 : -1 });
      return;
    }

    const currentId = this.state.currentTrack?.id;
    const nextIndex = Math.max(0, this.lastLinearQueue.findIndex(track => track.id === currentId));
    this.patch({ shuffleEnabled, queue: [...this.lastLinearQueue], queueIndex: nextIndex });
  }

  next(): void {
    const nextIndex = this.getNextIndex();
    if (nextIndex < 0) {
      this.pause();
      return;
    }
    this.goToIndex(nextIndex);
  }

  previous(): void {
    if (this.state.position > 3000) {
      this.seek(0);
      return;
    }
    const previousIndex = this.state.queueIndex > 0 ? this.state.queueIndex - 1 : -1;
    if (previousIndex >= 0) this.goToIndex(previousIndex);
  }

  private async handleEnded(): Promise<void> {
    if (this.handlingEnded) return;
    this.handlingEnded = true;
    try {
      if (this.state.repeatMode === 'one') {
        this.seek(0);
        await this.play();
        return;
      }

      const nextIndex = this.getNextIndex();
      if (nextIndex < 0) {
        this.pause();
        return;
      }

      // An HTMLMediaElement becomes paused before/while `ended` is emitted.
      // Do not derive autoplay from state.isPlaying here: it may already be
      // false even though the user was listening continuously.
      this.goToIndex(nextIndex, true);
    } finally {
      this.handlingEnded = false;
    }
  }

  private async recoverAfterBackground(): Promise<void> {
    if (!this.state.currentTrack) return;

    if (this.audio.ended) {
      await this.handleEnded();
      return;
    }

    // If WebKit interrupted the media element without delivering a pause
    // event, preserve the user's playing intent when the app becomes active.
    if (this.state.isPlaying && this.audio.paused) {
      await this.play();
    }
  }

  private getNextIndex(): number {
    if (this.state.queue.length === 0) return -1;
    const nextIndex = this.state.queueIndex + 1;
    if (nextIndex < this.state.queue.length) return nextIndex;
    return this.state.repeatMode === 'all' ? 0 : -1;
  }

  /** Jump to a specific index in the queue and start playing */
  playAtIndex(index: number): void {
    this.goToIndex(index, true);
  }

  private goToIndex(index: number, autoPlay = this.state.isPlaying): void {
    const nextTrack = this.state.queue[index];
    if (!nextTrack) return;
    this.patch({
      currentTrack: nextTrack,
      queueIndex: index,
      position: 0,
      duration: nextTrack.duration ?? 0,
      error: null,
    });
    void this.loadCurrentTrack(autoPlay);
  }

  private async loadCurrentTrack(autoPlay: boolean): Promise<void> {
    const track = this.state.currentTrack;
    if (!track) return;

    // Lazily re-link tracks whose blob: URL didn't survive the last session.
    let uri = track.uri;
    if (!uri && this.resolveTrackUri) {
      this.patch({ isLoading: true, error: null });
      try {
        uri = (await this.resolveTrackUri(track)) ?? '';
      } catch {
        uri = '';
      }
      // The user may have skipped to another track while we were resolving.
      if (this.state.currentTrack?.id !== track.id) return;
    }

    if (!uri) {
      this.patch({ isLoading: false, error: 'Este track necesita reimportarse antes de reproducir.' });
      return;
    }

    this.audio.src = uri;
    this.audio.load();
    this.preparePreciseSource(track);
    this.updateMediaSession({ ...track, uri });

    if (autoPlay) {
      try {
        await this.audio.play();
        this.patch({ isPlaying: true, error: null });
      } catch (error) {
        const message = error instanceof Error && error.name === 'NotAllowedError'
          ? 'Toca play otra vez para iniciar audio en este navegador.'
          : 'No se pudo iniciar la reproducción.';
        this.patch({ isPlaying: false, isLoading: false, error: message });
      }
    }
  }

  private updateMediaSession(track: Track): void {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork ? [{ src: track.artwork }] : undefined,
    });
    navigator.mediaSession.setActionHandler('play', () => void this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', details => {
      if (typeof details.seekTime === 'number') this.seek(details.seekTime * 1000);
    });
  }

  private secondsToMs(value: number): number {
    return Number.isFinite(value) ? Math.round(value * 1000) : 0;
  }

  private applyVolume(volume: number): void {
    if (this.outputGain) {
      this.audio.volume = 1;
      this.outputGain.gain.value = volume;
      return;
    }
    this.audio.volume = volume;
  }

  private patch(partial: Partial<WebAudioState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.getState());
  }
}

export const webAudioEngine = new WebAudioEngine();
