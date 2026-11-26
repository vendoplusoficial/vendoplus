// Comprime index.html (sus <script> y <style>) y los .js/.css del sitio.
// No cambia nombres de funciones ni variables globales: solo quita comentarios,
// espacios y acorta lo que es seguro. Uso: node minificar.js <carpeta-origen> <carpeta-salida>
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const [src, out] = process.argv.slice(2);

const TERSER = {
  ecma: 2020,
  compress: { passes: 1, toplevel: false, keep_fnames: true, keep_classnames: true, unused: false, dead_code: true, drop_console: false, collapse_vars: false, reduce_vars: false, inline: false, hoist_funs: false, join_vars: false, sequences: false },
  mangle: false,
  format: { comments: /^!|@license|@preserve/i, ascii_only: false },
  keep_fnames: true,
  keep_classnames: true,
};
// CSS: solo se quitan comentarios y espacios. Los valores se dejan tal cual.
const postcss = require('postcss');
const css = (code, nombre) => {
  try {
    const root = postcss.parse(code);
    root.walkComments(c => { if (!/^!/.test(c.text)) c.remove(); });
    root.walk(n => {
      n.raws.before = ''; n.raws.after = '';
      if (n.type === 'decl') { n.raws.between = ':'; if (n.raws.important) n.raws.important = '!important'; if (n.raws.value) n.raws.value = { value: n.value, raw: n.value }; }
      if (n.type === 'rule') { n.raws.between = ''; n.raws.semicolon = false; n.selector = n.selector.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim(); }
      if (n.type === 'atrule') { n.raws.between = ''; n.raws.afterName = n.params ? ' ' : ''; n.params = n.params.replace(/\s+/g, ' ').trim(); n.raws.semicolon = false; }
    });
    root.raws.after = ''; root.raws.semicolon = false;
    return root.toString();
  } catch (e) { console.error('CSS sin comprimir:', nombre, e.message); return code; }
};
const js = async (code, nombre) => {
  try { const r = await minify(code, TERSER); return r.code; }
  catch (e) { console.error('JS sin comprimir:', nombre, e.message); return code; }
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  let antes = 0, despues = 0;
  const copia = (rel) => {
    const a = path.join(src, rel), b = path.join(out, rel);
    const st = fs.statSync(a);
    if (st.isDirectory()) { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a)) if (f !== '.git' && f !== 'node_modules') copia(path.join(rel, f)); return; }
    fs.copyFileSync(a, b);
  };
  for (const f of fs.readdirSync(src)) if (!['.git', '.github', 'node_modules', '_site'].includes(f)) copia(f);

  for (const f of fs.readdirSync(src)) {
    const p = path.join(src, f);
    if (/^vendo-.*\.js$/.test(f)) { const c = fs.readFileSync(p, 'utf8'); const m = await js(c, f); antes += c.length; despues += m.length; fs.writeFileSync(path.join(out, f), m); }
    if (/^vendo-.*\.css$/.test(f)) { const c = fs.readFileSync(p, 'utf8'); const m = css(c, f); antes += c.length; despues += m.length; fs.writeFileSync(path.join(out, f), m); }
  }
  for (const f of ['index.html', '404.html', 'privacidad.html', 'eliminar-cuenta.html']) {
    const p = path.join(src, f); if (!fs.existsSync(p)) continue;
    const h = fs.readFileSync(p, 'utf8');
    let res = '', i = 0;
    const re = /<(script|style)\b([^>]*)>/gi; let m;
    while ((m = re.exec(h))) {
      const tag = m[1].toLowerCase(), ini = re.lastIndex, fin = h.indexOf('</' + tag + '>', ini);
      re.lastIndex = fin;
      const cuerpo = h.slice(ini, fin);
      let nuevo = cuerpo;
      if (tag === 'script' && !/\bsrc=/.test(m[2]) && !/type=/.test(m[2]) && cuerpo.trim()) nuevo = await js(cuerpo, f + '@' + ini);
      else if (tag === 'style' && cuerpo.trim()) nuevo = css(cuerpo, f + '@' + ini);
      res += h.slice(i, ini) + nuevo;
      i = fin;
    }
    res += h.slice(i);
    // comentarios HTML (no los condicionales) y renglones vacíos
    res = res.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/\n\s*\n+/g, '\n');
    antes += h.length; despues += res.length;
    fs.writeFileSync(path.join(out, f), res);
  }
  console.log('Comprimido:', Math.round(antes / 1024), 'KB →', Math.round(despues / 1024), 'KB');
})();
