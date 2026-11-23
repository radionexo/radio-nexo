'use client';

import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Radio,
  User,
  Check,
  Edit3,
  Save,
  X,
} from 'lucide-react';
import { scheduleStore, ScheduleItem } from '@/lib/scheduleStore';
import { radioStore } from '@/lib/radioStore';

export default function StudioSchedulePage() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState('');

  // New / Edit form state
  const [title, setTitle] = useState('');
  const [timeSlot, setTimeSlot] = useState('20:00 – 22:00');
  const [host, setHost] = useState('DJ En Vivo');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('En Vivo, Crossover');

  useEffect(() => {
    setItems(scheduleStore.getSchedule());
    const unsub = scheduleStore.subscribe(() => {
      setItems(scheduleStore.getSchedule());
    });
    return () => unsub();
  }, []);

  const flashToast = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(''), 2500);
  };

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setTimeSlot('20:00 – 22:00');
    setHost('DJ En Vivo');
    setDescription('');
    setTagsInput('En Vivo, Crossover');
  };

  const handleEditStart = (item: ScheduleItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setTimeSlot(item.timeSlot);
    setHost(item.host);
    setDescription(item.description);
    setTagsInput((item.tags || []).join(', '));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !timeSlot.trim()) return;

    const cleanTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 4);

    if (editingId) {
      const updated = items.map((item) =>
        item.id === editingId
          ? {
              ...item,
              title: title.trim(),
              timeSlot: timeSlot.trim(),
              host: host.trim() || 'Equipo NEXO',
              description: description.trim() || 'Transmisión oficial en vivo de Radio Nexo.',
              tags: cleanTags,
            }
          : item
      );
      await scheduleStore.saveSchedule(updated);
      flashToast('Programa actualizado para todos los oyentes.');
    } else {
      const newItem: ScheduleItem = {
        id: `prog-${Date.now()}`,
        title: title.trim(),
        timeSlot: timeSlot.trim(),
        host: host.trim() || 'Equipo NEXO',
        description: description.trim() || 'Transmisión oficial en vivo de Radio Nexo.',
        coverUrl: '/cover_default.webp',
        tags: cleanTags,
        isCurrent: items.length === 0,
      };
      await scheduleStore.saveSchedule([...items, newItem]);
      flashToast('Nuevo programa agregado a la parrilla.');
    }

    resetForm();
  };

  const handleDelete = async (id: string) => {
    const filtered = items.filter((i) => i.id !== id);
    await scheduleStore.saveSchedule(filtered);
    if (editingId === id) resetForm();
    flashToast('Programa eliminado.');
  };

  const handleSetOnAir = async (item: ScheduleItem) => {
    await scheduleStore.setCurrentShow(item.id);
    radioStore.updateStationState({
      current_song_title: item.title,
      current_song_artist: `${item.host} · ${item.timeSlot}`,
    });
    flashToast(`"${item.title}" ahora está marcado AL AIRE.`);
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 space-y-5 max-w-[1400px] w-full mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl glass-panel border border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e5b45f]/15 border border-[#e5b45f]/30 flex items-center justify-center text-[#e5b45f]">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-white tracking-tight">
              Programación Oficial
            </h1>
            <p className="text-xs text-gray-400">
              Edita los horarios y marca qué show está al aire en tiempo real en radionexo.co
            </p>
          </div>
        </div>

        {savedToast && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-xs font-bold animate-in fade-in duration-200">
            <Check className="w-3.5 h-3.5" />
            <span>{savedToast}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Create / Edit Show Form */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-4 p-5 rounded-3xl glass-panel border border-white/10 space-y-3.5 h-fit"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-[#e5b45f] flex items-center gap-1.5">
              {editingId ? <Edit3 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{editingId ? 'Editar Programa' : 'Nuevo Programa'}</span>
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </button>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-gray-300">Nombre del Programa</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Noche de Salsa"
              maxLength={60}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-gray-300">Horario</label>
              <input
                type="text"
                required
                value={timeSlot}
                onChange={(e) => setTimeSlot(e.target.value)}
                placeholder="20:00 – 22:00"
                maxLength={30}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-gray-300">Locutor / DJ</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="DJ Pedro"
                maxLength={40}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-gray-300">Descripción</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="¿De qué trata este espacio musical?"
              maxLength={180}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f] resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-gray-300">
              Etiquetas (separadas por coma)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Salsa, En Vivo, Clásicos"
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e5b45f]"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-[#e5b45f] hover:bg-[#f3c87a] text-black text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-[#e5b45f]/25 active:scale-95 transition-all cursor-pointer"
          >
            {editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{editingId ? 'Guardar Cambios' : 'Agregar a Programación'}</span>
          </button>
        </form>

        {/* Right: Schedule List */}
        <div className="lg:col-span-8 space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                item.isCurrent
                  ? 'bg-[#e5b45f]/10 border-[#e5b45f]/45 shadow-lg shadow-[#e5b45f]/10'
                  : 'glass-panel border-white/10 hover:border-white/20'
              }`}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-[#e5b45f]">
                    <Clock className="w-3.5 h-3.5" />
                    {item.timeSlot}
                  </span>
                  {item.isCurrent && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black">
                      <Radio className="w-3 h-3 animate-pulse" />
                      AL AIRE AHORA
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-black text-white">{item.title}</h3>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <User className="w-3 h-3 text-gray-500" />
                  <span>{item.host}</span>
                </p>
                <p className="text-xs text-gray-300 leading-relaxed">{item.description}</p>

                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-gray-300 font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex sm:flex-col items-center gap-2 shrink-0">
                {!item.isCurrent && (
                  <button
                    type="button"
                    onClick={() => handleSetOnAir(item)}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/35 text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                    title="Marcar este show como Al Aire ahora mismo"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Poner Al Aire</span>
                  </button>
                )}

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleEditStart(item)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-[#e5b45f] border border-white/10 transition-colors cursor-pointer"
                    title="Editar programa"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border border-white/10 transition-colors cursor-pointer"
                    title="Eliminar programa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
