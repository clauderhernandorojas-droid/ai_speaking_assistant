-- ==============================================================================
-- SCHEMA SQLITE LOCAL: BASE DE DATOS DEL DOCENTE (teacher-app)
-- ==============================================================================

-- 1. Perfiles de Alumnos y Nivel Predeterminado
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    default_level TEXT NOT NULL DEFAULT 'B1' CHECK(default_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Historial de Sesiones Orales
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    session_code TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 10,
    started_at DATETIME,
    ended_at DATETIME,
    clean_transcript TEXT,
    raw_transcript TEXT,
    status TEXT DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE SET NULL
);

-- 3. Tarjetas Quirúrgicas de Retroalimentación (5 Pestañas Maestras)
CREATE TABLE IF NOT EXISTS feedback_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('grammar', 'vocabulary', 'pronunciation', 'upgrade_c1', 'fluency')),
    severity TEXT DEFAULT 'basic_error',
    teacher_context TEXT NOT NULL,
    student_response TEXT NOT NULL,
    surgical_correction TEXT NOT NULL,
    explanation TEXT,
    ielts_criterion TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_feedback_session_category ON feedback_items(session_id, category);

