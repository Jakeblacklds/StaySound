import { karaokeStemUrl, type KaraokeStems } from './karaokeDesktop';

export interface KaraokeSpectrumFrame {
  bass: number;
  mid: number;
  treble: number;
  level: number;
  vocalPitch: number;
  vocalEnergy: number;
  kick: number;
  midHit: number;
  sparkle: number;
}

export type KaraokePlaybackMode = 'instrumental' | 'original';

type PositionListener = (positionMs: number, durationMs: number) => void;

const ZERO_FRAME: KaraokeSpectrumFrame = {
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  vocalPitch: 0.5,
  vocalEnergy: 0,
  kick: 0,
  midHit: 0,
  sparkle: 0,
};

function waitForMedia(media: HTMLMediaElement): Promise<void> {
  if (media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('No pude cargar las pistas separadas.'));
    };
    const cleanup = () => {
      media.removeEventListener('canplay', ready);
      media.removeEventListener('error', failed);
    };
    media.addEventListener('canplay', ready, { once: true });
    media.addEventListener('error', failed, { once: true });
  });
}

function nextPaint(): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
}

export class KaraokeMixer {
  private instrumental = new Audio();
  private vocals = new Audio();
  private context: AudioContext | null = null;
  private instrumentalGain: GainNode | null = null;
  private vocalsGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private mixAnalyser: AnalyserNode | null = null;
  private vocalAnalyser: AnalyserNode | null = null;
  private mixData: Uint8Array<ArrayBuffer> | null = null;
  private vocalData: Uint8Array<ArrayBuffer> | null = null;
  private animationFrame = 0;
  private lastDriftCorrection = 0;
  private positionListener: PositionListener | null = null;
  private masterVolume = 0.9;
  private playing = false;
  private aligning = false;
  private destroyed = false;
  private smoothedFrame = { ...ZERO_FRAME };
  private previousBands = { bass: 0, mid: 0, treble: 0 };
  private bandFloor = { bass: 0.08, mid: 0.08, treble: 0.045 };
  private lastSampleAt = 0;

  constructor() {
    this.instrumental.preload = 'auto';
    this.vocals.preload = 'auto';
  }

  async load(stems: KaraokeStems, startPositionMs: number): Promise<void> {
    this.instrumental.src = karaokeStemUrl(stems.instrumentalPath);
    this.vocals.src = karaokeStemUrl(stems.vocalsPath);
    this.instrumental.load();
    this.vocals.load();
    await Promise.all([
      waitForMedia(this.instrumental),
      waitForMedia(this.vocals),
    ]);
    this.createGraph();
    this.seek(startPositionMs);
    this.tick();
  }

  private createGraph(): void {
    const AudioContextCtor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Este equipo no expone el mezclador de audio necesario.');
    const context = new AudioContextCtor();
    const instrumentalSource = context.createMediaElementSource(this.instrumental);
    const vocalSource = context.createMediaElementSource(this.vocals);
    const instrumentalGain = context.createGain();
    const vocalsGain = context.createGain();
    const masterGain = context.createGain();
    const mixAnalyser = context.createAnalyser();
    const vocalAnalyser = context.createAnalyser();

    mixAnalyser.fftSize = 2048;
    mixAnalyser.smoothingTimeConstant = 0.48;
    vocalAnalyser.fftSize = 2048;
    vocalAnalyser.smoothingTimeConstant = 0.46;

    instrumentalSource.connect(instrumentalGain);
    instrumentalGain.connect(mixAnalyser);
    vocalSource.connect(vocalAnalyser);
    vocalAnalyser.connect(vocalsGain);
    vocalsGain.connect(mixAnalyser);
    mixAnalyser.connect(masterGain);
    masterGain.connect(context.destination);

    this.instrumental.volume = 1;
    this.vocals.volume = 1;
    this.context = context;
    this.instrumentalGain = instrumentalGain;
    this.vocalsGain = vocalsGain;
    this.masterGain = masterGain;
    this.mixAnalyser = mixAnalyser;
    this.vocalAnalyser = vocalAnalyser;
    this.mixData = new Uint8Array(mixAnalyser.frequencyBinCount);
    this.vocalData = new Uint8Array(vocalAnalyser.frequencyBinCount);
    this.applyLevels();
  }

  async play(): Promise<void> {
    if (this.destroyed) return;
    if (this.context?.state === 'suspended') await this.context.resume();
    this.aligning = true;
    this.silenceMix();
    try {
      const instrumentalPlayback = this.instrumental.play();
      const vocalPlayback = this.vocals.play();
      await Promise.all([instrumentalPlayback, vocalPlayback]);

      // WebKit starts independent media elements on different decoder turns.
      // Align only after both play() promises resolve, while both gains are at
      // zero. Repeating across two paints also absorbs an asynchronous seek.
      this.syncStems(true);
      await nextPaint();
      this.syncStems(true);
      await nextPaint();
      this.syncStems(true);
      if (this.destroyed) {
        this.aligning = false;
        return;
      }
      this.aligning = false;
      this.fadeInMix();
      this.playing = true;
    } catch (error) {
      this.pause();
      throw error;
    }
  }

  pause(): void {
    this.instrumental.pause();
    this.vocals.pause();
    this.vocals.playbackRate = 1;
    this.aligning = false;
    this.playing = false;
  }

  toggle(): Promise<void> | void {
    if (this.playing) {
      this.pause();
      return;
    }
    return this.play();
  }

  seek(positionMs: number): void {
    const seconds = Math.max(0, positionMs / 1000);
    this.instrumental.currentTime = seconds;
    this.vocals.currentTime = seconds;
    this.vocals.playbackRate = 1;
    this.lastDriftCorrection = 0;
    if (this.playing) {
      window.requestAnimationFrame(() => this.syncStems(true));
    }
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.applyLevels();
  }

  onPosition(listener: PositionListener): void {
    this.positionListener = listener;
  }

  getPosition(): number {
    return Math.round(this.instrumental.currentTime * 1000);
  }

  getDuration(): number {
    return Math.round((this.instrumental.duration || 0) * 1000);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  sampleSpectrum(): KaraokeSpectrumFrame {
    // The envelopes below advance once per call with fixed rates, so more than
    // one visual layer sampling the same frame would smooth twice as fast.
    // Everything painted inside a single animation frame shares one reading.
    const now = performance.now();
    if (now - this.lastSampleAt < 8) return this.smoothedFrame;
    this.lastSampleAt = now;
    const mixAnalyser = this.mixAnalyser;
    const vocalAnalyser = this.vocalAnalyser;
    const mixData = this.mixData;
    const vocalData = this.vocalData;
    const context = this.context;
    if (!mixAnalyser || !vocalAnalyser || !mixData || !vocalData || !context) {
      return this.smoothedFrame;
    }
    mixAnalyser.getByteFrequencyData(mixData);
    vocalAnalyser.getByteFrequencyData(vocalData);
    const binHz = context.sampleRate / 2 / mixData.length;
    const energy = (data: Uint8Array, from: number, to: number, gain = 1) => {
      const start = Math.max(0, Math.floor(from / binHz));
      const end = Math.min(data.length - 1, Math.ceil(to / binHz));
      let sum = 0;
      for (let index = start; index <= end; index += 1) sum += data[index];
      return Math.min(1, (sum / Math.max(1, end - start + 1) / 255) * gain);
    };
    const bass = energy(mixData, 35, 170, 1.25);
    const mid = energy(mixData, 180, 2_400, 1.5);
    const treble = energy(mixData, 2_600, 12_000, 2.2);
    const vocalEnergy = energy(vocalData, 80, 2_000, 1.6);
    const pitchStart = Math.floor(80 / binHz);
    const pitchEnd = Math.min(vocalData.length - 1, Math.ceil(1_200 / binHz));
    let peakIndex = pitchStart;
    let peakValue = 0;
    for (let index = pitchStart; index <= pitchEnd; index += 1) {
      if (vocalData[index] > peakValue) {
        peakValue = vocalData[index];
        peakIndex = index;
      }
    }
    const peakHz = peakIndex * binHz;
    const vocalPitch = vocalEnergy < 0.08
      ? this.smoothedFrame.vocalPitch
      : Math.max(0, Math.min(1, (Math.log2(Math.max(80, peakHz)) - Math.log2(80)) / Math.log2(1_200 / 80)));
    const raw = {
      bass,
      mid,
      treble,
      level: Math.min(1, bass * 0.45 + mid * 0.38 + treble * 0.17),
      vocalPitch,
      vocalEnergy,
    };
    const transient = (
      value: number,
      previous: number,
      floor: number,
      riseGain: number,
      floorGain: number,
    ) => Math.min(
      1,
      Math.max(0, value - previous) * riseGain
        + Math.max(0, value - floor * 1.08) * floorGain,
    );
    const kickTarget = transient(bass, this.previousBands.bass, this.bandFloor.bass, 8.5, 2.2);
    const midHitTarget = transient(mid, this.previousBands.mid, this.bandFloor.mid, 6.2, 1.55);
    const sparkleTarget = transient(treble, this.previousBands.treble, this.bandFloor.treble, 7.4, 1.9);
    this.previousBands = { bass, mid, treble };
    this.bandFloor = {
      bass: this.bandFloor.bass + (bass - this.bandFloor.bass) * 0.018,
      mid: this.bandFloor.mid + (mid - this.bandFloor.mid) * 0.021,
      treble: this.bandFloor.treble + (treble - this.bandFloor.treble) * 0.024,
    };
    const follow = (current: number, target: number, speed: number) => current + (target - current) * speed;
    this.smoothedFrame = {
      bass: follow(this.smoothedFrame.bass, raw.bass, 0.22),
      mid: follow(this.smoothedFrame.mid, raw.mid, 0.18),
      treble: follow(this.smoothedFrame.treble, raw.treble, 0.2),
      level: follow(this.smoothedFrame.level, raw.level, 0.2),
      vocalPitch: follow(this.smoothedFrame.vocalPitch, raw.vocalPitch, 0.14),
      vocalEnergy: follow(this.smoothedFrame.vocalEnergy, raw.vocalEnergy, 0.2),
      kick: Math.max(this.smoothedFrame.kick * 0.72, kickTarget),
      midHit: Math.max(this.smoothedFrame.midHit * 0.78, midHitTarget),
      sparkle: Math.max(this.smoothedFrame.sparkle * 0.7, sparkleTarget),
    };
    return this.smoothedFrame;
  }

  private applyLevels(): void {
    const context = this.context;
    if (!context) return;
    if (!this.aligning) this.rampParam(this.instrumentalGain?.gain, 1, 0.055);
    if (!this.aligning) this.rampParam(this.vocalsGain?.gain, 0, 0.055);
    this.rampParam(this.masterGain?.gain, this.masterVolume, 0.055);
  }

  private rampParam(
    parameter: AudioParam | undefined,
    value: number,
    durationSeconds: number,
  ): void {
    const context = this.context;
    if (!context || !parameter) return;
    const now = context.currentTime;
    try {
      parameter.cancelAndHoldAtTime(now);
    } catch {
      const current = parameter.value;
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(current, now);
    }
    parameter.linearRampToValueAtTime(value, now + durationSeconds);
  }

  private silenceMix(): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    for (const gain of [this.instrumentalGain, this.vocalsGain]) {
      if (!gain) continue;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
    }
  }

  private fadeInMix(): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    if (this.instrumentalGain) {
      this.instrumentalGain.gain.cancelScheduledValues(now);
      this.instrumentalGain.gain.setValueAtTime(0, now);
      this.instrumentalGain.gain.linearRampToValueAtTime(1, now + 0.045);
    }
    if (this.vocalsGain) {
      this.vocalsGain.gain.cancelScheduledValues(now);
      this.vocalsGain.gain.setValueAtTime(0, now);
      this.vocalsGain.gain.linearRampToValueAtTime(0, now + 0.075);
    }
  }

  private syncStems(force = false): void {
    const target = this.instrumental.currentTime;
    if (force) {
      this.vocals.currentTime = target;
      this.vocals.playbackRate = 1;
      return;
    }
    const vocalDrift = this.vocals.currentTime - target;
    if (Math.abs(vocalDrift) > 0.075) {
      this.vocals.currentTime = target;
      this.vocals.playbackRate = 1;
      return;
    }
    this.vocals.playbackRate = Math.max(0.985, Math.min(1.015, 1 - vocalDrift * 0.28));
  }

  private tick = (): void => {
    if (this.destroyed) return;
    this.animationFrame = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (this.playing && now - this.lastDriftCorrection > 250) {
      this.lastDriftCorrection = now;
      this.syncStems();
    }
    this.positionListener?.(this.getPosition(), this.getDuration());
  };

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    this.pause();
    this.instrumental.removeAttribute('src');
    this.vocals.removeAttribute('src');
    this.instrumental.load();
    this.vocals.load();
    void this.context?.close();
    this.context = null;
    this.instrumentalGain = null;
    this.vocalsGain = null;
    this.masterGain = null;
    this.mixAnalyser = null;
    this.vocalAnalyser = null;
    this.mixData = null;
    this.vocalData = null;
  }
}
