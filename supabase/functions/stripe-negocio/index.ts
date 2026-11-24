// stripe-negocio · El NEGOCIO conecta su propia cuenta de Stripe al Menú Digital.
//
//  action "status" → ¿está conectada? ¿Stripe ya le permite cobrar con tarjeta?
//  action "start"  → crea (o reutiliza) su cuenta conectada y devuelve el link de
//                    Stripe para crearla o enlazarla (ahí entra con su correo).
//  action "unlink" → la desconecta del menú (los pagos ya hechos no se tocan).
//  action "arm"    → al aceptar un pedido, fija EN EL SERVIDOR cuánto se cobra.
//  action "finanzas"   → saldo, pagos recibidos, retiros y movimientos.
//  action "reembolsar" → devuelve un pago (todo o una parte) al cliente.
//  action "retirar"    → manda el saldo disponible a su banco (si Stripe deja).
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
    // FINANZAS: todo se hace sobre la cuenta de Stripe DEL NEGOCIO que
    // inició sesión (la de su fila). Nunca sobre otra cuenta.
    if (action === "finanzas" || action === "reembolsar" || action === "retirar") {
      if (!fila?.connected || !fila.stripe_account_id) return json({ error: "Primero enlaza tu Stripe." }, 409);
      const acct = fila.stripe_account_id;
      const op = { stripeAccount: acct };

      if (action === "reembolsar") {
        const chargeId = String(body?.charge_id ?? "");
        if (!/^(ch|py)_[A-Za-z0-9]+$/.test(chargeId)) return json({ error: "Pago no válido." }, 400);
        const ch = await stripe.charges.retrieve(chargeId, {}, op);   // solo existe si es de SU cuenta
        const resta = ch.amount - ch.amount_refunded;
        if (ch.status !== "succeeded" || ch.refunded || resta <= 0) return json({ error: "Este pago ya no se puede devolver." }, 409);
        let monto = resta;
        if (body?.amount != null && body.amount !== "") {
          monto = Math.round(Number(body.amount) * 100);
          if (!(monto > 0) || monto > resta) return json({ error: "El monto a devolver no es válido." }, 400);
        }
        try {
          const r = await stripe.refunds.create({
            charge: chargeId, amount: monto, reason: "requested_by_customer",
            metadata: { origen: "vendoplus_app", supabase_user_id: user.id },
          }, { ...op, idempotencyKey: "vp-ref-" + chargeId + "-" + monto + "-" + ch.amount_refunded });
          return json({ ok: true, status: r.status, amount: monto / 100 });
        } catch (e) {
          const m = String((e as Error)?.message || "");
          if (/insufficient|balance/i.test(m)) return json({ error: "No tienes saldo suficiente en Stripe para esta devolución." }, 409);
          throw e;
        }
      }

      if (action === "retirar") {
        const bal = await stripe.balance.retrieve({}, op);
        const disp = (bal.available || []).filter((b) => b.currency === "mxn").reduce((a, b) => a + b.amount, 0);
        let monto = disp;
        if (body?.amount != null && body.amount !== "") monto = Math.round(Number(body.amount) * 100);
        if (!(monto >= 100) || monto > disp) return json({ error: disp < 100 ? "Todavía no tienes saldo disponible para retirar." : "El monto a retirar no es válido." }, 400);
        try {
          const po = await stripe.payouts.create({ amount: monto, currency: "mxn", metadata: { origen: "vendoplus_app" } },
            { ...op, idempotencyKey: "vp-po-" + acct + "-" + monto + "-" + Math.floor(Date.now() / 60000) });
          return json({ ok: true, status: po.status, amount: monto / 100, arrival_date: po.arrival_date });
        } catch (e) {
          const m = String((e as Error)?.message || "");
          console.error("retirar", m);
          if (/automatic|schedule/i.test(m)) {
            return json({ error: "Stripe deposita tu dinero a tu banco automáticamente. Para retirar cuando tú quieras, cambia tus depósitos a «manuales» en tu panel de Stripe.", code: "auto_payouts" }, 409);
          }
          if (/external account|bank account/i.test(m)) return json({ error: "Agrega tu cuenta de banco en tu panel de Stripe para poder retirar." }, 409);
          if (/insufficient/i.test(m)) return json({ error: "No tienes saldo suficiente para retirar." }, 409);
          return json({ error: "Stripe no permitió el retiro: " + m.slice(0, 140) }, 409);
        }
      }

      // finanzas
      const [bal, acc, charges, txs, pos] = await Promise.all([
        stripe.balance.retrieve({}, op),
        stripe.accounts.retrieve(acct),
        stripe.charges.list({ limit: 25 }, op),
        stripe.balanceTransactions.list({ limit: 30 }, op),
        stripe.payouts.list({ limit: 10 }, op),
      ]);
      const suma = (l: { amount: number; currency: string }[] | undefined) =>
        (l || []).filter((b) => b.currency === "mxn").reduce((a, b) => a + b.amount, 0) / 100;
      const sch = acc.settings?.payouts?.schedule;
      const banco = (acc.external_accounts?.data || [])[0] as unknown as { bank_name?: string; last4?: string } | undefined;
      return json({
        ok: true,
        livemode: LIVE,
        available: suma(bal.available),
        pending: suma(bal.pending),
        payouts_enabled: !!acc.payouts_enabled,
        schedule: sch ? { interval: sch.interval, delay_days: sch.delay_days, weekly_anchor: sch.weekly_anchor ?? null, monthly_anchor: sch.monthly_anchor ?? null } : null,
        bank: banco ? { name: banco.bank_name || "", last4: banco.last4 || "" } : null,
        charges: charges.data.map((c) => ({
          id: c.id, amount: c.amount / 100, refunded_amount: c.amount_refunded / 100, refunded: c.refunded,
          status: c.status, disputed: c.disputed, created: c.created,
          code: c.metadata?.code || "", description: c.description || "",
          card: c.payment_method_details?.card ? { brand: c.payment_method_details.card.brand, last4: c.payment_method_details.card.last4 } : null,
        })),
        movements: txs.data.map((t) => ({
          id: t.id, type: t.type, category: t.reporting_category, amount: t.amount / 100, fee: t.fee / 100, net: t.net / 100,
          created: t.created, available_on: t.available_on, status: t.status, description: t.description || "",
        })),
        payouts: pos.data.map((p) => ({ id: p.id, amount: p.amount / 100, status: p.status, arrival_date: p.arrival_date, created: p.created, automatic: p.automatic })),
      });
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
