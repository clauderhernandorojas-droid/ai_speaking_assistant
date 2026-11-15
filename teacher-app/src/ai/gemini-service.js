/**
 * Gemini Service: Transcripción de Audio Multimodal y Evaluación IELTS con Gemini API
 */

const https = require('https');
const path = require('path');

// Asegurar carga de .env
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

class GeminiService {
  constructor() {
    // Modelo primario rápido por defecto
    this.primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    
    // Lista de modelos de fallback prioritarios
    this.fallbackModels = [
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-flash-latest'
    ];

    if (process.env.GEMINI_MODEL && !this.fallbackModels.includes(process.env.GEMINI_MODEL)) {
      this.fallbackModels.unshift(process.env.GEMINI_MODEL);
    }
  }

  getApiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  }

  /**
   * Petición HTTP nativa a Gemini con soporte IPv4 garantizado para Windows,
   * reintentos automáticos para Error 503 (High Demand) y fallback entre modelos.
   */
  async requestGemini(endpoint, payload) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('No se encontró GEMINI_API_KEY ni GOOGLE_API_KEY en variables de entorno.');
    }

    let lastError = null;

    // Iterar por la lista de modelos de fallback
    for (const model of this.fallbackModels) {
      const max503Retries = 2; // Máximo 2 reintentos por picos de demanda 503
      let attempt = 0;

      while (attempt <= max503Retries) {
        try {
          const result = await this.executeHttpRequest(model, endpoint, payload, apiKey);
          return result;
        } catch (err) {
          lastError = err;

          // Manejo de Error 503 (Picos de alta demanda): esperar 1.5s y reintentar hasta 2 veces
          if (err.message && (err.message.includes('503') || err.message.includes('high demand') || err.message.includes('spikes in demand'))) {
            attempt++;
            if (attempt <= max503Retries) {
              console.warn(`[GEMINI] Pico de demanda (503) en '${model}'. Reintentando (${attempt}/${max503Retries}) en 1.5 segundos...`);
              await new Promise(resolve => setTimeout(resolve, 1500));
              continue;
            } else {
              console.warn(`[GEMINI] Agotados los 2 reintentos por 503 en '${model}'. Cambiando automáticamente al siguiente modelo de fallback...`);
              break; // Pasar al siguiente modelo de fallbackModels
            }
          }

          // Si el modelo da Timeout, 404 o 429 (cuota de solicitudes por modelo agotada en Free Tier), cambiar automáticamente al siguiente modelo
          if (err.message && (err.message.includes('Timeout') || err.message.includes('404') || err.message.includes('NOT_FOUND') || err.message.includes('429') || err.message.includes('quota'))) {
            console.warn(`[GEMINI] Modelo '${model}' con cuota agotada o no disponible. Probando siguiente modelo de fallback...`);
            break;
          }

          // Errores de cliente (ej. 400), lanzar de inmediato
          throw err;
        }
      }
    }

    throw lastError;
  }

  executeHttpRequest(model, endpoint, payload, apiKey) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}`;

      const options = {
        method: 'POST',
        family: 4, // Forzar IPv4 en Windows para evitar demoras de resolución IPv6
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(url, options, (res) => {
        let responseBody = '';
        res.on('data', chunk => responseBody += chunk);
        res.on('end', () => {
          // Si el estado HTTP es de error, imprimir el cuerpo crudo devuelto por Google
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error(`[GEMINI HTTP ${res.statusCode} ERROR BODY]:\n`, responseBody);
            try {
              const errJson = JSON.parse(responseBody);
              return reject(new Error(`[Gemini API Error ${res.statusCode}]: ${errJson.error?.message || responseBody}`));
            } catch (_) {
              return reject(new Error(`[Gemini HTTP ${res.statusCode}]: ${responseBody}`));
            }
          }

          try {
            const data = JSON.parse(responseBody);
            if (data.error) {
              console.error('[GEMINI API RAW ERROR RESPONSE]:', JSON.stringify(data, null, 2));
              return reject(new Error(`[Gemini API Error ${data.error.code}]: ${data.error.message}`));
            }
            resolve(data);
          } catch (e) {
            reject(new Error(`Error al parsear respuesta JSON de Gemini: ${e.message} - Body: ${responseBody.slice(0, 300)}`));
          }
        });
      });

      // Timeout rápido de 15 segundos para evitar demoras
      req.setTimeout(15000, () => {
        req.destroy(new Error(`Timeout de 15 segundos alcanzado al consultar Gemini (${model}).`));
      });

      req.on('error', (err) => {
        console.error('[GEMINI ERROR DETALLADO]:', err);
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Transcribe un archivo de audio (WebM, WAV, MP4, etc.) usando Gemini Multimodal
   * @param {Buffer} audioBuffer Buffer binario completo del audio concatenado
   * @param {string} mimeType Tipo MIME (ej. 'audio/webm', 'audio/wav')
   * @returns {Promise<string>} Transcripción verbatim del alumno
   */
  async transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
    const apiKey = this.getApiKey();
    console.log('[GEMINI] Clave encontrada:', !!apiKey, 'Longitud:', apiKey ? apiKey.length : 0);

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('El buffer de audio está vacío.');
    }

    let cleanMimeType = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
    if (!cleanMimeType.startsWith('audio/')) {
      cleanMimeType = 'audio/webm';
    }

    console.log(`[GEMINI] Enviando audio multimodal: ${audioBuffer.length} bytes, MIME: ${cleanMimeType}`);
    const base64Data = audioBuffer.toString('base64');

    // Estructura oficial requerida: texto descriptivo primero y luego inlineData con audio
    const payload = {
      contents: [
        {
          parts: [
            {
              text: 'Transcribe the following audio recording verbatim. Output only the transcribed text in English without commentary. Keep all grammatical errors, stuttering, and hesitation sounds intact.'
            },
            {
              inlineData: {
                mimeType: cleanMimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    try {
      const result = await this.requestGemini('generateContent', payload);
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text.trim();
    } catch (err) {
      console.error('[GEMINI ERROR DETALLADO]:', err);
      throw err;
    }
  }

  /**
   * Evalúa las intervenciones con Gemini contra los Band Descriptors de IELTS
   */
  async evaluateTranscript({ teacherContext, studentUtterance, studentLevel, systemPrompt }) {
    const apiKey = this.getApiKey();
    console.log('[GEMINI] Clave encontrada:', !!apiKey, 'Longitud:', apiKey ? apiKey.length : 0);

    const payload = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}

TEACHER'S CONTEXT / QUESTION: "${teacherContext}"
STUDENT'S SPOKEN RESPONSE: "${studentUtterance}"
STUDENT TARGET CEFR LEVEL: "${studentLevel}"

Analyze according to the 5 tabs and output ONLY the valid JSON array starting with [ and ending with ].`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    try {
      const result = await this.requestGemini('generateContent', payload);
      let text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      // Limpiar posibles bloques markdown ```json ... ```
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('[GEMINI ERROR DETALLADO]:', err);
      throw err;
    }
  }

  /**
   * Genera un micro-ejercicio interactivo de opción múltiple con IA basado en una tarjeta de feedback
   */
  async generateMicroExercise({ category = 'grammar', studentQuote = '', surgicalCorrection = '', explanation = '', targetLevel = 'B1' }) {
    const exerciseId = `ex_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const systemInstruction = `You are an expert Cambridge/IELTS ESL examiner designing a focused multiple-choice micro-exercise for an English student at CEFR ${targetLevel} level.
Based on this diagnosed error or learning point:
- Category: ${category}
- Student's original phrase: "${studentQuote}"
- Teacher's surgical correction: "${surgicalCorrection}"
- Pedagogical explanation: "${explanation}"

TASK:
Create a single multiple-choice gap-fill exercise targeting the EXACT SAME grammatical rule, collocation, or lexical upgrade, but using a BRAND NEW, natural sentence (do NOT repeat the exact student phrase).

REQUIREMENTS:
1. "instruction": A short, clear instruction in Spanish tailored for the student (e.g., "Elige la opción correcta para completar la frase:", "Selecciona la colocación más natural:").
2. "promptSentence": A new sentence containing a blank formatted exactly as "___" (three underscores) where the target item fits.
3. "options": Exactly 3 realistic options (1 correct answer and 2 plausible distractors representing common L1 interference or false grammatical assumptions).
4. "correctIndex": Integer (0, 1, or 2) pointing to the single correct option in "options".
5. "feedbackExplanation": A concise pedagogical explanation in Spanish (max 20 words) explaining why the chosen option is correct and why the distractors are incorrect.

OUTPUT FORMAT:
Output ONLY a raw, valid JSON object without markdown code blocks, starting with { and ending with }.
Schema:
{
  "exerciseId": "${exerciseId}",
  "type": "multiple_choice",
  "category": "${category}",
  "instruction": "...",
  "promptSentence": "... ___ ...",
  "options": ["Option 1", "Option 2", "Option 3"],
  "correctIndex": 0,
  "feedbackExplanation": "..."
}`;

    const payload = {
      contents: [
        {
          parts: [{ text: systemInstruction }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    try {
      const result = await this.requestGemini('generateContent', payload);
      let text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(text);

      return {
        exerciseId: parsed.exerciseId || exerciseId,
        type: 'multiple_choice',
        category: parsed.category || category,
        instruction: parsed.instruction || 'Elige la opción correcta para completar la frase:',
        promptSentence: parsed.promptSentence || (surgicalCorrection ? `In professional contexts, they usually ___ this process.` : `She ___ to the office every morning.`),
        options: Array.isArray(parsed.options) && parsed.options.length >= 3 ? parsed.options.slice(0, 3) : ['option A', 'option B', 'option C'],
        correctIndex: (typeof parsed.correctIndex === 'number' && parsed.correctIndex >= 0 && parsed.correctIndex < 3) ? parsed.correctIndex : 0,
        feedbackExplanation: parsed.feedbackExplanation || explanation || 'Opción correcta acorde a la regla evaluada.'
      };
    } catch (err) {
      console.error('[GEMINI Micro-Exercise Error]:', err.message);
      // Fallback seguro en caso de error o límite de cuota
      return {
        exerciseId,
        type: 'multiple_choice',
        category,
        instruction: 'Elige la opción correcta para completar la frase:',
        promptSentence: `They ___ to the meeting yesterday on time.`,
        options: ['went', 'goed', 'have went'],
        correctIndex: 0,
        feedbackExplanation: 'El pasado simple del verbo irregular "go" es "went".'
      };
    }
  }
}

module.exports = new GeminiService();
