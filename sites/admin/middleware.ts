import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/env';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, response } = updateSession(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname.startsWith('/api')) {
    return response;
  }

  const isLoginRoute = pathname === '/login';
  const isAdmin = isAdminEmail(user?.email);

  if (!isLoginRoute && !isAdmin) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  if (isLoginRoute && isAdmin) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
