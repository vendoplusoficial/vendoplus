// =============================================================================
//  VENDO PLUS · piezas compartidas de Mercado Pago
//  ---------------------------------------------------------------------------
//  Aquí vive todo lo que toca secretos. Nada de esto llega nunca al navegador.
// =============================================================================
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

export const MP_API = 'https://api.mercadopago.com';

export const env = (k: string, obligatorio = true): string => {
  // .trim() a propósito: al pegar un secreto en el panel de Supabase es muy
  // fácil que se cuele un espacio o un salto de línea al final. Invisible en
  // el panel, pero viaja en la URL como %0A o '+' y Mercado Pago contesta
  // invalid_redirect_uri aunque el valor "se vea" idéntico al registrado.
  const v = (Deno.env.get(k) ?? '').trim();
  if (!v && obligatorio) throw new Error(`Falta configurar el secreto ${k}`);
  return v;
};

/** Cliente con la llave de servidor. Se salta RLS: solo se usa aquí dentro. */
export function admin(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ---------------------------------------------------------------- CORS */
export function cors(origen?: string): Record<string, string> {
  const permitido = Deno.env.get('APP_ORIGIN') ?? '*';
  return {
    'Access-Control-Allow-Origin': permitido === '*' ? (origen ?? '*') : permitido,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
export const json = (body: unknown, status = 200, origen?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origen), 'Content-Type': 'application/json' },
  });
export const fallo = (mensaje: string, status = 400, origen?: string) =>
  json({ ok: false, error: mensaje }, status, origen);

/* ------------------------------------------------- quién hace la llamada */
/** Devuelve el id del negocio que mandó la petición, o null si no hay sesión válida. */
export async function usuarioDeLaSesion(req: Request): Promise<string | null> {
  const h = req.headers.get('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || token === env('SUPABASE_ANON_KEY', false)) return null;
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

/* ------------------------------------------------------------- cuentas */
export interface CuentaMP {
  user_id: string;
  mp_user_id: string;
  public_key: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  live_mode: boolean;
  nickname: string | null;
}

/** Trae la cuenta del negocio y, si el token ya venció, lo renueva antes de devolverlo. */
export async function cuentaConTokenVivo(sb: SupabaseClient, userId: string): Promise<CuentaMP | null> {
  const { data } = await sb.from('mp_accounts').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return null;
  const cuenta = data as CuentaMP;

  // Margen de 5 minutos: así nunca se usa un token a punto de vencer.
  const vence = new Date(cuenta.expires_at).getTime();
  if (Number.isFinite(vence) && vence - Date.now() > 5 * 60 * 1000) return cuenta;

  const r = await fetch(`${MP_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env('MP_CLIENT_ID'),
      client_secret: env('MP_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: cuenta.refresh_token,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.access_token) {
    console.error('mp refresh falló', r.status, j);
    return cuenta; // se intenta con el que hay; si Mercado Pago lo rechaza, se avisa arriba
  }

  const actualizada = {
    access_token: j.access_token as string,
    refresh_token: (j.refresh_token as string) ?? cuenta.refresh_token,
    public_key: (j.public_key as string) ?? cuenta.public_key,
    expires_at: new Date(Date.now() + (Number(j.expires_in) || 15552000) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await sb.from('mp_accounts').update(actualizada).eq('user_id', userId);
  return { ...cuenta, ...actualizada };
}

/* ------------------------------------------------------- llamadas a MP */
export async function mpGet(ruta: string, accessToken: string) {
  const r = await fetch(`${MP_API}${ruta}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

export async function mpPost(ruta: string, accessToken: string, cuerpo: unknown, idempotencia?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (idempotencia) headers['X-Idempotency-Key'] = idempotencia;
  const r = await fetch(`${MP_API}${ruta}`, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

/* --------------------------------------------------------- utilidades */
export const redondea2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function esIdDePedido(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(id);
}

/** Firma del webhook de Mercado Pago (x-signature). */
export async function firmaValida(req: Request, dataId: string): Promise<boolean> {
  const secreto = env('MP_WEBHOOK_SECRET', false);
  // Sin secreto configurado no se puede verificar: se rechaza, nunca se asume válido.
  if (!secreto) return false;

  const sig = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';
  const partes = Object.fromEntries(
    sig.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const ts = partes['ts'];
  const v1 = partes['v1'];
  if (!ts || !v1) return false;

  // Una notificación muy vieja no se acepta (evita reenvíos grabados)
  const edad = Math.abs(Date.now() - Number(ts) * 1000);
  if (!Number.isFinite(edad) || edad > 10 * 60 * 1000) return false;

  const manifiesto = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifiesto));
  const esperado = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');

  // Comparación de tiempo constante
  if (esperado.length !== v1.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  return dif === 0;
}

/* --------------------- marcar un pedido como pagado (una sola vez) ------ */
/**
 * Marca el pedido como pagado SOLO si:
 *  · Mercado Pago contestó 'approved' cuando el servidor le preguntó, y
 *  · el monto aprobado coincide con el que el negocio fijó, y
 *  · el pedido todavía no estaba pagado.
 * Devuelve true si este fue el que lo marcó (para no avisar dos veces).
 */
export async function marcarPagado(
  sb: SupabaseClient,
  orderId: string,
  pago: { id: string | number; status: string; status_detail?: string; transaction_amount?: number },
): Promise<boolean> {
  if (pago.status !== 'approved') return false;

  const { data: pedido } = await sb
    .from('menu_orders')
    .select('id, charge_total, charge_status')
    .eq('id', orderId)
    .maybeSingle();
  if (!pedido) return false;
  if (pedido.charge_status === 'paid') return false; // ya estaba: no se repite

  const esperado = redondea2(Number(pedido.charge_total));
  const cobrado = redondea2(Number(pago.transaction_amount));
  if (!(esperado > 0) || Math.abs(esperado - cobrado) > 0.01) {
    console.error('monto distinto al fijado', { orderId, esperado, cobrado });
    return false;
  }

  // Con la condición en el where, dos webhooks a la vez no lo marcan dos veces.
  const { data, error } = await sb
    .from('menu_orders')
    .update({
      charge_status: 'paid',
      mp_payment_id: String(pago.id),
      paid_amount: cobrado,
      paid_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .neq('charge_status', 'paid')
    .select('id');

  if (error) { console.error('no se pudo marcar pagado', error); return false; }
  return Array.isArray(data) && data.length > 0;
}
