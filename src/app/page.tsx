import { cookies } from 'next/headers';
import ClientPage from './ClientPage';

export default async function Home() {
  const cookieStore = await cookies();
  const hasClientId = cookieStore.has('trakt_client_id');
  const hasAccessToken = cookieStore.has('trakt_access_token');
  const hasTmdbToken = cookieStore.has('tmdb_token');
  const mode = cookieStore.get('app_mode')?.value === 'export' ? 'export' : 'trakt';

  return (
    <main className="container">
      <h1>FlixToTrakt</h1>
      <ClientPage
        hasClientId={hasClientId}
        hasAccessToken={hasAccessToken}
        hasTmdbToken={hasTmdbToken}
        mode={mode}
      />
    </main>
  );
}
