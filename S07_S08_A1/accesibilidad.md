# Evaluación básica de accesibilidad

## Alcance

Se revisaron `Button`, `InputField`, `Card`, `Navbar` y la tarjeta de módulo `FeatureCard`, junto con los estados que muestran en el dashboard. Esta es una revisión básica del código y sus colores; no representa una auditoría completa de todas las pantallas ni una certificación WCAG.

## Criterios considerados

- **WCAG 2.1, 1.4.3 Contraste mínimo (AA):** texto normal requiere al menos 4.5:1.
- **WCAG 2.1, 1.4.11 Contraste no textual (AA):** los límites y estados visuales necesarios para reconocer un control requieren al menos 3:1 frente a colores adyacentes.
- **WCAG 2.1, 1.1.1 Contenido no textual (A):** controles sin texto visible requieren un nombre accesible; los adornos deben poder ignorarse.
- **WCAG 2.1, 2.4.7 Foco visible (AA):** los controles operables por teclado deben mostrar el foco.

Referencias: [1.4.3 Contraste mínimo](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html), [1.4.11 Contraste no textual](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html), [1.1.1 Contenido no textual](https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html) y [2.4.7 Foco visible](https://www.w3.org/WAI/WCAG21/Understanding/focus-visible.html).

## Problemas encontrados y correcciones

| Hallazgo | Antes | Corrección aplicada | Resultado |
| --- | --- | --- | --- |
| Descripción de tarjeta con contraste insuficiente para texto normal. | `#74809a` sobre blanco: **3.96:1**. | Se cambió a `#59677f` en `Card` y `FeatureCard`. | **5.72:1**. |
| Texto de ayuda y placeholder del campo demasiado claros. | Ayuda `#8792a6`: **3.14:1**; placeholder `#a1aabb`: **2.34:1**, sobre blanco. | Ayuda `#586780`; placeholder `#626f86`. | **5.73:1** y **5.08:1** respectivamente. |
| Límites del campo y la tarjeta demasiado tenues. | Campo `#dce4ef` sobre blanco: **1.28:1**; tarjeta `#e5eaf3` sobre blanco: **1.21:1**. | Se cambió el borde de ambos a `#77839a`. | **3.82:1** sobre blanco para identificar los límites. |
| Foco del botón dependía de verde claro, poco visible en fondos claros. | `#c0ef9d` sobre blanco: **1.31:1**. | Se añadió un indicador de dos tonos: contorno blanco y anillo exterior azul marino `#243d70`. | El anillo azul alcanza **10.62:1** sobre blanco; el contorno blanco alcanza **15.51:1** sobre el sidebar `#142344`. |
| Contorno del campo también era tenue al recibir foco. | El borde de foco era azul claro y el contorno tenía transparencia. | Se reemplazó por contorno sólido `#243d70`. | **10.62:1** frente al fondo blanco del campo. |

## Nombres accesibles, etiquetas y foco

- `InputField` relaciona su etiqueta visible con el campo mediante `htmlFor` e `id`. El estado de error se comunica con `aria-invalid`, se asocia con `aria-describedby` y se anuncia con `role="alert"`. El estado requerido también se aplica con el atributo nativo `required`.
- Los enlaces del `Navbar` tienen texto visible. Sus símbolos son decorativos, llevan `aria-hidden="true"` y el enlace actual usa `aria-current="page"`.
- El indicador giratorio del botón de carga es decorativo y está oculto a tecnologías de asistencia. El texto cambia a “Guardando…” y el botón comunica `aria-busy` y `disabled` mientras carga.
- No hay botones solo con icono en la implementación actual. `Button` reenvía atributos nativos, por lo que una instancia futura solo con icono puede recibir `aria-label`.
- Botones, campos y enlaces usan controles nativos y estilos `:focus-visible`; el orden de tabulación sigue el orden del documento. `Card` no es interactiva y no requiere recibir foco.
- El borde del botón secundario se conserva como detalle sutil: su etiqueta visible tiene contraste **8.90:1** y permite reconocer el control sin depender del borde, coherente con la nota de límites de controles de 1.4.11.

## Contrastes revisados que cumplen

- Texto del botón primario: `#17304c` sobre `#c0ef9d`: **10.28:1**.
- Texto del botón secundario: `#344a70` sobre blanco: **8.90:1**.
- Texto normal del enlace de navegación: `#9cacca` sobre sidebar `#142344`: **6.77:1**.
- Etiqueta del campo: `#34425e` sobre blanco: **10.06:1**.
- Mensaje de error: `#b23946` sobre `#fffafb`: **5.70:1**.

Los ratios se calcularon con la fórmula de luminancia relativa de WCAG a partir de los colores CSS indicados; los valores se redondean a dos decimales para el informe.
