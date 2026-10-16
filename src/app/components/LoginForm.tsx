'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export default function LoginForm() {
  const [deviceData, setDeviceData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('Waiting for authorization...');
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const fetchDeviceCode = useCallback(() => {
    setError(null);
    setErrorDetail(null);
    setDeviceData(null);
    setRetryCountdown(null);
    if (countdownRef.current) clearInterval(countdownRef.current);

    fetch('/api/auth/device/code', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
          const detail = data.details || '';
          setErrorDetail(detail);
          // Auto-retry after 60s if rate limited
          if (data.status === 429 || detail.toLowerCase().includes('rate') || detail.toLowerCase().includes('limit')) {
            let secs = 60;
            setRetryCountdown(secs);
            countdownRef.current = setInterval(() => {
              secs -= 1;
              setRetryCountdown(secs);
              if (secs <= 0) {
                clearInterval(countdownRef.current!);
                setRetryCountdown(null);
                fetchDeviceCode();
              }
            }, 1000);
          }
          return;
        }
        setDeviceData(data);
      })
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    fetchDeviceCode();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchDeviceCode]);

  useEffect(() => {
    if (!deviceData) return;

    // Add a 1s safety buffer to Trakt's required interval (e.g. 5s -> 6s) to avoid 429s
    let currentIntervalMs = (Math.max(deviceData.interval || 5, 5) + 1) * 1000;
    let isSubscribed = true;

    const poll = async () => {
      if (!isSubscribed) return;
      try {
        const res = await fetch('/api/auth/device/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceData.device_code })
        });
        
        const result = await res.json();
        if (!isSubscribed) return;
        
        if (result.success) {
          setStatusMsg('Successfully authorized! Redirecting...');
          sessionStorage.setItem('skip_reload_clear', 'true');
          window.location.reload();
          return;
        } else if (result.status === 400) {
          // Still waiting for user to authorize
          setStatusMsg('Waiting for authorization...');
        } else if (result.status === 429) {
          // Trakt rate limit (Slow Down): add 5s to interval and keep polling
          currentIntervalMs += 5000;
          setStatusMsg(`Polling adjusted (${Math.round(currentIntervalMs / 1000)}s interval). Still waiting for authorization...`);
        } else {
          setStatusMsg(`Error: ${result.message}`);
          return; // Stop polling on hard errors (expired, denied, invalid)
        }
      } catch (e) {
        // Network error, keep waiting
      }

      if (isSubscribed) {
        intervalRef.current = setTimeout(poll, currentIntervalMs);
      }
    };

    intervalRef.current = setTimeout(poll, currentIntervalMs);

    return () => {
      isSubscribed = false;
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [deviceData]);

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h2>Connect to Trakt</h2>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
        Authorize FlixToTrakt to add your Netflix history to your Trakt account.
      </p>

      {error && (
        <div style={{ background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.4)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ color: '#ff6b6b', fontWeight: 'bold', marginBottom: '0.5rem' }}>⚠️ {error}</p>
          {errorDetail && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem', wordBreak: 'break-all' }}>
              {errorDetail}
            </p>
          )}
          {retryCountdown !== null ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Trakt rate limit hit. Auto-retrying in <strong>{retryCountdown}s</strong>…
            </p>
          ) : (
            <button onClick={fetchDeviceCode} style={{ marginTop: '0.5rem', padding: '8px 20px', fontSize: '0.9rem' }}>
              Retry
            </button>
          )}
        </div>
      )}

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
