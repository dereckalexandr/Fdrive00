// Llamadas a la acción pública de la función de Supabase (sin sesión): las usan el sitio de la automotora y la consulta de inspecciones.
import { MENSAJES_WEB } from "../supabase/functions/api/publico-core.js";

const URL_FUNCION = import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api` : "";
const CLAVE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/** Llama a la acción pública del servidor. Lanza Error(codigo) si falla. */
export async function llamar(op, extra = {}) {
  if (!URL_FUNCION) throw new Error("sin_servidor");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  let res;
  try {
    res = await fetch(URL_FUNCION, { method: "POST", headers: { "Content-Type": "application/json", apikey: CLAVE_ANON }, body: JSON.stringify({ action: "public", op, ...extra }), signal: ctl.signal });
  } catch (e) { throw new Error("sin_conexion"); } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (!res.ok) { const err = new Error((data && data.error) || `http_${res.status}`); err.status = res.status; throw err; }
  return data;
}
export const textoError = (e) => MENSAJES_WEB[e && e.message] || (e && e.message === "sin_conexion" ? "No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo." : "No pudimos procesar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.");

