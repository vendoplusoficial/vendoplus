/* =========================================================================
   VENDO PLUS · PREMIUM  (vendo-premium.js)
   -------------------------------------------------------------------------
   Este archivo cambia por completo la forma de cobrar:

   ANTES:  1 mes gratis y después la app se bloqueaba entera.
   AHORA:  la app NUNCA se bloquea. Lo que se vende es Premium ($249/mes).

   GRATIS PARA SIEMPRE (sin pagar un peso, sin tarjeta, sin avisos):
     · Vender y cobrar            · Generar y enviar tickets
     · Historial de ventas        · Caja, corte y gastos
     · Clientes y crédito         · Inventario completo
     · Fotos de productos (ilimitadas)
     · Mi cuenta y configuración
     · Estadísticas simples (ventas netas, pedidos, ticket promedio, gráficas)
     · 3 pruebas de escaneo de carta con IA en total

   PREMIUM · $249 MXN al mes:
     · Menú Digital con pedidos
     · Chat con IA (el asistente del robot)
     · Escáner de carta con IA sin límite
     · Estadísticas detalladas

   CÓMO SE BLOQUEA (a propósito, SIN candados a la vista):
     · Menú Digital   → se entra y se configura igual; al tocar "Activar"
                        aparece la pantalla de Premium.
     · Estadísticas   → el botón "Ver estadísticas detalladas" se queda
                        igual que siempre; al tocarlo aparece Premium.
     · Chat con IA    → el robot se queda inactivo; al tocarlo, Premium.
     · Escáner IA     → 3 de prueba EN TOTAL (no se renuevan); al cuarto, Premium.

   El cobro NO cambia: en la página web sigue siendo el mismo precio de
   Stripe, y en la app de Play Store la misma suscripción de Google Play.

   Es el mismo archivo para la página web y para la app de Play Store.
========================================================================= */
(function () {
  'use strict';
  if (window.VPPremium) return;

  var PRECIO = 249;

  /* ===== PREMIUM OCULTO (por mientras) =====
     true  = se esconde SOLO la corona (arriba y en el menú) y su pantalla
             "Funciones premium". La pantalla para pagar Premium y todas
             las invitaciones a contratarlo siguen funcionando normal.
     false = la corona vuelve a verse. */
  var PREMIUM_OCULTO = true;

  function ocultarPremium() {
    if (!PREMIUM_OCULTO || document.getElementById('vp-premium-oculto')) return;
    var st = document.createElement('style');
    st.id = 'vp-premium-oculto';
    st.textContent =
      '#topPremium, .vp-top-prem, .navbtn[data-view="premium"]{ display:none !important; }';
    (document.head || document.documentElement).appendChild(st);
  }

  /* Atajos seguros a lo que ya existe en index.html (se declara con const,
     así que se llega por nombre, pero todo va envuelto por si cambiara). */
  function ref(n) { try { return eval(n); } catch (e) { return undefined; } }
  function fn(n) { var f = ref(n); return typeof f === 'function' ? f : null; }
  function esc(s) { var f = fn('escapeHtml'); return f ? f(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function ico(n) { var f = fn('icon'); return f ? f(n) : ''; }
  function nube() { var c = window.Cloud; return (c && c.ready) ? c : null; }
  function avisar(m, o) { var f = fn('toast'); if (f) f(m, o || {}); }
  function vibra(ms) { var f = fn('vibrate'); if (f) try { f(ms || 8); } catch (e) {} }

  /* =======================================================================
     1.  ¿ESTE NEGOCIO ES PREMIUM?
     Se lee de lo que YA guarda el servidor:
       · web      → profiles.paid_until  (lo escribe Stripe)
       · Android  → además vp_play_pagado_hasta (lo escribe Google Play)
     Si no hay nube (prototipo en el navegador), se usa la bandera local.
  ======================================================================= */
  function activo() {
    var c = nube();
    if (c) {
      try { if (typeof c.paidNow === 'function' && c.paidNow()) return true; } catch (e) {}
      try {
        var s = c.sub;
        if (s && s.vp_play_pagado_hasta && new Date(s.vp_play_pagado_hasta) > new Date()) return true;
      } catch (e) {}
      /* Con nube, la verdad la tiene el servidor: no se cree nada local. */
      return false;
    }
    try { var u = fn('currentUser') ? ref('currentUser')() : null; return !!(u && u.membershipPaid); } catch (e) { return false; }
  }

  /* El precio tal como lo muestra la tienda (Google Play lo trae ya con la
     moneda del país). Si no hay tienda, el de siempre. */
  function precioTxt() {
    try {
      if (window.PlayPay && typeof PlayPay.priceText === 'function') {
        var p = PlayPay.priceText();
        if (p) return p;
      }
    } catch (e) {}
    return '$' + PRECIO + ' MXN';
  }

  /* =======================================================================
     2.  LAS FUNCIONES DE PAGA
  ======================================================================= */
  var FUNCIONES = {
    menu: {
      titulo: 'Menú digital y pedidos',
      texto: 'Tus clientes ven tu menú y hacen su pedido desde el celular. Tú lo recibes en VendoPlus.',
      ico: 'menuBook'
    },
    chat: {
      titulo: 'Asistente de tu negocio',
      texto: 'Pregúntale a la IA cuánto vendiste, cuánto ganaste o qué productos se están agotando.',
      ico: 'sparkle'
    },
    escaner: {
      titulo: 'Agrega productos con una foto',
      texto: 'Toma una foto de tu carta y la IA carga los productos y precios por ti.',
      ico: 'camera'
    },
    usuarios: { titulo: 'Acceso para tus empleados', texto: 'Cada empleado entra con su propio NIP y solo puede usar las funciones que le permitas.', ico: 'users' },
    comandas: { titulo: 'Comandas: caja, mesero y cocina', texto: 'El mesero toma el pedido en la mesa, cocina lo recibe al instante y la caja cobra. Todo conectado.', ico: 'comandas' },
  stats: {
      titulo: 'Reportes de ventas y ganancias',
      texto: 'Consulta cuánto vendes, cuánto ganas y cuáles son tus productos más vendidos.',
      ico: 'chart'
    }
  };
  var ORDEN = ['menu', 'chat', 'escaner', 'usuarios'];
  // Cuando se llega desde "agregar usuario" se muestra esa ventaja primero
  // (se deja fuera la última tarjeta para que la pantalla siga sin scroll).
  var ORDEN_USUARIOS = ['usuarios', 'menu', 'chat', 'escaner'];

  /* La corona de Premium. Va aquí adentro a propósito: así es UN solo
     archivo que se copia igual a la web y a la app, sin imágenes sueltas
     que se puedan quedar sin subir. */
  var CORONA = 'img/premium-corona.webp?v=1';

  /* =======================================================================
     3.  ESTILOS
     Paleta: blanco y verde. Nada de azul marino.
  ======================================================================= */
  var cssPuesto = false;
  function estilos() {
    if (cssPuesto || document.getElementById('vp-premium-css')) { cssPuesto = true; return; }
    cssPuesto = true;
    var st = document.createElement('style');
    st.id = 'vp-premium-css';
    st.textContent = [
      ':root{',
      '  --vp-pr-verde:#16A34A; --vp-pr-verde-claro:#25D366;',
      '  --vp-pr-suave:#E8F9EF; --vp-pr-borde:#E4E8EF;',
      '  --vp-pr-tinta:#15181C; --vp-pr-gris:#6C7480;',
      '}',

      /* ------------------------------------------------------------------
         UNA SOLA PANTALLA, SIN DESLIZAR.
         La hoja de pantalla completa deja de desplazarse y se convierte en
         una columna: lo de arriba y lo de abajo miden lo suyo, y las cuatro
         tarjetas se reparten lo que sobra. Todos los tamaños van con
         clamp() atado al ALTO de la pantalla (vh), así que el mismo diseño
         cabe igual en un celular chiquito que en una tablet.
      ------------------------------------------------------------------ */
      /* CELULAR (menos de 700 px de ancho): Vendo Plus pone la hoja a
         pantalla completa, así que aquí sí se convierte en una columna que
         llena el alto y NO se desliza. */
      '@media (max-width:699px){',
      '  .modal-sheet:has(.vp-pr){overflow:hidden !important;display:flex;flex-direction:column;',
      '  padding:max(10px,env(safe-area-inset-top)) 16px calc(10px + env(safe-area-inset-bottom)) !important;}',
      '  .vp-pr{flex:1 1 auto;min-height:0;}',
      '}',
      '.vp-pr{width:100%;max-width:520px;margin:0 auto;display:flex;flex-direction:column;}',

      /* ---- cerrar ---- */
      '.vp-pr-x{flex:none;display:flex;justify-content:flex-end;margin-bottom:clamp(-6px,-.6vh,0px);}',
      '.vp-pr-x button{width:clamp(32px,4.4vh,40px);height:clamp(32px,4.4vh,40px);border:none;border-radius:50%;',
      'background:#F1F3F7;color:var(--vp-pr-gris);display:flex;align-items:center;justify-content:center;',
      'cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s ease;}',
      '.vp-pr-x button:active{background:#E4E8EF;}',
      '.vp-pr-x button svg{width:clamp(15px,2.1vh,19px);height:clamp(15px,2.1vh,19px);}',

      /* ---- corona ---- */
      '.vp-pr-art{flex:none;display:block;height:clamp(68px,15.5vh,146px);width:auto;max-width:62%;',
      'object-fit:contain;margin:clamp(0px,.4vh,6px) auto clamp(6px,1.3vh,14px);}',

      /* ---- títulos ---- */
      '.vp-pr-h1{flex:none;margin:0 0 clamp(4px,.8vh,10px);text-align:center;',
      'font-size:clamp(19px,2.55vh + 1.6vw,31px);line-height:1.16;font-weight:800;',
      'letter-spacing:-.5px;color:var(--vp-pr-tinta);}',
      '.vp-pr-h1 b{color:var(--vp-pr-verde);font-weight:800;}',
      '.vp-pr-lead{flex:none;margin:0 auto clamp(8px,1.5vh,18px);max-width:360px;text-align:center;',
      'font-size:clamp(12px,1.6vh,15.5px);line-height:1.4;font-weight:600;color:var(--vp-pr-gris);}',
      '.vp-pr-lead b{color:var(--vp-pr-tinta);font-weight:800;}',

      /* ---- las cuatro tarjetas: se reparten lo que sobra ---- */
      '.vp-pr-cards{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:center;',
      'gap:clamp(5px,.95vh,11px);margin-bottom:clamp(2px,.5vh,6px);}',
      /* flex:1 con tope: si sobra espacio las tarjetas lo toman (y no queda
         un hueco raro en medio), pero nunca se estiran de más. */
      '.vp-pr-card2{flex:1 1 auto;max-height:clamp(56px,10.6vh,92px);',
      'display:flex;gap:clamp(9px,1.4vh,13px);align-items:center;',
      'border:1px solid var(--vp-pr-borde);border-radius:clamp(12px,1.8vh,17px);background:#fff;',
      'padding:clamp(8px,1.35vh,15px) clamp(11px,1.6vh,16px);}',
      '.vp-pr-card2.is-focus{border-color:#BFE9D0;background:#FBFFFC;}',
      '.vp-pr-ico{flex:none;width:clamp(30px,4.3vh,42px);height:clamp(30px,4.3vh,42px);',
      'border-radius:clamp(9px,1.4vh,13px);display:flex;align-items:center;justify-content:center;',
      'background:var(--vp-pr-suave);color:var(--vp-pr-verde);}',
      '.vp-pr-ico svg{width:clamp(15px,2.2vh,21px);height:clamp(15px,2.2vh,21px);}',
      '.vp-pr-txt{min-width:0;}',
      '.vp-pr-txt b{display:block;font-size:clamp(13px,1.78vh,16px);font-weight:800;',
      'color:var(--vp-pr-tinta);line-height:1.25;}',
      '.vp-pr-txt span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;',
      'font-size:clamp(11px,1.45vh,13.8px);font-weight:600;color:var(--vp-pr-gris);line-height:1.36;',
      'margin-top:clamp(1px,.25vh,3px);}',

      /* ---- "Ver más beneficios ›" (debajo de la última tarjeta) ---- */
      '.vp-pr-mas{flex:none;display:flex;align-items:center;justify-content:center;gap:2px;width:100%;border:none;',
      'background:none;cursor:pointer;font-family:inherit;font-size:clamp(13px,1.8vh,15.5px);font-weight:800;line-height:1.2;',
      'color:var(--vp-pr-verde);padding:clamp(6px,1.1vh,11px) 8px;margin:0 0 clamp(2px,.7vh,8px);',
      '-webkit-tap-highlight-color:transparent;transition:opacity .15s ease;}',
      '.vp-pr-mas:active{opacity:.55;}',
      '.vp-pr-mas svg{width:clamp(14px,1.9vh,17px);height:clamp(14px,1.9vh,17px);flex:none;}',

      /* ---- vista "Todo lo que incluye Premium" (se abre con Ver más beneficios) ---- */
      '.vp-pr-x.dos{justify-content:space-between;}',
      '@media (max-width:699px){',
      '  .vp-pr-v2 .vp-pr-h1{font-size:clamp(18px,2.2vh + 1.3vw,28px);margin:clamp(2px,.6vh,8px) 0 clamp(8px,1.5vh,16px);}',
      '  .vp-pr-v2 .vp-pr-cards{margin-bottom:clamp(8px,1.5vh,16px);}',
      '  .vp-pr-v2 .vp-pr-card2{max-height:clamp(54px,11.4vh,96px);}',
      '}',

      /* ---- precio ---- */
      '.vp-pr-precio{flex:none;background:var(--vp-pr-suave);border-radius:clamp(13px,1.9vh,18px);',
      'padding:clamp(9px,1.5vh,16px) clamp(13px,1.8vh,18px);margin-bottom:clamp(7px,1.2vh,14px);}',
      '.vp-pr-precio small{display:block;font-size:clamp(10px,1.3vh,12px);font-weight:800;letter-spacing:.5px;',
      'text-transform:uppercase;color:var(--vp-pr-verde);line-height:1.2;}',
      '.vp-pr-precio b{display:block;font-size:clamp(24px,3.9vh,38px);font-weight:800;letter-spacing:-1px;',
      'line-height:1.04;color:var(--vp-pr-verde);margin-top:clamp(1px,.3vh,4px);}',
      '.vp-pr-precio span{display:block;font-size:clamp(11.5px,1.5vh,14px);font-weight:600;color:#3F8A5E;',
      'margin-top:clamp(1px,.3vh,4px);}',

      /* ---- botón ---- */
      '.vp-pr-cta{flex:none;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;',
      'border:none;cursor:pointer;border-radius:clamp(12px,1.8vh,16px);',
      'padding:clamp(12px,2.05vh,19px) 18px;font-family:inherit;',
      'font-size:clamp(14.5px,1.95vh,17.5px);font-weight:800;color:#fff;',
      'background:var(--vp-pr-verde-claro);box-shadow:0 6px 18px rgba(37,211,102,.3);',
      '-webkit-tap-highlight-color:transparent;transition:transform .12s ease, background .15s ease;}',
      '.vp-pr-cta:active{transform:scale(.985);background:#1FBE5B;}',
      '.vp-pr-cta[disabled]{opacity:.6;box-shadow:none;}',
      '.vp-pr-cta svg{width:clamp(14px,1.9vh,17px);height:clamp(14px,1.9vh,17px);}',
      '.vp-pr-link{flex:none;display:block;width:100%;margin-top:clamp(4px,.8vh,10px);border:none;background:none;',
      'cursor:pointer;font-family:inherit;font-size:clamp(12.5px,1.6vh,14.5px);font-weight:700;',
      'color:var(--vp-pr-verde);padding:clamp(7px,1.1vh,11px);-webkit-tap-highlight-color:transparent;}',
      '.vp-pr-pie{flex:none;margin:clamp(7px,1.2vh,14px) 2px 0;text-align:center;',
      'font-size:clamp(11px,1.45vh,13px);font-weight:600;color:var(--vp-pr-gris);line-height:1.35;}',
      '.vp-pr-legal{flex:none;margin:clamp(4px,.7vh,10px) 2px 0;text-align:center;',
      'font-size:clamp(9.5px,1.2vh,11.5px);font-weight:600;line-height:1.4;color:#98A0AC;}',

      /* ---- aviso (solo el Dueño puede pagar / tus productos no se borran) ---- */
      '.vp-pr-nota{flex:none;display:flex;gap:9px;align-items:flex-start;background:#F6F8FB;',
      'border-radius:clamp(10px,1.5vh,14px);padding:clamp(9px,1.4vh,14px);margin-bottom:clamp(7px,1.2vh,14px);}',
      '.vp-pr-nota svg{width:clamp(14px,1.9vh,17px);height:clamp(14px,1.9vh,17px);flex:none;margin-top:1px;',
      'color:var(--vp-pr-gris);}',
      '.vp-pr-nota p{margin:0;font-size:clamp(11.5px,1.5vh,13.5px);font-weight:600;line-height:1.4;',
      'color:var(--vp-pr-gris);}',
      '.vp-pr-nota p b{color:var(--vp-pr-tinta);font-weight:800;}',

      /* ---- pantallas bajitas: se va soltando lo menos importante ---- */
      '@media (max-height:720px){ .vp-pr-legal{display:none;} }',
      '@media (max-height:660px){ .vp-pr-lead{display:none;} .vp-pr-txt span{-webkit-line-clamp:1;} }',
      '@media (max-height:580px){ .vp-pr-txt span{display:none;} .vp-pr-pie{display:none;}',
      '  .vp-pr-nota{display:none;} .vp-pr-art{height:clamp(54px,12vh,96px);} }',
      '@media (max-height:470px){ .vp-pr-art{display:none;} }',
      /* ------------------------------------------------------------------
         TABLET Y COMPUTADORA (700 px o más de ancho).
         Aquí Vendo Plus NO pone la hoja a pantalla completa: la deja como
         una ventana centrada y angosta (max-width 440). Con el diseño del
         celular metido a la fuerza ahí, todo se amontonaba y el último
         bloque quedaba tapado por el precio.
         Solución: la ventana se ensancha, las tarjetas se acomodan en dos
         columnas y los tamaños dejan de depender del alto de la pantalla.
      ------------------------------------------------------------------ */
      '@media (min-width:700px){',
      '  .modal-sheet:has(.vp-pr){max-width:min(860px,94vw) !important;width:min(860px,94vw);',
      '  max-height:94dvh;overflow-y:auto;padding:22px 26px 26px !important;border-radius:22px !important;}',
      '  .vp-pr{max-width:none;}',
      '  .vp-pr-x{margin-bottom:-4px;}',
      '  .vp-pr-x button{width:38px;height:38px;}',
      '  .vp-pr-x button svg{width:18px;height:18px;}',
      '  .vp-pr-art{height:auto;width:200px;max-width:none;margin:0 auto 14px;}',
      '  .vp-pr-h1{font-size:30px;margin-bottom:8px;}',
      '  .vp-pr-lead{display:block;font-size:15px;max-width:460px;margin-bottom:20px;}',
      '  .vp-pr-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;}',
      '  .vp-pr-card2{flex:0 0 auto;max-height:none;align-items:flex-start;padding:15px 16px;}',
      '  .vp-pr-v2 .vp-pr-card2:last-child{grid-column:1 / -1;}',
      '  .vp-pr-ico{width:40px;height:40px;border-radius:13px;}',
      '  .vp-pr-ico svg{width:20px;height:20px;}',
      '  .vp-pr-txt b{font-size:15.5px;}',
      '  .vp-pr-txt span{font-size:13.5px;-webkit-line-clamp:3;}',
      /* precio y botón, lado a lado: así no se come el alto */
      '  .vp-pr-pago{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:14px;align-items:stretch;}',
      '  .vp-pr-precio{margin-bottom:0;display:flex;flex-direction:column;justify-content:center;padding:14px 20px;}',
      '  .vp-pr-precio b{font-size:34px;}',
      '  .vp-pr-cta{height:100%;min-height:64px;font-size:17.5px;}',
      '  .vp-pr-link{margin-top:12px;}',
      '  .vp-pr-pie{font-size:13px;margin-top:12px;}',
      '  .vp-pr-legal{display:block;font-size:11.5px;}',
      '  .vp-pr-nota{padding:14px 16px;font-size:13.5px;}',
      '}',
      /* Computadora y tablet con menos alto: se va apretando por escalones,
         igual que en el celular, para que nunca aparezca una barra de
         desplazamiento dentro de la ventana. */
      '@media (min-width:700px) and (max-height:900px){',
      '  .vp-pr-art{width:150px;margin-bottom:11px;}',
      '  .vp-pr-h1{font-size:27px;}',
      '  .vp-pr-lead{font-size:14px;margin-bottom:15px;}',
      '  .vp-pr-cards{gap:10px;margin-bottom:14px;}',
      '  .vp-pr-card2{padding:12px 15px;}',
      '  .vp-pr-txt span{-webkit-line-clamp:2;}',
      '  .vp-pr-precio b{font-size:30px;}',
      '  .vp-pr-cta{min-height:58px;}',
      '}',
      '@media (min-width:700px) and (max-height:790px){',
      '  .vp-pr-art{width:120px;margin-bottom:9px;}',
      '  .vp-pr-h1{font-size:24px;}',
      '  .vp-pr-lead{display:none;}',
      '  .vp-pr-legal{display:none;}',
      '}',
      '@media (min-width:700px) and (max-height:670px){',
      '  .vp-pr-art{width:96px;}',
      '  .vp-pr-h1{font-size:22px;}',
      '  .vp-pr-txt span{-webkit-line-clamp:1;}',
      '  .vp-pr-pie{display:none;}',
      '  .vp-pr-cta{min-height:52px;font-size:16px;}',
      '}',
      '@media (min-width:700px) and (max-height:560px){',
      '  .vp-pr-art{display:none;}',
      '  .vp-pr-txt span{display:none;}',
      '  .vp-pr-nota{display:none;}',
      '}',

      /* ---------- Animación de entrada (solo transform y opacity) ----------
         Después de que entra la hoja (celular) o la ventana (PC), el contenido
         entra en cascada: corona, título, tarjetas, precio y botón. */
      '@keyframes vp-pr-ventana{from{transform:translateY(14px) scale(.97);opacity:0}to{transform:none;opacity:1}}',
      '@keyframes vp-pr-sube{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}',
      '@keyframes vp-pr-corona{from{transform:translateY(10px) scale(.86);opacity:0}to{transform:none;opacity:1}}',
      /* Celular: la hoja ya sube con la animación de pantalla completa de la app (vpFsIn).
         PC/tablet: ventana con acercamiento suave. Al cerrar se respeta la salida de la app. */
      '@media (min-width:700px){.modal-overlay:not(.is-closing):not(.is-swap) .modal-sheet:has(.vp-pr){animation:vp-pr-ventana .38s cubic-bezier(.22,1,.36,1) both;}}',
      '.vp-pr-x{animation:vp-pr-sube .3s ease-out .14s both;}',
      '.vp-pr-art{animation:vp-pr-corona .6s cubic-bezier(.22,1,.36,1) .12s both;}',
      '.vp-pr-h1{animation:vp-pr-sube .45s cubic-bezier(.22,1,.36,1) .24s both;}',
      '.vp-pr-lead{animation:vp-pr-sube .45s cubic-bezier(.22,1,.36,1) .30s both;}',
      '.vp-pr-card2{animation:vp-pr-sube .45s cubic-bezier(.22,1,.36,1) both;}',
      '.vp-pr-card2:nth-child(1){animation-delay:.36s}',
      '.vp-pr-card2:nth-child(2){animation-delay:.42s}',
      '.vp-pr-card2:nth-child(3){animation-delay:.48s}',
      '.vp-pr-card2:nth-child(4){animation-delay:.54s}',
      '.vp-pr-card2:nth-child(5){animation-delay:.60s}',
      '.vp-pr-pago,.vp-pr-nota{animation:vp-pr-sube .45s cubic-bezier(.22,1,.36,1) .62s both;}',
      '.vp-pr-mas{animation:vp-pr-sube .45s ease-out .58s both;}',
      '.vp-pr-link,.vp-pr-pie{animation:vp-pr-sube .45s ease-out .74s both;}',
      '@media (prefers-reduced-motion: reduce){',
      '  .modal-overlay .modal-sheet:has(.vp-pr),.vp-pr-x,.vp-pr-art,.vp-pr-h1,.vp-pr-lead,.vp-pr-card2,.vp-pr-mas,.vp-pr-pago,.vp-pr-nota,.vp-pr-link,.vp-pr-pie{animation:none !important;}',
      '}',

      /* ---------- Membresía en Mi cuenta (minimalista) ---------- */
      '.vp-pr-cuenta{display:flex;align-items:center;gap:13px;border:1px solid var(--border);border-radius:var(--radius-card,18px);',
      'background:var(--surface);padding:15px 16px;box-shadow:var(--shadow-card);}',
      '.vp-pr-cuenta-txt{flex:1;min-width:0;}',
      '.vp-pr-cuenta-txt b{display:block;font-size:15px;font-weight:800;color:var(--ink);}',
      '.vp-pr-cuenta-txt span{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-top:2px;line-height:1.4;}',
      '.vp-pr-cuenta-btn{flex:none;display:inline-flex;align-items:center;gap:4px;border:none;cursor:pointer;',
      'border-radius:999px;padding:9px 14px;font-family:inherit;white-space:nowrap;',
      'font-size:13.5px;font-weight:800;color:var(--vp-pr-verde);background:var(--vp-pr-suave);',
      '-webkit-tap-highlight-color:transparent;transition:background .15s ease;}',
      '.vp-pr-cuenta-btn:active{background:#D5F3E2;}',
      '.vp-pr-cuenta-btn svg{width:14px;height:14px;}',
      '.vp-pr-cuenta-ico{flex:none;width:38px;height:38px;border-radius:13px;display:flex;align-items:center;justify-content:center;',
      'background:var(--vp-pr-suave);color:var(--vp-pr-verde);}',
      '.vp-pr-cuenta-ico svg{width:19px;height:19px;}',

      '@media (max-width:360px){',
      '  .vp-pr-cuenta{flex-wrap:wrap;}',
      '  .vp-pr-cuenta-btn{width:100%;justify-content:center;padding:11px;}',
      '}'
    ].join('');
    document.head.appendChild(st);
  }

  /* =======================================================================
     4.  LA PANTALLA DE PREMIUM  (completa, no una hoja)
  ======================================================================= */
  function tarjetaHTML(clave, foco) {
    var f = FUNCIONES[clave];
    var texto = String(f.texto).replace('{N}', String(GRATIS_AL_MES));
    return '<div class="vp-pr-card2' + (foco === clave ? ' is-focus' : '') + '">' +
             '<span class="vp-pr-ico">' + ico(f.ico) + '</span>' +
             '<span class="vp-pr-txt"><b>' + esc(f.titulo) + '</b><span>' + esc(texto) + '</span></span>' +
           '</div>';
  }

  function cabeceraHTML(titulo, lead) {
    return '<div class="vp-pr-x"><button type="button" class="sheet-close" onclick="VPPremium.cerrar()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
        '<img class="vp-pr-art" src="' + CORONA + '" alt="" decoding="async">' +
        '<h1 class="vp-pr-h1">' + titulo + '</h1>' +
        '<p class="vp-pr-lead">' + lead + '</p>';
  }

  /* Qué vista está abierta: 'principal' (las 4 tarjetas) o 'mas'
     ("Todo lo que incluye Premium", se abre con Ver más beneficios). */
  var vista = 'principal';
  var claveAbierta = null;
  var ORDEN_MAS = ['menu', 'chat', 'escaner', 'usuarios'];

  /* Pantalla principal: comparación clásica de planes, Básico vs Premium,
     lado a lado. Cada fila: palomita (incluido) o tache (no incluido). */
  var PLAN_FILAS = [
    { k: 'ventas',   t: 'Ventas y cobros',               basico: 'Hasta 300 al mes', premium: 'Ilimitadas' },
    { k: 'tickets',  t: 'Tickets e impresora',           basico: true },
    { k: 'caja',     t: 'Caja e inventario',             basico: true },
    { k: 'clientes', t: 'Clientes y deudas',             basico: true },
    { k: 'escaner',  t: 'Productos con una foto',        basico: '{N} de prueba', premium: 'Sin límite' },
    { k: 'stats',    t: 'Reportes de ventas y ganancias', basico: true },
    { k: 'menu',     t: 'Menú digital y pedidos',        basico: false },
    { k: 'chat',     t: 'Asistente con IA',              basico: false },
    { k: 'usuarios', t: 'Acceso para tus empleados',     basico: false },
    { k: 'comandas', t: 'Comandas',                      basico: false, premium: 'Caja, mesero y cocina conectados', sub: true },
    /* Cobros con tarjeta por Stripe (solo Premium): debajo, en chiquito,
       los dos cobros que incluye (cada uno en su renglón). */
    { k: 'stripe',   t: 'Cobros con tarjeta Stripe',     basico: false, premium: 'Cobro con sensor|Cobro con tarjeta en menú digital', sub: true },
    { k: 'apps',     t: 'Apps de Delivery',              basico: false, premium: 'Rappi / DiDi Food / Uber Eats', sub: true }
  ];
  var SVG_SI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  var SVG_NO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

  function planFila(f, plan, clave) {
    var v = plan === 'premium' ? (f.premium || true) : f.basico;
    var si = v !== false;
    /* sub: lo que incluye se lee también en Básico (sin ponerlo en gris) */
    if (!si && f.sub && typeof f.premium === 'string') v = f.premium;
    var nota = typeof v === 'string' ? String(v).replace('{N}', String(GRATIS_AL_MES)) : '';
    return '<li class="vp-pl-fila' + (si ? '' : ' no') + '">' +
             '<span class="vp-pl-ico">' + (si ? SVG_SI : SVG_NO) + '</span>' +
             '<span class="vp-pl-txt">' + esc(f.t) + (nota ? nota.split('|').map(function (n) { return '<small>' + esc(n) + '</small>'; }).join('') : '') + '</span>' +
           '</li>';
  }

  function planesHTML(clave, esDueno, precio) {
    var filas = function (plan) { return PLAN_FILAS.filter(function (f) { return f.k !== 'apps' || window.VP_APPS_ACTIVO; }).map(function (f) { return planFila(f, plan, clave); }).join(''); };
    var monto = String(precio).replace(/\s*MXN\s*$/i, '');
    var boton = esDueno
      ? '<button type="button" class="vp-pl-btn" id="payBtn" onclick="VPPremium.pagar()">Contratar</button>'
      : '<button type="button" class="vp-pl-btn" disabled>Solo el Dueño</button>';
    return '<div class="vp-pl">' +
        '<div class="vp-pl-col">' +
          '<div class="vp-pl-cab"><h2>Básico</h2><p>Lo esencial para vender</p></div>' +
          '<ul class="vp-pl-lista">' + filas('basico') + '</ul>' +
          '<div class="vp-pl-pie">' +
            '<div class="vp-pl-precio"><b>$0</b><span>al mes</span></div>' +
            '<button type="button" class="vp-pl-btn sec" disabled>Plan actual</button>' +
          '</div>' +
        '</div>' +
        '<div class="vp-pl-col pro">' +
          '<span class="vp-pl-tag">Recomendado</span>' +
          '<div class="vp-pl-cab"><h2>Premium</h2><p>Todo para crecer tu negocio</p></div>' +
          '<ul class="vp-pl-lista">' + filas('premium') + '</ul>' +
          '<div class="vp-pl-pie">' +
            '<div class="vp-pl-precio"><b data-vp-monto>' + esc(monto) + '</b><span>al mes</span></div>' +
            boton +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function cuerpoPrincipal(clave, esDueno, precio) {
    estilosPlanes();
    estilosPago();   /* trae también la pantalla completa en computadora */
    return '<div class="vp-pr-x"><button type="button" class="sheet-close" onclick="VPPremium.cerrar()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
      '<div class="vp-pl-scroll">' +
        '<h1 class="vp-pl-h1">Elige tu plan</h1>' +
        '<p class="vp-pl-lead">Empieza gratis y cámbiate a Premium cuando lo necesites. Cancela cuando quieras.</p>' +
        planesHTML(clave, esDueno, precio) +
        (esDueno ? '' : '<p class="vp-pl-nota">Solo el <b>Dueño</b> de la cuenta puede activar Premium. Pídele que entre con su usuario y lo active desde Mi cuenta.</p>') +
        (window.PlayPay
          ? '<button type="button" class="vp-pr-link" id="restoreBtn" onclick="PlayPay.restore()">Ya pagué · Restaurar compra</button>'
          : '') +
      '</div>';
  }

  var cssPlanes = false;
  function estilosPlanes() {
    if (cssPlanes || document.getElementById('vp-planes-css')) { cssPlanes = true; return; }
    cssPlanes = true;
    var st = document.createElement('style');
    st.id = 'vp-planes-css';
    st.textContent = [
      '.vp-pl-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:2px 0 6px;}',
      '.vp-pl-h1{margin:4px 0 6px;text-align:center;font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-.4px;color:var(--ink,#15181C);}',
      '.vp-pl-lead{margin:0 auto 18px;max-width:380px;text-align:center;font-size:14px;line-height:1.45;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-pl{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch;}',
      '.vp-pl-col{position:relative;display:flex;flex-direction:column;background:#fff;border:1px solid #E4E8EF;border-radius:18px;padding:16px 12px 14px;min-width:0;}',
      '.vp-pl-col.pro{border:1.5px solid var(--vp-pr-verde-claro,#25D366);box-shadow:0 10px 26px rgba(22,163,74,.10);}',
      '.vp-pl-tag{position:absolute;top:-10px;left:50%;transform:translateX(-50%);white-space:nowrap;background:var(--vp-pr-verde-claro,#25D366);color:#fff;font-size:10.5px;font-weight:600;letter-spacing:.3px;padding:3px 10px;border-radius:99px;}',
      '.vp-pl-cab{text-align:center;padding-bottom:12px;margin-bottom:10px;border-bottom:1px solid #EEF1F5;}',
      '.vp-pl-cab h2{margin:0;font-size:17px;font-weight:600;color:var(--ink,#15181C);letter-spacing:-.2px;}',
      '.vp-pl-col.pro .vp-pl-cab h2{color:var(--vp-pr-verde,#16A34A);}',
      '.vp-pl-cab p{margin:3px 0 0;font-size:11.5px;line-height:1.3;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-pl-lista{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;flex:1 1 auto;}',
      '.vp-pl-fila{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;line-height:1.3;font-weight:400;color:var(--ink,#15181C);}',
      '.vp-pl-fila.no{color:#A3AAB5;}',
      '.vp-pl-ico{flex:none;width:16px;height:16px;margin-top:0;color:var(--vp-pr-verde,#16A34A);}',
      '.vp-pl-fila.no .vp-pl-ico{color:#C3C8D1;}',
      '.vp-pl-ico svg{width:16px;height:16px;display:block;}',
      '.vp-pl-txt{min-width:0;}',
      '.vp-pl-txt small{display:block;font-size:11px;font-weight:400;color:var(--ink-soft,#6C7480);margin-top:1px;}',
      '.vp-pl-fila.no .vp-pl-txt small{color:var(--ink-soft,#6C7480);}',
      '.vp-pl-pie{margin-top:14px;padding-top:12px;border-top:1px solid #EEF1F5;text-align:center;}',
      '.vp-pl-precio{display:flex;align-items:baseline;justify-content:center;gap:4px;margin-bottom:10px;}',
      '.vp-pl-precio b{font-size:24px;font-weight:600;letter-spacing:-.6px;color:var(--ink,#15181C);}',
      '.vp-pl-col.pro .vp-pl-precio b{color:var(--vp-pr-verde,#16A34A);}',
      '.vp-pl-precio span{font-size:12px;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-pl-btn{width:100%;border:none;border-radius:12px;padding:11px 8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;',
      'background:var(--vp-pr-verde-claro,#25D366);color:#fff;-webkit-tap-highlight-color:transparent;transition:transform .12s ease,opacity .15s ease;}',
      '.vp-pl-btn:active:not(:disabled){transform:scale(.97);}',
      '.vp-pl-btn.sec{background:#F1F3F7;color:var(--ink-soft,#6C7480);cursor:default;}',
      '.vp-pl-btn:disabled:not(.sec){opacity:.6;cursor:default;}',
      '.vp-pl-nota{margin:14px 4px 0;text-align:center;font-size:12.5px;line-height:1.45;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-pl-scroll .vp-pr-link{display:block;margin:12px auto 0;}',
      '.vp-pl-mas{display:flex;align-items:center;justify-content:center;gap:2px;width:100%;border:none;background:none;cursor:pointer;',
      'font-family:inherit;font-size:13.5px;font-weight:500;color:var(--vp-pr-verde,#16A34A);padding:14px 8px 4px;-webkit-tap-highlight-color:transparent;}',
      '.vp-pl-mas svg{width:15px;height:15px;}',
      /* ---- Entrada: todo entra junto con las tarjetas (la letra no se anima aparte) ---- */
      '@keyframes vp-pl-sube{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}',
      '@keyframes vp-pl-sale{from{opacity:1;transform:none}to{opacity:0;transform:translateY(12px) scale(.98)}}',
      '.vp-pl-h1,.vp-pl-lead,.vp-pl-col{animation:vp-pl-sube .5s cubic-bezier(.22,1,.36,1) .12s both;}',
      '.vp-pl-col.pro{animation-delay:.2s;}',
      /* ---- Salida: el contenido baja y se desvanece junto con la hoja ---- */
      '.modal-overlay.is-closing .vp-pl-scroll,.modal-overlay.is-closing .vp-pr-x{animation:vp-pl-sale .22s ease-in both;}',
      '@media (prefers-reduced-motion: reduce){.vp-pl-h1,.vp-pl-lead,.vp-pl-col,',
      '.modal-overlay.is-closing .vp-pl-scroll,.modal-overlay.is-closing .vp-pr-x{animation:none !important;}}',
      '@media (max-width:359px){.vp-pl{gap:7px;}.vp-pl-col{padding:14px 9px 12px;}.vp-pl-fila{font-size:11.5px;}.vp-pl-h1{font-size:23px;}}',
      '@media (min-width:700px){.vp-pl{gap:14px;}.vp-pl-col{padding:20px 16px 16px;}.vp-pl-fila{font-size:13.5px;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* Vista de detalle: todo lo que incluye Premium (con flecha para regresar). */
  /* true si se entró directo a "Todo lo que incluye Premium" (botón Funciones premium): ahí no hay botón de regresar */
  var entroDirecto = false;
  function cuerpoMas(esDueno, precio) {
    return '<div class="vp-pr-x dos">' +
          (entroDirecto ? '' : '<button type="button" class="sheet-close" onclick="VPPremium.volver()" aria-label="Regresar">' + ico('chevronLeft') + '</button>') +
          '<button type="button" class="sheet-close"' + (entroDirecto ? ' style="margin-left:auto"' : '') + ' onclick="VPPremium.cerrar()" aria-label="Cerrar">' + ico('close') + '</button>' +
        '</div>' +
        '<h1 class="vp-pr-h1">Todo lo que incluye <b>Premium</b></h1>' +
        '<div class="vp-prm-scroll"><div class="vp-prf-grid">' + tarjetasImagenHTML() + '</div></div>' +
        (activo() ? pieActivoHTML() : pieHTML(precio, esDueno, 'Siempre gratis: vender y cobrar, tickets, caja, inventario, clientes y estadísticas simples.'));
  }

  /* Cambia de vista dentro de la misma pantalla (sin cerrar ni reabrir). */
  function pintarVista(v) {
    var r = document.querySelector('#modal-layer .vp-pr');
    if (!r) return;
    vista = v;
    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    var precio = precioTxt();
    r.className = 'vp-pr' + (v === 'mas' ? ' vp-pr-v2' : '');
    r.innerHTML = v === 'mas' ? cuerpoMas(esDueno, precio) : cuerpoPrincipal(claveAbierta, esDueno, precio);
    vibra(6);
  }
  function masBeneficios() { pintarVista('mas'); }
  function volver() { if (pago.ocupado) return; limpiarPago(); pintarVista('principal'); }
  /* Atrás / Esc: en la vista de detalle regresa a la principal; en la principal cierra. */
  function atras() {
    if (vista === 'pago') { if (!pago.ocupado) volver(); return; }
    if (vista === 'listo') { pagoListo(); return; }
    if (vista === 'mas' && !entroDirecto) volver(); else cerrar();
  }

  function pieHTML(precio, esDueno, pie) {
    if (!esDueno) {
      return '<div class="vp-pr-nota">' + ico('alert') +
               '<p>Solo el <b>Dueño</b> de la cuenta puede activar Premium. Pídele que entre con su usuario y lo active desde Mi cuenta.</p>' +
             '</div>' +
             '<button type="button" class="vp-pr-cta" onclick="VPPremium.cerrar()">Entendido</button>';
    }
    return '<div class="vp-pr-pago">' +
             '<div class="vp-pr-precio" data-vp-price>' +
               '<small>Membresía Vendo Plus</small>' +
               '<b>' + esc(precio) + '</b>' +
               '<span>por mes · Cancela cuando quieras</span>' +
             '</div>' +
             '<button type="button" class="vp-pr-cta" id="payBtn" onclick="VPPremium.pagar()">' +
               'Suscribirme ahora' + ico('chevronRight') +
             '</button>' +
           '</div>' +
           (window.PlayPay
             ? '<button type="button" class="vp-pr-link" id="restoreBtn" onclick="PlayPay.restore()">Ya pagué · Restaurar compra</button>'
             : '') +
           '<p class="vp-pr-pie">' + esc(pie || 'Lo demás de Vendo Plus sigue siendo tuyo, gratis.') + '</p>';
  }

  /**
   * Abre la pantalla de Premium.
   * @param {string} [clave]  Qué función quiso usar ('menu'|'chat'|'escaner'|'stats'|'usuarios')
   */
  /* Desde "Agregar usuario" se llega aquí; al cerrar se regresa a Usuarios. */
  var origen = null;

  function abrir(clave, vistaInicial) {
    estilos();
    estilosFunciones();
    origen = (clave === 'usuarios') ? 'usuarios' : null;
    var abrirModal = fn('openModal');
    if (!abrirModal) { avisar('Activa Premium desde Mi cuenta'); return; }

    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    var precio = precioTxt();
    vista = vistaInicial === 'mas' ? 'mas' : 'principal';
    entroDirecto = vistaInicial === 'mas';
    claveAbierta = clave || null;

    abrirModal(
      '<i class="fs-marker" hidden></i>' +
      '<div class="vp-pr' + (vista === 'mas' ? ' vp-pr-v2' : '') + '">' + (vista === 'mas' ? cuerpoMas(esDueno, precio) : cuerpoPrincipal(clave, esDueno, precio)) + '</div>',
      { dismissible: true, grip: false });

    traseProtegido();
    if (origen === 'usuarios') {
      /* Tocar afuera (computadora) también regresa a Usuarios, no a la nada */
      var ov = document.getElementById('modalOverlay');
      if (ov) ov.addEventListener('click', function (e) {
        if (e.target === ov && origen === 'usuarios') {
          origen = null;
          setTimeout(function () { var u = fn('openUsersSheet'); if (u && !document.querySelector('#modal-layer .modal-sheet')) u(); }, 0);
        }
      });
    }
    try { if (window.PlayPay && typeof PlayPay.load === 'function') PlayPay.load().then(pintarPrecio).catch(function () {}); } catch (e) {}
  }

  /**
   * ARREGLO del "se abre y se cierra solo" en computadora.
   *
   * El robot, el botón de activar el menú y el de estadísticas abren esta
   * pantalla desde "pointerup". Justo después el navegador manda el
   * "click" de ese MISMO toque, y ese click aterriza ya encima de la
   * pantalla recién abierta: openModal lo entiende como "tocó afuera" y
   * la cierra en el mismo instante.
   *
   * Aquí se traga ese primer click (y nada más ese), antes de que llegue
   * a nadie. Un toque de verdad del usuario, posterior, pasa normal.
   */
  function traseProtegido() {
    var t0 = Date.now();
    function tragar(e) {
      document.removeEventListener('click', tragar, true);
      document.removeEventListener('pointerup', armar, true);
      if (Date.now() - t0 < 600 && e.target && e.target.id === 'modalOverlay') {
        e.stopPropagation();
        e.preventDefault();
      }
    }
    function armar() {}
    document.addEventListener('click', tragar, true);
    /* Si en 600 ms no llegó ningún click, se quita solo. */
    setTimeout(function () { document.removeEventListener('click', tragar, true); }, 650);
  }

  function cerrar() {
    limpiarPago();
    var vuelve = origen === 'usuarios';
    origen = null;
    vista = 'principal';
    if (vuelve) {
      /* La X (y Esc / atrás) regresan a la lista de Usuarios */
      var u = fn('openUsersSheet');
      if (u) { u(); return; }
    }
    var f = fn('closeModal');
    if (f) f();
  }

  function pintarPrecio() {
    var p = precioTxt();
    var c = document.querySelector('[data-vp-price]');
    if (c) c.innerHTML = '<small>Membresía Vendo Plus</small><b>' + esc(p) + '</b><span>por mes · Cancela cuando quieras</span>';
    var m = document.querySelector('[data-vp-monto]');
    if (m) m.textContent = String(p).replace(/\s*MXN\s*$/i, '');
  }

  /** El botón de pagar: usa EXACTAMENTE el cobro que ya tenías. */
  function pagar() {
    vibra(10);
    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    if (!esDueno) { avisar('Solo el Dueño puede activar Premium'); return; }

    var c = nube();
    /* web → pantalla de pago propia (aquí mismo) · Android → Google Play */
    if (c && c.sb && c.uid && !window.PlayPay) { abrirPago(); return; }
    if (c && typeof c.checkout === 'function') {
      var r = c.checkout();
      if (r && typeof r.then === 'function') r.then(listoPremium, function () {});
      return r;
    }
    var f = fn('confirmMembershipPay');      /* prototipo en el navegador, sin nube */
    if (f) { var x = f(); listoPremium(); return x; }
    avisar('No se pudo abrir el pago', { subtitle: 'Revisa tu internet e intenta de nuevo' });
  }

  /** Ya quedó pagado: se cierra la pantalla y todo aparece desbloqueado. */
  function listoPremium() {
    if (!activo()) return;
    if (document.querySelector('#modal-layer .vp-pr')) cerrar();
    pintarMascota();
    try { if (typeof window.render === 'function') window.render(); } catch (e) {}
  }

  /**
   * La puerta: si es Premium, deja pasar; si no, abre la pantalla.
   * @returns {boolean} true = puede seguir
   */
  function puerta(clave, accion) {
    if (activo()) { if (typeof accion === 'function') accion(); return true; }
    vibra(14);
    abrir(clave);
    return false;
  }

  /* =======================================================================
     5.  SE QUITA EL MES GRATIS Y EL BLOQUEO DE LA APP
  ======================================================================= */
  function soltarLaApp() {
    var c = window.Cloud;
    if (!c) return;

    /* La cuenta ya nunca se pausa: Vendo Plus es gratis. */
    c.hasAccess = function () { return true; };

    /* gate() lo llama Vendo Plus cada vez que cambia la membresía, así que
       aquí es el mejor lugar para repintar lo que se desbloquea. */
    var eraPremium = activo();
    c.gate = function () {
      var el = document.getElementById('paywall');
      if (el) {
        el.remove();
        try { if (window.VA && typeof VA.syncBars === 'function') VA.syncBars(); } catch (e) {}
      }
      var ahora = activo();
      if (ahora !== eraPremium) {
        eraPremium = ahora;
        if (ahora) listoPremium();
        pintarMascota();
      }
    };
    c.gate();

    /* Después de pagar (Stripe o Google Play) se repinta todo. */
    var _rs = c.refreshSub;
    if (typeof _rs === 'function' && !_rs.__vpPr) {
      var envuelto = async function () {
        var antes = activo();
        var r = await _rs.apply(this, arguments);
        if (!antes && activo()) {
          listoPremium();
          try { if (window.VPMascota && typeof VPMascota.revisar === 'function') VPMascota.revisar(); } catch (e) {}
          avisar('Premium activo', { subtitle: 'Menú Digital, chat con IA, escaneos sin límite y estadísticas detalladas', variant: 'toast-success', icon: ico('check'), duration: 4600 });
        }
        pintarMascota();
        return r;
      };
      envuelto.__vpPr = true;
      c.refreshSub = envuelto;
    }
  }

  /* La pantalla de "regalo de bienvenida" ya no existe: al terminar de
     registrarse se entra directo al negocio. */
  function quitarBienvenida() {
    var ir = fn('authGo');
    if (ir && !ir.__vpPr) {
      var envuelto = function (paso) {
        if (paso === 'trial') {
          var ok = fn('acceptTrialAndEnter');
          if (ok) return ok();
          var fa = fn('finishAuth');
          if (fa) return fa('¡Tu cuenta está lista!');
        }
        return ir.apply(this, arguments);
      };
      envuelto.__vpPr = true;
      try { window.authGo = envuelto; } catch (e) {}
      try { authGo = envuelto; } catch (e) {}
    }
  }

  /* =======================================================================
     6.  MI CUENTA · MEMBRESÍA (una sola línea, sin etiquetas ni candados)
  ======================================================================= */
  function fecha(iso) {
    try { return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  function tarjetaCuentaHTML() {
    estilos();
    var precio = precioTxt();

    if (activo()) {
      var c = nube(), s = (c && c.sub) || {};
      var hasta = s.vp_play_pagado_hasta || s.paid_until;
      var renueva = s.vp_play_renueva !== false;
      var sub = window.PlayPay && s.vp_play_pagado_hasta
        ? (renueva ? precio + ' al mes · se renueva sola con Google Play'
                   : 'Activa hasta el ' + fecha(hasta) + ' · ya no se renovará')
        : (hasta ? precio + ' al mes · activa hasta el ' + fecha(hasta) : precio + ' al mes · se renueva sola');
      return '<div class="section-title">Membresía</div>' +
        '<div class="vp-pr-cuenta">' +
          '<span class="vp-pr-cuenta-ico">' + ico('check') + '</span>' +
          '<span class="vp-pr-cuenta-txt"><b>Premium activo</b><span>' + esc(sub) + '</span></span>' +
        '</div>';
    }

    return '<div class="section-title">Membresía</div>' +
      '<div class="vp-pr-cuenta">' +
        '<span class="vp-pr-cuenta-txt"><b>Versión gratis</b>' +
        '<span>Lo que usas hoy seguirá siendo gratis.</span></span>' +
        '<button type="button" class="vp-pr-cuenta-btn" onclick="VPPremium.abrir()">Ver Premium' + ico('chevronRight') + '</button>' +
      '</div>';
  }

  function engancharCuenta() {
    var t = fn('trialWidgetHTML');
    if (t && !t.__vpPr) {
      var envuelto = function () { return tarjetaCuentaHTML(); };
      envuelto.__vpPr = true;
      try { window.trialWidgetHTML = envuelto; } catch (e) {}
      try { trialWidgetHTML = envuelto; } catch (e) {}
    }
    try { window.openMembershipPay = function () { abrir(); }; } catch (e) {}
    try { openMembershipPay = function () { abrir(); }; } catch (e) {}
  }

  /* =======================================================================
     7.  PUERTA 1 · MENÚ DIGITAL
     Se entra y se configura igual que siempre. La puerta está en el botón
     de ACTIVAR: ahí es donde aparece Premium.
  ======================================================================= */
  /* PORTADA DE UNA FUNCIÓN PREMIUM (igual que la de Comandas): imagen
     grande que cabe completa en la pantalla + botón para contratar.
     Horizontal en PC/tablet, vertical en celular. */
  function datosPortada(clave) {
    var im = window.VP_PROMOS_IMG || {};
    var P = {
    menu: { h: im['menu-h'], v: im['menu-v'], alt: 'VendoPlus Premium: tu menú en internet, recibe pedidos desde ahí',
            titulo: 'El Menú Digital viene incluido en Premium', sub: 'Tus clientes ven tu menú y te mandan su pedido.' },
    chat: { h: im['asistente-h'], v: im['asistente-v'], soloX: true,
            alt: 'VendoPlus Premium: tus ventas, en una pregunta, con el Asistente',
            titulo: 'El Asistente viene incluido en Premium', sub: 'Pregúntale cuánto vendiste, cuánto ganaste o qué se está agotando.' },
    stripe: { h: im['stripe-h'], v: im['stripe-v'], abrirCon: null,
            alt: 'VendoPlus Premium: cobra sin contacto con NFC y deja que tus clientes paguen con tarjeta en el menú digital',
            titulo: 'Cobros con tarjeta con Stripe vienen en Premium', sub: 'Cobra con NFC y recibe pagos con tarjeta en tu menú digital.' }
    };
    return P[clave] || null;
  }
  function cssPortada() {
    if (document.getElementById('vp-portada-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-portada-css';
    st.textContent = [
      '.vp-pt{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;',
      'background:rgba(13,20,40,.62);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);animation:vp-pt-in .2s ease both;}',
      '.vp-pt-card{position:relative;width:min(100%, 1400px);background:#fff;border-radius:22px;overflow:hidden;',
      'box-shadow:0 24px 60px rgba(10,16,34,.35);animation:vp-pt-up .28s cubic-bezier(.22,1,.36,1) both;}',
      '.vp-pt-img{display:block;width:100%;padding:0;border:0;background:#F3F5F9;cursor:pointer;line-height:0;}',
      '.vp-pt-img img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;-webkit-user-select:none;user-select:none;}',
      '.vp-pt-foot{display:flex;align-items:center;gap:16px;padding:14px 18px;min-height:50px;}',
      '.vp-pt-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.vp-pt-txt b{font-size:16px;font-weight:800;color:var(--ink,#16213E);}',
      '.vp-pt-txt small{font-size:13px;font-weight:600;color:var(--ink-soft,#6B7592);line-height:1.4;}',
      '.vp-pt-btn{flex:none;height:46px;padding:0 24px;border:0;border-radius:999px;background:var(--vp-green,#16C15B);color:#fff;',
      'font-family:inherit;font-size:15px;font-weight:800;cursor:pointer;white-space:nowrap;}',
      '.vp-pt-btn:active{transform:scale(.97);}',
      '.vp-pt-x{position:absolute;top:10px;right:10px;z-index:2;width:38px;height:38px;border:0;border-radius:50%;cursor:pointer;',
      'background:rgba(255,255,255,.92);color:#16213E;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.18);}',
      '.vp-pt-x svg{width:17px;height:17px;}',
      '@media (max-width:699px){',
      '.vp-pt{padding:12px;}',
      '.vp-pt-card{background:transparent;box-shadow:none;border-radius:20px;overflow:visible;}',
      '.vp-pt-x{top:10px;right:10px;}',
      '.vp-pt-img{border-radius:20px;overflow:hidden;}',
      '.vp-pt-img img{aspect-ratio:2/3;}',
      '.vp-pt-txt{display:none;}',
      '.vp-pt-foot{padding:12px 0 0;}',
      '.vp-pt-btn{width:100%;height:50px;font-size:16px;}',
      '}',
      '@keyframes vp-pt-in{from{opacity:0}to{opacity:1}}',
      '@keyframes vp-pt-up{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion: reduce){.vp-pt,.vp-pt-card{animation:none;}}'
    ].join('');
    document.head.appendChild(st);
  }
  try { window.addEventListener('resize', ajustarPortada); if (window.visualViewport) visualViewport.addEventListener('resize', ajustarPortada); } catch (e) {}
  function cerrarPortada() {
    var el = document.getElementById('vp-portada');
    if (el) el.remove();
    document.removeEventListener('keydown', teclaPortada, true);
  }
  function teclaPortada(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarPortada(); } }
  /* Tamaño de la ventana: se mide la pantalla visible (no hay zoom aquí) y
     la imagen crece hasta donde quepa completa con su botón abajo. */
  function ajustarPortada() {
    var el = document.getElementById('vp-portada');
    if (!el) return;
    var card = el.querySelector('.vp-pt-card');
    var cel = window.matchMedia && matchMedia('(max-width:699px)').matches;
    var vv = window.visualViewport;
    var vh = (vv && vv.height) || window.innerHeight;
    var vw = (vv && vv.width) || window.innerWidth;
    var pad = cel ? 12 : 16;
    var ratio = cel ? 2 / 3 : 16 / 9;
    var foot = card.querySelector('.vp-pt-foot');
    for (var i = 0; i < 2; i++) {
      var fh = foot ? foot.getBoundingClientRect().height : 0;
      var w = Math.min(vw - 2 * pad, (vh - 2 * pad - fh) * ratio, 1400);
      card.style.width = Math.max(200, Math.floor(w)) + 'px';
    }
  }
  function portada(clave) {
    /* Igual que Comandas: una pantalla normal de la app (encabezado y menú
       de abajo visibles), con la imagen ajustada y "Activar Premium" */
    if (clave === 'menu') { irMenuPortada(); return; }
    var p = datosPortada(clave);
    if (!p || !(p.h || p.v)) { abrir(clave); return; }
    if (!p.soloX) {
      try { if (window.VPComandas && VPComandas.portada && VPComandas.portada(clave)) return; } catch (e) {}
    }
    if (document.getElementById('vp-portada')) return;
    cssPortada();
    /* Se espera a que la imagen esté lista: así aparece completa de una vez */
    var cel = window.matchMedia && matchMedia('(max-width:699px)').matches;
    var src = (cel ? (p.v || p.h) : (p.h || p.v));
    var listo = false;
    var mostrar = function () {
      if (listo) return; listo = true;
      cerrarPortada();
      var el = document.createElement('div');
      el.id = 'vp-portada';
      el.className = 'vp-pt';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML =
        '<div class="vp-pt-card">' +
          '<button type="button" class="vp-pt-x" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
          '<button type="button" class="vp-pt-img vp-pt-go" aria-label="Ver Premium"><picture>' +
            (p.v ? '<source media="(max-width:699px)" srcset="' + esc(p.v) + '">' : '') +
            '<img src="' + esc(p.h || p.v) + '" alt="' + esc(p.alt || '') + '" decoding="sync" draggable="false">' +
          '</picture></button>' +
          '<div class="vp-pt-foot"><span class="vp-pt-txt"><b>' + esc(p.titulo) + '</b><small>' + esc(p.sub) + '</small></span>' +
          '<button type="button" class="vp-pt-btn vp-pt-go">Activar Premium</button></div>' +
        '</div>';
      document.body.appendChild(el);
      ajustarPortada();
      el.addEventListener('click', function (e) {
        if (e.target.closest('.vp-pt-x') || (!p.soloX && e.target === el)) { cerrarPortada(); return; }
        if (e.target.closest('.vp-pt-go')) { cerrarPortada(); abrir('abrirCon' in p ? p.abrirCon : clave); }
      });
      if (!p.soloX) document.addEventListener('keydown', teclaPortada, true);
    };
    var im = new Image();
    im.src = src;
    if (im.decode) im.decode().then(mostrar, mostrar); else { im.onload = mostrar; im.onerror = mostrar; }
    setTimeout(mostrar, 1500);
  }


  /* Sin Premium, la sección Menú Digital es directamente la portada (sin ×):
     no se puede configurar ni activar. */
  function irMenuPortada() {
    try { if (fn('closeModal')) ref('closeModal')(); } catch (e) {}
    try { if (ref('currentView') !== 'menu' && fn('goTo')) ref('goTo')('menu'); else if (fn('render')) ref('render')(); } catch (e) {}
  }
  function engancharMenu() {
    var rmd = fn('renderMenuDigital');
    if (rmd && !rmd.__vpPr) {
      var env0 = function () {
        if (!activo() && window.VPComandas && VPComandas.portadaHTML) return VPComandas.portadaHTML('menu');
        return rmd.apply(this, arguments);
      };
      env0.__vpPr = true;
      try { window.renderMenuDigital = env0; } catch (e) {}
      try { renderMenuDigital = env0; } catch (e) {}
    }
    var setup = fn('mdOpenSetup');
    if (setup && !setup.__vpPr) {
      var env1 = function () {
        if (!activo()) { irMenuPortada(); return; }
        return setup.apply(this, arguments);
      };
      env1.__vpPr = true;
      try { window.mdOpenSetup = env1; } catch (e) {}
      try { mdOpenSetup = env1; } catch (e) {}
    }
    var act = fn('mdActivate');
    if (act && !act.__vpPr) {
      var envuelto = function () {
        if (!activo()) { irMenuPortada(); return; }
        return act.apply(this, arguments);
      };
      envuelto.__vpPr = true;
      try { window.mdActivate = envuelto; } catch (e) {}
      try { mdActivate = envuelto; } catch (e) {}
    }

    /* Sin Premium el botón "Activar Menú Digital" nunca se queda apagado:
       siempre se puede tocar, y lo que aparece es la pantalla de Premium.
       Así nadie se queda atorado sin saber por qué no puede activarlo.
       (El botón vive dentro de mdConfigHTML, que es lo que pinta tanto la
       hoja de configuración inicial como la de "Configurar".) */
    var cfgh = fn('mdConfigHTML');
    if (cfgh && !cfgh.__vpPr) {
      var env2 = function () {
        var html = cfgh.apply(this, arguments);
        if (activo() || typeof html !== 'string') return html;
        return html.replace('onclick="mdActivate()" disabled', 'onclick="mdActivate()"');
      };
      env2.__vpPr = true;
      try { window.mdConfigHTML = env2; } catch (e) {}
      try { mdConfigHTML = env2; } catch (e) {}
    }
  }

  /* =======================================================================
     8.  PUERTA 2 · CHAT CON IA  (y el robot "inactivo")
  ======================================================================= */
  function engancharChat() {
    var M = window.VPMascota;
    if (!M || M.__vpPr) return false;

    var _abrir = M.abrir;
    M.abrir = function () {
      if (!activo()) { portada('chat'); return; }
      return _abrir.apply(this, arguments);
    };
    var _preg = M.preguntar;
    if (typeof _preg === 'function') {
      M.preguntar = function () {
        if (!activo()) { portada('chat'); return; }
        return _preg.apply(this, arguments);
      };
    }
    M.__vpPr = true;
    pintarMascota();
    return true;
  }

  /**
   * El robot SIN membresía tiene su propio look: no está dormido, está
   * APAGADO. Se le apaga la pantalla de la cara (ojos en gris, no verdes),
   * se queda quieto (ni flota ni parpadea) y se pone en gris frío. Se
   * distingue de un toque del dormido, que sigue verde y respirando.
   */
  function cssMascota() {
    if (document.getElementById('vp-premium-mascota-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-premium-mascota-css';
    st.textContent = [
      '#vp-mascota.vp-inactiva{filter:grayscale(.85) brightness(.99) drop-shadow(0 4px 12px rgba(30,36,44,.14));opacity:.88;}',
      '#vp-mascota.vp-inactiva .vp-m-flota{animation:none !important;}',
      '#vp-mascota.vp-inactiva .vp-brote{opacity:.45;}',
      '#vp-mascota.vp-inactiva .vp-ojos{fill:#949BA7 !important;stroke:#949BA7 !important;transform:scaleY(.38);opacity:.9;}',
      '#vp-mascota.vp-inactiva .vp-puntos{display:none;}',
      /* un punto verde chiquito que respira: "estoy aquí, pero apagado" */
      '#vp-mascota .vp-pr-punto{position:absolute;right:1px;bottom:7px;width:9px;height:9px;border-radius:50%;',
      'background:#25D366;border:2px solid #fff;display:none;box-shadow:0 1px 3px rgba(30,36,44,.28);}',
      '#vp-mascota.vp-inactiva .vp-pr-punto{display:block;animation:vp-pr-late 2.6s ease-in-out infinite;}',
      '#vp-mascota.vp-izquierda .vp-pr-punto{right:auto;left:1px;}',
      '@keyframes vp-pr-late{0%,100%{transform:scale(1);opacity:.75}50%{transform:scale(1.22);opacity:1}}',
      '#vp-mascota.vp-pr-toque{animation:vp-pr-no .4s ease;}',
      '@keyframes vp-pr-no{0%,100%{filter:grayscale(.85) brightness(.99)}',
      '30%,65%{filter:grayscale(.15) brightness(1.05)}}',
      '@media (prefers-reduced-motion: reduce){#vp-mascota.vp-inactiva .vp-pr-punto,#vp-mascota.vp-pr-toque{animation:none;}}'
    ].join('');
    document.head.appendChild(st);
  }

  function pintarMascota() {
    var n = document.getElementById('vp-mascota');
    if (!n) return;
    cssMascota();
    /* Si quedó un candado de una versión anterior, se quita. */
    var viejo = n.querySelector('.vp-pr-lock');
    if (viejo) viejo.remove();
    if (!n.querySelector('.vp-pr-punto')) {
      var s = document.createElement('span');
      s.className = 'vp-pr-punto';
      n.appendChild(s);
    }
    var off = !activo();
    n.classList.toggle('vp-inactiva', off);
    if (off) {
      n.classList.remove('vp-dormida', 'vp-parpadea', 'vp-saluda', 'vp-habla');
      n.dataset.gesto = 'normal';
      n.setAttribute('aria-label', 'Chat con IA · se activa con Premium');
      n.title = 'Chat con IA · se activa con Premium';
    } else {
      n.setAttribute('aria-label', 'Asistente de Vendo Plus');
      n.removeAttribute('title');
    }
  }

  /* =======================================================================
     9.  PUERTA 3 · ESTADÍSTICAS DETALLADAS
     El botón "Ver estadísticas detalladas" se queda EXACTAMENTE igual que
     siempre. Al tocarlo, sin Premium, aparece la pantalla de Premium.
     El contenido detallado ni siquiera se manda a la pantalla.
  ======================================================================= */
  function engancharStats() {
    /* Las estadísticas ya son gratis para todos (plan Básico incluido):
       no se envuelve nada. */
    return;
    var rs = fn('renderStats');
    if (rs && !rs.__vpPr) {
      var envuelto = function () {
        var html = rs.apply(this, arguments);
        if (activo() || typeof html !== 'string') return html;
        return "<h1 class=\"page-title\">Estadísticas</h1><p class=\"page-sub\">Conoce cómo va tu negocio</p><style>.vp-stats-lock{max-width:740px;margin:20px auto;background:var(--surface,#fff);border:1px solid var(--border,#e4e9ee);border-radius:var(--radius-card,20px);overflow:hidden;font-family:inherit;color:var(--ink)}.vp-stats-lock-art{height:132px;padding:24px 26px 0;background:var(--surface-alt,#f6f8fa);border-bottom:1px solid var(--border,#e4e9ee);position:relative;overflow:hidden}.vp-stats-lock-badge{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}.vp-stats-lock-badge>span{width:54px;height:54px;background:var(--surface,#fff);border:1px solid var(--border,#e4e9ee);border-radius:17px;display:flex;align-items:center;justify-content:center;color:var(--whatsapp,#16c15b);box-shadow:0 4px 16px #142b1d09}.vp-stats-lock-badge svg{width:25px;height:25px}.vp-stats-lock-copy{padding:26px;text-align:center}.vp-stats-lock-tag{display:inline-block;color:var(--vp-pr-verde,#16A34A);background:var(--vp-pr-suave,#E8F9EF);padding:5px 10px;border-radius:8px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}.vp-stats-lock-copy h2{font-size:20px;font-weight:800;line-height:1.3;margin:12px 0 8px;color:var(--ink)}.vp-stats-lock-copy p{font-size:14px;line-height:1.6;color:var(--ink-soft);max-width:400px;margin:0 auto 20px}.vp-stats-lock-copy .btn{font-family:inherit;min-height:44px;padding-left:24px;padding-right:24px}.vp-stats-lock-note{display:block;font-size:12px;color:var(--ink-soft);margin-top:13px}@media(max-width:480px){.vp-stats-lock{margin:14px 0}.vp-stats-lock-copy{padding:22px 18px}.vp-stats-lock-art{height:112px}.vp-stats-lock-copy .btn{width:100%}}</style><section class=\"vp-stats-lock\" aria-labelledby=\"vpStatsLockTitle\"><div class=\"vp-stats-lock-art\" aria-hidden=\"true\"><div class=\"vp-stats-lock-badge\"><span><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"5\" y=\"10\" width=\"14\" height=\"11\" rx=\"3\"/><path d=\"M8 10V7a4 4 0 0 1 8 0v3M12 14v3\"/></svg></span></div></div><div class=\"vp-stats-lock-copy\"><span class=\"vp-stats-lock-tag\">Función Premium</span><h2 id=\"vpStatsLockTitle\">Tu negocio, en números</h2><p>Consulta tus ventas, ganancias y gráficas.<br>Todas las estadísticas están incluidas en Premium.</p><button type=\"button\" class=\"btn primary\" onclick=\"VPPremium.abrir('stats')\">Contratar Premium</button><span class=\"vp-stats-lock-note\">Despliega el detalle cuando lo necesites.</span></div></section>";
      };
      envuelto.__vpPr = true;
      try { window.renderStats = envuelto; } catch (e) {}
      try { renderStats = envuelto; } catch (e) {}
    }

    var tg = fn('toggleStatsDetail');
    if (tg && !tg.__vpPr) {
      var env2 = function () {
        if (!activo()) {
          try { statsDetailOpen = false; } catch (e) {}
          abrir('stats');
          return;
        }
        return tg.apply(this, arguments);
      };
      env2.__vpPr = true;
      try { window.toggleStatsDetail = env2; } catch (e) {}
      try { toggleStatsDetail = env2; } catch (e) {}
    }
  }

  /* =======================================================================
     10. PUERTA 4 · ESCÁNER DE CARTA CON IA
     Gratis: 3 escaneos de prueba EN TOTAL, no por mes (los cuenta el servidor, así que no se
     reinician al cerrar sesión, cambiar de teléfono ni reinstalar).
     Premium: sin límite.
  ======================================================================= */
  var GRATIS_AL_MES = 3;
  var consumo = { restantes: null, pedido: 0 };

  function pedirConsumo() {
    var c = nube();
    if (!c || !c.sb || !c.uid) return Promise.resolve(null);
    if (Date.now() - consumo.pedido < 15000 && consumo.restantes != null) return Promise.resolve(consumo.restantes);
    consumo.pedido = Date.now();
    return c.sb.rpc('vp_ia_mi_consumo').then(function (r) {
      var d = r && r.data;
      if (!d || !d.ok) return consumo.restantes;
      if (d.gratis_mes != null) GRATIS_AL_MES = Number(d.gratis_mes) || GRATIS_AL_MES;
      /* "limite: null" o "premium: true" quieren decir SIN LÍMITE */
      if (d.premium === true || d.limite == null) consumo.restantes = Infinity;
      else if (d.restantes != null) consumo.restantes = Number(d.restantes);
      return consumo.restantes;
    }).catch(function () { return consumo.restantes; });
  }

  function restantes() { return activo() ? Infinity : consumo.restantes; }
  function fijarRestantes(n) {
    if (n == null) return;
    consumo.restantes = Number(n);
    /* Se le avisa también al escáner, para que su pantalla se pinte con
       el mismo número sin volver a preguntarle al servidor. */
    try { if (typeof window.vpIaFijarRestantes === 'function') window.vpIaFijarRestantes(consumo.restantes); } catch (e) {}
  }

  /**
   * "Ya usaste tus escaneos de prueba".
   * Antes era una pantalla aparte y se veía distinta a las demás. Ahora
   * es EXACTAMENTE la misma pantalla de pagar la membresía, nada más que
   * entra marcando la tarjeta del escáner.
   */
  function sinEscaneos() { abrir('escaner'); }

  function engancharEscaner() {
    var ab = window.vpIaAbrir;
    if (typeof ab !== 'function' || ab.__vpPr) return false;
    /* El escáner SIEMPRE abre, pague o no. Si ya no le quedan escaneos
       de prueba, la propia pantalla del escáner muestra los botones
       apagados y el aviso para pasarse a Premium (lo hace
       vendo-escaner-ia.js). Así nunca se le cierra la puerta en la cara a
       nadie, y el aviso se ve dentro de la pantalla que ya conoce. */
    var envuelto = function () {
      var self = this, args = arguments;
      if (!activo()) pedirConsumo();      /* se refresca el contador de fondo */
      return ab.apply(self, args);
    };
    envuelto.__vpPr = true;
    window.vpIaAbrir = envuelto;
    return true;
  }

  /* =======================================================================
     11. BOTÓN ATRÁS DE ANDROID
     Con la pantalla de Premium abierta, Atrás la cierra (y nada más).
  ======================================================================= */
  function engancharAtras() {
    var b = window.__vendoBack;
    if (typeof b !== 'function' || b.__vpPr) return;
    var envuelto = function () {
      if (document.querySelector('#modal-layer .vp-pr')) { atras(); return 'handled'; }
      /* Con el anuncio en pantalla, atrás no hace nada: solo la × lo cierra */
      var ad = document.querySelector('.vp-promo');
      if (ad && ad.style.display !== 'none') return 'handled';
      return b.apply(this, arguments);
    };
    envuelto.__vpPr = true;
    window.__vendoBack = envuelto;
  }

  /* =======================================================================
     12. ENCENDER
  ======================================================================= */
  /* =======================================================================
     10b. LÍMITE DE VENTAS DEL PLAN BÁSICO
     · Básico: 300 ventas completadas al mes por negocio. Premium: ilimitadas.
     · Cuenta = ventas del mes en curso que NO están canceladas y que no son
       devoluciones. Se cuentan las de todos los aparatos del negocio (las
       ventas se sincronizan con la nube).
     · A las 250 y cuando quedan 10 (290): aviso chiquito en Nueva venta,
       con "Ver Premium" y una × para cerrarlo.
     · Al llegar a 300: ese mismo día se puede seguir vendiendo. Desde el día
       siguiente se bloquean los cobros nuevos hasta que se confirme Premium
       o empiece el mes siguiente.
  ======================================================================= */
  var VENTAS_LIMITE = 300, VENTAS_AVISO = 250, VENTAS_ULTIMAS = 10;

  function diaLocal(d) {
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function mesLocal(d) { return diaLocal(d).slice(0, 7); }
  function primeroDelMesQueSigue() {
    var n = new Date(); return new Date(n.getFullYear(), n.getMonth() + 1, 1);
  }
  function fechaLarga(d) {
    try { return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }); } catch (e) { return diaLocal(d); }
  }

  /** Estado del límite este mes. */
  function ventasMes() {
    var mes = mesLocal(new Date()), fechas = [];
    try {
      var db = ref('DB'), lista = db && db.getSales ? db.getSales() : [];
      for (var i = 0; i < lista.length; i++) {
        var s = lista[i];
        if (!s || s.cancelled || s.type === 'devolucion' || !s.date) continue;
        var f = new Date(s.date);
        if (isNaN(f)) continue;
        if (mesLocal(f) === mes) fechas.push(f.getTime());
      }
    } catch (e) {}
    fechas.sort(function (a, b) { return a - b; });
    var n = fechas.length;
    var diaTope = n >= VENTAS_LIMITE ? diaLocal(new Date(fechas[VENTAS_LIMITE - 1])) : null;
    var premium = activo();
    return {
      n: n,
      premium: premium,
      restan: Math.max(VENTAS_LIMITE - n, 0),
      diaTope: diaTope,                                     /* el día que se llegó a 300 */
      gracia: !premium && !!diaTope && diaTope === diaLocal(new Date()),
      bloqueado: !premium && !!diaTope && diaLocal(new Date()) > diaTope
    };
  }

  function cssLimite() {
    if (document.getElementById('vp-limite-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-limite-css';
    st.textContent = [
      /* La pastilla vive DENTRO del título "Nueva venta", pegada a la derecha:
         no agrega renglones ni mueve nada del diseño. */
      'h1.page-title.vp-lim-h1{position:relative;}',
      '.vp-lim{position:absolute;right:0;top:50%;transform:translateY(-50%);z-index:60;}',   /* no ocupa lugar: cero movimiento */
      '.vp-lim-pill{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px 0 9px;border-radius:99px;',
      'border:1px solid var(--border,#E4E8EF);background:#fff;color:var(--ink-soft,#6C7480);font-family:inherit;font-size:12px;font-weight:500;letter-spacing:0;',
      'box-shadow:0 1px 2px rgba(16,22,42,.04);',
      'white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s ease;',
      'animation:vp-lim-in .35s cubic-bezier(.22,1,.36,1) both;}',
      '.vp-lim-pill:active{transform:scale(.96);}',
      /* Todo en blanco y gris: discreto, sin colores de alarma */
      '.vp-lim-pill i{width:6px;height:6px;border-radius:50%;background:#C3C8D1;flex:none;}',
      '.vp-lim-pill svg{width:12px;height:12px;flex:none;opacity:.8;}',
      '@keyframes vp-lim-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}',
      /* Tarjetita con el detalle (se abre al tocar la pastilla) */
      '.vp-lim-pop{position:absolute;right:0;top:calc(100% + 8px);z-index:40;width:min(300px,calc(100vw - 32px));',
      'background:#fff;border:1px solid var(--border,#E4E8EF);border-radius:16px;box-shadow:0 14px 34px rgba(16,22,42,.14);',
      'padding:14px 14px 12px;text-align:left;font-family:inherit;letter-spacing:0;',
      'opacity:0;visibility:hidden;transform:translateY(-4px) scale(.98);transform-origin:top right;',
      'transition:opacity .16s ease,transform .18s cubic-bezier(.22,1,.36,1),visibility 0s linear .18s;}',
      '.vp-lim.abierto .vp-lim-pop{opacity:1;visibility:visible;transform:none;transition:opacity .16s ease,transform .18s cubic-bezier(.22,1,.36,1);}',
      '.vp-lim-pop-top{display:flex;align-items:flex-start;gap:8px;}',
      '.vp-lim-pop-top b{flex:1;font-size:14px;font-weight:600;line-height:1.3;color:var(--ink,#15181C);}',
      '.vp-lim-x{flex:none;width:26px;height:26px;margin:-4px -4px 0 0;border:none;border-radius:8px;background:none;color:var(--ink-soft,#6C7480);',
      'display:flex;align-items:center;justify-content:center;cursor:pointer;}',
      '.vp-lim-x:active{background:var(--surface-alt,#F1F3F7);}',
      '.vp-lim-x svg{width:14px;height:14px;}',
      '.vp-lim-barra{height:6px;border-radius:99px;background:#EEF1F5;overflow:hidden;margin:10px 0 6px;}',
      '.vp-lim-barra span{display:block;height:100%;border-radius:99px;background:#9AA3B2;}',
      '.vp-lim-cuenta{display:flex;justify-content:space-between;font-size:11.5px;font-weight:500;color:var(--ink-soft,#6C7480);}',
      /* Va dentro del h1: se le quitan el interlineado y el peso del título */
      '.vp-lim-pop,.vp-lim-pop *{line-height:1.4;white-space:normal;letter-spacing:0;}',
      '.vp-lim-pop > span{display:block;}',
      '.vp-lim-pop .vp-lim-pop-top{display:flex;}',
      '.vp-lim-pop .vp-lim-cuenta{display:flex;}',
      '.vp-lim-txt{margin:10px 0 12px;font-size:13px;line-height:1.45 !important;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-lim-ver{width:100%;border:none;border-radius:11px;padding:10px;font-family:inherit;font-size:13.5px;font-weight:600;',
      'background:var(--vp-pr-verde-claro,#25D366);color:#fff;cursor:pointer;}',
      '.vp-lim-ver:active{transform:scale(.98);}',
      /* Hoja que sale al intentar cobrar ya bloqueado */
      '.vp-lim-hoja{text-align:center;padding:6px 4px 2px;}',
      '.vp-lim-ico{width:52px;height:52px;margin:4px auto 14px;border-radius:16px;background:#F1F3F7;color:var(--ink-soft,#6C7480);display:flex;align-items:center;justify-content:center;}',
      '.vp-lim-ico svg{width:24px;height:24px;}',
      '.vp-lim-hoja h2{margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-.3px;color:var(--ink,#15181C);}',
      '.vp-lim-hoja p{margin:0 auto 18px;max-width:340px;font-size:14px;line-height:1.5;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-lim-hoja .vp-pl-btn{margin-bottom:8px;}',
      '.vp-lim-hoja .vp-lim-no{width:100%;border:none;background:none;padding:10px;font-family:inherit;font-size:14px;font-weight:500;color:var(--ink-soft,#6C7480);cursor:pointer;}',
      '@media (max-width:359px){.vp-lim-pill{height:27px;padding:0 9px 0 8px;font-size:11px;}.vp-lim-pill svg{display:none;}}',
      '@media (prefers-reduced-motion: reduce){.vp-lim-pill,.vp-lim-pop{animation:none;transition:none;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* Qué aviso toca: 'aviso' (250+), 'ultimas' (quedan 10 o menos), 'tope' (llegó hoy), 'bloqueado' */
  function etapaLimite(e) {
    if (e.premium) return null;
    if (e.bloqueado) return 'bloqueado';
    if (e.gracia) return 'tope';
    if (e.n >= VENTAS_LIMITE - VENTAS_ULTIMAS) return 'ultimas';
    if (e.n >= VENTAS_AVISO) return 'aviso';
    return null;
  }
  function llaveCerrado(etapa) { return 'vp_lim_cerrado_' + mesLocal(new Date()) + '_' + etapa + (etapa === 'tope' ? '_' + diaLocal(new Date()) : ''); }
  function cerradoAviso(etapa) { try { return localStorage.getItem(llaveCerrado(etapa)) === '1'; } catch (e) { return false; } }

  /** La pastilla (y su tarjetita) que va dentro del título "Nueva venta". */
  function avisoLimiteHTML() {
    var e = ventasMes(), etapa = etapaLimite(e);
    if (!etapa || (etapa !== 'bloqueado' && cerradoAviso(etapa))) return '';
    cssLimite();
    var pill, titulo, texto;
    var vuelve = fechaLarga(primeroDelMesQueSigue());
    if (etapa === 'aviso') {
      pill = e.n + ' de ' + VENTAS_LIMITE + ' ventas';
      titulo = 'Llevas ' + e.n + ' de ' + VENTAS_LIMITE + ' ventas este mes';
      texto = 'El plan Básico incluye ' + VENTAS_LIMITE + ' ventas al mes. Con Premium vendes sin límite.';
    } else if (etapa === 'ultimas') {
      pill = (e.restan === 1 ? 'Queda 1 venta' : 'Quedan ' + e.restan + ' ventas');
      titulo = (e.restan === 1 ? 'Te queda 1 venta' : 'Te quedan ' + e.restan + ' ventas') + ' este mes';
      texto = 'Cuando llegues a ' + VENTAS_LIMITE + ' ventas, podrás seguir cobrando ese día. Al día siguiente, tus cobros se pausarán hasta que actives Premium o empiece el próximo mes.';
    } else if (etapa === 'tope') {
      pill = 'Límite de ventas';
      titulo = 'Llegaste a ' + VENTAS_LIMITE + ' ventas este mes';
      texto = 'Hoy puedes seguir cobrando normal. Desde mañana los cobros se pausan hasta el ' + vuelve + ', o actívalos ya con Premium.';
    } else {
      pill = 'Cobros en pausa';
      titulo = 'Cobros en pausa hasta el ' + vuelve;
      texto = 'Ya usaste las ' + VENTAS_LIMITE + ' ventas del plan Básico de este mes. Activa Premium para seguir cobrando sin límite.';
    }
    var pct = Math.min(100, Math.round(e.n / VENTAS_LIMITE * 100));
    var clase = etapa === 'aviso' ? '' : (etapa === 'ultimas' ? ' alto' : ' tope');
    return '<span class="vp-lim' + clase + '" id="vpLimAviso">' +
        '<button type="button" class="vp-lim-pill" aria-expanded="false" onclick="VPPremium.abrirAvisoVentas(event)">' +
          '<i aria-hidden="true"></i>' + esc(pill) + ico('chevronDown') +
        '</button>' +
        '<span class="vp-lim-pop" role="dialog" aria-label="Límite de ventas">' +
          '<span class="vp-lim-pop-top"><b>' + esc(titulo) + '</b>' +
            (etapa === 'bloqueado' ? '' :
              '<button type="button" class="vp-lim-x" aria-label="Ocultar aviso" onclick="VPPremium.cerrarAvisoVentas(\'' + etapa + '\', event)">' + ico('close') + '</button>') +
          '</span>' +
          '<span class="vp-lim-barra" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
          '<span class="vp-lim-cuenta"><span>' + Math.min(e.n, 9999) + ' ventas</span><span>Límite: ' + VENTAS_LIMITE + '</span></span>' +
          '<span class="vp-lim-txt">' + esc(texto) + '</span>' +
          '<button type="button" class="vp-lim-ver" onclick="VPPremium.abrir(\'ventas\')">Ver Premium</button>' +
        '</span>' +
      '</span>';
  }

  function abrirAvisoVentas(ev) {
    if (ev) ev.stopPropagation();
    var w = document.getElementById('vpLimAviso');
    if (!w) return;
    var abre = !w.classList.contains('abierto');
    w.classList.toggle('abierto', abre);
    var b = w.querySelector('.vp-lim-pill'); if (b) b.setAttribute('aria-expanded', abre ? 'true' : 'false');
    vibra(6);
    if (abre) {
      var fuera = function (e) {
        if (w.contains(e.target)) return;
        w.classList.remove('abierto');
        if (b) b.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', fuera, true);
      };
      setTimeout(function () { document.addEventListener('pointerdown', fuera, true); }, 0);
    }
  }

  function cerrarAvisoVentas(etapa, ev) {
    if (ev) ev.stopPropagation();
    try { localStorage.setItem(llaveCerrado(etapa), '1'); } catch (e) {}
    var el = document.getElementById('vpLimAviso');
    if (el) el.remove();
  }

  function hojaBloqueo() {
    cssLimite();
    estilosPlanes();
    var abrirModal = fn('openModal');
    var html = '<div class="vp-lim-hoja">' +
        '<div class="vp-lim-ico">' + ico('alert') + '</div>' +
        '<h2>Llegaste a tus ' + VENTAS_LIMITE + ' ventas del mes</h2>' +
        '<p>El plan Básico incluye ' + VENTAS_LIMITE + ' ventas al mes. Activa Premium para seguir cobrando sin límite, o vuelve a cobrar a partir del ' +
          fechaLarga(primeroDelMesQueSigue()) + '. Tu carrito se queda guardado.</p>' +
        '<button type="button" class="vp-pl-btn" onclick="VPPremium.abrir(\'ventas\')">Ver Premium</button>' +
        '<button type="button" class="vp-lim-no" onclick="closeModal()">Ahora no</button>' +
      '</div>';
    if (abrirModal) abrirModal(html, { dismissible: true });
    else avisar('Llegaste a tus ' + VENTAS_LIMITE + ' ventas del mes', { subtitle: 'Activa Premium para seguir cobrando', variant: 'toast-danger' });
  }

  function engancharLimite() {
    /* 1) Cobrar: se revisa justo antes de registrar la venta */
    var cobro = window.confirmarCobro;
    if (typeof cobro === 'function' && !cobro.__vpLim) {
      var envuelto = function () {
        if (ventasMes().bloqueado) { vibra(20); hojaBloqueo(); return; }
        var r = cobro.apply(this, arguments);
        /* Por si con esta venta se cruzó un aviso: se repinta Nueva venta */
        setTimeout(function () {
          var v = document.getElementById('view');
          if (v && v.dataset.v === 'sale' && etapaLimite(ventasMes()) && !document.getElementById('vpLimAviso')) {
            try { if (typeof window.render === 'function') window.render(); } catch (e) {}
          }
        }, 0);
        return r;
      };
      envuelto.__vpLim = true;
      try { window.confirmarCobro = envuelto; } catch (e) {}
    }
    /* 2) El aviso chiquito arriba de Nueva venta */
    var rs = window.renderSale;
    if (typeof rs === 'function' && !rs.__vpLim) {
      var env2 = function () {
        var html = rs.apply(this, arguments);
        if (typeof html !== 'string') return html;
        var aviso = '';
        try { aviso = avisoLimiteHTML(); } catch (e) {}
        if (!aviso) return html;
        /* Va dentro del título, a la derecha: no mueve nada del diseño */
        var t = '<h1 class="page-title">Nueva venta</h1>';
        if (html.indexOf(t) < 0) return html;
        return html.replace(t, '<h1 class="page-title vp-lim-h1">Nueva venta' + aviso + '</h1>');
      };
      env2.__vpLim = true;
      try { window.renderSale = env2; } catch (e) {}
    }
    return !!(window.confirmarCobro && window.confirmarCobro.__vpLim && window.renderSale && window.renderSale.__vpLim);
  }

  /* =======================================================================
     10c. ANUNCIO DIARIO DE PREMIUM (solo plan Básico)
     · Sale CADA VEZ que se entra a VendoPlus (abrir la app o la pestaña).
       NO sale al recargar la página: solo al salir y volver a entrar.
     · Nunca a Premium, nunca el día del registro (empieza al día siguiente).
     · Los anuncios se van turnando: uno y uno (nunca el mismo dos veces seguidas).
     · Imagen grande (no toda la pantalla), esquinas rectas, × arriba.
       Tocar la imagen abre los planes de Premium.
     Las imágenes van en la carpeta promos/ (ver promos/LEEME.txt).
  ======================================================================= */
  /* Cada anuncio trae DOS imágenes: la vertical (celular) y la horizontal
     (PC / pantalla acostada). Si falta una, se usa la otra.
       vertical:   1080 x 1620 px (2:3)
       horizontal: 1920 x 1080 px (16:9)                                   */
  var IMG = window.VP_PROMOS_IMG || {};     /* incrustadas en index.html */
  var PROMOS = [
    { vertical: IMG['asistente-v'], horizontal: IMG['asistente-h'] }   /* 1 · Asistente: "Tus ventas, en una pregunta" ($249 al mes) */
    , { vertical: IMG['menu-v'], horizontal: IMG['menu-h'] }           /* 2 · Menú digital: "Tu menú en internet" (49 al mes) */
    , { vertical: IMG['stripe-v'], horizontal: IMG['stripe-h'] }       /* 3 · Stripe: "Cobra sin contacto con NFC" ($249 al mes) */
    , { vertical: IMG['comandas-v'], horizontal: IMG['comandas-h'] }   /* 4 · Comandas: "Coordina caja, mesas y cocina desde el celular" ($249 al mes) */
  ].filter(function (p) { return p && (p.vertical || p.horizontal); });
  function esHorizontal() { return (window.innerWidth || 0) > (window.innerHeight || 0); }
  function srcPromo(p) {
    if (!p) return null;
    if (typeof p === 'string') return p;
    return (esHorizontal() ? (p.horizontal || p.vertical) : (p.vertical || p.horizontal)) || null;
  }

  function llaveUsuario() {
    var c = nube();
    if (c && c.uid) return String(c.uid);
    try { var u = fn('currentUser') ? ref('currentUser')() : null; if (u && (u.id || u.email)) return String(u.id || u.email); } catch (e) {}
    return 'local';
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /** Fecha de registro: la del perfil en la nube (o la del usuario local). */
  function diaRegistro() {
    var c = nube(), f = null;
    try { if (c && c.sub && c.sub.trial_start) f = c.sub.trial_start; } catch (e) {}
    if (!f) { try { var u = fn('currentUser') ? ref('currentUser')() : null; if (u) f = u.trialStart || u.createdAt; } catch (e) {} }
    if (!f) {
      /* Sin fecha: la primera vez que este aparato vio la cuenta cuenta como registro */
      var k = 'vp_promo_visto_' + llaveUsuario();
      f = lsGet(k);
      if (!f) { f = new Date().toISOString(); lsSet(k, f); }
    }
    var d = new Date(f);
    return isNaN(d) ? null : diaLocal(d);
  }

  /** ¿Ya se puede decidir? (sesión iniciada, app visible y estado de Premium ya cargado) */
  function promoListo() {
    var b = document.body;
    if (!b || b.classList.contains('auth-open') || b.classList.contains('dm-mode')) return false;
    if (document.querySelector('#modal-layer .modal-overlay, #confirm-layer > *, #scan-layer > *, .vp-promo')) return false;
    var v = document.getElementById('view');
    if (!v || !v.dataset.v) return false;
    var c = nube();
    if (c) {
      if (!c.uid) return false;
      /* Mientras llega el estado de la membresía se usa el último conocido
         de esta cuenta (guardado en el aparato): así el anuncio sale al
         instante. Si al llegar resulta que sí es Premium, se quita solo. */
      if (!c.sub && !estadoGuardado()) return false;
    }
    return true;
  }
  function llaveEstado() { return 'vp_promo_estado_' + llaveUsuario(); }
  function estadoGuardado() { try { return JSON.parse(lsGet(llaveEstado()) || 'null'); } catch (e) { return null; } }
  function guardarEstado() {
    var c = nube();
    if (!c || !c.sub) return;
    var reg = null; try { reg = c.sub.trial_start ? diaLocal(new Date(c.sub.trial_start)) : null; } catch (e) {}
    lsSet(llaveEstado(), JSON.stringify({ premium: activo(), reg: reg }));
  }
  function esPremiumAhora() {
    var c = nube();
    if (c && !c.sub) { var g = estadoGuardado(); return !!(g && g.premium); }
    return activo();
  }

  function cssPromo() {
    if (document.getElementById('vp-promo-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-promo-css';
    st.textContent = [
      /* Sin oscurecer el fondo. La capa sí atrapa los toques, para que no se
         pique nada de atrás por accidente: solo se cierra con la ×. */
      '.vp-promo{position:fixed;inset:0;z-index:650;display:flex;align-items:center;justify-content:center;background:transparent;',
      'padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));}',
      /* La caja SIEMPRE cabe en la pantalla, y la × va adentro de la caja:
         así nunca queda fuera de la vista en ningún tamaño. */
      '.vp-promo-caja{position:relative;display:block;line-height:0;background:#fff;border-radius:0;overflow:hidden;',
      'min-width:min(240px,100%);min-height:160px;',
      'max-width:100%;max-height:100%;box-shadow:0 18px 50px rgba(16,22,42,.28),0 0 0 1px rgba(16,22,42,.06);',
      'animation:vp-promo-entra .42s cubic-bezier(.22,1,.36,1) both;}',
      '.vp-promo-img{display:block;border-radius:0;cursor:pointer;object-fit:contain;',
      'max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);width:auto;height:auto;}',
      /* Vertical (celular): alta. Horizontal (PC): ancha, sin llenar todo */
      '.vp-promo.v .vp-promo-img{max-height:min(88dvh,calc(100dvh - 32px));}',
      '.vp-promo.h .vp-promo-img{max-width:min(1100px,88vw);max-height:min(82dvh,calc(100dvh - 32px));}',
      /* Vista previa sin imagen: recuadro con la medida que toca */
      '.vp-promo-vacio{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px;',
      'background:linear-gradient(160deg,#0A2368,#01164F);color:#fff;font-family:inherit;line-height:1.4;cursor:pointer;}',
      '.vp-promo.v .vp-promo-vacio{width:min(440px,calc(100vw - 32px),calc((100dvh - 32px) * 2 / 3));aspect-ratio:2/3;}',
      '.vp-promo.h .vp-promo-vacio{width:min(1100px,88vw,calc((100dvh - 32px) * 16 / 9));aspect-ratio:16/9;}',
      '.vp-promo-vacio b{font-size:22px;font-weight:700;letter-spacing:-.3px;}',
      '.vp-promo-vacio span{font-size:13px;font-weight:400;opacity:.75;max-width:280px;}',
      '.vp-promo-x{position:absolute;top:10px;right:10px;z-index:2;width:38px;height:38px;border:none;border-radius:50%;',
      'background:rgba(255,255,255,.94);color:#15181C;display:flex;align-items:center;justify-content:center;cursor:pointer;',
      'box-shadow:0 2px 10px rgba(0,0,0,.22);-webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
      '.vp-promo-x:active{transform:scale(.92);}',
      '.vp-promo-x svg{width:17px;height:17px;}',
      '.vp-promo.sale .vp-promo-caja{animation:vp-promo-sale .22s ease-in both;}',
      '@keyframes vp-promo-entra{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}',
      '@keyframes vp-promo-sale{from{opacity:1;transform:none}to{opacity:0;transform:scale(.96)}}',
      '@media (prefers-reduced-motion: reduce){.vp-promo-caja,.vp-promo.sale .vp-promo-caja{animation:none;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /** Se turnan en orden: 1, 2, 1, 2… (con más anuncios: 1, 2, 3, 1…) */
  function elegirPromo() {
    if (!PROMOS.length) return -1;
    var k = 'vp_promo_ultima_' + llaveUsuario();
    var ultima = parseInt(lsGet(k), 10);
    var sig = isNaN(ultima) ? Math.floor(Math.random() * PROMOS.length) : (ultima + 1) % PROMOS.length;
    lsSet(k, String(sig));
    return sig;
  }

  /* ¿Es una entrada nueva? sessionStorage sobrevive a recargar la página,
     pero se borra al cerrar la pestaña o la app. Así el anuncio sale al
     volver a entrar y no cada vez que se recarga. */
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function esRecarga() {
    try {
      var n = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (n) return n.type === 'reload';
      return performance.navigation && performance.navigation.type === 1;
    } catch (e) { return false; }
  }

  /* El anuncio sale hasta que su imagen ya está bajada y lista para pintarse:
     aparece completo de un jalón, nunca a medias ni en blanco. Si la imagen
     no llega (sin internet, muy lenta), esta vez no sale y no estorba. */
  function mostrarPromo(promo) {
    var src = srcPromo(promo);
    if (!src) { mostrarPromoYa(promo); return; }
    var pre = new Image(), hecho = false;
    function ir() {
      if (hecho) return; hecho = true;
      if (document.querySelector('.vp-promo')) return;
      mostrarPromoYa(promo);
      vigilarPremium();
    }
    function nada() { hecho = true; }
    pre.decoding = 'async';
    try { pre.fetchPriority = 'high'; } catch (e) {}
    pre.onload = function () {
      if (pre.decode) pre.decode().then(ir, ir); else ir();
    };
    pre.onerror = nada;
    pre.src = src;
    setTimeout(nada, 9000);
  }

  function mostrarPromoYa(promo) {
    cssPromo();
    var horizontal = esHorizontal();
    var src = srcPromo(promo);
    var cont = document.createElement('div');
    cont.className = 'vp-promo ' + (horizontal ? 'h' : 'v');
    cont.setAttribute('role', 'dialog');
    cont.setAttribute('aria-modal', 'true');
    cont.setAttribute('aria-label', 'VendoPlus Premium');
    cont.innerHTML = '<div class="vp-promo-caja">' +
        (src
          ? '<img class="vp-promo-img" src="' + esc(src) + '" alt="VendoPlus Premium" decoding="async">'
          : '<div class="vp-promo-vacio"><b>Aquí va tu imagen</b><span>Imagen promocional de VendoPlus Premium · ' +
            (horizontal ? 'horizontal 1920 × 1080 px' : 'vertical 1080 × 1620 px') + '</span></div>') +
        '<button type="button" class="vp-promo-x" aria-label="Cerrar anuncio">' + ico('close') + '</button>' +
      '</div>';
    /* Botón de ATRÁS (navegador, gesto o botón del celular): mientras el
       anuncio exista, atrás nunca saca de la página. En los planes o el pago
       da un paso atrás (pago → planes → anuncio); en el anuncio no hace nada.
       Solo la × lo cierra. En la app de Android lo maneja __vendoBack. */
    var conHist = false;
    function enAtras() {
      if (!document.body.contains(cont)) { soltarHist(); return; }
      if (document.querySelector('#modal-layer .modal-overlay:not(.is-closing) .vp-pr')) atras();
      try { history.pushState({ vpPromo: 1 }, ''); } catch (e) {}
    }
    function soltarHist() {
      if (!conHist) return;
      conHist = false;
      window.removeEventListener('popstate', enAtras);
      try { if (history.state && history.state.vpPromo) history.back(); } catch (e) {}
    }
    if (typeof window.__vendoBack !== 'function' && window.history && history.pushState) {
      try { history.pushState({ vpPromo: 1 }, ''); conHist = true; window.addEventListener('popstate', enAtras); } catch (e) {}
    }
    cont.__vpSoltar = soltarHist;

    function cerrarPromo() {
      if (cont.classList.contains('sale')) return;
      cont.classList.add('sale');
      soltarHist();
      setTimeout(function () { cont.remove(); }, 230);
    }
    /* Solo la × cierra. Tocar fuera no hace nada (ni pica lo de atrás). */
    cont.querySelector('.vp-promo-x').addEventListener('click', function (e) { e.stopPropagation(); vibra(6); cerrarPromo(); });
    cont.addEventListener('click', function (e) { e.stopPropagation(); });
    /* Tocar el anuncio abre "Elige tu plan". El anuncio se esconde (no se
       cierra): si la persona sale de los planes o del pago SIN contratar
       (×, atrás, Esc, tocar fuera), regresa al anuncio. Solo la × del
       anuncio lo quita. Si contrata, el anuncio ya no vuelve. */
    var pieza = cont.querySelector('.vp-promo-img, .vp-promo-vacio');
    pieza.addEventListener('click', function () {
      if (cont.classList.contains('sale')) return;
      vibra(8);
      cont.style.display = 'none';
      abrir('promo');
      var visto = false, t0 = Date.now();
      var vigila = setInterval(function () {
        var abierta = !!document.querySelector('#modal-layer .modal-overlay:not(.is-closing) .vp-pr');
        if (abierta) { visto = true; return; }
        if (!visto && Date.now() - t0 < 1500) return;       /* todavía no termina de abrir */
        if (document.querySelector('#modal-layer .modal-overlay.is-closing')) return;   /* esperando su animación */
        clearInterval(vigila);
        if (activo()) { soltarHist(); cont.remove(); return; }   /* ya es Premium: listo */
        cont.style.display = '';
        var caja = cont.querySelector('.vp-promo-caja');
        if (caja) { caja.style.animation = 'none'; void caja.offsetWidth; caja.style.animation = ''; }
      }, 150);
    });
    var img = cont.querySelector('.vp-promo-img');
    /* Si la imagen no carga, el anuncio se quita solo: nadie se queda trabado */
    if (img) img.addEventListener('error', function () { cont.remove(); });
    document.body.appendChild(cont);
  }

  /** Revisa si hoy toca anuncio. Se llama al abrir y al volver a la app. */
  function revisarPromo() {
    if (!promoListo()) return false;
    guardarEstado();
    if (esPremiumAhora()) return true;                   /* Premium: nunca */
    var kSes = 'vp_promo_entrada_' + llaveUsuario();
    var nueva = entradaNueva;                            /* acaba de iniciar sesión */
    entradaNueva = false;
    if (!nueva) {
      if (ssGet(kSes)) return true;                      /* ya salió en esta entrada */
      if (esRecarga()) { ssSet(kSes, '1'); return true; }   /* recargó la página: no */
    }
    ssSet(kSes, '1');
    var c0 = nube(), g0 = estadoGuardado();
    var reg = (c0 && !c0.sub && g0) ? g0.reg : diaRegistro();
    if (!reg || reg === diaLocal(new Date())) return true;   /* el día del registro no */
    if (!PROMOS.length) return true;                     /* todavía no hay imágenes */
    var i = elegirPromo();
    if (i < 0) return true;
    mostrarPromo(PROMOS[i]);                             /* vigilarPremium() va adentro, al salir */
    return true;
  }

  /* Si se mostró con el estado guardado, al llegar el real se confirma:
     si resultó Premium (pagó en otro aparato, por ejemplo), se quita. */
  function vigilarPremium() {
    var n = 0;
    var t = setInterval(function () {
      var c = nube(), ad = document.querySelector('.vp-promo');
      if (!ad || ++n > 200) { clearInterval(t); return; }
      if (c && c.sub) {
        clearInterval(t);
        guardarEstado();
        if (activo()) { if (ad.__vpSoltar) ad.__vpSoltar(); ad.remove(); }
      }
    }, 150);
  }

  var promoTimer = null;
  var entradaNueva = false;
  /* Iniciar sesión (o crear cuenta) cuenta como "entrar": se vuelve a revisar */
  function engancharEntrada() {
    var f = window.finishAuth;
    if (typeof f !== 'function' || f.__vpPromo) return;
    var env = function () {
      var r = f.apply(this, arguments);
      entradaNueva = true;
      arrancarPromo();
      return r;
    };
    env.__vpPromo = true;
    try { window.finishAuth = env; } catch (e) {}
  }
  function arrancarPromo() {
    /* Vista previa: vendoplusoficial.com/?promo=prueba (no cuenta como el del día) */
    if (/[?&]promo=prueba\b/.test(location.search)) {
      var t0 = Date.now();
      var tv = setInterval(function () {
        if (document.getElementById('view') && document.getElementById('view').dataset.v && !document.body.classList.contains('auth-open') || Date.now() - t0 > 8000) {
          clearInterval(tv);
          var i = PROMOS.length ? Math.floor(Math.random() * PROMOS.length) : -1;
          mostrarPromo(i >= 0 ? PROMOS[i] : null);
        }
      }, 100);
      return;
    }
    var n = 0;
    clearInterval(promoTimer);
    if (revisarPromo()) return;                          /* al instante si ya se puede */
    promoTimer = setInterval(function () {
      /* Se revisa seguido (cada 100 ms) hasta ~2 min a que la sesión esté lista */
      if (revisarPromo() || ++n > 1200) clearInterval(promoTimer);
    }, 100);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') arrancarPromo();   /* por si cambió el día con la app abierta */
  });

  function engancharTodo() {
    soltarLaApp();
    quitarBienvenida();
    engancharCuenta();
    engancharMenu();
    engancharStats();
    engancharAtras();
    var a = engancharChat();
    var b = engancharEscaner();
    var c = engancharLimite();
    pintarMascota();
    return a && b && c;
  }

  function arrancar() {
    ocultarPremium();
    arrancarPromo();
    engancharEntrada();
    estilos();
    registrarFunciones();
    /* La tecla Esc cierra la pantalla de Premium (computadora) */
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.querySelector('#modal-layer .vp-pr')) {
        /* En fase de captura y sin dejar pasar la tecla: si no, el cierre
           general de la app la gana y no se alcanza a regresar a Usuarios. */
        e.stopImmediatePropagation();
        atras();
      }
    }, true);
    if (engancharTodo()) return;
    var n = 0;
    var t = setInterval(function () {
      if (engancharTodo() || ++n > 240) clearInterval(t);   /* hasta 2 min */
    }, 500);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') pintarMascota();
    });
  }

  /* =======================================================================
     12b. SECCIÓN "FUNCIONES PREMIUM"
     Se abre desde el menú de las 3 rayitas (celular) o desde el menú lateral
     (tablet / PC). Muestra todas las funciones Premium en tarjetas de
     2 columnas: imagen arriba, nombre y una descripción corta.
  ======================================================================= */
  var CORONA_ICONO = 'img/premium-corona-icono.webp?v=1';
  /* Las fotos de las tarjetas. Van aquí adentro, en WebP y en el mismo
     archivo, para que la web y la app siempre las tengan: no hay imágenes
     sueltas que se puedan quedar sin subir. Todas miden 1585x992, o sea
     16:10 exacto, y así se ven completas y sin deformarse en cualquier
     pantalla (el CSS usa aspect-ratio 16/10 con object-fit:cover). */
  var FOTOS = {
    menu: 'img/premium-menu.webp?v=1',
    chat: 'img/premium-chat.webp?v=1',
    escaner: 'img/premium-escaner.webp?v=1',
    stats: 'img/premium-stats.webp?v=1',
    usuarios: 'img/premium-usuarios.webp?v=1'
  };
  var ALT_FOTO = {
    menu: 'Catálogo del menú digital en un celular',
    chat: 'El asistente respondiendo cuánto se vendió hoy',
    escaner: 'Una foto de la carta convertida en productos',
    stats: 'Gráfica de ventas y ganancias de la semana',
    usuarios: 'Lista de usuarios del negocio con sus permisos'
  };
  var IMAGENES = {};
  (function () {
    for (var k in FOTOS) {
      if (!Object.prototype.hasOwnProperty.call(FOTOS, k)) continue;
      IMAGENES[k] = '<img class="vp-prf-foto" src="' + FOTOS[k] + '" alt="' +
        esc(ALT_FOTO[k] || '') + '" loading="lazy" decoding="async" draggable="false">';
    }
  })();
  var DESC_CORTA = {
    menu: 'Tus clientes ven tu menú y hacen su pedido desde el celular. Tú lo recibes en VendoPlus.',
    chat: 'Pregúntale a la IA cuánto vendiste, cuánto ganaste o qué productos se están agotando.',
    escaner: 'Toma una foto de tu carta y la IA carga los productos y precios por ti.',
    stats: 'Consulta cuánto vendes, cuánto ganas y cuáles son tus productos más vendidos.',
    usuarios: 'Cada empleado entra con su propio NIP y solo puede usar las funciones que le permitas.'
  };
  /* Esta lista es la de la pantalla "Funciones premium". */
  var ORDEN_SECCION = ['menu', 'chat', 'escaner', 'usuarios'];

  var cssFuncPuesto = false;
  function estilosFunciones() {
    if (cssFuncPuesto || document.getElementById('vp-prf-css')) { cssFuncPuesto = true; return; }
    cssFuncPuesto = true;
    var st = document.createElement('style');
    st.id = 'vp-prf-css';
    st.textContent = [
      '.vp-crown-ico{width:26px;height:26px;object-fit:contain;display:block;flex:none;}',
      '.vp-sheet button img.vp-crown-ico{width:26px;height:26px;margin:-2px 0 -2px 0;}',
      '.navbtn .navicon img.vp-crown-ico{width:100%;height:100%;max-width:30px;max-height:30px;margin:auto;}',
      '.vp-pr-v2 .vp-prm-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:2px 2px 10px;margin-bottom:6px;}',
      '@keyframes vp-prf-entra{from{transform:translateY(54px);opacity:0}to{transform:none;opacity:1}}',
      '.vp-pr-v2 .vp-prf-card{animation:vp-prf-entra .6s cubic-bezier(.22,1,.36,1) backwards;}',
      '.vp-pr-v2 .vp-prf-card:nth-child(1),.vp-pr-v2 .vp-prf-card:nth-child(2){animation-delay:.15s}',
      '.vp-pr-v2 .vp-prf-card:nth-child(3),.vp-pr-v2 .vp-prf-card:nth-child(4){animation-delay:.29s}',
      '.vp-pr-v2 .vp-prf-card:nth-child(5),.vp-pr-v2 .vp-prf-card:nth-child(6){animation-delay:.43s}',
      '@media (prefers-reduced-motion: reduce){.vp-pr-v2 .vp-prf-card{animation:none;}}',
      '@media (min-width:700px){.vp-pr-v2{max-height:calc(100vh - 120px);max-height:calc(100dvh - 120px);}.vp-pr-v2 .vp-prf-grid{gap:12px;}}',
      '.vp-prf{max-width:900px;margin:0 auto;}',
      '.vp-prf-banner{display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface);',
      'padding:12px 14px;margin:0 0 16px;box-shadow:var(--shadow-card);}',
      '.vp-prf-banner img{width:38px;height:38px;object-fit:contain;flex:none;}',
      '.vp-prf-banner-txt{flex:1;min-width:0;}',
      '.vp-prf-banner-txt b{display:block;font-size:14.5px;font-weight:800;color:var(--ink);}',
      '.vp-prf-banner-txt span{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-top:2px;line-height:1.35;}',
      '.vp-prf-banner button{flex:none;border:none;cursor:pointer;border-radius:10px;padding:9px 13px;font-family:inherit;font-size:13px;font-weight:800;',
      'color:#fff;background:var(--vp-green,#16C15B);-webkit-tap-highlight-color:transparent;white-space:nowrap;}',
      '.vp-prf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}',
      '@media (min-width:700px){.vp-prf-grid{gap:16px;}}',
      '.vp-prf-card{display:flex;flex-direction:column;text-align:left;width:100%;padding:0;overflow:hidden;cursor:pointer;font-family:inherit;color:inherit;',
      'background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-card);',
      '-webkit-tap-highlight-color:transparent;transition:transform .15s ease,box-shadow .15s ease;}',
      '.vp-prf-card:active{transform:scale(.98);}',
      '@media (hover:hover){.vp-prf-card:hover{box-shadow:0 8px 22px rgba(22,33,62,.12);transform:translateY(-1px);}}',
      /* La caja de la foto SIEMPRE guarda 16:10, que es justo la medida de
         las fotos: así nunca se estiran ni se recortan, en el celular, en la
         tablet o en la computadora. */
      '.vp-prf-img{display:block;width:100%;aspect-ratio:16/10;background:#E0FAF0;line-height:0;overflow:hidden;}',
      '.vp-prf-img svg{display:block;width:100%;height:100%;}',
      '.vp-prf-img img.vp-prf-foto{display:block;width:100%;height:100%;object-fit:cover;object-position:center;',
      'background:#E0FAF0;-webkit-user-select:none;user-select:none;pointer-events:none;}',
      '.vp-prf-body{display:flex;flex-direction:column;gap:4px;padding:11px 12px 14px;}',
      '.vp-prf-body b{font-size:14.5px;font-weight:800;color:var(--ink);line-height:1.2;}',
      '.vp-prf-body span{font-size:12.5px;font-weight:500;color:var(--ink-soft);line-height:1.4;}',
      '@media (prefers-reduced-motion: reduce){.vp-prf-card{transition:none;}}'
    ].join('');
    document.head.appendChild(st);
  }

  function tarjetasImagenHTML() {
    return ORDEN_SECCION.map(function (k) {
      var f = FUNCIONES[k];
      return '<button type="button" class="vp-prf-card" onclick="VPPremium.irA(\'' + k + '\')">' +
        '<span class="vp-prf-img">' + IMAGENES[k] + '</span>' +
        '<span class="vp-prf-body"><b>' + esc(f.titulo) + '</b><span>' + esc(DESC_CORTA[k]) + '</span></span>' +
      '</button>';
    }).join('');
  }
  function pieActivoHTML() {
    return '';
  }
  /** "Funciones premium": la misma pantalla de "Todo lo que incluye Premium". */
  function funciones() { if (PREMIUM_OCULTO) return; abrir(null, 'mas'); }   /* la pantalla de la corona */

  function funcionesVista() {
    estilosFunciones();
    var atras = fn('subViewBackHTML');
    var cab = (atras ? atras() : '') +
      '<h1 class="page-title">Funciones premium</h1>' +
      '<p class="page-sub">Todo lo que desbloqueas con Premium. Toca una función para abrirla.</p>';
    var banner;
    if (activo()) {
      banner = '<div class="vp-prf-banner"><img src="' + CORONA + '" alt="">' +
        '<div class="vp-prf-banner-txt"><b>Premium activo</b><span>Ya tienes todas estas funciones disponibles.</span></div></div>';
    } else {
      banner = '<div class="vp-prf-banner"><img src="' + CORONA + '" alt="">' +
        '<div class="vp-prf-banner-txt"><b>' + esc(precioTxt()) + ' al mes</b><span>Cancela cuando quieras</span></div>' +
        '<button type="button" onclick="VPPremium.abrir()">Contratar</button></div>';
    }
    var tarjetas = ORDEN_SECCION.map(function (k) {
      var f = FUNCIONES[k];
      return '<button type="button" class="vp-prf-card" onclick="VPPremium.irA(\'' + k + '\')">' +
        '<span class="vp-prf-img">' + IMAGENES[k] + '</span>' +
        '<span class="vp-prf-body"><b>' + esc(f.titulo) + '</b><span>' + esc(DESC_CORTA[k]) + '</span></span>' +
      '</button>';
    }).join('');
    return '<div class="vp-prf">' + cab + banner + '<div class="vp-prf-grid">' + tarjetas + '</div></div>';
  }

  /* =======================================================================
     12-bis.  ATAJO "ESCANEAR CARTA" · SIEMPRE DESDE PRODUCTOS
     Antes la tarjeta abría el escáner encima de la pantalla en la que
     estuvieras. Ahora SIEMPRE: primero Productos, y hasta que Productos
     quede pintado de verdad se abre el MISMO escáner de siempre
     (window.vpIaAbrir). No hay retrasos fijos: se revisa cuadro por cuadro,
     así que en un celular lento espera lo que tenga que esperar y en uno
     rápido abre al instante.
  ======================================================================= */

  /* Candado: dos toques seguidos no abren el escáner dos veces. */
  var abriendoEscaner = false;

  /** ¿Productos ya quedó pintado? render() deja la marca data-v en #view. */
  function productosListo() {
    var v = document.getElementById('view');
    if (!v) return false;
    if (v.getAttribute('data-v') !== 'products') return false;
    return v.childNodes.length > 0;          /* pintado de verdad, no vacío */
  }

  /** Espera a que Productos esté listo, cuadro por cuadro (sin retrasos fijos). */
  function cuandoProductosListo(accion) {
    var vueltas = 0;
    (function revisar() {
      if (productosListo()) { accion(); return; }
      /* Tope de seguridad (~4 s): pase lo que pase nunca se queda atorado. */
      if (++vueltas > 240) { accion(); return; }
      if (window.requestAnimationFrame) window.requestAnimationFrame(revisar);
      else setTimeout(revisar, 16);
    })();
  }

  /** Los ids de los productos que hay ahorita (para saber cuáles son nuevos). */
  function idsProductos() {
    try {
      var db = ref('DB');
      var lista = (db && typeof db.getProducts === 'function') ? db.getProducts() : [];
      var ids = [];
      for (var i = 0; i < (lista || []).length; i++) if (lista[i]) ids.push(lista[i].id);
      return ids;
    } catch (e) { return []; }
  }

  /* El resaltado temporal de los productos nuevos. Es un brillo que se va
     solo: no cambia el diseño de la lista ni deja nada pegado. */
  function estiloNuevos() {
    if (document.getElementById('vp-pr-nuevo-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-pr-nuevo-css';
    st.textContent = [
      '@keyframes vp-pr-nuevo{0%{background:rgba(37,211,102,.20)}100%{background:transparent}}',
      '.prod-row.vp-nuevo{animation:vp-pr-nuevo 2.4s ease-out 1;border-radius:14px;}',
      '@media (prefers-reduced-motion: reduce){.prod-row.vp-nuevo{animation:none;}}'
    ].join('');
    document.head.appendChild(st);
  }

  /** Deja a la vista (y marca un momento) los productos recién agregados. */
  function marcarNuevos(antes) {
    try {
      var db = ref('DB');
      var lista = (db && typeof db.getProducts === 'function') ? db.getProducts() : [];
      var nombres = [];
      for (var i = 0; i < (lista || []).length; i++) {
        var p = lista[i];
        if (p && antes.indexOf(p.id) < 0) nombres.push(String(p.name || '').trim());
      }
      if (!nombres.length) return;              /* no se agregó nada: nada que marcar */
      estiloNuevos();
      var filas = document.querySelectorAll('#view .prod-row');
      var primera = null;
      for (var j = 0; j < filas.length; j++) {
        var n = filas[j].querySelector('.pr-name');
        if (!n || nombres.indexOf(n.textContent.trim()) < 0) continue;
        filas[j].classList.add('vp-nuevo');
        if (!primera) primera = filas[j];
      }
      if (primera && primera.scrollIntoView) {
        var suave = true;
        try { suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
        primera.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'center' });
      }
      setTimeout(function () {
        var m = document.querySelectorAll('#view .prod-row.vp-nuevo');
        for (var k = 0; k < m.length; k++) m[k].classList.remove('vp-nuevo');
      }, 2600);
    } catch (e) {}
  }

  /** Avisa cuando la hoja del escáner se cierra (importó, canceló o hubo error). */
  function alCerrarElEscaner(cb) {
    var capa = document.getElementById('modal-layer');
    if (!capa) { cb(); return; }
    var hecho = false, obs = null, reloj = 0;
    function terminar() {
      if (hecho) return;
      hecho = true;
      if (obs) { try { obs.disconnect(); } catch (e) {} }
      if (reloj) clearInterval(reloj);
      cb();
    }
    function revisar() { if (!capa.querySelector('.modal-overlay')) terminar(); }
    if (window.MutationObserver) {
      obs = new MutationObserver(revisar);
      try { obs.observe(capa, { childList: true }); } catch (e) { obs = null; }
    }
    /* Red de seguridad para navegadores viejitos (y por si algo se escapa). */
    reloj = setInterval(revisar, 300);
  }

  /**
   * Tarjeta Premium "Escanear carta / Escanear menú".
   * 1) Lleva a Productos.  2) Espera a que Productos esté listo.
   * 3) Abre el escáner de siempre.  4) Al cerrarse, se queda en Productos
   * y deja a la vista los productos que se acaban de agregar.
   */
  function escanearDesdeProductos() {
    if (abriendoEscaner) return;                              /* ya se está abriendo */
    if (typeof window.vpIaAbrir !== 'function') { abrir('escaner'); return; }
    abriendoEscaner = true;
    var ir = fn('goTo');
    try { if (ir) ir('products'); } catch (e) {}              /* 1) Productos primero */
    cuandoProductosListo(function () {                        /* 2) ya cargado */
      var antes = idsProductos();
      try { window.vpIaAbrir(); }                             /* 3) el escáner de siempre */
      catch (e) { abriendoEscaner = false; return; }
      /* Si no se abrió (por ejemplo, sin permiso para administrar productos)
         se suelta el candado y el usuario se queda en Productos. */
      var capa = document.getElementById('modal-layer');
      if (!capa || !capa.querySelector('.modal-overlay')) { abriendoEscaner = false; return; }
      alCerrarElEscaner(function () {                         /* 4) al terminar */
        abriendoEscaner = false;
        if (!productosListo() && ir) { try { ir('products'); } catch (e) {} }
        marcarNuevos(antes);
      });
    });
  }

  /** Lleva a la función de la tarjeta. Si no es Premium, cada puerta abre la pantalla de Premium. */
  function irA(clave) {
    /* Por ahora, sin Premium no pasa nada al tocar (después aquí irá el video y luego el pago). */
    if (!activo()) return;
    var ir = fn('goTo');
    var abierta = !!document.querySelector('#modal-layer .vp-pr');
    if (abierta) {
      var cierra = fn('closeModal'); if (cierra) cierra();
      vista = 'principal';
      setTimeout(function () { irA(clave); }, 320);
      return;
    }
    if (clave === 'menu') { if (ir) ir('menu'); return; }
    if (clave === 'chat') {
      puerta('chat', function () { if (window.VPMascota && typeof VPMascota.abrir === 'function') VPMascota.abrir(); });
      return;
    }
    if (clave === 'escaner') {
      /* Ya no se abre encima de donde estés: primero Productos y luego el
         escáner (ver escanearDesdeProductos, aquí arriba). */
      puerta('escaner', escanearDesdeProductos);
      return;
    }
    if (clave === 'stats') {
      /* Estadísticas NORMALES, las de siempre. Antes esta tarjeta abría
         sola las estadísticas detalladas; ya no las abre ni se desplaza
         hasta ellas. El botón "Ver estadísticas detalladas" sigue igual
         y ahí adentro, si el dueño quiere, las abre él. */
      if (ir) ir('stats');   /* gratis para todos */
      return;
    }
    if (clave === 'usuarios') {
      var u = fn('openUsersSheet');
      if (u) u(); else abrir('usuarios');
      return;
    }
  }

  /** Deja lista la sección: la pantalla, el ícono de la corona y el menú lateral. */
  function registrarFunciones() {
    estilosFunciones();
    try {
      var ic = ref('ICONS');
      if (ic) {
        ic.vpCrown = '<img class="vp-crown-ico" src="' + CORONA_ICONO + '" alt="" decoding="async">';
        var hs = document.querySelectorAll('.navbtn[data-view="premium"] .navicon, .vp-top-prem-ico');
        for (var i = 0; i < hs.length; i++) hs[i].innerHTML = ic.vpCrown;
      }
    } catch (e) {}
  }

  /* =======================================================================
     12b. PANTALLA DE PAGO PROPIA (web)
     Antes "Contratar" mandaba a la página de Stripe Checkout. Ahora el cobro
     se hace AQUÍ, dentro de VendoPlus, con el diseño de la app:
       · vp-suscripcion (función de Supabase) crea la suscripción y da el
         client_secret.
       · El campo de tarjeta es Stripe Payment Element: la tarjeta va directo
         y cifrada de la app a Stripe; ni VendoPlus ni Supabase la ven.
       · Al pagar, vp-suscripcion "confirmar" activa paid_until al instante
         (el webhook invoice.paid también lo hace, como respaldo).
     Si falta la llave pública de Stripe, se usa el cobro anterior (Stripe
     Checkout) para que nunca se quede sin poder cobrar.
     Android sigue cobrando con Google Play (PlayPay), no cambia.
  ======================================================================= */
  /* Llave PUBLICABLE de Stripe (pk_live_...). Es pública: puede ir aquí.
     También puede venir de la función (secreto STRIPE_PUBLISHABLE_KEY). */
  var STRIPE_PK = 'pk_live_51TQvX0Pj0LIsQQbTzBSEaWDCk0uPXV5Tv95Wx8qPLdrri3qrxFH8QEeoOGCunIUzwGao0aQtoETY9XwXxclEu5Jq005wno6Pc2';

  var pago = { stripe: null, elements: null, subId: null, monto: null, ocupado: false };

  function cargarStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (cargarStripeJs.p) return cargarStripeJs.p;
    cargarStripeJs.p = new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.async = true;
      s.onload = function () { window.Stripe ? ok(window.Stripe) : mal(new Error('Stripe.js')); };
      s.onerror = function () { cargarStripeJs.p = null; mal(new Error('Stripe.js')); };
      document.head.appendChild(s);
    });
    return cargarStripeJs.p;
  }

  function dinero(centavos) {
    var n = (centavos == null ? PRECIO * 100 : centavos) / 100;
    return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var SVG_CANDADO = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  /* En celular la app achica todo con "zoom" (0.9). Safari en iPhone no
     achica bien el recuadro de Stripe (es un iframe): queda más angosto y
     pegado a la izquierda. Aquí se le quita el zoom SOLO a ese recuadro
     (zoom inverso), así ocupa justo el ancho y queda
     centrado como lo demás. */
  function sinZoom(box) {
    if (!box) return;
    var z = 1, n = box.parentElement;
    while (n && n !== document.documentElement) {
      var v = parseFloat(getComputedStyle(n).zoom);
      if (v && isFinite(v)) z *= v;
      n = n.parentElement;
    }
    if (Math.abs(z - 1) < 0.01) { box.style.zoom = ''; box.style.width = ''; return; }
    box.style.zoom = String(1 / z);   /* el ancho en % no cambia con zoom: sigue al 100 % */
    box.style.width = '100%';
  }

  function pagoHTML() {
    var total = dinero(pago.monto);
    return '<div class="vp-pr-x dos">' +
        '<button type="button" class="sheet-close" onclick="VPPremium.volver()" aria-label="Regresar">' + ico('chevronLeft') + '</button>' +
        '<button type="button" class="sheet-close" onclick="VPPremium.cerrar()" aria-label="Cerrar">' + ico('close') + '</button>' +
      '</div>' +
      '<div class="vp-pg">' +
       '<div class="vp-pg-info"><div class="vp-pg-in">' +
        '<h1 class="vp-pg-h1">Completa tu pago</h1>' +
        '<p class="vp-pg-lead">Activa Premium en tu cuenta de VendoPlus.</p>' +
        '<div class="vp-pg-resumen">' +
          '<div class="vp-pg-fila"><span><b>VendoPlus Premium</b><small>Plan mensual · se renueva cada mes</small></span><span data-vp-pg-monto>' + total + '</span></div>' +
          '<div class="vp-pg-linea"></div>' +
          '<div class="vp-pg-fila total"><span>Total hoy</span><span><b data-vp-pg-monto>' + total + '</b> <small>MXN</small></span></div>' +
        '</div>' +
        '<div class="vp-pg-incluye"><div class="vp-pg-lbl">Incluye</div><ul>' +
          ['Menú digital y pedidos', 'Asistente con IA', 'Productos con una foto, sin límite', 'Acceso para tus empleados', 'Comandas: caja, mesero y cocina']
            .map(function (t) { return '<li>' + SVG_SI + '<span>' + esc(t) + '</span></li>'; }).join('') +
        '</ul></div>' +
       '</div></div>' +
       '<div class="vp-pg-form"><div class="vp-pg-in">' +
        '<div class="vp-pg-lbl">Método de pago</div>' +
        '<div class="vp-pg-tarjeta">' +
          '<div class="vp-pg-esq" id="vpPgEsq"><i></i><i></i><i class="dos"><em></em><em></em></i></div>' +
          '<div id="vpPgEl"></div>' +
        '</div>' +
        '<div class="vp-pg-error" id="vpPgError" role="alert" hidden></div>' +
        '<button type="button" class="vp-pg-btn" id="vpPgBtn" onclick="VPPremium.pagoPagar()" disabled>' +
          '<span class="vp-pg-btn-txt">Pagar ' + total + ' MXN</span><span class="vp-pg-spin" aria-hidden="true"></span>' +
        '</button>' +
        '<p class="vp-pg-nota">Cancela cuando quieras desde Mi cuenta. Al pagar aceptas que se cobre ' + total + ' MXN cada mes hasta que canceles.</p>' +
        '<div class="vp-pg-seguro">' + SVG_CANDADO + '<span>Pago seguro y cifrado. Tus datos de tarjeta no se guardan en VendoPlus; los procesa Stripe.</span></div>' +
       '</div></div>' +
      '</div>';
  }

  function listoHTML() {
    return '<div class="vp-pr-x"><button type="button" class="sheet-close" onclick="VPPremium.pagoListo()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
      '<div class="vp-pg vp-pg-ok">' +
        '<div class="vp-pg-check"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37.5 19"/></svg></div>' +
        '<h1 class="vp-pg-h1">¡Ya eres Premium!</h1>' +
        '<p class="vp-pg-lead">Tu pago quedó listo. Ya puedes usar el Menú digital, el asistente con IA, los reportes y todo lo demás.</p>' +
        '<button type="button" class="vp-pg-btn" onclick="VPPremium.pagoListo()"><span class="vp-pg-btn-txt">Empezar</span></button>' +
      '</div>';
  }

  function estilosPago() {
    if (document.getElementById('vp-pago-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-pago-css';
    st.textContent = [
      '.vp-pg{flex:1 1 auto;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:2px 0 8px;width:100%;max-width:440px;margin:0 auto;',
      'animation:vp-pl-sube .45s cubic-bezier(.22,1,.36,1) both;}',
      '@keyframes vp-pl-sube{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}',
      '.vp-pg-h1{margin:6px 0 6px;font-size:25px;line-height:1.15;font-weight:700;letter-spacing:-.4px;color:var(--ink,#15181C);text-align:center;}',
      '.vp-pg-lead{margin:0 auto 20px;max-width:340px;text-align:center;font-size:14px;line-height:1.45;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-pg-resumen{background:#F7F8FA;border:1px solid #EEF1F5;border-radius:16px;padding:14px 16px;margin-bottom:20px;}',
      '.vp-pg-fila{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;font-size:14px;font-weight:400;color:var(--ink,#15181C);}',
      '.vp-pg-fila b{font-weight:600;}',
      '.vp-pg-fila small{display:block;font-size:12px;color:var(--ink-soft,#6C7480);margin-top:2px;}',
      '.vp-pg-fila.total{align-items:baseline;}',
      '.vp-pg-fila.total > span:first-child{font-weight:500;}',
      '.vp-pg-fila.total b{font-size:20px;font-weight:600;letter-spacing:-.4px;}',
      '.vp-pg-fila.total small{display:inline;margin:0;}',
      '.vp-pg-linea{height:1px;background:#E6E9EF;margin:12px 0;}',
      '.vp-pg-lbl{font-size:13px;font-weight:500;color:var(--ink-soft,#6C7480);margin:0 2px 8px;}',
      '.vp-pg-tarjeta{position:relative;min-height:150px;width:100%;min-width:0;overflow:hidden;}',
      '#vpPgEl{width:100%;min-width:0;}',
      '#vpPgEl iframe{max-width:100% !important;}',
      '.vp-pg-info,.vp-pg-form,.vp-pg-in{min-width:0;}',
      '.vp-pg-incluye{display:none;}',
      '.vp-pg-incluye ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}',
      '.vp-pg-incluye li{display:flex;align-items:center;gap:10px;font-size:14.5px;font-weight:400;color:var(--ink,#15181C);}',
      '.vp-pg-incluye svg{flex:none;width:17px;height:17px;color:var(--vp-pr-verde,#16A34A);}',
      '.vp-pg-esq{display:flex;flex-direction:column;gap:12px;}',
      '.vp-pg-esq i{display:block;height:46px;border-radius:12px;background:linear-gradient(90deg,#F1F3F7 25%,#F8F9FB 50%,#F1F3F7 75%);background-size:200% 100%;animation:vp-pg-brillo 1.2s linear infinite;}',
      '.vp-pg-esq i.dos{display:flex;gap:12px;background:none;animation:none;}',
      '.vp-pg-esq i.dos em{flex:1;border-radius:12px;background:linear-gradient(90deg,#F1F3F7 25%,#F8F9FB 50%,#F1F3F7 75%);background-size:200% 100%;animation:vp-pg-brillo 1.2s linear infinite;}',
      '@keyframes vp-pg-brillo{to{background-position:-200% 0}}',
      '.vp-pg-tarjeta.lista .vp-pg-esq{display:none;}',
      '.vp-pg-error{margin:14px 0 0;padding:11px 13px;border-radius:12px;background:#FEF2F2;color:#B42318;font-size:13px;line-height:1.4;font-weight:500;}',
      '.vp-pg-btn{position:relative;width:100%;margin-top:18px;border:none;border-radius:14px;padding:15px 16px;font-family:inherit;font-size:15.5px;font-weight:600;',
      'background:var(--vp-pr-verde-claro,#25D366);color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s ease,opacity .2s ease;',
      'box-shadow:0 8px 20px rgba(37,211,102,.25);}',
      '.vp-pg-btn:active:not(:disabled){transform:scale(.98);}',
      '.vp-pg-btn:disabled{opacity:.55;cursor:default;box-shadow:none;}',
      '.vp-pg-spin{display:none;position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:2.2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:vp-pg-gira .7s linear infinite;}',
      '.vp-pg-btn.cargando .vp-pg-btn-txt{visibility:hidden;}',
      '.vp-pg-btn.cargando .vp-pg-spin{display:block;}',
      '.vp-pg-btn.cargando:disabled{opacity:1;}',
      '@keyframes vp-pg-gira{to{transform:rotate(360deg)}}',
      '.vp-pg-nota{margin:12px 4px 0;text-align:center;font-size:12px;line-height:1.45;font-weight:400;color:var(--ink-soft,#6C7480);}',
      '.vp-pg-seguro{display:flex;align-items:flex-start;justify-content:center;gap:7px;margin:14px auto 0;max-width:340px;font-size:11.5px;line-height:1.45;font-weight:400;color:#8A93A0;}',
      '.vp-pg-seguro svg{flex:none;width:15px;height:15px;margin-top:1px;}',
      '.vp-pg-ok{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}',
      '.vp-pg-ok .vp-pg-btn{max-width:320px;}',
      '.vp-pg-check{width:84px;height:84px;margin:6px auto 18px;}',
      '.vp-pg-check svg{width:100%;height:100%;fill:none;stroke:var(--vp-pr-verde-claro,#25D366);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;}',
      '.vp-pg-check circle{stroke-dasharray:151;stroke-dashoffset:151;animation:vp-pg-traza .6s cubic-bezier(.65,0,.45,1) .1s forwards;}',
      '.vp-pg-check path{stroke-dasharray:36;stroke-dashoffset:36;animation:vp-pg-traza .35s cubic-bezier(.65,0,.45,1) .6s forwards;}',
      '@keyframes vp-pg-traza{to{stroke-dashoffset:0}}',
      '.modal-overlay.is-closing .vp-pg{animation:vp-pl-sale .22s ease-in both;}',
      '@keyframes vp-pl-sale{from{opacity:1;transform:none}to{opacity:0;transform:translateY(12px) scale(.98)}}',
      /* ===== COMPUTADORA: pantalla completa =====
         Planes: las dos tarjetas grandes al centro.
         Pago: dos mitades, a la izquierda el resumen (gris) y a la derecha la tarjeta. */
      '@media (min-width:700px){',
      '  .modal-overlay:has(.vp-pl),.modal-overlay:has(.vp-pg){padding:0 !important;align-items:stretch !important;justify-content:stretch !important;}',
      /* La app escala todo con zoom (--z): el alto y ancho se dividen entre él */
      '  .modal-sheet:has(.vp-pl),.modal-sheet:has(.vp-pg){width:calc(100vw / var(--z,1)) !important;max-width:none !important;',
      '    height:calc(100vh / var(--z,1)) !important;height:calc(100dvh / var(--z,1)) !important;max-height:none !important;',
      '    border-radius:0 !important;padding:0 !important;margin:0 !important;overflow:hidden !important;display:flex;flex-direction:column;background:#fff;}',
      '  .modal-sheet:has(.vp-pl) .vp-pr,.modal-sheet:has(.vp-pg) .vp-pr{position:relative;max-width:none;height:100%;margin:0;}',
      '  .modal-sheet:has(.vp-pl) .vp-pr-x,.modal-sheet:has(.vp-pg) .vp-pr-x{position:absolute;top:24px;left:28px;right:28px;z-index:3;margin:0;pointer-events:none;}',
      '  .modal-sheet:has(.vp-pl) .vp-pr-x button,.modal-sheet:has(.vp-pg) .vp-pr-x button{pointer-events:auto;width:42px;height:42px;}',
      /* planes: todo se ajusta al ALTO de la ventana (vh) y, si aun así no
         cabe, se desplaza sin cortar el título (centrado "seguro"). */
      '  .vp-pl-scroll{height:100%;overflow-y:auto;display:flex;flex-direction:column;align-items:center;',
      '    padding:clamp(64px,9vh,84px) clamp(24px,4vw,48px) clamp(24px,4vh,48px);}',
      '  .vp-pl-scroll::before,.vp-pl-scroll::after{content:"";flex:1 0 0;}',
      '  .vp-pl-h1{font-size:clamp(24px,4.2vh,38px);letter-spacing:-.8px;margin:0 0 clamp(4px,1vh,10px);}',
      '  .vp-pl-lead{font-size:clamp(13px,1.8vh,16px);max-width:520px;margin-bottom:clamp(16px,4vh,40px);}',
      '  .vp-pl{width:100%;max-width:900px;gap:clamp(16px,2vw,24px);}',
      '  .vp-pl-col{padding:clamp(18px,3.4vh,34px) clamp(18px,2.2vw,30px) clamp(16px,2.8vh,28px);border-radius:clamp(18px,2.4vh,24px);}',
      '  .vp-pl-tag{top:-12px;font-size:11.5px;padding:4px 13px;}',
      '  .vp-pl-cab{padding-bottom:clamp(10px,2vh,20px);margin-bottom:clamp(10px,2vh,20px);}',
      '  .vp-pl-cab h2{font-size:clamp(17px,2.6vh,23px);}',
      '  .vp-pl-cab p{font-size:clamp(12px,1.6vh,14px);margin-top:4px;}',
      '  .vp-pl-lista{gap:clamp(6px,1.4vh,14px);}',
      '  .vp-pl-fila{font-size:clamp(13px,1.75vh,15px);gap:11px;}',
      '  .vp-pl-ico,.vp-pl-ico svg{width:clamp(16px,2.1vh,19px);height:clamp(16px,2.1vh,19px);}',
      '  .vp-pl-txt small{font-size:clamp(11px,1.45vh,12.5px);}',
      '  .vp-pl-pie{margin-top:clamp(12px,2.6vh,26px);padding-top:clamp(10px,2.2vh,22px);}',
      '  .vp-pl-precio{margin-bottom:clamp(8px,1.6vh,16px);}',
      '  .vp-pl-precio b{font-size:clamp(24px,4vh,36px);}',
      '  .vp-pl-precio span{font-size:clamp(12px,1.6vh,14px);}',
      '  .vp-pl-btn{padding:clamp(10px,1.6vh,15px) 10px;font-size:clamp(14px,1.8vh,15.5px);border-radius:14px;}',
      /* pago */
      '  .vp-pg{max-width:none;height:100%;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);overflow:hidden;}',
      '  .vp-pg-info{background:#F7F8FA;border-right:1px solid #EEF1F5;overflow-y:auto;display:flex;justify-content:flex-end;',
      '    padding:clamp(72px,10vh,96px) clamp(28px,5vw,72px) clamp(28px,5vh,56px);}',
      '  .vp-pg-form{overflow-y:auto;display:flex;justify-content:flex-start;',
      '    padding:clamp(72px,10vh,96px) clamp(28px,5vw,72px) clamp(28px,5vh,56px);}',
      '  .vp-pg-in{width:100%;max-width:420px;margin:auto 0;}',   /* centrado vertical que nunca corta */
      '  .vp-pg-info .vp-pg-h1{text-align:left;font-size:clamp(24px,4vh,34px);letter-spacing:-.7px;margin:0 0 8px;}',
      '  .vp-pg-info .vp-pg-lead{text-align:left;margin:0 0 clamp(16px,3vh,28px);max-width:none;font-size:clamp(13.5px,1.8vh,15.5px);}',
      '  .vp-pg-resumen{background:#fff;padding:clamp(12px,2vh,18px) 20px;margin-bottom:clamp(16px,3vh,28px);}',
      '  .vp-pg-incluye{display:block;}',
      '  .vp-pg-incluye .vp-pg-lbl{margin-bottom:clamp(8px,1.5vh,14px);}',
      '  .vp-pg-incluye ul{gap:clamp(7px,1.3vh,11px);}',
      '  .vp-pg-form .vp-pg-lbl{font-size:14px;margin-bottom:12px;}',
      '  .vp-pg-nota,.vp-pg-seguro{text-align:left;justify-content:flex-start;margin-left:0;margin-right:0;max-width:none;}',
      '  .vp-pg-ok{display:flex;height:100%;padding:40px;}',
      '}',
      '@media (min-width:700px) and (max-height:640px){',
      '  .vp-pl-cab p,.vp-pl-txt small{display:none;}',
      '  .vp-pl-tag{top:-10px;padding:3px 10px;font-size:10.5px;}',
      '  .vp-pg-incluye{display:none;}',
      '  .vp-pg-ok .vp-pg-h1{font-size:34px;}',
      '}',
      '@media (prefers-reduced-motion: reduce){.vp-pg,.vp-pg-esq i,.vp-pg-esq em{animation:none !important;}',
      '.vp-pg-check circle,.vp-pg-check path{animation:none !important;stroke-dashoffset:0;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function pintarPago(html, clase) {
    var r = document.querySelector('#modal-layer .vp-pr');
    if (!r) return null;
    r.className = 'vp-pr' + (clase ? ' ' + clase : '');
    r.innerHTML = html;
    return r;
  }

  function errorPago(msg) {
    var e = document.getElementById('vpPgError');
    if (!e) { if (msg) avisar(msg, { variant: 'toast-danger' }); return; }
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function botonPago(estado) {
    var b = document.getElementById('vpPgBtn');
    if (!b) return;
    b.disabled = estado !== 'listo';
    b.classList.toggle('cargando', estado === 'cargando');
  }

  function limpiarPago() {
    try { if (pago.elements) { var el = pago.elements.getElement('payment'); if (el) el.destroy(); } } catch (e) {}
    pago.elements = null;
  }

  /* Cobro anterior: Stripe Checkout (se sale de la página). Solo de respaldo. */
  function cobroAnterior() {
    var c = nube();
    if (c && typeof c.checkout === 'function') {
      var r = c.checkout();
      if (r && typeof r.then === 'function') r.then(listoPremium, function () {});
      return r;
    }
  }

  /* Llama a vp-suscripcion SIEMPRE con una sesión vigente. Si la app se acaba
     de abrir (o estuvo mucho tiempo dormida), la sesión puede venir vencida
     y el servidor contesta 401: se renueva y se intenta una vez más. */
  function sesionVigente(c) {
    return c.sb.auth.getSession().then(function (r) {
      var ses = r && r.data && r.data.session;
      if (ses && ses.expires_at && ses.expires_at * 1000 - Date.now() > 60000) return ses;
      return c.sb.auth.refreshSession().then(function (r2) { return (r2 && r2.data && r2.data.session) || ses || null; });
    }).catch(function () { return null; });
  }
  function es401(err) {
    try {
      var st = err && (err.status || (err.context && err.context.status));
      return st === 401 || /401|jwt|token|sesi/i.test(String(err && err.message || ''));
    } catch (e) { return false; }
  }
  function llamarSuscripcion(c, cuerpo, reintento) {
    return sesionVigente(c).then(function (ses) {
      if (!ses) { var e = new Error('sin_sesion'); e.sinSesion = true; throw e; }
      return c.sb.functions.invoke('vp-suscripcion', {
        body: cuerpo,
        headers: { Authorization: 'Bearer ' + ses.access_token }
      });
    }).then(function (r) {
      if (r && r.error && es401(r.error) && !reintento) {
        return c.sb.auth.refreshSession().catch(function () {}).then(function () { return llamarSuscripcion(c, cuerpo, true); });
      }
      if (r && r.error && es401(r.error)) { var e2 = new Error('sin_sesion'); e2.sinSesion = true; throw e2; }
      return r;
    });
  }

  function abrirPago() {
    var c = nube();
    estilosPago();
    if (!document.querySelector('#modal-layer .vp-pr')) abrir(claveAbierta);
    vista = 'pago';
    pago.subId = null;
    limpiarPago();
    pintarPago(pagoHTML(), 'vp-pr-pago-v');
    vibra(6);

    llamarSuscripcion(c, { action: 'iniciar' }).then(function (r) {
      if (vista !== 'pago') return;
      var d = r && r.data;
      if (r.error || !d) throw (r.error || new Error('sin datos'));
      if (d.yaActivo) {
        return Promise.resolve(c.refreshSub && c.refreshSub()).then(function () {
          avisar('Tu Premium ya está activo', { variant: 'toast-success', icon: ico('check') });
          pagoListo();
        });
      }
      var pk = d.publishableKey || STRIPE_PK;
      if (!pk || !d.clientSecret) { cobroAnterior(); return; }   /* sin llave: el cobro de antes */
      pago.subId = d.subscriptionId;
      if (d.monto != null) {
        pago.monto = d.monto;
        var t = dinero(d.monto);
        var ms = document.querySelectorAll('[data-vp-pg-monto]');
        for (var i = 0; i < ms.length; i++) ms[i].textContent = t;
        var bt = document.querySelector('#vpPgBtn .vp-pg-btn-txt'); if (bt) bt.textContent = 'Pagar ' + t + ' MXN';
      }
      return cargarStripeJs().then(function (S) {
        if (vista !== 'pago') return;
        pago.stripe = pago.stripe && pago.stripe._vpPk === pk ? pago.stripe : S(pk, { locale: 'es-419' });
        pago.stripe._vpPk = pk;
        pago.elements = pago.stripe.elements({
          clientSecret: d.clientSecret,
          locale: 'es-419',
          fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }],
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#16A34A', colorText: '#15181C', colorTextSecondary: '#6C7480',
              colorTextPlaceholder: '#A3AAB5', colorDanger: '#B42318', colorBackground: '#FFFFFF',
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif', fontSizeBase: '15px',
              fontWeightNormal: '400', borderRadius: '12px', spacingUnit: '4px'
            },
            rules: {
              '.Input': { border: '1.5px solid #E4E8EF', boxShadow: 'none', padding: '13px 14px' },
              '.Input:focus': { border: '1.5px solid #25D366', boxShadow: '0 0 0 3px rgba(37,211,102,.14)' },
              '.Input--invalid': { border: '1.5px solid #F1B4AE', boxShadow: 'none' },
              '.Label': { fontWeight: '500', fontSize: '13px', color: '#6C7480' },
              '.Tab': { border: '1.5px solid #E4E8EF', boxShadow: 'none' },
              '.Tab--selected': { border: '1.5px solid #25D366', boxShadow: 'none' }
            }
          }
        });
        var el = pago.elements.create('payment', {
          layout: 'tabs',
          fields: { billingDetails: { email: 'never' } },
          terms: { card: 'never' },              /* el aviso de cobro lo damos nosotros, abajo */
          wallets: { link: 'never', applePay: 'auto', googlePay: 'auto' }
        });
        el.on('ready', function () {
          var t = document.querySelector('.vp-pg-tarjeta'); if (t) t.classList.add('lista');
          botonPago('listo');
        });
        el.on('change', function () { errorPago(''); });
        el.on('loaderror', function () { errorPago('No se pudo cargar el formulario de pago. Revisa tu internet e inténtalo de nuevo.'); });
        sinZoom(document.getElementById('vpPgEl'));
        el.mount('#vpPgEl');
      });
    }).catch(function (e) {
      console.error(e);
      if (vista !== 'pago') return;
      var t = document.querySelector('.vp-pg-tarjeta'); if (t) t.classList.add('lista');
      errorPago(e && e.sinSesion
        ? 'Tu sesión expiró. Cierra sesión y vuelve a entrar para pagar.'
        : (navigator.onLine === false
          ? 'No tienes conexión a internet. Revísala e inténtalo de nuevo.'
          : 'No pudimos preparar tu pago. Inténtalo de nuevo en un momento.'));
      var b = document.getElementById('vpPgBtn');
      if (b) { b.disabled = false; b.onclick = function () { abrirPago(); }; var tx = b.querySelector('.vp-pg-btn-txt'); if (tx) tx.textContent = 'Reintentar'; }
    });
  }

  function confirmarEnServidor(intentos) {
    var c = nube();
    return llamarSuscripcion(c, { action: 'confirmar', subscriptionId: pago.subId })
      .then(function (r) {
        var d = r && r.data;
        if (d && d.activo) return true;
        if (intentos > 0) return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return confirmarEnServidor(intentos - 1); });
        return false;
      }, function () {
        if (intentos > 0) return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return confirmarEnServidor(intentos - 1); });
        return false;
      });
  }

  function pagoPagar() {
    if (pago.ocupado || !pago.stripe || !pago.elements) return;
    pago.ocupado = true;
    vibra(10);
    errorPago('');
    botonPago('cargando');
    pago.stripe.confirmPayment({
      elements: pago.elements,
      redirect: 'if_required',
      confirmParams: { return_url: location.origin + location.pathname + '?pago=ok' }
    }).then(function (res) {
      if (res.error) {
        pago.ocupado = false;
        botonPago('listo');
        var m = res.error.type === 'card_error' || res.error.type === 'validation_error'
          ? res.error.message : 'No se pudo completar el pago. Inténtalo de nuevo.';
        errorPago(m);
        vibra(20);
        return;
      }
      return confirmarEnServidor(6).then(function () {
        var c = nube();
        return Promise.resolve(c && c.refreshSub && c.refreshSub());
      }).then(function () {
        pago.ocupado = false;
        limpiarPago();
        vista = 'listo';
        pintarPago(listoHTML(), 'vp-pr-pago-v');
        vibra(18);
      });
    }).catch(function (e) {
      console.error(e);
      pago.ocupado = false;
      botonPago('listo');
      errorPago('No se pudo completar el pago. Revisa tu internet e inténtalo de nuevo.');
    });
  }

  function pagoListo() {
    limpiarPago();
    vista = 'principal';
    var f = fn('closeModal'); if (f) f();
    pintarMascota();
    try { if (typeof window.render === 'function') window.render(); } catch (e) {}
    try { var c = nube(); if (c && typeof c.gate === 'function') c.gate(); } catch (e) {}
  }

  /* =======================================================================
     13. LO QUE QUEDA DISPONIBLE PARA EL RESTO DE VENDO PLUS
  ======================================================================= */
  window.VPPremium = {
    activo: activo,
    abrir: abrir,
    portada: portada,
    cerrarPortada: cerrarPortada,
    cerrar: cerrar,
    masBeneficios: masBeneficios,
    volver: volver,
    pagar: pagar,
    pagoPagar: pagoPagar,
    pagoListo: pagoListo,
    ventasMes: ventasMes,
    cerrarAvisoVentas: cerrarAvisoVentas,
    abrirAvisoVentas: abrirAvisoVentas,
    verPromo: function () { mostrarPromo(PROMOS.length ? PROMOS[Math.floor(Math.random() * PROMOS.length)] : null); },
    puerta: puerta,
    precio: PRECIO,
    precioTxt: precioTxt,
    FUNCIONES: FUNCIONES,
    GRATIS_AL_MES: GRATIS_AL_MES,
    restantes: restantes,
    fijarRestantes: fijarRestantes,
    pedirConsumo: pedirConsumo,
    sinEscaneos: sinEscaneos,
    tarjetaCuentaHTML: tarjetaCuentaHTML,
    pintarMascota: pintarMascota,
    corona: CORONA,
    irA: irA,
    funciones: funciones,
    funcionesVista: funcionesVista
  };

  ocultarPremium();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
