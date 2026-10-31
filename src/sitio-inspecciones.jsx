/**
 * CONSULTA DE INSPECCIONES (sitio aparte)
 * ----------------------------------------------------------------
 * Página pública donde cualquiera revisa la inspección de un vehículo por su patente: resultado, informe completo en PDF e imágenes.
 * Es un sitio distinto al de la automotora: no tiene el inventario ni formularios de contacto. Se muestra cuando se abre desde una
 * dirección cuyo nombre empieza con «inspecciones» (por ejemplo inspecciones-drivefuturo.vercel.app) o cuando el proyecto se construye con
 * VITE_SITIO=inspecciones. Habla con la misma función de Supabase (acción «public»), que limita las consultas y firma cada acceso.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useRef } from "react";
import { VEREDICTOS } from "../supabase/functions/api/inspecciones-core.js";
import { llamar, textoError } from "./publico-api.js";

const BTN = "px-5 py-3 text-sm bg-amber-500 text-stone-900 font-semibold rounded-lg shadow-suave hover:bg-amber-400 disabled:opacity-50 transition-colors";
const BTN_2 = "px-5 py-3 text-sm border border-stone-300 bg-white text-stone-800 font-medium rounded-lg hover:bg-stone-50 transition-colors";
const INPUT = "border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full";
const Campo = ({ etiqueta, children, ayuda }) => (<label className="text-sm text-stone-700 flex flex-col gap-1 min-w-0">{etiqueta}{children}{ayuda && <span className="text-xs text-stone-500">{ayuda}</span>}</label>);
const km = (n) => `${Number(n).toLocaleString("es-CL")} km`;

const COLOR_VEREDICTO = { sin_observaciones: "bg-emerald-100 text-emerald-800", con_observaciones: "bg-amber-100 text-amber-800", con_fallas: "bg-rose-100 text-rose-800" };
const fechaLarga = (iso) => (iso ? new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago" }) : "");

function bajarArchivo(bytesOUrl, nombre, tipo) {
  const url = typeof bytesOUrl === "string" ? bytesOUrl : URL.createObjectURL(new Blob([bytesOUrl], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  if (typeof bytesOUrl !== "string") setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Una foto de la inspección: se pide al verse; al tocarla se abre en otra pestaña (los enlaces data: los bloquea el navegador). */
function FotoInspeccion({ acceso, fotoId }) {
  const [src, setSrc] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    let vivo = true;
    const pedir = () => llamar("inspeccion.foto", { acceso, fotoId }).then((d) => { if (vivo && d.value) setSrc(d.value); }).catch(() => {});
    if (typeof IntersectionObserver === "undefined" || !ref.current) { pedir(); return () => { vivo = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); pedir(); } }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => { vivo = false; io.disconnect(); };
  }, [acceso, fotoId]);
  const abrir = async () => {
    const w = window.open("", "_blank");
    try { const url = URL.createObjectURL(await (await fetch(src)).blob()); if (w) w.location.href = url; else window.open(url, "_blank"); } catch (e) { if (w) w.close(); }
  };
  return (
    <button ref={ref} type="button" onClick={abrir} disabled={!src} className="aspect-[4/3] bg-stone-200 border border-stone-300 rounded-lg overflow-hidden" aria-label="Ver foto de la inspección">
      {src ? <img src={src} alt="Foto de la inspección" className="w-full h-full object-cover" /> : <span className="text-xs text-stone-400">…</span>}
    </button>
  );
}

function ResultadoInspeccion({ datos, acceso }) {
  const x = datos.inspeccion;
  const r = x.resultado || {};
  const { patente: placa } = x.vehiculo; // la patente que el visitante buscó: es la del vehículo inspeccionado
  const [ocupado, setOcupado] = useState("");
  const [aviso, setAviso] = useState("");
  const informe = async () => {
    setAviso(""); setOcupado("informe");
    try {
      const [{ ficha }, { buildInspeccionPdf, pdfFileName }, { CHECKLIST_SECTIONS }] = await Promise.all([llamar("inspeccion.informe", { acceso }), import("./pdf-report.js"), import("./checklists.js")]);
      bajarArchivo(buildInspeccionPdf(ficha, { sections: CHECKLIST_SECTIONS, inspectorNombre: ficha.inspectorNombre || x.inspector || "" }), pdfFileName("Inspeccion", ficha), "application/pdf");
    } catch (e) { setAviso(textoError(e)); }
    setOcupado("");
  };
  const cav = async () => {
    setAviso(""); setOcupado("cav");
    try { const d = await llamar("inspeccion.cav", { acceso }); bajarArchivo(d.value, d.nombre || "cav.pdf"); } catch (e) { setAviso(textoError(e)); }
    setOcupado("");
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white border border-stone-200 rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-2xl text-stone-900">{[x.vehiculo.marca, x.vehiculo.modelo, x.vehiculo.anio].filter(Boolean).join(" ")}</h2>
          <span className="font-mono text-sm text-stone-600">{placa}</span>
          {r.veredicto && <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${COLOR_VEREDICTO[r.veredicto] || ""}`}>{VEREDICTOS[r.veredicto]}</span>}
        </div>
        <p className="text-sm text-stone-600">Inspección {x.folio} · realizada el {fechaLarga(x.fecha)}{x.inspector ? ` por ${x.inspector}` : ""}{x.vehiculo.km != null ? ` · ${km(x.vehiculo.km)}` : ""}</p>
        {r.veredicto && <p className="text-sm text-stone-700">{r.buenos} ítems bien · {r.regulares} regular · {r.malos} malo{r.noAplica ? ` · ${r.noAplica} no aplica` : ""}{r.sinRevisar ? ` · ${r.sinRevisar} sin revisar` : ""}</p>}
        {r.observaciones && <p className="text-sm text-stone-800">{r.observaciones}</p>}
        {(r.destacados || []).length > 0 && (
          <ul className="flex flex-col divide-y divide-stone-100 text-sm">
            {r.destacados.map((d, i) => (
              <li key={i} className="py-1.5 flex flex-wrap gap-x-3">
                <span className={d.estado === "Malo" ? "text-rose-700 font-medium" : d.estado === "Regular" ? "text-amber-700" : "text-stone-600"}>{d.estado || "Nota"}</span>
                <span className="text-stone-900">{d.item}</span><span className="text-xs text-stone-400">{d.seccion}</span>
                {d.observacion && <span className="basis-full text-stone-600">{d.observacion}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" onClick={informe} disabled={!!ocupado} className={BTN}>{ocupado === "informe" ? "Generando…" : "Descargar informe completo (PDF)"}</button>
          {x.tieneCav && <button type="button" onClick={cav} disabled={!!ocupado} className={BTN_2}>{ocupado === "cav" ? "Descargando…" : "Descargar CAV (PDF)"}</button>}
          {aviso && <span className="text-sm text-rose-700">{aviso}</span>}
        </div>
      </div>
      {x.fotos.length > 0 && (
        <div>
          <h3 className="font-serif text-lg text-stone-900 mb-2">Imágenes de la inspección</h3>
          {x.fotosDe && <p className="text-xs text-stone-500 mb-2">La inspección más reciente no tiene imágenes: estas son de la inspección {x.fotosDe.folio} del {fechaLarga(x.fotosDe.fecha)}.</p>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{x.fotos.map((f) => <FotoInspeccion key={f} acceso={acceso} fotoId={f} />)}</div>
        </div>
      )}
    </div>
  );
}

function Consulta() {
  const [patente, setPatente] = useState("");
  const [siteKey, setSiteKey] = useState(null);
  const [captcha, setCaptcha] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState(null);
  const cajaCaptcha = useRef(null);
  const widget = useRef(null);
  useEffect(() => { document.title = "Revisa la inspección de un vehículo · Drive Futuro"; llamar("inspeccion.config").then((d) => setSiteKey(d.captcha || null)).catch(() => {}); }, []);
  // Captcha de Cloudflare Turnstile (solo si el servidor lo tiene activado).
  useEffect(() => {
    if (!siteKey || !cajaCaptcha.current) return undefined;
    let vivo = true;
    const pintar = () => { if (vivo && window.turnstile && widget.current === null) widget.current = window.turnstile.render(cajaCaptcha.current, { sitekey: siteKey, callback: (t) => setCaptcha(t), "expired-callback": () => setCaptcha(""), "error-callback": () => setCaptcha("") }); };
    if (window.turnstile) pintar();
    else {
      let s = document.getElementById("turnstile-api");
      if (!s) { s = document.createElement("script"); s.id = "turnstile-api"; s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; document.head.appendChild(s); }
      s.addEventListener("load", pintar);
    }
    return () => { vivo = false; };
  }, [siteKey]);
  const buscar = async (e) => {
    e.preventDefault();
    setError(""); setRes(null); setCargando(true);
    try { setRes(await llamar("inspeccion.buscar", { patente, captcha })); }
    catch (er) { setError(textoError(er)); }
    setCargando(false);
    if (siteKey && window.turnstile && widget.current !== null) { window.turnstile.reset(widget.current); setCaptcha(""); }
  };
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12 flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl md:text-4xl text-stone-900 leading-tight">Revisa la inspección de un vehículo</h1>
        <p className="text-stone-600 mt-2">Escribe la patente para ver el resultado de la inspección, descargar el informe completo y revisar las imágenes.</p>
      </div>
      <form onSubmit={buscar} className="bg-white border border-stone-200 rounded-2xl p-5 flex flex-col gap-4">
        <Campo etiqueta="Patente" ayuda="Ej. ABCD12 o AB1234">
          <input value={patente} onChange={(e) => setPatente(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} maxLength={6} placeholder="ABCD12" autoComplete="off" className={`${INPUT} font-mono text-lg tracking-widest max-w-[14rem]`} />
        </Campo>
        {siteKey && <div ref={cajaCaptcha} />}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={cargando || patente.length < 6 || (!!siteKey && !captcha)} className={BTN}>{cargando ? "Buscando…" : "Buscar inspección"}</button>
          {error && <span className="text-sm text-rose-700">{error}</span>}
        </div>
      </form>
      {res && <ResultadoInspeccion datos={res} acceso={res.acceso} />}
    </div>
  );
}


export default function SitioInspecciones() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="bg-stone-900 text-stone-100">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 flex items-center gap-2.5 font-serif text-xl md:text-2xl">
          <span className="w-9 h-9 rounded-xl bg-amber-500 text-stone-900 text-sm font-bold flex items-center justify-center">DF</span>
          Drive Futuro · Inspecciones
        </div>
      </header>
      <main className="flex-1"><Consulta /></main>
      <footer className="bg-stone-900 text-stone-400 text-xs">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">Consulta de inspecciones de vehículos por patente.</div>
      </footer>
    </div>
  );
}
