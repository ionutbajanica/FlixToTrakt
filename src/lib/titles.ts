// Title normalisation shared by the Trakt search route and the TMDB-only
// matcher. Netflix titles are localised, punctuated and inconsistent, so
// comparisons happen on a flattened form of the string.

/** Strip trademark/copyright symbols that break API search queries. */
export const normalizeForSearch = (s: string) =>
  s.replace(/[®™©℗℠]/g, '').replace(/\s+/g, ' ').trim();

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
};

const ROMAN_WORDS: Record<string, string> = {
  ix: '9', x: '10', viii: '8', vii: '7', vi: '6', v: '5', iv: '4', iii: '3', ii: '2', i: '1',
};

export const stripArticle = (s: string) => s.replace(/^(the|a|an)\s+/i, '').trim();

const normalizeNumbers = (s: string) => {
  let out = s;
  for (const [word, val] of Object.entries(NUMBER_WORDS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), val);
  }
  for (const [word, val] of Object.entries(ROMAN_WORDS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), val);
  }
  return out;
};

/**
 * Flatten a title for equality checks: lowercase, no leading article,
 * number words as digits, no punctuation, single spaces.
 */
export const normalizeTitle = (s: string) =>
  normalizeNumbers(stripArticle(String(s || '').toLowerCase()))
    // Fold accents so "Ödipussi" and "Odipussi" compare equal.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 0–100 similarity used to rank fuzzy candidates. */
export const titleScore = (candidate: string, target: string): number => {
  const a = normalizeTitle(candidate);
  const b = normalizeTitle(target);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 70;

  const aWords = a.split(' ').filter(Boolean);
  const bWords = new Set(b.split(' ').filter(Boolean));
  if (aWords.length === 0 || bWords.size === 0) return 0;

  const overlap = aWords.filter(w => bWords.has(w)).length;
  return Math.round((overlap / Math.max(aWords.length, bWords.size)) * 60);
};
