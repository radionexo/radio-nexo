'use client';

import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Users,
  BellRing,
  MessageSquare,
  Music2,
  RefreshCw,
  CheckCircle2,
  Clock,
  Flame,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { radioStore } from '@/lib/radioStore';
import { SongRequest } from '@/lib/types';

interface TopSongItem {
  label: string;
  count: number;
}

export default function StudioReportsPage() {
  const [loading, setLoading] = useState(true);
  const [listenersNow, setListenersNow] = useState(1);
  const [pushCount, setPushCount] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [requests, setRequests] = useState<SongRequest[]>([]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      setListenersNow(radioStore.getStationState().listeners_count || 1);

      // Push subscribers count
      try {
        const res = await fetch('/api/push/subscribe', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setPushCount(Number(data.count || 0));
        }
      } catch {}

      // Real requests
      const reqs = await radioStore.getRequests();
      setRequests(reqs);

      // Total chat messages count from Supabase
      if (isSupabaseConfigured && supabase) {
        const { count } = await supabase
          .from('chat_messages')
          .select('*', { count: 'exact', head: true });
        if (typeof count === 'number') {
          setTotalMessages(count);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
    const unsub = radioStore.subscribe(() => {
      setListenersNow(radioStore.getStationState().listeners_count || 1);
    });
    return () => unsub();
  }, []);

  const reviewedCount = requests.filter((r) => r.status !== 'pending').length;
  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const completionPct =
    requests.length > 0 ? Math.round((reviewedCount / requests.length) * 100) : 100;

  // Compute Top Requested Songs
  const songFreq = new Map<string, number>();
  requests.forEach((r) => {
    const key = `${r.song_title.trim()} — ${r.artist.trim()}`;
    songFreq.set(key, (songFreq.get(key) || 0) + 1);
  });
  const topSongs: TopSongItem[] = Array.from(songFreq.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxSongCount = topSongs[0]?.count || 1;

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 space-y-5 max-w-[1400px] w-full mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl glass-panel border border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e5b45f]/15 border border-[#e5b45f]/30 flex items-center justify-center text-[#e5b45f]">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-white tracking-tight">
              Reportes y Audiencia
            </h1>
            <p className="text-xs text-gray-400">
              Métricas en tiempo real de Radio Nexo conectadas a tu base de datos
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadAnalytics}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-gray-200 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#e5b45f] ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl glass-panel border border-white/10 space-y-1.5">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Oyentes Ahora</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white">{listenersNow}</p>
          <p className="text-[11px] text-emerald-400 font-medium">Conectados en vivo</p>
        </div>

        <div className="p-4 rounded-2xl glass-panel border border-white/10 space-y-1.5">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Suscritos Push</span>
            <BellRing className="w-4 h-4 text-[#e5b45f]" />
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white">{pushCount}</p>
          <p className="text-[11px] text-gray-400">Celulares listos para avisos</p>
        </div>

        <div className="p-4 rounded-2xl glass-panel border border-white/10 space-y-1.5">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Mensajes Chat</span>
            <MessageSquare className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white">{totalMessages}</p>
          <p className="text-[11px] text-gray-400">Histórico en la comunidad</p>
        </div>

        <div className="p-4 rounded-2xl glass-panel border border-white/10 space-y-1.5">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Solicitudes</span>
            <Music2 className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white">{requests.length}</p>
          <p className="text-[11px] text-gray-400">
            {completionPct}% atendidas · {pendingCount} pendientes
          </p>
        </div>
      </div>

      {/* Bottom Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Top Requested Songs */}
        <div className="lg:col-span-7 p-5 rounded-3xl glass-panel border border-white/10 space-y-4">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-[#e5b45f]" />
            <h2 className="text-xs font-black uppercase tracking-wider text-white">
              Canciones Más Pedidas
            </h2>
          </div>

          {topSongs.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-500">
              Aún no hay solicitudes registradas para armar el ranking.
            </div>
          ) : (
            <div className="space-y-3">
              {topSongs.map((item, idx) => {
                const widthPct = Math.max(12, Math.round((item.count / maxSongCount) * 100));
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-gray-100 truncate">
                        <span className="text-[#e5b45f] font-black mr-1.5">#{idx + 1}</span>
                        {item.label}
                      </span>
                      <span className="font-mono text-[11px] text-gray-400 shrink-0">
                        {item.count} {item.count === 1 ? 'pedido' : 'pedidos'}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#e5b45f] to-amber-300 transition-all duration-500"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Requests Summary */}
        <div className="lg:col-span-5 p-5 rounded-3xl glass-panel border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#e5b45f]" />
              Últimas Solicitudes
            </h2>
            <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {reviewedCount} atendidas
            </span>
          </div>

          {requests.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-500">
              No hay actividad reciente todavía.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto scrollbar-thin">
              {requests.slice(0, 8).map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{r.song_title}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {r.artist} · Pedida por <span className="text-[#e5b45f]">{r.name}</span>
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      r.status === 'pending'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {r.status === 'pending' ? 'Pendiente' : 'Atendida'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
