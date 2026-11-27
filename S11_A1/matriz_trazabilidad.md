# Matriz de trazabilidad — Audio2Score

**Fecha:** 26 de noviembre de 2026  
**Fuentes locales:** `S03_A1/SRS_equipo_corregido_final.md` (RF-01 a RF-16), `S03_A1/backlog_completo_corregido_final.md` (Historias 1 a 12), `S05_S06_A1/openapi_equipo.yaml`, implementación bajo `backend/` y `frontend/`.

## Criterios de lectura

- **Completo:** la funcionalidad principal está implementada y hay evidencia de integración o recorrido manual documentada.
- **Parcial:** hay implementación, pero falta verificar uno o más criterios de aceptación, o existe una limitación funcional relevante.
- **No implementado:** no se encontró una implementación utilizable.
- Los identificadores `H1`–`H12` corresponden a las historias numeradas del backlog, no a IDs `HU`.
- El repositorio no contiene una suite automatizada de `backend/tests/`. Por ello, las evidencias indicadas como manuales no se presentan como pruebas automatizadas.

## Requisitos funcionales

| Requisito SRS | Historia(s) del backlog | Implementación y endpoints relacionados | Estado | Evidencia y brecha pendiente |
|---|---|---|---|---|
| **RF-01 Registro e inicio de sesión** | H1, H2 | `frontend/src/pages/RegisterPage.jsx`, `LoginPage.jsx`, `frontend/src/context/AuthContext.jsx`; `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`. | Completo | El flujo autenticado se documentó en `S10_A1/cierre_funcional.md` y existe el video de autenticación en `S07_S08_A2/flujo_auth.mp4`. La sesión se restaura y se limpia al cerrar o recibir 401. |
| **RF-02 Creación y gestión de proyectos** | H4, H5 | `ProjectsPage.jsx`, `ProjectForm.jsx`, `ProjectDetailPage.jsx`; `GET/POST /projects`, `GET/PATCH/DELETE /projects/{projectId}`. | Completo | Listado, creación, consulta, renombrado y eliminación están conectados al API. Las pantallas de proyectos y detalle se capturaron en `capturas/proyectos.png` y `capturas/detalle_proyecto.png`. |
| **RF-03 Carga de archivos de audio** | H5 | `ProjectDetailPage.jsx`, `audioFilesService.js`; `POST /projects/{projectId}/audio-files`, `GET /projects/{projectId}/audio-files/{audioFileId}`, `GET /projects/{projectId}/audio-files/{audioFileId}/file`. | Parcial | Hay carga MP3/WAV, asociación al proyecto y lectura/reproducción del archivo protegido. El cierre S10 documenta carga E2E. Falta recorrer en la interfaz un archivo corrupto o ilegible y guardar esa evidencia. |
| **RF-04 Validación de archivo antes del procesamiento** | H6 | Validaciones en `ProjectDetailPage.jsx` y backend en `backend/src/server.js`; la carga se realiza con `POST /projects/{projectId}/audio-files`. | Parcial | Se aplican los límites configurados de 100 MiB y 15 minutos y se rechaza una extensión no admitida (415, evidencia en S10). Falta comprobar visualmente y registrar los casos de tamaño y duración excedidos y sus mensajes al usuario. |
| **RF-05 Inicio automático del procesamiento** | H7 | `ProjectDetailPage.jsx`; `POST /projects/{projectId}/audio-files`, `PUT /projects/{projectId}/processing-configurations/current`; worker local en `backend/src/server.js` y `backend/src/basic_pitch_transcribe.py`. | Completo para el motor actual | La carga validada se procesa de forma asíncrona con Basic Pitch y el caso E2E terminó en transcripción. Basic Pitch no necesita parámetros obligatorios adicionales en este prototipo; el flujo de configuración condicional queda disponible en API. |
| **RF-06 Estado del procesamiento** | H8, H9 | `ProjectDetailPage.jsx`; `GET /projects/{projectId}`, `GET /projects/{projectId}/processing-attempts`, `GET /projects/{projectId}/processing-attempts/{attemptId}`. | Completo | La vista consulta y presenta los estados del proyecto y de los intentos; procesamiento completado y transcripción disponible se verificaron en los recorridos registrados en `S10_A1/cierre_funcional.md`. |
| **RF-07 Generación de transcripción inicial** | H9, H11 | Worker de audio; `GET /projects/{projectId}/transcriptions/current`; pantalla `TranscriptionPage.jsx`. | Parcial | Se generan notas con altura y tiempos/duración. La amplitud de Basic Pitch se usa como indicador estimado, no como confianza calibrada contra anotaciones musicales humanas; por eso la clasificación de notas de baja confianza sigue siendo provisional. |
| **RF-08 Visualización de la partitura** | H10 | `TranscriptionPage.jsx` (vista SVG de pentagrama); `GET /projects/{projectId}/transcriptions/current`. | Parcial | Se muestra pentagrama y notas detectadas, etiquetado como borrador. La notación es una representación esquemática y no una partitura con grabado musical profesional. Evidencia visual: `capturas/transcripcion.png`. |
| **RF-09 Revisión y corrección de la transcripción** | H10 | `TranscriptionPage.jsx`, `transcriptionsService.js`; `POST /projects/{projectId}/transcriptions/current/revisions`, `GET /projects/{projectId}/transcriptions/versions`. | Completo | S10 documenta el guardado de una corrección como versión 2, conservación del historial y rechazo de `If-Match` obsoleto (412). |
| **RF-10 Comparación entre audio y transcripción y baja confianza** | H10, H11 | `TranscriptionPage.jsx`, `audioFilesService.js`; `GET` de transcripción vigente y `GET` del archivo de audio. | Parcial | La vista ofrece carga/reproducción del audio, marcas de confianza en color y etiqueta “Requiere revisión”. El indicador depende de amplitud y del umbral provisional `0.5`; falta calibrarlo con anotaciones humanas representativas. |
| **RF-11 Descarga en MIDI** | H12 | `exportsService.js`, `TranscriptionPage.jsx`; `POST /projects/{projectId}/exports`, `GET /projects/{projectId}/exports`, `GET /projects/{projectId}/exports/{exportId}/file`. | Completo | El cierre S10 reporta exportación E2E y verificación de firma MIDI `MThd`. |
| **RF-12 Descarga en PDF** | H12 | `exportsService.js`, `TranscriptionPage.jsx`; los mismos endpoints de exportación que RF-11 con formato PDF. | Parcial | S10 documenta PDF descargable con nombre/fecha, pentagrama y aviso de borrador. El contenido musical es esquemático; falta revisión de legibilidad y calidad por el equipo en la presentación final. |
| **RF-13 Consulta del historial y detalle del proyecto** | H4, H8 | `ProjectsPage.jsx`, `ProjectDetailPage.jsx`, `TranscriptionPage.jsx`; `GET /projects`, `GET /projects/{projectId}`, endpoints de intentos y versiones. | Completo | Listado y detalle consumen datos persistidos; intentos y versiones se consultan desde las vistas correspondientes. Las capturas de proyectos y detalle sirven como evidencia de interfaz integrada. |
| **RF-14 Reintento de procesamiento y manejo de fallos** | H7, H8 | `ProjectDetailPage.jsx`, `processingService.js`; `POST /projects/{projectId}/processing-attempts/{attemptId}/retry` y endpoints GET de intentos. | Parcial | El código permite reintentar un intento fallido y mostrar el estado/motivo disponible. No se documentó en S10 una prueba E2E que provoque un fallo real y luego confirme un reintento exitoso; debe verificarse antes de afirmar el criterio completo. |
| **RF-15 Eliminación y archivado de proyectos** | H4 | `ProjectsPage.jsx`, `projectsService.js`; `PATCH /projects/{projectId}` para archivar/restaurar y `DELETE /projects/{projectId}` para eliminar. | Completo | La lista implementa archivar, restaurar y eliminar con confirmación; la eliminación de datos y archivos relacionados se incluye en la verificación manual previa de la integración. |
| **RF-16 Resumen de la transcripción** | H10 | `TranscriptionPage.jsx`; `GET /projects/{projectId}/transcriptions/current`. | Parcial | Se muestra el conteo de notas y las estimaciones que entrega el motor. Tempo, tonalidad y cobertura no se inventan cuando Basic Pitch no los proporciona; falta confirmar con el equipo qué campos deben declararse explícitamente como no disponibles en la demo. |

## Evidencias generales revisadas

1. `S10_A1/cierre_funcional.md`: registra build de Vite, lint/sintaxis del backend, respuestas 401/415/412, audio, historial y exportación PDF, además de los límites de la medición de confianza.
2. `S07_S08_A2/flujo_auth.mp4` y `S07_S08_A2/flujo_e2e.mp4`: evidencias de las actividades anteriores de autenticación y funcionalidad integrada.
3. `S11_A1/capturas/`: capturas locales de login, lista de proyectos, detalle y transcripción con los tres proyectos de demostración.
4. `S09_A1/output_linter.txt` y `S09_A1/code_review.md`: artefactos de la actividad de calidad. No sustituyen una suite de pruebas automatizadas.

## Requisitos no funcionales relacionados

El backlog relaciona RNF-02/RNF-05 con H3 y H4 (aislamiento por propietario y autorización), RNF-04 con H8 (progreso/estado), y RNF-06 con H6 (validación y comunicación clara). La validación manual documentada comprobó JWT válido/inválido y rechazo de solicitudes protegidas sin token; queda pendiente una prueba visual completa de responsive y de todos los mensajes de error.

## Pendientes prioritarios para cerrar la matriz

1. Recorrer desde el navegador los errores de audio ilegible, tamaño/duración excedidos y reintento tras fallo, y conservar la evidencia.
2. Revisar con músicos la partitura/PDF y acordar cómo presentar las métricas que el motor no estima.
3. Calibrar el umbral de baja confianza con una muestra anotada; hasta entonces, presentarlo como indicador experimental.
4. Ejecutar el checklist manual de la demo en la computadora que se usará para exponer. No hay evidencia de pruebas automatizadas backend bajo `backend/tests/`.
