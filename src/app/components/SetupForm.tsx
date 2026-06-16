'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupForm() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      
      if (res.ok) {
        router.refresh();
      } else {
        alert('Failed to save settings.');
      }
    } catch (err) {
      alert('Error saving settings.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Setup Trakt API</h2>
      <div style={{ textAlign: 'left', background: 'var(--bg-accent)', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
        <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>
          To sync your history, you need to connect your Trakt account. Follow these easy steps:
        </p>
        <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          <li>Log into Trakt and go to the <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--primary)' }}>Create Application</a> page.</li>
          <li>In the <strong>Name</strong> field, type something like <em>Netflix Sync</em>.</li>
          <li>In the <strong>Redirect uri</strong> field, copy and paste exactly this text: <code style={{ userSelect: 'all', background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px' }}>urn:ietf:wg:oauth:2.0:oob</code></li>
          <li>Click the <strong>Save App</strong> button at the very bottom.</li>
        </ol>
        <p style={{ color: 'var(--text-secondary)' }}>
          Once saved, Trakt will give you a <strong>Client ID</strong> and <strong>Client Secret</strong> at the top of the next page. Copy and paste those into the boxes below.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
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
        
        <button type="submit" disabled={loading}>
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
