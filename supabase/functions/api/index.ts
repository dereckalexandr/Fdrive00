// Puerta de entrada de Drive Futuro.
//
// El navegador ya NO accede a la tabla kv_store. Todo pasa por esta función,
// que usa la service_role (solo existe aquí, en el servidor) y decide qué
// puede leer o escribir cada sesión:
//   admin      -> todo, salvo la clave interna "admin_auth"
//   vendor     -> record::<id>::*  (lectura/escritura), afp_config y uf_valor (solo lectura)
//   inspector  -> inspeccion::<id>::* y tasacion::<id>::* (lectura/escritura),
//                 afp_config y uf_valor (solo lectura)
//
// Secretos requeridos (supabase secrets set ...):
//   SESSION_SECRET        cadena aleatoria larga para firmar sesiones
//   ADMIN_EMAIL           correo del administrador maestro
//   ADMIN_PASSWORD_HASH   hash PBKDF2 de la clave maestra (scripts/set-admin-password.mjs)
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const TABLE = "kv_store";
const SESSION_SECRET = Deno.env.get("SESSION_SECRET") ?? "";
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") ?? "").trim().toLowerCase();
const ADMIN_PASSWORD_HASH = Deno.env.get("ADMIN_PASSWORD_HASH") ?? "";

const ADMIN_TTL_S = 60 * 60 * 12;
const PROFILE_TTL_S = 60 * 60 * 8;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PBKDF2_ITER = 150_000;
const READ_ONLY_SHARED = new Set(["afp_config", "uf_valor"]);

const enc = new TextEncoder();

/* ---------- utilidades ---------- */
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

function safeEqual(a: Uint8Array, b: Uint8Array) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(secret: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

async function hashSecret(secret: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(secret, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
}

async function verifySecret(secret: string, stored: string) {
  const [alg, iter, salt, hash] = (stored || "").split("$");
  if (alg !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(secret, unb64(salt), parseInt(iter, 10));
  return safeEqual(got, unb64(hash));
}

async function hmacKey() {
  return crypto.subtle.importKey("raw", enc.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

type Session = { role: "admin" | "vendor" | "inspector"; id: string; exp: number };

async function signSession(role: Session["role"], id: string, ttl: number) {
  const body = b64url(enc.encode(JSON.stringify({ role, id, exp: Math.floor(Date.now() / 1000) + ttl })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

async function readSession(token: unknown): Promise<Session | null> {
  if (typeof token !== "string" || !SESSION_SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(body))) as Session;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

function genRecoveryCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(rnd, (n) => chars[n % chars.length]).join("");
  return raw.match(/.{1,4}/g)!.join("-");
}

const validAdminPassword = (pw: unknown) =>
  typeof pw === "string" && /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/.test(pw);

/* ---------- limitador de intentos (por instancia, mejor esfuerzo) ---------- */
const attempts = new Map<string, { n: number; reset: number }>();
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function blocked(ip: string, bucket: string) {
  const a = attempts.get(`${bucket}:${ip}`);
  return !!a && a.reset > Date.now() && a.n >= MAX_FAILS;
}
async function fail(ip: string, bucket: string) {
  const k = `${bucket}:${ip}`;
  const a = attempts.get(k);
  if (!a || a.reset < Date.now()) attempts.set(k, { n: 1, reset: Date.now() + WINDOW_MS });
  else a.n++;
  await new Promise((r) => setTimeout(r, 400));
}

/* ---------- acceso a datos ---------- */
async function dbGet(key: string): Promise<string | null> {
  const { data, error } = await sb.from(TABLE).select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? (data.value as string) : null;
}
async function dbSet(key: string, value: string, shared = true) {
  const { error } = await sb.from(TABLE).upsert({ key, value, shared, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
async function dbJsonList(key: string): Promise<any[]> {
  try {
    const v = await dbGet(key);
    const parsed = v ? JSON.parse(v) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ownPrefixes(s: Session): string[] {
  if (s.role === "vendor") return [`record::${s.id}::`];
  if (s.role === "inspector") return [`inspeccion::${s.id}::`, `tasacion::${s.id}::`];
  return [];
}

function canKv(s: Session, op: string, key: string): boolean {
  if (key === "admin_auth") return false; // solo uso interno de esta función
  if (s.role === "admin") return true;
  if ((op === "get") && READ_ONLY_SHARED.has(key)) return true;
  if (op === "get" || op === "set") return ownPrefixes(s).some((p) => key.startsWith(p));
  return false;
}

function canList(s: Session, prefix: string): boolean {
  if (s.role === "admin") return true;
  return ownPrefixes(s).some((p) => prefix.startsWith(p));
}

/* ---------- HTTP ---------- */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function adminAuthRecord() {
  try {
    const v = await dbGet("admin_auth");
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

async function masterOk(email: unknown, password: unknown) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return false;
  if (typeof email !== "string" || typeof password !== "string") return false;
  const emailOk = email.trim().toLowerCase() === ADMIN_EMAIL;
  const pwOk = await verifySecret(password, ADMIN_PASSWORD_HASH); // siempre se calcula (tiempo constante)
  return emailOk && pwOk;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!SESSION_SECRET) return json({ error: "server_not_configured" }, 500);

  const len = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (len > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const action = body?.action;

  try {
    /* ----- autenticación ----- */
    if (action === "adminStatus") {
      return json({ hasExtra: !!(await adminAuthRecord()) });
    }

    if (action === "adminLogin") {
      if (blocked(ip, "admin")) return json({ error: "too_many_attempts" }, 429);
      const { email, password } = body;
      if (await masterOk(email, password)) return json({ token: await signSession("admin", "master", ADMIN_TTL_S) });
      const rec = await adminAuthRecord();
      if (rec && typeof email === "string" && typeof password === "string") {
        const emailOk = email.trim().toLowerCase() === String(rec.email ?? "").toLowerCase();
        const pwOk = await verifySecret(password, rec.passwordHash);
        if (emailOk && pwOk) return json({ token: await signSession("admin", "extra", ADMIN_TTL_S) });
      }
      await fail(ip, "admin");
      return json({ error: "invalid_credentials" }, 401);
    }

    if (action === "adminSetup") {
      // Crear/cambiar la clave adicional exige la clave maestra.
      if (blocked(ip, "admin")) return json({ error: "too_many_attempts" }, 429);
      if (!(await masterOk(body.masterEmail, body.masterPassword))) {
        await fail(ip, "admin");
        return json({ error: "invalid_credentials" }, 401);
      }
      const email = String(body.email ?? "").trim();
      if (!email.includes("@") || !validAdminPassword(body.password)) return json({ error: "invalid_input" }, 400);
      const code = genRecoveryCode();
      await dbSet("admin_auth", JSON.stringify({
        email,
        passwordHash: await hashSecret(body.password),
        recoveryHash: await hashSecret(code),
        updatedAt: new Date().toISOString(),
      }));
      return json({ recoveryCode: code });
    }

    if (action === "adminRecoverCheck" || action === "adminReset") {
      if (blocked(ip, "recover")) return json({ error: "too_many_attempts" }, 429);
      const rec = await adminAuthRecord();
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!rec || !code || !(await verifySecret(code, rec.recoveryHash))) {
        await fail(ip, "recover");
        return json({ error: "invalid_code" }, 401);
      }
      if (action === "adminRecoverCheck") return json({ ok: true });
      if (!validAdminPassword(body.newPassword)) return json({ error: "invalid_input" }, 400);
      const next = genRecoveryCode();
      await dbSet("admin_auth", JSON.stringify({
        email: rec.email,
        passwordHash: await hashSecret(body.newPassword),
        recoveryHash: await hashSecret(next),
        updatedAt: new Date().toISOString(),
      }));
      return json({ recoveryCode: next });
    }

    if (action === "profileLogin") {
      if (blocked(ip, "profile")) return json({ error: "too_many_attempts" }, 429);
      const role = body.role === "inspector" ? "inspector" : body.role === "vendor" ? "vendor" : null;
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!role || !code) return json({ error: "invalid_input" }, 400);
      const list = await dbJsonList(role === "vendor" ? "vendors" : "inspectors");
      const profile = list.find((p) => String(p?.id ?? "").toUpperCase() === code);
      if (!profile) {
        await fail(ip, "profile");
        return json({ error: "invalid_code" }, 401);
      }
      return json({ token: await signSession(role, profile.id, PROFILE_TTL_S), profile });
    }

    /* ----- almacenamiento ----- */
    if (action === "kv") {
      const s = await readSession(body.token);
      if (!s) return json({ error: "unauthorized" }, 401);
      const op = body.op;

      if (op === "list") {
        const prefix = String(body.prefix ?? "");
        if (!canList(s, prefix)) return json({ error: "forbidden" }, 403);
        const esc = prefix.replace(/[\\%_]/g, (m) => `\\${m}`);
        const { data, error } = await sb.from(TABLE).select("key").like("key", `${esc}%`);
        if (error) throw error;
        const keys = (data ?? []).map((r: any) => r.key).filter((k: string) => k !== "admin_auth");
        return json({ keys });
      }

      const key = String(body.key ?? "");
      if (!key || key.length > 300 || !canKv(s, op, key)) return json({ error: "forbidden" }, 403);

      if (op === "get") {
        const value = await dbGet(key);
        return json({ value });
      }
      if (op === "set") {
        if (typeof body.value !== "string") return json({ error: "invalid_input" }, 400);
        await dbSet(key, body.value);
        return json({ ok: true });
      }
      if (op === "delete") {
        const { error } = await sb.from(TABLE).delete().eq("key", key);
        if (error) throw error;
        return json({ ok: true });
      }
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("api error:", e);
    return json({ error: "server_error" }, 500);
  }
});
