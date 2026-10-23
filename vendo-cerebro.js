/* =========================================================================
   VENDO PLUS · CEREBRO DEL ASISTENTE  (vendo-cerebro.js)
   -------------------------------------------------------------------------
   Este archivo ENTIENDE las preguntas y las RESPONDE con tus datos reales.

   Regla de oro del costo:
     1. Primero intenta entender la pregunta con reglas, sinónimos y
        tolerancia a errores de ortografía.  (0 pesos, 0 red)
     2. Si la entiende, saca la respuesta de los MISMOS cálculos que ya usa
        Vendo Plus (reportData, DB, lowStockProducts…).  (0 pesos, 0 red)
     3. Si NO la entiende, busca en la memoria de frases ya aprendidas.
        (0 pesos, 0 red)
     4. Solo si todo lo anterior falla, le pregunta a Gemini 2.5 Flash-Lite
        —a través de una Edge Function de Supabase— ÚNICAMENTE cuál era la
        intención.  Gemini nunca ve tus ventas, ni tus clientes, ni nada.
     5. Lo que Gemini contestó se guarda para que esa frase nunca se
        vuelva a pagar.

   Es el mismo archivo para la página web y para la app de Play Store.
========================================================================= */
(function () {
  'use strict';
  if (window.VPCerebro) return;

  /* =======================================================================
     0.  PUENTE CON VENDO PLUS
     index.html declara sus cosas con const/let en el ámbito global, así que
     se pueden usar por su nombre. Todo va envuelto por si algo cambiara.
  ======================================================================= */
  function ref(nombre) {
    try { return eval(nombre); } catch (e) { return undefined; }
  }
  /* Atajos seguros a lo que ya existe en Vendo Plus */
  var VP = {
    get DB()          { return ref('DB'); },
    get reportData()  { return ref('reportData'); },
    get reportState() { return ref('reportState'); },
    get periodRange() { return ref('periodRange'); },
    get formatMoney() { return ref('formatMoney'); },
    get lowStock()    { return ref('lowStockProducts'); },
    get stockInfo()   { return ref('stockInfo'); },
    get can()         { return ref('can'); },
    get isOwner()     { return ref('isOwner'); },
    get round2()      { return ref('round2'); },
    get fmtStock()    { return ref('fmtStock'); },
    get fmtNum()      { return ref('fmtNum'); },
    get custBalances(){ return ref('customerBalances'); },
    get receivable()  { return ref('totalReceivable'); },
    get cashCurrent() { return ref('cashCurrent'); },
    get visibleSales(){ return ref('visibleSales'); },
    get dayKey()      { return ref('dayKey'); },
    get currentUser() { return ref('currentUser'); },
    get Cloud()       { return ref('Cloud'); },
    get CFG()         { return ref('VENDO_CONFIG'); }
  };
  function listo() { return typeof VP.reportData === 'function' && !!VP.DB; }

  function dinero(n) {
    var f = VP.formatMoney;
    if (typeof f === 'function') return f(n);
    return '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(n) {
    var f = VP.fmtNum;
    if (typeof f === 'function') return f(n);
    return String(Math.round((Number(n) || 0) * 1000) / 1000);
  }
  function puede(p) { var f = VP.can; return typeof f === 'function' ? f(p) : true; }

  /* =======================================================================
     1.  NORMALIZAR Y "OÍR BIEN" LO QUE ESCRIBIÓ EL USUARIO
     Quita acentos, signos, abreviaciones de chat y convierte cada palabra
     a una "clave fonética" en español, para que estas se parezcan:
        vendi / bendi / vendí      ·   ayer / aller / aier
        ganancia / ganansia        ·   cuánto / quanto / kuanto
  ======================================================================= */
  var ABREVIA = {
    q: 'que', k: 'que', xq: 'porque', pq: 'porque', xfa: 'porfavor', porfa: 'porfavor',
    tmb: 'tambien', tb: 'tambien', dnd: 'donde', cnt: 'cuanto', ctos: 'cuantos',
    x: 'por', d: 'de', pa: 'para', ps: 'pues', toy: 'estoy', hoi: 'hoy', oy: 'hoy',
    'q tal': 'que tal', vdd: 'verdad', xd: '', jaja: '', jeje: '', porfis: 'porfavor'
  };

  function sinAcentos(t) {
    return String(t || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ñ/g, 'n');
  }

  /** Texto listo para analizar: minúsculas, sin acentos, sin signos. */
  function normalizar(t) {
    var s = sinAcentos(t)
      .replace(/[¿?¡!.,;:()"'`´%$@#*_\-\/\\+=<>\[\]{}|…«»“”‘’–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    /* abreviaciones de chat */
    s = s.split(' ').map(function (w) {
      return Object.prototype.hasOwnProperty.call(ABREVIA, w) ? ABREVIA[w] : w;
    }).join(' ').replace(/\s+/g, ' ').trim();
    return s;
  }

  /** Clave fonética del español: iguala b/v, s/c/z, y/ll, h muda, j/g, qu/k… */
  function fonetica(w) {
    var s = sinAcentos(w);
    s = s.replace(/[^a-z0-9]/g, '');
    if (!s) return '';
    s = s.replace(/^h/, '').replace(/h/g, '');
    s = s.replace(/ll/g, 'y');
    s = s.replace(/qu([ei])/g, 'k$1').replace(/q/g, 'k');
    s = s.replace(/g([ei])/g, 'j$1');
    s = s.replace(/gu([ei])/g, 'g$1');
    s = s.replace(/c([eiy])/g, 's$1').replace(/c/g, 'k');
    s = s.replace(/z/g, 's').replace(/x/g, 's');
    s = s.replace(/v/g, 'b').replace(/w/g, 'b');
    s = s.replace(/y/g, 'i');
    s = s.replace(/(.)\1+/g, '$1');     /* letras dobles */
    s = s.replace(/s$/, '');            /* plural simple */
    s = s.replace(/es$/, '');
    return s;
  }

  /** Distancia de edición con tope (barata: corta en cuanto se pasa). */
  function distancia(a, b, tope) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > tope) return tope + 1;
    var fila = new Array(lb + 1), i, j, ant, tmp, mejor;
    for (j = 0; j <= lb; j++) fila[j] = j;
    for (i = 1; i <= la; i++) {
      ant = fila[0]; fila[0] = i; mejor = fila[0];
      for (j = 1; j <= lb; j++) {
        tmp = fila[j];
        fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, ant + (a[i - 1] === b[j - 1] ? 0 : 1));
        ant = tmp;
        if (fila[j] < mejor) mejor = fila[j];
      }
      if (mejor > tope) return tope + 1;
    }
    return fila[lb];
  }

  /* Cuánto error de dedo se perdona. Apretado a propósito: si se afloja,
     palabras que no tienen nada que ver se empiezan a parecer
     ("partido" ≈ "surtido") y el asistente contesta cualquier cosa. */
  function toleranciaDe(w) { return w.length <= 4 ? 0 : (w.length <= 7 ? 1 : 2); }

  /* =======================================================================
     2.  DICCIONARIO:  concepto  ->  formas de decirlo
     Todo se indexa por clave fonética, así que los errores de dedo y de
     ortografía entran solos.
  ======================================================================= */
  var LEXICO = {
    /* ---- métricas ---- */
    ventas:      ['vendi', 'vender', 'venta', 'ventas', 'vendido', 'vendimos', 'facture', 'facturacion', 'ingreso', 'ingresos', 'entro', 'entraron', 'cobre', 'cobrado', 'vendiste', 'venti'],
    ganancia:    ['gane', 'gano', 'ganancia', 'ganancias', 'ganar', 'utilidad', 'utilidades', 'margen', 'rendimiento', 'ganado', 'ganamos', 'lucro'],
    neta:        ['neta', 'neto', 'limpia', 'limpio', 'despues de gastos', 'me queda limpio', 'queda libre'],
    bruta:       ['bruta', 'bruto'],
    pedidos:     ['pedido', 'pedidos', 'orden', 'ordenes', 'ticket', 'tickets', 'nota', 'notas', 'cuantas ventas', 'transacciones', 'operaciones', 'clientes atendi', 'ventas hice'],
    ticket:      ['ticket promedio', 'promedio por venta', 'venta promedio', 'promedio de venta', 'gasto promedio', 'cuanto gasta cada cliente', 'compra promedio'],
    gastos:      ['gaste', 'gasto', 'gastos', 'egreso', 'egresos', 'salida', 'salidas', 'pague', 'compre', 'costos fijos', 'gastamos'],
    costo:       ['costo', 'costos', 'me costo', 'cuanto me costo', 'costo de lo vendido'],
    propinas:    ['propina', 'propinas', 'tip', 'tips'],
    descuentos:  ['descuento', 'descuentos', 'rebaja', 'rebajas'],
    devoluciones:['devolucion', 'devoluciones', 'devolvieron', 'devuelto', 'regresaron', 'cancelaciones', 'canceladas'],
    iva:         ['iva', 'impuesto', 'impuestos'],
    abonos:      ['abono', 'abonos', 'me pagaron', 'pagos de clientes', 'cobranza'],

    /* ---- métodos de pago ---- */
    efectivo:    ['efectivo', 'cash', 'contado', 'en mano', 'billete', 'monedas'],
    tarjeta:     ['tarjeta', 'terminal', 'card', 'con tarjeta', 'debito', 'credito bancario'],
    transferencia:['transferencia', 'transfer', 'spei', 'deposito', 'depositaron', 'transferencias', 'transfirieron', 'transfirio', 'transferido', 'me pasaron a la cuenta'],
    fiado:       ['fiado', 'credito', 'me deben', 'deuda', 'deudas', 'deben', 'deudores', 'por cobrar', 'cuentas por cobrar', 'prestado', 'apuntado'],

    /* ---- dimensiones ---- */
    producto_top:  ['producto mas vendido', 'que vendo mas', 'que se vende mas', 'mas vendido', 'lo que mas vendo', 'top productos', 'mejor producto', 'producto estrella', 'que mas se vende', 'mas sale'],
    producto_bajo: ['menos vendido', 'que vendo menos', 'lo que menos vendo', 'peor producto', 'no se vende', 'que no sale', 'menos sale'],
    categoria_top: ['categoria mas vendida', 'que categoria', 'mejor categoria', 'por categoria', 'categorias'],
    mejor_dia:     ['mejor dia', 'dia que mas vendi', 'que dia vendi mas', 'mi mejor dia', 'dia mas fuerte'],
    peor_dia:      ['peor dia', 'dia que menos vendi', 'dia mas flojo'],
    mejor_hora:    ['mejor hora', 'a que hora vendo mas', 'hora pico', 'horario fuerte', 'que hora vendo mas', 'hora que mas vendo'],
    por_usuario:   ['quien vendio mas', 'por empleado', 'por usuario', 'por vendedor', 'mejor vendedor', 'mi empleado'],

    /* ---- inventario ---- */
    bajo_stock:  ['por agotarse', 'se esta acabando', 'queda poco', 'poco stock', 'bajo inventario', 'tengo que surtir', 'que comprar', 'reabastecer', 'resurtir', 'se me acaba', 'esta por acabarse', 'quedan pocos', 'existencias bajas',
                  'acabando', 'acabar', 'acabarse', 'surtir', 'surtido', 'agotarse', 'agotando', 'escasea', 'escaseando', 'faltante', 'faltantes', 'repone', 'reponer', 'pedir mas',
                  'me falta', 'que falta', 'faltan', 'debo comprar', 'hay que comprar', 'tengo que comprar', 'necesito comprar', 'comprar'],
    agotados:    ['agotado', 'agotados', 'agotada', 'agotadas', 'sin existencia', 'se acabo', 'se acabaron', 'en cero', 'sin stock', 'no me queda nada de',
                  'que no tengo', 'cuales no tengo', 'productos no tengo', 'no tengo nada de'],
    inventario:  ['inventario', 'existencias', 'stock', 'almacen', 'mercancia', 'cuanto tengo de'],
    valor_inv:   ['valor del inventario', 'cuanto vale mi inventario', 'cuanto tengo invertido', 'valor de mi mercancia', 'cuanto dinero tengo en producto'],

    /* ---- otros ---- */
    caja:        ['caja', 'corte', 'corte de caja', 'cuanto hay en caja', 'dinero en caja', 'efectivo en caja'],
    resumen:     ['resumen', 'como voy', 'como va el dia', 'como me fue', 'como vamos', 'dame un resumen', 'reporte', 'reporteme', 'como estuvo', 'como va el negocio', 'resumen del dia'],
    comparar:    ['comparado', 'comparacion', 'compara', 'vs', 'contra', 'mejor que', 'peor que', 'mas que ayer', 'diferencia con'],
    clientes:    ['clientes', 'cuantos clientes', 'mis clientes', 'cliente nuevo'],
    ayuda:       ['ayuda', 'que puedes hacer', 'que sabes hacer', 'como funcionas', 'opciones', 'que te puedo preguntar', 'para que sirves', 'menu'],

    /* ---- el asistente solo CONSULTA: nunca cambia nada ---- */
    accion:      ['borra', 'borrar', 'elimina', 'eliminar', 'agrega', 'agregar', 'anade', 'anadir',
                  'registra', 'registrar', 'crea', 'crear', 'modifica', 'modificar', 'cambia', 'cambiar',
                  'edita', 'editar', 'actualiza', 'actualizar', 'quita', 'quitar', 'ponle', 'guarda', 'guardar',
                  'cancela', 'cancelar', 'devuelve', 'reembolsa'],
    como_hacer:  ['como hago', 'como se hace', 'como hacer', 'como agrego', 'como pongo', 'como creo',
                  'como imprimo', 'como configuro', 'como activo', 'como cancelo', 'como borro',
                  'como le hago', 'como puedo', 'donde esta', 'donde encuentro', 'donde veo', 'donde se',
                  'como registro', 'como cambio'],
    saludo:      ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'que onda', 'que tal', 'hey', 'holi', 'saludos', 'quiubo'],

    /* ---- plática: "¿cómo estás?", "gracias", "adiós" ----
       Esto NO son preguntas del negocio, pero la gente las escribe un montón
       (más todavía cuando el asistente tiene cara). Se contestan aquí, con
       reglas, para no pagarle a Gemini por entender un "gracias". */
    charla:      ['como estas', 'como te va', 'como has estado', 'como andas', 'todo bien',
                  'que haces', 'que cuentas', 'que me cuentas', 'estas ahi', 'sigues ahi',
                  'me escuchas', 'me oyes', 'funcionas', 'sirves', 'ya funcionas'],
    identidad:   ['quien eres', 'que eres', 'como te llamas', 'cual es tu nombre', 'tu nombre',
                  'eres un robot', 'eres robot', 'eres una ia', 'eres ia', 'eres humano',
                  'eres persona', 'eres real', 'te hizo', 'quien te hizo', 'eres chatgpt',
                  'eres gemini', 'de donde sales'],
    gracias:     ['gracias', 'muchas gracias', 'te pasas', 'muy bien', 'excelente', 'perfecto',
                  'buena onda', 'eres bueno', 'eres buena', 'me sirve', 'sirvio', 'genial'],
    despedida:   ['adios', 'bye', 'nos vemos', 'hasta luego', 'hasta mañana', 'ya me voy',
                  'ahi nos vemos', 'chao', 'buenas noches ya', 'descansa'],

    /* ---- marcadores sueltos: no son la pregunta, pero la definen ----
       Sirven para entender la pregunta aunque las palabras vayan en otro
       orden ("qué producto vendo más" / "qué vendo más" / "el producto que
       más vendo"), que es como habla la gente de verdad. */
    m_mas:       ['mas', 'mayor', 'mayormente', 'top', 'estrella', 'fuerte'],
    m_menos:     ['menos', 'menor', 'peor', 'flojo', 'floja', 'bajo'],
    m_mejor:     ['mejor', 'bueno', 'buena', 'exitoso'],
    m_producto:  ['producto', 'productos', 'articulo', 'articulos', 'cosa', 'cosas', 'mercancia', 'item'],
    m_categoria: ['categoria', 'categorias', 'linea', 'rubro', 'familia'],
    m_dia:       ['dia', 'dias', 'jornada', 'fecha'],
    m_hora:      ['hora', 'horas', 'horario', 'momento'],
    m_quien:     ['quien', 'quienes', 'empleado', 'empleados', 'vendedor', 'vendedores', 'cajero', 'cajera'],
    m_valor:     ['valor', 'vale', 'valen', 'invertido', 'invertida', 'capital'],
    m_tengo:     ['tengo', 'tienes', 'hay', 'queda', 'quedan', 'disponible', 'disponibles', 'me quedan'],
    m_cuanto:    ['cuanto', 'cuanta', 'cuantos', 'cuantas', 'cuant'],
    m_que:       ['que', 'cual', 'cuales']
  };

  /* ---- periodos ---- */
  var PERIODOS = [
    { id: 'today',     frases: ['hoy', 'el dia de hoy', 'ahorita', 'ahora', 'este dia', 'del dia'] },
    { id: 'yesterday', frases: ['ayer', 'el dia de ayer'] },
    { id: 'week',      frases: ['esta semana', 'la semana', 'semana actual', 'en la semana', 'semanal'] },
    { id: 'lastweek',  frases: ['semana pasada', 'la semana anterior', 'semana antepasada'] },
    { id: 'month',     frases: ['este mes', 'el mes', 'mes actual', 'en el mes', 'mensual', 'del mes'] },
    { id: 'lastmonth', frases: ['mes pasado', 'el mes anterior'] },
    { id: 'year',      frases: ['este ano', 'el ano', 'ano actual', 'anual', 'en el ano'] },
    { id: 'all',       frases: ['siempre', 'historico', 'en total', 'de todo', 'todo el tiempo', 'desde que empece', 'en general'] }
  ];

  /* Índice fonético: clave -> [{ concepto, palabras, peso }] */
  var INDICE = (function () {
    var idx = {};
    function meter(concepto, frase) {
      var ws = normalizar(frase).split(' ').filter(Boolean).map(fonetica).filter(Boolean);
      if (!ws.length) return;
      var clave = ws[0];
      (idx[clave] = idx[clave] || []).push({ c: concepto, w: ws, n: ws.length });
    }
    Object.keys(LEXICO).forEach(function (c) { LEXICO[c].forEach(function (f) { meter(c, f); }); });
    PERIODOS.forEach(function (p) { p.frases.forEach(function (f) { meter('@' + p.id, f); }); });
    return idx;
  })();

  var CLAVES = Object.keys(INDICE);

  /** Busca qué conceptos aparecen en el texto. Devuelve {concepto: posición}. */
  function detectar(texto) {
    var tokens = normalizar(texto).split(' ').filter(Boolean).map(fonetica).filter(Boolean);
    var hallados = {};
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      /* candidatos: clave exacta, o la más parecida dentro de la tolerancia */
      var candidatos = INDICE[t] ? INDICE[t].slice() : [];
      if (!candidatos.length) {
        var tol = toleranciaDe(t), mejorK = null, mejorD = tol + 1;
        if (tol > 0) {
          for (var k = 0; k < CLAVES.length; k++) {
            /* la primera letra tiene que coincidir: casi ningún error de
               dedo cambia la inicial, y así no se confunden palabras ajenas */
            if (CLAVES[k][0] !== t[0]) continue;
            var d = distancia(t, CLAVES[k], tol);
            if (d < mejorD) { mejorD = d; mejorK = CLAVES[k]; if (d === 0) break; }
          }
        }
        if (mejorK) candidatos = INDICE[mejorK].slice();
      }
      /* de los candidatos, gana la frase más larga que sí embona completa */
      candidatos.sort(function (a, b) { return b.n - a.n; });
      for (var c = 0; c < candidatos.length; c++) {
        var cand = candidatos[c], ok = true;
        for (var j = 1; j < cand.n; j++) {
          var sig = tokens[i + j];
          if (!sig) { ok = false; break; }
          if (distancia(sig, cand.w[j], toleranciaDe(cand.w[j])) > toleranciaDe(cand.w[j])) { ok = false; break; }
        }
        if (ok) {
          if (hallados[cand.c] === undefined) hallados[cand.c] = i;
          if (cand.n > 1) i += cand.n - 1;
          break;
        }
      }
    }
    return hallados;
  }

  /* =======================================================================
     3.  DE "LO QUE DIJO" A UNA INTENCIÓN CONCRETA
  ======================================================================= */
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function sacarPeriodo(texto, hallados) {
    var t = normalizar(texto);
    /* Para las fechas se usa el texto SIN limpiar los signos: normalizar()
       convierte "12/05/2026" en "12 05 2026" y ya no se reconocería. */
    var tf = sinAcentos(texto);
	/* "hace 5 días", "hace 10 dias", etc. */
var hace = t.match(/\bhace\s+(\d{1,3})\s*dias?\b/);

if (hace) {
  var cantidad = parseInt(hace[1], 10);
  var fecha = new Date();
  fecha.setDate(fecha.getDate() - cantidad);

  var clave = claveDia(fecha);

  return {
    periodo: 'custom',
    desde: clave,
    hasta: clave,
    etiqueta: 'hace ' + cantidad + ' días'
  };
}
    /* antier / anteayer */
    if (/\bante\s?ayer\b|\bantier\b/.test(t)) {
      var d = new Date(); d.setDate(d.getDate() - 2);
      var k = claveDia(d);
      return { periodo: 'custom', desde: k, hasta: k, etiqueta: 'antier' };
    }
    /* "últimos N días" */
    var m = t.match(/ultim[oa]s?\s+(\d{1,3})\s*(dia|dias|d)\b/);
    if (m) {
      var n = Math.min(365, Math.max(1, parseInt(m[1], 10)));
      var a = new Date(); a.setDate(a.getDate() - (n - 1));
      return { periodo: 'custom', desde: claveDia(a), hasta: claveDia(new Date()), etiqueta: 'los últimos ' + n + ' días' };
    }
    /* "en mayo", "de marzo" */
    for (var i = 0; i < MESES.length; i++) {
      if (new RegExp('\\b' + MESES[i].slice(0, 4)).test(t) && /\b(en|de|del|durante)\b/.test(t)) {
        var hoy = new Date();
        var anio = hoy.getFullYear() - (i > hoy.getMonth() ? 1 : 0);
        var ini = new Date(anio, i, 1), fin = new Date(anio, i + 1, 0);
        return { periodo: 'custom', desde: claveDia(ini), hasta: claveDia(fin), etiqueta: MESES[i] + ' de ' + anio };
      }
    }
    /* fecha explícita 12/05/2026 o 2026-05-12 */
    var f = tf.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
         || tf.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (f) {
      var k2;
      if (f[1].length === 4) k2 = f[1] + '-' + pad(f[2]) + '-' + pad(f[3]);
      else { var y = f[3].length === 2 ? '20' + f[3] : f[3]; k2 = y + '-' + pad(f[2]) + '-' + pad(f[1]); }
      return { periodo: 'custom', desde: k2, hasta: k2, etiqueta: 'el ' + k2 };
    }
    /* periodos del diccionario */
    for (var p = 0; p < PERIODOS.length; p++) {
      if (hallados['@' + PERIODOS[p].id] !== undefined) {
        return { periodo: PERIODOS[p].id, etiqueta: etiquetaPeriodo(PERIODOS[p].id) };
      }
    }
    return null;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function claveDia(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function etiquetaPeriodo(id) {
    return ({ today: 'hoy', yesterday: 'ayer', week: 'esta semana', lastweek: 'la semana pasada',
      month: 'este mes', lastmonth: 'el mes pasado', year: 'este año', all: 'en total' })[id] || id;
  }

  /** El corazón: convierte texto libre en { intencion, periodo, … }. */
  function interpretar(texto) {
    var hallados = detectar(texto);
    var t = normalizar(texto);
    var per = sacarPeriodo(texto, hallados);
    var tiene = function (c) { return hallados[c] !== undefined; };

    var intencion = null, metodo = null, confianza = 0, porMarcadores = false;

    /* --- Antes que nada: ¿me están pidiendo HACER algo, o un "cómo se
       hace"? El asistente solo consulta; si no se atajan aquí, frases como
       "borra todas mis ventas" se confundirían con una pregunta de ventas. */
    if (tiene('como_hacer')) return listoComo('como_hacer', texto);
    if (tiene('accion')) return listoComo('accion', texto);

    /* --- Reglas por combinación (no importa el orden de las palabras) ---
       Así se entiende igual "¿qué producto vendo más?" que "¿cuál es el
       producto que más vendo?" o "el que más sale". */
    var esPregunta = tiene('m_que');
    porMarcadores = true;
    if (tiene('m_valor') && (tiene('inventario') || tiene('m_producto'))) intencion = 'valor_inventario';
    else if (tiene('m_producto') && tiene('m_mas')) intencion = 'producto_top';
    else if (tiene('m_producto') && tiene('m_menos')) intencion = 'producto_bajo';
    else if (tiene('m_categoria') && (tiene('m_mas') || tiene('m_mejor'))) intencion = 'categoria_top';
    else if (tiene('m_dia') && (tiene('m_mejor') || (esPregunta && tiene('m_mas')))) intencion = 'mejor_dia';
    else if (tiene('m_dia') && tiene('m_menos')) intencion = 'peor_dia';
    else if (tiene('m_hora') && (tiene('m_mas') || tiene('m_mejor'))) intencion = 'mejor_hora';
    else if (tiene('m_quien') && (tiene('m_mas') || tiene('m_mejor'))) intencion = 'por_usuario';
    /* "¿qué se vende más?" / "¿qué sale más?" — sin la palabra "producto" */
    else if (esPregunta && tiene('ventas') && tiene('m_mas') && !tiene('m_cuanto')) intencion = 'producto_top';
    else if (esPregunta && tiene('ventas') && tiene('m_menos') && !tiene('m_cuanto')) intencion = 'producto_bajo';

    /* ¿la intención salió solo de los marcadores? (afecta la confianza) */
    porMarcadores = !!intencion;

    /* --- cosas que no son datos --- */
    if (intencion) { /* ya resuelto arriba */ }
    else if (tiene('ayuda')) intencion = 'ayuda';
    else if (tiene('identidad')) intencion = 'identidad';
    else if (tiene('charla')) intencion = 'charla';
    else if (tiene('despedida')) intencion = 'despedida';
    else if (tiene('gracias')) intencion = 'gracias';
    /* "hola" solo saluda si va AL PRINCIPIO ("traduce hola al inglés" no es un saludo) */
    else if (hallados.saludo === 0 && conceptosReales(hallados).length <= 1 && t.split(' ').length <= 4) intencion = 'saludo';

    /* --- inventario --- */
    else if (tiene('valor_inv')) intencion = 'valor_inventario';
    else if (tiene('agotados')) intencion = 'agotados';
    else if (tiene('bajo_stock')) intencion = 'bajo_stock';

    /* --- dimensiones (van antes que la métrica simple) --- */
    else if (tiene('producto_top')) intencion = 'producto_top';
    else if (tiene('producto_bajo')) intencion = 'producto_bajo';
    else if (tiene('categoria_top')) intencion = 'categoria_top';
    else if (tiene('mejor_dia')) intencion = 'mejor_dia';
    else if (tiene('peor_dia')) intencion = 'peor_dia';
    else if (tiene('mejor_hora')) intencion = 'mejor_hora';
    else if (tiene('por_usuario')) intencion = 'por_usuario';

    /* --- dinero --- */
    else if (tiene('ticket')) intencion = 'ticket';
    else if (tiene('caja')) intencion = 'caja';
    else if (tiene('neta')) intencion = 'ganancia_neta';
    else if (tiene('fiado') && !tiene('ventas')) intencion = 'fiado';
    else if (tiene('abonos')) intencion = 'abonos';
    else if (tiene('propinas')) intencion = 'propinas';
    else if (tiene('descuentos')) intencion = 'descuentos';
    else if (tiene('devoluciones')) intencion = 'devoluciones';
    else if (tiene('iva')) intencion = 'iva';
    else if (tiene('costo') && !tiene('ganancia')) intencion = 'costo';
    else if (tiene('gastos') && !tiene('ganancia') && !tiene('ventas')) intencion = 'gastos';
    else if (tiene('ganancia')) intencion = (tiene('neta') || tiene('gastos')) ? 'ganancia_neta' : 'ganancia';
    else if (tiene('pedidos')) intencion = 'pedidos';
    else if (tiene('resumen')) intencion = 'resumen';
    else if (tiene('ventas')) {
      /* ¿con filtro de método de pago? */
      if (tiene('efectivo')) { intencion = 'ventas_metodo'; metodo = 'efectivo'; }
      else if (tiene('tarjeta')) { intencion = 'ventas_metodo'; metodo = 'tarjeta'; }
      else if (tiene('transferencia')) { intencion = 'ventas_metodo'; metodo = 'transferencia'; }
      else if (tiene('fiado')) { intencion = 'ventas_metodo'; metodo = 'credito'; }
      else intencion = 'ventas';
    }
    /* "¿cuánto en efectivo?" sin decir "vendí" */
    else if (tiene('efectivo')) { intencion = 'ventas_metodo'; metodo = 'efectivo'; }
    else if (tiene('tarjeta')) { intencion = 'ventas_metodo'; metodo = 'tarjeta'; }
    else if (tiene('transferencia')) { intencion = 'ventas_metodo'; metodo = 'transferencia'; }
    else if (tiene('clientes')) intencion = 'clientes';
    else if (tiene('inventario')) intencion = 'stock_producto';
    /* "¿cuántas tortas tengo?" · "¿cuánta coca me queda?" */
    else if (tiene('m_tengo') && (tiene('m_cuanto') || tiene('m_que'))) { intencion = 'stock_producto'; porMarcadores = true; }

    if (!intencion) return null;

    /* Confianza: cuántas señales REALES encontró (los marcadores no cuentan).
       Si no encontró ninguna y solo adivinó por marcadores, se queda baja a
       propósito para que la pregunta siga su camino y, si hace falta, la
       interprete Gemini. */
    var señales = conceptosReales(hallados).length;
    confianza = señales >= 1 ? (per ? 0.95 : 0.8) : (porMarcadores ? 0.72 : 0.3);
    if (intencion === 'saludo' || intencion === 'ayuda') confianza = 1;

    /* comparación con el periodo anterior */
    var comparar = tiene('comparar');

    return {
      intencion: intencion,
      periodo: per ? per.periodo : periodoPorDefecto(intencion),
      desde: per ? per.desde : '',
      hasta: per ? per.hasta : '',
      etiqueta: per ? per.etiqueta : etiquetaPeriodo(periodoPorDefecto(intencion)),
      metodo: metodo,
      comparar: comparar,
      texto: texto,
      confianza: confianza,
      fuente: 'reglas'
    };
  }

  /** Intención fija, sin periodo ni cálculos (para acciones y "cómo se hace"). */
  function listoComo(intencion, texto) {
    return { intencion: intencion, periodo: 'today', desde: '', hasta: '', etiqueta: 'hoy',
             metodo: null, comparar: false, texto: texto, confianza: 1, fuente: 'reglas' };
  }

  /** Conceptos "de verdad" (sin periodos @ ni marcadores m_). */
  function conceptosReales(hallados) {
    return Object.keys(hallados).filter(function (k) { return k[0] !== '@' && k.slice(0, 2) !== 'm_'; });
  }

  function periodoPorDefecto(intencion) {
    if (['mejor_dia', 'peor_dia', 'mejor_hora', 'categoria_top'].indexOf(intencion) >= 0) return 'month';
    if (['producto_top', 'producto_bajo'].indexOf(intencion) >= 0) return 'month';
    return 'today';
  }

  /* =======================================================================
     4.  RESPONDER CON LOS CÁLCULOS QUE YA TIENE VENDO PLUS
  ======================================================================= */

  /** Usa reportData() de Vendo Plus sin alterar lo que el usuario tenga abierto. */
  function datosDe(periodo, desde, hasta) {
    var rs = VP.reportState, rd = VP.reportData;
    if (!rs || typeof rd !== 'function') return null;
    var antes = { period: rs.period, from: rs.from, to: rs.to };
    try {
      if (periodo === 'all') {
        rs.period = 'custom'; rs.from = '2000-01-01'; rs.to = claveDia(new Date());
      } else {
        rs.period = periodo; rs.from = desde || ''; rs.to = hasta || '';
      }
      return rd();
    } catch (e) { return null; }
    finally { rs.period = antes.period; rs.from = antes.from; rs.to = antes.to; }
  }

  /** El periodo inmediatamente anterior, del mismo tamaño (para comparar). */
  function periodoAnterior(periodo, desde, hasta) {
    var map = { today: 'yesterday', week: 'lastweek', month: 'lastmonth' };
    if (map[periodo]) return { periodo: map[periodo], desde: '', hasta: '', etiqueta: etiquetaPeriodo(map[periodo]) };
    if (periodo === 'custom' && desde && hasta) {
      var a = new Date(desde + 'T00:00:00'), b = new Date(hasta + 'T00:00:00');
      var dias = Math.round((b - a) / 86400000) + 1;
      var b2 = new Date(a); b2.setDate(b2.getDate() - 1);
      var a2 = new Date(b2); a2.setDate(a2.getDate() - (dias - 1));
      return { periodo: 'custom', desde: claveDia(a2), hasta: claveDia(b2), etiqueta: 'el periodo anterior' };
    }
    return null;
  }

  function flecha(actual, previo) {
    if (previo === 0) return actual > 0 ? ' (antes no habías vendido nada)' : '';
    var pct = Math.round(((actual - previo) / Math.abs(previo)) * 100);
    if (pct === 0) return ' (igual que antes)';
    return ' (' + (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '% vs ' + dinero(previo) + ')';
  }

  var RESOLVERS = {
    saludo: function () {
      var u = typeof VP.currentUser === 'function' ? VP.currentUser() : null;
      var nombre = (u && (u.name || (u.business && u.business.name))) || '';
      var h = new Date().getHours();
      var saludo = h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches');
      return {
        texto: saludo + (nombre ? ', ' + String(nombre).split(' ')[0] : '') + '. ¿Qué quieres saber de tu negocio?',
        chips: ['¿Cuánto vendí hoy?', '¿Cuál fue mi ganancia?', '¿Qué está por agotarse?']
      };
    },

    /* Un poco de trato, sin volverse un chat de cotorreo: contesta corto y
       regresa al negocio. Nada de esto gasta un solo token. */
    charla: function () {
      var frases = [
        'Bien, con tus números a la mano. ¿Qué quieres saber?',
        'Aquí ando. ¿Reviso cómo va el día?',
        'Todo en orden. Pregúntame lo que quieras de tu negocio.'
      ];
      return { texto: frases[Math.floor(Math.random() * frases.length)], chips: chipsSegunHora() };
    },

    identidad: function () {
      return {
        /* Nota para quien edite esto: es un asistente automático y no lo
           niega si se lo preguntan, pero no anda contando con qué está
           hecho por dentro. Eso no le sirve de nada al dueño de la tienda. */
        texto: 'Soy el asistente de Vendo Plus, un ayudante automático de la app. Leo los datos de tu negocio y te los contesto en español.\n\n' +
               'Las cuentas las saco de tus propias ventas, las mismas que ves en la pantalla de Ventas. No invento números.',
        chips: ['¿Qué puedes hacer?', '¿Cuánto vendí hoy?']
      };
    },

    gracias: function () {
      var frases = ['Para eso estoy.', 'Cuando quieras.', 'Va. ¿Algo más?'];
      return { texto: frases[Math.floor(Math.random() * frases.length)], chips: chipsSegunHora() };
    },

    despedida: function () {
      var h = new Date().getHours();
      return { texto: h >= 20 || h < 5 ? 'Va, descansa. Aquí sigo mañana.' : 'Va, aquí sigo cuando me necesites.' };
    },

    ayuda: function () {
      return {
        texto: 'Te puedo contestar con tus datos reales. Por ejemplo:\n' +
          '• ¿Cuánto vendí hoy / ayer / esta semana?\n' +
          '• ¿Cuál fue mi ganancia neta del mes?\n' +
          '• ¿Cuántos pedidos tuve?\n' +
          '• ¿Qué producto vendo más?\n' +
          '• ¿Cuánto vendí en efectivo?\n' +
          '• ¿Qué productos están por agotarse?\n' +
          '• ¿Cuál fue mi mejor día del mes?\n' +
          '• ¿Cuánto me deben?\n\n' +
          'Escríbelo como quieras, aunque sea con faltas de ortografía.',
        chips: ['¿Cuánto vendí hoy?', '¿Qué vendo más?', '¿Cuánto me deben?']
      };
    },

    /* El asistente no toca tus datos. Lo dice claro en vez de contestar
       otra cosa parecida (que sería peor: parecería que sí lo hizo). */
    accion: function () {
      return {
        texto: 'Yo solo te informo: no puedo borrar, agregar ni cambiar nada de tu negocio. Eso lo haces tú desde la pantalla que corresponda, así nadie cambia tus datos por error.\n\nLo que sí puedo es contestarte cómo vas.',
        chips: ['¿Cuánto vendí hoy?', '¿Qué está por agotarse?']
      };
    },

    /* "¿Cómo hago una factura?" no es una pregunta de datos: si la
       contestara con números, estaría respondiendo otra cosa. */
    como_hacer: function () {
      return {
        texto: 'Esa es una pregunta de cómo usar Vendo Plus, y de eso todavía no sé. Yo te contesto sobre tus números: ventas, ganancias, inventario y clientes.',
        chips: ['¿Cuánto vendí hoy?', '¿Cuál fue mi ganancia?', '¿Qué está por agotarse?']
      };
    },

    ventas: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var txt = 'Vendiste ' + dinero(d.net) + ' ' + q.etiqueta + '.';
      if (q.comparar) {
        var ant = periodoAnterior(q.periodo, q.desde, q.hasta);
        if (ant) { var d2 = datosDe(ant.periodo, ant.desde, ant.hasta); if (d2) txt = txt.slice(0, -1) + flecha(d.net, d2.net) + '.'; }
      }
      var extra = [];
      if (d.orders.length) extra.push(d.orders.length + (d.orders.length === 1 ? ' venta' : ' ventas'));
      if (d.returnsTotal > 0) extra.push('−' + dinero(d.returnsTotal) + ' en devoluciones');
      if (extra.length) txt += '\n' + extra.join(' · ');
      return { texto: txt, detalle: detalleVentas(d), chips: ['¿Y mi ganancia?', '¿Qué vendí más?'] };
    },

    ventas_metodo: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var nom = { efectivo: 'efectivo', tarjeta: 'tarjeta', transferencia: 'transferencia', credito: 'fiado' }[q.metodo] || q.metodo;
      var v = Number(d.byMethod[q.metodo] || 0);
      var total = Object.keys(d.byMethod).reduce(function (a, k) { return a + Number(d.byMethod[k] || 0); }, 0);
      var pct = total > 0 ? Math.round((v / total) * 100) : 0;
      return {
        texto: 'En ' + nom + ' cobraste ' + dinero(v) + ' ' + q.etiqueta +
          (total > 0 ? '.\nEs el ' + pct + '% de todo lo que cobraste.' : '.'),
        detalle: Object.keys(d.byMethod).filter(function (k) { return d.byMethod[k] > 0; })
          .map(function (k) { return [nombreMetodo(k), dinero(d.byMethod[k])]; })
      };
    },

    ganancia: function (q) {
      if (!puede('verGanancias')) return { texto: 'No tienes permiso para ver las ganancias. Pídeselo al dueño.' };
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var txt = 'Tu ganancia ' + q.etiqueta + ' fue de ' + dinero(d.prof.profit) + '.';
      if (q.comparar) {
        var ant = periodoAnterior(q.periodo, q.desde, q.hasta);
        if (ant) { var d2 = datosDe(ant.periodo, ant.desde, ant.hasta); if (d2) txt = txt.slice(0, -1) + flecha(d.prof.profit, d2.prof.profit) + '.'; }
      }
      txt += '\nEs la venta (' + dinero(d.net) + ') menos el costo de lo que vendiste (' + dinero(d.prof.cost) + ').';
      if (d.prof.missing > 0) txt += '\n⚠️ ' + num(d.prof.missing) + ' producto(s) no tienen costo capturado, así que no cuentan.';
      if (d.gastos > 0) txt += '\nSi le quitas ' + dinero(d.gastos) + ' de gastos, tu ganancia neta es ' + dinero(d.prof.profit - d.gastos) + '.';
      return { texto: txt, chips: ['¿Y mi ganancia neta?', '¿Cuánto gasté?'] };
    },

    ganancia_neta: function (q) {
      if (!puede('verGanancias')) return { texto: 'No tienes permiso para ver las ganancias. Pídeselo al dueño.' };
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var neta = (VP.round2 || Math.round)(d.prof.profit - d.gastos);
      var txt = 'Tu ganancia neta ' + q.etiqueta + ' fue de ' + dinero(neta) + '.';
      return {
        texto: txt,
        detalle: [
          ['Vendiste', dinero(d.net)],
          ['Costo de lo vendido', '−' + dinero(d.prof.cost)],
          ['Ganancia bruta', dinero(d.prof.profit)],
          ['Gastos', '−' + dinero(d.gastos)],
          ['Ganancia neta', dinero(neta)]
        ]
      };
    },

    pedidos: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var n = d.orders.length;
      var prom = n > 0 ? d.net / n : 0;
      return {
        texto: 'Tuviste ' + n + (n === 1 ? ' venta' : ' ventas') + ' ' + q.etiqueta + '.' +
          (n > 0 ? '\nEn promedio, cada una de ' + dinero(prom) + '.' : '') +
          (d.cancelled ? '\n' + d.cancelled + ' cancelada(s).' : '')
      };
    },

    ticket: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var n = d.orders.length;
      if (!n) return { texto: 'No hubo ventas ' + q.etiqueta + ', así que todavía no hay ticket promedio.' };
      return { texto: 'Tu ticket promedio ' + q.etiqueta + ' es de ' + dinero(d.net / n) + '.\n(' + dinero(d.net) + ' entre ' + n + ' ventas.)' };
    },

    gastos: function (q) {
      if (!puede('verGanancias') && !(VP.isOwner && VP.isOwner())) return { texto: 'No tienes permiso para ver los gastos.' };
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      if (!d.gastos) return { texto: 'No registraste gastos ' + q.etiqueta + '.' };
      var porCat = {};
      d.exps.forEach(function (e) {
        var c = e.category || 'otros';
        porCat[c] = (porCat[c] || 0) + Number(e.amount || 0);
      });
      return {
        texto: 'Gastaste ' + dinero(d.gastos) + ' ' + q.etiqueta + ', en ' + d.exps.length + ' movimiento(s).',
        detalle: Object.keys(porCat).sort(function (a, b) { return porCat[b] - porCat[a]; }).slice(0, 6)
          .map(function (c) { return [c, dinero(porCat[c])]; })
      };
    },

    costo: function (q) {
      if (!puede('verGanancias')) return { texto: 'No tienes permiso para ver los costos.' };
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      return { texto: 'Lo que vendiste ' + q.etiqueta + ' te costó ' + dinero(d.prof.cost) + '.\nVendiste ' + dinero(d.net) + ', así que te quedaron ' + dinero(d.prof.profit) + '.' };
    },

    propinas: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      return { texto: d.tips > 0 ? 'Juntaste ' + dinero(d.tips) + ' de propinas ' + q.etiqueta + '.' : 'No hubo propinas ' + q.etiqueta + '.' };
    },

    descuentos: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      return { texto: d.discounts > 0 ? 'Diste ' + dinero(d.discounts) + ' en descuentos ' + q.etiqueta + '.' : 'No diste descuentos ' + q.etiqueta + '.' };
    },

    devoluciones: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var n = d.returns.length;
      return { texto: n ? 'Tuviste ' + n + ' devolución(es) por ' + dinero(d.returnsTotal) + ' ' + q.etiqueta + '.' + (d.cancelled ? '\nAdemás ' + d.cancelled + ' venta(s) cancelada(s).' : '') : 'No hubo devoluciones ' + q.etiqueta + '.' };
    },

    iva: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      return { texto: 'El IVA de tus ventas ' + q.etiqueta + ' suma ' + dinero(d.iva) + '.' + (d.ivaAdded ? '\nAgregado al precio: ' + dinero(d.ivaAdded) : '') + (d.ivaIncl ? '\nYa incluido en el precio: ' + dinero(d.ivaIncl) : '') };
    },

    abonos: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var tot = d.abonos.reduce(function (a, p) { return a + Number(p.amount || 0); }, 0);
      return { texto: tot > 0 ? 'Te abonaron ' + dinero(tot) + ' ' + q.etiqueta + ', en ' + d.abonos.length + ' pago(s).' : 'No te abonaron nada ' + q.etiqueta + '.' };
    },

    fiado: function () {
      var f = VP.receivable, b = VP.custBalances;
      if (typeof f !== 'function' || typeof b !== 'function') return null;
      var total = f(), saldos = b(), DBx = VP.DB;
      var clientes = (DBx.getCustomers() || []).map(function (c) { return { n: c.name, s: saldos[c.id] || 0 }; })
        .filter(function (x) { return x.s > 0; }).sort(function (a, b2) { return b2.s - a.s; });
      if (!total) return { texto: 'Nadie te debe nada. Vas al corriente.' };
      return {
        texto: 'Te deben ' + dinero(total) + ' en total, entre ' + clientes.length + ' cliente(s).',
        detalle: clientes.slice(0, 8).map(function (x) { return [x.n, dinero(x.s)]; })
      };
    },

    caja: function () {
      var f = VP.cashCurrent;
      if (typeof f !== 'function') return null;
      var c = f();
      if (!c) return { texto: 'Ahorita no tienes una caja abierta.' };
      var d = datosDe('today', '', '');
      var efectivo = d ? Number(d.byMethod.efectivo || 0) : 0;
      var ini = Number(c.opening || c.initial || 0);
      return {
        texto: 'Tu caja está abierta desde ' + fechaCorta(c.openedAt || c.at) + '.',
        detalle: [['Fondo inicial', dinero(ini)], ['Efectivo cobrado hoy', dinero(efectivo)], ['Debería haber', dinero(ini + efectivo)]]
      };
    },

    producto_top: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var lista = Object.keys(d.byProd).map(function (k) { return d.byProd[k]; })
        .sort(function (a, b) { return b.qty - a.qty; });
      if (!lista.length) return { texto: 'No vendiste nada ' + q.etiqueta + '.' };
      var top = lista[0];
      return {
        texto: 'Tu producto más vendido ' + q.etiqueta + ' es ' + top.name + ': ' + num(top.qty) + ' vendidos, ' + dinero(top.total) + '.',
        detalle: lista.slice(0, 6).map(function (p) { return [p.name, num(p.qty) + ' · ' + dinero(p.total)]; })
      };
    },

    producto_bajo: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var lista = Object.keys(d.byProd).map(function (k) { return d.byProd[k]; })
        .sort(function (a, b) { return a.qty - b.qty; });
      if (!lista.length) return { texto: 'No vendiste nada ' + q.etiqueta + '.' };
      /* productos activos que no vendieron NADA en el periodo */
      var vendidos = {};
      Object.keys(d.byProd).forEach(function (k) { vendidos[d.byProd[k].name] = 1; });
      var sinVender = (VP.DB.getProducts() || []).filter(function (p) { return p.active && !vendidos[p.name]; });
      var txt = 'Lo que menos vendiste ' + q.etiqueta + ' es ' + lista[0].name + ' (' + num(lista[0].qty) + ').';
      if (sinVender.length) txt += '\nY ' + sinVender.length + ' producto(s) no se vendieron ni una vez.';
      return {
        texto: txt,
        detalle: lista.slice(0, 5).map(function (p) { return [p.name, num(p.qty) + ' · ' + dinero(p.total)]; })
          .concat(sinVender.slice(0, 5).map(function (p) { return [p.name, '0 vendidos']; }))
      };
    },

    categoria_top: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var lista = Object.keys(d.byCat).map(function (k) { return d.byCat[k]; }).sort(function (a, b) { return b.total - a.total; });
      if (!lista.length) return { texto: 'No vendiste nada ' + q.etiqueta + '.' };
      return {
        texto: 'Tu categoría más fuerte ' + q.etiqueta + ' es ' + lista[0].name + ', con ' + dinero(lista[0].total) + '.',
        detalle: lista.slice(0, 6).map(function (c) { return [c.name, dinero(c.total)]; })
      };
    },

    mejor_dia: function (q) { return diaExtremo(q, true); },
    peor_dia: function (q) { return diaExtremo(q, false); },

    mejor_hora: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var max = -1, hora = -1;
      d.byHour.forEach(function (v, i) { if (v > max) { max = v; hora = i; } });
      if (hora < 0 || max <= 0) return { texto: 'Todavía no hay ventas suficientes ' + q.etiqueta + ' para decirte tu mejor hora.' };
      var top = d.byHour.map(function (v, i) { return [i, v]; }).filter(function (x) { return x[1] > 0; })
        .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
      return {
        texto: 'Tu mejor hora ' + q.etiqueta + ' es entre las ' + hora + ':00 y las ' + (hora + 1) + ':00, con ' + dinero(max) + '.',
        detalle: top.map(function (x) { return [x[0] + ':00 – ' + (x[0] + 1) + ':00', dinero(x[1])]; })
      };
    },

    por_usuario: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var lista = Object.keys(d.byUser).map(function (k) { return { n: k, t: d.byUser[k].total, c: d.byUser[k].count }; })
        .sort(function (a, b) { return b.t - a.t; });
      if (lista.length <= 1) return { texto: 'Todas las ventas ' + q.etiqueta + ' las hiciste tú.' };
      return {
        texto: 'Quien más vendió ' + q.etiqueta + ' fue ' + lista[0].n + ', con ' + dinero(lista[0].t) + ' en ' + lista[0].c + ' ventas.',
        detalle: lista.map(function (u) { return [u.n, dinero(u.t) + ' · ' + u.c]; })
      };
    },

    bajo_stock: function () {
      var f = VP.lowStock; if (typeof f !== 'function') return null;
      var bajos = f();
      if (!bajos.length) return { texto: 'Todo tu inventario está bien. Nada está por agotarse.' };
      var agotados = bajos.filter(function (p) { return VP.stockInfo(p).level === 'out'; });
      var pocos = bajos.filter(function (p) { return VP.stockInfo(p).level === 'low'; });
      var txt = '';
      if (agotados.length) txt += agotados.length + ' producto(s) ya se agotaron.';
      if (pocos.length) txt += (txt ? '\n' : '') + pocos.length + ' producto(s) están por acabarse.';
      return {
        texto: txt,
        detalle: bajos.slice(0, 12).map(function (p) {
          var st = VP.stockInfo(p);
          return [p.name, st.level === 'out' ? 'Agotado' : 'Quedan ' + (VP.fmtStock ? VP.fmtStock(p, st.stock) : st.stock)];
        })
      };
    },

    agotados: function () {
      var prods = (VP.DB.getProducts() || []).filter(function (p) {
        if (!p.active) return false; var st = VP.stockInfo(p); return st.control && st.level === 'out';
      });
      if (!prods.length) return { texto: 'No tienes nada agotado ahorita.' };
      return {
        texto: 'Tienes ' + prods.length + ' producto(s) agotados.',
        detalle: prods.slice(0, 15).map(function (p) { return [p.name, 'En 0']; })
      };
    },

    valor_inventario: function () {
      if (!puede('verGanancias')) return { texto: 'No tienes permiso para ver los costos del inventario.' };
      var prods = (VP.DB.getProducts() || []).filter(function (p) { return p.active; });
      var costo = 0, venta = 0, sinCosto = 0, piezas = 0;
      prods.forEach(function (p) {
        var st = VP.stockInfo(p);
        if (!st.control || st.stock <= 0) return;
        piezas += st.stock;
        venta += st.stock * Number(p.price || 0);
        if (p.cost == null) sinCosto++; else costo += st.stock * Number(p.cost);
      });
      return {
        texto: 'Tienes ' + num(piezas) + ' pieza(s) en inventario.',
        detalle: [['Te costaron', dinero(costo)], ['Valen al precio de venta', dinero(venta)], ['Ganancia si lo vendes todo', dinero(venta - costo)]]
          .concat(sinCosto ? [['Sin costo capturado', sinCosto + ' producto(s)']] : [])
      };
    },

    clientes: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta);
      var total = (VP.DB.getCustomers() || []).length;
      var conNombre = d ? d.orders.filter(function (s) { return s.customerId; }).length : 0;
      return { texto: 'Tienes ' + total + ' cliente(s) registrados.' + (d ? '\n' + q.etiqueta.charAt(0).toUpperCase() + q.etiqueta.slice(1) + ' atendiste ' + d.orders.length + ' venta(s), ' + conNombre + ' a nombre de un cliente.' : '') };
    },

    stock_producto: function (q) {
      /* "¿cuánto tengo de coca?" → busca el producto por nombre */
      var t = normalizar(q.texto);
      var prods = VP.DB.getProducts() || [];
      var mejor = null, mejorP = 0;
      prods.forEach(function (p) {
        var n = normalizar(p.name);
        if (!n) return;
        var p2 = t.indexOf(n) >= 0 ? n.length : 0;
        if (!p2) { n.split(' ').forEach(function (w) { if (w.length > 3 && t.indexOf(w) >= 0) p2 = Math.max(p2, w.length); }); }
        if (p2 > mejorP) { mejorP = p2; mejor = p; }
      });
      if (!mejor) return null;
      var st = VP.stockInfo(mejor);
      if (!st.control) return { texto: mejor.name + ' no lleva control de existencias.' };
      return { texto: 'De ' + mejor.name + ' tienes ' + (VP.fmtStock ? VP.fmtStock(mejor, st.stock) : st.stock) + '.' + (st.level === 'out' ? ' Está agotado.' : (st.level === 'low' ? ' Ya queda poco.' : '')) };
    },

    resumen: function (q) {
      var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
      var det = [['Ventas', dinero(d.net)], ['Número de ventas', String(d.orders.length)]];
      if (d.orders.length) det.push(['Ticket promedio', dinero(d.net / d.orders.length)]);
      if (puede('verGanancias')) {
        det.push(['Ganancia', dinero(d.prof.profit)]);
        if (d.gastos) { det.push(['Gastos', '−' + dinero(d.gastos)]); det.push(['Ganancia neta', dinero(d.prof.profit - d.gastos)]); }
      }
      var lista = Object.keys(d.byProd).map(function (k) { return d.byProd[k]; }).sort(function (a, b) { return b.qty - a.qty; });
      if (lista.length) det.push(['Lo que más vendiste', lista[0].name]);
      var bajos = typeof VP.lowStock === 'function' ? VP.lowStock() : [];
      if (bajos.length) det.push(['Por agotarse', bajos.length + ' producto(s)']);
      return { texto: 'Así vas ' + q.etiqueta + ':', detalle: det, chips: ['¿Qué está por agotarse?', '¿Cuánto me deben?'] };
    }
  };

  /** Sugerencias distintas según la hora: en la mañana interesa el día que
      empieza; en la noche, el corte. Es gratis y hace que se sienta vivo. */
  function chipsSegunHora() {
    var h = new Date().getHours();
    if (h < 12) return ['¿Cómo voy hoy?', '¿Qué está por agotarse?', '¿Cuánto vendí ayer?'];
    if (h < 19) return ['¿Cuánto vendí hoy?', '¿Qué vendo más?', '¿Cuánto me deben?'];
    return ['¿Cómo me fue hoy?', '¿Cuál fue mi ganancia?', '¿Cuánto vendí en efectivo?'];
  }

  function diaExtremo(q, mejor) {
    var d = datosDe(q.periodo, q.desde, q.hasta); if (!d) return null;
    var dias = Object.keys(d.byDay).map(function (k) { return [k, d.byDay[k]]; }).filter(function (x) { return x[1] > 0; });
    if (!dias.length) return { texto: 'No hay ventas ' + q.etiqueta + ' para comparar días.' };
    dias.sort(function (a, b) { return mejor ? b[1] - a[1] : a[1] - b[1]; });
    var top = dias[0];
    return {
      texto: 'Tu ' + (mejor ? 'mejor' : 'día más flojo') + (mejor ? ' día' : '') + ' ' + q.etiqueta + ' fue el ' + fechaLarga(top[0]) + ', con ' + dinero(top[1]) + '.',
      detalle: dias.slice(0, 6).map(function (x) { return [fechaLarga(x[0]), dinero(x[1])]; })
    };
  }

  function detalleVentas(d) {
    var det = [];
    if (d.listTotal && d.listTotal !== d.net) det.push(['Precio de lista', dinero(d.listTotal)]);
    if (d.discounts) det.push(['Descuentos', '−' + dinero(d.discounts)]);
    if (d.returnsTotal) det.push(['Devoluciones', '−' + dinero(d.returnsTotal)]);
    det.push(['Total cobrado', dinero(d.net)]);
    Object.keys(d.byMethod).forEach(function (k) {
      if (d.byMethod[k] > 0) det.push(['  ' + nombreMetodo(k), dinero(d.byMethod[k])]);
    });
    if (d.tips) det.push(['Propinas', dinero(d.tips)]);
    return det;
  }

  function nombreMetodo(id) {
    return ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Fiado' })[id] || id;
  }
  function fechaLarga(k) {
    try { var p = k.split('-'); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }); }
    catch (e) { return k; }
  }
  function fechaCorta(iso) {
    try { return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  /* =======================================================================
     5.  MEMORIA Y MÉTRICAS  (todo local, no gasta red ni se sincroniza)
     Se usan claves "vp_" (no "mesa_") a propósito: Vendo Plus solo sube a
     la nube las claves que empiezan con "mesa_".
  ======================================================================= */
  var K_MEM = 'vp_ia_memoria';      /* frases que Gemini ya tradujo */
  var K_MET = 'vp_ia_metricas';     /* contadores de uso y costo */
  var K_PEN = 'vp_ia_pendiente';    /* métricas aún no enviadas al panel global */

  function leer(k, def) { try { return JSON.parse(localStorage.getItem(k) || 'null') || def; } catch (e) { return def; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function memoria() { return leer(K_MEM, {}); }
  function recordar(textoNorm, intent) {
    var m = memoria();
    var claves = Object.keys(m);
    if (claves.length > 400) { delete m[claves[0]]; }   /* no crecer sin fin */
    m[textoNorm] = { i: intent, t: Date.now() };
    guardar(K_MEM, m);
  }

  function metricas() {
    return leer(K_MET, { sinIA: 0, conIA: 0, cacheIA: 0, noEntendidas: 0, tokensIn: 0, tokensOut: 0, desde: new Date().toISOString() });
  }
  function anotar(campo, cuanto) {
    var m = metricas();
    m[campo] = (m[campo] || 0) + (cuanto || 1);
    guardar(K_MET, m);
    var p = leer(K_PEN, {});
    p[campo] = (p[campo] || 0) + (cuanto || 1);
    guardar(K_PEN, p);
  }

  /* Precio público de Gemini 2.5 Flash-Lite (USD por millón de tokens).
     Si Google lo cambia, nada más corrige estos dos números. */
  var PRECIO = { entrada: 0.10, salida: 0.40 };

  function costoEstimado() {
    var m = metricas();
    var usd = (m.tokensIn / 1e6) * PRECIO.entrada + (m.tokensOut / 1e6) * PRECIO.salida;
    var total = m.sinIA + m.conIA + m.cacheIA;
    return {
      total: total,
      sinIA: m.sinIA + m.cacheIA,
      conIA: m.conIA,
      pctGratis: total ? Math.round(((m.sinIA + m.cacheIA) / total) * 100) : 100,
      tokensIn: m.tokensIn, tokensOut: m.tokensOut,
      usd: usd,
      mxn: usd * 18,              /* aproximado, solo para que se lea fácil */
      desde: m.desde
    };
  }

  /* Manda los contadores locales al panel global, como mucho una vez al día. */
  var K_ULT_ENVIO = 'vp_ia_ultimo_envio';
  function empujarMetricas() {
    try {
      var ult = Number(localStorage.getItem(K_ULT_ENVIO) || 0);
      if (Date.now() - ult < 6 * 3600 * 1000) return;
      var p = leer(K_PEN, {});
      if (!p.sinIA && !p.conIA && !p.cacheIA && !p.noEntendidas) return;
      var cl = VP.Cloud;
      if (!cl || !cl.ready || !cl.uid || !cl.sb) return;
      cl.sb.rpc('vp_ia_registrar_local', {
        p_sin_ia: p.sinIA || 0, p_cache: p.cacheIA || 0,
        p_con_ia: p.conIA || 0, p_no_entendidas: p.noEntendidas || 0
      }).then(function () {
        guardar(K_PEN, {});
        localStorage.setItem(K_ULT_ENVIO, String(Date.now()));
      }).catch(function () {});
    } catch (e) {}
  }

  /* =======================================================================
     6.  ÚLTIMO RECURSO: GEMINI 2.5 FLASH-LITE
     Solo manda la frase. Nunca manda ventas, clientes, productos ni montos.
     Solo pide de vuelta: ¿qué intención y qué periodo era?
  ======================================================================= */
  var LIMITES = {
    porMinuto: 6,          /* frena ráfagas / usuarios pegando texto en bucle */
    porDia: 40,            /* tope duro por negocio, por día */
    maxLargo: 160,         /* frases más largas no se mandan */
    tiempoEspera: 9000
  };
  var ultimasLlamadas = [];

  function puedeLlamarIA() {
    var ahora = Date.now();
    ultimasLlamadas = ultimasLlamadas.filter(function (t) { return ahora - t < 60000; });
    if (ultimasLlamadas.length >= LIMITES.porMinuto) return { ok: false, motivo: 'ritmo' };
    var hoy = claveDia(new Date());
    var c = leer('vp_ia_dia', { d: hoy, n: 0 });
    if (c.d !== hoy) { c = { d: hoy, n: 0 }; guardar('vp_ia_dia', c); }
    if (c.n >= LIMITES.porDia) return { ok: false, motivo: 'tope' };
    return { ok: true };
  }
  /* Si el servidor dice "vas muy rápido", aquí se da por lleno el minuto
     para no volver a molestarlo hasta que pase. */
  function llenarRitmo() {
    var ahora = Date.now();
    ultimasLlamadas = [];
    for (var i = 0; i < LIMITES.porMinuto; i++) ultimasLlamadas.push(ahora);
  }

  function contarLlamada() {
    ultimasLlamadas.push(Date.now());
    var hoy = claveDia(new Date());
    var c = leer('vp_ia_dia', { d: hoy, n: 0 });
    if (c.d !== hoy) c = { d: hoy, n: 0 };
    c.n++; guardar('vp_ia_dia', c);
  }

  /**
   * ¿Vale la pena gastar en preguntarle a Gemini?
   * Hay frases que NO tienen nada que interpretar: un "ok", un "si", un
   * emoji, un número suelto, un toque sin querer. Mandar eso a la IA es
   * tirar el dinero, porque ni el mejor modelo del mundo puede sacar una
   * intención de donde no la hay.
   */
  function valeLaPena(texto) {
    var norm = normalizar(texto);
    if (!norm) return false;
    /* sin una sola letra (puros números, signos o emojis) */
    if (!/[a-z]/.test(norm)) return false;
    /* demasiado corto para querer decir algo */
    if (norm.replace(/\s/g, '').length < 4) return false;
    var palabras = norm.split(' ').filter(Boolean);
    /* una o dos palabras que no se parecen a NADA del negocio:
       "ok", "ya", "jajaja", "aaaa"… */
    if (palabras.length <= 2 && !Object.keys(detectar(texto)).length) return false;
    /* la misma palabra repetida ("hola hola hola") */
    if (palabras.length > 1 && new Set(palabras).size === 1) return false;
    return true;
  }

  function preguntarAGemini(texto) {
    return new Promise(function (resolve) {
      var cl = VP.Cloud, cfg = VP.CFG;
      if (!cl || !cl.ready || !cl.sb || !cfg || !cfg.SUPABASE_URL) return resolve(null);
      if (texto.length > LIMITES.maxLargo) return resolve(null);
      if (!valeLaPena(texto)) return resolve(null);
      var lim = puedeLlamarIA();
      if (!lim.ok) return resolve({ bloqueado: lim.motivo });

      var corte = setTimeout(function () { resolve(null); }, LIMITES.tiempoEspera);
      cl.sb.functions.invoke('vp-asistente', { body: { pregunta: texto } })
        .then(function (r) {
          clearTimeout(corte);
          var d = r && r.data;
          /* El servidor también frena, y él es el que manda: los topes de
             aquí arriba solo sirven para ahorrarnos el viaje. Si paró él,
             hay que respetar su motivo y no insistir. */
          if (d && !d.ok && d.error === 'limite') {
            if (d.motivo === 'ritmo') llenarRitmo();
            return resolve({ bloqueado: d.motivo || 'tope' });
          }
          if (!d || !d.ok) return resolve(null);
          contarLlamada();
          if (d.desdeCache) anotar('cacheIA');
          else {
            anotar('conIA');
            anotar('tokensIn', d.tokensIn || 0);
            anotar('tokensOut', d.tokensOut || 0);
          }
          resolve(d.intencion ? d : null);
        })
        .catch(function () { clearTimeout(corte); resolve(null); });
    });
  }

  /* Lo que Gemini devuelve es solo un plan; aquí se vuelve una consulta real. */
  function deGeminiAConsulta(d, texto) {
    if (!d || !d.intencion || !RESOLVERS[d.intencion]) return null;
    var per = d.periodo && ['today', 'yesterday', 'week', 'lastweek', 'month', 'lastmonth', 'year', 'all', 'custom'].indexOf(d.periodo) >= 0
      ? d.periodo : periodoPorDefecto(d.intencion);
    return {
      intencion: d.intencion,
      periodo: per,
      desde: /^\d{4}-\d{2}-\d{2}$/.test(d.desde || '') ? d.desde : '',
      hasta: /^\d{4}-\d{2}-\d{2}$/.test(d.hasta || '') ? d.hasta : '',
      etiqueta: per === 'custom' ? 'en ese periodo' : etiquetaPeriodo(per),
      metodo: ['efectivo', 'tarjeta', 'transferencia', 'credito'].indexOf(d.metodo) >= 0 ? d.metodo : null,
      comparar: !!d.comparar,
      texto: texto,
      confianza: 0.7,
      fuente: d.desdeCache ? 'cache-ia' : 'gemini'
    };
  }

  /* =======================================================================
     7.  PUERTA DE ENTRADA
  ======================================================================= */
  function ejecutar(q) {
    var fn = RESOLVERS[q.intencion];
    if (!fn) return null;
    try {
      var r = fn(q);
      if (!r) return null;
      r.fuente = q.fuente;
      r.intencion = q.intencion;
      return r;
    } catch (e) { console.error('VendoPlus asistente', e); return null; }
  }

  var NO_ENTENDI = {
    texto: 'Esa no la entendí todavía. Pregúntame cosas de tu negocio, por ejemplo:',
    chips: ['¿Cuánto vendí hoy?', '¿Cuál fue mi ganancia del mes?', '¿Qué está por agotarse?', '¿Cuánto vendí en efectivo?']
  };
  /* Para un "ok", un emoji o un toque sin querer: ahí no hubo nada que
     entender, así que decir "no te entendí" suena mal. Mejor preguntar. */
  var NADA_QUE_ENTENDER = {
    texto: '¿Qué quieres saber de tu negocio?',
    chips: null   /* se llenan con las sugerencias de la hora */
  };

  /**
   * Responde una pregunta.
   * Devuelve una promesa con { texto, detalle?, chips?, fuente }.
   *   fuente: 'reglas' | 'memoria' | 'cache-ia' | 'gemini' | 'ninguna'
   */
  function responder(texto) {
    texto = String(texto || '').trim();
    if (!texto) return Promise.resolve(NO_ENTENDI);
    if (!listo()) {
      return Promise.resolve({ texto: 'Dame un segundo, todavía estoy cargando tus datos.', fuente: 'ninguna' });
    }
    var norm = normalizar(texto);

    /* -- paso 1: reglas (gratis) -- */
    var q = interpretar(texto);
    if (q && q.confianza >= 0.7) {
      var r = ejecutar(q);
      if (r) { anotar('sinIA'); empujarMetricas(); return Promise.resolve(r); }
    }

    /* -- paso 2: memoria de frases ya aprendidas (gratis) -- */
    var mem = memoria()[norm];
    if (mem && mem.i) {
      var q2 = deGeminiAConsulta(mem.i, texto);
      if (q2) {
        q2.fuente = 'memoria';
        var r2 = ejecutar(q2);
        if (r2) { anotar('sinIA'); empujarMetricas(); return Promise.resolve(r2); }
      }
    }

    /* -- paso 3: reglas con poca confianza, mejor eso que nada -- */
    if (q && q.confianza >= 0.4) {
      var r3 = ejecutar(q);
      if (r3) { anotar('sinIA'); empujarMetricas(); return Promise.resolve(r3); }
    }

    /* -- paso 3.5: ¿hay siquiera algo que interpretar? --
       Un "ok", un emoji o un toque sin querer no se le mandan a nadie. */
    if (!valeLaPena(texto)) {
      anotar('sinIA'); empujarMetricas();
      return Promise.resolve({ texto: NADA_QUE_ENTENDER.texto, chips: chipsSegunHora(), fuente: 'reglas' });
    }

    /* -- paso 4: Gemini, solo para entender la intención -- */
    return preguntarAGemini(texto).then(function (d) {
      if (d && d.bloqueado) {
        anotar('noEntendidas'); empujarMetricas();
        /* El servidor manda por qué paró: 'ritmo' (muy seguido), 'tope'
           (ya fueron muchas hoy), 'presupuesto', 'apagada', 'indisponible'.
           Al dueño de la tienda ninguno de esos nombres le dice nada, así
           que solo se distingue el de "vas muy rápido", que sí se arregla
           esperando tantito. */
        return {
          texto: d.bloqueado === 'ritmo'
            ? 'Vas muy rápido. Espérame unos segundos y lo intento otra vez.'
            : 'Esa no la alcancé a entender. Pregúntamela con palabras más sencillas, por ejemplo "cuánto vendí hoy".',
          chips: NO_ENTENDI.chips, fuente: 'ninguna'
        };
      }
      var q4 = deGeminiAConsulta(d, texto);
      if (q4) {
        var r4 = ejecutar(q4);
        if (r4) {
          recordar(norm, { intencion: q4.intencion, periodo: q4.periodo, desde: q4.desde, hasta: q4.hasta, metodo: q4.metodo, comparar: q4.comparar });
          empujarMetricas();
          return r4;
        }
      }
      anotar('noEntendidas'); empujarMetricas();
      return Object.assign({ fuente: 'ninguna' }, NO_ENTENDI);
    });
  }

  /* =======================================================================
     8.  LO QUE QUEDA DISPONIBLE PARA EL RESTO DE VENDO PLUS
  ======================================================================= */
  window.VPCerebro = {
    responder: responder,
    valeLaPena: valeLaPena,   /* probar si una frase llegaría a gastar o no */
    interpretar: interpretar,      /* útil para probar sin gastar nada */
    normalizar: normalizar,
    fonetica: fonetica,
    metricas: metricas,
    costoEstimado: costoEstimado,
    borrarMetricas: function () { guardar(K_MET, null); guardar(K_PEN, {}); },
    borrarMemoria: function () { guardar(K_MEM, {}); },
    listo: listo,
    PRECIO: PRECIO,
    LIMITES: LIMITES,
    /* Consulta verificada contra Supabase (no usa IA; sirve para auditar
       que lo que se ve en pantalla coincide con lo que hay en la nube). */
    verificarEnNube: function (periodo) {
      var cl = VP.Cloud;
      if (!cl || !cl.ready || !cl.sb || !cl.uid) return Promise.resolve(null);
      var r = (VP.periodRange || function () { return null; })(periodo || 'today');
      if (!r) return Promise.resolve(null);
      return cl.sb.rpc('vp_resumen', { p_desde: r[0].toISOString(), p_hasta: r[1].toISOString() })
        .then(function (x) { return x.data || null; })
        .catch(function () { return null; });
    }
  };
})();
