/**
 * Renderer Process: Lógica de Interfaz del Docente
 * Maneja perfiles de alumnos con SQLite (IPC), selector de tiempo,
 * transcripción continua limpia y las 5 pestañas maestras con tarjetas quirúrgicas.
 */

// ESTADO GLOBAL DE LA SESIÓN DOCENTE
const state = {
  currentStudent: null,
  targetLevel: 'B1',
  editingStudentId: null,
  durationMinutes: 10,
  secondsRemaining: 600,
  isSessionActive: false,
  isSessionSummaryHandled: false,
  hasEvaluatedSession: false,
  isDemoData: true,
  timerInterval: null,
  activeTab: 'grammar',
  sessionCode: generateRoomCode(),
  feedbackCounts: {
    grammar: 0,
    vocabulary: 0,
    pronunciation: 0,
    upgrade_c1: 0,
    fluency: 0
  }
};

// ELEMENTOS DEL DOM
const studentSelect = document.getElementById('student-select');
const studentLevelSelect = document.getElementById('student-level-select');
const evalLevelLabel = document.getElementById('eval-level-label');
const btnEditStudent = document.getElementById('btn-edit-student');
const btnNewStudent = document.getElementById('btn-new-student');
const modalNewStudent = document.getElementById('modal-new-student');
const modalStudentTitle = document.getElementById('modal-student-title');
const btnSaveStudent = document.getElementById('btn-save-student');
const modalClose = document.getElementById('modal-close');
const btnCancelStudent = document.getElementById('btn-cancel-student');
const formNewStudent = document.getElementById('form-new-student');

const durationBtns = document.querySelectorAll('.duration-btn');
const roomCodeDisplay = document.getElementById('room-code-display');
const btnCopyCode = document.getElementById('btn-copy-code');
const copyTooltipText = document.getElementById('copy-tooltip-text');
const studentConnectionPill = document.getElementById('student-connection-pill');
const sessionTimer = document.getElementById('session-timer');
const btnToggleSession = document.getElementById('btn-toggle-session');
const sessionBtnText = document.getElementById('session-btn-text');

const transcriptFeed = document.getElementById('transcript-feed');
const transcriptEmptyState = document.getElementById('transcript-empty-state');
const recordingPulse = document.getElementById('recording-pulse');
const transcriptStatus = document.getElementById('transcript-status');
const btnExportReport = document.getElementById('btn-export-report');
const exportBtnLabel = document.getElementById('export-btn-label');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Modal de advertencia de nueva sesión y exportación
const modalSessionConfirm = document.getElementById('modal-session-confirm');
const modalConfirmClose = document.getElementById('modal-confirm-close');
const btnSaveAndStart = document.getElementById('btn-save-and-start');
const btnDiscardAndStart = document.getElementById('btn-discard-and-start');
const btnCancelStart = document.getElementById('btn-cancel-start');

// ==============================================================================
// 1. INICIALIZACIÓN
// ==============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  roomCodeDisplay.textContent = state.sessionCode;
  await loadStudentsFromDb();
  setupEventListeners();
  loadSampleDemoData(); // Carga de demostración visual de la rúbrica
});

// Generador de código de sala limpio (EFL-XXX)
function generateRoomCode() {
  const num = Math.floor(100 + Math.random() * 900);
  return `EFL-${num}`;
}

// ==============================================================================
// 2. GESTIÓN DE ALUMNOS (SQLITE LOCAL VÍA IPC)
// ==============================================================================
async function loadStudentsFromDb() {
  try {
    let students = [];
    if (window.electronAPI && typeof window.electronAPI.getStudents === 'function') {
      students = await window.electronAPI.getStudents();
    } else {
      // Mock para pruebas directas en navegador si no se corre dentro de Electron
      students = [
        { id: 1, name: 'Mariana Torres', default_level: 'B1', notes: 'Intermedio' },
        { id: 2, name: 'Alejandro Ruiz', default_level: 'B2', notes: 'Upper-Intermediate' },
        { id: 3, name: 'Sofía Gómez', default_level: 'C1', notes: 'Avanzado' }
      ];
    }

    studentSelect.innerHTML = '';
    students.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.default_level})`;
      opt.dataset.level = s.default_level;
      opt.dataset.name = s.name;
      opt.dataset.notes = s.notes || '';
      studentSelect.appendChild(opt);
    });

    if (students.length > 0) {
      updateSelectedStudent(students[0]);
    }
  } catch (err) {
    console.error('Error al cargar alumnos de SQLite:', err);
  }
}

function updateSelectedStudent(student) {
  state.currentStudent = student;
  const level = student.default_level || 'B1';
  state.targetLevel = level;
  
  // Actualizar selector de nivel en la barra superior y badge visual
  if (studentLevelSelect) {
    studentLevelSelect.value = level;
    studentLevelSelect.className = `level-select badge-${level.toLowerCase()}`;
  }
  if (evalLevelLabel) {
    evalLevelLabel.textContent = level;
  }
}

/**
 * Sincroniza automáticamente el selector local #student-select cuando un alumno se une a la sesión.
 * Si ya existe en el selector, lo selecciona y actualiza su nivel CEFR.
 * Si no existe, lo crea automáticamente en SQLite local con nivel B1 por defecto y lo selecciona.
 */
async function syncStudentFromSession(rawName) {
  if (!rawName || typeof rawName !== 'string') return;
  const targetName = rawName.trim();
  if (!targetName) return;

  console.log(`[UI] Sincronizando estudiante conectado: "${targetName}"...`);

  // 1. Buscar si ya existe en las opciones de #student-select
  let foundIndex = -1;
  for (let i = 0; i < studentSelect.options.length; i++) {
    const optName = studentSelect.options[i].dataset.name;
    if (optName && optName.trim().toLowerCase() === targetName.toLowerCase()) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex !== -1) {
    // Ya existe en la lista: seleccionarlo y aplicar su nivel
    studentSelect.selectedIndex = foundIndex;
    const opt = studentSelect.options[foundIndex];
    updateSelectedStudent({
      id: opt.value,
      name: opt.dataset.name,
      default_level: opt.dataset.level || 'B1',
      notes: opt.dataset.notes || ''
    });
    console.log(`[UI] Estudiante existente seleccionado en dropdown: "${opt.dataset.name}" (${opt.dataset.level})`);
  } else {
    // No existe: crearlo en SQLite local con B1 por defecto
    console.log(`[UI] Estudiante "${targetName}" no registrado localmente. Creando automáticamente con B1...`);
    let createdStudent = null;
    if (window.electronAPI && typeof window.electronAPI.createStudent === 'function') {
      try {
        createdStudent = await window.electronAPI.createStudent({
          name: targetName,
          defaultLevel: 'B1',
          notes: 'Registrado automáticamente al unirse a la sala'
        });
      } catch (err) {
        console.warn('[UI] Error creando alumno en SQLite:', err);
      }
    }

    if (!createdStudent || !createdStudent.id) {
      createdStudent = { id: Date.now(), name: targetName, default_level: 'B1', notes: '' };
    }

    // Agregar la nueva opción al dropdown
    const opt = document.createElement('option');
    opt.value = createdStudent.id;
    opt.textContent = `${createdStudent.name} (${createdStudent.default_level})`;
    opt.dataset.level = createdStudent.default_level;
    opt.dataset.name = createdStudent.name;
    opt.dataset.notes = createdStudent.notes || '';
    studentSelect.appendChild(opt);

    // Dejarlo seleccionado inmediatamente
    studentSelect.selectedIndex = studentSelect.options.length - 1;
    updateSelectedStudent(createdStudent);
    console.log(`[UI] Nuevo estudiante creado y seleccionado en dropdown: "${createdStudent.name}" (${createdStudent.default_level})`);
  }
}

studentSelect.addEventListener('change', (e) => {
  const selectedOpt = studentSelect.options[studentSelect.selectedIndex];
  if (selectedOpt) {
    updateSelectedStudent({
      id: selectedOpt.value,
      name: selectedOpt.dataset.name,
      default_level: selectedOpt.dataset.level,
      notes: selectedOpt.dataset.notes || ''
    });
  }
});

// Cambio rápido de nivel CEFR directo en la barra superior
if (studentLevelSelect) {
  studentLevelSelect.addEventListener('change', async (e) => {
    const newLevel = e.target.value;
    state.targetLevel = newLevel;
    studentLevelSelect.className = `level-select badge-${newLevel.toLowerCase()}`;
    if (evalLevelLabel) {
      evalLevelLabel.textContent = newLevel;
    }

    if (state.currentStudent) {
      state.currentStudent.default_level = newLevel;
      const selectedOpt = studentSelect.options[studentSelect.selectedIndex];
      if (selectedOpt) {
        selectedOpt.dataset.level = newLevel;
        selectedOpt.textContent = `${state.currentStudent.name} (${newLevel})`;
      }

      if (window.electronAPI && typeof window.electronAPI.updateStudent === 'function') {
        try {
          await window.electronAPI.updateStudent(state.currentStudent.id, { defaultLevel: newLevel });
          console.log(`[UI] Nivel de "${state.currentStudent.name}" actualizado a ${newLevel} en SQLite`);
        } catch (err) {
          console.error('[UI] Error al actualizar nivel del estudiante en SQLite:', err);
        }
      }
    }
  });
}

// Modal de Nuevo Alumno / Editar Alumno
if (btnNewStudent) {
  btnNewStudent.addEventListener('click', () => {
    state.editingStudentId = null;
    if (modalStudentTitle) modalStudentTitle.textContent = 'Registrar Perfil de Alumno';
    if (btnSaveStudent) btnSaveStudent.textContent = 'Guardar Alumno';
    formNewStudent.reset();
    modalNewStudent.classList.remove('hidden');
    const nameInput = document.getElementById('new-student-name');
    if (nameInput) nameInput.focus();
  });
}

if (btnEditStudent) {
  btnEditStudent.addEventListener('click', () => {
    if (!state.currentStudent) return;
    state.editingStudentId = state.currentStudent.id;
    if (modalStudentTitle) modalStudentTitle.textContent = 'Editar Perfil de Alumno';
    if (btnSaveStudent) btnSaveStudent.textContent = 'Actualizar Alumno';

    const nameInput = document.getElementById('new-student-name');
    const levelSelect = document.getElementById('new-student-level');
    const notesInput = document.getElementById('new-student-notes');

    if (nameInput) nameInput.value = state.currentStudent.name || '';
    if (levelSelect) levelSelect.value = state.currentStudent.default_level || state.targetLevel || 'B1';
    if (notesInput) notesInput.value = state.currentStudent.notes || '';

    modalNewStudent.classList.remove('hidden');
    if (nameInput) nameInput.focus();
  });
}

function closeModal() {
  modalNewStudent.classList.add('hidden');
  formNewStudent.reset();
  state.editingStudentId = null;
  if (modalStudentTitle) modalStudentTitle.textContent = 'Registrar Perfil de Alumno';
  if (btnSaveStudent) btnSaveStudent.textContent = 'Guardar Alumno';
}

modalClose.addEventListener('click', closeModal);
btnCancelStudent.addEventListener('click', closeModal);

formNewStudent.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-student-name').value.trim();
  const defaultLevel = document.getElementById('new-student-level').value;
  const notes = document.getElementById('new-student-notes').value.trim();

  if (!name) return;

  if (state.editingStudentId) {
    // Modo Edición
    if (window.electronAPI && typeof window.electronAPI.updateStudent === 'function') {
      try {
        await window.electronAPI.updateStudent(state.editingStudentId, { name, defaultLevel, notes });
      } catch (err) {
        console.error('[UI] Error al actualizar alumno:', err);
      }
    }
    const editedId = state.editingStudentId;
    await loadStudentsFromDb();
    // Seleccionar el alumno editado
    for (let i = 0; i < studentSelect.options.length; i++) {
      if (String(studentSelect.options[i].value) === String(editedId)) {
        studentSelect.selectedIndex = i;
        studentSelect.dispatchEvent(new Event('change'));
        break;
      }
    }
  } else {
    // Modo Creación
    if (window.electronAPI && typeof window.electronAPI.createStudent === 'function') {
      try {
        await window.electronAPI.createStudent({ name, defaultLevel, notes });
      } catch (err) {
        console.error('[UI] Error al crear alumno:', err);
      }
    }

    await loadStudentsFromDb();
    // Seleccionar el alumno recién creado
    for (let i = 0; i < studentSelect.options.length; i++) {
      if (studentSelect.options[i].dataset.name === name) {
        studentSelect.selectedIndex = i;
        studentSelect.dispatchEvent(new Event('change'));
        break;
      }
    }
  }

  closeModal();
});

// ==============================================================================
// 3. SELECTOR DE TIEMPO Y TEMPORIZADOR DE SESIÓN
// ==============================================================================
durationBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (state.isSessionActive) return; // Bloquear si la sesión ya corre

    durationBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    state.durationMinutes = parseInt(btn.dataset.minutes, 10);
    state.secondsRemaining = state.durationMinutes * 60;
    updateTimerDisplay();
  });
});

function updateTimerDisplay() {
  const mins = Math.floor(state.secondsRemaining / 60);
  const secs = state.secondsRemaining % 60;
  sessionTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Botón de copiado rápido del código de sesión activo
if (btnCopyCode) {
  btnCopyCode.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const code = state.sessionCode || roomCodeDisplay.textContent.trim();
      await navigator.clipboard.writeText(code);
      btnCopyCode.classList.add('copied');
      if (copyTooltipText) copyTooltipText.classList.remove('hidden');
      setTimeout(() => {
        btnCopyCode.classList.remove('copied');
        if (copyTooltipText) copyTooltipText.classList.add('hidden');
      }, 1500);
    } catch (err) {
      console.warn('[UI] Error al copiar código de sala:', err);
    }
  });
}

// Botón dedicado para guardar/exportar reporte HTML en cualquier momento
if (btnExportReport) {
  btnExportReport.addEventListener('click', () => {
    if (btnExportReport.disabled) return;
    exportSessionReportHTML();

    // Confirmación visual breve de 1.5s
    btnExportReport.classList.add('saved');
    const originalLabel = exportBtnLabel ? exportBtnLabel.textContent : 'Guardar Reporte';
    if (exportBtnLabel) exportBtnLabel.textContent = 'Guardado ✓';

    setTimeout(() => {
      btnExportReport.classList.remove('saved');
      if (exportBtnLabel) exportBtnLabel.textContent = originalLabel;
    }, 1500);
  });
}

// Detecta si hay datos de una sesión anterior en pantalla
function hasPreviousSessionData() {
  if (state.hasEvaluatedSession) return true;
  if (!state.isDemoData) {
    const turns = document.querySelectorAll('#transcript-feed .transcript-turn');
    const cards = document.querySelectorAll('.surgical-card');
    return turns.length > 0 || cards.length > 0;
  }
  return false;
}

function showSessionConfirmModal() {
  if (modalSessionConfirm) modalSessionConfirm.classList.remove('hidden');
}

function hideSessionConfirmModal() {
  if (modalSessionConfirm) modalSessionConfirm.classList.add('hidden');
}

if (modalConfirmClose) modalConfirmClose.addEventListener('click', hideSessionConfirmModal);
if (btnCancelStart) btnCancelStart.addEventListener('click', hideSessionConfirmModal);

if (btnDiscardAndStart) {
  btnDiscardAndStart.addEventListener('click', () => {
    hideSessionConfirmModal();
    proceedToStartNewSession();
  });
}

if (btnSaveAndStart) {
  btnSaveAndStart.addEventListener('click', () => {
    exportSessionReportHTML();
    hideSessionConfirmModal();
    proceedToStartNewSession();
  });
}

btnToggleSession.addEventListener('click', () => {
  if (state.isSessionActive) {
    stopSession();
  } else {
    if (hasPreviousSessionData()) {
      showSessionConfirmModal();
    } else {
      proceedToStartNewSession();
    }
  }
});

/**
 * Prepara la pantalla, renueva automáticamente el código de sala (EFL-XXX)
 * y arranca la nueva sesión en Supabase y la interfaz.
 */
async function proceedToStartNewSession() {
  // 1. Limpiar pantalla de datos anteriores
  transcriptFeed.innerHTML = '';
  if (transcriptEmptyState) transcriptEmptyState.classList.remove('hidden');
  tabPanes.forEach(pane => (pane.innerHTML = ''));
  Object.keys(state.feedbackCounts).forEach(cat => {
    state.feedbackCounts[cat] = 0;
    updateBadgeCounter(cat);
  });
  state.hasEvaluatedSession = false;
  state.isDemoData = false;

  // Limpiar campo de observaciones del docente para la nueva sesión
  const teacherObsEl = document.getElementById('teacher-observations');
  if (teacherObsEl) teacherObsEl.value = '';

  // Deshabilitar botón de exportar reporte mientras no haya resultados evaluados
  if (btnExportReport) btnExportReport.disabled = true;

  // 2. Generar SIEMPRE un código nuevo y único (EFL-XXX) al iniciar sesión
  state.sessionCode = generateRoomCode();
  roomCodeDisplay.textContent = state.sessionCode;
  console.log('[UI] Nuevo código de sala generado para la sesión:', state.sessionCode);

  // 3. Reiniciar temporizador al valor seleccionado
  state.secondsRemaining = state.durationMinutes * 60;
  updateTimerDisplay();

  // 4. Iniciar la grabación y sincronización
  await executeStartSession();
}

async function executeStartSession() {
  btnToggleSession.disabled = true;
  sessionBtnText.textContent = 'Iniciando...';
  transcriptStatus.textContent = 'Sincronizando con Supabase...';

  // 1. Notificar al puente de Supabase Realtime y sincronizar en la nube
  if (window.electronAPI && typeof window.electronAPI.startRealtimeSession === 'function') {
    try {
      await window.electronAPI.startRealtimeSession({
        sessionCode: state.sessionCode,
        studentName: state.currentStudent?.name || 'Estudiante',
        studentLevel: state.targetLevel || state.currentStudent?.default_level || 'B1',
        durationMinutes: state.durationMinutes
      });
      console.log('[Renderer] Sesión Realtime confirmada en Supabase para:', state.sessionCode);
    } catch (err) {
      console.error('[Renderer ERROR] No se pudo guardar la sesión en Supabase:', err);
      const rawMsg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      const cleanMsg = rawMsg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
      alert('Error de Supabase al iniciar la sesión:\n\n' + cleanMsg);

      btnToggleSession.disabled = false;
      btnToggleSession.className = 'btn btn-start';
      sessionBtnText.textContent = 'Iniciar Sesión';
      sessionTimer.classList.remove('running');
      recordingPulse.classList.add('hidden');
      transcriptStatus.textContent = 'Error de Conexión';
      state.isSessionActive = false;
      return; // No continuar si falló la creación en Supabase
    }
  }

  // 2. Si la creación en Supabase fue exitosa, activar UI y temporizador
  btnToggleSession.disabled = false;
  state.isSessionActive = true;
  state.isSessionSummaryHandled = false;
  btnToggleSession.className = 'btn btn-stop';
  sessionBtnText.textContent = 'Detener Sesión';
  sessionTimer.classList.add('running');
  recordingPulse.classList.remove('hidden');
  transcriptStatus.textContent = 'Sesión Activa';

  // Ocultar placeholder si existía
  if (transcriptEmptyState) transcriptEmptyState.classList.add('hidden');

  state.timerInterval = setInterval(() => {
    if (state.secondsRemaining > 0) {
      state.secondsRemaining -= 1;
      updateTimerDisplay();
    } else {
      stopSession();
    }
  }, 1000);
}

async function stopSession() {
  state.isSessionActive = false;
  clearInterval(state.timerInterval);
  btnToggleSession.disabled = true;
  btnToggleSession.className = 'btn btn-start';
  sessionBtnText.textContent = 'Procesando...';
  sessionTimer.classList.remove('running');
  recordingPulse.classList.add('hidden');
  transcriptStatus.textContent = 'Procesando Evaluación...';

  // Detener sesión en Supabase y recibir análisis consolidado
  if (window.electronAPI && typeof window.electronAPI.stopRealtimeSession === 'function') {
    try {
      const summary = await window.electronAPI.stopRealtimeSession('teacher_stopped');
      console.log('[Renderer] Resumen de sesión recibido vía stopRealtimeSession:', summary);
      if (summary) {
        handleSessionCompleted(summary);
      }
    } catch (err) {
      console.error('[Renderer] Error al finalizar sesión:', err);
      transcriptStatus.textContent = 'Finalizada con advertencia';
      btnToggleSession.disabled = false;
      sessionBtnText.textContent = 'Iniciar Sesión';
    }
  } else {
    transcriptStatus.textContent = 'Finalizada';
    btnToggleSession.disabled = false;
    sessionBtnText.textContent = 'Iniciar Sesión';
  }
}

/**
 * Procesa y renderiza en la UI los resultados de la evaluación y la transcripción verbatim.
 * Idempotente: previene ejecuciones duplicadas si se recibe por invoke y por push event.
 */
function handleSessionCompleted(summary) {
  if (!summary || state.isSessionSummaryHandled) return;
  state.isSessionSummaryHandled = true;
  state.hasEvaluatedSession = true;
  state.isDemoData = false;

  console.log('[Renderer] Desplegando transcripción verbatim y tarjetas quirúrgicas en la UI:', summary);

  // Quitar estado de "Procesando Evaluación..." y restaurar controles
  transcriptStatus.textContent = 'Finalizada';
  btnToggleSession.disabled = false;
  btnToggleSession.className = 'btn btn-start';
  sessionBtnText.textContent = 'Iniciar Sesión';
  sessionTimer.classList.remove('running');
  recordingPulse.classList.add('hidden');

  // Habilitar botón de exportación de reporte
  if (btnExportReport) btnExportReport.disabled = false;

  // 1. Desplegar transcripción verbatim en el panel izquierdo
  if (summary.cleanDialogueTurns && summary.cleanDialogueTurns.length > 0) {
    transcriptFeed.innerHTML = '';
    summary.cleanDialogueTurns.forEach(turn => {
      addTranscriptTurn(turn.speaker || 'Participante', turn.text || '');
    });
  }

  // 2. Limpiar tarjetas anteriores y reiniciar contadores
  tabPanes.forEach(pane => (pane.innerHTML = ''));
  Object.keys(state.feedbackCounts).forEach(cat => {
    state.feedbackCounts[cat] = 0;
    updateBadgeCounter(cat);
  });

  // 3. Renderizar las tarjetas quirúrgicas normalizadas en las 5 pestañas maestras
  const cards = Array.isArray(summary.feedbackCards) ? summary.feedbackCards : [];

  cards.forEach(card => {
    // Normalización tolerante de categoría hacia los 5 contenedores CSS
    let rawCat = (card.category || '').toLowerCase().trim();
    let category = 'grammar';
    if (rawCat.includes('gramm') || rawCat.includes('syntax')) category = 'grammar';
    else if (rawCat.includes('vocab') || rawCat.includes('colloc') || rawCat.includes('lexic')) category = 'vocabulary';
    else if (rawCat.includes('pronun') || rawCat.includes('phon')) category = 'pronunciation';
    else if (rawCat.includes('upgrade') || rawCat.includes('c1')) category = 'upgrade_c1';
    else if (rawCat.includes('fluen') || rawCat.includes('cohes')) category = 'fluency';

    // Normalización de severidad
    let severity = card.severity;
    if (!severity) {
      if (category === 'upgrade_c1') severity = 'upgrade';
      else if (category === 'vocabulary' || category === 'fluency') severity = 'refinement';
      else severity = 'basic_error';
    }

    // Extracción segura de propiedades (evita "undefined" en los elementos HTML)
    const teacherContext = card.teacherContext || card.teacher_context || card.context || 'Pregunta o contexto oral';
    const studentResponse = card.studentResponse || card.student_response || card.studentUtterance || card.original || card.response || 'Texto del estudiante';
    const surgicalCorrection = card.surgicalCorrection || card.surgical_correction || card.correction || card.solution || 'Corrección sugerida';
    const explanation = card.explanation || card.reason || card.notes || '';
    const ieltsCriterion = card.ieltsCriterion || card.ielts_criterion || card.criterion || card.band || 'IELTS Band Descriptors';

    addSurgicalCard({
      category,
      severity,
      teacherContext,
      studentResponse,
      surgicalCorrection,
      explanation,
      ieltsCriterion
    });
  });

  // 4. Guardar sesión y tarjetas en SQLite local (en segundo plano y sin bloquear la UI)
  if (window.electronAPI && typeof window.electronAPI.createSession === 'function') {
    window.electronAPI.createSession({
      studentId: state.currentStudent?.id || 1,
      sessionCode: state.sessionCode,
      durationMinutes: state.durationMinutes
    }).then(async (sessionRecord) => {
      if (sessionRecord && sessionRecord.id && cards.length > 0) {
        for (const item of cards) {
          try {
            await window.electronAPI.addFeedbackItem({
              sessionId: sessionRecord.id,
              category: item.category || 'grammar',
              severity: item.severity || 'basic_error',
              teacherContext: item.teacherContext || item.teacher_context || '',
              studentResponse: item.studentResponse || item.student_response || '',
              surgicalCorrection: item.surgicalCorrection || item.surgical_correction || '',
              explanation: item.explanation || item.reason || '',
              ieltsCriterion: item.ieltsCriterion || item.ielts_criterion || ''
            });
          } catch (itemErr) {
            console.warn('[DB] Error guardando tarjeta individual en SQLite:', itemErr.message);
          }
        }
      }
    }).catch(dbErr => {
      console.warn('[DB] Error al registrar sesión en SQLite:', dbErr.message);
    });
  }
}

/**
 * Exporta y descarga un reporte pedagógico independiente en formato HTML
 * con la transcripción verbatim y las tarjetas agrupadas por las 5 categorías.
 */
function exportSessionReportHTML() {
  const studentName = state.currentStudent?.name || 'Estudiante';
  const studentLevel = state.currentStudent?.default_level || 'B1';
  const roomCode = state.sessionCode || 'EFL-XXX';
  const dateStr = new Date().toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' });

  // Recopilar intervenciones de transcripción
  const turnElements = document.querySelectorAll('#transcript-feed .transcript-turn');
  let transcriptHtml = '';
  if (turnElements.length === 0) {
    transcriptHtml = '<p style="color: #6e7681; font-style: italic;">Sin transcripción registrada en esta sesión.</p>';
  } else {
    turnElements.forEach(el => {
      const isTeacher = el.classList.contains('turn-teacher');
      const speaker = isTeacher ? 'Profesor' : 'Estudiante';
      const text = el.querySelector('.turn-content')?.innerHTML || el.textContent;
      transcriptHtml += `
        <div style="margin-bottom: 12px; padding: 12px 16px; border-radius: 8px; background: ${isTeacher ? '#161b22' : '#1a222d'}; border-left: 4px solid ${isTeacher ? '#388bfd' : '#238636'};">
          <div style="font-weight: 700; color: ${isTeacher ? '#58a6ff' : '#3fb950'}; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">${speaker}</div>
          <div style="color: #f0f6fc; font-size: 0.95rem; line-height: 1.6;">${text}</div>
        </div>`;
    });
  }

  // Recopilar observaciones del docente si existen
  const teacherObservations = document.getElementById('teacher-observations')?.value?.trim() || '';
  let observationsHtml = '';
  if (teacherObservations) {
    const formattedObs = teacherObservations.replace(/\n/g, '<br>');
    observationsHtml = `
    <div style="background: rgba(56, 139, 253, 0.08); border: 1px solid rgba(56, 139, 253, 0.3); border-left: 4px solid #388bfd; border-radius: 8px; padding: 16px 20px; margin-bottom: 28px;">
      <h3 style="color: #58a6ff; margin: 0 0 8px 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.1rem;">&#9998;</span> Observaciones Pedagógicas del Docente
      </h3>
      <div style="color: #f0f6fc; font-size: 0.95rem; line-height: 1.6;">${formattedObs}</div>
    </div>`;
  }

  // Recopilar tarjetas por cada una de las 5 pestañas maestras
  const categories = [
    { id: 'grammar', title: '1. Gramática y Sintaxis (Tolerancia Cero)', color: '#388bfd' },
    { id: 'vocabulary', title: '2. Vocabulario y Colocaciones', color: '#8957e5' },
    { id: 'pronunciation', title: '3. Pronunciación y Fonética', color: '#da3633' },
    { id: 'upgrade_c1', title: '4. Upgrade C1 (Sofisticación Discursiva)', color: '#d29922' },
    { id: 'fluency', title: '5. Fluidez y Cohesión', color: '#238636' }
  ];

  let cardsHtml = '';
  let totalCardsCount = 0;

  categories.forEach(cat => {
    const pane = document.getElementById(`tab-pane-${cat.id}`);
    const cards = pane ? pane.querySelectorAll('.surgical-card') : [];
    totalCardsCount += cards.length;

    cardsHtml += `
      <section style="margin-top: 28px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid ${cat.color}; padding-bottom: 8px; margin-bottom: 14px;">
          <h3 style="color: #f0f6fc; font-size: 1.1rem; margin: 0;">${cat.title}</h3>
          <span style="background: ${cat.color}22; color: ${cat.color}; font-weight: 700; padding: 2px 10px; border-radius: 12px; font-size: 0.8rem; border: 1px solid ${cat.color}44;">${cards.length} tarjeta${cards.length === 1 ? '' : 's'}</span>
        </div>`;

    if (cards.length === 0) {
      cardsHtml += `<p style="color: #6e7681; font-size: 0.88rem; font-style: italic; margin-left: 8px;">No se registraron observaciones en esta categoría.</p></section>`;
    } else {
      cards.forEach(card => {
        const context = card.querySelector('.card-context-text')?.textContent || '';
        const studentResp = card.querySelector('.student-utterance')?.innerHTML || '';
        const fix = card.querySelector('.surgical-solution')?.innerHTML || '';
        const explanation = card.querySelector('.card-explanation')?.innerHTML || '';
        const ieltsDesc = card.querySelector('.card-ielts-footer')?.textContent?.trim() || '';

        cardsHtml += `
          <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px;">
            ${context ? `<div style="font-size: 0.8rem; color: #8b949e; margin-bottom: 8px;"><strong>Contexto Docente:</strong> <span style="font-style: italic;">"${context}"</span></div>` : ''}
            <div style="margin-bottom: 8px; line-height: 1.5;"><strong style="color: #f85149; font-size: 0.85rem; text-transform: uppercase;">Respuesta del Alumno:</strong> <div style="color: #f0f6fc; margin-top: 2px;">${studentResp}</div></div>
            <div style="margin-bottom: 8px; line-height: 1.5;"><strong style="color: #3fb950; font-size: 0.85rem; text-transform: uppercase;">Corrección Quirúrgica:</strong> <div style="color: #f0f6fc; margin-top: 2px;">${fix}</div></div>
            ${explanation ? `<div style="background: #0d1117; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; color: #c9d1d9; margin-top: 8px; margin-bottom: 8px; border-left: 3px solid #8957e5;">${explanation}</div>` : ''}
            ${ieltsDesc ? `<div style="font-size: 0.78rem; color: #d29922; font-weight: 600; margin-top: 8px; padding-top: 6px; border-top: 1px solid #21262d;">${ieltsDesc}</div>` : ''}
          </div>`;
      });
      cardsHtml += `</section>`;
    }
  });

  const fullReportHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte de Evaluación Oral IELTS - ${studentName} (${roomCode})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0d1117; color: #f0f6fc; margin: 0; padding: 32px; }
    .report-wrapper { max-width: 900px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 36px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
    h1 { color: #f0f6fc; margin: 0 0 6px 0; font-size: 1.6rem; font-weight: 700; }
    .header-sub { color: #8b949e; margin: 0 0 20px 0; font-size: 0.95rem; }
    .meta-card { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; background: #0d1117; padding: 16px; border-radius: 8px; border: 1px solid #30363d; margin-bottom: 28px; }
    .meta-field strong { display: block; color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .meta-field span { color: #f0f6fc; font-weight: 600; font-size: 1rem; }
    .highlight-error { color: #f85149; background: rgba(248,81,73,0.15); padding: 2px 6px; border-radius: 4px; text-decoration: line-through; }
    .highlight-fix { color: #3fb950; background: rgba(63,185,80,0.15); padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    @media print {
      body { background: #fff !important; color: #000 !important; padding: 10px !important; }
      .report-wrapper { box-shadow: none !important; border: none !important; padding: 0 !important; max-width: 100% !important; }
    }
  </style>
</head>
<body>
  <div class="report-wrapper">
    <h1>Reporte Pedagógico de Evaluación Oral EFL / IELTS</h1>
    <div class="header-sub">Speaking Assistant &bull; Rúbrica IELTS Band Descriptors</div>

    <div class="meta-card">
      <div class="meta-field"><strong>Estudiante</strong><span>${studentName}</span></div>
      <div class="meta-field"><strong>Nivel Objetivo</strong><span>${studentLevel}</span></div>
      <div class="meta-field"><strong>Código de Sala</strong><span style="font-family: monospace; color: #58a6ff;">${roomCode}</span></div>
      <div class="meta-field"><strong>Fecha de Sesión</strong><span>${dateStr}</span></div>
    </div>

    ${observationsHtml}

    <h2 style="color: #f0f6fc; border-bottom: 2px solid #30363d; padding-bottom: 8px; margin-top: 32px; font-size: 1.25rem;">Transcripción Verbatim de la Sesión</h2>
    ${transcriptHtml}

    <h2 style="color: #f0f6fc; border-bottom: 2px solid #30363d; padding-bottom: 8px; margin-top: 36px; font-size: 1.25rem;">Retroalimentación Quirúrgica (${totalCardsCount} Observaciones)</h2>
    ${cardsHtml}

    <footer style="margin-top: 48px; border-top: 1px solid #30363d; padding-top: 18px; color: #6e7681; font-size: 0.8rem; text-align: center;">
      Generado automáticamente por Antigravity EFL Speaking Coach &bull; Archivo pedagógico del docente
    </footer>
  </div>
</body>
</html>`;

  const blob = new Blob([fullReportHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = studentName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  a.download = `Reporte_IELTS_${safeName}_${roomCode}_${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ==============================================================================
// 4. CONTROL DE LAS 5 PESTAÑAS MAESTRAS
// ==============================================================================
function setupEventListeners() {
  // Escuchar eventos en tiempo real provenientes del estudiante vía Supabase
  if (window.electronAPI) {
    if (typeof window.electronAPI.onStudentJoined === 'function') {
      window.electronAPI.onStudentJoined(async (data) => {
        console.log('[UI] Estudiante conectado:', data);
        if (studentConnectionPill) {
          studentConnectionPill.textContent = `Alumno: ${data.studentName || 'Conectado'}`;
          studentConnectionPill.className = 'connection-pill connected';
        }
        if (data && data.studentName) {
          await syncStudentFromSession(data.studentName);
        }
      });
    }

    if (typeof window.electronAPI.onAudioChunk === 'function') {
      window.electronAPI.onAudioChunk((data) => {
        if (transcriptStatus && state.isSessionActive) {
          transcriptStatus.textContent = `Grabando (chunk #${data.sequence})`;
        }
      });
    }

    if (typeof window.electronAPI.onMuteChanged === 'function') {
      window.electronAPI.onMuteChanged((data) => {
        if (studentConnectionPill) {
          if (data.isMuted) {
            studentConnectionPill.textContent = 'Alumno (Silenciado)';
            studentConnectionPill.className = 'connection-pill muted';
          } else {
            studentConnectionPill.textContent = `Alumno: ${state.currentStudent?.name || 'Conectado'}`;
            studentConnectionPill.className = 'connection-pill connected';
          }
        }
      });
    }

    if (typeof window.electronAPI.onStudentLeft === 'function') {
      window.electronAPI.onStudentLeft(() => {
        if (studentConnectionPill) {
          studentConnectionPill.textContent = 'Estudiante Desconectado';
          studentConnectionPill.className = 'connection-pill disconnected';
        }
      });
    }

    if (typeof window.electronAPI.onSessionCompleted === 'function') {
      window.electronAPI.onSessionCompleted((summary) => {
        console.log('[UI] Notificación IPC onSessionCompleted recibida:', summary);
        handleSessionCompleted(summary);
      });
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabTarget = btn.dataset.tab;

      // Cambiar estado activo en botones
      tabButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      // Cambiar panel visible
      tabPanes.forEach(pane => {
        if (pane.dataset.tab === tabTarget) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });

      state.activeTab = tabTarget;
    });
  });
}

function updateBadgeCounter(category) {
  const counterEl = document.getElementById(`counter-${category}`);
  if (counterEl) {
    counterEl.textContent = state.feedbackCounts[category] || 0;
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${category}"]`);
    if (tabBtn && state.feedbackCounts[category] > 0) {
      if (category === 'grammar') tabBtn.classList.add('has-errors');
      if (category === 'upgrade_c1') tabBtn.classList.add('has-items');
    }
  }
}

// ==============================================================================
// 5. INSERCIÓN DE TRANSCRIPCIÓN CONTINUA Y TARJETAS QUIRÚRGICAS
// ==============================================================================

/**
 * Añade una intervención limpia de la conversación en el Panel Izquierdo
 */
function addTranscriptTurn(speaker, text) {
  if (transcriptEmptyState) transcriptEmptyState.classList.add('hidden');

  const isTeacher = speaker.toLowerCase() === 'profesor' || speaker.toLowerCase() === 'teacher';
  const turnEl = document.createElement('div');
  turnEl.className = `transcript-turn ${isTeacher ? 'turn-teacher' : 'turn-student'}`;

  turnEl.innerHTML = `
    <div class="turn-header">
      <span class="speaker-badge">${isTeacher ? 'Profesor' : 'Estudiante'}</span>
    </div>
    <div class="turn-content">${text}</div>
  `;

  transcriptFeed.appendChild(turnEl);
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

/**
 * Añade una Tarjeta Quirúrgica en la Pestaña correspondiente del Panel Derecho
 */
function addSurgicalCard(item) {
  const category = item.category || 'grammar';
  const severity = item.severity || 'basic_error';
  const teacherContext = item.teacherContext || item.teacher_context || 'Pregunta o contexto oral';
  const studentResponse = item.studentResponse || item.student_response || '';
  const surgicalCorrection = item.surgicalCorrection || item.surgical_correction || '';
  const explanation = item.explanation || item.reason || '';
  const ieltsCriterion = item.ieltsCriterion || item.ielts_criterion || 'IELTS Band Descriptors';

  const targetPane = document.getElementById(`tab-pane-${category}`);
  if (!targetPane) return;

  const card = document.createElement('article');
  card.className = 'surgical-card';

  card.innerHTML = `
    <header class="card-context-header">
      <span class="context-tag">Contexto Docente</span>
      <span class="card-context-text">"${teacherContext}"</span>
    </header>

    <div class="card-body">
      <div class="comparison-row">
        <span class="row-label">Respuesta del Alumno:</span>
        <div class="student-utterance">${studentResponse}</div>
      </div>

      <div class="comparison-row">
        <span class="row-label">Corrección Quirúrgica:</span>
        <div class="surgical-solution">${surgicalCorrection}</div>
      </div>

      ${explanation ? `<div class="card-explanation">${explanation}</div>` : ''}
    </div>

    <footer class="card-ielts-footer">
      <div class="ielts-descriptor-chip">
        <span class="ielts-tag">IELTS</span>
        <span>${ieltsCriterion}</span>
      </div>
      <span class="severity-pill severity-${severity === 'upgrade' ? 'upgrade' : (severity === 'basic_error' ? 'basic' : 'refinement')}">
        ${severity === 'basic_error' ? 'Tolerancia Cero' : (severity === 'upgrade' ? 'C1 Parafraseo' : 'Refinamiento')}
      </span>
    </footer>
  `;

  targetPane.appendChild(card);

  // Incrementar contador
  state.feedbackCounts[category] = (state.feedbackCounts[category] || 0) + 1;
  updateBadgeCounter(category);
}

// ==============================================================================
// 6. DATOS DE DEMOSTRACIÓN (Para verificar el Split View y Rúbricas IELTS)
// ==============================================================================
function loadSampleDemoData() {
  state.isDemoData = true;
  state.hasEvaluatedSession = false;
  if (btnExportReport) btnExportReport.disabled = false;

  // Transcripción Continua de Ejemplo
  addTranscriptTurn('Profesor', 'Could you tell me about a time you had to solve a difficult challenge at work or university?');
  addTranscriptTurn('Estudiante', 'Well, last year I was working on a project with a very tight deadline. My team and I needs to coordinate many tasks, but the client was changing the requirements all the days.');
  addTranscriptTurn('Profesor', 'And what did you do to manage those changing expectations?');
  addTranscriptTurn('Estudiante', 'I organize a meeting to explain them the risks. Actually, if we followed their plan, we will lose a lot of money and time.');

  // 1. Pestaña Gramática (Tolerancia cero a errores básicos)
  addSurgicalCard({
    category: 'grammar',
    severity: 'basic_error',
    teacherContext: 'Could you tell me about a time you had to solve a difficult challenge...',
    studentResponse: 'My team and I <span class="highlight-error">needs</span> to coordinate many tasks.',
    surgicalCorrection: 'My team and I <span class="highlight-fix">needed</span> to coordinate many tasks.',
    explanation: 'Concordancia en tiempo pasado: la narración transcurre en pasado simple ("last year"), por lo que el verbo debe conjugarse en pasado ("needed"), no en presente singular.',
    ieltsCriterion: 'GRA: Band 5.0 (Basic systemic error in past simple narration)'
  });

  addSurgicalCard({
    category: 'grammar',
    severity: 'basic_error',
    teacherContext: 'And what did you do to manage those changing expectations?',
    studentResponse: 'If we followed their plan, we <span class="highlight-error">will lose</span> a lot of money.',
    surgicalCorrection: 'If we followed their plan, we <span class="highlight-fix">would lose</span> a lot of money.',
    explanation: 'Segundo condicional: la cláusula subordinada está en pasado hipotético ("followed"), la cláusula principal requiere "would + infinitivo", no "will".',
    ieltsCriterion: 'GRA: Band 5.5 (Inconsistent conditional modal matching)'
  });

  // 2. Pestaña Vocabulario y Colocaciones
  addSurgicalCard({
    category: 'vocabulary',
    severity: 'refinement',
    teacherContext: '...the client was changing the requirements all the days.',
    studentResponse: 'The client was changing the requirements <span class="highlight-error">all the days</span>.',
    surgicalCorrection: 'The client was changing the requirements <span class="highlight-fix">on a daily basis / constantly</span>.',
    explanation: 'Calco directo del español ("todos los días"). En inglés formal de negocios es preferible la colocación "on a daily basis" o el adverbio "constantly".',
    ieltsCriterion: 'LR: Band 6.0 (Awareness of collocation and natural phrasing)'
  });

  // 3. Pestaña Pronunciación y Fonética
  addSurgicalCard({
    category: 'pronunciation',
    severity: 'basic_error',
    teacherContext: 'Could you tell me about a time you had to solve a difficult challenge...',
    studentResponse: 'Pronunciación de la terminación en pasado regular en <span class="highlight-error">"coordinate / coordinated"</span>.',
    surgicalCorrection: 'Asegurar la pronunciación de la sílaba final como <span class="highlight-fix">/kəʊˈɔː.dɪ.neɪ.tɪd/</span> (terminación /ɪd/ tras consonante alveolar /t/).',
    explanation: 'Omisión de la sílaba adicional en verbos terminados en /t/ o /d/.',
    ieltsCriterion: 'PR: Band 5.0 - 6.0 (Phonological features of past regular inflections)'
  });

  // 4. Pestaña Upgrade C1 (Alternativas y Parafraseo)
  addSurgicalCard({
    category: 'upgrade_c1',
    severity: 'upgrade',
    teacherContext: 'And what did you do to manage those changing expectations?',
    studentResponse: 'I organize a meeting to <span class="highlight-error">explain them the risks</span>.',
    surgicalCorrection: '<span class="highlight-fix">I convened a meeting to outline the potential pitfalls</span>.',
    explanation: 'Eleva el registro B1/B2 a nivel ejecutivo C1: "convened" en lugar de "organized" y "outline the potential pitfalls" para denotar precisión y sutileza.',
    ieltsCriterion: 'LR: Band 7.5 - 8.0 (Idiomatic, precise and sophisticated lexical resource)'
  });

  // 5. Pestaña Fluidez y Cohesión
  addSurgicalCard({
    category: 'fluency',
    severity: 'refinement',
    teacherContext: 'Narración de causa y efecto durante el conflicto.',
    studentResponse: 'Coordinación básica mediante yuxtaposición: <span class="highlight-error">"Well... but... Actually..."</span>.',
    surgicalCorrection: 'Utilizar marcadores de discurso cohesivos: <span class="highlight-fix">"Consequently / Faced with this situation, we took proactive steps to..."</span>.',
    explanation: 'Reemplaza conectores coloquiales por marcadores discursivos que estructuran lógicamente la respuesta sin vacilaciones.',
    ieltsCriterion: 'FC: Band 7.0 (Flexible use of cohesive devices to develop a clear line of thought)'
  });
}

