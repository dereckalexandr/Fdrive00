import React, { useState, useEffect, useMemo, useRef } from "react";
const cargarLectorCav = () => import("./cav-parser.js");
import { buildInspeccionPdf, buildTasacionPdf, pdfFileName } from "./pdf-report.js";
import { saveDraft, loadDraft, clearDraft, isMeaningful } from "./drafts.js";
import { computeTasacionTotals, computeValorFinal } from "./tasacion-totals.js";
import { normalizePatente, isPatenteValida, splitModeloVersion, parseKm, calcularFiltros, buildChileautosUrl, parseAvisosPegados, estimarCompra, parseDatosPatente, modeloParaChileautos, detalleModeloChileautos, detalleMarcaChileautos, TRANSMISIONES, COMBUSTIBLES, MARGENES_BRUTOS, MARGEN_BRUTO_DEFECTO } from "./compra-calc.js";
import { buildBookmarkletHref } from "./chileautos-bookmarklet.js";
import { buildPatenteBookmarkletHref } from "./patente-bookmarklet.js";
import { AdminCrmPanel, PESTANAS_CRM } from "./crm-admin.jsx";
import { ModuloVentas } from "./crm-ventas.jsx";
import { InputDinero } from "./campo-dinero.jsx";
import { ModuloTasaciones } from "./crm-tasaciones.jsx";
import { ModuloValidaciones } from "./crm-validaciones.jsx";
import { ModuloAnuncios } from "./crm-anuncios.jsx";
import { ModuloMarketing } from "./crm-marketing.jsx";
import { ModuloInspecciones, Miniatura as MiniaturaEquipo, fotoKeyInspeccion, guardarCacheFoto } from "./crm-inspecciones.jsx";
import { resumirInspeccion, MAX_FOTOS_INSPECCION } from "../supabase/functions/api/inspecciones-core.js";
import { useGuardado, mensajeError as mensajeCrm, BuscarPatente } from "./crm-ui.jsx";
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

/* --- Checklist de inspección: agregar aquí nuevas secciones/ítems a futuro --- */
const CHECKLIST_SECTIONS = [
  {
    id: "motor",
    title: "1. Motor y accesorios",
    items: [
      { id: "ruidos_anormales", label: "Ruidos anormales" },
      { id: "fugas_aceite", label: "Fugas de aceite" },
      { id: "fugas_aire", label: "Fugas de aire" },
      { id: "fugas_agua", label: "Fugas de agua" },
      { id: "fugas_bencina", label: "Fugas de bencina" },
      { id: "fugas_liquidos", label: "Fugas de líquidos" },
      { id: "necesita_afinamiento", label: "Necesita afinamiento" },
      { id: "estado_bateria", label: "Estado de la batería" },
      { id: "estado_alternador", label: "Estado del alternador" },
      { id: "estado_bobina", label: "Estado de bobina" },
      { id: "estado_distribucion", label: "Estado de distribución" },
      { id: "estado_cables", label: "Estado de cables" },
      { id: "estado_correas", label: "Estado de correas" },
      { id: "estado_sistema_cargas", label: "Estado sistema cargas" },
      { id: "estado_sistema_refrigerante", label: "Estado sistema refrigerante" },
      { id: "estado_general_motor", label: "Estado general motor" },
    ],
  },
  {
    id: "transmision",
    title: "2. Transmisión",
    items: [
      { id: "estado_caja_mecanica", label: "Estado caja mecánica" },
      { id: "estado_embrague", label: "Estado de embrague" },
      { id: "estado_caja_automatica", label: "Estado caja automática" },
      { id: "estado_homocineticas", label: "Estado Homocinéticas" },
      { id: "estado_llantas", label: "Estado de llantas" },
      { id: "estado_neumaticos", label: "Estado neumáticos" },
    ],
  },
  {
    id: "chasis",
    title: "3. Chasis",
    items: [
      { id: "sistema_frenos", label: "Sistema de frenos" },
      { id: "sistema_direccion", label: "Sistema de dirección" },
      { id: "sistema_suspension", label: "Sistema de suspensión" },
    ],
  },
  {
    id: "sistema_electrico",
    title: "4. Sistema eléctrico",
    items: [
      { id: "estado_luces", label: "Estado de luces" },
      { id: "estado_bocina", label: "Estado de bocina" },
      { id: "estado_limpia_parabrisas", label: "Estado limpia parabrisas" },
      { id: "estado_instrumentos", label: "Estado instrumentos" },
      { id: "estado_radio", label: "Estado radio" },
      { id: "estado_calefaccion_defrost", label: "Estado Calefacción y defrost" },
    ],
  },
  {
    id: "carroceria",
    title: "5. Carrocería",
    items: [
      { id: "tablero_instrumentos", label: "Tablero instrumentos" },
      { id: "tapiceria", label: "Tapicería" },
      { id: "frente_vehiculo", label: "Frente vehículo" },
      { id: "costado_piloto", label: "Costado piloto" },
      { id: "costado_copiloto", label: "Costado copiloto" },
      { id: "posterior_vehiculo", label: "Posterior vehículo" },
      { id: "parabrisas_carroceria", label: "Parabrisas" },
      { id: "vidrios_general", label: "Vidrios general" },
    ],
  },
  {
    id: "datos_identificacion",
    title: "6. Datos de identificación",
    items: [
      { id: "vin_corresponde_padron_chasis", label: "Número de VIN corresponde en padrón y chasis" },
      { id: "motor_corresponde_padron_motor", label: "Número de motor corresponde en padrón y motor" },
    ],
  },
];
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

const ESTADOS_DOCUMENTO = ["Al día", "Atrasado"];
const ESTADOS_SI_NO = ["Sí", "No"];
const ESTADOS_CARROCERIA = ["Bueno", "Reparado", "Dañado", "Repintado", "Rayado", "Piquete", "Abollado"];
const ESTADOS_INTERIOR = ["Bueno", "Regular", "Dañado", "No aplica"];
const ESTADOS_VIDRIO = ["Vidrio original", "No original"];

/* --- Checklist de tasación: agregar aquí nuevas secciones/ítems a futuro --- */
const TASACION_SECTIONS = [
  {
    id: "carroceria",
    title: "1. Carrocería",
    type: "fixed",
    estadoOptions: ESTADOS_CARROCERIA,
    items: [
      { id: "parabrisas", label: "Parabrisas" },
      { id: "capot", label: "Capot" },
      { id: "mascara", label: "Máscara" },
      { id: "foco_delantero_derecho", label: "Foco delantero derecho" },
      { id: "foco_delantero_izquierdo", label: "Foco delantero izquierdo" },
      { id: "frente", label: "Frente" },
      { id: "parachoques_delantero", label: "Parachoques delantero" },
      { id: "tapabarro_delantero_izquierdo", label: "Tapabarro delantero izquierdo" },
      { id: "puerta_delantera_izquierda", label: "Puerta delantera izquierda", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "puerta_trasera_izquierda", label: "Puerta trasera izquierda", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "tapabarro_trasero_izquierdo", label: "Tapabarro trasero izquierdo" },
      { id: "portalon", label: "Portalón" },
      { id: "luneta_trasera", label: "Luneta trasera" },
      { id: "foco_trasero_izquierdo", label: "Foco trasero izquierdo" },
      { id: "foco_trasero_derecho", label: "Foco trasero derecho" },
      { id: "frente_trasero", label: "Frente trasero" },
      { id: "parachoques_trasero", label: "Parachoques trasero" },
      { id: "tapabarro_trasero_derecho", label: "Tapabarro trasero derecho" },
      { id: "puerta_trasera_derecha", label: "Puerta trasera derecha", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "puerta_delantera_derecha", label: "Puerta delantera derecha", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "tapabarro_delantero_derecho", label: "Tapabarro delantero derecho" },
      { id: "techo_capota", label: "Techo o capota" },
      { id: "chasis_carroceria", label: "Chasis" },
      { id: "piso_base", label: "Piso o base" },
    ],
  },
  {
    id: "interior",
    title: "2. Interior",
    type: "fixed",
    estadoOptions: ESTADOS_INTERIOR,
    items: [
      { id: "tablero_tasacion", label: "Tablero" },
      { id: "tapiceria_asientos", label: "Tapicería asientos" },
      { id: "techo_interior", label: "Techo interior" },
      { id: "alfombras", label: "Alfombras" },
      { id: "revestimientos_puertas", label: "Revestimientos puertas" },
      { id: "salpicadera", label: "Salpicadera" },
    ],
  },
  {
    id: "neumaticos_tasacion",
    title: "3. Neumáticos",
    type: "fixed",
    items: [
      { id: "neum_delantero_derecho", label: "Delantero derecho" },
      { id: "neum_delantero_izquierdo", label: "Delantero izquierdo" },
      { id: "neum_trasero_derecho", label: "Trasero derecho" },
      { id: "neum_trasero_izquierdo", label: "Trasero izquierdo" },
      { id: "neum_repuesto", label: "Repuesto" },
    ],
  },
  { id: "motor_tasacion", title: "4. Sistema motor", type: "dynamic", slots: 5 },
  { id: "transmision_tasacion", title: "5. Sistema de transmisión", type: "dynamic", slots: 5 },
  { id: "frenos_tasacion", title: "6. Sistema de frenos", type: "dynamic", slots: 5 },
  { id: "electrico_tasacion", title: "7. Sistema eléctrico", type: "dynamic", slots: 5 },
  { id: "direccion_tasacion", title: "8. Sistema de dirección", type: "dynamic", slots: 5 },
  { id: "suspension_tasacion", title: "9. Sistema de suspensión", type: "dynamic", slots: 5 },
  {
    id: "documentacion",
    title: "10. Documentación",
    type: "fixed",
    items: [
      { id: "permiso_circulacion", label: "Permiso de circulación", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "revision_tecnica", label: "Revisión técnica", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "soap", label: "SOAP", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "padron", label: "Padrón", estadoOptions: ESTADOS_SI_NO },
    ],
  },
  {
    id: "aceite_bateria_vidrios",
    title: "11. Aceite y Batería",
    type: "fixed",
    items: [
      { id: "aceite", label: "Aceite" },
      { id: "bateria_tasacion", label: "Batería" },
    ],
  },
];
function getTasacionSectionItems(section) {
  if (section.type === "dynamic") {
    return Array.from({ length: section.slots }, (_, i) => ({ id: `${section.id}_${i + 1}`, label: "", dynamic: true }));
  }
  return section.items;
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
const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());

// `inicial` (opcional): datos del vehículo con que parte, cuando se usa dentro de una tasación del CRM.
// `onResultado` (opcional): si viene, aparece el botón para guardar el resultado en esa tasación.
function TasacionCompra({ inicial, onResultado } = {}) {
  const ini = inicial || {};
  const [patente, setPatente] = useState(ini.patente ? normalizePatente(ini.patente) : "");
  const [km, setKm] = useState(ini.km != null ? String(ini.km) : "");
  const [marca, setMarca] = useState(ini.marca || "");
  const [modelo, setModelo] = useState(ini.modelo || "");
  const [anio, setAnio] = useState(ini.anio != null ? String(ini.anio) : "");
  const [version, setVersion] = useState(ini.version || "");
  const [margenAnio, setMargenAnio] = useState(1);
  const [transmision, setTransmision] = useState((TRANSMISIONES.find((t) => t.label === ini.transmision) || {}).value || "");
  const [combustible, setCombustible] = useState((COMBUSTIBLES.find((c) => c.label === ini.combustible) || {}).value || "");
  const [resultadoUsado, setResultadoUsado] = useState(false);
  const [margenBruto, setMargenBruto] = useState(MARGEN_BRUTO_DEFECTO);
  const [cav, setCav] = useState({ name: "", data: "" });
  const [cavMsg, setCavMsg] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [pegado, setPegado] = useState("");
  const [copiado, setCopiado] = useState(false);
  const bmRef = useRef(null);
  const bmPatenteRef = useRef(null);
  const [pegadoPatente, setPegadoPatente] = useState("");
  const [msgPatente, setMsgPatente] = useState(null);
  const [copiadoPatente, setCopiadoPatente] = useState(false);

  // React no deja poner un enlace "javascript:" desde JSX, así que se asigna directo al elemento.
  useEffect(() => {
    if (bmRef.current) bmRef.current.setAttribute("href", buildBookmarkletHref());
    if (bmPatenteRef.current) bmPatenteRef.current.setAttribute("href", buildPatenteBookmarkletHref());
  }, []);

  const kmNum = parseKm(km);
  const patenteOk = isPatenteValida(patente);
  const filtros = calcularFiltros({ anio, km: kmNum, margenAnio });
  const urlBusqueda = patenteOk ? buildChileautosUrl({ marca, modelo, anio, km: kmNum, margenAnio, transmision, combustible }) : null;
  const { busqueda: modeloBusqueda, omitido: modeloOmitido } = detalleModeloChileautos(modelo);
  const { busqueda: marcaBusqueda, omitido: marcaOmitida } = detalleMarcaChileautos(marca);
  const transLabel = (TRANSMISIONES.find((t) => t.value === transmision) || {}).label;
  const combLabel = (COMBUSTIBLES.find((c) => c.value === combustible) || {}).label;

  const faltantes = [];
  if (!patenteOk) faltantes.push(patente ? "patente válida (ej. TTHY51)" : "patente");
  if (!kmNum) faltantes.push("kilometraje");
  if (!marca.trim()) faltantes.push("marca");
  if (!modelo.trim()) faltantes.push("modelo");
  if (!parseKm(anio)) faltantes.push("año");

  const handleCavLoaded = async (name, data) => {
    setCav({ name, data });
    setCavMsg("");
    setLeyendo(true);
    try {
      const { extractPdfText, parseCavFields } = await cargarLectorCav();
      const fields = parseCavFields(await extractPdfText(data));
      const mv = splitModeloVersion(fields.modelo);
      const llenados = [];
      if (fields.marca) { setMarca(titleCase(fields.marca)); llenados.push("marca"); }
      if (mv.modelo) { setModelo(titleCase(mv.modelo)); llenados.push("modelo"); }
      if (fields.anio) { setAnio(fields.anio); llenados.push("año"); }
      if (mv.version) { setVersion(fields.modelo.slice(mv.modelo.length).trim()); llenados.push("versión"); }
      setCavMsg(llenados.length
        ? `Se completaron: ${llenados.join(", ")}. Revísalos: si el modelo tiene más de una palabra (ej. "Land Cruiser"), corrígelo.`
        : "No se detectaron datos en este PDF. Completa marca, modelo y año a mano.");
    } catch (e) {
      console.warn("No se pudo leer el CAV:", e);
      setCavMsg("No se pudo leer el PDF. Completa los datos a mano.");
    } finally {
      setLeyendo(false);
    }
  };

  // Cálculo derivado del texto pegado: se actualiza solo al pegar o al cambiar filtros.
  const calculo = useMemo(() => {
    if (!pegado.trim()) return null;
    const p = parseAvisosPegados(pegado);
    if (!p.ok) return { error: p.error };
    if (p.data.sinResultados) return { sinResultados: true };
    if (!p.data.listings.length) return { error: "La página de Chileautos no tenía avisos. Revisa que el marcador se usó en la lista de resultados." };
    const r = estimarCompra(p.data.listings, { ...filtros, transmision, combustible }, { margenBruto });
    let otraBusqueda = false;
    try {
      const u = decodeURIComponent(p.data.url || "").toLowerCase();
      const trans = TRANSMISIONES.find((t) => t.value === transmision);
      const comb = COMBUSTIBLES.find((c) => c.value === combustible);
      otraBusqueda = !(u.includes(`marca.${marcaBusqueda.toLowerCase()}`) && u.includes(`modelo.${modeloParaChileautos(modelo).toLowerCase()}`)
        && u.includes(`range(${filtros.anioMin}..${filtros.anioMax})`)
        && (!trans || u.includes(`transmisión.${trans.variantes[0].toLowerCase()}`))
        && (!comb || u.includes(`combustible.${comb.chileautos.toLowerCase()}`)));
    } catch (e) { otraBusqueda = false; }
    return { ...r, otraBusqueda };
  }, [pegado, marca, modelo, anio, km, margenAnio, transmision, combustible, margenBruto]);

  const copiarMarcador = async () => {
    try { await navigator.clipboard.writeText(buildBookmarkletHref()); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch (e) { /* sin permiso: queda el botón arrastrable */ }
  };
  const copiarMarcadorPatente = async () => {
    try { await navigator.clipboard.writeText(buildPatenteBookmarkletHref()); setCopiadoPatente(true); setTimeout(() => setCopiadoPatente(false), 2500); } catch (e) { /* sin permiso: queda el botón arrastrable */ }
  };
  // Al pegar lo que copió el marcador de patentechile.com se completan marca, modelo y año. La patente
  // se ingresa a mano: solo se rellena si estaba vacía, y si no coincide con la copiada se avisa.
  const aplicarDatosPatente = (texto) => {
    setPegadoPatente(texto);
    if (!texto.trim()) { setMsgPatente(null); return; }
    const p = parseDatosPatente(texto);
    if (!p.ok) { setMsgPatente({ mal: true, texto: p.error, etiquetas: p.etiquetas || [] }); return; }
    const d = p.data;
    setMarca(titleCase(d.marca)); setModelo(titleCase(d.modelo)); setAnio(String(d.anio));
    const avisos = [];
    if (d.patente && !patente) setPatente(d.patente);
    if (d.patente && patente && patente !== d.patente) avisos.push(`La patente de la ficha (${d.patente}) no coincide con la que ingresaste (${patente}). Revisa que sea el vehículo correcto.`);
    if (d.modelo.trim().split(/\s+/).length > 1) avisos.push("El modelo trae varias palabras. Para Chileautos deja solo el nombre del modelo (ej. \"Yaris\", sin la versión), salvo modelos como \"Land Cruiser\".");
    setMsgPatente({ mal: false, texto: `Se completaron marca, modelo y año${d.patente && !patente ? " y la patente" : ""}.`, avisos });
  };
  const limpiar = () => { setPegadoPatente(""); setMsgPatente(null); setPatente(""); setKm(""); setMarca(""); setModelo(""); setAnio(""); setVersion(""); setTransmision(""); setCombustible(""); setMargenBruto(MARGEN_BRUTO_DEFECTO); setCav({ name: "", data: "" }); setCavMsg(""); setPegado(""); };

  const Tarjeta = ({ titulo, sub, valor, destacado = false }) => (
    <div className={`p-4 border ${destacado ? "bg-stone-900 text-stone-100 border-stone-900" : "bg-white border-stone-200"}`}>
      <p className={`text-xs uppercase tracking-wide ${destacado ? "text-stone-400" : "text-stone-500"}`}>{titulo}</p>
      <p className="font-bold tabular-nums text-2xl md:text-3xl mt-1">{clp(valor)}</p>
      <p className={`text-xs mt-1 ${destacado ? "text-stone-400" : "text-stone-500"}`}>{sub}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-stone-200 p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-serif text-lg text-stone-900">Tasación de compra</h3>
            <p className="text-xs text-stone-500 mt-0.5">{onResultado ? "Estima cuánto pagar con los avisos de Chileautos. Al terminar, usa el botón del resultado para guardarlo en la tasación." : "Estima cuánto pagar por un vehículo con los avisos de Chileautos. Nada de esto se guarda."}</p>
          </div>
          <button type="button" onClick={limpiar} className="text-xs text-stone-500 hover:underline shrink-0 py-1">Limpiar</button>
        </div>

        <p className="text-xs uppercase tracking-widest text-stone-400 mb-2">1 · Datos del vehículo</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Patente *</label>
            <input type="text" value={patente} onChange={(e) => setPatente(normalizePatente(e.target.value))} placeholder="Ej. TTHY51" maxLength={6}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-500" />
            {patente.length === 6 && !patenteOk && <p className="text-xs text-rose-600 mt-1">Formato no válido (4 letras y 2 números, o 2 letras y 4 números).</p>}
            <BuscarPatente patente={patente} className="mt-1.5" onDatos={(c) => {
              const llenados = [];
              if (c.marca) { setMarca(c.marca); llenados.push("marca"); }
              if (c.modelo) { setModelo(c.modelo); llenados.push("modelo"); }
              if (c.anio) { setAnio(c.anio); llenados.push("anio"); }
              if (c.version) { setVersion(c.version); llenados.push("version"); }
              const tr = TRANSMISIONES.find((t) => t.label === c.transmision);
              if (tr) { setTransmision(tr.value); llenados.push("transmision"); }
              const co = COMBUSTIBLES.find((x) => x.label === c.combustible);
              if (co) { setCombustible(co.value); llenados.push("combustible"); }
              return llenados;
            }} />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Kilometraje *</label>
            <input type="text" inputMode="numeric" value={kmNum ? kmNum.toLocaleString("es-CL") : ""} onChange={(e) => setKm(e.target.value)} placeholder="Ej. 60.000"
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Búsqueda por año</label>
            <select value={margenAnio} onChange={(e) => setMargenAnio(Number(e.target.value))}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value={1}>Año del vehículo ±1</option>
              <option value={0}>Solo el año exacto</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs text-stone-500 block mb-1">CAV (opcional): completa marca, modelo, año y versión</label>
          <PdfDropzone fileName={cav.name} fileData={cav.data} onFileLoaded={handleCavLoaded} onRemove={() => { setCav({ name: "", data: "" }); setCavMsg(""); }} />
          {leyendo && <p className="text-xs text-stone-500 mt-2">Leyendo el CAV…</p>}
          {!leyendo && cavMsg && <p className="text-xs text-stone-500 mt-2">{cavMsg}</p>}
        </div>

        <div className="mt-4 border-t border-stone-200 pt-4">
          <p className="text-sm text-stone-700 font-medium mb-1">O con patentechile.com (alternativa al CAV)</p>
          <p className="text-xs text-stone-500 mb-2">
            Entra al sitio, busca la patente a mano y, con la ficha del vehículo abierta, pulsa el favorito. Copia <strong>solo</strong> patente, marca, modelo y año:
            nunca nombre, RUT ni dirección del dueño. El sitio puede pedir una verificación de seguridad: la completas tú.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <a href="https://www.patentechile.com/" target="_blank" rel="noopener noreferrer"
              className="inline-block bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Abrir patentechile.com ↗</a>
            <a ref={bmPatenteRef} onClick={(e) => e.preventDefault()} draggable="true"
              className="inline-block border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 px-3 py-2 text-sm font-medium cursor-grab">⭐ Copiar datos de patente</a>
            <button type="button" onClick={copiarMarcadorPatente} className="text-xs text-stone-600 hover:underline py-2">
              {copiadoPatente ? "Código copiado ✓" : "No puedo arrastrarlo: copiar el código del marcador"}
            </button>
          </div>
          <textarea value={pegadoPatente} onChange={(e) => aplicarDatosPatente(e.target.value)} rows={2} placeholder="Pega aquí lo que copió el marcador de patente (Ctrl+V)"
            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          {msgPatente && (
            <div className="mt-2 flex flex-col gap-1">
              <p className={`text-xs ${msgPatente.mal ? "text-rose-600" : "text-emerald-700"}`}>{msgPatente.texto}</p>
              {(msgPatente.avisos || []).map((a) => <p key={a} className="text-xs text-amber-800">⚠ {a}</p>)}
              {msgPatente.mal && msgPatente.etiquetas && msgPatente.etiquetas.length > 0 && (
                <p className="text-xs text-stone-500">Campos que vio la página (sin sus valores): {msgPatente.etiquetas.join(" · ")}. Si quieres que lo ajuste, envíame esta lista.</p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <TextField label="Marca *" value={marca} onChange={setMarca} placeholder="Ej. Toyota" />
          <TextField label="Modelo *" value={modelo} onChange={setModelo} placeholder="Ej. Yaris" />
          <TextField label="Año *" value={anio} onChange={(v) => setAnio(v.replace(/\D/g, "").slice(0, 4))} placeholder="Ej. 2020" />
          <TextField label="Versión" value={version} onChange={setVersion} placeholder="Ej. 1.5 GLI" />
          <div>
            <label className="text-xs text-stone-500 block mb-1">Transmisión</label>
            <select value={transmision} onChange={(e) => setTransmision(e.target.value)}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">Seleccionar</option>
              {TRANSMISIONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Combustible</label>
            <select value={combustible} onChange={(e) => setCombustible(e.target.value)}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">Seleccionar</option>
              {COMBUSTIBLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 p-4 md:p-5">
        <p className="text-xs uppercase tracking-widest text-stone-400 mb-2">2 · Buscar en Chileautos</p>
        {urlBusqueda ? (
          <>
            <a href={urlBusqueda} target="_blank" rel="noopener noreferrer"
              className="inline-block bg-stone-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-800">Abrir la búsqueda en Chileautos ↗</a>
            <p className="text-xs text-stone-500 mt-2">
              Filtros aplicados: {marcaBusqueda} {modeloBusqueda} · año {filtros.anioMin === filtros.anioMax ? filtros.anioMin : `${filtros.anioMin}–${filtros.anioMax}`} ·
              {" "}{filtros.kmMin > 0 ? `${filtros.kmMin.toLocaleString("es-CL")}–` : "hasta "}{filtros.kmMax.toLocaleString("es-CL")} km
              {transLabel ? ` · transmisión ${transLabel.toLowerCase()}` : ""}{combLabel ? ` · combustible ${combLabel.toLowerCase()}` : ""} · orden: precio más bajo.
            </p>
            {marcaOmitida && (
              <p className="text-xs text-amber-800 mt-1">
                En Chileautos se busca la marca como «{marcaBusqueda}». Se omite «{marcaOmitida}» (razón social, no forma parte de la marca).
              </p>
            )}
            {(modeloOmitido || modeloBusqueda !== modelo.trim()) && (
              <p className="text-xs text-amber-800 mt-1">
                En Chileautos se busca el modelo como «{modeloBusqueda}»
                {modeloOmitido ? <>. Se omite «{modeloOmitido}» (motor, versión u otras palabras).</> : " (así se escribe allí)."}
              </p>
            )}
            <p className="text-xs text-stone-500 mt-1">
              <strong>Importante:</strong> si Chileautos muestra "Vehículos parecidos a lo que buscas", no reconoce el modelo «{modeloBusqueda}» y <strong>ignora todos los filtros</strong> (año, kilometraje, transmisión…).
              Corrige el modelo arriba con el nombre exacto que usa Chileautos.
            </p>
          </>
        ) : (
          <p className="text-sm text-stone-500">Completa {faltantes.join(", ")} para armar la búsqueda.</p>
        )}

        <div className="mt-4 border-t border-stone-200 pt-4">
          <p className="text-sm text-stone-700 font-medium mb-1">Marcador para copiar los avisos</p>
          <p className="text-xs text-stone-500 mb-2">Chileautos no permite leer sus avisos desde un servidor, pero tu navegador sí puede. Se instala una sola vez:</p>
          <ol className="text-xs text-stone-600 list-decimal pl-5 flex flex-col gap-1 mb-3">
            <li>Muestra la barra de favoritos (Ctrl+Shift+B) y <strong>arrastra este botón</strong> a ella.</li>
            <li>En la página de Chileautos que abriste, pulsa ese favorito: copia los avisos y muestra "N avisos copiados".</li>
            <li>Vuelve aquí y pega abajo.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <a ref={bmRef} onClick={(e) => e.preventDefault()} draggable="true"
              className="inline-block border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 px-3 py-2 text-sm font-medium cursor-grab">⭐ Copiar avisos Chileautos</a>
            <button type="button" onClick={copiarMarcador} className="text-xs text-stone-600 hover:underline py-2">
              {copiado ? "Código copiado ✓" : "No puedo arrastrarlo: copiar el código del marcador"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 p-4 md:p-5">
        <p className="text-xs uppercase tracking-widest text-stone-400 mb-2">3 · Margen bruto y avisos copiados</p>
        <div className="max-w-xs mb-4">
          <label className="text-xs text-stone-500 block mb-1">Margen bruto (se descuenta del precio promedio para el precio de compra)</label>
          <select value={margenBruto} onChange={(e) => setMargenBruto(Number(e.target.value))}
            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
            {MARGENES_BRUTOS.map((m) => <option key={m} value={m}>{clp(m)}</option>)}
          </select>
        </div>
        <label className="text-xs text-stone-500 block mb-1">Avisos copiados con el marcador</label>
        <textarea value={pegado} onChange={(e) => setPegado(e.target.value)} rows={3} placeholder="Pega aquí lo que copió el marcador (Ctrl+V)"
          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        {calculo && calculo.error && <p className="text-xs text-rose-600 mt-2">{calculo.error}</p>}
        {calculo && calculo.sinResultados && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 mt-2">
            Chileautos no tiene avisos exactos para este filtro (mostró "vehículos parecidos"). Revisa el modelo, o prueba con "Año ±1" y otro kilometraje.
          </p>
        )}
      </div>

      {calculo && calculo.ok && (
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-widest text-stone-400">4 · Resultado</p>
          {calculo.otraBusqueda && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">
              Estos avisos parecen venir de otra búsqueda (otro modelo, año o kilometraje). Abre la búsqueda de arriba y vuelve a copiar.
            </p>
          )}
          {calculo.advertencias.map((w) => <p key={w} className="text-xs text-amber-800">⚠ {w}</p>)}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Tarjeta titulo="Precio promedio" sub={`Promedio de los ${calculo.primeros.length} avisos más baratos`} valor={calculo.promedioPrimeros} />
            <Tarjeta titulo="Precio sugerido de publicación" sub={`Precio promedio + ${clp(calculo.incremento)}`} valor={calculo.publicacion} />
            <Tarjeta titulo="Precio sugerido de compra" sub={`Precio promedio − margen bruto ${clp(calculo.margenBruto)}`} valor={calculo.compra} destacado />
          </div>
          <p className="text-xs text-stone-500">Estimación referencial a partir de precios de publicación, no de ventas concretadas.</p>
          {onResultado && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => {
                onResultado({
                  promedio: calculo.promedioPrimeros, publicacion: calculo.publicacion, compra: calculo.compra, margenBruto: calculo.margenBruto,
                  nAvisos: calculo.primeros.length, nValidos: calculo.validos.length, nDescartados: calculo.descartados.length,
                  anioMin: filtros.anioMin, anioMax: filtros.anioMax, kmMax: filtros.kmMax, transmision: transLabel || "", combustible: combLabel || "",
                  url: urlBusqueda || "", capturadaEn: new Date().toISOString(),
                  avisos: calculo.primeros.map((v) => ({ titulo: v.titulo || v.id, anio: v.anio || null, km: v.km || null, precio: v.precio, href: v.href || null })),
                });
                setResultadoUsado(true);
              }} className="bg-stone-900 text-white px-4 py-2 text-sm hover:bg-stone-800">Guardar este resultado en la tasación</button>
              {resultadoUsado && <span className="text-xs text-emerald-700">Guardado en la tasación ✓ (recuerda pulsar «Guardar borrador» o «Completar» abajo)</span>}
            </div>
          )}

          <details className="bg-white border border-stone-200 p-4 text-sm">
            <summary className="cursor-pointer text-stone-700">Ver el detalle del cálculo ({calculo.validos.length} usados, {calculo.descartados.length} descartados)</summary>
            <ResumenVendedores validos={calculo.validos} primeros={calculo.primeros} />
            <div className="overflow-x-auto mt-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-stone-400 border-b border-stone-200">
                    <th className="py-1.5 pr-2">Aviso</th><th className="py-1.5 pr-2">Año</th><th className="py-1.5 pr-2 text-right">Km</th><th className="py-1.5 pr-2 text-right">Precio</th><th className="py-1.5 pr-2">Vendedor</th><th className="py-1.5 pr-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {calculo.validos.map((v, i) => (
                    <tr key={v.id} className={`border-b border-stone-100 ${i < calculo.primeros.length ? "bg-amber-50" : ""}`}>
                      <td className="py-1.5 pr-2"><a href={`https://www.chileautos.cl${v.href}`} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">{v.titulo || v.id}{v.version ? ` · ${v.version}` : ""}</a></td>
                      <td className="py-1.5 pr-2">{v.anio || "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{v.km ? v.km.toLocaleString("es-CL") : "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{clp(v.precio)}</td>
                      <td className="py-1.5 pr-2"><VendedorAviso v={v} /></td>
                      <td className="py-1.5 pr-2 text-stone-600">{i < calculo.primeros.length ? "Entra al promedio" : "Válido, fuera del promedio"}</td>
                    </tr>
                  ))}
                  {calculo.descartados.map((d, i) => (
                    <tr key={`${d.id}-${i}`} className="border-b border-stone-100 text-stone-400">
                      <td className="py-1.5 pr-2">{d.titulo || d.id}</td>
                      <td className="py-1.5 pr-2">{d.anio || "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{d.km ? d.km.toLocaleString("es-CL") : "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{d.precio ? clp(d.precio) : "—"}</td>
                      <td className="py-1.5 pr-2"><VendedorAviso v={d} /></td>
                      <td className="py-1.5 pr-2 text-rose-600">Descartado: {d.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
      {calculo && calculo.ok === false && <p className="text-sm text-rose-600">{calculo.error}</p>}
    </div>
  );
}

// Pestañas de la versión anterior (perfiles con código): se mantienen agrupadas mientras compras y consignaciones pasan al CRM.
/** Todas las fotos de una valorización, agrupadas por pieza, en grande (vista del Jefe Local y del Administrador). */
function GaleriaValorizacion({ data, inspectorId }) {
  const [abierta, setAbierta] = useState(null);
  const grupos = [];
  for (const sec of TASACION_SECTIONS) {
    for (const it of getTasacionSectionItems(sec)) {
      const st = (data.checklist || {})[it.id];
      if (st && Array.isArray(st.fotos) && st.fotos.length) grupos.push({ id: it.id, label: sec.type === "dynamic" ? (st.nombre || sec.title) : it.label, estado: st.estado || "", fotos: st.fotos });
    }
  }
  const total = grupos.reduce((n, g) => n + g.fotos.length, 0);
  return (
    <div className="bg-white border border-stone-200 p-5">
      <h3 className="font-serif text-lg text-stone-900">Fotos tomadas por el inspector ({total})</h3>
      {total === 0 ? <p className="text-sm text-stone-500 mt-2">El inspector no adjuntó fotos en esta valorización.</p> : (
        <div className="mt-3 flex flex-col gap-4">
          {grupos.map((g) => (
            <div key={g.id}>
              <p className="text-sm text-stone-700 mb-1.5">{g.label}{g.estado ? <span className="text-stone-400"> · {g.estado}</span> : null}</p>
              <div className="flex flex-wrap gap-2">{g.fotos.map((f) => <PhotoThumb key={f} inspectorId={inspectorId} photoId={f} onOpen={setAbierta} tam="w-28 h-28" />)}</div>
            </div>
          ))}
        </div>
      )}
      {abierta && <PhotoLightbox photoId={abierta} onClose={() => setAbierta(null)} />}
    </div>
  );
}

/** El Jefe Local (o el Administrador) corrige los precios de una valorización: valor comercial y valor de cada pieza. Queda registrado con su nombre. */
function AjusteValorizacion({ registro, onGuardado }) {
  const d = registro.data;
  const items = [];
  for (const sec of TASACION_SECTIONS) {
    for (const it of getTasacionSectionItems(sec)) {
      const st = (d.checklist || {})[it.id];
      if (st && (toNum(st.valor) > 0 || st.estado || st.nombre)) items.push({ id: it.id, label: sec.type === "dynamic" ? (st.nombre || sec.title) : it.label, estado: st.estado || "" });
    }
  }
  const inicial = () => ({ comercial: String(toNum(d.valorComercial)), valores: Object.fromEntries(items.map((i) => [i.id, String(toNum(d.checklist[i.id].valor))])) });
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);
  const cl = { ...(d.checklist || {}) };
  for (const i of items) cl[i.id] = { ...cl[i.id], valor: toNum(f.valores[i.id]) };
  const totales = computeTasacionTotals(cl, TASACION_SECTIONS, getTasacionSectionItems);
  const vf = computeValorFinal(f.comercial, totales.total);
  const original = inicial();
  const sucio = f.comercial !== original.comercial || items.some((i) => f.valores[i.id] !== original.valores[i.id]);

  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try {
      const cambiados = Object.fromEntries(items.filter((i) => f.valores[i.id] !== original.valores[i.id]).map((i) => [i.id, Number(f.valores[i.id] || 0)]));
      const r = await window.auth.ventas("inspecciones.valorizacion_ajustar", { key: registro.key, ...(f.comercial !== original.comercial ? { valorComercial: Number(f.comercial || 0) } : {}), items: cambiados });
      onGuardado({ ...d, valorComercial: Number(f.comercial || 0), checklist: cl, ajustes: r.ajustes });
    } catch (e) { setMsg({ ok: false, texto: e && e.message === "sin_cambio" ? "No hay cambios que guardar." : "No se pudo guardar. Inténtalo de nuevo." }); }
    setGuardando(false);
  };

  return (
    <div className="bg-white border border-stone-200 p-5 flex flex-col gap-4">
      <div>
        <h3 className="font-serif text-lg text-stone-900">Ajustar precios de la valorización</h3>
        <p className="text-xs text-stone-500 mt-1">Puedes corregir el valor comercial y la valorización de cada pieza. El resto de la ficha no se modifica y cada cambio queda registrado.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <label className="text-xs text-stone-500 flex flex-col gap-1 md:col-span-1">Valor comercial estimado
          <InputDinero value={f.comercial} onChange={(e) => setF({ ...f, comercial: e.target.value })} className="w-full border border-stone-300 bg-white px-3 py-2 text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </label>
        <div className="md:col-span-2 grid grid-cols-3 gap-3 text-sm">
          <div><p className="text-xs text-stone-500">Total valorizaciones</p><p className="font-mono">{clp(totales.total)}</p></div>
          <div><p className="text-xs text-stone-500">Valor final</p><p className={`font-mono font-semibold ${vf.final < 0 ? "text-rose-700" : "text-stone-900"}`}>{clp(vf.final)}</p></div>
          <div><p className="text-xs text-stone-500">Antes</p><p className="font-mono text-stone-500">{clp(computeValorFinal(d.valorComercial, computeTasacionTotals(d.checklist, TASACION_SECTIONS, getTasacionSectionItems).total).final)}</p></div>
        </div>
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-2 pr-2">Pieza o ítem</th><th className="py-2 pr-2">Estado</th><th className="py-2 pr-2 text-right w-44">Valorización</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-stone-100">
                  <td className="py-1.5 pr-2 text-stone-800">{i.label}</td>
                  <td className="py-1.5 pr-2 text-stone-500">{i.estado || "—"}</td>
                  <td className="py-1.5 pr-2"><InputDinero value={f.valores[i.id]} onChange={(e) => setF({ ...f, valores: { ...f.valores, [i.id]: e.target.value } })} className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-amber-500" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.texto}</p>}
      <div className="flex items-center gap-3">
        <button onClick={guardar} disabled={!sucio || guardando} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700 disabled:opacity-50">{guardando ? "Guardando…" : "Guardar precios"}</button>
        {sucio && <button onClick={() => setF(inicial())} className="text-sm text-stone-600 hover:underline">Deshacer</button>}
      </div>
      {Array.isArray(d.ajustes) && d.ajustes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-600">Historial de ajustes ({d.ajustes.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-stone-600">
            {d.ajustes.slice().reverse().map((a, i) => <li key={i}>{new Date(a.en).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })} · {a.por}: {(items.find((i) => i.id === a.item) || {}).label || a.campo} de {clp(a.antes)} a {clp(a.despues)}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Fotos para el equipo que el Inspector sacó en una inspección. */
function GaleriaInspeccion({ registro }) {
  const fichaId = recordIdFromKey(registro.key);
  const fotos = registro.data.fotosEquipo || [];
  return (
    <div className="bg-white border border-stone-200 p-5">
      <h3 className="font-serif text-lg text-stone-900">Fotos tomadas por el inspector ({fotos.length})</h3>
      {fotos.length === 0 ? <p className="text-sm text-stone-500 mt-2">El inspector no adjuntó fotos en esta inspección.</p> : (
        <div className="mt-3 flex flex-wrap gap-2">{fotos.map((f) => <MiniaturaEquipo key={f} fichaId={fichaId} fotoId={f} />)}</div>
      )}
    </div>
  );
}

/** Fichas de inspección y valorizaciones de las personas que inspeccionan. Las ve el Jefe Local (su local) y la cuenta maestra (todos), completas, con los datos del propietario y el PDF con el CAV. Solo lectura. */
function FichasEquipo() {
  const [estado, setEstado] = useState({ cargando: true, error: "", inspectores: [], inspecciones: [], valorizaciones: [], pendientes: 0 });
  const [vista, setVista] = useState("inspecciones");
  const [abierto, setAbierto] = useState(null); // { tipo, key, data, inspectorId, inspectorNombre }
  const [msg, setMsg] = useState("");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await window.auth.ventas("inspecciones.fichas_equipo", {});
        const inspectores = r.inspectores || [];
        const claves = [];
        for (const i of inspectores) {
          for (const [tipo, pref] of [["inspeccion", "inspeccion"], ["valorizacion", "tasacion"]]) {
            try {
              const l = await window.storage.list(pref + "::" + i.id + "::", true);
              for (const k of (l && l.keys) || []) claves.push({ tipo, key: k, inspectorId: i.id, inspectorNombre: i.nombre });
            } catch (e) { /* si un inspector no se puede listar, se sigue con los demás */ }
          }
        }
        if (cancelado) return;
        setEstado((x) => ({ ...x, inspectores, pendientes: claves.length }));
        const hechas = { inspeccion: [], valorizacion: [] };
        let cola = 0;
        const trabajar = async () => {
          while (cola < claves.length && !cancelado) {
            const c = claves[cola++];
            try {
              const res = await window.storage.get(c.key, true);
              if (res) {
                const d = JSON.parse(res.value);
                const { cavFileData, ...resumen } = d; // el PDF del CAV pesa varios MB: se vuelve a pedir solo al abrir la ficha
                hechas[c.tipo].push({ ...c, data: resumen, tieneCav: !!cavFileData });
              }
            } catch (e) { /* ficha ilegible: se omite */ }
            if (!cancelado) setEstado((x) => ({ ...x, pendientes: Math.max(0, claves.length - cola) }));
          }
        };
        await Promise.all([trabajar(), trabajar(), trabajar()]);
        const ordenar = (a) => a.sort((x, y) => String(y.data.guardadoEl || y.data.fecha || "").localeCompare(String(x.data.guardadoEl || x.data.fecha || "")));
        if (!cancelado) setEstado((x) => ({ ...x, cargando: false, pendientes: 0, inspecciones: ordenar(hechas.inspeccion), valorizaciones: ordenar(hechas.valorizacion) }));
      } catch (e) {
        if (!cancelado) setEstado((x) => ({ ...x, cargando: false, error: "No se pudieron cargar las fichas. Intenta de nuevo." }));
      }
    })();
    return () => { cancelado = true; };
  }, []);

  const abrir = async (fila) => {
    setMsg("");
    try {
      const res = await window.storage.get(fila.key, true);
      if (!res) { setMsg("La ficha ya no existe."); return; }
      const data = JSON.parse(res.value);
      setAbierto({ ...fila, data: { ...data, inspectorId: fila.inspectorId } });
    } catch (e) { setMsg("No se pudo abrir la ficha."); }
  };
  const pdf = () => {
    try {
      const d = abierto.data;
      if (abierto.tipo === "inspeccion") {
        downloadPdfBytes(buildInspeccionPdf(d, { sections: CHECKLIST_SECTIONS, inspectorNombre: d.inspectorNombre || abierto.inspectorNombre }), pdfFileName("Inspeccion", d));
      } else {
        downloadPdfBytes(buildTasacionPdf(d, { sections: TASACION_SECTIONS, getItems: getTasacionSectionItems, fmt: clp, inspectorNombre: d.inspectorNombre || abierto.inspectorNombre }), pdfFileName("Tasacion", { ...d, inscripcion: d.patente }));
      }
    } catch (e) { setMsg("No se pudo generar el PDF."); }
  };

  if (abierto) {
    const d = abierto.data;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <button onClick={() => setAbierto(null)} className="text-sm text-stone-500 hover:underline py-1.5">← Volver a las fichas</button>
          <ActionLink onClick={pdf}>Descargar PDF{abierto.tipo === "inspeccion" ? " (con el CAV)" : ""}</ActionLink>
          <span className="text-xs text-stone-500">Realizada por {d.inspectorNombre || abierto.inspectorNombre}{abierto.tipo === "inspeccion" ? " · solo lectura" : ""}</span>
        </div>
        {msg && <p className={`text-sm ${/^Precios actualizados/.test(msg) ? "text-emerald-700" : "text-stone-500"}`}>{msg}</p>}
        {abierto.tipo === "inspeccion" ? (
          <>
            <GaleriaInspeccion registro={abierto} />
            <InspeccionForm key={abierto.key} record={d} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly />
          </>
        ) : (
          <>
            <GaleriaValorizacion data={d} inspectorId={abierto.inspectorId} />
            <AjusteValorizacion key={abierto.key + (d.ajustes ? d.ajustes.length : 0)} registro={abierto} onGuardado={(nuevo) => {
              setAbierto({ ...abierto, data: nuevo });
              setMsg("Precios actualizados. Quedó registrado con tu nombre.");
              setEstado((x) => ({ ...x, valorizaciones: x.valorizaciones.map((v) => (v.key === abierto.key ? { ...v, data: { ...v.data, valorComercial: nuevo.valorComercial } } : v)) }));
            }} />
            <TasacionForm key={abierto.key + "-" + toNum(d.valorComercial)} record={d} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly photos={{ viewOnly: true, inspectorId: abierto.inspectorId }} />
          </>
        )}
      </div>
    );
  }

  const q = filtro.trim().toLowerCase();
  const coincide = (f) => !q || [f.inspectorNombre, f.data.marca, f.data.modelo, f.data.inscripcion, f.data.patente, f.data.vehiculo, f.data.propietarioNombre, f.data.propietarioRun, f.data.propietario].some((v) => String(v || "").toLowerCase().includes(q));
  const lista = (vista === "inspecciones" ? estado.inspecciones : estado.valorizaciones).filter(coincide);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {[["inspecciones", "Inspecciones", estado.inspecciones.length], ["valorizaciones", "Tasaciones del Inspector", estado.valorizaciones.length]].map(([id, t, n]) => (
          <button key={id} onClick={() => setVista(id)} className={"px-3 py-1.5 text-sm border " + (vista === id ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-700 border-stone-300")}>{t} ({n})</button>
        ))}
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por inspector, patente, vehículo o propietario" className="border border-stone-300 px-3 py-1.5 text-sm flex-1 min-w-[220px]" />
      </div>
      {estado.error && <p className="text-sm text-rose-600">{estado.error}</p>}
      {msg && <p className="text-xs text-stone-500">{msg}</p>}
      {estado.cargando && <p className="text-sm text-stone-500">Cargando fichas{estado.pendientes ? " (" + estado.pendientes + " por leer)" : ""}…</p>}
      <div className="bg-white border border-stone-200 p-5 overflow-x-auto">
        {!estado.cargando && lista.length === 0 ? (
          <p className="text-sm text-stone-500">{q ? "Ninguna ficha coincide con la búsqueda." : "Aún no hay " + (vista === "inspecciones" ? "inspecciones" : "tasaciones del Inspector") + " registradas."}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                <th className="py-2 pr-2">Fecha</th><th className="py-2 pr-2">Inspector</th><th className="py-2 pr-2">Vehículo</th><th className="py-2 pr-2">Patente</th>
                <th className="py-2 pr-2">Propietario</th>{vista === "valorizaciones" && <th className="py-2 pr-2 text-right">Valor comercial</th>}<th className="py-2 pr-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.key} className="border-b border-stone-100">
                  <td className="py-2 pr-2 text-stone-600">{f.data.fecha || "—"}</td>
                  <td className="py-2 pr-2 text-stone-900">{f.inspectorNombre || "—"}</td>
                  <td className="py-2 pr-2 text-stone-700">{vista === "inspecciones" ? ([f.data.marca, f.data.modelo].filter(Boolean).join(" ") || "—") : (f.data.vehiculo || "—")}</td>
                  <td className="py-2 pr-2 text-stone-600 font-mono">{(vista === "inspecciones" ? f.data.inscripcion : f.data.patente) || "—"}</td>
                  <td className="py-2 pr-2 text-stone-700">{(vista === "inspecciones" ? [f.data.propietarioNombre, f.data.propietarioRun].filter(Boolean).join(" · ") : f.data.propietario) || "—"}</td>
                  {vista === "valorizaciones" && <td className="py-2 pr-2 text-right font-mono text-stone-900">{clp(f.data.valorComercial)}</td>}
                  <td className="py-2 pr-2 text-right"><button onClick={() => abrir(f)} className="text-xs text-amber-700 hover:underline">Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Quién publica un aviso de Chileautos: particular o automotora (con su nombre). Los avisos copiados antes de esta mejora no lo traen. */
function VendedorAviso({ v }) {
  if (v && v.vendedorTipo === "particular") return <span className="inline-block px-1.5 py-0.5 text-[11px] bg-sky-100 text-sky-800">Particular</span>;
  if (v && v.vendedorTipo === "automotora") {
    return (
      <span className="inline-flex flex-col">
        <span className="inline-block self-start px-1.5 py-0.5 text-[11px] bg-violet-100 text-violet-800">Automotora</span>
        {(v.vendedorNombre || v.condicion) && <span className="text-[11px] text-stone-500 mt-0.5">{[String(v.vendedorNombre || "").replace(/^Automotora\s+/i, ""), v.condicion].filter(Boolean).join(" · ")}</span>}
      </span>
    );
  }
  return <span className="text-stone-400" title="Esta copia de los avisos no trae el dato: vuelve a copiarlos con el marcador">—</span>;
}

/** Cuántos de los avisos usados (y de los que entran al promedio) son de particulares y cuántos de automotoras. */
function ResumenVendedores({ validos, primeros }) {
  const cuenta = (lista) => ({ p: lista.filter((x) => x.vendedorTipo === "particular").length, a: lista.filter((x) => x.vendedorTipo === "automotora").length, n: lista.filter((x) => !x.vendedorTipo).length });
  const u = cuenta(validos);
  const e = cuenta(primeros);
  if (u.p + u.a === 0) return <p className="text-xs text-stone-500 mt-3">Esta copia de los avisos no indica si son de particulares o automotoras: vuelve a copiarlos con el marcador para verlo.</p>;
  return (
    <p className="text-xs text-stone-600 mt-3">
      Avisos usados: <strong>{u.p}</strong> de particulares y <strong>{u.a}</strong> de automotoras{u.n ? ` (${u.n} sin dato)` : ""}.
      {" "}Los {primeros.length} que entran al promedio: <strong>{e.p}</strong> de particulares y <strong>{e.a}</strong> de automotoras.
    </p>
  );
}

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
              <h1 className="font-serif text-2xl md:text-3xl">Ventas</h1>
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
              <h1 className="font-serif text-2xl md:text-3xl">Tasación de compra</h1>
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
