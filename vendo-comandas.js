'use strict';

/* =========================================================
   COMANDAS
   - El Dueño entra a "Comandas" y ve 3 áreas: Caja, Mesero y Cocinero.
     En cada una ve a las personas de esa área, puede agregar
     (un usuario que ya existe o uno nuevo, sin pasar por Usuarios)
     y quitar con confirmación.
   - Quien entra con su cuenta de Mesero solo ve las mesas (el mismo
     plano de VPMesas), su historial y "Cambiar de cuenta".
   - Quien entra como Cocinero solo ve los pedidos que mandan los
     meseros, los marca como listos y ve su historial.
   - El área de cada persona vive en su usuario (u.area) y los pedidos
     que se mandan a cocina en 'mesa_comandas'.
========================================================= */
window.VPComandas = (() => {
  const KEY = 'mesa_comandas';
  const AREAS = {
    caja:   { name:'Caja',     who:'Cajeros',    one:'cajero',   sub:'Cobran las cuentas de las mesas' },
    mesero: { name:'Mesero',   who:'Meseros',    one:'mesero',   sub:'Toman los pedidos en las mesas' },
    cocina: { name:'Cocinero', who:'Cocineros',  one:'cocinero', sub:'Preparan lo que mandan los meseros' }
  };
  const ORDER = ['caja', 'mesero', 'cocina'];

  /* Estado de las pantallas del Dueño */
  const st = { screen:'home', area:null, form:null, permsDraft:null, snap:null };

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
  function puedeAdministrar() {
    try { return isOwner(); } catch (e) { return false; }
  }

  /* Se llama al inicio de cada render(): manda a cada quien a su sección */
  function guard() {
    if (typeof EXTRA_VIEWS !== 'undefined' && EXTRA_VIEWS.comandas !== view) EXTRA_VIEWS.comandas = view;
    const area = myArea();
    if (area === 'mesero') {
      if (!(currentView === 'sale' && checkout.floorTableId)) currentView = 'comandas';
    } else if (area === 'cocina') {
      currentView = 'comandas';
    } else if (currentView === 'comandas' && !puedeAdministrar()) {
      currentView = 'sale';
    }
    const b = document.body.classList;
    b.toggle('cm-solo', area === 'mesero' || area === 'cocina');
    b.toggle('cm-mesero', area === 'mesero');
    b.toggle('cm-admin', puedeAdministrar());
  }

  function abrir() {
    st.screen = 'home'; st.area = null; st.form = null; st.permsDraft = null;
    goTo('comandas');
  }
  function show(screen) {
    st.screen = screen;
    goTo('comandas');
  }

  /* ---------- Pedidos mandados a cocina ---------- */
  const tickets = () => Store.list(KEY);
  const saveTickets = list => Store.set(KEY, list.slice(-400));

  function ago(iso) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'Ahora';
    if (min < 60) return 'Hace ' + min + ' min';
    return fmtTime(iso);
  }

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

  /* ---------- Gente de cada área ---------- */
  const gente = area => DB.getUsers().filter(u => u.role !== 'dueno' && u.area === area);
  const disponibles = area => DB.getUsers().filter(u => u.role !== 'dueno' && u.area !== area);
  const enTurno = u => DB.getShifts().some(s => !s.end && s.userId === u.id);
  function avatar(u) {
    const ph = userPhoto(u);
    return `<span class="acc-ico ${u.role === 'admin' ? 'blue' : 'green'} ${ph ? 'has-photo' : ''}">${ph ? `<img src="${ph}" alt="">` : `<span class="ini">${userInitials(u)}</span>`}</span>`;
  }

  /* =========================================================
     PANTALLAS DEL DUEÑO
  ========================================================= */
  function homeHTML() {
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
                <small>${n ? n + (n === 1 ? ' persona' : ' personas') : 'Sin personas todavía'}</small>
              </span>
              <span class="acc-chev">${icon('chevronRight')}</span>
            </span>
          </button>`;
        }).join('')}
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
          <p class="page-sub">${a.who} activos en esta área</p>
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

  /* ---------- Acciones del Dueño ---------- */
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
      id: 'u' + Date.now(),
      name,
      role: f.role === 'admin' ? 'admin' : 'empleado',
      pin: pin || null,
      phone: '',
      country: (currentUser() || {}).country || 'MX',
      perms: Object.assign({}, f.perms),
      area: st.area,
      createdAt: new Date().toISOString()
    });
    DB.saveUsers(list);
    /* El Dueño sigue siendo quien usa la app */
    const me = activeUser();
    if (me) setActiveUser(me.id);
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
      ok: 'Eliminar',
      danger: true,
      icon: icon('trash')
    }, () => {
      const list = DB.getUsers();
      const x = list.find(v => v.id === id);
      if (x) { delete x.area; DB.saveUsers(list); }
      closeModal();
      show('area');
      toast(u.name + ' ya no está en ' + a.name, { icon:icon('trash') });
    });
  }

  /* =========================================================
     MESERO: solo las mesas, su historial y cambiar de cuenta
  ========================================================= */
  function soloBar() {
    return `<div class="cm-solo-bar">
      <button class="btn ghost" onclick="VPComandas.historial()">${icon('receipt')} Historial</button>
      <button class="btn ghost" onclick="VPComandas.cambiar()">${icon('swap')} Cambiar de cuenta</button>
    </div>`;
  }

  function meseroHTML() {
    const me = activeUser();
    const orders = VPMesas.openOrders();
    const listos = new Set(tickets().filter(t => t.status === 'listo').map(t => t.tableId));
    return `
      <h1 class="page-title">Mesas</h1>
      <p class="page-sub">Hola, ${escapeHtml(userFirstName(me) || me.name)} · Toca una mesa para tomar el pedido</p>
      ${soloBar()}
      <div class="vp-floor cm-floor" aria-label="Plano de mesas">
        ${VPMesas.layout().map(t => {
          const busy = orders.has(t.id);
          const ready = busy && listos.has(t.id);
          const label = ready ? 'Listo' : (busy ? 'Ocupada' : 'Libre');
          return `<button type="button" class="vp-floor-table ${t.id === 'bar' ? 'is-bar' : ''} ${busy ? 'is-occupied' : ''} ${ready ? 'cm-ready' : ''}"
            style="--x:${t.x}%;--y:${t.y}%" onclick="VPComandas.mesa('${escapeHtml(t.id)}')"
            aria-label="${escapeHtml(t.name)} · ${label}"><b>${escapeHtml(t.name)}</b><small>${label}</small></button>`;
        }).join('')}
      </div>`;
  }

  /* Abre una mesa en el catálogo de Nueva venta */
  function mesa(id) {
    if (!esMesero()) return;
    const t = VPMesas.layout().find(x => x.id === id);
    if (!t) return;
    const order = VPMesas.openOrders().get(id);
    cart = []; customItems = {}; checkout = newCheckout();
    if (order) {
      cart = JSON.parse(JSON.stringify(order.cart || []));
      customItems = JSON.parse(JSON.stringify(order.customItems || {}));
      checkout = Object.assign(newCheckout(), order.checkout || {}, { cash:'' });
      /* Lo que ya estaba listo en cocina se da por entregado al abrir la mesa */
      const list = tickets();
      let changed = false;
      list.forEach(k => { if (k.orderId === order.id && k.status === 'listo') { k.status = 'entregado'; k.deliveredAt = new Date().toISOString(); changed = true; } });
      if (changed) saveTickets(list);
    } else {
      checkout.floorTableId = t.id;
      checkout.serviceType = 'mesa';
      checkout.table = t.name;
    }
    st.snap = JSON.stringify(cart);
    goTo('sale');
  }

  function saleHead() {
    if (!esMesero() || !checkout.floorTableId) return '';
    return `
      <button class="cm-back" onclick="VPComandas.salirMesa()">${icon('chevronLeft')} Mesas</button>
      <h1 class="page-title">${escapeHtml(checkout.table || 'Mesa')}</h1>
      <p class="page-sub">Agrega los productos y mándalos a cocina</p>`;
  }

  function salirMesa() {
    const leave = () => {
      cart = []; customItems = {}; checkout = newCheckout(); st.snap = null;
      closeModal();
      goTo('comandas');
    };
    if (st.snap !== null && JSON.stringify(cart) !== st.snap) {
      askConfirm({
        title: '¿Salir sin mandar el pedido?',
        text: 'Los cambios de ' + escapeHtml(checkout.table || 'esta mesa') + ' no se guardarán.',
        ok: 'Salir sin mandar',
        danger: true,
        icon: icon('alert')
      }, leave);
      return;
    }
    leave();
  }

  /* Lo nuevo que falta mandar a cocina (comparado con lo ya enviado) */
  const lineKey = c => [c.productId, c.sizeId || '', (c.note || '').trim()].join('|');
  function cartMap() {
    const m = {};
    cart.forEach(c => { const k = lineKey(c); m[k] = (m[k] || 0) + (Number(c.qty) || 0); });
    return m;
  }
  function pendientes() {
    const sent = checkout.cmSent || {};
    const m = cartMap();
    const out = [];
    Object.keys(m).forEach(k => {
      const q = Math.round((m[k] - (sent[k] || 0)) * 1000) / 1000;
      if (q <= 0) return;
      const c = cart.find(x => lineKey(x) === k);
      const p = findProduct(c.productId);
      out.push({ name: p ? p.name : 'Producto', size: c.sizeLabel || '', note: (c.note || '').trim(), qty: q });
    });
    return out;
  }

  function cartActions() {
    const n = pendientes().reduce((a, x) => a + x.qty, 0);
    return `<div class="cart-actions cm-cart-actions">
      <button class="btn primary block" onclick="VPComandas.enviar()">${icon('comandas')} ${n ? 'Mandar a cocina · ' + fmtN(n) + (n === 1 ? ' nuevo' : ' nuevos') : 'Guardar mesa'}</button>
    </div>`;
  }
  const fmtN = n => (Math.round(n * 100) / 100).toString();

  function enviar() {
    if (!esMesero() || !checkout.floorTableId) return;
    if (!cart.length && !checkout.floorOrderId) { toast('Agrega productos al pedido'); return; }
    const t = VPMesas.layout().find(x => x.id === checkout.floorTableId);
    if (!t) { toast('Esta mesa ya no existe'); return; }
    if (!VPMesas.canCharge()) { toast('Esta mesa ya tiene otra cuenta abierta'); return; }
    const items = pendientes();
    const prevId = checkout.floorOrderId;
    const prevSent = checkout.cmSent;
    checkout.cmSent = cartMap();
    if (!parkNow(t.name, prevId)) { checkout.cmSent = prevSent; toast('No se pudo guardar el pedido'); return; }
    const orderId = prevId || VPMesas.openOrders().get(t.id)?.id || null;
    if (items.length) {
      const me = activeUser();
      const list = tickets();
      list.push({
        id: uid('cm'), orderId, tableId: t.id, table: t.name, items,
        by: me ? me.name : meName(), byId: me ? me.id : meId(),
        at: new Date().toISOString(), status: 'cocina'
      });
      saveTickets(list);
    }
    st.snap = null;
    closeModal();
    goTo('comandas');
    toast(items.length ? 'Pedido mandado a cocina' : 'Mesa guardada', { variant:'toast-success', icon:icon('check'), subtitle:t.name });
  }

  /* Si se borra el pedido de una mesa, cocina ya no lo prepara */
  function cancelarOrden(orderId) {
    if (!orderId) return;
    const list = tickets();
    let changed = false;
    list.forEach(k => { if (k.orderId === orderId && k.status === 'cocina') { k.status = 'cancelado'; changed = true; } });
    if (changed) saveTickets(list);
  }

  /* =========================================================
     COCINA: pedidos por preparar
  ========================================================= */
  function itemsHTML(items) {
    return `<ul class="cm-items">${items.map(i => `
      <li><b>${fmtN(i.qty)}×</b><span>${escapeHtml(i.name)}${i.size ? ' · ' + escapeHtml(i.size) : ''}${i.note ? `<small>${escapeHtml(i.note)}</small>` : ''}</span></li>`).join('')}</ul>`;
  }

  function cocinaHTML() {
    const list = tickets().filter(t => t.status === 'cocina').sort((a, b) => new Date(a.at) - new Date(b.at));
    return `
      <h1 class="page-title">Cocina</h1>
      <p class="page-sub">${list.length ? list.length + (list.length === 1 ? ' pedido por preparar' : ' pedidos por preparar') : 'Aquí llegan los pedidos de los meseros'}</p>
      ${soloBar()}
      ${list.length ? `<div class="cm-tickets">
        ${list.map(t => `
          <div class="cm-ticket">
            <div class="cm-ticket-h">
              <b>${escapeHtml(t.table)}</b>
              <span>${ago(t.at)}</span>
            </div>
            <div class="cm-ticket-by">${icon('person')} ${escapeHtml(t.by || '')}</div>
            ${itemsHTML(t.items)}
            <button class="btn primary block" onclick="VPComandas.listo('${t.id}')">${icon('check')} Listo</button>
          </div>`).join('')}
      </div>` : `
      <div class="empty-state cm-empty">
        <span class="cm-empty-art">${ART.cocina}</span>
        <div class="empty-title">No hay pedidos por ahora</div>
        <div class="empty-text">Cuando un mesero mande un pedido, aparecerá aquí.</div>
      </div>`}`;
  }

  function listo(id) {
    if (!esCocina()) return;
    const list = tickets();
    const t = list.find(x => x.id === id);
    if (!t || t.status !== 'cocina') return;
    t.status = 'listo';
    t.readyAt = new Date().toISOString();
    t.readyBy = meName();
    saveTickets(list);
    render();
    toast('Pedido listo', { variant:'toast-success', icon:icon('check'), subtitle:t.table });
  }

  /* ---------- Historial del mesero o de cocina ---------- */
  const ESTADOS = { cocina:'En cocina', listo:'Listo', entregado:'Entregado', cancelado:'Cancelado' };
  function historial() {
    const me = activeUser();
    const cocina = esCocina();
    const list = tickets()
      .filter(t => cocina ? t.status !== 'cocina' : (me && t.byId === me.id))
      .sort((a, b) => new Date(b.readyAt || b.at) - new Date(a.readyAt || a.at))
      .slice(0, 80);
    openModal(`
      <div class="sheet-header">
        <h2>Historial</h2>
        <button class="sheet-close" onclick="closeModal()">${icon('close')}</button>
      </div>
      ${list.length ? `<div class="cm-hist">${list.map(t => `
        <div class="cm-hist-row">
          <div class="cm-hist-h">
            <b>${escapeHtml(t.table)}</b>
            <span class="cm-st ${t.status}">${ESTADOS[t.status] || ''}</span>
          </div>
          <div class="cm-hist-sub">${fmtDay(t.at)} · ${fmtTime(t.at)}${cocina && t.by ? ' · ' + escapeHtml(t.by) : ''}</div>
          ${itemsHTML(t.items)}
        </div>`).join('')}</div>` : `
        <div class="empty-state">
          <div class="empty-title">Aún no hay nada aquí</div>
          <div class="empty-text">${cocina ? 'Los pedidos que marques como listos aparecerán aquí.' : 'Los pedidos que mandes a cocina aparecerán aquí.'}</div>
        </div>`}
    `, { dismissible:true });
  }

  function cambiar() { switchUser(); }

  /* ---------- Vista principal ---------- */
  function view() {
    const area = myArea();
    if (area === 'mesero') return meseroHTML();
    if (area === 'cocina') return cocinaHTML();
    if (!puedeAdministrar()) return '';
    if (st.screen === 'area' && AREAS[st.area]) return areaHTML();
    if (st.screen === 'add' && AREAS[st.area]) return addHTML();
    if (st.screen === 'form' && st.form && AREAS[st.area]) return formHTML();
    if (st.screen === 'perms' && st.form && st.permsDraft && AREAS[st.area]) return permsHTML();
    st.screen = 'home';
    return homeHTML();
  }

  /* Cocina y mesas se actualizan solas (otra pestaña o el paso del tiempo) */
  function refresh() {
    try {
      if (currentView !== 'comandas' || !(esCocina() || esMesero())) return;
      if (document.querySelector('#modal-layer .modal-overlay')) return;
      render();
    } catch (e) {}
  }
  setInterval(refresh, 20000);
  window.addEventListener('storage', e => { if (!e.key || e.key === KEY || e.key === 'mesa_parked') refresh(); });

  function register() {
    if (typeof EXTRA_VIEWS === 'undefined') return false;
    EXTRA_VIEWS.comandas = view;
    return true;
  }
  if (!register()) document.addEventListener('DOMContentLoaded', register);

  return {
    abrir, guard, esMesero, esCocina, puedeAdministrar,
    area, agregar, nuevo, editar, campo, cargo, permisos, perm, guardarPermisos, volverForm, guardarUsuario, asignar, quitar,
    mesa, saleHead, salirMesa, cartActions, enviar, cancelarOrden,
    listo, historial, cambiar
  };
})();
