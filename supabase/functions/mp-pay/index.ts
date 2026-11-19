// =============================================================================
//  mp-pay · cobra la tarjeta del cliente a la cuenta del negocio
//  ---------------------------------------------------------------------------
//  Del navegador llegan el token y los datos del pagador. El número de tarjeta,
//  fecha de vencimiento y código de seguridad van directo a Mercado Pago.
//
//  El monto lo pone el servidor: sale de charge_total, que fijó el negocio al
//  aceptar el pedido. Lo que diga el navegador no cuenta.
//
//  Contra cobros dobles:
//   1. Si el pedido ya está pagado, se contesta y no se cobra otra vez.
//   2. Cada intento lleva X-Idempotency-Key atado al token de la tarjeta: si el
//      celular reintenta por mala señal, Mercado Pago devuelve el MISMO pago.
//   3. mp_payments.idempotency_key es único: dos peticiones a la vez no crean
//      dos cobros.
// =============================================================================
import {
  admin, cors, cuentaConTokenVivo, esIdDePedido, fallo, json,
  marcarPagado, mpPost, redondea2,
} from './mp.ts';

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
  cc_rejected_invalid_installments: 'Tu tarjeta no acepta ese número de pagos.',
  pending_contingency: 'Mercado Pago lo está revisando. Te avisamos en cuanto termine.',
  pending_review_manual: 'Mercado Pago lo está revisando. Te avisamos en cuanto termine.',
};

function textoCorto(valor: unknown, limite: number) {
  return typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ').slice(0, limite) : '';
}

async function sha256(texto: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origen = req.headers.get('origin') ?? undefined;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origen) });
  if (req.method !== 'POST') return fallo('Método no permitido', 405, origen);

  try {
    const b = await req.json().catch(() => ({}));
    if (!esIdDePedido(b?.order_id)) return fallo('Ese pedido no existe', 404, origen);
    if (typeof b?.token !== 'string' || b.token.length < 8 || b.token.length > 200) {
      return fallo('Faltan los datos de la tarjeta', 400, origen);
    }

    const sb = admin();

    // ---- 1. El pedido y su monto, tal como los dejó el negocio ----
    const { data: pedido } = await sb
      .from('menu_orders')
      .select('id, menu_id, user_id, code, charge_total, charge_status, data')
      .eq('id', b.order_id)
      .maybeSingle();

    if (!pedido) return fallo('Ese pedido no existe', 404, origen);
    if (pedido.charge_status === 'paid') {
      return json({ ok: true, status: 'approved', ya_pagado: true }, 200, origen);
    }

    const monto = redondea2(Number(pedido.charge_total));
    if (!(monto > 0)) return fallo('Este pedido todavía no tiene total. Pídeselo al negocio.', 409, origen);

    const correo = typeof b?.payer?.email === 'string' ? b.payer.email.trim() : '';
    if (correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return fallo('Escribe un correo electrónico válido en el formulario de tarjeta.', 400, origen);
    }

    // ---- 2. La cuenta del negocio (token secreto, nunca sale de aquí) ----
    const cuenta = await cuentaConTokenVivo(sb, pedido.user_id as string);
    if (!cuenta) return fallo('Este negocio aún no cobra con tarjeta', 409, origen);

    const lineas = Array.isArray(pedido.data?.original) ? pedido.data.original : [];
    const { data: menu } = await sb.from('public_menus')
      .select('data->prods')
      .eq('id', pedido.menu_id)
      .eq('user_id', pedido.user_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const productos: Array<{ id: string; category?: string; description?: string }> =
      Array.isArray(menu?.prods) ? menu.prods : [];
    const catalogo = new Map(productos.map((producto) => [producto.id, producto]));
    const [nombreTitular, ...apellidosTitular] = textoCorto(b.cardholder_name, 100).split(' ');
    const nombre = textoCorto(b.payer?.first_name, 100) || nombreTitular;
    const apellido = textoCorto(b.payer?.last_name, 100) || apellidosTitular.join(' ');

    // ---- 3. Un intento = un token de tarjeta. Reintentar no cobra dos veces ----
    const clave = (await sha256(`${pedido.id}:${b.token}`)).slice(0, 48);

    const { data: ultimo, error: eUltimo } = await sb.from('mp_payments')
      .select('status, created_at, idempotency_key')
      .eq('order_id', pedido.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eUltimo) return fallo('No pudimos consultar el intento anterior.', 503, origen);

    if (ultimo && (ultimo.idempotency_key === clave ||
        ['creating', 'pending', 'in_process', 'authorized', 'approved'].includes(ultimo.status))) {
      return json({ ok: true, status: 'pending', existing_attempt: true }, 200, origen);
    }
    if (ultimo && ['rejected', 'cancelled'].includes(ultimo.status) &&
        Date.now() - Date.parse(ultimo.created_at) < 30000) {
      return fallo('Espera 30 segundos antes de volver a intentar el pago con tarjeta.', 409, origen);
    }

    const { error: eIns } = await sb.from('mp_payments').insert({
      order_id: pedido.id,
      user_id: pedido.user_id,
      amount: monto,
      status: 'creating',
      idempotency_key: clave,
    });
    if (eIns) {
      if (eIns.code === '23505') return json({ ok: true, status: 'pending', existing_attempt: true }, 200, origen);
      console.error('registrar intento', eIns);
      return fallo('No se pudo empezar el cobro. Intenta otra vez.', 500, origen);
    }

    // ---- 4. El cobro, a nombre del negocio ----
    const items = lineas.flatMap((linea: Record<string, unknown> | null) => {
      if (!linea || typeof linea.name !== 'string' || !linea.name.trim()) return [];
      const qty = Number(linea.qty);
      const price = Number(linea.price);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) return [];
      const title = Number.isInteger(qty) ? linea.name : `${linea.name} (${qty} ${linea.unit ?? ''})`;
      const producto = typeof linea.productId === 'string' ? catalogo.get(linea.productId) : undefined;
      const detalle = [textoCorto(linea.name, 120), textoCorto(linea.sizeLabel, 60)].filter(Boolean).join(' · ');
      return [{
        id: typeof linea.productId === 'string' ? linea.productId.slice(0, 100) : undefined,
        title: title.slice(0, 120),
        description: textoCorto(producto?.description, 200) || detalle,
        category_id: textoCorto(producto?.category, 100) || 'others',
        quantity: Number.isInteger(qty) ? qty : 1,
        unit_price: redondea2(Number.isInteger(qty) ? price : qty * price),
      }];
    });
    const customer = pedido.data?.customer;
    const deliveryFee = pedido.data?.deliveryFee;
    const deviceId = typeof b.device_id === 'string' && /^[!-~]{1,512}$/.test(b.device_id)
      ? b.device_id : undefined;

    const cuerpo: Record<string, unknown> = {
      ...(b.supports_3ds === true
        ? { three_d_secure_mode: 'optional' }
        : {}),
      transaction_amount: monto,            // <- del servidor, no del navegador
      token: b.token,
      description: `Pedido ${pedido.code ?? pedido.id}`,
      installments: Math.max(1, Math.min(12, Number(b?.installments) || 1)),
      payment_method_id: typeof b?.payment_method_id === 'string' ? b.payment_method_id : undefined,
      issuer_id: b?.issuer_id ? String(b.issuer_id) : undefined,
      external_reference: String(pedido.id),
      statement_descriptor: 'VENDOPLUS',
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
      payer: {
        email: correo,
        ...(nombre ? { first_name: nombre } : {}),
        ...(apellido ? { last_name: apellido } : {}),
        ...(b?.payer?.identification?.type && b?.payer?.identification?.number
          ? { identification: { type: String(b.payer.identification.type), number: String(b.payer.identification.number) } }
          : {}),
      },
      ...(items.length ? { additional_info: { items } } : {}),
      metadata: {
        order_id: pedido.id,
        order_code: pedido.code ?? '',
        ...(customer?.service === 'domicilio' && typeof deliveryFee === 'number' && Number.isFinite(deliveryFee)
          ? { delivery_fee: deliveryFee }
          : {}),
      },
    };
    Object.keys(cuerpo).forEach((k) => cuerpo[k] === undefined && delete cuerpo[k]);

    const r = await mpPost('/v1/payments', cuenta.access_token, cuerpo, clave, deviceId).catch(() => null);
    if (!r) return json({ ok: true, status: 'pending', existing_attempt: true }, 200, origen);
    const pago = r.body ?? {};

    if (!r.ok || !pago?.id) {
      const msg = pago?.message ?? pago?.error ?? 'Mercado Pago no pudo procesar el pago';
      console.error('mp payment', r.status, pago?.error);
      if (r.ok || r.status >= 500 || [408, 409, 429].includes(r.status)) {
        return json({ ok: true, status: 'pending', existing_attempt: true }, 200, origen);
      }
      await sb.from('mp_payments')
        .update({ status: 'error', status_detail: String(msg).slice(0, 200), updated_at: new Date().toISOString() })
        .eq('idempotency_key', clave);
      return fallo(String(msg).slice(0, 160), 400, origen);
    }

    await sb.from('mp_payments').update({
      mp_payment_id: String(pago.id),
      status: String(pago.status ?? 'pending'),
      status_detail: String(pago.status_detail ?? ''),
      updated_at: new Date().toISOString(),
    }).eq('idempotency_key', clave);

    // ---- 5. Marcar pagado SOLO con lo que contestó Mercado Pago ----
    //      (marcarPagado vuelve a revisar el monto y que no estuviera ya pagado)
    if (pago.status === 'approved') {
      await marcarPagado(sb, pedido.id as string, pago);
    } else if (pago.status === 'rejected' || pago.status === 'cancelled') {
      await sb.from('menu_orders').update({ charge_status: 'rejected' })
        .eq('id', pedido.id).neq('charge_status', 'paid');
    }

    return json({
      ok: true,
      status: pago.status === 'approved' ? 'approved' : (pago.status === 'rejected' || pago.status === 'cancelled' ? 'rejected' : 'pending'),
      status_detail_text: TEXTO_ESTADO[String(pago.status_detail ?? '')] ?? '',
      mp_payment_id: String(pago.id),
      status_detail: String(pago.status_detail ?? ''),
      ...(b.supports_3ds === true && pago.status_detail === 'pending_challenge'
        ? { three_ds_info: pago.three_ds_info }
        : {}),
    }, 200, origen);
  } catch (e) {
    console.error('mp-pay', e);
    return fallo('No se pudo procesar el pago. Intenta otra vez.', 500, origen);
  }
});
