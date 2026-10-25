/**
 * COMPRAS Y CONSIGNACIONES (CRM · entrega 10)
 * ----------------------------------------------------------------
 * COMPRA: el ejecutivo lleva un lead de compra → pide la tasación → hace una oferta (nunca sobre lo tasado) → el cliente
 * acepta → se revisan los documentos → pide aprobar el pago → el Jefe Local aprueba y el vehículo entra al inventario.
 * CONSIGNACIÓN: contrato con precio piso y precio de publicación → documentos validados → el vehículo entra al inventario
 * como consignado (no se puede vender bajo el piso) → al venderse, el margen sobre el piso paga la comisión.
 * El servidor valida todo; aquí solo se muestra lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { InputDinero } from "./campo-dinero.jsx";
import { MEDIOS_PAGO } from "../supabase/functions/api/ventas-core.js";
import { compraNombre, consignacionNombre, COMPRA_ABIERTA, CONSIGNACION_ABIERTA, validarOferta, validarConsignacion } from "../supabase/functions/api/compras-core.js";
import { ResultadoTasacion } from "./crm-tasaciones.jsx";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, hace, Aviso, Cargando, Tarjeta, Campo, Pestanas, useCarga, mensajeError, DatosDelDueno } from "./crm-ui.jsx";

const COLOR_COMPRA = { oferta: "bg-amber-100 text-amber-800", aceptada: "bg-sky-100 text-sky-800", pago_pendiente: "bg-violet-100 text-violet-800", comprada: "bg-emerald-100 text-emerald-800", rechazada: "bg-stone-200 text-stone-600", anulada: "bg-stone-200 text-stone-600", cancelada: "bg-stone-200 text-stone-600" };
const COLOR_CONS = { en_validacion: "bg-amber-100 text-amber-800", vigente: "bg-emerald-100 text-emerald-800", vendida: "bg-sky-100 text-sky-800", devuelta: "bg-stone-200 text-stone-600", cancelada: "bg-stone-200 text-stone-600" };
const Etiqueta = ({ clases, texto }) => <span className={`text-[11px] px-2 py-0.5 ${clases || ""}`}>{texto}</span>;
const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const nombreVeh = (v) => (v && v.marca ? `${v.marca} ${v.modelo || ""} ${v.anio || ""} · ${v.patente || ""}`.replace(/\s+/g, " ").trim() : "");
const fechaCorta = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/* =========================================================
   COMPRA: SECCIÓN EN LA FICHA DEL LEAD
========================================================= */
function Compra({ api, c, puedeOperar, puedeAprobar, cerrado, onCambio, avisar }) {
  const [modo, setModo] = useState(""); // "" | rechazo | pago | rechazarPago | anular | cancelar
  const [motivo, setMotivo] = useState("");
  const [pago, setPago] = useState({ montoFinal: c.monto_oferta, medioPago: "Transferencia", fechaPago: hoyISO(), notas: "" });
  const [ocupado, setOcupado] = useState(false);
  const correr = async (op, extra, despues) => {
    avisar(""); setOcupado(true);
    try { await api(op, { id: c.id, ...extra }); setModo(""); setMotivo(""); await onCambio(); if (despues) despues(); } catch (e) { avisar(mensajeError(e)); }
    setOcupado(false);
  };
  const v = c.validacion;
  return (
    <div className="border border-stone-300 p-3 text-sm flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-stone-500">{c.folio}</span><Etiqueta clases={COLOR_COMPRA[c.estado]} texto={compraNombre(c.estado)} />
        <span className="ml-auto font-mono text-stone-900">{clp(c.estado === "comprada" || c.estado === "pago_pendiente" ? c.monto_final : c.monto_oferta)}</span>
      </div>
      <p className="text-xs text-stone-500">
        Oferta {clp(c.monto_oferta)} · tasado en {clp(c.valor_tasado)} · {hace(c.creado_en)} por {c.ejecutivo}
        {c.estado === "comprada" && c.mes ? ` · aprobada por ${c.aprobado_por}, cuenta para la comisión de ${c.mes}` : ""}
        {c.medio_pago ? ` · pago por ${c.medio_pago}${c.fecha_pago ? ` el ${fechaCorta(c.fecha_pago)}` : ""}` : ""}
      </p>
      {c.estado === "rechazada" && c.motivo && <p className="text-xs text-stone-600">El cliente rechazó: {c.motivo}</p>}
      {c.motivo_rechazo_pago && c.estado === "aceptada" && <p className="text-xs text-rose-700">Pago rechazado por el supervisor: {c.motivo_rechazo_pago}. Corrígelo y vuelve a solicitarlo.</p>}
      {(c.estado === "aceptada" || c.estado === "pago_pendiente") && v && v.estado !== "aprobada" && <p className="text-xs text-amber-700">Documentos: {v.folio} está «{({ pendiente: "esperando a un Validador", en_revision: "en revisión", observada: "con observaciones", rechazada: "rechazada" })[v.estado] || v.estado}». El pago no se aprueba hasta que estén validados.</p>}

      {puedeOperar && !cerrado && c.estado === "oferta" && modo === "" && (
        <div className="flex flex-wrap gap-2"><button disabled={ocupado} onClick={() => correr("compras.responder", { acepta: true })} className={BTN_AMBAR}>El cliente aceptó</button><button onClick={() => setModo("rechazo")} className={BTN}>El cliente rechazó</button><button onClick={() => setModo("cancelar")} className={BTN}>Cancelar</button></div>
      )}
      {puedeOperar && c.estado === "aceptada" && modo === "" && (
        <div className="flex flex-wrap gap-2"><button onClick={() => setModo("pago")} className={BTN_AMBAR}>Solicitar la aprobación del pago</button><button onClick={() => setModo("cancelar")} className={BTN}>Cancelar</button></div>
      )}
      {c.estado === "pago_pendiente" && modo === "" && (
        <div className="flex flex-wrap gap-2">
          {puedeAprobar && <><button disabled={ocupado} onClick={() => correr("compras.aprobar")} className={BTN_AMBAR}>Aprobar compra</button><button onClick={() => setModo("rechazarPago")} className={BTN}>Rechazar el pago</button></>}
          {puedeOperar && !puedeAprobar && <p className="text-xs text-stone-500">Esperando la aprobación del Jefe Local (pedida por {c.solicitado_por}).</p>}
          {(puedeOperar || puedeAprobar) && <button onClick={() => setModo("cancelar")} className={BTN}>Cancelar</button>}
        </div>
      )}
      {puedeAprobar && c.estado === "comprada" && modo === "" && <div><button onClick={() => setModo("anular")} className={BTN}>Anular la compra…</button></div>}

      {modo === "pago" && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border-t border-stone-100 pt-3">
          <Campo etiqueta="Monto a pagar ($)" ayuda={`Hasta ${clp(c.monto_oferta)}`}><InputDinero value={pago.montoFinal} onChange={(e) => setPago({ ...pago, montoFinal: e.target.value })} className={`${INPUT} font-mono`} /></Campo>
          <Campo etiqueta="Medio de pago"><select value={pago.medioPago} onChange={(e) => setPago({ ...pago, medioPago: e.target.value })} className={INPUT}>{MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}</select></Campo>
          <Campo etiqueta="Fecha del pago"><input type="date" value={pago.fechaPago} onChange={(e) => setPago({ ...pago, fechaPago: e.target.value })} className={INPUT} /></Campo>
          <div className="flex gap-2"><button disabled={ocupado} onClick={() => correr("compras.solicitarPago", { datos: pago })} className={BTN_PRIMARIO}>Solicitar</button><button onClick={() => setModo("")} className={BTN}>Volver</button></div>
          <Campo etiqueta="Notas (opcional)" className="md:col-span-4"><input value={pago.notas} maxLength={300} onChange={(e) => setPago({ ...pago, notas: e.target.value })} className={INPUT} /></Campo>
        </div>
      )}
      {["rechazo", "rechazarPago", "anular", "cancelar"].includes(modo) && (
        <div className="flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3">
          <Campo etiqueta={{ rechazo: "¿Por qué rechazó el cliente?", rechazarPago: "¿Por qué se rechaza el pago?", anular: "¿Por qué se anula la compra?", cancelar: "¿Por qué se cancela?" }[modo]} className="flex-1 min-w-[220px]"><input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} className={INPUT} /></Campo>
          <button disabled={ocupado || motivo.trim().length < 3} onClick={() => (modo === "rechazo" ? correr("compras.responder", { acepta: false, motivo }) : correr({ rechazarPago: "compras.rechazarPago", anular: "compras.anular", cancelar: "compras.cancelar" }[modo], { motivo }))} className={BTN_PRIMARIO}>Confirmar</button>
          <button onClick={() => { setModo(""); setMotivo(""); }} className={BTN}>Volver</button>
        </div>
      )}
    </div>
  );
}

export function SeccionCompra({ api, lead, datos, onCambio, avisar }) {
  const { datos: lista, recargar } = useCarga(() => api("compras.list", { vista: "lead", leadId: lead.id }), [api, lead.id, datos.eventos.length]);
  const { datos: tas, recargar: recargarTas } = useCarga(() => api("compras.tasaciones", { leadId: lead.id }), [api, lead.id, datos.eventos.length]);
  const [oferta, setOferta] = useState({ tasacionId: "", monto: "", notas: "" });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  if (!lista || !tas) return <Cargando />;
  const cerrado = lead.etapa === "ganado" || lead.etapa === "perdido";
  const puedeOperar = datos.puedeEditar;
  const abierta = lista.compras.some((c) => COMPRA_ABIERTA.includes(c.estado));
  const completas = tas.tasaciones;
  // Solo se puede ofertar sobre tasaciones que el Tasador dejó como aplicables a compra (o anteriores a esta decisión).
  const ofertables = completas.filter((t) => !t.aplica_para || t.aplica_para === "compra");
  const cambio = async () => { await recargar(); await recargarTas(); await onCambio(); };
  const elegida = ofertables.find((t) => t.id === (oferta.tasacionId || (ofertables[0] && ofertables[0].id)));
  const o = lead.vehiculo_ofrecido || {};

  const pedirTasacion = async () => { avisar(""); setOcupado(true); try { await api("compras.pedirTasacion", { leadId: lead.id }); await cambio(); } catch (e) { avisar(mensajeError(e)); } setOcupado(false); };
  const ofertar = async () => {
    setError("");
    const monto = oferta.monto === "" ? elegida.valor_compra : Number(oferta.monto);
    const val = validarOferta({ monto }, { estado: "completada", valor_compra: elegida.valor_compra, patente: o.patente }, o.patente);
    if (!val.ok) { setError(mensajeError({ message: val.error })); return; }
    setOcupado(true);
    try { await api("compras.ofertar", { leadId: lead.id, tasacionId: elegida.id, datos: { monto, notas: oferta.notas } }); setOferta({ tasacionId: "", monto: "", notas: "" }); await cambio(); } catch (e) { setError(mensajeError(e)); }
    setOcupado(false);
  };

  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
      <p className="text-sm text-stone-700">Compra del vehículo</p>
      <DatosDelDueno o={o} />
      <p className="text-xs text-stone-500">Vehículo que ofrece el cliente: <strong className="text-stone-800">{nombreVeh(o) || "sin datos"}</strong>{o.km != null ? ` · ${Number(o.km).toLocaleString("es-CL")} km` : ""}</p>

      {!abierta && !cerrado && puedeOperar && (
        <div className="border border-stone-200 bg-stone-50 p-3 flex flex-col gap-3">
          <p className="text-xs uppercase tracking-wide text-stone-400">1 · Tasación</p>
          {completas.length > 0 ? (
            <div className="text-sm text-stone-700">
              <p><span className="text-xs uppercase text-stone-400">Resultado del Tasador · {completas[0].folio}: </span><ResultadoTasacion t={completas[0]} /> {ofertables.length > 0 && "El monto de compra es lo máximo que puedes ofrecer."}</p>
              {completas[0].observaciones && <p className="text-xs text-stone-500 mt-1">Observaciones: {completas[0].observaciones}</p>}
              {ofertables.length === 0 && <p className="mt-2 text-rose-700">El Tasador indicó que este vehículo no aplica para compra, así que no se puede ofertar. {completas[0].aplica_para === "consignacion" ? "Si el lead cambió a Consignación, sigue desde la ficha." : "Puedes pedir una nueva tasación o marcar el lead como perdido."}</p>}
            </div>
          ) : tas.pendiente ? (
            <p className="text-sm text-stone-700">La tasación {tas.pendiente.folio} está {tas.pendiente.estado === "pendiente" ? "esperando a un Tasador" : "en proceso"}. Cuando termine podrás ofertar.</p>
          ) : (
            <div className="flex items-center gap-3"><p className="text-sm text-stone-700">Aún no hay una tasación de este vehículo.</p><button disabled={ocupado} onClick={pedirTasacion} className={BTN_AMBAR}>Pedir tasación</button></div>
          )}
          {ofertables.length > 0 && elegida && (
            <>
              <p className="text-xs uppercase tracking-wide text-stone-400">2 · Oferta al cliente</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                {ofertables.length > 1 && <Campo etiqueta="Tasación"><select value={oferta.tasacionId || ofertables[0].id} onChange={(e) => setOferta({ ...oferta, tasacionId: e.target.value })} className={INPUT}>{ofertables.map((t) => <option key={t.id} value={t.id}>{t.folio} · {clp(t.valor_compra)}</option>)}</select></Campo>}
                <Campo etiqueta="Monto ofrecido ($)" ayuda={`Máximo ${clp(elegida.valor_compra)}`}><InputDinero value={oferta.monto === "" ? elegida.valor_compra : oferta.monto} onChange={(e) => setOferta({ ...oferta, monto: e.target.value })} className={`${INPUT} font-mono`} /></Campo>
                <Campo etiqueta="Nota (opcional)"><input value={oferta.notas} maxLength={300} onChange={(e) => setOferta({ ...oferta, notas: e.target.value })} className={INPUT} /></Campo>
              </div>
              {error && <Aviso>{error}</Aviso>}
              <div><button disabled={ocupado} onClick={ofertar} className={BTN_AMBAR}>Hacer la oferta</button></div>
            </>
          )}
        </div>
      )}
      {lista.compras.map((c) => <Compra key={c.id} api={api} c={c} puedeOperar={puedeOperar} puedeAprobar={lista.puedeAprobar} cerrado={cerrado && c.estado !== "comprada"} onCambio={cambio} avisar={avisar} />)}
    </div>
  );
}

/* =========================================================
   CONSIGNACIÓN: SECCIÓN EN LA FICHA DEL LEAD
========================================================= */
function Consignacion({ api, c, puedeOperar, onCambio, avisar }) {
  const [modo, setModo] = useState(""); // "" | devolver | cancelar | extender
  const [motivo, setMotivo] = useState("");
  const [dias, setDias] = useState(30);
  const [ocupado, setOcupado] = useState(false);
  const correr = async (op, extra) => { avisar(""); setOcupado(true); try { await api(op, { id: c.id, ...extra }); setModo(""); setMotivo(""); await onCambio(); } catch (e) { avisar(mensajeError(e)); } setOcupado(false); };
  const v = c.validacion;
  return (
    <div className="border border-stone-300 p-3 text-sm flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-stone-500">{c.folio}</span><Etiqueta clases={COLOR_CONS[c.estado]} texto={consignacionNombre(c.estado)} />
        {c.vencida && <Etiqueta clases="bg-rose-100 text-rose-800" texto="Plazo vencido" />}
        <span className="ml-auto font-mono text-stone-900">{clp(c.precio_publicacion)}</span>
      </div>
      <p className="text-xs text-stone-500">
        Piso {clp(c.precio_piso)} · publicación {clp(c.precio_publicacion)} · margen esperado {clp(c.margenEsperado)} · plazo {c.plazo_dias} días
        {c.vence_en && c.estado === "vigente" ? ` · vence el ${fechaCorta(c.vence_en)} (${c.diasRestantes < 0 ? `hace ${-c.diasRestantes} día(s)` : `en ${c.diasRestantes} día(s)`})` : ""}
        {c.estado === "vendida" ? ` · vendida en ${clp(c.precio_venta)}: margen ${clp(c.margen)} sobre el piso` : ""}
      </p>
      {c.estado === "en_validacion" && <p className="text-xs text-amber-700">{v ? `Documentos (${v.folio}): ${({ pendiente: "esperando a un Validador", en_revision: "en revisión", observada: "con observaciones", rechazada: "rechazada" })[v.estado] || v.estado}. ` : ""}El vehículo entrará al inventario cuando se aprueben.</p>}
      {c.estado === "vigente" && <p className="text-xs text-stone-600">El vehículo está en el inventario y no se puede vender por debajo de {clp(c.precio_piso)}.</p>}
      {c.motivo && ["devuelta", "cancelada"].includes(c.estado) && <p className="text-xs text-stone-600">{c.motivo}</p>}
      {puedeOperar && modo === "" && (
        <div className="flex flex-wrap gap-2">
          {c.estado === "vigente" && <><button onClick={() => setModo("extender")} className={BTN}>Extender el plazo</button><button onClick={() => setModo("devolver")} className={BTN}>Devolver al dueño</button></>}
          {c.estado === "en_validacion" && <button onClick={() => setModo("cancelar")} className={BTN}>Cancelar</button>}
        </div>
      )}
      {modo === "extender" && (
        <div className="flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3">
          <Campo etiqueta="Días a sumar"><input type="number" min="7" max="180" value={dias} onChange={(e) => setDias(e.target.value)} className={`${INPUT} w-28 font-mono`} /></Campo>
          <button disabled={ocupado} onClick={() => correr("consignaciones.extender", { dias: Number(dias) })} className={BTN_PRIMARIO}>Extender</button><button onClick={() => setModo("")} className={BTN}>Volver</button>
        </div>
      )}
      {(modo === "devolver" || modo === "cancelar") && (
        <div className="flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3">
          <Campo etiqueta={modo === "devolver" ? "¿Por qué se devuelve el vehículo?" : "¿Por qué se cancela?"} className="flex-1 min-w-[220px]"><input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} className={INPUT} /></Campo>
          <button disabled={ocupado || motivo.trim().length < 3} onClick={() => correr(modo === "devolver" ? "consignaciones.devolver" : "consignaciones.cancelar", { motivo })} className={BTN_PRIMARIO}>Confirmar</button><button onClick={() => { setModo(""); setMotivo(""); }} className={BTN}>Volver</button>
        </div>
      )}
    </div>
  );
}

export function SeccionConsignacion({ api, lead, datos, onCambio, avisar }) {
  const { datos: lista, recargar } = useCarga(() => api("consignaciones.list", { vista: "lead", leadId: lead.id }), [api, lead.id, datos.eventos.length]);
  const tasada = (datos.tasaciones || []).find((t) => t.estado === "completada" && t.tipo !== "parte_pago");
  const [f, setF] = useState({ precioPiso: "", precioPublicacion: tasada && Number(tasada.valor_consignacion) > 0 ? String(tasada.valor_consignacion) : lead.vehiculo_ofrecido && lead.vehiculo_ofrecido.precioEsperado ? String(lead.vehiculo_ofrecido.precioEsperado) : "", plazoDias: 90, notas: "" });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (!lista) return <Cargando />;
  const cerrado = lead.etapa === "ganado" || lead.etapa === "perdido";
  const abierta = lista.consignaciones.some((c) => CONSIGNACION_ABIERTA.includes(c.estado));
  const cambio = async () => { await recargar(); await onCambio(); };
  const o = lead.vehiculo_ofrecido || {};
  const crear = async () => {
    setError("");
    const val = validarConsignacion(f);
    if (!val.ok) { setError(mensajeError({ message: val.error })); return; }
    setOcupado(true);
    try { await api("consignaciones.crear", { leadId: lead.id, datos: f }); await cambio(); } catch (e) { setError(mensajeError(e)); }
    setOcupado(false);
  };
  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
      <p className="text-sm text-stone-700">Consignación del vehículo</p>
      <DatosDelDueno o={o} />
      <p className="text-xs text-stone-500">Vehículo del dueño: <strong className="text-stone-800">{nombreVeh(o) || "sin datos"}</strong>{o.km != null ? ` · ${Number(o.km).toLocaleString("es-CL")} km` : ""}</p>
      {tasada && (
        <div className={`border p-3 text-sm ${tasada.aplica_para === "ninguna" ? "border-rose-300 bg-rose-50" : "border-emerald-300 bg-emerald-50"}`}>
          <span className="text-xs uppercase text-stone-500">Resultado del Tasador · {tasada.folio}: </span><ResultadoTasacion t={tasada} />
          {tasada.observaciones && <p className="text-xs text-stone-600 mt-1">Observaciones: {tasada.observaciones}</p>}
        </div>
      )}
      {!abierta && !cerrado && datos.puedeEditar && lista.consignaciones.every((c) => !["vendida"].includes(c.estado)) && (
        <div className="border border-stone-200 bg-stone-50 p-3 flex flex-col gap-3">
          <p className="text-xs uppercase tracking-wide text-stone-400">Contrato de consignación</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Campo etiqueta="Precio piso ($)" ayuda="Lo mínimo que quiere recibir el dueño."><InputDinero value={f.precioPiso} onChange={(e) => setF({ ...f, precioPiso: e.target.value })} className={`${INPUT} font-mono`} /></Campo>
            <Campo etiqueta="Precio de publicación ($)" ayuda="No puede ser menor que el piso."><InputDinero value={f.precioPublicacion} onChange={(e) => setF({ ...f, precioPublicacion: e.target.value })} className={`${INPUT} font-mono`} /></Campo>
            <Campo etiqueta="Plazo (días)"><input type="number" min="15" max="365" value={f.plazoDias} onChange={(e) => setF({ ...f, plazoDias: e.target.value })} className={`${INPUT} font-mono`} /></Campo>
            <Campo etiqueta="Nota (opcional)"><input value={f.notas} maxLength={300} onChange={(e) => setF({ ...f, notas: e.target.value })} className={INPUT} /></Campo>
          </div>
          {Number(f.precioPublicacion) >= Number(f.precioPiso) && Number(f.precioPiso) > 0 && <p className="text-xs text-stone-600">Si se vende a la publicación, el margen es <strong className="font-mono">{clp(Number(f.precioPublicacion) - Number(f.precioPiso))}</strong>; tu comisión es el 25 % de lo que quede sobre el piso.</p>}
          {error && <Aviso>{error}</Aviso>}
          <div><button disabled={ocupado} onClick={crear} className={BTN_AMBAR}>Registrar la consignación</button></div>
        </div>
      )}
      {lista.consignaciones.map((c) => <Consignacion key={c.id} api={api} c={c} puedeOperar={datos.puedeEditar || lista.puedeSupervisar} onCambio={cambio} avisar={avisar} />)}
    </div>
  );
}

/* =========================================================
   MÓDULO: TODAS LAS COMPRAS Y CONSIGNACIONES
========================================================= */
function ListaCompras({ api, vista, version, abrirLead, onCambio, puedeAprobar }) {
  const [filtro, setFiltro] = useState("");
  const [msg, setMsg] = useState("");
  const { cargando, error, datos, recargar } = useCarga(() => api("compras.list", { vista, estado: filtro || undefined }), [api, vista, filtro, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const aprobar = async (c) => { setMsg(""); try { await api("compras.aprobar", { id: c.id }); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); } };
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-stone-600">Estado:
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${INPUT} md:w-56`}><option value="">Todas</option>{["oferta", "aceptada", "pago_pendiente", "comprada", "rechazada", "anulada", "cancelada"].map((e) => <option key={e} value={e}>{compraNombre(e)}</option>)}</select>
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-3 px-4">Compra</th><th className="py-3 px-4">Vehículo</th><th className="py-3 px-4">Cliente</th><th className="py-3 px-4">Ejecutivo</th><th className="py-3 px-4 text-right">Oferta / pago</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th></tr></thead>
          <tbody>
            {datos.compras.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-stone-500">No hay compras con ese filtro.</td></tr>}
            {datos.compras.map((c) => (
              <tr key={c.id} className="border-b border-stone-100 align-top">
                <td className="py-2.5 px-4"><span className="font-mono text-xs text-stone-500">{c.folio}</span><div className="text-[11px] text-stone-400">{hace(c.creado_en)}</div></td>
                <td className="py-2.5 px-4 text-stone-900">{nombreVeh(c.vehiculo)}</td><td className="py-2.5 px-4 text-stone-700">{c.cliente}</td><td className="py-2.5 px-4 text-stone-700">{c.ejecutivo}</td>
                <td className="py-2.5 px-4 text-right font-mono">{clp(c.estado === "comprada" || c.estado === "pago_pendiente" ? c.monto_final : c.monto_oferta)}</td>
                <td className="py-2.5 px-4"><Etiqueta clases={COLOR_COMPRA[c.estado]} texto={compraNombre(c.estado)} /></td>
                <td className="py-2.5 px-4 text-right whitespace-nowrap">{puedeAprobar && c.estado === "pago_pendiente" && <button onClick={() => aprobar(c)} className={BTN_AMBAR}>Aprobar</button>}{" "}<button onClick={() => abrirLead(c.lead_id)} className={BTN}>Abrir lead</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ListaConsignaciones({ api, vista, version, abrirLead }) {
  const [filtro, setFiltro] = useState("");
  const { cargando, error, datos } = useCarga(() => api("consignaciones.list", { vista, estado: filtro || undefined }), [api, vista, filtro, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-stone-600">Estado:
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${INPUT} md:w-56`}><option value="">Todas</option>{["en_validacion", "vigente", "vendida", "devuelta", "cancelada"].map((e) => <option key={e} value={e}>{consignacionNombre(e)}</option>)}</select>
      </div>
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-3 px-4">Consignación</th><th className="py-3 px-4">Vehículo</th><th className="py-3 px-4">Dueño</th><th className="py-3 px-4">Ejecutivo</th><th className="py-3 px-4 text-right">Piso / publicación</th><th className="py-3 px-4">Vigencia</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th></tr></thead>
          <tbody>
            {datos.consignaciones.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-stone-500">No hay consignaciones con ese filtro.</td></tr>}
            {datos.consignaciones.map((c) => (
              <tr key={c.id} className="border-b border-stone-100 align-top">
                <td className="py-2.5 px-4"><span className="font-mono text-xs text-stone-500">{c.folio}</span><div className="text-[11px] text-stone-400">{hace(c.creado_en)}</div></td>
                <td className="py-2.5 px-4 text-stone-900">{nombreVeh(c.vehiculo)}</td><td className="py-2.5 px-4 text-stone-700">{c.cliente}</td><td className="py-2.5 px-4 text-stone-700">{c.ejecutivo}</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs">{clp(c.precio_piso)}<div className="text-stone-500">{clp(c.precio_publicacion)}</div></td>
                <td className={`py-2.5 px-4 text-xs ${c.vencida ? "text-rose-700" : c.diasRestantes !== null && c.diasRestantes <= 7 ? "text-amber-700" : "text-stone-600"}`}>{c.estado === "vigente" ? (c.vencida ? `Venció hace ${-c.diasRestantes} d` : `${c.diasRestantes} d`) : "—"}</td>
                <td className="py-2.5 px-4"><Etiqueta clases={COLOR_CONS[c.estado]} texto={consignacionNombre(c.estado)} /></td>
                <td className="py-2.5 px-4 text-right"><button onClick={() => abrirLead(c.lead_id)} className={BTN}>Abrir lead</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ModuloCompras({ api, permisos = [], esAdmin = false, abrirLead, version = 0, onCambio = () => {} }) {
  const can = (p) => esAdmin || permisos.includes(p);
  const supervisa = can("leads.asignar");
  const compras = supervisa || can("compras.operar");
  const consig = supervisa || can("consignaciones.operar");
  const [tab, setTab] = useState(compras ? "compras" : "consignaciones");
  const pend = useCarga(() => (supervisa ? api("compras.list", { vista: "pendientes" }).then((r) => r.compras.length).catch(() => 0) : Promise.resolve(0)), [api, version]);
  const opciones = [];
  if (compras) opciones.push(["compras", "Compras", pend.datos || 0]);
  if (consig) opciones.push(["consignaciones", "Consignaciones"]);
  const vista = supervisa ? "local" : "mias";
  return (
    <div className="flex flex-col gap-5">
      <Pestanas valor={tab} onCambio={setTab} opciones={opciones} />
      {tab === "compras" && <ListaCompras api={api} vista={vista} version={version} abrirLead={abrirLead} onCambio={onCambio} puedeAprobar={supervisa} />}
      {tab === "consignaciones" && <ListaConsignaciones api={api} vista={vista} version={version} abrirLead={abrirLead} />}
    </div>
  );
}
