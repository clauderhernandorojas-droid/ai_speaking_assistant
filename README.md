# IA Speaking Assistant (EFL Oral Evaluation)

Sistema de evaluación y retroalimentación oral en tiempo real para profesores de inglés (EFL), dividido en dos entornos:
1. **Vista Estudiante (`student-web`):** Web PWA ultraligera sin instalación, con captura de micrófono y cero distracciones.
2. **Vista Docente (`teacher-app`):** Aplicación de escritorio con Electron, SQLite local, transcripción limpia continua y panel de 5 pestañas maestras con descriptores IELTS.
3. **Puente en la Nube (`supabase`):** Coordinación y canales Realtime de baja latencia sin exponer claves de IA al navegador del estudiante.

---

## Estructura del Proyecto

```text
ia-speaking-assistant/
├── student-web/          # Vista web ultraliviana (HTML, CSS, JS Vanilla)
│   ├── index.html        # Interfaz de entrada y sala de audio
│   ├── css/style.css     # Estilos y visualizador de pulso
│   ├── js/
│   │   ├── app.js            # Orquestador del estudiante
│   │   ├── audio-recorder.js # MediaRecorder y AudioContext
│   │   └── supabase-client.js# Conexión Realtime y Broadcast
│   ├── env.example.js    # Plantilla de credenciales Supabase
│   └── manifest.json     # Manifiesto PWA
│
├── teacher-app/          # Aplicación de escritorio (Electron + SQLite + IA)
│   ├── package.json
│   └── src/
│       └── db/schema.sql # Base de datos local SQLite (Alumnos y Feedback)
│
├── supabase/
│   └── schema.sql        # Tabla de sesiones y políticas de Realtime
└── package.json          # Monorepo scripts
```

---

## Puesta en Marcha Inicial

### 1. Configurar Supabase
1. Ingresa a tu proyecto en [Supabase Console](https://supabase.com).
2. Ve al **SQL Editor** y ejecuta el contenido de `supabase/schema.sql`.
3. Copia `student-web/env.example.js` a `student-web/env.js` y coloca tu `SUPABASE_URL` y `SUPABASE_ANON_KEY`.

### 2. Probar la Vista del Estudiante
Puedes servir la carpeta `student-web` con cualquier servidor estático:
```bash
npm run start:student
```
Abre en tu navegador `http://localhost:3000` o con parámetro directo: `http://localhost:3000?code=EFL-123`.

---

## Flujo de Trabajo en Tiempo Real (Docente <-> Estudiante)

1. **El Docente abre la App de Escritorio (`teacher-app`):**
   - Selecciona el perfil del alumno (ej. Mariana Torres - B1) y la duración de la sesión (5, 10 o 15 min).
   - Observa el código de sala generado (ej. `EFL-842`).
   - Hace clic en **"Iniciar Sesión"** (se sincroniza la sala en Supabase y se suscribe al canal de Broadcast).

2. **El Estudiante se conecta desde la Web/PWA (`student-web`):**
   - Accede a `http://localhost:3000?code=EFL-842` desde cualquier dispositivo.
   - Pulsa **"Unirse a la Sesión"**.
   - En la app del docente, el indicador de conexión cambia en vivo a **"Alumno: [Nombre]"** (`student:joined`).
   - Mientras el estudiante habla, los fragmentos de audio (`student:audio_chunk`) se reciben y acumulan en el proceso de fondo.

3. **Cierre y Evaluación Quirúrgica:**
   - Al finalizar el tiempo o presionar **"Detener Sesión"**, el docente dispara el análisis:
     - `speech-cleaner` normaliza el texto eliminando muletillas sin alterar errores gramaticales/fonéticos.
     - `ielts-engine` evalúa con las rúbricas IELTS y genera las tarjetas quirúrgicas.
     - Se guardan los resultados en SQLite local y se pueblan automáticamente las 5 pestañas maestras y la transcripción corrida.

