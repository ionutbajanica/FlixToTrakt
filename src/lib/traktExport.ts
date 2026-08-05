// Builders for the files Trakt's own importer accepts
// (Trakt → Settings → import your data). Nothing here talks to the Trakt API,
// which is the whole point: an import file is the one way into a Trakt account
// that does not need an OAuth application.

export interface MovieMatch {
  type: 'movie';
  title: string;
  year?: number;
  tmdbId: number;
  imdbId?: string;
}

export interface EpisodeMatch {
  type: 'episode';
  showTitle: string;
  showYear?: number;
  showTmdbId: number;
  showImdbId?: string;
  showTvdbId?: number;
  season: number;
  number: number;
  episodeTitle?: string;
  episodeTmdbId?: number;
}

/** An entire show marked as watched — every episode, in one entry. */
export interface ShowMatch {
  type: 'show';
  title: string;
  year?: number;
  tmdbId: number;
  imdbId?: string;
  tvdbId?: number;
}

export type MediaMatch = MovieMatch | EpisodeMatch | ShowMatch;

export interface WatchRecord {
  media: MediaMatch;
  /** ISO-8601 UTC timestamp. */
  watchedAt: string;
}

export const describeMatch = (media: MediaMatch): string => {
  if (media.type === 'movie') return `${media.title}${media.year ? ` (${media.year})` : ''}`;
  if (media.type === 'show') return `${media.title}${media.year ? ` (${media.year})` : ''} — entire show`;
  const code = `S${String(media.season).padStart(2, '0')}E${String(media.number).padStart(2, '0')}`;
  return `${media.showTitle} ${code}${media.episodeTitle ? `: ${media.episodeTitle}` : ''}`;
};

// ── Trakt JSON ─────────────────────────────────────────────────────────────
// Same shape as Trakt's /sync/history payload: movies at the top level, shows
// carrying nested seasons/episodes. Repeat watches appear as repeated entries.

interface JsonIds {
  tmdb?: number;
  imdb?: string;
  tvdb?: number;
}

interface JsonMovie {
  title: string;
  year?: number;
  ids: JsonIds;
  watched_at: string;
}

interface JsonEpisode {
  number: number;
  watched_at: string;
}

interface JsonSeason {
  number: number;
  episodes: JsonEpisode[];
}

interface JsonShow {
  title: string;
  year?: number;
  ids: JsonIds;
  /** Present on whole-show entries; shows with nested seasons omit it. */
  watched_at?: string;
  seasons?: JsonSeason[];
}

const cleanIds = (ids: JsonIds): JsonIds => {
  const out: JsonIds = {};
  if (ids.tmdb) out.tmdb = ids.tmdb;
  if (ids.imdb) out.imdb = ids.imdb;
  if (ids.tvdb) out.tvdb = ids.tvdb;
  return out;
};

export const buildTraktHistory = (records: WatchRecord[]): { movies?: JsonMovie[]; shows?: JsonShow[] } => {
  const movies: JsonMovie[] = [];
  const shows: JsonShow[] = [];
  // One accumulator per show so episodes end up nested under their parent.
  const showBuckets = new Map<number, JsonShow & { seasons: JsonSeason[] }>();

  for (const { media, watchedAt } of records) {
    if (media.type === 'movie') {
      movies.push({
        title: media.title,
        ...(media.year ? { year: media.year } : {}),
        ids: cleanIds({ tmdb: media.tmdbId, imdb: media.imdbId }),
        watched_at: watchedAt,
      });
      continue;
    }

    if (media.type === 'show') {
      shows.push({
        title: media.title,
        ...(media.year ? { year: media.year } : {}),
        ids: cleanIds({ tmdb: media.tmdbId, imdb: media.imdbId, tvdb: media.tvdbId }),
        watched_at: watchedAt,
      });
      continue;
    }

    let bucket = showBuckets.get(media.showTmdbId);
    if (!bucket) {
      bucket = {
        title: media.showTitle,
        ...(media.showYear ? { year: media.showYear } : {}),
        ids: cleanIds({ tmdb: media.showTmdbId, imdb: media.showImdbId, tvdb: media.showTvdbId }),
        seasons: [],
      };
      showBuckets.set(media.showTmdbId, bucket);
      shows.push(bucket);
    }

    let season = bucket.seasons.find(s => s.number === media.season);
    if (!season) {
      season = { number: media.season, episodes: [] };
      bucket.seasons.push(season);
    }

    season.episodes.push({ number: media.number, watched_at: watchedAt });
  }

  for (const bucket of Array.from(showBuckets.values())) {
    bucket.seasons.sort((a, b) => a.number - b.number);
    bucket.seasons.forEach(season => {
      season.episodes.sort((a, b) => a.number - b.number || a.watched_at.localeCompare(b.watched_at));
    });
  }

  return {
    ...(movies.length ? { movies } : {}),
    ...(shows.length ? { shows } : {}),
  };
};

export const buildTraktJson = (records: WatchRecord[]): string =>
  JSON.stringify(buildTraktHistory(records), null, 2);

// ── CSV ────────────────────────────────────────────────────────────────────

const csvCell = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csvRows = (header: string[], rows: (string | number | undefined)[][]): string =>
  [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

/**
 * Flat, one-row-per-watch CSV mirroring the column names Trakt uses in its own
 * data files, so the importer can map it without hand-editing.
 */
export const buildTraktCsv = (records: WatchRecord[]): string => {
  const header = [
    'watched_at', 'type', 'title', 'year', 'imdb_id', 'tmdb_id', 'tvdb_id',
    'season_number', 'episode_number', 'episode_title', 'episode_tmdb_id',
  ];

  const rows = records.map(({ media, watchedAt }) => {
    if (media.type === 'movie') {
      return [watchedAt, 'movie', media.title, media.year, media.imdbId, media.tmdbId, '', '', '', '', ''];
    }
    if (media.type === 'show') {
      return [watchedAt, 'show', media.title, media.year, media.imdbId, media.tmdbId, media.tvdbId, '', '', '', ''];
    }
    return [
      watchedAt, 'episode', media.showTitle, media.showYear, media.showImdbId, media.showTmdbId,
      media.showTvdbId, media.season, media.number, media.episodeTitle, media.episodeTmdbId,
    ];
  });

  return csvRows(header, rows);
};

/**
 * Letterboxd diary format — movies only, but it is the best-documented file
 * Trakt's importer takes, so it doubles as a fallback when the generic CSV is
 * rejected. It also imports straight into Letterboxd.
 */
export const buildLetterboxdCsv = (records: WatchRecord[]): string => {
  const header = ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'];
  const seen = new Set<string>();

  const rows = records
    .filter((record): record is WatchRecord & { media: MovieMatch } => record.media.type === 'movie')
    .map(({ media, watchedAt }) => {
      const day = watchedAt.slice(0, 10);
      const key = `${media.tmdbId}|${day}`;
      const rewatch = seen.has(`${media.tmdbId}`) ? 'Yes' : '';
      seen.add(`${media.tmdbId}`);
      seen.add(key);
      return [day, media.title, media.year, '', '', rewatch, '', day];
    });

  return csvRows(header, rows);
};

export const summarizeRecords = (records: WatchRecord[]) => {
  const movies = records.filter(r => r.media.type === 'movie').length;
  const episodes = records.filter(r => r.media.type === 'episode').length;
  const shows = records.filter(r => r.media.type === 'show').length;
  return { movies, episodes, shows, total: records.length };
};
