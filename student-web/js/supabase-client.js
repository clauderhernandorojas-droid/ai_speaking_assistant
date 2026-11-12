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

