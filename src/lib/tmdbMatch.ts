// Netflix title → TMDB match, without touching the Trakt API.
//
// Mirrors the matching pipeline the Trakt sync flow uses (show lookup → season
// resolution → exact episode title match → fuzzy suggestions), but resolves
// everything against TMDB so the result can be written to an import file.

import { normalizeForSearch, normalizeTitle, stripArticle, titleScore } from './titles';
import { TmdbClient, TmdbShowDetails, yearOf } from './tmdb';
import { MediaMatch, describeMatch } from './traktExport';

export interface MatchRequestEntry {
  key: string;
  originalTitle: string;
  groupTitle?: string;
  seasonNumber?: number;
  seasonName?: string;
  episodeTitle?: string;
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

/** "Episode 5", "Folge 5", "Chapter 3", "Part 2" → 5, 5, 3, 2. */
const extractEpisodeNumber = (title: string): number | undefined => {
  const match = title.match(/(?:folge|episode|chapter|part|ep\.?)\s+(\d{1,3})/i);
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

/** Pick the TMDB show that best matches a Netflix show name. */
export const resolveShow = async (
  client: TmdbClient,
  showName: string
): Promise<TmdbShowDetails | null> => {
  const results = await client.searchTv(normalizeForSearch(showName));
  if (results.length === 0) return null;

  const target = normalizeTitle(showName);
  const best = results
    .map(result => {
      const name = result.name || result.original_name || '';
      return { result, score: normalizeTitle(name) === target ? 100 : titleScore(name, showName) };
    })
    .sort((a, b) => b.score - a.score)[0];

  return client.showDetails(best.result.id);
};

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

const matchEpisode = async (
  client: TmdbClient,
  entry: MatchRequestEntry
): Promise<MatchResult | null> => {
  if (!entry.groupTitle || !entry.episodeTitle) return null;

  const details = await resolveShow(client, entry.groupTitle);
  if (!details) return null;

  const seasonNumber = resolveSeasonNumber(details, entry);
  const numbered = (details.seasons || [])
    .filter(season => season.season_number > 0)
    .map(season => season.season_number)
    .sort((a, b) => a - b);

  // With a known season we only look there; otherwise scan the whole show,
  // which is still cheap because season fetches are cached across entries.
  const seasonsToScan = seasonNumber !== undefined ? [seasonNumber] : numbered.slice(0, 30);
  const target = normalizeTitle(entry.episodeTitle);

  const scanned: { season: number; episodes: Awaited<ReturnType<TmdbClient['seasonEpisodes']>> }[] = [];
  for (const season of seasonsToScan) {
    const episodes = await client.seasonEpisodes(details.id, season);
    if (episodes.length === 0) continue;
    scanned.push({ season, episodes });

    const exact = episodes.find(episode => episode.name && normalizeTitle(episode.name) === target);
    if (exact) {
      return {
        key: entry.key,
        status: 'matched',
        match: episodeMatchFrom(details, exact.season_number ?? season, exact.episode_number, exact.name, exact.id),
        candidates: [],
      };
    }
  }

  // "Episode 4" style titles carry the number instead of a name.
  const explicitNumber = extractEpisodeNumber(entry.episodeTitle);
  if (explicitNumber !== undefined && scanned.length === 1) {
    const episode = scanned[0].episodes.find(e => e.episode_number === explicitNumber);
    if (episode) {
      return {
        key: entry.key,
        status: 'matched',
        match: episodeMatchFrom(details, episode.season_number ?? scanned[0].season, episode.episode_number, episode.name, episode.id),
        candidates: [],
      };
    }
  }

  const candidates = scanned
    .flatMap(({ season, episodes }) =>
      episodes.map(episode => ({
        episode,
        season: episode.season_number ?? season,
        score: titleScore(episode.name || '', entry.episodeTitle!),
      }))
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ episode, season, score }) =>
      toCandidate(
        episodeMatchFrom(details, season, episode.episode_number, episode.name, episode.id),
        score,
        episode.air_date
      )
    );

  candidates.push(toCandidate(showMatchFrom(details), 10, details.first_air_date));

  return {
    key: entry.key,
    status: 'review',
    candidates,
    note: `Found "${details.name}" but no episode called "${entry.episodeTitle}"${
      seasonNumber !== undefined ? ` in season ${seasonNumber}` : ''
    }.`,
  };
};

const matchMovieOrShow = async (
  client: TmdbClient,
  entry: MatchRequestEntry
): Promise<MatchResult> => {
  const query = normalizeForSearch(entry.originalTitle);
  let results = await client.searchMulti(query);

  // Fall back to the show name when the full Netflix title finds nothing.
  if (results.length === 0 && entry.groupTitle) {
    results = await client.searchMulti(normalizeForSearch(entry.groupTitle));
  }

  if (results.length === 0) {
    return { key: entry.key, status: 'none', candidates: [], note: 'No TMDB result.' };
  }

  const scored = results
    .map(result => {
      const name = result.title || result.name || result.original_title || result.original_name || '';
      return { result, name, score: titleScore(name, entry.originalTitle) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = scored[0];
  const isExact = normalizeTitle(top.name) === normalizeTitle(entry.originalTitle);

  if (isExact && top.result.media_type === 'movie') {
    const detail = await client.movieDetails(top.result.id);
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
      const details = await client.showDetails(result.id);
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
  client: TmdbClient,
  entry: MatchRequestEntry
): Promise<MatchResult> => {
  try {
    const episodeResult = await matchEpisode(client, entry);
    if (episodeResult && episodeResult.status === 'matched') return episodeResult;

    // A title like "Bad Boys: Ride or Die" parses as a show + episode but is a
    // movie, so always give the movie search a chance before settling.
    if (!episodeResult) return await matchMovieOrShow(client, entry);

    const fallback = await matchMovieOrShow(client, entry);
    if (fallback.status === 'matched') return fallback;

    return {
      ...episodeResult,
      candidates: [...episodeResult.candidates, ...fallback.candidates].slice(0, 8),
    };
  } catch {
    return { key: entry.key, status: 'none', candidates: [], note: 'Lookup failed.' };
  }
};

/** Free-text TMDB search used by the manual review UI. */
export const searchCandidates = async (
  client: TmdbClient,
  query: string
): Promise<MatchCandidate[]> => {
  const results = await client.searchMulti(normalizeForSearch(query));
  const candidates: MatchCandidate[] = [];

  for (const result of results.slice(0, 8)) {
    const name = result.title || result.name || result.original_title || result.original_name || '';
    if (result.media_type === 'movie') {
      candidates.push(
        toCandidate(
          { type: 'movie', title: name, year: yearOf(result.release_date), tmdbId: result.id },
          titleScore(name, query),
          result.release_date
        )
      );
    } else {
      const details = await client.showDetails(result.id);
      if (details) candidates.push(toCandidate(showMatchFrom(details), titleScore(name, query), result.first_air_date));
    }
  }

  return candidates;
};

/** Episode list for a show, used when a review item needs a specific episode. */
export const listEpisodeCandidates = async (
  client: TmdbClient,
  showTmdbId: number,
  seasonNumber?: number,
  episodeTitle?: string
): Promise<MatchCandidate[]> => {
  const details = await client.showDetails(showTmdbId);
  if (!details) return [];

  const seasons = (details.seasons || [])
    .filter(season => season.season_number > 0)
    .map(season => season.season_number)
    .sort((a, b) => a - b);

  const toScan = seasonNumber !== undefined ? [seasonNumber] : seasons.slice(0, 30);
  const candidates: MatchCandidate[] = [];

  for (const season of toScan) {
    const episodes = await client.seasonEpisodes(showTmdbId, season);
    for (const episode of episodes) {
      candidates.push(
        toCandidate(
          episodeMatchFrom(details, episode.season_number ?? season, episode.episode_number, episode.name, episode.id),
          episodeTitle ? titleScore(episode.name || '', episodeTitle) : 0,
          episode.air_date
        )
      );
    }
  }

  if (episodeTitle) candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 60);
};
