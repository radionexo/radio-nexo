'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, Volume1, VolumeX, Heart, Radio, Music2 } from 'lucide-react';
import { radioStore, getLiveSongProgress } from '@/lib/radioStore';
import { StationState } from '@/lib/types';

const VOLUME_STORAGE_KEY = 'nexo_listener_volume_v1';
const MUTED_STORAGE_KEY = 'nexo_listener_muted_v1';

interface PublicPlayerProps {
  onOpenRequestModal: () => void;
}

export default function PublicPlayer({ onOpenRequestModal }: PublicPlayerProps) {
  const [stationState, setStationState] = useState<StationState>(radioStore.getStationState());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [heartAnimation, setHeartAnimation] = useState(false);
  const [likeToast, setLikeToast] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Restore saved volume and muted state from localStorage
  useEffect(() => {
    try {
      const savedVol = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (savedVol !== null) {
        const parsed = parseFloat(savedVol);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          setVolume(parsed);
          if (audioRef.current) {
            audioRef.current.volume = parsed;
          }
        }
      }
      const savedMuted = localStorage.getItem(MUTED_STORAGE_KEY);
      if (savedMuted !== null) {
        setIsMuted(savedMuted === 'true');
      }
    } catch (e) {
      console.warn('Could not read volume preference:', e);
    }
  }, []);

  const handleVolumeChange = (newVal: number) => {
    const clamped = Math.max(0, Math.min(1, newVal));
    setVolume(clamped);
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : clamped;
    }
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
      try {
        localStorage.setItem(MUTED_STORAGE_KEY, 'false');
      } catch {}
    }
    if (clamped === 0 && !isMuted) {
      setIsMuted(true);
      try {
        localStorage.setItem(MUTED_STORAGE_KEY, 'true');
      } catch {}
    }
    try {
      if (clamped > 0) {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
      }
    } catch {}
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (audioRef.current) {
        audioRef.current.volume = next ? 0 : volume;
      }
      try {
        localStorage.setItem(MUTED_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  // Sync station state in real-time
  useEffect(() => {
    const update = () => {
      setStationState(radioStore.getStationState());
    };
    const unsubscribe = radioStore.subscribe(update);
    update();
    return () => unsubscribe();
  }, []);

  // Check if current playing song is in favorites
  useEffect(() => {
    let isMounted = true;
    const checkFavorite = async () => {
      const songs = await radioStore.getSongs();
      const current = songs.find(
        (s) =>
          (stationState.current_song_id && s.id === stationState.current_song_id) ||
          (stationState.current_song_title &&
            s.title.toLowerCase().trim() === stationState.current_song_title.toLowerCase().trim())
      );
      if (isMounted) {
        setIsLiked(Boolean(current?.is_favorite));
      }
    };
    checkFavorite();
    const unsub = radioStore.subscribe(checkFavorite);
    return () => {
      isMounted = false;
      unsub();
    };
  }, [stationState.current_song_id, stationState.current_song_title]);

  const handleToggleFavorite = async () => {
    try {
      const songs = await radioStore.getSongs();
      let activeSong = songs.find(
        (s) =>
          (stationState.current_song_id && s.id === stationState.current_song_id) ||
          (stationState.current_song_title &&
            s.title.toLowerCase().trim() === stationState.current_song_title.toLowerCase().trim())
      );

      // If active song is not yet in library, add it with is_favorite = true
      if (!activeSong && stationState.current_song_title) {
        activeSong = await radioStore.addSong({
          title: stationState.current_song_title,
          artist: stationState.current_song_artist || 'Radio Nexo',
          genre: 'Pop',
          file_url: stationState.current_song_url || '/songs/summer.mp3',
          cover_url: stationState.current_song_cover || '/cover_default.webp',
          duration: stationState.current_song_duration || 180,
          is_favorite: true,
        });
        setIsLiked(true);
        setHeartAnimation(true);
        setLikeToast('¡Guardada en Favoritas!');
        setTimeout(() => setHeartAnimation(false), 800);
        setTimeout(() => setLikeToast(null), 3000);
        return;
      }

      if (activeSong) {
        const nextFav = await radioStore.toggleFavorite(activeSong.id);
        setIsLiked(nextFav);
        setHeartAnimation(nextFav);
        setLikeToast(nextFav ? '¡Guardada en Favoritas!' : 'Eliminada de Favoritas');
        setTimeout(() => setHeartAnimation(false), 800);
        setTimeout(() => setLikeToast(null), 3000);
      }
    } catch (err) {
      console.error('Error toggling favorite from player:', err);
    }
  };

  // Stream URL from Render or custom environment
  const LIVE_STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL || 'https://nexo-radio-bridge-axxt.onrender.com/live';

  const checkIfLiveStream = (src?: string | null) => {
    if (!src) return false;
    if (LIVE_STREAM_URL && src.includes(LIVE_STREAM_URL.split('?')[0])) return true;
    return src.includes('live') || src.includes('onrender.com');
  };

  // Dedicated iOS-compatible direct track playback coordinator
  const playDirectTrack = async (targetSongUrl: string, syncTime: number) => {
    if (!audioRef.current) return;
    const audio = audioRef.current;

    const isSameSource = audio.src && (audio.src === targetSongUrl || audio.src.endsWith(targetSongUrl));

    if (!isSameSource) {
      audio.src = targetSongUrl;
      audio.preload = 'auto';
    }

    if (syncTime <= 0) {
      try {
        audio.currentTime = 0;
      } catch {}
    }

    audio.volume = isMuted ? 0 : (volume || 0.85);

    // Multi-stage seek coordinator for iOS Safari:
    // On iOS Safari, audio.currentTime must be set once metadata is loaded or when playback starts.
    let seekApplied = false;
    const applySeek = () => {
      if (seekApplied || syncTime <= 0) return;
      try {
        if (Math.abs(audio.currentTime - syncTime) > 1.5) {
          audio.currentTime = syncTime;
          seekApplied = true;
        }
      } catch (err) {
        console.warn('Seek attempt notice:', err);
      }
    };

    if (syncTime > 0) {
      if (audio.readyState >= 1) {
        applySeek();
      } else {
        audio.addEventListener('loadedmetadata', applySeek, { once: true });
        audio.addEventListener('canplay', applySeek, { once: true });
      }
      audio.addEventListener('playing', applySeek, { once: true });
    }

    if (!isSameSource) {
      audio.load();
    }

    await audio.play();
    setIsPlaying(true);
    setIsLoading(false);

    // Deferred seek verification for iOS Safari quirks
    if (syncTime > 0) {
      setTimeout(() => {
        if (!seekApplied || audio.currentTime < 2) {
          applySeek();
        }
      }, 250);

      setTimeout(() => {
        if (syncTime > 3 && audio.currentTime < 2) {
          try {
            audio.currentTime = syncTime;
          } catch {}
        }
      }, 750);
    }
  };

  // Auto-switch track when song changes in stationState while playing direct tracks
  useEffect(() => {
    if (isPlaying && audioRef.current) {
      const currentSrc = audioRef.current.src || '';
      const isLiveStream = currentSrc.includes('live') || currentSrc.includes('onrender.com');

      if (!isLiveStream) {
        radioStore.getSongs().then((songs) => {
          const activeSong = songs.find(
            (s) =>
              (stationState.current_song_id && s.id === stationState.current_song_id) ||
              (stationState.current_song_title && s.title.toLowerCase() === stationState.current_song_title.toLowerCase())
          );
          let targetUrl = stationState.current_song_url || activeSong?.file_url || '/songs/summer.mp3';
          if (!targetUrl || targetUrl.includes('pixabay.com')) {
            targetUrl = '/songs/summer.mp3';
          }
          if (audioRef.current && !audioRef.current.src.endsWith(targetUrl) && audioRef.current.src !== targetUrl) {
            const syncTime = getLiveSongProgress(stationState);
            playDirectTrack(targetUrl, syncTime).catch(console.warn);
          }
        });
      }
    }
  }, [stationState.current_song_id, stationState.current_song_title, stationState.current_song_url, isPlaying]);

  // Initialize audio element with iOS-friendly attributes
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audioRef.current = audio;

    audio.addEventListener('playing', () => {
      setIsPlaying(true);
      setIsLoading(false);
    });

    audio.addEventListener('canplay', () => {
      setIsLoading(false);
    });

    audio.addEventListener('waiting', () => {
      setIsLoading(true);
    });

    audio.addEventListener('stalled', () => {
      console.warn('[Player Watchdog] Audio buffer stalled, waiting for data...');
    });

    // Handle track completion or live stream recycle
    audio.addEventListener('ended', async () => {
      const currentSrc = audio.src || '';
      const isLive = checkIfLiveStream(currentSrc);
      const current = radioStore.getStationState();

      if (isLive) {
        // If broadcaster is actively on air, reconnect with fresh timestamp
        const isBroadcastingNow = Boolean(current.is_live || current.is_mic_active || current.current_song_title === 'DJ EN VIVO');
        if (isBroadcastingNow) {
          console.log('[Player Watchdog] Live stream connection recycled, auto-reconnecting...');
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.src = `${LIVE_STREAM_URL}?t=${Date.now()}`;
              audioRef.current.play().catch(console.warn);
            }
          }, 300);
          return;
        } else {
          // Broadcaster stopped / disconnected -> immediately switch to continuous library music
          console.log('[Player Watchdog] Transmisión en vivo cerrada por recarga/salida, pasando a música de biblioteca...');
          const syncTime = getLiveSongProgress(current);
          const fallbackUrl = current.current_song_url || '/songs/summer.mp3';
          playDirectTrack(fallbackUrl, syncTime).catch(console.warn);
          return;
        }
      }

      // If station is on air, NEVER advance library music; stay on the live stream!
      if (current.is_live || current.is_mic_active || current.current_song_title === 'DJ EN VIVO') {
        if (LIVE_STREAM_URL && audioRef.current) {
          audioRef.current.src = `${LIVE_STREAM_URL}?t=${Date.now()}`;
          audioRef.current.play().catch(console.warn);
        }
        return;
      }

      // Direct track completed -> advance smoothly to next track in rotation locally
      // (WITHOUT calling updateStationState, which would overwrite the station state)
      try {
        const songs = await radioStore.getSongs();
        if (songs && songs.length > 0) {
          const currentIndex = songs.findIndex(
            (s) =>
              (current.current_song_id && s.id === current.current_song_id) ||
              (current.current_song_title && s.title.toLowerCase() === current.current_song_title.toLowerCase())
          );
          const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % songs.length : 0;
          const nextSong = songs[nextIndex] || songs[0];
          const nextUrl = nextSong.file_url || '/songs/summer.mp3';

          await playDirectTrack(nextUrl, 0);
          return;
        }
      } catch (err) {
        console.warn('Error advancing direct track:', err);
      }

      playDirectTrack('/songs/summer.mp3', 0).catch(console.warn);
    });

    audio.addEventListener('error', (e) => {
      console.warn('Audio connection notice, evaluating fallback:', e);
      const currentSrc = audio.src || '';
      const isLiveStream = checkIfLiveStream(currentSrc);
      const current = radioStore.getStationState();

      if (isLiveStream) {
        const isBroadcastingNow = Boolean(current.is_live || current.is_mic_active || current.current_song_title === 'DJ EN VIVO');
        if (isBroadcastingNow) {
          // Broadcaster is live on air; re-trigger live stream instead of abruptly playing songs!
          console.warn('[Player Watchdog] Live stream connection notice during live session, reconnecting in 500ms...');
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.src = `${LIVE_STREAM_URL}?t=${Date.now()}`;
              audioRef.current.play().catch(console.warn);
            }
          }, 500);
          return;
        }

        const syncTime = getLiveSongProgress(current);
        const targetUrl = current.current_song_url || '/songs/summer.mp3';
        playDirectTrack(targetUrl, syncTime).catch(console.warn);
      } else {
        const fallback = currentSrc.includes('summer') ? '/songs/flowers.mp3' : '/songs/summer.mp3';
        playDirectTrack(fallback, 0).catch(console.warn);
      }
    });

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Gentle resynchronization for direct playback:
  // Only sync if track changes or on massive drift (> 15s), avoiding audio micro-stutters during normal playback
  useEffect(() => {
    if (isPlaying && audioRef.current) {
      const currentSrc = audioRef.current.src || '';
      const isLiveStream = checkIfLiveStream(currentSrc);
      if (!isLiveStream) {
        const liveSec = getLiveSongProgress(stationState);
        if (liveSec > 0 && Math.abs(audioRef.current.currentTime - liveSec) > 15) {
          try {
            audioRef.current.currentTime = liveSec;
          } catch {}
        }
      }
    }
  }, [stationState.current_song_id, stationState.updated_at, isPlaying]);

  // Active Playback Watchdog: Ensures audio keeps playing & auto-recovers from silent network stalls
  useEffect(() => {
    if (!isPlaying) return;

    let lastObservedTime = -1;
    let frozenChecks = 0;

    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const current = radioStore.getStationState();
      const currentSrc = audio.src || '';
      const isLiveStream = checkIfLiveStream(currentSrc);

      const isBroadcastingNow = Boolean(current.is_live || current.is_mic_active || current.current_song_title === 'DJ EN VIVO');

      // 1. If station is on air, guarantee listener is connected to the live MP3 stream
      if (isBroadcastingNow) {
        if (!isLiveStream) {
          console.log('[Player Watchdog] Emisión en vivo detectada por watchdog, conectando al stream MP3...');
          frozenChecks = 0;
          lastObservedTime = -1;
          audio.src = `${LIVE_STREAM_URL}?t=${Date.now()}`;
          audio.play().catch(console.warn);
          return;
        }

        // Detect silent network freeze (currentTime stuck for >= 7.5s on mobile 4G/5G)
        if (!audio.paused) {
          if (Math.abs(audio.currentTime - lastObservedTime) < 0.05) {
            frozenChecks++;
            if (frozenChecks >= 3) {
              console.warn('[Player Watchdog] Stream congelado por red (>7.5s), reconectando limpiamente...');
              frozenChecks = 0;
              lastObservedTime = -1;
              audio.src = `${LIVE_STREAM_URL}?t=${Date.now()}`;
              audio.play().catch(console.warn);
              return;
            }
          } else {
            frozenChecks = 0;
            lastObservedTime = audio.currentTime;
          }
        } else if (isPlaying && !isLoading) {
          audio.play().catch(console.warn);
        }
        return;
      }

      // 2. If user intended to play music, but the audio element paused unexpectedly (OS sleep, audio focus change, etc.)
      if (audio.paused && !audio.ended && isPlaying && !isLoading) {
        console.warn('[Player Watchdog] Detected unexpected pause during playback, resuming...');
        audio.play().catch((err) => {
          console.warn('[Player Watchdog] Auto-resume error, falling back to direct track:', err);
          const syncTime = getLiveSongProgress(current);
          const fallbackUrl = current.current_song_url || '/songs/summer.mp3';
          playDirectTrack(fallbackUrl, syncTime).catch(console.warn);
        });
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isPlaying, isLoading]);

  // Screen unlock / VisibilityChange resync for mobile devices (iPhone Safari)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isPlaying && audioRef.current) {
        const currentSrc = audioRef.current.src || '';
        const isLiveStream = checkIfLiveStream(currentSrc);
        if (!isLiveStream) {
          const liveSec = getLiveSongProgress(radioStore.getStationState());
          if (liveSec > 0 && Math.abs(audioRef.current.currentTime - liveSec) > 4) {
            try {
              audioRef.current.currentTime = liveSec;
            } catch {}
          }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isPlaying]);

  // Real-time synchronization when station goes on air or leaves the air:
  useEffect(() => {
    if (isPlaying && audioRef.current && LIVE_STREAM_URL) {
      const audio = audioRef.current;
      const isLiveNow = Boolean(stationState.is_live || stationState.is_mic_active || stationState.current_song_title === 'DJ EN VIVO');
      const currentSrc = audio.src || '';
      const onLiveStream = checkIfLiveStream(currentSrc);

      if (isLiveNow && !onLiveStream) {
        console.log('[Player] Emisión en vivo iniciada desde el estudio, conectando al stream directo...');
        audio.src = `${LIVE_STREAM_URL}?t=${Date.now()}`;
        audio.play().catch((err) => {
          console.warn('Could not switch to live stream on broadcast active:', err);
        });
      } else if (!isLiveNow && onLiveStream) {
        console.log('[Player] Emisión en vivo finalizada, pasando a música de biblioteca...');
        const syncTime = getLiveSongProgress(stationState);
        const targetUrl = stationState.current_song_url || '/songs/summer.mp3';
        playDirectTrack(targetUrl, syncTime).catch(console.warn);
      }
    }
  }, [stationState.is_mic_active, stationState.is_live, isPlaying]);

  const togglePlay = async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsLoading(true);

      const songs = await radioStore.getSongs();
      const activeSong = songs.find(
        (s) =>
          (stationState.current_song_id && s.id === stationState.current_song_id) ||
          (stationState.current_song_title && s.title.toLowerCase() === stationState.current_song_title.toLowerCase())
      ) || songs[0];
      let targetUrl = stationState.current_song_url || activeSong?.file_url || '/songs/summer.mp3';
      if (!targetUrl || targetUrl.includes('pixabay.com')) {
        targetUrl = '/songs/summer.mp3';
      }
      const syncTime = getLiveSongProgress(stationState);

      // Primary: Connect to the live radio stream from Render if broadcast or mic is active
      if (LIVE_STREAM_URL && (stationState.is_live || stationState.is_mic_active)) {
        try {
          audioRef.current.src = `${LIVE_STREAM_URL}?t=${Date.now()}`;
          audioRef.current.volume = isMuted ? 0 : (volume || 0.85);
          // Do not call .load() on iOS right before play() to preserve user gesture activation token
          await audioRef.current.play();
          setIsPlaying(true);
          setIsLoading(false);
          return;
        } catch (err) {
          console.warn('Live stream unavailable, falling back to direct track:', err);
        }
      }

      // Fallback: Plays the active song synchronized to the exact current live progress ("en donde vamos")!
      try {
        await playDirectTrack(targetUrl, syncTime);
      } catch (playErr) {
        console.warn('Playback error with targetUrl, retrying local fallback:', playErr);
        try {
          await playDirectTrack('/songs/summer.mp3', syncTime);
        } catch (e2) {
          console.error('Final fallback error:', e2);
          setIsLoading(false);
        }
      }
    }
  };

  const isDjLive = Boolean(
    stationState.is_mic_active ||
    stationState.current_song_title === 'DJ EN VIVO'
  );

  return (
    <div className="relative flex flex-col items-center justify-center w-full max-w-2xl mx-auto px-4 py-1 sm:py-2">
      {/* Vinyl Aura & Rotating Center Disc */}
      <div className="relative flex items-center justify-center my-2 sm:my-3 group">
        {/* Radial Dotted Audio Glow Ring */}
        <div className={`absolute w-60 h-60 sm:w-72 sm:h-72 lg:w-80 lg:h-80 rounded-full border border-dashed border-[#e5b45f]/25 transition-all duration-1000 ${
          isPlaying ? 'animate-pulse-gold scale-105' : 'opacity-30 scale-95'
        }`} />

        {/* Ambient Warm Golden Aura */}
        <div className={`absolute w-52 h-52 sm:w-64 sm:h-64 lg:w-72 lg:h-72 rounded-full bg-[#e5b45f]/15 blur-2xl transition-opacity duration-700 ${
          isPlaying ? 'opacity-100' : 'opacity-20'
        }`} />

        {/* Dotted Accent Ring */}
        <div className="absolute w-[200px] h-[200px] sm:w-[250px] sm:h-[250px] lg:w-[270px] lg:h-[270px] rounded-full border border-[#e5b45f]/30 flex items-center justify-center">
          <div className="w-full h-full rounded-full border border-dotted border-[#e5b45f]/40 animate-spin-slow" />
        </div>

        {/* Outer Golden Border Rim */}
        <div className="relative w-44 h-44 sm:w-56 sm:h-56 lg:w-64 lg:h-64 rounded-full p-1.5 bg-gradient-to-tr from-[#d9a149] via-[#f3c87a] to-[#966b26] shadow-2xl shadow-[#e5b45f]/30">
          {/* Inner Disc / Cover Art Container */}
          <div className={`w-full h-full rounded-full overflow-hidden relative shadow-inner bg-black ${
            isPlaying ? 'animate-spin-slow' : ''
          }`}>
            <img
              src={stationState.current_song_cover || '/cover_default.webp'}
              alt={stationState.current_song_title}
              className="w-full h-full object-cover object-center filter brightness-90 contrast-105"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/cover_default.webp';
              }}
            />
            {/* Dark vinyl grooves overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />

            {/* Center vinyl spindle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-neutral-800 to-black border-2 border-[#e5b45f]/60 shadow-lg flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-[#e5b45f]" />
            </div>

            {/* Mockup Typography inside the disc */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-3 pointer-events-none">
              <span className="text-[9px] sm:text-[11px] font-semibold tracking-widest uppercase text-white/90 drop-shadow-md">
                {isDjLive ? 'RADIO NEXO' : stationState.current_song_artist.toUpperCase()}
              </span>
              <span className="text-xs sm:text-lg font-bold tracking-wider uppercase text-white drop-shadow-lg truncate max-w-[85%]">
                {isDjLive ? 'DJ EN VIVO' : stationState.current_song_title.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Song Metadata Display / Live DJ Indicator */}
      <div className="text-center mt-1 sm:mt-2 z-10">
        <div className="flex items-center justify-center gap-2">
          {isDjLive && (
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            </span>
          )}
          <h2 className={`text-xl sm:text-3xl font-bold tracking-tight drop-shadow-md truncate max-w-lg ${
            isDjLive ? 'text-rose-400 font-black' : 'text-white'
          }`}>
            {isDjLive ? 'DJ EN VIVO' : stationState.current_song_title}
          </h2>
        </div>
        <p className="text-xs sm:text-sm font-medium text-[#e5b45f] mt-0.5 tracking-wide">
          {isDjLive ? 'Sesión en Directo · Radio Nexo' : stationState.current_song_artist}
        </p>
      </div>

      {/* Primary Player Controls */}
      <div className="flex items-center justify-center gap-5 sm:gap-7 mt-3 sm:mt-4 z-10">
        {/* Like Button with Toast */}
        <div className="relative flex items-center justify-center">
          <button
            onClick={handleToggleFavorite}
            className={`p-2.5 sm:p-3 rounded-full transition-all duration-200 active:scale-90 ${
              isLiked
                ? 'text-rose-500 hover:text-rose-400 bg-rose-500/10'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
            title={isLiked ? 'Quitar de la playlist de favoritas' : 'Guardar en la playlist de favoritas'}
            aria-label={isLiked ? 'Quitar de la playlist de favoritas' : 'Guardar en la playlist de favoritas'}
          >
            <Heart
              className={`w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 ${
                isLiked ? 'fill-current' : ''
              } ${heartAnimation ? 'scale-125 text-rose-500 animate-pulse' : ''}`}
            />
          </button>

          {likeToast && (
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-neutral-900/95 border border-white/15 text-[11px] font-semibold text-white shadow-2xl flex items-center gap-1.5 whitespace-nowrap animate-in fade-in zoom-in-95 duration-200 pointer-events-none z-30">
              <Heart className="w-3 h-3 text-rose-500 fill-current" />
              <span>{likeToast}</span>
            </div>
          )}
        </div>

        {/* Big Glowing Play / Pause Button */}
        <button
          onClick={togglePlay}
          disabled={isLoading}
          aria-label={isPlaying ? 'Pausar transmisión' : 'Escuchar en vivo'}
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all duration-300 transform active:scale-95 cursor-pointer ${
            isPlaying
              ? 'bg-[#e5b45f] text-black shadow-lg shadow-[#e5b45f]/40 ring-4 ring-[#e5b45f]/20 scale-105'
              : 'bg-gradient-to-tr from-[#d9a149] to-[#f3c87a] text-black shadow-xl shadow-[#e5b45f]/30 hover:scale-105'
          }`}
        >
          {isLoading ? (
            <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
          ) : (
            <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current ml-0.5" />
          )}
        </button>

        {/* Volume Control Pill (Mute toggle + Slider + Percentage) */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-black/40 border border-white/10 backdrop-blur-md transition-all shadow-md">
          <button
            type="button"
            onClick={handleToggleMute}
            className={`p-1.5 rounded-full transition-all duration-200 active:scale-90 cursor-pointer ${
              isMuted || volume === 0
                ? 'text-rose-400 bg-rose-500/10'
                : 'text-gray-300 hover:text-white hover:bg-white/10'
            }`}
            title={isMuted ? 'Activar sonido' : 'Silenciar'}
            aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400" />
            ) : volume < 0.5 ? (
              <Volume1 className="w-4 h-4 sm:w-5 sm:h-5 text-[#e5b45f]" />
            ) : (
              <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 text-[#e5b45f]" />
            )}
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-16 sm:w-24 accent-[#e5b45f] h-1.5 bg-white/20 rounded-lg cursor-pointer transition-all hover:bg-white/30"
            title={`Volumen: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
            aria-label="Control de volumen"
          />

          <span className="text-[10px] sm:text-[11px] font-mono text-gray-300 w-7 text-right select-none font-medium">
            {Math.round((isMuted ? 0 : volume) * 100)}%
          </span>
        </div>
      </div>

      {/* Live Badge Status & Song Request Button */}
      <div className="mt-3 sm:mt-4 flex flex-wrap items-center justify-center gap-2.5 z-10">
        <div className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full border backdrop-blur-md transition-all ${
          isDjLive
            ? 'border-rose-500/60 bg-rose-500/15 shadow-sm shadow-rose-500/30'
            : 'border-[#e5b45f]/40 bg-[#e5b45f]/10'
        }`}>
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              isDjLive ? 'bg-rose-500' : 'bg-[#e5b45f]'
            }`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${
              isDjLive ? 'bg-rose-500' : 'bg-[#e5b45f]'
            }`} />
          </span>
          <span className={`text-[11px] font-bold tracking-wider uppercase ${
            isDjLive ? 'text-rose-400' : 'text-[#e5b45f]'
          }`}>
            {isDjLive ? '🔴 AL AIRE · DJ EN VIVO' : 'EN VIVO · RADIO NEXO'}
          </span>
        </div>

        {/* Button to open Request Modal */}
        <button
          type="button"
          onClick={onOpenRequestModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-[#e5b45f]/40 bg-gradient-to-r from-[#e5b45f]/20 to-[#f3c87a]/20 hover:from-[#e5b45f]/30 hover:to-[#f3c87a]/30 text-white hover:text-[#e5b45f] text-[11px] font-semibold tracking-wide transition-all transform active:scale-95 shadow-md shadow-[#e5b45f]/10 cursor-pointer"
          title="Pedir una canción a la cabina de Radio Nexo"
          aria-label="Pedir canción"
        >
          <Music2 className="w-3 h-3 text-[#e5b45f]" />
          <span>Pedir canción</span>
        </button>
      </div>
    </div>
  );
}
