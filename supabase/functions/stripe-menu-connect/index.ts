import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const origin = 'https://vendoplusoficial.com';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers });
}

class StripeError extends Error {
  constructor(readonly code: string) {
    super('Stripe rechazó la solicitud');
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Inicia sesión en VendoPlus' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Supabase no está configurado' }, 503);
  const database = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: { user }, error: authError } = await database.auth.getUser(token);
    if (authError || !user) return json({ error: 'Inicia sesión en VendoPlus' }, 401);

    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== 'status' && action !== 'start') return json({ error: 'Acción inválida' }, 400);

    if (body.mode !== undefined && body.mode !== 'test' && body.mode !== 'live') {
      return json({ error: 'Modo de Stripe inválido' }, 400);
    }
    const live = body.mode === 'live';
    const mode = live ? 'live' : 'test';
    const key = Deno.env.get(live ? 'STRIPE_MENU_LIVE_SECRET_KEY' : 'STRIPE_MENU_TEST_SECRET_KEY') ?? '';
    if (!new RegExp('^(sk|rk)_' + mode + '_').test(key)) {
      if (live && action === 'status') return json({ linked: false, ready: false, available: false });
      return json({ error: 'Stripe Connect aún no está configurado para este modo' }, 503);
    }

    async function stripe(path: string, payload?: object, idempotencyKey?: string) {
      const stripeHeaders = new Headers({
        Authorization: 'Bearer ' + key,
        'Stripe-Version': '2026-11-18.endive',
      });
      if (payload) stripeHeaders.set('Content-Type', 'application/json');
      if (idempotencyKey) stripeHeaders.set('Idempotency-Key', idempotencyKey);
      const response = await fetch('https://api.stripe.com/v2/core/' + path, {
        method: payload ? 'POST' : 'GET',
        headers: stripeHeaders,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok) {
        const errorCode = result.error?.code ?? 'stripe_request_failed';
        const field = result.error?.param;
        console.error('Stripe Connect request rejected', JSON.stringify({
          operation: payload ? (path === 'accounts' ? 'create_account' : 'create_link') : 'read_account',
          status: response.status,
          code: errorCode,
          field: typeof field === 'string' && /^[a-z_.\[\]0-9]+$/i.test(field) ? field : undefined,
          requestId: response.headers.get('request-id'),
        }));
        throw new StripeError(errorCode);
      }
      return result;
    }

    const accounts = database.from('stripe_menu_accounts');
    const { data: row, error: readError } = await accounts
      .select('stripe_account_id').eq('user_id', user.id).eq('livemode', live).maybeSingle();
    if (readError) throw readError;
    let accountId = row?.stripe_account_id;

    if (action === 'status' && !accountId) return json({ linked: false, ready: false });
    if (!accountId) {
      const account = await stripe('accounts', {
        dashboard: 'full',
        identity: { country: 'mx' },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
        include: ['defaults'],
      }, 'vendoplus-menu-' + mode + '-full-' + user.id);
      if (account.livemode !== live || account.dashboard !== 'full' ||
          account.defaults?.responsibilities?.losses_collector !== 'stripe' ||
          account.defaults?.responsibilities?.fees_collector !== 'stripe') {
        throw new StripeError('unexpected_account_configuration');
      }
      const { error: writeError } = await accounts.upsert({
        user_id: user.id, livemode: live, stripe_account_id: account.id,
      }, { onConflict: 'user_id,livemode', ignoreDuplicates: true });
      if (writeError) throw writeError;
      const { data: persisted, error: reloadError } = await accounts
        .select('stripe_account_id').eq('user_id', user.id).eq('livemode', live).single();
      if (reloadError) throw reloadError;
      accountId = persisted.stripe_account_id;
    }

    if (action === 'status') {
      const account = await stripe('accounts/' + encodeURIComponent(accountId) +
        '?include%5B0%5D=configuration.merchant');
      const capabilities = account.configuration?.merchant?.capabilities;
      return json({
        linked: true,
        ready: account.livemode === live && !account.closed &&
          capabilities?.card_payments?.status === 'active' &&
          capabilities?.stripe_balance?.payouts?.status === 'active',
      });
    }

    const link = await stripe('account_links', {
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          refresh_url: origin + '/?stripe_menu=retry',
          return_url: origin + '/?stripe_menu=return',
        },
      },
    });
    const linkUrl = new URL(link.url);
    if (!['https://accounts.stripe.com', 'https://connect.stripe.com'].includes(linkUrl.origin)) throw new StripeError('unexpected_link_origin');
    return json({ url: linkUrl.href });
  } catch (error) {
    const code = error instanceof StripeError ? error.code : 'internal_error';
    console.error('stripe-menu-connect', code);
    return json({ error: 'No se pudo completar el enlace de Stripe', code }, 502);
  }
});
