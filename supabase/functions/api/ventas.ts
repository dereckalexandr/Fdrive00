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
  ESTADOS_VEHICULO, ETAPAS, TIPOS_CONTACTO,
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

  /* ---------- catálogos para las pantallas ---------- */
  if (op === "catalogos") {
    const { data, error } = await sb.from("config_negocio").select("clave, valor");
    if (error) return fallo(error);
    const guardada: Record<string, unknown> = {};
    for (const r of data ?? []) guardada[r.clave] = r.valor;
    const c = configCompleta(guardada);
    let locales: unknown[] = [];
    if (ctx.esAdmin) {
      const l = await sb.from("locales").select("id, nombre, activo").order("creado_en");
      locales = l.data ?? [];
    }
    return json({
      fuentes_lead: c.fuentes_lead, motivos_perdida: c.motivos_perdida, meta_mensual_unidades: c.meta_mensual_unidades,
      comision_ventas_pct: c.comision_ventas_pct, locales, etapas: ETAPAS,
    });
  }

  /* ---------- inventario ---------- */
  if (op.startsWith("inventario.")) {
    if (op === "inventario.list") {
      if (!can("inventario.ver") && !can("inventario.editar") && !usaLeads) return err("forbidden", 403);
      const { data, error } = await scoped(sb.from("vehiculos").select("*").eq("activo", true).order("creado_en", { ascending: false }));
      if (error) return fallo(error);
      const puedeCosto = can("inventario.editar");
      return json({ vehiculos: (data ?? []).slice(0, MAX_LISTA).map((v: any) => ocultarCosto(v, puedeCosto)), puedeEditar: can("inventario.editar") });
    }

    if (!can("inventario.editar")) return err("forbidden", 403);

    if (op === "inventario.save") {
      const v = validarVehiculo(body.datos);
      if (!v.ok) return err(v.error!);
      const id = body.id ? String(body.id) : "";
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
      const { data, error } = await sb.from("vehiculos").update({ estado, actualizado_en: new Date().toISOString() }).eq("id", antes.id).select().single();
      if (error) return fallo(error);
      await audit(ctx.actor, "vehiculo.estado", "vehiculo", antes.id, { patente: antes.patente, antes: antes.estado, despues: estado });
      return json({ vehiculo: data });
    }

    if (op === "inventario.archivar") {
      const { data: antes } = await scoped(sb.from("vehiculos").select("*").eq("id", String(body.id ?? ""))).maybeSingle();
      if (!antes) return err("no_existe", 404);
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
    return json({
      leads,
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
    return json({
      lead, cliente: cliente ?? null, vehiculo: vehiculo ? ocultarCosto(vehiculo, can("inventario.editar")) : null,
      asignado: asignado ? { id: asignado.id, nombre: asignado.nombre } : null, eventos: ev.data ?? [], tareas: ta.data ?? [], puedeEditar: puedeTocar(lead),
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
    const { data, error } = await sb.from("leads").update({ ...r.value, actualizado_en: new Date().toISOString() }).eq("id", lead.id).select().single();
    if (error) return fallo(error);
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

  return err("unknown_op");
}
