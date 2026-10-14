/**
 * CIERRE DE VENTA, COMISIONES Y METAS (CRM · entrega 2C)
 * ----------------------------------------------------------------
 * - El ejecutivo pide el cierre desde la ficha de un lead reservado; el Jefe Local lo aprueba.
 *   Solo las ventas aprobadas cuentan para la comisión del mes.
 * - La comisión usa los mismos tramos del perfil de Ejecutivo (estándar o personalizados). Al subir de
 *   tramo, el nuevo valor se aplica a TODAS las ventas del mes.
 * - El servidor calcula y valida todo; aquí solo se muestra.
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { MODULOS_COMISION, getTramo, etiquetaTramo } from "../supabase/functions/api/comisiones-core.js";
import { calcularCotizacion, validarCierre, cierreNombre, mesChile, FINANCIERAS } from "../supabase/functions/api/ventas-core.js";
import { Aprobaciones } from "./crm-cotizaciones.jsx";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, fechaHora, fechaCorta, hace, Aviso, Cargando, Tarjeta, Campo, Modal, useCarga, mensajeError } from "./crm-ui.jsx";

export const folioVenta = (n) => `VTA-${String(n || 0).padStart(6, "0")}`;
const COLOR_CIERRE = { pendiente: "bg-amber-100 text-amber-800", aprobada: "bg-emerald-100 text-emerald-800", rechazada: "bg-rose-100 text-rose-800", anulada: "bg-stone-200 text-stone-600" };
const hoyChile = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const pctTxt = (r) => `${Math.round(r * 1000) / 10}%`;
const valorTramo = (tipo, rate) => (tipo === "porcentaje" ? pctTxt(rate) : `${clp(rate)} c/u`);

/* =========================================================
   FORMULARIO DE CIERRE
========================================================= */
function FormCierre({ api, lead, cotizacion, reserva, catalogos, onCerrar, onGuardado }) {
  const calc = calcularCotizacion({ precioLista: cotizacion.precio_lista, descuento: cotizacion.descuento, parteDePago: cotizacion.parte_pago, financiamiento: cotizacion.financiamiento });
  const [f, setF] = useState({
    precioFinal: cotizacion.precio_final, montoParteDePago: calc.parte || 0, montoFinanciado: calc.montoFinanciar || 0,
    financiera: (cotizacion.financiamiento && FINANCIERAS.includes(cotizacion.financiamiento.banco) ? cotizacion.financiamiento.banco : "") || "",
    comisionFinanciera: "", seguro: false, fechaEntrega: hoyChile(), notas: "",
  });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const precio = Number(f.precioFinal) || 0;
  const resto = precio - Number(reserva.monto) - (Number(f.montoParteDePago) || 0) - (Number(f.montoFinanciado) || 0);
  const menosQueCotizacion = precio > 0 && precio < Number(cotizacion.precio_final);
  const financia = Number(f.montoFinanciado) > 0;

  const guardar = async () => {
    setError("");
    const v = validarCierre({ ...f, financiera: financia ? f.financiera : "" });
    if (!v.ok) { setError(mensajeError({ message: v.error })); return; }
    setGuardando(true);
    try { onGuardado((await api("cierres.crear", { leadId: lead.id, datos: { ...f, financiera: financia ? f.financiera : "" } })).cierre); }
    catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };
  const snap = cotizacion.vehiculo_snapshot || {};

  return (
    <Modal titulo="Cerrar la venta" onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="bg-white border border-stone-200 p-4 text-sm">
        <p className="text-stone-900">{snap.marca} {snap.modelo} {snap.anio} · <span className="font-mono">{snap.patente}</span></p>
        <p className="text-stone-600">Cotización aprobada: {clp(cotizacion.precio_final)} · reserva recibida: {clp(reserva.monto)}</p>
      </div>
      <Tarjeta titulo="Precio y forma de pago">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Campo etiqueta="Precio final de venta ($)" ayuda={menosQueCotizacion ? `Es ${clp(Number(cotizacion.precio_final) - precio)} menos que la cotización: el Jefe Local lo verá al aprobar.` : ""}>
            <input type="number" min="1" value={f.precioFinal} onChange={(e) => set("precioFinal", e.target.value)} className={INPUT} />
          </Campo>
          <Campo etiqueta="Vehículo recibido en parte de pago ($)"><input type="number" min="0" value={f.montoParteDePago} onChange={(e) => set("montoParteDePago", e.target.value)} className={INPUT} /></Campo>
          <Campo etiqueta="Monto financiado ($)"><input type="number" min="0" value={f.montoFinanciado} onChange={(e) => set("montoFinanciado", e.target.value)} className={INPUT} /></Campo>
          {financia && (
            <>
              <Campo etiqueta="Financiera">
                <select value={f.financiera} onChange={(e) => set("financiera", e.target.value)} className={INPUT}><option value="">Elegir…</option>{FINANCIERAS.map((x) => <option key={x}>{x}</option>)}</select>
              </Campo>
              <Campo etiqueta="Comisión que paga la financiera ($)" ayuda="Es la base de tu comisión por créditos."><input type="number" min="0" value={f.comisionFinanciera} onChange={(e) => set("comisionFinanciera", e.target.value)} className={INPUT} /></Campo>
            </>
          )}
        </div>
        <div className="mt-3 text-sm flex flex-wrap gap-x-6 gap-y-1 text-stone-600">
          <span>Reserva: <strong className="font-mono">{clp(reserva.monto)}</strong></span>
          <span>Resto por pagar al contado: <strong className={`font-mono ${resto < 0 ? "text-rose-600" : "text-stone-900"}`}>{clp(resto)}</strong></span>
        </div>
        {resto < 0 && <p className="text-xs text-rose-600 mt-1">Los pagos informados superan el precio final. Revisa los montos.</p>}
      </Tarjeta>
      <Tarjeta titulo="Entrega y seguro">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <Campo etiqueta="Fecha de entrega"><input type="date" value={f.fechaEntrega} onChange={(e) => set("fechaEntrega", e.target.value)} className={INPUT} /></Campo>
          <label className="flex items-center gap-2 text-sm text-stone-800 pb-2"><input type="checkbox" checked={f.seguro} onChange={(e) => set("seguro", e.target.checked)} /> Se vendió un seguro con este vehículo</label>
        </div>
      </Tarjeta>
      <Campo etiqueta="Observaciones"><textarea rows={2} value={f.notas} onChange={(e) => set("notas", e.target.value)} className={INPUT} /></Campo>
      <Aviso tipo="info">El cierre lo debe <strong>aprobar el Jefe Local</strong>. Mientras tanto el vehículo sigue reservado. La venta cuenta para la comisión del mes en que se apruebe.</Aviso>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={guardando} className={BTN_AMBAR}>{guardando ? "Enviando…" : catalogos.puedeAsignar ? "Cerrar y aprobar la venta" : "Pedir la aprobación"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* =========================================================
   SECCIÓN EN LA FICHA DEL LEAD
========================================================= */
export function SeccionCierres({ api, lead, datos, catalogos, onCambio, avisar }) {
  const [form, setForm] = useState(false);
  const [anulando, setAnulando] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { cierres, reservas, cotizaciones, puedeEditar } = datos;
  if (cierres.length === 0 && lead.etapa !== "reservado") return null;

  const reserva = reservas.find((r) => r.estado === "activa");
  const cotizacion = reserva && cotizaciones.find((c) => c.id === reserva.cotizacion_id);
  const hayEnCurso = cierres.some((c) => c.estado === "pendiente" || c.estado === "aprobada");
  const correr = async (fn) => { avisar(""); setOcupado(true); try { await fn(); await onCambio(); } catch (e) { avisar(mensajeError(e)); } setOcupado(false); };

  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-700">Cierre de venta</p>
        {puedeEditar && lead.etapa === "reservado" && reserva && cotizacion && !hayEnCurso && <button onClick={() => setForm(true)} className={BTN_AMBAR}>Cerrar la venta</button>}
      </div>
      {cierres.length === 0 && <p className="text-sm text-stone-500">El lead está reservado. Cuando el cliente pague y retire el vehículo, registra aquí el cierre.</p>}
      {cierres.map((c) => (
        <div key={c.id} className="border border-stone-300 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-stone-500">{folioVenta(c.numero)}</span>
            <span className={`text-[11px] px-2 py-0.5 ${COLOR_CIERRE[c.estado]}`}>{cierreNombre(c.estado)}</span>
            <span className="ml-auto font-mono text-stone-900">{clp(c.precio_final)}</span>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Entrega {c.fecha_entrega ? new Date(`${c.fecha_entrega}T12:00:00`).toLocaleDateString("es-CL") : "—"}
            {c.monto_parte_pago > 0 ? ` · parte de pago ${clp(c.monto_parte_pago)}` : ""}{c.monto_financiado > 0 ? ` · financiado ${clp(c.monto_financiado)} (${c.financiera})` : ""}
            {c.seguro ? " · con seguro" : ""}{c.margen != null ? ` · margen ${clp(c.margen)}` : ""}
          </p>
          {c.estado === "pendiente" && <p className="text-xs text-amber-700 mt-1">Esperando la aprobación del Jefe Local (pedido por {c.solicitado_por}).</p>}
          {c.estado === "aprobada" && <p className="text-xs text-emerald-700 mt-1">Aprobada por {c.aprobado_por}. Cuenta para la comisión de {c.mes}.</p>}
          {c.estado === "rechazada" && <p className="text-xs text-rose-700 mt-1">Rechazada: {c.motivo_rechazo}. Puedes corregir los datos y pedir el cierre de nuevo.</p>}
          {c.estado === "anulada" && <p className="text-xs text-stone-500 mt-1">Anulada{c.anulado_por ? ` por ${c.anulado_por}` : ""}: {c.motivo_anulacion}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            {c.estado === "pendiente" && catalogos.puedeAsignar && <button disabled={ocupado} onClick={() => correr(() => api("cierres.aprobar", { id: c.id }))} className={BTN_AMBAR}>Aprobar venta</button>}
            {c.estado === "pendiente" && puedeEditar && <button disabled={ocupado} onClick={() => correr(() => api("cierres.retirar", { id: c.id }))} className={BTN}>Retirar</button>}
            {c.estado === "aprobada" && catalogos.puedeAsignar && <button onClick={() => { setAnulando(c); setMotivo(""); }} className={BTN}>Anular venta…</button>}
          </div>
          {anulando && anulando.id === c.id && (
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la anulación" className={`${INPUT} md:w-72`} />
              <button disabled={motivo.trim().length < 3 || ocupado} onClick={() => correr(async () => { await api("cierres.anular", { id: c.id, motivo }); setAnulando(null); })} className={BTN_PRIMARIO}>Anular</button>
              <button onClick={() => setAnulando(null)} className={BTN}>Cancelar</button>
              <p className="text-xs text-stone-500 basis-full">El vehículo vuelve a estar disponible y esta venta sale de la comisión de {c.mes}.</p>
            </div>
          )}
        </div>
      ))}
      {form && reserva && cotizacion && <FormCierre api={api} lead={lead} cotizacion={cotizacion} reserva={reserva} catalogos={catalogos} onCerrar={() => setForm(false)} onGuardado={async () => { setForm(false); await onCambio(); }} />}
    </div>
  );
}

/* =========================================================
   APROBACIONES: descuentos + cierres de venta
========================================================= */
function CierresPorAprobar({ api, version, abrirLead, onCambio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("cierres.list", { estado: "pendiente" }), [api, version]);
  const [rechazando, setRechazando] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState("");
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const correr = async (id, fn) => { setMsg(""); setOcupado(id); try { await fn(); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); } setOcupado(""); };
  return (
    <>
      <h3 className="font-serif text-lg text-stone-900 mt-2">Cierres de venta por aprobar</h3>
      {msg && <Aviso>{msg}</Aviso>}
      {datos.cierres.length === 0 && <Tarjeta><p className="text-sm text-stone-500">No hay ventas esperando aprobación.</p></Tarjeta>}
      {datos.cierres.map((c) => {
        const snap = c.vehiculo_snapshot || {};
        const menos = Number(c.precio_cotizado) - Number(c.precio_final);
        return (
          <div key={c.id} className="bg-white border border-amber-300 p-4 text-sm flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-stone-500">{c.folio}</span>
              <button onClick={() => abrirLead(c.lead_id)} className="text-stone-900 font-medium underline decoration-dotted">{c.cliente}</button>
              <span className="text-stone-600">· {snap.marca} {snap.modelo} {snap.anio} ({snap.patente})</span>
              <span className="ml-auto text-xs text-stone-500">Pide {c.ejecutivo || c.solicitado_por} · {hace(c.creado_en)}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><p className="text-[11px] uppercase text-stone-400">Precio cotizado</p><p className="font-mono">{clp(c.precio_cotizado)}</p></div>
              <div><p className="text-[11px] uppercase text-stone-400">Precio de venta</p><p className={`font-mono ${menos > 0 ? "text-amber-700" : ""}`}>{clp(c.precio_final)}</p>{menos > 0 && <p className="text-[11px] text-amber-700">{clp(menos)} menos que la cotización</p>}</div>
              <div><p className="text-[11px] uppercase text-stone-400">Margen</p><p className="font-mono">{c.margen == null ? "—" : clp(c.margen)}</p></div>
              <div><p className="text-[11px] uppercase text-stone-400">Entrega</p><p>{new Date(`${c.fecha_entrega}T12:00:00`).toLocaleDateString("es-CL")}</p></div>
            </div>
            <p className="text-xs text-stone-500">
              Reserva {clp(c.reserva_monto)}{c.monto_parte_pago > 0 ? ` · parte de pago ${clp(c.monto_parte_pago)}` : ""}
              {c.monto_financiado > 0 ? ` · financiado ${clp(c.monto_financiado)} en ${c.financiera} (comisión ${clp(c.comision_financiera)})` : ""}{c.seguro ? " · con seguro" : ""}
            </p>
            {c.notas && <p className="text-xs text-stone-600">Nota: {c.notas}</p>}
            <div className="flex flex-wrap gap-2 items-center">
              <button disabled={!!ocupado} onClick={() => correr(c.id, () => api("cierres.aprobar", { id: c.id }))} className={BTN_AMBAR}>Aprobar venta</button>
              {rechazando === c.id ? (
                <>
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del rechazo" className={`${INPUT} md:w-72`} />
                  <button disabled={motivo.trim().length < 3 || !!ocupado} onClick={() => correr(c.id, async () => { await api("cierres.rechazar", { id: c.id, motivo }); setRechazando(""); setMotivo(""); })} className={BTN_PRIMARIO}>Rechazar</button>
                  <button onClick={() => setRechazando("")} className={BTN}>Cancelar</button>
                </>
              ) : <button onClick={() => { setRechazando(c.id); setMotivo(""); }} className={BTN}>Rechazar…</button>}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function AprobacionesTodo({ api, version, abrirLead, onCambio }) {
  return (
    <>
      <Aprobaciones api={api} version={version} abrirLead={abrirLead} onCambio={onCambio} />
      <CierresPorAprobar api={api} version={version} abrirLead={abrirLead} onCambio={onCambio} />
    </>
  );
}

/* =========================================================
   COMISIÓN DEL MES
========================================================= */
function TablaTramos({ modulo, tramos, n }) {
  const actual = getTramo(n, tramos);
  return (
    <div className="text-xs text-stone-500 mt-1">
      {tramos.map((t) => (
        <span key={`${t.min}-${t.max}`} className={`inline-block mr-3 ${actual && actual.min === t.min ? "text-stone-900 font-semibold" : ""}`}>{etiquetaTramo(t)}: {valorTramo(modulo.tipo, t.rate)}</span>
      ))}
    </div>
  );
}

function DesgloseComision({ e, pendientesDeOtrosModulos }) {
  const [verTramos, setVerTramos] = useState(false);
  const p = e.produccion;
  const filas = [
    { m: MODULOS_COMISION.find((x) => x.key === "ventas"), r: p.ventas, n: p.ventas.n, detalle: `${p.ventas.n} venta(s)` },
    { m: MODULOS_COMISION.find((x) => x.key === "seguros"), r: p.seguros, n: p.seguros.n, detalle: `${p.seguros.n} seguro(s)` },
    { m: MODULOS_COMISION.find((x) => x.key === "creditos"), r: p.creditos, n: p.creditos.n, detalle: `${p.creditos.n} crédito(s) · base ${clp(p.creditos.base)}` },
  ];
  return (
    <div className="text-sm">
      <table className="w-full border-collapse">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-1.5">Concepto</th><th className="py-1.5">Detalle</th><th className="py-1.5">Tramo</th><th className="py-1.5 text-right">Comisión</th></tr></thead>
        <tbody>
          {filas.map(({ m, r, detalle }) => (
            <tr key={m.key} className="border-b border-stone-100 align-top">
              <td className="py-1.5 text-stone-800">{m.label}</td>
              <td className="py-1.5 text-stone-600">{detalle}</td>
              <td className="py-1.5 text-stone-600">{r.tramo ? `${r.tramo} → ${valorTramo(m.tipo, r.rate)}` : "—"}</td>
              <td className="py-1.5 text-right font-mono text-stone-900">{clp(r.total)}</td>
            </tr>
          ))}
          <tr><td colSpan={3} className="py-2 text-right text-stone-700 font-medium">Total del mes</td><td className="py-2 text-right font-mono text-lg text-stone-900">{clp(p.total)}</td></tr>
        </tbody>
      </table>
      {p.ventas.proximo && (
        <p className="text-xs text-amber-700 mt-1">Con {p.ventas.proximo.faltan} venta(s) más pasas al tramo «{etiquetaTramo(p.ventas.proximo.tramo)}» ({clp(p.ventas.proximo.tramo.rate)} c/u) y se aplica a <strong>todas</strong> las ventas del mes.</p>
      )}
      <button onClick={() => setVerTramos(!verTramos)} className="text-xs text-stone-600 underline mt-2">{verTramos ? "Ocultar tramos" : `Ver mis tramos${e.personalizado ? " (personalizados)" : ""}`}</button>
      {verTramos && (
        <div className="mt-2 flex flex-col gap-2">
          {MODULOS_COMISION.filter((m) => ["ventas", "seguros", "creditos"].includes(m.key)).map((m) => (
            <div key={m.key}><span className="text-xs text-stone-700">{m.label} <span className="text-stone-400">({m.unidad})</span></span><TablaTramos modulo={m} tramos={e.tramos[m.key]} n={e.datos[{ ventas: "ventasN", seguros: "segurosN", creditos: "creditosN" }[m.key]]} /></div>
          ))}
        </div>
      )}
      {pendientesDeOtrosModulos.length > 0 && <p className="text-[11px] text-stone-400 mt-3">Compras, consignaciones e inspecciones se suman cuando existan esos flujos en el CRM ({pendientesDeOtrosModulos.join(", ")}).</p>}
    </div>
  );
}

export function TarjetaComision({ resumen, titulo = "Mi comisión del mes" }) {
  if (!resumen || resumen.ejecutivos.length === 0) return null;
  const e = resumen.ejecutivos[0];
  const meta = resumen.meta || 0;
  const pct = meta > 0 ? Math.min(100, Math.round((e.datos.ventasN / meta) * 100)) : 0;
  return (
    <Tarjeta titulo={`${titulo} · ${resumen.nombreMes}`} ayuda="Solo cuentan las ventas aprobadas por el Jefe Local.">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 h-3 bg-stone-200"><div className="h-3 bg-amber-500" style={{ width: `${pct}%` }} /></div>
        <p className="font-mono text-sm text-stone-700 whitespace-nowrap">{e.datos.ventasN} / {meta || "sin meta"} ventas</p>
      </div>
      <DesgloseComision e={e} pendientesDeOtrosModulos={resumen.pendientesDeOtrosModulos} />
      {e.pendientes > 0 && <p className="text-xs text-stone-500 mt-2">Tienes {e.pendientes} venta(s) esperando aprobación: aún no suman.</p>}
    </Tarjeta>
  );
}

/* =========================================================
   PESTAÑA "VENTAS"
========================================================= */
function FilaEjecutivo({ e, meta, abierto, onToggle }) {
  const pct = meta > 0 ? Math.min(100, Math.round((e.datos.ventasN / meta) * 100)) : 0;
  return (
    <>
      <tr className="border-b border-stone-100 cursor-pointer hover:bg-amber-50" onClick={onToggle}>
        <td className="py-2.5 px-4 text-stone-900">{e.nombre}{!e.activo && <span className="ml-2 text-[10px] uppercase text-rose-600">desactivado</span>}{e.personalizado && <span className="ml-2 text-[10px] uppercase text-amber-600">tramos propios</span>}</td>
        <td className="py-2.5 px-4 text-right font-mono">{e.datos.ventasN}{meta > 0 && <span className="text-xs text-stone-400"> / {meta}</span>}<div className="h-1 bg-stone-200 mt-1"><div className="h-1 bg-amber-500" style={{ width: `${pct}%` }} /></div></td>
        <td className="py-2.5 px-4 text-right font-mono">{clp(e.montoVendido)}</td>
        <td className="py-2.5 px-4 text-right font-mono">{e.margen == null ? "—" : clp(e.margen)}</td>
        <td className="py-2.5 px-4 text-right font-mono text-stone-900">{clp(e.produccion.total)}</td>
        <td className="py-2.5 px-4 text-right text-xs text-stone-500">{e.pendientes > 0 ? `${e.pendientes} por aprobar` : ""}</td>
      </tr>
      {abierto && <tr className="bg-stone-50"><td colSpan={6} className="px-4 py-3"><DesgloseComision e={e} pendientesDeOtrosModulos={[]} /></td></tr>}
    </>
  );
}

export function Ventas({ api, catalogos, abrirLead, version, onCambio }) {
  const [mes, setMes] = useState(mesChile());
  const [abierto, setAbierto] = useState("");
  const [anulando, setAnulando] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const res = useCarga(() => api("comisiones.resumen", { mes }), [api, mes, version]);
  const lis = useCarga(() => api("cierres.list", { mes }), [api, mes, version]);

  if ((res.cargando && !res.datos) || (lis.cargando && !lis.datos)) return <Cargando />;
  if (res.error && !res.datos) return <Aviso>{res.error}</Aviso>;
  if (lis.error && !lis.datos) return <Aviso>{lis.error}</Aviso>;
  const r = res.datos; const l = lis.datos;
  const verEquipo = r.verTodos;

  const anular = async (c) => {
    setMsg("");
    try { await api("cierres.anular", { id: c.id, motivo }); setAnulando(""); setMotivo(""); await res.recargar(); await lis.recargar(); onCambio(); }
    catch (e) { setMsg(mensajeError(e)); }
  };

  return (
    <>
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-stone-600 flex items-center gap-2">Mes <input type="month" value={mes} max={mesChile()} onChange={(e) => e.target.value && setMes(e.target.value)} className={`${INPUT} w-44`} /></label>
          <div className="ml-auto text-right">
            <p className="text-xs uppercase tracking-widest text-stone-400">{verEquipo ? "Producción del equipo" : "Mi comisión"} · {r.nombreMes}</p>
            <p className="font-mono text-2xl text-amber-600">{clp(verEquipo ? r.totales.produccion : (r.ejecutivos[0] ? r.ejecutivos[0].produccion.total : 0))}</p>
          </div>
        </div>
        {verEquipo && <p className="text-xs text-stone-500 mt-2">{r.totales.unidades} venta(s) aprobada(s) por {clp(r.totales.montoVendido)}. La «producción» es la comisión que corresponde a cada ejecutivo según sus tramos.</p>}
      </Tarjeta>

      {verEquipo ? (
        <div className="bg-white border border-stone-200 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-3 px-4">Ejecutivo</th><th className="py-3 px-4 text-right">Ventas / meta</th><th className="py-3 px-4 text-right">Monto vendido</th>
              <th className="py-3 px-4 text-right">Margen</th><th className="py-3 px-4 text-right">Comisión</th><th className="py-3 px-4"></th>
            </tr></thead>
            <tbody>
              {r.ejecutivos.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">Aún no hay ejecutivos habilitados para ventas.</td></tr>}
              {r.ejecutivos.map((e) => <FilaEjecutivo key={e.id} e={e} meta={r.meta} abierto={abierto === e.id} onToggle={() => setAbierto(abierto === e.id ? "" : e.id)} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <TarjetaComision resumen={r} />
      )}

      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Ventas de {l.nombreMes}</h3></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Venta</th><th className="py-3 px-4">Cliente y vehículo</th>{verEquipo && <th className="py-3 px-4">Ejecutivo</th>}
            <th className="py-3 px-4 text-right">Precio</th><th className="py-3 px-4 text-right">Margen</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {l.cierres.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-stone-500">No hay ventas registradas este mes.</td></tr>}
            {l.cierres.map((c) => {
              const snap = c.vehiculo_snapshot || {};
              return (
                <React.Fragment key={c.id}>
                  <tr className="border-b border-stone-100 align-top">
                    <td className="py-2.5 px-4 font-mono text-xs text-stone-500 whitespace-nowrap">{c.folio}<div className="text-[11px] text-stone-400">{fechaCorta(c.aprobado_en || c.creado_en)}</div></td>
                    <td className="py-2.5 px-4"><button onClick={() => abrirLead(c.lead_id)} className="text-stone-900 underline decoration-dotted text-left">{c.cliente}</button><div className="text-xs text-stone-500">{snap.marca} {snap.modelo} {snap.anio} · {snap.patente}</div></td>
                    {verEquipo && <td className="py-2.5 px-4 text-stone-700">{c.ejecutivo}</td>}
                    <td className="py-2.5 px-4 text-right font-mono">{clp(c.precio_final)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{c.margen == null ? "—" : clp(c.margen)}</td>
                    <td className="py-2.5 px-4"><span className={`text-[11px] px-2 py-0.5 ${COLOR_CIERRE[c.estado]}`}>{cierreNombre(c.estado)}</span></td>
                    <td className="py-2.5 px-4 text-right">
                      {c.estado === "aprobada" && l.puedeAprobar && <button onClick={() => { setAnulando(anulando === c.id ? "" : c.id); setMotivo(""); }} className={BTN}>Anular…</button>}
                    </td>
                  </tr>
                  {anulando === c.id && (
                    <tr className="bg-stone-50"><td colSpan={7} className="px-4 py-3 flex flex-wrap items-center gap-2">
                      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la anulación" className={`${INPUT} md:w-80`} />
                      <button disabled={motivo.trim().length < 3} onClick={() => anular(c)} className={BTN_PRIMARIO}>Anular venta</button>
                      <span className="text-xs text-stone-500">El vehículo vuelve a estar disponible y la venta sale de la comisión de {nombreMesCorto(c.mes)}.</span>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Las comisiones de compras, consignaciones e inspecciones se suman cuando esos flujos estén en el CRM. Una venta anulada sale de la comisión del mes en que se aprobó.</p>
    </>
  );
}

const nombreMesCorto = (m) => m || "ese mes";
