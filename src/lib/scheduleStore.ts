'use client';

import { supabase, isSupabaseConfigured } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface ScheduleItem {
  id: string;
  title: string;
  timeSlot: string;
  host: string;
  description: string;
  isCurrent?: boolean;
  coverUrl?: string;
  tags?: string[];
}

export const DEFAULT_SCHEDULE: ScheduleItem[] = [
  {
    id: 'prog-1',
    title: 'El Despertador NEXO',
    timeSlot: '08:00 – 10:00',
    host: 'Equipo NEXO',
    description: 'Buena vibra, energía matutina y los mejores éxitos para arrancar el día.',
    coverUrl: '/cover_default.webp',
    tags: ['Mañana', 'Éxitos', 'Variedad'],
  },
  {
    id: 'prog-2',
    title: 'NEXO Morning',
    timeSlot: '10:00 – 12:00',
    host: 'Cabina NEXO',
    description: 'Tu dosis de energía positiva, pop latino, tendencias e interacción en vivo.',
    isCurrent: true,
    coverUrl: '/cover_default.webp',
    tags: ['En vivo', 'Pop Latino', 'Tendencias'],
  },
  {
    id: 'prog-3',
    title: 'NEXO Hits',
    timeSlot: '12:00 – 15:00',
    host: 'DJ Resident',
    description: 'Los temas más pedidos por la comunidad, dedicatorias y estrenos.',
    coverUrl: '/cover_default.webp',
    tags: ['Top 40', 'Pedidos', 'Estrenos'],
  },
  {
    id: 'prog-4',
    title: 'Tarde de Conexión',
    timeSlot: '15:00 – 19:00',
    host: 'Cabina NEXO',
    description: 'Sesión crossover, urbano, salsa y la mejor compañía para tu tarde.',
    coverUrl: '/cover_default.webp',
    tags: ['Crossover', 'Urbano', 'Salsa'],
  },
  {
    id: 'prog-5',
    title: 'NEXO Club Sessions',
    timeSlot: '19:00 – 00:00',
    host: 'DJ En Vivo',
    description: 'Mezclas continuas en directo, cabina abierta y fiesta para encender la noche.',
    coverUrl: '/cover_default.webp',
    tags: ['Club', 'En Vivo', 'Party'],
  },
];

const STORAGE_KEY = 'nexo_radio_schedule_v1';
const SCHEDULE_ROW_ID = '99999999-9999-9999-9999-999999999999';
const SCHEDULE_ROW_NAME = '__NEXO_SCHEDULE__';

class ScheduleStore {
  private items: ScheduleItem[] = [...DEFAULT_SCHEDULE];
  private listeners: Set<() => void> = new Set();
  private channel: RealtimeChannel | null = null;
  private initialized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.items = parsed;
        }
      }
    } catch {}

    if (isSupabaseConfigured && supabase) {
      // Load persisted schedule from Supabase
      Promise.resolve(
        supabase
          .from('playlists')
          .select('description')
          .eq('id', SCHEDULE_ROW_ID)
          .maybeSingle()
      )
        .then(({ data, error }: any) => {
          if (!error && data?.description) {
            try {
              const parsed = JSON.parse(data.description);
              if (Array.isArray(parsed) && parsed.length > 0) {
                this.items = parsed;
                this.saveLocal();
                this.notify();
              }
            } catch {}
          }
        })
        .catch(() => {});

      // Realtime broadcast sync across all listeners & studio
      try {
        this.channel = supabase.channel('nexo-schedule-sync', {
          config: { broadcast: { self: false } },
        });
        this.channel
          .on('broadcast', { event: 'schedule_updated' }, ({ payload }) => {
            if (Array.isArray(payload?.items)) {
              this.items = payload.items;
              this.saveLocal();
              this.notify();
            }
          })
          .subscribe();
      } catch {}
    }
  }

  private saveLocal() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {}
  }

  public getSchedule(): ScheduleItem[] {
    return [...this.items];
  }

  public getCurrentShow(): ScheduleItem {
    const explicit = this.items.find((i) => i.isCurrent);
    if (explicit) return explicit;
    return this.items[0] || DEFAULT_SCHEDULE[0];
  }

  public async saveSchedule(nextItems: ScheduleItem[]) {
    this.items = nextItems;
    this.saveLocal();
    this.notify();

    if (this.channel) {
      this.channel
        .send({
          type: 'broadcast',
          event: 'schedule_updated',
          payload: { items: nextItems },
        })
        .catch(() => {});
    }

    if (isSupabaseConfigured && supabase) {
      Promise.resolve(
        supabase.from('playlists').upsert(
          {
            id: SCHEDULE_ROW_ID,
            name: SCHEDULE_ROW_NAME,
            description: JSON.stringify(nextItems),
            cover_url: '/cover_default.webp',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
      ).catch(() => {});
    }
  }

  public async setCurrentShow(id: string) {
    const next = this.items.map((item) => ({
      ...item,
      isCurrent: item.id === id,
    }));
    await this.saveSchedule(next);
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

export const scheduleStore = new ScheduleStore();
