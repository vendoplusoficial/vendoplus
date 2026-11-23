/* =========================================================================
   Vendo+ · AJUSTES DE LA APP DE ANDROID (vendo-app.js)
   -------------------------------------------------------------------------
   Se carga al final de index.html, justo antes del ARRANQUE, y solo actúa
   dentro de la app de Android. Cambia lo mínimo para que la app nativa:

     1. Cobre la membresía con GOOGLE PLAY (no Stripe, sin páginas externas).
        Mismo flujo: 1 mes gratis (Supabase) → se pausa → paga → se libera.
        Si cancela, vence o le reembolsan → se vuelve a pausar.
     2. Tenga botón ATRÁS de Android: cierra la ventana abierta, regresa a la
        sección anterior y, en Inicio, pide tocar dos veces para salir.
     3. Use la impresora nativa (Bluetooth clásico, BLE, USB y Wi-Fi).
     4. Lea códigos con el escáner de Google (cámara).
     5. Comparta el link del Menú Digital con tu dominio (no con el de la app).
     6. Borre la cuenta de verdad (Google Play lo exige).
   Todo lo demás es tu misma página, sin tocar.
========================================================================= */
(function(){
  'use strict';
  var VA = window.VendoApp;
  if(!VA || !VA.native) return;
  /* Si el index lo carga dos veces (etiqueta + cargador automático), solo corre una */
  if(window.__vpAppLoaded) return;
  window.__vpAppLoaded = true;

  /* ---------- Datos de Google Play (deben ser IGUALES en Play Console) ---------- */
  var PLAY = {
    PRODUCT_ID: 'vendoplus_app_membresia',   /* ID de la suscripción */
    BASE_PLAN:  'app-mensual'            /* ID del plan base (sin ofertas) */
  };
  /* Dirección pública de tu página: ahí abren tus clientes el Menú Digital */
  var WEB_URL = VA.WEB_URL || 'https://vendoplusoficial.com/';

  var has = function(name){ try{ return typeof window[name] === 'function' || typeof eval(name) === 'function'; }catch(e){ return false; } };
  var safe = function(fn){ try{ return fn(); }catch(e){ console.error('[vendo-app]', e); } };
  var cloudOn = function(){ return typeof Cloud !== 'undefined' && Cloud && Cloud.ready; };
  var tick = function(p){ safe(function(){ if(typeof vibrate === 'function') vibrate(p); else VA.vibrate(p); }); };

  /* ---------- Estilos mínimos de app nativa ---------- */
  safe(function(){
    var st = document.createElement('style');
    st.textContent =
      'html.vp-android img{ -webkit-touch-callout:none; }' +
      'html.vp-android .vp-version{ text-align:center; color:var(--ink-soft,#8A93AC); font-size:12px; margin:22px 0 4px; }' +
      'html.vp-android .vp-legal{ margin:16px 0 0; font-size:12px; line-height:1.45; color:var(--ink-soft,#8A93AC); }';
    document.head.appendChild(st);
  });

  /* =======================================================================
     1) MENÚ DIGITAL: el link que compartes es el de tu página
  ======================================================================= */
  if(has('mdLink')){
    mdLink = function(cfg){ return WEB_URL + '#menu/' + encodeURIComponent(cfg && cfg.id || ''); };
  }

  /* =======================================================================
     2) BOTÓN ATRÁS DE ANDROID
  ======================================================================= */
  var navStack = [], backNav = false, lastBackAt = 0;
  if(has('goTo')){
    var _goTo = goTo;
    goTo = function(view){
      var prev = (typeof currentView !== 'undefined') ? currentView : 'home';
      var r = _goTo.apply(this, arguments);
      safe(function(){
        var now = currentView;
        if(!backNav && now !== prev){
          if(now === 'home') navStack = [];
          else{
            navStack = navStack.filter(function(v){ return v !== now; });
            navStack.push(prev);
            if(navStack.length > 30) navStack.shift();
          }
        }
        if(now === 'menu') askNotifyOnce();
      });
      return r;
    };
  }
  function visible(el){ return !!el && !el.disabled && el.getClientRects().length > 0; }
  function exitOrHint(){
    if(Date.now() - lastBackAt < 2200) return 'exit';
    lastBackAt = Date.now();
    safe(function(){ toast('Toca otra vez Atrás para salir', { duration:1800 }); });
    return 'handled';
  }
  window.__vendoBack = function(){
    try{
      /* Confirmación encima de todo */
      var conf = document.querySelector('#confirm-layer .modal-overlay');
      if(conf){
        var no = conf.querySelector('#confNo');
        if(visible(no)) no.click();
        else if(typeof askConfirm === 'function' && typeof askConfirm._close === 'function') askConfirm._close();
        tick(8); return 'handled';
      }
      /* Escáner encima del formulario */
      if(document.querySelector('#scan-layer .modal-overlay') && typeof closeScanner === 'function'){ closeScanner(); tick(8); return 'handled'; }
      /* Menú Digital en modo cliente (no debería pasar en la app) */
      if(document.body.classList.contains('dm-mode')){
        if(typeof dm !== 'undefined' && dm.sheet && typeof dmCloseSheet === 'function'){ dmCloseSheet(); return 'handled'; }
        return 'exit';
      }
      /* Cuenta pausada: Atrás no deja entrar, solo sale */
      if(document.getElementById('paywall')) return 'exit';
      /* Hoja / ventana abierta */
      var ov = document.querySelector('#modal-layer .modal-overlay:not(.is-closing)');
      if(ov){
        var sheet = ov.querySelector('.modal-sheet') || ov;
        var back = sheet.querySelector('.sheet-back');
        if(visible(back)){ back.click(); tick(8); return 'handled'; }
        var close = sheet.querySelector('.sheet-close');
        if(visible(close)){ close.click(); tick(8); return 'handled'; }
        if(ov.dataset.lock){ tick([12, 40, 12]); return 'handled'; }   /* esta ventana no se cierra sola */
        closeModal();
        if(typeof currentView !== 'undefined' && currentView === 'sale' && typeof render === 'function') render();
        tick(8); return 'handled';
      }
      /* Pantallas de acceso (bienvenida, correo, código…) */
      if(document.body.classList.contains('auth-open')){
        var ab = document.querySelector('#authLayer .auth-back');
        if(visible(ab)){ ab.click(); tick(8); return 'handled'; }
        return exitOrHint();
      }
      /* Búsqueda escrita en Nueva venta */
      if(typeof saleSearch !== 'undefined' && saleSearch && typeof currentView !== 'undefined' && currentView === 'sale' && typeof clearSaleSearch === 'function'){
        clearSaleSearch(); return 'handled';
      }
      /* Sección anterior */
      if(navStack.length){
        var prev = navStack.pop();
        backNav = true;
        try{ goTo(prev); }finally{ backNav = false; }
        tick(8); return 'handled';
      }
      if(typeof currentView !== 'undefined' && currentView !== 'home'){
        backNav = true;
        try{ goTo('home'); }finally{ backNav = false; }
        tick(8); return 'handled';
      }
      return exitOrHint();
    }catch(e){
      console.error('[atrás]', e);
      return 'exit';
    }
  };

  /* =======================================================================
     3) AVISOS: se piden una vez al abrir el Menú Digital (pedidos nuevos)
  ======================================================================= */
  function askNotifyOnce(){
    try{
      if(localStorage.getItem('vp_notif_asked') === '1') return;
      if(typeof Notification === 'undefined' || Notification.permission !== 'default') return;
      localStorage.setItem('vp_notif_asked', '1');
      setTimeout(function(){
        Notification.requestPermission().then(function(){ safe(function(){ if(typeof mdiCloudPaint === 'function') mdiCloudPaint(); }); });
      }, 900);
    }catch(e){}
  }

  /* Vibración en avisos de error (si el botón no vibró ya) */
  if(has('toast')){
    var _toast = toast;
    toast = function(msg, opts){
      safe(function(){
        if(opts && /toast-danger/.test(opts.variant || '') && Date.now() - VA.lastVibration > 300) vibrate([14, 50, 14]);
      });
      return _toast.apply(this, arguments);
    };
  }

  /* =======================================================================
     4) ESCÁNER DE CÓDIGOS (cámara) — el de Google, rápido y sin permisos
  ======================================================================= */
  if(has('openScanner')){
    scanSupported = function(){ return true; };
    openScanner = function(targetField){
      var target = targetField || null;
      VA.call('scan.barcode', {}).then(function(r){
        var code = String((r && r.code) || '').replace(/[\u0000-\u001F]/g, '').trim();
        if(!code) return;
        if(target){
          var el = document.getElementById(target);
          if(el){ el.value = code.slice(0, 40); el.dispatchEvent(new Event('input', { bubbles:true })); }
          safe(function(){ scanBeep(); });
          tick(25);
          return;
        }
        if(typeof currentView !== 'undefined' && currentView === 'sale' && typeof saleScanCode === 'function' && saleScanCode(code, false)){
          tick(25);
          safe(function(){ render(); });
          return;
        }
        tick([18, 60, 18]);
        if(typeof handleScannedCode === 'function') handleScannedCode(code, 'camara');
      }).catch(function(e){
        if(e && e.code === 'canceled') return;
        toast('No se pudo abrir el escáner', { icon:icon('alert'), variant:'toast-danger toast-wrap', subtitle:(e && e.message) || '', duration:4200 });
      });
    };
  }

  /* =======================================================================
     5) IMPRESORA NATIVA DE ANDROID
        Bluetooth clásico + BLE + USB (OTG) + Wi-Fi, y RawBT como opción.
  ======================================================================= */
  safe(function(){
    if(!has('printerScanNative')) return;
    printerRawBTOK = function(){ return true; };
    var _canScan = printerCanScan;
    printerCanScan = function(tipo){ return tipo === 'usb' || tipo === 'rawbt' || _canScan(tipo); };
    printerScanUSB = function(){ return printerScanNative('usb'); };

    printerScanNative = async function(tipo){
      if(tipo === 'wifi') return printerSaveWifi();
      var nat = printerNative();
      var usb = tipo === 'usb';
      toast(usb ? 'Buscando impresoras USB…' : 'Buscando impresoras…', { icon:icon('search'), duration:usb ? 2200 : 8500 });
      var r = await printerTimeout(nat.scan({ type:usb ? 'usb' : 'bt' }), 30000, 'timed out');
      var lista = ((r && r.devices) || []).filter(function(d){ return d && d.id; });
      safe(function(){ var tt = document.getElementById('toast'); if(tt) tt.classList.remove('show'); });
      if(!lista.length){
        printerFail(usb ? 'No encontramos impresoras USB' : 'No encontramos impresoras cerca', new Error(usb
          ? 'Conecta la impresora con un cable OTG, préndela y vuelve a buscar.'
          : 'Prende la impresora y acércala. Si es Bluetooth clásico y no aparece, vincúlala primero en Ajustes › Bluetooth del teléfono (PIN 0000 o 1234).'));
        return;
      }
      printerPickList = lista.map(function(d){ return Object.assign({}, d, { likely:d.likely || printerLooksLikePrinter(d.name) }); })
        .sort(function(a, b){ return (b.likely ? 1 : 0) - (a.likely ? 1 : 0) || (b.bonded ? 1 : 0) - (a.bonded ? 1 : 0) || (Number(b.rssi) || -999) - (Number(a.rssi) || -999); });
      var tipoTxt = function(d){
        if(d.kind === 'usb') return 'USB';
        if(d.kind === 'classic') return d.bonded ? 'Bluetooth clásico · vinculada' : 'Bluetooth clásico';
        return 'Bluetooth BLE';
      };
      openModal(
        '<div class="sheet-header"><div class="sheet-header-left">' +
          '<button class="sheet-back" onclick="openPrintSettings()" aria-label="Volver">' + icon('chevronLeft') + '</button>' +
          '<h2>Elige tu impresora</h2></div>' +
          '<button class="sheet-close" onclick="openPrintSettings()" aria-label="Cerrar">' + icon('close') + '</button></div>' +
        '<p class="sheet-text" style="margin-top:-6px;">' + (usb ? 'Impresoras conectadas por cable.' : 'Estos aparatos Bluetooth están cerca o vinculados. Las que parecen impresoras salen primero.') + '</p>' +
        '<div class="pr-list">' + printerPickList.map(function(d, i){
          var senal = d.rssi ? ' · señal ' + (d.rssi > -60 ? 'fuerte' : (d.rssi > -80 ? 'media' : 'débil')) : '';
          return '<button class="pr-item" onclick="printerPickNative(' + i + ')">' +
            '<span class="acc-ico ' + (d.likely ? 'green' : '') + '">' + icon(d.kind === 'usb' ? 'usb' : (d.likely ? 'print' : 'bluetooth')) + '</span>' +
            '<span class="acc-txt"><span class="acc-label">' + escapeHtml(d.name || 'Sin nombre') + '</span>' +
            '<span class="acc-sub">' + (d.likely ? 'Parece impresora · ' : '') + tipoTxt(d) + senal + '</span></span>' +
            '<span class="acc-chev">' + icon('chevronRight') + '</span></button>';
        }).join('') + '</div>' +
        '<button class="btn ghost block" style="margin-top:12px;" onclick="printerScan()">' + icon('search') + ' Buscar otra vez</button>',
        { dismissible:true });
    };

    printerPickNative = async function(i){
      var d = printerPickList[i];
      if(!d) return;
      await printerDropLink();
      printerRemember({ id:d.id, name:(d.name || (d.kind === 'usb' ? 'Impresora USB' : 'Impresora Bluetooth')), conn:d.conn === 'usb' ? 'usb' : 'bt', via:'native', kind:d.kind || 'ble' });
      printerRT.error = '';
      openPrintSettings();
      printerConnect({ gesture:true });
    };

    var _viaName = printerViaName;
    printerViaName = function(d){
      if(d && d.via === 'native'){
        if(d.kind === 'usb' || d.conn === 'usb') return 'USB (cable)';
        if(d.kind === 'classic') return 'Bluetooth clásico';
        return 'Bluetooth BLE';
      }
      return _viaName(d);
    };

    var _note = printerNoteHTML;
    printerNoteHTML = function(){
      var cfg = printerPrefs();
      if(cfg.conn === 'rawbt') return _note();
      if(cfg.conn === 'usb') return '<div class="pr-note ok"><b>Impresora por cable.</b> Conecta la térmica al teléfono o tablet con un cable USB (OTG) y toca <b>Buscar USB</b>. La primera vez Android te pide permiso: toca <b>Permitir</b>.</div>';
      if(cfg.conn === 'wifi') return '<div class="pr-note ok"><b>Wi-Fi directo.</b> Escribe la IP de la impresora (está en su hoja de prueba) y el puerto, casi siempre <b>9100</b>. El teléfono y la impresora deben estar en la misma red.</div>';
      return '<div class="pr-note ok"><b>App nativa activa.</b> Se conecta directo con la impresora por Bluetooth (clásico o BLE) y se vuelve a conectar sola. ¿No aparece? Vincúlala primero en Ajustes › Bluetooth del teléfono (el PIN casi siempre es 0000 o 1234) y busca otra vez.</div>';
    };

    var _box = printerBoxHTML;
    printerBoxHTML = function(){
      return String(_box.apply(this, arguments)).replace(/(onclick="printerScanUSB\(\)")\s+disabled/g, '$1');
    };
  });

  /* =======================================================================
     6) MEMBRESÍA CON GOOGLE PLAY
  ======================================================================= */
  function fmtDate(iso){
    try{ return new Date(iso).toLocaleDateString('es-MX', { day:'numeric', month:'long', year:'numeric' }); }catch(e){ return ''; }
  }
  async function invokeFn(name, body){
    var res = await Cloud.sb.functions.invoke(name, { body:body || {} });
    if(!res.error) return res.data;
    var info = null, err = res.error;
    try{ if(err.context && typeof err.context.json === 'function') info = await err.context.json(); }catch(x){}
    var e = new Error((info && info.message) || err.message || 'Algo salió mal');
    e.code = (info && info.error) || (err.name === 'FunctionsFetchError' ? 'network' : 'http');
    e.status = err.context && err.context.status;
    throw e;
  }
  VA.invokeFn = invokeFn;

  var PlayPay = window.PlayPay = {
    product:null, productErr:null, loading:null, busy:false,
    lastSync:0, lastServerSync:0, syncing:null, otherAccount:false, syncedUid:null,

    priceText:function(){
      var p = this.product;
      return (p && p.available && p.price) ? p.price : ('$' + (typeof TRIAL_PRECIO !== 'undefined' ? TRIAL_PRECIO : 249) + ' MXN');
    },
    hasPlay:function(){
      var s = cloudOn() && Cloud.sub;
      return !!(s && s.vp_play_pagado_hasta && new Date(s.vp_play_pagado_hasta) > new Date());
    },

    /* Precio y plan desde Google Play */
    load:function(force){
      var self = this;
      if(self.loading && !force) return self.loading;
      self.loading = VA.call('billing.product', { productId:PLAY.PRODUCT_ID, basePlanId:PLAY.BASE_PLAN })
        .then(function(p){ self.product = p; self.productErr = null; self.paint(); return p; })
        .catch(function(e){ self.productErr = e; self.loading = null; return null; });
      return self.loading;
    },

    /* Revisa las compras de esta cuenta de Google y las confirma con Supabase (vp-play-verificar) */
    sync:function(force){
      var self = this;
      if(!cloudOn() || !Cloud.uid) return Promise.resolve(null);
      if(self.syncing) return self.syncing;
      var uid = Cloud.uid;
      if(self.syncedUid !== uid){ self.syncedUid = uid; self.lastServerSync = 0; }
      self.syncing = (async function(){
        var purchases = [];
        try{ var r = await VA.call('billing.purchases', {}); purchases = (r && r.purchases) || []; }catch(e){}
        var mine = purchases.filter(function(p){ return p.state === 'purchased' && (p.products || []).indexOf(PLAY.PRODUCT_ID) >= 0; });
        var other = false, verified = false, lastErr = null;
        for(var i = 0; i < mine.length; i++){
          var p = mine[i];
          if(p.accountId && p.accountId !== uid){ other = true; continue; }
          try{
            var v = await invokeFn('vp-play-verificar', { purchaseToken:p.token, productId:PLAY.PRODUCT_ID });
            verified = true;
            if(!p.acknowledged && v && v.play && !v.play.acknowledged) VA.call('billing.ack', { token:p.token }).catch(function(){});
          }catch(e){
            lastErr = e;
            if(e.code === 'other_account') other = true;
            console.warn('[vp-play-verificar]', e);
          }
        }
        /* Sin compras en este teléfono: el servidor revisa las que ya conoce (cancelaciones, reembolsos…) */
        var s = Cloud.sub || {};
        if(!verified && s.vp_play_estado && (force || Date.now() - self.lastServerSync > 30 * 60e3)){
          try{ await invokeFn('vp-play-verificar', { sync:true }); self.lastServerSync = Date.now(); }catch(e){ lastErr = e; }
        }
        self.lastSync = Date.now();
        self.otherAccount = other;
        var antes = Cloud.hasAccess();
        await baseRefreshSub();
        Cloud.gate();
        if(!antes && Cloud.hasAccess()) safe(function(){ render(); });
        return { other:other, verified:verified, error:lastErr };
      })().finally(function(){ self.syncing = null; });
      return self.syncing;
    },
    maybeSync:function(){
      if(!cloudOn() || !Cloud.uid) return;
      if(Date.now() - this.lastSync > 2 * 60e3) this.sync(false);
    },

    /* Pagar */
    buy:async function(){
      var self = this;
      if(!cloudOn() || !Cloud.uid) return Cloud.fail('Inicia sesión para pagar', 'Tu pago se liga a tu cuenta');
      if(self.busy) return;
      self.busy = true;
      self.setBtn('Abriendo Google Play…', true);
      try{
        var p = (self.product && self.product.available) ? self.product : await self.load(true);
        if(!p || !p.available) throw self.unavailableError(p);
        var r = await VA.call('billing.buy', { productId:PLAY.PRODUCT_ID, basePlanId:PLAY.BASE_PLAN, offerToken:p.offerToken || '', accountId:Cloud.uid });
        if(r.status === 'canceled'){
          toast('Pago cancelado', { subtitle:'No se te cobró nada', icon:icon('alert') });
          return;
        }
        if(r.status === 'pending'){
          toast('Tu pago está pendiente', { subtitle:'En cuanto Google Play lo confirme, tu cuenta se libera sola', icon:icon('check'), duration:5200 });
          return;
        }
        self.setBtn('Confirmando tu pago…', true);
        var err = null;
        var compras = (r.purchases || []).filter(function(x){ return x.state === 'purchased'; });
        for(var i = 0; i < compras.length; i++){
          try{
            var v = await invokeFn('vp-play-verificar', { purchaseToken:compras[i].token, productId:PLAY.PRODUCT_ID });
            if(!compras[i].acknowledged && v && v.play && !v.play.acknowledged) VA.call('billing.ack', { token:compras[i].token }).catch(function(){});
          }catch(e){ err = e; }
        }
        if(r.status === 'already' || !compras.length){
          var s = await self.sync(true);
          if(s && s.other) err = Object.assign(new Error('other'), { code:'other_account' });
        }
        await baseRefreshSub();
        Cloud.gate();
        if(Cloud.paidNow()){
          tick([30, 60, 30]);
          safe(function(){ render(); });
          toast('¡Pago recibido! Tu cuenta está activa', { variant:'toast-success', icon:icon('check') });
          return;
        }
        if(err) throw err;
        toast('Tu pago se está procesando', { subtitle:'En cuanto Google Play lo confirme, tu cuenta se libera sola', icon:icon('check'), duration:5200 });
        self.pollAfterPay();
      }catch(e){
        console.warn('[Google Play]', e);
        self.showError(e);
      }finally{
        self.busy = false;
        self.paint();
      }
    },
    pollAfterPay:function(){
      var self = this, n = 0;
      var t = setInterval(async function(){
        n++;
        await self.sync(true);
        if(Cloud.paidNow()){
          clearInterval(t);
          safe(function(){ render(); });
          toast('¡Pago recibido! Tu cuenta está activa', { variant:'toast-success', icon:icon('check') });
        }else if(n >= 12) clearInterval(t);
      }, 5000);
    },

    /* "Ya pagué · Restaurar compra" */
    restore:async function(){
      var self = this;
      if(self.busy) return;
      self.busy = true;
      var b = document.getElementById('restoreBtn');
      if(b){ b.disabled = true; b.textContent = 'Buscando tu membresía…'; }
      try{
        var r = await self.sync(true);
        if(Cloud.paidNow()){
          tick([30, 60, 30]);
          safe(function(){ render(); });
          toast('¡Listo! Tu membresía está activa', { variant:'toast-success', icon:icon('check') });
        }else if(r && r.other){
          self.showError(Object.assign(new Error('other'), { code:'other_account' }));
        }else if(r && r.error && r.error.code !== 'other_account'){
          self.showError(r.error);
        }else{
          toast('No encontramos una membresía activa', { icon:icon('alert'), variant:'toast-wrap', subtitle:'Revisa que el teléfono tenga la misma cuenta de Google con la que pagaste', duration:5200 });
        }
      }finally{
        self.busy = false;
        self.paint();
      }
    },

    unavailableError:function(p){
      var e = this.productErr;
      if(e) return e;
      var fromPlay = !!(VA.info && VA.info.fromPlayStore);
      var err = new Error(fromPlay ? 'La membresía todavía no está disponible en Google Play. Intenta en unos minutos.'
                                   : 'Para pagar, instala Vendo+ desde la Play Store.');
      err.code = fromPlay ? 'not_found' : 'not_from_play';
      return err;
    },
    showError:function(e){
      var code = (e && e.code) || '';
      var t = 'No se pudo completar el pago', s = (e && e.message) || 'Intenta de nuevo en un momento';
      if(code === 'other_account'){
        t = 'Esa membresía es de otra cuenta';
        s = 'Esta cuenta de Google ya paga Vendo+ para otro correo. Entra con ese correo, o usa otra cuenta de Google para pagar esta.';
      }else if(code === 'not_from_play' || code === 'developer_error'){
        t = 'La app todavía no está lista en Google Play';
        s = 'Instala Vendo+ desde la Play Store para poder pagar.';
      }else if(code === 'not_found'){
        t = 'La membresía todavía no está disponible';
      }else if(code === 'network'){
        t = 'Sin conexión con Google Play';
        s = 'Revisa tu internet e inténtalo otra vez';
      }else if(code === 'billing_unavailable'){
        t = 'Google Play no está disponible';
      }else if(code === 'config' || code === 'google' || code === 'http'){
        t = 'Recibimos tu pago, falta confirmarlo';
        s = 'Tu cuenta se libera sola en cuanto se confirme. Si tarda, toca «Ya pagué · Restaurar compra».';
      }
      toast(t, { icon:icon('alert'), variant:'toast-danger toast-wrap', subtitle:s, duration:6000 });
    },

    setBtn:function(txt, off){
      var b = document.getElementById('payBtn');
      if(b){ b.disabled = !!off; b.textContent = txt; }
    },
    paint:function(){
      var el = document.getElementById('paywall');
      if(!el || this.busy) return;
      var price = this.priceText();
      var b = document.getElementById('payBtn');
      if(b){ b.disabled = false; b.textContent = 'Suscribirme · ' + price + '/mes'; }
      var r = document.getElementById('restoreBtn');
      if(r){ r.disabled = false; r.textContent = 'Ya pagué · Restaurar compra'; }
      var pt = el.querySelector('[data-vp-price]');
      if(pt) pt.textContent = price + ' al mes';
    }
  };

  var baseRefreshSub = async function(){};
  if(cloudOn()){
    /* Lee también las columnas de Google Play (si la migración aún no se corre, lee lo de siempre) */
    baseRefreshSub = async function(){
      try{
        var r = await Cloud.sb.from('profiles').select('trial_start,trial_end,paid_until,vp_play_pagado_hasta,vp_play_estado,vp_play_renueva').maybeSingle();
        if(r.error) r = await Cloud.sb.from('profiles').select('trial_start,trial_end,paid_until').maybeSingle();
        if(r.data) Cloud.sub = r.data;
      }catch(e){}
      return Cloud.sub;
    };
    Cloud.refreshSub = async function(){
      var s = await baseRefreshSub();
      PlayPay.maybeSync();
      return s;
    };

    /* Ya no hay pantalla de "cuenta pausada": Vendo Plus es gratis y lo que
       se vende es Premium (ver vendo-premium.js). Esto solo limpia una
       pantalla vieja si quedó de una versión anterior. */
    Cloud.gate = function(){
      var el = document.getElementById('paywall');
      if(el){ el.remove(); VA.syncBars(); }
    };
    Cloud.checkout = function(){ return PlayPay.buy(); };

    /* Cuadrito "Membresía" en Mi cuenta */
    if(has('trialWidgetHTML')){
      var _tw = trialWidgetHTML;
      trialWidgetHTML = function(u){
        if(!Cloud.sub) return _tw.apply(this, arguments);
        var t = trialInfo(u);
        if(!t) return '';
        var price = PlayPay.priceText();
        if(!PlayPay.product && !PlayPay.loading) PlayPay.load();
        var s = Cloud.sub;
        if(t.paid){
          var play = PlayPay.hasPlay();
          var renueva = s.vp_play_renueva !== false;
          var sub = play
            ? (renueva ? price + ' al mes · se cobra sola con Google Play' : 'Activa hasta el ' + fmtDate(s.vp_play_pagado_hasta) + ' · ya no se renovará')
            : 'Activa hasta el ' + fmtDate(s.paid_until);
          return '<div class="section-title">Membresía</div>' +
            '<div class="trial-widget paid"><div class="trial-widget-top">' +
              '<span class="trial-widget-ico paid">' + icon('shield') + '</span>' +
              '<div class="trial-widget-txt"><span class="trial-widget-label">Membresía activa</span>' +
              '<span class="trial-widget-sub">' + escapeHtml(sub) + '</span></div></div>' +
            '</div>';
        }
        if(t.expired){
          return '<div class="section-title">Membresía</div>' +
            '<div class="trial-widget expired"><div class="trial-widget-top">' +
              '<span class="trial-widget-ico warn">' + icon('bell') + '</span>' +
              '<div class="trial-widget-txt"><span class="trial-widget-label">' + (t.lapsed ? 'Tu membresía venció' : 'Tu mes gratis terminó') + '</span>' +
              '<span class="trial-widget-sub">Paga tu membresía para seguir usando ' + APP_NAME + '</span></div></div>' +
              '<button class="btn dark block" style="margin-top:12px;" onclick="openMembershipPay()">Suscribirme · ' + escapeHtml(price) + '/mes</button>' +
            '</div>';
        }
        return '<div class="section-title">Membresía</div>' +
          '<div class="trial-widget"><div class="trial-widget-top">' +
            '<span class="trial-widget-ico">' + icon('gift') + '</span>' +
            '<div class="trial-widget-txt"><span class="trial-widget-label">' + (t.daysLeft === 1 ? 'Te queda 1 día gratis' : 'Te quedan ' + t.daysLeft + ' días gratis') + '</span>' +
            '<span class="trial-widget-sub">Después, ' + escapeHtml(price) + ' al mes con Google Play</span></div></div>' +
            '<div class="trial-bar"><div class="trial-bar-fill" style="width:' + t.pct + '%"></div></div>' +
          '</div>';
      };
    }

    /* Una compra que estaba pendiente se completó */
    VA.on('billing', function(d){
      var ok = (d && d.purchases || []).some(function(p){ return p.state === 'purchased'; });
      if(ok) PlayPay.sync(true);
    });
  }

  /* =======================================================================
     7) ELIMINAR CUENTA (Google Play exige que se borre de verdad)
  ======================================================================= */
  if(cloudOn() && has('confirmDeleteAccount') && has('doDeleteAccount')){
    var _doDelete = doDeleteAccount;
    confirmDeleteAccount = function(){
      openModal(
        '<h3 class="sheet-title">Eliminar cuenta</h3>' +
        '<p class="sheet-text">Se borra tu cuenta de ' + APP_NAME + ' <b>para siempre</b>: tus productos, ventas, clientes, fotos y tu Menú Digital, en este aparato y en la nube. ' +
        'Si pagas la membresía con Google Play, también se cancela su renovación. Esto no se puede deshacer.</p>' +
        '<div class="terms-row checked" id="wipeRow" style="display:none"><span class="terms-box">' + icon('check') + '</span></div>' +
        '<div class="field" style="margin-top:18px;"><label for="delWord">Escribe ELIMINAR para confirmar</label>' +
        '<input id="delWord" type="text" placeholder="ELIMINAR" autocapitalize="characters"></div>' +
        '<div class="sheet-actions">' +
          '<button class="btn ghost block" onclick="closeModal()">Cancelar</button>' +
          '<button class="btn danger block" id="delBtn" onclick="doDeleteAccount()">Eliminar cuenta</button>' +
        '</div>', { dismissible:true });
    };
    doDeleteAccount = async function(){
      var w = document.getElementById('delWord');
      var word = ((w && w.value) || '').trim().toUpperCase();
      if(word !== 'ELIMINAR'){ toast('Escribe ELIMINAR para confirmar', { variant:'toast-danger', icon:icon('close') }); return; }
      if(!Cloud.uid){ return _doDelete.apply(this, arguments); }
      var b = document.getElementById('delBtn');
      if(b){ b.disabled = true; b.textContent = 'Eliminando…'; }
      var ov = document.getElementById('modalOverlay'); if(ov) ov.dataset.lock = '1';
      try{
        await invokeFn('vp-borrar-cuenta', {});
      }catch(e){
        if(b){ b.disabled = false; b.textContent = 'Eliminar cuenta'; }
        if(ov) delete ov.dataset.lock;
        toast('No se pudo eliminar la cuenta', { icon:icon('alert'), variant:'toast-danger toast-wrap', subtitle:e.message || 'Revisa tu internet e inténtalo otra vez', duration:5000 });
        return;
      }
      try{ await Cloud.sb.auth.signOut({ scope:'local' }); }catch(e){}
      Cloud.uid = null; Cloud.sub = null; Cloud.email = '';
      /* Lo local se borra con la rutina de siempre de la página */
      if(!document.getElementById('delWord')){
        var tmp = document.createElement('div'); tmp.style.display = 'none';
        tmp.innerHTML = '<input id="delWord" value="ELIMINAR"><div id="wipeRow" class="checked"></div>';
        document.body.appendChild(tmp);
        setTimeout(function(){ tmp.remove(); }, 2000);
      }
      var row = document.getElementById('wipeRow'); if(row) row.classList.add('checked');
      safe(function(){ _doDelete(); });
      safe(function(){ Cloud.wipeLocal(); localStorage.removeItem('mesa_cloud_uid'); Cloud.gate(); });
    };
  }

  /* =======================================================================
     8) Detalles de app nativa
  ======================================================================= */
  /* Versión de la app al final de Mi cuenta (ayuda para soporte) */
  if(has('renderAccount')){
    var _ra = renderAccount;
    renderAccount = function(){
      return _ra.apply(this, arguments) + '<p class="vp-version">' + APP_NAME + ' para Android · versión ' + escapeHtml(String((VA.info && VA.info.versionName) || '1.0')) + '</p>';
    };
  }

  /* =======================================================================
     9) "HAY UNA NUEVA ACTUALIZACIÓN" (solo dentro de la app)
     -----------------------------------------------------------------------
     Google Play nos avisa cuando ya subiste una versión nueva. Entonces
     aparece abajo un letrero que dice que hay actualización y, abajito, el
     botón "Actualizar". La descarga se hace sin salir de la app: se puede
     seguir vendiendo mientras baja, y al terminar el botón cambia a
     "Reiniciar para instalar".

     En la página de internet esto no existe: solo corre en Android.
  ======================================================================= */
  safe(function(){
    var st = document.createElement('style');
    st.textContent =
      '.vp-upd{position:fixed;left:12px;right:12px;z-index:9400;' +
        'bottom:calc(12px + env(safe-area-inset-bottom,0px));' +
        'display:flex;flex-direction:column;gap:10px;' +
        'background:var(--surface,#fff);color:var(--ink,#16213E);' +
        'border:1px solid var(--border,#E4E9EE);border-radius:16px;' +
        'padding:14px 15px;box-shadow:0 10px 30px -10px rgba(22,33,62,.35);' +
        'font-family:inherit;max-width:520px;margin:0 auto;' +
        'transform:translateY(130%);opacity:0;transition:transform .32s cubic-bezier(.22,1,.36,1),opacity .32s ease;}' +
      '.vp-upd.is-on{transform:none;opacity:1;}' +
      '.vp-upd-top{display:flex;align-items:flex-start;gap:11px;}' +
      '.vp-upd-ico{flex:none;width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;' +
        'background:var(--vp-pr-suave,#E8F9EF);color:var(--vp-green,#16C15B);}' +
      '.vp-upd-ico svg{width:19px;height:19px;}' +
      '.vp-upd-txt{min-width:0;flex:1;}' +
      '.vp-upd-txt b{display:block;font-size:14.5px;font-weight:800;line-height:1.25;}' +
      '.vp-upd-txt span{display:block;margin-top:2px;font-size:12.5px;font-weight:600;line-height:1.4;color:var(--ink-soft,#6B7280);}' +
      '.vp-upd-x{flex:none;border:0;background:none;cursor:pointer;padding:4px;margin:-4px -4px 0 0;' +
        'color:var(--ink-soft,#6B7280);-webkit-tap-highlight-color:transparent;}' +
      '.vp-upd-x svg{width:17px;height:17px;display:block;}' +
      '.vp-upd-btn{width:100%;border:0;border-radius:13px;cursor:pointer;font-family:inherit;' +
        'padding:13px 14px;font-size:15px;font-weight:800;color:#fff;background:var(--vp-green,#16C15B);' +
        '-webkit-tap-highlight-color:transparent;transition:transform .12s ease,opacity .15s ease;}' +
      '.vp-upd-btn:active{transform:scale(.985);}' +
      '.vp-upd-btn[disabled]{opacity:.6;}' +
      '.vp-upd-bar{height:5px;border-radius:999px;background:var(--surface-alt,#F1F4F7);overflow:hidden;}' +
      '.vp-upd-bar i{display:block;height:100%;width:0;border-radius:999px;background:var(--vp-green,#16C15B);transition:width .3s ease;}' +
      '@media (prefers-reduced-motion: reduce){.vp-upd{transition:none;}.vp-upd-bar i{transition:none;}}';
    document.head.appendChild(st);
  });

  var updEstado = 'no', updPct = 0, updCerrado = false, updCaja = null;

  function updIcono(){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
           '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
  }
  function updCerrar(){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
           '<path d="M18 6L6 18M6 6l12 12"/></svg>';
  }
  var UPD_TXT = {
    hay:         { t:'Hay una nueva actualización', s:'Ya está lista en Play Store.', b:'Actualizar' },
    descargando: { t:'Descargando la actualización', s:'Puedes seguir usando la app mientras baja.', b:'Descargando…' },
    lista:       { t:'La actualización ya se descargó', s:'Falta instalarla: la app se reinicia un momento.', b:'Reiniciar para instalar' },
    instalando:  { t:'Instalando la actualización', s:'Un momento…', b:'Instalando…' }
  };

  function updPintar(){
    var v = UPD_TXT[updEstado];
    /* Sin actualización, cerrado a propósito, o con una ventana encima: no se muestra */
    var tapado = !!document.querySelector('#modal-layer .modal-overlay, #confirm-layer .modal-overlay');
    if(!v || updCerrado || tapado){
      if(updCaja){
        updCaja.classList.remove('is-on');
        var ir = updCaja;
        setTimeout(function(){ if(ir && ir.parentNode && !ir.classList.contains('is-on')) ir.parentNode.removeChild(ir); }, 360);
        updCaja = null;
      }
      return;
    }
    if(!updCaja){
      updCaja = document.createElement('div');
      updCaja.className = 'vp-upd';
      updCaja.setAttribute('role', 'status');
      document.body.appendChild(updCaja);
    }
    var ocupado = (updEstado === 'descargando' || updEstado === 'instalando');
    updCaja.innerHTML =
      '<div class="vp-upd-top">' +
        '<span class="vp-upd-ico">' + updIcono() + '</span>' +
        '<span class="vp-upd-txt"><b>' + v.t + '</b><span>' + v.s + '</span></span>' +
        (ocupado ? '' : '<button type="button" class="vp-upd-x" aria-label="Ahora no">' + updCerrar() + '</button>') +
      '</div>' +
      (updEstado === 'descargando' ? '<div class="vp-upd-bar"><i style="width:' + Math.max(4, updPct) + '%"></i></div>' : '') +
      '<button type="button" class="vp-upd-btn"' + (ocupado ? ' disabled' : '') + '>' + v.b + '</button>';

    var x = updCaja.querySelector('.vp-upd-x');
    if(x) x.onclick = function(){ updCerrado = true; tick(8); updPintar(); };
    var b = updCaja.querySelector('.vp-upd-btn');
    if(b && !ocupado) b.onclick = function(){
      tick(10);
      VA.call('update.start').catch(function(){
        VA.call('update.store').catch(function(){});
      });
    };
    requestAnimationFrame(function(){ if(updCaja) updCaja.classList.add('is-on'); });
  }

  VA.on('update', function(d){
    var e = (d && d.estado) || 'no';
    /* Si la actualización avanza sola (ya se bajó), el letrero vuelve
       aunque lo hubieras cerrado: ahí ya solo falta instalarla. */
    if(e === 'lista' || e === 'instalando') updCerrado = false;
    updEstado = e;
    updPct = Math.max(0, Math.min(100, Number(d && d.progreso) || 0));
    updPintar();
  });

  /* Si se abre una ventana encima, el letrero se quita y regresa al cerrarla. */
  safe(function(){
    var repintar = function(){ setTimeout(updPintar, 60); };
    if(has('openModal')){ var _om = openModal; openModal = function(){ var r = _om.apply(this, arguments); repintar(); return r; }; }
    if(has('closeModal')){ var _cm = closeModal; closeModal = function(){ var r = _cm.apply(this, arguments); repintar(); return r; }; }
  });

  /* Primera revisión: un poco después de abrir, para no estorbar el arranque. */
  setTimeout(function(){ VA.call('update.check', { force:true }).catch(function(){}); }, 4000);

  /* Al ir a segundo plano se sube lo pendiente a Supabase */
  VA.on('pause', function(){
    safe(function(){ if(cloudOn() && Cloud.uid){ clearTimeout(Cloud._t); Cloud.flush(); } });
  });
  /* Al volver: revisar membresía (cancelaciones/renovaciones) */
  VA.on('resume', function(){
    safe(function(){ if(cloudOn() && Cloud.uid) PlayPay.maybeSync(); });
    setTimeout(function(){ VA.syncBars(); }, 300);
  });
})();
