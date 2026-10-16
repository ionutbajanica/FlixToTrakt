import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { TmdbClient, sanitizeLanguage } from '@/lib/tmdb';
import { listEpisodeCandidates, searchCandidates } from '@/lib/tmdbMatch';

// Manual lookups for the export review UI: free-text search, or the episode
// list of a show the user has already identified.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const tmdbToken = cookieStore.get('tmdb_token')?.value;

  if (!tmdbToken) {
    return NextResponse.json({ error: 'Missing TMDB read access token' }, { status: 401 });
  }

  const body = await request.json();
  const client = new TmdbClient(tmdbToken);
  const language = sanitizeLanguage(body.language);

  try {
    if (body.showTmdbId) {
      const candidates = await listEpisodeCandidates(
        client,
        Number(body.showTmdbId),
        body.seasonNumber === undefined || body.seasonNumber === null ? undefined : Number(body.seasonNumber),
        body.episodeTitle || undefined,
        { language }
      );
      return NextResponse.json({ candidates });
    }

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    const candidates = await searchCandidates(client, query, { language });
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error('TMDB search error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
