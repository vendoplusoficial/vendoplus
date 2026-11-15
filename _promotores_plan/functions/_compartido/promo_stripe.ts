// =====================================================================
// VENDOPLUS · PROMOTORES · módulo compartido de Stripe
// ---------------------------------------------------------------------
// Se copia dentro de cada Edge Function promo-* al desplegar.
// · Usa la MISMA librería y versión de API que las funciones actuales
//   (stripe@17.7.0, "2024-12-18.acacia"), para que los objetos tengan
//   la misma forma (invoice.charge, invoice.subscription, line.price…).
// · Solo escribe en tablas promo_* mediante funciones SQL promo_*.
// · No toca profiles, ni create-checkout, ni stripe-webhook.
// =====================================================================
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-12-18.acacia",
});

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

export type Config = {
  programa_activo: boolean; precio_normal_cents: number; descuento_pct: number;
  stripe_coupon_id: string | null; stripe_productos: string[]; moneda: string;
};

export async function config(): Promise<Config> {
  const { data, error } = await admin.from("promo_config").select("*").eq("id", true).single();
  if (error || !data) throw new Error("No se pudo leer promo_config");
  return data as Config;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const iso = (t?: number | null) => (t ? new Date(t * 1000).toISOString() : null);
const idDe = (x: unknown): string | null =>
  !x ? null : typeof x === "string" ? x : (x as { id?: string }).id ?? null;

/** Línea de la factura que corresponde a la membresía (no prorrateos, no otros productos). */
export function lineaMembresia(inv: Stripe.Invoice, productos: string[]) {
  return inv.lines?.data?.find((l) =>
    l.type === "subscription" && !l.proration && productos.includes(idDe(l.price?.product) ?? "")
  ) ?? null;
}

function mapearDisputa(status: string): "abierta" | "ganada" | "perdida" {
  if (status === "won" || status === "warning_closed" || status === "prevented") return "ganada";
  if (status === "lost") return "perdida";
  return "abierta"; // needs_response, under_review, warning_needs_response, warning_under_review
}

/**
 * Relee de Stripe TODAS las facturas y suscripciones de membresía de un
 * cliente y las guarda en promo_pagos / promo_suscripciones. Después corre
 * el motor del negocio. Como siempre parte del estado actual de Stripe, no
 * importa el orden en que lleguen los eventos ni si alguno se perdió.
 */
export async function sincronizarCliente(negocioId: string, customerId: string, productos: string[]) {
  let after: string | undefined;
  let facturas = 0;
  do {
    const page = await stripe.invoices.list({
      customer: customerId, limit: 100, starting_after: after, expand: ["data.charge"],
    });
    for (const inv of page.data) {
      if (inv.status === "draft") continue;
      const linea = lineaMembresia(inv, productos);
      if (!linea) continue;
      const charge = inv.charge && typeof inv.charge === "object" ? (inv.charge as Stripe.Charge) : null;
      let disputa: string | null = null;
      if (charge?.disputed) {
        const ds = await stripe.disputes.list({ charge: charge.id, limit: 10 });
        const ultima = [...ds.data].sort((a, b) => b.created - a.created)[0];
        if (ultima) disputa = mapearDisputa(ultima.status);
      }
      const descuento = (inv.total_discount_amounts ?? []).reduce((s, d) => s + (d.amount ?? 0), 0);
      await rpc("promo_registrar_pago", {
        p: {
          invoice_id: inv.id, negocio_id: negocioId, customer_id: customerId,
          subscription_id: idDe(inv.subscription), charge_id: charge?.id ?? idDe(inv.charge),
          billing_reason: inv.billing_reason, estado: inv.status,
          pagado_cents: inv.amount_paid ?? 0, reembolsado_cents: charge?.amount_refunded ?? 0,
          descuento_cents: descuento, moneda: inv.currency, livemode: inv.livemode,
          producto_id: idDe(linea.price?.product),
          periodo_inicio: iso(linea.period?.start), periodo_fin: iso(linea.period?.end),
          pagado_en: iso(inv.status_transitions?.paid_at), disputa,
        },
      });
      facturas++;
    }
    after = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (after);

  for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
    const prod = idDe(sub.items.data[0]?.price?.product);
    if (!prod || !productos.includes(prod)) continue;
    // deno-lint-ignore no-explicit-any
    const cupon = (sub as any).discount?.coupon?.id ?? null;
    await rpc("promo_registrar_suscripcion", {
      p: {
        subscription_id: sub.id, negocio_id: negocioId, customer_id: customerId, estado: sub.status,
        producto_id: prod, cancel_al_final: sub.cancel_at_period_end, terminada_en: iso(sub.ended_at), cupon_id: cupon,
      },
    });
  }

  const res = await rpc("promo_procesar_negocio", { p_negocio: negocioId });
  return { facturas, motor: res };
}

/** Clientes de Stripe de un usuario: el de profiles (solo lectura) y los etiquetados con su id. */
export async function clientesDelUsuario(userId: string): Promise<{ ids: string[]; completo: boolean }> {
  const ids = new Set<string>();
  const { data: perfil } = await admin.from("profiles").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (perfil?.stripe_customer_id) ids.add(perfil.stripe_customer_id);
  let completo = true;
  try {
    const r = await stripe.customers.search({ query: `metadata['supabase_user_id']:'${userId}'`, limit: 100 });
    r.data.forEach((c) => ids.add(c.id));
  } catch (_e) {
    completo = ids.size > 0; // sin búsqueda y sin cliente en profiles: no se puede afirmar nada
  }
  return { ids: [...ids], completo };
}

export type Historial = {
  verificado: boolean; primerPago: string | null; customerId: string | null;
  subActiva: string | null; aptaDescuento: boolean; nota: string | null;
};

/** Primer pago real de membresía en Stripe y suscripción vigente (si hay). Solo lectura. */
export async function historialStripe(userId: string, cfg: Config): Promise<Historial> {
  const out: Historial = { verificado: false, primerPago: null, customerId: null, subActiva: null, aptaDescuento: false, nota: null };
  const { ids, completo } = await clientesDelUsuario(userId);
  if (!completo) return out;
  let primero: number | null = null;
  for (const cus of ids) {
    for await (const inv of stripe.invoices.list({ customer: cus, status: "paid", limit: 100 })) {
      if (!(inv.amount_paid > 0) || !lineaMembresia(inv, cfg.stripe_productos)) continue;
      const t = inv.status_transitions?.paid_at ?? inv.created;
      if (primero === null || t < primero) primero = t;
    }
    for await (const sub of stripe.subscriptions.list({ customer: cus, status: "all", limit: 100 })) {
      if (!["active", "trialing", "past_due", "unpaid"].includes(sub.status)) continue;
      const prod = idDe(sub.items.data[0]?.price?.product);
      if (!prod || !cfg.stripe_productos.includes(prod)) continue;
      out.subActiva = sub.id;
      out.customerId = cus;
      const r = revisarAptitud(sub, cfg);
      out.aptaDescuento = r.apta; out.nota = r.nota;
    }
  }
  out.customerId = out.customerId ?? ids[0] ?? null;
  out.primerPago = iso(primero);
  out.verificado = true;
  return out;
}

/** ¿Es técnicamente seguro poner el cupón en esta suscripción? */
export function revisarAptitud(sub: Stripe.Subscription, cfg: Config): { apta: boolean; nota: string | null } {
  // deno-lint-ignore no-explicit-any
  const s = sub as any;
  if (sub.status !== "active") return { apta: false, nota: `Suscripción en estado ${sub.status}` };
  if (sub.cancel_at_period_end) return { apta: false, nota: "La suscripción está programada para cancelarse" };
  if (sub.items.data.length !== 1) return { apta: false, nota: "La suscripción tiene más de un producto" };
  if (sub.currency !== cfg.moneda) return { apta: false, nota: `Moneda ${sub.currency}` };
  if (sub.collection_method !== "charge_automatically") return { apta: false, nota: "Cobro no automático" };
  if (s.discount || (Array.isArray(s.discounts) && s.discounts.length)) return { apta: false, nota: "Ya tiene otro descuento" };
  if (sub.schedule) return { apta: false, nota: "Tiene un calendario de cambios programado" };
  return { apta: true, nota: null };
}

/**
 * Pone el cupón del 25% en una suscripción que YA existe. Solo afecta
 * facturas FUTURAS (no devuelve ni modifica lo ya cobrado), no genera
 * prorrateo y no cambia el precio, la metadata ni la fecha de renovación.
 */
export async function aplicarDescuento(negocioId: string, subId: string, cfg: Config) {
  if (!cfg.stripe_coupon_id) throw new Error("Falta stripe_coupon_id en promo_config");
  const sub = await stripe.subscriptions.retrieve(subId);
  const r = revisarAptitud(sub, cfg);
  if (!r.apta) {
    await rpc("promo_marcar_descuento", { p_negocio: negocioId, p_estado: "no_aplica", p_sub: subId, p_nota: r.nota });
    return false;
  }
  await stripe.subscriptions.update(
    subId,
    { discounts: [{ coupon: cfg.stripe_coupon_id }], proration_behavior: "none" },
    { idempotencyKey: `promo-descuento-${negocioId}-${subId}` },
  );
  const check = await stripe.subscriptions.retrieve(subId);
  // deno-lint-ignore no-explicit-any
  const ok = (check as any).discount?.coupon?.id === cfg.stripe_coupon_id;
  await rpc("promo_marcar_descuento", {
    p_negocio: negocioId, p_estado: ok ? "aplicado" : "pendiente_aplicar", p_sub: subId,
    p_nota: ok ? "25% desde la siguiente renovación" : "Stripe no confirmó el cupón; se reintentará",
  });
  return ok;
}
