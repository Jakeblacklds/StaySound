/**
 * TabBarIcons — a bespoke line set drawn for the dock.
 *
 * One family, one weight, one 24-unit grid: rounded caps and joins, a single
 * 1.85 stroke, and an accent wash that fills the shape when the tab is active.
 * Active state is a change of *light*, not of shape, so the crossfade between
 * states never shifts a single edge.
 */
import React, { memo } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type TabIconName = 'home' | 'library' | 'search' | 'playlists';

const STROKE = 1.85;
// How strongly the shape lights up from the inside when selected.
const WASH = 0.22;

type Props = {
  name: TabIconName;
  size: number;
  color: string;
  /** Selected state: adds the interior wash. */
  filled?: boolean;
};

// House: one continuous silhouette, arched door.
const HOME_BODY = 'M4 10.5 12 4.3l8 6.2v8.4A2.1 2.1 0 0 1 17.9 21H6.1A2.1 2.1 0 0 1 4 18.9Z';
const HOME_DOOR = 'M9.7 21v-4.7a2.3 2.3 0 0 1 4.6 0V21';

// Library: three collection cells; the fourth is a record.
const LIBRARY_CELLS: [number, number][] = [[3.6, 3.6], [13, 3.6], [3.6, 13]];

// Playlists: three ranked lines with a note hanging off the end.
const NOTE_STEM = 'M18.8 6.5v9.5';
const NOTE_FLAG = 'M18.8 6.5q2.6.8 2.6 3';

export const TabBarIcon = memo(function TabBarIcon({ name, size, color, filled = false }: Props) {
  const stroke = {
    stroke: color,
    strokeWidth: STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  const wash = filled ? { fill: color, fillOpacity: WASH } : { fill: 'none' as const };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' ? (
        <>
          <Path d={HOME_BODY} {...wash} />
          <Path d={HOME_BODY} {...stroke} />
          <Path d={HOME_DOOR} {...stroke} />
        </>
      ) : null}

      {/* Library — the collection grid, with one cell turned into a record.
          A sleeve-with-disc read as a camera lens at this size; the grid never
          does, and the disc keeps it unmistakably about music. */}
      {name === 'library' ? (
        <>
          {LIBRARY_CELLS.map(([x, y]) => (
            <React.Fragment key={`${x}-${y}`}>
              <Rect x={x} y={y} width={7.4} height={7.4} rx={2.2} {...wash} />
              <Rect x={x} y={y} width={7.4} height={7.4} rx={2.2} {...stroke} />
            </React.Fragment>
          ))}
          <Circle cx={16.7} cy={16.7} r={3.7} {...wash} />
          <Circle cx={16.7} cy={16.7} r={3.7} {...stroke} />
          <Circle cx={16.7} cy={16.7} r={1} fill={color} />
        </>
      ) : null}

      {name === 'search' ? (
        <>
          <Circle cx={10.7} cy={10.7} r={6.5} {...wash} />
          <Circle cx={10.7} cy={10.7} r={6.5} {...stroke} />
          <Path d="M15.6 15.6 20.4 20.4" {...stroke} strokeWidth={2.1} />
        </>
      ) : null}

      {name === 'playlists' ? (
        <>
          <Path d="M4 7.2h11.4" {...stroke} />
          <Path d="M4 12h8.2" {...stroke} />
          <Path d="M4 16.8h6.4" {...stroke} />
          <Path d={NOTE_FLAG} {...stroke} />
          <Path d={NOTE_STEM} {...stroke} />
          <Circle cx={16.7} cy={16} r={2.1} {...wash} />
          <Circle cx={16.7} cy={16} r={2.1} {...stroke} />
        </>
      ) : null}
    </Svg>
  );
});
