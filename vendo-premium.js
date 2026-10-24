/* =========================================================================
   VENDO PLUS · PREMIUM  (vendo-premium.js)
   -------------------------------------------------------------------------
   Este archivo cambia por completo la forma de cobrar:

   ANTES:  1 mes gratis y después la app se bloqueaba entera.
   AHORA:  la app NUNCA se bloquea. Lo que se vende es Premium ($149/mes).

   GRATIS PARA SIEMPRE (sin pagar un peso, sin tarjeta, sin avisos):
     · Vender y cobrar            · Generar y enviar tickets
     · Historial de ventas        · Caja, corte y gastos
     · Clientes y crédito         · Inventario completo
     · Fotos de productos (ilimitadas)
     · Mi cuenta y configuración
     · Estadísticas simples (ventas netas, pedidos, ticket promedio, gráficas)
     · 3 escaneos de carta con IA al mes

   PREMIUM · $149 MXN al mes:
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
     · Escáner IA     → 3 gratis al mes; al cuarto, Premium.

   El cobro NO cambia: en la página web sigue siendo el mismo precio de
   Stripe, y en la app de Play Store la misma suscripción de Google Play.

   Es el mismo archivo para la página web y para la app de Play Store.
========================================================================= */
(function () {
  'use strict';
  if (window.VPPremium) return;

  var PRECIO = 149;

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
      titulo: 'Menú Digital',
      texto: 'Tus clientes ven tu menú desde su celular y sus pedidos entran solos a tu caja y a tu WhatsApp.',
      ico: 'menuBook'
    },
    chat: {
      titulo: 'Chat con IA',
      texto: 'Pregúntale cómo van tus ventas, tus ganancias o qué se está agotando, y te contesta al momento.',
      ico: 'sparkle'
    },
    escaner: {
      titulo: 'Escáner de carta con IA',
      texto: 'Tomas una foto de tu menú y la IA llena tu inventario sola. Gratis son 3 escaneos al mes; con Premium, los que quieras.',
      ico: 'camera'
    },
    stats: {
      titulo: 'Estadísticas detalladas',
      texto: 'Ve tus ventas, ganancias y productos más vendidos con datos claros y fáciles de entender.',
      ico: 'chart'
    }
  };
  var ORDEN = ['menu', 'chat', 'escaner', 'stats'];

  /* La corona de Premium. Va aquí adentro a propósito: así es UN solo
     archivo que se copia igual a la web y a la app, sin imágenes sueltas
     que se puedan quedar sin subir. */
  var CORONA = 'data:image/png;base64,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';

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

      /* ---------- pantalla completa de Premium ---------- */
      '.vp-pr{max-width:560px;margin:0 auto;padding:0 2px 8px;}',
      '.vp-pr-x{position:sticky;top:-2px;z-index:3;display:flex;justify-content:flex-end;padding:6px 0 10px;',
      'margin:-6px -4px 0;background:linear-gradient(#fff 58%,rgba(255,255,255,.92) 82%,rgba(255,255,255,0));}',
      '.vp-pr-x button{width:40px;height:40px;border:none;border-radius:50%;background:#F1F3F7;color:var(--vp-pr-gris);',
      'display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;',
      'transition:background .15s ease;}',
      '.vp-pr-x button:active{background:#E4E8EF;}',
      '.vp-pr-x button svg{width:19px;height:19px;}',

      '.vp-pr-art{display:block;width:min(248px,62%);height:auto;margin:2px auto 14px;}',

      '.vp-pr-h1{margin:0 0 10px;text-align:center;font-size:clamp(25px,7.4vw,32px);line-height:1.14;',
      'font-weight:800;letter-spacing:-.6px;color:var(--vp-pr-tinta);}',
      '.vp-pr-h1 b{color:var(--vp-pr-verde);font-weight:800;}',
      '.vp-pr-lead{margin:0 auto 22px;max-width:360px;text-align:center;font-size:15.5px;line-height:1.45;',
      'font-weight:600;color:var(--vp-pr-gris);}',
      '.vp-pr-lead b{color:var(--vp-pr-tinta);font-weight:800;}',

      /* ---------- tarjetas de funciones ---------- */
      '.vp-pr-cards{display:grid;gap:11px;margin-bottom:20px;}',
      '.vp-pr-card2{display:flex;gap:13px;align-items:flex-start;border:1px solid var(--vp-pr-borde);',
      'border-radius:17px;background:#fff;padding:15px 16px;}',
      '.vp-pr-card2.is-focus{border-color:#BFE9D0;background:#FBFFFC;}',
      '.vp-pr-ico{flex:none;width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;',
      'background:var(--vp-pr-suave);color:var(--vp-pr-verde);}',
      '.vp-pr-ico svg{width:21px;height:21px;}',
      '.vp-pr-txt{min-width:0;}',
      '.vp-pr-txt b{display:block;font-size:16px;font-weight:800;color:var(--vp-pr-tinta);line-height:1.3;}',
      '.vp-pr-txt span{display:block;font-size:14px;font-weight:600;color:var(--vp-pr-gris);line-height:1.45;margin-top:3px;}',

      /* ---------- precio ---------- */
      '.vp-pr-precio{background:var(--vp-pr-suave);border-radius:18px;padding:16px 18px;margin-bottom:14px;}',
      '.vp-pr-precio small{display:block;font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;',
      'color:var(--vp-pr-verde);}',
      '.vp-pr-precio b{display:block;font-size:clamp(30px,8.6vw,38px);font-weight:800;letter-spacing:-1px;line-height:1.05;',
      'color:var(--vp-pr-verde);margin-top:3px;}',
      '.vp-pr-precio span{display:block;font-size:14px;font-weight:600;color:#3F8A5E;margin-top:3px;}',

      /* ---------- botón ---------- */
      '.vp-pr-cta{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;border:none;cursor:pointer;',
      'border-radius:16px;padding:18px 20px;font-family:inherit;font-size:17px;font-weight:800;color:#fff;',
      'background:var(--vp-pr-verde-claro);box-shadow:0 6px 18px rgba(37,211,102,.3);',
      '-webkit-tap-highlight-color:transparent;transition:transform .12s ease, background .15s ease;}',
      '.vp-pr-cta:active{transform:scale(.985);background:#1FBE5B;}',
      '.vp-pr-cta[disabled]{opacity:.6;box-shadow:none;}',
      '.vp-pr-cta svg{width:17px;height:17px;}',
      '.vp-pr-link{display:block;width:100%;margin-top:10px;border:none;background:none;cursor:pointer;',
      'font-family:inherit;font-size:14.5px;font-weight:700;color:var(--vp-pr-verde);padding:11px;',
      '-webkit-tap-highlight-color:transparent;}',
      '.vp-pr-pie{margin:14px 2px 2px;text-align:center;font-size:13px;font-weight:600;color:var(--vp-pr-gris);}',
      '.vp-pr-legal{margin:10px 2px 0;text-align:center;font-size:11.5px;font-weight:600;line-height:1.5;color:#98A0AC;}',

      /* ---------- aviso (solo el Dueño puede pagar) ---------- */
      '.vp-pr-nota{display:flex;gap:10px;align-items:flex-start;background:#F6F8FB;border-radius:14px;padding:13px 14px;margin-bottom:14px;}',
      '.vp-pr-nota svg{width:17px;height:17px;flex:none;margin-top:1px;color:var(--vp-pr-gris);}',
      '.vp-pr-nota p{margin:0;font-size:13.5px;font-weight:600;line-height:1.5;color:var(--vp-pr-gris);}',
      '.vp-pr-nota p b{color:var(--vp-pr-tinta);font-weight:800;}',

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
    return '<div class="vp-pr-card2' + (foco === clave ? ' is-focus' : '') + '">' +
             '<span class="vp-pr-ico">' + ico(f.ico) + '</span>' +
             '<span class="vp-pr-txt"><b>' + esc(f.titulo) + '</b><span>' + esc(f.texto) + '</span></span>' +
           '</div>';
  }

  function cabeceraHTML(titulo, lead) {
    return '<i class="fs-marker" hidden></i>' +
      '<div class="vp-pr">' +
        '<div class="vp-pr-x"><button type="button" class="sheet-close" onclick="VPPremium.cerrar()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
        '<img class="vp-pr-art" src="' + CORONA + '" alt="" decoding="async">' +
        '<h1 class="vp-pr-h1">' + titulo + '</h1>' +
        '<p class="vp-pr-lead">' + lead + '</p>';
  }

  function pieHTML(precio, esDueno, pie) {
    if (!esDueno) {
      return '<div class="vp-pr-nota">' + ico('alert') +
               '<p>Solo el <b>Dueño</b> de la cuenta puede activar Premium. Pídele que entre con su usuario y lo active desde Mi cuenta.</p>' +
             '</div>' +
             '<button type="button" class="vp-pr-cta" onclick="VPPremium.cerrar()">Entendido</button>';
    }
    return '<div class="vp-pr-precio" data-vp-price>' +
             '<small>Membresía Vendo Plus</small>' +
             '<b>' + esc(precio) + '</b>' +
             '<span>por mes · Cancela cuando quieras</span>' +
           '</div>' +
           '<button type="button" class="vp-pr-cta" id="payBtn" onclick="VPPremium.pagar()">' +
             'Suscribirme ahora' + ico('chevronRight') +
           '</button>' +
           (window.PlayPay
             ? '<button type="button" class="vp-pr-link" id="restoreBtn" onclick="PlayPay.restore()">Ya pagué · Restaurar compra</button>'
             : '') +
           '<p class="vp-pr-pie">' + esc(pie || 'Lo demás de Vendo Plus sigue siendo tuyo, gratis.') + '</p>' +
           '<p class="vp-pr-legal">' + esc(legalTxt()) + '</p>';
  }

  /**
   * Abre la pantalla de Premium.
   * @param {string} [clave]  Qué función quiso usar ('menu'|'chat'|'escaner'|'stats')
   */
  function abrir(clave) {
    estilos();
    var abrirModal = fn('openModal');
    if (!abrirModal) { avisar('Activa Premium desde Mi cuenta'); return; }

    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    var precio = precioTxt();

    abrirModal(
      cabeceraHTML(
        'Desbloquea más<br><b>funciones con Premium</b>',
        'Lleva tu negocio <b>más lejos</b> con herramientas que te ahorran tiempo y te ayudan a vender más.'
      ) +
      '<div class="vp-pr-cards">' + ORDEN.map(function (k) { return tarjetaHTML(k, clave); }).join('') + '</div>' +
      pieHTML(precio, esDueno) +
      '</div>',
      { dismissible: true, grip: false });

    traseProtegido();
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
    var f = fn('closeModal');
    if (f) f();
  }

  function legalTxt() {
    return window.PlayPay
      ? 'Renovación automática. Se cobra a tu cuenta de Google Play y la cancelas cuando quieras en Play Store › Pagos y suscripciones.'
      : 'Renovación automática, con Stripe. La cancelas cuando quieras desde Mi cuenta.';
  }
  function pintarPrecio() {
    var p = precioTxt();
    var c = document.querySelector('[data-vp-price]');
    if (c) c.innerHTML = '<small>Membresía Vendo Plus</small><b>' + esc(p) + '</b><span>por mes · Cancela cuando quieras</span>';
  }

  /** El botón de pagar: usa EXACTAMENTE el cobro que ya tenías. */
  function pagar() {
    vibra(10);
    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    if (!esDueno) { avisar('Solo el Dueño puede activar Premium'); return; }

    var c = nube();
    /* web → Stripe (se sale de la página) · Android → Google Play (aquí mismo) */
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
  function engancharMenu() {
    var act = fn('mdActivate');
    if (act && !act.__vpPr) {
      var envuelto = function () {
        if (!activo()) { abrir('menu'); return; }
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
      if (!activo()) { abrir('chat'); return; }
      return _abrir.apply(this, arguments);
    };
    var _preg = M.preguntar;
    if (typeof _preg === 'function') {
      M.preguntar = function () {
        if (!activo()) { abrir('chat'); return; }
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
    var rs = fn('renderStats');
    if (rs && !rs.__vpPr) {
      var envuelto = function () {
        var html = rs.apply(this, arguments);
        if (activo() || typeof html !== 'string') return html;
        var i = html.indexOf('<div id="statsDetail"');
        if (i < 0) return html;
        /* Se deja el botón tal cual y se vacía el bloque de abajo. */
        return html.slice(0, i) + '<div id="statsDetail" class="stats-detail" hidden></div>';
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
     Gratis: 3 escaneos al mes (los cuenta el servidor, así que no se
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
      if (d && d.ok && d.restantes != null) consumo.restantes = Number(d.restantes);
      return consumo.restantes;
    }).catch(function () { return consumo.restantes; });
  }

  function restantes() { return activo() ? Infinity : consumo.restantes; }
  function fijarRestantes(n) { if (n != null && isFinite(n)) consumo.restantes = Number(n); }

  /** "Ya usaste tus 3 escaneos gratis de este mes". */
  function sinEscaneos() {
    estilos();
    var abrirModal = fn('openModal');
    if (!abrirModal) { avisar('Ya usaste tus ' + GRATIS_AL_MES + ' escaneos gratis de este mes'); return; }
    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    var precio = precioTxt();

    abrirModal(
      cabeceraHTML(
        'Ya usaste tus <b>' + GRATIS_AL_MES + ' escaneos</b><br>gratis de este mes',
        'Se renuevan solos el mes que entra. Si no quieres esperar, con <b>Premium</b> escaneas todo lo que necesites.'
      ) +
      '<div class="vp-pr-nota">' + ico('check') +
        '<p><b>Tus productos no se borran.</b> Todo lo que ya escaneaste se queda guardado, y agregar o editar productos a mano sigue siendo gratis e ilimitado.</p>' +
      '</div>' +
      '<div class="vp-pr-cards">' + ORDEN.map(function (k) { return tarjetaHTML(k, 'escaner'); }).join('') + '</div>' +
      pieHTML(precio, esDueno, 'Lo demás de Vendo Plus sigue siendo tuyo, gratis.') +
      '</div>',
      { dismissible: true, grip: false });

    traseProtegido();
    try { if (window.PlayPay && typeof PlayPay.load === 'function') PlayPay.load().then(pintarPrecio).catch(function () {}); } catch (e) {}
  }

  function engancharEscaner() {
    var ab = window.vpIaAbrir;
    if (typeof ab !== 'function' || ab.__vpPr) return false;
    var envuelto = function () {
      var self = this, args = arguments;
      if (activo()) return ab.apply(self, args);
      /* Versión gratis: primero se pregunta al servidor cuántos quedan.
         Si el servidor no contesta, se deja pasar: nunca se bloquea por
         una falla de internet. */
      var r = consumo.restantes;
      if (r != null && r <= 0) { sinEscaneos(); return; }
      pedirConsumo().then(function (n) {
        if (n != null && n <= 0) { sinEscaneos(); return; }
        ab.apply(self, args);
      }).catch(function () { ab.apply(self, args); });
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
      if (document.querySelector('#modal-layer .vp-pr')) { cerrar(); return 'handled'; }
      return b.apply(this, arguments);
    };
    envuelto.__vpPr = true;
    window.__vendoBack = envuelto;
  }

  /* =======================================================================
     12. ENCENDER
  ======================================================================= */
  function engancharTodo() {
    soltarLaApp();
    quitarBienvenida();
    engancharCuenta();
    engancharMenu();
    engancharStats();
    engancharAtras();
    var a = engancharChat();
    var b = engancharEscaner();
    pintarMascota();
    return a && b;
  }

  function arrancar() {
    estilos();
    /* La tecla Esc cierra la pantalla de Premium (computadora) */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.querySelector('#modal-layer .vp-pr')) cerrar();
    });
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
     13. LO QUE QUEDA DISPONIBLE PARA EL RESTO DE VENDO PLUS
  ======================================================================= */
  window.VPPremium = {
    activo: activo,
    abrir: abrir,
    cerrar: cerrar,
    pagar: pagar,
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
    pintarMascota: pintarMascota
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
