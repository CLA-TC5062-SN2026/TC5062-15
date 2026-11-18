# Clasificación de problemas detectados por ESLint

## Herramienta y alcance

Se configuró y ejecutó ESLint 10.14.0 con las reglas recomendadas para JavaScript en Node.js. El análisis se aplicó al directorio `backend/src`. El resultado completo se conserva en `output_linter.txt`.

El análisis identificó 2 errores y 0 advertencias.

## Clasificación por severidad

| Severidad | Archivo y línea | Regla | Descripción | Justificación |
|---|---:|---|---|---|
| Menor | `backend/src/server.js:168` | `no-unused-vars` | El parámetro `filePath` de la función `requireText` está declarado, pero no se utiliza. | No modifica el comportamiento de ejecución ni genera un riesgo de seguridad. Sin embargo, comunica una dependencia que la función no tiene y puede confundir durante el mantenimiento. |
| Menor | `backend/src/server.js:634` | `no-unused-vars` | El cuarto parámetro `_next` está declarado sin uso explícito. | El aviso requiere interpretar el contrato de Express: el cuarto parámetro identifica al manejador de errores y debe conservarse. Se renombró a `next` y se utilizó para delegar el error cuando res.headersSent es verdadero. Eliminarlo introduce una regresión. |

## Conclusión de la clasificación

No se identificaron problemas críticos ni importantes mediante el análisis estático configurado. Los dos hallazgos corresponden a mantenibilidad y claridad del código. Se corrigieron durante la refactorización, junto con hallazgos de mayor relevancia identificados mediante el code review asistido.

## Trazabilidad y resultado posterior

Las líneas y la salida de output_linter.txt corresponden al análisis
inicial, previo a las refactorizaciones, sobre el código del commit
034afd6. Se conserva esa salida como evidencia de los dos hallazgos.

La corrección de filePath utiliza la ruta recibida para leer el archivo.
La corrección de _next conserva la firma requerida por Express y utiliza
next(error) cuando los encabezados ya se enviaron.

La ejecución posterior de ESLint terminó sin errores. La petición HTTP
con JSON inválido confirmó una respuesta 400 con el código INVALID_JSON.
Los resultados de comportamiento se documentan en refactorizacion.md.
