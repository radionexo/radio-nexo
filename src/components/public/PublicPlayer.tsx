'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, Volume1, VolumeX, Music2, Share2, Check } from 'lucide-react';
import { radioStore } from '@/lib/radioStore';
import { reactionsBus, ReactionEmoji, LiveReactionEvent } from '@/lib/reactionsBus';
import { StationState } from '@/lib/types';

const VOLUME_STORAGE_KEY = 'nexo_listener_volume_v1';
const MUTED_STORAGE_KEY = 'nexo_listener_muted_v1';
const WAS_PLAYING_SESSION_KEY = 'nexo_listener_was_playing_v1';
const REACTION_EMOJIS: ReactionEmoji[] = ['🔥', '❤️', '🎉', '👏', '💃'];

interface PublicPlayerProps {
  onOpenRequestModal: () => void;
}

export default function PublicPlayer({ onOpenRequestModal }: PublicPlayerProps) {
  const [stationState, setStationState] = useState<StationState>(radioStore.getStationState());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<LiveReactionEvent[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Detect iOS / iPadOS (Apple locks HTMLAudioElement.volume as read-only; only .muted works natively)
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || '';
      const ios =
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      setIsIOSDevice(ios);
    }
  }, []);

  // Subscribe to real-time floating reactions from all listeners
  useEffect(() => {
    const unsub = reactionsBus.subscribe((evt) => {
      setFloatingReactions((prev) => [...prev.slice(-16), evt]);
      setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== evt.id));
      }, 2500);
    });
    return () => unsub();
  }, []);

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
      audioRef.current.muted = isMuted || clamped === 0;
    }
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
      if (audioRef.current) audioRef.current.muted = false;
      try {
        localStorage.setItem(MUTED_STORAGE_KEY, 'false');
      } catch {}
    }
    if (clamped === 0 && !isMuted) {
      setIsMuted(true);
      if (audioRef.current) audioRef.current.muted = true;
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
        audioRef.current.muted = next;
        audioRef.current.volume = next ? 0 : volume;
      }
      try {
        localStorage.setItem(MUTED_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const handleShareRadio = async () => {
    const shareData = {
      title: 'RADIO NEXO · En Vivo',
      text: `🔴 ¡Estoy escuchando ${displayTitle} en RADIO NEXO en vivo! Escúchala aquí:`,
      url: 'https://radionexo.co',
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      }
    } catch {}
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

  const isAppleHlsDevice = (audio?: HTMLAudioElement | null) => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const nativeHls = Boolean(
      audio &&
        (audio.canPlayType('application/vnd.apple.mpegurl') !== '' ||
          audio.canPlayType('audio/mpegurl') !== '')
    );
    return isIOS || nativeHls;
  };

  // Dynamically resolve active Bridge base URL from Supabase (auto-synced by Cloudflare Tunnel)
  const getActiveBridgeBase = () => {
    const raw = radioStore.getStationState()?.current_song_url || stationState.current_song_url || '';
    if (raw.startsWith('https://') && !raw.endsWith('.mp3') && !raw.includes('/songs/')) {
      return raw.replace(/\/+$/, '');
    }
    return '';
  };

  const getBestLiveStreamUrl = (audio?: HTMLAudioElement | null, forceMp3 = false) => {
    const base = getActiveBridgeBase();
    const mp3Url = base
      ? `${base}/live`
      : (process.env.NEXT_PUBLIC_STREAM_URL || 'https://nexo-radio-bridge-axxt.onrender.com/live');
    const hlsUrl = base
      ? `${base}/hls/live.m3u8`
      : (process.env.NEXT_PUBLIC_HLS_URL || mp3Url.replace(/\/(live|stream)(\.mp3)?\/?$/, '/hls/live.m3u8'));

    if (!forceMp3 && isAppleHlsDevice(audio) && hlsUrl) {
      return `${hlsUrl}?t=${Date.now()}`;
    }
    return `${mp3Url}?t=${Date.now()}`;
  };

  // Initialize audio element with iOS-friendly attributes
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audioRef.current = audio;

    audio.addEventListener('playing', () => {
      setIsPlaying(true);
      setIsLoading(false);
      setStatusNotice(null);
    });

    audio.addEventListener('canplay', () => {
      setIsLoading(false);
    });

    audio.addEventListener('waiting', () => {
      if (isPlayingRef.current) {
        setIsLoading(true);
      }
    });

    audio.addEventListener('ended', () => {
      if (!isPlayingRef.current) return;
      console.log('[Player] Stream live cerrado/reciclado, reconectando...');
      setTimeout(() => {
        if (audioRef.current && isPlayingRef.current) {
          audioRef.current.src = getBestLiveStreamUrl(audioRef.current);
          audioRef.current.play().catch(console.warn);
        }
      }, 800);
    });

    audio.addEventListener('error', () => {
      if (!isPlayingRef.current) {
        setIsLoading(false);
        return;
      }
      const wasHls = (audio.src || '').includes('.m3u8');
      console.warn(`[Player] Reconectando señal en vivo (${wasHls ? 'HLS' : 'MP3'})...`);
      setTimeout(() => {
        if (audioRef.current && isPlayingRef.current) {
          audioRef.current.src = getBestLiveStreamUrl(audioRef.current, false);
          audioRef.current.play().catch(() => {
            setIsLoading(false);
          });
        }
      }, wasHls ? 1500 : 1000);
    });

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Auto-resume live playback after F5 if the listener was already listening (Desktop/Android autoplay-permissive browsers)
  const autoResumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoResumeAttemptedRef.current || isPlayingRef.current) return;
    if (typeof window === 'undefined') return;
    const wasPlaying = sessionStorage.getItem(WAS_PLAYING_SESSION_KEY) === 'true';
    if (!wasPlaying) return;

    const base = getActiveBridgeBase();
    if (!base && !stationState.is_live) return;

    const audio = audioRef.current;
    if (!audio) return;

    autoResumeAttemptedRef.current = true;
    audio.src = getBestLiveStreamUrl(audio);
    audio.muted = isMuted || volume === 0;
    audio.volume = isMuted ? 0 : (volume || 0.85);
    audio
      .play()
      .then(() => {
        setIsPlaying(true);
        setIsLoading(false);
        setStatusNotice(null);
      })
      .catch(() => {
        // Browser blocked autoplay (e.g. iOS Safari): stay cleanly paused for 1-tap play
        audio.src = '';
        setIsLoading(false);
      });
  }, [stationState.current_song_url, stationState.is_live, isMuted, volume]);

  // Update volume & muted state (using .muted guarantees iOS Safari compatibility)
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted || volume === 0;
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Active Live Stream Watchdog: Detects silent mobile 4G/5G freezes (>7.5s) and cleanly reconnects
  useEffect(() => {
    if (!isPlaying) return;

    let lastObservedTime = -1;
    let frozenChecks = 0;

    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || !isPlayingRef.current) return;

      if (!audio.paused) {
        if (Math.abs(audio.currentTime - lastObservedTime) < 0.05) {
          frozenChecks++;
          if (frozenChecks >= 3) {
            console.warn('[Player Watchdog] Señal congelada por red (>7.5s), reconectando...');
            frozenChecks = 0;
            lastObservedTime = -1;
            audio.src = getBestLiveStreamUrl(audio);
            audio.play().catch(console.warn);
          }
        } else {
          frozenChecks = 0;
          lastObservedTime = audio.currentTime;
        }
      } else if (!isLoading) {
        audio.play().catch(console.warn);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isPlaying, isLoading]);

  const rawTitle = stationState.current_song_title || '';
  const isLegacyPlaceholder = rawTitle === 'Summer Vibes' || rawTitle === 'NEXO Stream' || !rawTitle;
  const displayTitle = isLegacyPlaceholder ? 'DJ EN VIVO' : rawTitle;
  const displaySubtitle =
    isLegacyPlaceholder || !stationState.current_song_artist
      ? 'Sesión en Directo · Radio Nexo'
      : stationState.current_song_artist;

  // iOS Lock Screen & Control Center integration (Media Session API)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle,
        artist: displaySubtitle,
        album: 'RADIO NEXO · En Vivo',
        artwork: [
          {
            src: '/cover_default.webp',
            sizes: '512x512',
            type: 'image/webp',
          },
        ],
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => {
        if (audioRef.current) {
          audioRef.current.src = getBestLiveStreamUrl(audioRef.current);
          audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (audioRef.current) {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      });
    } catch {}
  }, [isPlaying, displayTitle, displaySubtitle]);

  // 100% Synchronous Play/Pause handler (iOS Safari user-gesture safe)
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      audio.src = '';
      setIsPlaying(false);
      setIsLoading(false);
      setStatusNotice(null);
      try {
        sessionStorage.setItem(WAS_PLAYING_SESSION_KEY, 'false');
      } catch {}
      return;
    }

    setIsLoading(true);
    setStatusNotice(null);

    try {
      audio.src = getBestLiveStreamUrl(audio);
      audio.volume = isMuted ? 0 : (volume || 0.85);
      await audio.play();
      setIsPlaying(true);
      setIsLoading(false);
      try {
        sessionStorage.setItem(WAS_PLAYING_SESSION_KEY, 'true');
      } catch {}
    } catch (err) {
      console.warn('Error iniciando stream principal:', err);
      if (isAppleHlsDevice(audio)) {
        try {
          audio.src = getBestLiveStreamUrl(audio, true);
          audio.volume = isMuted ? 0 : (volume || 0.85);
          await audio.play();
          setIsPlaying(true);
          setIsLoading(false);
          return;
        } catch {}
      }
      setIsPlaying(false);
      setIsLoading(false);
      setStatusNotice('La transmisión en vivo no está activa en este momento.');
      setTimeout(() => setStatusNotice(null), 4000);
    }
  };

  const isDjLive = Boolean(
    stationState.is_live ||
    stationState.is_mic_active ||
    stationState.current_song_title === 'DJ EN VIVO'
  );

  return (
    <div className="relative flex flex-col items-center justify-center w-full max-w-2xl mx-auto px-4 py-1 sm:py-2">
      {/* Floating Live Reactions Overlay */}
      <div className="pointer-events-none fixed sm:absolute inset-x-0 bottom-24 sm:bottom-16 h-56 overflow-hidden z-30">
        {floatingReactions.map((r) => (
          <span
            key={r.id}
            className="absolute bottom-0 text-2xl sm:text-3xl animate-float-reaction select-none drop-shadow-lg"
            style={{ left: `${r.x}%` }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {/* Vinyl Aura & Rotating Center Disc */}
      <div className="relative flex items-center justify-center my-2 sm:my-3 group">
        {/* Radial Dotted Audio Glow Ring */}
        <div
          className={`absolute w-60 h-60 sm:w-72 sm:h-72 lg:w-80 lg:h-80 rounded-full border border-dashed border-[#e5b45f]/25 transition-all duration-1000 ${
            isPlaying ? 'animate-pulse-gold scale-105' : 'opacity-30 scale-95'
          }`}
        />

        {/* Ambient Warm Golden Aura */}
        <div
          className={`absolute w-52 h-52 sm:w-64 sm:h-64 lg:w-72 lg:h-72 rounded-full bg-[#e5b45f]/15 blur-2xl transition-opacity duration-700 ${
            isPlaying ? 'opacity-100' : 'opacity-20'
          }`}
        />

        {/* Dotted Accent Ring */}
        <div className="absolute w-[200px] h-[200px] sm:w-[250px] sm:h-[250px] lg:w-[270px] lg:h-[270px] rounded-full border border-[#e5b45f]/30 flex items-center justify-center">
          <div className="w-full h-full rounded-full border border-dotted border-[#e5b45f]/40 animate-spin-slow" />
        </div>

        {/* Outer Golden Border Rim */}
        <div className="relative w-44 h-44 sm:w-56 sm:h-56 lg:w-64 lg:h-64 rounded-full p-1.5 bg-gradient-to-tr from-[#d9a149] via-[#f3c87a] to-[#966b26] shadow-2xl shadow-[#e5b45f]/30">
          {/* Inner Disc / Cover Art Container */}
          <div
            className={`w-full h-full rounded-full overflow-hidden relative shadow-inner bg-black ${
              isPlaying ? 'animate-spin-slow' : ''
            }`}
          >
            <img
              src="/cover_default.webp"
              alt="Radio Nexo En Vivo"
              className="w-full h-full object-cover object-center filter brightness-90 contrast-105"
            />
            {/* Dark vinyl grooves overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />

            {/* Center vinyl spindle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-neutral-800 to-black border-2 border-[#e5b45f]/60 shadow-lg flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-[#e5b45f]" />
            </div>

            {/* Disc Center Typography */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-3 pointer-events-none">
              <span className="text-[9px] sm:text-[11px] font-semibold tracking-widest uppercase text-white/90 drop-shadow-md">
                RADIO NEXO
              </span>
              <span className="text-xs sm:text-base font-bold tracking-wider uppercase text-white drop-shadow-lg truncate max-w-[85%]">
                {displayTitle}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Station Live Metadata Display */}
      <div className="text-center mt-1 sm:mt-2 z-10 px-2">
        <div className="flex items-center justify-center gap-2">
          {isDjLive && (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            </span>
          )}
          <h2
            className={`text-xl sm:text-3xl font-bold tracking-tight drop-shadow-md truncate max-w-lg ${
              isDjLive ? 'text-rose-400 font-black' : 'text-white'
            }`}
          >
            {displayTitle}
          </h2>
        </div>
        <p className="text-xs sm:text-sm font-medium text-[#e5b45f] mt-0.5 tracking-wide">
          {displaySubtitle}
        </p>
      </div>

      {statusNotice && (
        <div className="mt-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-medium z-10">
          {statusNotice}
        </div>
      )}

      {/* Primary Player Controls */}
      <div className="flex items-center justify-center gap-5 sm:gap-7 mt-3 sm:mt-4 z-10">
        {/* Big Glowing Play / Pause Button */}
        <button
          onClick={togglePlay}
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

        {/* Volume Control Pill: Full slider on Desktop/Android, native Mute pill on iOS */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-black/40 border border-white/10 backdrop-blur-md transition-all shadow-md">
          <button
            type="button"
            onClick={handleToggleMute}
            className={`flex items-center gap-1.5 p-1.5 rounded-full transition-all duration-200 active:scale-90 cursor-pointer ${
              isMuted || volume === 0
                ? 'text-rose-400 bg-rose-500/10'
                : 'text-gray-300 hover:text-white hover:bg-white/10'
            }`}
            title={isMuted ? 'Activar sonido' : 'Silenciar'}
            aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400" />
            ) : volume < 0.5 && !isIOSDevice ? (
              <Volume1 className="w-4 h-4 sm:w-5 sm:h-5 text-[#e5b45f]" />
            ) : (
              <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 text-[#e5b45f]" />
            )}
            {isIOSDevice && (
              <span className="text-[11px] font-semibold pr-1 select-none">
                {isMuted ? 'Silenciado' : 'Sonido'}
              </span>
            )}
          </button>

          {!isIOSDevice && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Live Badge Status, Song Request & Share Buttons */}
      <div className="mt-3 sm:mt-4 flex flex-wrap items-center justify-center gap-2 z-10">
        <div
          className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full border backdrop-blur-md transition-all ${
            isDjLive
              ? 'border-rose-500/60 bg-rose-500/15 shadow-sm shadow-rose-500/30'
              : 'border-[#e5b45f]/40 bg-[#e5b45f]/10'
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isDjLive ? 'bg-rose-500' : 'bg-[#e5b45f]'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isDjLive ? 'bg-rose-500' : 'bg-[#e5b45f]'
              }`}
            />
          </span>
          <span
            className={`text-[11px] font-bold tracking-wider uppercase ${
              isDjLive ? 'text-rose-400' : 'text-[#e5b45f]'
            }`}
          >
            {isDjLive ? '🔴 AL AIRE' : 'EN VIVO · RADIO NEXO'}
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

        {/* Share Radio Button */}
        <button
          type="button"
          onClick={handleShareRadio}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 text-gray-200 hover:text-white text-[11px] font-semibold transition-all transform active:scale-95 cursor-pointer"
          title="Compartir Radio Nexo con tus amigos"
          aria-label="Compartir radio"
        >
          {shareCopied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-300">¡Enlace copiado!</span>
            </>
          ) : (
            <>
              <Share2 className="w-3 h-3 text-[#e5b45f]" />
              <span>Compartir</span>
            </>
          )}
        </button>
      </div>

      {/* Interactive Live Reactions Bar */}
      <div className="mt-2.5 flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full bg-black/35 border border-white/10 backdrop-blur-md z-10">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => reactionsBus.send(emoji)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-base hover:bg-white/10 hover:scale-125 active:scale-90 transition-all cursor-pointer select-none"
            title={`Enviar reacción ${emoji}`}
            aria-label={`Enviar reacción ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
