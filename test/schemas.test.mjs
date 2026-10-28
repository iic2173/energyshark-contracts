// Qué prueba: que cada archivo de schemas/ es un schema 2020-12 bien identificado (su `$id`
// es la base más su ruta), con un título PascalCase único (los títulos se vuelven nombres de
// tipo en quien genere código) y una descripción, sin `multipleOf` (el dinero se declara con
// `x-decimals`, D-10), sin una propiedad `user_id` (es una propiedad AMQP del publish, no un
// campo del cuerpo), y que compila en el validador estricto que los equipos importan. Además,
// que cada schema de amqp/ declara `x-amqp` con su vocabulario cerrado.
//
// Qué no prueba: que los ejemplos validen (test/examples.test.mjs) ni que la raíz enlace cada
// mensaje (test/amqp.test.mjs).
//
// Los schemas se descubren recorriendo schemas/ completo (scripts/lib/repo.mjs), no desde
// index.schema.json. Cada prueba junta todas las fallas antes de afirmar, para mostrarlas juntas.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createValidator, SCHEMA_BASE } from '../lib/validator.mjs';
import { loadSchemas } from '../scripts/lib/repo.mjs';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const schemas = loadSchemas();

/** Recorre todos los nodos objeto de un JSON, con su puntero. */
function walk(node, visit, pointer = '') {
  if (!node || typeof node !== 'object') return;
  visit(node, pointer);
  for (const [k, v] of Object.entries(node)) walk(v, visit, `${pointer}/${k}`);
}

describe('schemas/', () => {
  test('hay schemas que revisar', () => {
    assert.ok(schemas.length > 0, 'schemas/ está vacío: la suite no probaría nada');
  });

  test('cada schema declara el dialecto 2020-12, su $id, un título y una descripción', () => {
    const failures = [];
    for (const { rel, id, schema } of schemas) {
      if (schema.$schema !== DIALECT) failures.push(`${rel}: $schema es ${schema.$schema}, se espera ${DIALECT}`);
      if (schema.$id !== id) failures.push(`${rel}: $id es ${schema.$id}, se espera ${id}`);
      if (typeof schema.title !== 'string' || !PASCAL.test(schema.title)) {
        failures.push(`${rel}: el título raíz "${schema.title}" no es PascalCase`);
      }
      if (typeof schema.description !== 'string' || schema.description.trim() === '') {
        failures.push(`${rel}: sin descripción raíz`);
      }
      for (const [name, def] of Object.entries(schema.$defs ?? {})) {
        if (def && typeof def.title === 'string' && !PASCAL.test(def.title)) {
          failures.push(`${rel}#/$defs/${name}: el título "${def.title}" no es PascalCase`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });

  test('los títulos son únicos en todo el repositorio y ninguno se llama Error', () => {
    const seen = new Map();
    const failures = [];
    for (const { rel, schema } of schemas) {
      walk(schema, (node, pointer) => {
        if (typeof node.title !== 'string') return;
        const where = `${rel}#${pointer}`;
        if (node.title === 'Error') failures.push(`${where}: "Error" ocultaría el tipo global; usen ErrorMessage`);
        if (seen.has(node.title)) failures.push(`${where}: título "${node.title}" repetido (también en ${seen.get(node.title)})`);
        else seen.set(node.title, where);
      });
    }
    assert.deepEqual(failures, []);
  });

  test('ningún schema usa multipleOf ni declara una propiedad user_id', () => {
    const failures = [];
    for (const { rel, schema } of schemas) {
      walk(schema, (node, pointer) => {
        if ('multipleOf' in node && typeof node.multipleOf === 'number') {
          failures.push(`${rel}#${pointer}: multipleOf (D-10: usen x-decimals)`);
        }
        if (node.properties && typeof node.properties === 'object' && 'user_id' in node.properties) {
          failures.push(`${rel}#${pointer}/properties/user_id: user_id es una propiedad AMQP, no un campo del cuerpo`);
        }
      });
    }
    assert.deepEqual(failures, []);
  });

  test('cada schema compila en createValidator() estricto', () => {
    const ajv = createValidator();
    const failures = [];
    for (const { rel } of schemas) {
      try {
        if (typeof ajv.getSchema(SCHEMA_BASE + rel) !== 'function') failures.push(`${rel}: no quedó registrado`);
      } catch (error) {
        failures.push(`${rel}: ${error.message}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test('cada schema de amqp/ declara x-amqp con las cinco claves y su vocabulario', () => {
    const failures = [];
    const amqp = schemas.filter((s) => s.rel.startsWith('amqp/'));
    if (amqp.length === 0) failures.push('no hay schemas en amqp/');
    for (const { rel, schema } of amqp) {
      const x = schema['x-amqp'];
      if (!x || typeof x !== 'object') {
        failures.push(`${rel}: sin x-amqp`);
        continue;
      }
      const keys = Object.keys(x).sort();
      const want = ['exchange', 'receivers', 'routingKey', 'sender', 'userId'];
      if (JSON.stringify(keys) !== JSON.stringify(want)) failures.push(`${rel}: x-amqp tiene ${keys.join(',')}, se espera ${want.join(',')}`);
      if (!['energy.x', 'market'].includes(x.exchange)) failures.push(`${rel}: x-amqp.exchange "${x.exchange}" no es energy.x ni market`);
      if (typeof x.routingKey !== 'string' || x.routingKey === '') failures.push(`${rel}: x-amqp.routingKey vacío`);
      if (!Array.isArray(x.sender) || x.sender.length === 0 || x.sender.some((s) => !['central', 'wallet', 'city'].includes(s))) {
        failures.push(`${rel}: x-amqp.sender debe ser un arreglo no vacío de central|wallet|city`);
      }
      if (!Array.isArray(x.receivers) || x.receivers.length === 0 || x.receivers.some((r) => typeof r !== 'string' || r === '')) {
        failures.push(`${rel}: x-amqp.receivers debe ser un arreglo no vacío de patrones de cola`);
      }
      if (!['required', 'central', 'none'].includes(x.userId)) failures.push(`${rel}: x-amqp.userId "${x.userId}" no es required, central ni none`);
      // Mecánica §2 (C23): lo que la central y la wallet publican en `city.{CODE}` llega con
      // `user_id` `central`; sólo `market-closed`, por `market`, viaja sin él.
      if (x.userId === 'central' && x.sender.includes('city')) failures.push(`${rel}: x-amqp.userId central en un mensaje que envía una ciudad`);
    }
    assert.deepEqual(failures, []);
  });
});
