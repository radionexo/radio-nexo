'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Radio, Sparkles, User, Shuffle, ArrowRight, X, Headphones } from 'lucide-react';
import { chatStore } from '@/lib/chatStore';

interface WelcomeNameModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FUN_NICKNAMES = [
  'NexoFan',
  'RitmoStereo',
  'DJ_Lover',
  'Melomano',
  'VibraPositiva',
  'FrecuenciaTop',
  'Rumbero',
  'NexoLover',
  'SuperOyente',
  'BuenaOnda',
  'OndaNexo',
  'ZonaMusical',
];

export default function WelcomeNameModal({ isOpen, onClose }: WelcomeNameModalProps) {
  const [tempName, setTempName] = useState('');
  const [nameError, setNameError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const current = chatStore.getUserName();
      setTempName(current.startsWith('Oyente #') ? '' : current);
      setNameError('');
      const timer = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRandomNickname = () => {
    const base = FUN_NICKNAMES[Math.floor(Math.random() * FUN_NICKNAMES.length)];
    const num = Math.floor(10 + Math.random() * 90);
    setTempName(`${base}_${num}`);
    setNameError('');
    nameInputRef.current?.focus();
  };

  const handleConfirm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = tempName.trim();
    if (!clean) {
      setNameError('Por favor ingresa tu nombre o apodo');
      nameInputRef.current?.focus();
      return;
    }
    if (clean.length < 2) {
      setNameError('El nombre debe tener al menos 2 caracteres');
      nameInputRef.current?.focus();
      return;
    }

    chatStore.setUserName(clean, true);
    setNameError('');
    onClose();
  };

  const handleContinueAnonymous = () => {
    const defaultName = chatStore.getUserName();
    chatStore.setUserName(defaultName, true);
    setNameError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#07090c]/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-[#0e1218] border border-[#e5b45f]/30 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black flex flex-col items-center text-center relative animate-in zoom-in-95 duration-200 my-auto">
        {/* Optional close button if they want to close directly */}
        <button
          type="button"
          onClick={handleContinueAnonymous}
          className="absolute top-4 right-4 p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
          title="Cerrar"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Glowing Radio / Headphones Icon */}
        <div className="relative mb-3 mt-1">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#d9a149]/20 to-[#f3c87a]/20 border border-[#e5b45f]/40 flex items-center justify-center text-[#e5b45f] shadow-lg shadow-[#e5b45f]/20">
            <Radio className="w-7 h-7 animate-pulse" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#e5b45f] text-black flex items-center justify-center shadow-md">
            <Headphones className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Title & Subtitle */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <Sparkles className="w-4 h-4 text-[#e5b45f]" />
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            ¡Bienvenido a RADIO NEXO!
          </h2>
          <Sparkles className="w-4 h-4 text-[#e5b45f]" />
        </div>

        <p className="text-xs text-gray-300 mb-5 max-w-[280px] leading-relaxed">
          ¿Cómo te gustaría que te llamemos? Tu nombre aparecerá cuando pidas canciones o saludes en el chat en vivo.
        </p>

        {/* Form */}
        <form onSubmit={handleConfirm} className="w-full space-y-3.5">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
              <User className="w-4 h-4 text-[#e5b45f]" />
            </div>

            <input
              ref={nameInputRef}
              type="text"
              value={tempName}
              onChange={(e) => {
                setTempName(e.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="Tu nombre o apodo..."
              maxLength={20}
              className={`w-full pl-10 pr-10 py-3 rounded-2xl bg-white/5 border ${
                nameError
                  ? 'border-red-500/80 focus:border-red-500 ring-2 ring-red-500/20'
                  : 'border-white/15 focus:border-[#e5b45f] focus:ring-2 focus:ring-[#e5b45f]/20'
              } text-white placeholder-gray-500 text-sm focus:outline-none transition-all shadow-inner`}
            />

            <button
              type="button"
              onClick={handleRandomNickname}
              title="Generar apodo divertido al azar"
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-[#e5b45f] transition-colors cursor-pointer"
            >
              <Shuffle className="w-4 h-4" />
            </button>
          </div>

          {nameError && (
            <p className="text-[11px] text-red-400 font-medium text-left px-1">
              {nameError}
            </p>
          )}

          <div className="flex flex-col gap-2.5 pt-1">
            <button
              type="submit"
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-[#e5b45f] to-[#f3c87a] hover:from-[#f3c87a] hover:to-[#e5b45f] text-black font-bold text-xs uppercase tracking-wider shadow-xl shadow-[#e5b45f]/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Comenzar a escuchar</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleContinueAnonymous}
              className="text-[11px] text-gray-400 hover:text-gray-300 py-1 transition-colors cursor-pointer"
            >
              Continuar como oyente anónimo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
