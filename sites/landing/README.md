# StaySound Landing

Página pública de StaySound: presenta la app y ofrece el APK de Android y el DMG de macOS en descarga abierta.

Es una página web normal (titular, secciones, capturas de la app), no una copia de la interfaz. Lo que toma de la app es el lenguaje "Círculo" (`web/src/styles/circulo.css`): negro puro, Hanken Grotesk, el círculo como único adorno, píldoras, un acento ámbar y el llenado de letra palabra por palabra.

Las capturas de `public/screens/` son recortes de `design-qa-home-final.png` y `design-qa-fullplayer-final.png`.

## Desarrollo

```bash
npm install
npm run dev
```

## De dónde salen las descargas

`app/release.ts` lee el último release del repo público `Jakeblacklds/staysound-releases` (el mismo que usa la página "Consigue la app" de la versión web) **al construir el sitio**. Después de publicar un release nuevo hay que volver a desplegar para que la página lo muestre.

Variables opcionales:

- `NEXT_PUBLIC_RELEASES_REPO`: otro repo de releases (`dueño/repo`).
- `NEXT_PUBLIC_WEB_APP_URL`: a dónde lleva "O ábrelo en el navegador". Por defecto `/app`.

## Iconos

`app/stayIconShapes.ts` se genera desde el catálogo de la app (`web/src/icons/stayIcons.ts`). Para regenerarlo, desde la raíz del repo:

```bash
node sites/landing/scripts/generate-icons.mjs
```

## Despliegue

El landing no tiene proyecto propio en Vercel. Se exporta como archivos estáticos y `scripts/build-site.mjs` (el `buildCommand` de `vercel.json`) lo coloca junto a la app web: el landing queda en `/` y la app en `/app`, las dos en `staysound.vercel.app`.

```bash
npm run site:build
```
