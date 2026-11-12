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
    
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.animationFrameId = null;
    this.isMuted = false;
  }

  /**
   * Solicita acceso al micrófono del navegador con cancelación de ruido.
   */
  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Tu navegador no soporta captura de micrófono.');
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    this.setupAudioAnalysis(this.mediaStream);
    this.setupMediaRecorder(this.mediaStream);
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

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const checkVolume = () => {
      if (!this.analyser || this.isMuted) {
        this.onVolume(0);
      } else {
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        this.onVolume(average); // Escala aproximada 0 - 255
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

