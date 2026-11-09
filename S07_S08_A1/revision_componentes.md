# Revisión de componentes frontend

## Stack aplicado

Los componentes están implementados con React y CSS Modules, de acuerdo con el stack del frontend Audio2Score. Cada componente separa su estructura, sus props y sus estilos para poder reutilizarlo sin depender de una pantalla específica.

## Ajustes realizados a la propuesta base

| Componente | Ajuste de implementación | Motivo |
| --- | --- | --- |
| Botón | Se añadieron las variantes `primary` y `secondary`, props `loading`, `loadingText`, `disabled` y `type`. Durante la carga se deshabilita y expone `aria-busy`. | Evita envíos repetidos, hace visible el estado de espera y permite usarlo en formularios o acciones simples. |
| Campo de entrada | `InputField` genera un id accesible con `useId` cuando no se proporciona uno; recibe `label`, `hint`, `error`, `required`, `disabled` y props nativas del input. | Mantiene la etiqueta asociada al campo y vincula las ayudas y errores con `aria-describedby`; `aria-invalid` activa el estilo visual de error. |
| Tarjeta | `Card` acepta `as`, `title`, `description`, `footer`, `className` y contenido hijo. La tarjeta de módulos existente (`FeatureCard`) ahora reutiliza `Card`. | Centraliza el contenedor visual y permite representar artículos, secciones u otros bloques sin duplicar estructura base. |
| Barra de navegación | `Navbar` recibe `items`, `activeHref`, `isAuthenticated`, `userName`, `onLogin` y `onLogout`; los enlaces activos llevan `aria-current`. | Separa el estado de autenticación de la presentación y permite reutilizar la barra en otras pantallas. En el dashboard, el cambio de sesión es demostrativo y local. |

## Integración de muestra

- El dashboard usa `Card` para las tarjetas de módulos y agrega una tarjeta de muestra para revisar el campo y los botones.
- La tarjeta permite observar el error al enviar un nombre vacío, el estado de carga y un mensaje de guardado local. No realiza solicitudes al API.
- La barra de navegación usa el `AuthContext` existente para mostrar los estados sin autenticar y de sesión de demostración.
- La navegación lateral se convierte en una lista horizontal con desplazamiento en pantallas estrechas. Los componentes ajustan tamaños y espacios para móvil.

## Revisión de props y estilos

| Componente | Configuración revisada | Adaptación responsive |
| --- | --- | --- |
| `Button` | Variante, carga, etiqueta de carga, tipo, deshabilitado y atributos/eventos nativos del botón. | El tamaño táctil aumenta en pantallas estrechas y el contenido no supera el ancho disponible. |
| `InputField` | Id, etiqueta, tipo, placeholder, valor, eventos, requerido, ayuda, error y deshabilitado. | El campo ocupa el ancho del contenedor y aumenta su altura/tamaño de texto en móvil. |
| `Card` | Elemento semántico, título, descripción, pie, clases adicionales, atributos y children. | Usa padding fluido, ancho mínimo controlado y ocupa el ancho disponible en móvil. |
| `Navbar` | Enlaces, iconos, enlace activo y estado/callbacks de autenticación. | Los enlaces se muestran en fila desplazable en pantallas estrechas; la cuenta puede ocupar una fila propia. |

## Alcance

La autenticación del ejemplo solo modifica el estado local del `AuthContext`; no es un inicio de sesión conectado al backend. Los estilos siguen la paleta y los radios ya usados por Audio2Score, con estados de foco visibles y respeto por `prefers-reduced-motion`.
