// =============================================================================
//  mp-order · lo que ve el CLIENTE en su pantalla de pago
//  ---------------------------------------------------------------------------
//  Es pública (la abre el cliente con el link de WhatsApp), así que solo
//  devuelve lo mínimo: nombre del negocio, folio, monto a pagar, estado y la
//  clave PÚBLICA de Mercado Pago. Nada del negocio ni del pedido más allá.
//
//  El monto NO lo manda el navegador: sale de charge_total, que fijó el negocio.
// =============================================================================
import { admin, cors, esIdDePedido, fallo, json, mpGet, cuentaConTokenVivo, marcarPagado } from './mp.ts';

const TEXTO_ESTADO: Record<string, string> = {
  cc_rejected_bad_filled_card_number: 'Revisa el número de tu tarjeta.',
  cc_rejected_bad_filled_date: 'Revisa la fecha de vencimiento.',
  cc_rejected_bad_filled_security_code: 'Revisa el código de seguridad.',
  cc_rejected_bad_filled_other: 'Revisa los datos de tu tarjeta.',
  cc_rejected_insufficient_amount: 'Tu tarjeta no tiene fondos suficientes.',
  cc_rejected_high_risk: 'Tu banco no autorizó el pago. Prueba con otra tarjeta.',
  cc_rejected_call_for_authorize: 'Tu banco pide que autorices este cargo. Llámale y vuelve a intentar.',
  cc_rejected_card_disabled: 'Tu tarjeta está inactiva. Llama a tu banco.',
  cc_rejected_duplicated_payment: 'Ya hiciste este pago. Revisa tu estado de cuenta.',
  cc_rejected_max_attempts: 'Muchos intentos seguidos. Prueba con otra tarjeta.',
  pending_contingency: 'Mercado Pago lo está revisando. Te avisamos en cuanto termine.',
  pending_review_manual: 'Mercado Pago lo está revisando. Te avisamos en cuanto termine.',
};

Deno.serve(async (req) => {
  const origen = req.headers.get('origin') ?? undefined;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origen) });
  if (req.method !== 'POST') return fallo('Método no permitido', 405, origen);

  try {
    const b = await req.json().catch(() => ({}));
    if (!esIdDePedido(b?.order_id)) return fallo('Ese pedido no existe', 404, origen);

    const sb = admin();
    const { data: pedido } = await sb
      .from('menu_orders')
      .select('id, menu_id, user_id, code, charge_total, charge_status, mp_payment_id, data')
      .eq('id', b.order_id)
      .maybeSingle();

    if (!pedido) return fallo('Ese pedido no existe', 404, origen);

    if (b.action === 'send_whatsapp') {
      if (pedido.data?.mpCheckout !== true || pedido.charge_status !== 'paid') {
        return fallo('El pago debe estar confirmado para enviar el pedido', 409, origen);
      }
      if (pedido.data.whatsappRequested !== true) {
        const { data: enviado, error } = await sb.from('menu_orders')
          .update({ data: { ...pedido.data, whatsappRequested: true } })
          .eq('id', pedido.id).eq('charge_status', 'paid').select('id').maybeSingle();
        if (error || !enviado) return fallo('No se pudo enviar el pedido. Inténtalo de nuevo.', 503, origen);
      }
      return json({ ok: true }, 200, origen);
    }

    // Si está pendiente y ya hay un pago registrado, se le PREGUNTA a Mercado
    // Pago antes de contestar: así la pantalla nunca va por delante del banco.
    let estado = (pedido.charge_status as string) ?? 'pending';
    let detalle = '';
    let threeDSInfo = null;
    let paymentId = pedido.mp_payment_id ?? null;
    if (estado !== 'paid') {
      const { data: ultimo } = await sb
        .from('mp_payments')
        .select('mp_payment_id, status, status_detail')
        .eq('order_id', pedido.id)
        .not('mp_payment_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ultimo?.mp_payment_id) {
        if (['pending', 'in_process', 'authorized'].includes(String(ultimo.status))) estado = 'processing';
        const cuenta = await cuentaConTokenVivo(sb, pedido.user_id as string);
        if (cuenta) {
          const r = await mpGet(`/v1/payments/${ultimo.mp_payment_id}`, cuenta.access_token);
          if (r.ok && r.body?.status) {
            detalle = String(r.body.status_detail ?? '');
            if (b.supports_3ds === true && r.body.status === 'pending' && detalle === 'pending_challenge') {
              threeDSInfo = r.body.three_ds_info ?? null;
              paymentId = ultimo.mp_payment_id;
            }
            await sb.from('mp_payments')
              .update({ status: r.body.status, status_detail: detalle, updated_at: new Date().toISOString() })
              .eq('mp_payment_id', String(ultimo.mp_payment_id));

            if (r.body.status === 'approved') {
              await marcarPagado(sb, pedido.id as string, r.body);
              const { data: confirmado } = await sb.from('menu_orders')
                .select('mp_payment_id').eq('id', pedido.id).eq('charge_status', 'paid').maybeSingle();
              estado = confirmado ? 'paid' : 'processing';
              paymentId = confirmado?.mp_payment_id ?? null;
            } else if (r.body.status === 'rejected' || r.body.status === 'cancelled') {
              estado = 'rejected';
              await sb.from('menu_orders').update({ charge_status: 'rejected' })
                .eq('id', pedido.id).neq('charge_status', 'paid');
            } else {
              estado = 'processing';
            }
          }
        }
      }
    }

    // Datos del negocio que sí se pueden enseñar
    let negocio = '';
    let logo: string | null = null;
    const { data: menus } = await sb
      .from('public_menus')
      .select('data')
      .eq('user_id', pedido.user_id)
      .eq('id', pedido.menu_id)
      .order('updated_at', { ascending: false })
      .limit(1);
    const biz = menus?.[0]?.data?.biz;
    if (biz) { negocio = biz.name ?? ''; logo = biz.logo ?? null; }

    let publicKey = '';
    let liveMode = true;
    if (estado !== 'paid') {
      const { data: cuenta } = await sb
        .from('mp_accounts')
        .select('public_key, live_mode')
        .eq('user_id', pedido.user_id)
        .maybeSingle();
      if (cuenta) { publicKey = cuenta.public_key ?? ''; liveMode = cuenta.live_mode !== false; }
    }

    return json({
      ok: true,
      code: pedido.code ?? '',
      business: negocio,
      business_logo: logo,
      amount: pedido.charge_total == null ? 0 : Number(pedido.charge_total),
      status: estado,
      status_detail_text: TEXTO_ESTADO[detalle] ?? '',
      mp_payment_id: paymentId,
      status_detail: detalle,
      ...(threeDSInfo ? { three_ds_info: threeDSInfo } : {}),
      menu_checkout: pedido.data?.mpCheckout === true,
      whatsapp: pedido.data?.mpCheckout === true && estado === 'paid' ? String(menus?.[0]?.data?.wa ?? '').replace(/\D/g, '') : '',
      public_key: publicKey,
      live_mode: liveMode,
    }, 200, origen);
  } catch (e) {
    console.error('mp-order', e);
    return fallo('No se pudo abrir tu pago', 500, origen);
  }
});
