'use client';

import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Check, Copy, AlertCircle, Info, Sparkles } from 'lucide-react';
import { radioStore } from '@/lib/radioStore';

interface DiscordSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DiscordSettingsModal({ isOpen, onClose }: DiscordSettingsModalProps) {
  const [discordUrl, setDiscordUrl] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      const current = radioStore.getStationState();
      setDiscordUrl(current.discord_url || 'https://discord.gg/9AksstuAC');
      setSavedSuccess(false);
      setErrorMsg('');
      setCopied(false);
    }
  }, [isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const trimmed = discordUrl.trim();
    if (!trimmed) {
      setErrorMsg('Por favor ingresa un enlace válido.');
      return;
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setErrorMsg('El enlace debe comenzar con https://');
      return;
    }

    // Save to radioStore (which updates state, localStorage, and broadcasts to all clients in real-time)
    radioStore.setDiscordUrl(trimmed);
    setSavedSuccess(true);

    setTimeout(() => {
      onClose();
    }, 900);
  };

  const handleCopy = () => {
    if (!discordUrl) return;
    navigator.clipboard.writeText(discordUrl.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg rounded-3xl glass-panel p-6 sm:p-7 border border-white/10 shadow-2xl overflow-hidden flex flex-col bg-[#0c0e14]/95 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow accent in Discord Blurple */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#5865F2]/20 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#5865F2]/20 border border-[#5865F2]/40 text-[#5865F2] shadow-lg shadow-[#5865F2]/20">
              <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Enlace de Discord Oficial
              </h3>
              <p className="text-xs text-gray-400">
                Cambia la invitación del botón de Discord para todos los oyentes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-2">
              Enlace de invitación de Discord
            </label>
            <div className="relative flex items-center">
              <input
                type="url"
                value={discordUrl}
                onChange={(e) => {
                  setDiscordUrl(e.target.value);
                  setErrorMsg('');
                  setSavedSuccess(false);
                }}
                placeholder="https://discord.gg/tunuevolink"
                className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/15 focus:border-[#5865F2] focus:ring-2 focus:ring-[#5865F2]/30 text-white placeholder-gray-500 text-sm outline-none transition-all pr-24 font-mono"
                required
              />

              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  title="Copiar enlace"
                  className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>

                {discordUrl && (
                  <a
                    href={discordUrl.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir y probar este enlace en otra pestaña"
                    className="p-1.5 rounded-xl bg-[#5865F2]/20 hover:bg-[#5865F2] text-[#5865F2] hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            {errorMsg && (
              <p className="mt-2 text-xs text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </p>
            )}
          </div>

          {/* Real-time broadcast notice */}
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-[#e5b45f] shrink-0 mt-0.5" />
            <p className="text-xs text-gray-300 leading-relaxed">
              Al guardar, se actualizará <strong>en tiempo real</strong> en la barra superior, el pie de página, el menú móvil y el chat en vivo para todos los oyentes que estén conectados.
            </p>
          </div>

          {/* Tip on permanent Discord invites */}
          <div className="p-3.5 rounded-2xl bg-[#5865F2]/10 border border-[#5865F2]/25 flex items-start gap-3">
            <Info className="w-4 h-4 text-[#5865F2] shrink-0 mt-0.5" />
            <div className="text-xs text-gray-300 leading-relaxed">
              <strong className="text-white block font-semibold mb-0.5">
                ¿Cómo crear un enlace que nunca caduque?
              </strong>
              En tu servidor de Discord: Clic derecho en el canal de bienvenida &gt; <em>Invitar gente</em> &gt; haz clic en <em>&quot;Editar enlace de invitación&quot;</em> &gt; pon <em>&quot;Caduca después de: Nunca&quot;</em> y <em>&quot;Usos: Sin límite&quot;</em>.
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/5 transition-all"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={savedSuccess}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 ${
                savedSuccess
                  ? 'bg-emerald-500 text-white shadow-emerald-500/30'
                  : 'bg-[#5865F2] hover:bg-[#4752c4] text-white shadow-[#5865F2]/30'
              }`}
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>¡Guardado con éxito!</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  <span>Guardar enlace</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
