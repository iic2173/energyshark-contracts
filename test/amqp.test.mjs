// Qué prueba: que `index.schema.json` enlaza cada mensaje de schemas/amqp/ exactamente una vez
// desde `$defs.AnyMessage.anyOf` (es la raíz de la que se generan tipos: un mensaje que no
// aparece ahí no tendría tipo), y que el `type` de cada mensaje (el de cada variante, en los
// schemas con `oneOf`) es igual al nombre de su archivo, de modo que la ruta del schema y el
// valor que viaja por el broker no puedan separarse.
//
// También prueba las routing keys del exchange `market` (CTR-02, D-07, C5): `market-closed` se
// publica a `market` con `market.closed`; ningún mensaje que envía una ciudad usa una routing key
// bajo `market.closed` (así no puede chocar con un `market.offer.{CODE}`, y una ciudad no puede
// hacerse pasar por el cierre); y todo mensaje que una ciudad publica en `market` usa
// `market.offer.{CODE}`, la única routing key que el broker le permite allí.
//
// Qué no prueba: que los ejemplos validen (test/examples.test.mjs).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchemas, resolveRef } from '../scripts/lib/repo.mjs';
import { SCHEMA_BASE } from '../lib/validator.mjs';

const schemas = loadSchemas();
const byId = new Map(schemas.map((s) => [s.id, s.schema]));
const amqp = schemas.filter((s) => s.rel.startsWith('amqp/'));

describe('amqp/', () => {
  test('AnyMessage enlaza cada schema de amqp/ exactamente una vez', () => {
    const failures = [];
    const index = byId.get(SCHEMA_BASE + 'index.schema.json');
    assert.ok(index, 'falta schemas/index.schema.json');
    const anyOf = index.$defs?.AnyMessage?.anyOf ?? [];
    const linked = anyOf.map((entry) => (entry.$ref ? new URL(entry.$ref, index.$id).href : `(sin $ref) ${JSON.stringify(entry)}`));
    const counts = new Map();
    for (const href of linked) counts.set(href, (counts.get(href) ?? 0) + 1);
    for (const { rel, id } of amqp) {
      const n = counts.get(id) ?? 0;
      if (n !== 1) failures.push(`${rel}: aparece ${n} veces en AnyMessage.anyOf`);
    }
    const ids = new Set(amqp.map((s) => s.id));
    for (const href of counts.keys()) if (!ids.has(href)) failures.push(`AnyMessage.anyOf enlaza ${href}, que no es un schema de amqp/`);
    assert.ok(amqp.length > 0, 'no hay schemas en amqp/');
    assert.deepEqual(failures, []);
  });

  test('el type de cada mensaje (y de cada variante) es el nombre de su archivo', () => {
    const failures = [];
    for (const { rel, id, schema } of amqp) {
      const expected = rel.slice('amqp/'.length).replace(/\.schema\.json$/, '');
      const variants = schema.oneOf
        ? schema.oneOf.map((v, i) => ({ where: `oneOf/${i}`, node: v.$ref ? resolveRef(v.$ref, id, byId).node : v }))
        : [{ where: 'raíz', node: schema }];
      for (const { where, node } of variants) {
        const value = node.properties?.type?.const;
        if (value !== expected) failures.push(`${rel} (${where}): type const es ${JSON.stringify(value)}, se espera "${expected}"`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test('market-closed se publica al exchange market con routing key market.closed (D-07, C5)', () => {
    const s = amqp.find((x) => x.rel === 'amqp/market-closed.schema.json');
    assert.ok(s, 'falta schemas/amqp/market-closed.schema.json');
    assert.equal(s.schema['x-amqp']?.exchange, 'market');
    assert.equal(s.schema['x-amqp']?.routingKey, 'market.closed');
  });

  test('ningún mensaje que envía una ciudad usa una routing key bajo market.closed (CTR-02)', () => {
    const failures = [];
    for (const { rel, schema } of amqp) {
      const x = schema['x-amqp'] ?? {};
      if (!(x.sender ?? []).includes('city')) continue;
      for (const key of String(x.routingKey ?? '').split('|').map((k) => k.trim())) {
        if (key.startsWith('market.closed')) failures.push(`${rel}: la routing key ${key} queda bajo market.closed`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test('todo mensaje que una ciudad publica en el exchange market usa market.offer.{CODE}', () => {
    const failures = [];
    for (const { rel, schema } of amqp) {
      const x = schema['x-amqp'] ?? {};
      if (x.exchange !== 'market' || !(x.sender ?? []).includes('city')) continue;
      if (x.routingKey !== 'market.offer.{CODE}') failures.push(`${rel}: routing key ${x.routingKey}, se espera market.offer.{CODE}`);
    }
    assert.deepEqual(failures, []);
  });
});
