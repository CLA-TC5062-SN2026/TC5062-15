# Capa de servicios de API

## Propósito

La capa de servicios concentra la comunicación entre el frontend de Audio2Score y la API REST. Las páginas y los componentes no realizan solicitudes HTTP directamente; consumen módulos especializados para autenticación y proyectos.

## Cliente HTTP y configuración

Se utilizó la API nativa `fetch`, encapsulada en `frontend/src/services/apiClient.js`. Esta decisión evita dependencias adicionales y centraliza la construcción de solicitudes, encabezados, análisis de respuestas y errores.

La URL base se obtiene exclusivamente de la variable de entorno `VITE_API_URL`. En desarrollo se configuró como `/api`; Vite redirige ese prefijo al backend local del puerto 3000 mediante `vite.config.js`. De esta manera, el destino puede cambiarse sin modificar los servicios ni las páginas.

## JWT y equivalente a interceptor

El token de acceso se almacena en `sessionStorage` bajo la clave `audio2score.accessToken`. Este mecanismo mantiene la sesión durante la pestaña actual y se elimina al cerrar la sesión del navegador.

`apiRequest()` funciona como el equivalente a un interceptor: antes de cada solicitud protegida consulta el token y agrega automáticamente el encabezado:

```text
Authorization: Bearer <token>