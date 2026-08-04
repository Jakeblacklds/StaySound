import type { CanvasUiEffectName } from './CanvasUiEffectStage';
import type { KaraokeVisualPlan } from './karaokeDesktop';
import type { KaraokeStanza } from './karaokeLyrics';

export type KaraokeStageMoment = 'intro' | 'singing' | 'handoff' | 'interlude' | 'outro';

const CHORUS_PATTERN = /\b(chorus|coro|refrain|estribillo|hook)\b/i;
const BRIDGE_PATTERN = /\b(bridge|puente|pre[- ]?chorus|pre[- ]?coro|breakdown)\b/i;
const VERSE_PATTERN = /\b(verse|verso|estrofa)\b/i;

const DEFAULT_VISUAL_PLAN: KaraokeVisualPlan = {
  intro: 'clouds',
  verse: 'liquid',
  chorus: 'blaze',
  bridge: 'grid',
  outro: 'laser',
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function effectForPart(
  part: string,
  plan: KaraokeVisualPlan,
): CanvasUiEffectName | null {
  if (CHORUS_PATTERN.test(part)) return plan.chorus;
  if (BRIDGE_PATTERN.test(part)) return plan.bridge;
  if (VERSE_PATTERN.test(part)) return plan.verse;
  return null;
}

function effectForProgress(
  progress: number,
  plan: KaraokeVisualPlan,
): CanvasUiEffectName {
  if (progress < 0.12) return plan.intro;
  if (progress < 0.42) return plan.verse;
  if (progress < 0.7) return plan.chorus;
  if (progress < 0.9) return plan.bridge;
  return plan.outro;
}

export function resolveKaraokeStageEffect({
  stanzas,
  moment,
  position,
  duration,
  visualPlan = DEFAULT_VISUAL_PLAN,
}: {
  stanzas: KaraokeStanza[];
  moment: KaraokeStageMoment;
  position: number;
  duration: number;
  visualPlan?: KaraokeVisualPlan;
}): CanvasUiEffectName {
  const progress = duration > 0 ? clamp(position / duration) : 0;

  if (stanzas.length === 0) return effectForProgress(progress, visualPlan);
  if (moment === 'intro') return visualPlan.intro;
  if (moment === 'outro') return visualPlan.outro;

  if (moment === 'interlude') {
    const previousStanza = stanzas.reduce<KaraokeStanza | null>((latest, stanza) => (
      stanza.end <= position && (!latest || stanza.end > latest.end)
        ? stanza
        : latest
    ), null);
    if (previousStanza) {
      return effectForPart(previousStanza.part, visualPlan)
        ?? effectForProgress(
          duration > 0 ? previousStanza.begin / duration : progress,
          visualPlan,
        );
    }
  }

  const currentOrNextStanza = stanzas.find(stanza => (
    position >= stanza.begin && position < stanza.end
  )) ?? stanzas.find(stanza => stanza.begin > position);
  const authoredEffect = effectForPart(currentOrNextStanza?.part ?? '', visualPlan);
  return authoredEffect ?? effectForProgress(progress, visualPlan);
}
