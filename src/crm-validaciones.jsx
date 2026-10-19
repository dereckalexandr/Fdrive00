/**
 * VALIDACIONES (CRM · entrega 6)
 * ----------------------------------------------------------------
 * - Cada cierre de venta, cada vehículo que ingresa al inventario y cada compra directa pide la revisión de sus
 *   documentos. Se crea sola; el Validador la toma de la cola (o el supervisor se la asigna).
 * - El Validador revisa documento por documento: aprueba, observa (falta algo), rechaza o declara que no aplica.
 *   Quien trabaja la venta (o el vehículo) sube las correcciones; el documento vuelve a revisión.
 * - Con Validadores en el local, la venta no se puede aprobar hasta que su validación esté aprobada.
 * El servidor valida todo; aquí solo se muestra lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { mesChile } from "../supabase/functions/api/ventas-core.js";
import { validacionNombre, docNombre, tipoValidacionNombre, claveArchivo, MAX_ARCHIVOS_DOC, MAX_BYTES_ARCHIVO } from "../supabase/functions/api/validaciones-core.js";
import { compressImage, makePhotoId } from "./photos.js";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, hace, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, useCarga, mensajeError, apiPorDefecto } from "./crm-ui.jsx";

const COLOR = { pendiente: "bg-amber-100 text-amber-800", en_revision: "bg-sky-100 text-sky-800", observada: "bg-orange-100 text-orange-800", rechazada: "bg-rose-100 text-rose-800", aprobada: "bg-emerald-100 text-emerald-800", cancelada: "bg-stone-200 text-stone-600" };
const COLOR_DOC = { pendiente: "bg-stone-100 text-stone-600", aprobado: "bg-emerald-100 text-emerald-800", observado: "bg-orange-100 text-orange-800", rechazado: "bg-rose-100 text-rose-800", no_aplica: "bg-stone-200 text-stone-600" };
export const Estado = ({ id }) => <span className={`text-[11px] px-2 py-0.5 ${COLOR[id] || ""}`}>{validacionNombre(id)}</span>;
const nombreSujeto = (s) => (s && s.marca ? `${s.marca} ${s.modelo || ""} ${s.anio || ""} · ${s.patente}`.replace(/\s+/g, " ") : s && s.patente ? s.patente : "");

/** Abre un archivo guardado (imagen o PDF) en otra pestaña. */
async function abrirArchivo(valId, a) {
  const w = window.open("", "_blank");
  try {
    const r = await window.storage.get(claveArchivo(a.v || valId, a.id), true);
    if (!r || !r.value) throw new Error("sin_archivo");
    const blob = await (await fetch(r.value)).blob();
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else window.open(url, "_blank");
  } catch (e) {
    if (w) w.close();
    window.alert("No se pudo abrir el archivo. Puede que aún no termine de subirse.");
  }
}

const leerComoDataUrl = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error("archivo_ilegible"));
  fr.readAsDataURL(file);
});

/* =========================================================
   UN DOCUMENTO
========================================================= */
function Documento({ api, val, doc, puedeRevisar, puedeAdjuntar, onCambio, avisar }) {
  const [modo, setModo] = useState(""); // "" | observado | rechazado | no_aplica
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const cerrado = doc.estado === "aprobado" || doc.estado === "no_aplica";
  const archivos = doc.archivos || [];

  const correr = async (fn) => { avisar(""); setOcupado(true); try { await fn(); await onCambio(); setModo(""); setComentario(""); } catch (e) { avisar(mensajeError(e)); } setOcupado(false); };

  const subir = async (ev) => {
    const lista = Array.from(ev.target.files || []);
    ev.target.value = "";
    for (const f of lista) {
      await correr(async () => {
        if (archivos.length >= MAX_ARCHIVOS_DOC) throw new Error("demasiados_archivos");
        const esPdf = f.type === "application/pdf";
        if (!esPdf && !f.type.startsWith("image/")) throw new Error("archivo_tipo_invalido");
        if (esPdf && f.size > MAX_BYTES_ARCHIVO) throw new Error("archivo_muy_grande");
        const dataUrl = esPdf ? await leerComoDataUrl(f) : await compressImage(f);
        const id = makePhotoId();
        const ok = await window.storage.set(claveArchivo(val.id, id), dataUrl, true);
        if (!ok) throw new Error("archivo_invalido");
        try { await api("validacion.adjuntar", { id: val.id, docId: doc.id, archivo: { id, nombre: f.name, tipo: esPdf ? "application/pdf" : "image/jpeg", tam: Math.round(dataUrl.length * 0.75) } }); }
        catch (e) { try { await window.storage.delete(claveArchivo(val.id, id), true); } catch (e2) { /* se limpia luego */ } throw e; }
      });
    }
  };
  const quitar = (a) => correr(async () => {
    await api("validacion.quitar", { id: val.id, docId: doc.id, archivoId: a.id });
    if (!a.v || a.v === val.id) { try { await window.storage.delete(claveArchivo(val.id, a.id), true); } catch (e) { /* se limpia luego */ } }
  });
  const revisar = (estado) => correr(() => api("validacion.revisar", { id: val.id, docId: doc.id, estado, comentario }));

  return (
    <div className={`border p-3 text-sm ${doc.estado === "observado" || doc.estado === "rechazado" ? "border-orange-300 bg-orange-50/40" : "border-stone-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-stone-900">{doc.nombre}</span>
        {!doc.requerido && <span className="text-[11px] text-stone-400">opcional</span>}
        <span className={`text-[11px] px-2 py-0.5 ml-auto ${COLOR_DOC[doc.estado]}`}>{docNombre(doc.estado)}</span>
      </div>
      {doc.comentario && <p className={`text-xs mt-1 ${doc.estado === "observado" || doc.estado === "rechazado" ? "text-orange-800" : "text-stone-500"}`}>{doc.comentario}{doc.revisado_por ? ` — ${doc.revisado_por}` : ""}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {archivos.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 border border-stone-300 bg-stone-50 px-2 py-1 text-xs">
            <button type="button" onClick={() => abrirArchivo(val.id, a)} className="text-sky-700 hover:underline max-w-[160px] truncate">{a.tipo === "application/pdf" ? "📄" : "🖼"} {a.nombre}</button>
            {puedeAdjuntar && !cerrado && !(a.v && a.v !== val.id) && <button type="button" disabled={ocupado} onClick={() => quitar(a)} className="text-rose-600 px-1" aria-label="Quitar archivo">✕</button>}
          </span>
        ))}
        {archivos.length === 0 && <span className="text-xs text-stone-400">Sin archivos</span>}
        {puedeAdjuntar && !cerrado && archivos.length < MAX_ARCHIVOS_DOC && (
          <label className={`${BTN} cursor-pointer ${ocupado ? "opacity-50 pointer-events-none" : ""}`}>
            {ocupado ? "Subiendo…" : "＋ Subir foto o PDF"}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={subir} />
          </label>
        )}
      </div>
      {puedeRevisar && !cerrado && (
        <div className="mt-2 flex flex-col gap-2">
          {!modo && (
            <div className="flex flex-wrap gap-2">
              <button disabled={ocupado || archivos.length === 0} title={archivos.length === 0 ? "Sube o espera el archivo para aprobarlo" : ""} onClick={() => revisar("aprobado")} className={BTN_AMBAR}>Aprobar</button>
              <button disabled={ocupado} onClick={() => setModo("observado")} className={BTN}>Observar</button>
              <button disabled={ocupado} onClick={() => setModo("rechazado")} className={BTN}>Rechazar</button>
              <button disabled={ocupado} onClick={() => setModo("no_aplica")} className={BTN}>No aplica</button>
            </div>
          )}
          {modo && (
            <div className="flex flex-wrap items-end gap-2">
              <Campo etiqueta={modo === "observado" ? "¿Qué falta o hay que corregir?" : modo === "rechazado" ? "¿Por qué se rechaza?" : "¿Por qué no aplica?"} className="flex-1 min-w-[220px]">
                <input value={comentario} maxLength={300} onChange={(e) => setComentario(e.target.value)} className={INPUT} autoFocus />
              </Campo>
              <button disabled={ocupado || comentario.trim().length < 3} onClick={() => revisar(modo)} className={BTN_PRIMARIO}>Confirmar</button>
              <button onClick={() => { setModo(""); setComentario(""); }} className={BTN}>Volver</button>
            </div>
          )}
        </div>
      )}
      {puedeRevisar && cerrado && <p className="text-[11px] text-stone-400 mt-1">Revisado {hace(doc.revisado_en)}.</p>}
    </div>
  );
}

/* =========================================================
   DETALLE DE UNA VALIDACIÓN
========================================================= */
export function ValidacionDetalle({ api, id, onCerrar, onCambio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("validacion.get", { id }), [api, id]);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [ocupado, setOcupado] = useState(false);
  const [asignando, setAsignando] = useState(false);
  const [equipo, setEquipo] = useState([]);
  const [destino, setDestino] = useState("");

  if (cargando && !datos) return <Modal titulo="Validación" onCerrar={onCerrar}><Cargando /></Modal>;
  if (error && !datos) return <Modal titulo="Validación" onCerrar={onCerrar}><Aviso>{error}</Aviso></Modal>;
  const v = datos.validacion;
  const p = v.progreso;
  const cambio = async () => { await recargar(); onCambio(); };
  const accion = async (op, extra) => {
    setMsg({ tipo: "", texto: "" }); setOcupado(true);
    try { await api(op, { id: v.id, ...extra }); setAsignando(false); await cambio(); } catch (e) { setMsg({ tipo: "error", texto: mensajeError(e) }); }
    setOcupado(false);
  };
  const abrirAsignar = () => { setAsignando(true); api("validacion.equipo").then((r) => setEquipo(r.validadores)).catch(() => {}); };
  const grupos = [["vehiculo", "Documentos del vehículo"], ["cliente", v.tipo === "compra" ? "Documentos del vendedor" : "Documentos del cliente y del pago"]];

  return (
    <Modal titulo={`Validación ${v.folio}`} onCerrar={onCerrar} ancho="max-w-3xl">
      <div className="flex flex-wrap items-center gap-3">
        <Estado id={v.estado} /><span className="text-xs text-stone-500">{tipoValidacionNombre(v.tipo)}{v.sujeto && v.sujeto.folio ? ` · ${v.sujeto.folio}` : ""}{v.sujeto && v.sujeto.vendedor ? ` · ${v.sujeto.vendedor}` : ""}</span>
        <span className="text-xs text-stone-400 ml-auto">Pedida {hace(v.solicitada_en)}</span>
      </div>
      <div className="bg-white border border-stone-200 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div><p className="text-xs uppercase tracking-wide text-stone-400">Vehículo</p><p className="text-stone-900">{nombreSujeto(v.sujeto)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-stone-400">Validador</p><p className="text-stone-900">{v.validador || "Esperando que lo tome un Validador"}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-stone-400">Avance</p><p className="text-stone-900">{p.aprobados + p.noAplica} de {p.total} documentos listos{p.observados + p.rechazados > 0 ? <span className="text-orange-700"> · {p.observados + p.rechazados} con observaciones</span> : null}</p></div>
      </div>
      {v.estado === "aprobada" && <Aviso tipo="ok">Documentos validados{v.tipo === "venta" ? ": el Jefe Local ya puede aprobar la venta." : "."}</Aviso>}
      {(v.estado === "observada" || v.estado === "rechazada") && datos.puedeAdjuntar && <Aviso>Hay documentos con observaciones: corrígelos subiendo el archivo nuevo y volverán a revisión.</Aviso>}
      {msg.texto && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="flex flex-wrap gap-2">
        {v.estado === "pendiente" && datos.puedeRealizar && <button disabled={ocupado} onClick={() => accion("validacion.tomar")} className={BTN_AMBAR}>Tomar para revisar</button>}
        {datos.esMia && v.estado !== "aprobada" && <button disabled={ocupado} onClick={() => accion("validacion.liberar")} className={BTN}>Devolver a la cola</button>}
        {datos.puedeGestionar && v.estado !== "aprobada" && v.estado !== "cancelada" && <button onClick={asignando ? () => setAsignando(false) : abrirAsignar} className={BTN}>{v.validador ? "Reasignar" : "Asignar a un Validador"}</button>}
      </div>
      {asignando && (
        <div className="flex flex-wrap items-end gap-3 border border-stone-200 bg-white p-3">
          <Campo etiqueta="Validador" className="flex-1 min-w-[200px]"><select value={destino} onChange={(e) => setDestino(e.target.value)} className={INPUT}><option value="">Elige…</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
          <button disabled={ocupado || !destino} onClick={() => accion("validacion.asignar", { validadorId: destino })} className={BTN_PRIMARIO}>Asignar</button>
        </div>
      )}

      {grupos.map(([g, titulo]) => {
        const lista = datos.docs.filter((d) => d.grupo === g);
        if (lista.length === 0) return null;
        return (
          <div key={g} className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-wide text-stone-400">{titulo}</p>
            {lista.map((d) => <Documento key={d.id} api={api} val={v} doc={d} puedeRevisar={datos.puedeRevisar} puedeAdjuntar={datos.puedeAdjuntar} onCambio={cambio} avisar={(t) => setMsg({ tipo: "error", texto: t })} />)}
          </div>
        );
      })}
      {!datos.puedeRevisar && v.estado === "en_revision" && datos.puedeRealizar && !datos.esMia && <p className="text-xs text-stone-500">La tiene {v.validador}: solo quien la tomó puede revisar los documentos.</p>}
    </Modal>
  );
}

/* =========================================================
   SECCIÓN EN LA FICHA DEL LEAD / VEHÍCULO / TASACIÓN
========================================================= */
export function SeccionValidacion({ api, origen, titulo = "Validación de documentos", version = 0, onCambio = () => {} }) {
  const campo = origen.tipo === "lead" ? "leadId" : origen.tipo === "tasacion" ? "tasacionId" : origen.tipo === "cierre" ? "cierreId" : "vehiculoId";
  const { datos, error, recargar } = useCarga(() => api("validacion.list", { vista: "origen", [campo]: origen.id }), [api, origen.id, version]);
  const [detalle, setDetalle] = useState(null);
  if (error || !datos || datos.validaciones.length === 0) return null;
  const cambio = async () => { await recargar(); onCambio(); };
  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
      <p className="text-sm text-stone-700">{titulo}</p>
      {datos.validaciones.map((v) => (
        <div key={v.id} className="border border-stone-300 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-stone-500">{v.folio}</span><span className="text-stone-900">{tipoValidacionNombre(v.tipo)}{v.sujeto && v.sujeto.folio ? ` · ${v.sujeto.folio}` : ""}</span><Estado id={v.estado} />
          </div>
          <p className="text-xs text-stone-500 mt-1">
            {v.progreso.aprobados + v.progreso.noAplica} de {v.progreso.total} documentos listos
            {v.progreso.observados + v.progreso.rechazados > 0 ? ` · ${v.progreso.observados + v.progreso.rechazados} con observaciones` : ""}
            {v.validador ? ` · Validador: ${v.validador}` : v.estado === "pendiente" ? " · esperando que un Validador la tome" : ""}
          </p>
          {v.tipo === "venta" && v.estado !== "aprobada" && <p className="text-xs text-amber-700 mt-1">La venta no se podrá aprobar hasta que sus documentos estén validados.</p>}
          <div className="mt-2"><button onClick={() => setDetalle(v.id)} className={BTN}>{v.estado === "aprobada" ? "Ver documentos" : "Ver y subir documentos"}</button></div>
        </div>
      ))}
      {detalle && <ValidacionDetalle api={api} id={detalle} onCerrar={() => setDetalle(null)} onCambio={cambio} />}
    </div>
  );
}

/* =========================================================
   LISTAS Y RESUMEN
========================================================= */
function Lista({ api, vista, estadoFiltro, version, onAbrir, onTomar, vacio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("validacion.list", { vista, estado: estadoFiltro || undefined }), [api, vista, estadoFiltro, version]);
  const [msg, setMsg] = useState("");
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const tomar = async (v) => { setMsg(""); try { await onTomar(v); await recargar(); } catch (e) { setMsg(mensajeError(e)); await recargar(); } };
  return (
    <>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Validación</th><th className="py-3 px-4">Vehículo</th><th className="py-3 px-4">Avance</th><th className="py-3 px-4">Validador</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {datos.validaciones.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">{vacio}</td></tr>}
            {datos.validaciones.map((v) => (
              <tr key={v.id} className="border-b border-stone-100 align-top">
                <td className="py-2.5 px-4"><span className="font-mono text-xs text-stone-500">{v.folio}</span><div className="text-xs text-stone-600">{tipoValidacionNombre(v.tipo)}{v.sujeto && v.sujeto.folio ? ` · ${v.sujeto.folio}` : ""}</div><div className="text-[11px] text-stone-400">{hace(v.solicitada_en)}</div></td>
                <td className="py-2.5 px-4 text-stone-900">{nombreSujeto(v.sujeto)}</td>
                <td className="py-2.5 px-4 text-stone-700 whitespace-nowrap">{v.progreso.aprobados + v.progreso.noAplica}/{v.progreso.total}{v.progreso.observados + v.progreso.rechazados > 0 ? <span className="text-orange-700"> · {v.progreso.observados + v.progreso.rechazados} obs.</span> : null}</td>
                <td className="py-2.5 px-4 text-stone-700">{v.validador || "—"}</td>
                <td className="py-2.5 px-4"><Estado id={v.estado} /></td>
                <td className="py-2.5 px-4 text-right whitespace-nowrap">
                  {v.estado === "pendiente" && datos.puedeRealizar && <button onClick={() => tomar(v)} className={BTN_AMBAR}>Tomar</button>}{" "}
                  <button onClick={() => onAbrir(v.id)} className={BTN}>Abrir</button>
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
  const { cargando, error, datos } = useCarga(() => api("validacion.resumen", { mes }), [api, mes, version]);
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
            <th className="py-3 px-4">Validador</th><th className="py-3 px-4 text-right">Aprobadas</th><th className="py-3 px-4 text-right">Tiempo medio</th><th className="py-3 px-4 text-right">Abiertas</th><th className="py-3 px-4 text-right">Con observaciones</th>
          </tr></thead>
          <tbody>
            {datos.validadores.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-stone-500">Aún no hay Validadores con actividad.</td></tr>}
            {datos.validadores.map((x) => (
              <tr key={x.id} className="border-b border-stone-100">
                <td className="py-2.5 px-4 text-stone-900">{x.nombre}</td><td className="py-2.5 px-4 text-right font-mono">{x.aprobadas}</td>
                <td className="py-2.5 px-4 text-right font-mono">{x.aprobadas ? `${x.tiempoMedioHoras} h` : "—"}</td><td className="py-2.5 px-4 text-right font-mono">{x.abiertas}</td><td className="py-2.5 px-4 text-right font-mono">{x.conObservaciones}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">El tiempo medio cuenta desde que se pidió la validación hasta que quedó aprobada. El Validador no tiene comisión por ahora: se mide su actividad.</p>
    </>
  );
}

/* =========================================================
   MÓDULO
========================================================= */
export function ModuloValidaciones({ api: apiProp, permisos = [], esAdmin = false }) {
  const can = (p) => esAdmin || permisos.includes(p);
  const realiza = !esAdmin && permisos.includes("validacion.realizar");
  const supervisa = can("leads.asignar");
  const api = apiProp || apiPorDefecto;
  const [tab, setTab] = useState(realiza ? "cola" : "todas");
  const [version, setVersion] = useState(0);
  const [abierta, setAbierta] = useState(null);
  const [filtro, setFiltro] = useState("");
  const subir = () => setVersion((v) => v + 1);
  const cola = useCarga(() => (realiza || supervisa ? api("validacion.list", { vista: "cola" }).then((r) => r.validaciones.length).catch(() => 0) : Promise.resolve(0)), [version]);

  const opciones = [];
  if (realiza) opciones.push(["cola", "Por tomar", cola.datos || 0], ["mias", "Mis validaciones"]);
  opciones.push(["todas", realiza ? "Todas del local" : "Validaciones"], ["resumen", "Resumen"]);
  const tomar = async (v) => { await api("validacion.tomar", { id: v.id }); subir(); setAbierta(v.id); };

  return (
    <div className="flex flex-col gap-5">
      <Pestanas valor={tab} onCambio={setTab} opciones={opciones} />
      {tab === "cola" && <Lista api={api} vista="cola" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No hay validaciones esperando. 👌" />}
      {tab === "mias" && <Lista api={api} vista="mias" version={version} onAbrir={setAbierta} onTomar={tomar} vacio="Todavía no tienes validaciones. Toma una de la cola." />}
      {tab === "todas" && (
        <>
          <div className="flex items-center gap-2 text-sm text-stone-600">Estado:
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${INPUT} md:w-52`}>
              <option value="">Todos</option><option value="pendiente">Por tomar</option><option value="en_revision">En revisión</option><option value="observada">Con observaciones</option><option value="rechazada">Rechazadas</option><option value="aprobada">Aprobadas</option>
            </select>
          </div>
          <Lista api={api} vista="local" estadoFiltro={filtro} version={version} onAbrir={setAbierta} onTomar={tomar} vacio="No hay validaciones con ese filtro." />
        </>
      )}
      {tab === "resumen" && <Resumen api={api} version={version} />}
      {abierta && <ValidacionDetalle api={api} id={abierta} onCerrar={() => setAbierta(null)} onCambio={subir} />}
    </div>
  );
}
