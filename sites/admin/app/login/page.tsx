import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { isAdminEmail } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && isAdminEmail(user.email)) {
    redirect('/');
  }

  if (user && !isAdminEmail(user.email)) {
    await supabase.auth.signOut();
  }

  return <LoginForm denied={resolvedParams.denied === '1'} />;
}
