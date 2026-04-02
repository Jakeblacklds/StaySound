import { NextResponse } from 'next/server';
import { getAdminUserForRequest } from '@/lib/auth';
import { setUserAccess } from '@/lib/admin/service';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo completar la accion.';
}

export async function PATCH(request: Request) {
  const admin = await getAdminUserForRequest();
  if (!admin) {
    return NextResponse.json({ error: 'Sesion no valida.' }, { status: 401 });
  }

  try {
    const { email, isActive } = (await request.json()) as {
      email?: string;
      isActive?: boolean;
    };

    return NextResponse.json(await setUserAccess(email ?? '', !!isActive, admin.email));
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}
