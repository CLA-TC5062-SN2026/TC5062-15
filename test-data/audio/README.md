# Audios de validación manual

Esta carpeta reúne tres archivos de muestra para probar la carga y transcripción de Audio2Score. Todos usan formatos admitidos por el backend (`.mp3` o `.wav`) y duran menos de 15 minutos.

| Archivo | Formato | Uso sugerido |
| --- | --- | --- |
| `emotional_piano.wav` | WAV | Probar una interpretación de piano |
| `mary_had_a_little_lamb.mp3` | MP3 | Probar una melodía corta |
| `ode_to_joy.mp3` | MP3 | Probar una melodía más larga |

Para la prueba manual, abre el formulario de carga de audio en el frontend y selecciona uno de estos archivos desde `test-data/audio/`. La API guarda una copia en `backend/data/uploads/`, procesa el archivo localmente con Basic Pitch y persiste la transcripción en la base de datos existente `backend/data/audio2score/`.

No copies archivos directamente a `backend/data/uploads/`: la API debe registrar el audio y su intento de procesamiento en la base de datos.
