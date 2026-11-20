import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const origin = 'https://vendoplusoficial.com';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const json = (data: object, status = 200) => Response.json(data, { status, headers });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const key = Deno.env.get('STRIPE_MENU_TEST_SECRET_KEY') ?? '';
  if (!/^(sk|rk)_test_/.test(key)) return json({ error: 'Stripe de prueba no está configurado.' }, 503);
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } });
    async function stripe(path: string, form?: URLSearchParams, accountId?: string, attempt?: string) {
      const stripeHeaders = new Headers({
        Authorization: 'Bearer ' + key, 'Stripe-Version': '2026-11-18.endive',
      });
      if (accountId) stripeHeaders.set('Stripe-Account', accountId);
      if (attempt) stripeHeaders.set('Idempotency-Key', 'vendoplus-menu-test-' + attempt);
      const response = await fetch('https://api.stripe.com/' + path, {
        method: form ? 'POST' : 'GET', body: form, headers: stripeHeaders,
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        console.error('stripe-menu-test-checkout rejected', path.split('?')[0].split('/').slice(0, 3).join('/'),
          response.status, response.headers.get('request-id'));
        throw new Error('Stripe API request rejected');
      }
      return response.json();
    }

    const drafts = sb.from('stripe_menu_test_orders');
    async function reconcile(draft: {id:string; menu_id:string; account_id:string; amount:number; session_id:string; finished_at:string|null; payload:{code:string}}) {
      if (draft.finished_at) return { paid: true, code: draft.payload.code, amount: draft.amount };
      const session = await stripe('v1/checkout/sessions/' + draft.session_id, undefined, draft.account_id);
      if (session.livemode !== false || session.id !== draft.session_id || session.amount_total !== draft.amount ||
          session.currency !== 'mxn' || session.metadata?.menu_id !== draft.menu_id ||
          session.metadata?.order_id !== draft.id || session.metadata?.flow !== 'vendoplus_menu_test') {
        throw new Error('Checkout mismatch');
      }
      const paid = session.payment_status === 'paid';
      if (paid) {
        const { error } = await sb.rpc('deliver_stripe_menu_test_order', { p_id: draft.id, p_session: draft.session_id });
        if (error) throw error;
      }
      return { paid, expired: session.status === 'expired', code: draft.payload.code, amount: draft.amount };
    }

    const worker = req.headers.get('x-stripe-test-worker');
    if (worker) {
      const { data: allowed, error } = await sb.rpc('check_stripe_menu_test_worker', { p_token: worker });
      if (error || allowed !== true) return json({ error: 'No autorizado' }, 403);
      const { data: pending, error: listError } = await drafts.select('*')
        .not('session_id', 'is', null).is('finished_at', null).is('expired_at', null)
        .order('checked_at', { ascending: true, nullsFirst: true }).limit(10);
      if (listError) throw listError;
      const results = await Promise.allSettled(pending.map(async draft => {
        const { error: touchError } = await drafts.update({ checked_at: new Date().toISOString() }).eq('id', draft.id);
        if (touchError) throw touchError;
        const result = await reconcile(draft);
        if (!result.paid && result.expired) {
          const { error } = await drafts.update({ expired_at: new Date().toISOString() }).eq('id', draft.id);
          if (error) throw error;
        }
        return result;
      }));
      return json({ checked: results.length, failures: results.filter(result => result.status === 'rejected').length });
    }

    if (!token) return json({ error: 'Inicia sesión en VendoPlus.' }, 401);
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) return json({ error: 'Inicia sesión en VendoPlus.' }, 401);
    const input = await req.json();
    if (typeof input.menuId !== 'string' || !input.menuId || input.menuId.length > 100) {
      return json({ error: 'Menú no válido.' }, 400);
    }
    const { data: menu, error: menuError } = await sb.from('public_menus')
      .select('id').eq('id', input.menuId).eq('user_id', user.id).maybeSingle();
    if (menuError) throw menuError;
    if (!menu) return json({ error: 'Abre el menú de tu negocio con tu sesión de VendoPlus.' }, 403);
    if (input.action === 'status') {
      if (typeof input.sessionId !== 'string' || !/^cs_test_[a-zA-Z0-9]+$/.test(input.sessionId)) {
        return json({ error: 'Sesión de prueba no válida.' }, 400);
      }
      const { data: draft, error } = await drafts.select('*').eq('session_id', input.sessionId)
        .eq('menu_id', menu.id).eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!draft) return json({ error: 'Este pago no tiene un pedido de prueba asociado.' }, 404);
      return json(await reconcile(draft));
    }

    const { data: account, error: accountError } = await sb.from('stripe_menu_accounts')
      .select('stripe_account_id').eq('user_id', user.id).eq('livemode', false).eq('connected', true).maybeSingle();
    if (accountError) throw accountError;
    if (!account && input.action === 'availability') return json({ available: false });
    if (!account) return json({ error: 'Primero enlaza Stripe en modo de prueba.' }, 409);

    async function canPayWithCard() {
      const linked = await stripe('v2/core/accounts/' + account!.stripe_account_id +
        '?include%5B0%5D=configuration.merchant', undefined);
      return linked.livemode === false && !linked.closed &&
        linked.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
    }
    if (input.action === 'availability') return json({ available: await canPayWithCard() });
    const order = input.order;
    if (input.action !== 'start' || !order || typeof order.id !== 'string' ||
        !/^o[a-z0-9]{6,24}$/.test(order.id) || !Array.isArray(order.original) ||
        order.customer?.payment !== 'tarjeta' || !['llevar', 'domicilio'].includes(order.customer?.service)) {
      return json({ error: 'Pedido de prueba no válido.' }, 400);
    }
    if (!await canPayWithCard()) {
      return json({ error: 'Stripe todavía no habilita tarjetas para esta cuenta de prueba.' }, 409);
    }

    const { data: quote, error: quoteError } = await sb.rpc('quote_stripe_test_order', {
      p_menu_id: menu.id, p_order: order,
    });
    if (quoteError) throw quoteError;
    if (!quote?.ok) return json({ error: quote?.error || 'No pudimos calcular el total.' }, 400);

    const payload = {
      v: 1, id: order.id, code: order.code, createdAt: new Date().toISOString(),
      stripeTest: true, customer: order.customer, original: quote.lines, total: quote.subtotal,
      autoDelivery: quote.deliveryFee != null, deliveryFee: quote.deliveryFee,
    };
    const { error: saveError } = await drafts.upsert({
      id: order.id, user_id: user.id, menu_id: menu.id, account_id: account.stripe_account_id,
      amount: quote.amount, payload,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (saveError) throw saveError;
    const { data: saved, error: readError } = await drafts.select('*').eq('id', order.id)
      .eq('user_id', user.id).eq('menu_id', menu.id).eq('account_id', account.stripe_account_id).single();
    if (readError) throw readError;
    if (saved.finished_at) return json({ error: 'El pedido de prueba ya fue pagado.' }, 409);

    const menuHash = '#menu/' + encodeURIComponent(menu.id);
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: origin + '/?stripe_menu_test=1&stripe_test_session={CHECKOUT_SESSION_ID}' + menuHash,
      cancel_url: origin + '/?stripe_menu_test=1&stripe_test_cancel=1' + menuHash,
      'metadata[menu_id]': menu.id,
      'metadata[flow]': 'vendoplus_menu_test',
      'metadata[order_id]': saved.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'mxn',
      'line_items[0][price_data][unit_amount]': String(saved.amount),
      'line_items[0][price_data][product_data][name]': 'Pedido de prueba VendoPlus ' + saved.payload.code,
    });
    const session = await stripe('v1/checkout/sessions', form, saved.account_id, saved.id);
    const url = new URL(session.url);
    if (session.livemode !== false || url.origin !== 'https://checkout.stripe.com') {
      throw new Error('Unexpected checkout link');
    }
    const { error: sessionError } = await drafts.update({ session_id: session.id }).eq('id', saved.id);
    if (sessionError) throw sessionError;
    return json({ url: url.href });
  } catch {
    return json({ error: 'No pudimos procesar el pago de prueba. Inténtalo de nuevo.' }, 502);
  }
});
