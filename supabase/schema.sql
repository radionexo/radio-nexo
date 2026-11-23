-- =========================================================
-- NEXO RADIO - Supabase Database Schema (100% Idempotent)
-- =========================================================

-- 1. SONGS TABLE (Compatibilidad / opcional)
CREATE TABLE IF NOT EXISTS public.songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    genre VARCHAR(100) DEFAULT 'Pop',
    duration INTEGER DEFAULT 0,
    file_url TEXT NOT NULL,
    cover_url TEXT DEFAULT '/cover_default.webp',
    file_size INTEGER DEFAULT 0,
    play_count INTEGER DEFAULT 0,
    is_favorite BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PLAYLISTS TABLE
CREATE TABLE IF NOT EXISTS public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    cover_url TEXT DEFAULT '/cover_default.webp',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PLAYLIST_SONGS
CREATE TABLE IF NOT EXISTS public.playlist_songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SONG_REQUESTS TABLE (Solicitudes del público y dedicatorias)
CREATE TABLE IF NOT EXISTS public.song_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    song_title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    dedication TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'played', 'discarded')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. STATION_STATE TABLE (Estado en vivo de la emisora y URL de la antena)
CREATE TABLE IF NOT EXISTS public.station_state (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'current',
    is_live BOOLEAN DEFAULT false,
    is_mic_active BOOLEAN DEFAULT false,
    current_song_id UUID REFERENCES public.songs(id) ON DELETE SET NULL,
    current_song_title VARCHAR(255) DEFAULT 'DJ EN VIVO',
    current_song_artist VARCHAR(255) DEFAULT 'Sesión en Directo · Radio Nexo',
    current_song_cover TEXT DEFAULT '/cover_default.webp',
    current_song_url TEXT DEFAULT '',
    current_song_duration INTEGER DEFAULT 0,
    current_song_progress INTEGER DEFAULT 0,
    listeners_count INTEGER DEFAULT 1,
    air_time_seconds INTEGER DEFAULT 0,
    discord_url TEXT DEFAULT 'https://discord.gg/9AksstuAC',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fila inicial obligatoria 'current'
INSERT INTO public.station_state (id, is_live, current_song_title, current_song_artist, current_song_cover, current_song_url, listeners_count)
VALUES ('current', false, 'DJ EN VIVO', 'Sesión en Directo · Radio Nexo', '/cover_default.webp', '', 1)
ON CONFLICT (id) DO NOTHING;

-- 6. CHAT_MESSAGES TABLE (Chat en vivo)
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_name TEXT NOT NULL,
    user_avatar TEXT,
    text TEXT NOT NULL,
    is_dj BOOLEAN DEFAULT FALSE,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. PUSH_SUBSCRIPTIONS TABLE (Notificaciones Push PWA)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_name VARCHAR(100) DEFAULT 'Oyente',
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================
-- ROW LEVEL SECURITY & POLICIES (IDEMPOTENTES)
-- =========================================================
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public manage songs" ON public.songs;
CREATE POLICY "Public manage songs" ON public.songs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public manage playlists" ON public.playlists;
CREATE POLICY "Public manage playlists" ON public.playlists FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public manage playlist_songs" ON public.playlist_songs;
CREATE POLICY "Public manage playlist_songs" ON public.playlist_songs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public manage song_requests" ON public.song_requests;
CREATE POLICY "Public manage song_requests" ON public.song_requests FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public update station_state" ON public.station_state;
CREATE POLICY "Public update station_state" ON public.station_state FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public manage chat_messages" ON public.chat_messages;
CREATE POLICY "Public manage chat_messages" ON public.chat_messages FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public manage push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Public manage push_subscriptions" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- =========================================================
-- REALTIME PUBLICATION (SIN ERRORES SI YA EXISTEN)
-- =========================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.station_state;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.song_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================
-- TABLE PRIVILEGES FOR ANON & AUTHENTICATED ROLES
-- =========================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
