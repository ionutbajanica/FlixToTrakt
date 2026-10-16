import { cookies } from 'next/headers';
import ClientPage from './ClientPage';
import { resolveTraktClientId, sharedTraktClientId } from '@/lib/trakt-server';

export default async function Home() {
  const cookieStore = await cookies();
  // app_mode is written by the setup form, so its absence means first visit.
  const isConfigured = cookieStore.has('app_mode');
  const hasClientId = resolveTraktClientId(cookieStore) !== undefined;
  const hasAccessToken = cookieStore.has('trakt_access_token');
  const hasTmdbToken = cookieStore.has('tmdb_token');
  const mode = cookieStore.get('app_mode')?.value === 'export' ? 'export' : 'trakt';

  return (
    <main className="container">
      <h1>FlixToTrakt</h1>
      <ClientPage
        isConfigured={isConfigured}
        hasClientId={hasClientId}
        hasSharedClientId={sharedTraktClientId() !== undefined}
        hasAccessToken={hasAccessToken}
        hasTmdbToken={hasTmdbToken}
        mode={mode}
      />
    </main>
  );
}
