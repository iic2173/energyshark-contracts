// Qué prueba sobre wallet.openapi.yaml (CTR-01, CTR-04), en cuatro bloques, cada uno juntando
// todas sus fallas antes de afirmar:
//
// (a) Validez OpenAPI 3.1: el documento valida contra el schema oficial de OAS 3.1, copiado
//     byte a byte en vendor/oas-3.1-schema-2022-10-07.json y fijado por su sha256 (una copia
//     editada hace fallar esta suite). Al cargarlo, cada `"$dynamicRef": "#meta"` se reemplaza
//     en memoria (nunca en disco) por `"$ref": "#/$defs/schema"`: Ajv 8.20.0 resuelve mal ese
//     `$dynamicRef` y rechaza documentos válidos (por ejemplo, revisa el `schema` de un parámetro
//     contra la definición de Parameter Object). El `$ref` estático es equivalente porque ese
//     schema es el único recurso que define el ancla `meta`. Ese schema se compila con su
//     propia instancia de Ajv con `strict: false`, porque no pasa strictTypes; el modo no
//     estricto queda confinado a ese meta-schema de terceros y nunca toca createValidator().
//     `media-range` es un formato que el schema nombra y que Ajv no trae; se registra sin
//     verificar.
// (b) Cada `$ref` resuelve: un `#/...` como puntero dentro del documento; un `./schemas/...`
//     a un archivo existente, y su fragmento (si lo tiene) dentro de ese archivo. Los `$ref`
//     dentro de los schemas ya los prueba test/schemas.test.mjs al compilarlos en Ajv estricto.
// (c) Cada ejemplo embebido valida contra su schema: en cada Media Type Object (cada valor de
//     cada mapa `content`), cada Parameter Object y cada Header Object, en paths y en
//     components, resolviendo antes los `$ref` a components; su `example` y cada
//     `examples[*].value` se validan con la instancia de createValidator(). `externalValue` hace
//     fallar la suite: todo ejemplo debe ir en línea para que el CI lo verifique. La suite exige
//     encontrar al menos un ejemplo.
// (d) Reglas de operación: `openapi` empieza con 3.1; el esquema apiKey es el header
//     `X-Api-Key`; los operationId son únicos; cada respuesta `application/json` usa un schema
//     `$ref` bajo ./schemas/ y trae al menos un `examples`; `getJwks` declara `security: []`; y
//     cada cuerpo de request tiene al menos una mutación inválida en examples/<schema>/invalid/.
// (e) Las operaciones de la wallet: cada operación del documento está en EXPECTED_OPERATIONS
//     (transcripción a mano de la mecánica §5.3 y de la Referencia de la API v3) con su método,
//     su ruta y exactamente sus status; con EXHAUSTIVE, además, cada fila de la tabla existe en
//     el documento, así que no se puede agregar ni quitar una operación (ni describir una
//     operación interna) sin cambiar esta tabla. Cada escritura (POST) declara el parámetro
//     Idempotency-Key (UUID, obligatorio) y ninguna lectura lo declara; cada 429 y 503 declara
//     el header Retry-After; cada respuesta trae `application/json` con al menos un ejemplo (que
//     el bloque (c) valida); el `code` de cada ejemplo de error es su status HTTP; toda operación
//     salvo getJwks exige X-Api-Key. Y proposeSwap lleva exactamente los ejemplos `publicado` y
//     `mismo-activo` (ninguno se puede borrar sin que esto falle), con las mutaciones de
//     ProposeSwapRequest que el bloque (d) cuenta.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';
import { createValidator, SCHEMA_BASE } from '../lib/validator.mjs';
import { EXAMPLES_DIR, ROOT, getPointer, listFiles, readJson } from '../scripts/lib/repo.mjs';

const OAS_FILE = path.join(ROOT, 'vendor', 'oas-3.1-schema-2022-10-07.json');
const OAS_SHA256 = 'da01ba28852cac0de53893797cb8d1942bc3b05084f526dcc216717dec314ed0';
const DOC_FILE = path.join(ROOT, 'wallet.openapi.yaml');
const doc = YAML.parse(fs.readFileSync(DOC_FILE, 'utf8'));
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const fmt = (errors) => (errors ?? []).map((e) => `${e.keyword} en "${e.instancePath}" (${e.message})`).join('; ');

/** Recorre todos los nodos objeto del documento con su puntero JSON. */
function walk(node, visit, pointer = '') {
  if (!node || typeof node !== 'object') return;
  visit(node, pointer);
  for (const [k, v] of Object.entries(node)) walk(v, visit, `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
}

/** Como `walk`, pero sin entrar en schemas ni en valores de ejemplo: ahí una clave `content`,
 * `parameters` o `headers` es dato, no un objeto de OpenAPI. */
const OPAQUE = new Set(['schema', 'schemas', 'example', 'examples']);
function walkSpec(node, visit, pointer = '') {
  if (!node || typeof node !== 'object') return;
  visit(node, pointer);
  for (const [k, v] of Object.entries(node)) {
    if (OPAQUE.has(k)) continue;
    walkSpec(v, visit, `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  }
}

/** Sigue `$ref` internos (`#/components/...`) hasta un nodo concreto. */
function deref(node) {
  const seen = new Set();
  while (node && typeof node === 'object' && typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
    if (seen.has(node.$ref)) throw new Error(`$ref circular: ${node.$ref}`);
    seen.add(node.$ref);
    const next = getPointer(doc, decodeURIComponent(node.$ref.slice(1)));
    if (next === undefined) throw new Error(`$ref sin destino: ${node.$ref}`);
    node = next;
  }
  return node;
}

describe('wallet.openapi.yaml', () => {
  test('(a) wallet.openapi.yaml es un documento OpenAPI 3.1 válido según el schema oficial', () => {
    const failures = [];
    const bytes = fs.readFileSync(OAS_FILE);
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha, OAS_SHA256, 'vendor/oas-3.1-schema-2022-10-07.json no es la copia publicada (sha256 distinto)');
    const oas = JSON.parse(bytes.toString('utf8'), (key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && value.$dynamicRef === '#meta') {
        const { $dynamicRef, ...rest } = value;
        return { ...rest, $ref: '#/$defs/schema' };
      }
      return value;
    });
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addFormat('media-range', true);
    const validate = ajv.compile(oas);
    if (!validate(doc)) failures.push(`no valida contra OAS 3.1: ${fmt(validate.errors)}`);
    assert.deepEqual(failures, []);
  });

  test('(b) cada $ref del documento resuelve', () => {
    const failures = [];
    let count = 0;
    walk(doc, (node, pointer) => {
      if (typeof node.$ref !== 'string') return;
      count += 1;
      const ref = node.$ref;
      if (ref.startsWith('#')) {
        if (getPointer(doc, decodeURIComponent(ref.slice(1))) === undefined) failures.push(`${pointer}: ${ref} no resuelve en el documento`);
        return;
      }
      if (!ref.startsWith('./schemas/')) {
        failures.push(`${pointer}: ${ref} no es interno ni apunta a ./schemas/`);
        return;
      }
      const [file, fragment] = ref.split('#');
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) {
        failures.push(`${pointer}: ${ref} apunta a un archivo inexistente`);
        return;
      }
      if (fragment !== undefined && getPointer(readJson(full), decodeURIComponent(fragment)) === undefined) {
        failures.push(`${pointer}: el fragmento #${fragment} no existe en ${file}`);
      }
    });
    assert.ok(count > 0, 'el documento no tiene ningún $ref: la prueba no probaría nada');
    assert.deepEqual(failures, []);
  });

  /** Copia un schema de OpenAPI reescribiendo `./schemas/<p>` a `SCHEMA_BASE + <p>` y
   * reemplazando en línea los `#/components/schemas/...`. */
  function toValidatorSchema(schema, seen = new Set()) {
    if (Array.isArray(schema)) return schema.map((s) => toValidatorSchema(s, seen));
    if (!schema || typeof schema !== 'object') return schema;
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === '$ref' && typeof v === 'string') {
        if (v.startsWith('./schemas/')) {
          out.$ref = SCHEMA_BASE + v.slice('./schemas/'.length);
          continue;
        }
        if (v.startsWith('#/components/schemas/')) {
          if (seen.has(v)) throw new Error(`schema recursivo en components: ${v}`);
          return toValidatorSchema(deref({ $ref: v }), new Set([...seen, v]));
        }
      }
      out[k] = toValidatorSchema(v, seen);
    }
    return out;
  }

  test('(c) cada ejemplo embebido valida contra su schema; no hay externalValue', () => {
    const failures = [];
    const ajv = createValidator();
    const compiled = new Map();
    const validatorFor = (schema) => {
      const key = JSON.stringify(schema);
      if (!compiled.has(key)) {
        const s = toValidatorSchema(schema);
        compiled.set(key, s.$ref && Object.keys(s).length === 1 ? ajv.getSchema(s.$ref) : ajv.compile(s));
      }
      return compiled.get(key);
    };

    // Objetos que pueden llevar `example` / `examples` junto a `schema`.
    const holders = [];
    walkSpec(doc, (node, pointer) => {
      if (node.content && typeof node.content === 'object' && !Array.isArray(node.content)) {
        for (const [media, mt] of Object.entries(node.content)) holders.push({ where: `${pointer}/content/${media}`, node: mt });
      }
      if (Array.isArray(node.parameters)) node.parameters.forEach((p, i) => holders.push({ where: `${pointer}/parameters/${i}`, node: p }));
      if (node.headers && typeof node.headers === 'object' && !Array.isArray(node.headers)) {
        for (const [name, h] of Object.entries(node.headers)) holders.push({ where: `${pointer}/headers/${name}`, node: h });
      }
    });
    for (const [name, p] of Object.entries(doc.components?.parameters ?? {})) holders.push({ where: `/components/parameters/${name}`, node: p });
    for (const [name, h] of Object.entries(doc.components?.headers ?? {})) holders.push({ where: `/components/headers/${name}`, node: h });

    let count = 0;
    walk(doc, (node, pointer) => {
      if ('externalValue' in node) failures.push(`${pointer}: externalValue no se permite; pongan el ejemplo en línea`);
    });
    for (const { where, node: raw } of holders) {
      let node;
      try {
        node = deref(raw);
      } catch (error) {
        failures.push(`${where}: ${error.message}`);
        continue;
      }
      if (!node || typeof node !== 'object') continue;
      const samples = [];
      if ('example' in node) samples.push({ label: 'example', value: node.example });
      for (const [name, ex] of Object.entries(node.examples ?? {})) {
        let e;
        try {
          e = deref(ex);
        } catch (error) {
          failures.push(`${where}/examples/${name}: ${error.message}`);
          continue;
        }
        if (e && 'externalValue' in e) continue; // ya reportado arriba
        if (!e || !('value' in e)) {
          failures.push(`${where}/examples/${name}: sin value`);
          continue;
        }
        samples.push({ label: `examples/${name}`, value: e.value });
      }
      if (samples.length === 0) continue;
      if (!node.schema) {
        failures.push(`${where}: tiene ejemplos pero no schema`);
        continue;
      }
      let validate;
      try {
        validate = validatorFor(node.schema);
      } catch (error) {
        failures.push(`${where}: el schema no compila: ${error.message}`);
        continue;
      }
      if (typeof validate !== 'function') {
        failures.push(`${where}: el schema ${JSON.stringify(node.schema)} no está registrado en el validador`);
        continue;
      }
      for (const { label, value } of samples) {
        count += 1;
        if (!validate(value)) failures.push(`${where}/${label}: no valida: ${fmt(validate.errors)}`);
      }
    }
    assert.ok(count > 0, 'no se encontró ningún ejemplo embebido: la prueba no probaría nada');
    assert.deepEqual(failures, []);
  });

  test('(d) reglas de operación: 3.1, X-Api-Key, operationId únicos, respuestas JSON con schema y ejemplo, getJwks sin seguridad', () => {
    const failures = [];
    if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.1')) failures.push(`openapi es ${doc.openapi}, se espera 3.1.x`);
    const key = doc.components?.securitySchemes?.apiKey;
    if (!key || key.type !== 'apiKey' || key.in !== 'header' || key.name !== 'X-Api-Key') {
      failures.push('components.securitySchemes.apiKey debe ser apiKey en el header X-Api-Key');
    }
    const ids = new Map();
    for (const [route, item] of Object.entries(doc.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op) continue;
        const where = `${method.toUpperCase()} ${route}`;
        if (!op.operationId) failures.push(`${where}: sin operationId`);
        else if (ids.has(op.operationId)) failures.push(`${where}: operationId ${op.operationId} repetido (también en ${ids.get(op.operationId)})`);
        else ids.set(op.operationId, where);
        for (const [status, rawResponse] of Object.entries(op.responses ?? {})) {
          const response = deref(rawResponse);
          const json = response?.content?.['application/json'];
          if (!json) continue;
          if (typeof json.schema?.$ref !== 'string' || !json.schema.$ref.startsWith('./schemas/')) {
            failures.push(`${where} ${status}: el schema application/json debe ser un $ref bajo ./schemas/`);
          }
          if (Object.keys(json.examples ?? {}).length === 0) failures.push(`${where} ${status}: sin examples`);
        }
      }
    }
    const jwks = doc.paths?.['/.well-known/jwks.json']?.get;
    if (!jwks || jwks.operationId !== 'getJwks') failures.push('falta GET /.well-known/jwks.json con operationId getJwks');
    else if (!Array.isArray(jwks.security) || jwks.security.length !== 0) failures.push('getJwks debe declarar security: []');
    assert.deepEqual(failures, []);
  });

  test('(d) cada schema de cuerpo de request tiene al menos una mutación inválida', () => {
    const failures = [];
    let bodies = 0;
    for (const [route, item] of Object.entries(doc.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op?.requestBody) continue;
        bodies += 1;
        const body = deref(op.requestBody);
        for (const [media, mt] of Object.entries(body.content ?? {})) {
          const ref = mt.schema?.$ref;
          const where = `${method.toUpperCase()} ${route} ${media}`;
          if (typeof ref !== 'string' || !ref.startsWith('./schemas/')) {
            failures.push(`${where}: el cuerpo debe usar un $ref bajo ./schemas/`);
            continue;
          }
          const rel = ref.slice('./schemas/'.length).split('#')[0].replace(/\.schema\.json$/, '');
          const invalid = listFiles(path.join(EXAMPLES_DIR, rel, 'invalid'), (n) => n.endsWith('.json'));
          if (invalid.length === 0) failures.push(`${where}: examples/${rel}/invalid/ no tiene mutaciones`);
        }
      }
    }
    assert.ok(bodies > 0, 'ninguna operación tiene cuerpo de request: la prueba no probaría nada');
    assert.deepEqual(failures, []);
  });

  /** Operaciones de la wallet según la mecánica §5.3 y la Referencia de la API v3:
   * operationId -> [método, ruta, status declarados]. */
  const WRITE_STATUSES = ['200', '202', '401', '404', '422', '429', '503'];
  const EXPECTED_OPERATIONS = {
    proposeSwap: ['post', '/swaps', ['200', '202', '401', '422', '429', '503']],
    acceptSwap: ['post', '/swaps/{swapId}/accept', WRITE_STATUSES],
    cancelSwap: ['post', '/swaps/{swapId}/cancel', WRITE_STATUSES],
    getSwap: ['get', '/swaps/{swapId}', ['200', '401', '404', '429']],
    getBalance: ['get', '/balance', ['200', '401', '429']],
    getStatement: ['get', '/statement', ['200', '401', '429']],
    getLeaderboard: ['get', '/leaderboard', ['200', '401', '429']],
    getJwks: ['get', '/.well-known/jwks.json', ['200']],
  };
  /** Con `true`, cada fila de EXPECTED_OPERATIONS debe existir en el documento. */
  const EXHAUSTIVE = false;

  function operations() {
    const out = [];
    for (const [route, item] of Object.entries(doc.paths ?? {})) {
      for (const method of HTTP_METHODS) if (item[method]) out.push({ route, method, op: item[method] });
    }
    return out;
  }

  test('(e) cada operación del documento está en la tabla de la mecánica §5.3 con su método, ruta y status exactos', () => {
    const failures = [];
    const present = new Set();
    for (const { route, method, op } of operations()) {
      const where = `${method.toUpperCase()} ${route}`;
      const row = EXPECTED_OPERATIONS[op.operationId];
      if (!row) {
        failures.push(`${where}: operationId ${op.operationId} no es una de las operaciones publicadas`);
        continue;
      }
      present.add(op.operationId);
      const [wantMethod, wantRoute, wantStatuses] = row;
      if (method !== wantMethod || route !== wantRoute) failures.push(`${op.operationId}: está en ${where}, se espera ${wantMethod.toUpperCase()} ${wantRoute}`);
      const got = Object.keys(op.responses ?? {}).sort();
      const want = [...wantStatuses].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${op.operationId}: declara ${got.join(',')}, se espera ${want.join(',')}`);
    }
    if (EXHAUSTIVE) {
      for (const id of Object.keys(EXPECTED_OPERATIONS)) if (!present.has(id)) failures.push(`falta la operación ${id}`);
    }
    assert.ok(present.has('proposeSwap'), 'falta proposeSwap');
    assert.deepEqual(failures, []);
  });

  test('(e) escrituras con Idempotency-Key; 429 y 503 con Retry-After; cada respuesta JSON con ejemplo; code del error = status; X-Api-Key salvo getJwks', () => {
    const failures = [];
    for (const { route, method, op } of operations()) {
      const where = `${method.toUpperCase()} ${route}`;
      const params = (op.parameters ?? []).map((p) => deref(p));
      const idem = params.filter((p) => p?.name === 'Idempotency-Key');
      if (method === 'post') {
        if (idem.length !== 1) failures.push(`${where}: una escritura declara exactamente un parámetro Idempotency-Key`);
        else if (idem[0].in !== 'header' || idem[0].required !== true || idem[0].schema?.format !== 'uuid') {
          failures.push(`${where}: Idempotency-Key debe ser un header obligatorio con formato uuid`);
        }
      } else if (idem.length > 0) failures.push(`${where}: una lectura no lleva Idempotency-Key`);
      if (op.operationId !== 'getJwks' && op.security !== undefined && !op.security.some((s) => 'apiKey' in s)) {
        failures.push(`${where}: debe exigir X-Api-Key`);
      }
      for (const [status, raw] of Object.entries(op.responses ?? {})) {
        const response = deref(raw);
        if (status === '429' || status === '503') {
          const header = deref(response.headers?.['Retry-After']);
          if (!header || header.required !== true) failures.push(`${where} ${status}: falta el header Retry-After obligatorio`);
        }
        const json = response.content?.['application/json'];
        if (!json) {
          failures.push(`${where} ${status}: sin cuerpo application/json`);
          continue;
        }
        const examples = Object.entries(json.examples ?? {});
        if (examples.length === 0) failures.push(`${where} ${status}: sin ejemplos`);
        if (Number(status) >= 400) {
          for (const [name, ex] of examples) {
            const value = deref(ex).value;
            if (value?.code !== Number(status)) failures.push(`${where} ${status}: el ejemplo ${name} tiene code ${value?.code}`);
          }
        }
      }
    }
    assert.deepEqual(failures, []);
  });

  test('(e) proposeSwap lleva exactamente los ejemplos publicado y mismo-activo, y ProposeSwapRequest sus mutaciones', () => {
    const failures = [];
    const body = deref(doc.paths?.['/swaps']?.post?.requestBody);
    const names = Object.keys(body?.content?.['application/json']?.examples ?? {}).sort();
    if (JSON.stringify(names) !== JSON.stringify(['mismo-activo', 'publicado'])) {
      failures.push(`proposeSwap: los ejemplos del cuerpo son ${names.join(',') || '(ninguno)'}, se espera mismo-activo,publicado`);
    }
    const dir = path.join(EXAMPLES_DIR, 'wallet', 'propose-swap-request');
    const invalid = new Set(listFiles(path.join(dir, 'invalid'), (n) => n.endsWith('.json')));
    for (const f of ['with-counterparty.json', 'fractional-kwh.json', 'missing-memo.json', 'empty-body.json']) {
      if (!invalid.has(f)) failures.push(`examples/wallet/propose-swap-request/invalid/${f}: falta`);
    }
    const valid = new Set(listFiles(path.join(dir, 'valid'), (n) => n.endsWith('.json')));
    for (const f of ['same-asset.json', 'empty-memo.json']) {
      if (!valid.has(f)) failures.push(`examples/wallet/propose-swap-request/valid/${f}: falta`);
    }
    assert.deepEqual(failures, []);
  });
});
