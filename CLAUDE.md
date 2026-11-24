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
- En el sitio web ya se cambió: `icon.svg`, favicons, `icon-*.png`, `apple-touch-icon.png`,
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
