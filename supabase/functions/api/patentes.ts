// Consulta de datos de un vehículo por patente (API de Boostr), compartida por el CRM (ventas.ts) y el sitio web (publico.ts).
//
// Reglas:
//  - Cada patente consultada con éxito se GUARDA PARA SIEMPRE en la tabla `patentes_consultadas`: la segunda vez (desde donde sea)
//    se responde desde la base de datos y NO usa el cupo diario ni llama al proveedor. Las patentes guardadas se responden incluso
//    si la clave del proveedor no está configurada o el cupo del día se agotó.
//  - Solo las consultas nuevas gastan cupo. El cupo diario es común al CRM y al sitio web; el sitio web puede usar como máximo la
//    mitad (para que el público nunca deje sin consultas al personal).
//  - La clave vive solo aquí (secreto BOOSTR_API_KEY). Nunca se pide el dueño ni se guarda nada de personas.
import { normalizarPatente, patenteValida, normalizarRespuestaBoostr, limiteDiario, limiteWeb } from "./patentes-core.js";

export type Origen = "interno" | "web";
export type ResultadoPatente = { ok: true; vehiculo: Record<string, unknown>; origen: "guardada" | "boostr" } | { ok: false; error: string; status: number };

const hoyChile = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

/** Fila de la tabla -> lo que usa el resto del programa. */
function filaAVehiculo(f: any) {
  return { patente: f.patente, marca: f.marca, modeloCompleto: f.modelo_completo, anio: f.anio ?? null, tipo: f.tipo ?? "", ...(f.extras && typeof f.extras === "object" ? f.extras : {}) };
}

async function contador(sb: any, clave: string): Promise<number> {
  const r = await sb.from("kv_store").select("value").eq("key", clave).maybeSingle();
  if (r.error) throw r.error;
  return Number.parseInt(r.data ? r.data.value : "0", 10) || 0;
}
async function sumar(sb: any, clave: string, valor: number) {
  await sb.from("kv_store").upsert({ key: clave, value: String(valor), shared: false, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function consultarPatente(sb: any, patenteBruta: unknown, origen: Origen, esTablaFaltante: (e: any) => boolean): Promise<ResultadoPatente> {
  const patente = normalizarPatente(patenteBruta);
  if (!patenteValida(patente)) return { ok: false, error: "patente_invalida", status: 400 };

  // 1) ¿Ya la tenemos? Se responde sin gastar nada.
  const guardada = await sb.from("patentes_consultadas").select("*").eq("patente", patente).maybeSingle();
  if (guardada.error) return esTablaFaltante(guardada.error) ? { ok: false, error: "crm_not_installed", status: 503 } : (() => { throw guardada.error; })();
  if (guardada.data) return { ok: true, vehiculo: filaAVehiculo(guardada.data), origen: "guardada" };

  // 2) Consulta nueva: hace falta la clave y cupo.
  const clave = Deno.env.get("BOOSTR_API_KEY");
  if (!clave) return { ok: false, error: "no_configurado", status: 503 };
  const fecha = hoyChile();
  const total = limiteDiario(Deno.env.get("BOOSTR_LIMITE_DIARIO"));
  const usadas = await contador(sb, `patente_uso::${fecha}`);
  if (usadas >= total) return { ok: false, error: "cupo_agotado", status: 429 };
  let usadasWeb = 0;
  if (origen === "web") {
    usadasWeb = await contador(sb, `patente_uso_web::${fecha}`);
    if (usadasWeb >= limiteWeb(total)) return { ok: false, error: "cupo_agotado", status: 429 };
  }
  // Se cuenta antes de consultar: aunque la consulta falle, el proveedor la descuenta, y así dos personas a la vez no se pasan del tope.
  await sumar(sb, `patente_uso::${fecha}`, usadas + 1);
  if (origen === "web") await sumar(sb, `patente_uso_web::${fecha}`, usadasWeb + 1);

  let respuesta: any;
  try {
    const r = await fetch(`https://api.boostr.cl/vehicle/${patente}.json`, { headers: { "x-api-key": clave, accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) {
      console.error("patentes: el proveedor respondió", r.status);
      return { ok: false, error: "servicio_no_disponible", status: 502 };
    }
    respuesta = await r.json();
  } catch (e) {
    console.error("patentes: no se pudo consultar:", String((e as any)?.message ?? e));
    return { ok: false, error: "servicio_no_disponible", status: 502 };
  }
  const n = normalizarRespuestaBoostr(respuesta, patente);
  if (!n.ok) return n.error === "no_encontrada" ? { ok: false, error: "no_encontrada", status: 404 } : { ok: false, error: "servicio_no_disponible", status: 502 };

  // 3) Se guarda para siempre. Si otra persona la guardó justo antes (clave repetida), no pasa nada.
  const { patente: _p, marca, modeloCompleto, anio, tipo, ...extras } = n.vehiculo as any;
  const ins = await sb.from("patentes_consultadas").insert({ patente, marca, modelo_completo: modeloCompleto, anio, tipo, extras, fuente: `boostr:${origen}` });
  if (ins.error && ins.error.code !== "23505") {
    if (esTablaFaltante(ins.error)) return { ok: false, error: "crm_not_installed", status: 503 };
    console.error("patentes: no se pudo guardar:", ins.error.message);
  }
  return { ok: true, vehiculo: n.vehiculo as Record<string, unknown>, origen: "boostr" };
}
