import { StudentSupabaseService } from './supabase-client.js';
import { AudioCaptureService } from './audio-recorder.js';

// Elementos del DOM
const joinScreen = document.getElementById('join-screen');
const sessionScreen = document.getElementById('session-screen');
const joinForm = document.getElementById('join-form');
const sessionCodeInput = document.getElementById('session-code');
const studentNameInput = document.getElementById('student-name');
const btnJoin = document.getElementById('btn-join');
const joinError = document.getElementById('join-error');

// Dispositivos de audio y medidor de voz en tiempo real
const micSelect = document.getElementById('mic-select');
const btnRefreshMics = document.getElementById('btn-refresh-mics');
const micTestLevel = document.getElementById('mic-test-level');
const micTestLabel = document.getElementById('mic-test-label');
const sessionMicSelect = document.getElementById('session-mic-select');

const displayRoomCode = document.getElementById('display-room-code');
const sessionStatusBadge = document.getElementById('session-status-badge');
const visualizerContainer = document.getElementById('visualizer-container');
const micStatusCircle = document.getElementById('mic-status-circle');
const iconMicOn = document.getElementById('icon-mic-on');
const iconMicOff = document.getElementById('icon-mic-off');
const micStatusLabel = document.getElementById('mic-status-label');
const micStatusSub = document.getElementById('mic-status-sub');
const btnToggleMute = document.getElementById('btn-toggle-mute');
const muteButtonText = document.getElementById('mute-button-text');
const btnLeaveSession = document.getElementById('btn-leave-session');

// Elementos de Autocorrección Guiada
const guidedModal = document.getElementById('guided-modal');
const guidedCategoryBadge = document.getElementById('guided-category-badge');
const guidedContextContainer = document.getElementById('guided-context-container');
const guidedContextText = document.getElementById('guided-context-text');
const guidedStudentQuote = document.getElementById('guided-student-quote');
const guidedSolutionContainer = document.getElementById('guided-solution-container');
const guidedSolutionText = document.getElementById('guided-solution-text');
const guidedExplanationText = document.getElementById('guided-explanation-text');
const btnCloseGuidedModal = document.getElementById('btn-close-guided-modal');

// Elementos de Micro-Ejercicios con IA
const exerciseModal = document.getElementById('exercise-modal');
const exerciseCategoryBadge = document.getElementById('exercise-category-badge');
const exercisePolarityTag = document.getElementById('exercise-polarity-tag');
const exerciseInstructionText = document.getElementById('exercise-instruction-text');
const exerciseMcContainer = document.getElementById('exercise-mc-container');
const exercisePromptSentence = document.getElementById('exercise-prompt-sentence');
const exerciseOptionsContainer = document.getElementById('exercise-options-container');
const exerciseSpotContainer = document.getElementById('exercise-spot-container');
const exerciseSpotSegments = document.getElementById('exercise-spot-segments');
const exerciseTransformContainer = document.getElementById('exercise-transform-container');
const exerciseTransformBase = document.getElementById('exercise-transform-base');
const exerciseTransformKeyword = document.getElementById('exercise-transform-keyword');
const exerciseTransformTemplate = document.getElementById('exercise-transform-template');
const exerciseTransformForm = document.getElementById('exercise-transform-form');
const exerciseTextInput = document.getElementById('exercise-text-input');
const btnSubmitExercise = document.getElementById('btn-submit-exercise');

// Formato 4: Error Correction Input
const exerciseCorrectionContainer = document.getElementById('exercise-correction-container');
const exerciseCorrectionFaulty = document.getElementById('exercise-correction-faulty');
const exerciseCorrectionForm = document.getElementById('exercise-correction-form');
const exerciseCorrectionInput = document.getElementById('exercise-correction-input');
const btnSubmitCorrection = document.getElementById('btn-submit-correction');

// Formato 5: Sentence Unscramble
const exerciseUnscrambleContainer = document.getElementById('exercise-unscramble-container');
const exerciseUnscrambleResult = document.getElementById('exercise-unscramble-result');
const exerciseUnscrambleBank = document.getElementById('exercise-unscramble-bank');
const btnClearUnscramble = document.getElementById('btn-clear-unscramble');
const btnSubmitUnscramble = document.getElementById('btn-submit-unscramble');

// Formato 6: Open Cloze
const exerciseClozeContainer = document.getElementById('exercise-cloze-container');
const exerciseClozeSentence = document.getElementById('exercise-cloze-sentence');
const exerciseClozeForm = document.getElementById('exercise-cloze-form');
const exerciseClozeInput = document.getElementById('exercise-cloze-input');
const btnSubmitCloze = document.getElementById('btn-submit-cloze');

const exerciseFeedbackContainer = document.getElementById('exercise-feedback-container');
const exerciseFeedbackTitle = document.getElementById('exercise-feedback-title');
const exerciseFeedbackSolution = document.getElementById('exercise-feedback-solution');
const exerciseFeedbackText = document.getElementById('exercise-feedback-text');
const btnCloseExerciseModal = document.getElementById('btn-close-exercise-modal');

let currentStudentExercise = null;
let currentUnscrambleSelected = [];

const CATEGORY_NAMES = {
  grammar: 'Gramática',
  vocabulary: 'Vocabulario',
  pronunciation: 'Pronunciación',
  upgrade_c1: 'Upgrade C1',
  fluency: 'Fluidez'
};

// Instancias de servicios y estado de audio
const supabaseService = new StudentSupabaseService();
let audioService = null;
let activePreviewMonitor = null;
let selectedDeviceId = '';

// 1. Leer parámetros URL y cargar dispositivos de micrófono en el arranque
window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code') || params.get('session');
  if (codeParam) {
    sessionCodeInput.value = codeParam.toUpperCase().trim();
  }

  await loadMicrophones();
});

// Auto-mayúsculas para el código de sesión
sessionCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// Carga y enumera los micrófonos físicos en los selectores
async function loadMicrophones() {
  if (!micSelect) return;
  const mics = await AudioCaptureService.enumerateMicrophones();
  micSelect.innerHTML = '';
  if (sessionMicSelect) sessionMicSelect.innerHTML = '';

  if (mics.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin micrófonos detectados';
    micSelect.appendChild(opt);
    if (sessionMicSelect) sessionMicSelect.appendChild(opt.cloneNode(true));
    return;
  }

  mics.forEach((mic, i) => {
    const opt = document.createElement('option');
    opt.value = mic.deviceId;
    opt.textContent = mic.label || `Micrófono ${i + 1}`;
    micSelect.appendChild(opt);
    if (sessionMicSelect) sessionMicSelect.appendChild(opt.cloneNode(true));
  });

  // Conservar selección previa si sigue existiendo o elegir el primero
  if (!selectedDeviceId || !mics.some(m => m.deviceId === selectedDeviceId)) {
    selectedDeviceId = mics[0].deviceId;
  }
  micSelect.value = selectedDeviceId;
  if (sessionMicSelect) sessionMicSelect.value = selectedDeviceId;

  // Iniciar monitor de prueba en tiempo real
  startPreviewMonitor(selectedDeviceId);
}

// Monitor visual de prueba en tiempo real para verificar la entrada antes de unirse
async function startPreviewMonitor(deviceId) {
  if (activePreviewMonitor) {
    activePreviewMonitor.stop();
    activePreviewMonitor = null;
  }

  try {
    activePreviewMonitor = await AudioCaptureService.createAudioPreview(deviceId, (level) => {
      if (!micTestLevel) return;
      // Normalizar nivel (0 - 100)
      const pct = Math.min(Math.round((level / 60) * 100), 100);
      micTestLevel.style.width = `${pct}%`;

      if (micTestLabel) {
        if (pct > 8) {
          micTestLabel.textContent = '¡Señal de voz detectada! Micrófono captando audio.';
          micTestLabel.classList.add('active');
        } else {
          micTestLabel.textContent = 'Prueba de micrófono: di algo para verificar señal...';
          micTestLabel.classList.remove('active');
        }
      }
    });
  } catch (err) {
    console.warn('[Audio] No se pudo iniciar monitor de prueba:', err);
    if (micTestLabel) micTestLabel.textContent = 'Permiso de micrófono no otorgado';
  }
}

if (micSelect) {
  micSelect.addEventListener('change', () => {
    selectedDeviceId = micSelect.value;
    if (sessionMicSelect) sessionMicSelect.value = selectedDeviceId;
    startPreviewMonitor(selectedDeviceId);
  });
}

if (btnRefreshMics) {
  btnRefreshMics.addEventListener('click', async () => {
    await loadMicrophones();
  });
}

if (sessionMicSelect) {
  sessionMicSelect.addEventListener('change', async () => {
    selectedDeviceId = sessionMicSelect.value;
    if (micSelect) micSelect.value = selectedDeviceId;
    if (audioService) {
      await audioService.setDevice(selectedDeviceId);
      console.log('[Student Audio] Micrófono cambiado durante sesión a:', selectedDeviceId);
    }
  });
}

// 2. Manejo de formulario de ingreso
joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  joinError.textContent = '';
  
  const sessionCode = sessionCodeInput.value.trim().toUpperCase();
  const studentName = studentNameInput.value.trim();

  if (!sessionCode || !studentName) {
    joinError.textContent = 'Por favor completa todos los campos.';
    return;
  }

  btnJoin.disabled = true;
  btnJoin.querySelector('span').textContent = 'Conectando...';

  try {
    // Validar sesión en Supabase
    await supabaseService.validateSession(sessionCode);

    // Detener monitor de prueba previo antes de iniciar la captura oficial
    if (activePreviewMonitor) {
      activePreviewMonitor.stop();
      activePreviewMonitor = null;
    }

    if (micSelect && micSelect.value) {
      selectedDeviceId = micSelect.value;
    }

    // Inicializar captura de audio con bitrate de voz optimizado (24 kbps), bloques de 15s y VAD Adaptativo
    audioService = new AudioCaptureService({
      deviceId: selectedDeviceId,
      maxBlockDuration: 15000,
      silenceTimeoutMs: 1800,
      audioBitsPerSecond: 24000,
      onChunk: async (blob, mimeType, metrics) => {
        console.log(`[AudioCapture] Bloque listo para subir a Storage (${blob.size} bytes, voz: ${Math.round(metrics?.activeSpeechMs || 0)}ms, peakRms: ${metrics?.peakRms?.toFixed(3) || 0}, noiseFloor: ${metrics?.noiseFloorAtEnd?.toFixed(4) || 0})`);
        await supabaseService.uploadAudioSegment(blob, mimeType);
      },
      onVolume: (level, _rms = 0) => {
        handleVolumeFeedback(level);
      }
    });

    await audioService.start(selectedDeviceId);

    // Unirse al canal de Realtime
    await supabaseService.joinSessionChannel(sessionCode, studentName, handleTeacherEvent);

    // Cambiar a la vista de sesión
    displayRoomCode.textContent = `SALA: ${sessionCode}`;
    joinScreen.classList.remove('active');
    sessionScreen.classList.add('active');
    visualizerContainer.classList.add('recording');

  } catch (error) {
    console.error('Error al unirse:', error);
    joinError.textContent = error.message || 'Error al conectar con la sesión';
    if (audioService) {
      audioService.stop();
      audioService = null;
    }
  } finally {
    btnJoin.disabled = false;
    btnJoin.querySelector('span').textContent = 'Unirse a la Sesión';
  }
});

// 3. Control de Hardware: Mute / Unmute
btnToggleMute.addEventListener('click', () => {
  if (!audioService) return;

  const isMuted = audioService.toggleMute();
  supabaseService.sendMuteChange(isMuted);

  if (isMuted) {
    btnToggleMute.classList.add('muted');
    muteButtonText.textContent = 'Reactivar';
    micStatusCircle.classList.add('muted');
    iconMicOn.classList.add('hidden');
    iconMicOff.classList.remove('hidden');
    visualizerContainer.classList.add('muted');
    micStatusLabel.textContent = 'Micrófono Silenciado';
    micStatusSub.textContent = 'Tu profesor no puede escucharte mientras esté silenciado.';
  } else {
    btnToggleMute.classList.remove('muted');
    muteButtonText.textContent = 'Silenciar';
    micStatusCircle.classList.remove('muted');
    iconMicOn.classList.remove('hidden');
    iconMicOff.classList.add('hidden');
    visualizerContainer.classList.remove('muted');
    micStatusLabel.textContent = 'Micrófono Activo';
    micStatusSub.textContent = 'Habla con naturalidad. Tu audio se transmite a tu profesor.';
  }
});

// 4. Salir de la sesión
btnLeaveSession.addEventListener('click', async () => {
  if (confirm('¿Deseas salir de la sesión?')) {
    cleanupSession();
  }
});

// 5. Manejo de eventos del docente recibidos vía Realtime
function handleTeacherEvent(eventType, payload) {
  if (eventType === 'session_start') {
    sessionStatusBadge.textContent = 'Sesión en Curso';
    sessionStatusBadge.className = 'badge badge-active';
  } else if (eventType === 'session_end') {
    sessionStatusBadge.textContent = 'Sesión Finalizada';
    sessionStatusBadge.className = 'badge badge-ended';
    micStatusLabel.textContent = 'Tiempo Terminado';
    micStatusSub.textContent = 'La sesión oral ha concluido. ¡Buen trabajo!';
    if (audioService) {
      audioService.stop();
    }
    visualizerContainer.classList.remove('recording');
  } else if (eventType === 'guided_correction') {
    handleGuidedCorrectionEvent(payload);
  } else if (eventType === 'micro_exercise') {
    handleMicroExerciseEvent(payload);
  }
}

// 5.1 Manejador de Autocorrección Guiada en tiempo real
function handleGuidedCorrectionEvent(payload) {
  if (!payload || !payload.action) return;

  if (payload.action === 'show_prompt') {
    // Si hubiera un ejercicio activo, ocultarlo para priorizar la autocorrección guiada
    if (exerciseModal) {
      exerciseModal.classList.add('hidden');
    }

    // 1. Badge de Categoría
    const cat = (payload.category || 'grammar').toLowerCase();
    guidedCategoryBadge.textContent = CATEGORY_NAMES[cat] || payload.category || 'Atención';
    guidedCategoryBadge.className = `guided-badge cat-${cat}`;

    // 2. Contexto o pregunta docente: solo mostrar si hay texto real del profesor
    const ctx = (payload.teacherContext || '').trim();
    if (!ctx || ctx === 'Pregunta o contexto oral' || ctx.toLowerCase().includes('tell me about your experience') || ctx === 'Speaking turn') {
      guidedContextText.textContent = '';
      guidedContextContainer.style.display = 'none';
      guidedContextContainer.classList.add('hidden');
    } else {
      guidedContextText.textContent = ctx;
      guidedContextContainer.style.display = '';
      guidedContextContainer.classList.remove('hidden');
    }

    // 3. Frase del alumno (con formato de error resaltado si viene con HTML)
    guidedStudentQuote.innerHTML = payload.studentQuote || '';

    // 4. Ocultar y reiniciar solución
    guidedSolutionContainer.classList.add('hidden');
    guidedSolutionText.innerHTML = '';
    guidedExplanationText.innerHTML = '';

    // 5. Mostrar modal
    guidedModal.classList.remove('hidden');
  } else if (payload.action === 'reveal_answer') {
    // Revelar la respuesta modelo y explicación
    if (payload.surgicalCorrection) {
      guidedSolutionText.innerHTML = payload.surgicalCorrection;
    }
    if (payload.explanation) {
      guidedExplanationText.innerHTML = payload.explanation;
      guidedExplanationText.style.display = 'block';
    } else {
      guidedExplanationText.innerHTML = '';
      guidedExplanationText.style.display = 'none';
    }
    guidedSolutionContainer.classList.remove('hidden');
    guidedModal.classList.remove('hidden');
  } else if (payload.action === 'hide') {
    guidedModal.classList.add('hidden');
    guidedSolutionContainer.classList.add('hidden');
  }
}

// 5.2 Manejador de Micro-Ejercicios Interactivos con IA en tiempo real
function handleMicroExerciseEvent(payload) {
  if (!payload || !payload.action) return;

  if (payload.action === 'show_exercise') {
    currentStudentExercise = payload;

    // Cerrar modal de autocorrección guiada si estuviera abierto
    if (guidedModal) {
      guidedModal.classList.add('hidden');
      guidedSolutionContainer.classList.add('hidden');
    }

    // 1. Badge de Categoría y Polaridad
    const cat = (payload.category || 'grammar').toLowerCase();
    exerciseCategoryBadge.textContent = CATEGORY_NAMES[cat] || payload.category || 'Ejercicio';
    exerciseCategoryBadge.className = `guided-badge cat-${cat}`;

    if (exercisePolarityTag) {
      const isContrast = payload.contrastPolarity === 'contrast';
      exercisePolarityTag.className = `exercise-polarity-tag ${isContrast ? 'polarity-contrast' : 'polarity-target'}`;
      exercisePolarityTag.textContent = isContrast ? '⚖️ Contraste' : '🎯 Regla Objetivo';
    }

    // 2. Instrucción breve
    exerciseInstructionText.textContent = payload.instruction || 'Resuelve el siguiente ejercicio interactivo:';

    // 3. Reiniciar contenedor de feedback
    exerciseFeedbackContainer.classList.add('hidden');
    exerciseFeedbackSolution.classList.add('hidden');
    exerciseFeedbackSolution.innerHTML = '';
    exerciseFeedbackTitle.textContent = '';
    exerciseFeedbackTitle.className = 'exercise-feedback-title';
    exerciseFeedbackText.textContent = '';

    // 4. Ocultar todos los sub-contenedores (6 formatos)
    exerciseMcContainer.classList.add('hidden');
    exerciseSpotContainer.classList.add('hidden');
    exerciseTransformContainer.classList.add('hidden');
    if (exerciseCorrectionContainer) exerciseCorrectionContainer.classList.add('hidden');
    if (exerciseUnscrambleContainer) exerciseUnscrambleContainer.classList.add('hidden');
    if (exerciseClozeContainer) exerciseClozeContainer.classList.add('hidden');

    // 5. Renderizar según formato
    if (payload.type === 'spot_the_error') {
      renderSpotTheError(payload);
    } else if (payload.type === 'key_word_transformation') {
      renderKeyWordTransformation(payload);
    } else if (payload.type === 'error_correction_input') {
      renderErrorCorrectionInput(payload);
    } else if (payload.type === 'sentence_unscramble') {
      renderSentenceUnscramble(payload);
    } else if (payload.type === 'open_cloze') {
      renderOpenCloze(payload);
    } else {
      renderMultipleChoice(payload);
    }

    // 6. Mostrar modal
    exerciseModal.classList.remove('hidden');
  } else if (payload.action === 'hide_exercise') {
    currentStudentExercise = null;
    exerciseModal.classList.add('hidden');
    exerciseFeedbackContainer.classList.add('hidden');
  }
}

// FORMATO 1: MULTIPLE CHOICE (4 opciones)
function renderMultipleChoice(exercise) {
  exerciseMcContainer.classList.remove('hidden');

  const rawSentence = exercise.promptSentence || '___';
  exercisePromptSentence.innerHTML = rawSentence.replace('___', '<span class="prompt-blank">___</span>');

  exerciseOptionsContainer.innerHTML = '';
  const options = Array.isArray(exercise.options) ? exercise.options : [];
  options.forEach((optText, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'exercise-option-btn';
    btn.dataset.index = index;
    btn.innerHTML = `<span>${optText}</span>`;

    btn.addEventListener('click', () => {
      handleSelectMultipleChoice(index, btn, exercise);
    });

    exerciseOptionsContainer.appendChild(btn);
  });
}

function handleSelectMultipleChoice(selectedIndex, clickedBtn, exercise) {
  const allBtns = exerciseOptionsContainer.querySelectorAll('.exercise-option-btn');
  allBtns.forEach((b) => (b.disabled = true));

  const isCorrect = selectedIndex === exercise.correctIndex;
  const correctBtn = allBtns[exercise.correctIndex];

  if (isCorrect) {
    clickedBtn.classList.add('option-correct');
    exerciseFeedbackTitle.textContent = '¡Excelente! Opción Correcta';
    exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
  } else {
    clickedBtn.classList.add('option-wrong');
    if (correctBtn) correctBtn.classList.add('option-correct');
    exerciseFeedbackTitle.textContent = 'Respuesta Incorrecta';
    exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
  }

  exerciseFeedbackSolution.innerHTML = `Opción correcta: <strong>${exercise.options[exercise.correctIndex]}</strong>`;
  exerciseFeedbackSolution.classList.remove('hidden');
  exerciseFeedbackText.textContent = exercise.feedbackExplanation || '';
  exerciseFeedbackContainer.classList.remove('hidden');

  supabaseService.sendMicroExerciseAnswer({
    exerciseId: exercise.exerciseId,
    exerciseType: 'multiple_choice',
    selectedIndex,
    selectedText: exercise.options[selectedIndex] || '',
    correctIndex: exercise.correctIndex,
    correctText: exercise.options[exercise.correctIndex] || '',
    isCorrect,
    answeredAt: Date.now()
  });
}

// FORMATO 2: SPOT THE ERROR (4 segmentos clicables)
function renderSpotTheError(exercise) {
  exerciseSpotContainer.classList.remove('hidden');
  exerciseSpotSegments.innerHTML = '';

  const segments = Array.isArray(exercise.segments) ? exercise.segments : [];
  segments.forEach((segText, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spot-segment-btn';
    btn.dataset.index = index;
    btn.innerHTML = `<span><strong>[${index + 1}]</strong> ${segText}</span>`;

    btn.addEventListener('click', () => {
      handleSelectSpotSegment(index, btn, exercise);
    });

    exerciseSpotSegments.appendChild(btn);
  });
}

function handleSelectSpotSegment(selectedIndex, clickedBtn, exercise) {
  const allBtns = exerciseSpotSegments.querySelectorAll('.spot-segment-btn');
  allBtns.forEach((b) => (b.disabled = true));

  const isCorrect = selectedIndex === exercise.errorSegmentIndex;
  const errorTargetBtn = allBtns[exercise.errorSegmentIndex];

  if (isCorrect) {
    clickedBtn.classList.add('option-correct');
    exerciseFeedbackTitle.textContent = '¡Excelente! Identificaste el error con precisión.';
    exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
  } else {
    clickedBtn.classList.add('option-wrong');
    if (errorTargetBtn) errorTargetBtn.classList.add('option-correct');
    exerciseFeedbackTitle.textContent = 'Intento Incorrecto';
    exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
  }

  exerciseFeedbackSolution.innerHTML = `Corrección del segmento: <strong>${exercise.correctedSegment}</strong>`;
  exerciseFeedbackSolution.classList.remove('hidden');
  exerciseFeedbackText.textContent = exercise.feedbackExplanation || '';
  exerciseFeedbackContainer.classList.remove('hidden');

  supabaseService.sendMicroExerciseAnswer({
    exerciseId: exercise.exerciseId,
    exerciseType: 'spot_the_error',
    selectedIndex,
    selectedText: exercise.segments[selectedIndex] || '',
    correctIndex: exercise.errorSegmentIndex,
    correctText: exercise.segments[exercise.errorSegmentIndex] || '',
    correctedSegment: exercise.correctedSegment,
    isCorrect,
    answeredAt: Date.now()
  });
}

// FORMATO 3: KEY WORD TRANSFORMATION (C1/C2)
function renderKeyWordTransformation(exercise) {
  exerciseTransformContainer.classList.remove('hidden');

  exerciseTransformBase.textContent = exercise.baseSentence || '';
  exerciseTransformKeyword.textContent = exercise.keyWord || '';
  const template = exercise.targetSentenceTemplate || '___';
  exerciseTransformTemplate.innerHTML = template.replace('___', '<span class="prompt-blank">___</span>');

  exerciseTextInput.value = '';
  exerciseTextInput.disabled = false;
  btnSubmitExercise.disabled = false;
  btnSubmitExercise.textContent = 'Enviar Respuesta';
  setTimeout(() => exerciseTextInput.focus(), 150);
}

function normalizeAnswerText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/['"`´’]/g, "'")
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae candidatos para la respuesta del hueco cuando el alumno escribe
 * la frase completa, parte del prefijo o parte del sufijo de targetSentenceTemplate.
 */
function extractGapAnswerCandidates(studentText, template) {
  const normInput = normalizeAnswerText(studentText);
  if (!normInput) return [];

  const candidates = [normInput];
  if (!template || !template.includes('___')) return candidates;

  const [rawPrefix, rawSuffix] = template.split('___');
  const normPrefix = normalizeAnswerText(rawPrefix);
  const normSuffix = normalizeAnswerText(rawSuffix);

  let extracted = normInput;

  // 1. Quitar prefijo exacto si está al inicio
  if (normPrefix && extracted.startsWith(normPrefix)) {
    extracted = extracted.slice(normPrefix.length).trim();
  }

  // 2. Quitar sufijo exacto si está al final
  if (normSuffix && extracted.endsWith(normSuffix)) {
    extracted = extracted.slice(0, extracted.length - normSuffix.length).trim();
  }

  if (extracted && !candidates.includes(extracted)) {
    candidates.push(extracted);
  }

  // 3. Quitar sufijo parcial si el estudiante no escribió todo el sufijo hasta el final
  // Ej: template sufijo = "academic courses for international students", input termina en "academic courses"
  if (normSuffix && extracted) {
    const suffixWords = normSuffix.split(' ');
    for (let len = suffixWords.length - 1; len >= 1; len--) {
      const partialSuffix = suffixWords.slice(0, len).join(' ');
      if (extracted.endsWith(partialSuffix)) {
        const trimmed = extracted.slice(0, extracted.length - partialSuffix.length).trim();
        if (trimmed && !candidates.includes(trimmed)) {
          candidates.push(trimmed);
        }
        break;
      }
    }
  }

  // 4. Quitar prefijo parcial si el estudiante escribió solo parte del prefijo
  if (normPrefix && extracted) {
    const prefixWords = normPrefix.split(' ');
    for (let start = 1; start < prefixWords.length; start++) {
      const partialPrefix = prefixWords.slice(start).join(' ');
      if (extracted.startsWith(partialPrefix)) {
        const trimmed = extracted.slice(partialPrefix.length).trim();
        if (trimmed && !candidates.includes(trimmed)) {
          candidates.push(trimmed);
        }
        break;
      }
    }
  }

  return candidates;
}

exerciseTransformForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentStudentExercise || currentStudentExercise.type !== 'key_word_transformation') return;

  const rawAnswer = exerciseTextInput.value.trim();
  if (!rawAnswer) return;

  exerciseTextInput.disabled = true;
  btnSubmitExercise.disabled = true;

  const candidates = extractGapAnswerCandidates(rawAnswer, currentStudentExercise.targetSentenceTemplate);
  const normIdeal = normalizeAnswerText(currentStudentExercise.idealAnswer);
  const normVariants = (currentStudentExercise.acceptableVariants || []).map(normalizeAnswerText);

  // Considerar correcto si el texto directo o la subcadena extraída del hueco coincide
  const isCorrect = candidates.some(cand => cand === normIdeal || normVariants.includes(cand));

  if (isCorrect) {
    exerciseFeedbackTitle.textContent = '¡Brillante! Transformación sintáctica correcta.';
    exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
  } else {
    exerciseFeedbackTitle.textContent = 'Intento Incorrecto';
    exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
  }

  exerciseFeedbackSolution.innerHTML = `Respuesta modelo: <strong>${currentStudentExercise.idealAnswer}</strong>`;
  exerciseFeedbackSolution.classList.remove('hidden');
  exerciseFeedbackText.textContent = currentStudentExercise.feedbackExplanation || '';
  exerciseFeedbackContainer.classList.remove('hidden');

  supabaseService.sendMicroExerciseAnswer({
    exerciseId: currentStudentExercise.exerciseId,
    exerciseType: 'key_word_transformation',
    selectedText: rawAnswer,
    correctText: currentStudentExercise.idealAnswer,
    isCorrect,
    answeredAt: Date.now()
  });
});

// FORMATO 4: ERROR CORRECTION INPUT
function renderErrorCorrectionInput(exercise) {
  if (!exerciseCorrectionContainer) return;
  exerciseCorrectionContainer.classList.remove('hidden');

  if (exerciseCorrectionFaulty) {
    exerciseCorrectionFaulty.textContent = exercise.faultySentence || '';
  }
  if (exerciseCorrectionInput) {
    exerciseCorrectionInput.value = '';
    exerciseCorrectionInput.disabled = false;
  }
  if (btnSubmitCorrection) {
    btnSubmitCorrection.disabled = false;
    btnSubmitCorrection.textContent = 'Enviar Corrección';
  }
  setTimeout(() => exerciseCorrectionInput && exerciseCorrectionInput.focus(), 150);
}

if (exerciseCorrectionForm) {
  exerciseCorrectionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentStudentExercise || currentStudentExercise.type !== 'error_correction_input') return;

    const rawAnswer = exerciseCorrectionInput.value.trim();
    if (!rawAnswer) return;

    exerciseCorrectionInput.disabled = true;
    btnSubmitCorrection.disabled = true;

    const normInput = normalizeAnswerText(rawAnswer);
    const normIdeal = normalizeAnswerText(currentStudentExercise.idealAnswer);
    const normVariants = (currentStudentExercise.acceptableVariants || []).map(normalizeAnswerText);

    // Válido si coincide con la frase completa o con la parte/variante corregida
    const isCorrect = normInput === normIdeal || normVariants.includes(normInput) || (normIdeal.includes(normInput) && normInput.length >= 3);

    if (isCorrect) {
      exerciseFeedbackTitle.textContent = '¡Excelente! Corrección gramatical precisa.';
      exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
    } else {
      exerciseFeedbackTitle.textContent = 'Intento Incorrecto';
      exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
    }

    exerciseFeedbackSolution.innerHTML = `Corrección esperada: <strong>${currentStudentExercise.idealAnswer}</strong>`;
    exerciseFeedbackSolution.classList.remove('hidden');
    exerciseFeedbackText.textContent = currentStudentExercise.feedbackExplanation || '';
    exerciseFeedbackContainer.classList.remove('hidden');

    supabaseService.sendMicroExerciseAnswer({
      exerciseId: currentStudentExercise.exerciseId,
      exerciseType: 'error_correction_input',
      selectedText: rawAnswer,
      correctText: currentStudentExercise.idealAnswer,
      isCorrect,
      answeredAt: Date.now()
    });
  });
}

// FORMATO 5: SENTENCE UNSCRAMBLE
function renderSentenceUnscramble(exercise) {
  if (!exerciseUnscrambleContainer) return;
  exerciseUnscrambleContainer.classList.remove('hidden');
  currentUnscrambleSelected = [];

  if (exerciseUnscrambleResult) {
    exerciseUnscrambleResult.textContent = 'Pulsa los bloques en orden...';
    exerciseUnscrambleResult.style.color = '#94a3b8';
  }
  if (btnSubmitUnscramble) {
    btnSubmitUnscramble.disabled = true;
  }

  if (exerciseUnscrambleBank) {
    exerciseUnscrambleBank.innerHTML = '';
    const chunks = Array.isArray(exercise.shuffledChunks) ? exercise.shuffledChunks : [];
    chunks.forEach((chunk, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'unscramble-chip';
      chip.dataset.index = index;
      chip.textContent = chunk;

      chip.addEventListener('click', () => {
        if (chip.classList.contains('chip-used')) return;
        chip.classList.add('chip-used');
        currentUnscrambleSelected.push({ index, text: chunk });
        updateUnscrambleDisplay(exercise);
      });

      exerciseUnscrambleBank.appendChild(chip);
    });
  }
}

function updateUnscrambleDisplay(exercise) {
  if (!exerciseUnscrambleResult) return;
  if (currentUnscrambleSelected.length === 0) {
    exerciseUnscrambleResult.textContent = 'Pulsa los bloques en orden...';
    exerciseUnscrambleResult.style.color = '#94a3b8';
    if (btnSubmitUnscramble) btnSubmitUnscramble.disabled = true;
    return;
  }

  const assembled = currentUnscrambleSelected.map(c => c.text).join(' ');
  exerciseUnscrambleResult.textContent = assembled;
  exerciseUnscrambleResult.style.color = '#f8fafc';

  const totalChunks = (exercise.shuffledChunks || []).length;
  if (btnSubmitUnscramble) {
    btnSubmitUnscramble.disabled = currentUnscrambleSelected.length !== totalChunks;
  }
}

if (btnClearUnscramble) {
  btnClearUnscramble.addEventListener('click', () => {
    if (!currentStudentExercise || currentStudentExercise.type !== 'sentence_unscramble') return;
    currentUnscrambleSelected = [];
    if (exerciseUnscrambleBank) {
      exerciseUnscrambleBank.querySelectorAll('.unscramble-chip').forEach(c => c.classList.remove('chip-used'));
    }
    updateUnscrambleDisplay(currentStudentExercise);
  });
}

if (btnSubmitUnscramble) {
  btnSubmitUnscramble.addEventListener('click', () => {
    if (!currentStudentExercise || currentStudentExercise.type !== 'sentence_unscramble') return;

    btnSubmitUnscramble.disabled = true;
    if (btnClearUnscramble) btnClearUnscramble.disabled = true;

    const assembledText = currentUnscrambleSelected.map(c => c.text).join(' ');
    const normAssembled = normalizeAnswerText(assembledText);
    const normTarget = normalizeAnswerText(currentStudentExercise.correctSentence);

    const isCorrect = normAssembled === normTarget;

    if (isCorrect) {
      exerciseFeedbackTitle.textContent = '¡Perfecto! Has ordenado la frase correctamente.';
      exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
    } else {
      exerciseFeedbackTitle.textContent = 'Orden Incorrecto';
      exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
    }

    exerciseFeedbackSolution.innerHTML = `Oración correcta: <strong>${currentStudentExercise.correctSentence}</strong>`;
    exerciseFeedbackSolution.classList.remove('hidden');
    exerciseFeedbackText.textContent = currentStudentExercise.feedbackExplanation || '';
    exerciseFeedbackContainer.classList.remove('hidden');

    supabaseService.sendMicroExerciseAnswer({
      exerciseId: currentStudentExercise.exerciseId,
      exerciseType: 'sentence_unscramble',
      selectedText: assembledText,
      correctText: currentStudentExercise.correctSentence,
      isCorrect,
      answeredAt: Date.now()
    });
  });
}

// FORMATO 6: OPEN CLOZE
function renderOpenCloze(exercise) {
  if (!exerciseClozeContainer) return;
  exerciseClozeContainer.classList.remove('hidden');

  if (exerciseClozeSentence) {
    const rawSentence = exercise.promptSentence || '___';
    exerciseClozeSentence.innerHTML = rawSentence.replace('___', '<span class="prompt-blank">___</span>');
  }
  if (exerciseClozeInput) {
    exerciseClozeInput.value = '';
    exerciseClozeInput.disabled = false;
  }
  if (btnSubmitCloze) {
    btnSubmitCloze.disabled = false;
    btnSubmitCloze.textContent = 'Comprobar';
  }
  setTimeout(() => exerciseClozeInput && exerciseClozeInput.focus(), 150);
}

if (exerciseClozeForm) {
  exerciseClozeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentStudentExercise || currentStudentExercise.type !== 'open_cloze') return;

    const rawAnswer = (exerciseClozeInput.value || '').trim();
    if (!rawAnswer) return;

    exerciseClozeInput.disabled = true;
    btnSubmitCloze.disabled = true;

    const candidates = extractGapAnswerCandidates(rawAnswer, currentStudentExercise.promptSentence);
    const normIdeal = normalizeAnswerText(currentStudentExercise.idealAnswer);
    const normVariants = (currentStudentExercise.acceptableVariants || []).map(normalizeAnswerText);

    const isCorrect = candidates.some(cand => cand === normIdeal || normVariants.includes(cand));

    if (isCorrect) {
      exerciseFeedbackTitle.textContent = '¡Correcto! Palabra precisa identificada.';
      exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
    } else {
      exerciseFeedbackTitle.textContent = 'Palabra Incorrecta';
      exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
    }

    exerciseFeedbackSolution.innerHTML = `Palabra correcta: <strong>${currentStudentExercise.idealAnswer}</strong>`;
    exerciseFeedbackSolution.classList.remove('hidden');
    exerciseFeedbackText.textContent = currentStudentExercise.feedbackExplanation || '';
    exerciseFeedbackContainer.classList.remove('hidden');

    supabaseService.sendMicroExerciseAnswer({
      exerciseId: currentStudentExercise.exerciseId,
      exerciseType: 'open_cloze',
      selectedText: rawAnswer,
      correctText: currentStudentExercise.idealAnswer,
      isCorrect,
      answeredAt: Date.now()
    });
  });
}

// 6. Cierre local de modales por el alumno
if (btnCloseGuidedModal) {
  btnCloseGuidedModal.addEventListener('click', () => {
    guidedModal.classList.add('hidden');
    guidedSolutionContainer.classList.add('hidden');
  });
}

if (btnCloseExerciseModal) {
  btnCloseExerciseModal.addEventListener('click', () => {
    exerciseModal.classList.add('hidden');
    exerciseFeedbackContainer.classList.add('hidden');
  });
}

// 7. Retroalimentación visual sutil basada en volumen
function handleVolumeFeedback(level) {
  if (!audioService || audioService.isMuted) return;
  // level oscila típicamente entre 0 y 120 para voz hablada
  const scale = Math.min(1.0 + (level / 150), 1.3);
  micStatusCircle.style.transform = `scale(${scale})`;
}

// 8. Limpieza al salir o recargar la página
async function cleanupSession() {
  if (activePreviewMonitor) {
    activePreviewMonitor.stop();
    activePreviewMonitor = null;
  }
  if (audioService) {
    audioService.stop();
    audioService = null;
  }
  if (supabaseService) {
    await supabaseService.leave();
  }
  if (guidedModal) {
    guidedModal.classList.add('hidden');
    guidedSolutionContainer.classList.add('hidden');
  }
  if (exerciseModal) {
    exerciseModal.classList.add('hidden');
    exerciseFeedbackContainer.classList.add('hidden');
    if (exerciseFeedbackSolution) {
      exerciseFeedbackSolution.classList.add('hidden');
      exerciseFeedbackSolution.innerHTML = '';
    }
    if (exerciseTextInput) {
      exerciseTextInput.value = '';
    }
  }
  currentStudentExercise = null;
  joinError.textContent = '';
  btnJoin.disabled = false;
  btnJoin.querySelector('span').textContent = 'Unirse a la Sesión';

  sessionScreen.classList.remove('active');
  joinScreen.classList.add('active');
  visualizerContainer.classList.remove('recording', 'muted');

  // Reactivar monitor de prueba al volver a la pantalla de inicio
  if (selectedDeviceId) {
    startPreviewMonitor(selectedDeviceId);
  }
}

window.addEventListener('beforeunload', () => {
  if (activePreviewMonitor) activePreviewMonitor.stop();
  if (audioService) audioService.stop();
  if (supabaseService) supabaseService.leave();
});

