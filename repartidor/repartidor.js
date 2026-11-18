const deliveryBackend = 'https://yacmyrpluhjaphvrbqno.supabase.co';
const deliveryPublicKey = 'sb_publishable_uxy6ZYubuYn6Q2LPwuElpg_qYwwWinX';
const find = id => document.getElementById(id);
const notify = message => { find('notice').textContent = message; };
const auth = supabase.createClient(deliveryBackend,deliveryPublicKey,{auth:{storageKey:'vendo-repartidor-auth'}});
const invite = location.hash.match(/^#enlace=([a-f0-9]{32})$/i)?.[1];
if(invite){
  sessionStorage.setItem('vendo-repartidor-invite',invite);
  history.replaceState(null,'',location.pathname + location.search);
}
let currentSession = null;
let requestVersion = 0;

async function request(action,details = {}){
  const {data:{session}} = await auth.auth.getSession();
  if(!session) throw Error('Inicia sesión para continuar.');
  const response = await fetch(deliveryBackend + '/functions/v1/delivery-driver',{
    method:'POST',headers:{'Content-Type':'application/json',apikey:deliveryPublicKey,Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({action,...details})
  });
  const result = await response.json();
  if(!response.ok || !result.ok) throw Error(result.error || 'No se pudo actualizar el reparto.');
  return result;
}

function element(tag,text,cls){
  const node = document.createElement(tag);
  node.textContent = text;
  if(cls) node.className = cls;
  return node;
}

function listOrders(orders){
  const fragment = document.createDocumentFragment();
  for(const order of orders){
    const card = element('article','');
    const inTransit = order.state === 'route';
    card.append(element('span',inTransit ? 'En camino' : 'Por recoger','tag'),
      element('h2',order.business + ' · ' + order.code));
    if(order.reference) card.append(element('p',order.reference));
    const actions = element('div','','actions');
    if(Number.isFinite(order.lat) && Number.isFinite(order.lng)){
      const map = element('a','Abrir dirección','action');
      map.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(order.lat + ',' + order.lng);
      map.target='_blank'; map.rel='noopener noreferrer';
      actions.append(map);
    }
    const button = element('button',inTransit ? 'Marcar como entregado' : 'Iniciar ruta','primary');
    button.type = 'button';
    button.onclick = async () => {
      button.disabled = true;
      try{
        await request(inTransit ? 'deliver' : 'start',{id:order.id});
        notify(inTransit ? 'Pedido entregado.' : 'Ruta iniciada. El cliente ya puede ver el estado En camino.');
        await refresh();
      }catch(error){ notify(error.message); }
      finally{ button.disabled = false; }
    };
    actions.append(button);
    card.append(actions);
    fragment.append(card);
  }
  if(!orders.length) fragment.append(element('p','Aún no tienes pedidos asignados.'));
  find('orders').replaceChildren(fragment);
}

async function refresh(){
  const version = ++requestVersion;
  const data = await request('list');
  if(version !== requestVersion || !currentSession) return;
  find('businesses').textContent = data.businesses.length ? 'Negocios enlazados · ' + data.businesses.map(x=>x.name).join(', ') : 'Pide al negocio un enlace de invitación para ver su pedido.';
  listOrders(data.orders);
}

async function applySession(session){
  currentSession=session;
  ++requestVersion;
  find('login').hidden=!!session;
  find('workspace').hidden=!session;
  find('signout').hidden=!session;
  if(session) {
    find('link-form').elements.code.value = sessionStorage.getItem('vendo-repartidor-invite') || '';
    try{ await refresh(); }catch(error){ notify(error.message); }
  }
}

find('login-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const fields={email:form.elements.email.value.trim(),password:form.elements.password.value};
  const signup=event.submitter?.value==='signup';
  const buttons=Array.from(form.querySelectorAll('button'));
  buttons.forEach(button=>button.disabled=true);
  try{
    const result=signup ? await auth.auth.signUp({...fields,options:{emailRedirectTo:location.origin+location.pathname}}) : await auth.auth.signInWithPassword(fields);
    if(result.error) throw result.error;
    if(signup && !result.data.session) notify('Revisa tu correo para confirmar tu cuenta y vuelve a abrir tu invitación.');
    else { form.reset(); notify(''); }
  }catch(error){ notify(error.message); }
  finally{ buttons.forEach(button=>button.disabled=false); }
};
find('link-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector('button');
  button.disabled=true;
  try{
    const value=form.elements.code.value.trim();
    const code=value.match(/(?:#enlace=)?([a-f0-9]{32})$/i)?.[1] || value;
    await request('link',{code});
    sessionStorage.removeItem('vendo-repartidor-invite');
    form.reset();
    notify('Negocio enlazado. Ya puedes ver el pedido asignado.');
    await refresh();
  }catch(error){ notify(error.message); }
  finally{ button.disabled=false; }
};
find('signout').onclick=async()=>{
  const {error}=await auth.auth.signOut();
  notify(error?.message || '');
};
auth.auth.onAuthStateChange((event,session)=>{
  if(event==='TOKEN_REFRESHED'){ currentSession=session; return; }
  if(event==='SIGNED_IN' && currentSession?.user.id===session?.user.id) return;
  setTimeout(()=>applySession(session),0);
});
window.addEventListener('focus',()=>{ if(currentSession) refresh().catch(error=>notify(error.message)); });

find('refresh-orders').onclick=()=>refresh().catch(error=>notify(error.message));
