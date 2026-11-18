/* Order chat. Customer links carry a secret; Realtime carries only invalidations. */
const orderChatLabels = {
  pending:'Por confirmar', confirmed:'Confirmado', preparing:'Preparando pedido',
  route:'En camino', delivered:'Entregado', rejected:'Rechazado', cancelled:'Cancelado'
};
let activeOrderChat = null;

function orderChatRoute(){
  const match = location.hash.match(/^#chat\/(o[a-z0-9]{6,24})\/([a-f0-9]{64})$/);
  return match ? { id:match[1], token:match[2] } : null;
}

function orderChatURL(id, token, route = 'chat'){
  return location.origin + location.pathname + '#' + route + '/' + id + '/' + token;
}

function orderChatNavigate(id, token, route){
  location.assign(orderChatURL(id, token, route));
  location.reload();
}

async function orderChatCall(id, action, payload = {}, token = null){
  const body = { id, action, payload };
  const call = token
    ? pgFetch('order-chat', { ...body, token })
    : mpCall('order-chat', body, true);
  return mdiTimeout(call, 15000);
}

function orderChatItems(items){
  return (items || []).map(item => `<li><span>${escapeHtml(item.name || 'Producto')}${item.sizeLabel ? ' · ' + escapeHtml(item.sizeLabel) : ''}</span><b>× ${escapeHtml(String(item.qty))}</b></li>`).join('');
}

function orderChatSummary(data){
  const customer = data.customer || {};
  return `<div class="vp-chat-summary">
    <ul>${orderChatItems(data.items)}</ul>
    <p><strong>Total</strong><strong>${formatMoney(data.total)}</strong></p>
    <p><span>${escapeHtml(paymentOf(customer.payment || 'efectivo').name)}</span>${data.paid ? '<strong>Pago confirmado</strong>' : ''}</p>
    ${customer.service === 'domicilio'
      ? `<p><span>${escapeHtml(customer.loc?.ref || 'Dirección marcada en el pedido')}</span></p>`
      : '<p><span>Recoger en el negocio</span></p>'}
  </div>`;
}

function orderChatProgress(state, delivery){
  const index = ['pending','confirmed','preparing','route','delivered'].indexOf(state);
  const steps = ['Confirmar pedido','Preparando pedido',delivery ? 'Iniciando ruta de repartidor' : 'Entregar pedido'];
  return `<ol class="vp-chat-progress">${steps.map((step,i) => {
    const active = index >= [1,2,3][i];
    return `<li class="${active ? 'active' : ''}"><i>${i + 1}</i><span>${step}</span></li>`;
  }).join('')}</ol>`;
}

function orderChatThread(data, merchant){
  return data.messages.map(message => {
    const own = message.author === (merchant ? 'business' : 'customer');
    const peer = own && Number(message.id) <= Number(merchant ? data.customer_read : data.business_read);
    const date = new Date(message.created_at);
    return `<article class="vp-chat-bubble ${message.author === 'system' ? 'system' : (own ? 'own' : '')}">
      <div>${escapeHtml(message.body)}</div>
      <small><time datetime="${escapeHtml(message.created_at)}">${escapeHtml(date.toLocaleString('es-MX',{ day:'numeric',month:'short',hour:'numeric',minute:'2-digit' }))}</time>${peer ? ' · Leído' : ''}</small>
    </article>`;
  }).join('');
}

function orderChatLayout(merchant, id){
  return `
    <header class="${merchant ? 'sheet-header' : 'vp-chat-head'}">
      <div><h2>${merchant ? 'Chat del pedido' : 'Seguimiento de pedido'}</h2><small id="vpChatOrder"></small></div>
      ${merchant
        ? `<button type="button" class="sheet-close" onclick="mdiOpen('${id}')" aria-label="Volver al pedido">${icon('chevronLeft')}</button>`
        : '<button type="button" class="btn ghost" onclick="orderChatCopy()">Copiar enlace</button>'}
    </header>
    <div id="vpChatProgress"></div>
    <details class="vp-chat-details"${merchant ? '' : ' open'}><summary>Resumen del pedido</summary><div id="vpChatSummary"></div></details>
    <div id="vpChatActions"></div>
    <section id="vpChatThread" class="vp-chat-thread" role="log" aria-label="Conversación"></section>
    <p id="vpChatError" role="status"></p>
    <form id="vpChatForm" class="vp-chat-form" onsubmit="event.preventDefault(); orderChatSend(this)">
      <textarea name="body" rows="1" maxlength="1000" placeholder="Escribe un mensaje…" aria-label="Mensaje" required></textarea>
      <button class="btn primary" type="submit">Enviar</button>
    </form>`;
}

function orderChatStop(){
  const chat = activeOrderChat;
  if(!chat) return;
  clearInterval(chat.timer);
  if(chat.channel && chat.client) chat.client.removeChannel(chat.channel);
  activeOrderChat = null;
}

function orderChatStart(id, token, root){
  orderChatStop();
  activeOrderChat = { id, token, root, data:null, busy:false, read:0 };
  const chat = activeOrderChat;
  chat.timer = setInterval(() => {
    if(!root.isConnected){ orderChatStop(); return; }
    if(!document.hidden) orderChatRefresh(chat);
  }, 5000);
  orderChatRefresh(chat);
}

function bootOrderChat(route){
  document.body.classList.add('dm-mode','vp-chat-mode');
  document.getElementById('splash')?.remove();
  const root = document.createElement('main');
  root.className = 'vp-chat vp-chat-customer';
  root.innerHTML = orderChatLayout(false, route.id);
  document.body.appendChild(root);
  orderChatStart(route.id, route.token, root);
}

function mdiOpenChat(id){
  openModal(`<div class="vp-chat vp-chat-business">${orderChatLayout(true,id)}</div>`,{ dismissible:true });
  orderChatStart(id, null, document.querySelector('#modal-layer .vp-chat-business'));
}

function orderChatError(chat, message){
  const box = chat.root.querySelector('#vpChatError');
  if(box) box.textContent = message || '';
}

function orderChatSubscribe(chat, topic){
  if(chat.channel || !topic || typeof supabase === 'undefined') return;
  chat.client = chat.token
    ? supabase.createClient(VENDO_CONFIG.SUPABASE_URL,VENDO_CONFIG.SUPABASE_ANON_KEY,{ auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }, global:{ headers:{ 'X-Client-Info':'vendoplus-order-chat' } } })
    : Cloud.sb;
  if(!chat.client) return;
  chat.channel = chat.client.channel(topic).on('broadcast',{event:'changed'},() => orderChatRefresh(chat))
    .subscribe(status => { if(status === 'SUBSCRIBED') orderChatRefresh(chat); });
}

async function orderChatRefresh(chat){
  if(chat !== activeOrderChat || chat.busy || !chat.root.isConnected) return;
  chat.busy = true;
  try{
    const data = await orderChatCall(chat.id,'get',{},chat.token);
    if(chat !== activeOrderChat || !chat.root.isConnected) return;
    orderChatPaint(chat,data);
    orderChatSubscribe(chat,data.topic);
    const author = chat.token ? 'business' : 'customer';
    const last = data.messages.filter(m=>m.author===author).at(-1)?.id || 0;
    if(!document.hidden && last > Math.max(chat.read, Number(chat.token ? data.customer_read : data.business_read))){
      await orderChatCall(chat.id,'read',{ through:last },chat.token);
      chat.read = last;
    }
  }catch(e){ if(!chat.data) orderChatError(chat,e.message); }
  finally{ chat.busy = false; }
}

function orderChatRefundHTML(data){
  if(!['cancelled','rejected'].includes(data.state) || !data.refund_method) return '';
  const payment = data.refund_method === 'tarjeta' ? 'con tarjeta por Mercado Pago' : 'por transferencia';
  const phone = String(data.refund_whatsapp || '');
  if(!/^[1-9][0-9]{7,14}$/.test(phone)){
    return '<div class="vp-chat-wait">Escríbele al negocio en este chat para solicitar el reembolso.</div>';
  }
  const message = 'Hola, mi pedido ' + data.code + ' fue cancelado. Ya pagué ' + payment + '. ¿Me pueden ayudar con el reembolso, por favor?';
  const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message);
  return `<div class="vp-chat-wait"><span>¿Necesitas tu reembolso?</span><a class="btn ghost" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Solicitar reembolso por WhatsApp</a></div>`;
}

function orderChatPaint(chat,data){
  const previous = chat.data;
  chat.data = data;
  const find = key => chat.root.querySelector('#vpChat' + key);
  if(!previous || previous.state !== data.state || previous.refund_method !== data.refund_method || previous.refund_whatsapp !== data.refund_whatsapp){
    find('Order').textContent = (data.business ? data.business + ' · ' : '') + data.code + ' · ' + (chat.token && data.state === 'rejected' ? 'Cancelado' : orderChatLabels[data.state]);
    find('Progress').innerHTML = orderChatProgress(data.state,data.customer?.service === 'domicilio');
    find('Actions').innerHTML = data.state === 'pending' && chat.token
      ? `<div class="vp-chat-wait">${icon('clock')}<span>Esperando confirmación</span><button class="btn ghost" type="button" onclick="orderChatCancel()">Cancelar pedido</button></div>`
      : (chat.token ? orderChatRefundHTML(data) : '');
  }
  if(!previous) find('Summary').innerHTML = orderChatSummary(data);
  const channel = find('Thread');
  const timeline = orderChatThread(data,!chat.token);
  if(chat.timeline !== timeline){
    const stick = !previous || channel.scrollHeight - channel.clientHeight - channel.scrollTop < 90;
    channel.innerHTML = timeline;
    chat.timeline = timeline;
    if(stick) channel.scrollTop = channel.scrollHeight;
  }
}

async function orderChatSend(form){
  const chat = activeOrderChat;
  if(!chat || !chat.data || chat.sending) return;
  const input = form.elements.body;
  const body = input.value.trim();
  if(!body) return;
  if(!chat.draft || chat.draft.body !== body) chat.draft = { body, nonce:crypto.randomUUID() };
  chat.sending = true;
  form.querySelector('button').disabled = true;
  try{
    await orderChatCall(chat.id,'message',chat.draft,chat.token);
    if(input.value.trim() === body) input.value = '';
    chat.draft = null;
    orderChatError(chat,'');
    orderChatRefresh(chat);
  }catch(e){ orderChatError(chat,e.message); }
  finally{ chat.sending = false; form.querySelector('button').disabled = false; }
}

function orderChatCopy(){
  mdCopy(location.href,'Enlace copiado', message => { if(activeOrderChat) orderChatError(activeOrderChat,message); });
}

function orderChatCancel(){
  const chat = activeOrderChat;
  if(!chat || chat.data?.state !== 'pending') return;
  askConfirm({
    title:'¿Cancelar tu pedido?', text:chat.data.paid ? 'Después de cancelar podrás contactar al negocio para solicitar el reembolso.' : 'El negocio verá que cancelaste el pedido.',
    ok:'Cancelar pedido', cancel:'Conservar pedido', danger:true
  },async () => {
    try{
      const data = await orderChatCall(chat.id,'state',{state:'cancelled'},chat.token);
      orderChatPaint(chat,data);
    }catch(e){ orderChatError(chat,e.message); orderChatRefresh(chat); }
  });
}

function mdiChatSet(id,state){
  const order = MDI.get(id);
  if(!order?.chatCheckout) return;
  return mdiChatChange(order,state).then(ok => { if(ok) mdiOpen(id,true); });
}

async function mdiChatChange(order,state,extra = {}){
  if(!order.chatCheckout) return true;
  try{
    const data = await orderChatCall(order.id,'state',{state,...extra});
    MDI.update(order.id,o => { o.chatState = data.state; if(data.eta) o.etaMin = data.eta; });
    return true;
  }catch(e){ toast(e.message,{variant:'toast-danger'}); MdiCloud.pull(true); return false; }
}

function mdiChatActions(order){
  if(!order.chatCheckout) return '';
  const next = {
    confirmed:['preparing','Preparar pedido'],
    preparing:mdiIsDelivery(order) ? ['route','Iniciar ruta'] : ['delivered','Marcar como entregado'],
    route:['delivered','Marcar como entregado']
  }[order.chatState];
  return `<div class="vp-chat-pos">
    <button type="button" class="btn ghost" onclick="mdiOpenChat('${order.id}')">Chat del pedido${order.chatUnread ? ' · ' + order.chatUnread + ' sin leer' : ''}</button>
    ${next ? `<button type="button" class="btn primary" onclick="mdiChatSet('${order.id}','${next[0]}')">${next[1]}</button>` : ''}
    ${order.chatState === 'delivered' ? '<b>Entregado</b>' : ''}
  </div>`;
}

function mdiChatMetadata(o,incoming){
  const oldUnread = o.chatUnread || 0;
  if(incoming.chatUnread > oldUnread) toast('Nuevo mensaje en ' + incoming.code, {
    subtitle:incoming.customer?.name || 'Cliente del Menú Digital'
  });
  o.chatUnread = incoming.chatUnread;
  o.chatState = incoming.chatState;
  if(incoming.etaMin) o.etaMin = incoming.etaMin;
  if(incoming.mp) o.mp = incoming.mp;
  if(incoming.chatState === 'rejected') o.status = 'rechazado';
  else if(incoming.chatState === 'cancelled' && !o.saleId) o.status = 'cancelado';
  else if(['confirmed','preparing','route','delivered'].includes(incoming.chatState) && o.status === 'nuevo') o.status = 'confirmado';
}
