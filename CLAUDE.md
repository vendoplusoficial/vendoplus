# Notas para Claude (VendoPlus)

## Publicar al instante
El usuario pidió que **todo cambio se publique de inmediato** sin esperar a que lo pida:
al terminar, sube los cambios a `main` (es lo que se publica en vendoplusoficial.com)
y avísale. No hace falta pedir permiso ni abrir pull request.

## HECHO: el logo de la app de Android ya es el nuevo (26 nov 2026)
Se cambió el logo viejo (cuadro verde con la bolsita) por el nuevo (fondo blanco +
la "V" azul marino **#01164F**) en toda la app: los 10 mipmaps, el icono adaptativo
(fondo blanco + la V del SVG adaptativo, con `monochrome`), `splash_icon.xml`,
`ic_stat_vendo.xml` (silueta blanca de la V, sin el "Plus": a 24dp no se ve),
`Notifier.java` (`setColor` → #01164F; la luz del LED se quedó verde a propósito,
se ve de lejos), el icono 512 de Play Store y el gráfico destacado 1024×500.
`colors.xml` ganó `vp_navy`.

OJO: el verde **#25D366 / #1DAF5A** que sigue en el index y en los .js **no es el
logo viejo**: es el verde de WhatsApp (la variable `brand`). No lo quites.

## Apps de delivery (Rappi, DiDi Food, Uber Eats): APAGADO por ahora
El usuario pidió ocultarlas "como si no existieran" hasta que contacte a esas empresas.
Todo sigue programado (vendo-apps.js, función `apps-delivery` y tablas `vp_apps_*` en Supabase).
Para activarlas: en `index.html` cambia `window.VP_APPS_ACTIVO = false;` a `true` y sube la
versión de `vendo-apps.js` y `vendo-premium.js` en sus `<script src=...?v=>`.

## Cobro con NFC (Tap to Pay con Stripe): APAGADO por ahora
En `index.html`: `window.VP_NFC_ACTIVO = false;`. El apartado se ve dentro de Stripe
pero dice **Próximamente** y no se puede activar (`stHubNfcHTML`, `stNfcSet`, `stNfcOn`).

Todo lo demás ya está programado:
- App Android: `NfcCobro.java` (SDK de Stripe Terminal), `NfcSoporte.java` (revisa si
  el celular puede, sin tocar Stripe), `VendoPlusApp.java`, y la sección 10 de
  `vendo-app.js` (que se sale sola si `VP_NFC_ACTIVO` no es `true`).
- Supabase: función `stripe-terminal` (token, intent, revisar, cancelar).

**Antes de encenderlo**, Stripe tiene que activar la capacidad `card_present` en la
cuenta (México está en vista previa pública de Tap to Pay on Android). Mientras no,
el cobro no funciona aunque se prenda el apagador.
Para encenderlo: `VP_NFC_ACTIVO = true` y súbele la versión a `vendo-premium.js`.

## Pedidos del Menú Digital pagados con tarjeta
El pedido se guarda en `menu_orders` desde que el cliente lo manda (hace falta para
poder cobrarlo), pero **al negocio NO le llega hasta que el pago está confirmado**:
`mdiFromCloud()` devuelve `null` mientras `data.stripeCheckout === true` y
`charge_status !== 'paid'`, y `MdiCloud.take()` no lo marca como recibido.
En cuanto Stripe confirma, el Realtime de `menu_orders` (escucha UPDATE) dispara otra
revisión y el pedido entra al instante.
Después de pagar, al cliente se le ofrece mandar **su ticket** por WhatsApp: es
opcional, el pedido ya llegó solo.

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
