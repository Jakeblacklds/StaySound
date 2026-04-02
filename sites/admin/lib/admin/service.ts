import { createClient } from '@supabase/supabase-js';
import { getPublicSupabaseEnv, getServiceRoleEnv } from '@/lib/env';
import type { DashboardSnapshot, ManagedUser } from '@/lib/types';

type AllowedEmailRow = {
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type AuthUserSummary = {
  id: string;
  email?: string | null;
};

function createServiceRoleClient() {
  const { url } = getPublicSupabaseEnv();
  const { serviceRoleKey } = getServiceRoleEnv();

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function normalizeEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (!value) {
    throw new Error('Escribe un correo.');
  }

  return value;
}

function normalizePassword(password: string) {
  const value = password.trim();
  if (value.length < 8) {
    throw new Error('Usa una contrasena de al menos 8 caracteres.');
  }

  return value;
}

async function listAuthUsers(client: ReturnType<typeof createServiceRoleClient>) {
  const users: AuthUserSummary[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw error;
    }

    const currentPage = data.users as AuthUserSummary[];
    users.push(...currentPage);

    if (currentPage.length < 200) {
      break;
    }

    page += 1;
  }

  return users;
}

async function findAuthUserByEmail(
  client: ReturnType<typeof createServiceRoleClient>,
  email: string,
) {
  const users = await listAuthUsers(client);
  return users.find((user) => user.email?.trim().toLowerCase() === email) ?? null;
}

function mapAllowedEmailRow(row: AllowedEmailRow): ManagedUser {
  return {
    email: row.email,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getDashboardSnapshot(adminEmail: string): Promise<DashboardSnapshot> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from('app_allowed_emails')
    .select('email, is_active, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const users = ((data ?? []) as AllowedEmailRow[]).map(mapAllowedEmailRow);
  const activeUsers = users.filter((user) => user.isActive).length;

  return {
    adminEmail,
    totalUsers: users.length,
    activeUsers,
    inactiveUsers: users.length - activeUsers,
    users,
  };
}

export async function createOrUpdateAppUser(
  email: string,
  password: string,
  adminEmail: string,
) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = normalizePassword(password);
  const client = createServiceRoleClient();
  const existingUser = await findAuthUserByEmail(client, normalizedEmail);

  if (existingUser) {
    const { error } = await client.auth.admin.updateUserById(existingUser.id, {
      password: normalizedPassword,
      email_confirm: true,
    });

    if (error) {
      throw error;
    }
  } else {
    const { error } = await client.auth.admin.createUser({
      email: normalizedEmail,
      password: normalizedPassword,
      email_confirm: true,
    });

    if (error) {
      throw error;
    }
  }

  const { error: accessError } = await client.from('app_allowed_emails').upsert(
    {
      email: normalizedEmail,
      is_active: true,
    },
    {
      onConflict: 'email',
    },
  );

  if (accessError) {
    throw accessError;
  }

  return getDashboardSnapshot(adminEmail);
}

export async function setUserAccess(email: string, isActive: boolean, adminEmail: string) {
  const normalizedEmail = normalizeEmail(email);
  const client = createServiceRoleClient();

  const { error } = await client.from('app_allowed_emails').upsert(
    {
      email: normalizedEmail,
      is_active: isActive,
    },
    {
      onConflict: 'email',
    },
  );

  if (error) {
    throw error;
  }

  return getDashboardSnapshot(adminEmail);
}

export async function resetAppUserPassword(
  email: string,
  password: string,
  adminEmail: string,
) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = normalizePassword(password);
  const client = createServiceRoleClient();
  const existingUser = await findAuthUserByEmail(client, normalizedEmail);

  if (!existingUser) {
    throw new Error('Ese correo todavia no existe en auth.');
  }

  const { error } = await client.auth.admin.updateUserById(existingUser.id, {
    password: normalizedPassword,
    email_confirm: true,
  });

  if (error) {
    throw error;
  }

  return getDashboardSnapshot(adminEmail);
}
