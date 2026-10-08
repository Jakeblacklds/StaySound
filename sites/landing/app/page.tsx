import Image from 'next/image';
import type { CSSProperties } from 'react';
import { LyricDemo } from './LyricDemo';
import { fetchRelease, formatDate, formatSize, RELEASES_URL } from './release';
import { StayIcon, StayMark } from './StayIcon';

const HEADLINE = ['Tu', 'música,', 'sin', 'nube.'];

const FEATURES = [
  {
    title: 'Tu biblioteca, desde tu disco',
    copy: 'Apunta a tu carpeta de música. FLAC, MP3, carátulas y metadatos quedan en orden, en tu equipo.',
  },
  {
    title: 'Sin conexión',
    copy: 'Lo que guardas se queda contigo. Sin red, tu biblioteca y sus letras siguen ahí.',
  },
  {
    title: 'Búsqueda en Soulseek',
    copy: 'Lo que te falta lo buscas en la red Soulseek, sin salir de la app.',
  },
  {
    title: 'Ecualizador',
    copy: 'Graves, medios y agudos a tu gusto, para tus audífonos o para la sala.',
  },
  {
    title: 'Android Auto',
    copy: 'Sube al coche: tu biblioteca aparece en la pantalla del tablero. Solo en Android.',
  },
];

export default async function HomePage() {
  const release = await fetchRelease();
  const published = formatDate(release.publishedAt);
  const android = {
    href: release.android?.url ?? RELEASES_URL,
    size: release.android ? formatSize(release.android.sizeBytes) : '',
    fileName: release.android?.fileName ?? '',
  };
  const macos = {
    href: release.macos?.url ?? RELEASES_URL,
    size: release.macos ? formatSize(release.macos.sizeBytes) : '',
    fileName: release.macos?.fileName ?? '',
  };
  const webAppUrl = process.env.NEXT_PUBLIC_WEB_APP_URL ?? '';

  return (
    <div className="page">
      <header className="site-head">
        <a className="brand" href="#top">
          <StayMark className="brand-mark" />
          StaySound
        </a>
        <nav aria-label="Secciones">
          <a href="#letra">Letra</a>
          <a href="#funciones">Funciones</a>
          <a href="#instalar">Instalar</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="titulo">
          <div className="hero-copy">
            <p className="kicker">
              Versión {release.version} · Gratis
            </p>
            <h1 id="titulo">
              {HEADLINE.map((word, index) => (
                <span key={word}>
                  <span className="word" style={{ '--i': index } as CSSProperties}>
                    {word}
                  </span>{' '}
                </span>
              ))}
            </h1>
            <p className="hero-line">
              Un reproductor para Android y macOS. Tu biblioteca vive en tu equipo y la letra se enciende palabra
              por palabra.
            </p>
            <div className="actions">
              <a className="pill" href={android.href}>
                <StayIcon kind="download" />
                Descargar para Android
              </a>
              <a className="pill" href={macos.href}>
                <StayIcon kind="download" />
                Descargar para macOS
              </a>
            </div>
            <p className="chips">
              <span>
                <strong>APK</strong> {android.size}
              </span>
              <span>
                <strong>DMG</strong> {[macos.size, 'Apple Silicon'].filter(Boolean).join(' · ')}
              </span>
              {published ? <span>{published}</span> : null}
            </p>
            {webAppUrl ? (
              <a className="more-link" href={webAppUrl}>
                O ábrelo en el navegador
              </a>
            ) : null}
          </div>
          <div className="hero-visual">
            <span className="ring" aria-hidden="true" />
            <div className="phone">
              <Image
                src="/screens/home.png"
                alt="Inicio de StaySound en Android: el disco destacado y la fila «Para esta noche»."
                width={496}
                height={1100}
                priority
              />
            </div>
          </div>
        </section>

        <section className="band lyrics" id="letra" aria-labelledby="letra-titulo">
          <div className="phone">
            <Image
              src="/screens/player.png"
              alt="Reproductor de StaySound en Android con la carátula en disco y la letra sincronizada debajo."
              width={814}
              height={1807}
            />
          </div>
          <div className="lyrics-copy">
            <h2 id="letra-titulo">La letra, palabra por palabra</h2>
            <p className="band-line">
              StaySound sincroniza la letra con la canción y la va llenando mientras suena, en el teléfono y en el
              escritorio.
            </p>
            <LyricDemo />
          </div>
        </section>

        <section className="band" id="funciones" aria-labelledby="funciones-titulo">
          <h2 id="funciones-titulo">Y todo lo demás</h2>
          <ul className="features">
            {FEATURES.map(feature => (
              <li key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="band" id="instalar" aria-labelledby="instalar-titulo">
          <h2 id="instalar-titulo">Instalar</h2>
          <div className="install-grid">
            <article>
              <h3>Android</h3>
              <p className="install-req">Android 7 o posterior</p>
              <ol className="steps">
                <li>Descarga el APK y ábrelo desde la notificación o desde Archivos.</li>
                <li>Android te pedirá permiso para instalar apps de este origen. Acéptalo.</li>
                <li>Abre StaySound, entra con tu cuenta de Soulseek y prueba a descargar una canción.</li>
              </ol>
              <a className="pill" href={android.href}>
                <StayIcon kind="download" />
                Descargar APK
              </a>
              <p className="install-file">{android.fileName}</p>
            </article>
            <article>
              <h3>macOS</h3>
              <p className="install-req">Mac con Apple Silicon (M1 o posterior)</p>
              <ol className="steps">
                <li>Abre el DMG y arrastra StaySound a Aplicaciones.</li>
                <li>
                  La app no está firmada con Apple. Si macOS la bloquea al abrirla, ve a Ajustes del Sistema,
                  Privacidad y seguridad, y pulsa «Abrir igualmente».
                </li>
                <li>Las siguientes versiones se instalan desde el botón Actualizar, dentro de la app.</li>
              </ol>
              <a className="pill" href={macos.href}>
                <StayIcon kind="download" />
                Descargar DMG
              </a>
              <p className="install-file">{macos.fileName}</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="colophon">
        <StayMark className="colophon-mark" />
        <p>
          StaySound es un proyecto personal y gratuito. No aloja ni distribuye música: la búsqueda usa la red
          Soulseek, y lo que descargues o compartas ahí es tu responsabilidad.
        </p>
        <a className="more-link" href={RELEASES_URL}>
          Todas las versiones
        </a>
      </footer>
    </div>
  );
}
