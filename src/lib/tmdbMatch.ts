// Netflix title → TMDB match, without touching the Trakt API.
//
// Pipeline: rank candidate shows → resolve the season → look for the episode
// (exact title, multi-part title, near-identical spelling, "Episode N", then a
// clear-winner fuzzy score) first in the season Netflix named, then across the
// rest of the show → fall back to a movie/show search. Everything resolves
// against TMDB so the result can be written to an import file, and the Trakt
// sync route reuses the same matcher.

import {
  isCloseTitle,
  normalizeForSearch,
  normalizeTitle,
  sameNormalized,
  splitNormalizedPart,
  stripArticle,
  stripPartSuffix,
  titleScore,
  tmdbPartNumber,
} from './titles.ts';
import { DEFAULT_LANGUAGE, yearOf } from './tmdb.ts';
import type { TmdbApi, TmdbEpisode, TmdbSearchResult, TmdbShowDetails } from './tmdb.ts';
import { describeMatch } from './traktExport.ts';
import type { MediaMatch } from './traktExport.ts';

export interface MatchRequestEntry {
  key: string;
  originalTitle: string;
  groupTitle?: string;
  seasonNumber?: number;
  seasonName?: string;
  episodeTitle?: string;
  /** Earliest watch date (YYYY-MM-DD). Anything released after it is ruled out. */
  watchedBefore?: string;
  /** Match episodes against this TMDB show only — set when the user has picked the show. */
  showTmdbId?: number;
}

export interface MatchOptions {
  /** TMDB language of the Netflix history; English names are always checked too. */
  language?: string;
}

export interface MatchCandidate {
  id: string;
  label: string;
  score: number;
  /** Release/air date, so the UI can hide titles that postdate the watch. */
  releaseDate?: string;
  media: MediaMatch;
}

export interface MatchResult {
  key: string;
  status: 'matched' | 'review' | 'none';
  match?: MediaMatch;
  candidates: MatchCandidate[];
  note?: string;
}

/** A fuzzy score this high, this far ahead of the runner-up, is accepted without review. */
const AUTO_ACCEPT_SCORE = 85;
const AUTO_ACCEPT_MARGIN = 15;

/** Shows tried per lookup; the episode title decides between them. */
const SHOW_CANDIDATES = 3;
/** Runner-up shows must at least look like the name Netflix gave. */
const MIN_RUNNER_UP_SHOW_SCORE = 60;
/** Seasons scanned per show at most — season fetches are cached, but not free. */
const MAX_SEASONS = 30;

/**
 * Netflix and TMDB disagree on release days by a little (time zones, regional
 * premieres), so a release a few days after the watch date is still plausible.
 */
const RELEASE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

const releasedBy = (releaseDate: string | undefined, watchedBefore: string | undefined): boolean => {
  if (!releaseDate || !watchedBefore) return true;
  const released = Date.parse(releaseDate);
  const watched = Date.parse(watchedBefore);
  if (Number.isNaN(released) || Number.isNaN(watched)) return true;
  return released <= watched + RELEASE_GRACE_MS;
};

/** "Episode 5", "Folge 5", "Chapter 3", "Part 2" → 5, 5, 3, 2. */
const extractEpisodeNumber = (title: string): number | undefined => {
  const match = title.match(/(?:folge|episode|episodio|épisode|chapter|part|ep\.?)\s+(\d{1,3})/i);
  if (match) return parseInt(match[1], 10);
  return undefined;
};

const candidateId = (media: MediaMatch): string => {
  if (media.type === 'movie') return `movie-${media.tmdbId}`;
  if (media.type === 'show') return `show-${media.tmdbId}`;
  return `episode-${media.showTmdbId}-${media.season}-${media.number}`;
};

export const toCandidate = (media: MediaMatch, score: number, releaseDate?: string): MatchCandidate => ({
  id: candidateId(media),
  label: describeMatch(media),
  score,
  releaseDate,
  media,
});

const showMatchFrom = (details: TmdbShowDetails): MediaMatch => ({
  type: 'show',
  title: details.name,
  year: yearOf(details.first_air_date),
  tmdbId: details.id,
  imdbId: details.external_ids?.imdb_id ?? undefined,
  tvdbId: details.external_ids?.tvdb_id ?? undefined,
});

const episodeMatchFrom = (
  details: TmdbShowDetails,
  season: number,
  number: number,
  episodeTitle?: string,
  episodeTmdbId?: number
): MediaMatch => ({
  type: 'episode',
  showTitle: details.name,
  showYear: yearOf(details.first_air_date),
  showTmdbId: details.id,
  showImdbId: details.external_ids?.imdb_id ?? undefined,
  showTvdbId: details.external_ids?.tvdb_id ?? undefined,
  season,
  number,
  episodeTitle,
  episodeTmdbId,
});

/** Every name TMDB has for a search result: localised and original. */
const namesOf = (result: TmdbSearchResult): string[] =>
  [result.title, result.name, result.original_title, result.original_name].filter(
    (name): name is string => !!name
  );

const releaseDateOf = (result: TmdbSearchResult) => result.release_date || result.first_air_date;

const bestScore = (names: string[], target: string) =>
  names.reduce((best, name) => Math.max(best, titleScore(name, target)), 0);

/** True when the top score is high enough and far enough ahead of the next one. */
const isClearWinner = (scores: number[]) =>
  scores.length > 0 &&
  scores[0] >= AUTO_ACCEPT_SCORE &&
  (scores.length === 1 || scores[0] - scores[1] >= AUTO_ACCEPT_MARGIN);

/**
 * TMDB shows that could be the one Netflix calls `showName`, best first.
 *
 * Several are returned on purpose: same-name shows (remakes, revivals, a UK and
 * a US version) score identically on the name, and only the episode title can
 * tell them apart. Shows that premiered after the watch date are dropped.
 */
export const rankShows = async (
  client: TmdbApi,
  showName: string,
  watchedBefore?: string,
  language = DEFAULT_LANGUAGE
): Promise<TmdbShowDetails[]> => {
  const results = await client.searchTv(normalizeForSearch(showName), language);

  const ranked = results
    .filter(result => releasedBy(result.first_air_date, watchedBefore))
    .map(result => ({ result, score: bestScore(namesOf(result), showName) }))
    .sort((a, b) => b.score - a.score || (b.result.popularity ?? 0) - (a.result.popularity ?? 0))
    .filter((entry, index) => index === 0 || entry.score >= MIN_RUNNER_UP_SHOW_SCORE)
    .slice(0, SHOW_CANDIDATES);

  const details = await Promise.all(ranked.map(({ result }) => client.showDetails(result.id, language)));
  return details.filter((d): d is TmdbShowDetails => d !== null);
};

/** Pick the TMDB show that best matches a Netflix show name. */
export const resolveShow = async (
  client: TmdbApi,
  showName: string,
  watchedBefore?: string,
  language = DEFAULT_LANGUAGE
): Promise<TmdbShowDetails | null> => (await rankShows(client, showName, watchedBefore, language))[0] ?? null;

/** Netflix sometimes names seasons instead of numbering them ("Enter The Cyber Game"). */
const resolveSeasonNumber = (details: TmdbShowDetails, entry: MatchRequestEntry): number | undefined => {
  if (entry.seasonNumber !== undefined) return entry.seasonNumber;
  if (!entry.seasonName) return undefined;

  const wanted = stripArticle(entry.seasonName.toLowerCase());
  const matched = (details.seasons || []).find(season => {
    if (!season.name || season.season_number === 0) return false;
    const name = stripArticle(season.name.toLowerCase());
    return name === wanted || name.includes(wanted) || wanted.includes(name);
  });

  return matched?.season_number;
};

interface ScannedEpisode {
  episode: TmdbEpisode;
  season: number;
  /** The episode's name in the history's language and in English. */
  names: string[];
}

/**
 * One season's episodes, carrying both the localised and the English name, so
 * a German history matches German titles while English ones still work.
 */
const loadSeason = async (
  client: TmdbApi,
  showId: number,
  season: number,
  language: string
): Promise<ScannedEpisode[]> => {
  const primary = await client.seasonEpisodes(showId, season, language);
  if (language === DEFAULT_LANGUAGE) {
    return primary.map(episode => ({
      episode,
      season: episode.season_number ?? season,
      names: episode.name ? [episode.name] : [],
    }));
  }

  const english = await client.seasonEpisodes(showId, season, DEFAULT_LANGUAGE);
  const englishNames = new Map(english.map(episode => [episode.episode_number, episode.name]));
  const base = primary.length > 0 ? primary : english;
  return base.map(episode => ({
    episode,
    season: episode.season_number ?? season,
    names: Array.from(
      new Set([episode.name, englishNames.get(episode.episode_number)].filter((n): n is string => !!n))
    ),
  }));
};

type FoundHow = 'exact' | 'part' | 'close' | 'number' | 'fuzzy';

const findEpisode = (
  episodes: ScannedEpisode[],
  episodeTitle: string,
  options: { fuzzy: boolean; byNumber: boolean }
): { found: ScannedEpisode; how: FoundHow } | null => {
  const target = normalizeTitle(episodeTitle);
  // Netflix sometimes spells the part out ("No More Part I" → "no more part
  // 1" once normalized); TMDB always uses a "(1)" suffix instead.
  const { base: targetBase, part: targetPart } = splitNormalizedPart(target);

  const exact = episodes.find(ep => ep.names.some(name => sameNormalized(normalizeTitle(name), target)));
  if (exact) return { found: exact, how: 'exact' };

  // TMDB numbers multi-part episodes ("Hurt (1)", "No More (2)") while
  // Netflix either repeats the bare title for every part or spells the part
  // out ("No More Part I"). Match on the base title, and on the part number
  // too whenever Netflix's title gave us one.
  const partMatches = episodes.filter(ep =>
    ep.names.some(name => {
      const epPart = tmdbPartNumber(name);
      if (epPart === undefined) return false;
      if (!sameNormalized(normalizeTitle(stripPartSuffix(name)), targetBase)) return false;
      return targetPart === undefined || targetPart === epPart;
    })
  );
  if (partMatches.length === 1) return { found: partMatches[0], how: 'part' };

  // Netflix and TMDB occasionally spell a title slightly differently —
  // usually localisation drift, like "Nuevo Orleans" vs "Nueva Orleans".
  // Exactly one near-identical spelling is treated as the match.
  const closeMatches = episodes.filter(ep => ep.names.some(name => isCloseTitle(normalizeTitle(name), target)));
  if (closeMatches.length === 1) return { found: closeMatches[0], how: 'close' };

  // "Episode 4" style titles carry the number instead of a name.
  if (options.byNumber) {
    const number = extractEpisodeNumber(episodeTitle);
    const numbered = number !== undefined ? episodes.find(ep => ep.episode.episode_number === number) : undefined;
    if (numbered) return { found: numbered, how: 'number' };
  }

  if (!options.fuzzy) return null;

  const scored = episodes
    .map(ep => ({ ep, score: bestScore(ep.names, episodeTitle) }))
    .sort((a, b) => b.score - a.score);
  if (isClearWinner(scored.map(s => s.score))) return { found: scored[0].ep, how: 'fuzzy' };

  return null;
};

interface ShowAttempt {
  details: TmdbShowDetails;
  seasonNumber?: number;
  /** Seasons to search, in order: the one Netflix named, the rest, then specials. */
  tiers: { seasons: number[]; fuzzy: boolean; byNumber: boolean }[];
  scanned: ScannedEpisode[];
}

const buildAttempt = (details: TmdbShowDetails, entry: MatchRequestEntry): ShowAttempt => {
  const seasonNumber = resolveSeasonNumber(details, entry);
  const numbered = (details.seasons || [])
    .map(season => season.season_number)
    .filter(n => n > 0)
    .sort((a, b) => a - b);
  const hasSpecials = (details.seasons || []).some(season => season.season_number === 0);

  const tiers: ShowAttempt['tiers'] = [];
  if (seasonNumber !== undefined) {
    tiers.push({ seasons: [seasonNumber], fuzzy: true, byNumber: true });
  }
  // Netflix's season label is often wrong for TMDB: titles with no season
  // default to 1, and "Part 3" need not be TMDB's season 3. Widen to the
  // whole show before giving up.
  const rest = numbered.filter(n => n !== seasonNumber).slice(0, MAX_SEASONS);
  if (rest.length > 0) {
    tiers.push({ seasons: rest, fuzzy: true, byNumber: seasonNumber === undefined && numbered.length === 1 });
  }
  // Specials only on an exact-ish title: "Pilot" lookalikes live there too.
  if (hasSpecials) tiers.push({ seasons: [0], fuzzy: false, byNumber: false });

  return { details, seasonNumber, tiers, scanned: [] };
};

/** Result of the episode search, with how sure it is. */
interface EpisodeOutcome {
  result: MatchResult;
  how?: FoundHow;
}

const matchEpisode = async (
  client: TmdbApi,
  entry: MatchRequestEntry,
  language: string
): Promise<EpisodeOutcome | null> => {
  if (!entry.groupTitle || !entry.episodeTitle) return null;

  const shows =
    entry.showTmdbId !== undefined
      ? [await client.showDetails(entry.showTmdbId, language)].filter((d): d is TmdbShowDetails => d !== null)
      : await rankShows(client, entry.groupTitle, entry.watchedBefore, language);
  if (shows.length === 0) return null;

  const attempts = shows.map(details => buildAttempt(details, entry));
  const tierCount = Math.max(...attempts.map(a => a.tiers.length));

  // Tier by tier across all candidate shows: an exact hit in the season
  // Netflix named, in the second-ranked show, beats a hit in some other
  // season of the first one.
  for (let tier = 0; tier < tierCount; tier++) {
    for (const attempt of attempts) {
      const spec = attempt.tiers[tier];
      if (!spec) continue;

      const episodes: ScannedEpisode[] = [];
      for (const season of spec.seasons) {
        episodes.push(...(await loadSeason(client, attempt.details.id, season, language)));
      }
      // An episode that aired after the watch date is not what was watched —
      // usually a sign this is a same-name remake.
      const eligible = episodes.filter(ep => releasedBy(ep.episode.air_date, entry.watchedBefore));
      attempt.scanned.push(...eligible.filter(ep => ep.season > 0));

      const hit = findEpisode(eligible, entry.episodeTitle, spec);
      if (hit) {
        const { episode, season } = hit.found;
        return {
          how: hit.how,
          result: {
            key: entry.key,
            status: 'matched',
            match: episodeMatchFrom(attempt.details, season, episode.episode_number, episode.name, episode.id),
            candidates: [],
          },
        };
      }
    }
  }

  const best = attempts[0];
  const candidates = attempts
    .flatMap(attempt =>
      attempt.scanned.map(ep => ({ attempt, ep, score: bestScore(ep.names, entry.episodeTitle!) }))
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ attempt, ep, score }) =>
      toCandidate(
        episodeMatchFrom(attempt.details, ep.season, ep.episode.episode_number, ep.episode.name, ep.episode.id),
        score,
        ep.episode.air_date
      )
    );

  attempts.forEach((attempt, index) =>
    candidates.push(toCandidate(showMatchFrom(attempt.details), 10 - index, attempt.details.first_air_date))
  );

  const otherShows = attempts.length > 1 ? ` (also checked ${attempts.length - 1} similarly named show${attempts.length > 2 ? 's' : ''})` : '';
  return {
    result: {
      key: entry.key,
      status: 'review',
      candidates,
      note: `Found "${best.details.name}" but no episode called "${entry.episodeTitle}" in any season${otherShows}.`,
    },
  };
};

const matchMovieOrShow = async (
  client: TmdbApi,
  entry: MatchRequestEntry,
  language: string
): Promise<MatchResult> => {
  let results = await client.searchMulti(normalizeForSearch(entry.originalTitle), language);

  // Fall back to the show name when the full Netflix title finds nothing.
  if (results.length === 0 && entry.groupTitle) {
    results = await client.searchMulti(normalizeForSearch(entry.groupTitle), language);
  }

  if (results.length === 0) {
    return { key: entry.key, status: 'none', candidates: [], note: 'No TMDB result.' };
  }

  // Titles released after the watch date cannot be what was watched. If that
  // rules out everything, the dates are probably off — keep them as
  // suggestions but never auto-match from them.
  const released = results.filter(result => releasedBy(releaseDateOf(result), entry.watchedBefore));
  const pool = released.length > 0 ? released : results;

  const scored = pool
    .map(result => {
      const names = namesOf(result);
      const target = normalizeTitle(entry.originalTitle);
      return {
        result,
        name: result.title || result.name || result.original_title || result.original_name || '',
        score: bestScore(names, entry.originalTitle),
        exact: names.some(name => sameNormalized(normalizeTitle(name), target)),
      };
    })
    .sort((a, b) => b.score - a.score || (b.result.popularity ?? 0) - (a.result.popularity ?? 0))
    .slice(0, 5);

  const top = scored[0];
  const exactMovies = scored.filter(s => s.exact && s.result.media_type === 'movie');
  // Same-title movies (remakes) both clear the date filter when the watch
  // came after both — take the far more popular one, or ask.
  const unambiguousExact =
    exactMovies.length === 1 ||
    (exactMovies.length > 1 && (exactMovies[0].result.popularity ?? 0) >= 2 * (exactMovies[1].result.popularity ?? 0));
  const autoMatch =
    released.length > 0 &&
    top.result.media_type === 'movie' &&
    ((top.exact && unambiguousExact) || (!top.exact && exactMovies.length === 0 && isClearWinner(scored.map(s => s.score))));

  if (autoMatch) {
    const detail = await client.movieDetails(top.result.id, language);
    return {
      key: entry.key,
      status: 'matched',
      match: {
        type: 'movie',
        title: detail?.title || top.name,
        year: yearOf(detail?.release_date || top.result.release_date),
        tmdbId: top.result.id,
        imdbId: detail?.imdb_id ?? undefined,
      },
      candidates: [],
    };
  }

  const candidates: MatchCandidate[] = [];
  for (const { result, name, score } of scored) {
    if (result.media_type === 'movie') {
      candidates.push(
        toCandidate(
          { type: 'movie', title: name, year: yearOf(result.release_date), tmdbId: result.id },
          score,
          result.release_date
        )
      );
    } else {
      const details = await client.showDetails(result.id, language);
      if (details) candidates.push(toCandidate(showMatchFrom(details), score, result.first_air_date));
    }
  }

  return {
    key: entry.key,
    status: candidates.length > 0 ? 'review' : 'none',
    candidates,
    note: candidates.length > 0 ? 'No exact title match — pick the right one.' : undefined,
  };
};

export const matchEntry = async (
  client: TmdbApi,
  entry: MatchRequestEntry,
  options: MatchOptions = {}
): Promise<MatchResult> => {
  const language = options.language || DEFAULT_LANGUAGE;
  try {
    const episodeOutcome = await matchEpisode(client, entry, language);

    // The user picked this show — never wander off to a movie search.
    if (entry.showTmdbId !== undefined) {
      return (
        episodeOutcome?.result ?? { key: entry.key, status: 'none', candidates: [], note: 'Show not found on TMDB.' }
      );
    }

    if (episodeOutcome && episodeOutcome.how && episodeOutcome.how !== 'fuzzy') return episodeOutcome.result;

    // A title like "Bad Boys: Ride or Die" parses as a show + episode but is a
    // movie, so always give the movie search a chance before settling.
    const fallback = await matchMovieOrShow(client, entry, language);
    if (!episodeOutcome) return fallback;

    // An exact movie title beats an episode that only won on a fuzzy score.
    if (fallback.status === 'matched') return fallback;
    if (episodeOutcome.result.status === 'matched') return episodeOutcome.result;

    // Both searches often surface the same show (e.g. as a "whole show"
    // fallback candidate and again via the general title search) — dedupe
    // by id, keeping whichever scored higher, so the UI never has to render
    // two entries with the same key.
    const merged = new Map<string, MatchCandidate>();
    for (const candidate of [...episodeOutcome.result.candidates, ...fallback.candidates]) {
      const existing = merged.get(candidate.id);
      if (!existing || candidate.score > existing.score) merged.set(candidate.id, candidate);
    }

    return {
      ...episodeOutcome.result,
      candidates: Array.from(merged.values()).slice(0, 8),
    };
  } catch {
    return { key: entry.key, status: 'none', candidates: [], note: 'Lookup failed.' };
  }
};

/** Free-text TMDB search used by the manual review UI. */
export const searchCandidates = async (
  client: TmdbApi,
  query: string,
  options: MatchOptions = {}
): Promise<MatchCandidate[]> => {
  const language = options.language || DEFAULT_LANGUAGE;
  const results = await client.searchMulti(normalizeForSearch(query), language);
  const candidates: MatchCandidate[] = [];

  for (const result of results.slice(0, 8)) {
    const name = result.title || result.name || result.original_title || result.original_name || '';
    const score = bestScore(namesOf(result), query);
    if (result.media_type === 'movie') {
      candidates.push(
        toCandidate({ type: 'movie', title: name, year: yearOf(result.release_date), tmdbId: result.id }, score, result.release_date)
      );
    } else {
      const details = await client.showDetails(result.id, language);
      if (details) candidates.push(toCandidate(showMatchFrom(details), score, result.first_air_date));
    }
  }

  return candidates;
};

/** Episode list for a show, used when a review item needs a specific episode. */
export const listEpisodeCandidates = async (
  client: TmdbApi,
  showTmdbId: number,
  seasonNumber?: number,
  episodeTitle?: string,
  options: MatchOptions = {}
): Promise<MatchCandidate[]> => {
  const language = options.language || DEFAULT_LANGUAGE;
  const details = await client.showDetails(showTmdbId, language);
  if (!details) return [];

  const seasons = (details.seasons || [])
    .filter(season => season.season_number > 0)
    .map(season => season.season_number)
    .sort((a, b) => a - b);

  const toScan = seasonNumber !== undefined ? [seasonNumber] : seasons.slice(0, MAX_SEASONS);
  const candidates: MatchCandidate[] = [];

  for (const season of toScan) {
    for (const ep of await loadSeason(client, showTmdbId, season, language)) {
      candidates.push(
        toCandidate(
          episodeMatchFrom(details, ep.season, ep.episode.episode_number, ep.episode.name, ep.episode.id),
          episodeTitle ? bestScore(ep.names, episodeTitle) : 0,
          ep.episode.air_date
        )
      );
    }
  }

  if (episodeTitle) candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 60);
};
