// Validador de referencia de los contratos EnergyShark (protocolo v3).
//
// Uso:
//   import { createValidator, SCHEMA_BASE } from '@iic2173/energyshark-contracts/validator';
//   const ajv = createValidator();
//   const validate = ajv.getSchema(SCHEMA_BASE + 'amqp/distance-table.schema.json');
//   if (!validate(mensaje)) console.log(validate.errors);
//
// Por qué existe este archivo y no basta con `new Ajv()`:
//
// - Los schemas son JSON Schema 2020-12. Hay que usar `ajv/dist/2020.js`: un validador
//   draft-07 ignora `unevaluatedProperties` sin avisar, y los mensajes que emite la central
//   quedan más permisivos de lo que el contrato dice.
// - Los schemas llevan anotaciones propias (`x-amqp`, `x-decimals`, `x-emitter`, `x-code`,
//   `x-carriers`, `x-emitters`). Ajv en modo estricto (el modo por defecto) lanza
//   `strict mode: unknown keyword` ante cualquier palabra clave que no conozca, así que aquí se
//   registran como anotaciones: no validan nada, sólo documentan. Si usan otro validador,
//   regístrenlas igual o desactiven el modo estricto.
// - `ajv-formats` aporta `uuid` y `date-time`, que el envelope de la E1 exige.
//
// Este validador no habla con la central: valida cualquier mensaje con los archivos de este
// repositorio y nada más.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Base de todos los `$id`. Es sólo un identificador (no se descarga nada desde ahí) y lleva
 * la versión mayor del protocolo, de modo que los tags menores y de parche no cambian ids. */
export const SCHEMA_BASE = 'https://contracts.iic2173.org/energyshark/v3/';

const DEFAULT_SCHEMAS_DIR = fileURLToPath(new URL('../schemas/', import.meta.url));

/** Anotaciones propias de este repositorio y el tipo JSON de su valor. */
const ANNOTATIONS = [
  ['x-amqp', 'object'],
  ['x-decimals', 'number'],
  ['x-emitter', 'string'],
  ['x-code', 'number'],
  ['x-carriers', 'array'],
  ['x-emitters', 'array'],
];

/** Lista recursiva de `*.schema.json`, en orden de ruta estable (no depende del sistema de
 * archivos ni del locale). */
function listSchemaFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.schema.json')) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Crea una instancia de Ajv 2020-12 con todos los schemas del repositorio cargados.
 *
 * @param {{ schemasDir?: string, strict?: boolean }} [options]
 *   `schemasDir`: carpeta de schemas (por defecto, la de este paquete).
 *   `strict`: modo estricto de Ajv (por defecto `true`, el que usa el CI de este repositorio).
 * @returns {import('ajv/dist/2020.js').default} la instancia; obtengan cada validador con
 *   `ajv.getSchema(SCHEMA_BASE + '<ruta bajo schemas/>')`.
 */
export function createValidator({ schemasDir = DEFAULT_SCHEMAS_DIR, strict = true } = {}) {
  const ajv = new Ajv2020({ strict, allErrors: true });
  addFormats(ajv);
  for (const [keyword, schemaType] of ANNOTATIONS) ajv.addKeyword({ keyword, schemaType });
  for (const file of listSchemaFiles(schemasDir)) {
    ajv.addSchema(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return ajv;
}
