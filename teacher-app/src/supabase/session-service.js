/**
 * Servicio de Sesión en Tiempo Real (Puente Docente <-> Supabase)
 * Gestiona la sincronización en la nube, escucha canales de Realtime Broadcast
 * y acumula los fragmentos de audio para disparar el motor de análisis IELTS.
 */

const WebSocket = require('ws');
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const os = require('os');
const speechCleaner = require('../ai/speech-cleaner');
const ieltsEngine = require('../ai/ielts-engine');
const geminiService = require('../ai/gemini-service');

class TeacherSessionService {
  constructor() {
    this.client = null;
    this.channel = null;
    this.currentSession = null;
    this.audioChunks = []; // Acumulador de chunks Base64 recibidos del alumno
    this.eventListeners = {
      onStudentJoined: () => {},
      onAudioChunk: () => {},
      onMuteChange: () => {},
      onStudentLeft: () => {},
      onMicroExerciseAnswer: () => {}
    };

    this.initClient();
  }

  /**
   * Inicializa el cliente de Supabase con variables de entorno o configuración local
   */
  initClient() {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.error('[Supabase Session] ERROR: Variables SUPABASE_URL o claves no encontradas en .env');
      return;
    }

    try {
      this.client = createClient(url, key, {
        realtime: {
          transport: WebSocket,
          params: { eventsPerSecond: 10 }
        }
      });
      console.log('[Supabase Session] Cliente inicializado correctamente con soporte WebSocket.');
    } catch (err) {
      console.error('[Supabase Session] No se pudo inicializar cliente de Supabase:', err.message);
    }
  }

  /**
   * Configura callbacks para notificar al proceso principal / renderizador
   */
  setListeners(listeners = {}) {
    this.eventListeners = { ...this.eventListeners, ...listeners };
  }

  /**
   * Prepara la sala en Supabase en modo espera ('waiting') y suscribe el canal Realtime
   * de inmediato para que el alumno pueda unirse antes de que el docente pulse Iniciar Sesión.
   */
  async initRoom({ sessionCode, studentName, studentLevel = 'B1', durationMinutes = 10 }) {
    if (!this.client) {
      this.initClient();
    }

    const code = sessionCode.toUpperCase().trim();
    this.currentSession = {
      sessionCode: code,
      studentName: studentName || 'Estudiante',
      studentLevel,
      durationMinutes,
      status: 'waiting',
      startedAt: null
    };

    this.audioChunks = [];

    // 1. Sincronizar en la tabla 'sessions' con estado 'waiting'
    if (this.client) {
      try {
        console.log('[Supabase Session] Registrando sala en espera:', { sessionCode: code });
        const { error } = await this.client
          .from('sessions')
          .upsert({
            session_code: code,
            student_name: this.currentSession.studentName,
            student_level: this.currentSession.studentLevel,
            duration_minutes: this.currentSession.durationMinutes,
            status: 'waiting',
            started_at: new Date().toISOString()
          }, { onConflict: 'session_code' });

        if (error) {
          console.warn('[Supabase Session] Advertencia al registrar sala en espera:', error.message);
        } else {
          console.log('[Supabase Session] Sala en espera registrada exitosamente:', code);
        }
      } catch (err) {
        console.warn('[Supabase Session] Error registrando sala en espera:', err.message);
      }
    }

    // 2. Suscribir al canal de Realtime para escuchar eventos del estudiante antes del inicio
    const channelName = `session:${code}`;
    if (this.client) {
      // Si ya está suscrito a este mismo canal, conservarlo
      if (this.channel && this.channel.topic === `realtime:${channelName}`) {
        console.log('[Supabase Realtime] Canal en espera ya conectado:', channelName);
        return { success: true, sessionCode: code };
      }

      if (this.channel) {
        try {
          this.client.removeChannel(this.channel);
        } catch (_) {}
        this.channel = null;
      }

      this.channel = this.client.channel(channelName, {
        config: { broadcast: { self: false } }
      });

      this.channel
        .on('broadcast', { event: 'student:joined' }, (payload) => {
          console.log('[Supabase Realtime] Alumno conectado a sala en espera:', payload.payload);
          this.eventListeners.onStudentJoined(payload.payload);
        })
        .on('broadcast', { event: 'student:audio_chunk' }, (payload) => {
          const chunkData = payload.payload;
          if (chunkData && chunkData.data) {
            this.audioChunks.push(chunkData);
            this.eventListeners.onAudioChunk({
              sequence: chunkData.sequence,
              totalChunks: this.audioChunks.length,
              mimeType: chunkData.mimeType
            });
          }
        })
        .on('broadcast', { event: 'student:mute_change' }, (payload) => {
          console.log('[Supabase Realtime] Cambio de Mute:', payload.payload);
          this.eventListeners.onMuteChange(payload.payload);
        })
        .on('broadcast', { event: 'student:left' }, (payload) => {
          console.log('[Supabase Realtime] Alumno abandonó la sala en espera');
          this.eventListeners.onStudentLeft(payload.payload);
        })
        .on('broadcast', { event: 'micro_exercise_answer' }, (payload) => {
          console.log('[Supabase Realtime] Respuesta de alumno recibida:', payload.payload);
          this.eventListeners.onMicroExerciseAnswer(payload.payload);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[Supabase Realtime] Canal en espera listo y suscrito a ${channelName}`);
          }
        });
    }

    return { success: true, sessionCode: code };
  }

  /**
   * Crea o actualiza la sesión en Supabase y suscribe al canal de Broadcast.
   */
  async startSession({ sessionCode, studentName, studentLevel = 'B1', durationMinutes = 10 }) {
    if (!this.client) {
      this.initClient();
    }

    const code = sessionCode.toUpperCase().trim();
    this.currentSession = {
      sessionCode: code,
      studentName: studentName || 'Estudiante',
      studentLevel,
      durationMinutes,
      status: 'active',
      startedAt: Date.now()
    };

    this.audioChunks = [];

    // 1. Sincronizar en la tabla 'sessions' de Supabase con status 'active'
    if (this.client) {
      try {
        console.log('[Supabase] Activando sesión:', { 
          sessionCode: this.currentSession.sessionCode, 
          studentLevel: this.currentSession.studentLevel, 
          durationMinutes: this.currentSession.durationMinutes 
        });

        const { data, error } = await this.client
          .from('sessions')
          .upsert({
            session_code: this.currentSession.sessionCode,
            student_name: this.currentSession.studentName,
            student_level: this.currentSession.studentLevel,
            duration_minutes: this.currentSession.durationMinutes,
            status: 'active',
            started_at: new Date().toISOString()
          }, { onConflict: 'session_code' })
          .select();

        if (error) {
          console.error('[Supabase ERROR detallado]:', JSON.stringify(error, null, 2));
          throw new Error(error.message || error.details || error.hint || 'Error al guardar en Supabase');
        } else {
          console.log('[Supabase ÉXITO] Sesión activa guardada:', data);
        }
      } catch (err) {
        console.error('[Supabase ERROR al guardar sesión]:', err.message);
        throw (err instanceof Error) ? err : new Error(err.message || JSON.stringify(err));
      }
    } else {
      const errorMsg = 'Cliente de Supabase no configurado o sin conexión a la URL del proyecto.';
      console.error('[Supabase ERROR]', errorMsg);
      throw new Error(errorMsg);
    }

    const channelName = `session:${this.currentSession.sessionCode}`;

    // Función auxiliar para emitir teacher:session_start al estudiante
    const emitSessionStart = () => {
      if (this.channel) {
        this.channel.send({
          type: 'broadcast',
          event: 'teacher:session_start',
          payload: {
            durationMinutes,
            startedAt: this.currentSession.startedAt
          }
        });
        console.log(`[Supabase Realtime] Evento teacher:session_start emitido a ${channelName}`);
      }
    };

    // 2. Si el canal ya está suscrito exactamente a este channelName (modo espera previo), REUTILIZARLO
    if (this.channel && this.channel.topic === `realtime:${channelName}`) {
      console.log('[Supabase Realtime] Reutilizando canal en espera ya conectado:', channelName);
      emitSessionStart();
      return { success: true, sessionCode: this.currentSession.sessionCode };
    }

    // Si es un canal distinto, limpiar el anterior y suscribir el nuevo
    if (this.client) {
      if (this.channel) {
        try {
          console.log('[Supabase Realtime] Limpiando pantalla del alumno y canal previo...');
          await this.channel.send({
            type: 'broadcast',
            event: 'guided_correction',
            payload: { action: 'hide' }
          });
          await this.channel.send({
            type: 'broadcast',
            event: 'micro_exercise',
            payload: { action: 'hide_exercise' }
          });
          this.client.removeChannel(this.channel);
        } catch (chanErr) {
          console.warn('[Supabase Realtime] Canal anterior limpiado:', chanErr.message);
        }
        this.channel = null;
      }

      this.channel = this.client.channel(channelName, {
        config: { broadcast: { self: false } }
      });

      this.channel
        .on('broadcast', { event: 'student:joined' }, (payload) => {
          console.log('[Supabase Realtime] Alumno conectado:', payload.payload);
          this.eventListeners.onStudentJoined(payload.payload);
        })
        .on('broadcast', { event: 'student:audio_chunk' }, (payload) => {
          const chunkData = payload.payload;
          if (chunkData && chunkData.data) {
            this.audioChunks.push(chunkData);
            this.eventListeners.onAudioChunk({
              sequence: chunkData.sequence,
              totalChunks: this.audioChunks.length,
              mimeType: chunkData.mimeType
            });
          }
        })
        .on('broadcast', { event: 'student:mute_change' }, (payload) => {
          console.log('[Supabase Realtime] Cambio de Mute:', payload.payload);
          this.eventListeners.onMuteChange(payload.payload);
        })
        .on('broadcast', { event: 'student:left' }, (payload) => {
          console.log('[Supabase Realtime] Alumno abandonó la sala');
          this.eventListeners.onStudentLeft(payload.payload);
        })
        .on('broadcast', { event: 'micro_exercise_answer' }, (payload) => {
          console.log('[Supabase Realtime] Respuesta de alumno recibida:', payload.payload);
          this.eventListeners.onMicroExerciseAnswer(payload.payload);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[Supabase Realtime] Docente suscrito exitosamente a ${channelName}`);
            emitSessionStart();
          }
        });
    }

    return { success: true, sessionCode: this.currentSession.sessionCode };
  }

  /**
   * Finaliza la sesión, emite teacher:session_end, espera el vaciado (flush)
   * del último fragmento de audio del alumno y procesa el audio acumulado.
   */
  async stopSession(reason = 'teacher_stopped') {
    if (!this.currentSession) return null;

    // 1. Notificar al estudiante vía Realtime para que detenga la captura y transmita el último chunk
    if (this.channel) {
      try {
        console.log('[Supabase Realtime] Notificando teacher:session_end al estudiante...');
        await this.channel.send({
          type: 'broadcast',
          event: 'teacher:session_end',
          payload: { reason, timestamp: Date.now() }
        });
      } catch (err) {
        console.warn('[Supabase Realtime] Error al emitir teacher:session_end:', err.message);
      }
    }

    // 2. Margen de espera (1400 ms) para recibir el último chunk transmitido (flush) por el alumno
    console.log('[Audio Pipeline] Margen de espera (1400ms) para vaciado (flush) del último chunk de audio...');
    await new Promise((resolve) => setTimeout(resolve, 1400));
    console.log(`[Audio Pipeline] Vaciado completado. Total de chunks recibidos en sesión: ${this.audioChunks.length}`);

    // Mantener el canal de Realtime abierto para permitir la Autocorrección Guiada post-sesión
    console.log('[Supabase Realtime] Canal activo conservado para interacción de Autocorrección Guiada.');

    // 3. Actualizar estado en la tabla 'sessions' de Supabase
    if (this.client) {
      try {
        await this.client
          .from('sessions')
          .update({
            status: 'completed',
            ended_at: new Date().toISOString()
          })
          .eq('session_code', this.currentSession.sessionCode);
      } catch (err) {
        console.warn('[Supabase Session] Error al actualizar estado completado:', err.message);
      }
    }

    // 4. Procesar y canalizar el audio recibido hacia la IA
    const sessionSummary = await this.processReceivedAudioSession();
    this.currentSession = null;
    return sessionSummary;
  }

  /**
   * Procesa los chunks recibidos: ensambla audio, limpia transcripciones
   * y genera las tarjetas quirúrgicas evaluadas con la rúbrica IELTS.
   */
  async processReceivedAudioSession() {
    const chunkCount = this.audioChunks.length;
    const studentLevel = this.currentSession?.studentLevel || 'B1';
    console.log(`[Audio Pipeline] Procesando ${chunkCount} fragmentos de audio recibidos...`);

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    console.log('[GEMINI] Clave encontrada:', !!apiKey, 'Longitud:', apiKey ? apiKey.length : 0);

    let rawStudentSpeech = '';

    // 1. Si hay chunks transmitidos, concatenar los buffers WebM secuencialmente
    if (this.audioChunks.length > 0) {
      try {
        const sortedChunks = [...this.audioChunks].sort((a, b) => a.sequence - b.sequence);
        const buffers = sortedChunks.map(c => Buffer.from(c.data, 'base64'));
        const fullAudioBuffer = Buffer.concat(buffers);
        const mimeType = (sortedChunks[0]?.mimeType || 'audio/webm').split(';')[0];
        console.log(`[Audio Pipeline] Concatenados ${sortedChunks.length} fragmentos en un archivo de audio unificado de ${fullAudioBuffer.length} bytes (${mimeType})`);

        // Diagnóstico auditivo: guardar archivo de audio en la carpeta temp de Electron
        let tempDir = os.tmpdir();
        try {
          const electron = require('electron');
          const electronApp = electron.app || electron.remote?.app;
          if (electronApp && typeof electronApp.getPath === 'function') {
            tempDir = electronApp.getPath('temp');
          }
        } catch (_) {}

        const debugAudioPath = path.join(tempDir, 'last_session_debug.webm');
        try {
          fs.writeFileSync(debugAudioPath, fullAudioBuffer);
          console.log(`[Audio Pipeline] 🎙️ Audio de sesión guardado para diagnóstico en: ${debugAudioPath} (${fullAudioBuffer.length} bytes)`);
        } catch (fsErr) {
          console.warn('[Audio Pipeline] No se pudo escribir last_session_debug.webm:', fsErr.message);
        }

        if (apiKey) {
          console.log('[Audio Pipeline] Enviando audio real a Gemini para transcripción verbatim...');
          rawStudentSpeech = await geminiService.transcribeAudio(fullAudioBuffer, mimeType);
          console.log('[Audio Pipeline] Transcripción cruda obtenida de Gemini:', rawStudentSpeech);
        } else {
          console.warn('[Audio Pipeline] No se detectó GEMINI_API_KEY ni GOOGLE_API_KEY en variables de entorno.');
        }
      } catch (err) {
        console.error('[GEMINI ERROR DETALLADO]:', err);
      }
    } else {
      console.warn('[Audio Pipeline] No se recibieron fragmentos de audio en esta sesión.');
    }

    // Si la transcripción fue nula, vacía o no hubo audio
    if (!rawStudentSpeech || rawStudentSpeech.trim() === '' || rawStudentSpeech.includes('[No speech detected]') || rawStudentSpeech.toUpperCase().includes('[SILENCE]')) {
      if (!apiKey && this.audioChunks.length === 0) {
        console.log('[Audio Pipeline] Sin API key ni audio. Utilizando muestra representativa para visualización de prueba.');
        rawStudentSpeech = "well, um, last year I, I needs to travel for my job, but the flight was cancelled and I, I loose all the days waiting in the airport, you know?";
      } else {
        console.log('[Audio Pipeline] Sin voz audible detectada o transcripción vacía (silencio/ruido de fondo).');
        rawStudentSpeech = "";
      }
    }

    // 2. Transcripción 100% literal (Verbatim): sin filtros ni alteración de muletillas
    const verbatimStudentSpeech = speechCleaner.cleanText(rawStudentSpeech);
    console.log('[Audio Pipeline] Transcripción Verbatim para Panel y Evaluación:', verbatimStudentSpeech);

    // Diálogo completo literal para el panel izquierdo
    const teacherContext = (this.currentSession?.teacherContext || '').trim();
    const cleanDialogueTurns = [];
    if (teacherContext) {
      cleanDialogueTurns.push({
        speaker: 'Profesor',
        text: teacherContext
      });
    }
    cleanDialogueTurns.push({
      speaker: 'Estudiante',
      text: verbatimStudentSpeech
    });

    // 3. Evaluación contra rúbricas IELTS para las 5 pestañas maestras (directo con texto verbatim)
    const feedbackCards = await ieltsEngine.evaluateUtterance({
      teacherContext,
      studentUtterance: verbatimStudentSpeech,
      studentLevel
    });

    console.log(`[Audio Pipeline] Evaluación completada. ${feedbackCards.length} tarjetas quirúrgicas generadas.`);

    return {
      chunkCount,
      cleanDialogueTurns,
      feedbackCards
    };
  }

  /**
   * Envía un evento broadcast 'guided_correction' al canal activo de la sala
   * para la función de Autocorrección Guiada en student-web.
   */
  async broadcastGuidedCorrection(payload = {}) {
    const sessionCode = (payload.sessionCode || this.currentSession?.sessionCode || '').toUpperCase().trim();
    if (!sessionCode) {
      console.warn('[Supabase Realtime] No hay sessionCode para broadcastGuidedCorrection');
      return { success: false, error: 'No active session code' };
    }

    if (!this.client) {
      this.initClient();
    }

    // Si el canal no está inicializado o fue cerrado, reconectar a la sala
    if (!this.channel && this.client) {
      const channelName = `session:${sessionCode}`;
      console.log(`[Supabase Realtime] Suscribiendo al canal ${channelName} para broadcastGuidedCorrection...`);
      this.channel = this.client.channel(channelName, {
        config: { broadcast: { self: false } }
      });
      await new Promise((resolve) => {
        this.channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
        setTimeout(resolve, 1500);
      });
    }

    if (!this.channel) {
      return { success: false, error: 'No channel available' };
    }

    try {
      console.log('[Supabase Realtime] Emitiendo guided_correction:', payload.action, payload.cardId);
      await this.channel.send({
        type: 'broadcast',
        event: 'guided_correction',
        payload
      });
      return { success: true };
    } catch (err) {
      console.error('[Supabase Realtime] Error emitiendo guided_correction:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Envía un evento broadcast 'micro_exercise' al canal activo de la sala
   * para la función de Micro-Ejercicios Interactivos en student-web.
   */
  async broadcastMicroExercise(payload = {}) {
    const sessionCode = (payload.sessionCode || this.currentSession?.sessionCode || '').toUpperCase().trim();
    if (!sessionCode) {
      console.warn('[Supabase Realtime] No hay sessionCode para broadcastMicroExercise');
      return { success: false, error: 'No active session code' };
    }

    if (!this.client) {
      this.initClient();
    }

    // Si el canal no está inicializado o fue cerrado, reconectar a la sala
    if (!this.channel && this.client) {
      const channelName = `session:${sessionCode}`;
      console.log(`[Supabase Realtime] Suscribiendo al canal ${channelName} para broadcastMicroExercise...`);
      this.channel = this.client.channel(channelName, {
        config: { broadcast: { self: false } }
      });
      this.channel.on('broadcast', { event: 'micro_exercise_answer' }, (p) => {
        console.log('[Supabase Realtime] Respuesta de alumno recibida:', p.payload);
        this.eventListeners.onMicroExerciseAnswer(p.payload);
      });
      await new Promise((resolve) => {
        this.channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
        setTimeout(resolve, 1500);
      });
    }

    if (!this.channel) {
      return { success: false, error: 'No channel available' };
    }

    try {
      console.log('[Supabase Realtime] Emitiendo micro_exercise:', payload.action, payload.exerciseId);
      await this.channel.send({
        type: 'broadcast',
        event: 'micro_exercise',
        payload
      });
      return { success: true };
    } catch (err) {
      console.error('[Supabase Realtime] Error emitiendo micro_exercise:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Cierra definitivamente el canal de Realtime limpiando antes la pantalla del alumno
   */
  async closeRoomDefinitively() {
    if (this.channel) {
      try {
        console.log('[Supabase Realtime] Cerrando sala definitivamente y limpiando pantalla del alumno...');
        await this.channel.send({
          type: 'broadcast',
          event: 'guided_correction',
          payload: { action: 'hide' }
        });
        await this.channel.send({
          type: 'broadcast',
          event: 'micro_exercise',
          payload: { action: 'hide_exercise' }
        });
        if (this.client) {
          await this.client.removeChannel(this.channel);
        }
      } catch (err) {
        console.warn('[Supabase Realtime] Error al cerrar sala:', err.message);
      }
      this.channel = null;
    }
    return { success: true };
  }
}

module.exports = new TeacherSessionService();

