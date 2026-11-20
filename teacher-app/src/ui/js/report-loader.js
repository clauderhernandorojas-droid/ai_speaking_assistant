/**
 * Report Loader: Parser híbrido de reportes HTML para Speaking Assistant
 * Soporta:
 * 1. Reportes modernos con tag JSON (#speaking-assistant-session-data)
 * 2. Reportes existentes/legados parseando la estructura DOM (con DOMParser)
 */

(function(global) {
  function parseReportHtml(htmlContent, customDoc) {
    if (!htmlContent || typeof htmlContent !== 'string') {
      throw new Error('Contenido HTML vacío o no válido.');
    }

    // =========================================================================
    // 1. INTENTAR PARSEO DIRECTO DESDE EL ESTADO JSON INCRUSTADO
    // =========================================================================
    const scriptMatch = htmlContent.match(/<script\s+id=["']speaking-assistant-session-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch && scriptMatch[1]) {
      try {
        const parsed = JSON.parse(scriptMatch[1].trim());
        if (parsed && typeof parsed === 'object') {
          console.log('[ReportLoader] Reporte moderno detectado con estado JSON estructurado.');
          return normalizeReportData(parsed);
        }
      } catch (err) {
        console.warn('[ReportLoader] Error al parsear JSON incrustado, recurriendo al DOMParser:', err);
      }
    }

    // =========================================================================
    // 2. PARSEO DE LA ESTRUCTURA DOM CON DOMParser (REPORTES LEGADOS)
    // =========================================================================
    console.log('[ReportLoader] Reporte legado detectado, procesando DOM...');
    let doc = customDoc;
    if (!doc) {
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        doc = parser.parseFromString(htmlContent, 'text/html');
      } else {
        throw new Error('DOMParser no está disponible en este entorno.');
      }
    }

    // A. Metadatos (.meta-card .meta-field)
    let studentName = 'Student';
    let level = 'B1';
    let roomCode = 'EFL-XXX';
    let sessionDate = '';

    const metaFields = doc.querySelectorAll('.meta-card .meta-field');
    metaFields.forEach(field => {
      const strongText = field.querySelector('strong')?.textContent?.trim().toLowerCase() || '';
      const spanText = field.querySelector('span')?.textContent?.trim() || '';

      if (strongText.includes('student') || strongText.includes('alumno') || strongText.includes('estudiante')) {
        if (spanText) studentName = spanText;
      } else if (strongText.includes('level') || strongText.includes('nivel')) {
        if (spanText) level = spanText.toUpperCase().trim();
      } else if (strongText.includes('room') || strongText.includes('código') || strongText.includes('sala')) {
        if (spanText) roomCode = spanText;
      } else if (strongText.includes('date') || strongText.includes('fecha')) {
        if (spanText) sessionDate = spanText;
      }
    });

    if (!studentName || studentName === 'Student') {
      const title = doc.querySelector('title')?.textContent || '';
      const titleMatch = title.match(/Report\s*-\s*([^(]+)\s*\(([^)]+)\)/i);
      if (titleMatch) {
        studentName = titleMatch[1].trim();
        if (!roomCode || roomCode === 'EFL-XXX') {
          roomCode = titleMatch[2].trim();
        }
      }
    }

    // B. Observaciones pedagógicas del docente
    let teacherNotes = '';
    const h3Elements = Array.from(doc.querySelectorAll('h3'));
    const obsHeader = h3Elements.find(h => 
      h.textContent.includes("Teacher's Pedagogical Notes") || 
      h.textContent.includes("Observaciones")
    );
    if (obsHeader) {
      const obsContainer = obsHeader.closest('div');
      if (obsContainer) {
        const innerDiv = obsContainer.querySelector('div[style*="line-height"], div:last-child');
        if (innerDiv) {
          teacherNotes = innerDiv.innerHTML
            .replace(/<br\s*[\/]?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .trim();
        }
      }
    }

    // C. Turnos de transcripción
    const transcriptEntries = [];
    const forbiddenPatterns = [
      /The user wants/i,
      /Audio playback:/i,
      /Context:/i,
      /Word check:/i,
      /\bLet's\b/i
    ];

    const h2Elements = Array.from(doc.querySelectorAll('h2'));
    const transcriptHeading = h2Elements.find(h => 
      h.textContent.includes('Session Verbatim Transcript') || 
      h.textContent.includes('Transcripción')
    );

    if (transcriptHeading) {
      let sibling = transcriptHeading.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2' && sibling.tagName !== 'FOOTER') {
        const innerDivs = sibling.querySelectorAll('div');
        if (innerDivs.length >= 2) {
          const speakerRaw = innerDivs[0].textContent.trim();
          const textRaw = innerDivs[1].textContent.trim();

          const isTeacher = speakerRaw.toLowerCase().includes('teacher') || speakerRaw.toLowerCase().includes('docente');
          const isStudent = speakerRaw.toLowerCase().includes('student') || speakerRaw.toLowerCase().includes('alumno') || speakerRaw.toLowerCase().includes('estudiante');

          if (isTeacher || isStudent) {
            const speaker = isTeacher ? 'Teacher' : 'Student';
            const isCorrupted = forbiddenPatterns.some(p => p.test(textRaw)) || 
                                (textRaw.includes('{') && textRaw.includes('}') && textRaw.includes('"transcript"'));

            if (!isCorrupted && textRaw) {
              transcriptEntries.push({ speaker, text: textRaw });
            }
          }
        }
        sibling = sibling.nextElementSibling;
      }
    }

    // D. Tarjetas quirúrgicas bajo Surgical Feedback
    const feedbackCards = [];
    const feedbackHeading = h2Elements.find(h => 
      h.textContent.includes('Surgical Feedback') || 
      h.textContent.includes('Retroalimentación')
    );

    if (feedbackHeading) {
      let sibling = feedbackHeading.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2' && sibling.tagName !== 'FOOTER') {
        if (sibling.tagName === 'SECTION') {
          const catTitle = sibling.querySelector('h3')?.textContent || '';
          let category = 'grammar';
          if (catTitle.includes('Grammar')) category = 'grammar';
          else if (catTitle.includes('Vocabulary')) category = 'vocabulary';
          else if (catTitle.includes('Pronunciation')) category = 'pronunciation';
          else if (catTitle.includes('Upgrade') || catTitle.includes('C1')) category = 'upgrade_c1';
          else if (catTitle.includes('Fluency')) category = 'fluency';

          const cardDivs = sibling.querySelectorAll('div[style*="border-radius: 8px"][style*="padding: 14px"]');
          cardDivs.forEach((cardEl, idx) => {
            // Teacher Context
            let teacherContext = '';
            const allStrong = Array.from(cardEl.querySelectorAll('strong'));
            const contextStrong = allStrong.find(s => s.textContent.includes('Teacher Context:'));
            if (contextStrong && contextStrong.parentElement) {
              teacherContext = contextStrong.parentElement.textContent.replace(/Teacher Context:\s*/i, '').trim();
              teacherContext = teacherContext.replace(/^["']+|["']+$/g, '').trim();
            }

            // Student Response
            let studentResponse = '';
            const studentStrong = allStrong.find(s => s.textContent.includes('Student Response:'));
            if (studentStrong && studentStrong.parentElement) {
              const respDiv = studentStrong.parentElement.querySelector('div') || studentStrong.nextElementSibling;
              if (respDiv) {
                studentResponse = respDiv.innerHTML.trim();
              } else {
                studentResponse = studentStrong.parentElement.innerHTML.replace(/<strong[^>]*>.*?<\/strong>/i, '').trim();
              }
            }

            // Contrastive Capsule Focus (A vs B)
            let contrastiveCapsule = null;
            const gridDiv = cardEl.querySelector('div[style*="grid-template-columns"], .capsule-grid');
            if (gridDiv) {
              const poleDivs = Array.from(gridDiv.querySelectorAll('div[style*="border-left"], .capsule-col'));
              let poleADiv = poleDivs.find(d => d.textContent.includes('Form A'));
              let poleBDiv = poleDivs.find(d => d.textContent.includes('Form B'));

              if (poleADiv && poleBDiv) {
                const labelA = poleADiv.querySelector('strong')?.textContent?.trim() || '';
                const ruleA = poleADiv.querySelector('div[style*="line-height"], .pole-rule')?.textContent?.trim() || '';
                const exA = poleADiv.querySelector('div[style*="italic"], .pole-ex')?.textContent?.replace(/^["']+|["']+$/g, '').trim() || '';

                const labelB = poleBDiv.querySelector('strong')?.textContent?.trim() || '';
                const ruleB = poleBDiv.querySelector('div[style*="line-height"], .pole-rule')?.textContent?.trim() || '';
                const exB = poleBDiv.querySelector('div[style*="italic"], .pole-ex')?.textContent?.replace(/^["']+|["']+$/g, '').trim() || '';

                if (labelA || labelB) {
                  contrastiveCapsule = {
                    poleA: { label: labelA, rule: ruleA, example: exA },
                    poleB: { label: labelB, rule: ruleB, example: exB }
                  };
                }
              }
            }

            // Surgical Correction & Explanation
            let surgicalCorrection = '';
            let explanation = '';
            const corrStrong = allStrong.find(s => s.textContent.includes('Surgical Correction:'));
            if (corrStrong && corrStrong.parentElement) {
              const corrWrapper = corrStrong.parentElement;
              const fixDiv = corrWrapper.querySelector('div');
              if (fixDiv) {
                surgicalCorrection = fixDiv.innerHTML.trim();
              }
              const expDiv = corrWrapper.querySelector('div[style*="background: #0d1117"], div[style*="border-left"]');
              if (expDiv) {
                explanation = expDiv.innerHTML.trim();
              }
            }

            // IELTS Footer & Severity
            const footerDiv = cardEl.querySelector('div[style*="border-top: 1px solid"]');
            let ieltsCriterion = 'IELTS Band Descriptors';
            let severity = category === 'upgrade_c1' ? 'upgrade' : 'basic_error';
            if (footerDiv) {
              const footerText = footerDiv.textContent.replace(/\s+/g, ' ').trim();
              ieltsCriterion = footerText;
              if (footerText.includes('Tolerancia Cero')) {
                severity = 'basic_error';
              } else if (footerText.includes('C1') || footerText.includes('Parafraseo') || category === 'upgrade_c1') {
                severity = 'upgrade';
              } else {
                severity = 'refinement';
              }
            }

            if (studentResponse || surgicalCorrection) {
              feedbackCards.push({
                id: `card_legacy_${category}_${idx}_${Date.now()}`,
                category,
                teacherContext,
                studentResponse,
                surgicalCorrection,
                explanation,
                ieltsCriterion,
                severity,
                contrastiveCapsule
              });
            }
          });
        }
        sibling = sibling.nextElementSibling;
      }
    }

    // E. Complete Speech Reformulation (Model Discourse)
    let modelSpeech = null;
    const modelHeading = h2Elements.find(h => 
      h.textContent.includes('Complete Speech Reformulation') || 
      h.textContent.includes('Discurso Modelo')
    );

    if (modelHeading) {
      let naturalCorrected = '';
      let targetLevelUpgrade = '';
      const keyImprovements = [];

      let sibling = modelHeading.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2' && sibling.tagName !== 'FOOTER') {
        const text = sibling.textContent || '';
        if (text.includes('Natural Corrected Version') || text.includes('Versión Corregida')) {
          const contentDiv = sibling.querySelector('div:last-child');
          if (contentDiv) naturalCorrected = contentDiv.textContent.trim();
        } else if (text.includes('Target Level Version') || text.includes('Versión Nivel Objetivo')) {
          const contentDiv = sibling.querySelector('div:last-child');
          if (contentDiv) targetLevelUpgrade = contentDiv.textContent.trim();
        } else if (text.includes('Key Pedagogical Improvements') || text.includes('Mejoras')) {
          const lis = sibling.querySelectorAll('li span:last-child');
          lis.forEach(li => {
            const imp = li.textContent.trim();
            if (imp) keyImprovements.push(imp);
          });
        }
        sibling = sibling.nextElementSibling;
      }

      if (naturalCorrected || targetLevelUpgrade) {
        modelSpeech = {
          naturalCorrected,
          targetLevelUpgrade,
          keyImprovements
        };
      }
    }

    return normalizeReportData({
      studentName,
      level,
      roomCode,
      sessionDate,
      transcriptEntries,
      feedbackCards,
      modelSpeech,
      teacherNotes
    });
  }

  function normalizeReportData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Datos de sesión no válidos.');
    }

    const normCategory = (cat) => {
      const c = String(cat || 'grammar').toLowerCase().trim();
      if (c === 'upgrade' || c.includes('c1')) return 'upgrade_c1';
      if (['grammar', 'vocabulary', 'pronunciation', 'upgrade_c1', 'fluency'].includes(c)) return c;
      return 'grammar';
    };

    const cards = (Array.isArray(data.feedbackCards) ? data.feedbackCards : []).map((card, i) => ({
      id: card.id || `card_${Date.now()}_${i}`,
      category: normCategory(card.category),
      teacherContext: card.teacherContext || card.teacher_context || '',
      studentResponse: card.studentResponse || card.studentOriginal || card.student_response || '',
      surgicalCorrection: card.surgicalCorrection || card.correction || card.surgical_correction || '',
      explanation: card.explanation || card.reason || '',
      ieltsCriterion: card.ieltsCriterion || card.ielts_criterion || 'IELTS Band Descriptors',
      severity: card.severity || (normCategory(card.category) === 'upgrade_c1' ? 'upgrade' : 'basic_error'),
      contrastiveCapsule: card.contrastiveCapsule || null
    }));

    const transcript = (Array.isArray(data.transcriptEntries) ? data.transcriptEntries : []).map(entry => ({
      speaker: String(entry.speaker || '').toLowerCase().includes('teacher') ? 'Teacher' : 'Student',
      text: String(entry.text || '').trim()
    })).filter(e => e.text.length > 0);

    return {
      studentName: data.studentName || 'Student',
      level: (data.level || 'B1').toUpperCase().trim(),
      roomCode: data.roomCode || 'EFL-XXX',
      sessionDate: data.sessionDate || '',
      transcriptEntries: transcript,
      feedbackCards: cards,
      modelSpeech: data.modelSpeech || null,
      teacherNotes: data.teacherNotes || '',
      sessionExercises: Array.isArray(data.sessionExercises) ? data.sessionExercises : [],
      pronunciationIssues: Array.isArray(data.pronunciationIssues) ? data.pronunciationIssues : []
    };
  }

  const ReportLoader = {
    parseReportHtml,
    normalizeReportData
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReportLoader;
  }
  if (typeof window !== 'undefined') {
    window.ReportLoader = ReportLoader;
  }
})(typeof window !== 'undefined' ? window : global);
