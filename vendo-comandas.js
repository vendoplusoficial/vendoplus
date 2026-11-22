/* =========================================================================
   VENDO PLUS · COMANDAS  (vendo-comandas.js)
   -------------------------------------------------------------------------
   Mesas, meseros, cocina y cuentas, dentro de VendoPlus.

   CÓMO FUNCIONA (en corto):
     · La cuenta con la que entras a VendoPlus ES el dueño. Siempre.
       No hay códigos, no hay que enlazar nada con nadie.
     · Los meseros y cocineros son los usuarios que YA tienes en
       Configuración → Usuarios, cada quien con su NIP. Desde la pantalla
       de Comandas le dices a cada uno en qué área trabaja.
     · Hay 3 secciones: Caja (siempre encendida, es el VendoPlus de
       siempre), Mesero y Cocinero. El dueño las prende o las apaga.
     · Cada empleado abre el área asignada cuando inicia sesión.
     · Solo el dueño puede modificar. Los demás usuarios pueden ver
       quién está en cada área, pero no cambiar nada.

   CÓMO ESTÁ HECHO:
     · Un solo archivo, envuelto en su propia función, igual que
       vendo-premium.js. No ensucia nada de lo que ya existe.
     · No reemplaza ninguna función de VendoPlus. Solo ENVUELVE tres
       (confirmarCobro, mdiConfirm y openUserSession) para enterarse de
       lo que pasó, y siempre llama primero a la original.
     · Las pantallas se registran en EXTRA_VIEWS, que es el lugar que
       VendoPlus ya tiene para secciones nuevas.
     · El inventario NO se toca aquí: se sigue descontando al cobrar.

   Es el mismo archivo para la página web y para la app de Play Store.
========================================================================= */
(function () {
  'use strict';
  if (window.VPComandas) return;

  /* =======================================================================
     1.  PUENTES A LO QUE YA EXISTE
  ======================================================================= */
  function ref(n) { try { return eval(n); } catch (e) { return undefined; } }
  function fn(n) { var f = ref(n); return typeof f === 'function' ? f : null; }
  function esc(s) { var f = fn('escapeHtml'); var t = String(s == null ? '' : s); return f ? f(t) : t.replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function js(s) { return JSON.stringify(String(s == null ? '' : s)).replace(/"/g, '&quot;'); }
  function ico(n) { var f = fn('icon'); return f ? f(n) : ''; }
  function money(n) { var f = fn('formatMoney'); return f ? f(Number(n) || 0) : '$' + (Number(n) || 0).toFixed(2); }
  function avisar(m, o) { var f = fn('toast'); if (f) f(m, o || {}); }
  function irA(v) { var f = fn('goTo'); if (f) f(v); }
  function abrirModal(h, o) { var f = fn('openModal'); if (f) f(h, o || { dismissible: true }); }
  function cerrarModal() { var f = fn('closeModal'); if (f) f(); }
  function nube() { var c = window.Cloud; return (c && c.ready && c.uid && c.sb) ? c : null; }
  function llave() { var f = fn('uid'); return f ? f('c') : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function repintar() {
    var v = ref('currentView');
    if (String(v || '').indexOf('comandas') !== 0) return;
    if (document.querySelector('#modal-layer .modal-sheet')) return;
    var y = window.scrollY;
    var f = fn('render'); if (f) f();
    try { window.scrollTo(0, y); } catch (e) { }
  }

  /* ---- Los usuarios de VendoPlus de siempre (Configuración → Usuarios) ---- */
  function usuarios() { var DB = ref('DB'); return (DB && DB.getUsers) ? DB.getUsers() : []; }
  function guardarUsuarios(l) { var DB = ref('DB'); if (DB && DB.saveUsers) DB.saveUsers(l); }
  function usuarioActivo() { var f = fn('activeUser'); return f ? f() : null; }
  function soyDueno() { var f = fn('isOwner'); return f ? !!f() : true; }
  function nombreActor() { var u = usuarioActivo(); return (u && u.name) || 'Dueño'; }
  /** El área en la que está clasificado un usuario. Por omisión, Caja. */
  function areaDe(u) {
    var a = u && u.role !== 'dueno' && u.comandaArea;
    return (a === 'mesero' || a === 'cocina') ? a : 'caja';
  }

  /* =======================================================================
     2.  ÍCONOS Y DIBUJOS PROPIOS
  ======================================================================= */
  var T = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  var MIS_ICONOS = {
    vpcTray: '<svg viewBox="0 0 24 24" ' + T + '><path d="M3 13h18l-1.4 5.2a2 2 0 0 1-1.9 1.4H6.3a2 2 0 0 1-1.9-1.4L3 13Z"/><path d="M8.5 13V9.5a3.5 3.5 0 0 1 7 0V13"/><path d="M12 5.5V4"/></svg>',
    vpcPot: '<svg viewBox="0 0 24 24" ' + T + '><path d="M4 10h16v5.5a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 15.5V10Z"/><path d="M2.5 10h19"/><path d="M8 6.5c0-1 1-1.2 1-2.2M12 6.5c0-1 1-1.2 1-2.2M16 6.5c0-1 1-1.2 1-2.2"/></svg>',
    vpcDesk: '<svg viewBox="0 0 24 24" ' + T + '><rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 11h18M7 15h4"/><path d="M7.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h6a1.5 1.5 0 0 1 1.5 1.5V7"/></svg>',
    vpcTable: '<svg viewBox="0 0 24 24" ' + T + '><path d="M3 9h18"/><path d="M5 9l1.5 10M19 9l-1.5 10"/><path d="M4.5 6h15a1.5 1.5 0 0 1 0 3h-15a1.5 1.5 0 0 1 0-3Z"/></svg>',
    vpcSend: '<svg viewBox="0 0 24 24" ' + T + '><path d="M4.5 12 20 5l-4 15-4.2-5.6L4.5 12Z"/><path d="M11.8 14.4 20 5"/></svg>',
    vpcBell: '<svg viewBox="0 0 24 24" ' + T + '><path d="M6 10a6 6 0 0 1 12 0c0 4 1.4 5.3 1.4 5.3H4.6S6 14 6 10Z"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/></svg>',
    vpcBack: '<svg viewBox="0 0 24 24" ' + T + ' stroke-width="2.2"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    vpcNext: '<svg viewBox="0 0 24 24" ' + T + '><path d="m9 6 6 6-6 6"/></svg>',
    vpcLock: '<svg viewBox="0 0 24 24" ' + T + '><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>'
  };
  function ponIconos() {
    try {
      var I = ref('ICONS'); if (!I) return false;
      for (var k in MIS_ICONOS) if (!I[k]) I[k] = MIS_ICONOS[k];
      return true;
    } catch (e) { return false; }
  }
  function mi(n) { var I = ref('ICONS'); return (I && I[n]) || MIS_ICONOS[n] || ''; }

  /* Las 3 secciones. Caja va primero y nunca se apaga. */
  var SECCIONES = [
    { id: 'caja', nombre: 'Caja', vista: 'comandas_caja', ico: 'vpcDesk', fija: true, texto: 'Mesas abiertas, cuentas y cobros. Es el VendoPlus de siempre.' },
    { id: 'mesero', nombre: 'Mesero', vista: 'comandas_mesero', ico: 'vpcTray', fija: false, texto: 'Abre mesas, agrega productos y manda comandas a la cocina.' },
    { id: 'cocina', nombre: 'Cocinero', vista: 'comandas_cocina', ico: 'vpcPot', fija: false, texto: 'Recibe las comandas y marca los productos como listos.' }
  ];
  function seccion(id) { for (var i = 0; i < SECCIONES.length; i++) if (SECCIONES[i].id === id) return SECCIONES[i]; return SECCIONES[0]; }

  /* =======================================================================
     3.  ESTADO
  ======================================================================= */
  var S = {
    listo: false, cargando: false,
    activo: false, premium: false,
    on: { caja: true, mesero: false, cocina: false },   /* secciones encendidas */
    areas: [],            /* áreas de preparación: Cocina, Barra… */
    tablero: null, cocina: null, cuenta: null,
    area: null,           /* filtro de la pantalla de cocina */
    borrador: {}, busca: '', categoria: 'todos',
    canal: null, sondeo: null, ultimoAviso: 0,
  };

  function puedeArea(id) {
    return miArea() === id;
  }
  function miArea() {
    if (soyDueno()) return 'caja';
    var u = usuarioActivo(), c = nube();
    if (S.asignacion && u && c && S.asignacion.id === u.id && S.asignacion.gen === c.gen) return S.asignacion.area;
    return areaDe(u);
  }
  function habilitado() {
    var c = nube();
    return !!(c && c.uid === S.negocio && S.premium && S.activo);
  }
  function puedeCobrar() { return habilitado() && (soyDueno() || miArea() === 'caja'); }

  /* =======================================================================
     4.  SERVIDOR
  ======================================================================= */
  function rpc(nombre, args) {
    var c = nube();
    if (!c) return Promise.reject(new Error('sin_nube'));
    return c.sb.rpc(nombre, args || {}).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }
  function accion(nombre, args, alListo) {
    return rpc(nombre, args).then(function (d) {
      if (d && d.ok === false) {
        avisar(mensajeError(d.error), { variant: 'toast-danger', icon: ico('alert') });
        return null;
      }
      if (alListo) alListo(d);
      return d;
    }).catch(function (e) {
      console.warn('Vendo plus · comandas', nombre, e);
      avisar('No se pudo guardar', { variant: 'toast-danger', icon: ico('alert'), subtitle: 'Revisa tu internet e inténtalo otra vez' });
      return null;
    });
  }
  var ERRORES = {
    sin_sesion: 'Entra a tu cuenta para usar Comandas',
    sin_premium: 'Comandas es una función Premium',
    mesa_ocupada: 'Esa mesa ya la abrió alguien más',
    mesa_no_existe: 'Esa mesa ya no existe',
    cuenta_no_existe: 'Esa cuenta ya no existe',
    cuenta_cerrada: 'Esa cuenta ya se cerró',
    nada_por_enviar: 'No hay productos nuevos por enviar',
    producto_no_existe: 'Hay un producto que ya no está en tu catálogo',
    linea_invalida: 'Ese producto ya no se puede pedir así',
    transicion_invalida: 'Ese cambio no se puede hacer desde aquí',
    ya_cobrada: 'Esa cuenta ya se cobró',
    sin_venta: 'Falta la venta'
  };
  function mensajeError(e) { return ERRORES[e] || 'No se pudo completar'; }

  /* =======================================================================
     5.  CARGAS
  ======================================================================= */
  function estadoServidor() {
    var c = nube();
    if (!c) { S.listo = false; return Promise.resolve(); }
    var negocio = c.uid, generacion = c.gen;
    function mismaSesion() { return nube() && c.uid === negocio && c.gen === generacion; }
    return rpc('vp_com_estado').then(function (d) {
      if (!mismaSesion()) return;
      d = d || {};
      if (S.negocio !== negocio || !d.premium) {
        S.tablero = null; S.cuenta = null; S.cocina = null;
        if (S.canal) { c.sb.removeChannel(S.canal); S.canal = null; }
      }
      S.negocio = negocio;
      S.activo = !!d.activo;
      S.premium = !!d.premium;
      S.on = { caja: true, mesero: !!d.mesero, cocina: !!d.cocina };
      S.areas = Array.isArray(d.areas) ? d.areas : [];
      S.listo = true;
      escuchar();
    }).catch(function (e) {
      console.warn('Vendo plus · comandas', e);
      if (mismaSesion()) { S.negocio = negocio; S.activo = false; S.premium = false; S.listo = true; }
    });
  }
  function cargarTablero(callback) {
    if (!habilitado() || S.cargandoTablero) return;
    S.cargandoTablero = true;
    S.cargando = true;
    rpc('vp_com_sincronizar_plano').then(function () {
      return rpc('vp_com_tablero');
    }).then(function (d) {
      S.cargandoTablero = false;
      S.cargando = false; S.tablero = d || {};
      if (d && Array.isArray(d.areas)) S.areas = d.areas;
      if (callback) callback(); else repintar();
    }).catch(function (e) {
      S.cargandoTablero = false;
      S.cargando = false;
      S.tablero = null;
      S.errorTablero = true;
      console.warn('Vendo plus · comandas', e);
      repintar();
    });
  }
  function cargarCocina() {
    if (!habilitado()) return;
    S.cargando = true;
    rpc('vp_com_cocina', { p_area: S.area || null }).then(function (d) {
      S.cargando = false; S.cocina = Array.isArray(d) ? d : []; repintar();
    }).catch(function (e) { S.cargando = false; console.warn('Vendo plus · comandas', e); repintar(); });
  }
  function cargarCuenta(id, callback) {
    if (!nube()) return;
    rpc('vp_com_cuenta', { p_cuenta: id }).then(function (d) {
      S.cuenta = d || null;
      if (callback) callback(); else repintar();
    }).catch(function (e) { console.warn('Vendo plus · comandas', e); });
  }

  /* =======================================================================
     6.  EN VIVO
  ======================================================================= */
  var rebote = null;
  function refrescarLoQueSeVe() {
    var v = ref('currentView');
    if (String(v || '').indexOf('comandas') !== 0) return;
    if (v === 'comandas_cocina') cargarCocina();
    else if (S.cuenta) cargarCuenta(S.cuenta.id);
    else cargarTablero();
  }
  function cambio(p) {
    try { anunciar(p); } catch (e) { }
    clearTimeout(rebote);
    rebote = setTimeout(refrescarLoQueSeVe, 400);
  }
  /** Los avisos: a cocina cuando llega una comanda, al mesero cuando algo
      queda listo, y a caja cuando hay un problema o se pide la cuenta.
      A la caja NO se le avisa de cada producto que manda un mesero. */
  function anunciar(p) {
    if (!p || !p.new) return;
    var n = p.new, a = p.old || {}, r = miArea();
    var ahora = Date.now();
    if (ahora - S.ultimoAviso < 700) return;

    if (p.table === 'vp_comandas_detalles') {
      if (n.comanda_num && !a.comanda_num && r === 'cocina') {
        S.ultimoAviso = ahora;
        avisar('Comanda nueva en ' + (n.area_nombre || 'Cocina'), { icon: mi('vpcBell'), variant: 'toast-success toast-top', subtitle: n.nombre });
      } else if (n.estado === 'listo' && a.estado !== 'listo' && r === 'mesero') {
        S.ultimoAviso = ahora;
        avisar('Listo: ' + (n.nombre || 'un producto'), { icon: ico('check'), variant: 'toast-success toast-top', subtitle: 'Ya lo puedes llevar' });
      } else if (n.estado === 'problema' && a.estado !== 'problema' && r === 'caja') {
        S.ultimoAviso = ahora;
        avisar('Problema en cocina: ' + (n.nombre || ''), { icon: ico('alert'), variant: 'toast-danger toast-top', subtitle: 'Entra a Comandas para resolverlo' });
      }
    } else if (p.table === 'vp_comandas_cuentas') {
      if (n.estado === 'cuenta_pedida' && a.estado !== 'cuenta_pedida' && r === 'caja') {
        S.ultimoAviso = ahora;
        avisar('Cuenta pedida: ' + (n.mesa_nombre || ''), { icon: ico('cash'), variant: 'toast-success toast-top' });
      }
    }
  }
  function escuchar() {
    var c = nube();
    if (!c || S.canal || !S.activo) return;
    try {
      S.canal = c.sb.channel('vp-comandas-' + c.uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vp_comandas_detalles', filter: 'user_id=eq.' + c.uid }, cambio)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vp_comandas_cuentas', filter: 'user_id=eq.' + c.uid }, cambio)
        .subscribe();
    } catch (e) { console.warn('Vendo plus · comandas en vivo', e); }
  }
  function sondear() {
    clearInterval(S.sondeo);
    S.sondeo = setInterval(function () {
      if (document.hidden) return;
      var v = ref('currentView');
      if (String(v || '').indexOf('comandas') !== 0) return;
      estadoServidor().then(function () {
        if (habilitado()) refrescarLoQueSeVe();
        else repintar();
      });
    }, 20000);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refrescarLoQueSeVe();
  });

  /* =======================================================================
     7.  PIEZAS DE PANTALLA
  ======================================================================= */
  function volverHTML(accionJs, texto) {
    return '<button type="button" class="vpc-back" onclick="' + accionJs + '">' + mi('vpcBack') + '<span>' + esc(texto || 'Regresar') + '</span></button>';
  }
  function tituloHTML(t, sub) {
    return '<h1 class="page-title">' + esc(t) + '</h1>' + (sub ? '<p class="vpc-sub">' + esc(sub) + '</p>' : '');
  }
  function vacioHTML(icono, titulo, texto) {
    return '<div class="vpc-empty">' + icono + '<b>' + esc(titulo) + '</b><span>' + esc(texto) + '</span></div>';
  }
  function cargandoHTML(n) { var h = ''; for (var i = 0; i < (n || 6); i++) h += '<i></i>'; return '<div class="vpc-load">' + h + '</div>'; }
  function notaHTML(clase, titulo, texto) {
    return '<div class="vpc-nota ' + clase + '">' + ico('alert') + '<div><b>' + esc(titulo) + '</b>' + esc(texto) + '</div></div>';
  }
  function desdeHace(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'ahorita';
    if (m < 60) return 'hace ' + m + ' min';
    return 'hace ' + Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function hora(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    try { return d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }

  /* =======================================================================
     8.  PANTALLA PRINCIPAL DE COMANDAS  (vista "comandas")
     Las 3 secciones con su interruptor. Solo el dueño puede moverlos.
  ======================================================================= */
  function vistaElegir() {
    if (!nube()) {
      return '<div class="vpc">' + tituloHTML('Comandas') +
        vacioHTML(mi('vpcTray'), 'Necesitas internet', 'Comandas trabaja en vivo entre el mesero, la cocina y la caja. Conéctate y vuelve a entrar.') + '</div>';
    }
    if (!S.listo || (S.negocio && S.negocio !== nube().uid)) { estadoServidor().then(repintar); return '<div class="vpc">' + tituloHTML('Comandas') + cargandoHTML(3) + '</div>'; }

    var dueno = soyDueno();
    var h = '<div class="vpc">';

    /* Sin Premium */
    if (!S.premium) {
      h += tituloHTML('Comandas', 'Mesas, meseros, cocina y cuentas, dentro de VendoPlus.');
      h += notaHTML('', 'Viene incluida en Premium', 'No es un pago aparte ni otra membresía: ya está dentro de tu VendoPlus Premium.');
      h += '<div class="vpc-list">' + SECCIONES.map(function (s) { return seccionHTML(s, dueno, true); }).join('') + '</div>';
      h += '<div class="vpc-spacer"></div><button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.verPremium()">Ver qué incluye Premium</button>';
      return h + '</div>';
    }

    /* Premium sí, pero Comandas apagada */
    if (!S.activo) {
      h += tituloHTML('Comandas', 'Mesas, meseros, cocina y cuentas, dentro de VendoPlus.');
      if (!dueno) {
        h += vacioHTML(mi('vpcLock'), 'Comandas está apagada', 'Pídele al dueño que la encienda.');
        return h + '</div>';
      }
      h += notaHTML('is-ok', 'Falta encenderla', 'Ya la tienes incluida. Enciéndela y eliges qué secciones usa tu negocio.');
      h += '<div class="vpc-list">' + SECCIONES.map(function (s) { return seccionHTML(s, dueno, true); }).join('') + '</div>';
      h += '<div class="vpc-spacer"></div><button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.encender()">Activar Comandas</button>';
      return h + '</div>';
    }

    /* Encendida */
    h += tituloHTML('Comandas', dueno
      ? 'Enciende las secciones que usa tu negocio y di quién trabaja en cada una.'
      : 'Estas son las secciones de tu negocio y quién trabaja en cada una.');

    if (!dueno) h += notaHTML('', 'Solo puedes ver', 'Nada más el Dueño puede encender secciones o cambiar a la gente de área.');

    h += '<div class="vpc-list">' + SECCIONES.map(function (s) { return seccionHTML(s, dueno, false); }).join('') + '</div>';

    if (dueno) {
      h += '<div class="vpc-spacer"></div><button type="button" class="vpc-btn is-block" onclick="VPComandas.apagar()">Apagar Comandas</button>';
    }
    return h + '</div>';
  }

  /** Una sección con su interruptor y su flecha para ver a su gente. */
  function seccionHTML(s, dueno, bloqueada) {
    var on = s.fija ? true : !!S.on[s.id];
    var cuantos = usuarios().filter(function (u) { return areaDe(u) === s.id; }).length;
    var sub = s.fija
      ? 'Siempre encendida · ' + cuantos + (cuantos === 1 ? ' usuario' : ' usuarios')
      : (on ? 'Encendida · ' + cuantos + (cuantos === 1 ? ' usuario' : ' usuarios') : 'Apagada');

    var interruptor;
    if (bloqueada) {
      interruptor = '<span class="vpc-sw' + (on ? ' is-on' : '') + ' is-off"><i></i></span>';
    } else if (s.fija) {
      interruptor = '<span class="vpc-sw is-on is-off" title="Caja siempre está encendida"><i></i></span>';
    } else if (dueno) {
      interruptor = '<button type="button" class="vpc-sw' + (on ? ' is-on' : '') + '" aria-label="' + esc(s.nombre) + '" onclick="event.stopPropagation(); VPComandas.toggle(' + js(s.id) + ')"><i></i></button>';
    } else {
      interruptor = '<span class="vpc-sw' + (on ? ' is-on' : '') + ' is-off"><i></i></span>';
    }

    return '<div class="vpc-li is-plain">' +
      '<span class="vpc-li-ico">' + mi(s.ico) + '</span>' +
      '<span class="vpc-li-txt"><b>' + esc(s.nombre) + '</b><small>' + esc(sub) + '</small></span>' +
      interruptor +
      '<button type="button" class="vpc-li-go" aria-label="' + (dueno ? 'Asignar integrantes a ' : 'Ver integrantes de ') + esc(s.nombre) + '" onclick="VPComandas.verUsuarios(' + js(s.id) + ')">' + mi('vpcNext') + '</button>' +
      '</div>';
  }

  function filaHTML(icono, titulo, sub, accionJs, fin) {
    return '<button type="button" class="vpc-li" onclick="' + accionJs + '">' +
      '<span class="vpc-li-ico">' + icono + '</span>' +
      '<span class="vpc-li-txt"><b>' + esc(titulo) + '</b><small>' + esc(sub) + '</small></span>' +
      (fin ? '<span class="vpc-li-end">' + fin + '</span>' : ico('chevronRight')) +
      '</button>';
  }

  /* ---- Quién trabaja en cada sección ---- */
  function verUsuarios(areaId) {
    var s = seccion(areaId), dueno = soyDueno();
    if (!habilitado()) return;
    var lista = usuarios();
    var dentro = lista.filter(function (u) { return areaDe(u) === areaId; });
    var fuera = lista.filter(function (u) { return u.role !== 'dueno' && areaDe(u) !== areaId; });

    var h = '<div class="modal-sheet"><div class="sheet-header"><h2>' + esc(s.nombre) + '</h2>' +
      '<button class="sheet-close" onclick="closeModal()">' + ico('close') + '</button></div><div class="vpc">' +
      '<p class="vpc-sub">' + esc(s.texto) + '</p>';

    if (!dueno) h += notaHTML('', 'Solo puedes ver', 'Nada más el Dueño puede mover a la gente de área.');

    h += '<div class="section-title">En esta sección</div>';
    h += dentro.length
      ? '<div class="vpc-list">' + dentro.map(function (u) { return usuarioHTML(u, areaId, dueno, true); }).join('') + '</div>'
      : vacioHTML(ico('users'), 'Nadie todavía', dueno ? 'Toca a alguien de la lista de abajo para ponerlo aquí.' : 'El dueño aún no asigna a nadie.');

    if (dueno && fuera.length) {
      h += '<div class="vpc-spacer"></div><div class="section-title">Pasar a ' + esc(s.nombre) + '</div>' +
        '<div class="vpc-list">' + fuera.map(function (u) { return usuarioHTML(u, areaId, dueno, false); }).join('') + '</div>';
    }

    if (dueno) {
      h += '<div class="vpc-spacer"></div>' +
        notaHTML('', '¿Te falta gente?', 'Los usuarios se crean donde siempre: Mi cuenta → Usuarios. Aquí nada más les dices en qué área trabajan.') +
        '<button type="button" class="vpc-btn is-block" onclick="VPComandas.irAUsuarios()">Ir a Usuarios</button>';
    }
    abrirModal(h + '</div></div>', { dismissible: true });
  }

  function usuarioHTML(u, areaId, dueno, dentro) {
    var suArea = seccion(areaDe(u));
    var sub = (u.role === 'dueno' ? 'Dueño' : u.role === 'admin' ? 'Administrador' : 'Empleado') +
      (dentro ? '' : ' · hoy en ' + suArea.nombre);
    var fin = dentro
      ? (dueno && areaId !== 'caja' && u.role !== 'dueno'
        ? '<button type="button" class="vpc-mini is-warn" onclick="VPComandas.asignar(' + js(u.id) + ',' + js('caja') + ',' + js(areaId) + ')">Quitar</button>'
        : '<span class="vpc-tag is-listo">Aquí</span>')
      : '<button type="button" class="vpc-mini is-main" onclick="VPComandas.asignar(' + js(u.id) + ',' + js(areaId) + ',' + js(areaId) + ')">Poner aquí</button>';
    return '<div class="vpc-li is-plain"><span class="vpc-li-ico">' + ico('users') + '</span>' +
      '<span class="vpc-li-txt"><b>' + esc(u.name || 'Usuario') + '</b><small>' + esc(sub) + '</small></span>' + fin + '</div>';
  }

  async function asignar(userId, areaNueva, volverA) {
    if (!soyDueno()) { avisar('Solo el Dueño puede cambiar esto', { icon: ico('alert') }); return; }
    var lista = usuarios();
    var u = null;
    for (var i = 0; i < lista.length; i++) if (lista[i].id === userId) u = lista[i];
    if (!habilitado() || !u || u.role === 'dueno') return;
    var destino = seccion(areaNueva).id;
    if (destino !== 'caja' && !S.on[destino]) {
      var mesero = S.on.mesero || destino === 'mesero', cocina = S.on.cocina || destino === 'cocina';
      var resultado = await accion('vp_com_secciones', { p_mesero: mesero, p_cocina: cocina });
      if (!resultado || !habilitado() || !soyDueno()) return;
      S.on.mesero = mesero; S.on.cocina = cocina;
      lista = usuarios();
      u = lista.find(function (empleado) { return empleado.id === userId && empleado.role !== 'dueno'; });
      if (!u) return;
    }
    u.comandaArea = destino;
    guardarUsuarios(lista);
    nube().flush();
    avisar(esc(u.name) + ' → ' + seccion(u.comandaArea).nombre, { icon: ico('check'), variant: 'toast-success' });
    verUsuarios(volverA);
  }

  function irAUsuarios() {
    cerrarModal();
    var f = fn('openUsersSheet');
    if (f) f(); else irA('account');
  }

  function toggle(id) {
    if (!soyDueno()) { avisar('Solo el Dueño puede encender secciones', { icon: ico('alert') }); return; }
    if (id === 'caja') { avisar('Caja siempre está encendida', { icon: ico('alert'), subtitle: 'Es el VendoPlus de siempre' }); return; }
    var nuevo = { mesero: !!S.on.mesero, cocina: !!S.on.cocina };
    nuevo[id] = !nuevo[id];
    accion('vp_com_secciones', { p_mesero: nuevo.mesero, p_cocina: nuevo.cocina }, function () {
      S.on.mesero = nuevo.mesero; S.on.cocina = nuevo.cocina;
      avisar(seccion(id).nombre + (nuevo[id] ? ' encendido' : ' apagado'), { icon: ico('check'), variant: 'toast-success' });
      repintar();
    });
  }

  async function abrirAreaAsignada() {
    if (!habilitado() || soyDueno() || document.body.classList.contains('auth-open')) return;
    var c = nube(), u = usuarioActivo();
    if (!u) return;
    var gen = c.gen, negocio = c.uid;
    var areaLocal = areaDe(u);
    if (!c.dirty.has('mesa_users')) {
      try {
        var r = await c.sb.from('user_data').select('value').eq('user_id', negocio).eq('key', 'mesa_users').maybeSingle();
        if (!r.error && Array.isArray(r.data?.value?.j)) {
          var guardado = r.data.value.j.find(function (empleado) { return empleado.id === u.id; });
          areaLocal = areaDe(guardado || u);
        }
      } catch (e) { console.warn('Vendo plus · asignación de Comandas', e); }
    }
    if (c.gen !== gen || c.uid !== negocio || usuarioActivo()?.id !== u.id ||
        document.body.classList.contains('auth-open')) return;
    S.asignacion = { id: u.id, gen: gen, area: areaLocal };
    var area = miArea();
    if (area === 'caja' || !S.on[area]) return;
    var vista = seccion(area).vista;
    if (ref('currentView') !== vista) ir(vista);
  }

  /* =======================================================================
     10.  PANTALLA: MESERO
  ======================================================================= */
  function errorTableroHTML() {
    return envoltura('Comandas', '', '<button type="button" class="vpc-btn is-main" onclick="VPComandas.ir(currentView)">Reintentar</button>');
  }

  function ventasLibresHTML(t) {
    var ventas = (t.menu || []).filter(function (m) { return m.tipo === 'libre'; });
    if (!ventas.length) return '';
    return '<div class="vpc-spacer"></div><div class="section-title">Ventas libres abiertas</div><div class="vpc-list">' +
      ventas.map(function (m) {
        return filaHTML(mi('vpcTray'), m.nombre, (m.cliente || '') + ' · ' + desdeHace(m.abierta_en),
          'VPComandas.abrirCuenta(' + js(m.id) + ')', money(m.total));
      }).join('') + '</div>';
  }

  function vistaMesero() {
    if (!listoParaPintar()) return esperandoHTML();
    if (!S.on.mesero || !puedeArea('mesero')) return sinPermisoHTML();
    if (S.cuenta) return vistaCuenta('comandas_mesero');

    if (S.errorTablero) return errorTableroHTML();
    if (!S.tablero) { cargarTablero(); return envoltura('Mesas', 'Toca una mesa para abrirla o para seguir atendiéndola.', cargandoHTML(6)); }

    var mesas = S.tablero.mesas || [];
    var cuerpo;
    if (!mesas.length) {
      cuerpo = vacioHTML(mi('vpcTable'), 'Todavía no hay mesas',
        soyDueno() ? 'Revisa el plano de mesas del POS.' : 'Pídele al dueño que registre las mesas del negocio.');

    } else {
      cuerpo = '<div class="vpc-mesas">' + mesas.map(mesaHTML).join('') + '</div>';
    }
    cuerpo += '<div class="vpc-spacer"></div><button type="button" class="vpc-btn is-soft is-block" onclick="VPComandas.ventaLibre()">' + ico('plus') + ' Venta libre</button>';
    cuerpo += ventasLibresHTML(S.tablero);
    var menu = (S.tablero.menu || []).filter(function (m) { return m.tipo !== 'libre'; });
    if (menu.length) {
      cuerpo += '<div class="vpc-spacer"></div><div class="section-title">Pedidos del Menú Digital</div><div class="vpc-list">' +
        menu.map(function (m) {
          return filaHTML(ico('mobile'), m.nombre, (m.cliente || 'Cliente') + ' · ' + desdeHace(m.abierta_en),
            'VPComandas.abrirCuenta(' + js(m.id) + ')', money(m.total));
        }).join('') + '</div>';
    }
    return envoltura('Mesas', 'Toca una mesa para abrirla o para seguir atendiéndola.', cuerpo);
  }

  function mesaHTML(m) {
    var c = m.cuenta;
    if (!c && m.plano_id && window.VPMesas && VPMesas.openOrders().has(m.plano_id)) {
      return '<button type="button" class="vpc-mesa is-ocupada" disabled><b>' + esc(m.nombre) +
        '</b><small>Cuenta abierta desde caja</small></button>';
    }
    var clase = 'is-libre', accion = 'VPComandas.abrirMesa(' + js(m.id) + ',' + js(m.nombre) + ')';
    if (c) {
      accion = 'VPComandas.abrirCuenta(' + js(c.id) + ')';
      clase = c.problemas > 0 ? 'is-problema' : (c.estado === 'cuenta_pedida' ? 'is-pedida' : 'is-ocupada');
    }
    var tags = '';
    if (c) {
      if (c.por_enviar > 0) tags += '<span class="vpc-tag is-pendiente">' + c.por_enviar + ' por enviar</span>';
      if (c.en_proceso > 0) tags += '<span class="vpc-tag is-preparando">' + c.en_proceso + ' en cocina</span>';
      if (c.listos > 0) tags += '<span class="vpc-tag is-listo">' + c.listos + ' listo' + (c.listos === 1 ? '' : 's') + '</span>';
      if (c.problemas > 0) tags += '<span class="vpc-tag is-problema">' + c.problemas + ' problema' + (c.problemas === 1 ? '' : 's') + '</span>';
      if (c.estado === 'cuenta_pedida') tags += '<span class="vpc-tag is-pendiente">Cuenta pedida</span>';
    }
    return '<button type="button" class="vpc-mesa ' + clase + '" onclick="' + accion + '">' +
      '<b>' + esc(m.nombre) + '</b>' +
      '<small>' + (c ? (c.personas + (c.personas === 1 ? ' persona' : ' personas') + ' · ' + esc(c.mesero || '') + ' · ' + desdeHace(c.abierta_en)) : 'Disponible · ' + m.capacidad + ' lugares') + '</small>' +
      (tags ? '<div class="vpc-tags">' + tags + '</div>' : '') +
      '<span class="vpc-mesa-total">' + (c ? money(c.total) : '') + '</span>' +
      '</button>';
  }

  function envoltura(titulo, sub, cuerpo) {
    return '<div class="vpc">' +
      (soyDueno() ? volverHTML("VPComandas.ir('comandas')", 'Comandas') : '') +
      tituloHTML(titulo, sub) + cuerpo + '</div>';
  }

  /* ---- La cuenta de una mesa ---- */
  function vistaCuenta(volverVista) {
    var c = S.cuenta;
    var ps = (c.productos || []).filter(function (p) { return p.estado !== 'cancelado'; });
    var porEnviar = ps.filter(function (p) { return !p.comanda; });
    var enviados = ps.filter(function (p) { return p.comanda; });
    var cobra = puedeCobrar();

    var h = '<div class="vpc">' + volverHTML('VPComandas.cerrarCuenta(' + js(volverVista) + ')', 'Mesas');
    h += tituloHTML(c.mesa, (c.personas || 1) + (c.personas === 1 ? ' persona' : ' personas') + ' · ' + (c.mesero || '') + ' · abierta ' + desdeHace(c.abierta_en));

    if (c.estado === 'cuenta_pedida') h += notaHTML('is-ok', 'Cuenta pedida', cobra ? 'Ya puedes cobrarla desde aquí.' : 'La caja ya la tiene.');

    if (porEnviar.length) {
      h += '<div class="section-title">Por enviar</div><div class="vpc-com"><div class="vpc-com-body">' +
        porEnviar.map(function (p) { return prodHTML(p, 'cuenta'); }).join('') + '</div></div>';
      if (puedeArea('mesero')) h += '<div class="vpc-spacer"></div><button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.enviar()">' + mi('vpcSend') + ' Enviar comanda (' + porEnviar.length + ')</button>';
    }

    if (enviados.length) {
      var porNum = {};
      enviados.forEach(function (p) { (porNum[p.comanda] = porNum[p.comanda] || []).push(p); });
      h += '<div class="vpc-spacer"></div><div class="section-title">Ya enviado</div>';
      Object.keys(porNum).sort(function (a, b) { return a - b; }).forEach(function (n) {
        var lista = porNum[n];
        h += '<div class="vpc-com" style="margin-bottom:10px;"><div class="vpc-com-top">' +
          '<div><b>Comanda ' + esc(n) + '</b><small>' + esc(lista[0].area || 'Cocina') + ' · ' + hora(lista[0].enviado_en) + '</small></div>' +
          '<span class="vpc-com-num">' + lista.length + (lista.length === 1 ? ' producto' : ' productos') + '</span></div>' +
          '<div class="vpc-com-body">' + lista.map(function (p) { return prodHTML(p, 'cuenta'); }).join('') + '</div></div>';
      });
    }

    if (!ps.length) h += vacioHTML(mi('vpcTray'), 'La mesa está vacía', 'Agrega los productos que pidió el cliente y manda la comanda a la cocina.');

    h += '<div class="vpc-spacer"></div>' +
      '<div class="vpc-total"><b>Total de la mesa</b><b>' + money(c.total) + '</b></div>';

    h += '<div class="vpc-pie">';
    if (c.estado !== 'cobrada') {
      h += '<button type="button" class="vpc-btn is-soft" onclick="VPComandas.elegirProductos()">' + ico('plus') + ' Agregar</button>';
      if (c.estado === 'abierta') h += '<button type="button" class="vpc-btn" onclick="VPComandas.pedirCuenta()">Pedir la cuenta</button>';
      if (cobra) h += '<button type="button" class="vpc-btn is-main" onclick="VPComandas.cobrar()">' + ico('cash') + ' Cobrar</button>';
    }
    h += '</div>';

    if (cobra && c.estado !== 'cobrada') {
      h += '<div class="vpc-spacer"></div><button type="button" class="vpc-btn is-danger is-block" onclick="VPComandas.cancelarCuenta()">Cancelar esta cuenta</button>';
    }
    return h + '</div>';
  }

  function prodHTML(p, donde) {
    var clase = p.estado === 'listo' ? ' is-listo' : (p.estado === 'problema' ? ' is-problema' : '');
    var cant = Number(p.cantidad);
    var q = (cant % 1 === 0 ? cant : cant.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
    var h = '<div class="vpc-prod' + clase + '">' +
      '<span class="vpc-prod-q">' + esc(q) + '</span>' +
      '<span class="vpc-prod-txt"><b>' + esc(p.nombre) + (p.size ? ' (' + esc(p.size) + ')' : '') + '</b>' +
      (p.nota ? '<i>' + esc(p.nota) + '</i>' : '') +
      (p.problema ? '<em>Problema: ' + esc(p.problema) + (p.problema_nota ? ' · ' + esc(p.problema_nota) : '') + '</em>' : '') +
      (donde === 'cuenta' ? '<em>' + money(p.precio * p.cantidad) + '</em>' : '') +
      '</span>';

    if (donde === 'cocina') {
      h += '<span class="vpc-prod-act">';
      if (p.estado === 'pendiente') h += '<button type="button" class="vpc-mini" onclick="VPComandas.marcar(' + js(p.id) + ',\'preparando\')">Preparando</button>';
      if (p.estado === 'preparando') h += '<button type="button" class="vpc-mini is-main" onclick="VPComandas.marcar(' + js(p.id) + ',\'listo\')">Listo</button>';
      if (p.estado !== 'problema') h += '<button type="button" class="vpc-mini is-warn" onclick="VPComandas.reportar(' + js(p.id) + ',' + js(p.nombre) + ')">Problema</button>';
      else h += '<span class="vpc-tag is-problema">Esperando a caja</span>';
      h += '</span>';
    } else if (donde === 'resolver') {
      h += '<span class="vpc-prod-act">' +
        '<button type="button" class="vpc-mini is-main" onclick="VPComandas.resolver(' + js(p.id) + ',\'autorizar\')">Que siga</button>' +
        '<button type="button" class="vpc-mini is-warn" onclick="VPComandas.resolver(' + js(p.id) + ',\'cancelar\')">Quitar</button>' +
        '</span>';
    } else if (donde === 'cuenta' && p.comanda) {
      h += '<span class="vpc-prod-act"><span class="vpc-tag is-' + esc(p.estado) + '">' +
        (p.estado === 'pendiente' ? 'Pendiente' : p.estado === 'preparando' ? 'Preparando' : p.estado === 'listo' ? 'Listo' : 'Problema') +
        '</span></span>';
    }
    return h + '</div>';
  }

  /* =======================================================================
     11.  PANTALLA: COCINA
  ======================================================================= */
  function vistaCocina() {
    if (!listoParaPintar()) return esperandoHTML();
    if (!S.on.cocina || !puedeArea('cocina')) return sinPermisoHTML();

    var h = '<div class="vpc">';
    h += tituloHTML('Cocina', 'Lo que falta por preparar. Se actualiza solo.');

    if (S.areas.length > 1) {
      h += '<div class="vpc-chips"><button type="button" class="vpc-chip' + (!S.area ? ' is-on' : '') + '" onclick="VPComandas.filtrarArea(null)">Todas</button>' +
        S.areas.map(function (a) {
          return '<button type="button" class="vpc-chip' + (S.area === a.id ? ' is-on' : '') + '" onclick="VPComandas.filtrarArea(' + js(a.id) + ')">' + esc(a.nombre) + '</button>';
        }).join('') + '</div>';
    }

    if (!S.cocina) { cargarCocina(); return h + cargandoHTML(3) + '</div>'; }
    if (!S.cocina.length) return h + vacioHTML(mi('vpcPot'), 'Nada pendiente', 'Cuando un mesero mande una comanda, aparece aquí al instante.') + '</div>';

    h += '<div class="vpc-comandas">' + S.cocina.map(function (c) {
      return '<div class="vpc-com">' +
        '<div class="vpc-com-top"><div><b>' + esc(c.mesa) + '</b><small>' + esc(c.mesero || '') + ' · ' + hora(c.enviado_en) + ' · ' + desdeHace(c.enviado_en) + '</small></div>' +
        '<span class="vpc-com-num">#' + esc(c.comanda) + '</span></div>' +
        '<div class="vpc-com-body">' + (c.productos || []).map(function (p) { return prodHTML(p, 'cocina'); }).join('') + '</div>' +
        '<div class="vpc-com-pie">' +
        '<button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.todoListo(' + js(String(c.comanda)) + ',' + js(String(c.cuenta)) + ')">Marcar toda la comanda lista</button></div>' +
        '</div>';
    }).join('') + '</div>';
    return h + '</div>';
  }

  /* =======================================================================
     12.  PANTALLA: CAJA
  ======================================================================= */
  function vistaCaja() {
    if (!listoParaPintar()) return esperandoHTML();
    if (!puedeCobrar()) return sinPermisoHTML();
    if (S.cuenta) return vistaCuenta('comandas_caja');
    if (S.errorTablero) return errorTableroHTML();
    if (!S.tablero) { cargarTablero(); return envoltura('Caja', 'Mesas abiertas, cuentas por cobrar y avisos de cocina.', cargandoHTML(6)); }

    var t = S.tablero;
    var mesas = (t.mesas || []).filter(function (m) { return m.cuenta; });
    var menu = (t.menu || []).filter(function (m) { return m.tipo !== 'libre'; });
    var cuerpo = '';

    if (Number(t.problemas) > 0) {
      cuerpo += '<div class="vpc-nota is-danger">' + ico('alert') +
        '<div><b>' + t.problemas + (Number(t.problemas) === 1 ? ' producto con problema' : ' productos con problema') + '</b>' +
        'La cocina reportó algo y está esperando que tú decidas.</div></div>' +
        '<button type="button" class="vpc-btn is-danger is-block" onclick="VPComandas.verProblemas()">Resolver ahora</button><div class="vpc-spacer"></div>';
    }
    if (Number(t.pedidas) > 0) {
      cuerpo += notaHTML('is-ok', t.pedidas + (Number(t.pedidas) === 1 ? ' cuenta pedida' : ' cuentas pedidas'), 'El mesero ya pidió la cuenta. Ábrela y cóbrala.');
    }

    if (!mesas.length && !(t.menu || []).length) {
      cuerpo += vacioHTML(ico('cashbox'), 'No hay mesas abiertas', 'Cuando un mesero abra una mesa, la vas a ver aquí con su consumo.');
    } else {
      if (mesas.length) cuerpo += '<div class="section-title">Mesas abiertas</div><div class="vpc-mesas">' + mesas.map(mesaHTML).join('') + '</div>';
      if (menu.length) {
        cuerpo += '<div class="vpc-spacer"></div><div class="section-title">Pedidos del Menú Digital</div><div class="vpc-list">' +
          menu.map(function (m) {
            return filaHTML(ico('mobile'), m.nombre, (m.cliente || 'Cliente') + ' · ' + desdeHace(m.abierta_en),
              'VPComandas.abrirCuenta(' + js(m.id) + ')', money(m.total));
          }).join('') + '</div>';
      }
    }

    cuerpo += ventasLibresHTML(t);
    if (window.VPMesas && VPMesas.openOrders().size) {
      cuerpo += '<div class="vpc-spacer"></div><button type="button" class="vpc-btn is-soft" onclick="VPMesas.open(\'sale\')">Mesas abiertas desde caja</button>';
    }
    return envoltura('Caja', 'Mesas abiertas, cuentas por cobrar y avisos de cocina.', cuerpo);
  }

  /* =======================================================================
     13.  GUARDIAS DE PANTALLA
  ======================================================================= */
  function listoParaPintar() {
    if (!nube()) return false;
    if (!S.listo || (S.negocio && S.negocio !== nube().uid)) { estadoServidor().then(repintar); return false; }
    return habilitado();
  }
  function esperandoHTML() {
    if (!nube()) {
      return '<div class="vpc">' + tituloHTML('Comandas') +
        vacioHTML(mi('vpcTray'), 'Necesitas internet', 'Comandas trabaja en vivo. Conéctate y vuelve a entrar.') + '</div>';
    }
    if (S.listo && !S.activo) { setTimeout(function () { irA('comandas'); }, 0); }
    return '<div class="vpc">' + cargandoHTML(3) + '</div>';
  }
  function sinPermisoHTML() {
    return '<div class="vpc">' + volverHTML("VPComandas.ir('comandas')", 'Comandas') + tituloHTML('Comandas') +
      vacioHTML(mi('vpcLock'), 'Esta sección no es la tuya', 'Tu usuario trabaja en ' + seccion(miArea()).nombre + '. El dueño puede cambiarlo desde Comandas.') + '</div>';
  }

  /* =======================================================================
     14.  ACCIONES
  ======================================================================= */
  function encender() {
    if (!soyDueno()) { avisar('Solo el Dueño puede activarla', { icon: ico('alert') }); return; }
    accion('vp_com_encender', { p_activo: true }, function () {
      avisar('Comandas activada', { icon: ico('check'), variant: 'toast-success', subtitle: 'Ahora enciende las secciones que uses' });
      S.listo = false; S.tablero = null;
      estadoServidor().then(repintar);
    });
  }
  function apagar() {
    if (!soyDueno()) return;
    var preguntar = fn('askConfirm');
    var hacer = function () {
      accion('vp_com_encender', { p_activo: false }, function () {
        avisar('Comandas apagada');
        S.listo = false; S.tablero = null;
        estadoServidor().then(function () { irA('sale'); });
      });
    };
    if (preguntar) preguntar({ title: 'Apagar Comandas', text: 'Las mesas y las cuentas no se borran: dejan de verse hasta que la vuelvas a encender.', ok: 'Apagar' }, hacer);
    else hacer();
  }

  function abrirMesa(mesaId, nombre) {
    if (!habilitado() || !S.on.mesero || !puedeArea('mesero')) return;
    var h = '<div class="modal-sheet"><div class="sheet-header"><h2>' + esc(nombre) + '</h2>' +
      '<button class="sheet-close" onclick="closeModal()">' + ico('close') + '</button></div>' +
      '<div class="vpc"><div class="vpc-field"><label>¿Cuántas personas?</label>' +
      '<input id="vpcPersonas" type="number" inputmode="numeric" min="1" max="99" value="2"></div>' +
      '<button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.confirmarMesa(' + js(mesaId) + ')">Abrir la mesa</button></div></div>';
    abrirModal(h, { dismissible: true });
    setTimeout(function () { var i = document.getElementById('vpcPersonas'); if (i && i.select) i.select(); }, 150);
  }
  function confirmarMesa(mesaId) {
    if (!habilitado() || !S.on.mesero || !puedeArea('mesero')) return;
    var i = document.getElementById('vpcPersonas');
    var n = Math.max(1, Math.min(99, parseInt((i && i.value) || '1', 10) || 1));
    var u = usuarioActivo();
    var btn = document.querySelector('#modal-layer .vpc-btn.is-main'); if (btn) btn.disabled = true;
    accion('vp_com_mesa_abrir', {
      p_mesa: mesaId, p_personas: n,
      p_mesero_id: (u && u.id) || '', p_mesero: nombreActor(), p_idem: llave()
    }, function (d) {
      cerrarModal();
      if (d && d.cuenta) cargarCuenta(d.cuenta);
    }).then(function () { if (btn) btn.disabled = false; });
  }

  var ventaLibrePendiente = null;
  var abriendoVentaLibre = false;
  function ventaLibre() {
    if (abriendoVentaLibre || !habilitado() || !S.on.mesero || !puedeArea('mesero')) return;
    var u = usuarioActivo();
    abriendoVentaLibre = true;
    ventaLibrePendiente = ventaLibrePendiente || llave();
    accion('vp_com_venta_libre', {
      p_mesero_id: (u && u.id) || '', p_mesero: nombreActor(), p_idem: ventaLibrePendiente
    }, function (d) {
      if (d && d.cuenta) {
        ventaLibrePendiente = null;
        cargarCuenta(d.cuenta);
      }
    }).finally(function () { abriendoVentaLibre = false; });
  }

  function abrirCuenta(id) { cargarCuenta(id); }
  function cerrarCuenta(vista) { S.cuenta = null; S.borrador = {}; cargarTablero(function () { irA(vista || 'comandas_mesero'); }); }

  function enviar() {
    if (!habilitado() || !S.on.mesero || !puedeArea('mesero')) return;
    if (!S.cuenta) return;
    var id = S.cuenta.id;
    accion('vp_com_enviar', { p_cuenta: id, p_actor: nombreActor(), p_idem: llave() }, function (d) {
      avisar('Comanda ' + (d && d.comanda) + ' enviada', { icon: mi('vpcSend'), variant: 'toast-success', subtitle: 'A ' + (((d && d.areas) || ['Cocina']).join(' y ')) });
      cargarCuenta(id);
    });
  }
  function pedirCuenta() {
    if (!S.cuenta) return;
    var id = S.cuenta.id;
    accion('vp_com_cuenta_pedir', { p_cuenta: id, p_actor: nombreActor() }, function (d) {
      avisar('La caja ya tiene la cuenta', { icon: ico('check'), variant: 'toast-success', subtitle: money(d && d.total) });
      cargarCuenta(id);
    });
  }
  function cancelarCuenta() {
    if (!S.cuenta) return;
    var id = S.cuenta.id;
    var preguntar = fn('askConfirm');
    var hacer = function () {
      accion('vp_com_cancelar', { p_cuenta: id, p_motivo: '', p_actor: nombreActor() }, function () {
        avisar('Cuenta cancelada');
        cerrarCuenta(miArea() === 'caja' ? 'comandas_caja' : 'comandas_mesero');
      });
    };
    if (preguntar) preguntar({ title: '¿Cancelar la cuenta?', text: 'La mesa queda libre y nada se cobra. Queda registrado quién la canceló.', ok: 'Cancelar la cuenta', danger: true }, hacer);
    else hacer();
  }

  function marcar(detalleId, estado) {
    if (!habilitado() || !S.on.cocina || !puedeArea('cocina')) return;
    accion('vp_com_estado_producto', { p_detalle: detalleId, p_estado: estado, p_actor: nombreActor() }, function () { cargarCocina(); });
  }
  function todoListo(num, cuentaId) {
    if (!habilitado() || !S.on.cocina || !puedeArea('cocina')) return;
    var com = (S.cocina || []).filter(function (c) { return String(c.comanda) === String(num) && String(c.cuenta) === String(cuentaId); })[0];
    if (!com) return;
    var ps = (com.productos || []).filter(function (p) { return p.estado === 'pendiente' || p.estado === 'preparando'; });
    if (!ps.length) return;
    var actor = nombreActor();
    var cola = Promise.resolve();
    ps.forEach(function (p) {
      cola = cola.then(function () {
        if (p.estado === 'pendiente') return rpc('vp_com_estado_producto', { p_detalle: p.id, p_estado: 'preparando', p_actor: actor });
      }).then(function () {
        return rpc('vp_com_estado_producto', { p_detalle: p.id, p_estado: 'listo', p_actor: actor });
      });
    });
    cola.then(function () {
      avisar('Comanda ' + num + ' lista', { icon: ico('check'), variant: 'toast-success' });
      cargarCocina();
    }).catch(function () { cargarCocina(); });
  }

  function reportar(detalleId, nombre) {
    if (!habilitado() || !S.on.cocina || !puedeArea('cocina')) return;
    var ops = [['agotado', 'Se acabó el producto'], ['no_se_puede', 'No se puede preparar así'], ['sustitucion', 'Hace falta cambiarlo por otro'], ['otro', 'Otro problema']];
    var h = '<div class="modal-sheet"><div class="sheet-header"><h2>Reportar a caja</h2>' +
      '<button class="sheet-close" onclick="closeModal()">' + ico('close') + '</button></div>' +
      '<div class="vpc"><p class="vpc-sub">' + esc(nombre) + '. La caja decide qué hacer; tú no cambias lo que pidió el cliente.</p>' +
      '<div class="vpc-list">' + ops.map(function (o) {
        return '<button type="button" class="vpc-li" onclick="VPComandas.mandarProblema(' + js(detalleId) + ',' + js(o[0]) + ')">' +
          '<span class="vpc-li-ico is-danger">' + ico('alert') + '</span>' +
          '<span class="vpc-li-txt"><b>' + esc(o[1]) + '</b></span>' + ico('chevronRight') + '</button>';
      }).join('') + '</div>' +
      '<div class="vpc-spacer"></div><div class="vpc-field"><label>Nota para la caja (opcional)</label>' +
      '<input id="vpcNotaProb" type="text" maxlength="200" placeholder="Ej. ya no hay queso extra"></div></div></div>';
    abrirModal(h, { dismissible: true });
  }
  function mandarProblema(detalleId, tipo) {
    if (!habilitado() || !S.on.cocina || !puedeArea('cocina')) return;
    var i = document.getElementById('vpcNotaProb');
    accion('vp_com_problema', { p_detalle: detalleId, p_tipo: tipo, p_nota: (i && i.value) || '', p_actor: nombreActor() }, function () {
      cerrarModal();
      avisar('Avisado a caja', { icon: ico('check'), variant: 'toast-success' });
      cargarCocina();
    });
  }

  function verProblemas() {
    var c = nube(); if (!c) return;
    c.sb.from('vp_comandas_detalles').select('*').eq('estado', 'problema').limit(50).then(function (r) {
      var ps = (r.error ? [] : (r.data || [])).map(function (d) {
        return { id: d.id, nombre: d.nombre, size: d.size_label, cantidad: d.cantidad, precio: d.precio, nota: d.nota, estado: 'problema', problema: d.problema_tipo, problema_nota: d.problema_nota };
      });
      var h = '<div class="modal-sheet"><div class="sheet-header"><h2>Problemas por resolver</h2>' +
        '<button class="sheet-close" onclick="closeModal()">' + ico('close') + '</button></div><div class="vpc">' +
        (ps.length
          ? '<p class="vpc-sub">Tú decides. Si el cliente tiene que autorizar algo, habla con él antes.</p><div class="vpc-com"><div class="vpc-com-body">' +
          ps.map(function (p) { return prodHTML(p, 'resolver'); }).join('') + '</div></div>'
          : vacioHTML(ico('check'), 'Nada pendiente', 'La cocina no ha reportado ningún problema.')) +
        '</div></div>';
      abrirModal(h, { dismissible: true });
    });
  }
  function resolver(detalleId, accionTipo) {
    accion('vp_com_resolver', { p_detalle: detalleId, p_accion: accionTipo, p_cantidad: null, p_nota: '', p_actor: nombreActor() }, function () {
      avisar(accionTipo === 'cancelar' ? 'Producto quitado' : 'Autorizado, cocina ya lo sabe', { icon: ico('check'), variant: 'toast-success' });
      cerrarModal();
      cargarTablero();
    });
  }

  /* =======================================================================
     15.  ELEGIR PRODUCTOS (del catálogo que ya tienes)
  ======================================================================= */
  function productos() {
    var DB = ref('DB');
    var lista = (DB && DB.getProducts) ? DB.getProducts() : [];
    return lista.filter(function (p) { return p && p.active !== false; });
  }
  function categorias() {
    var DB = ref('DB');
    var cs = (DB && DB.getCategories) ? DB.getCategories() : [];
    return cs.map(function (c) { return typeof c === 'string' ? c : (c.name || c.id); }).filter(Boolean);
  }
  function clave(p, s) { return p.id + '|' + (s ? s.id : ''); }

  function elegirProductos() {
    S.borrador = {}; S.busca = ''; S.categoria = 'todos';
    abrirModal(hojaProductosHTML(), { dismissible: true });
  }
  function hojaProductosHTML() {
    var cats = categorias();
    var ps = productos().filter(function (p) {
      if (S.categoria !== 'todos' && String(p.category || '') !== S.categoria) return false;
      if (!S.busca) return true;
      return String(p.name || '').toLowerCase().indexOf(S.busca.toLowerCase()) >= 0;
    });
    var cuantos = 0, suma = 0;
    for (var k in S.borrador) { cuantos += S.borrador[k].qty; suma += S.borrador[k].qty * S.borrador[k].price; }

    return '<div class="modal-sheet"><div class="sheet-header"><h2>Agregar productos</h2>' +
      '<button class="sheet-close" onclick="closeModal()">' + ico('close') + '</button></div>' +
      '<div class="vpc">' +
      '<div class="vpc-busca">' + ico('search') + '<input id="vpcBusca" type="text" placeholder="Buscar producto" value="' + esc(S.busca) + '" oninput="VPComandas.buscar(this.value)"></div>' +
      (cats.length > 1 ? '<div class="vpc-chips"><button type="button" class="vpc-chip' + (S.categoria === 'todos' ? ' is-on' : '') + '" onclick="VPComandas.filtrarCat(\'todos\')">Todos</button>' +
        cats.map(function (c) { return '<button type="button" class="vpc-chip' + (S.categoria === c ? ' is-on' : '') + '" onclick="VPComandas.filtrarCat(' + js(c) + ')">' + esc(c) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="vpc-picker">' +
      (ps.length ? ps.map(filaProductoHTML).join('') : '<div class="vpc-empty" style="padding:30px 10px;"><b>No encontré nada</b><span>Prueba con otro nombre.</span></div>') +
      '</div>' +
      '<div class="vpc-pie">' +
      '<button type="button" class="vpc-btn is-soft" onclick="closeModal()">Cancelar</button>' +
      '<button type="button" class="vpc-btn is-main" ' + (cuantos ? '' : 'disabled') + ' onclick="VPComandas.guardarBorrador()">Agregar ' + (cuantos ? cuantos + ' · ' + money(suma) : '') + '</button>' +
      '</div></div></div>';
  }
  function filaProductoHTML(p) {
    var sizes = Array.isArray(p.sizes) ? p.sizes : [];
    if (sizes.length) {
      return '<button type="button" class="vpc-pick-row" onclick="VPComandas.verTamanos(' + js(p.id) + ')">' +
        '<span><b>' + esc(p.name) + '</b><small>' + sizes.length + ' tamaños</small></span>' +
        '<span class="vpc-pick-end"><span class="vpc-pick-price">desde ' + money(Math.min.apply(null, sizes.map(function (s) { return Number(s.price) || 0; }))) + '</span>' + ico('chevronRight') + '</span></button>';
    }
    var k = clave(p, null);
    var n = S.borrador[k] ? S.borrador[k].qty : 0;
    return '<div class="vpc-pick-row">' +
      '<span><b>' + esc(p.name) + '</b><small>' + esc(p.category || '') + '</small></span>' +
      '<span class="vpc-pick-end"><span class="vpc-pick-price">' + money(p.price) + '</span>' +
      pasoHTML(k, p.id, '', '', p.name, p.price, n) + '</span></div>';
  }
  function pasoHTML(k, pid, sid, slabel, nombre, precio, n) {
    var args = [js(pid), js(sid || ''), js(slabel || ''), js(nombre), Number(precio) || 0].join(',');
    return '<span class="vpc-step">' +
      '<button type="button" onclick="VPComandas.menos(' + js(k) + ')">−</button>' +
      '<span>' + n + '</span>' +
      '<button type="button" onclick="VPComandas.mas(' + args + ')">+</button></span>';
  }
  function verTamanos(pid) {
    var p = productos().filter(function (x) { return x.id === pid; })[0];
    if (!p) return;
    var h = '<div class="modal-sheet"><div class="sheet-header"><h2>' + esc(p.name) + '</h2>' +
      '<button class="sheet-close" onclick="VPComandas.volverProductos()">' + ico('chevronLeft') + '</button></div><div class="vpc"><div class="vpc-picker">' +
      (p.sizes || []).map(function (s) {
        var k = clave(p, s);
        var n = S.borrador[k] ? S.borrador[k].qty : 0;
        return '<div class="vpc-pick-row"><span><b>' + esc(s.label) + '</b></span>' +
          '<span class="vpc-pick-end"><span class="vpc-pick-price">' + money(s.price) + '</span>' +
          pasoHTML(k, p.id, s.id, s.label, p.name, s.price, n) + '</span></div>';
      }).join('') +
      '</div><div class="vpc-pie"><button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.volverProductos()">Listo</button></div></div></div>';
    abrirModal(h, { dismissible: true });
  }
  function volverProductos() { abrirModal(hojaProductosHTML(), { dismissible: true }); }
  function repintarHoja() {
    var sh = document.querySelector('#modal-layer .modal-sheet');
    if (!sh) return;
    var y = document.querySelector('#modal-layer .vpc-picker');
    var top = y ? y.scrollTop : 0;
    sh.outerHTML = hojaProductosHTML();
    var y2 = document.querySelector('#modal-layer .vpc-picker');
    if (y2) y2.scrollTop = top;
  }
  function mas(pid, sid, slabel, nombre, precio) {
    var k = pid + '|' + (sid || '');
    if (!S.borrador[k]) S.borrador[k] = { productId: pid, sizeId: sid || null, sizeLabel: slabel || null, name: nombre, price: Number(precio) || 0, qty: 0, nota: '' };
    S.borrador[k].qty++;
    repintarHoja();
  }
  function menos(k) {
    if (!S.borrador[k]) return;
    S.borrador[k].qty--;
    if (S.borrador[k].qty <= 0) delete S.borrador[k];
    repintarHoja();
  }
  function buscar(v) { S.busca = v || ''; clearTimeout(buscar._t); buscar._t = setTimeout(repintarHoja, 180); }
  function filtrarCat(c) { S.categoria = c; repintarHoja(); }

  function guardarBorrador() {
    if (!S.cuenta) return;
    var lineas = [];
    for (var k in S.borrador) {
      var b = S.borrador[k];
      lineas.push({ productId: b.productId, qty: b.qty, sizeId: b.sizeId, sizeLabel: b.sizeLabel, nota: b.nota || '' });
    }
    if (!lineas.length) return;
    var id = S.cuenta.id;
    var btn = document.querySelector('#modal-layer .vpc-btn.is-main'); if (btn) btn.disabled = true;
    accion('vp_com_agregar', { p_cuenta: id, p_lineas: lineas, p_actor: nombreActor(), p_idem: llave() }, function () {
      S.borrador = {};
      cerrarModal();
      cargarCuenta(id, function () {
        repintar();
        avisar('Agregado. Falta enviar la comanda', { icon: ico('check'), variant: 'toast-success' });
      });
    }).then(function () { if (btn) btn.disabled = false; });
  }

  /* =======================================================================
     16.  COBRO · se usa el cobro de siempre, no uno nuevo
  ======================================================================= */
  function cobrar() {
    var c = S.cuenta; if (!c) return;
    if (!puedeCobrar()) { avisar('Solo la caja puede cobrar', { icon: ico('alert') }); return; }

    var ps = (c.productos || []).filter(function (p) { return p.estado !== 'cancelado'; });
    if (!ps.length) { avisar('Esta mesa no tiene nada que cobrar', { icon: ico('alert') }); return; }
    if (ps.filter(function (p) { return p.estado === 'problema'; }).length) {
      avisar('Hay un problema sin resolver', { icon: ico('alert'), variant: 'toast-danger', subtitle: 'Resuélvelo antes de cobrar' }); return;
    }

    var cart = ref('cart'), checkout = ref('checkout'), customItems = ref('customItems');
    var nuevo = fn('newCheckout');
    if (!cart || !checkout || !nuevo) { avisar('No se pudo abrir el cobro'); return; }

    var puerta = fn('cashGate');
    if (puerta && !puerta(function () { cobrar(); }, { ok: 'Abrir caja y cobrar', what: 'cobrar' })) return;

    var seguir = function () {
      cart.length = 0;
      for (var k in customItems) delete customItems[k];
      var base = nuevo();
      for (var x in checkout) delete checkout[x];
      for (var y in base) checkout[y] = base[y];
      checkout.table = c.mesa === 'Venta libre' ? '' : String(c.mesa || '').slice(0, 60);
      if (checkout.table) checkout.serviceType = 'mesa';
      checkout.vpcCuenta = c.id;

      ps.forEach(function (p) {
        var l = { productId: p.producto_id, qty: Number(p.cantidad), unitPrice: Number(p.precio) };
        if (p.size) l.sizeLabel = p.size;
        if (p.nota) l.note = p.nota;
        cart.push(l);
      });

      cerrarModal();
      irA('sale');
      var hoja = fn('openCartSheet'); if (hoja) hoja('checkout');
      avisar('Cobrando ' + c.mesa, { icon: ico('cash'), variant: 'toast-success toast-top', subtitle: money(c.total) });
    };

    if (cart.length) {
      var preguntar = fn('askConfirm');
      if (preguntar) { preguntar({ title: 'Tu carrito tiene productos', text: '¿Cambiarlos por los de ' + c.mesa + '?', ok: 'Cambiar', icon: ico('cart') }, seguir); return; }
    }
    seguir();
  }

  function cerrarPorVenta(cuentaId, venta) {
    accion('vp_com_cerrar', {
      p_cuenta: cuentaId,
      p_venta_id: String(venta.id),
      p_venta_numero: Number(venta.number) || null,
      p_total: Number(venta.total) || 0,
      p_actor: nombreActor()
    }, function () { S.cuenta = null; cargarTablero(); });
  }

  /* =======================================================================
     17.  ADMINISTRACIÓN (solo el dueño)
  ======================================================================= */
  function verMesas() {
    var c = nube(); if (!c || !soyDueno()) return;
    c.sb.from('vp_comandas_mesas').select('*').order('orden').then(function (r) {
      var ms = (r.error ? [] : (r.data || [])).filter(function (m) { return m.activa; });
      var h = '<div class="modal-sheet"><div class="sheet-header"><h2>Mesas</h2>' +
        '<button class="sheet-close" onclick="closeModal()">' + ico('close') + '</button></div><div class="vpc">' +
        '<div class="vpc-field"><label>Agregar mesas</label>' +
        '<input id="vpcMesaNom" type="text" maxlength="120" placeholder="Ej. Mesa 1, Mesa 2, Terraza 1">' +
        '<div class="vpc-hint">Puedes escribir varias separadas por coma.</div></div>' +
        '<button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.crearMesas()">Agregar</button>' +
        '<div class="vpc-spacer"></div>' +
        (ms.length ? '<div class="vpc-list">' + ms.map(function (m) {
          return '<div class="vpc-li is-plain"><span class="vpc-li-ico">' + mi('vpcTable') + '</span>' +
            '<span class="vpc-li-txt"><b>' + esc(m.nombre) + '</b><small>' + (m.capacidad || 4) + ' lugares</small></span>' +
            '<button type="button" class="vpc-mini is-warn" onclick="VPComandas.borrarMesa(' + js(m.id) + ')">Quitar</button></div>';
        }).join('') + '</div>' : vacioHTML(mi('vpcTable'), 'Sin mesas todavía', 'Escribe los nombres de tus mesas arriba.')) +
        '</div></div>';
      abrirModal(h, { dismissible: true });
    });
  }
  function crearMesas() {
    var c = nube(); if (!c) return;
    var i = document.getElementById('vpcMesaNom');
    var txt = (i && i.value || '').trim();
    if (!txt) { avisar('Escribe el nombre de la mesa', { icon: ico('alert') }); return; }
    var nombres = txt.split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 40);
    var filas = nombres.map(function (n, idx) { return { user_id: c.uid, nombre: n, orden: idx }; });
    c.sb.from('vp_comandas_mesas').insert(filas).then(function (r) {
      if (r.error) { avisar('Alguna de esas mesas ya existe', { icon: ico('alert'), variant: 'toast-danger' }); return; }
      avisar(nombres.length === 1 ? 'Mesa agregada' : nombres.length + ' mesas agregadas', { icon: ico('check'), variant: 'toast-success' });
      S.tablero = null;
      verMesas();
    });
  }
  function borrarMesa(id) {
    var c = nube(); if (!c) return;
    c.sb.from('vp_comandas_mesas').update({ activa: false }).eq('id', id).then(function (r) {
      if (r.error) { avisar('No se pudo quitar', { variant: 'toast-danger' }); return; }
      S.tablero = null; verMesas();
    });
  }

  function verAreas() {
    var c = nube(); if (!c || !soyDueno()) return;
    c.sb.from('vp_comandas_areas').select('*').order('orden').then(function (r) {
      var as = (r.error ? [] : (r.data || [])).filter(function (a) { return a.activa; });
      var h = '<div class="modal-sheet"><div class="sheet-header"><h2>Áreas de preparación</h2>' +
        '<button class="sheet-close" onclick="closeModal()">' + ico('close') + '</button></div><div class="vpc">' +
        '<p class="vpc-sub">Aquí decides a qué lugar del negocio llega cada producto. Si no agregas ninguna, todo se manda a Cocina.</p>' +
        '<div class="vpc-field"><label>Nueva área</label>' +
        '<input id="vpcAreaNom" type="text" maxlength="40" placeholder="Ej. Barra"></div>' +
        '<button type="button" class="vpc-btn is-main is-block" onclick="VPComandas.crearArea()">Agregar área</button>' +
        '<div class="vpc-spacer"></div><div class="vpc-list">' + as.map(function (a) {
          return '<div class="vpc-li is-plain"><span class="vpc-li-ico">' + mi('vpcPot') + '</span>' +
            '<span class="vpc-li-txt"><b>' + esc(a.nombre) + '</b></span>' +
            '<button type="button" class="vpc-mini" onclick="VPComandas.verRuteo(' + js(a.id) + ',' + js(a.nombre) + ')">Productos</button></div>';
        }).join('') + '</div></div></div>';
      abrirModal(h, { dismissible: true });
    });
  }
  function crearArea() {
    var c = nube(); if (!c) return;
    var i = document.getElementById('vpcAreaNom');
    var n = (i && i.value || '').trim();
    if (!n) return;
    c.sb.from('vp_comandas_areas').insert({ user_id: c.uid, nombre: n, orden: 99 }).then(function (r) {
      if (r.error) { avisar('Esa área ya existe', { icon: ico('alert') }); return; }
      S.listo = false; estadoServidor();
      verAreas();
    });
  }
  function verRuteo(areaId, nombre) {
    var c = nube(); if (!c) return;
    c.sb.from('vp_comandas_ruteo').select('*').eq('area_id', areaId).then(function (r) {
      var ya = {};
      (r.error ? [] : (r.data || [])).forEach(function (x) { ya[x.tipo + ':' + x.clave] = x.id; });
      var cats = categorias();
      var h = '<div class="modal-sheet"><div class="sheet-header"><h2>' + esc(nombre) + '</h2>' +
        '<button class="sheet-close" onclick="VPComandas.verAreas()">' + ico('chevronLeft') + '</button></div><div class="vpc">' +
        '<p class="vpc-sub">Marca las categorías que se preparan en ' + esc(nombre) + '. Lo que no marques se va a Cocina.</p>' +
        '<div class="vpc-list">' + cats.map(function (cat) {
          var k = 'categoria:' + cat, on = !!ya[k];
          return '<div class="vpc-li is-plain"><span class="vpc-li-txt"><b>' + esc(cat) + '</b></span>' +
            '<button type="button" class="vpc-mini' + (on ? ' is-main' : '') + '" onclick="VPComandas.ruteo(' + js(areaId) + ',' + js(cat) + ',' + (on ? js(ya[k]) : 'null') + ',' + js(nombre) + ')">' + (on ? 'Sí' : 'No') + '</button></div>';
        }).join('') + '</div></div></div>';
      abrirModal(h, { dismissible: true });
    });
  }
  function ruteo(areaId, cat, idExistente, nombre) {
    var c = nube(); if (!c) return;
    var p = idExistente
      ? c.sb.from('vp_comandas_ruteo').delete().eq('id', idExistente)
      : c.sb.from('vp_comandas_ruteo').insert({ user_id: c.uid, tipo: 'categoria', clave: cat, area_id: areaId });
    p.then(function () { verRuteo(areaId, nombre); });
  }

  /* =======================================================================
     18.  MENÚ DIGITAL · aceptar un pedido manda la comanda sola
  ======================================================================= */
  function pedidoACocina(o) {
    if (!S.activo || !o || !Array.isArray(o.lines)) return;
    var lineas = o.lines.map(function (l) {
      return { productId: l.productId, qty: Number(l.qty) || 1, sizeId: l.sizeId || null, sizeLabel: l.sizeLabel || null, nota: l.note || '' };
    }).filter(function (l) { return l.productId && l.qty > 0; });
    if (!lineas.length) return;
    rpc('vp_com_menu', {
      p_code: String(o.code || ''),
      p_cliente: String((o.customer && o.customer.name) || 'Cliente'),
      p_lineas: lineas,
      p_actor: nombreActor(),
      p_idem: 'md:' + o.id
    }).then(function (d) {
      if (d && d.ok && !d.repetida) {
        avisar('Comanda ' + d.comanda + ' enviada a cocina', { icon: mi('vpcSend'), variant: 'toast-success', subtitle: 'Pedido ' + o.code });
      }
    }).catch(function (e) { console.warn('Vendo plus · comandas menú', e); });
  }

  /* =======================================================================
     19.  ENGANCHES (siempre llaman primero a la función original)
  ======================================================================= */
  function engancharMenu() {
    var original = window.mdiConfirm;
    if (typeof original !== 'function' || original.vpcEnvuelta) return;
    var envuelta = function (id) {
      var MDI = ref('MDI');
      var antes = (MDI && MDI.get) ? MDI.get(id) : null;
      var r = original.apply(this, arguments);
      try {
        var desp = (MDI && MDI.get) ? MDI.get(id) : null;
        if (antes && antes.status === 'nuevo' && desp && desp.status === 'confirmado') pedidoACocina(desp);
      } catch (e) { }
      return r;
    };
    envuelta.vpcEnvuelta = true;
    window.mdiConfirm = envuelta;
  }

  function engancharSesion() {
    var original = window.openUserSession;
    if (typeof original !== 'function') return;
    window.openUserSession = function () {
      var r = original.apply(this, arguments);
      S.asignacion = null;
      setTimeout(function () {
        if (!document.body.classList.contains('auth-open')) estadoServidor().then(abrirAreaAsignada);
      }, 0);
      return r;
    };
  }

  /* =======================================================================
     20.  REGISTRO
  ======================================================================= */
  function registrar() {
    try {
      var EV = ref('EXTRA_VIEWS');
      if (!EV) return false;
      EV.comandas = vistaElegir;
      EV.comandas_mesero = vistaMesero;
      EV.comandas_cocina = vistaCocina;
      EV.comandas_caja = vistaCaja;
      return true;
    } catch (e) { return false; }
  }

  function ir(vista) {
    S.cuenta = null;
    S.errorTablero = false;
    if (vista === 'comandas_cocina') S.cocina = null; else S.tablero = null;
    irA(vista);
    setTimeout(refrescarLoQueSeVe, 0);
  }
  function abrir() { S.listo = false; ir('comandas'); }
  function verPremium() {
    if (window.VPPremium && VPPremium.abrir) VPPremium.abrir();
    else avisar('Activa Premium desde Mi cuenta');
  }
  function filtrarArea(id) { S.area = id; S.cocina = null; repintar(); cargarCocina(); }

  /* =======================================================================
     21.  ARRANQUE
  ======================================================================= */
  function arrancar() {
    ponIconos();
    if (!registrar()) { setTimeout(arrancar, 300); return; }
    engancharSesion();
    sondear();
    setTimeout(function () {
      if (nube()) estadoServidor().then(function () { setTimeout(abrirAreaAsignada, 400); });
      else {
        var t = setInterval(function () {
          if (nube()) { clearInterval(t); estadoServidor().then(function () { setTimeout(abrirAreaAsignada, 400); }); }
        }, 1500);
        setTimeout(function () { clearInterval(t); }, 30000);
      }
    }, 1200);
  }

  /* =======================================================================
     22.  LO QUE QUEDA DISPONIBLE PARA EL RESTO DE VENDO PLUS
  ======================================================================= */
  window.VPComandas = {
    abrir: abrir, ir: ir,
    activo: habilitado,
    area: miArea,
    verPremium: verPremium,
    encender: encender, apagar: apagar,
    toggle: toggle, verUsuarios: verUsuarios, asignar: asignar, irAUsuarios: irAUsuarios,
    abrirMesa: abrirMesa, confirmarMesa: confirmarMesa, ventaLibre: ventaLibre,
    abrirCuenta: abrirCuenta, cerrarCuenta: cerrarCuenta,
    enviar: enviar, pedirCuenta: pedirCuenta, cancelarCuenta: cancelarCuenta,
    cobrar: cobrar, puedeCobrar: puedeCobrar, cerrarPorVenta: cerrarPorVenta, marcar: marcar, todoListo: todoListo,
    reportar: reportar, mandarProblema: mandarProblema,
    verProblemas: verProblemas, resolver: resolver,
    elegirProductos: elegirProductos, verTamanos: verTamanos, volverProductos: volverProductos,
    mas: mas, menos: menos, buscar: buscar, filtrarCat: filtrarCat, guardarBorrador: guardarBorrador,
    filtrarArea: filtrarArea,
    verMesas: verMesas, crearMesas: crearMesas, borrarMesa: borrarMesa,
    verAreas: verAreas, crearArea: crearArea, verRuteo: verRuteo, ruteo: ruteo
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
