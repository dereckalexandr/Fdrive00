/**
 * ALMACENAMIENTO REAL CON SUPABASE (vía Edge Function)
 * ----------------------------------------------------------------
 * El navegador YA NO accede a la tabla kv_store directamente (el acceso
 * anónimo está bloqueado por RLS). Todo pasa por la Edge Function "api"
 * (supabase/functions/api), que valida la sesión y decide qué puede leer
 * o escribir cada perfil.
 *
 * Mantiene la misma "forma" de API que espera App.jsx
 * (`window.storage.get/set/list/delete`) y agrega `window.auth` con las
 * operaciones de inicio de sesión. La sesión vive solo en memoria: al
 * recargar la página hay que volver a ingresar.
 * ----------------------------------------------------------------
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

let sessionToken = null;

async function call(payload) {
  const res = await fetch(`${supabaseUrl}/functions/v1/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
    body: JSON.stringify(payload),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Último ingreso por código (ejecutivo/inspector). El código ES la credencial, así que si la
// sesión vence (8 h) se reingresa en silencio y se reintenta una vez, sin perder lo que el
// usuario tiene en pantalla. Para el administrador no hay reingreso automático: se avisa.
let lastProfileLogin = null;

async function kv(op, extra, retry = true) {
  try {
    return await call({ action: "kv", token: sessionToken, op, ...extra });
  } catch (e) {
    if (e.status === 401 && retry) {
      if (lastProfileLogin) {
        try {
          await supabaseAuth.profileLogin(lastProfileLogin.role, lastProfileLogin.code);
          return await kv(op, extra, false);
        } catch (e2) { /* sigue abajo: se avisa que la sesión venció */ }
      }
      window.dispatchEvent(new Event("df-session-expired"));
    }
    throw e;
  }
}

const supabaseStorage = {
  async get(key, shared = false) {
    try {
      const { value } = await kv("get", { key });
      if (value === null || value === undefined) return null;
      return { key, value, shared };
    } catch (e) {
      console.error("storage.get error:", e.message);
      return null;
    }
  },

  async set(key, value, shared = false) {
    try {
      await kv("set", { key, value });
      return { key, value, shared };
    } catch (e) {
      console.error("storage.set error:", e.message);
      return null;
    }
  },

  async delete(key, shared = false) {
    try {
      await kv("delete", { key });
      return { key, deleted: true, shared };
    } catch (e) {
      console.error("storage.delete error:", e.message);
      return null;
    }
  },

  async list(prefix = "", shared = false) {
    try {
      const { keys } = await kv("list", { prefix });
      return { keys, prefix, shared };
    } catch (e) {
      console.error("storage.list error:", e.message);
      return null;
    }
  },
};

// Operaciones de autenticación. Las que fallan lanzan Error con `message`
// = código del servidor (invalid_credentials, invalid_code, too_many_attempts…).
const supabaseAuth = {
  async adminStatus() {
    try { return (await call({ action: "adminStatus" })).hasExtra; } catch (e) { return false; }
  },
  async adminLogin(email, password) {
    const { token } = await call({ action: "adminLogin", email, password });
    sessionToken = token;
  },
  async adminSetup({ masterEmail, masterPassword, email, password }) {
    return (await call({ action: "adminSetup", masterEmail, masterPassword, email, password })).recoveryCode;
  },
  async adminRecoverCheck(code) {
    await call({ action: "adminRecoverCheck", code });
  },
  async adminReset(code, newPassword) {
    return (await call({ action: "adminReset", code, newPassword })).recoveryCode;
  },
  // role: "vendor" | "inspector". Devuelve el perfil del usuario.
  async profileLogin(role, code) {
    const { token, profile } = await call({ action: "profileLogin", role, code });
    sessionToken = token;
    lastProfileLogin = { role, code };
    return profile;
  },
  logout() { sessionToken = null; lastProfileLogin = null; },
};

export function installSupabaseStorage() {
  window.storage = supabaseStorage;
  window.auth = supabaseAuth;
}
