import { StayIcon, type StayIconProps } from '../icons/StayIcon';

/**
 * The app's icons, all drawn from the StaySound catalogue (web/src/icons/stayIcons.ts) — the
 * same language, geometry and press motion as the Android app. Names and props are unchanged;
 * `state` is the icon's own 0..1 (filled heart, selected tab, play→pause, volume level).
 */
type IconProps = Omit<StayIconProps, 'name'>;

export const PlayIcon = (props: IconProps) => <StayIcon name="play" {...props} />;
export const PauseIcon = (props: IconProps) => <StayIcon name="pause" {...props} />;
export const NextIcon = (props: IconProps) => <StayIcon name="next" {...props} />;
export const PreviousIcon = (props: IconProps) => <StayIcon name="previous" {...props} />;
export const ShuffleIcon = (props: IconProps) => <StayIcon name="shuffle" {...props} />;
export const RepeatIcon = (props: IconProps) => <StayIcon name="repeat" {...props} />;
export const RepeatOneIcon = (props: IconProps) => <StayIcon name="repeat-one" {...props} />;
export const QueueIcon = (props: IconProps) => <StayIcon name="queue" {...props} />;
export const ChevronDownIcon = (props: IconProps) => <StayIcon name="down" {...props} />;
export const ChevronLeftIcon = (props: IconProps) => <StayIcon name="back" {...props} />;
export const ChevronRightIcon = (props: IconProps) => <StayIcon name="forward" {...props} />;
export const CheckIcon = (props: IconProps) => <StayIcon name="check" {...props} />;
export const CloseIcon = (props: IconProps) => <StayIcon name="close" {...props} />;
export const VolumeMuteIcon = (props: IconProps) => <StayIcon name="volume-mute" {...props} />;
export const MusicNoteIcon = (props: IconProps) => <StayIcon name="music" {...props} />;
export const MicrophoneIcon = (props: IconProps) => <StayIcon name="mic" {...props} />;
export const SeekBackIcon = (props: IconProps) => <StayIcon name="seek-back" {...props} />;
export const SeekForwardIcon = (props: IconProps) => <StayIcon name="seek-forward" {...props} />;
export const DiscIcon = (props: IconProps) => <StayIcon name="disc" {...props} />;
export const ArtistIcon = (props: IconProps) => <StayIcon name="artist" {...props} />;
export const HomeIcon = (props: IconProps) => <StayIcon name="tab-home" {...props} />;
export const PlaylistIcon = (props: IconProps) => <StayIcon name="playlist" {...props} />;
export const PlusIcon = (props: IconProps) => <StayIcon name="add" {...props} />;
export const KeyboardIcon = (props: IconProps) => <StayIcon name="keyboard" {...props} />;
export const TrashIcon = (props: IconProps) => <StayIcon name="trash" {...props} />;
export const GearIcon = (props: IconProps) => <StayIcon name="settings" {...props} />;
export const SlidersIcon = (props: IconProps) => <StayIcon name="equalizer" {...props} />;
export const DownloadIcon = (props: IconProps) => <StayIcon name="download" {...props} />;
export const PhoneIcon = (props: IconProps) => <StayIcon name="phone" {...props} />;
export const FolderIcon = (props: IconProps) => <StayIcon name="folder" {...props} />;
export const ArtworkIcon = (props: IconProps) => <StayIcon name="music" {...props} />;
export const SyncIcon = (props: IconProps) => <StayIcon name="sync" {...props} />;
export const SearchIcon = (props: IconProps) => <StayIcon name="search" {...props} />;
export const HeartIcon = (props: IconProps) => <StayIcon name="heart-outline" {...props} />;
export const LyricsIcon = (props: IconProps) => <StayIcon name="lyrics" {...props} />;
export const MoreIcon = (props: IconProps) => <StayIcon name="more" {...props} />;
export const UndoIcon = (props: IconProps) => <StayIcon name="undo" {...props} />;
export const RedoIcon = (props: IconProps) => <StayIcon name="redo" {...props} />;
/** The Android dock's Biblioteca and Playlists marks, for the mobile bottom nav. */
export const LibraryTabIcon = (props: IconProps) => <StayIcon name="tab-library" {...props} />;
export const PlaylistsTabIcon = (props: IconProps) => <StayIcon name="tab-playlists" {...props} />;
export const VolumeHighIcon = (props: IconProps) => <StayIcon name="volume" state={1} {...props} />;
export const VolumeLowIcon = (props: IconProps) => <StayIcon name="volume" state={0.4} {...props} />;
/** Filled when `favorite`. */
export const FavoriteIcon = ({ favorite = false, ...props }: IconProps & { favorite?: boolean }) =>
  <StayIcon name="heart" state={favorite ? 1 : 0} {...props} />;
/** One glyph for the transport toggle, so play morphs into pause instead of swapping. */
export const PlayPauseIcon = ({ playing, ...props }: IconProps & { playing: boolean }) =>
  <StayIcon name="play-pause" state={playing ? 1 : 0} {...props} />;
export const SpinnerIcon = ({ className, ...props }: IconProps) =>
  <StayIcon name="spinner" still className={`spin ${className ?? ''}`} {...props} />;

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
