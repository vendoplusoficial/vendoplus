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
     · Asistente con IA (el chat del robot)
     · Escaneos de carta con IA ilimitados
     · Estadísticas detalladas y reportes completos

   El cobro NO cambia: en la página web sigue siendo el mismo precio de
   Stripe, y en la app de Play Store la misma suscripción de Google Play.
   Este archivo solo decide CUÁNDO se le ofrece pagar.

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
      texto: 'Tu carta en línea con tu propio enlace, para que tus clientes pidan desde su celular y los pedidos te lleguen aquí.',
      ico: 'menuBook'
    },
    chat: {
      titulo: 'Asistente con IA',
      texto: 'Pregúntale en voz normal cómo van tus ventas, tus ganancias, tu inventario o quién te debe, y te contesta al momento.',
      ico: 'sparkle'
    },
    escaner: {
      titulo: 'Escaneos de carta con IA sin límite',
      texto: 'Toma una foto de tu menú o lista de precios y la IA llena tu inventario. Gratis son 3 al mes; con Premium, los que quieras.',
      ico: 'camera'
    },
    stats: {
      titulo: 'Estadísticas detalladas',
      texto: 'Ganancia real, costo de lo vendido, cómo te pagaron, productos y horas fuertes, y el reporte completo para tu contador.',
      ico: 'chart'
    }
  };
  var ORDEN = ['menu', 'chat', 'escaner', 'stats'];
  /* Nombre corto, para las etiquetas chiquitas de Mi cuenta */
  var CORTO = { menu: 'Menú Digital', chat: 'Asistente con IA', escaner: 'Escaneos sin límite', stats: 'Estadísticas detalladas' };
  function chipTxt(k) { return CORTO[k] || FUNCIONES[k].titulo; }

  /* =======================================================================
     3.  ESTILOS DE LA PANTALLA DE PREMIUM
     Se inyectan una sola vez y usan las MISMAS variables de color de
     Vendo Plus, así que se ve igual en claro y en oscuro.
  ======================================================================= */
  var cssPuesto = false;
  function estilos() {
    if (cssPuesto || document.getElementById('vp-premium-css')) { cssPuesto = true; return; }
    cssPuesto = true;
    var st = document.createElement('style');
    st.id = 'vp-premium-css';
    st.textContent = [
      /* ---------- cabecera de la hoja ---------- */
      '.vp-pr-hero{position:relative;margin:-4px -18px 15px;padding:22px 20px 19px;text-align:center;',
      'background:linear-gradient(160deg,#1C1F2B 0%,#262B3C 58%,#15391F 100%);overflow:hidden;}',
      '.vp-pr-hero::after{content:"";position:absolute;left:50%;top:-58%;width:260px;height:260px;transform:translateX(-50%);',
      'background:radial-gradient(circle,rgba(37,211,102,.34),transparent 68%);pointer-events:none;}',
      '.vp-pr-crown{position:relative;width:54px;height:54px;margin:0 auto 12px;border-radius:18px;display:flex;align-items:center;justify-content:center;',
      'background:linear-gradient(150deg,#4FE593,#25D366);box-shadow:0 10px 26px rgba(37,211,102,.38);}',
      '.vp-pr-crown svg{width:27px;height:27px;color:#0B2417;}',
      '.vp-pr-kicker{position:relative;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;letter-spacing:.7px;',
      'text-transform:uppercase;color:#4FE593;background:rgba(79,229,147,.14);border:1px solid rgba(79,229,147,.3);',
      'border-radius:999px;padding:4px 11px;margin-bottom:11px;}',
      '.vp-pr-kicker svg{width:13px;height:13px;}',
      '.vp-pr-h1{position:relative;margin:0;font-size:20.5px;line-height:1.22;font-weight:800;color:#fff;letter-spacing:-.3px;}',
      '.vp-pr-h1 b{color:#4FE593;font-weight:800;}',
      '.vp-pr-lead{position:relative;margin:8px auto 0;max-width:300px;font-size:13px;font-weight:600;line-height:1.5;color:rgba(255,255,255,.76);}',

      /* ---------- tarjeta de la membresía ---------- */
      '.vp-pr-plan{border:1.5px solid var(--border);border-radius:var(--radius-card,18px);background:var(--surface);overflow:hidden;margin-bottom:14px;}',
      '.vp-pr-plan-top{display:flex;align-items:center;gap:12px;padding:15px 16px;border-bottom:1px dashed var(--border);}',
      '.vp-pr-plan-name{flex:1;min-width:0;}',
      '.vp-pr-plan-name span{display:block;font-size:11.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-faint);}',
      '.vp-pr-plan-name b{display:block;font-size:16px;font-weight:800;color:var(--ink);margin-top:1px;}',
      '.vp-pr-price{text-align:right;flex-shrink:0;}',
      '.vp-pr-price b{display:block;font-size:23px;font-weight:800;color:var(--ink);letter-spacing:-.6px;line-height:1;}',
      '.vp-pr-price span{display:block;font-size:11.5px;font-weight:700;color:var(--ink-soft);margin-top:3px;}',
      '.vp-pr-list{list-style:none;margin:0;padding:6px 16px 14px;}',
      '.vp-pr-list li{display:flex;gap:11px;padding:10px 0;border-bottom:1px solid var(--border);}',
      '.vp-pr-list li:last-child{border-bottom:none;}',
      '.vp-pr-li-ico{flex-shrink:0;width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;',
      'background:var(--success-bg,#E5FAEC);color:var(--success,#1F7F55);}',
      '.vp-pr-li-ico svg{width:16px;height:16px;}',
      '.vp-pr-li-txt{min-width:0;}',
      '.vp-pr-li-txt b{display:block;font-size:14px;font-weight:800;color:var(--ink);line-height:1.3;}',
      '.vp-pr-li-txt small{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);line-height:1.45;margin-top:2px;}',
      '.vp-pr-list li.is-focus .vp-pr-li-ico{background:var(--accent-soft,#FFF4D6);color:#8A6000;}',
      '.vp-pr-list li.is-focus .vp-pr-li-txt b::after{content:"Lo que querías abrir";display:inline-block;margin-left:7px;vertical-align:1px;',
      'font-size:10px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:#8A6000;background:var(--accent-soft,#FFF4D6);',
      'border-radius:999px;padding:2px 7px;}',

      /* ---------- lo que sigue gratis ---------- */
      '.vp-pr-free{display:flex;gap:10px;align-items:flex-start;background:var(--surface-alt);border-radius:14px;padding:12px 13px;margin-bottom:14px;}',
      '.vp-pr-free svg{width:17px;height:17px;flex-shrink:0;margin-top:1px;color:var(--success,#1F7F55);}',
      '.vp-pr-free p{margin:0;font-size:12.5px;font-weight:600;line-height:1.5;color:var(--ink-soft);}',
      '.vp-pr-free p b{color:var(--ink);font-weight:800;}',
      '.vp-pr-fine{margin:12px 2px 0;font-size:11.5px;font-weight:600;line-height:1.5;color:var(--ink-faint);text-align:center;}',

      /* ---------- candado en la barra de abajo ---------- */
      '.navbtn .vp-lock{position:absolute;top:3px;right:50%;transform:translateX(16px);width:15px;height:15px;border-radius:50%;',
      'background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.22);}',
      '.navbtn .vp-lock svg{width:9px;height:9px;}',
      '.navbtn.active .vp-lock{background:var(--accent-strong,#F5BF3C);color:#4A3200;}',

      /* ---------- tarjeta de "estadísticas detalladas bloqueadas" ---------- */
      '.vp-pr-locked{position:relative;margin-top:26px;border:1.5px dashed var(--border);border-radius:var(--radius-card,18px);',
      'background:var(--surface);padding:20px 18px;text-align:center;overflow:hidden;}',
      '.vp-pr-locked-ghost{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;opacity:.5;}',
      '.vp-pr-locked-ghost i{display:block;height:46px;border-radius:12px;background:linear-gradient(180deg,var(--surface-alt),transparent);}',
      '.vp-pr-locked-ico{width:46px;height:46px;margin:0 auto 12px;border-radius:15px;display:flex;align-items:center;justify-content:center;',
      'background:var(--ink);color:#fff;}',
      '.vp-pr-locked-ico svg{width:22px;height:22px;}',
      '.vp-pr-locked h3{margin:0 0 6px;font-size:16.5px;font-weight:800;color:var(--ink);}',
      '.vp-pr-locked p{margin:0 auto 15px;max-width:320px;font-size:13px;font-weight:600;line-height:1.5;color:var(--ink-soft);}',
      '.vp-pr-locked .btn{max-width:320px;margin:0 auto;}',

      /* ---------- cuadro de Membresía en Mi cuenta ---------- */
      '.vp-pr-card{border:1.5px solid var(--border);border-radius:var(--radius-card,18px);background:var(--surface);padding:15px;box-shadow:var(--shadow-card);}',
      '.vp-pr-card.on{border-color:transparent;background:linear-gradient(155deg,#1C1F2B,#15391F);}',
      '.vp-pr-card-top{display:flex;align-items:center;gap:12px;}',
      '.vp-pr-card-ico{width:38px;height:38px;border-radius:13px;flex-shrink:0;display:flex;align-items:center;justify-content:center;',
      'background:var(--surface-alt);color:var(--ink);}',
      '.vp-pr-card-ico svg{width:19px;height:19px;}',
      '.vp-pr-card.on .vp-pr-card-ico{background:linear-gradient(150deg,#4FE593,#25D366);color:#0B2417;}',
      '.vp-pr-card-txt{flex:1;min-width:0;}',
      '.vp-pr-card-txt b{display:block;font-size:15px;font-weight:800;color:var(--ink);}',
      '.vp-pr-card-txt span{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-top:2px;}',
      '.vp-pr-card.on .vp-pr-card-txt b{color:#fff;}',
      '.vp-pr-card.on .vp-pr-card-txt span{color:rgba(255,255,255,.72);}',
      '.vp-pr-card .btn{margin-top:13px;}',
      '.vp-pr-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}',
      '.vp-pr-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;line-height:1.2;',
      'color:var(--ink-soft);background:var(--surface-alt);border-radius:999px;padding:5px 10px;white-space:nowrap;}',
      '.vp-pr-chip svg{width:11px;height:11px;flex:none;}',

      '@media (prefers-reduced-motion: reduce){.vp-pr-hero::after{display:none;}}'
    ].join('');
    document.head.appendChild(st);
  }

  /* =======================================================================
     4.  LA PANTALLA DE DESBLOQUEO  (el diseño nuevo que pediste)
  ======================================================================= */
  function filaHTML(clave, foco) {
    var f = FUNCIONES[clave];
    return '<li class="' + (foco === clave ? 'is-focus' : '') + '">' +
             '<span class="vp-pr-li-ico">' + ico(f.ico) + '</span>' +
             '<span class="vp-pr-li-txt"><b>' + esc(f.titulo) + '</b><small>' + esc(f.texto) + '</small></span>' +
           '</li>';
  }

  /**
   * Abre la hoja de Premium.
   * @param {string} [clave]  Qué función quiso abrir ('menu'|'chat'|'escaner'|'stats')
   */
  function abrir(clave) {
    estilos();
    var abrirModal = fn('openModal');
    if (!abrirModal) { avisar('Activa Premium desde Mi cuenta'); return; }

    /* Solo el Dueño paga: a los demás se les dice a quién pedírselo. */
    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    var precio = precioTxt();
    var f = clave && FUNCIONES[clave];

    var html =
      '<div class="vp-pr-hero">' +
        '<span class="vp-pr-crown">' + (ico('sparkle') || ico('shield')) + '</span>' +
        '<span class="vp-pr-kicker">' + ico('lock') + 'Función Premium</span>' +
        '<h1 class="vp-pr-h1">Desbloquea nuevas funciones<br>con la versión <b>Premium</b></h1>' +
        '<p class="vp-pr-lead">' +
          (f ? esc(f.titulo) + ' viene en Premium. Una sola membresía abre las cuatro.'
             : 'Una sola membresía abre las cuatro funciones de paga de Vendo Plus.') +
        '</p>' +
      '</div>' +

      '<div class="vp-pr-plan">' +
        '<div class="vp-pr-plan-top">' +
          '<span class="vp-pr-card-ico">' + (ico('sparkle') || ico('shield')) + '</span>' +
          '<span class="vp-pr-plan-name"><span>Membresía</span><b>Vendo Plus Premium</b></span>' +
          '<span class="vp-pr-price" data-vp-price><b>' + esc(precio) + '</b><span>al mes</span></span>' +
        '</div>' +
        '<ul class="vp-pr-list">' + ORDEN.map(function (k) { return filaHTML(k, clave); }).join('') + '</ul>' +
      '</div>' +

      '<div class="vp-pr-free">' + ico('check') +
        '<p><b>Lo que ya usas no se toca.</b> Vender, tickets, historial, caja, clientes, inventario, fotos de tus productos y tus estadísticas simples siguen gratis para siempre, pagues o no.</p>' +
      '</div>' +

      (esDueno
        ? '<button class="btn primary xl block" id="payBtn" onclick="VPPremium.pagar()">' + esc(botonTxt(precio)) + '</button>' +
          '<button class="btn ghost block" style="margin-top:8px;" onclick="closeModal()">Ahora no</button>' +
          (window.PlayPay
            ? '<button class="btn ghost block" style="margin-top:4px;" id="restoreBtn" onclick="PlayPay.restore()">Ya pagué · Restaurar compra</button>'
            : '') +
          '<p class="vp-pr-fine">' + esc(legalTxt()) + '</p>'
        : '<div class="vp-pr-free">' + ico('alert') +
            '<p>Solo el <b>Dueño</b> de la cuenta puede activar Premium. Pídele que entre con su usuario y lo active desde Mi cuenta.</p>' +
          '</div>' +
          '<button class="btn ghost block" onclick="closeModal()">Entendido</button>');

    abrirModal(html, { dismissible: true });

    /* En Android: pide el precio real de Google Play y repinta el botón. */
    try { if (window.PlayPay && typeof PlayPay.load === 'function') PlayPay.load().then(pintarPrecio).catch(function () {}); } catch (e) {}
  }

  function botonTxt(precio) {
    return (window.PlayPay ? 'Suscribirme · ' : 'Activar Premium · ') + (precio || precioTxt()) + '/mes';
  }
  function legalTxt() {
    return window.PlayPay
      ? 'Membresía mensual con renovación automática. Se cobra a tu cuenta de Google Play y la cancelas cuando quieras en Play Store › Pagos y suscripciones.'
      : 'Membresía mensual con renovación automática, con Stripe. La cancelas cuando quieras desde Mi cuenta.';
  }
  function pintarPrecio() {
    var p = precioTxt();
    var c = document.querySelector('[data-vp-price]');
    if (c) c.innerHTML = '<b>' + esc(p) + '</b><span>al mes</span>';
    var b = document.getElementById('payBtn');
    if (b && !b.disabled) b.textContent = botonTxt(p);
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

  /** Ya quedó pagado: se cierra la hoja y todo aparece desbloqueado. */
  function listoPremium() {
    if (!activo()) return;
    var cerrar = fn('closeModal');
    if (cerrar && document.querySelector('#modal-layer .vp-pr-hero')) cerrar();
    pintarMascota();
    marcarCandados();
    try { if (typeof window.render === 'function') window.render(); } catch (e) {}
  }

  /**
   * La puerta: si es Premium, deja pasar; si no, abre la hoja.
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
        marcarCandados();
      }
    };
    c.gate();

    /* Después de pagar (Stripe o Google Play) se repinta todo para que las
       funciones nuevas aparezcan desbloqueadas al instante. */
    var _rs = c.refreshSub;
    if (typeof _rs === 'function' && !_rs.__vpPr) {
      var envuelto = async function () {
        var antes = activo();
        var r = await _rs.apply(this, arguments);
        if (!antes && activo()) {
          listoPremium();
          try { if (window.VPMascota && typeof VPMascota.revisar === 'function') VPMascota.revisar(); } catch (e) {}
          avisar('Premium activo', { subtitle: 'Menú Digital, asistente con IA, escaneos sin límite y estadísticas detalladas', variant: 'toast-success', icon: ico('check'), duration: 4600 });
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
     6.  CUADRO DE MEMBRESÍA EN "MI CUENTA"
     Reemplaza al contador del mes gratis. Sin pagar no regaña: solo
     ofrece, y dice clarito que lo demás sigue gratis.
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
        ? (renueva ? precio + ' al mes · se cobra sola con Google Play'
                   : 'Activa hasta el ' + fecha(hasta) + ' · ya no se renovará')
        : (hasta ? precio + ' al mes · activa hasta el ' + fecha(hasta) : precio + ' al mes · se cobra sola cada mes');
      return '<div class="section-title">Membresía</div>' +
        '<div class="vp-pr-card on">' +
          '<div class="vp-pr-card-top">' +
            '<span class="vp-pr-card-ico">' + (ico('sparkle') || ico('shield')) + '</span>' +
            '<span class="vp-pr-card-txt"><b>Premium activo</b><span>' + esc(sub) + '</span></span>' +
          '</div>' +
        '</div>';
    }

    return '<div class="section-title">Membresía</div>' +
      '<div class="vp-pr-card">' +
        '<div class="vp-pr-card-top">' +
          '<span class="vp-pr-card-ico">' + ico('lock') + '</span>' +
          '<span class="vp-pr-card-txt"><b>Estás en la versión gratis</b>' +
          '<span>Vender, tickets, historial, caja, clientes e inventario: gratis para siempre.</span></span>' +
        '</div>' +
        '<div class="vp-pr-chips">' +
          ORDEN.map(function (k) {
            return '<span class="vp-pr-chip">' + ico('lock') + '<span>' + esc(chipTxt(k)) + '</span></span>';
          }).join('') +
        '</div>' +
        '<button class="btn dark block" onclick="VPPremium.abrir()">Ver qué incluye Premium · ' + esc(precio) + '/mes</button>' +
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
    /* "Pagar membresía" desde cualquier parte abre la hoja nueva. */
    try { window.openMembershipPay = function () { abrir(); }; } catch (e) {}
    try { openMembershipPay = function () { abrir(); }; } catch (e) {}
  }

  /* =======================================================================
     7.  PUERTA 1 · MENÚ DIGITAL
     Todo bloqueado: al tocarlo aparece Premium y no se entra.
  ======================================================================= */
  function engancharMenu() {
    var ir = fn('goTo');
    if (!ir || ir.__vpPr) return;
    var envuelto = function (vista) {
      if (vista === 'menu' && !activo()) { abrir('menu'); return; }
      var r = ir.apply(this, arguments);
      marcarCandados();
      return r;
    };
    envuelto.__vpPr = true;
    try { window.goTo = envuelto; } catch (e) {}
    try { goTo = envuelto; } catch (e) {}

    /* Por si alguien llega a la vista por otro camino (recarga, atajo…) */
    var rd = fn('render');
    if (rd && !rd.__vpPr) {
      var env2 = function () {
        try {
          if (ref('currentView') === 'menu' && !activo()) {
            try { currentView = 'sale'; } catch (e) {}
          }
        } catch (e) {}
        var r = rd.apply(this, arguments);
        marcarCandados();
        return r;
      };
      env2.__vpPr = true;
      try { window.render = env2; } catch (e) {}
      try { render = env2; } catch (e) {}
    }
  }

  /** Candadito en los botones de la barra de abajo que son de paga. */
  function marcarCandados() {
    try {
      var bloq = !activo();
      var bs = document.querySelectorAll('.navbtn[data-view="menu"]');
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i], ya = b.querySelector('.vp-lock');
        if (bloq && !ya) {
          var s = document.createElement('span');
          s.className = 'vp-lock';
          s.innerHTML = ico('lock');
          b.appendChild(s);
        } else if (!bloq && ya) ya.remove();
      }
    } catch (e) {}
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
   * El robot SIN suscripción tiene su propio look: no está dormido, está
   * APAGADO. Se le apaga la pantalla de la cara (ojos en gris, no verdes),
   * se queda quieto (ni flota ni parpadea), se pone en gris frío y le
   * aparece un candadito en el pecho. Se distingue de un toque del
   * dormido, que sigue verde y respirando.
   */
  function cssMascota() {
    if (document.getElementById('vp-premium-mascota-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-premium-mascota-css';
    st.textContent = [
      /* gris frío, sin brillo verde y sin movimiento */
      '#vp-mascota.vp-inactiva{filter:grayscale(.82) brightness(.97) drop-shadow(0 4px 12px rgba(22,33,62,.14));opacity:.9;}',
      '#vp-mascota.vp-inactiva .vp-m-flota{animation:none !important;}',
      '#vp-mascota.vp-inactiva .vp-brote{opacity:.5;}',
      /* la "pantalla" de la cara apagada: ojos cortitos y grises */
      '#vp-mascota.vp-inactiva .vp-ojos{fill:#8A90A3 !important;stroke:#8A90A3 !important;transform:scaleY(.42);opacity:.85;}',
      '#vp-mascota.vp-inactiva .vp-puntos{display:none;}',
      /* el candado flotando sobre el pecho */
      '#vp-mascota .vp-pr-lock{position:absolute;right:-2px;bottom:4px;width:19px;height:19px;border-radius:50%;',
      'background:var(--ink,#16213E);color:#fff;display:none;align-items:center;justify-content:center;',
      'box-shadow:0 2px 7px rgba(22,33,62,.3);border:1.5px solid var(--surface,#fff);}',
      '#vp-mascota .vp-pr-lock svg{width:10px;height:10px;}',
      '#vp-mascota.vp-inactiva .vp-pr-lock{display:flex;}',
      '#vp-mascota.vp-izquierda .vp-pr-lock{right:auto;left:-2px;}',
      /* latido lento del candado: lo único que se mueve, para que se note
         que el robot está ahí pero apagado */
      '#vp-mascota.vp-inactiva .vp-pr-lock{animation:vp-pr-pulso 2.6s ease-in-out infinite;}',
      '@keyframes vp-pr-pulso{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.1);opacity:1}}',
      /* al tocarlo: un "no" cortito, para que se entienda que está apagado */
      '#vp-mascota.vp-pr-toque{animation:vp-pr-no .4s ease;}',
      '@keyframes vp-pr-no{0%,100%{filter:grayscale(.82) brightness(.97)}',
      '22%{filter:grayscale(.3) brightness(1.04)}60%{filter:grayscale(.3) brightness(1.04)}}',
      '@media (prefers-reduced-motion: reduce){#vp-mascota.vp-inactiva .vp-pr-lock,#vp-mascota.vp-pr-toque{animation:none;}}'
    ].join('');
    document.head.appendChild(st);
  }

  function pintarMascota() {
    var n = document.getElementById('vp-mascota');
    if (!n) return;
    cssMascota();
    if (!n.querySelector('.vp-pr-lock')) {
      var s = document.createElement('span');
      s.className = 'vp-pr-lock';
      s.innerHTML = ico('lock');
      n.appendChild(s);
    }
    var off = !activo();
    n.classList.toggle('vp-inactiva', off);
    if (off) {
      /* Quieto y con la cara apagada: ni dormido ni pensando. */
      n.classList.remove('vp-dormida', 'vp-parpadea', 'vp-saluda', 'vp-habla');
      n.dataset.gesto = 'normal';
      n.setAttribute('aria-label', 'Asistente con IA · función Premium');
      n.title = 'Asistente con IA · se activa con Premium';
    } else {
      n.setAttribute('aria-label', 'Asistente de Vendo Plus');
      n.removeAttribute('title');
    }
  }

  /* =======================================================================
     9.  PUERTA 3 · ESTADÍSTICAS DETALLADAS
     Las simples (ventas netas, pedidos, ticket promedio y las gráficas)
     siguen gratis. El bloque detallado se recorta del HTML para que ni
     siquiera llegue a la pantalla, y en su lugar va la tarjeta de Premium.
  ======================================================================= */
  function tarjetaStatsHTML() {
    return '<div class="vp-pr-locked">' +
        '<div class="vp-pr-locked-ghost"><i></i><i></i><i></i></div>' +
        '<span class="vp-pr-locked-ico">' + ico('lock') + '</span>' +
        '<h3>Estadísticas detalladas</h3>' +
        '<p>Ganancia real y costo de lo vendido, cómo te pagaron, tipo de servicio, horas y días fuertes, y el reporte completo. Se desbloquea con Premium.</p>' +
        '<button type="button" class="btn dark block" onclick="VPPremium.abrir(\'stats\')">' +
          'Desbloquear con Premium · ' + esc(precioTxt()) + '/mes' +
        '</button>' +
      '</div>';
  }

  function engancharStats() {
    var rs = fn('renderStats');
    if (rs && !rs.__vpPr) {
      var envuelto = function () {
        var html = rs.apply(this, arguments);
        if (activo() || typeof html !== 'string') return html;
        /* El bloque detallado es lo último que pinta renderStats: se corta
           desde su botón y se pone la tarjeta de Premium. */
        if (html.indexOf('id="statsDetail"') < 0) return html;
        var i = html.indexOf('<button type="button" class="btn ghost block stats-detail-btn"');
        if (i < 0) i = html.indexOf('stats-detail-btn');
        if (i < 0) return html;
        /* Se retrocede hasta el inicio de esa etiqueta */
        var ini = html.lastIndexOf('<', i);
        if (ini < 0) ini = i;
        return html.slice(0, ini) + tarjetaStatsHTML();
      };
      envuelto.__vpPr = true;
      try { window.renderStats = envuelto; } catch (e) {}
      try { renderStats = envuelto; } catch (e) {}
    }

    var tg = fn('toggleStatsDetail');
    if (tg && !tg.__vpPr) {
      var env2 = function () {
        if (!activo()) { abrir('stats'); return; }
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
     Premium: sin límite. Lo de abajo solo decide si se abre el escáner o
     la hoja de Premium; el conteo lo hace vendo-escaner-ia.js con el
     servidor.
  ======================================================================= */
  var GRATIS_AL_MES = 3;
  var consumo = { restantes: null, pedido: 0 };

  /** Pregunta al servidor cuántos escaneos quedan este mes. */
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

  /** Hoja de "ya usaste tus 3 escaneos gratis de este mes". */
  function sinEscaneos() {
    estilos();
    var abrirModal = fn('openModal');
    if (!abrirModal) { avisar('Ya usaste tus 3 escaneos gratis de este mes'); return; }
    var esDueno = fn('isOwner') ? ref('isOwner')() : true;
    var precio = precioTxt();
    abrirModal(
      '<div class="vp-pr-hero">' +
        '<span class="vp-pr-crown">' + ico('camera') + '</span>' +
        '<span class="vp-pr-kicker">' + ico('lock') + 'Escaneos del mes</span>' +
        '<h1 class="vp-pr-h1">Ya usaste tus <b>3 escaneos</b><br>gratis de este mes</h1>' +
        '<p class="vp-pr-lead">Se renuevan solos el mes que entra. Si no quieres esperar, con Premium escaneas todo lo que necesites.</p>' +
      '</div>' +
      '<div class="vp-pr-free">' + ico('check') +
        '<p><b>Tus productos no se borran.</b> Todo lo que ya escaneaste se queda guardado, y agregar o editar productos a mano sigue siendo gratis e ilimitado.</p>' +
      '</div>' +
      '<div class="vp-pr-plan">' +
        '<div class="vp-pr-plan-top">' +
          '<span class="vp-pr-card-ico">' + (ico('sparkle') || ico('shield')) + '</span>' +
          '<span class="vp-pr-plan-name"><span>Membresía</span><b>Vendo Plus Premium</b></span>' +
          '<span class="vp-pr-price" data-vp-price><b>' + esc(precio) + '</b><span>al mes</span></span>' +
        '</div>' +
        '<ul class="vp-pr-list">' + ORDEN.map(function (k) { return filaHTML(k, 'escaner'); }).join('') + '</ul>' +
      '</div>' +
      (esDueno
        ? '<button class="btn primary xl block" id="payBtn" onclick="VPPremium.pagar()">' + esc(botonTxt(precio)) + '</button>' +
          '<button class="btn ghost block" style="margin-top:8px;" onclick="closeModal()">Ahora no</button>' +
          '<p class="vp-pr-fine">' + esc(legalTxt()) + '</p>'
        : '<button class="btn ghost block" onclick="closeModal()">Entendido</button>'),
      { dismissible: true });
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
     11. ENCENDER
     Las piezas (mascota, escáner, vistas) se cargan en distinto orden y
     en distinto momento según el aparato, así que se intenta enganchar
     cada una hasta que exista, sin hacer ruido.
  ======================================================================= */
  function engancharTodo() {
    soltarLaApp();
    quitarBienvenida();
    engancharCuenta();
    engancharMenu();
    engancharStats();
    var a = engancharChat();
    var b = engancharEscaner();
    pintarMascota();
    marcarCandados();
    return a && b;
  }

  function arrancar() {
    estilos();
    if (engancharTodo()) return;
    var n = 0;
    var t = setInterval(function () {
      if (engancharTodo() || ++n > 240) clearInterval(t);   /* hasta 2 min */
    }, 500);
    /* El robot y los candados se repintan cuando la app cambia de pantalla
       o cuando vuelve del cobro. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { pintarMascota(); marcarCandados(); }
    });
  }

  /* =======================================================================
     12. LO QUE QUEDA DISPONIBLE PARA EL RESTO DE VENDO PLUS
  ======================================================================= */
  window.VPPremium = {
    activo: activo,
    abrir: abrir,
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
    pintarMascota: pintarMascota,
    marcarCandados: marcarCandados
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
