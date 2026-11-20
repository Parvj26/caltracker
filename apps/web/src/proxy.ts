import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const ROOT_HOST = 'caltracker.app';
const STAGING_HOST = 'staging.caltracker.app';

// Next 16 renamed the `middleware` file convention to `proxy`.
export async function proxy(request: NextRequest) {
  // Until go-live the root domain only serves the public privacy policy and terms (left out of the matcher below), so the
  // app's links work. Every other root-domain page goes to the staging site, where sign-in lives. Remove at go-live.
  // A trailing dot ("caltracker.app.") is the same host, so it is matched too.
  if (request.nextUrl.hostname.replace(/\.$/, '') === ROOT_HOST) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.hostname = STAGING_HOST;
    url.port = '';
    // Temporary (307, not cached): browsers must not remember it, or they would keep going to staging after go-live.
    const res = NextResponse.redirect(url, 307);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }
  return updateSession(request);
}

export const config = {
  // The tab and home-screen icons must load without a session (they're requested on the sign-in page), and so must the
  // public privacy policy and terms. Those two are left out by exact path (`$`), so /privacy-x or /terms/x still need one.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|privacy$|terms$).*)'],
};
