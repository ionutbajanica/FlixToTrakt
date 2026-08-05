import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectDateOrder,
  parseNetflixRows,
  parseNetflixTitle,
  toWatchedAtIso,
  wordToSeasonNumber,
} from './netflix.ts';

test('season labels resolve from digits, words and roman numerals', () => {
  assert.equal(wordToSeasonNumber('Season 4'), 4);
  assert.equal(wordToSeasonNumber('Season One'), 1);
  assert.equal(wordToSeasonNumber('Chapter III'), 3);
  assert.equal(wordToSeasonNumber('Enter The Cyber Game'), undefined);
});

test('an episode title containing a colon stays with the episode', () => {
  const parsed = parseNetflixTitle('Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers');
  assert.equal(parsed.groupTitle, 'Stranger Things');
  assert.equal(parsed.seasonNumber, 1);
  assert.equal(parsed.episodeTitle, 'Chapter One: The Vanishing of Will Byers');
});

test('localized season labels are recognised', () => {
  const parsed = parseNetflixTitle('La Casa de Papel: Parte 3: Episodio 2');
  assert.equal(parsed.groupTitle, 'La Casa de Papel');
  assert.equal(parsed.seasonNumber, 3);
  assert.equal(parsed.episodeTitle, 'Episodio 2');
});

test('named seasons are kept for later TMDB resolution', () => {
  const parsed = parseNetflixTitle('LEGO Ninjago: Enter The Cyber Game: The Dragon Master');
  assert.equal(parsed.groupTitle, 'LEGO Ninjago');
  assert.equal(parsed.seasonNumber, undefined);
  assert.equal(parsed.seasonName, 'Enter The Cyber Game');
  assert.equal(parsed.episodeTitle, 'The Dragon Master');
});

test('movies stay unparsed', () => {
  const parsed = parseNetflixTitle('The Irishman');
  assert.equal(parsed.groupTitle, undefined);
  assert.equal(parsed.episodeTitle, undefined);
});

test('date order is detected from an unambiguous row', () => {
  assert.equal(detectDateOrder(['03/04/2024', '25/07/2024']), 'dmy');
  assert.equal(detectDateOrder(['03/04/2024', '07/25/2024']), 'mdy');
  assert.equal(detectDateOrder(['03/04/2024']), null);
});

test('watch dates become midday UTC timestamps', () => {
  assert.equal(toWatchedAtIso('25/07/2024', 'dmy'), '2024-07-25T12:00:00.000Z');
  assert.equal(toWatchedAtIso('7/4/24', 'mdy'), '2024-07-04T12:00:00.000Z');
  assert.equal(toWatchedAtIso('2024-07-25', 'mdy'), '2024-07-25T12:00:00.000Z');
  assert.equal(toWatchedAtIso('not a date', 'dmy'), null);
});

test('rows collapse per title, newest first, and double episodes split', () => {
  const entries = parseNetflixRows(
    [
      ['Title', 'Date'],
      ['Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers', '25/07/2024'],
      ['Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers', '02/08/2024'],
      ['Some Show: Limited Series: The Third/The Debt', '03/03/2024'],
      ['', ''],
    ],
    'dmy'
  );

  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0].dates, ['02/08/2024', '25/07/2024']);
  assert.deepEqual(
    entries.filter(e => e.groupTitle === 'Some Show').map(e => e.episodeTitle),
    ['The Third', 'The Debt']
  );
});
