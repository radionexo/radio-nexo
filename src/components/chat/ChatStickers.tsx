'use client';

import React from 'react';
import { X } from 'lucide-react';

export interface ChatSticker {
  id: string;
  code: string;
  emoji: string;
  label: string;
  sublabel: string;
  gradient: string;
  border: string;
  glow: string;
}

export const NEXO_STICKERS: ChatSticker[] = [
  {
    id: 'temazo',
    code: '[sticker:temazo]',
    emoji: '🔥',
    label: '¡TEMAZO!',
    sublabel: 'RADIO NEXO',
    gradient: 'from-orange-500/35 via-rose-600/30 to-amber-500/30',
    border: 'border-orange-400/60',
    glow: 'shadow-orange-500/25',
  },
  {
    id: 'volumen',
    code: '[sticker:volumen]',
    emoji: '🎧',
    label: 'SUBE EL VOLUMEN',
    sublabel: 'FULL HD',
    gradient: 'from-[#e5b45f]/35 via-amber-500/25 to-yellow-600/30',
    border: 'border-[#e5b45f]/70',
    glow: 'shadow-[#e5b45f]/25',
  },
  {
    id: 'bailar',
    code: '[sticker:bailar]',
    emoji: '💃',
    label: '¡A BAILAR!',
    sublabel: 'EN VIVO',
    gradient: 'from-fuchsia-500/35 via-pink-600/25 to-rose-500/30',
    border: 'border-pink-400/60',
    glow: 'shadow-pink-500/25',
  },
  {
    id: 'saludo',
    code: '[sticker:saludo]',
    emoji: '🎙️',
    label: 'SALUDO AL AIRE',
    sublabel: 'CABINA NEXO',
    gradient: 'from-sky-500/35 via-blue-600/25 to-indigo-500/30',
    border: 'border-sky-400/60',
    glow: 'shadow-sky-500/25',
  },
  {
    id: 'dedicatoria',
    code: '[sticker:dedicatoria]',
    emoji: '❤️',
    label: 'DEDICATORIA',
    sublabel: 'CON CARIÑO',
    gradient: 'from-rose-500/35 via-red-600/25 to-pink-500/30',
    border: 'border-rose-400/60',
    glow: 'shadow-rose-500/25',
  },
  {
    id: 'vip',
    code: '[sticker:vip]',
    emoji: '👑',
    label: 'NEXO VIP',
    sublabel: 'OYENTE TOP',
    gradient: 'from-amber-400/35 via-yellow-500/25 to-orange-400/30',
    border: 'border-amber-300/70',
    glow: 'shadow-amber-400/30',
  },
  {
    id: 'fiesta',
    code: '[sticker:fiesta]',
    emoji: '🎉',
    label: '¡QUE SIGA LA FIESTA!',
    sublabel: '24/7',
    gradient: 'from-violet-500/35 via-purple-600/25 to-fuchsia-500/30',
    border: 'border-violet-400/60',
    glow: 'shadow-violet-500/25',
  },
  {
    id: 'jajaja',
    code: '[sticker:jajaja]',
    emoji: '😂',
    label: 'JAJAJAJA',
    sublabel: 'BUENA ONDA',
    gradient: 'from-emerald-500/35 via-teal-600/25 to-cyan-500/30',
    border: 'border-emerald-400/60',
    glow: 'shadow-emerald-500/25',
  },
  {
    id: 'aplausos',
    code: '[sticker:aplausos]',
    emoji: '👏',
    label: '¡APLAUSOS!',
    sublabel: 'BRUTAL DJ',
    gradient: 'from-lime-500/30 via-emerald-600/25 to-teal-500/30',
    border: 'border-lime-400/60',
    glow: 'shadow-lime-500/25',
  },
  {
    id: 'vibra',
    code: '[sticker:vibra]',
    emoji: '🚀',
    label: 'FULL VIBRA',
    sublabel: 'DESPEGAMOS',
    gradient: 'from-cyan-500/35 via-blue-600/25 to-violet-500/30',
    border: 'border-cyan-400/60',
    glow: 'shadow-cyan-500/25',
  },
  {
    id: 'tema',
    code: '[sticker:tema]',
    emoji: '🎵',
    label: 'PIDE TU TEMA',
    sublabel: 'EN DIRECTO',
    gradient: 'from-indigo-500/35 via-purple-600/25 to-pink-500/30',
    border: 'border-indigo-400/60',
    glow: 'shadow-indigo-500/25',
  },
  {
    id: 'flow',
    code: '[sticker:flow]',
    emoji: '😎',
    label: 'QUÉ FLOW',
    sublabel: 'SOLO ÉXITOS',
    gradient: 'from-amber-500/35 via-rose-500/25 to-purple-500/30',
    border: 'border-amber-400/60',
    glow: 'shadow-amber-500/25',
  },
];

const STICKER_MAP = new Map(NEXO_STICKERS.map((s) => [s.code, s]));

export function parseStickerCode(text: string): ChatSticker | null {
  if (!text) return null;
  return STICKER_MAP.get(text.trim()) || null;
}

export function StickerMessage({ sticker }: { sticker: ChatSticker }) {
  return (
    <div
      className={`inline-flex flex-col items-center justify-center px-4 py-2.5 rounded-2xl bg-gradient-to-br ${sticker.gradient} border ${sticker.border} shadow-lg ${sticker.glow} backdrop-blur-md select-none animate-in zoom-in-75 duration-200 min-w-[132px]`}
    >
      <span className="text-4xl leading-none drop-shadow-md mb-1 hover:scale-110 transition-transform">
        {sticker.emoji}
      </span>
      <span className="text-[11px] font-black tracking-wider text-white uppercase text-center leading-tight drop-shadow">
        {sticker.label}
      </span>
      <span className="text-[8px] font-bold tracking-[0.2em] text-white/75 uppercase mt-0.5">
        {sticker.sublabel}
      </span>
    </div>
  );
}

interface StickerPickerProps {
  onSelect: (stickerCode: string) => void;
  onClose: () => void;
}

export function StickerPicker({ onSelect, onClose }: StickerPickerProps) {
  return (
    <div className="absolute bottom-full left-2 right-2 mb-2 z-30 rounded-2xl bg-[#10141d]/98 border border-[#e5b45f]/35 shadow-2xl shadow-black/90 backdrop-blur-xl p-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-white/10">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#e5b45f]">
          Stickers Oficiales · Radio Nexo
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Cerrar stickers"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-52 overflow-y-auto scrollbar-thin">
        {NEXO_STICKERS.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            onClick={() => {
              onSelect(sticker.code);
              onClose();
            }}
            className={`flex flex-col items-center justify-center p-2 rounded-xl bg-gradient-to-br ${sticker.gradient} border ${sticker.border} hover:scale-[1.04] active:scale-95 transition-all cursor-pointer`}
          >
            <span className="text-2xl leading-none mb-1">{sticker.emoji}</span>
            <span className="text-[9px] font-black text-white uppercase tracking-wide text-center leading-tight line-clamp-1">
              {sticker.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
