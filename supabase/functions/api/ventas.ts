// Operaciones del módulo comercial (entrega 2A): inventario, clientes, leads de venta y tareas.
//
// Las llama index.ts con la acción "ventas". Aquí se decide, EN EL SERVIDOR, qué puede ver y hacer cada persona:
//   - inventario.ver / inventario.editar  -> inventario del local (el costo solo lo ve quien puede editar)
//   - leads.propios + ventas.operar       -> ve y trabaja SOLO los leads que le asignaron
//   - leads.local                         -> ve todos los leads de su local (sin modificarlos)
//   - leads.asignar                       -> supervisor: ve, modifica y reasigna todo el local
//   - cuenta maestra (admin)              -> todo; elige el local con `localId`
// Cada persona está acotada a su local. Los cambios importantes quedan en la bitácora.
import { permisosEfectivos, configCompleta } from "./crm-core.js";
import {
  ESTADOS_VEHICULO, ETAPAS, ETAPAS_CERRADAS, TIPOS_CONTACTO,
  validarCotizacion, estadoCotizacionInicial, requiereNuevaAprobacion, validarReserva, reservaVencida,
  validarVehiculo, ocultarCosto, validarCliente, validarLead, validarCambioEtapa, elegirAsignado, validarTarea,
  puedeEditarLead, etapaNombre,
  validarCierre, margenVenta, mesChile, esMes, nombreMes, FINANCIERAS,
  horasDesde, ETAPAS_ABIERTAS, esSinAtender, esDetenido, ultimaActividad, embudoCohorte, rendimientoPorFuente, motivosDePerdida, validarAviso, claseTarea,
} from "./ventas-core.js";
import { tramosEfectivos, calcularProduccion } from "./comisiones-core.js";
import {
  folioTasacion, validarSolicitudTasacion, validarTasacionDirecta, validarBorradorTasacion, validarCompletarTasacion, validarTransicionTasacion,
  topeParteDePago, verificarTopeParteDePago, fusionarParteDePago, metricasTasador, colaTasaciones,
} from "./tasaciones-core.js";

import {
  folioInspeccion, VEREDICTOS, validarSolicitudInspeccion, validarReprogramacion, validarResultadoInspeccion, claveEsDe,
  validarTransicionInspeccion, idDeClave, ordenarAgenda, hayChoque, metricasInspector, colaInspecciones,
} from "./inspecciones-core.js";

export type Ctx = {
  sb: any;
  json: (data: unknown, status?: number) => Response;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
  isMissingTable: (e: any) => boolean;
  rolePermOverrides: () => Promise<Record<string, string[]>>;
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
    const out: any[] = [];
    for (let i = 0; i < unicos.length; i += 80) {
      const { data, error } = await sb.from(tabla).select("*").in(columna, unicos.slice(i, i + 80));
      if (error) throw error;
      out.push(...(data ?? []));
    }
    return out;
  }
  const porIds = (tabla: string, ids: string[]) => enLotes(tabla, "id", ids);

  async function elegibles(local: string) {
    const overrides = await ctx.rolePermOverrides();
    const { data, error } = await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id").eq("local_id", local);
    if (error) throw error;
    return (data ?? [])
      .filter((u: any) => u.activo)
      .filter((u: any) => {
        const p = permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra);
        return p.includes("leads.propios") && p.includes("ventas.operar");
      })
      .map((u: any) => ({ id: u.id, nombre: u.nombre }));
  }

  async function ultimasAsignaciones() {
    const { data } = await scoped(sb.from("leads").select("asignado_a, creado_en"));
    const out: Record<string, string> = {};
    for (const l of data ?? []) {
      if (l.asignado_a && (!out[l.asignado_a] || l.creado_en > out[l.asignado_a])) out[l.asignado_a] = l.creado_en;
    }
    return out;
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
  /** Lo máximo que se le puede reconocer al cliente por su vehículo en parte de pago: lo tasado (o null si no hay tasación). */
  async function topeDeLead(lead: any): Promise<number | null> {
    const id = lead && lead.parte_pago && lead.parte_pago.tasacion_id;
    if (!id) return null;
    const { data } = await sb.from("tasaciones").select("*").eq("id", id).maybeSingle();
    return topeParteDePago(data);
  }
  const puedeVer = (lead: any) => veTodoElLocal || lead.asignado_a === userId;
  const puedeTocar = (lead: any) => puedeEditarLead({ permisos: ctx.esAdmin ? ["leads.asignar"] : permisos, esAdmin: ctx.esAdmin, usuarioId: userId, lead });

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
    const { data, error } = await scoped(sb.from("reservas").select("*").eq("estado", "activa"));
    if (error) { if (ctx.isMissingTable(error)) return; throw error; }
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
    return json({
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
        return json({ vehiculo: data });
      }
      const { data: antes } = await scoped(sb.from("vehiculos").select("*").eq("id", id)).maybeSingle();
      if (!antes) return err("no_existe", 404);
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
      return json({ tasacion: (await enriquecer([t]))[0], puedeEditar: t.estado === "en_proceso" && (t.tasador_id === userId), puedeGestionar: esSupervisor, puedeRealizar: realiza });
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
      if (b.value.vehiculo) { patch.patente = b.value.vehiculo.patente; }
      if (completar) {
        const fin = validarCompletarTasacion({ valor_compra: patch.valor_compra ?? t.valor_compra, valor_venta: patch.valor_venta ?? t.valor_venta });
        if (!fin.ok) return err(fin.error!);
        patch.valor_compra = fin.value.valor_compra;
        patch.valor_venta = fin.value.valor_venta;
        patch.estado = "completada";
        patch.completada_en = new Date().toISOString();
      }
      const { data, error } = await sb.from("tasaciones").update(patch).eq("id", t.id).select().single();
      if (error) return fallar(error);
      if (completar) {
        // El valor tasado queda como el valor del vehículo en parte de pago del lead (y como su tope).
        if (t.lead_id) {
          const lead = await cargarLead(t.lead_id);
          if (lead) {
            const vh = data.vehiculo || {};
            const pp = { ...(lead.parte_pago || {}), tiene: true, patente: vh.patente, marca: vh.marca, modelo: vh.modelo, anio: vh.anio, km: vh.km, valor: data.valor_compra, tasacion_id: data.id };
            await sb.from("leads").update({ parte_pago: pp, actualizado_en: new Date().toISOString() }).eq("id", lead.id);
          }
          await evento(t.lead_id, "tasacion", `Tasación ${folioTasacion(t.numero)} completada por ${userName}: se reconoce ${dinero(data.valor_compra)} por el vehículo (venta esperada ${dinero(data.valor_venta)}). Las cotizaciones deben usar este valor o uno menor.`);
        }
        await audit(ctx.actor, "tasacion.completar", "tasacion", t.id, { numero: t.numero, valor_compra: data.valor_compra, valor_venta: data.valor_venta, lead_id: t.lead_id });
      }
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
            out.push({ key, fecha: d.fecha ?? null, inspector: d.inspectorNombre ?? null, patente: pat, marca: d.marca ?? null, modelo: d.modelo ?? null, anio: d.anio ?? null });
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

  /* ---------- inspecciones (Inspector, solicitudes con cola y agenda) ---------- */
  if (op.startsWith("inspecciones.")) {
    const realiza = can("inspecciones.realizar");
    const puedePedir = can("inspecciones.pedir") || esSupervisor;
    if (!realiza && !puedePedir) return err("forbidden", 403);

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

    if (op === "inspecciones.pedir") {
      if (!puedePedir) return err("forbidden", 403);
      const v = validarSolicitudInspeccion(body.datos);
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
        else if (!(puedePedir || realiza || can("inventario.ver") || can("inventario.editar"))) return err("forbidden", 403);
        filas = filas.filter((x) => x[campo] === valor).sort((a, b) => String(b.solicitada_en).localeCompare(String(a.solicitada_en)));
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
      const v = validarReprogramacion(body.datos);
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
    let leads: any[] = (data ?? []).filter((l: any) => !((l.etapa === "perdido" || l.etapa === "ganado") && Date.parse(l.actualizado_en) < hace30));
    if (!todos) leads = leads.filter((l) => l.asignado_a === userId);
    leads = leads.slice(0, MAX_LISTA);
    const clientes = await porIds("clientes", leads.map((l) => l.cliente_id));
    const vehiculos = await porIds("vehiculos", leads.map((l) => l.vehiculo_id));
    const usuarios = await porIds("usuarios", leads.map((l) => l.asignado_a));
    const puedeCosto = can("inventario.editar");
    // Marcas para las tarjetas del embudo: descuento esperando aprobación y reserva en curso.
    const marcas: Record<string, { pendiente?: boolean; reserva_vence_en?: string; cierre_pendiente?: boolean }> = {};
    const cp = await scoped(sb.from("cotizaciones").select("lead_id, estado").eq("estado", "pendiente"));
    if (!cp.error) for (const c of cp.data ?? []) marcas[c.lead_id] = { ...marcas[c.lead_id], pendiente: true };
    const ci = await scoped(sb.from("cierres").select("lead_id").eq("estado", "pendiente"));
    if (!ci.error) for (const c of ci.data ?? []) marcas[c.lead_id] = { ...marcas[c.lead_id], cierre_pendiente: true };
    const rs = await scoped(sb.from("reservas").select("lead_id, vence_en").eq("estado", "activa"));
    if (!rs.error) for (const r of rs.data ?? []) marcas[r.lead_id] = { ...marcas[r.lead_id], reserva_vence_en: r.vence_en };
    return json({
      leads, marcas,
      clientes: clientes.map((c: any) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, email: c.email, rut: c.rut })),
      vehiculos: vehiculos.map((v: any) => ocultarCosto({ id: v.id, patente: v.patente, marca: v.marca, modelo: v.modelo, anio: v.anio, precio_lista: v.precio_lista, costo: v.costo }, puedeCosto)),
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
    const [cliente] = await porIds("clientes", [lead.cliente_id]);
    const [vehiculo] = await porIds("vehiculos", [lead.vehiculo_id]);
    const [asignado] = await porIds("usuarios", [lead.asignado_a]);
    const ev = await sb.from("lead_eventos").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false }).limit(100);
    const ta = await sb.from("tareas").select("*").eq("lead_id", lead.id).order("vence_en");
    // Cotizaciones y reservas del lead (si las tablas de la entrega 2B aún no existen, se omiten).
    const cot = await sb.from("cotizaciones").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false });
    const res = await sb.from("reservas").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false });
    const cie = await sb.from("cierres").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false });
    const tas = await sb.from("tasaciones").select("*").eq("lead_id", lead.id).order("creado_en", { ascending: false });
    const puedeCosto = can("inventario.editar");
    const tasUsuarios = tas.error ? [] : await porIds("usuarios", (tas.data ?? []).map((t: any) => t.tasador_id));
    const loc = lead.local_id ? await sb.from("locales").select("nombre").eq("id", lead.local_id).maybeSingle() : { data: null };
    return json({
      lead, cliente: cliente ?? null, vehiculo: vehiculo ? ocultarCosto(vehiculo, can("inventario.editar")) : null,
      asignado: asignado ? { id: asignado.id, nombre: asignado.nombre } : null, eventos: ev.data ?? [], tareas: ta.data ?? [], puedeEditar: puedeTocar(lead),
      cotizaciones: cot.error ? [] : cot.data ?? [], reservas: res.error ? [] : res.data ?? [], localNombre: loc.data ? loc.data.nombre : "",
      cierres: cie.error ? [] : (cie.data ?? []).map((c: any) => sinCosto(c, puedeCosto)),
      tasaciones: tas.error ? [] : (tas.data ?? []).map(({ fotos, ...t }: any) => ({ ...t, folio: folioTasacion(t.numero), tasador: (tasUsuarios.find((u: any) => u.id === t.tasador_id) || {}).nombre ?? "", nFotos: (fotos ?? []).length })),
    });
  }

  if (op === "leads.create") {
    if (!(can("ventas.operar") && can("leads.propios")) && !esSupervisor) return err("forbidden", 403);
    const local = await localParaCrear();
    if (!local) return err("sin_local");

    const datosLead = validarLead(body.lead);
    if (!datosLead.ok) return err(datosLead.error!);
    if (datosLead.value.vehiculo_id) {
      const { data: v } = await sb.from("vehiculos").select("id, local_id").eq("id", datosLead.value.vehiculo_id).maybeSingle();
      if (!v || v.local_id !== local) return err("vehiculo_invalido");
    }

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
      const candidatos = await elegibles(local);
      asignado = candidatos.find((c: any) => c.id === body.asignarA) ?? null;
      if (!asignado) return err("asignado_invalido");
    } else {
      asignado = elegirAsignado(await elegibles(local), await ultimasAsignaciones());
    }

    const { data: lead, error } = await sb.from("leads").insert({
      ...datosLead.value, tipo: "venta", etapa: "nuevo", local_id: local, cliente_id: cliente.id,
      asignado_a: asignado ? asignado.id : null, creado_por: ctx.esAdmin ? null : userId,
    }).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "creado", asignado ? `Lead creado y asignado a ${asignado.nombre}` : "Lead creado sin asignar (no hay ejecutivos habilitados para ventas)");
    await audit(ctx.actor, "lead.crear", "lead", lead.id, { cliente: cliente.nombre, asignado: asignado?.nombre ?? null });
    return json({ lead, cliente, asignado });
  }

  if (op === "leads.update") {
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    const v = validarLead(body.lead);
    if (!v.ok) return err(v.error!);
    if (v.value.vehiculo_id) {
      const { data: veh } = await sb.from("vehiculos").select("id, local_id").eq("id", v.value.vehiculo_id).maybeSingle();
      if (!veh || veh.local_id !== lead.local_id) return err("vehiculo_invalido");
    }
    // El valor del vehículo en parte de pago no puede superar lo tasado, y el vínculo con la tasación se conserva.
    const tope = verificarTopeParteDePago(v.value.parte_pago, await topeDeLead(lead));
    if (!tope.ok) return err(tope.error!);
    v.value.parte_pago = fusionarParteDePago(lead.parte_pago, v.value.parte_pago);
    const { data, error } = await sb.from("leads").update({ ...v.value, actualizado_en: new Date().toISOString() }).eq("id", lead.id).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "nota", "Se actualizaron los datos del lead");
    return json({ lead: data });
  }

  if (op === "leads.mover") {
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead || !puedeVer(lead)) return err("no_existe", 404);
    if (!puedeTocar(lead)) return err("forbidden", 403);
    const r = validarCambioEtapa({ desde: lead.etapa, hacia: String(body.etapa ?? ""), motivo: body.motivo, puedeReabrir: esSupervisor });
    if (!r.ok) return err(r.error!);
    // Con una reserva activa solo se puede perder el lead (y eso cancela la reserva); no moverlo a otra etapa.
    const reservaActiva = await reservaActivaDeLead(lead.id);
    if (reservaActiva && r.value.etapa !== "perdido") return err("reserva_activa");
    const { data, error } = await sb.from("leads").update({ ...r.value, actualizado_en: new Date().toISOString() }).eq("id", lead.id).select().single();
    if (error) return fallo(error);
    if (reservaActiva) await cerrarReserva(reservaActiva, "cancelada", "El lead se marcó como perdido", { volverACotizado: false });
    await evento(lead.id, "etapa", `${etapaNombre(lead.etapa)} → ${etapaNombre(r.value.etapa)}${r.value.motivo_perdida ? ` (${r.value.motivo_perdida})` : ""}`);
    await audit(ctx.actor, "lead.mover", "lead", lead.id, { de: lead.etapa, a: r.value.etapa, motivo: r.value.motivo_perdida });
    return json({ lead: data });
  }

  if (op === "leads.reasignar") {
    if (!esSupervisor) return err("forbidden", 403);
    const lead = await cargarLead(String(body.id ?? ""));
    if (!lead) return err("no_existe", 404);
    const candidatos = await elegibles(lead.local_id);
    let nuevo: { id: string; nombre: string } | null;
    if (body.asignarA && body.asignarA !== "auto") {
      nuevo = candidatos.find((c: any) => c.id === body.asignarA) ?? null;
      if (!nuevo) return err("asignado_invalido");
    } else {
      nuevo = elegirAsignado(candidatos.filter((c: any) => c.id !== lead.asignado_a), await ultimasAsignaciones()) ?? null;
      if (!nuevo) return err("sin_candidatos");
    }
    const { data, error } = await sb.from("leads").update({ asignado_a: nuevo.id, actualizado_en: new Date().toISOString() }).eq("id", lead.id).select().single();
    if (error) return fallo(error);
    await evento(lead.id, "asignacion", `Reasignado a ${nuevo.nombre}`);
    await audit(ctx.actor, "lead.reasignar", "lead", lead.id, { de: lead.asignado_a, a: nuevo.id, nombre: nuevo.nombre });
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
    return json({ lead: data });
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
    return json({ tarea: data });
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
    const leads = await porIds("leads", lista.map((r) => r.lead_id));
    if (!veTodoElLocal) lista = lista.filter((r) => (leads.find((l: any) => l.id === r.lead_id) || {}).asignado_a === userId);
    const vehiculos = await porIds("vehiculos", lista.map((r) => r.vehiculo_id));
    const clientes = await porIds("clientes", lista.map((r) => r.cliente_id));
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
    // El supervisor que cierra aprueba su propia venta (queda a su nombre en la bitácora).
    if (esSupervisor) cierre = await aprobarCierre(cierre);
    return json({ cierre: sinCosto(cierre, can("inventario.editar")) });
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
      return json({ cierre: sinCosto(data, can("inventario.editar")) });
    }
    // Al aprobar, la reserva debe seguir vigente y el vehículo reservado: si no, el cierre ya no se sostiene.
    const reserva = c.reserva_id ? (await sb.from("reservas").select("*").eq("id", c.reserva_id).maybeSingle()).data : null;
    const { data: veh } = await sb.from("vehiculos").select("estado").eq("id", c.vehiculo_id).maybeSingle();
    if (!reserva || reserva.estado !== "activa" || !veh || veh.estado !== "reservado") return err("reserva_no_vigente", 409);
    return json({ cierre: sinCosto(await aprobarCierre(c), can("inventario.editar")) });
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

    const { data, error } = await scoped(sb.from("cierres").select("*").eq("estado", "aprobada"));
    if (error) return fallo(error);
    const delMes = (data ?? []).filter((c: any) => c.mes === mes);
    const pend = await scoped(sb.from("cierres").select("ejecutivo_id").eq("estado", "pendiente"));
    const pendientesPor: Record<string, number> = {};
    for (const c of pend.data ?? []) pendientesPor[c.ejecutivo_id] = (pendientesPor[c.ejecutivo_id] ?? 0) + 1;

    // A quién se muestra: solo a sí misma, o a todo el equipo habilitado del local más quien tenga ventas ese mes.
    const ids = new Set<string>();
    if (verTodos) {
      const local = localId;
      if (local) for (const e of await elegibles(local)) ids.add(e.id);
      for (const c of delMes) if (c.ejecutivo_id) ids.add(c.ejecutivo_id);
    } else if (!ctx.esAdmin) ids.add(userId);
    const usuarios = await porIds("usuarios", Array.from(ids));
    const puedeCosto = can("inventario.editar");

    const ejecutivos = usuarios.map((u: any) => {
      const suyas = delMes.filter((c: any) => c.ejecutivo_id === u.id);
      const conCredito = suyas.filter((c: any) => Number(c.monto_financiado) > 0);
      const datos = {
        ventasN: suyas.length, segurosN: suyas.filter((c: any) => c.seguro).length,
        creditosN: conCredito.length, creditosComision: conCredito.reduce((a: number, c: any) => a + Number(c.comision_financiera || 0), 0),
      };
      const tramos = tramosEfectivos(u.comision);
      const produccion = calcularProduccion(datos, tramos);
      return {
        id: u.id, nombre: u.nombre, activo: u.activo, datos, produccion, tramos,
        personalizado: Object.keys((u.comision && u.comision.tramos) || {}).length > 0,
        montoVendido: suyas.reduce((a: number, c: any) => a + Number(c.precio_final), 0),
        margen: puedeCosto && suyas.every((c: any) => c.margen != null) ? suyas.reduce((a: number, c: any) => a + Number(c.margen), 0) : null,
        pendientes: pendientesPor[u.id] ?? 0,
      };
    }).sort((a: any, b: any) => b.datos.ventasN - a.datos.ventasN || a.nombre.localeCompare(b.nombre));

    let meta = 0;
    try { meta = (await configNegocio()).meta_mensual_unidades; } catch (e) { /* sin meta */ }
    return json({
      mes, nombreMes: nombreMes(mes), meta, ejecutivos, verTodos,
      totales: { unidades: delMes.length, produccion: ejecutivos.reduce((a: number, e: any) => a + e.produccion.total, 0), montoVendido: ejecutivos.reduce((a: number, e: any) => a + e.montoVendido, 0) },
      pendientesDeOtrosModulos: ["compras", "consignaciones"],
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
    try { cfg = await configNegocio(); } catch (e) { return fallo(e); }
    const ahora = new Date();
    const lr = await scoped(sb.from("leads").select("*").in("etapa", ETAPAS_ABIERTAS));
    if (lr.error) return fallo(lr.error);
    const abiertos: any[] = lr.data ?? [];
    const tr = await scoped(sb.from("tareas").select("*").eq("hecha", false));
    const rr = await scoped(sb.from("reservas").select("*").eq("estado", "activa"));
    const tareasVencidas: any[] = (tr.data ?? []).filter((t: any) => claseTarea(t.vence_en, ahora) === "vencida");
    const porVencer: any[] = (rr.data ?? []).filter((r: any) => Date.parse(r.vence_en) - ahora.getTime() <= 48 * 3_600_000);

    const tsr = await scoped(sb.from("tasaciones").select("*").eq("estado", "pendiente"));
    const tasSinTomar: any[] = tsr.error ? [] : (tsr.data ?? []).filter((t: any) => horasDesde(t.solicitada_en, ahora) >= cfg.horas_tasacion);
    const isr = await scoped(sb.from("inspecciones").select("*").eq("estado", "pendiente"));
    const inspSinTomar: any[] = isr.error ? [] : colaInspecciones(isr.data ?? [], ahora, cfg.horas_inspeccion).atrasadas;
    const sinAtender = abiertos.filter((l) => esSinAtender(l, ahora, cfg.horas_sin_contacto));
    const detenidos = abiertos.filter((l) => esDetenido(l, ahora, cfg.dias_detenido));
    const sinAsignar = abiertos.filter((l) => !l.asignado_a);

    const leadsDeTareas = await porIds("leads", [...tareasVencidas, ...porVencer, ...tasSinTomar].map((x) => x.lead_id));
    const clientes = await porIds("clientes", [...abiertos, ...leadsDeTareas].map((l: any) => l.cliente_id));
    const vehiculos = await porIds("vehiculos", porVencer.map((r) => r.vehiculo_id));
    const equipoBase = localId ? await elegibles(localId) : [];
    const usuarios = await porIds("usuarios", [...abiertos.map((l) => l.asignado_a), ...tareasVencidas.map((t) => t.asignado_a), ...equipoBase.map((e: any) => e.id), ...tasSinTomar.map((t) => t.solicitante_id), ...inspSinTomar.map((x) => x.solicitante_id)]);
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
      config: { horas_sin_contacto: cfg.horas_sin_contacto, dias_detenido: cfg.dias_detenido, horas_tasacion: cfg.horas_tasacion, horas_inspeccion: cfg.horas_inspeccion },
      conteos: { abiertos: abiertos.length, sinAtender: sinAtender.length, detenidos: detenidos.length, sinAsignar: sinAsignar.length, tareasVencidas: tareasVencidas.length, reservasPorVencer: porVencer.length, tasacionesSinTomar: tasSinTomar.length, inspeccionesSinTomar: inspSinTomar.length },
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

    const lr = await scoped(sb.from("leads").select("*").gte("creado_en", desde).lt("creado_en", hasta));
    if (lr.error) return fallo(lr.error);
    const cohorte: any[] = (lr.data ?? []).filter((l: any) => mesChile(l.creado_en) === mes);
    const idsCohorte = cohorte.map((l) => l.id);

    const cotizaciones = (await enLotes("cotizaciones", "lead_id", idsCohorte)).filter((c: any) => c.estado !== "anulada");
    const reservas = await enLotes("reservas", "lead_id", idsCohorte);
    const cierres = (await enLotes("cierres", "lead_id", idsCohorte)).filter((c: any) => c.estado === "aprobada");
    const puedeCosto = can("inventario.editar");
    const conjuntos = { cotizados: new Set<string>(cotizaciones.map((c: any) => c.lead_id)), reservados: new Set<string>(reservas.map((r: any) => r.lead_id)), vendidos: new Set<string>(cierres.map((c: any) => c.lead_id)) };
    const ventas = new Map<string, { monto: number; margen: number | null }>(cierres.map((c: any) => [c.lead_id, { monto: Number(c.precio_final), margen: puedeCosto && c.margen != null ? Number(c.margen) : null }]));
    const fuentes = rendimientoPorFuente(cohorte, conjuntos, ventas);
    const embudo = embudoCohorte(cohorte, conjuntos);

    // Motivos: leads perdidos EN este mes (sin importar cuándo llegaron).
    const pr = await scoped(sb.from("leads").select("*").eq("etapa", "perdido").gte("actualizado_en", desde).lt("actualizado_en", hasta));
    const motivos = motivosDePerdida((pr.data ?? []).filter((l: any) => mesChile(l.actualizado_en) === mes));

    // Actividad por ejecutivo en el mes.
    const equipoBase = localId ? await elegibles(localId) : [];
    const idsEjec = Array.from(new Set<string>([...equipoBase.map((e: any) => e.id), ...cohorte.map((l) => l.asignado_a).filter(Boolean)]));
    const usuarios = await porIds("usuarios", idsEjec);
    const ev = idsEjec.length
      ? await sb.from("lead_eventos").select("usuario_id, tipo, creado_en").in("usuario_id", idsEjec).gte("creado_en", desde).lt("creado_en", hasta)
      : { data: [], error: null };
    if (ev.error) return fallo(ev.error);
    const eventos = (ev.data ?? []).filter((e: any) => mesChile(e.creado_en) === mes);
    const cr = await scoped(sb.from("cotizaciones").select("creado_por, creado_en").gte("creado_en", desde).lt("creado_en", hasta));
    const rs = await scoped(sb.from("reservas").select("creado_por, creado_en").gte("creado_en", desde).lt("creado_en", hasta));
    const tc = await scoped(sb.from("tareas").select("asignado_a, hecha_en").eq("hecha", true).gte("hecha_en", desde).lt("hecha_en", hasta));
    const cv = await scoped(sb.from("cierres").select("ejecutivo_id, mes").eq("estado", "aprobada").eq("mes", mes));
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
    const candidatos = await elegibles(local);
    const ultima = await ultimasAsignaciones();
    let destino: { id: string; nombre: string } | null = null;
    if (body.asignarA && body.asignarA !== "auto") {
      destino = candidatos.find((c: any) => c.id === body.asignarA) ?? null;
      if (!destino) return err("asignado_invalido");
    } else if (candidatos.length === 0) return err("sin_candidatos");

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
      const asignado = destino ?? elegirAsignado(candidatos.filter((c: any) => c.id !== l.asignado_a), ultima);
      if (!asignado) { omitidos.push({ id: l.id, motivo: "sin_candidatos" }); continue; }
      if (asignado.id === l.asignado_a) { omitidos.push({ id: l.id, motivo: "sin_cambio" }); continue; }
      const up = await sb.from("leads").update({ asignado_a: asignado.id, actualizado_en: ahora }).eq("id", l.id);
      if (up.error) throw up.error;
      ultima[asignado.id] = new Date().toISOString();
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
