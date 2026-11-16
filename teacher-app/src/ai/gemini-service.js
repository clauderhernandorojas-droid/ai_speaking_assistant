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
              text: `You are an expert verbatim English audio transcriber.
Transcribe the following audio recording verbatim. Output ONLY the transcribed text in English without commentary.
Keep all grammatical errors, stuttering, hesitations, and false starts intact.

ACCENT AND VOLUME INSTRUCTIONS:
- Transcribe ALL spoken English, including quiet speech, low volume, non-native accents, and Spanish phonetic interference (e.g. pronouncing "eschool", "I sink", "goed", "yesterday I go").
- Never judge or drop speech because of accent or grammatical errors. If human speech is present, transcribe what you hear literally.

SILENCE RULE:
- Output EXCLUSIVELY [SILENCE] ONLY if the audio contains 100% dead silence, background noise, or static with ABSOLUTELY ZERO spoken words.
- If ANY words or attempts at speaking English are heard, transcribe them and do NOT output [SILENCE].`
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
        temperature: 0.0,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    try {
      const result = await this.requestGemini('generateContent', payload);
      let text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      text = text.trim();

      // Limpiar prefijos residuales del prompt o alucinaciones de formato
      text = text.replace(/^(and\s+)?output\s+only\s+the\s+transcribed\s+text:?\s*/i, '');
      text = text.replace(/^transcribed\s+text:?\s*/i, '');
      text = text.replace(/^transcription:?\s*/i, '');

      // Descartar si el audio fue silencio o devolvió el token [SILENCE]
      if (
        !text ||
        text.toUpperCase().includes('[SILENCE]') ||
        text.toLowerCase() === 'silence' ||
        text.toLowerCase() === '[silence].' ||
        text.toLowerCase() === '""'
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
   * Genera un micro-ejercicio interactivo con IA contrastivo intercalado (6 formatos y polaridad target/contrast)
   */
  async generateMicroExercise({ category = 'grammar', studentQuote = '', surgicalCorrection = '', explanation = '', targetLevel = 'B1', preferredType = null, contrastPolarity = 'target', attemptIndex = 0, seed = null } = {}) {
    const exerciseId = `ex_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const randomNonce = seed || `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const polarity = (contrastPolarity || 'target').toLowerCase() === 'contrast' ? 'contrast' : 'target';

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

    console.log(`[GEMINI generateMicroExercise] resolvedType: "${resolvedType}", polarity: "${polarity}", attempt: ${attemptIndex}, level: "${targetLevel}", cat: "${category}"`);

    // 2. Construcción de instrucciones y esquema JSON exclusivo para resolvedType
    let typeInstructions = '';
    let jsonSchemaExample = '';

    if (resolvedType === 'spot_the_error') {
      typeInstructions = `TASK: SPOT THE ERROR (Grammar / Vocabulary Diagnostic)
Create a single coherent English sentence divided into EXACTLY 4 sequential segments.
- EXACTLY ONE segment MUST contain a subtle error based on the active polarity (${polarity.toUpperCase()}).
  * If POLARITY is "TARGET": error violates the Target Rule (other 3 segments are flawless).
  * If POLARITY is "CONTRAST": sentence requires the Contrast Rule, but incorrectly uses the Target Rule (or vice versa).
- "segments": Array of EXACTLY 4 strings. When read in order (0 -> 1 -> 2 -> 3), they form the full sentence.
- "errorSegmentIndex": Integer (0, 1, 2, or 3) indicating which segment has the error.
- "correctedSegment": The exact replacement string showing how that segment should read.
- "promptSentence": The full sentence as a single coherent string.
- "instruction": "Encuentra y pulsa el segmento que contiene el error:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "spot_the_error",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "instruction": "Encuentra y pulsa el segmento que contiene el error:",
  "promptSentence": "Although the team worked very hardly all week, they failed to meet the deadline.",
  "segments": ["Although the team worked", "very hardly all week,", "they failed to meet", "the deadline."],
  "errorSegmentIndex": 1,
  "correctedSegment": "very hard all week,",
  "feedbackExplanation": "Concise pedagogical explanation in Spanish (max 20 words)"
}`;
    } else if (resolvedType === 'key_word_transformation') {
      typeInstructions = `TASK: KEY WORD TRANSFORMATION (Cambridge C1 / B2 Style)
Create a Cambridge-style Key Word Transformation task.
- "baseSentence": A complete, natural sentence presenting the original idea.
- "keyWord": A single invariable pivot word in CAPITAL letters (e.g. "INSTEAD", "USED", "RATHER", "DESPITE", "BY", "ORDER", "PREVENT", "UNLESS", "POINT").
  STRICT RULE: NEVER provide the main verb or simple inflected word alone as the keyWord (e.g. NEVER give "WENT" or "BOUGHT").
- "targetSentenceTemplate": A second sentence with the exact same meaning, containing a blank "___" where the transformed words fit.
- "idealAnswer": The model phrase that fills "___" (MUST contain between 2 and 5 words, including the keyWord).
- "acceptableVariants": Array of 2 to 4 valid grammatical variants that accurately complete the gap using the keyWord (e.g. if idealAnswer is "a wide variety of", also include "a variety of" and "a great variety of" if grammatically equivalent; include contracted vs full forms such as "would have been able to" / "'d have been able to"; include common equivalent collocations or qualifiers).
- "instruction": "Completa la segunda frase usando la palabra en mayúsculas para que signifique lo mismo que la primera:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "key_word_transformation",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "instruction": "Completa la segunda frase usando la palabra en mayúsculas para que signifique lo mismo que la primera:",
  "baseSentence": "The task was so demanding that we needed external assistance.",
  "keyWord": "SUCH",
  "targetSentenceTemplate": "It was ___ that we needed external assistance.",
  "idealAnswer": "such a demanding task",
  "acceptableVariants": ["such a demanding assignment", "such a demanding job"],
  "feedbackExplanation": "Concise pedagogical explanation in Spanish (max 20 words)"
}`;
    } else if (resolvedType === 'error_correction_input') {
      typeInstructions = `TASK: ERROR CORRECTION INPUT (Proofreading & Correction)
Create a natural sentence containing EXACTLY ONE subtle grammatical, lexical, or collocational error according to polarity (${polarity.toUpperCase()}).
- "faultySentence": The sentence containing the error (unmarked, no highlights or hints).
- "idealAnswer": The complete grammatically correct sentence (or the exact corrected phrase).
- "acceptableVariants": Array of 1 to 3 valid variant corrections (e.g. just the corrected word/phrase vs the full corrected sentence).
- "instruction": "Encuentra el error en la frase y escribe la corrección adecuada:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "error_correction_input",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "instruction": "Encuentra el error en la frase y escribe la corrección adecuada:",
  "faultySentence": "She has visited the historical museum yesterday afternoon.",
  "idealAnswer": "She visited the historical museum yesterday afternoon.",
  "acceptableVariants": ["visited", "She visited the museum yesterday afternoon."],
  "feedbackExplanation": "Con expresiones de tiempo pasado definido como 'yesterday' se usa Past Simple, no Present Perfect."
}`;
    } else if (resolvedType === 'sentence_unscramble') {
      typeInstructions = `TASK: SENTENCE UNSCRAMBLE (Syntax & Collocation Reordering)
Create a natural, idiomatic English sentence demonstrating the grammatical pattern or collocation.
- Break the sentence into EXACTLY 5 or 6 meaningful chunks (not individual words, but logical segments like subject, verb phrase, prepositional phrase).
- "shuffledChunks": Array of the 5 or 6 chunks in RANDOM, scrambled order.
- "correctSentence": The single correct, fluent English sentence with proper punctuation.
- "instruction": "Ordena los bloques para formar la oración gramaticalmente correcta:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "sentence_unscramble",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "instruction": "Ordena los bloques para formar la oración gramaticalmente correcta:",
  "shuffledChunks": ["to submit", "before Friday noon", "reminded the staff", "the project report", "the manager"],
  "correctSentence": "The manager reminded the staff to submit the project report before Friday noon.",
  "feedbackExplanation": "Estructura correcta: Sujeto + verbo ('reminded') + objeto ('the staff') + infinitivo con to ('to submit')."
}`;
    } else if (resolvedType === 'open_cloze') {
      typeInstructions = `TASK: OPEN CLOZE (Cambridge Style Single-Word Gap Fill)
Create a natural sentence with a single blank "___" that can ONLY be filled by a single functional/grammatical word (preposition, auxiliary, pronoun, determiner, particle, or connector).
- "promptSentence": The sentence with exactly one "___" blank.
- "idealAnswer": A SINGLE English word (no phrases) that accurately completes the gap.
- "acceptableVariants": Array of valid variant words (e.g. contracted form or accepted synonym preposition).
- "instruction": "Escribe la única palabra exacta que completa el hueco:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "open_cloze",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "instruction": "Escribe la única palabra exacta que completa el hueco:",
  "promptSentence": "The team succeeded ___ completing the audit ahead of schedule.",
  "idealAnswer": "in",
  "acceptableVariants": ["in"],
  "feedbackExplanation": "El verbo 'succeed' rige obligatoriamente la preposición 'in' seguida de gerundio."
}`;
    } else { // multiple_choice
      typeInstructions = `TASK: MULTIPLE CHOICE (4 Contrastive Options)
Create a brand new sentence with a blank formatted as "___".
- "promptSentence": The new sentence containing "___" (do NOT use identical wording from the student quote).
- "options": Array of EXACTLY 4 realistic options. Exactly 1 is correct based on polarity (${polarity.toUpperCase()}), and 3 are subtle contrastive distractors.
  * When POLARITY is "TARGET": correct option is the Target Rule; distractors represent the Contrast Rule or common false analogies.
  * When POLARITY is "CONTRAST": correct option is the Contrast Rule; distractors represent the overgeneralized Target Rule.
- "correctIndex": Integer (0, 1, 2, or 3) indicating the correct answer in "options".
- "instruction": "Elige la opción más adecuada para completar la frase:"`;

      jsonSchemaExample = `{
  "exerciseId": "${exerciseId}",
  "type": "multiple_choice",
  "category": "${category}",
  "contrastPolarity": "${polarity}",
  "instruction": "Elige la opción más adecuada para completar la frase:",
  "promptSentence": "Despite the tight deadline, the engineering team ___ to finish the prototype.",
  "options": ["managed", "achieved", "succeeded", "could"],
  "correctIndex": 0,
  "feedbackExplanation": "Concise pedagogical explanation in Spanish (max 20 words)"
}`;
    }

    const systemInstruction = `You are a Senior Cambridge English / IELTS Examiner designing an interactive contrastive micro-exercise for an English learner at CEFR ${targetLevel} level.
Variation Nonce: ${randomNonce}

DIAGNOSED LEARNER NEED:
- Category: ${category}
- Student's original phrase: "${studentQuote}"
- Teacher's surgical correction: "${surgicalCorrection}"
- Pedagogical explanation: "${explanation}"

CONTRASTIVE OPPOSITION SYSTEM:
First, identify the linguistic opposition pair:
- Target Rule: The grammatical, lexical, or collocational rule that corrects the student's phrase.
- Contrast Rule: The opposing, competing, or alternate structure learners frequently confuse with it (e.g. Past Simple vs Present Perfect, Gerund vs Infinitive, State vs Action verbs, In vs On/At, Active vs Passive, Standard vs Inverted C1 syntax).

ACTIVE POLARITY: "${polarity.toUpperCase()}"
- If POLARITY is "TARGET": The exercise demands correctly applying the TARGET RULE.
- If POLARITY is "CONTRAST": The exercise demands correctly applying the CONTRAST RULE (the opposing structure), or spotting/correcting an incorrect overextension of the Target Rule in an opposing context.

${typeInstructions}

MANDATORY RULES:
1. TRANSFER OF LEARNING: Do NOT reuse the same root verb, noun, or key content word where the student made the error (e.g. if the student erred on 'goed'/'went', test the irregular simple past rule using a completely different verb such as 'bought', 'saw', 'wrote', 'took', or 'spoke').
2. "feedbackExplanation": Concise pedagogical explanation in Spanish (max 20 words) explaining why the correct answer is right.
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

      const baseResult = {
        exerciseId: parsed.exerciseId || exerciseId,
        type: resolvedType, // Siempre forzar el resolvedType
        category: parsed.category || category,
        contrastPolarity: polarity,
        instruction: parsed.instruction || (
          resolvedType === 'spot_the_error' ? 'Encuentra y pulsa el segmento que contiene el error:' :
          resolvedType === 'key_word_transformation' ? 'Completa la segunda frase usando la palabra en mayúsculas para que signifique lo mismo que la primera:' :
          resolvedType === 'error_correction_input' ? 'Encuentra el error en la frase y escribe la corrección adecuada:' :
          resolvedType === 'sentence_unscramble' ? 'Ordena los bloques para formar la oración gramaticalmente correcta:' :
          resolvedType === 'open_cloze' ? 'Escribe la única palabra exacta que completa el hueco:' :
          'Elige la opción más adecuada para completar la frase:'
        ),
        feedbackExplanation: parsed.feedbackExplanation || explanation || 'Opción correcta acorde a la regla evaluada.'
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

        // Generar variantes estándar comunes si faltan (ej. contracciones vs formas completas)
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
      // Fallback seguro según el resolvedType solicitado y polaridad
      if (resolvedType === 'spot_the_error') {
        return {
          exerciseId,
          type: 'spot_the_error',
          category,
          contrastPolarity: polarity,
          instruction: 'Encuentra y pulsa el segmento que contiene el error:',
          promptSentence: 'Although he worked very hardly all week, he failed to meet the project deadline.',
          segments: ['Although he worked', 'very hardly all week,', 'he failed to meet', 'the project deadline.'],
          errorSegmentIndex: 1,
          correctedSegment: 'very hard all week,',
          feedbackExplanation: '"Hardly" significa "apenas". Para denotar esfuerzo o intensidad se emplea el adverbio "hard".'
        };
      } else if (resolvedType === 'key_word_transformation') {
        return {
          exerciseId,
          type: 'key_word_transformation',
          category,
          contrastPolarity: polarity,
          instruction: 'Completa la segunda frase usando la palabra en mayúsculas para que signifique lo mismo que la primera:',
          baseSentence: 'The task was so demanding that none of the delegates could finish it.',
          keyWord: 'SUCH',
          targetSentenceTemplate: 'It was ___ that none of the delegates could finish it.',
          idealAnswer: 'such a demanding task',
          acceptableVariants: ['such a demanding assignment', 'such a demanding project'],
          feedbackExplanation: 'Se transforma "so + adjetivo" a la estructura compleja "such + a/an + adjetivo + sustantivo".'
        };
      } else if (resolvedType === 'error_correction_input') {
        return {
          exerciseId,
          type: 'error_correction_input',
          category,
          contrastPolarity: polarity,
          instruction: 'Encuentra el error en la frase y escribe la corrección adecuada:',
          faultySentence: polarity === 'contrast'
            ? 'She is going to the fitness center every single morning.'
            : 'She has arrived in London two days ago.',
          idealAnswer: polarity === 'contrast'
            ? 'She goes to the fitness center every single morning.'
            : 'She arrived in London two days ago.',
          acceptableVariants: polarity === 'contrast' ? ['goes'] : ['arrived'],
          feedbackExplanation: 'Para acciones habituales se usa Present Simple; con fechas pasadas concretas se usa Past Simple.'
        };
      } else if (resolvedType === 'sentence_unscramble') {
        return {
          exerciseId,
          type: 'sentence_unscramble',
          category,
          contrastPolarity: polarity,
          instruction: 'Ordena los bloques para formar la oración gramaticalmente correcta:',
          shuffledChunks: ['to submit', 'before Friday noon', 'reminded the staff', 'the project report', 'the manager'],
          correctSentence: 'The manager reminded the staff to submit the project report before Friday noon.',
          feedbackExplanation: 'Orden natural: Sujeto + verbo + complemento de persona + infinitivo con "to".'
        };
      } else if (resolvedType === 'open_cloze') {
        return {
          exerciseId,
          type: 'open_cloze',
          category,
          contrastPolarity: polarity,
          instruction: 'Escribe la única palabra exacta que completa el hueco:',
          promptSentence: 'The team succeeded ___ completing the audit ahead of schedule.',
          idealAnswer: 'in',
          acceptableVariants: ['in'],
          feedbackExplanation: 'El verbo "succeed" rige la preposición "in".'
        };
      } else {
        return {
          exerciseId,
          type: 'multiple_choice',
          category,
          contrastPolarity: polarity,
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
