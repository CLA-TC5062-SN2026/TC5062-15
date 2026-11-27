# Audio2Score · Frontend

Aplicación React con Vite y CSS Modules. Consume la API Express del proyecto en `/v1`.

## Requisitos

Node.js 20.19+ o 22.12+.

## Inicio local en Windows

Primero inicia el backend desde otra ventana de PowerShell. Después, desde esta carpeta:

```powershell
npm.cmd install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
```

Abre la dirección que indique Vite, normalmente `http://localhost:5173`.

## API y autenticación

`VITE_API_URL=/v1` configura la ruta base en `.env`. `vite.config.js` reenvía las solicitudes `/v1` al backend local `http://localhost:3000`; por eso no se necesita habilitar CORS para este flujo de desarrollo. Si se despliega el frontend en otro origen, habrá que configurar el enrutamiento o CORS para ese origen.

El registro crea la cuenta y después dirige al usuario al inicio de sesión. El login conserva el JWT en `sessionStorage` de la pestaña. Al recargar, la aplicación valida el token con `GET /auth/me` antes de mostrar una ruta protegida. **Cerrar sesión** revoca el token y limpia el almacenamiento; un `401` también cierra la sesión local.

La lista de proyectos consume el backend y permite crear, consultar, editar, archivar, restaurar y eliminar. El detalle carga MP3/WAV y consulta automáticamente el procesamiento. La vista de transcripción permite comparar el audio original, revisar notas marcadas por confianza estimada, guardar revisiones y descargar archivos MIDI y PDF; el PDF muestra pentagrama esquemático y tabla de notas.

## Estructura

- `src/components/`: componentes reutilizables, rutas protegidas y formulario de proyecto.
- `src/pages/`: login, registro, dashboard, proyectos, detalle de proyecto y transcripción.
- `src/context/`: estado compartido de autenticación.
- `src/services/`: comunicación con la API REST.
- `src/main.jsx`: punto de entrada de React.
