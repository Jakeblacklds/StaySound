import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getAnimatedArtwork } from '../library/animatedArtwork';

interface MotionArtworkProps {
  /** Album (or track) name used to find the cover. */
  title: string;
  artist: string;
  /** Cache key partner for `title`; the album a grid tile stands for. */
  album: string;
  /** Painted width in CSS pixels, used to pick the cheapest rendition. */
  size: number;
  /** The static cover. It stays mounted underneath and is what a miss falls back to. */
  children: ReactNode;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A hover-driven motion cover for grid tiles.
 *
 * Deliberately not autoplaying every tile: a library page holds dozens of
 * covers, and dozens of simultaneous video elements costs both a download each
 * and a decoder each — the page stops feeling instant long before it looks
 * richer. Apple Music makes the same call, animating the cover under the
 * pointer and leaving the rest still, so hover is also the familiar behaviour.
 *
 * The lookup is deferred to the first hover for the same reason: mounting a
 * grid should not fan out one request per album. After that both the resolved
 * URL and the video element are kept, so every later hover is instant.
 */
export function MotionArtwork({ title, artist, album, size, children }: MotionArtworkProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const askedRef = useRef(false);

  useEffect(() => {
    // A tile can be recycled onto a different album as the list re-renders.
    askedRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setVideoUrl(null);
    setActive(false);
    setReady(false);
  }, [title, artist, album]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEnter = useCallback(() => {
    if (prefersReducedMotion()) return;
    setActive(true);
    if (askedRef.current) return;
    askedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    void getAnimatedArtwork({ title, artist, album }, controller.signal, { size }).then(url => {
      if (!controller.signal.aborted) setVideoUrl(url);
    });
  }, [title, artist, album, size]);

  const handleLeave = useCallback(() => {
    setActive(false);
    // Pausing rather than unmounting keeps the decoded frames around, so coming
    // back to a tile picks the loop up instead of buffering it again.
    videoRef.current?.pause();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    void video.play().catch(() => {
      // Autoplay refusals are not worth surfacing: the static cover is showing.
    });
  }, [active, videoUrl]);

  const showing = active && ready;

  return (
    <span
      className="motion-art"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <span className={`motion-art-static ${showing ? 'yielding' : ''}`}>{children}</span>
      {videoUrl ? (
        <video
          ref={videoRef}
          className={`motion-art-video ${showing ? 'ready' : ''}`}
          key={videoUrl}
          src={videoUrl}
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          onCanPlay={() => setReady(true)}
          onError={() => {
            setReady(false);
            setVideoUrl(null);
          }}
        />
      ) : null}
    </span>
  );
}
