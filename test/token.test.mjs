// Qué prueba (CTR-03, D-17): que los claims del token de swap son exactamente los ocho que
// publica la referencia (`iss`, `sub`, `iat`, `exp`, `proposer`, `give`, `take`, `memo`), que el
// schema es cerrado, que ninguna propiedad nombra una contraparte (el swap es al portador: un
// claim `counterparty`, `acceptor`, `buyer`, `recipient` o `aud` le haría creer a un equipo que
// el token dice para quién es), que `iss` es constante, que el ejemplo válido vence 30 segundos
// después de emitido (la expiración publicada), y que los dos mensajes que llevan el token
// (`swap-proposed.data.token` y `bid-accepted.data.swapToken`) nombran este schema.
//
// Qué no prueba: que los ejemplos validen (test/examples.test.mjs), ni la firma del token: la
// firma se verifica contra el JWKS, fuera de JSON Schema.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXAMPLES_DIR, loadSchemas, readJson } from '../scripts/lib/repo.mjs';

const CLAIMS = ['iss', 'sub', 'iat', 'exp', 'proposer', 'give', 'take', 'memo'];
const FORBIDDEN = ['counterparty', 'acceptor', 'buyer', 'recipient', 'aud'];
const REL = 'token/swap-token-claims.schema.json';

const schemas = loadSchemas();
const token = schemas.find((s) => s.rel === REL)?.schema;
const byRel = new Map(schemas.map((s) => [s.rel, s.schema]));

/** Recorre todos los nodos objeto de un JSON, con su puntero. */
function walk(node, visit, pointer = '') {
  if (!node || typeof node !== 'object') return;
  visit(node, pointer);
  for (const [k, v] of Object.entries(node)) walk(v, visit, `${pointer}/${k}`);
}

describe('token/', () => {
  test('existe schemas/token/swap-token-claims.schema.json', () => {
    assert.ok(token, `falta schemas/${REL}`);
  });

  test('required son exactamente los ocho claims publicados', () => {
    assert.deepEqual([...token.required].sort(), [...CLAIMS].sort());
    assert.deepEqual(Object.keys(token.properties).sort(), [...CLAIMS].sort());
  });

  test('el schema es cerrado (additionalProperties: false)', () => {
    assert.equal(token.additionalProperties, false);
  });

  test('ninguna propiedad del schema nombra una contraparte', () => {
    const failures = [];
    walk(token, (node, pointer) => {
      if (!node.properties || typeof node.properties !== 'object') return;
      for (const name of Object.keys(node.properties)) {
        if (FORBIDDEN.includes(name)) failures.push(`${REL}#${pointer}/properties/${name}`);
      }
    });
    assert.deepEqual(failures, []);
  });

  test('iss es una constante', () => {
    assert.equal(token.properties.iss.const, 'wallet.energyshark');
  });

  test('cada ejemplo válido vence 30 segundos después de emitido', () => {
    const dir = path.join(EXAMPLES_DIR, 'token/swap-token-claims/valid');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length > 0, 'sin ejemplos válidos de los claims');
    for (const f of files) {
      const doc = readJson(path.join(dir, f));
      assert.equal(doc.exp, doc.iat + 30, `${f}: exp ${doc.exp} no es iat ${doc.iat} + 30`);
    }
  });

  test('swap-proposed.data.token y bid-accepted.data.swapToken nombran el schema de los claims', () => {
    const proposed = byRel.get('amqp/swap-proposed.schema.json');
    const accepted = byRel.get('amqp/bid-accepted.schema.json');
    assert.ok(proposed && accepted, 'faltan swap-proposed o bid-accepted');
    const acceptedData = accepted.properties.data.$ref ? accepted.$defs.Data : accepted.properties.data;
    assert.match(proposed.properties.data.properties.token.description, /swap-token-claims/);
    assert.match(acceptedData.properties.swapToken.description, /swap-token-claims/);
    assert.match(token.description, /swap-proposed\.data\.token/);
    assert.match(token.description, /bid-accepted\.data\.swapToken/);
  });
});
