// Prospección en Chileautos (lado servidor): guarda los avisos que la persona eligió, lleva su estado y los enlaza con el lead cuando el dueño
// responde. El servidor NO consulta Chileautos: los avisos llegan copiados desde el navegador de la persona (ver prospectos-core.js).
import { validarAvisos, validarEstadoProspecto, ESTADOS_PROSPECTO, FUENTE_PROSPECTO } from "./prospectos-core.js";

export type HerramientasProspectos = {
  sb: any; json: (d: unknown, s?: number) => Response; err: (e: string, s?: number) => Response; fallo: (e: any) => Response;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
  actor: any; userId: string; userName: string; esAdmin: boolean;
  /** ¿Puede prospectar? (compras, consignaciones, supervisores y el Administrador). */
  puede: boolean;
  /** Local donde se guardan los prospectos. */
  local: () => Promise<string | null>;
};

export async function prospectosOp(h: HerramientasProspectos, op: string, body: any): Promise<Response> {
  const { sb, json, err, fallo } = h;
  if (!h.puede) return err("forbidden", 403);
  const local = await h.local();
  if (!local) return err("sin_local");

  /** Prospectos del local, los más recientes primero. */
  if (op === "prospectos.lista") {
    const q = await sb.from("prospectos").select("*").eq("local_id", local).eq("fuente", FUENTE_PROSPECTO);
    if (q.error) return fallo(q.error);
    const estado = body.estado ? String(body.estado) : "";
    const lista = (q.data ?? []).filter((p: any) => !estado || p.estado === estado).sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en))).slice(0, 500);
    const por: Record<string, number> = {};
    for (const p of q.data ?? []) por[p.estado] = (por[p.estado] || 0) + 1;
    return json({ prospectos: lista, estados: ESTADOS_PROSPECTO, conteo: por });
  }

  /** Guarda los avisos elegidos (los que ya estaban guardados no se repiten). */
  if (op === "prospectos.guardar") {
    const v = validarAvisos(body.avisos);
    if (!v.ok) return err(v.error!);
    const ex = await sb.from("prospectos").select("aviso_id").eq("local_id", local).eq("fuente", FUENTE_PROSPECTO);
    if (ex.error) return fallo(ex.error);
    const ya = new Set((ex.data ?? []).map((p: any) => p.aviso_id));
    const nuevos = v.value.filter((a: any) => !ya.has(a.aviso_id));
    if (nuevos.length) {
      const ins = await sb.from("prospectos").insert(nuevos.map((a: any) => ({ ...a, fuente: FUENTE_PROSPECTO, local_id: local, estado: "nuevo", creado_por: h.esAdmin ? null : h.userId })));
      if (ins.error) return fallo(ins.error);
    }
    await h.audit(h.actor, "prospectos.guardar", "prospecto", undefined, { nuevos: nuevos.length, repetidos: v.value.length - nuevos.length });
    return json({ nuevos: nuevos.length, repetidos: v.value.length - nuevos.length, descartados: v.descartados });
  }

  /** Cambia el estado (y las notas) de un prospecto. «Convertido» lo pone solo la conversión en lead. */
  if (op === "prospectos.estado") {
    const v = validarEstadoProspecto(body);
    if (!v.ok) return err(v.error!);
    const p = (await sb.from("prospectos").select("*").eq("id", String(body.id ?? "")).maybeSingle()).data;
    if (!p || p.local_id !== local) return err("no_existe", 404);
    if (p.estado === "convertido") return err("prospecto_convertido");
    const up = await sb.from("prospectos").update({ ...v.value, actualizado_en: new Date().toISOString() }).eq("id", p.id).select().single();
    if (up.error) return fallo(up.error);
    return json({ prospecto: up.data });
  }

  /** Enlaza el prospecto con el lead que se creó cuando el dueño respondió (el lead lo crea «leads.create»). */
  if (op === "prospectos.convertido") {
    const p = (await sb.from("prospectos").select("*").eq("id", String(body.id ?? "")).maybeSingle()).data;
    if (!p || p.local_id !== local) return err("no_existe", 404);
    const l = (await sb.from("leads").select("id, local_id").eq("id", String(body.leadId ?? "")).maybeSingle()).data;
    if (!l || l.local_id !== local) return err("lead_invalido");
    const up = await sb.from("prospectos").update({ estado: "convertido", lead_id: l.id, actualizado_en: new Date().toISOString() }).eq("id", p.id).select().single();
    if (up.error) return fallo(up.error);
    await h.audit(h.actor, "prospectos.convertir", "prospecto", p.id, { lead_id: l.id });
    return json({ prospecto: up.data });
  }

  return err("op_desconocida", 404);
}
