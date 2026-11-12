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

// Instancias de servicios
const supabaseService = new StudentSupabaseService();
let audioService = null;

// 1. Leer parámetros URL si existen (ej. ?code=EFL-123)
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code') || params.get('session');
  if (codeParam) {
    sessionCodeInput.value = codeParam.toUpperCase().trim();
  }
});

// Auto-mayúsculas para el código de sesión
sessionCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

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

    // Inicializar captura de audio
    audioService = new AudioCaptureService({
      timeslice: 2000,
      onChunk: (base64Chunk, mimeType) => {
        supabaseService.sendAudioChunk(base64Chunk, mimeType);
      },
      onVolume: (level) => {
        handleVolumeFeedback(level);
      }
    });

    await audioService.start();

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
  }
}

// 6. Retroalimentación visual sutil basada en volumen
function handleVolumeFeedback(level) {
  if (!audioService || audioService.isMuted) return;
  // level oscila típicamente entre 0 y 120 para voz hablada
  const scale = Math.min(1.0 + (level / 150), 1.3);
  micStatusCircle.style.transform = `scale(${scale})`;
}

// 7. Limpieza al salir o recargar la página
async function cleanupSession() {
  if (audioService) {
    audioService.stop();
    audioService = null;
  }
  if (supabaseService) {
    await supabaseService.leave();
  }
  sessionScreen.classList.remove('active');
  joinScreen.classList.add('active');
  visualizerContainer.classList.remove('recording', 'muted');
}

window.addEventListener('beforeunload', () => {
  if (audioService) audioService.stop();
  if (supabaseService) supabaseService.leave();
});

