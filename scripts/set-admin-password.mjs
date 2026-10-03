// Define la clave maestra del administrador SIN que pase por el código ni por el chat.
// Pide la clave (oculta), calcula su hash PBKDF2 y sube solo el hash como secreto de
// Supabase (ADMIN_PASSWORD_HASH). Uso:  node scripts/set-admin-password.mjs
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const PROJECT_REF = "lvcmstvcbbvltompunbr";
const ITER = 150_000; // debe coincidir con PBKDF2_ITER de supabase/functions/api/index.ts

// Lee una línea sin mostrarla (modo raw: no se imprime ningún carácter).
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    let buf = "";
    const onKey = (str, key) => {
      if (key && key.ctrl && key.name === "c") { process.stdout.write("\n"); process.exit(130); }
      if (key && (key.name === "return" || key.name === "enter")) {
        process.stdin.removeListener("keypress", onKey);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        return resolve(buf);
      }
      if (key && key.name === "backspace") { buf = buf.slice(0, -1); return; }
      if (str && !(key && (key.ctrl || key.meta))) buf += str;
    };
    process.stdin.on("keypress", onKey);
  });
}

console.log("Usa una clave NUEVA: la anterior estuvo en un repo público y está comprometida.");
const pw1 = await askHidden("Nueva clave maestra (mín. 12 caracteres): ");
const pw2 = await askHidden("Repite la clave: ");
if (pw1 !== pw2) { console.error("Las claves no coinciden."); process.exit(1); }
if (pw1.length < 12) { console.error("Usa al menos 12 caracteres."); process.exit(1); }

const salt = randomBytes(16);
const hash = pbkdf2Sync(pw1, salt, ITER, 32, "sha256");
const value = `pbkdf2$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;

const dir = mkdtempSync(join(tmpdir(), "df-"));
const file = join(dir, "secrets.env");
writeFileSync(file, `ADMIN_PASSWORD_HASH=${value}\n`);
try {
  const r = spawnSync("npx", ["supabase", "secrets", "set", "--env-file", file, "--project-ref", PROJECT_REF], {
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log("\nListo: la nueva clave maestra quedó activa (solo se guardó su hash).");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
