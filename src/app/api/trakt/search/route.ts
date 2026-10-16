import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveTraktClientId } from '@/lib/trakt-server';
import { parseNetflixTitle } from '@/lib/netflix';
import { TmdbClient } from '@/lib/tmdb';
import { matchEntry } from '@/lib/tmdbMatch';

interface TraktIds { trakt: number; slug?: string }
interface TraktEpisode { number: number; season: number; title?: string; ids: TraktIds }
/** The parts of a Trakt search hit this route reads or passes through. */
interface TraktHit {
  type: string;
  score: number;
  verified?: boolean;
  movie?: { title: string; year?: number; ids: TraktIds };
  show?: { title: string; year?: number; ids: TraktIds };
  episode?: TraktEpisode & { showTitle?: string; showSlug?: string };
}

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

// Strip trademark/copyright/special symbols that break API search queries
// e.g. "LEGO® DREAMZzz" → "LEGO DREAMZzz", "AT&T" stays "AT&T"
const normalizeForSearch = (s: string) =>
  s.replace(/[®™©℗℠]/g, '').replace(/\s+/g, ' ').trim();

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
  const clientId = resolveTraktClientId(cookieStore);
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

  const tmdbClient = tmdbToken ? new TmdbClient(tmdbToken) : null;

  /** Trakt's record for a TMDB id, cached — one lookup per show/movie, not per episode. */
  const traktByTmdb = async (type: 'movie' | 'show', tmdbId: number): Promise<TraktHit[] | null> => {
    const cacheKey = `tmdb-${type}-${tmdbId}`;
    const cached: TraktHit[] | undefined = cache.fallbacks.get(cacheKey);
    if (cached) return cached;
    const res = await fetchWithRetry(`https://api.trakt.tv/search/tmdb/${tmdbId}?type=${type}`);
    if (!res.ok) return null;
    const data: TraktHit[] = await res.json();
    if (Array.isArray(data) && data.length > 0) cache.fallbacks.set(cacheKey, data);
    return data;
  };

  /**
   * Run the shared TMDB matcher (the one export mode uses) and translate a
   * confident match into Trakt's search-result shape. Returns null when the
   * matcher is unsure or Trakt has no record, so the legacy search below can
   * still offer its suggestions. Results carry `verified: true`, which the
   * dashboard treats as an exact match.
   */
  const matchViaTmdb = async (title: string): Promise<TraktHit[] | null> => {
    if (!tmdbClient) return null;

    const parsed = parseNetflixTitle(title);
    const result = await matchEntry(tmdbClient, { key: title, originalTitle: title, ...parsed });
    if (result.status !== 'matched' || !result.match) return null;
    const media = result.match;

    if (media.type === 'movie' || media.type === 'show') {
      const data = await traktByTmdb(media.type, media.tmdbId);
      if (!data || data.length === 0) return null;
      return [{ ...data[0], score: 100, verified: true }];
    }

    const showData = await traktByTmdb('show', media.showTmdbId);
    const show = showData?.[0]?.show;
    if (!show) return null;

    const seasonCacheKey = `${show.ids.trakt}-${media.season}`;
    let episodes: TraktEpisode[] | undefined = cache.seasons.get(seasonCacheKey);
    if (!episodes) {
      const res = await fetchWithRetry(`https://api.trakt.tv/shows/${show.ids.slug}/seasons/${media.season}/episodes`);
      if (!res.ok) return null;
      episodes = await res.json();
      cache.seasons.set(seasonCacheKey, episodes);
    }

    const episode = (episodes || []).find(ep => ep.number === media.number);
    if (!episode) return null;

    return [{
      type: 'episode',
      score: 100,
      verified: true,
      show,
      episode: { ...episode, showTitle: show.title, showSlug: show.ids.slug },
    }];
  };

  const processTitle = async (title: string): Promise<any> => {
    const verified = await matchViaTmdb(title);
    if (verified) return verified;

    let resultData: any = [];
    let handled = false;

    const parts = title.split(':').map((p: string) => p.trim());

    // TV episode: "Show: Season X: Episode Title"
    if (parts.length >= 3) {
      const showName = parts[0];
      const seasonPart = parts[1];
      const episodeName = parts.slice(2).join(':').toLowerCase();

      // Resolve season number from the season part — supports both digits and word-forms
      // e.g. "Season 1" → 1, "Season One" → 1, "Part Two" → 2, "Chapter III" → 3
      const wordToSeasonNumber = (text: string): string | undefined => {
        const digitMatch = text.match(/(\d{1,2})/);
        if (digitMatch) return digitMatch[1];
        const words: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
          seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
          first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
          seventh: 7, eighth: 8, ninth: 9, tenth: 10,
          i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
        };
        const lower = text.toLowerCase();
        for (const [word, num] of Object.entries(words)) {
          if (new RegExp(`\\b${word}\\b`).test(lower)) return String(num);
        }
        return undefined;
      };

      let seasonNum = wordToSeasonNumber(seasonPart);

      // If still unresolved (e.g. "Enter The Cyber Game"), try matching against
      // TMDB's named season list — TMDB stores season names like "Season 3: Enter The Cyber Game"
      if (!seasonNum && tmdbToken) {
        const showNameClean = normalizeForSearch(showName);
        const tmdbSeasonCacheKey = `tmdb-seasons-${showName.toLowerCase()}`;
        let tmdbSeasons: any[] | null = cache.shows.get(tmdbSeasonCacheKey) ?? null;

        if (!tmdbSeasons) {
          const tmdbRes = await fetchTmdb(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(showNameClean)}&language=en-US`);
          if (tmdbRes?.results?.length > 0) {
            const tmdbId = tmdbRes.results[0].id;
            const detailRes = await fetchTmdb(`https://api.themoviedb.org/3/tv/${tmdbId}?language=en-US`);
            if (detailRes?.seasons) {
              tmdbSeasons = detailRes.seasons;
              cache.shows.set(tmdbSeasonCacheKey, tmdbSeasons);
            }
          }
        }

        if (tmdbSeasons) {
          const stripArticle = (s: string) => s.replace(/^(the|a|an)\s+/i, '').toLowerCase().trim();
          const seasonPartNorm = stripArticle(seasonPart);
          // Try exact then fuzzy match against TMDB season names
          const matched = tmdbSeasons.find((s: any) => {
            if (!s.name || s.season_number === 0) return false;
            const sName = stripArticle(s.name);
            return sName === seasonPartNorm || sName.includes(seasonPartNorm) || seasonPartNorm.includes(sName);
          });
          if (matched) {
            seasonNum = String(matched.season_number);
            console.log(`[Season Name Resolve] "${seasonPart}" → Season ${seasonNum} via TMDB`);
          }
        }
      }

      if (seasonNum) {

        // 1. Show lookup (cached)
        const showCacheKey = showName.toLowerCase();
        let showData = cache.shows.get(showCacheKey);
        if (!showData) {
          const showNameClean = normalizeForSearch(showName);

          if (tmdbToken) {
            const tmdbRes = await fetchTmdb(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(showNameClean)}&language=en-US`);
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
            const res = await fetchWithRetry(`https://api.trakt.tv/search/show?query=${encodeURIComponent(normalizeForSearch(showName))}&limit=3`);
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
            // Strip leading articles (the/a/an) for more forgiving title comparison
            const stripArticle = (s: string) => s.replace(/^(the|a|an)\s+/i, '').trim();
            const episodeNameNorm = stripArticle(episodeName);

            const numberWords: Record<string, string> = {
              one: '1', two: '2', three: '3', four: '4', five: '5',
              six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
              first: '1', second: '2', third: '3', fourth: '4', fifth: '5'
            };

            const romanWords: Record<string, string> = {
              ix: '9', x: '10', viii: '8', vii: '7', vi: '6', v: '5', iv: '4', iii: '3', ii: '2', i: '1'
            };

            const normalizeNumbers = (s: string) => {
              let res = s;
              for (const [word, val] of Object.entries(numberWords)) {
                res = res.replace(new RegExp(`\\b${word}\\b`, 'gi'), val);
              }
              for (const [word, val] of Object.entries(romanWords)) {
                res = res.replace(new RegExp(`\\b${word}\\b`, 'gi'), val);
              }
              return res;
            };

            const normalizeFull = (s: string) => normalizeNumbers(stripArticle(s.toLowerCase()));

            // 3. Exact episode title match (strict OR article/number-normalised)
            const matchedEp = episodes.find((ep: any) => {
              if (!ep.title) return false;
              const epLower = ep.title.toLowerCase();
              if (epLower === episodeName) return true;
              return normalizeFull(epLower) === normalizeFull(episodeName);
            });

            if (matchedEp) {
              resultData = [{ type: 'episode', score: 100, episode: { ...matchedEp, showTitle: showData[0].show.title, showSlug } }];
              handled = true;
            } else if (episodes.length > 0) {
              // Partial scoring for suggestions
              const episodeNameFullNorm = normalizeFull(episodeName);
              const searchWords = episodeNameFullNorm.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 0);
              const scored = episodes.map((ep: any) => {
                let score = 0;
                if (!ep.title) return { ...ep, _score: 0 };
                const epTitle = ep.title.toLowerCase();
                const epTitleFullNorm = normalizeFull(epTitle);
                
                // Substring match using fully normalised titles
                if (epTitleFullNorm.includes(episodeNameFullNorm) || episodeNameFullNorm.includes(epTitleFullNorm)) {
                  score = 50;
                } else if (epTitle.includes(episodeName) || episodeName.includes(epTitle)) {
                  score = 50;
                } else {
                  const epWords = epTitleFullNorm.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 0);
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
      const titleClean = normalizeForSearch(title);
      const query = encodeURIComponent(titleClean);
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
        const fallbackQuery = encodeURIComponent(normalizeForSearch(parts[0]));
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
