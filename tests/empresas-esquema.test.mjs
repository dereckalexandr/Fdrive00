// Guarda del esquema multiempresa: toda tabla de datos debe llevar «empresa_id». Si agregas una tabla nueva y se te olvida,
// esta prueba falla antes de que los datos de una automotora puedan mezclarse con los de otra.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const RAIZ = new URL("../", import.meta.url);
const sql = (f) => readFileSync(new URL(f, RAIZ), "utf8").replace(/\r\n/g, "\n");
const archivos = readdirSync(RAIZ).filter((f) => /^supabase.*\.sql$/.test(f));

// Tablas que NO son de una empresa: el registro de empresas mismo y la caché de patentes (datos públicos compartidos).
const GLOBALES = new Set(["empresas", "patentes_consultadas"]);

const migracion = sql("supabase-crm-empresas.sql");
const enMigracion = new Set([...(/tablas text\[\] := array\[([\s\S]*?)\];/.exec(migracion) || [])[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

function tablasDefinidas() {
  const out = new Map(); // tabla -> definición (texto entre paréntesis hasta «;»)
  for (const f of archivos) {
    if (f === "supabase-crm-empresas.sql") continue;
    const s = sql(f).replace(/^\s*--.*$/gm, "");
    for (const m of s.matchAll(/create table(?: if not exists)?\s+(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) out.set(m[1].toLowerCase(), { archivo: f, def: m[2] });
  }
  return out;
}

test("Toda tabla de datos tiene «empresa_id»: o la agrega la migración de empresas o la declara su propia definición", () => {
  const faltan = [];
  for (const [t, { archivo, def }] of tablasDefinidas()) {
    if (GLOBALES.has(t) || enMigracion.has(t)) continue;
    if (!/\bempresa_id\b/.test(def)) faltan.push(`${t} (${archivo})`);
  }
  assert.deepEqual(faltan, [], "Tabla nueva sin empresa_id: agrega `empresa_id uuid not null references empresas(id)` a su definición");
});

test("La migración no nombra tablas que no existen en ningún archivo SQL (un error de tipeo la haría fallar en producción)", () => {
  const definidas = new Set(tablasDefinidas().keys());
  const sobran = [...enMigracion].filter((t) => !definidas.has(t));
  assert.deepEqual(sobran, []);
});

test("La migración es repetible y no destruye nada", () => {
  assert.ok(!/\b(drop\s+(table|column)|truncate|delete\s+from)\b/i.test(migracion.replace(/^\s*--.*$/gm, "")), "solo agrega");
  assert.match(migracion, /add column if not exists empresa_id/);
  assert.match(migracion, /create table if not exists empresas/);
  assert.match(migracion, /on conflict \(id\) do nothing/);
  // El valor por defecto y la empresa inicial usan el mismo identificador.
  const ids = [...migracion.matchAll(/df000000-0000-4000-8000-000000000001/g)];
  assert.ok(ids.length >= 2);
});

test("El código de empresa tiene un formato seguro para el ingreso", () => {
  const re = /^[a-z0-9][a-z0-9_-]{1,39}$/;
  for (const ok of ["drivefuturo", "auto-sur", "pro1", "a_b"]) assert.ok(re.test(ok), ok);
  for (const mal of ["", "A", "Drive Futuro", "-x", "x".repeat(41), "dr/ive", "ñandu"]) assert.ok(!re.test(mal), mal);
  assert.match(migracion, /\^\[a-z0-9\]\[a-z0-9_-\]\{1,39\}\$/);
});
