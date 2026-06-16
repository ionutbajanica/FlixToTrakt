import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const clientSecret = cookieStore.get('trakt_client_secret')?.value;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Missing Client credentials' }, { status: 400 });
  }

  const { device_code } = await req.json();
  if (!device_code) {
    return NextResponse.json({ error: 'Missing device code' }, { status: 400 });
  }

  const response = await fetch('https://api.trakt.tv/oauth/device/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'User-Agent': 'Trakt-Updater-App/1.0',
    },
    body: JSON.stringify({
      code: device_code,
      client_id: clientId,
      client_secret: clientSecret
    }),
  });

  const statusCode = response.status;
  
  if (statusCode === 200) {
    // Success! The user authorized the app.
    const data = await response.json();
    
    // Store tokens in cookies
    cookieStore.set('trakt_access_token', data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30 // 30 days
    });
    
    cookieStore.set('trakt_refresh_token', data.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90 // 90 days
    });

    return NextResponse.json({ success: true, status: 200 });
  } else if (statusCode === 400) {
    return NextResponse.json({ success: false, status: 400, message: 'Pending - waiting for user to authorize' }, { status: 400 });
  } else if (statusCode === 404) {
    return NextResponse.json({ success: false, status: 404, message: 'Not Found - invalid device code' }, { status: 404 });
  } else if (statusCode === 409) {
    return NextResponse.json({ success: false, status: 409, message: 'Already Used - user already authorized this code' }, { status: 409 });
  } else if (statusCode === 410) {
    return NextResponse.json({ success: false, status: 410, message: 'Expired - the device code has expired' }, { status: 410 });
  } else if (statusCode === 418) {
    return NextResponse.json({ success: false, status: 418, message: 'Denied - user explicitly denied this code' }, { status: 418 });
  } else if (statusCode === 429) {
    return NextResponse.json({ success: false, status: 429, message: 'Slow Down - polling too quickly' }, { status: 429 });
  } else {
    return NextResponse.json({ success: false, status: statusCode, message: 'Unknown error' }, { status: statusCode });
  }
}
