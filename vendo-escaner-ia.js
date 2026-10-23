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
      '.vp-ia-intro{text-align:center;padding:4px 2px 2px;}',
      '.vp-ia-intro p{font-size:13.5px;color:var(--ink-soft);font-weight:500;margin:0 0 16px;line-height:1.5;}',
      '.vp-ia-tips{background:var(--surface-alt);border-radius:var(--radius-card);padding:12px 14px;margin:0 0 16px;text-align:left;}',
      '.vp-ia-tips li{font-size:12.5px;color:var(--ink-soft);font-weight:600;margin:4px 0;line-height:1.45;}',
      '.vp-ia-count{display:flex;gap:8px;margin:2px 0 14px;}',
      '.vp-ia-count>div{flex:1;background:var(--surface-alt);border-radius:var(--radius-btn);padding:9px 10px;text-align:center;}',
      '.vp-ia-count b{display:block;font-size:17px;color:var(--ink);line-height:1.2;}',
      '.vp-ia-count span{font-size:10.5px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.3px;}',
      '.vp-ia-count.warn>div.on{background:var(--danger-bg);}',
      '.vp-ia-count.warn>div.on b{color:var(--accent-2);}',
      '.vp-ia-foto{width:100%;border-radius:var(--radius-card);border:1px solid var(--border);display:block;margin:0 0 14px;}',
      '.vp-ia-card{border:1px solid var(--border);background:var(--surface);border-radius:var(--radius-card);padding:12px;margin-bottom:10px;}',
      '.vp-ia-card.off{opacity:.5;}',
      '.vp-ia-card.dudoso{border-color:var(--accent-strong);background:var(--accent-soft);}',
      '.vp-ia-card.dup{border-color:var(--ink-faint);}',
      '.vp-ia-top{display:flex;align-items:center;gap:10px;margin-bottom:8px;}',
      '.vp-ia-chk{width:22px;height:22px;flex-shrink:0;accent-color:var(--whatsapp);}',
      '.vp-ia-top input.vp-ia-nombre{flex:1;min-width:0;font-size:14.5px;font-weight:700;color:var(--ink);border:1.5px solid transparent;background:transparent;border-radius:8px;padding:6px 7px;}',
      '.vp-ia-top input.vp-ia-nombre:focus{border-color:var(--whatsapp);background:var(--surface);outline:none;}',
      '.vp-ia-del{background:var(--surface-alt);border:none;width:30px;height:30px;border-radius:50%;color:var(--ink-soft);flex-shrink:0;display:flex;align-items:center;justify-content:center;}',
      '.vp-ia-del svg{width:15px;height:15px;}',
      '.vp-ia-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
      '.vp-ia-f label{display:block;font-size:11px;font-weight:700;color:var(--ink-soft);margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px;}',
      '.vp-ia-f input,.vp-ia-f select,.vp-ia-f textarea{width:100%;border:1.5px solid var(--border);background:var(--surface);color:var(--ink);border-radius:10px;padding:9px 10px;font-size:13.5px;font-weight:600;font-family:inherit;}',
      '.vp-ia-f input:focus,.vp-ia-f select:focus,.vp-ia-f textarea:focus{border-color:var(--whatsapp);outline:none;}',
      '.vp-ia-f.full{grid-column:1 / -1;}',
      '.vp-ia-f textarea{resize:vertical;min-height:38px;}',
      '.vp-ia-f.mal input{border-color:var(--accent-2);background:var(--danger-bg);}',
      '.vp-ia-aviso{display:flex;gap:8px;align-items:flex-start;background:var(--surface);border:1px solid var(--accent-strong);border-radius:10px;padding:8px 10px;margin-bottom:9px;}',
      '.vp-ia-aviso svg{width:15px;height:15px;color:var(--accent-strong);flex-shrink:0;margin-top:1px;}',
      '.vp-ia-aviso span{font-size:12px;font-weight:600;color:var(--ink);line-height:1.4;}',
      '.vp-ia-aviso button{margin-left:auto;background:none;border:none;color:var(--ink-soft);font-size:11.5px;font-weight:700;white-space:nowrap;padding:0 0 0 6px;}',
      '.vp-ia-tag{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:999px;background:var(--surface-alt);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.3px;}',
      '.vp-ia-tag.nueva{background:var(--success-bg);color:var(--whatsapp-ink);}',
      '.vp-ia-tag.dup{background:var(--danger-bg);color:var(--accent-2);}',
      '.vp-ia-tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;}',
      '.vp-ia-var{margin-top:9px;background:var(--surface-alt);border-radius:10px;padding:9px 10px;}',
      '.vp-ia-var .vl{font-size:11px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px;}',
      '.vp-ia-var .vrow{display:flex;gap:6px;margin-bottom:5px;}',
      '.vp-ia-var .vrow input{border:1.5px solid var(--border);background:var(--surface);border-radius:8px;padding:7px 9px;font-size:12.5px;font-weight:600;color:var(--ink);min-width:0;font-family:inherit;}',
      '.vp-ia-var .vrow input.vl2{flex:1;}',
      '.vp-ia-var .vrow input.vp2{width:92px;}',
      '.vp-ia-var select{width:100%;border:1.5px solid var(--border);background:var(--surface);border-radius:8px;padding:7px 9px;font-size:12.5px;font-weight:600;color:var(--ink);margin-top:3px;font-family:inherit;}',
      '.vp-ia-bar{position:sticky;bottom:0;background:var(--surface);padding:12px 0 2px;margin-top:4px;border-top:1px solid var(--border);}',
      '.vp-ia-sub{font-size:11.5px;color:var(--ink-soft);font-weight:600;text-align:center;margin:8px 0 0;line-height:1.45;}',
      '.vp-ia-load{text-align:center;padding:30px 10px;}',
      '.vp-ia-spin{width:38px;height:38px;border:3px solid var(--border);border-top-color:var(--whatsapp);border-radius:50%;margin:0 auto 16px;animation:vpIaSpin .8s linear infinite;}',
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
  function botonHTML(){
    return '<button class="btn ghost" onclick="vpIaAbrir()">' + ico('camera') + ' Escanear con IA</button>';
  }
  function instalarBoton(){
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
      return html.slice(0, fin) + botonHTML() + html.slice(fin);
    };
    envuelto.__vpIa = true;
    window.renderProducts = envuelto;
    return true;
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
  function abrir(){
    if(typeof requirePerm === 'function' && !requirePerm('gestionarProductos', 'No tienes permiso para administrar productos')) return;
    estilos();
    S = nuevoEstado();
    pantallaInicio();
    consumo();
  }

  var restantes = null;
  function consumo(){
    try{
      if(!(window.Cloud && Cloud.sb && Cloud.uid)) return;
      Cloud.sb.rpc('vp_ia_mi_consumo').then(function(r){
        var d = r && r.data;
        if(d && d.ok){
          restantes = d.restantes;
          var el = document.getElementById('vpIaRestantes');
          if(el) el.textContent = 'Te quedan ' + d.restantes + ' escaneos este mes.';
        }
      }).catch(function(){});
    }catch(e){}
  }

  function pantallaInicio(){
    var html =
      '<div class="sheet-header">' +
        '<h2>Escanear productos con IA</h2>' +
        '<button class="sheet-close" onclick="vpIaCerrar()">' + ico('close') + '</button>' +
      '</div>' +
      '<div class="vp-ia-intro">' +
        '<p>Toma una foto de tu menú, tu carta o tu lista de precios. La IA saca los nombres y los precios, y tú los revisas antes de guardarlos.</p>' +
        '<ul class="vp-ia-tips">' +
          '<li>• Que se lea bien: con luz, de frente y sin sombras.</li>' +
          '<li>• Una hoja a la vez. Si el menú es muy largo, tómale foto por partes.</li>' +
          '<li>• Nada se guarda hasta que tú lo confirmes.</li>' +
        '</ul>' +
        '<button class="btn primary xl block" onclick="document.getElementById(\'vpIaFile\').click()">' + ico('camera') + ' Tomar foto o elegir una</button>' +
        '<input id="vpIaFile" type="file" accept="image/*" capture="environment" style="display:none" onchange="vpIaFoto(this)">' +
        '<p class="vp-ia-sub" id="vpIaRestantes">' + (restantes == null ? 'Se usa un escaneo por foto nueva.' : 'Te quedan ' + restantes + ' escaneos este mes.') + '</p>' +
      '</div>';
    openModal(html, { dismissible:true });
  }

  function pantallaCargando(txt){
    var html =
      '<div class="sheet-header">' +
        '<h2>Leyendo la foto…</h2>' +
      '</div>' +
      '<div class="vp-ia-load">' +
        '<div class="vp-ia-spin"></div>' +
        '<p class="vp-ia-sub">' + esc(txt || 'Esto tarda unos segundos. No cierres la app.') + '</p>' +
      '</div>';
    openModal(html, { dismissible:false, grip:false });
  }

  function pantallaError(titulo, texto, reintentar){
    var html =
      '<div class="sheet-header">' +
        '<h2>' + esc(titulo) + '</h2>' +
        '<button class="sheet-close" onclick="vpIaCerrar()">' + ico('close') + '</button>' +
      '</div>' +
      '<div class="vp-ia-intro">' +
        (S && S.foto ? '<img class="vp-ia-foto" src="' + S.foto + '" alt="">' : '') +
        '<p>' + esc(texto) + '</p>' +
        (reintentar
          ? '<button class="btn primary block" onclick="vpIaReintentar()">' + ico('camera') + ' Intentar de nuevo</button>'
          : '') +
        '<button class="btn ghost block" style="margin-top:8px;" onclick="document.getElementById(\'vpIaFile2\').click()">Elegir otra foto</button>' +
        '<input id="vpIaFile2" type="file" accept="image/*" capture="environment" style="display:none" onchange="vpIaFoto(this)">' +
      '</div>';
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
      restantes = (data.uso && data.uso.restantes != null) ? data.uso.restantes : restantes;
    }).catch(function(err){
      enVuelo = false; S.cargando = false;
      leerError(err).then(function(info){
        if(info.error === 'en_proceso'){
          pantallaError('Esa foto ya se está leyendo', info.message, true);
          return;
        }
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
      out += '<option value="nueva:' + esc(valor) + '" selected>' + esc(valor) + ' (nueva)</option>';
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
    h +=   '<div class="vp-ia-f full">' +
             '<label>Descripción</label>' +
             '<textarea rows="1" placeholder="Opcional" oninput="vpIaSet(\'' + it._id + '\',\'descripcion\',this.value)">' + esc(it.descripcion) + '</textarea>' +
           '</div>';
    h += '</div>';

    if(it.variantes.length){
      h += '<div class="vp-ia-var"><div class="vl">Tamaños o presentaciones</div>';
      it.variantes.forEach(function(v, i){
        h += '<div class="vrow">' +
               '<input class="vl2" type="text" value="' + esc(v.etiqueta) + '" oninput="vpIaVar(\'' + it._id + '\',' + i + ',\'etiqueta\',this.value)">' +
               '<input class="vp2" type="number" inputmode="decimal" step="0.01" min="0" value="' + (Number(v.precio) || '') + '" oninput="vpIaVar(\'' + it._id + '\',' + i + ',\'precio\',this.value)">' +
             '</div>';
      });
      h += '<select onchange="vpIaSet(\'' + it._id + '\',\'modoVar\',this.value)">' +
             '<option value="separados"' + (it.modoVar === 'separados' ? ' selected' : '') + '>Guardar como productos separados</option>' +
             '<option value="tamanos"' + (it.modoVar === 'tamanos' ? ' selected' : '') + '>Guardar como tamaños del mismo producto</option>' +
           '</select>';
      h += '</div>';
    }

    h += '<div class="vp-ia-tags" id="t_' + it._id + '">' + tagsHTML(it) + '</div>';

    h += '</div>';
    return h;
  }

  /* --- Trozos que se repintan solos, sin reconstruir toda la tarjeta --- */
  function avisoHTML(it){
    if(!dudoso(it)) return '';
    return '<div class="vp-ia-aviso">' + ico('alert') +
             '<span>' + esc(razon(it)) + '</span>' +
             '<button onclick="vpIaOk(\'' + it._id + '\')">Ya lo revisé</button>' +
           '</div>';
  }
  /* Ya lo tienes en el inventario: no se toca a menos que tú lo marques.
     Dejarlo marcado ES el permiso para cambiarle el precio. Nada más. */
  function dupHTML(it){
    if(!it.dupId) return '';
    return '<div class="vp-ia-aviso">' + ico('alert') +
             '<span>Ya tienes <b>' + esc(it.nombre) + '</b> a $' + (it.dupPrecio == null ? '?' : it.dupPrecio) + '.' +
             (it.dupSizes
               ? ' Se vende por tamaños, así que no se le cambia nada.'
               : ' Si lo dejas marcado, solo se le actualiza el precio a $' + (Number(it.precio) || '?') + '.') +
             '</span></div>';
  }
  function tagsHTML(it){
    var t = '';
    if(it.dupId) t += '<span class="vp-ia-tag dup">Ya existe</span>';
    if(it.categoria && !categoriaExiste(it.categoria)) t += '<span class="vp-ia-tag nueva">Categoría nueva</span>';
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
      c.classList.toggle('dup', !!it.dupId);
      c.classList.toggle('off', !it.sel);
    }
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

    h += '<div class="vp-ia-count' + (c.pend ? ' warn' : '') + '" id="vpIaCount">' +
           '<div><b>' + c.total + '</b><span>Detectados</span></div>' +
           '<div><b>' + c.sel + '</b><span>Elegidos</span></div>' +
           '<div class="' + (c.pend ? 'on' : '') + '"><b>' + c.pend + '</b><span>Por revisar</span></div>' +
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

    h += '<div class="vp-ia-bar">' +
           '<button class="btn primary xl block" onclick="vpIaGuardar()">' + ico('plus') + ' Agregar productos al inventario</button>' +
           '<button class="btn ghost block" style="margin-top:8px;" onclick="vpIaOtraVez()">' + ico('camera') + ' Volver a analizar la foto</button>' +
           '<p class="vp-ia-sub">Corregir, quitar o elegir productos no gasta nada. Solo "Volver a analizar" usa otro escaneo.</p>' +
         '</div>';

    openModal(h, { dismissible:true });
  }

  /* Se refrescan solo los contadores: así no se pierde el cursor al escribir */
  function refrescarCuentas(){
    var c = cuentas();
    var box = document.getElementById('vpIaCount');
    if(!box) return;
    box.className = 'vp-ia-count' + (c.pend ? ' warn' : '');
    var d = box.querySelectorAll('div');
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
    if(campo === 'descripcion'){ it.descripcion = String(valor).slice(0, 200); return; }
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
      var nueva = { id:'cat' + Date.now() + Math.floor(Math.random() * 1000), name:nombre.slice(0, 40), emoji:'', color:'#25D366' };
      cats.push(nueva); nuevasCats++;
      return nueva.id;
    }

    /* OJO: VendoPlus no tiene campo de descripción en los productos.
       Lo que la IA leyó se guarda en "desc" (campo nuevo, opcional, que
       viaja con el producto y se sincroniza como todo lo demás). Hoy
       ninguna pantalla lo muestra: está ahí para cuando lo quieras usar
       en el Menú Digital. Si no lo quieres, pon GUARDAR_DESC = false. */
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
        desc: (GUARDAR_DESC && String(descripcion || '').trim()) ? String(descripcion).trim().slice(0, 200) : null,
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
  window.vpIaCerrar     = cerrar;
  window.vpIaFoto       = fotoElegida;
  window.vpIaSet        = set;
  window.vpIaVar        = setVar;
  window.vpIaSel        = sel;
  window.vpIaOk         = marcarOk;
  window.vpIaQuitar     = quitar;
  window.vpIaVerFoto    = verFoto;
  window.vpIaOtraVez    = otraVez;
  window.vpIaReintentar = reintentar;
  window.vpIaGuardar    = guardar;
})();
