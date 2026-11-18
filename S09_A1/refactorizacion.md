# Refactorización guiada

## Alcance y verificación

Se implementaron tres refactorizaciones seleccionadas a partir del code review. Al finalizar se ejecutaron las siguientes verificaciones:

```bash
pnpm exec eslint src
node --check src/server.js
```

Ambos comandos terminaron sin errores. El proyecto no define un script de pruebas automatizadas en `backend/package.json`; se añadieron las comprobaciones de comportamiento documentadas al final.

## 1. Aislamiento de proyectos por usuario autenticado

### Problema

La función `readProject` buscaba proyectos únicamente por su identificador. Además, las operaciones para listar, crear y eliminar proyectos no aplicaban de forma consistente el identificador del usuario autenticado.

### Antes

```js
async function readProject(projectId, executor = db) {
  assertUuid(projectId, 'projectId');
  const row = await one('SELECT * FROM projects WHERE id = $1', [projectId], executor);
  if (!row) fail(404, 'PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  return row;
}
```

```js
VALUES ($1, $2, $3) RETURNING *`,
[ownerId, req.body.name.trim(), req.body.description ?? null],
```

### Después

```js
async function readProject(projectId, actorId, executor = db) {
  assertUuid(projectId, 'projectId');
  const row = await one(
    'SELECT * FROM projects WHERE id = $1 AND owner_id = $2',
    [projectId, actorId],
    executor,
  );
  if (!row) fail(404, 'PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  return row;
}
```

```js
VALUES ($1, $2, $3) RETURNING *`,
[req.authenticatedUserId, req.body.name.trim(), req.body.description ?? null],
```

También se actualizaron las 14 llamadas a `readProject`, el listado de proyectos y la eliminación para usar `req.authenticatedUserId`.

### Justificación técnica

El cambio aplica autorización basada en propiedad del recurso. Un proyecto solo puede leerse, modificarse o eliminarse cuando coincide simultáneamente su identificador y el identificador del usuario autenticado. Esto evita acceso entre cuentas autenticadas y asocia correctamente los nuevos proyectos con su creador.

## 2. Eliminación de estado global durante la validación OpenAPI

### Problema

La validación del contrato OpenAPI obtenía su contenido mediante `globalThis.__openApiText`. La función auxiliar recibía `filePath`, pero no utilizaba ese parámetro. Esto ocultaba la dependencia y dificultaba probar la lectura del contrato de forma aislada.

### Antes

```js
function verifyOpenApiContract() {
  const spec = YAML.parse(requireText(openApiPath));
  // ...
}

function requireText(filePath) {
  return globalThis.__openApiText;
}
```

```js
globalThis.__openApiText = await fs.readFile(openApiPath, 'utf8');
const routeCount = verifyOpenApiContract();
```

### Después

```js
async function verifyOpenApiContract() {
  const spec = YAML.parse(await requireText(openApiPath));
  // ...
}

async function requireText(filePath) {
  return fs.readFile(filePath, 'utf8');
}
```

```js
const routeCount = await verifyOpenApiContract();
```

### Justificación técnica

La lectura del archivo se realiza ahora mediante una dependencia explícita: la ruta recibida por `requireText`. Se elimina el estado global mutable y se respeta el flujo asíncrono de lectura. Esto mejora la claridad, la capacidad de prueba y la mantenibilidad del módulo.

## 3. Cierre garantizado del descriptor de archivo

### Problema

Durante la validación del encabezado del archivo de audio, el descriptor se cerraba solamente después de una lectura exitosa. Si `fh.read` generaba una excepción, el descriptor podía quedar abierto.

### Antes

```js
const fh = await fs.open(tempPath, 'r');
const { bytesRead } = await fh.read(header, 0, header.length, 0);
await fh.close();
```

### Después

```js
const fh = await fs.open(tempPath, 'r');
const { bytesRead } = await fh.read(
  header,
  0,
  header.length,
  0,
).finally(() => fh.close());
```

### Justificación técnica

El bloque `finally` asociado a la promesa de lectura ejecuta el cierre del descriptor tanto si la lectura termina correctamente como si produce una excepción. De este modo se evita mantener recursos del sistema abiertos en rutas de error.

## Corrección del middleware de errores

Eliminar el cuarto parámetro del middleware introdujo una regresión: Express requiere cuatro parámetros para reconocer un manejador de errores. Se restauró el parámetro next y se cambió la salida por encabezados enviados a: if (res.headersSent) return next(error).

La versión corregida pasó ESLint y la comprobación de sintaxis. Una solicitud con JSON incompleto recibió HTTP 400, formato JSON y el código INVALID_JSON. Esta prueba confirmó el manejo de ese error.

## Resultado

Las tres refactorizaciones mejoran seguridad, claridad de dependencias y gestión de recursos. La ejecución final de ESLint no reportó problemas y la comprobación de sintaxis de Node.js finalizó correctamente.

## Pruebas complementarias del 11 de noviembre de 2026

### Aislamiento mediante solicitudes HTTP reales

Pasaron 16 comprobaciones: registro y login de dos usuarios (4),
creación y propietario del proyecto (2), consulta propia (1),
listados exclusivos de cada propietario (2), rechazo de GET, PATCH
y DELETE ajenos con 404 y PROJECT_NOT_FOUND (3), conservación del
nombre ante el intento ajeno (1), modificación autorizada (1),
rechazo sin token con 401 y UNAUTHORIZED (1) y eliminación propia (1).

El proyecto de prueba se eliminó. Las dos cuentas quedaron registradas.

### Lectura y cierre de archivos

Pasaron cinco comprobaciones sobre bloques extraídos de server.js:
lectura de dos archivos temporales distintos (2), propagación de
ENOENT para una ruta inexistente (1), cierre único tras lectura
exitosa simulada (1) y cierre único con propagación del error
original tras lectura fallida simulada (1).

Los archivos temporales se eliminaron.

### Alcance

Las pruebas de cierre utilizaron dobles de prueba. No verificaron
el fallo del propio cierre. La prueba de requireText verificó la
lectura del archivo, sin ejecutar toda la validación de OpenAPI.

Quedan fuera de estas comprobaciones la concurrencia, la rama
headersSent y la cobertura completa de audio, transcripción y exportación.
