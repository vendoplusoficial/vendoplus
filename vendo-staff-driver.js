/* Reparto interno del POS. El acceso del repartidor vive solo en esta vista. */
function staffDriverOpen(event){
  event?.preventDefault();
  location.hash = 'reparto';
  location.reload();
}

function staffDriverBoot(){
  document.body.classList.add('dm-mode','vp-staff-driver');
  document.getElementById('splash')?.remove();
  const page = document.createElement('main');
  page.className = 'vp-driver-page';
  page.innerHTML = `
    <header class="vp-chat-head"><h1>VendoPlus · Reparto</h1><button class="btn ghost" type="button" id="vpDriverExit">Salir</button></header>
    <p id="vpDriverNotice" role="status" aria-live="polite"></p>
    <section id="vpDriverLink" class="vp-chat-details">
      <h2>Enlazar con un negocio</h2>
      <form id="vpDriverForm">
        <div class="field"><label for="vpDriverName">Tu nombre</label><input id="vpDriverName" name="name" minlength="2" maxlength="50" autocomplete="off" required></div>
        <div class="field"><label for="vpDriverCode">Código del negocio</label><input id="vpDriverCode" name="code" minlength="16" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" required></div>
        <button class="btn primary block" type="submit">Entrar a reparto</button>
      </form>
    </section>
    <section id="vpDriverOrders" hidden></section>`;
  document.body.appendChild(page);
  const find = id => page.querySelector('#' + id);
  const notice = message => { find('vpDriverNotice').textContent = message; };
  const form = find('vpDriverForm');
  const submit = form.querySelector('button');
  let access = null;
  let busy = false;

  function render(data){
    find('vpDriverLink').hidden = true;
    const orders = find('vpDriverOrders');
    orders.hidden = false;
    orders.innerHTML = `<div class="vp-chat-details"><h2>${escapeHtml(data.business)}</h2><p>${escapeHtml(data.name)}</p>
      <button class="btn ghost" type="button" data-action="list">Actualizar pedidos</button></div>
      ${data.orders.length ? data.orders.map(order=>{
        const route = order.state === 'route';
        const map = Number.isFinite(order.lat) && Number.isFinite(order.lng)
          ? `<a class="btn ghost" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(order.lat+','+order.lng)}" target="_blank" rel="noopener noreferrer">Abrir dirección</a>` : '';
        return `<article class="vp-chat-details"><h3>${escapeHtml(order.code)}</h3>
          <p>${route ? 'En camino' : 'Por recoger'}${order.reference ? ' · ' + escapeHtml(order.reference) : ''}</p>
          <div class="vp-chat-pos">${map}<button class="btn primary" type="button" data-order="${escapeHtml(order.id)}" data-action="${route ? 'deliver' : 'start'}">${route ? 'Marcar como entregado' : 'Iniciar ruta'}</button></div></article>`;
      }).join('') : '<p>Aún no tienes pedidos asignados.</p>'}`;
  }

  async function refresh(){
    const data = await pgFetch('delivery-driver',{action:'list',...access});
    render(data);
  }

  form.onsubmit = async event => {
    event.preventDefault();
    if(busy) return;
    busy = true;
    submit.disabled = true;
    try{
      const credentials = {name:form.elements.name.value.trim(),code:form.elements.code.value.trim()};
      const data = await pgFetch('delivery-driver',{action:'enter',...credentials});
      access = credentials;
      form.reset();
      notice('');
      render(data);
    }catch(error){ notice(error.message); }
    finally{ busy = false; submit.disabled = false; }
  };

  find('vpDriverOrders').onclick = async event => {
    const button = event.target.closest('button[data-action]');
    if(!button || busy || !access) return;
    busy = true;
    button.disabled = true;
    try{
      const action = button.dataset.action;
      if(action !== 'list'){
        await pgFetch('delivery-driver',{action,id:button.dataset.order,...access});
        notice(action === 'start' ? 'Ruta iniciada.' : 'Pedido entregado.');
      }else notice('');
      await refresh();
    }catch(error){ notice(error.message); }
    finally{ busy = false; button.disabled = false; }
  };
  find('vpDriverExit').onclick = () => {
    access = null;
    location.href = location.href.split('#')[0];
    location.reload();
  };
}

async function staffDriverManage(){
  if(!mdDelDraft || mdDelDraft.on !== true) return;
  openModal(`<div class="sheet-header"><div class="sheet-header-left">
    <button class="sheet-back" type="button" aria-label="Volver a servicio a domicilio" onclick="mdRenderDeliveryForm()">${icon('chevronLeft')}</button>
    <h2>Repartidores</h2>
  </div></div><div id="vpDriverManagement" role="status">Cargando código…</div>`,{dismissible:false});
  const panel = document.getElementById('vpDriverManagement');
  async function load(){
    try{
      const {code,drivers} = await mpCall('delivery-driver',{action:'manage',business_name:bizData().name || ''},true);
      if(!panel.isConnected) return;
      panel.innerHTML = `<p>Comparte este código solo con tus repartidores. Entrarán con su nombre desde la pantalla inicial de VendoPlus.</p>
        <div class="field"><label for="vpBusinessDriverCode">Código del negocio</label><input id="vpBusinessDriverCode" readonly value="${escapeHtml(code)}"></div>
        <button type="button" class="btn primary block" id="vpDriverCopy">Copiar código</button>
        ${drivers.length ? `<div>${drivers.map(driver=>`<div class="md-del-rates-row"><b>${escapeHtml(driver.name)}</b><button class="btn ghost" type="button" data-remove-driver="${escapeHtml(driver.id)}">Eliminar</button></div>`).join('')}</div>` : '<p>Aún no hay repartidores registrados.</p>'}`;
      panel.querySelector('#vpDriverCopy').onclick = () => mdCopy(code,'Código copiado');
      panel.querySelectorAll('[data-remove-driver]').forEach(button=>{
        button.onclick = () => {
          const driver = drivers.find(item=>item.id===button.dataset.removeDriver);
          if(!driver) return;
          askConfirm({
            title:'¿Eliminar a ' + escapeHtml(driver.name) + '?',
            text:'Su nombre quedará disponible. Los pedidos que tenga asignados podrán asignarse a otra persona.',
            ok:'Eliminar',cancel:'Volver',danger:true
          },async ()=>{
            try{ await mpCall('delivery-driver',{action:'remove',driver:driver.id},true); await load(); }
            catch(error){ toast(error.message,{variant:'toast-danger'}); }
          });
        };
      });
    }catch(error){ if(panel.isConnected) panel.textContent = error.message; }
  }
  await load();
}
