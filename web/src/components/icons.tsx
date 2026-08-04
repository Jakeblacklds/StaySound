import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <path d="M8 5.6v12.8c0 .9 1 1.5 1.8 1L20 13a1.2 1.2 0 0 0 0-2L9.8 4.6c-.8-.5-1.8.1-1.8 1Z" />
    </Icon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <rect x="6" y="4.5" width="4" height="15" rx="1.4" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.4" />
    </Icon>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <path d="M5 6.1v11.8c0 .9 1 1.5 1.8 1L16 13.2v4.6a1.2 1.2 0 0 0 1.2 1.2h.6A1.2 1.2 0 0 0 19 17.8V6.2A1.2 1.2 0 0 0 17.8 5h-.6A1.2 1.2 0 0 0 16 6.2v4.6L6.8 5.1c-.8-.5-1.8.1-1.8 1Z" />
    </Icon>
  );
}

export function PreviousIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <path d="M19 6.1v11.8c0 .9-1 1.5-1.8 1L8 13.2v4.6A1.2 1.2 0 0 1 6.8 19h-.6A1.2 1.2 0 0 1 5 17.8V6.2A1.2 1.2 0 0 1 6.2 5h.6A1.2 1.2 0 0 1 8 6.2v4.6l9.2-5.7c.8-.5 1.8.1 1.8 1Z" />
    </Icon>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 4h4v4" />
      <path d="M20 4 4 20" />
      <path d="M16 20h4v-4" />
      <path d="m14 14 6 6" />
      <path d="M4 4l6 6" />
    </Icon>
  );
}

export function RepeatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </Icon>
  );
}

export function RepeatOneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      <path d="M11 10h1v4" />
    </Icon>
  );
}

export function QueueIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h12" />
      <path d="M4 12h12" />
      <path d="M4 18h8" />
      <path d="M19 14v-4l3 2-3 2Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Icon>
  );
}

export function VolumeHighIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 5.5 6.5 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L11 18.5v-13Z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.2 6a9 9 0 0 1 0 12" />
    </Icon>
  );
}

export function VolumeLowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 5.5 6.5 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L11 18.5v-13Z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </Icon>
  );
}

export function VolumeMuteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 5.5 6.5 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L11 18.5v-13Z" fill="currentColor" stroke="none" />
      <path d="m15.5 9.5 5 5" />
      <path d="m20.5 9.5-5 5" />
    </Icon>
  );
}

export function MusicNoteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 18V6l10-2v11" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="15" r="2.5" />
    </Icon>
  );
}

export function MicrophoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 10.5v.5a6.5 6.5 0 0 0 13 0v-.5" />
      <path d="M12 17.5V21" />
      <path d="M8.5 21h7" />
    </Icon>
  );
}

export function SeekBackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8V4L1 7l3 3V8a8.5 8.5 0 1 1-.1 8.2" />
      <path d="M9.4 9.2h1.1v5.6" />
      <path d="M13.2 10.6c0-.9.6-1.5 1.4-1.5s1.4.6 1.4 1.5v2.8c0 .9-.6 1.5-1.4 1.5s-1.4-.6-1.4-1.5v-2.8Z" />
    </Icon>
  );
}

export function SeekForwardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 8V4l3 3-3 3V8a8.5 8.5 0 1 0 .1 8.2" />
      <path d="M8.2 9.2h1.1v5.6" />
      <path d="M12 10.6c0-.9.6-1.5 1.4-1.5s1.4.6 1.4 1.5v2.8c0 .9-.6 1.5-1.4 1.5s-1.4-.6-1.4-1.5v-2.8Z" />
    </Icon>
  );
}

export function DiscIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.6" />
    </Icon>
  );
}

export function ArtistIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c1.4-3.2 4.2-5 7.5-5s6.1 1.8 7.5 5" />
    </Icon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 9.5V20h11V9.5" />
      <path d="M10 20v-5h4v5" />
    </Icon>
  );
}

export function PlaylistIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h10" />
      <path d="M4 11h10" />
      <path d="M4 16h7" />
      <path d="M18 14.5v-7l3-1v7" />
      <circle cx="16.5" cy="16.5" r="1.8" />
      <circle cx="19.5" cy="13.5" r="1.8" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01" />
      <path d="M10 10h.01" />
      <path d="M14 10h.01" />
      <path d="M18 10h.01" />
      <path d="M8 14h8" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6.5 7 7.4 20h9.2l.9-13" />
      <path d="M9 7l1-3h4l1 3" />
    </Icon>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.7 7.7 0 0 0-1.69-.98L14.5 2.42A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42L9.13 5.07c-.61.25-1.18.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.43.34.7.22l2.49-1c.51.4 1.08.73 1.69.98l.38 2.65c.04.28.28.49.56.49h4c.28 0 .52-.21.56-.49l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.49 1c.27.11.56.02.7-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
    </Icon>
  );
}

/** Controls icon: clearer than a cog for per-view options such as lyrics. */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
      <circle cx="9" cy="6" r="2" fill="var(--fp-bg, #0b0e14)" />
      <circle cx="16" cy="12" r="2" fill="var(--fp-bg, #0b0e14)" />
      <circle cx="11" cy="18" r="2" fill="var(--fp-bg, #0b0e14)" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v10" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </Icon>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="7" y="3" width="10" height="18" rx="2.4" />
      <path d="M11 17.6h2" />
    </Icon>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7Z" />
    </Icon>
  );
}

export function ArtworkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="9" cy="9" r="1.4" />
      <path d="m7 17 3.7-4.1a1.2 1.2 0 0 1 1.8 0l1.2 1.4 1.4-1.7a1.2 1.2 0 0 1 1.9.1L20 17" />
    </Icon>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 5v5h-5" />
      <path d="M4 19v-5h5" />
      <path d="M19.4 10a7.5 7.5 0 0 0-13-3.3L4 9" />
      <path d="M4.6 14a7.5 7.5 0 0 0 13 3.3L20 15" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m19.5 19.5-3.8-3.8" />
    </Icon>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <Icon {...props} className={`spin ${props.className ?? ''}`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Icon>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 20.2 4.9 13a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6A4.6 4.6 0 0 1 19.1 13Z" />
    </Icon>
  );
}

export function LyricsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6.5A2.5 2.5 0 0 1 8.5 4H18v13.5A2.5 2.5 0 0 0 15.5 15H6z" />
      <path d="M8.5 8h6" />
      <path d="M8.5 11h5" />
      <path d="M8.5 14h4" />
    </Icon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18.5" cy="12" r="1.5" />
    </Icon>
  );
}

/** Animated three-bar equalizer used as the "now playing" indicator. */
export function PlayingBars({ paused = false }: { paused?: boolean }) {
  return (
    <span className={`playing-bars ${paused ? 'paused' : ''}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
