import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveTraktClientId } from '@/lib/trakt-server';

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const clientId = resolveTraktClientId(cookieStore);

  if (!clientId) {
    return NextResponse.json({ error: 'Missing Client ID' }, { status: 400 });
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
    // No client_secret: Trakt has deprecated it for user sign-in, which is
    // what lets every user share one project-owned Client ID.
    body: JSON.stringify({
      code: device_code,
      client_id: clientId,
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
      // Trakt access tokens last 7 days; expire the cookie with the token so a
      // stale one sends the user back through login instead of 401ing.
      maxAge: data.expires_in ?? 60 * 60 * 24 * 7
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
