// Gestión financiera de la empresa (módulo «Finanzas» del CRM).
//
// - El Administrador registra, corrige y anula los movimientos manuales (gastos, otros ingresos, aportes, retiros, traspasos)
//   y fija el saldo inicial de cada cuenta. El Jefe Local solo mira (lo de su local).
// - Los pagos que ya registra el CRM entran solos, sin copiarlos: pagos de ventas (cierre_pagos), pagos de reservas validados
//   (reservas) y pagos a dueños por compras (compra_pagos). Si en el CRM se anula un pago, deja de contar aquí.
// - No reemplaza la contabilidad oficial (la lleva el contador): ordena caja, bancos, resultados y rentabilidad.
import {
  validarMovimiento, calcularSaldos, flujoMensual, estadoResultados, rentabilidadVehiculo, periodo, categoriaFin, claveCaja, claveDe,
  POR_DEPOSITAR, CATEGORIAS_FIN, MAX_ARCHIVOS_FIN, NS_FIN, faltaRespaldo, gastosPorMes, gastosFijosPendientes,
} from "./finanzas-core.js";
import { validarArchivo } from "./validaciones-core.js";
import { etiquetaCuenta, medioNombre } from "./pagos-core.js";
import { validarTrabajador, armarNomina, parametrosNomina, CONCEPTOS_NOMINA, montoConcepto, VARIABLES_VACIAS } from "./nomina-core.js";

export type FinCtx = {
  sb: any;
  json: (data: unknown, status?: number) => Response;
  err: (error: string, status?: number) => Response;
  fallo: (e: any) => Response;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
  actor: any;
  userName: string;
  esAdmin: boolean;
  esSupervisor: boolean;
  localId: string | null;
  localParaCrear: () => Promise<string | null>;
  porIds: (tabla: string, ids: string[]) => Promise<any[]>;
  /** Comisiones del mes (ventas, compras, consignaciones e inspecciones) por id de usuario, según el CRM. */
  comisionesDelMes: (mes: string) => Promise<Record<string, number>>;
};

const hoyCL = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const fechaDe = (x: any) => String(x || "").slice(0, 10);
const folio = (pre: string, n: any) => `${pre}-${String(n ?? "").padStart(5, "0")}`;
const nombreVeh = (v: any) => (v ? `${v.marca ?? ""} ${v.modelo ?? ""}${v.anio ? ` ${v.anio}` : ""}${v.patente ? ` (${v.patente})` : ""}`.replace(/\s+/g, " ").trim() : "");

export async function finanzasOp(h: FinCtx, op: string, body: any): Promise<Response> {
  const { sb, json, err, fallo } = h;
  if (!h.esAdmin && !h.esSupervisor) return err("forbidden", 403);
  const puedeEditar = h.esAdmin;
  const local = h.localId;
  const scoped = (q: any) => (local ? q.eq("local_id", local) : q);
  const leer = async (q: any) => { const { data, error } = await q; if (error) throw error; return data ?? []; };

  /** Cuentas bancarias de la empresa visibles (las del local y las generales), más la caja y «por depositar». */
  async function cuentas() {
    const todas = await leer(sb.from("cuentas_empresa").select("*"));
    const vis = todas.filter((c: any) => !local || !c.local_id || c.local_id === local);
    const { data: locs } = await sb.from("locales").select("id, nombre, activo");
    const locales = (locs ?? []).filter((l: any) => (local ? l.id === local : l.activo));
    return [
      ...vis.map((c: any) => ({ clave: c.id, nombre: etiquetaCuenta(c), tipo: "banco", activa: c.activa !== false, local_id: c.local_id ?? null })),
      ...locales.map((l: any) => ({ clave: claveCaja(l.id), nombre: `Caja (efectivo)${locales.length > 1 ? ` · ${l.nombre}` : ""}`, tipo: "caja", activa: true, local_id: l.id })),
      { clave: POR_DEPOSITAR, nombre: "Por depositar (cheques, tarjetas y crédito)", tipo: "otros", activa: true, local_id: null },
    ];
  }

  /**
   * Todos los movimientos (manuales y automáticos del CRM), normalizados:
   * { id, origen, folio, fecha, tipo, categoria, monto, descripcion, contraparte, medio, cuenta_id, cuenta_destino_id, local_id, vehiculo_id, estado, ... }
   */
  async function movimientos({ conAnulados = false } = {}) {
    const [manuales, cpagos, reservas, kpagos] = await Promise.all([
      leer(scoped(sb.from("fin_movimientos").select("*"))),
      leer(scoped(sb.from("cierre_pagos").select("*").eq("estado", "vigente"))),
      leer(scoped(sb.from("reservas").select("*"))),
      leer(scoped(sb.from("compra_pagos").select("*").eq("estado", "vigente"))),
    ]);
    const [cierres, compras] = await Promise.all([
      h.porIds("cierres", cpagos.map((p: any) => p.cierre_id)),
      h.porIds("compras", kpagos.map((p: any) => p.compra_id)),
    ]);
    const cierreDe = new Map(cierres.map((c: any) => [c.id, c]));
    const compraDe = new Map(compras.map((c: any) => [c.id, c]));
    // Cuenta destino de un pago automático: la cuenta de la empresa; sin cuenta, la caja (efectivo) o «por depositar».
    const cuentaAuto = (p: any, medio: string) => p.cuenta_id || (medio === "efectivo" ? null : POR_DEPOSITAR);
    const out: any[] = [];
    for (const m of manuales) {
      if (!conAnulados && m.estado === "anulado") continue;
      out.push({ ...m, monto: Number(m.monto), origen: "manual", folio: folio("FIN", m.numero) });
    }
    for (const p of cpagos) {
      const c: any = cierreDe.get(p.cierre_id);
      if (!c || !["pendiente", "aprobada"].includes(c.estado)) continue;
      if (p.medio === "parte_pago") continue; // un auto recibido en parte de pago no es plata
      const veh = c.vehiculo_snapshot || {};
      out.push({
        id: `cp-${p.id}`, origen: "venta", folio: folio("VTA", c.numero), fecha: fechaDe(p.fecha_pago), tipo: "ingreso", categoria: "venta_vehiculo",
        monto: Number(p.monto), descripcion: `Venta ${nombreVeh(veh)} · ${medioNombre(p.medio)}`.trim(), contraparte: null, medio: p.medio,
        documento_numero: p.referencia || null, cuenta_id: cuentaAuto(p, p.medio), cuenta_destino_id: null, local_id: p.local_id ?? c.local_id ?? null,
        vehiculo_id: c.vehiculo_id, estado: "vigente",
      });
    }
    for (const r of reservas) {
      // Pago validado; las reservas antiguas (sin validación de pago) cuentan si siguieron su curso.
      const vale = r.pago_estado === "validado" || (!r.pago_estado && ["activa", "convertida", "vencida"].includes(r.estado));
      if (!vale || !(Number(r.monto) > 0)) continue;
      const medio = r.medio_pago || "efectivo";
      out.push({
        id: `rs-${r.id}`, origen: "reserva", folio: "Reserva", fecha: fechaDe(r.fecha_pago || r.creado_en), tipo: "ingreso", categoria: "reserva",
        monto: Number(r.monto), descripcion: `Pago de reserva · ${medioNombre(medio)}`, contraparte: null, medio, documento_numero: r.referencia || null,
        cuenta_id: cuentaAuto(r, medio), cuenta_destino_id: null, local_id: r.local_id ?? null, vehiculo_id: r.vehiculo_id, estado: "vigente",
      });
    }
    for (const p of kpagos) {
      const c: any = compraDe.get(p.compra_id);
      if (!c || !["pago_pendiente", "comprada"].includes(c.estado)) continue;
      const veh = { ...(c.vehiculo || {}), patente: c.patente || (c.vehiculo || {}).patente };
      out.push({
        id: `kp-${p.id}`, origen: "compra", folio: folio("CMP", c.numero), fecha: fechaDe(p.fecha_pago), tipo: "egreso", categoria: "compra_vehiculo",
        monto: Number(p.monto), descripcion: `Compra ${nombreVeh(veh)} · ${medioNombre(p.medio)}`.trim(), contraparte: null, medio: p.medio,
        documento_numero: p.referencia || null, cuenta_id: p.cuenta_id || (p.medio === "efectivo" ? null : POR_DEPOSITAR), cuenta_destino_id: null,
        local_id: p.local_id ?? c.local_id ?? null, vehiculo_id: c.vehiculo_id || null, estado: "vigente",
      });
    }
    out.sort((a, b) => (a.fecha === b.fecha ? String(b.creado_en || "").localeCompare(String(a.creado_en || "")) : b.fecha.localeCompare(a.fecha)));
    return out;
  }

  /** Saldos iniciales de las cuentas visibles (las cuentas generales no son de un local: se leen todas y se filtran por clave). */
  async function saldosIniciales(ctas: any[]) {
    const claves = new Set(ctas.map((c) => c.clave));
    return (await leer(sb.from("fin_saldos").select("*"))).filter((x: any) => claves.has(x.clave));
  }

  /** Gastos manuales asociados a cada vehículo (reparación, traslado, trámites): se suman a su costo. */
  function gastosPorVehiculo(movs: any[]) {
    const g: Record<string, number> = {};
    for (const m of movs) {
      if (m.origen !== "manual" || m.estado === "anulado" || m.tipo !== "egreso" || !m.vehiculo_id) continue;
      const cat = categoriaFin(m.categoria);
      if (cat && cat.vehiculo) g[m.vehiculo_id] = (g[m.vehiculo_id] || 0) + Number(m.monto);
    }
    return g;
  }

  /** Ventas aprobadas cuyo mes (AAAA-MM de la aprobación) cae en el período, con su costo completo. */
  async function ventasDelPeriodo(desde: string, hasta: string, gastos: Record<string, number>) {
    const cierres = (await leer(scoped(sb.from("cierres").select("*").eq("estado", "aprobada"))))
      .filter((c: any) => { const f = fechaDe(c.aprobado_en) || `${c.mes}-01`; return f >= desde && f <= hasta; });
    return cierres.map((c: any) => {
      const gastosV = gastos[c.vehiculo_id] || 0;
      const r = rentabilidadVehiculo({ costoCompra: Number(c.costo) || 0, gastos: gastosV, precioVenta: Number(c.precio_final) });
      return {
        id: c.id, folio: folio("VTA", c.numero), fecha: fechaDe(c.aprobado_en), vehiculo_id: c.vehiculo_id, vehiculo: nombreVeh(c.vehiculo_snapshot),
        precio: Number(c.precio_final), costoCompra: Number(c.costo) || 0, sinCosto: c.costo == null, gastos: gastosV, costo: r.invertido, margen: r.margen, margenPct: r.margenPct,
      };
    }).sort((a: any, b: any) => b.fecha.localeCompare(a.fecha));
  }

  /** Vehículos en stock (activos, no vendidos): lo invertido en los propios; los consignados no son de la empresa. */
  async function stock(gastos: Record<string, number>) {
    const vehs = (await leer(scoped(sb.from("vehiculos").select("*").eq("activo", true)))).filter((v: any) => v.estado !== "vendido");
    const hoy = hoyCL();
    return vehs.map((v: any) => {
      const consignado = v.origen === "consignacion";
      const gastosV = gastos[v.id] || 0;
      const invertido = consignado ? gastosV : (Number(v.costo) || 0) + gastosV;
      const dias = Math.max(0, Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(String(v.creado_en || hoy))) / 86400000));
      return {
        id: v.id, vehiculo: nombreVeh(v), estado: v.estado, consignado, costoCompra: consignado ? 0 : Number(v.costo) || 0, sinCosto: !consignado && v.costo == null,
        gastos: gastosV, invertido, precioLista: v.precio_lista != null ? Number(v.precio_lista) : null,
        margenEsperado: v.precio_lista != null ? Number(v.precio_lista) - (consignado ? (Number(v.costo) || 0) + gastosV : invertido) : null, dias,
      };
    }).sort((a: any, b: any) => b.dias - a.dias);
  }

  /** Lo que falta por cobrar de ventas (pendientes o aprobadas) y por pagar a dueños de compras y de autos consignados ya vendidos. */
  async function pendientes(movs: any[]) {
    const [cierres, compras, consigs] = await Promise.all([
      leer(scoped(sb.from("cierres").select("*").in("estado", ["pendiente", "aprobada"]))),
      leer(scoped(sb.from("compras").select("*").in("estado", ["pago_pendiente", "comprada"]))),
      leer(scoped(sb.from("consignaciones").select("*").eq("estado", "vendida"))),
    ]);
    const cpagos = cierres.length ? await leer(sb.from("cierre_pagos").select("*").in("cierre_id", cierres.map((c: any) => c.id)).eq("estado", "vigente")) : [];
    const resIds = cierres.map((c: any) => c.reserva_id).filter(Boolean);
    const reservas = resIds.length ? await h.porIds("reservas", resIds) : [];
    const resDe = new Map(reservas.map((r: any) => [r.id, r]));
    const porCobrar = cierres.map((c: any) => {
      const pagado = cpagos.filter((p: any) => p.cierre_id === c.id).reduce((s: number, p: any) => s + Number(p.monto), 0);
      const r: any = resDe.get(c.reserva_id);
      const reserva = r && (r.pago_estado === "validado" || !r.pago_estado) ? Number(c.reserva_monto) || 0 : 0;
      return { id: c.id, folio: folio("VTA", c.numero), vehiculo: nombreVeh(c.vehiculo_snapshot), estado: c.estado, precio: Number(c.precio_final), recibido: pagado + reserva, falta: Number(c.precio_final) - pagado - reserva };
    }).filter((x: any) => x.falta > 0);
    const kpagos = compras.length ? await leer(sb.from("compra_pagos").select("*").in("compra_id", compras.map((c: any) => c.id)).eq("estado", "vigente")) : [];
    const porPagar = compras.map((c: any) => {
      const pagado = kpagos.filter((p: any) => p.compra_id === c.id).reduce((s: number, p: any) => s + Number(p.monto), 0);
      const total = Number(c.monto_final ?? c.monto_oferta) || 0;
      return { id: c.id, folio: folio("CMP", c.numero), tipo: "compra", vehiculo: nombreVeh({ ...(c.vehiculo || {}), patente: c.patente }), total, pagado, falta: total - pagado };
    }).filter((x: any) => x.falta > 0);
    // Consignaciones vendidas: al dueño se le debe su precio piso, menos lo ya registrado como «Pago al dueño de un auto consignado».
    // Nóminas guardadas con pagos aún sin registrar (sueldos, Previred, impuesto único).
    const nominas = await leer(scoped(sb.from("fin_nominas").select("*")));
    for (const n of nominas) {
      for (const c of CONCEPTOS_NOMINA) {
        const total = montoConcepto(n.totales || {}, c.id);
        const pagado = movs.some((m) => m.origen === "manual" && m.nomina_id === n.id && m.nomina_concepto === c.id);
        if (total > 0 && !pagado) porPagar.push({ id: `${n.id}-${c.id}`, folio: `Nómina ${n.mes}`, tipo: "nomina", vehiculo: c.nombre, total, pagado: 0, falta: total });
      }
    }
    for (const c of consigs) {
      const pagado = movs.filter((m) => m.origen === "manual" && m.categoria === "pago_consignante" && m.vehiculo_id && m.vehiculo_id === c.vehiculo_id).reduce((s, m) => s + Number(m.monto), 0);
      const total = Number(c.precio_piso) || 0;
      if (total - pagado > 0) porPagar.push({ id: c.id, folio: folio("CNS", c.numero), tipo: "consignacion", vehiculo: nombreVeh({ ...(c.vehiculo || {}), patente: c.patente }), total, pagado, falta: total - pagado, vehiculo_id: c.vehiculo_id });
    }
    return { porCobrar, porPagar };
  }

  try {
    /* ---- Panorama: saldos, resultados del período, flujo de los últimos 12 meses, por cobrar y por pagar. ---- */
    if (op === "fin.resumen") {
      const hoy = hoyCL();
      const per = periodo(body.periodo) || periodo(hoy.slice(0, 7))!;
      const [movs, ctas] = await Promise.all([movimientos(), cuentas()]);
      const iniciales = await saldosIniciales(ctas);
      const saldos = calcularSaldos(iniciales, movs);
      const cuentasConSaldo = ctas.map((c) => ({ ...c, ...(saldos[c.clave] || { inicial: 0, desde: null, ingresos: 0, egresos: 0, saldo: 0 }), clave: c.clave }))
        .filter((c) => c.activa || c.saldo !== 0);
      // Cuentas que ya no se listan (por ejemplo, de otro local) pero tienen movimientos: no se pierden del total.
      for (const [clave, s] of Object.entries(saldos) as any) if (!cuentasConSaldo.some((c) => c.clave === clave) && s.saldo !== 0) cuentasConSaldo.push({ clave, nombre: "Otra cuenta", tipo: "banco", activa: false, local_id: null, ...s });
      const gastos = gastosPorVehiculo(movs);
      const ventas = await ventasDelPeriodo(per.desde, per.hasta, gastos);
      // Un gasto cuenta en el mes al que corresponde (la nómina de octubre pagada en noviembre es gasto de octubre).
      const manualesPer = movs.filter((m) => { const f = m.mes_resultado ? `${m.mes_resultado}-15` : m.fecha; return m.origen === "manual" && f >= per.desde && f <= per.hasta; });
      const resultados = estadoResultados({ ventas: ventas.map((v: any) => ({ precio: v.precio, costo: v.costo })), manuales: manualesPer });
      const flujo = flujoMensual(movs.filter((m) => m.fecha >= `${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4, 7)}-01`));
      const flujoPer = flujoMensual(movs.filter((m) => m.fecha >= per.desde && m.fecha <= per.hasta));
      const caja = { entradas: flujoPer.reduce((s, f) => s + f.entradas, 0), salidas: flujoPer.reduce((s, f) => s + f.salidas, 0) };
      const st = await stock(gastos);
      const pend = await pendientes(movs);
      return json({
        periodo: { ...per, valor: String(body.periodo || hoy.slice(0, 7)) }, puedeEditar,
        cuentas: cuentasConSaldo, saldoTotal: cuentasConSaldo.reduce((s, c) => s + c.saldo, 0),
        resultados, caja: { ...caja, neto: caja.entradas - caja.salidas }, flujo,
        stock: { unidades: st.filter((v: any) => !v.consignado).length, consignados: st.filter((v: any) => v.consignado).length, invertido: st.reduce((s: number, v: any) => s + v.invertido, 0) },
        porCobrar: pend.porCobrar, totalPorCobrar: pend.porCobrar.reduce((s: number, x: any) => s + x.falta, 0),
        porPagar: pend.porPagar, totalPorPagar: pend.porPagar.reduce((s: number, x: any) => s + x.falta, 0),
      });
    }

    /* ---- Libro de movimientos, con filtros. ---- */
    if (op === "fin.movimientos") {
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(body.desde || "")) ? String(body.desde) : "0000-01-01";
      const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(body.hasta || "")) ? String(body.hasta) : "9999-12-31";
      const [movs, ctas] = await Promise.all([movimientos({ conAnulados: !!body.conAnulados }), cuentas()]);
      const q = String(body.q || "").trim().toLowerCase();
      const lista = movs.filter((m) => m.fecha >= desde && m.fecha <= hasta)
        .filter((m) => !body.tipo || m.tipo === body.tipo)
        .filter((m) => !body.categoria || m.categoria === body.categoria)
        .filter((m) => !body.origen || (body.origen === "manual" ? m.origen === "manual" : m.origen !== "manual"))
        .filter((m) => !body.cuenta || claveDe(m.cuenta_id, m.local_id) === body.cuenta || (m.tipo === "traspaso" && claveDe(m.cuenta_destino_id, m.local_id) === body.cuenta))
        .filter((m) => !body.sinRespaldo || faltaRespaldo(m))
        .filter((m) => !q || [m.descripcion, m.contraparte, m.documento_numero, m.folio, (categoriaFin(m.categoria) || {}).nombre].some((x) => String(x || "").toLowerCase().includes(q)));
      const vig = lista.filter((m) => m.estado !== "anulado");
      const vehIds = Array.from(new Set(lista.map((m) => m.vehiculo_id).filter(Boolean)));
      const vehs = vehIds.length ? await h.porIds("vehiculos", vehIds as string[]) : [];
      const vehDe = new Map(vehs.map((v: any) => [v.id, nombreVeh(v)]));
      return json({
        movimientos: lista.slice(0, 2000).map((m) => ({ ...m, vehiculo: m.vehiculo_id ? vehDe.get(m.vehiculo_id) || null : null })),
        total: lista.length,
        ingresos: vig.filter((m) => m.tipo === "ingreso").reduce((s, m) => s + m.monto, 0),
        egresos: vig.filter((m) => m.tipo === "egreso").reduce((s, m) => s + m.monto, 0),
        sinRespaldo: lista.filter(faltaRespaldo).length,
        cuentas: ctas, puedeEditar,
      });
    }

    /* ---- Vehículos para asociar un gasto (los activos y los vendidos en los últimos meses). ---- */
    if (op === "fin.vehiculos") {
      const vehs = await leer(scoped(sb.from("vehiculos").select("*").eq("activo", true)));
      return json({ vehiculos: vehs.map((v: any) => ({ id: v.id, nombre: nombreVeh(v), estado: v.estado, consignado: v.origen === "consignacion" })).sort((a: any, b: any) => a.nombre.localeCompare(b.nombre)) });
    }

    /* ---- Rentabilidad: ventas del período (precio, costo completo y margen) y lo invertido en el stock. ---- */
    if (op === "fin.rentabilidad") {
      const hoy = hoyCL();
      const per = periodo(body.periodo) || periodo(hoy.slice(0, 7))!;
      const movs = await movimientos();
      const gastos = gastosPorVehiculo(movs);
      const [ventas, st] = await Promise.all([ventasDelPeriodo(per.desde, per.hasta, gastos), stock(gastos)]);
      const total = ventas.reduce((s: number, v: any) => s + v.precio, 0);
      const margen = ventas.reduce((s: number, v: any) => s + v.margen, 0);
      return json({
        periodo: { ...per, valor: String(body.periodo || hoy.slice(0, 7)) }, ventas, stock: st,
        totales: { unidades: ventas.length, ventas: total, margen, margenPct: total > 0 ? Math.round((margen / total) * 1000) / 10 : null, promedio: ventas.length ? Math.round(margen / ventas.length) : null },
      });
    }

    /* ---- Lo que sigue solo lo hace el Administrador. ---- */
    if (op === "fin.mov_guardar") {
      if (!puedeEditar) return err("forbidden", 403);
      const v = validarMovimiento(body.mov, { hoy: hoyCL() });
      if (!v.ok) return err(v.error!);
      // Respaldos (factura, boleta, comprobante): ya subidos al almacén bajo dval::fin-<uuid>::<archivo>; aquí solo se anotan.
      let archivos: any[] | undefined;
      if (Array.isArray(body.archivos)) {
        archivos = [];
        for (const a of body.archivos) {
          const r = validarArchivo(a);
          if (!r.ok) return err(r.error!);
          if (!NS_FIN.test(String(a.v || ""))) return err("archivo_invalido");
          archivos.push({ ...r.value, v: String(a.v) });
        }
        if (archivos.length > MAX_ARCHIVOS_FIN) return err("demasiados_archivos");
      }
      const ahora = new Date().toISOString();
      if (archivos) (v.value as any).archivos = archivos;
      if (body.id) {
        const { data: antes } = await sb.from("fin_movimientos").select("*").eq("id", String(body.id)).maybeSingle();
        if (!antes || (local && antes.local_id !== local)) return err("no_existe", 404);
        if (antes.estado === "anulado") return err("fin_anulado", 409);
        const { data, error } = await sb.from("fin_movimientos").update({ ...v.value, editado_por: h.userName, actualizado_en: ahora }).eq("id", antes.id).select().single();
        if (error) return fallo(error);
        await h.audit(h.actor, "finanzas.editar", "fin_movimiento", antes.id, { antes: { monto: antes.monto, categoria: antes.categoria, fecha: antes.fecha }, despues: { monto: data.monto, categoria: data.categoria, fecha: data.fecha } });
        return json({ movimiento: data });
      }
      const loc = await h.localParaCrear();
      if (!loc) return err("sin_local");
      const { data, error } = await sb.from("fin_movimientos").insert({ ...v.value, local_id: loc, estado: "vigente", registrado_por: h.userName, creado_en: ahora, actualizado_en: ahora }).select().single();
      if (error) return fallo(error);
      await h.audit(h.actor, "finanzas.registrar", "fin_movimiento", data.id, { tipo: data.tipo, categoria: data.categoria, monto: data.monto, fecha: data.fecha, respaldos: (data.archivos || []).length });
      return json({ movimiento: data });
    }

    /** Gastos del negocio por categoría y mes (los últimos N meses hasta «hasta»), y cuántos movimientos no tienen respaldo. */
    if (op === "fin.gastos") {
      const hasta = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.hasta || "")) ? String(body.hasta) : hoyCL().slice(0, 7);
      const n = Math.min(12, Math.max(1, Number(body.meses) || 6));
      const meses: string[] = [];
      let [a, m] = hasta.split("-").map(Number);
      for (let i = 0; i < n; i++) { meses.unshift(`${a}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; a--; } }
      const movs = (await movimientos()).filter((x) => x.origen === "manual");
      const sin = movs.filter(faltaRespaldo);
      return json({
        ...gastosPorMes(movs, meses), puedeEditar, cuentas: await cuentas(),
        sinRespaldo: { cantidad: sin.length, monto: sin.reduce((s, x) => s + x.monto, 0) },
        fijosPendientes: gastosFijosPendientes(movs, hasta).length,
      });
    }

    /** Gastos fijos (marcados «se repite cada mes») que aún no se registran en el mes. */
    if (op === "fin.fijos") {
      const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.mes || "")) ? String(body.mes) : hoyCL().slice(0, 7);
      const movs = (await movimientos()).filter((x) => x.origen === "manual");
      return json({ mes, pendientes: gastosFijosPendientes(movs, mes), puedeEditar, cuentas: await cuentas() });
    }

    if (op === "fin.mov_anular") {
      if (!puedeEditar) return err("forbidden", 403);
      const motivo = String(body.motivo ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (motivo.length < 3) return err("fin_motivo");
      const { data: m } = await sb.from("fin_movimientos").select("*").eq("id", String(body.id ?? "")).maybeSingle();
      if (!m || (local && m.local_id !== local)) return err("no_existe", 404);
      if (m.estado === "anulado") return err("fin_anulado", 409);
      const ahora = new Date().toISOString();
      const up = await sb.from("fin_movimientos").update({ estado: "anulado", anulado_por: h.userName, anulado_en: ahora, motivo_anulacion: motivo, actualizado_en: ahora }).eq("id", m.id);
      if (up.error) return fallo(up.error);
      await h.audit(h.actor, "finanzas.anular", "fin_movimiento", m.id, { monto: m.monto, categoria: m.categoria, motivo });
      return json({ ok: true });
    }

    /** Saldo inicial de una cuenta (lo que tenía el día desde el que se empieza a llevar en el CRM). */
    if (op === "fin.saldo_guardar") {
      if (!puedeEditar) return err("forbidden", 403);
      const clave = String(body.clave ?? "");
      const ctas = await cuentas();
      const cta = ctas.find((c) => c.clave === clave);
      if (!cta) return err("no_existe", 404);
      const saldo = Math.round(Number(body.saldoInicial));
      if (!Number.isFinite(saldo) || Math.abs(saldo) > 100_000_000_000) return err("fin_monto");
      const desde = String(body.desde ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || desde > hoyCL()) return err("fin_fecha");
      const ahora = new Date().toISOString();
      const fila = { clave, local_id: cta.local_id ?? local ?? null, saldo_inicial: saldo, desde, actualizado_por: h.userName, actualizado_en: ahora };
      const { data: existe } = await sb.from("fin_saldos").select("clave").eq("clave", clave).maybeSingle();
      const r = existe ? await sb.from("fin_saldos").update(fila).eq("clave", clave) : await sb.from("fin_saldos").insert(fila);
      if (r.error) return fallo(r.error);
      await h.audit(h.actor, "finanzas.saldo_inicial", "fin_saldo", clave, { saldo, desde });
      return json({ ok: true });
    }

    if (op === "fin.categorias") return json({ categorias: CATEGORIAS_FIN, puedeEditar });

    /* ================= Nómina ================= */
    const esMesValido = (m: any) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));

    /** Trabajadores (fichas) del local y personas del equipo del CRM que aún no tienen ficha. */
    if (op === "fin.trabajadores") {
      const loc = local ?? (await h.localParaCrear());
      const trabajadores = loc ? await leer(sb.from("fin_trabajadores").select("*").eq("local_id", loc)) : [];
      const usuarios = loc ? await leer(sb.from("usuarios").select("id, nombre, rut, activo, local_id").eq("local_id", loc)) : [];
      const conFicha = new Set(trabajadores.map((t: any) => t.usuario_id).filter(Boolean));
      return json({
        trabajadores: trabajadores.sort((a: any, b: any) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre)),
        equipo: usuarios.filter((u: any) => u.activo && !conFicha.has(u.id)).map((u: any) => ({ id: u.id, nombre: u.nombre, rut: u.rut })),
        puedeEditar,
      });
    }

    if (op === "fin.trabajador_guardar") {
      if (!puedeEditar) return err("forbidden", 403);
      const v = validarTrabajador(body.trabajador);
      if (!v.ok) return err(v.error!);
      const ahora = new Date().toISOString();
      if (body.id) {
        const { data: t } = await sb.from("fin_trabajadores").select("*").eq("id", String(body.id)).maybeSingle();
        if (!t || (local && t.local_id !== local)) return err("no_existe", 404);
        const { data, error } = await sb.from("fin_trabajadores").update({ ...v.value, actualizado_en: ahora }).eq("id", t.id).select().single();
        if (error) return fallo(error);
        await h.audit(h.actor, "finanzas.trabajador_editar", "fin_trabajador", t.id, { nombre: data.nombre, sueldoBase: data.ficha.sueldoBase, activo: data.activo });
        return json({ trabajador: data });
      }
      const loc = await h.localParaCrear();
      if (!loc) return err("sin_local");
      const { data, error } = await sb.from("fin_trabajadores").insert({ ...v.value, local_id: loc, creado_en: ahora, actualizado_en: ahora }).select().single();
      if (error) return fallo(error);
      await h.audit(h.actor, "finanzas.trabajador_crear", "fin_trabajador", data.id, { nombre: data.nombre, sueldoBase: data.ficha.sueldoBase });
      return json({ trabajador: data });
    }

    /** Pagos registrados de una nómina, por concepto. */
    async function pagosNomina(nominaId: string) {
      const movs = await leer(sb.from("fin_movimientos").select("*").eq("nomina_id", nominaId).eq("estado", "vigente"));
      const out: Record<string, any> = {};
      for (const c of CONCEPTOS_NOMINA) {
        const suyos = movs.filter((m: any) => m.nomina_concepto === c.id);
        out[c.id] = suyos.length ? { pagado: true, fecha: suyos[0].fecha, monto: suyos.reduce((s: number, m: any) => s + Number(m.monto), 0), cuenta_id: suyos[0].cuenta_id, movimientos: suyos.length } : { pagado: false };
      }
      return out;
    }

    /** La nómina del mes: la guardada o, si no hay, una propuesta con los trabajadores activos y las comisiones del CRM. */
    if (op === "fin.nomina") {
      const mes = String(body.mes || "");
      if (!esMesValido(mes)) return err("mes_invalido");
      const loc = local ?? (await h.localParaCrear());
      if (!loc) return err("sin_local");
      const [nomQ, trabajadores, comisiones] = await Promise.all([
        leer(sb.from("fin_nominas").select("*").eq("local_id", loc).eq("mes", mes)),
        leer(sb.from("fin_trabajadores").select("*").eq("local_id", loc)),
        h.comisionesDelMes(mes).catch(() => ({} as Record<string, number>)),
      ]);
      const comisionDe = (t: any) => (t.usuario_id ? Math.round(comisiones[t.usuario_id] || 0) : 0);
      const sugeridas: Record<string, number> = {};
      for (const t of trabajadores) sugeridas[t.id] = comisionDe(t);
      const nomina = nomQ[0] || null;
      if (nomina) return json({ mes, nomina, pagos: await pagosNomina(nomina.id), trabajadores, comisionesCrm: sugeridas, puedeEditar });
      const activos = trabajadores.filter((t: any) => t.activo);
      const propuesta = activos.length ? armarNomina({
        parametros: parametrosNomina(),
        filas: activos.map((t: any) => ({ trabajadorId: t.id, nombre: t.nombre, rut: t.rut, ficha: t.ficha, variables: { ...VARIABLES_VACIAS, comisiones: comisionDe(t) } })),
      }) : null;
      return json({ mes, nomina: null, propuesta: propuesta && propuesta.ok ? propuesta.value : null, trabajadores, comisionesCrm: sugeridas, puedeEditar });
    }

    if (op === "fin.nomina_guardar") {
      if (!puedeEditar) return err("forbidden", 403);
      const mes = String(body.mes || "");
      if (!esMesValido(mes) || mes > hoyCL().slice(0, 7)) return err("mes_invalido");
      const loc = await h.localParaCrear();
      if (!loc) return err("sin_local");
      // Los datos fijos salen de la ficha guardada del trabajador; de la pantalla solo vienen las variables del mes.
      const trabajadores = await leer(sb.from("fin_trabajadores").select("*").eq("local_id", loc));
      const filasIn: any[] = Array.isArray(body.filas) ? body.filas : [];
      const filas = [];
      for (const f of filasIn) {
        const t = trabajadores.find((x: any) => x.id === f.trabajadorId);
        if (!t) return err("nomina_filas");
        filas.push({ trabajadorId: t.id, nombre: t.nombre, rut: t.rut, ficha: t.ficha, variables: f.variables });
      }
      const v = armarNomina({ filas, parametros: body.parametros });
      if (!v.ok) return err(v.error!);
      const ahora = new Date().toISOString();
      const existente = (await leer(sb.from("fin_nominas").select("*").eq("local_id", loc).eq("mes", mes)))[0];
      if (existente) {
        const pagos = await pagosNomina(existente.id);
        if (Object.values(pagos).some((p: any) => p.pagado)) return err("fin_nomina_pagada", 409);
        const { data, error } = await sb.from("fin_nominas").update({ filas: v.value.filas, parametros: v.value.parametros, totales: v.value.totales, actualizado_por: h.userName, actualizado_en: ahora }).eq("id", existente.id).select().single();
        if (error) return fallo(error);
        await h.audit(h.actor, "finanzas.nomina_guardar", "fin_nomina", data.id, { mes, costoEmpresa: v.value.totales.costoEmpresa });
        return json({ nomina: data });
      }
      const { data, error } = await sb.from("fin_nominas").insert({ local_id: loc, mes, filas: v.value.filas, parametros: v.value.parametros, totales: v.value.totales, actualizado_por: h.userName, creado_en: ahora, actualizado_en: ahora }).select().single();
      if (error) return fallo(error);
      await h.audit(h.actor, "finanzas.nomina_guardar", "fin_nomina", data.id, { mes, costoEmpresa: v.value.totales.costoEmpresa });
      return json({ nomina: data });
    }

    /** Registra un pago de la nómina: crea los egresos (uno por trabajador para los sueldos; uno para Previred; uno para el impuesto). */
    if (op === "fin.nomina_pagar") {
      if (!puedeEditar) return err("forbidden", 403);
      const mes = String(body.mes || "");
      const concepto = CONCEPTOS_NOMINA.find((c) => c.id === body.concepto);
      if (!esMesValido(mes) || !concepto) return err("nomina_filas");
      const loc = await h.localParaCrear();
      if (!loc) return err("sin_local");
      const n = (await leer(sb.from("fin_nominas").select("*").eq("local_id", loc).eq("mes", mes)))[0];
      if (!n) return err("nomina_sin_guardar", 409);
      const pagos = await pagosNomina(n.id);
      if (pagos[concepto.id].pagado) return err("fin_nomina_pagada", 409);
      const cuentaId = String(body.cuentaId || "") || null;
      const base = { tipo: "egreso", categoria: "sueldos", fecha: String(body.fecha || ""), cuentaId, medio: cuentaId ? "transferencia" : "efectivo", documentoTipo: "comprobante" };
      const items = concepto.id === "sueldos"
        ? (n.filas || []).filter((f: any) => f.resultado.liquido > 0).map((f: any) => ({ ...base, monto: f.resultado.liquido, descripcion: `Sueldo líquido ${mes} · ${f.nombre}`, contraparte: f.nombre }))
        : [{ ...base, monto: montoConcepto(n.totales, concepto.id), descripcion: `${concepto.nombre} · nómina ${mes}`, contraparte: concepto.id === "previred" ? "Previred" : "Servicio de Impuestos Internos" }];
      const filas: any[] = [];
      for (const it of items) {
        if (!(it.monto > 0)) continue;
        const v = validarMovimiento(it, { hoy: hoyCL() });
        if (!v.ok) return err(v.error!);
        filas.push({ ...v.value, local_id: loc, estado: "vigente", registrado_por: h.userName, nomina_id: n.id, nomina_concepto: concepto.id, mes_resultado: mes });
      }
      if (filas.length === 0) return err("fin_monto");
      const ahora = new Date().toISOString();
      const { error } = await sb.from("fin_movimientos").insert(filas.map((f) => ({ ...f, creado_en: ahora, actualizado_en: ahora })));
      if (error) return fallo(error);
      await h.audit(h.actor, "finanzas.nomina_pagar", "fin_nomina", n.id, { mes, concepto: concepto.id, monto: filas.reduce((s, f) => s + f.monto, 0), movimientos: filas.length });
      return json({ ok: true, movimientos: filas.length });
    }
    return err("unknown_op");
  } catch (e) {
    return fallo(e);
  }
}
