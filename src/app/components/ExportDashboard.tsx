'use client';

import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DateOrder,
  HISTORY_LANGUAGES,
  NetflixEntry,
  detectDateOrder,
  detectHistoryLanguage,
  earliestWatchDate,
  parseNetflixRows,
  parseWatchedDate,
  toWatchedAtIso,
} from '@/lib/netflix';
import type { MatchCandidate, MatchRequestEntry, MatchResult } from '@/lib/tmdbMatch';
import {
  MediaMatch,
  WatchRecord,
  buildLetterboxdCsv,
  buildTraktCsv,
  buildTraktJson,
  describeMatch,
  summarizeRecords,
} from '@/lib/traktExport';

type ItemStatus = 'pending' | 'matched' | 'review' | 'none' | 'skipped';

interface ItemState {
  status: ItemStatus;
  match?: MediaMatch;
  candidates: MatchCandidate[];
  note?: string;
}

const BATCH_SIZE = 20;

const download = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const candidateKey = (media: MediaMatch): string => {
  if (media.type === 'movie') return `movie-${media.tmdbId}`;
  if (media.type === 'show') return `show-${media.tmdbId}`;
  return `episode-${media.showTmdbId}-${media.season}-${media.number}`;
};

export default function ExportDashboard() {
  const [entries, setEntries] = useState<NetflixEntry[]>([]);
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>('mdy');
  const [dateOrderDetected, setDateOrderDetected] = useState(false);
  const [language, setLanguage] = useState('en-US');
  const [languageDetected, setLanguageDetected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState<Record<string, string>>({});
  const [manualResults, setManualResults] = useState<Record<string, MatchCandidate[]>>({});
  const [manualLoading, setManualLoading] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobIdRef = useRef(0);

  const setState = (key: string, next: Partial<ItemState>) => {
    setStates(prev => ({ ...prev, [key]: { ...(prev[key] || { status: 'pending', candidates: [] }), ...next } }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: results => {
        const rows = results.data;
        if (rows.length < 2) {
          alert('Could not find any valid rows in the CSV file.');
          return;
        }

        const detected = detectDateOrder(rows.slice(1).map(row => (row[1] || '').trim()));
        const order = detected ?? dateOrder;
        const parsed = parseNetflixRows(rows, order);

        if (parsed.length === 0) {
          alert('Parsed file but found no valid titles. Please ensure the CSV has Title in the first column.');
          return;
        }

        const detectedLanguage = detectHistoryLanguage(rows.slice(1).map(row => (row[0] || '').trim()));

        jobIdRef.current += 1;
        setDateOrder(order);
        setDateOrderDetected(detected !== null);
        if (detectedLanguage) setLanguage(detectedLanguage);
        setLanguageDetected(detectedLanguage !== null);
        setEntries(parsed);
        setStates(
          Object.fromEntries(parsed.map(entry => [entry.key, { status: 'pending' as ItemStatus, candidates: [] }]))
        );
      },
    });
  };

  const changeDateOrder = (order: DateOrder) => {
    setDateOrder(order);
    setDateOrderDetected(false);
    // Re-sorting is not worth a re-parse; only the emitted timestamps change.
  };

  const toRequestEntry = (entry: NetflixEntry, showTmdbId?: number): MatchRequestEntry => ({
    key: entry.key,
    originalTitle: entry.originalTitle,
    groupTitle: entry.groupTitle,
    seasonNumber: entry.seasonNumber,
    seasonName: entry.seasonName,
    episodeTitle: entry.episodeTitle,
    // Lets the matcher rule out anything released after the first watch.
    watchedBefore: earliestWatchDate(entry.dates, dateOrder),
    showTmdbId,
  });

  /** POST a batch to the matcher; 'unauthorized' when the TMDB token was rejected. */
  const requestMatches = async (
    batch: NetflixEntry[],
    showTmdbId?: number
  ): Promise<MatchResult[] | 'unauthorized'> => {
    const res = await fetch('/api/tmdb/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, entries: batch.map(entry => toRequestEntry(entry, showTmdbId)) }),
    });
    if (res.status === 401) return 'unauthorized';
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { results: MatchResult[] } = await res.json();
    return data.results || [];
  };

  const applyResults = (results: MatchResult[]) => {
    setStates(prev => {
      const next = { ...prev };
      for (const result of results) {
        next[result.key] = {
          status: result.status,
          match: result.match,
          candidates: result.candidates || [],
          note: result.note,
        };
      }
      return next;
    });
  };

  const runMatching = async () => {
    setIsProcessing(true);
    jobIdRef.current += 1;
    const jobId = jobIdRef.current;

    const pending = entries.filter(entry => (states[entry.key]?.status ?? 'pending') === 'pending');
    const totalBatches = Math.ceil(pending.length / BATCH_SIZE);

    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      if (jobIdRef.current !== jobId) return;

      const batch = pending.slice(start, start + BATCH_SIZE);
      setStatusText(`Matching batch ${Math.floor(start / BATCH_SIZE) + 1} of ${totalBatches} against TMDB...`);

      try {
        const results = await requestMatches(batch);

        if (jobIdRef.current !== jobId) return;

        if (results === 'unauthorized') {
          alert('TMDB token missing or rejected. Re-enter it in setup.');
          break;
        }

        applyResults(results);
      } catch {
        setStates(prev => {
          const next = { ...prev };
          for (const entry of batch) {
            next[entry.key] = { status: 'none', candidates: [], note: 'Lookup failed — try again.' };
          }
          return next;
        });
      }
    }

    if (jobIdRef.current === jobId) {
      setStatusText(null);
      setIsProcessing(false);
    }
  };

  const selectCandidate = (key: string, candidate: MatchCandidate) => {
    setState(key, { status: 'matched', match: candidate.media });
  };

  const skipItem = (key: string) => setState(key, { status: 'skipped', match: undefined });

  const resetItem = (key: string) => setState(key, { status: 'review', match: undefined });

  const manualSearch = async (key: string, query: string) => {
    if (!query.trim()) return;
    setManualLoading(prev => ({ ...prev, [key]: true }));

    try {
      const res = await fetch('/api/tmdb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, language }),
      });
      if (res.ok) {
        const data: { candidates: MatchCandidate[] } = await res.json();
        setManualResults(prev => ({ ...prev, [key]: data.candidates || [] }));
      }
    } catch {
      // Leave the previous results in place on a network hiccup.
    }

    setManualLoading(prev => ({ ...prev, [key]: false }));
  };

  const browseEpisodes = async (entry: NetflixEntry, showTmdbId: number) => {
    setManualLoading(prev => ({ ...prev, [entry.key]: true }));

    try {
      const res = await fetch('/api/tmdb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showTmdbId,
          seasonNumber: entry.seasonNumber,
          episodeTitle: entry.episodeTitle,
          language,
        }),
      });
      if (res.ok) {
        const data: { candidates: MatchCandidate[] } = await res.json();
        setManualResults(prev => ({ ...prev, [entry.key]: data.candidates || [] }));
      }
    } catch {
      // Same as above — non-fatal.
    }

    setManualLoading(prev => ({ ...prev, [entry.key]: false }));
  };

  /** Mark a whole show watched with one entry and drop its sibling episodes. */
  const matchEntireShow = (groupEntries: NetflixEntry[], media: MediaMatch) => {
    setStates(prev => {
      const next = { ...prev };
      groupEntries.forEach((entry, index) => {
        next[entry.key] =
          index === 0
            ? { status: 'matched', match: media, candidates: prev[entry.key]?.candidates || [] }
            : { status: 'skipped', candidates: [] };
      });
      return next;
    });
  };

  /**
   * The user has told us which show a review group belongs to: re-run episode
   * matching for every entry in the group against that show only.
   */
  const rematchGroup = async (groupEntries: NetflixEntry[], showTmdbId: number, showLabel: string) => {
    setIsProcessing(true);
    jobIdRef.current += 1;
    const jobId = jobIdRef.current;

    for (let start = 0; start < groupEntries.length; start += BATCH_SIZE) {
      if (jobIdRef.current !== jobId) return;
      setStatusText(`Re-matching ${groupEntries.length} episodes against ${showLabel}...`);

      try {
        const results = await requestMatches(groupEntries.slice(start, start + BATCH_SIZE), showTmdbId);
        if (jobIdRef.current !== jobId) return;
        if (results === 'unauthorized') {
          alert('TMDB token missing or rejected. Re-enter it in setup.');
          break;
        }
        applyResults(results);
      } catch {
        // Leave the batch as it was; the user can retry from the group card.
      }
    }

    if (jobIdRef.current === jobId) {
      setStatusText(null);
      setIsProcessing(false);
    }
  };

  const skipGroup = (groupEntries: NetflixEntry[]) => {
    setStates(prev => {
      const next = { ...prev };
      groupEntries.forEach(entry => {
        next[entry.key] = { status: 'skipped', candidates: [] };
      });
      return next;
    });
  };

  // ── Export ───────────────────────────────────────────────────────────────

  const records: WatchRecord[] = useMemo(() => {
    const out: WatchRecord[] = [];
    const seen = new Set<string>();
    const showsEmitted = new Set<number>();

    for (const entry of entries) {
      const state = states[entry.key];
      if (!state?.match || state.status !== 'matched') continue;
      const media = state.match;

      for (const date of entry.dates) {
        const watchedAt = toWatchedAtIso(date, dateOrder);
        if (!watchedAt) continue;

        // A whole-show entry already covers every episode; one is enough.
        if (media.type === 'show') {
          if (showsEmitted.has(media.tmdbId)) continue;
          showsEmitted.add(media.tmdbId);
        }

        const dedupeKey = `${candidateKey(media)}|${watchedAt}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        out.push({ media, watchedAt });
      }
    }

    return out;
  }, [entries, states, dateOrder]);

  const summary = summarizeRecords(records);

  const counts = useMemo(() => {
    let matched = 0;
    let review = 0;
    let skipped = 0;
    let pending = 0;
    for (const entry of entries) {
      const status = states[entry.key]?.status ?? 'pending';
      if (status === 'matched') matched++;
      else if (status === 'review' || status === 'none') review++;
      else if (status === 'skipped') skipped++;
      else pending++;
    }
    return { matched, review, skipped, pending };
  }, [entries, states]);

  const downloadUnmatched = () => {
    const rows = entries
      .filter(entry => {
        const status = states[entry.key]?.status ?? 'pending';
        return status !== 'matched';
      })
      .map(entry => [entry.originalTitle, entry.dates.join(' | '), states[entry.key]?.note || '']);

    const csv = [['title', 'dates', 'note'], ...rows]
      .map(row => row.map(cell => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
      .join('\r\n');

    download('flixtotrakt-unmatched.csv', csv, 'text/csv');
  };

  // ── Rendering ────────────────────────────────────────────────────────────

  const watchedTime = (entry: NetflixEntry): number | null => {
    const parsed = parseWatchedDate(entry.dates[0] || '', dateOrder);
    if (!parsed) return null;
    return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  };

  /** Hide suggestions that only came out after the user watched the title. */
  const plausibleCandidates = (entry: NetflixEntry, candidates: MatchCandidate[]) => {
    const watched = watchedTime(entry);
    if (watched === null) return candidates;

    return candidates.filter(candidate => {
      if (!candidate.releaseDate) return true;
      const released = Date.parse(candidate.releaseDate);
      if (Number.isNaN(released)) return true;
      return released - 2 * 24 * 60 * 60 * 1000 <= watched;
    });
  };

  const renderCandidateRow = (entry: NetflixEntry, candidate: MatchCandidate) => {
    const state = states[entry.key];
    const selected = state?.match ? candidateKey(state.match) === candidate.id : false;
    const tmdbUrl =
      candidate.media.type === 'movie'
        ? `https://www.themoviedb.org/movie/${candidate.media.tmdbId}`
        : candidate.media.type === 'show'
          ? `https://www.themoviedb.org/tv/${candidate.media.tmdbId}`
          : `https://www.themoviedb.org/tv/${candidate.media.showTmdbId}/season/${candidate.media.season}/episode/${candidate.media.number}`;

    return (
      <div key={candidate.id} className="match-option-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input type="checkbox" checked={selected} onChange={() => selectCandidate(entry.key, candidate)} />
        <span>{candidate.label}</span>
        <a href={tmdbUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--primary)', textDecoration: 'underline' }}>
          [View on TMDB]
        </a>
      </div>
    );
  };

  const renderManualSearch = (entry: NetflixEntry) => {
    const showId = entry.groupTitle
      ? states[entry.key]?.candidates.find(c => c.media.type === 'episode' || c.media.type === 'show')?.media
      : undefined;
    const showTmdbId =
      showId?.type === 'episode' ? showId.showTmdbId : showId?.type === 'show' ? showId.tmdbId : undefined;

    return (
      <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--bg-accent)' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Search TMDB manually:</p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Type a show or movie name..."
            value={manualQuery[entry.key] || ''}
            onChange={e => setManualQuery(prev => ({ ...prev, [entry.key]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') manualSearch(entry.key, manualQuery[entry.key] || ''); }}
            style={{ flex: 1, marginBottom: 0, padding: '8px 12px', fontSize: '0.9rem' }}
          />
          <button
            onClick={() => manualSearch(entry.key, manualQuery[entry.key] || '')}
            disabled={manualLoading[entry.key] || !(manualQuery[entry.key] || '').trim()}
            style={{ padding: '8px 16px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
          >
            {manualLoading[entry.key] ? '...' : '🔍 Search'}
          </button>
          {showTmdbId && (
            <button
              onClick={() => browseEpisodes(entry, showTmdbId)}
              disabled={manualLoading[entry.key]}
              style={{ padding: '8px 16px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
            >
              📺 Episodes
            </button>
          )}
        </div>
        {manualResults[entry.key] && manualResults[entry.key].length > 0 && (
          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '320px', overflowY: 'auto' }}>
            {manualResults[entry.key].map(candidate => renderCandidateRow(entry, candidate))}
          </div>
        )}
        {manualResults[entry.key] && manualResults[entry.key].length === 0 && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>No results found.</p>
        )}
      </div>
    );
  };

  const renderItemCard = (entry: NetflixEntry) => {
    const state = states[entry.key] || { status: 'pending' as ItemStatus, candidates: [] };
    const badge =
      state.status === 'matched' ? 'success' : state.status === 'review' || state.status === 'none' ? 'warning' : 'info';

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2 }}
        key={entry.key}
        className={`card title-item ${state.status}`}
        style={{ marginBottom: '1rem' }}
      >
        <div className="title-item-header">
          <div>
            <strong>{entry.originalTitle}</strong>
            <span style={{ marginLeft: '1rem', color: 'var(--text-secondary)' }}>
              {entry.dates.length > 1 ? `${entry.dates.length} views (latest: ${entry.dates[0]})` : entry.dates[0]}
            </span>
          </div>
          <div className={`badge badge-${badge}`}>{state.status}</div>
        </div>

        {state.match && (
          <p style={{ marginTop: '0.5rem', color: 'var(--success)' }}>
            → {describeMatch(state.match)}
            <button
              onClick={() => resetItem(entry.key)}
              style={{ marginLeft: '0.75rem', padding: '2px 8px', fontSize: '0.75rem' }}
            >
              change
            </button>
          </p>
        )}

        {(state.status === 'review' || state.status === 'none') && (
          <div className="match-options">
            {state.note && <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{state.note}</p>}
            {plausibleCandidates(entry, state.candidates).map(candidate => renderCandidateRow(entry, candidate))}
            <div className="match-option-row">
              <button style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => skipItem(entry.key)}>
                Leave out of the export
              </button>
            </div>
            {renderManualSearch(entry)}
          </div>
        )}

        {state.status === 'skipped' && (
          <div className="match-options">{renderManualSearch(entry)}</div>
        )}
      </motion.div>
    );
  };

  const { reviewGroups, reviewStandalone, matchedEntries, skippedEntries } = useMemo(() => {
    const groups = new Map<string, NetflixEntry[]>();
    const standalone: NetflixEntry[] = [];
    const matched: NetflixEntry[] = [];
    const skipped: NetflixEntry[] = [];

    for (const entry of entries) {
      const status = states[entry.key]?.status ?? 'pending';
      if (status === 'matched') {
        matched.push(entry);
        continue;
      }
      if (status === 'skipped') {
        skipped.push(entry);
        continue;
      }
      if (status === 'pending') continue;

      if (entry.groupTitle) {
        if (!groups.has(entry.groupTitle)) groups.set(entry.groupTitle, []);
        groups.get(entry.groupTitle)!.push(entry);
      } else {
        standalone.push(entry);
      }
    }

    for (const [title, groupEntries] of Array.from(groups.entries())) {
      if (groupEntries.length < 2) {
        standalone.push(groupEntries[0]);
        groups.delete(title);
      }
    }

    return { reviewGroups: groups, reviewStandalone: standalone, matchedEntries: matched, skippedEntries: skipped };
  }, [entries, states]);

  return (
    <div className="dashboard">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Export Mode</h2>
          <button
            onClick={async () => {
              await fetch('/api/settings/clear', { method: 'POST' });
              window.location.replace('/');
            }}
            style={{ fontSize: '0.9rem', padding: '8px 16px', background: 'transparent', border: '1px solid var(--bg-accent)' }}
          >
            Reset
          </button>
        </div>

        <div style={{ textAlign: 'left', background: 'var(--bg-accent)', padding: '1.25rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
          <p style={{ marginBottom: '0.75rem' }}>
            Nothing here touches the Trakt API. Your history is matched against TMDB, then written to a file you
            upload yourself on <a href="https://trakt.tv/settings" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--primary)' }}>Trakt → Settings</a> → import your data.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Start with the JSON file. If Trakt&apos;s importer rejects it, try the CSV; the Letterboxd CSV is a
            movies-only fallback that both Trakt and Letterboxd accept.
          </p>
        </div>

        <input type="file" accept=".csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
        <div className="file-drop-area" onClick={() => fileInputRef.current?.click()}>
          <p>Click here to select your NetflixViewingHistory.csv</p>
          <button type="button">Select File</button>
        </div>

        {entries.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <p style={{ marginBottom: '0.5rem' }}>
              Loaded {entries.length} titles — {counts.matched} matched, {counts.review} need review, {counts.skipped} left out,{' '}
              {counts.pending} not processed yet.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Netflix date format:</span>
              <button
                onClick={() => changeDateOrder('mdy')}
                style={{ padding: '6px 12px', fontSize: '0.85rem', background: dateOrder === 'mdy' ? 'var(--primary)' : 'var(--bg-accent)' }}
              >
                MM/DD/YY
              </button>
              <button
                onClick={() => changeDateOrder('dmy')}
                style={{ padding: '6px 12px', fontSize: '0.85rem', background: dateOrder === 'dmy' ? 'var(--primary)' : 'var(--bg-accent)' }}
              >
                DD/MM/YY
              </button>
              {dateOrderDetected && (
                <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>detected from your file</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0', flexWrap: 'wrap' }}>
              <label htmlFor="history-language" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Netflix history language:
              </label>
              <select
                id="history-language"
                value={language}
                onChange={e => {
                  setLanguage(e.target.value);
                  setLanguageDetected(false);
                }}
                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              >
                {HISTORY_LANGUAGES.map(option => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
              {languageDetected && (
                <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>detected from your file</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button onClick={runMatching} disabled={isProcessing || counts.pending === 0}>
                1. Match with TMDB
              </button>
              <button
                onClick={() => download('trakt-history.json', buildTraktJson(records), 'application/json')}
                disabled={records.length === 0}
              >
                2. Download Trakt JSON
              </button>
              <button
                onClick={() => download('trakt-history.csv', buildTraktCsv(records), 'text/csv')}
                disabled={records.length === 0}
              >
                Download Trakt CSV
              </button>
              <button
                onClick={() => download('letterboxd-diary.csv', buildLetterboxdCsv(records), 'text/csv')}
                disabled={summary.movies === 0}
              >
                Download Letterboxd CSV (movies)
              </button>
              <button onClick={downloadUnmatched} disabled={entries.length === 0}>
                Download unmatched list
              </button>
            </div>

            {records.length > 0 && (
              <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
                Export contains {summary.total} watch entries: {summary.movies} movie plays, {summary.episodes} episode
                plays{summary.shows > 0 ? `, ${summary.shows} full show(s)` : ''}.
              </p>
            )}
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <div className="title-list" style={{ position: 'relative' }}>
          <AnimatePresence>
            {statusText && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                style={{
                  position: 'sticky',
                  top: '1rem',
                  zIndex: 100,
                  background: 'var(--primary)',
                  color: '#fff',
                  padding: '1rem 1.5rem',
                  borderRadius: '24px',
                  fontWeight: 'bold',
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  margin: '0 auto 2rem auto',
                  width: 'max-content',
                  maxWidth: '90%',
                  backdropFilter: 'blur(10px)',
                }}
              >
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                  style={{ fontSize: '1.2rem', display: 'inline-block' }}
                >
                  🔄
                </motion.span>
                {statusText}
              </motion.div>
            )}
          </AnimatePresence>

          {Array.from(reviewGroups.entries()).map(([groupTitle, groupEntries]) => {
            const showCandidates = new Map<number, MatchCandidate>();
            groupEntries.forEach(entry => {
              (states[entry.key]?.candidates || []).forEach(candidate => {
                if (candidate.media.type === 'show') showCandidates.set(candidate.media.tmdbId, candidate);
                if (candidate.media.type === 'episode' && !showCandidates.has(candidate.media.showTmdbId)) {
                  const { showTitle, showYear, showTmdbId, showImdbId, showTvdbId } = candidate.media;
                  showCandidates.set(showTmdbId, {
                    id: `show-${showTmdbId}`,
                    label: `${showTitle}${showYear ? ` (${showYear})` : ''} — entire show`,
                    score: 0,
                    media: { type: 'show', title: showTitle, year: showYear, tmdbId: showTmdbId, imdbId: showImdbId, tvdbId: showTvdbId },
                  });
                }
              });
            });

            return (
              <details key={groupTitle} className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', outline: 'none' }}>
                  Group: {groupTitle} ({groupEntries.length} episodes need review)
                </summary>

                <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-accent)', borderRadius: '6px' }}>
                  <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>Quick actions:</p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {Array.from(showCandidates.values()).map(candidate =>
                      candidate.media.type === 'show' ? (
                        <button
                          key={`rematch-${candidate.id}`}
                          style={{ padding: '6px 12px', fontSize: '0.9rem' }}
                          disabled={isProcessing}
                          onClick={() => {
                            if (candidate.media.type === 'show') {
                              rematchGroup(groupEntries, candidate.media.tmdbId, candidate.media.title);
                            }
                          }}
                        >
                          Re-match episodes in: {candidate.label}
                        </button>
                      ) : null
                    )}
                    {Array.from(showCandidates.values()).map(candidate => (
                      <button
                        key={candidate.id}
                        style={{ padding: '6px 12px', fontSize: '0.9rem', background: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)' }}
                        onClick={() => matchEntireShow(groupEntries, candidate.media)}
                      >
                        Mark all as watched: {candidate.label}
                      </button>
                    ))}
                    <button style={{ padding: '6px 12px', fontSize: '0.9rem' }} onClick={() => skipGroup(groupEntries)}>
                      Leave this show out
                    </button>
                  </div>
                  <p style={{ margin: '0.75rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    &ldquo;Re-match episodes&rdquo; looks each episode up again in the show you picked.
                    &ldquo;Mark all as watched&rdquo; writes one whole-show entry, which tells Trakt every episode was seen.
                  </p>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <AnimatePresence>{groupEntries.map(entry => renderItemCard(entry))}</AnimatePresence>
                </div>
              </details>
            );
          })}

          <AnimatePresence>{reviewStandalone.map(entry => renderItemCard(entry))}</AnimatePresence>

          {skippedEntries.length > 0 && (
            <details className="card" style={{ padding: '1rem', marginTop: '2rem', background: 'var(--bg-accent)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', outline: 'none' }}>
                Left out of the export ({skippedEntries.length})
              </summary>
              <div style={{ marginTop: '1rem' }}>
                <AnimatePresence>{skippedEntries.map(entry => renderItemCard(entry))}</AnimatePresence>
              </div>
            </details>
          )}

          {matchedEntries.length > 0 && (
            <details className="card" style={{ padding: '1rem', marginTop: '2rem', background: 'var(--bg-accent)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', outline: 'none' }}>
                Matched ({matchedEntries.length})
              </summary>
              <div style={{ marginTop: '1rem' }}>
                <AnimatePresence>{matchedEntries.map(entry => renderItemCard(entry))}</AnimatePresence>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
