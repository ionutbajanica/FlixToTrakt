'use client';

import { useState, useEffect } from 'react';
import SetupForm from './components/SetupForm';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';

interface ClientPageProps {
  hasClientId: boolean;
  hasAccessToken: boolean;
}

export default function ClientPage({ hasClientId, hasAccessToken }: ClientPageProps) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (navEntries.length > 0 && navEntries[0].type === 'reload') {
        // Only clear if we actually have cookies to clear, preventing infinite loops
        if (document.cookie.includes('trakt_client_id') || document.cookie.includes('trakt_access_token')) {
          fetch('/api/settings/clear', { method: 'POST' }).then(() => {
            window.location.replace('/');
          });
        }
      }
    }
  }, []);

  if (!hasClientId) {
    return <SetupForm />;
  }

  if (!hasAccessToken) {
    return <LoginForm />;
  }

  return <Dashboard />;
}
