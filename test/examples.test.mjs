// Qué prueba (CTR-04): que cada schema tiene al menos un ejemplo válido y que todos validan;
// que cada ejemplo inválido es una mutación de exactamente un ejemplo válido (`base` + `set` /
// `unset`) y falla con la palabra clave y en el `instancePath` que declara, de modo que un
// ejemplo inválido no puede fallar "por otra razón" (un UUID mal tipeado) y pasar igual; que
// una mutación cuya base no valida hace fallar la suite; que no hay carpetas de ejemplos
// huérfanas; y la regla D-09 de mensajes cerrados y abiertos:
//   - un mensaje que emite la central o la wallet tiene una mutación que agrega un campo extra
//     en la raíz (falla `unevaluatedProperties` en "") y otra que lo agrega en `data` (falla
//     `additionalProperties` en "/data");
//   - un mensaje que emite una ciudad tiene un ejemplo válido `*with-extra-fields.json` que de
//     verdad trae una clave no declarada en la raíz y otra en `data`.
//
// Qué no prueba: la forma de los schemas (test/schemas.test.mjs).
//
// Recorre schemas/ y examples/ completos en orden de ruta estable, nunca desde
// index.schema.json, así que un schema recién agregado queda cubierto aunque la raíz todavía no
// lo enlace.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createValidator, SCHEMA_BASE } from '../lib/validator.mjs';
import {
  EXAMPLES_DIR,
  applyMutation,
  declaredProperties,
  examplesRelFor,
  listDirs,
  listFiles,
  loadSchemas,
  readJson,
  resolveRef,
} from '../scripts/lib/repo.mjs';

const schemas = loadSchemas();
const byId = new Map(schemas.map((s) => [s.id, s.schema]));
const ajv = createValidator();

const fmt = (errors) =>
  (errors ?? []).map((e) => `${e.keyword} en "${e.instancePath}" (${e.message})`).join('; ');

function jsonFiles(dir) {
  return fs.existsSync(dir) ? listFiles(dir, (n) => n.endsWith('.json')).filter((f) => !f.includes('/')) : [];
}

describe('examples/', () => {
  test('cada schema tiene ejemplos válidos y todos validan', () => {
    const failures = [];
    for (const { rel, id } of schemas) {
      const validate = ajv.getSchema(id);
      const dir = path.join(EXAMPLES_DIR, examplesRelFor(rel), 'valid');
      const files = jsonFiles(dir);
      if (files.length === 0) {
        failures.push(`${rel}: sin ejemplos en examples/${examplesRelFor(rel)}/valid/`);
        continue;
      }
      for (const f of files) {
        const doc = readJson(path.join(dir, f));
        if (!validate(doc)) failures.push(`${examplesRelFor(rel)}/valid/${f}: no valida: ${fmt(validate.errors)}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test('cada ejemplo inválido es una mutación de un ejemplo válido y falla donde declara', () => {
    const failures = [];
    let count = 0;
    for (const { rel, id } of schemas) {
      const validate = ajv.getSchema(id);
      const dir = path.join(EXAMPLES_DIR, examplesRelFor(rel), 'invalid');
      for (const f of jsonFiles(dir)) {
        count += 1;
        const where = `${examplesRelFor(rel)}/invalid/${f}`;
        const m = readJson(path.join(dir, f));
        const extra = Object.keys(m).filter((k) => !['base', 'set', 'unset', 'expect'].includes(k));
        if (extra.length) failures.push(`${where}: claves desconocidas ${extra.join(', ')}`);
        if (typeof m.base !== 'string' || !/^\.\.\/valid\/[^/]+\.json$/.test(m.base)) {
          failures.push(`${where}: base debe ser "../valid/<archivo>.json"`);
          continue;
        }
        if (!m.expect || typeof m.expect.keyword !== 'string' || typeof m.expect.instancePath !== 'string') {
          failures.push(`${where}: expect debe tener keyword e instancePath`);
          continue;
        }
        if (Object.keys(m.set ?? {}).length === 0 && (m.unset ?? []).length === 0) {
          failures.push(`${where}: la mutación no cambia nada (ni set ni unset)`);
          continue;
        }
        const baseFile = path.join(dir, m.base);
        if (!fs.existsSync(baseFile)) {
          failures.push(`${where}: base ${m.base} no existe`);
          continue;
        }
        const base = readJson(baseFile);
        if (!validate(base)) {
          failures.push(`${where}: la base ${m.base} no valida, así que la mutación no prueba nada: ${fmt(validate.errors)}`);
          continue;
        }
        let doc;
        try {
          doc = applyMutation(base, m);
        } catch (error) {
          failures.push(`${where}: ${error.message}`);
          continue;
        }
        if (validate(doc)) {
          failures.push(`${where}: valida, y debía fallar con ${m.expect.keyword} en "${m.expect.instancePath}"`);
          continue;
        }
        const hit = validate.errors.some((e) => e.keyword === m.expect.keyword && e.instancePath === m.expect.instancePath);
        if (!hit) {
          failures.push(`${where}: falla, pero no con ${m.expect.keyword} en "${m.expect.instancePath}": ${fmt(validate.errors)}`);
        }
      }
    }
    assert.ok(count > 0, 'no hay ejemplos inválidos: la suite no probaría nada');
    assert.deepEqual(failures, []);
  });

  test('cada carpeta de examples/ corresponde a un schema (sin huérfanos)', () => {
    const failures = [];
    const known = new Set(schemas.map((s) => examplesRelFor(s.rel)));
    for (const d of listDirs(EXAMPLES_DIR)) {
      const leaf = d.split('/').at(-1);
      if (leaf === 'valid' || leaf === 'invalid') {
        const owner = d.split('/').slice(0, -1).join('/');
        if (!known.has(owner)) failures.push(`examples/${d}: no existe schemas/${owner}.schema.json`);
      }
    }
    for (const f of listFiles(EXAMPLES_DIR)) {
      const parts = f.split('/');
      const parent = parts.at(-2);
      if (parent !== 'valid' && parent !== 'invalid') failures.push(`examples/${f}: fuera de una carpeta valid/ o invalid/`);
      else if (!f.endsWith('.json')) failures.push(`examples/${f}: no es .json`);
    }
    assert.deepEqual(failures, []);
  });

  test('D-09: los mensajes de la central y la wallet son cerrados; los de ciudades, abiertos', () => {
    const failures = [];
    for (const { rel, id, schema } of schemas.filter((s) => s.rel.startsWith('amqp/'))) {
      const senders = schema['x-amqp']?.sender ?? [];
      const exRel = examplesRelFor(rel);
      if (senders.includes('central') || senders.includes('wallet')) {
        const dir = path.join(EXAMPLES_DIR, exRel, 'invalid');
        const expects = jsonFiles(dir).map((f) => readJson(path.join(dir, f)).expect ?? {});
        if (!expects.some((e) => e.keyword === 'unevaluatedProperties' && e.instancePath === '')) {
          failures.push(`${rel}: falta una mutación que espere unevaluatedProperties en "" (campo extra en la raíz)`);
        }
        if (!expects.some((e) => e.keyword === 'additionalProperties' && e.instancePath === '/data')) {
          failures.push(`${rel}: falta una mutación que espere additionalProperties en "/data" (campo extra en data)`);
        }
      }
      if (senders.includes('city')) {
        const dir = path.join(EXAMPLES_DIR, exRel, 'valid');
        const extras = jsonFiles(dir).filter((f) => f.endsWith('with-extra-fields.json'));
        if (extras.length === 0) failures.push(`${rel}: falta un ejemplo válido *with-extra-fields.json`);
        for (const f of extras) {
          const doc = readJson(path.join(dir, f));
          // Variante de ciudad: la que declara cityId (los schemas con dos variantes la separan así).
          const variants = schema.oneOf ? schema.oneOf : [schema];
          let rootProps;
          let dataProps;
          for (const v of variants) {
            const node = v.$ref ? resolveRef(v.$ref, id, byId).node : v;
            const props = declaredProperties(node, id, byId);
            if (!props.has('cityId')) continue;
            rootProps = props;
            dataProps = new Set();
            for (const d of props.get('data') ?? []) {
              for (const name of declaredProperties(d.node, d.id, byId).keys()) dataProps.add(name);
            }
          }
          if (!rootProps) {
            failures.push(`${rel}: ninguna variante declara cityId, pero x-amqp.sender incluye city`);
            continue;
          }
          if (!Object.keys(doc).some((k) => !rootProps.has(k))) failures.push(`${exRel}/valid/${f}: no trae una clave extra en la raíz`);
          if (!Object.keys(doc.data ?? {}).some((k) => !dataProps.has(k))) failures.push(`${exRel}/valid/${f}: no trae una clave extra en data`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });

  test('el validador resuelve cada schema por su $id', () => {
    const failures = schemas.filter((s) => typeof ajv.getSchema(SCHEMA_BASE + s.rel) !== 'function').map((s) => s.rel);
    assert.deepEqual(failures, []);
  });
});
