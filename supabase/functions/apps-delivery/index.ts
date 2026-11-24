// apps-delivery · Ventas completadas de Rappi, DiDi Food y Uber Eats.
//
// Los pedidos se atienden en la app de cada plataforma. Cuando una venta se
// COMPLETA, la plataforma avisa a este webhook y aquí se guarda en
// vp_apps_pedidos. El celular del negocio la "reclama" (vp_apps_reclamar),
// la registra en el Historial y descuenta del inventario los productos que
// el negocio vinculó.
//
//  Webhook (sin sesión):  POST  .../apps-delivery?w=<token del negocio>
//      · Uber Eats: valida X-Uber-Signature con el client secret (si lo guardó)
//        y, si el aviso no trae el pedido, lo pide a la API de Uber.
//      · Rappi:     valida Rappi-Signature (t=…,sign=…) con el secreto del webhook.
//      · DiDi Food y cualquier integrador: el token largo de la URL identifica al negocio.
//      · También acepta un formato simple (para integradores o pruebas):
//        { "pedido_id": "123", "estado": "completado", "total": 250,
//          "productos": [{ "id": "A1", "nombre": "Taco", "cantidad": 2, "precio": 25 }] }
//
//  Acciones (con la sesión del negocio):  POST { action: ... }
//      · "estado"      → conexiones, URL del webhook y pedidos recibidos.
//      · "conectar"    → guarda el ID de la tienda (y credenciales opcionales).
//      · "desconectar" → quita la conexión (las ventas ya registradas no se tocan).
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const PLATAFORMAS = ["rappi", "didi", "uber"] as const;
type Plat = typeof PLATAFORMAS[number];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
const urlWebhook = (token: string) => `${SB_URL}/functions/v1/apps-delivery?w=${token}`;

function tokenNuevo(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmacHex(secret: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(s)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- Lectura flexible de pedidos (cada plataforma los manda distinto) ----------
// deno-lint-ignore no-explicit-any
type O = any;
const ruta = (o: O, p: string) => p.split(".").reduce((a: O, k) => (a == null ? undefined : a[k]), o);
const primero = (o: O, rutas: string[]) => {
  for (const p of rutas) {
    const v = ruta(o, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
function dinero(v: O): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  if (typeof v === "object") {
    if (v.amount_e5 != null) return Number(v.amount_e5) / 1e5;
    if (v.amount != null) return dinero(v.amount);
    if (v.value != null) return dinero(v.value);
    if (v.unit_price != null) return dinero(v.unit_price);
  }
  return undefined;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function leerPedido(raw: O) {
  const o = raw?.order_detail ?? raw?.order ?? raw?.data?.order ?? raw?.data ?? raw;
  const id = primero(o, ["pedido_id", "order_id", "orderId", "id", "order_number"]) ?? primero(raw, ["order_id", "meta.resource_id", "id"]);
  const codigo = primero(o, ["display_id", "short_code", "codigo", "order_number", "order_code"]);
  const estado = String(primero(o, ["estado", "status", "state", "current_state", "order_status"]) ??
    primero(raw, ["estado", "status", "state", "event", "event_type", "meta.status"]) ?? "");
  const lista: O[] = primero(o, ["productos", "items", "cart.items", "products", "order_items", "detail.items"]) ?? [];
  const items = (Array.isArray(lista) ? lista : []).map((it: O) => {
    const cantidad = Number(primero(it, ["cantidad", "quantity", "qty", "units", "count"]) ?? 1) || 1;
    let precio = dinero(primero(it, ["precio", "unit_price", "price.unit_price", "price", "unitPrice"]));
    const totalLinea = dinero(primero(it, ["total_price", "price.total_price", "total"]));
    if (precio == null && totalLinea != null) precio = totalLinea / cantidad;
    return {
      id: String(primero(it, ["id_externo", "external_data", "sku", "external_id", "product_id", "id", "item_id"]) ?? primero(it, ["nombre", "title", "name"]) ?? "").slice(0, 120),
      nombre: String(primero(it, ["nombre", "title", "name", "product_name", "description"]) ?? "Producto").slice(0, 120),
      cantidad,
      precio: r2(precio ?? 0),
    };
  }).filter((x) => x.id);
  let total = dinero(primero(o, ["total", "totals.total_order", "totals.total", "order_total", "total_price", "payment.charges.total", "payment.total", "amount"]));
  if (total == null) total = items.reduce((a, x) => a + x.precio * x.cantidad, 0);
  const cliente = primero(o, ["cliente", "customer.first_name", "customer.name", "eater.first_name", "client.name"]);
  return { id: id != null ? String(id).slice(0, 120) : "", codigo: codigo != null ? String(codigo).slice(0, 40) : null, estado, items, total: r2(Number(total) || 0), cliente: cliente ? String(cliente).slice(0, 60) : null };
}
const esCompletado = (s: string) => /(complet|deliver|finish|entreg|closed|done|picked|release|fulfil|termin)/i.test(s) && !/(cancel|reject|fail|rechaz)/i.test(s);

// Uber Eats: el aviso solo trae el enlace; con las credenciales se pide el pedido completo.
async function pedidoUber(href: string, clientId?: string | null, secret?: string | null): Promise<O | null> {
  if (!href || !clientId || !secret || !/^https:\/\/api\.uber\.com\//.test(href)) return null;
  const t = await fetch("https://auth.uber.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials", scope: "eats.order" }),
  }).then((r) => r.json()).catch(() => null);
  if (!t?.access_token) return null;
  return await fetch(href, { headers: { Authorization: "Bearer " + t.access_token } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

async function webhook(req: Request, token: string): Promise<Response> {
  const cuerpo = await req.text();
  const { data: con } = await sb.from("vp_apps_conexiones").select("user_id, plataforma").eq("webhook_token", token).maybeSingle();
  // Siempre 200 a lo desconocido: así nadie puede adivinar qué tokens existen.
  if (!con) return json({ ok: true });
  const plat = con.plataforma as Plat;
  const { data: sec } = await sb.from("vp_apps_secretos").select("client_id, client_secret, webhook_secret").eq("user_id", con.user_id).eq("plataforma", plat).maybeSingle();

  // Firmas (solo si el negocio guardó el secreto correspondiente).
  if (plat === "uber" && sec?.client_secret) {
    const firma = (req.headers.get("x-uber-signature") ?? "").toLowerCase();
    if (!igual(firma, await hmacHex(sec.client_secret, cuerpo))) return json({ error: "Firma inválida" }, 401);
  }
  if (plat === "rappi" && sec?.webhook_secret) {
    const h = req.headers.get("rappi-signature") ?? "";
    const t = /t=([^,]+)/.exec(h)?.[1] ?? "", s = (/sign=([^,]+)/.exec(h)?.[1] ?? "").toLowerCase();
    if (!t || !igual(s, await hmacHex(sec.webhook_secret, `${t}.${cuerpo}`))) return json({ error: "Firma inválida" }, 401);
  }

  let raw: O = {};
  try { raw = cuerpo ? JSON.parse(cuerpo) : {}; } catch { return json({ ok: true }); }
  await sb.from("vp_apps_conexiones").update({ estado: "activa", ultimo_evento_at: new Date().toISOString() }).eq("user_id", con.user_id).eq("plataforma", plat);

  let p = leerPedido(raw);
  if (plat === "uber" && !p.items.length && raw?.resource_href) {
    const completo = await pedidoUber(raw.resource_href, sec?.client_id, sec?.client_secret);
    if (completo) {
      const q = leerPedido(completo);
      p = { ...q, estado: q.estado || p.estado, id: q.id || p.id };
    }
  }
  if (!p.id || !esCompletado(p.estado)) return json({ ok: true, guardado: false });

  const { error } = await sb.from("vp_apps_pedidos").upsert({
    user_id: con.user_id, plataforma: plat, pedido_id: p.id, codigo: p.codigo, estado: "completado",
    total: p.total, cliente: p.cliente, items: p.items, completado_at: new Date().toISOString(), raw,
  }, { onConflict: "user_id,plataforma,pedido_id", ignoreDuplicates: true });
  if (error) { console.error("apps-delivery", error); return json({ error: "No se pudo guardar" }, 500); }

  // Los productos de la plataforma quedan listos para vincularse.
  const vistos = new Map<string, O>();
  p.items.forEach((x) => vistos.set(x.id, { user_id: con.user_id, plataforma: plat, producto_id: x.id, nombre: x.nombre, precio: x.precio, visto_at: new Date().toISOString() }));
  if (vistos.size) await sb.from("vp_apps_productos").upsert([...vistos.values()], { onConflict: "user_id,plataforma,producto_id" });
  return json({ ok: true, guardado: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const w = url.searchParams.get("w");
  if (w) {
    if (req.method === "GET") return json({ ok: true });   // algunas plataformas prueban la URL así
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    try { return await webhook(req, w.slice(0, 80)); }
    catch (e) { console.error("apps-delivery webhook", e); return json({ error: "Error interno" }, 500); }
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Inicia sesión en tu cuenta." }, 401);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return json({ error: "Tu sesión venció. Vuelve a entrar." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const plat = body?.plataforma as Plat;

    if (action === "estado") {
      const { data: cons } = await sb.from("vp_apps_conexiones").select("plataforma, store_id, estado, ultimo_evento_at, webhook_token").eq("user_id", user.id);
      const { data: secs } = await sb.from("vp_apps_secretos").select("plataforma, client_id, client_secret, webhook_secret").eq("user_id", user.id);
      const out: Record<string, unknown> = {};
      for (const pl of PLATAFORMAS) {
        const c = (cons ?? []).find((x) => x.plataforma === pl);
        const s = (secs ?? []).find((x) => x.plataforma === pl);
        const { count } = await sb.from("vp_apps_pedidos").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("plataforma", pl);
        out[pl] = c ? {
          conectada: true, store_id: c.store_id, estado: c.estado, ultimo_evento_at: c.ultimo_evento_at,
          webhook_url: urlWebhook(c.webhook_token), pedidos: count ?? 0,
          credenciales: !!(s?.client_id && s?.client_secret), secreto_webhook: !!s?.webhook_secret,
        } : { conectada: false, pedidos: count ?? 0 };
      }
      return json({ ok: true, apps: out });
    }

    if (!PLATAFORMAS.includes(plat)) return json({ error: "Plataforma inválida" }, 400);

    if (action === "conectar") {
      // Enlazar las apps es de Premium.
      const { data: pf } = await sb.from("profiles").select("paid_until, web_paid_until, play_paid_until, vp_web_pagado_hasta, vp_play_pagado_hasta").eq("user_id", user.id).maybeSingle();
      const ahora = Date.now();
      const pro = !!pf && Object.values(pf).some((v) => v && new Date(v as string).getTime() > ahora);
      if (!pro) return json({ error: "Enlazar apps de delivery es parte de Premium." }, 402);
      const store = String(body?.store_id ?? "").trim().slice(0, 80);
      if (!store) return json({ error: "Escribe el ID de tu tienda" }, 400);
      const { data: ya } = await sb.from("vp_apps_conexiones").select("webhook_token").eq("user_id", user.id).eq("plataforma", plat).maybeSingle();
      const tk = ya?.webhook_token ?? tokenNuevo();
      const { error } = await sb.from("vp_apps_conexiones").upsert({ user_id: user.id, plataforma: plat, store_id: store, webhook_token: tk, updated_at: new Date().toISOString() }, { onConflict: "user_id,plataforma" });
      if (error) throw error;
      const limpio = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
      const cid = limpio(body?.client_id), cs = limpio(body?.client_secret), ws = limpio(body?.webhook_secret);
      if (cid || cs || ws) {
        const fila: Record<string, unknown> = { user_id: user.id, plataforma: plat, updated_at: new Date().toISOString() };
        if (cid) fila.client_id = cid;
        if (cs) fila.client_secret = cs;
        if (ws) fila.webhook_secret = ws;
        const { error: e2 } = await sb.from("vp_apps_secretos").upsert(fila, { onConflict: "user_id,plataforma" });
        if (e2) throw e2;
      }
      return json({ ok: true, webhook_url: urlWebhook(tk) });
    }

    if (action === "desconectar") {
      await sb.from("vp_apps_secretos").delete().eq("user_id", user.id).eq("plataforma", plat);
      await sb.from("vp_apps_conexiones").delete().eq("user_id", user.id).eq("plataforma", plat);
      return json({ ok: true });
    }

    return json({ error: "Acción no válida" }, 400);
  } catch (e) {
    console.error("apps-delivery", e);
    return json({ error: "Algo falló. Inténtalo otra vez." }, 500);
  }
});
