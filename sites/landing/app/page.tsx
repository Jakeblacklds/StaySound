import Image from 'next/image';

const whatsappHref =
  'https://wa.me/525564732834?text=' +
  encodeURIComponent('Hola, me interesa StaySound. Mi correo es: ');

const notes = [
  {
    title: 'Biblioteca propia',
    copy: 'Tu musica, albums y playlists en una interfaz pensada para escuchar, no para estorbar.',
    icon: 'library',
  },
  {
    title: 'Letras y detalle',
    copy: 'Artwork, letras y ajustes dentro de una app privada, sin depender de una tienda publica.',
    icon: 'lyrics',
  },
  {
    title: 'Acceso manual',
    copy: 'La activacion se hace contigo por WhatsApp. Sin suscripcion y sin vueltas.',
    icon: 'signal',
  },
];

function LandingIcon({ kind }: { kind: 'library' | 'lyrics' | 'signal' }) {
  if (kind === 'library') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 17 5.5v13A1.5 1.5 0 0 1 15.5 20h-9A1.5 1.5 0 0 1 5 18.5z" />
        <path d="M8 8h6" />
        <path d="M8 11.5h6" />
        <path d="M8 15h4" />
        <path d="M19 6.5v11" />
      </svg>
    );
  }

  if (kind === 'lyrics') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6.5A2.5 2.5 0 0 1 8.5 4H18v13.5A2.5 2.5 0 0 0 15.5 15H6z" />
        <path d="M8.5 8h6" />
        <path d="M8.5 11h5" />
        <path d="M8.5 14h4" />
        <path d="M6 6.5v11A2.5 2.5 0 0 0 8.5 20H18" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 17.5h2.5" />
      <path d="M5 13h5" />
      <path d="M5 8.5h7.5" />
      <path d="M15 17.5h4" />
      <path d="M17 6v12" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="brand-mark">
            <Image
              src="/appicon.png"
              alt="Icono de StaySound"
              width={68}
              height={68}
              className="brand-icon"
              priority
            />
            <p className="eyebrow">StaySound</p>
          </div>
          <h1>Tu biblioteca, bien puesta.</h1>
          <p className="lede">
            Un reproductor privado para quien cuida su musica y quiere tenerla cerca,
            ordenada y con acceso propio.
          </p>

          <div className="hero-actions">
            <a className="primary-link" href={whatsappHref} target="_blank" rel="noreferrer">
              Escribirme por WhatsApp
            </a>
            <p className="action-note">Venta local. Activacion manual.</p>
          </div>
        </div>

        <aside className="hero-panel" aria-label="Disponibilidad">
          <p className="panel-kicker">Acceso</p>
          <div className="panel-rule" />
          <div className="panel-stack">
            <div className="panel-badge">
              <span className="panel-dot" />
              Pago unico
            </div>
            <div className="panel-badge">
              <span className="panel-dot" />
              Cuenta privada
            </div>
            <div className="panel-badge">
              <span className="panel-dot" />
              Actualizaciones por mensaje
            </div>
          </div>
          <div className="hero-glance" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <a className="secondary-link" href={whatsappHref} target="_blank" rel="noreferrer">
            Abrir chat
          </a>
        </aside>
      </section>

      <section className="notes" aria-labelledby="notes-title">
        <div className="section-heading">
          <p className="eyebrow">Hecho para escuchar</p>
          <h2 id="notes-title">Lo esencial, sin adornos de sobra.</h2>
        </div>

        <div className="notes-grid">
          {notes.map((note) => (
            <article className="note" key={note.title}>
              <div className="note-icon">
                <LandingIcon kind={note.icon as 'library' | 'lyrics' | 'signal'} />
              </div>
              <h3>{note.title}</h3>
              <p>{note.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="closing">
        <div>
          <p className="eyebrow">Venta local</p>
          <h2>No hay checkout. Hay trato directo.</h2>
        </div>

        <div className="closing-copy">
          <p>
            Si te interesa, me mandas mensaje. Yo llevo el alta, el acceso y las
            actualizaciones.
          </p>
          <a className="primary-link" href={whatsappHref} target="_blank" rel="noreferrer">
            Hablar por WhatsApp
          </a>
        </div>
      </section>
    </main>
  );
}
