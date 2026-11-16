/**
 * Gestor de captura de audio y hardware del micrófono para el estudiante.
 * Utiliza MediaRecorder con timeslice para fragmentar el audio en chunks y
 * Web Audio API para calcular el volumen real de la voz.
 */

export class AudioCaptureService {
  constructor(options = {}) {
    this.timeslice = options.timeslice || 2000; // 2 segundos por fragmento
    this.onChunk = options.onChunk || (() => {});
    this.onVolume = options.onVolume || (() => {});
    this.deviceId = options.deviceId || null;
    
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.animationFrameId = null;
    this.isMuted = false;
  }

  /**
   * Solicita acceso al micrófono del navegador (o al deviceId especificado) con cancelación de ruido.
   */
  async start(deviceId = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Tu navegador no soporta captura de micrófono.');
    }

    if (deviceId) {
      this.deviceId = deviceId;
    }

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };

    if (this.deviceId) {
      audioConstraints.deviceId = { exact: this.deviceId };
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    });

    this.setupAudioAnalysis(this.mediaStream);
    this.setupMediaRecorder(this.mediaStream);
  }

  /**
   * Cambia el micrófono activo durante la sesión sin perder la conexión.
   */
  async setDevice(newDeviceId) {
    if (this.deviceId === newDeviceId && this.mediaStream) return;
    this.deviceId = newDeviceId;

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
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
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
   * Configura MediaRecorder para fragmentar audio periódicamente.
   */
  setupMediaRecorder(stream) {
    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];

    const supportedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

    this.mediaRecorder = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : {});

    this.mediaRecorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0 && !this.isMuted) {
        const base64 = await this.blobToBase64(event.data);
        this.onChunk(base64, this.mediaRecorder.mimeType || 'audio/webm');
      }
    };

    // Iniciar grabación continua en fragmentos
    this.mediaRecorder.start(this.timeslice);
  }

  /**
   * Conecta un AnalyserNode para monitorear el nivel de voz en tiempo real.
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

    const checkVolume = () => {
      if (!this.analyser || this.isMuted) {
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

        this.onVolume(average, rms); // Escala promedio y RMS
      }
      this.animationFrameId = requestAnimationFrame(checkVolume);
    };

    checkVolume();
  }

  /**
   * Alterna el estado de silencio (Mute / Unmute).
   */
  toggleMute() {
    if (!this.mediaStream) return this.isMuted;

    this.isMuted = !this.isMuted;
    this.mediaStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    return this.isMuted;
  }

  /**
   * Detiene la captura y libera el hardware del micrófono.
   */
  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        if (typeof this.mediaRecorder.requestData === 'function') {
          this.mediaRecorder.requestData();
        }
      } catch (e) {
        // En caso de que el recorder ya esté cerrando
      }
      this.mediaRecorder.stop();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Convierte un Blob binario a string Base64 para transporte JSON.
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

