/**
 * Velorah® — Cinematic Landing Page & YouTube Music Player
 */

// 1. Curated Initial Aesthetic Tracks (Track 0 has exact duration for real-time timer)
const CURATED_PLAYLIST = [
  {
    id: 'UDVtMYqUAyw',
    title: 'Interstellar Main Theme - Soundtrack by Hans Zimmer',
    channel: 'Cinémavore',
    duration: '12:56',
    thumbnail: 'https://i.ytimg.com/vi/UDVtMYqUAyw/hqdefault.jpg'
  },
  {
    id: '7nhA9Om_fS4',
    title: 'TULUS - Hati-Hati di Jalan (Official Lyric Video)',
    channel: 'Tulus',
    duration: '4:02',
    thumbnail: 'https://i.ytimg.com/vi/7nhA9Om_fS4/hqdefault.jpg'
  },
  {
    id: 'p3K81J2t9bY',
    title: 'NIKI - Every Summertime (Official Video)',
    channel: 'NIKI',
    duration: '3:36',
    thumbnail: 'https://i.ytimg.com/vi/p3K81J2t9bY/hqdefault.jpg'
  },
  {
    id: 'e6jRks6Kq0M',
    title: 'Studio Ghibli Relaxing Piano Collection',
    channel: 'Relax Music',
    duration: '1:30:15',
    thumbnail: 'https://i.ytimg.com/vi/e6jRks6Kq0M/hqdefault.jpg'
  },
  {
    id: '4xDzrJKXOOY',
    title: 'synthwave radio - chill synth / retro beats',
    channel: 'Lofi Girl',
    duration: 'LIVE',
    thumbnail: 'https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg'
  },
  {
    id: 'jfKfPfyJRdk',
    title: 'lofi hip hop radio - beats to relax/study to',
    channel: 'Lofi Girl',
    duration: 'LIVE',
    thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg'
  }
];

// Queue Storage Persistence (Cache via localStorage + Cookies)
const QUEUE_STORAGE_KEY = 'tmusic_playback_queue';

function getStoredQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}

  // Fallback / sync from Cookies
  try {
    const name = QUEUE_STORAGE_KEY + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(name) === 0) {
        const val = c.substring(name.length, c.length);
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch (e) {}

  return [];
}

function saveQueueToStorage(queueItems) {
  const data = Array.isArray(queueItems) ? queueItems : [];
  const jsonStr = JSON.stringify(data);

  // 1. Client Cache: localStorage
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, jsonStr);
  } catch (e) {}

  // 2. Client Cookie: 30-day cookie (max 15 items to avoid HTTP header overflow)
  try {
    const cookieData = JSON.stringify(data.slice(0, 15));
    const d = new Date();
    d.setTime(d.getTime() + (30 * 24 * 60 * 60 * 1000));
    document.cookie = `${QUEUE_STORAGE_KEY}=${encodeURIComponent(cookieData)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  } catch (e) {}
}

let playlist = [...CURATED_PLAYLIST];
let musicQueue = getStoredQueue();
let currentTrackIndex = 0;
let ytPlayer = null;
let isPlayerReady = false;
let isPlaying = false;
let autoPlayOnReady = false;
let progressTimer = null;
let playbackStartTime = null;
let currentSeconds = 0;
let lastVolume = 80;
let isTransitioningTrack = false;
let isAutoplayQueueEnabled = true;
try {
  const savedAutoplay = localStorage.getItem('tmusic_autoplay_queue');
  if (savedAutoplay !== null) {
    isAutoplayQueueEnabled = (savedAutoplay === 'true');
  }
} catch (e) {}

// Mobile Device Detection for Adaptive Streaming & Performance Optimization
const isMobileDevice = (typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) || (typeof window !== 'undefined' && window.innerWidth <= 768);

// Network Connection-Aware Quality Selection for mobile devices
// Uses navigator.connection API (Chrome Android, Mi Browser) to detect 2G/3G/4G/WiFi
function getConnectionAwareQuality() {
  if (!isMobileDevice) return 'auto';
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      const type = conn.effectiveType; // 'slow-2g', '2g', '3g', '4g'
      const downlink = conn.downlink; // Mbps estimate
      const saveData = conn.saveData; // User opted into data-saving
      if (saveData || type === 'slow-2g' || type === '2g') return 'tiny';
      if (type === '3g' || (downlink && downlink < 1.5)) return 'small';
      if (type === '4g' && downlink && downlink < 5) return 'medium';
      if (type === '4g' && downlink && downlink >= 5) return 'large';
    }
  } catch (e) {}
  return 'medium'; // Safe default for mobile
}

// Detect if device has limited hardware decoder capacity (most phones have 1-2 HW decoders)
const isLowEndDevice = isMobileDevice && (typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ? navigator.hardwareConcurrency <= 4 : true));

let videoMode = 'default';
try {
  const savedMode = localStorage.getItem('tmusic_video_mode');
  if (savedMode === 'video' || savedMode === 'default') {
    videoMode = savedMode;
  }
} catch (e) {}

function setVideoMode(mode, silent = false) {
  videoMode = mode;
  try {
    localStorage.setItem('tmusic_video_mode', mode);
  } catch (e) {}

  const heroVideo = document.getElementById('hero-video');
  const ytBackdrop = document.getElementById('yt-video-backdrop');
  const switchBtns = document.querySelectorAll('.switch-video-btn');

  switchBtns.forEach(btn => {
    if (btn.getAttribute('data-mode') === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (mode === 'video') {
    // 1. Pause ambient background video completely to free GPU decoder & network bandwidth
    if (heroVideo) {
      heroVideo.classList.add('is-hidden');
      try { heroVideo.pause(); } catch (e) {}
    }
    if (ytBackdrop) {
      ytBackdrop.classList.remove('hidden-backdrop');
      ytBackdrop.classList.add('active-backdrop');
    }

    // 2. Restore video stream quality for active video viewing
    if (isPlayerReady && ytPlayer) {
      try {
        const targetQ = (videoQuality && videoQuality !== 'auto') ? videoQuality : (isMobileDevice ? 'medium' : 'default');
        ytPlayer.setPlaybackQuality(targetQ);
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('small', (targetQ === 'default' ? (isMobileDevice ? 'hd720' : 'highres') : targetQ));
        }
      } catch (e) {}
    }

    if (!silent) showToast('🎬 Video Mode: Memutar video klip YouTube');
  } else {
    // 1. Resume ambient background video
    if (heroVideo) {
      heroVideo.classList.remove('is-hidden');
      try { heroVideo.play().catch(() => {}); } catch (e) {}
    }
    if (ytBackdrop) {
      ytBackdrop.classList.remove('active-backdrop');
      ytBackdrop.classList.add('hidden-backdrop');
    }

    // 2. Optimization for Default Mode:
    // In ambient mode, the YouTube video is hidden behind ambient background.
    // Set YouTube video stream to 'tiny' (144p) to reduce bandwidth by 95% and eliminate mobile buffer stalls!
    if (isPlayerReady && ytPlayer) {
      try {
        ytPlayer.setPlaybackQuality('tiny');
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('tiny', 'small');
        }
      } catch (e) {}
    }

    if (!silent) showToast('🌌 Default Mode: Video ambient background (Hemat Data)');
  }
}

// Video Quality State & Functions
let videoQuality = isMobileDevice ? 'medium' : 'auto'; // 'auto', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'
let actualQuality = 'auto';
try {
  const savedQuality = localStorage.getItem('tmusic_video_quality');
  if (savedQuality) {
    videoQuality = savedQuality;
  }
} catch (e) {}

const QUALITY_INFO_MAP = {
  'auto': { name: 'Auto', badge: 'Auto', desc: 'Otomatis' },
  'hd1080': { name: '1080p HD', badge: '1080p', desc: 'Full HD' },
  'hd720': { name: '720p HD', badge: '720p', desc: 'HD' },
  'large': { name: '480p', badge: '480p', desc: 'SD' },
  'medium': { name: '360p', badge: '360p', desc: 'Medium' },
  'small': { name: '240p', badge: '240p', desc: 'Low' },
  'tiny': { name: '144p', badge: '144p', desc: 'Data Saver' },
  'highres': { name: '4K / 2K', badge: '4K', desc: 'Ultra HD' }
};

function updateQualityBadges() {
  const qInfo = QUALITY_INFO_MAP[videoQuality] || { badge: videoQuality, name: videoQuality };
  document.querySelectorAll('.quality-display-badge').forEach(badge => {
    badge.textContent = qInfo.badge;
  });

  // Update active state on modal quality options
  document.querySelectorAll('.quality-opt-btn').forEach(btn => {
    if (btn.getAttribute('data-quality') === videoQuality) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update active state on visualizer setting quick pills
  document.querySelectorAll('.viz-quality-pill').forEach(btn => {
    if (btn.getAttribute('data-quality') === videoQuality) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const streamInfoEl = document.getElementById('active-stream-quality-info');
  if (streamInfoEl) {
    const act = QUALITY_INFO_MAP[actualQuality] ? QUALITY_INFO_MAP[actualQuality].name : actualQuality;
    const actBadge = (actualQuality && actualQuality !== 'auto') 
      ? ` (Aktif: <strong class="text-cyan-300">${act}</strong>)` 
      : '';
    streamInfoEl.innerHTML = `Pilihan: <strong>${qInfo.name}</strong>${actBadge}`;
  }
}

function setVideoQuality(quality, silent = false) {
  videoQuality = quality;
  try {
    localStorage.setItem('tmusic_video_quality', quality);
  } catch (e) {}

  if (isPlayerReady && ytPlayer) {
    try {
      if (videoMode === 'default') {
        // In default mode, YouTube video is hidden behind ambient background; keep on tiny (144p) to eliminate stalls
        ytPlayer.setPlaybackQuality('tiny');
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('tiny', 'small');
        }
      } else if (quality === 'auto') {
        if (typeof ytPlayer.setPlaybackQuality === 'function') {
          ytPlayer.setPlaybackQuality('default');
        }
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('small', isMobileDevice ? 'hd720' : 'highres');
        }
      } else {
        if (typeof ytPlayer.setPlaybackQuality === 'function') {
          ytPlayer.setPlaybackQuality(quality);
        }
        // Adaptive range: allows gracefully dipping down to 'small' if mobile bandwidth drops, preventing hard freezes
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('small', quality);
        }
      }
    } catch (e) {
      console.warn('Failed setting playback quality:', e);
    }
  }

  updateQualityBadges();

  if (!silent) {
    const qName = QUALITY_INFO_MAP[quality] ? QUALITY_INFO_MAP[quality].name : quality;
    showToast(`🎥 Kualitas Video: ${qName}`);
  }
}

function openQualityModal() {
  const modal = document.getElementById('video-quality-modal');
  if (modal) {
    if (isPlayerReady && ytPlayer && typeof ytPlayer.getPlaybackQuality === 'function') {
      try {
        actualQuality = ytPlayer.getPlaybackQuality() || 'auto';
      } catch (e) {}
    }
    updateQualityBadges();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeQualityModal() {
  const modal = document.getElementById('video-quality-modal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// Format seconds into MM:SS or H:MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const secPadded = secs < 10 ? `0${secs}` : `${secs}`;

  if (hrs > 0) {
    const minPadded = mins < 10 ? `0${mins}` : `${mins}`;
    return `${hrs}:${minPadded}:${secPadded}`;
  }
  return `${mins}:${secPadded}`;
}

// Convert "MM:SS" or "H:MM:SS" string to seconds
function parseDurationToSeconds(str) {
  if (!str || typeof str !== 'string' || str === 'LIVE') return 0;
  const parts = str.split(':').map(val => parseInt(val.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return (parts[0] * 60) + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  return 0;
}

// 2. YouTube IFrame API Global Callback & Cross-Browser Initialization (with Mi Browser Fallback)
let isPlayerInitializing = false;
let pendingTrackToPlay = null;

function initYouTubePlayer() {
  if (ytPlayer || isPlayerInitializing || !window.YT || !window.YT.Player) return;
  isPlayerInitializing = true;

  const current = playlist[currentTrackIndex] || CURATED_PLAYLIST[0];

  let playerOrigin = undefined;
  try {
    if (window.location && window.location.protocol && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
      playerOrigin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
    }
  } catch (e) {}

  const playerVars = {
    autoplay: 0,
    controls: 0,
    disablekb: 1,
    enablejsapi: 1,
    fs: 0,
    playsinline: 1,
    rel: 0,
    modestbranding: 1,
    iv_load_policy: 3,
    cc_load_policy: 0,
    cc_lang_pref: 'none'
  };

  if (playerOrigin && playerOrigin !== 'null') {
    playerVars.origin = playerOrigin;
  }

  try {
    // Note: host: 'https://www.youtube-nocookie.com' bypasses strict third-party cookie blocking in Mi Browser and Brave
    ytPlayer = new YT.Player('yt-player-container', {
      host: 'https://www.youtube-nocookie.com',
      height: '100%',
      width: '100%',
      videoId: current.id,
      playerVars: playerVars,
      events: {
        onReady: onYTPlayerReady,
        onStateChange: onYTPlayerStateChange,
        onPlaybackQualityChange: onYTPlaybackQualityChange,
        onApiChange: onYTApiChange,
        onError: onYTPlayerError
      }
    });
  } catch (err) {
    console.warn('Failed to create YT.Player, activating direct fallback:', err);
    isPlayerInitializing = false;
    createDirectIframeFallback(current.id);
  }
}

// Direct Iframe Fallback: Guaranteed playback for Mi Browser, strict AdBlockers, or when window.YT fails to load
function createDirectIframeFallback(videoId) {
  if (ytPlayer && !ytPlayer.isFallback) return;
  const container = document.getElementById('yt-player-container');
  if (!container) return;

  const currentTrack = playlist[currentTrackIndex] || CURATED_PLAYLIST[0];
  const targetId = videoId || currentTrack.id;

  let origin = '';
  try {
    if (window.location && window.location.protocol && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
      origin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
    }
  } catch (e) {}

  const originParam = origin ? `&origin=${encodeURIComponent(origin)}` : '';
  // Mi Browser fix: controls=1 required for some Mi Browser builds to allow autoplay;
  // mute=1 ensures autoplay policy compliance on first load (unmuted via postMessage after gesture)
  const iframeSrc = `https://www.youtube-nocookie.com/embed/${targetId}?enablejsapi=1&autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=1&mute=0&iv_load_policy=3&cc_load_policy=0${originParam}`;

  container.innerHTML = `
    <iframe
      id="yt-direct-iframe"
      src="${iframeSrc}"
      style="width: 100%; height: 100%; border: none;"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen="true"
      referrerpolicy="strict-origin-when-cross-origin">
    </iframe>
  `;

  // Create unified adapter interface so all player controls work seamlessly via postMessage
  ytPlayer = {
    isFallback: true,
    currentVideoId: targetId,
    playVideo() {
      const f = document.getElementById('yt-direct-iframe');
      if (f && f.contentWindow) {
        f.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      }
    },
    pauseVideo() {
      const f = document.getElementById('yt-direct-iframe');
      if (f && f.contentWindow) {
        f.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
      }
    },
    loadVideoById(opts) {
      const vid = (typeof opts === 'object' && opts.videoId) ? opts.videoId : opts;
      this.currentVideoId = vid;
      const f = document.getElementById('yt-direct-iframe');
      if (f) {
        // Mi Browser fix: postMessage loadVideoById is unreliable on Mi Browser.
        // Replace iframe src directly for guaranteed video switch.
        let iframeOrigin = '';
        try {
          if (window.location && window.location.origin && window.location.origin !== 'null') {
            iframeOrigin = `&origin=${encodeURIComponent(window.location.origin)}`;
          }
        } catch (e) {}
        f.src = `https://www.youtube-nocookie.com/embed/${vid}?enablejsapi=1&autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=1&mute=0&iv_load_policy=3&cc_load_policy=0${iframeOrigin}`;
        // Retry play after iframe loads new video
        f.addEventListener('load', () => {
          try {
            if (f.contentWindow) {
              f.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
              f.contentWindow.postMessage(JSON.stringify({
                event: 'command', func: 'setVolume', args: [lastVolume]
              }), '*');
            }
          } catch (e) {}
        }, { once: true });
      }
    },
    setVolume(vol) {
      const f = document.getElementById('yt-direct-iframe');
      if (f && f.contentWindow) {
        f.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'setVolume',
          args: [vol]
        }), '*');
      }
    },
    setPlaybackQuality(q) {
      const f = document.getElementById('yt-direct-iframe');
      if (f && f.contentWindow) {
        f.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'setPlaybackQuality',
          args: [q]
        }), '*');
      }
    },
    setPlaybackQualityRange(minQ, maxQ) {
      const f = document.getElementById('yt-direct-iframe');
      if (f && f.contentWindow) {
        f.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'setPlaybackQualityRange',
          args: [minQ, maxQ]
        }), '*');
      }
    },
    getCurrentTime() {
      return currentSeconds || 0;
    },
    getDuration() {
      const track = playlist[currentTrackIndex];
      return track ? parseDurationToSeconds(track.duration) : 0;
    },
    getPlayerState() {
      return isPlaying ? 1 : 2;
    },
    getVideoData() {
      const track = playlist[currentTrackIndex];
      return track ? { title: track.title, author: track.channel } : {};
    }
  };

  isPlayerReady = true;
  isPlayerInitializing = false;
  setPlayingState(true);
  startProgressTimer();
  updatePlayerUI(currentTrack);
  setVideoMode(videoMode, true);
  showToast(`Playing: ${currentTrack.title}`);

  // Mi Browser fix: iframe postMessage API isn't ready until fully loaded.
  // Retry play command after iframe loads, and again after a delay for slow connections.
  const directIframe = document.getElementById('yt-direct-iframe');
  if (directIframe) {
    const retryPlay = () => {
      try {
        if (directIframe.contentWindow) {
          directIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
          directIframe.contentWindow.postMessage(JSON.stringify({
            event: 'command', func: 'setVolume', args: [lastVolume]
          }), '*');
        }
      } catch (e) {}
    };
    directIframe.addEventListener('load', () => {
      retryPlay();
      // Extra retry after 1s for Mi Browser which may need more time
      setTimeout(retryPlay, 1000);
      setTimeout(retryPlay, 3000);
    });
    // Immediate retry in case iframe was already cached
    setTimeout(retryPlay, 500);
  }

  // Mi Browser autoplay policy: ensure playback starts on first user gesture
  const gesturePlayHandler = () => {
    if (ytPlayer && ytPlayer.isFallback) {
      try {
        ytPlayer.playVideo();
      } catch (e) {}
    }
    window.removeEventListener('click', gesturePlayHandler);
    window.removeEventListener('touchstart', gesturePlayHandler);
    window.removeEventListener('touchend', gesturePlayHandler);
  };
  window.addEventListener('click', gesturePlayHandler, { passive: true });
  window.addEventListener('touchstart', gesturePlayHandler, { passive: true });
  window.addEventListener('touchend', gesturePlayHandler, { passive: true });
}

// Global PostMessage listener for YouTube direct iframe fallback
window.addEventListener('message', (event) => {
  if (!event || !event.data || typeof event.data !== 'string') return;
  try {
    const data = JSON.parse(event.data);
    if (data.event === 'onStateChange' && typeof data.info === 'number') {
      onYTPlayerStateChange({ data: data.info });
    } else if (data.event === 'infoDelivery' && data.info) {
      if (typeof data.info.currentTime === 'number') {
        currentSeconds = data.info.currentTime;
      }
      if (typeof data.info.playerState === 'number') {
        if (data.info.playerState === 1 && !isPlaying) {
          setPlayingState(true);
        } else if (data.info.playerState === 2 && isPlaying) {
          setPlayingState(false);
        } else if (data.info.playerState === 0) {
          handleTrackEnded();
        }
      }
    }
  } catch (e) {}
});

// Global hook for YouTube IFrame API
window.onYouTubeIframeAPIReady = function() {
  initYouTubePlayer();
};

// Immediate check: If YouTube API already loaded before script.js finished parsing
if (window.YT && window.YT.Player) {
  initYouTubePlayer();
} else {
  // Watchdog poller: catches ready event across Safari, Firefox, Edge, and mobile browsers
  let ytPollAttempts = 0;
  const ytReadyPoll = setInterval(() => {
    ytPollAttempts++;
    if (window.YT && window.YT.Player) {
      clearInterval(ytReadyPoll);
      if (!ytPlayer) initYouTubePlayer();
    } else if (ytPollAttempts >= 25) { // 2.5 seconds timeout
      clearInterval(ytReadyPoll);
      // If window.YT is blocked by Mi Browser AdBlock or slow network, activate direct fallback
      if (!ytPlayer && !isPlayerReady) {
        console.warn('[YouTubePlayer] window.YT unavailable after 2.5s. Activating direct iframe fallback for Mi Browser...');
        const current = playlist[currentTrackIndex] || CURATED_PLAYLIST[0];
        createDirectIframeFallback(current.id);
      }
    }
  }, 100);
}

// Dynamic injection fallback: ensures API script loads even if blocked or delayed
setTimeout(() => {
  if (!window.YT && (!ytPlayer || ytPlayer.isFallback)) {
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  }
}, 2000);

function disableCaptions(player) {
  const p = player || ytPlayer;
  if (!p) return;
  try {
    if (typeof p.unloadModule === 'function') {
      p.unloadModule('captions');
      p.unloadModule('cc');
    }
  } catch (e) {}
  try {
    if (typeof p.setOption === 'function') {
      p.setOption('captions', 'track', {});
      p.setOption('cc', 'track', {});
      p.setOption('captions', 'reload', true);
    }
  } catch (e) {}
}

function onYTApiChange(event) {
  disableCaptions(event ? event.target : ytPlayer);
}

function onYTPlayerReady(event) {
  isPlayerReady = true;
  isPlayerInitializing = false;

  // Ensure iframe permissions across browsers (Safari, Firefox, Chrome, Edge)
  try {
    const iframe = document.querySelector('#yt-player-container iframe');
    if (iframe) {
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    }
  } catch (e) {}

  try {
    event.target.setVolume(lastVolume);
  } catch (e) {}

  updatePlayerUI(playlist[currentTrackIndex]);
  setVideoMode(videoMode, true);
  setVideoQuality(videoQuality, true);
  disableCaptions(event.target);
  setTimeout(() => disableCaptions(event.target), 600);

  if (pendingTrackToPlay) {
    const track = pendingTrackToPlay;
    pendingTrackToPlay = null;
    autoPlayOnReady = false;
    loadAndPlayTrack(track);
  } else if (autoPlayOnReady) {
    autoPlayOnReady = false;
    try {
      ytPlayer.playVideo();
    } catch (e) {}
    setPlayingState(true);
    startProgressTimer();
  }
}

function onYTPlaybackQualityChange(event) {
  if (event && event.data) {
    actualQuality = event.data;
    updateQualityBadges();
  }
}

function handleTrackEnded() {
  if (isTransitioningTrack) return;
  if (!isAutoplayQueueEnabled) {
    setPlayingState(false);
    return;
  }

  isTransitioningTrack = true;
  stopProgressTimer();
  setPlayingState(false);

  // Transition smoothly to next queue item
  setTimeout(() => {
    playNextTrack();
    setTimeout(() => {
      isTransitioningTrack = false;
    }, 1200);
  }, 250);
}

let bufferingWatchdogTimer = null;
let isBufferStalled = false;

function onYTPlayerStateChange(event) {
  // 1: PLAYING, 2: PAUSED, 0: ENDED, 3: BUFFERING
  if (event.data === 1 || (window.YT && event.data === YT.PlayerState.PLAYING)) {
    // Clear buffering watchdog when playback resumes
    if (bufferingWatchdogTimer) {
      clearTimeout(bufferingWatchdogTimer);
      bufferingWatchdogTimer = null;
    }
    // If stream is in default mode, guarantee it stays on tiny (144p) to conserve bandwidth
    if (videoMode === 'default') {
      try {
        ytPlayer.setPlaybackQuality('tiny');
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('tiny', 'small');
        }
      } catch (e) {}
    }

    setPlayingState(true);
    startProgressTimer();
    disableCaptions(ytPlayer);
    setTimeout(() => disableCaptions(ytPlayer), 600);
    setTimeout(() => disableCaptions(ytPlayer), 1600);
    try {
      if (typeof ytPlayer.getPlaybackQuality === 'function') {
        const q = ytPlayer.getPlaybackQuality();
        if (q && q !== 'unknown') {
          actualQuality = q;
          updateQualityBadges();
        }
      }
    } catch (e) {}
    try {
      const data = ytPlayer.getVideoData();
      if (data && data.title && playlist[currentTrackIndex]) {
        if (!playlist[currentTrackIndex].title || playlist[currentTrackIndex].title === 'YouTube Music Track') {
          playlist[currentTrackIndex].title = data.title;
          playlist[currentTrackIndex].channel = data.author || 'YouTube';
          updatePlayerUI(playlist[currentTrackIndex]);
        }
      }
    } catch (e) {}
  } else if (event.data === 2 || (window.YT && event.data === YT.PlayerState.PAUSED)) {
    if (bufferingWatchdogTimer) {
      clearTimeout(bufferingWatchdogTimer);
      bufferingWatchdogTimer = null;
    }
    // If paused near the end of duration (within 1.2s), treat as completed track
    if (isPlayerReady && ytPlayer && isPlaying) {
      try {
        const cur = ytPlayer.getCurrentTime();
        const dur = ytPlayer.getDuration();
        if (dur > 2 && cur >= dur - 1.2) {
          handleTrackEnded();
          return;
        }
      } catch (e) {}
    }
    setPlayingState(false);
  } else if (event.data === 0 || (window.YT && event.data === YT.PlayerState.ENDED)) {
    if (bufferingWatchdogTimer) {
      clearTimeout(bufferingWatchdogTimer);
      bufferingWatchdogTimer = null;
    }
    handleTrackEnded();
  } else if (event.data === 3 || (window.YT && event.data === YT.PlayerState.BUFFERING)) {
    // When buffering: stop progress timer so scrubber does not jump around falsely
    stopProgressTimer();
    disableCaptions(ytPlayer);

    // On mobile in default mode, immediately force tiny quality (no watchdog delay needed)
    if (isMobileDevice && videoMode === 'default' && !bufferingWatchdogTimer) {
      try {
        ytPlayer.setPlaybackQuality('tiny');
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('tiny', 'tiny');
        }
      } catch (e) {}
    }

    // Watchdog: progressive quality step-down with faster reaction on mobile
    // 1st stall: wait 1.5s (mobile) / 3s (desktop), drop one tier
    if (!bufferingWatchdogTimer) {
      const watchdogDelay = isMobileDevice ? 1500 : 3000;
      bufferingWatchdogTimer = setTimeout(() => {
        if (isPlayerReady && ytPlayer) {
          try {
            isBufferStalled = true;
            if (videoMode === 'default') {
              ytPlayer.setPlaybackQuality('tiny');
              if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
                ytPlayer.setPlaybackQualityRange('tiny', 'tiny');
              }
            } else {
              // Network-aware fallback quality
              const fallbackQ = isMobileDevice ? getConnectionAwareQuality() : 'medium';
              const safeQ = (fallbackQ === 'tiny' || fallbackQ === 'small') ? fallbackQ : 'small';
              ytPlayer.setPlaybackQuality(safeQ);
              if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
                ytPlayer.setPlaybackQualityRange('tiny', safeQ);
              }
            }
          } catch (e) {}
        }
      }, watchdogDelay);
    }
  }
}

function onYTPlayerError(err) {
  const code = (err && typeof err === 'object') ? err.data : err;
  console.warn('YouTube Player notice/error code:', code);
  if (code === 150 || code === 101) {
    showToast('⚠️ Video dibatasi oleh pemiliknya untuk disematkan, melewati...');
  } else {
    showToast('⚠️ Lagu tidak tersedia, melewati ke antrean berikutnya...');
  }
  setTimeout(() => {
    handleTrackEnded();
  }, 1200);
}

// Update Play/Pause UI elements
function setPlayingState(playing) {
  isPlaying = playing;
  const playerBar = document.querySelector('.music-player-bar');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const heroPlayIcon = document.getElementById('hero-play-icon');
  const heroPlayText = document.getElementById('hero-play-text');
  const navBtnJourney = document.getElementById('nav-btn-journey');

  const headerTrackCard = document.getElementById('header-track-card');

  if (playing) {
    if (playerBar) playerBar.classList.add('is-playing');
    if (headerTrackCard) headerTrackCard.classList.add('is-playing');
    if (iconPlay) iconPlay.classList.add('hidden');
    if (iconPause) iconPause.classList.remove('hidden');
    if (heroPlayIcon) heroPlayIcon.textContent = '⏸';
    if (heroPlayText) heroPlayText.textContent = 'Pause Music';
    if (navBtnJourney) navBtnJourney.textContent = 'Pause';
    startProgressTimer();
  } else {
    if (playerBar) playerBar.classList.remove('is-playing');
    if (headerTrackCard) headerTrackCard.classList.remove('is-playing');
    if (iconPlay) iconPlay.classList.remove('hidden');
    if (iconPause) iconPause.classList.add('hidden');
    if (heroPlayIcon) heroPlayIcon.textContent = '▶';
    if (heroPlayText) heroPlayText.textContent = 'Start Listening';
    if (navBtnJourney) navBtnJourney.textContent = 'Listen Now';
    stopProgressTimer();
  }

  // Sync play state to pop-out window if open
  syncPopoutPlayState(playing);
}

// 3. Playback Controls
function togglePlayPause() {
  if (!isPlayerReady || !ytPlayer) {
    autoPlayOnReady = true;
    setPlayingState(true);
    startProgressTimer();
    if (window.YT && window.YT.Player) {
      initYouTubePlayer();
    } else {
      createDirectIframeFallback(playlist[currentTrackIndex]?.id || CURATED_PLAYLIST[0].id);
    }
    return;
  }
  if (isPlaying) {
    try { ytPlayer.pauseVideo(); } catch (e) {}
    setPlayingState(false);
  } else {
    try { ytPlayer.playVideo(); } catch (e) {}
    setPlayingState(true);
    if (!playbackStartTime) playbackStartTime = Date.now() - (currentSeconds * 1000);
    startProgressTimer();
  }
}

function loadAndPlayTrack(track) {
  if (!track || !track.id) return;

  // Track playback history to avoid immediate repeats
  playedHistory.add(track.id);
  if (playedHistory.size > 50) {
    const firstItem = playedHistory.values().next().value;
    playedHistory.delete(firstItem);
  }

  const existingIdx = playlist.findIndex(t => t.id === track.id);
  if (existingIdx !== -1) {
    currentTrackIndex = existingIdx;
  } else {
    playlist.unshift(track);
    currentTrackIndex = 0;
  }

  currentSeconds = 0;
  playbackStartTime = Date.now();
  updatePlayerUI(track);

  if (isPlayerReady && ytPlayer) {
    let suggestedQ = 'default';
    if (videoMode === 'default') {
      // In default ambient mode, audio is priority; request tiny (144p) to maximize buffer speed & eliminate stalls
      suggestedQ = 'tiny';
    } else if (videoQuality && videoQuality !== 'auto') {
      suggestedQ = videoQuality;
    } else if (isMobileDevice) {
      // Use network-aware quality: auto-detects 2G/3G/4G/WiFi and picks optimal resolution
      suggestedQ = getConnectionAwareQuality();
    }

    try {
      ytPlayer.loadVideoById({ videoId: track.id, startSeconds: 0, suggestedQuality: suggestedQ });
      ytPlayer.playVideo();
    } catch (e) {
      try {
        ytPlayer.loadVideoById(track.id, 0);
        ytPlayer.playVideo();
      } catch (err) {}
    }

    if (videoMode === 'default') {
      try {
        ytPlayer.setPlaybackQuality('tiny');
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('tiny', 'small');
        }
      } catch (err) {}
    } else if (videoQuality && videoQuality !== 'auto') {
      try {
        ytPlayer.setPlaybackQuality(videoQuality);
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('small', videoQuality);
        }
      } catch (err) {}
    } else {
      try {
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
          ytPlayer.setPlaybackQualityRange('small', isMobileDevice ? 'hd720' : 'highres');
        }
      } catch (err) {}
    }

    disableCaptions(ytPlayer);
    setTimeout(() => disableCaptions(ytPlayer), 600);
    setTimeout(() => disableCaptions(ytPlayer), 1600);
    setPlayingState(true);
    startProgressTimer();
  } else {
    pendingTrackToPlay = track;
    autoPlayOnReady = true;
    setPlayingState(true);
    if (window.YT && window.YT.Player) {
      initYouTubePlayer();
    } else {
      createDirectIframeFallback(track.id);
    }
  }

  showToast(`Playing: ${track.title}`);

  // Defer background preload related tracks until track has established its video/audio buffer
  // Mobile: wait longer (8s) to avoid competing for bandwidth during initial buffer fill
  // Desktop: 4s is sufficient
  const preloadDelay = isMobileDevice ? 8000 : 4000;
  setTimeout(() => {
    if (playlist[currentTrackIndex] && playlist[currentTrackIndex].id === track.id) {
      preloadRelatedTracks(track);
    }
  }, preloadDelay);
}

function playNextTrack() {
  // 1. If queue has tracks, pop and play
  if (musicQueue && musicQueue.length > 0) {
    const nextTrack = musicQueue.shift();
    saveQueueToStorage(musicQueue);
    renderQueueUI();
    loadAndPlayTrack(nextTrack);
    showToast(`🎵 Auto-playing next queue: "${nextTrack.title}"`);
    return;
  }

  // 2. Queue is exhausted: Auto-play track related to the last track!
  const lastTrack = playlist[currentTrackIndex] || null;
  if (lastTrack) {
    autoPlayRelatedTrack(lastTrack);
    return;
  }

  // 3. Fallback
  if (playlist.length === 0) return;
  currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
  loadAndPlayTrack(playlist[currentTrackIndex]);
}

function playPrevTrack() {
  if (playlist.length === 0) return;
  if (isPlayerReady && ytPlayer && currentSeconds > 3) {
    ytPlayer.seekTo(0, true);
    currentSeconds = 0;
    playbackStartTime = Date.now();
    updateProgress();
    return;
  }
  currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
  loadAndPlayTrack(playlist[currentTrackIndex]);
}

// Update Now Playing Information in Player Bar
function updatePlayerUI(track) {
  if (!track) return;
  const thumbEl = document.getElementById('player-thumb');
  const titleEl = document.getElementById('player-title');
  const channelEl = document.getElementById('player-channel');
  const totalTimeEl = document.getElementById('time-total');

  if (thumbEl) {
    thumbEl.src = track.thumbnail || `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
    thumbEl.alt = track.title || 'Track';
  }
  if (titleEl) titleEl.textContent = track.title || 'Now Playing';
  if (channelEl) channelEl.textContent = track.channel || 'YouTube';
  if (totalTimeEl && track.duration) {
    totalTimeEl.textContent = track.duration;
  }

  // Update Under-Header Now Playing Bar
  const headerTitleEl = document.getElementById('header-now-playing-title');
  const headerArtistEl = document.getElementById('header-now-playing-artist');
  if (headerTitleEl) {
    headerTitleEl.textContent = track.title || 'Now Playing';
    headerTitleEl.setAttribute('title', track.title || '');
  }
  if (headerArtistEl) {
    headerArtistEl.textContent = track.channel ? `• ${track.channel}` : '';
    headerArtistEl.setAttribute('title', track.channel || '');
  }

  // Recalculate Under-Header Marquee if track text overflows
  checkHeaderMarquee();

  // Sync Queue Now Playing block
  renderQueueUI();

  // Sync Pop-out window if active
  syncPopoutTrack(track);
}

// Dynamic Marquee for Under-Header Now Playing Title/Artist (Only if overflowing)
function checkHeaderMarquee() {
  const viewport = document.getElementById('header-marquee-viewport');
  const content = document.getElementById('header-marquee-content');
  if (!viewport || !content) return;

  // Temporarily reset inline animation to accurately measure natural un-animated scrollWidth
  content.style.animation = 'none';
  content.style.transform = 'none';
  viewport.classList.remove('is-overflowing');

  requestAnimationFrame(() => {
    const viewportWidth = viewport.clientWidth;
    const contentWidth = content.scrollWidth;
    const overflow = contentWidth - viewportWidth;

    if (overflow > 4) {
      // Content is too long! Enable marquee
      const distance = overflow + 10;
      // Dynamic duration proportional to overflow distance: ~28px/s, min 7s, max 24s
      const duration = Math.max(7, Math.min(24, Math.round(overflow / 28) + 5));

      content.style.setProperty('--marquee-distance', `-${distance}px`);
      content.style.setProperty('--marquee-duration', `${duration}s`);
      viewport.classList.add('is-overflowing');
      content.style.animation = `headerMarqueePingPong ${duration}s cubic-bezier(0.42, 0, 0.58, 1) infinite`;
    } else {
      content.style.animation = 'none';
      content.style.transform = 'none';
      viewport.classList.remove('is-overflowing');
    }
  });
}

// Real-Time Progress and Minute Indicator
function updateProgress() {
  const timeCurrentEl = document.getElementById('time-current');
  const timeTotalEl = document.getElementById('time-total');
  const fillEl = document.getElementById('progress-fill');

  let curTime = -1;
  let dur = 0;

  if (isPlayerReady && ytPlayer) {
    try {
      if (typeof ytPlayer.getCurrentTime === 'function') {
        const t = ytPlayer.getCurrentTime();
        if (typeof t === 'number' && !isNaN(t) && t >= 0) {
          curTime = t;
        }
      }
      if (typeof ytPlayer.getDuration === 'function') {
        const d = ytPlayer.getDuration();
        if (typeof d === 'number' && !isNaN(d) && d > 0) {
          dur = d;
        }
      }
    } catch (e) {}
  }

  const curTrack = playlist[currentTrackIndex];
  if (dur <= 0 && curTrack && curTrack.duration) {
    dur = parseDurationToSeconds(curTrack.duration);
  }

  // Calculate current playback second
  if (isPlaying) {
    if (curTime > 0) {
      currentSeconds = curTime;
      playbackStartTime = Date.now() - (curTime * 1000);
    } else if (playbackStartTime) {
      currentSeconds = (Date.now() - playbackStartTime) / 1000;
    } else {
      playbackStartTime = Date.now();
      currentSeconds = 0;
    }
  } else {
    if (curTime >= 0) {
      currentSeconds = curTime;
    }
  }

  // Update minute text
  if (timeCurrentEl) {
    timeCurrentEl.textContent = formatTime(currentSeconds);
  }

  // Update duration text and scrubber progress bar
  if (dur > 0) {
    if (timeTotalEl) timeTotalEl.textContent = formatTime(dur);
    if (fillEl) {
      const pct = Math.min(100, Math.max(0, (currentSeconds / dur) * 100));
      fillEl.style.width = `${pct}%`;
    }

    // Sync progress to pop-out window
    syncPopoutProgress(currentSeconds, dur);

    // Bulletproof End-of-Track Autoplay Detection
    // Automatically trigger next in queue when current track finishes
    if (isPlaying && !isTransitioningTrack && currentSeconds >= dur - 0.75) {
      handleTrackEnded();
      return;
    }
  } else if (curTrack && curTrack.duration === 'LIVE') {
    if (timeTotalEl) timeTotalEl.textContent = 'LIVE';
    if (fillEl) fillEl.style.width = '100%';
  }
}

function startProgressTimer() {
  stopProgressTimer();
  updateProgress();
  // Mobile: poll every 500ms instead of 250ms to reduce main thread load during video decoding
  progressTimer = setInterval(updateProgress, isMobileDevice ? 500 : 250);
}

function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

// Toast Feedback
let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('journey-toast');
  if (!toast) return;
  const textEl = toast.querySelector('.toast-text');
  if (textEl && message) textEl.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3800);
}

// =========================================================================
// 3.5 Playback Queue & Infinite Autoplay Manager
// =========================================================================
// 3.5 Playback Queue & Infinite Autoplay Manager (Same Artist & Same Genre)
// =========================================================================
let playedHistory = new Set();
let preloadedRelatedTracks = [];
let isFetchingRelated = false;
let lastPreloadId = null;
let currentDetectedArtist = '';
let currentDetectedGenre = '';

// Active backend API endpoint: automatically detects between local PHP ('search.php') and Vercel Node.js Serverless ('api/search')
let activeSearchEndpoint = (typeof window !== 'undefined' && window.location && window.location.hostname.includes('vercel.app')) ? 'api/search' : null;

async function fetchSearchApi(queryString) {
  // If active endpoint is already determined (e.g. already switched to api/search on Vercel)
  if (activeSearchEndpoint) {
    try {
      const res = await fetch(`${activeSearchEndpoint}?${queryString}`);
      if (res.ok) {
        const text = await res.text();
        if (!text.trim().startsWith('<')) {
          return JSON.parse(text);
        }
      }
    } catch (e) {
      console.warn(`[SearchAPI] Error fetching from ${activeSearchEndpoint}:`, e);
    }
  }

  // 1. Try search.php (standard for local Apache / XAMPP)
  try {
    const res = await fetch(`search.php?${queryString}`);
    if (res.ok) {
      const text = await res.text();
      // Detect if Vercel or static server served raw PHP file instead of executing it
      if (text.trim().startsWith('<?php') || text.trim().startsWith('<html') || text.trim().startsWith('<!DOCTYPE')) {
        console.warn('[SearchAPI] search.php served statically without PHP runtime. Switching to Vercel Serverless /api/search...');
        activeSearchEndpoint = 'api/search';
      } else {
        const json = JSON.parse(text);
        activeSearchEndpoint = 'search.php';
        return json;
      }
    }
  } catch (err) {
    console.warn('[SearchAPI] search.php failed, falling back to api/search:', err);
  }

  // 2. Try api/search (Node.js Serverless Function on Vercel)
  try {
    const res = await fetch(`api/search?${queryString}`);
    if (res.ok) {
      const text = await res.text();
      if (!text.trim().startsWith('<')) {
        const json = JSON.parse(text);
        activeSearchEndpoint = 'api/search';
        return json;
      }
    }
  } catch (err) {
    console.warn('[SearchAPI] api/search fallback failed:', err);
  }

  return null;
}

async function preloadRelatedTracks(track) {
  if (!track || !track.id) return;
  if (lastPreloadId === track.id) return;
  lastPreloadId = track.id;

  try {
    const playedParam = Array.from(playedHistory).slice(-15).join(',');
    const queryString = `related=1&id=${encodeURIComponent(track.id)}&title=${encodeURIComponent(track.title || '')}&channel=${encodeURIComponent(track.channel || '')}&played=${encodeURIComponent(playedParam)}`;
    const json = await fetchSearchApi(queryString);
    if (json && json.success && Array.isArray(json.results) && json.results.length > 0) {
      currentDetectedArtist = json.artist || '';
      currentDetectedGenre = json.genre || '';
      // Filter out played history and current track
      const unplayed = json.results.filter(t => t.id !== track.id && !playedHistory.has(t.id));
      preloadedRelatedTracks = unplayed.length > 0 ? unplayed : json.results.filter(t => t.id !== track.id);
      
      // Refresh queue UI if empty so upcoming radio track is visible
      if (musicQueue.length === 0) {
        renderQueueUI();
      }
    }
  } catch (err) {
    console.warn('Preload related error:', err);
  }
}

async function autoPlayRelatedTrack(lastTrack) {
  if (isFetchingRelated) return;

  // 1. Check if we already have preloaded related tracks ready
  if (preloadedRelatedTracks && preloadedRelatedTracks.length > 0) {
    const nextTrack = preloadedRelatedTracks.shift();
    loadAndPlayTrack(nextTrack);
    const label = nextTrack.relation_label ? `🎵 Auto-playing (${nextTrack.relation_label}): "${nextTrack.title}"` : `🎵 Auto-playing related: "${nextTrack.title}"`;
    showToast(label);
    return;
  }

  // 2. Fetch on-demand
  isFetchingRelated = true;
  showToast('🎵 Mencari lagu penyanyi / genre yang sama...');

  try {
    const trackId = lastTrack ? lastTrack.id : (playlist[currentTrackIndex] ? playlist[currentTrackIndex].id : '');
    const trackTitle = lastTrack ? (lastTrack.title || '') : '';
    const trackChannel = lastTrack ? (lastTrack.channel || '') : '';
    const playedParam = Array.from(playedHistory).slice(-15).join(',');
    const queryString = `related=1&id=${encodeURIComponent(trackId)}&title=${encodeURIComponent(trackTitle)}&channel=${encodeURIComponent(trackChannel)}&played=${encodeURIComponent(playedParam)}`;

    const json = await fetchSearchApi(queryString);
    if (json && json.success && Array.isArray(json.results) && json.results.length > 0) {
      currentDetectedArtist = json.artist || '';
      currentDetectedGenre = json.genre || '';
      const candidates = json.results.filter(t => t.id !== trackId && !playedHistory.has(t.id));
      const chosen = candidates.length > 0 ? candidates[0] : json.results[0];
      
      // Save the rest for subsequent auto-plays
      preloadedRelatedTracks = json.results.filter(t => t.id !== chosen.id && t.id !== trackId);
      
      loadAndPlayTrack(chosen);
      const label = chosen.relation_label ? `🎵 Auto-playing (${chosen.relation_label}): "${chosen.title}"` : `🎵 Auto-playing related: "${chosen.title}"`;
      showToast(label);
      isFetchingRelated = false;
      return;
    }
  } catch (err) {
    console.warn('Auto-play related fetch error:', err);
  } finally {
    isFetchingRelated = false;
  }

  // 3. Fallback: cycle to next in playlist
  if (playlist.length > 0) {
    currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
    loadAndPlayTrack(playlist[currentTrackIndex]);
    showToast(`Auto-playing next: "${playlist[currentTrackIndex].title}"`);
  }
}

function addToQueue(track) {
  if (!track || !track.id) return;
  const queuedItem = {
    id: track.id,
    title: track.title || 'YouTube Music Track',
    channel: track.channel || 'YouTube Video',
    duration: track.duration || '',
    thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,
    isDirectQuery: !!track.isDirectQuery
  };

  musicQueue.push(queuedItem);
  saveQueueToStorage(musicQueue);
  renderQueueUI();

  // On desktop, ensure the queue panel is open/visible when adding
  const queuePanel = document.getElementById('queue-panel');
  if (queuePanel && window.innerWidth >= 1024) {
    queuePanel.classList.remove('is-closed');
  }

  // Animate badge
  const badge = document.getElementById('queue-badge');
  if (badge) {
    badge.classList.add('bg-cyan-400', 'text-black', 'scale-110');
    setTimeout(() => {
      badge.classList.remove('bg-cyan-400', 'text-black', 'scale-110');
    }, 400);
  }

  showToast(`Added to queue: "${queuedItem.title}"`);
}

function removeFromQueue(index, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  if (index >= 0 && index < musicQueue.length) {
    const removed = musicQueue.splice(index, 1);
    saveQueueToStorage(musicQueue);
    renderQueueUI();
    if (removed[0]) {
      showToast(`Removed from queue: "${removed[0].title}"`);
    }
  }
}

function clearQueue() {
  if (musicQueue.length === 0) return;
  musicQueue = [];
  saveQueueToStorage(musicQueue);
  renderQueueUI();
  showToast('Playback queue cleared');
}

function playQueuedTrackIndex(index) {
  if (index >= 0 && index < musicQueue.length) {
    const track = musicQueue.splice(index, 1)[0];
    saveQueueToStorage(musicQueue);
    renderQueueUI();
    loadAndPlayTrack(track);
  }
}

function toggleQueuePanel() {
  const panel = document.getElementById('queue-panel');
  const backdrop = document.getElementById('queue-backdrop');
  if (!panel) return;

  if (window.innerWidth >= 1024) {
    panel.classList.toggle('is-closed');
  } else {
    const isOpen = panel.classList.toggle('is-open');
    if (backdrop) {
      if (isOpen) backdrop.classList.add('is-active');
      else backdrop.classList.remove('is-active');
    }
  }
}

function closeQueuePanel() {
  const panel = document.getElementById('queue-panel');
  const backdrop = document.getElementById('queue-backdrop');
  if (panel) {
    if (window.innerWidth >= 1024) {
      panel.classList.add('is-closed');
    } else {
      panel.classList.remove('is-open');
    }
  }
  if (backdrop) backdrop.classList.remove('is-active');
}

function renderQueueUI() {
  const listEl = document.getElementById('queue-items-list');
  const badgeEl = document.getElementById('queue-badge');
  const countBadgeEl = document.getElementById('queue-count-badge');
  const nowPlayingEl = document.getElementById('queue-now-playing');

  const count = musicQueue.length;
  if (badgeEl) badgeEl.textContent = `${count}`;
  if (countBadgeEl) countBadgeEl.textContent = `${count}`;

  // 1. Now Playing Block
  if (nowPlayingEl) {
    const current = playlist[currentTrackIndex] || null;
    if (current) {
      nowPlayingEl.innerHTML = `
        <div class="p-2 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-center gap-2.5">
          <div class="relative shrink-0 w-9 h-7 rounded overflow-hidden bg-black/50">
            <img src="${current.thumbnail || `https://i.ytimg.com/vi/${current.id}/hqdefault.jpg`}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div class="flex items-end gap-0.5 h-2.5">
                <span class="w-0.5 bg-cyan-400 ${isPlaying ? 'animate-pulse' : ''} h-full"></span>
                <span class="w-0.5 bg-cyan-400 ${isPlaying ? 'animate-pulse' : ''} h-1.5"></span>
                <span class="w-0.5 bg-cyan-400 ${isPlaying ? 'animate-pulse' : ''} h-2"></span>
              </div>
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <span class="text-[9px] uppercase tracking-wider text-cyan-400 font-semibold block leading-tight">Now Playing</span>
            <h5 class="text-xs font-medium text-foreground truncate">${current.title}</h5>
            <p class="text-[10px] text-muted-foreground truncate">${current.channel}</p>
          </div>
        </div>
      `;
    } else {
      nowPlayingEl.innerHTML = '';
    }
  }

  // Sync Autoplay Toggle Pill UI
  updateAutoplayUI();

  // 2. Queue Items
  if (!listEl) return;
  if (musicQueue.length === 0) {
    const nextRelated = (preloadedRelatedTracks && preloadedRelatedTracks.length > 0) ? preloadedRelatedTracks[0] : null;

    listEl.innerHTML = `
      <div class="py-2 text-center text-muted-foreground select-none px-1 flex flex-col gap-2">
        <div class="inline-flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/20 text-cyan-300 text-[9px] font-mono mx-auto">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
          <span>Autoplay Radio (No Queue)</span>
        </div>

        ${nextRelated ? `
          <div class="text-left p-2 rounded-xl bg-white/[0.04] border border-cyan-400/20 hover:bg-white/[0.08] transition-all cursor-pointer group" onclick="playNextTrack()" title="Click to play now">
            <div class="flex items-center justify-between text-[9px] font-semibold tracking-wider uppercase mb-1">
              <span class="text-cyan-300 flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                <span>Up Next</span>
              </span>
              <span class="text-[8px] px-1.5 py-0.2 rounded bg-cyan-400/15 text-cyan-300 border border-cyan-400/25">${nextRelated.relation_label || 'Related Track'}</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="relative shrink-0 w-8 h-8 rounded overflow-hidden bg-black/40">
                <img src="${nextRelated.thumbnail}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
              <div class="min-w-0 flex-1">
                <h5 class="text-xs font-normal text-foreground truncate group-hover:text-cyan-300 transition-colors">${nextRelated.title}</h5>
                <p class="text-[10px] text-muted-foreground truncate">${nextRelated.channel}</p>
              </div>
              ${nextRelated.duration ? `<span class="text-[9px] font-mono text-muted-foreground shrink-0">${nextRelated.duration}</span>` : ''}
            </div>
          </div>
        ` : `
          <div class="py-4">
            <p class="text-xs font-medium text-foreground/80">Queue is empty</p>
            <p class="text-[10px] text-muted-foreground mt-0.5">Lagu terkait penyanyi & genre yang sama akan otomatis diputar saat lagu selesai.</p>
          </div>
        `}
      </div>
    `;
    return;
  }

  listEl.innerHTML = musicQueue.map((item, idx) => `
    <div class="queue-track-item group flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-white/8 transition-all border border-transparent hover:border-white/10" data-queue-idx="${idx}">
      <div class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer" onclick="playQueuedTrackIndex(${idx})">
        <div class="relative shrink-0 w-8 h-8 rounded overflow-hidden bg-black/40">
          <img src="${item.thumbnail}" class="w-full h-full object-cover" loading="lazy">
          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            ${idx === 0 ? `<span class="px-1 py-0.5 rounded text-[8px] font-semibold bg-cyan-400/20 text-cyan-300 border border-cyan-400/30 uppercase tracking-wider shrink-0 leading-none">Next</span>` : ''}
            <h5 class="text-xs font-normal text-foreground truncate group-hover:text-cyan-300 transition-colors">${item.title}</h5>
          </div>
          <p class="text-[10px] text-muted-foreground truncate">${item.channel}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        ${item.duration ? `<span class="text-[9px] font-mono text-muted-foreground">${item.duration}</span>` : ''}
        <button type="button" class="btn-remove-queue p-1 text-muted-foreground hover:text-red-400 rounded transition-all cursor-pointer" title="Remove from queue" onclick="removeFromQueue(${idx}, event)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function updateAutoplayUI() {
  const btn = document.getElementById('btn-toggle-autoplay');
  const dot = document.getElementById('autoplay-dot');
  const text = document.getElementById('autoplay-status-text');
  if (!btn || !text) return;

  if (isAutoplayQueueEnabled) {
    btn.classList.remove('is-off');
    text.textContent = 'Autoplay: ON';
    if (dot) {
      dot.className = 'w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse';
    }
  } else {
    btn.classList.add('is-off');
    text.textContent = 'Autoplay: OFF';
    if (dot) {
      dot.className = 'w-1.5 h-1.5 rounded-full bg-white/30';
    }
  }
}

function toggleAutoplayQueue() {
  isAutoplayQueueEnabled = !isAutoplayQueueEnabled;
  try {
    localStorage.setItem('tmusic_autoplay_queue', isAutoplayQueueEnabled ? 'true' : 'false');
  } catch (e) {}
  updateAutoplayUI();
  showToast(`Queue autoplay ${isAutoplayQueueEnabled ? 'enabled (auto-plays next queue)' : 'disabled'}`);
}

// Expose handlers to window for inline onclick attributes
window.playQueuedTrackIndex = playQueuedTrackIndex;
window.removeFromQueue = removeFromQueue;

// 4. YouTube Search Functionality
let searchDebounceTimer = null;

async function executeSearch(query) {
  const resultsBox = document.getElementById('main-results-box') || document.querySelector('.main-search-results-box');
  const resultsContainer = document.getElementById('search-results');
  const spinner = document.getElementById('search-spinner');
  const countEl = document.getElementById('results-count');
  const resultsTitle = document.getElementById('results-title');

  if (!query || query.trim() === '') {
    if (resultsBox) resultsBox.classList.add('hidden');
    if (resultsContainer) resultsContainer.innerHTML = '';
    if (countEl) countEl.textContent = '0 tracks';
    if (resultsTitle) resultsTitle.textContent = 'Search Results';
    return;
  }

  const trimmed = query.trim();
  if (resultsBox) resultsBox.classList.remove('hidden');
  if (resultsTitle) resultsTitle.textContent = `Results: "${trimmed}"`;
  if (spinner) spinner.classList.remove('hidden');

  try {
    // 1. Check if user pasted a YouTube link directly
    const ytMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/) || trimmed.match(/^[\w-]{11}$/);
    if (ytMatch) {
      const vid = ytMatch[1] || ytMatch[0];
      // Fetch oEmbed title via noembed
      let directTrack = {
        id: vid,
        title: 'YouTube Music Track',
        channel: 'YouTube Video',
        duration: '',
        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
      };
      try {
        const noembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`);
        if (noembedRes.ok) {
          const data = await noembedRes.json();
          if (data && data.title) {
            directTrack.title = data.title;
            directTrack.channel = data.author_name || 'YouTube';
          }
        }
      } catch (err) {}

      renderSearchResults([directTrack]);
      if (countEl) countEl.textContent = 'Direct link matched';
      if (spinner) spinner.classList.add('hidden');
      return;
    }

    // 2. Fetch results from backend (search.php on Apache/XAMPP or api/search on Vercel)
    const json = await fetchSearchApi(`q=${encodeURIComponent(trimmed)}`);
    if (json && json.success && Array.isArray(json.results) && json.results.length > 0) {
      renderSearchResults(json.results);
      if (countEl) countEl.textContent = `${json.results.length} tracks found`;
      if (spinner) spinner.classList.add('hidden');
      return;
    }

    // 3. Fallback: Direct YouTube search fallback card
    renderSearchResults([{
      id: trimmed,
      title: `Search YouTube: "${trimmed}"`,
      channel: 'Click to play search query via YouTube',
      duration: '',
      thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
      isDirectQuery: true
    }]);
    if (countEl) countEl.textContent = 'YouTube search query';
  } catch (err) {
    console.error('Search error:', err);
    renderSearchResults([]);
    if (countEl) countEl.textContent = 'Search error';
  } finally {
    if (spinner) spinner.classList.add('hidden');
  }
}

function renderSearchResults(items) {
  const container = document.getElementById('search-results');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-muted-foreground text-sm">
        <p>No tracks found.</p>
        <p class="text-xs mt-1">Try another keyword or paste any YouTube URL.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item, index) => `
    <div class="search-item-card" data-track-index="${index}">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="relative shrink-0">
          <img src="${item.thumbnail}" alt="${item.title}" class="search-thumb" loading="lazy">
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="text-sm font-medium text-foreground truncate">${item.title}</h4>
          <p class="text-xs text-muted-foreground truncate">${item.channel}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        ${item.duration ? `<span class="search-duration-tag">${item.duration}</span>` : ''}
        <button type="button" class="btn-add-queue bg-white/10 hover:bg-white/20 border border-white/20 rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-foreground hover:scale-110 transition-all shrink-0 cursor-pointer" title="Add to Queue" data-track-idx="${index}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button type="button" class="btn-play-card bg-white/10 hover:bg-white/20 border border-white/20 rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-foreground hover:scale-110 transition-all shrink-0 cursor-pointer" aria-label="Play Track" data-track-idx="${index}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  // Attach Add to Queue listeners
  const addQueueBtns = container.querySelectorAll('.btn-add-queue');
  addQueueBtns.forEach((btn, idx) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const track = items[idx];
      if (track) addToQueue(track);
    });
  });

  // Attach play click listeners to cards
  const cards = container.querySelectorAll('.search-item-card');
  cards.forEach((card, idx) => {
    card.addEventListener('click', () => {
      const track = items[idx];
      if (track) {
        if (track.isDirectQuery && isPlayerReady && ytPlayer) {
          // Use YouTube search playlist
          ytPlayer.loadPlaylist({ listType: 'search', list: track.id });
          showToast(`Searching & playing: ${track.id}`);
        } else {
          loadAndPlayTrack(track);
        }
        closeSearchModal();
      }
    });
  });
}

// Zen Mode: Hide / Show Main Content
let isMainContentVisible = true;

function toggleMainContent(silent = false) {
  setMainContentVisible(!isMainContentVisible, silent);
}

function setMainContentVisible(visible, silent = false) {
  isMainContentVisible = visible;
  const mainEl = document.getElementById('main-content') || document.querySelector('main');
  const btnToggle = document.getElementById('btn-toggle-main-content');
  const iconOpen = document.getElementById('icon-eye-open');
  const iconClosed = document.getElementById('icon-eye-closed');

  if (mainEl) {
    if (visible) {
      mainEl.classList.remove('main-content-hidden');
    } else {
      mainEl.classList.add('main-content-hidden');
    }
  }

  if (btnToggle) {
    if (!visible) {
      btnToggle.classList.add('is-hidden-mode');
      btnToggle.setAttribute('aria-pressed', 'true');
      btnToggle.setAttribute('title', 'Tampilkan konten utama');
      if (iconOpen) iconOpen.classList.add('hidden');
      if (iconClosed) iconClosed.classList.remove('hidden');
    } else {
      btnToggle.classList.remove('is-hidden-mode');
      btnToggle.setAttribute('aria-pressed', 'false');
      btnToggle.setAttribute('title', 'Sembunyikan konten utama (Zen Mode)');
      if (iconOpen) iconOpen.classList.remove('hidden');
      if (iconClosed) iconClosed.classList.add('hidden');
    }
  }

  if (!silent) {
    showToast(visible ? '👁️ Konten utama ditampilkan' : '👁️ Konten utama disembunyikan (Zen Mode)');
  }
}

// Search Focus Handler (Direct in Main Landing Page)
function openSearchModal() {
  if (!isMainContentVisible) {
    setMainContentVisible(true, true);
  }
  const input = document.getElementById('search-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function closeSearchModal() {
  // Direct embedded search: no modal to close
}

// =========================================================================
// Fullscreen & Pop Out (Mini Player / Picture-in-Picture)
// =========================================================================

function toggleFullScreen() {
  const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFS) {
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
    }
    showToast('🖥️ Mode Layar Penuh (Fullscreen)');
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    showToast('Keluar dari Layar Penuh');
  }
}

function updateFullscreenUI() {
  const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const btn = document.getElementById('btn-toggle-fullscreen');
  const iconEnter = document.getElementById('icon-fs-enter');
  const iconExit = document.getElementById('icon-fs-exit');
  if (btn) {
    if (isFS) {
      btn.classList.add('is-active');
      btn.setAttribute('title', 'Keluar dari Fullscreen (Esc)');
      if (iconEnter) iconEnter.classList.add('hidden');
      if (iconExit) iconExit.classList.remove('hidden');
    } else {
      btn.classList.remove('is-active');
      btn.setAttribute('title', 'Layar Penuh (Fullscreen)');
      if (iconEnter) iconEnter.classList.remove('hidden');
      if (iconExit) iconExit.classList.add('hidden');
    }
  }
}

let popoutWindow = null;

function updatePopoutBtnUI(isOpen) {
  const btn = document.getElementById('btn-toggle-popout');
  if (btn) {
    if (isOpen) {
      btn.classList.add('is-active');
      btn.setAttribute('title', 'Tutup Pop Out Player');
    } else {
      btn.classList.remove('is-active');
      btn.setAttribute('title', 'Buka Pop Out Player (Mini Window / PiP)');
    }
  }
}

function syncPopoutPlayState(playing) {
  if (!popoutWindow || popoutWindow.closed) return;
  try {
    const iconPlay = popoutWindow.document.getElementById('pop-icon-play');
    const iconPause = popoutWindow.document.getElementById('pop-icon-pause');
    if (iconPlay && iconPause) {
      if (playing) {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
      } else {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
      }
    }
  } catch (e) {}
}

function syncPopoutTrack(track) {
  if (!popoutWindow || popoutWindow.closed) return;
  try {
    const cur = track || playlist[currentTrackIndex] || CURATED_PLAYLIST[0];
    const thumbEl = popoutWindow.document.getElementById('pop-thumb');
    const titleEl = popoutWindow.document.getElementById('pop-title');
    const artistEl = popoutWindow.document.getElementById('pop-artist');
    const timeDur = popoutWindow.document.getElementById('pop-time-dur');

    if (thumbEl) thumbEl.src = cur.thumbnail || `https://i.ytimg.com/vi/${cur.id}/hqdefault.jpg`;
    if (titleEl) {
      titleEl.textContent = cur.title || 'Now Playing';
      titleEl.title = cur.title || '';
      popoutWindow.document.title = `${cur.title || 'TMusic'} — Pop-out`;
    }
    if (artistEl) artistEl.textContent = cur.channel || 'YouTube';
    if (timeDur && cur.duration) timeDur.textContent = cur.duration;
  } catch (e) {}
}

function syncPopoutProgress(curSeconds, durSeconds) {
  if (!popoutWindow || popoutWindow.closed) return;
  try {
    const fillEl = popoutWindow.document.getElementById('pop-progress-fill');
    const timeCur = popoutWindow.document.getElementById('pop-time-cur');
    const timeDur = popoutWindow.document.getElementById('pop-time-dur');

    if (durSeconds > 0) {
      if (fillEl) {
        const pct = Math.min(100, Math.max(0, (curSeconds / durSeconds) * 100));
        fillEl.style.width = `${pct}%`;
      }
      if (timeCur) timeCur.textContent = formatTime(curSeconds);
      if (timeDur) timeDur.textContent = formatTime(durSeconds);
    }
  } catch (e) {}
}

function setupPopoutWindowContent(win, track) {
  if (!win) return;
  const current = track || playlist[currentTrackIndex] || CURATED_PLAYLIST[0];
  const dur = current.duration || '0:00';
  const thumb = current.thumbnail || `https://i.ytimg.com/vi/${current.id}/hqdefault.jpg`;
  const title = current.title || 'Now Playing';
  const channel = current.channel || 'YouTube Music';

  win.document.title = `${title} — TMusic Pop-out`;
  
  win.document.body.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      body {
        background: #090d16;
        color: #f1f5f9;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 14px;
        user-select: none;
      }
      .popout-header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .popout-thumb {
        width: 52px;
        height: 52px;
        border-radius: 8px;
        object-fit: cover;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        border: 1px solid rgba(255,255,255,0.1);
        flex-shrink: 0;
      }
      .popout-meta {
        flex: 1;
        min-width: 0;
      }
      .popout-title {
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }
      .popout-artist {
        font-size: 11px;
        color: #94a3b8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }
      .popout-progress-wrapper {
        margin: 12px 0 6px 0;
        cursor: pointer;
        padding: 4px 0;
      }
      .popout-progress-track {
        width: 100%;
        height: 4px;
        background: rgba(255,255,255,0.15);
        border-radius: 9999px;
        position: relative;
        overflow: hidden;
      }
      .popout-progress-fill {
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        width: 0%;
        background: #06b6d4;
        border-radius: 9999px;
      }
      .popout-times {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #64748b;
        font-family: monospace;
        margin-top: 3px;
      }
      .popout-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        margin-top: 4px;
      }
      .popout-btn {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        color: #e2e8f0;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .popout-btn:hover {
        background: rgba(255,255,255,0.18);
        color: #ffffff;
        transform: scale(1.08);
      }
      .popout-btn:active {
        transform: scale(0.95);
      }
      .popout-btn-sub {
        width: 32px;
        height: 32px;
      }
      .popout-btn-play {
        width: 44px;
        height: 44px;
        background: #06b6d4;
        color: #000;
        border: none;
        box-shadow: 0 4px 14px rgba(6,182,212,0.4);
      }
      .popout-btn-play:hover {
        background: #22d3ee;
        color: #000;
      }
    </style>
    <div class="popout-header">
      <img id="pop-thumb" class="popout-thumb" src="${thumb}" alt="Thumbnail">
      <div class="popout-meta">
        <div id="pop-title" class="popout-title" title="${title}">${title}</div>
        <div id="pop-artist" class="popout-artist">${channel}</div>
      </div>
    </div>
    <div>
      <div id="pop-progress-wrapper" class="popout-progress-wrapper">
        <div class="popout-progress-track">
          <div id="pop-progress-fill" class="popout-progress-fill"></div>
        </div>
        <div class="popout-times">
          <span id="pop-time-cur">0:00</span>
          <span id="pop-time-dur">${dur}</span>
        </div>
      </div>
      <div class="popout-controls">
        <button type="button" id="pop-btn-prev" class="popout-btn popout-btn-sub" title="Previous">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button type="button" id="pop-btn-play" class="popout-btn popout-btn-play" title="Play/Pause">
          <svg id="pop-icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          <svg id="pop-icon-pause" style="display:none;" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
        <button type="button" id="pop-btn-next" class="popout-btn popout-btn-sub" title="Next">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
      </div>
    </div>
  `;

  // Attach controls to parent methods
  const btnPlay = win.document.getElementById('pop-btn-play');
  const btnPrev = win.document.getElementById('pop-btn-prev');
  const btnNext = win.document.getElementById('pop-btn-next');
  const progWrapper = win.document.getElementById('pop-progress-wrapper');

  if (btnPlay) btnPlay.addEventListener('click', togglePlayPause);
  if (btnPrev) btnPrev.addEventListener('click', playPrevTrack);
  if (btnNext) btnNext.addEventListener('click', playNextTrack);

  if (progWrapper) {
    progWrapper.addEventListener('click', (e) => {
      const rect = progWrapper.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      let duration = 0;
      if (isPlayerReady && ytPlayer && typeof ytPlayer.getDuration === 'function') {
        duration = ytPlayer.getDuration() || 0;
      }
      if (duration <= 0 && playlist[currentTrackIndex] && playlist[currentTrackIndex].duration) {
        duration = parseDurationToSeconds(playlist[currentTrackIndex].duration);
      }
      if (duration > 0) {
        const seekTime = ratio * duration;
        if (isPlayerReady && ytPlayer && typeof ytPlayer.seekTo === 'function') {
          ytPlayer.seekTo(seekTime, true);
        }
        currentSeconds = seekTime;
        playbackStartTime = Date.now() - (seekTime * 1000);
        updateProgress();
      }
    });
  }

  // Handle unload
  const cleanUp = () => {
    popoutWindow = null;
    updatePopoutBtnUI(false);
  };
  win.addEventListener('pagehide', cleanUp);
  win.addEventListener('unload', cleanUp);

  // Sync initial play state
  syncPopoutPlayState(isPlaying);
  updateProgress();
}

async function togglePopOut() {
  if (popoutWindow && !popoutWindow.closed) {
    popoutWindow.close();
    popoutWindow = null;
    updatePopoutBtnUI(false);
    showToast('🗔 Pop-out player ditutup');
    return;
  }

  const track = playlist[currentTrackIndex] || CURATED_PLAYLIST[0];

  // 1. Try Document Picture-in-Picture API (Chrome/Edge 116+ always-on-top OS window)
  if ('documentPictureInPicture' in window && typeof window.documentPictureInPicture.requestWindow === 'function') {
    try {
      popoutWindow = await window.documentPictureInPicture.requestWindow({
        width: 440,
        height: 280
      });
      setupPopoutWindowContent(popoutWindow, track);
      updatePopoutBtnUI(true);
      showToast('🗔 Pop-out Picture-in-Picture aktif');
      return;
    } catch (e) {
      console.warn('Document PiP request error or user dismissed:', e);
    }
  }

  // 2. Standard Pop-out Window via window.open
  try {
    const left = window.screen.width ? Math.max(20, window.screen.width - 480) : 100;
    const top = window.screen.height ? Math.max(20, window.screen.height - 360) : 100;
    popoutWindow = window.open(
      '',
      'TMusicPopout',
      `width=440,height=280,left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
    );
    if (popoutWindow) {
      setupPopoutWindowContent(popoutWindow, track);
      updatePopoutBtnUI(true);
      showToast('🗔 Pop-out player dibuka');
      return;
    }
  } catch (err) {
    console.warn('Pop-out window.open error:', err);
  }

  // 3. Fallback to HTML5 video Picture-in-Picture if in default video mode
  const heroVideo = document.getElementById('hero-video');
  if (heroVideo && document.pictureInPictureEnabled) {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        updatePopoutBtnUI(false);
      } else {
        await heroVideo.requestPictureInPicture();
        updatePopoutBtnUI(true);
        showToast('🗔 Picture-in-Picture aktif');
      }
      return;
    } catch (err) {}
  }

  showToast('Pop-out tidak didukung pada browser ini');
}

// 5. Initialize DOM Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Video Background Autoplay Reliability
  // On mobile: defer ambient video loading to save bandwidth for YouTube playback
  const heroVideo = document.getElementById('hero-video');
  if (heroVideo) {
    heroVideo.muted = true;
    heroVideo.playsInline = true;

    if (isMobileDevice && isLowEndDevice) {
      // Low-end mobile: don't load ambient video at all to free up the single HW decoder
      // The CSS gradient/dark background is sufficient on mobile screens
      heroVideo.removeAttribute('autoplay');
      heroVideo.preload = 'none';
      heroVideo.classList.add('is-hidden');
    } else if (isMobileDevice) {
      // Standard mobile: defer ambient video load by 6s to prioritize YouTube stream startup
      heroVideo.removeAttribute('autoplay');
      heroVideo.preload = 'none';
      setTimeout(() => {
        if (videoMode !== 'video') {
          heroVideo.preload = 'auto';
          heroVideo.load();
          heroVideo.play().catch(() => {});
        }
      }, 6000);
    } else {
      // Desktop: play immediately
      heroVideo.preload = 'auto';
      heroVideo.load();
      const playAttempt = heroVideo.play();
      if (playAttempt !== undefined) {
        playAttempt.catch(() => {
          const resumePlay = () => {
            heroVideo.play().catch(() => {});
            window.removeEventListener('click', resumePlay);
            window.removeEventListener('touchstart', resumePlay);
          };
          window.addEventListener('click', resumePlay, { once: true });
          window.addEventListener('touchstart', resumePlay, { once: true });
        });
      }
    }
  }

  // Cross-browser user gesture unlock for YouTube media playback
  const unlockAudioOnGesture = () => {
    if (isPlaying && isPlayerReady && ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
      try {
        const state = ytPlayer.getPlayerState();
        if (state !== 1 && state !== 3) {
          ytPlayer.playVideo();
        }
      } catch (e) {}
    }
  };
  window.addEventListener('click', unlockAudioOnGesture, { passive: true });
  window.addEventListener('touchstart', unlockAudioOnGesture, { passive: true });

  // Playback Control Buttons
  const btnPlayPause = document.getElementById('btn-play-pause');
  const heroBtnPlay = document.getElementById('hero-btn-play');
  const navBtnJourney = document.getElementById('nav-btn-journey');
  const btnNext = document.getElementById('btn-next');
  const btnPrev = document.getElementById('btn-prev');

  if (btnPlayPause) btnPlayPause.addEventListener('click', togglePlayPause);
  if (heroBtnPlay) heroBtnPlay.addEventListener('click', togglePlayPause);
  if (navBtnJourney) navBtnJourney.addEventListener('click', togglePlayPause);
  if (btnNext) btnNext.addEventListener('click', playNextTrack);
  if (btnPrev) btnPrev.addEventListener('click', playPrevTrack);

  // Initialize Playback Queue UI from persistent cache/cookies
  renderQueueUI();

  // Queue Panel Toggle Buttons
  const btnToggleQueue = document.getElementById('btn-toggle-queue');
  const btnCloseQueue = document.getElementById('btn-close-queue');
  const btnClearQueue = document.getElementById('btn-clear-queue');
  const btnToggleAutoplay = document.getElementById('btn-toggle-autoplay');
  const queueBackdrop = document.getElementById('queue-backdrop');

  if (btnToggleQueue) btnToggleQueue.addEventListener('click', toggleQueuePanel);
  if (btnCloseQueue) btnCloseQueue.addEventListener('click', closeQueuePanel);
  if (btnClearQueue) btnClearQueue.addEventListener('click', clearQueue);
  if (btnToggleAutoplay) btnToggleAutoplay.addEventListener('click', toggleAutoplayQueue);
  if (queueBackdrop) queueBackdrop.addEventListener('click', closeQueuePanel);

  // Under-Header Track Card: Click to toggle queue panel
  const headerTrackCard = document.getElementById('header-track-card');
  if (headerTrackCard) {
    headerTrackCard.addEventListener('click', toggleQueuePanel);
    headerTrackCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleQueuePanel();
      }
    });
  }

  // Initial Sync of Track Info across Player & Under-Header bar
  if (playlist && playlist[currentTrackIndex]) {
    updatePlayerUI(playlist[currentTrackIndex]);
  }
  checkHeaderMarquee();

  // Recalculate marquee on window resize (e.g. mobile orientation change)
  let marqueeResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(marqueeResizeTimer);
    marqueeResizeTimer = setTimeout(checkHeaderMarquee, 120);
  });

  // Switch Video Mode (Default Ambient vs YouTube Video Clip)
  const switchVideoBtns = document.querySelectorAll('.switch-video-btn');
  switchVideoBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      if (mode) setVideoMode(mode);
    });
  });
  setVideoMode(videoMode, true);

  // Toggle Main Content (Eye Button beside Default/Video switch)
  const btnToggleMain = document.getElementById('btn-toggle-main-content');
  if (btnToggleMain) {
    btnToggleMain.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMainContent();
    });
  }

  // Toggle Fullscreen Button
  const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
  if (btnToggleFullscreen) {
    btnToggleFullscreen.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullScreen();
    });
  }
  document.addEventListener('fullscreenchange', updateFullscreenUI);
  document.addEventListener('webkitfullscreenchange', updateFullscreenUI);

  // Toggle Pop Out / Mini Player Button
  const btnTogglePopout = document.getElementById('btn-toggle-popout');
  if (btnTogglePopout) {
    btnTogglePopout.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopOut();
    });
  }

  // Video Quality Trigger Buttons & Modal Events
  const openQualityBtns = document.querySelectorAll('.btn-open-quality');
  openQualityBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openQualityModal();
    });
  });

  const closeQualityBtn = document.getElementById('btn-close-quality');
  const qualityBackdrop = document.getElementById('video-quality-backdrop');
  if (closeQualityBtn) closeQualityBtn.addEventListener('click', closeQualityModal);
  if (qualityBackdrop) qualityBackdrop.addEventListener('click', closeQualityModal);

  // Video Quality Option Selectors
  const qualityOptBtns = document.querySelectorAll('.quality-opt-btn');
  qualityOptBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-quality');
      if (q) {
        setVideoQuality(q);
        setTimeout(closeQualityModal, 220);
      }
    });
  });

  // Visualizer Setting Popover Menu Toggle
  const btnVizSettings = document.getElementById('btn-viz-settings');
  const vizSettingsMenu = document.getElementById('viz-settings-menu');
  const vizSettingsWrapper = document.getElementById('viz-settings-wrapper');

  if (btnVizSettings && vizSettingsMenu) {
    btnVizSettings.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isHidden = vizSettingsMenu.classList.contains('hidden');
      if (isHidden) {
        vizSettingsMenu.classList.remove('hidden');
        btnVizSettings.classList.add('is-active');
        btnVizSettings.setAttribute('aria-expanded', 'true');
        updateQualityBadges();
      } else {
        vizSettingsMenu.classList.add('hidden');
        btnVizSettings.classList.remove('is-active');
        btnVizSettings.setAttribute('aria-expanded', 'false');
      }
    });

    // Prevent clicks inside menu from closing the menu
    vizSettingsMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close popover when clicking anywhere outside
    document.addEventListener('click', (e) => {
      if (vizSettingsWrapper && !vizSettingsWrapper.contains(e.target)) {
        vizSettingsMenu.classList.add('hidden');
        btnVizSettings.classList.remove('is-active');
        btnVizSettings.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Quick Quality Pills inside Visualizer Setting Menu
  const vizQualityPills = document.querySelectorAll('.viz-quality-pill[data-quality]');
  vizQualityPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const q = pill.getAttribute('data-quality');
      if (q) {
        setVideoQuality(q);
      }
    });
  });

  // More Quality Button inside Setting Menu (Opens full modal)
  const moreQualityBtn = document.querySelector('.viz-quality-more');
  if (moreQualityBtn) {
    moreQualityBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (vizSettingsMenu) vizSettingsMenu.classList.add('hidden');
      if (btnVizSettings) {
        btnVizSettings.classList.remove('is-active');
        btnVizSettings.setAttribute('aria-expanded', 'false');
      }
      openQualityModal();
    });
  }

  // Close modal or popover on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeQualityModal();
      if (vizSettingsMenu) {
        vizSettingsMenu.classList.add('hidden');
        if (btnVizSettings) {
          btnVizSettings.classList.remove('is-active');
          btnVizSettings.setAttribute('aria-expanded', 'false');
        }
      }
    }
  });

  updateQualityBadges();

  // Scrubber Seek
  const progressWrapper = document.getElementById('progress-wrapper');
  if (progressWrapper) {
    progressWrapper.addEventListener('click', (e) => {
      const rect = progressWrapper.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      if (width <= 0) return;
      const ratio = Math.max(0, Math.min(1, clickX / width));
      
      let duration = 0;
      if (isPlayerReady && ytPlayer && typeof ytPlayer.getDuration === 'function') {
        duration = ytPlayer.getDuration() || 0;
      }
      if (duration <= 0 && playlist[currentTrackIndex] && playlist[currentTrackIndex].duration) {
        duration = parseDurationToSeconds(playlist[currentTrackIndex].duration);
      }

      if (duration > 0) {
        const seekTime = ratio * duration;
        if (isPlayerReady && ytPlayer && typeof ytPlayer.seekTo === 'function') {
          ytPlayer.seekTo(seekTime, true);
        }
        currentSeconds = seekTime;
        playbackStartTime = Date.now() - (seekTime * 1000);
        updateProgress();
      }
    });
  }

  // Volume Slider
  const volumeSlider = document.getElementById('volume-slider');
  const btnVolumeIcon = document.getElementById('btn-volume-icon');
  const iconVolHigh = document.getElementById('icon-vol-high');
  const iconVolMute = document.getElementById('icon-vol-mute');

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      lastVolume = val;
      if (isPlayerReady && ytPlayer) {
        ytPlayer.setVolume(val);
        if (val === 0) {
          if (iconVolHigh) iconVolHigh.classList.add('hidden');
          if (iconVolMute) iconVolMute.classList.remove('hidden');
        } else {
          if (iconVolHigh) iconVolHigh.classList.remove('hidden');
          if (iconVolMute) iconVolMute.classList.add('hidden');
        }
      }
    });
  }

  if (btnVolumeIcon) {
    btnVolumeIcon.addEventListener('click', () => {
      if (!isPlayerReady || !ytPlayer || !volumeSlider) return;
      if (ytPlayer.isMuted() || volumeSlider.value === '0') {
        ytPlayer.unMute();
        const restore = lastVolume > 0 ? lastVolume : 80;
        ytPlayer.setVolume(restore);
        volumeSlider.value = restore;
        if (iconVolHigh) iconVolHigh.classList.remove('hidden');
        if (iconVolMute) iconVolMute.classList.add('hidden');
      } else {
        ytPlayer.mute();
        volumeSlider.value = 0;
        if (iconVolHigh) iconVolHigh.classList.add('hidden');
        if (iconVolMute) iconVolMute.classList.remove('hidden');
      }
    });
  }

  // Search Modal Triggers
  const btnOpenSearch = document.getElementById('btn-open-search');
  const navBtnSearch = document.getElementById('nav-btn-search');
  const heroBtnSearch = document.getElementById('hero-btn-search');
  const playerBtnSearch = document.getElementById('player-btn-search');
  const btnCloseSearch = document.getElementById('btn-close-search');
  const searchModal = document.getElementById('search-modal');
  const searchInput = document.getElementById('search-input');

  [btnOpenSearch, navBtnSearch, heroBtnSearch, playerBtnSearch].forEach(btn => {
    if (btn) btn.addEventListener('click', openSearchModal);
  });

  if (btnCloseSearch) btnCloseSearch.addEventListener('click', closeSearchModal);

  // Close modal when clicking outside card
  if (searchModal) {
    searchModal.addEventListener('click', (e) => {
      if (e.target === searchModal) closeSearchModal();
    });
  }

  // Search Triggered on Enter key or clicking Search button
  const searchForm = document.getElementById('search-form');
  const btnSubmitSearch = document.getElementById('btn-submit-search');
  const btnClearSearch = document.getElementById('btn-clear-search');

  const doSearch = () => {
    if (!searchInput) return;
    const q = searchInput.value;
    executeSearch(q);
  };

  const doClearSearch = () => {
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    executeSearch('');
  };

  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      doSearch();
    });
  }

  if (btnSubmitSearch) {
    btnSubmitSearch.addEventListener('click', (e) => {
      e.preventDefault();
      doSearch();
    });
  }

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', (e) => {
      e.preventDefault();
      doClearSearch();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    searchInput.addEventListener('input', () => {
      if (searchInput.value.trim() === '') {
        const resultsBox = document.getElementById('main-results-box') || document.querySelector('.main-search-results-box');
        const resultsContainer = document.getElementById('search-results');
        if (resultsBox) resultsBox.classList.add('hidden');
        if (resultsContainer) resultsContainer.innerHTML = '';
      }
    });
  }

  // Music Navigation Links
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      const target = link.getAttribute('data-nav') || link.getAttribute('href').replace('#', '');
      if (target === 'discover') {
        openSearchModal();
        if (searchInput) {
          searchInput.value = '';
          executeSearch('');
        }
      } else if (target === 'trending') {
        openSearchModal();
        if (searchInput) {
          searchInput.value = 'Trending music';
          executeSearch('Trending music');
        }
      } else if (target === 'playlists' || target === 'library') {
        toggleQueuePanel();
      } else if (target === 'moods') {
        openSearchModal();
        if (searchInput) {
          searchInput.value = 'chill ambient focus';
          executeSearch('chill ambient focus');
        }
      }

      const mobileNav = document.getElementById('mobile-nav');
      if (mobileNav) mobileNav.classList.remove('is-open');
    });
  });

  // Hero Quick Vibe Tags (Instant Play or Search)
  const heroTags = document.querySelectorAll('.hero-quick-tag');
  heroTags.forEach(tag => {
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      const q = tag.getAttribute('data-query');
      const lowerQ = q.toLowerCase();
      // Match with curated playlist
      let matched = null;
      if (lowerQ.includes('lofi')) matched = CURATED_PLAYLIST[0];
      else if (lowerQ.includes('interstellar')) matched = CURATED_PLAYLIST[1];
      else if (lowerQ.includes('tulus')) matched = CURATED_PLAYLIST[2];
      else if (lowerQ.includes('ghibli')) matched = CURATED_PLAYLIST[5];
      else if (lowerQ.includes('synthwave')) matched = CURATED_PLAYLIST[4];

      if (matched) {
        loadAndPlayTrack(matched);
      } else {
        openSearchModal();
        if (searchInput) {
          searchInput.value = q;
          executeSearch(q);
        }
      }
    });
  });

  // Quick Filter Vibe Pills
  const filterPills = document.querySelectorAll('.filter-tag-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const q = pill.getAttribute('data-query');
      if (searchInput) {
        searchInput.value = q;
        executeSearch(q);
      }
    });
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Ctrl + K or Cmd + K: Open Search
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openSearchModal();
      return;
    }

    // Escape: Close modals
    if (e.key === 'Escape') {
      closeSearchModal();
      const mobileNav = document.getElementById('mobile-nav');
      if (mobileNav) mobileNav.classList.remove('is-open');
    }

    // Spacebar: Play/Pause (only when not typing in input)
    if (e.key === ' ' && document.activeElement !== searchInput && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      togglePlayPause();
    }
  });

  // Mobile Menu
  const mobileToggleBtn = document.getElementById('mobile-toggle-btn');
  const mobileCloseBtn = document.getElementById('mobile-close-btn');
  const mobileNav = document.getElementById('mobile-nav');

  if (mobileToggleBtn && mobileNav) {
    mobileToggleBtn.addEventListener('click', () => {
      mobileNav.classList.add('is-open');
    });
  }
  if (mobileCloseBtn && mobileNav) {
    mobileCloseBtn.addEventListener('click', () => {
      mobileNav.classList.remove('is-open');
    });
  }

  // Liquid Glass Cursor Sheen Refraction
  const glassButtons = document.querySelectorAll('.liquid-glass');
  glassButtons.forEach((btn) => {
    const sheen = document.createElement('span');
    sheen.className = 'sheen-glow';
    btn.appendChild(sheen);

    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      sheen.style.left = `${x}px`;
      sheen.style.top = `${y}px`;
    });

    btn.addEventListener('mouseleave', () => {
      sheen.style.opacity = '0';
    });
    btn.addEventListener('mouseenter', () => {
      sheen.style.opacity = '1';
    });
  });

  // 12. Initialize Central Audio Visualizer / Music Spectrum
  initAudioVisualizer();

  // Dismiss toast on click/tap
  const toastEl = document.getElementById('journey-toast');
  if (toastEl) {
    toastEl.addEventListener('click', () => {
      toastEl.classList.remove('show');
      clearTimeout(toastTimeout);
    });
  }

  // Network Connection Change Listener: auto-adjust quality when connection type changes (e.g. WiFi → 4G → 3G)
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', () => {
        if (isMobileDevice && (videoQuality === 'auto' || videoQuality === 'medium')) {
          const newQ = getConnectionAwareQuality();
          if (isPlayerReady && ytPlayer && videoMode !== 'default') {
            try {
              ytPlayer.setPlaybackQuality(newQ);
              if (typeof ytPlayer.setPlaybackQualityRange === 'function') {
                ytPlayer.setPlaybackQualityRange('tiny', newQ);
              }
              const qName = QUALITY_INFO_MAP[newQ] ? QUALITY_INFO_MAP[newQ].badge : newQ;
              showToast(`📶 Koneksi berubah, kualitas disesuaikan: ${qName}`);
            } catch (e) {}
          }
        }
      });
    }
  } catch (e) {}
});

// ==========================================================================
// Central Audio Visualizer / Music Spectrum Engine
// ==========================================================================
let vizCanvas = null;
let vizCtx = null;
let vizAnimationId = null;
let vizMode = 'bars'; // Default: 'bars' (Studio EQ)
const NUM_VIZ_BARS = isMobileDevice ? 48 : 96;
let vizBars = new Float32Array(NUM_VIZ_BARS);
let vizPeaks = new Float32Array(NUM_VIZ_BARS);
let vizPeakSpeed = new Float32Array(NUM_VIZ_BARS);

function initAudioVisualizer() {
  vizCanvas = document.getElementById('center-visualizer');
  if (!vizCanvas) return;
  vizCtx = vizCanvas.getContext('2d');
  if (!vizCtx) return;

  // Initialize random slight baseline
  for (let i = 0; i < NUM_VIZ_BARS; i++) {
    vizBars[i] = 0.06 + Math.random() * 0.05;
    vizPeaks[i] = vizBars[i];
    vizPeakSpeed[i] = 0;
  }

  resizeVisualizer();
  window.addEventListener('resize', resizeVisualizer);

  // Mode Switcher Pills
  const modeBtns = document.querySelectorAll('#visualizer-mode-pills .viz-mode-btn');
  const vizModeLabel = document.getElementById('current-viz-mode-label');
  const VIZ_MODE_NAMES = {
    'bars': 'Studio EQ',
    'wave': 'Waveform',
    'spectrum': 'Spectrum'
  };

  modeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      vizMode = btn.getAttribute('data-mode') || 'bars';
      if (vizModeLabel) {
        vizModeLabel.textContent = VIZ_MODE_NAMES[vizMode] || vizMode;
      }
    });
  });

  // Start 60fps render loop
  if (vizAnimationId) cancelAnimationFrame(vizAnimationId);
  vizAnimationId = requestAnimationFrame(renderVisualizer);
}

function resizeVisualizer() {
  if (!vizCanvas) return;
  const rect = vizCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  vizCanvas.width = Math.floor(rect.width * dpr);
  vizCanvas.height = Math.floor(rect.height * dpr);
  if (vizCtx) {
    if (typeof vizCtx.resetTransform === 'function') {
      vizCtx.resetTransform();
    } else {
      vizCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    vizCtx.scale(dpr, dpr);
  }
}

// Draw rounded rectangle helper
function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (width <= 0 || height <= 0) return;
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

let lastVizTimestamp = 0;

function renderVisualizer(timestamp) {
  if (!vizCanvas || !vizCtx) {
    vizAnimationId = requestAnimationFrame(renderVisualizer);
    return;
  }

  // When tab is hidden or phone screen is off, pause visualizer to save 100% CPU/GPU resources
  if (typeof document !== 'undefined' && document.hidden) {
    vizAnimationId = requestAnimationFrame(renderVisualizer);
    return;
  }

  // Mobile optimization: throttle visualizer to ~30fps to free up CPU and GPU bandwidth for video decoding
  if (isMobileDevice) {
    if (timestamp - lastVizTimestamp < 33) {
      vizAnimationId = requestAnimationFrame(renderVisualizer);
      return;
    }
    lastVizTimestamp = timestamp;
  }

  const rect = vizCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (width <= 0 || height <= 0) {
    vizAnimationId = requestAnimationFrame(renderVisualizer);
    return;
  }

  vizCtx.clearRect(0, 0, width, height);

  const t = timestamp * 0.003;
  const volMult = Math.max(0.08, (lastVolume / 100));

  // Compute energy targets
  if (isPlaying) {
    const beat1 = Math.max(0, Math.sin(t * 3.8)) ** 4;
    const beat2 = Math.max(0, Math.cos(t * 1.9)) ** 6;
    const tempoDrop = (beat1 * 0.42 + beat2 * 0.3) * volMult;

    for (let i = 0; i < NUM_VIZ_BARS; i++) {
      // Mirrored distance from center (0 at center, 1 at edges)
      const centerDist = Math.abs(i - (NUM_VIZ_BARS - 1) / 2) / ((NUM_VIZ_BARS - 1) / 2);
      const freqNorm = 1.0 - centerDist;

      // Harmonic sine waves
      const h1 = Math.sin(t * 4.2 + freqNorm * Math.PI * 3.2);
      const h2 = Math.cos(t * 7.5 - freqNorm * Math.PI * 5.4);
      const h3 = Math.sin(t * 13.1 + freqNorm * Math.PI * 8.1);
      const h4 = Math.cos(t * 1.2);

      let target = (h1 * 0.3 + h2 * 0.22 + h3 * 0.16 + h4 * 0.18 + 0.45);
      
      // Bass boost in center
      if (centerDist < 0.35) {
        target += tempoDrop * (1 - centerDist * 2.2);
      } else {
        // High frequency shimmer at edges
        target += Math.sin(t * 16 + i * 0.7) * 0.12 * volMult;
      }

      target = target * (0.5 + (1 - centerDist) * 0.5) * volMult;
      target = Math.min(0.96, Math.max(0.06, target));

      // Elastic smoothing
      vizBars[i] += (target - vizBars[i]) * 0.28;

      // Peak hold logic
      if (vizBars[i] > vizPeaks[i]) {
        vizPeaks[i] = vizBars[i];
        vizPeakSpeed[i] = 0;
      } else {
        vizPeakSpeed[i] += 0.0016;
        vizPeaks[i] = Math.max(0.04, vizPeaks[i] - vizPeakSpeed[i]);
      }
    }
  } else {
    // Ambient breathing motion when paused
    for (let i = 0; i < NUM_VIZ_BARS; i++) {
      const centerDist = Math.abs(i - (NUM_VIZ_BARS - 1) / 2) / ((NUM_VIZ_BARS - 1) / 2);
      const target = 0.06 + Math.sin(t * 1.6 + i * 0.2) * 0.035 * (1 - centerDist * 0.4);
      vizBars[i] += (target - vizBars[i]) * 0.1;
      vizPeaks[i] = vizBars[i];
    }
  }

  // Draw according to active mode
  if (vizMode === 'spectrum') {
    drawSpectrumMode(width, height);
  } else if (vizMode === 'wave') {
    drawWaveMode(width, height, t);
  } else if (vizMode === 'bars') {
    drawStudioEqMode(width, height);
  }

  vizAnimationId = requestAnimationFrame(renderVisualizer);
}

// Mode 1: Mirrored Frequency Spectrum with Floating Peaks & Glowing Neon Gradient
function drawSpectrumMode(width, height) {
  const barWidth = width / NUM_VIZ_BARS;
  const gap = Math.max(1, barWidth * 0.28);
  const effectiveWidth = Math.max(1.5, barWidth - gap);

  for (let i = 0; i < NUM_VIZ_BARS; i++) {
    const barH = vizBars[i] * (height * 0.84);
    const x = i * barWidth + gap / 2;
    const y = height - barH - 2;

    // Gradient styling
    const grad = vizCtx.createLinearGradient(0, height, 0, y);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.15)'); // Cyan subtle shadow
    grad.addColorStop(0.4, 'rgba(56, 189, 248, 0.85)'); // Electric cyan
    grad.addColorStop(0.85, 'rgba(168, 85, 247, 0.95)'); // Violet purple
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.98)'); // Bright white apex

    vizCtx.fillStyle = grad;
    drawRoundedRect(vizCtx, x, y, effectiveWidth, barH, 2);

    // Floating Peak Dot
    const peakH = vizPeaks[i] * (height * 0.84);
    const peakY = Math.max(2, height - peakH - 5);

    vizCtx.save();
    vizCtx.fillStyle = '#ffffff';
    if (!isMobileDevice) {
      vizCtx.shadowColor = '#38bdf8';
      vizCtx.shadowBlur = 4;
    }
    vizCtx.fillRect(x, peakY, effectiveWidth, 1.8);
    vizCtx.restore();
  }
}

// Mode 2: Fluid Oscilloscope Waveform Ribbon
function drawWaveMode(width, height, t) {
  const midY = height / 2;

  // Wave 1: Background Emerald Wave
  vizCtx.save();
  vizCtx.beginPath();
  vizCtx.moveTo(0, midY);
  for (let i = 0; i < NUM_VIZ_BARS; i++) {
    const x = (i / (NUM_VIZ_BARS - 1)) * width;
    const amp = vizBars[i] * (height * 0.35);
    const y = midY + Math.sin(t * 3.5 + i * 0.3) * amp;
    if (i === 0) vizCtx.moveTo(x, y);
    else vizCtx.lineTo(x, y);
  }
  vizCtx.strokeStyle = 'rgba(52, 211, 153, 0.35)'; // Mint
  vizCtx.lineWidth = 1.5;
  vizCtx.stroke();
  vizCtx.restore();

  // Wave 2: Midground Violet Wave
  vizCtx.save();
  vizCtx.beginPath();
  vizCtx.moveTo(0, midY);
  for (let i = 0; i < NUM_VIZ_BARS; i++) {
    const x = (i / (NUM_VIZ_BARS - 1)) * width;
    const amp = vizBars[i] * (height * 0.42);
    const y = midY - Math.cos(t * 2.8 + i * 0.25) * amp;
    if (i === 0) vizCtx.moveTo(x, y);
    else vizCtx.lineTo(x, y);
  }
  vizCtx.strokeStyle = 'rgba(192, 132, 252, 0.65)'; // Purple
  vizCtx.lineWidth = 2;
  vizCtx.stroke();
  vizCtx.restore();

  // Wave 3: Foreground Primary Cyan Wave with Area Fill
  vizCtx.save();
  const fillGrad = vizCtx.createLinearGradient(0, midY - height * 0.45, 0, height);
  fillGrad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
  fillGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  vizCtx.beginPath();
  vizCtx.moveTo(0, height);
  vizCtx.lineTo(0, midY);

  const points = [];
  for (let i = 0; i < NUM_VIZ_BARS; i++) {
    const x = (i / (NUM_VIZ_BARS - 1)) * width;
    const amp = vizBars[i] * (height * 0.48);
    const y = midY + Math.sin(t * 4.5 + i * 0.22) * amp;
    points.push({ x, y });
  }

  for (let i = 0; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    vizCtx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  const last = points[points.length - 1];
  vizCtx.lineTo(last.x, last.y);
  vizCtx.lineTo(width, height);
  vizCtx.closePath();

  vizCtx.fillStyle = fillGrad;
  vizCtx.fill();

  // Main Neon Stroke
  vizCtx.beginPath();
  vizCtx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    vizCtx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  vizCtx.lineTo(last.x, last.y);
  vizCtx.strokeStyle = '#38bdf8';
  vizCtx.lineWidth = 2.5;
  if (!isMobileDevice) {
    vizCtx.shadowColor = '#38bdf8';
    vizCtx.shadowBlur = 8;
  }
  vizCtx.stroke();
  vizCtx.restore();
}

// Mode 3: Studio Equalizer Multi-Band (Discrete LED segments)
function drawStudioEqMode(width, height) {
  const bands = Math.min(64, Math.max(24, Math.floor(width / 24)));
  const bandWidth = width / bands;
  const gap = Math.max(2, bandWidth * 0.28);
  const w = bandWidth - gap;
  const numSegments = 12;
  const segHeight = (height * 0.8) / numSegments;
  const segGap = 1.5;

  for (let i = 0; i < bands; i++) {
    const barIdx = Math.floor((i / bands) * NUM_VIZ_BARS);
    const energy = vizBars[barIdx];
    const peakEnergy = vizPeaks[barIdx];
    const activeSegments = Math.round(energy * numSegments);
    const peakSegment = Math.min(numSegments - 1, Math.round(peakEnergy * numSegments));
    const x = i * bandWidth + gap / 2;

    for (let s = 0; s < numSegments; s++) {
      const y = height - (s + 1) * segHeight;
      const isActive = s < activeSegments;
      const isPeak = s === peakSegment;

      if (isActive || isPeak) {
        if (s < 6) {
          vizCtx.fillStyle = isActive ? 'rgba(56, 189, 248, 0.9)' : 'rgba(56, 189, 248, 0.3)'; // Cyan
        } else if (s < 9) {
          vizCtx.fillStyle = isActive ? 'rgba(250, 204, 21, 0.95)' : 'rgba(250, 204, 21, 0.35)'; // Amber
        } else {
          vizCtx.fillStyle = isActive ? 'rgba(244, 63, 94, 1.0)' : 'rgba(244, 63, 94, 0.4)'; // Rose
        }
      } else {
        vizCtx.fillStyle = 'rgba(255, 255, 255, 0.04)'; // Inactive LED ghost
      }

      vizCtx.fillRect(x, y + segGap / 2, w, segHeight - segGap);
    }
  }
}

