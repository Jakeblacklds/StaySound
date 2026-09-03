/**
 * Frame-hitch probe.
 *
 * WKWebView — the engine behind the desktop app — does not implement
 * PerformanceObserver's `longtask` entry type, so the usual way of catching a
 * blocked main thread reports nothing there. The primary signal here is
 * therefore the gap between animation frames: if two frames are more than
 * `HITCH_MS` apart, the main thread (or the compositor) was busy with
 * something else, which is exactly what a freeze looks like from the inside.
 *
 * Alongside that it records the two events that can freeze the picture without
 * touching the audio: a lost WebGL context (the backgrounds stop until it is
 * rebuilt) and, where supported, long tasks with their attribution.
 *
 * Off by default and free when off. Toggle with Cmd/Ctrl + Option + P, or set
 * `localStorage.staysound_perf = "1"` to have it start with the app.
 */

const HITCH_MS = 250;
const SEVERE_MS = 1_000;
const MAX_EVENTS = 40;
const STORAGE_KEY = 'staysound_perf';
declare const __BUILD_STAMP__: string;
const BUILD_STAMP = typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev';
const MEDIA_EVENTS = ['waiting', 'stalled', 'seeking', 'suspend', 'playing'] as const;

interface HitchEvent {
  at: number;
  kind: 'frame-gap' | 'long-task' | 'gl-lost' | 'gl-restored' | 'media' | 'note';
  durationMs: number;
  detail: string;
}

class PerfProbe {
  private running = false;
  private overlay: HTMLDivElement | null = null;
  private rafId = 0;
  private lastFrame = 0;
  private frames = 0;
  private fpsWindowStart = 0;
  private fps = 0;
  private readonly events: HitchEvent[] = [];
  private observer: PerformanceObserver | null = null;
  private worstMs = 0;
  private startedAt = 0;

  get isRunning(): boolean {
    return this.running;
  }

  toggle(): void {
    if (this.running) this.stop();
    else this.start();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    this.lastFrame = performance.now();
    this.fpsWindowStart = this.lastFrame;
    this.frames = 0;
    this.worstMs = 0;
    this.events.length = 0;

    this.mountOverlay();
    this.observeLongTasks();
    window.addEventListener('webglcontextlost', this.handleGlLost, true);
    window.addEventListener('webglcontextrestored', this.handleGlRestored, true);
    // A streaming <video> that stalls or re-seeks blocks the same pipeline the
    // picture rides on, so its own events are the cheapest attribution there
    // is: a gap right after one of these has a name.
    for (const type of MEDIA_EVENTS) {
      window.addEventListener(type, this.handleMediaEvent, true);
    }
    this.rafId = requestAnimationFrame(this.frame);
    this.record('note', 0, `probe iniciada · build ${BUILD_STAMP}`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('webglcontextlost', this.handleGlLost, true);
    window.removeEventListener('webglcontextrestored', this.handleGlRestored, true);
    for (const type of MEDIA_EVENTS) {
      window.removeEventListener(type, this.handleMediaEvent, true);
    }
    this.overlay?.remove();
    this.overlay = null;
  }

  /** The full log, for pasting back into a conversation. */
  report(): string {
    const uptime = ((performance.now() - this.startedAt) / 1000).toFixed(0);
    const lines = this.events.map(event => {
      const at = ((event.at - this.startedAt) / 1000).toFixed(1).padStart(6);
      const duration = event.durationMs ? `${Math.round(event.durationMs)}ms` : '';
      return `${at}s  ${event.kind.padEnd(12)} ${duration.padStart(7)}  ${event.detail}`;
    });
    return [
      `StaySound perf probe · ${uptime}s · peor parón ${Math.round(this.worstMs)}ms`,
      `long-task soportado: ${PerfProbe.supportsLongTasks() ? 'sí' : 'no (WKWebView)'}`,
      ...lines,
    ].join('\n');
  }

  /** Lets the app itself put a line in the log — errors it would otherwise swallow. */
  note(detail: string): void {
    if (!this.running) return;
    this.record('note', 0, detail);
  }

  /** Puts the full log on the clipboard; the console is not reachable here. */
  async copy(): Promise<boolean> {
    const text = this.report();
    try {
      await navigator.clipboard.writeText(text);
      this.record('note', 0, 'log copiado al portapapeles');
      return true;
    } catch {
      this.record('note', 0, 'no pude copiar — usa report()');
      return false;
    }
  }

  private static supportsLongTasks(): boolean {
    const types = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] })
      .supportedEntryTypes;
    return Array.isArray(types) && types.includes('longtask');
  }

  private observeLongTasks(): void {
    if (!PerfProbe.supportsLongTasks()) return;
    try {
      this.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration < HITCH_MS) continue;
          const attribution = (entry as PerformanceEntry & {
            attribution?: Array<{ containerType?: string; containerName?: string }>;
          }).attribution?.[0];
          this.record(
            'long-task',
            entry.duration,
            attribution?.containerName || attribution?.containerType || 'main thread',
          );
        }
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    } catch {
      this.observer = null;
    }
  }

  private handleGlLost = (event: Event) => {
    const canvas = event.target as HTMLCanvasElement | null;
    this.record('gl-lost', 0, `canvas ${canvas?.width ?? '?'}×${canvas?.height ?? '?'}`);
  };

  private handleGlRestored = () => {
    this.record('gl-restored', 0, 'contexto recuperado');
  };

  private handleMediaEvent = (event: Event) => {
    const element = event.target as HTMLMediaElement | null;
    if (!(element instanceof HTMLVideoElement)) return;
    const source = element.currentSrc || element.src || '';
    // The scheme is the whole point: `asset:` means it plays from the local
    // cache, `https:` means it is still streaming from Apple's CDN.
    const scheme = source.split(':')[0] || '?';
    const name = source.split('/').pop()?.slice(0, 24) || 'video';
    this.record('media', 0, `${event.type} · ${scheme} · ${name}`);
  };

  /**
   * Names whatever the network finished during the stall. A motion cover
   * re-buffering mid-loop lands here as a multi-megabyte transfer whose
   * `responseEnd` sits inside the gap.
   */
  private attributeToNetwork(gapStart: number, gapEnd: number): string {
    let heaviest: PerformanceResourceTiming | null = null;
    let entries: PerformanceResourceTiming[] = [];
    try {
      entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    } catch {
      return '';
    }
    for (const entry of entries) {
      if (entry.responseEnd < gapStart || entry.startTime > gapEnd) continue;
      if (!heaviest || entry.transferSize > heaviest.transferSize) heaviest = entry;
    }
    if (!heaviest) return '';
    const kb = Math.round((heaviest.transferSize || heaviest.encodedBodySize || 0) / 1024);
    const name = heaviest.name.split('/').pop()?.slice(0, 24) || heaviest.initiatorType;
    return ` · red: ${heaviest.initiatorType} ${name} ${kb}kB`;
  }

  private frame = () => {
    this.rafId = requestAnimationFrame(this.frame);
    const now = performance.now();
    const gap = now - this.lastFrame;
    this.lastFrame = now;

    if (gap >= HITCH_MS) {
      this.worstMs = Math.max(this.worstMs, gap);
      // A gap while the tab is hidden is the browser throttling us, not a bug.
      const detail = document.hidden
        ? 'ventana oculta'
        : this.describeScene() + this.attributeToNetwork(now - gap, now);
      this.record('frame-gap', gap, detail);
    }

    this.frames += 1;
    if (now - this.fpsWindowStart >= 1_000) {
      this.fps = Math.round((this.frames * 1_000) / (now - this.fpsWindowStart));
      this.frames = 0;
      this.fpsWindowStart = now;
      this.paint();
    }
  };

  /** What was on screen when it stalled — enough to tell the screens apart. */
  private describeScene(): string {
    const parts: string[] = [];
    if (document.querySelector('.karaoke-experience')) parts.push('karaoke');
    if (document.querySelector('.full-player-overlay')) parts.push('fullplayer');
    if (document.querySelector('.origin-kit-dot-matrix')) parts.push('dotmatrix');
    if (document.querySelector('.canvasui-effect-slot.is-active')) parts.push('canvasui');
    if (document.querySelector('am-lyrics')) parts.push('lyrics');
    if (document.querySelector('video')) parts.push('video-artwork');
    return parts.join('+') || 'sin capas conocidas';
  }

  private record(kind: HitchEvent['kind'], durationMs: number, detail: string): void {
    this.events.push({ at: performance.now(), kind, durationMs, detail });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    if (durationMs >= SEVERE_MS || kind === 'gl-lost') {
      console.warn(`[perf] ${kind} ${Math.round(durationMs)}ms · ${detail}`);
    }
    this.paint();
  }

  private mountOverlay(): void {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-staysound-perf', '');
    overlay.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
      'max-width:340px', 'padding:10px 12px', 'border-radius:10px',
      'background:rgba(6,9,16,.92)', 'color:#e8f0ff', 'pointer-events:none',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'border:1px solid rgba(255,255,255,.14)', 'white-space:pre-wrap',
    ].join(';');
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.paint();
  }

  private paint(): void {
    if (!this.overlay) return;
    const recent = this.events.slice(-6).map(event => {
      const duration = event.durationMs ? `${Math.round(event.durationMs)}ms ` : '';
      return `· ${event.kind} ${duration}${event.detail}`;
    });
    this.overlay.textContent = [
      `${this.fps} fps · peor parón ${Math.round(this.worstMs)}ms · ${this.events.length} eventos`,
      ...recent,
      'Cmd+Option+L copia el log completo',
    ].join('\n');
  }
}

export const perfProbe = new PerfProbe();

export function installPerfProbe(): void {
  window.addEventListener('keydown', event => {
    if (!event.altKey || !(event.metaKey || event.ctrlKey)) return;
    // On macOS, holding Option rewrites the character the key produces —
    // Option+P is "π" — so `event.key` cannot be trusted for a shortcut that
    // uses it. `event.code` names the physical key regardless of modifiers or
    // layout; `event.key` stays as a fallback for the rare browser that omits
    // it.
    if (event.code === 'KeyP' || event.key.toLowerCase() === 'p') {
      event.preventDefault();
      perfProbe.toggle();
      return;
    }
    if (event.code === 'KeyL' || event.key.toLowerCase() === 'l') {
      event.preventDefault();
      void perfProbe.copy();
    }
  });

  (window as Window & { staysoundPerf?: PerfProbe }).staysoundPerf = perfProbe;

  try {
    if (window.localStorage.getItem(STORAGE_KEY) === '1') perfProbe.start();
  } catch {
    // Private browsing: the shortcut still works.
  }
}
