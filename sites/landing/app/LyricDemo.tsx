'use client';

import { useEffect, useRef, useState } from 'react';

/** Written for this page; timed word by word the way the app times a real song. */
const LINES = [
  'Cada palabra se enciende',
  'justo cuando suena.',
  'Sin tocar nada,',
  'la canción entera.',
].map(line => line.split(' '));

const LEAD_IN = 500;
const LINE_GAP = 520;
const REST = 1800;

/** Sung length of a word: a base beat plus a little per letter, so long words take longer. */
const wordLength = (text: string) => 190 + 62 * text.replace(/[^\p{L}\p{N}]/gu, '').length;

const WORDS: Array<{ line: number; start: number; end: number }> = [];
let cursor = LEAD_IN;
LINES.forEach((line, index) => {
  for (const text of line) {
    WORDS.push({ line: index, start: cursor, end: cursor + wordLength(text) });
    cursor += wordLength(text);
  }
  cursor += LINE_GAP;
});
const DURATION = cursor - LINE_GAP + REST;

/** The karaoke fill, looping while it is on screen. */
export function LyricDemo() {
  const root = useRef<HTMLDivElement>(null);
  // Until it runs (or if motion is reduced), the verse reads as plain, fully lit copy.
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const host = root.current;
    if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const words = Array.from(host.querySelectorAll<HTMLElement>('[data-word]'));
    const lines = Array.from(host.querySelectorAll<HTMLElement>('[data-line]'));
    let frame = 0;
    let time = 0;
    let previous = 0;

    const loop = (now: number) => {
      // A backgrounded tab resumes where it left off instead of skipping ahead.
      time = (time + Math.min(now - previous, 100)) % DURATION;
      previous = now;
      let active = 0;
      WORDS.forEach((word, position) => {
        const progress = Math.min(1, Math.max(0, (time - word.start) / (word.end - word.start)));
        if (time >= word.start) active = word.line;
        words[position].style.setProperty('--p', `${progress * 100}%`);
      });
      lines.forEach((line, position) => {
        const state = position < active ? 'past' : position === active ? 'active' : 'ahead';
        if (line.dataset.state !== state) line.dataset.state = state;
      });
      frame = requestAnimationFrame(loop);
    };

    // The verse starts from its first word each time it scrolls into view.
    const observer = new IntersectionObserver(
      ([entry]) => {
        cancelAnimationFrame(frame);
        if (!entry.isIntersecting) return;
        time = 0;
        previous = performance.now();
        setRunning(true);
        frame = requestAnimationFrame(loop);
      },
      { threshold: 0.35 },
    );
    observer.observe(host);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="lyric" ref={root} data-running={running}>
      {LINES.map((line, lineIndex) => (
        <p key={lineIndex} data-line data-state={lineIndex === 0 ? 'active' : 'ahead'}>
          {line.map((word, wordIndex) => (
            <span key={wordIndex}>
              <span className="word" data-word>
                {word}
              </span>{' '}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
