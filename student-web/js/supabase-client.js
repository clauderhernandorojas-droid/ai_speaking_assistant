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
   * Sube un segmento de audio (Blob) directamente a Supabase Storage con bitrate optimizado.
   * Si la subida falla por permisos o bucket inexistente, realiza fallback automático a broadcast Base64 si < 120 KB.
   */
  async uploadAudioSegment(blob, mimeType = 'audio/webm', base64Fallback = null) {
    if (!this.client) this.init();
    this.sequenceId += 1;
    const currentSeq = this.sequenceId;
    const cleanSessionCode = (this.sessionCode || 'UNKNOWN').toUpperCase();
    const filePath = `${cleanSessionCode}/${Date.now()}_seg_${currentSeq}.webm`;

    try {
      console.log(`[Supabase Storage] Subiendo segmento #${currentSeq} (${blob.size} bytes) a session-audio/${filePath}...`);
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
      console.log(`[Supabase Storage] ✅ Segmento #${currentSeq} subido con éxito:`, uploadedPath);

      // Emitir notificación ligera por Realtime
      this.broadcastEvent('audio_segment_uploaded', {
        storagePath: uploadedPath,
        segmentIndex: currentSeq,
        sequence: currentSeq,
        mimeType: mimeType || 'audio/webm',
        size: blob.size,
        timestamp: Date.now()
      });

      return { success: true, storagePath: uploadedPath, sequence: currentSeq };
    } catch (uploadErr) {
      console.warn(`[Supabase Storage] Falló subida a Storage (${uploadErr.message}). Evaluando fallback Base64...`);

      // Fallback automático por WebSocket broadcast si el blob es < 120 KB
      if (blob.size < 120 * 1024) {
        try {
          let b64 = base64Fallback;
          if (!b64) {
            b64 = await this.blobToBase64(blob);
          }
          console.log(`[Supabase Realtime Fallback] Transmitiendo segmento #${currentSeq} (${blob.size} bytes) por WebSocket Base64...`);
          this.broadcastEvent('student:audio_chunk', {
            sequence: currentSeq,
            mimeType: mimeType || 'audio/webm',
            data: b64,
            timestamp: Date.now()
          });
          return { success: true, fallback: true, sequence: currentSeq };
        } catch (b64Err) {
          console.error('[Supabase Realtime Fallback] Error en fallback Base64:', b64Err.message);
        }
      } else {
        console.error(`[Supabase Storage] Segmento (${blob.size} bytes) excede 120 KB para fallback WebSocket.`);
      }

      return { success: false, error: uploadErr.message };
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
   * Desconecta del canal al salir.
   */
  async leave() {
    if (this.channel) {
      await this.broadcastEvent('student:left', { timestamp: Date.now() });
      await this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

