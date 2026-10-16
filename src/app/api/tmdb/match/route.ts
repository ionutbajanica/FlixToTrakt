import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { TmdbClient, sanitizeLanguage } from '@/lib/tmdb';
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
  const language = sanitizeLanguage(body.language);

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No entries supplied' }, { status: 400 });
  }

  const client = new TmdbClient(tmdbToken);

  try {
    const results = await Promise.all(
      entries.map(entry =>
        matchEntry(
          client,
          {
            ...entry,
            // Only ever a number or absent — it is interpolated into TMDB paths.
            showTmdbId: Number.isInteger(entry.showTmdbId) ? entry.showTmdbId : undefined,
            watchedBefore:
              typeof entry.watchedBefore === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.watchedBefore)
                ? entry.watchedBefore
                : undefined,
          },
          { language }
        )
      )
    );
    return NextResponse.json({ results });
  } catch (err) {
    console.error('TMDB match error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
