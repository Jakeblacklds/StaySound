import type { Track } from '@staysound/types/audio';
import { CSSProperties, useEffect, useMemo, useState } from 'react';
import type { WebDynamicPalette } from '../library/dynamicColors';
import {
  formatClock,
  waveformSilhouette,
  type PreparationState,
  type PreparationStep,
} from '../karaoke/karaokePreparation';
import { CheckIcon, MicrophoneIcon } from './icons';
import RisingLines from '@staysound/components/originkit/ui/risinglines';
import '../styles/karaoke-preparing.css';

interface KaraokePreparingStageProps {
  track: Track;
  palette: WebDynamicPalette;
  preparation: PreparationState;
  onCancel: () => void;
}

const WAVEFORM_BARS = 56;

/**
 * The ambient field gains life as the karaoke version gets closer. Two limits
 * shape these numbers: changing a prop rebuilds the particle buffers, so the
 * intensity only moves in four steps rather than on every progress event; and
 * the counts are deliberately low because the same machine is running Demucs
 * — OriginKit scales them by the canvas area, so a large window multiplies
 * each figure several times over.
 */
const AMBIENT_STEPS = [
  { particles: 40, riseSpeed: 13, horizonOpacity: 46 },
  { particles: 55, riseSpeed: 17, horizonOpacity: 56 },
  { particles: 75, riseSpeed: 21, horizonOpacity: 66 },
  { particles: 100, riseSpeed: 26, horizonOpacity: 78 },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  ));
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function stepDurationLabel(step: PreparationStep): string {
  if (!step.startedAt || !step.finishedAt) return '';
  const seconds = Math.round((step.finishedAt - step.startedAt) / 1_000);
  if (seconds < 1) return 'al instante';
  return seconds < 60 ? `${seconds} s` : formatClock(step.finishedAt - step.startedAt);
}

function StepMarker({ step, index }: { step: PreparationStep; index: number }) {
  if (step.state === 'done') return <CheckIcon size={13} />;
  if (step.state === 'skipped') return <span className="prep-step-skip" aria-hidden="true" />;
  if (step.state === 'active') return <span className="prep-step-pulse" aria-hidden="true" />;
  return <span className="prep-step-index">{index + 1}</span>;
}

export function KaraokePreparingStage({
  track,
  palette,
  preparation,
  onCancel,
}: KaraokePreparingStageProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - preparation.startedAt);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - preparation.startedAt);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [preparation.startedAt]);

  const waveform = useMemo(
    () => waveformSilhouette(track.id || track.title, WAVEFORM_BARS),
    [track.id, track.title],
  );

  const separation = preparation.steps.find(step => step.id === 'separation');
  const splitProgress = separation?.state === 'done'
    ? 1
    : separation?.state === 'active' ? separation.progress : 0;
  const percent = Math.min(99, Math.round(preparation.overall * 100));
  const activeStep = preparation.steps.find(step => step.id === preparation.activeId);
  const timeLabel = preparation.etaMs
    ? `~${formatClock(preparation.etaMs)} restante · ${formatClock(elapsedMs)} transcurrido`
    : `${formatClock(elapsedMs)} transcurrido`;

  const ambient = AMBIENT_STEPS[Math.min(
    AMBIENT_STEPS.length - 1,
    Math.floor(preparation.overall * AMBIENT_STEPS.length),
  )];

  const stageStyle = {
    '--prep-progress': preparation.overall,
    '--prep-split': splitProgress,
  } as CSSProperties;

  return (
    <section className="karaoke-preparing" aria-live="polite" style={stageStyle}>
      {reducedMotion ? null : (
        <div className="prep-ambient" aria-hidden="true">
          <RisingLines
            className=""
            particles={ambient.particles}
            color={palette.primary}
            riseSpeed={ambient.riseSpeed}
            opacity={72}
            scale={7}
            showHorizon
            horizonColor={palette.secondary}
            horizonOpacity={ambient.horizonOpacity}
            style={{ background: 'transparent' }}
          />
        </div>
      )}

      <div className="prep-shell">
        <div className="prep-visual">
          <div className="prep-cover">
            {track.artwork
              ? <img src={track.artwork} alt="" draggable={false} />
              : <div className="prep-cover-fallback"><MicrophoneIcon size={30} /></div>}
            <span className="prep-cover-sheen" aria-hidden="true" />
          </div>

          <div className="prep-wave" aria-hidden="true">
            <div className="prep-wave-row is-vocal">
              {waveform.map((value, index) => (
                <span
                  key={`vocal-${index}`}
                  style={{ '--bar': value, '--i': index } as CSSProperties}
                />
              ))}
            </div>
            <div className="prep-wave-row is-instrumental">
              {waveform.map((value, index) => (
                <span
                  key={`instrumental-${index}`}
                  style={{ '--bar': value, '--i': index } as CSSProperties}
                />
              ))}
            </div>
            <div className="prep-wave-labels">
              <span>Voz</span>
              <span>Instrumental</span>
            </div>
          </div>
        </div>

        <div className="prep-body">
          <span className="karaoke-eyebrow">Creando versión karaoke</span>
          <h2>{track.title}</h2>
          <p className="prep-artist">{track.artist}</p>

          <div className="prep-readout">
            <strong className="prep-percent">
              {percent}<small>%</small>
            </strong>
            <div className="prep-readout-meta">
              <span className="prep-readout-detail">{activeStep?.summary || 'Preparando el escenario…'}</span>
              <span className="prep-readout-time">{timeLabel}</span>
            </div>
          </div>

          <div className="prep-bar">
            <span style={{ transform: `scaleX(${preparation.overall})` }} />
          </div>

          <ol className="prep-steps">
            {preparation.steps.map((step, index) => (
              <li key={step.id} className={`prep-step is-${step.state}`}>
                <span className="prep-step-marker">
                  <StepMarker step={step} index={index} />
                </span>
                <span className="prep-step-text">
                  <span className="prep-step-label">{step.label}</span>
                  <span className="prep-step-hint">
                    {step.state === 'skipped'
                      ? (step.summary || 'Ya estaba listo en tu Mac')
                      : (step.summary || step.hint)}
                  </span>
                </span>
                <span className="prep-step-meta">
                  {step.state === 'done'
                    ? stepDurationLabel(step)
                    : step.state === 'active'
                      ? `${Math.round(step.progress * 100)} %`
                      : ''}
                </span>
              </li>
            ))}
          </ol>

          <p className="prep-console">
            <span className="prep-console-dot" aria-hidden="true" />
            <span className="prep-console-text">
              {preparation.note || 'Todo el audio se procesa en tu Mac'}
            </span>
          </p>

          <button className="karaoke-secondary-action prep-cancel" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </section>
  );
}
