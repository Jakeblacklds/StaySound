import { createClient } from '@supabase/supabase-js';
import { getPublicSupabaseEnv, getServiceRoleEnv } from '@/lib/env';

export type AndroidReleaseManifest = {
  versionCode: number;
  versionName: string;
  runtimeVersion: string;
  apkUrl: string;
  sha256: string;
  mandatory: boolean;
  notes: string;
  publishedAt: string;
};

type ReleaseRow = {
  platform: string;
  channel: string;
  version_code: number;
  version_name: string;
  runtime_version: string;
  storage_bucket: string;
  storage_path: string;
  sha256: string;
  mandatory: boolean;
  notes: string | null;
  published_at: string;
};

function getApkDownloadName(row: ReleaseRow): string {
  const versionName = row.version_name.replace(/[^0-9A-Za-z._-]+/g, '-');
  return `staysound-${versionName}-${row.version_code}.apk`;
}

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

export async function getAndroidReleaseManifest(channel = 'prod'): Promise<AndroidReleaseManifest | null> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from('app_binary_releases')
    .select('platform, channel, version_code, version_name, runtime_version, storage_bucket, storage_path, sha256, mandatory, notes, published_at')
    .eq('platform', 'android')
    .eq('channel', channel)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const row = data as ReleaseRow;
  const signedUrl = await client.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.storage_path, 60 * 60, {
      download: getApkDownloadName(row),
    });

  if (signedUrl.error) {
    throw signedUrl.error;
  }

  return {
    versionCode: row.version_code,
    versionName: row.version_name,
    runtimeVersion: row.runtime_version,
    apkUrl: signedUrl.data.signedUrl,
    sha256: row.sha256,
    mandatory: row.mandatory,
    notes: row.notes ?? '',
    publishedAt: row.published_at,
  };
}
