'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'trakt' | 'export';

const linkStyle = { textDecoration: 'underline', color: 'var(--primary)' };
const codeStyle = { background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px' };

export default function SetupForm() {
  const [mode, setMode] = useState<Mode>('trakt');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tmdbToken, setTmdbToken] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, tmdbToken, mode }),
      });

      if (res.ok) {
        router.refresh();
      } else {
        alert('Failed to save settings.');
      }
    } catch {
      alert('Error saving settings.');
    } finally {
      setLoading(false);
    }
  };

  const tabStyle = (active: boolean) => ({
    flex: 1,
    padding: '10px 16px',
    fontSize: '0.95rem',
    background: active ? 'var(--primary)' : 'transparent',
    border: `1px solid ${active ? 'var(--primary)' : 'var(--bg-accent)'}`,
  });

  return (
    <div className="card">
      <h2>{mode === 'trakt' ? 'Setup Trakt API' : 'Setup Export Mode'}</h2>

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1.5rem 0' }}>
        <button type="button" style={tabStyle(mode === 'trakt')} onClick={() => setMode('trakt')}>
          Sync directly (needs a Trakt app)
        </button>
        <button type="button" style={tabStyle(mode === 'export')} onClick={() => setMode('export')}>
          Export a file (no Trakt app)
        </button>
      </div>

      {mode === 'trakt' ? (
        <div style={{ textAlign: 'left', background: 'var(--bg-accent)', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
          <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>
            To sync your history, you need to connect your Trakt account. Follow these easy steps:
          </p>
          <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            <li>Log into Trakt and go to the <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer" style={linkStyle}>Create Application</a> page.</li>
            <li>In the <strong>Name</strong> field, type something like <em>Netflix Sync</em>.</li>
            <li>In the <strong>Redirect uri</strong> field, copy and paste exactly this text: <code style={{ userSelect: 'all', ...codeStyle }}>urn:ietf:wg:oauth:2.0:oob</code></li>
            <li>Click the <strong>Save App</strong> button at the very bottom.</li>
          </ol>
          <p style={{ color: 'var(--text-secondary)' }}>
            Once saved, Trakt will give you a <strong>Client ID</strong> and <strong>Client Secret</strong> at the top of the next page. Copy and paste those into the boxes below.
          </p>

          <hr style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '1.5rem 0' }} />

          <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>
            (Optional) Improve matching accuracy with TMDB:
          </p>
          <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            <li>Trakt&apos;s built-in text search often struggles with foreign or localized titles. We can use TMDB&apos;s search engine instead for much better accuracy.</li>
            <li>Register at <a href="https://www.themoviedb.org/signup" target="_blank" rel="noreferrer" style={linkStyle}>themoviedb.org</a>, then go to <strong>Settings → API</strong> and request a Developer API Key.</li>
            <li>Copy the <strong>API Read Access Token</strong> (the very long string starting with <code style={codeStyle}>eyJ...</code>) and paste it below.</li>
          </ul>

          <p style={{ color: 'var(--text-secondary)' }}>
            Trakt no longer lets every account create an API application. If that page is unavailable to you,
            switch to <strong>Export a file</strong> above — it needs no Trakt credentials at all.
          </p>
        </div>
      ) : (
        <div style={{ textAlign: 'left', background: 'var(--bg-accent)', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
          <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>
            No Trakt API application, no OAuth, no Trakt credentials at all.
          </p>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            This mode matches your Netflix history against TMDB and writes an import file. You then upload that
            file on Trakt&apos;s own import page (<a href="https://trakt.tv/settings" target="_blank" rel="noreferrer" style={linkStyle}>Trakt → Settings</a> → import
            your data), which free accounts can use.
          </p>
          <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>You only need a TMDB read access token:</p>
          <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            <li>Register at <a href="https://www.themoviedb.org/signup" target="_blank" rel="noreferrer" style={linkStyle}>themoviedb.org</a>, then go to <strong>Settings → API</strong> and request a Developer API Key (free, granted instantly).</li>
            <li>Copy the <strong>API Read Access Token</strong> (the long string starting with <code style={codeStyle}>eyJ...</code>) and paste it below.</li>
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {mode === 'trakt' && (
          <>
            <label htmlFor="clientId">Client ID</label>
            <input
              id="clientId"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
            />

            <label htmlFor="clientSecret">Client Secret</label>
            <input
              id="clientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              required
            />
          </>
        )}

        <label htmlFor="tmdbToken">
          TMDB API Read Access Token {mode === 'trakt' ? '(Optional)' : '(Required)'}
        </label>
        <input
          id="tmdbToken"
          type="password"
          value={tmdbToken}
          onChange={(e) => setTmdbToken(e.target.value)}
          placeholder="eyJ..."
          required={mode === 'export'}
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
