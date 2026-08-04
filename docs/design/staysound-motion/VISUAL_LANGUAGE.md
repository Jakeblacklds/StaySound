# Sala de escucha

Nueva dirección visual recomendada para StaySound Desktop.

## Concepto

StaySound se presenta como un archivo musical personal dentro de una sala de escucha: la precisión de un equipo hi-fi, el tacto de una colección de discos y la composición de una revista musical independiente.

La interfaz evita códigos visuales asociados a productos generativos: glassmorphism ubicuo, gradientes multicolor, halos, titulares gigantes, cápsulas para cada acción y tarjetas flotantes idénticas. La personalidad nace de decisiones tipográficas, ritmo, material y detalle.

## Principios

1. **La música aporta el color.** Las portadas dominan; el sistema usa un único cobre oxidado para estado y acción.
2. **Superficie continua.** Grid, detalle y player pertenecen a un mismo plano; la jerarquía se construye con espacio y líneas, no con cards.
3. **Editorial, no decorativo.** Serif solo para títulos de obra; grotesca sobria para navegación, metadata y controles.
4. **Controles físicos.** Botones compactos, rectangulares y precisos. Las cápsulas solo existen cuando su semántica lo exige.
5. **Densidad de escritorio.** Más biblioteca visible, menos hero y menos aire sin función.
6. **Imperfección controlada.** Un grano mate casi imperceptible evita el negro digital plano sin convertirse en un efecto.

## Paleta

```css
:root {
  --ink-950: #0d0e0e;
  --ink-900: #121313;
  --ink-850: #181818;
  --paper-100: #e6dfd2;
  --paper-300: #b8b0a3;
  --paper-500: #777269;
  --rule: #35322e;
  --copper-500: #d86f3f;
  --copper-400: #ec8450;
  --copper-ink: #160c08;
}
```

No hay gradiente de marca ni color dinámico aplicado a toda la interfaz. Extraer color de una carátula queda reservado al full player o karaoke y nunca altera navegación, texto o superficies base.

## Tipografía

- UI: `Space Grotesk`, peso 400–600.
- Editorial: `Source Serif 4` o `Newsreader`, peso 400–500.
- Título de página: 40–48 px, serif; nunca ocupa más de una línea de retícula.
- Álbum/título de detalle: 44–56 px según ancho.
- Metadata: 12–14 px, con contraste moderado.
- Etiquetas de sección: 11 px, grotesca, mayúsculas y tracking `0.16em`.

La serif no se usa en botones, tiempos, navegación ni formularios.

## Forma y material

- Radio de ventana: nativo.
- Portadas: 0–4 px.
- Campos y botones: 2–4 px.
- Overlays: 8 px como máximo.
- Separadores: 1 px en `--rule`.
- Sombras: solo para elevar un menú u overlay; nunca en cards de biblioteca.
- Blur: únicamente detrás de un overlay modal si hace falta separación.

## Componentes característicos

### Navegación

224 px, negro mate. El item activo usa fondo tonal, línea cobre de 2 px e icono cobre. El wordmark es compacto y no compite con la biblioteca.

### Biblioteca

Las portadas se apoyan directamente en la retícula. Debajo aparecen título, artista, cantidad y un id opcional de catálogo (`SS-0042`). Hover: borde cobre fino y botón play cuadrado anclado a una esquina; no se desplaza toda la card.

### Detalle

Carátula y metadata forman una composición editorial. La tracklist es una tabla continua dividida por caras o discos cuando los datos lo permiten. La fila activa tiene línea cobre y ecualizador pequeño, no un gran relleno de color.

### Player

Es un deck integrado al borde inferior. Tiene tres zonas separadas por reglas: obra, transporte y utilidades. El timeline se trata como una regla de medición. Play/pause es el único control con superficie cobre sólida.

### Overlays

Queue y settings son paneles mate, más claros que el fondo, con borde cálido. Conservan el mismo lenguaje tipográfico y de reglas. No introducen un segundo sistema de glass.

## Relación con motion

El sistema de movimiento de `MOTION_SYSTEM.md` se conserva, pero cambia la expresión visual:

- Una tarjeta no “flota”; su borde cobre aparece y la portada se transforma desde su posición.
- El player no sube como cápsula; su deck se expande desde el borde inferior.
- Las líneas y divisores pueden extenderse para revelar jerarquía.
- La textura permanece fija; nunca se anima ni hace parallax.
- No hay rebote, elasticidad ni glow animado.

## Referencias finales

- `sala-de-escucha-library.png`
- `sala-de-escucha-album-detail.png`
- `sala-de-escucha-full-player.png`

Estas tres pantallas sustituyen `library-redesign.png` como dirección visual. El storyboard anterior sigue siendo válido únicamente para estudiar la geometría del container transform.
