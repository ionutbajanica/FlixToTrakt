import { cookies } from 'next/headers';
import ClientPage from './ClientPage';

export default async function Home() {
  const cookieStore = await cookies();
  const hasClientId = cookieStore.has('trakt_client_id');
  const hasAccessToken = cookieStore.has('trakt_access_token');

  return (
    <main className="container">
      <h1>FlixToTrakt</h1>
      <ClientPage hasClientId={hasClientId} hasAccessToken={hasAccessToken} />
    </main>
  );
}
