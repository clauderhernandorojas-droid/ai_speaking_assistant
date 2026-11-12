const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
console.log('[MAIN] Supabase URL configurada:', !!process.env.SUPABASE_URL);

const { app, BrowserWindow, ipcMain } = require('electron');
const dbService = require('./src/db/index');
const speechCleaner = require('./src/ai/speech-cleaner');
const ieltsEngine = require('./src/ai/ielts-engine');
const sessionService = require('./src/supabase/session-service');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'IA Speaking Assistant - Teacher Dashboard',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  // Inicializar base de datos SQLite local en el directorio de usuario
  const storageDir = app.getPath('userData');
  dbService.initDatabase(storageDir);

  mainWindow.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));

  // Conectar eventos de Supabase Realtime hacia la interfaz del docente
  sessionService.setListeners({
    onStudentJoined: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:studentJoined', data);
      }
    },
    onAudioChunk: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:audioChunk', data);
      }
    },
    onMuteChange: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:muteChanged', data);
      }
    },
    onStudentLeft: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:studentLeft', data);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==============================================================================
// CANALES IPC SEGUROS: COMUNICACIÓN RENDERER <-> MAIN (SQLITE & SISTEMA)
// ==============================================================================

ipcMain.handle('db:getStudents', async () => {
  return dbService.getStudents();
});

ipcMain.handle('db:createStudent', async (event, studentData) => {
  try {
    const { name, defaultLevel, notes } = studentData || {};
    return await dbService.createStudent(name, defaultLevel, notes);
  } catch (err) {
    console.error('[MAIN db:createStudent ERROR]', err);
    throw err;
  }
});

ipcMain.handle('db:updateStudent', async (event, studentId, studentData) => {
  try {
    return await dbService.updateStudent(studentId, studentData);
  } catch (err) {
    console.error('[MAIN db:updateStudent ERROR]', err);
    throw err;
  }
});

ipcMain.handle('db:createSession', async (event, sessionData) => {
  const { studentId, sessionCode, durationMinutes } = sessionData;
  return dbService.createSession(studentId, sessionCode, durationMinutes);
});

ipcMain.handle('db:updateSession', async (event, sessionId, updates) => {
  return dbService.updateSession(sessionId, updates);
});

ipcMain.handle('db:addFeedbackItem', async (event, feedbackData) => {
  return dbService.addFeedbackItem(feedbackData);
});

ipcMain.handle('db:getFeedbackBySession', async (event, sessionId) => {
  return dbService.getFeedbackBySession(sessionId);
});

// ==============================================================================
// CANALES IPC DE IA: LIMPIEZA DE VOZ Y RÚBRICA IELTS
// ==============================================================================

ipcMain.handle('ai:cleanSpeech', async (event, rawText) => {
  return speechCleaner.cleanText(rawText);
});

ipcMain.handle('ai:evaluateUtterance', async (event, options) => {
  return ieltsEngine.evaluateUtterance(options);
});

// ==============================================================================
// CANALES IPC DE SESIÓN EN TIEMPO REAL (SUPABASE BRIDGE)
// ==============================================================================

ipcMain.handle('session:start', async (event, sessionData) => {
  try {
    return await sessionService.startSession(sessionData);
  } catch (err) {
    console.error('[MAIN session:start ERROR]', err);
    const msg = err && err.message ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
    throw new Error(msg);
  }
});

ipcMain.handle('session:stop', async (event, reason) => {
  try {
    const summary = await sessionService.stopSession(reason);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:completed', summary);
    }
    return summary;
  } catch (err) {
    console.error('[MAIN session:stop ERROR]', err);
    throw new Error(err && err.message ? err.message : String(err));
  }
});

// Ciclo de vida de la aplicación
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

