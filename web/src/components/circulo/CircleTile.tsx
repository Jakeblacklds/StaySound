import { CircleArt } from './CircleArt';

interface CircleTileProps {
  src?: string | null;
  hue: number;
  title: string;
  subtitle: string;
  size?: number;
  ring?: boolean;
  onClick?: () => void;
}

/** An album/playlist circle with its title + subtitle underneath — the Círculo library's
    basic unit, used on Home's "Para esta noche" rail, Biblioteca's Álbumes grid, and
    Playlists. */
export function CircleTile({ src, hue, title, subtitle, size = 118, ring = false, onClick }: CircleTileProps) {
  return (
    <div className="circ-tile" style={{ width: size + 24 }}>
      <CircleArt size={size} src={src} hue={hue} ring={ring} label={title} onClick={onClick} />
      <strong>{title}</strong>
      <small>{subtitle}</small>
    </div>
  );
}
