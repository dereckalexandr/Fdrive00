/**
 * INSPECCIONES (CRM · entrega 5)
 * ----------------------------------------------------------------
 * - Ejecutivos, Tasadores y supervisores piden inspeccionar un vehículo (desde un lead, una tasación o el
 *   inventario) indicando fecha, hora y dirección. El Inspector la toma de la cola, o el supervisor se la asigna.
 * - El Inspector ve su agenda, hace la inspección con su checklist de siempre y, al guardar, el equipo ve el
 *   resultado (estado del vehículo, observaciones y fotos) SIN los datos del propietario del padrón.
 * - Cada inspección realizada cuenta para su comisión por tramos del mes.
 * El servidor valida todo; aquí solo se muestra lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect } from "react";
import { mesChile } from "../supabase/functions/api/ventas-core.js";
import { validarSolicitudInspeccion, inspeccionNombre, origenNombre, VEREDICTOS, diaChile } from "../supabase/functions/api/inspecciones-core.js";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, hace, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, useCarga, mensajeError, CamposVehiculo, aVehiculoForm, apiPorDefecto } from "./crm-ui.jsx";

const COLOR = { pendiente: "bg-amber-100 text-amber-800", en_proceso: "bg-sky-100 text-sky-800", completada: "bg-emerald-100 text-emerald-800", cancelada: "bg-stone-200 text-stone-600" };
const COLOR_VEREDICTO = { sin_observaciones: "bg-emerald-100 text-emerald-800", con_observaciones: "bg-amber-100 text-amber-800", con_fallas: "bg-rose-100 text-rose-800" };
export const Estado = ({ id }) => <span className={`text-[11px] px-2 py-0.5 ${COLOR[id] || ""}`}>{inspeccionNombre(id)}</span>;
const Veredicto = ({ id }) => (id ? <span className={`text-[11px] px-2 py-0.5 ${COLOR_VEREDICTO[id] || ""}`}>{VEREDICTOS[id]}</span> : null);
const nombreVeh = (v) => (v && v.marca ? `${v.marca} ${v.modelo || ""} ${v.anio || ""} · ${v.patente}`.replace(/\s+/g, " ") : v && v.patente ? v.patente : "");
const fotoKey = (fichaId, fotoId) => `ifoto::${fichaId}::${fotoId}`;
const cacheFotos = new Map();

/** "mié 10 jun, 15:30" */
export const cuando = (iso) => (iso ? new Date(iso).toLocaleString("es-CL", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" }) : "—");
/** Valor de un campo datetime-local (hora de Chile del navegador) a partir de una fecha ISO. */
const aInputLocal = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const deInputLocal = (v) => { const t = new Date(v); return Number.isNaN(t.getTime()) ? "" : t.toISOString(); };
const mananaALas10 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return aInputLocal(d.toISOString()); };

export function Miniatura({ fichaId, fotoId, onQuitar }) {
  const [src, setSrc] = useState(cacheFotos.get(fotoId) || "");
  useEffect(() => {
    if (src) return undefined;
    let vivo = true;
    (async () => { const r = await window.storage.get(fotoKey(fichaId, fotoId), true); if (vivo && r && r.value) { cacheFotos.set(fotoId, r.value); setSrc(r.value); } })();
    return () => { vivo = false; };
  }, [fichaId, fotoId, src]);
  return (
    <div className="relative w-24 h-24 bg-stone-200 border border-stone-300 shrink-0">
      {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="w-full h-full object-cover" /></a> : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-stone-400">…</span>}
      {onQuitar && <button type="button" onClick={onQuitar} className="absolute -top-2 -right-2 bg-rose-600 text-white w-5 h-5 text-xs rounded-full" aria-label="Quitar foto">✕</button>}
    </div>
  );
}
export const fotoKeyInspeccion = fotoKey;
export function guardarCacheFoto(fotoId, dataUrl) { cacheFotos.set(fotoId, dataUrl); }

/* =========================================================
   PEDIR UNA INSPECCIÓN
========================================================= */
export function FormPedirInspeccion({ api, origen, vehiculo, onCerrar, onPedida }) {
  const [v, setV] = useState(aVehiculoForm(vehiculo));
  const [direccion, setDireccion] = useState("");
  const [fechaHora, setFechaHora] = useState(mananaALas10());
  const [contactoLugar, setContactoLugar] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setError("");
    const datos = { vehiculo: v, direccion, fechaHora: deInputLocal(fechaHora), contactoLugar, notas };
    const val = validarSolicitudInspeccion(datos);
    if (!val.ok) { setError(mensajeError({ message: val.error })); return; }
    setEnviando(true);
    try {
      const campo = origen.tipo === "lead" ? "leadId" : origen.tipo === "tasacion" ? "tasacionId" : "vehiculoId";
      await api("inspecciones.pedir", { origen: origen.tipo, [campo]: origen.id, datos });
      onPedida();
    } catch (e) { setError(mensajeError(e)); }
    setEnviando(false);
  };
  return (
    <Modal titulo="Pedir una inspección" onCerrar={onCerrar} ancho="max-w-2xl">
      <p className="text-sm text-stone-600">Un Inspector la tomará de la cola (o el supervisor se la asignará) y irá en la fecha y hora indicadas. Cuando la termine verás el estado del vehículo, sus observaciones y fotos.</p>
      <CamposVehiculo v={v} set={setV} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Campo etiqueta="Fecha y hora" ayuda="Cuándo se puede revisar el vehículo."><input type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Con quién coordinar en el lugar (opcional)" ayuda="Nombre y teléfono de quien recibe al Inspector."><input value={contactoLugar} maxLength={120} onChange={(e) => setContactoLugar(e.target.value)} className={INPUT} /></Campo>
      </div>
      <Campo etiqueta="Dirección donde está el vehículo"><input value={direccion} maxLength={200} onChange={(e) => setDireccion(e.target.value)} className={INPUT} placeholder="Calle, número, comuna" /></Campo>
      <Campo etiqueta="Nota para el Inspector (opcional)"><textarea rows={2} maxLength={300} value={notas} onChange={(e) => setNotas(e.target.value)} className={INPUT} /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={enviar} disabled={enviando} className={BTN_AMBAR}>{enviando ? "Enviando…" : "Pedir inspección"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* =========================================================
   RESULTADO (lo que ve el equipo; nunca incluye datos del propietario)
========================================================= */
function Resultado({ x }) {
  const r = x.resultado || {};
  if (x.estado !== "completada" || !r.veredicto) return null;
  return (
    <div className="border border-stone-300 bg-white p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs uppercase tracking-wide text-stone-400">Resultado de la inspección</p>
        <Veredicto id={r.veredicto} />
        <span className="text-xs text-stone-500 ml-auto">{r.buenos} bien · {r.regulares} regular · {r.malos} malo{r.noAplica ? ` · ${r.noAplica} no aplica` : ""}{r.sinRevisar ? ` · ${r.sinRevisar} sin revisar` : ""}</span>
      </div>
      {r.observaciones && <p className="text-sm text-stone-700">{r.observaciones}</p>}
      {(r.destacados || []).length > 0 ? (
        <ul className="flex flex-col divide-y divide-stone-100 text-sm">
          {r.destacados.map((d, i) => (
            <li key={i} className="py-1.5 flex flex-wrap gap-x-3">
              <span className={d.estado === "Malo" ? "text-rose-700 font-medium" : d.estado === "Regular" ? "text-amber-700" : "text-stone-600"}>{d.estado || "Nota"}</span>
              <span className="text-stone-900">{d.item}</span><span className="text-xs text-stone-400">{d.seccion}</span>
              {d.observacion && <span className="basis-full text-stone-600">{d.observacion}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-stone-500">Sin ítems con observaciones.</p>}
      {x.fotos.length > 0 && x.fichaId && <div className="flex flex-wrap gap-2">{x.fotos.map((f) => <Miniatura key={f} fichaId={x.fichaId} fotoId={f} />)}</div>}
      <p className="text-[11px] text-stone-400">Los datos del propietario del padrón quedan solo en la ficha del Inspector.</p>
    </div>
  );
}

/* =========================================================
   DETALLE
========================================================= */
export function InspeccionDetalle({ api, id, onCerrar, onCambio, onRealizar, onVerFicha }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("inspecciones.get", { id }), [api, id]);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState(""); // "" | cancelar | asignar | reprogramar
  const [motivo, setMotivo] = useState("");
  const [equipo, setEquipo] = useState([]);
  const [destino, setDestino] = useState("");
  const [rp, setRp] = useState({ direccion: "", fechaHora: "", contactoLugar: "" });

  useEffect(() => { if (modo === "asignar" && datos && datos.puedeGestionar) api("inspecciones.equipo").then((r) => setEquipo(r.inspectores)).catch(() => {}); }, [api, datos, modo]);
  useEffect(() => {
    if (datos) { const x = datos.inspeccion; setRp({ direccion: x.direccion || "", fechaHora: x.agendada_para ? aInputLocal(x.agendada_para) : "", contactoLugar: x.contacto_lugar || "" }); }
  }, [datos]);

  if (cargando && !datos) return <Modal titulo="Inspección" onCerrar={onCerrar}><Cargando /></Modal>;
  if (error && !datos) return <Modal titulo="Inspección" onCerrar={onCerrar}><Aviso>{error}</Aviso></Modal>;
  const x = datos.inspeccion;
  const abierta = x.estado === "pendiente" || x.estado === "en_proceso";

  const correr = async (fn, okTexto) => {
    setMsg({ tipo: "", texto: "" }); setOcupado(true);
    try { const r = await fn(); if (okTexto) setMsg({ tipo: "ok", texto: typeof okTexto === "function" ? okTexto(r) : okTexto }); setModo(""); await recargar(); onCambio(); }
    catch (e) { setMsg({ tipo: "error", texto: mensajeError(e) }); }
    setOcupado(false);
  };
  const accion = (op, extra, okTexto) => correr(() => api(op, { id: x.id, ...extra }), okTexto);

  return (
    <Modal titulo={`Inspección ${x.folio}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <Estado id={x.estado} /><span className="text-xs text-stone-500">{origenNombre(x.origen)}{x.cliente ? ` · ${x.cliente}` : ""}</span>
        <span className="text-xs text-stone-400 ml-auto">Pedida {hace(x.solicitada_en)}{x.solicitante ? ` por ${x.solicitante}` : ""}</span>
      </div>
      <div className="bg-white border border-stone-200 p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs uppercase tracking-wide text-stone-400">Vehículo</p><p className="text-stone-900">{nombreVeh(x.vehiculo)}</p>{x.vehiculo.km != null && <p className="text-xs text-stone-500">{Number(x.vehiculo.km).toLocaleString("es-CL")} km</p>}</div>
        <div><p className="text-xs uppercase tracking-wide text-stone-400">Cuándo</p><p className="text-stone-900 first-letter:uppercase">{cuando(x.agendada_para)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-stone-400">Dónde</p><p className="text-stone-900">{x.direccion}</p>{x.contacto_lugar && <p className="text-xs text-stone-500">Coordinar con: {x.contacto_lugar}</p>}</div>
        <div><p className="text-xs uppercase tracking-wide text-stone-400">Inspector</p><p className="text-stone-900">{x.inspector || "Esperando que lo tome un Inspector"}</p></div>
        {x.notas_solicitud && <div className="md:col-span-2"><p className="text-xs uppercase tracking-wide text-stone-400">Nota</p><p className="text-stone-700">{x.notas_solicitud}</p></div>}
        {x.estado === "cancelada" && x.motivo_cancelacion && <div className="md:col-span-2"><p className="text-xs uppercase tracking-wide text-stone-400">Cancelada</p><p className="text-stone-700">{x.motivo_cancelacion}</p></div>}
      </div>
      <Resultado x={x} />
      {msg.texto && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="flex flex-wrap gap-2">
        {x.estado === "pendiente" && datos.puedeRealizar && <button disabled={ocupado} onClick={() => accion("inspecciones.tomar", {}, (r) => (r.choque ? "Es tuya. Ojo: tienes otra inspección a menos de 90 minutos de esta." : "Es tuya: quedó en tu agenda."))} className={BTN_AMBAR}>Tomar</button>}
        {x.estado === "en_proceso" && datos.esMia && onRealizar && <button onClick={() => { onRealizar(x); onCerrar(); }} className={BTN_AMBAR}>Realizar la inspección</button>}
        {x.estado === "completada" && datos.esMia && x.fichaKey && onVerFicha && <button onClick={() => { onVerFicha(x); onCerrar(); }} className={BTN}>Abrir mi ficha</button>}
        {x.estado === "en_proceso" && (datos.esMia || datos.puedeGestionar) && <button disabled={ocupado} onClick={() => accion("inspecciones.liberar", {}, "Volvió a la cola.")} className={BTN}>Devolver a la cola</button>}
        {abierta && datos.puedeGestionar && <button onClick={() => setModo(modo === "asignar" ? "" : "asignar")} className={BTN}>{x.estado === "pendiente" ? "Asignar a un Inspector" : "Reasignar"}</button>}
        {abierta && (datos.puedeGestionar || datos.esMia || datos.esSolicitante) && <button onClick={() => setModo(modo === "reprogramar" ? "" : "reprogramar")} className={BTN}>Reprogramar</button>}
        {abierta && (datos.puedeGestionar || datos.esMia || (datos.esSolicitante && x.estado === "pendiente")) && <button onClick={() => setModo(modo === "cancelar" ? "" : "cancelar")} className={BTN}>Cancelar</button>}
      </div>

      {modo === "asignar" && (
        <div className="flex flex-wrap items-end gap-3 border border-stone-200 bg-white p-3">
          <Campo etiqueta="Inspector" className="flex-1 min-w-[200px]">
            <select value={destino} onChange={(e) => setDestino(e.target.value)} className={INPUT}><option value="">Elige…</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select>
          </Campo>
          <button disabled={ocupado || !destino} onClick={() => accion("inspecciones.asignar", { inspectorId: destino }, "Asignada.")} className={BTN_PRIMARIO}>Asignar</button>
        </div>
      )}
      {modo === "reprogramar" && (
        <div className="flex flex-col gap-3 border border-stone-200 bg-white p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Campo etiqueta="Fecha y hora"><input type="datetime-local" value={rp.fechaHora} onChange={(e) => setRp({ ...rp, fechaHora: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Coordinar con (opcional)"><input value={rp.contactoLugar} maxLength={120} onChange={(e) => setRp({ ...rp, contactoLugar: e.target.value })} className={INPUT} /></Campo>
          </div>
          <Campo etiqueta="Dirección"><input value={rp.direccion} maxLength={200} onChange={(e) => setRp({ ...rp, direccion: e.target.value })} className={INPUT} /></Campo>
          <div><button disabled={ocupado} onClick={() => accion("inspecciones.reprogramar", { datos: { ...rp, fechaHora: deInputLocal(rp.fechaHora) } }, "Reprogramada.")} className={BTN_PRIMARIO}>Guardar cambios</button></div>
        </div>
      )}
      {modo === "cancelar" && (
        <div className="flex flex-wrap items-end gap-3 border border-stone-200 bg-white p-3">
          <Campo etiqueta="¿Por qué se cancela?" className="flex-1 min-w-[220px]"><input value={motivo} maxLength={150} onChange={(e) => setMotivo(e.target.value)} className={INPUT} /></Campo>
          <button disabled={ocupado || motivo.trim().length < 3} onClick={() => accion("inspecciones.cancelar", { motivo }, "Cancelada.")} className={BTN_PRIMARIO}>Cancelar la inspección</button>
        </div>
      )}
    </Modal>
  );
}

/* =========================================================
   SECCIÓN EN LA FICHA DEL LEAD / TASACIÓN / VEHÍCULO
========================================================= */
export function SeccionInspeccion({ api, origen, vehiculo, cerrado = false, version = 0, onCambio = () => {}, onRealizar }) {
  const campo = origen.tipo === "lead" ? "leadId" : origen.tipo === "tasacion" ? "tasacionId" : "vehiculoId";
  const { datos, error, recargar } = useCarga(() => api("inspecciones.list", { vista: "origen", [campo]: origen.id }), [api, origen.id, version]);
  const [pidiendo, setPidiendo] = useState(false);
  const [detalle, setDetalle] = useState(null);
  if (error || !datos) return null; // sin permiso o cargando: no estorba
  const lista = datos.inspecciones;
  const abierta = lista.find((x) => x.estado === "pendiente" || x.estado === "en_proceso");
  const puedePedir = datos.puedePedir && !cerrado;
  if (lista.length === 0 && !puedePedir) return null;
  const cambio = async () => { await recargar(); onCambio(); };
  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-700">Inspección del vehículo</p>
        {puedePedir && !abierta && <button onClick={() => setPidiendo(true)} className={BTN_AMBAR}>{lista.some((x) => x.estado === "completada") ? "Pedir otra inspección" : "Pedir inspección"}</button>}
      </div>
      {lista.length === 0 && <p className="text-xs text-stone-500">Aún no se ha pedido ninguna inspección. Indica fecha, hora y dirección; un Inspector la tomará.</p>}
      {lista.map((x) => (
        <div key={x.id} className={`border p-3 text-sm ${x.estado === "cancelada" ? "border-stone-200 opacity-60" : "border-stone-300"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-stone-500">{x.folio}</span><span className="text-stone-900">{nombreVeh(x.vehiculo)}</span>
            <Estado id={x.estado} /><Veredicto id={x.resultado && x.resultado.veredicto} />
          </div>
          <p className="text-xs text-stone-500 mt-1">
            {x.estado === "completada" ? `Realizada ${hace(x.completada_en)} por ${x.inspector}` : `${cuando(x.agendada_para)} · ${x.direccion}${x.inspector ? ` · Inspector: ${x.inspector}` : " · esperando que un Inspector la tome"}`}
            {x.fotos.length ? ` · ${x.fotos.length} foto(s)` : ""}
          </p>
          <div className="mt-2"><button onClick={() => setDetalle(x.id)} className={BTN}>{x.estado === "completada" ? "Ver resultado" : "Ver detalle"}</button></div>
        </div>
      ))}
      {pidiendo && <FormPedirInspeccion api={api} origen={origen} vehiculo={vehiculo} onCerrar={() => setPidiendo(false)} onPedida={async () => { setPidiendo(false); await cambio(); }} />}
      {detalle && <InspeccionDetalle api={api} id={detalle} onCerrar={() => setDetalle(null)} onCambio={cambio} onRealizar={onRealizar} />}
    </div>
  );
}

/* =========================================================
   LISTAS
========================================================= */
function ListaInspecciones({ api, vista, estadoFiltro, version, onAbrir, onTomar, vacio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("inspecciones.list", { vista, estado: estadoFiltro || undefined }), [api, vista, estadoFiltro, version]);
  const [msg, setMsg] = useState("");
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const tomar = async (x) => { setMsg(""); try { await onTomar(x); await recargar(); } catch (e) { setMsg(mensajeError(e)); await recargar(); } };
  // La agenda se agrupa por día.
  const filas = datos.inspecciones;
  const dias = [];
  if (vista === "agenda") for (const x of filas) { const d = diaChile(x.agendada_para); if (!dias.length || dias[dias.length - 1].d !== d) dias.push({ d, items: [] }); dias[dias.length - 1].items.push(x); }
  const fila = (x) => (
    <tr key={x.id} className="border-b border-stone-100 align-top">
      <td className="py-2.5 px-4 whitespace-nowrap"><span className="font-mono text-xs text-stone-500">{x.folio}</span><div className={`text-xs capitalize ${x.vencida ? "text-rose-700" : "text-stone-600"}`}>{cuando(x.agendada_para)}{x.vencida ? " · atrasada" : ""}</div></td>
      <td className="py-2.5 px-4 text-stone-900">{nombreVeh(x.vehiculo)}<div className="text-xs text-stone-500">{origenNombre(x.origen)}{x.cliente ? ` · ${x.cliente}` : ""}</div></td>
      <td className="py-2.5 px-4 text-stone-700">{x.direccion || "—"}</td>
      <td className="py-2.5 px-4 text-stone-700">{x.inspector || "—"}<div className="text-xs text-stone-500">{x.solicitante ? `Pidió ${x.solicitante}` : ""}</div></td>
      <td className="py-2.5 px-4"><Estado id={x.estado} />{x.resultado && x.resultado.veredicto && <div className="mt-1"><Veredicto id={x.resultado.veredicto} /></div>}</td>
      <td className="py-2.5 px-4 text-right whitespace-nowrap">
        {x.estado === "pendiente" && datos.puedeRealizar && <button onClick={() => tomar(x)} className={BTN_AMBAR}>Tomar</button>}{" "}
        <button onClick={() => onAbrir(x.id)} className={BTN}>Abrir</button>
      </td>
    </tr>
  );
  return (
    <>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Cuándo</th><th className="py-3 px-4">Vehículo</th><th className="py-3 px-4">Dónde</th><th className="py-3 px-4">Inspector</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">{vacio}</td></tr>}
            {vista === "agenda"
              ? dias.map((g) => (
                <React.Fragment key={g.d}>
                  <tr className="bg-stone-50"><td colSpan={6} className="py-1.5 px-4 text-xs uppercase tracking-wide text-stone-500">{new Date(`${g.d}T12:00:00`).toLocaleDateString("es-CL", { weekday: "long", day: "2-digit", month: "long" })}</td></tr>
                  {g.items.map(fila)}
                </React.Fragment>
              ))
              : filas.map(fila)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Resumen({ api, version }) {
  const [mes, setMes] = useState(mesChile());
  const { cargando, error, datos } = useCarga(() => api("inspecciones.resumen", { mes }), [api, mes, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  return (
    <>
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm text-stone-600 flex items-center gap-2">Mes <input type="month" value={mes} max={mesChile()} onChange={(e) => e.target.value && setMes(e.target.value)} className={`${INPUT} w-44`} /></label>
          <p className="text-sm text-stone-600 ml-auto">En la cola: <strong className="font-mono">{datos.cola.pendientes}</strong>{datos.cola.pendientes > 0 ? ` · la más antigua espera ${datos.cola.masAntiguaHoras} h` : ""}{datos.cola.atrasadas > 0 ? <span className="text-rose-700"> · {datos.cola.atrasadas} sin tomar pasadas las {datos.horasLimite} h o para dentro de menos de 24 h</span> : null}</p>
        </div>
      </Tarjeta>
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Actividad y comisión de {datos.nombreMes}</h3></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Inspector</th><th className="py-3 px-4 text-right">Realizadas</th><th className="py-3 px-4 text-right">Pedidas / espontáneas</th><th className="py-3 px-4 text-right">Con fallas</th>
            <th className="py-3 px-4 text-right">Tiempo medio</th><th className="py-3 px-4 text-right">Agendadas</th><th className="py-3 px-4 text-right">Tramo</th><th className="py-3 px-4 text-right">Comisión</th>
          </tr></thead>
          <tbody>
            {datos.inspectores.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-stone-500">Aún no hay inspectores con actividad.</td></tr>}
            {datos.inspectores.map((x) => (
              <tr key={x.id} className="border-b border-stone-100">
                <td className="py-2.5 px-4 text-stone-900">{x.nombre}</td><td className="py-2.5 px-4 text-right font-mono">{x.hechas}</td>
                <td className="py-2.5 px-4 text-right font-mono">{x.pedidas} / {x.espontaneas}</td><td className="py-2.5 px-4 text-right font-mono">{x.conFallas}</td>
                <td className="py-2.5 px-4 text-right font-mono">{x.pedidas ? `${x.tiempoMedioHoras} h` : "—"}</td><td className="py-2.5 px-4 text-right font-mono">{x.agendadas}</td>
                <td className="py-2.5 px-4 text-right text-xs text-stone-600">{x.produccion.tramo || "—"}{x.personalizado ? " (propio)" : ""}{x.produccion.proximo ? <div className="text-stone-400">{x.produccion.proximo.faltan} más → {clp(x.produccion.proximo.tramo.rate)} c/u</div> : null}</td>
                <td className="py-2.5 px-4 text-right font-mono font-semibold">{clp(x.produccion.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Cada inspección realizada en el mes cuenta, la hayan pedido o no. La comisión es la cantidad del mes × el monto del tramo en que cae esa cantidad (estándar: $35.000 c/u; el administrador puede definir tramos propios por persona).</p>
    </>
  );
}

/* =========================================================
   MÓDULO (Inspector, supervisor y quienes piden)
========================================================= */
export function ModuloInspecciones({ api: apiProp, permisos = [], esAdmin = false, onRealizar, onVerFicha, onNueva }) {
  const can = (p) => esAdmin || permisos.includes(p);
  const realiza = !esAdmin && permisos.includes("inspecciones.realizar");
  const supervisa = can("leads.asignar");
  const api = apiProp || apiPorDefecto;
  const [tab, setTab] = useState(realiza ? "agenda" : supervisa ? "cola" : "solicitadas");
  const [version, setVersion] = useState(0);
  const [abierta, setAbierta] = useState(null);
  const [filtro, setFiltro] = useState("");
  const subir = () => setVersion((v) => v + 1);
  const cola = useCarga(() => (realiza || supervisa ? api("inspecciones.list", { vista: "cola" }).then((r) => r.inspecciones.length).catch(() => 0) : Promise.resolve(0)), [version]);

  const opciones = [];
  if (realiza) opciones.push(["agenda", "Mi agenda"]);
  if (realiza || supervisa) opciones.push(["cola", "Por tomar", cola.datos || 0]);
  if (realiza) opciones.push(["mias", "Mis inspecciones"]);
  if (supervisa || realiza) opciones.push(["todas", realiza ? "Todas del local" : "Inspecciones"]);
  if (!realiza) opciones.push(["solicitadas", "Mis solicitudes"]);
  if (realiza || supervisa) opciones.push(["resumen", "Resumen y comisión"]);

  const tomar = async (x) => { await api("inspecciones.tomar", { id: x.id }); subir(); setAbierta(x.id); };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px]"><Pestanas valor={tab} onCambio={setTab} opciones={opciones} /></div>
        {realiza && onNueva && <button onClick={onNueva} className={BTN_PRIMARIO}>+ Inspección espontánea</button>}
      </div>
      {tab === "agenda" && <ListaInspecciones api={api} vista="agenda" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No tienes inspecciones agendadas. Toma una de la cola." />}
      {tab === "cola" && <ListaInspecciones api={api} vista="cola" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No hay solicitudes esperando. 👌" />}
      {tab === "mias" && <ListaInspecciones api={api} vista="mias" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="Todavía no has realizado inspecciones pedidas." />}
      {tab === "solicitadas" && <ListaInspecciones api={api} vista="solicitadas" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No has pedido inspecciones. Pídelas desde la ficha de un lead, una tasación o el inventario." />}
      {tab === "todas" && (
        <>
          <div className="flex items-center gap-2 text-sm text-stone-600">Estado:
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${INPUT} md:w-52`}>
              <option value="">Todos</option><option value="pendiente">Por tomar</option><option value="en_proceso">Agendadas</option><option value="completada">Realizadas</option><option value="cancelada">Canceladas</option>
            </select>
          </div>
          <ListaInspecciones api={api} vista="local" estadoFiltro={filtro} version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No hay inspecciones con ese filtro." />
        </>
      )}
      {tab === "resumen" && <Resumen api={api} version={version} />}
      {abierta && <InspeccionDetalle api={api} id={abierta} onCerrar={() => setAbierta(null)} onCambio={subir} onRealizar={onRealizar} onVerFicha={onVerFicha} />}
    </div>
  );
}
