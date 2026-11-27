# Audio2Score — TC5062-15

Audio2Score es un prototipo web para músicos, estudiantes y docentes que necesitan obtener un borrador de transcripción musical desde una grabación. Organiza cada audio como un proyecto, lo procesa localmente y permite revisar las notas antes de exportarlas. La transcripción es una ayuda inicial y requiere criterio musical humano.

## Arquitectura

El navegador presenta la aplicación React. En desarrollo, Vite sirve la interfaz y reenvía las llamadas /v1 al backend Express. El backend valida JWT, controla la propiedad de los proyectos, guarda metadatos y estados en PGlite (PostgreSQL embebido), almacena archivos localmente y procesa audio mediante un worker del proceso Node que invoca Basic Pitch desde Python.

~~~mermaid
flowchart LR
    U[Usuario en navegador] -->|SPA React| FE[Frontend React 19]
    FE -->|/v1 por proxy Vite| API[API REST Express 5]
    API -->|JWT Bearer| AUTH[Autenticación y autorización]
    API --> DB[(PGlite / PostgreSQL)]
    API --> STORE[(Archivos locales: audio y exportaciones)]
    API --> QUEUE[Outbox y worker local]
    QUEUE --> BP[Python 3.8 + Basic Pitch]
    BP --> QUEUE
    QUEUE --> DB
    API -->|JSON, audio, MIDI y PDF| FE
~~~

PGlite usa el motor PostgreSQL dentro del proceso backend; no se requiere un servidor PostgreSQL aparte para el entorno local. Las cargas y exportaciones se procesan en segundo plano mediante la cola local. El audio y las exportaciones se guardan en disco bajo el directorio configurado.

## Stack tecnológico

| Tecnología | Versión del proyecto | Propósito |
|---|---|---|
| Node.js | 20 o posterior; frontend: 20.19+ o 22.12+ | Entorno de ejecución y herramientas |
| React / React DOM | 19.x | Interfaz de usuario por componentes |
| Vite | 8.x | Servidor de desarrollo, proxy API y build |
| CSS Modules | Incluido en Vite | Estilos por componente y página |
| Express | 5.x | API REST |
| PGlite | 0.5.x | Base de datos PostgreSQL embebida para desarrollo local |
| Python | 3.8 | Runtime del motor de audio en Windows |
| Spotify Basic Pitch | 0.4.0 | Detección local de eventos de notas desde audio |
| JWT HS256 | jsonwebtoken 9.x | Autenticación de peticiones protegidas |

La amplitud de cada evento de Basic Pitch se presenta como indicador estimado de confianza; no es una probabilidad calibrada. El umbral local es ajustable y se considera provisional.

## Requisitos previos

- Windows 10/11 o sistema compatible.
- Node.js 20.19+ o 22.12+ y npm.
- Python 3.8 disponible como py -3.8 para instalar y ejecutar Basic Pitch en Windows.
- Git.

## Instalación y ejecución local

### 1. Clonar el repositorio

~~~powershell
git clone https://github.com/CLA-TC5062-SN2026/TC5062-15.git
Set-Location .\TC5062-15
~~~

Si ya tienes el repositorio local, abre PowerShell en su carpeta raíz. En un entorno nuevo, el backend inicializa una base local vacía y carga el esquema SQL incluido. Para conservar una base local existente, no cambies DATABASE_PATH ni borres backend/data.

### 2. Configurar e instalar el backend

~~~powershell
Set-Location .\backend
npm.cmd install
py -3.8 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-audio.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
~~~

Edita backend/.env y define JWT_SECRET con una cadena aleatoria de al menos 32 caracteres. Puedes generarla sin copiar el secreto al repositorio:

~~~powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Copia el resultado al valor local de JWT_SECRET. No publiques backend/.env ni compartas el secreto. El archivo .env.example contiene solamente nombres y valores de configuración de ejemplo.

Inicia el backend en una ventana de PowerShell y déjala abierta:

~~~powershell
npm.cmd start
~~~

Al arrancar debe indicar que escucha en http://localhost:3000, que hay 13 tablas verificadas y 22 operaciones OpenAPI registradas.

### 3. Configurar e instalar el frontend

Abre una segunda ventana de PowerShell desde la raíz del repositorio:

~~~powershell
Set-Location .\frontend
npm.cmd install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
~~~

Abre la URL que muestre Vite, normalmente http://localhost:5173. En desarrollo, Vite reenvía /v1 al API en localhost:3000, así que el navegador no necesita una configuración CORS separada para esta ejecución local.

### 4. Comprobaciones disponibles

La carpeta no incluye una suite automatizada en backend/tests. No se afirma que existan pruebas S09-A1 aprobadas. Los controles disponibles son:

~~~powershell
# En backend/
npm.cmd run lint
node --check src/server.js

# En frontend/
npm.cmd run build
~~~

La matriz de trazabilidad y la retrospectiva están en `S11_A1/`. El enlace al video de demostración está en `S11_A1/demo_link.txt`.

## Variables de entorno

No incluyas valores secretos en documentación ni en Git. Los valores abajo describen defaults del ejemplo local, no los valores privados del archivo .env de cada desarrollador.

| Variable | Aplicación | Uso | Ejemplo/default |
|---|---|---|---|
| PORT | Backend | Puerto HTTP de la API | 3000 |
| DATABASE_PATH | Backend | Directorio de datos persistentes de PGlite | ./data/audio2score |
| UPLOAD_DIR | Backend | Directorio de audios y archivos exportados | ./data/uploads |
| SCHEMA_FILE | Backend | Esquema SQL inicial | ./esquema_bd.sql |
| OPENAPI_FILE | Backend | Contrato validado al iniciar | ./openapi_equipo.yaml |
| MAX_UPLOAD_BYTES | Backend | Límite de carga en bytes | 104857600 |
| LOW_CONFIDENCE_THRESHOLD | Backend | Umbral inicial de notas que requieren revisión, entre 0 y 1 | 0.5 (provisional) |
| JWT_SECRET | Backend | Clave privada para firmar JWT; requerida y distinta por entorno | Sin valor en plantilla |
| JWT_EXPIRATION | Backend | Expiración del JWT en segundos | 3600 |
| BASIC_PITCH_PYTHON | Backend | Ruta opcional a Python para el motor de audio | Si se omite, usa backend/.venv |
| VITE_API_URL | Frontend | Prefijo base del API | /v1 |

## Video de demostración

El video está alojado en Drive porque supera el límite de tamaño de GitHub. Consulta el enlace en `S11_A1/demo_link.txt`.

## Despliegue

No hay una URL de producción configurada para esta versión. La aplicación descrita en este README es el entorno local del repositorio.

## Documentación

- OpenAPI y esquema de base: `backend/`.
- Matriz de trazabilidad, retrospectiva y enlace al video: `S11_A1/`.
