import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Given a show name, looks it up on TMDB and returns total episode count.
 * Also resolves the Trakt show ID via TMDB→Trakt bridge so the frontend
 * can directly mark it as a show-level match without further API calls.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const showName: string = body.showName;

  if (!showName) {
    return NextResponse.json({ error: 'showName required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const tmdbToken = cookieStore.get('tmdb_token')?.value;
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const token = cookieStore.get('trakt_access_token')?.value;

  if (!tmdbToken) {
    return NextResponse.json({ available: false, reason: 'No TMDB token' });
  }

  if (!clientId || !token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Search TMDB for the show
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(showName)}&language=en-US`,
      {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${tmdbToken}`,
        },
      }
    );

    if (!searchRes.ok) {
      return NextResponse.json({ available: false, reason: 'TMDB search failed' });
    }

    const searchData = await searchRes.json();
    if (!searchData.results || searchData.results.length === 0) {
      return NextResponse.json({ available: false, reason: 'Show not found on TMDB' });
    }

    const tmdbShow = searchData.results[0];
    const tmdbId = tmdbShow.id;

    // 2. Get show details from TMDB (includes number_of_episodes)
    const detailsRes = await fetch(
      `https://api.themoviedb.org/3/tv/${tmdbId}?language=en-US`,
      {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${tmdbToken}`,
        },
      }
    );

    if (!detailsRes.ok) {
      return NextResponse.json({ available: false, reason: 'TMDB details failed' });
    }

    const details = await detailsRes.json();
    const totalEpisodes: number = details.number_of_episodes || 0;
    const showTitle: string = details.name || tmdbShow.name;
    const showYear: number = details.first_air_date ? parseInt(details.first_air_date.substring(0, 4), 10) : 0;

    // 3. Resolve Trakt ID via TMDB bridge
    const traktRes = await fetch(
      `https://api.trakt.tv/search/tmdb/${tmdbId}?type=show`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'trakt-api-version': '2',
          'trakt-api-key': clientId,
          'User-Agent': 'Trakt-Updater-App/1.0',
        },
      }
    );

    if (!traktRes.ok) {
      return NextResponse.json({
        available: true,
        totalEpisodes,
        showTitle,
        showYear,
        traktId: null,
        traktSlug: null,
        reason: 'Trakt lookup failed',
      });
    }

    const traktData = await traktRes.json();
    if (!traktData || traktData.length === 0) {
      return NextResponse.json({
        available: true,
        totalEpisodes,
        showTitle,
        showYear,
        traktId: null,
        traktSlug: null,
        reason: 'Show not found on Trakt',
      });
    }

    const traktShow = traktData[0].show;

    return NextResponse.json({
      available: true,
      totalEpisodes,
      showTitle: traktShow.title || showTitle,
      showYear: traktShow.year || showYear,
      traktId: traktShow.ids.trakt,
      traktSlug: traktShow.ids.slug,
    });
  } catch (err) {
    console.error('show-episode-count error:', err);
    return NextResponse.json({ available: false, reason: 'Internal error' });
  }
}
