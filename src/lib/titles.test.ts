import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCloseTitle,
  normalizeTitle,
  sameNormalized,
  splitNormalizedPart,
  stripPartSuffix,
  titleScore,
  tmdbPartNumber,
} from './titles.ts';

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

test('normalizeTitle keeps letters from every script', () => {
  assert.equal(normalizeTitle('Ведьмак'), 'ведьмак');
  assert.equal(normalizeTitle('しろくまカフェ'), 'しろくまカフェ');
  assert.equal(normalizeTitle('오징어 게임'), '오징어 게임');
  assert.notEqual(normalizeTitle('Ведьмак'), normalizeTitle('Другой'));
});

test('sameNormalized never treats two empty titles as equal', () => {
  assert.equal(sameNormalized(normalizeTitle('!!!'), normalizeTitle('???')), false);
  assert.equal(sameNormalized(normalizeTitle('Dark'), normalizeTitle('DARK')), true);
});

test('"&" and "and" normalize the same', () => {
  assert.equal(normalizeTitle('Love, Death & Robots'), normalizeTitle('Love, Death and Robots'));
  assert.equal(normalizeTitle('No Weddings & a Funeral'), normalizeTitle('No Weddings and a Funeral'));
});

test('apostrophes join words instead of splitting them', () => {
  assert.equal(normalizeTitle('What’s Up, Dock?'), 'whats up dock');
  assert.equal(normalizeTitle("What's Up, Dock?"), normalizeTitle('Whats Up Dock'));
});

test('letters NFD cannot decompose are folded too', () => {
  assert.equal(normalizeTitle('Straße'), normalizeTitle('Strasse'));
  assert.equal(normalizeTitle('Skam: Ødegaard'), normalizeTitle('Skam: Odegaard'));
  assert.equal(normalizeTitle('Łódź'), normalizeTitle('Lodz'));
});

test('accents are folded before roman numerals are read', () => {
  // "vía" must not become "6a".
  assert.equal(normalizeTitle('La vía'), 'via');
});

test('common non-English leading articles are dropped, English look-alikes are not', () => {
  assert.equal(normalizeTitle('La Casa de Papel'), normalizeTitle('Casa de Papel'));
  assert.equal(normalizeTitle("L'Amica geniale"), normalizeTitle('Amica geniale'));
  assert.equal(normalizeTitle('Das Boot'), normalizeTitle('Boot'));
  // "Die" is also an English word — "Die Hard" is not "Hard".
  assert.notEqual(normalizeTitle('Die Hard'), normalizeTitle('Hard'));
});

test('titleScore is 100 only for an exact normalized match', () => {
  assert.equal(titleScore('The Queen’s Gambit', "The Queen's Gambit"), 100);
  assert.ok(titleScore('Queens Gambit Openings', 'The Queen’s Gambit') < 100);
});

test('titleScore ranks a near-identical spelling above a merely related title', () => {
  const target = 'Bienvenidos a Nueva Orleans';
  assert.ok(titleScore('Bienvenidos a Nuevo Orleans', target) > titleScore('Bienvenidos', target));
  assert.ok(titleScore('Bienvenidos', target) > titleScore('Something Else', target));
});

test('titleScore containment needs whole words', () => {
  // "it" is inside "kitten" as letters, not as a word.
  assert.ok(titleScore('It', 'Kitten Heels') < 50);
  assert.ok(titleScore('Glass Onion', 'Glass Onion: A Knives Out Mystery') >= 60);
});
