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
} from "./ventas-core.js";

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

  async function porIds(tabla: string, ids: string[]) {
    const unicos = Array.from(new Set(ids.filter(Boolean)));
    if (unicos.length === 0) return [];
    const { data, error } = await sb.from(tabla).select("*").in("id", unicos);
    if (error) throw error;
    return data ?? [];
  }

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
  }

  async function cargarLead(id: string) {
    const { data, error } = await scoped(sb.from("leads").select("*").eq("id", id)).maybeSingle();
    if (error) throw error;
    return data;
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
  const fechaCL = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", timeZone: "America/Santiago" });

  /** Reserva activa de un lead (o null; tolera que las tablas de la entrega 2B aún no existan). */
  async function reservaActivaDeLead(leadId: string) {
    const { data, error } = await sb.from("reservas").select("*").eq("lead_id", leadId).eq("estado", "activa").maybeSingle();
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
    for (const r of (data ?? []).filter((x: any) => reservaVencida(x))) await cerrarReserva(r, "vencida", "Venció el plazo", { volverACotizado: true, sistema: true });
  }
  if (/^(inventario\.list|leads\.|cotizaciones\.|reservas\.)/.test(op)) await liberarVencidas();

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
      comision_ventas_pct: c.comision_ventas_pct, locales, etapas: ETAPAS,
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
      const { data, error } = await sb.from("vehiculos").update({ estado, actualizado_en: new Date().toISOString() }).eq("id", antes.id).select().single();
      if (error) return fallo(error);
      await audit(ctx.actor, "vehiculo.estado", "vehiculo", antes.id, { patente: antes.patente, antes: antes.estado, despues: estado });
      return json({ vehiculo: data });
    }

    if (op === "inventario.archivar") {
      const { data: antes } = await scoped(sb.from("vehiculos").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
      if (!antes) return err("no_existe", 404);
      if (antes.estado === "reservado") return err("vehiculo_reservado");
      const { error } = await sb.from("vehiculos").update({ activo: false, actualizado_en: new Date().toISOString() }).eq("id", antes.id);
      if (error) return fallo(error);
      await audit(ctx.actor, "vehiculo.archivar", "vehiculo", antes.id, { patente: antes.patente });
      return json({ ok: true });
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
    let leads: any[] = (data ?? []).filter((l: any) => !(l.etapa === "perdido" && Date.parse(l.actualizado_en) < hace30));
    if (!todos) leads = leads.filter((l) => l.asignado_a === userId);
    leads = leads.slice(0, MAX_LISTA);
    const clientes = await porIds("clientes", leads.map((l) => l.cliente_id));
    const vehiculos = await porIds("vehiculos", leads.map((l) => l.vehiculo_id));
    const usuarios = await porIds("usuarios", leads.map((l) => l.asignado_a));
    const puedeCosto = can("inventario.editar");
    // Marcas para las tarjetas del embudo: descuento esperando aprobación y reserva en curso.
    const marcas: Record<string, { pendiente?: boolean; reserva_vence_en?: string }> = {};
    const cp = await scoped(sb.from("cotizaciones").select("lead_id, estado").eq("estado", "pendiente"));
    if (!cp.error) for (const c of cp.data ?? []) marcas[c.lead_id] = { ...marcas[c.lead_id], pendiente: true };
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
    const loc = lead.local_id ? await sb.from("locales").select("nombre").eq("id", lead.local_id).maybeSingle() : { data: null };
    return json({
      lead, cliente: cliente ?? null, vehiculo: vehiculo ? ocultarCosto(vehiculo, can("inventario.editar")) : null,
      asignado: asignado ? { id: asignado.id, nombre: asignado.nombre } : null, eventos: ev.data ?? [], tareas: ta.data ?? [], puedeEditar: puedeTocar(lead),
      cotizaciones: cot.error ? [] : cot.data ?? [], reservas: res.error ? [] : res.data ?? [], localNombre: loc.data ? loc.data.nombre : "",
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
      if (data.estado === "reservada" || data.estado === "anulada") return err("cotizacion_cerrada");
      previa = data;
    }
    const { data: veh } = await sb.from("vehiculos").select("*").eq("id", String(body.vehiculoId || previa?.vehiculo_id || "")).maybeSingle();
    if (!veh || !veh.activo || veh.local_id !== lead.local_id) return err("vehiculo_invalido");
    if (veh.estado !== "disponible" && !(previa && previa.vehiculo_id === veh.id)) return err("vehiculo_no_disponible");

    // El precio de lista es siempre el actual del inventario; si cambió y hay descuento, se vuelve a pedir aprobación.
    const v = validarCotizacion(body.datos, veh.precio_lista);
    if (!v.ok) return err(v.error!);

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
    if (cot.estado === "anulada") return err("cotizacion_cerrada");
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

  return err("unknown_op");
}
