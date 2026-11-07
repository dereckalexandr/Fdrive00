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

const FORM_VACIO = { medio: "transferencia", monto: "", fechaPago: hoyISO(), cuentaId: "", referencia: "", notas: "" };

/** Formulario para registrar un pago con sus respaldos. */
function FormPago({ api, cierre, datos, onListo, avisar }) {
  const [f, setF] = useState({ ...FORM_VACIO, monto: datos.resumen.falta > 0 ? String(datos.resumen.falta) : "" });
  const [archivos, setArchivos] = useState([]); // [{ id, nombre, tipo, tam, dataUrl }]
  const [ocupado, setOcupado] = useState(false);
  const medio = medioDe(f.medio);
  const sug = datos.sugerencias;

  const elegirArchivos = async (ev) => {
    const lista = Array.from(ev.target.files || []);
    ev.target.value = "";
    avisar("");
    for (const file of lista) {
      try {
        if (archivos.length >= MAX_ARCHIVOS_PAGO) throw new Error("demasiados_archivos");
        const esPdf = file.type === "application/pdf";
        if (!esPdf && !file.type.startsWith("image/")) throw new Error("archivo_tipo_invalido");
        if (esPdf && file.size > MAX_BYTES_ARCHIVO) throw new Error("archivo_muy_grande");
        const dataUrl = esPdf ? await leerComoDataUrl(file) : await compressImage(file);
        setArchivos((a) => [...a, { id: makePhotoId(), nombre: file.name, tipo: esPdf ? "application/pdf" : "image/jpeg", tam: Math.round(dataUrl.length * 0.75), dataUrl }]);
      } catch (e) { avisar(mensajeError(e)); }
    }
  };

  const guardar = async () => {
    avisar(""); setOcupado(true);
    const subidos = [];
    try {
      for (const a of archivos) {
        const ok = await window.storage.set(claveArchivo(cierre.id, a.id), a.dataUrl, true);
        if (!ok) throw new Error("archivo_invalido");
        subidos.push(a);
      }
      await api("cierres.pago_registrar", {
        id: cierre.id,
        pago: { ...f, monto: Number(f.monto), cuentaId: medio && medio.requiereCuenta ? f.cuentaId : "", archivos: archivos.map(({ id, nombre, tipo, tam }) => ({ id, nombre, tipo, tam })) },
      });
      setArchivos([]); setF({ ...FORM_VACIO, monto: "" });
      await onListo();
    } catch (e) {
      for (const a of subidos) { try { await window.storage.delete(claveArchivo(cierre.id, a.id), true); } catch (e2) { /* se limpia luego */ } }
      avisar(mensajeError(e));
    }
    setOcupado(false);
  };

  const listo = Number(f.monto) > 0 && f.fechaPago && (!medio.requiereCuenta || f.cuentaId) && (!medio.requiereReferencia || f.referencia.trim().length >= 3) && (!medio.requiereRespaldo || archivos.length > 0);
  return (
    <div className="border border-stone-200 bg-stone-50 p-3 flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">Registrar un pago</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Campo etiqueta="Medio de pago *">
          <select value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value, cuentaId: "" })} className={INPUT}>{MEDIOS_PAGO.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
        </Campo>
        <Campo etiqueta="Monto ($) *" ayuda={datos.resumen.falta > 0 ? `Falta ${clp(datos.resumen.falta)}` : undefined}><InputDinero value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} className={INPUT} /></Campo>
        <Campo etiqueta="Fecha del pago *"><input type="date" value={f.fechaPago} max={hoyISO()} onChange={(e) => setF({ ...f, fechaPago: e.target.value })} className={INPUT} /></Campo>
        {medio.requiereCuenta && (
          <Campo etiqueta="¿En qué cuenta de la empresa se pagó? *" ayuda={datos.cuentas.length === 0 ? "No hay cuentas registradas: pídele al Jefe Local que las agregue." : undefined} className="md:col-span-2">
            <select value={f.cuentaId} onChange={(e) => setF({ ...f, cuentaId: e.target.value })} className={INPUT}>
              <option value="">Elige la cuenta…</option>
              {datos.cuentas.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
            </select>
          </Campo>
        )}
        <Campo etiqueta={`${medio.referencia}${medio.requiereReferencia ? " *" : ""}`}><input value={f.referencia} maxLength={60} onChange={(e) => setF({ ...f, referencia: e.target.value })} className={INPUT} /></Campo>
        <Campo etiqueta="Nota (opcional)" className="md:col-span-3"><input value={f.notas} maxLength={300} onChange={(e) => setF({ ...f, notas: e.target.value })} className={INPUT} /></Campo>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {archivos.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 border border-stone-300 bg-white px-2 py-1 text-xs">
            {a.tipo === "application/pdf" ? "📄" : "🖼"} <span className="max-w-[160px] truncate">{a.nombre}</span>
            <button type="button" onClick={() => setArchivos((l) => l.filter((x) => x.id !== a.id))} className="text-rose-600 px-1" aria-label="Quitar archivo">✕</button>
          </span>
        ))}
        {archivos.length < MAX_ARCHIVOS_PAGO && (
          <label className={`${BTN} cursor-pointer ${ocupado ? "opacity-50 pointer-events-none" : ""}`}>
            ＋ Adjuntar respaldo{medio.requiereRespaldo ? " *" : ""}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={elegirArchivos} />
          </label>
        )}
        <span className="text-xs text-stone-500">{medio.requiereRespaldo ? "Comprobante, foto del vale vista o recibo (foto o PDF)." : "El respaldo es opcional en este medio."}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={ocupado || !listo} onClick={guardar} className={BTN_AMBAR}>{ocupado ? "Guardando…" : "Registrar pago"}</button>
        {(sug.reserva > 0 || sug.parte_pago > 0 || sug.financiado > 0) && (
          <span className="text-xs text-stone-500">Según el cierre: {[sug.reserva > 0 && `reserva ${clp(sug.reserva)}`, sug.parte_pago > 0 && `parte de pago ${clp(sug.parte_pago)}`, sug.financiado > 0 && `crédito ${clp(sug.financiado)}`].filter(Boolean).join(" · ")}.</span>
        )}
      </div>
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
                  <td className="text-right pl-2">{datos.puedeEditar && <button disabled={ocupado} onClick={() => { setAnulando(p.id); setMotivo(""); }} className="text-rose-600 hover:underline">Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

/** Cuentas bancarias de la empresa (Jefe Local y Administrador). */
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
      {datos.cuentas.length === 0 && <p className="text-sm text-stone-500 mb-3">Todavía no hay cuentas. Agrega la primera para poder registrar pagos por banco.</p>}
      <ul className="flex flex-col gap-1 mb-3">
        {datos.cuentas.map((c) => (
          <li key={c.id} className={`flex flex-wrap items-center gap-3 border border-stone-200 px-3 py-2 text-sm ${c.activa === false ? "opacity-60" : ""}`}>
            <span className="flex-1 min-w-[220px]"><span className="text-stone-900">{c.etiqueta}</span>{(c.titular || c.rut_titular) && <span className="text-stone-500"> · {[c.titular, c.rut_titular].filter(Boolean).join(" · ")}</span>}{c.activa === false && <span className="ml-2 text-xs text-stone-500">(inactiva)</span>}</span>
            <button onClick={() => abrir(c)} className={BTN}>Editar</button>
            <button disabled={ocupado} onClick={() => cambiarActiva(c)} className={BTN}>{c.activa === false ? "Activar" : "Desactivar"}</button>
          </li>
        ))}
      </ul>
      {!editando && <button onClick={() => abrir(null)} className={BTN_AMBAR}>+ Agregar cuenta</button>}
      {editando && (
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
