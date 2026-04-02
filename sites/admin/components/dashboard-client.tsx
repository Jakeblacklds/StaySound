'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { DashboardSnapshot } from '@/lib/types';

type DashboardClientProps = {
  initialSnapshot: DashboardSnapshot;
};

type StatusMessage =
  | {
      tone: 'success' | 'error';
      text: string;
    }
  | null;

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function DashboardClient({ initialSnapshot }: DashboardClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [isPending, startTransition] = useTransition();

  async function requestSnapshot(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<DashboardSnapshot> {
    const response = await fetch(input, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });

    const payload = (await response.json().catch(() => null)) as
      | DashboardSnapshot
      | { error?: string }
      | null;

    if (response.status === 401) {
      await supabase.auth.signOut();
      router.replace('/login');
      router.refresh();
      throw new Error('La sesion ya no esta disponible.');
    }

    if (!response.ok) {
      throw new Error(
        payload && 'error' in payload
          ? payload.error ?? 'No se pudo completar la accion.'
          : 'No se pudo completar la accion.',
      );
    }

    return payload as DashboardSnapshot;
  }

  function run(task: () => Promise<void>) {
    startTransition(() => {
      void task();
    });
  }

  async function handleCreateUser() {
    const nextSnapshot = await requestSnapshot('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: createEmail,
        password: createPassword,
      }),
    });

    setSnapshot(nextSnapshot);
    setCreateEmail('');
    setCreatePassword('');
    setStatusMessage({ tone: 'success', text: 'Cuenta guardada.' });
  }

  async function handleToggle(email: string, isActive: boolean) {
    const nextSnapshot = await requestSnapshot('/api/users/access', {
      method: 'PATCH',
      body: JSON.stringify({
        email,
        isActive: !isActive,
      }),
    });

    setSnapshot(nextSnapshot);
    setStatusMessage({
      tone: 'success',
      text: !isActive ? 'Acceso activado.' : 'Acceso pausado.',
    });
  }

  async function handleResetPassword(email: string) {
    const password = (passwordDrafts[email] ?? '').trim();
    if (!password) {
      setStatusMessage({ tone: 'error', text: 'Escribe la nueva contrasena.' });
      return;
    }

    const nextSnapshot = await requestSnapshot('/api/users/password', {
      method: 'PATCH',
      body: JSON.stringify({
        email,
        password,
      }),
    });

    setSnapshot(nextSnapshot);
    setPasswordDrafts((current) => ({
      ...current,
      [email]: '',
    }));
    setStatusMessage({ tone: 'success', text: 'Contrasena actualizada.' });
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-title">
          <p className="eyebrow">StaySound admin</p>
          <h1>Usuarios</h1>
          <p>Alta manual y control de acceso en un solo lugar.</p>
        </div>

        <div className="dashboard-meta">
          <p className="helper-text">{snapshot.adminEmail}</p>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              run(handleSignOut);
            }}
            disabled={isPending}
          >
            Salir
          </button>
        </div>
      </header>

      <section className="metric-row" aria-label="Resumen">
        <article className="metric">
          <span className="metric-label">Total</span>
          <strong>{snapshot.totalUsers}</strong>
        </article>
        <article className="metric">
          <span className="metric-label">Activos</span>
          <strong>{snapshot.activeUsers}</strong>
        </article>
        <article className="metric">
          <span className="metric-label">Inactivos</span>
          <strong>{snapshot.inactiveUsers}</strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <aside className="panel">
          <div className="panel-heading">
            <h2>Alta manual</h2>
            <p className="panel-subtitle">Correo y contrasena inicial.</p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              setStatusMessage(null);
              run(async () => {
                try {
                  await handleCreateUser();
                } catch (error) {
                  setStatusMessage({
                    tone: 'error',
                    text: error instanceof Error ? error.message : 'No se pudo guardar.',
                  });
                }
              });
            }}
          >
            <div className="field">
              <label htmlFor="buyer-email">Correo</label>
              <input
                id="buyer-email"
                type="email"
                autoComplete="off"
                value={createEmail}
                onChange={(event) => setCreateEmail(event.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="buyer-password">Contrasena</label>
              <input
                id="buyer-password"
                type="text"
                autoComplete="off"
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
                required
                minLength={8}
              />
            </div>

            <button className="primary-button" type="submit" disabled={isPending}>
              {isPending ? 'Guardando...' : 'Guardar usuario'}
            </button>
          </form>
        </aside>

        <section className="panel">
          <div className="panel-heading">
            <h2>Accesos</h2>
            <p className="panel-subtitle">
              {snapshot.totalUsers > 0
                ? `${snapshot.activeUsers} activos / ${snapshot.inactiveUsers} inactivos`
                : 'Todavia no hay usuarios.'}
            </p>
          </div>

          {statusMessage ? (
            <p className={`status-note ${statusMessage.tone}`}>{statusMessage.text}</p>
          ) : null}

          {snapshot.users.length === 0 ? (
            <p className="empty-state">Cuando des de alta al primero aparece aqui.</p>
          ) : (
            <div className="user-list">
              {snapshot.users.map((user) => (
                <article className="user-row" key={user.email}>
                  <div className="user-main">
                    <div>
                      <p className="user-email">{user.email}</p>
                      <p className="user-meta">
                        Alta {dateFormatter.format(new Date(user.createdAt))}
                      </p>
                    </div>

                    <span
                      className="status-chip"
                      data-tone={user.isActive ? 'active' : 'inactive'}
                    >
                      {user.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>

                  <div className="user-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setStatusMessage(null);
                        run(async () => {
                          try {
                            await handleToggle(user.email, user.isActive);
                          } catch (error) {
                            setStatusMessage({
                              tone: 'error',
                              text:
                                error instanceof Error
                                  ? error.message
                                  : 'No se pudo cambiar el estado.',
                            });
                          }
                        });
                      }}
                      disabled={isPending}
                    >
                      {user.isActive ? 'Pausar' : 'Activar'}
                    </button>

                    <label className="reset-inline">
                      <span>Nueva contrasena</span>
                      <input
                        type="text"
                        minLength={8}
                        value={passwordDrafts[user.email] ?? ''}
                        onChange={(event) =>
                          setPasswordDrafts((current) => ({
                            ...current,
                            [user.email]: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setStatusMessage(null);
                        run(async () => {
                          try {
                            await handleResetPassword(user.email);
                          } catch (error) {
                            setStatusMessage({
                              tone: 'error',
                              text:
                                error instanceof Error
                                  ? error.message
                                  : 'No se pudo cambiar la contrasena.',
                            });
                          }
                        });
                      }}
                      disabled={isPending}
                    >
                      Guardar contrasena
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
