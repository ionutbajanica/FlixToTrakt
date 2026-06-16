import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;

  if (!clientId) {
    return NextResponse.json({ error: 'Missing Client ID' }, { status: 400 });
  }

  const response = await fetch('https://api.trakt.tv/oauth/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'User-Agent': 'Trakt-Updater-App/1.0',
    },
    body: JSON.stringify({ client_id: clientId }),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json({ error: 'Failed to generate device code', details: text }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data);
}
