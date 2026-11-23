import { ChatMessage } from './types';

export interface ChatBadge {
  tier: 'new' | 'fan' | 'vip' | 'legend';
  label: string;
  emoji: string;
  className: string;
  minMessages: number;
  nextTierLabel?: string;
  nextTierMin?: number;
}

export interface TopChatter {
  userName: string;
  count: number;
  badge: ChatBadge;
}

export function getBadgeForCount(count: number): ChatBadge {
  if (count >= 20) {
    return {
      tier: 'legend',
      label: 'Leyenda',
      emoji: '👑',
      className:
        'bg-gradient-to-r from-[#e5b45f]/25 via-amber-400/25 to-rose-500/25 border-[#e5b45f]/60 text-[#f3c87a] shadow-sm shadow-[#e5b45f]/20',
      minMessages: 20,
    };
  }
  if (count >= 8) {
    return {
      tier: 'vip',
      label: 'VIP',
      emoji: '⭐',
      className: 'bg-amber-500/15 border-amber-400/45 text-amber-300',
      minMessages: 8,
      nextTierLabel: '👑 Leyenda',
      nextTierMin: 20,
    };
  }
  if (count >= 3) {
    return {
      tier: 'fan',
      label: 'Fan',
      emoji: '🎧',
      className: 'bg-sky-500/15 border-sky-400/40 text-sky-300',
      minMessages: 3,
      nextTierLabel: '⭐ VIP',
      nextTierMin: 8,
    };
  }
  return {
    tier: 'new',
    label: 'Oyente',
    emoji: '🎵',
    className: '',
    minMessages: 0,
    nextTierLabel: '🎧 Fan',
    nextTierMin: 3,
  };
}

export function buildUserMessageCounts(messages: ChatMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const msg of messages) {
    if (!msg || msg.is_dj || !msg.user_name) continue;
    const key = msg.user_name.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function getUserBadge(userName: string, counts: Map<string, number>): ChatBadge {
  const count = counts.get((userName || '').trim().toLowerCase()) || 0;
  return getBadgeForCount(count);
}

export function getTopChatters(messages: ChatMessage[], limit = 3): TopChatter[] {
  const displayNames = new Map<string, string>();
  const counts = new Map<string, number>();

  for (const msg of messages) {
    if (!msg || msg.is_dj || !msg.user_name) continue;
    const clean = msg.user_name.trim();
    const key = clean.toLowerCase();
    displayNames.set(key, clean);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({
      userName: displayNames.get(key) || key,
      count,
      badge: getBadgeForCount(count),
    }));
}
