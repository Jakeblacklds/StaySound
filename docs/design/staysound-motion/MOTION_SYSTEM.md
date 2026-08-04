# StaySound desktop — sistema visual y de movimiento

Referencias:

- `library-redesign.png`: dirección visual para la biblioteca.
- `album-container-transform.png`: storyboard de álbum → detalle → reproducción.

## Idea rectora

StaySound es una biblioteca local, no un escaparate. La interfaz debe sentirse estable y próxima al contenido: el shell permanece en su sitio y la música es la que se mueve. La carátula es el principal portador de color; el cobre se reserva para selección, progreso y acciones primarias.

El cambio visual más importante es reducir gestos simultáneos. Se elimina el titular decorativo gigante, el glass y los brillos; se adopta una retícula única en biblioteca y detalle. Las superficies son opacas, con bordes de 1 px y radios de 2–8 px.

## Tokens globales

```css
:root {
  --motion-ease-standard: cubic-bezier(.2, 0, 0, 1);
  --motion-ease-enter: cubic-bezier(.16, 1, .3, 1);
  --motion-ease-exit: cubic-bezier(.4, 0, 1, 1);

  --motion-instant: 90ms;   /* press, check, icon state */
  --motion-fast: 160ms;     /* hover, focus, tooltip */
  --motion-base: 240ms;     /* tabs, rows, local content */
  --motion-layout: 320ms;   /* player morph, drawer */
  --motion-transform: 420ms;/* card/container → detail */

  --motion-distance-local: 8px;
  --motion-distance-view: 16px;
  --motion-scale-press: .98;
}
```

No se usa `transition: all`. Cada componente declara solo `transform`, `opacity`, `background-color`, `border-color` o la propiedad concreta que cambia. No hay rebote en navegación ni en superficies grandes.

## Gramática espacial

| Relación | Movimiento | Duración |
| --- | --- | ---: |
| Misma vista, estado local | crossfade o desplazamiento de 8 px | 90–160 ms |
| Cambio de tab hermano | contenido anterior sale 8 px hacia el origen; el nuevo entra 8 px desde el destino | 240 ms |
| Tarjeta → detalle | container transform desde el rectángulo real de la tarjeta | 420 ms |
| Detalle → tarjeta | inversión exacta hacia la tarjeta y posición de scroll originales | 420 ms |
| Player compacto → completo | carátula, título y controles compartidos; el contenedor crece desde el player | 420 ms |
| Queue/settings | overlay atenúa; panel entra desde el borde al que pertenece | 320 ms |
| Modal de confirmación | nace del control invocador si existe; en caso contrario escala .98→1 desde el centro | 240 ms |

Entrada y salida comparten geometría. La salida puede ser ligeramente más rápida solo para overlays (`240 ms` frente a `320 ms`).

## Coreografías

### Navegación lateral

El indicador menta se desplaza entre filas en 240 ms. El relleno de la fila cruza en 160 ms. El shell nunca hace fade. El contenido conserva el mismo borde izquierdo; cambia con una traslación horizontal máxima de 8 px y crossfade. Al volver, se restaura el scroll anterior.

### Álbum o artista → detalle

1. En `pointerdown`, la tarjeta escala a `.98` durante 90 ms.
2. La carátula y el título reciben nombres de transición estables basados en el id del álbum/artista.
3. La tarjeta expande su contenedor hasta el hero del detalle durante 420 ms.
4. El resto de la cuadrícula baja a `.985`, pierde opacidad hasta `.35` y se desplaza 12 px hacia atrás durante 240 ms.
5. Metadata y acciones aparecen después del 45% del recorrido; la lista entra después del 60%, con un stagger máximo de 100 ms para preservar lectura sin convertirlo en efecto decorativo.
6. Back/escape ejecutan exactamente la secuencia inversa.

Si el elemento de origen ya no está montado, se usa el último rectángulo conocido; solo como último recurso se hace un fade de 240 ms.

### Reproducción

Al iniciar una pista, el thumbnail de la fila viaja a la carátula del player. Título y artista hacen crossfade dentro de un ancho fijo; el player no cambia de altura. El botón play se transforma en pause en 160 ms y la fila activa adquiere el indicador de ecualizador en 240 ms. Shuffle, repeat y favorite son transiciones locales de 90–160 ms.

### Player completo

La superficie nace del player persistente, no del centro de la ventana. La carátula conserva identidad, la barra de progreso se reposiciona y el fondo entra después mediante crossfade. Al cerrar, todo vuelve al player compacto. La experiencia karaoke puede conservar motion expresivo dentro de su escenario, pero su apertura y cierre siguen esta misma geometría.

### Overlays

- Scrim: `opacity 0→.56` en 240 ms.
- Drawer de cola: `translateX(100%→0)` en 320 ms; salida en 240 ms.
- Settings: nace del botón de engrane con `transform-origin` en ese control.
- Menú contextual: escala `.96→1` y sube 4 px en 160 ms.
- Solo el overlay superior responde a escape y captura foco.

## Accesibilidad y rendimiento

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

En reduced motion se conserva un crossfade de estado cuando sea necesario para comprensión, pero se eliminan viajes, escalas, parallax y fondos en movimiento. Las transiciones de layout deben priorizar `transform` y `opacity`; el blur no se anima. Una interacción frecuente no debe superar 240 ms y una transformación estructural no debe superar 420 ms.

## Orden de implementación

1. Sustituir los tokens actuales y eliminar `transition: all` del shell, navegación, cards y botones.
2. Unificar la retícula y la anatomía de `AlbumDetail`/`ArtistDetail` con sus tarjetas de origen.
3. Implementar identidad compartida para carátula y título (View Transitions API con fallback FLIP).
4. Convertir el full player en container transform desde `PlayerBar`.
5. Normalizar drawer, settings, modales y menús con las reglas anteriores.
6. Añadir pruebas visuales para estado inicial, 50% de transición, destino y reduced motion.

## Criterio de aceptación

En cualquier transición debe poder responderse: de dónde salió el elemento, a dónde fue y qué relación conserva con el estado anterior. Si esa respuesta no es visible, la transición no pertenece al sistema.

## Estado implementado — 27 julio 2026

- `web/src/motion/motionSystem.ts` contiene tokens únicos y el orquestador de navegación.
- Chromium usa View Transitions nativas. Tauri/WKWebView usa un fallback FLIP mediante Web Animations con la misma geometría, duración y curva.
- Álbum y artista trasladan carátula y título en ambos sentidos: grid → detalle y detalle → grid.
- Al seleccionar una canción, su thumbnail viaja hasta la carátula del player persistente; metadata y controles resuelven localmente.
- La navegación lateral conserva el shell, mueve un único indicador físico y determina dirección de entrada/salida según el orden de las secciones.
- El full player se expande y colapsa desde la altura real del player inferior mediante `clip-path`; no aparece desde el centro. Al cambiar de pista conserva temporalmente artwork y metadata salientes, mientras artwork, breadcrumb, metadata, deck y lyrics entran con la misma dirección que next/previous.
- Cola, ajustes, onboarding y ajustes de letras incluyen scrim y salida antes del desmontaje.
- El marcador cobre de la línea activa vive absolutamente fuera del cuadro de texto. Su opacidad y escala vertical se animan sin añadir padding ni desplazar la letra.
- El fallback compartido de Tauri anima solo `transform` y `opacity`; no interpola `left`, `top`, `width` o `height`. Las colecciones y tracklists ya no disparan una animación por fila durante la navegación.
- `prefers-reduced-motion` reduce todas las duraciones a 1 ms y evita los viajes espaciales.
