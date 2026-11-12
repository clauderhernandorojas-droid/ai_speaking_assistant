/**
 * IELTS Rubric Engine: Orquestador Pedagógico
 * Evalúa las intervenciones limpias del alumno frente a los IELTS Speaking Band Descriptors
 * según su nivel CEFR (B1, B2, C1), distribuyendo el análisis en las 5 pestañas maestras.
 */

const grammarPrompt = require('./prompts/grammar-syntax');
const vocabularyPrompt = require('./prompts/vocabulary-colloc');
const pronunciationPrompt = require('./prompts/pronunciation');
const upgradePrompt = require('./prompts/upgrade-c1');
const fluencyPrompt = require('./prompts/fluency-cohesion');
const geminiService = require('./gemini-service');

class IELTSEngine {
  constructor() {
    this.prompts = {
      grammar: grammarPrompt,
      vocabulary: vocabularyPrompt,
      pronunciation: pronunciationPrompt,
      upgrade_c1: upgradePrompt,
      fluency: fluencyPrompt
    };
  }

  /**
   * Mapeo entre niveles CEFR y bandas de calificación oral IELTS
   */
  getBandMapping(level = 'B1') {
    const mappings = {
      'A2': { bandRange: '3.0 - 4.0', targetBand: '4.0', label: 'Elementary' },
      'B1': { bandRange: '4.0 - 5.0', targetBand: '5.0', label: 'Intermediate' },
      'B2': { bandRange: '5.5 - 6.5', targetBand: '6.5', label: 'Upper Intermediate' },
      'C1': { bandRange: '7.0 - 8.0', targetBand: '7.5', label: 'Advanced' },
      'C2': { bandRange: '8.5 - 9.0', targetBand: '8.5', label: 'Proficiency' }
    };
    return mappings[level.toUpperCase()] || mappings['B1'];
  }

  /**
   * Orquesta la evaluación de una intervención oral o sesión completa.
   * @param {Object} options Parámetros de evaluación
   * @param {string} options.teacherContext Pregunta o intervención previa del profesor
   * @param {string} options.studentUtterance Respuesta limpia del estudiante
   * @param {string} options.studentLevel Nivel del alumno ('B1', 'B2', 'C1')
   * @param {Array<string>} options.categories Categorías a evaluar (por defecto todas las 5)
   * @returns {Promise<Array<Object>>} Lista de tarjetas quirúrgicas estandarizadas
   */
  async evaluateUtterance({ teacherContext, studentUtterance, studentLevel = 'B1', categories = null }) {
    const activeCategories = categories || ['grammar', 'vocabulary', 'pronunciation', 'upgrade_c1', 'fluency'];
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    console.log('[GEMINI] Clave encontrada:', !!apiKey, 'Longitud:', apiKey ? apiKey.length : 0);
    const startTime = Date.now();

    // Si existe una clave de API configurada en variables de entorno, invocar Gemini
    if (apiKey) {
      try {
        console.log('[IELTS Engine] Evaluando intervención con Gemini Flash...');
        const aiResults = await this.callLLMEvaluation({
          teacherContext,
          studentUtterance,
          studentLevel,
          categories: activeCategories
        });
        if (Array.isArray(aiResults) && aiResults.length > 0) {
          console.log('[IELTS Engine] Evaluación completada en:', Date.now() - startTime, 'ms');
          console.log(`[IELTS Engine] Gemini retornó ${aiResults.length} tarjetas de evaluación pedagógica.`);
          return aiResults;
        }
      } catch (err) {
        console.error('[GEMINI ERROR DETALLADO]:', err.message || err);
        if (err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED'))) {
          console.warn('\n[AVISO DE CUOTA GEMINI 429] Has alcanzado el límite diario gratuito de 20 peticiones de Google AI Studio.');
          console.warn('-> Activando evaluación pedagógica de respaldo local para no interrumpir la sesión del docente.\n');
        } else {
          console.warn('[IELTS Engine] Falló la llamada a la API de IA externa. Ejecutando motor de reglas de respaldo.');
        }
      }
    }

    // Motor de reglas heurísticas y pedagógicas de respaldo (Garantiza funcionamiento offline/MVP)
    const fallbackResults = this.runHeuristicAnalysis(teacherContext, studentUtterance, studentLevel, activeCategories);
    console.log('[IELTS Engine] Evaluación completada en:', Date.now() - startTime, 'ms (Modo Respaldo Local)');
    return fallbackResults;
  }

  /**
   * Motor de análisis heurístico y reglas pedagógicas para pruebas locales inmediatas.
   */
  runHeuristicAnalysis(teacherContext, studentText, level, categories) {
    const cards = [];
    const text = studentText || '';
    const lower = text.toLowerCase();

    // 1. EVALUACIÓN GRAMATICAL (Tolerancia Cero)
    if (categories.includes('grammar')) {
      // Regla: 3ra persona singular 'he/she/it' sin '-s' en presente
      const thirdPersonMatch = text.match(/\b(he|she|it|my friend|the client)\s+(work|need|want|know|make|take|think|say)\b/i);
      if (thirdPersonMatch) {
        const subject = thirdPersonMatch[1];
        const verb = thirdPersonMatch[2];
        cards.push({
          category: 'grammar',
          severity: 'basic_error',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(thirdPersonMatch[0], `<span class="highlight-error">${thirdPersonMatch[0]}</span>`),
          surgicalCorrection: text.replace(thirdPersonMatch[0], `<span class="highlight-fix">${subject} ${verb}s</span>`),
          explanation: `Concordancia sujeto-verbo en presente simple: tras la tercera persona del singular (${subject}) el verbo requiere la desinencia '-s' (${verb}s).`,
          ieltsCriterion: 'GRA: Band 5.0 (Systemic error in 3rd person singular agreement)'
        });
      }

      // Regla: Narración en pasado con verbo en presente ("yesterday / last ... I go / loose")
      const pastNarrativeMatch = text.match(/\b(I|he|she|we|they|my brother|my friend)\s+(go|loose|see|take|make|find)\b/i);
      if (pastNarrativeMatch) {
        const subj = pastNarrativeMatch[1];
        const v = pastNarrativeMatch[2].toLowerCase();
        const pastMap = { go: 'went', loose: 'lost', see: 'saw', take: 'took', make: 'made', find: 'found' };
        const correctedV = pastMap[v] || v + 'ed';
        cards.push({
          category: 'grammar',
          severity: 'basic_error',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(pastNarrativeMatch[0], `<span class="highlight-error">${pastNarrativeMatch[0]}</span>`),
          surgicalCorrection: text.replace(pastNarrativeMatch[0], `<span class="highlight-fix">${subj} ${correctedV}</span>`),
          explanation: `Inconsistencia temporal en relato de hechos pasados: se debe emplear la forma irregular en pasado ("${correctedV}"), no el presente o forma base ("${v}").`,
          ieltsCriterion: 'GRA: Band 5.0 (Inconsistent past simple tense narrative control)'
        });
      }

      // Regla: Doble pasado o pasado con auxiliar did (ej. "did you went")
      const didPastMatch = text.match(/\b(did|didn't)\s+([a-z]+ed|went|saw|spoke|took|had)\b/i);
      if (didPastMatch) {
        cards.push({
          category: 'grammar',
          severity: 'basic_error',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(didPastMatch[0], `<span class="highlight-error">${didPastMatch[0]}</span>`),
          surgicalCorrection: text.replace(didPastMatch[0], `<span class="highlight-fix">${didPastMatch[1]} [infinitive]</span>`),
          explanation: `El auxiliar en pasado ("${didPastMatch[1]}") ya porta la carga temporal. El verbo léxico posterior debe ir obligatoriamente en infinitivo sin 'to'.`,
          ieltsCriterion: 'GRA: Band 5.5 (Inappropriate past tense inflection following auxiliary did)'
        });
      }
    }

    // 2. VOCABULARIO Y COLOCACIONES
    if (categories.includes('vocabulary')) {
      // Calco: "all the days" en lugar de "every day" o "daily"
      if (lower.includes('all the days')) {
        cards.push({
          category: 'vocabulary',
          severity: 'refinement',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(/all the days/i, '<span class="highlight-error">all the days</span>'),
          surgicalCorrection: text.replace(/all the days/i, '<span class="highlight-fix">on a daily basis / every day</span>'),
          explanation: 'Calco directo del español ("todos los días"). En inglés natural se utiliza "every day" o la locución formal "on a daily basis".',
          ieltsCriterion: 'LR: Band 6.0 (Collocation and L1 translation interference)'
        });
      }

      // Calco: "make a question"
      if (lower.includes('make a question') || lower.includes('made a question')) {
        cards.push({
          category: 'vocabulary',
          severity: 'refinement',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(/make a question|made a question/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/make a question/i, '<span class="highlight-fix">ask a question</span>').replace(/made a question/i, '<span class="highlight-fix">asked a question</span>'),
          explanation: 'Colocación errónea: en inglés las preguntas no se "hacen" (make), sino que se formulan mediante el verbo "ask" (ask a question).',
          ieltsCriterion: 'LR: Band 5.5 (Fixed verb-noun collocation failure)'
        });
      }
    }

    // 3. PRONUNCIACIÓN Y FONÉTICA
    if (categories.includes('pronunciation')) {
      // Palabras con terminaciones -ed que suelen sufrir sobre-articulación
      const edOverpronunciation = text.match(/\b(played|worked|watched|helped|called|lived)\b/i);
      if (edOverpronunciation) {
        cards.push({
          category: 'pronunciation',
          severity: 'basic_error',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: `Pronunciación del pasado regular en <span class="highlight-error">"${edOverpronunciation[0]}"</span>.`,
          surgicalCorrection: `Pronunciar con sonido consonántico final sin sílaba extra: <span class="highlight-fix">/${edOverpronunciation[0].toLowerCase() === 'watched' ? 'wɒtʃt' : 'pleɪd'}/</span>.`,
          explanation: 'Evitar añadir una sílaba adicional /ɪd/. Solo los verbos terminados en /t/ o /d/ (ej. "needed", "started") añaden una sílaba extra.',
          ieltsCriterion: 'PR: Band 6.0 (Phonological feature control in regular past inflections)'
        });
      }
    }

    // 4. UPGRADE C1 (Alternativas avanzadas y parafraseo)
    if (categories.includes('upgrade_c1')) {
      // Reemplazar frases comunes ("very difficult", "fix the problem", "a lot of")
      if (lower.includes('very difficult') || lower.includes('very hard')) {
        cards.push({
          category: 'upgrade_c1',
          severity: 'upgrade',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(/very difficult|very hard/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/very difficult|very hard/i, '<span class="highlight-fix">a formidable challenge / exceedingly demanding</span>'),
          explanation: 'Sustituye el intensificador plano "very" por colocaciones avanzadas de nivel C1 que transmiten precisión ejecutiva.',
          ieltsCriterion: 'LR: Band 8.0 (Skillful use of uncommon and sophisticated lexical items)'
        });
      } else if (lower.includes('i think that') || lower.includes('i think')) {
        cards.push({
          category: 'upgrade_c1',
          severity: 'upgrade',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(/i think that|i think/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/i think that|i think/i, '<span class="highlight-fix">From my perspective, / I am strongly inclined to believe that</span>'),
          explanation: 'Parafrasea la apertura estándar B1 hacia un registro discursivo maduro y formal con mayor peso argumentativo.',
          ieltsCriterion: 'FC/LR: Band 7.5 (Flexible signposting and stylistic range)'
        });
      }
    }

    // 5. FLUIDEZ Y COHESIÓN
    if (categories.includes('fluency')) {
      // Detección de conectores repetitivos "and then... and so..." o coordinación plana
      if (lower.includes('and then') || lower.includes('and so') || lower.includes('and the')) {
        cards.push({
          category: 'fluency',
          severity: 'refinement',
          teacherContext: teacherContext || 'Speaking turn',
          studentResponse: text.replace(/and then|and so|and the/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/and then|and so|and the/i, '<span class="highlight-fix">Consequently / What is more, the</span>'),
          explanation: 'Sustituye la coordinación secuencial básica por un marcador discursivo subordinado que otorga fluidez lógica.',
          ieltsCriterion: 'FC: Band 7.0 (Use of a range of cohesive devices without mechanical chaining)'
        });
      }
    }

    // Asegurar que si una pestaña no tuvo coincidencia exacta, se provea una tarjeta diagnóstica
    const presentCategories = new Set(cards.map(c => c.category));
    if (!presentCategories.has('upgrade_c1') && text.length > 5) {
      cards.push({
        category: 'upgrade_c1',
        severity: 'upgrade',
        teacherContext: teacherContext || 'Speaking turn',
        studentResponse: `Discurso en registro estándar: "<span class="highlight-error">${text.slice(0, 60)}...</span>"`,
        surgicalCorrection: `Elevar a registro C1: <span class="highlight-fix">"In retrospect, looking back at the circumstances..."</span>`,
        explanation: 'Incorporar cláusulas de participio y estructuras complejas para demostrar sofisticación sintáctica.',
        ieltsCriterion: 'LR/GRA: Band 7.5 - 8.0 (Stylistic flexibility and complex structures)'
      });
    }

    if (!presentCategories.has('pronunciation') && text.length > 5) {
      cards.push({
        category: 'pronunciation',
        severity: 'basic_error',
        teacherContext: teacherContext || 'Speaking turn',
        studentResponse: `Articulación de acentos léxicos en oraciones compuestas.`,
        surgicalCorrection: `Enfatizar palabras de contenido y debilitar artículos/preposiciones con <span class="highlight-fix">schwa /ə/</span>.`,
        explanation: 'El ritmo del inglés se basa en el acento (stress-timed). Reducir palabras funcionales mejora la inteligibilidad.',
        ieltsCriterion: 'PR: Band 6.5 (Use of phonological features and rhythm)'
      });
    }

    return cards;
  }

  /**
   * Conector para evaluación pedagógica concisa y rápida con Gemini
   */
  async callLLMEvaluation({ teacherContext, studentUtterance, studentLevel, categories }) {
    const systemPrompt = `You are an IELTS Speaking Examiner evaluating a CEFR ${studentLevel} student.
The student utterance is a 100% verbatim transcription containing authentic pauses, repetitions, and spoken fillers (e.g., 'um', 'uh', 'you know').
- For 'fluency': Leverage these genuine hesitations, reformulations, and linking devices to assess Fluency and Coherence.
- For 'grammar' and 'vocabulary': Focus on systemic grammatical errors and unnatural collocations in the message, ignoring acoustic filler noise.

EXHAUSTIVE & UNLIMITED FEEDBACK MANDATE:
- Detect and report ALL systemic errors, lexical opportunities, unnatural collocations, C1 upgrades, acoustic phonological issues, and fluency cohesion details present throughout the entire utterance.
- DO NOT artificially cap or limit the number of cards in ANY category. Never omit an observation due to quantity limits (especially in Vocabulary, Grammar, and Upgrade C1). If there are 10 distinct opportunities in a single category, you MUST output all 10 cards.

Evaluate comprehensively across these 5 tabs:
1. 'grammar': Catch EVERY single systemic or localized error (subject-verb agreement, verb tenses, auxiliaries, conditionals, prepositions, articles, word order). Severity: 'basic_error'.
2. 'vocabulary': Catch EVERY unnatural collocation, imprecise term, and Spanish L1 calque/false cognate, providing precise idiomatic native alternatives. Severity: 'refinement'.
3. 'pronunciation': Catch EVERY phonological challenge (past regular -ed inflections /t/, /d/, /ɪd/, silent letters, vowel reduction/schwa, word stress). Severity: 'basic_error'.
4. 'upgrade_c1': Catch EVERY opportunity to elevate conversational/standard expressions to sophisticated C1/C2 structures (participle clauses, cleft sentences, advanced idioms, academic register). Severity: 'upgrade'.
5. 'fluency': Catch EVERY repetitive connector ('and then', 'and so') or fragmented hesitation, replacing them with fluid discourse markers and transitions. Severity: 'refinement'.

OUTPUT SCHEMA:
Return a valid JSON array of objects. Category MUST be strictly lowercase: 'grammar', 'vocabulary', 'pronunciation', 'upgrade_c1', 'fluency'.
[
  {
    "category": "grammar" | "vocabulary" | "pronunciation" | "upgrade_c1" | "fluency",
    "severity": "basic_error" | "upgrade" | "refinement",
    "teacherContext": "${teacherContext}",
    "studentResponse": "Sentence with <span class=\\"highlight-error\\">error</span>",
    "surgicalCorrection": "Sentence with <span class=\\"highlight-fix\\">correction</span>",
    "explanation": "Brief explanation in Spanish (max 15 words)",
    "ieltsCriterion": "IELTS Band Descriptor"
  }
]`;

    const rawCards = await geminiService.evaluateTranscript({
      teacherContext,
      studentUtterance,
      studentLevel,
      systemPrompt
    });

    // Normalizar categorías para garantizar mapeo exacto en las 5 pestañas de la UI
    return (rawCards || []).map(card => {
      let cat = (card.category || '').toLowerCase().trim();
      if (cat === 'upgrade' || cat === 'upgradec1' || cat === 'c1') cat = 'upgrade_c1';
      return {
        ...card,
        category: cat
      };
    });
  }
}

module.exports = new IELTSEngine();

