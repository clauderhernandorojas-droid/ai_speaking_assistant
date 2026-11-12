const path = require('path');
const fs = require('fs');

let db = null;

/**
 * Inicializa la base de datos local SQLite para el docente.
 * @param {string} storageDir Directorio donde se guardará el archivo .db (ej. app.getPath('userData'))
 */
function initDatabase(storageDir) {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  const dbPath = path.join(storageDir, 'speaking_assistant.db');
  console.log('[DB] Conectando a SQLite en:', dbPath);

  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  } catch (err) {
    console.warn('[DB] better-sqlite3 no está compilado para este entorno de Electron. Usando fallback ligero.');
    // Fallback ligero en memoria/archivo simple si aún no se corrió electron-rebuild
    db = createFallbackDb(dbPath);
  }

  runMigrations();
  migrateStudentsTableIfNeeded();
  seedInitialStudentsIfEmpty();
  return db;
}

/**
 * Ejecuta el schema SQL inicial
 */
function runMigrations() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath) && typeof db.exec === 'function') {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
    console.log('[DB] Migraciones ejecutadas con éxito.');
  }
}

/**
 * Migra la tabla students si fue creada previamente con una restricción CHECK
 * que no incluía A1, A2 o C2.
 */
function migrateStudentsTableIfNeeded() {
  if (!db || typeof db.prepare !== 'function') return;
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='students'").get();
    if (row && row.sql) {
      const sqlUpper = row.sql.toUpperCase();
      if (!sqlUpper.includes("'A1'") || !sqlUpper.includes("'A2'") || !sqlUpper.includes("'C2'")) {
        console.log('[DB] Migrando tabla students para admitir el espectro completo CEFR (A1-C2)...');
        db.exec(`
          PRAGMA foreign_keys=OFF;
          CREATE TABLE students_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            default_level TEXT NOT NULL DEFAULT 'B1' CHECK(default_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO students_new (id, name, default_level, notes, created_at, updated_at)
            SELECT id, name, default_level, notes, created_at, updated_at FROM students;
          DROP TABLE students;
          ALTER TABLE students_new RENAME TO students;
          PRAGMA foreign_keys=ON;
        `);
        console.log('[DB] Migración de tabla students completada con éxito.');
      }
    }
  } catch (err) {
    console.warn('[DB] Error durante verificación/migración de students:', err.message);
  }
}

/**
 * Semilla de alumnos de prueba si la tabla está vacía
 */
function seedInitialStudentsIfEmpty() {
  const students = getStudents();
  if (students.length === 0) {
    console.log('[DB] Insertando perfiles iniciales de estudiantes...');
    createStudent('Mariana Torres', 'B1', 'Estudiante intermedia. Tiende a olvidar la s en tercera persona.');
    createStudent('Alejandro Ruiz', 'B2', 'Buen control, buscando expandir colocaciones y evitar repetición léxica.');
    createStudent('Sofía Gómez', 'C1', 'Fluida y precisa. Enfoque en estructuras idiomáticas de nivel avanzado.');
  }
}

/**
 * Métodos de acceso a datos (CRUD)
 */
function getStudents() {
  if (!db) return [];
  if (typeof db.prepare === 'function') {
    return db.prepare('SELECT * FROM students ORDER BY name ASC').all();
  }
  return db._students || [];
}

function createStudent(name, defaultLevel = 'B1', notes = '') {
  if (!db) return null;
  if (typeof db.prepare === 'function') {
    const stmt = db.prepare('INSERT INTO students (name, default_level, notes) VALUES (?, ?, ?)');
    const info = stmt.run(name, defaultLevel, notes);
    const newId = Number(info.lastInsertRowid);
    return { id: newId, name, default_level: defaultLevel, notes };
  } else {
    const student = { id: Date.now(), name, default_level: defaultLevel, notes };
    db._students = db._students || [];
    db._students.push(student);
    return student;
  }
}

function updateStudent(studentId, updates = {}) {
  const { name, defaultLevel, notes } = updates;
  if (!db) return null;
  const idNum = Number(studentId);
  if (!idNum) {
    console.warn('[DB updateStudent] studentId inválido:', studentId);
    return null;
  }

  if (typeof db.prepare === 'function') {
    try {
      const stmt = db.prepare(`
        UPDATE students 
        SET name = COALESCE(?, name),
            default_level = COALESCE(?, default_level),
            notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run(name || null, defaultLevel || null, notes !== undefined ? 1 : null, notes || '', idNum);
      return db.prepare('SELECT * FROM students WHERE id = ?').get(idNum);
    } catch (err) {
      if (err.message && err.message.includes('CHECK constraint failed')) {
        console.warn('[DB updateStudent] Fallo de restricción CHECK, migrando tabla students y reintentando...');
        migrateStudentsTableIfNeeded();
        const stmt = db.prepare(`
          UPDATE students 
          SET name = COALESCE(?, name),
              default_level = COALESCE(?, default_level),
              notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        stmt.run(name || null, defaultLevel || null, notes !== undefined ? 1 : null, notes || '', idNum);
        return db.prepare('SELECT * FROM students WHERE id = ?').get(idNum);
      }
      throw err;
    }
  } else {
    const list = db._students || [];
    const idx = list.findIndex(s => Number(s.id) === idNum);
    if (idx !== -1) {
      if (name) list[idx].name = name;
      if (defaultLevel) list[idx].default_level = defaultLevel;
      if (notes !== undefined) list[idx].notes = notes;
      return list[idx];
    }
    return null;
  }
}

function createSession(studentId, sessionCode, durationMinutes) {
  if (typeof db.prepare === 'function') {
    const stmt = db.prepare('INSERT INTO sessions (student_id, session_code, duration_minutes, started_at, status) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)');
    const info = stmt.run(studentId, sessionCode, durationMinutes, 'active');
    return { id: info.lastInsertRowid, student_id: studentId, session_code: sessionCode, duration_minutes: durationMinutes };
  } else {
    const session = { id: Date.now(), student_id: studentId, session_code: sessionCode, duration_minutes: durationMinutes, started_at: new Date().toISOString(), status: 'active' };
    db._sessions = db._sessions || [];
    db._sessions.push(session);
    return session;
  }
}

function updateSession(sessionId, updates = {}) {
  const { cleanTranscript, rawTranscript, status } = updates;
  if (typeof db.prepare === 'function') {
    const stmt = db.prepare('UPDATE sessions SET clean_transcript = COALESCE(?, clean_transcript), raw_transcript = COALESCE(?, raw_transcript), status = COALESCE(?, status), ended_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(cleanTranscript || null, rawTranscript || null, status || null, sessionId);
    return true;
  }
  return true;
}

function addFeedbackItem(item) {
  const { sessionId, category, severity, teacherContext, studentResponse, surgicalCorrection, explanation, ieltsCriterion } = item;
  if (typeof db.prepare === 'function') {
    const stmt = db.prepare(`
      INSERT INTO feedback_items 
      (session_id, category, severity, teacher_context, student_response, surgical_correction, explanation, ielts_criterion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      sessionId,
      category || 'grammar',
      severity || 'basic_error',
      teacherContext || '',
      studentResponse || '',
      surgicalCorrection || '',
      explanation || '',
      ieltsCriterion || ''
    );
    return { id: info.lastInsertRowid, ...item };
  } else {
    const card = { id: Date.now(), ...item };
    db._feedback = db._feedback || [];
    db._feedback.push(card);
    return card;
  }
}

function getFeedbackBySession(sessionId) {
  if (typeof db.prepare === 'function') {
    return db.prepare('SELECT * FROM feedback_items WHERE session_id = ? ORDER BY id DESC').all(sessionId);
  }
  return (db._feedback || []).filter(f => f.session_id === sessionId);
}

/**
 * Fallback en memoria si better-sqlite3 aún no se ha instalado/compilado
 */
function createFallbackDb(dbPath) {
  return {
    _students: [
      { id: 1, name: 'Mariana Torres', default_level: 'B1', notes: 'Intermedio' },
      { id: 2, name: 'Alejandro Ruiz', default_level: 'B2', notes: 'Upper-Intermediate' },
      { id: 3, name: 'Sofía Gómez', default_level: 'C1', notes: 'Avanzado' }
    ],
    _sessions: [],
    _feedback: [],
    exec: () => {}
  };
}

module.exports = {
  initDatabase,
  getStudents,
  createStudent,
  updateStudent,
  createSession,
  updateSession,
  addFeedbackItem,
  getFeedbackBySession
};

