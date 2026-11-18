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
    this.lastCompletedSessionCode = '';
    this.audioChunks = []; // Historial de chunks/bloques recibidos
    this.transcriptionQueue = []; // Cola secuencial de bloques WebM para transcripción
    this.processedStoragePaths = new Set(); // Registro de rutas para evitar duplicados entre sesiones
    this.isProcessingQueue = false;
    this.sessionTranscript = ''; // Transcripción acumulada en vivo
    this.eventListeners = {
      onStudentJoined: () => {},
      onAudioChunk: () => {},
      onTranscriptSegment: () => {},
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
      this.ensureStorageBucket();
    } catch (err) {
      console.error('[Supabase Session] No se pudo inicializar cliente de Supabase:', err.message);
    }
  }

  /**
   * Intenta asegurar que el bucket público 'session-audio' exista en Supabase Storage.
   */
  async ensureStorageBucket() {
    if (!this.client || !this.client.storage) return;
    try {
      const { data: buckets } = await this.client.storage.listBuckets();
      const exists = buckets && buckets.some(b => b.name === 'session-audio');
      if (!exists) {
        console.log('[Supabase Storage] Creando bucket "session-audio"...');
        const { error } = await this.client.storage.createBucket('session-audio', {
          public: true,
          fileSizeLimit: 10485760 // 10MB
        });
        if (error) {
          console.warn('[Supabase Storage] Aviso al crear bucket session-audio:', error.message);
        } else {
          console.log('[Supabase Storage] Bucket session-audio creado con éxito.');
        }
      }
    } catch (err) {
      console.warn('[Supabase Storage] Verificación de bucket omitida:', err.message);
    }
  }

  /**
   * Procesa la notificación Realtime de un bloque WebM subido a Supabase Storage.
   */
  handleIncomingAudioStorageSegment(payload) {
    if (!payload || !payload.storagePath) return;

    const currentCode = (this.currentSession?.sessionCode || '').toUpperCase().trim();
    if (!currentCode) {
      console.warn('[Audio Pipeline] Descartando bloque Storage: no hay sesión activa ni sala registrada');
      return;
    }

    // Validar que el bloque pertenezca a la sesión actual
    const payloadCode = (payload.sessionCode || '').toUpperCase().trim();
    const storagePath = String(payload.storagePath || '');
    const pathPrefix = storagePath.split('/')[0].toUpperCase().trim();

    if (payloadCode && payloadCode !== currentCode) {
      console.warn(`[Audio Pipeline] 🚫 Ignorando bloque de sesión anterior: recibido ${payloadCode}, sesión actual ${currentCode}`);
      return;
    }

    if (pathPrefix && pathPrefix !== currentCode) {
      console.warn(`[Audio Pipeline] 🚫 Ignorando bloque de sesión anterior por prefijo de ruta: "${pathPrefix}", sesión actual "${currentCode}" (path: ${storagePath})`);
      return;
    }

    // Evitar procesamiento duplicado del mismo storagePath
    if (this.processedStoragePaths.has(storagePath)) {
      console.log(`[Audio Pipeline] ⏩ Omitiendo bloque ya registrado: ${storagePath}`);
      return;
    }
    this.processedStoragePaths.add(storagePath);

    const segmentMeta = {
      storagePath: payload.storagePath,
      sequence: payload.sequence || payload.segmentIndex || (this.audioChunks.length + 1),
      mimeType: payload.mimeType || 'audio/webm',
      size: payload.size || 0,
      fromStorage: true
    };

    console.log(`[Audio Pipeline] 📥 Bloque Storage recibido: seq=#${segmentMeta.sequence}, size=${segmentMeta.size} bytes, path=${segmentMeta.storagePath}, sessionStatus=${this.currentSession?.status || 'none'}`);

    this.audioChunks.push(segmentMeta);
    this.eventListeners.onAudioChunk({
      sequence: segmentMeta.sequence,
      totalChunks: this.audioChunks.length,
      mimeType: segmentMeta.mimeType
    });

    // Si la sesión está activa, encolar el bloque para descarga y transcripción en vivo
    if (this.currentSession && this.currentSession.status === 'active') {
      this.transcriptionQueue.push(segmentMeta);
      this.processTranscriptionQueue();
    } else {
      console.log(`[Audio Pipeline] ⏳ Bloque #${segmentMeta.sequence} conservado en memoria (esperando activación de sesión)`);
    }
  }

  /**
   * Procesa la llegada de un bloque WebM recibido como Base64 (fallback WebSocket).
   */
  handleIncomingAudioSegment(chunkData) {
    if (!chunkData || !chunkData.data) return;

    const currentCode = (this.currentSession?.sessionCode || '').toUpperCase().trim();
    if (!currentCode) {
      console.warn('[Audio Pipeline] Descartando bloque Base64: no hay sesión activa ni sala registrada');
      return;
    }

    const chunkCode = (chunkData.sessionCode || '').toUpperCase().trim();
    if (chunkCode && chunkCode !== currentCode) {
      console.warn(`[Audio Pipeline] 🚫 Ignorando bloque Base64 de sesión anterior: recibido ${chunkCode}, sesión actual ${currentCode}`);
      return;
    }

    const approxSize = chunkData.data ? Math.round(chunkData.data.length * 0.75) : 0;
    const segmentMeta = {
      data: chunkData.data,
      sequence: chunkData.sequence || (this.audioChunks.length + 1),
      mimeType: chunkData.mimeType || 'audio/webm',
      size: approxSize,
      fromStorage: false
    };

    console.log(`[Audio Pipeline] 📥 Bloque Base64 recibido: seq=#${segmentMeta.sequence}, size=~${approxSize} bytes, sessionStatus=${this.currentSession?.status || 'none'}`);

    this.audioChunks.push(segmentMeta);
    this.eventListeners.onAudioChunk({
      sequence: segmentMeta.sequence,
      totalChunks: this.audioChunks.length,
      mimeType: segmentMeta.mimeType
    });

    // Si la sesión está activa, encolar el bloque para transcripción secuencial en vivo
    if (this.currentSession && this.currentSession.status === 'active') {
      this.transcriptionQueue.push(segmentMeta);
      this.processTranscriptionQueue();
    } else {
      console.log(`[Audio Pipeline] ⏳ Bloque Base64 #${segmentMeta.sequence} conservado en memoria (esperando activación de sesión)`);
    }
  }

  /**
   * Cola secuencial de transcripción con Gemini para bloques WebM individuales.
   * Descarga desde Storage o usa Buffer de Base64, y limpia el archivo del bucket tras transcribir.
   */
  async processTranscriptionQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    while (this.transcriptionQueue.length > 0) {
      const segment = this.transcriptionQueue.shift();
      if (!segment) continue;

      try {
        let segmentBuffer = null;
        const mimeType = (segment.mimeType || 'audio/webm').split(';')[0];

        // 1. Obtener Buffer binario (desde Supabase Storage o desde Base64 de fallback)
        if (segment.fromStorage && segment.storagePath) {
          console.log(`[Audio Pipeline] Descargando bloque #${segment.sequence} desde Storage: ${segment.storagePath}...`);
          const { data: blobData, error: dlErr } = await this.client.storage
            .from('session-audio')
            .download(segment.storagePath);

          if (dlErr || !blobData) {
            console.error(`[Audio Pipeline] Error al descargar ${segment.storagePath}:`, dlErr ? dlErr.message : 'Blob vacío');
            continue;
          }

          const arrayBuffer = await blobData.arrayBuffer();
          segmentBuffer = Buffer.from(arrayBuffer);
        } else if (segment.data) {
          // Fallback Base64 por WebSocket
          segmentBuffer = Buffer.from(segment.data, 'base64');
        }

        if (!segmentBuffer || segmentBuffer.length === 0) {
          console.warn(`[Audio Pipeline] Segmento #${segment.sequence} sin datos binarios.`);
          if (segment.fromStorage && segment.storagePath && this.client) {
            this.client.storage.from('session-audio').remove([segment.storagePath]).catch(() => {});
          }
          continue;
        }

        // Guardia de tamaño mínimo en el servidor: descartar buffers menores a 8192 bytes (8 KB)
        // para evitar transcribir cabeceras WebM vacías o micro-ruidos
        if (segmentBuffer.length < 8192) {
          console.log(`[Audio Pipeline] ⏩ Segmento #${segment.sequence} omitido: tamaño insuficiente (${segmentBuffer.length} bytes < 8192 bytes / 8 KB).`);
          if (segment.fromStorage && segment.storagePath && this.client) {
            this.client.storage.from('session-audio').remove([segment.storagePath]).catch(() => {});
          }
          continue;
        }

        // 2. Guardar diagnóstico del último segmento recibido en la carpeta temp de Electron
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
          fs.writeFileSync(debugAudioPath, segmentBuffer);
          console.log(`[Audio Pipeline] 🎙️ Segmento #${segment.sequence} guardado para diagnóstico en: ${debugAudioPath} (${segmentBuffer.length} bytes, ${mimeType})`);
        } catch (fsErr) {
          console.warn('[Audio Pipeline] No se pudo escribir last_session_debug.webm:', fsErr.message);
        }

        // 3. Transcribir con Gemini si hay API Key disponible
        if (apiKey && segmentBuffer.length > 0) {
          console.log(`[Audio Pipeline] Transcribiendo bloque WebM #${segment.sequence} (${segmentBuffer.length} bytes, 24kbps) con Gemini...`);
          const rawSegmentText = await geminiService.transcribeAudio(segmentBuffer, mimeType);
          console.log(`[Audio Pipeline] Segmento #${segment.sequence} transcrito:`, rawSegmentText);

          if (rawSegmentText &&
              rawSegmentText.trim() !== '' &&
              !rawSegmentText.includes('[No speech detected]') &&
              !rawSegmentText.toUpperCase().includes('[SILENCE]')) {
            
            const cleanedSegment = speechCleaner.cleanText(rawSegmentText).trim();
            if (cleanedSegment) {
              this.sessionTranscript = (this.sessionTranscript ? `${this.sessionTranscript.trim()} ${cleanedSegment}` : cleanedSegment).trim();

              console.log(`[Audio Pipeline] Transcripción acumulada en vivo (Segmento #${segment.sequence}): "${this.sessionTranscript}"`);

              // Emitir inmediatamente al proceso de UI (renderer.js)
              if (typeof this.eventListeners.onTranscriptSegment === 'function') {
                this.eventListeners.onTranscriptSegment({
                  segmentText: cleanedSegment,
                  fullTranscript: this.sessionTranscript,
                  sequence: segment.sequence
                });
              }
            }
          }
        } else if (!apiKey) {
          console.warn('[Audio Pipeline] Falta GEMINI_API_KEY en variables de entorno.');
        }

        // 4. Limpieza automática: eliminar archivo de Supabase Storage inmediatamente tras transcribirlo
        if (segment.fromStorage && segment.storagePath && this.client) {
          try {
            console.log(`[Audio Pipeline] 🗑️ Eliminando archivo procesado de Storage: ${segment.storagePath}`);
            await this.client.storage.from('session-audio').remove([segment.storagePath]);
          } catch (rmErr) {
            console.warn(`[Audio Pipeline] Aviso al eliminar ${segment.storagePath}:`, rmErr.message);
          }
        }
      } catch (err) {
        console.error(`[Audio Pipeline] Error procesando segmento #${segment.sequence}:`, err.message);
      }
    }

    this.isProcessingQueue = false;
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
    this.transcriptionQueue = [];
    this.processedStoragePaths.clear();
    this.isProcessingQueue = false;
    this.sessionTranscript = '';

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
        .on('broadcast', { event: 'audio_segment_uploaded' }, (payload) => {
          console.log('[Supabase Realtime] Notificación audio_segment_uploaded recibida en espera:', payload.payload);
          this.handleIncomingAudioStorageSegment(payload.payload);
        })
        .on('broadcast', { event: 'student:audio_chunk' }, (payload) => {
          this.handleIncomingAudioSegment(payload.payload);
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
    const existingChunks = (this.audioChunks && this.audioChunks.length > 0) ? [...this.audioChunks] : [];

    this.currentSession = {
      sessionCode: code,
      studentName: studentName || 'Estudiante',
      studentLevel,
      durationMinutes,
      status: 'active',
      startedAt: Date.now()
    };

    // Limpieza obligatoria de estado para arranque limpio de sesión activa
    this.audioChunks = [];
    this.transcriptionQueue = [];
    this.processedStoragePaths.clear();
    this.sessionTranscript = '';
    this.isProcessingQueue = false;

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
      if (this.transcriptionQueue.length > 0) {
        this.processTranscriptionQueue();
      }
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
        .on('broadcast', { event: 'audio_segment_uploaded' }, (payload) => {
          console.log('[Supabase Realtime] Notificación audio_segment_uploaded recibida en sesión:', payload.payload);
          this.handleIncomingAudioStorageSegment(payload.payload);
        })
        .on('broadcast', { event: 'student:audio_chunk' }, (payload) => {
          this.handleIncomingAudioSegment(payload.payload);
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
            if (this.transcriptionQueue.length > 0) {
              this.processTranscriptionQueue();
            }
          }
        });
    }

    return { success: true, sessionCode: this.currentSession.sessionCode };
  }

  /**
   * Finaliza la sesión, emite teacher:session_end, espera el vaciado (flush)
   * del último fragmento de audio del alumno, espera a que termine la cola de transcripción
   * y procesa la evaluación sobre todo el sessionTranscript acumulado.
   */
  async stopSession(reason = 'teacher_stopped', options = {}) {
    if (!this.currentSession) return null;

    // Normalizar argumentos si reason es objeto
    let actualReason = reason;
    let actualOptions = options;
    if (typeof reason === 'object' && reason !== null) {
      actualOptions = reason;
      actualReason = actualOptions.reason || 'teacher_stopped';
    }

    // 1. Notificar al estudiante vía Realtime para que detenga la captura y transmita el último bloque
    if (this.channel) {
      try {
        console.log('[Supabase Realtime] Notificando teacher:session_end al estudiante...');
        await this.channel.send({
          type: 'broadcast',
          event: 'teacher:session_end',
          payload: { reason: actualReason, timestamp: Date.now() }
        });
      } catch (err) {
        console.warn('[Supabase Realtime] Error al emitir teacher:session_end:', err.message);
      }
    }

    // 2. Margen de espera (3000 ms) para recibir el último bloque transmitido (flush) por el alumno
    console.log('[Audio Pipeline] Margen de espera (3000ms) para vaciado (flush) del último bloque de audio...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(`[Audio Pipeline] Vaciado completado. Total de bloques recibidos en sesión: ${this.audioChunks.length}`);

    // 3. Esperar a que la cola secuencial de transcripción termine de procesar todos los bloques pendientes
    console.log(`[Audio Pipeline] Esperando a que termine la cola de transcripción (pendientes: ${this.transcriptionQueue.length}, procesando: ${this.isProcessingQueue})...`);
    const queueWaitStart = Date.now();
    while ((this.transcriptionQueue.length > 0 || this.isProcessingQueue) && (Date.now() - queueWaitStart < 40000)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    console.log(`[Audio Pipeline] Cola de transcripción finalizada. Transcripción acumulada total: "${this.sessionTranscript}"`);

    // Mantener el canal de Realtime abierto para permitir la Autocorrección Guiada post-sesión
    console.log('[Supabase Realtime] Canal activo conservado para interacción de Autocorrección Guiada.');

    // 4. Actualizar estado en la tabla 'sessions' de Supabase
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

    // 5. Preparar la transcripción verbatim acumulada y el resumen de sesión
    const sessionSummary = await this.processReceivedAudioSession(actualOptions);

    // Guardar código de sesión finalizada para permitir proyecciones post-sesión (Model Speech, etc.)
    this.lastCompletedSessionCode = this.currentSession?.sessionCode || this.lastCompletedSessionCode || '';

    // Limpieza obligatoria y estricta de estado tras stopSession
    this.audioChunks = [];
    this.transcriptionQueue = [];
    this.processedStoragePaths.clear();
    this.sessionTranscript = '';
    this.isProcessingQueue = false;
    if (this.currentSession) {
      this.currentSession.status = 'completed';
    }

    return sessionSummary;
  }

  /**
   * Evalúa la sesión acumulada contra la rúbrica IELTS y genera las tarjetas quirúrgicas.
   */
  async processReceivedAudioSession(options = {}) {
    const chunkCount = this.audioChunks.length;
    const studentLevel = options.confirmedLevel || this.currentSession?.studentLevel || 'B1';
    console.log(`[Audio Pipeline] Procesando transcripción acumulada de sesión (${chunkCount} bloques recibidos)...`);

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    console.log('[GEMINI] Clave encontrada:', !!apiKey, 'Longitud:', apiKey ? apiKey.length : 0);

    let rawStudentSpeech = (this.sessionTranscript || '').trim();

    // Si la transcripción fue nula, vacía o no hubo audio
    if (!rawStudentSpeech || rawStudentSpeech.includes('[No speech detected]') || rawStudentSpeech.toUpperCase().includes('[SILENCE]')) {
      if (!apiKey && this.audioChunks.length === 0) {
        console.log('[Audio Pipeline] Sin API key ni audio. Utilizando muestra representativa para visualización de prueba.');
        rawStudentSpeech = "well, um, last year I, I needs to travel for my job, but the flight was cancelled and I, I loose all the days waiting in the airport, you know?";
      } else {
        console.log('[Audio Pipeline] Sin voz audible detectada o transcripción vacía (silencio/ruido de fondo).');
        rawStudentSpeech = "";
      }
    }

    // Transcripción 100% literal (Verbatim): sin filtros ni alteración de muletillas
    const verbatimStudentSpeech = speechCleaner.cleanText(rawStudentSpeech);
    console.log('[Audio Pipeline] Transcripción Verbatim final para Panel y Evaluación:', verbatimStudentSpeech);

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

    // Solo evaluar inmediatamente si se solicita explícitamente autoEvaluate o skipEvaluation === false
    const shouldEvaluateImmediately = options.autoEvaluate === true || options.skipEvaluation === false;
    let feedbackCards = [];
    let modelSpeech = null;

    if (shouldEvaluateImmediately && verbatimStudentSpeech.trim().length > 0) {
      console.log(`[Audio Pipeline] Ejecutando motor IELTS de inmediato con nivel ${studentLevel}...`);
      const evalResult = await ieltsEngine.evaluateUtterance({
        teacherContext,
        studentUtterance: verbatimStudentSpeech,
        studentLevel
      });
      if (Array.isArray(evalResult)) {
        feedbackCards = evalResult;
      } else if (evalResult && typeof evalResult === 'object') {
        feedbackCards = evalResult.feedbackCards || [];
        modelSpeech = evalResult.modelSpeech || null;
      }
    } else {
      console.log('[Audio Pipeline] Transcripción lista. Evaluación diferida a la confirmación de nivel en UI.');
    }

    console.log(`[Audio Pipeline] Proceso concluido. ${feedbackCards.length} tarjetas generadas.`);

    return {
      chunkCount,
      cleanDialogueTurns,
      verbatimStudentSpeech,
      feedbackCards,
      modelSpeech,
      needsLevelConfirmation: !shouldEvaluateImmediately
    };
  }

  /**
   * Envía un evento broadcast 'guided_correction' al canal activo de la sala
   * para la función de Autocorrección Guiada en student-web.
   */
  async broadcastGuidedCorrection(payload = {}) {
    const sessionCode = (payload.sessionCode || this.currentSession?.sessionCode || this.lastCompletedSessionCode || '').toUpperCase().trim();
    if (!sessionCode) {
      console.warn('[Supabase Realtime] No hay sessionCode para broadcastGuidedCorrection');
      return { success: false, error: 'No active session code' };
    }

    if (!this.client) {
      this.initClient();
    }

    const channelName = `session:${sessionCode}`;
    let targetChannel = (this.channel && this.channel.topic === `realtime:${channelName}`) ? this.channel : null;

    if (!targetChannel && this.client) {
      console.log(`[Supabase Realtime] Suscribiendo al canal ${channelName} para broadcastGuidedCorrection...`);
      targetChannel = this.client.channel(channelName, {
        config: { broadcast: { self: false } }
      });
      await new Promise((resolve) => {
        targetChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
        setTimeout(resolve, 1500);
      });
    }

    if (!targetChannel) {
      return { success: false, error: 'No channel available' };
    }

    try {
      console.log('[Supabase Realtime] Emitiendo guided_correction:', payload.action, payload.cardId);
      await targetChannel.send({
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
    const sessionCode = (payload.sessionCode || this.currentSession?.sessionCode || this.lastCompletedSessionCode || '').toUpperCase().trim();
    if (!sessionCode) {
      console.warn('[Supabase Realtime] No hay sessionCode para broadcastMicroExercise');
      return { success: false, error: 'No active session code' };
    }

    if (!this.client) {
      this.initClient();
    }

    const channelName = `session:${sessionCode}`;
    let targetChannel = (this.channel && this.channel.topic === `realtime:${channelName}`) ? this.channel : null;

    if (!targetChannel && this.client) {
      console.log(`[Supabase Realtime] Suscribiendo al canal ${channelName} para broadcastMicroExercise...`);
      targetChannel = this.client.channel(channelName, {
        config: { broadcast: { self: false } }
      });
      targetChannel.on('broadcast', { event: 'micro_exercise_answer' }, (p) => {
        console.log('[Supabase Realtime] Respuesta de alumno recibida:', p.payload);
        this.eventListeners.onMicroExerciseAnswer(p.payload);
      });
      await new Promise((resolve) => {
        targetChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
        setTimeout(resolve, 1500);
      });
    }

    if (!targetChannel) {
      return { success: false, error: 'No channel available' };
    }

    try {
      console.log('[Supabase Realtime] Emitiendo micro_exercise:', payload.action, payload.exerciseId);
      await targetChannel.send({
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
   * Envía un evento broadcast 'model_speech' al canal activo de la sala
   * para proyectar la reformulación completa del discurso en student-web.
   */
  async broadcastModelSpeech(payload = {}) {
    const sessionCode = (payload.sessionCode || this.currentSession?.sessionCode || this.lastCompletedSessionCode || '').toUpperCase().trim();
    if (!sessionCode) {
      console.warn('[ModelSpeech] No hay sessionCode para broadcastModelSpeech');
      return { success: false, error: 'No active session code' };
    }

    if (!this.client) {
      this.initClient();
    }

    const channelName = `session:${sessionCode}`;
    let targetChannel = (this.channel && this.channel.topic === `realtime:${channelName}`) ? this.channel : null;

    if (!targetChannel && this.client) {
      console.log(`[ModelSpeech] Suscribiendo al canal ${channelName} para broadcastModelSpeech...`);
      targetChannel = this.client.channel(channelName, {
        config: { broadcast: { self: false } }
      });
      await new Promise((resolve) => {
        targetChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
        setTimeout(resolve, 1500);
      });
    }

    if (!targetChannel) {
      console.warn('[ModelSpeech] Error: No channel available para broadcastModelSpeech');
      return { success: false, error: 'No channel available' };
    }

    try {
      console.log(`[ModelSpeech] Emitiendo ${payload.action || 'show'} hacia ${channelName}...`);
      await targetChannel.send({
        type: 'broadcast',
        event: 'model_speech',
        payload
      });
      console.log('[ModelSpeech] Evento emitido exitosamente');
      return { success: true };
    } catch (err) {
      console.error('[ModelSpeech] Error emitiendo model_speech:', err.message);
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
        await this.channel.send({
          type: 'broadcast',
          event: 'model_speech',
          payload: { action: 'hide' }
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

