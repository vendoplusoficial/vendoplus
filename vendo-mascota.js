/* =========================================================================
   VENDO PLUS · MASCOTA Y CHAT  (vendo-mascota.js)
   -------------------------------------------------------------------------
   El cuerpo del asistente: el personaje, sus gestos y la ventana de chat.
   El que PIENSA es vendo-cerebro.js (se carga antes que este archivo).

   · El personaje está dibujado por partes (cabeza, pantalla, ojos, brote,
     brazos, pecho) para que pueda parpadear, saludar y cambiar de gesto sin
     imágenes y sin pesar nada.
   · Tiene ranuras vacías (#vp-slot-…) listas para ponerle ropa y accesorios
     más adelante, sin tocar el resto del dibujo.
   · Se arrastra, recuerda dónde lo dejaste y se esconde solo cuando estorba.
   · Es el mismo archivo para la página web y para la app de Play Store.
========================================================================= */
(function () {
  'use strict';
  if (window.VPMascota) return;

  var VERDE = '#25D366';        /* el verde de Vendo Plus */
  var VERDE_CLARO = '#4ADE80';  /* el de los ojos, sobre la pantalla oscura */
  var OSCURO = '#17181C';       /* la "pantalla" de la cara */

  /* =======================================================================
     1.  EL PERSONAJE  (SVG por partes)
  ======================================================================= */
  function svgMascota() {
    return '' +
'<svg class="vp-m-svg" viewBox="0 0 128 152" width="100%" height="100%" aria-hidden="true" focusable="false">' +
  '<defs>' +
    '<linearGradient id="vpBlanco" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E9ECF3"/>' +
    '</linearGradient>' +
    '<linearGradient id="vpVerde" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4FE593"/><stop offset="1" stop-color="' + VERDE + '"/>' +
    '</linearGradient>' +
  '</defs>' +

  /* ---- pies ---- */
  '<g class="vp-piernas">' +
    '<ellipse cx="51" cy="143" rx="11.5" ry="7.5" fill="url(#vpBlanco)"/>' +
    '<ellipse cx="77" cy="143" rx="11.5" ry="7.5" fill="url(#vpBlanco)"/>' +
  '</g>' +

  /* ---- brazos (van antes que el cuerpo: así el cuerpo los "tapa" un poco
          por dentro y se ven pegados al tronco, no flotando) ---- */
  '<g class="vp-brazo vp-brazo-izq">' +
    '<rect x="11" y="105" width="23" height="14.5" rx="7.25" fill="url(#vpBlanco)"/>' +
    '<rect x="26.5" y="106.5" width="4.5" height="11.5" rx="2.25" fill="' + OSCURO + '" opacity=".9"/>' +
    '<g id="vp-slot-mano-izq"></g>' +         /* ← ranura: objetos en la mano */
  '</g>' +
  '<g class="vp-brazo vp-brazo-der">' +
    '<rect x="94" y="105" width="23" height="14.5" rx="7.25" fill="url(#vpBlanco)"/>' +
    '<rect x="97" y="106.5" width="4.5" height="11.5" rx="2.25" fill="' + OSCURO + '" opacity=".9"/>' +
    '<g id="vp-slot-mano-der"></g>' +
  '</g>' +

  /* ---- cuerpo ---- */
  '<g class="vp-cuerpo">' +
    '<path d="M64 97c-16 0-26 8-26 21s10 20 26 20 26-7 26-20-10-21-26-21z" fill="url(#vpBlanco)"/>' +
    /* el "V" de Vendo Plus en el pecho */
    '<path d="M55 113l9 11 9-11" fill="none" stroke="' + VERDE + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<g id="vp-slot-cuerpo"></g>' +           /* ← ranura: playeras, mandiles, peto */
  '</g>' +

  /* ---- orejas / audífonos ---- */
  '<g class="vp-orejas">' +
    '<circle cx="15" cy="62" r="11.5" fill="url(#vpBlanco)"/>' +
    '<circle cx="15" cy="62" r="6" fill="url(#vpVerde)"/>' +
    '<circle cx="113" cy="62" r="11.5" fill="url(#vpBlanco)"/>' +
    '<circle cx="113" cy="62" r="6" fill="url(#vpVerde)"/>' +
  '</g>' +

  /* ---- brote de la cabeza ---- */
  '<g class="vp-brote">' +
    '<path d="M64 30V14" stroke="' + VERDE + '" stroke-width="5" stroke-linecap="round" fill="none"/>' +
    '<path d="M64 17c-1.5-8-8-10.5-14.5-9-1 7 5 13 14.5 9z" fill="url(#vpVerde)"/>' +
    '<path d="M64 12c1.5-8 8-11 14.5-9.5 1 7-5 13.5-14.5 9.5z" fill="url(#vpVerde)"/>' +
  '</g>' +

  /* ---- cabeza ---- */
  '<g class="vp-cabeza">' +
    '<rect x="14" y="28" width="100" height="72" rx="34" fill="url(#vpBlanco)"/>' +
    '<g id="vp-slot-sombrero"></g>' +         /* ← ranura: gorros, diademas, coronas */

    /* pantalla de la cara */
    '<rect x="24" y="39" width="80" height="50" rx="23" fill="' + OSCURO + '"/>' +

    /* ====== GESTOS (solo uno visible a la vez) ====== */
    '<g class="vp-ojos" fill="' + VERDE_CLARO + '">' +

      /* normal: dos cápsulas */
      '<g class="vp-gesto vp-g-normal">' +
        '<rect x="47.8" y="53.5" width="8.4" height="21" rx="4.2"/>' +
        '<rect x="71.8" y="53.5" width="8.4" height="21" rx="4.2"/>' +
      '</g>' +

      /* contento: dos arcos hacia arriba */
      '<g class="vp-gesto vp-g-feliz" fill="none" stroke="' + VERDE_CLARO + '" stroke-width="6" stroke-linecap="round">' +
        '<path d="M45 69c3.5-9 11-9 14.5 0"/>' +
        '<path d="M69 69c3.5-9 11-9 14.5 0"/>' +
      '</g>' +

      /* guiño: una cápsula y un "<" */
      '<g class="vp-gesto vp-g-guino">' +
        '<rect x="47.8" y="53.5" width="8.4" height="21" rx="4.2"/>' +
        '<path d="M82 55l-10 9 10 9" fill="none" stroke="' + VERDE_CLARO + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</g>' +

      /* emocionado: ">  <" */
      '<g class="vp-gesto vp-g-emocion" fill="none" stroke="' + VERDE_CLARO + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M46 55l10 9-10 9"/>' +
        '<path d="M82 55l-10 9 10 9"/>' +
      '</g>' +

      /* dormido: dos arcos hacia abajo */
      '<g class="vp-gesto vp-g-dormido" fill="none" stroke="' + VERDE_CLARO + '" stroke-width="6" stroke-linecap="round">' +
        '<path d="M45 60c3.5 9 11 9 14.5 0"/>' +
        '<path d="M69 60c3.5 9 11 9 14.5 0"/>' +
      '</g>' +

      /* pensando: mirando de lado + puntos suspensivos */
      '<g class="vp-gesto vp-g-pensando">' +
        '<rect x="53" y="53.5" width="8.4" height="21" rx="4.2"/>' +
        '<rect x="77" y="53.5" width="8.4" height="21" rx="4.2"/>' +
        /* los puntos van FUERA de la cabeza, como globo de pensamiento */
        '<g class="vp-puntos" fill="' + VERDE + '">' +
          '<circle class="vp-p1" cx="100" cy="22" r="3"/>' +
          '<circle class="vp-p2" cx="110" cy="16" r="4"/>' +
          '<circle class="vp-p3" cx="121" cy="9" r="5"/>' +
        '</g>' +
      '</g>' +

    '</g>' +
    '<g id="vp-slot-cara"></g>' +             /* ← ranura: lentes, antifaz, cubrebocas */
  '</g>' +
'</svg>';
  }

  /* =======================================================================
     2.  ESTILOS
     Solo se animan "transform" y "opacity": son las dos cosas que el
     navegador mueve sin repintar, así que no se siente en un celular
     viejo ni gasta batería.
  ======================================================================= */
  var CSS = `
#vp-mascota{
  /* top/left en 0 a propósito: así "translate3d" cuenta desde la esquina de
     la pantalla. Sin esto, el navegador lo coloca donde habría caído dentro
     de la página y termina encima de la barra de abajo. */
  position:fixed; top:0; left:0; z-index:200; width:62px; height:74px;
  touch-action:none; -webkit-user-select:none; user-select:none; cursor:grab;
  will-change:transform; contain:layout style;
  transition:opacity .22s ease, transform .26s cubic-bezier(.34,1.3,.64,1);
  filter:drop-shadow(0 6px 14px rgba(22,33,62,.18));
}
#vp-mascota.vp-arrastrando{ cursor:grabbing; transition:none; filter:drop-shadow(0 14px 22px rgba(22,33,62,.26)); }
#vp-mascota.vp-oculta{ opacity:0; transform:translateY(16px) scale(.72); pointer-events:none; }
#vp-mascota.vp-dormida{ filter:drop-shadow(0 4px 10px rgba(22,33,62,.12)); opacity:.72; }

.vp-m-flota{ width:100%; height:100%; animation:vp-flotar 3.6s ease-in-out infinite; }
#vp-mascota.vp-arrastrando .vp-m-flota,
#vp-mascota.vp-oculta .vp-m-flota{ animation-play-state:paused; }
@keyframes vp-flotar{ 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-6px) } }

.vp-m-svg{ display:block; overflow:visible; }

/* ---- gestos: solo uno visible ---- */
.vp-gesto{ display:none; }
#vp-mascota[data-gesto="normal"]   .vp-g-normal,
#vp-mascota[data-gesto="feliz"]    .vp-g-feliz,
#vp-mascota[data-gesto="guino"]    .vp-g-guino,
#vp-mascota[data-gesto="emocion"]  .vp-g-emocion,
#vp-mascota[data-gesto="dormido"]  .vp-g-dormido,
#vp-mascota[data-gesto="pensando"] .vp-g-pensando{ display:block; }

/* ---- parpadeo ---- */
.vp-ojos{ transform-origin:64px 64px; }
#vp-mascota.vp-parpadea .vp-ojos{ transform:scaleY(.08); }
.vp-ojos{ transition:transform .09s ease; }

/* ---- saludo con el brazo ---- */
.vp-brazo-der{ transform-origin:98px 112px; }
#vp-mascota.vp-saluda .vp-brazo-der{ animation:vp-saludo .5s ease-in-out 3; }
@keyframes vp-saludo{ 0%,100%{ transform:rotate(0) } 35%{ transform:rotate(-34deg) } 70%{ transform:rotate(-12deg) } }

/* ---- brote que rebota al aparecer ---- */
.vp-brote{ transform-origin:64px 30px; }
#vp-mascota.vp-llega .vp-brote{ animation:vp-brote .6s cubic-bezier(.34,1.56,.64,1); }
@keyframes vp-brote{ 0%{ transform:scale(.4) rotate(-14deg) } 60%{ transform:scale(1.12) rotate(6deg) } 100%{ transform:scale(1) } }

/* ---- puntos de "pensando" ---- */
.vp-puntos circle{ animation:vp-punto 1.1s ease-in-out infinite; }
.vp-puntos .vp-p2{ animation-delay:.16s } .vp-puntos .vp-p3{ animation-delay:.32s }
@keyframes vp-punto{ 0%,100%{ opacity:.25; transform:translateY(0) } 50%{ opacity:1; transform:translateY(-2.5px) } }

/* ---- globito de aviso ---- */
.vp-m-burbuja{
  position:absolute; bottom:calc(100% + 4px); right:0; max-width:168px;
  background:var(--surface,#fff); color:var(--ink,#16213E);
  border:1px solid var(--border,#E8EBF2); border-radius:14px;
  padding:8px 11px; font-size:12.5px; font-weight:600; line-height:1.35;
  box-shadow:var(--shadow-pop,0 10px 26px rgba(22,33,62,.14));
  opacity:0; transform:translateY(6px) scale(.94); pointer-events:none;
  transition:opacity .2s ease, transform .2s cubic-bezier(.34,1.3,.64,1);
  white-space:normal;
}
#vp-mascota.vp-izquierda .vp-m-burbuja{ right:auto; left:0; }
#vp-mascota.vp-habla .vp-m-burbuja{ opacity:1; transform:translateY(0) scale(1); }

/* =======================  VENTANA DE CHAT  =======================

   Son DOS capas, y es a propósito:

   1. #vp-chat    · una sábana blanca que SIEMPRE mide toda la pantalla de
                    maquetación y nunca se mueve ni cambia de tamaño.
                    Su único trabajo es que, pase lo que pase con el
                    teclado o con el dedo, NUNCA se pueda ver la página de
                    atrás. Antes el chat se encogía con el teclado y por
                    ese hueco se asomaban los productos.

   2. .vp-ch-caja · el chat de verdad (encabezado, mensajes, campo), que
                    se coloca justo sobre la franja que SÍ se ve. Si queda
                    una orilla sin cubrir, lo que se ve ahí es la sábana
                    blanca, no la tienda.

   Si algún día falla la medición, lo peor que pasa es que se vea un
   pedazo blanco. Nunca el fondo. */
#vp-chat{
  position:fixed; z-index:460; left:0; top:0; width:100%; height:100%;
  pointer-events:none; visibility:hidden;
  background:var(--surface,#fff);
  overscroll-behavior:none; overflow:hidden;
}
#vp-chat.vp-abierto{ pointer-events:auto; visibility:visible; }
html.vp-chat-abierto, body.vp-chat-abierto{ overflow:hidden !important; overscroll-behavior:none !important; }

.vp-ch-caja{
  position:absolute; left:0; right:0; top:0; height:100%;
  width:100%; background:var(--surface,#fff);
  display:flex; flex-direction:column; overflow:hidden;
  transform:translateY(100%); transition:transform .3s cubic-bezier(.32,.72,0,1);
  overscroll-behavior:none;
}
#vp-chat.vp-abierto .vp-ch-caja{ transform:translateY(0); }

/* En computadora sí es un panel en la esquina: ahí no hay teclado que
   estorbe y taparlo todo no tendría sentido. */
@media (min-width:700px){
  #vp-chat{ background:transparent; }
  .vp-ch-caja{
    top:auto; left:auto; right:18px; bottom:18px;
    width:400px; height:min(640px, calc(100% - 36px));
    border-radius:20px; box-shadow:var(--shadow-pop,0 10px 26px rgba(22,33,62,.18));
    border:1px solid var(--border,#E8EBF2);
  }
}

/* El encabezado NO se mueve nunca: la equis siempre está arriba. */
.vp-ch-top{
  display:flex; align-items:center; gap:10px;
  padding:13px 14px; padding-top:calc(13px + env(safe-area-inset-top));
  border-bottom:1px solid var(--border,#E8EBF2);
  flex:0 0 auto; background:var(--surface,#fff); position:relative; z-index:2;
}
@media (min-width:700px){ .vp-ch-top{ padding-top:13px; } }
.vp-ch-cara{ width:40px; height:34px; flex-shrink:0; }
.vp-ch-cara svg{ width:100%; height:100%; }
.vp-ch-tit{ flex:1; min-width:0; }
.vp-ch-tit b{ display:block; font-size:15px; font-weight:800; color:var(--ink,#16213E); }
.vp-ch-tit span{ display:block; font-size:11.5px; font-weight:600; color:var(--ink-soft,#8A93AC); margin-top:1px; }
.vp-ch-btn{
  width:38px; height:38px; border:0; background:var(--surface-alt,#F0F2F8);
  border-radius:12px; color:var(--ink,#16213E); display:flex;
  align-items:center; justify-content:center; flex-shrink:0; padding:0;
}
.vp-ch-btn:active{ transform:scale(.92); }
.vp-ch-btn svg{ width:19px; height:19px; }

/* "min-height:0" es la línea que arregla el desorden al deslizar.
   Sin ella, un hijo flexible que scrollea NO se deja encoger: la caja se
   desborda, el encabezado se empuja fuera de la pantalla y por abajo se
   asoma la página. Es el bug clásico de flexbox.
   "overscroll-behavior:none" evita que el jalón de más arrastre la página
   de atrás (el efecto de liga del celular). */
.vp-ch-msgs{
  flex:1 1 auto; min-height:0;
  overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:none;
  padding:14px; display:flex; flex-direction:column; gap:10px;
}
.vp-msg{ max-width:88%; padding:10px 13px; border-radius:15px; font-size:14px; line-height:1.45; white-space:pre-wrap; word-wrap:break-word; animation:vp-entra .22s ease; }
@keyframes vp-entra{ from{ opacity:0; transform:translateY(7px) } to{ opacity:1; transform:none } }
.vp-msg.vp-yo{ align-self:flex-end; background:${VERDE}; color:#fff; border-bottom-right-radius:5px; font-weight:600; }
.vp-msg.vp-el{ align-self:flex-start; background:var(--surface-alt,#F0F2F8); color:var(--ink,#16213E); border-bottom-left-radius:5px; }

.vp-tabla{ margin-top:9px; border-top:1px solid rgba(22,33,62,.09); padding-top:7px; display:flex; flex-direction:column; gap:3px; }
.vp-fila{ display:flex; justify-content:space-between; gap:12px; font-size:13px; }
.vp-fila span{ color:var(--ink-soft,#8A93AC); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vp-fila b{ font-weight:800; flex-shrink:0; }

.vp-pensando{ align-self:flex-start; display:flex; gap:4px; padding:12px 14px; background:var(--surface-alt,#F0F2F8); border-radius:15px; border-bottom-left-radius:5px; }
.vp-pensando i{ width:6px; height:6px; border-radius:50%; background:var(--ink-faint,#C9CEDD); animation:vp-punto 1.1s ease-in-out infinite; }
.vp-pensando i:nth-child(2){ animation-delay:.16s } .vp-pensando i:nth-child(3){ animation-delay:.32s }

.vp-chips{ display:flex; flex-wrap:wrap; gap:7px; padding:0 14px 10px; flex:0 0 auto; }
.vp-chip{
  border:1px solid var(--border,#E8EBF2); background:var(--surface,#fff);
  color:var(--ink,#16213E); border-radius:999px; padding:7px 13px;
  font-size:12.5px; font-weight:700; font-family:inherit; line-height:1.2;
}
.vp-chip:active{ transform:scale(.95); background:var(--surface-alt,#F0F2F8); }

.vp-ch-abajo{
  display:flex; gap:8px; padding:10px 14px calc(12px + env(safe-area-inset-bottom));
  border-top:1px solid var(--border,#E8EBF2); flex:0 0 auto; align-items:flex-end;
  background:var(--surface,#fff);
}
@media (min-width:700px){ .vp-ch-abajo{ padding-bottom:12px; } }
.vp-ch-abajo input{
  flex:1; min-width:0; border:1px solid var(--border,#E8EBF2); background:var(--surface-alt,#F0F2F8);
  border-radius:12px; padding:11px 13px; font-size:16px; color:var(--ink,#16213E); font-family:inherit;
}
.vp-ch-abajo input:focus{ outline:none; border-color:${VERDE}; background:var(--surface,#fff); }
.vp-enviar{
  width:42px; height:42px; flex-shrink:0; border:0; border-radius:12px;
  background:${VERDE}; color:#fff; display:flex; align-items:center; justify-content:center; padding:0;
}
.vp-enviar:disabled{ background:var(--ink-faint,#C9CEDD); }
.vp-enviar:active:not(:disabled){ transform:scale(.93); }
.vp-enviar svg{ width:19px; height:19px; }

/* panel de costos */
.vp-costos{ padding:14px; font-size:13.5px; color:var(--ink,#16213E); }
.vp-costos h4{ margin:0 0 10px; font-size:14px; font-weight:800; }
.vp-costos .vp-fila{ padding:5px 0; border-bottom:1px solid var(--border,#E8EBF2); font-size:13.5px; }
.vp-barra{ height:9px; border-radius:99px; background:var(--surface-alt,#F0F2F8); overflow:hidden; margin:10px 0 4px; }
.vp-barra i{ display:block; height:100%; background:${VERDE}; border-radius:99px; transition:width .4s ease; }
.vp-nota{ font-size:11.5px; color:var(--ink-soft,#8A93AC); line-height:1.5; margin-top:10px; }

@media (prefers-reduced-motion:reduce){
  .vp-m-flota,#vp-mascota.vp-saluda .vp-brazo-der,#vp-mascota.vp-llega .vp-brote,
  .vp-puntos circle,.vp-pensando i{ animation:none !important; }
  #vp-mascota,.vp-ch-caja,.vp-msg{ transition-duration:.01ms !important; animation:none !important; }
}
`;

  /* =======================================================================
     3.  ARRANQUE
  ======================================================================= */
  var nodo, flota, burbuja, chat, msgs, entrada, chipsBox;
  var abierto = false, arrastrando = false, movio = false;
  var pos = { x: 0, y: 0 }, inicio = null;
  var tOcio = null, tParpadeo = null, tBurbuja = null;

  var K_POS = 'vp_mascota_pos';
  var K_VISTO = 'vp_mascota_bienvenida';

  function estilos() {
    if (document.getElementById('vp-mascota-css')) return;
    var s = document.createElement('style');
    s.id = 'vp-mascota-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ico(n) {
    var m = {
      cerrar: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
      enviar: '<path d="M3.4 20.4l18.1-8.4a1 1 0 0 0 0-1.9L3.4 3.6a.9.9 0 0 0-1.3 1l2.2 6.6a1 1 0 0 0 .8.7l9.1 1.1-9.1 1.1a1 1 0 0 0-.8.7l-2.2 6.6a.9.9 0 0 0 1.3 1z" fill="currentColor"/>',
      grafica: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
      atras: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none">' + (m[n] || '') + '</svg>';
  }

  function crear() {
    if (document.getElementById('vp-mascota')) return;   /* nunca duplicar */
    estilos();

    nodo = document.createElement('div');
    nodo.id = 'vp-mascota';
    nodo.setAttribute('role', 'button');
    nodo.setAttribute('tabindex', '0');
    nodo.setAttribute('aria-label', 'Asistente de Vendo Plus');
    nodo.dataset.gesto = 'normal';
    nodo.innerHTML = '<div class="vp-m-burbuja"></div><div class="vp-m-flota">' + svgMascota() + '</div>';
    document.body.appendChild(nodo);

    flota = nodo.querySelector('.vp-m-flota');
    burbuja = nodo.querySelector('.vp-m-burbuja');

    colocar(leerPos());
    arrastre();
    crearChat();
    observar();
    parpadearLuego();
    ocioLuego();

    nodo.classList.add('vp-llega');
    setTimeout(function () { nodo.classList.remove('vp-llega'); }, 700);

    /* La primera vez saluda; después ya no molesta. */
    try {
      if (!localStorage.getItem(K_VISTO)) {
        setTimeout(function () {
          saludar();
          decir('Tócame y pregúntame cómo va tu negocio', 5200);
          try { localStorage.setItem(K_VISTO, '1'); } catch (e) {}
        }, 1400);
      }
    } catch (e) {}

    revisar();
  }

  /* ---------- posición ---------- */
  function leerPos() {
    try {
      var p = JSON.parse(localStorage.getItem(K_POS) || 'null');
      if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
    } catch (e) {}
    return { x: 1, y: 0.56 };     /* por defecto: orilla derecha, a media altura */
  }
  function guardarPos() {
    try { localStorage.setItem(K_POS, JSON.stringify(pos)); } catch (e) {}
  }
  /** Se guarda en porcentaje de pantalla para que aguante girar el celular. */
  function colocar(p) {
    pos = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
    pintar();
  }
  function pintar() {
    if (!nodo) return;
    var m = 10;
    var w = nodo.offsetWidth || 62, h = nodo.offsetHeight || 74;
    var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 76;
    var maxX = window.innerWidth - w - m;
    var topeAlto = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 56) + m;
    var maxY = window.innerHeight - h - navH - m;
    var x = m + pos.x * Math.max(0, maxX - m);
    var y = topeAlto + pos.y * Math.max(0, maxY - topeAlto);
    nodo.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    nodo.classList.toggle('vp-izquierda', pos.x < 0.5);
  }

  /* ---------- arrastrar ---------- */
  function arrastre() {
    var id = null, dx = 0, dy = 0;

    nodo.addEventListener('pointerdown', function (e) {
      if (abierto) return;
      id = e.pointerId; movio = false; arrastrando = true;
      inicio = { x: e.clientX, y: e.clientY, t: Date.now() };
      var r = nodo.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      nodo.classList.add('vp-arrastrando');
      try { nodo.setPointerCapture(id); } catch (x) {}
      despertar();
    });

    nodo.addEventListener('pointermove', function (e) {
      if (!arrastrando || e.pointerId !== id) return;
      if (!movio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 6) movio = true;
      if (!movio) return;
      e.preventDefault();
      var w = nodo.offsetWidth, h = nodo.offsetHeight, m = 10;
      var x = Math.min(window.innerWidth - w - m, Math.max(m, e.clientX - dx));
      var y = Math.min(window.innerHeight - h - m, Math.max(m, e.clientY - dy));
      nodo.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    });

    function soltar(e) {
      if (!arrastrando || (e && e.pointerId !== id)) return;
      arrastrando = false;
      nodo.classList.remove('vp-arrastrando');
      try { nodo.releasePointerCapture(id); } catch (x) {}
      if (!movio) { abrirChat(); return; }
      /* se pega a la orilla más cercana y se queda a esa altura */
      var r = nodo.getBoundingClientRect();
      var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 76;
      var topeAlto = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 56) + 10;
      var maxY = window.innerHeight - r.height - navH - 10;
      var y = maxY > topeAlto ? (r.top - topeAlto) / (maxY - topeAlto) : 0.5;
      colocar({ x: (r.left + r.width / 2) < window.innerWidth / 2 ? 0 : 1, y: y });
      guardarPos();
    }
    nodo.addEventListener('pointerup', soltar);
    nodo.addEventListener('pointercancel', soltar);
    nodo.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirChat(); }
    });
    window.addEventListener('resize', pintar);
    window.addEventListener('orientationchange', function () { setTimeout(pintar, 220); });
  }

  /* ---------- gestos ---------- */
  function gesto(g, ms) {
    if (!nodo) return;
    nodo.dataset.gesto = g;
    if (ms) setTimeout(function () { if (nodo.dataset.gesto === g) nodo.dataset.gesto = 'normal'; }, ms);
  }
  function saludar() {
    if (!nodo) return;
    nodo.classList.add('vp-saluda');
    gesto('feliz', 1900);
    setTimeout(function () { nodo.classList.remove('vp-saluda'); }, 1600);
  }
  function parpadearLuego() {
    clearTimeout(tParpadeo);
    tParpadeo = setTimeout(function () {
      if (nodo && !nodo.classList.contains('vp-oculta') && nodo.dataset.gesto === 'normal') {
        nodo.classList.add('vp-parpadea');
        setTimeout(function () { nodo.classList.remove('vp-parpadea'); }, 110);
        /* de vez en cuando, dos parpadeos seguidos: se ve vivo */
        if (Math.random() < 0.22) setTimeout(function () {
          nodo.classList.add('vp-parpadea');
          setTimeout(function () { nodo.classList.remove('vp-parpadea'); }, 110);
        }, 220);
      }
      parpadearLuego();
    }, 2600 + Math.random() * 4200);
  }
  /** Sin tocarlo un buen rato, se queda dormido (y deja de gastar animación). */
  function ocioLuego() {
    clearTimeout(tOcio);
    tOcio = setTimeout(function () {
      if (nodo && !abierto) { nodo.classList.add('vp-dormida'); gesto('dormido'); }
    }, 75000);
  }
  function despertar() {
    if (!nodo) return;
    if (nodo.classList.contains('vp-dormida')) { nodo.classList.remove('vp-dormida'); gesto('normal'); }
    ocioLuego();
  }
  function decir(texto, ms) {
    if (!nodo || !burbuja) return;
    burbuja.textContent = texto;
    nodo.classList.add('vp-habla');
    clearTimeout(tBurbuja);
    tBurbuja = setTimeout(function () { nodo.classList.remove('vp-habla'); }, ms || 3600);
  }

  /* =======================================================================
     4.  OCULTAMIENTO INTELIGENTE
     El personaje desaparece cuando estorba y regresa solo cuando ya no.
  ======================================================================= */
  var tecladoAbierto = false, altoBase = 0;

  function hayTeclado() {
    var vv = window.visualViewport;
    if (!vv) return tecladoAbierto;
    if (!altoBase || vv.height > altoBase) altoBase = vv.height;
    return (altoBase - vv.height) > Math.max(130, altoBase * 0.2);
  }

  /**
   * Razones de AFUERA para quitarse: algo de Vendo Plus se puso encima, o
   * el negocio apagó el asistente. Estas valen tanto para el personaje
   * como para el chat, y son las únicas que cierran el chat.
   */
  function estorbaAlgo() {
    try {
      var html = document.documentElement, body = document.body;
      /* el negocio lo apagó desde Mi cuenta */
      if (apagada()) return true;
      /* una hoja abierta: cobrar, carrito, formularios, confirmaciones */
      if (html.classList.contains('modal-open')) return true;
      /* cámara / escáner de códigos */
      if (document.querySelector('#scan-layer .modal-overlay')) return true;
      if (document.querySelector('#confirm-layer .modal-overlay')) return true;
      /* pantallas donde no pinta nada: menú digital público y la de entrar */
      if (body.classList.contains('dm-mode')) return true;
      if (body.classList.contains('auth-open')) return true;
      /* la cuenta sin sesión todavía */
      if (!body.dataset.section) return true;
    } catch (e) {}
    return false;
  }

  /**
   * ¿Se esconde el PERSONAJE? Son las de arriba, más las suyas propias.
   *
   * Ojo con no mezclar las dos cosas: "escóndete" no es lo mismo que
   * "cierra el chat". Cuando el chat está abierto el personaje se esconde
   * (lo tapa el chat), pero eso NO quiere decir que haya que cerrar el
   * chat. Tenerlo junto hacía que el chat se cerrara solo a los 3
   * milisegundos de abrirse.
   */
  function debeOcultarse() {
    if (estorbaAlgo()) return true;
    if (abierto) return true;              /* el chat ya lo tapa */
    if (hayTeclado()) return true;
    try {
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    } catch (e) {}
    return false;
  }

  var rafPend = false;
  function revisar() {
    if (rafPend) return;
    rafPend = true;
    requestAnimationFrame(function () {
      rafPend = false;
      if (!nodo) return;
      /* El chat solo se cierra por algo de AFUERA (abrieron el cobro, el
         escáner, se apagó el asistente). Nunca por el hecho de estar
         abierto, que era el error de antes. */
      if (abierto && estorbaAlgo()) cerrarChat();
      var esconder = debeOcultarse();
      nodo.classList.toggle('vp-oculta', esconder);
      if (!esconder) pintar();
    });
  }

  function observar() {
    /* clases de <html> y <body>: hojas abiertas, menú público, login, sección */
    var mo = new MutationObserver(revisar);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-section'] });
    /* capas que se crean solas: escáner y confirmaciones */
    new MutationObserver(revisar).observe(document.body, { childList: true });
    var cl = document.getElementById('confirm-layer');
    if (cl) new MutationObserver(revisar).observe(cl, { childList: true });

    document.addEventListener('focusin', revisar, true);
    document.addEventListener('focusout', function () { setTimeout(revisar, 160); }, true);
    if (window.visualViewport) {
      var vv = window.visualViewport;
      /* "resize" avisa que el teclado cambió el alto.
         "scroll" avisa que el iPhone movió la parte visible. Sin este
         segundo, el chat se queda arriba y se asoma la página de atrás. */
      vv.addEventListener('resize', function () { revisar(); acomodarChat(); });
      vv.addEventListener('scroll', acomodarChat);
    }
    window.addEventListener('resize', revisar);
    /* por si algo se nos escapa, una revisión muy barata cada tanto */
    setInterval(revisar, 1600);
  }

  /* =======================================================================
     5.  CHAT
  ======================================================================= */
  function caraChica() {
    return '<svg viewBox="0 0 128 108" width="100%" height="100%" aria-hidden="true">' +
      '<path d="M64 34V17" stroke="' + VERDE + '" stroke-width="5" stroke-linecap="round" fill="none"/>' +
      '<path d="M64 20c-1.5-8-8-10.5-14.5-9-1 7 5 13 14.5 9z" fill="' + VERDE + '"/>' +
      '<path d="M64 15c1.5-8 8-11 14.5-9.5 1 7-5 13.5-14.5 9.5z" fill="' + VERDE + '"/>' +
      '<circle cx="15" cy="68" r="11" fill="#E9ECF3"/><circle cx="15" cy="68" r="5.8" fill="' + VERDE + '"/>' +
      '<circle cx="113" cy="68" r="11" fill="#E9ECF3"/><circle cx="113" cy="68" r="5.8" fill="' + VERDE + '"/>' +
      '<rect x="14" y="33" width="100" height="70" rx="33" fill="#fff" stroke="#E8EBF2" stroke-width="2"/>' +
      '<rect x="24" y="44" width="80" height="48" rx="22" fill="' + OSCURO + '"/>' +
      '<rect x="47.8" y="57" width="8.4" height="21" rx="4.2" fill="' + VERDE_CLARO + '"/>' +
      '<rect x="71.8" y="57" width="8.4" height="21" rx="4.2" fill="' + VERDE_CLARO + '"/>' +
    '</svg>';
  }

  function crearChat() {
    if (document.getElementById('vp-chat')) return;
    chat = document.createElement('div');
    chat.id = 'vp-chat';
    chat.innerHTML =
      '<div class="vp-ch-caja" role="dialog" aria-label="Asistente de Vendo Plus">' +
        '<div class="vp-ch-top">' +
          '<div class="vp-ch-cara">' + caraChica() + '</div>' +
          '<div class="vp-ch-tit"><b>Asistente</b><span id="vp-ch-sub">Pregúntame de tu negocio</span></div>' +
          '<button class="vp-ch-btn" id="vp-ch-cerrar" aria-label="Cerrar">' + ico('cerrar') + '</button>' +
        '</div>' +
        '<div class="vp-ch-msgs" id="vp-ch-msgs"></div>' +
        '<div class="vp-chips" id="vp-ch-chips"></div>' +
        '<div class="vp-ch-abajo">' +
          '<input id="vp-ch-in" type="text" placeholder="¿Cuánto vendí hoy?" autocomplete="off" ' +
            'autocorrect="off" autocapitalize="sentences" spellcheck="false" maxlength="200" enterkeyhint="send">' +
          '<button class="vp-enviar" id="vp-ch-enviar" aria-label="Enviar">' + ico('enviar') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(chat);

    msgs = chat.querySelector('#vp-ch-msgs');
    entrada = chat.querySelector('#vp-ch-in');
    chipsBox = chat.querySelector('#vp-ch-chips');

    chat.querySelector('#vp-ch-cerrar').onclick = cerrarChat;
    chat.querySelector('#vp-ch-enviar').onclick = enviar;
    entrada.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); enviar(); } });
    /* Cerrar tocando fuera de la ventana.
       El "if" del tiempo arregla una falla fea: al tocar al personaje, este
       se esconde entre el pointerup y el click, así que para cuando llega
       el click el que está debajo del dedo ya es el chat… y se cerraba solo.
       Pasaba "a veces" porque depende de cuánto tarde el toque.
       En el celular el chat ocupa todo, así que aquí solo entra en
       computadora, donde sí queda espacio alrededor. */
    chat.addEventListener('click', function (e) {
      if (e.target !== chat) return;
      if (Date.now() - abiertoEn < 450) return;
      /* Solo en computadora. En el celular el chat ocupa todo y lo que se
         ve alrededor es su propia sábana blanca: si ahí cerrara, se
         cerraría solo al tocar cerca del teclado. Ahí se cierra con la
         equis y ya. */
      if (window.innerWidth < 700) return;
      cerrarChat();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && abierto) cerrarChat(); });

    /* Último candado: dentro del chat, el dedo solo puede mover la lista
       de mensajes. En cualquier otro lado el movimiento se ignora, para
       que no arrastre nada ni rebote mostrando lo de atrás. */
    chat.addEventListener('touchmove', function (e) {
      if (!abierto) return;
      if (msgs && msgs.contains(e.target)) return;   /* la lista sí se desliza */
      e.preventDefault();
    }, { passive: false });
  }

  /**
   * Le da al chat el alto REAL de lo que se ve.
   * En el celular no sirve 100vh: no descuenta la barra del navegador ni
   * el teclado, así que la caja queda más alta que la pantalla, el
   * encabezado se va para arriba y por abajo se asoma la página.
   * visualViewport sí dice la verdad, y además se mueve con el teclado.
   */
  /**
   * Pone el chat EXACTAMENTE sobre la parte de la pantalla que se ve.
   *
   * Por qué tanto lío, en corto:
   * el iPhone tiene dos "pantallas". La de maquetación (layout viewport),
   * que no cambia de tamaño nunca, y la visual, que es lo que de verdad
   * alcanzas a ver y que el teclado encoge Y DESPLAZA hacia arriba.
   * Un elemento con position:fixed se amarra a la de maquetación, así que
   * cuando sale el teclado el chat se va con ella hacia arriba y se asoma
   * la página de atrás. Eso era lo que pasaba.
   *
   * La cura son tres cosas juntas, y las tres hacen falta:
   *   1. trabar el cuerpo de la página con position:fixed (abajo), para
   *      que la de maquetación ya no se pueda mover;
   *   2. darle al chat el alto de la visual (vv.height);
   *   3. bajarlo tantos píxeles como se haya desplazado la visual
   *      (vv.offsetTop), escuchando TAMBIÉN el evento "scroll" del
   *      visualViewport, que es el que avisa de ese desplazamiento.
   *      Antes solo se escuchaba "resize", y por eso se descuadraba.
   */
  var ultimoAcomodo = '';

  function acomodarChat() {
    if (!chat || !abierto) return;
    var caja = chat.querySelector('.vp-ch-caja');
    if (!caja) return;

    /* En computadora es un panel de esquina: lo coloca el CSS y no hay
       teclado que lo mueva. Aquí no tocamos nada. */
    if (window.innerWidth >= 700) {
      if (ultimoAcomodo !== 'pc') { caja.style.top = ''; caja.style.height = ''; ultimoAcomodo = 'pc'; }
      return;
    }

    var vv = window.visualViewport;
    var arriba = vv ? Math.round(vv.offsetTop || 0) : 0;
    var alto = Math.round(vv ? vv.height : window.innerHeight);

    /* Se escribe solo cuando de verdad cambió: si no, cada movimiento del
       dedo haría recalcular la página de balde. */
    var firma = arriba + ':' + alto;
    if (firma === ultimoAcomodo) return;
    ultimoAcomodo = firma;

    caja.style.top = arriba + 'px';
    caja.style.height = alto + 'px';
  }

  /* Red de seguridad.
     Mientras el chat está abierto se revisa cada tantito. Los eventos del
     teclado no siempre llegan (ni llegan igual en Android que en iPhone),
     y si se pierde uno, el chat se queda descuadrado. Revisar es casi
     gratis: si nada cambió, no se escribe nada. */
  var vigilante = null;
  function vigilar(si) {
    clearInterval(vigilante);
    vigilante = null;
    if (si) vigilante = setInterval(acomodarChat, 120);
  }

  /**
   * Traba y destraba la página de atrás.
   * Con "overflow:hidden" no basta en iPhone: Safari igual mueve la página
   * para enseñar el campo donde escribes. Con position:fixed sí se queda
   * quieta. Se apunta dónde iba para regresarla ahí al cerrar.
   */
  function trabarFondo(si) {
    var b = document.body, h = document.documentElement;
    if (si) {
      scrollGuardado = window.scrollY || window.pageYOffset || 0;
      b.style.position = 'fixed';
      b.style.top = (-scrollGuardado) + 'px';
      b.style.left = '0';
      b.style.right = '0';
      b.style.width = '100%';
      h.classList.add('vp-chat-abierto');
      b.classList.add('vp-chat-abierto');
    } else {
      b.style.position = '';
      b.style.top = '';
      b.style.left = '';
      b.style.right = '';
      b.style.width = '';
      h.classList.remove('vp-chat-abierto');
      b.classList.remove('vp-chat-abierto');
      try { window.scrollTo(0, scrollGuardado); } catch (e) {}
    }
  }

  var scrollGuardado = 0;
  var abiertoEn = 0;        /* cuándo se abrió, para ignorar el click rezagado */

  function abrirChat() {
    if (abierto || !chat) return;
    if (debeOcultarse()) return;
    abierto = true;
    abiertoEn = Date.now();
    despertar();
    acomodarChat();                 /* el alto correcto ANTES de que entre */
    chat.classList.add('vp-abierto');
    nodo.classList.add('vp-oculta');
    /* Se traba la página de atrás: sin esto, el jalón dentro del chat
       arrastra la pantalla de abajo y se ve el fondo moverse.
       Se apunta en dónde iba para devolverla ahí misma al cerrar. */
    trabarFondo(true);
    ultimoAcomodo = '';
    vigilar(true);
    gesto('feliz', 1600);
    if (!msgs.childElementCount) {
      var VC = window.VPCerebro;
      if (VC && VC.listo && VC.listo()) {
        VC.responder('hola').then(function (r) { pintarRespuesta(r); });
      } else {
        pintarRespuesta({ texto: 'Pregúntame cómo va tu negocio.', chips: ['¿Cuánto vendí hoy?', '¿Cuál fue mi ganancia?', '¿Qué está por agotarse?'] });
      }
    }
    setTimeout(acomodarChat, 60);
  }

  function cerrarChat() {
    if (!abierto || !chat) return;
    abierto = false;
    chat.classList.remove('vp-abierto');
    /* Se destraba la página y se regresa justo a donde iba.
       Si esto no se hace, Vendo Plus se queda sin poder deslizarse. */
    trabarFondo(false);
    vigilar(false);
    ultimoAcomodo = '';
    /* se limpia lo que se puso a mano, para que no quede una medida vieja */
    var caja = chat.querySelector('.vp-ch-caja');
    if (caja) { caja.style.top = ''; caja.style.height = ''; }
    try { entrada.blur(); } catch (e) {}
    setTimeout(revisar, 220);
  }

  function burbujaMsg(clase, html) {
    var d = document.createElement('div');
    d.className = 'vp-msg ' + clase;
    d.innerHTML = html;
    msgs.appendChild(d);
    hastaAbajo();
    return d;
  }
  /* El mensaje entra con una animación que cambia el alto, así que bajar
     en ese instante se queda corto y la última respuesta no se alcanza a
     ver. Se baja en el cuadro siguiente y otra vez al terminar. */
  function hastaAbajo() {
    if (!msgs) return;
    msgs.scrollTop = msgs.scrollHeight;
    requestAnimationFrame(function () {
      msgs.scrollTop = msgs.scrollHeight;
      setTimeout(function () { msgs.scrollTop = msgs.scrollHeight; }, 260);
    });
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pintarRespuesta(r) {
    var html = esc(r.texto);
    if (r.detalle && r.detalle.length) {
      html += '<div class="vp-tabla">' + r.detalle.map(function (f) {
        return '<div class="vp-fila"><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b></div>';
      }).join('') + '</div>';
    }
    burbujaMsg('vp-el', html);
    pintarChips(r.chips);
    hastaAbajo();
    var sub = chat.querySelector('#vp-ch-sub');
    if (sub) sub.textContent = r.fuente === 'ninguna' ? 'No entendí esa' : 'Respuesta con tus datos';
  }

  function pintarChips(lista) {
    chipsBox.innerHTML = '';
    (lista || []).slice(0, 4).forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'vp-chip';
      b.type = 'button';
      b.textContent = t;
      b.onclick = function () { entrada.value = t; enviar(); };
      chipsBox.appendChild(b);
    });
  }

  var enviando = false;
  function enviar() {
    if (enviando) return;
    var t = (entrada.value || '').trim();
    if (!t) return;
    entrada.value = '';
    chipsBox.innerHTML = '';
    burbujaMsg('vp-yo', esc(t));
    enviando = true;
    chat.querySelector('#vp-ch-enviar').disabled = true;

    var espera = document.createElement('div');
    espera.className = 'vp-pensando';
    espera.innerHTML = '<i></i><i></i><i></i>';
    msgs.appendChild(espera);
    hastaAbajo();

    var VC = window.VPCerebro;
    var p = VC ? VC.responder(t) : Promise.resolve({ texto: 'El asistente todavía está cargando.', fuente: 'ninguna' });
    p.then(function (r) {
      espera.remove();
      pintarRespuesta(r || { texto: 'No pude contestar eso.', fuente: 'ninguna' });
    }).catch(function () {
      espera.remove();
      burbujaMsg('vp-el', 'Algo falló al buscar esa información. Inténtalo otra vez.');
    }).then(function () {
      enviando = false;
      chat.querySelector('#vp-ch-enviar').disabled = false;
    });
  }

  /* ---------- panel de uso y costo (SOLO PARA TI) ----------
     Al dueño de la tienda no le sirve ver tokens ni dólares, y además le
     enseñaría de qué está hecho el asistente por dentro. Por eso NO hay
     botón: este panel se abre a mano desde la consola del navegador.

         VPMascota.costos()

     Las métricas de todos los negocios juntos están en Supabase:
         select * from public.vp_ia_costo_mes;
  */
  function verCostos() {
    var VC = window.VPCerebro;
    if (!VC) return;
    if (!abierto) abrirChat();
    var c = VC.costoEstimado();
    var desde = '';
    try { desde = new Date(c.desde).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) {}
    var html =
      '<div class="vp-costos">' +
        '<h4>Uso en este aparato</h4>' +
        '<div class="vp-barra"><i style="width:' + c.pctGratis + '%"></i></div>' +
        '<div class="vp-fila" style="border:0;padding-top:0"><span>Resueltas sin costo</span><b>' + c.pctGratis + '%</b></div>' +
        '<div class="vp-fila"><span>Preguntas en total</span><b>' + c.total + '</b></div>' +
        '<div class="vp-fila"><span>Sin gastar nada</span><b>' + c.sinIA + '</b></div>' +
        '<div class="vp-fila"><span>Con consulta externa</span><b>' + c.conIA + '</b></div>' +
        '<div class="vp-fila"><span>Tokens usados</span><b>' + (c.tokensIn + c.tokensOut) + '</b></div>' +
        '<div class="vp-fila"><span>Costo estimado</span><b>' + (c.usd < 0.01 ? '< 1 centavo de dólar' : '$' + c.usd.toFixed(4) + ' USD') + '</b></div>' +
        (desde ? '<p class="vp-nota">Contando desde el ' + desde + '. Solo de este aparato; el total de todos los negocios está en Supabase.</p>' : '') +
      '</div>';
    burbujaMsg('vp-el', html);
    pintarChips(['Volver a preguntar']);
  }

  /* =======================================================================
     5b.  INTERRUPTOR EN "MI CUENTA"
     Se mete una fila en Preferencias, con la misma pinta que las demás.
     Apagarlo guarda la decisión en este aparato: el asistente desaparece
     por completo y deja de gastar hasta que lo vuelvan a prender.
  ======================================================================= */
  var K_APAGADA = 'vp_mascota_apagada';

  function apagada() {
    try { return localStorage.getItem(K_APAGADA) === '1'; } catch (e) { return false; }
  }
  function encenderApagar(prender) {
    try { localStorage.setItem(K_APAGADA, prender ? '0' : '1'); } catch (e) {}
    if (prender) {
      if (!document.getElementById('vp-mascota')) crear();
      revisar();
      if (nodo) { nodo.classList.add('vp-llega'); setTimeout(function () { nodo.classList.remove('vp-llega'); }, 700); }
      saludar();
    } else {
      cerrarChat();
      revisar();
    }
  }

  /* La hoja de ajustes usa el MISMO openModal y las mismas clases que el
     resto de Vendo Plus, para que no se note que viene de otro archivo. */
  function ajustes() {
    var abrirModal = window.openModal, cerrar = window.closeModal;
    if (typeof abrirModal !== 'function') return;
    var on = !apagada();
    abrirModal(
      '<h3 class="sheet-title">Asistente</h3>' +
      '<div class="toggle-row">' +
        '<span class="acc-ico green">' + caraMini() + '</span>' +
        '<span class="acc-txt">' +
          '<span class="acc-label">Mostrar el asistente</span>' +
          '<span class="acc-sub">El personaje que flota en la pantalla. Tócalo para preguntarle cómo van tus ventas, tus ganancias y tu inventario.</span>' +
        '</span>' +
        '<label class="switch"><input type="checkbox" id="vpSwMascota" ' + (on ? 'checked' : '') +
          '><span class="track"></span></label>' +
      '</div>' +
      '<p class="md-hint" style="margin-top:4px;">Se esconde solo cuando cobras, escaneas un código o escribes algo, y regresa al terminar.</p>' +
      '<div class="sheet-actions">' +
        '<button class="btn primary block" id="vpAjustesOk">Listo</button>' +
      '</div>',
      { dismissible: true });

    var sw = document.getElementById('vpSwMascota');
    if (sw) sw.onchange = function () { encenderApagar(this.checked); };
    var ok = document.getElementById('vpAjustesOk');
    if (ok) ok.onclick = function () {
      if (typeof cerrar === 'function') cerrar();
      if (typeof window.render === 'function') window.render();
    };
  }

  /* El mismo personaje, pero simplificado para que se lea a 22 píxeles:
     una sola hoja, cabeza sólida y ojos calados. */
  function caraMini() {
    return '<svg viewBox="0 0 120 120" width="22" height="22" aria-hidden="true">' +
      '<path d="M60 44V20" stroke="currentColor" stroke-width="8" stroke-linecap="round" fill="none"/>' +
      '<path d="M60 24c-2-10-10-14-18-12-1 9 7 17 18 12z" fill="currentColor"/>' +
      '<rect x="12" y="40" width="96" height="68" rx="32" fill="currentColor"/>' +
      '<rect x="40" y="60" width="12" height="28" rx="6" fill="#fff"/>' +
      '<rect x="68" y="60" width="12" height="28" rx="6" fill="#fff"/>' +
    '</svg>';
  }

  /** La fila que se ve en Mi cuenta › Preferencias. */
  function filaCuenta() {
    var on = !apagada();
    return '' +
      '<button class="acc-row" onclick="VPMascota.ajustes()">' +
        '<span class="acc-ico green">' + caraMini() + '</span>' +
        '<span class="acc-txt">' +
          '<span class="acc-label">Asistente</span>' +
          '<span class="acc-sub">' + (on ? 'Visible en la pantalla' : 'Oculto') + '</span>' +
        '</span>' +
        '<span class="acc-chev">' +
          '<svg viewBox="0 0 24 24" fill="none" width="18" height="18">' +
          '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>' +
      '</button>';
  }

  /**
   * Se engancha a renderAccount() de Vendo Plus, igual que el propio
   * index.html hace con removeLine y changeLineQty al final del archivo.
   * Las funciones declaradas con "function" sí viven en window, así que se
   * pueden envolver sin tocar el index.html.
   */
  function engancharCuenta() {
    var original = window.renderAccount;
    if (typeof original !== 'function' || original.__vp) return true;
    var envuelto = function () {
      var html = original.apply(this, arguments);
      try { return meterFila(String(html)); } catch (e) { return html; }
    };
    envuelto.__vp = true;
    window.renderAccount = envuelto;
    return true;
  }

  /* Se cuela al final de la lista de "Preferencias". Si algún día cambia
     el texto de esa sección, no se rompe nada: se agrega su propio
     apartado hasta abajo. */
  function meterFila(html) {
    if (html.indexOf('VPMascota.ajustes()') >= 0) return html;
    var fila = filaCuenta();
    var ancla = html.indexOf('<div class="section-title">Sesión</div>');
    if (ancla > 0) {
      var cierre = html.lastIndexOf('</div>', ancla);
      if (cierre > 0) return html.slice(0, cierre) + fila + html.slice(cierre);
    }
    return html + '<div class="section-title">Asistente</div><div class="acc-list">' + fila + '</div>';
  }

  /* =======================================================================
     6.  LO QUE QUEDA DISPONIBLE
  ======================================================================= */
  window.VPMascota = {
    abrir: abrirChat,
    ajustes: ajustes,            /* la hoja de Mi cuenta › Asistente */
    apagada: apagada,
    encender: function () { encenderApagar(true); },
    apagar: function () { encenderApagar(false); },
    costos: verCostos,   /* panel de uso y costo: solo desde la consola */
    cerrar: cerrarChat,
    saludar: saludar,
    gesto: gesto,
    decir: decir,
    mostrar: function () { if (nodo) nodo.classList.remove('vp-oculta'); },
    ocultar: function () { if (nodo) nodo.classList.add('vp-oculta'); },
    revisar: revisar,
    /** Preguntar desde cualquier parte de Vendo Plus: VPMascota.preguntar('cuánto vendí hoy') */
    preguntar: function (texto) {
      abrirChat();
      setTimeout(function () { entrada.value = texto; enviar(); }, 240);
    },
    /**
     * Ponerle ropa o accesorios más adelante.
     *   VPMascota.accesorio('sombrero', '<path d="..." fill="#E1594C"/>')
     * Ranuras: 'sombrero' | 'cara' | 'cuerpo' | 'mano-izq' | 'mano-der'
     * Quitarlo: VPMascota.accesorio('sombrero', '')
     */
    accesorio: function (ranura, svgInterno) {
      var g = document.getElementById('vp-slot-' + ranura);
      if (!g) return false;
      g.innerHTML = svgInterno || '';
      return true;
    },
    ranuras: ['sombrero', 'cara', 'cuerpo', 'mano-izq', 'mano-der'],
    /** Quitarla por completo (por ejemplo, si el negocio la apaga en ajustes). */
    destruir: function () {
      if (nodo) nodo.remove();
      if (chat) chat.remove();
      nodo = chat = null;
      window.VPMascota = null;
    }
  };

  /* =======================================================================
     7.  ENCENDER
     Espera a que Vendo Plus ya esté pintado y con sesión abierta.
  ======================================================================= */
  function sesionLista() {
    try {
      if (document.body.classList.contains('dm-mode')) return false;   /* menú público */
      if (!document.body.dataset.section) return false;
      return true;
    } catch (e) { return false; }
  }

  function encender() {
    /* La fila de Mi cuenta se mete SIEMPRE, aunque el asistente esté
       apagado: si no, no habría forma de volver a prenderlo. */
    engancharCuenta();
    if (document.getElementById('vp-mascota')) return;
    if (!sesionLista()) return;
    crear();
  }

  function listoTodo() {
    return !!document.getElementById('vp-mascota')
        && typeof window.renderAccount === 'function' && !!window.renderAccount.__vp;
  }

  function esperar() {
    encender();
    if (listoTodo()) return;
    var n = 0;
    /* Se sigue intentando hasta que estén LAS DOS cosas: el personaje en
       pantalla y la fila metida en Mi cuenta. Antes se paraba en cuanto
       aparecía el personaje, y si renderAccount todavía no existía, la
       opción para ocultarlo nunca se agregaba. */
    var t = setInterval(function () {
      encender();
      if (listoTodo() || ++n > 240) clearInterval(t);   /* hasta 2 min */
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', esperar);
  else esperar();
})();
