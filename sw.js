/* =========================================================
   VendoPlus · copia de la app en el aparato (solo para cuando NO hay internet)

   Con internet la app se comporta exactamente como una página normal:
   todo se pide al servidor (sin esperas extra y sin versiones viejas).
   La copia guardada SOLO se usa si el servidor no contesta (sin internet).

   - Cada vez que la página se baja bien, se guarda junto con todos los
     archivos que pide (?v=…): la copia nunca queda a medias.
   - Las fotos y la librería fija de Supabase no cambian nunca: esas sí se
     sirven de la copia (son las que pesan y así salen al instante).
   - Supabase, Stripe y todo lo que no es de vendoplusoficial.com pasa
     directo: nunca se guarda ni se toca.
========================================================= */
const CACHE = 'vp-app-v2';            /* no cambiar: cambiarlo borra la copia */
const BASE = ['./', './vendor/supabase-2.119.0.js',
  './img/auth-carta.webp?v=1',
  './img/auth-clave.webp?v=1',
  './img/auth-codigo.webp?v=1',
  './img/auth-foto-h.webp?v=1',
  './img/auth-foto-v.webp?v=1',
  './img/auth-login.webp?v=1',
  './img/auth-nip.webp?v=1',
  './img/auth-tienda.webp?v=1',
  './img/auth-usuarios.webp?v=1',
  './img/bolsa-pedido.webp?v=1',
  './img/fundador.jpg?v=1',
  './img/mercadopago.webp?v=1',
  './img/promo-asistente-h.webp?v=2',
  './img/promo-asistente-v.webp?v=2',
  './img/promo-menu-h.webp?v=2',
  './img/promo-menu-v.webp?v=2',
  './img/promo-stripe-h.webp?v=1',
  './img/promo-stripe-v.webp?v=1',
  './img/stripe-conectar.webp?v=2',
  './img/stripe-menu.webp?v=1',
  './img/vacio-caja.webp?v=2',
  './img/vacio-mesero.webp?v=2',
  './img/vacio-cocina.webp?v=2',
  './img/stripe-saldo.webp?v=1',
  './img/stripe-nfc.webp?v=1',
  './img/comandas-caja-cel.webp?v=2',
  './img/comandas-caja-pc.webp?v=2',
  './img/comandas-cocina-cel.webp?v=2',
  './img/comandas-cocina-pc.webp?v=2',
  './img/comandas-mesero-cel.webp?v=2',
  './img/comandas-mesero-pc.webp?v=2',
  './img/promo-comandas-h.webp?v=1',
  './img/promo-comandas-v.webp?v=1',
  './img/premium-corona.webp?v=1',
  './img/premium-corona-icono.webp?v=1',
  './img/premium-menu.webp?v=1',
  './img/premium-chat.webp?v=1',
  './img/premium-escaner.webp?v=1',
  './img/premium-stats.webp?v=1',
  './img/premium-usuarios.webp?v=1'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(BASE.map(u => c.add(u).catch(() => {})));
    /* La página guardada trae consigo sus archivos desde el primer momento */
    const pag = await c.match('./');
    if (pag) await guardarLoQuePide(c, pag);
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k.indexOf('vp-app-') === 0 && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url;
  try { url = new URL(req.url); } catch (x) { return; }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(pagina(e, req)); return; }
  /* Fotos y librería fija: nunca cambian, la copia primero */
  if (url.pathname.indexOf('/vendor/') >= 0 || /\.(png|svg|ico|webp|jpe?g|gif|woff2?)$/i.test(url.pathname)) {
    e.respondWith(primeroCopia(req));
    return;
  }
  /* Código de la app: del servidor; la copia solo si no hay internet */
  if (/\.(js|css|json|webmanifest)$/i.test(url.pathname)) e.respondWith(redOCopia(req));
});

const sirve = r => r && r.ok && r.type === 'basic' && !r.redirected;

/* Guarda los archivos con versión que pide la página (para cuando no haya internet) */
async function guardarLoQuePide(cache, resp) {
  try {
    const html = await resp.text();
    const urls = new Set();
    const re = /["'(]((?!https?:|\/\/|data:)[^"'()\s<>]+\?v=[^"'()\s<>]+)["')]/g;
    let m;
    while ((m = re.exec(html))) urls.add(new URL(m[1], self.registration.scope).href);
    await Promise.all([...urls].map(async u => {
      if (await cache.match(u)) return;
      try { const r = await fetch(u); if (sirve(r)) await cache.put(u, r); } catch (x) {}
    }));
  } catch (x) {}
}

async function pagina(e, req) {
  const cache = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (sirve(r)) {
      cache.put(req, r.clone()).catch(() => {});
      e.waitUntil(guardarLoQuePide(cache, r.clone()));
    }
    return r;
  } catch (err) {
    return (await cache.match(req)) || (await cache.match(req, { ignoreSearch:true })) || (await cache.match('./')) || Promise.reject(err);
  }
}

async function redOCopia(req) {
  const cache = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (sirve(r)) cache.put(req, r.clone()).catch(() => {});
    return r;
  } catch (err) {
    return (await cache.match(req)) || (await cache.match(req, { ignoreSearch:true })) || Promise.reject(err);
  }
}

async function primeroCopia(req) {
  const cache = await caches.open(CACHE);
  const copia = await cache.match(req);
  if (copia) return copia;
  const r = await fetch(req);
  if (sirve(r)) cache.put(req, r.clone()).catch(() => {});
  return r;
}
