// Alertas de plazos de leads por correo. Las dispara una tarea programada (pg_cron, cada 30 minutos) llamando a la función con el secreto CRON_SECRET.
// Cada alerta sale una sola vez por lead y tipo (tabla alertas_leads); si el correo no está configurado, no hace nada.
import { alertasPendientes, agruparPorDestinatario, lineasDeAlerta } from "./alertas-leads-core.js";
import { configCompleta, permisosEfectivos } from "./crm-core.js";
import { correoActivo, enviarAviso } from "./correo.ts";

type Ctx = { sb: any; rolePermOverrides: () => Promise<Record<string, string[]>>; audit: (...a: any[]) => Promise<unknown> };

const ASUNTO: Record<string, string> = { primer_contacto: "Lead nuevo sin primer contacto", sin_contacto: "Leads sin atender en tu local", detenido: "Leads detenidos" };

export async function correrAlertas({ sb, rolePermOverrides, audit }: Ctx) {
  if (!correoActivo()) return { enviados: 0, alertas: 0, motivo: "correo_no_configurado" };
  const ahora = new Date();
  const { data: cfgRows, error: ce } = await sb.from("config_negocio").select("clave, valor");
  if (ce) throw ce;
  const guardada: Record<string, unknown> = {};
  for (const r of cfgRows ?? []) guardada[r.clave] = r.valor;
  const cfg = configCompleta(guardada);

  const { data: todosLeads, error: le } = await sb.from("leads").select("*");
  if (le) throw le;
  const leads = (todosLeads ?? []).filter((l: any) => l.etapa !== "ganado" && l.etapa !== "perdido");
  const { data: usuarios, error: ue } = await sb.from("usuarios").select("id, nombre, email, roles, permisos_extra, activo, local_id");
  if (ue) throw ue;
  const { data: previas, error: pe } = await sb.from("alertas_leads").select("lead_id, tipo");
  if (pe) throw pe; // sin la tabla (SQL pendiente) no se manda nada: evita repetir correos
  const enviadas = new Set<string>((previas ?? []).map((p: any) => `${p.lead_id}|${p.tipo}`));

  const overrides = await rolePermOverrides();
  const activos = (usuarios ?? []).filter((u: any) => u.activo);
  const jefesPorLocal = new Map<string, string[]>();
  for (const u of activos) if (permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("leads.asignar")) jefesPorLocal.set(u.local_id, [...(jefesPorLocal.get(u.local_id) ?? []), u.id]);

  const alertas = alertasPendientes({ leads: leads ?? [], jefesPorLocal, ahora, cfg, enviadas });
  if (alertas.length === 0) return { enviados: 0, alertas: 0 };

  const idsClientes = Array.from(new Set((leads ?? []).filter((l: any) => alertas.some((a) => a.leadId === l.id)).map((l: any) => l.cliente_id).filter(Boolean)));
  const clientes = new Map<string, string>();
  for (let i = 0; i < idsClientes.length; i += 100) {
    const { data } = await sb.from("clientes").select("id, nombre").in("id", idsClientes.slice(i, i + 100));
    for (const c of data ?? []) clientes.set(c.id, c.nombre);
  }
  const nombres = new Map<string, string>();
  for (const l of leads ?? []) nombres.set(l.id, clientes.get(l.cliente_id) ?? "Cliente");

  let enviados = 0;
  const porPersona = agruparPorDestinatario(alertas);
  for (const [id, grupo] of porPersona) {
    const u = activos.find((x: any) => x.id === id);
    if (!u || !u.email) continue;
    const lineas = lineasDeAlerta(grupo, cfg, nombres);
    const tipos = Object.keys(grupo).filter((t) => (grupo as any)[t].length);
    const asunto = tipos.length === 1 ? ASUNTO[tipos[0]] : "Leads que necesitan atención";
    enviados += await enviarAviso({ para: [u.email], asunto, titulo: asunto, lineas: [...lineas, "Entra a «Hoy» en la plataforma para verlos por urgencia."], ruta: "/plataforma" },
      (error) => audit({ tipo: "sistema", nombre: "Alertas de plazos" }, "aviso.fallido", "aviso", undefined, { asunto, error }));
  }
  // Se marcan como avisadas solo las alertas que llegaron a alguien con correo (las demás se reintentan en la próxima vuelta).
  const conCorreo = new Set(activos.filter((u: any) => u.email).map((u: any) => u.id));
  const marcar = alertas.filter((a) => a.para.some((id) => conCorreo.has(id))).map((a) => ({ lead_id: a.leadId, tipo: a.tipo }));
  if (enviados > 0 && marcar.length) {
    const ins = await sb.from("alertas_leads").insert(marcar);
    if (ins.error) console.error("alertas_leads:", ins.error.message);
  }
  await audit({ tipo: "sistema", nombre: "Alertas de plazos" }, "alertas.enviar", "aviso", undefined, { correos: enviados, alertas: alertas.length });
  return { enviados, alertas: alertas.length };
}
