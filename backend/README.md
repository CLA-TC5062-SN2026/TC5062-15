# Audio2Score CRUD API

API REST de desarrollo para la Parte 2, generada a partir de `../openapi_equipo.yaml` y `../esquema_bd.sql`.

## Tecnologías

- Node.js 20 o posterior
- Express 5
- PostgreSQL embebido mediante PGlite 0.5 (para ejecutar el ejercicio sin instalar un servicio PostgreSQL)
- Multer para cargas multipart
- YAML para comprobar las operaciones declaradas en OpenAPI al arrancar

La base queda persistida en `data/audio2score`. En un despliegue del equipo, PostgreSQL puede ejecutarse como servicio dedicado; esta implementación usa el mismo motor PostgreSQL embebido para desarrollo local. Al iniciar, importa `esquema_bd.sql` solo cuando la base está vacía y verifica las 13 tablas.

## Iniciar

```powershell
Copy-Item .env.example .env
pnpm install
pnpm start
```

La consola debe indicar conexión PostgreSQL, 13 tablas verificadas y 21 operaciones OpenAPI registradas.

## Sin seguridad en esta actividad

Los endpoints no verifican JWT ni requieren autenticación/autorización, de acuerdo con el alcance de la actividad. `/auth/register` y `/auth/login` conservan sus rutas y formas de respuesta, pero el token devuelto es opaco de desarrollo y no protege los otros recursos. El propietario de desarrollo se inicializa desde `DEMO_OWNER_ID` y `DEMO_OWNER_EMAIL`.

## Trabajo asíncrono y límites

La carga/configuración/reintento y la creación de exportaciones registran eventos en `outbox_messages`; esta entrega no incluye worker ni motor musical. Por ello, los intentos y exportaciones quedan pendientes hasta que se implemente el worker. El endpoint de descargar exportación devuelve `409` mientras el archivo no esté listo.

La carga valida tamaño y formato, decodifica metadatos para determinar la duración y rechaza archivos inválidos o mayores de 15 minutos.

## Variables de entorno

Ver `.env.example`. No se debe copiar un `.env` con credenciales reales al repositorio.
