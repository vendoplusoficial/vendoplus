/* =========================================================================
   VENDO PLUS · SEGUIMIENTO DEL PEDIDO  (vendo-seguimiento.js)
   -------------------------------------------------------------------------
   Esta es la pantalla que ve el CLIENTE que pidió por el Menú Digital.

   Lo primero y más importante: el cliente NO tiene cuenta. Nunca se le
   pide correo, contraseña ni registro. Lo único que lo identifica es un
   token privado de 32 caracteres que su propio celular generó al hacer
   el pedido, y que viaja en la dirección del enlace:

       https://tupagina.com/?seguir=TOKEN

   Ese enlace es una credencial de acceso limitado, no una cuenta:
   sirve para ver ESE pedido y nada más.

   Qué hace este archivo:
     · Pinta la pantalla de seguimiento con sus 4 etapas.
     · La barra animada de ida y vuelta (no es una barra de porcentaje).
     · El mapa en vivo, solo cuando el repartidor ya lleva el pedido.
     · El tiempo estimado de llegada.
     · El chat con el repartidor.
     · El código de entrega de 4 dígitos.
     · Los botones "Seguir pedido" y "Compartir pedido" de después de
       confirmar.

   Cómo se entera de los cambios: le pregunta a Supabase cada pocos
   segundos (función vp_seg_ver). No usa Realtime a propósito, porque
   Realtime necesita una sesión con usuario y aquí justamente no hay
   cuenta. Para el cliente se ve igual: la pantalla se actualiza sola,
   sin recargar. Y es más barato.

   Es el mismo archivo para la página web y para la app de Play Store.
========================================================================= */
(function () {
  'use strict';
  if (window.VPSeguimiento) return;

  /* =======================================================================
     0. ATAJOS A LO QUE YA EXISTE (igual que vendo-premium.js)
  ======================================================================= */
  function ref(n) { try { return eval(n); } catch (e) { return undefined; } }
  function fn(n) { var f = ref(n); return typeof f === 'function' ? f : null; }
  function esc(s) {
    var f = fn('escapeHtml');
    if (f) return f(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dinero(n) {
    var f = fn('formatMoney');
    return f ? f(n) : '$' + (Number(n) || 0).toFixed(2);
  }
  function menosMovimiento() {
    var f = fn('prefersLessMotion');
    if (f) return !!f();
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function vibra(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  var CFG = (window.VENDO_CONFIG || {});
  function urlSb() { return String(CFG.SUPABASE_URL || '').replace(/\/+$/, ''); }
  function keySb() { return String(CFG.SUPABASE_ANON_KEY || ''); }
  function hayNube() { return !!(urlSb() && keySb()); }

  /* Llamada a una función de Supabase. Se usa fetch directo y no la
     librería, porque esta pantalla tiene que funcionar también cuando
     el visitante no tiene ninguna sesión abierta. */
  function rpc(nombre, args) {
    if (!hayNube()) return Promise.reject(new Error('sin_nube'));
    var k = keySb();
    return fetch(urlSb() + '/rest/v1/rpc/' + nombre, {
      method: 'POST',
      headers: {
        apikey: k, Authorization: 'Bearer ' + k,
        'Content-Type': 'application/json', Accept: 'application/json'
      },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) throw new Error('http_' + r.status);
      return r.json();
    });
  }

  /* =======================================================================
     1. EL TOKEN
     Lo genera el celular del comprador con el generador seguro del
     navegador. 24 bytes = 32 caracteres en base64 seguro para URL.
  ======================================================================= */
  function tokenNuevo() {
    var b = new Uint8Array(24);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(b);
    } else {
      /* Un navegador tan viejo que no tiene crypto no debería poder
         pedir, pero por si acaso no se deja sin token. */
      for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    }
    var s = '';
    for (var j = 0; j < b.length; j++) s += String.fromCharCode(b[j]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /* Los pedidos de ESTE celular. Sirve para ofrecerle al cliente
     "¿quieres ver tu pedido de hace rato?" sin que tenga cuenta.
     OJO: es solo una comodidad. El enlace es lo que de verdad manda,
     porque el almacenamiento local se borra y no viaja a otro teléfono. */
  var LS_MIOS = 'vp_seg_mios';
  function mios() {
    try { return JSON.parse(localStorage.getItem(LS_MIOS) || '[]') || []; } catch (e) { return []; }
  }
  function guardarMio(token, code, negocio) {
    try {
      var l = mios().filter(function (x) { return x && x.token !== token; });
      l.unshift({ token: token, code: code || '', negocio: negocio || '', en: Date.now() });
      localStorage.setItem(LS_MIOS, JSON.stringify(l.slice(0, 12)));
    } catch (e) {}
  }

  function enlaceDe(token) {
    var base = location.origin + location.pathname;
    return base + '?seguir=' + encodeURIComponent(token);
  }

  /* =======================================================================
     2. ESTILOS
     Blanco, verde, bordes suaves, animaciones ligeras. Sin librerías.
  ======================================================================= */
  var cssPuesto = false;
  function estilos() {
    if (cssPuesto || document.getElementById('vp-seg-css')) { cssPuesto = true; return; }
    cssPuesto = true;
    var st = document.createElement('style');
    st.id = 'vp-seg-css';
    st.textContent = [
      '.vp-seg{position:fixed;inset:0;z-index:9000;background:#F7F8FA;overflow-y:auto;',
      '-webkit-overflow-scrolling:touch;font-family:inherit;color:#16213E;}',
      '.vp-seg-in{max-width:620px;margin:0 auto;padding:16px 14px 40px;}',

      /* ---- encabezado ---- */
      '.vp-seg-top{display:flex;align-items:center;gap:10px;margin-bottom:14px;}',
      '.vp-seg-top h1{flex:1;min-width:0;margin:0;font-size:17px;font-weight:800;line-height:1.25;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.vp-seg-x{flex:none;width:38px;height:38px;border-radius:11px;border:1px solid #E8E9EF;background:#fff;',
      'cursor:pointer;font-size:19px;line-height:1;color:#6B7487;-webkit-tap-highlight-color:transparent;}',
      '.vp-seg-x:active{transform:scale(.95);}',

      /* ---- tarjeta ---- */
      '.vp-seg-card{background:#fff;border:1px solid #E8E9EF;border-radius:14px;padding:16px 15px;',
      'margin-bottom:12px;box-shadow:0 4px 14px rgba(22,33,62,.06);}',
      '.vp-seg-card h2{margin:0 0 4px;font-size:18px;font-weight:800;line-height:1.3;}',
      '.vp-seg-card p.sub{margin:0;font-size:13.5px;font-weight:500;color:#6B7487;line-height:1.45;}',
      '.vp-seg-folio{display:inline-block;margin-top:10px;padding:5px 10px;border-radius:999px;',
      'background:#EAF9F0;color:#0FA84C;font-size:12.5px;font-weight:800;letter-spacing:.3px;}',

      /* ---- "Pedido confirmado" ----
         Lo primero que ve el cliente al confirmar, ya dentro de la
         pantalla de su pedido. Se va solo después de unos segundos. */
      '.vp-seg-nuevo{text-align:center;background:#F3FCF7;border-color:#9ADFBB;}',
      '.vp-seg-nuevo-ico{width:46px;height:46px;margin:0 auto 10px;border-radius:50%;',
      'background:#16C15B;color:#fff;font-size:24px;line-height:46px;font-weight:800;}',
      '@media (prefers-reduced-motion:no-preference){',
      '.vp-seg-nuevo{animation:vp-seg-entra .42s cubic-bezier(.22,1,.36,1) both;}',
      '@keyframes vp-seg-entra{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}}',

      /* ---- Pastilla del estado del pago ---- */
      '.vp-pago-cab{display:flex;align-items:center;gap:10px;margin-bottom:8px;}',
      '.vp-pago-cab h2{flex:1;min-width:0;}',
      '.vp-pago-pill{flex:none;padding:3px 9px;border-radius:999px;',
      'font-size:11.5px;font-weight:800;background:#FFF6E6;color:#8A6412;}',
      '.vp-pago-pill.ok{background:#EAF9F0;color:#0B7A38;}',
      '.vp-pago-pill.bad{background:#FDECEC;color:#A03030;}',

      /* ---- LA BARRA DE ETAPAS ----
         No es una barra de progreso de 0 a 100. Cada etapa es un carril
         independiente: las ya pasadas quedan llenas en verde, la etapa
         activa tiene un segmento que va y viene, y las que faltan están
         en gris. */
      '.vp-etapas{display:flex;gap:7px;margin:18px 0 12px;}',
      '.vp-etapa{flex:1 1 0;min-width:0;}',
      '.vp-etapa-carril{position:relative;height:6px;border-radius:999px;background:#E8E9EF;overflow:hidden;}',
      '.vp-etapa.hecha .vp-etapa-carril{background:#16C15B;}',
      '.vp-etapa.activa .vp-etapa-carril::after{content:"";position:absolute;top:0;bottom:0;width:45%;',
      'border-radius:999px;background:linear-gradient(90deg,rgba(22,193,91,.25),#16C15B 45%,#16C15B 55%,rgba(22,193,91,.25));',
      'animation:vp-vaiven 1.5s ease-in-out infinite alternate;}',
      '@keyframes vp-vaiven{from{transform:translateX(-10%)}to{transform:translateX(132%)}}',
      '.vp-etapa-txt{margin-top:7px;font-size:10.5px;font-weight:700;color:#9AA3B5;line-height:1.25;text-align:center;}',
      '.vp-etapa.hecha .vp-etapa-txt,.vp-etapa.activa .vp-etapa-txt{color:#0FA84C;}',
      /* Si el aparato pide menos movimiento, el carril activo se queda
         quieto y con un latido muy suave en vez de ir y venir. */
      '@media (prefers-reduced-motion: reduce){',
      '.vp-etapa.activa .vp-etapa-carril::after{animation:vp-latido 2.2s ease-in-out infinite;width:100%;transform:none;}',
      '@keyframes vp-latido{0%,100%{opacity:.45}50%{opacity:1}}}',

      /* ---- avisos ---- */
      '.vp-seg-nota{display:flex;gap:9px;align-items:flex-start;margin-top:12px;padding:10px 12px;',
      'border-radius:11px;background:#F2F5F9;font-size:12.5px;font-weight:600;color:#5A6376;line-height:1.4;}',
      '.vp-seg-nota.warn{background:#FFF6E6;color:#8A6412;}',
      '.vp-seg-nota.bad{background:#FDECEC;color:#A03030;}',

      /* ---- código de entrega ---- */
      '.vp-codigo{margin-top:12px;text-align:center;padding:15px 12px;border-radius:13px;',
      'background:#EAF9F0;border:1px dashed #9ADFBB;}',
      '.vp-codigo-n{font-size:34px;font-weight:800;letter-spacing:9px;color:#0B7A38;',
      'font-variant-numeric:tabular-nums;padding-left:9px;}',
      '.vp-codigo-t{margin-top:5px;font-size:12px;font-weight:700;color:#3B7A55;line-height:1.4;}',

      /* ---- productos ---- */
      '.vp-seg-items{list-style:none;margin:0;padding:0;}',
      '.vp-seg-items li{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #F0F1F5;font-size:13.5px;}',
      '.vp-seg-items li:last-child{border-bottom:0;}',
      '.vp-seg-items .c{flex:none;min-width:26px;font-weight:800;color:#0FA84C;}',
      '.vp-seg-items .n{flex:1;min-width:0;font-weight:600;}',
      '.vp-seg-items .p{flex:none;font-weight:700;color:#6B7487;}',
      '.vp-seg-total{display:flex;justify-content:space-between;align-items:center;margin-top:10px;',
      'padding-top:10px;border-top:1px solid #E8E9EF;font-size:15px;font-weight:800;}',

      /* ---- mapa ---- */
      '.vp-mapa{height:260px;border-radius:13px;overflow:hidden;border:1px solid #E8E9EF;background:#EDF0F4;}',
      '.vp-mapa-off{display:flex;align-items:center;justify-content:center;height:100%;padding:18px;',
      'text-align:center;font-size:13px;font-weight:600;color:#8A93A5;line-height:1.45;}',
      '.vp-eta{display:flex;align-items:baseline;gap:7px;margin-bottom:10px;}',
      '.vp-eta b{font-size:26px;font-weight:800;color:#0FA84C;line-height:1;}',
      '.vp-eta span{font-size:13px;font-weight:600;color:#6B7487;}',
      /* El punto del repartidor, dibujado con CSS (sin imágenes) */
      '.vp-rep-pin{width:22px;height:22px;border-radius:50%;background:#16C15B;border:3px solid #fff;',
      'box-shadow:0 2px 8px rgba(0,0,0,.3);}',
      '.vp-dest-pin{width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);',
      'background:#16213E;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);}',

      /* ---- botones ---- */
      '.vp-seg-btns{display:flex;gap:9px;flex-wrap:wrap;}',
      '.vp-seg-btn{flex:1 1 140px;display:inline-flex;align-items:center;justify-content:center;gap:7px;',
      'padding:13px 14px;border-radius:12px;border:1px solid #E8E9EF;background:#fff;color:#16213E;',
      'font-family:inherit;font-size:14px;font-weight:800;cursor:pointer;-webkit-tap-highlight-color:transparent;',
      'transition:transform .12s ease;}',
      '.vp-seg-btn:active{transform:scale(.97);}',
      '.vp-seg-btn.verde{background:#16C15B;border-color:#16C15B;color:#fff;}',
      '.vp-seg-btn:disabled{opacity:.55;cursor:default;}',
      '@media (prefers-reduced-motion: reduce){.vp-seg-btn{transition:none;}}',

      /* ---- chat ---- */
      '.vp-chat-lista{max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch;',
      'display:flex;flex-direction:column;gap:8px;padding:4px 2px 10px;}',
      '.vp-msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.4;',
      'font-weight:500;word-break:break-word;}',
      '.vp-msg.mio{align-self:flex-end;background:#16C15B;color:#fff;border-bottom-right-radius:4px;}',
      '.vp-msg.suyo{align-self:flex-start;background:#F0F1F5;color:#16213E;border-bottom-left-radius:4px;}',
      '.vp-msg-h{display:block;margin-top:3px;font-size:10.5px;font-weight:700;opacity:.75;}',
      '.vp-msg.pendiente{opacity:.6;}',
      '.vp-msg.fallo{background:#FDECEC;color:#A03030;}',
      '.vp-chat-form{display:flex;gap:8px;align-items:flex-end;}',
      '.vp-chat-form textarea{flex:1;min-height:42px;max-height:110px;resize:none;padding:11px 12px;',
      'border-radius:12px;border:1px solid #E8E9EF;font-family:inherit;font-size:14px;line-height:1.35;',
      'background:#fff;color:#16213E;}',
      '.vp-chat-form textarea:focus{outline:none;border-color:#16C15B;}',
      '.vp-chat-env{flex:none;width:44px;height:44px;border-radius:12px;border:none;background:#16C15B;',
      'color:#fff;font-size:18px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
      '.vp-chat-env:disabled{opacity:.5;}',

      '.vp-seg-datos{border:1px solid #E8E9EF;border-radius:11px;overflow:hidden;}',
      '.vp-seg-dato{display:flex;align-items:center;gap:9px;padding:9px 11px;border-bottom:1px solid #F0F1F5;}',
      '.vp-seg-dato:last-child{border-bottom:0;}',
      '.vp-seg-dato span{flex:none;width:104px;font-size:12px;font-weight:600;color:#6B7487;}',
      '.vp-seg-dato b{flex:1;min-width:0;font-size:13.5px;font-weight:800;word-break:break-all;}',
      '.vp-copia{flex:none;border:1px solid #E8E9EF;background:#fff;border-radius:8px;padding:5px 9px;',
      'font-family:inherit;font-size:11.5px;font-weight:800;color:#0FA84C;cursor:pointer;}',
      '.vp-seg-pie{margin-top:16px;text-align:center;font-size:11.5px;font-weight:600;color:#9AA3B5;line-height:1.5;}',
      '.vp-seg-cargando{padding:50px 20px;text-align:center;font-size:14px;font-weight:600;color:#8A93A5;}'
    ].join('');
    document.head.appendChild(st);
  }

  /* =======================================================================
     3. LOS TEXTOS DE CADA ESTADO
     Son literalmente los que pediste.
  ======================================================================= */
  var ETAPAS = ['Enviado', 'Preparando', 'En camino', 'Entregado'];

  function titulo(d) {
    if (d.estado === 'rechazado') return 'El restaurante no pudo tomar tu pedido';
    if (d.estado === 'cancelado') return 'Tu pedido fue cancelado';
    if (d.estado === 'entregado') {
      return d.tipo_entrega === 'recoger' ? '¡Tu pedido fue entregado!' : '¡Tu pedido ha sido entregado!';
    }
    if (d.estado === 'en_camino') return '¡Tu repartidor ya tiene tu pedido!';
    if (d.estado === 'listo') {
      return d.tipo_entrega === 'recoger'
        ? '¡Tu pedido ya está listo!'
        : 'Tu pedido ya está preparado';
    }
    if (d.estado === 'preparando') return 'El restaurante está preparando tu pedido';
    return 'Pedido enviado, esperando confirmación';
  }

  function subtitulo(d) {
    if (d.estado === 'rechazado') return 'Si tienes dudas, comunícate directamente con el establecimiento.';
    if (d.estado === 'cancelado') return 'Si no reconoces esta cancelación, comunícate con el establecimiento.';
    if (d.estado === 'entregado') return '¡Gracias por tu compra!';
    if (d.estado === 'en_camino') return 'Ya va en camino a tu domicilio.';
    if (d.estado === 'listo') {
      return d.tipo_entrega === 'recoger'
        ? 'Ya puedes pasar por él al establecimiento.'
        : (d.repartidor
            ? 'Tu repartidor es ' + d.repartidor + '. Está por salir con tu pedido.'
            : 'Esperando a que el repartidor salga con tu pedido.');
    }
    if (d.estado === 'preparando') return 'El establecimiento aceptó tu pedido y ya lo está preparando.';
    return 'El negocio ya tiene tu pedido. Estamos esperando que lo acepte.';
  }

  /* =======================================================================
     4. ESTADO INTERNO DE LA PANTALLA
  ======================================================================= */
  var S = {
    abierta: false,
    token: '',
    nuevo: false,          /* acaba de confirmar: se muestra el aviso */
    negocioPrevio: '',     /* nombre del negocio antes del primer dato */
    datos: null,
    pago: null,
    firma: '',
    estadoPrevio: null,
    error: '',
    ubic: null,
    mensajes: [],
    pendientes: [],      /* mensajes que se están mandando o fallaron */
    ultimoMsg: 0,
    chatAbierto: false,
    timer: null,
    timerUbic: null,
    timerMsg: null,
    timerPago: null,
    mapa: null,
    mapaNodo: null,
    marcadorRep: null,
    marcadorDest: null,
    linea: null,
    animRep: null,
    leafletPedido: false
  };

  /* =======================================================================
     5. PINTAR
  ======================================================================= */
  /* Lo primero que ve el cliente al confirmar: que su pedido llegó.
     Ya no hay una pantalla intermedia con un botón "Seguir pedido":
     entra directo aquí, y compartir el enlace es opcional. */
  function avisoNuevoHTML() {
    return '<div class="vp-seg-card vp-seg-nuevo" id="vpSegNuevo">' +
           '<div class="vp-seg-nuevo-ico">&#10004;</div>' +
           '<h2>¡Pedido confirmado!</h2>' +
           '<p class="sub">El negocio ya lo recibió. Aquí vas a ver todo lo que pase con él, ' +
           'sin recargar nada y sin ninguna cuenta.</p></div>';
  }

  function pintar() {
    var caja = document.getElementById('vpSegIn');
    if (!caja) return;

    if (S.error && !S.datos) {
      caja.innerHTML = cabeceraHTML('Seguimiento') +
        '<div class="vp-seg-card"><h2>No encontramos este pedido</h2>' +
        '<p class="sub">El enlace puede estar incompleto o el pedido ya es muy antiguo. ' +
        'Si te lo compartieron, vuelve a abrirlo desde el mensaje completo.</p></div>';
      return;
    }
    if (!S.datos) {
      caja.innerHTML = cabeceraHTML(S.negocioPrevio || 'Seguimiento') +
        (S.nuevo ? avisoNuevoHTML() : '') +
        '<div class="vp-seg-cargando">Abriendo tu pedido…</div>';
      return;
    }

    var d = S.datos;
    var h = cabeceraHTML(d.negocio || S.negocioPrevio || 'Tu pedido');

    /* ---- Pedido recién confirmado ---- */
    if (S.nuevo) h += avisoNuevoHTML();

    /* ---- Tarjeta principal: estado + etapas ---- */
    h += '<div class="vp-seg-card">';
    h += '<h2>' + esc(titulo(d)) + '</h2>';
    h += '<p class="sub">' + esc(subtitulo(d)) + '</p>';
    if (d.code) h += '<div class="vp-seg-folio">Pedido ' + esc(d.code) + '</div>';
    h += etapasHTML(d);
    if (d.estado === 'listo' && d.tipo_entrega === 'domicilio') {
      h += '<div class="vp-seg-nota">Verás el mapa y podrás escribirle al repartidor ' +
           'en cuanto salga con tu pedido.</div>';
    }
    if (d.estado === 'rechazado' || d.estado === 'cancelado') {
      h += '<div class="vp-seg-nota bad">Este pedido ya no continuará.</div>';
    }
    h += '</div>';

    /* ---- Tiempo estimado + mapa (solo cuando ya va en camino) ---- */
    if (d.estado === 'en_camino' && d.tipo_entrega === 'domicilio') {
      h += '<div class="vp-seg-card">';
      h += '<div class="vp-eta">';
      if (d.eta_min) {
        h += '<b>' + esc(String(d.eta_min)) + ' min</b><span>aproximadamente</span>';
      } else {
        h += '<span style="font-size:14px;font-weight:700;color:#6B7487">Calculando tiempo de llegada…</span>';
      }
      h += '</div>';
      /* Este div es solo el hueco. El mapa de verdad vive en S.mapaNodo,
         que se conserva entre repintados: si se volviera a crear cada
         vez, el mapa parpadearía y el cliente perdería el zoom y el
         encuadre cada pocos segundos. */
      h += '<div class="vp-mapa" id="vpSegMapa">' +
           '<div class="vp-mapa-off">Cargando el mapa…</div></div>';
      if (S.ubic && S.ubic.viejo) {
        h += '<div class="vp-seg-nota warn">La ubicación del repartidor podría estar desactualizada: ' +
             'hace un rato que su teléfono no manda su posición.</div>';
      }
      h += '<div class="vp-seg-nota">El tiempo es aproximado y puede cambiar con el tráfico. ' +
           'No es una garantía de llegada.</div>';
      h += '</div>';
    }

    /* ---- Cómo se paga ---- */
    h += pagoHTML();

    /* ---- Código de entrega ---- */
    if (d.codigo_entrega) {
      h += '<div class="vp-seg-card"><div class="vp-codigo">' +
           '<div class="vp-codigo-n">' + esc(d.codigo_entrega) + '</div>' +
           '<div class="vp-codigo-t">Proporciona este código al repartidor únicamente cuando recibas tu pedido.</div>' +
           '</div></div>';
    }

    /* ---- Chat con el repartidor ---- */
    if (d.chat_abierto) {
      h += chatHTML(d);
    }

    /* ---- Lo que pediste ---- */
    var items = Array.isArray(d.resumen) ? d.resumen : [];
    if (items.length) {
      h += '<div class="vp-seg-card"><h2 style="font-size:15px;margin-bottom:8px">Tu pedido</h2><ul class="vp-seg-items">';
      items.forEach(function (it) {
        h += '<li><span class="c">' + esc(String(it.cant || 1)) + '×</span>' +
             '<span class="n">' + esc(it.nombre || '') + '</span>' +
             '<span class="p">' + dinero((Number(it.precio) || 0) * (Number(it.cant) || 1)) + '</span></li>';
      });
      h += '</ul>';
      if (Number(d.total)) {
        h += '<div class="vp-seg-total"><span>Total</span><span>' + dinero(d.total) + '</span></div>';
      }
      h += '</div>';
    }

    /* ---- Datos de la entrega ---- */
    h += '<div class="vp-seg-card">';
    h += '<h2 style="font-size:15px;margin-bottom:8px">' +
         (d.tipo_entrega === 'recoger' ? 'Para recoger' : 'Entrega a domicilio') + '</h2>';
    if (d.tipo_entrega === 'recoger') {
      h += '<p class="sub">Pasa por tu pedido al establecimiento cuando esté listo.</p>';
    } else {
      h += '<p class="sub">' + esc(d.destino || 'La dirección que indicaste al pedir.') + '</p>';
      if (d.repartidor) {
        h += '<p class="sub" style="margin-top:6px">Tu repartidor es <b>' + esc(d.repartidor) + '</b>.</p>';
      }
    }
    h += '</div>';

    /* ---- Compartir ---- */
    h += '<div class="vp-seg-card"><div class="vp-seg-btns">' +
         '<button type="button" class="vp-seg-btn" onclick="VPSeguimiento.compartir()">Compartir pedido</button>' +
         '<button type="button" class="vp-seg-btn" onclick="VPSeguimiento.copiar()">Copiar enlace</button>' +
         '</div></div>';

    h += '<div class="vp-seg-pie">Guarda este enlace para volver a ver tu pedido.<br>' +
         'Funciona desde cualquier teléfono, sin crear ninguna cuenta.</div>';

    caja.innerHTML = h;

    if (d.estado === 'en_camino' && d.tipo_entrega === 'domicilio') {
      reponerMapa();
      montarMapa();
    }
    if (d.chat_abierto) scrollChatAbajo();
  }

  /* Vuelve a meter el mapa ya creado en su hueco después de repintar.
     Leaflet necesita que le avisen de que cambió de sitio. */
  function reponerMapa() {
    var hueco = document.getElementById('vpSegMapa');
    if (!hueco || !S.mapaNodo) return;
    if (S.mapaNodo.parentNode === hueco) return;
    hueco.innerHTML = '';
    hueco.appendChild(S.mapaNodo);
    if (S.mapa && S.mapa.invalidateSize) {
      setTimeout(function () { try { S.mapa.invalidateSize(); } catch (e) {} }, 30);
    }
  }

  /* Resumen de lo que se ve en pantalla. Si no cambia, no hace falta
     repintar: así no se tira el mapa ni se pierde lo que el cliente
     esté escribiendo en el chat. */
  function firma(d) {
    if (!d) return '';
    return [d.estado, d.etapa, d.eta_min, d.codigo_entrega, d.repartidor,
            d.chat_abierto, d.total, (d.resumen || []).length, d.negocio].join('|');
  }

  /* =======================================================================
     5b. CÓMO SE PAGA
     Tres formas, exactamente las que pediste:
       · Efectivo      → se le recuerda que pague al recibir
       · Transferencia → se le muestran los datos del negocio y el
                         concepto. NADIE marca nada como pagado solo:
                         lo confirma el negocio cuando ve el dinero.
       · Tarjeta       → Mercado Pago, y el cobro entra DIRECTO a la
                         cuenta del negocio.
  ======================================================================= */
  function pagoHTML() {
    var p = S.pago;
    if (!p || !p.ok || !p.metodo) return '';
    var pagado = p.estado === 'pagado';
    var h = '<div class="vp-seg-card">';
    /* La pastilla va FUERA del título, no dentro: así el encabezado
       sigue diciendo solo "Tu pago". */
    h += '<div class="vp-pago-cab"><h2 style="font-size:15px;margin:0">Tu pago</h2>' +
         '<span class="vp-pago-pill' + (pagado ? ' ok' : (p.estado === 'rechazado' ? ' bad' : '')) + '">' +
         (pagado ? 'Pagado' : p.estado === 'rechazado' ? 'Rechazado' : 'Pendiente') +
         '</span></div>';

    if (p.metodo === 'efectivo') {
      h += '<p class="sub">' + (pagado
        ? 'El negocio ya registró tu pago en efectivo.'
        : 'Pagas <b>' + dinero(p.monto) + '</b> en efectivo cuando ' +
          (S.datos && S.datos.tipo_entrega === 'recoger'
            ? 'pases por tu pedido.' : 'te entreguen tu pedido.')) + '</p>';

    } else if (p.metodo === 'transferencia') {
      if (pagado) {
        h += '<p class="sub">El negocio ya confirmó tu transferencia. ¡Gracias!</p>';
      } else {
        var t = p.transferencia || {};
        h += '<p class="sub" style="margin-bottom:10px">Haz la transferencia con estos datos. ' +
             'El negocio la confirma en cuanto le llegue el dinero.</p>';
        h += '<div class="vp-seg-datos">';
        if (t.banco)   h += filaDato('Banco', t.banco);
        if (t.titular) h += filaDato('A nombre de', t.titular);
        if (t.clabe)   h += filaDato('CLABE o cuenta', t.clabe, true);
        h += filaDato('Importe', dinero(p.monto));
        if (t.concepto) h += filaDato('Concepto', t.concepto, true);
        h += '</div>';
        if (t.nota) h += '<p class="sub" style="margin-top:8px">' + esc(t.nota) + '</p>';
        h += '<div class="vp-seg-nota">Tu pedido se marca como pagado cuando el negocio ' +
             'confirma que recibió la transferencia.</div>';
      }

    } else if (p.metodo === 'tarjeta') {
      if (pagado) {
        h += '<p class="sub">Pago con tarjeta confirmado. ¡Gracias!</p>';
      } else if (p.estado === 'rechazado') {
        h += '<div class="vp-seg-nota bad">Tu pago fue rechazado. Puedes intentar otra vez.</div>' +
             botonPagar('Intentar de nuevo');
      } else {
        h += '<p class="sub" style="margin-bottom:10px">Paga con tarjeta de crédito o débito ' +
             'de forma segura. El cobro lo hace Mercado Pago y el dinero va directo al negocio.</p>' +
             botonPagar('Pagar ' + dinero(p.monto) + ' con tarjeta');
      }
    }
    return h + '</div>';
  }

  function botonPagar(txt) {
    return '<button type="button" class="vp-seg-btn verde" id="vpPagarBtn" ' +
           'style="width:100%" onclick="VPSeguimiento.pagar()">' + esc(txt) + '</button>';
  }

  function filaDato(etiqueta, valor, copiable) {
    return '<div class="vp-seg-dato"><span>' + esc(etiqueta) + '</span>' +
      '<b>' + esc(valor) + '</b>' +
      (copiable ? '<button type="button" class="vp-copia" onclick="VPSeguimiento.copiarTexto(\'' +
        esc(String(valor).replace(/'/g, "\\'")) + '\')">Copiar</button>' : '') +
      '</div>';
  }

  /** Abre el pago con tarjeta. */
  function pagar() {
    var b = document.getElementById('vpPagarBtn');
    if (b) { b.disabled = true; b.textContent = 'Abriendo Mercado Pago…'; }
    fetch(urlSb() + '/functions/v1/vp-mp-preferencia', {
      method: 'POST',
      headers: { apikey: keySb(), Authorization: 'Bearer ' + keySb(),
                 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: S.token })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ya_pagado) { traerPago(); return; }
      if (j && j.ok && j.init_point) { location.href = j.init_point; return; }
      if (b) { b.disabled = false; b.textContent = 'Pagar con tarjeta'; }
      var m = (j && j.error === 'negocio_sin_mercadopago')
        ? 'El negocio todavía no tiene activado el pago con tarjeta. Contáctalo para pagar de otra forma.'
        : 'No pudimos abrir el pago. Intenta de nuevo en un momento.';
      var f = fn('toast'); if (f) f(m); else alert(m);
    }).catch(function () {
      if (b) { b.disabled = false; b.textContent = 'Pagar con tarjeta'; }
    });
  }

  function copiarTexto(t) {
    var listo = function () { var f = fn('toast'); if (f) f('Copiado'); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(listo, function () { copiarViejo(t, listo); });
    else copiarViejo(t, listo);
  }

  function traerPago() {
    if (!S.abierta || !S.token) return;
    rpc('vp_seg_pago', { p_token: S.token }).then(function (p) {
      if (!S.abierta || !p || p.ok !== true) return;
      var antes = S.pago ? (S.pago.estado + S.pago.metodo) : '';
      S.pago = p;
      if (antes !== (p.estado + p.metodo)) pintar();
    }).catch(function () {});
  }

  function cabeceraHTML(t) {
    return '<div class="vp-seg-top">' +
      '<h1>' + esc(t) + '</h1>' +
      '<button type="button" class="vp-seg-x" onclick="VPSeguimiento.cerrar()" aria-label="Cerrar">&times;</button>' +
      '</div>';
  }

  /* La barra de etapas. La etapa activa es la única que lleva la
     animación de ida y vuelta; las anteriores quedan completadas y las
     siguientes, pendientes. */
  function etapasHTML(d) {
    var n = Number(d.etapa) || 0;
    if (n === 0) return '';   /* rechazado o cancelado: no se muestran etapas */
    var h = '<div class="vp-etapas" role="group" aria-label="Avance del pedido">';
    for (var i = 1; i <= 4; i++) {
      var cls = i < n ? 'hecha' : (i === n ? 'activa hecha' : '');
      /* La etapa 4 (entregado) ya no se anima: el pedido terminó. */
      if (i === n && n === 4) cls = 'hecha';
      h += '<div class="vp-etapa ' + cls + '">' +
           '<div class="vp-etapa-carril"></div>' +
           '<div class="vp-etapa-txt">' + ETAPAS[i - 1] + '</div>' +
           '</div>';
    }
    return h + '</div>';
  }

  function chatHTML(d) {
    var todos = S.mensajes.concat(S.pendientes);
    var h = '<div class="vp-seg-card">';
    h += '<h2 style="font-size:15px;margin-bottom:4px">Mensajes con tu repartidor</h2>';
    h += '<p class="sub" style="margin-bottom:8px">Solo durante la entrega.</p>';
    h += '<div class="vp-chat-lista" id="vpChatLista">';
    if (!todos.length) {
      h += '<p class="sub" style="text-align:center;padding:14px 0">Aún no hay mensajes. ' +
           'Escríbele si necesitas darle alguna indicación.</p>';
    }
    todos.forEach(function (m) {
      var mio = m.de === 'comprador';
      var cls = 'vp-msg ' + (mio ? 'mio' : 'suyo') +
                (m._estado === 'enviando' ? ' pendiente' : '') +
                (m._estado === 'fallo' ? ' fallo' : '');
      var hora = m._estado === 'enviando' ? 'Enviando…'
               : m._estado === 'fallo' ? 'No se envió · toca para reintentar'
               : horaCorta(m.creado_en);
      h += '<div class="' + cls + '"' +
           (m._estado === 'fallo' ? ' onclick="VPSeguimiento.reintentar(\'' + esc(m._id) + '\')"' : '') + '>' +
           esc(m.texto) + '<span class="vp-msg-h">' + esc(hora) + '</span></div>';
    });
    h += '</div>';
    h += '<div class="vp-chat-form">' +
         '<textarea id="vpChatTxt" rows="1" maxlength="500" placeholder="Escribe un mensaje…" ' +
         'oninput="VPSeguimiento.crecer(this)"></textarea>' +
         '<button type="button" class="vp-chat-env" onclick="VPSeguimiento.enviar()" aria-label="Enviar">&#10148;</button>' +
         '</div></div>';
    return h;
  }

  function horaCorta(iso) {
    try {
      var f = new Date(iso);
      return f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function scrollChatAbajo() {
    var l = document.getElementById('vpChatLista');
    if (l) l.scrollTop = l.scrollHeight;
  }

  /* =======================================================================
     6. EL MAPA
     Se usa Leaflet con mapas de OpenStreetMap: es ligero, gratis y no
     necesita clave. Si configuras otro proveedor en VENDO_MAPS, se usa
     ese. Todo esto está explicado en la guía de mapas.
  ======================================================================= */
  var MAPS = window.VENDO_MAPS || {};
  var TILES = MAPS.tiles || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILES_ATTR = MAPS.attr || '&copy; OpenStreetMap';

  function cargarLeaflet() {
    if (window.L) return Promise.resolve(true);
    if (S.leafletPedido) {
      return new Promise(function (res) {
        var t = setInterval(function () { if (window.L) { clearInterval(t); res(true); } }, 120);
        setTimeout(function () { clearInterval(t); res(!!window.L); }, 8000);
      });
    }
    S.leafletPedido = true;
    return new Promise(function (res) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
      s.onload = function () { res(true); };
      s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
  }

  function montarMapa() {
    var hueco = document.getElementById('vpSegMapa');
    if (!hueco) return;
    var u = S.ubic;

    if (!u || !u.hay) {
      /* Si ya había mapa, se deja: que el último punto conocido se siga
         viendo es mejor que un hueco gris. */
      if (!S.mapaNodo) {
        hueco.innerHTML = '<div class="vp-mapa-off">Esperando la ubicación del repartidor…</div>';
      }
      return;
    }

    /* El mapa ya existe: solo hay que asegurarse de que esté en su sitio
       y mover el punto. Nunca se vuelve a crear. */
    if (S.mapa && S.mapaNodo) { reponerMapa(); dibujar(); return; }

    cargarLeaflet().then(function (ok) {
      var h2 = document.getElementById('vpSegMapa');
      if (!h2) return;
      if (!ok) {
        h2.innerHTML = '<div class="vp-mapa-off">No se pudo cargar el mapa.<br>' +
          'Tu pedido sigue en camino.</div>';
        return;
      }
      if (S.mapa && S.mapaNodo) { reponerMapa(); dibujar(); return; }

      S.mapaNodo = document.createElement('div');
      S.mapaNodo.style.width = '100%';
      S.mapaNodo.style.height = '100%';
      h2.innerHTML = '';
      h2.appendChild(S.mapaNodo);

      S.mapa = L.map(S.mapaNodo, {
        zoomControl: true, attributionControl: true,
        dragging: true, scrollWheelZoom: false, tap: true
      });
      L.tileLayer(TILES, { maxZoom: 19, attribution: TILES_ATTR }).addTo(S.mapa);
      S.marcadorRep = null; S.marcadorDest = null; S.linea = null;
      dibujar();
    });
  }

  function iconoDiv(cls) {
    return L.divIcon({ className: '', html: '<div class="' + cls + '"></div>',
                       iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  function dibujar() {
    var u = S.ubic;
    if (!S.mapa || !u || !u.hay) return;
    var rep = [u.lat, u.lng];
    var dest = (u.destino_lat != null && u.destino_lng != null) ? [u.destino_lat, u.destino_lng] : null;

    if (!S.marcadorRep) {
      S.marcadorRep = L.marker(rep, { icon: iconoDiv('vp-rep-pin'), keyboard: false }).addTo(S.mapa);
    } else {
      moverSuave(S.marcadorRep, rep);
    }
    if (dest && !S.marcadorDest) {
      S.marcadorDest = L.marker(dest, { icon: iconoDiv('vp-dest-pin'), keyboard: false }).addTo(S.mapa);
    }
    if (dest) {
      var pts = [rep, dest];
      if (!S.linea) {
        S.linea = L.polyline(pts, { color: '#16C15B', weight: 3, opacity: .55, dashArray: '7 9' }).addTo(S.mapa);
      } else {
        S.linea.setLatLngs(pts);
      }
      try { S.mapa.fitBounds(L.latLngBounds(pts).pad(0.35), { animate: false }); } catch (e) {}
    } else {
      S.mapa.setView(rep, 16, { animate: false });
    }
  }

  /* El GPS llega cada pocos segundos y a saltos. Para que el punto no
     brinque, se desliza de una posición a la otra. Es solo visual: no se
     inventa ninguna posición que no haya mandado el repartidor. */
  function moverSuave(marcador, destino) {
    if (menosMovimiento()) { marcador.setLatLng(destino); return; }
    var ini = marcador.getLatLng();
    var d = Math.abs(ini.lat - destino[0]) + Math.abs(ini.lng - destino[1]);
    if (d < 1e-7 || d > 0.05) { marcador.setLatLng(destino); return; }
    if (S.animRep) cancelAnimationFrame(S.animRep);
    var t0 = performance.now(), dur = 900;
    (function paso(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = k < .5 ? 2 * k * k : -1 + (4 - 2 * k) * k;   /* suavizado */
      marcador.setLatLng([ini.lat + (destino[0] - ini.lat) * e,
                          ini.lng + (destino[1] - ini.lng) * e]);
      if (k < 1) S.animRep = requestAnimationFrame(paso);
    })(t0);
  }

  /* =======================================================================
     7. TRAER DATOS
     Se pregunta cada pocos segundos, y se deja de preguntar cuando la
     pantalla no está a la vista o el pedido ya terminó. Así no se gasta
     batería ni se hacen llamadas de más.
  ======================================================================= */
  function terminado(d) {
    return d && (d.estado === 'entregado' || d.estado === 'rechazado' || d.estado === 'cancelado');
  }

  function traer() {
    if (!S.abierta || !S.token) return Promise.resolve();
    return rpc('vp_seg_ver', { p_token: S.token }).then(function (d) {
      if (!S.abierta) return;
      if (!d || d.ok !== true) { S.error = (d && d.error) || 'no_encontrado'; pintar(); return; }
      /* Se guardan el estado y la firma ANTERIORES como texto, no como
         referencia al objeto: así la comparación es correcta aunque el
         objeto que llega sea el mismo de antes. */
      var antes = S.estadoPrevio;
      var firmaAntes = S.firma;
      S.datos = d;
      S.error = '';
      S.estadoPrevio = d.estado;
      S.firma = firma(d);
      if (antes && antes !== d.estado) vibra(30);
      guardarMio(S.token, d.code, d.negocio);
      /* Solo se repinta si de verdad cambió algo que se ve. */
      if (S.firma !== firmaAntes) pintar();
      /* Si acaba de empezar el reparto, se pide la ubicación y los
         mensajes AHORA mismo: esperar al siguiente ciclo haría que el
         cliente viera el mapa vacío hasta 10 segundos. */
      if (antes !== d.estado) {
        if (d.estado === 'en_camino') { traerUbic(); traerMsgs(); }
      }
      if (terminado(d)) pararTodo(true);
    }).catch(function () {
      /* Sin internet: se deja lo último que se vio, sin romper nada. */
    });
  }

  function traerUbic() {
    if (!S.abierta || !S.datos || S.datos.estado !== 'en_camino') return;
    rpc('vp_seg_ubicacion', { p_token: S.token }).then(function (u) {
      if (!S.abierta || !u || u.ok !== true) return;
      var viejoAntes = !!(S.ubic && S.ubic.viejo);
      S.ubic = u;
      /* El aviso de "la ubicación podría estar desactualizada" aparece y
         desaparece: solo entonces hace falta repintar la tarjeta. */
      if (!!u.viejo !== viejoAntes || !document.getElementById('vpSegMapa')) {
        pintar();
        return;
      }
      montarMapa();
    }).catch(function () {});
  }

  function traerMsgs() {
    if (!S.abierta || !S.datos || !S.datos.chat_abierto) return;
    rpc('vp_seg_mensajes', { p_token: S.token, p_desde: S.ultimoMsg }).then(function (r) {
      if (!S.abierta || !r || r.ok !== true) return;
      var nuevos = r.mensajes || [];
      if (!nuevos.length) return;
      nuevos.forEach(function (m) {
        if (m.id > S.ultimoMsg) S.ultimoMsg = m.id;
        /* Si es un mensaje mío que ya llegó al servidor, se quita de los pendientes */
        S.pendientes = S.pendientes.filter(function (p) {
          return !(p.de === m.de && p.texto === m.texto);
        });
        S.mensajes.push(m);
      });
      if (nuevos.some(function (m) { return m.de === 'repartidor'; })) vibra(25);
      pintar();
    }).catch(function () {});
  }

  function arrancarTimers() {
    pararTodo();
    /* Cada 5 segundos el estado; cada 10 la ubicación; cada 4 los mensajes.
       Son números pensados para que se sienta en vivo sin gastar de más. */
    S.timer = setInterval(function () { if (!document.hidden) traer(); }, 5000);
    S.timerUbic = setInterval(function () { if (!document.hidden) traerUbic(); }, 10000);
    S.timerMsg = setInterval(function () { if (!document.hidden) traerMsgs(); }, 4000);
    /* El pago cambia pocas veces, asi que basta con revisarlo cada 12 s. */
    S.timerPago = setInterval(function () { if (!document.hidden) traerPago(); }, 12000);
  }

  function pararTodo(soloTimers) {
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    if (S.timerUbic) { clearInterval(S.timerUbic); S.timerUbic = null; }
    if (S.timerMsg) { clearInterval(S.timerMsg); S.timerMsg = null; }
    if (S.timerPago) { clearInterval(S.timerPago); S.timerPago = null; }
    if (!soloTimers && S.animRep) { cancelAnimationFrame(S.animRep); S.animRep = null; }
  }

  /* =======================================================================
     8. ABRIR Y CERRAR
  ======================================================================= */
  /* op.nuevo  → el cliente acaba de confirmar: se le enseña el aviso de
                 "pedido confirmado" arriba, en esta misma pantalla.
     op.negocio → nombre del negocio mientras llega el primer dato. */
  function abrir(token, op) {
    if (!token) return;
    op = op || {};
    estilos();
    S.token = token;
    S.nuevo = !!op.nuevo;
    S.negocioPrevio = op.negocio || '';
    S.abierta = true;
    S.datos = null; S.pago = null; S.firma = ''; S.estadoPrevio = null; S.error = ''; S.ubic = null;
    S.mensajes = []; S.pendientes = []; S.ultimoMsg = 0;
    S.mapa = null; S.mapaNodo = null; S.marcadorRep = null; S.marcadorDest = null; S.linea = null;

    var cap = document.getElementById('vpSegCapa');
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'vpSegCapa';
      cap.className = 'vp-seg';
      cap.innerHTML = '<div class="vp-seg-in" id="vpSegIn"></div>';
      document.body.appendChild(cap);
    }
    cap.style.display = '';
    document.body.style.overflow = 'hidden';

    pintar();
    traer().then(function () { traerUbic(); traerMsgs(); traerPago(); });
    arrancarTimers();
    if (S.nuevo) {
      vibra([60, 40, 60]);
      /* El aviso de "confirmado" se queda un rato y luego se quita solo:
         a partir de ahí lo que importa es el estado del pedido. */
      setTimeout(function () {
        if (!S.abierta) return;
        S.nuevo = false;
        var b = document.getElementById('vpSegNuevo');
        if (b && b.parentNode) b.parentNode.removeChild(b);
      }, 12000);
    }

    /* Al volver a la pestaña se revisa enseguida, sin esperar al ciclo. */
    if (!S._visListo) {
      S._visListo = true;
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && S.abierta) { traer(); traerUbic(); traerMsgs(); traerPago(); }
      });
    }
    try { history.replaceState(null, '', enlaceDe(token)); } catch (e) {}
  }

  function cerrar() {
    S.abierta = false;
    pararTodo();
    var cap = document.getElementById('vpSegCapa');
    if (cap) cap.style.display = 'none';
    document.body.style.overflow = '';
    try {
      var u = new URL(location.href);
      u.searchParams.delete('seguir');
      history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
    } catch (e) {}
  }

  /* =======================================================================
     9. COMPARTIR  (sin contratar ninguna API de WhatsApp)
     Se usa el menú de compartir del propio teléfono. Si no existe, se
     abre el enlace de WhatsApp de toda la vida. Y siempre está la
     opción de copiar.
  ======================================================================= */
  function textoCompartir(d) {
    var n = (d && d.negocio) ? d.negocio : 'mi pedido';
    var c = (d && d.code) ? (' ' + d.code) : '';
    return 'Sigue mi pedido' + c + ' de ' + n + ': ';
  }

  function compartir(token) {
    var t = token || S.token;
    if (!t) return;
    var url = enlaceDe(t);
    var txt = textoCompartir(S.datos);
    if (navigator.share) {
      navigator.share({ title: 'Seguimiento de mi pedido', text: txt, url: url })
        .catch(function () {});
      return;
    }
    var wa = 'https://wa.me/?text=' + encodeURIComponent(txt + url);
    var w = window.open(wa, '_blank');
    if (!w) location.href = wa;
  }

  function copiar(token) {
    var url = enlaceDe(token || S.token);
    var listo = function () {
      var f = fn('toast');
      if (f) f('Enlace copiado'); else alert('Enlace copiado:\n' + url);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(listo, function () { copiarViejo(url, listo); });
    } else {
      copiarViejo(url, listo);
    }
  }
  function copiarViejo(url, listo) {
    try {
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      listo();
    } catch (e) { alert(url); }
  }

  /* =======================================================================
     10. CHAT · ENVIAR
     Se pinta el mensaje enseguida como "enviando". Si falla, se marca y
     se puede tocar para reintentar.
  ======================================================================= */
  function enviar() {
    var ta = document.getElementById('vpChatTxt');
    if (!ta) return;
    var txt = (ta.value || '').trim();
    if (!txt) return;
    ta.value = '';
    ta.style.height = '';
    mandar(txt);
  }

  function mandar(txt, idExistente) {
    var id = idExistente || ('p' + Date.now() + Math.random().toString(36).slice(2, 7));
    var m = S.pendientes.filter(function (x) { return x._id === id; })[0];
    if (!m) {
      m = { _id: id, de: 'comprador', texto: txt, _estado: 'enviando', creado_en: new Date().toISOString() };
      S.pendientes.push(m);
    } else {
      m._estado = 'enviando';
    }
    pintar(); scrollChatAbajo();

    rpc('vp_seg_enviar', { p_token: S.token, p_texto: txt }).then(function (r) {
      if (r && r.ok === true) {
        /* Se queda como pendiente hasta que lo devuelva vp_seg_mensajes,
           así nunca se ve duplicado. */
        traerMsgs();
      } else {
        m._estado = 'fallo';
        pintar();
      }
    }).catch(function () {
      m._estado = 'fallo';
      pintar();
    });
  }

  function reintentar(id) {
    var m = S.pendientes.filter(function (x) { return x._id === id; })[0];
    if (m) mandar(m.texto, id);
  }

  function crecer(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
  }

  /* =======================================================================
     10b. PANTALLA DE RESPALDO
     Normalmente el cliente ya NO pasa por aquí: al confirmar entra
     directo a la pantalla de su pedido. Esta pantalla solo aparece
     cuando el pedido sí llegó al negocio pero no se pudo crear su
     enlace de seguimiento (internet malo en ese segundo exacto).
     WhatsApp ya no interviene en nada de esto.
  ======================================================================= */
  function panelEnviado(op) {
    op = op || {};
    estilos();
    var token = op.token || '';
    var code = op.code || '';

    var cap = document.getElementById('vpEnvCapa');
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'vpEnvCapa';
      cap.className = 'vp-seg';
      document.body.appendChild(cap);
    }
    cap.style.display = '';
    document.body.style.overflow = 'hidden';

    var h = '<div class="vp-seg-in" style="padding-top:34px">';
    h += '<div class="vp-seg-card" style="text-align:center">';
    h += '<div style="font-size:46px;line-height:1;margin-bottom:8px">&#127881;</div>';
    h += '<h2>¡Tu pedido fue enviado!</h2>';
    h += '<p class="sub">El establecimiento ya lo recibió' +
         (op.negocio ? ' en ' + esc(op.negocio) : '') + '.</p>';
    if (code) h += '<div class="vp-seg-folio">Pedido ' + esc(code) + '</div>';
    h += '</div>';

    h += '<div class="vp-seg-card">';
    if (token) {
      h += '<div class="vp-seg-btns">';
      h += '<button type="button" class="vp-seg-btn verde" ' +
           'onclick="VPSeguimiento._verDesdeEnviado()">Ver mi pedido</button>';
      h += '<button type="button" class="vp-seg-btn" ' +
           'onclick="VPSeguimiento.compartir()">Compartir</button>';
      h += '</div>';
      h += '<p class="sub" style="margin-top:12px;font-size:12.5px">Guarda este enlace: con él puedes ' +
           'ver tu pedido más tarde, desde este o desde cualquier otro teléfono. No necesitas ninguna cuenta.</p>';
    } else {
      /* El pedido SÍ está con el negocio. Lo que falló fue el enlace.
         Se dice tal cual, sin prometer lo que no hay. */
      h += '<p class="sub">Tu pedido ya está con el negocio, pero no pudimos crear tu enlace ' +
           'de seguimiento por un problema de conexi\u00f3n. Apunta tu n\u00famero de pedido' +
           (code ? ' (' + esc(code) + ')' : '') + ': con \u00e9l el negocio te puede decir ' +
           'c\u00f3mo va tu pedido.</p>';
    }
    h += '</div>';

    h += '<div class="vp-seg-btns"><button type="button" class="vp-seg-btn" ' +
         'onclick="VPSeguimiento._cerrarEnviado()">Seguir comprando</button></div>';
    h += '</div>';

    cap.innerHTML = h;
    S.token = token;
    if (token) guardarMio(token, code, op.negocio);
    vibra([60, 40, 60]);
  }

  function cerrarEnviado() {
    var cap = document.getElementById('vpEnvCapa');
    if (cap) cap.style.display = 'none';
    if (!S.abierta) document.body.style.overflow = '';
  }

  /* =======================================================================
     11. ARRANQUE: ¿viene un enlace de seguimiento?
  ======================================================================= */
  function tokenDeLaURL() {
    try {
      var u = new URL(location.href);
      var t = u.searchParams.get('seguir');
      if (t) return t;
      var m = (location.hash || '').match(/seguir=([A-Za-z0-9_-]{20,})/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  function arrancar() {
    estilos();
    var t = tokenDeLaURL();
    if (t) abrir(t);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    setTimeout(arrancar, 0);
  }

  /* =======================================================================
     12. LO QUE QUEDA DISPONIBLE PARA EL RESTO DE VENDO PLUS
  ======================================================================= */
  window.VPSeguimiento = {
    tokenNuevo: tokenNuevo,
    enlaceDe: enlaceDe,
    abrir: abrir,
    cerrar: cerrar,
    compartir: compartir,
    copiar: copiar,
    copiarTexto: copiarTexto,
    pagar: pagar,
    enviar: enviar,
    reintentar: reintentar,
    crecer: crecer,
    mios: mios,
    guardarMio: guardarMio,
    panelEnviado: panelEnviado,
    _cerrarEnviado: cerrarEnviado,
    _verDesdeEnviado: function () { cerrarEnviado(); abrir(S.token); },
    /* Registra el seguimiento en el servidor justo después de mandar el
       pedido. Lo llama index.html. */
    registrar: function (menuId, code, token) {
      return rpc('vp_pedido_registrar', { p_menu_id: menuId, p_code: code, p_token: token })
        .then(function (r) { return !!(r && r.ok); })
        .catch(function () { return false; });
    },
    _estado: S
  };
})();
