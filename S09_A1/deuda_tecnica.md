# Reflexión sobre deuda técnica

## 1. Deuda técnica actual y forma de medirla

La auditoría registró dos hallazgos de ESLint y cinco hallazgos de code review. Los dos avisos del linter quedaron resueltos. Las tres refactorizaciones atendieron cuatro hallazgos del review: los hallazgos 1 y 2 mediante el aislamiento por propietario, el 3 mediante la lectura explícita del contrato y el 5 mediante el cierre del descriptor. El hallazgo 4, sobre derivación síncrona de contraseñas, permanece pendiente.

Este conteo mide el avance dentro del alcance revisado. Para estimar la deuda total también se requiere valorar el esfuerzo de corrección y el impacto de los pendientes. Aún no contamos con esas estimaciones. La regresión del middleware detectada durante la revisión fue corregida y se verificó con una petición HTTP de JSON inválido.

Aun así, permanece deuda técnica relevante. El archivo `backend/src/server.js` concentra responsabilidades de configuración, autenticación, persistencia, validación, rutas HTTP, manejo de archivos y manejo de errores. Esta concentración incrementa el costo de modificar o probar una funcionalidad de manera aislada. También queda pendiente modularizar el backend y sustituir la derivación síncrona de contraseñas por una alternativa asíncrona.

La deuda técnica se mediría con los siguientes indicadores:

- Número de errores y advertencias del análisis estático. El objetivo es mantener ESLint sin hallazgos.
- Número de hallazgos abiertos del code review y prioridad asignada a cada uno.
- Tamaño y responsabilidades por módulo, evitando que un solo archivo concentre capas de infraestructura, dominio y transporte HTTP.
- Cobertura y resultados de pruebas automatizadas cuando se incorpore un script de pruebas.
- Tiempo requerido para modificar, probar o corregir una ruta existente.
- Número de tareas de deuda técnica pendientes en el backlog del proyecto.

## 2. Deuda técnica intencional e involuntaria

La concentración del backend en un archivo y la configuración de una cuenta de demostración son decisiones observables en el código. Pueden haber reducido el trabajo inicial, pero el código por sí solo no demuestra que el equipo aceptara conscientemente sus costos futuros. Su clasificación como deuda intencional requiere confirmar la decisión con los integrantes o con registros del proyecto.

La falta de aislamiento por propietario y el cierre incompleto del descriptor se identificaron como defectos durante la auditoría. La dependencia del estado global y el uso de derivación síncrona de contraseñas son decisiones técnicas cuyo motivo original también requiere confirmación.

Para distinguir deuda intencional e involuntaria, registraríamos para cada caso la decisión original, su motivo, el costo aceptado, el responsable y la condición para corregirlo. Un defecto descubierto sin una decisión previa documentada se registraría como deuda detectada, con su origen pendiente de confirmar.

## 3. Integración de calidad de código y SOLID en SCRUM

El análisis de calidad y la evaluación SOLID se integrarían en SCRUM mediante los siguientes acuerdos de trabajo:

1. Definir una condición de terminado para cada historia de usuario. Esta condición debe exigir ejecución satisfactoria de ESLint, revisión de código y actualización de pruebas cuando existan.
2. Revisar las solicitudes de cambio antes de fusionarlas. La revisión debe verificar responsabilidades únicas, dependencias explícitas, manejo de errores y validación de autorización.
3. Registrar la deuda técnica como elementos visibles del Product Backlog, con prioridad, impacto y criterio de aceptación.
4. Reservar capacidad de cada sprint para refactorización y corrección de hallazgos importantes, no solo para nuevas funcionalidades.
5. Incorporar en integración continua los comandos `pnpm exec eslint src` y `node --check src/server.js`; cuando se agreguen pruebas automatizadas, también deberá ejecutarse el comando de pruebas.
6. Revisar en la retrospectiva los hallazgos repetidos para convertirlos en reglas del equipo, plantillas de revisión o tareas de mejora del diseño.

Con este flujo, la calidad de código deja de ser una revisión final y se convierte en una actividad continua del desarrollo iterativo.