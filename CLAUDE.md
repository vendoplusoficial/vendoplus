# Notas para Claude (VendoPlus)

## Publicar al instante
El usuario pidió que **todo cambio se publique de inmediato** sin esperar a que lo pida:
al terminar, sube los cambios a `main` (es lo que se publica en vendoplusoficial.com)
y avísale. No hace falta pedir permiso ni abrir pull request.

## PENDIENTE: cambiar el logo en la app de Android
El usuario va a pasar los archivos de su **versión Android**. En cuanto los tengas,
**cambia el logo viejo por el nuevo en TODOS lados**, sin que te lo vuelva a pedir.

- **Logo viejo (ya no se usa):** cuadro verde (#25D366 → #1DAF5A) con una bolsa blanca con un "+".
- **Logo nuevo:** fondo **blanco** con la "V" + "Plus" en **azul marino #01164F**, sin borde ni sombra.
- Archivos fuente del logo nuevo (vectoriales, nítidos a cualquier tamaño) en `marca/`:
  - `vendoplus-icono.svg`: icono completo (fondo blanco a sangre + V)
  - `vendoplus-icono-android-adaptativo.svg`: versión con la V más chica, para la zona segura del icono adaptativo
  - `vendoplus-logo-solo.svg`: solo la V azul, sin fondo (para foreground o uso dentro de la app)
  - `vendoplus-icono-1024.png`: PNG grande de respaldo
- En el sitio web ya se cambió: `icon.svg` y favicons (con esquinas redondeadas, para la pestaña del navegador), `icon-*.png`, `apple-touch-icon.png`,
  `icon-maskable-512.png`, `og-image.png`, splash, encabezado y bienvenida de `index.html`
  (`ICONS.logo`), `404.html`, `eliminar-cuenta.html` y `privacidad.html`.

Qué revisar en Android:
- `res/mipmap-*/ic_launcher*.png` (mdpi 48, hdpi 72, xhdpi 96, xxhdpi 144, xxxhdpi 192)
- `res/mipmap-anydpi-v26/ic_launcher.xml` y `ic_launcher_round.xml` (icono adaptativo):
  fondo `#FFFFFF`, foreground = la V del SVG adaptativo, y también el `monochrome`
- `ic_launcher_background` (color o drawable) → blanco
- Splash screen (`windowSplashScreenAnimatedIcon`, `windowSplashScreenBackground`, `splash.xml`)
- Icono de notificaciones (`ic_stat_*`, debe ser silueta blanca de la V)
- Icono de Play Store 512×512 y cualquier copia de `index.html`, `icon.svg`, favicons dentro de `assets/`
- Colores del verde viejo ligados al logo (`colors.xml`) si se usan para el icono
- Busca también restos del dibujo de la bolsa (path `M5.3 8.6h13.4...` o `M150 180h212...`)

## Apps de delivery (Rappi, DiDi Food, Uber Eats): APAGADO por ahora
El usuario pidió ocultarlas "como si no existieran" hasta que contacte a esas empresas.
Todo sigue programado (vendo-apps.js, función `apps-delivery` y tablas `vp_apps_*` en Supabase).
Para activarlas: en `index.html` cambia `window.VP_APPS_ACTIVO = false;` a `true` y sube la
versión de `vendo-apps.js` y `vendo-premium.js` en sus `<script src=...?v=>`.

## Arranque rápido y sin internet (sw.js)
- `sw.js` es SOLO para cuando no hay internet: con internet todo se pide al servidor como una
  página normal (no meter esperas ni "copia primero" para js/css: eso dejaba versiones viejas
  pegadas y el cocinero veía la pantalla en blanco al recargar).
- La copia solo se sirve si falla la red. Al bajar bien la página se guardan también sus `?v=`.
- Fotos (`img/`) y `vendor/` sí van "copia primero" porque nunca cambian (cambia el `?v=` o el nombre).
- **No cambies `CACHE` en `sw.js`** (`vp-app-v2`): cambiarlo borra la copia del teléfono.
- Al cambiar un .js/.css súbele la versión `?v=` en `index.html`.
- La librería de Supabase está en `vendor/supabase-2.119.0.js` (ya no se baja de jsdelivr).
  Si se cambia de versión, renombra el archivo y actualiza `index.html` y `BASE` en `sw.js`.
- Las fotos ya NO van incrustadas en base64 en `index.html`: viven en `img/` con `?v=`. Al agregar
  una foto: ponla en `img/`, agrégala a `window.VP_IMGS` (index.html) y a `BASE` en `sw.js`.
  Si cambias una foto, súbele la versión `?v=` en los tres lugares. Las letras (VPInter) siguen
  incrustadas a propósito.
- Si una pantalla falla al dibujarse sale un aviso con «Reparar» (`vpRenderError` / `vpReparar`).

## Diseño: cambiar, no encimar
- Cuando el usuario pida cambiar un diseño, **edita o borra la regla original**; no agregues
  otro bloque `<style>` "encima" que la tape. Si pide quitar algo, quítalo de verdad
  (HTML, CSS y JS que ya no se usen).
- Todos los `<style>` de `index.html` van en el `<head>` o al principio del `<body>`
  (nunca al final): si van al final, al cargar se ve un instante el diseño anterior.

## Publicación comprimida (.github/workflows/publicar.yml)
- Al subir a `main`, GitHub Actions corre `.github/minificar.js` y publica una copia
  comprimida (sin comentarios ni espacios). El código en `main` se queda legible: edita ahí.
- La compresión NO cambia nombres de funciones/variables ni valores de CSS (solo espacios
  y comentarios), así que los `onclick="..."` y `eval(nombre)` siguen funcionando.
- Para que aplique, en GitHub: Settings → Pages → Source = "GitHub Actions" (una sola vez).
