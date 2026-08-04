import type { QualitySpecs } from '../../library/formatQuality';

interface QualityChipProps {
  quality: QualitySpecs | null;
  stack?: boolean;
}

/** Format in accent weight, specs muted, middot-joined — matches the design kit's QualityChip.
    Renders nothing when there's no known format, rather than inventing placeholder numbers. */
export function QualityChip({ quality, stack = false }: QualityChipProps) {
  if (!quality) return null;
  return (
    <span className={`circ-quality-chip ${stack ? 'stack' : ''}`}>
      <strong>{quality.format}</strong>
      {quality.specs.length > 0 ? <span>{stack ? '' : ' · '}{quality.specs.join(' · ')}</span> : null}
    </span>
  );
}
