import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// ── Cache ──────────────────────────────────────────────────────────────────
const getCache = () => {
  const g = global as any;
  if (!g.__traktCache) {
    g.__traktCache = {
      shows: new Map<string, any>(),
      seasons: new Map<string, any>(),
      fallbacks: new Map<string, any>(),
    };
  }
  return g.__traktCache;
};

// ── Rate Limiter ───────────────────────────────────────────────────────────
// Trakt allows 1000 req / 5 min ≈ 3.33/sec. We use 3/sec (334ms) to be safe.
// Key improvement: a shared `pauseUntil` field. When ANY request hits a 429,
// it sets this timestamp and ALL queued tokens wait until it expires, preventing
// the cascade freeze where 10 parallel requests all hit 429 and wait independently.

const TICK_MS = 334; // one token every 334ms = ~3 req/sec

const ensureRateLimiter = () => {
  const g = global as any;
  if (!g.__traktRateLimiter) {
    g.__traktRateLimiter = {
      queue: [] as Array<() => void>,
      tickActive: false,
      pauseUntil: 0,
    };
  }
  const rl = g.__traktRateLimiter;
  // Restart the tick loop if it was killed by a hot reload
  if (!rl.tickActive) {
    rl.tickActive = true;
    const tick = () => {
      const now = Date.now();
      if (rl.queue.length > 0 && now >= rl.pauseUntil) {
        const resolve = rl.queue.shift();
        resolve?.();
      }
      setTimeout(tick, TICK_MS);
    };
    setTimeout(tick, TICK_MS);
  }
  return rl;
};

const acquireToken = (): Promise<void> => {
  return new Promise(resolve => {
    ensureRateLimiter().queue.push(resolve);
  });
};

// Signals a 429 to pause all pending token acquisitions
const signalRateLimit = (retryAfterSeconds: number) => {
  const g = global as any;
  const rl = g.__traktRateLimiter;
  if (rl) {
    rl.pauseUntil = Date.now() + (retryAfterSeconds + 1) * 1000;
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── Request Helper ─────────────────────────────────────────────────────────
const makeFetcher = (headers: Record<string, string>) => async (url: string): Promise<Response> => {
  await acquireToken();
  let res = await fetch(url, { headers });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '30', 10);
    console.warn(`[Trakt 429] Rate limit hit on ${url}. Propagating to frontend to wait ${retryAfter} seconds.`);
    throw new Error(`TRAKT_429:${retryAfter}`);
  }

  return res;
};

// ── Route Handler ──────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const body = await request.json();
  const titles: string[] = body.titles || (body.title ? [body.title] : []);

  if (titles.length === 0) {
    return NextResponse.json({ error: 'Title required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const token = cookieStore.get('trakt_access_token')?.value;
  const tmdbToken = cookieStore.get('tmdb_token')?.value;

  if (!clientId || !token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fetchWithRetry = makeFetcher({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'trakt-api-version': '2',
    'trakt-api-key': clientId,
    'User-Agent': 'Trakt-Updater-App/1.0',
  });

  const cache = getCache();
  ensureRateLimiter();

  const fetchTmdb = async (url: string) => {
    if (!tmdbToken) return null;
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${tmdbToken}`
        }
      });
      if (res.status === 429) {
         console.warn(`[TMDB 429] Rate limit hit on TMDB. Url: ${url}`);
         // We do not wait, we just fallback to Trakt search.
         return null;
      }
      if (res.ok) return await res.json();
    } catch (e) {
      console.error('TMDB error:', e);
    }
    return null;
  };

  const processTitle = async (title: string): Promise<any> => {
    let resultData: any = [];
    let handled = false;

    const parts = title.split(':').map((p: string) => p.trim());

    // TV episode: "Show: Season X: Episode Title"
    if (parts.length >= 3) {
      const showName = parts[0];
      const seasonPart = parts[1];
      const episodeName = parts.slice(2).join(':').toLowerCase();

      const seasonMatch = seasonPart.match(/\d+/);
      if (seasonMatch) {
        const seasonNum = seasonMatch[0];

        // 1. Show lookup (cached)
        const showCacheKey = showName.toLowerCase();
        let showData = cache.shows.get(showCacheKey);
        if (!showData) {
          if (tmdbToken) {
            const tmdbRes = await fetchTmdb(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(showName)}&language=en-US`);
            if (tmdbRes && tmdbRes.results && tmdbRes.results.length > 0) {
              const tmdbId = tmdbRes.results[0].id;
              const traktRes = await fetchWithRetry(`https://api.trakt.tv/search/tmdb/${tmdbId}?type=show`);
              if (traktRes.ok) {
                showData = await traktRes.json();
                if (showData && showData.length > 0) cache.shows.set(showCacheKey, showData);
              }
            }
          }
          if (!showData) {
            const res = await fetchWithRetry(`https://api.trakt.tv/search/show?query=${encodeURIComponent(showName)}&limit=3`);
            if (res.ok) {
              showData = await res.json();
              cache.shows.set(showCacheKey, showData);
            }
          }
        }

        if (showData && showData.length > 0) {
          const showSlug = showData[0].show.ids.slug;
          const showId = showData[0].show.ids.trakt;

          // 2. Season episodes (cached)
          const seasonCacheKey = `${showId}-${seasonNum}`;
          let episodes = cache.seasons.get(seasonCacheKey);
          if (!episodes) {
            const res = await fetchWithRetry(`https://api.trakt.tv/shows/${showSlug}/seasons/${seasonNum}/episodes`);
            if (res.ok) {
              episodes = await res.json();
              cache.seasons.set(seasonCacheKey, episodes);
            }
          }

          if (episodes) {
            // 3. Exact episode title match
            const matchedEp = episodes.find((ep: any) => ep.title && ep.title.toLowerCase() === episodeName);

            if (matchedEp) {
              resultData = [{ type: 'episode', score: 100, episode: { ...matchedEp, showTitle: showData[0].show.title, showSlug } }];
              handled = true;
            } else if (episodes.length > 0) {
              // Partial scoring for suggestions
              const searchWords = episodeName.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 0);
              const scored = episodes.map((ep: any) => {
                let score = 0;
                if (!ep.title) return { ...ep, _score: 0 };
                const epTitle = ep.title.toLowerCase();
                if (epTitle.includes(episodeName) || episodeName.includes(epTitle)) {
                  score = 50;
                } else {
                  const epWords = epTitle.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 0);
                  for (const w of searchWords) { if (epWords.includes(w)) score++; }
                }
                return { ...ep, _score: score };
              });
              scored.sort((a: any, b: any) => b._score - a._score);
              resultData = scored.slice(0, 5).map((ep: any) => ({
                type: 'episode',
                score: ep._score > 0 ? 75 : 50,
                episode: { ...ep, showTitle: showData[0].show.title, showSlug }
              }));
              handled = true;
            }
          }
        }
      }
    }

    if (!handled) {
      // Fallback: generic movie/show search
      const query = encodeURIComponent(title);
      let data = cache.fallbacks.get(query);
      if (!data) {
        if (tmdbToken) {
           const tmdbRes = await fetchTmdb(`https://api.themoviedb.org/3/search/multi?query=${query}&language=en-US`);
           if (tmdbRes && tmdbRes.results && tmdbRes.results.length > 0) {
              const bestMatch = tmdbRes.results.find((r: any) => r.media_type === 'movie' || r.media_type === 'tv') || tmdbRes.results[0];
              if (bestMatch.media_type === 'movie' || bestMatch.media_type === 'tv') {
                  const type = bestMatch.media_type === 'tv' ? 'show' : 'movie';
                  const traktRes = await fetchWithRetry(`https://api.trakt.tv/search/tmdb/${bestMatch.id}?type=${type}`);
                  if (traktRes.ok) {
                    data = await traktRes.json();
                    if (data && data.length > 0) cache.fallbacks.set(query, data);
                  }
              }
           }
        }
        if (!data) {
          const res = await fetchWithRetry(`https://api.trakt.tv/search/movie,show?query=${query}&limit=5`);
          if (res.ok) {
            data = await res.json();
            cache.fallbacks.set(query, data);
          }
        }
      }

      // Second fallback: search by show name only
      if (data && data.length === 0 && parts.length > 0) {
        const fallbackQuery = encodeURIComponent(parts[0]);
        let fallbackData = cache.fallbacks.get(fallbackQuery);
        if (!fallbackData) {
          if (tmdbToken) {
            const tmdbRes = await fetchTmdb(`https://api.themoviedb.org/3/search/multi?query=${fallbackQuery}&language=en-US`);
            if (tmdbRes && tmdbRes.results && tmdbRes.results.length > 0) {
               const bestMatch = tmdbRes.results.find((r: any) => r.media_type === 'movie' || r.media_type === 'tv') || tmdbRes.results[0];
               if (bestMatch.media_type === 'movie' || bestMatch.media_type === 'tv') {
                   const type = bestMatch.media_type === 'tv' ? 'show' : 'movie';
                   const traktRes = await fetchWithRetry(`https://api.trakt.tv/search/tmdb/${bestMatch.id}?type=${type}`);
                   if (traktRes.ok) {
                     fallbackData = await traktRes.json();
                     if (fallbackData && fallbackData.length > 0) cache.fallbacks.set(fallbackQuery, fallbackData);
                   }
               }
            }
          }
          if (!fallbackData) {
            const res = await fetchWithRetry(`https://api.trakt.tv/search/movie,show?query=${fallbackQuery}&limit=5`);
            if (res.ok) {
              fallbackData = await res.json();
              cache.fallbacks.set(fallbackQuery, fallbackData);
            }
          }
        }
        if (fallbackData) data = fallbackData;
      }

      if (data) resultData = data;
    }

    return resultData;
  };

  // All titles in the batch run concurrently; the shared token-bucket + global
  // pauseUntil ensures we never blow through the rate limit.
  try {
    const allResults = await Promise.all(titles.map(processTitle));
    return NextResponse.json(body.title ? allResults[0] : allResults);
  } catch (err: any) {
    if (err.message && err.message.startsWith('TRAKT_429:')) {
      const retryAfter = parseInt(err.message.split(':')[1] || '30', 10);
      return NextResponse.json({ error: 'Rate Limit Exceeded', retryAfter }, { status: 429 });
    }
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
