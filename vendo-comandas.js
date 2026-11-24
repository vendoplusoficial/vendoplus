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
  const st = { screen:'home', area:null, form:null, permsDraft:null, kf:'activas', open:null };

  /* ---------- Quién está usando la app ---------- */
  function myArea() {
    try {
      if (!multiUser()) return null;
      const u = activeUser();
      if (!u || u.role === 'dueno') return null;
      return AREAS[u.area] ? u.area : null;
    } catch (e) { return null; }
  }
  const esMesero = () => myArea() === 'mesero';
  const esCocina = () => myArea() === 'cocina';
  const esCajero = () => myArea() === 'caja';
  function puedeAdministrar() { try { return isOwner(); } catch (e) { return false; } }
  const me = () => { try { return activeUser(); } catch (e) { return null; } };

  /* Se llama al inicio de cada render(): cada quien ve solo su sección */
  function guard() {
    if (typeof EXTRA_VIEWS !== 'undefined' && EXTRA_VIEWS.comandas !== view) EXTRA_VIEWS.comandas = view;
    const area = myArea();
    if (area === 'mesero') {
      if (!(currentView === 'sale' && checkout.floorTableId)) currentView = 'comandas';
    } else if (area === 'cocina' || area === 'caja') {
      currentView = 'comandas';
    } else if (currentView === 'comandas' && !puedeAdministrar()) {
      currentView = 'sale';
    }
    const b = document.body.classList;
    b.toggle('cm-solo', !!area);
    b.toggle('cm-mesero', area === 'mesero');
    b.toggle('cm-admin', puedeAdministrar());
    Sync.tick();
  }

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
  const unitsOf = items => items.reduce((a, i) => a + (Number.isInteger(i.qty) ? i.qty : 1), 0);
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
  const thumb = productId => { const p = productId ? findProduct(productId) : null; return p && p.image ? `<img src="${p.image}" alt="">` : icon('plate'); };

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

  function homeHTML() {
    const vivo = Sync.online();
    return `
      <h1 class="page-title">Comandas</h1>
      <p class="page-sub">Elige un área para ver y agregar a tu equipo</p>
      <div class="cm-areas">
        ${ORDER.map(id => {
          const n = gente(id).length;
          return `<button type="button" class="cm-area" onclick="VPComandas.area('${id}')">
            <span class="cm-area-art">${ART[id]}</span>
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
      <div class="cm-how">
        <div class="cm-how-t">Así trabajan juntos</div>
        <ol>
          <li><b>Mesero</b> abre la mesa, toma el pedido y lo manda a cocina.</li>
          <li><b>Cocinero</b> recibe la comanda, la prepara y la marca como lista.</li>
          <li><b>Mesero</b> recibe el aviso, la sirve y pide la cuenta cuando el cliente quiere pagar.</li>
          <li><b>Caja</b> ve la cuenta de cada mesa y la cobra. La mesa queda libre.</li>
        </ol>
        <p class="cm-live ${vivo ? 'on' : ''}">${icon(vivo ? 'check' : 'alert')} ${vivo
          ? 'En vivo: cada quien puede usar su propio celular o tablet con tu misma cuenta.'
          : 'Sin conexión a la nube: por ahora solo funciona en este aparato.'}</p>
      </div>`;
  }

  function areaHTML() {
    const a = AREAS[st.area];
    const list = gente(st.area);
    return `
      <button class="cm-back" onclick="VPComandas.abrir()">${icon('chevronLeft')} Comandas</button>
      <div class="cm-head">
        <button class="btn primary cm-add" onclick="VPComandas.agregar()">${icon('plus')} Agregar</button>
        <div class="cm-head-txt">
          <h1 class="page-title">${a.name}</h1>
          <p class="page-sub">${a.who} activos · ${a.sub.toLowerCase()}</p>
        </div>
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
        <span class="cm-empty-art">${ART[st.area]}</span>
        <div class="empty-title">Aún no hay ${a.who.toLowerCase()}</div>
        <div class="empty-text">Toca <b>Agregar</b> para sumar a tu equipo en ${a.name}.</div>
      </div>`}`;
  }

  function addHTML() {
    const a = AREAS[st.area];
    const list = disponibles(st.area);
    const premium = usersLimitReached();
    return `
      <button class="cm-back" onclick="VPComandas.area('${st.area}')">${icon('chevronLeft')} ${a.name}</button>
      <h1 class="page-title">Agregar a ${a.name}</h1>
      <p class="page-sub">Toca a la persona que quieres agregar</p>
      <div class="section-title">Usuarios disponibles</div>
      <div class="acc-list">
        ${list.map(u => `
          <button type="button" class="acc-row" onclick="VPComandas.asignar('${u.id}')">
            ${avatar(u)}
            <span class="acc-txt">
              <span class="acc-label">${escapeHtml(u.name)}</span>
              <span class="acc-sub">${roleOf(u.role).name}${AREAS[u.area] ? ' · Ahora en ' + AREAS[u.area].name : ''}</span>
            </span>
            <span class="cm-plus">${icon('plus')}</span>
          </button>`).join('')}
      </div>
      <button class="btn block ud-add ${premium ? 'ud-premium' : ''} cm-new" onclick="VPComandas.nuevo()">
        ${icon('plus')} ${premium ? 'Crear usuario nuevo · Contrata Premium' : 'Crear usuario nuevo'}
      </button>`;
  }

  function formHTML() {
    const f = st.form;
    const a = AREAS[st.area];
    const u = f.editId ? userById(f.editId) : null;
    const owner = ownerUser();
    const pideNipDueno = !f.editId && owner && !owner.pin;
    const on = PERMS.filter(p => f.perms[p.id]).length;
    return `
      <button class="cm-back" onclick="VPComandas.area('${st.area}')">${icon('chevronLeft')} ${a.name}</button>
      <h1 class="page-title">${u ? 'Editar usuario' : 'Nuevo ' + a.one}</h1>
      <p class="page-sub">${u ? escapeHtml(u.name) + ' · ' + a.name : 'Se agrega directo a ' + a.name}</p>
      <div class="cm-card">
        <div class="field">
          <label for="cmName">Nombre</label>
          <input id="cmName" type="text" maxlength="40" placeholder="Luis Pérez" autocomplete="off" value="${escapeHtml(f.name)}" oninput="VPComandas.campo('name', this.value)">
        </div>
        <div class="field">
          <label>Cargo</label>
          <div class="opt-grid cm-roles">
            ${['empleado', 'admin'].map(r => `
              <button type="button" class="opt-card ${f.role === r ? 'active' : ''}" onclick="VPComandas.cargo('${r}')">
                <span class="opt-emoji">${icon(r === 'admin' ? 'shield' : 'person')}</span>${roleOf(r).name}
              </button>`).join('')}
          </div>
          <div class="field-hint">${roleOf(f.role).sub}</div>
        </div>
        <div class="field">
          <label for="cmPin">NIP de 4 dígitos${u ? '' : ' (opcional)'}</label>
          <input id="cmPin" type="tel" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off" value="${escapeHtml(f.pin)}"
                 style="letter-spacing:8px; text-align:center;" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4); VPComandas.campo('pin', this.value)">
          <div class="field-hint">${u ? (u.pin ? 'Déjalo vacío para no cambiarlo.' : 'Aún no tiene NIP: entra sin escribir nada.') : 'Con NIP, solo esta persona puede entrar a su cuenta.'}</div>
        </div>
        ${pideNipDueno ? `
        <div class="field">
          <label for="cmOwnerPin">Tu NIP de Dueño</label>
          <input id="cmOwnerPin" type="tel" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off" value="${escapeHtml(f.ownerPin)}"
                 style="letter-spacing:8px; text-align:center;" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4); VPComandas.campo('ownerPin', this.value)">
          <div class="field-hint">Al tener equipo, tú también entras con NIP para proteger tu cuenta de Dueño.</div>
        </div>` : ''}
      </div>
      <div class="acc-list cm-perms-link">
        <button type="button" class="acc-row" onclick="VPComandas.permisos()">
          <span class="acc-ico gold">${icon('key')}</span>
          <span class="acc-txt">
            <span class="acc-label">Permisos</span>
            <span class="acc-sub">${on} de ${PERMS.length} activados</span>
          </span>
          <span class="acc-chev">${icon('chevronRight')}</span>
        </button>
      </div>
      <div class="cm-actions">
        <button class="btn ghost block" onclick="VPComandas.area('${st.area}')">Cancelar</button>
        <button class="btn primary block" onclick="VPComandas.guardarUsuario()">${u ? 'Guardar' : 'Agregar'}</button>
      </div>`;
  }

  function permsHTML() {
    const f = st.form;
    const d = st.permsDraft;
    return `
      <button class="cm-back" onclick="VPComandas.volverForm()">${icon('chevronLeft')} Volver</button>
      <h1 class="page-title">Permisos</h1>
      <p class="page-sub">${f.name.trim() ? escapeHtml(f.name.trim()) + ' · ' : ''}${roleOf(f.role).name}. Activa o desactiva lo que puede hacer</p>
      <div class="cm-card cm-perms">
        ${PERMS.map(p => `
          <div class="toggle-row">
            <span class="acc-ico ${p.id === 'gestionarProductos' ? 'green' : (p.id === 'verGanancias' ? 'violet' : 'blue')}">${icon(p.icon || 'receipt')}</span>
            <span class="acc-txt">
              <span class="acc-label">${p.label}</span>
              <span class="acc-sub">${p.sub}</span>
            </span>
            <label class="switch">
              <input type="checkbox" ${d[p.id] ? 'checked' : ''} onchange="VPComandas.perm('${p.id}', this.checked)">
              <span class="track"></span>
            </label>
          </div>`).join('')}
      </div>
      <div class="cm-actions">
        <button class="btn ghost block" onclick="VPComandas.volverForm()">Cancelar</button>
        <button class="btn primary block" onclick="VPComandas.guardarPermisos()">Guardar</button>
      </div>`;
  }

  function area(id) {
    if (!AREAS[id]) return;
    st.area = id; st.form = null; st.permsDraft = null;
    show('area');
  }
  function agregar() {
    if (!requireOwner('Solo el Dueño puede agregar personas')) return;
    if (disponibles(st.area).length) show('add');
    else nuevo();
  }
  function nuevo() {
    if (!requireOwner('Solo el Dueño puede agregar personas')) return;
    if (usersLimitReached()) { offerMoreUsers(); return; }
    st.form = { editId:null, name:'', role:'empleado', pin:'', ownerPin:'', perms:defaultPerms('empleado') };
    show('form');
  }
  function editar(id) {
    const u = userById(id);
    if (!u || !requireOwner('Solo el Dueño puede modificar usuarios')) return;
    st.form = { editId:u.id, name:u.name, role:u.role, pin:'', ownerPin:'', perms:Object.assign(defaultPerms(u.role), u.perms || {}) };
    show('form');
  }
  function campo(k, v) { if (st.form) st.form[k] = v; }
  function cargo(role) {
    if (!st.form || st.form.role === role) return;
    st.form.role = role;
    st.form.perms = defaultPerms(role);
    show('form');
  }
  function permisos() {
    if (!st.form) return;
    st.permsDraft = Object.assign({}, st.form.perms);
    show('perms');
  }
  function perm(id, v) { if (st.permsDraft) st.permsDraft[id] = !!v; }
  function guardarPermisos() {
    if (!st.form || !st.permsDraft) return;
    st.form.perms = st.permsDraft;
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
      if (u.role !== 'dueno') { u.role = f.role === 'admin' ? 'admin' : 'empleado'; u.perms = Object.assign({}, f.perms); }
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
      role: f.role === 'admin' ? 'admin' : 'empleado',
      pin: pin || null, phone: '',
      country: (currentUser() || {}).country || 'MX',
      perms: Object.assign({}, f.perms),
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
      <button class="btn ghost" onclick="VPComandas.cambiar()">${icon('swap')} Cambiar de cuenta</button>
    </div>`;
  }

  /* Estado de una mesa para el plano */
  function mesaEstado(o, tks, modo) {
    if (!o) return { cls:'', label:'Libre' };
    const ks = tks.filter(k => k.orderId === o.id);
    const listas = ks.some(k => k.status === 'listo');
    const cocina = ks.some(k => k.status === 'nuevo' || k.status === 'preparando');
    const cuenta = !!(o.cm && o.cm.billAt);
    if (modo === 'caja') return { cls:'is-occupied' + (cuenta ? ' cm-bill' : ''), label:cuenta ? 'Pide cuenta' : formatMoney(o.total) };
    if (listas) return { cls:'is-occupied cm-ready', label:'¡Lista!' };
    if (cuenta) return { cls:'is-occupied cm-bill', label:'Pidió cuenta' };
    return { cls:'is-occupied', label:cocina ? 'En cocina' : 'Ocupada' };
  }

  function planoHTML(modo) {
    const orders = VPMesas.openOrders();
    const tks = tickets();
    const legend = modo === 'caja'
      ? [['', 'Libre'], ['is-occupied', 'Abierta'], ['cm-bill', 'Pide cuenta']]
      : [['', 'Libre'], ['is-occupied', 'Ocupada'], ['cm-ready', 'Comanda lista'], ['cm-bill', 'Pidió cuenta']];
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
    if (esMesero()) { const o = VPMesas.openOrders().get(id); if (o) abrirCuenta(o.id); else ronda(id); }
  }

  /* Líneas de la comanda con foto, cantidad y nota (cocina y detalle) */
  function lineasHTML(items) {
    return items.map(i => `
      <div class="mdi-line cm-line">
        <div class="mdi-thumb">${thumb(i.productId)}</div>
        <div class="mdi-line-main">
          <div class="mdi-line-name">${escapeHtml(i.name)}${i.size ? ' <span class="cm-size">' + escapeHtml(i.size) + '</span>' : ''}</div>
          ${i.note ? `<div class="dm-line-note cm-note">${icx('note')}${escapeHtml(i.note)}</div>` : ''}
        </div>
        <div class="cm-qty">×${fmtN(i.qty)}</div>
      </div>`).join('');
  }
  function resumen(items) {
    return items.slice(0, 3).map(i => escapeHtml(fmtN(i.qty) + '× ' + i.name)).join(' · ') + (items.length > 3 ? ' · +' + (items.length - 3) + ' más' : '');
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
    if (listas.length) banners.push(`<div class="mdi-banner ok">${icon('bell')}<span><b>${plural(listas.length, 'comanda lista', 'comandas listas')} para servir</b>${caja ? 'El mesero ya puede llevarla a la mesa.' : 'Llévala a la mesa y márcala como entregada.'}</span></div>`);
    if (enCocina.length) banners.push(`<div class="mdi-banner warn">${icon('clock')}<span><b>${plural(enCocina.length, 'comanda', 'comandas')} en cocina</b>${caja ? 'Todavía se está preparando algo de esta mesa.' : 'Te avisamos cuando esté lista.'}</span></div>`);
    if (cuenta) banners.push(`<div class="mdi-banner cm-banner-bill">${icon('cash')}<span><b>Pidió la cuenta</b>${caja ? 'El cliente ya quiere pagar.' : 'Caja ya sabe que esta mesa quiere pagar.'} · ${ago(o.cm.billAt)}</span></div>`);

    const rondas = ks.length ? `
      <div class="mdi-block-title cm-block-t">Comandas</div>
      <div class="cm-rondas">${ks.map(k => `
        <div class="cm-ronda">
          <div class="cm-ronda-h"><b>Ronda ${k.round || 1}</b><span class="mdi-pill ${ESTADOS[k.status].cls}">${ESTADOS[k.status].label}</span><span class="mdi-time">${fmtTime(k.at)}</span></div>
          <div class="cm-ronda-items">${k.items.map(i => `<span><b>${fmtN(i.qty)}×</b> ${escapeHtml(i.name)}${i.size ? ' · ' + escapeHtml(i.size) : ''}${i.note ? ` <i>(${escapeHtml(i.note)})</i>` : ''}</span>`).join('')}</div>
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
        ${listas.length ? `<button class="btn primary block" onclick="VPComandas.verLista('${listas[0].id}')">${icon('bell')} Recoger pedido listo</button>` : ''}
        <button class="btn ${listas.length ? 'ghost' : 'primary'} block" onclick="VPComandas.ronda('${escapeHtml(o.checkout.floorTableId)}')">${icon('plus')} Agregar productos</button>
        ${cuenta ? `<button class="btn ghost block" onclick="VPComandas.pedirCuenta('${o.id}')">${icon('close')} Quitar aviso de cuenta</button>`
                 : holdBtn('cm-go-bill', icon('cash') + ' Pedir la cuenta', 'pedirCuenta', [o.id])}`;
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
    const listas = tickets().filter(k => k.status === 'listo')
      .sort((a, b) => new Date(a.readyAt || a.at) - new Date(b.readyAt || b.at));
    return `
      <h1 class="page-title">Mesas</h1>
      <p class="page-sub">Hola, ${escapeHtml(userFirstName(yo) || yo.name)} · Toca una mesa para tomar o ver su pedido</p>
      ${soloBar()}
      <div class="cm-notif ${listas.length ? 'on' : ''}">
        <div class="cm-notif-h">${icon('bell')} <b>Pedidos listos</b>${listas.length ? `<span class="cm-notif-n">${listas.length}</span>` : ''}</div>
        ${listas.length ? listas.map(k => `<button type="button" class="cm-notif-row" onclick="VPComandas.verLista('${k.id}')">
          <span class="cm-notif-mesa">${escapeHtml(k.table)}</span>
          <span class="cm-notif-txt"><b>Ronda ${k.round || 1} · lista ${ago(k.readyAt || k.at)}</b><small>${resumen(k.items)}</small></span>
          <span class="cm-notif-go">Recoger ${icon('chevronRight')}</span>
        </button>`).join('') : `<p class="cm-notif-empty">Nada por recoger. Te avisamos cuando cocina termine.</p>`}
      </div>
      ${planoHTML('mesero')}`;
  }

  /* Empieza una ronda nueva en la mesa: el catálogo con el carrito vacío */
  function ronda(tableId) {
    if (!esMesero()) return;
    const t = VPMesas.layout().find(x => x.id === tableId);
    if (!t) return;
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
        <button class="btn primary block" onclick="VPComandas.enviar()">${icon('comandas')} Mandar a cocina · ${plural(n, 'producto', 'productos')}</button>
      </div>`;
  }

  /* Junta líneas iguales (mismo producto, tamaño, nota y precio) */
  const lineKey = c => [c.productId, c.sizeId || '', (c.note || '').trim(), c.manualPrice == null ? '' : c.manualPrice].join('|');
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

  /* Comanda lista: "¿Ya tienes el pedido?" con lo que hay que llevar */
  function verLista(id) {
    const k = tickets().find(x => x.id === id);
    if (!k || k.status !== 'listo') { closeModal(); render(); return; }
    openModal(`
      <div class="sheet-header">
        <div class="sheet-header-left" style="min-width:0;"><h2>${escapeHtml(k.table)}</h2><span class="mdi-pill ok">Lista</span></div>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      <div class="cm-todo">
        <span class="cm-todo-step"><i>${icon('inbox')}</i><small>Recoge en cocina</small></span>
        <b class="cm-todo-arrow">${icon('chevronRight')}</b>
        <span class="cm-todo-step"><i>${VPMesas.tableIcon}</i><small>Lleva a ${escapeHtml(k.table)}</small></span>
      </div>
      <div class="cm-lines">${lineasHTML(k.items)}</div>
      <div class="cm-sheet-acts">
        <p class="cm-ask">¿Ya tienes el pedido?</p>
        ${holdBtn('cm-go cm-go-ok', icon('check') + ' Ya lo tengo', 'entregarTicket', [k.id])}
        <button class="cm-undo" onclick="closeModal()">Todavía no</button>
      </div>
    `, { dismissible:true });
  }
  function entregarTicket(id) {
    const list = tickets();
    const k = list.find(x => x.id === id);
    if (!k || k.status !== 'listo') { closeModal(); render(); return; }
    k.status = 'entregado'; k.deliveredAt = nowIso(); k.deliveredBy = meName();
    saveTickets(list);
    closeModal();
    render();
    toast('¡Listo! Llévalo a ' + k.table, { variant:'toast-success', icon:icon('check') });
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
    closeModal();
    render();
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

  /* Al borrar la cuenta: lo que quedaba en cocina se cancela.
     Al cobrarla: lo que ya estaba listo se da por entregado. */
  function cancelarOrden(orderId) {
    if (!orderId) return;
    const list = tickets();
    let changed = false;
    list.forEach(k => { if (k.orderId === orderId && (k.status === 'nuevo' || k.status === 'preparando')) { k.status = 'cancelado'; changed = true; } });
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
    return `
      <h1 class="page-title">Cocina</h1>
      <p class="page-sub">${activas.length ? plural(activas.length, 'comanda por preparar', 'comandas por preparar') + (nuevas ? ' · ' + plural(nuevas, 'nueva', 'nuevas') : '') : 'Aquí llegan las comandas de los meseros'}</p>
      ${soloBar()}
      <div class="chip-row cm-chips">
        <button class="chip ${st.kf !== 'listas' ? 'active' : ''}" onclick="VPComandas.filtro('activas')">Por preparar <b>${activas.length}</b></button>
        <button class="chip ${st.kf === 'listas' ? 'active' : ''}" onclick="VPComandas.filtro('listas')">Listas sin entregar <b>${listas.length}</b></button>
      </div>
      ${list.length ? `<div class="mdi-list cm-kds">${list.map(k => {
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
          <div class="mdi-card-foot"><span>${plural(unitsOf(k.items), 'producto', 'productos')}${notas ? ` · <i class="cm-has-note">${icx('note')} Con notas</i>` : ''}</span><b>${fmtTime(k.at)}</b></div>
        </button>`;
      }).join('')}</div>` : `
      <div class="mdi-empty">
        <span class="mdi-empty-ico">${icon('inbox')}</span>
        <b>${st.kf === 'listas' ? 'No hay comandas esperando al mesero' : 'Sin comandas por ahora'}</b>
        <span>${st.kf === 'listas' ? 'Las que marques como listas aparecen aquí hasta que el mesero las entregue.' : 'Cuando un mesero mande un pedido, aparecerá aquí con un aviso.'}</span>
      </div>`}`;
  }
  function filtro(f) { st.kf = f; render(); }

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
      ${holdBtn('cm-go cm-go-prep', FIRE + ' Preparar', 'estado', [k.id, 'preparando'])}`;
    else if (k.status === 'preparando') acts = `
      ${holdBtn('cm-go cm-go-ok', icon('check') + ' Lista', 'estado', [k.id, 'listo'])}`;
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
      <div class="cm-lines">${lineasHTML(k.items)}</div>
      <div class="cm-sheet-acts">${acts}</div>`;
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
          <div class="cm-ronda-items">${t.items.map(i => `<span><b>${fmtN(i.qty)}×</b> ${escapeHtml(i.name)}${i.size ? ' · ' + escapeHtml(i.size) : ''}${i.note ? ` <i>(${escapeHtml(i.note)})</i>` : ''}</span>`).join('')}</div>
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

  function cambiar() { switchUser(); }

  /* ---------- Vista principal ---------- */
  function view() {
    const area = myArea();
    if (area === 'mesero') return meseroHTML();
    if (area === 'cocina') return cocinaHTML();
    if (area === 'caja') return cajaHTML();
    if (!puedeAdministrar()) return '';
    if (st.screen === 'area' && AREAS[st.area]) return areaHTML();
    if (st.screen === 'add' && AREAS[st.area]) return addHTML();
    if (st.screen === 'form' && st.form && AREAS[st.area]) return formHTML();
    if (st.screen === 'perms' && st.form && st.permsDraft && AREAS[st.area]) return permsHTML();
    st.screen = 'home';
    return homeHTML();
  }

  /* Repinta lo que se ve (pantalla y la hoja abierta) tras un cambio */
  function refresh() {
    try {
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
  function avisos(antes, despues) {
    const area = myArea();
    const yo = me();
    const nuevas = despues.filter(k => k.status === 'nuevo' && !antes[k.id]);
    const listas = despues.filter(k => k.status === 'listo' && antes[k.id] && antes[k.id] !== 'listo');
    if (area === 'cocina' && nuevas.length) {
      beep(); vibrate([30, 80, 30]);
      toast(nuevas.length === 1 ? 'Nueva comanda · ' + nuevas[0].table : nuevas.length + ' comandas nuevas', { icon:icon('bell'), variant:'toast-success toast-top', subtitle:nuevas.length === 1 ? 'De ' + (nuevas[0].by || 'el mesero') : '', duration:3500 });
    }
    const mias = listas.filter(k => area === 'mesero' && (!yo || k.byId === yo.id || ((orderById(k.orderId) || {}).cm || {}).waiterId === yo.id));
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
    const SK = 'cm_sync_state';
    let s = { uid:null, known:{}, dirty:[] };
    let last = {};            /* id -> {k,h}: cómo estaba lo local la última vez que lo vimos */
    let dirty = new Set();
    let muted = false, hooked = false, busy = false, again = false, timer = null, ch = null, chUid = null, poll = null;

    const can = () => { try { return Cloud.ready && !!Cloud.uid && !!Cloud.sb && AUTH.isLogged(); } catch (e) { return false; } };
    const inUse = () => { try { return DB.getUsers().some(u => AREAS[u.area]) || DB.getTableOrders().some(o => o.cm) || tickets().length > 0; } catch (e) { return false; } };
    const online = () => can();

    function snapshot() {
      const m = {};
      DB.getTableOrders().forEach(o => { m[o.id] = { k:'cuenta', h:JSON.stringify(o), d:o }; });
      tickets().forEach(t => { m[t.id] = { k:'comanda', h:JSON.stringify(t), d:t }; });
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
      Store._changed = function (k) { prev.call(this, k); if (k === 'mesa_parked' || k === KEY) onLocal(); };
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
      const orders = {}, tks = {};
      Object.keys(cur).forEach(id => { (cur[id].k === 'cuenta' ? orders : tks)[id] = cur[id].d; });
      const antes = {}; tickets().forEach(t => { antes[t.id] = t.status; });
      let changed = false;
      (data || []).forEach(r => {
        if (dirty.has(r.id)) return;
        const bag = r.kind === 'cuenta' ? orders : tks;
        if (r.deleted) {
          if (bag[r.id]) { delete bag[r.id]; changed = true; }
          delete s.known[r.id];
          return;
        }
        const h = JSON.stringify(r.data);
        s.known[r.id] = { k:r.kind, h };
        if (!cur[r.id] || cur[r.id].h !== h) { bag[r.id] = r.data; changed = true; }
      });
      Object.keys(cur).forEach(id => {
        if (remote[id] || dirty.has(id)) return;
        if (s.known[id]) {                          /* ya no existe en la nube */
          delete (cur[id].k === 'cuenta' ? orders : tks)[id]; delete s.known[id]; changed = true;
        } else dirty.add(id);                       /* nunca se subió: se sube */
      });
      if (changed) {
        muted = true;
        try {
          DB.saveTableOrders(Object.values(orders));
          Store.set(KEY, Object.values(tks));
        } finally { muted = false; }
        last = strip(snapshot());
        avisos(antes, Object.values(tks));
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
    tocarMesa, abrirCuenta, verLista, entregarTicket, ronda, saleHead, salirMesa, cartActions, enviar, entregar, pedirCuenta,
    cobrar, editarCuenta, cancelarOrden, cerrarOrden,
    filtro, abrirComanda, estado, historial, cambiar, sync:() => Sync.run()
  };
})();
