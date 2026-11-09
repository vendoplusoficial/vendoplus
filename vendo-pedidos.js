/* =========================================================================
   VENDO PLUS · PEDIDOS Y ENTREGAS EN EL POS  (vendo-pedidos.js)
   -------------------------------------------------------------------------
   Lo que hace este archivo, del lado del COMERCIANTE:

     · Agrega un bloque de "Entrega" cuando se abre la ficha de un pedido:
       estado del seguimiento, repartidor, y los botones para avanzarlo.
     · El panel de Repartidores: código de vinculación, solicitudes
       pendientes, aceptar, rechazar y desvincular.
     · Mantiene el estado del pedido sincronizado con lo que ve el
       cliente en su pantalla de seguimiento.

   REGLA QUE SE RESPETA AL PIE DE LA LETRA:
     NO se rediseña la pantalla principal del Menú Digital ni las fichas
     de "Pedidos entrantes". Este archivo solo ENVUELVE funciones que ya
     existen (como hacía vendo-lealtad.js): guarda la original, la llama
     igual que siempre, y le agrega lo nuevo. Si este archivo no se
     carga, VendoPlus sigue funcionando exactamente como antes.

   Es el mismo archivo para la página web y para la app de Play Store.
========================================================================= */
(function () {
  'use strict';
  if (window.VPPedidos) return;

  /* =======================================================================
     0. ATAJOS
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
  function ico(n) { var f = fn('icon'); return f ? f(n) : ''; }
  function avisar(m, o) { var f = fn('toast'); if (f) f(m, o || {}); else console.log(m); }
  function nube() { var c = window.Cloud; return (c && c.ready && c.uid && c.sb) ? c : null; }
  function dueno() { var f = fn('isOwner'); return f ? !!f() : true; }
  function premium() { try { return !!(window.VPPremium && VPPremium.activo()); } catch (e) { return false; } }
  function vibra(ms) { var f = fn('vibrate'); if (f) f(ms); }
  function abrirHoja(html, op) { var f = fn('openModal'); if (f) f(html, op || { dismissible: true }); }
  function cerrarHoja() { var f = fn('closeModal'); if (f) f(); }

  function rpc(nombre, args) {
    var c = nube();
    if (!c) return Promise.reject(new Error('sin_nube'));
    return c.sb.rpc(nombre, args || {}).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  /* =======================================================================
     1. ESTADO EN MEMORIA
  ======================================================================= */
  var P = {
    porOrden: {},       /* id local del pedido -> fila de vp_pedidos */
    repartidores: [],
    codigo: null,
    cargando: false,
    ultimaCarga: 0,
    canal: null
  };

  var NOMBRE_PAGO = {
    efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta'
  };

  var NOMBRE_ESTADO = {
    enviado:    'Esperando que lo aceptes',
    preparando: 'En preparación',
    listo:      'Listo, esperando al repartidor',
    en_camino:  'El repartidor va en camino',
    entregado:  'Entregado',
    rechazado:  'Rechazado',
    cancelado:  'Cancelado'
  };

  /* =======================================================================
     2. TRAER EL SEGUIMIENTO DE LOS PEDIDOS
  ======================================================================= */
  var COLS = 'id,order_id,code,estado,tipo_entrega,repartidor_id,asignado_en,' +
             'aceptado_rep_en,eta_min,entregado_en,actualizado_en,destino_texto,' +
             'metodo_pago,pago_estado';

  function cargar(forzar) {
    var c = nube();
    if (!c) return Promise.resolve(false);
    if (P.cargando) return Promise.resolve(false);
    if (!forzar && Date.now() - P.ultimaCarga < 4000) return Promise.resolve(false);
    P.cargando = true;
    return c.sb.from('vp_pedidos').select(COLS)
      .gte('creado_en', new Date(Date.now() - 4 * 86400000).toISOString())
      .order('creado_en', { ascending: false }).limit(200)
      .then(function (r) {
        P.cargando = false;
        P.ultimaCarga = Date.now();
        if (r.error) return false;
        var m = {};
        (r.data || []).forEach(function (x) { m[x.order_id] = x; });
        P.porOrden = m;
        return true;
      })
      .catch(function () { P.cargando = false; return false; });
  }

  function dePedido(o) { return o ? P.porOrden[o.id] : null; }

  /* Mantiene el POS al día cuando el repartidor avanza el pedido. */
  function escuchar() {
    var c = nube();
    if (!c || P.canal) return;
    try {
      P.canal = c.sb.channel('vp-entregas-' + c.uid)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'vp_pedidos', filter: 'user_id=eq.' + c.uid },
            function (pl) {
              var row = pl && (pl.new || pl.old);
              if (!row || !row.order_id) return;
              if (pl.eventType === 'DELETE') delete P.porOrden[row.order_id];
              else P.porOrden[row.order_id] = row;
              repintarBloque();
            })
        .subscribe();
    } catch (e) { P.canal = null; }
  }

  /* =======================================================================
     3. EL BLOQUE DE ENTREGA DENTRO DE LA FICHA DEL PEDIDO
     Se inserta justo antes del pie de la ficha, sin tocar nada de lo que
     ya estaba.
  ======================================================================= */
  function bloqueHTML(o) {
    if (!o) return '';
    /* Los pedidos pegados de WhatsApp o hechos en caja no tienen
       seguimiento: no vienen del Menú Digital. */
    if (o.source && o.source !== 'menu') return '';

    var s = dePedido(o);
    var esDom = !!(fn('mdiIsDelivery') && ref('mdiIsDelivery')(o));

    var h = '<div class="vp-ent" id="vpEntBloque">';
    h += '<div class="vp-ent-cab">' + ico('truck') + '<b>Entrega</b>';
    if (s) h += '<span class="vp-ent-pill st-' + esc(s.estado) + '">' +
                esc(NOMBRE_ESTADO[s.estado] || s.estado) + '</span>';
    h += '</div>';

    if (!s) {
      h += '<p class="vp-ent-sub">Este pedido todavía no tiene seguimiento en línea. ' +
           'Se crea solo cuando el cliente lo manda desde el Menú Digital.</p>';
      if (nube()) {
        h += '<div class="vp-ent-btns"><button type="button" class="btn ghost" ' +
             'onclick="VPPedidos.sincronizar()">' + ico('refresh') + ' Buscar seguimiento</button></div>';
      }
      return h + '</div>';
    }

    /* ---- Estado del pago ---- */
    if (s.metodo_pago) {
      var pagado = s.pago_estado === 'pagado';
      h += '<div class="vp-ent-fila"><span>Pago</span><b>' +
           esc(NOMBRE_PAGO[s.metodo_pago] || s.metodo_pago) + ' · ' +
           (pagado ? 'recibido' : s.pago_estado === 'rechazado' ? 'rechazado' : 'pendiente') +
           '</b></div>';
      /* La tarjeta la confirma Mercado Pago, no una persona. */
      if (!pagado && s.metodo_pago !== 'tarjeta') {
        h += '<div class="vp-ent-btns"><button type="button" class="btn ghost" ' +
             'onclick="VPPedidos.confirmarPago(\'' + esc(o.id) + '\')">' +
             ico('check') + ' Ya recibí el pago</button></div>';
      }
    }

    if (!esDom || s.tipo_entrega === 'recoger') {
      /* Para recoger: sin repartidor y sin GPS, tal como pediste. */
      h += '<p class="vp-ent-sub">El cliente pasa por su pedido al establecimiento. ' +
           'Este pedido no lleva repartidor ni mapa.</p>';
      h += '<div class="vp-ent-btns">';
      if (s.estado === 'preparando') {
        h += btn(o.id, 'listo', 'Marcar como listo', 'check', true);
      } else if (s.estado === 'listo') {
        h += btn(o.id, 'entregado', 'Marcar como entregado', 'check', true);
      }
      h += '</div>';
      return h + '</div>';
    }

    /* ---- Pedido a domicilio ---- */
    var rep = s.repartidor_id
      ? P.repartidores.filter(function (r) { return r.repartidor_id === s.repartidor_id; })[0]
      : null;

    h += '<div class="vp-ent-fila"><span>Repartidor</span><b>' +
         (rep ? esc(rep.nombre || 'Sin nombre') : (s.repartidor_id ? 'Asignado' : 'Sin asignar')) +
         (rep && s.aceptado_rep_en ? ' · aceptó' : '') + '</b></div>';
    if (s.estado === 'en_camino' && s.eta_min) {
      h += '<div class="vp-ent-fila"><span>Llegada estimada</span><b>' + esc(String(s.eta_min)) + ' min</b></div>';
    }

    h += '<div class="vp-ent-btns">';
    if (s.estado === 'preparando') h += btn(o.id, 'listo', 'Marcar como listo', 'check', true);
    if (s.estado === 'listo' || s.estado === 'preparando') {
      h += '<button type="button" class="btn ghost" onclick="VPPedidos.elegirRepartidor(\'' + esc(o.id) + '\')">' +
           ico('users') + ' ' + (s.repartidor_id ? 'Cambiar repartidor' : 'Asignar repartidor') + '</button>';
    }
    if (s.estado === 'en_camino' || s.estado === 'listo') {
      h += '<button type="button" class="btn ghost" onclick="VPPedidos.excepcional(\'' + esc(o.id) + '\')">' +
           ico('alert') + ' Entrega sin código</button>';
    }
    h += '</div>';

    if (s.estado === 'en_camino') {
      h += '<p class="vp-ent-sub">El cliente ya ve el mapa, el tiempo estimado y puede mandarle ' +
           'mensajes al repartidor. La entrega se cierra cuando el repartidor captura el código de ' +
           '4 dígitos que le dé el cliente.</p>';
    }
    return h + '</div>';
  }

  function btn(ordenId, estado, texto, icono, primario) {
    return '<button type="button" class="btn ' + (primario ? 'primary' : 'ghost') + '" ' +
           'onclick="VPPedidos.estado(\'' + esc(ordenId) + '\',\'' + estado + '\')">' +
           ico(icono) + ' ' + esc(texto) + '</button>';
  }

  /* Vuelve a pintar SOLO el bloque de entrega, sin recargar toda la
     ficha: así no se pierde el scroll ni lo que el comerciante esté
     escribiendo en algún campo. */
  function repintarBloque() {
    var caja = document.querySelector('.vp-ent[data-orden]');
    if (!caja) return;
    var id = caja.getAttribute('data-orden');
    var o = null;
    try { o = window.MDI ? MDI.get(id) : null; } catch (e) { o = null; }
    if (!o) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = bloqueHTML(o);
    var nuevo = tmp.firstElementChild;
    if (nuevo) {
      nuevo.setAttribute('data-orden', id);
      caja.parentNode.replaceChild(nuevo, caja);
    }
  }

  /* =======================================================================
     4. ACCIONES
  ======================================================================= */
  function cambiarEstado(ordenId, estado) {
    var o = null;
    try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) { avisar('Este pedido no tiene seguimiento en línea'); return; }
    vibra(10);
    rpc('vp_pedido_estado', { p_pedido_id: s.id, p_estado: estado }).then(function (r) {
      if (r && r.ok) {
        s.estado = r.estado || estado;
        avisar(estado === 'listo' ? 'Pedido marcado como listo' : 'Pedido actualizado',
               { icon: ico('check') });
        repintarBloque();
      } else {
        avisar(mensajeError(r), { icon: ico('alert') });
      }
    }).catch(function () { avisar('No se pudo actualizar. Revisa tu internet'); });
  }

  function mensajeError(r) {
    var e = r && r.error;
    var m = {
      transicion_invalida: 'Ese cambio no se puede hacer ahora',
      requiere_codigo: 'Un pedido a domicilio lo cierra el repartidor con el código',
      repartidor_no_vinculado: 'Ese repartidor no está vinculado a tu negocio',
      pedido_para_recoger: 'Este pedido es para recoger: no lleva repartidor',
      pedido_cerrado: 'Este pedido ya está cerrado',
      motivo_requerido: 'Escribe el motivo (al menos 5 letras)',
      no_encontrado: 'No encontramos ese pedido',
      sin_sesion: 'Inicia sesión para hacer esto'
    };
    return m[e] || 'No se pudo completar la acción';
  }

  /* ---- Elegir repartidor ---- */
  function elegirRepartidor(ordenId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    cargarRepartidores(true).then(function () {
      var libres = P.repartidores.filter(function (r) { return r.estado === 'aceptado'; });
      var h = '<div class="sheet-header"><h2>Asignar repartidor</h2>' +
              '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>';
      if (!libres.length) {
        h += '<p class="todo-empty">Todavía no tienes repartidores vinculados.<br>' +
             'Genera un código en <b>Repartidores</b> y compártelo con ellos.</p>' +
             '<div class="sheet-actions"><button class="btn primary block" ' +
             'onclick="VPPedidos.panel()">Abrir Repartidores</button></div>';
      } else {
        h += '<div class="vp-rep-lista">';
        libres.forEach(function (r) {
          var yo = r.repartidor_id === s.repartidor_id;
          h += '<button type="button" class="vp-rep-item' + (yo ? ' sel' : '') + '" ' +
               'onclick="VPPedidos.asignar(\'' + esc(ordenId) + '\',\'' + esc(r.repartidor_id) + '\')">' +
               '<div class="vp-rep-ini">' + esc((r.nombre || '?').charAt(0).toUpperCase()) + '</div>' +
               '<div class="vp-rep-main"><b>' + esc(r.nombre || 'Sin nombre') + '</b>' +
               '<span>' + (r.ocupado ? 'Con una entrega en curso' : 'Disponible') + '</span></div>' +
               (yo ? '<span class="vp-rep-ok">' + ico('check') + '</span>' : '') +
               '</button>';
        });
        h += '</div>';
        if (s.repartidor_id) {
          h += '<div class="sheet-actions"><button class="btn danger block" ' +
               'onclick="VPPedidos.asignar(\'' + esc(ordenId) + '\', null)">Quitar asignación</button></div>';
        }
      }
      abrirHoja(h);
    });
  }

  function asignar(ordenId, repId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    rpc('vp_pedido_asignar', { p_pedido_id: s.id, p_repartidor_id: repId || null }).then(function (r) {
      if (r && r.ok) {
        s.repartidor_id = repId || null;
        s.aceptado_rep_en = null;
        cerrarHoja();
        avisar(repId ? 'Repartidor asignado' : 'Asignación quitada', { icon: ico('check') });
        var f = fn('mdiOpen'); if (f && o) f(o.id, true);
      } else {
        avisar(mensajeError(r), { icon: ico('alert') });
      }
    }).catch(function () { avisar('No se pudo asignar'); });
  }

  /* ---- Entrega excepcional ---- */
  function excepcional(ordenId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    if (!dueno()) { avisar('Solo el Dueño puede autorizar una entrega sin código'); return; }

    abrirHoja(
      '<div class="sheet-header"><h2>Entrega sin código</h2>' +
      '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
      '<p class="vp-ent-sub" style="padding:0 2px 10px">Úsalo solo cuando el cliente no pueda darte su ' +
      'código: perdió el teléfono, no lo encuentra o hubo una incidencia real.<br><br>' +
      'Queda registrado quién lo autorizó, con fecha, hora y motivo.</p>' +
      '<label class="field"><span>Motivo</span>' +
      '<input id="vpExcMotivo" type="text" maxlength="160" autocomplete="off" ' +
      'placeholder="Ej. El cliente perdió su celular y confirmó por teléfono"></label>' +
      '<div class="sheet-actions">' +
      '<button class="btn ghost" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn danger" onclick="VPPedidos.excepcionalOk(\'' + esc(ordenId) + '\')">' +
      'Confirmar entrega</button></div>'
    );
    setTimeout(function () {
      var e = document.getElementById('vpExcMotivo'); if (e) e.focus();
    }, 90);
  }

  function excepcionalOk(ordenId) {
    var e = document.getElementById('vpExcMotivo');
    var motivo = e ? (e.value || '').trim() : '';
    if (motivo.length < 5) { avisar('Escribe el motivo'); if (e) e.focus(); return; }
    var o = null; try { o = MDI.get(ordenId); } catch (ex) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    rpc('vp_entrega_excepcional', { p_pedido_id: s.id, p_motivo: motivo }).then(function (r) {
      if (r && r.ok) {
        s.estado = 'entregado';
        cerrarHoja();
        avisar('Entrega registrada', { icon: ico('check'), subtitle: 'Quedó en el historial' });
        var f = fn('mdiOpen'); if (f && o) f(o.id, true);
      } else {
        avisar(mensajeError(r), { icon: ico('alert') });
      }
    }).catch(function () { avisar('No se pudo registrar'); });
  }

  /* =======================================================================
     5. PANEL DE REPARTIDORES
  ======================================================================= */
  function cargarRepartidores(forzar) {
    if (!nube()) return Promise.resolve(false);
    if (!forzar && P.repartidores.length) return Promise.resolve(true);
    return rpc('vp_repartidores_lista').then(function (r) {
      if (r && r.ok) P.repartidores = r.repartidores || [];
      return true;
    }).catch(function () { return false; });
  }

  function panel() {
    if (!premium()) {
      if (window.VPPremium) VPPremium.abrir('entregas');
      return;
    }
    if (!nube()) { avisar('Necesitas estar conectado para administrar repartidores'); return; }
    cerrarHoja();
    setTimeout(function () {
      abrirHoja(panelHTML(), { dismissible: true });
      cargarRepartidores(true).then(repintarPanel);
    }, 60);
  }

  function panelHTML() {
    var h = '<div class="sheet-header"><h2>Pedidos y entregas</h2>' +
            '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>';
    h += '<div class="vp-ent-btns" style="margin:0 0 14px">' +
         '<button type="button" class="btn ghost" onclick="VPPedidos.cobros()">' +
         ico('card') + ' Cómo cobro</button></div>';
    h += '<div id="vpRepPanel"><p class="todo-empty">Cargando…</p></div>';
    return h;
  }

  function repintarPanel() {
    var caja = document.getElementById('vpRepPanel');
    if (!caja) return;
    var pend = P.repartidores.filter(function (r) { return r.estado === 'pendiente'; });
    var act = P.repartidores.filter(function (r) { return r.estado === 'aceptado'; });

    var h = '';
    /* ---- Código de vinculación ---- */
    h += '<div class="vp-cod-box">';
    if (P.codigo) {
      h += '<div class="vp-cod-n">' + esc(P.codigo) + '</div>' +
           '<p class="vp-ent-sub">Dale este código a tu repartidor. Lo escribe en la app ' +
           '<b>VendoPlus Repartidor</b>, en "Vincular negocio", y tú recibes su solicitud aquí.<br>' +
           'Vence en 7 días.</p>' +
           '<div class="vp-ent-btns">' +
           '<button type="button" class="btn ghost" onclick="VPPedidos.copiarCodigo()">' + ico('copy') + ' Copiar</button>' +
           '<button type="button" class="btn ghost" onclick="VPPedidos.nuevoCodigo()">' + ico('refresh') + ' Generar otro</button>' +
           '<button type="button" class="btn danger" onclick="VPPedidos.revocarCodigo()">Desactivar</button>' +
           '</div>';
    } else {
      h += '<p class="vp-ent-sub">Para que un repartidor pueda recibir tus pedidos, genera un ' +
           'código y compártelo con él.</p>' +
           '<div class="vp-ent-btns"><button type="button" class="btn primary block" ' +
           'onclick="VPPedidos.nuevoCodigo()">' + ico('plus') + ' Generar código</button></div>';
    }
    h += '</div>';

    /* ---- Solicitudes pendientes ---- */
    if (pend.length) {
      h += '<div class="section-title">Solicitudes</div><div class="vp-rep-lista">';
      pend.forEach(function (r) {
        h += '<div class="vp-rep-item plain">' +
             '<div class="vp-rep-ini">' + esc((r.nombre || '?').charAt(0).toUpperCase()) + '</div>' +
             '<div class="vp-rep-main"><b>' + esc(r.nombre || 'Sin nombre') + '</b>' +
             '<span>' + esc(r.telefono || 'Quiere vincularse a tu negocio') + '</span></div>' +
             '<div class="vp-rep-acc">' +
             '<button type="button" class="btn danger mini" onclick="VPPedidos.resolver(\'' + esc(r.vinculo_id) + '\',false)">Rechazar</button>' +
             '<button type="button" class="btn primary mini" onclick="VPPedidos.resolver(\'' + esc(r.vinculo_id) + '\',true)">Aceptar</button>' +
             '</div></div>';
      });
      h += '</div>';
    }

    /* ---- Vinculados ---- */
    h += '<div class="section-title">Mis repartidores</div>';
    if (!act.length) {
      h += '<p class="todo-empty">Todavía no tienes repartidores vinculados.</p>';
    } else {
      h += '<div class="vp-rep-lista">';
      act.forEach(function (r) {
        h += '<div class="vp-rep-item plain">' +
             '<div class="vp-rep-ini">' + esc((r.nombre || '?').charAt(0).toUpperCase()) + '</div>' +
             '<div class="vp-rep-main"><b>' + esc(r.nombre || 'Sin nombre') + '</b>' +
             '<span>' + (r.ocupado ? 'Con una entrega en curso' : 'Disponible') + '</span></div>' +
             '<div class="vp-rep-acc">' +
             '<button type="button" class="btn ghost mini" onclick="VPPedidos.desvincular(\'' + esc(r.repartidor_id) + '\')">Quitar</button>' +
             '</div></div>';
      });
      h += '</div>';
    }
    caja.innerHTML = h;
  }

  function nuevoCodigo() {
    rpc('vp_codigo_generar', { p_max_usos: 5 }).then(function (r) {
      if (r && r.ok) { P.codigo = r.codigo; repintarPanel(); vibra(12); }
      else avisar(mensajeError(r));
    }).catch(function () { avisar('No se pudo generar el código'); });
  }
  function revocarCodigo() {
    rpc('vp_codigo_revocar').then(function () { P.codigo = null; repintarPanel(); });
  }
  function copiarCodigo() {
    if (!P.codigo) return;
    if (navigator.clipboard) navigator.clipboard.writeText(P.codigo).then(function () { avisar('Código copiado'); });
    else avisar('Tu código es ' + P.codigo);
  }
  function resolver(vinculoId, aceptar) {
    rpc('vp_vinculo_resolver', { p_vinculo_id: vinculoId, p_aceptar: !!aceptar }).then(function (r) {
      if (r && r.ok) {
        avisar(aceptar ? 'Repartidor aceptado' : 'Solicitud rechazada', { icon: ico('check') });
        cargarRepartidores(true).then(repintarPanel);
      } else avisar(mensajeError(r));
    }).catch(function () { avisar('No se pudo responder la solicitud'); });
  }
  function desvincular(repId) {
    var ask = fn('askConfirm');
    var hazlo = function () {
      rpc('vp_vinculo_revocar', { p_repartidor_id: repId }).then(function () {
        avisar('Repartidor desvinculado');
        cargarRepartidores(true).then(repintarPanel);
      });
    };
    if (ask) ask({ title: '¿Quitar a este repartidor?',
                   text: 'Dejará de recibir tus pedidos. Los que todavía no recoge se le quitan.',
                   ok: 'Quitar', icon: ico('alert') }, hazlo);
    else if (confirm('¿Quitar a este repartidor?')) hazlo();
  }

  function sincronizar() {
    rpc('vp_pedidos_sincronizar').then(function (r) {
      return cargar(true).then(function () {
        avisar((r && r.creados) ? 'Se encontraron ' + r.creados + ' pedido(s)' : 'Todo está al día');
        repintarBloque();
      });
    }).catch(function () { avisar('No se pudo revisar'); });
  }


  /* =======================================================================
     5b. CÓMO COBRA EL NEGOCIO
     Los tres métodos del Menú Digital: efectivo, transferencia y tarjeta.
     La tarjeta solo se puede encender si Mercado Pago está conectado:
     el propio servidor lo impide si no lo está.
  ======================================================================= */
  var COB = null;

  function cobros() {
    if (!premium()) { if (window.VPPremium) VPPremium.abrir('menu'); return; }
    if (!nube()) { avisar('Necesitas estar conectado'); return; }
    cerrarHoja();
    setTimeout(function () {
      abrirHoja('<div class="sheet-header"><h2>Cómo cobro</h2>' +
        '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
        '<div id="vpCobPanel"><p class="todo-empty">Cargando…</p></div>', { dismissible: true });
      cargarCobros().then(pintarCobros);
    }, 60);
  }

  function cargarCobros() {
    var c = nube();
    if (!c) return Promise.resolve(false);
    return c.sb.from('vp_cobros').select('*').maybeSingle().then(function (r) {
      COB = (r && r.data) ? r.data : {
        efectivo: true, transferencia: false, tarjeta: false,
        transf_banco: '', transf_titular: '', transf_clabe: '', transf_nota: '',
        mp_conectado: false, mp_apodo: ''
      };
      return true;
    }).catch(function () { return false; });
  }

  function pintarCobros() {
    var caja = document.getElementById('vpCobPanel');
    if (!caja || !COB) return;
    var h = '';

    h += '<p class="vp-ent-sub" style="margin:0 0 14px">Elige cómo pueden pagarte los clientes ' +
         'que piden desde tu Menú Digital.</p>';

    /* --- Efectivo --- */
    h += bloqueCobro('efectivo', 'Efectivo', COB.efectivo,
      'El cliente paga al recibir su pedido. Tú registras el cobro desde la ficha del pedido.');

    /* --- Transferencia --- */
    h += bloqueCobro('transferencia', 'Transferencia bancaria', COB.transferencia,
      'El cliente ve tus datos y te transfiere. El pedido se marca como pagado solo cuando ' +
      'tú confirmas que recibiste el dinero.');
    if (COB.transferencia) {
      h += '<div class="vp-cob-campos">' +
        campo('vpCobBanco', 'Banco', COB.transf_banco, 'Ej. BBVA') +
        campo('vpCobTitular', 'A nombre de', COB.transf_titular, 'Nombre del titular') +
        campo('vpCobClabe', 'CLABE o número de cuenta', COB.transf_clabe, '18 dígitos') +
        campo('vpCobNota', 'Nota para el cliente', COB.transf_nota, 'Opcional') +
        '</div>';
    }

    /* --- Tarjeta --- */
    h += '<div class="vp-cob-item">';
    h += '<div class="vp-cob-cab"><b>Tarjeta de crédito o débito</b></div>';
    if (COB.mp_conectado) {
      h += '<p class="vp-ent-sub">Conectado a Mercado Pago' +
           (COB.mp_apodo ? ' como <b>' + esc(COB.mp_apodo) + '</b>' : '') + '.<br>' +
           'El dinero entra <b>directo a tu cuenta</b>. VendoPlus no se queda con nada; ' +
           'solo aplica la comisión de Mercado Pago.</p>';
      h += '<label class="vp-cob-check"><input type="checkbox" id="vpCobTarjeta"' +
           (COB.tarjeta ? ' checked' : '') + ' onchange="VPPedidos.cobroCambio()"> ' +
           'Aceptar pagos con tarjeta</label>';
      h += '<div class="vp-ent-btns"><button type="button" class="btn danger" ' +
           'onclick="VPPedidos.mpDesconectar()">Desconectar Mercado Pago</button></div>';
    } else {
      h += '<p class="vp-ent-sub">Conecta tu cuenta de Mercado Pago para aceptar tarjetas. ' +
           'El cobro llega <b>directo a tu cuenta</b>, no a VendoPlus.</p>';
      h += '<div class="vp-ent-btns"><button type="button" class="btn primary block" ' +
           'onclick="VPPedidos.mpConectar()">Conectar Mercado Pago</button></div>';
    }
    h += '</div>';

    h += '<div class="sheet-actions"><button class="btn primary block" ' +
         'onclick="VPPedidos.guardarCobros()">Guardar</button></div>';

    caja.innerHTML = h;
  }

  function bloqueCobro(id, titulo, activo, texto) {
    return '<div class="vp-cob-item">' +
      '<label class="vp-cob-check"><input type="checkbox" id="vpCob_' + id + '"' +
      (activo ? ' checked' : '') + ' onchange="VPPedidos.cobroCambio()"> <b>' + esc(titulo) + '</b></label>' +
      '<p class="vp-ent-sub">' + texto + '</p></div>';
  }

  function campo(id, etiqueta, valor, pista) {
    return '<label class="field"><span>' + esc(etiqueta) + '</span>' +
      '<input id="' + id + '" type="text" value="' + esc(valor || '') +
      '" placeholder="' + esc(pista) + '" autocomplete="off"></label>';
  }

  function leeCheck(id) { var e = document.getElementById(id); return !!(e && e.checked); }
  function leeTxt(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

  /** Al marcar/desmarcar se repinta para mostrar u ocultar los campos. */
  function cobroCambio() {
    if (!COB) return;
    COB.efectivo = leeCheck('vpCob_efectivo');
    COB.transferencia = leeCheck('vpCob_transferencia');
    COB.tarjeta = leeCheck('vpCobTarjeta');
    if (document.getElementById('vpCobBanco')) {
      COB.transf_banco = leeTxt('vpCobBanco');
      COB.transf_titular = leeTxt('vpCobTitular');
      COB.transf_clabe = leeTxt('vpCobClabe');
      COB.transf_nota = leeTxt('vpCobNota');
    }
    pintarCobros();
  }

  function guardarCobros() {
    if (!COB) return;
    cobroCambio();
    if (!COB.efectivo && !COB.transferencia && !COB.tarjeta) {
      avisar('Deja al menos una forma de pago activa'); return;
    }
    if (COB.transferencia && (!COB.transf_clabe || !COB.transf_titular)) {
      avisar('Para transferencia hace falta el titular y la CLABE'); return;
    }
    rpc('vp_cobros_guardar', { p_datos: {
      efectivo: COB.efectivo, transferencia: COB.transferencia, tarjeta: COB.tarjeta,
      banco: COB.transf_banco, titular: COB.transf_titular,
      clabe: COB.transf_clabe, nota: COB.transf_nota
    } }).then(function (r) {
      if (r && r.ok) { cerrarHoja(); avisar('Formas de pago guardadas', { icon: ico('check') }); }
      else avisar(mensajeError(r));
    }).catch(function () { avisar('No se pudo guardar'); });
  }

  /** Manda al negocio a autorizar su cuenta en Mercado Pago. */
  function mpConectar() {
    var c = nube();
    if (!c) return;
    avisar('Abriendo Mercado Pago…');
    c.sb.functions.invoke('vp-mp-oauth', { body: { accion: 'url' } }).then(function (r) {
      var d = r && r.data;
      if (d && d.ok && d.url) { location.href = d.url; return; }
      avisar(d && d.error === 'sin_configurar'
        ? 'Falta configurar Mercado Pago en el servidor (ver la guía de pagos)'
        : 'No se pudo abrir Mercado Pago');
    }).catch(function () { avisar('No se pudo abrir Mercado Pago'); });
  }

  function mpDesconectar() {
    var ask = fn('askConfirm');
    var hazlo = function () {
      rpc('vp_mp_desconectar').then(function () {
        avisar('Mercado Pago desconectado');
        cargarCobros().then(pintarCobros);
      });
    };
    if (ask) ask({ title: '¿Desconectar Mercado Pago?',
                   text: 'Dejarás de aceptar tarjetas en tu Menú Digital. Puedes volver a conectarlo cuando quieras.',
                   ok: 'Desconectar', icon: ico('alert') }, hazlo);
    else if (confirm('¿Desconectar Mercado Pago?')) hazlo();
  }

  /** Registrar que llegó el dinero (efectivo o transferencia). */
  function confirmarPago(ordenId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    rpc('vp_pago_confirmar', { p_pedido_id: s.id, p_nota: '' }).then(function (r) {
      if (r && r.ok) {
        avisar('Pago registrado', { icon: ico('check') });
        cargar(true).then(repintarBloque);
      } else avisar(mensajeError(r));
    }).catch(function () { avisar('No se pudo registrar'); });
  }

  /* =======================================================================
     6. ESTILOS (solo para lo nuevo; no se toca nada de lo existente)
  ======================================================================= */
  function estilos() {
    if (document.getElementById('vp-ped-css')) return;
    var st = document.createElement('style');
    st.id = 'vp-ped-css';
    st.textContent = [
      '.vp-ent{margin:12px 0 0;padding:13px 14px;border:1px solid var(--border,#E8E9EF);',
      'border-radius:13px;background:var(--surface,#fff);}',
      '.vp-ent-cab{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
      '.vp-ent-cab b{font-size:14.5px;font-weight:800;color:var(--ink,#16213E);}',
      '.vp-ent-cab svg{width:18px;height:18px;}',
      '.vp-ent-pill{margin-left:auto;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:800;',
      'background:#F0F1F5;color:#5A6376;white-space:nowrap;}',
      '.vp-ent-pill.st-preparando{background:#FFF6E6;color:#8A6412;}',
      '.vp-ent-pill.st-listo{background:#EAF4FF;color:#1D5FA8;}',
      '.vp-ent-pill.st-en_camino{background:#EAF9F0;color:#0B7A38;}',
      '.vp-ent-pill.st-entregado{background:#EAF9F0;color:#0B7A38;}',
      '.vp-ent-pill.st-rechazado,.vp-ent-pill.st-cancelado{background:#FDECEC;color:#A03030;}',
      '.vp-ent-sub{margin:6px 0 0;font-size:12.5px;font-weight:600;color:var(--ink-soft,#6B7487);line-height:1.45;}',
      '.vp-ent-fila{display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:13px;',
      'border-bottom:1px solid var(--border,#F0F1F5);}',
      '.vp-ent-fila:last-of-type{border-bottom:0;}',
      '.vp-ent-fila span{font-weight:600;color:var(--ink-soft,#6B7487);}',
      '.vp-ent-fila b{font-weight:800;color:var(--ink,#16213E);text-align:right;}',
      '.vp-ent-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
      '.vp-ent-btns .btn{flex:1 1 150px;}',

      '.vp-cod-box{padding:14px;border:1px dashed #9ADFBB;border-radius:13px;background:#EAF9F0;margin-bottom:14px;}',
      '.vp-cod-n{font-size:30px;font-weight:800;letter-spacing:6px;color:#0B7A38;text-align:center;',
      'font-variant-numeric:tabular-nums;padding-left:6px;}',

      '.vp-rep-lista{display:flex;flex-direction:column;gap:8px;}',
      '.vp-rep-item{display:flex;align-items:center;gap:11px;width:100%;padding:11px 12px;text-align:left;',
      'border:1px solid var(--border,#E8E9EF);border-radius:12px;background:var(--surface,#fff);',
      'font-family:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
      '.vp-rep-item.plain{cursor:default;}',
      '.vp-rep-item.sel{border-color:#16C15B;background:#EAF9F0;}',
      '.vp-rep-item:active:not(.plain){transform:scale(.99);}',
      '.vp-rep-ini{flex:none;width:36px;height:36px;border-radius:50%;background:#16C15B;color:#fff;',
      'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;}',
      '.vp-rep-main{flex:1;min-width:0;}',
      '.vp-rep-main b{display:block;font-size:14px;font-weight:800;color:var(--ink,#16213E);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.vp-rep-main span{display:block;font-size:12px;font-weight:600;color:var(--ink-soft,#6B7487);margin-top:1px;}',
      '.vp-rep-acc{flex:none;display:flex;gap:6px;}',
      '.vp-rep-ok{flex:none;color:#16C15B;}',
      '.vp-cob-item{padding:13px 14px;border:1px solid var(--border,#E8E9EF);border-radius:12px;margin-bottom:11px;}',
      '.vp-cob-cab b{font-size:14.5px;font-weight:800;color:var(--ink,#16213E);}',
      '.vp-cob-check{display:flex;align-items:center;gap:9px;font-size:14.5px;font-weight:700;',
      'color:var(--ink,#16213E);cursor:pointer;}',
      '.vp-cob-check input{width:20px;height:20px;accent-color:#16C15B;}',
      '.vp-cob-campos{margin:-4px 0 11px;padding:0 2px;}',
      '.btn.mini{padding:7px 11px;font-size:12.5px;}'
    ].join('');
    document.head.appendChild(st);
  }

  /* =======================================================================
     7. ENGANCHES
     Aquí es donde este archivo se mete en VendoPlus. Siempre igual:
     se guarda la función original y se llama. Nada se reemplaza.
  ======================================================================= */
  var enganchado = false;
  function engancha() {
    if (enganchado) return true;
    if (typeof window.mdiDetailHTML !== 'function' || typeof window.mdiOpen !== 'function') return false;
    enganchado = true;

    /* ---- La ficha del pedido: se le agrega el bloque de entrega ---- */
    var _detalle = window.mdiDetailHTML;
    window.mdiDetailHTML = function (o) {
      var html = _detalle.apply(this, arguments);
      try {
        if (!premium()) return html;
        var extra = bloqueHTML(o);
        if (!extra) return html;
        extra = extra.replace('<div class="vp-ent"', '<div class="vp-ent" data-orden="' + esc(o.id) + '"');
        /* Se mete justo antes del pie de la ficha, sin tocar el resto. */
        var marca = '<div class="mdi-dfoot">';
        var i = html.lastIndexOf(marca);
        if (i >= 0) return html.slice(0, i) + extra + html.slice(i);
        return html + extra;
      } catch (e) { return html; }
    };

    /* ---- Al abrir una ficha: refresca el seguimiento ---- */
    var _open = window.mdiOpen;
    window.mdiOpen = function (id) {
      var r = _open.apply(this, arguments);
      try {
        if (premium() && nube()) {
          cargar().then(function (hubo) { if (hubo) repintarBloque(); });
          cargarRepartidores();
        }
      } catch (e) {}
      return r;
    };

    /* ---- Aceptar el pedido → el cliente ve "preparando" ---- */
    if (typeof window.mdiConfirm === 'function') {
      var _conf = window.mdiConfirm;
      window.mdiConfirm = function (id) {
        var r = _conf.apply(this, arguments);
        avisaEstado(id, 'preparando');
        return r;
      };
    }
    /* ---- Rechazar ---- */
    if (typeof window.mdiReject === 'function') {
      var _rej = window.mdiReject;
      window.mdiReject = function (id) {
        var r = _rej.apply(this, arguments);
        avisaEstado(id, 'rechazado');
        return r;
      };
    }
    /* ---- Cancelar ---- */
    if (typeof window.mdiCancelOrderNow === 'function') {
      var _can = window.mdiCancelOrderNow;
      window.mdiCancelOrderNow = function (id) {
        var r = _can.apply(this, arguments);
        avisaEstado(id, 'cancelado');
        return r;
      };
    }

    escuchar();
    return true;
  }

  /* Empuja el estado al servidor para que el cliente lo vea. Si falla
     (sin internet), no pasa nada en la caja: el POS siguió funcionando.
     El estado se vuelve a empujar la próxima vez que se abra la ficha. */
  function avisaEstado(ordenId, estado) {
    try {
      if (!premium() || !nube()) return;
      setTimeout(function () {
        cargar(true).then(function () {
          var o = null; try { o = MDI.get(ordenId); } catch (e) {}
          var s = o ? dePedido(o) : null;
          if (!s || s.estado === estado) return;
          rpc('vp_pedido_estado', { p_pedido_id: s.id, p_estado: estado })
            .then(function (r) { if (r && r.ok) s.estado = r.estado || estado; })
            .catch(function () {});
          /* De paso se le manda el nombre del negocio, para que el
             cliente lo vea en su pantalla de seguimiento. */
          var nom = '';
          try { nom = (ref('dm') && dm.cfg && dm.cfg.name) || (ref('settings') && settings.businessName) || ''; } catch (e) {}
          if (nom) rpc('vp_pedido_negocio', { p_pedido_id: s.id, p_nombre: nom }).catch(function () {});
        });
      }, 500);
    } catch (e) {}
  }

  function arrancar() {
    estilos();
    if (engancha()) return;
    var n = 0;
    var t = setInterval(function () { if (engancha() || ++n > 240) clearInterval(t); }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else setTimeout(arrancar, 0);

  /* =======================================================================
     8. API PÚBLICA
  ======================================================================= */
  window.VPPedidos = {
    panel: panel,
    cobros: cobros,
    cobroCambio: cobroCambio,
    guardarCobros: guardarCobros,
    mpConectar: mpConectar,
    mpDesconectar: mpDesconectar,
    confirmarPago: confirmarPago,
    estado: cambiarEstado,
    elegirRepartidor: elegirRepartidor,
    asignar: asignar,
    excepcional: excepcional,
    excepcionalOk: excepcionalOk,
    nuevoCodigo: nuevoCodigo,
    revocarCodigo: revocarCodigo,
    copiarCodigo: copiarCodigo,
    resolver: resolver,
    desvincular: desvincular,
    sincronizar: sincronizar,
    recargar: function () { return cargar(true); },
    _estado: P
  };
})();
