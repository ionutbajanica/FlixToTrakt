import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { TmdbClient } from '@/lib/tmdb';
import { MatchRequestEntry, matchEntry } from '@/lib/tmdbMatch';

// Batch matcher for the export flow. TMDB only — no Trakt credentials needed.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const tmdbToken = cookieStore.get('tmdb_token')?.value;

  if (!tmdbToken) {
    return NextResponse.json({ error: 'Missing TMDB read access token' }, { status: 401 });
  }

  const body = await request.json();
  const entries: MatchRequestEntry[] = Array.isArray(body.entries) ? body.entries : [];

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No entries supplied' }, { status: 400 });
  }

  const client = new TmdbClient(tmdbToken);

  try {
    const results = await Promise.all(entries.map(entry => matchEntry(client, entry)));
    return NextResponse.json({ results });
  } catch (err) {
    console.error('TMDB match error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
