# S05-S06-A2 — Revisión de seguridad del API

**Alcance:** Parte 1, módulo de autenticación con JWT. Se tomó como entrada el archivo `openapi_equipo.yaml` proporcionado para la actividad y se implementó sobre el backend CRUD existente (Node.js + Express + PostgreSQL/PGlite).

## Punto 1. Implementar módulo de autenticación

El contrato OpenAPI define `/auth/register`, `/auth/login`, `/auth/me` y `/auth/logout`, con servidor local `http://localhost:3000/v1`. El enunciado de esta actividad también menciona `/api/auth/...`. Para evitar que la discrepancia de prefijos impida usar la API, se implementaron las rutas canónicas del contrato bajo `/v1`, se conservaron las rutas raíz existentes y se añadieron aliases `/api/auth/...`.

| Ruta solicitada | Comportamiento implementado | Evidencia |
|---|---|---|
| `POST /api/auth/register` | Responde `201`; valida correo y contraseña; guarda hash bcrypt y devuelve `id`, `email` y `createdAt`, sin contraseña ni hash. | `backend/src/server.js`, líneas 334–352. |
| `POST /api/auth/login` | Compara contraseña con el hash; responde `200` con `accessToken`, `tokenType`, `expiresIn` y datos del usuario; credenciales incorrectas producen `401`. | `backend/src/server.js`, líneas 354–383. |
| `GET /api/auth/me` | Requiere Bearer JWT válido y devuelve el usuario identificado por el claim `sub`. | `backend/src/server.js`, líneas 288–323 y 393. |
| Middleware Bearer | Rechaza encabezado ausente/mal formado, firma o claims inválidos, token vencido y token revocado con `401`. | `backend/src/server.js`, líneas 284–323. |

El módulo también protege `POST /auth/logout` y revoca el `jti` en la tabla `revoked_tokens`; la operación responde `204`.

## Punto 2. Variables de entorno

| Variable | Configuración | Uso |
|---|---|---|
| `JWT_SECRET` | Incluida vacía en `.env.example`; debe configurarse localmente con al menos 32 bytes aleatorios. | Secreto HS256 para firmar y verificar tokens. |
| `JWT_EXPIRATION` | Incluida en `.env.example` como `3600`. | Duración del JWT en segundos; el valor se aplica al claim `exp` y se devuelve como `expiresIn`. |

El backend falla al iniciar si `JWT_SECRET` tiene menos de 32 bytes o si `JWT_EXPIRATION` no es un entero de al menos 60 segundos. La configuración local vive en `.env`, archivo ignorado por Git; no debe incluirse en el repositorio.

**Evidencia:** `backend/src/server.js`, líneas 25–26, 325–332 y 688–695; `.env.example`, líneas 9–10.

## Punto 3. Revisión del código con enfoque en seguridad

| Pregunta de la actividad | Hallazgo y conclusión |
|---|---|
| ¿El JWT tiene expiración explícita? | **Sí.** `jwt.sign` configura `expiresIn: jwtExpirationSeconds`, obtenido de `JWT_EXPIRATION`; el middleware usa `jwt.verify`, que rechaza JWT expirados. Referencias: `server.js`, líneas 369–381 y 288–302. |
| ¿`/register` devuelve la contraseña? | **No.** El `INSERT ... RETURNING` selecciona solo `id`, `email` y `created_at`; la respuesta JSON incluye esos campos y no incluye `password` ni `password_hash`. Referencia: `server.js`, líneas 343–352. |
| ¿El middleware rechaza firma inválida o token expirado? | **Sí, según el código.** `jwt.verify` restringe el algoritmo a HS256 y comprueba firma, `exp`, emisor y audiencia. Cualquier error de verificación produce `401`. También rechaza tokens revocados y usuarios inexistentes. Referencia: `server.js`, líneas 288–323. |
| ¿El secret está hardcodeado? | **No.** Se lee de `process.env.JWT_SECRET`; no hay secreto de respaldo en el código. La validación de configuración impide arrancar con un valor ausente o demasiado corto. Referencias: `server.js`, líneas 25–26 y 325–332. |

### Correcciones aplicadas

1. Se sustituyó el token aleatorio opaco que devolvía el login por un JWT real firmado con HS256, con `sub`, `jti`, emisor, audiencia y expiración.
2. Se sustituyó el hash scrypt del registro por bcrypt con costo 12. Las cuentas creadas con scrypt por la versión CRUD se migran a bcrypt al autenticarse correctamente.
3. Se reemplazó `/auth/me`, que antes devolvía un usuario de demostración sin autenticación, por una ruta que exige el middleware JWT y consulta el perfil usando el `sub` validado.
4. Se reemplazó el logout sin efecto por revocación del token mediante `revoked_tokens`.
5. Se añadieron `JWT_SECRET` y `JWT_EXPIRATION` a `.env.example`, junto con validación estricta de configuración al iniciar.
6. Se impuso un límite de 72 bytes UTF-8 a las contraseñas para que bcrypt no ignore silenciosamente los bytes excedentes; se mantienen los límites de 15–128 caracteres del contrato.
7. Se verificó que el `openapi_equipo.yaml` usado para esta Parte 2 se parsea correctamente y declara BearerAuth en las operaciones protegidas; no fue necesario modificar el archivo fuente adjunto.

## Punto 4. Documentación de hallazgos y correcciones

Este archivo documenta los hallazgos, evidencia de código y correcciones anteriores para entregar como `S05_S06_A2/revision_seguridad.md`.

## Protección de rutas

Se identificaron las reglas efectivas del OpenAPI: `POST /auth/register` y `POST /auth/login` tienen `security: []`; las otras 19 operaciones heredan el esquema global `bearerAuth`. El backend aplica el middleware a todas las operaciones excepto esas dos rutas públicas.

| Rutas protegidas por BearerAuth | Nivel de acceso aplicado |
|---|---|
| `POST /auth/logout`, `GET /auth/me` | Usuario autenticado; logout invalida su token. |
| `GET /projects`, `POST /projects`, `GET /projects/{projectId}`, `PATCH /projects/{projectId}`, `DELETE /projects/{projectId}` | Usuario autenticado; cada proyecto se limita a su propietario. |
| `POST /projects/{projectId}/audio-files`, `GET /projects/{projectId}/audio-files/{audioFileId}` | Usuario autenticado y propietario del proyecto. |
| `PUT /projects/{projectId}/processing-configurations/current`, `GET /projects/{projectId}/processing-attempts`, `GET /projects/{projectId}/processing-attempts/{attemptId}`, `POST /projects/{projectId}/processing-attempts/{attemptId}/retry` | Usuario autenticado y propietario del proyecto. |
| `GET /projects/{projectId}/transcriptions/current`, `POST /projects/{projectId}/transcriptions/current/revisions`, `GET /projects/{projectId}/transcriptions/versions` | Usuario autenticado y propietario del proyecto. |
| `POST /projects/{projectId}/exports`, `GET /projects/{projectId}/exports`, `GET /projects/{projectId}/exports/{exportId}/file` | Usuario autenticado y propietario del proyecto. |

El esquema y el OpenAPI no definen roles ni permisos por rol. Por ello, no existe un caso de token con rol incorrecto que deba producir `403`; todos los usuarios autenticados tienen el mismo nivel de acceso funcional, limitado a sus propios proyectos.

### Pruebas manuales desde terminal

Se inició el servidor en el puerto temporal `3107` con una base PGlite temporal `data/security-validation-20261025`; no se usó la base local habitual. Se registró un usuario de prueba y se completó login para obtener el JWT. Resultados observados:

| Caso | Solicitud | Resultado real |
|---|---|---|
| Sin token | `GET /v1/projects` sin `Authorization` | `401 UNAUTHORIZED`. |
| Token inválido | `GET /v1/projects` con un carácter de la firma alterado | `401 UNAUTHORIZED`. |
| Token vencido | `GET /v1/projects` con JWT firmado cuya expiración ya pasó | `401 UNAUTHORIZED`. |
| Token válido en `/me` | `GET /api/auth/me` con `Bearer <token>` | `200`; devolvió el perfil del usuario autenticado. |
| Token válido en CRUD | `POST /v1/projects` con `Bearer <token>` | `201`; creó el proyecto a nombre del usuario autenticado. |
| Persistencia y acceso autenticado | `GET /v1/projects` después del POST, con el mismo token | `200`; el proyecto creado apareció en `items`. |
| Rol incorrecto | No aplica | No hay roles definidos en el OpenAPI ni en el modelo de usuario; por tanto, no corresponde una prueba `403` por rol. |

La validación de sintaxis de `server.js` y el parseo del OpenAPI también finalizaron correctamente. El usuario temporal y los datos se guardaron en el directorio de verificación aislado, no en la base local habitual.
