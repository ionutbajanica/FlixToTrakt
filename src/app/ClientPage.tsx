'use client';

import SetupForm from './components/SetupForm';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
import ExportDashboard from './components/ExportDashboard';

interface ClientPageProps {
  isConfigured: boolean;
  hasClientId: boolean;
  hasSharedClientId: boolean;
  hasAccessToken: boolean;
  hasTmdbToken: boolean;
  mode: 'trakt' | 'export';
}

export default function ClientPage({ isConfigured, hasClientId, hasSharedClientId, hasAccessToken, hasTmdbToken, mode }: ClientPageProps) {
  const setup = <SetupForm hasSharedClientId={hasSharedClientId} />;

  // With a shared Trakt app every visitor already "has" a Client ID, so the
  // first visit is recognised by the missing mode choice instead.
  if (!isConfigured) {
    return setup;
  }

  // Export mode builds an import file instead of calling Trakt, so it skips
  // the whole OAuth chain and only needs a TMDB token.
  if (mode === 'export') {
    return hasTmdbToken ? <ExportDashboard /> : setup;
  }

  if (!hasClientId) {
    return setup;
  }

  if (!hasAccessToken) {
    return <LoginForm />;
  }

  return <Dashboard />;
}
