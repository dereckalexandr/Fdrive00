// Asistente de WhatsApp fuera de horario (lado servidor).
//
// Cuando llega un mensaje de un cliente y el local está cerrado, el asistente conversa con botones y listas de WhatsApp, anota lo que
// el cliente cuenta y, al terminar, deja el lead con su tipo (venta, compra o consignación), reasignado a quien corresponde por tipo
// y rotación, con los datos anotados y un aviso por correo al ejecutivo. Las reglas viven en wa-bot-core.js; aquí solo se habla con
// Meta y con la base. Nunca lanza: si algo falla, el mensaje del cliente igual quedó guardado y el ejecutivo lo verá en la mañana.
import {
  configBot, estaAbierto, estadoInicial, avanzar, mensajeInicio, mensajeFueraDeHorario, resumenBot, cuerpoMeta, textoParaConversacion,
  tipoLeadDeNecesidad, proximaApertura, interpretarNecesidad, tituloNecesidad, HORAS_SIN_REPETIR, HORAS_HUMANO_ACTIVO,
} from "./wa-bot-core.js";
import { responderConIA, type DepsIa } from "./wa-ia.ts";
import { telefonoVisible } from "./whatsapp-core.js";
import { grupoDeReparto, tipoLeadNombre } from "./compras-core.js";
import { ETAPAS_CERRADAS } from "./ventas-core.js";
import { permisosEfectivos } from "./crm-core.js";
import { enviarAviso, enSegundoPlano, correoActivo } from "./correo.ts";

export const CLAVE_BOT = "whatsapp::bot";
const ASISTENTE = { tipo: "sistema", nombre: "Asistente" };

export type DepsBot = {
  sb: any;
  graph: (path: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; data: any; error?: string }>;
  phoneNumberId: string;
  elegirEjecutivo: (local: string, tipo: string) => Promise<{ asignado: any; usuarios: any[]; overrides: any }>;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
  /** Claude (opcional): sin esto, o con la IA apagada en la configuración, el asistente funciona solo con el menú. */
  ia?: DepsIa;
};

export async function cargarConfigBot(sb: any) {
  const g = await sb.from("kv_store").select("value").eq("key", CLAVE_BOT).maybeSingle();
  return configBot(g.data ? g.data.value : null);
}

/** Envía un mensaje del asistente y lo deja en la conversación (con el nombre «Asistente»). Devuelve false si Meta lo rechazó. */
async function enviar(deps: DepsBot, conv: any, mensaje: any, quien = { id: "bot", nombre: "Asistente" }): Promise<boolean> {
  const envio = { messaging_product: "whatsapp", recipient_type: "individual", to: conv.telefono, ...cuerpoMeta(mensaje) };
  const r = await deps.graph(`/${encodeURIComponent(deps.phoneNumberId)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envio) });
  if (!r.ok) { console.error("whatsapp bot:", r.error); return false; }
  const texto = textoParaConversacion(mensaje);
  await deps.sb.from("wa_mensajes").insert({
    conversacion_id: conv.id, wamid: String((((r.data || {}).messages || [])[0] || {}).id || "") || null, direccion: "saliente", tipo: "text", texto,
    estado: "enviado", lead_id: conv.lead_id || null, usuario_id: quien.id, usuario_nombre: quien.nombre,
  });
  const ahora = new Date().toISOString();
  await deps.sb.from("wa_conversaciones").update({ ultimo_mensaje_en: ahora, ultimo_texto: texto.slice(0, 200), ultima_direccion: "saliente", actualizado_en: ahora }).eq("id", conv.id);
  return true;
}

/** Deja el lead con el tipo y el ejecutivo que corresponden y con lo que contó el cliente. */
async function cerrarLead(deps: DepsBot, conv: any, datos: any, cfg: any, ahora: Date) {
  const { sb } = deps;
  if (!conv.lead_id) return;
  const l = (await sb.from("leads").select("*").eq("id", conv.lead_id).maybeSingle()).data;
  if (!l) return;
  const tipo = tipoLeadDeNecesidad(datos.necesidad);
  const cambioGrupo = grupoDeReparto(l.tipo || "venta") !== grupoDeReparto(tipo);
  const parche: Record<string, unknown> = {
    tipo, notas: [l.notas, resumenBot(datos)].filter(Boolean).join("\n\n").slice(0, 2000),
    ultima_actividad: ahora.toISOString(), actualizado_en: ahora.toISOString(),
  };
  let asignado: any = l.asignado_a ? { id: l.asignado_a } : null;
  let usuarios: any[] = []; let overrides: any = {};
  if (cambioGrupo || !l.asignado_a) {
    const r = await deps.elegirEjecutivo(l.local_id || conv.local_id, tipo);
    usuarios = r.usuarios; overrides = r.overrides;
    asignado = r.asignado; // si no hay nadie habilitado para ese tipo, queda sin asignar y se avisa a los Jefes Local
    parche.asignado_a = asignado ? asignado.id : null;
  }
  await sb.from("leads").update(parche).eq("id", l.id);
  // Si el cliente se dio a conocer con su nombre, la ficha lo usa (solo si la creó WhatsApp y todavía lleva el nombre del perfil).
  if (datos.nombre && conv.cliente_id) {
    const c = (await sb.from("clientes").select("id, notas").eq("id", conv.cliente_id).maybeSingle()).data;
    if (c && c.notas === "Llegó por WhatsApp") await sb.from("clientes").update({ nombre: String(datos.nombre).slice(0, 80) }).eq("id", c.id);
  }
  const nombreAsig = asignado ? (usuarios.find((u: any) => u.id === asignado.id) || asignado).nombre || null : null;
  await sb.from("lead_eventos").insert({
    lead_id: l.id, usuario_id: "sistema", usuario_nombre: "Asistente", tipo: "nota",
    detalle: `El asistente de WhatsApp atendió al cliente fuera de horario: ${tipoLeadNombre(tipo)}${cambioGrupo ? ` (cambió de tipo y de reparto${nombreAsig ? `; ahora lo atiende ${nombreAsig}` : "; nadie está habilitado para ese tipo y quedó sin asignar"})` : ""}.\n${resumenBot(datos)}`.slice(0, 1500),
  });
  await deps.audit(ASISTENTE, "whatsapp.bot", "lead", l.id, { tipo, asignado: nombreAsig, cambio_de_grupo: cambioGrupo });

  // Aviso por correo: al ejecutivo (o a los Jefes Local si nadie quedó asignado).
  if (!correoActivo()) return;
  if (!usuarios.length) usuarios = (await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, email").eq("local_id", l.local_id || conv.local_id)).data ?? [];
  const para = asignado
    ? usuarios.filter((u: any) => u.id === asignado.id && u.email).map((u: any) => u.email)
    : usuarios.filter((u: any) => u.activo && u.email && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("leads.asignar")).map((u: any) => u.email);
  if (!para.length) return;
  const nombre = datos.nombre || telefonoVisible(conv.telefono);
  await enSegundoPlano(enviarAviso({
    para, asunto: "Cliente atendido por el asistente de WhatsApp", titulo: "Cliente atendido fuera de horario",
    lineas: [
      `${nombre} (${telefonoVisible(conv.telefono)}) escribió por WhatsApp fuera de horario y dejó sus datos.`,
      ...resumenBot(datos).split("\n").slice(1),
      `Contáctalo ${proximaApertura(cfg.horario, ahora)}.${asignado ? "" : " No quedó asignado a nadie: asígnalo desde el CRM."}`,
    ],
  }));
}

/**
 * Se llama por cada mensaje de un cliente, después de guardarlo. Decide si el asistente debe intervenir y, si corresponde, lo hace.
 * No interviene: con el asistente apagado, en horario laboral, si un ejecutivo ya le escribió hace poco, ni con reacciones.
 */
export async function procesarBot(deps: DepsBot, conv: any, m: any, ahora: Date = new Date()): Promise<void> {
  try {
    const { sb } = deps;
    const cfg = await cargarConfigBot(sb);
    if (!cfg.activo || m.tipo === "reaction" || estaAbierto(cfg.horario, ahora)) return;

    // Si un ejecutivo ya está conversando, no se mete.
    const salientes = (await sb.from("wa_mensajes").select("usuario_id, creado_en").eq("conversacion_id", conv.id).eq("direccion", "saliente")).data ?? [];
    const limite = ahora.getTime() - HORAS_HUMANO_ACTIVO * 3_600_000;
    if (salientes.some((x: any) => x.usuario_id && x.usuario_id !== "bot" && x.usuario_id !== "bot-ia" && Date.parse(x.creado_en) > limite)) return;

    const estado = conv.bot_estado && conv.bot_estado.paso ? conv.bot_estado : null;
    const ult = Date.parse(conv.bot_actualizado || "");
    const vigente = Number.isFinite(ult) && ahora.getTime() - ult < HORAS_SIN_REPETIR * 3_600_000;
    const guardar = (e: any) => sb.from("wa_conversaciones").update({ bot_estado: e, bot_actualizado: ahora.toISOString() }).eq("id", conv.id);

    // IA (Claude): responde las preguntas libres del cliente cuando el menú no está esperando un dato. Sin clave, apagada o con un tope
    // alcanzado, no hace nada y el asistente de menú sigue como siempre.
    const iaLista = !!(cfg.ia && cfg.ia.activa && deps.ia && deps.ia.claveCargada());
    const textoLibre = m.tipo === "text" && !m.respuestaId && String(m.texto || "").trim().length >= 8;
    const conIA = async (necesidad = ""): Promise<string> => {
      const lead0 = conv.lead_id ? (await sb.from("leads").select("asignado_a, etapa").eq("id", conv.lead_id).maybeSingle()).data : null;
      let ejecutivo = "";
      if (lead0 && lead0.asignado_a && !ETAPAS_CERRADAS.includes(lead0.etapa)) ejecutivo = ((await sb.from("usuarios").select("nombre").eq("id", lead0.asignado_a).maybeSingle()).data || {}).nombre || "";
      const cli0 = conv.cliente_id ? (await sb.from("clientes").select("nombre").eq("id", conv.cliente_id).maybeSingle()).data : null;
      const nombre = cli0 && cli0.nombre && !/^WhatsApp /.test(cli0.nombre) ? cli0.nombre : "";
      return await responderConIA(deps, deps.ia as DepsIa, conv, cfg, { nombre, ejecutivo, necesidad }, (t) => enviar(deps, conv, { tipo: "texto", texto: t }, { id: "bot-ia", nombre: "Asistente IA" }), ahora);
    };
    const atendida = (r: string) => r === "respondio" || r === "derivo";

    // Conversación en curso: sigue con la respuesta del cliente.
    if (estado && estado.paso === "necesidad" && vigente && !estado.derivado && iaLista && textoLibre && interpretarNecesidad(m.texto) === null) {
      // Escribió una pregunta en vez de elegir de la lista: la IA la responde y el menú queda esperando.
      const r = await conIA();
      if (atendida(r)) { await guardar(r === "derivo" ? { ...estado, derivado: true } : estado); return; }
    }
    if (estado && estado.paso !== "listo" && vigente) {
      const r = avanzar(estado, { id: m.respuestaId || "", texto: m.texto || "", tipo: m.tipo }, cfg, ahora);
      let enviado = true;
      for (const msg of r.mensajes) enviado = (await enviar(deps, conv, msg)) && enviado;
      // Si Meta no entregó la pregunta, el estado no avanza: cuando el cliente vuelva a escribir se le repite. Lo que ya contó no se pierde.
      if (!enviado && !r.terminado) return;
      await guardar(r.estado);
      if (r.terminado) await cerrarLead(deps, conv, r.estado.datos, cfg, ahora);
      return;
    }
    // Ya terminó hace poco: lo que escriba ahora queda en la conversación para el ejecutivo, sin respuesta.
    if (estado && estado.paso === "listo" && vigente) {
      if (iaLista && textoLibre && !estado.derivado) {
        const r = await conIA(tituloNecesidad(estado.datos && estado.datos.necesidad));
        if (r === "derivo") await guardar({ ...estado, derivado: true });
      }
      return;
    }

    // Conversación nueva (o que vuelve después de horas): ¿cliente nuevo o cliente que ya tiene ejecutivo?
    const lead = conv.lead_id ? (await sb.from("leads").select("id, etapa, fuente, creado_en, asignado_a").eq("id", conv.lead_id).maybeSingle()).data : null;
    const recien = !!lead && lead.fuente === "WhatsApp" && ahora.getTime() - Date.parse(lead.creado_en) < 15 * 60_000 && !ETAPAS_CERRADAS.includes(lead.etapa);
    if (!lead || recien) {
      if (await enviar(deps, conv, mensajeInicio(cfg, ahora))) await guardar(estadoInicial(ahora));
      return;
    }
    // Cliente conocido que escribe una pregunta: la IA le responde; si no puede, el aviso corto de siempre.
    if (iaLista && textoLibre) {
      const r = await conIA();
      if (atendida(r)) { await guardar({ paso: "listo", datos: {}, intentos: 0, aviso: true, ia: true, ...(r === "derivo" ? { derivado: true } : {}) }); return; }
    }
    // Cliente conocido: un aviso corto con el nombre de su ejecutivo (si el lead sigue abierto).
    let ejecutivo = "";
    if (lead.asignado_a && !ETAPAS_CERRADAS.includes(lead.etapa)) {
      const u = (await sb.from("usuarios").select("nombre").eq("id", lead.asignado_a).maybeSingle()).data;
      ejecutivo = (u && u.nombre) || "";
    }
    const cli = conv.cliente_id ? (await sb.from("clientes").select("nombre").eq("id", conv.cliente_id).maybeSingle()).data : null;
    if (await enviar(deps, conv, mensajeFueraDeHorario(cfg, { nombre: cli && cli.nombre && !/^WhatsApp /.test(cli.nombre) ? cli.nombre : "", ejecutivo }, ahora))) await guardar({ paso: "listo", datos: {}, intentos: 0, aviso: true });
  } catch (e) {
    console.error("whatsapp bot:", String((e as any)?.message ?? e));
  }
}
