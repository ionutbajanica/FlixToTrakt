// Shared helpers for the server-side Trakt routes: credential lookup, the
// authenticated fetcher, and a single place that decides what an auth failure
// looks like to the frontend.

export type CookieReader = {
  get(name: string): { value: string } | undefined;
};

/**
 * Client ID of the project's own Trakt app. A Client ID is public (it travels
 * in every request header) and the device flow needs no Client Secret, so it
 * is safe to commit. Empty until the app is registered on developer.trakt.tv.
 */
export const SHARED_TRAKT_CLIENT_ID = '';

/** This deployment's Trakt app: TRAKT_CLIENT_ID if set, otherwise the project's. */
export const sharedTraktClientId = (): string | undefined =>
  process.env.TRAKT_CLIENT_ID?.trim() || SHARED_TRAKT_CLIENT_ID || undefined;

/** The user's own Client ID if they saved one, otherwise the shared app's. */
export const resolveTraktClientId = (cookieStore: CookieReader): string | undefined =>
  cookieStore.get('trakt_client_id')?.value || sharedTraktClientId();

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
  const clientId = resolveTraktClientId(cookieStore);
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
