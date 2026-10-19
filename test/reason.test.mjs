// Qué prueba (CTR-03): que el catálogo de `reason` es exactamente la tabla de abajo, transcrita
// de la mecánica E2 §13.2 más los siete `reason` de la E1 que siguen vigentes, con su `code`,
// sus portadores y sus emisores; que los pares (`reason`, `code`) por portador de
// refusals.schema.json cubren exactamente el catálogo, con el mismo `code` en cada portador y
// en los portadores que el catálogo declara; que `nack` y `error` usan el portador que les
// corresponde; y que los `reason` retirados (PRICE_ABOVE_CAP, OVER_CAPACITY) no aparecen en
// ningún schema ni ejemplo, salvo en los dos ejemplos inválidos que prueban que se rechazan.
//
// La tabla está escrita a mano a propósito: si alguien cambia un `code` en el catálogo y en los
// portadores a la vez, esta suite falla igual.
//
// Qué no prueba: las descripciones (son texto publicado; se revisan contra la referencia).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXAMPLES_DIR, ROOT, SCHEMAS_DIR, listFiles, loadSchemas } from '../scripts/lib/repo.mjs';

const ANY = ['central', 'cualquier receptor'];
/** [reason, code, portadores, emisores] */
const EXPECTED = [
  ['MALFORMED_MESSAGE', 422, ['nack'], ANY],
  ['UNKNOWN_TYPE', 400, ['nack'], ANY],
  ['IDPK_EQUALS_MSGID', 422, ['nack'], ANY],
  ['IDENTITY_MISMATCH', 403, ['nack'], ANY],
  ['CYCLE_UNKNOWN', 404, ['error'], ['central']],
  ['CYCLE_EXPIRED', 410, ['error'], ['central']],
  ['REPORT_TOO_EARLY', 422, ['error'], ['central']],
  ['TYPE_RETIRED', 410, ['error'], ['central']],
  ['QUANTITY_UNAVAILABLE', 409, ['bid-rejected'], ['vendedor']],
  ['OFFER_WITHDRAWN', 410, ['bid-rejected'], ['vendedor']],
  ['BID_TOO_SMALL', 422, ['bid-rejected'], ['vendedor']],
  ['MARKET_CLOSED', 410, ['bid-rejected', 'swap-rejected'], ['vendedor', 'wallet']],
  ['SELF_TRADE', 422, ['bid-rejected'], ['vendedor']],
  ['INSUFFICIENT_ASSET', 402, ['swap-rejected'], ['wallet']],
  ['SWAP_NOT_PROPOSED', 409, ['swap-rejected'], ['wallet']],
  ['SWAP_EXPIRED', 410, ['swap-rejected'], ['wallet']],
  ['NOT_PROPOSER', 403, ['swap-rejected'], ['wallet']],
  ['SELF_SWAP', 422, ['swap-rejected'], ['wallet']],
  ['SAME_ASSET', 422, ['swap-rejected'], ['wallet']],
  ['SWAP_UNKNOWN', 404, ['http'], ['wallet']],
  ['MALFORMED_REQUEST', 422, ['http'], ['wallet']],
  ['IDEMPOTENCY_MISMATCH', 422, ['http'], ['wallet']],
  ['WALLET_BUSY', 503, ['http'], ['wallet']],
  ['RATE_LIMITED', 429, ['http'], ['wallet']],
  ['UNAUTHORIZED', 401, ['http'], ['wallet']],
];
const CARRIER_DEFS = {
  nack: 'NackRefusal',
  error: 'ErrorRefusal',
  'bid-rejected': 'BidRejectedRefusal',
  'swap-rejected': 'SwapRejectedRefusal',
  http: 'HttpRefusal',
};
const RETIRED = ['PRICE_ABOVE_CAP', 'OVER_CAPACITY'];
/** Los únicos archivos que pueden nombrar un `reason` retirado: mutaciones que prueban que se rechaza. */
const RETIRED_ALLOWED = ['examples/amqp/nack/invalid/retired-reason.json', 'examples/reason/reason/invalid/price-above-cap.json'];

const schemas = new Map(loadSchemas().map((s) => [s.rel, s.schema]));
const reason = schemas.get('reason/reason.schema.json');
const refusals = schemas.get('reason/refusals.schema.json');
const sorted = (a) => [...a].sort();

describe('reason/', () => {
  test('el catálogo es exactamente la tabla de la mecánica §13.2 más la E1', () => {
    assert.ok(reason, 'falta schemas/reason/reason.schema.json');
    const actual = reason.oneOf.map((b) => [b.const, b['x-code'], b['x-carriers'], b['x-emitters']]);
    assert.deepEqual(actual, EXPECTED);
    const failures = [];
    for (const b of reason.oneOf) {
      if ('title' in b) failures.push(`${b.const}: las ramas no llevan título`);
      if (typeof b.description !== 'string' || b.description.trim() === '') failures.push(`${b.const}: sin descripción`);
    }
    assert.deepEqual(failures, []);
  });

  test('los portadores cubren exactamente el catálogo, con el mismo code y en los portadores declarados', () => {
    assert.ok(refusals, 'falta schemas/reason/refusals.schema.json');
    const failures = [];
    const carriersOf = new Map();
    for (const [carrier, def] of Object.entries(CARRIER_DEFS)) {
      const branches = refusals.$defs?.[def]?.oneOf;
      if (!Array.isArray(branches) || branches.length === 0) {
        failures.push(`${def}: no existe o no tiene ramas`);
        continue;
      }
      const seen = new Set();
      for (const b of branches) {
        const r = b.properties?.reason?.const;
        const code = b.properties?.code?.const;
        if (JSON.stringify(b.required) !== JSON.stringify(['reason', 'code'])) failures.push(`${def}/${r}: required debe ser [reason, code] dentro de la rama`);
        if (b.type !== 'object') failures.push(`${def}/${r}: la rama debe declarar type: object`);
        if (typeof b['x-emitter'] !== 'string') failures.push(`${def}/${r}: sin x-emitter`);
        if (seen.has(r)) failures.push(`${def}: ${r} repetido`);
        seen.add(r);
        const row = EXPECTED.find(([name]) => name === r);
        if (!row) {
          failures.push(`${def}: ${r} no está en el catálogo`);
          continue;
        }
        if (code !== row[1]) failures.push(`${def}/${r}: code ${code}, el catálogo dice ${row[1]} (x-code)`);
        if (!carriersOf.has(r)) carriersOf.set(r, []);
        carriersOf.get(r).push(carrier);
      }
    }
    for (const b of reason.oneOf) {
      const got = sorted(carriersOf.get(b.const) ?? []);
      if (JSON.stringify(got) !== JSON.stringify(sorted(b['x-carriers']))) {
        failures.push(`${b.const}: aparece en los portadores ${got.join(',') || '(ninguno)'}, x-carriers dice ${b['x-carriers'].join(',')}`);
      }
      const code = b['x-code'];
      for (const carrier of carriersOf.get(b.const) ?? []) {
        const branch = refusals.$defs[CARRIER_DEFS[carrier]].oneOf.find((x) => x.properties.reason.const === b.const);
        if (branch.properties.code.const !== code) failures.push(`${b.const}: x-code ${code} distinto del code en ${carrier}`);
      }
    }
    const union = sorted(carriersOf.keys());
    const catalogue = sorted(reason.oneOf.map((b) => b.const));
    if (JSON.stringify(union) !== JSON.stringify(catalogue)) failures.push(`la unión de los portadores (${union.length}) no es el catálogo (${catalogue.length})`);
    assert.deepEqual(failures, []);
  });

  test('nack y error usan el portador que les corresponde', () => {
    const failures = [];
    const uses = (schema, def) => JSON.stringify(schema).includes(`"../reason/refusals.schema.json#/$defs/${def}"`);
    const nack = schemas.get('amqp/nack.schema.json');
    const error = schemas.get('amqp/error.schema.json');
    if (!nack || !uses(nack, 'NackRefusal')) failures.push('amqp/nack no usa NackRefusal');
    if (!error || !uses(error, 'ErrorRefusal')) failures.push('amqp/error no usa ErrorRefusal');
    for (const def of Object.values(CARRIER_DEFS)) {
      if (def !== 'NackRefusal' && nack && uses(nack, def)) failures.push(`amqp/nack usa ${def}`);
      if (def !== 'ErrorRefusal' && error && uses(error, def)) failures.push(`amqp/error usa ${def}`);
    }
    assert.deepEqual(failures, []);
  });

  test('los reason retirados no aparecen en schemas, ejemplos ni documentos publicados', () => {
    const failures = [];
    const files = [
      ...listFiles(SCHEMAS_DIR).map((f) => `schemas/${f}`),
      ...listFiles(EXAMPLES_DIR).map((f) => `examples/${f}`),
      'README.md',
      'CHANGELOG.md',
      'wallet.openapi.yaml',
    ];
    for (const rel of files) {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const r of RETIRED) {
        if (text.includes(r) && !RETIRED_ALLOWED.includes(rel)) failures.push(`${rel} nombra ${r}`);
      }
    }
    for (const rel of RETIRED_ALLOWED) {
      if (!fs.existsSync(path.join(ROOT, rel))) failures.push(`${rel}: el ejemplo que prueba el rechazo de un reason retirado no existe`);
    }
    assert.deepEqual(failures, []);
  });
});
