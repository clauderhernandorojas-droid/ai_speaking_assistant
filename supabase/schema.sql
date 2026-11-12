-- ==============================================================================
-- SCHEMA SUPABASE: IA SPEAKING ASSISTANT
-- ==============================================================================

-- 1. Tabla de Sesiones Activas y Puente de Coordinación
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code VARCHAR(8) NOT NULL UNIQUE,
    student_name VARCHAR(120),
    student_level VARCHAR(10) DEFAULT 'B1' CHECK (student_level IN ('A2', 'B1', 'B2', 'C1', 'C2')),
    duration_minutes INTEGER DEFAULT 10 CHECK (duration_minutes IN (5, 10, 15)),
    status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índice rápido por código de sesión
CREATE INDEX IF NOT EXISTS idx_sessions_code ON public.sessions (session_code);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para MVP (acceso seguro vía session_code)
CREATE POLICY "Permitir lectura de sesiones por código" 
ON public.sessions FOR SELECT 
USING (true);

CREATE POLICY "Permitir creación de sesiones (Docente)" 
ON public.sessions FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Permitir actualización de estado de sesión" 
ON public.sessions FOR UPDATE 
USING (true);

-- Habilitar Realtime para la tabla sessions
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;

/*
==============================================================================
CONVENCIONES DE CANAL DE REALTIME BROADCAST (Zero-Exposure)
==============================================================================
Canal de sesión: "session:<session_code>"

Eventos emitidos por el Estudiante:
- 'student:joined'       -> { studentName: string, timestamp: number }
- 'student:audio_chunk'  -> { chunkBase64: string, sequence: number, mimeType: string }
- 'student:mute_change'  -> { isMuted: boolean }
- 'student:left'         -> { timestamp: number }

Eventos emitidos por el Docente:
- 'teacher:session_start' -> { durationMinutes: number, startedAt: number }
- 'teacher:session_end'   -> { reason: 'time_up' | 'teacher_stopped' }
*/

