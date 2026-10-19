// Extrae la "Referencia de la API v3" publicada a fixtures verificables (herramienta de
// mantención; se corre a mano, no en el CI).
//
// Uso:
//   node scripts/extract-reference.mjs <snapshot.md> reference/
//
// <snapshot.md> es una copia textual de la página publicada en Notion: todo lo que viene
// después de la primera línea que es exactamente `---` es el contenido de la página. El script
// no descarga nada; quien mantiene el repo guarda la copia y la pasa aquí.
//
// Qué escribe en reference/:
//
// - Un archivo `<sección>-<n>.json` por cada ejemplo JSON de la página: cada bloque ```json, y
//   en los ejemplos HTTP (bloques ```javascript) el cuerpo de la petición y cada respuesta
//   `→ 202 {...}`. `<sección>` es el título bajo el que está el ejemplo, en minúsculas y sin
//   tildes; `<n>` cuenta los ejemplos de esa sección desde 1.
// - MANIFEST.json: `[{ file, schema, section, fill }]`. `schema` es la ruta bajo schemas/ (con
//   fragmento cuando el ejemplo es una parte de un cuerpo, como un asiento del statement);
//   `fill` lista las reglas de relleno que se aplicaron al ejemplo.
// - reasons.json: la tabla de `reason`, `[{ reason, code, emitter }]` (`emitter` es la celda
//   "Quién lo emite" sin backticks).
// - e1-reasons.json: los `reason` de la E1 que la página declara vigentes.
// - endpoints.json: la tabla de endpoints de la wallet, `[{ method, path }]`, sin query string.
// - events.json: la tabla de eventos de la wallet, `[{ event, keys, optional }]`: los nombres
//   entre backticks de la columna `data` (sin los valores entre paréntesis), y en `optional`
//   los marcados `(si existe)`.
//
// Reglas de relleno. La página abrevia lo que no aporta al ejemplo; para que el ejemplo valide
// contra su schema, y sólo eso, se completa así (el resto del texto queda byte a byte):
//
// - `envelope`: un mensaje AMQP (un objeto con `type`) sin `idpk`, `msgId` o `timestamp`
//   recibe los que le falten: dos UUID fijos y distintos, y un instante fijo.
// - `uuid`: el valor `"uuid"` se reemplaza por un UUID fijo.
// - `id-truncado`: un identificador truncado como `"3b9e..."` se reemplaza por un UUID fijo
//   que empieza con esos caracteres (el mismo prefijo da siempre el mismo UUID, así
//   `Idempotency-Key: 3b9e...` y `data.idpk: "3b9e..."` siguen nombrando la misma llave).
// - `instante`: el valor `"..."` se reemplaza por un instante fijo.
//
// Un ejemplo cuyo schema no se puede determinar, o una tabla que no aparece, hace fallar el
// script: la página cambió y este mapeo hay que revisarlo a mano.

import fs from 'node:fs';
import path from 'node:path';

const FIXED_IDPK = '11111111-1111-4111-8111-111111111111';
const FIXED_MSGID = '22222222-2222-4222-8222-222222222222';
const FIXED_INSTANT = '2026-10-20T14:06:14.000Z';
const UUID_PLACEHOLDER_BASE = '33333333-3333-4333-8333-';

/** Schema por título de sección, para los ejemplos que no traen `type`. Una función decide
 * entre varios cuerpos de la misma sección por su forma. */
const SECTION_SCHEMAS = {
  'proponer-un-swap': (o) => ('give' in o ? 'wallet/propose-swap-request.schema.json' : 'wallet/write-accepted.schema.json'),
  aceptar: () => 'wallet/write-accepted.schema.json',
  'cuerpos-de-las-respuestas': (o) =>
    'reason' in o ? 'wallet/http-error.schema.json' : 'wallet/swap-state.schema.json',
  'get-balance': () => 'wallet/balance.schema.json',
  'asiento-del-statement': () => 'wallet/statement-page.schema.json#/$defs/StatementEntry',
  'get-leaderboard': () => 'wallet/leaderboard.schema.json',
  'el-token': () => 'token/swap-token-claims.schema.json',
};

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const stripTicks = (s) => s.replace(/`/g, '').trim();

function fail(msg) {
  console.error(`extract-reference: ${msg}`);
  process.exit(1);
}

/** Contenido de la página: lo que sigue a la primera línea `---`. */
function pageBody(text) {
  const lines = text.split('\n');
  const i = lines.indexOf('---');
  if (i < 0) fail('el snapshot no tiene la línea --- que separa el encabezado del contenido');
  return lines.slice(i + 1);
}

/** Recorre la página y devuelve los bloques de código y las tablas, con el título bajo el que
 * aparece cada uno. */
function scan(lines) {
  const blocks = [];
  const tables = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{2,6} (.*)$/.exec(line);
    if (h) {
      heading = h[1];
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ lang: fence[1], heading, text: body.join('\n') });
      continue;
    }
    if (/^<table\b/.test(line)) {
      const rows = [];
      let row = null;
      i++;
      while (i < lines.length && !/^<\/table>/.test(lines[i])) {
        const l = lines[i++];
        if (/^<tr>/.test(l)) row = [];
        else if (/^<\/tr>/.test(l)) rows.push(row);
        else {
          const td = /^<td>(.*)<\/td>$/.exec(l);
          if (td && row) row.push(td[1]);
        }
      }
      tables.push({ heading, rows: rows.slice(1) }); // la primera fila es el encabezado
    }
  }
  return { blocks, tables };
}

/** Los ejemplos JSON de un bloque: el bloque entero si es ```json; en un ejemplo HTTP, el
 * cuerpo de la petición (tras la línea en blanco que cierra los headers) y cada `→ NNN {...}`. */
function examplesOf(block) {
  if (block.lang === 'json') return [block.text];
  if (block.lang !== 'javascript') return [];
  const out = [];
  const lines = block.text.split('\n');
  const blank = lines.findIndex((l) => l.trim() === '');
  const arrow = lines.findIndex((l) => /^→ /.test(l));
  if (blank >= 0 && (arrow < 0 || blank < arrow)) {
    const body = lines.slice(blank + 1, arrow < 0 ? lines.length : arrow).join('\n').trim();
    if (body) out.push(body);
  }
  for (const l of lines) {
    const m = /^→ \d{3} (\{.*\})\s*$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

const truncatedUuid = (prefix) => `${prefix.padEnd(8, '0')}-0000-4000-8000-000000000000`;

/** Aplica las reglas de relleno al texto del ejemplo, sin tocar nada más. */
function fill(raw) {
  const rules = [];
  let text = raw;
  let n = 0;
  if (/"uuid"/.test(text)) {
    text = text.replace(/"uuid"/g, () => `"${UUID_PLACEHOLDER_BASE}${String(++n).padStart(12, '0')}"`);
    rules.push('uuid');
  }
  if (/"[0-9a-f]{2,8}\.\.\."/.test(text)) {
    text = text.replace(/"([0-9a-f]{2,8})\.\.\."/g, (_, p) => `"${truncatedUuid(p)}"`);
    rules.push('id-truncado');
  }
  if (/"\.\.\."/.test(text)) {
    text = text.replace(/"\.\.\."/g, `"${FIXED_INSTANT}"`);
    rules.push('instante');
  }
  const obj = JSON.parse(text);
  if (typeof obj.type === 'string') {
    const add = [];
    if (!('idpk' in obj)) add.push(['idpk', FIXED_IDPK]);
    if (!('msgId' in obj)) add.push(['msgId', FIXED_MSGID]);
    if (!('timestamp' in obj)) add.push(['timestamp', FIXED_INSTANT]);
    if (add.length) {
      // Se insertan justo después de la primera `{`, con la indentación del bloque.
      const m = /^\{(\s*)/.exec(text);
      const sep = m[1].includes('\n') ? m[1] : ' ';
      const ins = add.map(([k, v]) => `"${k}": "${v}",`).join(sep);
      text = `{${sep}${ins}${sep}${text.slice(m[0].length)}`;
      rules.push('envelope');
    }
  }
  JSON.parse(text); // el relleno nunca puede romper el JSON
  return { text, rules };
}

function schemaFor(obj, section, repoRoot) {
  if (typeof obj.type === 'string' && !('swapId' in obj && 'status' in obj)) {
    const rel = `amqp/${obj.type}.schema.json`;
    if (fs.existsSync(path.join(repoRoot, 'schemas', rel))) return rel;
  }
  const pick = SECTION_SCHEMAS[section];
  return pick ? pick(obj) : null;
}

function tableUnder(tables, headingRe) {
  const t = tables.find((x) => headingRe.test(x.heading));
  if (!t) fail(`no hay tabla bajo un título que calce con ${headingRe}`);
  return t.rows;
}

/** Ítems de primer nivel de una celda, separados por comas fuera de paréntesis. */
function topLevelItems(cell) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of cell) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function main() {
  const [snapshot, outDir] = process.argv.slice(2);
  if (!snapshot || !outDir) fail('uso: node scripts/extract-reference.mjs <snapshot.md> reference/');
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const { blocks, tables } = scan(pageBody(fs.readFileSync(snapshot, 'utf8')));

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.json')) fs.rmSync(path.join(outDir, f));

  const manifest = [];
  const perSection = new Map();
  for (const block of blocks) {
    for (const raw of examplesOf(block)) {
      const section = slug(block.heading);
      const { text, rules } = fill(raw);
      const obj = JSON.parse(text);
      const schema = schemaFor(obj, section, repoRoot);
      if (!schema) fail(`no sé qué schema corresponde a un ejemplo bajo "${block.heading}"`);
      const n = (perSection.get(section) ?? 0) + 1;
      perSection.set(section, n);
      const file = `${section}-${n}.json`;
      fs.writeFileSync(path.join(outDir, file), text.endsWith('\n') ? text : text + '\n');
      manifest.push({ file, schema, section: block.heading, fill: rules });
    }
  }

  const reasons = tableUnder(tables, /^Tabla de `reason`/).map(([reason, code, emitter]) => ({
    reason: stripTicks(reason),
    code: Number(code),
    emitter: stripTicks(emitter),
  }));

  const lines = pageBody(fs.readFileSync(snapshot, 'utf8'));
  const e1Line = lines.find((l) => /Los de la E1 que no se retiran siguen vigentes \(/.test(l));
  if (!e1Line) fail('no encuentro la frase de los reason de la E1 que siguen vigentes');
  const e1Reasons = [.../siguen vigentes \(([^)]*)\)/.exec(e1Line)[1].matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]);

  const endpoints = tableUnder(tables, /^Wallet: endpoints/).map(([method, p]) => ({
    method: stripTicks(method),
    path: stripTicks(p).replace(/\?.*$/, ''),
  }));

  const events = tableUnder(tables, /^Wallet: eventos/).map(([event, , data]) => {
    const keys = [];
    const optional = [];
    for (const item of topLevelItems(data)) {
      const m = /^`([A-Za-z]+)`/.exec(item);
      if (!m) continue; // "dato legible por máquina": no nombra una clave
      keys.push(m[1]);
      if (/\(si existe\)/.test(item)) optional.push(m[1]);
    }
    return { event: stripTicks(event), keys, optional };
  });

  const write = (name, value) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2) + '\n');
  write('MANIFEST.json', manifest);
  write('reasons.json', reasons);
  write('e1-reasons.json', e1Reasons);
  write('endpoints.json', endpoints);
  write('events.json', events);
  console.log(
    `${manifest.length} ejemplos, ${reasons.length} reason, ${e1Reasons.length} de la E1, ` +
      `${endpoints.length} endpoints, ${events.length} eventos -> ${outDir}`,
  );
}

main();
