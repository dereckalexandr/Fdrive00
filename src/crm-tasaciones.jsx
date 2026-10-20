/**
 * TASACIONES (CRM · entrega 4)
 * ----------------------------------------------------------------
 * - El ejecutivo pide tasar el vehículo en parte de pago desde la ficha del lead.
 * - El Tasador toma la solicitud de la cola (o crea una tasación directa), usa el estimador de
 *   Chileautos, fija el valor de compra y el de venta esperado, y puede vincular una inspección y subir fotos.
 * - El valor tasado queda como el valor del vehículo en parte de pago del lead y es su tope: no se puede
 *   subir en la cotización ni en el cierre sin una nueva tasación.
 * El servidor valida todo; aquí solo se muestra lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect } from "react";
import { InputDinero } from "./campo-dinero.jsx";
import { mesChile } from "../supabase/functions/api/ventas-core.js";
import { tasacionNombre, validarVehiculoTasacion, validarTasacionDirecta, MAX_FOTOS_TASACION } from "../supabase/functions/api/tasaciones-core.js";
import { compressImage, makePhotoId } from "./photos.js";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, fechaHora, hace, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, useCarga, mensajeError, CamposVehiculo, aVehiculoForm, VEH_VACIO, apiPorDefecto } from "./crm-ui.jsx";
import { SeccionInspeccion, Miniatura as MiniaturaInspeccion } from "./crm-inspecciones.jsx";
import { SeccionValidacion } from "./crm-validaciones.jsx";

const COLOR = { pendiente: "bg-amber-100 text-amber-800", en_proceso: "bg-sky-100 text-sky-800", completada: "bg-emerald-100 text-emerald-800", cancelada: "bg-stone-200 text-stone-600" };
const Estado = ({ id }) => <span className={`text-[11px] px-2 py-0.5 ${COLOR[id] || ""}`}>{tasacionNombre(id)}</span>;
const nombreVeh = (v) => (v && v.marca ? `${v.marca} ${v.modelo} ${v.anio} · ${v.patente}` : "");
const fotoKey = (tasacionId, fotoId) => `tfoto::${tasacionId}::${fotoId}`;
const cacheFotos = new Map();

function Miniatura({ tasacionId, fotoId, onQuitar }) {
  const [src, setSrc] = useState(cacheFotos.get(fotoId) || "");
  useEffect(() => {
    if (src) return undefined;
    let vivo = true;
    (async () => { const r = await window.storage.get(fotoKey(tasacionId, fotoId), true); if (vivo && r && r.value) { cacheFotos.set(fotoId, r.value); setSrc(r.value); } })();
    return () => { vivo = false; };
  }, [tasacionId, fotoId, src]);
  return (
    <div className="relative w-24 h-24 bg-stone-200 border border-stone-300 shrink-0">
      {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="w-full h-full object-cover" /></a> : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-stone-400">…</span>}
      {onQuitar && <button type="button" onClick={onQuitar} className="absolute -top-2 -right-2 bg-rose-600 text-white w-5 h-5 text-xs rounded-full" aria-label="Quitar foto">✕</button>}
    </div>
  );
}

/* =========================================================
   FORMULARIO DEL VEHÍCULO (para pedir o crear una tasación)
========================================================= */
/* =========================================================
   PEDIR UNA TASACIÓN (desde la ficha del lead)
========================================================= */
function FormPedir({ api, lead, onCerrar, onPedida }) {
  const pp = lead.parte_pago || {};
  const [v, setV] = useState(aVehiculoForm({ patente: pp.patente, marca: pp.marca, modelo: pp.modelo, anio: pp.anio, km: pp.km }));
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setError("");
    const val = validarVehiculoTasacion(v);
    if (!val.ok) { setError(mensajeError({ message: val.error })); return; }
    setEnviando(true);
    try { await api("tasaciones.pedir", { leadId: lead.id, datos: { vehiculo: v, notas } }); onPedida(); }
    catch (e) { setError(mensajeError(e)); }
    setEnviando(false);
  };
  return (
    <Modal titulo="Pedir la tasación del vehículo en parte de pago" onCerrar={onCerrar} ancho="max-w-2xl">
      <p className="text-sm text-stone-600">El Tasador la verá en su cola. Cuando la termine, su valor queda en este lead y es el máximo que podrás reconocerle al cliente.</p>
      <CamposVehiculo v={v} set={setV} />
      <Campo etiqueta="Nota para el Tasador (opcional)" ayuda="Estado, detalles o lo que espera el cliente."><textarea rows={2} maxLength={300} value={notas} onChange={(e) => setNotas(e.target.value)} className={INPUT} /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={enviar} disabled={enviando} className={BTN_AMBAR}>{enviando ? "Enviando…" : "Pedir tasación"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* =========================================================
   DETALLE DE UNA TASACIÓN
========================================================= */
function ResumenEstimacion({ e }) {
  if (!e || !e.compra) return null;
  return (
    <div className="border border-stone-200 bg-white p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-stone-400 mb-1">Estimación con Chileautos{e.capturadaEn ? ` · ${new Date(e.capturadaEn).toLocaleDateString("es-CL")}` : ""}</p>
      <div className="grid grid-cols-3 gap-3">
        <div><p className="text-[11px] text-stone-500">Precio promedio</p><p className="font-mono">{clp(e.promedio)}</p></div>
        <div><p className="text-[11px] text-stone-500">Publicación sugerida</p><p className="font-mono">{clp(e.publicacion)}</p></div>
        <div><p className="text-[11px] text-stone-500">Compra sugerida</p><p className="font-mono font-semibold">{clp(e.compra)}</p></div>
      </div>
      <p className="text-xs text-stone-500 mt-2">Margen bruto {clp(e.margenBruto)} · {e.nAvisos} aviso(s) en el promedio de {e.nValidos} válidos{e.url ? <> · <a href={e.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">ver la búsqueda</a></> : null}</p>
    </div>
  );
}

function BuscadorInspecciones({ api, patente, actual, onElegir }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const buscar = async () => {
    setError(""); setCargando(true);
    try { setLista((await api("tasaciones.inspecciones", { patente })).inspecciones); } catch (e) { setError(mensajeError(e)); }
    setCargando(false);
  };
  return (
    <div className="flex flex-col gap-2">
      {actual && actual.key ? (
        <div className="flex items-center gap-3 text-sm border border-stone-200 bg-white p-2">
          <span className="flex-1">Inspección del {actual.fecha || "—"} · {actual.marca} {actual.modelo} {actual.anio || ""} · hecha por {actual.inspector || "—"}</span>
          <button type="button" onClick={() => onElegir({})} className={BTN}>Quitar</button>
        </div>
      ) : <p className="text-xs text-stone-500">Sin inspección vinculada.</p>}
      <div><button type="button" onClick={buscar} disabled={cargando} className={BTN}>{cargando ? "Buscando…" : `Buscar inspecciones de ${patente || "la patente"}`}</button></div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {lista && lista.length === 0 && <p className="text-xs text-stone-500">No hay inspecciones guardadas de esa patente.</p>}
      {lista && lista.map((i) => (
        <button key={i.key} type="button" onClick={() => { onElegir(i); setLista(null); }} className="text-left text-sm border border-stone-200 bg-white p-2 hover:border-amber-400">
          {i.fecha || "—"} · {i.marca} {i.modelo} {i.anio || ""} · inspector {i.inspector || "—"} <span className="text-amber-700">Vincular</span>
        </button>
      ))}
      <p className="text-[11px] text-stone-400">Solo se vincula la inspección con los datos del vehículo; no se muestran datos del propietario.</p>
    </div>
  );
}

function TasacionDetalle({ api, id, renderEstimador, onCerrar, onCambio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("tasaciones.get", { id }), [api, id]);
  const [f, setF] = useState(null);
  const [fotos, setFotos] = useState([]);
  const [nuevas, setNuevas] = useState([]);
  const [quitadas, setQuitadas] = useState([]);
  const [verEstimador, setVerEstimador] = useState(false);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [ocupado, setOcupado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [asignando, setAsignando] = useState(false);
  const [tasadores, setTasadores] = useState([]);

  useEffect(() => {
    if (!datos) return;
    const t = datos.tasacion;
    setF({ vehiculo: aVehiculoForm(t.vehiculo), valorCompra: t.valor_compra ?? "", valorVenta: t.valor_venta ?? "", observaciones: t.observaciones || "", estimacion: t.estimacion || {}, inspeccion: t.inspeccion || {} });
    setFotos(t.fotos || []); setNuevas([]); setQuitadas([]);
  }, [datos]);
  useEffect(() => { if (datos && datos.puedeGestionar && asignando) api("tasaciones.equipo").then((r) => setTasadores(r.tasadores)).catch(() => {}); }, [api, datos, asignando]);

  if (cargando && !datos) return <Modal titulo="Tasación" onCerrar={onCerrar}><Cargando /></Modal>;
  if (error && !datos) return <Modal titulo="Tasación" onCerrar={onCerrar}><Aviso>{error}</Aviso></Modal>;
  if (!f) return null;
  const t = datos.tasacion;
  const editable = datos.puedeEditar;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const total = fotos.length + nuevas.length;
  const margen = Number(f.valorVenta) - Number(f.valorCompra);

  const agregarFotos = async (ev) => {
    const archivos = Array.from(ev.target.files || []);
    ev.target.value = "";
    for (const a of archivos) {
      if (fotos.length + nuevas.length >= MAX_FOTOS_TASACION) { setMsg({ tipo: "error", texto: `Máximo ${MAX_FOTOS_TASACION} fotos por tasación.` }); break; }
      try { const dataUrl = await compressImage(a); setNuevas((n) => (fotos.length + n.length >= MAX_FOTOS_TASACION ? n : [...n, { id: makePhotoId(), dataUrl }])); }
      catch (e) { setMsg({ tipo: "error", texto: "No se pudo leer una de las fotos." }); }
    }
  };

  /** Sube las fotos nuevas y arma el borrador que se envía al servidor. */
  const armarBorrador = async () => {
    const ids = [...fotos];
    for (const n of nuevas) { const ok = await window.storage.set(fotoKey(t.id, n.id), n.dataUrl, true); if (ok) { ids.push(n.id); cacheFotos.set(n.id, n.dataUrl); } }
    return { vehiculo: f.vehiculo, valorCompra: f.valorCompra === "" ? 0 : f.valorCompra, valorVenta: f.valorVenta === "" ? 0 : f.valorVenta, observaciones: f.observaciones, estimacion: f.estimacion, inspeccion: f.inspeccion, fotos: ids };
  };
  const limpiarQuitadas = async () => { for (const q of quitadas) { try { await window.storage.delete(fotoKey(t.id, q), true); } catch (e) { /* se limpia luego */ } } };

  const correr = async (fn, okTexto) => {
    setMsg({ tipo: "", texto: "" }); setOcupado(true);
    try { await fn(); if (okTexto) setMsg({ tipo: "ok", texto: okTexto }); await recargar(); onCambio(); }
    catch (e) { setMsg({ tipo: "error", texto: mensajeError(e) }); }
    setOcupado(false);
  };
  const guardar = () => correr(async () => { const b = await armarBorrador(); await api("tasaciones.guardar", { id: t.id, borrador: b }); await limpiarQuitadas(); }, "Borrador guardado ✓");
  const completar = async () => {
    if (!window.confirm("¿Completar la tasación? Ya no podrás editarla, y el valor de compra quedará como el valor reconocido al cliente en el lead.")) return;
    await correr(async () => { const b = await armarBorrador(); await api("tasaciones.completar", { id: t.id, borrador: b }); await limpiarQuitadas(); }, "Tasación completada ✓");
  };

  return (
    <Modal titulo={`${t.folio} · ${nombreVeh(t.vehiculo)}`} onCerrar={onCerrar} ancho="max-w-3xl">
      {msg.texto && <Aviso tipo={msg.tipo === "ok" ? "ok" : "error"}>{msg.texto}</Aviso>}
      <div className="bg-white border border-stone-200 p-4 text-sm flex flex-wrap gap-x-6 gap-y-1 items-center">
        <Estado id={t.estado} />
        <span>{t.tipo === "directa" ? "Tasación directa" : "Vehículo en parte de pago"}</span>
        {t.cliente && <span className="text-stone-600">Cliente: <strong>{t.cliente}</strong></span>}
        {t.solicitante && <span className="text-stone-600">Pidió: {t.solicitante}</span>}
        {t.tasador && <span className="text-stone-600">Tasador: {t.tasador}</span>}
        <span className="text-xs text-stone-500">Solicitada {hace(t.solicitada_en)}</span>
        {t.notas_solicitud && <p className="basis-full text-stone-700"><span className="text-xs uppercase text-stone-400">Nota: </span>{t.notas_solicitud}</p>}
        {t.motivo_cancelacion && <p className="basis-full text-rose-700">Cancelada: {t.motivo_cancelacion}</p>}
      </div>

      <Tarjeta titulo="Vehículo"><CamposVehiculo v={f.vehiculo} set={(v) => set("vehiculo", v)} bloqueado={!editable} /></Tarjeta>

      {editable && renderEstimador && (
        <Tarjeta titulo="Estimación con Chileautos" derecha={<button type="button" onClick={() => setVerEstimador(!verEstimador)} className={BTN}>{verEstimador ? "Ocultar estimador" : "Abrir estimador"}</button>}>
          {verEstimador && renderEstimador({ inicial: f.vehiculo, onResultado: (e) => { set("estimacion", e); setMsg({ tipo: "ok", texto: "Resultado de Chileautos guardado en la tasación. Guarda el borrador para conservarlo." }); } })}
          <ResumenEstimacion e={f.estimacion} />
          {!verEstimador && !f.estimacion.compra && <p className="text-sm text-stone-500">Aún no hay una estimación guardada.</p>}
        </Tarjeta>
      )}
      {!editable && f.estimacion && f.estimacion.compra ? <ResumenEstimacion e={f.estimacion} /> : null}

      <Tarjeta titulo="Valores" ayuda={t.tipo === "parte_pago" ? "El valor de compra es lo que se le reconoce al cliente por su vehículo y queda como tope en el lead." : "El valor de compra es lo que se ofrece pagar."}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <Campo etiqueta="Valor de compra ($)"><InputDinero value={f.valorCompra} disabled={!editable} onChange={(e) => set("valorCompra", e.target.value)} className={`${INPUT} font-mono`} /></Campo>
          <Campo etiqueta="Valor de venta esperado ($)"><InputDinero value={f.valorVenta} disabled={!editable} onChange={(e) => set("valorVenta", e.target.value)} className={`${INPUT} font-mono`} /></Campo>
          <div className="text-sm"><p className="text-xs text-stone-500">Margen esperado</p><p className={`font-mono text-lg ${margen < 0 ? "text-rose-600" : "text-stone-900"}`}>{f.valorCompra !== "" && f.valorVenta !== "" ? clp(margen) : "—"}</p></div>
        </div>
        {editable && f.estimacion.compra && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={() => set("valorCompra", f.estimacion.compra)} className={BTN}>Usar la compra sugerida ({clp(f.estimacion.compra)})</button>
            <button type="button" onClick={() => set("valorVenta", f.estimacion.publicacion)} className={BTN}>Usar la publicación sugerida ({clp(f.estimacion.publicacion)})</button>
          </div>
        )}
        {editable && f.valorCompra !== "" && f.valorVenta !== "" && margen < 0 && <p className="text-xs text-rose-600 mt-2">El valor de venta esperado no puede ser menor que el de compra.</p>}
      </Tarjeta>

      {t.tipo === "directa" && <SeccionValidacion api={api} origen={{ tipo: "tasacion", id: t.id }} titulo="Validación de documentos de la compra" />}
      <SeccionInspeccion api={api} origen={{ tipo: "tasacion", id: t.id }} vehiculo={t.vehiculo} cerrado={t.estado === "cancelada"} />

      <Tarjeta titulo="Inspección">
        {editable ? <BuscadorInspecciones api={api} patente={f.vehiculo.patente} actual={f.inspeccion} onElegir={(i) => set("inspeccion", i)} />
          : f.inspeccion && f.inspeccion.key ? <p className="text-sm text-stone-700">Inspección del {f.inspeccion.fecha || "—"} · hecha por {f.inspeccion.inspector || "—"}</p> : <p className="text-sm text-stone-500">Sin inspección vinculada.</p>}
        {f.inspeccion && f.inspeccion.key && (
          <div className="mt-3">
            <p className="text-sm text-stone-700 mb-2">Fotos tomadas por el inspector ({(f.inspeccion.fotos || []).length})</p>
            {(f.inspeccion.fotos || []).length === 0
              ? <p className="text-xs text-stone-500">El inspector no adjuntó fotos en esa inspección.</p>
              : <div className="flex flex-wrap gap-2">{f.inspeccion.fotos.map((fid) => <MiniaturaInspeccion key={fid} fichaId={f.inspeccion.key.split("::").pop()} fotoId={fid} />)}</div>}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo={`Fotos (${total}/${MAX_FOTOS_TASACION})`}>
        <div className="flex flex-wrap gap-3">
          {fotos.map((fid) => <Miniatura key={fid} tasacionId={t.id} fotoId={fid} onQuitar={editable ? () => { setFotos(fotos.filter((x) => x !== fid)); setQuitadas([...quitadas, fid]); } : null} />)}
          {nuevas.map((n) => (
            <div key={n.id} className="relative w-24 h-24 border border-amber-400"><img src={n.dataUrl} alt="" className="w-full h-full object-cover" />
              <button type="button" onClick={() => setNuevas(nuevas.filter((x) => x.id !== n.id))} className="absolute -top-2 -right-2 bg-rose-600 text-white w-5 h-5 text-xs rounded-full" aria-label="Quitar foto">✕</button></div>
          ))}
          {editable && total < MAX_FOTOS_TASACION && (
            <label className="w-24 h-24 border-2 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-500 text-xs cursor-pointer hover:border-amber-500 text-center">
              <span className="text-xl">＋</span>Agregar foto<input type="file" accept="image/*" multiple className="hidden" onChange={agregarFotos} />
            </label>
          )}
          {!editable && total === 0 && <p className="text-sm text-stone-500">Sin fotos.</p>}
        </div>
      </Tarjeta>

      <Campo etiqueta="Observaciones del Tasador"><textarea rows={3} maxLength={1000} value={f.observaciones} disabled={!editable} onChange={(e) => set("observaciones", e.target.value)} className={INPUT} /></Campo>

      {t.estado === "completada" && <Aviso tipo="ok">Completada {fechaHora(t.completada_en)}. Valor reconocido: <strong>{clp(t.valor_compra)}</strong> · venta esperada {clp(t.valor_venta)}.</Aviso>}

      <div className="flex flex-wrap gap-2 items-center">
        {editable && <button onClick={guardar} disabled={ocupado} className={BTN}>Guardar borrador</button>}
        {editable && <button onClick={completar} disabled={ocupado || f.valorCompra === "" || f.valorVenta === "" || margen < 0} className={BTN_AMBAR}>Completar tasación</button>}
        {editable && <button onClick={() => correr(() => api("tasaciones.liberar", { id: t.id }), "Devuelta a la cola")} disabled={ocupado} className={BTN}>Devolver a la cola</button>}
        {datos.puedeGestionar && (t.estado === "pendiente" || t.estado === "en_proceso") && <button onClick={() => setAsignando(!asignando)} className={BTN}>Asignar a otro Tasador…</button>}
        {(t.estado === "pendiente" || t.estado === "en_proceso") && <button onClick={() => setCancelando(!cancelando)} className={BTN}>Cancelar tasación…</button>}
      </div>
      {asignando && (
        <div className="flex flex-wrap gap-2 items-center">
          <select defaultValue="" onChange={(e) => e.target.value && correr(async () => { await api("tasaciones.asignar", { id: t.id, tasadorId: e.target.value }); setAsignando(false); }, "Tasación asignada")} className={`${INPUT} md:w-64`}>
            <option value="">Elegir Tasador…</option>{tasadores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </div>
      )}
      {cancelando && (
        <div className="flex flex-wrap gap-2 items-center">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className={`${INPUT} md:w-72`} />
          <button disabled={motivo.trim().length < 3 || ocupado} onClick={() => correr(async () => { await api("tasaciones.cancelar", { id: t.id, motivo }); setCancelando(false); }, "Tasación cancelada")} className={BTN_PRIMARIO}>Cancelar la tasación</button>
        </div>
      )}
    </Modal>
  );
}

/* =========================================================
   SECCIÓN EN LA FICHA DEL LEAD
========================================================= */
export function SeccionTasacion({ api, lead, datos, catalogos, onCambio, avisar }) {
  const [pidiendo, setPidiendo] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const tasaciones = datos.tasaciones || [];
  const abierta = tasaciones.find((t) => t.estado === "pendiente" || t.estado === "en_proceso");
  const completada = tasaciones.find((t) => t.estado === "completada");
  const cerrado = lead.etapa === "ganado" || lead.etapa === "perdido";
  const pp = lead.parte_pago || {};
  const vigente = pp.tasacion_id && tasaciones.find((t) => t.id === pp.tasacion_id);
  if (tasaciones.length === 0 && !(catalogos.puedePedirTasacion && datos.puedeEditar && !cerrado && pp.tiene)) return null;

  const cancelar = async (t) => {
    const motivo = window.prompt("¿Por qué cancelas la tasación?");
    if (!motivo || motivo.trim().length < 3) return;
    avisar(""); setOcupado(true);
    try { await api("tasaciones.cancelar", { id: t.id, motivo }); await onCambio(); } catch (e) { avisar(mensajeError(e)); }
    setOcupado(false);
  };

  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-700">Tasación del vehículo en parte de pago</p>
        {catalogos.puedePedirTasacion && datos.puedeEditar && !cerrado && !abierta && <button onClick={() => setPidiendo(true)} className={BTN_AMBAR}>{completada ? "Pedir una nueva tasación" : "Pedir tasación"}</button>}
      </div>
      {vigente && vigente.estado === "completada" && (
        <div className="border border-emerald-300 bg-emerald-50 p-3 text-sm">
          Valor reconocido al cliente: <strong className="font-mono">{clp(vigente.valor_compra)}</strong> · tasada por {vigente.tasador || "—"} ({vigente.folio}).
          <p className="text-xs text-stone-600 mt-1">Es el máximo que puedes poner en la cotización y en el cierre. Para subirlo, pide una nueva tasación.</p>
        </div>
      )}
      {tasaciones.map((t) => (
        <div key={t.id} className={`border p-3 text-sm ${t.estado === "cancelada" ? "border-stone-200 opacity-60" : "border-stone-300"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-stone-500">{t.folio}</span>
            <span className="text-stone-900">{nombreVeh(t.vehiculo)}</span>
            <Estado id={t.estado} />
            {t.estado === "completada" && <span className="ml-auto font-mono text-stone-900">{clp(t.valor_compra)}</span>}
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Pedida {hace(t.solicitada_en)}{t.tasador ? ` · Tasador: ${t.tasador}` : t.estado === "pendiente" ? " · esperando que un Tasador la tome" : ""}
            {t.estado === "completada" && t.valor_venta ? ` · venta esperada ${clp(t.valor_venta)}` : ""}{t.nFotos ? ` · ${t.nFotos} foto(s)` : ""}
          </p>
          {t.estado === "cancelada" && t.motivo_cancelacion && <p className="text-xs text-stone-500 mt-1">Cancelada: {t.motivo_cancelacion}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <button onClick={() => setDetalle(t.id)} className={BTN}>Ver detalle</button>
            {t.estado === "pendiente" && datos.puedeEditar && <button disabled={ocupado} onClick={() => cancelar(t)} className={BTN}>Cancelar</button>}
          </div>
        </div>
      ))}
      {pidiendo && <FormPedir api={api} lead={lead} onCerrar={() => setPidiendo(false)} onPedida={async () => { setPidiendo(false); await onCambio(); }} />}
      {detalle && <TasacionDetalle api={api} id={detalle} onCerrar={() => setDetalle(null)} onCambio={onCambio} />}
    </div>
  );
}

/** Tarjeta del inicio del ejecutivo: sus tasaciones abiertas y las que acaban de terminar. */
export function MisTasaciones({ api, version, abrirLead }) {
  const { datos } = useCarga(() => api("tasaciones.list", { vista: "solicitadas" }).catch(() => ({ tasaciones: [] })), [api, version]);
  if (!datos) return null;
  const recientes = datos.tasaciones.filter((t) => t.estado === "pendiente" || t.estado === "en_proceso" || (t.estado === "completada" && Date.now() - Date.parse(t.completada_en) < 3 * 86_400_000));
  if (recientes.length === 0) return null;
  return (
    <Tarjeta titulo="Mis tasaciones" ayuda="Las que pediste y siguen abiertas, y las que se completaron estos últimos días.">
      <ul className="flex flex-col divide-y divide-stone-100">
        {recientes.map((t) => (
          <li key={t.id}><button onClick={() => t.lead_id && abrirLead(t.lead_id)} className="w-full text-left py-2 text-sm hover:bg-amber-50 px-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-stone-500">{t.folio}</span><Estado id={t.estado} />
            <span className="text-stone-900">{t.cliente}</span><span className="text-stone-600">{nombreVeh(t.vehiculo)}</span>
            {t.estado === "completada" && <span className="font-mono text-emerald-700">{clp(t.valor_compra)}</span>}
          </button></li>
        ))}
      </ul>
    </Tarjeta>
  );
}

/* =========================================================
   MÓDULO DEL TASADOR (y vista del supervisor)
========================================================= */
function FormDirecta({ api, onCerrar, onCreada }) {
  const [v, setV] = useState(VEH_VACIO);
  const [contacto, setContacto] = useState({ nombre: "", telefono: "" });
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const crear = async () => {
    setError("");
    const val = validarTasacionDirecta({ vehiculo: v, contacto, notas });
    if (!val.ok) { setError(mensajeError({ message: val.error })); return; }
    setEnviando(true);
    try { onCreada((await api("tasaciones.directa", { datos: { vehiculo: v, contacto, notas } })).tasacion); }
    catch (e) { setError(mensajeError(e)); }
    setEnviando(false);
  };
  return (
    <Modal titulo="Nueva tasación directa" onCerrar={onCerrar} ancho="max-w-2xl">
      <p className="text-sm text-stone-600">Para quien llega a vender o consignar su vehículo. Quedará a tu nombre para que la completes.</p>
      <CamposVehiculo v={v} set={setV} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Campo etiqueta="Nombre de quien ofrece el vehículo (opcional)"><input value={contacto.nombre} onChange={(e) => setContacto({ ...contacto, nombre: e.target.value })} className={INPUT} /></Campo>
        <Campo etiqueta="Teléfono (opcional)"><input value={contacto.telefono} onChange={(e) => setContacto({ ...contacto, telefono: e.target.value })} className={INPUT} placeholder="+56 9 1234 5678" /></Campo>
      </div>
      <Campo etiqueta="Notas (opcional)"><textarea rows={2} maxLength={300} value={notas} onChange={(e) => setNotas(e.target.value)} className={INPUT} /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={crear} disabled={enviando} className={BTN_PRIMARIO}>{enviando ? "Creando…" : "Crear y empezar"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

function ListaTasaciones({ api, vista, estadoFiltro, version, onAbrir, onTomar, vacio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("tasaciones.list", { vista, estado: estadoFiltro || undefined }), [api, vista, estadoFiltro, version]);
  const [msg, setMsg] = useState("");
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const tomar = async (t) => { setMsg(""); try { await onTomar(t); await recargar(); } catch (e) { setMsg(mensajeError(e)); await recargar(); } };
  return (
    <>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Tasación</th><th className="py-3 px-4">Vehículo</th><th className="py-3 px-4">Cliente / origen</th><th className="py-3 px-4">Tasador</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {datos.tasaciones.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">{vacio}</td></tr>}
            {datos.tasaciones.map((t) => (
              <tr key={t.id} className="border-b border-stone-100 align-top">
                <td className="py-2.5 px-4"><span className="font-mono text-xs text-stone-500">{t.folio}</span><div className="text-[11px] text-stone-400">{hace(t.solicitada_en)}</div></td>
                <td className="py-2.5 px-4 text-stone-900">{nombreVeh(t.vehiculo)}<div className="text-xs text-stone-500">{Number(t.vehiculo.km).toLocaleString("es-CL")} km{t.vehiculo.transmision ? ` · ${t.vehiculo.transmision}` : ""}</div></td>
                <td className="py-2.5 px-4 text-stone-700">{t.cliente || "—"}<div className="text-xs text-stone-500">{t.tipo === "directa" ? "Tasación directa" : `Pidió ${t.solicitante || "—"}`}</div></td>
                <td className="py-2.5 px-4 text-stone-700">{t.tasador || "—"}</td>
                <td className="py-2.5 px-4"><Estado id={t.estado} />{t.estado === "completada" && <div className="font-mono text-xs mt-1">{clp(t.valor_compra)}</div>}</td>
                <td className="py-2.5 px-4 text-right whitespace-nowrap">
                  {t.estado === "pendiente" && datos.puedeRealizar && <button onClick={() => tomar(t)} className={BTN_AMBAR}>Tomar</button>}{" "}
                  <button onClick={() => onAbrir(t.id)} className={BTN}>Abrir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Resumen({ api, version }) {
  const [mes, setMes] = useState(mesChile());
  const { cargando, error, datos } = useCarga(() => api("tasaciones.resumen", { mes }), [api, mes, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  return (
    <>
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm text-stone-600 flex items-center gap-2">Mes <input type="month" value={mes} max={mesChile()} onChange={(e) => e.target.value && setMes(e.target.value)} className={`${INPUT} w-44`} /></label>
          <p className="text-sm text-stone-600 ml-auto">En la cola: <strong className="font-mono">{datos.cola.pendientes}</strong>{datos.cola.pendientes > 0 ? ` · la más antigua espera ${datos.cola.masAntiguaHoras} h` : ""}{datos.cola.atrasadas > 0 ? <span className="text-rose-700"> · {datos.cola.atrasadas} pasaron las {datos.horasLimite} h</span> : null}</p>
        </div>
      </Tarjeta>
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Actividad de {datos.nombreMes}</h3></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Tasador</th><th className="py-3 px-4 text-right">Tasaciones hechas</th><th className="py-3 px-4 text-right">Tiempo medio de respuesta</th>
            <th className="py-3 px-4 text-right">En proceso</th><th className="py-3 px-4 text-right">Valor de compra total</th><th className="py-3 px-4 text-right">Margen esperado medio</th>
          </tr></thead>
          <tbody>
            {datos.tasadores.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-stone-500">Aún no hay tasaciones.</td></tr>}
            {datos.tasadores.map((x) => (
              <tr key={x.id} className="border-b border-stone-100">
                <td className="py-2.5 px-4 text-stone-900">{x.nombre}</td><td className="py-2.5 px-4 text-right font-mono">{x.hechas}</td>
                <td className="py-2.5 px-4 text-right font-mono">{x.hechas ? `${x.tiempoMedioHoras} h` : "—"}</td><td className="py-2.5 px-4 text-right font-mono">{x.enProceso}</td>
                <td className="py-2.5 px-4 text-right font-mono">{clp(x.valorCompraTotal)}</td><td className="py-2.5 px-4 text-right font-mono">{x.hechas ? clp(x.margenEsperadoMedio) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">El tiempo de respuesta cuenta desde que se pidió la tasación hasta que se completó. Por ahora el Tasador no tiene comisión: se mide su actividad.</p>
    </>
  );
}

export function ModuloTasaciones({ api: apiProp, permisos = [], esAdmin = false, renderEstimador }) {
  const can = (p) => esAdmin || permisos.includes(p);
  const realiza = can("tasaciones.realizar");
  const supervisa = can("leads.asignar");
  const api = apiProp || apiPorDefecto;
  const [tab, setTab] = useState(realiza ? "cola" : "todas");
  const [version, setVersion] = useState(0);
  const [abierta, setAbierta] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [filtro, setFiltro] = useState("");
  const subir = () => setVersion((v) => v + 1);
  const cola = useCarga(() => (realiza || supervisa ? api("tasaciones.list", { vista: "cola" }).then((r) => r.tasaciones.length).catch(() => 0) : Promise.resolve(0)), [version]);

  const opciones = [];
  if (realiza) opciones.push(["cola", "Por tomar", cola.datos || 0], ["mias", "Mis tasaciones"]);
  if (supervisa || realiza) opciones.push(["todas", realiza ? "Todas del local" : "Tasaciones"]);
  if (realiza) opciones.push(["estimador", "Estimador"]);
  opciones.push(["resumen", "Resumen"]);

  const tomar = async (t) => { await api("tasaciones.tomar", { id: t.id }); subir(); setAbierta(t.id); };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px]"><Pestanas valor={tab} onCambio={setTab} opciones={opciones} /></div>
        {(realiza || esAdmin) && <button onClick={() => setNueva(true)} className={BTN_PRIMARIO}>+ Tasación directa</button>}
      </div>
      {tab === "cola" && <ListaTasaciones api={api} vista="cola" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No hay solicitudes esperando. 👌" />}
      {tab === "mias" && <ListaTasaciones api={api} vista="mias" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="Todavía no tienes tasaciones. Toma una de la cola o crea una directa." />}
      {tab === "todas" && (
        <>
          <div className="flex items-center gap-2 text-sm text-stone-600">Estado:
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${INPUT} md:w-52`}>
              <option value="">Todos</option><option value="pendiente">Por tomar</option><option value="en_proceso">En proceso</option><option value="completada">Completadas</option><option value="cancelada">Canceladas</option>
            </select>
          </div>
          <ListaTasaciones api={api} vista="local" estadoFiltro={filtro} version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No hay tasaciones con ese filtro." />
        </>
      )}
      {tab === "estimador" && (renderEstimador ? renderEstimador({}) : <Aviso tipo="info">El estimador no está disponible en esta pantalla.</Aviso>)}
      {tab === "resumen" && <Resumen api={api} version={version} />}
      {abierta && <TasacionDetalle api={api} id={abierta} renderEstimador={renderEstimador} onCerrar={() => setAbierta(null)} onCambio={subir} />}
      {nueva && <FormDirecta api={api} onCerrar={() => setNueva(false)} onCreada={(t) => { setNueva(false); subir(); setAbierta(t.id); }} />}
    </div>
  );
}

