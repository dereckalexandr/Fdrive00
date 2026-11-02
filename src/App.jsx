import React, { useState, useEffect, useRef } from "react";
const cargarLectorCav = () => import("./cav-parser.js");
import { buildInspeccionPdf, buildTasacionPdf, pdfFileName } from "./pdf-report.js";
import { CHECKLIST_SECTIONS, TASACION_SECTIONS, getTasacionSectionItems, ESTADOS_DOCUMENTO, ESTADOS_SI_NO, ESTADOS_CARROCERIA, ESTADOS_INTERIOR, ESTADOS_VIDRIO } from "./checklists.js";
import { saveDraft, loadDraft, clearDraft, isMeaningful } from "./drafts.js";
import { computeTasacionTotals, computeValorFinal } from "./tasacion-totals.js";
import TasacionCompra from "./estimador-compra.jsx";
import { AdminCrmPanel, PESTANAS_CRM } from "./crm-admin.jsx";
import { ModuloVentas } from "./crm-ventas.jsx";
import { InputDinero } from "./campo-dinero.jsx";
import { ModuloTasaciones } from "./crm-tasaciones.jsx";
import { ModuloValidaciones } from "./crm-validaciones.jsx";
import { ModuloAnuncios } from "./crm-anuncios.jsx";
import { ModuloMarketing } from "./crm-marketing.jsx";
import { ModuloInspecciones, Miniatura as MiniaturaEquipo, fotoKeyInspeccion, guardarCacheFoto } from "./crm-inspecciones.jsx";
import { resumirInspeccion, MAX_FOTOS_INSPECCION } from "../supabase/functions/api/inspecciones-core.js";
import { useGuardado, mensajeError as mensajeCrm } from "./crm-ui.jsx";
import { LoginPersonal, CambioClaveObligatorio, EstacionTrabajo } from "./crm-estacion.jsx";
import { photoKey, makePhotoId, compressImage, collectPhotoIds, diffIds, MAX_PHOTOS_PER_ITEM, MAX_PHOTOS_PER_TASACION } from "./photos.js";

const clp = (n) =>
  (n || 0).toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

/* --- Autenticación del administrador ---
   La validación vive en la Edge Function (supabase/functions/api); aquí solo
   queda la regla de formato para la clave adicional. */
function isValidAdminPassword(pw) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/.test(pw || "");
}
function authErrorMessage(e, fallback) {
  const m = e && e.message;
  if (m === "too_many_attempts") return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  if (m === "server_not_configured") return "El servidor de acceso no está configurado.";
  return fallback;
}


async function saveInspeccion(inspectorId, id, data) {
  try { await window.storage.set(`inspeccion::${inspectorId}::${id}`, JSON.stringify(data), true); return true; }
  catch (e) { return false; }
}
async function loadInspeccionesFor(inspectorId) {
  try {
    const listRes = await window.storage.list(`inspeccion::${inspectorId}::`, true);
    if (!listRes || !listRes.keys) return [];
    const out = [];
    for (const k of listRes.keys) {
      try { const res = await window.storage.get(k, true); if (res) out.push({ id: k, data: JSON.parse(res.value) }); } catch (e) {}
    }
    out.sort((a, b) => (b.data.guardadoEl || "").localeCompare(a.data.guardadoEl || ""));
    return out;
  } catch (e) { return []; }
}
async function saveTasacion(inspectorId, id, data) {
  try { await window.storage.set(`tasacion::${inspectorId}::${id}`, JSON.stringify(data), true); return true; }
  catch (e) { return false; }
}
async function deleteInspeccion(key) {
  try { return await window.storage.delete(key, true); } catch (e) { return null; }
}
async function deleteTasacion(key) {
  try { return await window.storage.delete(key, true); } catch (e) { return null; }
}
async function loadTasacionesFor(inspectorId) {
  try {
    const listRes = await window.storage.list(`tasacion::${inspectorId}::`, true);
    if (!listRes || !listRes.keys) return [];
    const out = [];
    for (const k of listRes.keys) {
      try { const res = await window.storage.get(k, true); if (res) out.push({ id: k, data: JSON.parse(res.value) }); } catch (e) {}
    }
    out.sort((a, b) => (b.data.guardadoEl || "").localeCompare(a.data.guardadoEl || ""));
    return out;
  } catch (e) { return []; }
}

function emptyInspeccion() {
  return {
    cavFileName: "",
    cavFileData: "",
    fecha: new Date().toISOString().slice(0, 10),
    inscripcion: "",
    anio: "",
    marca: "",
    modelo: "",
    nroMotor: "",
    nroChasis: "",
    nroSerie: "",
    nroVin: "",
    color: "",
    propietarioNombre: "",
    propietarioRun: "",
    checklist: {},
    fotosEquipo: [],
  };
}

/* --- Tasaciones --- */
function emptyTasacion() {
  return {
    propietario: "",
    fecha: new Date().toISOString().slice(0, 10),
    vehiculo: "",
    patente: "",
    anio: "",
    kilometraje: "",
    valorComercial: 0,
    estadoGeneral: "",
    observaciones: "",
    inspeccionId: "",
    checklist: {},
  };
}


/* =========================================================
   COMPONENTES DE FORMULARIO
========================================================= */
function NumberField({ value, onChange, readOnly = false, disabled = false }) {
  if (readOnly) {
    return <div className="w-full px-2 py-1.5 text-right font-mono text-sm text-stone-700">{(value || 0).toLocaleString("es-CL")}</div>;
  }
  return (
    <InputDinero
      value={value === 0 ? "" : value}
      placeholder="0"
      disabled={disabled}
      onChange={(e) => onChange(toNum(e.target.value))}
      className={`w-full border px-2 py-1.5 font-mono text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500 ${
        disabled ? "border-stone-200 bg-stone-100 text-stone-400 cursor-not-allowed" : "border-stone-300 bg-white text-stone-900"
      }`}
    />
  );
}

function TextField({ label, value, onChange, readOnly = false, placeholder = "" }) {
  return (
    <div>
      <label className="text-xs text-stone-500 block mb-1">{label}</label>
      {readOnly ? (
        <div className="w-full px-2 py-1.5 text-sm text-stone-700">{value || "—"}</div>
      ) : (
        <input
          type="text"
          value={value || ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      )}
    </div>
  );
}

const ESTADOS_CHECKLIST = ["Bueno", "Regular", "Malo", "No aplica"];

function PdfDropzone({ fileName, fileData, onFileLoaded, onRemove, readOnly = false }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const processFile = (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) { setError("Solo se aceptan archivos en formato PDF."); return; }
    setError("");
    const reader = new FileReader();
    reader.onload = () => onFileLoaded(file.name, reader.result);
    reader.onerror = () => setError("No se pudo leer el archivo, intenta nuevamente.");
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    processFile(file);
  };

  const handleInputChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    processFile(file);
  };

  if (readOnly) {
    return fileData ? (
      <a href={fileData} download={fileName || "archivo.pdf"} className="text-sm text-amber-700 hover:underline">{fileName || "Ver PDF"}</a>
    ) : (
      <p className="text-sm text-stone-500">Sin archivo cargado.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current && inputRef.current.click()}
        className={`cursor-pointer border-2 border-dashed p-8 text-center transition-colors ${dragOver ? "border-amber-500 bg-amber-50" : "border-stone-300 bg-stone-50 hover:bg-stone-100"}`}
      >
        <p className="text-sm text-stone-600 md:hidden">Toca para seleccionar el PDF</p>
        <p className="text-sm text-stone-600 hidden md:block">Arrastra aquí tu archivo PDF, o haz clic para seleccionarlo</p>
        <p className="text-xs text-stone-400 mt-1">Solo formato PDF</p>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={handleInputChange} className="hidden" />
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {fileName && (
        <div className="flex items-center gap-3 text-sm text-stone-600">
          <span>Archivo cargado: {fileName}</span>
          <a href={fileData} download={fileName} onClick={(e) => e.stopPropagation()} className="text-amber-700 hover:underline">Ver</a>
          <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-rose-600 hover:underline">Quitar</button>
        </div>
      )}
    </div>
  );
}

/* ---------- Módulos plegables (agrupan cada parte del formulario) ---------- */
function Module({ id, title, badge, meta, accent = "border-sky-600", open, onToggle, children }) {
  const rootRef = useRef(null);
  // Segunda flecha, al final del módulo: lo contrae y deja su encabezado a la vista
  // (si no, en un módulo largo la página quedaría varias pantallas más abajo).
  const collapseFromBottom = () => {
    onToggle(id);
    // Salto directo (no suave): la página se acorta mientras se contrae y un scroll animado se cancelaría a medias.
    setTimeout(() => {
      if (rootRef.current) rootRef.current.scrollIntoView({ block: "nearest" });
    }, 30);
  };
  return (
    <div ref={rootRef} className={`bg-white border border-stone-200 border-l-4 ${accent}`}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-4 text-left min-h-[52px]"
      >
        <div>
          <h3 className="font-serif text-lg text-stone-900">{title}</h3>
          {meta && <p className="text-xs font-mono text-stone-500 mt-0.5">{meta}</p>}
        </div>
        <span className="flex items-center gap-3 shrink-0">
          {badge && (
            <span className={`text-xs px-2 py-0.5 border ${badge.done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-stone-50 text-stone-500 border-stone-200"}`}>
              {badge.text}
            </span>
          )}
          <span aria-hidden="true" className="text-stone-400 text-xs">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 md:px-5 pb-3">
          {children}
          <button
            type="button"
            onClick={collapseFromBottom}
            aria-label={`Contraer ${title}`}
            className="mt-4 w-full flex items-center justify-center gap-2 border-t border-stone-200 pt-3 pb-1 min-h-[44px] text-sm text-stone-500 hover:text-stone-800"
          >
            <span aria-hidden="true" className="text-xs">▲</span> Contraer
          </button>
        </div>
      )}
    </div>
  );
}
const sectionName = (title) => String(title).replace(/^\d+\.\s*/, "");
function SubtotalRow({ title, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-stone-200 pt-3 mt-4">
      <span className="text-sm text-stone-600">Subtotal {sectionName(title)}</span>
      <span className="font-mono text-lg text-stone-900">{clp(value)}</span>
    </div>
  );
}
// Valor comercial estimado − total de valorizaciones = valor final (historial de tasaciones).
function ValorFinalResumen({ record }) {
  const totals = computeTasacionTotals(record.checklist, TASACION_SECTIONS, getTasacionSectionItems);
  const vf = computeValorFinal(record.valorComercial, totals.total);
  return (
    <dl className="mt-2 text-xs text-stone-600 max-w-xs">
      <div className="flex justify-between gap-3"><dt>Valor comercial estimado</dt><dd className="font-mono">{clp(vf.valorComercial)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Menos: Total valorizaciones</dt><dd className="font-mono">{clp(vf.total)}</dd></div>
      <div className="flex justify-between gap-3 border-t border-stone-300 mt-1 pt-1 text-sm font-semibold text-stone-900"><dt>Valor final</dt><dd className="font-mono">{clp(vf.final)}</dd></div>
    </dl>
  );
}
function TotalCard({ value }) {
  return (
    <div className="bg-stone-900 text-stone-100 px-4 py-4 md:px-5 flex items-baseline justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-widest text-stone-400">Total valorizaciones</p>
        <p className="text-xs text-stone-400 mt-0.5">Suma de los subtotales de todos los módulos</p>
      </div>
      <span className="font-bold tabular-nums text-2xl">{clp(value)}</span>
    </div>
  );
}
const countBadge = (done, total) => ({ text: `${done}/${total}`, done: total > 0 && done >= total });

function useModules(ids, initiallyOpen) {
  const [open, setOpen] = useState(() => Object.fromEntries(ids.map((id) => [id, initiallyOpen.includes(id)])));
  return {
    open,
    toggle: (id) => setOpen((o) => ({ ...o, [id]: !o[id] })),
    setAll: (value) => setOpen(Object.fromEntries(ids.map((id) => [id, value]))),
  };
}

function ModuleToolbar({ modules }) {
  return (
    <div className="flex justify-end gap-4 text-xs">
      <button type="button" onClick={() => modules.setAll(true)} className="text-stone-500 hover:underline py-1">Expandir todo</button>
      <button type="button" onClick={() => modules.setAll(false)} className="text-stone-500 hover:underline py-1">Contraer todo</button>
    </div>
  );
}

const hasText = (v) => String(v == null ? "" : v).trim() !== "";
const INSPECCION_VEHICULO_KEYS = ["inscripcion", "anio", "marca", "modelo", "nroMotor", "nroChasis", "color"];

function InspeccionForm({ record, onFieldChange, onChecklistChange, readOnly = false }) {
  const fechaDisplay = record.fecha
    ? new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const moduleIds = ["cav", "vehiculo", "propietario", ...CHECKLIST_SECTIONS.map((s) => s.id)];
  const modules = useModules(moduleIds, readOnly ? moduleIds : ["cav"]);

  const [autoFillMsg, setAutoFillMsg] = useState("");
  const [autoFilling, setAutoFilling] = useState(false);

  const handleCavLoaded = async (name, data) => {
    onFieldChange("cavFileName", name);
    onFieldChange("cavFileData", data);
    setAutoFillMsg("");
    setAutoFilling(true);
    try {
      const { extractPdfText, parseCavFields } = await cargarLectorCav();
      const text = await extractPdfText(data);
      const fields = parseCavFields(text);
      const filledKeys = Object.keys(fields).filter((key) => fields[key] && !record[key]);
      filledKeys.forEach((key) => onFieldChange(key, fields[key]));
      setAutoFillMsg(
        filledKeys.length > 0
          ? `Se autocompletaron ${filledKeys.length} campo(s) desde el CAV. Verifica los datos antes de guardar.`
          : "No se detectaron datos automáticamente en este PDF (puede ser una imagen escaneada). Completa los campos manualmente."
      );
      // Abre los módulos que se acaban de llenar para que el inspector los revise.
      if (filledKeys.some((k) => INSPECCION_VEHICULO_KEYS.includes(k) && !modules.open.vehiculo)) modules.toggle("vehiculo");
      if (filledKeys.some((k) => k.startsWith("propietario")) && !modules.open.propietario) modules.toggle("propietario");
    } catch (e) {
      console.warn("No se pudo leer el CAV automáticamente:", e);
      setAutoFillMsg("No se pudo leer el contenido del PDF automáticamente. Completa los campos manualmente.");
    } finally {
      setAutoFilling(false);
    }
  };

  const vehiculoDone = INSPECCION_VEHICULO_KEYS.filter((k) => hasText(record[k])).length;
  const propietarioDone = ["propietarioNombre", "propietarioRun"].filter((k) => hasText(record[k])).length;

  return (
    <div className="flex flex-col gap-3">
      <ModuleToolbar modules={modules} />

      <Module id="cav" title="CAV" open={modules.open.cav} onToggle={modules.toggle}
        badge={{ text: record.cavFileName ? "Cargado" : "Sin archivo", done: !!record.cavFileName }}>
        <PdfDropzone
          fileName={record.cavFileName}
          fileData={record.cavFileData}
          onFileLoaded={handleCavLoaded}
          onRemove={() => { onFieldChange("cavFileName", ""); onFieldChange("cavFileData", ""); }}
          readOnly={readOnly}
        />
        {autoFilling && <p className="text-xs text-stone-500 mt-2">Leyendo el CAV para autocompletar datos…</p>}
        {!autoFilling && autoFillMsg && <p className="text-xs text-stone-500 mt-2">{autoFillMsg}</p>}
      </Module>

      <Module id="vehiculo" title="Datos del vehículo" open={modules.open.vehiculo} onToggle={modules.toggle}
        badge={countBadge(vehiculoDone, INSPECCION_VEHICULO_KEYS.length)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Fecha del día</label>
            <div className="w-full px-2 py-1.5 text-sm text-stone-700 bg-stone-50 border border-stone-200">{fechaDisplay}</div>
          </div>
          <TextField label="Inscripción" value={record.inscripcion} onChange={(v) => onFieldChange("inscripcion", v)} readOnly={readOnly} />
          <TextField label="Año" value={record.anio} onChange={(v) => onFieldChange("anio", v)} readOnly={readOnly} />
          <TextField label="Marca" value={record.marca} onChange={(v) => onFieldChange("marca", v)} readOnly={readOnly} />
          <TextField label="Modelo" value={record.modelo} onChange={(v) => onFieldChange("modelo", v)} readOnly={readOnly} />
          <TextField label="Nro Motor" value={record.nroMotor} onChange={(v) => onFieldChange("nroMotor", v)} readOnly={readOnly} />
          <TextField label="Nro Chasis" value={record.nroChasis} onChange={(v) => onFieldChange("nroChasis", v)} readOnly={readOnly} />
          <TextField label="Nro Serie" value={record.nroSerie} onChange={(v) => onFieldChange("nroSerie", v)} readOnly={readOnly} />
          <TextField label="Nro Vin" value={record.nroVin} onChange={(v) => onFieldChange("nroVin", v)} readOnly={readOnly} />
          <TextField label="Color" value={record.color} onChange={(v) => onFieldChange("color", v)} readOnly={readOnly} />
        </div>
      </Module>

      <Module id="propietario" title="Datos del propietario" open={modules.open.propietario} onToggle={modules.toggle}
        badge={countBadge(propietarioDone, 2)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField label="Nombre" value={record.propietarioNombre} onChange={(v) => onFieldChange("propietarioNombre", v)} readOnly={readOnly} />
          <TextField label="R.U.N." value={record.propietarioRun} onChange={(v) => onFieldChange("propietarioRun", v)} readOnly={readOnly} />
        </div>
      </Module>

      {CHECKLIST_SECTIONS.map((section) => {
        const done = section.items.filter((it) => record.checklist?.[it.id]?.estado).length;
        return (
          <Module key={section.id} id={section.id} title={section.title} open={modules.open[section.id]} onToggle={modules.toggle}
            badge={countBadge(done, section.items.length)}>
            <div className="flex flex-col gap-4">
              {section.items.map((item) => {
                const itemState = record.checklist?.[item.id] || { estado: "", observacion: "" };
                return (
                  <div key={item.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-stone-100 pb-4">
                    <div className="text-sm font-medium md:font-normal text-stone-700 flex items-center">{item.label}</div>
                    <div>
                      {readOnly ? (
                        <div className="text-sm text-stone-700">{itemState.estado || "—"}</div>
                      ) : (
                        <select
                          value={itemState.estado}
                          onChange={(e) => onChecklistChange(item.id, { estado: e.target.value })}
                          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="">Seleccionar</option>
                          {ESTADOS_CHECKLIST.map((op) => <option key={op} value={op}>{op}</option>)}
                        </select>
                      )}
                    </div>
                    <div>
                      {readOnly ? (
                        <div className="text-sm text-stone-500">{itemState.observacion || "—"}</div>
                      ) : (
                        <input
                          type="text"
                          value={itemState.observacion || ""}
                          placeholder="Observaciones"
                          onChange={(e) => onChecklistChange(item.id, { observacion: e.target.value })}
                          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Module>
        );
      })}
    </div>
  );
}

/* ---------- Fotos de la tasación: botón (+) por caja, miniaturas y visor ---------- */
const photoCache = new Map(); // id -> data URL (evita volver a descargar la misma foto)

function PhotoThumb({ inspectorId, photoId, onOpen, tam = "w-14 h-14" }) {
  const [src, setSrc] = useState(photoCache.get(photoId) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (photoCache.has(photoId)) { setSrc(photoCache.get(photoId)); return undefined; }
    let alive = true;
    (async () => {
      const res = await window.storage.get(photoKey(inspectorId, photoId), true);
      if (!alive) return;
      if (res && res.value) { photoCache.set(photoId, res.value); setSrc(res.value); } else setFailed(true);
    })();
    return () => { alive = false; };
  }, [photoId, inspectorId]);
  return (
    <button
      type="button"
      onClick={() => src && onOpen(photoId)}
      aria-label="Ver foto"
      className={`${tam} shrink-0 border border-stone-300 bg-stone-100 overflow-hidden flex items-center justify-center text-xs text-stone-400`}
    >
      {src ? <img src={src} alt="Foto de la pieza" className="w-full h-full object-cover" /> : failed ? "!" : "…"}
    </button>
  );
}

function PhotoLightbox({ photoId, onClose, onRemove }) {
  const src = photoCache.get(photoId);
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" role="dialog" aria-label="Foto" onClick={onClose}>
      <div className="flex items-center justify-between p-3" onClick={(e) => e.stopPropagation()}>
        {onRemove ? (
          <button type="button" onClick={() => { if (window.confirm("¿Quitar esta foto?")) onRemove(photoId); }} className="text-rose-300 text-sm px-3 py-2 border border-rose-300/50">Quitar foto</button>
        ) : <span />}
        <button type="button" onClick={onClose} className="text-white text-sm px-3 py-2 border border-white/40">Cerrar</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {src && <img src={src} alt="Foto de la pieza" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />}
      </div>
    </div>
  );
}

// `photos` = { inspectorId, busy, errors, add(itemId, file), remove(itemId, photoId) }.
// Con `viewOnly` (vista del administrador) solo se muestran las fotos: sin botón (+) ni opción de quitar.
function PhotoStrip({ itemId, label, fotos, photos }) {
  const list = fotos || [];
  const inputRef = useRef(null);
  const [openId, setOpenId] = useState(null);
  const busy = !!(photos.busy && photos.busy[itemId]);
  const full = list.length >= MAX_PHOTOS_PER_ITEM;
  if (photos.viewOnly) {
    if (list.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {list.map((id) => <PhotoThumb key={id} inspectorId={photos.inspectorId} photoId={id} onOpen={setOpenId} />)}
        <span className="text-xs text-stone-400">{list.length} foto{list.length === 1 ? "" : "s"}</span>
        {openId && <PhotoLightbox photoId={openId} onClose={() => setOpenId(null)} />}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      <button
        type="button"
        disabled={busy || full}
        onClick={() => inputRef.current && inputRef.current.click()}
        aria-label={`Agregar foto: ${label}`}
        title={full ? `Máximo ${MAX_PHOTOS_PER_ITEM} fotos` : "Agregar foto"}
        className="w-14 h-14 shrink-0 border-2 border-dashed border-stone-300 text-stone-500 text-2xl leading-none hover:bg-stone-50 disabled:opacity-40"
      >
        {busy ? "…" : "+"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) photos.add(itemId, f); }}
      />
      {list.map((id) => <PhotoThumb key={id} inspectorId={photos.inspectorId} photoId={id} onOpen={setOpenId} />)}
      {list.length > 0 && <span className="text-xs text-stone-400">{list.length}/{MAX_PHOTOS_PER_ITEM}</span>}
      {photos.errors[itemId] && <p className="w-full text-xs text-rose-600">{photos.errors[itemId]}</p>}
      {openId && <PhotoLightbox photoId={openId} onClose={() => setOpenId(null)} onRemove={(id) => { setOpenId(null); photos.remove(itemId, id); }} />}
    </div>
  );
}

const TASACION_DATOS_KEYS = ["propietario", "vehiculo", "patente", "anio", "kilometraje", "valorComercial", "estadoGeneral"];

function TasacionForm({ record, onFieldChange, onChecklistChange, readOnly = false, inspeccionLabel = "", photos = null }) {
  const fechaDisplay = record.fecha
    ? new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const moduleIds = ["datos", ...TASACION_SECTIONS.map((s) => s.id)];
  const modules = useModules(moduleIds, readOnly ? moduleIds : ["datos"]);
  const totals = computeTasacionTotals(record.checklist, TASACION_SECTIONS, getTasacionSectionItems);
  const datosDone = TASACION_DATOS_KEYS.filter((k) => (k === "valorComercial" ? toNum(record[k]) > 0 : hasText(record[k]))).length;

  return (
    <div className="flex flex-col gap-3">
      <ModuleToolbar modules={modules} />

      <Module id="datos" title="Tasación" accent="border-violet-600" open={modules.open.datos} onToggle={modules.toggle}
        badge={countBadge(datosDone, TASACION_DATOS_KEYS.length)}>
        {inspeccionLabel && <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 px-3 py-2 mb-4">Basada en la {inspeccionLabel}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField label="Propietario" value={record.propietario} onChange={(v) => onFieldChange("propietario", v)} readOnly={readOnly} />
          <div>
            <label className="text-xs text-stone-500 block mb-1">Fecha del día</label>
            <div className="w-full px-2 py-1.5 text-sm text-stone-700 bg-stone-50 border border-stone-200">{fechaDisplay}</div>
          </div>
          <TextField label="Vehículo" value={record.vehiculo} onChange={(v) => onFieldChange("vehiculo", v)} readOnly={readOnly} />
          <TextField label="Patente" value={record.patente} onChange={(v) => onFieldChange("patente", v)} readOnly={readOnly} />
          <TextField label="Año" value={record.anio} onChange={(v) => onFieldChange("anio", v)} readOnly={readOnly} />
          <TextField label="Kilometraje" value={record.kilometraje} onChange={(v) => onFieldChange("kilometraje", v)} readOnly={readOnly} />
          <div>
            <label className="text-xs text-stone-500 block mb-1">Valor comercial estimado</label>
            <NumberField value={toNum(record.valorComercial)} onChange={(v) => onFieldChange("valorComercial", v)} readOnly={readOnly} />
          </div>
          <TextField label="Estado general" value={record.estadoGeneral} onChange={(v) => onFieldChange("estadoGeneral", v)} readOnly={readOnly} placeholder="Ej. Bueno" />
          <div className="md:col-span-3">
            <label className="text-xs text-stone-500 block mb-1">Observaciones</label>
            {readOnly ? (
              <div className="w-full px-2 py-1.5 text-sm text-stone-700">{record.observaciones || "—"}</div>
            ) : (
              <textarea
                value={record.observaciones || ""}
                onChange={(e) => onFieldChange("observaciones", e.target.value)}
                rows={3}
                className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            )}
          </div>
        </div>
      </Module>

      <TasacionChecklist checklist={record.checklist || {}} onItemChange={onChecklistChange} readOnly={readOnly} modules={modules} totals={totals} photos={readOnly ? (photos && photos.viewOnly ? photos : null) : photos} />

      <TotalCard value={totals.total} />
    </div>
  );
}

function TasacionChecklist({ checklist, onItemChange, readOnly = false, modules, totals, photos = null }) {
  return (
    <>
      {TASACION_SECTIONS.map((section) => {
        const items = getTasacionSectionItems(section);
        const done = items.filter((it) => {
          const st = checklist[it.id];
          return st && (section.type === "dynamic" ? (st.nombre || st.estado || toNum(st.valor) > 0) : st.estado);
        }).length;
        const subtotal = totals.bySection[section.id] || 0;
        const meta = subtotal > 0 ? `Subtotal ${clp(subtotal)}` : null;
        const badge = section.type === "dynamic" ? { text: `${done} fila${done === 1 ? "" : "s"}`, done: done > 0 } : countBadge(done, items.length);

        if (section.type === "dynamic") {
          return (
            <Module key={section.id} id={section.id} title={section.title} accent="border-violet-600" open={modules.open[section.id]} onToggle={modules.toggle} badge={badge} meta={meta}>
              <div className="flex flex-col">
                {items.map((item) => {
                  const state = checklist[item.id] || { nombre: "", estado: "", valor: 0 };
                  const estadoOptions = section.estadoOptions || ESTADOS_CHECKLIST;
                  return (
                    <div key={item.id} className="border-b border-stone-100 py-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
                      <div>
                        <label className="text-xs text-stone-400 block mb-1 md:hidden">Nombre de pieza</label>
                        {readOnly ? (
                          <div className="px-2 py-1.5 text-sm text-stone-700">{state.nombre || "—"}</div>
                        ) : (
                          <input
                            type="text"
                            value={state.nombre || ""}
                            placeholder="Nombre de la pieza"
                            onChange={(e) => onItemChange(item.id, { nombre: e.target.value })}
                            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-stone-400 block mb-1 md:hidden">Estado</label>
                        {readOnly ? (
                          <div className="px-2 py-1.5 text-sm text-stone-700">{state.estado || "—"}</div>
                        ) : (
                          <select
                            value={state.estado}
                            onChange={(e) => onItemChange(item.id, { estado: e.target.value })}
                            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          >
                            <option value="">Seleccionar</option>
                            {estadoOptions.map((op) => <option key={op} value={op}>{op}</option>)}
                          </select>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-stone-400 block mb-1 md:hidden">Valorización</label>
                        <NumberField value={toNum(state.valor)} onChange={(v) => onItemChange(item.id, { valor: v })} readOnly={readOnly} />
                      </div>
                    </div>
                    {photos && <PhotoStrip itemId={item.id} label={state.nombre || section.title} fotos={state.fotos} photos={photos} />}
                    </div>
                  );
                })}
              </div>
              <SubtotalRow title={section.title} value={subtotal} />
            </Module>
          );
        }

        return (
          <Module key={section.id} id={section.id} title={section.title} accent="border-violet-600" open={modules.open[section.id]} onToggle={modules.toggle} badge={badge} meta={meta}>
            <div className="flex flex-col gap-4">
              {items.map((item) => {
                const state = checklist[item.id] || { nombre: "", estado: "", valor: 0 };
                const estadoOptions = item.estadoOptions || section.estadoOptions || ESTADOS_CHECKLIST;
                return (
                  <div key={item.id} className="flex flex-col gap-3 border-b border-stone-100 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="text-sm font-medium md:font-normal text-stone-700 flex items-center">{item.label}</div>
                      <div>
                        {readOnly ? (
                          <div className="text-sm text-stone-700">{state.estado || "—"}</div>
                        ) : (
                          <select
                            value={state.estado}
                            onChange={(e) => onItemChange(item.id, { estado: e.target.value })}
                            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          >
                            <option value="">Seleccionar</option>
                            {estadoOptions.map((op) => <option key={op} value={op}>{op}</option>)}
                          </select>
                        )}
                      </div>
                      <div>
                        <NumberField value={toNum(state.valor)} onChange={(v) => onItemChange(item.id, { valor: v })} readOnly={readOnly} />
                      </div>
                    </div>
                    {item.extra && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="text-xs text-stone-500 flex items-center">{item.extra.label}</div>
                        <div>
                          {readOnly ? (
                            <div className="text-sm text-stone-700">{state[item.extra.id] || "—"}</div>
                          ) : (
                            <select
                              value={state[item.extra.id] || ""}
                              onChange={(e) => onItemChange(item.id, { [item.extra.id]: e.target.value })}
                              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                              <option value="">Seleccionar</option>
                              {item.extra.options.map((op) => <option key={op} value={op}>{op}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    )}
                    {photos && <PhotoStrip itemId={item.id} label={item.label} fotos={state.fotos} photos={photos} />}
                  </div>
                );
              })}
            </div>
            <SubtotalRow title={section.title} value={subtotal} />
          </Module>
        );
      })}
    </>
  );
}

/* =========================================================
   PANEL EJECUTIVO
========================================================= */
/* =========================================================
   PANEL INSPECTOR
========================================================= */
function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const recordIdFromKey = (key) => String(key).split("::").pop();
const horaCorta = () => new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
const fechaHoraCorta = (iso) =>
  iso ? new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

function RecordActions({ children }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">{children}</div>;
}
function ActionLink({ onClick, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm py-1.5 hover:underline ${danger ? "text-rose-600" : "text-amber-700"}`}
    >
      {children}
    </button>
  );
}

function InspectorDashboard({ inspector, onExit, crm }) {
  // Personas del CRM (ingresan con RUT): sus inspecciones además se registran en el CRM (solicitudes, resultado y comisión).
  const crmRealiza = !!(crm && Array.isArray(crm.permisos) && (crm.permisos.includes("inspecciones.realizar") || crm.permisos.includes("*")));
  const crmApi = (op, params) => window.auth.ventas(op, params);
  const [tab, setTab] = useState(crmRealiza ? "solicitudes" : "inspeccion");
  const [nuevoId, setNuevoId] = useState(() => `${Date.now()}`);
  const [fotosBusy, setFotosBusy] = useState(false);
  const [fotosError, setFotosError] = useState("");

  // Borradores: se restauran una sola vez, antes del primer render, para que
  // el autoguardado no pise el borrador con un formulario vacío.
  const initRef = useRef(null);
  if (!initRef.current) {
    const restore = (kind, empty) => {
      const d = loadDraft(inspector.id, kind);
      if (!d || !isMeaningful(d.data, empty)) return { record: empty, editingId: null, savedAt: null };
      const { __editingId, ...rec } = d.data;
      return { record: { ...empty, ...rec }, editingId: __editingId || null, savedAt: d.savedAt };
    };
    initRef.current = { ins: restore("inspeccion", emptyInspeccion()), tas: restore("tasacion", emptyTasacion()) };
  }
  // Punto de comparación para decidir si hay "trabajo sin guardar" (vacío, o el registro que se está editando).
  const baselineRef = useRef({ ins: emptyInspeccion(), tas: emptyTasacion() });

  const [record, setRecord] = useState(initRef.current.ins.record);
  const [editingId, setEditingId] = useState(initRef.current.ins.editingId);
  const [restoredAt, setRestoredAt] = useState(initRef.current.ins.savedAt);
  const [draftNote, setDraftNote] = useState("");
  const [historial, setHistorial] = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [saveMsg, setSaveMsg] = useState("");
  const [viewing, setViewing] = useState(null); // { key, data }

  const [tasacion, setTasacion] = useState(initRef.current.tas.record);
  const [editingTasId, setEditingTasId] = useState(initRef.current.tas.editingId);
  const [restoredTasAt, setRestoredTasAt] = useState(initRef.current.tas.savedAt);
  const [draftNoteTas, setDraftNoteTas] = useState("");
  const [historialTasaciones, setHistorialTasaciones] = useState([]);
  const [loadingHistTasaciones, setLoadingHistTasaciones] = useState(true);
  const [saveMsgTasacion, setSaveMsgTasacion] = useState("");
  const [viewingTasacion, setViewingTasacion] = useState(null);

  const refreshHistorial = async () => {
    setLoadingHist(true);
    setHistorial(await loadInspeccionesFor(inspector.id));
    setLoadingHist(false);
  };
  const refreshHistorialTasaciones = async () => {
    setLoadingHistTasaciones(true);
    setHistorialTasaciones(await loadTasacionesFor(inspector.id));
    setLoadingHistTasaciones(false);
  };
  useEffect(() => { refreshHistorial(); refreshHistorialTasaciones(); }, [inspector.id]);

  // Autoguardado del borrador (con una pequeña espera para no escribir en cada tecla).
  useEffect(() => {
    const t = setTimeout(() => {
      if (isMeaningful(record, baselineRef.current.ins)) {
        const r = saveDraft(inspector.id, "inspeccion", { ...record, __editingId: editingId });
        setDraftNote(!r.ok ? "No se pudo guardar el borrador en este dispositivo." : `Borrador guardado en este dispositivo · ${horaCorta()}${r.sinArchivo ? " (sin el PDF del CAV: pesa demasiado)" : ""}`);
      } else { clearDraft(inspector.id, "inspeccion"); setDraftNote(""); }
    }, 700);
    return () => clearTimeout(t);
  }, [record, editingId]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (isMeaningful(tasacion, baselineRef.current.tas)) {
        const r = saveDraft(inspector.id, "tasacion", { ...tasacion, __editingId: editingTasId });
        setDraftNoteTas(!r.ok ? "No se pudo guardar el borrador en este dispositivo." : `Borrador guardado en este dispositivo · ${horaCorta()}`);
      } else { clearDraft(inspector.id, "tasacion"); setDraftNoteTas(""); }
    }, 700);
    return () => clearTimeout(t);
  }, [tasacion, editingTasId]);

  const updateField = (field, value) => setRecord((prev) => ({ ...prev, [field]: value }));
  const updateChecklist = (itemId, patch) => {
    setRecord((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, [itemId]: { ...(prev.checklist[itemId] || { estado: "", observacion: "" }), ...patch } },
    }));
  };
  const updateTasacionField = (field, value) => setTasacion((prev) => ({ ...prev, [field]: value }));
  const updateTasacionChecklist = (itemId, patch) => {
    setTasacion((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, [itemId]: { ...(prev.checklist[itemId] || { nombre: "", estado: "", valor: 0 }), ...patch } },
    }));
  };

  const resetInspeccion = () => {
    baselineRef.current.ins = emptyInspeccion();
    setRecord(emptyInspeccion()); setEditingId(null); setRestoredAt(null); setDraftNote("");
    setNuevoId(`${Date.now()}`); setFotosError("");
    clearDraft(inspector.id, "inspeccion");
  };

  /* ---------- CRM: solicitudes, fotos para el equipo y registro del resultado ---------- */
  const fichaId = editingId || nuevoId;
  const fotosGuardadas = () => { const h = historial.find((x) => recordIdFromKey(x.id) === editingId); return h ? (h.data.fotosEquipo || []) : []; };
  const borrarFotosEquipo = (ids) => ids.forEach((id) => { try { window.storage.delete(fotoKeyInspeccion(fichaId, id), true); } catch (e) { /* se limpia luego */ } });
  const borrarFotosNoGuardadas = () => borrarFotosEquipo((record.fotosEquipo || []).filter((id) => !fotosGuardadas().includes(id)));
  const descartarInspeccion = () => { borrarFotosNoGuardadas(); resetInspeccion(); };
  const agregarFotosEquipo = async (ev) => {
    const archivos = Array.from(ev.target.files || []);
    ev.target.value = "";
    setFotosError(""); setFotosBusy(true);
    let actuales = [...(record.fotosEquipo || [])];
    for (const a of archivos) {
      if (actuales.length >= MAX_FOTOS_INSPECCION) { setFotosError(`Máximo ${MAX_FOTOS_INSPECCION} fotos por inspección.`); break; }
      try {
        const dataUrl = await compressImage(a);
        const pid = makePhotoId();
        const ok = await window.storage.set(fotoKeyInspeccion(fichaId, pid), dataUrl, true);
        if (!ok) throw new Error("no_guardada");
        guardarCacheFoto(pid, dataUrl);
        actuales = [...actuales, pid];
        setRecord((prev) => ({ ...prev, fotosEquipo: actuales }));
      } catch (e) { setFotosError("No se pudo subir una de las fotos. Revisa tu conexión e inténtalo de nuevo."); }
    }
    setFotosBusy(false);
  };
  const quitarFotoEquipo = (pid) => {
    setRecord((prev) => ({ ...prev, fotosEquipo: (prev.fotosEquipo || []).filter((x) => x !== pid) }));
    if (!fotosGuardadas().includes(pid)) borrarFotosEquipo([pid]);
  };
  // Pasa a la inspección con los datos del vehículo de la solicitud.
  const iniciarDesdeSolicitud = (x) => {
    if (isMeaningful(record, baselineRef.current.ins) && !window.confirm("Tienes una inspección sin guardar. ¿Reemplazarla por la de la solicitud?")) return;
    borrarFotosNoGuardadas();
    const v = x.vehiculo || {};
    const rec = { ...emptyInspeccion(), inscripcion: v.patente || "", marca: v.marca || "", modelo: v.modelo || "", anio: v.anio ? String(v.anio) : "", solicitudId: x.id, solicitudFolio: x.folio };
    baselineRef.current.ins = rec;
    setRecord(rec); setEditingId(null); setRestoredAt(null); setViewing(null); setNuevoId(`${Date.now()}`); setFotosError("");
    setTab("inspeccion");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const abrirFichaDeSolicitud = (x) => {
    const h = historial.find((i) => i.id === x.fichaKey);
    if (h) { setViewing(h); setTab("inspeccion"); }
  };
  // Avisa al CRM: deja el resultado visible para el equipo (sin datos del propietario) y suma a la comisión.
  const registrarEnCrm = async (id, data) => {
    const patente = String(data.inscripcion || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    try {
      await crmApi("inspecciones.registrar", {
        key: `inspeccion::${inspector.id}::${id}`, solicitudId: data.solicitudId || undefined, fecha: data.fecha,
        vehiculo: { patente, marca: data.marca, modelo: data.modelo, anio: data.anio }, resumen: resumirInspeccion(data.checklist, CHECKLIST_SECTIONS), fotos: data.fotosEquipo || [],
      });
      return "";
    } catch (e) { return mensajeCrm(e); }
  };
  /* ---------- Fotos de la tasación ---------- */
  // Cada foto es un registro aparte (foto::<inspector>::<id>); la tasación solo guarda sus ids.
  const [photoBusy, setPhotoBusy] = useState({});
  const [photoErrors, setPhotoErrors] = useState({});
  // Ids de foto ya guardados con la tasación indicada. null = todavía no se sabe (el historial no ha cargado).
  const savedPhotoIds = (recordId) => {
    if (!recordId) return [];
    const h = historialTasaciones.find((x) => recordIdFromKey(x.id) === recordId);
    return h ? collectPhotoIds(h.data.checklist) : null;
  };
  // Fotos subidas en este formulario que aún no pertenecen a una tasación guardada.
  const unsavedPhotoIds = () => {
    const saved = savedPhotoIds(editingTasId);
    return saved === null ? [] : diffIds(collectPhotoIds(tasacion.checklist), saved);
  };
  const deletePhotos = (ids) => ids.forEach((id) => { photoCache.delete(id); window.storage.delete(photoKey(inspector.id, id), true); });

  const resetTasacion = ({ borrarFotos = true } = {}) => {
    if (borrarFotos) deletePhotos(unsavedPhotoIds());
    baselineRef.current.tas = emptyTasacion();
    setTasacion(emptyTasacion()); setEditingTasId(null); setRestoredTasAt(null); setDraftNoteTas("");
    clearDraft(inspector.id, "tasacion");
  };
  // ¿Hay algo sin guardar que se perdería al cargar otro registro en el formulario?
  const hayInspeccionSinGuardar = () => isMeaningful(record, baselineRef.current.ins);
  const hayTasacionSinGuardar = () => isMeaningful(tasacion, baselineRef.current.tas);

  const flash = (setter, msg, ms = 4000) => { setter(msg); setTimeout(() => setter(""), ms); };

  /* ---------- Inspección: guardar / editar / eliminar / PDF ---------- */
  const handleSave = async () => {
    const id = editingId || nuevoId;
    const now = new Date().toISOString();
    const toSave = { ...record, inspectorId: inspector.id, inspectorNombre: inspector.nombre, guardadoEl: editingId ? (record.guardadoEl || now) : now };
    if (editingId) toSave.editadoEl = now;
    const ok = await saveInspeccion(inspector.id, id, toSave);
    if (ok) {
      const errCrm = crmRealiza ? await registrarEnCrm(id, toSave) : "";
      // Las fotos que se quitaron de una inspección ya guardada se borran recién ahora.
      if (crmRealiza && editingId) borrarFotosEquipo(fotosGuardadas().filter((p) => !(toSave.fotosEquipo || []).includes(p)));
      flash(setSaveMsg, errCrm ? `Inspección guardada, pero NO se registró en el CRM: ${errCrm} Corrígela y vuelve a guardar (Editar → Guardar cambios).` : editingId ? "Cambios guardados ✓" : crmRealiza ? "Inspección guardada y registrada ✓" : "Inspección guardada ✓", errCrm ? 15000 : 2500);
      resetInspeccion();
      refreshHistorial();
    } else {
      flash(setSaveMsg, "No se pudo guardar. Tus datos siguen en el borrador de este dispositivo; intenta de nuevo.");
    }
  };
  const startEditInspeccion = (h) => {
    if (hayInspeccionSinGuardar() && !window.confirm("Tienes una inspección sin guardar. ¿Reemplazarla por la que vas a editar?")) return;
    const rec = { ...emptyInspeccion(), ...h.data };
    baselineRef.current.ins = rec;
    setRecord(rec); setEditingId(recordIdFromKey(h.id)); setRestoredAt(null); setViewing(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleDeleteInspeccion = async (h) => {
    if (!window.confirm("¿Eliminar esta inspección? No se puede deshacer.")) return;
    if (crmRealiza) {
      try { await crmApi("inspecciones.eliminar", { key: h.id }); }
      catch (e) { flash(setSaveMsg, "No se pudo eliminar: " + mensajeCrm(e)); return; }
    }
    const res = await deleteInspeccion(h.id);
    if (res && crmRealiza) (h.data.fotosEquipo || []).forEach((p) => { try { window.storage.delete(fotoKeyInspeccion(recordIdFromKey(h.id), p), true); } catch (e) { /* se limpia luego */ } });
    if (!res) { flash(setSaveMsg, "No se pudo eliminar. Intenta de nuevo."); return; }
    if (editingId && editingId === recordIdFromKey(h.id)) resetInspeccion();
    setViewing(null);
    flash(setSaveMsg, "Inspección eliminada ✓", 2500);
    refreshHistorial();
  };
  const handlePdfInspeccion = (data) => {
    try {
      const bytes = buildInspeccionPdf(data, { sections: CHECKLIST_SECTIONS, inspectorNombre: data.inspectorNombre || inspector.nombre });
      downloadPdfBytes(bytes, pdfFileName("Inspeccion", data));
    } catch (e) {
      console.error("No se pudo generar el PDF:", e);
      flash(setSaveMsg, "No se pudo generar el PDF.");
    }
  };

  /* ---------- Tasación: guardar / editar / eliminar / PDF ---------- */
  const handleSaveTasacion = async () => {
    const id = editingTasId || `${Date.now()}`;
    const now = new Date().toISOString();
    const toSave = { ...tasacion, inspectorId: inspector.id, inspectorNombre: inspector.nombre, guardadoEl: editingTasId ? (tasacion.guardadoEl || now) : now };
    if (editingTasId) toSave.editadoEl = now;
    const savedIds = savedPhotoIds(editingTasId);
    const ok = await saveTasacion(inspector.id, id, toSave);
    if (ok) {
      flash(setSaveMsgTasacion, editingTasId ? "Cambios guardados ✓" : "Tasación guardada ✓", 2500);
      // Fotos que tenía la tasación y ya no están: recién ahora se borran de la base.
      if (savedIds) deletePhotos(diffIds(savedIds, collectPhotoIds(tasacion.checklist)));
      resetTasacion({ borrarFotos: false });
      refreshHistorialTasaciones();
    } else {
      flash(setSaveMsgTasacion, "No se pudo guardar. Tus datos siguen en el borrador de este dispositivo; intenta de nuevo.");
    }
  };
  const startEditTasacion = (h) => {
    if (hayTasacionSinGuardar() && !window.confirm("Tienes una tasación sin guardar. ¿Reemplazarla por la que vas a editar?")) return;
    deletePhotos(unsavedPhotoIds());
    const rec = { ...emptyTasacion(), ...h.data };
    baselineRef.current.tas = rec;
    setTasacion(rec); setEditingTasId(recordIdFromKey(h.id)); setRestoredTasAt(null); setViewingTasacion(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleDeleteTasacion = async (h) => {
    if (!window.confirm("¿Eliminar esta tasación? No se puede deshacer.")) return;
    const res = await deleteTasacion(h.id);
    if (!res) { flash(setSaveMsgTasacion, "No se pudo eliminar. Intenta de nuevo."); return; }
    deletePhotos(collectPhotoIds(h.data.checklist)); // sus fotos se van con ella
    if (editingTasId && editingTasId === recordIdFromKey(h.id)) resetTasacion();
    setViewingTasacion(null);
    flash(setSaveMsgTasacion, "Tasación eliminada ✓", 2500);
    refreshHistorialTasaciones();
  };
  const handlePdfTasacion = (data) => {
    try {
      const bytes = buildTasacionPdf(data, { sections: TASACION_SECTIONS, getItems: getTasacionSectionItems, fmt: clp, inspectorNombre: data.inspectorNombre || inspector.nombre });
      downloadPdfBytes(bytes, pdfFileName("Tasacion", { ...data, inscripcion: data.patente }));
    } catch (e) {
      console.error("No se pudo generar el PDF:", e);
      flash(setSaveMsgTasacion, "No se pudo generar el PDF.");
    }
  };

  /* ---------- Conexión inspección → tasación ---------- */
  const tasacionDesdeInspeccion = (h) => ({
    propietario: h.data.propietarioNombre || "",
    vehiculo: [h.data.marca, h.data.modelo].filter(Boolean).join(" "),
    patente: h.data.inscripcion || "",
    anio: h.data.anio || "",
    inspeccionId: h.id,
  });
  const precargarTasacion = (h, { cambiarTab = true } = {}) => {
    if (hayTasacionSinGuardar() && !window.confirm("Tienes una tasación sin guardar. ¿Reemplazarla por una nueva basada en esta inspección?")) return;
    deletePhotos(unsavedPhotoIds());
    baselineRef.current.tas = emptyTasacion();
    setTasacion({ ...emptyTasacion(), ...tasacionDesdeInspeccion(h) });
    setEditingTasId(null); setRestoredTasAt(null); setViewingTasacion(null);
    if (cambiarTab) { setTab("tasaciones"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  const inspeccionPorKey = (key) => historial.find((h) => h.id === key);
  const etiquetaInspeccion = (key) => {
    const h = key && inspeccionPorKey(key);
    return h ? `inspección del ${h.data.fecha} (${[h.data.marca, h.data.modelo].filter(Boolean).join(" ") || "sin marca"} · ${h.data.inscripcion || "sin patente"})` : "";
  };
  // Interfaz de fotos para los botones (+) del formulario de tasación.
  const setPhotoError = (itemId, msg) => setPhotoErrors((e) => ({ ...e, [itemId]: msg }));
  const photoApi = {
    inspectorId: inspector.id,
    busy: photoBusy,
    errors: photoErrors,
    add: async (itemId, file) => {
      setPhotoError(itemId, "");
      if (collectPhotoIds(tasacion.checklist).length >= MAX_PHOTOS_PER_TASACION) {
        setPhotoError(itemId, `Máximo ${MAX_PHOTOS_PER_TASACION} fotos por tasación.`);
        return;
      }
      setPhotoBusy((b) => ({ ...b, [itemId]: true }));
      try {
        const dataUrl = await compressImage(file);
        const photoId = makePhotoId();
        const stored = await window.storage.set(photoKey(inspector.id, photoId), dataUrl, true);
        if (!stored) throw new Error("subida_fallida");
        photoCache.set(photoId, dataUrl);
        setTasacion((prev) => {
          const cur = prev.checklist[itemId] || { nombre: "", estado: "", valor: 0 };
          return { ...prev, checklist: { ...prev.checklist, [itemId]: { ...cur, fotos: [...(cur.fotos || []), photoId] } } };
        });
      } catch (e) {
        setPhotoError(
          itemId,
          e.message === "no_es_imagen" ? "El archivo no es una imagen."
            : e.message === "imagen_muy_grande" ? "La foto es demasiado grande."
            : "No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo."
        );
      } finally {
        setPhotoBusy((b) => ({ ...b, [itemId]: false }));
      }
    },
    // Quita la foto de la tasación. Si ya estaba guardada, se borra de la base recién al guardar los cambios.
    remove: (itemId, photoId) => {
      setTasacion((prev) => {
        const cur = prev.checklist[itemId] || {};
        return { ...prev, checklist: { ...prev.checklist, [itemId]: { ...cur, fotos: (cur.fotos || []).filter((f) => f !== photoId) } } };
      });
      const saved = savedPhotoIds(editingTasId);
      if (saved !== null && !saved.includes(photoId)) deletePhotos([photoId]);
    },
  };
  const totalesTasacion = computeTasacionTotals(tasacion.checklist, TASACION_SECTIONS, getTasacionSectionItems);
  const tasadas = new Set(historialTasaciones.map((t) => t.data.inspeccionId).filter(Boolean));

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3.5 py-2 text-sm rounded-lg shrink-0 whitespace-nowrap ${tab === id ? "bg-white/15 text-amber-300 font-medium" : "text-stone-300 hover:text-white hover:bg-white/10"}`}
    >
      {label}
    </button>
  );

  const barClass = "fixed bottom-0 inset-x-0 z-20 bg-white border-t border-stone-200 px-4 py-3 md:static md:z-auto md:bg-transparent md:border-0 md:p-0";

  return (
    <div className="min-h-screen bg-stone-100 pb-32 md:pb-16">
      <div className="bg-stone-900 text-stone-100">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 md:py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Panel del inspector</p>
            <h1 className="font-serif text-2xl md:text-3xl">{inspector.nombre}</h1>
            <p className="text-xs text-stone-400 mt-1 first-letter:uppercase">
              {new Date().toLocaleDateString("es-CL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
          <button onClick={onExit} className="self-start md:self-auto border border-stone-700 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800">Salir</button>
        </div>
        <div className="pestanas-scroll max-w-5xl mx-auto px-4 md:px-6 py-2 flex gap-1 border-t border-white/10 overflow-x-auto">
          {crmRealiza && tabBtn("solicitudes", "Solicitudes y agenda")}
          {tabBtn("inspeccion", "Inspección")}
          {tabBtn("estimador", "Estimador")}
          {tabBtn("tasaciones", "Tasaciones")}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-6 mt-6 md:mt-8 flex flex-col gap-6">
        {tab === "solicitudes" && crmRealiza && (
          <ModuloInspecciones permisos={crm.permisos} onRealizar={iniciarDesdeSolicitud} onVerFicha={abrirFichaDeSolicitud} onNueva={() => { setTab("inspeccion"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        )}
        {tab === "inspeccion" && (
          viewing ? (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <button onClick={() => setViewing(null)} className="text-sm text-stone-500 hover:underline py-1.5">← Volver al checklist</button>
                <ActionLink onClick={() => handlePdfInspeccion(viewing.data)}>Descargar PDF</ActionLink>
                <ActionLink onClick={() => startEditInspeccion(viewing)}>Editar</ActionLink>
                <ActionLink onClick={() => precargarTasacion(viewing)}>Crear tasación</ActionLink>
                <ActionLink danger onClick={() => handleDeleteInspeccion(viewing)}>Eliminar</ActionLink>
              </div>
              {saveMsg && <p className="text-xs text-stone-500">{saveMsg}</p>}
              <InspeccionForm key={"ver-" + viewing.id} record={viewing.data} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly />
            </>
          ) : (
            <>
              {editingId && (
                <div className="bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Editando una inspección ya guardada{record.fecha ? ` (${record.fecha})` : ""}.</span>
                  <button onClick={() => { if (!hayInspeccionSinGuardar() || window.confirm("¿Cancelar la edición y descartar los cambios?")) descartarInspeccion(); }} className="text-amber-800 hover:underline py-1">Cancelar edición</button>
                </div>
              )}
              {restoredAt && !editingId && (
                <div className="bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Se recuperó el borrador guardado el {fechaHoraCorta(restoredAt)}</span>
                  <button onClick={() => { if (window.confirm("¿Descartar el borrador y empezar de cero?")) descartarInspeccion(); }} className="text-sky-800 hover:underline py-1">Descartar borrador</button>
                </div>
              )}

              {crmRealiza && record.solicitudId && (
                <div className="bg-emerald-50 border border-emerald-300 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Esta inspección responde a la solicitud <strong>{record.solicitudFolio || ""}</strong>. Al guardarla, quien la pidió verá el resultado (sin los datos del propietario).</span>
                  {!editingId && <button onClick={() => updateField("solicitudId", "")} className="text-emerald-800 hover:underline py-1">Desvincular</button>}
                </div>
              )}

              <InspeccionForm key={editingId || "nuevo"} record={record} onFieldChange={updateField} onChecklistChange={updateChecklist} />

              {crmRealiza && (
                <div className="bg-white border border-stone-200 p-4 md:p-5">
                  <h3 className="font-serif text-lg text-stone-900">Fotos para el equipo ({(record.fotosEquipo || []).length}/{MAX_FOTOS_INSPECCION})</h3>
                  <p className="text-xs text-stone-500 mt-1 mb-3">Quienes pidieron la inspección verán estas fotos junto al resultado. No subas fotos del padrón ni de documentos del propietario.</p>
                  <div className="flex flex-wrap gap-3">
                    {(record.fotosEquipo || []).map((pid) => <MiniaturaEquipo key={pid} fichaId={fichaId} fotoId={pid} onQuitar={() => quitarFotoEquipo(pid)} />)}
                    {(record.fotosEquipo || []).length < MAX_FOTOS_INSPECCION && (
                      <label className="w-24 h-24 border-2 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-500 text-xs cursor-pointer hover:border-amber-500 text-center">
                        <span className="text-xl">{fotosBusy ? "…" : "＋"}</span>{fotosBusy ? "Subiendo" : "Agregar foto"}
                        <input type="file" accept="image/*" multiple className="hidden" disabled={fotosBusy} onChange={agregarFotosEquipo} />
                      </label>
                    )}
                  </div>
                  {fotosError && <p className="text-xs text-rose-600 mt-2">{fotosError}</p>}
                </div>
              )}

              <div className={barClass}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-2 md:gap-3">
                  <span className="text-xs text-stone-500 md:mr-auto">{saveMsg || draftNote}</span>
                  <div className="flex gap-2">
                    <button onClick={() => handlePdfInspeccion({ ...record, inspectorNombre: inspector.nombre })} className="flex-1 md:flex-none border border-stone-300 bg-white text-stone-700 px-4 py-3 md:py-2 text-sm hover:bg-stone-50">PDF</button>
                    <button onClick={handleSave} className="flex-[2] md:flex-none bg-stone-900 text-white px-4 py-3 md:py-2 text-sm font-medium hover:bg-stone-800">
                      {editingId ? "Guardar cambios" : "Guardar inspección"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-stone-200 p-4 md:p-5">
                <h3 className="font-serif text-lg text-stone-900 mb-4">Historial de inspecciones</h3>
                {loadingHist ? (
                  <p className="text-sm text-stone-500">Cargando…</p>
                ) : historial.length === 0 ? (
                  <p className="text-sm text-stone-500">Aún no hay inspecciones guardadas.</p>
                ) : (
                  <ul className="flex flex-col">
                    {historial.map((h) => (
                      <li key={h.id} className="border-b border-stone-100 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                          <span className="text-stone-900">{[h.data.marca, h.data.modelo].filter(Boolean).join(" ") || "—"}</span>
                          <span className="font-mono text-sm text-stone-600">{h.data.inscripcion || "—"}</span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {h.data.fecha}
                          {h.data.editadoEl ? " · editada" : ""}
                          {tasadas.has(h.id) ? " · con tasación" : ""}
                          {h.data.solicitudFolio ? ` · solicitud ${h.data.solicitudFolio}` : ""}
                        </div>
                        <RecordActions>
                          <ActionLink onClick={() => setViewing(h)}>Ver</ActionLink>
                          <ActionLink onClick={() => startEditInspeccion(h)}>Editar</ActionLink>
                          <ActionLink onClick={() => handlePdfInspeccion(h.data)}>PDF</ActionLink>
                          <ActionLink onClick={() => precargarTasacion(h)}>Crear tasación</ActionLink>
                          <ActionLink danger onClick={() => handleDeleteInspeccion(h)}>Eliminar</ActionLink>
                        </RecordActions>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )
        )}

        {tab === "estimador" && <TasacionCompra />}

        {tab === "tasaciones" && (
          viewingTasacion ? (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <button onClick={() => setViewingTasacion(null)} className="text-sm text-stone-500 hover:underline py-1.5">← Volver a Tasaciones</button>
                <ActionLink onClick={() => handlePdfTasacion(viewingTasacion.data)}>Descargar PDF</ActionLink>
                <ActionLink onClick={() => startEditTasacion(viewingTasacion)}>Editar</ActionLink>
                <ActionLink danger onClick={() => handleDeleteTasacion(viewingTasacion)}>Eliminar</ActionLink>
              </div>
              {saveMsgTasacion && <p className="text-xs text-stone-500">{saveMsgTasacion}</p>}
              <TasacionForm key={"ver-" + viewingTasacion.id} record={viewingTasacion.data} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly inspeccionLabel={etiquetaInspeccion(viewingTasacion.data.inspeccionId)} />
            </>
          ) : (
            <>
              {editingTasId && (
                <div className="bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Editando una tasación ya guardada{tasacion.fecha ? ` (${tasacion.fecha})` : ""}.</span>
                  <button onClick={() => { if (!hayTasacionSinGuardar() || window.confirm("¿Cancelar la edición y descartar los cambios?")) resetTasacion(); }} className="text-amber-800 hover:underline py-1">Cancelar edición</button>
                </div>
              )}
              {restoredTasAt && !editingTasId && (
                <div className="bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Se recuperó el borrador guardado el {fechaHoraCorta(restoredTasAt)}</span>
                  <button onClick={() => { if (window.confirm("¿Descartar el borrador y empezar de cero?")) resetTasacion(); }} className="text-sky-800 hover:underline py-1">Descartar borrador</button>
                </div>
              )}

              {!editingTasId && historial.length > 0 && (
                <div className="bg-white border border-stone-200 p-4">
                  <label className="text-xs text-stone-500 block mb-1">Precargar desde una inspección</label>
                  <select
                    value=""
                    onChange={(e) => { const h = inspeccionPorKey(e.target.value); if (h) precargarTasacion(h, { cambiarTab: false }); }}
                    className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Seleccionar inspección…</option>
                    {historial.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.data.fecha} · {[h.data.marca, h.data.modelo].filter(Boolean).join(" ") || "sin marca"} · {h.data.inscripcion || "sin patente"}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <TasacionForm key={editingTasId || "nueva"} record={tasacion} onFieldChange={updateTasacionField} onChecklistChange={updateTasacionChecklist} inspeccionLabel={etiquetaInspeccion(tasacion.inspeccionId)} photos={photoApi} />

              <div className={barClass}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-2 md:gap-3">
                  <span className="text-xs text-stone-500 md:mr-auto">
                    <strong className="text-stone-800">Total valorizaciones {clp(totalesTasacion.total)}</strong>
                    {(saveMsgTasacion || draftNoteTas) && <> · {saveMsgTasacion || draftNoteTas}</>}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => handlePdfTasacion({ ...tasacion, inspectorNombre: inspector.nombre })} className="flex-1 md:flex-none border border-stone-300 bg-white text-stone-700 px-4 py-3 md:py-2 text-sm hover:bg-stone-50">PDF</button>
                    <button onClick={handleSaveTasacion} className="flex-[2] md:flex-none bg-stone-900 text-white px-4 py-3 md:py-2 text-sm font-medium hover:bg-stone-800">
                      {editingTasId ? "Guardar cambios" : "Guardar tasación"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-stone-200 p-4 md:p-5">
                <h3 className="font-serif text-lg text-stone-900 mb-4">Historial de tasaciones</h3>
                {loadingHistTasaciones ? (
                  <p className="text-sm text-stone-500">Cargando…</p>
                ) : historialTasaciones.length === 0 ? (
                  <p className="text-sm text-stone-500">Aún no hay tasaciones guardadas.</p>
                ) : (
                  <ul className="flex flex-col">
                    {historialTasaciones.map((h) => (
                      <li key={h.id} className="border-b border-stone-100 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                          <span className="text-stone-900">{h.data.vehiculo || "—"}</span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {h.data.fecha} · <span className="font-mono">{h.data.patente || "—"}</span>
                          {h.data.editadoEl ? " · editada" : ""}
                          {h.data.inspeccionId ? " · desde inspección" : ""}
                        </div>
                        <ValorFinalResumen record={h.data} />
                        <RecordActions>
                          <ActionLink onClick={() => setViewingTasacion(h)}>Ver</ActionLink>
                          <ActionLink onClick={() => startEditTasacion(h)}>Editar</ActionLink>
                          <ActionLink onClick={() => handlePdfTasacion(h.data)}>PDF</ActionLink>
                          <ActionLink danger onClick={() => handleDeleteTasacion(h)}>Eliminar</ActionLink>
                        </RecordActions>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

/* =========================================================
   PANEL ADMINISTRADOR
========================================================= */
/* =========================================================
   AUTENTICACIÓN DEL ADMINISTRADOR
========================================================= */
function AdminAuthGate({ onSuccess, onExit }) {
  const [config, setConfig] = useState(undefined); // undefined=cargando, false=sin clave adicional, true=con clave adicional
  const [mode, setMode] = useState("login"); // login | setup | recover | reset | show-code
  const [error, setError] = useState("");

  // setup / reset
  const [email, setEmail] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [masterEmail, setMasterEmail] = useState("");
  const [masterPw, setMasterPw] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [savedCodeConfirmed, setSavedCodeConfirmed] = useState(false);

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");

  // recover
  const [recoveryInput, setRecoveryInput] = useState("");

  useEffect(() => {
    (async () => {
      setConfig(await window.auth.adminStatus());
      setMode("login");
    })();
  }, []);

  const handleSetup = async () => {
    setError("");
    if (!email.trim() || !email.includes("@")) { setError("Ingresa un correo válido (se guarda como referencia, no se envían correos)."); return; }
    if (!isValidAdminPassword(pw1)) { setError("La clave debe tener al menos 8 caracteres, con letras y números."); return; }
    if (pw1 !== pw2) { setError("Las claves no coinciden."); return; }
    try {
      const code = await window.auth.adminSetup({ masterEmail: masterEmail.trim(), masterPassword: masterPw, email: email.trim(), password: pw1 });
      setNewRecoveryCode(code);
      setMasterPw("");
      setMode("show-code");
    } catch (e) {
      setError(authErrorMessage(e, "La clave maestra es incorrecta o no se pudo guardar la configuración."));
    }
  };

  const handleLogin = async () => {
    setError("");
    try {
      await window.auth.adminLogin(loginEmail.trim(), loginPw);
      setLoginPw("");
      onSuccess();
    } catch (e) {
      setError(authErrorMessage(e, "Correo o clave incorrectos."));
    }
  };

  const handleRecoverCheck = async () => {
    setError("");
    try {
      await window.auth.adminRecoverCheck(recoveryInput.trim());
      setMode("reset");
    } catch (e) {
      setError(authErrorMessage(e, "Código de recuperación incorrecto."));
    }
  };

  const handleReset = async () => {
    setError("");
    if (!isValidAdminPassword(pw1)) { setError("La clave debe tener al menos 8 caracteres, con letras y números."); return; }
    if (pw1 !== pw2) { setError("Las claves no coinciden."); return; }
    try {
      const code = await window.auth.adminReset(recoveryInput.trim(), pw1);
      setNewRecoveryCode(code);
      setMode("show-code");
    } catch (e) {
      setError(authErrorMessage(e, "No se pudo guardar la nueva clave, intenta de nuevo."));
    }
  };

  if (config === undefined) {
    return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-stone-500 text-sm">Cargando…</div>;
  }

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white border border-stone-200 p-6 flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Acceso administrador</p>
          <h2 className="font-serif text-xl text-stone-900">
            {mode === "login" && "Ingresa tu clave"}
            {mode === "setup" && "Crea tu clave de acceso"}
            {mode === "recover" && "Recuperar acceso"}
            {mode === "reset" && "Define una nueva clave"}
            {mode === "show-code" && "Guarda tu código de recuperación"}
          </h2>
        </div>

        {mode === "setup" && (
          <>
            <p className="text-xs text-stone-500">
              Crea una clave adicional para este panel (útil si otra persona también necesita acceso, sin compartir la clave maestra).
              Define una clave alfanumérica (mínimo 8 caracteres, con letras y números) y un correo asociado.
              Nota: este entorno no puede enviar correos reales — en su lugar, se generará un código de recuperación que deberás guardar tú mismo.
            </p>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Correo maestro</label>
              <input type="email" value={masterEmail} onChange={(e) => setMasterEmail(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Clave maestra (para autorizar este cambio)</label>
              <input type="password" value={masterPw} onChange={(e) => setMasterPw(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Correo de referencia</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com"
                className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Clave de acceso</label>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Confirmar clave</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSetup(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleSetup} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Crear clave</button>
            <button type="button" onClick={() => { setError(""); setMode("login"); }} className="text-xs text-stone-500 hover:underline self-start">Volver</button>
          </>
        )}

        {mode === "login" && (
          <>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Correo</label>
              <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="tu@correo.com"
                className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" autoFocus />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Clave de acceso</label>
              <input type="password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleLogin} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Entrar</button>
            <div className="flex items-center justify-between">
              {config && (
                <button type="button" onClick={() => { setError(""); setMode("recover"); }} className="text-xs text-stone-500 hover:underline">¿Olvidaste tu clave?</button>
              )}
              <button type="button" onClick={() => { setError(""); setEmail(""); setPw1(""); setPw2(""); setMode("setup"); }} className="text-xs text-stone-500 hover:underline">
                {config ? "Cambiar clave adicional" : "Crear una clave adicional"}
              </button>
            </div>
          </>
        )}

        {mode === "recover" && (
          <>
            <p className="text-xs text-stone-500">Ingresa el código de recuperación que guardaste al crear tu clave.</p>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Código de recuperación</label>
              <input type="text" value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} placeholder="XXXX-XXXX-XXXX"
                onKeyDown={(e) => { if (e.key === "Enter") handleRecoverCheck(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleRecoverCheck} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Verificar código</button>
            <button type="button" onClick={() => { setError(""); setMode("login"); }} className="text-xs text-stone-500 hover:underline self-start">Volver</button>
          </>
        )}

        {mode === "reset" && (
          <>
            <p className="text-xs text-stone-500">Código verificado. Define tu nueva clave de acceso.</p>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Nueva clave</label>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Confirmar nueva clave</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleReset(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleReset} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Guardar nueva clave</button>
          </>
        )}

        {mode === "show-code" && (
          <>
            <p className="text-sm text-stone-700">
              Guarda este código de recuperación en un lugar seguro. Es la única forma de recuperar el acceso si olvidas tu clave, y solo se muestra una vez.
            </p>
            <div className="bg-amber-50 border border-amber-300 px-4 py-3 text-center">
              <span className="font-mono text-lg tracking-wider text-stone-900">{newRecoveryCode}</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-stone-600">
              <input type="checkbox" checked={savedCodeConfirmed} onChange={(e) => setSavedCodeConfirmed(e.target.checked)} />
              Ya guardé este código en un lugar seguro.
            </label>
            <button
              type="button"
              disabled={!savedCodeConfirmed}
              onClick={() => { setError(""); setPw1(""); setPw2(""); setMode("login"); setConfig(true); }}
              className={`px-4 py-2 text-sm font-medium ${savedCodeConfirmed ? "bg-stone-900 text-white hover:bg-stone-800" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}
            >
              Continuar e iniciar sesión
            </button>
          </>
        )}

        <button type="button" onClick={onExit} className="text-xs text-stone-400 hover:underline self-start mt-2">← Volver al inicio</button>
      </div>
    </div>
  );
}

/* =========================================================
   TASACIÓN DE COMPRA (panel del administrador)
   Estima cuánto pagar por un vehículo a partir de los avisos de Chileautos.
   Nada se guarda: el cálculo vive solo en pantalla.
========================================================= */
function AdminDashboard({ onExit }) {
  const [tab, setTab] = useGuardado("admin", "crm-reportes", PESTANAS_CRM.map(([id]) => id));
  return (
    <div className="min-h-screen bg-stone-100 pb-16">
      <div className="bg-stone-900 text-stone-100">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Panel administrador</p>
            <h1 className="font-serif text-2xl md:text-3xl">Administración de la plataforma</h1>
          </div>
          <button onClick={onExit} className="self-start md:self-auto border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Salir</button>
        </div>
        <div className="pestanas-scroll max-w-6xl mx-auto px-4 md:px-6 py-2 flex gap-1 border-t border-white/10 overflow-x-auto whitespace-nowrap">
          {PESTANAS_CRM.map(([id, texto]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3.5 py-2 text-sm rounded-lg shrink-0 ${tab === id ? "bg-white/15 text-amber-300 font-medium" : "text-stone-300 hover:text-white hover:bg-white/10"}`}>{texto}</button>
          ))}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 md:px-6 mt-8 flex flex-col gap-6">
        <AdminCrmPanel tab={tab} renderEstimador={(p) => <TasacionCompra {...p} />} renderFichas={() => <FichasEquipo />} />
      </div>
    </div>
  );
}

/* =========================================================
   LANDING / RUTEO
========================================================= */
function Landing({ onEnterAdmin, onEnterPersonal }) {
  return (
    <div className="min-h-screen flex items-start md:items-center justify-center px-4 py-10" style={{ background: "linear-gradient(180deg, #0f172a 0, #1e293b 300px, #f1f5f9 300px)" }}>
      <div className="max-w-md w-full">
        <div className="text-center mb-7 text-white">
          <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-amber-500 text-stone-900 font-bold text-lg flex items-center justify-center shadow-elevada">DF</div>
          <h1 className="font-serif text-3xl">Drive Futuro</h1>
          <p className="text-sm text-stone-300 mt-1">Plataforma de gestión automotriz</p>
        </div>
        <LoginPersonal onEntrar={onEnterPersonal} />
        <div className="mt-4 text-center">
          <button onClick={onEnterAdmin} className="text-sm text-stone-600 hover:text-stone-900 underline underline-offset-4">Entrar como administrador</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const onExpired = () => setSessionExpired(true);
    window.addEventListener("df-session-expired", onExpired);
    return () => window.removeEventListener("df-session-expired", onExpired);
  }, []);
  return (
    <>
      {sessionExpired && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-100 border-b border-amber-300 px-4 py-3 text-sm text-stone-800 flex flex-wrap items-center justify-between gap-2">
          <span>Tu sesión venció. Recarga la página para volver a ingresar (los borradores del inspector quedan guardados en este dispositivo).</span>
          <button onClick={() => window.location.reload()} className="bg-stone-900 text-white px-3 py-1.5">Recargar</button>
        </div>
      )}
      <AppRoutes />
    </>
  );
}

const PANTALLAS_PERSONALES = ["estacion", "ventasPersonal", "marketingPersonal", "anunciosPersonal", "validacionPersonal", "tasacionesPersonal", "compraPersonal", "inspectorPersonal"];

function AppRoutes() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("landing");
  const [me, setMe] = useState(null); // persona del CRM (ingreso con RUT)

  useEffect(() => {
    (async () => {
      try {
        // Si la persona ya había ingresado en esta pestaña (y recargó la página), se retoma su sesión y la pantalla en que estaba.
        const r = window.auth.restaurar ? await window.auth.restaurar() : null;
        if (r) {
          let pantalla = "";
          try { pantalla = sessionStorage.getItem("df-pantalla") || ""; } catch (e) { /* sin almacenamiento */ }
          if (r.tipo === "user") {
            setMe(r.me);
            setScreen(r.me.debeCambiarClave ? "cambioClave" : PANTALLAS_PERSONALES.includes(pantalla) ? pantalla : "estacion");
          } else if (r.tipo === "admin") {
            setScreen("admin");
          }
          setReady(true);
          return;
        }
      } catch (e) {}
      setReady(true);
    })();
  }, []);

  // Se recuerda la pantalla de la persona (estación, ventas, marketing…) para volver a ella al recargar.
  useEffect(() => {
    try { if (me && PANTALLAS_PERSONALES.includes(screen)) sessionStorage.setItem("df-pantalla", screen); } catch (e) { /* sin almacenamiento */ }
  }, [me, screen]);

  const exitToLanding = () => {
    try { window.auth.logout(); } catch (e) {}
    setScreen("landing");
    setMe(null);
    try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
  };

  const onAdminLogin = () => setScreen("admin");

  if (!ready) {
    return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-stone-500 text-sm">Cargando plataforma…</div>;
  }

  if (screen === "adminAuth") {
    return <AdminAuthGate onSuccess={onAdminLogin} onExit={exitToLanding} />;
  }

  if (screen === "admin") {
    return <AdminDashboard onExit={exitToLanding} />;
  }

  if (me && screen === "cambioClave") {
    return <CambioClaveObligatorio me={me} onListo={(actualizado) => { setMe(actualizado); setScreen("estacion"); }} onSalir={exitToLanding} />;
  }

  if (me && screen === "estacion") {
    return <EstacionTrabajo me={me} onAbrir={(modulo) => setScreen(modulo === "compra" ? "compraPersonal" : modulo === "ventas" ? "ventasPersonal" : modulo === "tasaciones" ? "tasacionesPersonal" : modulo === "validacion" ? "validacionPersonal" : modulo === "anuncios" ? "anunciosPersonal" : modulo === "marketing" ? "marketingPersonal" : "inspectorPersonal")} onSalir={exitToLanding} />;
  }

  if (me && screen === "inspectorPersonal") {
    return <InspectorDashboard inspector={{ id: me.id, nombre: me.nombre }} crm={{ permisos: me.permisos }} onExit={() => setScreen("estacion")} />;
  }

  if (me && screen === "ventasPersonal") {
    return (
      <div className="min-h-screen bg-stone-100 pb-16">
        <div className="bg-stone-900 text-stone-100">
          <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{me.nombre}{me.local ? ` · ${me.local.nombre}` : ""}</p>
              <h1 className="font-serif text-2xl md:text-3xl">Mi dashboard</h1>
            </div>
            <button onClick={() => setScreen("estacion")} className="border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Volver</button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-6"><ModuloVentas permisos={me.permisos} renderEstimador={(p) => <TasacionCompra {...p} />} renderFichas={() => <FichasEquipo />} /></div>
      </div>
    );
  }

  if (me && screen === "marketingPersonal") {
    return (
      <div className="min-h-screen bg-stone-100 pb-16">
        <div className="bg-stone-900 text-stone-100">
          <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{me.nombre}{me.local ? ` · ${me.local.nombre}` : ""}</p>
              <h1 className="font-serif text-2xl md:text-3xl">Marketing y RRSS</h1>
            </div>
            <button onClick={() => setScreen("estacion")} className="border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Volver</button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-6"><ModuloMarketing permisos={me.permisos} /></div>
      </div>
    );
  }

  if (me && screen === "anunciosPersonal") {
    return (
      <div className="min-h-screen bg-stone-100 pb-16">
        <div className="bg-stone-900 text-stone-100">
          <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{me.nombre}{me.local ? ` · ${me.local.nombre}` : ""}</p>
              <h1 className="font-serif text-2xl md:text-3xl">Avisos</h1>
            </div>
            <button onClick={() => setScreen("estacion")} className="border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Volver</button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-6"><ModuloAnuncios permisos={me.permisos} /></div>
      </div>
    );
  }

  if (me && screen === "validacionPersonal") {
    return (
      <div className="min-h-screen bg-stone-100 pb-16">
        <div className="bg-stone-900 text-stone-100">
          <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{me.nombre}{me.local ? ` · ${me.local.nombre}` : ""}</p>
              <h1 className="font-serif text-2xl md:text-3xl">Validaciones</h1>
            </div>
            <button onClick={() => setScreen("estacion")} className="border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Volver</button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-6"><ModuloValidaciones permisos={me.permisos} /></div>
      </div>
    );
  }

  if (me && screen === "tasacionesPersonal") {
    return (
      <div className="min-h-screen bg-stone-100 pb-16">
        <div className="bg-stone-900 text-stone-100">
          <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{me.nombre}{me.local ? ` · ${me.local.nombre}` : ""}</p>
              <h1 className="font-serif text-2xl md:text-3xl">Tasaciones</h1>
            </div>
            <button onClick={() => setScreen("estacion")} className="border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Volver</button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-6"><ModuloTasaciones permisos={me.permisos} renderEstimador={(p) => <TasacionCompra {...p} />} /></div>
      </div>
    );
  }

  if (me && screen === "compraPersonal") {
    return (
      <div className="min-h-screen bg-stone-100 pb-16">
        <div className="bg-stone-900 text-stone-100">
          <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{me.nombre}</p>
              <h1 className="font-serif text-2xl md:text-3xl">Estimador</h1>
            </div>
            <button onClick={() => setScreen("estacion")} className="border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Volver</button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-6 mt-8"><TasacionCompra /></div>
      </div>
    );
  }

  return (
    <Landing
      onEnterAdmin={() => setScreen("adminAuth")}
      onEnterPersonal={(persona) => { setMe(persona); setScreen(persona.debeCambiarClave ? "cambioClave" : "estacion"); }}
    />
  );
}
