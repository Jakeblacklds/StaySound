'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

type LoginFormProps = {
  denied?: boolean;
};

export function LoginForm({ denied = false }: LoginFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(
    denied ? 'Ese correo no tiene acceso a este panel.' : null,
  );
  const [isPending, startTransition] = useTransition();

  async function submit() {
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    router.replace('/');
    router.refresh();
  }

  return (
    <main className="login-shell">
      <section className="login-copy">
        <p className="eyebrow">StaySound admin</p>
        <h1>Altas manuales, sin ruido.</h1>
        <p>
          Este panel es solo para gestionar acceso: crear cuentas, mover estados y
          cambiar contrasenas cuando haga falta.
        </p>
      </section>

      <section className="login-card">
        <div className="panel-heading">
          <h2>Entrar</h2>
          <p className="panel-subtitle">Correo y contrasena del administrador.</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => {
              void submit();
            });
          }}
        >
          <div className="field">
            <label htmlFor="admin-email">Correo</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="admin-password">Contrasena</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {message ? <p className="status-note error">{message}</p> : null}

          <button className="primary-button" type="submit" disabled={isPending}>
            {isPending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
