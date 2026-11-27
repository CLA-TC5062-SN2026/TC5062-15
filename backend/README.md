# Audio2Score CRUD API

API REST de desarrollo para la Parte 2, validada con `openapi_equipo.yaml` y `esquema_bd.sql`, incluidos junto al backend.

## Tecnologías

- Node.js 20 o posterior
- Express 5
- PostgreSQL embebido mediante PGlite 0.5 (para ejecutar el ejercicio sin instalar un servicio PostgreSQL)
- Multer para cargas multipart
- YAML para comprobar las operaciones declaradas en OpenAPI al arrancar
- Spotify Basic Pitch 0.4 para transcribir audio localmente a eventos de notas, sin enviar archivos a una API externa
- `crypto.scrypt` para contraseñas nuevas, compatibilidad de lectura con bcryptjs y jsonwebtoken para JWT

La ruta de la base la determina `DATABASE_PATH` (por defecto `data/audio2score`). Esta implementación usa PostgreSQL embebido mediante PGlite para desarrollo local. Al iniciar, importa `esquema_bd.sql` solo cuando la base está vacía y verifica las 13 tablas.

## Iniciar

En la primera instalación, desde `backend/` crea el entorno Python del motor e instala sus dependencias. Después inicia la API:

```powershell
py -3.8 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-audio.txt
npm.cmd install
npm.cmd start
```

La configuración local ya creada está en `.env`. En una instalación nueva, copia `.env.example` a `.env` y configura `JWT_SECRET` con al menos 32 caracteres aleatorios antes de iniciar la API. El motor usa `backend/.venv` por defecto; `BASIC_PITCH_PYTHON` permite indicar otra ruta al intérprete.

La consola debe indicar conexión PostgreSQL, 13 tablas verificadas, 22 operaciones OpenAPI registradas y JWT activo.

## Autenticación JWT

`POST /auth/register` crea usuarios y nunca devuelve el hash. `POST /auth/login` emite un JWT HS256 con expiración explícita; las contraseñas nuevas usan `scrypt` asíncrono, se aceptan hashes bcrypt existentes y se limitan los intentos fallidos por IP/correo. `GET /auth/me` exige `Authorization: Bearer <token>`. `POST /auth/logout` invalida el token mediante `revoked_tokens`. Las rutas funcionan bajo `/v1` y se conservan aliases en la raíz para compatibilidad.

Configura `JWT_SECRET` con al menos 32 bytes aleatorios y `JWT_EXPIRATION` en segundos. No compartas ni subas `.env` a GitHub; sí puedes subir `.env.example`. Las rutas protegidas requieren un JWT del propietario del recurso; el modelo no define roles.

## Procesamiento de audio

Las cargas, configuraciones y reintentos registran eventos en `outbox_messages`. Un worker dentro del proceso Node consume la cola, actualiza el intento y el proyecto, y ejecuta Spotify Basic Pitch mediante `backend/src/basic_pitch_transcribe.py`. Las notas resultantes se guardan como una versión de transcripción en la misma base PGlite/PostgreSQL, ligada al intento y al audio original.

El motor local no requiere una cuenta ni una clave de API. En Windows se usa Python 3.8 y ONNX Runtime. El motor procesa preferentemente grabaciones de un instrumento a la vez; los resultados generados quedan como borrador para revisión.

El adaptador conserva la amplitud de cada evento de Basic Pitch como un indicador estimado de confianza. No es una probabilidad calibrada. `LOW_CONFIDENCE_THRESHOLD` define el umbral de 0 a 1 (por defecto `0.5`) para marcar notas que requieren revisión; tempo y tonalidad permanecen nulos si el motor no los estima. La API valida únicamente archivos `.mp3` y `.wav`, de hasta 100 MiB y 15 minutos.

## Audio y exportaciones

El audio original se reproduce mediante `GET /v1/projects/{projectId}/audio-files/{audioFileId}/file`, protegido por JWT y limitado al propietario del proyecto. La transcripción devuelve esa ruta en `audioFileUrl`.

Las solicitudes MIDI y PDF se procesan en una cola interna; los archivos se guardan bajo `UPLOAD_DIR/exports/` y el endpoint protegido los entrega cuando están listos. Al eliminar un proyecto, los archivos asociados se pasan a `storage_deletions` para su limpieza idempotente. El MIDI conserva pitch, inicio, duración y tempo cuando está disponible. El PDF incluye pentagrama esquemático en clave de sol, tabla con notas y tiempos, nombre del proyecto, fecha y aviso de borrador.

## Variables de entorno

Ver `.env.example`. `BASIC_PITCH_PYTHON` es opcional; si se omite, se usa `.venv/Scripts/python.exe` en Windows o `.venv/bin/python` en otros sistemas. `LOW_CONFIDENCE_THRESHOLD` es opcional y acepta valores entre `0` y `1`.
