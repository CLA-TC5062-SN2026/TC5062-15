# Diferencias de diseño del equipo — Audio2Score

## Alcance y fuentes revisadas

Se compararon los tres artefactos de diseño disponibles para cada integrante: especificación OpenAPI, diagrama de clases y decisión/diagrama de arquitectura. Para arquitectura solo se recibió el documento de Adrián y el de Iván; no se recibió un artefacto arquitectónico de Daniel, por lo que no se le atribuyen decisiones de arquitectura.

Fuentes individuales:

- Adrián: `openapi_ADRIAN.yaml`, `diagrama_clases_ADRIAN.puml`, `decision_arquitectonica_ADRIAN.md`.
- Daniel: `openapi_DANIEL.yaml`, `diagrama_clases_DANIEL.puml`. No hay decisión arquitectónica individual de Daniel entre los archivos compartidos.
- Iván: `openapi_IVAN.yaml`, `diagrama_clases_dominio_IVAN.mmd`, `decision_arquitectonica_IVAN.md`.

Artefactos del equipo usados para verificar los acuerdos:

- `openapi_equipo.yaml`.
- `diagrama_clases_equipo.puml`.
- `arquitectura_equipo.md`.
- `SRS_equipo_corregido_final.md`, como fuente de requisitos y criterios de aceptación.

## Aportes por integrante y artefacto

| Integrante | OpenAPI | Diagrama de clases | Arquitectura |
|---|---|---|---|
| **Adrián** | Propuso una API amplia para registro/sesión, gestión y archivo de proyectos, carga de audio, procesamiento y reintentos, transcripciones, comparación/resumen y exportación MIDI/PDF. Usa rutas como `/auth/...`, `/projects/{projectId}/processing-jobs` y `/transcriptions/{transcriptionId}/revisions`. | Modeló `User`, `Project`, `AudioFile`, `ProcessingJob`, `Transcription`, `MusicalNote` y exportaciones MIDI/PDF. Aporta una estructura directa y compacta del flujo audio-proceso-transcripción-exportación. | Propuso monolito modular en capas con cola y worker asíncrono. Destacó los estados explícitos, reintentos, control de acceso por propietario y la conveniencia de evitar microservicios para el prototipo. |
| **Daniel** | Propuso registro y sesiones JWT, proyectos, carga de audio, intentos de procesamiento, transcripción y resultados MIDI/PDF. Aportó el endpoint de verificaciones y modelos de evaluación/corrección (`MusicalEvaluation`, `CorrectionRecord`, `VerificationReport`), que amplían la evaluación musical. | Modeló `Usuario`, `Proyecto`, `ArchivoAudio`, `IntentoProcesamiento`, `VersionTranscripcion`, `NotaMusical`, `EvaluacionMusical`, `RegistroCorreccion` y `ArchivoResultado`. Su aporte más distintivo es representar evaluación y correcciones como conceptos explícitos. | No se proporcionó un documento individual de arquitectura de Daniel en los archivos revisados. |
| **Iván** | Propuso sesiones, configuración de procesamiento, historial de intentos, transcripciones/versiones y recursos de exportación por proyecto. Usa nombres de rutas y propiedades consistentes en camelCase y modela explícitamente resultados de carga, configuración pendiente y exportaciones. | Modeló usuario, proyecto, audio original, intentos, versiones/transcripción, resumen, notas transcritas y archivo exportado. Enfatiza historial/versionado y el resumen de resultados. | Propuso cliente-servidor con SPA y API REST, monolito modular por capas, cola durable, outbox transaccional, worker por pull, idempotencia, leases/heartbeat, motor local detrás de `MotorTranscripcion`, autorización por propietario y pendientes de respaldo/borrado. |

## Diferencias encontradas y resolución

### 1. OpenAPI

**Rutas y nombres.** Los tres diseños describían el mismo dominio con contratos distintos: Adrián usaba rutas centradas en `/auth`, `/processing-jobs` y `/transcriptions`; Daniel usaba `/api/users`, `/sessions` y `/processing-attempts`; Iván usaba `/users`, `/sessions` y `/processing-attempts`. También variaban los nombres de parámetros (`projectId` frente a `project_id`) y el método para cargar audio (POST/PUT).

**Alcance funcional.** Adrián incluía comparación, resumen, revisiones y archivo de proyectos; Daniel destacaba verificaciones/evaluaciones/correcciones; Iván explicitaba configuración previa, versiones de transcripción e historial de intentos. No era correcto elegir una especificación completa sin revisar cobertura frente al SRS.

**Resolución.** Se consolidó un contrato REST uniforme con nombres consistentes, recursos de proyectos/audio, intentos, transcripciones/versiones e importación/exportación. Se preservaron las operaciones requeridas por el SRS y sus extensiones `x-acceptance-criteria`; se descartaron o ajustaron rutas redundantes y modelos no respaldados por los requisitos. El contrato compartido distingue la carga de audio de la configuración/reintento y representa inicio automático solo cuando no falta configuración requerida.

### 2. Diagrama de clases

**Nombres y granularidad.** Había equivalencias con nombres diferentes: `User`/`Usuario`, `Project`/`Proyecto`, `AudioFile`/`ArchivoAudio`/`AudioOriginal`, `ProcessingJob`/`IntentoProcesamiento`, y `Transcription`/`VersionTranscripcion`. También variaba si exportaciones, evaluaciones, correcciones y resúmenes eran clases explícitas.

**Relaciones/versionado.** Los diseños diferían en cómo asociar los intentos con sus transcripciones y en cómo preservar versiones y resultados previos. Daniel explicitaba evaluación y correcciones; Adrián separaba los formatos MIDI/PDF como tipos; Iván hacía explícito el historial/versionado.

**Resolución.** Se adoptó nomenclatura uniforme en inglés alineada con los schemas del OpenAPI de equipo. El modelo unifica `ProcessingAttempt`, `Transcription`, `MusicalNote`, `TranscriptionSummary` y `Export`; un proyecto conserva intentos e historial de transcripciones, y apunta a una transcripción vigente. Las clases expuestas corresponden a schemas request/response; `passwordHash` se documenta como dato interno y no como campo de respuesta. Se ajustó el contrato para que `Project.description` y `Transcription.processingAttemptId` fueran coherentes con el modelo, y se retiraron schemas sin uso del contrato.

### 3. Arquitectura

**Coincidencias.** Adrián e Iván coincidieron en monolito modular por capas, procesamiento asíncrono con cola y worker, control de acceso por propietario y evitar microservicios para el alcance y plazo del prototipo.

**Diferencias.** Adrián dejó la cola y el worker en un nivel general y planteó alternativas tecnológicas. Iván especificó SPA/API REST, cola durable, outbox, consumo por pull, idempotencia, recuperación de trabajos, motor local y política de borrado/respaldos. Los contextos de ambos documentos asumen un desarrollador; ese supuesto no se usa como descripción del equipo actual.

**Resolución.** `arquitectura_equipo.md` conserva el estilo común y adopta el detalle de flujo de Iván: SPA, API REST modular, outbox, cola durable y worker asíncrono con motor local. No fija proveedor ni tecnología que el equipo no haya decidido. Se dejan como pendientes explícitos el mecanismo de credenciales, tecnologías de infraestructura, límites de reintento/lease y política de respaldos y purga. No hay decisión de Daniel que resolver en esta categoría porque su archivo no fue proporcionado.

## Acuerdos finales

1. El OpenAPI consolidado es el contrato de interfaz; sus rutas, métodos, schemas y códigos deben mantenerse como referencia para la implementación.
2. El diagrama de clases consolidado representa entidades, relaciones y DTO acordados, y se verifica contra los schemas del contrato.
3. La arquitectura compartida es cliente-servidor con SPA y API REST en un monolito modular por capas, cola durable y worker asíncrono con procesamiento local.
4. El SRS corregido es la fuente de verdad para el alcance. Las propuestas individuales aportan alternativas; no agregan por sí solas requisitos al producto.
5. Los puntos de infraestructura y seguridad aún no definidos permanecen identificados como decisiones pendientes, en vez de asumir valores o proveedores.

## Trazabilidad de los archivos de equipo

- OpenAPI: `outputs/openapi_equipo.yaml`.
- Clases: `outputs/diagrama_clases_equipo.puml`.
- Arquitectura: `outputs/arquitectura_equipo.md`.
