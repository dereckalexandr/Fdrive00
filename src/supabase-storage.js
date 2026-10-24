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

// La sesión se guarda en sessionStorage: sobrevive a recargar la página, pero se borra al cerrar la pestaña o el navegador
// (no queda guardada de forma permanente en el dispositivo). El token vence solo en el servidor (8 a 12 horas).
const CLAVE_SESION = "df-sesion";
const guardarSesion = (datos) => { try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(datos)); } catch (e) { /* modo privado o sin almacenamiento: se pide ingresar de nuevo al recargar */ } };
const leerSesion = () => { try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION) || "null"); } catch (e) { return null; } };
export function olvidarSesion() {
  try { sessionStorage.removeItem(CLAVE_SESION); sessionStorage.removeItem("df-pantalla"); Object.keys(sessionStorage).filter((k) => k.startsWith("df-tab-")).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* nada que borrar */ }
}

const TIEMPO_MAX_MS = 45_000;

async function call(payload) {
  // Si el servidor no responde en 45 s se corta (antes la pantalla podía quedar esperando para siempre).
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIEMPO_MAX_MS);
  let res;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
  } catch (e) {
    throw e && e.name === "AbortError" ? new Error("timeout") : e;
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    if (data && data.detalle) err.detalle = data.detalle;
    throw err;
  }
  return data;
}

async function kv(op, extra, retry = true) {
  try {
    return await call({ action: "kv", token: sessionToken, op, ...extra });
  } catch (e) {
    if (e.status === 401 && retry) {
      olvidarSesion();
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
    guardarSesion({ tipo: "admin", token });
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
  // Personas del CRM: ingresan con RUT y clave. Devuelve sus datos y permisos.
  // No se guarda la clave para reingresar en silencio: si la sesión vence, se avisa.
  async userLogin(rut, password) {
    const { token, me } = await call({ action: "userLogin", rut, password });
    sessionToken = token;
    guardarSesion({ tipo: "user", token });
    return me;
  },
  /**
   * Al abrir o recargar la página: retoma la sesión guardada si el servidor la sigue aceptando.
   * Devuelve { tipo, me | profile } o null (entonces se muestra el ingreso).
   */
  async restaurar() {
    const g = leerSesion();
    if (!g || !g.token || !g.tipo) return null;
    sessionToken = g.token;
    try {
      if (g.tipo === "user") {
        const { me } = await call({ action: "userMe", token: g.token });
        return { tipo: "user", me };
      }
      if (g.tipo === "admin") {
        await call({ action: "crm", token: g.token, op: "locales.list" });
        return { tipo: "admin" };
      }
    } catch (e) {
      // Sesión vencida o rechazada: se descarta. Si solo fue un corte de red, se conserva para el siguiente intento.
      if (e && e.status === 401) { sessionToken = null; olvidarSesion(); }
      else sessionToken = null;
    }
    return null;
  },
  async userChangePassword(actual, nueva) {
    return (await call({ action: "userChangePassword", token: sessionToken, actual, nueva })).me;
  },
  // Operaciones del panel de administración del CRM (solo cuenta maestra).
  async crm(op, params = {}) {
    try {
      return await call({ action: "crm", token: sessionToken, op, ...params });
    } catch (e) {
      if (e.status === 401) { olvidarSesion(); window.dispatchEvent(new Event("df-session-expired")); }
      throw e;
    }
  },
  // Módulo comercial (inventario, clientes, leads, tareas). Cuenta maestra o persona del CRM.
  async ventas(op, params = {}) {
    try {
      // Las consultas de solo lectura se reintentan si la conexión se corta (por ejemplo, cuando la función se está reiniciando).
      const esLectura = /(^|\.)(list|get|cola|resumen|equipo|pendientes|mios|catalogos|mias)$/.test(op);
      for (let intento = 0; ; intento++) {
        try { return await call({ action: "ventas", token: sessionToken, op, ...params }); }
        catch (e) {
          const sinRespuesta = e && !e.status && /failed to fetch|load failed|networkerror|timeout/i.test(String(e.message));
          if (!(esLectura && sinRespuesta && intento < 2)) throw e;
          await new Promise((r) => setTimeout(r, 700 * (intento + 1)));
        }
      }
    } catch (e) {
      if (e.status === 401) { olvidarSesion(); window.dispatchEvent(new Event("df-session-expired")); }
      throw e;
    }
  },
  logout() { sessionToken = null; olvidarSesion(); },
};

export function installSupabaseStorage() {
  window.storage = supabaseStorage;
  window.auth = supabaseAuth;
}
