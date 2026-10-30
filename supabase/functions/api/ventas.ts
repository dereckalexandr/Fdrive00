// Operaciones del módulo comercial (entrega 2A): inventario, clientes, leads de venta y tareas.
//
// Las llama index.ts con la acción "ventas". Aquí se decide, EN EL SERVIDOR, qué puede ver y hacer cada persona:
//   - inventario.ver / inventario.editar  -> inventario del local (el costo solo lo ve quien puede editar)
//   - leads.propios + ventas.operar       -> ve y trabaja SOLO los leads que le asignaron
//   - leads.local                         -> ve todos los leads de su local (sin modificarlos)
//   - leads.asignar                       -> supervisor: ve, modifica y reasigna todo el local
//   - cuenta maestra (admin)              -> todo; elige el local con `localId`
// Cada persona está acotada a su local. Los cambios importantes quedan en la bitácora.
import { cargaDelEquipo } from "./alertas-leads-core.js";
import { permisosEfectivos, configCompleta, limpiarExtra } from "./crm-core.js";
import {
  ESTADOS_VEHICULO, ETAPAS, ETAPAS_CERRADAS, TIPOS_CONTACTO,
  validarCotizacion, estadoCotizacionInicial, requiereNuevaAprobacion, validarReserva, reservaVencida,
  validarVehiculo, ocultarCosto, validarCliente, validarLead, validarCambioEtapa, elegirAsignado, validarTarea,
  puedeEditarLead, etapaNombre,
  validarCierre, margenVenta, mesChile, esMes, nombreMes, FINANCIERAS,
  horasDesde, ETAPAS_ABIERTAS, esSinAtender, esDetenido, ultimaActividad, embudoCohorte, rendimientoPorFuente, motivosDePerdida, validarAviso, claseTarea,
  GRUPOS_HOY, clasificarLeadHoy, ordenarHoy, faltaProximaAccion,
  solicitudDeCanal,
} from "./ventas-core.js";
import { tramosEfectivos, calcularProduccion } from "./comisiones-core.js";
import { enviarAviso, enSegundoPlano, correoActivo } from "./correo.ts";
import { LIMITE_POR_MINUTO } from "./patentes-core.js";
import { consultarPatente } from "./patentes.ts";

// Consultas por minuto de cada persona a la API de patentes (por instancia de la función: es un freno, no una garantía).
const consultasPorPersona = new Map<string, { n: number; reset: number }>();
import {
  folioTasacion, validarSolicitudTasacion, validarTasacionDirecta, validarBorradorTasacion, validarCompletarTasacion, validarTransicionTasacion,
  topeParteDePago, verificarTopeParteDePago, fusionarParteDePago, metricasTasador, colaTasaciones,
  vehiculoDelCliente, topeDeOferta,
} from "./tasaciones-core.js";

import {
  folioCompra, folioConsignacion, etapaDeOperacion, COMPRA_ABIERTA, CONSIGNACION_ABIERTA, permisoDeTipo, validarVehiculoOfrecido, validarOferta, validarRespuestaOferta, validarPagoCompra,
  validarTransicionCompra, grupoDeReparto, vehiculoDeCompra, validarConsignacion, vencimientoConsignacion, diasParaVencer, validarTransicionConsignacion, validarExtension,
  vehiculoDeConsignacion, verificarPisoConsignado, filasConsignacion, metricasCompras,
} from "./compras-core.js";
import {
  folioCampania, folioPublicacion, validarCampania, validarResultadosCampania, estadoTrasGuardar, validarTransicionCampania, metricasCampania,
  validarPublicacion, publicacionesAtrasadas, resumenPublicaciones, validarMaterial,
} from "./marketing-core.js";
import {
  folioAnuncio, sugerirAviso, validarTextoAnuncio, validarPortal, elegibleParaAviso, estadoDeAnuncio, alertasAnuncio, consultasDeVehiculo, resumenAvisos,
} from "./anuncios-core.js";
import {
  folioValidacion, validarRevision, validarArchivo, MAX_ARCHIVOS_DOC, checklistPara, estadoDeValidacion, progreso, docsReutilizables,
  colaValidaciones, metricasValidador, validarTransicionValidacion, ESTADOS_ABIERTOS,
  filaDoc, reglaDocCompra as reglaDoc, archivoPermitidoParaDoc, validarDatosDoc, validarDatosCliente, faltantesCompra, faltantesConsignacion, esChecklistCompraActual, validarCuentaBancaria, DOCS_COMPRA, DOCS_CONSIGNACION, TIPOS_CON_REGLAS,
} from "./validaciones-core.js";
import {
  folioInspeccion, VEREDICTOS, validarSolicitudInspeccion, validarReprogramacion, validarResultadoInspeccion, claveEsDe,
  validarTransicionInspeccion, resolverLugar, idDeClave, ordenarAgenda, hayChoque, metricasInspector, colaInspecciones,
} from "./inspecciones-core.js";

export type Ctx = {
  sb: any;
  json: (data: unknown, status?: number) => Response;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
  isMissingTable: (e: any) => boolean;
  rolePermOverrides: () => Promise<Record<string, string[]>>;
  dropLive?: () => void;
  esAdmin: boolean;
  actor: { tipo: "admin" | "usuario"; id?: string; nombre?: string };
  user: { id: string; nombre: string; localId: string | null; permisos: string[] } | null;
};

const MAX_LISTA = 1000;

export async function ventasOp(ctx: Ctx, body: any): Promise<Response> {
  const { sb, json, audit } = ctx;
  const op = String(body.op ?? "");
  const permisos = ctx.esAdmin ? ["*"] : ctx.user?.permisos ?? [];
  const can = (p: string) => ctx.esAdmin || permisos.includes(p);
  const userId = ctx.esAdmin ? "master" : ctx.user!.id;
  const userName = ctx.actor.nombre ?? "";
  const esSupervisor = can("leads.asignar");
  const veTodoElLocal = esSupervisor || can("leads.local");

  const fallo = (e: any) => {
    if (ctx.isMissingTable(e)) return json({ error: "crm_not_installed" }, 503);
    if (e?.code === "23505") return json({ error: "duplicado" }, 409);
    throw e;
  };
  const err = (error: string, status = 400) => json({ error }, status);

  // Local en el que se trabaja: el de la persona; la cuenta maestra lo elige.
  let localId: string | null = ctx.esAdmin ? (body.localId ? String(body.localId) : null) : ctx.user!.localId;
  if (!ctx.esAdmin && !localId) return err("sin_local");
  const scoped = (q: any) => (localId ? q.eq("local_id", localId) : q);

  /** El administrador puede crear sin elegir local si hay uno solo activo. */
  async function localParaCrear(): Promise<string | null> {
    if (localId) return localId;
    const { data } = await sb.from("locales").select("id, activo");
    const activos = (data ?? []).filter((l: any) => l.activo);
    return activos.length === 1 ? activos[0].id : null;
  }

  /** Filas cuya `columna` está en `ids`, consultadas en lotes (una lista larga haría una dirección demasiado extensa). */
  async function enLotes(tabla: string, columna: string, ids: string[]) {
    const unicos = Array.from(new Set(ids.filter(Boolean)));
    const lotes: string[][] = [];
    for (let i = 0; i < unicos.length; i += 80) lotes.push(unicos.slice(i, i + 80));
    const resp = await Promise.all(lotes.map((l) => sb.from(tabla).select("*").in(columna, l)));
    const out: any[] = [];
    for (const { data, error } of resp) {
      if (error) throw error;
      out.push(...(data ?? []));
    }
    return out;
  }
  const porIds = (tabla: string, ids: string[]) => enLotes(tabla, "id", ids);

  /** Ejecutivos del local habilitados para un tipo de lead: venta, compra o consignación. */
  async function elegibles(local: string, tipo = "venta") {
    const permiso = permisoDeTipo(tipo);
    const overrides = await ctx.rolePermOverrides();
    const { data, error } = await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id").eq("local_id", local);
    if (error) throw error;
    return (data ?? [])
      .filter((u: any) => u.activo)
      .filter((u: any) => {
        const p = permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra);
        return p.includes("leads.propios") && p.includes(permiso);
      })
      .map((u: any) => ({ id: u.id, nombre: u.nombre }));
  }

  /** Cuándo recibió cada persona su último lead DEL MISMO GRUPO de reparto (ventas, o compras y consignaciones): así cada grupo rota por separado. */
  async function ultimasAsignaciones(tipo = "venta") {
    const { data } = await scoped(sb.from("leads").select("asignado_a, creado_en, tipo"));
    const grupo = grupoDeReparto(tipo);
    const out: Record<string, string> = {};
    for (const l of data ?? []) {
      if (grupoDeReparto(l.tipo || "venta") !== grupo) continue;
      if (l.asignado_a && (!out[l.asignado_a] || l.creado_en > out[l.asignado_a])) out[l.asignado_a] = l.creado_en;
    }
    return out;
  }

  /** Tras una acción sobre un lead: ¿hay que pedirle a la persona su próxima acción? (lead abierto y sin ninguna tarea pendiente que aún no venza). */
  async function pedirProximaAccion(leadId: string | null | undefined): Promise<boolean> {
    try {
      if (!leadId) return false;
      const [l, t] = await Promise.all([sb.from("leads").select("id, etapa").eq("id", leadId).maybeSingle(), sb.from("tareas").select("id, vence_en, hecha").eq("lead_id", leadId).eq("hecha", false)]);
      if (!l.data) return false;
      return faltaProximaAccion(l.data, t.error ? [] : t.data ?? []);
    } catch { return false; }
  }

  /** Mueve un lead de compra o consignación a una etapa automática, solo si está en una de las etapas de partida (nunca retrocede ni pisa un cierre). */
  async function avanzarEtapa(leadId: string | null | undefined, desde: string[], hacia: string, motivo: string, tipos: string[] = ["compra", "consignacion"]) {
    try {
      if (!leadId) return;
      const { data: l } = await sb.from("leads").select("id, etapa, tipo").eq("id", leadId).maybeSingle();
      if (!l || !tipos.includes(l.tipo || "venta") || !desde.includes(l.etapa)) return;
      const up = await sb.from("leads").update({ etapa: hacia, actualizado_en: new Date().toISOString() }).eq("id", leadId).eq("etapa", l.etapa);
      if (up.error) return;
      const nombre = (e: string) => etapaDeOperacion(l.tipo, e, etapaNombre(e));
      await evento(leadId, "etapa", `${nombre(l.etapa)} → ${nombre(hacia)} (${motivo})`);
    } catch { /* la etapa es un reflejo: si no se pudo mover, la operación igual sigue */ }
  }

  const tipoCorto = (t: string) => (t === "compra" ? "Compra" : t === "consignacion" ? "Consignación" : "Venta");

  /** Texto con la decisión del Tasador y sus precios (para el historial del lead y el aviso al ejecutivo). */
  function resultadoTasacion(t: any) {
    const retoma = Number(t.valor_retoma) > 0 ? ` Retoma: ${dinero(t.valor_retoma)}.` : "";
    if (t.aplica_para === "consignacion") return `aplica para CONSIGNACIÓN, el dueño recibiría ${dinero(t.valor_consignacion)} (venta estimada ${dinero(t.valor_venta)}).${retoma} Ya se puede registrar el contrato.`;
    if (t.aplica_para === "ambas") return `aplica para COMPRA y CONSIGNACIÓN: compra ${dinero(t.valor_compra)}, consignación ${dinero(t.valor_consignacion)}, venta estimada ${dinero(t.valor_venta)}. Se puede ofertar hasta ${dinero(topeDeOferta(t))} (el precio de consignación).${retoma}`;
    if (t.aplica_para === "ninguna") return `NO aplica para compra ni consignación${t.observaciones ? `: ${t.observaciones}` : ""}.${retoma}`;
    return `aplica para COMPRA, se paga hasta ${dinero(t.valor_compra)} (venta esperada ${dinero(t.valor_venta)}).${retoma} Ya se puede hacer la oferta.`;
  }

  /**
   * Cambia el tipo de un lead entre compra y consignación. Sigue con el mismo ejecutivo si está habilitado para el nuevo tipo; si no, pasa a quien
   * corresponda por el reparto.
   */
  async function cambiarTipoLead(lead: any, nuevoTipo: string, razon: string, extraAuditoria: Record<string, unknown> = {}) {
    const cands = await elegibles(lead.local_id, nuevoTipo);
    let asignado = lead.asignado_a && cands.some((c: any) => c.id === lead.asignado_a) ? { id: lead.asignado_a, nombre: "" } : null;
    if (!asignado) asignado = elegirAsignado(cands, await ultimasAsignaciones(nuevoTipo)) ?? null;
    const up = await sb.from("leads").update({ tipo: nuevoTipo, asignado_a: asignado ? asignado.id : lead.asignado_a, actualizado_en: new Date().toISOString() }).eq("id", lead.id);
    if (up.error) return { ok: false as const, cambio: false, asignadoId: null as string | null };
    const cambio = !!asignado && asignado.id !== lead.asignado_a;
    await evento(lead.id, "tipo", `El lead pasó de ${tipoCorto(lead.tipo)} a ${tipoCorto(nuevoTipo)} ${razon}${cambio ? "; se reasignó a un ejecutivo habilitado para ese tipo" : ""}`);
    await audit(ctx.actor, "lead.cambiar_tipo", "lead", lead.id, { de: lead.tipo, a: nuevoTipo, ...extraAuditoria, reasignado: cambio });
    return { ok: true as const, cambio, asignadoId: asignado ? asignado.id : null };
  }

  /**
   * El resultado vuelve al ejecutivo del lead (y a quien pidió la tasación). Si el Tasador decidió que el vehículo aplica para el otro tipo
   * (compra ↔ consignación), el lead cambia de tipo; sigue con el mismo ejecutivo si está habilitado para ese tipo y, si no, pasa a quien corresponda por el reparto.
   */
  async function devolverResultadoAlEjecutivo(t: any, data: any, verbo = "completó") {
    try {
      const lead = await cargarLead(t.lead_id);
      if (!lead) return;
      const vh = data.vehiculo || {};
      const lineas = [`${userName} ${verbo} la tasación ${folioTasacion(t.numero)}${vh.marca ? ` de ${vh.marca} ${vh.modelo || ""}` : ""}: ${resultadoTasacion(data)}`];
      const nuevoTipo = data.aplica_para === "compra" || data.aplica_para === "consignacion" ? data.aplica_para : null;
      let destinatarios: string[] = [t.solicitante_id, lead.asignado_a].filter(Boolean);
      if (nuevoTipo && lead.tipo !== nuevoTipo && ["compra", "consignacion"].includes(lead.tipo) && !ETAPAS_CERRADAS.includes(lead.etapa)) {
        const r = await cambiarTipoLead(lead, nuevoTipo, "por decisión del Tasador", { por_tasacion: t.id });
        if (r.ok) {
          lineas.push(`El lead pasó de ${tipoCorto(lead.tipo)} a ${tipoCorto(nuevoTipo)}${r.cambio ? " y se reasignó a un ejecutivo habilitado" : ""}.`);
          if (r.cambio && r.asignadoId) destinatarios = [...destinatarios, r.asignadoId];
        }
      }
      await avisarA(destinatarios, verbo === "completó" ? "Tasación completada" : "Tasación corregida", lineas);
    } catch (e) { console.error("devolverResultadoAlEjecutivo:", String((e as any)?.message ?? e)); }
  }

  async function evento(leadId: string, tipo: string, detalle: string) {
    const { error } = await sb.from("lead_eventos").insert({ lead_id: leadId, usuario_id: userId, usuario_nombre: userName, tipo, detalle });
    if (error) console.error("lead_eventos error:", error.message);
    // Marca de la última actividad del lead (para detectar los detenidos). Si la columna aún no existe, se ignora.
    await sb.from("leads").update({ ultima_actividad: new Date().toISOString() }).eq("id", leadId);
  }

  async function cargarLead(id: string) {
    const { data, error } = await scoped(sb.from("leads").select("*").eq("id", id)).maybeSingle();
    if (error) throw error;
    return data;
  }
  /** Avisos por correo a personas del CRM (nunca a quien hizo la acción). Son un extra: si algo falla, la operación sigue igual. */
  async function avisarA(ids: string[], asunto: string, lineas: string[], ruta?: string) {
    try {
      if (!correoActivo()) return;
      const unicos = Array.from(new Set(ids.filter((i) => i && i !== userId)));
      if (unicos.length === 0) return;
      const us = await enLotes("usuarios", "id", unicos);
      const para = us.filter((u: any) => u.activo && u.email).map((u: any) => u.email);
      if (para.length === 0) { await audit(ctx.actor, "aviso.omitido", "aviso", undefined, { asunto, motivo: "la persona no tiene correo en su ficha o está inactiva" }); return; }
      await enSegundoPlano(enviarAviso({ para, asunto, titulo: asunto, lineas, ruta }, (error) => audit(ctx.actor, "aviso.fallido", "aviso", undefined, { asunto, error })));
    } catch (e) { console.error("avisarA:", String((e as any)?.message ?? e)); }
  }
  /** Avisa a los Validadores del local que hay documentos nuevos en su cola. */
  async function avisarValidadores(local: string, asunto: string, lineas: string[]) {
    try {
      if (!correoActivo() || !local) return;
      const overrides = await ctx.rolePermOverrides();
      const { data, error } = await sb.from("usuarios").select("id, roles, permisos_extra, activo, local_id").eq("local_id", local);
      if (error) throw error;
      const ids = (data ?? []).filter((u: any) => u.activo && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("validacion.realizar")).map((u: any) => u.id);
      await avisarA(ids, asunto, lineas);
    } catch (e) { console.error("avisarValidadores:", String((e as any)?.message ?? e)); }
  }
  /** Avisa a quienes aprueban (Jefes Local) del local. */
  async function avisarSupervisores(local: string, asunto: string, lineas: string[]) {
    try {
      if (!correoActivo() || !local) return;
      const overrides = await ctx.rolePermOverrides();
      const { data, error } = await sb.from("usuarios").select("id, roles, permisos_extra, activo, local_id").eq("local_id", local);
      if (error) throw error;
      const ids = (data ?? []).filter((u: any) => u.activo && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("leads.asignar")).map((u: any) => u.id);
      await avisarA(ids, asunto, lineas);
    } catch (e) { console.error("avisarSupervisores:", String((e as any)?.message ?? e)); }
  }
  /** Datos básicos de un lead para los textos de los avisos. */
  async function resumenDeLead(leadId: string | null | undefined) {
    try {
      if (!leadId) return null;
      const { data: l } = await sb.from("leads").select("id, asignado_a, local_id, cliente_id, tipo").eq("id", leadId).maybeSingle();
      if (!l) return null;
      const { data: c } = l.cliente_id ? await sb.from("clientes").select("nombre").eq("id", l.cliente_id).maybeSingle() : { data: null };
      return { ...l, cliente: (c && c.nombre) || "cliente" };
    } catch { return null; }
  }
  /** Avisa a quien trabaja el lead (su ejecutivo). */
  async function avisarEjecutivoDe(leadId: string | null | undefined, asunto: string, detalle: string) {
    if (!correoActivo()) return;
    const l = await resumenDeLead(leadId);
    if (l && l.asignado_a) await avisarA([l.asignado_a], asunto, [`Lead de ${l.cliente}.`, detalle]);
  }

  /** Lo máximo que se le puede reconocer al cliente por su vehículo en parte de pago: lo tasado (o null si no hay tasación). */
  async function topeDeLead(lead: any): Promise<number | null> {
    const id = lead && lead.parte_pago && lead.parte_pago.tasacion_id;
    if (!id) return null;
    const { data } = await sb.from("tasaciones").select("*").eq("id", id).maybeSingle();
    return topeParteDePago(data);
  }
  const puedeVer = (lead: any) => veTodoElLocal || lead.asignado_a === userId;
  const puedeTocar = (lead: any) => puedeEditarLead({ permisos: ctx.esAdmin ? ["leads.asignar"] : permisos, esAdmin: ctx.esAdmin, usuarioId: userId, lead });


  /* ---------- validaciones: creación automática y exigencia ---------- */
  /** ¿Hay al menos un Validador activo en el local? Si no, ninguna aprobación se frena esperando una validación. */
  async function hayValidadores(local: string) {
    const overrides = await ctx.rolePermOverrides();
    const { data, error } = await sb.from("usuarios").select("id, roles, permisos_extra, activo, local_id").eq("local_id", local);
    if (error) throw error;
    return (data ?? []).some((u: any) => u.activo && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("validacion.realizar"));
  }
  /** Crea una validación con su lista de documentos (reutiliza los del vehículo ya aprobados). null si las tablas aún no existen. */
  async function crearValidacion(p: { tipo: string; local_id: string; cierre_id?: string; compra_id?: string; consignacion_id?: string; reutilizarDe?: string; sinEnviar?: boolean; lead_id?: string | null; vehiculo_id?: string | null; tasacion_id?: string | null; sujeto: Record<string, unknown>; opciones?: { conFinanciamiento?: boolean; conParteDePago?: boolean } }) {
    try {
      const ins = await sb.from("validaciones").insert({
        local_id: p.local_id, tipo: p.tipo, cierre_id: p.cierre_id ?? null, lead_id: p.lead_id ?? null, vehiculo_id: p.vehiculo_id ?? null,
        tasacion_id: p.tasacion_id ?? null, sujeto: p.sujeto, creado_por: userId,
        // Las de compra y consignación nacen «sin enviar»: entran a la cola del Validador cuando el ejecutivo las envía con todo completo.
        enviada_en: p.sinEnviar ? null : new Date().toISOString(),
        ...(p.compra_id ? { compra_id: p.compra_id } : {}), ...(p.consignacion_id ? { consignacion_id: p.consignacion_id } : {}),
      }).select().single();
      if (ins.error) { if (ctx.isMissingTable(ins.error)) return null; throw ins.error; }
      const v = ins.data;
      let reutil: Record<string, any> = {};
      if (p.tipo !== "vehiculo" && p.tipo !== "compra" && p.tipo !== "consignacion" && p.vehiculo_id) {
        const o = await sb.from("validaciones").select("*").eq("vehiculo_id", p.vehiculo_id).eq("tipo", "vehiculo").eq("estado", "aprobada");
        const origen = (o.data ?? [])[0];
        if (origen) reutil = docsReutilizables(await enLotes("validacion_docs", "validacion_id", [origen.id]), origen.id);
      }
      // Un vehículo recién comprado o consignado hereda como aprobados los documentos del vehículo ya revisados en la operación.
      if (p.reutilizarDe && p.tipo !== "compra" && p.tipo !== "consignacion") reutil = docsReutilizables(await enLotes("validacion_docs", "validacion_id", [p.reutilizarDe]), p.reutilizarDe);
      const docs = checklistPara(p.tipo, p.opciones).map((d, i) => ({ validacion_id: v.id, ...filaDoc(d), orden: i, ...(reutil[d.clave] ?? {}) }));
      const di = await sb.from("validacion_docs").insert(docs);
      if (di.error) throw di.error;
      const estado = estadoDeValidacion(docs, false);
      if (estado !== v.estado) { const u = await sb.from("validaciones").update({ estado, resuelta_en: estado === "aprobada" ? new Date().toISOString() : null }).eq("id", v.id).select().single(); return u.data ?? v; }
      return v;
    } catch (e) { console.error("crearValidacion:", (e as any)?.message ?? e); return null; }
  }
  const sujetoDeVehiculo = (v: any, extra: Record<string, unknown> = {}) => ({ patente: v.patente, marca: v.marca, modelo: v.modelo, anio: v.anio, ...extra });

  /**
   * Qué falta para concretar una compra: datos críticos del vendedor y los 11 documentos (con su vencimiento y precio). Si la compra no tiene
   * validación todavía, se crea. Las compras que ya venían con la lista anterior de documentos siguen con su regla de siempre (aplica: false).
   */
  async function requisitosDeCompra(c: any) {
    const vq = await sb.from("validaciones").select("*").eq("compra_id", c.id);
    if (vq.error) { if (ctx.isMissingTable(vq.error)) return { aplica: false, val: null, docs: [], cliente: null, faltantes: [] as any[] }; throw vq.error; }
    let val: any = (vq.data ?? []).filter((x: any) => x.estado !== "cancelada").sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en)))[0] ?? null;
    if (!val) val = await crearValidacion({ tipo: "compra", local_id: c.local_id, compra_id: c.id, lead_id: c.lead_id, tasacion_id: c.tasacion_id, sinEnviar: true, sujeto: sujetoDeVehiculo(c.vehiculo || {}, { folio: folioCompra(c.numero) }) });
    if (!val) return { aplica: false, val: null, docs: [], cliente: null, faltantes: [] as any[] };
    const docs = (await enLotes("validacion_docs", "validacion_id", [val.id])).sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
    if (!esChecklistCompraActual(docs)) return { aplica: false, val, docs, cliente: null, faltantes: [] as any[] };
    const cl = c.cliente_id ? (await sb.from("clientes").select("*").eq("id", c.cliente_id).maybeSingle()).data : null;
    return { aplica: true, val, docs, cliente: cl, faltantes: faltantesCompra({ cliente: cl, docs }) };
  }

  /**
   * Qué falta para registrar una consignación: datos del dueño y los 9 documentos. La validación se crea al pedir los requisitos (antes de
   * existir el contrato) ligada al lead, y el contrato la toma al registrarse.
   */
  async function requisitosDeConsignacion(lead: any) {
    const vq = await sb.from("validaciones").select("*").eq("lead_id", lead.id).eq("tipo", "consignacion");
    if (vq.error) { if (ctx.isMissingTable(vq.error)) return { aplica: false, val: null, docs: [], cliente: null, faltantes: [] as any[] }; throw vq.error; }
    const propias = (vq.data ?? []).filter((x: any) => x.estado !== "cancelada" && !x.consignacion_id);
    let val: any = propias.sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en)))[0] ?? null;
    if (!val) {
      const ofr = lead.vehiculo_ofrecido || {};
      val = await crearValidacion({ tipo: "consignacion", local_id: lead.local_id, lead_id: lead.id, sinEnviar: true, sujeto: sujetoDeVehiculo(ofr, {}) });
    }
    if (!val) return { aplica: false, val: null, docs: [], cliente: null, faltantes: [] as any[] };
    const docs = (await enLotes("validacion_docs", "validacion_id", [val.id])).sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
    const cl = lead.cliente_id ? (await sb.from("clientes").select("*").eq("id", lead.cliente_id).maybeSingle()).data : null;
    return { aplica: true, val, docs, cliente: cl, faltantes: faltantesConsignacion({ cliente: cl, docs }) };
  }

  /** Aprueba una compra: exige los documentos validados (si hay Validadores) y entrega el vehículo al inventario. */
  async function aprobarCompra(c: any): Promise<{ ok: boolean; error?: string; compra?: any }> {
    // Sin todos los datos del vendedor y sus documentos, la compra no se concreta.
    const req = await requisitosDeCompra(c);
    if (req.aplica && req.faltantes.length > 0) return { ok: false, error: "compra_incompleta" };
    let valCompra: any = null;
    if (await hayValidadores(c.local_id)) {
      const vq = await sb.from("validaciones").select("*").eq("compra_id", c.id);
      if (!vq.error) {
        const activas = (vq.data ?? []).filter((x: any) => x.estado !== "cancelada");
        valCompra = activas.find((x: any) => x.estado === "aprobada") || activas[0];
        if (!valCompra) valCompra = await crearValidacion({ tipo: "compra", local_id: c.local_id, compra_id: c.id, lead_id: c.lead_id, tasacion_id: c.tasacion_id, sujeto: sujetoDeVehiculo(c.vehiculo || {}, { folio: folioCompra(c.numero) }) });
        if (valCompra && valCompra.estado !== "aprobada") return { ok: false, error: "validacion_pendiente" };
      }
    } else {
      const vq = await sb.from("validaciones").select("*").eq("compra_id", c.id);
      valCompra = (vq.data ?? []).find((x: any) => x.estado === "aprobada") || null;
    }
    const { data: tas } = c.tasacion_id ? await sb.from("tasaciones").select("*").eq("id", c.tasacion_id).maybeSingle() : { data: null };
    const vv = vehiculoDeCompra(c, tas);
    const dup = await sb.from("vehiculos").select("id").eq("patente", vv.patente).eq("activo", true);
    if ((dup.data ?? []).length > 0) return { ok: false, error: "patente_duplicada" };
    const vi = await sb.from("vehiculos").insert({ ...vv, local_id: c.local_id, notas: `Comprado: ${folioCompra(c.numero)}` }).select().single();
    if (vi.error) { if (vi.error.code === "23505") return { ok: false, error: "patente_duplicada" }; throw vi.error; }
    const ahora = new Date().toISOString();
    const { data, error } = await sb.from("compras").update({ estado: "comprada", aprobado_por: userName, aprobado_en: ahora, mes: mesChile(ahora), vehiculo_id: vi.data.id, motivo_rechazo_pago: null, actualizado_en: ahora }).eq("id", c.id).select().single();
    if (error) throw error;
    await sb.from("leads").update({ etapa: "ganado", actualizado_en: ahora }).eq("id", c.lead_id);
    await evento(c.lead_id, "compra", `Compra ${folioCompra(c.numero)} aprobada por ${userName}: ${dinero(c.monto_final)}. El vehículo entró al inventario en preparación. Cuenta para la comisión de ${nombreMes(mesChile(ahora))}.`);
    await evento(c.lead_id, "etapa", "Oferta aceptada → Comprado");
    await audit(ctx.actor, "compra.aprobar", "compra", c.id, { numero: c.numero, monto_final: c.monto_final, mes: mesChile(ahora), vehiculo_id: vi.data.id, ejecutivo_id: c.ejecutivo_id });
    // El vehículo nuevo hereda como aprobados los documentos del vehículo ya revisados en la compra.
    await crearValidacion({ tipo: "vehiculo", local_id: c.local_id, vehiculo_id: vi.data.id, sujeto: sujetoDeVehiculo(vi.data), reutilizarDe: valCompra ? valCompra.id : undefined });
    return { ok: true, compra: data };
  }

  /** Activa una consignación: el vehículo entra al inventario como «consignado» y el lead queda ganado. */
  async function activarConsignacion(c: any): Promise<{ ok: boolean; error?: string; consignacion?: any }> {
    const dup = await sb.from("vehiculos").select("id").eq("patente", c.patente).eq("activo", true);
    if ((dup.data ?? []).length > 0) return { ok: false, error: "patente_duplicada" };
    const vi = await sb.from("vehiculos").insert({ ...vehiculoDeConsignacion(c), local_id: c.local_id, notas: `Consignado: ${folioConsignacion(c.numero)}` }).select().single();
    if (vi.error) { if (vi.error.code === "23505") return { ok: false, error: "patente_duplicada" }; throw vi.error; }
    const ahora = new Date().toISOString();
    const { data, error } = await sb.from("consignaciones").update({ estado: "vigente", vehiculo_id: vi.data.id, activada_en: ahora, vence_en: vencimientoConsignacion(ahora, Number(c.plazo_dias)), actualizado_en: ahora }).eq("id", c.id).select().single();
    if (error) throw error;
    await sb.from("leads").update({ etapa: "ganado", actualizado_en: ahora }).eq("id", c.lead_id);
    await evento(c.lead_id, "consignacion", `Consignación ${folioConsignacion(c.numero)} vigente: el vehículo entró al inventario (piso ${dinero(c.precio_piso)}, publicado en ${dinero(c.precio_publicacion)}). Vence el ${data.vence_en}.`);
    await evento(c.lead_id, "etapa", "En validación → Consignado");
    await audit(ctx.actor, "consignacion.activar", "consignacion", c.id, { numero: c.numero, vehiculo_id: vi.data.id });
    const vq = await sb.from("validaciones").select("*").eq("consignacion_id", c.id);
    const val = (vq.data ?? []).find((x: any) => x.estado === "aprobada");
    await crearValidacion({ tipo: "vehiculo", local_id: c.local_id, vehiculo_id: vi.data.id, sujeto: sujetoDeVehiculo(vi.data), reutilizarDe: val ? val.id : undefined });
    return { ok: true, consignacion: data };
  }


  /** Avisos publicados o pausados con algo que corregir (precio distinto, vehículo vendido o reservado, vencimiento). */
  async function avisosConAlertas() {
    const aq = await scoped(sb.from("anuncios").select("*"));
    if (aq.error) return [];
    const activos: any[] = (aq.data ?? []).filter((a: any) => a.estado === "publicado" || a.estado === "pausado");
    if (activos.length === 0) return [];
    const vehs = await porIds("vehiculos", activos.map((a) => a.vehiculo_id));
    const portales = await enLotes("anuncio_portales", "anuncio_id", activos.map((a) => a.id));
    const ahora = new Date();
    return activos.map((a) => {
      const v = vehs.find((x: any) => x.id === a.vehiculo_id) || {};
      return { id: a.id, folio: folioAnuncio(a.numero), vehiculo: `${v.marca ?? ""} ${v.modelo ?? ""} ${v.anio ?? ""} · ${v.patente ?? ""}`.trim(), alertas: alertasAnuncio(portales.filter((p: any) => p.anuncio_id === a.id), v, ahora) };
    }).filter((x) => x.alertas.length > 0);
  }


  /** Campaña elegida para un lead: debe ser del local y estar aprobada (o ser la que el lead ya tiene). */
  async function resolverCampania(raw: unknown, local: string, actual: string | null = null): Promise<{ ok: boolean; id: string | null }> {
    const id = raw ? String(raw) : null;
    if (!id) return { ok: true, id: null };
    if (id === actual) return { ok: true, id };
    const { data, error } = await sb.from("campanias").select("id, local_id, estado").eq("id", id).maybeSingle();
    if (error || !data || data.local_id !== local || data.estado !== "aprobada") return { ok: false, id: null };
    return { ok: true, id };
  }

  const usaLeads = can("leads.propios") || can("leads.local") || can("leads.asignar");

  async function configNegocio() {
    const { data, error } = await sb.from("config_negocio").select("clave, valor");
    if (error) throw error;
    const guardada: Record<string, unknown> = {};
    for (const r of data ?? []) guardada[r.clave] = r.valor;
    return configCompleta(guardada);
  }

  const dinero = (n: number) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;
  const sinCosto = (c: any, ver: boolean) => (ver ? c : { ...c, costo: null, margen: null });
  const fechaCL = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", timeZone: "America/Santiago" });

  /** Reserva activa de un lead (o null; tolera que las tablas de la entrega 2B aún no existan). */
  async function reservaActivaDeLead(leadId: string) {
    const { data, error } = await sb.from("reservas").select("*").eq("lead_id", leadId).eq("estado", "activa").maybeSingle();
    if (error) { if (ctx.isMissingTable(error)) return null; throw error; }
    return data ?? null;
  }

  /** ¿Este vehículo tiene una venta aprobada? Entonces solo se libera anulando el cierre. */
  async function cierreAprobadoDeVehiculo(vehiculoId: string) {
    const { data, error } = await sb.from("cierres").select("id").eq("vehiculo_id", vehiculoId).eq("estado", "aprobada").maybeSingle();
    if (error) { if (ctx.isMissingTable(error)) return null; throw error; }
    return data ?? null;
  }

  /**
   * Cierra una reserva (vencida o cancelada) y deja todo como estaba: el vehículo vuelve a "disponible",
   * la cotización a "vigente" y, si corresponde, el lead a "Cotizado". `sistema` = lo hace el sistema solo.
   */
  async function cerrarReserva(r: any, nuevoEstado: "vencida" | "cancelada", motivo: string, opciones: { volverACotizado: boolean; sistema?: boolean }) {
    const ahora = new Date().toISOString();
    await sb.from("reservas").update({ estado: nuevoEstado, motivo, cerrado_en: ahora }).eq("id", r.id).eq("estado", "activa");
    // Si había un cierre de venta esperando aprobación, ya no tiene reserva que lo respalde.
    await sb.from("cierres").update({ estado: "anulada", motivo_anulacion: "La reserva dejó de estar activa", anulado_en: ahora, actualizado_en: ahora }).eq("reserva_id", r.id).eq("estado", "pendiente");
    await sb.from("vehiculos").update({ estado: "disponible", actualizado_en: ahora }).eq("id", r.vehiculo_id).eq("estado", "reservado");
    if (r.cotizacion_id) await sb.from("cotizaciones").update({ estado: "vigente", actualizado_en: ahora }).eq("id", r.cotizacion_id).eq("estado", "reservada");
    if (opciones.volverACotizado) await sb.from("leads").update({ etapa: "cotizado", actualizado_en: ahora }).eq("id", r.lead_id).eq("etapa", "reservado");
    const detalle = nuevoEstado === "vencida" ? "La reserva venció: el vehículo volvió a estar disponible." : `Reserva cancelada${motivo ? ` (${motivo})` : ""}: el vehículo volvió a estar disponible.`;
    await sb.from("lead_eventos").insert({ lead_id: r.lead_id, usuario_id: opciones.sistema ? "sistema" : userId, usuario_nombre: opciones.sistema ? "Sistema" : userName, tipo: "reserva", detalle });
    await audit(opciones.sistema ? { tipo: "sistema", nombre: "Sistema" } : ctx.actor, nuevoEstado === "vencida" ? "reserva.vencer" : "reserva.cancelar", "reserva", r.id, { vehiculo_id: r.vehiculo_id, monto: r.monto, motivo });
  }

  /** Libera las reservas cuyo plazo ya pasó. Se ejecuta al abrir inventario, leads, cotizaciones o reservas. */
  async function liberarVencidas() {
    const { data, error } = await scoped(sb.from("reservas").select("*").eq("estado", "activa").lt("vence_en", new Date().toISOString()));
    if (error) { if (ctx.isMissingTable(error)) return; throw error; }
    if ((data ?? []).length === 0) return;
    // Una reserva con un cierre de venta esperando aprobación no se libera sola: decide el supervisor.
    const enCierre = new Set<string>();
    const cp = await scoped(sb.from("cierres").select("reserva_id").eq("estado", "pendiente"));
    if (!cp.error) for (const c of cp.data ?? []) if (c.reserva_id) enCierre.add(c.reserva_id);
    for (const r of (data ?? []).filter((x: any) => reservaVencida(x) && !enCierre.has(x.id))) await cerrarReserva(r, "vencida", "Venció el plazo", { volverACotizado: true, sistema: true });
  }
  if (/^(inventario\.list|leads\.|cotizaciones\.|reservas\.|gestion\.)/.test(op)) await liberarVencidas();

  /* ---------- catálogos para las pantallas ---------- */
  if (op === "catalogos") {
    let c;
    try { c = await configNegocio(); } catch (e) { return fallo(e); }
    let locales: unknown[] = [];
    if (ctx.esAdmin) {
      const l = await sb.from("locales").select("id, nombre, activo").order("creado_en");
      locales = l.data ?? [];
    }
    let campanias: unknown[] = [];
    const cq = await scoped(sb.from("campanias").select("id, nombre, canal, estado").eq("estado", "aprobada"));
    if (!cq.error) campanias = (cq.data ?? []).map((x: any) => ({ id: x.id, nombre: x.nombre, canal: x.canal }));
    return json({
      campanias,
      fuentes_lead: c.fuentes_lead, motivos_perdida: c.motivos_perdida, meta_mensual_unidades: c.meta_mensual_unidades,
      financieras: FINANCIERAS, locales, etapas: ETAPAS,
      dias_reserva: c.dias_reserva, vigencia_cotizacion_dias: c.vigencia_cotizacion_dias, condiciones_cotizacion: c.condiciones_cotizacion,
    });
  }

  /* ---------- inventario ---------- */
  if (op.startsWith("inventario.")) {
    if (op === "inventario.list") {
      if (!can("inventario.ver") && !can("inventario.editar") && !usaLeads) return err("forbidden", 403);
      const { data, error } = await scoped(sb.from("vehiculos").select("*").eq("activo", true).order("creado_en", { ascending: false }));
      if (error) return fallo(error);
      const puedeCosto = can("inventario.editar");
      // Para los vehículos reservados, hasta cuándo dura la reserva.
      const vence: Record<string, string> = {};
      const res = await scoped(sb.from("reservas").select("vehiculo_id, vence_en").eq("estado", "activa"));
      if (!res.error) for (const r of res.data ?? []) vence[r.vehiculo_id] = r.vence_en;
      const vehiculos = (data ?? []).slice(0, MAX_LISTA).map((v: any) => ocultarCosto({ ...v, reserva_vence_en: vence[v.id] ?? null }, puedeCosto));
      return json({ vehiculos, puedeEditar: can("inventario.editar") });
    }

    if (!can("inventario.editar")) return err("forbidden", 403);

    if (op === "inventario.save") {
      const v = validarVehiculo(body.datos);
      if (!v.ok) return err(v.error!);
      const id = body.id ? String(body.id) : "";
      // "Reservado" lo pone el sistema al reservar; no se asigna a mano.
      if (v.value.estado === "reservado" && !id) return err("estado_automatico");
      if (!id) {
        const local = await localParaCrear();
        if (!local) return err("sin_local");
        const { data, error } = await sb.from("vehiculos").insert({ ...v.value, local_id: local, creado_por: ctx.esAdmin ? null : userId }).select().single();
        if (error) return error.code === "23505" ? err("patente_duplicada", 409) : fallo(error);
        await audit(ctx.actor, "vehiculo.crear", "vehiculo", data.id, { patente: data.patente, marca: data.marca, modelo: data.modelo });
        await crearValidacion({ tipo: "vehiculo", local_id: local, vehiculo_id: data.id, sujeto: sujetoDeVehiculo(data) });
        return json({ vehiculo: data });
      }
      const { data: antes } = await scoped(sb.from("vehiculos").select("*").eq("id", id)).maybeSingle();
      if (!antes) return err("no_existe", 404);
      const pisoInv = verificarPisoConsignado(antes, v.value.precio_lista);
      if (v.value.precio_lista != null && !pisoInv.ok) return err(pisoInv.error!);
      // Un vehículo con reserva activa conserva su estado; y nadie lo pone "reservado" a mano.
      if (antes.estado === "reservado") v.value.estado = "reservado";
      else if (v.value.estado === "reservado") return err("estado_automatico");
      if (antes.estado === "vendido" && (await cierreAprobadoDeVehiculo(antes.id))) v.value.estado = "vendido";
      const { data, error } = await sb.from("vehiculos").update({ ...v.value, actualizado_en: new Date().toISOString() }).eq("id", id).select().single();
      if (error) return error.code === "23505" ? err("patente_duplicada", 409) : fallo(error);
      const cambios: Record<string, unknown> = {};
      for (const k of ["precio_lista", "costo", "estado", "km"]) if (antes[k] !== data[k]) cambios[k] = { antes: antes[k], despues: data[k] };
      await audit(ctx.actor, "vehiculo.editar", "vehiculo", id, { patente: data.patente, cambios });
      return json({ vehiculo: data });
    }

    if (op === "inventario.setEstado") {
      const estado = String(body.estado ?? "");
      if (!ESTADOS_VEHICULO.some((e) => e.id === estado)) return err("estado_invalido");
      const { data: antes } = await scoped(sb.from("vehiculos").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
      if (!antes) return err("no_existe", 404);
      if (estado === "reservado") return err("estado_automatico");
      if (antes.estado === "reservado") return err("vehiculo_reservado");
      if (antes.estado === "vendido" && (await cierreAprobadoDeVehiculo(antes.id))) return err("vehiculo_vendido");
      const { data, error } = await sb.from("vehiculos").update({ estado, actualizado_en: new Date().toISOString() }).eq("id", antes.id).select().single();
      if (error) return fallo(error);
      await audit(ctx.actor, "vehiculo.estado", "vehiculo", antes.id, { patente: antes.patente, antes: antes.estado, despues: estado });
      return json({ vehiculo: data });
    }

    if (op === "inventario.archivar") {
      const { data: antes } = await scoped(sb.from("vehiculos").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
      if (!antes) return err("no_existe", 404);
      if (antes.estado === "reservado") return err("vehiculo_reservado");
      if (antes.estado === "vendido" && (await cierreAprobadoDeVehiculo(antes.id))) return err("vehiculo_vendido");
      const { error } = await sb.from("vehiculos").update({ activo: false, actualizado_en: new Date().toISOString() }).eq("id", antes.id);
      if (error) return fallo(error);
      await audit(ctx.actor, "vehiculo.archivar", "vehiculo", antes.id, { patente: antes.patente });
      return json({ ok: true });
    }
    return err("unknown_op");
  }

  /* ---------- tasaciones (Tasador y solicitudes de los ejecutivos) ---------- */
  // Datos de un vehículo (marca, modelo, año) a partir de su patente, con la API de Boostr. Cada patente se guarda PARA SIEMPRE en la base de
  // datos: la segunda consulta (de quien sea, del CRM o del sitio web) no gasta cupo. Ver patentes.ts.
  if (op === "vehiculos.patente") {
    const permitido = ctx.esAdmin || ["inventario.editar", "tasaciones.realizar", "tasaciones.pedir", "tasaciones.usar", "inspecciones.realizar", "inspecciones.pedir", "inspecciones.usar", "tasacion_compra.usar", "leads.propios", "leads.asignar", "compras.operar", "consignaciones.operar"].some((x) => can(x));
    if (!permitido) return err("forbidden", 403);
    const ahora = Date.now();
    const mio = consultasPorPersona.get(userId);
    if (mio && mio.reset > ahora) { mio.n++; if (mio.n > LIMITE_POR_MINUTO) return err("demasiadas_consultas", 429); }
    else consultasPorPersona.set(userId, { n: 1, reset: ahora + 60_000 });
    const r = await consultarPatente(sb, body.patente, "interno", ctx.isMissingTable);
    if (!r.ok) return err(r.error, r.status);
    return json({ vehiculo: r.vehiculo, origen: r.origen });
  }

  // Habilitaciones de los ejecutivos del local: Ventas la trae todo ejecutivo nuevo; Compras y Consignaciones las activa el Jefe Local (o el Administrador).
  if (op === "equipo.habilitaciones" || op === "equipo.habilitar") {
    if (!esSupervisor) return err("forbidden", 403);
    const overrides = await ctx.rolePermOverrides();
    const vista = (u: any) => {
      const ef = permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra);
      return { id: u.id, nombre: u.nombre, activo: !!u.activo, ventas: ef.includes("ventas.operar"), compras: ef.includes("compras.operar"), consignaciones: ef.includes("consignaciones.operar") };
    };
    if (op === "equipo.habilitaciones") {
      let q = sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id");
      if (localId) q = q.eq("local_id", localId);
      const { data, error } = await q;
      if (error) throw error;
      const ejecutivos = (data ?? []).filter((u: any) => (u.roles ?? []).includes("ejecutivo")).sort((a: any, b: any) => String(a.nombre).localeCompare(String(b.nombre), "es")).map(vista);
      return json({ ejecutivos });
    }
    const permiso = String(body.permiso ?? "");
    if (!["compras.operar", "consignaciones.operar"].includes(permiso)) return err("permiso_invalido");
    if (typeof body.activo !== "boolean") return err("valor_invalido");
    const { data: u, error } = await sb.from("usuarios").select("*").eq("id", String(body.usuarioId ?? "")).maybeSingle();
    if (error) throw error;
    if (!u || (!ctx.esAdmin && u.local_id !== localId)) return err("no_existe", 404);
    if (!(u.roles ?? []).includes("ejecutivo")) return err("no_es_ejecutivo");
    const e = limpiarExtra(u.permisos_extra);
    const otorgar = e.otorgar.filter((x: string) => x !== permiso);
    const quitar = e.quitar.filter((x: string) => x !== permiso);
    if (body.activo) otorgar.push(permiso);
    else if (permisosEfectivos(u.roles ?? [], overrides, { otorgar, quitar }).includes(permiso)) quitar.push(permiso); // si el rol ya se lo da por defecto, se le quita expresamente
    const antes = vista(u);
    const up = await sb.from("usuarios").update({ permisos_extra: { otorgar, quitar }, actualizado_en: new Date().toISOString() }).eq("id", u.id).select().single();
    if (up.error) throw up.error;
    if (ctx.dropLive) ctx.dropLive();
    const despues = vista(up.data);
    await audit(ctx.actor, "usuario.habilitar", "usuario", u.id, { nombre: u.nombre, permiso, activo: body.activo, antes: { compras: antes.compras, consignaciones: antes.consignaciones }, despues: { compras: despues.compras, consignaciones: despues.consignaciones } });
    return json({ ejecutivo: despues });
  }

  // Carga de trabajo del equipo (Jefe Local): quién tiene qué pendiente y qué está atrasado.
  if (op === "equipo.carga") {
    if (!esSupervisor) return err("forbidden", 403);
    const cfg = await configNegocio();
    let qu = sb.from("usuarios").select("id, nombre, roles, activo, local_id");
    if (localId) qu = qu.eq("local_id", localId);
    const [us, ls, ts] = await Promise.all([qu, scoped(sb.from("leads").select("*")), scoped(sb.from("tareas").select("lead_id, vence_en").eq("hecha", false))]);
    if (us.error) return fallo(us.error);
    if (ls.error) return fallo(ls.error);
    const ejecutivos = (us.data ?? []).filter((u: any) => u.activo && (u.roles ?? []).includes("ejecutivo")).map((u: any) => ({ id: u.id, nombre: u.nombre }));
    const carga = cargaDelEquipo({ ejecutivos, leads: ls.data ?? [], tareasPendientes: ts.error ? [] : (ts.data ?? []), ahora: new Date(), cfg });
    return json({ ...carga, plazos: { primerContacto: cfg.horas_primer_contacto, jefe: cfg.horas_sin_contacto, detenido: cfg.dias_detenido } });
  }

  if (op.startsWith("tasaciones.")) {
    const realiza = can("tasaciones.realizar");
    const puedePedir = can("tasaciones.pedir") || esSupervisor;
    if (!realiza && !puedePedir && !esSupervisor) return err("forbidden", 403);

    /** Personas activas del local que pueden realizar tasaciones. */
    async function tasadoresDe(local: string) {
      const overrides = await ctx.rolePermOverrides();
      const { data, error } = await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id").eq("local_id", local);
      if (error) throw error;
      return (data ?? [])
        .filter((u: any) => u.activo && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("tasaciones.realizar"))
        .map((u: any) => ({ id: u.id, nombre: u.nombre }));
    }
    async function cargarTasacion(id: string) {
      const { data, error } = await scoped(sb.from("tasaciones").select("*").eq("id", id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    /** ¿Puede esta persona ver la tasación? Quien tasa, el supervisor, quien la pidió o quien ve el lead. */
    async function veTasacion(t: any) {
      if (realiza || esSupervisor || (!ctx.esAdmin && t.solicitante_id === userId)) return true;
      if (!t.lead_id) return false;
      const l = await cargarLead(t.lead_id);
      return !!l && puedeVer(l);
    }
    /** Agrega los nombres para mostrar (cliente, solicitante, tasador). */
    /** Ids de las fotos para el equipo de una ficha de inspección (nunca el resto de la ficha). */
    async function fotosDeFicha(clave: unknown): Promise<string[]> {
      if (typeof clave !== "string" || !/^inspeccion::[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$/.test(clave)) return [];
      try {
        const g = await sb.from("kv_store").select("value").eq("key", clave).maybeSingle();
        const d = JSON.parse(g.data ? g.data.value : "{}");
        return (Array.isArray(d.fotosEquipo) ? d.fotosEquipo : []).filter((x: unknown) => typeof x === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(x)).slice(0, 24);
      } catch { return []; }
    }
    async function enriquecer(filas: any[]) {
      const leads = await porIds("leads", filas.map((t) => t.lead_id));
      const clientes = await porIds("clientes", leads.map((l: any) => l.cliente_id));
      const usuarios = await porIds("usuarios", filas.flatMap((t) => [t.solicitante_id, t.tasador_id]));
      const nombre = (id: string) => (usuarios.find((u: any) => u.id === id) || {}).nombre ?? "";
      return filas.map(({ fotos, ...t }) => {
        const l = leads.find((x: any) => x.id === t.lead_id);
        const cli = l ? (clientes.find((c: any) => c.id === l.cliente_id) || {}).nombre ?? "" : (t.contacto && t.contacto.nombre) || "";
        return { ...t, fotos: fotos ?? [], folio: folioTasacion(t.numero), cliente: cli, solicitante: nombre(t.solicitante_id), tasador: nombre(t.tasador_id), lead_etapa: l ? l.etapa : null };
      });
    }
    const fallar = (e: any) => fallo(e);

    if (op === "tasaciones.equipo") {
      if (!esSupervisor) return err("forbidden", 403);
      const local = await localParaCrear();
      if (!local) return err("sin_local");
      return json({ tasadores: await tasadoresDe(local) });
    }

    if (op === "tasaciones.pedir") {
      if (!puedePedir) return err("forbidden", 403);
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (!puedeTocar(lead)) return err("forbidden", 403);
      if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
      const v = validarSolicitudTasacion(body.datos);
      if (!v.ok) return err(v.error!);
      const previas = await sb.from("tasaciones").select("id, estado").eq("lead_id", lead.id);
      if (previas.error) return fallar(previas.error);
      if ((previas.data ?? []).some((t: any) => t.estado === "pendiente" || t.estado === "en_proceso")) return err("tasacion_en_curso", 409);
      const ins = await sb.from("tasaciones").insert({
        local_id: lead.local_id, tipo: "parte_pago", lead_id: lead.id, solicitante_id: ctx.esAdmin ? null : userId,
        vehiculo: v.value.vehiculo, patente: v.value.vehiculo.patente, notas_solicitud: v.value.notas, creado_por: userId,
      }).select().single();
      if (ins.error) return fallar(ins.error);
      const t = ins.data;
      // El vehículo en parte de pago del lead queda con los datos que se pidieron tasar.
      const vh = v.value.vehiculo;
      const pp = { ...(lead.parte_pago || {}), tiene: true, patente: vh.patente, marca: vh.marca, modelo: vh.modelo, anio: vh.anio, km: vh.km };
      await sb.from("leads").update({ parte_pago: pp, actualizado_en: new Date().toISOString() }).eq("id", lead.id);
      await evento(lead.id, "tasacion", `Tasación ${folioTasacion(t.numero)} pedida por ${userName}: ${vh.marca} ${vh.modelo} ${vh.anio} (${vh.patente})`);
      await avanzarEtapa(lead.id, ["nuevo", "contactado", "seguimiento"], "tasacion", "se pidió la tasación");
      await audit(ctx.actor, "tasacion.pedir", "tasacion", t.id, { numero: t.numero, patente: vh.patente, lead_id: lead.id });
      return json({ tasacion: (await enriquecer([t]))[0] });
    }

    if (op === "tasaciones.directa") {
      if (!realiza && !ctx.esAdmin) return err("forbidden", 403);
      const local = await localParaCrear();
      if (!local) return err("sin_local");
      const v = validarTasacionDirecta(body.datos);
      if (!v.ok) return err(v.error!);
      const ahora = new Date().toISOString();
      // Quien la crea la toma de inmediato; la cuenta maestra la deja en la cola para que un Tasador la tome.
      const ins = await sb.from("tasaciones").insert({
        local_id: local, tipo: "directa", contacto: v.value.contacto, vehiculo: v.value.vehiculo, patente: v.value.vehiculo.patente, notas_solicitud: v.value.notas,
        estado: ctx.esAdmin ? "pendiente" : "en_proceso", tasador_id: ctx.esAdmin ? null : userId, tomada_en: ctx.esAdmin ? null : ahora, creado_por: userId,
      }).select().single();
      if (ins.error) return fallar(ins.error);
      await audit(ctx.actor, "tasacion.crear", "tasacion", ins.data.id, { numero: ins.data.numero, patente: v.value.vehiculo.patente, tipo: "directa" });
      return json({ tasacion: (await enriquecer([ins.data]))[0] });
    }

    if (op === "tasaciones.list") {
      const vista = String(body.vista ?? "");
      let q = scoped(sb.from("tasaciones").select("*").order("solicitada_en", { ascending: false }));
      const { data, error } = await q;
      if (error) return fallar(error);
      let filas: any[] = data ?? [];
      if (vista === "cola") { if (!realiza && !esSupervisor) return err("forbidden", 403); filas = filas.filter((t) => t.estado === "pendiente"); }
      else if (vista === "mias") { if (!realiza) return err("forbidden", 403); filas = filas.filter((t) => t.tasador_id === userId && t.estado !== "cancelada"); }
      else if (vista === "local") { if (!esSupervisor && !realiza) return err("forbidden", 403); if (body.estado) filas = filas.filter((t) => t.estado === String(body.estado)); }
      else if (vista === "solicitadas") filas = filas.filter((t) => t.solicitante_id === userId);
      else return err("vista_invalida");
      // Las canceladas hace tiempo no estorban.
      const hace60 = Date.now() - 60 * 86_400_000;
      filas = filas.filter((t) => !(t.estado === "cancelada" && Date.parse(t.actualizado_en) < hace60)).slice(0, 200);
      return json({ tasaciones: await enriquecer(filas), puedeRealizar: realiza, puedeGestionar: esSupervisor });
    }

    if (op === "tasaciones.get") {
      const t = await cargarTasacion(String(body.id ?? ""));
      if (!t || !(await veTasacion(t))) return err("no_existe", 404);
      const detalle: any = (await enriquecer([t]))[0];
      if (detalle.inspeccion && detalle.inspeccion.key) detalle.inspeccion = { ...detalle.inspeccion, fotos: await fotosDeFicha(detalle.inspeccion.key) };
      return json({ tasacion: detalle, puedeEditar: t.estado === "en_proceso" && (t.tasador_id === userId), vehiculoBloqueado: vehiculoDelCliente(t), puedeCorregir: t.estado === "completada" && (ctx.esAdmin || esSupervisor), puedeGestionar: esSupervisor, puedeRealizar: realiza });
    }

    if (op === "tasaciones.tomar") {
      if (!realiza || ctx.esAdmin) return err("forbidden", 403);
      const t = await cargarTasacion(String(body.id ?? ""));
      if (!t) return err("no_existe", 404);
      const tr = validarTransicionTasacion(t.estado, "tomar");
      if (!tr.ok) return err(t.estado === "en_proceso" ? "tasacion_ya_tomada" : tr.error!, 409);
      const r = await sb.from("tasaciones").update({ estado: "en_proceso", tasador_id: userId, tomada_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }).eq("id", t.id).eq("estado", "pendiente").select().maybeSingle();
      if (r.error) return fallar(r.error);
      if (!r.data) return err("tasacion_ya_tomada", 409);
      if (t.lead_id) await evento(t.lead_id, "tasacion", `${userName} tomó la tasación ${folioTasacion(t.numero)}`);
      await audit(ctx.actor, "tasacion.tomar", "tasacion", t.id, { numero: t.numero });
      return json({ tasacion: (await enriquecer([r.data]))[0] });
    }

    if (op === "tasaciones.liberar" || op === "tasaciones.asignar") {
      const t = await cargarTasacion(String(body.id ?? ""));
      if (!t) return err("no_existe", 404);
      if (!(await veTasacion(t))) return err("no_existe", 404);
      const asignar = op === "tasaciones.asignar";
      const tr = validarTransicionTasacion(t.estado, asignar ? "asignar" : "liberar");
      if (!tr.ok) return err(tr.error!);
      if (asignar ? !esSupervisor : !(esSupervisor || (realiza && t.tasador_id === userId))) return err("forbidden", 403);
      let patch: Record<string, unknown>;
      let texto: string;
      if (asignar) {
        const destino = (await tasadoresDe(t.local_id)).find((x: any) => x.id === body.tasadorId);
        if (!destino) return err("asignado_invalido");
        patch = { estado: "en_proceso", tasador_id: destino.id, tomada_en: new Date().toISOString() };
        texto = `Tasación ${folioTasacion(t.numero)} asignada a ${destino.nombre} por ${userName}`;
      } else {
        patch = { estado: "pendiente", tasador_id: null, tomada_en: null };
        texto = `${userName} devolvió la tasación ${folioTasacion(t.numero)} a la cola`;
      }
      const { data, error } = await sb.from("tasaciones").update({ ...patch, actualizado_en: new Date().toISOString() }).eq("id", t.id).select().single();
      if (error) return fallar(error);
      if (t.lead_id) await evento(t.lead_id, "tasacion", texto);
      await audit(ctx.actor, asignar ? "tasacion.asignar" : "tasacion.liberar", "tasacion", t.id, { numero: t.numero });
      return json({ tasacion: (await enriquecer([data]))[0] });
    }

    if (op === "tasaciones.guardar" || op === "tasaciones.completar") {
      const t = await cargarTasacion(String(body.id ?? ""));
      if (!t) return err("no_existe", 404);
      if (ctx.esAdmin || t.tasador_id !== userId || !realiza) return err("forbidden", 403);
      const completar = op === "tasaciones.completar";
      const tr = validarTransicionTasacion(t.estado, completar ? "completar" : "guardar");
      if (!tr.ok) return err(tr.error!);
      const b = validarBorradorTasacion(body.borrador);
      if (!b.ok) return err(b.error!);
      const patch: Record<string, any> = { ...b.value, actualizado_en: new Date().toISOString() };
      // Lo que el cliente declaró por el sitio web no se modifica.
      if (vehiculoDelCliente(t)) delete patch.vehiculo;
      if (patch.vehiculo) { patch.patente = b.value.vehiculo.patente; }
      if (completar) {
        const pick = (k: string) => (patch[k] !== undefined ? patch[k] : t[k]);
        const fin = validarCompletarTasacion({ tipo: t.tipo, valor_compra: pick("valor_compra"), valor_venta: pick("valor_venta"), valor_consignacion: pick("valor_consignacion"), valor_retoma: pick("valor_retoma"), aplica_para: pick("aplica_para"), observaciones: pick("observaciones") });
        if (!fin.ok) return err(fin.error!);
        patch.valor_compra = fin.value.valor_compra;
        patch.valor_venta = fin.value.valor_venta;
        patch.valor_consignacion = fin.value.valor_consignacion;
        patch.valor_retoma = fin.value.valor_retoma;
        patch.aplica_para = fin.value.aplica_para;
        patch.estado = "completada";
        patch.completada_en = new Date().toISOString();
      }
      const { data, error } = await sb.from("tasaciones").update(patch).eq("id", t.id).select().single();
      if (error) return fallar(error);
      if (completar) {
        // El valor tasado queda como el valor del vehículo en parte de pago del lead (y como su tope).
        if (t.lead_id && t.tipo !== "parte_pago") {
          await evento(t.lead_id, "tasacion", `Tasación ${folioTasacion(t.numero)} completada por ${userName}: ${resultadoTasacion(data)}`);
          await devolverResultadoAlEjecutivo(t, data);
        } else if (t.lead_id) {
          const lead = await cargarLead(t.lead_id);
          if (lead) {
            const vh = data.vehiculo || {};
            const pp = { ...(lead.parte_pago || {}), tiene: true, patente: vh.patente, marca: vh.marca, modelo: vh.modelo, anio: vh.anio, km: vh.km, valor: data.valor_compra, tasacion_id: data.id };
            await sb.from("leads").update({ parte_pago: pp, actualizado_en: new Date().toISOString() }).eq("id", lead.id);
          }
          await evento(t.lead_id, "tasacion", `Tasación ${folioTasacion(t.numero)} completada por ${userName}: se reconoce ${dinero(data.valor_compra)} por el vehículo (venta esperada ${dinero(data.valor_venta)}). Las cotizaciones deben usar este valor o uno menor.`);
        }
        await audit(ctx.actor, "tasacion.completar", "tasacion", t.id, { numero: t.numero, valor_compra: data.valor_compra, valor_venta: data.valor_venta, lead_id: t.lead_id });
        if (data.aplica_para !== "ninguna") await avanzarEtapa(t.lead_id, ["tasacion", "nuevo", "contactado", "seguimiento"], "contrato", "la tasación está lista", ["consignacion"]);
        if (!(t.lead_id && t.tipo !== "parte_pago")) { const vh = data.vehiculo || {}; await avisarA([t.solicitante_id].filter(Boolean), "Tasación completada", [`${userName} completó la tasación ${folioTasacion(t.numero)}${vh.marca ? ` de ${vh.marca} ${vh.modelo || ""}` : ""}.`, `Se paga hasta ${dinero(data.valor_compra)}; venta esperada ${dinero(data.valor_venta)}.`]); }
        if (t.tipo === "directa") {
          const ya = await sb.from("validaciones").select("id").eq("tasacion_id", t.id);
          if (!ya.error && (ya.data ?? []).length === 0) await crearValidacion({ tipo: "compra", local_id: t.local_id, tasacion_id: t.id, sujeto: sujetoDeVehiculo(data.vehiculo || {}, { vendedor: (t.contacto && t.contacto.nombre) || "" }) });
        }
      }
      return json({ tasacion: (await enriquecer([data]))[0] });
    }

    /**
     * El Jefe Local y el administrador pueden corregir una tasación ya realizada (precios, a qué aplica, observaciones). Se validan las mismas reglas
     * que al completarla, el resultado vuelve al ejecutivo del lead y queda registrado qué cambió. Lo que el cliente declaró por el sitio web no se toca.
     */
    if (op === "tasaciones.corregir") {
      if (!(ctx.esAdmin || esSupervisor)) return err("forbidden", 403);
      const t = await cargarTasacion(String(body.id ?? ""));
      if (!t || !(await veTasacion(t))) return err("no_existe", 404);
      if (t.estado !== "completada") return err("tasacion_estado_invalido");
      const b = validarBorradorTasacion(body.borrador);
      if (!b.ok) return err(b.error!);
      const patch: Record<string, any> = { ...b.value, actualizado_en: new Date().toISOString() };
      if (vehiculoDelCliente(t)) delete patch.vehiculo;
      if (patch.vehiculo) { patch.patente = patch.vehiculo.patente; }
      const pick = (k: string) => (patch[k] !== undefined ? patch[k] : t[k]);
      const fin = validarCompletarTasacion({ tipo: t.tipo, valor_compra: pick("valor_compra"), valor_venta: pick("valor_venta"), valor_consignacion: pick("valor_consignacion"), valor_retoma: pick("valor_retoma"), aplica_para: pick("aplica_para"), observaciones: pick("observaciones") });
      if (!fin.ok) return err(fin.error!);
      patch.valor_compra = fin.value.valor_compra;
      patch.valor_venta = fin.value.valor_venta;
      patch.valor_consignacion = fin.value.valor_consignacion;
      patch.valor_retoma = fin.value.valor_retoma;
      patch.aplica_para = fin.value.aplica_para;
      const { data, error } = await sb.from("tasaciones").update(patch).eq("id", t.id).select().single();
      if (error) return fallar(error);
      const antes = { aplica_para: t.aplica_para, valor_compra: t.valor_compra, valor_consignacion: t.valor_consignacion, valor_venta: t.valor_venta, valor_retoma: t.valor_retoma };
      const despues = { aplica_para: data.aplica_para, valor_compra: data.valor_compra, valor_consignacion: data.valor_consignacion, valor_venta: data.valor_venta, valor_retoma: data.valor_retoma };
      if (t.lead_id) {
        if (t.tipo === "parte_pago") {
          const lead = await cargarLead(t.lead_id);
          if (lead) {
            const vh = data.vehiculo || {};
            const pp = { ...(lead.parte_pago || {}), tiene: true, patente: vh.patente, marca: vh.marca, modelo: vh.modelo, anio: vh.anio, km: vh.km, valor: data.valor_compra, tasacion_id: data.id };
            await sb.from("leads").update({ parte_pago: pp, actualizado_en: new Date().toISOString() }).eq("id", lead.id);
          }
          await evento(t.lead_id, "tasacion", `Tasación ${folioTasacion(t.numero)} corregida por ${userName}: se reconoce ${dinero(data.valor_compra)} por el vehículo (venta esperada ${dinero(data.valor_venta)}). Las cotizaciones deben usar este valor o uno menor.`);
        } else {
          // Si ya hay una oferta por sobre el nuevo máximo, se avisa en el historial: no se modifica sola.
          const of = await sb.from("compras").select("numero, monto_oferta, estado").eq("tasacion_id", t.id);
          const sobre = (of.data ?? []).filter((c: any) => COMPRA_ABIERTA.includes(c.estado) && Number(c.monto_oferta) > topeDeOferta(data));
          await evento(t.lead_id, "tasacion", `Tasación ${folioTasacion(t.numero)} corregida por ${userName}: ${resultadoTasacion(data)}${sobre.length ? ` Atención: la oferta ${sobre.map((c: any) => folioCompra(c.numero)).join(", ")} supera el nuevo máximo.` : ""}`);
          await devolverResultadoAlEjecutivo(t, data, "corrigió");
        }
      }
      await audit(ctx.actor, "tasacion.corregir", "tasacion", t.id, { numero: t.numero, antes, despues, lead_id: t.lead_id });
      return json({ tasacion: (await enriquecer([data]))[0] });
    }

    if (op === "tasaciones.cancelar") {
      const t = await cargarTasacion(String(body.id ?? ""));
      if (!t) return err("no_existe", 404);
      if (!(await veTasacion(t))) return err("no_existe", 404);
      const tr = validarTransicionTasacion(t.estado, "cancelar");
      if (!tr.ok) return err(tr.error!);
      const esDuenoDeLaSolicitud = !ctx.esAdmin && t.solicitante_id === userId && t.estado === "pendiente";
      if (!(esSupervisor || esDuenoDeLaSolicitud || (realiza && t.tasador_id === userId))) return err("forbidden", 403);
      const motivo = String(body.motivo ?? "").trim().slice(0, 150);
      if (motivo.length < 3) return err("motivo_requerido");
      const ahora = new Date().toISOString();
      const { data, error } = await sb.from("tasaciones").update({ estado: "cancelada", cancelada_en: ahora, motivo_cancelacion: motivo, actualizado_en: ahora }).eq("id", t.id).select().single();
      if (error) return fallar(error);
      if (t.lead_id) await evento(t.lead_id, "tasacion", `Tasación ${folioTasacion(t.numero)} cancelada por ${userName}: ${motivo}`);
      await audit(ctx.actor, "tasacion.cancelar", "tasacion", t.id, { numero: t.numero, motivo });
      return json({ tasacion: (await enriquecer([data]))[0] });
    }

    // Inspecciones ya hechas del mismo vehículo (por patente). Solo se devuelven datos del vehículo: nunca los del propietario.
    if (op === "tasaciones.inspecciones") {
      if (!realiza && !ctx.esAdmin) return err("forbidden", 403);
      const pat = String(body.patente ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (pat.length !== 6) return err("patente_invalida");
      // En la ficha se guarda con puntos y dígito verificador (ej. "ABCD.12-3"): se busca el inicio de la inscripción.
      const patron = /^[A-Z]{4}/.test(pat) ? `%"inscripcion":"${pat.slice(0, 4)}%${pat.slice(4)}%` : `%"inscripcion":"${pat.slice(0, 2)}%${pat.slice(2)}%`;
      const r = await sb.from("kv_store").select("key").like("key", "inspeccion::%").ilike("value", patron).limit(10);
      if (r.error) return fallar(r.error);
      const out: any[] = [];
      for (const { key } of r.data ?? []) {
        const g = await sb.from("kv_store").select("value").eq("key", key).maybeSingle();
        try {
          const d = JSON.parse(g.data ? g.data.value : "{}");
          if (String(d.inscripcion ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").startsWith(pat)) {
            out.push({ key, fecha: d.fecha ?? null, inspector: d.inspectorNombre ?? null, patente: pat, marca: d.marca ?? null, modelo: d.modelo ?? null, anio: d.anio ?? null, fotos: (Array.isArray(d.fotosEquipo) ? d.fotosEquipo : []).filter((x: unknown) => typeof x === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(x)).slice(0, 24) });
          }
        } catch (e) { /* registro ilegible: se ignora */ }
      }
      out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      return json({ inspecciones: out });
    }

    if (op === "tasaciones.resumen") {
      if (!realiza && !esSupervisor) return err("forbidden", 403);
      const mes = body.mes === undefined ? mesChile() : String(body.mes);
      if (!esMes(mes)) return err("mes_invalido");
      const { data, error } = await scoped(sb.from("tasaciones").select("*"));
      if (error) return fallar(error);
      const todas: any[] = data ?? [];
      let cfg;
      try { cfg = await configNegocio(); } catch (e) { return fallo(e); }
      const ids = esSupervisor ? Array.from(new Set(todas.map((t) => t.tasador_id).filter(Boolean))) : [userId];
      const usuarios = await porIds("usuarios", ids);
      const tasadores = ids.map((id) => ({ id, nombre: (usuarios.find((u: any) => u.id === id) || {}).nombre ?? "", ...metricasTasador(todas, id, mes) }));
      const cola = colaTasaciones(todas, new Date(), cfg.horas_tasacion);
      return json({ mes, nombreMes: nombreMes(mes), tasadores, cola: { pendientes: cola.pendientes, masAntiguaHoras: cola.masAntiguaHoras, atrasadas: cola.atrasadas.length }, horasLimite: cfg.horas_tasacion });
    }

    return err("unknown_op");
  }

  /* ---------- marketing y RRSS (calendario, campañas, material y resultados) ---------- */
  if (op.startsWith("marketing.")) {
    const gestiona = !ctx.esAdmin && can("marketing.gestionar");
    if (!gestiona && !esSupervisor && !can("marketing.gestionar")) return err("forbidden", 403);
    const fallar = (e: any) => fallo(e);

    /** Leads con campaña y las ventas aprobadas de esos leads (para medir cada campaña). */
    async function leadsConCampania() {
      const { data, error } = await scoped(sb.from("leads").select("id, campania_id, etapa, fuente, creado_en"));
      if (error) throw error;
      const leads = (data ?? []).filter((l: any) => l.campania_id);
      const cierres = (await enLotes("cierres", "lead_id", leads.map((l: any) => l.id))).filter((c: any) => c.estado === "aprobada");
      const ventas = new Map<string, { monto: number }>(cierres.map((c: any) => [c.lead_id, { monto: Number(c.precio_final) }]));
      return { leads, ventas };
    }
    const conMetricas = (camps: any[], base: { leads: any[]; ventas: Map<string, any> }) => camps.map((c) => ({ ...c, folio: folioCampania(c.numero), metricas: metricasCampania(c, base.leads, base.ventas) }));
    async function cargarCampania(id: string) {
      const { data, error } = await scoped(sb.from("campanias").select("*").eq("id", id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    const campaniaDetalle = async (c: any) => ({ campania: conMetricas([c], await leadsConCampania())[0], puedeGestionar: gestiona, puedeAprobar: esSupervisor });
    const parteDeLocal = async (tabla: string, id: string | null, local: string) => {
      if (!id) return true;
      const { data } = await sb.from(tabla).select("id, local_id").eq("id", id).maybeSingle();
      return !!data && data.local_id === local;
    };

    /* ----- campañas ----- */
    if (op === "marketing.campanias.list") {
      const { data, error } = await scoped(sb.from("campanias").select("*").order("creado_en", { ascending: false }));
      if (error) return fallar(error);
      let filas: any[] = data ?? [];
      if (body.estado) filas = filas.filter((c) => c.estado === String(body.estado));
      const hace90 = Date.now() - 90 * 86_400_000;
      if (!body.estado) filas = filas.filter((c) => !(c.estado === "cancelada" && Date.parse(c.actualizado_en) < hace90));
      return json({ campanias: conMetricas(filas.slice(0, 200), await leadsConCampania()), puedeGestionar: gestiona, puedeAprobar: esSupervisor });
    }
    if (op === "marketing.campanias.get") {
      const c = await cargarCampania(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      return json(await campaniaDetalle(c));
    }
    if (op === "marketing.campanias.save") {
      if (!gestiona) return err("forbidden", 403);
      const v = validarCampania(body.datos);
      if (!v.ok) return err(v.error!);
      if (!body.id) {
        const local = await localParaCrear();
        if (!local) return err("sin_local");
        const ins = await sb.from("campanias").insert({ ...v.value, local_id: local, creado_por: userName }).select().single();
        if (ins.error) return fallar(ins.error);
        await audit(ctx.actor, "campania.crear", "campania", ins.data.id, { numero: ins.data.numero, nombre: ins.data.nombre, presupuesto: ins.data.presupuesto });
        return json(await campaniaDetalle(ins.data));
      }
      const c = await cargarCampania(String(body.id));
      if (!c) return err("no_existe", 404);
      const tr = validarTransicionCampania(c.estado, "editar");
      if (!tr.ok) return err(tr.error!);
      if (v.value.presupuesto < Number(c.gasto)) return err("presupuesto_menor_que_gasto");
      const estado = estadoTrasGuardar(c, v.value);
      const { data, error } = await sb.from("campanias").update({ ...v.value, estado, ...(estado === "pendiente" && c.estado === "aprobada" ? { aprobado_por: null, aprobado_en: null } : {}), actualizado_en: new Date().toISOString() }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await audit(ctx.actor, "campania.editar", "campania", c.id, { numero: c.numero, estado, presupuesto: v.value.presupuesto });
      return json(await campaniaDetalle(data));
    }
    // Sin presupuesto sale sola (campaña orgánica); con presupuesto espera la aprobación del Jefe Local.
    if (op === "marketing.campanias.enviar") {
      if (!gestiona) return err("forbidden", 403);
      const c = await cargarCampania(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      const tr = validarTransicionCampania(c.estado, "enviar");
      if (!tr.ok) return err(tr.error!);
      const ahora = new Date().toISOString();
      const libre = Number(c.presupuesto) === 0;
      const patch = libre
        ? { estado: "aprobada", presupuesto_aprobado: 0, aprobado_por: "Sin presupuesto: no requiere aprobación", aprobado_en: ahora, motivo_rechazo: null, actualizado_en: ahora }
        : { estado: "pendiente", motivo_rechazo: null, actualizado_en: ahora };
      const { data, error } = await sb.from("campanias").update(patch).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await audit(ctx.actor, libre ? "campania.activar" : "campania.enviar", "campania", c.id, { numero: c.numero, presupuesto: c.presupuesto });
      return json(await campaniaDetalle(data));
    }
    if (op === "marketing.campanias.aprobar" || op === "marketing.campanias.rechazar") {
      if (!esSupervisor) return err("forbidden", 403);
      const c = await cargarCampania(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      const aprobar = op === "marketing.campanias.aprobar";
      const tr = validarTransicionCampania(c.estado, aprobar ? "aprobar" : "rechazar");
      if (!tr.ok) return err(tr.error!);
      const ahora = new Date().toISOString();
      let patch: Record<string, unknown>;
      if (aprobar) patch = { estado: "aprobada", presupuesto_aprobado: c.presupuesto, aprobado_por: userName, aprobado_en: ahora, motivo_rechazo: null, actualizado_en: ahora };
      else {
        const motivo = String(body.motivo ?? "").trim().slice(0, 200);
        if (motivo.length < 3) return err("motivo_requerido");
        patch = { estado: "rechazada", motivo_rechazo: motivo, actualizado_en: ahora };
      }
      const { data, error } = await sb.from("campanias").update(patch).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await audit(ctx.actor, aprobar ? "campania.aprobar" : "campania.rechazar", "campania", c.id, { numero: c.numero, presupuesto: c.presupuesto, motivo: patch.motivo_rechazo ?? null });
      return json(await campaniaDetalle(data));
    }
    if (op === "marketing.campanias.resultados") {
      if (!gestiona) return err("forbidden", 403);
      const c = await cargarCampania(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      const tr = validarTransicionCampania(c.estado, "resultados");
      if (!tr.ok) return err(tr.error!);
      const r = validarResultadosCampania(body.datos, c.presupuesto_aprobado);
      if (!r.ok) return err(r.error!);
      const { data, error } = await sb.from("campanias").update({ ...r.value, actualizado_en: new Date().toISOString() }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await audit(ctx.actor, "campania.resultados", "campania", c.id, { numero: c.numero, ...r.value });
      return json(await campaniaDetalle(data));
    }
    if (op === "marketing.campanias.finalizar" || op === "marketing.campanias.cancelar") {
      const fin = op === "marketing.campanias.finalizar";
      if (!(gestiona || (!fin && esSupervisor))) return err("forbidden", 403);
      const c = await cargarCampania(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      const tr = validarTransicionCampania(c.estado, fin ? "finalizar" : "cancelar");
      if (!tr.ok) return err(tr.error!);
      const { data, error } = await sb.from("campanias").update({ estado: fin ? "finalizada" : "cancelada", actualizado_en: new Date().toISOString() }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await audit(ctx.actor, fin ? "campania.finalizar" : "campania.cancelar", "campania", c.id, { numero: c.numero });
      return json(await campaniaDetalle(data));
    }

    /* ----- calendario de contenido ----- */
    if (op === "marketing.publicaciones.list") {
      const mes = body.mes === undefined ? mesChile() : String(body.mes);
      if (!esMes(mes)) return err("mes_invalido");
      const { data, error } = await scoped(sb.from("publicaciones_rrss").select("*").order("fecha_programada", { ascending: true }));
      if (error) return fallar(error);
      const todas: any[] = data ?? [];
      // Las del mes (por su fecha) y las que aún no tienen fecha ni terminaron.
      const delMes = todas.filter((p) => (p.fecha_programada ? mesChile(p.fecha_programada) === mes : p.estado === "idea" || p.estado === "produccion"));
      const vehs = await porIds("vehiculos", delMes.map((p) => p.vehiculo_id));
      const camps = await porIds("campanias", delMes.map((p) => p.campania_id));
      const filas = delMes.map((p) => {
        const v = vehs.find((x: any) => x.id === p.vehiculo_id);
        const c = camps.find((x: any) => x.id === p.campania_id);
        return { ...p, folio: folioPublicacion(p.numero), vehiculo: v ? `${v.marca} ${v.modelo} ${v.anio} · ${v.patente}` : "", campania: c ? c.nombre : "" };
      });
      return json({ mes, nombreMes: nombreMes(mes), publicaciones: filas, atrasadas: publicacionesAtrasadas(todas).length, resumen: resumenPublicaciones(delMes), puedeGestionar: gestiona });
    }
    if (op === "marketing.publicaciones.save") {
      if (!gestiona) return err("forbidden", 403);
      const v = validarPublicacion(body.datos);
      if (!v.ok) return err(v.error!);
      let local = localId;
      let antes: any = null;
      if (body.id) {
        const q = await scoped(sb.from("publicaciones_rrss").select("*").eq("id", String(body.id))).maybeSingle();
        if (q.error) return fallar(q.error);
        antes = q.data;
        if (!antes) return err("no_existe", 404);
        local = antes.local_id;
      } else { local = await localParaCrear(); if (!local) return err("sin_local"); }
      if (!(await parteDeLocal("campanias", v.value.campania_id, local!))) return err("campania_invalida");
      if (!(await parteDeLocal("vehiculos", v.value.vehiculo_id, local!))) return err("vehiculo_invalido");
      const ahora = new Date().toISOString();
      const r = antes
        ? await sb.from("publicaciones_rrss").update({ ...v.value, actualizado_en: ahora }).eq("id", antes.id).select().single()
        : await sb.from("publicaciones_rrss").insert({ ...v.value, local_id: local, responsable_id: userId, creado_por: userName }).select().single();
      if (r.error) return fallar(r.error);
      await audit(ctx.actor, antes ? "publicacion.editar" : "publicacion.crear", "publicacion", r.data.id, { numero: r.data.numero, red: r.data.red, estado: r.data.estado });
      return json({ publicacion: { ...r.data, folio: folioPublicacion(r.data.numero) } });
    }
    if (op === "marketing.publicaciones.estado") {
      if (!gestiona) return err("forbidden", 403);
      const q = await scoped(sb.from("publicaciones_rrss").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
      if (q.error) return fallar(q.error);
      if (!q.data) return err("no_existe", 404);
      const v = validarPublicacion({ titulo: q.data.titulo, red: q.data.red, tipo: q.data.tipo, texto: q.data.texto, campaniaId: q.data.campania_id, vehiculoId: q.data.vehiculo_id, fechaProgramada: q.data.fecha_programada, url: body.url ?? q.data.url, estado: body.estado });
      if (!v.ok) return err(v.error!);
      const { data, error } = await sb.from("publicaciones_rrss").update({ estado: v.value.estado, url: v.value.url, actualizado_en: new Date().toISOString() }).eq("id", q.data.id).select().single();
      if (error) return fallar(error);
      await audit(ctx.actor, "publicacion.estado", "publicacion", q.data.id, { numero: q.data.numero, estado: v.value.estado });
      return json({ publicacion: { ...data, folio: folioPublicacion(data.numero) } });
    }
    if (op === "marketing.publicaciones.eliminar") {
      if (!gestiona) return err("forbidden", 403);
      const q = await scoped(sb.from("publicaciones_rrss").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
      if (q.error) return fallar(q.error);
      if (!q.data) return err("no_existe", 404);
      if (q.data.estado !== "idea" && q.data.estado !== "cancelada") return err("publicacion_no_eliminable");
      const d = await sb.from("publicaciones_rrss").delete().eq("id", q.data.id);
      if (d.error) return fallar(d.error);
      await audit(ctx.actor, "publicacion.eliminar", "publicacion", q.data.id, { numero: q.data.numero });
      return json({ ok: true });
    }

    /* ----- material por vehículo ----- */
    if (op === "marketing.material.list") {
      const { data, error } = await scoped(sb.from("material_vehiculo").select("*").order("actualizado_en", { ascending: false }));
      if (error) return fallar(error);
      const filas: any[] = data ?? [];
      const vehs = await porIds("vehiculos", filas.map((m) => m.vehiculo_id));
      return json({
        material: filas.slice(0, 300).map((m) => { const v = vehs.find((x: any) => x.id === m.vehiculo_id) || {}; return { ...m, vehiculo: `${v.marca ?? ""} ${v.modelo ?? ""} ${v.anio ?? ""} · ${v.patente ?? ""}`.trim(), vehiculo_estado: v.estado ?? null }; }),
        puedeGestionar: gestiona || esSupervisor,
      });
    }
    if (op === "marketing.material.save") {
      if (!gestiona && !esSupervisor) return err("forbidden", 403);
      const v = validarMaterial(body.datos);
      if (!v.ok) return err(v.error!);
      const { data: veh, error: ve } = await scoped(sb.from("vehiculos").select("id, local_id").eq("id", v.value.vehiculo_id)).maybeSingle();
      if (ve) return fallar(ve);
      if (!veh) return err("vehiculo_invalido");
      const prev = await sb.from("material_vehiculo").select("*").eq("vehiculo_id", veh.id).eq("tipo", v.value.tipo).maybeSingle();
      if (prev.error) return fallar(prev.error);
      const ahora = new Date().toISOString();
      const r = prev.data
        ? await sb.from("material_vehiculo").update({ ...v.value, actualizado_en: ahora }).eq("id", prev.data.id).select().single()
        : await sb.from("material_vehiculo").insert({ ...v.value, local_id: veh.local_id, creado_por: userName }).select().single();
      if (r.error) return fallar(r.error);
      await audit(ctx.actor, "material.guardar", "material", r.data.id, { vehiculo_id: veh.id, tipo: v.value.tipo, estado: v.value.estado });
      return json({ material: r.data });
    }
    if (op === "marketing.material.eliminar") {
      if (!gestiona && !esSupervisor) return err("forbidden", 403);
      const q = await scoped(sb.from("material_vehiculo").select("id").eq("id", String(body.id ?? ""))).maybeSingle();
      if (q.error) return fallar(q.error);
      if (!q.data) return err("no_existe", 404);
      const d = await sb.from("material_vehiculo").delete().eq("id", q.data.id);
      if (d.error) return fallar(d.error);
      return json({ ok: true });
    }

    /* ----- resultados: rendimiento por fuente y por campaña ----- */
    if (op === "marketing.resultados") {
      const mes = body.mes === undefined ? mesChile() : String(body.mes);
      if (!esMes(mes)) return err("mes_invalido");
      const [y, m] = mes.split("-").map(Number);
      const desde = new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString();
      const hasta = new Date(Date.UTC(y, m, 1) + 86_400_000).toISOString();
      const lr = await scoped(sb.from("leads").select("*").gte("creado_en", desde).lt("creado_en", hasta));
      if (lr.error) return fallar(lr.error);
      const cohorte: any[] = (lr.data ?? []).filter((l: any) => mesChile(l.creado_en) === mes);
      const ids = cohorte.map((l) => l.id);
      const cot = (await enLotes("cotizaciones", "lead_id", ids)).filter((c: any) => c.estado !== "anulada");
      const res = await enLotes("reservas", "lead_id", ids);
      const cie = (await enLotes("cierres", "lead_id", ids)).filter((c: any) => c.estado === "aprobada");
      const conjuntos = { cotizados: new Set<string>(cot.map((c: any) => c.lead_id)), reservados: new Set<string>(res.map((r: any) => r.lead_id)), vendidos: new Set<string>(cie.map((c: any) => c.lead_id)) };
      const ventasMap = new Map<string, { monto: number; margen: number | null }>(cie.map((c: any) => [c.lead_id, { monto: Number(c.precio_final), margen: null }]));
      const fuentes = rendimientoPorFuente(cohorte, conjuntos, ventasMap).map(({ margen, margenCompleto, ...f }: any) => f);

      const cq = await scoped(sb.from("campanias").select("*"));
      if (cq.error) return fallar(cq.error);
      const camps = conMetricas((cq.data ?? []).filter((c: any) => c.estado === "aprobada" || c.estado === "finalizada"), await leadsConCampania())
        .sort((a: any, b: any) => b.metricas.leads - a.metricas.leads || b.gasto - a.gasto);
      const pq = await scoped(sb.from("publicaciones_rrss").select("*"));
      const pubs: any[] = pq.error ? [] : (pq.data ?? []).filter((p: any) => p.fecha_programada && mesChile(p.fecha_programada) === mes);
      return json({
        mes, nombreMes: nombreMes(mes), fuentes, campanias: camps.slice(0, 50),
        totales: { gasto: camps.reduce((a: number, c: any) => a + Number(c.gasto || 0), 0), leadsDeCampanias: camps.reduce((a: number, c: any) => a + c.metricas.leads, 0), ventasDeCampanias: camps.reduce((a: number, c: any) => a + c.metricas.ventas, 0) },
        publicaciones: resumenPublicaciones(pubs),
      });
    }

    return err("unknown_op");
  }

  /* ---------- avisos (Anunciante: publicaciones en portales, redes y sitio web) ---------- */
  if (op.startsWith("anuncios.")) {
    const gestiona = !ctx.esAdmin && can("anuncios.gestionar");
    if (!gestiona && !esSupervisor && !can("anuncios.gestionar")) return err("forbidden", 403);
    const fallar = (e: any) => fallo(e);
    const sinCostoV = ({ costo, ...v }: any) => v;

    async function cargarAnuncio(id: string) {
      const { data, error } = await scoped(sb.from("anuncios").select("*").eq("id", id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    const portalesDe = async (ids: string[]) => (await enLotes("anuncio_portales", "anuncio_id", ids)).sort((a: any, b: any) => String(a.creado_en).localeCompare(String(b.creado_en)));
    /** Datos de un aviso listos para mostrar. */
    async function armar(filas: any[]) {
      const vehs = await porIds("vehiculos", filas.map((a) => a.vehiculo_id));
      const portales = await portalesDe(filas.map((a) => a.id));
      const usuarios = await porIds("usuarios", filas.map((a) => a.anunciante_id));
      const ahora = new Date();
      return filas.map((a) => {
        const v = vehs.find((x: any) => x.id === a.vehiculo_id) || {};
        const ps = portales.filter((p: any) => p.anuncio_id === a.id);
        return { ...a, folio: folioAnuncio(a.numero), vehiculo: sinCostoV(v), portales: ps, alertas: alertasAnuncio(ps, v, ahora), anunciante: (usuarios.find((u: any) => u.id === a.anunciante_id) || {}).nombre ?? "" };
      });
    }
    async function consultas(vehiculoIds: string[], dias = 30) {
      const { data } = await scoped(sb.from("leads").select("vehiculo_id, fuente, creado_en"));
      const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
      const out: Record<string, any> = {};
      for (const id of vehiculoIds) out[id] = consultasDeVehiculo(data ?? [], id, desde);
      return out;
    }
    const fotosDe = (v: any) => (Array.isArray(v.fotos) ? v.fotos : []);
    const detalle = async (a: any) => {
      const [fila] = await armar([a]);
      const c = (await consultas([a.vehiculo_id]))[a.vehiculo_id];
      return { anuncio: fila, sugerencia: sugerirAviso(fila.vehiculo), consultas: c, puedeGestionar: gestiona };
    };

    // Vehículos que esperan su aviso: disponibles, sin aviso activo. Con Validadores, solo con documentos aprobados.
    if (op === "anuncios.cola") {
      const [vq, aq] = await Promise.all([
        scoped(sb.from("vehiculos").select("*").eq("activo", true).eq("estado", "disponible")),
        scoped(sb.from("anuncios").select("vehiculo_id, estado")),
      ]);
      if (vq.error) return fallar(vq.error);
      if (aq.error) return fallar(aq.error);
      const conAviso = new Set((aq.data ?? []).filter((a: any) => a.estado !== "baja").map((a: any) => a.vehiculo_id));
      const libres: any[] = (vq.data ?? []).filter((v: any) => !conAviso.has(v.id));
      const exigeLocal: Record<string, boolean> = {};
      await Promise.all(Array.from(new Set(libres.map((v) => v.local_id))).map(async (lid) => { exigeLocal[lid] = await hayValidadores(lid); }));
      let vals: any[] = [];
      if (libres.some((v) => exigeLocal[v.local_id])) {
        const r = await sb.from("validaciones").select("id").limit(1);
        if (!r.error) vals = (await enLotes("validaciones", "vehiculo_id", libres.map((v) => v.id))).filter((x: any) => x.tipo === "vehiculo" && x.estado !== "cancelada");
      }
      const filas = [];
      let creadas = 0;
      for (const v of libres) {
        const exige = !!exigeLocal[v.local_id];
        const propias = vals.filter((x: any) => x.vehiculo_id === v.id);
        let val = propias.find((x: any) => x.estado === "aprobada") || propias[0];
        // Vehículos anteriores a las validaciones: se les crea la suya al aparecer en la cola.
        if (exige && !val && creadas < 30) { val = await crearValidacion({ tipo: "vehiculo", local_id: v.local_id, vehiculo_id: v.id, sujeto: sujetoDeVehiculo(v) }); creadas++; }
        const el = elegibleParaAviso(v, { exigeValidacion: exige && !!val, validacionEstado: val ? val.estado : null });
        filas.push({ vehiculo: sinCostoV(v), validacion: val ? { id: val.id, estado: val.estado } : null, bloqueado: !el.ok, motivo: el.ok ? null : el.error });
      }
      filas.sort((a, b) => Number(a.bloqueado) - Number(b.bloqueado));
      return json({ porCrear: filas.slice(0, 200), puedeGestionar: gestiona });
    }

    if (op === "anuncios.list") {
      const estado = String(body.estado ?? "");
      const { data, error } = await scoped(sb.from("anuncios").select("*").order("actualizado_en", { ascending: false }));
      if (error) return fallar(error);
      let filas: any[] = data ?? [];
      filas = estado ? filas.filter((a) => a.estado === estado) : filas.filter((a) => a.estado !== "baja");
      const armados = await armar(filas.slice(0, 200));
      const c = await consultas(armados.map((a: any) => a.vehiculo_id));
      return json({ anuncios: armados.map((a: any) => ({ ...a, consultas: c[a.vehiculo_id] })), puedeGestionar: gestiona });
    }

    if (op === "anuncios.get") {
      const a = await cargarAnuncio(String(body.id ?? ""));
      if (!a) return err("no_existe", 404);
      return json(await detalle(a));
    }

    if (op === "anuncios.crear") {
      if (!gestiona) return err("forbidden", 403);
      const { data: v, error: ve } = await scoped(sb.from("vehiculos").select("*").eq("id", String(body.vehiculoId ?? ""))).maybeSingle();
      if (ve) return fallar(ve);
      if (!v) return err("no_existe", 404);
      const exige = await hayValidadores(v.local_id);
      let val: any = null;
      if (exige) {
        const r = await sb.from("validaciones").select("*").eq("vehiculo_id", v.id);
        if (!r.error) { const l = (r.data ?? []).filter((x: any) => x.tipo === "vehiculo" && x.estado !== "cancelada"); val = l.find((x: any) => x.estado === "aprobada") || l[0] || null; }
      }
      const el = elegibleParaAviso(v, { exigeValidacion: exige && !!val, validacionEstado: val ? val.estado : null });
      if (!el.ok) return err(el.error!, 409);
      const previo = await sb.from("anuncios").select("id, estado").eq("vehiculo_id", v.id);
      if (previo.error) return fallar(previo.error);
      if ((previo.data ?? []).some((a: any) => a.estado !== "baja")) return err("aviso_existente", 409);
      const s = sugerirAviso(v);
      const ins = await sb.from("anuncios").insert({ local_id: v.local_id, vehiculo_id: v.id, titulo: s.titulo, descripcion: s.descripcion, anunciante_id: userId, creado_por: userName }).select().single();
      if (ins.error) return ins.error.code === "23505" ? err("aviso_existente", 409) : fallar(ins.error);
      await audit(ctx.actor, "aviso.crear", "anuncio", ins.data.id, { numero: ins.data.numero, patente: v.patente });
      return json(await detalle(ins.data));
    }

    if (op === "anuncios.guardar") {
      if (!gestiona) return err("forbidden", 403);
      const a = await cargarAnuncio(String(body.id ?? ""));
      if (!a) return err("no_existe", 404);
      if (a.estado === "baja") return err("aviso_baja");
      const v = validarTextoAnuncio(body.datos);
      if (!v.ok) return err(v.error!);
      const { data, error } = await sb.from("anuncios").update({ ...v.value, actualizado_en: new Date().toISOString() }).eq("id", a.id).select().single();
      if (error) return fallar(error);
      await audit(ctx.actor, "aviso.editar", "anuncio", a.id, { numero: a.numero });
      return json(await detalle(data));
    }

    // Publicar, pausar, dar de baja o actualizar el aviso en un portal.
    if (op === "anuncios.portal") {
      if (!gestiona) return err("forbidden", 403);
      const a = await cargarAnuncio(String(body.id ?? ""));
      if (!a) return err("no_existe", 404);
      if (a.estado === "baja") return err("aviso_baja");
      const p = validarPortal(body.datos);
      if (!p.ok) return err(p.error!);
      const { data: v } = await sb.from("vehiculos").select("*").eq("id", a.vehiculo_id).maybeSingle();
      if (!v) return err("no_existe", 404);
      if (p.value.estado === "publicado" && (v.estado !== "disponible" || v.activo === false)) return err("vehiculo_no_disponible", 409);
      const previo = (await portalesDe([a.id])).find((x: any) => x.portal === p.value.portal);
      const ahora = new Date().toISOString();
      const patch: Record<string, unknown> = { estado: p.value.estado, url: p.value.url, vence_en: p.value.venceEn, actualizado_por: userName, actualizado_en: ahora };
      // Al publicar o confirmar que se actualizó, el aviso queda con el precio de lista de hoy.
      if (p.value.estado === "publicado") { patch.precio_publicado = v.precio_lista ?? null; if (!previo || previo.estado !== "publicado") patch.publicado_en = ahora; }
      let fila;
      if (previo) { const r = await sb.from("anuncio_portales").update(patch).eq("id", previo.id).select().single(); if (r.error) return fallar(r.error); fila = r.data; }
      else { const r = await sb.from("anuncio_portales").insert({ anuncio_id: a.id, portal: p.value.portal, ...patch }).select().single(); if (r.error) return fallar(r.error); fila = r.data; }
      const nuevo = estadoDeAnuncio((await portalesDe([a.id])));
      const up = await sb.from("anuncios").update({ estado: nuevo, actualizado_en: ahora, baja_en: nuevo === "baja" ? ahora : null }).eq("id", a.id).select().single();
      if (up.error) return fallar(up.error);
      await audit(ctx.actor, "aviso.portal", "anuncio", a.id, { numero: a.numero, portal: p.value.portal, estado: p.value.estado });
      return json(await detalle(up.data));
    }

    // Da de baja el aviso completo (por ejemplo, al venderse el vehículo).
    if (op === "anuncios.baja") {
      if (!gestiona) return err("forbidden", 403);
      const a = await cargarAnuncio(String(body.id ?? ""));
      if (!a) return err("no_existe", 404);
      if (a.estado === "baja") return err("aviso_baja");
      const ahora = new Date().toISOString();
      const ub = await sb.from("anuncio_portales").update({ estado: "baja", actualizado_por: userName, actualizado_en: ahora }).eq("anuncio_id", a.id);
      if (ub.error) return fallar(ub.error);
      const up = await sb.from("anuncios").update({ estado: "baja", baja_en: ahora, actualizado_en: ahora }).eq("id", a.id).select().single();
      if (up.error) return fallar(up.error);
      await audit(ctx.actor, "aviso.baja", "anuncio", a.id, { numero: a.numero });
      return json(await detalle(up.data));
    }

    if (op === "anuncios.resumen") {
      const { data, error } = await scoped(sb.from("anuncios").select("*"));
      if (error) return fallar(error);
      const todos: any[] = data ?? [];
      const activos = todos.filter((a) => a.estado !== "baja");
      const armados = await armar(activos);
      const portales = armados.flatMap((a: any) => a.portales);
      const alertas = armados.flatMap((a: any) => a.alertas.map((x: any) => ({ ...x, anuncio_id: a.id, folio: a.folio, vehiculo: `${a.vehiculo.marca ?? ""} ${a.vehiculo.modelo ?? ""} ${a.vehiculo.anio ?? ""} · ${a.vehiculo.patente ?? ""}`.trim() })));
      alertas.sort((x: any, y: any) => Number(y.grave) - Number(x.grave));
      const c = await consultas(armados.map((a: any) => a.vehiculo_id));
      const porPortal: Record<string, number> = {};
      let otras = 0;
      for (const id of Object.keys(c)) { for (const [p, n] of Object.entries(c[id].porPortal)) porPortal[p] = (porPortal[p] ?? 0) + (n as number); otras += c[id].otras; }
      const top = armados.map((a: any) => ({ id: a.id, folio: a.folio, vehiculo: `${a.vehiculo.marca ?? ""} ${a.vehiculo.modelo ?? ""} ${a.vehiculo.anio ?? ""} · ${a.vehiculo.patente ?? ""}`.trim(), consultas: c[a.vehiculo_id].total }))
        .sort((x: any, y: any) => y.consultas - x.consultas).slice(0, 10);
      return json({ ...resumenAvisos(todos, portales), alertas: alertas.slice(0, 100), consultas: { porPortal, otras, top }, dias: 30 });
    }

    return err("unknown_op");
  }

  /* ---------- validaciones (Validador: revisión de documentos) ---------- */
  if (op.startsWith("validacion.")) {
    const realiza = !ctx.esAdmin && can("validacion.realizar");
    // Quien ve el inventario (aunque no lo edite) puede mirar los documentos del vehículo; lo demás sigue pidiendo su permiso.
    if (!realiza && !esSupervisor && !can("validacion.usar") && !can("leads.propios") && !can("inventario.ver") && !can("inventario.editar") && !can("tasaciones.realizar")) return err("forbidden", 403);

    async function validadoresDe(local: string) {
      const overrides = await ctx.rolePermOverrides();
      const { data, error } = await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id").eq("local_id", local);
      if (error) throw error;
      return (data ?? []).filter((u: any) => u.activo && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("validacion.realizar"));
    }
    async function cargarVal(id: string) {
      const { data, error } = await scoped(sb.from("validaciones").select("*").eq("id", id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    async function docsDe(ids: string[]) {
      const filas = await enLotes("validacion_docs", "validacion_id", ids);
      return filas.sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
    }
    /** ¿Puede ver la validación? Quien valida, el supervisor, o quien trabaja el lead, el vehículo o la tasación de origen. */
    async function veVal(v: any) {
      if (realiza || esSupervisor) return true;
      if (v.tipo === "venta") { const l = v.lead_id ? await cargarLead(v.lead_id) : null; return !!l && puedeVer(l); }
      if (v.tipo === "vehiculo") return can("inventario.ver") || can("inventario.editar");
      if (v.lead_id) { const l = await cargarLead(v.lead_id); if (l && puedeVer(l)) return true; }
      return can("tasaciones.realizar");
    }
    /** ¿Puede subir o quitar archivos? Quien la tiene asignada, el supervisor, o quien la originó. */
    async function puedeAdjuntar(v: any) {
      if (esSupervisor) return true;
      if (realiza && v.validador_id === userId) return true;
      if (ctx.esAdmin) return false;
      if (v.tipo === "venta") { const l = v.lead_id ? await cargarLead(v.lead_id) : null; return !!l && puedeVer(l) && puedeTocar(l); }
      if (v.tipo === "vehiculo") return can("inventario.editar");
      // Cargar documentos es del ejecutivo que gestiona el lead; el Tasador solo tasa.
      if (v.lead_id) { const l = await cargarLead(v.lead_id); return !!l && puedeVer(l) && puedeTocar(l); }
      return false;
    }
    async function enriquecerVal(filas: any[]) {
      const docs = await docsDe(filas.map((v) => v.id));
      const cierres = await porIds("cierres", filas.map((v) => v.cierre_id));
      const usuarios = await porIds("usuarios", filas.map((v) => v.validador_id));
      return filas.map((v) => ({
        ...v, folio: folioValidacion(v.numero), validador: (usuarios.find((u: any) => u.id === v.validador_id) || {}).nombre ?? "",
        progreso: progreso(docs.filter((d: any) => d.validacion_id === v.id)), cierre_estado: v.cierre_id ? (cierres.find((c: any) => c.id === v.cierre_id) || {}).estado ?? null : null,
      }));
    }
    /** Recalcula el estado a partir de los documentos y lo guarda. */
    async function recalcular(v: any, tieneValidador = !!v.validador_id) {
      const docs = await docsDe([v.id]);
      const estado = estadoDeValidacion(docs, tieneValidador);
      const ahora = new Date().toISOString();
      const patch: Record<string, unknown> = { estado, actualizado_en: ahora };
      if (estado === "aprobada" && v.estado !== "aprobada") patch.resuelta_en = ahora;
      if (estado !== "aprobada") patch.resuelta_en = null;
      const { data, error } = await sb.from("validaciones").update(patch).eq("id", v.id).select().single();
      if (error) throw error;
      return { val: data, docs };
    }
    const detalle = async (v: any) => {
      const docs = await docsDe([v.id]);
      const [fila] = await enriquecerVal([v]);
      return { validacion: fila, docs, esMia: realiza && v.validador_id === userId, puedeRevisar: realiza && v.validador_id === userId && ESTADOS_ABIERTOS.includes(v.estado) && v.estado !== "pendiente", puedeAdjuntar: v.estado !== "aprobada" && v.estado !== "cancelada" && (await puedeAdjuntar(v)), puedeGestionar: esSupervisor, puedeRealizar: realiza };
    };
    const anotarVal = async (v: any, texto: string) => { if (v.lead_id) await evento(v.lead_id, "validacion", texto); };
    const fallar = (e: any) => fallo(e);

    if (op === "validacion.equipo") {
      if (!esSupervisor) return err("forbidden", 403);
      const local = await localParaCrear();
      if (!local) return err("sin_local");
      return json({ validadores: (await validadoresDe(local)).map((u: any) => ({ id: u.id, nombre: u.nombre })) });
    }

    if (op === "validacion.list") {
      const vista = String(body.vista ?? "");
      const { data, error } = await scoped(sb.from("validaciones").select("*").order("solicitada_en", { ascending: false }));
      if (error) return fallar(error);
      let filas: any[] = data ?? [];
      // Una venta cuyo cierre se retiró, rechazó o anuló ya no necesita validación.
      const cierres = await porIds("cierres", filas.map((v) => v.cierre_id));
      const vigente = (v: any) => v.estado !== "cancelada" && (v.tipo !== "venta" || !v.cierre_id || ["pendiente", "aprobada"].includes((cierres.find((c: any) => c.id === v.cierre_id) || {}).estado));
      filas = filas.filter(vigente);
      if (vista === "cola") { if (!realiza && !esSupervisor) return err("forbidden", 403); filas = filas.filter((v) => v.estado === "pendiente" && v.enviada_en); }
      else if (vista === "mias") { if (!realiza) return err("forbidden", 403); filas = filas.filter((v) => v.validador_id === userId && (v.estado !== "aprobada" || Date.now() - Date.parse(v.resuelta_en ?? v.actualizado_en) < 14 * 86_400_000)); }
      else if (vista === "local") { if (!realiza && !esSupervisor) return err("forbidden", 403); if (!esSupervisor) filas = filas.filter((v) => v.enviada_en); if (body.estado) filas = filas.filter((v) => v.estado === String(body.estado)); }
      else if (vista === "origen") {
        const campo = body.cierreId ? "cierre_id" : body.leadId ? "lead_id" : body.vehiculoId ? "vehiculo_id" : body.tasacionId ? "tasacion_id" : "";
        if (!campo) return err("vista_invalida");
        const valor = String(body.cierreId || body.leadId || body.vehiculoId || body.tasacionId);
        filas = filas.filter((v) => v[campo] === valor);
        const visibles: any[] = [];
        for (const v of filas) if (await veVal(v)) visibles.push(v);
        filas = visibles;
      } else return err("vista_invalida");
      return json({ validaciones: await enriquecerVal(filas.slice(0, 200)), puedeRealizar: realiza, puedeGestionar: esSupervisor });
    }

    if (op === "validacion.get") {
      const v = await cargarVal(String(body.id ?? ""));
      if (!v || !(await veVal(v))) return err("no_existe", 404);
      return json(await detalle(v));
    }

    if (op === "validacion.tomar") {
      if (!realiza) return err("forbidden", 403);
      const v = await cargarVal(String(body.id ?? ""));
      if (!v) return err("no_existe", 404);
      if (!v.enviada_en) return err("validacion_sin_enviar", 409);
      const tr = validarTransicionValidacion(v.estado, "tomar");
      if (!tr.ok) return err(v.validador_id ? "validacion_ya_tomada" : tr.error!, 409);
      const ahora = new Date().toISOString();
      const r = await sb.from("validaciones").update({ estado: "en_revision", validador_id: userId, tomada_en: ahora, actualizado_en: ahora }).eq("id", v.id).eq("estado", "pendiente").select().maybeSingle();
      if (r.error) return fallar(r.error);
      if (!r.data) return err("validacion_ya_tomada", 409);
      await anotarVal(v, `${userName} tomó la validación ${folioValidacion(v.numero)}`);
      await audit(ctx.actor, "validacion.tomar", "validacion", v.id, { numero: v.numero });
      return json(await detalle(r.data));
    }

    /**
     * El ejecutivo (o el supervisor) envía a validar los documentos de una compra o consignación: recién ahí entran a la cola del Validador.
     * Exige los datos del cliente y todos los documentos completos.
     */
    if (op === "validacion.enviar") {
      const v = await cargarVal(String(body.id ?? ""));
      if (!v || !(await veVal(v))) return err("no_existe", 404);
      if (!(await puedeAdjuntar(v))) return err("forbidden", 403);
      if (!["compra", "consignacion"].includes(v.tipo)) return err("validacion_estado_invalido");
      if (v.enviada_en) return err("validacion_ya_enviada", 409);
      if (v.estado === "cancelada" || v.estado === "aprobada") return err("validacion_estado_invalido");
      let falta = 0;
      if (v.tipo === "compra") {
        const c = v.compra_id ? (await sb.from("compras").select("*").eq("id", v.compra_id).maybeSingle()).data : null;
        if (!c) return err("no_existe", 404);
        const r = await requisitosDeCompra(c);
        falta = r.aplica ? r.faltantes.length : 0;
      } else {
        if (!v.consignacion_id) return err("consignacion_sin_contrato", 409);
        const lead = v.lead_id ? await cargarLead(v.lead_id) : null;
        if (!lead) return err("no_existe", 404);
        const r = await requisitosDeConsignacion(lead);
        falta = r.aplica ? r.faltantes.length : 0;
      }
      if (falta > 0) return err("envio_incompleto", 409);
      const ahora = new Date().toISOString();
      const up = await sb.from("validaciones").update({ enviada_en: ahora, actualizado_en: ahora }).eq("id", v.id).select().maybeSingle();
      if (up.error) return fallar(up.error);
      if (!up.data) return err("validacion_ya_enviada", 409);
      await anotarVal(v, `${userName} envió a validar los documentos (${folioValidacion(v.numero)})`);
      await audit(ctx.actor, "validacion.enviar", "validacion", v.id, { numero: v.numero });
      await avisarValidadores(v.local_id, "Documentos por validar", [`${userName} envió a validar ${folioValidacion(v.numero)}${v.sujeto && v.sujeto.patente ? ` (vehículo ${v.sujeto.patente})` : ""}.`]);
      return json(await detalle(up.data));
    }

    if (op === "validacion.liberar" || op === "validacion.asignar") {
      const v = await cargarVal(String(body.id ?? ""));
      if (!v || !(await veVal(v))) return err("no_existe", 404);
      const asignar = op === "validacion.asignar";
      const tr = validarTransicionValidacion(v.estado, asignar ? "asignar" : "liberar");
      if (!tr.ok) return err(tr.error!);
      if (asignar ? !esSupervisor : !(esSupervisor || (realiza && v.validador_id === userId))) return err("forbidden", 403);
      let destino: any = null;
      if (asignar) {
        destino = (await validadoresDe(v.local_id)).find((u: any) => u.id === body.validadorId);
        if (!destino) return err("asignado_invalido");
      }
      const { error } = await sb.from("validaciones").update({ validador_id: destino ? destino.id : null, tomada_en: destino ? new Date().toISOString() : null }).eq("id", v.id);
      if (error) return fallar(error);
      const { val } = await recalcular({ ...v, validador_id: destino ? destino.id : null }, !!destino);
      await anotarVal(v, destino ? `Validación ${folioValidacion(v.numero)} asignada a ${destino.nombre} por ${userName}` : `${userName} devolvió la validación ${folioValidacion(v.numero)} a la cola`);
      await audit(ctx.actor, asignar ? "validacion.asignar" : "validacion.liberar", "validacion", v.id, { numero: v.numero });
      return json(await detalle(val));
    }

    // El Validador aprueba, observa, rechaza o declara "no aplica" un documento.
    if (op === "validacion.revisar") {
      if (!realiza) return err("forbidden", 403);
      const v = await cargarVal(String(body.id ?? ""));
      if (!v) return err("no_existe", 404);
      if (v.validador_id !== userId) return err("forbidden", 403);
      const tr = validarTransicionValidacion(v.estado, "revisar");
      if (!tr.ok) return err(tr.error!);
      const doc = (await docsDe([v.id])).find((d: any) => d.id === body.docId);
      if (!doc) return err("no_existe", 404);
      const r = validarRevision(body);
      if (!r.ok) return err(r.error!);
      if (r.value.estado === "aprobado" && (doc.archivos ?? []).length === 0) return err("doc_sin_archivo");
      const ahora = new Date().toISOString();
      const up = await sb.from("validacion_docs").update({ estado: r.value.estado, comentario: r.value.comentario, revisado_por: userName, revisado_en: ahora, actualizado_en: ahora }).eq("id", doc.id);
      if (up.error) return fallar(up.error);
      const { val } = await recalcular(v);
      if (val.estado === "aprobada") {
        await anotarVal(v, `Validación ${folioValidacion(v.numero)} aprobada por ${userName}: documentos en orden`);
        if (val.consignacion_id) {
          const cq = await sb.from("consignaciones").select("*").eq("id", val.consignacion_id).maybeSingle();
          if (cq.data && cq.data.estado === "en_validacion") {
            const act = await activarConsignacion(cq.data);
            if (!act.ok) await anotarVal(v, `No se pudo activar la consignación: ${act.error === "patente_duplicada" ? "ya hay un vehículo activo con esa patente" : act.error}`);
          }
        }
      }
      else if (r.value.estado === "observado" || r.value.estado === "rechazado") await anotarVal(v, `${userName} ${r.value.estado === "observado" ? "observó" : "rechazó"} «${doc.nombre}» (${folioValidacion(v.numero)}): ${r.value.comentario}`);
      await audit(ctx.actor, "validacion.revisar", "validacion", v.id, { numero: v.numero, doc: doc.clave, estado: r.value.estado, resultado: val.estado });
      if (val.estado === "aprobada" || r.value.estado === "observado" || r.value.estado === "rechazado") {
        const texto = val.estado === "aprobada" ? `${userName} aprobó la validación ${folioValidacion(v.numero)}: documentos en orden.` : `${userName} ${r.value.estado === "observado" ? "observó" : "rechazó"} «${doc.nombre}» (${folioValidacion(v.numero)})${r.value.comentario ? `: ${r.value.comentario}` : "."}`;
        if (v.lead_id) await avisarEjecutivoDe(v.lead_id, val.estado === "aprobada" ? "Documentos validados" : "Documento con observaciones", texto);
      }
      return json(await detalle(val));
    }

    if (op === "validacion.adjuntar" || op === "validacion.quitar") {
      const v = await cargarVal(String(body.id ?? ""));
      if (!v || !(await veVal(v))) return err("no_existe", 404);
      if (!(await puedeAdjuntar(v))) return err("forbidden", 403);
      if (v.estado === "aprobada" || v.estado === "cancelada") return err("validacion_estado_invalido");
      const doc = (await docsDe([v.id])).find((d: any) => d.id === body.docId);
      if (!doc) return err("no_existe", 404);
      if (doc.estado === "aprobado" || doc.estado === "no_aplica") return err("doc_cerrado");
      let archivos: any[] = doc.archivos ?? [];
      if (op === "validacion.adjuntar") {
        const a = validarArchivo(body.archivo);
        if (!a.ok) return err(a.error!);
        if (TIPOS_CON_REGLAS.includes(v.tipo)) { const t = archivoPermitidoParaDoc(doc.clave, a.value.tipo); if (!t.ok) return err(t.error!); }
        if (archivos.length >= MAX_ARCHIVOS_DOC) return err("demasiados_archivos");
        archivos = [...archivos, a.value];
      } else {
        const que = archivos.find((a: any) => a.id === String(body.archivoId ?? ""));
        if (!que) return err("no_existe", 404);
        if (que.v && que.v !== v.id) return err("archivo_reutilizado");
        archivos = archivos.filter((a: any) => a.id !== que.id);
      }
      // Si el documento estaba observado o rechazado, vuelve a revisión con el archivo nuevo.
      const reabre = op === "validacion.adjuntar" && (doc.estado === "observado" || doc.estado === "rechazado");
      const { error } = await sb.from("validacion_docs").update({ archivos, ...(reabre ? { estado: "pendiente" } : {}), actualizado_en: new Date().toISOString() }).eq("id", doc.id);
      if (error) return fallar(error);
      const { val } = await recalcular(v);
      if (reabre) await anotarVal(v, `${userName} corrigió «${doc.nombre}» (${folioValidacion(v.numero)}): vuelve a revisión`);
      await audit(ctx.actor, op === "validacion.adjuntar" ? "validacion.adjuntar" : "validacion.quitar", "validacion", v.id, { numero: v.numero, doc: doc.clave });
      return json(await detalle(val));
    }

    /** Fecha de vencimiento (permiso, revisión técnica, SOAP) y precio del permiso de circulación de una compra. */
    if (op === "validacion.datosDoc") {
      const v = await cargarVal(String(body.id ?? ""));
      if (!v || !(await veVal(v))) return err("no_existe", 404);
      if (!TIPOS_CON_REGLAS.includes(v.tipo)) return err("doc_sin_datos");
      if (!(await puedeAdjuntar(v))) return err("forbidden", 403);
      if (v.estado === "aprobada" || v.estado === "cancelada") return err("validacion_estado_invalido");
      const doc = (await docsDe([v.id])).find((d: any) => d.id === body.docId);
      if (!doc) return err("no_existe", 404);
      if (doc.estado === "aprobado" || doc.estado === "no_aplica") return err("doc_cerrado");
      const dd = validarDatosDoc(doc.clave, body);
      if (!dd.ok) return err(dd.error!);
      const { error } = await sb.from("validacion_docs").update({ ...dd.value, actualizado_en: new Date().toISOString() }).eq("id", doc.id);
      if (error) return fallar(error);
      await audit(ctx.actor, "validacion.datos_doc", "validacion", v.id, { numero: v.numero, doc: doc.clave, ...dd.value });
      return json(await detalle(v));
    }

    if (op === "validacion.resumen") {
      if (!realiza && !esSupervisor) return err("forbidden", 403);
      const mes = body.mes === undefined ? mesChile() : String(body.mes);
      if (!esMes(mes)) return err("mes_invalido");
      const { data, error } = await scoped(sb.from("validaciones").select("*"));
      if (error) return fallar(error);
      const todas: any[] = (data ?? []).filter((v: any) => v.estado !== "cancelada");
      let cfg;
      try { cfg = await configNegocio(); } catch (e) { return fallo(e); }
      let personas: any[];
      if (esSupervisor) {
        const base = localId ? await validadoresDe(localId) : [];
        const extra = await porIds("usuarios", todas.map((v) => v.validador_id).filter((id) => id && !base.some((b: any) => b.id === id)));
        personas = [...base, ...extra];
      } else personas = await porIds("usuarios", [userId]);
      const validadores = personas.map((u: any) => ({ id: u.id, nombre: u.nombre, ...metricasValidador(todas, u.id, mes) })).sort((a: any, b: any) => b.aprobadas - a.aprobadas || a.nombre.localeCompare(b.nombre));
      const cola = colaValidaciones(todas.filter((v: any) => v.enviada_en), new Date(), cfg.horas_validacion);
      return json({ mes, nombreMes: nombreMes(mes), validadores, cola: { pendientes: cola.pendientes, masAntiguaHoras: cola.masAntiguaHoras, atrasadas: cola.atrasadas.length }, horasLimite: cfg.horas_validacion, esSupervisor });
    }

    return err("unknown_op");
  }

  /* ---------- inspecciones (Inspector, solicitudes con cola y agenda) ---------- */
  if (op.startsWith("inspecciones.")) {
    const realiza = can("inspecciones.realizar");
    const puedePedir = can("inspecciones.pedir") || esSupervisor;
    // Quien ve el inventario puede mirar las inspecciones de un vehículo (solo la lista de origen); no pide ni modifica.
    const soloMiraInventario = op === "inspecciones.list" && (can("inventario.ver") || can("inventario.editar"));
    if (!realiza && !puedePedir && !soloMiraInventario) return err("forbidden", 403);

    /** Personas activas del local que pueden realizar inspecciones. */
    async function inspectoresDe(local: string) {
      const overrides = await ctx.rolePermOverrides();
      const { data, error } = await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id, comision").eq("local_id", local);
      if (error) throw error;
      return (data ?? []).filter((u: any) => u.activo && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("inspecciones.realizar"));
    }
    async function cargarInspeccion(id: string) {
      const { data, error } = await scoped(sb.from("inspecciones").select("*").eq("id", id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    /** ¿Puede ver la inspección? Quien inspecciona, el supervisor, quien la pidió o quien ve el lead de origen. */
    async function veInspeccion(i: any) {
      if (realiza || esSupervisor || (!ctx.esAdmin && i.solicitante_id === userId)) return true;
      if (i.lead_id) { const l = await cargarLead(i.lead_id); if (l && puedeVer(l)) return true; }
      return false;
    }
    /** Agrega nombres para mostrar. La ficha completa del Inspector (con datos del propietario) nunca sale de aquí. */
    async function enriquecer(filas: any[]) {
      const leads = await porIds("leads", filas.map((x) => x.lead_id));
      const clientes = await porIds("clientes", leads.map((l: any) => l.cliente_id));
      const usuarios = await porIds("usuarios", filas.flatMap((x) => [x.solicitante_id, x.inspector_id]));
      const nombre = (id: string) => (usuarios.find((u: any) => u.id === id) || {}).nombre ?? "";
      return filas.map(({ inspeccion_key, ...x }) => {
        const l = leads.find((y: any) => y.id === x.lead_id);
        return {
          ...x, fotos: x.fotos ?? [], folio: folioInspeccion(x.numero), cliente: l ? (clientes.find((c: any) => c.id === l.cliente_id) || {}).nombre ?? "" : "",
          solicitante: nombre(x.solicitante_id), inspector: nombre(x.inspector_id), tieneFicha: !!inspeccion_key, fichaId: idDeClave(inspeccion_key),
          // Solo su Inspector (o la cuenta maestra) recibe la clave de su ficha, para abrirla.
          fichaKey: inspeccion_key && (ctx.esAdmin || x.inspector_id === userId) ? inspeccion_key : null,
        };
      });
    }
    const fallar = (e: any) => fallo(e);
    const anotar = async (i: any, texto: string) => { if (i.lead_id) await evento(i.lead_id, "inspeccion", texto); };

    if (op === "inspecciones.equipo") {
      if (!esSupervisor) return err("forbidden", 403);
      const local = await localParaCrear();
      if (!local) return err("sin_local");
      return json({ inspectores: (await inspectoresDe(local)).map((u: any) => ({ id: u.id, nombre: u.nombre })) });
    }

    /** Locales activos con su dirección (casa matriz y sucursales), para elegir dónde se hace la inspección. */
    async function lugaresDeInspeccion() {
      const { data, error } = await sb.from("locales").select("id, nombre, direccion, activo");
      if (error) throw error;
      return (data ?? []).filter((l: any) => l.activo !== false);
    }
    /** Si la solicitud trae «lugar» (local o terreno), arma la dirección a partir de él; si no, queda la dirección escrita. */
    async function conLugar(datos: any) {
      if (!datos || !datos.lugar) return { ok: true, datos };
      const r = resolverLugar(datos.lugar, await lugaresDeInspeccion());
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, datos: { ...datos, direccion: r.value.direccion } };
    }
    if (op === "inspecciones.lugares") {
      return json({ lugares: (await lugaresDeInspeccion()).map((l: any) => ({ id: l.id, nombre: l.nombre, direccion: l.direccion ?? "" })).sort((a: any, b: any) => String(a.nombre).localeCompare(String(b.nombre), "es")) });
    }

    if (op === "inspecciones.pedir") {
      if (!puedePedir) return err("forbidden", 403);
      const lg = await conLugar(body.datos);
      if (!lg.ok) return err(lg.error!);
      const v = validarSolicitudInspeccion(lg.datos);
      if (!v.ok) return err(v.error!);
      const origen = String(body.origen ?? "");
      let fila: Record<string, unknown> = { vehiculo: v.value.vehiculo, patente: v.value.vehiculo.patente, direccion: v.value.direccion, agendada_para: v.value.fechaHora, contacto_lugar: v.value.contactoLugar, notas_solicitud: v.value.notas, solicitante_id: ctx.esAdmin ? null : userId, creado_por: userId };
      if (origen === "lead") {
        const lead = await cargarLead(String(body.leadId ?? ""));
        if (!lead || !puedeVer(lead)) return err("no_existe", 404);
        if (!puedeTocar(lead)) return err("forbidden", 403);
        if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
        fila = { ...fila, origen: "lead", lead_id: lead.id, local_id: lead.local_id };
      } else if (origen === "tasacion") {
        const tq = await scoped(sb.from("tasaciones").select("id, local_id, lead_id, solicitante_id").eq("id", String(body.tasacionId ?? ""))).maybeSingle();
        if (tq.error) return fallar(tq.error);
        const t = tq.data;
        if (!t) return err("no_existe", 404);
        if (!(esSupervisor || can("tasaciones.realizar") || (!ctx.esAdmin && t.solicitante_id === userId))) return err("forbidden", 403);
        fila = { ...fila, origen: "tasacion", tasacion_id: t.id, lead_id: t.lead_id ?? null, local_id: t.local_id };
      } else if (origen === "vehiculo") {
        if (!can("inventario.ver") && !can("inventario.editar") && !esSupervisor) return err("forbidden", 403);
        const vq = await scoped(sb.from("vehiculos").select("id, local_id").eq("id", String(body.vehiculoId ?? ""))).maybeSingle();
        if (vq.error) return fallar(vq.error);
        if (!vq.data) return err("no_existe", 404);
        fila = { ...fila, origen: "vehiculo", vehiculo_id: vq.data.id, local_id: vq.data.local_id };
      } else return err("origen_invalido");
      // Una misma patente no puede tener dos inspecciones abiertas a la vez.
      const previas = await sb.from("inspecciones").select("id, estado").eq("patente", v.value.vehiculo.patente).in("estado", ["pendiente", "en_proceso"]);
      if (previas.error) return fallar(previas.error);
      if ((previas.data ?? []).length > 0) return err("inspeccion_en_curso", 409);
      const ins = await sb.from("inspecciones").insert(fila).select().single();
      if (ins.error) return fallar(ins.error);
      const vh = v.value.vehiculo;
      await anotar(ins.data, `Inspección ${folioInspeccion(ins.data.numero)} pedida por ${userName} para el ${fechaCL(v.value.fechaHora)}: ${vh.marca} ${vh.modelo} ${vh.anio} (${vh.patente}) en ${v.value.direccion}`);
      await audit(ctx.actor, "inspeccion.pedir", "inspeccion", ins.data.id, { numero: ins.data.numero, patente: vh.patente, origen });
      await avanzarEtapa(ins.data.lead_id, ["nuevo", "contactado", "seguimiento"], "tasacion", "se pidió la inspección");
      return json({ inspeccion: (await enriquecer([ins.data]))[0] });
    }

    if (op === "inspecciones.list") {
      const vista = String(body.vista ?? "");
      const { data, error } = await scoped(sb.from("inspecciones").select("*").order("agendada_para", { ascending: true }));
      if (error) return fallar(error);
      let filas: any[] = data ?? [];
      const masNuevaPrimero = (a: any, b: any) => String(b.agendada_para ?? b.completada_en).localeCompare(String(a.agendada_para ?? a.completada_en));
      if (vista === "cola") { if (!realiza && !esSupervisor) return err("forbidden", 403); filas = filas.filter((x) => x.estado === "pendiente"); }
      else if (vista === "agenda") { if (!realiza) return err("forbidden", 403); filas = ordenarAgenda(filas.filter((x) => x.inspector_id === userId)); }
      else if (vista === "mias") { if (!realiza) return err("forbidden", 403); filas = filas.filter((x) => x.inspector_id === userId && x.estado !== "cancelada").sort(masNuevaPrimero); }
      else if (vista === "local") { if (!esSupervisor && !realiza) return err("forbidden", 403); if (body.estado) filas = filas.filter((x) => x.estado === String(body.estado)); filas.sort(masNuevaPrimero); }
      else if (vista === "solicitadas") filas = filas.filter((x) => x.solicitante_id === userId).sort(masNuevaPrimero);
      else if (vista === "origen") {
        const campo = body.leadId ? "lead_id" : body.tasacionId ? "tasacion_id" : body.vehiculoId ? "vehiculo_id" : "";
        if (!campo) return err("vista_invalida");
        const valor = String(body.leadId || body.tasacionId || body.vehiculoId);
        if (campo === "lead_id") { const l = await cargarLead(valor); if (!l || !puedeVer(l)) return err("no_existe", 404); }
        else if (campo === "tasacion_id" ? !(puedePedir || realiza) : !(puedePedir || realiza || can("inventario.ver") || can("inventario.editar"))) return err("forbidden", 403);
        // Las del inventario también incluyen las que se pidieron desde el lead o la tasación del mismo vehículo (misma patente).
        let patenteVeh = "";
        if (campo === "vehiculo_id") patenteVeh = String(((await sb.from("vehiculos").select("patente").eq("id", valor).maybeSingle()).data || {}).patente ?? "");
        filas = filas.filter((x) => x[campo] === valor || (patenteVeh && x.patente === patenteVeh)).sort((a, b) => String(b.solicitada_en).localeCompare(String(a.solicitada_en)));
      } else return err("vista_invalida");
      const hace60 = Date.now() - 60 * 86_400_000;
      filas = filas.filter((x) => !(x.estado === "cancelada" && Date.parse(x.actualizado_en) < hace60)).slice(0, 200);
      return json({ inspecciones: await enriquecer(filas), puedeRealizar: realiza, puedeGestionar: esSupervisor, puedePedir });
    }

    if (op === "inspecciones.get") {
      const x = await cargarInspeccion(String(body.id ?? ""));
      if (!x || !(await veInspeccion(x))) return err("no_existe", 404);
      return json({ inspeccion: (await enriquecer([x]))[0], puedeGestionar: esSupervisor, puedeRealizar: realiza, esMia: !ctx.esAdmin && x.inspector_id === userId, esSolicitante: !ctx.esAdmin && x.solicitante_id === userId });
    }

    // Los datos para armar los PDF de una inspección ya realizada (y de su valorización, si el Inspector la hizo desde ella).
    // Quien ve la inspección los recibe SIN los datos del propietario ni el archivo del CAV: eso queda solo en la ficha del Inspector.
    if (op === "inspecciones.informes") {
      const x = await cargarInspeccion(String(body.id ?? ""));
      if (!x || !(await veInspeccion(x))) return err("no_existe", 404);
      if (x.estado !== "completada" || !x.inspeccion_key) return err("inspeccion_sin_ficha", 409);
      const g = await sb.from("kv_store").select("value").eq("key", x.inspeccion_key).maybeSingle();
      if (g.error) return fallar(g.error);
      if (!g.data) return err("inspeccion_sin_ficha", 409);
      let ficha: any = {};
      try { ficha = JSON.parse(g.data.value); } catch { return err("inspeccion_sin_ficha", 409); }
      const { cavFileData, cavFileName, propietarioNombre, propietarioRun, fotosEquipo, ...inspeccion } = ficha;
      let valorizacion: any = null;
      if (x.inspector_id) {
        const q = await sb.from("kv_store").select("key, value").like("key", `tasacion::${x.inspector_id}::%`).ilike("value", `%"inspeccionId":"${x.inspeccion_key}"%`).limit(10);
        if (q.error) return fallar(q.error);
        const halladas = (q.data ?? []).map((f: any) => { try { return JSON.parse(f.value); } catch { return null; } })
          .filter((d: any) => d && d.inspeccionId === x.inspeccion_key)
          .sort((a: any, b: any) => String(b.guardadoEl || b.fecha || "").localeCompare(String(a.guardadoEl || a.fecha || "")));
        if (halladas[0]) { const { propietario, ...v } = halladas[0]; valorizacion = v; }
      }
      const [insp] = x.inspector_id ? await porIds("usuarios", [x.inspector_id]) : [null];
      return json({ inspeccion, valorizacion, inspector: insp ? insp.nombre : "" });
    }

    // Quiénes pueden tener fichas e inspecciones en el almacén: el supervisor ve las de su local; la cuenta maestra, las de todos los locales.
    if (op === "inspecciones.fichas_equipo") {
      if (!esSupervisor) return err("forbidden", 403);
      const overrides = await ctx.rolePermOverrides();
      let q = sb.from("usuarios").select("id, nombre, rut, roles, permisos_extra, activo, local_id");
      if (!ctx.esAdmin) q = q.eq("local_id", localId);
      const { data, error } = await q;
      if (error) return fallar(error);
      const inspectores = (data ?? [])
        .filter((u: any) => { const p = permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra); return p.includes("inspecciones.usar") || p.includes("tasaciones.usar") || p.includes("inspecciones.realizar"); })
        .map((u: any) => ({ id: u.id, nombre: u.nombre, activo: !!u.activo }));
      return json({ inspectores });
    }

    // El supervisor corrige los PRECIOS de una valorización del Inspector (valor comercial y valores del checklist). Nada más de la ficha cambia.
    if (op === "inspecciones.valorizacion_ajustar") {
      if (!esSupervisor) return err("forbidden", 403);
      const clave = String(body.key ?? "");
      const m = /^tasacion::([0-9a-f-]{36})::[A-Za-z0-9_-]{1,80}$/i.exec(clave);
      if (!m) return err("clave_invalida");
      const dueno = await sb.from("usuarios").select("local_id, nombre").eq("id", m[1]).maybeSingle();
      if (dueno.error) return fallar(dueno.error);
      if (!dueno.data || (!ctx.esAdmin && dueno.data.local_id !== localId)) return err("no_existe", 404);
      const entero = (v: unknown) => (typeof v === "number" || typeof v === "string") && String(v).trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 10_000_000_000 ? Math.round(Number(v)) : null;
      const pedidos: Record<string, number> = {};
      let comercial: number | null = null;
      if (body.valorComercial !== undefined && body.valorComercial !== null) {
        comercial = entero(body.valorComercial);
        if (comercial === null) return err("valor_invalido");
      }
      if (body.items !== undefined && (typeof body.items !== "object" || body.items === null || Array.isArray(body.items))) return err("valor_invalido");
      for (const [id, v] of Object.entries((body.items ?? {}) as Record<string, unknown>)) {
        const n = entero(v);
        if (n === null) return err("valor_invalido");
        pedidos[String(id).slice(0, 80)] = n;
      }
      if (comercial === null && Object.keys(pedidos).length === 0) return err("sin_cambio");
      const fila = await sb.from("kv_store").select("value").eq("key", clave).maybeSingle();
      if (fila.error) return fallar(fila.error);
      if (!fila.data) return err("no_existe", 404);
      let rec: any;
      try { rec = JSON.parse(fila.data.value); } catch { return err("ficha_ilegible", 422); }
      if (!rec || typeof rec !== "object") return err("ficha_ilegible", 422);
      rec.checklist = rec.checklist && typeof rec.checklist === "object" ? rec.checklist : {};
      const cambios: any[] = [];
      const ahora = new Date().toISOString();
      if (comercial !== null && Number(rec.valorComercial ?? 0) !== comercial) {
        cambios.push({ campo: "Valor comercial estimado", antes: Number(rec.valorComercial ?? 0), despues: comercial });
        rec.valorComercial = comercial;
      }
      for (const [id, n] of Object.entries(pedidos)) {
        const it = rec.checklist[id];
        if (!it || typeof it !== "object") return err("item_invalido");
        if (Number(it.valor ?? 0) !== n) {
          cambios.push({ campo: String(it.nombre || id), item: id, antes: Number(it.valor ?? 0), despues: n });
          it.valor = n;
        }
      }
      if (cambios.length === 0) return err("sin_cambio");
      rec.ajustes = [...(Array.isArray(rec.ajustes) ? rec.ajustes : []), ...cambios.map((c) => ({ ...c, por: userName, en: ahora }))].slice(-60);
      const up = await sb.from("kv_store").upsert({ key: clave, value: JSON.stringify(rec), shared: true, updated_at: ahora }, { onConflict: "key" });
      if (up.error) return fallar(up.error);
      await audit(ctx.actor, "valorizacion.ajustar", "valorizacion", clave, { inspector: dueno.data.nombre, patente: rec.patente ?? null, cambios: cambios.map((c) => ({ campo: c.campo, antes: c.antes, despues: c.despues })) });
      return json({ ok: true, cambios: cambios.length, ajustes: rec.ajustes });
    }

    if (op === "inspecciones.tomar") {
      if (!realiza || ctx.esAdmin) return err("forbidden", 403);
      const x = await cargarInspeccion(String(body.id ?? ""));
      if (!x) return err("no_existe", 404);
      const tr = validarTransicionInspeccion(x.estado, "tomar");
      if (!tr.ok) return err(x.estado === "en_proceso" ? "inspeccion_ya_tomada" : tr.error!, 409);
      const r = await sb.from("inspecciones").update({ estado: "en_proceso", inspector_id: userId, tomada_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }).eq("id", x.id).eq("estado", "pendiente").select().maybeSingle();
      if (r.error) return fallar(r.error);
      if (!r.data) return err("inspeccion_ya_tomada", 409);
      await anotar(x, `${userName} tomó la inspección ${folioInspeccion(x.numero)}: irá el ${fechaCL(x.agendada_para)}`);
      await audit(ctx.actor, "inspeccion.tomar", "inspeccion", x.id, { numero: x.numero });
      const suyas = await sb.from("inspecciones").select("*").eq("inspector_id", userId).eq("estado", "en_proceso");
      return json({ inspeccion: (await enriquecer([r.data]))[0], choque: hayChoque(suyas.data ?? [], userId, x.agendada_para, x.id) });
    }

    if (op === "inspecciones.liberar" || op === "inspecciones.asignar") {
      const x = await cargarInspeccion(String(body.id ?? ""));
      if (!x || !(await veInspeccion(x))) return err("no_existe", 404);
      const asignar = op === "inspecciones.asignar";
      const tr = validarTransicionInspeccion(x.estado, asignar ? "asignar" : "liberar");
      if (!tr.ok) return err(tr.error!);
      if (asignar ? !esSupervisor : !(esSupervisor || (realiza && x.inspector_id === userId))) return err("forbidden", 403);
      let patch: Record<string, unknown>;
      let texto: string;
      if (asignar) {
        const destino = (await inspectoresDe(x.local_id)).find((u: any) => u.id === body.inspectorId);
        if (!destino) return err("asignado_invalido");
        patch = { estado: "en_proceso", inspector_id: destino.id, tomada_en: new Date().toISOString() };
        texto = `Inspección ${folioInspeccion(x.numero)} asignada a ${destino.nombre} por ${userName}`;
      } else {
        patch = { estado: "pendiente", inspector_id: null, tomada_en: null };
        texto = `${userName} devolvió la inspección ${folioInspeccion(x.numero)} a la cola`;
      }
      const { data, error } = await sb.from("inspecciones").update({ ...patch, actualizado_en: new Date().toISOString() }).eq("id", x.id).select().single();
      if (error) return fallar(error);
      await anotar(x, texto);
      await audit(ctx.actor, asignar ? "inspeccion.asignar" : "inspeccion.liberar", "inspeccion", x.id, { numero: x.numero });
      return json({ inspeccion: (await enriquecer([data]))[0] });
    }

    if (op === "inspecciones.reprogramar") {
      const x = await cargarInspeccion(String(body.id ?? ""));
      if (!x || !(await veInspeccion(x))) return err("no_existe", 404);
      const tr = validarTransicionInspeccion(x.estado, "reprogramar");
      if (!tr.ok) return err(tr.error!);
      const suya = !ctx.esAdmin && (x.solicitante_id === userId || x.inspector_id === userId);
      if (!(esSupervisor || suya)) return err("forbidden", 403);
      const lgr = await conLugar(body.datos);
      if (!lgr.ok) return err(lgr.error!);
      const v = validarReprogramacion(lgr.datos);
      if (!v.ok) return err(v.error!);
      const { data, error } = await sb.from("inspecciones").update({ agendada_para: v.value.fechaHora, direccion: v.value.direccion, contacto_lugar: v.value.contactoLugar, actualizado_en: new Date().toISOString() }).eq("id", x.id).select().single();
      if (error) return fallar(error);
      await anotar(x, `${userName} reprogramó la inspección ${folioInspeccion(x.numero)} para el ${fechaCL(v.value.fechaHora)} en ${v.value.direccion}`);
      await audit(ctx.actor, "inspeccion.reprogramar", "inspeccion", x.id, { numero: x.numero, agendada_para: v.value.fechaHora });
      return json({ inspeccion: (await enriquecer([data]))[0] });
    }

    if (op === "inspecciones.cancelar") {
      const x = await cargarInspeccion(String(body.id ?? ""));
      if (!x || !(await veInspeccion(x))) return err("no_existe", 404);
      const tr = validarTransicionInspeccion(x.estado, "cancelar");
      if (!tr.ok) return err(tr.error!);
      const duenoDeLaSolicitud = !ctx.esAdmin && x.solicitante_id === userId && x.estado === "pendiente";
      if (!(esSupervisor || duenoDeLaSolicitud || (realiza && x.inspector_id === userId))) return err("forbidden", 403);
      const motivo = String(body.motivo ?? "").trim().slice(0, 150);
      if (motivo.length < 3) return err("motivo_requerido");
      const ahora = new Date().toISOString();
      const { data, error } = await sb.from("inspecciones").update({ estado: "cancelada", cancelada_en: ahora, motivo_cancelacion: motivo, actualizado_en: ahora }).eq("id", x.id).select().single();
      if (error) return fallar(error);
      await anotar(x, `Inspección ${folioInspeccion(x.numero)} cancelada por ${userName}: ${motivo}`);
      await audit(ctx.actor, "inspeccion.cancelar", "inspeccion", x.id, { numero: x.numero, motivo });
      return json({ inspeccion: (await enriquecer([data]))[0] });
    }

    // El Inspector guardó una ficha: aquí queda el resultado visible para el equipo (nunca los datos del propietario).
    if (op === "inspecciones.registrar") {
      if (!realiza || ctx.esAdmin) return err("forbidden", 403);
      const v = validarResultadoInspeccion(body);
      if (!v.ok) return err(v.error!);
      if (!claveEsDe(v.value.key, userId)) return err("forbidden", 403);
      const ahora = new Date().toISOString();
      const datos = { resultado: v.value.resumen, fotos: v.value.fotos, actualizado_en: ahora };
      const hallada = await sb.from("inspecciones").select("*").eq("inspeccion_key", v.value.key).maybeSingle();
      if (hallada.error) return fallar(hallada.error);
      let fila: any;
      if (hallada.data) {
        if (hallada.data.inspector_id !== userId) return err("forbidden", 403);
        const r = await sb.from("inspecciones").update(datos).eq("id", hallada.data.id).select().single();
        if (r.error) return fallar(r.error);
        fila = r.data;
      } else if (body.solicitudId) {
        const x = await cargarInspeccion(String(body.solicitudId));
        if (!x) return err("no_existe", 404);
        if (x.inspector_id !== userId) return err("forbidden", 403);
        const tr = validarTransicionInspeccion(x.estado, "completar");
        if (!tr.ok) return err(tr.error!);
        const r = await sb.from("inspecciones").update({ ...datos, estado: "completada", inspeccion_key: v.value.key, completada_en: ahora }).eq("id", x.id).eq("estado", "en_proceso").select().maybeSingle();
        if (r.error) return fallar(r.error);
        if (!r.data) return err("inspeccion_estado_invalido", 409);
        fila = r.data;
        const distinta = r.data.patente && v.value.vehiculo.patente !== r.data.patente;
        await anotar(x, `Inspección ${folioInspeccion(x.numero)} realizada por ${userName}: ${VEREDICTOS[v.value.resumen.veredicto as keyof typeof VEREDICTOS]}${distinta ? ` (la patente de la ficha es ${v.value.vehiculo.patente})` : ""}`);
      } else {
        const r = await sb.from("inspecciones").insert({
          ...datos, origen: "espontanea", estado: "completada", inspector_id: userId, local_id: localId, vehiculo: v.value.vehiculo, patente: v.value.vehiculo.patente,
          inspeccion_key: v.value.key, solicitada_en: ahora, tomada_en: ahora, completada_en: ahora, creado_por: userId,
        }).select().single();
        if (r.error) return fallar(r.error);
        fila = r.data;
      }
      await audit(ctx.actor, "inspeccion.registrar", "inspeccion", fila.id, { numero: fila.numero, patente: v.value.vehiculo.patente, origen: fila.origen, veredicto: v.value.resumen.veredicto });
      await avanzarEtapa(fila.lead_id, ["tasacion"], "contrato", "la inspección está lista", ["consignacion"]);
      if (fila.origen !== "espontanea" && fila.solicitante_id) await avisarA([fila.solicitante_id], "Inspección realizada", [`${userName} realizó la inspección ${folioInspeccion(fila.numero)} de ${v.value.vehiculo.patente}.`, `Veredicto: ${VEREDICTOS[v.value.resumen.veredicto as keyof typeof VEREDICTOS]}.`]);
      return json({ inspeccion: (await enriquecer([fila]))[0] });
    }

    // El Inspector eliminó su ficha: la espontánea desaparece; la pedida vuelve a "agendada" para rehacerla.
    if (op === "inspecciones.eliminar") {
      if (!realiza || ctx.esAdmin) return err("forbidden", 403);
      const clave = String(body.key ?? "");
      if (!claveEsDe(clave, userId)) return err("forbidden", 403);
      const h = await sb.from("inspecciones").select("*").eq("inspeccion_key", clave).maybeSingle();
      if (h.error) return fallar(h.error);
      if (!h.data) return json({ ok: true });
      if (h.data.inspector_id !== userId) return err("forbidden", 403);
      if (h.data.origen === "espontanea") {
        const d = await sb.from("inspecciones").delete().eq("id", h.data.id);
        if (d.error) return fallar(d.error);
      } else {
        const u = await sb.from("inspecciones").update({ estado: "en_proceso", inspeccion_key: null, resultado: {}, fotos: [], completada_en: null, actualizado_en: new Date().toISOString() }).eq("id", h.data.id);
        if (u.error) return fallar(u.error);
        await anotar(h.data, `${userName} eliminó la ficha de la inspección ${folioInspeccion(h.data.numero)}: quedó pendiente de rehacer`);
      }
      await audit(ctx.actor, "inspeccion.eliminar", "inspeccion", h.data.id, { numero: h.data.numero, origen: h.data.origen });
      return json({ ok: true });
    }

    if (op === "inspecciones.resumen") {
      if (!realiza && !esSupervisor) return err("forbidden", 403);
      const mes = body.mes === undefined ? mesChile() : String(body.mes);
      if (!esMes(mes)) return err("mes_invalido");
      const { data, error } = await scoped(sb.from("inspecciones").select("*"));
      if (error) return fallar(error);
      const todas: any[] = data ?? [];
      let cfg;
      try { cfg = await configNegocio(); } catch (e) { return fallo(e); }
      let personas: any[];
      if (esSupervisor) {
        const base = localId ? await inspectoresDe(localId) : [];
        const extra = await porIds("usuarios", todas.map((x) => x.inspector_id).filter((id) => id && !base.some((b: any) => b.id === id)));
        personas = [...base, ...extra];
      } else personas = await porIds("usuarios", [userId]);
      const inspectores = personas.map((u: any) => {
        const m = metricasInspector(todas, u.id, mes);
        const tramos = tramosEfectivos(u.comision);
        return {
          id: u.id, nombre: u.nombre, ...m, tramos, produccion: calcularProduccion({ inspeccionesN: m.hechas }, tramos).inspecciones,
          personalizado: Object.keys((u.comision && u.comision.tramos) || {}).length > 0,
        };
      }).sort((a: any, b: any) => b.hechas - a.hechas || a.nombre.localeCompare(b.nombre));
      const cola = colaInspecciones(todas, new Date(), cfg.horas_inspeccion);
      return json({ mes, nombreMes: nombreMes(mes), inspectores, cola: { pendientes: cola.pendientes, masAntiguaHoras: cola.masAntiguaHoras, atrasadas: cola.atrasadas.length }, horasLimite: cfg.horas_inspeccion, esSupervisor });
    }

    return err("unknown_op");
  }

  /* Todo lo que sigue exige poder trabajar con leads. */
  if (!usaLeads) return err("forbidden", 403);

  /* ---------- compras (la automotora le compra un vehículo a un cliente) ---------- */
  if (op.startsWith("compras.")) {
    const opera = ctx.esAdmin ? false : can("compras.operar") && can("leads.propios");
    const fallar = (e: any) => fallo(e);
    if (!opera && !esSupervisor) return err("forbidden", 403);

    async function cargarCompra(id: string) {
      const { data, error } = await scoped(sb.from("compras").select("*").eq("id", id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    /** ¿Puede ver esta compra? Su ejecutivo o quien supervisa el local. */
    const veCompra = (c: any) => esSupervisor || (opera && c.ejecutivo_id === userId);
    const enriquecerCompras = async (filas: any[]) => {
      const [usuarios, clientes, tasaciones, vals] = await Promise.all([
        porIds("usuarios", filas.map((c) => c.ejecutivo_id)), porIds("clientes", filas.map((c) => c.cliente_id)),
        porIds("tasaciones", filas.map((c) => c.tasacion_id)), enLotes("validaciones", "compra_id", filas.map((c) => c.id)).catch(() => [] as any[]),
      ]);
      return filas.map((c) => {
        const v = vals.filter((x: any) => x.compra_id === c.id && x.estado !== "cancelada").sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en)))[0];
        const t = tasaciones.find((x: any) => x.id === c.tasacion_id);
        return {
          ...c, folio: folioCompra(c.numero), ejecutivo: (usuarios.find((u: any) => u.id === c.ejecutivo_id) || {}).nombre ?? "",
          cliente: (clientes.find((x: any) => x.id === c.cliente_id) || {}).nombre ?? "", validacion: v ? { id: v.id, folio: folioValidacion(v.numero), estado: v.estado, enviada: !!v.enviada_en } : null,
          tasacion: t ? { id: t.id, valor_compra: t.valor_compra, valor_venta: t.valor_venta } : null,
        };
      });
    };
    const compraDetalle = async (c: any) => ({ compra: (await enriquecerCompras([c]))[0], puedeAprobar: esSupervisor, puedeOperar: opera });

    if (op === "compras.list") {
      const vista = String(body.vista ?? "");
      const { data, error } = await scoped(sb.from("compras").select("*").order("creado_en", { ascending: false }));
      if (error) return fallar(error);
      let filas: any[] = data ?? [];
      if (vista === "mias") { if (!opera) return err("forbidden", 403); filas = filas.filter((c) => c.ejecutivo_id === userId); }
      else if (vista === "local") { if (!esSupervisor) return err("forbidden", 403); }
      else if (vista === "pendientes") { if (!esSupervisor) return err("forbidden", 403); filas = filas.filter((c) => c.estado === "pago_pendiente"); }
      else if (vista === "lead") {
        const lead = await cargarLead(String(body.leadId ?? ""));
        if (!lead || !puedeVer(lead)) return err("no_existe", 404);
        filas = filas.filter((c) => c.lead_id === lead.id);
      } else return err("vista_invalida");
      if (body.estado) filas = filas.filter((c) => c.estado === String(body.estado));
      return json({ compras: await enriquecerCompras(filas.slice(0, 200)), puedeAprobar: esSupervisor, puedeOperar: opera });
    }
    if (op === "compras.get") {
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c || !veCompra(c)) return err("no_existe", 404);
      return json(await compraDetalle(c));
    }

    /** Tasaciones ya completadas del vehículo del lead (por patente), para ofertar sobre ellas. */
    if (op === "compras.tasaciones") {
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      const patente = String((lead.vehiculo_ofrecido || {}).patente ?? "");
      if (!patente) return json({ tasaciones: [], pendiente: null });
      const q = await scoped(sb.from("tasaciones").select("*").eq("patente", patente).order("creado_en", { ascending: false }));
      if (q.error) return fallar(q.error);
      const todas: any[] = q.data ?? [];
      const pendiente = todas.find((t) => t.estado === "pendiente" || t.estado === "en_proceso");
      return json({
        tasaciones: todas.filter((t) => t.estado === "completada").map((t) => ({ id: t.id, folio: folioTasacion(t.numero), valor_compra: t.valor_compra, valor_venta: t.valor_venta, valor_consignacion: t.valor_consignacion, valor_retoma: t.valor_retoma, aplica_para: t.aplica_para, tipo: t.tipo, observaciones: t.observaciones, completada_en: t.completada_en })),
        pendiente: pendiente ? { id: pendiente.id, folio: folioTasacion(pendiente.numero), estado: pendiente.estado } : null,
      });
    }
    /** Qué falta para concretar la compra (datos del vendedor y documentos) y el estado de cada documento. */
    if (op === "compras.requisitos") {
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c || !veCompra(c)) return err("no_existe", 404);
      const r = await requisitosDeCompra(c);
      const cl = r.cliente;
      return json({
        aplica: r.aplica, completo: r.aplica ? r.faltantes.length === 0 : true, faltantes: r.faltantes, validacionId: r.val ? r.val.id : null, enviada: r.val ? !!r.val.enviada_en : false,
        cliente: cl ? { nombre: cl.nombre, rut: cl.rut, telefono: cl.telefono, email: cl.email, direccion: cl.direccion ?? "", comuna: cl.comuna ?? "", banco: cl.banco ?? "", tipo_cuenta: cl.tipo_cuenta ?? "", numero_cuenta: cl.numero_cuenta ?? "" } : null,
        docs: r.docs.filter((d: any) => reglaDoc(d.clave)).map((d: any) => ({ id: d.id, clave: d.clave, nombre: d.nombre, estado: d.estado, nArchivos: (d.archivos ?? []).length, vence_en: d.vence_en ?? null, precio: d.precio ?? null })),
      });
    }
    /** El ejecutivo completa los datos críticos del vendedor. */
    if (op === "compras.datosCliente") {
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c || !veCompra(c)) return err("no_existe", 404);
      if (!opera && !esSupervisor) return err("forbidden", 403);
      if (["comprada", "anulada", "rechazada"].includes(c.estado)) return err("compra_estado_invalido");
      const dc = validarDatosCliente(body.datos);
      if (!dc.ok) return err(dc.error!);
      if (!c.cliente_id) return err("no_existe", 404);
      const dup = await sb.from("clientes").select("id").eq("local_id", c.local_id).eq("rut", dc.value.rut).neq("id", c.cliente_id);
      if ((dup.data ?? []).length > 0) return err("rut_duplicado", 409);
      const up = await sb.from("clientes").update({ ...dc.value, actualizado_en: new Date().toISOString() }).eq("id", c.cliente_id).select().single();
      if (up.error) return fallar(up.error);
      await evento(c.lead_id, "cliente", `${userName} completó los datos del vendedor para la compra ${folioCompra(c.numero)}`);
      await audit(ctx.actor, "compra.datos_cliente", "compra", c.id, { numero: c.numero, cliente_id: c.cliente_id });
      return json({ ok: true });
    }
    /** Datos para la nota de compra. Solo existe cuando la compra está concretada y completa. */
    if (op === "compras.nota") {
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c || !veCompra(c)) return err("no_existe", 404);
      if (c.estado !== "comprada") return err("compra_estado_invalido");
      const r = await requisitosDeCompra(c);
      if (r.aplica && r.faltantes.length > 0) return err("compra_incompleta", 409);
      const [loc] = c.local_id ? await porIds("locales", [c.local_id]) : [null];
      const reg = (clave: string) => r.docs.find((d: any) => d.clave === clave) || {};
      return json({
        nota: {
          folio: folioCompra(c.numero), fecha: c.aprobado_en || c.actualizado_en, local: loc ? loc.nombre : "", ejecutivo: c.ejecutivo, aprobado_por: c.aprobado_por,
          monto_final: c.monto_final, medio_pago: c.medio_pago, fecha_pago: c.fecha_pago, vehiculo: c.vehiculo || {},
          vendedor: r.cliente ? { nombre: r.cliente.nombre, rut: r.cliente.rut, telefono: r.cliente.telefono, email: r.cliente.email, direccion: r.cliente.direccion, comuna: r.cliente.comuna, banco: r.cliente.banco, tipo_cuenta: r.cliente.tipo_cuenta, numero_cuenta: r.cliente.numero_cuenta } : null,
          permiso: { vence_en: reg("permiso_circulacion").vence_en ?? null, precio: reg("permiso_circulacion").precio ?? null },
          revision_tecnica: { vence_en: reg("revision_tecnica").vence_en ?? null }, soap: { vence_en: reg("soap").vence_en ?? null },
          documentos: r.aplica ? DOCS_COMPRA.map((d) => d.nombre) : [],
        },
      });
    }
    /** Pide al Tasador que tase el vehículo que ofrece el cliente. */
    if (op === "compras.pedirTasacion") {
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (!puedeTocar(lead) || lead.tipo !== "compra") return err("forbidden", 403);
      if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
      const vh = validarVehiculoOfrecido(lead.vehiculo_ofrecido);
      if (!vh.ok) return err("vehiculo_ofrecido_incompleto");
      const previas = await sb.from("tasaciones").select("id, estado").eq("patente", vh.value.patente);
      if (previas.error) return fallar(previas.error);
      if ((previas.data ?? []).some((t: any) => t.estado === "pendiente" || t.estado === "en_proceso")) return err("tasacion_en_curso", 409);
      const ins = await sb.from("tasaciones").insert({ local_id: lead.local_id, tipo: "compra", lead_id: lead.id, solicitante_id: userId, vehiculo: vh.value, patente: vh.value.patente, notas_solicitud: "Para ofertar por la compra del vehículo", creado_por: userId }).select().single();
      if (ins.error) return fallar(ins.error);
      await evento(lead.id, "tasacion", `Tasación ${folioTasacion(ins.data.numero)} pedida por ${userName} para ofertar por la compra`);
      await avanzarEtapa(lead.id, ["nuevo", "contactado", "seguimiento"], "tasacion", "se pidió la tasación");
      await audit(ctx.actor, "compra.pedir_tasacion", "tasacion", ins.data.id, { numero: ins.data.numero, patente: vh.value.patente, lead_id: lead.id });
      return json({ tasacion: { id: ins.data.id, folio: folioTasacion(ins.data.numero), estado: "pendiente" } });
    }

    if (op === "compras.ofertar") {
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (!puedeTocar(lead) || lead.tipo !== "compra") return err("forbidden", 403);
      if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
      if (!lead.asignado_a) return err("lead_sin_asignar");
      const { data: tas, error: te } = await scoped(sb.from("tasaciones").select("*").eq("id", String(body.tasacionId ?? ""))).maybeSingle();
      if (te) return fallar(te);
      const v = validarOferta(body.datos, tas, (lead.vehiculo_ofrecido || {}).patente);
      if (!v.ok) return err(v.error!);
      const abierta = await sb.from("compras").select("id, estado").eq("lead_id", lead.id);
      if (abierta.error) return fallar(abierta.error);
      if ((abierta.data ?? []).some((c: any) => COMPRA_ABIERTA.includes(c.estado))) return err("compra_en_curso", 409);
      const ins = await sb.from("compras").insert({
        ...v.value, local_id: lead.local_id, lead_id: lead.id, cliente_id: lead.cliente_id, ejecutivo_id: lead.asignado_a, tasacion_id: tas.id,
        vehiculo: tas.vehiculo || lead.vehiculo_ofrecido || {}, patente: tas.patente, valor_tasado: topeDeOferta(tas), estado: "oferta", creado_por: userName,
      }).select().single();
      if (ins.error) return ins.error.code === "23505" ? err("compra_en_curso", 409) : fallar(ins.error);
      await sb.from("leads").update({ etapa: "cotizado", actualizado_en: new Date().toISOString() }).eq("id", lead.id);
      await evento(lead.id, "compra", `Oferta ${folioCompra(ins.data.numero)} por ${dinero(v.value.monto_oferta)} (tasado en ${dinero(topeDeOferta(tas))}) hecha por ${userName}`);
      await audit(ctx.actor, "compra.ofertar", "compra", ins.data.id, { numero: ins.data.numero, monto: v.value.monto_oferta, tasado: topeDeOferta(tas), lead_id: lead.id });
      return json(await compraDetalle(ins.data));
    }

    if (op === "compras.responder") {
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c || !veCompra(c)) return err("no_existe", 404);
      const tr = validarTransicionCompra(c.estado, "responder");
      if (!tr.ok) return err(tr.error!);
      const r = validarRespuestaOferta(body);
      if (!r.ok) return err(r.error!);
      const ahora = new Date().toISOString();
      const { data, error } = await sb.from("compras").update(r.value.acepta ? { estado: "aceptada", respondida_en: ahora, actualizado_en: ahora } : { estado: "rechazada", motivo: r.value.motivo, respondida_en: ahora, actualizado_en: ahora }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      if (r.value.acepta) {
        await sb.from("leads").update({ etapa: "reservado", actualizado_en: ahora }).eq("id", c.lead_id);
        // Los documentos se revisan desde que el cliente acepta.
        const ex = await sb.from("validaciones").select("*").eq("tasacion_id", c.tasacion_id);
        const previa = (ex.error ? [] : ex.data ?? []).find((x: any) => x.tipo === "compra" && !x.compra_id && x.estado !== "cancelada");
        const yaDeLaCompra = ((await sb.from("validaciones").select("id, estado").eq("compra_id", c.id)).data ?? []).some((x: any) => x.estado !== "cancelada");
        // Si los documentos ya se empezaron a cargar al hacer la oferta, no se crea otra validación.
        if (yaDeLaCompra) { /* ya existe */ }
        else if (previa) await sb.from("validaciones").update({ compra_id: c.id, lead_id: c.lead_id }).eq("id", previa.id);
        else await crearValidacion({ tipo: "compra", local_id: c.local_id, compra_id: c.id, lead_id: c.lead_id, tasacion_id: c.tasacion_id, sujeto: sujetoDeVehiculo(c.vehiculo || {}, { folio: folioCompra(c.numero) }) });
      } else {
        await sb.from("leads").update({ etapa: "cotizado", actualizado_en: ahora }).eq("id", c.lead_id).eq("etapa", "cotizado");
      }
      await evento(c.lead_id, "compra", r.value.acepta ? `El cliente aceptó la oferta ${folioCompra(c.numero)} de ${dinero(c.monto_oferta)}` : `El cliente rechazó la oferta ${folioCompra(c.numero)}: ${r.value.motivo}`);
      await audit(ctx.actor, r.value.acepta ? "compra.aceptada" : "compra.rechazada", "compra", c.id, { numero: c.numero, motivo: r.value.motivo });
      return json(await compraDetalle(data));
    }

    // El ejecutivo pide aprobar el pago; el Jefe Local aprueba. Con Validadores en el local, hacen falta los documentos validados.
    if (op === "compras.solicitarPago") {
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c || !veCompra(c)) return err("no_existe", 404);
      const tr = validarTransicionCompra(c.estado, "solicitarPago");
      if (!tr.ok) return err(tr.error!);
      const v = validarPagoCompra(body.datos, c);
      if (!v.ok) return err(v.error!);
      const req = await requisitosDeCompra(c);
      if (req.aplica && req.faltantes.length > 0) return err("compra_incompleta", 409);
      // Los documentos se envían a validar antes de pedir el pago (cuando hay Validadores en el local).
      if (req.aplica && req.val && !req.val.enviada_en && (await hayValidadores(c.local_id))) return err("validacion_sin_enviar", 409);
      const { data, error } = await sb.from("compras").update({ ...v.value, estado: "pago_pendiente", solicitado_por: userName, motivo_rechazo_pago: null, actualizado_en: new Date().toISOString() }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await evento(c.lead_id, "compra", `Pago de ${dinero(v.value.monto_final)} (${v.value.medio_pago}) solicitado por ${userName} para ${folioCompra(c.numero)}`);
      await avanzarEtapa(c.lead_id, ["reservado"], "documentos", "se pidió aprobar el pago");
      await audit(ctx.actor, "compra.solicitar_pago", "compra", c.id, { numero: c.numero, monto: v.value.monto_final });
      if (!esSupervisor) await avisarSupervisores(c.local_id, "Pago de compra por aprobar", [`${userName} pidió aprobar el pago de ${dinero(v.value.monto_final)} (${v.value.medio_pago}) de la compra ${folioCompra(c.numero)}.`]);
      // El supervisor que registra su propia compra la aprueba, salvo que falten documentos por validar.
      if (esSupervisor) {
        const ap = await aprobarCompra(data);
        if (ap.ok) return json(await compraDetalle(ap.compra));
        if (ap.error !== "validacion_pendiente") return err(ap.error!, 409);
      }
      return json(await compraDetalle(data));
    }
    if (op === "compras.aprobar") {
      if (!esSupervisor) return err("forbidden", 403);
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      const tr = validarTransicionCompra(c.estado, "aprobar");
      if (!tr.ok) return err(tr.error!);
      const ap = await aprobarCompra(c);
      if (!ap.ok) return err(ap.error!, 409);
      await avisarEjecutivoDe(c.lead_id, "Pago de compra aprobado", `${userName} aprobó el pago de la compra ${folioCompra(c.numero)}: el vehículo ya está en el inventario.`);
      return json(await compraDetalle(ap.compra));
    }
    if (op === "compras.rechazarPago") {
      if (!esSupervisor) return err("forbidden", 403);
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      const tr = validarTransicionCompra(c.estado, "rechazarPago");
      if (!tr.ok) return err(tr.error!);
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      if (motivo.length < 3) return err("motivo_requerido");
      const { data, error } = await sb.from("compras").update({ estado: "aceptada", motivo_rechazo_pago: motivo, actualizado_en: new Date().toISOString() }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await evento(c.lead_id, "compra", `Pago de ${folioCompra(c.numero)} rechazado por ${userName}: ${motivo}`);
      await avanzarEtapa(c.lead_id, ["documentos"], "reservado", "se rechazó el pago");
      await audit(ctx.actor, "compra.rechazar_pago", "compra", c.id, { numero: c.numero, motivo });
      await avisarEjecutivoDe(c.lead_id, "Pago de compra rechazado", `${userName} rechazó el pago de la compra ${folioCompra(c.numero)}: ${motivo}`);
      return json(await compraDetalle(data));
    }
    if (op === "compras.cancelar") {
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c || !veCompra(c)) return err("no_existe", 404);
      const tr = validarTransicionCompra(c.estado, "cancelar");
      if (!tr.ok) return err(tr.error!);
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      if (motivo.length < 3) return err("motivo_requerido");
      const ahora = new Date().toISOString();
      const { data, error } = await sb.from("compras").update({ estado: "cancelada", motivo, actualizado_en: ahora }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await sb.from("validaciones").update({ estado: "cancelada", actualizado_en: ahora }).eq("compra_id", c.id).neq("estado", "aprobada");
      await sb.from("leads").update({ etapa: "contactado", actualizado_en: ahora }).eq("id", c.lead_id).in("etapa", ["cotizado", "reservado", "documentos"]);
      await evento(c.lead_id, "compra", `${folioCompra(c.numero)} cancelada por ${userName}: ${motivo}`);
      await audit(ctx.actor, "compra.cancelar", "compra", c.id, { numero: c.numero, motivo });
      return json(await compraDetalle(data));
    }
    // Revertir una compra aprobada: solo el supervisor, y solo si el vehículo aún no se usó.
    if (op === "compras.anular") {
      if (!esSupervisor) return err("forbidden", 403);
      const c = await cargarCompra(String(body.id ?? ""));
      if (!c) return err("no_existe", 404);
      const tr = validarTransicionCompra(c.estado, "anular");
      if (!tr.ok) return err(tr.error!);
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      if (motivo.length < 3) return err("motivo_requerido");
      const ahora = new Date().toISOString();
      if (c.vehiculo_id) {
        const { data: veh } = await sb.from("vehiculos").select("id, estado").eq("id", c.vehiculo_id).maybeSingle();
        const [rs, ci] = await Promise.all([sb.from("reservas").select("id").eq("vehiculo_id", c.vehiculo_id), sb.from("cierres").select("id, estado").eq("vehiculo_id", c.vehiculo_id)]);
        const enUso = !veh || !["preparacion", "disponible"].includes(veh.estado) || (rs.data ?? []).some((x: any) => x) || (ci.data ?? []).some((x: any) => x.estado === "pendiente" || x.estado === "aprobada");
        if (enUso) return err("vehiculo_en_uso", 409);
        await sb.from("vehiculos").update({ activo: false, actualizado_en: ahora }).eq("id", c.vehiculo_id);
      }
      const { data, error } = await sb.from("compras").update({ estado: "anulada", motivo, actualizado_en: ahora }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await sb.from("leads").update({ etapa: "reservado", actualizado_en: ahora }).eq("id", c.lead_id).eq("etapa", "ganado");
      await evento(c.lead_id, "compra", `Compra ${folioCompra(c.numero)} anulada por ${userName}: ${motivo}. Sale de la comisión de ${nombreMes(c.mes)} y el vehículo se archiva.`);
      await audit(ctx.actor, "compra.anular", "compra", c.id, { numero: c.numero, mes: c.mes, motivo });
      return json(await compraDetalle(data));
    }

    return err("unknown_op");
  }

  /* ---------- consignaciones (el dueño deja su vehículo para que se venda) ---------- */
  if (op.startsWith("consignaciones.")) {
    const opera = ctx.esAdmin ? false : can("consignaciones.operar") && can("leads.propios");
    const fallar = (e: any) => fallo(e);
    if (!opera && !esSupervisor) return err("forbidden", 403);

    async function cargarConsig(id: string) {
      const { data, error } = await scoped(sb.from("consignaciones").select("*").eq("id", id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    const veConsig = (c: any) => esSupervisor || (opera && c.ejecutivo_id === userId);
    const enriquecerConsig = async (filas: any[]) => {
      const [usuarios, clientes, vals] = await Promise.all([
        porIds("usuarios", filas.map((c) => c.ejecutivo_id)), porIds("clientes", filas.map((c) => c.cliente_id)),
        enLotes("validaciones", "consignacion_id", filas.map((c) => c.id)).catch(() => [] as any[]),
      ]);
      const ahora = new Date();
      return filas.map((c) => {
        const v = vals.filter((x: any) => x.consignacion_id === c.id && x.estado !== "cancelada").sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en)))[0];
        const dias = c.estado === "vigente" ? diasParaVencer(c.vence_en, ahora) : null;
        return {
          ...c, folio: folioConsignacion(c.numero), ejecutivo: (usuarios.find((u: any) => u.id === c.ejecutivo_id) || {}).nombre ?? "",
          cliente: (clientes.find((x: any) => x.id === c.cliente_id) || {}).nombre ?? "", validacion: v ? { id: v.id, folio: folioValidacion(v.numero), estado: v.estado, enviada: !!v.enviada_en } : null,
          diasRestantes: dias, vencida: dias !== null && dias < 0, margenEsperado: Number(c.precio_publicacion) - Number(c.precio_piso),
        };
      });
    };
    const consigDetalle = async (c: any) => ({ consignacion: (await enriquecerConsig([c]))[0], puedeSupervisar: esSupervisor, puedeOperar: opera });

    if (op === "consignaciones.list") {
      const vista = String(body.vista ?? "");
      const { data, error } = await scoped(sb.from("consignaciones").select("*").order("creado_en", { ascending: false }));
      if (error) return fallar(error);
      let filas: any[] = data ?? [];
      if (vista === "mias") { if (!opera) return err("forbidden", 403); filas = filas.filter((c) => c.ejecutivo_id === userId); }
      else if (vista === "local") { if (!esSupervisor) return err("forbidden", 403); }
      else if (vista === "lead") {
        const lead = await cargarLead(String(body.leadId ?? ""));
        if (!lead || !puedeVer(lead)) return err("no_existe", 404);
        filas = filas.filter((c) => c.lead_id === lead.id);
      } else return err("vista_invalida");
      if (body.estado) filas = filas.filter((c) => c.estado === String(body.estado));
      return json({ consignaciones: await enriquecerConsig(filas.slice(0, 200)), puedeSupervisar: esSupervisor, puedeOperar: opera });
    }
    if (op === "consignaciones.get") {
      const c = await cargarConsig(String(body.id ?? ""));
      if (!c || !veConsig(c)) return err("no_existe", 404);
      return json(await consigDetalle(c));
    }

    /** Qué falta para registrar el contrato: datos del dueño y los 9 documentos (y el estado de cada uno). */
    if (op === "consignaciones.requisitos") {
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (lead.tipo !== "consignacion") return err("forbidden", 403);
      const r = await requisitosDeConsignacion(lead);
      const cl = r.cliente;
      return json({
        aplica: r.aplica, completo: r.aplica ? r.faltantes.length === 0 : true, faltantes: r.faltantes, validacionId: r.val ? r.val.id : null,
        cliente: cl ? { nombre: cl.nombre, rut: cl.rut, telefono: cl.telefono, email: cl.email, direccion: cl.direccion ?? "", comuna: cl.comuna ?? "", banco: cl.banco ?? "", tipo_cuenta: cl.tipo_cuenta ?? "", numero_cuenta: cl.numero_cuenta ?? "" } : null,
        docs: r.docs.filter((d: any) => reglaDoc(d.clave)).map((d: any) => ({ id: d.id, clave: d.clave, nombre: d.nombre, estado: d.estado, nArchivos: (d.archivos ?? []).length, vence_en: d.vence_en ?? null, precio: d.precio ?? null })),
      });
    }
    /** El ejecutivo completa los datos críticos del dueño. */
    if (op === "consignaciones.datosCliente") {
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (!puedeTocar(lead) || lead.tipo !== "consignacion") return err("forbidden", 403);
      if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
      const dc = validarDatosCliente(body.datos);
      if (!dc.ok) return err(dc.error!);
      if (!lead.cliente_id) return err("no_existe", 404);
      const dup = await sb.from("clientes").select("id").eq("local_id", lead.local_id).eq("rut", dc.value.rut).neq("id", lead.cliente_id);
      if ((dup.data ?? []).length > 0) return err("rut_duplicado", 409);
      const up = await sb.from("clientes").update({ ...dc.value, actualizado_en: new Date().toISOString() }).eq("id", lead.cliente_id).select().single();
      if (up.error) return fallar(up.error);
      await evento(lead.id, "cliente", `${userName} completó los datos del dueño para la consignación`);
      await audit(ctx.actor, "consignacion.datos_cliente", "lead", lead.id, { cliente_id: lead.cliente_id });
      return json({ ok: true });
    }
    /**
     * Datos para el contrato de consignación que se firma y luego se sube como documento obligatorio. Se entrega solo con los datos del dueño
     * completos y los precios y el plazo válidos; los documentos todavía no hacen falta (el contrato es uno de ellos).
     */
    if (op === "consignaciones.contrato") {
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (!puedeTocar(lead) || lead.tipo !== "consignacion") return err("forbidden", 403);
      if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
      const cl = lead.cliente_id ? (await sb.from("clientes").select("*").eq("id", lead.cliente_id).maybeSingle()).data : null;
      if (faltantesCompra({ cliente: cl, docs: [], lista: [], persona: "dueño" }).length > 0) return err("contrato_datos_incompletos", 409);
      const v = validarConsignacion(body.datos);
      if (!v.ok) return err(v.error!);
      const [loc] = lead.local_id ? await porIds("locales", [lead.local_id]) : [null];
      const [eje] = lead.asignado_a ? await porIds("usuarios", [lead.asignado_a]) : [null];
      const fecha = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
      await evento(lead.id, "consignacion", `${userName} descargó el contrato de consignación (piso ${dinero(v.value.precio_piso)}, publicación ${dinero(v.value.precio_publicacion)}, ${v.value.plazo_dias} días)`);
      await audit(ctx.actor, "consignacion.contrato", "lead", lead.id, { piso: v.value.precio_piso, publicacion: v.value.precio_publicacion, plazo: v.value.plazo_dias });
      return json({
        contrato: {
          fecha, local: loc ? { nombre: loc.nombre, direccion: loc.direccion ?? "" } : { nombre: "", direccion: "" }, ejecutivo: eje ? eje.nombre : userName,
          dueno: { nombre: cl.nombre, rut: cl.rut, telefono: cl.telefono, email: cl.email, direccion: cl.direccion, comuna: cl.comuna, banco: cl.banco, tipo_cuenta: cl.tipo_cuenta, numero_cuenta: cl.numero_cuenta },
          vehiculo: lead.vehiculo_ofrecido || {}, precio_piso: v.value.precio_piso, precio_publicacion: v.value.precio_publicacion, plazo_dias: v.value.plazo_dias, notas: v.value.notas,
        },
      });
    }
    /**
     * Datos del comprobante de consignación. Existe con el contrato registrado (no devuelto ni cancelado) y con los datos del dueño y los
     * documentos completos; las consignaciones anteriores a esta exigencia (lista antigua de documentos) lo generan sin la lista de documentos.
     */
    if (op === "consignaciones.comprobante") {
      const c = await cargarConsig(String(body.id ?? ""));
      if (!c || !veConsig(c)) return err("no_existe", 404);
      if (!["en_validacion", "vigente", "vendida"].includes(c.estado)) return err("consignacion_estado_invalido");
      const vq = await sb.from("validaciones").select("*").eq("consignacion_id", c.id);
      const val: any = (vq.data ?? []).filter((x: any) => x.estado !== "cancelada").sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en)))[0] ?? null;
      const docs = val ? (await enLotes("validacion_docs", "validacion_id", [val.id])) : [];
      const actual = esChecklistCompraActual(docs);
      const cl = c.cliente_id ? (await sb.from("clientes").select("*").eq("id", c.cliente_id).maybeSingle()).data : null;
      if (actual && faltantesConsignacion({ cliente: cl, docs }).length > 0) return err("consignacion_incompleta", 409);
      const [loc] = c.local_id ? await porIds("locales", [c.local_id]) : [null];
      const [eje] = c.ejecutivo_id ? await porIds("usuarios", [c.ejecutivo_id]) : [null];
      const reg = (clave: string) => docs.find((d: any) => d.clave === clave) || {};
      return json({
        comprobante: {
          folio: folioConsignacion(c.numero), fecha: c.activada_en || c.creado_en, local: loc ? loc.nombre : "", ejecutivo: eje ? eje.nombre : "",
          vehiculo: c.vehiculo || {}, precio_piso: c.precio_piso, precio_publicacion: c.precio_publicacion, plazo_dias: c.plazo_dias, vence_en: c.vence_en ?? null, notas: c.notas ?? null,
          dueno: cl ? { nombre: cl.nombre, rut: cl.rut, telefono: cl.telefono, email: cl.email, direccion: cl.direccion, comuna: cl.comuna, banco: cl.banco, tipo_cuenta: cl.tipo_cuenta, numero_cuenta: cl.numero_cuenta } : null,
          permiso: { vence_en: reg("permiso_circulacion").vence_en ?? null, precio: reg("permiso_circulacion").precio ?? null },
          revision_tecnica: { vence_en: reg("revision_tecnica").vence_en ?? null }, soap: { vence_en: reg("soap").vence_en ?? null },
          documentos: actual ? DOCS_CONSIGNACION.map((d) => d.nombre) : [],
        },
      });
    }
    if (op === "consignaciones.crear") {
      const lead = await cargarLead(String(body.leadId ?? ""));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (!puedeTocar(lead) || lead.tipo !== "consignacion") return err("forbidden", 403);
      if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
      if (!lead.asignado_a) return err("lead_sin_asignar");
      const vh = validarVehiculoOfrecido(lead.vehiculo_ofrecido);
      if (!vh.ok) return err("vehiculo_ofrecido_incompleto");
      const v = validarConsignacion(body.datos);
      if (!v.ok) return err(v.error!);
      const abierta = await sb.from("consignaciones").select("id, estado").eq("lead_id", lead.id);
      if (abierta.error) return fallar(abierta.error);
      if ((abierta.data ?? []).some((c: any) => CONSIGNACION_ABIERTA.includes(c.estado))) return err("consignacion_en_curso", 409);
      const dup = await sb.from("vehiculos").select("id").eq("patente", vh.value.patente).eq("activo", true);
      if ((dup.data ?? []).length > 0) return err("patente_duplicada", 409);
      // Sin los datos del dueño (incluida su cuenta bancaria) y los 9 documentos, no se registra el contrato.
      const req = await requisitosDeConsignacion(lead);
      if (req.aplica && req.faltantes.length > 0) return err("consignacion_incompleta", 409);
      const ins = await sb.from("consignaciones").insert({
        ...v.value, local_id: lead.local_id, lead_id: lead.id, cliente_id: lead.cliente_id, ejecutivo_id: lead.asignado_a, vehiculo: vh.value, patente: vh.value.patente,
        estado: "en_validacion", creado_por: userName,
      }).select().single();
      if (ins.error) return ins.error.code === "23505" ? err("consignacion_en_curso", 409) : fallar(ins.error);
      const c = ins.data;
      await sb.from("leads").update({ etapa: "cotizado", actualizado_en: new Date().toISOString() }).eq("id", lead.id);
      await evento(lead.id, "consignacion", `Contrato de consignación ${folioConsignacion(c.numero)} registrado por ${userName}: piso ${dinero(v.value.precio_piso)}, publicación ${dinero(v.value.precio_publicacion)}, ${v.value.plazo_dias} días`);
      await audit(ctx.actor, "consignacion.crear", "consignacion", c.id, { numero: c.numero, piso: v.value.precio_piso, publicacion: v.value.precio_publicacion, lead_id: lead.id });
      // La validación de documentos ya existe (se creó al pedir los requisitos): el contrato la toma.
      let val: any = req.val && !req.val.consignacion_id ? req.val : null;
      if (val) {
        const lig = await sb.from("validaciones").update({ consignacion_id: c.id, enviada_en: new Date().toISOString(), sujeto: sujetoDeVehiculo(vh.value, { folio: folioConsignacion(c.numero) }) }).eq("id", val.id).select().single();
        val = lig.error ? val : lig.data;
      } else val = await crearValidacion({ tipo: "consignacion", local_id: c.local_id, consignacion_id: c.id, lead_id: lead.id, sujeto: sujetoDeVehiculo(vh.value, { folio: folioConsignacion(c.numero) }) });
      // Sin Validadores en el local, el vehículo entra al inventario de inmediato; si no, cuando se aprueben los documentos.
      if (!val || !(await hayValidadores(c.local_id))) {
        const act = await activarConsignacion(c);
        if (!act.ok) return err(act.error!, 409);
        return json(await consigDetalle(act.consignacion));
      }
      return json(await consigDetalle(c));
    }
    if (op === "consignaciones.cancelar") {
      const c = await cargarConsig(String(body.id ?? ""));
      if (!c || !veConsig(c)) return err("no_existe", 404);
      const tr = validarTransicionConsignacion(c.estado, "cancelar");
      if (!tr.ok) return err(tr.error!);
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      if (motivo.length < 3) return err("motivo_requerido");
      const ahora = new Date().toISOString();
      const { data, error } = await sb.from("consignaciones").update({ estado: "cancelada", motivo, actualizado_en: ahora }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await sb.from("validaciones").update({ estado: "cancelada", actualizado_en: ahora }).eq("consignacion_id", c.id).neq("estado", "aprobada");
      await sb.from("leads").update({ etapa: "contactado", actualizado_en: ahora }).eq("id", c.lead_id).eq("etapa", "cotizado");
      await evento(c.lead_id, "consignacion", `${folioConsignacion(c.numero)} cancelada por ${userName}: ${motivo}`);
      await audit(ctx.actor, "consignacion.cancelar", "consignacion", c.id, { numero: c.numero, motivo });
      return json(await consigDetalle(data));
    }
    // Devolver el vehículo al dueño: sale del inventario (solo si no está reservado ni vendido).
    if (op === "consignaciones.devolver") {
      const c = await cargarConsig(String(body.id ?? ""));
      if (!c || !veConsig(c)) return err("no_existe", 404);
      const tr = validarTransicionConsignacion(c.estado, "devolver");
      if (!tr.ok) return err(tr.error!);
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      if (motivo.length < 3) return err("motivo_requerido");
      const ahora = new Date().toISOString();
      if (c.vehiculo_id) {
        const { data: veh } = await sb.from("vehiculos").select("id, estado").eq("id", c.vehiculo_id).maybeSingle();
        if (!veh || !["preparacion", "disponible"].includes(veh.estado)) return err("vehiculo_en_uso", 409);
        await sb.from("vehiculos").update({ activo: false, actualizado_en: ahora }).eq("id", c.vehiculo_id);
      }
      const { data, error } = await sb.from("consignaciones").update({ estado: "devuelta", motivo, actualizado_en: ahora }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await evento(c.lead_id, "consignacion", `Vehículo de ${folioConsignacion(c.numero)} devuelto al dueño por ${userName}: ${motivo}`);
      await audit(ctx.actor, "consignacion.devolver", "consignacion", c.id, { numero: c.numero, motivo });
      return json(await consigDetalle(data));
    }
    if (op === "consignaciones.extender") {
      const c = await cargarConsig(String(body.id ?? ""));
      if (!c || !veConsig(c)) return err("no_existe", 404);
      const tr = validarTransicionConsignacion(c.estado, "extender");
      if (!tr.ok) return err(tr.error!);
      const d = validarExtension(body);
      if (!d.ok) return err(d.error!);
      // Si ya venció, los días corren desde hoy; si no, se suman al vencimiento actual.
      const base = diasParaVencer(c.vence_en) !== null && diasParaVencer(c.vence_en)! >= 0 ? `${String(c.vence_en).slice(0, 10)}T12:00:00Z` : new Date().toISOString();
      const vence = vencimientoConsignacion(base, d.value);
      const { data, error } = await sb.from("consignaciones").update({ vence_en: vence, plazo_dias: Number(c.plazo_dias) + d.value, actualizado_en: new Date().toISOString() }).eq("id", c.id).select().single();
      if (error) return fallar(error);
      await evento(c.lead_id, "consignacion", `Plazo de ${folioConsignacion(c.numero)} extendido ${d.value} días por ${userName}: vence el ${vence}`);
      await audit(ctx.actor, "consignacion.extender", "consignacion", c.id, { numero: c.numero, dias: d.value, vence_en: vence });
      return json(await consigDetalle(data));
    }

    return err("unknown_op");
  }

  /* ---------- clientes ---------- */
  if (op === "clientes.list") {
    const { data, error } = await scoped(sb.from("clientes").select("*").order("nombre"));
    if (error) return fallo(error);
    let lista: any[] = data ?? [];
    if (!veTodoElLocal) {
      const { data: mios } = await scoped(sb.from("leads").select("cliente_id, asignado_a"));
      const visibles = new Set((mios ?? []).filter((l: any) => l.asignado_a === userId).map((l: any) => l.cliente_id));
      lista = lista.filter((c) => visibles.has(c.id) || c.creado_por === userId);
    }
    const q = String(body.q ?? "").trim().toLowerCase();
    if (q) lista = lista.filter((c) => [c.nombre, c.rut, c.telefono, c.email].some((x) => String(x ?? "").toLowerCase().includes(q)));
    return json({ clientes: lista.slice(0, MAX_LISTA) });
  }

  if (op === "clientes.save") {
    const v = validarCliente(body.datos);
    if (!v.ok) return err(v.error!);
    const id = body.id ? String(body.id) : "";
    if (!id) {
      const local = await localParaCrear();
      if (!local) return err("sin_local");
      const { data, error } = await sb.from("clientes").insert({ ...v.value, local_id: local, creado_por: ctx.esAdmin ? null : userId }).select().single();
      if (error) return fallo(error);
      await audit(ctx.actor, "cliente.crear", "cliente", data.id, { nombre: data.nombre });
      return json({ cliente: data });
    }
    const { data: antes } = await scoped(sb.from("clientes").select("*").eq("id", id)).maybeSingle();
    if (!antes) return err("no_existe", 404);
    if (!veTodoElLocal && antes.creado_por !== userId) {
      const { data: l } = await scoped(sb.from("leads").select("asignado_a").eq("cliente_id", id));
      if (!(l ?? []).some((x: any) => x.asignado_a === userId)) return err("forbidden", 403);
    }
    const { data, error } = await sb.from("clientes").update({ ...v.value, actualizado_en: new Date().toISOString() }).eq("id", id).select().single();
    if (error) return fallo(error);
    await audit(ctx.actor, "cliente.editar", "cliente", id, { nombre: data.nombre });
    return json({ cliente: data });
  }

  /* ---------- leads ---------- */
  if (op === "leads.list") {
    const todos = body.todos === true && veTodoElLocal;
    const { data, error } = await scoped(sb.from("leads").select("*").order("creado_en", { ascending: false }));
    if (error) return fallo(error);
    const hace30 = Date.now() - 30 * 86_400_000;
    // Los perdidos quedan guardados para siempre; solo se traen todos cuando se piden (vista Lista → Perdidos).
    const conPerdidos = body.perdidos === true;
    let leads: any[] = (data ?? []).filter((l: any) => !((l.etapa === "perdido" || l.etapa === "ganado") && Date.parse(l.actualizado_en) < hace30 && !(conPerdidos && l.etapa === "perdido")));
    if (!todos) leads = leads.filter((l) => l.asignado_a === userId);
    leads = leads.slice(0, MAX_LISTA);
    const [clientes, vehiculos, usuarios, cp, ci, rs, ta] = await Promise.all([
      porIds("clientes", leads.map((l) => l.cliente_id)),
      porIds("vehiculos", leads.map((l) => l.vehiculo_id)),
      porIds("usuarios", leads.map((l) => l.asignado_a)),
      scoped(sb.from("cotizaciones").select("lead_id, estado").eq("estado", "pendiente")),
      scoped(sb.from("cierres").select("lead_id").eq("estado", "pendiente")),
      scoped(sb.from("reservas").select("lead_id, vence_en").eq("estado", "activa")),
      scoped(sb.from("tareas").select("id, lead_id, titulo, tipo, vence_en").eq("hecha", false).order("vence_en", { ascending: true })),
    ]);
    // Próxima acción de cada lead (la tarea pendiente más cercana), para las tarjetas del tablero.
    const proximas: Record<string, { id: string; titulo: string; tipo: string; vence_en: string }> = {};
    if (!ta.error) for (const t of ta.data ?? []) if (t.lead_id && !proximas[t.lead_id]) proximas[t.lead_id] = { id: t.id, titulo: t.titulo, tipo: t.tipo, vence_en: t.vence_en };
    const puedeCosto = can("inventario.editar");
    // Marcas para las tarjetas del embudo: descuento esperando aprobación y reserva en curso.
    const marcas: Record<string, { pendiente?: boolean; reserva_vence_en?: string; cierre_pendiente?: boolean }> = {};
    if (!cp.error) for (const c of cp.data ?? []) marcas[c.lead_id] = { ...marcas[c.lead_id], pendiente: true };
    if (!ci.error) for (const c of ci.data ?? []) marcas[c.lead_id] = { ...marcas[c.lead_id], cierre_pendiente: true };
    if (!rs.error) for (const r of rs.data ?? []) marcas[r.lead_id] = { ...marcas[r.lead_id], reserva_vence_en: r.vence_en };
    return json({
      leads, marcas, proximas,
      clientes: clientes.map((c: any) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, email: c.email, rut: c.rut })),
      vehiculos: vehiculos.map((v: any) => ocultarCosto({ id: v.id, patente: v.patente, marca: v.marca, modelo: v.modelo, anio: v.anio, precio_lista: v.precio_lista, costo: v.costo, fotos: (v.fotos ?? []).slice(0, 1) }, puedeCosto)),
      usuarios: usuarios.map((u: any) => ({ id: u.id, nombre: u.nombre })),
      puedeAsignar: esSupervisor, veTodo: veTodoElLocal,
    });
  }

  // Ejecutivos que pueden recibir leads en este local (para elegir a quién asignar).
  if (op === "equipo") {
    if (!esSupervisor) return err("forbidden", 403);
    const local = await localParaCrear();
    if (!local) return err("sin_local");
    return json({ equipo: await elegibles(local) });
  }

  if (op === "leads.get") {
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    // Cotizaciones y reservas del lead (si las tablas de la entrega 2B aún no existen, se omiten). Todo se pide a la vez.
    const [[cliente], [vehiculo], [asignado], ev, ta, cot, res, cie, tas, loc, camp] = await Promise.all([
      porIds("clientes", [lead.cliente_id]), porIds("vehiculos", [lead.vehiculo_id]), porIds("usuarios", [lead.asignado_a]),
      sb.from("lead_eventos").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false }).limit(100),
      sb.from("tareas").select("*").eq("lead_id", lead.id).order("vence_en"),
      sb.from("cotizaciones").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false }),
      sb.from("reservas").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false }),
      sb.from("cierres").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false }),
      sb.from("tasaciones").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false }),
      lead.local_id ? sb.from("locales").select("nombre").eq("id", lead.local_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.campania_id ? sb.from("campanias").select("id, nombre, canal").eq("id", lead.campania_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const puedeCosto = can("inventario.editar");
    const tasUsuarios = tas.error ? [] : await porIds("usuarios", (tas.data ?? []).map((t: any) => t.tasador_id));
    return json({
      campania: camp.data ?? null,
      lead, cliente: cliente ?? null, vehiculo: vehiculo ? ocultarCosto(vehiculo, can("inventario.editar")) : null,
      asignado: asignado ? { id: asignado.id, nombre: asignado.nombre } : null, eventos: ev.data ?? [], tareas: ta.data ?? [], puedeEditar: puedeTocar(lead),
      cotizaciones: cot.error ? [] : cot.data ?? [], reservas: res.error ? [] : res.data ?? [], localNombre: loc.data ? loc.data.nombre : "",
      cierres: cie.error ? [] : (cie.data ?? []).map((c: any) => sinCosto(c, puedeCosto)),
      tasaciones: tas.error ? [] : (tas.data ?? []).map(({ fotos, ...t }: any) => ({ ...t, folio: folioTasacion(t.numero), tasador: (tasUsuarios.find((u: any) => u.id === t.tasador_id) || {}).nombre ?? "", nFotos: (fotos ?? []).length })),
    });
  }

  if (op === "leads.create") {
    // El tipo de lead (venta, compra o consignación) exige la habilitación correspondiente.
    const tipoLead = ["compra", "consignacion"].includes(String(body.lead?.tipo)) ? String(body.lead.tipo) : "venta";
    if (!(can(permisoDeTipo(tipoLead)) && can("leads.propios")) && !esSupervisor) return err("forbidden", 403);
    const local = await localParaCrear();
    if (!local) return err("sin_local");

    const datosLead = validarLead(body.lead);
    if (!datosLead.ok) return err(datosLead.error!);
    let ofrecido: any = null;
    if (tipoLead !== "venta") {
      const vo = validarVehiculoOfrecido(body.lead?.vehiculoOfrecido);
      if (!vo.ok) return err(vo.error!);
      ofrecido = vo.value;
      datosLead.value.vehiculo_id = null;
    }
    if (datosLead.value.vehiculo_id) {
      const { data: v } = await sb.from("vehiculos").select("id, local_id").eq("id", datosLead.value.vehiculo_id).maybeSingle();
      if (!v || v.local_id !== local) return err("vehiculo_invalido");
    }
    const camp = await resolverCampania(body.lead?.campaniaId, local);
    if (!camp.ok) return err("campania_invalida");

    // Cliente: uno existente del mismo local, o uno nuevo (si trae RUT que ya existe, se reutiliza).
    let cliente: any = null;
    if (body.cliente?.id) {
      const { data } = await sb.from("clientes").select("*").eq("id", String(body.cliente.id)).maybeSingle();
      if (!data || data.local_id !== local) return err("cliente_invalido");
      cliente = data;
    } else {
      const c = validarCliente(body.cliente);
      if (!c.ok) return err(c.error!);
      if (c.value.rut) {
        const { data } = await sb.from("clientes").select("*").eq("local_id", local).eq("rut", c.value.rut).maybeSingle();
        cliente = data ?? null;
      }
      if (!cliente) {
        const ins = await sb.from("clientes").insert({ ...c.value, local_id: local, creado_por: ctx.esAdmin ? null : userId }).select().single();
        if (ins.error) return fallo(ins.error);
        cliente = ins.data;
        await audit(ctx.actor, "cliente.crear", "cliente", cliente.id, { nombre: cliente.nombre });
      }
    }

    // Asignación: el ejecutivo se la queda; el supervisor elige o deja el reparto rotativo.
    let asignado: { id: string; nombre: string } | null = null;
    if (!esSupervisor) {
      asignado = { id: userId, nombre: userName };
    } else if (body.asignarA && body.asignarA !== "auto") {
      const candidatos = await elegibles(local, tipoLead);
      asignado = candidatos.find((c: any) => c.id === body.asignarA) ?? null;
      if (!asignado) return err("asignado_invalido");
    } else {
      asignado = elegirAsignado(await elegibles(local, tipoLead), await ultimasAsignaciones(tipoLead));
    }

    const { data: lead, error } = await sb.from("leads").insert({
      ...datosLead.value, ...(camp.id ? { campania_id: camp.id } : {}), tipo: tipoLead, ...(ofrecido ? { vehiculo_ofrecido: ofrecido } : {}), etapa: "nuevo", local_id: local, cliente_id: cliente.id,
      asignado_a: asignado ? asignado.id : null, creado_por: ctx.esAdmin ? null : userId,
    }).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "creado", asignado ? `Lead creado y asignado a ${asignado.nombre}` : "Lead creado sin asignar (no hay ejecutivos habilitados para ventas)");
    await audit(ctx.actor, "lead.crear", "lead", lead.id, { cliente: cliente.nombre, asignado: asignado?.nombre ?? null });
    if (asignado) await avisarA([asignado.id], "Nuevo lead asignado", [`Se te asignó un lead de ${cliente.nombre}${cliente.telefono ? ` (teléfono ${cliente.telefono})` : ""}.`, `Lo creó ${userName || "el sistema"}. Contáctalo cuanto antes.`]);
    return json({ lead, cliente, asignado });
  }

  if (op === "leads.update") {
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    // Lo que el cliente declara al pedir por un canal vender o consignar su auto no se modifica: se trabaja en la tasación, los requisitos y el contrato.
    if (solicitudDeCanal(lead)) return err("lead_no_editable", 409);
    const v = validarLead(body.lead);
    if (!v.ok) return err(v.error!);
    if (v.value.vehiculo_id) {
      const { data: veh } = await sb.from("vehiculos").select("id, local_id").eq("id", v.value.vehiculo_id).maybeSingle();
      if (!veh || veh.local_id !== lead.local_id) return err("vehiculo_invalido");
    }
    // El vehículo que ofrece el cliente (compras y consignaciones).
    let ofrPatch: Record<string, unknown> = {};
    if (lead.tipo !== "venta" && body.lead && Object.prototype.hasOwnProperty.call(body.lead, "vehiculoOfrecido")) {
      const vo = validarVehiculoOfrecido(body.lead.vehiculoOfrecido);
      if (!vo.ok) return err(vo.error!);
      ofrPatch = { vehiculo_ofrecido: vo.value };
      v.value.vehiculo_id = null;
    }
    // La campaña solo se cambia si la pantalla la envía.
    let campPatch: Record<string, unknown> = {};
    if (body.lead && Object.prototype.hasOwnProperty.call(body.lead, "campaniaId")) {
      const camp = await resolverCampania(body.lead.campaniaId, lead.local_id, lead.campania_id ?? null);
      if (!camp.ok) return err("campania_invalida");
      campPatch = { campania_id: camp.id };
    }
    // El valor del vehículo en parte de pago no puede superar lo tasado, y el vínculo con la tasación se conserva.
    const tope = verificarTopeParteDePago(v.value.parte_pago, await topeDeLead(lead));
    if (!tope.ok) return err(tope.error!);
    v.value.parte_pago = fusionarParteDePago(lead.parte_pago, v.value.parte_pago);
    const { data, error } = await sb.from("leads").update({ ...v.value, ...campPatch, ...ofrPatch, actualizado_en: new Date().toISOString() }).eq("id", lead.id).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "nota", "Se actualizaron los datos del lead");
    return json({ lead: data });
  }

  /**
   * El ejecutivo elige con qué oferta sigue un lead de compra o consignación (por ejemplo, uno que entró por el sitio web): la oferta elegida
   * fija el tipo del lead. Exige la tasación completada y que el Tasador haya dejado el vehículo aplicable a esa operación. Una vez hecha la oferta
   * (compra o contrato) ya no se cambia a la otra mientras siga en curso.
   */
  if (op === "leads.elegirOperacion") {
    const lead = await cargarLead(String(body.leadId ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead) || !["compra", "consignacion"].includes(lead.tipo)) return err("forbidden", 403);
    const oper = String(body.operacion ?? "");
    if (!["compra", "consignacion"].includes(oper)) return err("operacion_invalida");
    if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
    const patente = String((lead.vehiculo_ofrecido || {}).patente ?? "");
    const tq = patente ? await scoped(sb.from("tasaciones").select("*").eq("patente", patente).eq("estado", "completada").order("completada_en", { ascending: false })) : { data: [], error: null };
    if (tq.error) return fallo(tq.error);
    const tas = (tq.data ?? []).find((t: any) => t.tipo !== "parte_pago");
    if (!tas) return err("tasacion_pendiente", 409);
    const ap = tas.aplica_para;
    const aplica = ap === oper || ap === "ambas" || (!ap && oper === "compra");
    if (!aplica) return err("tasacion_no_aplica_operacion", 409);
    const [cs, ns] = await Promise.all([sb.from("compras").select("estado").eq("lead_id", lead.id), sb.from("consignaciones").select("estado").eq("lead_id", lead.id)]);
    if ((cs.data ?? []).some((c: any) => COMPRA_ABIERTA.includes(c.estado)) || (ns.data ?? []).some((c: any) => CONSIGNACION_ABIERTA.includes(c.estado))) return err("operacion_en_curso", 409);
    if (lead.tipo === oper) return json({ ok: true, cambio: false, tipo: oper });
    // Quien no supervisa solo puede seguir con una operación para la que está habilitado; el Jefe Local puede pasarla y reasignar.
    if (!esSupervisor && !can(permisoDeTipo(oper))) return err("operacion_no_habilitada", 403);
    const r = await cambiarTipoLead(lead, oper, "porque se eligió hacer esa oferta", { por_oferta: true });
    if (!r.ok) return err("server_error", 500);
    if (r.cambio && r.asignadoId) await avisarA([r.asignadoId], "Lead reasignado", [`Se te asignó un lead de ${oper === "compra" ? "compra" : "consignación"} que ${userName} pasó a esa operación.`]);
    return json({ ok: true, cambio: true, tipo: oper, reasignado: r.cambio });
  }

  if (op === "leads.mover") {
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    const r = validarCambioEtapa({ desde: lead.etapa, hacia: String(body.etapa ?? ""), motivo: body.motivo, puedeReabrir: esSupervisor });
    if (!r.ok) return err(r.error!);
    if (lead.tipo !== "venta" && r.value.etapa === "perdido") {
      const [cp, cs] = await Promise.all([sb.from("compras").select("estado").eq("lead_id", lead.id), sb.from("consignaciones").select("estado").eq("lead_id", lead.id)]);
      if ((cp.data ?? []).some((x: any) => COMPRA_ABIERTA.includes(x.estado)) || (cs.data ?? []).some((x: any) => CONSIGNACION_ABIERTA.includes(x.estado))) return err("operacion_en_curso");
    }
    // Con una reserva activa solo se puede perder el lead (y eso cancela la reserva); no moverlo a otra etapa.
    const reservaActiva = await reservaActivaDeLead(lead.id);
    if (reservaActiva && r.value.etapa !== "perdido") return err("reserva_activa");
    const { data, error } = await sb.from("leads").update({ ...r.value, actualizado_en: new Date().toISOString() }).eq("id", lead.id).select().single();
    if (error) return fallo(error);
    if (reservaActiva) await cerrarReserva(reservaActiva, "cancelada", "El lead se marcó como perdido", { volverACotizado: false });
    await evento(lead.id, "etapa", `${etapaNombre(lead.etapa)} → ${etapaNombre(r.value.etapa)}${r.value.motivo_perdida ? ` (${r.value.motivo_perdida})` : ""}`);
    await audit(ctx.actor, "lead.mover", "lead", lead.id, { de: lead.etapa, a: r.value.etapa, motivo: r.value.motivo_perdida });
    return json({ lead: data, pedirProximaAccion: await pedirProximaAccion(lead.id) });
  }

  if (op === "leads.reasignar") {
    if (!esSupervisor) return err("forbidden", 403);
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead) return err("no_existe", 404);
    const candidatos = await elegibles(lead.local_id, lead.tipo || "venta");
    let nuevo: { id: string; nombre: string } | null;
    if (body.asignarA && body.asignarA !== "auto") {
      nuevo = candidatos.find((c: any) => c.id === body.asignarA) ?? null;
      if (!nuevo) return err("asignado_invalido");
    } else {
      nuevo = elegirAsignado(candidatos.filter((c: any) => c.id !== lead.asignado_a), await ultimasAsignaciones(lead.tipo || "venta")) ?? null;
      if (!nuevo) return err("sin_candidatos");
    }
    const { data, error } = await sb.from("leads").update({ asignado_a: nuevo.id, actualizado_en: new Date().toISOString() }).eq("id", lead.id).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "asignacion", `Reasignado a ${nuevo.nombre}`);
    await audit(ctx.actor, "lead.reasignar", "lead", lead.id, { de: lead.asignado_a, a: nuevo.id, nombre: nuevo.nombre });
    { const rl = await resumenDeLead(lead.id); await avisarA([nuevo.id], "Nuevo lead asignado", [`${userName || "El Jefe Local"} te reasignó el lead de ${rl ? rl.cliente : "un cliente"}.`, "Contáctalo cuanto antes."]); }
    return json({ lead: data, asignado: nuevo });
  }

  if (op === "leads.nota") {
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    const tipo = String(body.tipo ?? "nota");
    if (!TIPOS_CONTACTO.some((t) => t.id === tipo)) return err("tipo_invalido");
    const detalle = String(body.detalle ?? "").trim().slice(0, 500);
    if (tipo === "nota" && !detalle) return err("detalle_requerido");
    await evento(lead.id, tipo, detalle || (TIPOS_CONTACTO.find((t) => t.id === tipo)?.nombre ?? tipo));
    const patch: Record<string, unknown> = { actualizado_en: new Date().toISOString() };
    if (tipo !== "nota") {
      patch.ultimo_contacto = new Date().toISOString();
      // El primer contacto saca al lead de "Nuevo".
      if (lead.etapa === "nuevo") { patch.etapa = "contactado"; await evento(lead.id, "etapa", "Nuevo → Contactado (primer contacto)"); }
    }
    const { data, error } = await sb.from("leads").update(patch).eq("id", lead.id).select().single();
    if (error) return fallo(error);
    return json({ lead: data, pedirProximaAccion: await pedirProximaAccion(lead.id) });
  }

  // «Hoy»: los leads abiertos ordenados por qué hay que hacer primero (primer contacto, acciones vencidas, de hoy, sin próxima acción…).
  if (op === "leads.hoy") {
    if (!(can("leads.propios") || veTodoElLocal)) return err("forbidden", 403);
    const todos = body.todos === true && veTodoElLocal;
    const cfg = await configNegocio();
    const ahora = new Date();
    const { data, error } = await scoped(sb.from("leads").select("*").order("creado_en", { ascending: true }));
    if (error) return fallo(error);
    let abiertos: any[] = (data ?? []).filter((l: any) => !ETAPAS_CERRADAS.includes(l.etapa));
    if (!todos) abiertos = abiertos.filter((l) => l.asignado_a === userId);
    abiertos = abiertos.slice(0, MAX_LISTA);
    const ids = abiertos.map((l) => l.id);
    const [tareasTodas, clientes, vehiculos, usuarios] = await Promise.all([
      enLotes("tareas", "lead_id", ids), porIds("clientes", abiertos.map((l) => l.cliente_id)), porIds("vehiculos", abiertos.map((l) => l.vehiculo_id)), porIds("usuarios", abiertos.map((l) => l.asignado_a)),
    ]);
    const pendientes = new Map<string, any[]>();
    for (const t of tareasTodas) if (!t.hecha) pendientes.set(t.lead_id, [...(pendientes.get(t.lead_id) ?? []), t]);
    const cli = new Map(clientes.map((c: any) => [c.id, c]));
    const veh = new Map(vehiculos.map((v: any) => [v.id, v]));
    const usr = new Map(usuarios.map((u: any) => [u.id, u]));
    const items = abiertos.map((lead) => ({ lead, hoy: clasificarLeadHoy({ lead, tareas: pendientes.get(lead.id) ?? [], ahora, horasPrimerContacto: cfg.horas_primer_contacto, horasJefe: cfg.horas_sin_contacto, diasDetenido: cfg.dias_detenido }) })).filter((x) => x.hoy);
    const ordenados = ordenarHoy(items as any);
    const texto = (l: any) => {
      const v: any = l.vehiculo_id ? veh.get(l.vehiculo_id) : null;
      if (v) return `${v.marca} ${v.modelo} ${v.anio}`;
      const o = l.vehiculo_ofrecido || {};
      if (l.tipo && l.tipo !== "venta" && o.marca) return `${o.marca} ${o.modelo || ""} ${o.anio || ""}`.trim();
      return l.vehiculo_interes || "";
    };
    const resumen: Record<string, number> = Object.fromEntries(GRUPOS_HOY.map((g) => [g.id, 0]));
    const leads = ordenados.map(({ lead, hoy }: any) => {
      resumen[hoy.grupo]++;
      const c: any = cli.get(lead.cliente_id);
      const u: any = usr.get(lead.asignado_a);
      return {
        id: lead.id, grupo: hoy.grupo, nivelJefe: hoy.nivelJefe, estancado: hoy.estancado, edadHoras: hoy.edadHoras, etapa: lead.etapa, tipo: lead.tipo || "venta", fuente: lead.fuente || "",
        creado_en: lead.creado_en, ultimo_contacto: lead.ultimo_contacto || null, vehiculo: texto(lead),
        cliente: c ? { id: c.id, nombre: c.nombre, telefono: c.telefono || null } : { id: null, nombre: "Cliente", telefono: null },
        asignado: u ? { id: u.id, nombre: u.nombre } : null,
        proxima: hoy.proxima ? { id: hoy.proxima.id, titulo: hoy.proxima.titulo, tipo: hoy.proxima.tipo, vence_en: hoy.proxima.vence_en } : null,
      };
    });
    return json({ leads, resumen, total: leads.length, puedeAsignar: esSupervisor, veTodo: veTodoElLocal, plazos: { primerContacto: cfg.horas_primer_contacto, jefe: cfg.horas_sin_contacto } });
  }

  /* ---------- tareas ---------- */
  if (op === "tareas.list") {
    if (!can("agenda.usar") && !esSupervisor) return err("forbidden", 403);
    const todas = body.todas === true && veTodoElLocal;
    const { data, error } = await scoped(sb.from("tareas").select("*").eq("hecha", false).order("vence_en"));
    if (error) return fallo(error);
    const tareas = (data ?? []).filter((t: any) => todas || t.asignado_a === userId).slice(0, MAX_LISTA);
    const leads = await porIds("leads", tareas.map((t: any) => t.lead_id));
    const clientes = await porIds("clientes", leads.map((l: any) => l.cliente_id));
    const nombreCliente = new Map(clientes.map((c: any) => [c.id, c.nombre]));
    const info: Record<string, unknown> = {};
    for (const l of leads) info[l.id] = { cliente: nombreCliente.get(l.cliente_id) ?? "", etapa: l.etapa };
    return json({ tareas, leads: info });
  }

  if (op === "tareas.create") {
    if (!can("agenda.usar") && !esSupervisor) return err("forbidden", 403);
    const v = validarTarea({ titulo: body.titulo, tipo: body.tipo, venceEn: body.venceEn });
    if (!v.ok) return err(v.error!);
    let lead: any = null;
    if (body.leadId) {
      lead = await cargarLead(String(body.leadId));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      if (!puedeTocar(lead)) return err("forbidden", 403);
    }
    const local = lead?.local_id ?? (await localParaCrear());
    if (!local) return err("sin_local");
    const asignado = ctx.esAdmin ? (lead?.asignado_a ?? null) : (esSupervisor && lead?.asignado_a ? lead.asignado_a : userId);
    const { data, error } = await sb.from("tareas").insert({
      ...v.value, lead_id: lead ? lead.id : null, local_id: local, asignado_a: asignado, creado_por: ctx.esAdmin ? null : userId,
    }).select().single();
    if (error) return fallo(error);
    if (lead) await evento(lead.id, "nota", `Tarea agendada: ${v.value.titulo}`);
    return json({ tarea: data });
  }

  if (op === "tareas.hecha") {
    const { data: t } = await scoped(sb.from("tareas").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
    if (!t) return err("no_existe", 404);
    if (!esSupervisor && t.asignado_a !== userId) return err("forbidden", 403);
    const hecha = body.hecha !== false;
    const { data, error } = await sb.from("tareas").update({ hecha, hecha_en: hecha ? new Date().toISOString() : null }).eq("id", t.id).select().single();
    if (error) return fallo(error);
    if (hecha && t.lead_id) await evento(t.lead_id, "nota", `Tarea cumplida: ${t.titulo}`);
    return json({ tarea: data, pedirProximaAccion: hecha && t.lead_id ? await pedirProximaAccion(t.lead_id) : false });
  }

  /* ---------- cotizaciones ---------- */
  async function cargarCotizacion(id: string) {
    const { data, error } = await scoped(sb.from("cotizaciones").select("*").eq("id", id)).maybeSingle();
    if (error) throw error;
    return data;
  }
  const snapshotVehiculo = (v: any) => ({
    patente: v.patente, marca: v.marca, modelo: v.modelo, version: v.version, anio: v.anio, km: v.km, color: v.color,
    transmision: v.transmision, combustible: v.combustible, fotos: (v.fotos ?? []).slice(0, 2), vehiculo_id: v.id,
  });

  if (op === "cotizaciones.list") {
    const lead = await cargarLead(String(body.leadId ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    const { data, error } = await sb.from("cotizaciones").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false });
    if (error) return fallo(error);
    return json({ cotizaciones: data ?? [] });
  }

  if (op === "cotizaciones.save") {
    const lead = await cargarLead(String(body.leadId ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");

    const id = body.id ? String(body.id) : "";
    let previa: any = null;
    if (id) {
      const { data } = await sb.from("cotizaciones").select("*").eq("id", id).eq("lead_id", lead.id).maybeSingle();
      if (!data) return err("no_existe", 404);
      if (["reservada", "vendida", "anulada"].includes(data.estado)) return err("cotizacion_cerrada");
      previa = data;
    }
    const { data: veh } = await sb.from("vehiculos").select("*").eq("id", String(body.vehiculoId || previa?.vehiculo_id || "")).maybeSingle();
    if (!veh || !veh.activo || veh.local_id !== lead.local_id) return err("vehiculo_invalido");
    if (veh.estado !== "disponible" && !(previa && previa.vehiculo_id === veh.id)) return err("vehiculo_no_disponible");

    // El precio de lista es siempre el actual del inventario; si cambió y hay descuento, se vuelve a pedir aprobación.
    const v = validarCotizacion(body.datos, veh.precio_lista);
    if (!v.ok) return err(v.error!);
    const pisoCot = verificarPisoConsignado(veh, v.value.precio_final);
    if (!pisoCot.ok) return err(pisoCot.error!);
    // El vehículo en parte de pago no se puede valorar por sobre lo tasado.
    const tope = verificarTopeParteDePago(v.value.parte_pago, await topeDeLead(lead));
    if (!tope.ok) return err(tope.error!);

    let cfg;
    try { cfg = await configNegocio(); } catch (e) { return fallo(e); }
    const ahora = new Date();
    const estado = previa
      ? (requiereNuevaAprobacion(previa, v.value) && !esSupervisor ? "pendiente" : "vigente")
      : estadoCotizacionInicial({ descuento: v.value.descuento, puedeAprobar: esSupervisor });
    // Quién aprobó: el supervisor que cotiza con descuento se aprueba a sí mismo (queda registrado); si no cambió, se conserva.
    let aprobado: Record<string, unknown> = { aprobado_por: null, aprobado_en: null, motivo_rechazo: null };
    if (estado === "vigente" && v.value.descuento > 0) {
      const conserva = previa && previa.aprobado_por && !requiereNuevaAprobacion(previa, v.value);
      aprobado = conserva
        ? { aprobado_por: previa.aprobado_por, aprobado_en: previa.aprobado_en, motivo_rechazo: null }
        : { aprobado_por: userName, aprobado_en: ahora.toISOString(), motivo_rechazo: null };
    }
    const fila = {
      ...v.value, estado, ...aprobado, vehiculo_id: veh.id, vehiculo_snapshot: snapshotVehiculo(veh), cliente_id: lead.cliente_id,
      vigencia_hasta: new Date(ahora.getTime() + cfg.vigencia_cotizacion_dias * 86_400_000).toISOString(),
      solicitado_por: v.value.descuento > 0 ? (previa?.solicitado_por ?? userName) : null, actualizado_en: ahora.toISOString(),
    };

    let cot: any;
    if (previa) {
      const r = await sb.from("cotizaciones").update(fila).eq("id", previa.id).select().single();
      if (r.error) return fallo(r.error);
      cot = r.data;
      await evento(lead.id, "cotizacion", `Cotización N° ${cot.numero} editada · ${dinero(cot.precio_final)}${estado === "pendiente" ? " · descuento esperando aprobación" : ""}`);
    } else {
      const r = await sb.from("cotizaciones").insert({ ...fila, local_id: lead.local_id, lead_id: lead.id, creado_por: userId }).select().single();
      if (r.error) return fallo(r.error);
      cot = r.data;
      await evento(lead.id, "cotizacion", `Cotización N° ${cot.numero} · ${veh.marca} ${veh.modelo} · ${dinero(cot.precio_final)}${estado === "pendiente" ? ` · descuento de ${dinero(cot.descuento)} esperando aprobación` : ""}`);
      if (["nuevo", "contactado", "seguimiento"].includes(lead.etapa)) {
        await sb.from("leads").update({ etapa: "cotizado", actualizado_en: ahora.toISOString() }).eq("id", lead.id);
        await evento(lead.id, "etapa", `${etapaNombre(lead.etapa)} → Cotizado (se cotizó un vehículo)`);
      }
    }
    await audit(ctx.actor, previa ? "cotizacion.editar" : "cotizacion.crear", "cotizacion", cot.id, {
      numero: cot.numero, patente: veh.patente, precio_lista: cot.precio_lista, descuento: cot.descuento, estado: cot.estado,
    });
    if (estado === "pendiente") await avisarSupervisores(lead.local_id, "Descuento por aprobar", [`${userName} pidió un descuento de ${dinero(cot.descuento)} en la cotización N° ${cot.numero} (${veh.marca} ${veh.modelo}, precio final ${dinero(cot.precio_final)}).`]);
    return json({ cotizacion: cot });
  }

  if (op === "cotizaciones.anular") {
    const cot = await cargarCotizacion(String(body.id ?? ""));
    if (!cot) return err("no_existe", 404);
    const lead = await cargarLead(cot.lead_id);
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    if (cot.estado === "reservada") return err("tiene_reserva");
    if (cot.estado === "anulada" || cot.estado === "vendida") return err("cotizacion_cerrada");
    const { data, error } = await sb.from("cotizaciones").update({ estado: "anulada", actualizado_en: new Date().toISOString() }).eq("id", cot.id).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "cotizacion", `Cotización N° ${cot.numero} anulada`);
    await audit(ctx.actor, "cotizacion.anular", "cotizacion", cot.id, { numero: cot.numero });
    return json({ cotizacion: data });
  }

  // Bandeja del supervisor: descuentos esperando su aprobación, con el margen que quedaría.
  if (op === "cotizaciones.pendientes") {
    if (!esSupervisor) return err("forbidden", 403);
    const { data, error } = await scoped(sb.from("cotizaciones").select("*").eq("estado", "pendiente").order("creado_en"));
    if (error) return fallo(error);
    const lista: any[] = data ?? [];
    const clientes = await porIds("clientes", lista.map((c) => c.cliente_id));
    const vehiculos = await porIds("vehiculos", lista.map((c) => c.vehiculo_id));
    const leads = await porIds("leads", lista.map((c) => c.lead_id));
    const usuarios = await porIds("usuarios", leads.map((l: any) => l.asignado_a));
    const puedeCosto = can("inventario.editar");
    return json({
      pendientes: lista.map((c) => {
        const veh = vehiculos.find((x: any) => x.id === c.vehiculo_id);
        const lead = leads.find((x: any) => x.id === c.lead_id);
        const costo = puedeCosto && veh && veh.costo != null ? Number(veh.costo) : null;
        return {
          ...c,
          cliente: (clientes.find((x: any) => x.id === c.cliente_id) || {}).nombre ?? "",
          ejecutivo: (usuarios.find((x: any) => x.id === lead?.asignado_a) || {}).nombre ?? "",
          margen_lista: costo === null ? null : Number(c.precio_lista) - costo,
          margen_final: costo === null ? null : Number(c.precio_final) - costo,
        };
      }),
    });
  }

  if (op === "cotizaciones.aprobar" || op === "cotizaciones.rechazar") {
    if (!esSupervisor) return err("forbidden", 403);
    const cot = await cargarCotizacion(String(body.id ?? ""));
    if (!cot) return err("no_existe", 404);
    if (cot.estado !== "pendiente") return err("sin_cambio");
    const aprobar = op === "cotizaciones.aprobar";
    const motivo = String(body.motivo ?? "").trim().slice(0, 200);
    if (!aprobar && motivo.length < 3) return err("motivo_requerido");
    const ahora = new Date().toISOString();
    const patch = aprobar
      ? { estado: "vigente", aprobado_por: userName, aprobado_en: ahora, motivo_rechazo: null, actualizado_en: ahora }
      : { estado: "rechazada", motivo_rechazo: motivo, actualizado_en: ahora };
    const { data, error } = await sb.from("cotizaciones").update(patch).eq("id", cot.id).select().single();
    if (error) return fallo(error);
    await evento(cot.lead_id, "cotizacion", aprobar
      ? `Descuento de ${dinero(cot.descuento)} aprobado por ${userName} (cotización N° ${cot.numero})`
      : `Descuento de ${dinero(cot.descuento)} rechazado por ${userName}: ${motivo} (cotización N° ${cot.numero})`);
    await audit(ctx.actor, aprobar ? "cotizacion.aprobar" : "cotizacion.rechazar", "cotizacion", cot.id, {
      numero: cot.numero, descuento: cot.descuento, precio_final: cot.precio_final, solicitado_por: cot.solicitado_por, motivo: motivo || null,
    });
    await avisarEjecutivoDe(cot.lead_id, aprobar ? "Descuento aprobado" : "Descuento rechazado", aprobar ? `${userName} aprobó el descuento de ${dinero(cot.descuento)} (cotización N° ${cot.numero}).` : `${userName} rechazó el descuento de ${dinero(cot.descuento)} (cotización N° ${cot.numero}): ${motivo}`);
    return json({ cotizacion: data });
  }

  /* ---------- reservas ---------- */
  if (op === "reservas.list") {
    if (body.leadId) {
      const lead = await cargarLead(String(body.leadId));
      if (!lead || !puedeVer(lead)) return err("no_existe", 404);
      const { data, error } = await sb.from("reservas").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false });
      if (error) return fallo(error);
      return json({ reservas: data ?? [] });
    }
    // Reservas activas visibles para esta persona (las suyas, o las de todo el local si supervisa).
    const { data, error } = await scoped(sb.from("reservas").select("*").eq("estado", "activa").order("vence_en"));
    if (error) return fallo(error);
    let lista: any[] = data ?? [];
    const [leads, vehiculos, clientes] = await Promise.all([
      porIds("leads", lista.map((r) => r.lead_id)), porIds("vehiculos", lista.map((r) => r.vehiculo_id)), porIds("clientes", lista.map((r) => r.cliente_id)),
    ]);
    if (!veTodoElLocal) lista = lista.filter((r) => (leads.find((l: any) => l.id === r.lead_id) || {}).asignado_a === userId);
    return json({
      reservas: lista.map((r) => {
        const veh = vehiculos.find((x: any) => x.id === r.vehiculo_id) || {};
        return { ...r, vehiculo: veh.marca ? `${veh.marca} ${veh.modelo} ${veh.anio} · ${veh.patente}` : "", cliente: (clientes.find((x: any) => x.id === r.cliente_id) || {}).nombre ?? "" };
      }),
    });
  }

  if (op === "reservas.crear") {
    const cot = await cargarCotizacion(String(body.cotizacionId ?? ""));
    if (!cot) return err("no_existe", 404);
    const lead = await cargarLead(cot.lead_id);
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    if (ETAPAS_CERRADAS.includes(lead.etapa)) return err("lead_cerrado");
    if (cot.estado === "pendiente") return err("cotizacion_pendiente");
    if (cot.estado === "reservada") return err("ya_reservada");
    if (cot.estado !== "vigente") return err("cotizacion_no_vigente");
    if (cot.vigencia_hasta && Date.parse(cot.vigencia_hasta) < Date.now()) return err("cotizacion_vencida");
    const { data: veh } = await sb.from("vehiculos").select("*").eq("id", cot.vehiculo_id).maybeSingle();
    if (!veh || !veh.activo || veh.local_id !== lead.local_id) return err("vehiculo_invalido");
    if (veh.estado !== "disponible") return err("vehiculo_no_disponible", 409);

    let cfg;
    try { cfg = await configNegocio(); } catch (e) { return fallo(e); }
    const v = validarReserva(body, { precioFinal: Number(cot.precio_final), diasDefecto: cfg.dias_reserva });
    if (!v.ok) return err(v.error!);
    const vence = new Date(Date.now() + v.value.dias * 86_400_000).toISOString();

    // La base impide dos reservas activas del mismo vehículo; si alguien se adelantó, falla aquí.
    const ins = await sb.from("reservas").insert({
      local_id: lead.local_id, lead_id: lead.id, cotizacion_id: cot.id, vehiculo_id: veh.id, cliente_id: lead.cliente_id,
      monto: v.value.monto, medio_pago: v.value.medio_pago, notas: v.value.notas, vence_en: vence, creado_por: userId,
    }).select().single();
    if (ins.error) return ins.error.code === "23505" ? err("vehiculo_no_disponible", 409) : fallo(ins.error);
    const reserva = ins.data;
    try {
      const ahora = new Date().toISOString();
      const a = await sb.from("vehiculos").update({ estado: "reservado", actualizado_en: ahora }).eq("id", veh.id).eq("estado", "disponible");
      if (a.error) throw a.error;
      const b = await sb.from("cotizaciones").update({ estado: "reservada", actualizado_en: ahora }).eq("id", cot.id);
      if (b.error) throw b.error;
      const c = await sb.from("leads").update({ etapa: "reservado", actualizado_en: ahora }).eq("id", lead.id);
      if (c.error) throw c.error;
    } catch (e) {
      // Si algo falla a medias, se deshace para no dejar el vehículo bloqueado.
      await sb.from("reservas").delete().eq("id", reserva.id);
      await sb.from("vehiculos").update({ estado: "disponible" }).eq("id", veh.id).eq("estado", "reservado");
      throw e;
    }
    await evento(lead.id, "reserva", `Reserva de ${veh.marca} ${veh.modelo} (${veh.patente}) por ${dinero(v.value.monto)} hasta el ${fechaCL(vence)}`);
    if (lead.etapa !== "reservado") await evento(lead.id, "etapa", `${etapaNombre(lead.etapa)} → Reservado`);
    await audit(ctx.actor, "reserva.crear", "reserva", reserva.id, { patente: veh.patente, monto: v.value.monto, vence_en: vence, cotizacion: cot.numero });
    return json({ reserva });
  }

  if (op === "reservas.cancelar" || op === "reservas.extender") {
    const { data: r } = await scoped(sb.from("reservas").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
    if (!r) return err("no_existe", 404);
    const lead = await cargarLead(r.lead_id);
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    if (r.estado !== "activa") return err("reserva_cerrada");
    if (op === "reservas.cancelar") {
      await cerrarReserva(r, "cancelada", String(body.motivo ?? "").trim().slice(0, 150) || "Cancelada", { volverACotizado: true });
      return json({ ok: true });
    }
    const dias = Number(body.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 7) return err("dias_invalidos");
    const base = Math.max(Date.now(), Date.parse(r.vence_en));
    const vence = new Date(base + dias * 86_400_000).toISOString();
    const { data, error } = await sb.from("reservas").update({ vence_en: vence }).eq("id", r.id).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "reserva", `Reserva extendida ${dias} día(s): vence el ${fechaCL(vence)}`);
    await audit(ctx.actor, "reserva.extender", "reserva", r.id, { dias, vence_en: vence });
    return json({ reserva: data });
  }

  /* ---------- cierre de venta ---------- */
  async function cargarCierre(id: string) {
    const { data, error } = await scoped(sb.from("cierres").select("*").eq("id", id)).maybeSingle();
    if (error) throw error;
    return data;
  }
  const folioVenta = (n: number) => `VTA-${String(n || 0).padStart(6, "0")}`;

  /** Efectos de aprobar una venta: el vehículo queda vendido, la reserva convertida, la cotización vendida y el lead ganado. */
  async function aprobarCierre(c: any) {
    const ahora = new Date().toISOString();
    const mes = mesChile(ahora);
    const { data, error } = await sb.from("cierres").update({
      estado: "aprobada", mes, aprobado_por: userName, aprobado_en: ahora, motivo_rechazo: null, actualizado_en: ahora,
    }).eq("id", c.id).select().single();
    if (error) throw error;
    await sb.from("vehiculos").update({ estado: "vendido", actualizado_en: ahora }).eq("id", c.vehiculo_id);
    // Un vehículo consignado vendido paga comisión al ejecutivo de la consignación: el margen es lo que queda sobre el piso.
    const cons = await sb.from("consignaciones").select("*").eq("vehiculo_id", c.vehiculo_id).eq("estado", "vigente").maybeSingle();
    if (!cons.error && cons.data) {
      await sb.from("consignaciones").update({ estado: "vendida", cierre_id: c.id, precio_venta: c.precio_final, margen: Number(c.precio_final) - Number(cons.data.precio_piso), mes, vendida_en: ahora, actualizado_en: ahora }).eq("id", cons.data.id);
      await evento(c.lead_id, "consignacion", `Vehículo consignado (${folioConsignacion(cons.data.numero)}) vendido en ${dinero(c.precio_final)}: margen ${dinero(Number(c.precio_final) - Number(cons.data.precio_piso))} sobre el piso.`);
    }
    if (c.reserva_id) await sb.from("reservas").update({ estado: "convertida", motivo: "Venta cerrada", cerrado_en: ahora }).eq("id", c.reserva_id).eq("estado", "activa");
    if (c.cotizacion_id) await sb.from("cotizaciones").update({ estado: "vendida", actualizado_en: ahora }).eq("id", c.cotizacion_id);
    await sb.from("leads").update({ etapa: "ganado", actualizado_en: ahora }).eq("id", c.lead_id);
    await evento(c.lead_id, "cierre", `Venta ${folioVenta(c.numero)} aprobada por ${userName} · ${dinero(c.precio_final)}. Cuenta para la comisión de ${nombreMes(mes)}.`);
    await evento(c.lead_id, "etapa", "Reservado → Cerrado ganado");
    await audit(ctx.actor, "venta.aprobar", "cierre", c.id, { numero: c.numero, precio_final: c.precio_final, mes, ejecutivo_id: c.ejecutivo_id, solicitado_por: c.solicitado_por });
    return data;
  }

  if (op === "cierres.crear") {
    const lead = await cargarLead(String(body.leadId ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    if (lead.etapa !== "reservado") return err("lead_no_reservado");
    if (!lead.asignado_a) return err("lead_sin_asignar");
    const reserva = await reservaActivaDeLead(lead.id);
    if (!reserva) return err("sin_reserva");
    const { data: veh } = await sb.from("vehiculos").select("*").eq("id", reserva.vehiculo_id).maybeSingle();
    if (!veh || veh.estado !== "reservado") return err("vehiculo_no_disponible", 409);
    const { data: cot } = reserva.cotizacion_id ? await sb.from("cotizaciones").select("*").eq("id", reserva.cotizacion_id).maybeSingle() : { data: null };
    if (!cot || cot.estado !== "reservada") return err("cotizacion_no_vigente");
    const vigente = await sb.from("cierres").select("id, estado").eq("vehiculo_id", veh.id);
    if (vigente.error) return fallo(vigente.error);
    if ((vigente.data ?? []).some((x: any) => x.estado === "pendiente" || x.estado === "aprobada")) return err("cierre_en_curso", 409);

    const v = validarCierre(body.datos);
    if (!v.ok) return err(v.error!);
    const pisoCierre = verificarPisoConsignado(veh, v.value.precio_final);
    if (!pisoCierre.ok) return err(pisoCierre.error!);
    // Lo que se recibe por el vehículo en parte de pago no puede superar lo tasado.
    const tope = verificarTopeParteDePago({ tiene: v.value.monto_parte_pago > 0, valor: v.value.monto_parte_pago }, await topeDeLead(lead));
    if (!tope.ok) return err(tope.error!);
    const costo = veh.costo != null ? Number(veh.costo) : null;
    const ins = await sb.from("cierres").insert({
      ...v.value, local_id: lead.local_id, lead_id: lead.id, cotizacion_id: cot.id, reserva_id: reserva.id, vehiculo_id: veh.id,
      cliente_id: lead.cliente_id, ejecutivo_id: lead.asignado_a,
      vehiculo_snapshot: { patente: veh.patente, marca: veh.marca, modelo: veh.modelo, version: veh.version, anio: veh.anio, km: veh.km },
      precio_lista: Number(cot.precio_lista), precio_cotizado: Number(cot.precio_final), costo, margen: margenVenta(v.value.precio_final, costo),
      reserva_monto: Number(reserva.monto), estado: "pendiente", solicitado_por: userName, creado_por: userId,
    }).select().single();
    if (ins.error) return ins.error.code === "23505" ? err("cierre_en_curso", 409) : fallo(ins.error);
    let cierre = ins.data;
    await evento(lead.id, "cierre", `Cierre de venta ${folioVenta(cierre.numero)} pedido por ${userName} · ${dinero(cierre.precio_final)}${cierre.precio_final < cierre.precio_cotizado ? ` (${dinero(cierre.precio_cotizado - cierre.precio_final)} menos que la cotización)` : ""}`);
    await audit(ctx.actor, "venta.solicitar", "cierre", cierre.id, { numero: cierre.numero, precio_final: cierre.precio_final, precio_cotizado: cierre.precio_cotizado });
    // Cada venta pide la revisión de sus documentos.
    const valCierre = await crearValidacion({
      tipo: "venta", local_id: lead.local_id, cierre_id: cierre.id, lead_id: lead.id, vehiculo_id: veh.id,
      sujeto: sujetoDeVehiculo(veh, { folio: folioVenta(cierre.numero) }), opciones: { conFinanciamiento: Number(cierre.monto_financiado) > 0, conParteDePago: Number(cierre.monto_parte_pago) > 0 },
    });
    if (valCierre) await evento(lead.id, "validacion", `Validación ${folioValidacion(valCierre.numero)} creada para revisar los documentos de la venta`);
    // Si hay Validadores en el local, la venta espera su aprobación; si no, el supervisor que cierra aprueba su propia venta (queda a su nombre en la bitácora).
    const exige = !!valCierre && (await hayValidadores(lead.local_id));
    if (esSupervisor && !exige) cierre = await aprobarCierre(cierre);
    if (cierre.estado === "pendiente") await avisarSupervisores(lead.local_id, "Cierre de venta por aprobar", [`${userName} pidió aprobar el cierre ${folioVenta(cierre.numero)} por ${dinero(cierre.precio_final)} (${veh.marca} ${veh.modelo}).`]);
    return json({ cierre: sinCosto(cierre, can("inventario.editar")), validacion: valCierre ? { id: valCierre.id, folio: folioValidacion(valCierre.numero), estado: valCierre.estado, exige } : null });
  }

  if (op === "cierres.aprobar" || op === "cierres.rechazar") {
    if (!esSupervisor) return err("forbidden", 403);
    const c = await cargarCierre(String(body.id ?? ""));
    if (!c) return err("no_existe", 404);
    if (c.estado !== "pendiente") return err("sin_cambio");
    if (op === "cierres.rechazar") {
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      if (motivo.length < 3) return err("motivo_requerido");
      const { data, error } = await sb.from("cierres").update({ estado: "rechazada", motivo_rechazo: motivo, actualizado_en: new Date().toISOString() }).eq("id", c.id).select().single();
      if (error) return fallo(error);
      await evento(c.lead_id, "cierre", `Cierre ${folioVenta(c.numero)} rechazado por ${userName}: ${motivo}`);
      await audit(ctx.actor, "venta.rechazar", "cierre", c.id, { numero: c.numero, motivo, solicitado_por: c.solicitado_por });
      await avisarEjecutivoDe(c.lead_id, "Cierre de venta rechazado", `${userName} rechazó el cierre ${folioVenta(c.numero)}: ${motivo}`);
      return json({ cierre: sinCosto(data, can("inventario.editar")) });
    }
    // Al aprobar, la reserva debe seguir vigente y el vehículo reservado: si no, el cierre ya no se sostiene.
    const reserva = c.reserva_id ? (await sb.from("reservas").select("*").eq("id", c.reserva_id).maybeSingle()).data : null;
    const { data: veh } = await sb.from("vehiculos").select("estado").eq("id", c.vehiculo_id).maybeSingle();
    if (!reserva || reserva.estado !== "activa" || !veh || veh.estado !== "reservado") return err("reserva_no_vigente", 409);
    // Con Validadores en el local, la venta solo se aprueba con sus documentos validados.
    if (await hayValidadores(c.local_id)) {
      const vq = await sb.from("validaciones").select("*").eq("cierre_id", c.id);
      if (!vq.error) {
        const activas = (vq.data ?? []).filter((x: any) => x.estado !== "cancelada");
        let val = activas.find((x: any) => x.estado === "aprobada") || activas[0];
        if (!val) {
          const { data: vh } = await sb.from("vehiculos").select("*").eq("id", c.vehiculo_id).maybeSingle();
          val = await crearValidacion({
            tipo: "venta", local_id: c.local_id, cierre_id: c.id, lead_id: c.lead_id, vehiculo_id: c.vehiculo_id,
            sujeto: sujetoDeVehiculo(vh || c.vehiculo_snapshot || {}, { folio: folioVenta(c.numero) }), opciones: { conFinanciamiento: Number(c.monto_financiado) > 0, conParteDePago: Number(c.monto_parte_pago) > 0 },
          });
        }
        if (val && val.estado !== "aprobada") return err("validacion_pendiente", 409);
      }
    }
    const aprobado = await aprobarCierre(c);
    await avisarEjecutivoDe(c.lead_id, "Cierre de venta aprobado", `${userName} aprobó el cierre ${folioVenta(c.numero)} por ${dinero(c.precio_final)}.`);
    return json({ cierre: sinCosto(aprobado, can("inventario.editar")) });
  }

  // El ejecutivo (o el supervisor) retira un cierre que aún no se aprueba.
  if (op === "cierres.retirar") {
    const c = await cargarCierre(String(body.id ?? ""));
    if (!c) return err("no_existe", 404);
    const lead = await cargarLead(c.lead_id);
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    if (c.estado !== "pendiente") return err("sin_cambio");
    const ahora = new Date().toISOString();
    const { data, error } = await sb.from("cierres").update({ estado: "anulada", motivo_anulacion: "Retirado antes de aprobarse", anulado_por: userName, anulado_en: ahora, actualizado_en: ahora }).eq("id", c.id).select().single();
    if (error) return fallo(error);
    await evento(c.lead_id, "cierre", `Cierre ${folioVenta(c.numero)} retirado por ${userName}`);
    await audit(ctx.actor, "venta.retirar", "cierre", c.id, { numero: c.numero });
    return json({ cierre: sinCosto(data, can("inventario.editar")) });
  }

  // Revertir una venta aprobada: solo el supervisor y con un motivo. La comisión de ese mes se recalcula sin ella.
  if (op === "cierres.anular") {
    if (!esSupervisor) return err("forbidden", 403);
    const c = await cargarCierre(String(body.id ?? ""));
    if (!c) return err("no_existe", 404);
    if (c.estado !== "aprobada") return err("sin_cambio");
    const motivo = String(body.motivo ?? "").trim().slice(0, 200);
    if (motivo.length < 3) return err("motivo_requerido");
    const ahora = new Date().toISOString();
    const { data, error } = await sb.from("cierres").update({ estado: "anulada", motivo_anulacion: motivo, anulado_por: userName, anulado_en: ahora, actualizado_en: ahora }).eq("id", c.id).select().single();
    if (error) return fallo(error);
    await sb.from("vehiculos").update({ estado: "disponible", actualizado_en: ahora }).eq("id", c.vehiculo_id).eq("estado", "vendido");
    await sb.from("consignaciones").update({ estado: "vigente", cierre_id: null, precio_venta: null, margen: null, mes: null, vendida_en: null, actualizado_en: ahora }).eq("cierre_id", c.id).eq("estado", "vendida");
    if (c.cotizacion_id) await sb.from("cotizaciones").update({ estado: "vigente", actualizado_en: ahora }).eq("id", c.cotizacion_id).eq("estado", "vendida");
    await sb.from("leads").update({ etapa: "cotizado", actualizado_en: ahora }).eq("id", c.lead_id).eq("etapa", "ganado");
    await evento(c.lead_id, "cierre", `Venta ${folioVenta(c.numero)} anulada por ${userName}: ${motivo}. Sale de la comisión de ${nombreMes(c.mes)}.`);
    await evento(c.lead_id, "etapa", "Cerrado ganado → Cotizado");
    await audit(ctx.actor, "venta.anular", "cierre", c.id, { numero: c.numero, mes: c.mes, precio_final: c.precio_final, ejecutivo_id: c.ejecutivo_id, motivo });
    return json({ cierre: sinCosto(data, can("inventario.editar")) });
  }

  if (op === "cierres.list") {
    const mes = body.mes === undefined ? mesChile() : String(body.mes);
    if (!esMes(mes)) return err("mes_invalido");
    const soloPendientes = body.estado === "pendiente";
    const { data, error } = await scoped(sb.from("cierres").select("*").order("creado_en", { ascending: false }));
    if (error) return fallo(error);
    let lista: any[] = (data ?? []).filter((c: any) => veTodoElLocal || c.ejecutivo_id === userId);
    lista = soloPendientes
      ? lista.filter((c) => c.estado === "pendiente")
      : lista.filter((c) => c.estado === "pendiente" || c.mes === mes || ((c.estado === "rechazada" || c.estado === "anulada") && mesChile(c.actualizado_en) === mes));
    lista = lista.slice(0, MAX_LISTA);
    const clientes = await porIds("clientes", lista.map((c) => c.cliente_id));
    const usuarios = await porIds("usuarios", lista.map((c) => c.ejecutivo_id));
    const puedeCosto = can("inventario.editar");
    return json({
      mes, nombreMes: nombreMes(mes), puedeAprobar: esSupervisor,
      cierres: lista.map((c) => ({
        ...sinCosto(c, puedeCosto),
        folio: folioVenta(c.numero),
        cliente: (clientes.find((x: any) => x.id === c.cliente_id) || {}).nombre ?? "",
        ejecutivo: (usuarios.find((x: any) => x.id === c.ejecutivo_id) || {}).nombre ?? "",
      })),
    });
  }

  /* ---------- comisiones ---------- */
  if (op === "comisiones.resumen") {
    const verTodos = can("comisiones.local") || esSupervisor;
    if (!verTodos && !can("comisiones.propias")) return err("forbidden", 403);
    const mes = body.mes === undefined ? mesChile() : String(body.mes);
    if (!esMes(mes)) return err("mes_invalido");

    const [{ data, error }, pend, equipoElegible, comprasQ, consigQ] = await Promise.all([
      scoped(sb.from("cierres").select("*").eq("estado", "aprobada")),
      scoped(sb.from("cierres").select("ejecutivo_id").eq("estado", "pendiente")),
      verTodos && localId ? elegibles(localId) : Promise.resolve([] as any[]),
      scoped(sb.from("compras").select("*").eq("estado", "comprada")),
      scoped(sb.from("consignaciones").select("*").eq("estado", "vendida")),
    ]);
    if (error) return fallo(error);
    const comprasMes: any[] = comprasQ.error ? [] : (comprasQ.data ?? []).filter((c: any) => c.mes === mes);
    const consigMes: any[] = consigQ.error ? [] : (consigQ.data ?? []).filter((c: any) => c.mes === mes);
    const delMes = (data ?? []).filter((c: any) => c.mes === mes);
    const pendientesPor: Record<string, number> = {};
    for (const c of pend.data ?? []) pendientesPor[c.ejecutivo_id] = (pendientesPor[c.ejecutivo_id] ?? 0) + 1;

    // A quién se muestra: solo a sí misma, o a todo el equipo habilitado del local más quien tenga ventas ese mes.
    const ids = new Set<string>();
    if (verTodos) {
      for (const e of equipoElegible) ids.add(e.id);
      for (const c of [...delMes, ...comprasMes, ...consigMes]) if (c.ejecutivo_id) ids.add(c.ejecutivo_id);
    } else if (!ctx.esAdmin) ids.add(userId);
    const usuarios = await porIds("usuarios", Array.from(ids));
    const puedeCosto = can("inventario.editar");

    const ejecutivos = usuarios.map((u: any) => {
      const suyas = delMes.filter((c: any) => c.ejecutivo_id === u.id);
      const conCredito = suyas.filter((c: any) => Number(c.monto_financiado) > 0);
      const datos = {
        ventasN: suyas.length, segurosN: suyas.filter((c: any) => c.seguro).length,
        creditosN: conCredito.length, creditosComision: conCredito.reduce((a: number, c: any) => a + Number(c.comision_financiera || 0), 0),
        comprasN: comprasMes.filter((c: any) => c.ejecutivo_id === u.id).length, consigRows: filasConsignacion(consigMes, u.id, mes),
      };
      const tramos = tramosEfectivos(u.comision);
      const produccion = calcularProduccion(datos, tramos);
      return {
        id: u.id, nombre: u.nombre, activo: u.activo, datos, produccion, tramos,
        personalizado: Object.keys((u.comision && u.comision.tramos) || {}).length > 0,
        montoVendido: suyas.reduce((a: number, c: any) => a + Number(c.precio_final), 0),
        margen: puedeCosto && suyas.every((c: any) => c.margen != null) ? suyas.reduce((a: number, c: any) => a + Number(c.margen), 0) : null,
        pendientes: pendientesPor[u.id] ?? 0,
        comprado: comprasMes.filter((c: any) => c.ejecutivo_id === u.id).reduce((a: number, c: any) => a + Number(c.monto_final || 0), 0),
      };
    }).sort((a: any, b: any) => b.produccion.total - a.produccion.total || b.datos.ventasN - a.datos.ventasN || a.nombre.localeCompare(b.nombre));

    let meta = 0;
    try { meta = (await configNegocio()).meta_mensual_unidades; } catch (e) { /* sin meta */ }
    return json({
      mes, nombreMes: nombreMes(mes), meta, ejecutivos, verTodos,
      totales: { unidades: delMes.length, produccion: ejecutivos.reduce((a: number, e: any) => a + e.produccion.total, 0), montoVendido: ejecutivos.reduce((a: number, e: any) => a + e.montoVendido, 0) },
      pendientesDeOtrosModulos: [],
    });
  }

  /* ---------- avisos del supervisor ---------- */
  if (op === "avisos.mios") {
    if (ctx.esAdmin) return json({ avisos: [] });
    const { data, error } = await sb.from("avisos").select("*").eq("para", userId).order("creado_en", { ascending: false });
    if (error) return fallo(error);
    const sinLeer = (data ?? []).filter((a: any) => !a.leido_en).slice(0, 20);
    const leads = await porIds("leads", sinLeer.map((a: any) => a.lead_id));
    const clientes = await porIds("clientes", leads.map((l: any) => l.cliente_id));
    return json({
      avisos: sinLeer.map((a: any) => {
        const l = leads.find((x: any) => x.id === a.lead_id);
        return { ...a, cliente: l ? (clientes.find((c: any) => c.id === l.cliente_id) || {}).nombre ?? "" : "" };
      }),
    });
  }

  if (op === "avisos.leer") {
    const { data, error } = await sb.from("avisos").update({ leido_en: new Date().toISOString() }).eq("id", String(body.id ?? "")).eq("para", userId).select().maybeSingle();
    if (error) return fallo(error);
    if (!data) return err("no_existe", 404);
    return json({ ok: true });
  }

  if (op === "avisos.crear") {
    if (!esSupervisor) return err("forbidden", 403);
    const v = validarAviso(body);
    if (!v.ok) return err(v.error!);
    let lead: any = null;
    if (body.leadId) {
      lead = await cargarLead(String(body.leadId));
      if (!lead) return err("no_existe", 404);
    }
    const para = String(body.para || lead?.asignado_a || "");
    if (!para) return err("destinatario_requerido");
    const local = lead ? lead.local_id : await localParaCrear();
    if (!local) return err("sin_local");
    const destino = (await elegibles(local)).find((e: any) => e.id === para);
    if (!destino) return err("asignado_invalido");
    const { data, error } = await sb.from("avisos").insert({ local_id: local, lead_id: lead ? lead.id : null, para, de_id: userId, de_nombre: userName, texto: v.value.texto }).select().single();
    if (error) return fallo(error);
    if (lead) await evento(lead.id, "aviso", `Aviso de ${userName} para ${destino.nombre}: ${v.value.texto}`);
    await audit(ctx.actor, "aviso.crear", "aviso", data.id, { para: destino.nombre, lead_id: lead ? lead.id : null });
    return json({ aviso: data });
  }

  /* ---------- panel de gestión del supervisor ---------- */
  if (op === "gestion.resumen") {
    if (!esSupervisor) return err("forbidden", 403);
    let cfg;
    const ahora = new Date();
    // Todo lo que no depende de otra consulta se pide a la vez (antes eran ~12 viajes seguidos a la base).
    const [cfgR, lr, tr, rr, tsr, isr, vsr, cpr0, avisosMalos0, equipoBase0, cmpQ, cnsQ] = await Promise.all([
      configNegocio().then((c) => ({ c }), (e) => ({ e })),
      scoped(sb.from("leads").select("*").in("etapa", ETAPAS_ABIERTAS)),
      scoped(sb.from("tareas").select("*").eq("hecha", false)),
      scoped(sb.from("reservas").select("*").eq("estado", "activa")),
      scoped(sb.from("tasaciones").select("*").eq("estado", "pendiente")),
      scoped(sb.from("inspecciones").select("*").eq("estado", "pendiente")),
      scoped(sb.from("validaciones").select("*").eq("estado", "pendiente")),
      esSupervisor ? scoped(sb.from("campanias").select("*").eq("estado", "pendiente")) : Promise.resolve({ data: [], error: null }),
      esSupervisor ? avisosConAlertas() : Promise.resolve([] as any[]),
      localId ? elegibles(localId) : Promise.resolve([] as any[]),
      scoped(sb.from("compras").select("*").eq("estado", "pago_pendiente")),
      scoped(sb.from("consignaciones").select("*").eq("estado", "vigente")),
    ]);
    if ((cfgR as any).e) return fallo((cfgR as any).e);
    cfg = (cfgR as any).c;
    if (lr.error) return fallo(lr.error);
    const abiertos: any[] = lr.data ?? [];
    const tareasVencidas: any[] = (tr.data ?? []).filter((t: any) => claseTarea(t.vence_en, ahora) === "vencida");
    const porVencer: any[] = (rr.data ?? []).filter((r: any) => Date.parse(r.vence_en) - ahora.getTime() <= 48 * 3_600_000);

    const tasSinTomar: any[] = tsr.error ? [] : (tsr.data ?? []).filter((t: any) => horasDesde(t.solicitada_en, ahora) >= cfg.horas_tasacion);
    const inspSinTomar: any[] = isr.error ? [] : colaInspecciones(isr.data ?? [], ahora, cfg.horas_inspeccion).atrasadas;
    let valSinTomar: any[] = vsr.error ? [] : colaValidaciones(vsr.data ?? [], ahora, cfg.horas_validacion).atrasadas;
    if (valSinTomar.length > 0) {
      const cv = await porIds("cierres", valSinTomar.map((x) => x.cierre_id));
      valSinTomar = valSinTomar.filter((x) => x.tipo !== "venta" || !x.cierre_id || ["pendiente", "aprobada"].includes((cv.find((c: any) => c.id === x.cierre_id) || {}).estado));
    }
    const comprasPorAprobar: any[] = cmpQ.error || !esSupervisor ? [] : cmpQ.data ?? [];
    const consigPorVencer: any[] = cnsQ.error || !esSupervisor ? [] : (cnsQ.data ?? []).filter((c: any) => { const d = diasParaVencer(c.vence_en); return d !== null && d <= 7; });
    const avisosMalos = avisosMalos0;
    const cpr = cpr0;
    const campPend: any[] = cpr.error ? [] : cpr.data ?? [];
    const sinAtender = abiertos.filter((l) => esSinAtender(l, ahora, cfg.horas_sin_contacto));
    const detenidos = abiertos.filter((l) => esDetenido(l, ahora, cfg.dias_detenido));
    const sinAsignar = abiertos.filter((l) => !l.asignado_a);

    const leadsDeTareas = await porIds("leads", [...tareasVencidas, ...porVencer, ...tasSinTomar].map((x) => x.lead_id));
    const equipoBase = equipoBase0;
    const [clientes, vehiculos, usuarios] = await Promise.all([
      porIds("clientes", [...abiertos, ...leadsDeTareas].map((l: any) => l.cliente_id)),
      porIds("vehiculos", porVencer.map((r) => r.vehiculo_id)),
      porIds("usuarios", [...abiertos.map((l) => l.asignado_a), ...tareasVencidas.map((t) => t.asignado_a), ...equipoBase.map((e: any) => e.id), ...tasSinTomar.map((t) => t.solicitante_id), ...inspSinTomar.map((x) => x.solicitante_id)]),
    ]);
    const nombreDe = (id: string) => (usuarios.find((u: any) => u.id === id) || {}).nombre ?? "";
    const clienteDe = (id: string) => (clientes.find((c: any) => c.id === id) || {}).nombre ?? "";
    const fila = (l: any) => ({ id: l.id, cliente: clienteDe(l.cliente_id), ejecutivo: l.asignado_a ? nombreDe(l.asignado_a) : "", asignado_a: l.asignado_a, etapa: l.etapa, fuente: l.fuente, creado_en: l.creado_en, ultima_actividad: ultimaActividad(l) });
    const tope = (arr: any[]) => arr.slice(0, 50);

    const ids = new Set<string | null>([...equipoBase.map((e: any) => e.id), ...abiertos.map((l) => l.asignado_a), ...tareasVencidas.map((t) => t.asignado_a)]);
    const equipo = Array.from(ids).map((id) => ({
      id, nombre: id ? nombreDe(id as string) : "Sin asignar",
      abiertos: abiertos.filter((l) => (l.asignado_a ?? null) === id).length,
      sinAtender: sinAtender.filter((l) => (l.asignado_a ?? null) === id).length,
      detenidos: detenidos.filter((l) => (l.asignado_a ?? null) === id).length,
      tareasVencidas: tareasVencidas.filter((t) => (t.asignado_a ?? null) === id).length,
      reservasPorVencer: porVencer.filter((r) => ((leadsDeTareas.find((l: any) => l.id === r.lead_id) || {}).asignado_a ?? null) === id).length,
    })).filter((e) => e.id !== null || e.abiertos > 0).sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.nombre.localeCompare(b.nombre)));

    return json({
      config: { horas_sin_contacto: cfg.horas_sin_contacto, dias_detenido: cfg.dias_detenido, horas_tasacion: cfg.horas_tasacion, horas_inspeccion: cfg.horas_inspeccion, horas_validacion: cfg.horas_validacion },
      conteos: { abiertos: abiertos.length, sinAtender: sinAtender.length, detenidos: detenidos.length, sinAsignar: sinAsignar.length, tareasVencidas: tareasVencidas.length, reservasPorVencer: porVencer.length, tasacionesSinTomar: tasSinTomar.length, inspeccionesSinTomar: inspSinTomar.length, validacionesSinTomar: valSinTomar.length, avisosDesactualizados: avisosMalos.length, campaniasPorAprobar: campPend.length, comprasPorAprobar: comprasPorAprobar.length, consignacionesPorVencer: consigPorVencer.length },
      sinAtender: tope(sinAtender).map(fila),
      detenidos: tope(detenidos).map(fila),
      sinAsignar: tope(sinAsignar).map(fila),
      tareasVencidas: tope(tareasVencidas).map((t) => {
        const l = leadsDeTareas.find((x: any) => x.id === t.lead_id);
        return { id: t.id, titulo: t.titulo, tipo: t.tipo, vence_en: t.vence_en, lead_id: t.lead_id, cliente: l ? clienteDe(l.cliente_id) : "", ejecutivo: nombreDe(t.asignado_a), asignado_a: t.asignado_a };
      }),
      reservasPorVencer: tope(porVencer).map((r) => {
        const l = leadsDeTareas.find((x: any) => x.id === r.lead_id);
        const v = vehiculos.find((x: any) => x.id === r.vehiculo_id) || {};
        return { id: r.id, lead_id: r.lead_id, monto: r.monto, vence_en: r.vence_en, vehiculo: v.marca ? `${v.marca} ${v.modelo} ${v.anio} · ${v.patente}` : "", cliente: l ? clienteDe(l.cliente_id) : "", ejecutivo: l && l.asignado_a ? nombreDe(l.asignado_a) : "" };
      }),
      tasacionesSinTomar: tope(tasSinTomar).map((t) => {
        const l = leadsDeTareas.find((x: any) => x.id === t.lead_id);
        const vh = t.vehiculo || {};
        return { id: t.id, lead_id: t.lead_id, folio: folioTasacion(t.numero), vehiculo: `${vh.marca ?? ""} ${vh.modelo ?? ""} ${vh.anio ?? ""} · ${vh.patente ?? ""}`.trim(), cliente: l ? clienteDe(l.cliente_id) : (t.contacto && t.contacto.nombre) || "", solicitante: nombreDe(t.solicitante_id), solicitada_en: t.solicitada_en };
      }),
      comprasPorAprobar: tope(comprasPorAprobar).map((c: any) => ({ id: c.id, lead_id: c.lead_id, folio: folioCompra(c.numero), vehiculo: `${(c.vehiculo || {}).marca ?? ""} ${(c.vehiculo || {}).modelo ?? ""} ${(c.vehiculo || {}).anio ?? ""} · ${c.patente ?? ""}`.trim(), monto_final: c.monto_final, solicitado_por: c.solicitado_por })),
      consignacionesPorVencer: tope(consigPorVencer).map((c: any) => ({ id: c.id, lead_id: c.lead_id, folio: folioConsignacion(c.numero), vehiculo: `${(c.vehiculo || {}).marca ?? ""} ${(c.vehiculo || {}).modelo ?? ""} ${(c.vehiculo || {}).anio ?? ""} · ${c.patente ?? ""}`.trim(), vence_en: c.vence_en, dias: diasParaVencer(c.vence_en) })),
      campaniasPorAprobar: tope(campPend).map((c: any) => ({ id: c.id, folio: folioCampania(c.numero), nombre: c.nombre, canal: c.canal, presupuesto: c.presupuesto, desde: c.desde, hasta: c.hasta, creado_por: c.creado_por })),
      avisosDesactualizados: tope(avisosMalos).map((x: any) => ({ id: x.id, folio: x.folio, vehiculo: x.vehiculo, alertas: x.alertas.map((a: any) => a.texto) })),
      validacionesSinTomar: tope(valSinTomar).map((x) => {
        const s = x.sujeto || {};
        return { id: x.id, lead_id: x.lead_id, folio: folioValidacion(x.numero), tipo: x.tipo, vehiculo: `${s.marca ?? ""} ${s.modelo ?? ""} ${s.anio ?? ""} · ${s.patente ?? ""}`.trim(), solicitada_en: x.solicitada_en };
      }),
      inspeccionesSinTomar: tope(inspSinTomar).map((x) => {
        const vh = x.vehiculo || {};
        return { id: x.id, lead_id: x.lead_id, folio: folioInspeccion(x.numero), vehiculo: `${vh.marca ?? ""} ${vh.modelo ?? ""} ${vh.anio ?? ""} · ${vh.patente ?? ""}`.trim(), direccion: x.direccion, agendada_para: x.agendada_para, solicitante: nombreDe(x.solicitante_id), solicitada_en: x.solicitada_en };
      }),
      equipo,
    });
  }

  if (op === "gestion.embudo") {
    if (!esSupervisor) return err("forbidden", 403);
    const mes = body.mes === undefined ? mesChile() : String(body.mes);
    if (!esMes(mes)) return err("mes_invalido");
    // Ventana amplia (un día de margen a cada lado) para absorber la diferencia horaria; luego se filtra por el mes en Chile.
    const [y, m] = mes.split("-").map(Number);
    const desde = new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString();
    const hasta = new Date(Date.UTC(y, m, 1) + 86_400_000).toISOString();

    // Primera tanda: lo que no depende de los leads del mes.
    const [lr, pr, equipoBase, cr, rs, tc, cv] = await Promise.all([
      scoped(sb.from("leads").select("*").gte("creado_en", desde).lt("creado_en", hasta)),
      scoped(sb.from("leads").select("*").eq("etapa", "perdido").gte("actualizado_en", desde).lt("actualizado_en", hasta)),
      localId ? elegibles(localId) : Promise.resolve([] as any[]),
      scoped(sb.from("cotizaciones").select("creado_por, creado_en").gte("creado_en", desde).lt("creado_en", hasta)),
      scoped(sb.from("reservas").select("creado_por, creado_en").gte("creado_en", desde).lt("creado_en", hasta)),
      scoped(sb.from("tareas").select("asignado_a, hecha_en").eq("hecha", true).gte("hecha_en", desde).lt("hecha_en", hasta)),
      scoped(sb.from("cierres").select("ejecutivo_id, mes").eq("estado", "aprobada").eq("mes", mes)),
    ]);
    if (lr.error) return fallo(lr.error);
    const cohorte: any[] = (lr.data ?? []).filter((l: any) => mesChile(l.creado_en) === mes);
    const idsCohorte = cohorte.map((l) => l.id);

    // Segunda tanda: lo que sí depende de los leads del mes.
    const [cotAll, reservas, cierresAll] = await Promise.all([enLotes("cotizaciones", "lead_id", idsCohorte), enLotes("reservas", "lead_id", idsCohorte), enLotes("cierres", "lead_id", idsCohorte)]);
    const cotizaciones = cotAll.filter((c: any) => c.estado !== "anulada");
    const cierres = cierresAll.filter((c: any) => c.estado === "aprobada");
    const puedeCosto = can("inventario.editar");
    const conjuntos = { cotizados: new Set<string>(cotizaciones.map((c: any) => c.lead_id)), reservados: new Set<string>(reservas.map((r: any) => r.lead_id)), vendidos: new Set<string>(cierres.map((c: any) => c.lead_id)) };
    const ventas = new Map<string, { monto: number; margen: number | null }>(cierres.map((c: any) => [c.lead_id, { monto: Number(c.precio_final), margen: puedeCosto && c.margen != null ? Number(c.margen) : null }]));
    const fuentes = rendimientoPorFuente(cohorte, conjuntos, ventas);
    const embudo = embudoCohorte(cohorte, conjuntos);

    // Motivos: leads perdidos EN este mes (sin importar cuándo llegaron).
    const motivos = motivosDePerdida((pr.data ?? []).filter((l: any) => mesChile(l.actualizado_en) === mes));

    // Actividad por ejecutivo en el mes.
    const idsEjec = Array.from(new Set<string>([...equipoBase.map((e: any) => e.id), ...cohorte.map((l) => l.asignado_a).filter(Boolean)]));
    const [usuarios, ev] = await Promise.all([
      porIds("usuarios", idsEjec),
      idsEjec.length
        ? sb.from("lead_eventos").select("usuario_id, tipo, creado_en").in("usuario_id", idsEjec).gte("creado_en", desde).lt("creado_en", hasta)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (ev.error) return fallo(ev.error);
    const eventos = (ev.data ?? []).filter((e: any) => mesChile(e.creado_en) === mes);
    const delMes = (arr: any[] | null, campo: string) => (arr ?? []).filter((x) => mesChile(x[campo]) === mes);

    const equipo = idsEjec.map((id) => {
      const u = usuarios.find((x: any) => x.id === id) || {};
      return {
        id, nombre: u.nombre ?? "", leadsRecibidos: cohorte.filter((l) => l.asignado_a === id).length,
        contactos: eventos.filter((e: any) => e.usuario_id === id && ["llamada", "whatsapp", "visita"].includes(e.tipo)).length,
        cotizaciones: delMes(cr.data, "creado_en").filter((c: any) => c.creado_por === id).length,
        reservas: delMes(rs.data, "creado_en").filter((c: any) => c.creado_por === id).length,
        ventas: (cv.data ?? []).filter((c: any) => c.ejecutivo_id === id).length,
        tareasCumplidas: delMes(tc.data, "hecha_en").filter((t: any) => t.asignado_a === id).length,
      };
    }).sort((a, b) => b.ventas - a.ventas || b.contactos - a.contactos || a.nombre.localeCompare(b.nombre));

    return json({ mes, nombreMes: nombreMes(mes), embudo, fuentes, motivos, equipo, margenVisible: puedeCosto });
  }

  if (op === "leads.reasignarLote") {
    if (!esSupervisor) return err("forbidden", 403);
    const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).map(String)));
    if (ids.length === 0 || ids.length > 50) return err("lote_invalido");
    const local = await localParaCrear();
    if (!local) return err("sin_local");
    const [cVenta, cCompra, cConsig] = await Promise.all([elegibles(local, "venta"), elegibles(local, "compra"), elegibles(local, "consignacion")]);
    const porTipo: Record<string, any[]> = { venta: cVenta, compra: cCompra, consignacion: cConsig };
    const todosCand = [...cVenta, ...cCompra, ...cConsig];
    const ultimaPorGrupo: Record<string, Record<string, string>> = { ventas: await ultimasAsignaciones("venta"), compras: await ultimasAsignaciones("compra") };
    let destino: { id: string; nombre: string } | null = null;
    if (body.asignarA && body.asignarA !== "auto") {
      destino = todosCand.find((c: any) => c.id === body.asignarA) ?? null;
      if (!destino) return err("asignado_invalido");
    } else if (todosCand.length === 0) return err("sin_candidatos");

    const leads = (await enLotes("leads", "id", ids)).filter((l: any) => l.local_id === local);
    const cierres = await enLotes("cierres", "lead_id", leads.map((l: any) => l.id));
    const ocupados = new Set(cierres.filter((c: any) => c.estado === "pendiente" || c.estado === "aprobada").map((c: any) => c.lead_id));
    const omitidos: { id: string; motivo: string }[] = ids.filter((id) => !leads.some((l: any) => l.id === id)).map((id) => ({ id, motivo: "no_existe" }));
    let hechos = 0;
    const ahora = new Date().toISOString();
    for (const l of leads) {
      if (ETAPAS_CERRADAS.includes(l.etapa)) { omitidos.push({ id: l.id, motivo: "lead_cerrado" }); continue; }
      if (ocupados.has(l.id)) { omitidos.push({ id: l.id, motivo: "cierre_en_curso" }); continue; }
      // Con "reparto automático" se va rotando entre el equipo (sin repetir a quien ya lo tiene).
      const candidatos = porTipo[l.tipo || "venta"] ?? cVenta;
      if (destino && !candidatos.some((c: any) => c.id === destino!.id)) { omitidos.push({ id: l.id, motivo: "sin_candidatos" }); continue; }
      const ultima = ultimaPorGrupo[grupoDeReparto(l.tipo || "venta")];
      const asignado = destino ?? elegirAsignado(candidatos.filter((c: any) => c.id !== l.asignado_a), ultima);
      if (!asignado) { omitidos.push({ id: l.id, motivo: "sin_candidatos" }); continue; }
      if (asignado.id === l.asignado_a) { omitidos.push({ id: l.id, motivo: "sin_cambio" }); continue; }
      const up = await sb.from("leads").update({ asignado_a: asignado.id, actualizado_en: ahora }).eq("id", l.id);
      if (up.error) throw up.error;
      ultima[asignado.id] = new Date().toISOString(); // en el reparto en lote, cada grupo sigue rotando
      // Sus tareas pendientes se van con él.
      await sb.from("tareas").update({ asignado_a: asignado.id }).eq("lead_id", l.id).eq("hecha", false);
      await evento(l.id, "asignacion", `Reasignado a ${asignado.nombre} (reasignación en lote)`);
      hechos++;
    }
    await audit(ctx.actor, "lead.reasignar_lote", "lead", undefined, { reasignados: hechos, omitidos: omitidos.length, destino: destino ? destino.nombre : "reparto automático" });
    return json({ reasignados: hechos, omitidos });
  }

  return err("unknown_op");
}
