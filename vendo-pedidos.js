/* =========================================================================
   VENDO PLUS · PEDIDOS Y ENTREGAS EN EL POS  (vendo-pedidos.js)
   -------------------------------------------------------------------------
   Lo que hace este archivo, del lado del COMERCIANTE:

     · Agrega un bloque de "Entrega" cuando se abre la ficha de un pedido,
       organizado en TRES PROCESOS visibles:
         1. Confirmar y preparar
         2. Pedido preparado y repartidor
         3. En camino, entrega y cobro
     · El panel de Repartidores: código de vinculación, solicitudes
       pendientes, aceptar, rechazar y desvincular — todo al vuelo, sin
       recargar, escuchando vp_vinculos en tiempo real.
     · Mantiene el estado del pedido sincronizado con lo que ve el
       cliente en su pantalla de seguimiento.

   REGLA QUE SE RESPETA AL PIE DE LA LETRA:
     NO se rediseña la pantalla principal del Menú Digital ni las fichas
     de "Pedidos entrantes". Este archivo solo ENVUELVE funciones que ya
     existen: guarda la original, la llama igual que siempre, y le agrega
     lo nuevo. Si este archivo no se carga, VendoPlus sigue funcionando
     exactamente como antes.

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
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ico(n) { var f = fn('icon'); return f ? f(n) : ''; }
  function avisar(m, o) { var f = fn('toast'); if (f) f(m, o || {}); else console.log(m); }
  function nube() { var c = window.Cloud; return (c && c.ready && c.uid && c.sb) ? c : null; }
  function dueno() { var f = fn('isOwner'); return f ? !!f() : true; }
  function premium() { try { return !!(window.VPPremium && VPPremium.activo()); } catch (e) { return false; } }
  function vibra(ms) { var f = fn('vibrate'); if (f) f(ms); }
  function abrirHoja(html, op) { var f = fn('openModal'); if (f) f(html, op || { dismissible: true }); }
  function cerrarHoja() { var f = fn('closeModal'); if (f) f(); }
  function dinero(n) { var f = fn('formatMoney'); return f ? f(Number(n) || 0) : '$' + (Number(n) || 0).toFixed(2); }

  function rpc(nombre, args) {
    var c = nube();
    if (!c) return Promise.reject(new Error('sin_nube'));
    return c.sb.rpc(nombre, args || {}).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  /* Hace cuánto, en palabras. */
  function hace(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms) || ms < 0) return 'ahora';
    var s = Math.round(ms / 1000);
    if (s < 50) return 'hace ' + s + ' s';
    var m = Math.round(s / 60);
    if (m < 60) return 'hace ' + m + ' min';
    var h = Math.round(m / 60);
    if (h < 36) return 'hace ' + h + ' h';
    return 'hace ' + Math.round(h / 24) + ' días';
  }

  /* =======================================================================
     1. ESTADO EN MEMORIA
  ======================================================================= */
  var P = {
    porOrden: {},       /* id local del pedido -> fila de vp_pedidos */
    repartidores: [],
    codigo: null,
    codigoExpira: null,
    aceptados: 0,
    pendientes: 0,
    domicilioListo: false,
    cargando: false,
    ultimaCarga: 0,
    cargandoReps: false,
    ultimaCargaReps: 0,
    rescatados: {},     /* order_id -> ya se intentó rescatar su seguimiento */
    canal: null,
    canalUid: null,
    canalVin: null,
    canalVinUid: null,
    reintento: 0,
    respaldo: 0,
    ocultoEn: 0,
    arrancado: false
  };

  /* Para que el Menú Digital sepa, sin preguntar al servidor, si ya hay
     repartidores. Se guarda aquí porque mdPublicSnapshot() es síncrono. */
  var LLAVE_REPS = 'vp_reps_aceptados';
  function repsAceptados() {
    try { return Math.max(0, parseInt(localStorage.getItem(LLAVE_REPS) || '0', 10) || 0); }
    catch (e) { return 0; }
  }
  function guardaReps(n) {
    try { localStorage.setItem(LLAVE_REPS, String(Math.max(0, n | 0))); } catch (e) {}
  }

  var NOMBRE_PAGO = {
    efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta'
  };

  var NOMBRE_ESTADO = {
    enviado:    'Esperando que lo aceptes',
    preparando: 'En preparación',
    listo:      'Preparado',
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
             'total,metodo_pago,pago_estado';

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

  /* ---------------------------------------------------------------------
     Red de seguridad, ahora AUTOMÁTICA.

     Antes había un botón "Buscar seguimiento" en la ficha. Aparecía
     justo en la etapa de confirmar y preparar, que es donde pediste que
     NO estuviera. El botón existía porque el rescate era manual; ahora
     se hace solo, en silencio, la primera vez que se abre un pedido del
     Menú Digital que todavía no tiene seguimiento. Un intento por
     pedido: si no se puede, no se insiste ni se molesta al comerciante.
  --------------------------------------------------------------------- */
  function rescatar(o) {
    if (!o || !nube()) return;
    if (P.rescatados[o.id]) return;
    P.rescatados[o.id] = true;
    rpc('vp_pedidos_sincronizar')
      .then(function (r) { P.ultimoRescate = r; return cargar(true); })
      .then(function () {
        /* Si después del rescate SIGUE sin fila, hay un problema de
           verdad y hay que decirlo, no dejar el mensaje de "conectando"
           puesto para siempre. */
        P.rescateFallo = !dePedido(o);
        repintarBloque();
      })
      .catch(function (e) {
        P.rescateFallo = true;
        P.ultimoError = (e && e.message) || 'sin_respuesta';
        try { console.warn('[VendoPlus] No se pudo rescatar el seguimiento: ' + P.ultimoError); } catch (x) {}
        repintarBloque();
      });
  }

  /** Repara el seguimiento a mano, desde la ficha del pedido. */
  function reparar() {
    avisar('Reparando…');
    return rpc('vp_pedidos_sincronizar').then(function (r) {
      return cargar(true).then(function () {
        P.rescateFallo = false;
        var n = (r && r.creados) || 0;
        avisar(n ? 'Listo: ' + n + ' pedido(s) recuperado(s)' : 'No había nada que recuperar',
               { icon: ico('check') });
        repintarBloque();
        repintarLista();
        return r;
      });
    }).catch(function (e) {
      var m = (e && e.message) || '';
      if (/404/.test(m)) {
        avisar('Falta correr la migración en Supabase', {
          icon: ico('alert'),
          subtitle: 'El servidor no tiene la función vp_pedidos_sincronizar'
        });
      } else {
        avisar('No se pudo reparar', { icon: ico('alert'), subtitle: m });
      }
    });
  }

  /** Le dice al comerciante qué está pasando de verdad. */
  function diagnostico() {
    abrirHoja('<div class="sheet-header"><h2>Estado del seguimiento</h2>' +
      '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
      '<div id="vpDiag"><p class="todo-empty">Revisando…</p></div>');
    rpc('vp_diagnostico_seguimiento').then(function (filas) {
      var caja = document.getElementById('vpDiag');
      if (!caja) return;
      if (!Array.isArray(filas) || !filas.length) {
        caja.innerHTML = '<p class="todo-empty">El servidor no devolvió nada.</p>';
        return;
      }
      var h = '<p class="vp-ent-sub" style="margin:0 0 12px">Esto se lee de tu propia base de ' +
              'datos. No sale ningún dato de tus clientes.</p>';
      filas.forEach(function (f) {
        h += '<div class="vp-diag"><b>' + esc(f.cosa) + '</b>' +
             '<span class="vp-diag-v">' + esc(f.valor) + '</span>' +
             '<small>' + esc(f.que_significa) + '</small></div>';
      });
      h += '<div class="sheet-actions"><button class="btn primary block" ' +
           'onclick="VPPedidos.reparar()">Reparar seguimiento</button></div>';
      caja.innerHTML = h;
    }).catch(function (e) {
      var caja = document.getElementById('vpDiag');
      if (!caja) return;
      var m = (e && e.message) || '';
      caja.innerHTML = '<div class="vp-aviso falta">' + ico('alert') +
        '<span><b>No se pudo revisar</b>' +
        (/404/.test(m)
          ? 'Tu Supabase todavía no tiene la migración 09. Córrela y vuelve a intentarlo.'
          : esc(m || 'El servidor no respondió')) + '</span></div>';
    });
  }

  /* =======================================================================
     2b. EN VIVO: pedidos y vinculación de repartidores

     Dos canales, cada uno con su guardia para no abrirse dos veces:
       · vp_pedidos  → el repartidor avanzó el pedido
       · vp_vinculos → un repartidor pidió vincularse (o se resolvió)

     Además: un respaldo que revisa cada 20 s solo con la app a la vista,
     y un "despertar" al volver del segundo plano. Es el mismo patrón que
     ya usa VendoPlus para los pedidos entrantes, que funciona bien en
     celulares económicos.
  ======================================================================= */
  function escuchar() {
    var c = nube();
    if (!c || !c.sb.channel) return;
    var uid = c.uid;

    if (!P.canal || P.canalUid !== uid) {
      cerrarCanal('canal');
      try {
        P.canalUid = uid;
        P.canal = c.sb.channel('vp-entregas-' + uid)
          .on('postgres_changes',
              { event: '*', schema: 'public', table: 'vp_pedidos', filter: 'user_id=eq.' + uid },
              function (pl) {
                var row = pl && (pl.new || pl.old);
                if (!row || !row.order_id) return;
                if (pl.eventType === 'DELETE') delete P.porOrden[row.order_id];
                else P.porOrden[row.order_id] = row;
                repintarBloque();
                /* Un pedido que avanza puede cambiar de sección. */
                repintarLista();
              })
          .subscribe(function (st) { vigilar(st, uid, 'canal'); });
      } catch (e) { P.canal = null; P.canalUid = null; }
    }

    if (!P.canalVin || P.canalVinUid !== uid) {
      cerrarCanal('canalVin');
      try {
        P.canalVinUid = uid;
        P.canalVin = c.sb.channel('vp-vinculos-' + uid)
          .on('postgres_changes',
              { event: '*', schema: 'public', table: 'vp_vinculos', filter: 'user_id=eq.' + uid },
              function (pl) { vinculoCambio(pl); })
          .subscribe(function (st) { vigilar(st, uid, 'canalVin'); });
      } catch (e) { P.canalVin = null; P.canalVinUid = null; }
    }

    arrancarRespaldo();
  }

  function cerrarCanal(cual) {
    var c = window.Cloud;
    if (P[cual] && c && c.sb) { try { c.sb.removeChannel(P[cual]); } catch (e) {} }
    P[cual] = null;
    P[cual === 'canal' ? 'canalUid' : 'canalVinUid'] = null;
  }

  function cerrarCanales() { cerrarCanal('canal'); cerrarCanal('canalVin'); }

  /* Si la conexión en vivo se cae, se vuelve a abrir sola y se revisa lo
     que pasó mientras. Sin esto, el POS se queda mudo tras un túnel. */
  function vigilar(estado, uid, cual) {
    var c = nube();
    if (!c || c.uid !== uid) return;
    if (estado === 'SUBSCRIBED') {
      P.reintento = 0;
      setTimeout(function () {
        if (cual === 'canalVin') cargarRepartidores(true).then(repintarPanel);
        else cargar(true).then(function (h) { if (h) repintarBloque(); });
      }, 400);
      return;
    }
    if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
      cerrarCanal(cual);
      /* Se espera un poco más en cada intento, para no castigar la
         batería ni el servidor si el internet está mal de verdad. */
      P.reintento = Math.min(P.reintento + 1, 5);
      setTimeout(function () { if (nube()) escuchar(); }, 2000 * P.reintento);
    }
  }

  function vinculoCambio(pl) {
    var nueva = pl && pl.new;
    var vieja = pl && pl.old;
    /* Un repartidor nuevo pidiendo entrar: se avisa aunque el panel esté
       cerrado, porque es algo que el comerciante tiene que atender. */
    var esNueva = nueva && nueva.estado === 'pendiente' &&
                  (!vieja || vieja.estado !== 'pendiente');
    cargarRepartidores(true).then(function () {
      repintarPanel();
      repintarBloque();
      if (esNueva) {
        vibra([30, 60, 30]);
        avisar('Un repartidor quiere vincularse', {
          icon: ico('users'),
          variant: 'toast-success toast-top',
          subtitle: 'Ábrelo en Pedidos y entregas para aceptarlo',
          duration: 4200
        });
      }
    });
  }

  function arrancarRespaldo() {
    if (P.respaldo) return;
    /* Respaldo por si el canal en vivo se cayó sin avisar. Solo con la
       app a la vista: con la pantalla apagada el celular la detiene. */
    P.respaldo = setInterval(function () {
      if (document.hidden || !nube()) return;
      if (document.getElementById('vpRepPanel')) cargarRepartidores(true).then(repintarPanel);
      if (document.querySelector('.vp-ent[data-orden]')) cargar().then(function (h) { if (h) repintarBloque(); });
    }, 20000);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { P.ocultoEn = Date.now(); return; }
      despertar(P.ocultoEn && Date.now() - P.ocultoEn > 8000);
    });
    window.addEventListener('online', function () { despertar(true); });
    window.addEventListener('focus', function () { despertar(false); });
  }

  /* Al volver a la app: si estuvo mucho rato fuera, el celular pudo
     cortar la conexión en vivo. Se rehace y se baja lo que cambió. */
  function despertar(forzar) {
    if (!nube()) return;
    P.ocultoEn = 0;
    if (forzar) cerrarCanales();
    escuchar();
    cargar(true).then(function (h) { if (h) repintarBloque(); });
    if (document.getElementById('vpRepPanel')) cargarRepartidores(true).then(repintarPanel);
  }

  /* =======================================================================
     3. EL BLOQUE DE ENTREGA DENTRO DE LA FICHA DEL PEDIDO
        Se inserta justo antes del pie de la ficha, sin tocar nada de lo
        que ya estaba. Los tres procesos van uno debajo de otro, y solo
        se muestran los botones del proceso en el que está el pedido.
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
      /* Sin seguimiento. Se intenta rescatar solo, pero si el intento ya
         se hizo y sigue sin aparecer, NO se deja el mismo mensaje puesto
         para siempre: se dice que algo falló y se ofrece repararlo.
         Esto era justo lo que pasaba antes. */
      if (P.rescatados[o.id] && P.rescateFallo) {
        h += '<div class="vp-aviso falta">' + ico('alert') +
             '<span><b>Este pedido no tiene seguimiento</b>' +
             'El cliente no puede ver su pantalla de estado. El pedido está bien: ' +
             'puedes aceptarlo, prepararlo y cobrarlo con normalidad.</span></div>';
        h += '<div class="vp-ent-btns">' +
             '<button type="button" class="btn primary" onclick="VPPedidos.reparar()">' +
             ico('refresh') + ' Reparar seguimiento</button>' +
             '<button type="button" class="btn ghost" onclick="VPPedidos.diagnostico()">' +
             ico('alert') + ' ¿Qué pasó?</button></div>';
      } else {
        h += '<p class="vp-ent-sub">Conectando este pedido con el seguimiento del cliente…</p>';
      }
      return h + '</div>';
    }

    var recoger = !esDom || s.tipo_entrega === 'recoger';
    var paso = etapaDe(s, recoger);

    h += pasos(paso, recoger);

    /* ---- Cerrados: nada que hacer, pero el cobro sí se sigue viendo ---- */
    if (s.estado === 'rechazado' || s.estado === 'cancelado') {
      h += '<p class="vp-ent-sub">Este pedido está cerrado. El cliente ya lo vio en su pantalla.</p>';
      h += cobroHTML(o, s, true);
      return h + '</div>';
    }

    /* =================== PROCESO 1 · CONFIRMAR Y PREPARAR ==============
       Aquí NO se ponen botones de aceptar ni de rechazar: los de siempre
       ya están justo debajo, en el pie de la ficha, y además comprueban
       cosas que este bloque no debe duplicar (el costo de envío y el
       tiempo de preparación). Se respeta el diseño que ya funcionaba:
       este bloque solo explica qué está viendo el cliente. */
    if (s.estado === 'enviado') {
      h += '<p class="vp-ent-sub"><b>Proceso 1 · Confirmar y preparar.</b><br>' +
           'El cliente está viendo «Pedido enviado, esperando confirmación». ' +
           'Usa <b>Aceptar pedido</b> o <b>Rechazar</b>, aquí abajo: en cuanto lo aceptes, ' +
           'su pantalla cambia sola a «preparando».</p>';
      return h + '</div>';
    }

    if (s.estado === 'preparando') {
      h += '<p class="vp-ent-sub"><b>Proceso 1 · Confirmar y preparar.</b><br>' +
           'El cliente ve que su pedido está en preparación. Cuando termines, ' +
           'márcalo como preparado.</p>';
      h += '<div class="vp-ent-btns">' + btn(o.id, 'listo', 'Pedido preparado', 'check', true) + '</div>';
      return h + '</div>';
    }

    /* =================== PARA RECOGER ================================= */
    if (recoger) {
      if (s.estado === 'listo') {
        h += '<p class="vp-ent-sub"><b>Listo para recoger.</b><br>' +
             'El cliente ya ve que puede pasar por su pedido. Este pedido no lleva ' +
             'repartidor, ni mapa, ni código de entrega.</p>';
        h += cobroHTML(o, s, false);
        h += '<div class="vp-ent-btns">' +
             btn(o.id, 'entregado', 'Ya se lo entregué', 'check', true) + '</div>';
        return h + '</div>';
      }
      /* entregado */
      h += '<p class="vp-ent-sub">Entregado en el establecimiento. El cliente ya lo vio.</p>';
      h += cobroHTML(o, s, false);
      return h + '</div>';
    }

    /* =================== PROCESO 2 · PREPARADO Y REPARTIDOR ============ */
    var rep = s.repartidor_id
      ? P.repartidores.filter(function (r) { return r.repartidor_id === s.repartidor_id; })[0]
      : null;
    var nombreRep = rep ? (rep.nombre || 'Sin nombre') : (s.repartidor_id ? 'Asignado' : '');

    if (s.estado === 'listo') {
      h += '<div class="vp-ent-fila"><span>Repartidor</span><b>' +
           (nombreRep ? esc(nombreRep) + (s.aceptado_rep_en ? ' · aceptó' : ' · sin aceptar aún') : 'Sin asignar') +
           '</b></div>';
      h += '<p class="vp-ent-sub"><b>Proceso 2 · Pedido preparado y repartidor.</b><br>' +
           (s.repartidor_id
             ? 'Ya tiene repartidor asignado. <b>Asignarlo no significa que ya salió</b>: ' +
               'el pedido pasa a «en camino» cuando él confirme en su app que lo recogió.'
             : 'Elige a cuál de tus repartidores vinculados le toca este pedido. ' +
               'Le aparecerá solo en su app, sin que tenga que recargar. ' +
               '<b>Asignarlo no significa que ya salió</b>: el pedido pasa a «en camino» ' +
               'cuando él confirme que lo recogió.') +
           '</p>';

      /* Los repartidores se despliegan AQUÍ MISMO, debajo del pedido:
         no hay que irse a otra pantalla a buscarlos. */
      h += '<div class="vp-reps-aqui" id="vpRepsAqui">' + listaRepsHTML(o.id, s) + '</div>';

      if (dueno()) {
        h += '<div class="vp-ent-btns">' +
             '<button type="button" class="btn ghost" onclick="VPPedidos.excepcional(\'' + esc(o.id) + '\')">' +
             ico('alert') + ' Entrega sin código</button></div>';
      }
      /* Nada de seguimiento aquí: el repartidor todavía no salió. */
      return h + '</div>';
    }

    /* =================== PROCESO 3 · EN CAMINO, ENTREGA Y COBRO ======== */
    h += '<div class="vp-ent-fila"><span>Repartidor</span><b>' +
         (nombreRep ? esc(nombreRep) : 'Asignado') + '</b></div>';
    if (s.estado === 'en_camino' && s.eta_min) {
      h += '<div class="vp-ent-fila"><span>Llegada estimada</span><b>' +
           esc(String(s.eta_min)) + ' min</b></div>';
    }
    if (s.estado === 'entregado' && s.entregado_en) {
      h += '<div class="vp-ent-fila"><span>Entregado</span><b>' + esc(hace(s.entregado_en)) + '</b></div>';
    }

    if (s.estado === 'en_camino') {
      h += '<p class="vp-ent-sub"><b>Proceso 3 · En camino, entrega y cobro.</b><br>' +
           'El repartidor ya salió. El cliente ve el mapa, el tiempo estimado y puede ' +
           'escribirle. La entrega se cierra cuando el repartidor capture el código de ' +
           '4 dígitos que le dé el cliente.</p>';
      h += '<div class="vp-ent-btns">' +
           '<button type="button" class="btn primary" onclick="VPPedidos.verSeguimiento(\'' + esc(o.id) + '\')">' +
           ico('locate') + ' Ver seguimiento</button>';
      if (dueno()) {
        h += '<button type="button" class="btn ghost" onclick="VPPedidos.excepcional(\'' + esc(o.id) + '\')">' +
             ico('alert') + ' Entrega sin código</button>';
      }
      h += '</div>';
    } else {
      h += '<p class="vp-ent-sub"><b>Proceso 3 · Entrega y cobro.</b><br>' +
           'La entrega quedó cerrada con el código del cliente.</p>';
    }

    h += cobroHTML(o, s, false);
    return h + '</div>';
  }

  /* La barrita de los tres procesos. Es información, no un botón:
     muestra en cuál va el pedido sin cambiar el diseño de la ficha. */
  function etapaDe(s, recoger) {
    if (s.estado === 'enviado' || s.estado === 'preparando') return 1;
    if (!recoger && s.estado === 'listo') return 2;
    if (s.estado === 'rechazado' || s.estado === 'cancelado') return 0;
    return 3;
  }

  function pasos(paso, recoger) {
    if (!paso) return '';
    var n = recoger ? ['Preparar', 'Listo', 'Entrega y cobro'] : ['Confirmar', 'Repartidor', 'En camino'];
    if (recoger && paso === 2) paso = 3;
    var h = '<div class="vp-pasos" aria-label="Proceso ' + paso + ' de 3">';
    for (var i = 1; i <= 3; i++) {
      h += '<span class="vp-paso' + (i < paso ? ' ok' : (i === paso ? ' on' : '')) + '">' +
           '<i>' + i + '</i>' + esc(n[i - 1]) + '</span>';
    }
    return h + '</div>';
  }

  /* ---------------------------------------------------------------------
     EL COBRO · solo en la etapa final, y bien diferenciado.

     Reglas que se cumplen aquí:
       · No se mezcla con la preparación ni con la asignación.
       · Efectivo → se muestra el importe por cobrar.
       · Tarjeta pagada → "Pagado", y no se puede volver a cobrar.
       · Transferencia → se distingue pendiente de confirmada.
       · Un pago NO se marca hecho porque el pedido se entregó.
       · Un saldo pendiente NO se oculta al cerrar la entrega.
  --------------------------------------------------------------------- */
  function cobroHTML(o, s, cerrado) {
    if (!s || !s.metodo_pago) return '';
    var pagado = s.pago_estado === 'pagado';
    var rechazado = s.pago_estado === 'rechazado';
    var total = Number(s.total) || 0;
    var tarjeta = s.metodo_pago === 'tarjeta';
    var recoge = s.tipo_entrega === 'recoger';

    var h = '<div class="vp-cobro' + (pagado ? ' ok' : (rechazado ? ' mal' : '')) + '">';
    h += '<div class="vp-cobro-cab">' + ico('card') +
         '<b>Cobro · ' + esc(NOMBRE_PAGO[s.metodo_pago] || s.metodo_pago) + '</b>' +
         '<span class="vp-cobro-pill">' +
         (pagado ? 'Pagado' : rechazado ? 'Rechazado' : 'Pendiente') + '</span></div>';

    if (pagado) {
      h += '<p class="vp-ent-sub">' +
           (tarjeta ? 'Pagado con tarjeta por Mercado Pago. <b>No lo vuelvas a cobrar.</b>'
                    : 'Ya registraste que recibiste ' + dinero(total) + '.') + '</p>';
      return h + '</div>';
    }

    if (tarjeta) {
      h += '<div class="vp-cobro-monto">' + dinero(total) +
           '<small>pendiente de Mercado Pago</small></div>';
      h += '<p class="vp-ent-sub">' +
           (rechazado
             ? 'Mercado Pago rechazó el pago. Cóbralo de otra forma antes de entregar.'
             : 'Esperando el aviso de Mercado Pago. <b>Este pago no lo marcas tú</b>: ' +
               'lo confirma Mercado Pago cuando el dinero entra a tu cuenta. El servidor ' +
               'no deja marcarlo a mano por error.') + '</p>';
      /* Puerta de escape auditada: si el cliente acabó pagando de otra
         forma (tu terminal, efectivo), se registra a mano CON MOTIVO y
         queda en el historial. Solo el dueño. */
      if (dueno()) {
        h += '<div class="vp-ent-btns"><button type="button" class="btn ghost" ' +
             'onclick="VPPedidos.cobroManual(\'' + esc(o.id) + '\')">' +
             ico('alert') + ' Registrar cobro a mano</button></div>';
      }
      return h + '</div>';
    }

    h += '<div class="vp-cobro-monto">' + dinero(total) +
         '<small>' + (s.metodo_pago === 'efectivo'
                        ? (recoge ? 'por cobrar al entregarlo en el negocio' : 'por cobrar al entregar')
                        : 'pendiente de confirmar') +
         '</small></div>';
    h += '<p class="vp-ent-sub">' +
         (s.metodo_pago === 'efectivo'
           ? (recoge
                ? 'El cliente paga cuando pase por su pedido. Toca el botón cuando tengas el dinero en la mano.'
                : 'El cliente paga al recibir. Toca el botón cuando tengas el dinero en la mano.')
           : 'El cliente te transfiere. Revisa tu cuenta y confírmalo solo cuando veas el dinero.') +
         '</p>';
    h += '<div class="vp-ent-btns"><button type="button" class="btn primary" ' +
         'onclick="VPPedidos.confirmarPago(\'' + esc(o.id) + '\')">' + ico('check') + ' ' +
         (s.metodo_pago === 'efectivo' ? 'Ya recibí el pago' : 'Ya recibí la transferencia') +
         '</button></div>';

    if (cerrado || s.estado === 'entregado') {
      h += '<p class="vp-ent-sub" style="color:#A03030"><b>Ojo:</b> este pedido ya se cerró y ' +
           'el cobro sigue pendiente.</p>';
    }
    return h + '</div>';
  }

  /* ---------------------------------------------------------------------
     La lista de repartidores, DENTRO de la ficha del pedido.

     Es la misma información que la hoja de "Seleccionar repartidor",
     pero desplegada debajo del pedido, que es donde la pediste: al
     marcar "Pedido preparado" ya está ahí, sin cambiar de pantalla.
  --------------------------------------------------------------------- */
  function listaRepsHTML(ordenId, s) {
    var libres = P.repartidores.filter(function (r) { return r.estado === 'aceptado'; });
    var pend = P.repartidores.filter(function (r) { return r.estado === 'pendiente'; });

    if (!libres.length) {
      var h0 = '<div class="vp-aviso falta">' + ico('alert') +
        '<span><b>No tienes ningún repartidor vinculado</b>' +
        'Genera un código en <b>Menú Digital → Servicio a domicilio</b> y dáselo a tu ' +
        'repartidor. Él lo escribe en la app <b>VendoPlus Repartidor</b> y su solicitud ' +
        'te llega aquí sola.' +
        (pend.length ? '<br><br>Tienes <b>' + pend.length + '</b> solicitud' +
                       (pend.length === 1 ? '' : 'es') + ' esperando.' : '') +
        '</span></div>';
      h0 += '<div class="vp-ent-btns"><button type="button" class="btn primary block" ' +
            'onclick="VPPedidos.panel()">' + ico('users') + ' Abrir repartidores</button></div>';
      return h0;
    }

    var h = '<div class="vp-reps-t">' +
            (s.repartidor_id ? 'Cambiar de repartidor' : 'Envíaselo a uno de tus repartidores') +
            '</div><div class="vp-rep-lista">';
    libres.forEach(function (r) {
      var yo = r.repartidor_id === s.repartidor_id;
      h += '<button type="button" class="vp-rep-item' + (yo ? ' sel' : '') + '" ' +
           'onclick="VPPedidos.asignar(\'' + esc(ordenId) + '\',\'' + esc(r.repartidor_id) + '\')">' +
           '<div class="vp-rep-ini">' + esc((r.nombre || '?').charAt(0).toUpperCase()) + '</div>' +
           '<div class="vp-rep-main"><b>' + esc(r.nombre || 'Sin nombre') + '</b>' +
           '<span>' + (yo ? 'Ya lleva este pedido'
                          : (r.ocupado ? 'Con una entrega en curso' : 'Disponible')) + '</span></div>' +
           (yo ? '<span class="vp-rep-ok">' + ico('check') + '</span>'
               : '<span class="vp-rep-env">Enviar</span>') +
           '</button>';
    });
    h += '</div>';
    if (s.repartidor_id) {
      h += '<div class="vp-ent-btns"><button type="button" class="btn ghost" ' +
           'onclick="VPPedidos.asignar(\'' + esc(ordenId) + '\', null)">Quitar asignación</button></div>';
    }
    return h;
  }

  /* =====================================================================
     LAS TRES SECCIONES DE "PEDIDOS ENTRANTES"

       1. Pendientes        → revisarlo, ajustar el importe, aceptar o
                              rechazar
       2. En preparación    → aceptado; aquí se marca "Pedido preparado"
                              y se le manda a un repartidor
       3. Entrega y cobro   → ya salió (o ya está listo para recoger):
                              seguimiento, entrega y cobro

     El estado que manda es el del SEGUIMIENTO (vp_pedidos). Si un
     pedido todavía no lo tiene, se usa el estado local del POS, para
     que nunca desaparezca de la lista.
  ===================================================================== */
  var SECCIONES = [
    { id: 'pendientes', titulo: 'Pendientes',
      sub: 'Revísalos y acéptalos o recházalos' },
    { id: 'preparacion', titulo: 'En preparación',
      sub: 'Prepáralos y mándaselos a un repartidor' },
    { id: 'entrega', titulo: 'Entrega y cobro',
      sub: 'En camino, entregados y lo que falta cobrar' }
  ];

  /** ¿En qué sección va este pedido? */
  function seccionDe(o) {
    var s = dePedido(o);
    var est = s ? s.estado : null;

    if (!est) {
      /* Sin seguimiento todavía: se usa el estado local del POS. */
      var etapa = fn('mdiStage') ? ref('mdiStage')(o) : null;
      var id = etapa ? etapa.id : 'nuevo';
      if (id === 'nuevo') return 'pendientes';
      if (id === 'pendiente') return 'preparacion';
      return null;                 /* terminado: no va en los activos */
    }

    if (est === 'enviado') return 'pendientes';
    if (est === 'preparando') return 'preparacion';
    if (est === 'listo') {
      /* Para recoger, "listo" ya es entrega y cobro.
         A domicilio, sigue en preparación hasta que el repartidor sale. */
      return s.tipo_entrega === 'recoger' ? 'entrega' : 'preparacion';
    }
    if (est === 'en_camino') return 'entrega';
    if (est === 'entregado') {
      /* Entregado pero sin cobrar: sigue a la vista. Es lo que pediste:
         no se esconde un saldo pendiente al cerrar la entrega. */
      return s.pago_estado === 'pagado' ? null : 'entrega';
    }
    return null;                   /* rechazado o cancelado */
  }

  function seccionesHTML() {
    var todos = [];
    try { todos = window.MDI ? MDI.all() : []; } catch (e) { return ''; }
    if (!todos.length) return '';

    todos = todos.slice().sort(function (a, b) {
      return new Date(b.receivedAt || b.createdAt) - new Date(a.receivedAt || a.createdAt);
    });

    var grupos = { pendientes: [], preparacion: [], entrega: [] };
    todos.forEach(function (o) {
      if (o.source && o.source !== 'menu') {
        /* Los pegados o hechos en caja siguen su camino de siempre. */
        var e2 = fn('mdiStage') ? ref('mdiStage')(o) : null;
        var i2 = e2 ? e2.id : 'nuevo';
        if (i2 === 'nuevo') grupos.pendientes.push(o);
        else if (i2 === 'pendiente') grupos.preparacion.push(o);
        return;
      }
      var g = seccionDe(o);
      if (g && grupos[g]) grupos[g].push(o);
    });

    var total = grupos.pendientes.length + grupos.preparacion.length + grupos.entrega.length;
    if (!total) {
      return '<div class="mdi-empty">' +
             '<span class="mdi-empty-ico">' + ico('inbox') + '</span>' +
             '<b>Sin pedidos por ahora</b>' +
             '<span>Cuando un cliente pida desde tu Menú Digital, aparecerá aquí.</span>' +
             '</div>';
    }

    var tarjeta = fn('mdiCardSimpleHTML');
    var h = '<div class="vp-secs">';
    SECCIONES.forEach(function (sec) {
      var l = grupos[sec.id];
      h += '<div class="vp-sec vp-sec-' + sec.id + (l.length ? '' : ' vacia') + '">';
      h += '<div class="vp-sec-cab"><b>' + esc(sec.titulo) + '</b>' +
           (l.length ? '<span class="vp-sec-n">' + l.length + '</span>' : '') +
           '<small>' + esc(sec.sub) + '</small></div>';
      if (!l.length) {
        h += '<p class="vp-sec-vacia">Nada por ahora</p>';
      } else if (tarjeta) {
        h += '<div class="mdi-list">' +
             l.map(function (o) { return tarjeta(o, false); }).join('') +
             '</div>';
      }
      h += '</div>';
    });
    return h + '</div>';
  }

  function btn(ordenId, estado, texto, icono, primario) {
    return '<button type="button" class="btn ' + (primario ? 'primary' : 'ghost') + '" ' +
           'onclick="VPPedidos.estado(\'' + esc(ordenId) + '\',\'' + estado + '\')">' +
           ico(icono) + ' ' + esc(texto) + '</button>';
  }

  /* Vuelve a pintar la lista de pedidos entrantes, si está a la vista y
     no hay ninguna hoja abierta encima (para no cerrarle nada al
     comerciante mientras escribe). */
  var repintando = false;
  function repintarLista() {
    if (repintando) return;
    if (document.querySelector('#modal-layer .modal-sheet')) return;
    var f = fn('render');
    var v = ref('currentView');
    if (!f || (v !== 'menu' && v !== 'home')) return;
    repintando = true;
    setTimeout(function () { repintando = false; try { f(); } catch (e) {} }, 80);
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
  function cambiarEstado(ordenId, estado, motivo) {
    var o = null;
    try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) { avisar('Este pedido todavía no tiene seguimiento en línea'); return; }
    vibra(10);
    var textos = {
      preparando: 'Pedido aceptado · el cliente ya lo ve',
      listo: 'Marcado como preparado',
      entregado: 'Entrega registrada',
      rechazado: 'Pedido rechazado'
    };
    rpc('vp_pedido_estado', {
      p_pedido_id: s.id, p_estado: estado, p_motivo: String(motivo || '').slice(0, 300)
    }).then(function (r) {
      if (r && r.ok) {
        s.estado = r.estado || estado;
        avisar(textos[estado] || 'Pedido actualizado', { icon: ico('check') });
        repintarBloque();
        repintarLista();
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
      metodo_no_manual: 'Los pagos con tarjeta los confirma Mercado Pago',
      no_encontrado: 'No encontramos ese pedido',
      sin_sesion: 'Inicia sesión para hacer esto'
    };
    return m[e] || 'No se pudo completar la acción';
  }

  /* ---- Seleccionar repartidor ----
     "Buscar repartidor" es elegir entre LOS TUYOS, los que ya aceptaste.
     No es ningún servicio público de reparto. */
  function elegirRepartidor(ordenId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    abrirHoja('<div class="sheet-header"><h2>Seleccionar repartidor</h2>' +
      '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
      '<div id="vpElegirRep"><p class="todo-empty">Cargando…</p></div>');
    P._eligiendo = ordenId;
    cargarRepartidores(true).then(function () { pintarElegir(ordenId); });
  }

  function pintarElegir(ordenId) {
    var caja = document.getElementById('vpElegirRep');
    if (!caja) return;
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;

    var libres = P.repartidores.filter(function (r) { return r.estado === 'aceptado'; });
    var pend = P.repartidores.filter(function (r) { return r.estado === 'pendiente'; });
    var h = '';

    if (!libres.length) {
      h += '<p class="todo-empty">Todavía no tienes ningún repartidor vinculado.<br>' +
           'Genera un código en <b>Pedidos y entregas</b> y dáselo a tu repartidor: ' +
           'él lo escribe en la app <b>VendoPlus Repartidor</b> y te llega su solicitud aquí.</p>';
      if (pend.length) {
        h += '<p class="vp-ent-sub" style="text-align:center">' +
             'Tienes ' + pend.length + ' solicitud' + (pend.length === 1 ? '' : 'es') +
             ' esperando que la aceptes.</p>';
      }
      h += '<div class="sheet-actions"><button class="btn primary block" ' +
           'onclick="VPPedidos.panel()">Abrir Pedidos y entregas</button></div>';
      caja.innerHTML = h;
      return;
    }

    h += '<p class="vp-ent-sub" style="margin:0 0 12px">Elige quién lleva este pedido. ' +
         'Le va a aparecer solo en su app. <b>Asignarlo no significa que ya salió</b>: ' +
         'él confirma cuando lo recoja.</p>';
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
    caja.innerHTML = h;
  }

  function asignar(ordenId, repId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    rpc('vp_pedido_asignar', { p_pedido_id: s.id, p_repartidor_id: repId || null }).then(function (r) {
      if (r && r.ok) {
        s.repartidor_id = repId || null;
        s.aceptado_rep_en = null;
        P._eligiendo = null;
        cerrarHoja();
        avisar(repId ? 'Repartidor asignado' : 'Asignación quitada', {
          icon: ico('check'),
          subtitle: repId ? 'Le aparece en su app en unos segundos' : ''
        });
        var f = fn('mdiOpen'); if (f && o) f(o.id, true);
      } else {
        avisar(mensajeError(r), { icon: ico('alert') });
      }
    }).catch(function () { avisar('No se pudo asignar'); });
  }

  /* ---- Ver seguimiento · SOLO cuando el repartidor ya salió ---- */
  function verSeguimiento(ordenId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    if (s.estado !== 'en_camino') {
      avisar('El seguimiento se abre cuando el repartidor sale con el pedido');
      return;
    }
    abrirHoja('<div class="sheet-header"><h2>Seguimiento de la entrega</h2>' +
      '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
      '<div id="vpSegPos"><p class="todo-empty">Buscando al repartidor…</p></div>');
    traerUbicacion(s.id, ordenId);
  }

  function traerUbicacion(pedidoId, ordenId) {
    var c = nube();
    if (!c) return;
    c.sb.from('vp_ubicaciones').select('lat,lng,actualizado_en,precision_m')
      .eq('pedido_id', pedidoId).maybeSingle()
      .then(function (r) { pintarSeg((r && r.data) || null, ordenId); })
      .catch(function () { pintarSeg(null, ordenId); });
  }

  function pintarSeg(u, ordenId) {
    var caja = document.getElementById('vpSegPos');
    if (!caja) return;
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    var rep = s.repartidor_id
      ? P.repartidores.filter(function (r) { return r.repartidor_id === s.repartidor_id; })[0]
      : null;

    var h = '<div class="vp-ent-fila"><span>Estado</span><b>El repartidor va en camino</b></div>';
    h += '<div class="vp-ent-fila"><span>Repartidor</span><b>' +
         esc(rep ? (rep.nombre || 'Sin nombre') : 'Asignado') + '</b></div>';
    h += '<div class="vp-ent-fila"><span>Llegada estimada</span><b>' +
         (s.eta_min ? esc(String(s.eta_min)) + ' min' : 'Calculándose') + '</b></div>';
    h += '<div class="vp-ent-fila"><span>Entregar en</span><b>' +
         esc(s.destino_texto || 'Sin referencia') + '</b></div>';

    if (u && u.lat != null && u.lng != null) {
      h += '<div class="vp-ent-fila"><span>Última ubicación</span><b>' + esc(hace(u.actualizado_en)) + '</b></div>';
      var url = 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(u.lat) +
                '&mlon=' + encodeURIComponent(u.lng) + '#map=17/' + u.lat + '/' + u.lng;
      h += '<div class="vp-ent-btns">' +
           '<a class="btn ghost" href="' + esc(url) + '" target="_blank" rel="noopener">' +
           ico('locate') + ' Abrir en el mapa</a>' +
           '<button type="button" class="btn ghost" onclick="VPPedidos.verSeguimiento(\'' + esc(ordenId) + '\')">' +
           ico('refresh') + ' Actualizar</button></div>';
      h += '<p class="vp-ent-sub">El cliente ve esta misma posición moviéndose en su mapa.</p>';
    } else {
      h += '<p class="vp-ent-sub">Todavía no llega la ubicación del repartidor. Pasa cuando ' +
           'trae el GPS apagado o sin señal. <b>No se inventa una posición</b>: ni aquí ni en ' +
           'la pantalla del cliente.</p>';
      h += '<div class="vp-ent-btns"><button type="button" class="btn ghost block" ' +
           'onclick="VPPedidos.verSeguimiento(\'' + esc(ordenId) + '\')">' +
           ico('refresh') + ' Actualizar</button></div>';
    }
    caja.innerHTML = h;
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
      'Queda registrado quién lo autorizó, con fecha, hora y motivo.<br><br>' +
      '<b>Esto cierra la entrega, no el cobro.</b> Si el pedido era en efectivo o por ' +
      'transferencia, el saldo sigue apareciendo como pendiente hasta que lo confirmes.</p>' +
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
     5. PANEL DE PEDIDOS Y ENTREGAS (repartidores)

     Una sola llamada (vp_negocio_entregas) trae el código activo, las
     solicitudes y los vinculados. Se repinta solo cuando algo cambia en
     vp_vinculos, sin volver a abrir la pantalla.
  ======================================================================= */
  function cargarRepartidores(forzar) {
    if (!nube()) return Promise.resolve(false);
    if (P.cargandoReps) return Promise.resolve(false);
    if (!forzar && P.repartidores.length && Date.now() - P.ultimaCargaReps < 4000) {
      return Promise.resolve(true);
    }
    P.cargandoReps = true;
    var antes = repsAceptados();
    return rpc('vp_negocio_entregas').then(function (r) {
      P.cargandoReps = false;
      P.ultimaCargaReps = Date.now();
      if (r && r.ok) {
        P.repartidores = r.repartidores || [];
        P.codigo = r.codigo || null;
        P.codigoExpira = r.codigo_expira || null;
        P.aceptados = r.aceptados || 0;
        P.pendientes = r.pendientes || 0;
        P.domicilioListo = !!r.domicilio_listo;
        guardaReps(P.aceptados);
        /* Si acaba de tener su primer repartidor (o se quedó sin
           ninguno), el menú publicado tiene que cambiar: es lo que
           decide si el cliente ve la opción "a domicilio". */
        if ((antes < 1) !== (P.aceptados < 1)) republicarMenu();
      }
      return true;
    }).catch(function () {
      P.cargandoReps = false;
      /* Si la función nueva todavía no está en Supabase (falta correr la
         migración 08), se usa la de antes para no dejar el panel vacío. */
      return rpc('vp_repartidores_lista').then(function (r) {
        if (r && r.ok) {
          P.repartidores = r.repartidores || [];
          P.aceptados = P.repartidores.filter(function (x) { return x.estado === 'aceptado'; }).length;
          P.pendientes = P.repartidores.filter(function (x) { return x.estado === 'pendiente'; }).length;
          P.domicilioListo = P.aceptados > 0;
          guardaReps(P.aceptados);
          if ((antes < 1) !== (P.aceptados < 1)) republicarMenu();
        }
        return true;
      }).catch(function () { return false; });
    });
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
      escuchar();
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

  /* El mismo contenido se usa en dos lugares: en este panel y dentro de
     la configuración de "Servicio a domicilio" del Menú Digital. Así el
     comerciante no tiene que ir a buscarlo a otra pantalla. */
  function repartidoresHTML(compacto) {
    var pend = P.repartidores.filter(function (r) { return r.estado === 'pendiente'; });
    var act = P.repartidores.filter(function (r) { return r.estado === 'aceptado'; });
    var h = '';

    /* ---- ¿Puede ofrecer domicilio? ---- */
    if (!act.length) {
      h += '<div class="vp-aviso falta">' + ico('alert') +
           '<span><b>Falta vincular un repartidor</b>' +
           'Mientras no tengas al menos uno aceptado, tus clientes <b>no verán la opción ' +
           '«a domicilio»</b> en tu Menú Digital: solo podrán ir a buscar su pedido. ' +
           'Puedes guardar la configuración ahora y vincularlo después.</span></div>';
    } else {
      h += '<div class="vp-aviso ok">' + ico('check') +
           '<span><b>Tu servicio a domicilio está listo</b>' +
           'Tienes ' + act.length + ' repartidor' + (act.length === 1 ? '' : 'es') +
           ' vinculado' + (act.length === 1 ? '' : 's') + '. Ya puedes recibir pedidos a domicilio.</span></div>';
    }

    /* ---- Código de vinculación ---- */
    h += '<div class="vp-cod-box">';
    if (P.codigo) {
      h += '<div class="vp-cod-n">' + esc(P.codigo) + '</div>' +
           '<p class="vp-ent-sub">Dale este código a tu repartidor. Lo escribe en la app ' +
           '<b>VendoPlus Repartidor</b>, en «Vincular negocio», y su solicitud te aparece aquí ' +
           'sola, sin recargar.' + (P.codigoExpira ? '<br>Vence el ' + esc(fecha(P.codigoExpira)) + '.' : '') +
           '</p>' +
           '<div class="vp-ent-btns">' +
           '<button type="button" class="btn ghost" onclick="VPPedidos.copiarCodigo()">' + ico('copy') + ' Copiar</button>' +
           '<button type="button" class="btn ghost" onclick="VPPedidos.nuevoCodigo()">' + ico('refresh') + ' Generar otro</button>' +
           '<button type="button" class="btn danger" onclick="VPPedidos.revocarCodigo()">Desactivar</button>' +
           '</div>';
    } else {
      h += '<p class="vp-ent-sub">Para que un repartidor pueda recibir tus pedidos, genera un ' +
           'código y compártelo con él. Dura 7 días y lo puedes desactivar cuando quieras.</p>' +
           '<div class="vp-ent-btns"><button type="button" class="btn primary block" ' +
           'onclick="VPPedidos.nuevoCodigo()">' + ico('plus') + ' Generar código</button></div>';
    }
    h += '</div>';

    /* ---- Solicitudes pendientes ---- */
    if (pend.length) {
      h += '<div class="section-title">Solicitudes' +
           ' <span class="vp-num">' + pend.length + '</span></div><div class="vp-rep-lista">';
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

    if (!compacto) {
      h += '<p class="vp-ent-sub" style="margin-top:14px">No hace falta que tu repartidor ' +
           'tenga la app abierta ni esté conectado para que lo vincules o para que guardes ' +
           'tu configuración.</p>';
    }
    return h;
  }

  function fecha(iso) {
    try {
      return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
    } catch (e) { return ''; }
  }

  /* Vuelve a subir el menú público usando el publicador que ya existe en
     VendoPlus (MenuPub). Hace falta cuando cambia algo que el cliente
     tiene que ver de inmediato: si ya hay repartidor, o si la tarjeta
     quedó disponible. Si no está (versión vieja), no pasa nada. */
  function republicarMenu() {
    try {
      var mp = ref('MenuPub');
      if (mp && typeof mp.run === 'function') mp.run(true);
    } catch (e) {}
  }

  /* Repinta los dos lugares donde puede estar la lista, si están
     abiertos. Si no, no hace nada: no cuesta nada llamarlo siempre. */
  function repintarPanel() {
    var caja = document.getElementById('vpRepPanel');
    if (caja) caja.innerHTML = repartidoresHTML(false);
    var mini = document.getElementById('vpRepEnDomicilio');
    if (mini) mini.innerHTML = repartidoresHTML(true);
    if (P._eligiendo && document.getElementById('vpElegirRep')) pintarElegir(P._eligiendo);
    /* La pantalla de configuración del menú muestra si falta repartidor */
    var f = fn('mdRerenderIfMenu');
    if (f && !document.querySelector('#modal-layer .modal-sheet')) { try { f(); } catch (e) {} }
  }

  function nuevoCodigo() {
    rpc('vp_codigo_generar', { p_max_usos: 5 }).then(function (r) {
      if (r && r.ok) {
        P.codigo = r.codigo;
        P.codigoExpira = r.expira_en || null;
        repintarPanel(); vibra(12);
      } else avisar(mensajeError(r));
    }).catch(function () { avisar('No se pudo generar el código'); });
  }
  function revocarCodigo() {
    rpc('vp_codigo_revocar').then(function () {
      P.codigo = null; P.codigoExpira = null; repintarPanel();
      avisar('Código desactivado');
    }).catch(function () { avisar('No se pudo desactivar'); });
  }
  function copiarCodigo() {
    if (!P.codigo) return;
    if (navigator.clipboard) navigator.clipboard.writeText(P.codigo).then(function () { avisar('Código copiado'); });
    else avisar('Tu código es ' + P.codigo);
  }
  function resolver(vinculoId, aceptar) {
    rpc('vp_vinculo_resolver', { p_vinculo_id: vinculoId, p_aceptar: !!aceptar }).then(function (r) {
      if (r && r.ok) {
        avisar(aceptar ? 'Repartidor aceptado' : 'Solicitud rechazada', {
          icon: ico('check'),
          subtitle: 'Lo ve en su app en unos segundos'
        });
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
      }).catch(function () { avisar('No se pudo desvincular'); });
    };
    if (ask) ask({ title: '¿Quitar a este repartidor?',
                   text: 'Dejará de recibir tus pedidos y lo verá en su app. Los que todavía no recoge se le quitan.',
                   ok: 'Quitar', icon: ico('alert') }, hazlo);
    else if (confirm('¿Quitar a este repartidor?')) hazlo();
  }

  /* Sigue disponible por si alguna vez hace falta a mano, pero ya no hay
     ningún botón que lo llame: el rescate es automático. */
  function sincronizar() {
    return rpc('vp_pedidos_sincronizar').then(function (r) {
      return cargar(true).then(function () {
        repintarBloque();
        return r;
      });
    });
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

  var LLAVE_COB = 'vp_cobros_cache';

  function cargarCobros() {
    var c = nube();
    if (!c) return Promise.resolve(false);
    return c.sb.from('vp_cobros').select('*').maybeSingle().then(function (r) {
      COB = (r && r.data) ? r.data : {
        efectivo: true, transferencia: false, tarjeta: false,
        transf_banco: '', transf_titular: '', transf_clabe: '', transf_nota: '',
        mp_conectado: false, mp_apodo: ''
      };
      guardaCobros();
      return true;
    }).catch(function () { return false; });
  }

  /* Se guarda una copia local porque mdPublicSnapshot() es síncrono y
     necesita saber si la tarjeta de verdad está disponible. */
  function guardaCobros() {
    try {
      localStorage.setItem(LLAVE_COB, JSON.stringify({
        tarjeta: !!(COB && COB.tarjeta), mp: !!(COB && COB.mp_conectado)
      }));
    } catch (e) {}
  }
  function cobrosCache() {
    try { return JSON.parse(localStorage.getItem(LLAVE_COB) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function pintarCobros() {
    var caja = document.getElementById('vpCobPanel');
    if (!caja || !COB) return;
    var h = '';

    h += '<p class="vp-ent-sub" style="margin:0 0 14px">Elige cómo pueden pagarte los clientes ' +
         'que piden desde tu Menú Digital.</p>';

    /* --- Efectivo --- */
    h += bloqueCobro('efectivo', 'Efectivo', COB.efectivo,
      'El cliente paga al recibir su pedido. Tú registras el cobro en la ficha del pedido, ' +
      'en la etapa de entrega.');

    /* --- Transferencia --- */
    h += bloqueCobro('transferencia', 'Transferencia bancaria', COB.transferencia,
      'El cliente ve tus datos y te transfiere. El pedido se marca como pagado <b>solo cuando ' +
      'tú confirmas</b> que viste el dinero en tu cuenta.');
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
      h += '<p class="vp-ent-sub">Enlazado a Mercado Pago' +
           (COB.mp_apodo ? ' como <b>' + esc(COB.mp_apodo) + '</b>' : '') + '.<br>' +
           'El dinero entra <b>directo a tu cuenta</b>. VendoPlus no se queda con nada; ' +
           'solo aplica la comisión de Mercado Pago.</p>';
      h += '<label class="vp-cob-check"><input type="checkbox" id="vpCobTarjeta"' +
           (COB.tarjeta ? ' checked' : '') + ' onchange="VPPedidos.cobroCambio()"> ' +
           'Aceptar pagos con tarjeta</label>';
      h += '<div class="vp-aviso falta" style="margin-top:10px">' + ico('alert') +
           '<span><b>El cobro con tarjeta todavía no está probado</b>' +
           'La conexión con Mercado Pago tiene un pendiente conocido. Aunque enciendas ' +
           'esta casilla, no des por hecho que los cobros con tarjeta ya funcionan: ' +
           'haz una prueba real antes de ofrecerla a tus clientes.</span></div>';
      h += '<div class="vp-ent-btns"><button type="button" class="btn danger" ' +
           'onclick="VPPedidos.mpDesconectar()">Desenlazar Mercado Pago</button></div>';
    } else {
      h += '<p class="vp-ent-sub">Enlaza tu cuenta de Mercado Pago para aceptar tarjetas. ' +
           'El cobro llega <b>directo a tu cuenta</b>, no a VendoPlus.<br>' +
           'Mientras no esté enlazada, <b>la opción «Tarjeta» no le aparece a tus clientes</b>.</p>';
      h += '<div class="vp-ent-btns"><button type="button" class="btn primary block" ' +
           'onclick="VPPedidos.mpConectar()">Enlazar Mercado Pago</button></div>';
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
    if (document.getElementById('vpCobTarjeta')) COB.tarjeta = leeCheck('vpCobTarjeta');
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
      if (r && r.ok) {
        /* El servidor manda la verdad: si la tarjeta no se pudo
           encender porque falta Mercado Pago, se refleja aquí. */
        return cargarCobros().then(function () {
          cerrarHoja();
          avisar('Formas de pago guardadas', { icon: ico('check') });
          republicarMenu();
        });
      }
      avisar(mensajeError(r));
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
        : 'No se pudo abrir Mercado Pago. Es un pendiente conocido: revisa la guía de pagos');
    }).catch(function () {
      avisar('No se pudo abrir Mercado Pago. Es un pendiente conocido: revisa la guía de pagos');
    });
  }

  function mpDesconectar() {
    var ask = fn('askConfirm');
    var hazlo = function () {
      rpc('vp_mp_desconectar').then(function () {
        avisar('Mercado Pago desenlazado');
        cargarCobros().then(pintarCobros);
      }).catch(function () { avisar('No se pudo desenlazar'); });
    };
    if (ask) ask({ title: '¿Desenlazar Mercado Pago?',
                   text: 'Dejarás de aceptar tarjetas en tu Menú Digital. Puedes volver a enlazarlo cuando quieras.',
                   ok: 'Desenlazar', icon: ico('alert') }, hazlo);
    else if (confirm('¿Desenlazar Mercado Pago?')) hazlo();
  }

  /** Registrar que llegó el dinero (efectivo o transferencia). */
  function confirmarPago(ordenId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    if (s.metodo_pago === 'tarjeta') {
      avisar('Los pagos con tarjeta los confirma Mercado Pago, no tú');
      return;
    }
    if (s.pago_estado === 'pagado') { avisar('Este pedido ya está pagado'); return; }
    var ask = fn('askConfirm');
    var hazlo = function () {
      rpc('vp_pago_confirmar', { p_pedido_id: s.id, p_nota: '' }).then(function (r) {
        if (r && r.ok) {
          avisar('Pago registrado', { icon: ico('check'), subtitle: 'El cliente lo ve como pagado' });
          cargar(true).then(repintarBloque);
        } else avisar(mensajeError(r));
      }).catch(function () { avisar('No se pudo registrar'); });
    };
    if (ask) ask({
      title: '¿Ya tienes el dinero?',
      text: s.metodo_pago === 'efectivo'
        ? 'Confirma solo si ya recibiste ' + dinero(s.total) + ' en efectivo.'
        : 'Confirma solo si ya viste la transferencia de ' + dinero(s.total) + ' en tu cuenta.',
      ok: 'Sí, ya lo recibí', icon: ico('check')
    }, hazlo);
    else hazlo();
  }

  /**
   * Registrar a mano un cobro con tarjeta que Mercado Pago no confirmó.
   *
   * Existe porque si no, un pedido con tarjeta se quedaría "pendiente"
   * para siempre cuando el cliente acabó pagando de otra forma. Pero no
   * es un botón suelto: exige motivo, lo puede usar solo el dueño, y
   * queda registrado en el historial del pedido con fecha y hora.
   */
  function cobroManual(ordenId) {
    var o = null; try { o = MDI.get(ordenId); } catch (e) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    if (!dueno()) { avisar('Solo el Dueño puede registrar un cobro a mano'); return; }
    if (s.pago_estado === 'pagado') { avisar('Este pedido ya está pagado'); return; }

    abrirHoja(
      '<div class="sheet-header"><h2>Registrar cobro a mano</h2>' +
      '<button class="sheet-close" onclick="closeModal()" aria-label="Cerrar">' + ico('close') + '</button></div>' +
      '<p class="vp-ent-sub" style="padding:0 2px 10px">Este pedido era con tarjeta por Mercado ' +
      'Pago. Usa esto <b>solo si el cliente te pagó de otra forma</b>: con tu terminal física, ' +
      'en efectivo o por transferencia.<br><br>Queda registrado quién lo marcó, cuándo y por qué. ' +
      'Importe: <b>' + dinero(s.total) + '</b>.</p>' +
      '<label class="field"><span>Motivo</span>' +
      '<input id="vpCobMotivo" type="text" maxlength="160" autocomplete="off" ' +
      'placeholder="Ej. Pagó con mi terminal al recibir"></label>' +
      '<div class="sheet-actions">' +
      '<button class="btn ghost" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn danger" onclick="VPPedidos.cobroManualOk(\'' + esc(ordenId) + '\')">' +
      'Registrar cobro</button></div>'
    );
    setTimeout(function () {
      var e = document.getElementById('vpCobMotivo'); if (e) e.focus();
    }, 90);
  }

  function cobroManualOk(ordenId) {
    var e = document.getElementById('vpCobMotivo');
    var motivo = e ? (e.value || '').trim() : '';
    if (motivo.length < 5) { avisar('Escribe el motivo'); if (e) e.focus(); return; }
    var o = null; try { o = MDI.get(ordenId); } catch (ex) {}
    var s = o ? dePedido(o) : null;
    if (!s) return;
    rpc('vp_pago_manual', { p_pedido_id: s.id, p_motivo: motivo }).then(function (r) {
      if (r && r.ok) {
        cerrarHoja();
        avisar('Cobro registrado', { icon: ico('check'), subtitle: 'Quedó en el historial' });
        cargar(true).then(repintarBloque);
      } else avisar(mensajeError(r), { icon: ico('alert') });
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
      '.vp-ent-btns a.btn{display:flex;align-items:center;justify-content:center;gap:7px;text-decoration:none;}',

      /* Los tres procesos */
      '.vp-pasos{display:flex;gap:6px;margin:2px 0 10px;}',
      '.vp-paso{flex:1;display:flex;align-items:center;gap:6px;padding:6px 7px;border-radius:9px;',
      'background:#F4F5F8;font-size:11px;font-weight:700;color:#8A91A0;line-height:1.2;min-width:0;}',
      '.vp-paso i{flex:none;width:17px;height:17px;border-radius:50%;background:#D8DBE3;color:#fff;',
      'font-style:normal;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;}',
      '.vp-paso.on{background:#EAF9F0;color:#0B7A38;}',
      '.vp-paso.on i{background:#16C15B;}',
      '.vp-paso.ok{background:#F4F5F8;color:#5A6376;}',
      '.vp-paso.ok i{background:#9ADFBB;}',

      /* El cobro de la etapa final */
      '.vp-cobro{margin-top:12px;padding:12px 13px;border:1px solid #FFE1A8;border-radius:12px;background:#FFFBF2;}',
      '.vp-cobro.ok{border-color:#9ADFBB;background:#F3FCF7;}',
      '.vp-cobro.mal{border-color:#F3B9B9;background:#FDF3F3;}',
      '.vp-cobro-cab{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.vp-cobro-cab b{font-size:13.5px;font-weight:800;color:var(--ink,#16213E);}',
      '.vp-cobro-cab svg{width:17px;height:17px;}',
      '.vp-cobro-pill{margin-left:auto;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;',
      'background:#fff;border:1px solid currentColor;color:#8A6412;}',
      '.vp-cobro.ok .vp-cobro-pill{color:#0B7A38;}',
      '.vp-cobro.mal .vp-cobro-pill{color:#A03030;}',
      '.vp-cobro-monto{margin-top:7px;font-size:24px;font-weight:800;color:var(--ink,#16213E);',
      'font-variant-numeric:tabular-nums;}',
      '.vp-cobro-monto small{display:block;font-size:11.5px;font-weight:700;color:var(--ink-soft,#6B7487);',
      'margin-top:1px;letter-spacing:.1px;}',

      /* Avisos */
      '.vp-aviso{display:flex;gap:9px;padding:11px 12px;border-radius:11px;margin-bottom:12px;',
      'font-size:12.5px;font-weight:600;line-height:1.45;}',
      '.vp-aviso svg{flex:none;width:18px;height:18px;margin-top:1px;}',
      '.vp-aviso b{display:block;font-weight:800;margin-bottom:2px;}',
      '.vp-aviso.falta{background:#FFFBF2;border:1px solid #FFE1A8;color:#7A5A10;}',
      '.vp-aviso.ok{background:#F3FCF7;border:1px solid #9ADFBB;color:#0B6030;}',
      '.vp-num{display:inline-flex;min-width:19px;height:19px;padding:0 5px;border-radius:999px;',
      'background:#16C15B;color:#fff;font-size:11.5px;font-weight:800;align-items:center;justify-content:center;}',

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
      /* La lista de repartidores dentro de la ficha */
      '.vp-reps-aqui{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border,#E8E9EF);}',
      '.vp-reps-t{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;',
      'color:var(--ink-soft,#6B7487);margin-bottom:8px;}',
      '.vp-rep-env{flex:none;padding:6px 11px;border-radius:999px;background:#16C15B;color:#fff;',
      'font-size:12px;font-weight:800;}',

      /* Las tres secciones de Pedidos entrantes */
      '.vp-secs{display:flex;flex-direction:column;gap:18px;}',
      '.vp-sec-cab{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:9px;}',
      '.vp-sec-cab b{font-size:15px;font-weight:800;color:var(--ink,#16213E);}',
      '.vp-sec-cab small{flex:1 1 100%;font-size:12px;font-weight:600;color:var(--ink-soft,#6B7487);}',
      '.vp-sec-n{min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:#16C15B;',
      'color:#fff;font-size:12px;font-weight:800;display:inline-flex;align-items:center;',
      'justify-content:center;}',
      '.vp-sec-pendientes .vp-sec-n{background:#F3A712;}',
      '.vp-sec-entrega .vp-sec-n{background:#1D5FA8;}',
      '.vp-sec-vacia{margin:0;padding:14px 12px;border:1px dashed var(--border,#E8E9EF);',
      'border-radius:12px;font-size:12.5px;font-weight:600;color:var(--ink-soft,#9AA3B5);',
      'text-align:center;}',
      '.vp-sec.vacia .vp-sec-cab b{color:var(--ink-soft,#6B7487);}',
      '.vp-diag{padding:11px 12px;border:1px solid var(--border,#E8E9EF);border-radius:11px;',
      'margin-bottom:9px;}',
      '.vp-diag b{display:block;font-size:13.5px;font-weight:800;color:var(--ink,#16213E);}',
      '.vp-diag-v{display:inline-block;margin:4px 0 5px;padding:3px 9px;border-radius:999px;',
      'background:#EAF9F0;color:#0B7A38;font-size:12.5px;font-weight:800;}',
      '.vp-diag small{display:block;font-size:12px;font-weight:600;color:var(--ink-soft,#6B7487);',
      'line-height:1.45;}',
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
          cargar().then(function (hubo) {
            if (hubo) repintarBloque();
            /* Si este pedido del Menú Digital no tiene seguimiento, se
               rescata solo. Antes esto era el botón "Buscar seguimiento". */
            var o = null; try { o = MDI.get(id); } catch (e) {}
            if (o && (!o.source || o.source === 'menu') && !dePedido(o)) rescatar(o);
          });
          cargarRepartidores();
          escuchar();
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

    /* ---- Los pedidos entrantes, en TRES SECCIONES ----
       Se envuelve la sección de siempre y se reparten los pedidos
       activos en los tres procesos, usando el estado REAL del
       seguimiento. La tarjeta de cada pedido es la misma de siempre:
       no se rediseñó ninguna. */
    if (typeof window.mdiSectionHTML === 'function') {
      var _sec = window.mdiSectionHTML;
      window.mdiSectionHTML = function () {
        var html = _sec.apply(this, arguments);
        try {
          if (!premium()) return html;
          /* Si el seguimiento está viejo, se refresca y se vuelve a
             pintar cuando llegue. Sin esperar a nada. */
          if (nube()) {
            cargar().then(function (hubo) { if (hubo) repintarLista(); });
            cargarRepartidores();
            escuchar();
          }
          var sec = seccionesHTML();
          if (!sec) return html;
          /* Se sustituye SOLO el bloque de tarjetas, dejando intactos
             el título, el aviso de la nube y el botón "Todos". Si la
             marca no está donde se espera, se devuelve el original: más
             vale la lista de siempre que una pantalla rota. */
          var fin = html.indexOf('<button type="button" class="mdi-todos-btn');
          if (fin < 0) return html;
          var i = html.indexOf('<div class="mdi-list">');
          if (i < 0 || i > fin) i = html.indexOf('<div class="mdi-empty">');
          if (i < 0 || i > fin) return html;
          return html.slice(0, i) + sec + html.slice(fin);
        } catch (e) { return html; }
      };
    }

    /* ---- El menú publicado: la verdad manda ----
       Dos reglas que se aplican aquí, en el último momento antes de
       publicar, para que no se le pueda ofrecer al cliente algo que
       todavía no funciona:

         · Servicio a domicilio: solo si hay al menos un repartidor
           aceptado y vinculado.
         · Tarjeta: solo si Mercado Pago está enlazado Y el negocio la
           activó. Si no, la opción no se publica.

       Se hace envolviendo la función original, sin tocarla. */
    if (typeof window.mdPublicSnapshot === 'function') {
      var _snap = window.mdPublicSnapshot;
      window.mdPublicSnapshot = function () {
        var s = _snap.apply(this, arguments);
        try {
          if (s && s.cfg) {
            if (s.cfg.delivery && s.cfg.delivery.on === true && repsAceptados() < 1) {
              s.cfg.delivery = { on: false, lat: null, lng: null };
              s.cfg.domicilio_sin_repartidor = true;
            }
            var cc = cobrosCache();
            if (s.cfg.payments) {
              s.cfg.payments.card = !!(cc.tarjeta && cc.mp);
            }
          }
        } catch (e) {}
        return s;
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
          if (!s) return;
          /* El motivo del rechazo o la cancelación viaja con el estado:
             es lo que el cliente va a leer en su pantalla. */
          var motivo = '';
          if (o && estado === 'rechazado') {
            motivo = [o.rejectReason || '', o.rejectNote || ''].filter(Boolean).join(' · ');
          } else if (o && estado === 'cancelado') {
            motivo = o.cancelReason || o.rejectNote || '';
          }
          if (s.estado === estado && !motivo) return;
          rpc('vp_pedido_estado', {
            p_pedido_id: s.id, p_estado: estado, p_motivo: motivo.slice(0, 300)
          })
            .then(function (r) {
              if (r && r.ok) { s.estado = r.estado || estado; repintarBloque(); repintarLista(); }
            })
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
    if (P.arrancado) return;
    P.arrancado = true;
    estilos();
    if (!engancha()) {
      var n = 0;
      var t = setInterval(function () { if (engancha() || ++n > 240) clearInterval(t); }, 500);
    }
    /* El primer dato de repartidores: lo necesita el Menú Digital para
       saber si ya puede ofrecer domicilio. */
    var k = 0;
    var t2 = setInterval(function () {
      if (nube()) { clearInterval(t2); cargarRepartidores(true); return; }
      if (++k > 120) clearInterval(t2);
    }, 1000);
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
    cobroManual: cobroManual,
    cobroManualOk: cobroManualOk,
    estado: cambiarEstado,
    elegirRepartidor: elegirRepartidor,
    asignar: asignar,
    verSeguimiento: verSeguimiento,
    excepcional: excepcional,
    excepcionalOk: excepcionalOk,
    nuevoCodigo: nuevoCodigo,
    revocarCodigo: revocarCodigo,
    copiarCodigo: copiarCodigo,
    resolver: resolver,
    desvincular: desvincular,
    sincronizar: sincronizar,
    reparar: reparar,
    diagnostico: diagnostico,
    recargar: function () { return cargar(true); },

    /* Lo que usa la configuración de "Servicio a domicilio" del menú */
    repartidoresHTML: repartidoresHTML,
    refrescarRepartidores: function () { return cargarRepartidores(true).then(repintarPanel); },
    hayRepartidores: function () { return repsAceptados() > 0; },
    cuantosRepartidores: repsAceptados,
    tarjetaDisponible: function () { var c = cobrosCache(); return !!(c.tarjeta && c.mp); },

    _estado: P
  };
})();
