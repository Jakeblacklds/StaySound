import React from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const APP_ICON = staticFile('staysound-video/appicon.png');
const DOWNLOAD_CAPTURE = staticFile('staysound-video/download-source.png');

const INTRO_DURATION = 90;
const HOME_DURATION = 180;
const LIBRARY_DURATION = 210;
const DOWNLOAD_DURATION = 210;
const OUTRO_DURATION = 60;

const TOTAL_DURATION =
  INTRO_DURATION + HOME_DURATION + LIBRARY_DURATION + DOWNLOAD_DURATION + OUTRO_DURATION;

const colors = {
  bg: '#07111d',
  bgSoft: '#101828',
  bgCard: 'rgba(15, 23, 42, 0.76)',
  line: 'rgba(255,255,255,0.08)',
  text: '#f8fafc',
  muted: 'rgba(226,232,240,0.72)',
  accent: '#ff8b68',
  accentStrong: '#ff6f61',
  accentSoft: '#ffd0c1',
  accentPink: '#ff5c8a',
};

const fontFamily = '"Aptos", "Trebuchet MS", "Segoe UI", sans-serif';

const albumCards = [
  { title: 'After Hours', artist: 'The Weeknd', color: '#f97316' },
  { title: 'Random Access', artist: 'Daft Punk', color: '#f59e0b' },
  { title: 'Currents', artist: 'Tame Impala', color: '#ef4444' },
  { title: 'SOUR', artist: 'Olivia Rodrigo', color: '#fb7185' },
];

const artistCards = [
  { name: 'Rosalia', color: '#f97316' },
  { name: 'The Weeknd', color: '#f59e0b' },
  { name: 'Bad Bunny', color: '#fb7185' },
  { name: 'Kali Uchis', color: '#fdba74' },
];

const homeHeroCards = [
  {
    title: 'Top picks',
    subtitle: 'Lo que se siente premium',
    colorA: '#ff8b68',
    colorB: '#ff5c8a',
  },
  {
    title: 'Focus mode',
    subtitle: 'Entra directo a escuchar',
    colorA: '#fb923c',
    colorB: '#f97316',
  },
  {
    title: 'Late night',
    subtitle: 'Descubre sin distraerte',
    colorA: '#f97316',
    colorB: '#ea580c',
  },
];

const downloadBadges = ['Busqueda real', 'Resultados visibles', 'Accion de descarga'];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const fadeWindow = (frame: number, start: number, duration: number, fade = 18) => {
  return clamp01(
    interpolate(
      frame,
      [start, start + fade, start + duration - fade, start + duration],
      [0, 1, 1, 0],
    ),
  );
};

const smoothSpring = (frame: number, fps: number, delay = 0, durationInFrames = 36) =>
  spring({
    frame: frame - delay,
    fps,
    durationInFrames,
    config: { damping: 200 },
  });

const PhoneShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: 'absolute',
      left: '50%',
      top: 318,
      width: 700,
      height: 1420,
      transform: 'translateX(-50%)',
      borderRadius: 92,
      background: 'linear-gradient(180deg, rgba(3,7,18,0.98), rgba(15,23,42,0.96))',
      border: '2px solid rgba(255,255,255,0.09)',
      boxShadow: '0 42px 120px rgba(2, 6, 23, 0.52)',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 20,
        width: 186,
        height: 34,
        marginLeft: -93,
        borderRadius: 999,
        background: '#020617',
        zIndex: 20,
      }}
    />
    <div
      style={{
        position: 'absolute',
        inset: 16,
        borderRadius: 76,
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 22% 14%, rgba(255,139,104,0.18), transparent 28%), linear-gradient(180deg, #111827 0%, #0b1220 100%)',
      }}
    >
      {children}
    </div>
  </div>
);

const CopyBlock: React.FC<{
  eyebrow: string;
  title: string;
  body: string;
  align?: 'left' | 'center';
}> = ({ eyebrow, title, body, align = 'left' }) => (
  <div
    style={{
      position: 'absolute',
      left: align === 'center' ? 96 : 78,
      right: align === 'center' ? 96 : 78,
      top: 92,
      textAlign: align,
      zIndex: 5,
    }}
  >
    <div
      style={{
        color: colors.accentSoft,
        fontSize: 20,
        letterSpacing: 5,
        textTransform: 'uppercase',
        opacity: 0.92,
      }}
    >
      {eyebrow}
    </div>
    <div
      style={{
        marginTop: 16,
        fontSize: 60,
        lineHeight: 0.98,
        fontWeight: 800,
        letterSpacing: -2,
      }}
    >
      {title}
    </div>
    <div
      style={{
        marginTop: 18,
        fontSize: 25,
        lineHeight: 1.35,
        color: colors.muted,
      }}
    >
      {body}
    </div>
  </div>
);

const HeroCarouselCard: React.FC<{
  index: number;
  frame: number;
  fps: number;
  title: string;
  subtitle: string;
  colorA: string;
  colorB: string;
}> = ({ index, frame, fps, title, subtitle, colorA, colorB }) => {
  const reveal = smoothSpring(frame, fps, index * 4, 34);

  return (
    <div
      style={{
        width: 276,
        height: 370,
        borderRadius: 34,
        padding: 24,
        background: `linear-gradient(160deg, ${colorA}, ${colorB})`,
        transform: `translateY(${28 - reveal * 28}px) scale(${0.94 + reveal * 0.06})`,
        opacity: reveal,
        boxShadow: `0 18px 50px ${colorA}33`,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: 'rgba(255,255,255,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        SS
      </div>
      <div style={{ marginTop: 28, fontSize: 38, lineHeight: 0.98, fontWeight: 800 }}>{title}</div>
      <div style={{ marginTop: 14, fontSize: 20, lineHeight: 1.3, color: 'rgba(255,255,255,0.84)' }}>
        {subtitle}
      </div>
    </div>
  );
};

const TrackRow: React.FC<{
  frame: number;
  fps: number;
  index: number;
  title: string;
  subtitle: string;
  color: string;
}> = ({ frame, fps, index, title, subtitle, color }) => {
  const reveal = smoothSpring(frame, fps, 12 + index * 4, 30);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '16px 18px',
        borderRadius: 24,
        background: 'rgba(255,255,255,0.05)',
        border: `1px solid ${colors.line}`,
        transform: `translateY(${18 - reveal * 18}px)`,
        opacity: reveal,
      }}
    >
      <div
        style={{
          width: 68,
          height: 68,
          borderRadius: 18,
          background: `linear-gradient(135deg, ${color}, #111827)`,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{title}</div>
        <div style={{ marginTop: 6, fontSize: 18, color: colors.muted }}>{subtitle}</div>
      </div>
    </div>
  );
};

const HomeHeroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CopyBlock
        eyebrow="Home"
        title={'Descubre y entra\ndirecto a escuchar.'}
        body="Hero carousel, tarjetas protagonistas y una sensación premium desde el primer scroll."
      />

      <div
        style={{
          position: 'absolute',
          left: 38,
          right: 38,
          top: 340,
          display: 'flex',
          gap: 18,
        }}
      >
        {homeHeroCards.map((card, index) => (
          <HeroCarouselCard key={card.title} index={index} frame={frame} fps={fps} {...card} />
        ))}
      </div>

      <div style={{ position: 'absolute', left: 40, right: 40, bottom: 120, display: 'grid', gap: 14 }}>
        <TrackRow frame={frame} fps={fps} index={0} title="Midnight City" subtitle="Hero carousel pick" color="#ff8b68" />
        <TrackRow frame={frame} fps={fps} index={1} title="Ocean Motion" subtitle="Recentemente agregado" color="#fb7185" />
        <TrackRow frame={frame} fps={fps} index={2} title="North Drive" subtitle="Ready to play" color="#f59e0b" />
      </div>
    </div>
  );
};

const LibraryScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CopyBlock
        eyebrow="Library"
        title={'Tu biblioteca,\nordenada de verdad.'}
        body="Albums y artistas como protagonistas, con estructura clara y profundidad real de catálogo."
      />

      <div
        style={{
          position: 'absolute',
          left: 40,
          right: 40,
          top: 340,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '18px 20px',
          borderRadius: 24,
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${colors.line}`,
        }}
      >
        <div style={{ fontSize: 20, color: colors.muted }}>Buscar en biblioteca</div>
      </div>

      <div style={{ position: 'absolute', left: 40, right: 40, top: 430 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          {['Albums', 'Artists', 'Songs'].map((tab, index) => {
            const active = index < 2;
            return (
              <div
                key={tab}
                style={{
                  padding: '12px 22px',
                  borderRadius: 999,
                  background: active ? 'rgba(255,139,104,0.16)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${active ? 'rgba(255,139,104,0.38)' : colors.line}`,
                  color: active ? colors.accentSoft : colors.muted,
                  fontSize: 18,
                  fontWeight: active ? 700 : 600,
                }}
              >
                {tab}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 40,
          right: 40,
          top: 530,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 18,
        }}
      >
        {albumCards.map((album, index) => {
          const reveal = smoothSpring(frame, fps, 6 + index * 4, 32);
          return (
            <div
              key={album.title}
              style={{
                height: index % 2 === 0 ? 246 : 214,
                borderRadius: 28,
                padding: 18,
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${colors.line}`,
                overflow: 'hidden',
                transform: `translateY(${26 - reveal * 26}px)`,
                opacity: reveal,
              }}
            >
              <div
                style={{
                  height: 126,
                  borderRadius: 22,
                  background: `linear-gradient(140deg, ${album.color}, #111827)`,
                }}
              />
              <div style={{ marginTop: 16, fontSize: 23, lineHeight: 1.08, fontWeight: 700 }}>{album.title}</div>
              <div style={{ marginTop: 8, fontSize: 17, color: colors.muted }}>{album.artist}</div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 40,
          right: 40,
          bottom: 108,
          display: 'flex',
          gap: 14,
        }}
      >
        {artistCards.map((artist, index) => {
          const reveal = smoothSpring(frame, fps, 22 + index * 3, 28);
          return (
            <div
              key={artist.name}
              style={{
                flex: 1,
                padding: '16px 10px',
                borderRadius: 22,
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${colors.line}`,
                textAlign: 'center',
                transform: `translateY(${18 - reveal * 18}px)`,
                opacity: reveal,
              }}
            >
              <div
                style={{
                  width: 74,
                  height: 74,
                  margin: '0 auto',
                  borderRadius: 74,
                  background: `linear-gradient(140deg, ${artist.color}, #111827)`,
                }}
              />
              <div style={{ marginTop: 14, fontSize: 17, fontWeight: 700 }}>{artist.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DownloadScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const captureReveal = smoothSpring(frame, fps, 6, 36);
  const crop = interpolate(frame, [0, DOWNLOAD_DURATION], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CopyBlock
        eyebrow="Descargar"
        title={'Descarga musica\nsin suscripcion.'}
        body="Busqueda real, resultados visibles y una accion clara de descarga para cerrar la promesa."
      />

      <div
        style={{
          position: 'absolute',
          left: 40,
          right: 40,
          top: 344,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {downloadBadges.map((badge, index) => {
          const reveal = smoothSpring(frame, fps, 10 + index * 4, 26);
          return (
            <div
              key={badge}
              style={{
                padding: '12px 18px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${colors.line}`,
                color: colors.accentSoft,
                fontSize: 18,
                opacity: reveal,
                transform: `translateY(${12 - reveal * 12}px)`,
              }}
            >
              {badge}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 38,
          right: 38,
          top: 450,
          bottom: 84,
          borderRadius: 34,
          overflow: 'hidden',
          border: `1px solid ${colors.line}`,
          boxShadow: '0 22px 80px rgba(0,0,0,0.32)',
          transform: `scale(${0.95 + captureReveal * 0.05})`,
          opacity: captureReveal,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(4,7,14,0.2), rgba(4,7,14,0.34))',
            zIndex: 2,
          }}
        />
        <Img
          src={DOWNLOAD_CAPTURE}
          style={{
            position: 'absolute',
            width: '170%',
            height: '170%',
            left: `${-44 + crop * 18}%`,
            top: `${-12 - crop * 8}%`,
            objectFit: 'cover',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 24,
            right: 24,
            top: 24,
            height: 76,
            borderRadius: 22,
            background: 'rgba(7, 10, 20, 0.76)',
            backdropFilter: 'blur(20px)',
            border: `1px solid ${colors.line}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            zIndex: 3,
          }}
        >
          <div style={{ fontSize: 18, color: colors.muted }}>Buscar en Descargar</div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 24,
            bottom: 24,
            width: 272,
            height: 84,
            borderRadius: 28,
            background: 'linear-gradient(135deg, #ff8b68, #ff5c8a)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#170d13',
            fontSize: 26,
            fontWeight: 800,
            zIndex: 3,
            boxShadow: '0 20px 40px rgba(255,111,97,0.28)',
          }}
        >
          Tocar y descargar
        </div>
      </div>
    </div>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iconReveal = smoothSpring(frame, fps, 0, 28);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 50% 18%, rgba(255,139,104,0.30), transparent 24%), linear-gradient(180deg, rgba(7,17,29,0.2), rgba(7,17,29,0.94))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 350,
          width: 214,
          height: 214,
          marginLeft: -107,
          borderRadius: 54,
          overflow: 'hidden',
          boxShadow: '0 28px 90px rgba(255,111,97,0.28)',
          transform: `scale(${0.92 + iconReveal * 0.08}) rotate(${6 - iconReveal * 6}deg)`,
        }}
      >
        <Img src={APP_ICON} style={{ width: '100%', height: '100%' }} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 80,
          right: 80,
          top: 650,
          textAlign: 'center',
          opacity: iconReveal,
          transform: `translateY(${18 - iconReveal * 18}px)`,
        }}
      >
        <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: -2 }}>StaySound</div>
        <div style={{ marginTop: 18, fontSize: 28, color: colors.muted }}>Descubre. Organiza. Descarga.</div>
      </div>
    </div>
  );
};

export const StaySoundPromo = () => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const backgroundFloat = interpolate(frame, [0, TOTAL_DURATION], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 18% 14%, rgba(255,139,104,0.16), transparent 26%), radial-gradient(circle at 84% 18%, rgba(255,92,138,0.16), transparent 24%), linear-gradient(180deg, #060a13 0%, #0a1020 100%)',
        color: colors.text,
        fontFamily,
      }}
    >
      {new Array(16).fill(true).map((_, index) => {
        const left = 60 + ((index * 59) % 940);
        const size = 6 + (index % 4) * 4;
        const offset = interpolate((frame + index * 11) % 140, [0, 140], [height + 80, -180]);
        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left,
              top: offset,
              width: size,
              height: size,
              borderRadius: 999,
              background: index % 2 === 0 ? 'rgba(255,190,167,0.5)' : 'rgba(255,255,255,0.18)',
              boxShadow: index % 2 === 0 ? '0 0 18px rgba(255,139,104,0.22)' : 'none',
            }}
          />
        );
      })}

      <div
        style={{
          position: 'absolute',
          inset: 42,
          borderRadius: 44,
          border: `1px solid rgba(255,255,255,${0.05 + backgroundFloat * 0.04})`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          top: 56,
          display: 'flex',
          justifyContent: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        {['Home', 'Library', 'Descargar', 'Logo real'].map((tag, index) => {
          const reveal = smoothSpring(frame, fps, index * 3, 20);
          return (
            <div
              key={tag}
              style={{
                padding: '12px 18px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${colors.line}`,
                color: 'rgba(255,255,255,0.84)',
                fontSize: 18,
                opacity: reveal,
                transform: `translateY(${12 - reveal * 12}px)`,
              }}
            >
              {tag}
            </div>
          );
        })}
      </div>

      <PhoneShell>
        <Sequence from={0} durationInFrames={INTRO_DURATION}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <CopyBlock
              eyebrow="StaySound"
              title={'Tu musica,\nsin complicarte la vida.'}
              body="Feature tour vertical con look premium controlado y escenas basadas en la app."
              align="center"
            />
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 520,
                width: 240,
                height: 240,
                marginLeft: -120,
                borderRadius: 58,
                overflow: 'hidden',
                boxShadow: '0 30px 100px rgba(255,111,97,0.26)',
                transform: `scale(${0.92 + smoothSpring(frame, fps, 10, 32) * 0.08})`,
              }}
            >
              <Img src={APP_ICON} style={{ width: '100%', height: '100%' }} />
            </div>
          </div>
        </Sequence>

        <Sequence from={INTRO_DURATION} durationInFrames={HOME_DURATION}>
          <HomeHeroScene />
        </Sequence>

        <Sequence from={INTRO_DURATION + HOME_DURATION} durationInFrames={LIBRARY_DURATION}>
          <LibraryScene />
        </Sequence>

        <Sequence
          from={INTRO_DURATION + HOME_DURATION + LIBRARY_DURATION}
          durationInFrames={DOWNLOAD_DURATION}
        >
          <DownloadScene />
        </Sequence>

        <Sequence
          from={INTRO_DURATION + HOME_DURATION + LIBRARY_DURATION + DOWNLOAD_DURATION}
          durationInFrames={OUTRO_DURATION}
        >
          <OutroScene />
        </Sequence>
      </PhoneShell>
    </AbsoluteFill>
  );
};
