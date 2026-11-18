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
   * Compatible con strings o con objetos estructurados { transcript, pronunciationIssues }.
   * @param {string|Object} rawText Texto transcrito crudo de Gemini u objeto estructurado
   * @returns {string} Texto literal intacto
   */
  cleanText(rawText) {
    if (!rawText) return '';
    if (typeof rawText === 'object') {
      if (typeof rawText.transcript === 'string') {
        return rawText.transcript.trim();
      }
      if (typeof rawText.toString === 'function') {
        const str = rawText.toString();
        if (str !== '[object Object]') return str.trim();
      }
      return '';
    }
    if (typeof rawText !== 'string') return '';
    return rawText.trim();
  }
}

module.exports = new SpeechCleaner();
