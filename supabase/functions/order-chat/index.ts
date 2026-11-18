import { admin, cors, fallo, json, usuarioDeLaSesion } from '../mp-order/mp.ts';

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? undefined;
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return fallo('Método inválido', 405, origin);
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (!['create','get','message','read','state'].includes(action) ||
      typeof body?.id !== 'string' || !/^o[a-z0-9]{6,24}$/.test(body.id)) {
    return fallo('Pedido inválido', 400, origin);
  }
  try {
    let hash: string | null = null;
    let owner: string | null = null;
    if (typeof body.token === 'string' && /^[a-f0-9]{64}$/.test(body.token)) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.token));
      hash = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2,'0')).join('');
    } else if (action !== 'create') {
      owner = await usuarioDeLaSesion(request);
    }
    if (!owner && !hash) return fallo('Pedido no disponible', 404, origin);
    const payload = body.payload ?? {};
    if (JSON.stringify(payload).length > 80000) return fallo('El pedido es demasiado grande', 413, origin);
    const { data, error } = await admin().rpc('order_chat_request', {
      p_order_id: body.id, p_hash: hash, p_owner: owner, p_action: action, p_payload: payload,
    });
    if (error) {
      if (error.code === 'P0001') return fallo(error.message, error.message === 'Pedido no disponible' ? 404 : 409, origin);
      console.error('order-chat', error.code);
      return fallo('No se pudo actualizar el pedido. Vuelve a intentarlo.', 503, origin);
    }
    return json(data, 200, origin);
  } catch (error) {
    console.error('order-chat', error instanceof Error ? error.name : 'error');
    return fallo('No se pudo conectar con el pedido', 503, origin);
  }
});
