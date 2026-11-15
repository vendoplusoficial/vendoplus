// =====================================================================
// promo-checkout · Igual que create-checkout, MÁS el cupón del 25%.
// verify_jwt = true. Solo funciona para negocios asociados a un promotor.
// · No toca create-checkout: los clientes normales siguen usándola.
// · Manda la MISMA metadata (supabase_user_id, stripe_customer_id), así el
//   stripe-webhook actual activa la membresía sin ningún cambio.
// · No escribe en profiles: el stripe-webhook actual guarda el cliente al
//   completarse el pago, como hoy. El cliente nuevo se recuerda en promo_negocios.
// · Bloquea una segunda suscripción y la doble membresía con Google Play.
// =====================================================================
import { admin, config, CORS, json, rpc, stripe } from "./promo_stripe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Sesión inválida o expirada." }, 401);
    if (!user.email) return json({ error: "Tu cuenta no tiene correo electrónico." }, 400);

    const cfg = await config();
    const priceId = Deno.env.get("STRIPE_PRICE_ID");
    const appUrl = Deno.env.get("APP_URL");
    if (!cfg.programa_activo || !cfg.stripe_coupon_id || !priceId || !appUrl) {
      return json({ error: "El descuento no está disponible en este momento.", usar_normal: true }, 409);
    }

    const { data: neg } = await admin.from("promo_negocios")
      .select("id, stripe_customer_id, descuento_estado, excluido_motivo")
      .eq("negocio_user_id", user.id).maybeSingle();
    if (!neg || neg.excluido_motivo || neg.descuento_estado !== "checkout") {
      return json({ error: "Tu cuenta no tiene el descuento de promotor.", usar_normal: true }, 409);
    }

    // Solo lectura de profiles
    const { data: perfil } = await admin.from("profiles")
      .select("stripe_customer_id, vp_play_pagado_hasta, play_paid_until").eq("user_id", user.id).maybeSingle();
    const ahora = Date.now();
    const playActivo = [perfil?.vp_play_pagado_hasta, perfil?.play_paid_until]
      .some((d) => d && new Date(d).getTime() > ahora);
    if (playActivo) return json({ error: "Tu membresía está activa en Google Play. Cancélala ahí antes de pagar en la web." }, 409);

    // Verificaciones de seguridad del precio y del cupón (si algo no cuadra, NO se cobra)
    const price = await stripe.prices.retrieve(priceId);
    const prod = typeof price.product === "string" ? price.product : price.product.id;
    if (!price.active || price.unit_amount !== cfg.precio_normal_cents || price.currency !== cfg.moneda
        || !cfg.stripe_productos.includes(prod)) {
      console.error("[promo-checkout] el precio no coincide con promo_config", { price: price.id });
      return json({ error: "El descuento no está disponible en este momento.", usar_normal: true }, 409);
    }
    const coupon = await stripe.coupons.retrieve(cfg.stripe_coupon_id);
    if (!coupon.valid || Number(coupon.percent_off) !== Number(cfg.descuento_pct) || coupon.duration !== "forever") {
      console.error("[promo-checkout] el cupón no coincide con promo_config");
      return json({ error: "El descuento no está disponible en este momento.", usar_normal: true }, 409);
    }

    // Cliente de Stripe: el de profiles, el ya creado para el promotor, o uno nuevo
    let customerId: string | null = perfil?.stripe_customer_id ?? neg.stripe_customer_id ?? null;
    if (customerId) {
      try {
        const c = await stripe.customers.retrieve(customerId);
        if ("deleted" in c && c.deleted) customerId = null;
      } catch { customerId = null; }
    }
    if (!customerId) {
      const c = await stripe.customers.create(
        { email: user.email, metadata: { supabase_user_id: user.id } },
        { idempotencyKey: `promo-cliente-${user.id}` },
      );
      customerId = c.id;
      await rpc("promo_guardar_cliente", { p_negocio: neg.id, p_customer: customerId });
    }

    // Nunca una segunda suscripción
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    if (subs.data.some((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status))) {
      return json({ error: "Ya tienes una membresía activa." }, 409);
    }

    const meta = { supabase_user_id: user.id, stripe_customer_id: customerId, promo: "1", promo_negocio_id: neg.id };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      discounts: [{ coupon: cfg.stripe_coupon_id }],
      subscription_data: { metadata: meta },
      success_url: `${appUrl}/?pago=ok`,
      cancel_url: `${appUrl}/?pago=cancel`,
      client_reference_id: user.id,
      metadata: meta,
    });

    const conDescuento = Math.round(cfg.precio_normal_cents * (100 - Number(cfg.descuento_pct)) / 100);
    return json({ url: session.url, precio_normal_cents: cfg.precio_normal_cents, precio_cents: conDescuento });
  } catch (e) {
    console.error("[promo-checkout]", e);
    return json({ error: "No se pudo abrir el pago. Intenta de nuevo." }, 500);
  }
});
