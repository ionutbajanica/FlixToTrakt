import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createTraktFetcher, TraktAuthError, traktAuthErrorResponse } from '@/lib/trakt-server';

export async function GET() {
  const cookieStore = await cookies();

  let fetchTrakt;
  try {
    ({ fetchTrakt } = createTraktFetcher(cookieStore));
  } catch (e) {
    if (e instanceof TraktAuthError) {
      const { body, status } = traktAuthErrorResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }

  try {
    const [moviesRes, showsRes] = await Promise.all([
      fetchTrakt('https://api.trakt.tv/sync/watched/movies'),
      fetchTrakt('https://api.trakt.tv/sync/watched/shows')
    ]);

    if (!moviesRes.ok || !showsRes.ok) {
      const isAuthError = moviesRes.status === 401 || moviesRes.status === 403 || showsRes.status === 401 || showsRes.status === 403;
      const status = isAuthError ? 401 : 500;
      return NextResponse.json({ error: isAuthError ? 'Unauthorized or invalid token' : 'Failed to fetch watched history' }, { status });
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
    if (error instanceof TraktAuthError) {
      const { body, status } = traktAuthErrorResponse(error);
      return NextResponse.json(body, { status });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
