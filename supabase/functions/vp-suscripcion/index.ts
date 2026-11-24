// vp-suscripcion · Pago de Premium DENTRO de VendoPlus (sin salir a Stripe Checkout).
//
//  action "iniciar"   → crea (o reutiliza) la suscripción en estado "incompleta"
//                       y devuelve el client_secret para el formulario de tarjeta
//                       (Stripe Payment Element) que se muestra en la app.
//  action "confirmar" → después de pagar: revisa en Stripe que la suscripción
//                       ya esté activa y escribe profiles.paid_until al momento.
//                       (El webhook stripe-webhook / invoice.paid también lo hace.)
//
// Los datos de la tarjeta nunca pasan por aquí: van directo de la app a Stripe.
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-12-18.acacia" });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });

const VIVAS = ["active", "trialing", "past_due"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Inicia sesión para pagar." }, 401);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return json({ error: "Tu sesión expiró. Vuelve a entrar." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const priceId = Deno.env.get("STRIPE_PRICE_ID");
    const pk = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || null;
    if (!priceId) return json({ error: "Falta configurar el precio de Premium." }, 500);

    const { data: profile, error: pErr } = await sb.from("profiles")
      .select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (pErr) throw pErr;
    let customerId: string | null = profile?.stripe_customer_id ?? null;

    // ---------------------------------------------------------------
    if (action === "confirmar") {
      const subId = String(body?.subscriptionId || "");
      if (!/^sub_[A-Za-z0-9]+$/.test(subId) || !customerId) return json({ error: "Pago no válido." }, 400);
      const sub = await stripe.subscriptions.retrieve(subId);
      const subCustomer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      if (subCustomer !== customerId || sub.metadata?.supabase_user_id !== user.id) {
        return json({ error: "Este pago no es de tu cuenta." }, 403);
      }
      if (!VIVAS.includes(sub.status)) return json({ activo: false, estado: sub.status });
      const paidUntil = new Date(sub.current_period_end * 1000 + 2 * 864e5).toISOString();
      const { error } = await sb.from("profiles").update({ paid_until: paidUntil }).eq("user_id", user.id);
      if (error) throw error;
      return json({ activo: true, paid_until: paidUntil });
    }

    // ---------------------------------------------------------------
    if (action !== "iniciar") return json({ error: "Acción no válida." }, 400);
    if (!user.email) return json({ error: "Tu cuenta no tiene correo electrónico." }, 400);

    // Cliente de Stripe (el mismo que usaba create-checkout)
    if (customerId) {
      try {
        const c = await stripe.customers.retrieve(customerId);
        if ("deleted" in c && c.deleted) customerId = null;
      } catch { customerId = null; }
    }
    if (!customerId) {
      const c = await stripe.customers.create({ email: user.email, metadata: { supabase_user_id: user.id } });
      customerId = c.id;
      const { error } = await sb.from("profiles").update({ stripe_customer_id: customerId }).eq("user_id", user.id);
      if (error) throw error;
    }

    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    if (subs.data.some((s) => VIVAS.includes(s.status))) return json({ yaActivo: true });

    // Si quedó un intento anterior sin pagar, se reutiliza (no se crean suscripciones de más)
    let sub = subs.data.find((s) => s.status === "incomplete" &&
      s.items.data.some((i) => i.price.id === priceId));
    if (sub) {
      sub = await stripe.subscriptions.retrieve(sub.id, { expand: ["latest_invoice.payment_intent"] });
    } else {
      sub = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription", payment_method_types: ["card"] },
        metadata: { supabase_user_id: user.id, stripe_customer_id: customerId, origen: "vendoplus_app" },
        expand: ["latest_invoice.payment_intent"],
      });
    }

    const invoice = sub.latest_invoice as Stripe.Invoice | null;
    const pi = invoice?.payment_intent as Stripe.PaymentIntent | null;
    if (!pi?.client_secret) throw new Error("La suscripción no trae un pago pendiente");

    return json({
      clientSecret: pi.client_secret,
      subscriptionId: sub.id,
      publishableKey: pk,
      monto: invoice?.amount_due ?? null,
      moneda: invoice?.currency ?? "mxn",
    });
  } catch (e) {
    console.error("vp-suscripcion", e);
    return json({ error: "No pudimos preparar tu pago. Inténtalo de nuevo." }, 500);
  }
});
