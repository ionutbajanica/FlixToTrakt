// Minimal server-side TMDB client.
//
// The export flow leans entirely on TMDB: a free read access token is enough to
// resolve every Netflix title to IDs Trakt understands, with no Trakt OAuth
// application involved. Results are cached per process and requests are capped
// so a 10,000-row history does not hammer the API.

const TMDB_BASE = 'https://api.themoviedb.org/3';
const MAX_CONCURRENT = 8;

export interface TmdbSearchResult {
  id: number;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  media_type?: string;
  popularity?: number;
}

export interface TmdbSeasonSummary {
  season_number: number;
  name?: string;
  episode_count?: number;
}

export interface TmdbShowDetails {
  id: number;
  name: string;
  first_air_date?: string;
  seasons: TmdbSeasonSummary[];
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
}

export interface TmdbEpisode {
  id: number;
  name?: string;
  season_number: number;
  episode_number: number;
  air_date?: string;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  release_date?: string;
  imdb_id?: string | null;
}

interface TmdbCache {
  responses: Map<string, unknown>;
  inflight: Map<string, Promise<unknown>>;
  active: number;
  waiters: Array<() => void>;
  pauseUntil: number;
}

const getCache = (): TmdbCache => {
  const g = globalThis as unknown as { __tmdbCache?: TmdbCache };
  if (!g.__tmdbCache) {
    g.__tmdbCache = {
      responses: new Map(),
      inflight: new Map(),
      active: 0,
      waiters: [],
      pauseUntil: 0,
    };
  }
  return g.__tmdbCache;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const acquire = async (cache: TmdbCache) => {
  if (cache.active >= MAX_CONCURRENT) {
    await new Promise<void>(resolve => cache.waiters.push(resolve));
  }
  cache.active++;
  const wait = cache.pauseUntil - Date.now();
  if (wait > 0) await delay(wait);
};

const release = (cache: TmdbCache) => {
  cache.active--;
  const next = cache.waiters.shift();
  if (next) next();
};

export class TmdbClient {
  private token: string;
  private cache: TmdbCache;

  constructor(token: string) {
    this.token = token;
    this.cache = getCache();
  }

  /** GET a TMDB path, de-duplicating identical in-flight and past requests. */
  private async get<T>(path: string): Promise<T | null> {
    const cached = this.cache.responses.get(path);
    if (cached !== undefined) return cached as T | null;

    const inflight = this.cache.inflight.get(path);
    if (inflight) return (await inflight) as T | null;

    const request = (async (): Promise<T | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await acquire(this.cache);
        try {
          const res = await fetch(`${TMDB_BASE}${path}`, {
            headers: { accept: 'application/json', Authorization: `Bearer ${this.token}` },
          });

          if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10);
            // Park every other request too — TMDB throttles per account.
            this.cache.pauseUntil = Date.now() + (retryAfter + 1) * 1000;
            continue;
          }

          if (!res.ok) return null;
          return (await res.json()) as T;
        } catch {
          return null;
        } finally {
          release(this.cache);
        }
      }
      return null;
    })();

    this.cache.inflight.set(path, request as Promise<unknown>);
    try {
      const result = await request;
      this.cache.responses.set(path, result);
      return result;
    } finally {
      this.cache.inflight.delete(path);
    }
  }

  async searchTv(query: string): Promise<TmdbSearchResult[]> {
    const data = await this.get<{ results?: TmdbSearchResult[] }>(
      `/search/tv?query=${encodeURIComponent(query)}&language=en-US`
    );
    return data?.results ?? [];
  }

  async searchMovie(query: string): Promise<TmdbSearchResult[]> {
    const data = await this.get<{ results?: TmdbSearchResult[] }>(
      `/search/movie?query=${encodeURIComponent(query)}&language=en-US`
    );
    return data?.results ?? [];
  }

  async searchMulti(query: string): Promise<TmdbSearchResult[]> {
    const data = await this.get<{ results?: TmdbSearchResult[] }>(
      `/search/multi?query=${encodeURIComponent(query)}&language=en-US`
    );
    return (data?.results ?? []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
  }

  async showDetails(id: number): Promise<TmdbShowDetails | null> {
    return this.get<TmdbShowDetails>(`/tv/${id}?language=en-US&append_to_response=external_ids`);
  }

  async seasonEpisodes(showId: number, season: number): Promise<TmdbEpisode[]> {
    const data = await this.get<{ episodes?: TmdbEpisode[] }>(
      `/tv/${showId}/season/${season}?language=en-US`
    );
    return data?.episodes ?? [];
  }

  async movieDetails(id: number): Promise<TmdbMovieDetails | null> {
    return this.get<TmdbMovieDetails>(`/movie/${id}?language=en-US`);
  }
}

export const yearOf = (date?: string): number | undefined => {
  if (!date || date.length < 4) return undefined;
  const year = parseInt(date.slice(0, 4), 10);
  return Number.isNaN(year) ? undefined : year;
};
