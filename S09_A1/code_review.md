# Code review asistido por IA

## Alcance

Se revisó el archivo `backend/src/server.js`, que concentra la lógica principal del backend de Audio2Score: autenticación, persistencia, gestión de proyectos, carga de archivos de audio, transcripciones, exportaciones y manejo de errores.

Los números de línea corresponden al commit 034afd6, anterior a las refactorizaciones.

## Hallazgos

### 1. Falta de validación de propiedad del proyecto

**Severidad:** Crítica
**Referencia:** `backend/src/server.js`, líneas 244-248.

La función `readProject` obtiene un proyecto únicamente con su identificador. No verifica que el proyecto pertenezca al usuario autenticado que realiza la solicitud. Por ello, una persona autenticada que obtuviera un UUID válido podría consultar o modificar un proyecto ajeno mediante las rutas que llaman a esta función.

Código original:

```js
async function readProject(projectId, executor = db) {
  assertUuid(projectId, 'projectId');
  const row = await one('SELECT * FROM projects WHERE id = $1', [projectId], executor);
  if (!row) fail(404, 'PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  return row;
}
```

Código corregido propuesto:

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

Cada ruta que consulte un proyecto debe proporcionar `req.authenticatedUserId` como segundo argumento.

---

### 2. Las operaciones de listado y creación ignoran al usuario autenticado

**Severidad:** Crítica
**Referencia:** `backend/src/server.js`, líneas 364-380.

La ruta `GET /projects` devuelve proyectos sin filtrar por propietario. Además, `POST /projects` usa la constante `ownerId` en lugar del identificador contenido en el token. Esto impide asociar correctamente los proyectos con el usuario que los creó y puede exponer información entre cuentas.

Código original:

```js
const rows = await query(
  `SELECT * FROM projects WHERE ($1::boolean OR archived_at IS NULL)
   ORDER BY created_at DESC`, [includeArchived],
);

const row = await one(
  `INSERT INTO projects (owner_id, name, description)
   VALUES ($1, $2, $3) RETURNING *`,
  [ownerId, req.body.name.trim(), req.body.description ?? null],
);
```

Código corregido propuesto:

```js
const rows = await query(
  `SELECT * FROM projects
   WHERE owner_id = $1 AND ($2::boolean OR archived_at IS NULL)
   ORDER BY created_at DESC`,
  [req.authenticatedUserId, includeArchived],
);

const row = await one(
  `INSERT INTO projects (owner_id, name, description)
   VALUES ($1, $2, $3) RETURNING *`,
  [req.authenticatedUserId, req.body.name.trim(), req.body.description ?? null],
);
```

---

### 3. Dependencia oculta en el estado global para validar OpenAPI

**Severidad:** Importante
**Referencia:** `backend/src/server.js`, líneas 146-171 y 655-657.

`verifyOpenApiContract` recibe una ruta de archivo de manera indirecta, pero la función `requireText` no usa su parámetro. En cambio, obtiene el contenido desde `globalThis.__openApiText`. Esta dependencia global dificulta probar la función de forma aislada y vuelve menos explícito el origen de los datos.

Código original:

```js
function verifyOpenApiContract() {
  const spec = YAML.parse(requireText(openApiPath));
  // ...
}

function requireText(filePath) {
  return globalThis.__openApiText;
}
```

Código corregido propuesto:

```js
async function verifyOpenApiContract() {
  const spec = YAML.parse(await requireText(openApiPath));
  // ...
}
```

En `main`, la llamada debe esperar la lectura asíncrona:

```js
const routeCount = await verifyOpenApiContract();
```

La implementación conserva requireText como función asíncrona: async function requireText(filePath) { return fs.readFile(filePath, 'utf8'); }. Se elimina la asignación a globalThis.__openApiText.

---

### 4. Derivación síncrona de contraseñas dentro de solicitudes HTTP

**Severidad:** Importante
**Referencia:** `backend/src/server.js`, líneas 299-310, 323 y 335.

Las funciones `hashPassword` y `passwordMatches` usan `crypto.scryptSync`. Al ejecutarse dentro de las rutas de registro e inicio de sesión, bloquean el event loop de Node.js hasta terminar la derivación criptográfica. Esto puede afectar la capacidad de respuesta cuando existen varias solicitudes simultáneas.

Código corregido propuesto:

```js
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function passwordMatches(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;

  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
```

Las rutas deben usar `await hashPassword(password)` y `await passwordMatches(password, user.password_hash)`.

---

### 5. El descriptor del archivo puede quedar abierto si falla la lectura

**Severidad:** Importante
**Referencia:** `backend/src/server.js`, líneas 417-420.

El archivo temporal se abre con `fs.open` y se cierra después de leer su encabezado. Si `fh.read` produce una excepción, la instrucción de cierre no se ejecuta. La limpieza del archivo temporal sí se realiza en el bloque externo `catch`, pero el descriptor abierto puede permanecer sin liberar.

Código original:

```js
const fh = await fs.open(tempPath, 'r');
const { bytesRead } = await fh.read(header, 0, header.length, 0);
await fh.close();
```

Código corregido propuesto:

```js
const fh = await fs.open(tempPath, 'r');
const { bytesRead } = await fh.read(
  header, 0, header.length, 0,
).finally(() => fh.close());
```

El bloque `finally` garantiza el cierre del descriptor tanto en una lectura exitosa como ante un error.

## Refactorizaciones seleccionadas

Se implementaron las siguientes tres refactorizaciones:

1. Aplicar aislamiento de proyectos por usuario autenticado.
2. Eliminar la dependencia de `globalThis` en la validación del contrato OpenAPI.
3. Garantizar el cierre del descriptor de archivo durante la validación de la carga de audio.

Los avisos de ESLint se resolvieron conservando los contratos de las funciones.

## Sección SOLID

| Principio | ¿Se respeta? | Ejemplo en el código | Propuesta de corrección |
|---|---|---|---|
| Single Responsibility Principle (SRP) | No | `backend/src/server.js`, líneas 1-670, concentra configuración, acceso a datos, autenticación, validación, rutas HTTP, archivos, contrato OpenAPI y manejo de errores. | Separar el archivo en módulos con responsabilidades definidas: `infrastructure/database.js`, `services/projectService.js`, `services/authService.js`, `routes/projects.js`, `routes/auth.js` y `app.js`. |
| Open/Closed Principle (OCP) | Parcialmente | backend/src/server.js:135-144 permite registrar rutas mediante register. En las líneas 413-425, tanto la selección por extensión como la validación del encabezado dependen de WAV y MP3. | Extraer estrategias por formato con identificación, validación del encabezado y lectura de metadatos. El controlador consultaría un registro de estrategias. Añadir un formato requeriría su estrategia y registro, además de revisar las restricciones del esquema y OpenAPI. Un mapa de extensiones por sí solo es insuficiente. |
| Liskov Substitution Principle (LSP) | Sí | `HttpError` en las líneas 50-57 extiende `Error` y conserva el comportamiento esperado de una excepción. El middleware de las líneas 642-645 puede tratar una instancia de `HttpError` como un `Error` y, adicionalmente, utilizar sus propiedades específicas. | No se requiere corrección. Si se añaden nuevos tipos de error, deberán conservar el contrato de `Error`: mensaje, propagación mediante `throw` y manejo por el middleware global. |
| Interface Segregation Principle (ISP) | Sí, en el contrato mínimo examinado; evaluación limitada | backend/src/server.js:69-76: query utiliza únicamente executor.query y one consume ese resultado. Este contrato permite proporcionar un ejecutor con la operación necesaria. Recibir req y res en un controlador HTTP no demuestra por sí mismo una violación de ISP. | Al extraer servicios, definir contratos pequeños según las operaciones que cada consumidor necesita. Evitar exigir a todos los servicios una interfaz que incluya autenticación, archivos y persistencia. |
| Dependency Inversion Principle (DIP) | Parcialmente | Las funciones `query` y `readProject` aceptan un ejecutor como parámetro en las líneas 69-76 y 244-248, lo cual facilita pruebas. Sin embargo, el módulo crea directamente `new PGlite(dbPath)` en la línea 67 y varias rutas usan la variable global `db`. | Crear la aplicación mediante una fábrica, por ejemplo `createApp({ database, fileSystem, config })`, e inyectar esas dependencias a los servicios y rutas. Así, el backend podrá usar una base de datos de prueba sin modificar el código de producción. |

### Síntesis de la evaluación SOLID

La principal oportunidad de mejora está en la separación de responsabilidades y en la inversión de dependencias. Aunque el backend implementa mecanismos útiles, como `HttpError`, `asyncHandler` y el parámetro opcional `executor`, el archivo único concentra demasiadas responsabilidades. En la siguiente iteración se recomienda modularizar la aplicación y conservar las dependencias externas en una capa de infraestructura.
