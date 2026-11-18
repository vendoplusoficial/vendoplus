import { admin, cors, fallo, json, usuarioDeLaSesion } from '../mp-order/mp.ts';

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? undefined;
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return fallo('Método inválido',405,origin);
  try {
    const input = await request.json().catch(() => null);
    const action = input?.action;
    const merchant = ['manage','remove','assign'].includes(action);
    if (!merchant && !['enter','list','start','deliver'].includes(action)) return fallo('Acción inválida',400,origin);
    const actor = merchant ? await usuarioDeLaSesion(request) : null;
    if (merchant && !actor) return fallo('Inicia sesión como negocio',401,origin);
    if (!merchant && (typeof input.code !== 'string' || !/^[A-F0-9]{16}$/i.test(input.code.trim()) ||
        typeof input.name !== 'string' || input.name.length > 100)) return fallo('Revisa el nombre y el código del negocio',400,origin);
    if (['remove','assign'].includes(action) && (typeof input.driver !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.driver))) return fallo('Repartidor inválido',400,origin);
    if (['assign','start','deliver'].includes(action) && (typeof input.id !== 'string' || !/^o[a-z0-9]{6,24}$/.test(input.id))) return fallo('Pedido inválido',400,origin);
    const payload = {
      code:input.code,name:input.name,id:input.id,driver:input.driver,
      business_name:typeof input.business_name === 'string' ? input.business_name.slice(0,120) : null,
      new_code:action === 'manage' ? Array.from(crypto.getRandomValues(new Uint8Array(8)),byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase() : null
    };
    const {data,error} = await admin().rpc('pos_delivery_request',{p_actor:actor,p_action:action,p_payload:payload});
    if (error) {
      if (error.code === 'P0001') return fallo(error.message,409,origin);
      console.error('delivery-driver',error.code);
      return fallo('No se pudo actualizar el reparto',503,origin);
    }
    return json(data,200,origin);
  } catch (_) {
    return fallo('No se pudo conectar con el reparto',503,origin);
  }
});
