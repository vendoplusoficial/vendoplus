/* =========================================================
   VendoPlus · copia de la app en el aparato
   - Con buena señal: se baja la versión nueva de siempre (lo publicado
     se ve al instante).
   - Con señal mala: si el servidor tarda más de 2.5 s, se abre la copia
     guardada y la nueva se guarda para la siguiente vez.
   - Sin internet: se abre la copia guardada al momento.
   - Cada vez que se guarda la página se guardan también los archivos que
     esa página pide (?v=…): así la copia nunca queda a medias.
   - Si falta un archivo y no hay red, se usa la versión que haya guardada
     de ese mismo archivo (nunca se queda la app sin Comandas, etc.).
   - Supabase, Stripe y todo lo que no es de vendoplusoficial.com pasa
     directo: nunca se guarda ni se toca.
========================================================= */
const CACHE = 'vp-app-v2';            /* no cambiar: cambiarlo borra la copia */
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
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(BASE.map(u => c.add(u).catch(() => {})));
    /* La página que se guarda trae consigo sus archivos */
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
  /* Archivos con versión (?v=…), la librería fija y las imágenes: la copia primero */
  if (/[?&]v=/.test(url.search) || url.pathname.indexOf('/vendor/') >= 0 || /\.(png|svg|ico|webp|jpe?g|gif|woff2?)$/i.test(url.pathname)) {
    e.respondWith(primeroCopia(req));
    return;
  }
  /* Lo demás (js/css sin versión): la copia al momento y se actualiza para la siguiente vez */
  if (/\.(js|css|json|webmanifest)$/i.test(url.pathname)) e.respondWith(copiaYActualiza(e, req));
});

function guardar(cache, req, r) {
  if (r && r.ok && r.type === 'basic' && !r.redirected) cache.put(req, r.clone()).catch(() => {});
  return r;
}

/* Lee la página y guarda los archivos con versión que pide (scripts, estilos, fotos) */
async function guardarLoQuePide(cache, resp) {
  try {
    const html = await resp.clone().text();
    const urls = new Set();
    const re = /["'(]((?!https?:|\/\/|data:)[^"'()\s<>]+\?v=[^"'()\s<>]+)["')]/g;
    let m;
    while ((m = re.exec(html))) urls.add(new URL(m[1], self.registration.scope).href);
    await Promise.all([...urls].map(async u => {
      if (await cache.match(u)) return;
      try { const r = await fetch(u); if (r.ok && !r.redirected) await cache.put(u, r); } catch (x) {}
    }));
  } catch (x) {}
}

async function pagina(e, req) {
  const cache = await caches.open(CACHE);
  const red = fetch(req).then(r => {
    if (r && r.ok && r.type === 'basic' && !r.redirected) {
      cache.put(req, r.clone()).catch(() => {});
      e.waitUntil(guardarLoQuePide(cache, r.clone()));
    }
    return r;
  });
  const copia = (await cache.match(req)) || (await cache.match(req, { ignoreSearch:true })) || (await cache.match('./'));
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
  return red.catch(async err => (await cache.match(req, { ignoreSearch:true })) || Promise.reject(err));
}

/* Versión exacta guardada → red → si no hay red (o tarda), otra versión guardada del mismo archivo */
async function primeroCopia(req) {
  const cache = await caches.open(CACHE);
  const copia = await cache.match(req);
  if (copia) return copia;
  const red = fetch(req).then(r => guardar(cache, req, r));
  const otra = await cache.match(req, { ignoreSearch:true });
  if (!otra) return red;
  return new Promise(resolve => {
    let listo = false;
    const fin = r => { if (!listo) { listo = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => fin(otra), ESPERA);
    red.then(r => fin(r && r.ok ? r : otra), () => fin(otra));
  });
}
