<?php
/**
 * Velorah Music Player — YouTube Search Endpoint
 * Compatible with PHP 5.6+ and PHP 7/8
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$query = isset($_GET['q']) ? trim($_GET['q']) : '';
$relatedTo = isset($_GET['related_to']) ? trim($_GET['related_to']) : '';
if (empty($relatedTo) && isset($_GET['id'])) {
    $relatedTo = trim($_GET['id']);
}
$isRelated = !empty($relatedTo) || (isset($_GET['related']) && $_GET['related'] == '1');

if (empty($query) && empty($relatedTo)) {
    echo json_encode(array('success' => false, 'error' => 'Query parameter "q" or "related_to" is required.', 'results' => array()));
    exit;
}

// 1. Detect video ID if provided
$videoId = null;
if (!empty($relatedTo) && preg_match('/^[a-zA-Z0-9_-]{11}$/', $relatedTo)) {
    $videoId = $relatedTo;
} elseif (!empty($query)) {
    if (preg_match('/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/', $query, $matches)) {
        $videoId = $matches[1];
    } elseif (preg_match('/^[\w-]{11}$/', $query)) {
        $videoId = $query;
    }
}

// =========================================================================
// Case A: Fetch Related Tracks (Smart Recommendation: Same Artist & Same Genre)
// =========================================================================
if ($isRelated && $videoId) {
    $titleHint = isset($_GET['title']) ? trim($_GET['title']) : '';
    $channelHint = isset($_GET['channel']) ? trim($_GET['channel']) : '';
    $playedParam = isset($_GET['played']) ? trim($_GET['played']) : '';
    $playedIds = !empty($playedParam) ? array_filter(array_map('trim', explode(',', $playedParam))) : array();

    function parseSec($str) {
        if (empty($str) || $str === 'LIVE') return 0;
        $parts = explode(':', $str);
        if (count($parts) === 2) {
            return ((int)$parts[0] * 60) + (int)$parts[1];
        } elseif (count($parts) === 3) {
            return ((int)$parts[0] * 3600) + ((int)$parts[1] * 60) + (int)$parts[2];
        }
        return 0;
    }

    function searchYTApi($searchQuery, $limit = 8) {
        $url = 'https://www.youtube.com/results?search_query=' . urlencode($searchQuery);
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
        curl_setopt($ch, CURLOPT_TIMEOUT, 6);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Accept-Language: en-US,en;q=0.9,id;q=0.8', 'Cache-Control: no-cache'));
        $html = curl_exec($ch);
        curl_close($ch);

        $results = array();
        if ($html && preg_match('/ytInitialData[ \t]*=[ \t]*({.+?});(?:<\/script>|var)/s', $html, $matches)) {
            $data = json_decode($matches[1], true);
            $contents = array();
            if (isset($data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'])) {
                foreach ($data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'] as $section) {
                    if (isset($section['itemSectionRenderer']['contents'])) {
                        $contents = array_merge($contents, $section['itemSectionRenderer']['contents']);
                    }
                }
            }
            foreach ($contents as $item) {
                if (isset($item['videoRenderer'])) {
                    $v = $item['videoRenderer'];
                    $id = isset($v['videoId']) ? $v['videoId'] : '';
                    if (empty($id)) continue;

                    $title = isset($v['title']['runs'][0]['text']) ? $v['title']['runs'][0]['text'] : (isset($v['title']['simpleText']) ? $v['title']['simpleText'] : '');
                    $channel = isset($v['ownerText']['runs'][0]['text']) ? $v['ownerText']['runs'][0]['text'] : (isset($v['shortBylineText']['runs'][0]['text']) ? $v['shortBylineText']['runs'][0]['text'] : '');
                    $duration = isset($v['lengthText']['simpleText']) ? $v['lengthText']['simpleText'] : '';
                    $thumb = "https://i.ytimg.com/vi/{$id}/hqdefault.jpg";
                    if (isset($v['thumbnail']['thumbnails']) && is_array($v['thumbnail']['thumbnails'])) {
                        $last = end($v['thumbnail']['thumbnails']);
                        if (isset($last['url'])) $thumb = $last['url'];
                    }

                    $results[] = array(
                        'id' => $id,
                        'title' => html_entity_decode($title, ENT_QUOTES, 'UTF-8'),
                        'channel' => html_entity_decode($channel, ENT_QUOTES, 'UTF-8'),
                        'duration' => $duration,
                        'thumbnail' => $thumb
                    );
                    if (count($results) >= $limit) break;
                }
            }
        }
        return $results;
    }

    // 1. Clean artist and song title
    $cleanTitle = preg_replace('/[\(\[\{][^\)\]\}]*(?:official|lyric|video|audio|visualizer|mv|hq|hd|4k|remastered|ost|soundtrack|version)[^\)\]\}]*[\)\]\}]/i', '', $titleHint);
    $cleanTitle = trim(preg_replace('/\s+/', ' ', $cleanTitle));
    $artist = '';
    $song = '';

    if (preg_match('/^(.+?)\s*[-:—|]\s*(.+)$/u', $cleanTitle, $m)) {
        $p1 = trim($m[1]);
        $p2 = trim($m[2]);
        if (stripos($p1, 'soundtrack') !== false || stripos($p1, 'theme') !== false) {
            if (preg_match('/by\s+(.+)$/i', $p2, $bm)) {
                $artist = trim($bm[1]);
                $song = trim(preg_replace('/soundtrack\s*(?:by.*)?/i', '', $p1));
            } else {
                $song = $p1;
                $artist = $p2;
            }
        } else {
            $artist = $p1;
            $song = $p2;
        }
    } else {
        $song = $cleanTitle;
        $artist = $channelHint;
    }

    $artist = preg_replace('/\s*-\s*Topic$/i', '', $artist);
    $artist = preg_replace('/\s*VEVO$/i', '', $artist);
    $artist = trim($artist);
    if (empty($artist) || strtolower($artist) === 'youtube' || strtolower($artist) === 'cinémavore') {
        if (!empty($channelHint) && strtolower($channelHint) !== 'cinémavore') {
            $artist = $channelHint;
        }
    }

    // 2. Detect musical genre and smart queries
    $textForGenre = strtolower($artist . ' ' . $song . ' ' . $titleHint);
    $genreName = 'Similar Genre';
    $artistQuery = "{$artist} official audio music songs";
    $genreQuery = "{$artist} similar artists popular music audio";

    if (preg_match('/hans zimmer|interstellar|inception|soundtrack|cinematic|film score|john williams|max richter|ludovico einaudi|gladiator|dune/i', $textForGenre)) {
        $genreName = 'Cinematic Soundtrack';
        $artistQuery = "{$artist} soundtrack official audio";
        $genreQuery = "Max Richter Ludovico Einaudi cinematic soundtrack audio";
    } elseif (preg_match('/lofi|lo-fi|chillhop|chill beats|relaxing beats|study beats|lofi girl/i', $textForGenre)) {
        $genreName = 'Lofi Chill Beats';
        $artistQuery = "lofi hip hop beats to relax study audio";
        $genreQuery = "Kudasai Idealism Saib chillhop beats audio";
    } elseif (preg_match('/synthwave|retrowave|chillwave|synth|retro beats/i', $textForGenre)) {
        $genreName = 'Synthwave & Retrowave';
        $artistQuery = "synthwave chill synth music audio";
        $genreQuery = "The Midnight Kavinsky HOME Resonance synthwave audio";
    } elseif (preg_match('/ghibli|joe hisaishi|piano collection|relaxing piano|yiruma/i', $textForGenre)) {
        $genreName = 'Relaxing Piano & Ghibli';
        $artistQuery = "Joe Hisaishi Ghibli relaxing piano audio";
        $genreQuery = "Yiruma Ryuichi Sakamoto relaxing piano instrumental audio";
    } elseif (preg_match('/tulus|kunto aji|nadin amizah|fiersa besari|glenn fredly|pamungkas|yura yunita|ardhito|sal priadi|hindia|judika|raisa|afgan|idgitaf/i', $textForGenre)) {
        $genreName = 'Indonesian Pop & Acoustic';
        $artistQuery = "{$artist} official audio lagu hits";
        $genreQuery = "kunto aji nadin amizah glenn fredly yura yunita audio";
    } elseif (preg_match('/niki|joji|keshi|beabadoobee|88rising|daniel caesar|laufey/i', $textForGenre)) {
        $genreName = 'Indie R&B & Bedroom Pop';
        $artistQuery = "{$artist} official audio songs";
        $genreQuery = "Keshi Joji Laufey indie rb chill soul audio";
    }

    // 3. Search Pool A (Same Artist) and Pool B (Same Genre)
    $rawArtist = !empty($artist) ? searchYTApi($artistQuery, 7) : array();
    $rawGenre = searchYTApi($genreQuery, 7);

    // 4. Filter & Deduplicate
    function filterTrackPool($items, $currentId, $playedIds, $currentSong) {
        $cleanCurrent = strtolower(trim(preg_replace('/[\(\[\{].*?[\)\]\}]/', '', $currentSong)));
        $filtered = array();
        $seen = array();

        foreach ($items as $item) {
            $id = $item['id'];
            if ($id === $currentId) continue;
            if (in_array($id, $playedIds)) continue;
            if (isset($seen[$id])) continue;

            $dur = parseSec($item['duration']);
            if ($dur > 900 || ($dur > 0 && $dur < 50)) continue;

            $t = strtolower($item['title']);
            if (preg_match('/playlist|full\s*album|compilation|terbaik\s*\d+|1\s*jam|10\s*jam|1\s*hour|10\s*hours|looping|extended\s*version/i', $t)) {
                continue;
            }

            // Exclude if song title is virtually identical to current playing song
            if (!empty($cleanCurrent) && strlen($cleanCurrent) > 5) {
                similar_text($cleanCurrent, $t, $sim);
                if ($sim > 70) continue;
            }

            $seen[$id] = true;
            $filtered[] = $item;
        }
        return $filtered;
    }

    $artistPool = filterTrackPool($rawArtist, $videoId, $playedIds, $song);
    $genrePool = filterTrackPool($rawGenre, $videoId, $playedIds, $song);

    // 5. Interleave: Alternate between Same Artist and Same Genre
    $finalItems = array();
    $usedIds = array();
    $usedTitles = array();

    function normalizeSongTitle($str) {
        $c = strtolower(trim(preg_replace('/[\(\[\{][^\)\]\}]*[\)\]\}]/', '', $str)));
        if (preg_match('/^.+?[-:—|]\s*(.+)$/u', $c, $m)) {
            $c = trim($m[1]);
        }
        return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9 ]/i', '', $c)));
    }

    $maxCount = max(count($artistPool), count($genrePool));
    for ($i = 0; $i < $maxCount; $i++) {
        // Same Artist
        if (isset($artistPool[$i])) {
            $t = $artistPool[$i];
            if (!isset($usedIds[$t['id']])) {
                $tNorm = normalizeSongTitle($t['title']);
                $dup = false;
                foreach ($usedTitles as $ut) {
                    similar_text($tNorm, $ut, $sim);
                    if ($sim > 65) { $dup = true; break; }
                }
                if (!$dup) {
                    $usedIds[$t['id']] = true;
                    $usedTitles[] = $tNorm;
                    $t['relation_type'] = 'same_artist';
                    $t['relation_label'] = 'Same Artist (' . $artist . ')';
                    $finalItems[] = $t;
                }
            }
        }
        // Same Genre
        if (isset($genrePool[$i])) {
            $t = $genrePool[$i];
            if (!isset($usedIds[$t['id']])) {
                $tNorm = normalizeSongTitle($t['title']);
                $dup = false;
                foreach ($usedTitles as $ut) {
                    similar_text($tNorm, $ut, $sim);
                    if ($sim > 65) { $dup = true; break; }
                }
                if (!$dup) {
                    $usedIds[$t['id']] = true;
                    $usedTitles[] = $tNorm;
                    $t['relation_type'] = 'same_genre';
                    $t['relation_label'] = 'Same Genre (' . $genreName . ')';
                    $finalItems[] = $t;
                }
            }
        }
    }

    // Fallback: If pool is empty, perform general related query
    if (empty($finalItems)) {
        $fallbackRaw = searchYTApi("{$cleanTitle} audio music", 6);
        $finalItems = filterTrackPool($fallbackRaw, $videoId, $playedIds, $song);
        foreach ($finalItems as &$fi) {
            $fi['relation_type'] = 'related';
            $fi['relation_label'] = 'Related Track';
        }
    }

    echo json_encode(array(
        'success' => !empty($finalItems),
        'is_related' => true,
        'related_to' => $videoId,
        'artist' => $artist,
        'genre' => $genreName,
        'results' => $finalItems
    ));
    exit;
}

// =========================================================================
// Case B: Single Direct Video Lookup
// =========================================================================
if ($videoId) {
    // Single video lookup via oEmbed
    $oembedUrl = 'https://www.youtube.com/oembed?url=' . urlencode("https://www.youtube.com/watch?v={$videoId}") . '&format=json';
    $ch = curl_init($oembedUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $title = 'YouTube Music Track';
    $channel = 'YouTube';

    if ($httpCode === 200 && $response) {
        $meta = json_decode($response, true);
        if ($meta && isset($meta['title'])) {
            $title = $meta['title'];
            $channel = isset($meta['author_name']) ? $meta['author_name'] : 'YouTube';
        }
    }

    echo json_encode(array(
        'success' => true,
        'results' => array(
            array(
                'id' => $videoId,
                'title' => $title,
                'channel' => $channel,
                'duration' => '',
                'thumbnail' => "https://i.ytimg.com/vi/{$videoId}/hqdefault.jpg"
            )
        )
    ));
    exit;
}

// 2. Perform YouTube Search Query Scraping
$searchUrl = 'https://www.youtube.com/results?search_query=' . urlencode($query . ' audio music');

$ch = curl_init($searchUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
curl_setopt($ch, CURLOPT_TIMEOUT, 6);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_HTTPHEADER, array(
    'Accept-Language: en-US,en;q=0.9,id;q=0.8',
    'Cache-Control: no-cache'
));
$html = curl_exec($ch);
curl_close($ch);

$items = array();

if ($html && preg_match('/ytInitialData[ \t]*=[ \t]*({.+?});(?:<\/script>|var)/s', $html, $matches)) {
    $data = json_decode($matches[1], true);
    
    // Navigate YouTube JSON structure safely
    $contents = array();
    if (isset($data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'])) {
        foreach ($data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'] as $section) {
            if (isset($section['itemSectionRenderer']['contents'])) {
                $contents = array_merge($contents, $section['itemSectionRenderer']['contents']);
            }
        }
    }

    foreach ($contents as $item) {
        if (isset($item['videoRenderer'])) {
            $v = $item['videoRenderer'];
            $id = isset($v['videoId']) ? $v['videoId'] : '';
            if (empty($id)) continue;

            $title = '';
            if (isset($v['title']['runs'][0]['text'])) {
                $title = $v['title']['runs'][0]['text'];
            } elseif (isset($v['title']['simpleText'])) {
                $title = $v['title']['simpleText'];
            }

            $channel = '';
            if (isset($v['ownerText']['runs'][0]['text'])) {
                $channel = $v['ownerText']['runs'][0]['text'];
            } elseif (isset($v['shortBylineText']['runs'][0]['text'])) {
                $channel = $v['shortBylineText']['runs'][0]['text'];
            }

            $duration = '';
            if (isset($v['lengthText']['simpleText'])) {
                $duration = $v['lengthText']['simpleText'];
            }

            // High quality thumbnail
            $thumbnail = "https://i.ytimg.com/vi/{$id}/hqdefault.jpg";
            if (isset($v['thumbnail']['thumbnails']) && is_array($v['thumbnail']['thumbnails'])) {
                $lastThumb = end($v['thumbnail']['thumbnails']);
                if (isset($lastThumb['url'])) {
                    $thumbnail = $lastThumb['url'];
                }
            }

            $items[] = array(
                'id' => $id,
                'title' => html_entity_decode($title, ENT_QUOTES, 'UTF-8'),
                'channel' => html_entity_decode($channel, ENT_QUOTES, 'UTF-8'),
                'duration' => $duration,
                'thumbnail' => $thumbnail
            );

            if (count($items) >= 12) {
                break;
            }
        }
    }
}

// Fallback if scraping yielded no items (e.g. YouTube bot check)
if (empty($items)) {
    // Provide search suggestions based on query
    $suggestUrl = 'https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=' . urlencode($query);
    $ch = curl_init($suggestUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 4);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $suggestJson = curl_exec($ch);
    curl_close($ch);

    $suggestions = array();
    if ($suggestJson) {
        $parsed = json_decode($suggestJson, true);
        if (isset($parsed[1]) && is_array($parsed[1])) {
            $suggestions = array_slice($parsed[1], 0, 6);
        }
    }

    echo json_encode(array(
        'success' => false,
        'results' => array(),
        'suggestions' => $suggestions,
        'fallbackQuery' => $query
    ));
    exit;
}

echo json_encode(array(
    'success' => true,
    'query' => $query,
    'results' => $items
));
