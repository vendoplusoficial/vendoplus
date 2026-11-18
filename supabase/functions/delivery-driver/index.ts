import { admin, cors, fallo, json, usuarioDeLaSesion } from '../mp-order/mp.ts';

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? undefined;
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return fallo('Método inválido',405,origin);
  try {
    const actor = await usuarioDeLaSesion(request);
    if (!actor) return fallo('Inicia sesión para continuar',401,origin);
    const input = await request.json().catch(() => ({}));
    const businessAction = ['business-invite','business-link','business-drivers','business-assign'].includes(input.action);
    if (!businessAction && !['invite','link','list','start','deliver'].includes(input.action)) return fallo('Acción inválida',400,origin);
    let generated: string | undefined;
    if (['invite','business-invite','business-assign'].includes(input.action)) {
      generated = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,'0')).join('');
    }
    const code = generated ?? (typeof input.code === 'string' ? input.code.trim().toLowerCase() : '');
    if (['link','business-link'].includes(input.action) && !/^[a-f0-9]{32}$/.test(code)) return fallo('El código de enlace es inválido',400,origin);
    const hash = code ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))), byte => byte.toString(16).padStart(2,'0')).join('') : null;
    const params = { p_actor:actor, p_action:input.action, p_id:typeof input.id === 'string' ? input.id : null, p_hash:hash };
    const { data,error } = businessAction
      ? await admin().rpc('delivery_business_request',{
        ...params,p_code:code,p_name:typeof input.name === 'string' ? input.name : null,
        p_driver:typeof input.driver === 'string' ? input.driver : null
      })
      : await admin().rpc('delivery_driver_request',params);
    if (error) {
      if (error.code === 'P0001') return fallo(error.message,409,origin);
      console.error('delivery-driver',error.code);
      return fallo('No se pudo actualizar el reparto',503,origin);
    }
    return json({...data,...(input.action === 'invite' ? {code:generated} : {})},200,origin);
  } catch (_) {
    return fallo('No se pudo conectar con el reparto',503,origin);
  }
});
