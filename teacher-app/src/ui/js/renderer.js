/**
 * Renderer Process: Lógica de Interfaz del Docente
 * Maneja perfiles de alumnos con SQLite (IPC), selector de tiempo,
 * transcripción continua limpia y las 5 pestañas maestras con tarjetas quirúrgicas.
 */

// ESTADO GLOBAL DE LA SESIÓN DOCENTE
const state = {
  currentStudent: null,
  selectedStudentId: null,
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
  roomCode: generateRoomCode(),
  get sessionCode() { return this.roomCode; },
  set sessionCode(val) { this.roomCode = val; },
  isRoomInitialized: false,
  studentConnected: false,
  activeGuidedCardId: null,
  revealedGuidedCardId: null,
  activeExerciseCardId: null,
  currentExercise: null,
  sessionExercises: [],
  sessionTranscript: '',
  currentModelSpeech: null,
  isModelSpeechProjected: false,
  feedbackCounts: {
    grammar: 0,
    vocabulary: 0,
    pronunciation: 0,
    upgrade_c1: 0,
    fluency: 0,
    model_speech: 0
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
const btnDeleteStudent = document.getElementById('btn-delete-student');
const modalClose = document.getElementById('modal-close');
const btnCancelStudent = document.getElementById('btn-cancel-student');
const formNewStudent = document.getElementById('form-new-student');

const durationBtns = document.querySelectorAll('.duration-btn');
const roomCodeDisplay = document.getElementById('room-code-display');
const btnRefreshCode = document.getElementById('btn-refresh-code');
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
const btnReanalyze = document.getElementById('btn-reanalyze');
const reanalyzeBtnLabel = document.getElementById('reanalyze-btn-label');
const reanalyzeSpinner = document.getElementById('reanalyze-spinner');
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

// Modal de confirmación de nivel antes de analizar
const confirmLevelModal = document.getElementById('confirm-level-modal');
const confirmStudentName = document.getElementById('confirm-student-name');
const confirmLevelBtnGroup = document.getElementById('confirm-level-btn-group');
const btnProceedAnalysis = document.getElementById('btn-proceed-analysis');
const btnCancelConfirmLevel = document.getElementById('btn-cancel-confirm-level');
const btnCloseConfirmLevelModal = document.getElementById('btn-close-confirm-level-modal');

let pendingAnalysisUtterance = '';
let pendingTeacherContext = '';
let tempSelectedConfirmLevel = 'B1';

// ==============================================================================
// 1. INICIALIZACIÓN
// ==============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  roomCodeDisplay.textContent = state.roomCode;
  await loadStudentsFromDb();
  setupEventListeners();
  loadSampleDemoData(); // Carga de demostración visual de la rúbrica

  // Inicializar sala y canal Realtime en modo espera desde el arranque
  await initStandbyRoom();
});

// Inicializa la sala en Supabase en modo espera ('waiting') para que el alumno pueda unirse
async function initStandbyRoom() {
  if (window.electronAPI && typeof window.electronAPI.initRealtimeRoom === 'function') {
    try {
      await window.electronAPI.initRealtimeRoom({
        sessionCode: state.roomCode,
        studentName: state.currentStudent?.name || 'Estudiante',
        studentLevel: state.targetLevel || state.currentStudent?.default_level || 'B1',
        durationMinutes: state.durationMinutes
      });
      state.isRoomInitialized = true;
      console.log('[Renderer] Sala en espera inicializada en Supabase para:', state.roomCode);
    } catch (err) {
      console.warn('[Renderer] Advertencia al inicializar sala en espera:', err.message || err);
    }
  }
}

// Regenera manualmente el código de sala (EFL-XXX) limpiando el anterior
async function regenerateRoomCode() {
  const previousCode = state.roomCode;
  if (previousCode && window.electronAPI) {
    try {
      if (typeof window.electronAPI.broadcastGuidedCorrection === 'function') {
        window.electronAPI.broadcastGuidedCorrection({ action: 'hide', sessionCode: previousCode }).catch(() => {});
      }
      if (typeof window.electronAPI.broadcastMicroExercise === 'function') {
        window.electronAPI.broadcastMicroExercise({ action: 'hide_exercise', sessionCode: previousCode }).catch(() => {});
      }
    } catch (_) {}
  }

  state.roomCode = generateRoomCode();
  roomCodeDisplay.textContent = state.roomCode;
  state.studentConnected = false;
  if (studentConnectionPill) {
    studentConnectionPill.textContent = 'Estudiante Desconectado';
    studentConnectionPill.className = 'connection-pill disconnected';
  }

  await initStandbyRoom();
  console.log('[UI] Código de sala regenerado manualmente:', state.roomCode);
}

// Generador de código de sala limpio (EFL-XXX)
function generateRoomCode() {
  const num = Math.floor(100 + Math.random() * 900);
  return `EFL-${num}`;
}

// ==============================================================================
// 2. GESTIÓN DE ALUMNOS (SQLITE LOCAL VÍA IPC)
// ==============================================================================
async function loadStudentsFromDb(selectTarget = null) {
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
    const target = selectTarget !== null && selectTarget !== undefined ? selectTarget : state.selectedStudentId;
    let targetIndex = -1;

    students.forEach((s, idx) => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = `${s.name} (${s.default_level})`;
      opt.dataset.level = s.default_level;
      opt.dataset.name = s.name;
      opt.dataset.notes = s.notes || '';
      studentSelect.appendChild(opt);

      if (target !== null && target !== undefined) {
        if (String(s.id) === String(target) || s.name.trim().toLowerCase() === String(target).trim().toLowerCase()) {
          targetIndex = idx;
        }
      }
    });

    if (targetIndex !== -1) {
      studentSelect.selectedIndex = targetIndex;
      studentSelect.value = String(students[targetIndex].id);
      updateSelectedStudent(students[targetIndex]);
    } else if (students.length > 0) {
      studentSelect.selectedIndex = 0;
      studentSelect.value = String(students[0].id);
      updateSelectedStudent(students[0]);
    } else {
      updateSelectedStudent(null);
    }
    return students;
  } catch (err) {
    console.error('Error al cargar alumnos de SQLite:', err);
    return [];
  }
}

function updateSelectedStudent(student) {
  state.currentStudent = student;
  state.selectedStudentId = student ? student.id : null;
  const level = (student && student.default_level) || 'B1';
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
    studentSelect.value = String(opt.value);
    updateSelectedStudent({
      id: opt.value,
      name: opt.dataset.name,
      default_level: opt.dataset.level || 'B1',
      notes: opt.dataset.notes || ''
    });
    console.log(`[UI] Estudiante existente seleccionado en dropdown: "${opt.dataset.name}" (ID: ${opt.value}, Nivel: ${opt.dataset.level})`);
  } else {
    // No existe: crearlo en SQLite local con B1 por defecto
    console.log(`[UI] Estudiante "${targetName}" no registrado localmente. Creando en SQLite con B1...`);
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

    const selectTarget = (createdStudent && createdStudent.id) ? createdStudent.id : targetName;
    // Recargar la lista oficial completa desde la base de datos y dejar seleccionado al alumno
    await loadStudentsFromDb(selectTarget);
    console.log(`[UI] Alumno "${targetName}" sincronizado y seleccionado desde SQLite con ID: ${state.selectedStudentId}`);
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

    if (state.currentStudent && state.currentStudent.id) {
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
    if (btnDeleteStudent) btnDeleteStudent.classList.add('hidden');
    formNewStudent.reset();
    modalNewStudent.classList.remove('hidden');
    const nameInput = document.getElementById('new-student-name');
    if (nameInput) nameInput.focus();
  });
}

if (btnEditStudent) {
  btnEditStudent.addEventListener('click', () => {
    if (!state.currentStudent || !state.currentStudent.id) {
      console.warn('[UI] No hay un estudiante válido seleccionado para editar.');
      return;
    }
    state.editingStudentId = state.currentStudent.id;
    if (modalStudentTitle) modalStudentTitle.textContent = 'Editar Perfil de Alumno';
    if (btnSaveStudent) btnSaveStudent.textContent = 'Actualizar Alumno';
    if (btnDeleteStudent) btnDeleteStudent.classList.remove('hidden');

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
  if (btnDeleteStudent) btnDeleteStudent.classList.add('hidden');
  if (modalStudentTitle) modalStudentTitle.textContent = 'Registrar Perfil de Alumno';
  if (btnSaveStudent) btnSaveStudent.textContent = 'Guardar Alumno';
}

modalClose.addEventListener('click', closeModal);
btnCancelStudent.addEventListener('click', closeModal);

if (btnDeleteStudent) {
  btnDeleteStudent.addEventListener('click', async () => {
    const rawId = state.editingStudentId || state.selectedStudentId || (state.currentStudent && state.currentStudent.id);
    const studentIdToDelete = Number(rawId);
    if (!studentIdToDelete || isNaN(studentIdToDelete)) {
      alert('No se pudo determinar el ID del alumno a eliminar.');
      return;
    }

    const studentName = (state.currentStudent && state.currentStudent.name) || 'este alumno';
    const confirmed = window.confirm(`¿Estás seguro de eliminar a ${studentName}? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    console.log(`[UI] Eliminando estudiante ID ${studentIdToDelete}: "${studentName}"...`);
    if (window.electronAPI && typeof window.electronAPI.deleteStudent === 'function') {
      try {
        await window.electronAPI.deleteStudent(studentIdToDelete);
        console.log(`[UI] Estudiante "${studentName}" eliminado de SQLite.`);
      } catch (err) {
        console.error('[UI] Error al eliminar estudiante de SQLite:', err);
        const errMsg = err && err.message ? err.message : String(err);
        const cleanMsg = errMsg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
        alert(`Ocurrió un error al eliminar el alumno: ${cleanMsg}`);
        return;
      }
    } else {
      alert('Ocurrió un error al eliminar el alumno: Función deleteStudent no disponible en el proceso principal.');
      return;
    }

    closeModal();
    // Limpiar id seleccionado para que loadStudentsFromDb seleccione el primero restante
    state.selectedStudentId = null;
    await loadStudentsFromDb();
  });
}

formNewStudent.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-student-name').value.trim();
  const defaultLevel = document.getElementById('new-student-level').value;
  const notes = document.getElementById('new-student-notes').value.trim();

  if (!name) return;

  if (state.editingStudentId) {
    // Modo Edición
    const targetId = state.editingStudentId;
    console.log(`[UI] Guardando cambios de alumno ID ${targetId}: "${name}" (${defaultLevel})...`);
    if (window.electronAPI && typeof window.electronAPI.updateStudent === 'function') {
      try {
        await window.electronAPI.updateStudent(targetId, { name, defaultLevel, notes });
      } catch (err) {
        console.error('[UI] Error al actualizar alumno:', err);
      }
    }
    await loadStudentsFromDb(targetId);
  } else {
    // Modo Creación
    console.log(`[UI] Registrando nuevo alumno: "${name}" (${defaultLevel})...`);
    let created = null;
    if (window.electronAPI && typeof window.electronAPI.createStudent === 'function') {
      try {
        created = await window.electronAPI.createStudent({ name, defaultLevel, notes });
      } catch (err) {
        console.error('[UI] Error al crear alumno:', err);
      }
    }
    const selectTarget = (created && created.id) ? created.id : name;
    await loadStudentsFromDb(selectTarget);
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

// Botón para regenerar código de sala manualmente
if (btnRefreshCode) {
  btnRefreshCode.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (state.isSessionActive) {
      alert('No puedes cambiar el código de sala mientras la sesión está en curso.');
      return;
    }
    if (state.studentConnected) {
      if (!confirm('Hay un estudiante conectado en esta sala. ¿Deseas generar un nuevo código y cambiar de sala?')) {
        return;
      }
    }
    await regenerateRoomCode();
  });
}

// Botón de copiado rápido del código de sesión activo
if (btnCopyCode) {
  btnCopyCode.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const code = state.roomCode || roomCodeDisplay.textContent.trim();
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

// ==============================================================================
// GESTIÓN DEL MODAL DE CONFIRMACIÓN DE NIVEL Y EJECUCIÓN DEL ANÁLISIS
// ==============================================================================

function updateConfirmLevelPillSelection(level) {
  tempSelectedConfirmLevel = level;
  if (!confirmLevelBtnGroup) return;
  const pills = confirmLevelBtnGroup.querySelectorAll('.btn-level-pill');
  pills.forEach(pill => {
    if (pill.dataset.level === level) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

function openConfirmLevelModal({ studentUtterance, teacherContext }) {
  pendingAnalysisUtterance = (studentUtterance || '').trim();
  pendingTeacherContext = (teacherContext || '').trim();

  const currentLevel = (state.targetLevel || state.currentStudent?.default_level || 'B1').toUpperCase().trim();
  tempSelectedConfirmLevel = ['A2', 'B1', 'B2', 'C1'].includes(currentLevel) ? currentLevel : 'B1';

  if (confirmStudentName) {
    confirmStudentName.textContent = state.currentStudent?.name || 'Estudiante en Sesión';
  }

  updateConfirmLevelPillSelection(tempSelectedConfirmLevel);

  if (confirmLevelModal) {
    confirmLevelModal.classList.remove('hidden');
  }
}

function closeConfirmLevelModal() {
  if (confirmLevelModal) {
    confirmLevelModal.classList.add('hidden');
  }
}

async function executeAnalysisWithConfirmedLevel(confirmedLevel, studentUtterance, teacherContext) {
  if (!studentUtterance) {
    alert('No hay texto del estudiante disponible para evaluar.');
    return;
  }

  // 1. Sincronizar nivel confirmado con el estado y la UI superior
  state.targetLevel = confirmedLevel;
  if (studentLevelSelect) {
    studentLevelSelect.value = confirmedLevel;
    studentLevelSelect.className = `level-select badge-${confirmedLevel.toLowerCase()}`;
  }
  if (evalLevelLabel) {
    evalLevelLabel.textContent = confirmedLevel;
  }

  // Actualizar nivel del estudiante en SQLite si cambió
  if (state.currentStudent) {
    if (state.currentStudent.default_level !== confirmedLevel) {
      state.currentStudent.default_level = confirmedLevel;
      const selectedOpt = studentSelect.options[studentSelect.selectedIndex];
      if (selectedOpt) {
        selectedOpt.dataset.level = confirmedLevel;
        selectedOpt.textContent = `${state.currentStudent.name} (${confirmedLevel})`;
      }
      if (window.electronAPI && typeof window.electronAPI.updateStudent === 'function') {
        try {
          await window.electronAPI.updateStudent(state.currentStudent.id, { defaultLevel: confirmedLevel });
          console.log(`[UI] Nivel confirmado de "${state.currentStudent.name}" actualizado a ${confirmedLevel} en SQLite`);
        } catch (dbErr) {
          console.warn('[UI] Error al actualizar nivel de alumno en SQLite:', dbErr);
        }
      }
    }
  }

  // 2. Estado visual de análisis
  if (btnReanalyze) {
    btnReanalyze.disabled = true;
    btnReanalyze.classList.add('is-analyzing');
  }
  if (reanalyzeBtnLabel) reanalyzeBtnLabel.textContent = 'Analizando...';
  if (transcriptStatus) transcriptStatus.textContent = `Analizando con Gemini (Nivel ${confirmedLevel} / Tolerancia 35s)...`;

  try {
    console.log(`[Renderer] Ejecutando evaluación con Gemini para nivel ${confirmedLevel}:`, studentUtterance.slice(0, 100));
    const evalResult = await window.electronAPI.evaluateUtterance({
      teacherContext: teacherContext || '',
      studentUtterance,
      studentLevel: confirmedLevel
    });

    let newCards = [];
    let newModelSpeech = null;

    if (Array.isArray(evalResult)) {
      newCards = evalResult;
    } else if (evalResult && typeof evalResult === 'object') {
      newCards = evalResult.feedbackCards || [];
      newModelSpeech = evalResult.modelSpeech || null;
    }

    // 3. Limpiar tarjetas anteriores y reiniciar contadores
    tabPanes.forEach(pane => {
      if (pane.dataset.tab !== 'model_speech') pane.innerHTML = '';
    });
    state.activeGuidedCardId = null;
    state.revealedGuidedCardId = null;
    state.activeExerciseCardId = null;
    state.currentExercise = null;
    Object.keys(state.feedbackCounts).forEach(cat => {
      state.feedbackCounts[cat] = 0;
      updateBadgeCounter(cat);
    });

    // 4. Renderizar nuevas tarjetas quirúrgicas
    newCards.forEach(card => {
      let rawCat = (card.category || '').toLowerCase().trim();
      let category = 'grammar';
      if (rawCat.includes('gramm') || rawCat.includes('syntax')) category = 'grammar';
      else if (rawCat.includes('vocab') || rawCat.includes('colloc') || rawCat.includes('lexic')) category = 'vocabulary';
      else if (rawCat.includes('pronun') || rawCat.includes('phon')) category = 'pronunciation';
      else if (rawCat.includes('upgrade') || rawCat.includes('c1')) category = 'upgrade_c1';
      else if (rawCat.includes('fluen') || rawCat.includes('cohes')) category = 'fluency';

      let severity = card.severity;
      if (!severity) {
        if (category === 'upgrade_c1') severity = 'upgrade';
        else if (category === 'vocabulary' || category === 'fluency') severity = 'refinement';
        else severity = 'basic_error';
      }

      const tCtx = card.teacherContext || card.teacher_context || card.context || '';
      const sResp = card.studentResponse || card.student_response || card.studentUtterance || card.original || card.response || '';
      const sCorr = card.surgicalCorrection || card.surgical_correction || card.correction || card.solution || '';
      const expl = card.explanation || card.reason || card.notes || '';
      const crit = card.ieltsCriterion || card.ielts_criterion || card.criterion || card.band || 'IELTS Band Descriptors';
      const contrastiveCapsule = card.contrastiveCapsule || null;

      addSurgicalCard({
        category,
        severity,
        teacherContext: tCtx,
        studentResponse: sResp,
        surgicalCorrection: sCorr,
        explanation: expl,
        ieltsCriterion: crit,
        contrastiveCapsule
      });
    });

    // 5. Renderizar discurso modelo reformulado
    state.currentModelSpeech = newModelSpeech;
    renderModelSpeechTab(newModelSpeech);

    state.hasEvaluatedSession = true;
    state.isDemoData = false;
    if (btnExportReport) btnExportReport.disabled = false;
    if (transcriptStatus) transcriptStatus.textContent = `Evaluación completada (${newCards.length} tarjetas)`;

    // Guardar sesión y tarjetas en SQLite local
    if (window.electronAPI && typeof window.electronAPI.createSession === 'function' && newCards.length > 0) {
      window.electronAPI.createSession({
        studentId: state.currentStudent?.id || 1,
        sessionCode: state.roomCode || state.sessionCode || 'EFL-ROOM',
        durationMinutes: state.durationMinutes || 10
      }).then(async (sessionRecord) => {
        if (sessionRecord && sessionRecord.id) {
          for (const item of newCards) {
            try {
              await window.electronAPI.addFeedbackItem({
                sessionId: sessionRecord.id,
                category: item.category,
                severity: item.severity,
                originalText: item.studentResponse,
                suggestedText: item.surgicalCorrection,
                notes: item.explanation
              });
            } catch (e) {
              console.warn('[DB] Error guardando tarjeta individual:', e);
            }
          }
          console.log(`[DB] Sesión #${sessionRecord.id} y ${newCards.length} tarjetas guardadas en SQLite.`);
        }
      }).catch(err => console.warn('[DB] Error creando sesión en SQLite:', err));
    }
  } catch (err) {
    console.error('[Renderer] Error en análisis con Gemini:', err);
    if (transcriptStatus) transcriptStatus.textContent = 'Error al evaluar';
    alert(`Error al analizar con Gemini: ${err.message || err}`);
  } finally {
    if (btnReanalyze) {
      btnReanalyze.disabled = false;
      btnReanalyze.classList.remove('is-analyzing');
    }
    if (reanalyzeBtnLabel) reanalyzeBtnLabel.textContent = 'Re-analizar';
    btnToggleSession.disabled = false;
    btnToggleSession.className = 'btn btn-start';
    sessionBtnText.textContent = 'Iniciar Sesión';
  }
}

// Botón para re-analizar la transcripción visible actual con Gemini
if (btnReanalyze) {
  btnReanalyze.addEventListener('click', async () => {
    if (btnReanalyze.disabled || state.isSessionActive) return;

    // 1. Extraer transcripción visible actual
    const turns = document.querySelectorAll('#transcript-feed .transcript-turn');
    let teacherContext = '';
    let studentUtterance = '';

    turns.forEach(turn => {
      const isTeacher = turn.classList.contains('turn-teacher');
      const contentEl = turn.querySelector('.turn-content');
      const text = (contentEl ? contentEl.textContent : turn.textContent).trim();
      if (isTeacher) {
        teacherContext = (teacherContext + ' ' + text).trim();
      } else {
        studentUtterance = (studentUtterance + ' ' + text).trim();
      }
    });

    if (!studentUtterance && state.sessionTranscript) {
      studentUtterance = state.sessionTranscript.trim();
    }

    if (!studentUtterance) {
      alert('No hay transcripción del estudiante visible para re-analizar.');
      return;
    }

    // Abrir modal de confirmación de nivel antes de llamar a Gemini
    openConfirmLevelModal({ studentUtterance, teacherContext });
  });
}

// Listeners del Modal de Confirmación de Nivel
if (confirmLevelBtnGroup) {
  confirmLevelBtnGroup.addEventListener('click', (e) => {
    const pill = e.target.closest('.btn-level-pill');
    if (!pill || !pill.dataset.level) return;
    updateConfirmLevelPillSelection(pill.dataset.level);
  });
}

if (btnCancelConfirmLevel) {
  btnCancelConfirmLevel.addEventListener('click', closeConfirmLevelModal);
}

if (btnCloseConfirmLevelModal) {
  btnCloseConfirmLevelModal.addEventListener('click', closeConfirmLevelModal);
}

if (btnProceedAnalysis) {
  btnProceedAnalysis.addEventListener('click', async () => {
    closeConfirmLevelModal();
    const confirmed = tempSelectedConfirmLevel || 'B1';
    await executeAnalysisWithConfirmedLevel(confirmed, pendingAnalysisUtterance, pendingTeacherContext);
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
 * Prepara la pantalla, gestiona el código de sala (reutilizando la sala inicial en espera
 * o generando una nueva solo tras finalizar una clase anterior) e inicia la sesión en Supabase y UI.
 */
async function proceedToStartNewSession() {
  const isStartingAfterPreviousClass = state.hasEvaluatedSession;

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
  state.sessionExercises = [];
  state.sessionTranscript = '';
  state.currentModelSpeech = null;
  state.isModelSpeechProjected = false;

  // Limpiar campo de observaciones del docente para la nueva sesión
  const teacherObsEl = document.getElementById('teacher-observations');
  if (teacherObsEl) teacherObsEl.value = '';

  // Deshabilitar botones mientras no haya resultados evaluados
  if (btnExportReport) btnExportReport.disabled = true;
  if (btnReanalyze) btnReanalyze.disabled = true;

  // 2. Gestión inteligente del código de sala:
  // - Si venimos de una clase previa ya evaluada, limpiar pantalla del alumno y generar NUEVO código.
  // - Si es la sala inicial generada al arrancar la app, REUTILIZAR ese mismo código intacto.
  if (isStartingAfterPreviousClass) {
    const previousCode = state.roomCode;
    if (previousCode && window.electronAPI) {
      try {
        if (typeof window.electronAPI.broadcastGuidedCorrection === 'function') {
          window.electronAPI.broadcastGuidedCorrection({ action: 'hide', sessionCode: previousCode }).catch(() => {});
        }
        if (typeof window.electronAPI.broadcastMicroExercise === 'function') {
          window.electronAPI.broadcastMicroExercise({ action: 'hide_exercise', sessionCode: previousCode }).catch(() => {});
        }
      } catch (_) {}
    }

    state.roomCode = generateRoomCode();
    roomCodeDisplay.textContent = state.roomCode;
    state.studentConnected = false;
    if (studentConnectionPill) {
      studentConnectionPill.textContent = 'Estudiante Desconectado';
      studentConnectionPill.className = 'connection-pill disconnected';
    }
    console.log('[UI] Nuevo código de sala generado tras finalizar sesión previa:', state.roomCode);
  } else {
    // Reutilizar la sala existente en espera generada al abrir la aplicación
    roomCodeDisplay.textContent = state.roomCode;
    console.log('[UI] Reutilizando código de sala inicial en espera (código sin cambios):', state.roomCode);
  }

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
        sessionCode: state.roomCode,
        studentName: state.currentStudent?.name || 'Estudiante',
        studentLevel: state.targetLevel || state.currentStudent?.default_level || 'B1',
        durationMinutes: state.durationMinutes
      });
      console.log('[Renderer] Sesión Realtime confirmada en Supabase para:', state.roomCode);
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

  // Habilitar botón de exportación de reporte y botón de re-análisis
  if (btnExportReport) btnExportReport.disabled = false;
  if (btnReanalyze) btnReanalyze.disabled = false;

  // 1. Desplegar transcripción verbatim en el panel izquierdo
  if (summary.cleanDialogueTurns && summary.cleanDialogueTurns.length > 0) {
    transcriptFeed.innerHTML = '';
    summary.cleanDialogueTurns.forEach(turn => {
      addTranscriptTurn(turn.speaker || 'Participante', turn.text || '');
    });
  }

  // Extraer texto del estudiante y contexto del profesor
  let studentUtterance = (summary.verbatimStudentSpeech || '').trim();
  let teacherContext = '';
  if (summary.cleanDialogueTurns && summary.cleanDialogueTurns.length > 0) {
    summary.cleanDialogueTurns.forEach(turn => {
      const sp = (turn.speaker || '').toLowerCase();
      if (sp.includes('estudiante') || sp.includes('alumno')) {
        if (!studentUtterance) {
          studentUtterance = (studentUtterance + ' ' + (turn.text || '')).trim();
        }
      } else if (sp.includes('profesor') || sp.includes('docente')) {
        teacherContext = (teacherContext + ' ' + (turn.text || '')).trim();
      }
    });
  }

  // 2. Si la evaluación requiere confirmación de nivel antes de llamar a Gemini:
  if (summary.needsLevelConfirmation || !summary.feedbackCards || summary.feedbackCards.length === 0) {
    if (studentUtterance) {
      transcriptStatus.textContent = 'Transcripción lista. Confirma el nivel para analizar.';
      console.log('[Renderer] Transcripción acumulada lista. Abriendo modal de confirmación de nivel...');
      openConfirmLevelModal({ studentUtterance, teacherContext });
    } else {
      transcriptStatus.textContent = 'Finalizada (Sin voz detectable)';
    }
    return;
  }

  // 3. Limpiar tarjetas anteriores y reiniciar contadores (en caso de evaluación inmediata directa)
  tabPanes.forEach(pane => (pane.innerHTML = ''));
  state.activeGuidedCardId = null;
  state.revealedGuidedCardId = null;
  state.activeExerciseCardId = null;
  state.currentExercise = null;
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
    const contrastiveCapsule = card.contrastiveCapsule || null;

    addSurgicalCard({
      category,
      severity,
      teacherContext,
      studentResponse,
      surgicalCorrection,
      explanation,
      ieltsCriterion,
      contrastiveCapsule
    });
  });

  // 4. Renderizar discurso modelo reformulado si está presente
  if (summary.modelSpeech) {
    state.currentModelSpeech = summary.modelSpeech;
    renderModelSpeechTab(summary.modelSpeech);
  }

  // 5. Guardar sesión y tarjetas en SQLite local (en segundo plano y sin bloquear la UI)
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Exporta y descarga un reporte pedagógico independiente en formato HTML
 * con la transcripción verbatim y las tarjetas agrupadas por las 5 categorías.
 */
function exportSessionReportHTML() {
  const studentName = state.currentStudent?.name || 'Student';
  const studentLevel = state.currentStudent?.default_level || 'B1';
  const roomCode = state.roomCode || state.sessionCode || (roomCodeDisplay ? roomCodeDisplay.textContent.trim() : 'EFL-XXX');
  const dateStr = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  // Recopilar intervenciones de transcripción
  const turnElements = document.querySelectorAll('#transcript-feed .transcript-turn');
  let transcriptHtml = '';
  if (turnElements.length === 0) {
    transcriptHtml = '<p style="color: #6e7681; font-style: italic;">No transcript recorded for this session.</p>';
  } else {
    turnElements.forEach(el => {
      const isTeacher = el.classList.contains('turn-teacher');
      const speaker = isTeacher ? 'Teacher' : 'Student';
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
        <span style="font-size: 1.1rem;">&#9998;</span> Teacher's Pedagogical Notes
      </h3>
      <div style="color: #f0f6fc; font-size: 0.95rem; line-height: 1.6;">${formattedObs}</div>
    </div>`;
  }

  // Recopilar tarjetas por cada una de las 5 pestañas maestras
  const categories = [
    { id: 'grammar', title: '1. Grammar & Syntax (Zero Tolerance)', color: '#388bfd' },
    { id: 'vocabulary', title: '2. Vocabulary & Collocations', color: '#8957e5' },
    { id: 'pronunciation', title: '3. Pronunciation & Phonetics', color: '#da3633' },
    { id: 'upgrade_c1', title: '4. C1 Upgrade (Discourse Sophistication)', color: '#d29922' },
    { id: 'fluency', title: '5. Fluency & Cohesion', color: '#238636' }
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
          <span style="background: ${cat.color}22; color: ${cat.color}; font-weight: 700; padding: 2px 10px; border-radius: 12px; font-size: 0.8rem; border: 1px solid ${cat.color}44;">${cards.length} observation${cards.length === 1 ? '' : 's'}</span>
        </div>`;

    if (cards.length === 0) {
      cardsHtml += `<p style="color: #6e7681; font-size: 0.88rem; font-style: italic; margin-left: 8px;">No observations recorded in this category.</p></section>`;
    } else {
      cards.forEach(card => {
        const context = card.querySelector('.card-context-text')?.textContent || '';
        const studentResp = card.querySelector('.student-utterance')?.innerHTML || '';
        const fix = card.querySelector('.surgical-solution')?.innerHTML || '';
        const explanation = card.querySelector('.card-explanation')?.innerHTML || '';
        const ieltsDesc = card.querySelector('.card-ielts-footer')?.textContent?.trim() || '';

        let capsuleHtml = '';
        if (card.dataset.contrastiveCapsule) {
          try {
            const cap = JSON.parse(card.dataset.contrastiveCapsule);
            if (cap && cap.poleA && cap.poleB) {
              capsuleHtml = `
                <div style="margin-top: 10px; margin-bottom: 10px; background: rgba(13, 17, 23, 0.7); border: 1px solid #30363d; border-radius: 6px; padding: 10px 12px;">
                  <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #c084fc; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    <span>⚖️</span>
                    <span>Contrastive Focus (A vs B)</span>
                  </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div style="background: #161b22; border-radius: 6px; padding: 8px 10px; border: 1px solid #30363d; border-left: 3px solid #d29922; font-size: 0.82rem;">
                      <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #f0f6fc; margin-bottom: 4px;">
                        <span style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 3px; background: rgba(210, 153, 34, 0.2); color: #e3b341;">Form A</span>
                        <strong>${escapeHtml(cap.poleA.label || '')}</strong>
                      </div>
                      <div style="font-size: 0.8rem; color: #c9d1d9; line-height: 1.4;">${escapeHtml(cap.poleA.rule || '')}</div>
                      ${cap.poleA.example ? `<div style="font-size: 0.78rem; color: #8b949e; font-style: italic; margin-top: 2px;">"${escapeHtml(cap.poleA.example)}"</div>` : ''}
                    </div>
                    <div style="background: #161b22; border-radius: 6px; padding: 8px 10px; border: 1px solid #30363d; border-left: 3px solid #3fb950; font-size: 0.82rem;">
                      <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #f0f6fc; margin-bottom: 4px;">
                        <span style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 3px; background: rgba(63, 185, 80, 0.2); color: #56d364;">Form B</span>
                        <strong>${escapeHtml(cap.poleB.label || '')}</strong>
                      </div>
                      <div style="font-size: 0.8rem; color: #c9d1d9; line-height: 1.4;">${escapeHtml(cap.poleB.rule || '')}</div>
                      ${cap.poleB.example ? `<div style="font-size: 0.78rem; color: #8b949e; font-style: italic; margin-top: 2px;">"${escapeHtml(cap.poleB.example)}"</div>` : ''}
                    </div>
                  </div>
                </div>`;
            }
          } catch (e) {
            console.warn('[Report] Error parsing contrastive capsule:', e);
          }
        }

        cardsHtml += `
          <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px;">
            ${context ? `<div style="font-size: 0.8rem; color: #8b949e; margin-bottom: 8px;"><strong>Teacher Context:</strong> <span style="font-style: italic;">"${context}"</span></div>` : ''}
            <div style="margin-bottom: 8px; line-height: 1.5;"><strong style="color: #f85149; font-size: 0.85rem; text-transform: uppercase;">Student Response:</strong> <div style="color: #f0f6fc; margin-top: 2px;">${studentResp}</div></div>
            ${capsuleHtml}
            <div class="review-target-answer" style="margin-top: 8px; margin-bottom: 8px; line-height: 1.5;">
              <strong style="color: #3fb950; font-size: 0.85rem; text-transform: uppercase;">Surgical Correction:</strong>
              <div style="color: #f0f6fc; margin-top: 2px;">${fix}</div>
              ${explanation ? `<div style="background: #0d1117; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; color: #c9d1d9; margin-top: 8px; margin-bottom: 8px; border-left: 3px solid #8957e5;">${explanation}</div>` : ''}
            </div>
            ${ieltsDesc ? `<div style="font-size: 0.78rem; color: #d29922; font-weight: 600; margin-top: 8px; padding-top: 6px; border-top: 1px solid #21262d;">${ieltsDesc}</div>` : ''}
          </div>`;
      });
      cardsHtml += `</section>`;
    }
  });

  // Sección de Práctica Interactiva Realizada en Sesión (si hubo ejercicios)
  let exercisesHtml = '';
  if (state.sessionExercises && state.sessionExercises.length > 0) {
    const FORMAT_TITLES = {
      multiple_choice: 'Multiple Choice',
      spot_the_error: 'Spot the Error',
      key_word_transformation: 'Key Word Transformation (C1)',
      error_correction_input: 'Sentence Correction',
      sentence_unscramble: 'Unscramble Sentence',
      open_cloze: 'Open Cloze'
    };

    const CAT_LABELS = {
      grammar: 'Grammar',
      vocabulary: 'Vocabulary',
      pronunciation: 'Pronunciation',
      upgrade_c1: 'C1 Upgrade',
      fluency: 'Fluency'
    };

    let itemsHtml = '';
    state.sessionExercises.forEach((ex, idx) => {
      const typeLabel = FORMAT_TITLES[ex.type] || ex.type;
      const catLabel = CAT_LABELS[ex.category] || ex.category || 'Practice';
      const isContrast = ex.contrastPolarity === 'contrast';
      const targetPole = ex.targetPole || (isContrast ? 'A' : 'B');
      const polarityBadge = isContrast
        ? `<span style="background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px;">⚖️ Contrast (Form ${targetPole})</span>`
        : `<span style="background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px;">🎯 Target (Form ${targetPole})</span>`;

      let studentStatusBadge = '<span style="background: rgba(110, 118, 129, 0.2); color: #8b949e; border: 1px solid #30363d; font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 9999px;">⏳ Not answered</span>';
      if (ex.isCorrect === true) {
        studentStatusBadge = '<span style="background: rgba(46, 160, 67, 0.2); color: #3fb950; border: 1px solid rgba(46, 160, 67, 0.4); font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px;">✓ Correct</span>';
      } else if (ex.isCorrect === false) {
        studentStatusBadge = '<span style="background: rgba(248, 81, 73, 0.2); color: #f85149; border: 1px solid rgba(248, 81, 73, 0.4); font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px;">✗ Needs practice</span>';
      }

      let exerciseBodyHtml = '';
      let solutionHtml = '';

      if (ex.type === 'spot_the_error') {
        const segs = (ex.segments || []).map((s, sIdx) => `<span style="display: inline-block; margin: 2px 4px; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; font-size: 0.88rem;"><strong>[${sIdx + 1}]</strong> ${escapeHtml(s)}</span>`).join(' ');
        exerciseBodyHtml = `<div style="margin: 8px 0;">${segs}</div>`;
        solutionHtml = `Error segment: <strong>[${(ex.errorSegmentIndex || 0) + 1}]</strong> &rarr; Target correction: <strong style="color: #3fb950;">${escapeHtml(ex.correctedSegment || '')}</strong>`;
      } else if (ex.type === 'key_word_transformation') {
        exerciseBodyHtml = `
          <div style="font-style: italic; color: #8b949e; margin-bottom: 4px;">"${escapeHtml(ex.baseSentence || '')}"</div>
          <div style="margin-bottom: 6px;"><span style="background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: 800; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(168, 85, 247, 0.4); font-size: 0.85rem;">${escapeHtml(ex.keyWord || '')}</span> <span style="color: #f0f6fc; margin-left: 6px;">${(escapeHtml(ex.targetSentenceTemplate || '')).replace('___', '<strong style="color: #c084fc; border-bottom: 2px dashed #c084fc;">___</strong>')}</span></div>`;
        solutionHtml = `Model transformation: <strong style="color: #3fb950;">${escapeHtml(ex.idealAnswer || '')}</strong>`;
      } else if (ex.type === 'error_correction_input') {
        exerciseBodyHtml = `<div style="font-style: italic; color: #f0f6fc; margin: 6px 0;">"${escapeHtml(ex.faultySentence || '')}"</div>`;
        solutionHtml = `Target correction: <strong style="color: #3fb950;">${escapeHtml(ex.idealAnswer || '')}</strong>`;
      } else if (ex.type === 'sentence_unscramble') {
        const chunks = (ex.shuffledChunks || []).map(c => `<span style="display: inline-block; margin: 2px 4px; padding: 3px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; font-size: 0.84rem; color: #c084fc;">${escapeHtml(c)}</span>`).join(' ');
        exerciseBodyHtml = `<div style="margin: 6px 0;">${chunks}</div>`;
        solutionHtml = `Target sentence: <strong style="color: #3fb950;">${escapeHtml(ex.correctSentence || '')}</strong>`;
      } else if (ex.type === 'open_cloze') {
        exerciseBodyHtml = `<div style="color: #f0f6fc; font-size: 0.95rem; margin: 6px 0;">${(escapeHtml(ex.promptSentence || '')).replace('___', '<strong style="color: #c084fc; border-bottom: 2px dashed #c084fc;">___</strong>')}</div>`;
        solutionHtml = `Target word: <strong style="color: #3fb950;">${escapeHtml(ex.idealAnswer || '')}</strong>`;
      } else { // multiple_choice
        const sentence = (escapeHtml(ex.promptSentence || '')).replace('___', '<strong style="color: #c084fc; border-bottom: 2px dashed #c084fc;">___</strong>');
        const opts = (ex.options || []).map((o, oIdx) => `<span style="display: inline-block; margin: 2px 6px; padding: 3px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; font-size: 0.84rem; color: #c9d1d9;">${String.fromCharCode(65 + oIdx)}) ${escapeHtml(o)}</span>`).join(' ');
        exerciseBodyHtml = `<div style="color: #f0f6fc; font-size: 0.95rem; margin: 6px 0;">${sentence}</div><div style="margin-top: 4px;">${opts}</div>`;
        solutionHtml = `Target option: <strong style="color: #3fb950;">${ex.options && typeof ex.correctIndex === 'number' ? escapeHtml(ex.options[ex.correctIndex]) : ''}</strong>`;
      }

      itemsHtml += `
        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid #21262d; padding-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 700; color: #c084fc; font-size: 0.82rem; text-transform: uppercase;">#${idx + 1} ${typeLabel}</span>
              ${polarityBadge}
              <span style="font-size: 0.72rem; color: #8b949e; background: #0d1117; padding: 2px 6px; border-radius: 4px; border: 1px solid #30363d;">${catLabel}</span>
            </div>
            ${studentStatusBadge}
          </div>

          <div style="font-size: 0.82rem; color: #8b949e; font-style: italic; margin-bottom: 6px;">${escapeHtml(ex.instruction || '')}</div>
          ${exerciseBodyHtml}

          ${ex.studentAnswer ? `
          <div class="review-target-answer" style="margin-top: 10px; font-size: 0.85rem; color: #c9d1d9;">
            <strong style="color: #8b949e; text-transform: uppercase; font-size: 0.75rem;">Student Response:</strong> 
            <span style="font-weight: 600; color: ${ex.isCorrect ? '#3fb950' : '#f85149'};">"${escapeHtml(ex.studentAnswer)}"</span>
          </div>` : ''}

          <div class="review-target-answer" style="margin-top: 10px; background: rgba(16, 185, 129, 0.08); border-left: 3px solid #238636; padding: 10px 14px; border-radius: 4px;">
            <div style="font-size: 0.88rem; color: #e6edf3;">${solutionHtml}</div>
            ${ex.feedbackExplanation ? `<div style="font-size: 0.8rem; color: #8b949e; margin-top: 4px;">${escapeHtml(ex.feedbackExplanation)}</div>` : ''}
          </div>
        </div>`;
    });

    exercisesHtml = `
      <h2 style="color: #f0f6fc; border-bottom: 2px solid #a855f7; padding-bottom: 8px; margin-top: 36px; font-size: 1.25rem; display: flex; align-items: center; justify-content: space-between;">
        <span>Interactive Practice Conducted in Session (${state.sessionExercises.length} Exercise${state.sessionExercises.length === 1 ? '' : 's'})</span>
        <span style="font-size: 0.78rem; font-weight: 600; color: #c084fc; background: rgba(168, 85, 247, 0.15); padding: 2px 10px; border-radius: 12px; border: 1px solid rgba(168, 85, 247, 0.3);">AI Micro-Exercises</span>
      </h2>
      ${itemsHtml}`;
  }

  // Sección de Discurso Modelo y Reformulación Completa
  let modelSpeechHtml = '';
  if (state.currentModelSpeech) {
    const ms = state.currentModelSpeech;
    const bullets = (ms.keyImprovements || []).map(b => `
      <li style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; font-size: 0.88rem; color: #c9d1d9;">
        <span style="color: #58a6ff; font-weight: bold; margin-top: 1px;">✓</span>
        <span>${escapeHtml(b)}</span>
      </li>
    `).join('');

    const normReportLevel = (studentLevel || 'B1').toUpperCase().trim();
    let iPlusOneReportLabel = 'B1+/B2';
    if (normReportLevel === 'A1' || normReportLevel === 'A2') iPlusOneReportLabel = 'B1 Upgrade (i+1)';
    else if (normReportLevel === 'B1') iPlusOneReportLabel = 'B1+/B2 Upgrade (i+1)';
    else if (normReportLevel === 'B2') iPlusOneReportLabel = 'B2+/C1 Upgrade (i+1)';
    else if (normReportLevel === 'C1' || normReportLevel === 'C2') iPlusOneReportLabel = 'C1/C2 Native Mastery (i+1)';

    modelSpeechHtml = `
      <h2 style="color: #f0f6fc; border-bottom: 2px solid #a855f7; padding-bottom: 8px; margin-top: 36px; font-size: 1.25rem; display: flex; align-items: center; justify-content: space-between;">
        <span>Complete Speech Reformulation (Model Discourse)</span>
        <span style="font-size: 0.78rem; font-weight: 600; color: #c084fc; background: rgba(168, 85, 247, 0.15); padding: 2px 10px; border-radius: 12px; border: 1px solid rgba(168, 85, 247, 0.3);">Confirmed Level: ${escapeHtml(normReportLevel)} (i+1 Escalation)</span>
      </h2>

      <div style="background: #161b22; border: 1px solid #30363d; border-left: 4px solid #3fb950; border-radius: 8px; padding: 16px; margin-bottom: 14px;">
        <div style="font-size: 0.75rem; font-weight: 700; color: #3fb950; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Natural Corrected Version (${escapeHtml(normReportLevel)} Accurate & Fluent)</div>
        <div style="font-size: 0.95rem; line-height: 1.6; color: #f0f6fc;">${escapeHtml(ms.naturalCorrected || '')}</div>
      </div>

      <div style="background: #161b22; border: 1px solid #30363d; border-left: 4px solid #a855f7; border-radius: 8px; padding: 16px; margin-bottom: 14px;">
        <div style="font-size: 0.75rem; font-weight: 700; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Target Level Version (${escapeHtml(iPlusOneReportLabel)})</div>
        <div style="font-size: 0.95rem; line-height: 1.6; color: #f0f6fc;">${escapeHtml(ms.targetUpgrade || '')}</div>
      </div>

      ${bullets ? `
      <div style="background: rgba(88, 166, 255, 0.06); border: 1px solid rgba(88, 166, 255, 0.25); border-radius: 8px; padding: 14px 18px; margin-bottom: 20px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: #58a6ff; margin-bottom: 8px;">Key Pedagogical Improvements:</div>
        <ul style="list-style: none; padding: 0; margin: 0;">${bullets}</ul>
      </div>
      ` : ''}
    `;
  }

  const fullReportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EFL / IELTS Oral Assessment Report - ${escapeHtml(studentName)} (${escapeHtml(roomCode)})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0d1117; color: #f0f6fc; margin: 0; padding: 32px; }
    .report-wrapper { max-width: 900px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 36px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
    h1 { color: #f0f6fc; margin: 0 0 6px 0; font-size: 1.6rem; font-weight: 700; }
    .header-sub { color: #8b949e; margin: 0 0 20px 0; font-size: 0.95rem; }
    .btn-review-mode {
      background: #238636;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      padding: 9px 18px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-review-mode:hover {
      background: #2ea043;
      transform: translateY(-1px);
    }
    .btn-review-mode.active {
      background: #8957e5;
    }
    .review-notice-banner {
      display: none;
      background: rgba(137, 87, 229, 0.15);
      border: 1px solid rgba(137, 87, 229, 0.4);
      color: #d2a8ff;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 0.88rem;
      margin-bottom: 20px;
      animation: fadeIn 0.2s ease;
    }
    body.review-mode-active .review-notice-banner {
      display: block !important;
    }
    body.review-mode-active .review-target-answer {
      filter: blur(7px);
      user-select: none;
      transition: filter 0.2s ease;
      cursor: pointer;
    }
    body.review-mode-active .review-target-answer:hover {
      filter: blur(0px) !important;
      user-select: auto;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .meta-card { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; background: #0d1117; padding: 16px; border-radius: 8px; border: 1px solid #30363d; margin-bottom: 28px; }
    .meta-field strong { display: block; color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .meta-field span { color: #f0f6fc; font-weight: 600; font-size: 1rem; }
    .highlight-error { color: #f85149; background: rgba(248,81,73,0.15); padding: 2px 6px; border-radius: 4px; text-decoration: line-through; }
    .highlight-fix { color: #3fb950; background: rgba(63,185,80,0.15); padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    @media print {
      body { background: #fff !important; color: #000 !important; padding: 10px !important; }
      .report-wrapper { box-shadow: none !important; border: none !important; padding: 0 !important; max-width: 100% !important; }
      .btn-review-mode, .review-notice-banner { display: none !important; }
      .review-target-answer { filter: none !important; -webkit-filter: none !important; user-select: auto !important; opacity: 1 !important; }
    }
  </style>
</head>
<body>
  <div class="report-wrapper">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div>
        <h1>EFL / IELTS Oral Assessment Pedagogical Report</h1>
        <div class="header-sub">Speaking Assistant &bull; IELTS Band Descriptors Rubric</div>
      </div>
      <button id="toggle-review-mode-btn" class="btn-review-mode" onclick="toggleReviewMode()">
        👁️ Review Mode (Hide Answers)
      </button>
    </div>

    <div id="review-notice-banner" class="review-notice-banner">
      <strong>Review Mode Active:</strong> Solutions and surgical corrections are blurred. Try answering mentally or out loud, then hover over any block to reveal the model answer.
    </div>

    <div class="meta-card">
      <div class="meta-field"><strong>Student</strong><span>${escapeHtml(studentName)}</span></div>
      <div class="meta-field"><strong>Target Level</strong><span>${escapeHtml(studentLevel)}</span></div>
      <div class="meta-field"><strong>Room Code</strong><span style="font-family: monospace; color: #58a6ff;">${escapeHtml(roomCode)}</span></div>
      <div class="meta-field"><strong>Session Date</strong><span>${dateStr}</span></div>
    </div>

    ${observationsHtml}

    <h2 style="color: #f0f6fc; border-bottom: 2px solid #30363d; padding-bottom: 8px; margin-top: 32px; font-size: 1.25rem;">Session Verbatim Transcript</h2>
    ${transcriptHtml}

    <h2 style="color: #f0f6fc; border-bottom: 2px solid #30363d; padding-bottom: 8px; margin-top: 36px; font-size: 1.25rem;">Surgical Feedback (${totalCardsCount} Observations)</h2>
    ${cardsHtml}

    ${exercisesHtml}

    ${modelSpeechHtml}

    <footer style="margin-top: 48px; border-top: 1px solid #30363d; padding-top: 18px; color: #6e7681; font-size: 0.8rem; text-align: center;">
      Automatically generated by Antigravity EFL Speaking Coach &bull; Teacher's Pedagogical Record
    </footer>
  </div>

  <script>
    function toggleReviewMode() {
      const isReview = document.body.classList.toggle('review-mode-active');
      const btn = document.getElementById('toggle-review-mode-btn');
      if (btn) {
        if (isReview) {
          btn.classList.add('active');
          btn.innerHTML = '🔓 Exit Review Mode (Show Answers)';
        } else {
          btn.classList.remove('active');
          btn.innerHTML = '👁️ Review Mode (Hide Answers)';
        }
      }
    }
  </script>
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
        state.studentConnected = true;
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
          transcriptStatus.textContent = `Grabando (bloque #${data.sequence})`;
        }
      });
    }

    if (typeof window.electronAPI.onTranscriptSegment === 'function') {
      window.electronAPI.onTranscriptSegment((data) => {
        handleLiveTranscriptSegment(data);
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
        console.log('[UI] Estudiante desconectado');
        state.studentConnected = false;
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

    if (typeof window.electronAPI.onMicroExerciseAnswer === 'function') {
      window.electronAPI.onMicroExerciseAnswer((data) => {
        handleStudentExerciseAnswer(data);
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
    if (category === 'model_speech') {
      counterEl.textContent = state.currentModelSpeech ? '★' : '0';
      return;
    }
    counterEl.textContent = state.feedbackCounts[category] || 0;
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${category}"]`);
    if (tabBtn && state.feedbackCounts[category] > 0) {
      if (category === 'grammar') tabBtn.classList.add('has-errors');
      if (category === 'upgrade_c1') tabBtn.classList.add('has-items');
    }
  }
}

/**
 * Renderiza la reformulación del discurso completo en la pestaña "Modelo"
 */
function renderModelSpeechTab(modelSpeech) {
  const targetPane = document.getElementById('tab-pane-model_speech');
  if (!targetPane) return;

  targetPane.innerHTML = '';

  if (!modelSpeech) {
    targetPane.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 40px 20px; font-style: italic;">
        No hay discurso modelo disponible aún. Finaliza una sesión o haz clic en "Re-analizar" para generarlo.
      </div>
    `;
    return;
  }

  const normLevel = (state.targetLevel || (state.currentStudent?.default_level) || 'B1').toUpperCase().trim();
  let iPlusOneLabel = 'B1+/B2';
  if (normLevel === 'A1' || normLevel === 'A2') iPlusOneLabel = 'B1 Upgrade (i+1)';
  else if (normLevel === 'B1') iPlusOneLabel = 'B1+/B2 Upgrade (i+1)';
  else if (normLevel === 'B2') iPlusOneLabel = 'B2+/C1 Upgrade (i+1)';
  else if (normLevel === 'C1' || normLevel === 'C2') iPlusOneLabel = 'C1/C2 Native Mastery (i+1)';

  const bullets = (modelSpeech.keyImprovements || []).map(imp => `
    <li>
      <span class="improvement-bullet-dot">✓</span>
      <span>${escapeHtml(imp)}</span>
    </li>
  `).join('');

  const container = document.createElement('div');
  container.className = 'model-speech-container';
  container.innerHTML = `
    <div class="model-speech-top-bar">
      <div class="model-speech-title-group">
        <h3><span>★</span> Discurso Modelo & Reformulación Completa</h3>
        <span class="model-speech-subtitle">Reescritura calibrada a CEFR ${normLevel} & Escalón superior (${iPlusOneLabel})</span>
      </div>
      <button type="button" id="btn-project-model-speech" class="btn-project-model ${state.isModelSpeechProjected ? 'active' : ''}" title="Proyectar esta reformulación completa en la pantalla del alumno">
        <span class="guided-dot"></span>
        <span class="btn-text">${state.isModelSpeechProjected ? 'Ocultar Discurso' : 'Proyectar Discurso'}</span>
      </button>
    </div>

    <!-- 1. Versión Corregida Natural -->
    <div class="model-speech-card card-corrected">
      <div class="model-card-header">
        <span class="model-card-badge badge-corrected">Versión Corregida (${normLevel} Natural & Precisa)</span>
        <span style="font-size: 0.72rem; color: #8b949e;">Mantiene nivel e ideas del alumno</span>
      </div>
      <div class="model-card-text">${escapeHtml(modelSpeech.naturalCorrected || '')}</div>
    </div>

    <!-- 2. Versión Nivel Objetivo (Upgrade i+1) -->
    <div class="model-speech-card card-upgrade">
      <div class="model-card-header">
        <span class="model-card-badge badge-upgrade">Versión Escalón Superior (${iPlusOneLabel})</span>
        <span style="font-size: 0.72rem; color: #c084fc; font-weight: 600;">Calibración estricta i+1</span>
      </div>
      <div class="model-card-text">${escapeHtml(modelSpeech.targetUpgrade || '')}</div>
    </div>

    <!-- 3. Mejoras Clave -->
    <div class="model-improvements-card">
      <h4 class="improvements-title"><span>✦</span> 3 Mejoras Clave Realizadas:</h4>
      <ul class="improvements-list">
        ${bullets || '<li><span>Mejoras pedagógicas aplicadas a gramática y colocaciones.</span></li>'}
      </ul>
    </div>
  `;

  const btnProject = container.querySelector('#btn-project-model-speech');
  if (btnProject) {
    btnProject.addEventListener('click', async () => {
      const willProject = !state.isModelSpeechProjected;
      state.isModelSpeechProjected = willProject;

      if (willProject) {
        btnProject.classList.add('active');
        btnProject.querySelector('.btn-text').textContent = 'Ocultar Discurso';
      } else {
        btnProject.classList.remove('active');
        btnProject.querySelector('.btn-text').textContent = 'Proyectar Discurso';
      }

      if (window.electronAPI && typeof window.electronAPI.broadcastModelSpeech === 'function') {
        try {
          await window.electronAPI.broadcastModelSpeech({
            action: willProject ? 'show_model_speech' : 'hide',
            sessionCode: state.sessionCode,
            modelSpeech: willProject ? modelSpeech : null
          });
        } catch (err) {
          console.warn('[ModelSpeech] Error al emitir broadcastModelSpeech:', err.message);
        }
      }
    });
  }

  targetPane.appendChild(container);
  updateBadgeCounter('model_speech');
}

// ==============================================================================
// 5. INSERCIÓN DE TRANSCRIPCIÓN CONTINUA Y TARJETAS QUIRÚRGICAS
// ==============================================================================

/**
 * Despliega y actualiza en tiempo real la transcripción acumulada que llega de Gemini
 */
function handleLiveTranscriptSegment(data) {
  if (!data) return;
  if (transcriptEmptyState) transcriptEmptyState.classList.add('hidden');
  if (transcriptStatus && state.isSessionActive) {
    transcriptStatus.textContent = 'Transcribiendo en vivo...';
  }

  if (data.fullTranscript && data.fullTranscript.trim().length > 0) {
    state.sessionTranscript = data.fullTranscript.trim();
  } else if (data.segmentText && data.segmentText.trim().length > 0) {
    state.sessionTranscript = (state.sessionTranscript ? `${state.sessionTranscript.trim()} ${data.segmentText.trim()}` : data.segmentText.trim());
  }

  let liveTurnEl = document.getElementById('live-student-turn');
  if (!liveTurnEl) {
    liveTurnEl = document.createElement('div');
    liveTurnEl.id = 'live-student-turn';
    liveTurnEl.className = 'transcript-turn turn-student';
    liveTurnEl.innerHTML = `
      <div class="turn-header">
        <span class="speaker-badge">Estudiante</span>
        <span class="live-dot" style="display: inline-block; margin-left: 8px; vertical-align: middle;" title="Transcripción en vivo"></span>
      </div>
      <div class="turn-content" id="live-student-turn-content"></div>
    `;
    transcriptFeed.appendChild(liveTurnEl);
  }

  const contentEl = document.getElementById('live-student-turn-content');
  if (contentEl) {
    contentEl.textContent = state.sessionTranscript;
  }

  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

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
  const contrastiveCapsule = item.contrastiveCapsule || null;
  const hasContrastiveCapsule = Boolean(
    contrastiveCapsule &&
    contrastiveCapsule.poleA &&
    contrastiveCapsule.poleB &&
    contrastiveCapsule.poleA.label &&
    contrastiveCapsule.poleB.label
  );

  const targetPane = document.getElementById(`tab-pane-${category}`);
  if (!targetPane) return;

  const cardId = item.id ? String(item.id) : `card_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const cleanContext = (teacherContext || '').trim();
  const hasTeacherContext = Boolean(cleanContext && cleanContext !== 'Pregunta o contexto oral' && !cleanContext.toLowerCase().includes('tell me about your experience') && cleanContext !== 'Speaking turn');

  const card = document.createElement('article');
  card.className = 'surgical-card';
  card.dataset.cardId = cardId;
  if (hasContrastiveCapsule) {
    card.dataset.contrastiveCapsule = JSON.stringify(contrastiveCapsule);
  }

  let capsuleHtml = '';
  if (hasContrastiveCapsule) {
    capsuleHtml = `
      <div class="card-contrastive-capsule">
        <div class="capsule-title">
          <span>⚖️</span>
          <span>Contrastive Focus (A vs B)</span>
        </div>
        <div class="capsule-grid">
          <div class="capsule-col pole-a">
            <div class="pole-title">
              <span class="pole-pill">Form A</span>
              <strong>${escapeHtml(contrastiveCapsule.poleA.label)}</strong>
            </div>
            <div class="pole-rule">${escapeHtml(contrastiveCapsule.poleA.rule || '')}</div>
            ${contrastiveCapsule.poleA.example ? `<div class="pole-ex">"${escapeHtml(contrastiveCapsule.poleA.example)}"</div>` : ''}
          </div>
          <div class="capsule-col pole-b">
            <div class="pole-title">
              <span class="pole-pill target">Form B</span>
              <strong>${escapeHtml(contrastiveCapsule.poleB.label)}</strong>
            </div>
            <div class="pole-rule">${escapeHtml(contrastiveCapsule.poleB.rule || '')}</div>
            ${contrastiveCapsule.poleB.example ? `<div class="pole-ex">"${escapeHtml(contrastiveCapsule.poleB.example)}"</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    ${hasTeacherContext ? `
    <header class="card-context-header">
      <span class="context-tag">Contexto Docente</span>
      <span class="card-context-text">"${cleanContext}"</span>
    </header>
    ` : ''}

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

      ${capsuleHtml}
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

    <div class="card-guided-actions">
      <button type="button" class="btn-guided btn-guided-broadcast" title="Proyectar esta frase en la pantalla del alumno para autocorrección">
        <span class="guided-dot"></span>
        <span class="btn-text">Mostrar al Alumno</span>
      </button>
      <button type="button" class="btn-guided btn-guided-reveal" disabled title="Revelar la solución al alumno en su pantalla">
        <span class="btn-text">Revelar Respuesta</span>
      </button>
      <div class="exercise-control-group">
        <select class="exercise-type-select" title="Formato del ejercicio">
          <option value="auto">Auto (Rotación IA)</option>
          <option value="multiple_choice">Opción Múltiple</option>
          <option value="spot_the_error">Detectar Error</option>
          <option value="key_word_transformation">Transformar C1</option>
          <option value="error_correction_input">Corregir Frase</option>
          <option value="sentence_unscramble">Ordenar Frase</option>
          <option value="open_cloze">Open Cloze</option>
        </select>
        <button type="button" class="btn-guided btn-guided-exercise" title="Generar un micro-ejercicio interactivo con IA sobre esta regla">
          <span class="btn-text">⚡ Ejercicio IA</span>
        </button>
        <button type="button" class="btn-guided btn-guided-refresh hidden" title="Generar otra variante sobre esta misma regla">
          <span class="btn-text">↻ Otro</span>
        </button>
      </div>
    </div>

    <!-- Mini vista previa del Micro-Ejercicio en vivo -->
    <div class="card-exercise-panel hidden" data-exercise-id="">
      <div class="exercise-panel-top">
        <div class="exercise-panel-top-left">
          <span class="exercise-live-badge">⚡ Micro-Ejercicio en Vivo</span>
          <span class="exercise-polarity-badge"></span>
        </div>
        <span class="exercise-panel-instruction"></span>
      </div>
      <p class="exercise-panel-sentence"></p>
      <div class="exercise-panel-options"></div>
      <div class="exercise-status-bar status-waiting">
        <span class="status-dot"></span>
        <span class="status-label">Esperando respuesta del alumno...</span>
      </div>
    </div>
  `;

  // Controladores de eventos para Autocorrección Guiada y Micro-Ejercicio
  const btnBroadcast = card.querySelector('.btn-guided-broadcast');
  const btnReveal = card.querySelector('.btn-guided-reveal');
  const btnExercise = card.querySelector('.btn-guided-exercise');
  const btnRefresh = card.querySelector('.btn-guided-refresh');
  const typeSelect = card.querySelector('.exercise-type-select');

  card.dataset.exerciseAttempt = '0';
  card.dataset.lastExerciseType = '';
  if (typeSelect) {
    card.dataset.selectedExerciseType = typeSelect.value || 'auto';
  }

  // Función auxiliar para calcular rotación intercalada de tipo y polaridad
  const getNextExerciseParams = () => {
    const rawVal = card.dataset.selectedExerciseType || (typeSelect ? typeSelect.value : 'auto');
    const attemptIndex = parseInt(card.dataset.exerciseAttempt || '0', 10);
    const contrastPolarity = (attemptIndex % 2 === 0) ? 'target' : 'contrast';
    const lastType = card.dataset.lastExerciseType || '';

    let chosenType = rawVal !== 'auto' ? rawVal : null;
    if (!chosenType || chosenType === 'auto') {
      const normLevel = (state.targetLevel || 'B1').toUpperCase().trim();
      const isHighLevel = ['B2', 'C1', 'C2'].includes(normLevel);
      const isUpgrade = (category || '').toLowerCase().includes('upgrade') || (category || '').toLowerCase() === 'c1';

      const highPool = ['key_word_transformation', 'open_cloze', 'error_correction_input', 'spot_the_error', 'sentence_unscramble', 'multiple_choice'];
      const basePool = ['multiple_choice', 'sentence_unscramble', 'spot_the_error', 'open_cloze', 'error_correction_input'];
      const pool = (isUpgrade || isHighLevel) ? highPool : basePool;

      // Filtrar para que NUNCA repita el formato inmediatamente anterior
      const candidatePool = pool.filter(t => t !== lastType);
      const activePool = candidatePool.length > 0 ? candidatePool : pool;
      chosenType = activePool[attemptIndex % activePool.length];
    }

    card.dataset.exerciseAttempt = String(attemptIndex + 1);
    card.dataset.lastExerciseType = chosenType;

    return { chosenType, contrastPolarity, attemptIndex };
  };

  btnBroadcast.addEventListener('click', async () => {
    await handleToggleBroadcastCard({
      card,
      cardId,
      category,
      teacherContext: hasTeacherContext ? cleanContext : '',
      studentQuote: studentResponse
    });
  });

  btnReveal.addEventListener('click', async () => {
    await handleRevealAnswerCard({
      card,
      cardId,
      surgicalCorrection,
      explanation
    });
  });

  btnExercise.addEventListener('click', async () => {
    const { chosenType, contrastPolarity, attemptIndex } = getNextExerciseParams();
    await handleToggleExerciseCard({
      card,
      cardId,
      category,
      studentQuote: studentResponse,
      surgicalCorrection,
      explanation,
      preferredType: chosenType,
      contrastPolarity,
      attemptIndex,
      isRefresh: false
    });
  });

  btnRefresh.addEventListener('click', async () => {
    const { chosenType, contrastPolarity, attemptIndex } = getNextExerciseParams();
    await handleToggleExerciseCard({
      card,
      cardId,
      category,
      studentQuote: studentResponse,
      surgicalCorrection,
      explanation,
      preferredType: chosenType,
      contrastPolarity,
      attemptIndex,
      isRefresh: true
    });
  });

  if (typeSelect) {
    typeSelect.addEventListener('change', async () => {
      card.dataset.selectedExerciseType = typeSelect.value;
      // Si la tarjeta ya tiene el ejercicio activo abierto, regenerar y emitir de inmediato
      if (state.activeExerciseCardId === cardId) {
        const { chosenType, contrastPolarity, attemptIndex } = getNextExerciseParams();
        await handleToggleExerciseCard({
          card,
          cardId,
          category,
          studentQuote: studentResponse,
          surgicalCorrection,
          explanation,
          preferredType: chosenType,
          contrastPolarity,
          attemptIndex,
          isRefresh: true
        });
      }
    });
  }

  targetPane.appendChild(card);

  // Incrementar contador
  state.feedbackCounts[category] = (state.feedbackCounts[category] || 0) + 1;
  updateBadgeCounter(category);
}

/**
 * Proyecta u oculta la frase del estudiante en la pantalla de student-web
 */
async function handleToggleBroadcastCard({ card, cardId, category, teacherContext, studentQuote }) {
  const isCurrentlyProjected = state.activeGuidedCardId === cardId;

  if (isCurrentlyProjected) {
    // Caso 1: La tarjeta ya estaba proyectada -> Ahora se oculta
    console.log(`[Autocorrección] Ocultando tarjeta proyectada ${cardId}`);
    state.activeGuidedCardId = null;
    state.revealedGuidedCardId = null;

    card.classList.remove('card-projected');
    const btnBroadcast = card.querySelector('.btn-guided-broadcast');
    const btnReveal = card.querySelector('.btn-guided-reveal');
    if (btnBroadcast) {
      btnBroadcast.classList.remove('active');
      btnBroadcast.querySelector('.btn-text').textContent = 'Mostrar al Alumno';
    }
    if (btnReveal) {
      btnReveal.disabled = true;
      btnReveal.classList.remove('revealed');
      btnReveal.querySelector('.btn-text').textContent = 'Revelar Respuesta';
    }

    if (window.electronAPI && typeof window.electronAPI.broadcastGuidedCorrection === 'function') {
      try {
        await window.electronAPI.broadcastGuidedCorrection({
          action: 'hide',
          sessionCode: state.sessionCode,
          cardId
        });
      } catch (err) {
        console.warn('[Autocorrección] Error al emitir hide:', err.message);
      }
    }
  } else {
    // Caso 2: Proyectar esta tarjeta (desactivando cualquier otra proyectada previamente)
    if (state.activeGuidedCardId) {
      const prevCard = document.querySelector(`.surgical-card[data-card-id="${state.activeGuidedCardId}"]`);
      if (prevCard) {
        prevCard.classList.remove('card-projected');
        const prevBroadcast = prevCard.querySelector('.btn-guided-broadcast');
        const prevReveal = prevCard.querySelector('.btn-guided-reveal');
        if (prevBroadcast) {
          prevBroadcast.classList.remove('active');
          prevBroadcast.querySelector('.btn-text').textContent = 'Mostrar al Alumno';
        }
        if (prevReveal) {
          prevReveal.disabled = true;
          prevReveal.classList.remove('revealed');
          prevReveal.querySelector('.btn-text').textContent = 'Revelar Respuesta';
        }
      }
    }

    state.activeGuidedCardId = cardId;
    state.revealedGuidedCardId = null;

    // Actualizar visualmente la nueva tarjeta proyectada
    card.classList.add('card-projected');
    const btnBroadcast = card.querySelector('.btn-guided-broadcast');
    const btnReveal = card.querySelector('.btn-guided-reveal');
    if (btnBroadcast) {
      btnBroadcast.classList.add('active');
      btnBroadcast.querySelector('.btn-text').textContent = 'Ocultar';
    }
    if (btnReveal) {
      btnReveal.disabled = false;
      btnReveal.classList.remove('revealed');
      btnReveal.querySelector('.btn-text').textContent = 'Revelar Respuesta';
    }

    // Enviar evento show_prompt SIN surgicalCorrection ni explanation (incluye contrastiveCapsule oculto)
    if (window.electronAPI && typeof window.electronAPI.broadcastGuidedCorrection === 'function') {
      try {
        const rawCtx = (teacherContext || '').trim();
        const safeCtx = (rawCtx === 'Pregunta o contexto oral' || rawCtx.toLowerCase().includes('tell me about your experience') || rawCtx === 'Speaking turn') ? '' : rawCtx;

        let contrastiveCapsule = null;
        if (card && card.dataset.contrastiveCapsule) {
          try {
            contrastiveCapsule = JSON.parse(card.dataset.contrastiveCapsule);
          } catch (e) {}
        }

        await window.electronAPI.broadcastGuidedCorrection({
          action: 'show_prompt',
          sessionCode: state.sessionCode,
          cardId,
          category,
          teacherContext: safeCtx,
          studentQuote,
          contrastiveCapsule
        });
      } catch (err) {
        console.warn('[Autocorrección] Error al emitir show_prompt:', err.message);
      }
    }
  }
}

/**
 * Revela la corrección y explicación pedagógica en la pantalla del estudiante
 */
async function handleRevealAnswerCard({ card, cardId, surgicalCorrection, explanation }) {
  if (state.activeGuidedCardId !== cardId) return;

  state.revealedGuidedCardId = cardId;
  const btnReveal = card.querySelector('.btn-guided-reveal');
  if (btnReveal) {
    btnReveal.classList.add('revealed');
    btnReveal.querySelector('.btn-text').textContent = 'Revelada ✓';
  }

  if (window.electronAPI && typeof window.electronAPI.broadcastGuidedCorrection === 'function') {
    try {
      let contrastiveCapsule = null;
      if (card && card.dataset.contrastiveCapsule) {
        try {
          contrastiveCapsule = JSON.parse(card.dataset.contrastiveCapsule);
        } catch (e) {}
      }

      await window.electronAPI.broadcastGuidedCorrection({
        action: 'reveal_answer',
        sessionCode: state.sessionCode,
        cardId,
        surgicalCorrection,
        explanation,
        contrastiveCapsule
      });
    } catch (err) {
      console.warn('[Autocorrección] Error al emitir reveal_answer:', err.message);
    }
  }
}

/**
 * Genera y transmite un micro-ejercicio interactivo con IA para esta tarjeta
 */
async function handleToggleExerciseCard({ card, cardId, category, studentQuote, surgicalCorrection, explanation, preferredType = null, contrastPolarity = 'target', attemptIndex = 0, isRefresh = false }) {
  const isCurrentActive = state.activeExerciseCardId === cardId;
  const btnExercise = card.querySelector('.btn-guided-exercise');
  const btnRefresh = card.querySelector('.btn-guided-refresh');
  const panel = card.querySelector('.card-exercise-panel');

  if (isCurrentActive && !isRefresh) {
    // Si ya está activo en esta tarjeta y no es refresco -> Ocultar / cerrar
    console.log(`[Micro-Ejercicio] Ocultando ejercicio de tarjeta ${cardId}`);
    const exerciseId = panel ? panel.dataset.exerciseId : '';
    state.activeExerciseCardId = null;
    state.currentExercise = null;

    if (btnExercise) {
      btnExercise.classList.remove('active');
      btnExercise.querySelector('.btn-text').textContent = '⚡ Ejercicio IA';
    }
    if (btnRefresh) {
      btnRefresh.classList.add('hidden');
    }
    if (panel) {
      panel.classList.add('hidden');
    }

    if (window.electronAPI && typeof window.electronAPI.broadcastMicroExercise === 'function') {
      try {
        await window.electronAPI.broadcastMicroExercise({
          action: 'hide_exercise',
          sessionCode: state.sessionCode,
          exerciseId
        });
      } catch (err) {
        console.warn('[Micro-Ejercicio] Error al emitir hide_exercise:', err.message);
      }
    }
    return;
  }

  // Si había otro ejercicio activo en otra tarjeta y no es esta, ocultarlo primero
  if (state.activeExerciseCardId && state.activeExerciseCardId !== cardId) {
    const prevCard = document.querySelector(`.surgical-card[data-card-id="${state.activeExerciseCardId}"]`);
    if (prevCard) {
      const prevBtn = prevCard.querySelector('.btn-guided-exercise');
      const prevRefresh = prevCard.querySelector('.btn-guided-refresh');
      const prevPanel = prevCard.querySelector('.card-exercise-panel');
      if (prevBtn) {
        prevBtn.classList.remove('active');
        prevBtn.querySelector('.btn-text').textContent = '⚡ Ejercicio IA';
      }
      if (prevRefresh) {
        prevRefresh.classList.add('hidden');
      }
      if (prevPanel) {
        prevPanel.classList.add('hidden');
      }
    }
  }

  // Feedback visual de generación
  if (isRefresh && btnRefresh) {
    btnRefresh.disabled = true;
    btnRefresh.querySelector('.btn-text').textContent = '...';
  } else if (btnExercise) {
    btnExercise.disabled = true;
    btnExercise.querySelector('.btn-text').textContent = 'Generando...';
  }

  try {
    let contrastiveCapsule = null;
    if (card && card.dataset.contrastiveCapsule) {
      try {
        contrastiveCapsule = JSON.parse(card.dataset.contrastiveCapsule);
      } catch (e) {
        console.warn('[Micro-Exercise] Error parsing card dataset contrastiveCapsule:', e);
      }
    }

    let exercise = null;
    const randomSeed = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    if (window.electronAPI && typeof window.electronAPI.generateMicroExercise === 'function') {
      exercise = await window.electronAPI.generateMicroExercise({
        category,
        studentQuote,
        surgicalCorrection,
        explanation,
        contrastiveCapsule,
        targetLevel: state.targetLevel || 'B1',
        preferredType,
        contrastPolarity,
        attemptIndex,
        seed: randomSeed
      });
    }

    if (!exercise || !exercise.exerciseId) {
      throw new Error('No se pudo generar el ejercicio');
    }

    state.activeExerciseCardId = cardId;
    state.currentExercise = exercise;

    // Actualizar botones del docente
    if (btnExercise) {
      btnExercise.disabled = false;
      btnExercise.classList.add('active');
      btnExercise.querySelector('.btn-text').textContent = 'Ocultar Ejercicio';
    }
    if (btnRefresh) {
      btnRefresh.disabled = false;
      btnRefresh.classList.remove('hidden');
      btnRefresh.querySelector('.btn-text').textContent = '↻ Otro';
    }

    // Renderizar panel en la tarjeta del docente según el tipo de ejercicio
    if (panel) {
      panel.dataset.exerciseId = exercise.exerciseId;
      const instructionEl = panel.querySelector('.exercise-panel-instruction');
      if (instructionEl) instructionEl.textContent = exercise.instruction || '';

      const polarityBadge = panel.querySelector('.exercise-polarity-badge');
      if (polarityBadge) {
        const isContrast = exercise.contrastPolarity === 'contrast';
        const targetPole = exercise.targetPole || (isContrast ? 'A' : 'B');
        polarityBadge.className = `exercise-polarity-badge ${isContrast ? 'polarity-contrast' : 'polarity-target'}`;
        polarityBadge.textContent = isContrast ? `⚖️ Contrast (Form ${targetPole})` : `🎯 Target (Form ${targetPole})`;
      }

      const sentenceEl = panel.querySelector('.exercise-panel-sentence');
      const optionsEl = panel.querySelector('.exercise-panel-options');

      if (exercise.type === 'spot_the_error') {
        if (sentenceEl) sentenceEl.innerHTML = '';
        if (optionsEl) {
          optionsEl.innerHTML = `
            <div class="exercise-panel-segments">
              ${(exercise.segments || []).map((seg, idx) => `
                <span class="preview-seg ${idx === exercise.errorSegmentIndex ? 'is-error-seg' : ''}">
                  [${idx + 1}] ${seg}
                </span>
              `).join('')}
            </div>
            <div class="exercise-panel-correction">
              <span class="preview-corr-label">Corrección:</span>
              <span class="preview-corr-val">${exercise.correctedSegment}</span>
            </div>
          `;
        }
      } else if (exercise.type === 'key_word_transformation') {
        if (sentenceEl) sentenceEl.innerHTML = '';
        if (optionsEl) {
          optionsEl.innerHTML = `
            <div class="exercise-panel-transform">
              <p class="preview-base">"${exercise.baseSentence}"</p>
              <div class="preview-kw-row">
                <span class="preview-kw">[${exercise.keyWord}]</span>
                <span class="preview-template">${(exercise.targetSentenceTemplate || '').replace('___', '<strong class="blank-highlight">___</strong>')}</span>
              </div>
              <div class="preview-ideal">
                <span class="preview-corr-label">Respuesta Modelo:</span>
                <span class="preview-corr-val">${exercise.idealAnswer}</span>
              </div>
            </div>
          `;
        }
      } else if (exercise.type === 'error_correction_input') {
        if (sentenceEl) {
          sentenceEl.innerHTML = `<strong>Frase con error:</strong> <em>"${exercise.faultySentence}"</em>`;
        }
        if (optionsEl) {
          optionsEl.innerHTML = `
            <div class="exercise-panel-correction">
              <span class="preview-corr-label">Corrección Esperada:</span>
              <span class="preview-corr-val">${exercise.idealAnswer}</span>
            </div>
          `;
        }
      } else if (exercise.type === 'sentence_unscramble') {
        if (sentenceEl) {
          sentenceEl.innerHTML = `<strong>Oración armada:</strong> <em>${exercise.correctSentence}</em>`;
        }
        if (optionsEl) {
          optionsEl.innerHTML = `
            <div class="exercise-panel-unscramble-preview">
              ${(exercise.shuffledChunks || []).map(chunk => `<span class="preview-unscramble-chip">${chunk}</span>`).join(' ')}
            </div>
          `;
        }
      } else if (exercise.type === 'open_cloze') {
        if (sentenceEl) {
          const sentenceWithHighlight = (exercise.promptSentence || '').replace('___', '<strong class="blank-highlight">___</strong>');
          sentenceEl.innerHTML = sentenceWithHighlight;
        }
        if (optionsEl) {
          optionsEl.innerHTML = `
            <div class="exercise-panel-correction">
              <span class="preview-corr-label">Palabra Clave:</span>
              <span class="preview-corr-val">[ ${exercise.idealAnswer} ]</span>
            </div>
          `;
        }
      } else { // multiple_choice
        if (sentenceEl) {
          const sentenceWithHighlight = (exercise.promptSentence || '').replace('___', '<strong class="blank-highlight">___</strong>');
          sentenceEl.innerHTML = sentenceWithHighlight;
        }
        if (optionsEl) {
          optionsEl.innerHTML = (exercise.options || []).map((opt, idx) => {
            const isCorrect = idx === exercise.correctIndex;
            return `<span class="exercise-panel-opt ${isCorrect ? 'is-correct-key' : ''}">${opt}</span>`;
          }).join('');
        }
      }

      const statusBar = panel.querySelector('.exercise-status-bar');
      if (statusBar) {
        statusBar.className = 'exercise-status-bar status-waiting';
        statusBar.innerHTML = '<span class="status-dot"></span><span class="status-label">Waiting for student response...</span>';
      }

      panel.classList.remove('hidden');
    }

    // Transmitir al alumno vía Supabase Realtime
    if (window.electronAPI && typeof window.electronAPI.broadcastMicroExercise === 'function') {
      await window.electronAPI.broadcastMicroExercise({
        action: 'show_exercise',
        sessionCode: state.sessionCode,
        ...exercise,
        contrastiveCapsule: exercise.contrastiveCapsule || contrastiveCapsule || null
      });
    }

    // Registrar en memoria para el reporte pedagógico de sesión
    if (!state.sessionExercises) state.sessionExercises = [];
    const existingIndex = state.sessionExercises.findIndex(ex => ex.exerciseId === exercise.exerciseId);
    const exerciseRecord = {
      exerciseId: exercise.exerciseId,
      type: exercise.type,
      contrastPolarity: exercise.contrastPolarity || 'target',
      targetPole: exercise.targetPole || (exercise.contrastPolarity === 'contrast' ? 'A' : 'B'),
      contrastiveCapsule: exercise.contrastiveCapsule || contrastiveCapsule || null,
      category: exercise.category || category,
      instruction: exercise.instruction || '',
      promptSentence: exercise.promptSentence || '',
      options: exercise.options || [],
      correctIndex: exercise.correctIndex,
      segments: exercise.segments || [],
      errorSegmentIndex: exercise.errorSegmentIndex,
      correctedSegment: exercise.correctedSegment || '',
      baseSentence: exercise.baseSentence || '',
      keyWord: exercise.keyWord || '',
      targetSentenceTemplate: exercise.targetSentenceTemplate || '',
      faultySentence: exercise.faultySentence || '',
      shuffledChunks: exercise.shuffledChunks || [],
      correctSentence: exercise.correctSentence || '',
      idealAnswer: exercise.idealAnswer || '',
      acceptableVariants: exercise.acceptableVariants || [],
      feedbackExplanation: exercise.feedbackExplanation || '',
      studentAnswer: null,
      isCorrect: null,
      answeredAt: null
    };

    if (existingIndex >= 0) {
      state.sessionExercises[existingIndex] = { ...state.sessionExercises[existingIndex], ...exerciseRecord };
    } else {
      state.sessionExercises.push(exerciseRecord);
    }
  } catch (err) {
    console.error('[Micro-Ejercicio Error]:', err.message);
    if (btnExercise) {
      btnExercise.disabled = false;
      btnExercise.querySelector('.btn-text').textContent = '⚡ Ejercicio IA';
    }
    if (btnRefresh) {
      btnRefresh.disabled = false;
      btnRefresh.querySelector('.btn-text').textContent = '↻ Otro';
    }
  }
}

/**
 * Actualiza el indicador en la tarjeta del docente cuando el estudiante responde
 */
function handleStudentExerciseAnswer(answer) {
  console.log('[Micro-Ejercicio] Respuesta del alumno recibida en UI:', answer);
  if (!answer || !answer.exerciseId) return;

  // Actualizar en el registro de sesión para el reporte pedagógico
  if (state.sessionExercises) {
    const targetEx = state.sessionExercises.find(ex => ex.exerciseId === answer.exerciseId);
    if (targetEx) {
      targetEx.studentAnswer = answer.selectedText || '';
      targetEx.isCorrect = Boolean(answer.isCorrect);
      targetEx.answeredAt = answer.answeredAt || Date.now();
    }
  }

  const panel = document.querySelector(`.card-exercise-panel[data-exercise-id="${answer.exerciseId}"]`);
  if (!panel) return;

  const statusBar = panel.querySelector('.exercise-status-bar');
  if (!statusBar) return;

  if (answer.exerciseType === 'spot_the_error') {
    if (answer.isCorrect) {
      statusBar.className = 'exercise-status-bar status-correct';
      statusBar.innerHTML = `<span>✓ Spot the error correct: <strong>"${escapeHtml(answer.selectedText)}"</strong></span>`;
    } else {
      statusBar.className = 'exercise-status-bar status-wrong';
      const corr = answer.correctText ? ` (Actual error in: <strong>"${escapeHtml(answer.correctText)}"</strong>)` : '';
      statusBar.innerHTML = `<span>✗ Marked segment: <strong>"${escapeHtml(answer.selectedText)}"</strong>${corr}</span>`;
    }
  } else if (answer.exerciseType === 'key_word_transformation') {
    if (answer.isCorrect) {
      statusBar.className = 'exercise-status-bar status-correct';
      statusBar.innerHTML = `<span>✓ Correct transformation: <strong>"${escapeHtml(answer.selectedText)}"</strong></span>`;
    } else {
      statusBar.className = 'exercise-status-bar status-wrong';
      const ideal = answer.correctText ? ` (Target: <strong>"${escapeHtml(answer.correctText)}"</strong>)` : '';
      statusBar.innerHTML = `<span>✗ Submitted: <strong>"${escapeHtml(answer.selectedText)}"</strong>${ideal}</span>`;
    }
  } else if (answer.exerciseType === 'error_correction_input') {
    if (answer.isCorrect) {
      statusBar.className = 'exercise-status-bar status-correct';
      statusBar.innerHTML = `<span>✓ Correct correction: <strong>"${escapeHtml(answer.selectedText)}"</strong></span>`;
    } else {
      statusBar.className = 'exercise-status-bar status-wrong';
      const ideal = answer.correctText ? ` (Target: <strong>"${escapeHtml(answer.correctText)}"</strong>)` : '';
      statusBar.innerHTML = `<span>✗ Submitted: <strong>"${escapeHtml(answer.selectedText)}"</strong>${ideal}</span>`;
    }
  } else if (answer.exerciseType === 'sentence_unscramble') {
    if (answer.isCorrect) {
      statusBar.className = 'exercise-status-bar status-correct';
      statusBar.innerHTML = `<span>✓ Perfect sentence syntax</span>`;
    } else {
      statusBar.className = 'exercise-status-bar status-wrong';
      statusBar.innerHTML = `<span>✗ Incorrect order: <strong>"${escapeHtml(answer.selectedText)}"</strong></span>`;
    }
  } else if (answer.exerciseType === 'open_cloze') {
    if (answer.isCorrect) {
      statusBar.className = 'exercise-status-bar status-correct';
      statusBar.innerHTML = `<span>✓ Target word correct: <strong>"${escapeHtml(answer.selectedText)}"</strong></span>`;
    } else {
      statusBar.className = 'exercise-status-bar status-wrong';
      const correctInfo = answer.correctText ? ` (Target: <strong>"${escapeHtml(answer.correctText)}"</strong>)` : '';
      statusBar.innerHTML = `<span>✗ Submitted: <strong>"${escapeHtml(answer.selectedText)}"</strong>${correctInfo}</span>`;
    }
  } else {
    if (answer.isCorrect) {
      statusBar.className = 'exercise-status-bar status-correct';
      statusBar.innerHTML = `<span>✓ Correct answer: <strong>${escapeHtml(answer.selectedText)}</strong></span>`;
    } else {
      statusBar.className = 'exercise-status-bar status-wrong';
      const correctInfo = answer.correctText ? ` (Target: <strong>${escapeHtml(answer.correctText)}</strong>)` : '';
      statusBar.innerHTML = `<span>✗ Selected: <strong>${escapeHtml(answer.selectedText)}</strong>${correctInfo}</span>`;
    }
  }
}

// ==============================================================================
// 6. DATOS DE DEMOSTRACIÓN (Para verificar el Split View y Rúbricas IELTS)
// ==============================================================================
function loadSampleDemoData() {
  state.isDemoData = true;
  state.hasEvaluatedSession = false;
  if (btnExportReport) btnExportReport.disabled = false;

  // Transcripción Continua de Ejemplo
  addTranscriptTurn('Teacher', 'Could you tell me about a time you had to solve a difficult challenge at work or university?');
  addTranscriptTurn('Student', 'Well, last year I was working on a project with a very tight deadline. My team and I needs to coordinate many tasks, but the client was changing the requirements all the days.');
  addTranscriptTurn('Teacher', 'And what did you do to manage those changing expectations?');
  addTranscriptTurn('Student', 'I organize a meeting to explain them the risks. Actually, if we followed their plan, we will lose a lot of money and time.');

  // 1. Pestaña Gramática (Tolerancia cero a errores básicos)
  addSurgicalCard({
    category: 'grammar',
    severity: 'basic_error',
    teacherContext: 'Could you tell me about a time you had to solve a difficult challenge...',
    studentResponse: 'My team and I <span class="highlight-error">needs</span> to coordinate many tasks.',
    surgicalCorrection: 'My team and I <span class="highlight-fix">needed</span> to coordinate many tasks.',
    explanation: 'Past simple agreement: your narration is about last year, so use past tense ("needed"), not present simple ("needs").',
    ieltsCriterion: 'GRA: Band 5.0 (Basic systemic error in past simple narration)',
    contrastiveCapsule: {
      poleA: {
        label: 'Present simple (needs)',
        rule: 'Use for habits, facts, or situations true right now',
        example: 'Our team needs more time today.'
      },
      poleB: {
        label: 'Past simple (needed)',
        rule: 'Use for completed actions or past events',
        example: 'Last year, our team needed to coordinate many tasks.'
      }
    }
  });

  addSurgicalCard({
    category: 'grammar',
    severity: 'basic_error',
    teacherContext: 'And what did you do to manage those changing expectations?',
    studentResponse: 'If we followed their plan, we <span class="highlight-error">will lose</span> a lot of money.',
    surgicalCorrection: 'If we followed their plan, we <span class="highlight-fix">would lose</span> a lot of money.',
    explanation: 'Second conditional: when the if-clause uses past tense ("followed"), use "would + verb" in the main clause, not "will".',
    ieltsCriterion: 'GRA: Band 5.5 (Inconsistent conditional modal matching)',
    contrastiveCapsule: {
      poleA: {
        label: 'First conditional (will)',
        rule: 'Use for real, likely future situations with "if + present"',
        example: 'If we follow their plan, we will lose money.'
      },
      poleB: {
        label: 'Second conditional (would)',
        rule: 'Use for imaginary or hypothetical situations with "if + past"',
        example: 'If we followed their plan, we would lose money.'
      }
    }
  });

  // 2. Pestaña Vocabulario y Colocaciones
  addSurgicalCard({
    category: 'vocabulary',
    severity: 'refinement',
    teacherContext: '...the client was changing the requirements all the days.',
    studentResponse: 'The client was changing the requirements <span class="highlight-error">all the days</span>.',
    surgicalCorrection: 'The client was changing the requirements <span class="highlight-fix">on a daily basis / constantly</span>.',
    explanation: 'Natural collocation: "all the days" is an unnatural literal translation. In business English, use "on a daily basis" or "every day".',
    ieltsCriterion: 'LR: Band 6.0 (Awareness of collocation and natural phrasing)',
    contrastiveCapsule: {
      poleA: {
        label: 'Literal phrasing (all the days)',
        rule: 'Avoid literal word-by-word translations in English',
        example: 'He changes requirements all the days.'
      },
      poleB: {
        label: 'Natural idiom (on a daily basis)',
        rule: 'Use standard English frequency collocations',
        example: 'He changes requirements on a daily basis.'
      }
    }
  });

  // 3. Pestaña Pronunciación y Fonética
  addSurgicalCard({
    category: 'pronunciation',
    severity: 'basic_error',
    teacherContext: 'Could you tell me about a time you had to solve a difficult challenge...',
    studentResponse: 'Pronunciation of regular past -ed ending in <span class="highlight-error">"coordinate / coordinated"</span>.',
    surgicalCorrection: 'Pronounce the final syllable as <span class="highlight-fix">/kəʊˈɔː.dɪ.neɪ.tɪd/</span> with an extra /ɪd/ syllable.',
    explanation: 'Add an extra syllable /ɪd/ whenever regular verbs end with a /t/ or /d/ sound.',
    ieltsCriterion: 'PR: Band 5.0 - 6.0 (Phonological features of past regular inflections)',
    contrastiveCapsule: null
  });

  // 4. Pestaña Upgrade C1 (Alternativas y Parafraseo)
  addSurgicalCard({
    category: 'upgrade_c1',
    severity: 'upgrade',
    teacherContext: 'And what did you do to manage those changing expectations?',
    studentResponse: 'I organize a meeting to <span class="highlight-error">explain them the risks</span>.',
    surgicalCorrection: '<span class="highlight-fix">I convened a meeting to outline the potential pitfalls</span>.',
    explanation: 'C1 executive register: replace "convened" for "organized", and use "outline potential pitfalls" for precise impact.',
    ieltsCriterion: 'LR: Band 7.5 - 8.0 (Idiomatic, precise and sophisticated lexical resource)',
    contrastiveCapsule: {
      poleA: {
        label: 'Everyday register (explain the risks)',
        rule: 'Direct everyday words for basic communication',
        example: 'I set up a meeting to explain the risks.'
      },
      poleB: {
        label: 'C1 executive register (outline pitfalls)',
        rule: 'High-precision verbs and collocations for formal professional context',
        example: 'I convened a meeting to outline the potential pitfalls.'
      }
    }
  });

  // 5. Pestaña Fluidez y Cohesión
  addSurgicalCard({
    category: 'fluency',
    severity: 'refinement',
    teacherContext: 'Cause-and-effect narration during the conflict.',
    studentResponse: 'Repetitive hesitation and informal fillers: <span class="highlight-error">"Well... but... Actually..."</span>.',
    surgicalCorrection: 'Use structured discourse markers: <span class="highlight-fix">"Consequently / Faced with this situation, we took proactive steps to..."</span>.',
    explanation: 'Replace spoken fillers with clear logical transitions to maintain smooth discourse flow.',
    ieltsCriterion: 'FC: Band 7.0 (Flexible use of cohesive devices to develop a clear line of thought)',
    contrastiveCapsule: null
  });

  // 6. Pestaña Modelo (Discurso Modelo y Reformulación Completa)
  if (btnReanalyze) btnReanalyze.disabled = false;
  state.currentModelSpeech = {
    naturalCorrected: 'Well, last year I worked on a project with a very tight deadline. My team and I needed to coordinate many tasks, but the client was changing the requirements constantly. I convened a meeting to outline the potential pitfalls to them. If we had followed their plan, we would have lost a lot of time and money.',
    targetUpgrade: 'During the previous year, I orchestrated a high-stakes project subject to rigorous deadlines. Our team had to manage multiple deliverables simultaneously, while the client continually revised project specifications on a daily basis. To mitigate these risks, I convened a formal review to outline the potential pitfalls and protect our bottom line.',
    keyImprovements: [
      'Maintained consistent past simple narration without accidental present tense shifts.',
      'Replaced literal Spanish phrasings with standard business collocations ("on a daily basis").',
      'Structured logical transitions with clear discourse markers instead of fragmented fillers.'
    ]
  };
  renderModelSpeechTab(state.currentModelSpeech);
}

// Limpieza definitiva al cerrar la ventana del docente
window.addEventListener('beforeunload', () => {
  if (window.electronAPI && typeof window.electronAPI.closeRealtimeSession === 'function') {
    window.electronAPI.closeRealtimeSession().catch(() => {});
  }
});

