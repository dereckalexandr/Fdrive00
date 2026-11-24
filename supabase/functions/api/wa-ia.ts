// Asistente con IA de WhatsApp fuera de horario (lado servidor): conversa con Claude, ejecuta sus herramientas y cuida el gasto.
//
// Claude solo puede buscar autos disponibles (datos públicos), anotar lo que dijo el cliente y derivarlo a un ejecutivo. Antes de cada
// respuesta se revisan los topes: gasto del mes en dólares y máximo de respuestas de IA por conversación. Nunca lanza: si algo falla,
// el mensaje del cliente ya está guardado y el ejecutivo lo verá en la mañana.
import {
  MODELO_IA_DEFECTO, HERRAMIENTAS_IA, instruccionesIa, contextoIa, buscarInventario, historialParaClaude, textoDeRespuesta, notaIa,
  claveUsoMes, USO_VACIO, sumarUso,
} from "./wa-ia-core.js";
import { proximaApertura, textoHorario } from "./wa-bot-core.js";
import { telefonoVisible } from "./whatsapp-core.js";
import { enviarAviso, enSegundoPlano, correoActivo } from "./correo.ts";

export type DepsIa = {
  /** Llama a la API de Claude (en producción el SDK oficial; en las pruebas, una simulación). */
  claude: (params: any) => Promise<any>;
  claveCargada: () => boolean;
  modelo?: string;
  urlSitio: string;
};

const MAX_VUELTAS = 4; // herramientas encadenadas en una respuesta
const HORAS_CONVERSACION = 12;

/** Gasto acumulado del mes en curso. */
export async function usoDelMes(sb: any, ahora = new Date()) {
  const g = await sb.from("kv_store").select("value").eq("key", claveUsoMes(ahora)).maybeSingle();
  try { return { ...USO_VACIO, ...(g.data && g.data.value ? JSON.parse(g.data.value) : {}) }; } catch { return { ...USO_VACIO }; }
}
async function anotarUso(sb: any, modelo: string, usage: any, ahora: Date) {
  const uso = sumarUso(await usoDelMes(sb, ahora), modelo, usage);
  await sb.from("kv_store").upsert({ key: claveUsoMes(ahora), value: JSON.stringify(uso), shared: false, updated_at: ahora.toISOString() }, { onConflict: "key" });
  return uso;
}

async function agregarEtiqueta(sb: any, conv: any, etiqueta: string) {
  const c = (await sb.from("wa_conversaciones").select("etiquetas").eq("id", conv.id).maybeSingle()).data;
  const actuales: string[] = Array.isArray(c && c.etiquetas) ? c.etiquetas : [];
  if (actuales.some((x) => x.toLowerCase() === etiqueta.toLowerCase()) || actuales.length >= 5) return;
  await sb.from("wa_conversaciones").update({ etiquetas: [...actuales, etiqueta] }).eq("id", conv.id);
}

/** Anota en el lead (notas e historial) y, si deriva, etiqueta la conversación y avisa por correo al ejecutivo. */
async function anotarEnLead(deps: any, conv: any, texto: string, derivar: boolean, cfg: any, ahora: Date) {
  const { sb } = deps;
  if (!conv.lead_id) return;
  const l = (await sb.from("leads").select("id, notas, asignado_a, local_id").eq("id", conv.lead_id).maybeSingle()).data;
  if (!l) return;
  await sb.from("leads").update({ notas: [l.notas, texto].filter(Boolean).join("\n\n").slice(0, 2000), ultima_actividad: ahora.toISOString(), actualizado_en: ahora.toISOString() }).eq("id", l.id);
  await sb.from("lead_eventos").insert({ lead_id: l.id, usuario_id: "sistema", usuario_nombre: "Asistente IA", tipo: "nota", detalle: texto.slice(0, 1500) });
  if (!derivar) return;
  await agregarEtiqueta(sb, conv, "Pidió ejecutivo");
  await deps.audit({ tipo: "sistema", nombre: "Asistente IA" }, "whatsapp.ia_deriva", "lead", l.id, { motivo: texto.slice(0, 200) });
  if (!correoActivo() || !l.asignado_a) return;
  const u = (await sb.from("usuarios").select("email").eq("id", l.asignado_a).maybeSingle()).data;
  if (!u || !u.email) return;
  await enSegundoPlano(enviarAviso({
    para: [u.email], asunto: "Un cliente pidió hablar con un ejecutivo (WhatsApp)", titulo: "Cliente derivado por el asistente virtual",
    lineas: [`${telefonoVisible(conv.telefono)} escribió por WhatsApp fuera de horario y el asistente virtual lo derivó a un ejecutivo.`, ...texto.split("\n"), `Contáctalo ${proximaApertura(cfg.horario, ahora)}.`],
  }));
}

/**
 * Responde al cliente con Claude. `enviar` manda el texto por WhatsApp y lo deja en la conversación. Devuelve qué pasó:
 * «respondio», «derivo» (respondió y derivó), «limite» (se alcanzó un tope), «sin_clave», «sin_nada» o «error» (no se envió nada).
 */
export async function responderConIA(
  deps: any, ia: DepsIa, conv: any, cfg: any, ctx: { nombre?: string; ejecutivo?: string; necesidad?: string; derivado?: boolean }, enviar: (texto: string) => Promise<boolean>, ahora: Date = new Date(),
): Promise<"respondio" | "derivo" | "limite" | "sin_clave" | "sin_nada" | "error"> {
  const { sb } = deps;
  try {
    if (!ia || !ia.claveCargada()) return "sin_clave";
    const modelo = ia.modelo || MODELO_IA_DEFECTO;
    // Topes: gasto del mes y respuestas de IA por conversación en las últimas horas.
    const uso = await usoDelMes(sb, ahora);
    if (cfg.ia.maxUsdMes > 0 && uso.usd >= cfg.ia.maxUsdMes) return "limite";
    const todas = (await sb.from("wa_mensajes").select("direccion, tipo, texto, usuario_id, creado_en").eq("conversacion_id", conv.id)).data ?? [];
    const desde = ahora.getTime() - HORAS_CONVERSACION * 3_600_000;
    if (todas.filter((x: any) => x.usuario_id === "bot-ia" && Date.parse(x.creado_en) > desde).length >= cfg.ia.maxPorConversacion) return "limite";
    const mensajes: any[] = historialParaClaude([...todas].sort((a: any, b: any) => String(a.creado_en).localeCompare(String(b.creado_en))));
    if (!mensajes.length) return "sin_nada";

    const proxima = proximaApertura(cfg.horario, ahora);
    const system = [
      { type: "text", text: instruccionesIa(cfg.empresa), cache_control: { type: "ephemeral" } }, // estable: se guarda en caché
      { type: "text", text: contextoIa({ horarioTexto: textoHorario(cfg.horario), proxima, ...ctx }) }, // variable: va después del punto de caché
    ];
    let derivado = false;
    let respuesta = "";
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const r = await ia.claude({ model: modelo, max_tokens: 4000, system, tools: HERRAMIENTAS_IA, messages: mensajes, output_config: { effort: "low" } });
      await anotarUso(sb, modelo, r.usage, ahora);
      if (r.stop_reason === "refusal") { // la IA se negó: no se insiste, lo ve una persona
        if (!derivado) { await anotarEnLead(deps, conv, notaIa({ motivo: "la IA no pudo responder esta consulta" }), true, cfg, ahora); derivado = true; }
        respuesta = `Esa consulta se la paso a un ejecutivo, que te contactará ${proxima}. ¡Gracias por escribirnos!`;
        break;
      }
      if (r.stop_reason === "tool_use") {
        mensajes.push({ role: "assistant", content: r.content }); // se devuelve tal cual, con sus bloques de herramienta
        const resultados: any[] = [];
        for (const b of (r.content || []).filter((x: any) => x.type === "tool_use")) {
          let salida: any; let error = false;
          try {
            const entrada = b.input && typeof b.input === "object" ? b.input : {};
            if (b.name === "buscar_inventario") {
              const q = await sb.from("vehiculos").select("id, marca, modelo, version, anio, km, color, transmision, combustible, precio_lista, precio_financiamiento, estado, activo");
              salida = buscarInventario(q.data ?? [], entrada, ia.urlSitio);
            } else if (b.name === "anotar_en_ficha") {
              await anotarEnLead(deps, conv, notaIa({ resumen: entrada.resumen, visita_preferida: entrada.visita_preferida }), false, cfg, ahora);
              salida = { ok: true };
            } else if (b.name === "derivar_a_ejecutivo") {
              await anotarEnLead(deps, conv, notaIa({ motivo: entrada.motivo }), true, cfg, ahora);
              derivado = true; salida = { ok: true, contactara: proxima };
            } else { salida = { error: "herramienta desconocida" }; error = true; }
          } catch (e) { console.error("whatsapp ia herramienta:", String((e as any)?.message ?? e)); salida = { error: "no se pudo ejecutar" }; error = true; }
          resultados.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(salida), ...(error ? { is_error: true } : {}) });
        }
        mensajes.push({ role: "user", content: resultados }); // todos los resultados juntos, en un solo mensaje
        continue;
      }
      respuesta = textoDeRespuesta(r.content);
      break;
    }
    if (!respuesta && derivado) respuesta = `Listo, dejé tu consulta para un ejecutivo: te contactará ${proxima}. ¡Gracias por escribirnos!`;
    if (!respuesta) return "error";
    const ok = await enviar(respuesta.slice(0, 4000));
    if (!ok) return "error";
    return derivado ? "derivo" : "respondio";
  } catch (e) {
    console.error("whatsapp ia:", String((e as any)?.message ?? e));
    return "error";
  }
}
