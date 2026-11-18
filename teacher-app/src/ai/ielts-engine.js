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
   * @param {boolean} options.highPrecision Forzar modelo gemini-3.5-flash de máxima precisión
   * @param {Array<Object>} options.pronunciationIssues Observaciones acústicas de pronunciación detectadas en la pasada de audio
   * @returns {Promise<Array<Object>>} Lista de tarjetas quirúrgicas estandarizadas
   */
  async evaluateUtterance({ teacherContext, studentUtterance, studentLevel = 'B1', categories = null, highPrecision = false, pronunciationIssues = [] }) {
    const activeCategories = categories || ['grammar', 'vocabulary', 'pronunciation', 'upgrade_c1', 'fluency'];
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    console.log('[GEMINI] Clave encontrada:', !!apiKey, 'Longitud:', apiKey ? apiKey.length : 0);
    const startTime = Date.now();

    // Si existe una clave de API configurada en variables de entorno, invocar Gemini
    if (apiKey) {
      try {
        console.log(`[IELTS Engine] Evaluando intervención con Gemini (${highPrecision ? 'Alta Precisión: gemini-3.5-flash' : 'Económico: gemini-3.5-flash-lite'})...`);
        const aiResults = await this.callLLMEvaluation({
          teacherContext,
          studentUtterance,
          studentLevel,
          categories: activeCategories,
          highPrecision,
          pronunciationIssues
        });
        if (aiResults && (Array.isArray(aiResults.feedbackCards) || Array.isArray(aiResults))) {
          const cards = Array.isArray(aiResults) ? aiResults : (aiResults.feedbackCards || []);
          console.log('[IELTS Engine] Evaluación completada en:', Date.now() - startTime, 'ms');
          console.log(`[IELTS Engine] Gemini retornó ${cards.length} tarjetas de evaluación pedagógica.`);
          return {
            feedbackCards: cards,
            modelSpeech: aiResults.modelSpeech || this.generateFallbackModelSpeech(studentUtterance, studentLevel)
          };
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
    const fallbackCards = this.runHeuristicAnalysis(teacherContext, studentUtterance, studentLevel, activeCategories);
    console.log('[IELTS Engine] Evaluación completada en:', Date.now() - startTime, 'ms (Modo Respaldo Local)');
    return {
      feedbackCards: fallbackCards,
      modelSpeech: this.generateFallbackModelSpeech(studentUtterance, studentLevel)
    };
  }

  /**
   * Genera un discurso modelo de respaldo enriquecido con dos versiones y 3 mejoras clave,
   * calibrado por nivel confirmado y escalamiento pedagógico (i+1).
   */
  generateFallbackModelSpeech(studentUtterance, studentLevel = 'B1') {
    const normLevel = (studentLevel || 'B1').toUpperCase().trim();
    const raw = (studentUtterance || '').trim();

    // Limpiar muletillas acústicas de la transcripción cruda
    const cleaned = raw
      .replace(/\b(um+|uh+|er+|like|you know|so yeah)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleaned) {
      if (normLevel === 'A2') {
        return {
          naturalCorrected: 'Last year I worked on a difficult project. My team had many tasks, but the client changed the plans often. I spoke with them and we solved the problem on time.',
          targetUpgrade: 'Last year, I worked on a challenging project with a strict deadline. My team and I had to coordinate several tasks, but the client was constantly changing the requirements. Therefore, we organized a meeting to explain our plan and finished successfully.',
          keyImprovements: [
            'Used consistent past simple verbs (worked, had, changed) without mixing present forms.',
            'Connected ideas with clear basic linkers (therefore, but, and).',
            'Removed hesitation fillers like "um" and "you know".'
          ]
        };
      }
      if (normLevel === 'B2') {
        return {
          naturalCorrected: 'Last year, I managed a demanding project with a strict deadline. My team and I had to coordinate various deliverables while the client repeatedly modified key requirements. I arranged a meeting to discuss the main risks, and we successfully delivered the work on schedule.',
          targetUpgrade: 'Over the course of the past year, I oversaw a high-stakes project subject to rigorous deadlines. While our team was orchestrating multiple deliverables simultaneously, the client continually revised fundamental specifications. To mitigate this risk, I convened a formal review to address the core challenges, ensuring we fulfilled our commitments seamlessly.',
          keyImprovements: [
            'Incorporated nuanced professional collocations ("high-stakes project", "mitigate this risk").',
            'Utilized sophisticated participle clauses for smoother sentence flow ("ensuring we fulfilled").',
            'Removed conversational fillers for an articulate, authoritative tone.'
          ]
        };
      }
      if (normLevel === 'C1' || normLevel === 'C2') {
        return {
          naturalCorrected: 'During the previous year, I oversaw an intricate initiative under demanding timelines. Our cross-functional team orchestrated multiple parallel deliverables, despite the client repeatedly revising key milestones. I initiated a targeted consultation to align on priorities and bring the project to a successful close.',
          targetUpgrade: 'Throughout the past year, I steered an exceptionally multifaceted undertaking amidst stringent constraints. While orchestrating diverse operational streams, our unit encountered continual recalibrations of client requirements. By orchestrating a pivotal stakeholder summit, I effectively preempted potential bottlenecks, thereby ensuring flawless execution.',
          keyImprovements: [
            'Mastered sophisticated syntactic variation with non-finite clauses.',
            'Showcased highly idiomatic and domain-specific executive phrasing.',
            'Achieved effortless native-like cohesion without mechanical discourse markers.'
          ]
        };
      }
      // Default: B1 -> i+1 = B2
      return {
        naturalCorrected: 'Last year I worked on a challenging project with a tight deadline. My team and I needed to coordinate many tasks, but the client was changing the requirements constantly. I scheduled a meeting to explain the situation to them, and we were able to finish on time.',
        targetUpgrade: 'Last year, I managed a demanding project with a tight deadline. My team had to coordinate multiple priorities, while the client kept revising the project scope. Consequently, I arranged a meeting to address their concerns, which allowed us to deliver the project on schedule.',
        keyImprovements: [
          'Maintained consistent past narration without accidental tense shifts.',
          'Replaced repetitive words with natural B2 collocations ("deliver on schedule", "multiple priorities").',
          'Structured logical transitions with clear connectors ("consequently", "which allowed us to").'
        ]
      };
    }

    const firstUpper = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    const lowerClean = cleaned.toLowerCase().replace(/^(well|so),?\s*/i, '');

    if (normLevel === 'A2') {
      return {
        naturalCorrected: firstUpper,
        targetUpgrade: `In fact, ${lowerClean}. Because of this, it was a good learning experience for me and my colleagues.`,
        keyImprovements: [
          'Corrected basic verb agreements and prepositions.',
          'Enhanced sentence linking with accessible B1 connectors (because of this, in fact).',
          'Eliminated hesitations to improve rhythm.'
        ]
      };
    }
    if (normLevel === 'B2') {
      return {
        naturalCorrected: firstUpper,
        targetUpgrade: `From a broader operational standpoint, ${lowerClean}. This experience underscored the value of adaptive strategy when navigating evolving demands.`,
        keyImprovements: [
          'Elevated lexical range to Upper-Intermediate/Advanced (B2+/C1).',
          'Constructed balanced complex sentences with natural subordinate phrasing.',
          'Polished discourse flow for professional presentation.'
        ]
      };
    }
    if (normLevel === 'C1' || normLevel === 'C2') {
      return {
        naturalCorrected: firstUpper,
        targetUpgrade: `Reflecting upon this trajectory, ${lowerClean}. It stands as a compelling testament to the pivotal role of cohesive leadership under volatile parameters.`,
        keyImprovements: [
          'Infused native-level idiomatic precision and authoritative tone.',
          'Leveraged advanced cleft and fronted syntactic structures.',
          'Maintained seamless rhetorical continuity throughout the utterance.'
        ]
      };
    }

    // Default B1 -> i+1 = B2
    return {
      naturalCorrected: firstUpper,
      targetUpgrade: `Furthermore, ${lowerClean}. This clearly demonstrated the importance of effective planning and teamwork in reaching our goals.`,
      keyImprovements: [
        'Polished grammar and vocabulary to sound natural and accurate at B1 level.',
        'Elevated phrasing one step (i+1 to B2) with stronger connectors ("furthermore") and collocations.',
        'Eliminated hesitation fillers and fragmented speech starters.'
      ]
    };
  }

  /**
   * Motor de análisis heurístico y reglas pedagógicas para pruebas locales inmediatas.
   * 100% en inglés simple (A2/B1) con cápsulas contrastivas obligatorias para Grammar, Vocabulary y Upgrade C1.
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
          teacherContext: teacherContext || '',
          studentResponse: text.replace(thirdPersonMatch[0], `<span class="highlight-error">${thirdPersonMatch[0]}</span>`),
          surgicalCorrection: text.replace(thirdPersonMatch[0], `<span class="highlight-fix">${subject} ${verb}s</span>`),
          explanation: `Subject-verb agreement: in the present simple, add -s when one person or thing (${subject}) does the action (${verb}s).`,
          ieltsCriterion: 'GRA: Band 5.0 (Systemic error in 3rd person singular agreement)',
          contrastiveCapsule: {
            poleA: {
              label: 'Base verb (I / you / we / they)',
              rule: 'Use the base form for I, you, we, or they in the present simple.',
              example: 'They work together on every major project.'
            },
            poleB: {
              label: 'Verb + -s (he / she / it)',
              rule: 'Always add -s when one person (he, she, it) does the action in the present.',
              example: `${subject} ${verb}s very diligently every day.`
            }
          }
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
          teacherContext: teacherContext || '',
          studentResponse: text.replace(pastNarrativeMatch[0], `<span class="highlight-error">${pastNarrativeMatch[0]}</span>`),
          surgicalCorrection: text.replace(pastNarrativeMatch[0], `<span class="highlight-fix">${subj} ${correctedV}</span>`),
          explanation: `Time consistency: use the past form ("${correctedV}") when describing finished events in the past.`,
          ieltsCriterion: 'GRA: Band 5.0 (Inconsistent past simple tense narrative control)',
          contrastiveCapsule: {
            poleA: {
              label: 'Present simple (routines & habits)',
              rule: 'Use present forms for daily routines or general facts.',
              example: `I ${v} to the gym every Monday morning.`
            },
            poleB: {
              label: 'Past simple (finished past actions)',
              rule: 'Use past forms for actions that finished at a specific time in the past.',
              example: `Yesterday I ${correctedV} to the meeting on time.`
            }
          }
        });
      }

      // Regla: Doble pasado o pasado con auxiliar did (ej. "did you went")
      const didPastMatch = text.match(/\b(did|didn't)\s+([a-z]+ed|went|saw|spoke|took|had)\b/i);
      if (didPastMatch) {
        cards.push({
          category: 'grammar',
          severity: 'basic_error',
          teacherContext: teacherContext || '',
          studentResponse: text.replace(didPastMatch[0], `<span class="highlight-error">${didPastMatch[0]}</span>`),
          surgicalCorrection: text.replace(didPastMatch[0], `<span class="highlight-fix">${didPastMatch[1]} [infinitive]</span>`),
          explanation: `Auxiliary verb rule: after "${didPastMatch[1]}", the main verb must always stay in its base form.`,
          ieltsCriterion: 'GRA: Band 5.5 (Inappropriate past tense inflection following auxiliary did)',
          contrastiveCapsule: {
            poleA: {
              label: 'Past form without did (positive statements)',
              rule: 'Use the irregular or -ed past form in positive statements.',
              example: 'She went to the office yesterday afternoon.'
            },
            poleB: {
              label: 'Did / didn\'t + base form (questions & negatives)',
              rule: 'In questions or negatives with did, keep the main verb in its base form.',
              example: `Did she go to the office yesterday afternoon?`
            }
          }
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
          teacherContext: teacherContext || '',
          studentResponse: text.replace(/all the days/i, '<span class="highlight-error">all the days</span>'),
          surgicalCorrection: text.replace(/all the days/i, '<span class="highlight-fix">on a daily basis / every day</span>'),
          explanation: 'Collocation: use "every day" or "on a daily basis" to talk about regular daily routines.',
          ieltsCriterion: 'LR: Band 6.0 (Collocation and L1 translation interference)',
          contrastiveCapsule: {
            poleA: {
              label: 'all the days (literal translation)',
              rule: 'Only use "all the days" when counting every single day in a specific limited period.',
              example: 'We spent a week in London, and it rained all the days.'
            },
            poleB: {
              label: 'every day / daily (natural frequency)',
              rule: 'Use "every day" to say that something happens repeatedly as a habit.',
              example: 'I practice speaking English every day before work.'
            }
          }
        });
      }

      // Calco: "make a question"
      if (lower.includes('make a question') || lower.includes('made a question')) {
        cards.push({
          category: 'vocabulary',
          severity: 'refinement',
          teacherContext: teacherContext || '',
          studentResponse: text.replace(/make a question|made a question/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/make a question/i, '<span class="highlight-fix">ask a question</span>').replace(/made a question/i, '<span class="highlight-fix">asked a question</span>'),
          explanation: 'Verb-noun collocation: in natural English, you "ask a question", you do not "make" a question.',
          ieltsCriterion: 'LR: Band 5.5 (Fixed verb-noun collocation failure)',
          contrastiveCapsule: {
            poleA: {
              label: 'make (create or produce things)',
              rule: 'Use "make" when you build, create, or produce something tangible.',
              example: 'I need to make a quick cup of coffee before the lecture.'
            },
            poleB: {
              label: 'ask a question (inquire)',
              rule: 'Always use the verb "ask" when you want information from someone.',
              example: 'May I ask a question about your presentation?'
            }
          }
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
          teacherContext: teacherContext || '',
          studentResponse: `Regular past inflection in <span class="highlight-error">"${edOverpronunciation[0]}"</span>.`,
          surgicalCorrection: `Pronounce ending consonant cleanly without extra syllable: <span class="highlight-fix">/${edOverpronunciation[0].toLowerCase() === 'watched' ? 'wɒtʃt' : 'pleɪd'}/</span>.`,
          explanation: 'Only regular verbs ending in /t/ or /d/ sounds add an extra /ɪd/ syllable.',
          ieltsCriterion: 'PR: Band 6.0 (Phonological feature control in regular past inflections)',
          contrastiveCapsule: null
        });
      }
    }

    // 4. UPGRADE C1 (Alternativas avanzadas y parafraseo)
    if (categories.includes('upgrade_c1')) {
      if (lower.includes('very difficult') || lower.includes('very hard')) {
        cards.push({
          category: 'upgrade_c1',
          severity: 'upgrade',
          teacherContext: teacherContext || '',
          studentResponse: text.replace(/very difficult|very hard/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/very difficult|very hard/i, '<span class="highlight-fix">a formidable challenge / exceedingly demanding</span>'),
          explanation: 'Replace standard "very difficult" with advanced C1 collocations for executive precision.',
          ieltsCriterion: 'LR: Band 8.0 (Skillful use of uncommon and sophisticated lexical items)',
          contrastiveCapsule: {
            poleA: {
              label: 'very difficult (standard B1 adjective)',
              rule: 'Clear and simple description for informal or everyday conversation.',
              example: 'The exam was very difficult, but I managed to finish.'
            },
            poleB: {
              label: 'a formidable challenge (advanced C1 collocation)',
              rule: 'Use strong nouns and collocations to sound authoritative and professional.',
              example: 'Leading two remote teams proved to be a formidable challenge.'
            }
          }
        });
      } else if (lower.includes('i think that') || lower.includes('i think')) {
        cards.push({
          category: 'upgrade_c1',
          severity: 'upgrade',
          teacherContext: teacherContext || '',
          studentResponse: text.replace(/i think that|i think/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/i think that|i think/i, '<span class="highlight-fix">From my perspective, / I am strongly inclined to believe that</span>'),
          explanation: 'Paraphrase casual "I think" into formal signposting to give more weight to your argument.',
          ieltsCriterion: 'FC/LR: Band 7.5 (Flexible signposting and stylistic range)',
          contrastiveCapsule: {
            poleA: {
              label: 'I think (conversational B1 opener)',
              rule: 'Quick, common way to share personal thoughts in everyday talk.',
              example: 'I think the government should invest more in education.'
            },
            poleB: {
              label: 'From my perspective (C1 academic signpost)',
              rule: 'Use sophisticated viewpoint markers to present opinions formally.',
              example: 'From my perspective, sustainable energy investment is imperative.'
            }
          }
        });
      }
    }

    // 5. FLUIDEZ Y COHESIÓN
    if (categories.includes('fluency')) {
      if (lower.includes('and then') || lower.includes('and so') || lower.includes('and the')) {
        cards.push({
          category: 'fluency',
          severity: 'refinement',
          teacherContext: teacherContext || '',
          studentResponse: text.replace(/and then|and so|and the/i, (m) => `<span class="highlight-error">${m}</span>`),
          surgicalCorrection: text.replace(/and then|and so|and the/i, '<span class="highlight-fix">Consequently, / What is more, the</span>'),
          explanation: 'Replace repetitive "and then" with varied transition markers to connect ideas smoothly.',
          ieltsCriterion: 'FC: Band 7.0 (Use of a range of cohesive devices without mechanical chaining)',
          contrastiveCapsule: null
        });
      }
    }

    // Asegurar que si una pestaña no tuvo coincidencia exacta, se provea una tarjeta diagnóstica
    const presentCategories = new Set(cards.map(c => c.category));
    if (!presentCategories.has('upgrade_c1') && text.length > 5) {
      cards.push({
        category: 'upgrade_c1',
        severity: 'upgrade',
        teacherContext: teacherContext || '',
        studentResponse: `Standard spoken register: "<span class="highlight-error">${text.slice(0, 60)}...</span>"`,
        surgicalCorrection: `Elevate to C1 register: <span class="highlight-fix">"In retrospect, looking back at the circumstances..."</span>`,
        explanation: 'Incorporate participle clauses and complex structures to demonstrate syntactic sophistication.',
        ieltsCriterion: 'LR/GRA: Band 7.5 - 8.0 (Stylistic flexibility and complex structures)',
        contrastiveCapsule: {
          poleA: {
            label: 'Standard clause (B1/B2 coordination)',
            rule: 'Connecting separate simple clauses with basic conjunctions like "and" or "so".',
            example: 'I finished the report, and then I sent it to my supervisor.'
          },
          poleB: {
            label: 'Participle clause (C1 structural upgrade)',
            rule: 'Reduce one clause to an -ing or -ed phrase to express sequences cleanly.',
            example: 'Having finished the report, I immediately sent it to my supervisor.'
          }
        }
      });
    }

    if (!presentCategories.has('pronunciation') && text.length > 5) {
      cards.push({
        category: 'pronunciation',
        severity: 'basic_error',
        teacherContext: teacherContext || '',
        studentResponse: `Word stress and rhythm in connected speech.`,
        surgicalCorrection: `Stress key content words and reduce auxiliary words with <span class="highlight-fix">schwa /ə/</span>.`,
        explanation: 'English is stress-timed: weaken function words to make your rhythm natural and easy to follow.',
        ieltsCriterion: 'PR: Band 6.5 (Use of phonological features and rhythm)',
        contrastiveCapsule: null
      });
    }

    return cards;
  }

  /**
   * Conector para evaluación pedagógica concisa y rápida con Gemini
   */
  async callLLMEvaluation({ teacherContext, studentUtterance, studentLevel, categories, highPrecision = false, pronunciationIssues = [] }) {
    const cleanTeacherContext = (teacherContext || '').trim();
    const normLevel = (studentLevel || 'B1').toUpperCase().trim();
    let targetUpgradeLevel = 'B2';
    let iPlusOneLevel = 'B2 (accessible upper-intermediate)';
    if (normLevel === 'A1' || normLevel === 'A2') {
      targetUpgradeLevel = 'B1';
      iPlusOneLevel = 'B1 (accessible intermediate)';
    } else if (normLevel === 'B1') {
      targetUpgradeLevel = 'B2';
      iPlusOneLevel = 'B2 (accessible upper-intermediate)';
    } else if (normLevel === 'B2') {
      targetUpgradeLevel = 'C1';
      iPlusOneLevel = 'C1 (effective operational proficiency)';
    } else if (normLevel === 'C1' || normLevel === 'C2') {
      targetUpgradeLevel = 'C1/C2';
      iPlusOneLevel = 'C1/C2 (native-like mastery & fluency)';
    }

    let acousticPronunciationSection = '';
    if (Array.isArray(pronunciationIssues) && pronunciationIssues.length > 0) {
      acousticPronunciationSection = `\nVERIFIED ACOUSTIC PRONUNCIATION OBSERVATIONS (Detected directly from the student's spoken audio during single-pass transcription):
${JSON.stringify(pronunciationIssues, null, 2)}
INSTRUCTION FOR PRONUNCIATION: You MUST generate dedicated 'pronunciation' feedbackCards for these genuine acoustic errors heard during the session. Highlight the mispronounced word in studentResponse and provide the clean phonetic model / target pronunciation in surgicalCorrection.`;
    } else {
      acousticPronunciationSection = `\nVERIFIED ACOUSTIC PRONUNCIATION OBSERVATIONS:
No acoustic pronunciation errors were flagged during audio transcription.
INSTRUCTION FOR PRONUNCIATION: Do NOT invent or fabricate pronunciation errors if there is no genuine phonological issue or phonetic marker in the student's speech. If the student's pronunciation is intelligible and clear, output ZERO pronunciation cards (empty).`;
    }

    const systemPrompt = `You are a certified IELTS Speaking Examiner and Master EFL Teacher evaluating a student with confirmed CEFR level "${normLevel}".

MANDATES:
1. 100% ENGLISH & GRADED LANGUAGE: All output must be in English. Write explanations and rules in simple, accessible A2/B1 teacher language without linguistic jargon.
2. DIALOGUE ROLES: If transcript contains 'DOCENTE:' (teacher) and 'ESTUDIANTE:' (student), evaluate and correct EXCLUSIVELY what 'ESTUDIANTE:' said. Use 'DOCENTE:' turns strictly as conversational context. 'teacherContext' in each card must be the literal preceding teacher question or "" if none. Never invent prompts.
3. EXHAUSTIVE EVALUATION: Detect and report ALL genuine errors and opportunities across the entire utterance without numerical caps:
   - 'grammar': Systemic or local errors calibrated to ${normLevel}. Severity: 'basic_error'.
   - 'vocabulary': Unnatural collocations, calques, precise alternatives calibrated to ${normLevel}. Severity: 'refinement'.
   - 'pronunciation': Phonological issues (-ed endings, silent letters, vowel reduction/schwa, word stress) grounded in the acoustic observations provided below or tags in the transcript. Highlight the mispronounced word in studentResponse and provide the clean phonetic model / target pronunciation in surgicalCorrection. If no acoustic observations exist and no obvious phonetic mistakes appear, do NOT fabricate pronunciation errors. Severity: 'basic_error'.
   - 'upgrade_c1': Step-by-step i+1 upgrade calibrated strictly to target level "${targetUpgradeLevel}". NEVER jump to C1/C2 vocabulary or complex idioms if the student is A1, A2, or B1:
     * If student is A1/A2 -> upgrade strictly to B1 (e.g. 'decided to quit' instead of 'felt compelled to tender my resignation').
     * If student is B1 -> upgrade strictly to B2 (clear connectors, practical professional collocations, natural variety).
     * Only if student is B2/C1 -> upgrade to C1. Severity: 'upgrade'.
   - 'fluency': Fillers, repetitive connectors, natural discourse markers calibrated to ${normLevel}. Severity: 'refinement'.
4. CONTRASTIVE CAPSULE (Required for 'grammar', 'vocabulary', and 'upgrade_c1'; null for 'pronunciation' and 'fluency'):
   - "poleA": { "label": "Student's/Opposing form", "rule": "Simple A2/B1 rule when Form A is right", "example": "Natural sentence where Form A is correct" }
   - "poleB": { "label": "Target form", "rule": "Simple A2/B1 rule when to use Form B", "example": "Natural sentence where Form B is correct" } (Calibrated to ${normLevel} for grammar/vocab; strictly calibrated to ${targetUpgradeLevel} for upgrade_c1).
5. MODEL SPEECH (i+1):
   - "naturalCorrected": Full student discourse rewritten naturally at confirmed ${normLevel} fixing errors and acoustic fillers.
   - "targetUpgrade": Same speech elevated exactly one step to target level ${targetUpgradeLevel} (${iPlusOneLevel}).
   - "keyImprovements": Exactly 3 short bullet points in simple English explaining practical upgrades.
${acousticPronunciationSection}

JSON OUTPUT FORMAT (Valid raw JSON, no markdown):
{
  "feedbackCards": [
    {
      "category": "grammar" | "vocabulary" | "pronunciation" | "upgrade_c1" | "fluency",
      "severity": "basic_error" | "upgrade" | "refinement",
      "teacherContext": "${cleanTeacherContext}",
      "studentResponse": "Sentence with <span class=\\"highlight-error\\">error</span>",
      "surgicalCorrection": "Sentence with <span class=\\"highlight-fix\\">correction</span>",
      "explanation": "Clear surgical explanation in simple English (max 20 words)",
      "ieltsCriterion": "Grammatical Range and Accuracy" | "Lexical Resource" | "Pronunciation" | "Fluency and Coherence",
      "contrastiveCapsule": {
        "poleA": { "label": "...", "rule": "...", "example": "..." },
        "poleB": { "label": "...", "rule": "...", "example": "..." }
      } | null
    }
  ],
  "modelSpeech": {
    "naturalCorrected": "...",
    "targetUpgrade": "...",
    "keyImprovements": ["...", "...", "..."]
  }
}`;

    const rawResponse = await geminiService.evaluateTranscript({
      teacherContext: cleanTeacherContext,
      studentUtterance,
      studentLevel: normLevel,
      systemPrompt,
      highPrecision
    });

    let rawCards = [];
    let rawModelSpeech = null;

    if (Array.isArray(rawResponse)) {
      rawCards = rawResponse;
    } else if (rawResponse && typeof rawResponse === 'object') {
      rawCards = Array.isArray(rawResponse.feedbackCards)
        ? rawResponse.feedbackCards
        : (Array.isArray(rawResponse.cards) ? rawResponse.cards : []);
      if (rawResponse.modelSpeech && typeof rawResponse.modelSpeech === 'object') {
        rawModelSpeech = rawResponse.modelSpeech;
      }
    }

    // Normalizar categorías, contexto docente y cápsula contrastiva
    const normalizedCards = (rawCards || []).map(card => {
      let cat = (card.category || '').toLowerCase().trim();
      if (cat === 'upgrade' || cat === 'upgradec1' || cat === 'c1') cat = 'upgrade_c1';
      let ctx = (card.teacherContext || cleanTeacherContext || '').trim();
      if (ctx.toLowerCase().includes('tell me about your experience') || ctx === 'Speaking turn' || ctx === 'Pregunta o contexto oral') {
        ctx = '';
      }

      // Validar cápsula contrastiva para las categorías estructurales
      let contrastiveCapsule = null;
      if (['grammar', 'vocabulary', 'upgrade_c1'].includes(cat)) {
        if (card.contrastiveCapsule && card.contrastiveCapsule.poleA && card.contrastiveCapsule.poleB) {
          contrastiveCapsule = {
            poleA: {
              label: String(card.contrastiveCapsule.poleA.label || 'Student Form').trim(),
              rule: String(card.contrastiveCapsule.poleA.rule || 'When this form is correct.').trim(),
              example: String(card.contrastiveCapsule.poleA.example || '').trim()
            },
            poleB: {
              label: String(card.contrastiveCapsule.poleB.label || 'Target Form').trim(),
              rule: String(card.contrastiveCapsule.poleB.rule || 'When to use the target form instead.').trim(),
              example: String(card.contrastiveCapsule.poleB.example || '').trim()
            }
          };
        } else {
          // Fallback limpio si la IA omitió el objeto
          const rawErr = (card.studentResponse || '').replace(/<[^>]+>/g, '').trim();
          const rawFix = (card.surgicalCorrection || '').replace(/<[^>]+>/g, '').trim();
          contrastiveCapsule = {
            poleA: {
              label: 'Conversational Form',
              rule: 'Used in general or informal speaking contexts.',
              example: rawErr || 'She works every day.'
            },
            poleB: {
              label: 'Target Form',
              rule: card.explanation || 'Accurate target structure for this specific context.',
              example: rawFix || 'She has worked diligently on this.'
            }
          };
        }
      }

      // Limpiar etiquetas residuales [pronunciation: ...] en studentResponse de tarjetas que no sean de pronunciación
      let cleanStudentResponse = card.studentResponse || '';
      let cleanSurgicalCorrection = card.surgicalCorrection || '';
      if (cat !== 'pronunciation') {
        cleanStudentResponse = cleanStudentResponse.replace(/\s*\[pronunciation:[^\]]*\]/gi, '');
        cleanSurgicalCorrection = cleanSurgicalCorrection.replace(/\s*\[pronunciation:[^\]]*\]/gi, '');
      }

      return {
        ...card,
        category: cat,
        teacherContext: ctx,
        studentResponse: cleanStudentResponse,
        surgicalCorrection: cleanSurgicalCorrection,
        contrastiveCapsule
      };
    });

    const cleanModelSpeech = (txt) => String(txt || '').replace(/\s*\[pronunciation:[^\]]*\]/gi, '').trim();

    const normalizedModelSpeech = (rawModelSpeech && rawModelSpeech.naturalCorrected)
      ? {
          naturalCorrected: cleanModelSpeech(rawModelSpeech.naturalCorrected),
          targetUpgrade: cleanModelSpeech(rawModelSpeech.targetUpgrade),
          keyImprovements: Array.isArray(rawModelSpeech.keyImprovements)
            ? rawModelSpeech.keyImprovements.map(k => cleanModelSpeech(k)).filter(Boolean)
            : []
        }
      : this.generateFallbackModelSpeech(studentUtterance, studentLevel);

    return {
      feedbackCards: normalizedCards,
      modelSpeech: normalizedModelSpeech
    };
  }
}

module.exports = new IELTSEngine();

