/**
 * Web equivalent of the Android KaraokePcmSpectrumBridge: taps the already
 * decoded audio (an AnalyserNode on the shared <audio> element) and publishes
 * smoothed bass / mid / treble energies for the atmosphere renderer.
 *
 * The MediaElementSourceNode can only be created once per element, so this is
 * a singleton that lazily wires itself the first time playback starts.
 */
import { webAudioEngine } from './webAudioEngine';
import { isTauriDesktop } from '../desktop/tauriMusicLibrary';

export interface SpectrumBands {
  /** 30–150 Hz energy, 0..1 */
  bass: number;
  /** 250–2000 Hz energy, 0..1 */
  mid: number;
  /** 4–12 kHz energy, 0..1 */
  treble: number;
  /** Overall loudness, 0..1 */
  level: number;
}

const ZERO_BANDS: SpectrumBands = { bass: 0, mid: 0, treble: 0, level: 0 };

interface BandRange {
  from: number;
  to: number;
  gain: number;
}

const BAND_RANGES: Record<'bass' | 'mid' | 'treble', BandRange> = {
  bass: { from: 30, to: 150, gain: 1.0 },
  mid: { from: 250, to: 2000, gain: 1.35 },
  treble: { from: 4000, to: 12000, gain: 2.1 },
};

class SpectrumEngine {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private failed = false;

  private smoothed: SpectrumBands = { ...ZERO_BANDS };
  private lastSampleTime = 0;

  /**
   * Wires the analyser into the audio graph. Safe to call repeatedly; returns
   * false when Web Audio is unavailable (playback keeps working untouched).
   */
  start(): boolean {
    // WKWebView suspends Web Audio when the Tauri window loses foreground
    // status. Once a media element is captured by createMediaElementSource(),
    // that suspended graph is its only output and playback becomes silent.
    // Keep Tauri on the native HTMLMediaElement output for reliable background
    // playback; the ambient canvas gracefully falls back to its idle motion.
    if (isTauriDesktop()) return false;
    if (this.failed) return false;
    if (this.analyser && this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return true;
    }

    try {
      const AudioContextCtor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error('AudioContext unavailable');

      const context = new AudioContextCtor();
      const source = context.createMediaElementSource(webAudioEngine.getAudioElement());
      const analyser = context.createAnalyser();
      const outputGain = context.createGain();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;

      source.connect(analyser);
      analyser.connect(outputGain);
      outputGain.connect(context.destination);
      webAudioEngine.attachOutputGain(outputGain);

      this.context = context;
      this.analyser = analyser;
      this.frequencyData = new Uint8Array(analyser.frequencyBinCount);
      if (context.state === 'suspended') void context.resume();
      return true;
    } catch (error) {
      console.warn('Spectrum engine unavailable:', error);
      this.failed = true;
      this.context = null;
      this.analyser = null;
      return false;
    }
  }

  get isActive(): boolean {
    return this.analyser !== null;
  }

  /**
   * Samples the analyser and returns attack/release-smoothed band energies.
   * Call once per animation frame.
   */
  sample(): SpectrumBands {
    const analyser = this.analyser;
    const data = this.frequencyData;
    if (!analyser || !data || !this.context) return this.smoothed;

    const now = performance.now();
    const dt = Math.min(64, now - this.lastSampleTime || 16.7) / 16.7;
    this.lastSampleTime = now;

    analyser.getByteFrequencyData(data);

    const nyquist = this.context.sampleRate / 2;
    const binHz = nyquist / data.length;

    const raw = {
      bass: this.bandEnergy(data, binHz, BAND_RANGES.bass),
      mid: this.bandEnergy(data, binHz, BAND_RANGES.mid),
      treble: this.bandEnergy(data, binHz, BAND_RANGES.treble),
    };
    const level = Math.min(1, raw.bass * 0.5 + raw.mid * 0.35 + raw.treble * 0.15);

    this.smoothed = {
      bass: this.follow(this.smoothed.bass, raw.bass, dt),
      mid: this.follow(this.smoothed.mid, raw.mid, dt),
      treble: this.follow(this.smoothed.treble, raw.treble, dt),
      level: this.follow(this.smoothed.level, level, dt),
    };
    return this.smoothed;
  }

  private bandEnergy(data: Uint8Array, binHz: number, range: BandRange): number {
    const start = Math.max(0, Math.floor(range.from / binHz));
    const end = Math.min(data.length - 1, Math.ceil(range.to / binHz));
    if (end <= start) return 0;

    let sum = 0;
    for (let bin = start; bin <= end; bin += 1) sum += data[bin];
    const average = sum / (end - start + 1) / 255;

    // Perceptual curve: lift quiet passages, soft-clip peaks.
    return Math.min(1, Math.pow(average * range.gain, 1.25));
  }

  /** Fast attack, slow release — same envelope feel as the Android bridge. */
  private follow(current: number, target: number, dt: number): number {
    const rate = target > current ? 0.42 : 0.09;
    const blend = 1 - Math.pow(1 - rate, dt);
    return current + (target - current) * blend;
  }
}

export const spectrumEngine = new SpectrumEngine();
