import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TmdbApi, TmdbEpisode, TmdbMovieDetails, TmdbSearchResult, TmdbShowDetails } from './tmdb.ts';
import { matchEntry } from './tmdbMatch.ts';
import type { MatchRequestEntry } from './tmdbMatch.ts';

// An in-memory TMDB. Episodes are keyed "showId/season" (English) or
// "showId/season/lang" for a translated listing.
interface FakeData {
  tv?: Record<string, TmdbSearchResult[]>;
  multi?: Record<string, TmdbSearchResult[]>;
  shows?: TmdbShowDetails[];
  episodes?: Record<string, TmdbEpisode[]>;
  movies?: TmdbMovieDetails[];
}

const fakeClient = (data: FakeData): TmdbApi & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async searchTv(query: string) {
      calls.push(`tv:${query}`);
      return data.tv?.[query] ?? [];
    },
    async searchMulti(query: string) {
      calls.push(`multi:${query}`);
      return data.multi?.[query] ?? [];
    },
    async showDetails(id: number) {
      calls.push(`show:${id}`);
      return data.shows?.find(show => show.id === id) ?? null;
    },
    async seasonEpisodes(showId: number, season: number, language = 'en-US') {
      calls.push(`season:${showId}/${season}/${language}`);
      const localised = data.episodes?.[`${showId}/${season}/${language}`];
      if (localised) return localised;
      return language === 'en-US' ? data.episodes?.[`${showId}/${season}`] ?? [] : [];
    },
    async movieDetails(id: number) {
      calls.push(`movie:${id}`);
      return data.movies?.find(movie => movie.id === id) ?? null;
    },
  };
};

const episodes = (season: number, names: string[], airDate = '2015-01-01'): TmdbEpisode[] =>
  names.map((name, index) => ({
    id: season * 1000 + index + 1,
    name,
    season_number: season,
    episode_number: index + 1,
    air_date: airDate,
  }));

const show = (id: number, name: string, seasons: number[], firstAirDate = '2015-01-01'): TmdbShowDetails => ({
  id,
  name,
  first_air_date: firstAirDate,
  seasons: seasons.map(n => ({ season_number: n, name: n === 0 ? 'Specials' : `Season ${n}` })),
});

const entry = (fields: Partial<MatchRequestEntry> & { originalTitle: string }): MatchRequestEntry => ({
  key: fields.originalTitle,
  ...fields,
});

test('an episode missing from the season Netflix named is found in another season', async () => {
  const client = fakeClient({
    tv: { Younger: [{ id: 1, name: 'Younger', first_air_date: '2015-03-31' }] },
    shows: [show(1, 'Younger', [1, 2])],
    episodes: {
      '1/1': episodes(1, ['Pilot', 'Liza Sows Her Oats']),
      '1/2': episodes(2, ['Me, Myself & O', 'Secrets & Liza']),
    },
  });

  // "Show: Episode" titles carry no season, so the parser defaults to 1.
  const result = await matchEntry(
    client,
    entry({ originalTitle: 'Younger: Secrets & Liza', groupTitle: 'Younger', seasonNumber: 1, episodeTitle: 'Secrets & Liza' })
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type, 'episode');
  if (result.match?.type === 'episode') {
    assert.equal(result.match.season, 2);
    assert.equal(result.match.number, 2);
  }
});

test('"&" and "and" spellings of an episode title match exactly', async () => {
  const client = fakeClient({
    tv: { Younger: [{ id: 1, name: 'Younger' }] },
    shows: [show(1, 'Younger', [2])],
    episodes: { '1/2': episodes(2, ['No Weddings and a Funeral']) },
  });

  const result = await matchEntry(
    client,
    entry({
      originalTitle: 'Younger: Season 2: No Weddings & a Funeral',
      groupTitle: 'Younger',
      seasonNumber: 2,
      episodeTitle: 'No Weddings & a Funeral',
    })
  );

  assert.equal(result.status, 'matched');
});

test('the episode title picks between two same-name shows', async () => {
  const client = fakeClient({
    // The more popular namesake ranks first but does not have the episode.
    tv: {
      Shooter: [
        { id: 10, name: 'Shooter', first_air_date: '2016-11-15', popularity: 90 },
        { id: 11, name: 'Shooter', first_air_date: '2010-01-01', popularity: 5 },
      ],
    },
    shows: [show(10, 'Shooter', [1], '2016-11-15'), show(11, 'Shooter', [1], '2010-01-01')],
    episodes: {
      '10/1': episodes(1, ['Pilot', 'Exfil']),
      '11/1': episodes(1, ['The Long Shot', 'Crosshairs']),
    },
  });

  const result = await matchEntry(
    client,
    entry({ originalTitle: 'Shooter: Season 1: Crosshairs', groupTitle: 'Shooter', seasonNumber: 1, episodeTitle: 'Crosshairs' })
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type === 'episode' && result.match.showTmdbId, 11);
});

test('a show that premiered after the watch date is never picked', async () => {
  const client = fakeClient({
    tv: {
      Shogun: [
        { id: 20, name: 'Shōgun', first_air_date: '2024-02-27', popularity: 200 },
        { id: 21, name: 'Shōgun', first_air_date: '1980-09-15', popularity: 10 },
      ],
    },
    shows: [show(20, 'Shōgun', [1], '2024-02-27'), show(21, 'Shōgun', [1], '1980-09-15')],
    episodes: {
      '20/1': episodes(1, ['Anjin'], '2024-02-27'),
      '21/1': episodes(1, ['Anjin'], '1980-09-15'),
    },
  });

  const result = await matchEntry(
    client,
    entry({
      originalTitle: 'Shogun: Season 1: Anjin',
      groupTitle: 'Shogun',
      seasonNumber: 1,
      episodeTitle: 'Anjin',
      watchedBefore: '2020-05-01',
    })
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type === 'episode' && result.match.showTmdbId, 21);
});

test('same-title movies resolve to the one released before the watch', async () => {
  const client = fakeClient({
    multi: {
      'The Lion King': [
        { id: 2019, title: 'The Lion King', media_type: 'movie', release_date: '2019-07-12', popularity: 80 },
        { id: 1994, title: 'The Lion King', media_type: 'movie', release_date: '1994-06-24', popularity: 70 },
      ],
    },
    movies: [{ id: 1994, title: 'The Lion King', release_date: '1994-06-24', imdb_id: 'tt0110357' }],
  });

  const result = await matchEntry(client, entry({ originalTitle: 'The Lion King', watchedBefore: '2018-01-01' }));

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type === 'movie' && result.match.tmdbId, 1994);
});

test('same-title movies with similar popularity go to review instead of a guess', async () => {
  const client = fakeClient({
    multi: {
      'The Lion King': [
        { id: 2019, title: 'The Lion King', media_type: 'movie', release_date: '2019-07-12', popularity: 80 },
        { id: 1994, title: 'The Lion King', media_type: 'movie', release_date: '1994-06-24', popularity: 70 },
      ],
    },
  });

  const result = await matchEntry(client, entry({ originalTitle: 'The Lion King', watchedBefore: '2024-01-01' }));

  assert.equal(result.status, 'review');
  assert.deepEqual(
    result.candidates.map(c => c.id),
    ['movie-2019', 'movie-1994']
  );
});

test('non-Latin titles are compared, not flattened to empty strings that all "match"', async () => {
  const client = fakeClient({
    multi: { 'Ведьмак': [{ id: 5, title: 'Другой фильм', media_type: 'movie', release_date: '2001-01-01' }] },
  });

  const result = await matchEntry(client, entry({ originalTitle: 'Ведьмак' }));

  assert.notEqual(result.status, 'matched');
});

test('non-Latin episode titles match the right episode', async () => {
  const client = fakeClient({
    tv: { 'しろくまカフェ': [{ id: 30, name: 'しろくまカフェ' }] },
    shows: [show(30, 'しろくまカフェ', [1])],
    episodes: { '30/1': episodes(1, ['ペンギンさんの恋', 'パンダくんの就職']) },
  });

  const result = await matchEntry(
    client,
    entry({
      originalTitle: 'しろくまカフェ: シーズン1: パンダくんの就職',
      groupTitle: 'しろくまカフェ',
      seasonNumber: 1,
      episodeTitle: 'パンダくんの就職',
    })
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type === 'episode' && result.match.number, 2);
});

test('a localised history matches translated episode names, with English as a fallback', async () => {
  const client = fakeClient({
    tv: { 'Haus des Geldes': [{ id: 40, name: 'Haus des Geldes', original_name: 'La casa de papel' }] },
    shows: [show(40, 'Haus des Geldes', [1])],
    episodes: {
      '40/1/de-DE': episodes(1, ['Episode 1', 'Tödliche Fahrlässigkeit']),
      '40/1': episodes(1, ['Do as Planned', 'Lethal Negligence']),
    },
  });

  const german = await matchEntry(
    client,
    entry({
      originalTitle: 'Haus des Geldes: Teil 1: Tödliche Fahrlässigkeit',
      groupTitle: 'Haus des Geldes',
      seasonNumber: 1,
      episodeTitle: 'Tödliche Fahrlässigkeit',
    }),
    { language: 'de-DE' }
  );
  assert.equal(german.status, 'matched');
  assert.equal(german.match?.type === 'episode' && german.match.number, 2);

  // TMDB had no German name for episode 1; the English one still matches.
  const english = await matchEntry(
    client,
    entry({
      originalTitle: 'Haus des Geldes: Teil 1: Do as Planned',
      groupTitle: 'Haus des Geldes',
      seasonNumber: 1,
      episodeTitle: 'Do as Planned',
    }),
    { language: 'de-DE' }
  );
  assert.equal(english.status, 'matched');
  assert.equal(english.match?.type === 'episode' && english.match.number, 1);
});

test('a show picked by the user skips the show search and never falls back to movies', async () => {
  const client = fakeClient({
    shows: [show(50, 'Fate: The Winx Saga', [1])],
    episodes: { '50/1': episodes(1, ['Destiny Is a Funny Thing', 'Don’t Let Them See Your Fire']) },
  });

  const result = await matchEntry(
    client,
    entry({
      originalTitle: 'Fate: Season 1: Don’t Let Them See Your Fire',
      groupTitle: 'Fate',
      seasonNumber: 1,
      episodeTitle: 'Don’t Let Them See Your Fire',
      showTmdbId: 50,
    })
  );

  assert.equal(result.status, 'matched');
  assert.ok(!client.calls.some(call => call.startsWith('tv:') || call.startsWith('multi:')));
});

test('a long title off by a few letters is accepted when it clearly beats every other episode', async () => {
  const client = fakeClient({
    tv: { Narcos: [{ id: 60, name: 'Narcos' }] },
    shows: [show(60, 'Narcos', [1])],
    episodes: {
      '60/1': episodes(1, ['Descenso', 'The Sword of Simón Bolívar', 'Los Pepes Contra Todos Los Demás Enemigos de la Ciudad']),
    },
  });

  // Four edits — beyond isCloseTitle's three-edit budget, so only the
  // clear-winner fuzzy rule can accept it.
  const result = await matchEntry(
    client,
    entry({
      originalTitle: 'Narcos: Season 1: Los Pepe Contra Todo Los Dema Enemigo de la Ciudad',
      groupTitle: 'Narcos',
      seasonNumber: 1,
      episodeTitle: 'Los Pepe Contra Todo Los Dema Enemigo de la Ciudad',
    })
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type === 'episode' && result.match.number, 3);
});

test('an episode that only exists among the specials is matched there', async () => {
  const client = fakeClient({
    tv: { Sherlock: [{ id: 70, name: 'Sherlock' }] },
    shows: [show(70, 'Sherlock', [0, 1])],
    episodes: {
      '70/0': episodes(0, ['The Abominable Bride']),
      '70/1': episodes(1, ['A Study in Pink']),
    },
  });

  const result = await matchEntry(
    client,
    entry({
      originalTitle: 'Sherlock: The Abominable Bride',
      groupTitle: 'Sherlock',
      seasonNumber: 1,
      episodeTitle: 'The Abominable Bride',
    })
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type === 'episode' && result.match.season, 0);
});

test('a movie title that parses like "Show: Episode" still matches the movie', async () => {
  const client = fakeClient({
    tv: { 'Bad Boys': [{ id: 80, name: 'Bad Boys' }] },
    shows: [show(80, 'Bad Boys', [1])],
    episodes: { '80/1': episodes(1, ['Pilot']) },
    multi: {
      'Bad Boys: Ride or Die': [
        { id: 573435, title: 'Bad Boys: Ride or Die', media_type: 'movie', release_date: '2024-06-05' },
      ],
    },
    movies: [{ id: 573435, title: 'Bad Boys: Ride or Die', release_date: '2024-06-05' }],
  });

  const result = await matchEntry(
    client,
    entry({ originalTitle: 'Bad Boys: Ride or Die', groupTitle: 'Bad Boys', seasonNumber: 1, episodeTitle: 'Ride or Die' })
  );

  assert.equal(result.status, 'matched');
  assert.equal(result.match?.type, 'movie');
});

test('an unmatched episode lists candidates from every show tried, plus whole-show options', async () => {
  const client = fakeClient({
    tv: {
      Suits: [
        { id: 90, name: 'Suits', popularity: 50 },
        { id: 91, name: 'Suits LA', popularity: 10 },
      ],
    },
    shows: [show(90, 'Suits', [1]), show(91, 'Suits LA', [1])],
    episodes: {
      '90/1': episodes(1, ['Pilot', 'Errors and Omissions']),
      '91/1': episodes(1, ['Ted Black', 'Errors']),
    },
  });

  const result = await matchEntry(
    client,
    entry({ originalTitle: 'Suits: Season 1: Something Else Entirely', groupTitle: 'Suits', seasonNumber: 1, episodeTitle: 'Something Else Entirely' })
  );

  assert.equal(result.status, 'review');
  assert.ok(result.candidates.some(c => c.id === 'show-90'));
  assert.ok(result.candidates.some(c => c.id === 'show-91'));
});
