import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCloseTitle, normalizeTitle, splitNormalizedPart, stripPartSuffix, tmdbPartNumber } from './titles.ts';

test('stripPartSuffix drops a trailing TMDB part number', () => {
  assert.equal(stripPartSuffix('Hurt (1)'), 'Hurt');
  assert.equal(stripPartSuffix('Hurt (12)'), 'Hurt');
  assert.equal(stripPartSuffix('Hurt'), 'Hurt');
  // Not a part-number suffix — leave titles with real parenthetical content alone.
  assert.equal(stripPartSuffix('Hurt (Part Two)'), 'Hurt (Part Two)');
});

test('a TMDB multi-part episode name normalizes to match the bare Netflix title', () => {
  assert.equal(normalizeTitle(stripPartSuffix('Hurt (1)')), normalizeTitle('Hurt'));
});

test('tmdbPartNumber reads the "(N)" TMDB suffix', () => {
  assert.equal(tmdbPartNumber('No More (1)'), 1);
  assert.equal(tmdbPartNumber('No More (12)'), 12);
  assert.equal(tmdbPartNumber('No More'), undefined);
});

test('splitNormalizedPart pulls a spelled-out part number off a normalized title', () => {
  // "No More Part I" normalizes (roman numerals folded to digits) before this runs.
  assert.deepEqual(splitNormalizedPart(normalizeTitle('No More Part I')), { base: 'no more', part: 1 });
  assert.deepEqual(splitNormalizedPart(normalizeTitle('No More Part One')), { base: 'no more', part: 1 });
  assert.deepEqual(splitNormalizedPart(normalizeTitle('No More')), { base: 'no more' });
});

test('Netflix "Title Part I" and TMDB "Title (1)" resolve to the same base and part', () => {
  const netflix = splitNormalizedPart(normalizeTitle('No More Part I'));
  assert.equal(netflix.base, normalizeTitle(stripPartSuffix('No More (1)')));
  assert.equal(netflix.part, tmdbPartNumber('No More (1)'));
});

test('a recombined "No Cure: Part II" episode title resolves against TMDB\'s "No Cure (2)"', () => {
  const netflix = splitNormalizedPart(normalizeTitle('No Cure: Part II'));
  assert.equal(netflix.base, normalizeTitle(stripPartSuffix('No Cure (2)')));
  assert.equal(netflix.part, tmdbPartNumber('No Cure (2)'));
});

test('isCloseTitle accepts small localisation drift on long titles', () => {
  // "Nuevo Orleans" vs "Nueva Orleans" — one letter, gender agreement.
  assert.equal(
    isCloseTitle(normalizeTitle('Bienvenidos a Nueva Orleans'), normalizeTitle('Bienvenidos a Nuevo Orleans')),
    true
  );
});

test('isCloseTitle refuses to blur short titles into different words', () => {
  assert.equal(isCloseTitle(normalizeTitle('Run'), normalizeTitle('Sun')), false);
  assert.equal(isCloseTitle(normalizeTitle('Hurt'), normalizeTitle('Hurl')), false);
});

test('isCloseTitle still rejects long titles that just happen to share a lot of letters', () => {
  assert.equal(isCloseTitle(normalizeTitle('The Long Way Home'), normalizeTitle('The Long Way Down')), false);
});
