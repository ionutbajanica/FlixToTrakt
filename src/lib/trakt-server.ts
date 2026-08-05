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
