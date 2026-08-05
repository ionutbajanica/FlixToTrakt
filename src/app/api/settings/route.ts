import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 1 year
};

export async function POST(request: Request) {
  const { clientId, clientSecret, tmdbToken, mode } = await request.json();

  const cookieStore = await cookies();

  // Export mode never talks to Trakt, so a TMDB token is the only credential
  // it needs — this is the path for accounts that cannot register a Trakt app.
  if (mode === 'export') {
    if (!tmdbToken) {
      return NextResponse.json({ error: 'Missing TMDB token' }, { status: 400 });
    }

    cookieStore.set('tmdb_token', tmdbToken.trim(), COOKIE_OPTIONS);
    cookieStore.set('app_mode', 'export', { ...COOKIE_OPTIONS, httpOnly: false });

    return NextResponse.json({ success: true });
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  cookieStore.set('trakt_client_id', clientId.trim(), COOKIE_OPTIONS);
  cookieStore.set('trakt_client_secret', clientSecret.trim(), COOKIE_OPTIONS);
  cookieStore.set('app_mode', 'trakt', { ...COOKIE_OPTIONS, httpOnly: false });

  if (tmdbToken) {
    cookieStore.set('tmdb_token', tmdbToken.trim(), COOKIE_OPTIONS);
  } else {
    // Clear if it's sent empty
    cookieStore.delete('tmdb_token');
  }

  return NextResponse.json({ success: true });
}
