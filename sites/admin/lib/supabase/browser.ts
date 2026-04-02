'use client';

import { createBrowserClient } from '@supabase/ssr';
import { assertPublicSupabaseEnv } from '@/lib/public-env';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = assertPublicSupabaseEnv();
  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}
