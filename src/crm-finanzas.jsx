/**
 * FINANZAS (CRM)
 * ----------------------------------------------------------------
 * Gestión financiera de la empresa: panorama (saldos, resultados del mes, flujo de caja, por cobrar y por pagar),
 * libro de movimientos, bancos y caja, y rentabilidad por vehículo.
 * El Administrador registra gastos, otros ingresos, aportes, retiros y traspasos; el Jefe Local solo mira (su local).
 * Los pagos de ventas, reservas y compras entran solos desde el CRM. La contabilidad oficial la lleva el contador:
 * desde «Movimientos» se le descarga el detalle en CSV.
 * ----------------------------------------------------------------
 */
import React, { useState, useMemo, useEffect } from "react";
import { InputDinero } from "./campo-dinero.jsx";
import { Nomina } from "./crm-nomina.jsx";
import { Conciliacion } from "./crm-conciliacion.jsx";
import { buildInformeMensualPdf } from "./pdf-report.js";
import {
  CATEGORIAS_FIN, DOCUMENTOS_FIN, MEDIOS_FIN, categoriaFin, categoriaConVehiculo, validarMovimiento, movimientosCsv, claveDe,
  categoriasAgrupadas, GRUPOS_FIN, MAX_ARCHIVOS_FIN, faltaRespaldo,
} from "../supabase/functions/api/finanzas-core.js";
import { MAX_BYTES_ARCHIVO } from "../supabase/functions/api/validaciones-core.js";
import { compressImage, makePhotoId } from "./photos.js";
import { subirRespaldos, limpiarRespaldos } from "./crm-pagos.jsx";
import { abrirArchivo } from "./crm-validaciones.jsx";
import { INPUT, BTN, BTN_PRIMARIO, clp as clpBase, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, useCarga, useGuardado, mensajeError } from "./crm-ui.jsx";

/** Pesos con el signo menos delante ($-350.000 → −$350.000). */
const clp = (n) => (n !== null && n !== undefined && n !== "" && Number(n) < 0 ? `−${clpBase(-Number(n))}` : clpBase(n));
const hoyCL = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m) => { const [a, n] = String(m).split("-"); return n ? `${MESES[Number(n) - 1]} ${a}` : `año ${a}`; };
const mesCorto = (m) => { const [a, n] = String(m).split("-"); return `${MESES[Number(n) - 1].slice(0, 3)} ${a.slice(2)}`; };
const fechaCL = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const ORIGEN = { manual: "Manual", venta: "Venta", reserva: "Reserva", compra: "Compra" };
const signo = (m) => (m.tipo === "egreso" ? -1 : 1);
const leerComoDataUrl = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error("archivo_ilegible"));
  fr.readAsDataURL(file);
});
const nuevoNs = () => `fin-${(window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12)}`;

/** Respaldos de un movimiento (para abrirlos). */
function ChipsRespaldo({ archivos }) {
  return (archivos || []).map((a) => (
    <button key={a.id} type="button" onClick={() => abrirArchivo(null, a)} className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline mr-2" title="Abrir respaldo">
      {a.tipo === "application/pdf" ? "📄" : "🖼"} <span className="max-w-[140px] truncate">{a.nombre}</span>
    </button>
  ));
}

/** Períodos para elegir: los últimos 12 meses y los últimos 2 años. */
function opcionesPeriodo() {
  const hoy = hoyCL();
  const out = [];
  let [a, m] = hoy.split("-").map(Number);
  for (let i = 0; i < 12; i++) { out.push(`${a}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; a--; } }
  const y = Number(hoy.slice(0, 4));
  out.push(String(y), String(y - 1));
  return out;
}

function SelectorPeriodo({ valor, onCambio }) {
  const ops = useMemo(opcionesPeriodo, []);
  return (
    <select value={valor} onChange={(e) => onCambio(e.target.value)} className={`${INPUT} !w-auto`}>
      {ops.map((p) => <option key={p} value={p}>{p.length === 4 ? `Año ${p}` : nombreMes(p).replace(/^./, (c) => c.toUpperCase())}</option>)}
    </select>
  );
}

function Cifra({ titulo, valor, detalle, tono = "", texto }) {
  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-stone-500">{titulo}</span>
      <span className={`text-xl font-semibold ${tono || (Number(valor) < 0 ? "text-rose-700" : "text-stone-900")}`}>{texto ?? clp(valor)}</span>
      {detalle && <span className="text-xs text-stone-500">{detalle}</span>}
    </div>
  );
}

/** Barras simples de entradas y salidas por mes. */
function GraficoFlujo({ flujo }) {
  if (!flujo.length) return <p className="text-sm text-stone-500">Aún no hay movimientos.</p>;
  const max = Math.max(1, ...flujo.map((f) => Math.max(f.entradas, f.salidas)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2 h-40 overflow-x-auto">
        {flujo.map((f) => (
          <div key={f.mes} className="flex flex-col items-center gap-1 min-w-[44px] flex-1" title={`${nombreMes(f.mes)}: entradas ${clp(f.entradas)}, salidas ${clp(f.salidas)}, neto ${clp(f.neto)}`}>
            <div className="flex items-end gap-0.5 h-32 w-full justify-center">
              <div className="w-3 bg-emerald-500" style={{ height: `${(f.entradas / max) * 100}%` }} />
              <div className="w-3 bg-rose-400" style={{ height: `${(f.salidas / max) * 100}%` }} />
            </div>
            <span className="text-[11px] text-stone-500 whitespace-nowrap">{mesCorto(f.mes)}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-stone-600">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500 inline-block" /> Entradas</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-rose-400 inline-block" /> Salidas</span>
      </div>
    </div>
  );
}

function Fila({ texto, monto, fuerte, sangria, negativo }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${fuerte ? "font-semibold border-t border-stone-200 mt-1 pt-2" : ""} ${sangria ? "pl-4 text-stone-600" : ""}`}>
      <span>{texto}</span><span className={Number(monto) < 0 ? "text-rose-700" : ""}>{negativo ? clp(-Number(monto)) : clp(monto)}</span>
    </div>
  );
}

/* ================= Resumen ================= */
/** Genera y descarga el informe financiero del período (mes o año) en PDF. */
async function descargarInforme(api, periodo) {
  const { informe } = await api("fin.informe", { periodo });
  const bytes = buildInformeMensualPdf(informe, { fmt: clpBase });
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = `Informe-financiero_${periodo}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function Resumen({ api, irA }) {
  const [per, setPer] = useState(hoyCL().slice(0, 7));
  const { cargando, error, datos } = useCarga(() => api("fin.resumen", { periodo: per }), [api, per]);
  const [informe, setInforme] = useState({ ocupado: false, error: "" });
  const bajarInforme = async () => {
    setInforme({ ocupado: true, error: "" });
    try { await descargarInforme(api, per); setInforme({ ocupado: false, error: "" }); }
    catch (e) { setInforme({ ocupado: false, error: mensajeError(e) }); }
  };
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const d = datos;
  const r = d.resultados;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-stone-600">Período:</span>
        <SelectorPeriodo valor={per} onCambio={setPer} />
        <button type="button" onClick={bajarInforme} disabled={informe.ocupado} className={BTN} title="Resumen del período en PDF: cifras clave, resultados, ventas, caja, por cobrar y por pagar, inventario y pendientes">{informe.ocupado ? "Generando…" : `Informe ${per.length === 4 ? "del año" : "del mes"} (PDF)`}</button>
        {informe.error && <span className="text-sm text-rose-600">{informe.error}</span>}
        {cargando && <span className="text-xs text-stone-400">Actualizando…</span>}
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Cifra titulo="Saldo en bancos y caja" valor={d.saldoTotal} detalle={<button type="button" onClick={() => irA("bancos")} className="hover:underline">Ver por cuenta →</button>} />
        <Cifra titulo={`Resultado ${per.length === 4 ? "del año" : "del mes"}`} valor={r.resultado} detalle={`${r.unidades} ${r.unidades === 1 ? "venta" : "ventas"} · margen bruto ${clp(r.margenBruto)}`} />
        <Cifra titulo="Por cobrar" valor={d.totalPorCobrar} detalle={`${d.porCobrar.length} ${d.porCobrar.length === 1 ? "venta" : "ventas"} con saldo`} tono="text-sky-800" />
        <Cifra titulo="Por pagar" valor={d.totalPorPagar} detalle={`${d.porPagar.length} ${d.porPagar.length === 1 ? "pendiente" : "pendientes"}: dueños de autos y nómina`} tono="text-amber-800" />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Tarjeta titulo={`Estado de resultados · ${nombreMes(per)}`} ayuda="Lo ganado en el período: las ventas aprobadas (precio menos costo del auto y sus gastos), más otros ingresos y menos los gastos. Los aportes, préstamos y retiros del dueño no son resultado.">
          <div className="text-sm">
            <Fila texto="Ventas de vehículos" monto={r.ingresosVentas} />
            <Fila texto="Costo de los vehículos vendidos" monto={r.costoVentas} negativo sangria />
            <Fila texto="Margen bruto" monto={r.margenBruto} fuerte />
            {r.otrosIngresos.map((x) => <Fila key={x.id} texto={x.nombre} monto={x.monto} sangria />)}
            {r.gastos.length > 0 && <p className="text-xs uppercase tracking-wide text-stone-500 mt-3 mb-1">Gastos</p>}
            {r.gastos.map((x) => <Fila key={x.id} texto={x.nombre} monto={x.monto} negativo sangria />)}
            <Fila texto="Resultado" monto={r.resultado} fuerte />
          </div>
        </Tarjeta>
        <Tarjeta titulo="Flujo de caja" ayuda="Plata que entró y salió de verdad, por mes (últimos 12 meses). Los traspasos entre cuentas no cuentan.">
          <GraficoFlujo flujo={d.flujo} />
          <div className="grid grid-cols-3 gap-2 mt-4 text-sm">
            <div><span className="block text-xs text-stone-500">Entró ({per.length === 4 ? "año" : "mes"})</span>{clp(d.caja.entradas)}</div>
            <div><span className="block text-xs text-stone-500">Salió</span>{clp(d.caja.salidas)}</div>
            <div><span className="block text-xs text-stone-500">Neto</span><span className={d.caja.neto < 0 ? "text-rose-700" : ""}>{clp(d.caja.neto)}</span></div>
          </div>
        </Tarjeta>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Tarjeta titulo="Por cobrar" ayuda="Ventas pendientes o aprobadas cuyos pagos registrados aún no completan el precio.">
          {d.porCobrar.length === 0 ? <p className="text-sm text-stone-500">Nada pendiente.</p> : (
            <div className="text-sm divide-y divide-stone-100">
              {d.porCobrar.map((x) => (
                <div key={x.id} className="flex justify-between gap-3 py-1.5"><span><span className="font-mono text-xs text-stone-500 mr-2">{x.folio}</span>{x.vehiculo}{x.estado === "pendiente" && <span className="text-xs text-amber-700 ml-2">(por aprobar)</span>}</span><span className="font-medium whitespace-nowrap">{clp(x.falta)}</span></div>
              ))}
            </div>
          )}
        </Tarjeta>
        <Tarjeta titulo="Por pagar" ayuda="Compras con saldo por pagarle al dueño y autos consignados vendidos cuyo dueño aún no recibe su liquidación (regístrala como «Pago al dueño de un auto consignado», asociando el auto).">
          {d.porPagar.length === 0 ? <p className="text-sm text-stone-500">Nada pendiente.</p> : (
            <div className="text-sm divide-y divide-stone-100">
              {d.porPagar.map((x) => (
                <div key={x.id} className="flex justify-between gap-3 py-1.5"><span><span className="font-mono text-xs text-stone-500 mr-2">{x.folio}</span>{x.vehiculo}<span className="text-xs text-stone-500 ml-2">{x.tipo === "consignacion" ? "consignación" : x.tipo === "nomina" ? "nómina" : "compra"}</span></span><span className="font-medium whitespace-nowrap">{clp(x.falta)}</span></div>
              ))}
            </div>
          )}
        </Tarjeta>
      </div>
      <p className="text-xs text-stone-500">Inventario propio: {d.stock.unidades} {d.stock.unidades === 1 ? "auto" : "autos"} con {clp(d.stock.invertido)} invertidos{d.stock.consignados ? ` · ${d.stock.consignados} consignados (no son de la empresa)` : ""}. Montos tal como se registraron (con IVA si el documento lo incluye); la contabilidad oficial la lleva el contador.</p>
    </div>
  );
}

/* ================= Registrar / editar un movimiento ================= */
const VACIO = { tipo: "egreso", categoria: "", monto: "", fecha: "", descripcion: "", contraparte: "", documentoTipo: "factura", documentoNumero: "", medio: "efectivo", cuentaId: "", cuentaDestinoId: "", vehiculoId: "", notas: "" };

function FormMovimiento({ api, cuentas, inicial, plantilla, onCerrar, onListo }) {
  const base = inicial || plantilla;
  const [f, setF] = useState(() => (base ? {
    tipo: base.tipo, categoria: base.categoria, monto: String(base.monto), fecha: inicial ? inicial.fecha : hoyCL(), descripcion: base.descripcion || "", contraparte: base.contraparte || "",
    documentoTipo: base.documento_tipo || "sin_documento", documentoNumero: inicial ? inicial.documento_numero || "" : "", medio: base.medio || "transferencia",
    cuentaId: base.cuenta_id || "", cuentaDestinoId: base.cuenta_destino_id || "", vehiculoId: base.vehiculo_id || "", notas: inicial ? inicial.notas || "" : "",
    recurrente: !!base.recurrente, serieId: plantilla ? plantilla.serie_id : (inicial && inicial.serie_id) || "",
  } : { ...VACIO, fecha: hoyCL() }));
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [ns] = useState(nuevoNs);
  const [guardados, setGuardados] = useState(() => (inicial && inicial.archivos) || []);
  const [nuevos, setNuevos] = useState([]);
  const totalArchivos = guardados.length + nuevos.length;
  const elegirArchivos = async (ev) => {
    const lista = Array.from(ev.target.files || []);
    ev.target.value = "";
    setMsg("");
    let actuales = totalArchivos;
    for (const file of lista) {
      try {
        if (actuales >= MAX_ARCHIVOS_FIN) throw new Error("demasiados_archivos");
        const esPdf = file.type === "application/pdf";
        if (!esPdf && !file.type.startsWith("image/")) throw new Error("archivo_tipo_invalido");
        if (esPdf && file.size > MAX_BYTES_ARCHIVO) throw new Error("archivo_muy_grande");
        const dataUrl = esPdf ? await leerComoDataUrl(file) : await compressImage(file);
        actuales += 1;
        setNuevos((a) => [...a, { id: makePhotoId(), nombre: file.name, tipo: esPdf ? "application/pdf" : "image/jpeg", tam: Math.round(dataUrl.length * 0.75), dataUrl }]);
      } catch (e) { setMsg(mensajeError(e)); }
    }
  };
  const conVeh = categoriaConVehiculo(f.categoria);
  const vehs = useCarga(() => (conVeh ? api("fin.vehiculos", {}) : Promise.resolve(null)), [api, conVeh]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const grupos = categoriasAgrupadas(f.tipo);
  // La caja del local es «sin cuenta»; las demás cuentas (bancos y «por depositar») se eligen por su clave.
  const opcionesCuenta = cuentas.filter((c) => c.activa && c.tipo !== "caja");
  const guardar = async () => {
    setMsg("");
    const v = validarMovimiento(f, { hoy: hoyCL() });
    if (!v.ok) { setMsg(mensajeError({ message: v.error })); return; }
    setOcupado(true);
    let subidos = [];
    try {
      subidos = await subirRespaldos(ns, nuevos);
      const archivos = [...guardados, ...subidos.map(({ id, nombre, tipo, tam }) => ({ id, nombre, tipo, tam, v: ns }))];
      await api("fin.mov_guardar", { mov: f, archivos, ...(inicial ? { id: inicial.id } : {}) });
      onListo();
    } catch (e) { await limpiarRespaldos(ns, subidos); setMsg(mensajeError(e)); setOcupado(false); }
  };
  const selectCuenta = (valor, onCambio) => (
    <select value={valor} onChange={(e) => onCambio(e.target.value)} className={INPUT}>
      <option value="">Caja (efectivo)</option>
      {opcionesCuenta.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
    </select>
  );
  return (
    <Modal titulo={inicial ? `Editar ${inicial.folio}` : plantilla ? "Registrar gasto fijo del mes" : "Registrar movimiento"} onCerrar={onCerrar}>
      <div className="flex flex-col gap-3">
        {!inicial && !plantilla && (
          <div className="flex border border-stone-300 self-start">
            {[["egreso", "Gasto / egreso"], ["ingreso", "Ingreso"], ["traspaso", "Traspaso entre cuentas"]].map(([id, t]) => (
              <button key={id} type="button" onClick={() => setF((x) => ({ ...x, tipo: id, categoria: id === "traspaso" ? "traspaso" : "" }))} className={`px-3 py-1.5 text-sm ${f.tipo === id ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>{t}</button>
            ))}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          {f.tipo !== "traspaso" && (
            <Campo etiqueta="Categoría">
              <select value={f.categoria} onChange={(e) => set("categoria", e.target.value)} className={INPUT}>
                <option value="">Elige…</option>
                {grupos.map((g) => (
                  <optgroup key={g.id} label={g.nombre}>
                    {g.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </optgroup>
                ))}
              </select>
            </Campo>
          )}
          <Campo etiqueta="Monto"><InputDinero value={f.monto} onChange={(e) => set("monto", e.target.value)} className={INPUT} placeholder="0" /></Campo>
          <Campo etiqueta="Fecha"><input type="date" value={f.fecha} max={hoyCL()} onChange={(e) => set("fecha", e.target.value)} className={INPUT} /></Campo>
          {f.tipo === "traspaso" ? (
            <>
              <Campo etiqueta="Desde">{selectCuenta(f.cuentaId, (v) => set("cuentaId", v))}</Campo>
              <Campo etiqueta="Hacia">{selectCuenta(f.cuentaDestinoId, (v) => set("cuentaDestinoId", v))}</Campo>
            </>
          ) : (
            <>
              <Campo etiqueta={f.tipo === "egreso" ? "Pagado desde" : "Recibido en"}>{selectCuenta(f.cuentaId, (v) => setF((x) => ({ ...x, cuentaId: v, medio: !v ? "efectivo" : x.medio === "efectivo" ? "transferencia" : x.medio })))}</Campo>
              <Campo etiqueta="Medio">
                <select value={f.medio} onChange={(e) => set("medio", e.target.value)} className={INPUT}>{MEDIOS_FIN.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
              </Campo>
            </>
          )}
        </div>
        <Campo etiqueta="Descripción"><input value={f.descripcion} maxLength={200} onChange={(e) => set("descripcion", e.target.value)} className={INPUT} placeholder={f.tipo === "traspaso" ? "Ej.: depósito del efectivo de la semana" : "Ej.: arriendo de noviembre"} /></Campo>
        {conVeh && (
          <Campo etiqueta="Vehículo" ayuda={f.categoria === "pago_consignante" ? "El auto consignado cuyo dueño recibe el pago." : "El gasto se suma al costo de ese auto (se ve en Rentabilidad). Sin vehículo, cuenta como gasto del mes."}>
            <select value={f.vehiculoId} onChange={(e) => set("vehiculoId", e.target.value)} className={INPUT}>
              <option value="">{vehs.cargando ? "Cargando…" : "Sin vehículo"}</option>
              {((vehs.datos && vehs.datos.vehiculos) || []).map((v) => <option key={v.id} value={v.id}>{v.nombre}{v.estado === "vendido" ? " · vendido" : ""}{v.consignado ? " · consignado" : ""}</option>)}
            </select>
          </Campo>
        )}
        {f.tipo !== "traspaso" && (
          <div className="grid md:grid-cols-3 gap-3">
            <Campo etiqueta={f.tipo === "egreso" ? "Proveedor / a quién" : "De quién"}><input value={f.contraparte} maxLength={120} onChange={(e) => set("contraparte", e.target.value)} className={INPUT} /></Campo>
            <Campo etiqueta="Documento">
              <select value={f.documentoTipo} onChange={(e) => set("documentoTipo", e.target.value)} className={INPUT}>{DOCUMENTOS_FIN.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select>
            </Campo>
            <Campo etiqueta="N° documento"><input value={f.documentoNumero} maxLength={40} disabled={f.documentoTipo === "sin_documento"} onChange={(e) => set("documentoNumero", e.target.value)} className={INPUT} /></Campo>
          </div>
        )}
        {f.tipo !== "traspaso" && (
          <div className="flex flex-col gap-2 border border-stone-200 bg-stone-50 p-3">
            <span className="text-sm text-stone-700">Respaldo (factura, boleta o comprobante){totalArchivos === 0 && <span className="text-amber-700"> · sin respaldo todavía</span>}</span>
            <div className="flex flex-wrap items-center gap-2">
              {guardados.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 border border-stone-300 bg-white px-2 py-1 text-xs">
                  <button type="button" onClick={() => abrirArchivo(null, a)} className="hover:underline">{a.tipo === "application/pdf" ? "📄" : "🖼"} <span className="max-w-[160px] truncate inline-block align-bottom">{a.nombre}</span></button>
                  <button type="button" onClick={() => setGuardados((l) => l.filter((x) => x.id !== a.id))} className="text-rose-600 px-1" aria-label="Quitar archivo">✕</button>
                </span>
              ))}
              {nuevos.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 border border-amber-300 bg-white px-2 py-1 text-xs">
                  {a.tipo === "application/pdf" ? "📄" : "🖼"} <span className="max-w-[160px] truncate">{a.nombre}</span>
                  <button type="button" onClick={() => setNuevos((l) => l.filter((x) => x.id !== a.id))} className="text-rose-600 px-1" aria-label="Quitar archivo">✕</button>
                </span>
              ))}
              {totalArchivos < MAX_ARCHIVOS_FIN && (
                <label className={`${BTN} cursor-pointer`}>＋ Adjuntar foto o PDF<input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={elegirArchivos} /></label>
              )}
            </div>
          </div>
        )}
        {f.tipo === "egreso" && (
          <label className="text-sm text-stone-700 flex items-center gap-2"><input type="checkbox" checked={f.recurrente} onChange={(e) => set("recurrente", e.target.checked)} /> Gasto fijo: se repite cada mes (arriendo, internet, contador…). Cada mes se propondrá registrarlo.</label>
        )}
        <Campo etiqueta="Notas (opcional)"><textarea rows={2} value={f.notas} maxLength={500} onChange={(e) => set("notas", e.target.value)} className={INPUT} /></Campo>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={guardar} disabled={ocupado} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={onCerrar} className={BTN}>Cancelar</button>
          {msg && <p className="text-sm text-rose-600">{msg}</p>}
        </div>
      </div>
    </Modal>
  );
}

function AnularMovimiento({ api, mov, onCerrar, onListo }) {
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const anular = async () => {
    setOcupado(true); setMsg("");
    try { await api("fin.mov_anular", { id: mov.id, motivo }); onListo(); }
    catch (e) { setMsg(mensajeError(e)); setOcupado(false); }
  };
  return (
    <Modal titulo={`Anular ${mov.folio}`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-stone-700">{mov.descripcion} · {clp(mov.monto)}. Queda en el libro como anulado y deja de contar en saldos y resultados.</p>
        <Campo etiqueta="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={INPUT} autoFocus /></Campo>
        <div className="flex items-center gap-3">
          <button type="button" onClick={anular} disabled={ocupado} className="px-4 py-2 text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">Anular</button>
          <button type="button" onClick={onCerrar} className={BTN}>Volver</button>
          {msg && <p className="text-sm text-rose-600">{msg}</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ================= Movimientos ================= */
function Movimientos({ api, filtroInicial }) {
  const hoy = hoyCL();
  const [filtro, setFiltro] = useState({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, tipo: "", origen: "", cuenta: "", categoria: "", q: "", conAnulados: false, sinRespaldo: false, ...(filtroInicial || {}) });
  const { cargando, error, datos, recargar } = useCarga(() => api("fin.movimientos", filtro), [api, JSON.stringify(filtro)]);
  const [form, setForm] = useState(null); // null | "nuevo" | movimiento
  const [anular, setAnular] = useState(null);
  const [aviso, setAviso] = useState("");
  const set = (k, v) => setFiltro((x) => ({ ...x, [k]: v }));
  const cuentas = (datos && datos.cuentas) || [];
  const nombreCuenta = (clave, localId) => { const k = claveDe(clave, localId); const c = cuentas.find((x) => x.clave === k); return c ? c.nombre : clave ? "Otra cuenta" : "Caja (efectivo)"; };
  const descargar = () => {
    const csv = movimientosCsv(datos.movimientos, (id) => nombreCuenta(id, null));
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `movimientos_${filtro.desde}_${filtro.hasta}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const listo = (texto) => { setForm(null); setAnular(null); setAviso(texto); recargar(); };
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-stone-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <Campo etiqueta="Desde"><input type="date" value={filtro.desde} onChange={(e) => set("desde", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={filtro.hasta} onChange={(e) => set("hasta", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Tipo">
          <select value={filtro.tipo} onChange={(e) => set("tipo", e.target.value)} className={INPUT}><option value="">Todos</option><option value="ingreso">Ingresos</option><option value="egreso">Egresos</option><option value="traspaso">Traspasos</option></select>
        </Campo>
        <Campo etiqueta="Origen">
          <select value={filtro.origen} onChange={(e) => set("origen", e.target.value)} className={INPUT}><option value="">Todos</option><option value="crm">Del CRM (ventas, reservas, compras)</option><option value="manual">Manuales</option></select>
        </Campo>
        <Campo etiqueta="Cuenta">
          <select value={filtro.cuenta} onChange={(e) => set("cuenta", e.target.value)} className={INPUT}><option value="">Todas</option>{cuentas.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}</select>
        </Campo>
        <Campo etiqueta="Categoría">
          <select value={filtro.categoria} onChange={(e) => set("categoria", e.target.value)} className={INPUT}>
            <option value="">Todas</option>
            <option value="venta_vehiculo">Pago de venta de vehículo</option><option value="reserva">Pago de reserva</option><option value="compra_vehiculo">Pago por compra de vehículo</option>
            {[...categoriasAgrupadas("egreso"), ...categoriasAgrupadas("ingreso"), ...categoriasAgrupadas("traspaso")].map((g, i) => (
              <optgroup key={`${g.id}-${i}`} label={g.nombre}>{g.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Buscar" className="col-span-2"><input value={filtro.q} onChange={(e) => set("q", e.target.value)} placeholder="Descripción, proveedor, folio, N° documento…" className={INPUT} /></Campo>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {datos && datos.puedeEditar && <button type="button" onClick={() => { setAviso(""); setForm("nuevo"); }} className={BTN_PRIMARIO}>+ Registrar movimiento</button>}
        <button type="button" onClick={descargar} disabled={!datos || !datos.movimientos.length} className={BTN}>Descargar CSV (para el contador)</button>
        <label className="text-sm text-stone-600 flex items-center gap-1.5"><input type="checkbox" checked={filtro.conAnulados} onChange={(e) => set("conAnulados", e.target.checked)} /> Ver anulados</label>
        <label className="text-sm text-stone-600 flex items-center gap-1.5"><input type="checkbox" checked={filtro.sinRespaldo} onChange={(e) => set("sinRespaldo", e.target.checked)} /> Solo sin respaldo</label>
        {datos && datos.sinRespaldo > 0 && !filtro.sinRespaldo && <button type="button" onClick={() => set("sinRespaldo", true)} className="text-sm text-amber-700 hover:underline">⚠ {datos.sinRespaldo} sin respaldo</button>}
        {aviso && <span className="text-sm text-emerald-700">{aviso}</span>}
        {cargando && <span className="text-xs text-stone-400">Cargando…</span>}
      </div>
      {error && !datos && <Aviso>{error}</Aviso>}
      {datos && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Cifra titulo="Ingresos" valor={datos.ingresos} tono="text-emerald-800" />
            <Cifra titulo="Egresos" valor={datos.egresos} tono="text-rose-700" />
            <Cifra titulo="Neto" valor={datos.ingresos - datos.egresos} />
          </div>
          <div className="bg-white border border-stone-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Folio</th><th className="text-left px-3 py-2">Detalle</th><th className="text-left px-3 py-2">Categoría</th><th className="text-left px-3 py-2">Cuenta</th><th className="text-right px-3 py-2">Monto</th>{datos.puedeEditar && <th className="px-3 py-2" />}</tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {datos.movimientos.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-stone-500">No hay movimientos con esos filtros.</td></tr>}
                {datos.movimientos.map((m) => {
                  const anulado = m.estado === "anulado";
                  return (
                    <tr key={m.id} className={anulado ? "text-stone-400 line-through" : ""}>
                      <td className="px-3 py-2 whitespace-nowrap">{fechaCL(m.fecha)}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="font-mono text-xs">{m.folio}</span><span className="block text-[11px] text-stone-400 no-underline">{ORIGEN[m.origen] || m.origen}</span></td>
                      <td className="px-3 py-2 min-w-[14rem]">{m.descripcion}{m.contraparte && <span className="block text-xs text-stone-500">{m.contraparte}</span>}{m.vehiculo && <span className="block text-xs text-stone-500">🚗 {m.vehiculo}</span>}{m.documento_numero && <span className="block text-xs text-stone-500">{(DOCUMENTOS_FIN.find((d) => d.id === m.documento_tipo) || { nombre: "Ref." }).nombre} {m.documento_numero}</span>}{anulado && m.motivo_anulacion && <span className="block text-xs">Anulado: {m.motivo_anulacion}</span>}
                        {(m.archivos || []).length > 0 && <span className="block mt-0.5"><ChipsRespaldo archivos={m.archivos} /></span>}
                        {faltaRespaldo(m) && <span className="block mt-0.5 text-xs text-amber-700">⚠ Falta respaldo{datos.puedeEditar && <> · <button type="button" onClick={() => { setAviso(""); setForm(m); }} className="underline">adjuntar</button></>}</span>}
                        {m.recurrente && <span className="block text-[11px] text-stone-400">Gasto fijo mensual</span>}</td>
                      <td className="px-3 py-2 min-w-[10rem]">{(categoriaFin(m.categoria) || { nombre: m.categoria }).nombre}</td>
                      <td className="px-3 py-2 text-xs">{nombreCuenta(m.cuenta_id, m.local_id)}{m.tipo === "traspaso" && <> → {nombreCuenta(m.cuenta_destino_id, m.local_id)}</>}</td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${m.tipo === "ingreso" ? "text-emerald-700" : m.tipo === "egreso" ? "text-rose-700" : "text-stone-700"}`}>{m.tipo === "traspaso" ? "⇄ " : ""}{clp(signo(m) * m.monto)}</td>
                      {datos.puedeEditar && (
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          {m.origen === "manual" && !anulado && <>
                            <button type="button" onClick={() => { setAviso(""); setForm(m); }} className="text-xs text-stone-700 hover:underline mr-2">Editar</button>
                            <button type="button" onClick={() => { setAviso(""); setAnular(m); }} className="text-xs text-rose-600 hover:underline">Anular</button>
                          </>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {datos.total > datos.movimientos.length && <p className="text-xs text-stone-500">Se muestran {datos.movimientos.length} de {datos.total}: acota las fechas para ver el resto.</p>}
          <p className="text-xs text-stone-500">Los pagos de ventas, reservas y compras vienen del CRM: se corrigen o anulan en la venta o compra correspondiente.</p>
        </>
      )}
      {form && <FormMovimiento api={api} cuentas={cuentas} inicial={form === "nuevo" ? null : form} onCerrar={() => setForm(null)} onListo={() => listo(form === "nuevo" ? "Movimiento registrado." : "Movimiento actualizado.")} />}
      {anular && <AnularMovimiento api={api} mov={anular} onCerrar={() => setAnular(null)} onListo={() => listo("Movimiento anulado.")} />}
    </div>
  );
}

/* ================= Bancos y caja ================= */
function SaldoInicial({ api, cuenta, onCerrar, onListo }) {
  const [saldo, setSaldo] = useState(cuenta.desde ? String(cuenta.inicial) : "");
  const [desde, setDesde] = useState(cuenta.desde || `${hoyCL().slice(0, 7)}-01`);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const guardar = async () => {
    setOcupado(true); setMsg("");
    try { await api("fin.saldo_guardar", { clave: cuenta.clave, saldoInicial: Number(saldo || 0), desde }); onListo(); }
    catch (e) { setMsg(mensajeError(e)); setOcupado(false); }
  };
  return (
    <Modal titulo={`Saldo inicial · ${cuenta.nombre}`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-stone-600">Lo que había en la cuenta al comenzar el día elegido (según la cartola). Desde ese día el CRM suma y resta los movimientos; los anteriores no cuentan.</p>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Saldo al inicio"><InputDinero value={saldo} onChange={(e) => setSaldo(e.target.value)} className={INPUT} placeholder="0" /></Campo>
          <Campo etiqueta="Desde el día"><input type="date" value={desde} max={hoyCL()} onChange={(e) => setDesde(e.target.value)} className={INPUT} /></Campo>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={guardar} disabled={ocupado} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={onCerrar} className={BTN}>Cancelar</button>
          {msg && <p className="text-sm text-rose-600">{msg}</p>}
        </div>
      </div>
    </Modal>
  );
}

function BancosYCaja({ api }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("fin.resumen", {}), [api]);
  const conc = useCarga(() => api("fin.conciliaciones", {}).catch(() => ({ conciliaciones: {} })), [api]);
  const [editar, setEditar] = useState(null);
  const [conciliar, setConciliar] = useState(null);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const ultima = (clave) => conc.datos && conc.datos.conciliaciones && conc.datos.conciliaciones[clave];
  if (conciliar) return <Conciliacion api={api} cuenta={conciliar} puedeEditar={datos.puedeEditar} onCerrar={() => { setConciliar(null); recargar(); conc.recargar(); }} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {datos.cuentas.map((c) => (
          <div key={c.clave} className="bg-white border border-stone-200 p-4 flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-stone-500">{c.tipo === "banco" ? "Banco" : c.tipo === "caja" ? "Efectivo" : "Documentos"}</span>
            <span className="font-medium text-stone-900">{c.nombre}</span>
            <span className={`text-2xl font-semibold ${c.saldo < 0 ? "text-rose-700" : "text-stone-900"}`}>{clp(c.saldo)}</span>
            <span className="text-xs text-stone-500">{c.desde ? `Partió con ${clp(c.inicial)} el ${fechaCL(c.desde)}` : "Sin saldo inicial: se cuenta desde el primer movimiento"} · entró {clp(c.ingresos)} · salió {clp(c.egresos)}</span>
            {c.tipo === "banco" && (() => {
              const u = ultima(c.clave);
              return u ? (
                <span className={`text-xs ${u.diferencia === 0 && u.faltan === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                  {u.diferencia === 0 && u.faltan === 0 ? "✓ Cuadrada" : `⚠ ${u.faltan ? `${u.faltan} por registrar` : ""}${u.faltan && u.diferencia ? " · " : ""}${u.diferencia ? `diferencia ${clp(u.diferencia)}` : ""}`} con la cartola al {fechaCL(u.hasta)}
                </span>
              ) : <span className="text-xs text-stone-400">Sin conciliar con el banco</span>;
            })()}
            <div className="flex flex-wrap gap-3 mt-1">
              {c.tipo === "banco" && <button type="button" onClick={() => setConciliar(c)} className="text-xs font-medium text-sky-700 hover:underline">Conciliar con cartola</button>}
              {datos.puedeEditar && <button type="button" onClick={() => setEditar(c)} className="text-xs text-stone-700 hover:underline">{c.desde ? "Cambiar saldo inicial" : "Fijar saldo inicial"}</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-stone-50 border border-stone-200 p-4 text-sm text-stone-700 flex flex-col gap-1">
        <p><strong>Total:</strong> {clp(datos.saldoTotal)}</p>
        <p className="text-xs text-stone-500">Las cuentas bancarias se agregan en la pestaña Ventas → «Cuentas bancarias de la empresa». «Por depositar» junta los pagos de ventas con cheque, tarjeta o crédito de la financiera; cuando el dinero llegue al banco, regístralo como traspaso desde «Por depositar» hacia la cuenta. Usa «Conciliar con cartola» en cada banco: sube la cartola y el CRM te dice qué falta registrar y si el saldo cuadra.</p>
      </div>
      {editar && <SaldoInicial api={api} cuenta={editar} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

/* ================= Rentabilidad ================= */
function Rentabilidad({ api }) {
  const [per, setPer] = useState(hoyCL().slice(0, 7));
  const { cargando, error, datos } = useCarga(() => api("fin.rentabilidad", { periodo: per }), [api, per]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const t = datos.totales;
  const propios = datos.stock.filter((v) => !v.consignado);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-stone-600">Período:</span><SelectorPeriodo valor={per} onCambio={setPer} />{cargando && <span className="text-xs text-stone-400">Actualizando…</span>}</div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Cifra titulo="Autos vendidos" texto={String(t.unidades)} />
        <Cifra titulo="Ventas" valor={t.ventas} />
        <Cifra titulo="Margen total" valor={t.margen} detalle={t.margenPct != null ? `${t.margenPct}% sobre las ventas` : null} />
        <Cifra titulo="Margen promedio por auto" valor={t.promedio} />
      </div>
      <Tarjeta titulo={`Ventas aprobadas · ${nombreMes(per)}`} ayuda="Costo = lo que se pagó por el auto (o lo que recibe el dueño si era consignado) más sus gastos de reparación, traslado y trámites registrados en Movimientos.">
        {datos.ventas.length === 0 ? <p className="text-sm text-stone-500">No hay ventas aprobadas en el período.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500"><tr><th className="text-left py-2 pr-3">Venta</th><th className="text-left py-2 pr-3">Vehículo</th><th className="text-right py-2 pr-3">Precio</th><th className="text-right py-2 pr-3">Costo auto</th><th className="text-right py-2 pr-3">Gastos</th><th className="text-right py-2 pr-3">Margen</th><th className="text-right py-2">%</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {datos.ventas.map((v) => (
                  <tr key={v.id}>
                    <td className="py-2 pr-3 whitespace-nowrap"><span className="font-mono text-xs">{v.folio}</span><span className="block text-[11px] text-stone-400">{fechaCL(v.fecha)}</span></td>
                    <td className="py-2 pr-3">{v.vehiculo}{v.sinCosto && <span className="block text-xs text-amber-700">Sin costo registrado</span>}</td>
                    <td className="py-2 pr-3 text-right">{clp(v.precio)}</td>
                    <td className="py-2 pr-3 text-right">{clp(v.costoCompra)}</td>
                    <td className="py-2 pr-3 text-right">{clp(v.gastos)}</td>
                    <td className={`py-2 pr-3 text-right font-medium ${v.margen < 0 ? "text-rose-700" : "text-emerald-700"}`}>{clp(v.margen)}</td>
                    <td className="py-2 text-right">{v.margenPct != null ? `${v.margenPct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
      <Tarjeta titulo="Inventario" ayuda="Autos en stock: lo invertido (compra + gastos) y el margen que dejaría venderlos al precio de lista. Los consignados no son de la empresa: solo cuentan sus gastos.">
        <p className="text-sm text-stone-700 mb-3">{propios.length} propios con {clp(propios.reduce((s, v) => s + v.invertido, 0))} invertidos · {datos.stock.length - propios.length} consignados.</p>
        {datos.stock.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500"><tr><th className="text-left py-2 pr-3">Vehículo</th><th className="text-right py-2 pr-3">Días</th><th className="text-right py-2 pr-3">Invertido</th><th className="text-right py-2 pr-3">Precio lista</th><th className="text-right py-2">Margen esperado</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {datos.stock.map((v) => (
                  <tr key={v.id}>
                    <td className="py-2 pr-3">{v.vehiculo}{v.consignado && <span className="text-xs text-stone-500 ml-2">consignado</span>}{v.sinCosto && <span className="block text-xs text-amber-700">Sin costo registrado</span>}</td>
                    <td className={`py-2 pr-3 text-right ${v.dias > 90 ? "text-rose-700 font-medium" : v.dias > 60 ? "text-amber-700" : ""}`}>{v.dias}</td>
                    <td className="py-2 pr-3 text-right">{clp(v.invertido)}</td>
                    <td className="py-2 pr-3 text-right">{clp(v.precioLista)}</td>
                    <td className={`py-2 text-right ${v.margenEsperado != null && v.margenEsperado < 0 ? "text-rose-700" : ""}`}>{clp(v.margenEsperado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

/* ================= Gastos de operación ================= */
function GastosFijos({ api, mes, cuentas, onListo }) {
  const { cargando, datos, recargar } = useCarga(() => api("fin.fijos", { mes }), [api, mes]);
  const [form, setForm] = useState(null);
  if (cargando && !datos) return null;
  if (!datos || datos.pendientes.length === 0) return null;
  return (
    <Tarjeta titulo={`Gastos fijos por registrar · ${nombreMes(mes)}`} ayuda="Gastos marcados como fijos que se registraron el mes anterior y aún no se registran este mes. Revisa el monto, adjunta la factura y guarda.">
      <div className="text-sm divide-y divide-stone-100">
        {datos.pendientes.map((p) => (
          <div key={p.serie_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><span className="font-medium">{p.descripcion}</span><span className="text-stone-500"> · {(categoriaFin(p.categoria) || {}).nombre}{p.contraparte ? ` · ${p.contraparte}` : ""}</span><span className="block text-xs text-stone-500">Último: {clp(p.monto)} el {fechaCL(p.fecha)}</span></span>
            {datos.puedeEditar && <button type="button" onClick={() => setForm(p)} className={BTN}>Registrar este mes</button>}
          </div>
        ))}
      </div>
      {form && <FormMovimiento api={api} cuentas={cuentas} plantilla={form} onCerrar={() => setForm(null)} onListo={() => { setForm(null); recargar(); onListo(); }} />}
    </Tarjeta>
  );
}

function Gastos({ api, irA }) {
  const meses = useMemo(() => opcionesPeriodo().filter((p) => p.length === 7), []);
  const [hasta, setHasta] = useState(meses[0]);
  const [n, setN] = useState(6);
  const { cargando, error, datos, recargar } = useCarga(() => api("fin.gastos", { hasta, meses: n }), [api, hasta, n]);
  const [form, setForm] = useState(false);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const d = datos;
  const celda = (x) => (x ? clpBase(x) : <span className="text-stone-300">—</span>);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-stone-600">Hasta:</span>
        <select value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${INPUT} !w-auto`}>{meses.map((m) => <option key={m} value={m}>{nombreMes(m).replace(/^./, (c) => c.toUpperCase())}</option>)}</select>
        <select value={n} onChange={(e) => setN(Number(e.target.value))} className={`${INPUT} !w-auto`}><option value={3}>Últimos 3 meses</option><option value={6}>Últimos 6 meses</option><option value={12}>Últimos 12 meses</option></select>
        {d.puedeEditar && <button type="button" onClick={() => setForm(true)} className={BTN_PRIMARIO}>+ Registrar gasto</button>}
        {cargando && <span className="text-xs text-stone-400">Actualizando…</span>}
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Cifra titulo={`Gastos de ${nombreMes(hasta)}`} valor={d.totales[hasta]} tono="text-rose-700" />
        <Cifra titulo="Promedio mensual" valor={d.promedio} detalle={`últimos ${n} meses`} />
        <Cifra titulo="Sin respaldo" texto={String(d.sinRespaldo.cantidad)} tono={d.sinRespaldo.cantidad ? "text-amber-700" : "text-emerald-700"}
          detalle={d.sinRespaldo.cantidad ? <button type="button" onClick={() => irA("movimientos", { sinRespaldo: true, desde: "2000-01-01" })} className="hover:underline">{clp(d.sinRespaldo.monto)} sin factura o boleta → adjuntar</button> : "Todo con respaldo"} />
        <Cifra titulo="Gastos fijos por registrar" texto={String(d.fijosPendientes)} tono={d.fijosPendientes ? "text-amber-700" : "text-stone-900"} detalle={`en ${nombreMes(hasta)}`} />
      </div>
      <GastosFijos api={api} mes={hasta} cuentas={d.cuentas} onListo={recargar} />
      <Tarjeta titulo="Gastos por categoría" ayuda="Lo que se gastó en el negocio cada mes (cuenta en el mes al que corresponde; la nómina pagada al mes siguiente queda en su mes). No incluye los pagos por compras de autos, los gastos asociados a un auto (son parte de su costo) ni los retiros del dueño.">
        {d.grupos.length === 0 ? <p className="text-sm text-stone-500">No hay gastos registrados en estos meses.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500">
                <tr><th className="text-left py-2 pr-3">Categoría</th>{d.meses.map((m) => <th key={m} className="text-right py-2 px-2 whitespace-nowrap">{mesCorto(m)}</th>)}<th className="text-right py-2 pl-2">Total</th></tr>
              </thead>
              <tbody>
                {d.grupos.map((g) => (
                  <React.Fragment key={g.id}>
                    <tr className="bg-stone-50 font-semibold text-stone-800"><td className="py-1.5 pr-3">{g.nombre}</td>{d.meses.map((m) => <td key={m} className="text-right py-1.5 px-2 whitespace-nowrap">{celda(g.meses[m])}</td>)}<td className="text-right py-1.5 pl-2 whitespace-nowrap">{clpBase(g.total)}</td></tr>
                    {g.categorias.map((c) => (
                      <tr key={c.id} className="border-b border-stone-100">
                        <td className="py-1.5 pr-3 pl-4"><button type="button" onClick={() => irA("movimientos", { categoria: c.id, desde: `${d.meses[0]}-01` })} className="text-left hover:underline">{c.nombre}</button></td>
                        {d.meses.map((m) => <td key={m} className="text-right py-1.5 px-2 whitespace-nowrap">{celda(c.meses[m])}</td>)}
                        <td className="text-right py-1.5 pl-2 whitespace-nowrap">{clpBase(c.total)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot className="font-semibold text-stone-900 border-t border-stone-300">
                <tr><td className="py-2 pr-3">Total</td>{d.meses.map((m) => <td key={m} className="text-right py-2 px-2 whitespace-nowrap">{clpBase(d.totales[m])}</td>)}<td className="text-right py-2 pl-2 whitespace-nowrap">{clpBase(d.total)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Tarjeta>
      {form && <FormMovimiento api={api} cuentas={d.cuentas} inicial={null} onCerrar={() => setForm(false)} onListo={() => { setForm(false); recargar(); }} />}
    </div>
  );
}

export function ModuloFinanzas({ api }) {
  const [tab, setTabBase] = useGuardado("finanzas", "resumen", ["resumen", "movimientos", "gastos", "bancos", "nomina", "rentabilidad"]);
  const [filtroMov, setFiltroMov] = useState(null);
  const setTab = (t, filtro = null) => { setFiltroMov(filtro); setTabBase(t); };
  return (
    <div className="flex flex-col gap-5">
      <Pestanas valor={tab} onCambio={setTab} opciones={[["resumen", "Resumen"], ["movimientos", "Movimientos"], ["gastos", "Gastos"], ["bancos", "Bancos y caja"], ["nomina", "Nómina"], ["rentabilidad", "Rentabilidad"]]} />
      {tab === "resumen" && <Resumen api={api} irA={setTab} />}
      {tab === "movimientos" && <Movimientos key={JSON.stringify(filtroMov)} api={api} filtroInicial={filtroMov} />}
      {tab === "gastos" && <Gastos api={api} irA={setTab} />}
      {tab === "bancos" && <BancosYCaja api={api} />}
      {tab === "nomina" && <Nomina api={api} />}
      {tab === "rentabilidad" && <Rentabilidad api={api} />}
    </div>
  );
}
