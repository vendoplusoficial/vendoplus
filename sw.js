/* =========================================================
   VendoPlus · copia de la app en el aparato
   - Con buena señal: se baja la versión nueva de siempre (lo publicado
     se ve al instante).
   - Con señal mala: si el servidor tarda más de 2.5 s, se abre la copia
     guardada y la nueva se guarda para la siguiente vez.
   - Sin internet: se abre la copia guardada al momento.
   - Supabase, Stripe y todo lo que no es de vendoplusoficial.com pasa
     directo: nunca se guarda ni se toca.
========================================================= */
const CACHE = 'vp-app-v2';
const ESPERA = 2500;
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
  './img/promo-asistente-h.webp?v=1',
  './img/promo-asistente-v.webp?v=1',
  './img/promo-menu-h.webp?v=1',
  './img/promo-menu-v.webp?v=1'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).catch(() => {}));
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
  if (req.mode === 'navigate') { e.respondWith(primeroRed(req, true)); return; }
  /* Archivos con versión (?v=…), la librería fija y las imágenes: la copia primero */
  if (/[?&]v=/.test(url.search) || url.pathname.indexOf('/vendor/') >= 0 || /\.(png|svg|ico|webp|jpe?g|gif|woff2?)$/i.test(url.pathname)) {
    e.respondWith(primeroCopia(req));
    return;
  }
  /* Lo demás (js/css sin versión): la copia al momento y se actualiza para la siguiente vez */
  if (/\.(js|css|json|webmanifest)$/i.test(url.pathname)) e.respondWith(copiaYActualiza(e, req));
});

function guardar(cache, req, r) {
  if (r && r.ok && r.type === 'basic') cache.put(req, r.clone()).catch(() => {});
  return r;
}

async function primeroRed(req, pagina) {
  const cache = await caches.open(CACHE);
  const red = fetch(req).then(r => guardar(cache, req, r));
  const copia = (await cache.match(req)) || (pagina ? (await cache.match(req, { ignoreSearch:true })) || (await cache.match('./')) : null);
  if (!copia) return red;
  return new Promise(resolve => {
    let listo = false;
    const fin = r => { if (!listo) { listo = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => fin(copia), ESPERA);
    red.then(fin, () => fin(copia));
  });
}

async function copiaYActualiza(e, req) {
  const cache = await caches.open(CACHE);
  const copia = await cache.match(req);
  const red = fetch(req).then(r => guardar(cache, req, r));
  if (copia) { e.waitUntil(red.catch(() => {})); return copia; }
  return red;
}

async function primeroCopia(req) {
  const cache = await caches.open(CACHE);
  const copia = await cache.match(req);
  if (copia) return copia;
  return fetch(req).then(r => guardar(cache, req, r));
}
