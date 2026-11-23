/* =========================================================================
   Vendo+ · PUENTE CON ANDROID (vendo-bridge.js)
   -------------------------------------------------------------------------
   Se carga en <head>, ANTES que el resto de index.html. Solo hace algo
   dentro de la app de Android (cuando existe window.VendoNative); en un
   navegador normal no toca nada.

   Le da a la página, por debajo, lo que un WebView no trae solo:
     · navigator.vibrate ........ vibración nativa (también sin toque previo)
     · window.open / links ...... WhatsApp, mapas, Play Store en su app
     · window.print ............. sistema de impresión de Android
     · navigator.share .......... menú "Compartir" con archivos
     · <a download> ............. guarda en Descargas/Vendo+
     · Notification ............. avisos del sistema (pedidos nuevos)
     · clipboard ................ copiar
     · Capacitor.Plugins.MesaPrinter  impresora térmica (mismo contrato que iPhone)
     · color de las barras del sistema = color de la pantalla
========================================================================= */
(function(){
  'use strict';
  var N = window.VendoNative;
  if(!N || window.VendoApp) return;

  var info = {};
  try{ info = JSON.parse(N.info()) || {}; }catch(e){}

  /* ---------- Llamadas con promesa ---------- */
  var pend = {}, seq = 0, listeners = {};
  function call(method, args){
    return new Promise(function(resolve, reject){
      var id = 'c' + (++seq) + '_' + Date.now().toString(36);
      pend[id] = { resolve:resolve, reject:reject };
      try{ N.call(id, method, JSON.stringify(args || {})); }
      catch(e){ delete pend[id]; reject(e); }
    });
  }
  function on(name, fn){
    (listeners[name] = listeners[name] || []).push(fn);
    return { remove:function(){ var l = listeners[name] || [], i = l.indexOf(fn); if(i >= 0) l.splice(i, 1); } };
  }
  window.__vendoNative = {
    _done:function(id, ok, data){
      var p = pend[id]; if(!p) return;
      delete pend[id];
      if(ok){ p.resolve(data); return; }
      var e = new Error((data && data.message) || 'Algo salió mal');
      e.code = (data && data.code) || 'error';
      e.data = data;
      p.reject(e);
    },
    _event:function(name, data){
      (listeners[name] || []).slice().forEach(function(fn){ try{ fn(data || {}); }catch(e){ console.error(e); } });
    }
  };

  var VA = window.VendoApp = {
    native:true, platform:'android', info:info, call:call, on:on,
    WEB_URL:'https://vendoplusoficial.com/',
    lastVibration:0
  };
  document.documentElement.classList.add('vp-native', 'vp-android');
  if(info.tablet) document.documentElement.classList.add('vp-tablet');

  /* Por defecto el botón Atrás sale de la app (vendo-app.js lo cambia). */
  window.__vendoBack = function(){ return 'exit'; };

  /* ---------- Vibración ---------- */
  function vib(pattern){
    try{
      var p = Array.isArray(pattern) ? pattern.map(function(x){ return Math.max(0, Number(x) || 0); }) : Math.max(0, Number(pattern) || 0);
      N.vibrate(JSON.stringify(p));
      VA.lastVibration = Date.now();
      return true;
    }catch(e){ return false; }
  }
  try{ Object.defineProperty(navigator, 'vibrate', { value:vib, configurable:true, writable:true }); }
  catch(e){ try{ navigator.vibrate = vib; }catch(x){} }
  VA.vibrate = vib;

  /* ---------- Abrir fuera de la app ---------- */
  function toAbs(u){ try{ return new URL(String(u), location.href).href; }catch(e){ return String(u); } }
  function isAppUrl(u){ return u.indexOf(location.origin + '/') === 0; }
  function openExternal(u){
    if(!u || /^about:blank/i.test(u) || /^javascript:/i.test(u)) return;
    /* Un link a la propia app (por ejemplo el Menú Digital) se abre en la página de internet */
    if(isAppUrl(u)){
      var h = u.indexOf('#'); u = VA.WEB_URL + (h >= 0 ? u.slice(h) : '');
    }
    call('open.url', { url:u }).catch(function(e){ console.warn('open.url', e); });
  }
  VA.openExternal = openExternal;
  window.open = function(url){
    var target = url == null ? '' : String(url);
    var abs = target ? toAbs(target) : '';
    var w = { closed:false, opener:null, name:'',
      focus:function(){}, blur:function(){}, postMessage:function(){},
      close:function(){ w.closed = true; } };
    var loc = {
      assign:function(v){ go(toAbs(v)); },
      replace:function(v){ go(toAbs(v)); },
      reload:function(){},
      toString:function(){ return abs || 'about:blank'; }
    };
    Object.defineProperty(loc, 'href', { get:function(){ return abs || 'about:blank'; }, set:function(v){ go(toAbs(v)); } });
    Object.defineProperty(w, 'location', { get:function(){ return loc; }, set:function(v){ go(toAbs(v)); } });
    function go(u){ if(w.closed) return; abs = u; openExternal(u); }
    if(abs) go(abs);
    return w;
  };

  /* ---------- Copiar ---------- */
  function copyText(t){ return call('clipboard.write', { text:String(t == null ? '' : t) }).then(function(){}); }
  try{
    if(navigator.clipboard) Object.defineProperty(navigator.clipboard, 'writeText', { value:copyText, configurable:true, writable:true });
    else Object.defineProperty(navigator, 'clipboard', { value:{ writeText:copyText }, configurable:true });
  }catch(e){}

  /* ---------- Archivos: base64 ---------- */
  function blobToB64(blob){
    return new Promise(function(resolve, reject){
      var r = new FileReader();
      r.onload = function(){ var s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function(){ reject(r.error || new Error('No se pudo leer el archivo')); };
      r.readAsDataURL(blob);
    });
  }
  VA.blobToB64 = blobToB64;

  /* ---------- Compartir ---------- */
  var shareFn = function(data){
    data = data || {};
    var files = Array.prototype.slice.call(data.files || []);
    return Promise.all(files.map(function(f){
      return blobToB64(f).then(function(b64){ return { name:f.name || 'archivo', type:f.type || '', data:b64 }; });
    })).then(function(list){
      return call('share', { title:data.title || '', text:data.text || '', url:data.url || '', files:list });
    }).then(function(){});
  };
  try{
    Object.defineProperty(navigator, 'share', { value:shareFn, configurable:true, writable:true });
    Object.defineProperty(navigator, 'canShare', { value:function(d){ return !!d && !!(d.files || d.text || d.url || d.title); }, configurable:true, writable:true });
  }catch(e){}

  /* ---------- Descargas (<a download>) → Descargas/Vendo+ ---------- */
  function saveBlob(name, blob){
    return blobToB64(blob).then(function(b64){
      return call('file.save', { name:name || 'archivo', mime:blob.type || '', data:b64 });
    });
  }
  VA.saveBlob = saveBlob;
  function downloadAnchor(a){
    var href = a.href, name = a.getAttribute('download') || '';
    fetch(href).then(function(r){ return r.blob(); })
      .then(function(b){ return saveBlob(name, b); })
      .catch(function(e){ console.error('descarga', e); call('toast', { text:'No se pudo guardar el archivo' }); });
  }
  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    if(this.hasAttribute('download') && /^(blob:|data:)/i.test(this.href || '')){ downloadAnchor(this); return; }
    return nativeClick.apply(this, arguments);
  };
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if(a && /^(blob:|data:)/i.test(a.href || '')){ e.preventDefault(); downloadAnchor(a); }
  }, true);

  /* ---------- Imprimir con el sistema (window.print) ---------- */
  function printSnapshot(){
    var clone = document.documentElement.cloneNode(true);
    /* Las gráficas (canvas) se pasan como imagen */
    var src = document.querySelectorAll('#printRoot canvas'), dst = clone.querySelectorAll('#printRoot canvas');
    for(var i = 0; i < src.length && i < dst.length; i++){
      try{ var img = document.createElement('img'); img.src = src[i].toDataURL('image/png'); img.style.cssText = dst[i].style.cssText; img.width = src[i].width; dst[i].parentNode.replaceChild(img, dst[i]); }catch(e){}
    }
    Array.prototype.forEach.call(clone.querySelectorAll('script, noscript, iframe'), function(n){ n.remove(); });
    var body = clone.querySelector('body');
    if(body && clone.querySelector('#printRoot')){
      Array.prototype.slice.call(body.children).forEach(function(c){ if(c.id !== 'printRoot') c.remove(); });
    }
    return '<!DOCTYPE html>' + clone.outerHTML;
  }
  window.print = function(){
    try{ window.dispatchEvent(new Event('beforeprint')); }catch(e){}
    var html = printSnapshot();
    call('print.html', { html:html, title:(document.title || 'Vendo+').split('·')[0].trim() || 'Vendo+' })
      .catch(function(e){ console.error('print', e); call('toast', { text:'No se pudo abrir la impresión' }); })
      .then(function(){ try{ window.dispatchEvent(new Event('afterprint')); }catch(e){} });
  };

  /* ---------- Avisos del sistema (API Notification) ---------- */
  function VNotification(title, opts){
    opts = opts || {};
    this.title = String(title || '');
    this.body = String(opts.body || '');
    this.tag = String(opts.tag || '');
    this.onclick = null; this.onclose = null; this.onerror = null; this.onshow = null;
    call('notify.show', { title:this.title, body:this.body, tag:this.tag }).catch(function(){});
  }
  VNotification.prototype.close = function(){ call('notify.cancel', { tag:this.tag }).catch(function(){}); };
  VNotification.prototype.addEventListener = function(){};
  VNotification.prototype.removeEventListener = function(){};
  Object.defineProperty(VNotification, 'permission', { get:function(){ try{ return N.notifPermission(); }catch(e){ return 'default'; } } });
  VNotification.requestPermission = function(cb){
    var p = call('notify.request', {}).then(function(r){ return (r && r.permission) || 'default'; }, function(){ return 'default'; });
    if(typeof cb === 'function') p.then(cb);
    return p;
  };
  try{ Object.defineProperty(window, 'Notification', { value:VNotification, configurable:true, writable:true }); }
  catch(e){ window.Notification = VNotification; }

  /* ---------- Impresora térmica: MesaPrinter (contrato del plugin de iPhone) ---------- */
  var MesaPrinter = {
    scan:function(a){ return call('printer.scan', a || {}); },
    connect:function(a){ return call('printer.connect', a || {}); },
    disconnect:function(a){ return call('printer.disconnect', a || {}); },
    write:function(a){ return call('printer.write', a || {}); },
    netProbe:function(a){ return call('printer.netProbe', a || {}); },
    netPrint:function(a){ return call('printer.netPrint', a || {}); },
    addListener:function(ev, fn){
      var h = on('printer:' + ev, fn);
      var p = Promise.resolve(h); p.remove = h.remove;
      return p;
    }
  };
  var C = window.Capacitor = window.Capacitor || {};
  C.Plugins = C.Plugins || {};
  C.Plugins.MesaPrinter = MesaPrinter;
  C.isNativePlatform = function(){ return true; };
  C.getPlatform = function(){ return 'android'; };
  C.isPluginAvailable = function(n){ return n === 'MesaPrinter'; };

  /* ---------- Barras del sistema del color de la pantalla ---------- */
  function rgba(c){
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if(!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r:p[0] || 0, g:p[1] || 0, b:p[2] || 0, a:p.length > 3 ? p[3] : 1 };
  }
  function hex(c){ function h(v){ v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); } return '#' + h(c.r) + h(c.g) + h(c.b); }
  /* Color real en ese punto (mezcla las capas semitransparentes, como el fondo oscuro de una ventana) */
  function colorAt(x, y, fallback){
    try{
      var els = document.elementsFromPoint(x, y), layers = [];
      for(var i = 0; i < els.length; i++){
        var c = rgba(getComputedStyle(els[i]).backgroundColor);
        if(!c || c.a <= 0.02) continue;
        layers.push(c);
        if(c.a >= 0.98) break;
      }
      var base = { r:255, g:255, b:255 };
      var fb = rgba(fallback); if(fb) base = fb;
      for(var j = layers.length - 1; j >= 0; j--){
        var l = layers[j], a = Math.min(1, l.a);
        base = { r:l.r * a + base.r * (1 - a), g:l.g * a + base.g * (1 - a), b:l.b * a + base.b * (1 - a) };
      }
      return hex(base);
    }catch(e){ return null; }
  }
  var lastBars = '';
  function syncBars(){
    if(!document.body) return;
    var w = window.innerWidth, h = window.innerHeight;
    var bodyBg = getComputedStyle(document.body).backgroundColor;
    var top = colorAt(w / 2, 1, bodyBg) || '#F3F4FA';
    var bottom = colorAt(w / 2, h - 2, bodyBg) || '#FFFFFF';
    var key = top + bottom;
    if(key === lastBars) return;
    lastBars = key;
    try{ N.setBars(top, bottom); }catch(e){}
  }
  var barsT = null;
  function queueBars(){ clearTimeout(barsT); barsT = setTimeout(syncBars, 120); }
  VA.syncBars = function(){ lastBars = ''; syncBars(); };
  document.addEventListener('DOMContentLoaded', function(){
    syncBars();
    try{
      new MutationObserver(queueBars).observe(document.documentElement, { subtree:true, childList:true, attributes:true, attributeFilter:['class', 'content', 'style', 'data-section'] });
    }catch(e){}
    window.addEventListener('resize', queueBars);
    document.addEventListener('transitionend', queueBars, true);
    document.addEventListener('animationend', queueBars, true);
    setInterval(syncBars, 1500);
  });
})();
