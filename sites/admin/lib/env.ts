function readRequiredEnv(name: string, fallbackNames: string[] = []) {
  const keys = [name, ...fallbackNames];

  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  throw new Error(`Falta configurar ${name}.`);
}

function readOptionalEnv(name: string, fallbackNames: string[] = []) {
  const keys = [name, ...fallbackNames];

  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function getAdminEmailsSource() {
  return readOptionalEnv('ADMIN_EMAILS');
}

function normalizeEmailList(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getPublicSupabaseEnv() {
  return {
    url: readRequiredEnv('NEXT_PUBLIC_SUPABASE_URL', [
      'EXPO_PUBLIC_AUTH_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]),
    anonKey: readRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', [
      'EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    ]),
  };
}

export function getServiceRoleEnv() {
  return {
    serviceRoleKey: readRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

export function getAdminEmails() {
  const emails = normalizeEmailList(getAdminEmailsSource());
  if (emails.length === 0) {
    throw new Error('Falta configurar ADMIN_EMAILS.');
  }

  return emails;
}

export function isAdminEmail(email?: string | null) {
  if (!email) {
    return false;
  }

  return getAdminEmails().includes(email.trim().toLowerCase());
}
