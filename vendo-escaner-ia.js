/* =====================================================================
   VENDO PLUS · ESCÁNER DE PRODUCTOS CON IA
   ---------------------------------------------------------------------
   El dueño toma una foto de su menú, su carta o su lista de precios y
   Gemini 2.5 Flash-Lite (desde la Edge Function vp-escaner-ia) saca los
   productos. Aquí se arma la pantalla "Productos detectados", se corrigen
   a mano y se agregan al inventario con las mismas funciones de siempre
   (DB.getProducts / DB.saveProducts / DB.getCategories).

   Reglas que cumple este archivo:
     · UNA sola llamada a Gemini por escaneo. Corregir, validar, borrar y
       guardar NO llama a la IA. Solo "Volver a analizar" gasta otra vez.
     · Caché por huella (sha256) en este aparato y también en el servidor:
       la misma foto del mismo negocio no se vuelve a cobrar.
     · Nada se guarda en el inventario sin que el dueño toque el botón.
     · No se inventan costos, existencias ni códigos de barras.
     · No cambia ninguna otra pantalla: el botón se agrega solo, envolviendo
       renderProducts(), sin tocar el resto de index.html.

   Se carga igual en la web y dentro de la app de Android (assets/www),
   porque las dos usan el mismo index.html. En Android la cámara abre con
   el <input type="file" accept="image/*" capture> que ya maneja
   MainActivity (no hace falta ningún cambio en Java ni en el manifiesto).
===================================================================== */
(function(){
  'use strict';

  if(window.__vpEscanerIA) return;
  window.__vpEscanerIA = true;

  var FUNCION     = 'vp-escaner-ia';
  var CACHE_KEY   = 'vendo_ia_cache';   /* solo en este aparato: NO se sincroniza */
  var CACHE_MAX   = 12;
  var FOTO_LADO   = 1280;               /* lado más largo que se manda a la IA */
  var FOTO_Q      = 0.82;
  var UMBRAL      = 0.7;                /* confianza mínima para no marcarlo */

  /* --------------------------------------------------------------- */
  /* Estado de la sesión de escaneo (vive solo mientras está abierto) */
  /* --------------------------------------------------------------- */
  var S = null;
  function nuevoEstado(){
    return { foto:null, mime:'image/jpeg', hash:'', items:[], nota:'', legible:true,
             cache:false, uso:null, cargando:false, verFoto:false, reanalisis:0, cerrado:false };
  }
  var enVuelo = false;   /* protección contra toques dobles */

  /* --------------------------------------------------------------- */
  /* Estilos: usan los mismos colores y radios que el resto de la app */
  /* --------------------------------------------------------------- */
  function estilos(){
    if(document.getElementById('vp-ia-css')) return;
    var s = document.createElement('style');
    s.id = 'vp-ia-css';
    s.textContent = [
      /* ---- Fila de botones de Inventarios ----------------------------
         Los tres en un solo renglón, del mismo ancho, como tres tarjetas.
         Para que quepan de verdad las etiquetas van cortas (el icono dice
         el resto) y el tamaño de letra se adapta al ancho del teléfono. */
      '.fab-row.vp-ia-row{display:flex;flex-wrap:nowrap;gap:6px;justify-content:stretch;}',
      '.fab-row.vp-ia-row .btn{flex:1 1 0;min-width:0;white-space:nowrap;gap:6px;',
        'font-size:clamp(11.5px, 3.4vw, 14px);padding:12px 8px;border-radius:16px;}',
      '.fab-row.vp-ia-row .btn svg{width:17px;height:17px;flex:0 0 auto;}',
      '@media (min-width:600px){.fab-row.vp-ia-row{justify-content:flex-end;}',
        '.fab-row.vp-ia-row .btn{flex:0 0 auto;padding:12px 18px;}}',

      /* ---- La hoja del escáner -------------------------------------
         Sin esto la barra de abajo quedaba "pegada" a mitad de la hoja
         y se alcanzaba a ver la lista por debajo. Ahora la hoja es una
         columna: cabecera arriba, lista con su propio scroll en medio,
         y la barra de botones abajo, fija y sin huecos. */
      '.modal-sheet.vp-ia-sheet{display:flex;flex-direction:column;overflow:hidden;padding-bottom:0;}',
      '.vp-ia-sheet .vp-ia-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding-bottom:8px;}',
      '.vp-ia-sheet .vp-ia-bar{flex:0 0 auto;}',
      '.vp-ia-bar{background:var(--bg);border-top:1px solid var(--border);padding:12px 0 calc(14px + env(safe-area-inset-bottom, 0px));}',
      '.vp-ia-bar .btn+.btn{margin-top:8px;}',
      '.vp-ia-nota{font-size:11.5px;color:var(--ink-soft);font-weight:600;text-align:center;margin:10px 0 0;line-height:1.45;}',

      /* ---- Sin escaneos gratis: los botones se ven, pero apagados ---- */
      '.vp-ia-apagados{position:relative;opacity:.45;filter:grayscale(.55);pointer-events:none;user-select:none;}',
      '.vp-ia-apagados .btn{cursor:default;}',
      /* El aviso ES el botón: toda la tarjeta lleva a pagar la membresía */
      '.vp-ia-premium{display:flex;align-items:center;gap:12px;width:100%;margin-top:14px;cursor:pointer;',
      'border:1.5px solid #BFE9D0;border-radius:16px;background:#E8F9EF;padding:14px 15px;',
      'font-family:inherit;text-align:left;-webkit-tap-highlight-color:transparent;',
      'transition:transform .12s ease, background .15s ease;}',
      '.vp-ia-premium:active{transform:scale(.99);background:#D5F3E2;}',
      '.vp-ia-premium-txt{flex:1;min-width:0;}',
      '.vp-ia-premium-txt b{display:block;font-size:15px;font-weight:800;color:#15181C;line-height:1.3;}',
      '.vp-ia-premium-txt span{display:block;font-size:13.5px;font-weight:700;color:#16A34A;margin-top:3px;line-height:1.35;}',
      '.vp-ia-premium-chev{flex:none;display:flex;color:#16A34A;}',
      '.vp-ia-premium-chev svg{width:19px;height:19px;}',

      /* ---- Pantalla de inicio --------------------------------------- */
      '.vp-ia-lead{font-size:14px;line-height:1.55;color:var(--ink-soft);font-weight:500;margin:0 0 18px;}',
      '.vp-ia-tips{display:grid;gap:11px;margin:0 0 22px;}',
      '.vp-ia-tip{display:flex;gap:11px;align-items:flex-start;}',
      '.vp-ia-tip i{width:24px;height:24px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--success-bg);color:var(--whatsapp-ink);}',
      '.vp-ia-tip i svg{width:13px;height:13px;}',
      '.vp-ia-tip b{font-size:13.5px;line-height:1.5;font-weight:600;color:var(--ink);padding-top:3px;}',

      /* ---- Contadores ----------------------------------------------- */
      '.vp-ia-count{display:flex;gap:8px;margin:0 0 14px;}',
      '.vp-ia-count>div{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:11px 6px;text-align:center;font-family:inherit;}',
      '.vp-ia-count b{display:block;font-size:19px;font-weight:800;color:var(--ink);line-height:1.15;}',
      '.vp-ia-count span{display:block;font-size:11.5px;font-weight:700;color:var(--ink-soft);margin-top:3px;}',
      '.vp-ia-count>div.on{background:var(--accent-soft);border-color:#F0DCA0;}',
      '.vp-ia-count>div.on b,.vp-ia-count>div.on span{color:#8A6000;}',
      /* "Por revisar" es un botón: lleva al siguiente producto con aviso */
      '.vp-ia-count>button{border:1px solid var(--border);cursor:pointer;}',
      '.vp-ia-count>button.on:active{transform:scale(.97);}',
      '.vp-ia-count>button.on span::after{content:" ›";font-weight:800;}',
      /* Al llegar al producto, parpadea para que se vea cuál es */
      '.vp-ia-card.vp-ia-salta{animation:vpIaSalta 1.1s ease;}',
      '@keyframes vpIaSalta{0%,100%{box-shadow:0 0 0 0 rgba(245,191,60,0)}30%,60%{box-shadow:0 0 0 4px rgba(245,191,60,.45)}}',
      '@media (prefers-reduced-motion: reduce){.vp-ia-card.vp-ia-salta{animation:none;box-shadow:0 0 0 3px rgba(245,191,60,.45)}}',

      /* ---- Fluidez con catálogos grandes ---------------------------
         "content-visibility:auto" le dice al navegador que no se moleste
         en dibujar lo que está fuera de la pantalla hasta que te acerques
         scrolleando. Medido con 300 productos: la rejilla de Nueva venta
         pasó de 88 ms a 38 ms por repintado, y la lista de Inventarios de
         54 a 46 ms. "contain-intrinsic-size: auto" hace que el navegador
         recuerde el alto real de cada tarjeta, así la barra de scroll no
         da brincos. Los navegadores viejos lo ignoran y todo sigue igual. */
      '.product-card{content-visibility:auto;contain-intrinsic-size:auto 236px;}',
      '.prod-row{content-visibility:auto;contain-intrinsic-size:auto 68px;}',
      '.dm-card{content-visibility:auto;contain-intrinsic-size:auto 250px;}',

      /* ---- Encabezado del carrito ----------------------------------
         Antes: "Carrito" + una pastilla azul marino con un icono verde
         y el total adentro. Ahora: "Carrito" y el total a secas. */
      '.cart-total-pill .ctp-icon{display:none;}',
      '.sheet-header .cart-total-pill,.sp-card .cart-total-pill{background:transparent;color:var(--ink);',
        'padding:0;font-size:16.5px;font-weight:800;border-radius:0;}',

      /* ---- Al pasar de un paso a otro dentro de la misma hoja -------
         (Carrito → Cobrar pedido, Fiado → Elegir cliente). Solo cuando
         de verdad cambia de pantalla: al subir una cantidad no se mueve
         nada, que era justo lo que VendoPlus evitaba a propósito. */
      '@keyframes vpIaPaso{from{opacity:.25;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
      /* VendoPlus apaga toda animación en los cambios de contenido con
         ".modal-overlay.is-swap .modal-sheet{animation:none}". Hay que
         pesar más que esa regla para poder animar solo el cambio de paso. */
      '.modal-overlay.is-swap .modal-sheet.vp-ia-paso,.modal-overlay .modal-sheet.vp-ia-paso{',
        'animation:vpIaPaso .2s cubic-bezier(.33,1,.68,1);}',
      '@media (prefers-reduced-motion: reduce){.modal-overlay.is-swap .modal-sheet.vp-ia-paso,',
        '.modal-overlay .modal-sheet.vp-ia-paso{animation:none}}',

      /* ---- Producto sin foto: un punto del color de su sección ------ */
      /* El punto se dibuja con CSS, no creando elementos: con 300
         productos, crear y cambiar 300 nodos costaba más que el ahorro.
         Así solo se escriben dos atributos por caja. Se esconde lo que
         hubiera adentro (el icono de foto) pero se respetan la etiqueta
         de "Agotado" y el botón de cerrar. */
      '[data-vp-dot]{position:relative;}',
      '[data-vp-dot] > *:not([class*="flag"]):not(.sheet-close){display:none !important;}',
      '[data-vp-dot]::after{content:"";display:block;margin:auto;border-radius:50%;',
        'width:13px;height:13px;background:var(--vp-dot,#8A93AC);}',
      '[data-vp-dot][data-vp-tam="grande"]::after{width:26px;height:26px;}',
      '[data-vp-dot][data-vp-tam="mini"]::after{width:9px;height:9px;}',
      '@media (max-width:699px){[data-vp-dot][data-vp-tam="grande"]::after{width:20px;height:20px;}}',
      /* La franja de color de arriba de la tarjeta se quita: el color de
         la sección ya lo dice el punto, y con tonos pastel la franja se
         veía como una mancha. */
      '.product-card .pc-top{display:none;}',

      /* ---- Foto original -------------------------------------------- */
      '.vp-ia-foto{width:100%;border-radius:var(--radius-card);border:1px solid var(--border);display:block;margin:0 0 14px;}',
      /* En la pantalla de error solo es para reconocer cuál foto fue:
         acotada, para que los botones no se vayan abajo de la pantalla */
      '.vp-ia-foto.chica{max-height:190px;object-fit:cover;}',

      /* ---- Tarjeta de producto -------------------------------------- */
      '.vp-ia-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:12px 13px;margin-bottom:10px;}',
      '.vp-ia-card.dudoso{border-color:#F0DCA0;}',
      '.vp-ia-card.off{opacity:.5;}',
      '.vp-ia-top{display:flex;align-items:center;gap:11px;}',
      '.vp-ia-chk{width:21px;height:21px;flex-shrink:0;accent-color:var(--whatsapp);}',
      '.vp-ia-nombre{flex:1;min-width:0;font-size:15px;font-weight:700;color:var(--ink);border:1.5px solid transparent;background:transparent;border-radius:10px;padding:7px 8px;font-family:inherit;}',
      '.vp-ia-nombre:focus{border-color:var(--accent-strong);background:var(--surface);outline:none;}',
      '.vp-ia-del{background:var(--surface-alt);border:none;width:30px;height:30px;border-radius:50%;color:var(--ink-soft);flex-shrink:0;display:flex;align-items:center;justify-content:center;}',
      '.vp-ia-del svg{width:15px;height:15px;}',

      /* ---- Campos: mismo estilo que los formularios de VendoPlus ---- */
      '.vp-ia-grid{display:grid;grid-template-columns:1fr 1.3fr;gap:10px;margin-top:11px;}',
      '.vp-ia-f.full{grid-column:1 / -1;}',
      '.vp-ia-f label{display:block;font-size:12.5px;font-weight:700;color:var(--ink-soft);margin-bottom:6px;}',
      '.vp-ia-f input,.vp-ia-f select,.vp-ia-f textarea{width:100%;border:1.5px solid var(--border);border-radius:12px;padding:11px 12px;font-size:14.5px;background:var(--surface);color:var(--ink);font-weight:600;font-family:inherit;}',
      '.vp-ia-f input:focus,.vp-ia-f select:focus,.vp-ia-f textarea:focus{border-color:var(--accent-strong);outline:none;}',
      '.vp-ia-f input:disabled{background:var(--surface-alt);color:var(--ink-soft);}',
      '.vp-ia-f textarea{resize:vertical;min-height:62px;line-height:1.45;}',
      '.vp-ia-f.mal input{border-color:var(--accent-2);background:var(--danger-bg);}',

      /* ---- Botón para abrir la descripción (va cerrada) ------------- */
      '.vp-ia-mas{margin-top:10px;background:none;border:none;padding:0;font-size:12.5px;font-weight:700;color:var(--ink-soft);display:inline-flex;align-items:center;gap:6px;}',
      '.vp-ia-mas svg{width:13px;height:13px;}',

      /* ---- Avisos dentro de la tarjeta ------------------------------ */
      '.vp-ia-aviso{display:flex;gap:9px;align-items:flex-start;background:var(--accent-soft);border:1px solid #F0DCA0;border-radius:12px;padding:9px 11px;margin-top:11px;}',
      '.vp-ia-aviso.gris{background:var(--surface-alt);border-color:var(--border);}',
      '.vp-ia-aviso svg{width:15px;height:15px;color:#8A6000;flex-shrink:0;margin-top:1px;}',
      '.vp-ia-aviso.gris svg{color:var(--ink-soft);}',
      '.vp-ia-aviso p{flex:1;min-width:0;margin:0;font-size:12.5px;font-weight:600;color:var(--ink);line-height:1.45;}',
      '.vp-ia-aviso button{background:none;border:none;color:#8A6000;font-size:12px;font-weight:800;white-space:nowrap;padding:0 0 0 4px;align-self:center;}',

      /* ---- Etiquetas ------------------------------------------------ */
      '.vp-ia-tags{display:flex;flex-wrap:wrap;gap:6px;}',
      '.vp-ia-tags:not(:empty){margin-top:10px;}',
      '.vp-ia-tag{display:inline-flex;align-items:center;font-size:11px;font-weight:800;padding:4px 9px;border-radius:999px;background:var(--success-bg);color:var(--whatsapp-ink);}',

      /* ---- Tamaños y presentaciones --------------------------------- */
      '.vp-ia-var{margin-top:11px;background:var(--surface-alt);border-radius:12px;padding:11px;}',
      '.vp-ia-var>label{display:block;font-size:12.5px;font-weight:700;color:var(--ink-soft);margin-bottom:8px;}',
      '.vp-ia-vrow{display:flex;gap:7px;margin-bottom:7px;}',
      '.vp-ia-vrow input{border:1.5px solid var(--border);background:var(--surface);border-radius:10px;padding:9px 10px;font-size:13.5px;font-weight:600;color:var(--ink);min-width:0;font-family:inherit;}',
      '.vp-ia-vrow input:focus{border-color:var(--accent-strong);outline:none;}',
      '.vp-ia-vrow input.et{flex:1;}',
      '.vp-ia-vrow input.pr{width:94px;flex:0 0 94px;}',
      '.vp-ia-var select{width:100%;border:1.5px solid var(--border);background:var(--surface);border-radius:10px;padding:9px 10px;font-size:13px;font-weight:600;color:var(--ink);margin-top:3px;font-family:inherit;}',

      /* ---- Esperando a la IA ---------------------------------------- */
      '.vp-ia-load{text-align:center;padding:34px 10px 26px;}',
      '.vp-ia-spin{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--whatsapp);border-radius:50%;margin:0 auto 18px;animation:vpIaSpin .8s linear infinite;}',
      '@keyframes vpIaSpin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.vp-ia-spin{animation-duration:2.4s}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* --------------------------------------------------------------- */
  /* Utilidades                                                       */
  /* --------------------------------------------------------------- */
  function esc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function ico(n){ return (typeof icon === 'function') ? icon(n) : ''; }
  function avisar(msg, o){ if(typeof toast === 'function') toast(msg, o || {}); }
  function r2(n){ return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function norm(s){
    return String(s == null ? '' : s).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  }
  function nid(){ return 'ia' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ---- Comprime la foto sin perder legibilidad -------------------
     Ojo: Gemini cobra la imagen por "mosaicos", no por pixeles, así que
     bajarle la resolución casi no cambia los tokens. Esto se hace para
     que suba rápido con datos del celular y para no pasarse del tope de
     tamaño de la Edge Function. La legibilidad es lo primero. */
  function comprimir(file){
    return new Promise(function(res, rej){
      var fr = new FileReader();
      fr.onerror = function(){ rej(new Error('lectura')); };
      fr.onload = function(e){
        var img = new Image();
        img.onerror = function(){ rej(new Error('imagen')); };
        img.onload = function(){
          try{
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if(!w || !h){ rej(new Error('imagen')); return; }
            var k = Math.min(1, FOTO_LADO / Math.max(w, h));
            var W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
            /* Se baja de mitad en mitad para que el texto no se "deshaga" */
            var src = img, sw = w, sh = h;
            while(sw / 2 >= W * 1.15 && sh / 2 >= H * 1.15){
              var c = document.createElement('canvas');
              c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
              var x = c.getContext('2d');
              x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
              x.drawImage(src, 0, 0, c.width, c.height);
              src = c; sw = c.width; sh = c.height;
            }
            var out = document.createElement('canvas');
            out.width = W; out.height = H;
            var ctx = out.getContext('2d');
            ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(src, 0, 0, W, H);
            var url = out.toDataURL('image/jpeg', FOTO_Q);
            res({ dataUrl:url, mime:'image/jpeg' });
          }catch(err){ rej(err); }
        };
        img.src = e.target.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function b64de(dataUrl){ return String(dataUrl).replace(/^data:[^;]+;base64,/, ''); }

  function bytesDe(dataUrl){
    var bin = atob(b64de(dataUrl));
    var out = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function huella(dataUrl){
    var bytes = bytesDe(dataUrl);
    if(!(window.crypto && crypto.subtle && crypto.subtle.digest)) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', bytes).then(function(buf){
      var a = new Uint8Array(buf), s = '';
      for(var i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
      return s;
    }).catch(function(){ return ''; });
  }

  /* ---- Caché local (solo este aparato, no se sube a la nube) ---- */
  function cacheLeer(hash){
    if(!hash) return null;
    try{
      var m = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      for(var i = 0; i < m.length; i++) if(m[i] && m[i].hash === hash) return m[i].res;
    }catch(e){}
    return null;
  }
  function cacheGuardar(hash, res){
    if(!hash || !res) return;
    try{
      var m = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      m = m.filter(function(x){ return x && x.hash !== hash; });
      m.unshift({ hash:hash, res:res, t:Date.now() });
      localStorage.setItem(CACHE_KEY, JSON.stringify(m.slice(0, CACHE_MAX)));
    }catch(e){}
  }
  function cacheBorrar(hash){
    try{
      var m = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      localStorage.setItem(CACHE_KEY, JSON.stringify(m.filter(function(x){ return x && x.hash !== hash; })));
    }catch(e){}
  }

  /* --------------------------------------------------------------- */
  /* 1) El botón: se agrega solo a la pantalla de Inventarios         */
  /* --------------------------------------------------------------- */
  /* Etiqueta corta a propósito: con "Escanear con IA" los tres botones
     no caben en un renglón de celular (medido: hacen falta 376px y en un
     teléfono de 360px solo hay 320). El icono dice el resto. */
  function botonHTML(){
    return '<button class="btn ghost" onclick="vpIaAbrir()">' + ico('camera') + ' Escanear</button>';
  }

  /* Dentro de la fila de botones, y SOLO ahí, se acortan las etiquetas
     largas. Fuera de esa fila no se toca una sola letra de la app. */
  function acortar(fila){
    return fila
      .replace('>Agregar producto<', '>Agregar<')
      .replace('> Agregar producto<', '> Agregar<')
      .replace('>Nuevo producto<', '>Agregar<')
      .replace('> Nuevo producto<', '> Agregar<');
  }

  function instalarBoton(){
    /* Los estilos se ponen desde el arranque, no al abrir el escáner:
       la fila de botones de Inventarios también los necesita. */
    estilos();
    envolverFilaProductos();
    if(typeof window.renderProducts !== 'function' || window.renderProducts.__vpIa) return false;
    var original = window.renderProducts;
    var envuelto = function(){
      var html = original.apply(this, arguments);
      if(typeof html !== 'string') return html;
      /* Se mete junto a "Categorías", dentro de la misma fila de botones */
      var marca = '<button class="btn ghost" onclick="openCategoryManager()">';
      var i = html.indexOf(marca);
      if(i < 0) return html;
      var fin = html.indexOf('</button>', i);
      if(fin < 0) return html;
      fin += '</button>'.length;
      var puede = (typeof can === 'function') ? can('gestionarProductos') : true;
      if(!puede) return html;
      html = html.slice(0, fin) + botonHTML() + html.slice(fin);

      /* La fila solo lleva botones, nunca otro <div> adentro, así que
         basta con llegar al primer </div>. Dentro de ese trozo —y solo
         ahí— se marca la clase y se acortan las etiquetas largas. */
      return html.replace(/<div class="fab-row[^"]*"[^>]*>[\s\S]*?<\/div>/,
        function(fila){
          return acortar(fila).replace('class="fab-row', 'class="fab-row vp-ia-row');
        });
    };
    envuelto.__vpIa = true;
    window.renderProducts = envuelto;
    return true;
  }

  /* ---------------------------------------------------------------
     Producto sin foto: en vez del icono de imagen, un punto del color
     de su sección. Se hace sobre el HTML ya pintado, no cambiando las
     funciones de VendoPlus, para que funcione igual en Inventarios y
     en Nueva venta, en celular, tablet y PC, y sin importar qué icono
     tenga puesto cada quien.
  ---------------------------------------------------------------- */
  var GRIS = '#8A93AC';

  /* Todos los lugares donde VendoPlus dibuja la foto de un producto.
     "tam" es el tamaño del punto; "fila" es el renglón donde buscar el
     nombre cuando el elemento no trae el id del producto. */
  var LUGARES = [
    { sel:'.pc-photo',        tam:'grande', raiz:'.product-card' },  /* Nueva venta */
    { sel:'.pr-photo',        tam:'',       seccion:true },          /* Inventarios y vista previa del menú */
    { sel:'.cart-item-photo', tam:'',       raiz:'.cart-item' },     /* líneas del carrito */
    { sel:'.cartbar-thumb',   tam:'mini',   carrito:true },          /* barra del carrito */
    { sel:'.tp-photo',        tam:'',       raiz:'.tp-row' },        /* más vendidos */
    { sel:'.mdi-thumb',       tam:'',       raiz:'.mdi-line' },      /* pedidos del Menú Digital */
    { sel:'.dm-photo',        tam:'grande', raiz:'.dm-card' },       /* Menú Digital: tarjeta */
    { sel:'.dm-pd-photo',     tam:'grande', raiz:'.dm-pd' },         /* Menú Digital: detalle */
    { sel:'.dm-thumb',        tam:'',       raiz:'.dm-l' },          /* Menú Digital: carrito */
    { sel:'.fd-pic',          tam:'grande', raiz:'.fd-slide' },      /* diseño de menú */
    { sel:'.cg-photo',        tam:'grande', raiz:'.cg-card' }        /* diseño de menú */
  ];

  /* Color de cada producto, por id y por nombre. Se arma una sola vez por
     pasada: "peek" no copia la lista, así que no pesa. */
  var colores = null;
  function mapaColores(){
    var m = { id:{}, nom:{} };
    try{
      var cats = {};
      (Store.peek('mesa_categories', []) || []).forEach(function(c){ if(c && c.id) cats[c.id] = c.color || GRIS; });
      (Store.peek('mesa_products', []) || []).forEach(function(p){
        if(!p || !p.id) return;
        var col = cats[p.category] || GRIS;
        m.id[p.id] = col;
        if(p.name) m.nom[norm(p.name)] = col;
      });
    }catch(e){}
    return m;
  }

  /* De un elemento al color que le toca: primero por id, luego por el
     nombre que tenga a un lado, y si no, el gris de "sin categoría". */
  function colorDe(caja, lugar){
    if(!colores) colores = mapaColores();
    var raiz = (lugar.raiz && caja.closest) ? caja.closest(lugar.raiz) : null;

    var id = null;
    var conId = caja.closest ? caja.closest('[data-pid],[data-id]') : null;
    if(conId) id = conId.getAttribute('data-pid') || conId.getAttribute('data-id');
    if(!id && raiz && raiz.id && raiz.id.indexOf('dmc-') === 0) id = raiz.id.slice(4);
    if(id && colores.id[id]) return colores.id[id];

    if(raiz){
      var et = raiz.querySelector('[class*="name"],[class*="nombre"],[class*="cname"]');
      if(et){
        /* "Refresco · 2 litros" → "Refresco" */
        var txt = String(et.textContent || '').split('·')[0];
        var col = colores.nom[norm(txt)];
        if(col) return col;
      }
    }
    return null;
  }

  /* Marca la caja para que el CSS dibuje el punto. No crea ni mueve
     elementos: solo dos atributos, que es lo barato. */
  function ponPunto(caja, color, tam){
    if(!caja || !color) return;
    if(caja.getAttribute('data-vp-dot') === color) return;   /* ya está */
    if(caja.querySelector('img')) return;                    /* sí tiene foto */
    caja.setAttribute('data-vp-dot', color);
    caja.style.setProperty('--vp-dot', color);
    if(tam) caja.setAttribute('data-vp-tam', tam);
  }

  function pintarPuntos(){
    try{
      colores = null;

      /* Inventarios: el color viene del encabezado de sección de arriba.
         Si no queda ninguna fila sin pintar, ni se entra al bucle. */
      if(document.querySelector('.pr-photo:not([data-vp-dot])')){
        var color = GRIS;
        var nodos = document.querySelectorAll('.cat-header, .prod-row');
        for(var j = 0; j < nodos.length; j++){
          var n = nodos[j];
          if(n.classList.contains('cat-header')){
            var d = n.querySelector('.cat-dot');
            color = (d && (d.style.backgroundColor || d.style.background)) || GRIS;
            continue;
          }
          ponPunto(n.querySelector('.pr-photo:not([data-vp-dot])'), color, '');
        }
      }

      /* Todo lo demás. El ":not([data-vp-dot])" hace que el navegador ni
         siquiera devuelva las que ya están pintadas. */
      for(var k = 0; k < LUGARES.length; k++){
        var L = LUGARES[k];
        if(L.carrito) continue;                 /* se hace aparte, más abajo */
        var cajas = document.querySelectorAll(L.sel + ':not([data-vp-dot])');
        for(var i = 0; i < cajas.length; i++){
          if(cajas[i].querySelector('img')) continue;
          if(L.seccion && cajas[i].closest('.prod-row')) continue;   /* ya se pintó */
          ponPunto(cajas[i], colorDe(cajas[i], L) || GRIS, L.tam);
        }
      }

      /* La barra del carrito no trae ni id ni nombre: sus miniaturas son,
         en orden, los primeros productos del carrito.
         OJO: el carrito se declara con "let cart", y eso NO crea
         window.cart. Hay que leer la variable suelta, no por window. */
      var thumbs = document.querySelectorAll('.cartbar-thumb');
      if(thumbs.length){
        var lista = null;
        try{ if(typeof cart !== 'undefined' && Array.isArray(cart)) lista = cart; }catch(e){}
        if(!colores) colores = mapaColores();
        var ids = [];
        if(lista){
          for(var c = 0; c < lista.length && ids.length < thumbs.length; c++){
            var pid = lista[c] && lista[c].productId;
            if(pid && colores.id[pid]) ids.push(pid);
          }
        }
        for(var t = 0; t < thumbs.length; t++){
          if(thumbs[t].querySelector('img')) continue;
          ponPunto(thumbs[t], colores.id[ids[t]] || GRIS, 'mini');
        }
      }
    }catch(e){}
  }

  /* Se pinta después de cada repintado de la app, y además un vigilante
     por si alguna pantalla se actualiza por su cuenta. */
  function envolverFilaProductos(){
    if(typeof window.render === 'function' && !window.render.__vpIaPunto){
      var o = window.render;
      var w = function(){
        var r = o.apply(this, arguments);
        try{ pintarPuntos(); }catch(e){}
        return r;
      };
      w.__vpIaPunto = true;
      window.render = w;
    }
    if(!pintarPuntos.__obs && window.MutationObserver && document.body){
      var pendiente = false;
      var obs = new MutationObserver(function(){
        /* Lo que vuela al carrito se pinta de inmediato: si se espera un
           cuadro, alcanza a verse verde un instante. */
        try{ pintarVuelo(ultimoPid); }catch(e){}
        if(pendiente) return;
        pendiente = true;
        requestAnimationFrame(function(){
          pendiente = false;
          /* Se apaga el vigilante mientras se pinta: si no, los propios
             puntos que se ponen lo vuelven a despertar y da una vuelta
             de más en cada repintado. */
          obs.disconnect();
          pintarPuntos();
          obs.observe(document.body, { childList:true, subtree:true });
        });
      });
      obs.observe(document.body, { childList:true, subtree:true });
      pintarPuntos.__obs = obs;
    }
    pintarPuntos();
    envolverVuelo();
    envolverModal();
  }

  /* ---------------------------------------------------------------
     Animación al cambiar de paso dentro de una hoja abierta.
     VendoPlus a propósito NO vuelve a deslizar la hoja cuando solo
     cambia su contenido (si no, "brincaba" con cada toque). Así que
     aquí se anima únicamente cuando el título cambia, que es cuando
     de verdad pasaste a otra pantalla.
  ---------------------------------------------------------------- */
  function tituloHoja(){
    var h = document.querySelector('#modalOverlay .modal-sheet h2, #modalOverlay .modal-sheet .sheet-title');
    return h ? String(h.textContent || '').trim() : '';
  }
  function envolverModal(){
    if(typeof window.openModal !== 'function' || window.openModal.__vpIaPaso) return;
    var o = window.openModal;
    var w = function(){
      var antes = tituloHoja();
      var r = o.apply(this, arguments);
      try{
        if(antes){
          var sh = document.querySelector('#modalOverlay .modal-sheet');
          if(sh && tituloHoja() !== antes){
            sh.classList.add('vp-ia-paso');
            setTimeout(function(){ sh.classList.remove('vp-ia-paso'); }, 300);
          }
        }
      }catch(e){}
      return r;
    };
    w.__vpIaPaso = true;
    window.openModal = w;
  }

  /* ---------------------------------------------------------------
     Lo que "vuela" al carrito cuando el producto no tiene foto: que
     salga del color de su sección y no del verde de siempre.
     Se apunta cuál producto se está agregando, y en cuanto aparece el
     elemento que vuela se le pone ese color.
  ---------------------------------------------------------------- */
  var ultimoPid = null;
  function envolverVuelo(){
    ['addToCart', 'changeQtyFromGrid', 'addSizeToCart'].forEach(function(nombre){
      var o = window[nombre];
      if(typeof o !== 'function' || o.__vpIaVuelo) return;
      var w = function(){
        ultimoPid = arguments[0];
        var r = o.apply(this, arguments);
        try{ pintarVuelo(ultimoPid); }catch(e){}
        return r;
      };
      w.__vpIaVuelo = true;
      window[nombre] = w;
    });
  }
  function pintarVuelo(pid){
    if(!pid) return;
    var els = document.querySelectorAll('.vp-fly:not([data-vp-color])');
    for(var i = 0; i < els.length; i++){
      els[i].setAttribute('data-vp-color', '1');
      if(els[i].querySelector('img')) continue;     /* con foto: se deja */
      if(!colores) colores = mapaColores();
      els[i].style.background = colores.id[pid] || GRIS;
    }
  }
  /* index.html define renderProducts más abajo que este archivo en algunos
     órdenes de carga, así que se intenta varias veces sin hacer ruido. */
  (function esperar(n){
    if(instalarBoton()) return;
    if(n > 60) return;
    setTimeout(function(){ esperar(n + 1); }, 150);
  })(0);
  document.addEventListener('DOMContentLoaded', function(){ instalarBoton(); });

  /* --------------------------------------------------------------- */
  /* 2) Pantalla de inicio: tomar o elegir la foto                    */
  /* --------------------------------------------------------------- */
  var enInicio = false;      /* true mientras se ve la pantalla de "tomar foto" */

  function abrir(){
    if(typeof requirePerm === 'function' && !requirePerm('gestionarProductos', 'No tienes permiso para administrar productos')) return;
    /* Siempre entra, pague o no. Si ya no le quedan escaneos gratis, la
       pantalla se pinta con los botones apagados y el aviso de Premium. */
    estilos();
    S = nuevoEstado();
    pantallaInicio();
    consumo();
  }
  /** ¿Se le acabaron los escaneos gratis del mes?
      Si este archivo todavía no le ha preguntado al servidor, se usa el
      contador que ya tenga vendo-premium.js: así los dos siempre dicen lo
      mismo y no hay que preguntar dos veces. */
  function agotado(){
    if(premium()) return false;
    var r = restantes;
    if(r == null){
      try{
        var x = window.VPPremium && VPPremium.restantes();
        if(x != null && isFinite(x)) r = x;
      }catch(e){}
    }
    return r != null && r <= 0;
  }

  var restantes = null;      /* null = todavía no se pregunta al servidor */
  var sinLimite = false;     /* true = Premium: no hay tope */
  var GRATIS_AL_MES = 3;     /* lo manda el servidor; esto es solo el respaldo */

  /** ¿Membresía Premium activa? (escaneos sin límite) */
  function premium(){
    if(sinLimite) return true;
    try{ return !!(window.VPPremium && VPPremium.activo()); }catch(e){ return false; }
  }
  /** El texto de abajo de la pantalla: cuántos escaneos quedan. */
  function notaConsumo(){
    if(premium()) return 'Premium: escaneas todo lo que necesites, sin límite.';
    if(restantes == null) return 'Gratis tienes ' + GRATIS_AL_MES + ' escaneos al mes. Solo cuentan las fotos que la IA alcanza a leer.';
    if(restantes <= 0) return 'Ya usaste tus ' + GRATIS_AL_MES + ' escaneos gratis de este mes. Se renuevan el mes que entra.';
    return 'Te queda' + (restantes === 1 ? '' : 'n') + ' ' + restantes + ' de ' + GRATIS_AL_MES +
           ' escaneo' + (restantes === 1 ? '' : 's') + ' gratis este mes.';
  }
  function pintarConsumo(){
    /* Si estamos en la pantalla de inicio, se vuelve a pintar completa:
       no solo cambia el texto, también se apagan o se encienden los
       botones de la cámara y la galería. */
    if(enInicio && document.getElementById('vpIaInicio')){ pantallaInicio(); return; }
    var el = document.getElementById('vpIaRestantes');
    if(el) el.textContent = notaConsumo();
  }
  /* El conteo lo guarda el SERVIDOR (Supabase), así que no se reinicia al
     cerrar sesión, cambiar de teléfono ni reinstalar la app. */
  function consumo(){
    try{
      if(!(window.Cloud && Cloud.sb && Cloud.uid)) return;
      Cloud.sb.rpc('vp_ia_mi_consumo').then(function(r){
        var d = r && r.data;
        if(!d || !d.ok) return;
        /* El servidor manda la verdad: cuántos gratis van al mes, si este
           negocio es Premium y cuántos le quedan. "limite: null" quiere
           decir SIN LÍMITE. */
        if(d.gratis_mes != null) GRATIS_AL_MES = Number(d.gratis_mes) || GRATIS_AL_MES;
        sinLimite = (d.premium === true) || (d.limite == null);
        restantes = sinLimite ? null : Number(d.restantes || 0);
        try{
          if(window.VPPremium && VPPremium.fijarRestantes){
            VPPremium.fijarRestantes(sinLimite ? Infinity : restantes);
          }
        }catch(e){}
        pintarConsumo();
      }).catch(function(){});
    }catch(e){}
  }
  /** Cuando se acaban los gratis, se ofrece Premium (no un error seco). */
  function ofrecerPremium(){
    try{
      if(window.VPPremium && typeof VPPremium.sinEscaneos === 'function'){ VPPremium.sinEscaneos(); return true; }
    }catch(e){}
    return false;
  }

  /* Dos campos en vez de uno, y el dueño elige con un botón cada uno:
       · con "capture"  → abre la cámara
       · sin "capture"  → abre la galería
     Hace falta porque los navegadores no se ponen de acuerdo: con capture,
     Chrome y Safari iban directo a la cámara y no dejaban la galería; sin
     capture, el Android nuevo abre su selector de fotos, que no trae
     cámara. Con dos botones funciona igual en Android, iPhone y PC, y
     además se ve claro qué hace cada uno. */
  function campoFoto(id, camara){
    return '<input id="' + id + '" type="file" accept="image/*"' +
           (camara ? ' capture="environment"' : '') +
           ' style="display:none" onchange="vpIaFoto(this)">';
  }
  function botonesFoto(sufijo, apagados){
    var a = 'vpIaCam' + sufijo, b = 'vpIaGal' + sufijo;
    if(apagados){
      /* Se ven, pero no hacen nada: así se entiende que la función existe
         y que lo único que falta es la membresía. */
      return '<div class="vp-ia-apagados">' +
               '<button class="btn primary xl block" disabled>' + ico('camera') + ' Tomar foto</button>' +
               '<button class="btn ghost block" style="margin-top:8px;" disabled>' + ico('mobile') + ' Elegir de la galería</button>' +
             '</div>';
    }
    return '<button class="btn primary xl block" onclick="document.getElementById(\'' + a + '\').click()">' +
             ico('camera') + ' Tomar foto' +
           '</button>' +
           '<button class="btn ghost block" style="margin-top:8px;" onclick="document.getElementById(\'' + b + '\').click()">' +
             ico('mobile') + ' Elegir de la galería' +
           '</button>' +
           campoFoto(a, true) + campoFoto(b, false);
  }
  function tip(texto){
    return '<div class="vp-ia-tip"><i>' + ico('check') + '</i><b>' + texto + '</b></div>';
  }

  function pantallaInicio(){
    var fin = agotado();
    enInicio = true;
    var html =
      '<i id="vpIaInicio" hidden></i>' +
      '<div class="sheet-header">' +
        '<h2>Escanear productos con IA</h2>' +
        '<button class="sheet-close" onclick="vpIaCerrar()">' + ico('close') + '</button>' +
      '</div>' +
      '<p class="vp-ia-lead">Toma una foto de tu menú o de tu lista de precios. La IA saca los nombres y los precios, y tú los revisas antes de guardarlos.</p>' +
      (fin ? '' :
        '<div class="vp-ia-tips">' +
          tip('Con buena luz, de frente y sin sombras.') +
          tip('Una hoja a la vez. Si el menú es largo, fotografíalo por partes.') +
          tip('Nada entra a tu inventario hasta que tú lo confirmes.') +
        '</div>') +
      botonesFoto('A', fin) +
      (fin
        /* Se acabaron los gratis: el aviso ES el botón que lleva a pagar. */
        ? '<button type="button" class="vp-ia-premium" onclick="vpIaPremium()">' +
            '<span class="vp-ia-premium-txt">' +
              '<b>Tienes 0 escaneos gratis este mes</b>' +
              '<span>Contrata Premium para obtener más</span>' +
            '</span>' +
            '<span class="vp-ia-premium-chev">' + ico('chevronRight') + '</span>' +
          '</button>' +
          '<p class="vp-ia-nota">Ya no te quedan escaneos gratuitos por este mes.</p>'
        : '<p class="vp-ia-nota" id="vpIaRestantes">' + esc(notaConsumo()) + '</p>');
    openModal(html, { dismissible:true });
  }

  function pantallaCargando(txt){
    enInicio = false;
    var html =
      '<div class="sheet-header">' +
        '<h2>Leyendo la foto</h2>' +
      '</div>' +
      '<div class="vp-ia-load">' +
        '<div class="vp-ia-spin"></div>' +
        '<p class="vp-ia-nota">' + esc(txt || 'Tarda unos segundos. No cierres la app.') + '</p>' +
      '</div>';
    openModal(html, { dismissible:false, grip:false });
  }

  function pantallaError(titulo, texto, reintentar){
    enInicio = false;
    var html =
      '<div class="sheet-header">' +
        '<h2>' + esc(titulo) + '</h2>' +
        '<button class="sheet-close" onclick="vpIaCerrar()">' + ico('close') + '</button>' +
      '</div>' +
      (S && S.foto ? '<img class="vp-ia-foto chica" src="' + S.foto + '" alt="La foto que mandaste">' : '') +
      '<p class="vp-ia-lead">' + esc(texto) + '</p>' +
      /* Sin icono de cámara: este botón vuelve a mandar la MISMA foto,
         no abre la cámara. El de abajo sí, y por eso lo lleva. */
      (reintentar
        ? '<button class="btn primary xl block" style="margin-bottom:8px;" onclick="vpIaReintentar()">Analizar esta foto otra vez</button>'
        : '') +
      '<button class="btn ghost block" onclick="document.getElementById(\'vpIaCamB\').click()">' + ico('camera') + ' Tomar otra foto</button>' +
      '<button class="btn ghost block" style="margin-top:8px;" onclick="document.getElementById(\'vpIaGalB\').click()">' + ico('mobile') + ' Elegir de la galería</button>' +
      campoFoto('vpIaCamB', true) + campoFoto('vpIaGalB', false);
    openModal(html, { dismissible:true });
  }

  /* --------------------------------------------------------------- */
  /* 3) Se eligió una foto                                            */
  /* --------------------------------------------------------------- */
  function fotoElegida(input){
    var file = input && input.files && input.files[0];
    if(input) input.value = '';
    if(!file) return;
    if(!/^image\//.test(file.type || '')){ avisar('Selecciona una imagen', { variant:'toast-danger', icon:ico('close') }); return; }
    if(!S) S = nuevoEstado();

    pantallaCargando('Preparando la foto…');

    comprimir(file).then(function(c){
      S.foto = c.dataUrl; S.mime = c.mime;
      return huella(c.dataUrl);
    }).then(function(h){
      S.hash = h;
      /* ¿Esta misma foto ya se leyó en este aparato? Entonces ni se manda. */
      var local = cacheLeer(h);
      if(local){
        aplicarRespuesta(local, true);
        return null;
      }
      return analizar(false);
    }).catch(function(e){
      console.error('vendo-escaner-ia', e);
      pantallaError('No se pudo preparar la foto', 'Vuelve a tomarla, de preferencia con buena luz y de frente.', false);
    });
  }

  /* --------------------------------------------------------------- */
  /* 4) La ÚNICA llamada a la IA                                      */
  /* --------------------------------------------------------------- */
  function analizar(forzar){
    if(enVuelo){ avisar('Espera, ya se está leyendo una foto'); return Promise.resolve(); }
    if(!(window.Cloud && Cloud.sb)){
      pantallaError('Sin conexión a la nube', 'El escáner necesita tu cuenta en línea. Entra a tu cuenta e intenta de nuevo.', false);
      return Promise.resolve();
    }
    if(!Cloud.uid){
      pantallaError('Inicia sesión', 'Entra a tu cuenta para usar el escáner con IA.', false);
      return Promise.resolve();
    }
    if(!S || !S.foto){ pantallaError('Falta la foto', 'Toma una foto de tu menú para empezar.', false); return Promise.resolve(); }

    enVuelo = true;
    S.cargando = true;
    pantallaCargando(forzar ? 'Volviendo a leer la foto…' : 'Esto tarda unos segundos. No cierres la app.');

    var cuerpo = { imagen_base64: b64de(S.foto), mime: S.mime, hash: S.hash, forzar: !!forzar };
    var neg = negocio();
    if(neg) cuerpo.pista = neg;

    return Cloud.sb.functions.invoke(FUNCION, { body: cuerpo }).then(function(r){
      if(r.error) return Promise.reject(r.error);
      return r.data;
    }).then(function(data){
      enVuelo = false; S.cargando = false;
      if(!data || data.ok !== true){ pantallaError('No se pudo leer la foto', 'Intenta de nuevo en un momento.', true); return; }
      if(forzar) S.reanalisis++;
      cacheGuardar(S.hash, data);
      aplicarRespuesta(data, false);
      if(data.uso){
        if(data.uso.premium === true){ sinLimite = true; restantes = null; }
        else if(data.uso.restantes != null){
          sinLimite = false;
          restantes = Number(data.uso.restantes);
          try{ if(window.VPPremium && VPPremium.fijarRestantes) VPPremium.fijarRestantes(restantes); }catch(e){}
        }
      }
    }).catch(function(err){
      enVuelo = false; S.cargando = false;
      leerError(err).then(function(info){
        if(info.error === 'en_proceso'){
          pantallaError('Esa foto ya se está leyendo', info.message, true);
          return;
        }
        /* Se acabaron los escaneos gratis del mes: en vez de un error, se
           ofrece Premium. Con Premium activo esto no debería pasar. */
        if(info.error === 'limite_usuario'){
          restantes = 0;
          try{ if(window.VPPremium && VPPremium.fijarRestantes) VPPremium.fijarRestantes(0); }catch(e){}
          if(!premium() && ofrecerPremium()) return;
        }
        /* Un error técnico NO gasta escaneos: se vuelve a preguntar al
           servidor para que el contador que se ve sea el de verdad. */
        if(['lector','servidor','red','sin_conexion'].indexOf(info.error) >= 0) consumo();
        var reintentable = ['sin_conexion','lector','servidor','red'].indexOf(info.error) >= 0 || !info.error;
        pantallaError(
          info.error === 'limite_usuario' ? 'Llegaste a tu límite del mes'
          : info.error === 'sin_presupuesto' ? 'El escáner está en pausa'
          : info.error === 'cuenta_pausada' ? 'Tu cuenta está pausada'
          : info.error === 'limite_reanalisis' ? 'Ya no se puede volver a analizar'
          : 'No se pudo leer la foto',
          info.message,
          reintentable
        );
      });
    });
  }

  /* El mensaje claro viene en el cuerpo de la respuesta de la función */
  function leerError(err){
    var d = { error:'', message:'Revisa tu internet e intenta de nuevo.' };
    try{
      if(err && err.context && typeof err.context.json === 'function'){
        return err.context.json().then(function(b){
          return { error: String((b && b.error) || ''), message: String((b && b.message) || d.message) };
        }).catch(function(){ return d; });
      }
    }catch(e){}
    console.error('vendo-escaner-ia', err && err.message);
    return Promise.resolve(d);
  }

  function negocio(){
    try{
      var u = (typeof currentUser === 'function') ? currentUser() : null;
      var b = u && u.business;
      if(!b) return '';
      return String(b.name || b.nombre || '').slice(0, 60);
    }catch(e){ return ''; }
  }

  /* --------------------------------------------------------------- */
  /* 5) Respuesta → lista editable                                    */
  /* --------------------------------------------------------------- */
  function aplicarRespuesta(data, deCacheLocal){
    S.cache   = !!(data.cache || deCacheLocal);
    S.nota    = String(data.nota || '');
    S.legible = data.legible !== false;
    S.uso     = data.uso || null;

    var prods = Array.isArray(data.productos) ? data.productos : [];
    if(!prods.length){
      pantallaError(
        S.legible ? 'No se encontraron productos' : 'La foto no se alcanza a leer',
        S.nota || (S.legible
          ? 'Prueba con una foto más cerca, donde se vean los nombres y los precios.'
          : 'Tómala otra vez con más luz, de frente y sin sombras.'),
        true
      );
      return;
    }

    var existentes = (typeof DB !== 'undefined') ? DB.getProducts() : [];
    var mapaEx = {};
    existentes.forEach(function(p){ if(p && p.name) mapaEx[norm(p.name)] = p; });

    S.items = prods.map(function(p){
      var vars = Array.isArray(p.variantes) ? p.variantes.slice(0, 12) : [];
      var medibles = vars.length >= 2 && vars.every(function(v){
        return (typeof sizeLabelHasMeasure === 'function') ? sizeLabelHasMeasure(v.etiqueta) : false;
      });
      var yaEsta = mapaEx[norm(p.nombre)] || null;
      return {
        _id: nid(),
        nombre: String(p.nombre || ''),
        precio: Number(p.precio) || 0,
        categoria: String(p.categoria || ''),
        descripcion: String(p.descripcion || ''),
        variantes: vars.map(function(v){ return { etiqueta:String(v.etiqueta || ''), precio:Number(v.precio) || 0 }; }),
        modoVar: medibles ? 'tamanos' : 'separados',
        confianza: (p.confianza == null ? 1 : Number(p.confianza)),
        aviso: String(p.aviso || ''),
        sel: !yaEsta,              /* los que ya existen salen desmarcados */
        revisado: false,
        dupId: yaEsta ? yaEsta.id : null,
        dupPrecio: yaEsta ? Number(yaEsta.price) : null,
        dupSizes: !!(yaEsta && yaEsta.sizesOn)
      };
    });

    pantallaRevision();
  }

  function dudoso(it){
    if(it.revisado) return false;
    return (Number(it.confianza) < UMBRAL) || !!it.aviso || !(Number(it.precio) > 0);
  }
  function razon(it){
    if(it.aviso) return it.aviso;
    if(!(Number(it.precio) > 0)) return 'No se alcanza a leer el precio';
    return 'La IA no está segura de este dato';
  }

  /* --------------------------------------------------------------- */
  /* 6) Pantalla "Productos detectados"                               */
  /* --------------------------------------------------------------- */
  function catOpciones(valor){
    var cats = (typeof DB !== 'undefined') ? DB.getCategories() : [];
    var hay = null;
    var v = norm(valor);
    cats.forEach(function(c){ if(!hay && norm(c.name) === v) hay = c; });

    var out = '';
    if(valor && !hay){
      /* Sin el "(nueva)" pegado al nombre: hacía que se cortara el texto
         en el selector. Que es nueva ya lo dice la etiqueta de abajo. */
      out += '<option value="nueva:' + esc(valor) + '" selected>' + esc(valor) + '</option>';
    }
    out += '<option value=""' + (!valor ? ' selected' : '') + '>Sin categoría</option>';
    cats.forEach(function(c){
      var sel = (hay && hay.id === c.id) ? ' selected' : '';
      out += '<option value="' + esc(c.id) + '"' + sel + '>' + esc(c.name) + '</option>';
    });
    return out;
  }

  function tarjeta(it){
    var d = dudoso(it);
    var clases = 'vp-ia-card' + (d ? ' dudoso' : '') + (it.dupId ? ' dup' : '') + (it.sel ? '' : ' off');
    var h = '<div class="' + clases + '" id="c_' + it._id + '">';

    h += '<div class="vp-ia-top">' +
           '<input class="vp-ia-chk" type="checkbox" ' + (it.sel ? 'checked' : '') + ' onchange="vpIaSel(\'' + it._id + '\',this.checked)" aria-label="Incluir">' +
           '<input class="vp-ia-nombre" type="text" value="' + esc(it.nombre) + '" placeholder="Nombre del producto" oninput="vpIaSet(\'' + it._id + '\',\'nombre\',this.value)">' +
           '<button class="vp-ia-del" onclick="vpIaQuitar(\'' + it._id + '\')" aria-label="Quitar">' + ico('trash') + '</button>' +
         '</div>';

    h += '<div id="a_' + it._id + '">' + avisoHTML(it) + '</div>';
    h += '<div id="d_' + it._id + '">' + dupHTML(it) + '</div>';

    h += '<div class="vp-ia-grid">';
    h +=   '<div class="vp-ia-f' + (Number(it.precio) > 0 ? '' : ' mal') + '" id="p_' + it._id + '">' +
             '<label>Precio' + (it.variantes.length ? ' (el más bajo)' : '') + '</label>' +
             '<input type="number" inputmode="decimal" step="0.01" min="0" value="' + (Number(it.precio) || '') + '" ' +
               (it.variantes.length ? 'disabled ' : '') +
               'oninput="vpIaSet(\'' + it._id + '\',\'precio\',this.value)">' +
           '</div>';
    h +=   '<div class="vp-ia-f">' +
             '<label>Categoría</label>' +
             '<select onchange="vpIaSet(\'' + it._id + '\',\'categoria\',this.value)">' + catOpciones(it.categoria) + '</select>' +
           '</div>';
    h += '</div>';

    /* La descripción va cerrada: con 30 productos en pantalla, un cuadro
       de texto vacío por cada uno era puro ruido. Se abre si la IA leyó
       algo o si el dueño toca "Agregar descripción". */
    h += '<div id="x_' + it._id + '">' + descHTML(it) + '</div>';

    if(it.variantes.length){
      h += '<div class="vp-ia-var"><label>Tamaños o presentaciones</label>';
      it.variantes.forEach(function(v, i){
        h += '<div class="vp-ia-vrow">' +
               '<input class="et" type="text" value="' + esc(v.etiqueta) + '" aria-label="Tamaño" oninput="vpIaVar(\'' + it._id + '\',' + i + ',\'etiqueta\',this.value)">' +
               '<input class="pr" type="number" inputmode="decimal" step="0.01" min="0" value="' + (Number(v.precio) || '') + '" aria-label="Precio del tamaño" oninput="vpIaVar(\'' + it._id + '\',' + i + ',\'precio\',this.value)">' +
             '</div>';
      });
      h += '<select onchange="vpIaSet(\'' + it._id + '\',\'modoVar\',this.value)">' +
             '<option value="separados"' + (it.modoVar === 'separados' ? ' selected' : '') + '>Guardar por separado</option>' +
             '<option value="tamanos"' + (it.modoVar === 'tamanos' ? ' selected' : '') + '>Un producto con tamaños</option>' +
           '</select>';
      h += '</div>';
    }

    h += '<div class="vp-ia-tags" id="t_' + it._id + '">' + tagsHTML(it) + '</div>';

    h += '</div>';
    return h;
  }

  function descHTML(it){
    if(!it.verDesc && !String(it.descripcion).trim()){
      return '<button class="vp-ia-mas" onclick="vpIaDesc(\'' + it._id + '\')">' + ico('plus') + ' Agregar descripción</button>';
    }
    return '<div class="vp-ia-f" style="margin-top:11px;">' +
             '<label>Descripción</label>' +
             '<textarea rows="2" maxlength="160" placeholder="Lo que lleva el platillo" oninput="vpIaSet(\'' + it._id + '\',\'descripcion\',this.value)">' + esc(it.descripcion) + '</textarea>' +
           '</div>';
  }

  /* --- Trozos que se repintan solos, sin reconstruir toda la tarjeta --- */
  function avisoHTML(it){
    if(!dudoso(it)) return '';
    return '<div class="vp-ia-aviso">' + ico('alert') +
             '<p>' + esc(razon(it)) + '</p>' +
             '<button onclick="vpIaOk(\'' + it._id + '\')">Está bien</button>' +
           '</div>';
  }
  /* Ya lo tienes en el inventario: no se toca a menos que tú lo marques.
     Dejarlo marcado ES el permiso para cambiarle el precio. Nada más. */
  function dupHTML(it){
    if(!it.dupId) return '';
    return '<div class="vp-ia-aviso gris">' + ico('alert') +
             '<p>Ya lo tienes a $' + (it.dupPrecio == null ? '?' : it.dupPrecio) + '. ' +
             (it.dupSizes
               ? 'Se vende por tamaños, así que no se le cambia nada.'
               : 'Si lo dejas marcado, solo le cambia el precio a $' + (Number(it.precio) || '?') + '.') +
             '</p></div>';
  }
  function tagsHTML(it){
    var t = '';
    if(it.categoria && !categoriaExiste(it.categoria)) t += '<span class="vp-ia-tag">Categoría nueva</span>';
    return t;
  }
  function pintar(prefijo, it, html){
    var el = document.getElementById(prefijo + '_' + it._id);
    if(el) el.innerHTML = html;
  }
  function pintarTarjeta(it){
    pintar('a', it, avisoHTML(it));
    pintar('d', it, dupHTML(it));
    pintar('t', it, tagsHTML(it));
    var c = document.getElementById('c_' + it._id);
    if(c){
      c.classList.toggle('dudoso', dudoso(it));
      c.classList.toggle('off', !it.sel);
    }
  }
  /* Abre el cuadro de la descripción y deja el cursor dentro */
  function abrirDesc(id){
    var it = buscar(id); if(!it) return;
    it.verDesc = true;
    pintar('x', it, descHTML(it));
    var ta = document.querySelector('#x_' + id + ' textarea');
    if(ta) ta.focus();
  }

  function categoriaExiste(nombre){
    if(!nombre) return true;
    var v = norm(String(nombre).replace(/^nueva:/, ''));
    var cats = (typeof DB !== 'undefined') ? DB.getCategories() : [];
    return cats.some(function(c){ return norm(c.name) === v || c.id === nombre; });
  }

  function cuentas(){
    var sel = S.items.filter(function(i){ return i.sel; }).length;
    /* "Por revisar" cuenta TODOS los que traen aviso, no solo los
       marcados: así el número coincide con los avisos que se ven. */
    var pend = S.items.filter(dudoso).length;
    return { total:S.items.length, sel:sel, pend:pend };
  }

  function pantallaRevision(){
    estilos();
    var c = cuentas();
    var h =
      '<div class="sheet-header">' +
        '<h2>Productos detectados</h2>' +
        '<button class="sheet-close" onclick="vpIaCerrar()">' + ico('close') + '</button>' +
      '</div>';

    /* Todo lo que se desplaza va dentro de .vp-ia-scroll. La barra de
       botones queda fuera, abajo: así no se encima con la lista ni deja
       hueco al final (el error que se veía en Android y en iPhone). */
    h += '<div class="vp-ia-scroll">';

    h += '<div class="vp-ia-count" id="vpIaCount">' +
           '<div><b>' + c.total + '</b><span>Detectados</span></div>' +
           '<div><b>' + c.sel + '</b><span>Elegidos</span></div>' +
           /* Este sí es botón: lleva al siguiente producto con aviso */
           '<button type="button" class="' + (c.pend ? 'on' : '') + '" onclick="vpIaIrPendiente()">' +
             '<b>' + c.pend + '</b><span>Por revisar</span>' +
           '</button>' +
         '</div>';

    if(S.cache){
      h += '<div class="alert-card" style="margin-bottom:12px;">' +
             '<span class="alert-ico">' + ico('check') + '</span>' +
             '<span class="alert-txt">' +
               '<span class="alert-title">Esta foto ya se había leído</span>' +
               '<span class="alert-sub">Se usó el resultado guardado, sin gastar un escaneo nuevo.</span>' +
             '</span>' +
           '</div>';
    }
    if(S.nota){
      h += '<div class="alert-card" style="margin-bottom:12px;">' +
             '<span class="alert-ico">' + ico('alert') + '</span>' +
             '<span class="alert-txt"><span class="alert-title">Revisa esto</span><span class="alert-sub">' + esc(S.nota) + '</span></span>' +
           '</div>';
    }

    h += '<button class="btn ghost block" style="margin-bottom:12px;" onclick="vpIaVerFoto()">' + ico('eye') + ' ' +
         (S.verFoto ? 'Ocultar la foto' : 'Ver la foto original') + '</button>';
    if(S.verFoto && S.foto) h += '<img class="vp-ia-foto" src="' + S.foto + '" alt="Foto original">';

    h += '<div id="vpIaLista">' + S.items.map(tarjeta).join('') + '</div>';

    h += '</div>';   /* cierra .vp-ia-scroll */

    h += '<div class="vp-ia-bar">' +
           '<button class="btn primary xl block" onclick="vpIaGuardar()">Agregar al inventario</button>' +
           /* Sin icono de cámara: no abre la cámara, vuelve a mandar la misma foto */
           '<button class="btn ghost block" onclick="vpIaOtraVez()">Volver a analizar la foto</button>' +
           '<p class="vp-ia-nota">Corregir, quitar o elegir productos no gasta nada.<br>Solo “Volver a analizar” usa otro escaneo.</p>' +
         '</div>';

    openModal(h, { dismissible:true });

    /* La hoja se vuelve columna: cabecera, lista con scroll y barra fija */
    var sh = document.querySelector('#modalOverlay .modal-sheet');
    if(sh) sh.classList.add('vp-ia-sheet');
  }

  /* Se refrescan solo los contadores: así no se pierde el cursor al escribir */
  function refrescarCuentas(){
    var c = cuentas();
    var box = document.getElementById('vpIaCount');
    if(!box) return;
    /* El tercero es un <button>, no un <div>: se toman los hijos tal cual */
    var d = box.children;
    if(d[0]) d[0].querySelector('b').textContent = c.total;
    if(d[1]) d[1].querySelector('b').textContent = c.sel;
    if(d[2]){ d[2].className = c.pend ? 'on' : ''; d[2].querySelector('b').textContent = c.pend; }
  }

  /* --------------------------------------------------------------- */
  /* 7) Correcciones a mano · NO gastan tokens                        */
  /* --------------------------------------------------------------- */
  function buscar(id){
    for(var i = 0; i < S.items.length; i++) if(S.items[i]._id === id) return S.items[i];
    return null;
  }

  function set(id, campo, valor){
    var it = buscar(id); if(!it) return;
    if(campo === 'precio'){
      var n = parseFloat(valor);
      it.precio = (isFinite(n) && n >= 0) ? r2(n) : 0;
      var f = document.getElementById('p_' + id);
      if(f) f.className = 'vp-ia-f' + (it.precio > 0 ? '' : ' mal');
      pintarTarjeta(it);
      refrescarCuentas();
      return;
    }
    if(campo === 'nombre'){
      it.nombre = String(valor).slice(0, 80);
      var ex = (typeof DB !== 'undefined') ? DB.getProducts() : [];
      var v = norm(it.nombre);
      it.dupId = null; it.dupPrecio = null; it.dupSizes = false;
      for(var i = 0; i < ex.length; i++){
        if(ex[i] && norm(ex[i].name) === v){
          it.dupId = ex[i].id; it.dupPrecio = Number(ex[i].price); it.dupSizes = !!ex[i].sizesOn; break;
        }
      }
      pintarTarjeta(it);
      return;
    }
    if(campo === 'categoria'){ it.categoria = String(valor || ''); pintarTarjeta(it); return; }
    if(campo === 'descripcion'){ it.descripcion = String(valor).slice(0, 160); return; }
    if(campo === 'modoVar'){ it.modoVar = (valor === 'tamanos') ? 'tamanos' : 'separados'; return; }
  }

  function setVar(id, i, campo, valor){
    var it = buscar(id); if(!it || !it.variantes[i]) return;
    if(campo === 'precio'){
      var n = parseFloat(valor);
      it.variantes[i].precio = (isFinite(n) && n >= 0) ? r2(n) : 0;
      var vivos = it.variantes.filter(function(v){ return v.precio > 0; });
      it.precio = vivos.length ? Math.min.apply(null, vivos.map(function(v){ return v.precio; })) : 0;
      var pf = document.getElementById('p_' + id);
      if(pf){ var inp = pf.querySelector('input'); if(inp) inp.value = it.precio || ''; pf.className = 'vp-ia-f' + (it.precio > 0 ? '' : ' mal'); }
      pintarTarjeta(it);
      refrescarCuentas();
      return;
    }
    it.variantes[i].etiqueta = String(valor).slice(0, 40);
  }

  function sel(id, on){
    var it = buscar(id); if(!it) return;
    it.sel = !!on;
    pintarTarjeta(it);
    refrescarCuentas();
  }

  function marcarOk(id){
    var it = buscar(id); if(!it) return;
    it.revisado = true; it.aviso = '';
    pintarTarjeta(it); refrescarCuentas();
  }

  function quitar(id){
    S.items = S.items.filter(function(i){ return i._id !== id; });
    var el = document.getElementById('c_' + id);
    if(el) el.remove();
    refrescarCuentas();
    if(!S.items.length) pantallaError('Ya no queda ningún producto', 'Toma otra foto para volver a intentarlo.', false);
  }

  function verFoto(){ S.verFoto = !S.verFoto; pantallaRevision(); }

  /* Toca "Por revisar" y te lleva al siguiente producto con aviso.
     Si vuelves a tocar, al que sigue, y al final regresa al primero. */
  var ultimoPend = -1;
  function irPendiente(){
    var pend = [];
    S.items.forEach(function(it, i){ if(dudoso(it)) pend.push(i); });
    if(!pend.length){
      avisar('No queda nada por revisar', { icon:ico('check'), variant:'toast-success' });
      return;
    }
    var sig = pend.find(function(i){ return i > ultimoPend; });
    if(sig === undefined) sig = pend[0];
    ultimoPend = sig;

    var card = document.getElementById('c_' + S.items[sig]._id);
    var caja = document.querySelector('.vp-ia-scroll');
    if(!card || !caja) return;
    /* Se deja un respiro arriba para que no quede pegado al borde */
    caja.scrollTo({ top: Math.max(0, card.offsetTop - 12), behavior: prefiereQuieto() ? 'auto' : 'smooth' });
    card.classList.remove('vp-ia-salta');
    void card.offsetWidth;                 /* reinicia la animación */
    card.classList.add('vp-ia-salta');
    setTimeout(function(){ card.classList.remove('vp-ia-salta'); }, 1300);
  }
  function prefiereQuieto(){
    try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; }
  }

  /* Lo único que vuelve a gastar IA, y con límite del servidor */
  function otraVez(){
    if(typeof askConfirm !== 'function'){ analizar(true); return; }
    askConfirm({
      title:'¿Volver a analizar la foto?',
      text:'Esto usa otro escaneo y reemplaza lo que ves ahora. Si solo quieres corregir un nombre o un precio, hazlo directo en la lista: eso no gasta nada.',
      ok:'Volver a analizar', icon:ico('camera')
    }, function(){
      cacheBorrar(S.hash);
      analizar(true);
    });
  }

  function reintentar(){
    if(!S || !S.foto){ pantallaInicio(); return; }
    analizar(false);
  }

  function cerrar(){
    if(typeof closeModal === 'function') closeModal();
    S = null;
  }

  /* --------------------------------------------------------------- */
  /* 8) Guardar en el inventario (misma estructura de VendoPlus)      */
  /* --------------------------------------------------------------- */
  /* Colores para las categorías que crea el escáner: pastel, pero de
     familias distintas (rosa, vainilla, menta, lavanda, durazno, cielo…)
     para que dos categorías seguidas no se parezcan. El color sale del
     nombre, así que "Bebidas" siempre queda del mismo tono, y se evita
     repetir uno que ya esté en uso. */
  var CREMAS = [
    '#E8A0B4',  /* rosa      */
    '#E6C77D',  /* vainilla  */
    '#8FCFB4',  /* menta     */
    '#B1A5D8',  /* lavanda   */
    '#EFA98A',  /* durazno   */
    '#8FBEDC',  /* cielo     */
    '#D4A3C8',  /* lila      */
    '#B9CE8E',  /* pistache  */
    '#E59A8E',  /* coral     */
    '#D9BC94'   /* arena     */
  ];
  function colorCrema(nombre, cats){
    var h = 0, s = String(nombre || '');
    for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var usados = {};
    (cats || []).forEach(function(c){ if(c && c.color) usados[String(c.color).toUpperCase()] = 1; });
    for(var k = 0; k < CREMAS.length; k++){
      var c = CREMAS[(h + k) % CREMAS.length];
      if(!usados[c]) return c;
    }
    return CREMAS[h % CREMAS.length];
  }

  function unidadDe(etiquetas){
    var t = etiquetas.join(' ').toLowerCase();
    if(/\bkilo|kgs?\b|\bgramos?\b|\bgr?\b/.test(t)) return 'kilo';
    if(/\bmetros?|mts?\b|\bcm\b|centimetro/.test(t)) return 'metro';
    return 'litro';
  }

  function guardar(){
    if(typeof requirePerm === 'function' && !requirePerm('gestionarProductos', 'No tienes permiso para administrar productos')) return;

    var elegidos = S.items.filter(function(i){ return i.sel; });
    if(!elegidos.length){ avisar('Elige al menos un producto', { variant:'toast-danger', icon:ico('close') }); return; }

    /* ---- Validación (sin IA) ---- */
    var sinNombre = elegidos.filter(function(i){ return !String(i.nombre).trim(); });
    if(sinNombre.length){
      avisar('Hay ' + sinNombre.length + ' producto(s) sin nombre', { variant:'toast-danger', icon:ico('close'), subtitle:'Escríbeles un nombre o quítalos de la lista', duration:3400 });
      return;
    }
    var sinPrecio = elegidos.filter(function(i){ return !(Number(i.precio) > 0); });
    if(sinPrecio.length){
      avisar('Hay ' + sinPrecio.length + ' producto(s) sin precio', { variant:'toast-danger', icon:ico('alert'), subtitle:'Escribe el precio de venta o quítalos de la lista', duration:3400 });
      return;
    }
    /* Los duplicados que el dueño dejó marcados: marcarlos ES la
       autorización para cambiarles el precio. No hay otra ventana. */
    var pend = elegidos.filter(dudoso).length;

    if(pend){
      askConfirm({
        title:'¿Agregar con ' + pend + ' aviso' + (pend === 1 ? '' : 's') + ' sin revisar?',
        text:'Puedes corregirlos ahora en la lista (corregir no gasta nada) o agregarlos así y arreglarlos después.',
        ok:'Agregarlos así', cancel:'Seguir revisando', icon:ico('alert')
      }, function(){ aplicar(elegidos); });
      return;
    }

    aplicar(elegidos);
  }

  function aplicar(elegidos){
    var cats = DB.getCategories();
    var prods = DB.getProducts();
    var ahora = new Date().toISOString();
    var nuevasCats = 0, agregados = 0, actualizados = 0;

    /* Reutiliza las categorías que ya tiene; crea solo las que falten */
    function catId(valor){
      if(!valor) return UNCATEGORIZED.id;
      var nombre = String(valor).replace(/^nueva:/, '').trim();
      if(!nombre) return UNCATEGORIZED.id;
      var directa = cats.filter(function(c){ return c.id === valor; })[0];
      if(directa) return directa.id;
      var v = norm(nombre);
      var hay = cats.filter(function(c){ return norm(c.name) === v; })[0];
      if(hay) return hay.id;
      var nueva = { id:'cat' + Date.now() + Math.floor(Math.random() * 1000), name:nombre.slice(0, 40), emoji:'', color:colorCrema(nombre, cats) };
      cats.push(nueva); nuevasCats++;
      return nueva.id;
    }

    /* La descripción va en "description", que es el campo que YA usa
       VendoPlus: el formulario del producto trae el recuadro "Descripción
       breve del producto", el Menú Digital la muestra debajo del nombre,
       el buscador la toma en cuenta y sale en el respaldo en CSV.
       El tope de 160 letras es el mismo de ese recuadro. */
    var GUARDAR_DESC = true;

    function base(nombre, precio, categoria, descripcion){
      return {
        id: (typeof uid === 'function') ? uid('p') : ('p' + Date.now() + Math.floor(Math.random() * 1000)),
        name: String(nombre).trim().slice(0, 80),
        price: r2(precio),
        cost: null,                 /* no se inventa el costo */
        category: categoria,
        active: true,
        image: null,                /* no se inventa la foto */
        stock: null,                /* no se inventan existencias */
        minStock: 2,
        sizesOn: false,
        sizeUnit: 'litro',
        sizes: [],
        unit: 'pieza',
        sku: null,                  /* no se inventa el código de barras */
        wholesalePrice: null,
        wholesaleMin: null,
        description: (GUARDAR_DESC && String(descripcion || '').trim()) ? String(descripcion).trim().slice(0, 160) : '',
        createdAt: ahora,
        updatedAt: ahora
      };
    }

    elegidos.forEach(function(it){
      var cid = catId(it.categoria);
      var vars = it.variantes.filter(function(v){ return String(v.etiqueta).trim() && Number(v.precio) > 0; });

      /* Ya existe: el dueño lo dejó marcado, así que se le actualiza SOLO
         el precio. No se le toca categoría, costo, existencias ni foto. */
      if(it.dupId){
        var p = prods.filter(function(x){ return x.id === it.dupId; })[0];
        if(!p) return;
        if(p.sizesOn) return;                     /* se vende por tamaños: no se toca */
        if(r2(p.price) === r2(it.precio)) return; /* ya tenía ese precio */
        p.price = r2(it.precio); p.updatedAt = ahora; actualizados++;
        return;
      }

      if(vars.length >= 2 && it.modoVar === 'tamanos'){
        var nuevo = base(it.nombre, Math.min.apply(null, vars.map(function(v){ return v.precio; })), cid, it.descripcion);
        nuevo.sizesOn  = true;
        nuevo.sizeUnit = unidadDe(vars.map(function(v){ return v.etiqueta; }));
        nuevo.sizes    = vars.map(function(v, i){
          return {
            id: 'sz' + Date.now() + i + Math.floor(Math.random() * 1000),
            label: String(v.etiqueta).trim().slice(0, 40),
            price: r2(v.precio),
            cost: null,
            unitQty: (typeof parseSizeQty === 'function') ? parseSizeQty(v.etiqueta) : 1
          };
        });
        prods.push(nuevo); agregados++;
        return;
      }

      if(vars.length >= 2){
        /* Productos separados: "Pizza (Chica)", "Pizza (Grande)"… */
        vars.forEach(function(v){
          var nom = String(it.nombre).trim() + ' (' + String(v.etiqueta).trim() + ')';
          if(prods.some(function(x){ return norm(x.name) === norm(nom); })) return;
          prods.push(base(nom, v.precio, cid, it.descripcion)); agregados++;
        });
        return;
      }

      prods.push(base(it.nombre, it.precio, cid, it.descripcion)); agregados++;
    });

    if(!agregados && !actualizados){
      avisar('No había nada nuevo que agregar', { icon:ico('alert') });
      cerrar();
      return;
    }

    if(nuevasCats) DB.saveCategories(cats);
    if(typeof invContext === 'function') invContext({ type:'ajuste', note:'Escáner de productos con IA' });
    DB.saveProducts(prods);
    if(typeof invContext === 'function') invContext(null);
    if(typeof dismissDemoHint === 'function') dismissDemoHint();

    cerrar();

    var sub = [];
    if(actualizados) sub.push(actualizados + ' precio' + (actualizados === 1 ? '' : 's') + ' actualizado' + (actualizados === 1 ? '' : 's'));
    if(nuevasCats)   sub.push(nuevasCats + ' categoría' + (nuevasCats === 1 ? '' : 's') + ' nueva' + (nuevasCats === 1 ? '' : 's'));
    sub.push('Revisa costos y existencias cuando quieras');

    avisar(agregados ? ('Se agregaron ' + agregados + ' producto' + (agregados === 1 ? '' : 's')) : 'Inventario actualizado',
           { variant:'toast-success', icon:ico('check'), subtitle:sub.join(' · '), duration:3600 });

    if(typeof render === 'function') render();
    else if(typeof renderBackgroundIfProducts === 'function') renderBackgroundIfProducts();
  }

  /* --------------------------------------------------------------- */
  /* Puente con los onclick de la pantalla                            */
  /* --------------------------------------------------------------- */
  window.vpIaAbrir      = abrir;
  /** El aviso de "contrata Premium" abre la MISMA pantalla de pago que el
      resto de la app (Menú Digital, chat, estadísticas). */
  window.vpIaPremium    = function(){ ofrecerPremium(); };
  /** Para que vendo-premium.js pueda avisar un contador nuevo sin volver
      a preguntarle al servidor. */
  window.vpIaFijarRestantes = function(n){
    if(n == null) return;
    sinLimite = !isFinite(n);
    restantes = sinLimite ? null : Number(n);
    if(enInicio && document.getElementById('vpIaInicio')) pantallaInicio();
  };
  window.vpIaCerrar     = cerrar;
  window.vpIaFoto       = fotoElegida;
  window.vpIaSet        = set;
  window.vpIaVar        = setVar;
  window.vpIaSel        = sel;
  window.vpIaOk         = marcarOk;
  window.vpIaDesc       = abrirDesc;
  window.vpIaQuitar     = quitar;
  window.vpIaVerFoto    = verFoto;
  window.vpIaIrPendiente = irPendiente;
  window.vpIaOtraVez    = otraVez;
  window.vpIaReintentar = reintentar;
  window.vpIaGuardar    = guardar;
})();
