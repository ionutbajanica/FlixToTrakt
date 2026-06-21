'use client';

import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'framer-motion';

interface NetflixHistoryItem {
  Title: string;
  Date: string;
}

interface TraktSearchResult {
  type: string;
  score: number;
  movie?: { title: string; year: number; ids: { trakt: number; slug?: string } };
  show?: { title: string; year: number; ids: { trakt: number; slug?: string } };
  episode?: { title: string; season: number; number: number; showTitle?: string; showSlug?: string; ids: { trakt: number } };
}

interface ProcessedItem {
  originalTitle: string;
  groupTitle?: string;
  seasonNumber?: number;
  episodeTitle?: string;
  dates: string[];
  status: 'pending' | 'searching' | 'exact-match' | 'manual-review' | 'synced' | 'ignored';
  results: TraktSearchResult[];
  selectedResultId?: number;
  selectedResultType?: 'movie' | 'show' | 'episode' | 'season';
}

export default function Dashboard() {
  const [items, setItems] = useState<ProcessedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentlyProcessingTitle, setCurrentlyProcessingTitle] = useState<string | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number | null>(null);
  const [manualSearchQuery, setManualSearchQuery] = useState<Record<number, string>>({});
  const [manualSearchResults, setManualSearchResults] = useState<Record<number, TraktSearchResult[]>>({});
  const [manualSearchLoading, setManualSearchLoading] = useState<Record<number, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentJobIdRef = useRef<number>(0);

  const [watchedHistory, setWatchedHistory] = useState<{
    movies: Set<number>;
    shows: Record<number, Record<number, number[]>>;
  } | null>(null);

  useEffect(() => {
    fetch('/api/trakt/watched')
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setWatchedHistory({
            movies: new Set(data.movies || []),
            shows: data.shows || {}
          });
        }
      })
      .catch(() => {});
  }, []);

  // Only track movie and episode IDs as "already matched".
  // Show-level IDs are excluded because multiple episodes legitimately
  // need to reference the same parent show.
  const alreadyMatchedIds = new Set(
    items
      .filter(i => (i.status === 'exact-match' || i.status === 'synced') && i.selectedResultId && i.selectedResultType !== 'show')
      .map(i => i.selectedResultId)
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        if (rows.length < 2) {
          alert('Could not find any valid rows in the CSV file.');
          return;
        }

        const dataRows = rows.slice(1);
        const initialItemsMap = new Map<string, ProcessedItem>();

        dataRows.forEach(row => {
          if (row.length < 2 || !row[0] || row[0].trim() === '') return;
          
          const originalTitle = row[0].trim();
          const date = row[1] ? row[1].trim() : '';
          
          if (initialItemsMap.has(originalTitle)) {
             initialItemsMap.get(originalTitle)!.dates.push(date);
             return;
          }

          let groupTitle;
          let seasonNumber;
          let episodeTitle;

          // regex 1: TvShow : Season 1: EpisodeTitle
          let match = originalTitle.match(/(.+):\s+.+\s+(\d{1,2}):\s+(.*)/);
          if (match) {
            groupTitle = match[1].trim();
            seasonNumber = parseInt(match[2], 10);
            episodeTitle = match[3].trim();
          } else {
            // regex 2: TvShow : Season 1 - Part A: EpisodeTitle
            match = originalTitle.match(/(.+):\s+.+\s+(\d{1,2})\s+–\s+.+:\s+(.*)/);
            if (match) {
              groupTitle = match[1].trim();
              seasonNumber = parseInt(match[2], 10);
              episodeTitle = match[3].trim();
            } else {
              // regex 3: TvShow : TvShow: Miniseries : EpisodeTitle
              match = originalTitle.match(/(.+):\s+\w+:\s+(.+)/);
              if (match) {
                groupTitle = match[1].trim();
                seasonNumber = 1;
                episodeTitle = match[2].trim();
              } else {
                // regex 4: TvShow: SeasonName : EpisodeTitle
                match = originalTitle.match(/(.+):\s+(.+):\s+(.+)/);
                if (match) {
                  groupTitle = match[1].trim();
                  episodeTitle = match[3].trim();
                } else {
                  // regex 5: TvShow: EpisodeTitle
                  match = originalTitle.match(/(.+):\s+(.+)/);
                  if (match) {
                    groupTitle = match[1].trim();
                    seasonNumber = 1; // Assuming first season usually
                    episodeTitle = match[2].trim();
                  }
                }
              }
            }
          }

          initialItemsMap.set(originalTitle, {
            originalTitle,
            groupTitle,
            seasonNumber,
            episodeTitle,
            dates: [date],
            status: 'pending',
            results: []
          });
        });

        const initialItems = Array.from(initialItemsMap.values());

        const parseDate = (dateStr: string) => {
          if (!dateStr) return 0;
          let time = new Date(dateStr).getTime();
          if (isNaN(time)) {
            const parts = dateStr.split(/[-/.]/);
            if (parts.length === 3) {
              time = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
            }
          }
          return isNaN(time) ? 0 : time;
        };

        // Sort by the most recent date of the grouped dates array
        initialItems.sort((a, b) => parseDate(b.dates[0]) - parseDate(a.dates[0]));
          
        currentJobIdRef.current += 1;
        setIsProcessing(false);
        setCurrentlyProcessingTitle(null);

        if (initialItems.length === 0) {
           alert('Parsed file but found no valid titles. Please ensure the CSV has Title in the first column.');
        } else {
           setItems(initialItems);
        }
      }
    });
  };

  const processItems = async () => {
    setIsProcessing(true);
    currentJobIdRef.current += 1;
    const jobId = currentJobIdRef.current;
    let newItems = [...items];

    const matched = newItems.map((item, index) => ({ item, index })).filter(x => x.item.status === 'exact-match' || x.item.status === 'synced');
    const unmatched = newItems.map((item, index) => ({ item, index })).filter(x => x.item.status !== 'exact-match' && x.item.status !== 'synced');
    
    const grouped = new Map<string, { item: ProcessedItem, index: number }[]>();
    const standalone: { item: ProcessedItem, index: number }[] = [];

    unmatched.forEach(x => {
      if (x.item.groupTitle && x.item.status !== 'ignored') {
        if (!grouped.has(x.item.groupTitle)) {
          grouped.set(x.item.groupTitle, []);
        }
        grouped.get(x.item.groupTitle)!.push(x);
      } else {
        standalone.push(x);
      }
    });

    for (const [groupTitle, groupItems] of Array.from(grouped.entries())) {
      if (groupItems.length < 2) {
        standalone.push(groupItems[0]);
        grouped.delete(groupTitle);
      }
    }

    // ── Full-show shortcut ─────────────────────────────────────────────
    // For each group, check if the number of episodes in the CSV matches
    // the total episode count on TMDB. If so, mark the entire show as
    // watched without doing individual episode lookups.
    const autoMatchedGroups = new Set<string>();
    const groupEntries = Array.from(grouped.entries());
    
    if (groupEntries.length > 0) {
      setCurrentlyProcessingTitle(`Checking ${groupEntries.length} show(s) for full-show shortcut...`);
      setItems([...newItems]);
    }

    for (const [groupTitle, groupItems] of groupEntries) {
      if (currentJobIdRef.current !== jobId) return;

      try {
        const res = await fetch('/api/trakt/show-episode-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showName: groupTitle }),
        });

        if (res.ok) {
          const data = await res.json();
          
          if (data.available && data.traktId && data.totalEpisodes > 0 && groupItems.length >= data.totalEpisodes) {
            console.log(`[Full-show shortcut] "${groupTitle}": CSV has ${groupItems.length} episodes, TMDB has ${data.totalEpisodes}. Auto-matching!`);
            
            let foundMain = false;
            groupItems.forEach(({ index }) => {
              if (!foundMain) {
                newItems[index].status = 'exact-match';
                newItems[index].selectedResultType = 'show';
                newItems[index].selectedResultId = data.traktId;
                newItems[index].originalTitle = `[FULL SHOW] ${data.showTitle} (${data.showYear})`;
                foundMain = true;
              } else {
                newItems[index].status = 'ignored';
              }
            });

            autoMatchedGroups.add(groupTitle);
            setItems([...newItems]);
          }
        }
      } catch (e) {
        // Silently continue — we'll fall back to normal episode matching
      }
    }

    // Remove auto-matched groups from the processing pipeline
    for (const g of autoMatchedGroups) {
      grouped.delete(g);
    }

    const processOrder: number[] = [];
    Array.from(grouped.values()).forEach(group => group.forEach(x => processOrder.push(x.index)));
    standalone.forEach(x => processOrder.push(x.index));
    matched.forEach(x => processOrder.push(x.index));

    const pendingIndices = processOrder.filter(i => newItems[i].status === 'pending');
    const BATCH_SIZE = 10;
    
    for (let batchStart = 0; batchStart < pendingIndices.length; batchStart += BATCH_SIZE) {
      if (currentJobIdRef.current !== jobId) return;

      const batchIndices = pendingIndices.slice(batchStart, batchStart + BATCH_SIZE);
      
      batchIndices.forEach(i => { newItems[i].status = 'searching'; });
      const currentBatchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pendingIndices.length / BATCH_SIZE);
      setCurrentlyProcessingTitle(`Matching batch ${currentBatchNum} of ${totalBatches}...`);
      setItems([...newItems]);

      let retryDelay = 0;

      try {
        const titles = batchIndices.map(i => newItems[i].originalTitle);
        const res = await fetch('/api/trakt/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titles })
        });
        
        if (currentJobIdRef.current !== jobId) return;

        if (res.status === 429) {
           const errData = await res.json();
           retryDelay = errData.retryAfter || 300;
           throw new Error('RATE_LIMIT');
        }

        if (!res.ok) throw new Error('Search API failed');

        const resultsArray = await res.json();

        for (let bIndex = 0; bIndex < batchIndices.length; bIndex++) {
          const i = batchIndices[bIndex];
          const data: TraktSearchResult[] = resultsArray[bIndex] || [];
          
          if (!Array.isArray(data)) {
            newItems[i].status = 'ignored';
            continue;
          }

          newItems[i].results = data;

          const isEpisodeNameMatch = (r: TraktSearchResult) => {
             if (r.type !== 'episode' || !r.episode) return false;
             if (newItems[i].episodeTitle) {
               const searchTitle = newItems[i].episodeTitle!.toLowerCase();
               if (r.episode.title.toLowerCase() === searchTitle) return true;
               
               // Fallback episode number extraction
               const epRegex = /(?:Folge|Episode|Chapter|Part)\s+(\d{1,2})/i;
               const epMatch = searchTitle.match(epRegex);
               if (epMatch) {
                 const num = parseInt(epMatch[1], 10);
                 if (r.episode.number === num) return true;
               }
             }
             return false;
          };

          const exactMatches = data.filter(
            r => (r.type === 'episode' && (r.score === 100 || isEpisodeNameMatch(r))) ||
                 (r.type === 'movie' && r.movie?.title.toLowerCase() === newItems[i].originalTitle.toLowerCase()) || 
                 (r.type === 'show' && r.show?.title.toLowerCase() === newItems[i].originalTitle.toLowerCase())
          );

          if (exactMatches.length === 1) {
            const exactMatch = exactMatches[0];
            
            let isAlreadyWatched = false;
            if (exactMatch.type === 'episode' && exactMatch.episode && watchedHistory) {
              const showId = exactMatch.show?.ids.trakt;
              const season = exactMatch.episode.season;
              const epNum = exactMatch.episode.number;
              if (showId && watchedHistory.shows[showId] && watchedHistory.shows[showId][season]?.includes(epNum)) {
                isAlreadyWatched = true;
              }
            } else if (exactMatch.type === 'movie' && exactMatch.movie && watchedHistory) {
              if (watchedHistory.movies.has(exactMatch.movie.ids.trakt)) {
                isAlreadyWatched = true;
              }
            }

            if (isAlreadyWatched) {
              newItems[i].status = 'synced';
              newItems[i].originalTitle = `[ALREADY WATCHED] ${newItems[i].originalTitle}`;
            } else {
              newItems[i].status = 'exact-match';
            }

            if (exactMatch.type === 'episode') {
              newItems[i].selectedResultId = exactMatch.episode?.ids.trakt;
              newItems[i].selectedResultType = 'episode';
            } else {
              newItems[i].selectedResultId = exactMatch.movie ? exactMatch.movie.ids.trakt : exactMatch.show?.ids.trakt;
              newItems[i].selectedResultType = exactMatch.movie ? 'movie' : 'show';
            }
          } else if (exactMatches.length > 1) {
            newItems[i].status = 'manual-review';
            newItems[i].results = exactMatches;
          } else if (data.length > 0) {
            newItems[i].status = 'manual-review';
          } else {
            newItems[i].status = 'ignored';
          }
        }
      } catch (err: any) {
        if (err.message === 'RATE_LIMIT') {
          batchIndices.forEach(i => { newItems[i].status = 'pending'; });
          setItems([...newItems]);
          
          for (let r = retryDelay; r > 0; r--) {
             if (currentJobIdRef.current !== jobId) return;
             setRateLimitCountdown(r);
             await new Promise(resolve => setTimeout(resolve, 1000));
          }
          setRateLimitCountdown(null);
          
          batchStart -= BATCH_SIZE;
          continue;
        } else {
          batchIndices.forEach(i => { newItems[i].status = 'ignored'; });
        }
      }

      setItems([...newItems]);
    }
    
    setCurrentlyProcessingTitle(null);
    setIsProcessing(false);
  };

  const handleManualSelect = (index: number, id: number, type: 'movie' | 'show' | 'episode') => {
    const newItems = [...items];
    const item = newItems[index];

    const applySelection = (idx: number) => {
      let isAlreadyWatched = false;
      if (watchedHistory) {
        if (type === 'movie' && watchedHistory.movies.has(id)) {
           isAlreadyWatched = true;
        } else if (type === 'episode') {
           const result = newItems[idx].results.find(r => r.episode?.ids.trakt === id);
           if (result && result.show && result.episode) {
              const showId = result.show.ids.trakt;
              const season = result.episode.season;
              const epNum = result.episode.number;
              if (watchedHistory.shows[showId] && watchedHistory.shows[showId][season]?.includes(epNum)) {
                 isAlreadyWatched = true;
              }
           }
        }
      }

      newItems[idx].selectedResultId = id;
      newItems[idx].selectedResultType = type;
      
      if (isAlreadyWatched) {
         newItems[idx].status = 'synced';
         newItems[idx].originalTitle = `[ALREADY WATCHED] ${newItems[idx].originalTitle.replace('[ALREADY WATCHED] ', '')}`;
      } else {
         newItems[idx].status = 'exact-match';
      }
    };

    applySelection(index);

    // When a show is selected for an episode in a group, cascade to all
    // sibling episodes in the same group that are still in manual-review.
    if (type === 'show' && item.groupTitle) {
      newItems.forEach((sibling, sibIdx) => {
        if (sibIdx !== index && sibling.groupTitle === item.groupTitle && sibling.status === 'manual-review') {
          applySelection(sibIdx);
        }
      });
    }
    
    setItems(newItems);
  };

  const handleIgnore = (index: number) => {
    const newItems = [...items];
    newItems[index].status = 'ignored';
    setItems(newItems);
  };

  const syncToTrakt = async () => {
    setIsProcessing(true);
    currentJobIdRef.current += 1;
    const jobId = currentJobIdRef.current;
    
    const toSync = items.filter(item => item.status === 'exact-match' && item.selectedResultId);

    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(toSync.length / BATCH_SIZE);
    
    let totalAdded = { movies: 0, episodes: 0, shows: 0 };
    let hasError = false;

    for (let i = 0; i < toSync.length; i += BATCH_SIZE) {
      if (currentJobIdRef.current !== jobId) return;
      
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      setCurrentlyProcessingTitle(`Syncing batch ${batchNum} of ${totalBatches}...`);
      
      const batch = toSync.slice(i, i + BATCH_SIZE);
      
      try {
        const res = await fetch('/api/trakt/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch })
        });

        if (currentJobIdRef.current !== jobId) return;

        if (res.status === 429) {
          const errData = await res.json().catch(() => ({ retryAfter: 30 }));
          const waitTime = errData.retryAfter || 30;
          setCurrentlyProcessingTitle(`Rate limited during sync. Waiting ${waitTime} seconds...`);
          await new Promise(resolve => setTimeout(resolve, (waitTime + 1) * 1000));
          i -= BATCH_SIZE; // retry this batch
          continue;
        }

        if (res.ok) {
          const data = await res.json();
          const added = data.added || {};
          totalAdded.movies += added.movies || 0;
          totalAdded.episodes += added.episodes || 0;
          totalAdded.shows += added.shows || 0;

          // Update synced status for this batch
          const syncedIds = new Set(batch.map(b => b.selectedResultId));
          const newItems = items.map(item => 
            item.status === 'exact-match' && syncedIds.has(item.selectedResultId) 
              ? { ...item, status: 'synced' as const } 
              : item
          );
          setItems(newItems);
        } else {
          hasError = true;
          const errData = await res.json().catch(() => ({}));
          alert(`Sync failed on batch ${batchNum}: ${errData.error || `HTTP ${res.status}`}${errData.detail ? `\n\nDetails: ${errData.detail}` : ''}`);
          break; // Stop syncing on error
        }
      } catch (err) {
        hasError = true;
        if (currentJobIdRef.current === jobId) alert(`Error during sync on batch ${batchNum}: network or server error.`);
        break; // Stop syncing on error
      }
    }
    
    if (currentJobIdRef.current === jobId) {
      setCurrentlyProcessingTitle(null);
      setIsProcessing(false);
      
      if (!hasError) {
        const parts = [];
        if (totalAdded.movies) parts.push(`${totalAdded.movies} movie(s)`);
        if (totalAdded.episodes) parts.push(`${totalAdded.episodes} episode(s)`);
        if (totalAdded.shows) parts.push(`${totalAdded.shows} show(s)`);
        alert(`Sync completed! Added: ${parts.length > 0 ? parts.join(', ') : 'nothing new (all already synced)'}.`);
      }
    }
  };

  const handleMatchSeason = async (groupTitle: string, seasonNum: number, indices: number[]) => {
    setIsProcessing(true);
    currentJobIdRef.current += 1;
    const jobId = currentJobIdRef.current;
    
    try {
      const res = await fetch('/api/trakt/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: groupTitle }) 
      });
      
      if (currentJobIdRef.current !== jobId) return;
      const data: TraktSearchResult[] = await res.json();
      
      const shows = data.filter(r => r.type === 'show');
      if (shows.length === 0) {
        alert(`Could not find any show matching "${groupTitle}"`);
      } else {
        const bestShow = shows[0];
        if (!confirm(`Found show: "${bestShow.show?.title} (${bestShow.show?.year})". Sync Season ${seasonNum} for this show?`)) {
           if (currentJobIdRef.current === jobId) setIsProcessing(false);
           return;
        }

        if (currentJobIdRef.current !== jobId) return;

        const newItems = [...items];
        let foundMain = false;
        
        indices.forEach(idx => {
          if (newItems[idx].seasonNumber === seasonNum) {
            if (!foundMain) {
              newItems[idx].status = 'exact-match';
              newItems[idx].selectedResultType = 'season';
              newItems[idx].selectedResultId = bestShow.show?.ids.trakt;
              newItems[idx].seasonNumber = seasonNum;
              newItems[idx].originalTitle = `[SEASON SYNC] ${bestShow.show?.title} (${bestShow.show?.year}) - Season ${seasonNum}`;
              foundMain = true;
            } else {
              newItems[idx].status = 'ignored';
            }
          }
        });
        
        setItems(newItems);
      }
    } catch (e) {
      if (currentJobIdRef.current === jobId) alert('Error searching for show.');
    }
    
    if (currentJobIdRef.current === jobId) setIsProcessing(false);
  };

  const handleMatchShow = async (groupTitle: string, indices: number[]) => {
    setIsProcessing(true);
    currentJobIdRef.current += 1;
    const jobId = currentJobIdRef.current;
    
    try {
      const res = await fetch('/api/trakt/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: groupTitle }) 
      });
      
      if (currentJobIdRef.current !== jobId) return;
      const data: TraktSearchResult[] = await res.json();
      
      const shows = data.filter(r => r.type === 'show');
      if (shows.length === 0) {
        alert(`Could not find any show matching "${groupTitle}"`);
      } else {
        const bestShow = shows[0];
        if (!confirm(`Found show: "${bestShow.show?.title} (${bestShow.show?.year})". Sync the ENTIRE show?`)) {
           if (currentJobIdRef.current === jobId) setIsProcessing(false);
           return;
        }

        if (currentJobIdRef.current !== jobId) return;

        const newItems = [...items];
        let foundMain = false;
        
        indices.forEach(idx => {
          if (!foundMain) {
            newItems[idx].status = 'exact-match';
            newItems[idx].selectedResultType = 'show';
            newItems[idx].selectedResultId = bestShow.show?.ids.trakt;
            newItems[idx].originalTitle = `[SHOW SYNC] ${bestShow.show?.title} (${bestShow.show?.year})`;
            foundMain = true;
          } else {
            newItems[idx].status = 'ignored';
          }
        });
        
        setItems(newItems);
      }
    } catch (e) {
      if (currentJobIdRef.current === jobId) alert('Error searching for show.');
    }
    
    if (currentJobIdRef.current === jobId) setIsProcessing(false);
  };

  const handleManualSearch = async (index: number) => {
    const query = manualSearchQuery[index]?.trim();
    if (!query) return;

    setManualSearchLoading(prev => ({ ...prev, [index]: true }));

    try {
      const res = await fetch('/api/trakt/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: query }),
      });

      if (res.ok) {
        const data: TraktSearchResult[] = await res.json();
        setManualSearchResults(prev => ({ ...prev, [index]: data }));
      }
    } catch (e) {
      // silently fail
    }

    setManualSearchLoading(prev => ({ ...prev, [index]: false }));
  };

  const renderSearchResult = (res: TraktSearchResult, rIdx: number, item: ProcessedItem, index: number) => {
    let title = res.movie?.title || res.show?.title || res.episode?.title;
    let desc = res.movie?.year || res.show?.year || '';
    if (res.type === 'episode' && res.episode) {
      title = `${res.episode.showTitle} - S${res.episode.season}E${res.episode.number}: ${res.episode.title}`;
      desc = '';
    }

    const id = res.movie?.ids.trakt || res.show?.ids.trakt || res.episode?.ids.trakt;
    const type = res.movie ? 'movie' as const : res.show ? 'show' as const : 'episode' as const;

    if (!id) return null;

    let traktLink = '';
    if (res.type === 'movie' && res.movie?.ids.slug) {
      traktLink = `https://trakt.tv/movies/${res.movie.ids.slug}`;
    } else if (res.type === 'show' && res.show?.ids.slug) {
      traktLink = `https://trakt.tv/shows/${res.show.ids.slug}`;
    } else if (res.type === 'episode' && res.episode?.showSlug) {
      traktLink = `https://trakt.tv/shows/${res.episode.showSlug}/seasons/${res.episode.season}/episodes/${res.episode.number}`;
    }

    return (
      <div key={rIdx} className="match-option-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="checkbox"
          checked={item.selectedResultId === id}
          onChange={() => handleManualSelect(index, id, type)}
        />
        <span>{title} {desc ? `(${desc})` : ''} - {type}</span>
        {traktLink && (
          <a href={traktLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--primary)', textDecoration: 'underline' }}>
            [View on Trakt]
          </a>
        )}
      </div>
    );
  };

  const renderManualSearchUI = (item: ProcessedItem, index: number) => (
    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--bg-accent)' }}>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Search Trakt manually:</p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Type a show or movie name..."
          value={manualSearchQuery[index] || ''}
          onChange={e => setManualSearchQuery(prev => ({ ...prev, [index]: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') handleManualSearch(index); }}
          style={{ flex: 1, marginBottom: 0, padding: '8px 12px', fontSize: '0.9rem' }}
        />
        <button
          onClick={() => handleManualSearch(index)}
          disabled={manualSearchLoading[index] || !manualSearchQuery[index]?.trim()}
          style={{ padding: '8px 16px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
        >
          {manualSearchLoading[index] ? '...' : '🔍 Search'}
        </button>
      </div>
      {manualSearchResults[index] && manualSearchResults[index].length > 0 && (
        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {manualSearchResults[index].slice(0, 8).map((res, rIdx) => renderSearchResult(res, rIdx, item, index))}
        </div>
      )}
      {manualSearchResults[index] && manualSearchResults[index].length === 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>No results found.</p>
      )}
    </div>
  );

  const renderItemCard = (item: ProcessedItem, index: number) => (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2 }}
      key={item.originalTitle + index} 
      className={`card title-item ${item.status}`}
      style={{ marginBottom: '1rem' }}
    >
      <div className="title-item-header">
        <div>
          <strong>{item.originalTitle}</strong>
          <span style={{ marginLeft: '1rem', color: 'var(--text-secondary)' }}>
            {item.dates?.length > 1 ? `${item.dates.length} views (Latest: ${item.dates[0]})` : (item.dates?.[0] || (item as any).date)}
          </span>
        </div>
        <div className={`badge badge-${item.status === 'exact-match' || item.status === 'synced' ? 'success' : item.status === 'manual-review' ? 'warning' : 'info'}`}>
          {item.status.replace('-', ' ')}
        </div>
      </div>

      {item.status === 'manual-review' && item.results.length > 0 && (() => {
        const availableResults = item.results.filter(res => {
          const id = res.movie?.ids.trakt || res.show?.ids.trakt || res.episode?.ids.trakt;
          if (!id || alreadyMatchedIds.has(id)) return false;

          // Filter out suggestions that were released AFTER the user watched them
          const watchedDateStr = item.dates?.[item.dates.length - 1] || item.dates?.[0] || (item as any).date;
          if (watchedDateStr) {
            let watchedDate = new Date(watchedDateStr);
            if (isNaN(watchedDate.getTime())) {
              // Fallback for DD/MM/YYYY or DD/MM/YY
              const parts = String(watchedDateStr).split(/[-/]/);
              if (parts.length === 3) {
                let y = parseInt(parts[2], 10);
                if (y < 100) y += 2000;
                watchedDate = new Date(y, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
              }
            }

            if (!isNaN(watchedDate.getTime())) {
              let releaseDateStr = (res.movie as any)?.released || (res.show as any)?.first_aired || (res.episode as any)?.first_aired;
              
              // Fallback to year if exact date is missing
              if (!releaseDateStr && (res.movie?.year || res.show?.year)) {
                releaseDateStr = `${res.movie?.year || res.show?.year}-01-01`;
              }

              if (releaseDateStr) {
                const releaseDate = new Date(releaseDateStr);
                // If the release date is completely after the watched date, it's impossible.
                // We add a 2-day buffer to account for timezone differences.
                if (!isNaN(releaseDate.getTime())) {
                  const bufferMs = 2 * 24 * 60 * 60 * 1000;
                  if (releaseDate.getTime() - bufferMs > watchedDate.getTime()) {
                    return false;
                  }
                }
              }
            }
          }

          return true;
        });

        if (availableResults.length === 0) {
          return (
            <div className="match-options">
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>All suggestions for this item are already matched to other titles.</p>
              <div className="match-option-row">
                <button style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleIgnore(index)}>
                  Ignore this item
                </button>
              </div>
              {renderManualSearchUI(item, index)}
            </div>
          );
        }

        return (
          <div className="match-options">
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Select the closest match or ignore:</p>
            {availableResults.slice(0, 5).map((res, rIdx) => renderSearchResult(res, rIdx, item, index))}
            <div className="match-option-row">
              <button style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleIgnore(index)}>
                Ignore this item
              </button>
            </div>
            {renderManualSearchUI(item, index)}
          </div>
        );
      })()}

      {item.status === 'ignored' && (
        <div className="match-options">
          {renderManualSearchUI(item, index)}
        </div>
      )}
    </motion.div>
  );

  return (
    <div className="dashboard">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0 }}>Upload Netflix History</h2>
          <button 
            onClick={async () => {
              await fetch('/api/settings/clear', { method: 'POST' });
              window.location.replace('/');
            }}
            style={{ fontSize: '0.9rem', padding: '8px 16px', background: 'transparent', border: '1px solid var(--bg-accent)' }}
          >
            Log Out
          </button>
        </div>
        <input 
          type="file" 
          accept=".csv" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileUpload} 
        />
        <div 
          className="file-drop-area"
          onClick={() => fileInputRef.current?.click()}
        >
          <p>Click here or drag and drop your NetflixViewingHistory.csv</p>
          <button type="button">Select File</button>
        </div>

        {items.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <p style={{ marginBottom: '1rem' }}>Loaded {items.length} items.</p>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
              <button 
                onClick={processItems} 
                disabled={isProcessing || !items.some(i => i.status === 'pending')}
              >
                1. Match Titles
              </button>
              <button 
                onClick={syncToTrakt}
                disabled={isProcessing || !items.some(i => i.status === 'exact-match')}
              >
                2. Sync Matched to Trakt
              </button>
            </div>
          </div>
        )}
      </div>

      {items.length > 0 && (() => {
        const matchedItems = items.map((item, index) => ({ item, index })).filter(x => x.item.status === 'exact-match' || x.item.status === 'synced');
        const unmatchedItems = items.map((item, index) => ({ item, index })).filter(x => x.item.status !== 'exact-match' && x.item.status !== 'synced');
        
        const allSynced = matchedItems.length > 0 && matchedItems.every(x => x.item.status === 'synced');

        const groupedUnmatched = new Map<string, { item: ProcessedItem, index: number }[]>();
        const standaloneUnmatched: { item: ProcessedItem, index: number }[] = [];
        const ignoredGroups = new Map<string, { item: ProcessedItem, index: number }[]>();
        const ignoredMovies: { item: ProcessedItem, index: number }[] = [];

        unmatchedItems.forEach(x => {
          if (x.item.status === 'ignored') {
            if (x.item.groupTitle) {
              if (!ignoredGroups.has(x.item.groupTitle)) ignoredGroups.set(x.item.groupTitle, []);
              ignoredGroups.get(x.item.groupTitle)!.push(x);
            } else {
              ignoredMovies.push(x);
            }
          } else if (x.item.groupTitle) {
            if (!groupedUnmatched.has(x.item.groupTitle)) {
              groupedUnmatched.set(x.item.groupTitle, []);
            }
            groupedUnmatched.get(x.item.groupTitle)!.push(x);
          } else {
            standaloneUnmatched.push(x);
          }
        });

        // Move small groups back to standalone
        for (const [groupTitle, groupItems] of Array.from(groupedUnmatched.entries())) {
          if (groupItems.length < 2) {
            standaloneUnmatched.push(groupItems[0]);
            groupedUnmatched.delete(groupTitle);
          }
        }
        
        const hasIgnored = ignoredGroups.size > 0 || ignoredMovies.length > 0;

        return (
          <div className="title-list" style={{ position: 'relative' }}>
            <AnimatePresence>
              {(currentlyProcessingTitle || rateLimitCountdown !== null) && (
                <motion.div 
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.95 }}
                  style={{
                    position: 'sticky',
                    top: '1rem',
                    zIndex: 100,
                    background: rateLimitCountdown !== null ? 'var(--warning)' : 'var(--primary)',
                    color: rateLimitCountdown !== null ? '#000' : '#fff',
                    padding: '1rem 1.5rem',
                    borderRadius: '24px',
                    marginBottom: '2rem',
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
                  {rateLimitCountdown !== null ? (
                     <>
                       <span style={{ fontSize: '1.2rem' }}>⏳</span>
                       Trakt rate limit reached. Resuming automatically in {Math.floor(rateLimitCountdown / 60)}:{(rateLimitCountdown % 60).toString().padStart(2, '0')}...
                     </>
                  ) : (
                     <>
                       <motion.span 
                         animate={{ rotate: 360 }} 
                         transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                         style={{ fontSize: '1.2rem', display: 'inline-block' }}
                       >
                         🔄
                       </motion.span>
                       {currentlyProcessingTitle}
                     </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            
            <AnimatePresence>
            {Array.from(groupedUnmatched.entries()).map(([groupTitle, groupItems]) => {
              const seasons = new Set<number>();
              groupItems.forEach(x => { if (x.item.seasonNumber !== undefined) seasons.add(x.item.seasonNumber); });

              // Extract unique show-type suggestions from all episodes in this group
              const suggestedShows = new Map<number, TraktSearchResult>();
              groupItems.forEach(x => {
                x.item.results.forEach(r => {
                  if (r.type === 'show' && r.show?.ids.trakt) {
                    suggestedShows.set(r.show.ids.trakt, r);
                  }
                });
              });

              return (
                <details key={groupTitle} className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', outline: 'none' }}>
                    Group: {groupTitle} ({groupItems.length} unmatched episodes)
                  </summary>
                  
                  <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-accent)', borderRadius: '6px' }}>
                    <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>Quick Actions:</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button style={{ padding: '6px 12px', fontSize: '0.9rem' }} onClick={() => handleMatchShow(groupTitle, groupItems.map(x => x.index))}>
                        Match & Sync ENTIRE Show
                      </button>
                      {Array.from(seasons).sort().map(sNum => (
                        <button key={sNum} style={{ padding: '6px 12px', fontSize: '0.9rem' }} onClick={() => handleMatchSeason(groupTitle, sNum, groupItems.map(x => x.index))}>
                          Match & Sync entire Season {sNum}
                        </button>
                      ))}
                    </div>
                    {suggestedShows.size > 0 && (
                      <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Suggested matches from episode results:</p>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {Array.from(suggestedShows.values()).slice(0, 5).map(r => {
                            const showId = r.show!.ids.trakt;
                            const showSlug = r.show!.ids.slug;
                            return (
                              <div key={showId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button 
                                  style={{ padding: '6px 12px', fontSize: '0.9rem', background: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)' }}
                                  onClick={() => {
                                    const firstManualIdx = groupItems.find(x => x.item.status === 'manual-review')?.index;
                                    if (firstManualIdx !== undefined) handleManualSelect(firstManualIdx, showId, 'show');
                                  }}
                                >
                                  Match all to: {r.show!.title} ({r.show!.year})
                                </button>
                                {showSlug && (
                                  <a href={`https://trakt.tv/shows/${showSlug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--primary)', textDecoration: 'underline' }}>
                                    [View]
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0' }}>
                    <AnimatePresence>
                    {groupItems.map(({ item, index }) => renderItemCard(item, index))}
                    </AnimatePresence>
                  </div>
                </details>
              );
            })}
            </AnimatePresence>

            <AnimatePresence>
            {standaloneUnmatched.map(({ item, index }) => renderItemCard(item, index))}
            </AnimatePresence>

            {hasIgnored && (
              <details className="card" style={{ padding: '1rem', marginTop: '2rem', background: 'var(--bg-accent)', borderColor: 'var(--border)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', outline: 'none' }}>
                  Ignored Titles ({Array.from(ignoredGroups.values()).reduce((sum, g) => sum + g.length, 0) + ignoredMovies.length})
                </summary>
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {Array.from(ignoredGroups.entries()).map(([groupTitle, groupItems]) => (
                    <details key={groupTitle} className="card" style={{ padding: '0.5rem 1rem' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', outline: 'none' }}>
                        Show: {groupTitle} ({groupItems.length} ignored episodes)
                      </summary>
                      <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0' }}>
                        <AnimatePresence>
                        {groupItems.map(({ item, index }) => renderItemCard(item, index))}
                        </AnimatePresence>
                      </div>
                    </details>
                  ))}

                  {ignoredMovies.length > 0 && (
                    <details className="card" style={{ padding: '0.5rem 1rem' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', outline: 'none' }}>
                        Movies ({ignoredMovies.length} ignored)
                      </summary>
                      <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0' }}>
                        <AnimatePresence>
                        {ignoredMovies.map(({ item, index }) => renderItemCard(item, index))}
                        </AnimatePresence>
                      </div>
                    </details>
                  )}
                </div>
              </details>
            )}
            
            {matchedItems.length > 0 && (
              <details className="card" style={{ padding: '1rem', marginTop: '2rem', background: 'var(--bg-accent)', borderColor: 'var(--border)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', outline: 'none' }}>
                  {allSynced ? 'Synced to Trakt' : 'Matched (awaiting sync)'} ({matchedItems.length})
                </summary>
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0' }}>
                  <AnimatePresence>
                  {matchedItems.map(({ item, index }) => renderItemCard(item, index))}
                  </AnimatePresence>
                </div>
              </details>
            )}
          </div>
        );
      })()}
    </div>
  );
}
