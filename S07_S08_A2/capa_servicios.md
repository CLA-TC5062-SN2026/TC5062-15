# Capa de servicios de API

## Contrato y configuración

La capa sigue `openapi_equipo.yaml` de S05-S06, cuyo servidor local es `http://localhost:3000/v1`. En desarrollo, Vite expone el prefijo `/v1` y lo redirige a ese servidor mediante un proxy, evitando CORS en el navegador. `VITE_API_URL` se lee desde `import.meta.env.VITE_API_URL`; `.env.example` usa `/v1` y el cliente emplea ese mismo prefijo como fallback. En producción se debe configurar la URL pública del API antes de compilar.

El contrato de S04 adjunto en `openapi.yaml` usa rutas antiguas (`/users`, `/sessions` y `/audio-files/current`). La especificación consolidada del equipo y la revisión de seguridad S05-S06 definen las rutas actuales (`/auth/*` y `/audio-files`), que son las que implementan estos servicios.

## Cliente HTTP y autenticación

Se usa `fetch`, disponible en el navegador y suficiente para la SPA React + Vite. `apiClient.js` funciona como interceptor común: antes de cada petición protegida toma el JWT del almacén de sesión y añade `Authorization: Bearer <token>`. Las solicitudes de registro e inicio de sesión son públicas. También centraliza `Accept`, la serialización JSON, la carga multipart sin fijar manualmente su `Content-Type`, las respuestas `204` y las descargas binarias.

El JWT se guarda únicamente en memoria en `tokenStore.js`. `authService.login` lo coloca ahí; `authService.logout` lo elimina incluso si falla la petición de revocación, y cualquier respuesta `401` también lo limpia. No se usa `localStorage` ni `sessionStorage`: el token se pierde al recargar o cerrar la pestaña y el usuario debe iniciar sesión otra vez. El contrato actual requiere un Bearer JWT y no define autenticación mediante cookie `HttpOnly`; si el backend incorpora una sesión con cookie `HttpOnly; Secure; SameSite`, se debe reevaluar el mecanismo.

La memoria reduce la exposición de una credencial persistente, pero no protege el token frente a JavaScript malicioso mientras la aplicación está abierta. Se requiere mantener la prevención de XSS y usar HTTPS en entornos desplegados. OWASP recomienda no guardar credenciales de sesión en Web Storage y favorece cookies `HttpOnly` o un patrón BFF cuando la arquitectura lo permite: [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Manejo centralizado de errores

`apiClient.js` convierte fallos de red, cancelaciones y respuestas HTTP de error en `ApiError`. Incluye estado HTTP, código, `requestId` y detalles de validación cuando el servidor los proporciona. Asigna mensajes en español para errores de conectividad y estados comunes como `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422`, `429` y `5xx`. La interfaz puede mostrar `error.message` o usar `getApiErrorMessage(error)`; los componentes no necesitan interpretar `fetch` ni traducir estados HTTP.

## Módulos por recurso

| Módulo | Operaciones encapsuladas |
| --- | --- |
| `authService.js` | Registro, login, logout y perfil actual (`/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`). |
| `projectsService.js` | Listar, crear, consultar, actualizar y eliminar proyectos. |
| `audioFilesService.js` | Cargar audio `multipart/form-data` y consultar sus metadatos. |
| `processingService.js` | Completar configuración, consultar intentos y reintentar un intento fallido. |
| `transcriptionsService.js` | Consultar transcripción vigente, guardar revisión con `If-Match` y consultar versiones. |
| `exportsService.js` | Crear/listar exportaciones y descargar MIDI/PDF como `Blob`. |

Los módulos reflejan las rutas y métodos de `openapi_equipo.yaml`. Los recursos protegidos usan automáticamente el JWT. Las funciones de mutación que aceptan `idempotencyKey` añaden `Idempotency-Key`; la revisión exige `If-Match`.
