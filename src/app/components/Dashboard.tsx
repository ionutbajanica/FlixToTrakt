'use client';

import { useState, useRef } from 'react';
import Papa from 'papaparse';

interface NetflixHistoryItem {
  Title: string;
  Date: string;
}

interface TraktSearchResult {
  type: string;
  score: number;
  movie?: { title: string; year: number; ids: { trakt: number } };
  show?: { title: string; year: number; ids: { trakt: number } };
  episode?: { title: string; season: number; number: number; showTitle?: string; ids: { trakt: number } };
}

interface ProcessedItem {
  originalTitle: string;
  date: string;
  status: 'pending' | 'searching' | 'exact-match' | 'manual-review' | 'synced' | 'ignored';
  results: TraktSearchResult[];
  selectedResultId?: number;
  selectedResultType?: 'movie' | 'show' | 'episode';
}

export default function Dashboard() {
  const [items, setItems] = useState<ProcessedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

        // We assume the first row is headers, so we skip it.
        // We assume column 0 is Title, and column 1 is Date.
        const dataRows = rows.slice(1);

        const initialItems: ProcessedItem[] = dataRows
          .filter(row => row.length >= 2 && row[0] && row[0].trim() !== '') 
          .map(row => ({
            originalTitle: row[0].trim(),
            date: row[1] ? row[1].trim() : '',
            status: 'pending',
            results: []
          }));
          
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
    const newItems = [...items];

    for (let i = 0; i < newItems.length; i++) {
      if (newItems[i].status !== 'pending') continue;

      newItems[i].status = 'searching';
      setItems([...newItems]);

      try {
        const res = await fetch('/api/trakt/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newItems[i].originalTitle })
        });
        
        if (!res.ok) {
          throw new Error('Search API failed');
        }

        const data: TraktSearchResult[] = await res.json();
        if (!Array.isArray(data)) {
          throw new Error('Expected an array of results');
        }

        newItems[i].results = data;

        // Simple matching logic
        const exactMatch = data.find(
          r => r.type === 'episode' && r.score === 100 ||
               (r.movie?.title.toLowerCase() === newItems[i].originalTitle.toLowerCase()) || 
               (r.show?.title.toLowerCase() === newItems[i].originalTitle.toLowerCase())
        );

        if (exactMatch) {
          newItems[i].status = 'exact-match';
          if (exactMatch.type === 'episode') {
            newItems[i].selectedResultId = exactMatch.episode?.ids.trakt;
            newItems[i].selectedResultType = 'episode';
          } else {
            newItems[i].selectedResultId = exactMatch.movie ? exactMatch.movie.ids.trakt : exactMatch.show?.ids.trakt;
            newItems[i].selectedResultType = exactMatch.movie ? 'movie' : 'show';
          }
        } else if (data.length > 0) {
          newItems[i].status = 'manual-review';
        } else {
          newItems[i].status = 'ignored'; // Not found
        }
      } catch (err) {
        newItems[i].status = 'ignored';
      }

      setItems([...newItems]);
      // Small delay to avoid hitting rate limits too hard
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    setIsProcessing(false);
  };

  const handleManualSelect = (index: number, id: number, type: 'movie' | 'show' | 'episode') => {
    const newItems = [...items];
    newItems[index].selectedResultId = id;
    newItems[index].selectedResultType = type;
    newItems[index].status = 'exact-match';
    setItems(newItems);
  };

  const handleIgnore = (index: number) => {
    const newItems = [...items];
    newItems[index].status = 'ignored';
    setItems(newItems);
  };

  const syncToTrakt = async () => {
    setIsProcessing(true);
    const toSync = items.filter(item => item.status === 'exact-match' && item.selectedResultId);

    // Group into movies and episodes (for simplicity, we might just sync shows as episodes if possible, 
    // but Trakt search returns 'show' or 'movie'. If Netflix string was a show, we might need to sync it.
    // However, syncing a 'show' to Trakt marks all episodes as watched. That might be what we have to do 
    // if we don't parse season/episode.
    
    try {
      const res = await fetch('/api/trakt/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSync })
      });

      if (res.ok) {
        const newItems = items.map(item => 
          item.status === 'exact-match' ? { ...item, status: 'synced' as const } : item
        );
        setItems(newItems);
        alert('Sync completed successfully!');
      } else {
        alert('Sync failed.');
      }
    } catch (err) {
      alert('Error during sync.');
    }
    setIsProcessing(false);
  };

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

      {items.length > 0 && (
        <div className="title-list">
          {items.map((item, index) => (
            <div key={index} className={`card title-item ${item.status}`}>
              <div className="title-item-header">
                <div>
                  <strong>{item.originalTitle}</strong>
                  <span style={{ marginLeft: '1rem', color: 'var(--text-secondary)' }}>{item.date}</span>
                </div>
                <div className={`badge badge-${item.status === 'exact-match' || item.status === 'synced' ? 'success' : item.status === 'manual-review' ? 'warning' : 'info'}`}>
                  {item.status.replace('-', ' ')}
                </div>
              </div>

              {item.status === 'manual-review' && item.results.length > 0 && (
                <div className="match-options">
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Select the closest match or ignore:</p>
                  {item.results.slice(0, 5).map((res, rIdx) => {
                    let title = res.movie?.title || res.show?.title || res.episode?.title;
                    let desc = res.movie?.year || res.show?.year || '';
                    if (res.type === 'episode' && res.episode) {
                      title = `${res.episode.showTitle} - S${res.episode.season}E${res.episode.number}: ${res.episode.title}`;
                      desc = '';
                    }
                    
                    const id = res.movie?.ids.trakt || res.show?.ids.trakt || res.episode?.ids.trakt;
                    const type = res.movie ? 'movie' : res.show ? 'show' : 'episode';
                    
                    if (!id) return null;

                    return (
                      <div key={rIdx} className="match-option-row">
                        <input 
                          type="checkbox" 
                          checked={item.selectedResultId === id}
                          onChange={() => handleManualSelect(index, id, type)}
                        />
                        <span>{title} {desc ? `(${desc})` : ''} - {type}</span>
                      </div>
                    );
                  })}
                  <div className="match-option-row">
                    <button style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleIgnore(index)}>
                      Ignore this item
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
