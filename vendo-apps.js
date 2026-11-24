/* =========================================================================
   APPS DE DELIVERY · Rappi, DiDi Food y Uber Eats
   -------------------------------------------------------------------------
   Los pedidos se atienden en la app de cada plataforma. Cuando un pedido
   se COMPLETA, la plataforma avisa a la función "apps-delivery" de
   Supabase y queda en vp_apps_pedidos. Aquí:
   · Se "reclaman" esas ventas (solo un celular las registra, así no se
     duplican), se guardan en el Historial con su plataforma y se descuenta
     del inventario lo que el negocio vinculó.
   · Pantalla de cada app: enlazar, dirección del webhook, resumen,
     "Enlazar productos" y "Ver historial".
   · Pantalla aparte para vincular productos de la plataforma con los de
     VendoPlus (Producto de la plataforma → Producto de VendoPlus).
   Usa lo que ya existe en index.html (DB, Cloud, icon, toast…).
========================================================================= */
(function () {
  'use strict';
  if (window.VPApps) return;

  var FN = 'apps-delivery';
  var ORDEN = VP_APPS_ORDEN;
  var st = { app: 'rappi', info: null, cargando: false, err: '', form: false, guardando: false };
  var vin = null;   /* estado de la pantalla de vincular productos */

  /* ---------- utilidades ---------- */
  function esc(t) { return escapeHtml(t == null ? '' : String(t)); }
  function nombre(k) { return (VP_APPS[k] || {}).n || k; }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function logo(k, cls) {
    var a = VP_APPS[k] || {};
    return '<span class="vpa-logo ' + (cls || '') + '" style="background:' + a.c + '" aria-hidden="true">' + esc(a.l || '?') + '</span>';
  }
  function listoNube() {
    return typeof Cloud !== 'undefined' && Cloud.ready && Cloud.sb && !!Cloud.uid &&
      !document.body.classList.contains('dm-mode') &&
      !(typeof AUTH !== 'undefined' && AUTH.isLogged && !AUTH.isLogged());
  }
  async function llamar(body) {
    if (!listoNube()) throw new Error('Inicia sesión para enlazar tus apps');
    var s = null;
    try { s = (await Cloud.sb.auth.getSession()).data.session; } catch (e) {}
    if (!s || !s.access_token) throw new Error('Tu sesión se cerró. Vuelve a entrar a tu cuenta');
    var r;
    try {
      r = await fetch(mpBase() + '/functions/v1/' + FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: VENDO_CONFIG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify(body || {})
      });
    } catch (e) { throw new Error('Sin conexión a internet. Revísala e inténtalo otra vez'); }
    var j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || 'No se pudo completar. Inténtalo otra vez');
    return j;
  }

  /* =======================================================================
     1. REGISTRAR LAS VENTAS COMPLETADAS
  ======================================================================= */
  var sync = { busy: false, t: null, last: 0 };

  /** Producto de VendoPlus vinculado a un artículo del pedido (por ID; si no, por nombre). */
  function vinculado(plat, it, vincs, prods) {
    var v = vincs.find(function (x) { return x.plataforma === plat && x.producto_id === it.id; });
    if (!v) {
      var n = norm(it.nombre);
      var p = prods.find(function (x) { return x.plataforma === plat && norm(x.nombre) === n; });
      if (p) v = vincs.find(function (x) { return x.plataforma === plat && x.producto_id === p.producto_id; });
    }
    return v ? v.vp_producto_id : null;
  }

  function ventaDe(row, vincs, prods, inventario) {
    var lineas = [];
    var items = (Array.isArray(row.items) ? row.items : []).map(function (it) {
      var qty = Number(it.cantidad) || 1;
      var price = round2(Number(it.precio) || 0);
      var pid = vinculado(row.plataforma, it, vincs, prods);
      var p = pid ? inventario.find(function (x) { return x.id === pid; }) : null;
      if (p) {
        lineas.push({ productId: p.id, qty: qty });
        var item = {
          productId: p.id, name: p.name, price: price, cost: p.cost != null ? round2(p.cost) : null, qty: qty,
          sizeId: null, sizeLabel: null, unit: p.unit || 'pieza', category: p.category || null,
          stockUse: stockInfo(p).control ? lineStockUse(p, { productId: p.id, qty: qty }) : 0,
          appItem: String(it.nombre || '')
        };
        if (p.sku) item.sku = p.sku;
        return item;
      }
      return {
        productId: 'app_' + row.plataforma + '_' + String(it.id || it.nombre || '').slice(0, 60),
        name: String(it.nombre || 'Producto'), price: price, cost: null, qty: qty,
        sizeId: null, sizeLabel: null, unit: 'pieza', category: null, custom: true, stockUse: 0,
        appItem: String(it.nombre || '')
      };
    });
    var suma = round2(items.reduce(function (a, it) { return a + it.price * it.qty; }, 0));
    var total = round2(Number(row.total) || suma);
    return {
      venta: {
        id: 'app_' + row.id,
        number: DB.nextSaleNumber(),
        date: row.completado_at || new Date().toISOString(),
        items: items,
        listTotal: suma || total,
        discount: Math.max(0, round2(suma - total)),
        lineDiscount: 0,
        orderDiscount: Math.max(0, round2(suma - total)),
        orderDiscountLabel: null,
        subtotal: total, iva: 0, total: total, tip: 0,
        taxMode: 'ninguno', taxRate: 0,
        serviceType: 'domicilio', table: '',
        paymentMethod: 'tarjeta', payRef: nombre(row.plataforma),
        cash: 0, change: 0, credit: 0,
        customerId: null, customerName: row.cliente || '', customerPhone: '',
        cancelled: false,
        origin: 'app', app: row.plataforma,
        appOrderId: String(row.pedido_id || ''),
        appCode: String(row.codigo || row.pedido_id || '').slice(-8),
        deviceId: (typeof Store !== 'undefined' && Store.meta) ? Store.meta().deviceId : null
      },
      lineas: lineas
    };
  }

  async function sincronizar(avisar) {
    if (sync.busy || !listoNube()) return 0;
    sync.busy = true; sync.last = Date.now();
    var ids = [];
    try {
      var r = await Cloud.sb.rpc('vp_apps_reclamar');
      if (r.error) throw r.error;
      var rows = r.data || [];
      if (!rows.length) return 0;
      ids = rows.map(function (x) { return x.id; });
      var v = await Cloud.sb.from('vp_apps_vinculos').select('plataforma,producto_id,vp_producto_id');
      var p = await Cloud.sb.from('vp_apps_productos').select('plataforma,producto_id,nombre');
      if (v.error) throw v.error;
      var vincs = v.data || [], prods = (p.data || []);
      var sales = DB.getSales();
      var inventario = DB.getProducts();
      var nuevas = [], uso = {};
      rows.forEach(function (row) {
        if (sales.some(function (s) { return s.id === 'app_' + row.id; })) return;   /* ya estaba */
        var x = ventaDe(row, vincs, prods, inventario);
        sales.push(x.venta);
        nuevas.push(x.venta);
        var u = stockUseByProduct(x.lineas, inventario);
        Object.keys(u).forEach(function (k) { uso[k] = r3((uso[k] || 0) + u[k]); });
      });
      if (!nuevas.length) return 0;
      if (!DB.saveSales(sales)) throw new Error('No se pudo guardar');
      ids = [];   /* ya quedaron guardadas: no se regresan */
      if (Object.keys(uso).length) {
        if (typeof invContext === 'function') invContext({ type: 'venta', ref: nuevas.length === 1 ? saleAppLabel(nuevas[0]) : 'Apps de delivery' });
        var d = deductStock(uso, inventario);
        if (d.cambio) DB.saveProducts(inventario);
        if (typeof invContext === 'function') invContext(null);
      }
      var tot = nuevas.reduce(function (a, s) { return a + s.total; }, 0);
      if (avisar !== false && (typeof userPrefs !== 'function' || userPrefs().notifSales !== false)) {
        toast(nuevas.length === 1 ? 'Venta de ' + saleAppName(nuevas[0]) + ' registrada' : nuevas.length + ' ventas de apps registradas', {
          icon: icon('truck'), variant: 'toast-success', subtitle: formatMoney(tot) + ' · ya está en tu Historial', duration: 3200
        });
      }
      try { if (['history', 'stats', 'home', 'products'].indexOf(currentView) >= 0 && !document.querySelector('#modal-layer .modal-overlay')) render(); } catch (e) {}
      if (document.getElementById('vpaPage')) pintar();
      return nuevas.length;
    } catch (e) {
      console.warn('VendoPlus · apps de delivery', e);
      if (ids.length) { try { await Cloud.sb.rpc('vp_apps_soltar', { ids: ids }); } catch (e2) {} }
      return 0;
    } finally { sync.busy = false; }
  }
  function arrancar() {
    clearInterval(sync.t);
    sync.t = setInterval(function () { if (!document.hidden) sincronizar(); }, 45000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - sync.last > 15000) sincronizar(); });
    setTimeout(sincronizar, 4000);
  }

  /* =======================================================================
     2. PANTALLA DE CADA APP
  ======================================================================= */
  function barraHTML(activa, cls) {
    return '<div class="vpa-seg ' + (cls || '') + '" role="tablist" aria-label="Apps de delivery">' +
      ORDEN.map(function (k) {
        return '<button type="button" role="tab" aria-selected="' + (k === activa) + '" class="' + (k === activa ? 'active' : '') + '" ' +
          (cls === 'mas' ? 'data-go="app:' + k + '"' : 'onclick="VPApps.elegir(\'' + k + '\')"') + '>' +
          '<i style="background:' + VP_APPS[k].c + '"></i>' + esc(VP_APPS[k].n) + '</button>';
      }).join('') + '</div>';
  }
  function barraMasHTML() {
    return '<div class="vpa-mas-tit">Apps de delivery</div>' + barraHTML(null, 'mas');
  }

  function abrir(k) {
    if (typeof isOwner === 'function' && !isOwner()) { toast('Solo el Dueño puede enlazar las apps', { icon: icon('alert') }); return; }
    if (k && VP_APPS[k]) st.app = k;
    st.form = false;
    try { closeModal(); } catch (e) {}
    var pg = document.getElementById('vpaPage');
    if (!pg) {
      pg = document.createElement('div'); pg.id = 'vpaPage'; pg.className = 'stf-page vpa-page';
      pg.setAttribute('role', 'dialog'); pg.setAttribute('aria-modal', 'true'); pg.setAttribute('aria-label', 'Apps de delivery');
      document.body.appendChild(pg);
      requestAnimationFrame(function () { pg.classList.add('on'); });
      document.body.classList.add('stf-abierta');
      try { history.pushState({ vpa: 1 }, ''); } catch (e) {}
    }
    pintar(true);
    cargar();
  }
  function cerrar(desdeAtras) {
    var pg = document.getElementById('vpaPage'); if (!pg) return;
    pg.classList.remove('on'); pg.classList.add('sale');
    if (!document.getElementById('stfPage')) document.body.classList.remove('stf-abierta');
    setTimeout(function () { pg.remove(); }, 220);
    if (!desdeAtras) { try { if (history.state && history.state.vpa) history.back(); } catch (e) {} }
  }
  function elegir(k) { if (!VP_APPS[k] || st.app === k) return; st.app = k; st.form = false; if (typeof vibrate === 'function') vibrate(8); pintar(); }

  async function cargar() {
    st.cargando = true; st.err = ''; pintar();
    try { st.info = (await llamar({ action: 'estado' })).apps; }
    catch (e) { st.err = String(e.message || e).slice(0, 160); }
    st.cargando = false; pintar();
    sincronizar();
  }

  function ventasDe(k) {
    return DB.getSales().filter(function (s) { return s.origin === 'app' && s.app === k && !s.cancelled; });
  }

  var AYUDA = {
    rappi: { id: 'ID de tu tienda en Rappi', ej: 'Ej. 900123456', portal: 'Rappi Partners → Integraciones → Webhooks',
      extra: [{ k: 'webhook_secret', t: 'Secreto del webhook (opcional)', s: 'Rappi lo da al crear el webhook. Con él VendoPlus revisa que cada aviso venga de verdad de Rappi.' }] },
    didi: { id: 'ID de tu tienda en DiDi Food', ej: 'Ej. 5764608123', portal: 'DiDi Food Open Platform (o tu integrador) → Notificaciones de pedidos',
      extra: [] },
    uber: { id: 'Store ID de Uber Eats', ej: 'Ej. 1a2b3c4d-…', portal: 'Uber Eats Developer → tu app → Webhooks',
      extra: [{ k: 'client_id', t: 'Client ID (opcional)', s: '' }, { k: 'client_secret', t: 'Client secret (opcional)', s: 'Con estos dos datos VendoPlus revisa la firma de Uber y baja el detalle de cada pedido.' }] }
  };

  function cuerpoApp() {
    var k = st.app, a = VP_APPS[k], info = st.info && st.info[k];
    if (!info && st.cargando) return '<div class="stf-carga"><i></i><i></i><i></i></div>';
    if (!info && st.err) return '<div class="mdi-banner warn">' + icon('alert') + '<span><b>No se pudo cargar</b>' + esc(st.err) + '</span></div>' +
      '<button class="btn primary block" style="margin-top:12px" onclick="VPApps.recargar()">' + icon('refresh') + ' Intentar otra vez</button>';
    var ventas = ventasDe(k);
    var total = ventas.reduce(function (x, s) { return x + s.total; }, 0);
    var conectada = !!(info && info.conectada);
    var estado = !conectada ? { c: 'gris', t: 'Sin enlazar' } : info.estado === 'activa' ? { c: 'ok', t: 'Enlazada' } : { c: 'warn', t: 'Esperando primer aviso' };
    var h = '<div class="vpa-head">' + logo(k, 'xl') +
      '<div class="vpa-head-txt"><b>' + esc(a.n) + '</b><small>' + (conectada ? 'Tienda ' + esc(info.store_id) : 'Ventas completadas en tu Historial') + '</small></div>' +
      '<span class="stf-pill ' + estado.c + '">' + estado.t + '</span></div>';

    if (!conectada || st.form) {
      var ay = AYUDA[k];
      if (!st.form) {
        return h + '<div class="vpa-card">' +
          '<p class="vpa-p">Los pedidos se siguen atendiendo en la app de ' + esc(a.n) + '. Cuando un pedido se <b>completa</b>, VendoPlus:</p>' +
          '<ul class="vpa-lista"><li>' + icon('receipt') + '<span>Lo registra en tu <b>Historial</b> y en <b>Estadísticas</b>, marcado como ' + esc(a.n) + '.</span></li>' +
          '<li>' + icon('box') + '<span>Descuenta de tu <b>inventario</b> los productos que vincules.</span></li></ul>' +
          '<button class="btn primary block vpa-btn" style="--app:' + a.c + '" onclick="VPApps.formulario(true)">' + icon('link') + ' Enlazar con ' + esc(a.n) + '</button>' +
          '</div>';
      }
      return h + '<div class="vpa-card">' +
        '<div class="field"><label for="vpaStore">' + esc(ay.id) + '</label><input id="vpaStore" autocomplete="off" placeholder="' + esc(ay.ej) + '" value="' + esc(conectada ? info.store_id : '') + '"></div>' +
        ay.extra.map(function (x) {
          return '<div class="field"><label for="vpa_' + x.k + '">' + esc(x.t) + '</label><input id="vpa_' + x.k + '" type="' + (/secret/.test(x.k) ? 'password' : 'text') + '" autocomplete="off" placeholder="' + (conectada ? 'Déjalo vacío para no cambiarlo' : '') + '">' +
            (x.s ? '<small class="vpa-hint">' + esc(x.s) + '</small>' : '') + '</div>';
        }).join('') +
        '<div class="vpa-acts"><button class="btn ghost" onclick="VPApps.formulario(false)">Cancelar</button>' +
        '<button class="btn primary vpa-btn" style="--app:' + a.c + '" id="vpaGuardar" onclick="VPApps.conectar()">' + (conectada ? 'Guardar' : 'Enlazar') + '</button></div>' +
        '</div>';
    }

    return h +
      '<div class="vpa-stats">' +
        '<div><small>Ventas registradas</small><b>' + ventas.length + '</b></div>' +
        '<div><small>Total vendido</small><b>' + formatMoney(total) + '</b></div>' +
      '</div>' +
      '<div class="vpa-card">' +
        '<div class="vpa-lbl">Dirección para avisos de ' + esc(a.n) + '</div>' +
        '<p class="vpa-p sm">Pégala en <b>' + esc(AYUDA[k].portal) + '</b> para que cada venta completada llegue sola.</p>' +
        '<div class="vpa-url"><code>' + esc(info.webhook_url) + '</code><button type="button" onclick="VPApps.copiar()" aria-label="Copiar dirección">' + icon('copy') + '</button></div>' +
        (info.ultimo_evento_at ? '<p class="vpa-p sm">Último aviso: ' + esc(new Date(info.ultimo_evento_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) + '</p>' : '') +
      '</div>' +
      '<button class="vpa-opc" onclick="VPApps.vincular()">' +
        '<span class="vpa-opc-ico" style="--app:' + a.c + '">' + icon('link') + '</span>' +
        '<span class="vpa-opc-txt"><b>Enlazar productos</b><small>Para descontar tu inventario con cada venta</small></span>' + icon('chevronRight') + '</button>' +
      '<button class="vpa-opc" onclick="VPApps.historial()">' +
        '<span class="vpa-opc-ico" style="--app:' + a.c + '">' + icon('receipt') + '</span>' +
        '<span class="vpa-opc-txt"><b>Ver historial</b><small>Ventas de ' + esc(a.n) + ' en tu Historial</small></span>' + icon('chevronRight') + '</button>' +
      '<div class="vpa-pie"><button type="button" class="vpa-lnk" onclick="VPApps.formulario(true)">Editar datos</button><span>·</span><button type="button" class="vpa-lnk" onclick="VPApps.desconectar()">Desenlazar</button></div>';
  }

  function pintar(primera) {
    var pg = document.getElementById('vpaPage'); if (!pg) return;
    var cuerpo = cuerpoApp();
    var caja = pg.querySelector('.vpa');
    if (!primera && caja) {
      pg.querySelector('.vpa-barra').innerHTML = barraHTML(st.app);
      caja.innerHTML = cuerpo; return;
    }
    pg.innerHTML =
      '<div class="stf-top"><div class="stf-top-in">' +
        '<button type="button" class="stf-atras" onclick="VPApps.cerrar()" aria-label="Regresar">' + icon('chevronLeft') + '</button>' +
        '<h1>Apps de delivery</h1>' +
        '<button type="button" class="stf-actualizar" onclick="VPApps.recargar()" aria-label="Actualizar">' + icon('refresh') + '</button>' +
      '</div></div>' +
      '<div class="stf-scroll"><div class="vpa-in"><div class="vpa-barra">' + barraHTML(st.app) + '</div><div class="vpa">' + cuerpo + '</div></div></div>';
  }

  function formulario(v) { st.form = !!v; pintar(); if (v) setTimeout(function () { var i = document.getElementById('vpaStore'); if (i) i.focus(); }, 60); }
  async function conectar() {
    var k = st.app, val = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
    var body = { action: 'conectar', plataforma: k, store_id: val('vpaStore') };
    if (!body.store_id) { toast('Escribe el ID de tu tienda', { icon: icon('alert') }); return; }
    AYUDA[k].extra.forEach(function (x) { var v = val('vpa_' + x.k); if (v) body[x.k] = v; });
    var b = document.getElementById('vpaGuardar'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    try {
      await llamar(body);
      st.form = false;
      toast(nombre(k) + ' enlazada', { icon: icon('check'), variant: 'toast-success', subtitle: 'Ahora pega la dirección de avisos en su portal' });
      await cargar();
    } catch (e) {
      toast('No se pudo enlazar', { icon: icon('alert'), variant: 'toast-danger', subtitle: String(e.message || e).slice(0, 140) });
      if (b) { b.disabled = false; b.textContent = 'Enlazar'; }
    }
  }
  function desconectar() {
    var k = st.app;
    askConfirm({
      title: '¿Desenlazar ' + esc(nombre(k)) + '?',
      text: 'Dejarán de llegar sus ventas. Las que ya están en tu Historial se quedan igual. Si lo vuelves a enlazar, tendrás una dirección de avisos nueva.',
      ok: 'Desenlazar', cancel: 'Volver', danger: true, icon: icon('alert')
    }, async function () {
      try { await llamar({ action: 'desconectar', plataforma: k }); toast(nombre(k) + ' desenlazada'); cargar(); }
      catch (e) { toast('No se pudo desenlazar', { icon: icon('alert'), variant: 'toast-danger', subtitle: String(e.message || e).slice(0, 140) }); }
    });
  }
  function copiar() {
    var u = st.info && st.info[st.app] && st.info[st.app].webhook_url; if (!u) return;
    var ok = function () { toast('Dirección copiada', { icon: icon('check') }); };
    try { navigator.clipboard.writeText(u).then(ok, function () { prompt('Copia esta dirección:', u); }); }
    catch (e) { prompt('Copia esta dirección:', u); }
  }
  function historial() {
    try { historyFilters.origin = st.app; } catch (e) {}
    cerrar();
    setTimeout(function () { try { goTo('history'); } catch (e) {} }, 240);
  }

  /* =======================================================================
     3. PANTALLA APARTE: ENLAZAR PRODUCTOS
  ======================================================================= */
  async function vincular() {
    var k = st.app;
    vin = { app: k, prods: [], vinc: {}, base: {}, abierta: null, sel: null, q: '', cargando: true, err: '', agregar: false };
    var pg = document.getElementById('vpaVinc');
    if (!pg) {
      pg = document.createElement('div'); pg.id = 'vpaVinc'; pg.className = 'stf-page vpa-page vpa-vinc';
      pg.setAttribute('role', 'dialog'); pg.setAttribute('aria-modal', 'true'); pg.setAttribute('aria-label', 'Enlazar productos');
      document.body.appendChild(pg);
      requestAnimationFrame(function () { pg.classList.add('on'); });
      try { history.pushState({ vpaVinc: 1 }, ''); } catch (e) {}
    }
    pintarVinc(true);
    try {
      var p = await Cloud.sb.from('vp_apps_productos').select('producto_id,nombre,precio').eq('plataforma', k).order('nombre');
      var v = await Cloud.sb.from('vp_apps_vinculos').select('producto_id,vp_producto_id').eq('plataforma', k);
      if (p.error) throw p.error;
      if (v.error) throw v.error;
      vin.prods = p.data || [];
      (v.data || []).forEach(function (x) { vin.vinc[x.producto_id] = x.vp_producto_id; vin.base[x.producto_id] = x.vp_producto_id; });
    } catch (e) { vin.err = 'No se pudieron cargar los productos. Revisa tu conexión.'; }
    vin.cargando = false;
    pintarVinc();
  }
  function cambios() {
    if (!vin) return 0;
    var n = 0, ks = {};
    Object.keys(vin.vinc).concat(Object.keys(vin.base)).forEach(function (k) { ks[k] = 1; });
    Object.keys(ks).forEach(function (k) { if ((vin.vinc[k] || null) !== (vin.base[k] || null)) n++; });
    return n;
  }
  function cerrarVinc(desdeAtras, forzar) {
    var pg = document.getElementById('vpaVinc'); if (!pg) return;
    if (!forzar && cambios()) {
      if (desdeAtras) { try { history.pushState({ vpaVinc: 1 }, ''); } catch (e) {} }
      askConfirm({ title: '¿Salir sin guardar?', text: 'Tienes vinculaciones sin guardar.', ok: 'Salir sin guardar', cancel: 'Seguir aquí', danger: true, icon: icon('alert') },
        function () { cerrarVinc(false, true); });
      return;
    }
    pg.classList.remove('on'); pg.classList.add('sale');
    setTimeout(function () { pg.remove(); }, 220);
    if (!desdeAtras) { try { if (history.state && history.state.vpaVinc) history.back(); } catch (e) {} }
    vin = null;
    if (document.getElementById('vpaPage')) pintar();
  }
  function productosVP() {
    return DB.getProducts().filter(function (p) { return p && !p.custom && p.active !== false; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'es'); });
  }
  function nombreVP(id) { var p = DB.getProducts().find(function (x) { return x.id === id; }); return p ? p.name : null; }

  function opcionesHTML(pid) {
    var q = norm(vin.q);
    var lista = productosVP().filter(function (p) { return !q || norm(p.name + ' ' + (p.sku || '')).indexOf(q) >= 0; }).slice(0, 80);
    if (!lista.length) return '<p class="vpa-vacio sm">No hay productos con “' + esc(vin.q) + '”.</p>';
    return lista.map(function (p) {
      var on = vin.sel === p.id;
      return '<button type="button" class="vpa-opt ' + (on ? 'on' : '') + '" onclick="VPApps.marcar(\'' + esc(p.id) + '\')">' +
        '<span class="vpa-radio"></span><span class="vpa-opt-n">' + esc(p.name) + '</span><span class="vpa-opt-p">' + formatMoney(Number(p.price) || 0) + '</span></button>';
    }).join('');
  }
  function filaHTML(pr) {
    var vid = vin.vinc[pr.producto_id] || null, vn = vid ? nombreVP(vid) : null;
    var abierta = vin.abierta === pr.producto_id;
    var cambio = (vin.vinc[pr.producto_id] || null) !== (vin.base[pr.producto_id] || null);
    return '<div class="vpa-row' + (abierta ? ' abierta' : '') + (vid ? ' ok' : '') + '" data-pid="' + esc(pr.producto_id) + '">' +
      '<div class="vpa-row-top">' +
        '<span class="vpa-plat"><b>' + esc(pr.nombre) + '</b><small>' + (pr.precio != null ? formatMoney(Number(pr.precio)) + ' · ' : '') + esc(nombre(vin.app)) + '</small></span>' +
        '<span class="vpa-flecha" aria-hidden="true">→</span>' +
        '<span class="vpa-vp' + (vn ? '' : ' none') + '"><b>' + (vn ? esc(vn) : (vid ? 'Producto borrado' : 'Sin vincular')) + '</b>' + (cambio ? '<small>Sin guardar</small>' : '<small>VendoPlus</small>') + '</span>' +
        '<button type="button" class="vpa-elegir" onclick="VPApps.abrirFila(\'' + esc(pr.producto_id).replace(/'/g, '&#39;') + '\')">' + (abierta ? 'Cerrar' : vid ? 'Editar' : 'Elegir') + '</button>' +
      '</div>' +
      (abierta ?
        '<div class="vpa-sel">' +
          '<label class="stf-buscar">' + icon('search') + '<input id="vpaQ" type="search" autocomplete="off" placeholder="Buscar en tus productos" value="' + esc(vin.q) + '" oninput="VPApps.buscar(this.value)"></label>' +
          '<div class="vpa-opts" id="vpaOpts">' + opcionesHTML(pr.producto_id) + '</div>' +
          '<div class="vpa-acts">' +
            (vid ? '<button type="button" class="btn ghost" onclick="VPApps.quitar()">Quitar vínculo</button>' : '') +
            '<button type="button" class="btn primary" onclick="VPApps.confirmar()"' + (vin.sel ? '' : ' disabled') + '>Confirmar producto</button>' +
          '</div>' +
        '</div>' : '') +
    '</div>';
  }
  function cuerpoVinc() {
    if (vin.cargando) return '<div class="stf-carga"><i></i><i></i><i></i></div>';
    if (vin.err) return '<div class="mdi-banner warn">' + icon('alert') + '<span><b>No se pudo cargar</b>' + esc(vin.err) + '</span></div>';
    var total = vin.prods.length;
    var hechos = vin.prods.filter(function (p) { return !!vin.vinc[p.producto_id]; }).length;
    var pct = total ? Math.round(hechos / total * 100) : 0;
    var h = '<div class="vpa-cuenta"><div><b>' + hechos + ' de ' + total + '</b> productos vinculados</div>' +
      '<div class="vpa-barra-p"><i style="width:' + pct + '%;background:' + VP_APPS[vin.app].c + '"></i></div></div>';
    h += '<p class="vpa-p sm">Cada producto de ' + esc(nombre(vin.app)) + ' que vincules descuenta tu inventario cuando se completa una venta. Los productos aparecen solos con cada pedido; también puedes agregarlos.</p>';
    if (!total && !vin.agregar) h += '<p class="vpa-vacio">Todavía no hay productos de ' + esc(nombre(vin.app)) + '. Llegan solos con la primera venta completada, o agrégalos aquí.</p>';
    h += '<div class="vpa-filas">' + vin.prods.map(filaHTML).join('') + '</div>';
    h += vin.agregar
      ? '<div class="vpa-card vpa-agregar">' +
          '<div class="field"><label for="vpaNuevoN">Nombre como aparece en ' + esc(nombre(vin.app)) + '</label><input id="vpaNuevoN" autocomplete="off" placeholder="Ej. Hamburguesa doble"></div>' +
          '<div class="field"><label for="vpaNuevoId">ID o SKU en ' + esc(nombre(vin.app)) + ' (opcional)</label><input id="vpaNuevoId" autocomplete="off" placeholder="Si no lo sabes, déjalo vacío"></div>' +
          '<div class="vpa-acts"><button class="btn ghost" onclick="VPApps.agregar(false)">Cancelar</button><button class="btn primary" onclick="VPApps.agregarGuardar()">Agregar</button></div>' +
        '</div>'
      : '<button type="button" class="vpa-mas-btn" onclick="VPApps.agregar(true)">' + icon('plus') + ' Agregar producto de ' + esc(nombre(vin.app)) + '</button>';
    return h;
  }
  function pintarVinc(primera) {
    var pg = document.getElementById('vpaVinc'); if (!pg || !vin) return;
    var n = cambios();
    var pie = '<div class="vpa-guardar"><button type="button" class="btn primary block" id="vpaGuardarV" onclick="VPApps.guardarVinc()"' + (n ? '' : ' disabled') + '>' +
      icon('check') + ' Guardar vinculaciones' + (n ? ' (' + n + ')' : '') + '</button></div>';
    if (!primera && pg.querySelector('.vpa')) {
      var sc = pg.querySelector('.stf-scroll'), y = sc ? sc.scrollTop : 0;
      pg.querySelector('.vpa').innerHTML = cuerpoVinc();
      pg.querySelector('.vpa-guardar').outerHTML = pie;
      if (sc) sc.scrollTop = y;
      return;
    }
    pg.innerHTML =
      '<div class="stf-top"><div class="stf-top-in">' +
        '<button type="button" class="stf-atras" onclick="VPApps.cerrarVinc()" aria-label="Regresar">' + icon('chevronLeft') + '</button>' +
        logo(vin.app, 'md') + '<h1>Enlazar productos</h1>' +
      '</div></div>' +
      '<div class="stf-scroll"><div class="vpa-in"><div class="vpa">' + cuerpoVinc() + '</div></div></div>' + pie;
  }
  function abrirFila(pid) {
    if (vin.abierta === pid) { vin.abierta = null; vin.sel = null; }
    else { vin.abierta = pid; vin.sel = vin.vinc[pid] || null; vin.q = ''; }
    pintarVinc();
    var row = document.querySelector('#vpaVinc .vpa-row.abierta');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function marcar(id) {
    vin.sel = id;
    var o = document.getElementById('vpaOpts'); if (o) o.innerHTML = opcionesHTML(vin.abierta);
    var b = document.querySelector('#vpaVinc .vpa-row.abierta .vpa-acts .btn.primary'); if (b) b.disabled = false;
  }
  function buscar(v) { vin.q = v; var o = document.getElementById('vpaOpts'); if (o) o.innerHTML = opcionesHTML(vin.abierta); }
  function confirmar() {
    if (!vin.abierta || !vin.sel) return;
    vin.vinc[vin.abierta] = vin.sel;
    vin.abierta = null; vin.sel = null;
    if (typeof vibrate === 'function') vibrate(8);
    pintarVinc();
  }
  function quitar() { if (!vin.abierta) return; delete vin.vinc[vin.abierta]; vin.abierta = null; vin.sel = null; pintarVinc(); }
  function agregar(v) { vin.agregar = !!v; pintarVinc(); if (v) setTimeout(function () { var i = document.getElementById('vpaNuevoN'); if (i) i.focus(); }, 60); }
  async function agregarGuardar() {
    var n = (document.getElementById('vpaNuevoN') || {}).value || '', id = (document.getElementById('vpaNuevoId') || {}).value || '';
    n = n.trim().slice(0, 120); id = (id.trim() || n).slice(0, 120);
    if (!n) { toast('Escribe el nombre del producto', { icon: icon('alert') }); return; }
    if (vin.prods.some(function (p) { return p.producto_id === id; })) { toast('Ese producto ya está en la lista', { icon: icon('alert') }); return; }
    try {
      var r = await Cloud.sb.from('vp_apps_productos').insert({ user_id: Cloud.uid, plataforma: vin.app, producto_id: id, nombre: n });
      if (r.error) throw r.error;
      vin.prods.push({ producto_id: id, nombre: n, precio: null });
      vin.prods.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
      vin.agregar = false; vin.abierta = id; vin.sel = null; vin.q = '';
      pintarVinc();
    } catch (e) { toast('No se pudo agregar', { icon: icon('alert'), variant: 'toast-danger', subtitle: 'Revisa tu conexión e inténtalo otra vez' }); }
  }
  async function guardarVinc() {
    if (!cambios()) return;
    var b = document.getElementById('vpaGuardarV'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    var poner = [], quitarIds = [];
    Object.keys(vin.vinc).forEach(function (k) { if (vin.vinc[k] !== vin.base[k]) poner.push({ user_id: Cloud.uid, plataforma: vin.app, producto_id: k, vp_producto_id: vin.vinc[k], updated_at: new Date().toISOString() }); });
    Object.keys(vin.base).forEach(function (k) { if (!vin.vinc[k]) quitarIds.push(k); });
    try {
      if (poner.length) { var r = await Cloud.sb.from('vp_apps_vinculos').upsert(poner, { onConflict: 'user_id,plataforma,producto_id' }); if (r.error) throw r.error; }
      if (quitarIds.length) { var d = await Cloud.sb.from('vp_apps_vinculos').delete().eq('plataforma', vin.app).in('producto_id', quitarIds); if (d.error) throw d.error; }
      vin.base = Object.assign({}, vin.vinc);
      if (typeof vibrate === 'function') vibrate([15, 60, 15]);
      toast('Vinculaciones guardadas', { icon: icon('check'), variant: 'toast-success' });
      pintarVinc();
    } catch (e) {
      toast('No se pudieron guardar', { icon: icon('alert'), variant: 'toast-danger', subtitle: 'Revisa tu conexión e inténtalo otra vez' });
      pintarVinc();
    }
  }

  /* Botón de atrás del celular: cierra la pantalla de arriba */
  window.addEventListener('popstate', function () {
    if (document.getElementById('confirm-layer') && document.querySelector('#confirm-layer .modal-overlay')) return;
    if (document.getElementById('vpaVinc')) { cerrarVinc(true); return; }
    if (document.getElementById('vpaPage')) cerrar(true);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || document.querySelector('#confirm-layer .modal-overlay')) return;
    if (document.getElementById('vpaVinc')) cerrarVinc();
    else if (document.getElementById('vpaPage')) cerrar();
  });

  /* ---------- estilos ---------- */
  var css = document.createElement('style');
  css.id = 'vpa-css';
  css.textContent = [
    '.vpa-page.vpa-vinc{z-index:460;}',
    '.vpa-page .stf-scroll{display:block;}',
    '.vpa-in{max-width:620px;margin:0 auto;padding:14px 16px calc(28px + env(safe-area-inset-bottom));zoom:var(--z,1);}',
    '.vpa-vinc .vpa-in{padding-bottom:110px;}',
    '.vpa-seg{display:flex;gap:2px;background:var(--surface-alt,#F1F3F7);border-radius:999px;padding:4px;margin:0 0 16px;}',
    '.vpa-seg button{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;background:none;border-radius:999px;padding:9px 6px;font:inherit;font-size:13px;font-weight:700;color:var(--ink-soft);cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;}',
    '.vpa-seg button i{width:8px;height:8px;border-radius:50%;flex:none;}',
    '.vpa-seg button.active{background:var(--surface,#fff);color:var(--ink);box-shadow:0 1px 3px rgba(22,33,62,.12);}',
    /* en la hoja de "Más" (celular): mismo estilo, sin heredar el de los renglones */
    '.vpa-mas-tit{margin:2px 8px 8px;font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.3px;}',
    '.vp-sheet .vpa-seg.mas{margin:0 0 10px;}',
    '.vp-sheet .vpa-seg.mas button{width:auto;flex:1;display:inline-flex;gap:6px;padding:10px 4px;border-radius:999px;font:700 13px var(--sans);color:var(--ink);text-align:center;background:var(--surface,#fff);box-shadow:0 1px 3px rgba(22,33,62,.10);}',
    '.vp-sheet .vpa-seg.mas button:active{background:var(--vp-soft,#EEF1F5);}',
    '.vpa-logo{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:8px;color:#fff;font-weight:800;font-size:14px;}',
    '.vpa-logo.md{width:30px;height:30px;margin:0 4px 0 2px;}',
    '.vpa-logo.xl{width:46px;height:46px;border-radius:14px;font-size:22px;}',
    '.vpa-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;}',
    '.vpa-head-txt{flex:1;min-width:0;}',
    '.vpa-head-txt b{display:block;font-size:19px;font-weight:800;color:var(--ink);letter-spacing:-.2px;}',
    '.vpa-head-txt small{display:block;margin-top:2px;font-size:12.5px;font-weight:600;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.vpa-card{padding:16px;border-radius:18px;background:var(--surface,#fff);border:1px solid var(--border,#EEF1F5);margin-bottom:12px;}',
    '.vpa-p{margin:0 0 10px;font-size:14px;font-weight:500;line-height:1.45;color:var(--ink);}',
    '.vpa-p.sm{font-size:12.5px;color:var(--ink-soft);}',
    '.vpa-lista{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:10px;}',
    '.vpa-lista li{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;font-weight:500;line-height:1.4;color:var(--ink);}',
    '.vpa-lista svg{width:18px;height:18px;flex:none;color:var(--ink-soft);margin-top:1px;}',
    '.vpa-btn{background:var(--app) !important;border-color:var(--app) !important;color:#fff !important;}',
    '.vpa-acts{display:flex;gap:8px;margin-top:12px;}',
    '.vpa-acts .btn{flex:1;}',
    '.vpa-hint{display:block;margin-top:5px;font-size:11.5px;font-weight:500;color:var(--ink-soft);line-height:1.35;}',
    '.vpa-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}',
    '.vpa-stats > div{padding:12px 14px;border-radius:16px;background:var(--surface,#fff);border:1px solid var(--border,#EEF1F5);}',
    '.vpa-stats small{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);}',
    '.vpa-stats b{display:block;margin-top:3px;font-size:20px;font-weight:800;color:var(--ink);letter-spacing:-.3px;}',
    '.vpa-lbl{margin:0 0 6px;font-size:12.5px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.3px;}',
    '.vpa-url{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;border-radius:12px;background:var(--surface-alt,#F4F6FA);margin-bottom:8px;}',
    '.vpa-url code{flex:1;min-width:0;font-size:11.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.vpa-url button{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:10px;background:var(--surface,#fff);color:var(--ink);cursor:pointer;}',
    '.vpa-url button svg{width:16px;height:16px;}',
    '.vpa-opc{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;margin-bottom:10px;border:1px solid var(--border,#EEF1F5);border-radius:16px;background:var(--surface,#fff);font:inherit;text-align:left;color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '.vpa-opc:active{background:var(--surface-alt,#F6F7FA);}',
    '.vpa-opc > svg{width:18px;height:18px;color:var(--ink-faint,#A3AAB5);flex:none;}',
    '.vpa-opc-ico{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;flex:none;border-radius:12px;background:color-mix(in srgb, var(--app) 12%, #fff);color:color-mix(in srgb, var(--app) 80%, #000);}',
    '.vpa-opc-ico svg{width:19px;height:19px;}',
    '.vpa-opc-txt{flex:1;min-width:0;}',
    '.vpa-opc-txt b{display:block;font-size:14.5px;font-weight:700;}',
    '.vpa-opc-txt small{display:block;margin-top:2px;font-size:12.5px;font-weight:500;color:var(--ink-soft);}',
    '.vpa-pie{display:flex;justify-content:center;gap:8px;margin-top:10px;color:var(--ink-faint,#A3AAB5);font-size:12.5px;}',
    '.vpa-lnk{padding:0;border:0;background:none;font:inherit;font-size:12.5px;font-weight:500;color:var(--ink-soft);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2.5px;cursor:pointer;}',
    /* vincular productos */
    '.vpa-cuenta{padding:14px 16px;border-radius:16px;background:var(--surface,#fff);border:1px solid var(--border,#EEF1F5);margin-bottom:10px;font-size:14px;font-weight:500;color:var(--ink-soft);}',
    '.vpa-cuenta b{color:var(--ink);font-weight:800;font-size:16px;}',
    '.vpa-barra-p{height:6px;border-radius:99px;background:var(--surface-alt,#EEF1F5);margin-top:9px;overflow:hidden;}',
    '.vpa-barra-p i{display:block;height:100%;border-radius:99px;transition:width .3s ease;}',
    '.vpa-filas{display:flex;flex-direction:column;gap:8px;margin:6px 0 10px;}',
    '.vpa-row{border:1px solid var(--border,#EEF1F5);border-radius:16px;background:var(--surface,#fff);overflow:hidden;}',
    '.vpa-row.abierta{border-color:#C9CEDD;box-shadow:0 8px 24px -18px rgba(16,22,42,.35);}',
    '.vpa-row-top{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:11px 10px 11px 12px;}',
    '.vpa-plat,.vpa-vp{min-width:0;}',
    '.vpa-plat b,.vpa-vp b{display:block;font-size:13.5px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.vpa-plat small,.vpa-vp small{display:block;margin-top:2px;font-size:11.5px;font-weight:500;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.vpa-vp.none b{color:var(--ink-faint,#A3AAB5);font-weight:600;}',
    '.vpa-row.ok .vpa-vp b{color:#0E7A3D;}',
    '.vpa-flecha{color:var(--ink-faint,#A3AAB5);font-weight:700;}',
    '.vpa-elegir{flex:none;min-height:34px;padding:0 12px;border:1px solid var(--border,#E3E7EE);border-radius:10px;background:var(--surface,#fff);font:inherit;font-size:12.5px;font-weight:700;color:var(--ink);cursor:pointer;}',
    '.vpa-row.abierta .vpa-elegir{background:var(--surface-alt,#F1F3F7);}',
    '.vpa-sel{padding:0 12px 12px;border-top:1px solid var(--border,#EEF1F5);}',
    '.vpa-sel .stf-buscar{margin-top:12px;}',
    '.vpa-opts{max-height:260px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;margin-top:8px;border:1px solid var(--border,#EEF1F5);border-radius:12px;}',
    '.vpa-opt{display:flex;align-items:center;gap:10px;width:100%;padding:11px 12px;border:0;border-bottom:1px solid var(--border,#EEF1F5);background:none;font:inherit;text-align:left;color:var(--ink);cursor:pointer;}',
    '.vpa-opt:last-child{border-bottom:0;}',
    '.vpa-opt.on{background:#F1FBF5;}',
    '.vpa-radio{width:18px;height:18px;flex:none;border-radius:50%;border:2px solid #C9CEDD;}',
    '.vpa-opt.on .vpa-radio{border:5px solid #16A34A;}',
    '.vpa-opt-n{flex:1;min-width:0;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.vpa-opt-p{flex:none;font-size:12.5px;font-weight:600;color:var(--ink-soft);}',
    '.vpa-vacio{margin:18px 4px;text-align:center;font-size:13.5px;font-weight:600;color:var(--ink-soft);line-height:1.45;}',
    '.vpa-vacio.sm{margin:14px 4px;font-size:12.5px;}',
    '.vpa-mas-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:12px;border:1.5px dashed #D5DAE3;border-radius:14px;background:none;font:inherit;font-size:13.5px;font-weight:700;color:var(--ink-soft);cursor:pointer;}',
    '.vpa-mas-btn svg{width:16px;height:16px;}',
    '.vpa-guardar{position:absolute;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(to top, var(--bg,#F4F6FB) 70%, rgba(244,246,251,0));zoom:var(--z,1);}',
    '.vpa-guardar .btn{max-width:588px;margin:0 auto;min-height:50px;}',
    '@media (max-width:380px){.vpa-row-top{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);}.vpa-elegir{grid-column:1 / -1;width:100%;}}',
    '@media (min-width:900px){.vpa-in{padding-top:24px;}}'
  ].join('\n');
  document.head.appendChild(css);

  window.VPApps = {
    abrir: abrir, cerrar: cerrar, elegir: elegir, recargar: cargar, formulario: formulario, conectar: conectar,
    desconectar: desconectar, copiar: copiar, historial: historial, barraMasHTML: barraMasHTML,
    vincular: vincular, cerrarVinc: cerrarVinc, abrirFila: abrirFila, marcar: marcar, buscar: buscar,
    confirmar: confirmar, quitar: quitar, agregar: agregar, agregarGuardar: agregarGuardar, guardarVinc: guardarVinc,
    sincronizar: sincronizar, _ventaDe: ventaDe
  };
  arrancar();
})();
