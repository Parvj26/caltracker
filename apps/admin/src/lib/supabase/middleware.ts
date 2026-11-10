import { createServerClient } from '@supabase/ssr';
import type { Database } from '@caltracker/shared';
import { NextResponse, type NextRequest } from 'next/server';

function redirectTo(request: NextRequest, response: NextResponse, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  const redirect = NextResponse.redirect(url);
  for (const c of response.cookies.getAll()) redirect.cookies.set(c);
  return redirect;
}

/**
 * Refreshes the Supabase session cookies on every request. Signed-out visitors go to /sign-in, and a password-only
 * (aal1) session goes to /mfa from every page, existing or not. Pages check the admin role (requireAdmin) and the
 * database checks role and aal2 again on every call.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = path === '/sign-in' || path === '/not-authorised' || path.startsWith('/auth/');

  if (isPublic) return response;
  if (!data.user) return redirectTo(request, response, '/sign-in');
  if (path !== '/mfa') {
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.data?.currentLevel !== 'aal2') return redirectTo(request, response, '/mfa');
  }
  return response;
}
