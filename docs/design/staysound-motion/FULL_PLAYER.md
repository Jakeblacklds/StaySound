# Sala de escucha — Full Player

Referencia: `sala-de-escucha-full-player.png`.

## Objetivo

El full player no es una experiencia visual separada: es la expansión del deck persistente. Mantiene el mismo negro mate, cobre, tipografía editorial, reglas y controles físicos del resto de StaySound.

## Anatomía

### Utility rail

Barra superior de 52 px con cuatro áreas:

- cerrar/contraer y breadcrumb;
- estado de reproducción centrado;
- karaoke;
- ajustes de letra y cola.

Los controles son icono + texto cuando hay espacio. No usan círculos flotantes.

### Obra

La columna izquierda ocupa cinco de doce columnas. La portada conserva proporción 1:1 y un radio máximo de 2–4 px. Debajo aparecen id de catálogo, título, artista/álbum/año y acciones secundarias.

### Letra

La columna derecha ocupa siete columnas y funciona como una hoja tipográfica continua:

- línea activa: serif de 42–48 px, `--paper-100`;
- línea anterior/siguiente: 26–30 px, `--paper-500`;
- timestamp y regla cobre identifican el origen temporal;
- karaoke usa un barrido cobre sobre los glifos, no glow ni blur;
- las líneas se desplazan sobre una línea base estable;
- las líneas inactivas permanecen legibles.

### Deck inferior

Altura aproximada de 176 px y tres zonas separadas por reglas:

1. artwork + metadata + favorito;
2. transporte + ruler de progreso;
3. cola + volumen + salida de audio.

Play/pause es el único botón con superficie cobre sólida.

## Movimiento

### Player compacto → completo

1. El deck inferior conserva posición y ancho; aumenta de altura en 420 ms.
2. Thumbnail, título y progreso son shared elements.
3. La portada crece desde el thumbnail hasta su posición editorial.
4. Utility rail y letra aparecen entre el 45% y 65% de la transformación con fade/translate de 8 px.
5. Cerrar ejecuta la inversión exacta y devuelve cada elemento a su lugar.

### Letra sincronizada

- Cambio de línea: `translateY(24px)` + cambio de opacidad, 320 ms.
- Barrido por palabra: lineal y gobernado por timestamps; nunca usa spring.
- Cambio de estrofa: el bloque completo se reposiciona en 420 ms.
- Buscar manualmente la letra desacopla temporalmente el auto-scroll y muestra “Volver a la línea actual”.

### Paneles

- Cola: drawer desde la derecha, 320 ms.
- Ajustes de letra: popover desde el control superior, 240 ms.
- Karaoke: container transform desde el área de letra, 420 ms.

## Estados

- Sin letra: la columna derecha muestra créditos, ficha del archivo y artwork secundario; no queda vacía.
- Cargando: skeleton de líneas sobre la misma línea base.
- Pausa: el estado cambia a “En pausa”; la composición no se atenúa.
- Error: mensaje inline en la zona de letra con acción de reintento.
- Reduced motion: crossfade de línea sin desplazamiento y salto instantáneo del barrido.

## Lo que no pertenece

- fondos derivados de la portada en toda la ventana;
- blur fuerte sobre letras inactivas;
- partículas, espectros o gradientes por defecto;
- título display gigante;
- controles circulares flotantes;
- múltiples acentos simultáneos;
- animaciones elásticas en transporte o letra.
