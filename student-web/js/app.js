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

// Medidor visual de señal en sesión activa (VU Meter)
const sessionVuMeterLevel = document.getElementById('session-vu-meter-level');
const sessionVuMeterLabel = document.getElementById('session-vu-meter-label');

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

// Elementos de Cápsula Contrastiva en Autocorrección Guiada
const guidedCapsuleContainer = document.getElementById('guided-capsule-container');
const guidedPoleALabel = document.getElementById('guided-pole-a-label');
const guidedPoleARule = document.getElementById('guided-pole-a-rule');
const guidedPoleAExample = document.getElementById('guided-pole-a-example');
const guidedPoleBLabel = document.getElementById('guided-pole-b-label');
const guidedPoleBRule = document.getElementById('guided-pole-b-rule');
const guidedPoleBExample = document.getElementById('guided-pole-b-example');

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

// Elementos de Discurso Modelo (Reformulación Completa)
const modelSpeechModal = document.getElementById('model-speech-modal');
const btnCloseModelSpeechModal = document.getElementById('btn-close-model-speech-modal');
const studentModelNaturalCorrected = document.getElementById('student-model-natural-corrected');
const studentModelTargetUpgrade = document.getElementById('student-model-target-upgrade');
const studentModelImprovementsBox = document.getElementById('student-model-improvements-box');
const studentModelImprovementsList = document.getElementById('student-model-improvements-list');

let currentStudentExercise = null;
let currentUnscrambleSelected = [];
let currentGuidedCapsule = null;

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CATEGORY_NAMES = {
  grammar: 'Grammar',
  vocabulary: 'Vocabulary',
  pronunciation: 'Pronunciation',
  upgrade_c1: 'C1 Upgrade',
  fluency: 'Fluency'
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
      if (supabaseService) {
        supabaseService.sendMicStatus({
          ok: true,
          deviceLabel: audioService.getDeviceLabel ? audioService.getDeviceLabel() : '',
          mimeType: audioService.supportedMime || ''
        });
      }
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
    // Validar sesión en Supabase y chequear si el docente ya la inició ('active')
    const sessionData = await supabaseService.validateSession(sessionCode);
    const isAlreadyActive = sessionData && sessionData.status === 'active';

    // Detener monitor de prueba previo antes de iniciar la captura oficial
    if (activePreviewMonitor) {
      activePreviewMonitor.stop();
      activePreviewMonitor = null;
    }

    if (micSelect && micSelect.value) {
      selectedDeviceId = micSelect.value;
    }

    // Inicializar captura de audio con bitrate de voz optimizado (24 kbps), bloques de 45s y VAD Adaptativo sensible
    audioService = new AudioCaptureService({
      deviceId: selectedDeviceId,
      maxBlockDuration: 45000,
      silenceTimeoutMs: 1800,
      audioBitsPerSecond: 24000,
      onChunk: async (blob, mimeType, metrics) => {
        console.log(`[AudioCapture] Bloque listo para subir a Storage (${blob.size} bytes, voz: ${Math.round(metrics?.activeSpeechMs || 0)}ms, peakRms: ${metrics?.peakRms?.toFixed(3) || 0}, noiseFloor: ${metrics?.noiseFloorAtEnd?.toFixed(4) || 0})`);
        await supabaseService.uploadAudioSegment(blob, mimeType);
      },
      onVolumeChange: (level, _rms = 0) => {
        handleVolumeFeedback(level);
      }
    });

    let micStartOk = false;
    let micError = null;
    let deviceLabel = '';
    let selectedMime = '';

    try {
      await audioService.start(selectedDeviceId);
      micStartOk = true;
      deviceLabel = audioService.getDeviceLabel ? audioService.getDeviceLabel() : '';
      selectedMime = audioService.supportedMime || '';
    } catch (micErr) {
      micError = micErr.message || String(micErr);
      console.error('[Student] Error al iniciar captura de micrófono:', micErr);
    }

    // Unirse al canal de Realtime
    await supabaseService.joinSessionChannel(sessionCode, studentName, handleTeacherEvent);

    // Enviar telemetría de diagnóstico de micrófono al docente
    supabaseService.sendMicStatus({
      ok: micStartOk,
      error: micError,
      deviceLabel,
      mimeType: selectedMime
    });

    // Cambiar a la vista de sesión
    displayRoomCode.textContent = `SALA: ${sessionCode}`;
    joinScreen.classList.remove('active');
    sessionScreen.classList.add('active');
    visualizerContainer.classList.add('recording');

    // 1. Si la sesión ya estaba activa en Supabase al unirse:
    if (isAlreadyActive) {
      console.log('[Student] La sesión ya se encuentra ACTIVA en Supabase al unirse. Pasando UI a estado en curso...');
      sessionStatusBadge.textContent = 'Sesión en Curso';
      sessionStatusBadge.className = 'badge badge-active';
      micStatusLabel.textContent = micStartOk ? 'Micrófono Activo' : 'Micrófono con Error';
      micStatusSub.textContent = micStartOk
        ? 'Sesión iniciada previamente. Habla con naturalidad, tu audio se transmite a tu profesor.'
        : `Atención: No se pudo activar el micrófono (${micError || 'Sin permisos'}).`;
    } else {
      sessionStatusBadge.textContent = 'En Espera del Profesor';
      sessionStatusBadge.className = 'badge badge-waiting';
      micStatusLabel.textContent = micStartOk ? 'Micrófono Activo (En Espera)' : 'Micrófono con Error';
      micStatusSub.textContent = micStartOk
        ? 'El micrófono está listo. Tu profesor iniciará la sesión en breve.'
        : `Atención: No se pudo activar el micrófono (${micError || 'Sin permisos'}).`;
    }

    // Inicializar medidor en sesión activa
    if (sessionVuMeterLevel) {
      sessionVuMeterLevel.style.width = '0%';
      sessionVuMeterLevel.classList.remove('muted');
    }
    if (sessionVuMeterLabel) {
      sessionVuMeterLabel.textContent = micStartOk ? 'Señal de micrófono activa' : 'Sin señal de micrófono';
      sessionVuMeterLabel.classList.remove('muted', 'active');
    }

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
btnToggleMute.addEventListener('click', async () => {
  if (!audioService) return;

  const isMuted = await audioService.toggleMute();
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
    micStatusCircle.style.transform = 'scale(1)';

    // Forzar visualmente el medidor VU a 0% e inactivo/gris
    if (sessionVuMeterLevel) {
      sessionVuMeterLevel.style.width = '0%';
      sessionVuMeterLevel.classList.add('muted');
    }
    if (sessionVuMeterLabel) {
      sessionVuMeterLabel.textContent = 'Micrófono en Mute (Señal desactivada)';
      sessionVuMeterLabel.classList.add('muted');
      sessionVuMeterLabel.classList.remove('active');
    }
  } else {
    btnToggleMute.classList.remove('muted');
    muteButtonText.textContent = 'Silenciar';
    micStatusCircle.classList.remove('muted');
    iconMicOn.classList.remove('hidden');
    iconMicOff.classList.add('hidden');
    visualizerContainer.classList.remove('muted');
    micStatusLabel.textContent = 'Micrófono Activo';
    micStatusSub.textContent = 'Habla con naturalidad. Tu audio se transmite a tu profesor.';

    // Restaurar estado activo del medidor VU
    if (sessionVuMeterLevel) {
      sessionVuMeterLevel.classList.remove('muted');
    }
    if (sessionVuMeterLabel) {
      sessionVuMeterLabel.textContent = 'Señal de micrófono activa';
      sessionVuMeterLabel.classList.remove('muted');
    }
  }
});

// 4. Salir de la sesión
btnLeaveSession.addEventListener('click', async () => {
  if (confirm('¿Deseas salir de la sesión?')) {
    await cleanupSession();
  }
});

// 5. Manejo de eventos del docente recibidos vía Realtime
async function handleTeacherEvent(eventType, payload) {
  if (eventType === 'session_start') {
    sessionStatusBadge.textContent = 'Sesión en Curso';
    sessionStatusBadge.className = 'badge badge-active';
    if (audioService && audioService.isActive) {
      micStatusLabel.textContent = 'Micrófono Activo';
      micStatusSub.textContent = 'Habla con naturalidad. Tu audio se transmite a tu profesor.';
    } else if (audioService && !audioService.isActive) {
      try {
        await audioService.start(selectedDeviceId);
        micStatusLabel.textContent = 'Micrófono Activo';
        micStatusSub.textContent = 'Habla con naturalidad. Tu audio se transmite a tu profesor.';
        if (supabaseService) {
          supabaseService.sendMicStatus({
            ok: true,
            deviceLabel: audioService.getDeviceLabel ? audioService.getDeviceLabel() : '',
            mimeType: audioService.supportedMime || ''
          });
        }
      } catch (err) {
        micStatusLabel.textContent = 'Error de Micrófono';
        micStatusSub.textContent = `No se pudo activar el micrófono (${err.message || err}).`;
        if (supabaseService) {
          supabaseService.sendMicStatus({
            ok: false,
            error: err.message || String(err)
          });
        }
      }
    }
  } else if (eventType === 'session_end') {
    sessionStatusBadge.textContent = 'Sesión Finalizada';
    sessionStatusBadge.className = 'badge badge-ended';
    micStatusLabel.textContent = 'Tiempo Terminado';
    micStatusSub.textContent = 'La sesión oral ha concluido. ¡Buen trabajo!';
    if (audioService) {
      await audioService.stop();
    }
    if (supabaseService) {
      await supabaseService.waitForPendingUploads(10000);
    }
    visualizerContainer.classList.remove('recording');
  } else if (eventType === 'guided_correction') {
    handleGuidedCorrectionEvent(payload);
  } else if (eventType === 'micro_exercise') {
    handleMicroExerciseEvent(payload);
  } else if (eventType === 'model_speech') {
    handleModelSpeechEvent(payload);
  }
}

// 5.1 Manejador de Autocorrección Guiada en tiempo real
function handleGuidedCorrectionEvent(payload) {
  if (!payload || !payload.action) return;

  if (payload.action === 'show_prompt') {
    // Si hubiera un ejercicio activo o discurso modelo, ocultarlo para priorizar la autocorrección guiada
    if (exerciseModal) {
      exerciseModal.classList.add('hidden');
    }
    if (modelSpeechModal) {
      modelSpeechModal.classList.add('hidden');
    }

    // Guardar cápsula contrastiva pero mantenerla OCULTA hasta que el docente presione "Revelar"
    currentGuidedCapsule = payload.contrastiveCapsule || null;
    if (guidedCapsuleContainer) {
      guidedCapsuleContainer.classList.add('hidden');
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

    // Revelar Cápsula Contrastiva si está disponible (exclusiva para Grammar, Vocabulary, C1 Upgrade)
    const cap = payload.contrastiveCapsule || currentGuidedCapsule;
    if (cap && cap.poleA && cap.poleB && guidedCapsuleContainer) {
      if (guidedPoleALabel) guidedPoleALabel.textContent = cap.poleA.label || 'Form A';
      if (guidedPoleARule) guidedPoleARule.textContent = cap.poleA.rule || '';
      if (guidedPoleAExample) guidedPoleAExample.textContent = cap.poleA.example ? `"${cap.poleA.example}"` : '';

      if (guidedPoleBLabel) guidedPoleBLabel.textContent = cap.poleB.label || 'Form B (Target)';
      if (guidedPoleBRule) guidedPoleBRule.textContent = cap.poleB.rule || '';
      if (guidedPoleBExample) guidedPoleBExample.textContent = cap.poleB.example ? `"${cap.poleB.example}"` : '';

      guidedCapsuleContainer.classList.remove('hidden');
    } else if (guidedCapsuleContainer) {
      guidedCapsuleContainer.classList.add('hidden');
    }

    guidedSolutionContainer.classList.remove('hidden');
    guidedModal.classList.remove('hidden');
  } else if (payload.action === 'hide') {
    guidedModal.classList.add('hidden');
    guidedSolutionContainer.classList.add('hidden');
    if (guidedCapsuleContainer) {
      guidedCapsuleContainer.classList.add('hidden');
    }
    currentGuidedCapsule = null;
  }
}

// 5.2 Manejador de Discurso Modelo (Reformulación Completa) en tiempo real
function handleModelSpeechEvent(payload) {
  console.log('[ModelSpeech] Recibido en alumno:', payload);
  if (!payload || !payload.action) return;

  if (payload.action === 'show' || payload.action === 'show_model_speech') {
    // Ocultar otros modales si estuvieran abiertos
    if (guidedModal) {
      guidedModal.classList.add('hidden');
      guidedSolutionContainer.classList.add('hidden');
    }
    if (exerciseModal) {
      exerciseModal.classList.add('hidden');
      exerciseFeedbackContainer.classList.add('hidden');
    }

    const model = payload.modelSpeech;
    if (!model) return;

    if (studentModelNaturalCorrected) {
      studentModelNaturalCorrected.textContent = model.naturalCorrected || '';
    }
    if (studentModelTargetUpgrade) {
      studentModelTargetUpgrade.textContent = model.targetUpgrade || '';
    }
    if (studentModelImprovementsList) {
      studentModelImprovementsList.innerHTML = '';
      const improvements = Array.isArray(model.keyImprovements) ? model.keyImprovements : [];
      if (improvements.length > 0) {
        improvements.forEach(item => {
          const li = document.createElement('li');
          li.style.display = 'flex';
          li.style.alignItems = 'flex-start';
          li.style.gap = '8px';
          li.style.fontSize = '0.85rem';
          li.style.color = '#c9d1d9';
          li.innerHTML = `<span style="color: #58a6ff; font-weight: bold;">•</span><span>${escapeHtml(item)}</span>`;
          studentModelImprovementsList.appendChild(li);
        });
        if (studentModelImprovementsBox) studentModelImprovementsBox.style.display = 'block';
      } else {
        if (studentModelImprovementsBox) studentModelImprovementsBox.style.display = 'none';
      }
    }

    if (modelSpeechModal) {
      modelSpeechModal.classList.remove('hidden');
    }
  } else if (payload.action === 'hide' || payload.action === 'hide_model_speech') {
    if (modelSpeechModal) {
      modelSpeechModal.classList.add('hidden');
    }
  }
}

// 5.2 Manejador de Micro-Ejercicios Interactivos con IA en tiempo real
function handleMicroExerciseEvent(payload) {
  if (!payload || !payload.action) return;

  if (payload.action === 'show_exercise') {
    currentStudentExercise = payload;

    // Cerrar modal de autocorrección guiada o discurso modelo si estuvieran abiertos
    if (guidedModal) {
      guidedModal.classList.add('hidden');
      guidedSolutionContainer.classList.add('hidden');
    }
    if (modelSpeechModal) {
      modelSpeechModal.classList.add('hidden');
    }

    // 0. Renderizar Cápsula Contrastiva si está presente (Grammar, Vocabulary, C1 Upgrade)
    const capsuleBox = document.getElementById('exercise-capsule-container');
    const poleALabel = document.getElementById('capsule-pole-a-label');
    const poleARule = document.getElementById('capsule-pole-a-rule');
    const poleAExample = document.getElementById('capsule-pole-a-example');
    const poleBLabel = document.getElementById('capsule-pole-b-label');
    const poleBRule = document.getElementById('capsule-pole-b-rule');
    const poleBExample = document.getElementById('capsule-pole-b-example');

    const cap = payload.contrastiveCapsule;
    if (cap && cap.poleA && cap.poleB && capsuleBox) {
      if (poleALabel) poleALabel.textContent = cap.poleA.label || 'Form A';
      if (poleARule) poleARule.textContent = cap.poleA.rule || '';
      if (poleAExample) poleAExample.textContent = cap.poleA.example ? `"${cap.poleA.example}"` : '';

      if (poleBLabel) poleBLabel.textContent = cap.poleB.label || 'Form B (Target)';
      if (poleBRule) poleBRule.textContent = cap.poleB.rule || '';
      if (poleBExample) poleBExample.textContent = cap.poleB.example ? `"${cap.poleB.example}"` : '';

      capsuleBox.classList.remove('hidden');
    } else if (capsuleBox) {
      capsuleBox.classList.add('hidden');
    }

    // 1. Badge de Categoría y Polaridad
    const cat = (payload.category || 'grammar').toLowerCase();
    exerciseCategoryBadge.textContent = CATEGORY_NAMES[cat] || payload.category || 'Practice';
    exerciseCategoryBadge.className = `guided-badge cat-${cat}`;

    if (exercisePolarityTag) {
      const isContrast = payload.contrastPolarity === 'contrast' || payload.targetPole === 'A';
      exercisePolarityTag.className = `exercise-polarity-tag ${isContrast ? 'polarity-contrast' : 'polarity-target'}`;
      exercisePolarityTag.textContent = isContrast ? '⚖️ Contrast (Form A)' : '🎯 Target (Form B)';
    }

    // 2. Instrucción breve
    exerciseInstructionText.textContent = payload.instruction || 'Choose the best option to complete the sentence:';

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
    exerciseFeedbackTitle.textContent = 'Excellent! Correct Option';
    exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
  } else {
    clickedBtn.classList.add('option-wrong');
    if (correctBtn) correctBtn.classList.add('option-correct');
    exerciseFeedbackTitle.textContent = 'Incorrect Answer';
    exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
  }

  exerciseFeedbackSolution.innerHTML = `Correct option: <strong>${exercise.options[exercise.correctIndex]}</strong>`;
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
    exerciseFeedbackTitle.textContent = 'Excellent! You identified the error.';
    exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
  } else {
    clickedBtn.classList.add('option-wrong');
    if (errorTargetBtn) errorTargetBtn.classList.add('option-correct');
    exerciseFeedbackTitle.textContent = 'Incorrect Attempt';
    exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
  }

  exerciseFeedbackSolution.innerHTML = `Segment correction: <strong>${exercise.correctedSegment}</strong>`;
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
  btnSubmitExercise.textContent = 'Submit Answer';
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
    exerciseFeedbackTitle.textContent = 'Brilliant! Correct transformation.';
    exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
  } else {
    exerciseFeedbackTitle.textContent = 'Incorrect Attempt';
    exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
  }

  exerciseFeedbackSolution.innerHTML = `Model answer: <strong>${currentStudentExercise.idealAnswer}</strong>`;
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
    btnSubmitCorrection.textContent = 'Submit Correction';
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
      exerciseFeedbackTitle.textContent = 'Excellent! Accurate grammatical correction.';
      exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
    } else {
      exerciseFeedbackTitle.textContent = 'Incorrect Attempt';
      exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
    }

    exerciseFeedbackSolution.innerHTML = `Expected correction: <strong>${currentStudentExercise.idealAnswer}</strong>`;
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
    exerciseUnscrambleResult.textContent = 'Click the blocks in order...';
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
    exerciseUnscrambleResult.textContent = 'Click the blocks in order...';
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
      exerciseFeedbackTitle.textContent = 'Perfect! You ordered the sentence correctly.';
      exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
    } else {
      exerciseFeedbackTitle.textContent = 'Incorrect Word Order';
      exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
    }

    exerciseFeedbackSolution.innerHTML = `Correct sentence: <strong>${currentStudentExercise.correctSentence}</strong>`;
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
    btnSubmitCloze.textContent = 'Check Answer';
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
      exerciseFeedbackTitle.textContent = 'Correct! Precise word identified.';
      exerciseFeedbackTitle.className = 'exercise-feedback-title correct';
    } else {
      exerciseFeedbackTitle.textContent = 'Incorrect Word';
      exerciseFeedbackTitle.className = 'exercise-feedback-title incorrect';
    }

    exerciseFeedbackSolution.innerHTML = `Correct word: <strong>${currentStudentExercise.idealAnswer}</strong>`;
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

if (btnCloseModelSpeechModal) {
  btnCloseModelSpeechModal.addEventListener('click', () => {
    if (modelSpeechModal) {
      modelSpeechModal.classList.add('hidden');
    }
  });
}

// 7. Retroalimentación visual en tiempo real basada en volumen (VU meter y círculo central)
function handleVolumeFeedback(level) {
  if (!audioService || audioService.isMuted) {
    if (sessionVuMeterLevel) {
      sessionVuMeterLevel.style.width = '0%';
    }
    micStatusCircle.style.transform = 'scale(1)';
    return;
  }

  // Normalizar nivel (0 - 100%) idéntico al monitor de prueba de micrófono previo
  const pct = Math.min(Math.round((level / 60) * 100), 100);

  if (sessionVuMeterLevel) {
    sessionVuMeterLevel.style.width = `${pct}%`;
    sessionVuMeterLevel.classList.remove('muted');
  }

  if (sessionVuMeterLabel) {
    sessionVuMeterLabel.classList.remove('muted');
    if (pct > 8) {
      sessionVuMeterLabel.textContent = '¡Captando voz! Señal clara';
      sessionVuMeterLabel.classList.add('active');
    } else {
      sessionVuMeterLabel.textContent = 'Señal de micrófono activa';
      sessionVuMeterLabel.classList.remove('active');
    }
  }

  // level oscila típicamente entre 0 y 120 para voz hablada
  const scale = Math.min(1.0 + (level / 150), 1.3);
  micStatusCircle.style.transform = `scale(${scale})`;
}

// 8. Limpieza al salir o recargar la página
async function cleanupSession() {
  if (sessionVuMeterLevel) {
    sessionVuMeterLevel.style.width = '0%';
  }
  if (activePreviewMonitor) {
    activePreviewMonitor.stop();
    activePreviewMonitor = null;
  }
  if (audioService) {
    await audioService.stop();
    audioService = null;
  }
  if (supabaseService) {
    await supabaseService.waitForPendingUploads(10000);
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
  if (modelSpeechModal) {
    modelSpeechModal.classList.add('hidden');
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

