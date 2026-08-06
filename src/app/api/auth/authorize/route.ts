import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { buildAuthorizeUrl, buildRedirectUri, persistRedirectUri } from '@/lib/trakt-server';

// Kicks off the standard OAuth authorization-code flow: redirects the
// browser straight to Trakt's own authorize page. The user clicks
// "Authorize" once there and is bounced back to /api/auth/callback —
// no device code to copy, no polling.
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;

  if (!clientId) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const redirectUri = buildRedirectUri(request.url);
  persistRedirectUri(cookieStore, redirectUri);

  const state = crypto.randomUUID();
  cookieStore.set('trakt_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes — just needs to survive the round trip to Trakt and back
  });

  return NextResponse.redirect(buildAuthorizeUrl(clientId, redirectUri, state));
}
