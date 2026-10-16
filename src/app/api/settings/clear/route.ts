import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete('trakt_client_id');
  cookieStore.delete('trakt_client_secret');
  cookieStore.delete('trakt_access_token');
  cookieStore.delete('trakt_refresh_token');
  cookieStore.delete('trakt_redirect_uri');
  cookieStore.delete('trakt_oauth_state');
  cookieStore.delete('tmdb_token');
  cookieStore.delete('app_mode');

  return NextResponse.json({ success: true });
}
