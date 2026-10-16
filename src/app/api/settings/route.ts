import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sharedTraktClientId } from '@/lib/trakt-server';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 1 year
};

export async function POST(request: Request) {
  const { clientId, tmdbToken, mode } = await request.json();

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

  // A Client ID of their own is optional when this deployment has a shared
  // Trakt app; without one, it is the only way to sign in.
  const ownClientId = typeof clientId === 'string' ? clientId.trim() : '';

  if (!ownClientId && !sharedTraktClientId()) {
    return NextResponse.json({ error: 'Missing Trakt Client ID' }, { status: 400 });
  }

  if (ownClientId) {
    cookieStore.set('trakt_client_id', ownClientId, COOKIE_OPTIONS);
  } else {
    cookieStore.delete('trakt_client_id');
  }
  // Left over from when sign-in needed a Client Secret; it is no longer sent.
  cookieStore.delete('trakt_client_secret');
  cookieStore.set('app_mode', 'trakt', { ...COOKIE_OPTIONS, httpOnly: false });

  if (tmdbToken) {
    cookieStore.set('tmdb_token', tmdbToken.trim(), COOKIE_OPTIONS);
  } else {
    // Clear if it's sent empty
    cookieStore.delete('tmdb_token');
  }

  return NextResponse.json({ success: true });
}
