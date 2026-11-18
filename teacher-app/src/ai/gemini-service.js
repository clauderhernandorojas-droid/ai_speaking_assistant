/**
 * Gemini Service: Transcripción de Audio Multimodal y Evaluación IELTS con Gemini API
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

// Asegurar carga de .env en desarrollo y producción (app.isPackaged)
(() => {
  let envPath = null;
  try {
    const electron = require('electron');
    const electronApp = electron.app || electron.remote?.app;
    if (electronApp && electronApp.isPackaged && process.resourcesPath) {
      const prodEnv = path.join(process.resourcesPath, '.env');
      if (fs.existsSync(prodEnv)) envPath = prodEnv;
    }
  } catch (_) {}
  if (!envPath && process.resourcesPath) {
    const prodEnv = path.join(process.resourcesPath, '.env');
    if (fs.existsSync(prodEnv)) envPath = prodEnv;
  }
  if (!envPath) {
    const devEnv = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(devEnv)) envPath = devEnv;
  }
  if (envPath) {
    require('dotenv').config({ path: envPath, override: false });
  }
})();

class GeminiService {
  constructor() {
    // Modelo primario rápido por defecto
    this.primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    
    // Lista de modelos de fallback prioritarios
    this.fallbackModels = [
      'gemini-3.5-flash',
      'gemini-3.8-flash'
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
  async requestGemini(endpoint, payload, timeoutMs = 15000, preferredModels = null) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('No se encontró GEMINI_API_KEY ni GOOGLE_API_KEY en variables de entorno.');
    }

    let lastError = null;
    const modelsToTry = Array.isArray(preferredModels) && preferredModels.length > 0
      ? preferredModels
      : this.fallbackModels;

    // Iterar por la lista de modelos
    for (const model of modelsToTry) {
      const max503Retries = 2; // Máximo 2 reintentos por picos de demanda 503
      let attempt = 0;

      while (attempt <= max503Retries) {
        try {
          const result = await this.executeHttpRequest(model, endpoint, payload, apiKey, timeoutMs);
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

          // Si el modelo da Timeout, 404, 400 (ej. incompatibilidad INVALID_ARGUMENT) o 429 (cuota agotada), cambiar automáticamente al siguiente modelo
          if (err.message && (
            err.message.includes('Timeout') ||
            err.message.includes('404') ||
            err.message.includes('NOT_FOUND') ||
            err.message.includes('400') ||
            err.message.includes('INVALID_ARGUMENT') ||
            err.message.includes('429') ||
            err.message.includes('quota')
          )) {
            console.warn(`[GEMINI] Modelo '${model}' devolvió error o no disponible (${err.message.slice(0, 100)}...). Probando siguiente modelo de fallback...`);
            break;
          }

          // Errores de cliente (ej. 400), lanzar de inmediato
          throw err;
        }
      }
    }

    throw lastError;
  }

  executeHttpRequest(model, endpoint, payload, apiKey, timeoutMs = 15000) {
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

            // Monitoreo de consumo y tokens por clase
            if (data.usageMetadata) {
              const u = data.usageMetadata;
              console.log(`[GEMINI USAGE] Modelo: ${model} | Prompt: ${u.promptTokenCount || 0} tok | Candidatos: ${u.candidatesTokenCount || 0} tok | Total: ${u.totalTokenCount || 0} tok`);
            }

            resolve(data);
          } catch (e) {
            reject(new Error(`Error al parsear respuesta JSON de Gemini: ${e.message} - Body: ${responseBody.slice(0, 300)}`));
          }
        });
      });

      // Timeout configurable (por defecto 15s, ampliado a 35s en evaluación pedagógica)
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout de ${Math.round(timeoutMs / 1000)} segundos alcanzado al consultar Gemini (${model}).`));
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

    // Prompt mínimo y límite estricto de 350 tokens para reducir latencia y costo
    const payload = {
      contents: [
        {
          parts: [
            {
              text: "Transcribe verbatim in English. Return only the spoken words, or empty string if silent."
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
        maxOutputTokens: 350
      }
    };

    // Intentar primero modelo ligero de transcripción (gemini-3.5-flash-lite) con fallback directo al modelo primario (gemini-3.5-flash)
    const transcribeModels = [
      'gemini-3.5-flash-lite',
      this.primaryModel || 'gemini-3.5-flash'
    ];

    try {
      const result = await this.requestGemini('generateContent', payload, 15000, transcribeModels);
      let text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      text = text.trim();

      // Limpiar comillas, prefijos residuales del prompt o alucinaciones de formato
      text = text.replace(/^["']|["']$/g, '').trim();
      text = text.replace(/^(and\s+)?output\s+only\s+the\s+transcribed\s+text:?\s*/i, '');
      text = text.replace(/^transcribed\s+text:?\s*/i, '');
      text = text.replace(/^transcription:?\s*/i, '');

      // Descartar si el audio fue silencio o devolvió tokens de silencio
      if (
        !text ||
        text.toUpperCase().includes('[SILENCE]') ||
        text.toLowerCase() === 'silence' ||
        text.toLowerCase() === '[silence].' ||
        text.toLowerCase() === '""' ||
        text.toLowerCase() === "''" ||
        text.toLowerCase() === 'empty string' ||
        text.toLowerCase() === 'empty string.'
      ) {
        return '';
      }

      return text.trim();
    } catch (err) {
      console.error('[GEMINI ERROR DETALLADO]:', err);
      throw err;
    }
  }

  /**
   * Evalúa las intervenciones con Gemini contra los Band Descriptors de IELTS
   * con tolerancia ampliada de 35s y 1 reintento automático para evitar caídas en fallback por latencia.
   */
  async evaluateTranscript({ teacherContext, studentUtterance, studentLevel, systemPrompt, highPrecision = false }) {
    const apiKey = this.getApiKey();
    console.log('[GEMINI] Clave encontrada:', !!apiKey, 'Longitud:', apiKey ? apiKey.length : 0);

    const normLevel = (studentLevel || 'B1').toUpperCase().trim();

    const payload = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}

TEACHER'S CONTEXT / QUESTION: "${teacherContext || ''}"
TRANSCRIPTION (MAY INCLUDE 'DOCENTE:' AND 'ESTUDIANTE:' TURNS):
"""
${studentUtterance}
"""
CONFIRMED STUDENT CEFR LEVEL: "${normLevel}"

Analyze according to all instructions and output ONLY valid JSON without markdown wrapping.`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 6000,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    // Enrutamiento inteligente: por defecto 'gemini-3.5-flash-lite' para máxima economía; si highPrecision es true (Re-analizar), usa directamente 'gemini-3.5-flash'
    const evaluationModels = highPrecision
      ? [this.primaryModel || 'gemini-3.5-flash']
      : ['gemini-3.5-flash-lite', this.primaryModel || 'gemini-3.5-flash'];

    const maxAttempts = 2; // 1 intento inicial + 1 reintento automático (tolerancia 35s)
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[GEMINI evaluateTranscript] Intento ${attempt}/${maxAttempts} (${highPrecision ? 'Alta Precisión' : 'Económico'} - timeout: 35s)...`);
        const result = await this.requestGemini('generateContent', payload, 35000, evaluationModels);
        let text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        // Limpiar posibles bloques markdown ```json ... ```
        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(text);
        return parsed;
      } catch (err) {
        lastErr = err;
        console.warn(`[GEMINI evaluateTranscript] Falló el intento ${attempt}/${maxAttempts}: ${err.message || err}`);
        if (attempt < maxAttempts) {
          console.log('[GEMINI evaluateTranscript] Esperando 1.5s antes del reintento automático...');
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    console.error('[GEMINI evaluateTranscript] Agotados los 2 intentos con 35s de tolerancia. Lanzando error para fallback offline.');
    throw lastErr;
  }

  /**
   * Genera un micro-ejercicio interactivo con IA contrastivo intercalado (6 formatos y polaridad target/contrast)
   * 100% en inglés simple y accesible (A2/B1 teacher language) con cápsula contrastiva y targetPole.
   */
  async generateMicroExercise({ category = 'grammar', studentQuote = '', surgicalCorrection = '', explanation = '', targetLevel = 'B1', preferredType = null, contrastPolarity = 'target', attemptIndex = 0, seed = null, contrastiveCapsule = null } = {}) {
    const exerciseId = `ex_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const randomNonce = seed || `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const polarity = (contrastPolarity || 'target').toLowerCase() === 'contrast' ? 'contrast' : 'target';
    const targetPole = polarity === 'contrast' ? 'A' : 'B';

    // 1. Resolución del formato entre los 6 tipos soportados
    const validTypes = [
      'multiple_choice',
      'spot_the_error',
      'key_word_transformation',
      'error_correction_input',
      'sentence_unscramble',
      'open_cloze'
    ];
    const requested = (preferredType || '').toLowerCase().trim();
    let resolvedType = 'multiple_choice';

    if (validTypes.includes(requested)) {
      resolvedType = requested;
    } else {
      // Auto: rotación intercalada según nivel CEFR y número de intento
      const normLevel = (targetLevel || 'B1').toUpperCase().trim();
      const isHighLevel = ['B2', 'C1', 'C2'].includes(normLevel);
      const isUpgrade = (category || '').toLowerCase().includes('upgrade') || (category || '').toLowerCase() === 'c1';

      const highPool = ['key_word_transformation', 'open_cloze', 'error_correction_input', 'spot_the_error', 'sentence_unscramble', 'multiple_choice'];
      const basePool = ['multiple_choice', 'sentence_unscramble', 'spot_the_error', 'open_cloze', 'error_correction_input'];
      const pool = (isUpgrade || isHighLevel) ? highPool : basePool;
      resolvedType = pool[attemptIndex % pool.length] || pool[0];
    }

    console.log(`[GEMINI generateMicroExercise] resolvedType: "${resolvedType}", polarity: "${polarity}" (targetPole: ${targetPole}), attempt: ${attemptIndex}, level: "${targetLevel}", cat: "${category}"`);

    // 2. Construcción de instrucciones y esquema JSON exclusivo para resolvedType en 100% inglés simple
    let typeInstructions = '';
    let jsonSchemaExample = '';

    if (resolvedType === 'spot_the_error') {
      typeInstructions = `TASK: SPOT THE ERROR (Diagnostic Practice)
Create a single coherent English sentence divided into EXACTLY 4 sequential segments.
- EXACTLY ONE segment MUST contain a subtle error based on the active target pole (${targetPole}).
  * If targetPole is "B" (Target): The error violates the Target Rule (Form B).
  * If targetPole is "A" (Contrast): The sentence context requires Form A, but incorrectly overgeneralizes Form B (or vice versa).
- "segments": Array of EXACTLY 4 strings. When read in order (0 -> 1 -> 2 -> 3), they form the full sentence.
- "errorSegmentIndex": Integer (0, 1, 2, or 3) indicating which segment has the error.
- "correctedSegment": The exact replacement string showing how that segment should read.
- "promptSentence": The full sentence as a single coherent string.
- "instruction": "Find and click the segment that contains the error:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "spot_the_error",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "targetPole": "${targetPole}",
  "instruction": "Find and click the segment that contains the error:",
  "promptSentence": "Although the team worked very hardly all week, they failed to meet the deadline.",
  "segments": ["Although the team worked", "very hardly all week,", "they failed to meet", "the deadline."],
  "errorSegmentIndex": 1,
  "correctedSegment": "very hard all week,",
  "feedbackExplanation": "Use 'hard' to describe working with high effort. 'Hardly' means almost not at all."
}`;
    } else if (resolvedType === 'key_word_transformation') {
      typeInstructions = `TASK: KEY WORD TRANSFORMATION (Cambridge C1 / B2 Style)
Create a Cambridge-style Key Word Transformation task.
- "baseSentence": A complete, natural sentence presenting the original idea.
- "keyWord": A single invariable pivot word in CAPITAL letters (e.g. "INSTEAD", "USED", "RATHER", "DESPITE", "BY", "ORDER", "PREVENT", "UNLESS", "POINT").
  STRICT RULE: NEVER provide the main verb or simple inflected word alone as the keyWord (e.g. NEVER give "WENT" or "BOUGHT").
- "targetSentenceTemplate": A second sentence with the exact same meaning, containing a blank "___" where the transformed words fit.
- "idealAnswer": The model phrase that fills "___" (MUST contain between 2 and 5 words, including the keyWord).
- "acceptableVariants": Array of 2 to 4 valid grammatical variants that accurately complete the gap using the keyWord.
- "instruction": "Complete the second sentence using the CAPITAL word so that it has the same meaning:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "key_word_transformation",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "targetPole": "${targetPole}",
  "instruction": "Complete the second sentence using the CAPITAL word so that it has the same meaning:",
  "baseSentence": "The task was so demanding that we needed external assistance.",
  "keyWord": "SUCH",
  "targetSentenceTemplate": "It was ___ that we needed external assistance.",
  "idealAnswer": "such a demanding task",
  "acceptableVariants": ["such a demanding assignment", "such a demanding job"],
  "feedbackExplanation": "Use 'such + a/an + adjective + noun' to replace 'so + adjective' with extra emphasis."
}`;
    } else if (resolvedType === 'error_correction_input') {
      typeInstructions = `TASK: ERROR CORRECTION INPUT (Proofreading & Correction)
Create a natural sentence containing EXACTLY ONE subtle grammatical, lexical, or collocational error according to polarity (${polarity.toUpperCase()}).
- "faultySentence": The sentence containing the error (unmarked, no highlights or hints).
- "idealAnswer": The complete grammatically correct sentence (or the exact corrected phrase).
- "acceptableVariants": Array of 1 to 3 valid variant corrections (e.g. just the corrected word/phrase vs the full corrected sentence).
- "instruction": "Find the error in the sentence and write the correction:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "error_correction_input",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "targetPole": "${targetPole}",
  "instruction": "Find the error in the sentence and write the correction:",
  "faultySentence": "She has visited the historical museum yesterday afternoon.",
  "idealAnswer": "She visited the historical museum yesterday afternoon.",
  "acceptableVariants": ["visited", "She visited the museum yesterday afternoon."],
  "feedbackExplanation": "Use Past Simple with specific finished time expressions like 'yesterday', not Present Perfect."
}`;
    } else if (resolvedType === 'sentence_unscramble') {
      typeInstructions = `TASK: SENTENCE UNSCRAMBLE (Syntax & Collocation Reordering)
Create a natural, idiomatic English sentence demonstrating the grammatical pattern or collocation.
- Break the sentence into EXACTLY 5 or 6 meaningful chunks (not individual words, but logical segments like subject, verb phrase, prepositional phrase).
- "shuffledChunks": Array of the 5 or 6 chunks in RANDOM, scrambled order.
- "correctSentence": The single correct, fluent English sentence with proper punctuation.
- "instruction": "Put the blocks in order to form the correct sentence:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "sentence_unscramble",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "targetPole": "${targetPole}",
  "instruction": "Put the blocks in order to form the correct sentence:",
  "shuffledChunks": ["to submit", "before Friday noon", "reminded the staff", "the project report", "the manager"],
  "correctSentence": "The manager reminded the staff to submit the project report before Friday noon.",
  "feedbackExplanation": "Pattern: Subject + verb ('reminded') + person ('the staff') + to-infinitive ('to submit')."
}`;
    } else if (resolvedType === 'open_cloze') {
      typeInstructions = `TASK: OPEN CLOZE (Single-Word Gap Fill)
Create a natural sentence with a single blank "___" that can ONLY be filled by a single functional/grammatical word (preposition, auxiliary, pronoun, determiner, particle, or connector).
- "promptSentence": The sentence with exactly one "___" blank.
- "idealAnswer": A SINGLE English word (no phrases) that accurately completes the gap.
- "acceptableVariants": Array of valid variant words (e.g. contracted form or accepted synonym preposition).
- "instruction": "Type the single exact word that completes the gap:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "open_cloze",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "targetPole": "${targetPole}",
  "instruction": "Type the single exact word that completes the gap:",
  "promptSentence": "The team succeeded ___ completing the audit ahead of schedule.",
  "idealAnswer": "in",
  "acceptableVariants": ["in"],
  "feedbackExplanation": "The verb 'succeed' is followed by the preposition 'in' and an -ing verb."
}`;
    } else { // multiple_choice
      typeInstructions = `TASK: MULTIPLE CHOICE (4 Contrastive Options)
Create a brand new sentence with a blank formatted as "___".
- "promptSentence": The new sentence containing "___" (do NOT use identical wording from the student quote).
- "options": Array of EXACTLY 4 realistic options. Exactly 1 is correct based on polarity (${polarity.toUpperCase()}), and 3 are subtle contrastive distractors.
  * When POLARITY is "TARGET" (targetPole: "B"): correct option is Form B (Target Rule); distractors represent Form A or common false analogies.
  * When POLARITY is "CONTRAST" (targetPole: "A"): correct option is Form A (Contrast Rule); distractors represent an overgeneralized Form B.
- "correctIndex": Integer (0, 1, 2, or 3) indicating the correct answer in "options".
- "instruction": "Choose the best option to complete the sentence:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "multiple_choice",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "targetPole": "${targetPole}",
  "instruction": "Choose the best option to complete the sentence:",
  "promptSentence": "Despite the tight deadline, the engineering team ___ to finish the prototype.",
  "options": ["managed", "achieved", "succeeded", "could"],
  "correctIndex": 0,
  "feedbackExplanation": "Use 'managed to + verb' to express successfully overcoming a challenge."
}`;
    }

    const capsuleContext = contrastiveCapsule ? `
CONTRASTIVE CAPSULE IN CONTEXT:
- Form A (Pole A): ${contrastiveCapsule.poleA?.label || 'Form A'} -> ${contrastiveCapsule.poleA?.rule || ''} (e.g. "${contrastiveCapsule.poleA?.example || ''}")
- Form B (Target Pole B): ${contrastiveCapsule.poleB?.label || 'Form B'} -> ${contrastiveCapsule.poleB?.rule || ''} (e.g. "${contrastiveCapsule.poleB?.example || ''}")
` : '';

    const systemInstruction = `You are a certified IELTS / Cambridge English Master Teacher designing an interactive contrastive micro-exercise for an English learner at CEFR ${targetLevel} level.
Variation Nonce: ${randomNonce}

DIAGNOSED LEARNER NEED:
- Category: ${category}
- Student's original phrase: "${studentQuote}"
- Teacher's surgical correction: "${surgicalCorrection}"
- Pedagogical explanation: "${explanation}"
${capsuleContext}

LANGUAGE & PEDAGOGICAL CLARITY DIRECTIVE (STRICT 100% ENGLISH):
1. 100% ENGLISH ONLY: All instructions, prompt sentences, options, and explanations MUST be written in English. NEVER output Spanish.
2. GRADED TEACHER LANGUAGE (A2/B1 Level for explanations): Write "feedbackExplanation" and instructions using simple, direct, everyday English (A2/B1 level). Avoid complex linguistic jargon (do NOT use words like "subjunctive", "gerundive", "volition", "aspectual").

STRUCTURAL INTERLEAVING & ACTIVE POLARITY:
- Active Polarity: "${polarity.toUpperCase()}" -> Target Pole: "${targetPole}"
- If targetPole is "B" (Target): The exercise tests correct application of Form B (the Target Rule).
- If targetPole is "A" (Contrast): The exercise tests correct application of Form A (the Contrastive Rule), preventing overgeneralization.

${typeInstructions}

MANDATORY RULES:
1. TRANSFER OF LEARNING: Do NOT reuse the same root verb, noun, or key content word from the student's quote.
2. "feedbackExplanation": Short, simple A2/B1 English explanation (max 20 words).
3. Return ONLY a valid JSON object matching this schema without markdown or comments:
${jsonSchemaExample}`;

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

      const parsedTargetPole = (parsed.targetPole && ['A', 'B'].includes(parsed.targetPole))
        ? parsed.targetPole
        : targetPole;

      const baseResult = {
        exerciseId: parsed.exerciseId || exerciseId,
        type: resolvedType,
        category: parsed.category || category,
        contrastPolarity: polarity,
        targetPole: parsedTargetPole,
        contrastiveCapsule: contrastiveCapsule || parsed.contrastiveCapsule || null,
        instruction: parsed.instruction || (
          resolvedType === 'spot_the_error' ? 'Find and click the segment that contains the error:' :
          resolvedType === 'key_word_transformation' ? 'Complete the second sentence using the CAPITAL word so that it has the same meaning:' :
          resolvedType === 'error_correction_input' ? 'Find the error in the sentence and write the correction:' :
          resolvedType === 'sentence_unscramble' ? 'Put the blocks in order to form the correct sentence:' :
          resolvedType === 'open_cloze' ? 'Type the single exact word that completes the gap:' :
          'Choose the best option to complete the sentence:'
        ),
        feedbackExplanation: parsed.feedbackExplanation || explanation || 'Correct answer matching the targeted structure.'
      };

      if (resolvedType === 'spot_the_error') {
        const segs = Array.isArray(parsed.segments) && parsed.segments.length === 4
          ? parsed.segments
          : ['Although the team worked', 'very hardly all week,', 'they failed to meet', 'the deadline.'];
        const errIdx = typeof parsed.errorSegmentIndex === 'number' && parsed.errorSegmentIndex >= 0 && parsed.errorSegmentIndex < 4
          ? parsed.errorSegmentIndex
          : 1;
        return {
          ...baseResult,
          segments: segs,
          errorSegmentIndex: errIdx,
          correctedSegment: parsed.correctedSegment || (segs[errIdx] || 'corrected phrase'),
          promptSentence: parsed.promptSentence || segs.join(' ')
        };
      } else if (resolvedType === 'key_word_transformation') {
        const baseSentence = parsed.baseSentence || 'The task was so demanding that we needed external assistance.';
        const keyWord = (parsed.keyWord || 'SUCH').toUpperCase().trim();
        const targetSentenceTemplate = parsed.targetSentenceTemplate || 'It was ___ that we needed external assistance.';
        const idealAnswer = (parsed.idealAnswer || 'such a demanding task').trim();
        let variants = Array.isArray(parsed.acceptableVariants)
          ? parsed.acceptableVariants.map(v => (v || '').trim()).filter(Boolean)
          : [];

        if (idealAnswer.includes("'")) {
          const expanded = idealAnswer
            .replace(/'d\b/g, ' would')
            .replace(/'ve\b/g, ' have')
            .replace(/'re\b/g, ' are')
            .replace(/'m\b/g, ' am')
            .replace(/'s\b/g, ' is')
            .replace(/n't\b/g, ' not');
          if (expanded !== idealAnswer && !variants.includes(expanded)) {
            variants.push(expanded);
          }
        }
        if (idealAnswer.includes('would ') || idealAnswer.includes('have ') || idealAnswer.includes('not ')) {
          const contracted = idealAnswer
            .replace(/\bwould\b/g, "'d")
            .replace(/\bhave\b/g, "'ve")
            .replace(/\bare\b/g, "'re")
            .replace(/\bis\b/g, "'s")
            .replace(/\bnot\b/g, "n't");
          if (contracted !== idealAnswer && !variants.includes(contracted)) {
            variants.push(contracted);
          }
        }

        return {
          ...baseResult,
          baseSentence,
          keyWord,
          targetSentenceTemplate,
          idealAnswer,
          acceptableVariants: variants
        };
      } else if (resolvedType === 'error_correction_input') {
        return {
          ...baseResult,
          faultySentence: parsed.faultySentence || 'She has visited the historical museum yesterday afternoon.',
          idealAnswer: (parsed.idealAnswer || 'She visited the historical museum yesterday afternoon.').trim(),
          acceptableVariants: Array.isArray(parsed.acceptableVariants) ? parsed.acceptableVariants : ['visited']
        };
      } else if (resolvedType === 'sentence_unscramble') {
        const chunks = Array.isArray(parsed.shuffledChunks) && parsed.shuffledChunks.length >= 4
          ? parsed.shuffledChunks
          : ['to submit', 'before Friday noon', 'reminded the staff', 'the project report', 'the manager'];
        return {
          ...baseResult,
          shuffledChunks: chunks,
          correctSentence: parsed.correctSentence || 'The manager reminded the staff to submit the project report before Friday noon.'
        };
      } else if (resolvedType === 'open_cloze') {
        const rawSentence = parsed.promptSentence || 'The team succeeded ___ completing the audit ahead of schedule.';
        const sentenceWithGap = rawSentence.includes('___') ? rawSentence : `${rawSentence} ___`;
        return {
          ...baseResult,
          promptSentence: sentenceWithGap,
          idealAnswer: (parsed.idealAnswer || 'in').trim().toLowerCase(),
          acceptableVariants: Array.isArray(parsed.acceptableVariants) ? parsed.acceptableVariants.map(v => String(v).trim().toLowerCase()) : []
        };
      } else { // multiple_choice
        const opts = Array.isArray(parsed.options) && parsed.options.length >= 4
          ? parsed.options.slice(0, 4)
          : ['managed', 'achieved', 'succeeded', 'could'];
        const corrIdx = typeof parsed.correctIndex === 'number' && parsed.correctIndex >= 0 && parsed.correctIndex < opts.length
          ? parsed.correctIndex
          : 0;
        let promptSentence = parsed.promptSentence || 'Despite the tight deadline, the engineering team ___ to finish the prototype.';
        if (!promptSentence.includes('___')) {
          promptSentence = promptSentence.trim() + ' ___';
        }
        return {
          ...baseResult,
          promptSentence,
          options: opts,
          correctIndex: corrIdx
        };
      }
    } catch (err) {
      console.error(`[GEMINI Micro-Exercise Error para ${resolvedType}]:`, err && err.message ? err.message : err);
      // Fallback seguro 100% en inglés simple según el resolvedType solicitado y polaridad
      const fallbackResult = {
        exerciseId,
        type: resolvedType,
        category,
        contrastPolarity: polarity,
        targetPole,
        contrastiveCapsule: contrastiveCapsule || null
      };

      if (resolvedType === 'spot_the_error') {
        return {
          ...fallbackResult,
          instruction: 'Find and click the segment that contains the error:',
          promptSentence: 'Although he worked very hardly all week, he failed to meet the project deadline.',
          segments: ['Although he worked', 'very hardly all week,', 'he failed to meet', 'the project deadline.'],
          errorSegmentIndex: 1,
          correctedSegment: 'very hard all week,',
          feedbackExplanation: 'Use "hard" to express working with effort. "Hardly" means almost not at all.'
        };
      } else if (resolvedType === 'key_word_transformation') {
        return {
          ...fallbackResult,
          instruction: 'Complete the second sentence using the CAPITAL word so that it has the same meaning:',
          baseSentence: 'The task was so demanding that none of the delegates could finish it.',
          keyWord: 'SUCH',
          targetSentenceTemplate: 'It was ___ that none of the delegates could finish it.',
          idealAnswer: 'such a demanding task',
          acceptableVariants: ['such a demanding assignment', 'such a demanding project'],
          feedbackExplanation: 'Transform "so + adjective" into "such + a/an + adjective + noun" for emphasis.'
        };
      } else if (resolvedType === 'error_correction_input') {
        return {
          ...fallbackResult,
          instruction: 'Find the error in the sentence and write the correction:',
          faultySentence: polarity === 'contrast'
            ? 'She is going to the fitness center every single morning.'
            : 'She has arrived in London two days ago.',
          idealAnswer: polarity === 'contrast'
            ? 'She goes to the fitness center every single morning.'
            : 'She arrived in London two days ago.',
          acceptableVariants: polarity === 'contrast' ? ['goes'] : ['arrived'],
          feedbackExplanation: polarity === 'contrast'
            ? 'Use Present Simple for daily habits, not Present Continuous.'
            : 'Use Past Simple for specific finished time points like "two days ago".'
        };
      } else if (resolvedType === 'sentence_unscramble') {
        return {
          ...fallbackResult,
          instruction: 'Put the blocks in order to form the correct sentence:',
          shuffledChunks: ['to submit', 'before Friday noon', 'reminded the staff', 'the project report', 'the manager'],
          correctSentence: 'The manager reminded the staff to submit the project report before Friday noon.',
          feedbackExplanation: 'Correct word order: Subject + verb ("reminded") + person ("the staff") + to-infinitive ("to submit").'
        };
      } else if (resolvedType === 'open_cloze') {
        return {
          ...fallbackResult,
          instruction: 'Type the single exact word that completes the gap:',
          promptSentence: 'The team succeeded ___ completing the audit ahead of schedule.',
          idealAnswer: 'in',
          acceptableVariants: ['in'],
          feedbackExplanation: 'The verb "succeed" takes the preposition "in" followed by a gerund.'
        };
      } else {
        return {
          ...fallbackResult,
          instruction: 'Choose the best option to complete the sentence:',
          promptSentence: 'Despite the tight deadline, the engineering team ___ to finish the prototype.',
          options: ['managed', 'achieved', 'succeeded', 'could'],
          correctIndex: 0,
          feedbackExplanation: '"Manage to + infinitive" indicates successfully overcoming a difficulty.'
        };
      }
    }
  }
}

module.exports = new GeminiService();
