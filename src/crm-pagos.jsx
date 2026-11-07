/**
 * PAGOS DE LA VENTA Y CUENTAS BANCARIAS DE LA EMPRESA
 * ----------------------------------------------------------------
 * PagosVenta: el ejecutivo registra cada pago (medio, monto, fecha, cuenta de la empresa si fue por banco, referencia) con su respaldo.
 * La venta solo se aprueba cuando los pagos suman el precio y traen su respaldo. Con la venta aprobada la lista queda de solo lectura.
 * CuentasEmpresa: las cuentas donde llegan transferencias, depósitos y vales vista (las administra el Jefe Local o el Administrador).
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { MEDIOS_PAGO, medioDe, MAX_ARCHIVOS_PAGO } from "../supabase/functions/api/pagos-core.js";
import { claveArchivo, MAX_BYTES_ARCHIVO } from "../supabase/functions/api/validaciones-core.js";
import { compressImage, makePhotoId } from "./photos.js";
import { InputDinero } from "./campo-dinero.jsx";
import { abrirArchivo } from "./crm-validaciones.jsx";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, Aviso, Cargando, Tarjeta, Campo, useCarga, mensajeError } from "./crm-ui.jsx";

const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const fechaCorta = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("es-CL") : "—");
const leerComoDataUrl = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error("archivo_ilegible"));
  fr.readAsDataURL(file);
});

export const FORM_VACIO = { medio: "transferencia", monto: "", fechaPago: hoyISO(), cuentaId: "", referencia: "", notas: "" };

/** ¿Están todos los datos de un pago? (monto solo si el formulario lo pide). */
export function pagoListo(f, archivos, { conMonto = true } = {}) {
  const medio = medioDe(f.medio);
  return !!medio && (!conMonto || Number(f.monto) > 0) && !!f.fechaPago && (!medio.requiereCuenta || !!f.cuentaId)
    && (!medio.requiereReferencia || f.referencia.trim().length >= 3) && (!medio.requiereRespaldo || archivos.length > 0);
}

/** Sube los respaldos elegidos al almacén (dval::<ns>::<archivo>). Si uno falla, borra los ya subidos y lanza el error. */
export async function subirRespaldos(ns, archivos) {
  const subidos = [];
  try {
    for (const a of archivos) {
      const ok = await window.storage.set(claveArchivo(ns, a.id), a.dataUrl, true);
      if (!ok) throw new Error("archivo_invalido");
      subidos.push(a);
    }
  } catch (e) { await limpiarRespaldos(ns, subidos); throw e; }
  return subidos;
}
export async function limpiarRespaldos(ns, subidos) {
  for (const a of subidos) { try { await window.storage.delete(claveArchivo(ns, a.id), true); } catch (e) { /* se limpia luego */ } }
}
/** Lo que se envía al servidor de cada archivo (sin el contenido). */
export const metaRespaldos = (archivos) => archivos.map(({ id, nombre, tipo, tam }) => ({ id, nombre, tipo, tam }));

/**
 * Los campos de un pago: medio, monto (opcional), fecha, cuenta de la empresa (si fue por banco), referencia, nota y respaldos.
 * El que lo usa guarda el estado (f y archivos) y decide qué hacer al enviar.
 */
export function CamposPago({ f, setF, archivos, setArchivos, cuentas, avisar, conMonto = true, ayudaMonto }) {
  const medio = medioDe(f.medio);
  const elegirArchivos = async (ev) => {
    const lista = Array.from(ev.target.files || []);
    ev.target.value = "";
    avisar("");
    let actuales = archivos.length;
    for (const file of lista) {
      try {
        if (actuales >= MAX_ARCHIVOS_PAGO) throw new Error("demasiados_archivos");
        const esPdf = file.type === "application/pdf";
        if (!esPdf && !file.type.startsWith("image/")) throw new Error("archivo_tipo_invalido");
        if (esPdf && file.size > MAX_BYTES_ARCHIVO) throw new Error("archivo_muy_grande");
        const dataUrl = esPdf ? await leerComoDataUrl(file) : await compressImage(file);
        actuales += 1;
        setArchivos((a) => [...a, { id: makePhotoId(), nombre: file.name, tipo: esPdf ? "application/pdf" : "image/jpeg", tam: Math.round(dataUrl.length * 0.75), dataUrl }]);
      } catch (e) { avisar(mensajeError(e)); }
    }
  };
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Campo etiqueta="Medio de pago *">
          <select value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value, cuentaId: "" })} className={INPUT}>{MEDIOS_PAGO.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
        </Campo>
        {conMonto && <Campo etiqueta="Monto ($) *" ayuda={ayudaMonto}><InputDinero value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} className={INPUT} /></Campo>}
        <Campo etiqueta="Fecha del pago *"><input type="date" value={f.fechaPago} max={hoyISO()} onChange={(e) => setF({ ...f, fechaPago: e.target.value })} className={INPUT} /></Campo>
        {medio.requiereCuenta && (
          <Campo etiqueta="¿En qué cuenta de la empresa se pagó? *" ayuda={cuentas.length === 0 ? "No hay cuentas registradas: pídele al Administrador que las agregue." : undefined} className="md:col-span-2">
            <select value={f.cuentaId} onChange={(e) => setF({ ...f, cuentaId: e.target.value })} className={INPUT}>
              <option value="">Elige la cuenta…</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
            </select>
          </Campo>
        )}
        <Campo etiqueta={`${medio.referencia}${medio.requiereReferencia ? " *" : ""}`}><input value={f.referencia} maxLength={60} onChange={(e) => setF({ ...f, referencia: e.target.value })} className={INPUT} /></Campo>
        {"notas" in f && <Campo etiqueta="Nota (opcional)" className="md:col-span-3"><input value={f.notas} maxLength={300} onChange={(e) => setF({ ...f, notas: e.target.value })} className={INPUT} /></Campo>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {archivos.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 border border-stone-300 bg-white px-2 py-1 text-xs">
            {a.tipo === "application/pdf" ? "📄" : "🖼"} <span className="max-w-[160px] truncate">{a.nombre}</span>
            <button type="button" onClick={() => setArchivos((l) => l.filter((x) => x.id !== a.id))} className="text-rose-600 px-1" aria-label="Quitar archivo">✕</button>
          </span>
        ))}
        {archivos.length < MAX_ARCHIVOS_PAGO && (
          <label className={`${BTN} cursor-pointer`}>
            ＋ Adjuntar respaldo{medio.requiereRespaldo ? " *" : ""}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={elegirArchivos} />
          </label>
        )}
        <span className="text-xs text-stone-500">{medio.requiereRespaldo ? "Comprobante, foto del vale vista o recibo (foto o PDF)." : "El respaldo es opcional en este medio."}</span>
      </div>
    </>
  );
}

/** Formulario para registrar un pago de la venta con sus respaldos. */
function FormPago({ api, cierre, datos, onListo, avisar }) {
  const [f, setF] = useState({ ...FORM_VACIO, monto: datos.resumen.falta > 0 ? String(datos.resumen.falta) : "" });
  const [archivos, setArchivos] = useState([]); // [{ id, nombre, tipo, tam, dataUrl }]
  const [ocupado, setOcupado] = useState(false);
  const sug = datos.sugerencias;

  const guardar = async () => {
    avisar(""); setOcupado(true);
    let subidos = [];
    try {
      subidos = await subirRespaldos(cierre.id, archivos);
      const medio = medioDe(f.medio);
      await api("cierres.pago_registrar", { id: cierre.id, pago: { ...f, monto: Number(f.monto), cuentaId: medio.requiereCuenta ? f.cuentaId : "", archivos: metaRespaldos(archivos) } });
      setArchivos([]); setF({ ...FORM_VACIO, monto: "" });
      await onListo();
    } catch (e) { await limpiarRespaldos(cierre.id, subidos); avisar(mensajeError(e)); }
    setOcupado(false);
  };

  return (
    <div className="border border-stone-200 bg-stone-50 p-3 flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">Registrar un pago</p>
      <CamposPago f={f} setF={setF} archivos={archivos} setArchivos={setArchivos} cuentas={datos.cuentas} avisar={avisar} ayudaMonto={datos.resumen.falta > 0 ? `Falta ${clp(datos.resumen.falta)}` : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={ocupado || !pagoListo(f, archivos)} onClick={guardar} className={BTN_AMBAR}>{ocupado ? "Guardando…" : "Registrar pago"}</button>
        {(sug.parte_pago > 0 || sug.financiado > 0) && (
          <span className="text-xs text-stone-500">Según el cierre: {[sug.parte_pago > 0 && `parte de pago ${clp(sug.parte_pago)}`, sug.financiado > 0 && `crédito ${clp(sug.financiado)}`].filter(Boolean).join(" · ")}. La reserva ya está descontada.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Estado del pago de una reserva y sus acciones: el Jefe Local o el Validador la valida o la rechaza (con motivo);
 * el ejecutivo corrige los datos de una reserva rechazada y la vuelve a enviar.
 */
export function PagoReserva({ api, reserva, puedeValidar, puedeCorregir, onCambio, avisar }) {
  const estado = reserva.pago_estado;
  const [modo, setModo] = useState(""); // "" | rechazar | corregir
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [f, setF] = useState({ medio: "transferencia", fechaPago: hoyISO(), cuentaId: "", referencia: "" });
  const [archivos, setArchivos] = useState([]);
  const { datos: ctas } = useCarga(() => (modo === "corregir" ? api("cuentas.list", {}) : Promise.resolve({ cuentas: [] })), [api, modo]);
  if (!estado) return null; // reserva antigua: sin validación

  const correr = async (fn) => { avisar(""); setOcupado(true); try { await fn(); setModo(""); setMotivo(""); await onCambio(); } catch (e) { avisar(mensajeError(e)); } setOcupado(false); };
  const corregir = () => correr(async () => {
    let subidos = [];
    try {
      const ns = reserva.cotizacion_id || reserva.id;
      subidos = await subirRespaldos(ns, archivos);
      const medio = medioDe(f.medio);
      await api("reservas.pago_corregir", { id: reserva.id, pago: { medio: f.medio, fechaPago: f.fechaPago, cuentaId: medio.requiereCuenta ? f.cuentaId : "", referencia: f.referencia, archivos: metaRespaldos(archivos) } });
      setArchivos([]);
    } catch (e) { await limpiarRespaldos(reserva.cotizacion_id || reserva.id, subidos); throw e; }
  });
  const etiqueta = estado === "validado" ? "Pago de la reserva validado" : estado === "rechazado" ? "Pago de la reserva rechazado" : "Pago de la reserva por validar";
  const clase = estado === "validado" ? "bg-emerald-100 text-emerald-800" : estado === "rechazado" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800";
  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs px-2 py-0.5 ${clase}`}>{etiqueta}{estado !== "pendiente" && reserva.pago_validado_por ? ` por ${reserva.pago_validado_por}` : ""}</span>
        {estado === "rechazado" && (reserva.pago_motivo_rechazo || reserva.motivo_rechazo) && <span className="text-xs text-rose-700">{reserva.pago_motivo_rechazo || reserva.motivo_rechazo}</span>}
        {puedeValidar && estado === "pendiente" && (
          <>
            <button disabled={ocupado} onClick={() => correr(() => api("reservas.validar_pago", { id: reserva.id, aprueba: true }))} className={BTN_AMBAR}>Validar pago</button>
            <button disabled={ocupado} onClick={() => setModo(modo === "rechazar" ? "" : "rechazar")} className={BTN}>Rechazar…</button>
          </>
        )}
        {puedeCorregir && estado === "rechazado" && <button disabled={ocupado} onClick={() => setModo(modo === "corregir" ? "" : "corregir")} className={BTN_AMBAR}>Corregir y reenviar</button>}
      </div>
      {estado === "pendiente" && !puedeValidar && <p className="text-xs text-stone-500">El Jefe Local o el Validador debe validar este pago antes de aprobar la venta.</p>}
      {modo === "rechazar" && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del rechazo" className={`${INPUT} md:w-72`} />
          <button disabled={ocupado || motivo.trim().length < 3} onClick={() => correr(() => api("reservas.validar_pago", { id: reserva.id, aprueba: false, motivo }))} className={BTN_PRIMARIO}>Rechazar pago</button>
        </div>
      )}
      {modo === "corregir" && (
        <div className="border border-stone-200 bg-stone-50 p-3 flex flex-col gap-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Corregir el pago de la reserva ({clp(reserva.monto)})</p>
          <CamposPago f={f} setF={setF} archivos={archivos} setArchivos={setArchivos} cuentas={(ctas && ctas.cuentas) || []} avisar={avisar} conMonto={false} />
          <div><button disabled={ocupado || !pagoListo(f, archivos, { conMonto: false })} onClick={corregir} className={BTN_AMBAR}>Reenviar a validar</button></div>
        </div>
      )}
    </div>
  );
}

/** Los pagos de una venta: lista, resumen y (mientras espera aprobación) el formulario para registrar más. */
export function PagosVenta({ api, cierre, avisar, onCambio = () => {} }) {
  const [version, setVersion] = useState(0);
  const [anulando, setAnulando] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { cargando, error, datos, recargar } = useCarga(() => api("cierres.pagos", { id: cierre.id }), [api, cierre.id, cierre.estado, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const vigentes = datos.pagos.filter((p) => p.estado !== "anulado");
  const filaReserva = vigentes.find((p) => p.origen === "reserva");
  const reserva = filaReserva && filaReserva.pago_estado ? { id: filaReserva.reserva_id, monto: filaReserva.monto, pago_estado: filaReserva.pago_estado, pago_motivo_rechazo: filaReserva.motivo_rechazo, pago_validado_por: filaReserva.pago_validado_por, cotizacion_id: filaReserva.cotizacion_id } : null;
  const anulados = datos.pagos.filter((p) => p.estado === "anulado");
  const r = datos.resumen;
  const cambio = async () => { await recargar(); setVersion((v) => v + 1); onCambio(); };
  const anular = async (p) => {
    avisar(""); setOcupado(true);
    try { await api("cierres.pago_anular", { id: cierre.id, pagoId: p.id, motivo }); setAnulando(""); setMotivo(""); await cambio(); } catch (e) { avisar(mensajeError(e)); }
    setOcupado(false);
  };

  return (
    <div className="flex flex-col gap-2 mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs uppercase tracking-wide text-stone-500">Pagos de la venta</p>
        <span className={`text-xs px-2 py-0.5 ${r.cuadra ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {r.cuadra ? `Cuadran: ${clp(r.total)}` : r.sobra > 0 ? `Sobran ${clp(r.sobra)}` : `Registrado ${clp(r.total)} de ${clp(datos.precio_final)} · faltan ${clp(r.falta)}`}
        </span>
        {r.sinRespaldo > 0 && <span className="text-xs px-2 py-0.5 bg-rose-100 text-rose-800">{r.sinRespaldo} pago(s) sin respaldo</span>}
      </div>
      {vigentes.length === 0 && <p className="text-xs text-stone-500">Aún no hay pagos registrados.</p>}
      {vigentes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="text-left uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-1.5 pr-3">Fecha</th><th className="pr-3">Medio</th><th className="pr-3">Cuenta de la empresa</th><th className="pr-3">Referencia</th><th className="pr-3">Respaldo</th><th className="text-right">Monto</th><th></th></tr></thead>
            <tbody>
              {vigentes.map((p) => (
                <tr key={p.id} className="border-b border-stone-100 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fechaCorta(p.fecha_pago)}</td>
                  <td className="pr-3">{p.medio_nombre}</td>
                  <td className="pr-3">{p.cuenta || "—"}</td>
                  <td className="pr-3">{p.referencia || "—"}</td>
                  <td className="pr-3">
                    {(p.archivos || []).length === 0 ? <span className="text-stone-400">Sin respaldo</span> : (p.archivos || []).map((a) => (
                      <button key={a.id} type="button" onClick={() => abrirArchivo(cierre.id, a)} className="text-sky-700 hover:underline mr-2 whitespace-nowrap">{a.tipo === "application/pdf" ? "📄" : "🖼"} {a.nombre.length > 18 ? `${a.nombre.slice(0, 16)}…` : a.nombre}</button>
                    ))}
                  </td>
                  <td className="text-right font-mono whitespace-nowrap">{clp(p.monto)}</td>
                  <td className="text-right pl-2">{datos.puedeEditar && p.origen !== "reserva" && <button disabled={ocupado} onClick={() => { setAnulando(p.id); setMotivo(""); }} className="text-rose-600 hover:underline">Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reserva && <PagoReserva api={api} reserva={reserva} puedeValidar={datos.puedeValidarReserva} puedeCorregir={datos.puedeEditar} onCambio={cambio} avisar={avisar} />}
      {anulando && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la anulación" className={`${INPUT} md:w-72`} />
          <button disabled={ocupado || motivo.trim().length < 3} onClick={() => anular(vigentes.find((p) => p.id === anulando))} className={BTN_PRIMARIO}>Anular pago</button>
          <button onClick={() => setAnulando("")} className={BTN}>Cancelar</button>
        </div>
      )}
      {anulados.length > 0 && <p className="text-xs text-stone-400">{anulados.length} pago(s) anulado(s): {anulados.map((p) => `${clp(p.monto)} (${p.medio_nombre})`).join(", ")}.</p>}
      {datos.puedeEditar && <FormPago api={api} cierre={cierre} datos={datos} onListo={cambio} avisar={avisar} />}
    </div>
  );
}

/** Bandeja de pagos de reservas por validar (Jefe Local y Validador): cada reserva con su medio, cuenta, referencia y respaldo, y los botones para validarla o rechazarla. */
export function ReservasPorValidar({ api, version = 0, onCambio = () => {}, abrirLead }) {
  const [msg, setMsg] = useState("");
  const [v, setV] = useState(0);
  const { cargando, error, datos, recargar } = useCarga(() => api("reservas.por_validar", {}), [api, version, v]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const cambio = async () => { await recargar(); setV((x) => x + 1); onCambio(); };
  return (
    <div className="flex flex-col gap-3">
      {msg && <Aviso>{msg}</Aviso>}
      {datos.reservas.length === 0 && <p className="text-sm text-stone-500">No hay pagos de reservas esperando validación. 👌</p>}
      {datos.reservas.map((r) => (
        <div key={r.id} className="bg-white border border-stone-200 p-4 text-sm flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-stone-900 font-medium">{r.cliente || "Cliente"}</span>
            <span className="text-stone-500">· {r.vehiculo}</span>
            <span className="ml-auto font-mono text-stone-900">{clp(r.monto)}</span>
          </div>
          <p className="text-xs text-stone-600">
            {r.medio_nombre} · pagado el {fechaCorta(r.fecha_pago)}{r.cuenta ? ` · cuenta ${r.cuenta}` : ""}{r.referencia ? ` · ref. ${r.referencia}` : ""}
            {r.ejecutivo ? ` · ejecutivo ${r.ejecutivo}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(r.archivos || []).length === 0 ? <span className="text-xs text-stone-400">Sin respaldo</span> : (r.archivos || []).map((a) => (
              <button key={a.id} type="button" onClick={() => abrirArchivo(r.cotizacion_id || r.id, a)} className="text-xs text-sky-700 hover:underline">{a.tipo === "application/pdf" ? "📄" : "🖼"} {a.nombre}</button>
            ))}
            {abrirLead && <button type="button" onClick={() => abrirLead(r.lead_id)} className="text-xs text-stone-600 underline ml-auto">Abrir el lead</button>}
          </div>
          <PagoReserva api={api} reserva={r} puedeValidar puedeCorregir={false} onCambio={cambio} avisar={setMsg} />
        </div>
      ))}
    </div>
  );
}

/** Cuentas bancarias de la empresa: solo el Administrador las crea o modifica; el Jefe Local las ve. */
export function CuentasEmpresa({ api }) {
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState("");
  const [editando, setEditando] = useState(null); // null | "nueva" | cuenta
  const [f, setF] = useState({ banco: "", tipoCuenta: "", numeroCuenta: "", titular: "", rutTitular: "", alias: "" });
  const [ocupado, setOcupado] = useState(false);
  const { cargando, error, datos, recargar } = useCarga(() => api("cuentas.list", {}), [api, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;

  const abrir = (c) => {
    setMsg("");
    setEditando(c || "nueva");
    setF(c ? { banco: c.banco || "", tipoCuenta: c.tipo_cuenta || "", numeroCuenta: c.numero_cuenta || "", titular: c.titular || "", rutTitular: c.rut_titular || "", alias: c.alias || "" } : { banco: "", tipoCuenta: "", numeroCuenta: "", titular: "", rutTitular: "", alias: "" });
  };
  const guardar = async (extra = {}) => {
    setMsg(""); setOcupado(true);
    try {
      await api("cuentas.save", { id: editando && editando !== "nueva" ? editando.id : undefined, datos: { ...f, ...extra } });
      setEditando(null); setVersion((v) => v + 1); await recargar();
    } catch (e) { setMsg(mensajeError(e)); }
    setOcupado(false);
  };
  const cambiarActiva = async (c) => {
    setMsg(""); setOcupado(true);
    try {
      await api("cuentas.save", { id: c.id, datos: { banco: c.banco, tipoCuenta: c.tipo_cuenta, numeroCuenta: c.numero_cuenta, titular: c.titular, rutTitular: c.rut_titular, alias: c.alias, activa: c.activa === false } });
      setVersion((v) => v + 1); await recargar();
    } catch (e) { setMsg(mensajeError(e)); }
    setOcupado(false);
  };

  return (
    <Tarjeta titulo="Cuentas bancarias de la empresa" ayuda="Donde llegan las transferencias, depósitos y vales vista de las ventas. El ejecutivo elige una de estas cuentas al registrar cada pago.">
      {datos.cuentas.length === 0 && <p className="text-sm text-stone-500 mb-3">{datos.puedeEditar ? "Todavía no hay cuentas. Agrega la primera para poder registrar pagos por banco." : "Todavía no hay cuentas. Pídele al Administrador que las agregue para poder registrar pagos por banco."}</p>}
      {!datos.puedeEditar && <p className="text-xs text-stone-500 mb-3">Solo el Administrador puede agregar o modificar las cuentas.</p>}
      <ul className="flex flex-col gap-1 mb-3">
        {datos.cuentas.map((c) => (
          <li key={c.id} className={`flex flex-wrap items-center gap-3 border border-stone-200 px-3 py-2 text-sm ${c.activa === false ? "opacity-60" : ""}`}>
            <span className="flex-1 min-w-[220px]"><span className="text-stone-900">{c.etiqueta}</span>{(c.titular || c.rut_titular) && <span className="text-stone-500"> · {[c.titular, c.rut_titular].filter(Boolean).join(" · ")}</span>}{c.activa === false && <span className="ml-2 text-xs text-stone-500">(inactiva)</span>}</span>
            {datos.puedeEditar && <button onClick={() => abrir(c)} className={BTN}>Editar</button>}
            {datos.puedeEditar && <button disabled={ocupado} onClick={() => cambiarActiva(c)} className={BTN}>{c.activa === false ? "Activar" : "Desactivar"}</button>}
          </li>
        ))}
      </ul>
      {datos.puedeEditar && !editando && <button onClick={() => abrir(null)} className={BTN_AMBAR}>+ Agregar cuenta</button>}
      {datos.puedeEditar && editando && (
        <div className="border border-stone-200 bg-stone-50 p-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Campo etiqueta="Banco *"><input value={f.banco} maxLength={60} onChange={(e) => setF({ ...f, banco: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Tipo de cuenta"><input value={f.tipoCuenta} maxLength={30} placeholder="Cuenta corriente" onChange={(e) => setF({ ...f, tipoCuenta: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Número de cuenta *"><input value={f.numeroCuenta} maxLength={30} onChange={(e) => setF({ ...f, numeroCuenta: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Titular"><input value={f.titular} maxLength={80} onChange={(e) => setF({ ...f, titular: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="RUT del titular"><input value={f.rutTitular} maxLength={14} onChange={(e) => setF({ ...f, rutTitular: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Nombre corto (opcional)"><input value={f.alias} maxLength={40} placeholder="BCI principal" onChange={(e) => setF({ ...f, alias: e.target.value })} className={INPUT} /></Campo>
          </div>
          <div className="flex gap-2">
            <button disabled={ocupado || f.banco.trim().length < 2 || f.numeroCuenta.trim().length < 4} onClick={() => guardar()} className={BTN_PRIMARIO}>Guardar cuenta</button>
            <button onClick={() => setEditando(null)} className={BTN}>Cancelar</button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-rose-600 mt-2">{msg}</p>}
    </Tarjeta>
  );
}
