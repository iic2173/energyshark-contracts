// Genera la tabla de mensajes AMQP del README a partir de las anotaciones `x-amqp` de
// schemas/amqp/*.schema.json (D-06) y la escribe entre los marcadores
// `<!-- amqp-table:start -->` y `<!-- amqp-table:end -->`.
//
//   node scripts/render-amqp-table.mjs          reescribe la tabla del README
//   node scripts/render-amqp-table.mjs --check  no escribe nada; sale con 1 si el README difiere
//
// El CI corre `--check`, así que la tabla que leen los equipos no puede quedar desfasada de
// los schemas. Las filas van ordenadas por `type`, para que la salida sea estable.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, byPath, loadSchemas } from './lib/repo.mjs';

const README = path.join(ROOT, 'README.md');
const START = '<!-- amqp-table:start -->';
const END = '<!-- amqp-table:end -->';

const cell = (s) => String(s).replace(/\|/g, '\\|');
const code = (s) => '`' + cell(s) + '`';

function closedness(senders) {
  const closed = senders.some((s) => s === 'central' || s === 'wallet');
  const open = senders.includes('city');
  if (closed && open) return 'central cerrado, ciudad abierto';
  return open ? 'abierto' : 'cerrado';
}

export function renderTable() {
  const rows = loadSchemas()
    .filter((s) => s.rel.startsWith('amqp/'))
    .map((s) => ({ type: s.rel.slice('amqp/'.length).replace(/\.schema\.json$/, ''), rel: s.rel, x: s.schema['x-amqp'] }))
    .sort((a, b) => byPath(a.type, b.type));
  const lines = [
    '| `type` | exchange | routing key | emisor | receptores | `user_id` | cerrado/abierto | schema |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const { type, rel, x } of rows) {
    lines.push(
      '| ' +
        [
          code(type),
          code(x.exchange),
          code(x.routingKey),
          x.sender.map(cell).join(', '),
          x.receivers.map(code).join(', '),
          x.userId === 'required' ? 'obligatorio' : x.userId === 'central' ? '`central` (verificarlo es opcional)' : 'no',
          closedness(x.sender),
          `[${cell(rel)}](schemas/${rel})`,
        ].join(' | ') +
        ' |',
    );
  }
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const readme = fs.readFileSync(README, 'utf8');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    console.error(`README.md no tiene los marcadores ${START} ... ${END}`);
    process.exit(1);
  }
  const next = readme.slice(0, start + START.length) + '\n' + renderTable() + '\n' + readme.slice(end);
  if (check) {
    if (next !== readme) {
      console.error('La tabla AMQP del README está desactualizada: corran `npm run render:table`.');
      process.exit(1);
    }
    console.log('Tabla AMQP del README al día.');
    return;
  }
  fs.writeFileSync(README, next);
  console.log('Tabla AMQP del README actualizada.');
}

main();
