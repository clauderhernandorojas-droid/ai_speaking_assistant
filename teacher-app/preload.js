const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposición segura de APIs al proceso Renderizador (Frontend)
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Base de Datos Local SQLite
  getStudents: () => ipcRenderer.invoke('db:getStudents'),
  createStudent: (studentData) => ipcRenderer.invoke('db:createStudent', studentData),
  updateStudent: (studentId, studentData) => ipcRenderer.invoke('db:updateStudent', studentId, studentData),
  deleteStudent: (studentId) => ipcRenderer.invoke('db:deleteStudent', studentId),
  createSession: (sessionData) => ipcRenderer.invoke('db:createSession', sessionData),
  updateSession: (sessionId, updates) => ipcRenderer.invoke('db:updateSession', sessionId, updates),
  addFeedbackItem: (feedbackData) => ipcRenderer.invoke('db:addFeedbackItem', feedbackData),
  getFeedbackBySession: (sessionId) => ipcRenderer.invoke('db:getFeedbackBySession', sessionId),

  // Motor de Inteligencia Artificial (Limpieza y Rúbricas IELTS)
  cleanSpeech: (rawText) => ipcRenderer.invoke('ai:cleanSpeech', rawText),
  evaluateUtterance: (options) => ipcRenderer.invoke('ai:evaluateUtterance', options),
  generateMicroExercise: (params) => ipcRenderer.invoke('ai:generateMicroExercise', params),

  // Servicio de Sesión en Tiempo Real (Supabase Realtime Bridge)
  initRealtimeRoom: (sessionData) => ipcRenderer.invoke('session:initRoom', sessionData),
  startRealtimeSession: (sessionData) => ipcRenderer.invoke('session:start', sessionData),
  stopRealtimeSession: (reason) => ipcRenderer.invoke('session:stop', reason),
  closeRealtimeSession: () => ipcRenderer.invoke('session:closeRoom'),
  broadcastGuidedCorrection: (payload) => ipcRenderer.invoke('session:broadcastGuidedCorrection', payload),
  broadcastMicroExercise: (payload) => ipcRenderer.invoke('session:broadcastMicroExercise', payload),
  broadcastModelSpeech: (payload) => ipcRenderer.invoke('session:broadcastModelSpeech', payload),

  // Escuchadores de Eventos del Estudiante y Sesión
  onStudentJoined: (callback) => ipcRenderer.on('session:studentJoined', (_event, data) => callback(data)),
  onAudioChunk: (callback) => ipcRenderer.on('session:audioChunk', (_event, data) => callback(data)),
  onTranscriptSegment: (callback) => ipcRenderer.on('session:transcriptSegment', (_event, data) => callback(data)),
  onMuteChanged: (callback) => ipcRenderer.on('session:muteChanged', (_event, data) => callback(data)),
  onStudentLeft: (callback) => ipcRenderer.on('session:studentLeft', (_event, data) => callback(data)),
  onSessionCompleted: (callback) => ipcRenderer.on('session:completed', (_event, data) => callback(data)),
  onMicroExerciseAnswer: (callback) => ipcRenderer.on('session:microExerciseAnswer', (_event, data) => callback(data))
});

