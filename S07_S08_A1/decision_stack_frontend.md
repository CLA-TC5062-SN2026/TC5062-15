# Decisión del stack de frontend — Audio2Score

**Fecha:** 4 de noviembre de 2026  
**Base de la decisión:** propuestas de Adrian, Daniel, Ivan y Rigo; SRS v7.0; ADR-001; OpenAPI; revisión de seguridad y diagramas de secuencia del equipo.

## Stack elegido

- **Framework / librería de UI:** React.
- **Herramienta de construcción / servidor de desarrollo:** Vite.
- **Enfoque de estilos:** CSS Modules.
- **Manejo de estado:** estado local de React con useState y Context API para compartir el estado de autenticación entre pantallas. No se incorpora por ahora una librería externa de estado.

El estado local atenderá formularios, validaciones, selección de archivos, carga y resultados de cada vista. Context API expondrá solamente los datos compartidos de la sesión, como el usuario y el estado autenticado. Context no es un almacén persistente ni decide dónde guardar el JWT; esa decisión corresponde a la integración con el backend.

Las respuestas de la API se consultarán mediante la capa de servicios prevista para el frontend. Si el polling del procesamiento, el historial y las versiones requieren una caché compartida más elaborada, se reevaluará una herramienta de estado de servidor en la actividad de integración. No se adopta Redux, Zustand o TanStack Query sin comprobar antes esa necesidad.

## Alternativas consideradas y por qué se descartaron

### Framework y herramienta

Las cuatro propuestas eligieron **React** y **Vite**. Daniel, Ivan y Rigo describieron uso previo de React y Vite en la actividad de Jedi; Rigo también indicó que conectó ese frontend con Flask y MySQL. Adrian reportó experiencia del equipo con React y Angular. La coincidencia en React/Vite y la experiencia concreta reportada favorecen esa combinación.

| Opción | Ventajas para Audio2Score | Desventajas para Audio2Score | Decisión |
|---|---|---|---|
| React | Componentes reutilizables para botones, formularios, tarjetas, navegación, estados del proyecto y pantallas de revisión. El equipo ya reporta experiencia con React. | Como librería de UI, el equipo debe definir convenciones para rutas, servicios y estado compartido. | **Elegido por unanimidad.** |
| Angular | Framework integrado con herramientas para rutas, formularios y otras necesidades de aplicaciones. Adrian reporta que el equipo también lo conoce. | Ninguna propuesta lo seleccionó; adoptar ahora Angular supondría cambiar la opción en la que coincidieron los cuatro. Su estructura integrada no es necesaria para justificar esta SPA. | Considerado, pero no elegido frente al consenso y la experiencia reportada con React. |
| Vue 3, Svelte y JavaScript vanilla | Son alternativas válidas para crear interfaces web. | No fueron propuestas por los integrantes; no hay evidencia en las respuestas de una ventaja para este proyecto frente a la experiencia compartida con React. | No fueron finalistas del equipo. |
| Next.js | Amplía React con herramientas de framework y opciones de renderizado del lado del servidor. | El ADR del proyecto define una SPA cliente-servidor y no documenta una necesidad de SSR/SSG. Adoptarlo sumaría capacidades que no requiere la interfaz especificada. | No elegido para esta arquitectura. |

Vite fue la herramienta elegida por los cuatro. La consigna ya contempla una variable de entorno con prefijo Vite, como VITE_API_URL, y el proyecto tiene una API REST separada. Webpack y la CLI del framework aparecieron como ejemplos en la consigna, pero no fueron propuestas competitivas del equipo.

### Enfoque de estilos

Dos integrantes propusieron CSS Modules, uno Tailwind CSS y uno CSS puro.

| Opción | Ventajas para Audio2Score | Desventajas para Audio2Score | Decisión |
|---|---|---|---|
| CSS Modules | Permite escribir CSS convencional con nombres de clase aislados por módulo. Esto ayuda a evitar colisiones al trabajar cuatro personas sobre formularios, navegación, estados de carga y vistas musicales. | El equipo debe acordar cómo organizar estilos globales, variables de diseño y elementos compartidos. | **Elegido por mayoría (2 de 4).** |
| Tailwind CSS | Sus utilidades aceleran estilos responsivos y estados visuales como hover, focus y disabled. | Un componente puede acumular muchas clases en el marcado; se necesitarían convenciones comunes para que cuatro integrantes mantengan esas clases legibles. | No elegido; lo propuso un integrante y CSS Modules obtuvo más apoyo. |
| CSS puro | No añade una biblioteca de estilos y da control directo sobre contraste, foco y diseño responsivo. | Las reglas globales y los nombres compartidos pueden entrar en conflicto entre componentes si no se delimitan. | No elegido; lo propuso un integrante. CSS Modules conserva CSS y reduce el alcance de esos conflictos. |

Bootstrap no fue propuesto por ningún integrante y no se incluyó entre las opciones finalistas.

### Manejo de estado

Las cuatro propuestas incluyeron estado local de React o useState; tres mencionaron también Context API.

| Opción | Ventajas para Audio2Score | Desventajas para Audio2Score | Decisión |
|---|---|---|---|
| Estado local con useState | Adecuado para entradas, validación, carga, errores y estado de una vista. Evita dependencias para componentes y flujos pequeños. | Por sí solo no ofrece una forma cómoda de compartir sesión entre navegación y rutas protegidas. | **Elegido para estado local.** |
| Context API | Permite que navegación y rutas protegidas consulten el mismo estado de autenticación sin pasar props por muchos componentes. | Si se usa para todos los datos del proyecto, procesamiento e historial, puede crecer sin una organización clara. | **Elegida con alcance limitado a autenticación compartida.** |
| Redux / Zustand / Pinia | Ofrecen mecanismos de estado compartido para aplicaciones que realmente necesitan stores más amplios. | Añaden dependencias y conceptos que no son necesarios para la primera entrega; Pinia pertenece al ecosistema Vue. Ninguna fue propuesta por el equipo. | No elegidos en esta etapa. |

## Justificación de la elección

### Características del equipo

React y Vite recibieron apoyo de los cuatro integrantes. Tres reportaron experiencia explícita con React/Vite en la actividad de Jedi y Adrian mencionó la experiencia del equipo con React. Esta base reduce el aprendizaje inicial y permite que el equipo invierta tiempo en los flujos propios de Audio2Score.

CSS Modules fue la preferencia de dos integrantes. Conserva las habilidades de CSS puro mencionadas por Daniel y organiza los estilos de manera aislada para que varias personas puedan trabajar en componentes distintos. En estado, useState aparece en todas las propuestas y Context en tres, por lo que la decisión combina el acuerdo común con el uso compartido que necesita la autenticación.

### Integración con el backend

Audio2Score está definido como una SPA que consume una API REST. El contrato adjunto usa autenticación HTTP Bearer con JWT para operaciones protegidas; la revisión de seguridad describe tokens firmados, expiración explícita y revocación. React puede consumir estos endpoints mediante fetch o Axios y enviar el token en las solicitudes autenticadas. La URL base se configurará desde una variable de entorno como VITE_API_URL.

El aislamiento por propietario es una responsabilidad del backend y se debe reflejar en la interfaz con rutas protegidas, mensajes claros ante respuestas 401/403 y datos limitados al usuario autenticado. Context API compartirá el estado de sesión en la interfaz, pero no sustituye la autorización del servidor ni la decisión de almacenamiento del token.

### Complejidad de la interfaz del proyecto

Audio2Score requiere más que una lista CRUD: el usuario crea proyectos, carga un único archivo MP3 o WAV por proyecto, recibe validaciones de tamaño y duración, observa el procesamiento asíncrono, consulta intentos y fallos, revisa una transcripción y sus indicadores de confianza, guarda correcciones versionadas y exporta MIDI o PDF. El SRS fija límites de 100 MB y 15 minutos; el OpenAPI contempla respuestas asíncronas, errores específicos y conflicto 409 al guardar una versión obsoleta.

React permite dividir estos flujos en componentes y vistas reutilizables. Vite ofrece el scaffolding y el servidor de desarrollo para una SPA. CSS Modules ayuda a mantener separados los estilos de formularios, estados del procesamiento, elementos de revisión y navegación. useState cubre el estado local de cada flujo, mientras Context comparte la autenticación.

El procesamiento en segundo plano implica estados persistentes como pendiente, procesando, completado y fallido. La propuesta no pone esos datos de servidor dentro de un store global por defecto: se consultarán mediante servicios y se mostrarán en las vistas correspondientes. Si la experiencia con polling o caché compartida demuestra que hace falta una herramienta de estado de servidor, se evaluará explícitamente durante la integración.

## Nota para la integración posterior

Los documentos adjuntos muestran dos formas de nombrar las rutas de autenticación: el OpenAPI de S04 usa POST /users, POST /sessions y DELETE /sessions/current, mientras que la revisión de seguridad S05-S06 describe rutas bajo /v1/auth y aliases /api/auth. Antes de implementar la capa de servicios se debe confirmar cuál es el contrato vigente del backend y alinear VITE_API_URL con él. Esta diferencia no cambia la elección de React y Vite.

## Documentos del equipo considerados

- SRS_equipo_corregido_final.md, versión 7.0.
- decision_arquitectonica.md (ADR-001) y decisiones_diseno.md.
- openapi.yaml y revision_rest.md.
- revision_coherencia_secuencias.md y los diagramas de Audio2Score.
- esquema_er.puml y verificacion_esquema_bd.md.
- revision_seguridad.md y documentación de pruebas de autenticación.

## Referencias técnicas

- [React: componentes de UI](https://react.dev/learn/describing-the-ui)
- [React: Context para compartir datos](https://react.dev/learn/passing-data-deeply-with-context)
- [Vite: guía de inicio y servidor de desarrollo](https://vite.dev/guide/)
- [CSS Modules: alcance local de clases](https://github.com/css-modules/css-modules/blob/master/docs/local-scope.md)
- [Tailwind CSS: utilidades de estilo](https://tailwindcss.com/docs/styling-with-utility-classes)
- [Angular: descripción general](https://angular.dev/overview)
- [Next.js: framework de React](https://nextjs.org/docs)

