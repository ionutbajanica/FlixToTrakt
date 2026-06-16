import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const { title } = await request.json();

  if (!title) {
    return NextResponse.json({ error: 'Title required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const clientId = cookieStore.get('trakt_client_id')?.value;
  const token = cookieStore.get('trakt_access_token')?.value;

  if (!clientId || !token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'trakt-api-version': '2',
    'trakt-api-key': clientId,
    'User-Agent': 'Trakt-Updater-App/1.0',
  };

  const parts = title.split(':').map((p: string) => p.trim());
  
  // 3-part title (Show: Season: Episode)
  if (parts.length >= 3) {
    const showName = parts[0];
    const seasonPart = parts[1];
    const episodeName = parts.slice(2).join(':').toLowerCase();
    
    const seasonMatch = seasonPart.match(/\d+/);
    if (seasonMatch) {
      const seasonNum = seasonMatch[0];
      
      // 1. Search for the show
      const showRes = await fetch(`https://api.trakt.tv/search/show?query=${encodeURIComponent(showName)}&limit=3`, { headers });
      if (showRes.ok) {
        const showData = await showRes.json();
        if (showData.length > 0) {
          const showSlug = showData[0].show.ids.slug;
          const showId = showData[0].show.ids.trakt;
          
          // 2. Fetch episodes for that season
          const epRes = await fetch(`https://api.trakt.tv/shows/${showSlug}/seasons/${seasonNum}/episodes`, { headers });
          if (epRes.ok) {
            const episodes = await epRes.json();
            
            // 3. Find the episode by name
            const matchedEp = episodes.find((ep: any) => ep.title && ep.title.toLowerCase() === episodeName);
            
            if (matchedEp) {
              return NextResponse.json([{
                type: 'episode',
                score: 100,
                episode: { ...matchedEp, showTitle: showData[0].show.title }
              }]);
            } else if (episodes.length > 0) {
              // Partial matching to sort the best suggestions
              const searchWords = episodeName.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 0);
              
              episodes.forEach((ep: any) => {
                ep._score = 0;
                if (!ep.title) return;
                const epTitle = ep.title.toLowerCase();
                
                // High score for direct substring
                if (epTitle.includes(episodeName) || episodeName.includes(epTitle)) {
                  ep._score = 50;
                } else {
                  // Score based on word overlap
                  const epWords = epTitle.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 0);
                  let matches = 0;
                  for (const w of searchWords) {
                    if (epWords.includes(w)) matches++;
                  }
                  ep._score = matches;
                }
              });

              episodes.sort((a: any, b: any) => b._score - a._score);

              // Return top 5 episodes for manual review based on partial match
              return NextResponse.json(episodes.slice(0, 5).map((ep: any) => ({
                type: 'episode',
                score: ep._score > 0 ? 75 : 50,
                episode: { ...ep, showTitle: showData[0].show.title }
              })));
            }
          }
        }
      }
    }
  }

  // Fallback to standard movie/show search
  const query = encodeURIComponent(title);
  let response = await fetch(`https://api.trakt.tv/search/movie,show?query=${query}&limit=5`, { headers });

  if (!response.ok) {
    return NextResponse.json({ error: 'Search failed' }, { status: response.status });
  }

  let data = await response.json();

  if (data.length === 0 && parts.length > 0) {
    const fallbackQuery = encodeURIComponent(parts[0]);
    const fallbackResponse = await fetch(`https://api.trakt.tv/search/movie,show?query=${fallbackQuery}&limit=5`, { headers });
    
    if (fallbackResponse.ok) {
      data = await fallbackResponse.json();
    }
  }

  return NextResponse.json(data);
}
