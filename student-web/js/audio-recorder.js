/**
 * Gestor de captura de audio y hardware del micrófono para el estudiante.
 * Utiliza MediaRecorder con bitrate optimizado de voz (24 kbps) y ciclo de bloques WebM autocontenidos
 * de máximo 15s (o 1.8s de silencio tras voz) con VAD Adaptativo (piso de ruido dinámico acotado a 0.015).
 */

export class AudioCaptureService {
  constructor(options = {}) {
    this.maxBlockDuration = options.maxBlockDuration || 15000; // Máximo 15 segundos por bloque (~35-45 KB a 24 kbps)
    this.silenceTimeoutMs = options.silenceTimeoutMs || 1800;  // 1.8s de silencio continuo tras haber detectado voz
    this.audioBitsPerSecond = options.audioBitsPerSecond || 24000; // 24 kbps: calidad de voz cristalina ultraligera
    this.onChunk = options.onChunk || (() => {});
    this.onVolume = options.onVolume || (() => {});
    this.deviceId = options.deviceId || null;
    
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.animationFrameId = null;
    this.isMuted = false;
    this.isActive = false;

    // VAD Adaptativo por piso de ruido dinámico (SNR) + AGC
    this.noiseFloor = 0.004; // Inicializado en 0.004, acotado entre 0.0015 y 0.015
    this.hangoverMs = 0;     // Retención de 400ms para pausas entre sílabas

    // Métricas y control del ciclo de bloques
    this.blockTimer = null;
    this.currentBlockChunks = [];
    this.blockMetrics = {
      startTime: 0,
      activeSpeechMs: 0,
      continuousSilenceMs: 0,
      hasSpeech: false,
      peakRms: 0,
      noiseFloorAtEnd: 0.004
    };
    this.isCycling = false;
    this.supportedMime = '';
  }

  /**
   * Solicita acceso al micrófono del navegador (o al deviceId especificado) con AGC y cancelación de ruido.
   */
  async start(deviceId = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Tu navegador no soporta captura de micrófono.');
    }

    if (deviceId) {
      this.deviceId = deviceId;
    }

    const audioConstraints = {
      deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
      autoGainControl: true,
      noiseSuppression: true,
      echoCancellation: true
    };

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    });

    this.isActive = true;
    this.setupAudioAnalysis(this.mediaStream);
    this.startNewRecordingBlock();
  }

  /**
   * Inicia un nuevo bloque de grabación WebM autocontenido con bitrate de voz optimizado (24 kbps).
   */
  startNewRecordingBlock() {
    if (!this.isActive || this.isMuted || !this.mediaStream) return;

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (_) {}
    }

    // Determinar MIME type compatible una sola vez
    if (!this.supportedMime) {
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4'
      ];
      this.supportedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
    }

    this.currentBlockChunks = [];
    this.blockMetrics = {
      startTime: performance.now(),
      activeSpeechMs: 0,
      continuousSilenceMs: 0,
      hasSpeech: false,
      peakRms: 0,
      noiseFloorAtEnd: this.noiseFloor
    };
    this.hangoverMs = 0;
    this.isCycling = false;

    // Configurar 24 kbps (audioBitsPerSecond: 24000) para generar WebM ultraligeros
    try {
      const recorderOptions = { audioBitsPerSecond: this.audioBitsPerSecond };
      if (this.supportedMime) recorderOptions.mimeType = this.supportedMime;
      this.mediaRecorder = new MediaRecorder(this.mediaStream, recorderOptions);
    } catch (err) {
      console.warn('[AudioCaptureService] Fallback MediaRecorder sin audioBitsPerSecond:', err.message);
      try {
        this.mediaRecorder = new MediaRecorder(
          this.mediaStream,
          this.supportedMime ? { mimeType: this.supportedMime } : {}
        );
      } catch (fallbackErr) {
        console.error('[AudioCaptureService] Error instanciando MediaRecorder:', fallbackErr);
        return;
      }
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.currentBlockChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      const chunks = this.currentBlockChunks;
      const metrics = { ...this.blockMetrics };
      this.currentBlockChunks = [];

      if (chunks.length > 0) {
        const mime = this.mediaRecorder?.mimeType || this.supportedMime || 'audio/webm';
        const blob = new Blob(chunks, { type: mime });

        // Criterio VAD Adaptativo:
        // Acepta el bloque como voz válida si activeSpeechMs >= 250 O si peakRms >= Math.max(0.02, noiseFloor * 4.5)
        const speechGateRms = Math.max(0.02, this.noiseFloor * 4.5);
        const hasValidSpeech = metrics.activeSpeechMs >= 250 || metrics.peakRms >= speechGateRms;

        if (hasValidSpeech) {
          console.log(`[AudioCapture] Bloque autocontenido con voz válida (${blob.size} bytes, voz: ${Math.round(metrics.activeSpeechMs)}ms, peakRms: ${metrics.peakRms.toFixed(3)}, noiseFloor: ${this.noiseFloor.toFixed(4)}, gateRms: ${speechGateRms.toFixed(3)}). Transmitiendo...`);
          try {
            // Se entrega el Blob directo (y su MIME y métricas) para subida a Supabase Storage
            await this.onChunk(blob, mime, metrics);
          } catch (chunkErr) {
            console.error('[AudioCapture] Error en onChunk:', chunkErr);
          }
        } else {
          console.log(`[AudioCapture] Bloque descartado localmente por falta de voz (${blob.size} bytes, voz: ${Math.round(metrics.activeSpeechMs)}ms < 250ms, peakRms: ${metrics.peakRms.toFixed(3)} < ${speechGateRms.toFixed(3)}). 0 tokens IA consumidos.`);
        }
      }

      // Iniciar el siguiente bloque de inmediato si la sesión sigue activa y no está silenciado
      if (this.isActive && !this.isMuted) {
        this.startNewRecordingBlock();
      }
    };

    // Iniciar sin timeslice para generar un archivo WebM autocontenido al llamar .stop()
    this.mediaRecorder.start();

    // Límite máximo: 15 segundos por bloque
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = setTimeout(() => {
      this.cycleBlock('max_duration_15s');
    }, this.maxBlockDuration);
  }

  /**
   * Cierra de forma anticipada o programada el bloque de grabación actual.
   */
  cycleBlock(reason = 'vad') {
    if (this.isCycling) return;
    this.isCycling = true;

    if (this.blockTimer) {
      clearTimeout(this.blockTimer);
      this.blockTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch (err) {
        console.warn(`[AudioCapture] Error al cerrar bloque (${reason}):`, err.message);
      }
    }
  }

  /**
   * Cambia el micrófono activo durante la sesión sin perder la conexión.
   * Reinicia el piso de ruido dinámico para calibrarse con el nuevo hardware.
   */
  async setDevice(newDeviceId) {
    if (this.deviceId === newDeviceId && this.mediaStream) return;
    this.deviceId = newDeviceId;
    this.noiseFloor = 0.004; // Reiniciar piso de ruido al cambiar de hardware
    this.hangoverMs = 0;

    const wasActive = !!this.mediaStream;
    if (wasActive) {
      this.stop();
      await this.start(newDeviceId);
    }
  }

  /**
   * Enumera los micrófonos de entrada de audio disponibles.
   */
  static async enumerateMicrophones() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }

    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let audioInputs = devices.filter(d => d.kind === 'audioinput');
      const hasLabels = audioInputs.some(d => d.label && d.label.trim().length > 0);

      // Si los labels vienen vacíos (permiso aún no concedido), solicitar acceso temporal
      if (!hasLabels && navigator.mediaDevices.getUserMedia) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          devices = await navigator.mediaDevices.enumerateDevices();
          audioInputs = devices.filter(d => d.kind === 'audioinput');
          tempStream.getTracks().forEach(t => t.stop());
        } catch (_) {}
      }

      return audioInputs.map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Micrófono ${index + 1}`
      }));
    } catch (err) {
      console.warn('[AudioCaptureService] Error al listar dispositivos:', err);
      return [];
    }
  }

  /**
   * Crea un monitor de audio ligero para probar el volumen antes de unirse.
   */
  static async createAudioPreview(deviceId, onVolumeChange) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: true
      },
      video: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return {
        stop: () => stream.getTracks().forEach(t => t.stop())
      };
    }

    const ctx = new AudioContextClass();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let frameId = null;

    const check = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      if (typeof onVolumeChange === 'function') {
        onVolumeChange(avg);
      }
      frameId = requestAnimationFrame(check);
    };

    check();

    return {
      stop: () => {
        if (frameId) cancelAnimationFrame(frameId);
        stream.getTracks().forEach(t => t.stop());
        if (ctx.state !== 'closed') ctx.close();
      }
    };
  }

  /**
   * Conecta un AnalyserNode para monitorear el nivel de voz en tiempo real y ejecutar VAD Adaptativo.
   */
  setupAudioAnalysis(stream) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.audioContext = new AudioContextClass();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    source.connect(this.analyser);

    const freqArray = new Uint8Array(this.analyser.frequencyBinCount);
    const timeArray = new Uint8Array(this.analyser.fftSize);
    let lastTime = performance.now();

    const checkVolume = () => {
      const now = performance.now();
      const dt = Math.min(now - lastTime, 100); // delta de tiempo transcurrido en ms
      lastTime = now;

      if (!this.analyser || this.isMuted || !this.isActive) {
        this.onVolume(0, 0);
      } else {
        // Nivel de energía en frecuencias (0 - 255)
        this.analyser.getByteFrequencyData(freqArray);
        let sum = 0;
        for (let i = 0; i < freqArray.length; i++) {
          sum += freqArray[i];
        }
        const average = sum / freqArray.length;

        // Nivel RMS en el dominio del tiempo (0.0 - 1.0)
        this.analyser.getByteTimeDomainData(timeArray);
        let sumSquares = 0;
        for (let i = 0; i < timeArray.length; i++) {
          const norm = (timeArray[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / timeArray.length);

        // Feedback visual para el visualizador
        this.onVolume(average, rms);

        // VAD Adaptativo por Piso de Ruido Dinámico
        const dynamicThreshold = Math.max(0.005, this.noiseFloor * 2.8);

        // Congelar actualización de noiseFloor mientras haya voz activa o hangover.
        // Solo actualizar cuando la señal esté en calma real (rms < dynamicThreshold y hangoverMs === 0).
        // Acotado entre 0.0015 y 0.015 para evitar que el umbral suba mientras el alumno habla.
        const isSignalQuiet = rms < dynamicThreshold && this.hangoverMs === 0;
        if (isSignalQuiet) {
          this.noiseFloor = Math.min(0.015, Math.max(0.0015, this.noiseFloor * 0.95 + rms * 0.05));
        }

        // Rastreo de VAD si hay un bloque activo
        if (!this.isCycling && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          if (rms > this.blockMetrics.peakRms) {
            this.blockMetrics.peakRms = rms;
          }
          this.blockMetrics.noiseFloorAtEnd = this.noiseFloor;

          const isVoicePeak = rms >= dynamicThreshold;
          if (isVoicePeak) {
            // Pico por encima de umbral dinámico: reactivar hangover de 400 ms
            this.hangoverMs = 400;
            this.blockMetrics.activeSpeechMs += dt;
            this.blockMetrics.hasSpeech = true;
            this.blockMetrics.continuousSilenceMs = 0;
          } else if (this.hangoverMs > 0) {
            // Retención hangover (pausa natural entre sílabas)
            this.hangoverMs = Math.max(0, this.hangoverMs - dt);
            this.blockMetrics.activeSpeechMs += dt;
            this.blockMetrics.continuousSilenceMs = 0;
          } else {
            // Silencio fuera de pausas entre sílabas
            if (this.blockMetrics.hasSpeech) {
              this.blockMetrics.continuousSilenceMs += dt;

              const isEligibleBlock = this.blockMetrics.activeSpeechMs >= 250 ||
                this.blockMetrics.peakRms >= Math.max(0.02, this.noiseFloor * 4.5);

              // Si detecta 1.8s de silencio continuo tras haber captado voz válida:
              if (this.blockMetrics.continuousSilenceMs >= this.silenceTimeoutMs && isEligibleBlock) {
                this.cycleBlock('silence_after_speech_1.8s');
              }
            }
          }
        }
      }

      if (this.isActive) {
        this.animationFrameId = requestAnimationFrame(checkVolume);
      }
    };

    this.animationFrameId = requestAnimationFrame(checkVolume);
  }

  /**
   * Alterna el estado de silencio (Mute / Unmute).
   * Al silenciar, detiene el bloque actual y no inicia otro hasta reactivar.
   */
  toggleMute() {
    if (!this.mediaStream) return this.isMuted;

    this.isMuted = !this.isMuted;
    this.mediaStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    if (this.isMuted) {
      // Detiene y cierra el bloque actual (se enviará en onstop solo si tenía voz previa)
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.cycleBlock('mute');
      }
    } else {
      // Al reactivar el micrófono, inicia un nuevo bloque limpio
      if (this.isActive && (!this.mediaRecorder || this.mediaRecorder.state === 'inactive')) {
        this.startNewRecordingBlock();
      }
    }

    return this.isMuted;
  }

  /**
   * Detiene la captura, vacía cualquier bloque pendiente y libera el hardware del micrófono.
   */
  async stop() {
    this.isActive = false;

    if (this.blockTimer) {
      clearTimeout(this.blockTimer);
      this.blockTimer = null;
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        const prevOnStop = this.mediaRecorder.onstop;
        this.mediaRecorder.onstop = async (e) => {
          if (typeof prevOnStop === 'function') {
            try {
              await prevOnStop(e);
            } catch (err) {
              console.error('[AudioCapture] Error en onstop durante stop():', err);
            }
          }
          resolve();
        };

        try {
          this.mediaRecorder.stop();
        } catch (_) {
          resolve();
        }
      });
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (_) {}
      this.audioContext = null;
    }
  }

  /**
   * Convierte un Blob binario a string Base64 para transporte JSON (útil para fallback).
   */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        // Extraer únicamente la carga útil Base64 (después de la coma)
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
