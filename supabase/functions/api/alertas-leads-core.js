// Alertas de plazos de los leads (por correo) y carga de trabajo del equipo. Funciones puras (se prueban sin servidor).
import { esSinAtender, esDetenido, ETAPAS_CERRADAS } from "./ventas-core.js";

export const TIPOS_ALERTA = ["primer_contacto", "sin_contacto", "detenido"];

/**
 * Qué alertas hay que mandar ahora. Cada alerta se manda una sola vez por lead (`enviadas` = Set de «leadId|tipo»).
 *  - primer_contacto: lead nuevo sin contacto pasado el plazo del ejecutivo → al ejecutivo (si no tiene, a los Jefes del local).
 *  - sin_contacto: sigue sin contacto pasado el plazo del Jefe → a los Jefes del local.
 *  - detenido: abierto sin actividad por los días configurados → al ejecutivo (si no tiene, a los Jefes).
 * `jefesPorLocal`: Map local → [ids]. Devuelve [{ leadId, tipo, para: [ids] }].
 */
export function alertasPendientes({ leads, jefesPorLocal, ahora = new Date(), cfg, enviadas = new Set() }) {
  const out = [];
  for (const l of leads) {
    if (ETAPAS_CERRADAS.includes(l.etapa)) continue;
    const jefes = (jefesPorLocal && jefesPorLocal.get(l.local_id)) || [];
    const dueno = l.asignado_a ? [l.asignado_a] : jefes;
    const poner = (tipo, para) => { if (!enviadas.has(`${l.id}|${tipo}`) && para.length) out.push({ leadId: l.id, tipo, para: Array.from(new Set(para)) }); };
    if (esSinAtender(l, ahora, cfg.horas_primer_contacto)) poner("primer_contacto", dueno);
    if (esSinAtender(l, ahora, cfg.horas_sin_contacto)) poner("sin_contacto", jefes);
    if (esDetenido(l, ahora, cfg.dias_detenido)) poner("detenido", dueno);
  }
  return out;
}

/** Agrupa las alertas por persona: Map id → { primer_contacto: [leadId], sin_contacto: [...], detenido: [...] }. */
export function agruparPorDestinatario(alertas) {
  const m = new Map();
  for (const a of alertas) for (const id of a.para) {
    const g = m.get(id) || { primer_contacto: [], sin_contacto: [], detenido: [] };
    g[a.tipo].push(a.leadId);
    m.set(id, g);
  }
  return m;
}

const TEXTO = {
  primer_contacto: (n, h) => `${n} lead${n === 1 ? "" : "s"} nuevo${n === 1 ? "" : "s"} sin primer contacto (plazo: ${h} h)`,
  sin_contacto: (n, h) => `${n} lead${n === 1 ? "" : "s"} de tu local sin atender hace más de ${h} h`,
  detenido: (n, d) => `${n} lead${n === 1 ? "" : "s"} detenido${n === 1 ? "" : "s"} sin actividad hace ${d} días o más`,
};

/** Líneas del correo resumen de una persona (con los nombres de los clientes que se pasen en `nombres`: Map leadId → texto). */
export function lineasDeAlerta(grupo, cfg, nombres = new Map()) {
  const lineas = [];
  const plazos = { primer_contacto: cfg.horas_primer_contacto, sin_contacto: cfg.horas_sin_contacto, detenido: cfg.dias_detenido };
  for (const tipo of TIPOS_ALERTA) {
    const ids = grupo[tipo];
    if (!ids.length) continue;
    lineas.push(`${TEXTO[tipo](ids.length, plazos[tipo])}:`);
    const quien = ids.slice(0, 8).map((id) => `• ${nombres.get(id) || "Cliente"}`);
    lineas.push(...quien);
    if (ids.length > 8) lineas.push(`… y ${ids.length - 8} más.`);
  }
  return lineas;
}

/**
 * Carga de trabajo por ejecutivo: leads abiertos, por atender (sin primer contacto), sin próxima acción, con acción vencida, detenidos.
 * `tareasPendientes`: tareas no hechas con lead_id y vence_en.
 */
export function cargaDelEquipo({ ejecutivos, leads, tareasPendientes, ahora = new Date(), cfg }) {
  const proxPorLead = new Map();
  for (const t of tareasPendientes || []) if (t.lead_id) {
    const prev = proxPorLead.get(t.lead_id);
    if (!prev || Date.parse(t.vence_en) < Date.parse(prev.vence_en)) proxPorLead.set(t.lead_id, t);
  }
  const fila = (id, nombre) => ({ id, nombre, abiertos: 0, porAtender: 0, atrasadosContacto: 0, sinProxima: 0, vencidas: 0, detenidos: 0, porTipo: { venta: 0, compra: 0, consignacion: 0 } });
  const por = new Map(ejecutivos.map((e) => [e.id, fila(e.id, e.nombre)]));
  const sin = fila("", "Sin asignar");
  for (const l of leads) {
    if (ETAPAS_CERRADAS.includes(l.etapa)) continue;
    const f = por.get(l.asignado_a) || (l.asignado_a ? null : sin);
    if (!f) continue;
    f.abiertos++;
    f.porTipo[l.tipo || "venta"] = (f.porTipo[l.tipo || "venta"] || 0) + 1;
    if (l.etapa === "nuevo" && !l.ultimo_contacto) { f.porAtender++; if (esSinAtender(l, ahora, cfg.horas_primer_contacto)) f.atrasadosContacto++; }
    const p = proxPorLead.get(l.id);
    if (!p) f.sinProxima++; else if (Date.parse(p.vence_en) < ahora.getTime()) f.vencidas++;
    if (esDetenido(l, ahora, cfg.dias_detenido)) f.detenidos++;
  }
  const filas = [...por.values()].sort((a, b) => (b.atrasadosContacto + b.vencidas + b.detenidos) - (a.atrasadosContacto + a.vencidas + a.detenidos) || b.abiertos - a.abiertos || a.nombre.localeCompare(b.nombre, "es"));
  return { filas, sinAsignar: sin.abiertos ? sin : null };
}
