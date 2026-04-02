import { NextResponse } from 'next/server';
import { createOrUpdateAppUser, getDashboardSnapshot } from '@/lib/admin/service';
import { getAdminUserForRequest } from '@/lib/auth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo completar la accion.';
}

export async function GET() {
  const admin = await getAdminUserForRequest();
  if (!admin) {
    return NextResponse.json({ error: 'Sesion no valida.' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getDashboardSnapshot(admin.email));
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const admin = await getAdminUserForRequest();
  if (!admin) {
    return NextResponse.json({ error: 'Sesion no valida.' }, { status: 401 });
  }

  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    return NextResponse.json(
      await createOrUpdateAppUser(email ?? '', password ?? '', admin.email),
    );
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}
