# Audio2Score · Frontend

Scaffolding inicial de la aplicación con React, Vite y CSS Modules.

## Requisitos

Node.js 20.19+ o 22.12+.

## Inicio local

1. Instala dependencias: `npm install`
2. Copia la configuración de ejemplo: `Copy-Item .env.example .env` (PowerShell)
3. Arranca Vite: `npm run dev`
4. Abre la URL local que muestre Vite, normalmente `http://localhost:5173`.

La variable `VITE_API_URL` apunta a la API FastAPI. El valor de ejemplo es
`http://localhost:8000`; ajústalo si el backend usa otro host o puerto.

## Estructura

- `src/components/`: componentes reutilizables de interfaz.
- `src/pages/`: pantallas.
- `src/context/`: estado compartido de autenticación.
- `src/services/`: comunicación con la API REST.
- `src/main.jsx`: punto de entrada de React.
