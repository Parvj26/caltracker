import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const ROOT_HOST = 'caltracker.app';
const STAGING_HOST = 'staging.caltracker.app';

// Next 16 renamed the `middleware` file convention to `proxy`.
export async function proxy(request: NextRequest) {
  // Until go-live the root domain only serves the public privacy policy and terms (left out of the matcher below), so the
  // app's links work. Every other root-domain page goes to the staging site, where sign-in lives. Remove at go-live.
  if (request.nextUrl.hostname === ROOT_HOST) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.hostname = STAGING_HOST;
    url.port = '';
    return NextResponse.redirect(url, 308);
  }
  return updateSession(request);
}

export const config = {
  // The tab and home-screen icons must load without a session (they're requested on the sign-in page), and so must the
  // public privacy policy and terms. Those two are left out by exact path (`$`), so /privacy-x or /terms/x still need one.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|privacy$|terms$).*)'],
};
