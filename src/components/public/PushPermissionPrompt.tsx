'use client';

import React, { useState, useEffect } from 'react';
import { BellRing, X, Loader2, Radio, Sparkles } from 'lucide-react';
import { chatStore } from '@/lib/chatStore';

const DISMISSED_UNTIL_KEY = 'nexo_push_prompt_dismissed_until_v1';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface PushPermissionPromptProps {
  blockedByOtherModal?: boolean;
}

export default function PushPermissionPrompt({
  blockedByOtherModal = false,
}: PushPermissionPromptProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const vapidPublicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();

  useEffect(() => {
    if (blockedByOtherModal) return;
    if (typeof window === 'undefined') return;
    if (!vapidPublicKey) return;

    const hasPushSupport =
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!hasPushSupport) return;

    // On iPhone/iPad, Push only works when opened from the installed PWA
    const ua = navigator.userAgent || '';
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isIOS && !isStandalone) return;

    // Don't show if already denied or already dismissed recently (24h)
    if (Notification.permission === 'denied') return;

    try {
      const dismissedUntil = Number(localStorage.getItem(DISMISSED_UNTIL_KEY) || '0');
      if (dismissedUntil > Date.now()) return;
    } catch {}

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const existingSub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled && !existingSub) {
          setIsVisible(true);
        }
      } catch {
        if (!cancelled && Notification.permission === 'default') {
          setIsVisible(true);
        }
      }
    }, 1400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [blockedByOtherModal, vapidPublicKey]);

  const handleDismiss = () => {
    try {
      // Remember dismissal for 24 hours so we don't nag on every reload
      localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
    } catch {}
    setIsVisible(false);
  };

  const handleActivate = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setErrorMsg('');

    try {
      // CRITICAL for iOS Safari PWA: requestPermission MUST run FIRST in the click gesture!
      const permission =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();

      if (permission !== 'granted') {
        setErrorMsg('Permiso no concedido. Puedes activarlo luego desde la campanita arriba.');
        setTimeout(() => handleDismiss(), 2500);
        return;
      }

      let reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      }
      reg = await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          userName: chatStore.getUserName(),
        }),
      });

      if (!res.ok) {
        let msg = 'Error guardando suscripción.';
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {}
        throw new Error(msg);
      }

      window.dispatchEvent(new CustomEvent('nexo_push_subscribed'));
      setIsVisible(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudieron activar las notificaciones.');
    } finally {
      setIsBusy(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm rounded-3xl bg-[#0e121a] border border-[#e5b45f]/40 p-6 shadow-2xl shadow-black/90 text-center animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-3.5 right-3.5 p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
          title="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Glowing Bell Icon */}
        <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-[#e5b45f]/25 to-amber-500/10 border border-[#e5b45f]/40 flex items-center justify-center text-[#e5b45f] shadow-lg shadow-[#e5b45f]/20 mb-4 relative">
          <BellRing className="w-7 h-7 animate-bounce" />
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-[#0e121a] animate-ping" />
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-[#0e121a]" />
        </div>

        <div className="flex items-center justify-center gap-1.5 mb-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#e5b45f]" />
          <h3 className="text-base font-black text-white tracking-wide">
            ¡No te pierdas ningún show!
          </h3>
          <Sparkles className="w-3.5 h-3.5 text-[#e5b45f]" />
        </div>

        <p className="text-xs text-gray-300 leading-relaxed mb-5">
          Activa las notificaciones de <strong className="text-[#e5b45f]">RADIO NEXO</strong> para
          avisarte apenas entremos <span className="text-rose-400 font-bold">EN VIVO</span>, en
          especiales y concursos.
        </p>

        {errorMsg && (
          <p className="mb-3 px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-[11px] text-rose-300 font-medium">
            {errorMsg}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleActivate}
            disabled={isBusy}
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-[#e5b45f] to-[#f3c87a] hover:from-[#f3c87a] hover:to-[#e5b45f] disabled:opacity-60 text-black font-black text-xs uppercase tracking-wider shadow-lg shadow-[#e5b45f]/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Radio className="w-4 h-4" />
            )}
            <span>{isBusy ? 'Activando...' : 'Sí, activar notificaciones'}</span>
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            disabled={isBusy}
            className="w-full py-2 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
