/**
 * Velorah Music Player — YouTube Search Serverless Endpoint for Vercel
 * Compatible with Node.js 18+ on Vercel Serverless Functions
 */

function sendJson(res, statusCode, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.statusCode = statusCode;
  if (typeof res.json === 'function') {
    return res.json(data);
  }
  return res.end(JSON.stringify(data));
}

function parseSec(str) {
  if (!str || str === 'LIVE') return 0;
  const parts = str.split(':');
  if (parts.length === 2) {
    return (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
  } else if (parts.length === 3) {
    return (parseInt(parts[0], 10) * 3600) + (parseInt(parts[1], 10) * 60) + parseInt(parts[2], 10);
  }
  return 0;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;
  const getBigrams = (str) => {
    const s = str.toLowerCase();
    const bigrams = new Set();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2));
    }
    return bigrams;
  };
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  for (const bg of b1) {
    if (b2.has(bg)) intersection++;
  }
  const total = b1.size + b2.size;
  return total === 0 ? 0 : Math.round((2.0 * intersection / total) * 100);
}

function normalizeSongTitle(str) {
  let c = (str || '').toLowerCase().replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, '').trim();
  const m = c.match(/^.+?[-:—|]\s*(.+)$/);
  if (m) {
    c = m[1].trim();
  }
  return c.replace(/[^a-z0-9 ]/gi, '').replace(/\s+/g, ' ').trim();
}

async function searchYTApi(searchQuery, limit = 8) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(6500)
    });
    if (!res.ok) return [];

    const html = await res.text();
    const match = html.match(/ytInitialData\s*=\s*({.+?});(?:\s*<\/script>|\s*var)/s);
    if (!match) return [];

    const data = JSON.parse(match[1]);
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    let contents = [];
    for (const section of sections) {
      if (section?.itemSectionRenderer?.contents) {
        contents = contents.concat(section.itemSectionRenderer.contents);
      }
    }

    const results = [];
    for (const item of contents) {
      if (item?.videoRenderer) {
        const v = item.videoRenderer;
        const id = v.videoId;
        if (!id) continue;

        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
        const channel = v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '';
        const duration = v.lengthText?.simpleText || '';
        let thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        if (Array.isArray(v.thumbnail?.thumbnails) && v.thumbnail.thumbnails.length > 0) {
          const lastThumb = v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1];
          if (lastThumb?.url) thumbnail = lastThumb.url;
        }

        results.push({
          id,
          title: decodeHtmlEntities(title),
          channel: decodeHtmlEntities(channel),
          duration,
          thumbnail
        });

        if (results.length >= limit) break;
      }
    }
    return results;
  } catch (err) {
    return [];
  }
}

function filterTrackPool(items, currentId, playedIds, currentSong) {
  const cleanCurrent = (currentSong || '').toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
  const filtered = [];
  const seen = new Set();

  for (const item of items) {
    const id = item.id;
    if (!id || id === currentId) continue;
    if (playedIds.includes(id)) continue;
    if (seen.has(id)) continue;

    const dur = parseSec(item.duration);
    if (dur > 900 || (dur > 0 && dur < 50)) continue;

    const t = (item.title || '').toLowerCase();
    if (/playlist|full\s*album|compilation|terbaik\s*\d+|1\s*jam|10\s*jam|1\s*hour|10\s*hours|looping|extended\s*version/i.test(t)) {
      continue;
    }

    if (cleanCurrent && cleanCurrent.length > 5) {
      const sim = stringSimilarity(cleanCurrent, t);
      if (sim > 70) continue;
    }

    seen.add(id);
    filtered.push(item);
  }
  return filtered;
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 200;
    return res.end();
  }

  // Parse query params safely
  let params = req.query;
  if (!params && req.url) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      params = Object.fromEntries(urlObj.searchParams);
    } catch (e) {
      params = {};
    }
  }
  params = params || {};

  const query = (params.q || '').trim();
  let relatedTo = (params.related_to || params.id || '').trim();
  const isRelated = Boolean(relatedTo || params.related === '1');

  if (!query && !relatedTo) {
    return sendJson(res, 200, {
      success: false,
      error: 'Query parameter "q" or "related_to" is required.',
      results: []
    });
  }

  // Detect video ID if provided
  let videoId = null;
  if (relatedTo && /^[a-zA-Z0-9_-]{11}$/.test(relatedTo)) {
    videoId = relatedTo;
  } else if (query) {
    const matchUrl = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (matchUrl) {
      videoId = matchUrl[1];
    } else if (/^[\w-]{11}$/.test(query)) {
      videoId = query;
    }
  }

  // =========================================================================
  // Case A: Fetch Related Tracks (Smart Recommendation: Same Artist & Genre)
  // =========================================================================
  if (isRelated && videoId) {
    const titleHint = (params.title || '').trim();
    const channelHint = (params.channel || '').trim();
    const playedParam = (params.played || '').trim();
    const playedIds = playedParam ? playedParam.split(',').map(s => s.trim()).filter(Boolean) : [];

    let cleanTitle = titleHint.replace(/[\(\[\{][^\)\]\}]*(?:official|lyric|video|audio|visualizer|mv|hq|hd|4k|remastered|ost|soundtrack|version)[^\)\]\}]*[\)\]\}]/gi, '');
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
    let artist = '';
    let song = '';

    const m = cleanTitle.match(/^(.+?)\s*[-:—|]\s*(.+)$/);
    if (m) {
      const p1 = m[1].trim();
      const p2 = m[2].trim();
      if (/soundtrack|theme/i.test(p1)) {
        const bm = p2.match(/by\s+(.+)$/i);
        if (bm) {
          artist = bm[1].trim();
          song = p1.replace(/soundtrack\s*(?:by.*)?/gi, '').trim();
        } else {
          song = p1;
          artist = p2;
        }
      } else {
        artist = p1;
        song = p2;
      }
    } else {
      song = cleanTitle;
      artist = channelHint;
    }

    artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').trim();
    if (!artist || artist.toLowerCase() === 'youtube' || artist.toLowerCase() === 'cinémavore') {
      if (channelHint && channelHint.toLowerCase() !== 'cinémavore') {
        artist = channelHint;
      }
    }

    // Genre classification
    const textForGenre = `${artist} ${song} ${titleHint}`.toLowerCase();
    let genreName = 'Similar Genre';
    let artistQuery = `${artist} official audio music songs`;
    let genreQuery = `${artist} similar artists popular music audio`;

    if (/hans zimmer|interstellar|inception|soundtrack|cinematic|film score|john williams|max richter|ludovico einaudi|gladiator|dune/i.test(textForGenre)) {
      genreName = 'Cinematic Soundtrack';
      artistQuery = `${artist} soundtrack official audio`;
      genreQuery = 'Max Richter Ludovico Einaudi cinematic soundtrack audio';
    } else if (/lofi|lo-fi|chillhop|chill beats|relaxing beats|study beats|lofi girl/i.test(textForGenre)) {
      genreName = 'Lofi Chill Beats';
      artistQuery = 'lofi hip hop beats to relax study audio';
      genreQuery = 'Kudasai Idealism Saib chillhop beats audio';
    } else if (/synthwave|retrowave|chillwave|synth|retro beats/i.test(textForGenre)) {
      genreName = 'Synthwave & Retrowave';
      artistQuery = 'synthwave chill synth music audio';
      genreQuery = 'The Midnight Kavinsky HOME Resonance synthwave audio';
    } else if (/ghibli|joe hisaishi|piano collection|relaxing piano|yiruma/i.test(textForGenre)) {
      genreName = 'Relaxing Piano & Ghibli';
      artistQuery = 'Joe Hisaishi Ghibli relaxing piano audio';
      genreQuery = 'Yiruma Ryuichi Sakamoto relaxing piano instrumental audio';
    } else if (/tulus|kunto aji|nadin amizah|fiersa besari|glenn fredly|pamungkas|yura yunita|ardhito|sal priadi|hindia|judika|raisa|afgan|idgitaf/i.test(textForGenre)) {
      genreName = 'Indonesian Pop & Acoustic';
      artistQuery = `${artist} official audio lagu hits`;
      genreQuery = 'kunto aji nadin amizah glenn fredly yura yunita audio';
    } else if (/niki|joji|keshi|beabadoobee|88rising|daniel caesar|laufey/i.test(textForGenre)) {
      genreName = 'Indie R&B & Bedroom Pop';
      artistQuery = `${artist} official audio songs`;
      genreQuery = 'Keshi Joji Laufey indie rb chill soul audio';
    }

    // Parallel fetch Pool A (Artist) and Pool B (Genre)
    const [rawArtist, rawGenre] = await Promise.all([
      artist ? searchYTApi(artistQuery, 7) : Promise.resolve([]),
      searchYTApi(genreQuery, 7)
    ]);

    const artistPool = filterTrackPool(rawArtist, videoId, playedIds, song);
    const genrePool = filterTrackPool(rawGenre, videoId, playedIds, song);

    // Interleave
    const finalItems = [];
    const usedIds = new Set();
    const usedTitles = [];

    const maxCount = Math.max(artistPool.length, genrePool.length);
    for (let i = 0; i < maxCount; i++) {
      if (artistPool[i]) {
        const t = artistPool[i];
        if (!usedIds.has(t.id)) {
          const tNorm = normalizeSongTitle(t.title);
          const dup = usedTitles.some(ut => stringSimilarity(tNorm, ut) > 65);
          if (!dup) {
            usedIds.add(t.id);
            usedTitles.push(tNorm);
            t.relation_type = 'same_artist';
            t.relation_label = `Same Artist (${artist})`;
            finalItems.push(t);
          }
        }
      }
      if (genrePool[i]) {
        const t = genrePool[i];
        if (!usedIds.has(t.id)) {
          const tNorm = normalizeSongTitle(t.title);
          const dup = usedTitles.some(ut => stringSimilarity(tNorm, ut) > 65);
          if (!dup) {
            usedIds.add(t.id);
            usedTitles.push(tNorm);
            t.relation_type = 'same_genre';
            t.relation_label = `Same Genre (${genreName})`;
            finalItems.push(t);
          }
        }
      }
    }

    // Fallback if empty
    if (finalItems.length === 0) {
      const fallbackRaw = await searchYTApi(`${cleanTitle} audio music`, 6);
      const fallbackFiltered = filterTrackPool(fallbackRaw, videoId, playedIds, song);
      for (const item of fallbackFiltered) {
        item.relation_type = 'related';
        item.relation_label = 'Related Track';
        finalItems.push(item);
      }
    }

    return sendJson(res, 200, {
      success: finalItems.length > 0,
      is_related: true,
      related_to: videoId,
      artist,
      genre: genreName,
      results: finalItems
    });
  }

  // =========================================================================
  // Case B: Single Direct Video Lookup
  // =========================================================================
  if (videoId) {
    let title = 'YouTube Music Track';
    let channel = 'YouTube';

    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, {
        signal: AbortSignal.timeout(5000)
      });
      if (oembedRes.ok) {
        const meta = await oembedRes.json();
        if (meta?.title) title = meta.title;
        if (meta?.author_name) channel = meta.author_name;
      }
    } catch (e) {}

    return sendJson(res, 200, {
      success: true,
      results: [
        {
          id: videoId,
          title,
          channel,
          duration: '',
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        }
      ]
    });
  }

  // =========================================================================
  // Case C: Standard YouTube Search Query
  // =========================================================================
  const items = await searchYTApi(`${query} audio music`, 12);

  if (items.length === 0) {
    let suggestions = [];
    try {
      const sugRes = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(4000)
      });
      if (sugRes.ok) {
        const parsed = await sugRes.json();
        if (Array.isArray(parsed?.[1])) {
          suggestions = parsed[1].slice(0, 6);
        }
      }
    } catch (e) {}

    return sendJson(res, 200, {
      success: false,
      results: [],
      suggestions,
      fallbackQuery: query
    });
  }

  return sendJson(res, 200, {
    success: true,
    query,
    results: items
  });
};
