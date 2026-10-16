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

/**
 * Leading articles, so "The Crown" and "Crown" compare equal. English plus the
 * common Romance/German ones for localised histories — but not words that are
 * also ordinary English ("Die", "I", "O"), which would eat real title words.
 */
export const stripArticle = (s: string) =>
  s.replace(/^(?:(?:the|a|an|el|la|los|las|le|les|il|lo|gli|der|das)\s+|l['’]\s*)/i, '').trim();

/**
 * TMDB numbers multi-part episodes as "Hurt (1)", "Hurt (2)", while Netflix's
 * viewing history either repeats the bare title ("Hurt") for every part, or
 * spells the part out itself ("No More Part I"). stripPartSuffix/tmdbPartNumber
 * read the TMDB side; splitNormalizedPart (below) reads the Netflix side.
 */
const TMDB_PART_SUFFIX = /\s*\((\d{1,2})\)\s*$/;
export const stripPartSuffix = (s: string) => s.replace(TMDB_PART_SUFFIX, '').trim();
export const tmdbPartNumber = (s: string): number | undefined => {
  const m = s.match(TMDB_PART_SUFFIX);
  return m ? parseInt(m[1], 10) : undefined;
};

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

/** Letters NFD does not decompose, so the accent fold below misses them. */
const LETTER_FOLDS: Record<string, string> = {
  'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i',
};

/**
 * Flatten a title for equality checks: lowercase, no leading article,
 * "&" as "and", no apostrophes, accents folded, number words as digits, no
 * punctuation, single spaces.
 *
 * Letters from every script survive — a Korean or Cyrillic title must not
 * flatten to an empty string, or every such title would "equal" every other.
 * Equality checks should still go through sameNormalized().
 */
export const normalizeTitle = (s: string) =>
  normalizeNumbers(
    stripArticle(String(s || '').toLowerCase().replace(/&/g, ' and '))
      // "What’s" and "Whats" are one word; turning the apostrophe into a
      // space would split it in two.
      .replace(/['’‘`´]/g, '')
      .replace(/[ßøæœłđðþı]/g, c => LETTER_FOLDS[c])
      // Fold accents so "Ödipussi" and "Odipussi" compare equal. This runs
      // before the number pass, which would otherwise read "vía" as roman six.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC')
  )
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Equality on already-normalized titles; two empty strings never match. */
export const sameNormalized = (a: string, b: string) => a !== '' && a === b;

/**
 * Split a trailing "part 1" / "part 2" off an already-normalized title
 * (normalizeTitle folds "Part I" and "Part One" to "part 1" already, so this
 * just has to recognise the digit form). Used to line up Netflix's
 * "No More Part I" against TMDB's "No More (1)".
 */
const NORMALIZED_PART_SUFFIX = /\s+part\s+(\d{1,2})$/;
export const splitNormalizedPart = (normalized: string): { base: string; part?: number } => {
  const m = normalized.match(NORMALIZED_PART_SUFFIX);
  if (!m || m.index === undefined) return { base: normalized };
  return { base: normalized.slice(0, m.index).trim(), part: parseInt(m[1], 10) };
};

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], row[j - 1])
      );
    }
    prev = row;
  }
  return prev[b.length];
};

/**
 * True when two already-normalized titles are the same aside from small
 * spelling drift — e.g. TMDB listing "Bienvenidos a Nuevo Orleans" against
 * Netflix's "Bienvenidos a Nueva Orleans" (one letter, gender agreement).
 *
 * Gated on length: below 8 characters a single-letter edit can turn one word
 * into a different one ("Run" vs "Sun"), so short titles must match exactly.
 * Longer titles get a proportional budget, capped at 3 edits.
 */
export const isCloseTitle = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const longer = Math.max(a.length, b.length);
  if (longer < 8) return false;
  const distance = levenshtein(a, b);
  return distance <= Math.min(3, Math.floor(longer * 0.12));
};

/**
 * 0–100 similarity used to rank fuzzy candidates; 100 only for an exact
 * normalized match. Takes the best of three views of the pair:
 *  - character similarity (edit distance), for spelling drift;
 *  - word-set overlap, for reordered or partly shared words;
 *  - whole-word containment ("Glass Onion" inside "Glass Onion A Knives Out
 *    Mystery"), scaled by how much of the longer title it covers.
 */
export const titleScore = (candidate: string, target: string): number => {
  const a = normalizeTitle(candidate);
  const b = normalizeTitle(target);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const longer = Math.max(a.length, b.length);
  const shorter = Math.min(a.length, b.length);
  const charSimilarity = 1 - levenshtein(a, b) / longer;

  const aWords = new Set(a.split(' '));
  const bWords = new Set(b.split(' '));
  const shared = [...aWords].filter(w => bWords.has(w)).length;
  const wordOverlap = (2 * shared) / (aWords.size + bWords.size);

  const contained = ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
  const containment = contained ? 55 + 35 * (shorter / longer) : 0;

  return Math.min(99, Math.round(Math.max(charSimilarity * 95, wordOverlap * 90, containment)));
};
