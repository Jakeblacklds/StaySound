import { detectPlatform } from '../appDownload';
import { DownloadIcon } from './icons';

/**
 * Shown in the Descargas tab when the Soulseek bridge isn't reachable and we're not
 * running inside Tauri — i.e. the plain web build.
 *
 * This isn't a transient error: Soulseek is a peer-to-peer protocol over raw TCP, and
 * a browser tab can't open those sockets. The desktop builds ship the bridge as a
 * sidecar process, which is why the feature exists there and only there. Saying that
 * plainly beats leaving people to retry a search that can never succeed.
 */
export function DesktopRequiredNotice({ onGetApp }: { onGetApp: () => void }) {
  const platform = detectPlatform();
  const label = platform === 'windows'
    ? 'para Windows'
    : platform === 'macos'
      ? 'para macOS'
      : platform === 'android'
        ? 'para Android'
        : 'de escritorio';

  return (
    <section className="desktop-required" role="note">
      <span className="desktop-required-glow" aria-hidden="true" />

      <div className="desktop-required-body">
        <span className="desktop-required-kicker">Solo en la app</span>
        <h2>Las descargas por Soulseek necesitan la app de escritorio</h2>
        <p>
          Soulseek es una red P2P: el archivo viaja directo desde la computadora de otra
          persona a la tuya, por una conexión que un navegador no tiene permitido abrir.
          Las apps de StaySound incluyen ese puente, así que ahí la búsqueda y la descarga
          funcionan completas.
        </p>

        <div className="desktop-required-actions">
          <button className="btn btn-primary" onClick={onGetApp}>
            <DownloadIcon size={16} />
            Descargar StaySound {label}
          </button>
          <small>Android · Windows · macOS</small>
        </div>
      </div>

      <ul className="desktop-required-list">
        <li>
          <strong>Aquí en el navegador</strong>
          <span>Importa tu música local, organiza álbumes y playlists, y reproduce con letras sincronizadas.</span>
        </li>
        <li>
          <strong>En la app</strong>
          <span>Todo lo anterior más búsqueda y descarga por Soulseek, carpeta de música propia y modo karaoke.</span>
        </li>
      </ul>
    </section>
  );
}
