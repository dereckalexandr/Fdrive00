// Sitio web público: catálogo de vehículos y solicitudes de los visitantes (sin iniciar sesión).
//
// Lo llama index.ts con la acción "public". Aquí NO hay sesión: por eso todo lo que sale pasa por una lista cerrada de campos
// (nunca la patente, el costo ni las notas internas) y todo lo que entra se valida, se limita por IP y por teléfono y crea
// leads normales del CRM con la fuente «Sitio web», que se reparten solos entre los ejecutivos habilitados.
import { permisosEfectivos, configCompleta } from "./crm-core.js";
import { elegirAsignado } from "./ventas-core.js";
import { permisoDeTipo, grupoDeReparto } from "./compras-core.js";
import { validarVehiculoTasacion } from "./tasaciones-core.js";
import { sugerirAviso } from "./anuncios-core.js";
import { enviarAviso, enSegundoPlano, correoActivo } from "./correo.ts";
import { consultarPatente } from "./patentes.ts";
import { LIMITE_WEB_IP_HORA } from "./patentes-core.js";
import {
  visibleEnCatalogo, vehiculoPublico, validarSolicitudWeb, cuotaReferencial, tipoLeadDe, resumenSolicitud, FUENTE_WEB,
  LIMITE_IP_HORA, LIMITE_TELEFONO_HORA, LIMITE_LOCAL_HORA, ESTADOS_VISIBLES,
} from "./publico-core.js";

export type CtxPublico = {
  sb: any;
  json: (data: unknown, status?: number) => Response;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
  isMissingTable: (e: any) => boolean;
  rolePermOverrides: () => Promise<Record<string, string[]>>;
  ip: string;
};

// Límite por dirección IP (por instancia de la función; es un freno, no una garantía).
const porIp = new Map<string, { n: number; reset: number }>();
function superaLimiteIp(ip: string) {
  const ahora = Date.now();
  const a = porIp.get(ip);
  if (!a || a.reset < ahora) { porIp.set(ip, { n: 1, reset: ahora + 3_600_000 }); return false; }
  a.n++;
  return a.n > LIMITE_IP_HORA;
}

const UNA_HORA = 3_600_000;

// Consultas de patente por dirección IP y hora (por instancia de la función: es un freno, no una garantía).
const patentesPorIp = new Map<string, { n: number; reset: number }>();
function superaLimitePatentes(ip: string) {
  const ahora = Date.now();
  const a = patentesPorIp.get(ip);
  if (!a || a.reset < ahora) { patentesPorIp.set(ip, { n: 1, reset: ahora + 3_600_000 }); return false; }
  a.n++;
  return a.n > LIMITE_WEB_IP_HORA;
}

const QUE_PIDIO: Record<string, string> = { consulta: "una consulta", visita: "una visita", financiamiento: "una simulación de financiamiento", vender: "vender o consignar tu vehículo" };

export async function publicOp(ctx: CtxPublico, body: any): Promise<Response> {
  /** Avisos por correo de una solicitud del sitio: al ejecutivo asignado (o a los Jefes Local si no hay) y la confirmación al cliente. Nunca frenan la solicitud. */
  async function avisarSolicitud(d: { s: any; lead: any; cliente: any; asignado: any; local: string; vehTexto: string; empresa?: string }) {
    try {
      if (!correoActivo()) return;
      const { sb } = ctx;
      let para: string[] = [];
      if (d.asignado) {
        const u = await sb.from("usuarios").select("email, activo").eq("id", d.asignado.id).maybeSingle();
        if (u.data && u.data.activo && u.data.email) para = [u.data.email];
      } else {
        const overrides = await ctx.rolePermOverrides();
        const uq = await sb.from("usuarios").select("email, roles, permisos_extra, activo").eq("local_id", d.local);
        para = (uq.data ?? []).filter((u: any) => u.activo && u.email && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("leads.asignar")).map((u: any) => u.email);
      }
      const que = QUE_PIDIO[d.s.tipo] ?? "una solicitud";
      const tareas: Promise<unknown>[] = [];
      const alFallar = (error: string) => ctx.audit({ tipo: "sistema", nombre: "Sitio web" }, "aviso.fallido", "aviso", undefined, { asunto: "solicitud del sitio web", error });
      if (para.length === 0) await ctx.audit({ tipo: "sistema", nombre: "Sitio web" }, "aviso.omitido", "aviso", undefined, { asunto: "solicitud del sitio web", motivo: "ningún ejecutivo ni Jefe Local tiene correo en su ficha" });
      if (para.length) {
        tareas.push(enviarAviso({
          para, asunto: d.asignado ? "Nuevo lead del sitio web" : "Lead del sitio web sin ejecutivo asignado", titulo: d.asignado ? "Nuevo lead del sitio web" : "Lead del sitio web sin ejecutivo asignado",
          lineas: [`${d.s.contacto.nombre} pidió ${que}${d.vehTexto ? ` (${d.vehTexto})` : ""}.`, `Teléfono: ${d.s.contacto.telefono}${d.s.contacto.email ? ` · correo: ${d.s.contacto.email}` : ""}`, d.asignado ? "Contáctalo cuanto antes." : "No hay ejecutivos habilitados: asígnalo desde la plataforma."],
        }, alFallar));
      }
      if (d.s.contacto.email) {
        tareas.push(enviarAviso({
          para: [d.s.contacto.email], asunto: "Recibimos tu solicitud", titulo: "Recibimos tu solicitud",
          lineas: [`Hola ${d.s.contacto.nombre}, recibimos tu solicitud de ${que}${d.vehTexto ? ` por el ${d.vehTexto}` : ""}.`, "Un ejecutivo se pondrá en contacto contigo a la brevedad al teléfono que nos dejaste.", d.empresa ? `Equipo ${d.empresa}` : ""],
          ruta: "/", enlaceTexto: "Ver nuestros vehículos",
        }, alFallar));
      }
      await enSegundoPlano(Promise.all(tareas));
    } catch (e) { console.error("avisarSolicitud:", String((e as any)?.message ?? e)); }
  }

  const { sb, json } = ctx;
  const op = String(body.op ?? "");
  const err = (error: string, status = 400) => json({ error }, status);
  const fallo = (e: any) => {
    if (ctx.isMissingTable(e)) return json({ error: "crm_not_installed" }, 503);
    throw e;
  };

  async function config() {
    const { data, error } = await sb.from("config_negocio").select("clave, valor");
    if (error) throw error;
    const guardada: Record<string, unknown> = {};
    for (const r of data ?? []) guardada[r.clave] = r.valor;
    return configCompleta(guardada);
  }
  const datosEmpresa = (c: any) => ({ nombre: c.sitio_nombre, whatsapp: c.sitio_whatsapp, direccion: c.sitio_direccion, tasaMensual: c.tasa_mensual_web });

  /* ---------- catálogo ---------- */
  if (op === "catalogo") {
    const [vq, lq, cfg] = await Promise.all([
      sb.from("vehiculos").select("id, marca, modelo, version, anio, km, color, transmision, combustible, precio_lista, estado, activo, fotos, local_id, creado_en").eq("activo", true).in("estado", ESTADOS_VISIBLES).order("creado_en", { ascending: false }),
      sb.from("locales").select("id, nombre, direccion, activo"),
      config(),
    ]);
    if (vq.error) return fallo(vq.error);
    const vehiculos = (vq.data ?? []).filter(visibleEnCatalogo).slice(0, 400).map(vehiculoPublico);
    const locales = (lq.data ?? []).filter((l: any) => l.activo !== false && vehiculos.some((v: any) => v.localId === l.id)).map((l: any) => ({ id: l.id, nombre: l.nombre, direccion: l.direccion || null }));
    return json({ vehiculos, locales, empresa: datosEmpresa(cfg) });
  }

  /* ---------- detalle de un vehículo ---------- */
  if (op === "vehiculo") {
    const q = await sb.from("vehiculos").select("*").eq("id", String(body.id ?? "")).maybeSingle();
    if (q.error) return fallo(q.error);
    if (!q.data || !visibleEnCatalogo(q.data)) return err("no_existe", 404);
    const v = q.data;
    // Si el Anunciante armó un aviso, se usa su texto; si no, uno sugerido con los datos del vehículo (sin patente).
    let descripcion = sugerirAviso({ ...v, precio_lista: v.precio_lista }).descripcion;
    const aq = await sb.from("anuncios").select("descripcion, estado").eq("vehiculo_id", v.id);
    if (!aq.error) { const a = (aq.data ?? []).find((x: any) => x.estado !== "baja"); if (a && a.descripcion) descripcion = a.descripcion; }
    const [cfg, lq] = await Promise.all([config(), v.local_id ? sb.from("locales").select("nombre, direccion").eq("id", v.local_id).maybeSingle() : Promise.resolve({ data: null })]);
    return json({ vehiculo: { ...vehiculoPublico(v), descripcion }, local: lq.data ? { nombre: lq.data.nombre, direccion: lq.data.direccion || null } : null, empresa: datosEmpresa(cfg) });
  }

  /* ---------- datos de un vehículo por patente (para el formulario «vende tu auto») ---------- */
  // Solo entrega marca, modelo y año. Lo ya consultado se responde desde la base de datos sin gastar cupo; el sitio web puede gastar
  // como máximo la mitad del cupo diario (el resto queda para el personal). Ver patentes.ts.
  if (op === "patente") {
    if (superaLimitePatentes(ctx.ip)) return err("demasiadas_solicitudes", 429);
    const r = await consultarPatente(sb, body.patente, "web", ctx.isMissingTable);
    if (!r.ok) return err(r.error, r.status);
    const v: any = r.vehiculo;
    return json({ vehiculo: { patente: v.patente, marca: v.marca, modeloCompleto: v.modeloCompleto, anio: v.anio ?? null } });
  }

  /* ---------- una foto (solo de un vehículo visible) ---------- */
  if (op === "foto") {
    const q = await sb.from("vehiculos").select("id, activo, estado, precio_lista, fotos").eq("id", String(body.vehiculoId ?? "")).maybeSingle();
    if (q.error) return fallo(q.error);
    const fotoId = String(body.fotoId ?? "");
    if (!q.data || !visibleEnCatalogo(q.data) || !(q.data.fotos ?? []).includes(fotoId)) return err("no_existe", 404);
    const r = await sb.from("kv_store").select("value").eq("key", `vfoto::${q.data.id}::${fotoId}`).maybeSingle();
    if (r.error) throw r.error;
    return json({ value: r.data ? r.data.value : null });
  }

  /* ---------- solicitud de un visitante ---------- */
  if (op === "solicitud") {
    if (superaLimiteIp(ctx.ip)) return err("demasiadas_solicitudes", 429);
    const v = validarSolicitudWeb(body);
    if (!v.ok) {
      if (v.silencioso) return json({ ok: true }); // robot: se responde "ok" sin crear nada
      return err(v.error!);
    }
    const s = v.value;
    const cfg = await config();

    // Vehículo y local.
    let vehiculo: any = null;
    if (s.vehiculoId) {
      const q = await sb.from("vehiculos").select("*").eq("id", s.vehiculoId).maybeSingle();
      if (q.error) return fallo(q.error);
      if (!q.data || !visibleEnCatalogo(q.data)) return err("vehiculo_no_disponible", 409);
      vehiculo = q.data;
    }
    let local: string | null = vehiculo ? vehiculo.local_id : null;
    if (!local) {
      const lq = await sb.from("locales").select("id, activo");
      if (lq.error) return fallo(lq.error);
      const activos = (lq.data ?? []).filter((l: any) => l.activo !== false);
      local = s.localId && activos.some((l: any) => l.id === s.localId) ? s.localId : activos.length === 1 ? activos[0].id : null;
    }
    if (!local) return err("sin_local");

    // Frenos: tope por local y por teléfono en la última hora.
    const desde = new Date(Date.now() - UNA_HORA).toISOString();
    const recientes = await sb.from("leads").select("id, cliente_id, creado_en").eq("local_id", local).eq("fuente", FUENTE_WEB).gte("creado_en", desde);
    if (recientes.error) return fallo(recientes.error);
    if ((recientes.data ?? []).length >= LIMITE_LOCAL_HORA) return err("demasiadas_solicitudes", 429);

    // Cliente: si el teléfono ya existe en este local se reutiliza.
    const tel = s.contacto.telefono;
    const cq = await sb.from("clientes").select("id, nombre, telefono").eq("local_id", local).eq("telefono", tel);
    if (cq.error) return fallo(cq.error);
    let cliente: any = (cq.data ?? [])[0] ?? null;
    if (cliente) {
      const delTel = new Set((cq.data ?? []).map((c: any) => c.id));
      if ((recientes.data ?? []).filter((l: any) => delTel.has(l.cliente_id)).length >= LIMITE_TELEFONO_HORA) return err("demasiadas_solicitudes", 429);
    } else {
      const ci = await sb.from("clientes").insert({ nombre: s.contacto.nombre, telefono: tel, email: s.contacto.email, local_id: local, notas: "Llegó por el sitio web" }).select().single();
      if (ci.error) return fallo(ci.error);
      cliente = ci.data;
    }

    // Reparto automático entre los ejecutivos habilitados para ventas del local.
    const overrides = await ctx.rolePermOverrides();
    const uq = await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id").eq("local_id", local);
    if (uq.error) throw uq.error;
    const elegibles = (uq.data ?? []).filter((u: any) => u.activo && (() => { const p = permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra); return p.includes("leads.propios") && p.includes(permisoDeTipo(tipoLeadDe(s))); })()).map((u: any) => ({ id: u.id, nombre: u.nombre }));
    const ultimas: Record<string, string> = {};
    // Cada grupo rota por separado: ventas, por un lado; compras y consignaciones, por otro.
    const grupo = grupoDeReparto(tipoLeadDe(s));
    const lastQ = await sb.from("leads").select("asignado_a, creado_en, tipo").eq("local_id", local);
    for (const l of lastQ.data ?? []) if (l.asignado_a && grupoDeReparto(l.tipo || "venta") === grupo && (!ultimas[l.asignado_a] || l.creado_en > ultimas[l.asignado_a])) ultimas[l.asignado_a] = l.creado_en;
    const asignado = elegirAsignado(elegibles, ultimas);

    const vtWeb = s.tipo === "vender" ? validarVehiculoTasacion({ patente: s.vende.patente, marca: s.vende.marca, modelo: s.vende.modelo, anio: s.vende.anio, km: s.vende.km, duenos: s.vende.duenos, prenda: s.vende.prenda, mantenciones: s.vende.mantenciones, precioEsperado: s.vende.precioEsperado }) : null;
    const vehTexto = vehiculo ? `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}` : "";
    const resumen = resumenSolicitud(s, vehTexto);
    let financiamiento: Record<string, unknown> = {};
    let cuota: { montoFinanciar: number; cuota: number } | null = null;
    if (s.tipo === "financiamiento") {
      cuota = cuotaReferencial(vehiculo.precio_lista, s.pie, s.plazo, cfg.tasa_mensual_web);
      financiamiento = { quiere: true, pie: s.pie, banco: null, estado: "por_evaluar" };
    }
    const ins = await sb.from("leads").insert({
      local_id: local, tipo: tipoLeadDe(s), etapa: "nuevo", cliente_id: cliente.id, fuente: FUENTE_WEB,
      vehiculo_id: vehiculo ? vehiculo.id : null,
      vehiculo_interes: s.tipo === "vender" ? `${s.vende.modalidad === "consignar" ? "CONSIGNA" : "VENDE"}: ${s.vende.marca} ${s.vende.modelo} ${s.vende.anio} · ${s.vende.patente}` : null,
      parte_pago: {}, financiamiento, asignado_a: asignado ? asignado.id : null, ...(vtWeb && vtWeb.ok ? { vehiculo_ofrecido: vtWeb.value } : {}),
      notas: [resumen, cuota ? `Cuota referencial: $${cuota.cuota.toLocaleString("es-CL")} por mes (financiando $${cuota.montoFinanciar.toLocaleString("es-CL")} a ${s.plazo} cuotas, tasa ${cfg.tasa_mensual_web}% mensual). Sujeta a evaluación.` : ""].filter(Boolean).join("\n").slice(0, 1000),
    }).select().single();
    if (ins.error) return fallo(ins.error);
    const lead = ins.data;
    const sistema = { tipo: "sistema", nombre: "Sitio web" };
    await sb.from("lead_eventos").insert({ lead_id: lead.id, usuario_id: "sistema", usuario_nombre: "Sitio web", tipo: "creado", detalle: `Lead creado desde el sitio web${asignado ? ` y asignado a ${asignado.nombre}` : " (sin ejecutivos habilitados: queda sin asignar)"}. ${resumen}`.slice(0, 600) });

    // Visita: queda en la agenda del ejecutivo.
    if (s.tipo === "visita" && asignado) {
      await sb.from("tareas").insert({ lead_id: lead.id, asignado_a: asignado.id, local_id: local, titulo: `Visita pedida por el sitio web: ${vehTexto}`.slice(0, 120), tipo: "visita", vence_en: s.fechaHora });
    }
    // Vender o consignar: además queda una tasación esperando al Tasador.
    let folioTasacion: number | null = null;
    if (s.tipo === "vender") {
      const vt = vtWeb!;
      if (vt.ok) {
        const t = await sb.from("tasaciones").insert({
          local_id: local, tipo: "directa", contacto: { nombre: s.contacto.nombre, telefono: s.contacto.telefono }, vehiculo: vt.value, patente: vt.value.patente,
          estado: "pendiente", notas_solicitud: `${s.vende.modalidad === "consignar" ? "Quiere consignar" : "Quiere vender"} (pedido desde el sitio web). Espera $${Number(s.vende.precioEsperado).toLocaleString("es-CL")} · ${s.vende.duenos} dueño(s) · prenda: ${s.vende.prenda === "si" ? "sí" : "no"} · mantenciones en la marca: ${s.vende.mantenciones === "si" ? "sí" : "no"}.${s.mensaje ? ` ${s.mensaje}` : ""}`.slice(0, 300), creado_por: "sitio web",
        }).select().single();
        if (!t.error) folioTasacion = t.data.numero;
      }
    }
    await ctx.audit(sistema, "web.solicitud", "lead", lead.id, { tipo: s.tipo, vehiculo_id: vehiculo ? vehiculo.id : null, asignado: asignado ? asignado.nombre : null, ip: ctx.ip.slice(0, 45) });
    await avisarSolicitud({ s, lead, cliente, asignado, local, vehTexto, empresa: cfg.sitio_nombre });
    return json({ ok: true, cuota });
  }

  return err("unknown_op");
}
