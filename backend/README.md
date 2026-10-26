# Audio2Score CRUD API

API REST de desarrollo para la Parte 2, generada a partir de `../openapi_equipo.yaml` y `../esquema_bd.sql`.

## Tecnologías

- Node.js 20 o posterior
- Express 5
- PostgreSQL embebido mediante PGlite 0.5 (para ejecutar el ejercicio sin instalar un servicio PostgreSQL)
- Multer para cargas multipart
- YAML para comprobar las operaciones declaradas en OpenAPI al arrancar
- bcryptjs para hash de contraseñas y jsonwebtoken para emitir/verificar JWT

La base queda persistida en `data/audio2score`. En un despliegue del equipo, PostgreSQL puede ejecutarse como servicio dedicado; esta implementación usa el mismo motor PostgreSQL embebido para desarrollo local. Al iniciar, importa `esquema_bd.sql` solo cuando la base está vacía y verifica las 13 tablas.

## Iniciar

```powershell
Copy-Item .env.example .env
pnpm install
pnpm start
```

La consola debe indicar conexión PostgreSQL, 13 tablas verificadas, 21 operaciones OpenAPI registradas y que JWT está activo.

## Autenticación JWT

`POST /auth/register` crea usuarios con bcrypt y nunca devuelve el hash. `POST /auth/login` emite un JWT HS256 con expiración explícita; `GET /auth/me` exige `Authorization: Bearer <token>`. `POST /auth/logout` invalida el token mediante la tabla `revoked_tokens`. Las rutas del OpenAPI funcionan bajo `/v1`; se conservan las rutas raíz usadas por la colección anterior y se aceptan también `/api/auth/...` para coincidir con el enunciado de la actividad.

Configura `JWT_SECRET` con al menos 32 bytes aleatorios y `JWT_EXPIRATION` con segundos (por ejemplo, `3600`). No compartas ni commitees `.env`; sí puedes commitear `.env.example`. El middleware protege todas las rutas declaradas con BearerAuth en el OpenAPI. Solo registro y login son públicos. Los proyectos y recursos asociados se consultan con el usuario propietario del JWT; el modelo no define roles.

## Trabajo asíncrono y límites

La carga/configuración/reintento y la creación de exportaciones registran eventos en `outbox_messages`; esta entrega no incluye worker ni motor musical. Por ello, los intentos y exportaciones quedan pendientes hasta que se implemente el worker. El endpoint de descargar exportación devuelve `409` mientras el archivo no esté listo.

La carga valida tamaño y formato, decodifica metadatos para determinar la duración y rechaza archivos inválidos o mayores de 15 minutos.

## Variables de entorno

Ver `.env.example`. No se debe copiar un `.env` con credenciales reales al repositorio.
