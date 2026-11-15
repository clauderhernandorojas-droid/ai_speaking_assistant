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
   * Genera un micro-ejercicio interactivo con IA calibrado según el nivel CEFR y tipo seleccionado
   */
  async generateMicroExercise({ category = 'grammar', studentQuote = '', surgicalCorrection = '', explanation = '', targetLevel = 'B1', preferredType = null, seed = null }) {
    const exerciseId = `ex_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const randomNonce = seed || `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // Calibración automática del tipo de ejercicio si no se especificó preferredType
    let selectedType = (preferredType || '').toLowerCase().trim();
    const validTypes = ['multiple_choice', 'spot_the_error', 'key_word_transformation'];
    if (!validTypes.includes(selectedType)) {
      const normLevel = (targetLevel || 'B1').toUpperCase().trim();
      const isHighLevel = ['B2', 'C1', 'C2'].includes(normLevel);
      const isUpgrade = (category || '').toLowerCase().includes('upgrade') || (category || '').toLowerCase() === 'c1';

      if (isUpgrade || (isHighLevel && Math.random() > 0.45)) {
        selectedType = 'key_word_transformation';
      } else if (isHighLevel || Math.random() > 0.5) {
        selectedType = 'spot_the_error';
      } else {
        selectedType = 'multiple_choice';
      }
    }

    let typePromptInstructions = '';
    if (selectedType === 'multiple_choice') {
      typePromptInstructions = `
TYPE: "multiple_choice"
Create a brand new sentence with a blank formatted as "___".
- "promptSentence": The new sentence containing "___" (do NOT use identical wording from the student quote).
- "options": EXACTLY 4 realistic options. 1 is correct, and 3 are subtle distractors representing common Spanish L1 interference or false grammatical analogies.
- "correctIndex": Integer (0, 1, 2, or 3) indicating the correct answer in "options".
- "instruction": "Elige la opción más adecuada para completar la frase:"
`;
    } else if (selectedType === 'spot_the_error') {
      typePromptInstructions = `
TYPE: "spot_the_error"
Create a single coherent English sentence divided into EXACTLY 4 sequential segments.
- EXACTLY ONE segment MUST contain a subtle error of the same rule (syntax, preposition, collocation, false cognate). The other 3 segments MUST be grammatically flawless.
- "segments": Array of exactly 4 strings. When read in order (0 -> 1 -> 2 -> 3), they form the full sentence.
- "errorSegmentIndex": Integer (0, 1, 2, or 3) indicating which segment contains the error.
- "correctedSegment": The exact string showing that segment corrected.
- "promptSentence": The full sentence as a single string.
- "instruction": "Encuentra y pulsa el segmento que contiene el error:"
`;
    } else { // key_word_transformation
      typePromptInstructions = `
TYPE: "key_word_transformation"
Create a Cambridge C1/B2 style Key Word Transformation exercise.
- "baseSentence": A complete, natural sentence presenting the idea.
- "keyWord": A single word or short phrase in CAPITAL letters that must be used without alteration.
- "targetSentenceTemplate": A second sentence with the exact same meaning, containing a blank "___" where the transformed words fit.
- "idealAnswer": The model phrase that fills "___" (including the keyWord).
- "acceptableVariants": Array of 1 to 3 valid variant phrases (e.g. minor synonym or valid syntactic variation).
- "instruction": "Completa la segunda frase usando la palabra en mayúsculas para que signifique lo mismo que la primera:"
`;
    }

    const systemInstruction = `You are a Senior Cambridge English / IELTS Examiner designing an interactive micro-exercise for an English learner at CEFR ${targetLevel} level.
Nonce/Variation Seed: ${randomNonce}

DIAGNOSED LEARNER NEED:
- Category: ${category}
- Student's original phrase: "${studentQuote}"
- Teacher's surgical correction: "${surgicalCorrection}"
- Pedagogical explanation: "${explanation}"

${typePromptInstructions}

UNIVERSAL REQUIREMENTS:
1. The exercise MUST target the EXACT SAME linguistic point or upgrade, but using a COMPLETELY FRESH sentence/context.
2. "feedbackExplanation": A concise pedagogical explanation in Spanish (max 20 words) explaining why the correct choice or transformation is right.
3. Return ONLY a valid JSON object matching the schema below without markdown backticks.

SCHEMA BY TYPE:
{
  "exerciseId": "${exerciseId}",
  "type": "${selectedType}",
  "category": "${category}",
  "instruction": "...",
  "feedbackExplanation": "...",
  // If multiple_choice:
  "promptSentence": "... ___ ...",
  "options": ["A", "B", "C", "D"],
  "correctIndex": 0,
  // If spot_the_error:
  "segments": ["Part 1", "Part 2 with error", "Part 3", "Part 4"],
  "errorSegmentIndex": 1,
  "correctedSegment": "Part 2 corrected",
  // If key_word_transformation:
  "baseSentence": "...",
  "keyWord": "WORD",
  "targetSentenceTemplate": "... ___ ...",
  "idealAnswer": "...",
  "acceptableVariants": ["..."]
}`;

    const payload = {
      contents: [
        {
          parts: [{ text: systemInstruction }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1200,
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

      const baseResult = {
        exerciseId: parsed.exerciseId || exerciseId,
        type: parsed.type || selectedType,
        category: parsed.category || category,
        instruction: parsed.instruction || 'Elige la opción correcta:',
        feedbackExplanation: parsed.feedbackExplanation || explanation || 'Opción correcta acorde a la regla evaluada.'
      };

      if (baseResult.type === 'spot_the_error') {
        const segs = Array.isArray(parsed.segments) && parsed.segments.length === 4 ? parsed.segments : ['In many cases,', 'the staff worked hardly', 'to meet the expectations', 'of their clients.'];
        const errIdx = typeof parsed.errorSegmentIndex === 'number' && parsed.errorSegmentIndex >= 0 && parsed.errorSegmentIndex < 4 ? parsed.errorSegmentIndex : 1;
        return {
          ...baseResult,
          segments: segs,
          errorSegmentIndex: errIdx,
          correctedSegment: parsed.correctedSegment || 'the staff worked hard',
          promptSentence: parsed.promptSentence || segs.join(' ')
        };
      } else if (baseResult.type === 'key_word_transformation') {
        return {
          ...baseResult,
          baseSentence: parsed.baseSentence || 'The challenge was so demanding that we needed external assistance.',
          keyWord: (parsed.keyWord || 'SUCH').toUpperCase().trim(),
          targetSentenceTemplate: parsed.targetSentenceTemplate || 'It was ___ that we needed external assistance.',
          idealAnswer: (parsed.idealAnswer || 'such a demanding challenge').trim(),
          acceptableVariants: Array.isArray(parsed.acceptableVariants) ? parsed.acceptableVariants : []
        };
      } else { // multiple_choice
        const opts = Array.isArray(parsed.options) && parsed.options.length >= 4 ? parsed.options.slice(0, 4) : ['option A', 'option B', 'option C', 'option D'];
        const corrIdx = typeof parsed.correctIndex === 'number' && parsed.correctIndex >= 0 && parsed.correctIndex < opts.length ? parsed.correctIndex : 0;
        return {
          ...baseResult,
          type: 'multiple_choice',
          promptSentence: parsed.promptSentence || (surgicalCorrection ? `In professional settings, they usually ___ this process.` : `She ___ to the office every morning.`),
          options: opts,
          correctIndex: corrIdx
        };
      }
    } catch (err) {
      console.error('[GEMINI Micro-Exercise Error]:', err.message);
      // Fallback seguro según el tipo solicitado
      if (selectedType === 'spot_the_error') {
        return {
          exerciseId,
          type: 'spot_the_error',
          category,
          instruction: 'Encuentra y pulsa el segmento que contiene el error:',
          promptSentence: 'Although he worked / very hardly all week, / he failed to meet / the project deadline.',
          segments: ['Although he worked', 'very hardly all week,', 'he failed to meet', 'the project deadline.'],
          errorSegmentIndex: 1,
          correctedSegment: 'very hard all week,',
          feedbackExplanation: '"Hardly" significa "apenas". Para denotar esfuerzo o intensidad se emplea el adverbio "hard".'
        };
      } else if (selectedType === 'key_word_transformation') {
        return {
          exerciseId,
          type: 'key_word_transformation',
          category,
          instruction: 'Completa la segunda frase usando la palabra en mayúsculas para que signifique lo mismo:',
          baseSentence: 'The task was so demanding that none of the delegates could finish it.',
          keyWord: 'SUCH',
          targetSentenceTemplate: 'It was ___ that none of the delegates could finish it.',
          idealAnswer: 'such a demanding task',
          acceptableVariants: ['such a demanding assignment', 'such a demanding project'],
          feedbackExplanation: 'Se transforma "so + adjetivo" a la estructura compleja "such + a/an + adjetivo + sustantivo".'
        };
      } else {
        return {
          exerciseId,
          type: 'multiple_choice',
          category,
          instruction: 'Elige la opción más adecuada para completar la frase:',
          promptSentence: 'Despite the tight deadline, the engineering team ___ to finish the prototype.',
          options: ['managed', 'achieved', 'succeeded', 'could'],
          correctIndex: 0,
          feedbackExplanation: '"Manage to + infinitivo" expresa éxito al superar un obstáculo o dificultad.'
        };
      }
    }
  }
}

module.exports = new GeminiService();
