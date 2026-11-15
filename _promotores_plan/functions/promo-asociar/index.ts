// =====================================================================
// promo-asociar · El negocio (con su sesión) se asocia al promotor del enlace.
// verify_jwt = true. El código del enlace es solo una PISTA: todas las
// reglas se deciden en el servidor (promo_asociar en SQL) con el historial
// real de pagos leído de Stripe aquí mismo.
// =====================================================================
import { admin, aplicarDescuento, config, CORS, historialStripe, json, rpc, sincronizarCliente } from "./promo_stripe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, mensaje: "Usa POST" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ ok: false, mensaje: "Inicia sesión para continuar." }, 401);

    const body = await req.json().catch(() => ({}));
    const codigo = String(body.codigo ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(codigo)) return json({ ok: false, mensaje: "Este enlace de promotor no es válido." }, 400);

    const cfg = await config();
    // Solo se consulta Stripe si el código es de un promotor activo
    const info = await rpc<{ valido: boolean }>("promo_codigo_info", { p_codigo: codigo });
    const hist = info?.valido
      ? await historialStripe(user.id, cfg).catch((e) => {
          console.error("[promo-asociar] historial", e);
          return { verificado: false, primerPago: null, customerId: null, subActiva: null, aptaDescuento: false, nota: null };
        })
      : { verificado: false, primerPago: null, customerId: null, subActiva: null, aptaDescuento: false, nota: null };

    const r = await rpc<{ ok: boolean; motivo: string; mensaje: string; negocio_id?: string; descuento_estado?: string }>(
      "promo_asociar", {
        p_negocio_user: user.id, p_codigo: codigo,
        p_stripe_verificado: hist.verificado, p_stripe_primer_pago: hist.primerPago,
        p_stripe_customer: hist.customerId, p_stripe_sub_activa: hist.subActiva,
        p_sub_apta_descuento: hist.aptaDescuento, p_nota_descuento: hist.nota,
      });

    if (r.ok && r.motivo === "asociado" && r.negocio_id) {
      // Ya pagaba con Stripe (< 7 días): 25% desde su siguiente renovación
      if (r.descuento_estado === "pendiente_aplicar" && hist.subActiva) {
        await aplicarDescuento(r.negocio_id, hist.subActiva, cfg)
          .catch((e) => console.error("[promo-asociar] descuento (lo reintenta la conciliación)", e));
      }
      // Trae sus pagos previos (para la comisión si pagó hace < 7 días)
      if (hist.customerId) {
        await sincronizarCliente(r.negocio_id, hist.customerId, cfg.stripe_productos)
          .catch((e) => console.error("[promo-asociar] sync (lo reintenta la conciliación)", e));
      }
    }
    return json({ ok: r.ok, motivo: r.motivo, mensaje: r.mensaje });
  } catch (e) {
    console.error("[promo-asociar]", e);
    return json({ ok: false, mensaje: "Algo salió mal. Inténtalo de nuevo en un momento." }, 500);
  }
});
