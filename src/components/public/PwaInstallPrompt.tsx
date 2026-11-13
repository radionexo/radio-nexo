'use client';

import React, { useState, useEffect } from 'react';
import { Download, X, Share, PlusSquare, Smartphone } from 'lucide-react';
import Image from 'next/image';

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    // 1. Check if already installed / standalone
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) return;

    // 2. Check if recently dismissed (remember for 5 days)
    const dismissedTime = localStorage.getItem('nexo_pwa_dismissed_v1');
    if (dismissedTime) {
      const elapsed = Date.now() - parseInt(dismissedTime, 10);
      if (elapsed < 5 * 24 * 60 * 60 * 1000) {
        return;
      }
    }

    // 3. Android / Chrome beforeinstallprompt event
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // 4. iOS Safari detection
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    const isSafari = /safari/.test(userAgent) && !/chrome|crios|fxios/.test(userAgent);

    if (isIosDevice && isSafari) {
      setIsIOS(true);
      // Give a 3-second delay on initial visit before showing install invitation
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3500);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
      return;
    }

    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowPrompt(false);
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setShowIOSModal(false);
    try {
      localStorage.setItem('nexo_pwa_dismissed_v1', Date.now().toString());
    } catch {}
  };

  if (!showPrompt) return null;

  return (
    <>
      {/* Floating Bottom Install Banner */}
      <aside
        aria-label="Instalación de la aplicación"
        className="fixed bottom-20 left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:max-w-sm z-50 bg-[#12141a]/95 backdrop-blur-xl border border-[#e5b45f]/30 rounded-2xl p-3.5 shadow-2xl shadow-black/80 flex items-center justify-between gap-3 animate-fade-in"
      >
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-black/60 border border-white/10 shrink-0 flex items-center justify-center">
            <Image
              src="/icon-192.png"
              alt="Radio Nexo App"
              width={44}
              height={44}
              className="object-contain"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Instalar Radio Nexo</span>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#e5b45f]/20 text-[#e5b45f] border border-[#e5b45f]/30">
                PWA
              </span>
            </span>
            <span className="text-[10px] text-gray-400 leading-tight">
              Escucha en segundo plano y pantalla bloqueada
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleInstallClick}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#d9a149] to-[#f3c87a] hover:from-[#e5b45f] hover:to-[#ffd88d] text-black text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Instalar</span>
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* iOS Safari Instruction Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#12141a] border border-[#e5b45f]/30 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl relative">
            <button
              onClick={() => setShowIOSModal(false)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white rounded-full bg-white/5"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-black border border-[#e5b45f]/30 flex items-center justify-center overflow-hidden shrink-0">
                <Image
                  src="/icon-192.png"
                  alt="Radio Nexo"
                  width={48}
                  height={48}
                  className="object-contain"
                />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">Instalar en tu iPhone / iPad</h3>
                <p className="text-[11px] text-gray-400">Sin descargar de la App Store</p>
              </div>
            </div>

            <div className="space-y-3 pt-2 text-xs text-gray-300">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="w-6 h-6 rounded-full bg-[#e5b45f]/20 text-[#e5b45f] flex items-center justify-center font-bold text-xs shrink-0">
                  1
                </span>
                <p>
                  Toca el botón <strong>Compartir</strong> en la barra inferior de Safari{' '}
                  <Share className="inline w-4 h-4 text-[#e5b45f] ml-1" />
                </p>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="w-6 h-6 rounded-full bg-[#e5b45f]/20 text-[#e5b45f] flex items-center justify-center font-bold text-xs shrink-0">
                  2
                </span>
                <p>
                  Desliza hacia abajo y selecciona{' '}
                  <strong className="text-white">"Añadir a la pantalla de inicio"</strong>{' '}
                  <PlusSquare className="inline w-4 h-4 text-[#e5b45f] ml-1" />
                </p>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="w-6 h-6 rounded-full bg-[#e5b45f]/20 text-[#e5b45f] flex items-center justify-center font-bold text-xs shrink-0">
                  3
                </span>
                <p>
                  Toca <strong>"Añadir"</strong> arriba a la derecha. ¡Listo! Ya tienes la app con ícono propio.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-xl bg-[#e5b45f] hover:bg-[#f3c87a] text-black font-bold text-xs transition-all shadow-lg"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
