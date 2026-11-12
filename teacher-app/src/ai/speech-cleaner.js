/**
 * Speech Cleaner: Passthrough Verbatim de Transcripción
 * Mantiene la transcripción 100% íntegra, literal y verbatim tal cual llega de Gemini,
 * preservando todas las palabras, vacilaciones y muletillas reales del estudiante.
 */

class SpeechCleaner {
  constructor() {
    this.fillerWords = [];
  }

  /**
   * Retorna el texto transcrito de forma 100% literal (verbatim) sin alteraciones.
   * @param {string} rawText Texto transcrito crudo de Gemini
   * @returns {string} Texto literal intacto
   */
  cleanText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    return rawText.trim();
  }
}

module.exports = new SpeechCleaner();
