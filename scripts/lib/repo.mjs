// Utilidades internas del repositorio, compartidas por las suites de test/ y por
// scripts/render-amqp-table.mjs. No se exportan en package.json: no son parte del contrato.
//
// Todo recorrido devuelve rutas en orden estable (comparación por unidades de código, sin
// locale), para que la salida de los tests y la tabla del README no cambien entre corridas ni
// entre sistemas de archivos.
//
// Los schemas se descubren recorriendo schemas/ completo, nunca a partir de
// index.schema.json: un schema nuevo queda compilado y con sus ejemplos verificados desde el
// commit que lo agrega, aunque todavía no esté enlazado desde la raíz.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_BASE } from '../../lib/validator.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SCHEMAS_DIR = path.join(ROOT, 'schemas');
export const EXAMPLES_DIR = path.join(ROOT, 'examples');

export const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Archivos bajo `dir` (recursivo) que cumplen `keep`, como rutas relativas a `dir` con `/`. */
export function listFiles(dir, keep = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (keep(entry.name)) out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort(byPath);
}

/** Directorios bajo `dir` (recursivo), relativos a `dir`. */
export function listDirs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(d, entry.name);
      out.push(path.relative(dir, full).split(path.sep).join('/'));
      walk(full);
    }
  };
  walk(dir);
  return out.sort(byPath);
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Todos los schemas: `{ rel, id, file, schema }`, con `rel` relativo a schemas/. */
export function loadSchemas() {
  return listFiles(SCHEMAS_DIR, (n) => n.endsWith('.schema.json')).map((rel) => {
    const file = path.join(SCHEMAS_DIR, rel);
    return { rel, id: SCHEMA_BASE + rel, file, schema: readJson(file) };
  });
}

/** Carpeta de ejemplos de un schema: examples/<ruta sin .schema.json>. */
export const examplesRelFor = (rel) => rel.replace(/\.schema\.json$/, '');

// ── JSON Pointer (RFC 6901) ──

export function parsePointer(pointer) {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`puntero JSON inválido: "${pointer}"`);
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getPointer(doc, pointer) {
  let cur = doc;
  for (const token of parsePointer(pointer)) {
    if (cur === null || typeof cur !== 'object' || !(token in cur)) return undefined;
    cur = cur[token];
  }
  return cur;
}

/**
 * Aplica una mutación `{ set, unset }` a una copia de `base`. `set` asigna valores (el puntero
 * `""` reemplaza el documento completo); `unset` borra claves que deben existir. Un puntero
 * cuyo padre no existe es un error del ejemplo, no una mutación silenciosa.
 */
export function applyMutation(base, { set = {}, unset = [] }) {
  let doc = structuredClone(base);
  for (const [pointer, value] of Object.entries(set)) {
    const tokens = parsePointer(pointer);
    if (tokens.length === 0) {
      doc = structuredClone(value);
      continue;
    }
    const parent = getPointer(doc, '/' + tokens.slice(0, -1).map(esc).join('/'));
    const target = tokens.length === 1 ? doc : parent;
    if (target === null || typeof target !== 'object') {
      throw new Error(`set ${pointer}: el padre no existe en el ejemplo base`);
    }
    target[tokens.at(-1)] = structuredClone(value);
  }
  for (const pointer of unset) {
    const tokens = parsePointer(pointer);
    if (tokens.length === 0) throw new Error('unset no acepta el puntero ""');
    const target = tokens.length === 1 ? doc : getPointer(doc, '/' + tokens.slice(0, -1).map(esc).join('/'));
    if (target === null || typeof target !== 'object' || !(tokens.at(-1) in target)) {
      throw new Error(`unset ${pointer}: la clave no existe en el ejemplo base`);
    }
    if (Array.isArray(target)) target.splice(Number(tokens.at(-1)), 1);
    else delete target[tokens.at(-1)];
  }
  return doc;
}

const esc = (t) => t.replace(/~/g, '~0').replace(/\//g, '~1');

// ── Resolución de $ref entre los schemas de este repositorio ──

/**
 * Resuelve un `$ref` relativo a `baseId` contra el mapa `byId` (id -> schema). Devuelve
 * `{ id, node }`, donde `id` es el `$id` del documento que contiene el nodo.
 */
export function resolveRef(ref, baseId, byId) {
  const url = new URL(ref, baseId);
  const fragment = decodeURIComponent(url.hash.replace(/^#/, ''));
  url.hash = '';
  const docId = url.href;
  const doc = byId.get(docId);
  if (!doc) throw new Error(`$ref sin destino: ${ref} (desde ${baseId})`);
  const node = getPointer(doc, fragment);
  if (node === undefined) throw new Error(`$ref con fragmento inexistente: ${ref} (desde ${baseId})`);
  return { id: docId, node };
}

/**
 * Nombres de propiedad que un schema declara en su nivel (siguiendo `$ref`, `allOf`, `anyOf`,
 * `oneOf`), y los schemas que cada nombre tiene asignados. Sirve para saber qué es una clave
 * "extra" en un ejemplo de un schema abierto.
 */
export function declaredProperties(node, baseId, byId, seen = new Set()) {
  const props = new Map();
  const visit = (n, id) => {
    if (!n || typeof n !== 'object') return;
    if (n.$ref) {
      const key = new URL(n.$ref, id).href;
      if (seen.has(key)) return;
      seen.add(key);
      const r = resolveRef(n.$ref, id, byId);
      visit(r.node, r.id);
    }
    for (const [name, sub] of Object.entries(n.properties ?? {})) {
      if (!props.has(name)) props.set(name, []);
      props.get(name).push({ node: sub, id });
    }
    for (const k of ['allOf', 'anyOf', 'oneOf']) for (const s of n[k] ?? []) visit(s, id);
  };
  visit(node, baseId);
  return props;
}
