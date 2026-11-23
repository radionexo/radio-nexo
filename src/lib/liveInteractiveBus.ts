'use client';

import { supabase, isSupabaseConfigured } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface LivePollOption {
  id: string;
  label: string;
  votes: number;
}

export interface LivePoll {
  id: string;
  question: string;
  options: LivePollOption[];
  createdAt: number;
  voters: Record<string, string>; // userId -> optionId
}

export interface OnAirDedication {
  id: string;
  from: string;
  songTitle: string;
  artist: string;
  message?: string;
  shownAt: number;
}

const POLL_STORAGE_KEY = 'nexo_active_poll_v1';
const DEDICATION_STORAGE_KEY = 'nexo_active_dedication_v1';

class LiveInteractiveBus {
  private channel: RealtimeChannel | null = null;
  private localBc: BroadcastChannel | null = null;
  private listeners: Set<() => void> = new Set();
  private activePoll: LivePoll | null = null;
  private activeDedication: OnAirDedication | null = null;
  private dedicationTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    if (this.initialized) return;
    this.initialized = true;

    // Restore active poll from localStorage if recent (< 2h)
    try {
      const savedPoll = localStorage.getItem(POLL_STORAGE_KEY);
      if (savedPoll) {
        const parsed = JSON.parse(savedPoll) as LivePoll;
        if (parsed?.id && Date.now() - parsed.createdAt < 2 * 60 * 60 * 1000) {
          this.activePoll = parsed;
        }
      }
      const savedDed = localStorage.getItem(DEDICATION_STORAGE_KEY);
      if (savedDed) {
        const parsed = JSON.parse(savedDed) as OnAirDedication;
        if (parsed?.id && Date.now() - parsed.shownAt < 25000) {
          this.activeDedication = parsed;
        }
      }
    } catch {}

    // Local tab-to-tab sync
    try {
      if ('BroadcastChannel' in window) {
        this.localBc = new BroadcastChannel('nexo_interactive_local_sync');
        this.localBc.onmessage = (evt) => {
          if (evt.data) this.handleEvent(evt.data.event, evt.data.payload);
        };
      }
    } catch {}

    // Supabase Realtime Broadcast channel (zero DB writes)
    if (isSupabaseConfigured && supabase) {
      try {
        this.channel = supabase.channel('nexo-live-interactive', {
          config: { broadcast: { self: false } },
        });

        this.channel
          .on('broadcast', { event: 'poll_start' }, ({ payload }) => {
            this.handleEvent('poll_start', payload);
          })
          .on('broadcast', { event: 'poll_vote' }, ({ payload }) => {
            this.handleEvent('poll_vote', payload);
          })
          .on('broadcast', { event: 'poll_end' }, () => {
            this.handleEvent('poll_end', null);
          })
          .on('broadcast', { event: 'dedication_show' }, ({ payload }) => {
            this.handleEvent('dedication_show', payload);
          })
          .on('broadcast', { event: 'dedication_clear' }, () => {
            this.handleEvent('dedication_clear', null);
          })
          .subscribe();
      } catch (err) {
        console.warn('[LiveInteractiveBus] Channel error:', err);
      }
    }
  }

  private handleEvent(event: string, payload: any) {
    if (event === 'poll_start' && payload?.id) {
      this.activePoll = payload as LivePoll;
      this.savePoll();
      this.notify();
    } else if (event === 'poll_vote' && payload?.pollId && payload?.optionId && payload?.userId) {
      this.applyVoteLocal(payload.pollId, payload.optionId, payload.userId);
    } else if (event === 'poll_end') {
      this.activePoll = null;
      this.savePoll();
      this.notify();
    } else if (event === 'dedication_show' && payload?.id) {
      this.applyDedicationLocal(payload as OnAirDedication);
    } else if (event === 'dedication_clear') {
      this.applyDedicationLocal(null);
    }
  }

  private savePoll() {
    try {
      if (this.activePoll) {
        localStorage.setItem(POLL_STORAGE_KEY, JSON.stringify(this.activePoll));
      } else {
        localStorage.removeItem(POLL_STORAGE_KEY);
      }
    } catch {}
  }

  private applyVoteLocal(pollId: string, optionId: string, userId: string) {
    if (!this.activePoll || this.activePoll.id !== pollId) return;
    const prevChoice = this.activePoll.voters[userId];
    if (prevChoice === optionId) return;

    const updatedOptions = this.activePoll.options.map((opt) => {
      let votes = opt.votes;
      if (prevChoice && opt.id === prevChoice) votes = Math.max(0, votes - 1);
      if (opt.id === optionId) votes += 1;
      return { ...opt, votes };
    });

    this.activePoll = {
      ...this.activePoll,
      options: updatedOptions,
      voters: { ...this.activePoll.voters, [userId]: optionId },
    };
    this.savePoll();
    this.notify();
  }

  private applyDedicationLocal(ded: OnAirDedication | null) {
    if (this.dedicationTimer) {
      clearTimeout(this.dedicationTimer);
      this.dedicationTimer = null;
    }
    this.activeDedication = ded;
    try {
      if (ded) {
        localStorage.setItem(DEDICATION_STORAGE_KEY, JSON.stringify(ded));
      } else {
        localStorage.removeItem(DEDICATION_STORAGE_KEY);
      }
    } catch {}
    if (ded) {
      this.dedicationTimer = setTimeout(() => {
        if (this.activeDedication?.id === ded.id) {
          this.activeDedication = null;
          try {
            localStorage.removeItem(DEDICATION_STORAGE_KEY);
          } catch {}
          this.notify();
        }
      }, 25000);
    }
    this.notify();
  }

  private broadcast(event: string, payload: any) {
    if (this.channel) {
      this.channel
        .send({ type: 'broadcast', event, payload })
        .catch(() => {});
    }
    if (this.localBc) {
      try {
        this.localBc.postMessage({ event, payload });
      } catch {}
    }
  }

  // --- PUBLIC API ---
  public getActivePoll(): LivePoll | null {
    return this.activePoll;
  }

  public getActiveDedication(): OnAirDedication | null {
    return this.activeDedication;
  }

  public startPoll(question: string, optionLabels: string[]) {
    const cleanOptions = optionLabels
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (!question.trim() || cleanOptions.length < 2) return;

    const poll: LivePoll = {
      id: `poll_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      question: question.trim().slice(0, 120),
      options: cleanOptions.map((label, idx) => ({
        id: `opt_${idx}`,
        label: label.slice(0, 50),
        votes: 0,
      })),
      createdAt: Date.now(),
      voters: {},
    };

    this.activePoll = poll;
    this.savePoll();
    this.notify();
    this.broadcast('poll_start', poll);
  }

  public votePoll(pollId: string, optionId: string, userId: string) {
    this.applyVoteLocal(pollId, optionId, userId);
    this.broadcast('poll_vote', { pollId, optionId, userId });
  }

  public endPoll() {
    this.activePoll = null;
    this.savePoll();
    this.notify();
    this.broadcast('poll_end', {});
  }

  public showDedication(from: string, songTitle: string, artist: string, message?: string) {
    const ded: OnAirDedication = {
      id: `ded_${Date.now()}`,
      from: from.trim() || 'Oyente',
      songTitle: songTitle.trim(),
      artist: artist.trim(),
      message: message?.trim(),
      shownAt: Date.now(),
    };
    this.applyDedicationLocal(ded);
    this.broadcast('dedication_show', ded);
  }

  public clearDedication() {
    this.applyDedicationLocal(null);
    this.broadcast('dedication_clear', {});
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }
}

export const liveInteractiveBus = new LiveInteractiveBus();
