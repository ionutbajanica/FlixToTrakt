'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'trakt' | 'export';

const linkStyle = { textDecoration: 'underline', color: 'var(--primary)' };
const codeStyle = { background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px' };

export default function SetupForm({ hasSharedClientId }: { hasSharedClientId: boolean }) {
  // With a shared Trakt app, syncing needs nothing from the user, so it is the
  // default. Without one, export mode is the path that works for everyone.
  const [mode, setMode] = useState<Mode>(hasSharedClientId ? 'trakt' : 'export');
  const [clientId, setClientId] = useState('');
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
        body: JSON.stringify({ clientId, tmdbToken, mode }),
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
        <button type="button" style={tabStyle(mode === 'export')} onClick={() => setMode('export')}>
          Export a file (no Trakt app)
        </button>
        <button type="button" style={tabStyle(mode === 'trakt')} onClick={() => setMode('trakt')}>
          {hasSharedClientId ? 'Sync directly to Trakt' : 'Sync directly (needs a Trakt app)'}
        </button>
      </div>

      {mode === 'trakt' ? (
        <div style={{ textAlign: 'left', background: 'var(--bg-accent)', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
          {hasSharedClientId ? (
            <>
              <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>
                No Trakt API app or keys needed.
              </p>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Save below and you&apos;ll get a short code to enter on Trakt&apos;s activation page. That connects
                your account to FlixToTrakt, and your history is synced straight into it.
              </p>
              <p style={{ color: 'var(--text-secondary)' }}>
                Free Trakt accounts can keep one third-party app connected at a time. If you already use another
                one, Trakt will ask you to disconnect it first. You can disconnect FlixToTrakt again under
                Trakt → Settings → Connected Apps once your import is done.
              </p>
            </>
          ) : (
            <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>
              This copy of FlixToTrakt has no shared Trakt app configured, so you need a Client ID of your own (see below).
            </p>
          )}

          <details open={!hasSharedClientId} style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: 'var(--text-primary)' }}>
              {hasSharedClientId ? 'Advanced: use your own Trakt app (optional)' : 'Create your own Trakt app'}
            </summary>
            <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', margin: '1rem 0' }}>
              <li>Go to <a href="https://developer.trakt.tv/apps" target="_blank" rel="noreferrer" style={linkStyle}>developer.trakt.tv → My Apps</a>. Trakt asks you to verify a GitHub account once before your first app.</li>
              <li>Create an app with any name, such as <em>Netflix Sync</em>. FlixToTrakt signs in with a code, not a redirect, so the Redirect URI isn&apos;t used.</li>
              <li>Copy the app&apos;s <strong>Client ID</strong> into the box below. The Client Secret isn&apos;t needed.</li>
            </ol>
            <p>Trakt deletes apps that go unused for 30 days, so you may need to create a new one for a later import.</p>
          </details>

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
            Prefer not to connect an app to your Trakt account? Switch to <strong>Export a file</strong> above. It
            never touches the Trakt API.
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
            <label htmlFor="clientId">
              Your own Trakt Client ID {hasSharedClientId ? '(Optional)' : '(Required)'}
            </label>
            <input
              id="clientId"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={hasSharedClientId ? "Leave empty to use FlixToTrakt's app" : ''}
              required={!hasSharedClientId}
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
