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

    let watchedAt;
    try {
      const parsedDate = new Date(item.date);
      if (!isNaN(parsedDate.getTime())) {
        watchedAt = parsedDate.toISOString();
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
    }
  }

  const response = await fetch('https://api.trakt.tv/sync/history', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'User-Agent': 'Trakt-Updater-App/1.0',
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'Sync failed' }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data);
}
