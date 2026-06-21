import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const token = cookieStore.get('trakt_access_token')?.value;

  if (!clientId || !token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'User-Agent': 'Trakt-Updater-App/1.0',
    };

    const [moviesRes, showsRes] = await Promise.all([
      fetch('https://api.trakt.tv/sync/watched/movies', { headers }),
      fetch('https://api.trakt.tv/sync/watched/shows', { headers })
    ]);

    if (!moviesRes.ok || !showsRes.ok) {
      console.error('Movies Res:', moviesRes.status, moviesRes.statusText);
      console.error('Shows Res:', showsRes.status, showsRes.statusText);
      return NextResponse.json({ error: 'Failed to fetch watched history' }, { status: 500 });
    }

    const moviesData = await moviesRes.json();
    const showsData = await showsRes.json();

    const watchedMovies = new Set<number>();
    moviesData.forEach((m: any) => {
      if (m.movie?.ids?.trakt) watchedMovies.add(m.movie.ids.trakt);
    });

    const watchedShows: Record<number, Record<number, number[]>> = {};
    showsData.forEach((s: any) => {
      const showId = s.show?.ids?.trakt;
      if (!showId) return;
      watchedShows[showId] = {};
      
      s.seasons?.forEach((season: any) => {
        const seasonNum = season.number;
        watchedShows[showId][seasonNum] = season.episodes?.map((e: any) => e.number) || [];
      });
    });

    return NextResponse.json({
      movies: Array.from(watchedMovies),
      shows: watchedShows
    });

  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
