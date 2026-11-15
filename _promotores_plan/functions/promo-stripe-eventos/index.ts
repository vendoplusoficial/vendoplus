// =====================================================================
// promo-stripe-eventos · SEGUNDO webhook de Stripe, independiente.
// verify_jwt = false (Stripe no manda sesión). Seguridad = firma de Stripe
// con su PROPIA clave (PROMO_STRIPE_WEBHOOK_SECRET), distinta a la actual.
//
// · El webhook actual (stripe-webhook) sigue igual y sigue activando las
//   membresías. Este solo OBSERVA y escribe en tablas promo_*.
// · Idempotente: cada evt_… se registra una vez; un duplicado se ignora.
// · No confía en el contenido del evento para el dinero: relee de Stripe
//   todas las facturas del cliente y recalcula (el orden no importa).
// · Si falla, responde 500 y Stripe reintenta (hasta 3 días). Si algo se
//   pierde, la conciliación diaria lo recupera.
// =====================================================================
import Stripe from "npm:stripe@17.7.0";
import { config, rpc, sincronizarCliente, stripe } from "./promo_stripe.ts";

const ok = (b: unknown = { ok: true }) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });

const idDe = (x: unknown): string | null => !x ? null : typeof x === "string" ? x : (x as { id?: string }).id ?? null;

async function clienteDelEvento(ev: Stripe.Event): Promise<{ customer: string | null; user: string | null }> {
  // deno-lint-ignore no-explicit-any
  const o = ev.data.object as any;
  switch (ev.type) {
    case "checkout.session.completed":
      return { customer: idDe(o.customer), user: o.metadata?.supabase_user_id ?? null };
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return { customer: idDe(o.customer), user: o.metadata?.supabase_user_id ?? null };
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      const ch = await stripe.charges.retrieve(idDe(o.charge)!);
      return { customer: idDe(ch.customer), user: null };
    }
    default: // invoice.* y charge.refunded / charge.refund.updated
      return { customer: idDe(o.customer), user: null };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const firma = req.headers.get("stripe-signature");
  const secreto = Deno.env.get("PROMO_STRIPE_WEBHOOK_SECRET");
  if (!firma || !secreto) return new Response("Falta la firma", { status: 400 });

  let ev: Stripe.Event;
  try {
    ev = await stripe.webhooks.constructEventAsync(await req.text(), firma, secreto);
  } catch {
    return new Response("Firma inválida", { status: 400 });
  }

  const objeto = idDe(ev.data.object);
  const estado = await rpc<string>("promo_registrar_evento", {
    p_event_id: ev.id, p_tipo: ev.type, p_objeto: objeto,
    p_creado: new Date(ev.created * 1000).toISOString(), p_livemode: ev.livemode,
  });
  if (estado === "duplicado") return ok({ ok: true, duplicado: true });

  try {
    if (!ev.livemode) {
      await rpc("promo_cerrar_evento", { p_event_id: ev.id, p_estado: "ignorado", p_motivo: "modo_prueba", p_negocio: null });
      return ok();
    }
    const { customer, user } = await clienteDelEvento(ev);
    if (!customer) {
      await rpc("promo_cerrar_evento", { p_event_id: ev.id, p_estado: "ignorado", p_motivo: "sin_cliente", p_negocio: null });
      return ok();
    }
    const negocio = await rpc<string | null>("promo_negocio_por_cliente", { p_customer: customer, p_user: user });
    if (!negocio) {
      await rpc("promo_cerrar_evento", { p_event_id: ev.id, p_estado: "ignorado", p_motivo: "cliente_no_participa", p_negocio: null });
      return ok();
    }
    const cfg = await config();
    const r = await sincronizarCliente(negocio, customer, cfg.stripe_productos);
    await rpc("promo_cerrar_evento", { p_event_id: ev.id, p_estado: "procesado", p_motivo: JSON.stringify(r.motor), p_negocio: negocio });
    return ok();
  } catch (e) {
    console.error("[promo-stripe-eventos]", ev.id, e);
    await rpc("promo_cerrar_evento", { p_event_id: ev.id, p_estado: "error", p_motivo: String((e as Error).message), p_negocio: null })
      .catch(() => {});
    return new Response("Error temporal", { status: 500 }); // Stripe reintenta
  }
});
