'use client';

import { useState, useEffect, useRef } from 'react';

export default function LoginForm() {
  const [deviceData, setDeviceData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('Waiting for authorization...');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 1. Fetch Device Code
    fetch('/api/auth/device/code', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setDeviceData(data);
      })
      .catch(err => setError(err.message));

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!deviceData) return;

    // 2. Poll for Token
    const pollInterval = (deviceData.interval || 5) * 1000;
    
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/device/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceData.device_code })
        });
        
        const result = await res.json();
        
        if (result.success) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setStatusMsg('Successfully authorized! Redirecting...');
          window.location.reload();
        } else if (result.status === 400) {
          // Still waiting, do nothing
        } else {
          setStatusMsg(`Error: ${result.message}`);
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch (e) {
        // Network error, just retry next tick
      }
    }, pollInterval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [deviceData]);

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h2>Connect to Trakt</h2>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
        Your API credentials are saved. Now, you need to authorize this app to access your Trakt account.
      </p>

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {!deviceData && !error && <p>Generating device code...</p>}

      {deviceData && (
        <div style={{ background: 'var(--bg-accent)', padding: '2rem', borderRadius: '8px', marginBottom: '2rem' }}>
          <h3>Step 1: Go to Trakt</h3>
          <p style={{ marginBottom: '1rem' }}>
            Open <a href={deviceData.verification_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{deviceData.verification_url}</a>
          </p>
          
          <h3>Step 2: Enter Code</h3>
          <p style={{ fontSize: '2rem', letterSpacing: '4px', fontWeight: 'bold', margin: '1rem 0' }}>
            {deviceData.user_code}
          </p>
          
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {statusMsg}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <button 
          onClick={async () => {
            await fetch('/api/settings/clear', { method: 'POST' });
            window.location.reload();
          }}
          style={{ fontSize: '1.1rem', padding: '12px 24px', background: 'transparent', border: '1px solid var(--bg-accent)' }}
        >
          Reset Credentials
        </button>
      </div>
    </div>
  );
}
