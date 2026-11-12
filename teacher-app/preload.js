const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposición segura de APIs al proceso Renderizador (Frontend)
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Base de Datos Local SQLite
  getStudents: () => ipcRenderer.invoke('db:getStudents'),
  createStudent: (studentData) => ipcRenderer.invoke('db:createStudent', studentData),
  updateStudent: (studentId, studentData) => ipcRenderer.invoke('db:updateStudent', studentId, studentData),
  createSession: (sessionData) => ipcRenderer.invoke('db:createSession', sessionData),
  updateSession: (sessionId, updates) => ipcRenderer.invoke('db:updateSession', sessionId, updates),
  addFeedbackItem: (feedbackData) => ipcRenderer.invoke('db:addFeedbackItem', feedbackData),
  getFeedbackBySession: (sessionId) => ipcRenderer.invoke('db:getFeedbackBySession', sessionId),

  // Motor de Inteligencia Artificial (Limpieza y Rúbricas IELTS)
  cleanSpeech: (rawText) => ipcRenderer.invoke('ai:cleanSpeech', rawText),
  evaluateUtterance: (options) => ipcRenderer.invoke('ai:evaluateUtterance', options),

  // Servicio de Sesión en Tiempo Real (Supabase Realtime Bridge)
  startRealtimeSession: (sessionData) => ipcRenderer.invoke('session:start', sessionData),
  stopRealtimeSession: (reason) => ipcRenderer.invoke('session:stop', reason),

  // Escuchadores de Eventos del Estudiante y Sesión
  onStudentJoined: (callback) => ipcRenderer.on('session:studentJoined', (_event, data) => callback(data)),
  onAudioChunk: (callback) => ipcRenderer.on('session:audioChunk', (_event, data) => callback(data)),
  onMuteChanged: (callback) => ipcRenderer.on('session:muteChanged', (_event, data) => callback(data)),
  onStudentLeft: (callback) => ipcRenderer.on('session:studentLeft', (_event, data) => callback(data)),
  onSessionCompleted: (callback) => ipcRenderer.on('session:completed', (_event, data) => callback(data))
});

