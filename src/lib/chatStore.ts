'use client';

import { supabase, isSupabaseConfigured } from './supabase';
import { ChatMessage } from './types';
import type { RealtimeChannel } from '@supabase/supabase-js';

const STORAGE_KEY = 'nexo_live_chat_messages_v2';
const PINNED_KEY = 'nexo_live_chat_pinned_v1';
const USERNAME_KEY = 'nexo_chat_username';
const USER_ID_KEY = 'nexo_chat_user_id';
const HAS_CUSTOM_NAME_KEY = 'nexo_chat_has_custom_name_v1';
const MAX_MESSAGES = 120;
const LISTENER_COOLDOWN_MS = 1500;
const MAX_MESSAGE_LENGTH = 280;

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

class ChatStore {
  private messages: ChatMessage[] = [];
  private seenIds: Set<string> = new Set();
  private pinnedMessage: ChatMessage | null = null;
  private typingUsers: Map<string, { userName: string; expiresAt: number }> = new Map();
  private typingCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lastTypingBroadcastAt = 0;
  private lastSentAt = 0;

  private listeners: Set<() => void> = new Set();
  private incomingListeners: Set<(msg: ChatMessage) => void> = new Set();
  private channel: RealtimeChannel | null = null;
  private localBc: BroadcastChannel | null = null;
  private initialized = false;
  private unreadCount = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private rebuildSeenIds() {
    this.seenIds = new Set(this.messages.map((m) => m.id));
  }

  private deduplicateMessages(list: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    const seen = new Set<string>();

    for (const msg of list) {
      if (!msg || !msg.text) continue;
      // Filter out legacy fake seed messages if present in old storage
      if (typeof msg.id === 'string' && msg.id.startsWith('seed-')) continue;
      if (seen.has(msg.id)) continue;

      const msgTime = new Date(msg.created_at).getTime();
      const isDuplicate = result.some((existing) => {
        if (existing.user_name !== msg.user_name) return false;
        if (existing.text.trim().toLowerCase() !== msg.text.trim().toLowerCase()) return false;
        const existingTime = new Date(existing.created_at).getTime();
        return Math.abs(msgTime - existingTime) < 5000;
      });

      if (!isDuplicate) {
        seen.add(msg.id);
        result.push(msg);
      }
    }

    return result;
  }

  private init() {
    if (this.initialized) return;
    this.initialized = true;

    // Load cached real messages from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.messages = this.deduplicateMessages(parsed).slice(-MAX_MESSAGES);
          this.rebuildSeenIds();
          this.saveToStorage();
        }
      }
      const storedPin = localStorage.getItem(PINNED_KEY);
      if (storedPin) {
        const parsedPin = JSON.parse(storedPin);
        if (parsedPin && parsedPin.id && parsedPin.text) {
          this.pinnedMessage = parsedPin;
        }
      }
    } catch {
      this.messages = [];
      this.seenIds.clear();
    }

    // Periodic cleanup for expired typing indicators
    this.typingCleanupTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      this.typingUsers.forEach((val, key) => {
        if (val.expiresAt <= now) {
          this.typingUsers.delete(key);
          changed = true;
        }
      });
      if (changed) this.notify();
    }, 1000);

    // Local tab-to-tab sync
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        this.localBc = new BroadcastChannel('nexo_chat_local_sync');
        this.localBc.onmessage = (evt) => {
          if (!evt.data) return;
          if (evt.data.type === 'NEW_CHAT_MSG') {
            this.appendMessage(evt.data.payload, false);
          } else if (evt.data.type === 'DELETE_CHAT_MSG' && evt.data.id) {
            this.applyDeleteLocal(evt.data.id);
          } else if (evt.data.type === 'CLEAR_CHAT') {
            this.applyClearLocal();
          } else if (evt.data.type === 'PIN_CHAT_MSG') {
            this.applyPinLocal(evt.data.payload ?? null);
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel not available:', e);
    }

    // Connect to Supabase Realtime broadcast & postgres changes channel
    if (isSupabaseConfigured && supabase) {
      try {
        this.channel = supabase.channel('nexo_live_chat', {
          config: {
            broadcast: { self: false },
          },
        });

        this.channel
          .on('broadcast', { event: 'message' }, ({ payload }) => {
            if (payload && payload.id) {
              this.appendMessage(payload, false);
            }
          })
          .on('broadcast', { event: 'delete_message' }, ({ payload }) => {
            if (payload?.id) {
              this.applyDeleteLocal(String(payload.id));
            }
          })
          .on('broadcast', { event: 'clear_chat' }, () => {
            this.applyClearLocal();
          })
          .on('broadcast', { event: 'pin_message' }, ({ payload }) => {
            this.applyPinLocal(payload?.message ?? null);
          })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (payload?.userId && payload?.userName && payload.userId !== this.getUserId()) {
              this.typingUsers.set(payload.userId, {
                userName: payload.userName,
                expiresAt: Date.now() + 3500,
              });
              this.notify();
            }
          })
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages' },
            (payload) => {
              if (payload.new) {
                const d = payload.new as any;
                const formatted: ChatMessage = {
                  id: String(d.id),
                  user_name: d.user_name || 'Oyente',
                  text: d.text,
                  created_at: d.created_at || new Date().toISOString(),
                  is_dj: Boolean(d.is_dj),
                  user_id: d.user_id,
                };
                this.appendMessage(formatted, false);
              }
            }
          )
          .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'chat_messages' },
            (payload) => {
              const oldRow = payload.old as any;
              if (oldRow?.id) {
                this.applyDeleteLocal(String(oldRow.id));
              }
            }
          )
          .subscribe();

        // Fetch recent real messages from Supabase
        Promise.resolve(
          supabase
            .from('chat_messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(MAX_MESSAGES)
        )
          .then(({ data, error }: any) => {
            if (!error && Array.isArray(data)) {
              const formatted: ChatMessage[] = data
                .map((d: any) => ({
                  id: String(d.id),
                  user_name: d.user_name || 'Oyente',
                  text: d.text,
                  created_at: d.created_at || new Date().toISOString(),
                  is_dj: Boolean(d.is_dj),
                  user_id: d.user_id,
                }))
                .reverse();

              this.messages = this.deduplicateMessages(formatted)
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                .slice(-MAX_MESSAGES);
              this.rebuildSeenIds();
              this.saveToStorage();
              this.notify();
            }
          })
          .catch(() => {});
      } catch (err) {
        console.warn('Error setting up Supabase chat channel:', err);
      }
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.messages.slice(-MAX_MESSAGES)));
    } catch (e) {
      console.warn('Error saving chat to localStorage:', e);
    }
  }

  private applyDeleteLocal(id: string) {
    const beforeLen = this.messages.length;
    this.messages = this.messages.filter((m) => m.id !== id);
    this.seenIds.delete(id);
    if (this.pinnedMessage?.id === id) {
      this.applyPinLocal(null);
    }
    if (this.messages.length !== beforeLen) {
      this.saveToStorage();
      this.notify();
    }
  }

  private applyClearLocal() {
    this.messages = [];
    this.seenIds.clear();
    this.pinnedMessage = null;
    this.unreadCount = 0;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PINNED_KEY);
    } catch {}
    this.notify();
  }

  private applyPinLocal(msg: ChatMessage | null) {
    this.pinnedMessage = msg;
    try {
      if (msg) {
        localStorage.setItem(PINNED_KEY, JSON.stringify(msg));
      } else {
        localStorage.removeItem(PINNED_KEY);
      }
    } catch {}
    this.notify();
  }

  private appendMessage(msg: ChatMessage, isLocalSender: boolean) {
    if (!msg || !msg.text) return;

    // 1. O(1) exact ID deduplication
    if (this.seenIds.has(msg.id)) return;

    // 2. Semantic deduplication within 5s window
    const nowTime = new Date(msg.created_at).getTime();
    const existingIndex = this.messages.findIndex((m) => {
      if (m.user_name !== msg.user_name) return false;
      if (m.text.trim().toLowerCase() !== msg.text.trim().toLowerCase()) return false;
      const mTime = new Date(m.created_at).getTime();
      return Math.abs(nowTime - mTime) < 5000;
    });

    if (existingIndex !== -1) {
      if (msg.id && this.messages[existingIndex].id !== msg.id) {
        this.seenIds.delete(this.messages[existingIndex].id);
        this.messages[existingIndex] = { ...this.messages[existingIndex], id: msg.id };
        this.seenIds.add(msg.id);
        this.saveToStorage();
      }
      return;
    }

    // Clear sender from typing list immediately
    if (msg.user_id && this.typingUsers.has(msg.user_id)) {
      this.typingUsers.delete(msg.user_id);
    }

    this.messages.push(msg);
    this.seenIds.add(msg.id);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
      this.rebuildSeenIds();
    }
    this.saveToStorage();

    if (!isLocalSender) {
      this.unreadCount++;
      this.notifyIncoming(msg);
    }

    this.notify();
  }

  public subscribeIncoming(listener: (msg: ChatMessage) => void): () => void {
    this.incomingListeners.add(listener);
    return () => {
      this.incomingListeners.delete(listener);
    };
  }

  private notifyIncoming(msg: ChatMessage) {
    this.incomingListeners.forEach((listener) => {
      try {
        listener(msg);
      } catch (e) {
        console.error('ChatStore incoming listener error:', e);
      }
    });
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public getPinnedMessage(): ChatMessage | null {
    return this.pinnedMessage;
  }

  public getTypingUsers(): string[] {
    const now = Date.now();
    const active: string[] = [];
    this.typingUsers.forEach((val) => {
      if (val.expiresAt > now) active.push(val.userName);
    });
    return active;
  }

  public getUnreadCount(): number {
    return this.unreadCount;
  }

  public clearUnread() {
    if (this.unreadCount === 0) return;
    this.unreadCount = 0;
    this.notify();
  }

  public getUserId(): string {
    if (typeof window === 'undefined') return 'server';
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = 'user_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  }

  public getUserName(): string {
    if (typeof window === 'undefined') return 'Oyente';
    let name = localStorage.getItem(USERNAME_KEY);
    if (!name) {
      const randomNum = Math.floor(100 + Math.random() * 900);
      name = `Oyente #${randomNum}`;
      localStorage.setItem(USERNAME_KEY, name);
    }
    return name;
  }

  public hasCustomName(): boolean {
    if (typeof window === 'undefined') return false;
    const hasCustom = localStorage.getItem(HAS_CUSTOM_NAME_KEY) === 'true';
    const name = localStorage.getItem(USERNAME_KEY);
    if (!hasCustom || !name || name.trim().startsWith('Oyente #')) {
      return false;
    }
    return true;
  }

  public setUserName(newName: string, isCustom = true) {
    if (typeof window === 'undefined') return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    localStorage.setItem(USERNAME_KEY, trimmed);
    if (isCustom) {
      localStorage.setItem(HAS_CUSTOM_NAME_KEY, 'true');
    }
    this.notify();
    try {
      window.dispatchEvent(new CustomEvent('nexo_username_changed', { detail: trimmed }));
    } catch {}
  }

  public sendTyping(isDj = false) {
    if (!this.channel) return;
    const now = Date.now();
    if (now - this.lastTypingBroadcastAt < 2000) return;
    this.lastTypingBroadcastAt = now;

    const userName = isDj ? '🎧 NEXO DJ' : this.getUserName();
    this.channel
      .send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: this.getUserId(), userName },
      })
      .catch(() => {});
  }

  public async deleteMessage(id: string) {
    this.applyDeleteLocal(id);

    if (this.channel) {
      this.channel
        .send({
          type: 'broadcast',
          event: 'delete_message',
          payload: { id },
        })
        .catch(() => {});
    }

    if (this.localBc) {
      try {
        this.localBc.postMessage({ type: 'DELETE_CHAT_MSG', id });
      } catch {}
    }

    if (isSupabaseConfigured && supabase) {
      Promise.resolve(supabase.from('chat_messages').delete().eq('id', id)).catch(() => {});
    }
  }

  public async clearChat() {
    this.applyClearLocal();

    if (this.channel) {
      this.channel
        .send({
          type: 'broadcast',
          event: 'clear_chat',
          payload: {},
        })
        .catch(() => {});
    }

    if (this.localBc) {
      try {
        this.localBc.postMessage({ type: 'CLEAR_CHAT' });
      } catch {}
    }
  }

  public async pinMessage(msg: ChatMessage | null) {
    this.applyPinLocal(msg);

    if (this.channel) {
      this.channel
        .send({
          type: 'broadcast',
          event: 'pin_message',
          payload: { message: msg },
        })
        .catch(() => {});
    }

    if (this.localBc) {
      try {
        this.localBc.postMessage({ type: 'PIN_CHAT_MSG', payload: msg });
      } catch {}
    }
  }

  public async sendMessage(
    text: string,
    options?: { isDj?: boolean; customName?: string }
  ): Promise<ChatMessage> {
    const cleanText = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!cleanText) {
      throw new Error('El mensaje no puede estar vacío');
    }

    const isDj = Boolean(options?.isDj);

    // Anti-spam cooldown for listeners (DJ can send freely)
    if (!isDj) {
      const elapsed = Date.now() - this.lastSentAt;
      if (elapsed < LISTENER_COOLDOWN_MS) {
        throw new Error('Espera un segundo antes de enviar otro mensaje.');
      }
    }
    this.lastSentAt = Date.now();

    const userName = isDj ? '🎧 NEXO DJ' : options?.customName || this.getUserName();

    const newMsg: ChatMessage = {
      id: generateUUID(),
      user_name: userName,
      text: cleanText,
      created_at: new Date().toISOString(),
      is_dj: isDj,
      user_id: this.getUserId(),
    };

    // 1. Append locally
    this.appendMessage(newMsg, true);

    // 2. Broadcast via Supabase Realtime channel
    if (this.channel) {
      try {
        await this.channel.send({
          type: 'broadcast',
          event: 'message',
          payload: newMsg,
        });
      } catch (err) {
        console.warn('Realtime chat broadcast error:', err);
      }
    }

    // 3. Sync to other tabs
    if (this.localBc) {
      try {
        this.localBc.postMessage({
          type: 'NEW_CHAT_MSG',
          payload: newMsg,
        });
      } catch {}
    }

    // 4. Persist to Supabase DB
    if (isSupabaseConfigured && supabase) {
      Promise.resolve(
        supabase.from('chat_messages').insert({
          id: newMsg.id,
          user_name: newMsg.user_name,
          text: newMsg.text,
          is_dj: newMsg.is_dj,
          user_id: newMsg.user_id,
          created_at: newMsg.created_at,
        })
      ).catch(() => {});
    }

    return newMsg;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('ChatStore listener error:', e);
      }
    });
  }
}

export const chatStore = new ChatStore();
