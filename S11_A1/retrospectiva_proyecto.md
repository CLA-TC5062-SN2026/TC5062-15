# Retrospectiva del proyecto Audio2Score

**Fecha de cierre:** 26 de noviembre de 2026  
**Base de la reflexión:** SRS v7, backlog consolidado, revisión de calidad S09-A1, cierre funcional S10-A1 y estado del repositorio local `TC5062-15`.

## 1. ¿Qué salió bien?

- El equipo consolidó el alcance en un SRS de 16 requisitos funcionales y 12 historias, y mantiene un contrato OpenAPI común para frontend y backend.
- Se integraron autenticación JWT, rutas protegidas y propiedad de los proyectos. La sesión inválida o expirada se limpia desde la capa común del frontend.
- El flujo principal ya atraviesa carga, cola local, Basic Pitch, persistencia de transcripción, revisión/versionado y exportación. El cierre S10 registra E2E con audio real y una revisión guardada como versión 2.
- Para preparar la demo se dejaron tres proyectos procesados con audios locales: “Himno a la alegría” (291 notas), “Mary Had a Little Lamb” (60) y “Piano emocional” (113). Las capturas de S11 muestran datos servidos por el backend local.
- La revisión de código y deuda de S09 ayudó a hacer visibles problemas de mantenibilidad y a conservar un registro técnico de las refactorizaciones.

## 2. ¿Qué fue difícil y qué aprendimos?

- Las actividades se desarrollaron en carpetas/versiones separadas y el contrato OpenAPI tuvo copias distintas. Antes de modificar código, se tuvo que confirmar cuál copia local era la fuente válida. Para el cierre se integró el código de referencia en `TC5062-15` y se copió el backlog consolidado a `S03_A1/`.
- La integración depende de detalles de entorno: PowerShell usa sintaxis distinta para variables respecto a Bash, el `.env` debe apuntar a las rutas correctas y el motor requiere Python 3.8 y dependencias de audio. La guía raíz ahora documenta el arranque reproducible y la persistencia local.
- Las salidas del agente requieren revisión humana. Se encontraron instrucciones de terminal incompatibles con PowerShell y documentos previos que no reflejaban el worker ya implementado; la evidencia y el código local se contrastaron antes de corregirlos.
- “Confianza” no equivale a precisión musical. Basic Pitch proporciona amplitud de eventos, que puede funcionar como señal visual inicial pero no como probabilidad calibrada. El umbral 0.5 permanece provisional.
- La representación SVG y el PDF permiten revisar notas y duraciones, pero no reemplazan un sistema de grabado musical. El equipo debe describir esta limitación en la exposición.

## 3. ¿Qué debemos mejorar en el siguiente ciclo?

| Acción | Responsable sugerido | Resultado verificable |
|---|---|---|
| Asignar una persona responsable por cada flujo del SRS y conservar una evidencia de aceptación por criterio. | Equipo | Matriz actualizada y evidencia enlazada por RF. |
| Mantener una única carpeta/repo como fuente y revisar el diff antes de combinar cambios. | Equipo | Sin copias ambiguas de OpenAPI, SRS ni frontend/backend. |
| Agregar pruebas automatizadas para autenticación, autorización por propietario, validación de audio, revisión `If-Match` y exportaciones. | Equipo de desarrollo | Suite ejecutable en CI con resultados reproducibles. |
| Registrar versiones y prerequisitos del entorno de audio junto con instrucciones de arranque probadas en otra máquina. | Responsable de backend | Instalación y procesamiento reproducibles desde una base local limpia. |
| Evaluar el indicador de confianza contra transcripciones anotadas por personas y ajustar el umbral con esa muestra. | Equipo de dominio | Métrica y umbral documentados, o indicador renombrado como heurístico. |
| Revisar con usuarios la legibilidad de la notación y del PDF antes de presentarlos como resultado musical. | Equipo de producto | Lista de cambios de UX/partitura priorizada. |

## 4. ¿La solución sigue alineada con el problema?

Sí, en el alcance del prototipo. Audio2Score busca ayudar a músicos, estudiantes, compositores y docentes a obtener un borrador de melodía desde un archivo MP3/WAV, revisar las notas y descargar resultados. La demo recorre ese ciclo usando datos reales locales y deja claro que el usuario conserva la decisión musical final.

La alineación todavía es parcial en dos aspectos: la partitura y el PDF son esquemáticos, y el indicador de baja confianza aún no se ha calibrado con anotaciones humanas. No se debe presentar la salida como transcripción musical definitiva. La app tampoco tiene una URL de producción para esta versión.

## 5. ¿Qué mostrar primero en la demo?

1. El problema que resuelve Audio2Score y el límite de “borrador sujeto a revisión”.
2. Iniciar sesión y mostrar que el usuario accede a sus proyectos.
3. Abrir un proyecto procesado con audio real; señalar estado, archivo y transcripción.
4. Reproducir el audio junto a la partitura/tabla, mostrar una nota marcada “Requiere revisión” y corregir una nota.
5. Guardar la revisión y mostrar el cambio de versión; finalmente, solicitar una exportación disponible.
6. Cerrar con una limitación honesta: notación esquemática y confianza heurística aún no calibrada.

La secuencia exacta, con tiempos y roles, está en `guion_demo.md`. La grabación continua del equipo de máximo cinco minutos sigue siendo una acción humana pendiente; las capturas de pantalla no sustituyen ese video.
