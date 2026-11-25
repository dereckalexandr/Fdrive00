// Genera el token de acceso (refresh token) de Google Ads y lo guarda como secreto en Supabase, sin mostrarlo.
//
// Uso (en tu terminal, NO en el chat):
//   $env:GOOGLE_CLIENT_ID = "..."          (el ID de cliente OAuth del CRM)
//   $env:GOOGLE_CLIENT_SECRET = "..."      (su secreto; se pide con Read-Host -AsSecureString)
//   node scripts/google-ads-token.mjs
//
// Requisito: en el cliente OAuth «Aplicación web» debe estar registrada la URI de redireccionamiento
//   http://localhost:8765/oauth2callback
// Se abre la página de permisos de Google: entra con la cuenta que administra Google Ads y acepta.
import http from "node:http";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const REF = "lvcmstvcbbvltompunbr";
const PUERTO = 8765;
const REDIRECT = `http://localhost:${PUERTO}/oauth2callback`;
const id = process.env.GOOGLE_CLIENT_ID;
const secreto = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secreto) { console.error("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el entorno."); process.exit(1); }

const estado = randomBytes(16).toString("hex");
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: id, redirect_uri: REDIRECT, response_type: "code", scope: "https://www.googleapis.com/auth/adwords",
  access_type: "offline", prompt: "consent", state: estado,
}).toString();

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PUERTO}`);
  if (u.pathname !== "/oauth2callback") { res.writeHead(404).end(); return; }
  const fin = (msg, code = 0) => { res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(msg); srv.close(); setTimeout(() => process.exit(code), 300); };
  if (u.searchParams.get("state") !== estado) return fin("Estado inválido: vuelve a ejecutar el script.", 1);
  if (u.searchParams.get("error")) return fin(`Google respondió: ${u.searchParams.get("error")}`, 1);
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: u.searchParams.get("code"), client_id: id, client_secret: secreto, redirect_uri: REDIRECT, grant_type: "authorization_code" }).toString(),
    });
    const j = await r.json();
    if (!j.refresh_token) return fin(`No llegó el token de acceso (${j.error || r.status}${j.error_description ? ": " + j.error_description : ""}). Revisa la URI de redireccionamiento y vuelve a intentar.`, 1);
    const s = spawnSync("npx.cmd", ["supabase", "secrets", "set", `GOOGLE_ADS_REFRESH_TOKEN=${j.refresh_token}`, "--project-ref", REF], { stdio: ["ignore", "ignore", "inherit"], shell: true });
    if (s.status !== 0) return fin("Obtuve el token pero no pude guardarlo en Supabase (¿hiciste el login con el token de Supabase?).", 1);
    console.log("Listo: GOOGLE_ADS_REFRESH_TOKEN guardado en Supabase.");
    fin("Listo. Ya puedes cerrar esta pestaña y volver a la terminal.");
  } catch (e) { fin(`Error: ${e.message}`, 1); }
});
srv.listen(PUERTO, () => {
  console.log("Abre este enlace en el navegador, entra con la cuenta que administra Google Ads y acepta los permisos:\n");
  console.log(url + "\n");
  console.log("(Si aparece «Google no ha verificado esta app», pulsa Avanzado → Ir a ... (no seguro): es tu propia app.)");
});
