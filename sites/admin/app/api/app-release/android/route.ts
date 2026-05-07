import { NextResponse } from 'next/server';
import { getAndroidReleaseManifest } from '@/lib/admin/releaseService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel')?.trim() || 'prod';
    const manifest = await getAndroidReleaseManifest(channel);

    if (!manifest) {
      return NextResponse.json({ error: 'No release found.' }, { status: 404 });
    }

    return NextResponse.json(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo leer la release.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
