import { cache } from 'react';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AdminUser = {
  id: string;
  email: string;
};

export const getAdminUserForRequest = cache(async (): Promise<AdminUser | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAdminEmail(user.email)) {
    return null;
  }

  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
  };
});

export async function requireAdminUser() {
  const user = await getAdminUserForRequest();
  if (!user) {
    redirect('/login');
  }

  return user;
}
