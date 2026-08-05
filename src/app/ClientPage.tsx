'use client';

import SetupForm from './components/SetupForm';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
import ExportDashboard from './components/ExportDashboard';

interface ClientPageProps {
  hasClientId: boolean;
  hasAccessToken: boolean;
  hasTmdbToken: boolean;
  mode: 'trakt' | 'export';
}

export default function ClientPage({ hasClientId, hasAccessToken, hasTmdbToken, mode }: ClientPageProps) {
  // Export mode builds an import file instead of calling Trakt, so it skips
  // the whole OAuth chain and only needs a TMDB token.
  if (mode === 'export') {
    return hasTmdbToken ? <ExportDashboard /> : <SetupForm />;
  }

  if (!hasClientId) {
    return <SetupForm />;
  }

  if (!hasAccessToken) {
    return <LoginForm />;
  }

  return <Dashboard />;
}
