export const publicSupabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_AUTH_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  '';

export const publicSupabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

export function assertPublicSupabaseEnv() {
  if (!publicSupabaseUrl) {
    throw new Error('Falta configurar NEXT_PUBLIC_SUPABASE_URL.');
  }

  if (!publicSupabaseAnonKey) {
    throw new Error('Falta configurar NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return {
    url: publicSupabaseUrl,
    anonKey: publicSupabaseAnonKey,
  };
}
