import type { KaraokeProgress } from './karaokeDesktop';

/**
 * The preparation pipeline the loader mirrors. Every step maps to real work the
 * machine performs, so the screen can say what is happening instead of showing
 * an anonymous spinner.
 */
export type PreparationStepId = 'analysis' | 'runtime' | 'separation' | 'mix';

export type PreparationStepState = 'pending' | 'active' | 'done' | 'skipped';

export interface PreparationStep {
  id: PreparationStepId;
  label: string;
  hint: string;
  /** Share of the total wait this step is worth. */
  weight: number;
  /** Runs alongside later steps, so a later stage must not close it. */
  concurrent?: boolean;
  state: PreparationStepState;
  /** 0–1 within this step. */
  progress: number;
  /** Live line while active, result line once done. */
  summary: string;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface PreparationState {
  steps: PreparationStep[];
  activeId: PreparationStepId;
  /** 0–1 across the whole pipeline. */
  overall: number;
  /** Technical line from the tool that is running (model, device, package…). */
  note: string;
  etaMs: number | null;
  startedAt: number;
}

const STEP_BLUEPRINT: Array<Pick<PreparationStep, 'id' | 'label' | 'hint' | 'weight' | 'concurrent'>> = [
  {
    id: 'analysis',
    label: 'Leyendo la canción',
    hint: 'Elegimos el escenario y buscamos la letra sincronizada',
    weight: 8,
    // The genre call and the lyrics fetch keep running while Demucs works.
    concurrent: true,
  },
  {
    id: 'runtime',
    label: 'Instalando el motor vocal',
    hint: 'Solo la primera vez: después queda en tu Mac',
    weight: 22,
  },
  {
    id: 'separation',
    label: 'Separando voz e instrumental',
    hint: 'El modelo escucha la mezcla y la parte en dos pistas',
    weight: 62,
  },
  {
    id: 'mix',
    label: 'Montando el escenario',
    hint: 'Sincronizamos letra, color y audio',
    weight: 8,
  },
];

/** Backend stages that belong to a step but do not share its name. */
const STAGE_ALIASES: Record<string, PreparationStepId> = {
  runtime: 'runtime',
  'transcription-runtime': 'runtime',
  separation: 'separation',
  transcription: 'separation',
  alignment: 'separation',
  analysis: 'analysis',
  mix: 'mix',
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function createPreparationState(now = Date.now()): PreparationState {
  return {
    steps: STEP_BLUEPRINT.map((blueprint, index) => ({
      ...blueprint,
      state: index === 0 ? 'active' : 'pending',
      progress: 0,
      summary: '',
      startedAt: index === 0 ? now : null,
      finishedAt: null,
    })),
    activeId: 'analysis',
    overall: 0,
    note: '',
    etaMs: null,
    startedAt: now,
  };
}

function overallProgress(steps: PreparationStep[]): number {
  const counted = steps.filter(step => step.state !== 'skipped');
  const total = counted.reduce((sum, step) => sum + step.weight, 0);
  if (total <= 0) return 0;
  const done = counted.reduce((sum, step) => {
    if (step.state === 'done') return sum + step.weight;
    if (step.state === 'active') return sum + step.weight * clamp01(step.progress);
    return sum;
  }, 0);
  return clamp01(done / total);
}

function withSteps(state: PreparationState, steps: PreparationStep[]): PreparationState {
  // Several steps can run at once; the headline follows the furthest one.
  const active = [...steps].reverse().find(step => step.state === 'active');
  return {
    ...state,
    steps,
    activeId: active?.id ?? state.activeId,
    // The bar never walks backwards: a late event from an earlier stage may
    // still refresh its note, but the wait must always look like it advances.
    overall: Math.max(state.overall, overallProgress(steps)),
  };
}

/** Marks a step as started, closing every step before it. */
export function startStep(
  state: PreparationState,
  id: PreparationStepId,
  now = Date.now(),
): PreparationState {
  const target = state.steps.findIndex(step => step.id === id);
  if (target < 0) return state;
  const steps = state.steps.map((step, index) => {
    if (index < target && !step.concurrent && step.state !== 'skipped' && step.state !== 'done') {
      return { ...step, state: 'done' as const, progress: 1, finishedAt: step.finishedAt ?? now };
    }
    if (index === target) {
      if (step.state === 'done' || step.state === 'skipped') return step;
      return { ...step, state: 'active' as const, startedAt: step.startedAt ?? now };
    }
    return step;
  });
  return withSteps(state, steps);
}

/** Closes a step and records the one-line result it produced. */
export function completeStep(
  state: PreparationState,
  id: PreparationStepId,
  summary?: string,
  now = Date.now(),
): PreparationState {
  const steps = state.steps.map(step => (
    step.id === id
      ? {
        ...step,
        state: 'done' as const,
        progress: 1,
        summary: summary ?? step.summary,
        startedAt: step.startedAt ?? now,
        finishedAt: step.finishedAt ?? now,
      }
      : step
  ));
  return withSteps(state, steps);
}

/** Drops a step that turned out to be unnecessary, e.g. an already installed runtime. */
export function skipStep(
  state: PreparationState,
  id: PreparationStepId,
  summary?: string,
): PreparationState {
  const steps = state.steps.map(step => (
    step.id === id && step.state !== 'done'
      ? { ...step, state: 'skipped' as const, summary: summary ?? step.summary }
      : step
  ));
  return withSteps(state, steps);
}

/**
 * Records the result line of a step — and optionally how far it got — without
 * touching the live note, so a concurrent step can report itself while another
 * stage keeps streaming.
 */
export function annotateStep(
  state: PreparationState,
  id: PreparationStepId,
  summary: string,
  progress?: number,
): PreparationState {
  const steps = state.steps.map(step => (
    step.id === id
      ? {
        ...step,
        summary,
        progress: typeof progress === 'number'
          ? Math.max(step.progress, clamp01(progress))
          : step.progress,
      }
      : step
  ));
  return withSteps(state, steps);
}

/** Folds one backend progress event into the pipeline. */
export function applyStageProgress(
  state: PreparationState,
  event: KaraokeProgress,
  now = Date.now(),
): PreparationState {
  const id = STAGE_ALIASES[event.stage];
  const target = id ?? state.activeId;
  const started = startStep(state, target, now);
  const steps = started.steps.map(step => (
    step.id === target && step.state === 'active'
      ? { ...step, progress: Math.max(step.progress, clamp01(event.progress)), summary: event.detail }
      : step
  ));
  return {
    ...withSteps(started, steps),
    note: event.note ?? '',
    etaMs: typeof event.etaMs === 'number' && event.etaMs > 0 ? event.etaMs : null,
  };
}

/** `1:24` / `12:03` — the shape used across the player. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1_000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * A deterministic waveform silhouette for a track, so the separation visual
 * looks like this song and stays identical across re-renders.
 */
export function waveformSilhouette(seed: string, bars: number): number[] {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const values: number[] = [];
  for (let index = 0; index < bars; index += 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const noise = ((hash >>> 0) % 1000) / 1000;
    // A gentle arch keeps the ends quieter, the way a song's energy sits.
    const arch = Math.sin((index / Math.max(1, bars - 1)) * Math.PI);
    values.push(0.24 + noise * 0.5 + arch * 0.26);
  }
  return values;
}
