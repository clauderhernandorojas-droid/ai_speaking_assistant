/**
 * Cliente Supabase ultraligero para la vista web del estudiante.
 * Utiliza Canales de Realtime (Broadcast) para transmitir eventos y chunks de audio
 * directamente a la aplicación de escritorio del docente sin exponer tokens ni lógica compleja.
 */

// NOTA: Configura aquí tus credenciales de Supabase
export const SUPABASE_CONFIG = {
  url: window.__ENV__?.SUPABASE_URL || 'https://TU-PROYECTO.supabase.co',
  anonKey: window.__ENV__?.SUPABASE_ANON_KEY || 'TU-ANON-KEY-PUBLICA'
};

export class StudentSupabaseService {
  constructor() {
    this.client = null;
    this.channel = null;
    this.sessionCode = null;
    this.studentName = null;
    this.sequenceId = 0;
    this.uploadQueue = [];
    this.isProcessingUploadQueue = false;
  }

  init() {
    if (!window.supabase) {
      throw new Error('Supabase SDK no está cargado. Revisa la etiqueta script en index.html');
    }
    this.client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    });
  }

  /**
   * Valida la existencia de la sesión en la base de datos de Supabase.
   */
  async validateSession(sessionCode) {
    if (!this.client) this.init();

    const { data, error } = await this.client
      .from('sessions')
      .select('id, session_code, status, duration_minutes')
      .eq('session_code', sessionCode)
      .maybeSingle();

    if (error || !data) {
      throw new Error('Sesión no encontrada o código inválido');
    }
    return data;
  }

  /**
   * Se suscribe al canal de broadcast en tiempo real de la sala.
   */
  async joinSessionChannel(sessionCode, studentName, onTeacherEvent) {
    this.sessionCode = sessionCode.toUpperCase().trim();
    this.studentName = studentName.trim();
    this.sequenceId = 0;

    // Actualizar nombre del alumno en la tabla de sesión si corresponde
    await this.client
      .from('sessions')
      .update({ student_name: this.studentName, updated_at: new Date().toISOString() })
      .eq('session_code', this.sessionCode);

    // Conectar al canal específico de la sesión
    const channelName = `session:${this.sessionCode}`;
    this.channel = this.client.channel(channelName, {
      config: {
        broadcast: { self: false }
      }
    });

    // Escuchar eventos emitidos por el docente
    this.channel
      .on('broadcast', { event: 'teacher:session_start' }, (payload) => {
        if (onTeacherEvent) onTeacherEvent('session_start', payload.payload);
      })
      .on('broadcast', { event: 'teacher:session_end' }, (payload) => {
        if (onTeacherEvent) onTeacherEvent('session_end', payload.payload);
      })
      .on('broadcast', { event: 'guided_correction' }, (payload) => {
        if (onTeacherEvent) onTeacherEvent('guided_correction', payload.payload);
      })
      .on('broadcast', { event: 'micro_exercise' }, (payload) => {
        if (onTeacherEvent) onTeacherEvent('micro_exercise', payload.payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Notificar al docente que el alumno se unió
          this.broadcastEvent('student:joined', {
            studentName: this.studentName,
            sessionCode: this.sessionCode,
            joinedAt: Date.now()
          });
        }
      });

    return true;
  }

  /**
   * Sube un segmento de audio (Blob) de forma secuencial a través de una cola ordenada (uploadQueue).
   * Evita condiciones de carrera y pérdida de bloques en redes móviles (4G).
   */
  uploadAudioSegment(blob, mimeType = 'audio/webm', base64Fallback = null) {
    this.sequenceId += 1;
    const currentSeq = this.sequenceId;

    return new Promise((resolve) => {
      this.uploadQueue.push({
        seq: currentSeq,
        blob,
        mimeType,
        base64Fallback,
        resolve
      });
      this.processUploadQueue();
    });
  }

  /**
   * Procesa la cola de subida estrictamente en orden secuencial (FIFO).
   */
  async processUploadQueue() {
    if (this.isProcessingUploadQueue) return;
    this.isProcessingUploadQueue = true;

    while (this.uploadQueue.length > 0) {
      const item = this.uploadQueue.shift();
      try {
        const result = await this._performUpload(item.seq, item.blob, item.mimeType, item.base64Fallback);
        item.resolve(result);
      } catch (err) {
        console.error(`[Upload] Error crítico procesando bloque #${item.seq}:`, err);
        item.resolve({ success: false, error: err.message, sequence: item.seq });
      }
    }

    this.isProcessingUploadQueue = false;
  }

  /**
   * Ejecución real de subida a Supabase Storage con fallback a Base64 por WebSocket si falla.
   */
  async _performUpload(currentSeq, blob, mimeType = 'audio/webm', base64Fallback = null) {
    if (!this.client) this.init();
    const cleanSessionCode = (this.sessionCode || 'UNKNOWN').toUpperCase();
    const filePath = `${cleanSessionCode}/${Date.now()}_seg_${currentSeq}.webm`;

    console.log(`[Upload] Subiendo bloque #${currentSeq} (${blob.size} bytes) a Storage: session-audio/${filePath}...`);

    try {
      const { data, error } = await this.client.storage
        .from('session-audio')
        .upload(filePath, blob, {
          contentType: mimeType || 'audio/webm',
          upsert: true
        });

      if (error) {
        throw error;
      }

      const uploadedPath = data?.path || filePath;
      console.log(`[Upload] Éxito: Bloque #${currentSeq} subido a Storage (${uploadedPath})`);

      // Emitir notificación ligera por Realtime
      this.broadcastEvent('audio_segment_uploaded', {
        sessionCode: cleanSessionCode,
        storagePath: uploadedPath,
        segmentIndex: currentSeq,
        sequence: currentSeq,
        mimeType: mimeType || 'audio/webm',
        size: blob.size,
        timestamp: Date.now()
      });

      return { success: true, storagePath: uploadedPath, sequence: currentSeq };
    } catch (uploadErr) {
      console.warn(`[Upload] Error subiendo bloque #${currentSeq} a Storage (${uploadErr.message}). Evaluando fallback Base64...`);

      // Fallback automático por WebSocket broadcast si el blob es < 120 KB
      if (blob.size < 120 * 1024) {
        try {
          let b64 = base64Fallback;
          if (!b64) {
            b64 = await this.blobToBase64(blob);
          }
          console.log(`[Upload] Transmitiendo bloque #${currentSeq} (${blob.size} bytes) por fallback WebSocket Base64...`);
          this.broadcastEvent('student:audio_chunk', {
            sessionCode: cleanSessionCode,
            sequence: currentSeq,
            mimeType: mimeType || 'audio/webm',
            data: b64,
            timestamp: Date.now()
          });
          return { success: true, fallback: true, sequence: currentSeq };
        } catch (b64Err) {
          console.error(`[Upload] Error en fallback Base64 bloque #${currentSeq}:`, b64Err.message);
        }
      } else {
        console.error(`[Upload] Bloque #${currentSeq} (${blob.size} bytes) excede 120 KB para fallback WebSocket.`);
      }

      return { success: false, error: uploadErr.message, sequence: currentSeq };
    }
  }

  /**
   * Helper para convertir Blob a Base64 en caso de fallback.
   */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        resolve(dataUrl.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Envía un chunk de audio codificado en Base64 al canal de broadcast.
   */
  sendAudioChunk(base64Data, mimeType = 'audio/webm') {
    if (!this.channel) return;

    this.sequenceId += 1;
    this.broadcastEvent('student:audio_chunk', {
      sessionCode: (this.sessionCode || '').toUpperCase().trim(),
      sequence: this.sequenceId,
      mimeType,
      data: base64Data,
      timestamp: Date.now()
    });
  }

  /**
   * Informa al docente el cambio de estado de mute.
   */
  sendMuteChange(isMuted) {
    if (!this.channel) return;
    this.broadcastEvent('student:mute_change', {
      isMuted,
      timestamp: Date.now()
    });
  }

  /**
   * Envía la respuesta seleccionada por el estudiante en el micro-ejercicio.
   */
  sendMicroExerciseAnswer(payload) {
    if (!this.channel) return;
    this.broadcastEvent('micro_exercise_answer', payload);
  }

  /**
   * Envío genérico al canal de broadcast.
   */
  broadcastEvent(event, payload) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event,
      payload
    });
  }

  /**
   * Espera a que se vacíe la cola de subidas pendientes a Storage antes de desconectar.
   */
  async waitForPendingUploads(timeoutMs = 15000) {
    const startTime = Date.now();
    while ((this.uploadQueue.length > 0 || this.isProcessingUploadQueue) && (Date.now() - startTime < timeoutMs)) {
      console.log(`[Upload] Esperando subidas pendientes... (en cola: ${this.uploadQueue.length}, procesando: ${this.isProcessingUploadQueue})`);
      await new Promise(r => setTimeout(r, 200));
    }

    if (this.uploadQueue.length > 0 || this.isProcessingUploadQueue) {
      console.warn(`[Upload] Timeout esperando subidas pendientes (${timeoutMs}ms). Quedan ${this.uploadQueue.length} en cola.`);
    } else {
      console.log('[Upload] Todas las subidas pendientes a Storage se completaron.');
    }
  }

  /**
   * Desconecta del canal al salir, asegurando que todos los bloques en cola terminen de subirse.
   */
  async leave() {
    await this.waitForPendingUploads(10000);
    if (this.channel) {
      await this.broadcastEvent('student:left', { timestamp: Date.now() });
      await this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

