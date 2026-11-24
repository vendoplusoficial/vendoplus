// stripe-negocio · El NEGOCIO conecta su propia cuenta de Stripe al Menú Digital.
//
//  action "status" → ¿está conectada? ¿Stripe ya le permite cobrar con tarjeta?
//  action "start"  → crea (o reutiliza) su cuenta conectada y devuelve el link de
//                    Stripe para crearla o enlazarla (ahí entra con su correo).
//  action "unlink" → la desconecta del menú (los pagos ya hechos no se tocan).
//  action "arm"    → al aceptar un pedido, fija EN EL SERVIDOR cuánto se cobra.
//
// El dinero de cada pedido va DIRECTO a la cuenta de Stripe del negocio
// (cargo directo). VendoPlus no cobra comisión ni toca el dinero.
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const KEY = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
const LIVE = KEY.startsWith("sk_live_") || KEY.startsWith("rk_live_");
const stripe = new Stripe(KEY, { apiVersion: "2024-12-18.acacia" });
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITIO = "https://vendoplusoficial.com/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });

function nombreDe(a: Stripe.Account): string {
  return String(a.business_profile?.name || a.settings?.dashboard?.display_name || a.email || "").slice(0, 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Inicia sesión en tu cuenta." }, 401);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return json({ error: "Tu sesión venció. Vuelve a entrar." }, 401);
    if (!KEY) return json({ error: "Falta configurar Stripe en el servidor." }, 503);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const cuentas = sb.from("stripe_menu_accounts");
    const { data: fila, error: lErr } = await cuentas
      .select("stripe_account_id, connected, ready, display_name")
      .eq("user_id", user.id).eq("livemode", LIVE).maybeSingle();
    if (lErr) throw lErr;

    // ---------------------------------------------------------------
    if (action === "arm") {
      const orderId = String(body?.order_id ?? "");
      const total = Math.round(Number(body?.total) * 100) / 100;
      if (!/^[A-Za-z0-9_-]{4,40}$/.test(orderId)) return json({ error: "Pedido inválido" }, 400);
      if (!(total > 0) || total > 1000000) return json({ error: "Total inválido" }, 400);
      // Con la sesión del negocio: así la función de Postgres revisa que el pedido sea suyo.
      const comoNegocio = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: "Bearer " + token } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const code = typeof body?.code === "string" ? body.code.slice(0, 20) : null;
      const { error } = await comoNegocio.rpc("mp_arm_order", { p_order_id: orderId, p_total: total, p_code: code });
      if (error) return json({ error: error.message || "No se pudo preparar el cobro" }, 400);
      return json({ ok: true, amount: total });
    }

    // ---------------------------------------------------------------
    if (action === "unlink") {
      if (fila) {
        const { error } = await cuentas.update({ connected: false, ready: false, updated_at: new Date().toISOString() })
          .eq("user_id", user.id).eq("livemode", LIVE);
        if (error) throw error;
      }
      return json({ connected: false, ready: false });
    }

    // ---------------------------------------------------------------
    if (action === "status") {
      if (!fila || !fila.connected) return json({ connected: false, ready: false, livemode: LIVE });
      let acct: Stripe.Account | null = null;
      try { acct = await stripe.accounts.retrieve(fila.stripe_account_id); } catch (e) { console.error("status", e); }
      if (!acct) {
        return json({ connected: true, ready: !!fila.ready, name: fila.display_name || "", account: fila.stripe_account_id, livemode: LIVE, unavailable: true });
      }
      const ready = !!acct.charges_enabled;
      const name = nombreDe(acct);
      await cuentas.update({ ready, display_name: name, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("livemode", LIVE);
      return json({
        connected: true, ready, name, account: acct.id, livemode: LIVE,
        details_submitted: !!acct.details_submitted,
      });
    }

    // ---------------------------------------------------------------
    if (action !== "start") return json({ error: "Acción no válida" }, 400);

    let accountId: string | null = fila?.stripe_account_id ?? null;
    let lista: Stripe.Account | null = null;
    if (accountId) {
      try {
        const a = await stripe.accounts.retrieve(accountId);
        if ((a as unknown as { deleted?: boolean }).deleted) accountId = null;
        else if (a.charges_enabled && a.details_submitted) lista = a;
      } catch { accountId = null; }
    }
    // Ya la había configurado antes y la desenlazó: se vuelve a enlazar sin pasar por Stripe.
    if (accountId && lista) {
      const name = nombreDe(lista);
      const { error } = await cuentas.update({ connected: true, ready: true, display_name: name, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("livemode", LIVE);
      if (error) throw error;
      return json({ connected: true, ready: true, name, account: accountId, livemode: LIVE });
    }
    if (!accountId) {
      const a = await stripe.accounts.create({
        country: "MX",
        email: user.email ?? undefined,
        controller: {
          stripe_dashboard: { type: "full" },        // el negocio entra a SU panel de Stripe
          fees: { payer: "account" },               // las comisiones de Stripe las paga su cuenta
          losses: { payments: "stripe" },
          requirement_collection: "stripe",
        },
        metadata: { supabase_user_id: user.id, origen: "vendoplus_menu" },
      }, { idempotencyKey: "vp-menu-acct-" + user.id + (fila ? "-" + Date.now() : "") });
      accountId = a.id;
    }
    const { error: upErr } = await cuentas.upsert({
      user_id: user.id, livemode: LIVE, stripe_account_id: accountId, connected: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,livemode" });
    if (upErr) throw upErr;

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: SITIO + "?stripe=reintentar",
      return_url: SITIO + "?stripe=listo",
    });
    return json({ url: link.url });
  } catch (e) {
    const err = e as { message?: string; code?: string; type?: string };
    console.error("stripe-negocio", err?.type, err?.code, err?.message);
    const msg = String(err?.message || "");
    if (/connect/i.test(msg) && /(sign up|signed up|platform|not enabled|activate)/i.test(msg)) {
      return json({ error: "Stripe Connect aún no está activado en la cuenta de VendoPlus.", code: "connect_off" }, 503);
    }
    return json({ error: "No se pudo conectar con Stripe. Inténtalo de nuevo.", code: err?.code || "error" }, 502);
  }
});
