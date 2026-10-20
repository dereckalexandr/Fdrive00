// Respaldo de TODOS los datos del CRM (todas las tablas del esquema público) a una carpeta de este computador.
//
// Requiere haber iniciado sesión: npx supabase login --token <tu token>   (el mismo del despliegue)
// Uso:   node scripts/respaldo.mjs            -> crea respaldos/AAAA-MM-DD_HHMM/ y conserva los 8 últimos
//        node scripts/respaldo.mjs --conservar=20
//
// Cada tabla queda en un archivo .jsonl (una fila por línea) y manifest.json cuenta cuántas filas tiene cada una, para comprobar
// que no falta nada. La carpeta respaldos/ NO se sube a git ni a internet: contiene datos personales, guárdala como tal.
// Al terminar queda un registro «respaldo.realizado» en la bitácora, que el panel del Administrador (pestaña Estado) muestra.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = "lvcmstvcbbvltompunbr";
const conservar = Math.max(1, parseInt((process.argv.find((a) => a.startsWith("--conservar=")) || "").split("=")[1], 10) || 8);
const tmp = mkdtempSync(join(tmpdir(), "df-respaldo-"));
let n = 0;

/** Ejecuta SQL contra el proyecto y devuelve las filas (con reintentos: cada consulta crea un acceso temporal y a veces falla). Nunca imprime datos. */
function consulta(sql) {
  const archivo = join(tmp, `q${++n}.sql`);
  writeFileSync(archivo, sql);
  let ultimo = "";
  for (let intento = 1; intento <= 4; intento++) {
    const r = spawnSync("npx", ["supabase", "db", "query", "--linked", "-f", `"${archivo}"`], { shell: true, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
    const ini = r.stdout ? r.stdout.indexOf("{") : -1;
    if (r.status === 0 && ini >= 0) {
      try {
        const out = JSON.parse(r.stdout.slice(ini));
        if (Array.isArray(out.rows)) return out.rows;
      } catch { /* se reintenta */ }
    }
    ultimo = ((r.stderr || "") + (r.stdout || "").slice(0, 300)).replace(/\s+/g, " ").trim().slice(-300);
    spawnSync("node", ["-e", "setTimeout(()=>{},4000)"], { shell: true });
  }
  throw new Error(`La consulta falló: ${ultimo}`);
}

const SALTO = String.fromCharCode(10);
const ident = (t) => `"${String(t).replace(/"/g, '""')}"`;
const sello = new Date().toLocaleString("sv-SE", { timeZone: "America/Santiago" }).replace(" ", "_").replace(/:/g, "").slice(0, 15);
const raiz = join(process.cwd(), "respaldos");
const carpeta = join(raiz, sello);

try {
  // Asegura que la carpeta esté vinculada al proyecto (si ya lo está, no cambia nada).
  const l = spawnSync("npx", ["supabase", "link", "--project-ref", PROJECT_REF], { shell: true, encoding: "utf8" });
  if (l.status !== 0) throw new Error("No se pudo vincular el proyecto. ¿Iniciaste sesión con `npx supabase login --token ...`?");

  const tablas = consulta("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1").map((x) => x.t);
  if (tablas.length === 0) throw new Error("No se encontraron tablas.");
  mkdirSync(carpeta, { recursive: true });
  console.log(`Respaldando ${tablas.length} tablas en ${carpeta}`);

  const manifiesto = { fecha: new Date().toISOString(), proyecto: PROJECT_REF, tablas: {} };
  let total = 0;
  let incompleto = false;
  const anotar = (t, escritas, esperadas) => {
    manifiesto.tablas[t] = { filas: escritas, esperadas };
    total += escritas;
    if (escritas < esperadas) incompleto = true;
    console.log(`  ${t}: ${escritas} filas (${escritas === esperadas ? "ok" : `OJO: esperadas ${esperadas}`})`);
  };

  // Todas las tablas menos el almacén: una sola consulta (cada consulta tarda varios segundos en abrir su acceso).
  const normales = tablas.filter((t) => t !== "kv_store");
  const pedido = normales.map((t) => `'${t.replace(/'/g, "''")}', jsonb_build_object('n', (select count(*) from public.${ident(t)}), 'filas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.${ident(t)} x))`).join(", ");
  if (normales.length) {
    const datos = consulta(`select jsonb_build_object(${pedido}) as r`)[0].r;
    for (const t of normales) {
      const { n: esperadas, filas } = datos[t];
      writeFileSync(join(carpeta, `${t}.jsonl`), filas.map((f) => JSON.stringify(f)).join(SALTO) + (filas.length ? SALTO : ""));
      anotar(t, filas.length, Number(esperadas));
    }
  }

  // El almacén guarda fotos y fichas de varios MB por fila: se lee en grupos de a lo más ~20 MB.
  if (tablas.includes("kv_store")) {
    const medidas = consulta("select key, length(value)::bigint as n from public.kv_store order by key");
    const archivo = join(carpeta, "kv_store.jsonl");
    writeFileSync(archivo, "");
    let escritas = 0;
    let grupo = [];
    let peso = 0;
    const volcar = () => {
      if (grupo.length === 0) return;
      const lista = grupo.map((k) => `'${k.replace(/'/g, "''")}'`).join(", ");
      const filas = consulta(`select to_jsonb(x) as r from public.kv_store x where key in (${lista})`);
      appendFileSync(archivo, filas.map((f) => JSON.stringify(f.r)).join(SALTO) + SALTO);
      escritas += filas.length;
      grupo = []; peso = 0;
    };
    for (const m of medidas) {
      const tam = Number(m.n) || 0;
      if (grupo.length > 0 && peso + tam > 20 * 1024 * 1024) volcar();
      grupo.push(m.key); peso += tam;
    }
    volcar();
    anotar("kv_store", escritas, medidas.length);
  }
  writeFileSync(join(carpeta, "manifest.json"), JSON.stringify(manifiesto, null, 2));

  if (incompleto) {
    console.error("\nEl respaldo quedó INCOMPLETO en alguna tabla (arriba, las marcadas con OJO). Vuelve a ejecutarlo; no se registró como realizado.");
    process.exitCode = 1;
  } else {
    const det = JSON.stringify({ filas: total, tablas: tablas.length, carpeta: sello }).replace(/'/g, "''");
    consulta(`insert into public.bitacora (actor_tipo, actor_nombre, accion, entidad, detalle) values ('sistema', 'Respaldo', 'respaldo.realizado', 'sistema', '${det}'::jsonb) returning 1 as ok`);
    console.log(`\nRespaldo completo: ${total} filas en ${tablas.length} tablas.`);
    // Rotación: se borran solo carpetas con nombre de respaldo, dentro de respaldos/, y solo las más antiguas.
    const previas = readdirSync(raiz).filter((d) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d) && statSync(join(raiz, d)).isDirectory()).sort();
    for (const vieja of previas.slice(0, Math.max(0, previas.length - conservar))) {
      rmSync(join(raiz, vieja), { recursive: true, force: true });
      console.log(`  (se eliminó el respaldo antiguo ${vieja}; se conservan ${conservar})`);
    }
  }
} catch (e) {
  console.error(`\nNo se pudo completar el respaldo: ${e.message}`);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
