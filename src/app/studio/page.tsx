'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Mic,
  Radio,
  ExternalLink,
  Users,
  Settings2,
  Signal,
  Sliders,
  Sparkles,
  Check,
  Wifi,
  WifiOff,
  Type,
} from 'lucide-react';
import { audioEngine } from '@/lib/audioEngine';
import { radioStore } from '@/lib/radioStore';
import { reactionsBus, LiveReactionEvent } from '@/lib/reactionsBus';
import { StudioChatHub } from '@/components/studio/StudioChatHub';
import { MicrophoneSettingsModal } from '@/components/studio/MicrophoneSettingsModal';
import { OnlineListenersModal } from '@/components/studio/OnlineListenersModal';
import { DiscordSettingsModal } from '@/components/studio/DiscordSettingsModal';
import { StationState, OnlineListener } from '@/lib/types';

function StudioMicVuMeter({ bars = 24 }: { bars?: number }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    let lastTime = 0;
    const unsub = audioEngine.subscribeLevels((lvl) => {
      const now = performance.now();
      if (now - lastTime >= 50) {
        lastTime = now;
        setLevel(lvl.mic);
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="h-2.5 w-full bg-neutral-900 rounded-full overflow-hidden flex gap-0.5 p-0.5">
      {[...Array(bars)].map((_, i) => {
        const isActive = (level / 100) * bars > i;
        const peakIdx = Math.floor(bars * 0.8);
        const midIdx = Math.floor(bars * 0.55);
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-all duration-75 ${
              isActive
                ? i > peakIdx
                  ? 'bg-rose-500 shadow-sm shadow-rose-500/50'
                  : i > midIdx
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
                : 'bg-neutral-800'
            }`}
          />
        );
      })}
    </div>
  );
}

function LiveWaveform({ isActive }: { isActive: boolean }) {
  const [micLevel, setMicLevel] = useState(0);

  useEffect(() => {
    let lastTime = 0;
    const unsub = audioEngine.subscribeLevels((lvl) => {
      const now = performance.now();
      if (now - lastTime >= 50) {
        lastTime = now;
        setMicLevel(lvl.mic);
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="flex items-center justify-center gap-1.5 h-16 py-2">
      {[...Array(32)].map((_, i) => {
        const heightPercent = isActive
          ? Math.max(14, Math.min(100, (micLevel / 100) * 100 * (0.55 + Math.sin(i * 0.55) * 0.45)))
          : 12;
        return (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-all duration-75 ${
              isActive ? 'bg-gradient-to-t from-rose-600 via-rose-400 to-[#e5b45f]' : 'bg-white/15'
            }`}
            style={{ height: `${heightPercent}%` }}
          />
        );
      })}
    </div>
  );
}

const SOUNDBOARD_EFFECTS: {
  id: 'airhorn' | 'applause' | 'riser' | 'chime' | 'boom' | 'jingle';
  label: string;
  emoji: string;
}[] = [
  { id: 'airhorn', label: 'Airhorn DJ', emoji: '📯' },
  { id: 'applause', label: 'Aplausos', emoji: '👏' },
  { id: 'riser', label: 'Subida / Drop', emoji: '🚀' },
  { id: 'chime', label: 'Campana', emoji: '🔔' },
  { id: 'boom', label: 'Impacto Boom', emoji: '💥' },
  { id: 'jingle', label: 'Jingle Nexo', emoji: '✨' },
];

export default function StudioDashboardPage() {
  const [stationState, setStationState] = useState<StationState>(radioStore.getStationState());
  const [engineState, setEngineState] = useState(audioEngine.getState());
  const [micError, setMicError] = useState('');
  const [isMicModalOpen, setIsMicModalOpen] = useState(false);
  const [isListenersModalOpen, setIsListenersModalOpen] = useState(false);
  const [isDiscordModalOpen, setIsDiscordModalOpen] = useState(false);
  const [onlineListeners, setOnlineListeners] = useState<OnlineListener[]>([]);

  // Live Show Title / Subtitle editor
  const [showTitleInput, setShowTitleInput] = useState(
    () => radioStore.getStationState().current_song_title || 'DJ EN VIVO'
  );
  const [showSubtitleInput, setShowSubtitleInput] = useState(
    () => radioStore.getStationState().current_song_artist || 'Sesión en Directo · Radio Nexo'
  );
  const [titleSavedToast, setTitleSavedToast] = useState(false);

  // Live Bridge / Tunnel Monitor
  const [bridgeStatus, setBridgeStatus] = useState<{
    online: boolean;
    isBroadcasting: boolean;
    audioListeners: number;
    bitrate: number;
    hlsReady: boolean;
  }>({
    online: false,
    isBroadcasting: false,
    audioListeners: 0,
    bitrate: 128,
    hlsReady: false,
  });

  // Incoming audience reactions floating in studio
  const [floatingReactions, setFloatingReactions] = useState<LiveReactionEvent[]>([]);
  const [activeFx, setActiveFx] = useState<string | null>(null);

  useEffect(() => {
    const updateState = () => {
      const st = radioStore.getStationState();
      setStationState(st);
      setEngineState(audioEngine.getState());
      setOnlineListeners(radioStore.getOnlineListeners());
    };

    const unsubStore = radioStore.subscribe(updateState);
    const unsubEngine = audioEngine.subscribe(() => {
      setEngineState(audioEngine.getState());
    });
    const unsubReactions = reactionsBus.subscribe((evt) => {
      setFloatingReactions((prev) => [...prev.slice(-14), evt]);
      setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== evt.id));
      }, 2500);
    });

    updateState();

    return () => {
      unsubStore();
      unsubEngine();
      unsubReactions();
    };
  }, []);

  // Poll active Cloudflare Tunnel / Bridge status every 5 seconds
  useEffect(() => {
    let mounted = true;
    const checkBridge = async () => {
      const rawUrl = radioStore.getStationState()?.current_song_url || '';
      const bridgeBase =
        rawUrl.startsWith('https://') && !rawUrl.endsWith('.mp3') && !rawUrl.includes('/songs/')
          ? rawUrl.replace(/\/+$/, '')
          : '';
      if (!bridgeBase) {
        if (mounted) {
          setBridgeStatus((prev) => ({ ...prev, online: false, isBroadcasting: false, audioListeners: 0 }));
        }
        return;
      }
      try {
        const res = await fetch(`${bridgeBase}/status`, { cache: 'no-store' });
        if (!res.ok) throw new Error('offline');
        const data = await res.json();
        if (mounted) {
          setBridgeStatus({
            online: data.status === 'online',
            isBroadcasting: Boolean(data.isBroadcasting),
            audioListeners: Number(data.listenersCount || 0),
            bitrate: Number(data.bitrate || 128),
            hlsReady: Boolean(data.hlsReady),
          });
        }
      } catch {
        if (mounted) {
          setBridgeStatus((prev) => ({ ...prev, online: false, isBroadcasting: false }));
        }
      }
    };

    checkBridge();
    const timer = setInterval(checkBridge, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [stationState.current_song_url]);

  const formatAirTime = (totalSecs: number) => {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = Math.floor(totalSecs % 60);
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Toggle On-Air Microphone + Live Broadcast together
  const handleToggleMic = async () => {
    setMicError('');
    try {
      if (engineState.isMicOnAir) {
        audioEngine.exitOnAir();
        if (engineState.isBroadcasting) {
          audioEngine.stopBroadcasting();
        }
      } else {
        await audioEngine.enterOnAir();
        if (!engineState.isBroadcasting) {
          audioEngine.startBroadcasting();
        }
      }
    } catch {
      setMicError('Acceso al micrófono denegado o no disponible en este dispositivo.');
    }
  };

  const handleToggleBroadcast = async () => {
    setMicError('');
    if (engineState.isBroadcasting) {
      if (engineState.isMicOnAir) {
        audioEngine.exitOnAir();
      }
      audioEngine.stopBroadcasting();
    } else {
      try {
        if (!engineState.isMicOnAir) {
          await audioEngine.enterOnAir();
        }
        audioEngine.startBroadcasting();
      } catch {
        setMicError('Activa el permiso del micrófono para iniciar la transmisión en vivo.');
      }
    }
  };

  const handleSaveShowTitle = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = showTitleInput.trim() || 'DJ EN VIVO';
    const cleanSub = showSubtitleInput.trim() || 'Sesión en Directo · Radio Nexo';
    radioStore.updateStationState({
      current_song_title: cleanTitle,
      current_song_artist: cleanSub,
    });
    setTitleSavedToast(true);
    setTimeout(() => setTitleSavedToast(false), 2200);
  };

  const handleTriggerFx = (id: 'airhorn' | 'applause' | 'riser' | 'chime' | 'boom' | 'jingle') => {
    setActiveFx(id);
    audioEngine.playSoundEffect(id);
    setTimeout(() => setActiveFx((prev) => (prev === id ? null : prev)), 400);
  };

  const isLiveOnAir = engineState.isMicOnAir || engineState.isBroadcasting;

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-5 space-y-4 max-w-[1600px] w-full mx-auto">
      {/* ========================================================= */}
      {/* TOP STATUS BAR */}
      {/* ========================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl glass-panel border border-white/5">
        <div className="flex items-center gap-2.5 flex-wrap">
          {isLiveOnAir ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-400 text-xs font-semibold">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
              </span>
              <span>EN VIVO · {formatAirTime(engineState.airTimeSeconds)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Cabina en espera</span>
            </div>
          )}

          {/* Real-time Antena / Tunnel Health Pill */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${
              bridgeStatus.online
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}
            title={
              bridgeStatus.online
                ? `Puente conectado (${bridgeStatus.bitrate}k MP3${bridgeStatus.hlsReady ? ' + Apple HLS' : ''})`
                : 'Abre iniciar-radio.bat en tu PC para encender la antena'
            }
          >
            {bridgeStatus.online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>
              {bridgeStatus.online
                ? `Antena Online (${bridgeStatus.bitrate}k${bridgeStatus.hlsReady ? ' + iOS' : ''})`
                : 'Antena Apagada (Abre iniciar-radio.bat)'}
            </span>
          </div>

          {/* Interactive Listeners Badge */}
          <button
            onClick={() => setIsListenersModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition-all shadow-sm group active:scale-95 cursor-pointer"
            title="Ver quiénes nos están escuchando en vivo"
          >
            <Users className="w-3.5 h-3.5 text-[#e5b45f] group-hover:scale-110 transition-transform" />
            <span>
              <strong className="text-white font-bold underline decoration-[#e5b45f]/40 underline-offset-4">
                {stationState.listeners_count}
              </strong>{' '}
              {stationState.listeners_count === 1 ? 'oyente' : 'oyentes'}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleBroadcast}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-md cursor-pointer ${
              isLiveOnAir
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                : 'bg-[#e5b45f] hover:bg-[#f3c87a] text-black shadow-[#e5b45f]/25'
            }`}
          >
            {isLiveOnAir ? 'Detener transmisión' : 'Iniciar transmisión'}
          </button>

          {/* Discord Settings Button */}
          <button
            onClick={() => setIsDiscordModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#5865F2]/15 hover:bg-[#5865F2]/25 text-[#5865F2] hover:text-white border border-[#5865F2]/30 text-xs font-semibold transition-all shadow-sm active:scale-95 group cursor-pointer"
            title="Cambiar enlace oficial de Discord"
          >
            <svg className="w-3.5 h-3.5 fill-current shrink-0 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            <span className="hidden sm:inline">Enlace</span>
            <span>Discord</span>
          </button>

          <Link
            href="/"
            target="_blank"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-gray-300 hover:text-white border border-white/5 transition-all"
          >
            <span>Vista pública</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {micError && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center justify-between">
          <span>{micError}</span>
          <button onClick={() => setMicError('')} className="underline font-semibold ml-2 cursor-pointer">
            Entendido
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* MAIN CABINA LAYOUT: LEFT MICROPHONE STAGE (7) + RIGHT CHAT (5) */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN: LIVE MICROPHONE STAGE, SHOW TITLE, SOUNDBOARD & MIXER */}
        <div className="xl:col-span-7 flex flex-col gap-4 min-w-0">
          {/* HERO ON-AIR MICROPHONE STAGE */}
          <div className="rounded-3xl relative overflow-hidden min-h-[330px] flex flex-col items-center justify-center p-7 border border-white/10 shadow-2xl">
            <div
              className="absolute inset-0 bg-cover bg-center filter brightness-40"
              style={{ backgroundImage: `url('/bg_nexo_studio.webp')` }}
            />
            <div
              className={`absolute inset-0 transition-opacity duration-700 ${
                engineState.isMicOnAir
                  ? 'bg-gradient-to-t from-black via-rose-950/40 to-black/60'
                  : 'bg-gradient-to-t from-black via-black/60 to-black/40'
              }`}
            />

            {/* Floating Live Audience Reactions Overlay */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
              {floatingReactions.map((r) => (
                <span
                  key={r.id}
                  className="absolute bottom-6 text-2xl sm:text-3xl animate-float-reaction select-none drop-shadow-lg"
                  style={{ left: `${r.x}%` }}
                >
                  {r.emoji}
                </span>
              ))}
            </div>

            <div className="relative z-10 flex flex-col items-center space-y-4 text-center w-full max-w-md">
              <div
                className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full font-bold text-xs shadow-lg border ${
                  engineState.isMicOnAir
                    ? 'bg-rose-600/85 border-rose-400/50 text-white shadow-rose-600/50 red-glow'
                    : 'bg-white/10 border-white/15 text-gray-200'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    engineState.isMicOnAir ? 'bg-white animate-pulse' : 'bg-[#e5b45f]'
                  }`}
                />
                <span>{engineState.isMicOnAir ? '● AL AIRE · TRANSMITIENDO' : 'CABINA EN ESPERA'}</span>
              </div>

              {/* Live Waveform Visualizer */}
              <LiveWaveform isActive={engineState.isMicOnAir} />

              {/* Live Clock Timer */}
              <div>
                <span className="text-3xl font-extrabold text-white font-mono tracking-wider drop-shadow-md">
                  {formatAirTime(engineState.airTimeSeconds)}
                </span>
                <p className="text-[11px] text-gray-400 mt-0.5">Tiempo al aire · Transmisión en directo</p>
              </div>

              {/* Main On-Air Toggle & Mic Settings */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleToggleMic}
                  className={`px-8 py-3.5 rounded-full font-black text-xs tracking-wider uppercase flex items-center gap-2.5 shadow-xl transition-all transform active:scale-95 cursor-pointer ${
                    engineState.isMicOnAir
                      ? 'bg-rose-600 text-white red-glow hover:bg-rose-500 ring-4 ring-rose-500/25'
                      : 'bg-gradient-to-tr from-[#d9a149] to-[#f3c87a] text-black gold-glow hover:scale-105'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>{engineState.isMicOnAir ? '■ SALIR DEL AIRE' : 'ENTRAR AL AIRE'}</span>
                </button>

                <button
                  onClick={() => setIsMicModalOpen(true)}
                  className="p-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all shadow-md active:scale-95 cursor-pointer"
                  title="Configuración de micrófono y entrada de audio"
                >
                  <Settings2 className="w-4 h-4 text-[#e5b45f]" />
                </button>
              </div>
            </div>
          </div>

          {/* EDITABLE LIVE SHOW TITLE & SUBTITLE CARD */}
          <form
            onSubmit={handleSaveShowTitle}
            className="rounded-3xl glass-panel p-5 border border-white/5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-[#e5b45f]" />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Título en Pantalla (radionexo.co y Celulares)
                </span>
              </div>
              {titleSavedToast && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                  Actualizado en vivo
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="text"
                value={showTitleInput}
                onChange={(e) => setShowTitleInput(e.target.value)}
                placeholder="Ej: Viernes de Salsa & Reggaetón"
                maxLength={60}
                className="sm:col-span-5 px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
              />
              <input
                type="text"
                value={showSubtitleInput}
                onChange={(e) => setShowSubtitleInput(e.target.value)}
                placeholder="Ej: DJ Pedro · En Directo"
                maxLength={60}
                className="sm:col-span-5 px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
              />
              <button
                type="submit"
                className="sm:col-span-2 px-3 py-2 rounded-xl bg-[#e5b45f] hover:bg-[#f3c87a] text-black font-bold text-xs transition-all active:scale-95 cursor-pointer"
              >
                Actualizar
              </button>
            </div>
          </form>

          {/* LIVE SOUNDBOARD (BOTONERA DE EFECTOS EN VIVO) */}
          <div className="rounded-3xl glass-panel p-5 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#e5b45f]" />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Botonera de Efectos (Salen directo al aire)
                </span>
              </div>
              <span className="text-[10px] text-gray-400">1 clic · Mezcla directa</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SOUNDBOARD_EFFECTS.map((fx) => (
                <button
                  key={fx.id}
                  type="button"
                  onClick={() => handleTriggerFx(fx.id)}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                    activeFx === fx.id
                      ? 'bg-[#e5b45f] text-black border-[#f3c87a] shadow-lg shadow-[#e5b45f]/30 scale-[0.98]'
                      : 'bg-white/5 hover:bg-white/10 text-gray-200 border-white/10 hover:border-[#e5b45f]/40'
                  }`}
                >
                  <span className="text-base leading-none">{fx.emoji}</span>
                  <span>{fx.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* MICROPHONE & MASTER MIXER CARD */}
          <div className="rounded-3xl glass-panel p-5 border border-white/5 space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#e5b45f]" />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Control de Micrófono y Salida Master
                </span>
              </div>
              <button
                onClick={() => setIsMicModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 hover:text-[#e5b45f] border border-white/5 transition-colors cursor-pointer"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Seleccionar entrada</span>
              </button>
            </div>

            {/* Mic Gain & VU Meter */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-gray-200 font-semibold">
                  <Mic className="w-4 h-4 text-[#e5b45f]" />
                  Micrófono / Consola {engineState.isMicOnAir ? '(Al Aire)' : '(Muteado)'}
                </span>
                <div className="flex items-center gap-2 font-mono text-xs">
                  {engineState.micVolume > 1.05 && (
                    <span className="text-[10px] text-amber-400 font-bold bg-amber-400/10 px-1.5 py-0.5 rounded">
                      {engineState.micVolume > 1.2 ? '⚠ Alto (puede saturar)' : `+${Math.round((engineState.micVolume - 1) * 100)}% Boost`}
                    </span>
                  )}
                  {Math.abs(engineState.micVolume - 1.0) > 0.02 && (
                    <button
                      type="button"
                      onClick={() => audioEngine.setMicVolume(1.0)}
                      className="text-[10px] text-[#e5b45f] hover:underline font-sans font-semibold cursor-pointer"
                      title="Restablecer a 100% (0 dB sin saturación)"
                    >
                      0 dB (100%)
                    </button>
                  )}
                  <span className="text-white font-bold">{Math.round(engineState.micVolume * 100)}%</span>
                </div>
              </div>
              <StudioMicVuMeter bars={28} />
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={Math.min(1.5, engineState.micVolume)}
                onChange={(e) => audioEngine.setMicVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-[#e5b45f]"
                title="Ajustar ganancia de entrada (recomendado: 80% - 100% para señal limpia)"
              />
            </div>

            {/* Master Volume */}
            <div className="space-y-2 pt-2.5 border-t border-white/5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-semibold">Master Salida</span>
                <span className="font-mono text-white font-semibold">{Math.round(engineState.masterVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.01"
                value={engineState.masterVolume}
                onChange={(e) => audioEngine.setMasterVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            {/* Signal Info Strip */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/5">
                <Signal className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Señal de Salida</p>
                  <p className="text-xs font-bold text-white truncate">
                    MP3 {bridgeStatus.bitrate}k + Apple HLS (iOS)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/5">
                <Radio className="w-4 h-4 text-[#e5b45f] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Modo de Emisión</p>
                  <p className="text-xs font-bold text-white truncate">
                    {engineState.micMode === 'studio' ? 'Estudio Hi-Fi (Sin filtros VoIP)' : 'Estándar'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: FULL-HEIGHT CHAT HUB & REQUESTS */}
        <div className="xl:col-span-5 flex flex-col min-w-0">
          <StudioChatHub
            allSongs={[]}
            className="h-[720px] xl:h-[820px] shadow-2xl"
          />
        </div>
      </div>

      {/* Modals */}
      <MicrophoneSettingsModal
        isOpen={isMicModalOpen}
        onClose={() => setIsMicModalOpen(false)}
      />
      <OnlineListenersModal
        isOpen={isListenersModalOpen}
        onClose={() => setIsListenersModalOpen(false)}
        listeners={onlineListeners}
      />
      <DiscordSettingsModal
        isOpen={isDiscordModalOpen}
        onClose={() => setIsDiscordModalOpen(false)}
      />
    </div>
  );
}
