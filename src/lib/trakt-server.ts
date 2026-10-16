// Shared helpers for the server-side Trakt routes: credential lookup, the
// authenticated fetcher, and a single place that decides what an auth failure
// looks like to the frontend.

export type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export class TraktAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TraktAuthError';
  }
}

export const traktAuthErrorResponse = (error: TraktAuthError) => ({
  body: { error: error.message },
  status: 401,
});

/**
 * Build a fetcher that carries the stored Trakt credentials.
 * Throws TraktAuthError when the user is not connected — callers turn that
 * into a 401 so the UI can send them back through the login flow.
 */
export const createTraktFetcher = (cookieStore: CookieReader) => {
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const accessToken = cookieStore.get('trakt_access_token')?.value;

  if (!clientId) throw new TraktAuthError('Missing Trakt Client ID');
  if (!accessToken) throw new TraktAuthError('Not authenticated with Trakt');

  const fetchTrakt = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'trakt-api-version': '2',
        'trakt-api-key': clientId,
        'User-Agent': 'Trakt-Updater-App/1.0',
        ...(init.headers || {}),
      },
    });

  return { fetchTrakt, clientId, accessToken };
};

// --- OAuth authorization-code flow -----------------------------------------
// Used by /api/auth/authorize (redirects to Trakt) and /api/auth/callback
// (exchanges the returned code for tokens).

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
};

export type CookieWriter = {
  set(name: string, value: string, options?: CookieOptions): unknown;
};

export type TraktTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

const TRAKT_AUTHORIZE_URL = 'https://trakt.tv/oauth/authorize';
const TRAKT_TOKEN_URL = 'https://api.trakt.tv/oauth/token';
const CALLBACK_PATH = '/api/auth/callback';

const cookieOptions = (maxAge: number): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge,
});

const DAY = 60 * 60 * 24;

/**
 * The callback URL on this app's own origin. Trakt requires it to match the
 * Redirect URI registered on the Trakt app exactly, so the authorize request
 * and the token exchange must both send this same value.
 */
export const buildRedirectUri = (requestUrl: string) => new URL(CALLBACK_PATH, requestUrl).toString();

/** Remember the redirect URI so a later token refresh can send the same one. */
export const persistRedirectUri = (cookieStore: CookieWriter, redirectUri: string) => {
  cookieStore.set('trakt_redirect_uri', redirectUri, cookieOptions(365 * DAY));
};

export const buildAuthorizeUrl = (clientId: string, redirectUri: string, state: string) => {
  const url = new URL(TRAKT_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
};

/** Swap the one-time authorization code for tokens. Returns null on any failure. */
export const exchangeAuthorizationCode = async (
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<TraktTokens | null> => {
  try {
    const response = await fetch(TRAKT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': clientId,
        'User-Agent': 'Trakt-Updater-App/1.0',
      },
      body: JSON.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data?.access_token || !data?.refresh_token) return null;
    return data as TraktTokens;
  } catch {
    return null;
  }
};

export const persistTraktTokens = (cookieStore: CookieWriter, tokens: TraktTokens) => {
  // Trakt access tokens currently last 7 days; let the cookie expire with the
  // token so an expired one sends the user back through login rather than 401ing.
  cookieStore.set('trakt_access_token', tokens.access_token, cookieOptions(tokens.expires_in ?? 7 * DAY));
  cookieStore.set('trakt_refresh_token', tokens.refresh_token, cookieOptions(90 * DAY));
};
