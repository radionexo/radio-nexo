-- Migración para permitir actualizar el enlace de Discord desde el Estudio de NEXO Radio
ALTER TABLE public.station_state 
ADD COLUMN IF NOT EXISTS discord_url TEXT DEFAULT 'https://discord.gg/9AksstuAC';
