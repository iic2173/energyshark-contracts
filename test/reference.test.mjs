// Qué prueba (CTR-01..CTR-04, SC1): que lo que dice la "Referencia de la API v3" publicada es
// lo que dicen los schemas. reference/ lo produce scripts/extract-reference.mjs a partir de una
// copia textual de la página; esta suite no lee la página, lee lo extraído:
//
// (a) Ejemplos. MANIFEST.json nombra cada ejemplo extraído con su schema y las reglas de
//     relleno que se le aplicaron; cada archivo de reference/ que no es una tabla está en el
//     MANIFEST y cada entrada del MANIFEST existe; cada ejemplo valida con createValidator()
//     contra su schema; las reglas de relleno son sólo las que documenta el script.
// (b) Tabla de `reason`. Cada fila (reason, code) es la del catálogo (`x-code`); los portadores
//     de la celda "Quién lo emite" son exactamente los `x-carriers` del catálogo, y cada emisor
//     está en sus `x-emitters`; los siete `reason` de la E1 que la página declara vigentes están
//     en el catálogo; y el catálogo es exactamente la tabla más esos siete.
// (c) Endpoints. La tabla de la página es exactamente el conjunto de operaciones (método y
//     ruta) de wallet.openapi.yaml. El JWKS vive fuera de /v1 en ambos lados.
// (d) Eventos. La tabla nombra exactamente los mensajes que emite la wallet; cada clave que
//     nombra es una propiedad de `data` en el schema del evento, obligatoria salvo las marcadas
//     `(si existe)`; y el schema no declara más propiedades que esas, salvo el "dato legible
//     por máquina" de `swap-rejected` (`asset`, `available`, `required`, de INSUFFICIENT_ASSET).
//
// Qué no prueba: la prosa de la página (se revisa a mano en el registro lado a lado del
// equipo docente) ni que reference/ esté al día con la página publicada: el script se corre
// a mano cada vez que la página cambia.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { createValidator, SCHEMA_BASE } from '../lib/validator.mjs';
import { ROOT, listFiles, loadSchemas, readJson } from '../scripts/lib/repo.mjs';

const REF_DIR = path.join(ROOT, 'reference');
const TABLES = ['MANIFEST.json', 'reasons.json', 'e1-reasons.json', 'endpoints.json', 'events.json'];
const FILL_RULES = ['envelope', 'uuid', 'id-truncado', 'instante'];
const RETIRED = ['PRICE_ABOVE_CAP', 'OVER_CAPACITY'];
/** El "dato legible por máquina" que la tabla de eventos no nombra clave por clave. */
const MACHINE_READABLE = { 'swap-rejected': ['asset', 'available', 'required'] };

const manifest = readJson(path.join(REF_DIR, 'MANIFEST.json'));
const reasons = readJson(path.join(REF_DIR, 'reasons.json'));
const e1Reasons = readJson(path.join(REF_DIR, 'e1-reasons.json'));
const endpoints = readJson(path.join(REF_DIR, 'endpoints.json'));
const events = readJson(path.join(REF_DIR, 'events.json'));
const schemas = new Map(loadSchemas().map((s) => [s.rel, s.schema]));
const ajv = createValidator();

const fmt = (errors) => (errors ?? []).map((e) => `${e.keyword} en "${e.instancePath}" (${e.message})`).join('; ');
const sorted = (xs) => [...xs].sort();

describe('reference: ejemplos publicados', () => {
  test('el MANIFEST lista cada ejemplo de reference/ y nada más', () => {
    const fixtures = listFiles(REF_DIR, (n) => n.endsWith('.json')).filter((f) => !TABLES.includes(f));
    const listed = manifest.map((m) => m.file);
    assert.equal(new Set(listed).size, listed.length, 'el MANIFEST repite un archivo');
    assert.deepEqual(sorted(listed), sorted(fixtures));
  });

  test('la página publica al menos 20 ejemplos JSON', () => {
    assert.ok(manifest.length >= 20, `sólo ${manifest.length} ejemplos`);
  });

  for (const m of manifest) {
    test(`${m.file} valida contra ${m.schema}`, () => {
      for (const rule of m.fill) assert.ok(FILL_RULES.includes(rule), `regla de relleno desconocida: ${rule}`);
      const validate = ajv.getSchema(SCHEMA_BASE + m.schema);
      assert.ok(validate, `no existe el schema ${m.schema}`);
      const ok = validate(readJson(path.join(REF_DIR, m.file)));
      assert.ok(ok, fmt(validate.errors));
    });
  }
});

describe('reference: tabla de reason', () => {
  const catalog = new Map(schemas.get('reason/reason.schema.json').oneOf.map((o) => [o.const, o]));

  test('la tabla publicada tiene 19 filas, sin repetidos ni retirados', () => {
    const names = reasons.map((r) => r.reason);
    assert.equal(reasons.length, 19);
    assert.equal(new Set(names).size, names.length);
    for (const r of RETIRED) assert.ok(!names.includes(r), `${r} está retirado`);
  });

  for (const row of reasons) {
    test(`${row.reason}: code, portadores y emisores`, () => {
      const entry = catalog.get(row.reason);
      assert.ok(entry, `${row.reason} no está en reason.schema.json`);
      assert.equal(entry['x-code'], row.code);
      // "vendedor, bid-rejected; wallet, swap-rejected": emisor y portador por tramo.
      const parts = row.emitter.split(';').map((p) => p.trim());
      const carriers = parts.map((p) => p.slice(p.lastIndexOf(',') + 1).trim().toLowerCase());
      const emitters = parts.map((p) => p.slice(0, p.lastIndexOf(',')).trim());
      assert.deepEqual(sorted(carriers), sorted(entry['x-carriers']));
      for (const e of emitters) assert.ok(entry['x-emitters'].includes(e), `${e} no está en x-emitters de ${row.reason}`);
    });
  }

  test('los siete reason de la E1 que siguen vigentes están en el catálogo', () => {
    assert.equal(e1Reasons.length, 7);
    for (const r of e1Reasons) assert.ok(catalog.has(r), `${r} no está en reason.schema.json`);
  });

  test('el catálogo es exactamente la tabla más los vigentes de la E1', () => {
    const page = new Set([...reasons.map((r) => r.reason), ...e1Reasons]);
    assert.deepEqual(sorted(catalog.keys()), sorted(page));
  });
});

describe('reference: endpoints de la wallet', () => {
  test('la tabla publicada es exactamente el conjunto de operaciones del OpenAPI', () => {
    const doc = YAML.parse(fs.readFileSync(path.join(ROOT, 'wallet.openapi.yaml'), 'utf8'));
    const ops = [];
    for (const [route, item] of Object.entries(doc.paths ?? {})) {
      for (const method of ['get', 'put', 'post', 'delete', 'patch']) {
        if (item[method]) ops.push(`${method.toUpperCase()} ${route.replace(/^\/v1(?=\/)/, '')}`);
      }
    }
    const page = endpoints.map((e) => `${e.method} ${e.path.replace(/^\/v1(?=\/)/, '')}`);
    assert.equal(endpoints.length, 8);
    assert.deepEqual(sorted(page), sorted(ops));
  });
});

describe('reference: eventos de la wallet', () => {
  const walletEvents = [...schemas.entries()]
    .filter(([rel, s]) => rel.startsWith('amqp/') && (s['x-amqp']?.sender ?? []).includes('wallet'))
    .map(([, s]) => s.properties.type.const);

  test('la tabla nombra exactamente los mensajes que emite la wallet', () => {
    assert.deepEqual(sorted(events.map((e) => e.event)), sorted(walletEvents));
  });

  for (const ev of events) {
    test(`${ev.event}: las claves de data`, () => {
      const schema = schemas.get(`amqp/${ev.event}.schema.json`);
      assert.ok(schema, `no existe amqp/${ev.event}.schema.json`);
      let data = schema.properties.data;
      if (data.$ref) data = schema.$defs[data.$ref.replace('#/$defs/', '')];
      const props = Object.keys(data.properties ?? {});
      const required = data.required ?? [];
      for (const k of ev.keys) {
        assert.ok(props.includes(k), `${k} no es propiedad de data`);
        if (ev.optional.includes(k)) assert.ok(!required.includes(k), `${k} es "(si existe)" y el schema lo exige`);
        else assert.ok(required.includes(k), `${k} es obligatoria en la página y opcional en el schema`);
      }
      const extra = props.filter((p) => !ev.keys.includes(p));
      assert.deepEqual(sorted(extra), sorted(MACHINE_READABLE[ev.event] ?? []));
    });
  }
});
