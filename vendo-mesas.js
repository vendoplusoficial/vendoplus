'use strict';

window.VPMesas = (() => {
  const key = 'mesa_plano';
  const tableIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 10h18M5 10v8m14-8v8M3 7h18v3H3z"/></svg>';
  let source;
  let checkoutScroll;
  let draft;
  let selected;
  let drag;
  const defaults = () => [
    ['m1', 'Mesa 1', 18, 17], ['m2', 'Mesa 2', 82, 17],
    ['m3', 'Mesa 3', 50, 43], ['m4', 'Mesa 4', 18, 72],
    ['m5', 'Mesa 5', 82, 72], ['bar', 'Bar', 50, 85]
  ].map(([id, name, x, y]) => ({ id, name, x, y }));
  const layout = () => Store.get(key, defaults());
  function openOrders() {
    const pending = DB.getTableOrders();
    if (!pending.length) return new Map();
    const paid = new Set(DB.getSales().map(sale => sale.floorOrderId).filter(Boolean));
    return new Map(pending.filter(p => !paid.has(p.id)).map(p => [p.checkout.floorTableId, p]));
  }
  const currentTable = () => layout().find(t => t.id === checkout.floorTableId);

  function open(from) {
    source = from;
    const overlay = from === 'checkout' ? document.querySelector('#modal-layer .modal-overlay:has(.pay2)') : null;
    checkoutScroll = overlay ? { sheet:overlay.querySelector('.modal-sheet').scrollTop, overlay:overlay.scrollTop } : null;
    draft = null;
    selected = null;
    draw(true);
  }

  function back() {
    if (draft) {
      draft = null;
      draw();
    } else if (source === 'checkout') {
      returnToCheckout();
    } else {
      closeModal();
    }
  }

  function draw(animate = false) {
    const editing = !!draft;
    const orders = openOrders();
    const tables = draft || layout();
    const chosen = tables.find(t => t.id === selected);
    openModal(`
      <div class="sheet-header vp-floor-header">
        <button class="sheet-back" onclick="VPMesas.back()" aria-label="Volver">${icon('chevronLeft')}</button>
        <h2>${editing ? 'Editar mesas' : 'Mesas'}</h2>
        ${editing ? '<span></span>' : `<button class="sheet-back" onclick="VPMesas.edit()" aria-label="Editar plano">${icon('pen')}</button>`}
      </div>
      <div class="vp-floor ${editing ? 'is-editing' : ''}" aria-label="Plano de mesas">
        ${tables.map(t => {
          const order = orders.get(t.id);
          const active = !!order;
          return `<button type="button" class="vp-floor-table ${t.id === 'bar' ? 'is-bar' : ''} ${active ? 'is-occupied' : ''} ${editing && selected === t.id ? 'is-selected' : ''}"
            data-floor-id="${escapeHtml(t.id)}" style="--x:${t.x}%;--y:${t.y}%"
            aria-label="${escapeHtml(t.name)} · ${active ? 'Ocupada' : 'Libre'}"><b>${escapeHtml(t.name)}</b>
            <small>${active ? 'Ocupada' : 'Libre'}</small></button>`;
        }).join('')}
      </div>
      ${editing ? `
        <div class="vp-floor-controls">
          <button class="btn ghost" onclick="VPMesas.add()" ${tables.length >= 16 ? 'disabled' : ''}>${icon('plus')} Agregar mesa</button>
          ${chosen && chosen.id !== 'bar' && !orders.has(chosen.id) ? '<button class="btn ghost" onclick="VPMesas.remove()">Eliminar mesa</button>' : ''}
        </div>
        <div class="vp-floor-controls">
          <button class="btn ghost" onclick="VPMesas.reset()">Restablecer</button>
          <button class="btn primary" onclick="VPMesas.save()">Guardar</button>
        </div>` : ''}
    `, { dismissible:false, sheetClass:'vp-floor-sheet' + (animate ? ' vp-floor-enter' : '') });

    const floor = document.querySelector('#modal-layer .vp-floor');
    for (const button of floor.querySelectorAll('button')) {
      const id = button.dataset.floorId;
      button.onclick = () => {
        if (!editing) choose(id);
        else if (selected !== id) { selected = id; draw(); }
      };
      if (editing) bindDrag(button, floor, tables.find(t => t.id === id));
    }
  }

  function bindDrag(button, floor, table) {
    button.onpointerdown = event => {
      if (event.button !== 0) return;
      const bounds = floor.getBoundingClientRect();
      drag = { id:event.pointerId, x:event.clientX, y:event.clientY, left:table.x, top:table.y, bounds, moved:false };
      button.setPointerCapture(event.pointerId);
    };
    button.onpointermove = event => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      table.x = Math.min(88, Math.max(12, drag.left + dx * 100 / drag.bounds.width));
      table.y = Math.min(89, Math.max(11, drag.top + dy * 100 / drag.bounds.height));
      button.style.setProperty('--x', table.x + '%');
      button.style.setProperty('--y', table.y + '%');
    };
    button.onpointerup = button.onpointercancel = event => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      selected = table.id;
      draw();
      document.querySelector(`[data-floor-id="${CSS.escape(table.id)}"]`)?.focus();
    };
    button.onkeydown = event => {
      const step = { ArrowLeft:[-3,0], ArrowRight:[3,0], ArrowUp:[0,-3], ArrowDown:[0,3] }[event.key];
      if (!step) return;
      event.preventDefault();
      table.x = Math.min(88, Math.max(12, table.x + step[0]));
      table.y = Math.min(89, Math.max(11, table.y + step[1]));
      button.style.setProperty('--x', table.x + '%');
      button.style.setProperty('--y', table.y + '%');
    };
  }

  function edit() {
    draft = layout();
    selected = null;
    draw();
  }

  function add() {
    if (!draft || draft.length >= 16) return;
    let number = 1;
    while (draft.some(t => t.name === 'Mesa ' + number)) number++;
    const positions = [13, 37, 63, 87].flatMap(x => [12, 36, 60, 85].map(y => ({ x, y })));
    const distance = pos => Math.min(...draft.map(t => Math.hypot(pos.x - t.x, pos.y - t.y)));
    positions.sort((a, b) => distance(b) - distance(a));
    const table = { id:uid('mt'), name:'Mesa ' + number, ...positions[0] };
    draft.push(table);
    selected = table.id;
    draw();
  }

  function remove() {
    if (!draft || selected === 'bar' || openOrders().has(selected)) return;
    draft = draft.filter(t => t.id !== selected);
    selected = null;
    draw();
  }

  function reset() {
    if (!draft) return;
    const orders = openOrders();
    const original = defaults();
    for (const base of original) {
      const occupied = draft.find(t => t.name === base.name && orders.has(t.id));
      if (occupied) base.id = occupied.id;
    }
    const extra = draft.filter(t => orders.has(t.id) && !original.some(base => base.id === t.id));
    const required = original.filter(t => t.id === 'bar' || orders.has(t.id)).concat(extra);
    const free = original.filter(t => !required.includes(t));
    draft = required.concat(free.slice(0, 16 - required.length));
    selected = null;
    draw();
  }

  function save() {
    if (!draft) return;
    if (!Store.set(key, draft)) { toast('No se pudo guardar el plano'); return; }
    draft = null;
    draw();
    toast('Plano guardado');
  }

  function choose(id) {
    const table = layout().find(t => t.id === id);
    if (!table) return;
    const order = openOrders().get(id);
    if (order && order.id !== checkout.floorOrderId) {
      if (source === 'checkout') {
        toast('Esta mesa ya tiene una cuenta abierta', { subtitle:'Puedes editarla desde Mesas en Nueva venta.' });
        return;
      }
      resumeSavedSale(order.id, true);
      return;
    }
    if (source !== 'checkout' && !order) return;
    if (checkout.floorOrderId && checkout.floorTableId !== table.id) {
      toast('Esta cuenta ya está asignada a ' + checkout.table);
      return;
    }
    checkout.floorTableId = table.id;
    checkout.serviceType = 'mesa';
    checkout.table = table.name;
    returnToCheckout();
  }

  function returnToCheckout() {
    const scroll = checkoutScroll;
    checkoutScroll = null;
    openCartSheet('checkout', scroll);
  }

  function canCharge() {
    const table = currentTable();
    if (!table) return false;
    const id = openOrders().get(table.id)?.id;
    return checkout.floorOrderId ? id === checkout.floorOrderId : !id;
  }

  function park() {
    if (!cart.length) return;
    const table = currentTable();
    if (!table) { open('checkout'); return; }
    if (checkout.menuOrderId || checkout.vpcCuenta) return;
    const order = openOrders().get(table.id);
    if (!canCharge()) {
      toast('La cuenta de esta mesa cambió');
      return;
    }
    if (!parkNow(table.name, order?.id)) { toast('No se pudo guardar el pedido'); return; }
    closeModal();
    render();
    toast('Pedido guardado en ' + table.name, { variant:'toast-success' });
  }

  function quickButton() {
    const count = openOrders().size;
    const label = count === 1 ? 'Mesas, 1 mesa abierta' : count ? 'Mesas, ' + count + ' mesas abiertas' : 'Mesas';
    const badge = count ? `<span class="vp-floor-count" aria-hidden="true">${count}</span>` : '';
    return `<button class="tool-btn vp-floor-quick" onclick="VPMesas.open('sale')" title="Mesas" aria-label="${label}">${tableIcon}${badge}</button>`;
  }

  return { open, back, edit, add, remove, reset, save, park, canCharge, quickButton, tableIcon };
})();
