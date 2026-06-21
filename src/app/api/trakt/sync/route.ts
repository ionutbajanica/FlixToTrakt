import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const { items } = await request.json();

  if (!items || !Array.isArray(items)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const token = cookieStore.get('trakt_access_token')?.value;

  if (!clientId || !token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload: any = {
    movies: [],
    shows: [],
    episodes: []
  };

  for (const item of items) {
    if (!item.selectedResultId || !item.selectedResultType) continue;

    const dates = item.dates && item.dates.length > 0 ? item.dates : (item.date ? [item.date] : ['']);

    for (const d of dates) {
      let watchedAt;
      try {
        if (d) {
          const parsedDate = new Date(d);
          if (!isNaN(parsedDate.getTime())) {
            watchedAt = parsedDate.toISOString();
          }
        }
      } catch (e) {
        // ignore
      }

      const traktItem = {
        ids: { trakt: item.selectedResultId },
        ...(watchedAt && { watched_at: watchedAt })
      };

      if (item.selectedResultType === 'movie') {
        payload.movies.push(traktItem);
      } else if (item.selectedResultType === 'show') {
        payload.shows.push(traktItem);
      } else if (item.selectedResultType === 'episode') {
        payload.episodes.push(traktItem);
      } else if (item.selectedResultType === 'season' && item.seasonNumber !== undefined) {
        const existingShow = payload.shows.find((s: any) => s.ids.trakt === item.selectedResultId);
        const seasonObj = {
          number: item.seasonNumber,
          ...(watchedAt && { watched_at: watchedAt })
        };
        
        if (existingShow) {
          if (!existingShow.seasons) existingShow.seasons = [];
          existingShow.seasons.push(seasonObj);
        } else {
          payload.shows.push({
            ids: { trakt: item.selectedResultId },
            seasons: [seasonObj]
          });
        }
      }
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch('https://api.trakt.tv/sync/history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'trakt-api-version': '2',
        'trakt-api-key': clientId,
        'User-Agent': 'Trakt-Updater-App/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return NextResponse.json({ error: 'Trakt API timed out. Try syncing again — smaller batches will be retried.' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Network error contacting Trakt' }, { status: 502 });
  }
  clearTimeout(timeoutId);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '30', 10);
    return NextResponse.json({ error: 'Rate Limit Exceeded', retryAfter }, { status: 429 });
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    return NextResponse.json({ error: 'Sync failed', detail: errorText }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data);
}
