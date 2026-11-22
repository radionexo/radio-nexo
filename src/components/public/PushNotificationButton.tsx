'use client';

import React, { useState, useEffect } from 'react';
import { Bell, BellRing, BellOff, Loader2 } from 'lucide-react';
import { chatStore } from '@/lib/chatStore';

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

export default function PushNotificationButton() {
  const [supported, setSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasSw = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(true);

    if (!hasSw) return;

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setIsSubscribed(Boolean(sub));
      })
      .catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4500);
  };

  const handleTogglePush = async () => {
    if (isBusy) return;

    // Detect iOS Safari outside installed PWA
    const ua = navigator.userAgent || '';
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isIOS && !isStandalone) {
      showToast('En iPhone: instala la app (Compartir → Añadir a inicio) y ábrela desde ahí para activar avisos.');
      return;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      showToast('Tu navegador no soporta notificaciones push.');
      return;
    }

    if (!vapidPublicKey) {
      showToast('Las notificaciones están en configuración. Vuelve a intentar en unos minutos.');
      return;
    }

    setIsBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;

      if (isSubscribed) {
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: existing.endpoint }),
          });
          await existing.unsubscribe();
        }
        setIsSubscribed(false);
        showToast('Avisos desactivados.');
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          showToast('Permiso de notificaciones denegado en tu navegador.');
          return;
        }

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });

        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            userName: chatStore.getUserName(),
          }),
        });

        if (!res.ok) {
          throw new Error('Error guardando suscripción');
        }

        setIsSubscribed(true);
        showToast('🔔 ¡Listo! Te avisaremos cuando Radio Nexo esté en vivo.');
      }
    } catch (err) {
      console.warn('[Push] Error:', err);
      showToast('No se pudieron activar los avisos en este dispositivo.');
    } finally {
      setIsBusy(false);
    }
  };

  if (!supported) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleTogglePush}
        disabled={isBusy}
        className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs font-semibold transition-all border cursor-pointer active:scale-95 ${
          isSubscribed
            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400 hover:bg-emerald-500/25'
            : 'bg-white/5 border-white/10 text-gray-300 hover:text-[#e5b45f] hover:border-[#e5b45f]/35 hover:bg-[#e5b45f]/10'
        }`}
        title={
          isSubscribed
            ? 'Notificaciones activadas (toca para desactivar)'
            : 'Activar notificaciones cuando estemos en vivo'
        }
      >
        {isBusy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isSubscribed ? (
          <BellRing className="w-3.5 h-3.5" />
        ) : (
          <Bell className="w-3.5 h-3.5 text-[#e5b45f]" />
        )}
        <span className="hidden sm:inline">
          {isSubscribed ? 'Avisos ON' : 'Avísame'}
        </span>
      </button>

      {notice && (
        <div className="fixed sm:absolute top-14 sm:top-full right-3 sm:right-0 mt-1 sm:mt-2 z-50 w-72 px-3.5 py-2.5 rounded-xl bg-[#121620] border border-[#e5b45f]/40 text-xs text-gray-100 shadow-2xl shadow-black/80 animate-in fade-in slide-in-from-top-2 duration-200 flex items-start gap-2">
          {isSubscribed ? (
            <BellRing className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <BellOff className="w-4 h-4 text-[#e5b45f] shrink-0 mt-0.5" />
          )}
          <span className="leading-snug">{notice}</span>
        </div>
      )}
    </div>
  );
}
