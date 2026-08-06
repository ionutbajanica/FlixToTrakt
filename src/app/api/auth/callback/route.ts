import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { buildRedirectUri, exchangeAuthorizationCode, persistTraktTokens } from '@/lib/trakt-server';

// Trakt redirects here after the user authorizes the app on trakt.tv.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const clientSecret = cookieStore.get('trakt_client_secret')?.value;
  const expectedState = cookieStore.get('trakt_oauth_state')?.value;

  cookieStore.delete('trakt_oauth_state');

  const fail = (reason: string) => NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(reason)}`, request.url));

  if (errorParam) {
    // e.g. the user clicked "Deny" on Trakt's authorize page
    return fail(errorParam === 'access_denied' ? 'denied' : errorParam);
  }

  if (!clientId || !clientSecret) {
    return fail('missing_credentials');
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return fail('invalid_state');
  }

  const redirectUri = buildRedirectUri(request.url);
  const tokens = await exchangeAuthorizationCode(clientId, clientSecret, code, redirectUri);

  if (!tokens) {
    return fail('exchange_failed');
  }

  persistTraktTokens(cookieStore, tokens);

  return NextResponse.redirect(new URL('/', request.url));
}
