import { supabase } from './supabase';

export type ReactionEmoji = '🔥' | '❤️' | '🎉' | '👏' | '💃';

export interface LiveReactionEvent {
  id: string;
  emoji: ReactionEmoji;
  x: number; // horizontal offset percentage (15-85)
}

type ReactionCallback = (event: LiveReactionEvent) => void;

class ReactionsBus {
  private channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
  private listeners: Set<ReactionCallback> = new Set();

  private ensureChannel() {
    if (!supabase || this.channel) return;
    this.channel = supabase.channel('nexo-live-reactions', {
      config: { broadcast: { self: false } },
    });

    this.channel
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        if (payload && payload.emoji) {
          this.emitLocal(payload.emoji as ReactionEmoji, payload.x);
        }
      })
      .subscribe();
  }

  private emitLocal(emoji: ReactionEmoji, x?: number) {
    const evt: LiveReactionEvent = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      emoji,
      x: typeof x === 'number' ? x : 20 + Math.random() * 60,
    };
    this.listeners.forEach((cb) => {
      try { cb(evt); } catch {}
    });
  }

  public subscribe(cb: ReactionCallback) {
    this.ensureChannel();
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public send(emoji: ReactionEmoji) {
    const x = 18 + Math.random() * 64;
    // Show immediately locally for zero-latency feel
    this.emitLocal(emoji, x);

    this.ensureChannel();
    if (this.channel) {
      this.channel
        .send({
          type: 'broadcast',
          event: 'reaction',
          payload: { emoji, x },
        })
        .catch(() => {});
    }
  }
}

export const reactionsBus = new ReactionsBus();
