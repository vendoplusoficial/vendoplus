// Crea una sesión de Stripe Checkout (suscripción mensual) para el usuario que la pide.
import Stripe from "https://esm.sh/stripe@16?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ error: "No autorizado" }, 401);

    // Un cliente de Stripe por cuenta (se guarda para que el webhook lo reconozca)
    const { data: p } = await sb.from("profiles").select("stripe_customer_id").eq("user_id", user.id).single();
    let customer = p?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripe.customers.create({
        phone: user.phone ? "+" + user.phone.replace("+", "") : undefined,
        metadata: { user_id: user.id },
      });
      customer = c.id;
      await sb.from("profiles").update({ stripe_customer_id: customer }).eq("user_id", user.id);
    }

    const appUrl = Deno.env.get("APP_URL")!; // la dirección donde vive tu index.html
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price: Deno.env.get("STRIPE_PRICE_ID")!, quantity: 1 }],
      success_url: `${appUrl}?pago=ok`,
      cancel_url: `${appUrl}?pago=cancelado`,
      locale: "es",
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
