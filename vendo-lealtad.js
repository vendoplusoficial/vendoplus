/* =========================================================================
   Vendo Plus · PROGRAMA DE LEALTAD        (función Premium)
   -------------------------------------------------------------------------
   Es el MISMO archivo para la página web y para la app de Play Store.
   Va junto a index.html y lo carga vendo-premium.js solo.

   QUÉ HACE
     · Una sección nueva, "Programa de lealtad", que se abre desde
       Funciones premium (y solo desde ahí).
     · Tres formas de premiar, a elección del negocio:
         puntos por compra · premio por visitas · compras acumuladas
     · Clientes con nombre y teléfono, su tarjeta digital y su código QR.
     · Se mete al cobro que YA existe: el cajero identifica al cliente por
       teléfono o escaneando su QR, y los puntos se acreditan SOLOS cuando
       la venta queda pagada.
     · Si la venta se cancela o se devuelve completa, los puntos se
       regresan solos. Nada se duplica aunque el cobro se procese dos veces.
     · Los pedidos del Menú Digital acumulan al MISMO saldo.
     · Tarjeta digital con QR, en una página que abre en cualquier
       teléfono (Android, iPhone y computadora) sin instalar nada.

   DÓNDE VIVEN LOS DATOS
     Todo en Supabase (tablas vp_lealtad_*, ver supabase/vp_lealtad.sql).
     Los puntos NUNCA se calculan en el teléfono: se piden al servidor,
     que es el único que los puede mover. Así el cliente no puede
     cambiarlos y dos cajas al mismo tiempo no se pisan.

   NO CAMBIA NADA DE LO QUE YA FUNCIONA
     Ni el cobro, ni el inventario, ni el Menú Digital, ni Stripe, ni la
     suscripción de Google Play. Todo se engancha desde aquí.
========================================================================= */
(function () {
  'use strict';
  if (window.VPLealtad) return;

  /* =======================================================================
     0.  ATAJOS A LO QUE YA EXISTE EN index.html
     Igual que vendo-premium.js: se llega por nombre, pero todo va
     envuelto por si algún día cambia.
  ======================================================================= */
  function ref(n) { try { return eval(n); } catch (e) { return undefined; } }
  function fn(n) { var f = ref(n); return typeof f === 'function' ? f : null; }
  function esc(s) { var f = fn('escapeHtml'); return f ? f(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ico(n) { var f = fn('icon'); return f ? f(n) : ''; }
  function avisar(m, o) { var f = fn('toast'); if (f) f(m, o || {}); else console.log(m); }
  function dinero(n) { var f = fn('formatMoney'); return f ? f(n) : '$' + (Number(n) || 0).toFixed(2); }
  function nube() { var c = window.Cloud; return (c && c.ready && c.uid) ? c : null; }
  function premium() { try { return !!(window.VPPremium && VPPremium.activo()); } catch (e) { return false; } }
  function dueno() { var f = fn('isOwner'); return f ? !!f() : true; }
  function yo() { var f = fn('activeUser'); try { var u = f ? f() : null; return u ? u.name : ''; } catch (e) { return ''; } }
  function cerrar() { var f = fn('closeModal'); if (f) f(); }
  function abrirHoja(html, op) { var f = fn('openModal'); if (f) f(html, op || { dismissible: true }); }
  function repintar() { var f = fn('render'); if (f) try { f(); } catch (e) {} }
  function volverHTML() { var f = fn('subViewBackHTML'); return f ? f() : ''; }

  var MODOS = {
    puntos:  { t: 'Puntos por compra',  s: 'Cada compra le deja puntos y con ellos canjea premios.' },
    visitas: { t: 'Premio por visitas', s: 'Junta visitas y a las que tú digas, se lleva su premio.' },
    compras: { t: 'Compras acumuladas', s: 'Compra 9 cafés y el décimo va gratis.' }
  };
  var TIPOS = {
    descuento_pct:   'Descuento en %',
    descuento_monto: 'Descuento en pesos',
    producto:        'Producto gratis'
  };

  /* =======================================================================
     1.  QR  ·  modo byte, corrección M, versiones 1 a 6 (hasta 106 bytes)
     Va aquí adentro a propósito: la tarjeta se dibuja sin internet y sin
     ninguna librería de fuera. Comprobado contra un decodificador real.
  ======================================================================= */
  function qrMatriz(texto) {
    var datos = [], s = String(texto);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) datos.push(c);
      else if (c < 0x800) datos.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else datos.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    /* version: [codewords de datos, ec por bloque, bloques g1, datos g1, bloques g2, datos g2] */
    var VER = { 1: [16, 10, 1, 16, 0, 0], 2: [28, 16, 1, 28, 0, 0], 3: [44, 26, 1, 44, 0, 0],
                4: [64, 18, 2, 32, 0, 0], 5: [86, 24, 2, 43, 0, 0], 6: [108, 16, 4, 27, 0, 0] };
    var ALIN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

    var v = 0;
    for (var k = 1; k <= 6; k++) { if (datos.length + 2 <= VER[k][0]) { v = k; break; } }
    if (!v) return null;
    var cfg = VER[v], nDatos = cfg[0], nEc = cfg[1];

    var bits = [];
    function pon(val, largo) { for (var b = largo - 1; b >= 0; b--) bits.push((val >> b) & 1); }
    pon(4, 4); pon(datos.length, 8);
    for (var d = 0; d < datos.length; d++) pon(datos[d], 8);
    var cap = nDatos * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var rell = [0xEC, 0x11], r = 0;
    while (bits.length < cap) { pon(rell[r % 2], 8); r++; }
    var cw = [];
    for (var p = 0; p < bits.length; p += 8) {
      var by = 0;
      for (var j = 0; j < 8; j++) by = (by << 1) | bits[p + j];
      cw.push(by);
    }

    /* Reed-Solomon en GF(256) */
    var EXP = new Array(512), LOG = new Array(256);
    for (var x = 0, e = 1; x < 255; x++) { EXP[x] = e; LOG[e] = x; e <<= 1; if (e & 256) e ^= 0x11D; }
    for (var x2 = 255; x2 < 512; x2++) EXP[x2] = EXP[x2 - 255];
    function mul(a, b2) { return (a === 0 || b2 === 0) ? 0 : EXP[LOG[a] + LOG[b2]]; }
    function gener(grado) {
      var g = [1];
      for (var i2 = 0; i2 < grado; i2++) {
        var ng = new Array(g.length + 1);
        for (var z = 0; z < ng.length; z++) ng[z] = 0;
        for (var j2 = 0; j2 < g.length; j2++) { ng[j2] ^= mul(g[j2], EXP[i2]); ng[j2 + 1] ^= g[j2]; }
        g = ng;
      }
      return g.reverse();     /* el índice 0 debe ser el grado mayor, y vale 1 */
    }
    function ecDe(bl, n2) {
      var g = gener(n2), res = bl.slice();
      for (var z2 = 0; z2 < n2; z2++) res.push(0);
      for (var i3 = 0; i3 < bl.length; i3++) {
        var f = res[i3]; if (!f) continue;
        for (var j3 = 0; j3 < g.length; j3++) res[i3 + j3] ^= mul(g[j3], f);
      }
      return res.slice(bl.length);
    }

    var bloques = [], ecs = [], pos = 0, g1 = cfg[2], d1 = cfg[3], g2 = cfg[4], d2 = cfg[5];
    for (var i4 = 0; i4 < g1; i4++) { bloques.push(cw.slice(pos, pos + d1)); pos += d1; }
    for (var i5 = 0; i5 < g2; i5++) { bloques.push(cw.slice(pos, pos + d2)); pos += d2; }
    for (var i6 = 0; i6 < bloques.length; i6++) ecs.push(ecDe(bloques[i6], nEc));
    var fin = [], maxD = Math.max(d1, d2);
    for (var c2 = 0; c2 < maxD; c2++) for (var b3 = 0; b3 < bloques.length; b3++) if (c2 < bloques[b3].length) fin.push(bloques[b3][c2]);
    for (var c3 = 0; c3 < nEc; c3++) for (var b4 = 0; b4 < ecs.length; b4++) fin.push(ecs[b4][c3]);

    var n = v * 4 + 17, m = [], usa = [];
    for (var y = 0; y < n; y++) {
      m.push(new Array(n)); usa.push(new Array(n));
      for (var x3 = 0; x3 < n; x3++) { m[y][x3] = 0; usa[y][x3] = 0; }
    }
    function cuadro(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var yy = cy + dy, xx = cx + dx;
        if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
        var a = Math.max(Math.abs(dx), Math.abs(dy));
        m[yy][xx] = (a <= 1 || a === 3) ? 1 : 0;   /* centro, anillo claro, borde, separador */
        usa[yy][xx] = 1;
      }
    }
    cuadro(3, 3); cuadro(n - 4, 3); cuadro(3, n - 4);
    for (var i7 = 8; i7 < n - 8; i7++) {
      m[6][i7] = (i7 % 2 === 0) ? 1 : 0; usa[6][i7] = 1;
      m[i7][6] = (i7 % 2 === 0) ? 1 : 0; usa[i7][6] = 1;
    }
    var al = ALIN[v];
    for (var a1 = 0; a1 < al.length; a1++) for (var a2 = 0; a2 < al.length; a2++) {
      var cx2 = al[a2], cy2 = al[a1];
      if ((cx2 === 6 && cy2 === 6) || (cx2 === 6 && cy2 === n - 7) || (cx2 === n - 7 && cy2 === 6)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) {
        var a3 = Math.max(Math.abs(dx2), Math.abs(dy2));
        m[cy2 + dy2][cx2 + dx2] = (a3 === 0 || a3 === 2) ? 1 : 0;
        usa[cy2 + dy2][cx2 + dx2] = 1;
      }
    }
    m[n - 8][8] = 1; usa[n - 8][8] = 1;
    for (var i8 = 0; i8 <= 8; i8++) { usa[8][i8] = 1; usa[i8][8] = 1; }
    for (var i9 = n - 8; i9 < n; i9++) { usa[8][i9] = 1; usa[i9][8] = 1; }

    var bi = 0, tot = fin.length * 8;
    function bitEn(i) { return i < tot ? (fin[i >> 3] >> (7 - (i & 7))) & 1 : 0; }
    var arriba = true;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var py = 0; py < n; py++) {
        var yy2 = arriba ? n - 1 - py : py;
        for (var dc = 0; dc < 2; dc++) {
          var xx2 = col - dc;
          if (usa[yy2][xx2]) continue;
          m[yy2][xx2] = bitEn(bi++);
          usa[yy2][xx2] = 2;          /* 2 = módulo de datos: le toca máscara */
        }
      }
      arriba = !arriba;
    }

    function masc(p2, x4, y2) {
      switch (p2) {
        case 0: return (x4 + y2) % 2 === 0;
        case 1: return y2 % 2 === 0;
        case 2: return x4 % 3 === 0;
        case 3: return (x4 + y2) % 3 === 0;
        case 4: return (Math.floor(y2 / 2) + Math.floor(x4 / 3)) % 2 === 0;
        case 5: return ((x4 * y2) % 2) + ((x4 * y2) % 3) === 0;
        case 6: return (((x4 * y2) % 2) + ((x4 * y2) % 3)) % 2 === 0;
        default: return (((x4 + y2) % 2) + ((x4 * y2) % 3)) % 2 === 0;
      }
    }
    function fmt(p3) {
      var d15 = p3, dd = d15 << 10, g = 0x537;     /* nivel M = 00 + 3 bits de máscara */
      for (var i10 = 14; i10 >= 10; i10--) if ((dd >> i10) & 1) dd ^= g << (i10 - 10);
      return ((d15 << 10) | dd) ^ 0x5412;
    }
    function ponFmt(mat, p4) {
      var f = fmt(p4), bit = function (i) { return (f >> i) & 1; };
      for (var i11 = 0; i11 <= 5; i11++) mat[i11][8] = bit(i11);
      mat[7][8] = bit(6); mat[8][8] = bit(7); mat[8][7] = bit(8);
      for (var j4 = 0; j4 <= 5; j4++) mat[8][5 - j4] = bit(9 + j4);
      for (var k2 = 0; k2 <= 7; k2++) mat[8][n - 1 - k2] = bit(k2);
      for (var q = 0; q <= 6; q++) mat[n - 7 + q][8] = bit(8 + q);
      mat[n - 8][8] = 1;
    }
    function pena(mat) {
      var p1 = 0, p2b = 0, p3b = 0, osc = 0;
      function corre(l) {
        var tt = 0, cc = 1;
        for (var i12 = 1; i12 < l.length; i12++) {
          if (l[i12] === l[i12 - 1]) cc++;
          else { if (cc >= 5) tt += 3 + (cc - 5); cc = 1; }
        }
        if (cc >= 5) tt += 3 + (cc - 5);
        return tt;
      }
      for (var y3 = 0; y3 < n; y3++) p1 += corre(mat[y3]);
      for (var x5 = 0; x5 < n; x5++) { var cl = []; for (var y4 = 0; y4 < n; y4++) cl.push(mat[y4][x5]); p1 += corre(cl); }
      for (var y5 = 0; y5 < n - 1; y5++) for (var x6 = 0; x6 < n - 1; x6++) {
        var sm = mat[y5][x6] + mat[y5][x6 + 1] + mat[y5 + 1][x6] + mat[y5 + 1][x6 + 1];
        if (sm === 0 || sm === 4) p2b += 3;
      }
      var pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      function busca(l) {
        var tt = 0;
        for (var i13 = 0; i13 + 11 <= l.length; i13++) {
          var ok = true, ok2 = true;
          for (var j5 = 0; j5 < 11; j5++) {
            if (l[i13 + j5] !== pat[j5]) ok = false;
            if (l[i13 + j5] !== pat[10 - j5]) ok2 = false;
          }
          if (ok) tt += 40;
          if (ok2) tt += 40;
        }
        return tt;
      }
      for (var y6 = 0; y6 < n; y6++) p3b += busca(mat[y6]);
      for (var x7 = 0; x7 < n; x7++) { var cl2 = []; for (var y7 = 0; y7 < n; y7++) cl2.push(mat[y7][x7]); p3b += busca(cl2); }
      for (var y8 = 0; y8 < n; y8++) for (var x8 = 0; x8 < n; x8++) osc += mat[y8][x8];
      return p1 + p2b + p3b + Math.floor(Math.abs((osc * 100) / (n * n) - 50) / 5) * 10;
    }

    var mejor = null, mejorPts = Infinity;
    for (var p5 = 0; p5 < 8; p5++) {
      var mm = [];
      for (var y9 = 0; y9 < n; y9++) mm.push(m[y9].slice());
      for (var y10 = 0; y10 < n; y10++) for (var x9 = 0; x9 < n; x9++)
        if (usa[y10][x9] === 2 && masc(p5, x9, y10)) mm[y10][x9] ^= 1;
      ponFmt(mm, p5);
      var pts = pena(mm);
      if (pts < mejorPts) { mejorPts = pts; mejor = mm; }
    }
    return mejor;
  }

  /** El QR como SVG: se ve nítido en cualquier pantalla y se puede imprimir. */
  function qrSVG(texto, lado) {
    var m = qrMatriz(texto);
    if (!m) return '';
    var n = m.length, q = 2, total = n + q * 2, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++)
      if (m[y][x]) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    return '<svg class="vl-qr" viewBox="0 0 ' + total + ' ' + total + '" width="' + (lado || 200) + '" height="' + (lado || 200) +
           '" shape-rendering="crispEdges" role="img" aria-label="Código QR de la tarjeta">' +
           '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
           '<path d="' + d + '" fill="#16213E"/></svg>';
  }

  /* =======================================================================
     2.  HABLAR CON EL SERVIDOR
     Todo pasa por funciones de Supabase: el teléfono nunca calcula puntos.
  ======================================================================= */
  function rpc(nombre, args) {
    var c = nube();
    if (!c) return Promise.resolve({ ok: false, error: 'sin_nube' });
    return c.sb.rpc(nombre, args || {}).then(function (r) {
      if (r.error) {
        console.error('Vendo plus · lealtad · ' + nombre, r.error);
        return { ok: false, error: 'servidor', detalle: r.error.message || '', code: r.error.code || '' };
      }
      return r.data || { ok: false, error: 'sin_datos' };
    }, function (e) {
      console.error('Vendo plus · lealtad · ' + nombre, e);
      return { ok: false, error: 'red', detalle: (e && e.message) || '' };
    });
  }

  /** Los errores del servidor, en palabras que se entienden. */
  var TEXTOS = {
    sin_nube:             ['Inicia sesión para usar el programa de lealtad', 'Tus clientes y sus puntos se guardan en tu cuenta'],
    sin_sesion:           ['Inicia sesión otra vez', ''],
    sin_premium:          ['El Programa de lealtad es de Premium', 'Actívalo para premiar a tus clientes frecuentes'],
    programa_apagado:     ['Tu programa de lealtad está apagado', 'Enciéndelo en Configurar el programa'],
    sin_cliente:          ['No encontramos a ese cliente', 'Revisa el teléfono o regístralo'],
    sin_nombre:           ['Escribe el nombre del cliente', ''],
    telefono_invalido:    ['Ese teléfono no se ve bien', 'Escribe 10 dígitos, sin espacios ni guiones'],
    telefono_repetido:    ['Ese teléfono ya es de otro cliente', 'Cada teléfono puede estar una sola vez'],
    puntos_insuficientes: ['Todavía no le alcanza', ''],
    premio_usado:         ['Ese premio ya se entregó', ''],
    sin_premio:           ['Ese premio ya no existe', ''],
    sin_recompensa:       ['Elige un premio', ''],
    sin_tabla:            ['Falta preparar Supabase', 'Corre vp_lealtad.sql en el SQL Editor (una sola vez)'],
    red:                  ['Sin conexión a internet', 'Inténtalo otra vez en un momento']
  };
  function queja(r) {
    var e = (r && r.error) || 'red';
    /* La tabla todavía no existe: es lo primero que hay que avisar */
    if (e === 'servidor' && /vp_lealtad|schema cache|does not exist|PGRST202|42883|42P01/i.test(String((r && (r.detalle + ' ' + r.code)) || ''))) e = 'sin_tabla';
    var t = TEXTOS[e] || ['No se pudo completar', (r && r.detalle) || ''];
    var extra = (r && r.faltan) ? 'Le faltan ' + r.faltan + ' puntos' : t[1];
    avisar(t[0], { icon: ico('alert'), variant: 'toast-danger toast-wrap', subtitle: extra, duration: 3600 });
    return false;
  }

  /* =======================================================================
     3.  LO QUE TENEMOS CARGADO
  ======================================================================= */
  var L = {
    listo: false, cargando: false, error: null,
    cfg: null, recompensas: [], resumen: null,
    clientes: [], movimientos: [],
    pestana: 'clientes', busca: '',
    abierto: null                /* cliente abierto en su ficha */
  };

  function cargar(forzar) {
    if (L.cargando) return L.cargando;
    if (L.listo && !forzar) return Promise.resolve(true);
    L.cargando = Promise.all([
      rpc('vp_lealtad_ver'),
      rpc('vp_lealtad_clientes_lista', { p_busca: null, p_limite: 120 })
    ]).then(function (res) {
      L.cargando = null;
      var v = res[0], cl = res[1];
      if (!v || !v.ok) { L.error = v; L.listo = true; return false; }
      L.cfg = v.config || {};
      L.recompensas = v.recompensas || [];
      L.resumen = v.resumen || {};
      L.clientes = (cl && cl.ok) ? (cl.clientes || []) : [];
      L.error = null; L.listo = true;
      return true;
    });
    return L.cargando;
  }

  function recargar() {
    return cargar(true).then(function () { if (ref('currentView') === 'lealtad') repintar(); });
  }

  function activas() { return (L.recompensas || []).filter(function (r) { return r.activa; }); }
  function modo() { return (L.cfg && L.cfg.modo) || 'puntos'; }
  function encendido() { return !!(L.cfg && L.cfg.activo); }

  /* =======================================================================
     4.  ESTILOS  (reusa las variables de color de Vendo Plus)
  ======================================================================= */
  var cssPuesto = false;
  function estilos() {
    if (cssPuesto || document.getElementById('vl-css')) { cssPuesto = true; return; }
    cssPuesto = true;
    var st = document.createElement('style');
    st.id = 'vl-css';
    st.textContent = [
      /* IMPORTANTE: los iconos de Vendo Plus son SVG sin medida (la toman
         del lugar donde se ponen). Si no se les dice qué tan grandes van,
         se estiran y empujan todo hacia abajo. Esta primera regla les pone
         tamaño de icono a TODOS los que van dentro de la lealtad; abajo
         se afinan los casos especiales, y el QR se queda grande aparte. */
      '.vl-wrap svg,.vl-co svg,.vl-tar svg,.vl-card svg,.vl-mini svg,.vl-acts svg,',
      '.vl-rec svg,.vl-row svg,.vl-mov svg,.vl-prem svg,.vl-pill svg,.vl-off svg{width:17px;height:17px;flex:none;}',
      '.vl-wrap{max-width:900px;margin:0 auto;}',
      '.vl-off{display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:13px 14px;margin:0 0 14px;}',
      '.vl-off > svg{width:19px;height:19px;flex:none;color:var(--ink-soft);}',
      '.vl-off .btn svg{width:15px;height:15px;}',
      '.vl-off-t{flex:1;min-width:0;}',
      '.vl-off-t b{display:block;font-size:14.5px;font-weight:800;color:var(--ink);}',
      '.vl-off-t span{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-top:2px;line-height:1.35;}',
      '.vl-off.on{border-color:var(--vp-green,#16C15B);background:var(--vp-soft,#EAF9F0);}',
      '.vl-off.on > svg{color:var(--vp-green-d,#0F9B49);}',
      '.vl-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px;}',
      '.vl-card{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:14px;margin:0 0 12px;}',
      '.vl-card h3{margin:0 0 4px;font-size:14.5px;font-weight:800;color:var(--ink);}',
      '.vl-card p{margin:0;font-size:12.5px;font-weight:500;color:var(--ink-soft);line-height:1.45;}',
      '.vl-modos{display:grid;gap:10px;margin:0 0 4px;}',
      '.vl-modo{display:flex;align-items:flex-start;gap:11px;text-align:left;width:100%;cursor:pointer;font-family:inherit;',
      'border:1.5px solid var(--border);border-radius:14px;background:var(--surface);padding:13px 14px;transition:border-color .16s,background .16s;}',
      '.vl-modo.on{border-color:var(--vp-green,#16C15B);background:var(--vp-soft,#EAF9F0);}',
      '.vl-modo-r{flex:none;width:19px;height:19px;border-radius:50%;border:2px solid var(--border);margin-top:1px;position:relative;}',
      '.vl-modo.on .vl-modo-r{border-color:var(--vp-green,#16C15B);}',
      '.vl-modo.on .vl-modo-r::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--vp-green,#16C15B);}',
      '.vl-modo-t b{display:block;font-size:14px;font-weight:800;color:var(--ink);}',
      '.vl-modo-t span{display:block;font-size:12.5px;font-weight:500;color:var(--ink-soft);margin-top:2px;line-height:1.4;}',
      '.vl-rec{display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:10px 12px;margin-bottom:8px;}',
      '.vl-rec-t{flex:1;min-width:0;}',
      '.vl-rec-t b{display:block;font-size:13.5px;font-weight:800;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.vl-rec-t span{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);margin-top:1px;}',
      '.vl-rec-x{flex:none;border:none;background:none;cursor:pointer;padding:6px;border-radius:8px;color:var(--ink-soft);}',
      '.vl-rec-x svg{width:17px;height:17px;}',
      '.vl-rec.off{opacity:.55;}',
      '.vl-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;font-family:inherit;',
      'border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:12px 13px;margin-bottom:8px;transition:transform .12s;}',
      '.vl-row:active{transform:scale(.99);}',
      '.vl-av{flex:none;width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:13.5px;font-weight:800;',
      'background:var(--vp-soft,#EAF9F0);color:var(--vp-green-d,#0F9B49);overflow:hidden;}',
      '.vl-av svg{width:16px;height:16px;}',
      '.vl-row-m{flex:1;min-width:0;}',
      '.vl-row-m b{display:block;font-size:14px;font-weight:800;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.vl-row-m span{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-top:2px;}',
      '.vl-row-r{flex:none;text-align:right;}',
      '.vl-pts{display:block;font-size:15px;font-weight:800;color:var(--vp-green-d,#0F9B49);line-height:1.1;}',
      '.vl-pts small{display:block;font-size:11px;font-weight:700;color:var(--ink-soft);margin-top:1px;}',
      '.vl-prog{height:7px;border-radius:999px;background:var(--border);overflow:hidden;margin:10px 0 0;}',
      '.vl-prog i{display:block;height:100%;border-radius:999px;background:var(--vp-green,#16C15B);transition:width .35s ease;}',
      '.vl-mov{display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--border);padding:11px 2px;}',
      '.vl-mov:last-child{border-bottom:0;}',
      '.vl-mov-i{flex:none;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--vp-soft,#EAF9F0);color:var(--vp-green-d,#0F9B49);}',
      '.vl-mov-i svg{width:16px;height:16px;}',
      '.vl-mov-i.neg{background:#FDECEC;color:#C0392B;}',
      '.vl-mov-t{flex:1;min-width:0;}',
      '.vl-mov-t b{display:block;font-size:13px;font-weight:700;color:var(--ink);}',
      '.vl-mov-t span{display:block;font-size:11.5px;font-weight:600;color:var(--ink-soft);margin-top:1px;}',
      '.vl-mov-n{flex:none;font-size:13.5px;font-weight:800;color:var(--vp-green-d,#0F9B49);}',
      '.vl-mov-n.neg{color:#C0392B;}',
      /* La tarjeta del cliente. Va compacta a propósito: el QR, los puntos,
         los números y los botones tienen que caber en una sola pantalla,
         sin tener que bajar para ver lo importante. */
      '.vl-tar{border-radius:16px;padding:13px 14px;color:#fff;background:var(--vp-green,#16C15B);margin:0 0 10px;}',
      '.vl-tar-h{display:flex;align-items:center;gap:8px;}',
      '.vl-tar-h > svg{width:16px;height:16px;flex:none;opacity:.95;}',
      '.vl-tar-h b{font-size:13.5px;font-weight:800;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.vl-tar-n{font-size:26px;font-weight:800;margin:8px 0 1px;line-height:1.1;letter-spacing:-.5px;}',
      '.vl-tar-s{font-size:12px;font-weight:600;opacity:.92;}',
      '.vl-tar-q{background:#fff;border-radius:12px;padding:8px;display:grid;place-items:center;margin:10px 0 0;}',
      '.vl-tar-q svg{display:block;width:100%;height:auto;max-width:148px;}',
      '.vl-tar-c{font-size:10px;font-weight:700;letter-spacing:.3px;opacity:.88;margin-top:6px;text-align:center;word-break:break-all;}',
      '.vl-acts{display:grid;gap:7px;grid-template-columns:1fr 1fr;margin:0 0 10px;}',
      '.vl-mini{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:0 0 10px;}',
      '.vl-mini div{border:1px solid var(--border);border-radius:11px;background:var(--surface);padding:8px 6px;text-align:center;}',
      '.vl-mini span{display:block;font-size:10.5px;font-weight:700;color:var(--ink-soft);}',
      '.vl-mini b{display:block;font-size:15px;font-weight:800;color:var(--ink);margin-top:1px;}',
      '.vl-mas{display:block;width:100%;border:1px solid var(--border);border-radius:12px;background:var(--surface);',
      'padding:11px;font-family:inherit;font-size:13px;font-weight:800;color:var(--ink);cursor:pointer;margin:0 0 10px;}',
      '.vl-scan{position:relative;border-radius:14px;overflow:hidden;background:#000;aspect-ratio:4/3;margin:0 0 12px;}',
      '.vl-scan video{width:100%;height:100%;object-fit:cover;display:block;}',
      '.vl-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;font-size:11.5px;font-weight:800;}',
      '.vl-pill.ok{background:var(--vp-soft,#EAF9F0);color:var(--vp-green-d,#0F9B49);}',
      '.vl-pill.no{background:#FDECEC;color:#C0392B;}',
      /* el bloque dentro del cobro */
      '.vl-co{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:12px 13px;margin:0 0 14px;}',
      '.vl-co-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:var(--ink);margin-bottom:10px;}',
      '.vl-co-h svg{width:17px;height:17px;color:var(--vp-green-d,#0F9B49);}',
      '.vl-co-g{display:grid;grid-template-columns:1fr auto;gap:8px;}',
      '.vl-co-on{display:flex;align-items:center;gap:9px;border-radius:12px;background:var(--vp-soft,#EAF9F0);padding:10px 12px;}',
      '.vl-co-on > svg{width:17px;height:17px;flex:none;color:var(--vp-green-d,#0F9B49);}',
      '.vl-co-on b{flex:1;min-width:0;font-size:13.5px;font-weight:800;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.vl-co-on i{flex:none;cursor:pointer;color:var(--ink-soft);display:grid;place-items:center;}',
      '.vl-co-on i svg{width:16px;height:16px;}',
      '.vl-co-p{margin-top:9px;display:flex;flex-wrap:wrap;gap:7px;}',
      '.vl-prem{border:1.5px solid var(--border);border-radius:11px;background:var(--surface);padding:8px 11px;cursor:pointer;font-family:inherit;',
      'font-size:12.5px;font-weight:700;color:var(--ink);text-align:left;}',
      '.vl-prem.on{border-color:var(--vp-green,#16C15B);background:var(--vp-soft,#EAF9F0);color:var(--vp-green-d,#0F9B49);}',
      '.vl-prem small{display:block;font-size:11px;font-weight:600;color:var(--ink-soft);margin-top:1px;}',
      '.vl-prem.on small{color:var(--vp-green-d,#0F9B49);opacity:.85;}',
      '.vl-hint{font-size:12px;font-weight:600;color:var(--ink-soft);line-height:1.4;margin:8px 0 0;}',
      '.vl-spin{width:26px;height:26px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--vp-green,#16C15B);animation:vl-giro .8s linear infinite;margin:26px auto;}',
      '@keyframes vl-giro{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.vl-spin{animation-duration:2s}.vl-prog i{transition:none}}'
    ].join('');
    document.head.appendChild(st);
  }

  /* Los iconos que faltaban. Se agregan a los que ya existen. */
  function iconos() {
    var I = ref('ICONS');
    if (!I) return;
    if (!I.vlCard) I.vlCard = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="5" width="19" height="14" rx="3" stroke="currentColor" stroke-width="1.9"/><path d="M2.5 9.5h19" stroke="currentColor" stroke-width="1.9"/><path d="M6 14h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="16.5" cy="14.2" r="1.6" fill="currentColor"/></svg>';
    if (!I.vlQr) I.vlQr = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.9"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.9"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.9"/><path d="M14 14h2.5M19 14h1.5M14 17h1.5M17.5 17h3M14 20h6.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
    if (!I.vlStar) I.vlStar = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    if (!I.vlUndo) I.vlUndo = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* =======================================================================
     5.  LA PANTALLA PRINCIPAL
  ======================================================================= */
  function cabeza() {
    return volverHTML() +
      '<h1 class="page-title">Programa de lealtad</h1>' +
      '<p class="page-sub">Premia a quien te compra seguido y regresa más veces</p>';
  }

  function vista() {
    estilos(); iconos();
    if (!nube()) {
      return '<div class="vl-wrap">' + cabeza() +
        '<div class="empty-state">' + (fn('illustration') ? ref('illustration')('docsEmpty') : '') +
        '<div class="empty-title">Inicia sesión para usar el programa</div>' +
        '<div class="empty-text">Tus clientes y sus puntos se guardan en tu cuenta, para que los veas desde cualquier aparato.</div></div></div>';
    }
    if (!L.listo) { cargar().then(function () { if (ref('currentView') === 'lealtad') repintar(); }); return '<div class="vl-wrap">' + cabeza() + '<div class="vl-spin"></div></div>'; }
    if (L.error) {
      var t = TEXTOS[(L.error.error === 'servidor' ? 'sin_tabla' : L.error.error)] || TEXTOS.sin_tabla;
      return '<div class="vl-wrap">' + cabeza() +
        '<div class="empty-state">' + ico('alert') +
        '<div class="empty-title">' + esc(t[0]) + '</div>' +
        '<div class="empty-text">' + esc(t[1]) + '</div>' +
        '<button class="btn ghost" onclick="VPLealtad.recargar()">' + ico('refresh') + ' Reintentar</button></div></div>';
    }

    var pr = premium();
    var res = L.resumen || {};
    var cl = L.clientes || [];
    var q = (L.busca || '').trim().toLowerCase();
    var lista = !q ? cl : cl.filter(function (c) {
      return String(c.nombre || '').toLowerCase().indexOf(q) >= 0 ||
             String(c.telefono || '').indexOf(q.replace(/\D/g, '')) >= 0;
    });

    var aviso = pr ? '' :
      '<div class="vl-off">' + ico('alert') +
        '<div class="vl-off-t"><b>Así se ve el Programa de lealtad</b>' +
        '<span>Con Premium puedes encenderlo, registrar clientes y darles sus puntos.</span></div>' +
        '<button class="btn primary" onclick="VPPremium.abrir()">Ver Premium</button></div>';

    var estado = '<div class="vl-off ' + (encendido() ? 'on' : '') + '">' + ico(encendido() ? 'check' : 'ban') +
      '<div class="vl-off-t"><b>' + (encendido() ? 'Programa activo' : 'Programa apagado') + '</b>' +
      '<span>' + (encendido()
        ? esc(MODOS[modo()].t) + ' · ' + reglaTexto()
        : 'Enciéndelo para empezar a dar puntos en cada cobro.') + '</span></div>' +
      '<button class="btn ghost" onclick="VPLealtad.config()">' + ico('sliders') + ' Configurar</button></div>';

    var nums = '<div class="mdi-today">' +
      '<div><span>Clientes</span><b>' + (res.clientes || 0) + '</b><small>' + ((res.clientes === 1) ? 'registrado' : 'registrados') + '</small></div>' +
      '<div><span>' + (modo() === 'puntos' ? 'Puntos repartidos' : 'Premios por entregar') + '</span><b>' +
        (modo() === 'puntos' ? (res.puntos || 0) : (res.premios_disponibles || 0)) + '</b><small>' +
        (modo() === 'puntos' ? 'en manos de tus clientes' : 'ya ganados') + '</small></div>' +
      '<div><span>Recompensas canjeadas</span><b>' + (res.canjeadas || 0) + '</b><small>en total</small></div>' +
      '</div>';

    var botones = '<div class="fab-row" style="gap:8px;margin:4px 0 12px;">' +
      '<button class="btn primary" onclick="VPLealtad.alta()">' + ico('plus') + ' Registrar cliente</button>' +
      '<button class="btn ghost" onclick="VPLealtad.buscarCliente()">' + ico('vlQr') + ' Buscar o escanear</button>' +
      '</div>';

    var pestanas = '<div class="mdi-tabs" role="tablist">' +
      '<button role="tab" class="' + (L.pestana === 'clientes' ? 'active' : '') + '" onclick="VPLealtad.tab(\'clientes\')">Clientes' + (cl.length ? '<span>' + cl.length + '</span>' : '') + '</button>' +
      '<button role="tab" class="' + (L.pestana === 'movs' ? 'active' : '') + '" onclick="VPLealtad.tab(\'movs\')">Movimientos</button>' +
      '</div>';

    var cuerpo;
    if (L.pestana === 'movs') cuerpo = movimientosHTML();
    else if (!cl.length) {
      cuerpo = '<div class="empty-state">' + (fn('illustration') ? ref('illustration')('docsEmpty') : ico('users')) +
        '<div class="empty-title">Aún no tienes clientes en el programa</div>' +
        '<div class="empty-text">Regístralos con su nombre y teléfono. En el cobro los identificas y sus puntos suben solos.</div></div>';
    } else if (!lista.length) {
      cuerpo = '<div class="empty-state">' + (fn('illustration') ? ref('illustration')('searchEmpty') : '') +
        '<div class="empty-title">Sin resultados</div><div class="empty-text">No hay clientes que coincidan.</div></div>';
    } else {
      cuerpo = lista.map(filaCliente).join('');
    }

    var buscador = cl.length ? '<div class="search-box"><span>' + ico('search') + '</span>' +
      '<input type="text" id="vlBusca" placeholder="Buscar por nombre o teléfono" value="' + esc(L.busca) + '" oninput="VPLealtad.filtrar(this.value)"></div>' : '';

    return '<div class="vl-wrap">' + cabeza() + aviso + estado + nums + botones +
           pestanas + (L.pestana === 'clientes' ? buscador : '') + cuerpo + '</div>';
  }

  function reglaTexto() {
    var c = L.cfg || {};
    if (modo() === 'puntos') return '1 punto por cada ' + dinero(c.pesos_por_punto || 10);
    if (modo() === 'visitas') return (c.visitas_meta || 10) + ' visitas' + (Number(c.visita_minima) > 0 ? ' de ' + dinero(c.visita_minima) + ' o más' : '');
    return 'premio a las ' + (c.compras_meta || 10) + ' piezas';
  }

  function inicial(n) {
    var f = fn('initialsOf');
    if (f) return f(n);
    var s = String(n || '').trim();
    return s ? s.split(/\s+/).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('') : '?';
  }
  function telBonito(t) {
    var d = String(t || '').replace(/\D/g, '');
    return d.length === 10 ? d.slice(0, 2) + ' ' + d.slice(2, 6) + ' ' + d.slice(6) : d;
  }
  function saldoTexto(c) {
    if (modo() === 'puntos') return [c.puntos || 0, (c.puntos === 1 ? 'punto' : 'puntos')];
    if (modo() === 'visitas') return [(c.visitas || 0) + '/' + ((L.cfg || {}).visitas_meta || 10), 'visitas'];
    return [(c.compras || 0) + '/' + ((L.cfg || {}).compras_meta || 10), 'piezas'];
  }

  function filaCliente(c) {
    var s = saldoTexto(c);
    var prem = (c.premios || 0) > 0;
    return '<button class="vl-row" onclick="VPLealtad.ficha(\'' + c.id + '\')">' +
      '<span class="vl-av">' + esc(inicial(c.nombre)) + '</span>' +
      '<span class="vl-row-m"><b>' + esc(c.nombre) + '</b>' +
      '<span>' + esc(telBonito(c.telefono)) +
        (c.ultima_compra ? ' · ' + (fn('formatDateShort') ? ref('formatDateShort')(c.ultima_compra) : '') : ' · sin compras') +
      '</span></span>' +
      '<span class="vl-row-r">' +
        (prem ? '<span class="vl-pill ok">' + ico('gift') + (c.premios > 1 ? c.premios + ' premios' : 'Premio listo') + '</span>'
              : '<span class="vl-pts">' + s[0] + '<small>' + s[1] + '</small></span>') +
      '</span></button>';
  }

  var MOVS = {
    alta:            ['Se registró', 'person', false],
    acumula:         ['Compra', 'cart', false],
    reversa:         ['Se canceló la venta', 'vlUndo', true],
    canje:           ['Canjeó un premio', 'gift', true],
    canje_revertido: ['Regresó el premio', 'vlUndo', false],
    ajuste:          ['Ajuste a mano', 'sliders', false],
    premio:          ['¡Ganó un premio!', 'vlStar', false]
  };
  function movHTML(m, conNombre) {
    var d = MOVS[m.tipo] || ['Movimiento', 'note', false];
    var n = Number(m.puntos || 0);
    var cant = n !== 0 ? (n > 0 ? '+' : '') + n : (Number(m.visitas) ? (Number(m.visitas) > 0 ? '+1 visita' : '−1 visita') : (Number(m.compras) ? (Number(m.compras) > 0 ? '+' : '') + m.compras : ''));
    var cuando = fn('formatDateShort') ? ref('formatDateShort')(m.creado) : '';
    return '<div class="vl-mov">' +
      '<span class="vl-mov-i ' + (d[2] ? 'neg' : '') + '">' + ico(d[1]) + '</span>' +
      '<span class="vl-mov-t"><b>' + esc(conNombre && m.cliente_nombre ? m.cliente_nombre + ' · ' + d[0] : d[0]) + '</b>' +
      '<span>' + esc(cuando + (Number(m.monto) ? ' · ' + dinero(Math.abs(m.monto)) : '') + (m.nota ? ' · ' + m.nota : '')) + '</span></span>' +
      (cant ? '<span class="vl-mov-n ' + (String(cant).indexOf('−') === 0 || Number(cant) < 0 ? 'neg' : '') + '">' + esc(String(cant)) + '</span>' : '') +
      '</div>';
  }
  function movimientosHTML() {
    if (!L.movimientos.length) {
      rpc('vp_lealtad_historial', { p_limite: 80 }).then(function (r) {
        if (r && r.ok) { L.movimientos = r.movimientos || []; if (ref('currentView') === 'lealtad' && L.pestana === 'movs') repintar(); }
      });
      return '<div class="vl-spin"></div>';
    }
    return '<div class="vl-card">' + L.movimientos.map(function (m) { return movHTML(m, true); }).join('') + '</div>';
  }

  /* =======================================================================
     6.  CONFIGURAR EL PROGRAMA
  ======================================================================= */
  var borrador = null;      /* lo que se está editando sin guardar todavía */

  function config() {
    if (!premium()) { if (window.VPPremium) VPPremium.abrir('lealtad'); return; }
    if (!dueno() && !(fn('requirePerm') && ref('requirePerm')('verConfig', 'No tienes permiso para configurar el programa'))) return;
    borrador = {
      activo: encendido(),
      modo: modo(),
      pesos_por_punto: Number((L.cfg || {}).pesos_por_punto || 10),
      visitas_meta: Number((L.cfg || {}).visitas_meta || 10),
      visita_minima: Number((L.cfg || {}).visita_minima || 0),
      compras_meta: Number((L.cfg || {}).compras_meta || 10),
      tarjeta_titulo: (L.cfg || {}).tarjeta_titulo || '',
      tarjeta_mensaje: (L.cfg || {}).tarjeta_mensaje || '',
      recompensas: (L.recompensas || []).filter(function (r) { return r.activa; }).map(function (r) {
        return { id: r.id, nombre: r.nombre, tipo: r.tipo, valor: Number(r.valor || 0),
                 producto_nombre: r.producto_nombre || '', costo_puntos: Number(r.costo_puntos || 100), activa: true };
      })
    };
    pintaConfig();
  }

  function pintaConfig() {
    estilos();
    var b = borrador;
    var reglas;
    if (b.modo === 'puntos') {
      reglas = '<div class="field"><label for="vlPesos">¿Cuántos pesos son 1 punto?</label>' +
        '<div class="p2-money"><i>$</i><input id="vlPesos" type="number" inputmode="decimal" min="1" step="1" value="' + b.pesos_por_punto + '" oninput="VPLealtad._cfg(\'pesos_por_punto\', this.value)"></div>' +
        '<div class="field-hint">Con ' + dinero(b.pesos_por_punto) + ', una compra de ' + dinero(b.pesos_por_punto * 25) + ' le deja 25 puntos.</div></div>';
    } else if (b.modo === 'visitas') {
      reglas = '<div class="field"><label for="vlVis">¿Cuántas visitas para el premio?</label>' +
        '<input id="vlVis" type="number" inputmode="numeric" min="1" max="999" step="1" value="' + b.visitas_meta + '" oninput="VPLealtad._cfg(\'visitas_meta\', this.value)"></div>' +
        '<div class="field"><label for="vlMin">Compra mínima para que cuente la visita</label>' +
        '<div class="p2-money"><i>$</i><input id="vlMin" type="number" inputmode="decimal" min="0" step="1" value="' + b.visita_minima + '" oninput="VPLealtad._cfg(\'visita_minima\', this.value)"></div>' +
        '<div class="field-hint">Déjalo en 0 si cualquier compra cuenta.</div></div>';
    } else {
      reglas = '<div class="field"><label for="vlCom">¿Cuántas piezas para el premio?</label>' +
        '<input id="vlCom" type="number" inputmode="numeric" min="2" max="999" step="1" value="' + b.compras_meta + '" oninput="VPLealtad._cfg(\'compras_meta\', this.value)"></div>' +
        '<p class="vl-hint">Ejemplo: con 10, al comprar la décima pieza se lleva el premio. En el cobro escribes cuántas piezas participan de esa venta.</p>';
    }

    var recs = b.recompensas.length
      ? b.recompensas.map(function (r, i) {
          return '<div class="vl-rec">' +
            '<span class="vl-av" style="width:32px;height:32px;border-radius:9px;">' + ico('gift') + '</span>' +
            '<span class="vl-rec-t"><b>' + esc(r.nombre) + '</b><span>' + esc(premioTexto(r)) +
              (b.modo === 'puntos' ? ' · ' + r.costo_puntos + ' puntos' : '') + '</span></span>' +
            '<button class="vl-rec-x" onclick="VPLealtad._recEdit(' + i + ')" aria-label="Editar">' + ico('edit') + '</button>' +
            '<button class="vl-rec-x" onclick="VPLealtad._recQuita(' + i + ')" aria-label="Quitar">' + ico('trash') + '</button>' +
            '</div>';
        }).join('')
      : '<p class="vl-hint">Todavía no hay premios. Agrega al menos uno para que tus clientes tengan qué canjear.</p>';

    abrirHoja(
      '<div class="sheet-header"><div class="sheet-header-left">' +
        '<button class="sheet-back" onclick="VPLealtad.cerrarConfig()" aria-label="Volver">' + ico('chevronLeft') + '</button>' +
        '<h2>Configurar el programa</h2></div>' +
        '<button class="sheet-close" onclick="VPLealtad.cerrarConfig()">' + ico('close') + '</button></div>' +

      '<div class="toggle-row conf-toggle" style="margin-bottom:14px;">' +
        '<span class="acc-ico green">' + ico('vlCard') + '</span>' +
        '<span class="acc-txt"><span class="acc-label">Programa encendido</span>' +
        '<span class="acc-sub">Apagado, nadie acumula ni canjea, pero no se pierde nada.</span></span>' +
        '<label class="switch"><input type="checkbox" ' + (b.activo ? 'checked' : '') + ' onchange="VPLealtad._cfg(\'activo\', this.checked)"><span class="track"></span></label>' +
      '</div>' +

      '<div class="p2-h">¿Cómo quieres premiar?</div>' +
      '<div class="vl-modos">' + Object.keys(MODOS).map(function (k) {
        return '<button type="button" class="vl-modo ' + (b.modo === k ? 'on' : '') + '" onclick="VPLealtad._cfg(\'modo\', \'' + k + '\')">' +
          '<span class="vl-modo-r"></span>' +
          '<span class="vl-modo-t"><b>' + esc(MODOS[k].t) + '</b><span>' + esc(MODOS[k].s) + '</span></span></button>';
      }).join('') + '</div>' +

      '<div class="vl-card" style="margin-top:14px;"><h3>Las reglas</h3>' + reglas + '</div>' +

      '<div class="vl-card"><h3>Premios</h3><p style="margin-bottom:10px;">' +
        (b.modo === 'puntos' ? 'Cada premio cuesta puntos. El cliente elige cuál canjear.'
                             : 'Al llegar a la meta se le entrega el primer premio de la lista.') + '</p>' +
        recs +
        '<button class="btn ghost block" style="margin-top:10px;" onclick="VPLealtad._recEdit(-1)">' + ico('plus') + ' Agregar premio</button>' +
      '</div>' +

      '<div class="vl-card"><h3>Su tarjeta digital</h3>' +
        '<div class="field"><label for="vlTit">Nombre que ve el cliente</label>' +
        '<input id="vlTit" type="text" maxlength="60" placeholder="' + esc(negocioNombre()) + '" value="' + esc(b.tarjeta_titulo) + '" oninput="VPLealtad._cfg(\'tarjeta_titulo\', this.value, true)"></div>' +
        '<div class="field" style="margin-bottom:0;"><label for="vlMsg">Mensaje (opcional)</label>' +
        '<input id="vlMsg" type="text" maxlength="120" placeholder="¡Gracias por volver!" value="' + esc(b.tarjeta_mensaje) + '" oninput="VPLealtad._cfg(\'tarjeta_mensaje\', this.value, true)"></div>' +
      '</div>' +

      '<div class="sheet-actions">' +
        '<button class="btn ghost" onclick="VPLealtad.cerrarConfig()">Cancelar</button>' +
        '<button class="btn primary block" id="vlGuardar" onclick="VPLealtad.guardar()">' + ico('check') + ' Guardar</button>' +
      '</div>',
      { dismissible: true });
  }

  function premioTexto(r) {
    if (r.tipo === 'descuento_pct') return Number(r.valor || 0) + '% de descuento';
    if (r.tipo === 'descuento_monto') return dinero(r.valor || 0) + ' de descuento';
    return (r.producto_nombre || 'Un producto') + ' gratis';
  }
  function negocioNombre() {
    try {
      var u = fn('currentUser') ? ref('currentUser')() : null;
      return (u && u.business && u.business.name) || 'Mi negocio';
    } catch (e) { return 'Mi negocio'; }
  }

  function _cfg(k, v, sinRepintar) {
    if (!borrador) return;
    if (k === 'activo') borrador.activo = !!v;
    else if (k === 'modo') borrador.modo = v;
    else if (k === 'tarjeta_titulo' || k === 'tarjeta_mensaje') borrador[k] = String(v).slice(0, 120);
    else borrador[k] = Math.max(Number(v) || 0, 0);
    if (!sinRepintar) pintaConfig();
  }

  /* ---------- un premio ---------- */
  var recEdit = { i: -1, d: null };
  function _recEdit(i) {
    var d = i >= 0 ? JSON.parse(JSON.stringify(borrador.recompensas[i]))
                   : { nombre: '', tipo: 'descuento_pct', valor: 10, producto_nombre: '', costo_puntos: 100, activa: true };
    recEdit = { i: i, d: d };
    pintaRec();
  }
  function pintaRec() {
    var d = recEdit.d;
    abrirHoja(
      '<div class="sheet-header"><div class="sheet-header-left">' +
        '<button class="sheet-back" onclick="VPLealtad._recVolver()" aria-label="Volver">' + ico('chevronLeft') + '</button>' +
        '<h2>' + (recEdit.i >= 0 ? 'Editar premio' : 'Nuevo premio') + '</h2></div>' +
        '<button class="sheet-close" onclick="VPLealtad._recVolver()">' + ico('close') + '</button></div>' +
      '<div class="field"><label for="vlRecN">¿Cómo se llama el premio?</label>' +
        '<input id="vlRecN" type="text" maxlength="60" placeholder="Ej. Café gratis" value="' + esc(d.nombre) + '" oninput="VPLealtad._recSet(\'nombre\', this.value, true)"></div>' +
      '<div class="field"><label>¿Qué se lleva?</label><div class="opt-grid">' +
        Object.keys(TIPOS).map(function (k) {
          return '<button class="opt-card ' + (d.tipo === k ? 'active' : '') + '" onclick="VPLealtad._recSet(\'tipo\', \'' + k + '\')">' +
            '<span class="opt-emoji">' + ico(k === 'producto' ? 'gift' : 'tag') + '</span>' + esc(TIPOS[k]) + '</button>';
        }).join('') + '</div></div>' +
      (d.tipo === 'producto'
        ? '<div class="field"><label for="vlRecP">¿Qué producto?</label>' +
          '<input id="vlRecP" type="text" maxlength="60" placeholder="Ej. Café americano chico" value="' + esc(d.producto_nombre) + '" oninput="VPLealtad._recSet(\'producto_nombre\', this.value, true)"></div>'
        : '<div class="field"><label for="vlRecV">' + (d.tipo === 'descuento_pct' ? 'Porcentaje de descuento' : 'Pesos de descuento') + '</label>' +
          '<div class="p2-money"><i>' + (d.tipo === 'descuento_pct' ? '%' : '$') + '</i>' +
          '<input id="vlRecV" type="number" inputmode="decimal" min="1" step="1" value="' + d.valor + '" oninput="VPLealtad._recSet(\'valor\', this.value, true)"></div></div>') +
      (borrador.modo === 'puntos'
        ? '<div class="field"><label for="vlRecC">¿Cuántos puntos cuesta?</label>' +
          '<input id="vlRecC" type="number" inputmode="numeric" min="1" step="10" value="' + d.costo_puntos + '" oninput="VPLealtad._recSet(\'costo_puntos\', this.value, true)">' +
          '<div class="field-hint">Con 1 punto cada ' + dinero(borrador.pesos_por_punto) + ', son ' + dinero(borrador.pesos_por_punto * d.costo_puntos) + ' de compras.</div></div>'
        : '') +
      '<div class="sheet-actions">' +
        (recEdit.i >= 0 ? '<button class="btn ghost" onclick="VPLealtad._recQuita(' + recEdit.i + ')">' + ico('trash') + ' Quitar</button>' : '<button class="btn ghost" onclick="VPLealtad._recVolver()">Cancelar</button>') +
        '<button class="btn primary block" onclick="VPLealtad._recOk()">' + ico('check') + ' Listo</button>' +
      '</div>', { dismissible: true });
  }
  function _recSet(k, v, sinRepintar) {
    if (k === 'valor' || k === 'costo_puntos') recEdit.d[k] = Math.max(Number(v) || 0, 0);
    else recEdit.d[k] = String(v).slice(0, 60);
    if (!sinRepintar) pintaRec();
  }
  function _recOk() {
    var d = recEdit.d;
    if (!String(d.nombre || '').trim()) { avisar('Escribe el nombre del premio', { icon: ico('alert') }); return; }
    if (d.tipo === 'producto' && !String(d.producto_nombre || '').trim()) { avisar('Escribe qué producto se lleva', { icon: ico('alert') }); return; }
    if (d.tipo !== 'producto' && !(Number(d.valor) > 0)) { avisar('El descuento tiene que ser mayor que 0', { icon: ico('alert') }); return; }
    if (borrador.modo === 'puntos' && !(Number(d.costo_puntos) > 0)) { avisar('Pon cuántos puntos cuesta', { icon: ico('alert') }); return; }
    if (recEdit.i >= 0) borrador.recompensas[recEdit.i] = d;
    else borrador.recompensas.push(d);
    pintaConfig();
  }
  function _recQuita(i) {
    borrador.recompensas.splice(i, 1);
    pintaConfig();
  }
  function _recVolver() { pintaConfig(); }

  function guardar() {
    if (!borrador) return;
    if (borrador.activo && !borrador.recompensas.length) {
      avisar('Agrega al menos un premio', { icon: ico('alert'), subtitle: 'Si no, tus clientes no tendrían qué canjear' });
      return;
    }
    var b = document.getElementById('vlGuardar');
    if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    var cfg = {
      activo: borrador.activo, modo: borrador.modo,
      pesos_por_punto: borrador.pesos_por_punto,
      visitas_meta: borrador.visitas_meta, visita_minima: borrador.visita_minima,
      compras_meta: borrador.compras_meta,
      tarjeta_titulo: borrador.tarjeta_titulo || negocioNombre(),
      tarjeta_mensaje: borrador.tarjeta_mensaje || null
    };
    var recs = borrador.recompensas.map(function (r, i) { return Object.assign({}, r, { orden: i }); });
    rpc('vp_lealtad_guardar', { p_config: cfg, p_recompensas: recs }).then(function (r) {
      if (b) { b.disabled = false; b.innerHTML = ico('check') + ' Guardar'; }
      if (!r || !r.ok) return queja(r);
      L.cfg = r.config || L.cfg;
      L.recompensas = r.recompensas || [];
      L.resumen = r.resumen || L.resumen;
      borrador = null;
      cerrar(); repintar();
      avisar('Programa guardado', { icon: ico('check'), variant: 'toast-success', subtitle: cfg.activo ? 'Ya puedes dar puntos en cada cobro' : 'Quedó apagado' });
    });
  }
  function cerrarConfig() { borrador = null; cerrar(); }

  /* =======================================================================
     7.  REGISTRAR UN CLIENTE
  ======================================================================= */
  var altaD = { nombre: '', telefono: '', desde: null };
  function alta(desde, tel) {
    if (!premium()) { if (window.VPPremium) VPPremium.abrir('lealtad'); return; }
    altaD = { nombre: '', telefono: String(tel || '').replace(/\D/g, ''), desde: desde || null };
    pintaAlta();
  }
  function pintaAlta() {
    abrirHoja(
      '<div class="sheet-header"><div class="sheet-header-left">' +
        '<button class="sheet-back" onclick="VPLealtad._altaVolver()" aria-label="Volver">' + ico('chevronLeft') + '</button>' +
        '<h2>Registrar cliente</h2></div>' +
        '<button class="sheet-close" onclick="VPLealtad._altaVolver()">' + ico('close') + '</button></div>' +
      '<p class="vl-hint" style="margin:0 0 14px;">Con su nombre y su teléfono es suficiente. El teléfono es el que lo identifica en el cobro, así que no se puede repetir.</p>' +
      '<div class="field"><label for="vlAltaN">Nombre</label>' +
        '<input id="vlAltaN" type="text" maxlength="60" autocomplete="name" placeholder="Ej. Ana Pérez" value="' + esc(altaD.nombre) + '" oninput="VPLealtad._alta(\'nombre\', this.value)"></div>' +
      '<div class="field"><label for="vlAltaT">Teléfono</label>' +
        '<input id="vlAltaT" type="tel" inputmode="numeric" maxlength="15" autocomplete="tel" placeholder="10 dígitos" value="' + esc(altaD.telefono) + '" oninput="VPLealtad._alta(\'telefono\', this.value)"></div>' +
      '<div class="sheet-actions">' +
        '<button class="btn ghost" onclick="VPLealtad._altaVolver()">Cancelar</button>' +
        '<button class="btn primary block" id="vlAltaOk" onclick="VPLealtad._altaOk()">' + ico('check') + ' Registrar</button>' +
      '</div>', { dismissible: true });
    setTimeout(function () { var e = document.getElementById('vlAltaN'); if (e && !altaD.nombre) e.focus(); }, 60);
  }
  function _alta(k, v) {
    altaD[k] = k === 'telefono' ? String(v).replace(/\D/g, '').slice(0, 15) : String(v).slice(0, 60);
  }
  function _altaVolver() {
    if (altaD.desde === 'cobro') { cerrar(); var f = fn('openCartSheet'); if (f) f('checkout'); }
    else cerrar();
  }
  function _altaOk() {
    var n = String(altaD.nombre || '').trim();
    var t = String(altaD.telefono || '').replace(/\D/g, '');
    if (!n) { avisar('Escribe el nombre', { icon: ico('alert') }); return; }
    if (t.length < 7) { avisar('El teléfono necesita al menos 7 dígitos', { icon: ico('alert') }); return; }
    var b = document.getElementById('vlAltaOk');
    if (b) { b.disabled = true; b.textContent = 'Registrando…'; }
    rpc('vp_lealtad_cliente_alta', { p_nombre: n, p_telefono: t }).then(function (r) {
      if (b) { b.disabled = false; b.innerHTML = ico('check') + ' Registrar'; }
      if (!r || !r.ok) return queja(r);
      var c = r.cliente;
      meteCliente(c);
      if (r.repetido) avisar('Ese cliente ya estaba registrado', { icon: ico('alert'), subtitle: esc(c.nombre) + ' · ' + telBonito(c.telefono) });
      else avisar('Cliente registrado', { icon: ico('check'), variant: 'toast-success', subtitle: 'Ya puede empezar a juntar' });
      if (altaD.desde === 'cobro') { ponEnCobro(c); cerrar(); var f = fn('openCartSheet'); if (f) f('checkout'); }
      else ficha(c.id);
    });
  }
  function meteCliente(c) {
    var i = L.clientes.findIndex(function (x) { return x.id === c.id; });
    if (i >= 0) L.clientes[i] = c; else L.clientes.unshift(c);
    if (L.resumen) L.resumen.clientes = L.clientes.length;
    if (ref('currentView') === 'lealtad') repintar();
  }

  /* =======================================================================
     8.  LA FICHA DEL CLIENTE  (su tarjeta, su QR, su historial)
  ======================================================================= */
  function ficha(id) {
    var verMovs = !!(L.abierto && L.abierto.id === id && L.abierto.verMovs);
    L.abierto = { id: id, cargando: true, cliente: null, movimientos: [], premios: [], verMovs: verMovs };
    pintaFicha();
    rpc('vp_lealtad_cliente', { p_cliente_id: id }).then(function (r) {
      if (!L.abierto || L.abierto.id !== id) return;
      if (!r || !r.ok) { cerrar(); return queja(r); }
      L.abierto = { id: id, cargando: false, cliente: r.cliente,
                    movimientos: r.movimientos || [], premios: r.premios || [], verMovs: verMovs };
      pintaFicha();
    });
  }
  function verMovs() {
    if (!L.abierto) return;
    L.abierto.verMovs = !L.abierto.verMovs;
    pintaFicha();
  }

  function enlaceTarjeta(codigo) {
    var base = location.protocol === 'file:'
      ? 'https://vendoplus.app/tarjeta.html'
      : location.origin + location.pathname.replace(/[^/]*$/, '') + 'tarjeta.html';
    return base + '#' + codigo;
  }

  function pintaFicha() {
    var a = L.abierto;
    if (!a) return;
    if (a.cargando || !a.cliente) {
      abrirHoja('<div class="sheet-header"><h2>Cliente</h2><button class="sheet-close" onclick="VPLealtad.cerrarFicha()">' + ico('close') + '</button></div><div class="vl-spin"></div>', { dismissible: true });
      return;
    }
    var c = a.cliente;
    var color = (L.cfg || {}).tarjeta_color || '#16C15B';
    var link = enlaceTarjeta(c.codigo);
    var meta = Number(c.meta || 0), av = Number(c.avance || 0);
    var pct = meta > 0 ? Math.min(100, Math.round((av / meta) * 100)) : 0;
    var s = saldoTexto(c);

    var premios = a.premios.length
      ? '<div class="vl-card"><h3>Premios listos para entregar</h3>' +
          a.premios.map(function (p) {
            return '<div class="vl-rec"><span class="vl-av" style="width:32px;height:32px;border-radius:9px;">' + ico('gift') + '</span>' +
              '<span class="vl-rec-t"><b>' + esc(p.nombre) + '</b><span>' + esc(premioTexto(p)) + '</span></span>' +
              '<span class="vl-pill ok">Disponible</span></div>';
          }).join('') +
          '<p class="vl-hint">Se le entregan en su próximo cobro: elígelo en el cobro y toca el premio.</p></div>'
      : '';

    abrirHoja(
      '<div class="sheet-header"><div class="sheet-header-left">' +
        '<button class="sheet-back" onclick="VPLealtad.cerrarFicha()" aria-label="Volver">' + ico('chevronLeft') + '</button>' +
        '<h2>' + esc(c.nombre) + '</h2></div>' +
        '<button class="sheet-close" onclick="VPLealtad.cerrarFicha()">' + ico('close') + '</button></div>' +

      '<div class="vl-tar" style="background:' + esc(color) + ';">' +
        '<div class="vl-tar-h">' + ico('vlCard') + '<b>' + esc((L.cfg || {}).tarjeta_titulo || negocioNombre()) + '</b></div>' +
        '<div class="vl-tar-n">' + esc(s[0]) + ' <span style="font-size:14px;font-weight:700;opacity:.9;">' + esc(s[1]) + '</span></div>' +
        '<div class="vl-tar-s">' + esc(c.nombre) + ' · ' + esc(telBonito(c.telefono)) + '</div>' +
        (meta > 0 ? '<div class="vl-prog" style="background:rgba(255,255,255,.3);"><i style="width:' + pct + '%;background:#fff;"></i></div>' +
          '<div class="vl-tar-s" style="margin-top:7px;">' + (Number(c.falta) > 0 ? 'Le faltan ' + c.falta + ' para su premio' : '¡Ya puede canjear!') + '</div>' : '') +
        '<div class="vl-tar-q">' + qrSVG(link, 190) + '</div>' +
        '<div class="vl-tar-c">' + esc(c.codigo) + '</div>' +
      '</div>' +

      '<div class="vl-mini">' +
        '<div><span>Compras</span><b>' + (c.compras_num || 0) + '</b></div>' +
        '<div><span>Ha gastado</span><b>' + dinero(c.gasto_total || 0) + '</b></div>' +
        '<div><span>Premios</span><b>' + (c.premios || 0) + '</b></div>' +
      '</div>' +

      '<div class="vl-acts">' +
        '<button class="btn whatsapp" onclick="VPLealtad.mandarTarjeta(\'' + c.id + '\')">' + ico('whatsapp') + ' Mandar su tarjeta</button>' +
        '<button class="btn ghost" onclick="VPLealtad.copiarTarjeta(\'' + c.id + '\')">' + ico('copy') + ' Copiar el enlace</button>' +
      '</div>' +

      premios +

      /* Los movimientos van guardados: así la tarjeta, el QR, los números
         y los botones caben juntos sin tener que bajar la pantalla. */
      '<button type="button" class="vl-mas" onclick="VPLealtad.verMovs()">' +
        (a.verMovs ? 'Ocultar movimientos' : 'Ver movimientos' + (a.movimientos.length ? ' (' + a.movimientos.length + ')' : '')) +
      '</button>' +
      (a.verMovs
        ? '<div class="vl-card">' +
            (a.movimientos.length ? a.movimientos.map(function (m) { return movHTML(m, false); }).join('')
                                  : '<p>Todavía no hay movimientos.</p>') +
          '</div>'
        : '') +

      '<div class="sheet-actions">' +
        '<button class="btn ghost" onclick="VPLealtad.ajustar(\'' + c.id + '\')">' + ico('sliders') + ' Ajustar puntos</button>' +
        '<button class="btn ghost" onclick="VPLealtad.nuevoCodigo(\'' + c.id + '\')">' + ico('refresh') + ' Nueva tarjeta</button>' +
        '<button class="btn ghost danger" onclick="VPLealtad.baja(\'' + c.id + '\')">' + ico('trash') + ' Quitar</button>' +
      '</div>', { dismissible: true });
  }
  function cerrarFicha() { L.abierto = null; cerrar(); }

  function mandarTarjeta(id) {
    var c = (L.abierto && L.abierto.cliente) || L.clientes.find(function (x) { return x.id === id; });
    if (!c) return;
    var msg = '¡Hola ' + String(c.nombre).split(/\s+/)[0] + '! Esta es tu tarjeta de ' +
      ((L.cfg || {}).tarjeta_titulo || negocioNombre()) + ':\n' + enlaceTarjeta(c.codigo) +
      '\n\nMuéstrala cuando vengas y junta tus premios.';
    var url = 'https://wa.me/' + String(c.telefono).replace(/\D/g, '') + '?text=' + encodeURIComponent(msg);
    var w = window.open(url, '_blank');
    if (!w) location.href = url;
  }
  function copiarTarjeta(id) {
    var c = (L.abierto && L.abierto.cliente) || L.clientes.find(function (x) { return x.id === id; });
    if (!c) return;
    var f = fn('mdCopy');
    if (f) f(enlaceTarjeta(c.codigo), 'Enlace copiado');
    else avisar('Enlace: ' + enlaceTarjeta(c.codigo));
  }

  function nuevoCodigo(id) {
    var f = fn('askConfirm');
    var hazlo = function () {
      rpc('vp_lealtad_codigo_nuevo', { p_cliente_id: id }).then(function (r) {
        if (!r || !r.ok) return queja(r);
        meteCliente(r.cliente);
        avisar('Tarjeta nueva lista', { icon: ico('check'), variant: 'toast-success', subtitle: 'La anterior y su QR ya no sirven' });
        ficha(id);
      });
    };
    if (!f) return hazlo();
    f({ title: '¿Hacer una tarjeta nueva?', text: 'La anterior deja de servir: su QR y su enlace ya no van a abrir. Úsalo si perdió el teléfono o si alguien más tenía su tarjeta.',
        ok: 'Hacer tarjeta nueva', cancel: 'Volver', icon: ico('refresh') }, hazlo);
  }
  function baja(id) {
    var f = fn('askConfirm');
    var hazlo = function () {
      rpc('vp_lealtad_cliente_baja', { p_cliente_id: id }).then(function (r) {
        if (!r || !r.ok) return queja(r);
        L.clientes = L.clientes.filter(function (x) { return x.id !== id; });
        if (L.resumen) L.resumen.clientes = L.clientes.length;
        L.abierto = null; cerrar(); repintar();
        avisar('Cliente quitado del programa', { icon: ico('check'), subtitle: 'Su historial se queda para que lo puedas revisar' });
      });
    };
    if (!f) return hazlo();
    f({ title: '¿Quitarlo del programa?', text: 'Deja de acumular y de canjear. Su historial NO se borra, así que puedes revisarlo cuando quieras.',
        ok: 'Quitar', cancel: 'Volver', danger: true, icon: ico('alert') }, hazlo);
  }

  var ajD = { id: null, puntos: 0, nota: '' };
  function ajustar(id) {
    if (!dueno()) { avisar('Solo el Dueño puede ajustar puntos a mano', { icon: ico('alert') }); return; }
    ajD = { id: id, puntos: 0, nota: '' };
    abrirHoja(
      '<div class="sheet-header"><div class="sheet-header-left">' +
        '<button class="sheet-back" onclick="VPLealtad.ficha(\'' + id + '\')" aria-label="Volver">' + ico('chevronLeft') + '</button>' +
        '<h2>Ajustar puntos</h2></div>' +
        '<button class="sheet-close" onclick="VPLealtad.cerrarFicha()">' + ico('close') + '</button></div>' +
      '<p class="vl-hint" style="margin:0 0 14px;">Para arreglar un error o para un regalo. Queda apuntado en su historial con tu nota, así siempre se puede revisar quién lo hizo y por qué.</p>' +
      '<div class="field"><label for="vlAjP">Puntos (con − para quitar)</label>' +
        '<input id="vlAjP" type="number" inputmode="numeric" step="1" placeholder="Ej. 50 o −20" oninput="VPLealtad._aj(\'puntos\', this.value)"></div>' +
      '<div class="field"><label for="vlAjN">¿Por qué?</label>' +
        '<input id="vlAjN" type="text" maxlength="120" placeholder="Ej. No se le dieron sus puntos el martes" oninput="VPLealtad._aj(\'nota\', this.value)"></div>' +
      '<div class="sheet-actions">' +
        '<button class="btn ghost" onclick="VPLealtad.ficha(\'' + id + '\')">Cancelar</button>' +
        '<button class="btn primary block" onclick="VPLealtad._ajOk()">' + ico('check') + ' Aplicar</button>' +
      '</div>', { dismissible: true });
  }
  function _aj(k, v) { ajD[k] = k === 'puntos' ? Math.round(Number(String(v).replace('−', '-')) || 0) : String(v).slice(0, 120); }
  function _ajOk() {
    if (!ajD.puntos) { avisar('Escribe cuántos puntos', { icon: ico('alert') }); return; }
    if (!String(ajD.nota).trim()) { avisar('Escribe por qué, para que quede claro en el historial', { icon: ico('alert') }); return; }
    rpc('vp_lealtad_ajustar', { p_cliente_id: ajD.id, p_puntos: ajD.puntos, p_nota: ajD.nota }).then(function (r) {
      if (!r || !r.ok) return queja(r);
      meteCliente(r.cliente);
      avisar('Puntos ajustados', { icon: ico('check'), variant: 'toast-success' });
      ficha(ajD.id);
    });
  }

  /* =======================================================================
     9.  IDENTIFICAR AL CLIENTE  (teléfono o QR)
  ======================================================================= */
  var buscaD = { texto: '', desde: null, buscando: false };

  function buscarCliente(desde) {
    if (!premium()) { if (window.VPPremium) VPPremium.abrir('lealtad'); return; }
    if (!encendido()) {
      avisar('Tu programa de lealtad está apagado', { icon: ico('alert'), subtitle: 'Enciéndelo en Configurar el programa' });
      return;
    }
    buscaD = { texto: '', desde: desde || null, buscando: false };
    pintaBusca();
  }
  function pintaBusca(msg) {
    abrirHoja(
      '<div class="sheet-header"><div class="sheet-header-left">' +
        '<button class="sheet-back" onclick="VPLealtad._buscaVolver()" aria-label="Volver">' + ico('chevronLeft') + '</button>' +
        '<h2>¿Quién es el cliente?</h2></div>' +
        '<button class="sheet-close" onclick="VPLealtad._buscaVolver()">' + ico('close') + '</button></div>' +
      '<div class="field"><label for="vlBusT">Su teléfono</label>' +
        '<input id="vlBusT" type="tel" inputmode="numeric" maxlength="15" placeholder="10 dígitos" value="' + esc(buscaD.texto) + '" ' +
        'oninput="VPLealtad._busca(this.value)" onkeydown="if(event.key===\'Enter\')VPLealtad._buscaOk()"></div>' +
      (msg ? '<p class="vl-hint" style="color:#C0392B;">' + esc(msg) + '</p>' : '') +
      '<div class="vl-acts" style="margin-top:4px;">' +
        '<button class="btn primary" onclick="VPLealtad._buscaOk()">' + ico('search') + ' Buscar</button>' +
        '<button class="btn ghost" onclick="VPLealtad.escanear()">' + ico('vlQr') + ' Escanear su QR</button>' +
      '</div>' +
      '<p class="vl-hint">Si no está registrado, lo puedes dar de alta aquí mismo.</p>' +
      '<button class="btn ghost block" onclick="VPLealtad.altaDesdeBusca()">' + ico('plus') + ' Registrar un cliente nuevo</button>',
      { dismissible: true });
    setTimeout(function () { var e = document.getElementById('vlBusT'); if (e) e.focus(); }, 60);
  }
  function _busca(v) { buscaD.texto = String(v).slice(0, 80); }
  /** "Registrar un cliente nuevo" desde la pantalla de búsqueda: se lleva
      el teléfono que ya venía escrito, sin pasarlo por el HTML. */
  function altaDesdeBusca() {
    var el = document.getElementById('vlBusT');
    var t = String((el && el.value) || buscaD.texto || '').replace(/\D/g, '');
    alta(buscaD.desde, t);
  }
  function _buscaVolver() {
    if (buscaD.desde === 'cobro') { cerrar(); var f = fn('openCartSheet'); if (f) f('checkout'); }
    else cerrar();
  }
  function _buscaOk(texto) {
    var t = String(texto != null ? texto : buscaD.texto || '').trim();
    if (!t) { avisar('Escribe el teléfono o escanea su QR', { icon: ico('alert') }); return; }
    if (buscaD.buscando) return;
    buscaD.buscando = true;
    rpc('vp_lealtad_buscar', { p_texto: t }).then(function (r) {
      buscaD.buscando = false;
      if (!r || !r.ok) {
        if (r && r.error === 'sin_cliente') { pintaBusca('No encontramos a nadie con eso. Revísalo o regístralo abajo.'); return; }
        return queja(r);
      }
      var c = r.cliente;
      meteCliente(c);
      if (buscaD.desde === 'cobro') {
        ponEnCobro(c, r.premios || []);
        cerrar();
        var f = fn('openCartSheet'); if (f) f('checkout');
        /* Sin "identificado/a": así sirve igual para cualquier nombre. */
        avisar('Ya quedó: ' + String(c.nombre).split(/\s+/)[0], { icon: ico('check'), variant: 'toast-success', subtitle: 'Tiene ' + saldoTexto(c).join(' ') });
      } else {
        cerrar(); ficha(c.id);
      }
    });
  }

  /* ---------- el escáner ---------- */
  var scan = { stream: null, timer: null, ult: 0 };
  function escanear() {
    /* En la app de Android se usa el escáner de Google (rápido y sin
       permiso de cámara). Es el mismo que ya usa el lector de códigos. */
    if (window.VA && typeof VA.call === 'function') {
      VA.call('scan.barcode', {}).then(function (r) {
        var cod = String((r && r.code) || '').replace(/[\u0000-\u001F]/g, '').trim();
        if (cod) _buscaOk(cod);
      }, function (e) {
        if (e && e.code === 'canceled') return;
        avisar('No se pudo abrir el escáner', { icon: ico('alert'), variant: 'toast-danger', subtitle: 'Escribe su teléfono' });
      });
      return;
    }
    if (!('BarcodeDetector' in window) || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      avisar('Este navegador no puede leer códigos con la cámara', { icon: ico('alert'), variant: 'toast-wrap', subtitle: 'Escribe su teléfono: funciona igual' });
      return;
    }
    abrirHoja(
      '<div class="sheet-header"><h2>Escanear su QR</h2>' +
        '<button class="sheet-close" onclick="VPLealtad.cerrarScan()">' + ico('close') + '</button></div>' +
      '<div class="vl-scan"><video id="vlVideo" playsinline muted></video></div>' +
      '<p class="vl-hint" id="vlScanMsg" style="text-align:center;">Apunta la cámara al QR de su tarjeta.</p>' +
      '<button class="btn ghost block" onclick="VPLealtad.cerrarScan()">Mejor escribo su teléfono</button>',
      { dismissible: false });

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (st) {
      scan.stream = st;
      var v = document.getElementById('vlVideo');
      if (!v) { cerrarScan(); return; }
      v.srcObject = st; v.play().catch(function () {});
      var det;
      try { det = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { det = new BarcodeDetector(); }
      scan.timer = setInterval(function () {
        if (!v.videoWidth) return;
        det.detect(v).then(function (cods) {
          if (!cods || !cods.length) return;
          var cod = String(cods[0].rawValue || '').trim();
          if (!cod || Date.now() - scan.ult < 1200) return;
          scan.ult = Date.now();
          cerrarScan();
          _buscaOk(cod);
        }).catch(function () {});
      }, 320);
    }, function () {
      cerrarScan();
      avisar('No pudimos usar la cámara', { icon: ico('alert'), variant: 'toast-danger', subtitle: 'Escribe su teléfono' });
    });
  }
  function cerrarScan() {
    clearInterval(scan.timer); scan.timer = null;
    if (scan.stream) { try { scan.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} scan.stream = null; }
    if (buscaD.desde || buscaD.texto !== undefined) pintaBusca();
    else cerrar();
  }

  /* =======================================================================
     10.  DENTRO DEL COBRO QUE YA EXISTE
     No se crea otro cobro: se le agrega un bloque al de siempre.
  ======================================================================= */
  function cobro() {
    var ck = ref('checkout');
    if (!ck) return null;
    if (!ck.lealtad) ck.lealtad = null;
    return ck;
  }
  function ponEnCobro(c, premios) {
    var ck = cobro();
    if (!ck) return;
    ck.lealtad = { cliente: c, premios: premios || [], canje: null };
    /* Si el cobro ya tenía premios cargados, se respetan */
    if (!premios) {
      rpc('vp_lealtad_buscar', { p_texto: c.telefono }).then(function (r) {
        if (r && r.ok && ck.lealtad && ck.lealtad.cliente && ck.lealtad.cliente.id === c.id) {
          ck.lealtad.premios = r.premios || [];
          ck.lealtad.cliente = r.cliente || c;
          var f = fn('openCartSheet');
          if (f && document.querySelector('#modal-layer .modal-sheet')) f('checkout');
        }
      });
    }
  }
  function quitaDelCobro() {
    var ck = cobro();
    if (ck) ck.lealtad = null;
    var f = fn('openCartSheet'); if (f) f('checkout');
  }
  function elegirCanje(cual) {
    var ck = cobro();
    if (!ck || !ck.lealtad) return;
    ck.lealtad.canje = (ck.lealtad.canje === cual) ? null : cual;
    var f = fn('openCartSheet'); if (f) f('checkout');
  }
  function unidades(v) {
    var ck = cobro();
    if (ck && ck.lealtad) ck.lealtad.unidades = Math.max(Number(v) || 0, 0);
  }

  /** El bloque que se mete en la hoja del cobro. */
  function bloqueCobro() {
    if (!premium() || !encendido()) return '';
    estilos(); iconos();
    var ck = cobro();
    if (!ck) return '';
    var le = ck.lealtad;

    if (!le || !le.cliente) {
      return '<div class="vl-co" data-fx="leal">' +
        '<div class="vl-co-h">' + ico('vlCard') + 'Programa de lealtad</div>' +
        '<div class="vl-co-g">' +
          '<button class="btn ghost" onclick="VPLealtad.buscarCliente(\'cobro\')">' + ico('search') + ' Buscar cliente</button>' +
          '<button class="btn ghost" onclick="VPLealtad.escanearCobro()">' + ico('vlQr') + '</button>' +
        '</div>' +
        '<p class="vl-hint">Identifícalo y sus puntos suben solos al cobrar. Si no lo identificas, el cobro va igual.</p>' +
      '</div>';
    }

    var c = le.cliente;
    var s = saldoTexto(c);
    var canjeables = [];
    /* Premios ya ganados (visitas / compras) */
    (le.premios || []).forEach(function (p) {
      canjeables.push({ k: 'premio:' + p.id, t: p.nombre, s: premioTexto(p) });
    });
    /* Canje por puntos */
    if (modo() === 'puntos') {
      activas().forEach(function (r) {
        var alcanza = Number(c.puntos || 0) >= Number(r.costo_puntos || 0);
        canjeables.push({ k: 'rec:' + r.id, t: r.nombre, s: premioTexto(r) + ' · ' + r.costo_puntos + ' pts', no: !alcanza });
      });
    }

    var gana = '';
    if (modo() === 'puntos') {
      var tot = 0;
      try { var t2 = fn('computeTotals') ? ref('computeTotals')() : null; tot = t2 ? t2.total : 0; } catch (e) {}
      var pp = Number((L.cfg || {}).pesos_por_punto || 10);
      gana = 'Con este cobro gana ' + Math.floor(tot / Math.max(pp, 0.01)) + ' puntos.';
    } else if (modo() === 'visitas') {
      gana = 'Esta compra le cuenta como una visita' + (Number((L.cfg || {}).visita_minima) > 0 ? ' si pasa de ' + dinero((L.cfg || {}).visita_minima) : '') + '.';
    }

    return '<div class="vl-co" data-fx="leal">' +
      '<div class="vl-co-h">' + ico('vlCard') + 'Programa de lealtad</div>' +
      '<div class="vl-co-on">' + ico('person') +
        '<b>' + esc(c.nombre) + ' · ' + esc(s.join(' ')) + '</b>' +
        '<i onclick="VPLealtad.quitaDelCobro()" aria-label="Quitar">' + ico('close') + '</i>' +
      '</div>' +
      (modo() === 'compras'
        ? '<div class="field" style="margin:10px 0 0;"><label for="vlUn">¿Cuántas piezas participan?</label>' +
          '<input id="vlUn" type="number" inputmode="numeric" min="0" step="1" value="' + (le.unidades == null ? '' : le.unidades) + '" placeholder="Ej. 2" oninput="VPLealtad.unidades(this.value)">' +
          '<div class="field-hint">Solo las piezas del premio (los cafés, por ejemplo), no todo el ticket.</div></div>'
        : '') +
      (canjeables.length
        ? '<div class="vl-co-p">' + canjeables.map(function (x) {
            return '<button type="button" class="vl-prem ' + ((le.canje === x.k) ? 'on' : '') + '"' +
              (x.no ? ' disabled style="opacity:.5;cursor:default"' : ' onclick="VPLealtad.elegirCanje(\'' + x.k + '\')"') + '>' +
              esc(x.t) + '<small>' + esc(x.s) + (x.no ? ' · no le alcanza' : '') + '</small></button>';
          }).join('') + '</div>'
        : '') +
      '<p class="vl-hint">' + esc(gana) + (le.canje ? ' El premio elegido se le entrega con este cobro.' : '') + '</p>' +
    '</div>';
  }

  function escanearCobro() { buscaD = { texto: '', desde: 'cobro', buscando: false }; escanear(); }

  /* =======================================================================
     11.  CUANDO LA VENTA YA ESTÁ PAGADA
     Un solo lugar se encarga de todo: lee las ventas y las pone al día
     con el servidor. Así da igual si el cobro se procesó dos veces, si
     se canceló después o si entró desde otra caja.
  ======================================================================= */
  var HECHOS = 'vp_leal_hechos';         /* sin prefijo mesa_: es de ESTE aparato */
  function hechos() {
    try { return JSON.parse(localStorage.getItem(HECHOS) || '{}') || {}; } catch (e) { return {}; }
  }
  function marca(id, que) {
    try {
      var h = hechos();
      h[id] = (h[id] || '') + que;
      /* No crece para siempre: se queda con los últimos 400 */
      var ks = Object.keys(h);
      if (ks.length > 400) { ks.slice(0, ks.length - 400).forEach(function (k) { delete h[k]; }); }
      localStorage.setItem(HECHOS, JSON.stringify(h));
    } catch (e) {}
  }
  function yaHecho(id, que) { return String(hechos()[id] || '').indexOf(que) >= 0; }

  function devuelto(s) {
    var r = (s.returns || []).reduce(function (a, x) { return a + Math.abs(Number(x.total) || 0); }, 0);
    return r;
  }
  function esReturn(s) { var f = fn('saleIsReturn'); return f ? f(s) : s && s.type === 'devolucion'; }

  var sincroT = null;
  function sincronizar() {
    clearTimeout(sincroT);
    sincroT = setTimeout(function () { sincroYa(); }, 900);
  }
  function sincroYa() {
    if (!nube() || !premium()) return Promise.resolve(false);
    var dbo = ref('DB');
    if (!dbo || typeof dbo.getSales !== 'function') return Promise.resolve(false);
    var ventas;
    try { ventas = dbo.getSales().slice(-120); } catch (e) { return Promise.resolve(false); }

    var tareas = [];
    ventas.forEach(function (s) {
      if (!s || !s.lealtadClienteId || esReturn(s)) return;
      var completa = !!s.cancelled || devuelto(s) >= Number(s.total || 0) - 0.01;

      /* 1) Sumar los puntos de una venta pagada */
      if (!completa && !yaHecho(s.id, 'A')) {
        tareas.push(rpc('vp_lealtad_acumular', {
          p_cliente_id: s.lealtadClienteId,
          p_venta_id: s.id,
          p_monto: Number(s.total || 0),
          p_venta_numero: Number(s.number || 0) || null,
          p_origen: s.origin === 'menu' ? 'menu' : 'caja',
          p_unidades: Number(s.lealtadUnidades || 0),
          p_hecho_por: s.userName || ''
        }).then(function (r) {
          if (r && r.ok) {
            marca(s.id, 'A');
            if (r.ganados && r.ganados.length) {
              avisar('¡' + String((r.cliente || {}).nombre || 'El cliente').split(/\s+/)[0] + ' ganó un premio!', {
                icon: ico('vlStar'), variant: 'toast-success toast-top',
                subtitle: r.ganados.map(function (g) { return g.nombre; }).join(', ') + ' · se le entrega en su próxima compra',
                duration: 5000
              });
            }
          }
          return r;
        }));
      }

      /* 2) Se canceló o se devolvió completa: se regresa lo que dio */
      if (completa && yaHecho(s.id, 'A') && !yaHecho(s.id, 'R')) {
        tareas.push(rpc('vp_lealtad_reversar', {
          p_venta_id: s.id,
          p_nota: s.cancelled ? 'Venta cancelada' : 'Venta devuelta completa'
        }).then(function (r) { if (r && r.ok) marca(s.id, 'R'); return r; }));
      }

      /* 3) Y si en ese cobro se canjeó un premio, el premio regresa */
      if (completa && s.lealtadCanje && !yaHecho(s.id, 'C')) {
        tareas.push(rpc('vp_lealtad_canje_revertir', { p_venta_id: s.id })
          .then(function (r) { if (r && r.ok) marca(s.id, 'C'); return r; }));
      }
    });

    if (!tareas.length) return Promise.resolve(false);
    return Promise.all(tareas).then(function () {
      return cargar(true).then(function () { if (ref('currentView') === 'lealtad') repintar(); return true; });
    });
  }

  /* =======================================================================
     12.  ENGANCHES  (sin tocar index.html)
  ======================================================================= */
  function engancha() {
    var ok = true;

    /* ---- la sección nueva ---- */
    var EV = ref('EXTRA_VIEWS');
    if (EV && !EV.lealtad) EV.lealtad = vista;
    if (!EV) ok = false;

    /* ---- el bloque dentro del cobro ---- */
    var cs = fn('cartSheetHTML');
    if (cs && !cs.__vl) {
      var envCS = function (paso) {
        var html = cs.apply(this, arguments);
        if (paso !== 'checkout') return html;
        try {
          var bl = bloqueCobro();
          if (!bl) return html;
          /* Justo antes de los botones de Cobrar: se ve sin tener que buscarlo */
          var ancla = '<div class="p2-actions"';
          var i = html.lastIndexOf(ancla);
          return i < 0 ? html : html.slice(0, i) + bl + html.slice(i);
        } catch (e) { return html; }
      };
      envCS.__vl = true;
      window.cartSheetHTML = envCS;
      try { eval('cartSheetHTML = envCS'); } catch (e) {}
    }

    /* ---- el carrito se vacía: también la lealtad ---- */
    var nc = fn('newCheckout');
    if (nc && !nc.__vl) {
      var envNC = function () {
        var c = nc.apply(this, arguments);
        if (c && typeof c === 'object') c.lealtad = null;
        return c;
      };
      envNC.__vl = true;
      window.newCheckout = envNC;
      try { eval('newCheckout = envNC'); } catch (e) {}
    }

    /* ---- al cobrar: la venta se queda con el cliente de lealtad ---- */
    var cc = fn('confirmarCobro');
    if (cc && !cc.__vl) {
      var envCC = function () {
        var ck = ref('checkout');
        var le = (ck && ck.lealtad) ? ck.lealtad : null;
        var antes = 0;
        var dbo = ref('DB');
        try { antes = dbo ? dbo.getSales().length : 0; } catch (e) {}

        var r = cc.apply(this, arguments);

        if (le && le.cliente && dbo) {
          try {
            var v = dbo.getSales();
            if (v.length > antes) {
              var s = v[v.length - 1];
              s.lealtadClienteId = le.cliente.id;
              s.lealtadNombre = le.cliente.nombre;
              if (le.unidades) s.lealtadUnidades = Number(le.unidades) || 0;
              if (le.canje) s.lealtadCanje = le.canje;
              dbo.saveSales(v);

              /* El canje se registra en el servidor con el id de la venta */
              if (le.canje) {
                var p = le.canje.split(':');
                rpc('vp_lealtad_canjear', {
                  p_cliente_id: le.cliente.id,
                  p_recompensa_id: p[0] === 'rec' ? p[1] : null,
                  p_premio_id: p[0] === 'premio' ? p[1] : null,
                  p_venta_id: s.id,
                  p_hecho_por: yo()
                }).then(function (res) {
                  if (!res || !res.ok) return queja(res);
                  avisar('Premio entregado', { icon: ico('gift'), variant: 'toast-success', subtitle: (res.premio || {}).nombre || '' });
                });
              }
              sincronizar();
            }
          } catch (e) { console.error('Vendo plus · lealtad', e); }
        }
        return r;
      };
      envCC.__vl = true;
      window.confirmarCobro = envCC;
      try { eval('confirmarCobro = envCC'); } catch (e) {}
    }

    /* ---- cualquier cambio en las ventas (cancelar, devolver, otra caja) ---- */
    var dbo2 = ref('DB');
    if (dbo2 && typeof dbo2.saveSales === 'function' && !dbo2.saveSales.__vl) {
      var ss = dbo2.saveSales;
      var envSS = function () {
        var r = ss.apply(this, arguments);
        sincronizar();
        return r;
      };
      envSS.__vl = true;
      dbo2.saveSales = envSS;
    }

    /* ---- pedido del Menú Digital que se va a cobrar: ¿dejó su teléfono? ---- */
    var oc = fn('openCartSheet');
    if (oc && !oc.__vl) {
      var envOC = function (paso) {
        var r = oc.apply(this, arguments);
        if (paso === 'checkout') revisaReclamo();
        return r;
      };
      envOC.__vl = true;
      window.openCartSheet = envOC;
      try { eval('openCartSheet = envOC'); } catch (e) {}
    }

    /* ---- el Menú Digital publica si el programa está encendido ---- */
    var ps = fn('mdPublicSnapshot');
    if (ps && !ps.__vl) {
      var envPS = function () {
        var s = ps.apply(this, arguments);
        try {
          if (s && s.cfg) {
            s.cfg.leal = (premium() && encendido())
              ? { on: true, modo: modo(), titulo: (L.cfg || {}).tarjeta_titulo || negocioNombre() }
              : undefined;
            if (!s.cfg.leal) delete s.cfg.leal;
          }
        } catch (e) {}
        return s;
      };
      envPS.__vl = true;
      window.mdPublicSnapshot = envPS;
      try { eval('mdPublicSnapshot = envPS'); } catch (e) {}
    }

    /* ---- el cliente, desde el Menú Digital, deja su teléfono ---- */
    enganchaMenuCliente();

    iconos();
    return ok;
  }

  /** La caja abre el cobro de un pedido del Menú Digital: se busca el reclamo. */
  var reclamoVisto = {};
  function revisaReclamo() {
    if (!premium() || !encendido()) return;
    var ck = ref('checkout');
    if (!ck || !ck.menuOrderId || (ck.lealtad && ck.lealtad.cliente)) return;
    var M = ref('MDI');
    var o = (M && typeof M.get === 'function') ? M.get(ck.menuOrderId) : null;
    var code = o && o.code;
    if (!code || reclamoVisto[code]) return;
    reclamoVisto[code] = true;
    rpc('vp_lealtad_reclamo_cliente', { p_order_code: code }).then(function (r) {
      if (!r || !r.ok || r.nada || !r.cliente) return;
      ponEnCobro(r.cliente, []);
      meteCliente(r.cliente);
      var f = fn('openCartSheet');
      if (f && document.querySelector('#modal-layer .modal-sheet')) f('checkout');
      avisar(String(r.cliente.nombre).split(/\s+/)[0] + ' pidió sus puntos', {
        icon: ico('vlCard'), variant: 'toast-success',
        subtitle: 'Vino en el pedido ' + code + ' · ya quedó puesto en el cobro'
      });
    });
  }

  /** En el celular del cliente (Menú Digital): un campo opcional de teléfono. */
  function enganchaMenuCliente() {
    var dmr = ref('DMR');
    var ch = fn('dmConfirmHTML');
    var cs = fn('mdiCloudSend');

    function lealDelMenu() {
      try {
        var c = fn('mdCfg') ? ref('mdCfg')() : null;
        return (c && c.leal && c.leal.on) ? c.leal : null;
      } catch (e) { return null; }
    }

    if (ch && !ch.__vl) {
      var envCH = function () {
        var html = ch.apply(this, arguments);
        try {
          var leal = lealDelMenu();
          if (!leal) return html;
          var co = fn('dmCoState') ? ref('dmCoState')() : null;
          var val = (co && co.lealTel) || '';
          var bloque =
            '<div class="dm-co-sec"><div class="dm-co-label">Programa de lealtad (opcional)</div>' +
            '<p class="dm-co-hint">Deja tu teléfono y este pedido te suma puntos en ' + esc(leal.titulo || 'el negocio') + '.</p>' +
            '<div class="field" style="margin:0;">' +
            '<input id="dmLealTel" type="tel" inputmode="numeric" maxlength="15" autocomplete="tel" placeholder="Tu teléfono (10 dígitos)" value="' + esc(val) + '" ' +
            'oninput="try{dmCoState().lealTel=this.value.replace(/\\D/g,\'\').slice(0,15)}catch(e){}"></div></div>';
          /* Va junto a los datos del pedido, antes del resumen de pago */
          var i = html.indexOf('<div class="dm-actions"');
          if (i < 0) i = html.indexOf('<div class="dm-co-pay"');
          return i < 0 ? html + bloque : html.slice(0, i) + bloque + html.slice(i);
        } catch (e) { return html; }
      };
      envCH.__vl = true;
      window.dmConfirmHTML = envCH;
      try { eval('dmConfirmHTML = envCH'); } catch (e) {}
    }

    if (cs && !cs.__vl) {
      var envCS2 = function (order) {
        var r = cs.apply(this, arguments);
        try {
          var leal = lealDelMenu();
          var co = fn('dmCoState') ? ref('dmCoState')() : null;
          var el = document.getElementById('dmLealTel');
          var tel = String((el && el.value) || (co && co.lealTel) || '').replace(/\D/g, '');
          var id = ref('dm') ? ref('dm').id : null;
          if (leal && tel.length >= 7 && order && order.code && id) {
            /* Solo se deja el "soy yo". Los puntos los da el servidor
               cuando la caja cobra el pedido. */
            var c = nube() || window.Cloud;
            var cfgv = window.VENDO_CONFIG || ref('VENDO_CONFIG');
            if (cfgv && cfgv.SUPABASE_URL && cfgv.SUPABASE_ANON_KEY) {
              fetch(cfgv.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/vp_lealtad_reclamo', {
                method: 'POST', keepalive: true,
                headers: { apikey: cfgv.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfgv.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ p_menu_id: id, p_order_code: order.code, p_telefono: tel, p_nombre: (order.customer && order.customer.name) || null })
              }).catch(function () {});
            }
          }
        } catch (e) {}
        return r;
      };
      envCS2.__vl = true;
      window.mdiCloudSend = envCS2;
      try { eval('mdiCloudSend = envCS2'); } catch (e) {}
    }
  }

  /* =======================================================================
     13.  ARRANQUE
  ======================================================================= */
  function irA() {
    if (!premium()) { if (window.VPPremium) VPPremium.abrir('lealtad'); return; }
    var f = fn('goTo');
    if (f) f('lealtad');
  }

  function arrancar() {
    estilos(); iconos();
    /* index.html puede tardar en terminar de cargar: se intenta un rato. */
    var n = 0;
    var t = setInterval(function () { if (engancha() || ++n > 60) clearInterval(t); }, 500);
    engancha();
    /* Al entrar y al volver a la app se ponen al día los puntos pendientes. */
    setTimeout(function () { if (nube()) cargar().then(function () { sincroYa(); }); }, 2500);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && nube() && premium()) sincroYa();
    });
    window.addEventListener('online', function () { if (nube() && premium()) sincroYa(); });
  }

  /* =======================================================================
     14.  LO QUE QUEDA DISPONIBLE PARA EL RESTO DE VENDO PLUS
  ======================================================================= */
  window.VPLealtad = {
    vista: vista,
    irA: irA,
    recargar: recargar,
    tab: function (t) { L.pestana = t; repintar(); },
    filtrar: function (v) {
      L.busca = v;
      var el = document.getElementById('vlBusca');
      var pos = el ? el.selectionStart : null;
      repintar();
      setTimeout(function () {
        var e2 = document.getElementById('vlBusca');
        if (e2) { e2.focus(); if (pos != null) try { e2.setSelectionRange(pos, pos); } catch (e) {} }
      }, 0);
    },
    config: config, guardar: guardar, cerrarConfig: cerrarConfig,
    _cfg: _cfg, _recEdit: _recEdit, _recSet: _recSet, _recOk: _recOk, _recQuita: _recQuita, _recVolver: _recVolver,
    alta: alta, _alta: _alta, _altaOk: _altaOk, _altaVolver: _altaVolver,
    ficha: ficha, cerrarFicha: cerrarFicha, verMovs: verMovs,
    mandarTarjeta: mandarTarjeta, copiarTarjeta: copiarTarjeta,
    nuevoCodigo: nuevoCodigo, baja: baja,
    ajustar: ajustar, _aj: _aj, _ajOk: _ajOk,
    buscarCliente: buscarCliente, _busca: _busca, _buscaOk: _buscaOk, _buscaVolver: _buscaVolver,
    altaDesdeBusca: altaDesdeBusca,
    escanear: escanear, escanearCobro: escanearCobro, cerrarScan: cerrarScan,
    quitaDelCobro: quitaDelCobro, elegirCanje: elegirCanje, unidades: unidades,
    bloqueCobro: bloqueCobro,
    sincronizar: sincroYa,
    activo: function () { return premium() && encendido(); },
    enlaceTarjeta: enlaceTarjeta,
    qrSVG: qrSVG
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
