# Revisión del esquema SQL — Audio2Score

**Archivo revisado:** `esquema_bd.sql` (PostgreSQL 13+)
**Referencias:** `SRS_equipo_corregido_final.md` (v7.0), `diagrama_clases_equipo.puml`, `openapi_equipo.yaml`, `arquitectura_equipo.md`
**Resultado:** `outputs/esquema_bd.sql` revisado y ajustado; se sincronizaron el diagrama de clases y OpenAPI, y se agregó `outputs/esquema_er.puml`.

> **Alcance y límites de la revisión.** Esta es la tercera pasada: incluye el SRS y las decisiones registradas en los artefactos del equipo (JWT Bearer en OpenAPI; ver sección 8). El esquema se importó correctamente en PostgreSQL 18.6 embebido mediante PGlite; la importación creó 13 tablas y se verificaron claves y restricciones. Docker no estaba disponible para ejecutar un servicio PostgreSQL dedicado. Antes de usarlo en el entorno definitivo, importa el SQL en la instancia PostgreSQL que el equipo vaya a conservar.

---

## 1. ¿Están representadas todas las entidades del diagrama de clases?

Sí. Las clases `<<request>>`, listas (`*List`), `AuthToken`, `Error`, `ValidationError` y `AudioUploadResult` son DTO sin persistencia propia.

| Clase del diagrama | Tabla | Estado |
|---|---|---|
| `User` | `users` | OK |
| `Project` | `projects` | OK |
| `AudioFile` | `audio_files` | OK (corregida) |
| `ProcessingAttempt` | `processing_attempts` | OK (corregida) |
| `Transcription` | `transcriptions` | OK (corregida) |
| `MusicalNote` | `musical_notes` | OK |
| `LowConfidenceSegment` | `low_confidence_segments` | OK (corregida) |
| `TranscriptionSummary` | `transcription_summaries` | OK |
| `EstimatedField` (enum, lista en el resumen) | `transcription_summary_estimated_fields` | OK |
| `Export` | `exports` | OK (corregida) |
| `RevokedToken` (persistencia técnica añadida) | `revoked_tokens` | OK; respalda invalidación de JWT al cerrar sesión |
| `StorageDeletion` (persistencia técnica añadida) | `storage_deletions` | OK; permite borrar objetos externos de forma reintentable |
| `OutboxMessage` (persistencia técnica añadida) | `outbox_messages` | OK; permite publicar trabajos sin perder el evento transaccional |
| Enumeraciones (`ProjectStatus`, `ProcessingAttemptStatus`, `AudioFileFormat`, `AudioFileStatus`, `ExportFormat`, `ExportStatus`) | `CHECK ... IN (...)` | OK, valores idénticos |
| `AuthToken` | — (DTO; el token no se guarda) | OK. La revocación de JWT se cubre con `revoked_tokens` (C10) |

## 2. ¿Están todos los atributos?

Todos los atributos persistentes del modelo están presentes. Los atributos técnicos añadidos para operación se documentaron como persistencia interna en el diagrama de clases. Los siguientes no se guardan como tales:

| Atributo | Motivo |
|---|---|
| `User.passwordHash` → `users.password_hash` | Persistido; nunca se expone en la respuesta. |
| `Transcription.notes`, `summary`, `lowConfidenceSegments` | Se componen desde `musical_notes`, `transcription_summaries` y `low_confidence_segments`. |
| `Transcription.audioFileUrl`, `Export.downloadUrl` | URL temporal y autorizada, generada al responder. En BD solo existen `storage_key` y `download_key`. OpenAPI ahora marca estos campos opcionales como `nullable`. |
| `TranscriptionSummary.estimatedFields` | Tabla hija `transcription_summary_estimated_fields`. |
| `TranscriptionSummary.tempoEstimated`, `keyEstimated` | Se toman de `transcriptions` (fuente única); ya no se duplican en `transcription_summaries` (C14). |
| `MusicalNote` sin id propio en la API | En BD se agregan `id` técnico y `note_index` (orden y referencia desde `LowConfidenceSegment.noteIndex`). |

## 3. Correcciones realizadas

### C1. Llaves foráneas que no garantizaban pertenencia al mismo proyecto (grave)

**Problema.** `projects.audio_file_id`, `projects.current_transcription_id`, `processing_attempts.transcription_id`, `transcriptions.processing_attempt_id` y `exports.transcription_id` referenciaban solo el `id` de la otra tabla. Con eso era posible que el proyecto A apuntara al audio o a la transcripción vigente del proyecto B, o que una exportación mezclara proyectos. Eso rompe la regla "autorización por propietario" y la semántica de `Project.currentTranscriptionId`.

**Corrección.**
- Se agregaron `UNIQUE (id, project_id)` en `audio_files`, `transcriptions` y `processing_attempts`.
- Las cinco FK ahora son compuestas y apuntan a `(id, project_id)`; en `projects` la pareja es `(audio_file_id, id)` y `(current_transcription_id, id)`.
- Con valor `NULL` la FK no se evalúa (`MATCH SIMPLE`), de modo que las cardinalidades `[0..1]` se conservan.

**Consecuencia.** `ON DELETE SET NULL` no es aplicable a una FK compuesta cuyo `project_id` es `NOT NULL` (PostgreSQL 13/14), así que pasan a `NO ACTION`. Es aceptable porque audios y versiones no se borran individualmente: la inmutabilidad de versiones lo impide y el audio es único por proyecto. El borrado de proyecto o usuario sigue funcionando por `CASCADE`.

### C2. Referencias circulares y borrado en cascada

**Problema.** Intento ↔ transcripción y proyecto ↔ audio/transcripción forman ciclos. Con FK inmediatas, insertar un par intento/transcripción o borrar un proyecto en cascada podía fallar según el orden en que PostgreSQL ejecutara las acciones.

**Corrección.** Las cinco FK de C1 se declararon `DEFERRABLE INITIALLY DEFERRED`: se validan al hacer commit.

### C3. Audios rechazados no podían registrarse (grave)

**Problema.** `audio_files` admite `status = 'rechazado'` con `rejection_reason`, pero los `CHECK` de tamaño (≤ 100 MB) y duración (≤ 900 s) aplicaban siempre. Un audio rechazado justamente por exceder esos límites violaba la restricción y no podía guardarse. Además `storage_key` era `NOT NULL` aunque un audio rechazado no se almacena.

**Corrección.**
- Límites de tamaño y duración exigidos solo si `status = 'aceptado'` (`size_bytes > 0` y `duration_seconds > 0` se mantienen siempre).
- `storage_key` pasa a ser nullable, con `CHECK` que lo exige para audios aceptados.
- `rejection_reason` ahora es obligatorio **si y solo si** el estado es `rechazado` (antes solo se prohibía en `aceptado`).

### C4. Restricciones de coherencia de estados en `processing_attempts`

Faltaban reglas implícitas en el contrato (`errorMessage` "cuando el intento termina fallido", estados de intento, `finishedAt`):

- `finished_at` presente **si y solo si** el estado es `completado` o `fallido`.
- `error_message` solo con estado `fallido`.
- Estado `completado` exige `transcription_id`.
- **Un solo intento activo por proyecto** (índice único parcial sobre `pendiente`/`procesando`). Respalda las respuestas `409 Conflict` de reintento y configuración, y evita procesamientos concurrentes del mismo audio.
- Un intento genera a lo más una transcripción: índices únicos parciales en `processing_attempts.transcription_id` y `transcriptions.processing_attempt_id` (relación `0..1 → 0..1` del diagrama).

### C5. Coherencia de `projects`

- `status` en `procesando` o `completado` exige `audio_file_id`.
- `status = 'completado'` exige `current_transcription_id`.
- `updated_at` se mantiene con un trigger (`set_updated_at`); antes quedaba fijo en la fecha de creación y el campo `updatedAt` del contrato era engañoso.
- Índice parcial sobre `current_transcription_id` para que la validación de la FK compuesta no haga escaneos completos.

### C6. Inmutabilidad de versiones de transcripción

**Problema.** El contrato y el diagrama establecen que cada revisión es inmutable ("crea una nueva versión en lugar de sobrescribir"), pero el esquema permitía `UPDATE` sobre notas y versiones.

**Corrección.**
- Trigger `forbid_update` sobre `musical_notes`, `transcription_summaries` y `low_confidence_segments`.
- Trigger `transcriptions_guard_immutable`: impide cambiar `project_id`, `version`, `processing_attempt_id`, `tempo_estimated`, `key_estimated` y `created_at`. Se deja libre `is_draft`/`updated_at`.
- Se agregaron guards de eliminación para impedir borrar versiones y sus componentes por separado; el borrado en cascada del proyecto sigue permitido para RF-15.

### C7. `low_confidence_segments` podía apuntar a una nota inexistente

`note_index` era un entero libre. Ahora es una FK compuesta `(transcription_id, note_index) → musical_notes` con `ON DELETE CASCADE`, y `reason` no puede estar vacío. Al insertar, las notas deben guardarse antes que los segmentos.

### C8. Soporte para `Idempotency-Key` (OpenAPI)

Los endpoints de reintento y de creación de exportación aceptan `Idempotency-Key` (16–255 caracteres), pero no había dónde guardarlo para detectar duplicados. Se agregó `idempotency_key VARCHAR(255)` en `processing_attempts` y `exports`, con `CHECK` de longitud mínima 16 e índice único parcial `(project_id, idempotency_key)`.

### C9. Columnas de worker exigidas por la arquitectura

`arquitectura_equipo.md` asigna al worker "actualizar estados/heartbeat" y manejar lease. No había columnas para ello. Se agregaron `heartbeat_at` y `lease_expires_at` (nullable) en `processing_attempts`. Los **tiempos** de lease y heartbeat siguen siendo decisión pendiente; solo se habilita el soporte.

### C10. Cierre de sesión sin soporte en el esquema (RF-01-AC-4) — nuevo con el SRS

**Problema.** RF-01-AC-4 exige que cerrar sesión "invalida la sesión" y el OpenAPI fija JWT Bearer sin estado. Sin un registro de tokens revocados, el token seguiría siendo válido hasta expirar y el criterio no se cumpliría.

**Corrección.** Tabla técnica `revoked_tokens (jti, user_id, revoked_at, expires_at)` con índice por `expires_at` para purga. Si el equipo decide finalmente sesiones de servidor en lugar de JWT, esta tabla se reemplaza por una tabla de sesiones.

### C11. Medición de rendimiento (RNF-01) — nuevo con el SRS

**Problema.** RNF-01 mide desde "el inicio efectivo del procesamiento", excluyendo carga, validación y espera. `processing_attempts.started_at` es la creación del intento (con la cola, incluye tiempo de espera), por lo que el tiempo no era medible solo con ese campo.

**Corrección.** Columna `processing_started_at` (la fija el worker al pasar a `procesando`), con restricciones: nula en `pendiente`, obligatoria en `procesando`/`completado`, y ordenada respecto a `started_at` y `finished_at`. El tiempo de RNF-01 es `finished_at - processing_started_at`. La configuración del entorno y del motor puede registrarse en `configuration` (JSONB).

### C12. Borrado de objetos de almacenamiento (RF-15-AC-1, RNF-05) — decisión de mejores prácticas

**Problema.** El `CASCADE` borraba solo metadatos; audios y exportaciones quedaban huérfanos en el almacenamiento de objetos, incumpliendo "eliminar el proyecto, el audio y los resultados".

**Corrección.** Tabla técnica `storage_deletions` (cola de borrado) y trigger `BEFORE DELETE` sobre `audio_files` (`storage_key`) y `exports` (`download_key`). Dispara también en borrados en cascada (proyecto o usuario) y encola la clave en la misma transacción. Un proceso de limpieza borra el objeto de forma idempotente, reintenta y marca `deleted_at`. Si la transacción de borrado se revierte, no queda nada encolado.

### C13. Un solo audio por proyecto y audio original inmutable (RF-02, RF-03) — decisión de mejores prácticas

**Corrección.** Trigger que impide modificar un `audio_files` con estado `aceptado`. Un registro `rechazado` sí puede reemplazarse al cargar de nuevo en el mismo proyecto, con `INSERT ... ON CONFLICT (project_id) DO UPDATE ... WHERE audio_files.status = 'rechazado'` (la cláusula `WHERE` evita pisar un audio aceptado). Los archivos rechazados no se almacenan (minimización de datos): solo se guarda el metadato y la causa.

### C14. Fuente única para tempo, tonalidad y conteo de notas — decisión de mejores prácticas

- `tempo_estimated` y `key_estimated` se eliminaron de `transcription_summaries`; el resumen los lee de `transcriptions`. Desaparece el riesgo de dos valores distintos para el mismo dato.
- `notes_count` se conserva (evita contar en cada lectura), pero un *constraint trigger* diferido verifica al commit que coincida con las filas de `musical_notes`.
- El vínculo intento ↔ transcripción (`transcription_id` y `processing_attempt_id`) se valida en ambos sentidos al commit con otro *constraint trigger* diferido. El worker debe escribir transcripción e intento en la misma transacción.

### C15. Umbral de baja confianza reproducible (RF-07-AC-3, RF-10-AC-2) — decisión de mejores prácticas

**Corrección.** Columna `transcriptions.low_confidence_threshold` (0–1, inmutable) que registra el umbral con el que se calcularon `is_low_confidence` y los segmentos. Cambiar el umbral de la aplicación después de calibrarlo no altera versiones ya generadas, y cada versión es auditable. El valor vigente vive en la configuración de la aplicación (por ejemplo `LOW_CONFIDENCE_THRESHOLD`); no se fija un número aquí porque el SRS exige calibrarlo con pruebas.

### C16. Formato de altura (`pitch`)

`CHECK` con notación científica de alturas: letra A–G, alteración opcional (`#`, `##`, `b`, `bb`) y octava `-1` a `9` (ej. `C4`, `F#3`, `Bb2`). Es más estricto que el OpenAPI, que solo trae un ejemplo; ver recomendación para el contrato en la sección 8.

### C17. Índices

- Se eliminaron `ix_projects_status` (baja selectividad; las consultas son siempre por propietario) y `ix_audio_files_uploaded_at` (hay un audio por proyecto, el acceso es por `project_id`).
- Se agregó `ix_projects_owner_active`, índice parcial para el listado de proyectos activos (`archived_at IS NULL`).

### C18. Otras restricciones menores

| Tabla | Restricción agregada | Motivo |
|---|---|---|
| `users` | `email` con formato mínimo `algo@algo` sin espacios | Evitar basura evidente; la validación completa sigue en la API (`format: email`). |
| `transcriptions` y `transcription_summaries` | `tempo_estimated > 0` | Un tempo no positivo no tiene sentido musical. |
| `musical_notes` | `pitch` no vacío | Campo requerido del contrato. |
| `exports` | `status = 'listo'` exige `transcription_id` | Una exportación lista debe provenir de una versión concreta. |

### C19. La referencia del audio podía quedar inconsistente

**Problema.** `projects.audio_file_id` y `audio_files.project_id` duplican la relación para responder el contrato, pero las FK por sí solas permitían insertar un audio de un proyecto dejando el puntero del proyecto en `NULL`.

**Corrección.** Un constraint trigger diferido valida al commit que ambos lados representen el mismo audio. La regla permite insertar/actualizar ambos dentro de una transacción y también permite el borrado en cascada del proyecto.

### C20. `notes_count` podía quedar obsoleto después de crear el resumen

**Problema.** Revisé la primera versión de `check_summary_notes_count`: solo se disparaba al insertar el resumen; añadir una nota en una transacción posterior podía dejar el contador desactualizado.

**Corrección.** El constraint trigger diferido también se dispara al insertar o borrar notas. Si existe resumen, valida al commit que su contador coincida con las filas de `musical_notes`.

### C21. Las versiones y sus componentes podían borrarse individualmente

**Problema.** Los triggers iniciales impedían `UPDATE`, pero no `DELETE` directo de notas, resúmenes, segmentos o versiones, lo que permitía alterar el historial fuera del flujo de eliminación del proyecto.

**Corrección.** Se agregaron triggers que rechazan eliminaciones individuales mientras exista la versión/proyecto propietario. El borrado en cascada iniciado por la eliminación del proyecto continúa permitido y conserva la cola `storage_deletions`.

### C22. Sincronización de los contratos y diagramas (TIP)

Se actualizaron `openapi_equipo.yaml` y `diagrama_clases_equipo.puml` tras revisar el SQL:

- OpenAPI marca `Transcription.audioFileUrl` y `Export.transcriptionId` como nullable, según la opcionalidad del modelo.
- OpenAPI añade a `MusicalNote.pitch` el patrón que valida el SQL.
- Se quitaron los parámetros `JobId` y `TranscriptionId` que no estaban referenciados.
- El diagrama de clases ahora muestra los campos internos añadidos (`lowConfidenceThreshold`, datos del worker, claves de almacenamiento e idempotencia) y las tablas técnicas `RevokedToken`, `StorageDeletion` y `OutboxMessage`. Estos campos internos no se agregan al API porque son de persistencia/operación.
- Se generó `esquema_er.puml` con tablas, PK, FK y cardinalidades, incluyendo las tablas técnicas.

## 4. Llaves foráneas y cardinalidades

| Relación del diagrama | Implementación | Veredicto |
|---|---|---|
| `User 1 — 0..* Project` | `projects.owner_id → users.id` (cascade) | OK |
| `Project 1 — 0..1 AudioFile` | `audio_files.project_id UNIQUE` + `projects.audio_file_id` compuesta | OK tras C1 |
| `Project 1 — 0..* ProcessingAttempt` | `processing_attempts.project_id` (cascade) | OK |
| `Project 1 — 0..* Transcription` (historial) | `transcriptions.project_id` + `UNIQUE (project_id, version)` | OK |
| `Project → 0..1 Transcription` (vigente) | `projects.current_transcription_id` compuesta | OK tras C1 |
| `ProcessingAttempt 0..1 → 0..1 Transcription` | FK compuestas en ambos sentidos + índices únicos parciales | OK tras C1/C4 |
| `Transcription 1 *— 0..* MusicalNote` | `musical_notes.transcription_id` (cascade) | OK |
| `Transcription 1 *— 0..1 TranscriptionSummary` | PK = FK `transcription_id` (1:1 real) | OK |
| `Transcription 1 *— 0..* LowConfidenceSegment` | FK compuesta a `musical_notes` | OK tras C7 |
| `Transcription 1 — 0..* Export` | `exports.transcription_id` compuesta | OK tras C1 |

## 5. Coherencia de tipos con `openapi_equipo.yaml`

| OpenAPI | SQL | Veredicto |
|---|---|---|
| `string/uuid` | `UUID` | OK |
| `string/date-time` | `TIMESTAMPTZ` | OK |
| `string/email`, `maxLength: 254` | `VARCHAR(254)` | OK |
| `Project.name` (máx. 120), `description` (máx. 1000) | `VARCHAR(120)`, `VARCHAR(1000)` | OK |
| `AudioFile.sizeBytes: integer` | `BIGINT` | OK (cubre ≥ 100 MB con holgura) |
| `AudioFile.durationSeconds: number` | `NUMERIC(8,3)` | OK |
| `MusicalNote.confidence` 0–1 | `NUMERIC(5,4)` + `CHECK` | OK |
| `startTimeSeconds`, `durationSeconds: number` | `NUMERIC(12,6)` | OK |
| `Transcription.version: integer` | `INTEGER > 0` | OK |
| `ProcessingAttempt.configuration: object` | `JSONB` | OK |
| Enumeraciones `string/enum` | `VARCHAR` + `CHECK` | OK |
| `AudioFile.format` (`MP3`/`WAV`) | `VARCHAR(3)` | OK |
| `Export.format` (`midi`/`pdf`) | `VARCHAR(4)` | OK |

Estado de la observación: resuelta en el OpenAPI de equipo; ambos campos ahora declaran `nullable: true`. El patrón de `MusicalNote.pitch` también se sincronizó con el `CHECK` del SQL.

## 6. Contraste con el SRS (v7.0)

| Requisito | Qué exige al esquema | Resultado |
|---|---|---|
| RF-01-AC-1/2/3 | Cuenta única por correo | `uq_users_email_ci`. OK |
| RF-01-AC-4 | Invalidar la sesión | Con JWT: `revoked_tokens` (C10) |
| RF-02 / RF-03 | Un solo audio por proyecto; datos aislados por proyecto | `audio_files.project_id UNIQUE` y FK compuestas (C1). OK |
| RF-02-AC-3 | Campos obligatorios al crear proyecto | `name NOT NULL` y no vacío. OK. **No exige nombre único** |
| RF-03-AC-2/3, RF-04 | Rechazar formato/contenido inválido, > 15 min o > 100 MB, con la causa | `rejection_reason` obligatorio si `rechazado`; límites solo para aceptados (C3) |
| RF-05-AC-3 | Sin configuración obligatoria no se inicia el procesamiento | No se crea intento hasta completarla; proyecto queda `pendiente`. OK |
| RF-06 / RNF-04 | Estados pendiente, procesando, completado, fallido; nunca "completado" en curso | `CHECK` de estados y coherencia (C4, C5). La sincronía proyecto ↔ intento sigue siendo responsabilidad de la API (misma transacción) |
| RF-06-AC-2, RF-14-AC-1 | Mostrar el motivo del fallo **"si está disponible"** | Correcto que `failure_reason` y `error_message` sean opcionales; no se impone `NOT NULL` |
| RF-07-AC-2 | Altura, ritmo y duración de cada nota | `pitch`, `start_time_seconds`, `duration_seconds`. OK |
| RF-07-AC-3, RF-10-AC-2 | Baja confianza respecto de un umbral configurable | `confidence` por nota + `low_confidence_threshold` por versión (C15) |
| RF-09 / RF-13-AC-2 | Versión vigente; historial sin sobrescribir | Versiones inmutables + `current_transcription_id` (C1, C6). OK |
| RF-11 / RF-12 | Exportar la versión más reciente; PDF con nombre de proyecto, fecha e indicación de borrador | `exports.transcription_id`, `created_at`, `draft_notice`. OK |
| RF-13-AC-3 | Renombrar proyecto | `projects.name` + trigger de `updated_at`. OK |
| RF-14-AC-2 | Reintento registra estado y resultado del nuevo intento | `attempt_number` único por proyecto; un intento activo a la vez (C4). OK |
| RF-15-AC-1 | Eliminar proyecto, audio y resultados | `ON DELETE CASCADE` + cola `storage_deletions` para los objetos (C12). Respaldos: ver sección 8 |
| RF-15-AC-2, RNF-05 | Archivar y conservar sin caducidad automática | `archived_at`; no hay TTL ni purga automática en el esquema. OK |
| RF-16 | Indicadores y marca de estimación | `transcription_summaries` + `estimated_fields`; valores nulos permitidos ("cuando estén disponibles"). OK |
| RNF-01 | Medir tiempo desde el inicio efectivo | Faltaba → `processing_started_at` (C11) |
| RNF-02 | Verificar propiedad en toda operación | Toda tabla cuelga de `projects.owner_id`; las FK compuestas impiden cruces entre proyectos (C1). La comprobación en cada petición es de la API |
| RD-06 | MP3/WAV, 100 MB, 15 min | `CHECK` de formato, tamaño y duración (≤ 900 s) |

## 7. Observaciones previas: estado final

| Obs. | Tema | Estado |
|---|---|---|
| O1 | Redundancia resumen/transcripción | Resuelta (C14) |
| O2 | Doble sentido intento ↔ transcripción | Resuelta (C14) |
| O3 | Umbral de baja confianza derivado | Resuelta (C15) |
| O4 | Límite de 100 MB (MB frente a MiB) | Decidida (sección 8) |
| O5 | Formato de `pitch` | Resuelta (C16) |
| O6 | Discrepancias del OpenAPI | Resuelta: nulabilidad, patrón de pitch y parámetros sin uso |
| O7 | Índices de poca utilidad | Resuelta (C17) |

## 8. Decisiones adoptadas (mejores prácticas)

Con JWT confirmado, estos son los criterios que reemplazan los antiguos pendientes. Los parámetros marcados como "ajustable" son valores por defecto razonables, no datos del SRS; el equipo puede cambiarlos sin afectar el esquema.

### 8.1 Autenticación y sesión (JWT)

| Aspecto | Decisión |
|---|---|
| Cierre de sesión | El `jti` del token se inserta en `revoked_tokens` (`expires_at` = `exp` del token). Toda petición protegida rechaza tokens cuyo `jti` esté en la tabla. |
| Duración del token | 60 min (coincide con `expiresIn: 3600` del contrato; ajustable). Sin *refresh token*: el contrato no lo define; al expirar, el usuario inicia sesión de nuevo. |
| Claims y firma | `sub` (id de usuario), `jti`, `iat`, `exp`, `iss`, `aud`. Firma asimétrica (RS256/ES256) o HS256 con secreto de ≥ 256 bits; lista blanca de algoritmos y rechazo de `alg: none`. |
| Purga | Tarea periódica `DELETE FROM revoked_tokens WHERE expires_at < now();` (un token vencido ya no es válido, no necesita seguir en la lista). |
| Contraseñas | Guardar en `password_hash` un hash Argon2id (formato PHC con parámetros y sal incluidos); nunca registrar ni devolver la contraseña. Mínimo 15 caracteres, como define el contrato. |

### 8.2 Eliminación definitiva y respaldos (RF-15, RNF-05)

| Aspecto | Decisión |
|---|---|
| Objetos de almacenamiento | Borrado transaccional encolado (C12); un proceso de limpieza elimina el objeto, reintenta con *backoff* y alerta si `attempts` supera un umbral. Limpieza periódica de filas con `deleted_at` de más de 7 días (ajustable). |
| Respaldos de BD y de objetos | Retención rotativa máxima de **30 días** (ajustable), cifrados en reposo. Un proyecto eliminado desaparece de los respaldos al vencer la retención, es decir, ≤ 30 días. Los respaldos no se restauran de forma selectiva sin reaplicar los borrados posteriores. |
| Comunicación al usuario | Al confirmar la eliminación, informar: "tus datos se eliminan de inmediato de la aplicación y de las copias de respaldo en un máximo de 30 días". El plazo definitivo debe validarse con la infraestructura elegida (SRS 3.4). |
| Archivado | Los proyectos archivados se conservan sin caducidad ni purga automática (RNF-05). |

### 8.3 Cargas de audio

| Aspecto | Decisión |
|---|---|
| Límite de 100 MB | Se fija en **104 857 600 bytes (100 MiB)**, convención de servidores web y proxies (p. ej. `100m`). La misma constante debe usarse en proxy, API y esquema; el límite del proxy puede ser algo mayor para absorber la sobrecarga del *multipart*, validando el tamaño exacto del archivo en la API. |
| Rechazos | Se responde con el error HTTP (413/415/422) y no se almacena el archivo. El registro `rechazado` es opcional y reemplazable (C13). |
| Validación | Verificar el contenido real (cabeceras/decodificación) y no solo la extensión o el `Content-Type`; calcular duración en el servidor. |

### 8.4 Umbral de baja confianza

Vive en la configuración de la aplicación, se aplica **al generar** la versión y se guarda en `transcriptions.low_confidence_threshold` (C15). El valor lo fija el equipo tras la calibración exigida en SRS 3.4; hasta entonces el campo puede quedar nulo.

### 8.5 Sincronización realizada del contrato OpenAPI

Se aplicaron al archivo de equipo las tres alineaciones detectadas: `nullable: true` en `Export.transcriptionId` y `Transcription.audioFileUrl`, patrón de `MusicalNote.pitch` y retiro de los parámetros no referenciados `JobId` y `TranscriptionId`.

### 8.6 Pendientes residuales (no bloquean el esquema)

| # | Pendiente | Detalle |
|---|---|---|
| R1 | Valor del umbral de baja confianza | Depende de la calibración con el motor elegido (SRS 3.4). |
| R2 | Ratificar plazo de respaldos | 30 días es el valor por defecto adoptado; confirmarlo con la infraestructura elegida. |
| R3 | Lease/heartbeat del worker | Las columnas existen; los tiempos y límites de reintento siguen sin fijar en la arquitectura. |

## 9. Diagrama entidad-relación (TIP)

`esquema_er.puml` representa las tablas del script, sus claves y relaciones. La cola `outbox_messages` usa un `aggregate_id` polimórfico y `storage_deletions` guarda claves externas, por lo que no tienen FK a una única entidad de dominio.

## 10. Verificaciones sugeridas para la instancia definitiva

1. Correr `esquema_bd.sql` completo sobre una base vacía PostgreSQL 13+ (todo va dentro de una transacción; si algo falla, no queda nada a medias).
2. Probar: borrar un proyecto con audio, intentos, transcripciones, notas y exportaciones (debe limpiar todo sin error).
3. Probar rechazos esperados: apuntar `current_transcription_id` a una versión de otro proyecto; crear un segundo intento activo; hacer `UPDATE` sobre `musical_notes`; marcar un proyecto `completado` sin transcripción.
4. Probar el flujo del worker: insertar transcripción + actualizar intento a `completado` (con `processing_started_at`) + actualizar proyecto en una misma transacción.
5. Probar cierre de sesión: insertar un `jti` en `revoked_tokens` y comprobar que la API rechaza el token.
6. Probar borrado: eliminar un proyecto con audio y exportaciones listas y comprobar que `storage_deletions` recibe una fila por cada `storage_key`/`download_key`.
7. Probar consistencia: intentar commit con `notes_count` distinto de las notas, con vínculo intento/transcripción en un solo sentido, y un `UPDATE` sobre un audio aceptado (los tres deben fallar).

## 11. Correcciones al código generado

La API de la Parte 2 quedó en `outputs/servicios_crud/` (Node.js + Express 5 + PGlite/PostgreSQL). Durante la revisión del código se aplicaron estas correcciones:

- Se comprobó que estén registradas las **21 combinaciones de ruta y método** del OpenAPI y que el código de éxito configurado en cada ruta exista en la respuesta correspondiente del YAML. El validador normaliza `{projectId}` del contrato y `:projectId` de Express antes de compararlos.
- Se hizo obligatorio `If-Match` al crear una revisión, tal como requiere el parámetro del OpenAPI. Para crear la primera versión se utiliza `If-Match: *`; para revisiones posteriores se usa el ETag `"vN"` de la versión consultada.
- `Transcription.audioFileUrl` ahora apunta a la ruta definida para consultar el audio por su identificador; si el proyecto no tiene audio aceptado, se devuelve `null`.
- Se completaron validaciones de notas requeridas, confianza, UUID, JSON mal formado, tamaño y formato del audio, y se verifica que la duración decodificada no exceda 15 minutos. Los errores se devuelven en el esquema `Error`/`ValidationError`.
- Se respetó el alcance de esta actividad: no se valida JWT ni se aplica autorización por propietario. Las respuestas `401` y `403` del OpenAPI pertenecen a la actividad posterior de seguridad y no se simulan en este servicio.

### Verificación de arranque

El servidor arrancó en `http://localhost:3000` e informó: PostgreSQL conectado, **13 tablas verificadas** y **21 operaciones OpenAPI registradas**. La base de desarrollo es persistente bajo `outputs/servicios_crud/data/audio2score`; el esquema se importa automáticamente si esa base está vacía. No se ejecutó una batería de pruebas de endpoints en este paso; solo se verificó el arranque, la conexión PostgreSQL y el registro de rutas antes de pasar a las pruebas.

La instancia usa PGlite (motor PostgreSQL embebido) porque el servicio Docker de Windows no estaba disponible. El mecanismo de arranque y conexión es distinto a un servidor PostgreSQL dedicado, aunque el mismo `esquema_bd.sql` fue importado y validado por el motor PostgreSQL.
