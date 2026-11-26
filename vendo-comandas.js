'use strict';

/* =========================================================
   COMANDAS (Caja · Mesero · Cocina)

   Cómo funciona, como en un restaurante:
   1. MESERO abre una mesa y toma el pedido con el catálogo. Cada vez que
      manda productos se crea una COMANDA (ronda) que llega a cocina, y lo
      mandado se suma a la CUENTA de la mesa.
   2. COCINA ve las comandas en cuadritos (como los pedidos del Menú
      Digital). Al abrir una ve cada producto con su foto, cantidad y nota.
      La pasa a "Preparando" y luego a "Lista".
   3. El MESERO recibe el aviso de que está lista, la sirve y la marca como
      entregada. Cuando el cliente la pide, toca "Pedir la cuenta".
   4. CAJA ve todas las mesas con su total y las que pidieron la cuenta.
      Abre la cuenta, la revisa y la cobra. Al cobrar, la mesa queda libre.

   Datos:
   - Cuentas de mesa: las mismas del plano de mesas (DB.getTableOrders),
     con un campo extra "cm" (mesero, rondas, cuenta pedida).
   - Comandas: 'mesa_comandas'.
   - Las dos se comparten EN VIVO entre los aparatos del negocio con la
     tabla vp_comandas_sync de Supabase (Realtime).
========================================================= */
window.VPComandas = (() => {
  const KEY = 'mesa_comandas';
  const T = 'vp_comandas_sync';
  const AREAS = {
    caja:   { name:'Caja',     who:'Cajeros',   one:'cajero',   sub:'Cobran las cuentas de las mesas' },
    mesero: { name:'Mesero',   who:'Meseros',   one:'mesero',   sub:'Toman los pedidos y los mandan a cocina' },
    cocina: { name:'Cocinero', who:'Cocineros', one:'cocinero', sub:'Preparan las comandas que llegan' }
  };
  const ORDER = ['caja', 'mesero', 'cocina'];
  const ESTADOS = {
    nuevo:      { label:'Nueva',      cls:'nuevo' },
    preparando: { label:'Cocinando', cls:'prep' },
    listo:      { label:'Lista',      cls:'ok' },
    entregado:  { label:'Entregada',  cls:'cancel' },
    cancelado:  { label:'Cancelada',  cls:'no' }
  };

  /* Estado de pantallas */
  const st = { screen:'home', area:null, form:null, permsDraft:null, kf:'activas', mtab:'mesas', open:null };

  /* ---------- Activadas o no (apagadas al inicio; se encienden con Premium) ---------- */
  const ON_KEY = 'mesa_cm_activo';
  function activas() { try { return Store.get(ON_KEY, false) === true; } catch (e) { return false; } }
  function premiumOk() { try { return !!(window.VPPremium && VPPremium.activo && VPPremium.activo()); } catch (e) { return false; } }
  function activar(v) {
    if (!requireOwner('Solo el Dueño puede activar las comandas')) { render(); return; }
    if (v && !premiumOk()) {
      render();
      if (window.VPPremium && VPPremium.abrir) VPPremium.abrir('comandas'); else toast('Las comandas son de Premium');
      return;
    }
    Store.set(ON_KEY, !!v);
    render();
    toast(v ? 'Comandas activadas' : 'Comandas desactivadas', { variant:v ? 'toast-success' : '', icon:icon(v ? 'check' : 'close'),
      subtitle:v ? 'Tu equipo ya puede usar Caja, Mesero y Cocinero.' : 'Tu equipo entra al POS normal.' });
  }

  /* ---------- Quién está usando la app ---------- */
  function myArea() {
    try {
      if (!activas()) return null;
      if (!multiUser()) return null;
      const u = activeUser();
      if (!u || u.role === 'dueno') return null;
      /* Caja usa el punto de venta normal (Nueva venta, carrito y cobrar):
         solo Mesero y Cocinero tienen pantalla propia. */
      return (u.area === 'mesero' || u.area === 'cocina') ? u.area : null;
    } catch (e) { return null; }
  }
  const esMesero = () => myArea() === 'mesero';
  const esCocina = () => myArea() === 'cocina';
  const esCajero = () => myArea() === 'caja';
  function puedeAdministrar() { try { return isOwner(); } catch (e) { return false; } }
  const me = () => { try { return activeUser(); } catch (e) { return null; } };

  /* Se llama al inicio de cada render(): cada quien ve solo su sección */
  let vistaPrevia = null;
  function guard() {
    if (typeof EXTRA_VIEWS !== 'undefined' && EXTRA_VIEWS.comandas !== view) EXTRA_VIEWS.comandas = view;
    if (typeof EXTRA_VIEWS !== 'undefined' && EXTRA_VIEWS.portada !== portadaVista) EXTRA_VIEWS.portada = portadaVista;
    const area = myArea();
    if (area === 'mesero') {
      if (!(currentView === 'sale' && checkout.floorTableId)) currentView = 'comandas';
    } else if (area === 'cocina' || area === 'caja') {
      currentView = 'comandas';
    } else if (currentView === 'comandas' && !puedeAdministrar()) {
      currentView = 'sale';
    }
    /* Al llegar a Comandas desde otra sección (menú, barra, «Más»…) siempre se
       empieza en el inicio de Comandas, no dentro del área que se dejó abierta. */
    if (currentView === 'comandas' && vistaPrevia !== 'comandas' && !area) {
      st.screen = 'home'; st.area = null; st.form = null; st.permsDraft = null;
      cerrarFull();
    }
    vistaPrevia = currentView;
    const b = document.body.classList;
    b.toggle('cm-solo', !!area);
    b.toggle('cm-mesero', area === 'mesero');
    b.toggle('cm-admin', puedeAdministrar());
    Sync.tick();
    requestAnimationFrame(ajustarPlano);
  }

  /* ---------- Mesero · pestaña Mesas: una sola pantalla, sin scroll ----------
     El plano se estira para llenar justo lo que queda de pantalla en cada
     celular (debajo de las pestañas y arriba de la leyenda). En Avisos sí hay scroll. */
  function ajustarPlano() {
    const fijo = currentView === 'comandas' && (esMesero() || esCocina());
    document.documentElement.classList.toggle('cm-fija', fijo);
    if (!fijo) return;
    if (window.scrollY) window.scrollTo(0, 0);
    const lista = document.querySelector('#view .cm-av-scroll');
    if (lista) {
      const r = lista.getBoundingClientRect();
      const escala = lista.offsetHeight ? r.height / lista.offsetHeight : 1;
      lista.style.height = Math.max(160, Math.floor((window.innerHeight - r.top - 12 - safeB()) / (escala || 1))) + 'px';
      return;
    }
    const floor = document.querySelector('#view .cm-floor');
    if (!floor) return;
    const r = floor.getBoundingClientRect();
    const escala = floor.offsetHeight ? r.height / floor.offsetHeight : 1;     /* la app usa zoom en PC */
    const ley = floor.nextElementSibling;
    const leyH = ley ? ley.getBoundingClientRect().height + 10 : 0;
    const abajo = safeB();
    const libre = window.innerHeight - r.top - leyH - 14 - abajo;
    floor.style.height = Math.max(220, Math.floor(libre / (escala || 1))) + 'px';
  }
  /* Espacio de la rayita inferior del iPhone */
  function safeB() {
    let pr = document.getElementById('cmSafeB');
    if (!pr) { pr = document.createElement('div'); pr.id = 'cmSafeB'; pr.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;'; document.body.appendChild(pr); }
    return pr.getBoundingClientRect().height || 0;
  }
  window.addEventListener('resize', () => requestAnimationFrame(ajustarPlano));
  window.addEventListener('orientationchange', () => setTimeout(ajustarPlano, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => requestAnimationFrame(ajustarPlano));

  function abrir() {
    st.screen = 'home'; st.area = null; st.form = null; st.permsDraft = null;
    goTo('comandas');
  }
  function show(screen) { st.screen = screen; goTo('comandas'); }

  /* ---------- Datos ---------- */
  const tickets = () => Store.list(KEY);
  function saveTickets(list) {
    /* Se guardan las activas y las terminadas de los últimos 3 días */
    const lim = Date.now() - 3 * 86400000;
    return Store.set(KEY, list.filter(t => t && (t.status === 'nuevo' || t.status === 'preparando' || t.status === 'listo' || new Date(t.at).getTime() > lim)));
  }
  const ticketsOf = orderId => tickets().filter(t => t.orderId === orderId && t.status !== 'cancelado').sort((a, b) => new Date(a.at) - new Date(b.at));
  const orderById = id => DB.getTableOrders().find(o => o.id === id) || null;
  const tableName = o => (o && (o.checkout && o.checkout.table)) || (o && o.name) || 'Mesa';
  const nowIso = () => new Date().toISOString();
  const fmtN = n => (Math.round(Number(n) * 100) / 100).toString();
  const mins = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  function ago(iso) {
    const m = mins(iso);
    if (m < 1) return 'justo ahora';
    if (m < 60) return 'hace ' + m + ' min';
    const h = Math.floor(m / 60);
    return 'hace ' + h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }
  /* Lo que de verdad se va a servir: lo pedido menos lo que no hubo */
  const efect = i => Math.max(0, Math.round(((Number(i.qty) || 0) - (Number(i.falta) || 0) - (Number(i.cancelado) || 0)) * 1000) / 1000);
  const r3n = n => Math.round(n * 1000) / 1000;
  const unitsOf = items => items.reduce((a, i) => { const q = efect(i); return a + (q <= 0 ? 0 : (Number.isInteger(q) ? q : 1)); }, 0);
  /* Texto de un producto en rondas e historial, con lo que no hubo */
  const itemTxt = i => {
    const q = efect(i);
    return `<span class="${q <= 0 ? 'cm-x' : ''}"><b>${fmtN(q > 0 ? q : i.qty)}×</b> ${escapeHtml(i.name)}${i.size ? ' · ' + escapeHtml(i.size) : ''}${i.note ? ` <i>(${escapeHtml(i.note)})</i>` : ''}${i.falta ? ` <em class="cm-nohay-tag">No hubo ${fmtN(i.falta)}</em>` : ''}${i.cancelado ? ` <em class="cm-nohay-tag">Ya no lo quiso ${fmtN(i.cancelado)}</em>` : ''}</span>`;
  };

  /* ---------- Agotados del día (los marca cocina, los ven todos) ---------- */
  const AKEY = 'mesa_cm_agotados';
  const hoyKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const agotadosHoy = () => Store.list(AKEY).filter(a => a && a.day === hoyKey());
  function agotado(pid) { try { return !!pid && agotadosHoy().some(a => a.productId === pid); } catch (e) { return false; } }
  function saveAgotados(list) { return Store.set(AKEY, list.filter(a => a && a.day === hoyKey())); }
  function marcarAgotado(pid, name) {
    if (!pid || agotado(pid)) return;
    const list = agotadosHoy();
    list.push({ id:'ag-' + pid + '-' + hoyKey(), productId:pid, name:name || ((findProduct(pid) || {}).name) || 'Producto', day:hoyKey(), at:nowIso(), by:meName() });
    saveAgotados(list);
  }
  function reponer(pid) {
    const a = agotadosHoy().find(x => x.productId === pid);
    saveAgotados(agotadosHoy().filter(x => x.productId !== pid));
    render();
    toast('Ya se puede pedir otra vez', { variant:'toast-success', icon:icon('check'), subtitle:a ? a.name : '' });
  }
  /* En el catálogo: un agotado no se puede agregar */
  function bloqueaAgotado(pid) {
    if (!agotado(pid)) return false;
    const p = findProduct(pid);
    vibrate([18, 60, 18]);
    toast('Se acabó: ' + (p ? p.name : 'este producto'), { icon:icon('alert'), variant:'toast-danger toast-top', subtitle:'Cocina lo marcó como agotado por hoy.' });
    return true;
  }
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
  const thumb = productId => { const p = productId ? findProduct(productId) : null; return p && p.image ? `<img src="${window.vpThumb ? vpThumb(p.image) : p.image}" alt="" decoding="async">` : icon('plate'); };

  /* Avisos con sonido (cocina: comanda nueva · mesero: comanda lista) */
  function beep() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      const c = beep.c || (beep.c = new C());
      if (c.state === 'suspended') c.resume();
      [0, 0.22].forEach(d => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, c.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.3, c.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d + 0.18);
        o.connect(g); g.connect(c.destination);
        o.start(c.currentTime + d); o.stop(c.currentTime + d + 0.2);
      });
    } catch (e) {}
  }

  /* ---------- Mantener presionado para confirmar ----------
     Los botones que cambian algo importante se confirman dejando el
     dedo ~0.7 s: se llena una barrita. Un toque rápido no hace nada
     (solo enseña "Mantén presionado"). */
  const HOLD_MS = 700;
  function holdBtn(cls, html, accion, args) {
    return `<button type="button" class="btn xl block cm-hold ${cls}" data-hold="${accion}" data-args="${escapeHtml(JSON.stringify(args || []))}">
      <span class="cm-hold-fill" aria-hidden="true"></span>
      <span class="cm-hold-in">${html}</span>
      <small class="cm-hold-tip">Mantén presionado</small>
    </button>`;
  }
  (function () {
    let h = null;
    const stop = done => {
      if (!h) return;
      clearTimeout(h.t);
      h.b.classList.remove('holding');
      if (!done && Date.now() - h.at < HOLD_MS && !h.b.querySelector('.cm-hold-tip')) toast('Mantén presionado el botón', { icon:icon('clock'), duration:1600 });
      if (!done && Date.now() - h.at < HOLD_MS) { h.b.classList.add('cm-hold-nudge'); setTimeout(() => h && h.b && h.b.classList.remove('cm-hold-nudge'), 600); vibrate(8); }
      h = null;
    };
    document.addEventListener('pointerdown', e => {
      const b = e.target.closest && e.target.closest('[data-hold]');
      if (!b || b.disabled || (e.button != null && e.button !== 0)) return;
      stop(true);
      b.classList.remove('cm-hold-nudge');
      void b.offsetWidth;
      b.classList.add('holding');
      const btn = b;
      h = { b, at:Date.now(), t:setTimeout(() => {
        h = null;
        btn.classList.remove('holding');
        btn.classList.add('cm-hold-done');
        vibrate([20, 40, 20]);
        let args = [];
        try { args = JSON.parse(btn.dataset.args || '[]'); } catch (x) {}
        const fn = VPComandas[btn.dataset.hold];
        if (typeof fn === 'function') fn.apply(null, args);
      }, HOLD_MS) };
    }, true);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, e => {
      if (!h) return;
      if (ev === 'pointerleave' && e.target !== h.b) return;
      stop(false);
    }, true));
    document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('[data-hold]')) e.preventDefault(); }, true);
  })();

  /* ---------- Ilustraciones de las 3 áreas ---------- */
  const ART = {
    caja: `<svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="100" cy="72" r="60" fill="#E9F8EF"/>
      <path d="M70 104c0-17 13-29 30-29s30 12 30 29z" fill="#16213E"/>
      <circle cx="100" cy="52" r="15" fill="#F2C9A0"/>
      <path d="M85 50c0-10 7-16 15-16s15 6 15 16c-4-5-9-7-15-7s-11 2-15 7z" fill="#16213E"/>
      <rect x="84" y="62" width="34" height="24" rx="4" fill="#fff" stroke="#16213E" stroke-width="3"/>
      <path d="M90 70h22M90 77h14" stroke="#19C15F" stroke-width="3" stroke-linecap="round"/>
      <rect x="97" y="86" width="8" height="8" fill="#16213E"/>
      <rect x="54" y="92" width="92" height="36" rx="8" fill="#16213E"/>
      <rect x="64" y="99" width="10" height="7" rx="2" fill="#19C15F"/><rect x="78" y="99" width="10" height="7" rx="2" fill="#fff"/><rect x="92" y="99" width="10" height="7" rx="2" fill="#fff"/>
      <rect x="64" y="110" width="10" height="7" rx="2" fill="#fff"/><rect x="78" y="110" width="10" height="7" rx="2" fill="#fff"/><rect x="92" y="110" width="10" height="7" rx="2" fill="#19C15F"/>
      <rect x="110" y="99" width="27" height="18" rx="3" fill="#2B3A5E"/>
      <path d="M118 108h11" stroke="#19C15F" stroke-width="3" stroke-linecap="round"/>
      <path d="M40 128h120" stroke="#16213E" stroke-width="3" stroke-linecap="round"/>
    </svg>`,
    mesero: `<svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="100" cy="72" r="60" fill="#E9F8EF"/>
      <path d="M64 132c0-24 15-41 34-41s34 17 34 41z" fill="#16213E"/>
      <path d="M88 92l10 24 10-24z" fill="#fff"/>
      <path d="M91 94l7 4-7 4zM105 94l-7 4 7 4z" fill="#19C15F"/>
      <path d="M126 106l20-34" stroke="#16213E" stroke-width="11" stroke-linecap="round"/>
      <circle cx="148" cy="68" r="7" fill="#F2C9A0"/>
      <ellipse cx="148" cy="61" rx="32" ry="5" fill="#C9CFDB"/>
      <path d="M126 59a22 22 0 0 1 44 0z" fill="#EEF1F6" stroke="#16213E" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="148" cy="35" r="3.5" fill="#16213E"/>
      <circle cx="98" cy="68" r="16" fill="#F2C9A0"/>
      <path d="M82 66c0-11 7-18 16-18s16 7 16 18c-4-6-9-8-16-8s-12 2-16 8z" fill="#16213E"/>
      <path d="M93 76c3 2 7 2 10 0" stroke="#16213E" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`,
    cocina: `<svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="100" cy="72" r="60" fill="#E9F8EF"/>
      <path d="M66 132c0-24 15-41 34-41s34 17 34 41z" fill="#fff" stroke="#D5DAE5" stroke-width="2.5"/>
      <path d="M92 92l8 12 8-12z" fill="#19C15F"/>
      <circle cx="100" cy="114" r="2.6" fill="#16213E"/><circle cx="100" cy="124" r="2.6" fill="#16213E"/>
      <circle cx="100" cy="72" r="16" fill="#F2C9A0"/>
      <path d="M95 80c3 2 7 2 10 0" stroke="#16213E" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="87" cy="40" r="12" fill="#fff" stroke="#D5DAE5" stroke-width="2.5"/>
      <circle cx="113" cy="40" r="12" fill="#fff" stroke="#D5DAE5" stroke-width="2.5"/>
      <circle cx="100" cy="33" r="14" fill="#fff" stroke="#D5DAE5" stroke-width="2.5"/>
      <rect x="85" y="44" width="30" height="13" rx="3" fill="#fff" stroke="#D5DAE5" stroke-width="2.5"/>
      <path d="M86 46h28" stroke="#fff" stroke-width="4"/>
      <ellipse cx="50" cy="104" rx="22" ry="7" fill="#16213E"/>
      <path d="M70 102l18-6" stroke="#16213E" stroke-width="5" stroke-linecap="round"/>
      <path d="M42 90c-4-5 4-8 0-14M51 88c-4-5 4-8 0-14M60 90c-4-5 4-8 0-14" stroke="#19C15F" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  };

  /* =========================================================
     DUEÑO: áreas y personas
  ========================================================= */
  const gente = area => DB.getUsers().filter(u => u.role !== 'dueno' && u.area === area);
  const disponibles = area => DB.getUsers().filter(u => u.role !== 'dueno' && u.area !== area);
  const enTurno = u => DB.getShifts().some(s => !s.end && s.userId === u.id);
  function avatar(u) {
    const ph = userPhoto(u);
    return `<span class="acc-ico ${u.role === 'admin' ? 'blue' : 'green'} ${ph ? 'has-photo' : ''}">${ph ? `<img src="${ph}" alt="">` : `<span class="ini">${userInitials(u)}</span>`}</span>`;
  }

  /* Fotos de cada área: recorte horizontal en celular, vertical en tablet/PC */
  const ALT_AREA = { caja:'Cajero cobrando en VendoPlus', mesero:'Mesera tomando pedidos en VendoPlus', cocina:'Cocinero viendo las comandas en VendoPlus' };
  function fotoArea(id) {
    return `<picture>
      <source media="(max-width:699px)" srcset="img/comandas-${id}-cel.webp?v=2">
      <img class="cm-fit-img" src="img/comandas-${id}-pc.webp?v=2" alt="${ALT_AREA[id] || ''}" loading="lazy" decoding="async" draggable="false">
    </picture>`;
  }
  /* Sin Premium: presentación de Comandas (no es un anuncio que estorba: es la portada de la sección) */
  /* Portadas de funciones Premium (misma pantalla para todas) */
  const PORTADAS = {
    comandas: { nombre:'Comandas', abrir:'comandas', h:'img/promo-comandas-h.webp?v=1', v:'img/promo-comandas-v.webp?v=1',
      alt:'VendoPlus Premium: coordina caja, mesas y cocina desde el celular',
      titulo:'Comandas viene incluido en Premium', sub:'Mesero, cocina y caja conectados en tiempo real.' },
    menu: { nombre:'Menú Digital', abrir:'menu', h:'img/promo-menu-h.webp?v=2', v:'img/promo-menu-v.webp?v=2',
      alt:'VendoPlus Premium: tu menú en internet, recibe pedidos desde ahí',
      titulo:'El Menú Digital viene incluido en Premium', sub:'Tus clientes ven tu menú y te mandan su pedido.' },
    stripe: { nombre:'Stripe', abrir:null, h:'img/promo-stripe-h.webp?v=1', v:'img/promo-stripe-v.webp?v=1',
      alt:'VendoPlus Premium: cobra sin contacto con NFC y deja que tus clientes paguen con tarjeta en el menú digital',
      titulo:'Los cobros con Stripe vienen en Premium', sub:'Cobra con NFC y recibe pagos con tarjeta en tu menú digital.' }
  };
  function promoHTML(o) {
    o = o || PORTADAS.comandas;
    const arg = o.abrir ? `'${o.abrir}'` : 'null';
    const go = `window.VPPremium && VPPremium.abrir ? VPPremium.abrir(${arg}) : toast('Esta función es de Premium')`;
    const x = o.cerrar ? `<button type="button" class="cm-promo-x" onclick="goTo('${o.cerrar}')" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : '';
    return `<section class="cm-promo cm-fit" data-max="2000" data-min="200">
      ${x}
      <button type="button" class="cm-promo-img" onclick="${go}" aria-label="Ver Premium">
        <picture>
          <source media="(max-width:699px)" srcset="${o.v}">
          <img class="cm-fit-img" src="${o.h}" alt="${o.alt}" decoding="async" fetchpriority="high" draggable="false">
        </picture>
      </button>
      <div class="cm-promo-foot">
        <span class="cm-promo-txt">
          <b>${o.titulo}</b>
          <small>${o.sub}</small>
        </span>
        <button type="button" class="btn primary cm-promo-btn" onclick="${go}">Activar Premium</button>
      </div>
    </section>`;
  }
  /* Pantalla "portada" para Menú Digital y Stripe sin Premium */
  let portadaClave = 'menu';
  function portadaVista() {
    const o = PORTADAS[portadaClave] || PORTADAS.menu;
    fitSoon();
    const logo = portadaClave === 'stripe' ? `<span class="sth-logo" aria-hidden="true">${icon('stripeLogo')}</span>` : '';
    return `<h1 class="page-title cm-promo-title${logo ? ' sth-titulo' : ''}">${logo}${o.nombre}</h1>${promoHTML(o)}`;
  }
  /* HTML de la portada para usarlo dentro de otra sección (Menú Digital sin Premium) */
  function portadaHTML(clave) {
    if (PORTADAS[clave]) portadaClave = clave;
    return portadaVista();
  }
  function portada(clave) {
    if (!PORTADAS[clave]) return false;
    portadaClave = clave;
    if (typeof EXTRA_VIEWS !== 'undefined') EXTRA_VIEWS.portada = portadaVista;
    goTo('portada');
    return true;
  }

  /* Ajuste a la pantalla: se mide si la página quedó con scroll y se
     achican las fotos (variable --cm-h) hasta que todo quepa. Se mide lo que
     de verdad pasa en pantalla, así funciona igual en PC, Android y iPhone. */
  function fitCm() {
    const root = document.querySelector('#view .cm-fit');
    if (!root) return;
    if (root.dataset.pc && matchMedia('(max-width:699px)').matches) { root.style.removeProperty('--cm-h'); return; }
    const ref = root.querySelector('.cm-fit-img');
    if (!ref) return;
    const max = +root.dataset.max || 2000, min = +root.dataset.min || 120;
    if (root.classList.contains('cm-promo')) { fitPromo(root, ref, max, min); return; }
    root.style.setProperty('--cm-h', max + 'px');
    const se = document.scrollingElement || document.documentElement;
    let h = max;
    for (let i = 0; i < 6; i++) {
      const over = se.scrollHeight - window.innerHeight;
      if (over <= 0) break;
      const k = (ref.getBoundingClientRect().height / (ref.offsetHeight || 1)) || 1;
      const real = ref.offsetHeight || h;               /* alto que de verdad tiene la foto */
      const n = Math.max(min, Math.min(h, real) - over / k - 3);
      if (n >= Math.min(h, real) - 0.5) break;
      h = n;
      root.style.setProperty('--cm-h', Math.floor(h) + 'px');
    }
    if (h < max) try { window.scrollTo(0, 0); } catch (e) {}
  }
  /* Portada sin Premium: la foto crece hasta tocar el menú de abajo (o el
     borde de la pantalla) y a lo ancho hasta el margen, lo que pase primero.
     No se calcula con fórmulas (la app usa zoom y cada navegador lo mide
     distinto): se prueba con dos tamaños, se mide en pantalla cuánto
     crece y se pone el tamaño exacto. */
  function fitPromo(root, ref, max, min) {
    const cel = matchMedia('(max-width:699px)').matches;
    root.style.removeProperty('--cm-ar');
    let piso = window.innerHeight;
    document.querySelectorAll('.bottomnav, .cartbar').forEach(b => {
      const br = b.getBoundingClientRect();
      if (br.height && br.height < piso / 2 && br.top > piso / 2) piso = Math.min(piso, br.top);
    });
    const meta = piso - (cel ? 12 : 20);
    const set = h => root.style.setProperty('--cm-h', Math.round(h) + 'px');
    const abajo = () => root.getBoundingClientRect().bottom;
    /* Se va ajustando con medidas reales (el texto de abajo cambia de
       renglones según el ancho, por eso se repite hasta quedar exacto) */
    let h0 = 200; set(h0); let b0 = abajo();
    let h = 300; set(h); let b = abajo();
    let c = 1;
    for (let i = 0; i < 8; i++) {
      c = (b - b0) / (h - h0);
      if (!(c > 0.01)) { if (b < meta) { h0 = h; b0 = b; h = Math.min(max, h * 1.6); set(h); b = abajo(); continue; } break; }
      const n = Math.max(min, Math.min(max, h + (meta - b) / c));
      if (Math.abs(n - h) < 1) break;
      h0 = h; b0 = b; h = n; set(h); b = abajo();
      if (Math.abs(b - meta) < 1.5) break;
    }
    for (let i = 0; i < 6 && abajo() > meta && h > min; i++) { h = Math.max(min, h - Math.max(2, (abajo() - meta) / (c > 0.01 ? c : 1))); set(h); }
    /* Si ya llegó al ancho completo y sobra alto (celular alto), la foto crece a lo alto */
    const sobra = meta - abajo();
    if (cel && sobra > 4) {
      const r = ref.getBoundingClientRect();
      if (r.width && r.height) root.style.setProperty('--cm-ar', String(Math.max(0.6, r.width / (r.height + sobra))));
    }
    /* Seguro final: si algo quedó fuera de la pantalla, se achica lo que falte */
    if (abajo() > meta + 1) root.style.removeProperty('--cm-ar');
    /* Último seguro: si la página quedó con scroll (márgenes de la app), se achica eso */
    const se = document.scrollingElement || document.documentElement;
    for (let i = 0; i < 4; i++) {
      const over = se.scrollHeight - window.innerHeight;
      if (over <= 0 || h <= min) break;
      if (root.style.getPropertyValue('--cm-ar')) { root.style.removeProperty('--cm-ar'); continue; }
      h = Math.max(min, h - over / (c > 0.01 ? c : 1) - 1); set(h);
    }
  }
  let fitPuesto = false;
  function fitSoon() {
    /* Se ajusta ANTES de que se pinte (microtarea): aparece ya en su tamaño final */
    queueMicrotask(() => { try { fitCm(); } finally { const r = document.querySelector('#view .cm-fit'); if (r) r.classList.add('cm-fit-ok'); } });
    requestAnimationFrame(() => requestAnimationFrame(fitCm));
    setTimeout(fitCm, 450);   /* otra vez cuando termina la animación de entrada */
    if (!fitPuesto) {
      fitPuesto = true;
      let t = 0;
      addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fitCm, 80); });
    }
  }

  /* "?": guía completa de Comandas a pantalla completa */
  const GUIA = [
    { t:'Antes de empezar', q:'Lo hace el Dueño una sola vez', ico:'key', pasos:[
      'Enciende el interruptor que está al lado de <b>Comandas</b>.',
      'Toca <b>Caja</b>, <b>Mesero</b> o <b>Cocinero</b> y luego <b>Agregar</b> para sumar a cada persona de tu equipo.',
      'Escribe su nombre y, si quieres, un <b>NIP de 4 dígitos</b> para que solo esa persona pueda entrar con su nombre.',
      'La primera vez que agregues a alguien, crea también <b>tu NIP de Dueño</b>: así nadie más entra a tu cuenta.',
      'Cada quien abre VendoPlus en su propio celular o tablet con <b>tu misma cuenta</b>, elige su nombre y escribe su NIP.',
      'Cada persona ve solo su pantalla: el mesero ve las mesas, el cocinero la cocina y el cajero la caja.'
    ]},
    { t:'Mesero', q:'Toma los pedidos y los lleva a la mesa', ico:'users', pasos:[
      'En <b>Mesas</b> toca una mesa libre para abrirla.',
      'Agrega los productos del catálogo. En el carrito, toca un producto para ponerle una <b>nota</b> (por ejemplo «sin cebolla»).',
      'Mantén presionado <b>Mandar a cocina</b>. Se manda como <b>Ronda 1</b> y se suma a la cuenta de la mesa.',
      'Si piden algo más, agrégalo y mándalo otra vez: llega a cocina como <b>Ronda 2</b>, <b>Ronda 3</b>…',
      'Cuando cocina termina, te llega un aviso. Recoge el pedido y mantén presionado <b>Ya lo tengo</b> para marcarlo como entregado.',
      'Si el cliente ya no quiere algo, quítalo y toca <b>Avisar a cocina y quitar</b>: el cocinero recibe el aviso al instante.',
      'Si cocina te avisa que algo <b>se acabó</b>, díselo al cliente y toca <b>Ya le avisé</b>.',
      'Cuando el cliente quiera pagar, mantén presionado <b>Pedir la cuenta</b>: la caja se entera en ese momento.',
      'Si otro mesero atendía la mesa, puedes tocar <b>Tomar esta mesa</b> para seguir tú con ella.'
    ]},
    { t:'Cocinero', q:'Prepara lo que llega de las mesas', ico:'chefHat', pasos:[
      'En <b>Por preparar</b> aparecen las comandas nuevas en cuadritos, con la mesa y la ronda.',
      'Abre una comanda para ver cada producto con su foto, la cantidad y las notas del mesero.',
      'Mantén presionado <b>Empezar a preparar</b> para que el mesero sepa que ya se está cocinando.',
      'Al terminar, mantén presionado <b>Ya terminé de preparar</b>: el mesero recibe el aviso para llevarlo.',
      'Si te equivocaste, toca <b>Deshacer</b> para regresarla a «Preparando».',
      'En <b>Listas sin entregar</b> ves lo que ya terminaste y el mesero todavía no recoge.',
      'Si se acabó un producto, márcalo con <b>No hay</b> y toca <b>Avisar al mesero</b>: queda en <b>Agotados</b> y nadie lo puede volver a pedir.',
      'Cuando vuelva a haber, entra a <b>Agotados</b> y toca <b>Ya hay</b> para que se pueda pedir otra vez.'
    ]},
    { t:'Caja', q:'Cobra las cuentas de las mesas', ico:'cashbox', pasos:[
      'Ves todas las mesas abiertas con su total y cuáles ya <b>pidieron la cuenta</b>.',
      'Abre la cuenta de una mesa para revisar todo lo que se pidió, ronda por ronda.',
      'Toca <b>Cobrar</b> y elige cómo paga el cliente (efectivo, tarjeta, transferencia…).',
      'Al cobrar, la venta queda registrada y la <b>mesa queda libre</b> para los siguientes clientes.',
      'En <b>Nueva venta</b> también puedes mandar a cocina pedidos de mostrador con <b>Mandar a cocina</b>.'
    ]},
    { t:'Consejos', q:'Para que todo salga bien', ico:'alert', pasos:[
      'Los botones importantes se <b>mantienen presionados</b> un momento: así no se mandan por accidente.',
      'Con internet, todo se ve <b>en vivo</b> en los celulares y tablets de tu equipo.',
      'Si se va el internet, cada aparato sigue funcionando y se pone al día cuando regresa la conexión.',
      'Para apagar las comandas, usa el interruptor de arriba: tu equipo vuelve al punto de venta normal.'
    ]}
  ];
  function ayuda() {
    cerrarAyuda();
    const vivo = Sync.online();
    const el = document.createElement('div');
    el.id = 'cmGuia'; el.className = 'cm-guia';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Cómo usar Comandas');
    el.innerHTML = `
      <div class="cm-guia-top"><div class="cm-guia-top-in">
        <button type="button" class="cm-back" onclick="VPComandas.cerrarAyuda()" aria-label="Regresar">${icon('chevronLeft')}</button>
        <h1>Cómo usar Comandas</h1>
      </div></div>
      <div class="cm-guia-scroll"><div class="cm-guia-in">
        <p class="cm-guia-intro">El <b>mesero</b> toma el pedido, la <b>cocina</b> lo prepara y la <b>caja</b> lo cobra. Todo conectado, cada quien desde su celular o tablet.</p>
        <p class="cm-live ${vivo ? 'on' : ''}">${icon(vivo ? 'check' : 'alert')} ${vivo ? 'En vivo: tu equipo ya está conectado.' : 'Sin conexión a la nube: por ahora solo funciona en este aparato.'}</p>
        ${GUIA.map(g => `<section class="cm-guia-sec">
          <div class="cm-guia-h"><span class="cm-guia-ico">${icon(g.ico)}</span><span><b>${g.t}</b><small>${g.q}</small></span></div>
          <ol>${g.pasos.map(x => `<li>${x}</li>`).join('')}</ol>
        </section>`).join('')}
        <button type="button" class="btn primary block cm-guia-ok" onclick="VPComandas.cerrarAyuda()">Entendido</button>
      </div></div>`;
    document.body.appendChild(el);
    document.body.classList.add('cm-guia-abierta');
    requestAnimationFrame(() => el.classList.add('on'));
    try { history.pushState({ cmGuia:1 }, ''); } catch (e) {}
  }
  function cerrarAyuda(desdeAtras) {
    const el = document.getElementById('cmGuia'); if (!el) return;
    el.remove();
    document.body.classList.remove('cm-guia-abierta');
    if (!desdeAtras) { try { if (history.state && history.state.cmGuia) history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', () => { if (document.getElementById('cmGuia')) cerrarAyuda(true); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('cmGuia')) cerrarAyuda(); });

  function homeHTML() {
    const vivo = Sync.online();
    fitSoon();
    if (!premiumOk()) return `<h1 class="page-title cm-promo-title">Comandas</h1>${promoHTML()}`;
    return `
      <div class="sth-tit">
        <h1 class="page-title">Comandas</h1>
        <label class="switch sth-sw" aria-label="${activas() ? 'Desactivar' : 'Activar'} comandas"><input type="checkbox" ${activas() ? 'checked' : ''} onchange="VPComandas.activar(this.checked)"><span class="track"></span></label>
      </div>
      <p class="page-sub">Elige un área para ver y agregar a tu equipo</p>
      <div class="cm-areas cm-fit ${activas() ? '' : 'cm-apagadas'}" data-pc="1" data-max="620" data-min="200">
        ${ORDER.map(id => {
          const n = gente(id).length;
          return `<button type="button" class="cm-area" onclick="VPComandas.area('${id}')">
            <span class="cm-area-art cm-area-foto">${fotoArea(id)}</span>
            <span class="cm-area-foot">
              <span class="cm-area-txt">
                <b>${AREAS[id].name}</b>
                <small>${n ? plural(n, 'persona', 'personas') : 'Sin personas todavía'}</small>
              </span>
              <span class="acc-chev">${icon('chevronRight')}</span>
            </span>
          </button>`;
        }).join('')}
      </div>
      <div class="cm-ayuda-fila"><button type="button" class="cm-ayuda" onclick="VPComandas.ayuda()" aria-label="¿Cómo funcionan las comandas?">?</button></div>`;
  }

  /* Pantalla vacía de cada área (mismo estilo que las demás secciones vacías) */
  const VACIO = {
    caja:   { t:'Aún no tienes cajeros',  d:'Agrégalos para que cobren y registren las ventas.' },
    mesero: { t:'Aún no hay meseros',     d:'Agrégalos para tomar órdenes en las mesas de tus clientes.' },
    cocina: { t:'Aún no hay cocineros',   d:'Agrégalos para que preparen tus órdenes.' }
  };
  function areaHTML() {
    const a = AREAS[st.area];
    const list = gente(st.area);
    return `
      <button class="cm-back" onclick="VPComandas.abrir()">${icon('chevronLeft')} Comandas</button>
      <div class="cm-head">
        <div class="cm-head-txt">
          <h1 class="page-title">${a.name}</h1>
          <p class="page-sub">${a.who} activos · ${a.sub.toLowerCase()}</p>
        </div>
        <div class="cm-add-fila"><button class="btn primary cm-add" onclick="VPComandas.agregar()">${icon('plus')} Agregar</button></div>
      </div>
      ${list.length ? `<div class="acc-list cm-people">
        ${list.map(u => `
          <div class="acc-row cm-person">
            <button type="button" class="cm-person-main" onclick="VPComandas.editar('${u.id}')">
              ${avatar(u)}
              <span class="acc-txt">
                <span class="acc-label">${escapeHtml(u.name)}</span>
                <span class="acc-sub">${roleOf(u.role).name}${enTurno(u) ? ' · <b class="cm-on">En turno</b>' : ''}</span>
              </span>
            </button>
            <button type="button" class="icon-btn cm-del" onclick="VPComandas.quitar('${u.id}')" aria-label="Eliminar a ${escapeHtml(u.name)}">${icon('trash')}</button>
          </div>`).join('')}
      </div>` : `
      <div class="empty-state cm-empty">
        <span class="cm-empty-art"><img src="img/vacio-${st.area}.webp?v=2" alt="" decoding="async" draggable="false"></span>
        <div class="empty-title">${VACIO[st.area].t}</div>
        <div class="empty-text">${VACIO[st.area].d}</div>
      </div>`}`;
  }

  /* =========================================================
     PANTALLA PROPIA para agregar personas a un área
     (Agregar · Nuevo usuario · Permisos). Se abre encima de todo,
     con encabezado y barra de botones fija abajo, como en un POS.
  ========================================================= */
  const FULL = { add:1, form:1, perms:1 };
  const iniciales = u => (typeof userInitials === 'function' ? userInitials(u) : String(u.name || '?').slice(0, 2).toUpperCase());
  function addParts() {
    const a = AREAS[st.area];
    const todos = disponibles(st.area);
    const q = (st.qAdd || '').trim().toLowerCase();
    const list = q ? todos.filter(u => String(u.name).toLowerCase().includes(q)) : todos;
    const premium = usersLimitReached();
    return {
      back: `VPComandas.area('${st.area}')`,
      title: 'Agregar a ' + a.name,
      sub: 'Crea uno nuevo o elige de tu equipo',
      body: `
        <div class="cmf-card">
          <button type="button" class="cmf-row cmf-new" onclick="VPComandas.nuevo()">
            <span class="cmf-av cmf-av-new">${icon('plus')}</span>
            <span class="cmf-row-t"><b>Crear usuario nuevo</b><small>${premium ? 'Disponible en Premium' : 'Nombre, NIP' + (st.area === 'caja' ? ', cargo y permisos' : '')}</small></span>
            ${premium ? '<span class="cmf-tag">Premium</span>' : `<span class="cmf-chev">${icon('chevronRight')}</span>`}
          </button>
        </div>
        <div class="cmf-sec">
          <span>Usuarios disponibles</span><em>${todos.length}</em>
        </div>
        ${todos.length > 6 ? `<label class="cmf-search">${icon('search')}<input type="search" placeholder="Buscar por nombre" value="${escapeHtml(st.qAdd || '')}" oninput="VPComandas.buscarAdd(this.value)" autocomplete="off"></label>` : ''}
        ${list.length ? `<div class="cmf-card cmf-list">
          ${list.map(u => `
            <div class="cmf-row">
              <span class="cmf-av">${userPhoto(u) ? `<img src="${userPhoto(u)}" alt="">` : escapeHtml(iniciales(u))}</span>
              <span class="cmf-row-t"><b>${escapeHtml(u.name)}</b><small>${roleOf(u.role).name}${AREAS[u.area] ? ' · ' + AREAS[u.area].name : ' · Punto de venta'}</small></span>
              <button type="button" class="cmf-add" onclick="VPComandas.asignar('${u.id}')">Agregar</button>
            </div>`).join('')}
        </div>` : `<div class="cmf-empty">${todos.length ? 'Nadie coincide con tu búsqueda.' : 'Todavía no tienes otros usuarios. Crea uno nuevo arriba.'}</div>`}`,
      foot: ''
    };
  }
  function formParts() {
    const f = st.form;
    const a = AREAS[st.area];
    const u = f.editId ? userById(f.editId) : null;
    const owner = ownerUser();
    const pideNipDueno = !f.editId && owner && !owner.pin;
    const roles = ['empleado', 'admin'].map(r => ({ v:r, t:roleOf(r).name, s:roleOf(r).sub }));
    const conCargo = st.area === 'caja';   /* mesero y cocinero no llevan cargo ni permisos */
    return {
      back: u ? `VPComandas.area('${st.area}')` : `VPComandas.volverAdd()`,
      title: u ? 'Editar usuario' : 'Nuevo ' + a.one,
      sub: u ? escapeHtml(u.name) + ' · ' + a.name : 'Se agrega a ' + a.name,
      body: `
        <div class="uf cm-uf usd-form">
          <div class="usd-sec">Datos</div>
          <div class="usd-card">
            <div class="uf-f">
              <label class="uf-l" for="cmName">Nombre completo</label>
              <input id="cmName" class="uf-box" type="text" maxlength="40" placeholder="Ej. Luis Pérez" autocomplete="off" value="${escapeHtml(f.name)}" oninput="VPComandas.campo('name', this.value)">
            </div>
            ${conCargo ? `<div class="uf-f">
              <span class="uf-l">Cargo</span>
              ${ufSelHTML('cmRole', '', '', 'Cargo', roles, f.role, 'VPComandas.cargo')}
            </div>` : ''}
          </div>
          <div class="usd-sec">Acceso</div>
          <div class="usd-card">
            <div class="uf-f">
              <label class="uf-l" for="cmPin">NIP de 4 dígitos${u ? '' : ' <span>(opcional)</span>'}</label>
              <input id="cmPin" class="uf-box pin" type="tel" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off" value="${escapeHtml(f.pin)}"
                   oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4); VPComandas.campo('pin', this.value)">
              <div class="uf-hint">${u ? (u.pin ? 'Déjalo vacío para no cambiarlo.' : 'Aún no tiene NIP: entra sin escribir nada.') : 'Con NIP, solo esta persona puede entrar a su cuenta.'}</div>
            </div>
            ${pideNipDueno ? `<div class="uf-f">
              <label class="uf-l" for="cmOwnerPin">Tu NIP de Dueño</label>
              <input id="cmOwnerPin" class="uf-box pin" type="tel" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off" value="${escapeHtml(f.ownerPin)}"
                   oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4); VPComandas.campo('ownerPin', this.value)">
              <div class="uf-hint">Al tener equipo, tú también entras con NIP para proteger tu cuenta de Dueño.</div>
            </div>` : ''}
          </div>
          ${conCargo ? `<div class="usd-sec">Permisos</div>
          ${ufPermsRowHTML(f.perms, 'VPComandas.permisos()')}` : ''}
        </div>`,
      foot: `<button class="btn ghost" onclick="${u ? `VPComandas.area('${st.area}')` : 'VPComandas.volverAdd()'}">Cancelar</button>
             <button class="btn primary" onclick="VPComandas.guardarUsuario()">${u ? 'Guardar cambios' : 'Agregar a ' + a.name}</button>`
    };
  }
  function permsParts() {
    const f = st.form;
    const d = st.permsDraft;
    const on = PERMS.filter(p => d[p.id]).length;
    return {
      back: 'VPComandas.volverForm()',
      title: 'Permisos',
      sub: (f.name.trim() ? escapeHtml(f.name.trim()) + ' · ' : '') + roleOf(f.role).name,
      body: `
        <div class="cmf-sec"><span>Lo que puede hacer</span><em id="cmfPermN">${on} de ${PERMS.length}</em></div>
        <div class="cmf-card cmf-list">
          ${PERMS.map(p => `
            <label class="cmf-row cmf-perm">
              <span class="cmf-row-t"><b>${p.label}</b><small>${p.sub}</small></span>
              <span class="switch"><input type="checkbox" ${d[p.id] ? 'checked' : ''} onchange="VPComandas.perm('${p.id}', this.checked)"><span class="track"></span></span>
            </label>`).join('')}
        </div>`,
      foot: `<button class="btn ghost" onclick="VPComandas.volverForm()">Cancelar</button>
             <button class="btn primary" onclick="VPComandas.guardarPermisos()">Guardar permisos</button>`
    };
  }
  function pintarFull() {
    if (!FULL[st.screen] || !AREAS[st.area]) { cerrarFull(); return; }
    if ((st.screen === 'form' || st.screen === 'perms') && !st.form) { cerrarFull(); return; }
    if (st.screen === 'perms' && !st.permsDraft) { cerrarFull(); return; }
    const parts = st.screen === 'add' ? addParts() : st.screen === 'form' ? formParts() : permsParts();
    let el = document.getElementById('cmFull');
    const nueva = !el;
    if (nueva) {
      el = document.createElement('div');
      el.id = 'cmFull'; el.className = 'cmf';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      document.body.appendChild(el);
      document.body.classList.add('cmf-abierta');
    }
    const mismo = el.dataset.screen === st.screen;
    const sc = mismo ? (el.querySelector('.cmf-scroll') || {}).scrollTop || 0 : 0;
    el.dataset.screen = st.screen;
    el.setAttribute('aria-label', parts.title);
    el.innerHTML = `
      <header class="cmf-top"><div class="cmf-top-in">
        <button type="button" class="cm-back" onclick="${parts.back}" aria-label="Regresar">${icon('chevronLeft')}</button>
        <div class="cmf-top-t"><h1>${parts.title}</h1><p>${parts.sub}</p></div>
      </div></header>
      <div class="cmf-scroll"><div class="cmf-in">${parts.body}</div></div>
      ${parts.foot ? `<footer class="cmf-foot"><div class="cmf-foot-in">${parts.foot}</div></footer>` : ''}`;
    const scr = el.querySelector('.cmf-scroll'); if (scr && sc) scr.scrollTop = sc;
    if (nueva) requestAnimationFrame(() => el.classList.add('on')); else el.classList.add('on');
  }
  function cerrarFull() {
    const el = document.getElementById('cmFull'); if (!el) return;
    el.remove();
    document.body.classList.remove('cmf-abierta');
    if (typeof ufMenuCerrar === 'function') ufMenuCerrar();
  }
  function buscarAdd(v) {
    st.qAdd = v;
    const el = document.getElementById('cmFull'); if (!el) return;
    const inp = el.querySelector('.cmf-search input'); const pos = inp ? inp.selectionStart : null;
    pintarFull();
    const n = el.querySelector('.cmf-search input'); if (n) { n.focus(); if (pos != null) try { n.setSelectionRange(pos, pos); } catch (e) {} }
  }
  function volverAdd() {
    st.form = null; st.permsDraft = null;
    if (disponibles(st.area).length) show('add'); else show('area');
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !document.getElementById('cmFull') || document.querySelector('.uf-menu')) return;
    if (st.screen === 'perms') volverForm(); else if (st.screen === 'form' && !st.form.editId) volverAdd(); else area(st.area);
  });

  /* Con las comandas apagadas no se entra a las áreas ni se tocan usuarios */
  function apagadas() {
    if (activas()) return false;
    if (!premiumOk()) { if (window.VPPremium && VPPremium.abrir) VPPremium.abrir('comandas'); else toast('Las comandas son de Premium'); }
    else toast('Primero activa las comandas', { icon:icon('alert'), subtitle:'Así podrás agregar y modificar a tu equipo.' });
    return true;
  }
  function area(id) {
    if (!AREAS[id] || apagadas()) return;
    st.area = id; st.form = null; st.permsDraft = null;
    show('area');
  }
  function agregar() {
    if (apagadas()) return;
    if (!requireOwner('Solo el Dueño puede agregar personas')) return;
    st.qAdd = '';
    if (disponibles(st.area).length) show('add');
    else nuevo();
  }
  function nuevo() {
    if (apagadas()) return;
    if (!requireOwner('Solo el Dueño puede agregar personas')) return;
    if (usersLimitReached()) { offerMoreUsers(); return; }
    st.form = { editId:null, name:'', role:'empleado', pin:'', ownerPin:'', perms:defaultPerms('empleado') };
    show('form');
  }
  function editar(id) {
    if (apagadas()) return;
    const u = userById(id);
    if (!u || !requireOwner('Solo el Dueño puede modificar usuarios')) return;
    st.form = { editId:u.id, name:u.name, role:u.role, pin:'', ownerPin:'', perms:Object.assign(defaultPerms(u.role), u.perms || {}) };
    show('form');
  }
  function campo(k, v) { if (st.form) st.form[k] = v; }
  function cargo(role) {
    if (!st.form || st.form.role === role) return;
    st.form.role = role;
    if (!st.form.permsTocados) st.form.perms = defaultPerms(role);
    /* Sin volver a dibujar la pantalla: solo se actualiza el contador de permisos */
    const fila = document.querySelector('#cmFull .cm-uf [data-perm-n]');
    if (fila) fila.textContent = PERMS.filter(p => st.form.perms[p.id]).length + ' de ' + PERMS.length + ' permisos activados';
  }
  function permisos() {
    if (!st.form) return;
    st.permsDraft = Object.assign({}, st.form.perms);
    show('perms');
  }
  function perm(id, v) {
    if (!st.permsDraft) return;
    st.permsDraft[id] = !!v;
    const n = document.getElementById('cmfPermN'); if (n) n.textContent = PERMS.filter(p => st.permsDraft[p.id]).length + ' de ' + PERMS.length;
  }
  function guardarPermisos() {
    if (!st.form || !st.permsDraft) return;
    st.form.perms = st.permsDraft;
    st.form.permsTocados = true;
    st.permsDraft = null;
    show('form');
    toast('Permisos guardados', { variant:'toast-success', icon:icon('check') });
  }
  function volverForm() { st.permsDraft = null; show('form'); }

  function guardarUsuario() {
    const f = st.form;
    if (!f || !requireOwner('Solo el Dueño puede agregar usuarios')) return;
    const name = (f.name || '').trim();
    const pin = (f.pin || '').replace(/\D/g, '');
    if (name.length < 2) { toast('Escribe el nombre de la persona'); document.getElementById('cmName')?.focus(); return; }
    if (pin && pin.length !== 4) { toast('El NIP debe tener 4 dígitos'); return; }
    const list = DB.getUsers();
    if (f.editId) {
      const u = list.find(x => x.id === f.editId);
      if (!u) { area(st.area); return; }
      u.name = name;
      if (u.role !== 'dueno') {
        const cc = st.area === 'caja';
        u.role = cc && f.role === 'admin' ? 'admin' : 'empleado';
        u.perms = cc ? Object.assign({}, f.perms) : defaultPerms('empleado');
      }
      if (pin) u.pin = pin;
      DB.saveUsers(list);
      paintChrome();
      st.form = null;
      show('area');
      toast('Cambios guardados', { variant:'toast-success', icon:icon('check'), subtitle:name });
      return;
    }
    if (usersLimitReached()) { offerMoreUsers(); return; }
    const owner = list.find(x => x.role === 'dueno');
    if (owner && !owner.pin) {
      const op = (f.ownerPin || '').replace(/\D/g, '');
      if (op.length !== 4) { toast('Crea tu NIP de Dueño de 4 dígitos'); document.getElementById('cmOwnerPin')?.focus(); return; }
      owner.pin = op;
    }
    list.push({
      id: 'u' + Date.now(), name,
      role: st.area === 'caja' && f.role === 'admin' ? 'admin' : 'empleado',
      pin: pin || null, phone: '',
      country: (currentUser() || {}).country || 'MX',
      perms: st.area === 'caja' ? Object.assign({}, f.perms) : defaultPerms('empleado'),
      area: st.area,
      createdAt: nowIso()
    });
    DB.saveUsers(list);
    const yo = activeUser();
    if (yo) setActiveUser(yo.id);
    openUserSession();
    if (!currentShift()) openShiftFor(activeUser());
    paintChrome();
    st.form = null;
    show('area');
    toast(name + ' se agregó a ' + AREAS[st.area].name, { variant:'toast-success', icon:icon('check') });
  }

  function asignar(id) {
    if (!requireOwner('Solo el Dueño puede agregar personas')) return;
    const list = DB.getUsers();
    const u = list.find(x => x.id === id);
    if (!u || u.role === 'dueno') return;
    u.area = st.area;
    DB.saveUsers(list);
    show('area');
    toast(u.name + ' se agregó a ' + AREAS[st.area].name, { variant:'toast-success', icon:icon('check') });
  }

  function quitar(id) {
    if (apagadas()) return;
    if (!requireOwner('Solo el Dueño puede quitar personas')) return;
    const u = userById(id);
    if (!u) return;
    const a = AREAS[st.area];
    askConfirm({
      title: '¿Eliminar a ' + escapeHtml(u.name) + ' de ' + a.name + '?',
      text: 'Ya no aparecerá en ' + a.name + '. Su usuario sigue guardado y puedes volver a agregarlo cuando quieras.',
      ok: 'Eliminar', danger: true, icon: icon('trash')
    }, () => {
      const list = DB.getUsers();
      const x = list.find(v => v.id === id);
      if (x) { delete x.area; DB.saveUsers(list); }
      show('area');
      toast(u.name + ' ya no está en ' + a.name, { icon:icon('trash') });
    });
  }

  /* =========================================================
     PIEZAS COMPARTIDAS
  ========================================================= */
  function soloBar() {
    return `<div class="cm-solo-bar">
      <button class="btn ghost" onclick="VPComandas.historial()">${icon('receipt')} Historial</button>
    </div>`;
  }

  /* ---------- Cada mesero con sus mesas ---------- */
  const duenoDe = o => (o && ((o.cm && o.cm.waiterId) || o.byId)) || '';
  const nombreDe = o => (o && ((o.cm && o.cm.waiterName) || o.by)) || 'otro mesero';
  function esMiMesa(o) { const yo = me(); return !!o && !!yo && (duenoDe(o) === yo.id || !duenoDe(o)); }
  /* Comandas listas que le tocan a este mesero (de sus mesas) */
  function misListas() {
    const yo = me();
    return tickets().filter(k => {
      if (k.status !== 'listo') return false;
      const o = orderById(k.orderId);
      return o ? esMiMesa(o) : (!!yo && k.byId === yo.id);
    });
  }
  /* Avisos de "No hay" que le tocan a este mesero (sin atender) */
  function misAvisos() {
    const yo = me();
    const out = [];
    tickets().forEach(k => {
      (k.alertas || []).forEach(a => {
        if (a.visto) return;
        const o = orderById(k.orderId);
        if (o ? !esMiMesa(o) : !(yo && k.byId === yo.id)) return;
        out.push(Object.assign({}, a, { tid:k.id, table:k.table, tableId:k.tableId, orderId:k.orderId }));
      });
    });
    return out.sort((a, b) => new Date(a.at) - new Date(b.at));
  }
  /* Juntas por mesa: dos rondas de la misma mesa = un solo aviso */
  function listasPorMesa() {
    const g = {};
    misListas().forEach(k => { const key = k.orderId || k.tableId; (g[key] = g[key] || { key, table:k.table, ks:[] }).ks.push(k); });
    return Object.values(g).map(x => {
      x.ks.sort((a, b) => (a.round || 1) - (b.round || 1));
      x.at = x.ks.reduce((m, k) => Math.min(m, new Date(k.readyAt || k.at).getTime()), Infinity);
      x.items = x.ks.flatMap(k => k.items);
      return x;
    }).sort((a, b) => a.at - b.at);
  }

  /* Estado de una mesa para el plano */
  function mesaEstado(o, tks, modo) {
    if (!o) return { cls:'', label:'Libre' };
    const ks = tks.filter(k => k.orderId === o.id);
    const listas = ks.some(k => k.status === 'listo');
    const cocina = ks.some(k => k.status === 'nuevo' || k.status === 'preparando');
    const cuenta = !!(o.cm && o.cm.billAt);
    if (modo === 'caja') return { cls:'is-occupied' + (cuenta ? ' cm-bill' : ''), label:cuenta ? 'Pide cuenta' : formatMoney(o.total) };
    if (!esMiMesa(o)) return { cls:'cm-other', label:userFirstName({ name:nombreDe(o) }) || 'Otro' };
    if (ks.some(k => (k.alertas || []).some(a => !a.visto))) return { cls:'is-occupied cm-alert', label:'¡Aviso!' };
    if (listas) return { cls:'is-occupied cm-ready', label:'¡Lista!' };
    if (cuenta) return { cls:'is-occupied cm-bill', label:'Pidió cuenta' };
    return { cls:'is-occupied', label:cocina ? 'En cocina' : 'Ocupada' };
  }

  function planoHTML(modo) {
    const orders = VPMesas.openOrders();
    const tks = tickets();
    const legend = modo === 'caja'
      ? [['', 'Libre'], ['is-occupied', 'Abierta'], ['cm-bill', 'Pide cuenta']]
      : [['', 'Libre'], ['is-occupied', 'Mía'], ['cm-ready', 'Lista'], ['cm-alert', 'No hay algo'], ['cm-bill', 'Pidió cuenta'], ['cm-other', 'De otro mesero']];
    return `
      <div class="vp-floor cm-floor" aria-label="Plano de mesas">
        ${VPMesas.layout().map(t => {
          const e = mesaEstado(orders.get(t.id), tks, modo);
          return `<button type="button" class="vp-floor-table ${t.id === 'bar' ? 'is-bar' : ''} ${e.cls}"
            style="--x:${t.x}%;--y:${t.y}%" onclick="VPComandas.tocarMesa('${escapeHtml(t.id)}')"
            aria-label="${escapeHtml(t.name)} · ${escapeHtml(e.label)}"><b>${escapeHtml(t.name)}</b><small>${escapeHtml(e.label)}</small></button>`;
        }).join('')}
      </div>
      <div class="cm-legend">${legend.map(([c, l]) => `<span><i class="${c}"></i>${l}</span>`).join('')}</div>`;
  }

  function tocarMesa(id) {
    if (esCajero()) { const o = VPMesas.openOrders().get(id); if (!o) { toast('Esta mesa está libre', { subtitle:'No tiene cuenta por cobrar.' }); return; } abrirCuenta(o.id); return; }
    if (esMesero()) {
      const o = VPMesas.openOrders().get(id);
      if (!o) ronda(id);
      else if (esMiMesa(o)) abrirCuenta(o.id);
      else mesaAjena(o);
    }
  }

  /* Líneas de la comanda con foto, cantidad y nota (cocina y detalle) */
  function lineasHTML(items, tid) {
    return items.map((i, n) => {
      const q = efect(i);
      return `
      <div class="mdi-line cm-line ${q <= 0 ? 'cm-line-out' : ''}">
        <div class="mdi-thumb">${thumb(i.productId)}</div>
        <div class="mdi-line-main">
          <div class="mdi-line-name">${escapeHtml(i.name)}${i.size ? ' <span class="cm-size">' + escapeHtml(i.size) + '</span>' : ''}</div>
          ${i.note ? `<div class="dm-line-note cm-note">${icx('note')}${escapeHtml(i.note)}</div>` : ''}
          ${i.falta ? `<div class="cm-nohay-tag">${icon('alert')} No hubo ${fmtN(i.falta)}</div>` : ''}
          ${i.cancelado ? `<div class="cm-nohay-tag">${icon('close')} Ya no lo quiere ${fmtN(i.cancelado)}</div>` : ''}
          ${tid && q > 0 ? `<button type="button" class="cm-nohay-btn" onclick="VPComandas.noHay('${tid}', ${n})">No hay</button>` : ''}
        </div>
        <div class="cm-qty">${q > 0 ? '×' + fmtN(q) : '<s>×' + fmtN(i.qty) + '</s>'}</div>
      </div>`;
    }).join('');
  }
  function resumen(items) {
    const hay = items.filter(i => efect(i) > 0);
    return hay.slice(0, 3).map(i => escapeHtml(fmtN(efect(i)) + '× ' + i.name)).join(' · ') + (hay.length > 3 ? ' · +' + (hay.length - 3) + ' más' : '');
  }

  /* =========================================================
     CUENTA DE UNA MESA (mesero y caja)
  ========================================================= */
  function abrirCuenta(orderId) {
    const o = orderById(orderId);
    if (!o) { closeModal(); render(); toast('Esa cuenta ya se cerró'); return; }
    st.open = { kind:'cuenta', id:orderId };
    openModal(cuentaHTML(o), { dismissible:true });
  }

  function cuentaHTML(o) {
    const caja = esCajero() || !myArea();
    const ks = ticketsOf(o.id);
    const enCocina = ks.filter(k => k.status === 'nuevo' || k.status === 'preparando');
    const listas = ks.filter(k => k.status === 'listo');
    const cuenta = !!(o.cm && o.cm.billAt);
    const mesero = (o.cm && o.cm.waiterName) || o.by || '';
    const banners = [];
    if (listas.length) banners.push(`<div class="mdi-banner ok">${icon('bell')}<span><b>${plural(listas.length, 'comanda lista', 'comandas listas')} para servir</b>${caja ? 'El mesero ya puede llevarla a la mesa.' : 'Recógela desde la pestaña Listos.'}</span></div>`);
    if (enCocina.length) banners.push(`<div class="mdi-banner warn">${icon('clock')}<span><b>${plural(enCocina.length, 'comanda', 'comandas')} en cocina</b>${caja ? 'Todavía se está preparando algo de esta mesa.' : 'Te avisamos cuando esté lista.'}</span></div>`);
    if (cuenta) banners.push(`<div class="mdi-banner cm-banner-bill">${icon('cash')}<span><b>Pidió la cuenta</b>${caja ? 'El cliente ya quiere pagar.' : 'Caja ya sabe que esta mesa quiere pagar.'} · ${ago(o.cm.billAt)}</span></div>`);

    const rondas = ks.length ? `
      <div class="mdi-block-title cm-block-t">Comandas</div>
      <div class="cm-rondas">${ks.map(k => `
        <div class="cm-ronda">
          <div class="cm-ronda-h"><b>Ronda ${k.round || 1}</b><span class="mdi-pill ${ESTADOS[k.status].cls}">${ESTADOS[k.status].label}</span><span class="mdi-time">${fmtTime(k.at)}</span></div>
          <div class="cm-ronda-items">${k.items.map(itemTxt).join('')}</div>
        </div>`).join('')}</div>` : '';

    const lineas = (o.cart || []).map(c => {
      const p = findProduct(c.productId);
      return `<div class="mdi-line cm-line">
        <div class="mdi-thumb">${thumb(c.productId)}</div>
        <div class="mdi-line-main">
          <div class="mdi-line-name">${escapeHtml(p ? p.name : 'Producto')}${c.sizeLabel ? ' <span class="cm-size">' + escapeHtml(c.sizeLabel) + '</span>' : ''}</div>
          <div class="mdi-line-sub">${fmtN(c.qty)} × ${formatMoney(cartLineBase(c))}</div>
          ${c.note ? `<div class="dm-line-note cm-note">${icx('note')}${escapeHtml(c.note)}</div>` : ''}
        </div>
        <div class="mdi-line-amt">${formatMoney(cartLineAmount(c))}</div>
      </div>`;
    }).join('');

    let acts;
    if (caja) {
      acts = `
        <button class="btn primary block" onclick="VPComandas.cobrar('${o.id}')">${icon('cash')} Cobrar · ${formatMoney(o.total)}</button>
        <button class="btn ghost block" onclick="VPComandas.editarCuenta('${o.id}')">${icon('edit')} Revisar o corregir la cuenta</button>`;
    } else {
      acts = `
        ${cuenta
          ? `<button class="btn ghost block" onclick="VPComandas.pedirCuenta('${o.id}')">${icon('close')} Quitar aviso de cuenta</button>`
          : `<button class="btn primary block" onclick="VPComandas.ronda('${escapeHtml(o.checkout.floorTableId)}')">${icon('plus')} Agregar productos</button>
             ${enCocina.length && !cuentaLibre[o.id]
               ? `<button type="button" class="btn xl block cm-bill-lock" onclick="VPComandas.desbloquearCuenta('${o.id}')">
                    <span class="cm-hold-in">${icon('lock')} Pedir la cuenta</span>
                    <small class="cm-hold-tip">Aún hay platillos en cocina · toca para desbloquear</small>
                  </button>`
               : holdBtn('cm-go-bill', icon('cash') + ' Pedir la cuenta', 'pedirCuenta', [o.id])}`}`;
    }

    return `
      <i class="fs-marker" hidden></i><i class="cm-open" data-id="${o.id}" hidden></i>
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;">
          <h2>${escapeHtml(tableName(o))}</h2>
          <span class="mdi-pill ${cuenta ? 'nuevo' : 'ok'}">${cuenta ? 'Pidió la cuenta' : 'Abierta'}</span>
        </div>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <div class="mdi-meta">
        ${mesero ? `<span>${icon('person')} Mesero: <b>${escapeHtml(mesero)}</b></span>` : ''}
        <span>${icon('clock')} Abierta ${ago((o.cm && o.cm.openedAt) || o.at)} · ${plural(ks.length, 'ronda', 'rondas')}</span>
      </div>
      ${banners.join('')}
      ${caja ? `<div class="mdi-block-title cm-block-t">Cuenta</div><div class="cm-lines">${lineas || '<p class="sheet-text">Sin productos.</p>'}</div>
        <div class="totals"><div class="totals-row grand"><span>Total</span><span class="v">${formatMoney(o.total)}</span></div></div>
        ${rondas}` : `${rondas}
        <div class="totals"><div class="totals-row grand"><span>Total de la mesa</span><span class="v">${formatMoney(o.total)}</span></div></div>`}
      <div class="cm-sheet-acts">${acts}</div>`;
  }

  /* =========================================================
     MESERO
  ========================================================= */
  function meseroHTML() {
    const yo = me();
    const grupos = listasPorMesa();
    const avs = misAvisos();
    const n = grupos.length + avs.length;
    const tab = st.mtab === 'listos' ? 'listos' : 'mesas';
    return `
      <h1 class="page-title">Mesas</h1>
      <p class="page-sub">Hola, ${escapeHtml(userFirstName(yo) || yo.name)}</p>
      ${soloBar()}
      <div class="cm-tabs" role="tablist">
        <button type="button" role="tab" class="cm-tab ${tab === 'mesas' ? 'on' : ''}" onclick="VPComandas.tabMesero('mesas')">${VPMesas.tableIcon} Mesas</button>
        <button type="button" role="tab" class="cm-tab ${tab === 'listos' ? 'on' : ''} ${n ? 'has' : ''} ${avs.length ? 'alert' : ''}" onclick="VPComandas.tabMesero('listos')">${icon('bell')} Avisos${n ? `<span class="cm-tab-n">${n}</span>` : ''}</button>
      </div>
      ${tab === 'mesas' ? planoHTML('mesero') : `<div class="cm-av-scroll">${n ? `
        ${avs.length ? `<div class="cm-av-t cm-av-no">${icon('alert')} No hay</div><div class="cm-pick">${avs.map(a => `
          <button type="button" class="cm-pick-card cm-pick-no" onclick="VPComandas.verAviso('${a.tid}','${a.id}')">
            <span class="cm-pick-mesa">${escapeHtml(a.table)}</span>
            <span class="cm-pick-txt">
              <b>No hay ${fmtN(a.qty)}× ${escapeHtml(a.name)}</b>
              <small>Avísale al cliente</small>
              <small class="cm-pick-time">${icon('clock')} ${ago(a.at)}</small>
            </span>
            <span class="cm-pick-go">Ver ${icon('chevronRight')}</span>
          </button>`).join('')}</div>` : ''}
        ${grupos.length ? `<div class="cm-av-t">${icon('bell')} Listos para recoger</div><div class="cm-pick">${grupos.map(g => `
          <button type="button" class="cm-pick-card" onclick="VPComandas.verLista('${escapeHtml(g.key)}')">
            <span class="cm-pick-mesa">${escapeHtml(g.table)}</span>
            <span class="cm-pick-txt">
              <b>${g.ks.length > 1 ? plural(g.ks.length, 'ronda lista', 'rondas listas') : 'Ronda ' + (g.ks[0].round || 1) + ' lista'}</b>
              <small>${resumen(g.items)}</small>
              <small class="cm-pick-time">${icon('clock')} ${ago(new Date(g.at).toISOString())}</small>
            </span>
            <span class="cm-pick-go">Recoger ${icon('chevronRight')}</span>
          </button>`).join('')}</div>` : ''}` : `
        <div class="mdi-empty">
          <span class="mdi-empty-ico">${icon('bell')}</span>
          <b>Sin avisos</b>
          <span>Aquí te llegan los pedidos listos de tus mesas y si cocina no tiene algo.</span>
        </div>`}</div>`}`;
  }
  /* Aviso de "No hay": qué hacer */
  function verAviso(tid, aid) {
    const k = tickets().find(x => x.id === tid);
    const a = k && (k.alertas || []).find(x => x.id === aid);
    if (!a || a.visto) { closeModal(); render(); return; }
    const o = orderById(k.orderId);
    const puedeAgregar = !!o && !(o.cm && o.cm.billAt) || !o;
    openModal(`
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;"><h2>${escapeHtml(k.table)}</h2><span class="mdi-pill no">No hay</span></div>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <div class="cm-nh-prod cm-nh-out">
        <span class="mdi-thumb">${thumb(a.productId)}</span>
        <b>${escapeHtml(a.name)}${a.size ? ' · ' + escapeHtml(a.size) : ''}</b>
        <span class="cm-qty"><s>×${fmtN(a.qty)}</s></span>
      </div>
      <div class="cm-todo">
        <span class="cm-todo-step"><i>${icon('person')}</i><small>Avisa al cliente</small></span>
        <b class="cm-todo-arrow">${icon('chevronRight')}</b>
        <span class="cm-todo-step"><i>${icon('swap')}</i><small>Ofrece otra cosa</small></span>
      </div>
      <p class="cm-nh-note">${icon('check')} ${a.mesaLibre ? 'Ya no quedó nada en la cuenta: la mesa quedó libre.' : 'Ya se quitó de la cuenta: no se le cobra.'}</p>
      <div class="cm-sheet-acts">
        ${holdBtn('cm-go cm-go-ok', icon('check') + ' Ya le avisé', 'avisoVisto', [tid, aid])}
        ${puedeAgregar ? `<button class="btn ghost block" onclick="VPComandas.avisoVisto('${tid}','${aid}', true)">${icon('plus')} Pidió otra cosa</button>` : ''}
      </div>
    `, { dismissible:true });
  }
  function avisoVisto(tid, aid, agregar) {
    const list = tickets();
    const k = list.find(x => x.id === tid);
    const a = k && (k.alertas || []).find(x => x.id === aid);
    if (a && !a.visto) { a.visto = true; a.vistoAt = nowIso(); saveTickets(list); }
    closeModal();
    if (!misAvisos().length && !listasPorMesa().length) st.mtab = 'mesas';
    if (agregar && k) { ronda(k.tableId); return; }
    render();
  }
  function tabMesero(t) { st.mtab = t; vibrate(6); render.fresh = true; render(); window.scrollTo(0, 0); const l = document.querySelector('#view .cm-av-scroll'); if (l) l.scrollTop = 0; }

  /* Mesa que atiende otro mesero */
  function mesaAjena(o) {
    const quien = escapeHtml(nombreDe(o));
    openModal(`
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;"><h2>${escapeHtml(tableName(o))}</h2><span class="mdi-pill cancel">${quien}</span></div>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <div class="cm-other-box">
        <span class="cm-other-av">${escapeHtml(initialsOf(nombreDe(o)))}</span>
        <b>Esta mesa la atiende ${quien}</b>
        <small>Solo tómala si ${quien} ya no está o te lo pidió.</small>
      </div>
      <div class="cm-sheet-acts">
        ${holdBtn('cm-go cm-go-take', icon('swap') + ' Tomar esta mesa', 'tomarMesa', [o.id])}
        <button class="cm-undo" onclick="closeModal()">Mejor no</button>
      </div>
    `, { dismissible:true });
  }
  function tomarMesa(orderId) {
    const yo = me();
    const list = DB.getTableOrders();
    const o = list.find(x => x.id === orderId);
    if (!o || !yo) { closeModal(); render(); return; }
    const antes = nombreDe(o);
    o.cm = Object.assign({}, o.cm, { waiterId:yo.id, waiterName:yo.name, takenFrom:antes, takenAt:nowIso(), updatedAt:nowIso() });
    DB.saveTableOrders(list);
    render();
    abrirCuenta(orderId);
    toast('Ahora ' + tableName(o) + ' es tuya', { variant:'toast-success', icon:icon('check'), subtitle:'Antes la atendía ' + antes });
  }

  /* Empieza una ronda nueva en la mesa: el catálogo con el carrito vacío */
  function ronda(tableId) {
    if (!esMesero()) return;
    const t = VPMesas.layout().find(x => x.id === tableId);
    if (!t) return;
    const o = VPMesas.openOrders().get(tableId);
    if (o && o.cm && o.cm.billAt) { toast(t.name + ' ya pidió la cuenta', { icon:icon('cash'), subtitle:'Quita el aviso para agregar más productos.' }); return; }
    closeModal();
    cart = []; customItems = {}; checkout = newCheckout();
    checkout.floorTableId = t.id;
    checkout.serviceType = 'mesa';
    checkout.table = t.name;
    goTo('sale');
  }

  function saleHead() {
    if (!esMesero() || !checkout.floorTableId) return '';
    const o = VPMesas.openOrders().get(checkout.floorTableId);
    const n = o ? ticketsOf(o.id).length + 1 : 1;
    return `
      <button class="cm-back" onclick="VPComandas.salirMesa()">${icon('chevronLeft')} Mesas</button>
      <h1 class="page-title">${escapeHtml(checkout.table || 'Mesa')} <span class="cm-round-tag">Ronda ${n}</span></h1>
      <p class="page-sub">Agrega los productos. En el carrito toca un producto para ponerle nota.</p>`;
  }

  function salirMesa() {
    const leave = () => { cart = []; customItems = {}; checkout = newCheckout(); closeModal(); goTo('comandas'); };
    if (cart.length) {
      askConfirm({
        title: '¿Salir sin mandar a cocina?',
        text: 'Los productos que agregaste a ' + escapeHtml(checkout.table || 'esta mesa') + ' no se mandarán.',
        ok: 'Salir sin mandar', danger: true, icon: icon('alert')
      }, leave);
      return;
    }
    leave();
  }

  function cartActions() {
    const o = VPMesas.openOrders().get(checkout.floorTableId);
    const n = cartUnitsCount();
    return `
      ${o ? `<div class="cm-cart-prev">${icon('receipt')}<span>Ya en la cuenta de ${escapeHtml(checkout.table)}: <b>${formatMoney(o.total)}</b></span></div>` : ''}
      <div class="cart-actions cm-cart-actions">
        ${holdBtn('cm-go cm-go-ok', icon('comandas') + ' Mandar a cocina · ' + plural(n, 'producto', 'productos'), 'enviar', [])}
      </div>`;
  }

  /* Junta líneas iguales (mismo producto, tamaño, nota y precio) */
  const lineKey = c => [c.productId, c.sizeId || '', (c.note || '').trim(), c.manualPrice == null ? '' : c.manualPrice].join('|');
  /* Cantidades del carrito por línea (para saber qué falta mandar a cocina) */
  function cartMap() {
    const m = {};
    cart.forEach(c => { const k = lineKey(c); m[k] = Math.round(((m[k] || 0) + (Number(c.qty) || 0)) * 1000) / 1000; });
    return m;
  }
  function juntar(base, nuevas) {
    const out = JSON.parse(JSON.stringify(base || []));
    nuevas.forEach(c => {
      const k = lineKey(c);
      const ya = out.find(x => lineKey(x) === k && !x.disc && !c.disc);
      if (ya) ya.qty = Math.round((Number(ya.qty) + Number(c.qty)) * 1000) / 1000;
      else out.push(JSON.parse(JSON.stringify(c)));
    });
    return out;
  }

  function enviar() {
    if (!esMesero() || !checkout.floorTableId) return;
    if (!cart.length) { toast('Agrega productos a la comanda'); return; }
    const t = VPMesas.layout().find(x => x.id === checkout.floorTableId);
    if (!t) { toast('Esta mesa ya no existe'); return; }
    const yo = me();
    const items = cart.map(c => {
      const p = findProduct(c.productId);
      return { productId:c.productId, sizeId:c.sizeId || '', name:p ? p.name : 'Producto', size:c.sizeLabel || '', qty:Number(c.qty) || 0, note:(c.note || '').trim() };
    });
    const nueva = { cart:cart.slice(), custom:Object.assign({}, customItems) };
    const prev = VPMesas.openOrders().get(t.id);
    const id = prev ? prev.id : uid('e');
    const ordCheckout = Object.assign(newCheckout(), prev ? prev.checkout : {}, {
      serviceType:'mesa', floorTableId:t.id, table:t.name, floorOrderId:id, cash:''
    });
    /* Total de la cuenta completa (lo de antes + esta ronda) */
    const mergedCart = juntar(prev ? prev.cart : [], nueva.cart);
    const mergedCustom = Object.assign({}, prev ? prev.customItems : {}, nueva.custom);
    const keep = { cart, customItems, checkout };
    let total = 0, units = 0;
    try {
      cart = mergedCart; customItems = mergedCustom; checkout = ordCheckout;
      total = computeTotals().total; units = cartUnitsCount();
    } finally { cart = keep.cart; customItems = keep.customItems; checkout = keep.checkout; }
    const rondas = (prev && prev.cm && prev.cm.rounds) || (prev ? ticketsOf(prev.id).length : 0);
    const entry = Object.assign({}, prev || {}, {
      id, name:t.name,
      at: prev ? prev.at : nowIso(),
      by: prev ? prev.by : (yo ? yo.name : meName()),
      byId: prev ? prev.byId : (yo ? yo.id : meId()),
      cart: mergedCart, customItems: mergedCustom, checkout: ordCheckout, total, units,
      cm: Object.assign({}, prev && prev.cm, {
        waiterId: (prev && prev.cm && prev.cm.waiterId) || (yo ? yo.id : ''),
        waiterName: (prev && prev.cm && prev.cm.waiterName) || (yo ? yo.name : ''),
        openedAt: (prev && prev.cm && prev.cm.openedAt) || (prev ? prev.at : nowIso()),
        rounds: rondas + 1,
        updatedAt: nowIso()
      })
    });
    const list = DB.getTableOrders().filter(x => x.id !== id);
    list.push(entry);
    if (!DB.saveTableOrders(list)) { toast('No se pudo guardar el pedido'); return; }
    const tks = tickets();
    tks.push({
      id: uid('cm'), orderId:id, tableId:t.id, table:t.name, round:rondas + 1, items,
      by: yo ? yo.name : meName(), byId: yo ? yo.id : meId(),
      at: nowIso(), status:'nuevo'
    });
    saveTickets(tks);
    cart = []; customItems = {}; checkout = newCheckout();
    closeModal();
    goTo('comandas');
    toast('Comanda mandada a cocina', { variant:'toast-success', icon:icon('check'), subtitle:t.name + ' · Ronda ' + (rondas + 1) });
  }

  function entregar(orderId) {
    const list = tickets();
    let n = 0;
    list.forEach(k => { if (k.orderId === orderId && k.status === 'listo') { k.status = 'entregado'; k.deliveredAt = nowIso(); k.deliveredBy = meName(); n++; } });
    if (!n) return;
    saveTickets(list);
    abrirCuenta(orderId);
    render();
    toast(n === 1 ? 'Comanda entregada' : n + ' comandas entregadas', { variant:'toast-success', icon:icon('check') });
  }

  /* Recoger: "¿Ya tienes el pedido?" con todo lo listo de esa mesa */
  function verLista(key) {
    const g = listasPorMesa().find(x => x.key === key)
      || (() => { const k = tickets().find(x => x.id === key && x.status === 'listo'); return k ? { key:k.orderId || k.tableId, table:k.table, ks:[k], items:k.items } : null; })();
    if (!g) { closeModal(); render(); return; }
    openModal(`
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;"><h2>${escapeHtml(g.table)}</h2><span class="mdi-pill ok">${g.ks.length > 1 ? plural(g.ks.length, 'ronda', 'rondas') : 'Lista'}</span></div>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <div class="cm-todo">
        <span class="cm-todo-step"><i>${icon('inbox')}</i><small>Recoge en cocina</small></span>
        <b class="cm-todo-arrow">${icon('chevronRight')}</b>
        <span class="cm-todo-step"><i>${VPMesas.tableIcon}</i><small>Lleva a ${escapeHtml(g.table)}</small></span>
      </div>
      <div class="cm-lines">${lineasHTML(g.items)}</div>
      <div class="cm-sheet-acts">
        <p class="cm-ask">¿Ya tienes el pedido?</p>
        ${holdBtn('cm-go cm-go-ok', icon('check') + ' Ya lo tengo', 'entregarGrupo', [g.ks.map(k => k.id)])}
        <button class="cm-undo" onclick="closeModal()">Todavía no</button>
      </div>
    `, { dismissible:true });
  }
  function entregarGrupo(ids) {
    const list = tickets();
    let mesa = '', n = 0;
    list.forEach(k => { if (ids.indexOf(k.id) >= 0 && k.status === 'listo') { k.status = 'entregado'; k.deliveredAt = nowIso(); k.deliveredBy = meName(); mesa = k.table; n++; } });
    closeModal();
    if (!n) { render(); return; }
    saveTickets(list);
    if (!listasPorMesa().length) st.mtab = 'mesas';
    render();
    toast('¡Listo! Llévalo a ' + mesa, { variant:'toast-success', icon:icon('check') });
  }

  /* Si todavía hay platillos en cocina, "Pedir la cuenta" sale bloqueado (gris).
     Un toque lo desbloquea (por si el cliente ya se quiere ir) y ya se puede pedir. */
  const cuentaLibre = {};
  function desbloquearCuenta(orderId) {
    cuentaLibre[orderId] = true;
    vibrate(8);
    abrirCuenta(orderId);
    toast('Listo, ya puedes pedir la cuenta', { icon:icon('cash'), subtitle:'Todavía hay platillos en cocina' });
  }
  function pedirCuenta(orderId) {
    const list = DB.getTableOrders();
    const o = list.find(x => x.id === orderId);
    if (!o) return;
    o.cm = Object.assign({}, o.cm);
    const quitar = !!o.cm.billAt;
    o.cm.billAt = quitar ? null : nowIso();
    o.cm.billBy = quitar ? null : meName();
    o.cm.updatedAt = nowIso();
    DB.saveTableOrders(list);
    render();
    abrirCuenta(orderId);
    toast(quitar ? 'Se quitó el aviso de cuenta' : 'Caja ya sabe que ' + tableName(o) + ' quiere pagar', { variant:quitar ? '' : 'toast-success', icon:icon('cash') });
  }

  /* =========================================================
     CAJA
  ========================================================= */
  function cajaHTML() {
    const yo = me();
    const orders = [...VPMesas.openOrders().values()]
      .sort((a, b) => ((b.cm && b.cm.billAt) ? 1 : 0) - ((a.cm && a.cm.billAt) ? 1 : 0) || new Date(a.at) - new Date(b.at));
    const tks = tickets();
    const total = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    return `
      <h1 class="page-title">Caja</h1>
      <p class="page-sub">Hola, ${escapeHtml(userFirstName(yo) || yo.name)} · ${orders.length ? plural(orders.length, 'cuenta abierta', 'cuentas abiertas') + ' · ' + formatMoney(total) : 'Aquí aparecen las cuentas de las mesas'}</p>
      ${soloBar()}
      ${planoHTML('caja')}
      <div class="section-title">Cuentas abiertas ${orders.length ? `<span class="title-count">${orders.length}</span>` : ''}</div>
      ${orders.length ? `<div class="mdi-list cm-kds">${orders.map(o => {
        const ks = tks.filter(k => k.orderId === o.id);
        const cocina = ks.filter(k => k.status === 'nuevo' || k.status === 'preparando').length;
        const cuenta = !!(o.cm && o.cm.billAt);
        const items = (o.cart || []).map(c => { const p = findProduct(c.productId); return { qty:c.qty, name:p ? p.name : 'Producto' }; });
        return `<button type="button" class="mdi-card ${cuenta ? 'st-nuevo' : 'st-ok'}" onclick="VPComandas.abrirCuenta('${o.id}')">
          <div class="mdi-card-top">
            <span class="mdi-code">${escapeHtml(tableName(o))}</span>
            <span class="mdi-pill ${cuenta ? 'nuevo' : 'ok'}">${cuenta ? 'Pide cuenta' : 'Abierta'}</span>
            ${cocina ? `<span class="mdi-pill prep">${cocina} en cocina</span>` : ''}
            <span class="mdi-time">${ago((o.cm && o.cm.openedAt) || o.at)}</span>
          </div>
          <div class="mdi-name">${icon('person')} ${escapeHtml((o.cm && o.cm.waiterName) || o.by || 'Sin mesero')}</div>
          <div class="mdi-items">${resumen(items) || '—'}</div>
          <div class="mdi-card-foot"><span>${plural(o.units || items.length, 'producto', 'productos')}</span><b>${formatMoney(o.total)}</b></div>
        </button>`;
      }).join('')}</div>` : `
      <div class="mdi-empty">
        <span class="mdi-empty-ico">${icon('inbox')}</span>
        <b>No hay cuentas abiertas</b>
        <span>Cuando un mesero mande una comanda, la cuenta de esa mesa aparecerá aquí.</span>
      </div>`}`;
  }

  /* Pasa la cuenta al cobro de siempre (efectivo, tarjeta, propina, ticket…) */
  function cargar(orderId) {
    const o = orderById(orderId);
    if (!o) { toast('Esa cuenta ya se cerró'); render(); return null; }
    cart = JSON.parse(JSON.stringify(o.cart || []));
    customItems = JSON.parse(JSON.stringify(o.customItems || {}));
    checkout = Object.assign(newCheckout(), o.checkout || {}, { cash:'' });
    st.open = null;
    return o;
  }
  function cobrar(orderId) {
    const o = cargar(orderId);
    if (!o) return;
    const pend = ticketsOf(o.id).filter(k => k.status === 'nuevo' || k.status === 'preparando').length;
    if (pend) {
      askConfirm({
        title: 'Hay ' + plural(pend, 'comanda', 'comandas') + ' en cocina',
        text: 'Todavía se está preparando algo de ' + escapeHtml(tableName(o)) + '. ¿Quieres cobrar de todos modos?',
        ok: 'Cobrar', icon: icon('clock')
      }, () => openCartSheet('checkout'));
      return;
    }
    openCartSheet('checkout');
  }
  function editarCuenta(orderId) { if (cargar(orderId)) openCartSheet('cart'); }

  /* ---------- Lo que ya está en cocina (sale de las comandas reales del pedido) ---------- */
  const keyItem = i => [i.productId, i.sizeId || '', (i.note || '').trim()].join('|');
  const keyCart = c => [c.productId, c.sizeId || '', (c.note || '').trim()].join('|');
  /* El pedido abierto: cuenta de mesa o pedido mandado desde el cobro */
  const ordenActual = () => checkout.floorOrderId || checkout.cmRef || null;
  function enviadoMap(orderId) {
    const m = {};
    if (!orderId) return m;
    tickets().forEach(k => {
      if (k.orderId !== orderId || k.status === 'cancelado') return;
      k.items.forEach(i => { const q = efect(i); if (q > 0) { const kk = keyItem(i); m[kk] = r3n((m[kk] || 0) + q); } });
    });
    return m;
  }
  function pendientesCobro() {
    const sent = enviadoMap(ordenActual());
    const m = {};
    cart.forEach(c => { const k = keyCart(c); m[k] = r3n((m[k] || 0) + (Number(c.qty) || 0)); });
    const out = [];
    Object.keys(m).forEach(k => {
      const q = r3n(m[k] - (sent[k] || 0));
      if (q <= 0) return;
      const c = cart.find(x => keyCart(x) === k);
      const p = findProduct(c.productId);
      out.push({ productId:c.productId, sizeId:c.sizeId || '', name:p ? p.name : 'Producto', size:c.sizeLabel || '', qty:q, note:(c.note || '').trim() });
    });
    return out;
  }
  /* Cuánto de esta línea del carrito ya está en cocina */
  function enviadoDeLinea(i) {
    const c = cart[i];
    if (!c || !activas()) return 0;
    const k = keyCart(c);
    const sent = enviadoMap(ordenActual())[k] || 0;
    if (!sent) return 0;
    const antes = cart.slice(0, i).reduce((a, x) => a + (keyCart(x) === k ? Number(x.qty) || 0 : 0), 0);
    return Math.max(0, Math.min(Number(c.qty) || 0, r3n(sent - antes)));
  }
  /* Etiqueta discreta en el carrito */
  function enCocinaTag(c) {
    const i = cart.indexOf(c);
    const n = i >= 0 ? enviadoDeLinea(i) : 0;
    return n ? `<span class="ci-tag cm-ci-cocina">${icon('chefHat')} ${n >= c.qty ? 'En cocina' : fmtN(n) + ' en cocina'}</span>` : '';
  }
  /* ¿Quitar o bajar esto toca algo que ya está en cocina? Entonces se pregunta */
  function bloqueaQuitar(i, nueva) {
    const n = enviadoDeLinea(i);
    if (!n || nueva >= n - 1e-9) return false;
    yaNoQuiere(i, r3n(n - Math.max(0, nueva)), n);
    return true;
  }
  function bloqueaNota(i, nota) {
    const c = cart[i];
    if (!c || !enviadoDeLinea(i) || (nota || '').trim() === (c.note || '').trim()) return false;
    vibrate([18, 60, 18]);
    toast('Ya está en cocina', { icon:icon('chefHat'), subtitle:'Para otra nota, agrega el producto otra vez.' });
    return true;
  }
  const tieneEnviado = () => cart.some((c, i) => enviadoDeLinea(i) > 0);

  /* "¿Ya no lo quiere?": se avisa a cocina y se quita (mantener presionado) */
  function yaNoQuiere(i, n, max) {
    const c = cart[i];
    if (!c) return;
    st.ynq = { i, n:Math.max(1, Math.min(n, max)), max };
    ynqDibujar();
  }
  function ynqDibujar() {
    const q = st.ynq;
    const c = q && cart[q.i];
    if (!c) { cerrarCapa(); return; }
    const p = findProduct(c.productId);
    q.n = Math.min(Math.max(1, q.n), q.max);
    capa(`
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;"><h2>¿Ya no lo quiere?</h2><span class="mdi-pill prep">Ya está en cocina</span></div>
        <button class="sheet-close" onclick="VPComandas.cerrarCapa()">${icon('close')}</button>
      </div>
      <div class="cm-nh-prod">
        <span class="mdi-thumb">${thumb(c.productId)}</span>
        <b>${escapeHtml(p ? p.name : 'Producto')}${c.sizeLabel ? ' · ' + escapeHtml(c.sizeLabel) : ''}</b>
      </div>
      ${q.max > 1 ? `
      <div class="cm-nh-cant">
        <span>¿Cuántos ya no quiere?</span>
        <div class="cm-step-qty">
          <button type="button" onclick="VPComandas.ynqCant(-1)" ${q.n <= 1 ? 'disabled' : ''} aria-label="Menos">−</button>
          <b>${fmtN(q.n)}</b>
          <button type="button" onclick="VPComandas.ynqCant(1)" ${q.n >= q.max ? 'disabled' : ''} aria-label="Más">+</button>
        </div>
        <small>de ${fmtN(q.max)}</small>
      </div>` : ''}
      <p class="cm-ynq-txt">${icon('chefHat')} Cocina recibe el aviso para no prepararlo.</p>
      <div class="cm-sheet-acts">
        ${holdBtn('cm-go cm-go-no', icon('alert') + ' Avisar a cocina y quitar', 'confirmarYaNoQuiere', [])}
        <button class="cm-undo" onclick="VPComandas.cancelarTodoPedido()">Cancelar todo el pedido</button>
      </div>
    `);
  }
  function ynqCant(d) { if (st.ynq) { st.ynq.n += d; ynqDibujar(); } }
  function avisarCancelacion(orderId, key, n) {
    let rest = n;
    const list = tickets();
    list.filter(t => t.orderId === orderId && t.status !== 'cancelado').sort((a, b) => new Date(b.at) - new Date(a.at)).forEach(t => {
      t.items.forEach(it => {
        if (rest <= 0 || keyItem(it) !== key) return;
        const q = Math.min(efect(it), rest);
        if (q <= 0) return;
        it.cancelado = r3n((Number(it.cancelado) || 0) + q);
        rest = r3n(rest - q);
        t.cancelAlertas = (t.cancelAlertas || []).concat([{ id:uid('ca'), name:it.name, size:it.size || '', qty:q, at:nowIso(), by:meName() }]);
        if (t.items.every(x => efect(x) <= 0)) { t.status = 'cancelado'; t.cancelReason = 'El cliente ya no lo quiso'; }
      });
    });
    saveTickets(list);
  }
  function confirmarYaNoQuiere() {
    const q = st.ynq;
    const c = q && cart[q.i];
    if (!c) { cerrarCapa(); return; }
    const p = findProduct(c.productId);
    const key = keyCart(c);
    const n = Math.min(q.n, q.max);
    avisarCancelacion(ordenActual(), key, n);
    /* Primero la cuenta guardada (con su propia copia) y después el carrito */
    if (checkout.floorOrderId) {
      const r = quitarDeCuenta(checkout.floorOrderId, { productId:c.productId, sizeId:c.sizeId || '', note:(c.note || '').trim() }, n);
      if (r === 'vacia') delete checkout.floorOrderId;
    }
    cart = JSON.parse(JSON.stringify(cart));
    const linea = cart[q.i];
    linea.qty = r3n(linea.qty - n);
    if (linea.qty <= 0) cart.splice(q.i, 1);
    st.ynq = null;
    cerrarCapa();
    render();
    if (document.querySelector('#modal-layer .modal-sheet')) openCartSheet('cart');
    toast('Le avisamos a cocina', { variant:'toast-success', icon:icon('chefHat'), subtitle:'Ya no quiere ' + fmtN(n) + '× ' + (p ? p.name : 'producto') });
  }
  function cancelarTodoPedido() {
    askConfirm({ title:'¿Cancelar todo el pedido?', text:'Cocina deja de prepararlo y recibe el aviso. No se cobra nada.', ok:'Cancelar pedido', cancel:'No', danger:true, icon:icon('trash') }, () => {
      const oid = ordenActual();
      const list = tickets();
      list.forEach(t => {
        if (t.orderId !== oid || t.status === 'cancelado' || t.status === 'entregado') return;
        t.items.forEach(it => { const q = efect(it); if (q > 0) it.cancelado = r3n((Number(it.cancelado) || 0) + q); });
        t.cancelAlertas = (t.cancelAlertas || []).concat([{ id:uid('ca'), todo:true, name:'Todo el pedido', qty:0, at:nowIso(), by:meName() }]);
        t.status = 'cancelado'; t.cancelReason = 'Pedido cancelado';
      });
      saveTickets(list);
      if (checkout.floorOrderId) DB.saveTableOrders(DB.getTableOrders().filter(o => o.id !== checkout.floorOrderId));
      if (checkout.cmPedidoId) quitarPedido(checkout.cmPedidoId);
      cart = []; customItems = {}; checkout = newCheckout();
      st.ynq = null;
      cerrarCapa();
      closeModal();
      render();
      toast('Pedido cancelado', { icon:icon('trash'), subtitle:'Cocina ya está avisada' });
    });
  }

  /* ---------- Cobro: "Mandar a cocina" junto a "Cobrar" (solo con comandas activadas) ---------- */
  function cobroDividido() { return activas() && !esMesero() && cart.length > 0; }
  function botonCocinaHTML() {
    if (!pendientesCobro().length) return `<button type="button" class="btn block cm-p2-cocina cm-p2-off" disabled title="No hay nada nuevo para cocina">
      <span class="cm-hold-in">${icon('chefHat')} Ya está en cocina</span>
    </button>`;
    return `<button type="button" class="btn block cm-hold cm-p2-cocina" data-hold="mandarDesdeCobro" data-args="[]" title="Mantén presionado">
      <span class="cm-hold-fill" aria-hidden="true"></span>
      <span class="cm-hold-in">${icon('comandas')} Mandar a cocina</span>
    </button>`;
  }
  /* Manda a cocina lo que falte (sin cobrar). Si es una mesa, la cuenta queda
     abierta; si no, el pedido queda en "Ventas en espera" para cobrarlo después. */
  function mandarDesdeCobro() {
    if (!cobroDividido()) return;
    const sent = checkout.cmSent || {};
    const mapa = cartMap();
    const items = pendientesCobro();
    if (!items.length) { toast('Todo esto ya está en cocina', { icon:icon('check'), subtitle:'Solo falta cobrar.' }); return; }
    const yo = me();
    let orderId, label, donde;
    const svc = (SERVICE_TYPES.find(x => x.id === checkout.serviceType) || {}).name || 'Pedido';
    const cust = typeof checkoutCustomer === 'function' ? checkoutCustomer() : null;
    if (checkout.floorTableId) {
      const t = VPMesas.layout().find(x => x.id === checkout.floorTableId);
      label = t ? t.name : (checkout.table || 'Mesa');
      const prevId = checkout.floorOrderId;
      checkout.cmSent = mapa;
      if (!parkNow(label, prevId)) { checkout.cmSent = sent; toast('No se pudo guardar el pedido'); return; }
      orderId = prevId || ((VPMesas.openOrders().get(t ? t.id : '') || {}).id) || null;
      donde = 'La cuenta de la mesa queda abierta';
    } else {
      /* Va a "Pedidos en cocina" (lista aparte de Ventas en espera) */
      const ref = checkout.cmRef || uid('ref');
      const lista = DB.getCocina();
      const prev = checkout.cmPedidoId ? (lista.find(x => x.id === checkout.cmPedidoId) || checkout.cmOrig || null) : null;
      const nombre = (checkout.table || '').trim() || (cust ? cust.name : '');
      label = prev ? prev.name : (checkout.cmNombre || (nombre ? svc + ' · ' + nombre : svc + ' · ' + fmtTime(nowIso())));
      checkout.cmNombre = label;
      const id = (prev && prev.id) || checkout.cmPedidoId || uid('e');
      checkout.cmRef = ref;
      checkout.cmPedidoId = id;
      checkout.cmSent = mapa;
      const t = computeTotals();
      const entry = {
        id, name:label, at: prev && prev.at ? prev.at : nowIso(),
        by: prev && prev.by ? prev.by : (yo ? yo.name : meName()), byId: prev && prev.byId ? prev.byId : (yo ? yo.id : meId()),
        cart: JSON.parse(JSON.stringify(cart)), customItems: JSON.parse(JSON.stringify(customItems)),
        checkout: Object.assign({}, checkout, { cash:'', cmOrig:undefined }), total:t.total, units:cartUnitsCount()
      };
      if (!DB.saveCocina(lista.filter(x => x.id !== id).concat([entry]))) { checkout.cmSent = sent; toast('No se pudo guardar el pedido'); return; }
      cart = []; customItems = {}; checkout = newCheckout();
      orderId = ref;
      donde = 'Queda en Ventas en espera para cobrarlo';
    }
    const tks = tickets();
    const ronda = tks.filter(k => k.orderId === orderId).length + 1;
    tks.push({
      id: uid('cm'), orderId, tableId:checkout.floorTableId || '', table:label, round:ronda, items, pos:true,
      by: yo ? yo.name : meName(), byId: yo ? yo.id : meId(),
      at: nowIso(), status:'nuevo'
    });
    saveTickets(tks);
    closeModal();
    render();
    toast('Mandado a cocina', { variant:'toast-success', icon:icon('comandas'), subtitle:label + ' · ' + donde });
  }

  /* ---------- Retomar un pedido de cocina desde Nueva venta ----------
     En lugar de "En espera" el carrito muestra "Regresar a cocina": si el
     cajero lo abrió por error (o solo quería verlo), vuelve a la lista con el
     mismo nombre, hora y estado de cocina. Si le agregó algo, eso nuevo sí se
     manda a cocina como otra ronda. */
  function esPedidoCocina() { return !!checkout.cmPedidoId && !checkout.floorTableId; }
  function botonRegresarCocina() {
    const nuevo = cobroDividido() && pendientesCobro().length > 0;
    return `<button class="btn ghost cm-regresa" onclick="VPComandas.regresarACocina(false)" title="${nuevo ? 'Manda lo nuevo a cocina y guarda el pedido' : 'Vuelve a Pedidos en cocina sin cobrar'}">${icon('chefHat')} ${nuevo ? 'Mandar a cocina' : 'Regresar a cocina'}</button>`;
  }
  function regresarACocina(silencioso) {
    if (!esPedidoCocina()) { if (!silencioso && typeof parkCurrentSale === 'function') parkCurrentSale(); return false; }
    if (!cart.length) { if (!silencioso) toast('El carrito está vacío'); return false; }
    if (!silencioso && cobroDividido() && pendientesCobro().length) { mandarDesdeCobro(); return true; }
    const lista = DB.getCocina();
    const id = checkout.cmPedidoId;
    const prev = lista.find(x => x.id === id) || checkout.cmOrig || {};
    const yo = me();
    const t = computeTotals();
    const label = prev.name || checkout.cmNombre || 'Pedido';
    const entry = {
      id, name:label, at: prev.at || nowIso(),
      by: prev.by || (yo ? yo.name : meName()), byId: prev.byId || (yo ? yo.id : meId()),
      cart: JSON.parse(JSON.stringify(cart)), customItems: JSON.parse(JSON.stringify(customItems)),
      checkout: Object.assign({}, checkout, { cash:'', cmOrig:undefined }), total:t.total, units:cartUnitsCount()
    };
    if (!DB.saveCocina(lista.filter(x => x.id !== id).concat([entry]))) { if (!silencioso) toast('No se pudo guardar el pedido'); return false; }
    cart = []; customItems = {}; checkout = newCheckout();
    if (silencioso) return true;
    closeModal();
    render();
    toast('Regresó a cocina: ' + label, { variant:'toast-success', icon:icon('chefHat'), subtitle:'Sigue en Ventas en espera para cobrarlo' });
    return true;
  }

  /* ---------- Pedidos en cocina (mandados desde el cobro, sin cobrar todavía) ---------- */
  function estadoPedido(p) {
    const ks = tickets().filter(k => k.orderId === (p.checkout || {}).cmRef && k.status !== 'cancelado');
    if (ks.some(k => k.status === 'nuevo' || k.status === 'preparando')) return { cls:'prep', label:'En cocina' };
    if (ks.some(k => k.status === 'listo')) return { cls:'ok', label:'Listo' };
    return { cls:'cancel', label:'Entregado' };
  }
  /* Estado de cocina dentro de Ventas en espera */
  function estadoPedidoHTML(p) {
    const e = estadoPedido(p);
    return ` <span class="mdi-pill ${e.cls} cm-esp-pill">${e.label}</span>`;
  }
  /* Al cobrarlo se quita de la lista */
  function quitarPedido(id) { if (id) DB.saveCocina(DB.getCocina().filter(x => x.id !== id)); }

  /* Al borrar la cuenta: lo que quedaba en cocina se cancela.
     Al cobrarla: lo que ya estaba listo se da por entregado. */
  function cancelarOrden(orderId) {
    if (!orderId) return;
    const list = tickets();
    let changed = false;
    list.forEach(k => {
      if (k.orderId === orderId && (k.status === 'nuevo' || k.status === 'preparando')) {
        k.status = 'cancelado'; k.cancelReason = 'Pedido cancelado';
        k.cancelAlertas = (k.cancelAlertas || []).concat([{ id:uid('ca'), todo:true, name:'Todo el pedido', qty:0, at:nowIso(), by:meName() }]);
        changed = true;
      }
    });
    if (changed) saveTickets(list);
  }
  function cerrarOrden(orderId) {
    if (!orderId) return;
    const list = tickets();
    let changed = false;
    list.forEach(k => { if (k.orderId === orderId && k.status === 'listo') { k.status = 'entregado'; k.deliveredAt = nowIso(); changed = true; } });
    if (changed) saveTickets(list);
  }

  /* =========================================================
     COCINA (comandas en cuadritos)
  ========================================================= */
  function tiempoCls(k) {
    const m = mins(k.at);
    return m >= 25 ? 'late' : (m >= 15 ? 'warn' : '');
  }
  function cocinaHTML() {
    const all = tickets();
    const activas = all.filter(k => k.status === 'nuevo' || k.status === 'preparando').sort((a, b) => new Date(a.at) - new Date(b.at));
    const listas = all.filter(k => k.status === 'listo').sort((a, b) => new Date(b.readyAt || b.at) - new Date(a.readyAt || a.at));
    const nuevas = activas.filter(k => k.status === 'nuevo').length;
    const list = st.kf === 'listas' ? listas : activas;
    const ags = agotadosHoy();
    return `
      <h1 class="page-title">Cocina</h1>
      <p class="page-sub">${activas.length ? plural(activas.length, 'comanda por preparar', 'comandas por preparar') + (nuevas ? ' · ' + plural(nuevas, 'nueva', 'nuevas') : '') : 'Aquí llegan las comandas de los meseros'}</p>
      ${soloBar()}
      <div class="chip-row cm-chips">
        <button class="chip ${st.kf !== 'listas' ? 'active' : ''}" onclick="VPComandas.filtro('activas')">Por preparar <b>${activas.length}</b></button>
        <button class="chip ${st.kf === 'listas' ? 'active' : ''}" onclick="VPComandas.filtro('listas')">Listas sin entregar <b>${listas.length}</b></button>
        <button class="chip ${st.kf === 'agotados' ? 'active' : ''}" onclick="VPComandas.filtro('agotados')">Agotados <b>${ags.length}</b></button>
      </div>
      <div class="cm-av-scroll">${st.kf === 'agotados' ? (ags.length ? `<div class="acc-list cm-ags">${ags.map(a => `
        <div class="acc-row">
          <span class="mdi-thumb">${thumb(a.productId)}</span>
          <span class="acc-txt"><span class="acc-label">${escapeHtml(a.name)}</span><span class="acc-sub">Agotado desde las ${fmtTime(a.at)}</span></span>
          <button type="button" class="btn ghost cm-repon" onclick="VPComandas.reponer('${escapeHtml(a.productId)}')">Ya hay</button>
        </div>`).join('')}</div>` : `
      <div class="mdi-empty"><span class="mdi-empty-ico">${icon('check')}</span><b>No hay nada agotado</b>
        <span>Cuando algo se acabe, en la comanda toca "No hay" y marca "Se acabó por hoy".</span></div>`) : list.length ? `<div class="mdi-list cm-kds">${list.map(k => {
        const e = ESTADOS[k.status];
        const notas = k.items.some(i => i.note);
        return `<button type="button" class="mdi-card cm-tk st-${k.status} ${k.status !== 'listo' ? tiempoCls(k) : ''}" onclick="VPComandas.abrirComanda('${k.id}')">
          <div class="mdi-card-top">
            <span class="mdi-code">${escapeHtml(k.table)}</span>
            <span class="mdi-pill ${e.cls}">${e.label}</span>
            <span class="mdi-pill cancel">Ronda ${k.round || 1}</span>
            <span class="mdi-time cm-timer">${icon('clock')} ${k.status === 'listo' ? 'Lista ' + ago(k.readyAt || k.at) : ago(k.at)}</span>
          </div>
          <div class="mdi-name">${icon('person')} ${escapeHtml(k.by || 'Mesero')}</div>
          <div class="mdi-items">${resumen(k.items)}</div>
          <div class="mdi-card-foot"><span>${plural(unitsOf(k.items), 'producto', 'productos')}${notas ? ` · <i class="cm-has-note">${icx('note')} Con notas</i>` : ''}${k.items.some(i => i.falta) ? ` · <i class="cm-has-out">${icon('alert')} Falta algo</i>` : ''}${k.items.some(i => i.cancelado) ? ` · <i class="cm-has-out">${icon('close')} Cancelaron algo</i>` : ''}</span><b>${fmtTime(k.at)}</b></div>
        </button>`;
      }).join('')}</div>` : `
      <div class="mdi-empty">
        <span class="mdi-empty-ico">${icon('inbox')}</span>
        <b>${st.kf === 'listas' ? 'No hay comandas esperando al mesero' : 'Sin comandas por ahora'}</b>
        <span>${st.kf === 'listas' ? 'Las que marques como listas aparecen aquí hasta que el mesero las entregue.' : 'Cuando un mesero mande un pedido, aparecerá aquí con un aviso.'}</span>
      </div>`}</div>`;
  }
  function filtro(f) { st.kf = f; vibrate(6); render.fresh = true; render(); window.scrollTo(0, 0); }

  function abrirComanda(id) {
    const k = tickets().find(x => x.id === id);
    if (!k) { closeModal(); render(); return; }
    st.open = { kind:'comanda', id };
    openModal(comandaHTML(k), { dismissible:true });
  }
  /* Íconos de los pasos de cocina */
  const FIRE = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21c-4 0-6.5-2.7-6.5-6.2 0-3.4 2.6-5.4 3.6-8.8.3-1 1.6-1.2 2.2-.4 1 1.4 1.4 2.8 1.4 4 .8-.5 1.4-1.3 1.6-2.3.2-.7 1-.9 1.5-.4 1.6 1.7 2.7 4 2.7 7 0 4-2.5 7.1-6.5 7.1Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 21c-1.8 0-3-1.2-3-2.9 0-1.9 1.6-2.7 2.3-4.3.8 1 3.7 2 3.7 4.4 0 1.6-1.2 2.8-3 2.8Z" fill="currentColor"/></svg>';
  function pasosHTML(st) {
    const i = { nuevo:0, preparando:1, listo:2, entregado:2 }[st] ?? 0;
    const p = [[icon('inbox'), 'Nueva'], [FIRE, 'Cocinando'], [icon('check'), 'Lista']];
    return `<div class="cm-steps">${p.map((x, n) => `<span class="cm-step ${n < i ? 'done' : ''} ${n === i ? 'now' : ''}"><i>${x[0]}</i><small>${x[1]}</small></span>${n < 2 ? '<b class="cm-step-bar ' + (n < i ? 'done' : '') + '"></b>' : ''}`).join('')}</div>`;
  }
  function comandaHTML(k) {
    const e = ESTADOS[k.status];
    const notas = k.items.filter(i => i.note).length;
    let acts = '';
    if (k.status === 'nuevo') acts = `
      ${holdBtn('cm-go cm-go-prep', FIRE + ' Empezar a preparar', 'estado', [k.id, 'preparando'])}`;
    else if (k.status === 'preparando') acts = `
      ${holdBtn('cm-go cm-go-ok', icon('check') + ' Ya terminé de preparar', 'estado', [k.id, 'listo'])}`;
    else if (k.status === 'listo') acts = `
      <div class="cm-wait">${icon('bell')} Esperando al mesero</div>
      <button class="cm-undo" onclick="VPComandas.estado('${k.id}','preparando')">Deshacer</button>`;
    return `
      <i class="fs-marker" hidden></i><i class="cm-open" data-id="${k.id}" hidden></i>
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;">
          <h2>${escapeHtml(k.table)}</h2>
          <span class="mdi-pill ${e.cls}">${e.label}</span>
        </div>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <div class="cm-kmeta">
        <span>${icon('person')} ${escapeHtml(k.by || '')}</span>
        <span>${icon('clock')} ${ago(k.at)}</span>
        <span>Ronda ${k.round || 1}</span>
      </div>
      ${pasosHTML(k.status)}
      ${notas ? `<div class="cm-notes-flag">${icx('note')} ${plural(notas, 'nota', 'notas')}</div>` : ''}
      <div class="cm-lines">${lineasHTML(k.items, (k.status === 'nuevo' || k.status === 'preparando') ? k.id : null)}</div>
      <div class="cm-sheet-acts">${acts}</div>`;
  }

  /* ---------- "No hay": cocina quita algo y le avisa al mesero ---------- */
  function noHay(tid, idx) {
    const k = tickets().find(x => x.id === tid);
    const it = k && k.items[idx];
    if (!it || efect(it) <= 0) return;
    st.nh = { tid, idx, n:efect(it), agotar:false };
    noHayDibujar();
  }
  function noHayDibujar() {
    const nh = st.nh;
    const k = nh && tickets().find(x => x.id === nh.tid);
    const it = k && k.items[nh.idx];
    if (!it) { cerrarCapa(); return; }
    const max = efect(it);
    nh.n = Math.min(Math.max(1, nh.n), max);
    capa(`
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;"><h2>¿No hay?</h2><span class="mdi-pill no">${escapeHtml(k.table)}</span></div>
        <button class="sheet-close" onclick="VPComandas.cerrarCapa()">${icon('close')}</button>
      </div>
      <div class="cm-nh-prod">
        <span class="mdi-thumb">${thumb(it.productId)}</span>
        <b>${escapeHtml(it.name)}${it.size ? ' · ' + escapeHtml(it.size) : ''}</b>
      </div>
      ${max > 1 ? `
      <div class="cm-nh-cant">
        <span>¿Cuántos no hay?</span>
        <div class="cm-step-qty">
          <button type="button" onclick="VPComandas.nhCant(-1)" ${nh.n <= 1 ? 'disabled' : ''} aria-label="Menos">−</button>
          <b>${fmtN(nh.n)}</b>
          <button type="button" onclick="VPComandas.nhCant(1)" ${nh.n >= max ? 'disabled' : ''} aria-label="Más">+</button>
        </div>
        <small>de ${fmtN(max)}</small>
      </div>` : ''}
      <label class="cm-nh-agotar">
        <span><b>Ya no queda nada</b><small>Nadie lo podrá pedir hasta que toques «Ya hay» (o mañana)</small></span>
        <span class="switch"><input type="checkbox" ${nh.agotar ? 'checked' : ''} onchange="VPComandas.nhAgotar(this.checked)"><span class="track"></span></span>
      </label>
      <div class="cm-sheet-acts">
        ${holdBtn('cm-go cm-go-no', icon('alert') + ' Avisar al mesero', 'confirmarNoHay', [])}
        <button class="cm-undo" onclick="VPComandas.cerrarCapa()">Sí hay, regresar</button>
      </div>
    `);
  }
  /* Ventanita encima de la hoja abierta (la de la mesa se queda atrás) */
  function capa(html) {
    let l = document.getElementById('confirm-layer');
    if (!l) { l = document.createElement('div'); l.id = 'confirm-layer'; document.body.appendChild(l); }
    if (typeof askConfirm === 'function' && typeof askConfirm._close === 'function') askConfirm._close();
    const nueva = !l.querySelector('.cm-capa');
    l.innerHTML = `<div class="modal-overlay modal-center conf-overlay cm-capa ${nueva ? '' : 'cm-capa-quieta'}" onclick="if(event.target===this)VPComandas.cerrarCapa()">
      <div class="modal-sheet modal-card conf-card cm-capa-card" role="dialog" aria-modal="true">${html}</div></div>`;
  }
  function cerrarCapa() {
    const l = document.getElementById('confirm-layer');
    if (l && l.querySelector('.cm-capa')) l.innerHTML = '';
    st.nh = null;
  }
  function nhCant(d) { if (st.nh) { st.nh.n += d; noHayDibujar(); } }
  function nhAgotar(v) { if (st.nh) st.nh.agotar = !!v; }

  /* Total de una cuenta con el cálculo de siempre del POS */
  function totalDe(cartArr, custom, chk) {
    const keep = { cart, customItems, checkout };
    try {
      cart = cartArr; customItems = custom || {}; checkout = chk || newCheckout();
      return { total:computeTotals().total, units:cartUnitsCount() };
    } finally { cart = keep.cart; customItems = keep.customItems; checkout = keep.checkout; }
  }
  /* Quita de la cuenta lo que no hubo (para que caja no lo cobre) */
  function quitarDeCuenta(orderId, it, n) {
    /* Copia propia: el carrito abierto puede compartir las mismas líneas en memoria */
    const list = JSON.parse(JSON.stringify(DB.getTableOrders()));
    const o = list.find(x => x.id === orderId);
    if (!o) return false;
    let falta = n;
    const mismo = c => c.productId === it.productId && (c.sizeId || '') === (it.sizeId || '');
    const orden = (o.cart || []).filter(c => mismo(c) && (c.note || '').trim() === (it.note || '')).concat((o.cart || []).filter(c => mismo(c) && (c.note || '').trim() !== (it.note || '')));
    orden.forEach(c => { if (falta <= 0) return; const q = Math.min(Number(c.qty) || 0, falta); c.qty = Math.round((c.qty - q) * 1000) / 1000; falta -= q; });
    o.cart = (o.cart || []).filter(c => c.qty > 0);
    if (!o.cart.length) {
      DB.saveTableOrders(list.filter(x => x.id !== orderId));     /* no quedó nada: la mesa se libera */
      return 'vacia';
    }
    const t = totalDe(o.cart, o.customItems, o.checkout);
    o.total = t.total; o.units = t.units;
    o.cm = Object.assign({}, o.cm, { updatedAt:nowIso() });
    DB.saveTableOrders(list);
    return true;
  }
  function confirmarNoHay() {
    const nh = st.nh;
    if (!nh) return;
    const list = tickets();
    const k = list.find(x => x.id === nh.tid);
    const it = k && k.items[nh.idx];
    if (!it) { cerrarCapa(); return; }
    const n = Math.min(nh.n, efect(it));
    if (n <= 0) return;
    it.falta = Math.round(((Number(it.falta) || 0) + n) * 1000) / 1000;
    k.alertas = (k.alertas || []).concat([{ id:uid('al'), name:it.name, size:it.size || '', productId:it.productId, qty:n, at:nowIso(), by:meName(), visto:false }]);
    if (k.items.every(i => efect(i) <= 0)) { k.status = 'cancelado'; k.cancelReason = 'No hubo'; }
    saveTickets(list);
    const r = quitarDeCuenta(k.orderId, it, n);
    if (r === 'vacia') { const l2 = tickets(); l2.forEach(x => { if (x.orderId === k.orderId && x.alertas) x.alertas.forEach(a => { a.mesaLibre = true; }); }); saveTickets(l2); }
    if (nh.agotar) marcarAgotado(it.productId, it.name);
    cerrarCapa();
    if (k.status === 'cancelado') closeModal(); else abrirComanda(k.id);
    render();
    toast('Le avisamos a ' + (k.by || 'el mesero'), { variant:'toast-success', icon:icon('check'), subtitle:'No hay ' + fmtN(n) + '× ' + it.name + (nh.agotar ? ' · agotado por hoy' : '') });
  }

  function estado(id, nuevo) {
    const list = tickets();
    const k = list.find(x => x.id === id);
    if (!k) return;
    k.status = nuevo;
    if (nuevo === 'preparando') { k.startedAt = k.startedAt || nowIso(); k.readyAt = null; }
    if (nuevo === 'listo') { k.readyAt = nowIso(); k.readyBy = meName(); k.startedAt = k.startedAt || k.at; }
    saveTickets(list);
    if (nuevo === 'listo') {
      closeModal();
      toast('Comanda lista', { variant:'toast-success', icon:icon('check'), subtitle:k.table + ' · se le avisó al mesero' });
    } else abrirComanda(id);
    render();
  }

  /* =========================================================
     HISTORIAL
  ========================================================= */
  function historial() {
    const yo = me();
    if (esCajero()) { historialCaja(yo); return; }
    const cocina = esCocina();
    const list = tickets()
      .filter(t => cocina ? (t.status === 'listo' || t.status === 'entregado') : (yo && t.byId === yo.id))
      .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 80);
    openModal(`
      <div class="sheet-header">
        <h2>Historial</h2>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <p class="sheet-text">${cocina ? 'Comandas que preparaste en los últimos 3 días.' : 'Comandas que mandaste en los últimos 3 días.'}</p>
      ${list.length ? `<div class="cm-hist">${list.map(t => `
        <div class="cm-hist-row">
          <div class="cm-hist-h">
            <b>${escapeHtml(t.table)} · Ronda ${t.round || 1}</b>
            <span class="mdi-pill ${ESTADOS[t.status].cls}">${ESTADOS[t.status].label}</span>
          </div>
          <div class="cm-hist-sub">${fmtDay(t.at)} · ${fmtTime(t.at)}${cocina && t.by ? ' · ' + escapeHtml(t.by) : ''}${t.readyAt ? ' · lista ' + fmtTime(t.readyAt) : ''}</div>
          <div class="cm-ronda-items">${t.items.map(itemTxt).join('')}</div>
        </div>`).join('')}</div>` : `
        <div class="mdi-empty"><span class="mdi-empty-ico">${icon('inbox')}</span><b>Aún no hay nada aquí</b>
          <span>${cocina ? 'Las comandas que marques como listas aparecerán aquí.' : 'Las comandas que mandes a cocina aparecerán aquí.'}</span></div>`}
    `, { dismissible:true });
  }

  function historialCaja(yo) {
    const list = DB.getSales().filter(s => yo && s.userId === yo.id && !s.cancelled)
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 80);
    const hoy = list.filter(s => isSameDay(new Date(s.date), new Date()));
    const totalHoy = hoy.reduce((a, s) => a + s.total + (s.tip || 0), 0);
    openModal(`
      <div class="sheet-header">
        <h2>Historial</h2>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      ${list.length ? `<p class="mdi-today-sum">Hoy: ${plural(hoy.length, 'cobro', 'cobros')} · <b>${formatMoney(totalHoy)}</b></p>
      <div class="cm-hist">${list.map(s => `
        <div class="cm-hist-row">
          <div class="cm-hist-h">
            <b>${escapeHtml(s.table || orderNumberLabel(s.number))}</b>
            <b>${formatMoney(s.total + (s.tip || 0))}</b>
          </div>
          <div class="cm-hist-sub">${fmtDay(s.date)} · ${fmtTime(s.date)} · ${escapeHtml(paymentOf(s.paymentMethod).name)}${s.tip ? ' · propina ' + formatMoney(s.tip) : ''}</div>
          <div class="cm-ronda-items">${(s.items || []).map(i => `<span><b>${fmtN(i.qty)}×</b> ${escapeHtml(i.name || '')}</span>`).join('')}</div>
        </div>`).join('')}</div>` : `
        <div class="mdi-empty"><span class="mdi-empty-ico">${icon('inbox')}</span><b>Aún no hay cobros</b><span>Las cuentas que cobres aparecerán aquí.</span></div>`}
    `, { dismissible:true });
  }

  function cambiar() { closeModal(); window.scrollTo(0, 0); switchUser(); }

  /* ---------- Mi perfil (el círculo con tu nombre, arriba a la derecha) ----------
     Mismo diseño de filas que Usuarios del POS. Reutiliza la foto y el NIP
     de siempre (cada quien solo cambia lo suyo). */
  const esSolo = () => !!myArea();
  function perfil() {
    const u = me();
    if (!u) return;
    const ph = userPhoto(u);
    const row = (fn, ico, cls, label, sub) => `
      <button class="acc-row" onclick="${fn}">
        <span class="acc-ico ${cls}">${ico}</span>
        <span class="acc-txt"><span class="acc-label">${label}</span><span class="acc-sub">${sub}</span></span>
        <span class="acc-chev">${icon('chevronRight')}</span>
      </button>`;
    openModal(`
      <div class="sheet-header">
        <h2>Mi perfil</h2>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <div class="cm-perfil">
        <span class="cm-perfil-av">${ph ? `<img src="${ph}" alt="">` : userInitials(u)}</span>
        <b>${escapeHtml(u.name)}</b>
        <span class="role-chip ${u.role}">${AREAS[u.area] ? AREAS[u.area].name : roleOf(u.role).name}</span>
      </div>
      <div class="acc-list">
        ${row('VPComandas.nombre()', icon('person'), 'green', 'Mi nombre', escapeHtml(u.name))}
        ${row(`openSetPinForm('${u.id}', true)`, icon('key'), 'gold', 'Mi contraseña (NIP)', u.pin ? 'Cambiar tu NIP de 4 dígitos' : 'Crea tu NIP de 4 dígitos')}
        ${row(`openUserPhotoForm('${u.id}')`, ph ? `<img src="${ph}" alt="">` : icon('camera'), ph ? 'has-photo' : 'blue', 'Mi foto', ph ? 'Cambiar o quitar la foto' : 'Ponle una foto a tu usuario')}
      </div>
      <div class="acc-list" style="margin-top:14px;">
        ${row('VPComandas.cambiar()', icon('swap'), '', 'Cambiar de cuenta', 'Cierra tu turno y entra con otra persona')}
      </div>
    `, { dismissible:true });
  }
  function nombre() {
    const u = me();
    if (!u) return;
    openModal(`
      <h3 class="sheet-title">Mi nombre</h3>
      <p class="sheet-text">Así te verán tus compañeros en las mesas y en cocina.</p>
      <div class="field">
        <label for="cmMiNombre">Nombre</label>
        <input id="cmMiNombre" type="text" maxlength="40" value="${escapeHtml(u.name)}" autocomplete="off">
      </div>
      <div class="sheet-actions">
        <button class="btn ghost block" onclick="VPComandas.perfil()">Cancelar</button>
        <button class="btn primary block" onclick="VPComandas.guardarNombre()">Guardar</button>
      </div>
    `, { dismissible:true });
  }
  function guardarNombre() {
    const el = document.getElementById('cmMiNombre');
    const name = ((el && el.value) || '').trim();
    if (name.length < 2) { toast('Escribe tu nombre'); if (el) el.focus(); return; }
    const yo = me();
    const list = DB.getUsers();
    const u = yo && list.find(x => x.id === yo.id);
    if (!u) return;
    u.name = name;
    DB.saveUsers(list);
    paintChrome();
    render();
    perfil();
    toast('Nombre guardado', { variant:'toast-success', icon:icon('check'), subtitle:name });
  }

  /* ---------- Vista principal ---------- */
  function view() {
    const area = myArea();
    if (area === 'mesero') return meseroHTML();
    if (area === 'cocina') return cocinaHTML();
    if (area === 'caja') return cajaHTML();
    if (!puedeAdministrar()) return '';
    if (!activas()) { st.screen = 'home'; st.area = null; st.form = null; st.permsDraft = null; }
    if (st.screen === 'area' && AREAS[st.area]) { queueMicrotask(cerrarFull); return areaHTML(); }
    if (FULL[st.screen] && AREAS[st.area]) { queueMicrotask(pintarFull); return areaHTML(); }
    st.screen = 'home';
    queueMicrotask(cerrarFull);
    return homeHTML();
  }

  /* Repinta lo que se ve (pantalla y la hoja abierta) tras un cambio */
  function refresh() {
    try {
      if (document.querySelector('.cm-hold.holding')) { setTimeout(refresh, 900); return; }
      const sheet = document.querySelector('#modal-layer .modal-sheet');
      const mk = sheet && sheet.querySelector('.cm-open');
      if (st.open && mk && mk.dataset.id === st.open.id) {
        const ok = st.open.kind === 'cuenta' ? orderById(st.open.id) : tickets().find(x => x.id === st.open.id);
        if (!ok) closeModal();
        else {
          const y = sheet.scrollTop;
          if (st.open.kind === 'cuenta') abrirCuenta(st.open.id); else abrirComanda(st.open.id);
          const sh = document.querySelector('#modal-layer .modal-sheet');
          if (sh) sh.scrollTop = y;
        }
      }
      if (currentView === 'comandas' && myArea()) render();
    } catch (e) {}
  }
  setInterval(() => { if (currentView === 'comandas' && myArea() && !document.querySelector('#modal-layer .modal-overlay')) render(); }, 30000);

  /* Avisos de lo que llega desde otro aparato */
  function avisos(antes, despues, antesAl, antesCan) {
    const area = myArea();
    const yo = me();
    if (area === 'cocina' && antesCan) {
      const cans = [];
      despues.forEach(k => { (k.cancelAlertas || []).slice(antesCan[k.id] || 0).forEach(a => cans.push(Object.assign({ table:k.table }, a))); });
      if (cans.length) {
        beep(); vibrate([60, 60, 60]);
        const a = cans[0];
        toast(a.todo ? a.table + ': cancelaron el pedido' : a.table + ': ya no quiere ' + fmtN(a.qty) + '× ' + a.name, { icon:icon('close'), variant:'toast-danger toast-top', subtitle:'No lo prepares', duration:5000 });
      }
    }
    if (area === 'mesero' && antesAl) {
      const nuevos = [];
      despues.forEach(k => {
        const prev = antesAl[k.id] || 0;
        (k.alertas || []).slice(prev).forEach(a => {
          if (a.visto) return;
          const o = orderById(k.orderId);
          if (o ? esMiMesa(o) : (!!yo && k.byId === yo.id)) nuevos.push(Object.assign({ table:k.table }, a));
        });
      });
      if (nuevos.length) {
        beep(); vibrate([60, 60, 60]);
        toast(nuevos[0].table + ': no hay ' + nuevos[0].name, { icon:icon('alert'), variant:'toast-danger toast-top', subtitle:'Avísale al cliente · está en Avisos', duration:5000 });
      }
    }
    const nuevas = despues.filter(k => k.status === 'nuevo' && !antes[k.id]);
    const listas = despues.filter(k => k.status === 'listo' && antes[k.id] && antes[k.id] !== 'listo');
    if (area === 'cocina' && nuevas.length) {
      beep(); vibrate([30, 80, 30]);
      toast(nuevas.length === 1 ? 'Nueva comanda · ' + nuevas[0].table : nuevas.length + ' comandas nuevas', { icon:icon('bell'), variant:'toast-success toast-top', subtitle:nuevas.length === 1 ? 'De ' + (nuevas[0].by || 'el mesero') : '', duration:3500 });
    }
    const delCobro = (area === 'caja' || !area) ? listas.filter(k => k.pos && !!yo && k.byId === yo.id) : [];
    if (delCobro.length) {
      beep(); vibrate([30, 80, 30]);
      toast(delCobro[0].table + ' · lista', { icon:icon('bell'), variant:'toast-success toast-top', subtitle:'Ya está lista en cocina', duration:4000 });
    }
    const mias = area === 'mesero' ? listas.filter(k => { const o = orderById(k.orderId); return o ? esMiMesa(o) : (!!yo && k.byId === yo.id); }) : [];
    if (mias.length) {
      beep(); vibrate([30, 80, 30]);
      toast(mias[0].table + ' · comanda lista', { icon:icon('bell'), variant:'toast-success toast-top', subtitle:'Pásala a recoger a cocina', duration:4000 });
    }
  }

  /* =========================================================
     EN VIVO ENTRE APARATOS (Supabase · vp_comandas_sync)
     - Cada cuenta de mesa y cada comanda es una fila.
     - Lo que cambia en este aparato se sube; lo que cambia en otro llega
       al instante (Realtime) y además se revisa cada 20 s.
     - "dirty" = cambiado aquí y todavía sin subir: eso nunca se pisa.
  ========================================================= */
  const Sync = (() => {
    const SK = 'cm_sync_state2';
    let s = { uid:null, known:{}, dirty:[] };
    let last = {};            /* id -> {k,h}: cómo estaba lo local la última vez que lo vimos */
    let dirty = new Set();
    let muted = false, hooked = false, busy = false, again = false, timer = null, ch = null, chUid = null, poll = null;

    const can = () => { try { return Cloud.ready && !!Cloud.uid && !!Cloud.sb && AUTH.isLogged(); } catch (e) { return false; } };
    const inUse = () => { try { return activas() || DB.getUsers().some(u => AREAS[u.area]) || DB.getTableOrders().some(o => o.cm) || tickets().length > 0 || Store.list(AKEY).length > 0; } catch (e) { return false; } };
    const online = () => can();

    /* Huella del dato con las llaves en orden fijo: la nube (jsonb) las
       regresa en otro orden y sin esto cada revisión parecía un cambio
       (se volvía a dibujar la hoja abierta y se cortaba el "mantener"). */
    function canon(v) {
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
      return JSON.stringify(v === undefined ? null : v);
    }
    function snapshot() {
      const m = {};
      DB.getTableOrders().forEach(o => { m[o.id] = { k:'cuenta', h:canon(o), d:o }; });
      tickets().forEach(t => { m[t.id] = { k:'comanda', h:canon(t), d:t }; });
      Store.list(AKEY).forEach(a => { if (a && a.id) m[a.id] = { k:'agotado', h:canon(a), d:a }; });
      return m;
    }
    function load(uid) {
      try { const r = JSON.parse(localStorage.getItem(SK) || 'null'); s = (r && r.uid === uid) ? r : { uid, known:{}, dirty:[] }; }
      catch (e) { s = { uid, known:{}, dirty:[] }; }
      s.known = s.known || {};
      dirty = new Set(s.dirty || []);
    }
    function save() { s.dirty = [...dirty]; try { localStorage.setItem(SK, JSON.stringify(s)); } catch (e) {} }
    const strip = m => { const o = {}; Object.keys(m).forEach(id => { o[id] = { k:m[id].k, h:m[id].h }; }); return o; };

    /* Un cambio hecho en este aparato */
    function onLocal() {
      const cur = snapshot();
      if (muted) { last = strip(cur); return; }
      const ids = new Set(Object.keys(cur).concat(Object.keys(last)));
      ids.forEach(id => {
        if ((cur[id] && cur[id].h) === (last[id] && last[id].h)) return;
        dirty.add(id);
        if (!cur[id] && last[id]) s.known[id] = Object.assign({}, s.known[id] || {}, { k:last[id].k });
      });
      last = strip(cur);
      save();
      soon(300);
    }
    function hook() {
      if (hooked || typeof Store === 'undefined' || !Store._changed) return;
      hooked = true;
      const prev = Store._changed;
      Store._changed = function (k) { prev.call(this, k); if (k === 'mesa_parked' || k === KEY || k === AKEY) onLocal(); };
      last = strip(snapshot());
      /* La copia general de la nube (al abrir la app) puede traer cuentas
         viejas: después de bajarla se revisa contra lo que está en vivo. */
      try {
        const h = Cloud.hydrate;
        Cloud.hydrate = async function () { const r = await h.apply(this, arguments); last = strip(snapshot()); soon(200); return r; };
      } catch (e) {}
    }

    async function push() {
      const ids = [...dirty];
      if (!ids.length) return;
      const cur = snapshot();
      const rows = ids.map(id => cur[id]
        ? { user_id:Cloud.uid, id, kind:cur[id].k, data:cur[id].d, deleted:false }
        : { user_id:Cloud.uid, id, kind:((s.known[id] || {}).k) || 'comanda', data:{}, deleted:true });
      const { error } = await Cloud.sb.from(T).upsert(rows, { onConflict:'user_id,id' });
      if (error) throw error;
      const now = snapshot();
      ids.forEach(id => {
        const a = cur[id] ? cur[id].h : null, b = now[id] ? now[id].h : null;
        if (a !== b) return;             /* cambió otra vez mientras subía: se sube en la siguiente */
        dirty.delete(id);
        if (a) s.known[id] = { k:cur[id].k, h:a }; else delete s.known[id];
      });
      save();
    }

    async function pull() {
      const since = new Date(Date.now() - 3 * 86400000).toISOString();
      const { data, error } = await Cloud.sb.from(T).select('id,kind,data,deleted').or('deleted.eq.false,updated_at.gte.' + since).limit(3000);
      if (error) throw error;
      const remote = {};
      (data || []).forEach(r => { remote[r.id] = r; });
      const cur = snapshot();
      const orders = {}, tks = {}, ags = {};
      const bagOf = k => k === 'cuenta' ? orders : (k === 'agotado' ? ags : tks);
      Object.keys(cur).forEach(id => { bagOf(cur[id].k)[id] = cur[id].d; });
      const antes = {}, antesAl = {}, antesCan = {}; tickets().forEach(t => { antes[t.id] = t.status; antesAl[t.id] = (t.alertas || []).length; antesCan[t.id] = (t.cancelAlertas || []).length; });
      let changed = false;
      (data || []).forEach(r => {
        if (dirty.has(r.id)) return;
        const bag = bagOf(r.kind);
        if (r.deleted) {
          if (bag[r.id]) { delete bag[r.id]; changed = true; }
          delete s.known[r.id];
          return;
        }
        const h = canon(r.data);
        s.known[r.id] = { k:r.kind, h };
        if (!cur[r.id] || cur[r.id].h !== h) { bag[r.id] = r.data; changed = true; }
      });
      Object.keys(cur).forEach(id => {
        if (remote[id] || dirty.has(id)) return;
        if (s.known[id]) {                          /* ya no existe en la nube */
          delete bagOf(cur[id].k)[id]; delete s.known[id]; changed = true;
        } else dirty.add(id);                       /* nunca se subió: se sube */
      });
      if (changed) {
        muted = true;
        try {
          DB.saveTableOrders(Object.values(orders));
          Store.set(KEY, Object.values(tks));
          Store.set(AKEY, Object.values(ags));
        } finally { muted = false; }
        last = strip(snapshot());
        avisos(antes, Object.values(tks), antesAl, antesCan);
        refresh();
      }
      save();
    }

    async function run() {
      if (!can()) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        if (s.uid !== Cloud.uid) load(Cloud.uid);
        await push();
        await pull();
        if (dirty.size) await push();
      } catch (e) {
        console.warn('Vendo plus · comandas en vivo', e);
        soon(8000);
      } finally {
        busy = false;
        if (again) { again = false; soon(200); }
      }
    }
    function soon(ms) { clearTimeout(timer); timer = setTimeout(run, ms || 300); }

    function listen() {
      if (ch && chUid === Cloud.uid) return;
      try { if (ch) Cloud.sb.removeChannel(ch); } catch (e) {}
      ch = null; chUid = null;
      try {
        const uid = Cloud.uid;
        chUid = uid;
        ch = Cloud.sb.channel('vp-comandas-' + uid)
          .on('postgres_changes', { event:'*', schema:'public', table:T, filter:'user_id=eq.' + uid }, () => soon(150))
          .subscribe(status => {
            if (status === 'SUBSCRIBED') soon(200);
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              if (chUid !== uid) return;
              setTimeout(() => { ch = null; chUid = null; tick(); }, 4000);
            }
          });
      } catch (e) { ch = null; chUid = null; }
    }

    /* Se llama en cada render y cada pocos segundos */
    function tick() {
      hook();
      if (!can() || !inUse()) return;
      if (s.uid !== Cloud.uid) load(Cloud.uid);
      listen();
      if (!poll) {
        poll = setInterval(() => { if (can() && inUse() && document.visibilityState !== 'hidden') run(); }, 20000);
        soon(400);
      }
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); soon(300); } });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else setTimeout(hook, 0);
    setInterval(tick, 5000);

    return { tick, online, run };
  })();

  return {
    abrir, guard, esMesero, esCocina, esCajero, puedeAdministrar,
    area, agregar, nuevo, editar, campo, cargo, permisos, perm, guardarPermisos, volverForm, guardarUsuario, asignar, quitar,
    tocarMesa, abrirCuenta, verLista, entregarGrupo, tabMesero, tomarMesa, verAviso, avisoVisto, ronda, saleHead, salirMesa, cartActions, enviar, entregar, pedirCuenta, desbloquearCuenta,
    cobrar, editarCuenta, cancelarOrden, cerrarOrden,
    portada, portadaHTML, ayuda, cerrarAyuda, buscarAdd, volverAdd, esSolo, perfil, nombre, guardarNombre, estadoPedidoHTML, esPedidoCocina, botonRegresarCocina, regresarACocina, enCocinaTag, bloqueaQuitar, bloqueaNota, tieneEnviado, ynqCant, confirmarYaNoQuiere, cancelarTodoPedido, quitarPedido, activas, activar, cobroDividido, botonCocinaHTML, mandarDesdeCobro,
    filtro, abrirComanda, estado, noHay, cerrarCapa, nhCant, nhAgotar, confirmarNoHay, reponer, agotado, bloqueaAgotado, historial, cambiar, sync:() => Sync.run()
  };
})();
