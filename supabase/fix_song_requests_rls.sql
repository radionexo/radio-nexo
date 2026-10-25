-- ==============================================================================
-- CORRECCIÓN DE POLÍTICAS RLS PARA SOLICITUDES DE CANCIONES (NEXO RADIO)
-- Copia y pega este script en el SQL Editor de tu Dashboard de Supabase y dale a RUN.
-- ==============================================================================

-- 1. Asegurar que la tabla song_requests tenga RLS activo
ALTER TABLE public.song_requests ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar políticas previas conflictivas si existen
DROP POLICY IF EXISTS "Public insert requests" ON public.song_requests;
DROP POLICY IF EXISTS "Public read song_requests" ON public.song_requests;
DROP POLICY IF EXISTS "Auth manage requests" ON public.song_requests;
DROP POLICY IF EXISTS "Public manage song_requests" ON public.song_requests;

-- 3. Permitir a los oyentes insertar sus pedidos de canciones
CREATE POLICY "Public insert requests" 
ON public.song_requests 
FOR INSERT 
WITH CHECK (true);

-- 4. Permitir la lectura pública de solicitudes (necesario para .select() y para la cabina)
CREATE POLICY "Public read song_requests" 
ON public.song_requests 
FOR SELECT 
USING (true);

-- 5. Permitir la gestión total desde la cabina (actualizar a 'reviewed', 'discarded' o eliminar)
CREATE POLICY "Public manage song_requests" 
ON public.song_requests 
FOR ALL 
USING (true);

-- 6. Asegurar publicación en Supabase Realtime para notificación sonora instantánea en cabina
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'song_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.song_requests;
  END IF;
END $$;
