import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WatchRecord } from './traktExport.ts';
import { buildLetterboxdCsv, buildTraktCsv, buildTraktHistory, summarizeRecords } from './traktExport.ts';

const episode = (season: number, number: number, watchedAt: string): WatchRecord => ({
  media: {
    type: 'episode',
    showTitle: 'Stranger Things',
    showYear: 2016,
    showTmdbId: 66732,
    showImdbId: 'tt4574334',
    showTvdbId: 305288,
    season,
    number,
    episodeTitle: `Chapter ${number}`,
  },
  watchedAt,
});

const movie: WatchRecord = {
  media: { type: 'movie', title: 'The Irishman', year: 2019, tmdbId: 398978, imdbId: 'tt1302006' },
  watchedAt: '2023-01-13T12:00:00.000Z',
};

test('episodes nest under one show entry, sorted by season and number', () => {
  const history = buildTraktHistory([
    episode(2, 3, '2024-08-01T12:00:00.000Z'),
    episode(1, 2, '2024-07-25T12:00:00.000Z'),
    episode(1, 1, '2024-07-25T12:00:00.000Z'),
    movie,
  ]);

  assert.equal(history.shows?.length, 1);
  assert.deepEqual(history.shows?.[0].ids, { tmdb: 66732, imdb: 'tt4574334', tvdb: 305288 });
  assert.deepEqual(
    history.shows?.[0].seasons?.map(season => [season.number, season.episodes.map(e => e.number)]),
    [[1, [1, 2]], [2, [3]]]
  );
  assert.equal(history.movies?.length, 1);
  assert.equal(history.movies?.[0].watched_at, '2023-01-13T12:00:00.000Z');
});

test('a rewatch keeps both plays', () => {
  const history = buildTraktHistory([
    episode(1, 1, '2024-07-25T12:00:00.000Z'),
    episode(1, 1, '2024-08-02T12:00:00.000Z'),
  ]);

  assert.deepEqual(
    history.shows?.[0].seasons?.[0].episodes.map(e => e.watched_at),
    ['2024-07-25T12:00:00.000Z', '2024-08-02T12:00:00.000Z']
  );
});

test('a whole-show entry carries watched_at instead of seasons', () => {
  const history = buildTraktHistory([
    { media: { type: 'show', title: 'Dark', year: 2017, tmdbId: 70523 }, watchedAt: '2024-02-01T12:00:00.000Z' },
  ]);

  assert.equal(history.shows?.[0].watched_at, '2024-02-01T12:00:00.000Z');
  assert.equal(history.shows?.[0].seasons, undefined);
  assert.equal(history.movies, undefined);
});

test('CSV writes one row per watch and quotes commas', () => {
  const csv = buildTraktCsv([
    movie,
    {
      media: {
        type: 'episode', showTitle: 'Show, With Comma', showTmdbId: 1, season: 1, number: 1,
        episodeTitle: 'Pilot',
      },
      watchedAt: '2024-01-01T12:00:00.000Z',
    },
  ]);

  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'watched_at,type,title,year,imdb_id,tmdb_id,tvdb_id,season_number,episode_number,episode_title,episode_tmdb_id');
  assert.equal(lines.length, 3);
  assert.ok(lines[2].includes('"Show, With Comma"'));
});

test('Letterboxd export covers movies only and flags rewatches', () => {
  const csv = buildLetterboxdCsv([movie, { ...movie, watchedAt: '2024-05-05T12:00:00.000Z' }, episode(1, 1, '2024-07-25T12:00:00.000Z')]);
  const lines = csv.trim().split('\r\n');

  assert.equal(lines.length, 3);
  assert.equal(lines[1], '2023-01-13,The Irishman,2019,,,,,2023-01-13');
  assert.equal(lines[2], '2024-05-05,The Irishman,2019,,,Yes,,2024-05-05');
});

test('summary counts each kind of play', () => {
  const summary = summarizeRecords([movie, episode(1, 1, '2024-07-25T12:00:00.000Z')]);
  assert.deepEqual(summary, { movies: 1, episodes: 1, shows: 0, total: 2 });
});
