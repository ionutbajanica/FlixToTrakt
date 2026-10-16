// Runs the parser over a real NetflixViewingHistory*.csv when one sits in the
// project root. Viewing histories are personal data and *.csv is gitignored,
// so this skips itself everywhere else; it asserts only on structure, never
// on specific titles.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import Papa from 'papaparse';
import {
  detectDateOrder,
  detectHistoryLanguage,
  earliestWatchDate,
  parseNetflixRows,
} from './netflix.ts';

const root = join(import.meta.dirname, '..', '..');
const historyFiles = existsSync(root)
  ? readdirSync(root).filter(name => /^NetflixViewingHistory.*\.csv$/i.test(name))
  : [];

if (historyFiles.length === 0) {
  test('real Netflix history (no NetflixViewingHistory*.csv in the project root)', { skip: true }, () => {});
}

for (const file of historyFiles) {
  const rows = Papa.parse<string[]>(readFileSync(join(root, file), 'utf8'), { skipEmptyLines: true }).data;
  const titles = rows.slice(1).map(row => (row[0] || '').trim());
  const order = detectDateOrder(rows.slice(1).map(row => (row[1] || '').trim())) ?? 'mdy';
  const entries = parseNetflixRows(rows, order);

  test(`${file}: every row is accounted for`, () => {
    const watches = entries.reduce((sum, entry) => sum + entry.dates.length, 0);
    // Rows split into several episodes ("A/B") count once per part.
    const splitExtra = entries.filter(e => e.key.endsWith('|||split1')).reduce((sum, e) => sum + e.dates.length, 0);
    assert.ok(entries.length > 0);
    assert.ok(watches >= titles.length - 1, `${watches} watches for ${titles.length} rows`);
    assert.ok(watches - splitExtra <= titles.length * 3, 'split parts should not multiply rows unboundedly');
  });

  test(`${file}: every watch date parses`, () => {
    const unparsed = entries.filter(entry => earliestWatchDate(entry.dates, order) === undefined);
    assert.deepEqual(unparsed.map(e => e.originalTitle), []);
  });

  test(`${file}: titles with a colon are split into show and episode`, () => {
    const unsplit = entries.filter(
      entry => entry.originalTitle.includes(': ') && (!entry.groupTitle || !entry.episodeTitle)
    );
    assert.deepEqual(unsplit.map(e => e.originalTitle), []);
  });

  test(`${file}: no episode title is empty, or a part marker cut off a guessed season name`, () => {
    // "Chapter Three" is a real episode title (Jane the Virgin); only a part
    // marker left behind next to a guessed season name is a parse error.
    const bad = entries.filter(
      entry =>
        entry.episodeTitle !== undefined &&
        (entry.episodeTitle.trim() === '' ||
          (entry.seasonName !== undefined && /^(?:part|chapter)\s+\S+$/i.test(entry.episodeTitle)))
    );
    assert.deepEqual(bad.map(e => e.originalTitle), []);
  });

  test(`${file}: the history language is detected`, () => {
    const hasSeasonLabels = titles.some(title => /^.+?:\s+\S+\s+\d{1,2}:/.test(title));
    if (hasSeasonLabels) assert.notEqual(detectHistoryLanguage(titles), null);
  });
}
