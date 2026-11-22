'use client';

import React, { useState, useEffect } from 'react';
import { BellRing, Send, Radio, Check, AlertCircle, Loader2, Users } from 'lucide-react';

interface StudioPushPanelProps {
  currentShowTitle: string;
}

export function StudioPushPanel({ currentShowTitle }: StudioPushPanelProps) {
  const [title, setTitle] = useState('🔴 ¡RADIO NEXO está EN VIVO!');
  const [body, setBody] = useState('Sintoniza ahora la transmisión en directo y pide tu canción.');
  const [subscriberCount, setSubscriberCount] = useState<number>(0);
  const [isConfigured, setIsConfigured] = useState<boolean>(true);
  const [isSending, setIsSending] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/push/subscribe', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSubscriberCount(Number(data.count || 0));
        setIsConfigured(Boolean(data.configured));
      }
    } catch {}
  };

  useEffect(() => {
    loadStats();
  }, []);

  const sendPush = async (pushTitle: string, pushBody: string) => {
    if (isSending) return;
    setIsSending(true);
    setResultMsg(null);

    try {
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pushTitle.trim() || '🔴 RADIO NEXO · En Vivo',
          body: pushBody.trim() || '¡Estamos transmitiendo en directo!',
          url: '/',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResultMsg({ type: 'err', text: data.error || 'Error enviando notificación.' });
      } else if (data.total === 0) {
        setResultMsg({
          type: 'err',
          text: 'Aún no hay oyentes suscritos a notificaciones.',
        });
      } else {
        setResultMsg({
          type: 'ok',
          text: `Enviada a ${data.sent} de ${data.total} dispositivo${data.total === 1 ? '' : 's'}.`,
        });
        loadStats();
      }
    } catch {
      setResultMsg({ type: 'err', text: 'No se pudo conectar con el servidor de avisos.' });
    } finally {
      setIsSending(false);
      setTimeout(() => setResultMsg(null), 5000);
    }
  };

  const handleQuickLiveAlert = () => {
    const showName = currentShowTitle && currentShowTitle !== 'DJ EN VIVO' ? currentShowTitle : 'Sesión en Directo';
    sendPush(
      '🔴 ¡RADIO NEXO está EN VIVO!',
      `${showName} ya comenzó. Toca para escuchar ahora y participar en el chat.`
    );
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendPush(title, body);
  };

  return (
    <div className="p-4 sm:p-5 rounded-3xl glass-panel border border-white/10 space-y-3.5 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BellRing className="w-4 h-4 text-[#e5b45f]" />
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            Notificaciones Push (PWA)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-gray-300 font-semibold">
            <Users className="w-3 h-3 text-[#e5b45f]" />
            {subscriberCount} {subscriberCount === 1 ? 'suscrito' : 'suscritos'}
          </span>

          <button
            type="button"
            onClick={handleQuickLiveAlert}
            disabled={isSending || !isConfigured}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-40 text-white text-[11px] font-bold shadow-md shadow-rose-500/25 active:scale-95 transition-all cursor-pointer"
            title="Avisar en 1 clic a todos los celulares suscritos que estás en vivo"
          >
            {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}
            <span>Avisar EN VIVO</span>
          </button>
        </div>
      </div>

      {!isConfigured && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            Agrega <code className="font-mono text-amber-100">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> y{' '}
            <code className="font-mono text-amber-100">VAPID_PRIVATE_KEY</code> en Vercel para activar los envíos.
          </span>
        </div>
      )}

      <form onSubmit={handleCustomSubmit} className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Título de la notificación..."
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={240}
              placeholder="Mensaje para tus oyentes..."
              className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
            />
            <button
              type="submit"
              disabled={isSending || !isConfigured || !title.trim() || !body.trim()}
              className="px-3.5 py-2 rounded-xl bg-[#e5b45f] hover:bg-[#f3c87a] disabled:opacity-40 text-black text-xs font-bold flex items-center gap-1.5 shrink-0 active:scale-95 transition-all cursor-pointer"
            >
              {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Enviar</span>
            </button>
          </div>
        </div>
      </form>

      {resultMsg && (
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold ${
            resultMsg.type === 'ok'
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
          }`}
        >
          {resultMsg.type === 'ok' ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          <span>{resultMsg.text}</span>
        </div>
      )}
    </div>
  );
}
