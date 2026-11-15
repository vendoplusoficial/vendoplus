// =====================================================================
// promo-conciliar · Conciliación diaria con Stripe (la llama pg_cron).
// verify_jwt = false; se protege con la cabecera x-promo-cron, que debe
// coincidir con el secreto PROMO_CRON_SECRET.
// · Solo LEE Stripe (y, si quedó pendiente, aplica el cupón decidido en la
//   regla 8 a una suscripción apta). Nunca crea cobros ni suscripciones.
// · Es segura de repetir: todo se guarda con upsert y el motor es idempotente.
// · Procesa por lotes (los menos recientes primero) y se detiene antes del
//   límite de tiempo; lo que falte se hace al día siguiente.
// =====================================================================
import { admin, aplicarDescuento, config, rpc, sincronizarCliente } from "./promo_stripe.ts";

function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  const secreto = Deno.env.get("PROMO_CRON_SECRET") ?? "";
  if (req.method !== "POST" || secreto.length < 32 || !igual(req.headers.get("x-promo-cron") ?? "", secreto)) {
    return new Response("No autorizado", { status: 401 });
  }
  const inicio = Date.now();
  const { data: corrida } = await admin.from("promo_corridas").insert({ tipo: "conciliacion_stripe" }).select("id").single();
  const cfg = await config();
  const lote = await rpc<{ negocio_id: string; stripe_customer_id: string; descuento_estado: string; descuento_sub_id: string | null }[]>(
    "promo_negocios_para_conciliar", { p_limite: 150 });

  let hechos = 0, errores = 0;
  const detalle: unknown[] = [];
  for (const n of lote ?? []) {
    if (Date.now() - inicio > 110_000) break;            // el resto, mañana
    try {
      if (n.descuento_estado === "pendiente_aplicar" && n.descuento_sub_id) {
        await aplicarDescuento(n.negocio_id, n.descuento_sub_id, cfg);
      }
      await sincronizarCliente(n.negocio_id, n.stripe_customer_id, cfg.stripe_productos);
      await rpc("promo_marcar_conciliado", { p_negocio: n.negocio_id });
      hechos++;
    } catch (e) {
      errores++;
      detalle.push({ negocio: n.negocio_id, error: String((e as Error).message).slice(0, 200) });
    }
  }
  await admin.from("promo_corridas")
    .update({ fin: new Date().toISOString(), resultado: { lote: lote?.length ?? 0, hechos, errores, detalle } })
    .eq("id", corrida?.id);
  return new Response(JSON.stringify({ ok: true, hechos, errores }), { headers: { "Content-Type": "application/json" } });
});
