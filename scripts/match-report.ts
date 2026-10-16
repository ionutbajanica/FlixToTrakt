// Match a whole Netflix viewing history against live TMDB and report how it
// went — the end-to-end check for matcher changes.
//
//   TMDB_TOKEN=<read access token> npm run match-report -- NetflixViewingHistory.csv [options]
//
// Options:
//   --language <code>  TMDB language of the history (default: detected, else en-US)
//   --out <file>       also write every result as JSON (personal data — keep it out of git)
//   --lib <dir>        load the matcher from another checkout's src/lib, to compare versions

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Papa from 'papaparse';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const csvPath = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
const token = process.env.TMDB_TOKEN;

if (!csvPath || !token) {
  console.error('Usage: TMDB_TOKEN=<token> npm run match-report -- <NetflixViewingHistory.csv> [--language xx-XX] [--out file.json] [--lib dir]');
  process.exit(1);
}

const libDir = resolve(flag('lib') ?? 'src/lib');
const load = (name: string) => import(pathToFileURL(resolve(libDir, `${name}.ts`)).href);
const netflix = await load('netflix');
const { TmdbClient } = await load('tmdb');
const { matchEntry } = await load('tmdbMatch');

const rows = Papa.parse<string[]>(readFileSync(csvPath, 'utf8'), { skipEmptyLines: true }).data;
const order = netflix.detectDateOrder(rows.slice(1).map((row: string[]) => (row[1] || '').trim())) ?? 'mdy';
const detectedLanguage = netflix.detectHistoryLanguage?.(rows.slice(1).map((row: string[]) => (row[0] || '').trim()));
const language = flag('language') ?? detectedLanguage ?? 'en-US';
const entries = netflix.parseNetflixRows(rows, order);

console.log(`${entries.length} titles from ${rows.length - 1} rows · dates ${order} · language ${language} · matcher ${libDir}`);

const client = new TmdbClient(token);
const results: { title: string; status: string; label?: string; note?: string; candidates: string[] }[] = [];
const started = Date.now();
const BATCH = 20;

for (let start = 0; start < entries.length; start += BATCH) {
  const batch = entries.slice(start, start + BATCH);
  const matched = await Promise.all(
    batch.map((entry: { key: string; originalTitle: string; dates: string[] }) =>
      matchEntry(
        client,
        { ...entry, watchedBefore: netflix.earliestWatchDate?.(entry.dates, order) },
        { language }
      )
    )
  );
  matched.forEach((result: { status: string; match?: Record<string, unknown>; note?: string; candidates: { label: string }[] }, i: number) => {
    results.push({
      title: batch[i].originalTitle,
      status: result.status,
      label: result.match ? describe(result.match) : undefined,
      note: result.note,
      candidates: result.candidates.map(c => c.label),
    });
  });
  process.stdout.write(`\r${Math.min(start + BATCH, entries.length)}/${entries.length}`);
}

function describe(media: Record<string, unknown>): string {
  if (media.type === 'episode') return `${media.showTitle} S${media.season}E${media.number} ${media.episodeTitle ?? ''}`.trim();
  return `${media.title} (${media.year ?? '?'}) [${media.type}]`;
}

const count = (status: string) => results.filter(r => r.status === status).length;
const pct = (n: number) => `${((100 * n) / results.length).toFixed(1)}%`;
console.log(`\n\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`matched ${count('matched')} (${pct(count('matched'))}) · review ${count('review')} (${pct(count('review'))}) · none ${count('none')} (${pct(count('none'))})`);

const outPath = flag('out');
if (outPath) {
  writeFileSync(outPath, JSON.stringify({ language, order, results }, null, 2));
  console.log(`Full results written to ${outPath}`);
}
