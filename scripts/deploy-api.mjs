// Despliega la Edge Function "api" y carga sus secretos no sensibles.
// Requiere haber iniciado sesión: npx supabase login --token <tu token>
// Uso:  node scripts/deploy-api.mjs
// - SESSION_SECRET: se genera al azar solo si todavía no existe (rotarlo cierra todas las sesiones).
// - ADMIN_EMAIL: correo del administrador maestro (público, no es un secreto real).
// La clave maestra se define aparte con scripts/set-admin-password.mjs
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = "lvcmstvcbbvltompunbr";
const ADMIN_EMAIL = "dereckrodriguez.b@gmail.com";

const run = (args, opts = {}) =>
  spawnSync("npx", ["supabase", ...args], { shell: true, encoding: "utf8", ...opts });

// ¿Ya existe SESSION_SECRET?
const list = run(["secrets", "list", "--project-ref", PROJECT_REF]);
if (list.status !== 0) {
  console.error(list.stdout + list.stderr);
  console.error("\nNo se pudo listar los secretos. ¿Iniciaste sesión con `npx supabase login --token ...`?");
  process.exit(1);
}
const hasSession = /SESSION_SECRET/.test(list.stdout);

const lines = [`ADMIN_EMAIL=${ADMIN_EMAIL}`];
if (!hasSession) lines.push(`SESSION_SECRET=${randomBytes(48).toString("base64")}`);

const dir = mkdtempSync(join(tmpdir(), "df-"));
const file = join(dir, "secrets.env");
try {
  writeFileSync(file, lines.join("\n") + "\n");
  const s = run(["secrets", "set", "--env-file", file, "--project-ref", PROJECT_REF], { stdio: "inherit" });
  if (s.status !== 0) process.exit(s.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(hasSession ? "SESSION_SECRET ya existía: se conserva." : "SESSION_SECRET generado.");

const d = run(["functions", "deploy", "api", "--project-ref", PROJECT_REF, "--no-verify-jwt", "--use-api"], { stdio: "inherit" });
if (d.status !== 0) process.exit(d.status ?? 1);
console.log("\nFunción desplegada: https://" + PROJECT_REF + ".supabase.co/functions/v1/api");
