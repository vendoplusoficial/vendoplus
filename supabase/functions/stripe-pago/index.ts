// stripe-pago · Lo que usa el CLIENTE en su pantalla de pago (…/#pagar/<pedido>).
//
// Es pública (la abre el cliente con el link de WhatsApp), así que solo devuelve
// lo mínimo: nombre y logo del negocio, folio, monto, estado del pago.
//
//  action "get"    → datos del pedido y, si ya hay un pago en curso, le pregunta
//                    a Stripe cómo va (nunca se confía en el navegador).
//  action "intent" → prepara el cobro en la cuenta de Stripe DEL NEGOCIO (cargo
//                    directo) por el monto que el negocio fijó al aceptar el pedido.
//
// · El monto lo decide el servidor (menu_orders.charge_total), no el navegador.
// · Los datos de la tarjeta van del celular del cliente directo a Stripe.
// · Un pedido se marca "paid" solo cuando Stripe dice que el cobro salió y el
//   monto coincide. Aun así, el negocio es quien lo registra como venta en el POS.
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const KEY = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
const LIVE = KEY.startsWith("sk_live_") || KEY.startsWith("rk_live_");
const PK = (Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "").trim() ||
  (LIVE ? "pk_live_51TQvX0Pj0LIsQQbTzBSEaWDCk0uPXV5Tv95Wx8qPLdrri3qrxFH8QEeoOGCunIUzwGao0aQtoETY9XwXxclEu5Jq005wno6Pc2" : "");
const stripe = new Stripe(KEY, { apiVersion: "2024-12-18.acacia" });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
const centavos = (n: unknown) => Math.round(Number(n) * 100);
const REUSABLE = ["requires_payment_method", "requires_confirmation", "requires_action"];

const RECHAZO: Record<string, string> = {
  insufficient_funds: "Tu tarjeta no tiene fondos suficientes.",
  card_declined: "Tu banco no autorizó el pago. Prueba con otra tarjeta.",
  expired_card: "Tu tarjeta está vencida.",
  incorrect_cvc: "Revisa el código de seguridad.",
  incorrect_number: "Revisa el número de tu tarjeta.",
  processing_error: "Hubo un error al procesar tu tarjeta. Inténtalo de nuevo.",
  authentication_required: "Tu banco pide que autorices el pago. Inténtalo de nuevo.",
};

type Pedido = {
  id: string; user_id: string; menu_id: string; code: string | null;
  charge_total: number | null; charge_status: string | null; stripe_pi_id: string | null;
};

async function cuentaDe(userId: string) {
  const { data } = await sb.from("stripe_menu_accounts")
    .select("stripe_account_id, connected, ready")
    .eq("user_id", userId).eq("livemode", LIVE).maybeSingle();
  return data && data.connected ? data : null;
}

/** Le pregunta a Stripe por el cobro del pedido y guarda el resultado. */
async function revisar(p: Pedido, acct: string | null) {
  if (p.charge_status === "paid") return { estado: "paid", detalle: "" };
  if (!p.stripe_pi_id || !acct) return { estado: p.charge_status === "rejected" ? "rejected" : "pending", detalle: "" };
  let pi: Stripe.PaymentIntent;
  try { pi = await stripe.paymentIntents.retrieve(p.stripe_pi_id, {}, { stripeAccount: acct }); }
  catch { return { estado: "pending", detalle: "" }; }
  if (pi.status === "succeeded") {
    const ok = pi.metadata?.order_id === p.id && pi.currency === "mxn" &&
      pi.amount_received === centavos(p.charge_total) && centavos(p.charge_total) > 0;
    if (!ok) { console.error("monto o pedido distinto", p.id, pi.id); return { estado: "processing", detalle: "" }; }
    await sb.from("menu_orders").update({
      charge_status: "paid", pay_provider: "stripe", paid_amount: pi.amount_received / 100,
      paid_at: new Date((pi.created || Date.now() / 1000) * 1000).toISOString(),
    }).eq("id", p.id).neq("charge_status", "paid");
    return { estado: "paid", detalle: "" };
  }
  if (pi.status === "processing") return { estado: "processing", detalle: "" };
  const err = pi.last_payment_error;
  if (pi.status === "requires_payment_method" && err) {
    return { estado: "rejected", detalle: RECHAZO[err.decline_code || ""] || RECHAZO[err.code || ""] || "Tu banco no autorizó el pago. Puedes intentar con otra tarjeta." };
  }
  return { estado: "pending", detalle: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    if (!KEY) return json({ error: "Este negocio aún no cobra con tarjeta en línea." }, 503);
    const b = await req.json().catch(() => ({}));
    const orderId = String(b?.order_id ?? "");
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(orderId)) return json({ error: "Ese pedido no existe" }, 404);

    const { data: pedido } = await sb.from("menu_orders")
      .select("id, user_id, menu_id, code, charge_total, charge_status, stripe_pi_id")
      .eq("id", orderId).maybeSingle();
    if (!pedido) return json({ error: "Ese pedido no existe" }, 404);
    const p = pedido as Pedido;
    const cuenta = await cuentaDe(p.user_id);
    const acct = cuenta?.stripe_account_id ?? null;

    // ---------------------------------------------------------------
    if (b?.action === "intent") {
      if (!acct || !cuenta?.ready) return json({ error: "Este negocio todavía no cobra con tarjeta en línea." }, 409);
      if (p.charge_status === "paid") return json({ status: "paid" });
      const monto = centavos(p.charge_total);
      if (!(monto >= 1000)) return json({ error: monto > 0 ? "El pago mínimo con tarjeta es de $10.00." : "Tu pedido todavía no tiene total. Espera a que el negocio lo confirme." }, 409);

      let pi: Stripe.PaymentIntent | null = null;
      if (p.stripe_pi_id) {
        try {
          const viejo = await stripe.paymentIntents.retrieve(p.stripe_pi_id, {}, { stripeAccount: acct });
          if (viejo.status === "succeeded") {
            const r = await revisar(p, acct);
            return json({ status: r.estado });
          }
          if (viejo.status === "processing") return json({ status: "processing" });
          if (REUSABLE.includes(viejo.status)) {
            pi = viejo.amount === monto ? viejo
              : await stripe.paymentIntents.update(viejo.id, { amount: monto }, { stripeAccount: acct });
          }
        } catch { pi = null; }
      }
      if (!pi) {
        pi = await stripe.paymentIntents.create({
          amount: monto,
          currency: "mxn",
          payment_method_types: ["card"],
          description: "Pedido " + (p.code || p.id),
          metadata: { order_id: p.id, code: p.code || "", origen: "vendoplus_menu" },
        }, { stripeAccount: acct, idempotencyKey: "vp-pedido-" + p.id + "-" + monto + "-" + (p.stripe_pi_id || "0") });
        await sb.from("menu_orders").update({ stripe_pi_id: pi.id, pay_provider: "stripe" }).eq("id", p.id).neq("charge_status", "paid");
      }
      return json({ status: "pending", client_secret: pi.client_secret, account: acct, publishable_key: PK, amount: monto / 100, livemode: LIVE });
    }

    // ---------------------------------------------------------------
    const r = await revisar(p, acct);
    let negocio = "", logo: string | null = null;
    const { data: menus } = await sb.from("public_menus").select("data")
      .eq("user_id", p.user_id).eq("id", p.menu_id).order("updated_at", { ascending: false }).limit(1);
    const biz = menus?.[0]?.data?.biz;
    if (biz) { negocio = String(biz.name ?? ""); logo = biz.logo ?? null; }
    return json({
      ok: true,
      code: p.code ?? "",
      business: negocio,
      business_logo: logo,
      amount: p.charge_total == null ? 0 : Number(p.charge_total),
      status: r.estado,
      status_text: r.detalle,
      can_pay: !!(acct && cuenta?.ready),
      livemode: LIVE,
    });
  } catch (e) {
    const err = e as { message?: string; type?: string; code?: string };
    console.error("stripe-pago", err?.type, err?.code, err?.message);
    return json({ error: "No se pudo preparar tu pago. Inténtalo de nuevo." }, 500);
  }
});
