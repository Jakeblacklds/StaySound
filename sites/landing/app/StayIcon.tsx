import { ICON_SHAPES, S_MARK, type IconKind } from './stayIconShapes';

/** Rest pose of a StaySound catalogue icon, painted in currentColor. */
export function StayIcon({ kind, size = 20 }: { kind: IconKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" overflow="visible" aria-hidden="true">
      {ICON_SHAPES[kind].map((shape, index) => (
        <path
          key={index}
          d={shape.d}
          transform={shape.transform}
          fill={'fill' in shape ? 'currentColor' : 'none'}
          stroke={'stroke' in shape ? 'currentColor' : undefined}
          strokeWidth={'width' in shape ? shape.width : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/** The S mark, cropped to its own bounds inside the 1024 space it was traced in. */
export function StayMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="178 300 650 422" aria-hidden="true">
      <path d={S_MARK} fill="currentColor" />
    </svg>
  );
}
