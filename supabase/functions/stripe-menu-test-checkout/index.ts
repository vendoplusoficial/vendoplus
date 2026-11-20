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
  if (!token) return json({ error: 'Inicia sesión en VendoPlus.' }, 401);
  const key = Deno.env.get('STRIPE_MENU_TEST_SECRET_KEY') ?? '';
  if (!/^(sk|rk)_test_/.test(key)) return json({ error: 'Stripe de prueba no está configurado.' }, 503);
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } });
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
    const { data: account, error: accountError } = await sb.from('stripe_menu_accounts')
      .select('stripe_account_id').eq('user_id', user.id).eq('livemode', false).eq('connected', true).maybeSingle();
    if (accountError) throw accountError;
    if (!account && input.action === 'availability') return json({ available: false });
    if (!account) return json({ error: 'Primero enlaza Stripe en modo de prueba.' }, 409);

    async function stripe(path: string, form?: URLSearchParams, connected = true, attempt?: string) {
      const stripeHeaders = new Headers({
        Authorization: 'Bearer ' + key, 'Stripe-Version': '2026-11-18.endive',
      });
      if (connected) stripeHeaders.set('Stripe-Account', account!.stripe_account_id);
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

    if (input.action === 'status') {
      if (typeof input.sessionId !== 'string' || !/^cs_test_[a-zA-Z0-9]+$/.test(input.sessionId)) {
        return json({ error: 'Sesión de prueba no válida.' }, 400);
      }
      const session = await stripe('v1/checkout/sessions/' + input.sessionId);
      if (session.livemode !== false || session.metadata?.menu_id !== menu.id ||
          session.metadata?.flow !== 'vendoplus_menu_test') {
        return json({ error: 'Sesión de prueba no válida.' }, 404);
      }
      return json({ paid: session.payment_status === 'paid' });
    }
    async function canPayWithCard() {
      const linked = await stripe('v2/core/accounts/' + account!.stripe_account_id +
        '?include%5B0%5D=configuration.merchant', undefined, false);
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

    const menuHash = '#menu/' + encodeURIComponent(menu.id);
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: origin + '/?stripe_menu_test=1&stripe_test_session={CHECKOUT_SESSION_ID}' + menuHash,
      cancel_url: origin + '/?stripe_menu_test=1&stripe_test_cancel=1' + menuHash,
      'metadata[menu_id]': menu.id,
      'metadata[flow]': 'vendoplus_menu_test',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'mxn',
      'line_items[0][price_data][unit_amount]': String(quote.amount),
      'line_items[0][price_data][product_data][name]': 'Pedido de prueba VendoPlus ' + order.code,
    });
    const session = await stripe('v1/checkout/sessions', form, true, order.id);
    const url = new URL(session.url);
    if (session.livemode !== false || url.origin !== 'https://checkout.stripe.com') {
      throw new Error('Unexpected checkout link');
    }
    return json({ url: url.href });
  } catch {
    return json({ error: 'No pudimos procesar el pago de prueba. Inténtalo de nuevo.' }, 502);
  }
});
