// Parsing of the raw NetflixViewingHistory.csv rows.
//
// Netflix gives us exactly two columns — a messy title and a watch date — so
// everything (show name, season, episode title) has to be recovered from the
// title string. This module is shared by the Trakt sync dashboard and the
// export dashboard so both flows see identical items.

export interface NetflixEntry {
  /** Stable identity used as a React key and to round-trip items through the match API. */
  key: string;
  originalTitle: string;
  groupTitle?: string;
  seasonNumber?: number;
  /** Raw Netflix season label when it cannot be resolved to a number (e.g. "Enter The Cyber Game"). */
  seasonName?: string;
  episodeTitle?: string;
  /** Every watch date for this title, most recent first. */
  dates: string[];
}

export type DateOrder = 'dmy' | 'mdy';

const SEASON_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};

/**
 * "Season 1" → 1, "Season One" → 1, "Part Two" → 2, "Chapter III" → 3.
 * Returns undefined when the label carries no number at all.
 */
export const wordToSeasonNumber = (text: string): number | undefined => {
  const digitMatch = text.match(/(\d{1,2})/);
  if (digitMatch) return parseInt(digitMatch[1], 10);

  const lower = text.toLowerCase();
  for (const [word, num] of Object.entries(SEASON_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return num;
  }
  return undefined;
};

interface ParsedTitle {
  groupTitle?: string;
  seasonNumber?: number;
  seasonName?: string;
  episodeTitle?: string;
}

/** Recover show / season / episode from a single Netflix title string. */
export const parseNetflixTitle = (originalTitle: string): ParsedTitle => {
  let groupTitle: string | undefined;
  let seasonNumber: number | undefined;
  let episodeTitle: string | undefined;

  // Every pattern below matches the *first* season-like segment (non-greedy
  // show name). Netflix episode titles routinely contain colons themselves —
  // "Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers" —
  // and a greedy show name would swallow the season and mangle the episode.

  // regex 1: TvShow: Season 1 (or Season One): EpisodeTitle
  let match = originalTitle.match(/^(.+?):\s+((?:Season|Part|Chapter|Series|Volume)\s+[\w]+):\s+(.*)$/);
  if (match) {
    groupTitle = match[1].trim();
    seasonNumber = wordToSeasonNumber(match[2]);
    episodeTitle = match[3].trim();
  } else {
    // regex 1b: TvShow: Season 1 - Part A: EpisodeTitle (dash variant)
    match = originalTitle.match(/^(.+?):\s+((?:Season|Part|Chapter|Series|Volume)\s+[\w]+)\s+[–-]\s+.+?:\s+(.*)$/);
    if (match) {
      groupTitle = match[1].trim();
      seasonNumber = wordToSeasonNumber(match[2]);
      episodeTitle = match[3].trim();
    } else {
      // regex 2: localized season labels: TvShow: Temporada 1: EpisodeTitle
      match = originalTitle.match(/^(.+?):\s+\S+\s+(\d{1,2}):\s+(.*)$/);
      if (match) {
        groupTitle = match[1].trim();
        seasonNumber = parseInt(match[2], 10);
        episodeTitle = match[3].trim();
      } else {
        // regex 3: TvShow: Miniseries: EpisodeTitle
        match = originalTitle.match(/^(.+?):\s+\w+:\s+(.+)$/);
        if (match) {
          groupTitle = match[1].trim();
          seasonNumber = 1;
          episodeTitle = match[2].trim();
        } else {
          // regex 4: TvShow: SeasonName: EpisodeTitle — SeasonName may be arbitrary
          match = originalTitle.match(/^(.+?):\s+(.+?):\s+(.+)$/);
          if (match) {
            groupTitle = match[1].trim();
            seasonNumber = wordToSeasonNumber(match[2]);
            episodeTitle = match[3].trim();
          } else {
            // regex 5: TvShow: EpisodeTitle
            match = originalTitle.match(/^(.+?):\s+(.+)$/);
            if (match) {
              groupTitle = match[1].trim();
              seasonNumber = 1;
              episodeTitle = match[2].trim();
            }
          }
        }
      }
    }
  }

  // Keep the raw middle segment around when it could not be turned into a
  // number — TMDB can still resolve named seasons later.
  let seasonName: string | undefined;
  if (seasonNumber === undefined && groupTitle && episodeTitle) {
    const midMatch = originalTitle.match(/^.+?:\s+(.+?):\s+.+$/);
    if (midMatch) {
      const mid = midMatch[1].trim();
      if (!wordToSeasonNumber(mid)) seasonName = mid;
    }
  }

  return { groupTitle, seasonNumber, seasonName, episodeTitle };
};

/**
 * Netflix exports dates in the account's locale, so 03/04/2024 is ambiguous.
 * A single unambiguous row (a day > 12 or a month > 12) settles it for the
 * whole file; otherwise the caller decides.
 */
export const detectDateOrder = (dates: string[]): DateOrder | null => {
  for (const raw of dates) {
    const parts = String(raw).trim().split(/[/.\-]/);
    if (parts.length !== 3) continue;
    // ISO dates carry a 4-digit year first — no ambiguity to resolve.
    if (parts[0].length === 4) continue;
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    if (first > 12 && second <= 12) return 'dmy';
    if (second > 12 && first <= 12) return 'mdy';
  }
  return null;
};

/** Parse a Netflix date into calendar parts, or null when it is unusable. */
export const parseWatchedDate = (
  value: string,
  order: DateOrder
): { year: number; month: number; day: number } | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const parts = raw.split(/[/.\-]/).map(p => p.trim());
  if (parts.length !== 3 || parts.some(p => !/^\d+$/.test(p))) return null;

  let year: number;
  let month: number;
  let day: number;

  if (parts[0].length === 4) {
    // ISO-ish: YYYY-MM-DD
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else if (order === 'dmy') {
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  } else {
    month = parseInt(parts[0], 10);
    day = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }

  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
};

/**
 * Trakt stores watch times in UTC but Netflix only gives us a calendar day.
 * Midday UTC keeps the date correct for every timezone from UTC-11 to UTC+11.
 */
export const toWatchedAtIso = (value: string, order: DateOrder): string | null => {
  const parsed = parseWatchedDate(value, order);
  if (!parsed) return null;
  const { year, month, day } = parsed;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T12:00:00.000Z`;
};

/** Sort key for a watch date — larger is more recent, 0 when unparseable. */
const dateSortValue = (value: string, order: DateOrder): number => {
  const parsed = parseWatchedDate(value, order);
  if (!parsed) return 0;
  return parsed.year * 10000 + parsed.month * 100 + parsed.day;
};

/**
 * Turn raw CSV rows into de-duplicated entries, newest first.
 * Repeat watches of the same title collapse into one entry with many dates.
 */
export const parseNetflixRows = (rows: string[][], order: DateOrder = 'mdy'): NetflixEntry[] => {
  const dataRows = rows.filter((row, index) => {
    if (!row || row.length < 1 || !row[0] || row[0].trim() === '') return false;
    // Drop the header row Netflix ships ("Title,Date").
    if (index === 0 && row[0].trim().toLowerCase() === 'title') return false;
    return true;
  });

  const entries = new Map<string, NetflixEntry>();

  dataRows.forEach(row => {
    const originalTitle = row[0].trim();
    const date = row[1] ? row[1].trim() : '';

    if (entries.has(originalTitle)) {
      entries.get(originalTitle)!.dates.push(date);
      return;
    }

    // Rewatches of a title that was split into several sub-episodes.
    if (entries.has(`${originalTitle}|||split0`)) {
      let splitIdx = 0;
      while (entries.has(`${originalTitle}|||split${splitIdx}`)) {
        entries.get(`${originalTitle}|||split${splitIdx}`)!.dates.push(date);
        splitIdx++;
      }
      return;
    }

    const { groupTitle, seasonNumber, seasonName, episodeTitle } = parseNetflixTitle(originalTitle);

    // Netflix packs double episodes into one row: "The Third/The Debt".
    const splitEpisodeTitles = episodeTitle
      ? episodeTitle.split('/').map(p => p.trim()).filter(p => p.length > 0)
      : [];

    if (splitEpisodeTitles.length >= 2) {
      splitEpisodeTitles.forEach((subEpisodeTitle, idx) => {
        const key = `${originalTitle}|||split${idx}`;
        entries.set(key, {
          key,
          originalTitle: `${originalTitle} [Part ${idx + 1}: ${subEpisodeTitle}]`,
          groupTitle,
          seasonNumber,
          seasonName,
          episodeTitle: subEpisodeTitle,
          dates: [date],
        });
      });
      return;
    }

    entries.set(originalTitle, {
      key: originalTitle,
      originalTitle,
      groupTitle,
      seasonNumber,
      seasonName,
      episodeTitle,
      dates: [date],
    });
  });

  const list = Array.from(entries.values());
  list.forEach(entry => {
    entry.dates.sort((a, b) => dateSortValue(b, order) - dateSortValue(a, order));
  });
  list.sort((a, b) => dateSortValue(b.dates[0], order) - dateSortValue(a.dates[0], order));
  return list;
};
