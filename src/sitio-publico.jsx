/**
 * SITIO WEB PÚBLICO (CRM · entrega 9)
 * ----------------------------------------------------------------
 * Catálogo de vehículos disponibles y reservados, con detalle, fotos y cuatro solicitudes: consultar, agendar una visita,
 * cotizar financiamiento y vender o consignar el auto del visitante. Cada solicitud crea un lead en el CRM con la fuente
 * «Sitio web», repartido entre los ejecutivos habilitados.
 *
 * No necesita iniciar sesión. Habla con la misma función de Supabase (acción «public»), que valida todo, limita los envíos
 * por IP y por teléfono y solo entrega una lista cerrada de datos de cada vehículo (nunca la patente ni el costo).
 * Direcciones: «/» catálogo · «/vehiculo/<id>» detalle · «/vender» vender o consignar · «/plataforma» ingreso del personal.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { InputDinero } from "./campo-dinero.jsx";
import { PLAZOS_FINANCIAMIENTO, MENSAJES_WEB, PAISES } from "../supabase/functions/api/publico-core.js";
import { camposDesdePatente } from "./datos-patente.js";

const URL_FUNCION = import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api` : "";
const CLAVE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/** Llama a la acción pública del servidor. Lanza Error(codigo) si falla. */
async function llamar(op, extra = {}) {
  if (!URL_FUNCION) throw new Error("sin_servidor");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  let res;
  try {
    res = await fetch(URL_FUNCION, { method: "POST", headers: { "Content-Type": "application/json", apikey: CLAVE_ANON }, body: JSON.stringify({ action: "public", op, ...extra }), signal: ctl.signal });
  } catch (e) { throw new Error("sin_conexion"); } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (!res.ok) { const err = new Error((data && data.error) || `http_${res.status}`); err.status = res.status; throw err; }
  return data;
}
const textoError = (e) => MENSAJES_WEB[e && e.message] || (e && e.message === "sin_conexion" ? "No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo." : "No pudimos procesar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.");

const clp = (n) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;
const km = (n) => `${Number(n).toLocaleString("es-CL")} km`;
const nombreVeh = (v) => [v.marca, v.modelo, v.version].filter(Boolean).join(" ");

/* ---------- navegación dentro del sitio (sin recargar) ---------- */
function useRuta() {
  const [ruta, setRuta] = useState(() => window.location.pathname);
  useEffect(() => {
    const f = () => { setRuta(window.location.pathname); window.scrollTo({ top: 0 }); };
    window.addEventListener("popstate", f);
    return () => window.removeEventListener("popstate", f);
  }, []);
  const ir = (destino) => { window.history.pushState({}, "", destino); setRuta(destino.split("?")[0]); window.scrollTo({ top: 0 }); };
  return [ruta, ir];
}

/* ---------- fotos (se piden solo al verse, con memoria) ---------- */
const fotosCache = new Map();
function Foto({ vehiculoId, fotoId, alt = "", className = "" }) {
  const [src, setSrc] = useState(fotosCache.get(fotoId) || "");
  const ref = useRef(null);
  useEffect(() => {
    if (!fotoId || src) return undefined;
    let vivo = true;
    const pedir = () => llamar("foto", { vehiculoId, fotoId }).then((r) => { if (r.value) { fotosCache.set(fotoId, r.value); if (vivo) setSrc(r.value); } }).catch(() => {});
    if (typeof IntersectionObserver === "undefined" || !ref.current) { pedir(); return () => { vivo = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); pedir(); } }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => { vivo = false; io.disconnect(); };
  }, [vehiculoId, fotoId, src]);
  return (
    <div ref={ref} className={`bg-stone-200 overflow-hidden ${className}`}>
      {src ? <img src={src} alt={alt} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">{fotoId ? "Cargando foto…" : "Sin foto"}</div>}
    </div>
  );
}

/* ---------- piezas ---------- */
const BTN = "px-5 py-3 text-sm bg-amber-500 text-stone-900 font-semibold rounded-lg shadow-suave hover:bg-amber-400 disabled:opacity-50 transition-colors";
const BTN_2 = "px-5 py-3 text-sm border border-stone-300 bg-white text-stone-800 font-medium rounded-lg hover:bg-stone-50 transition-colors";
const INPUT = "border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full";
const Campo = ({ etiqueta, children, ayuda, clase = "" }) => (<label className={`text-sm text-stone-700 flex flex-col gap-1 min-w-0 ${clase}`}>{etiqueta}{children}{ayuda && <span className="text-xs text-stone-500">{ayuda}</span>}</label>);

function Marco({ empresa, ir, children }) {
  const wa = empresa && empresa.whatsapp ? `https://wa.me/${empresa.whatsapp}` : "";
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="bg-stone-900 text-stone-100">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <a href="/" onClick={(e) => { e.preventDefault(); ir("/"); }} className="flex items-center gap-2.5 font-serif text-xl md:text-2xl">
            <span className="w-9 h-9 rounded-xl bg-amber-500 text-stone-900 text-sm font-bold flex items-center justify-center">{String((empresa && empresa.nombre) || "Drive Futuro").split(/s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase()}</span>
            {(empresa && empresa.nombre) || "Drive Futuro"}
          </a>
          <nav className="flex items-center gap-2 md:gap-5 text-sm">
            <a href="/" onClick={(e) => { e.preventDefault(); ir("/"); }} className="hidden md:inline text-stone-300 hover:text-white">Vehículos</a>
            <a href="/vender" onClick={(e) => { e.preventDefault(); ir("/vender"); }} className="text-stone-300 hover:text-white">Vende tu auto</a>
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-3.5 py-1.5 rounded-lg">WhatsApp</a>}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-stone-900 text-stone-400 text-xs">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <p>{(empresa && empresa.nombre) || "Drive Futuro"}{empresa && empresa.direccion ? ` · ${empresa.direccion}` : ""}</p>
          <p>Los precios y la disponibilidad pueden cambiar sin aviso. <a href="/plataforma" className="underline hover:text-white">Acceso del personal</a></p>
        </div>
      </footer>
    </div>
  );
}

/* =========================================================
   FORMULARIO DE SOLICITUD (los cuatro tipos)
========================================================= */
const TITULOS = { consulta: "Consultar por este vehículo", visita: "Agendar una visita o test drive", financiamiento: "Cotizar financiamiento", vender: "Vender o consignar mi auto", renovar: "Cambiar mi auto por este" };
const mananaALas11 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

function Formulario({ tipo, vehiculo, locales = [], empresa, onCerrar }) {
  const [abiertoEn] = useState(() => Date.now()); // momento en que se abrió: los robots envían al instante
  const [f, setF] = useState({ nombre: "", telefono: "", email: "", mensaje: "", fechaHora: mananaALas11(), pie: "", plazo: 48, patente: "", marca: "", modelo: "", anio: "", km: "", modalidad: "vender", transmision: "", combustible: "", codigoPais: "56", duenos: "", prenda: "", mantenciones: "", precioEsperado: "", localId: locales.length === 1 ? locales[0].id : "", acepta: false, web: "" });
  const [estado, setEstado] = useState({ enviando: false, error: "", listo: null });
  const [verPrivacidad, setVerPrivacidad] = useState(false);
  const [buscandoPatente, setBuscandoPatente] = useState(false);
  const [msgPatente, setMsgPatente] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // Completa marca, modelo y año con los datos de la patente; la persona los revisa y agrega el kilometraje.
  const buscarPatente = async () => {
    setBuscandoPatente(true); setMsgPatente(null);
    try {
      const r = await llamar("patente", { patente: f.patente.replace(/[^A-Z0-9]/g, "") });
      const c = camposDesdePatente(r.vehiculo);
      setF((x) => ({ ...x, marca: c.marca || x.marca, modelo: c.modelo || x.modelo, anio: c.anio || x.anio, transmision: ["Mecánica", "Automática"].includes(c.transmision) ? c.transmision : x.transmision, combustible: ["Bencina", "Diesel", "Híbrido", "Eléctrico"].includes(c.combustible) ? c.combustible : x.combustible }));
      setMsgPatente({ ok: true, texto: "Completamos la marca, el modelo y el año. Revísalos y agrega el kilometraje." });
    } catch (e) { setMsgPatente({ ok: false, texto: textoError(e) }); }
    setBuscandoPatente(false);
  };

  const enviar = async (ev) => {
    ev.preventDefault();
    setEstado({ enviando: true, error: "", listo: null });
    try {
      const datos = { tipo, nombre: f.nombre, codigoPais: f.codigoPais, telefono: f.telefono, email: f.email, mensaje: f.mensaje, acepta: f.acepta, abiertoEn, web: f.web, localId: f.localId || undefined };
      if (vehiculo) datos.vehiculoId = vehiculo.id;
      if (tipo === "visita") datos.fechaHora = f.fechaHora ? new Date(f.fechaHora).toISOString() : "";
      if (tipo === "financiamiento") { datos.pie = f.pie === "" ? "" : Number(f.pie); datos.plazo = Number(f.plazo); }
      if (tipo === "vender" || tipo === "renovar") Object.assign(datos, { patente: f.patente, marca: f.marca, modelo: f.modelo, anio: f.anio === "" ? "" : Number(f.anio), km: f.km === "" ? "" : Number(f.km), modalidad: tipo === "vender" ? f.modalidad : "cambiar", transmision: f.transmision, combustible: f.combustible, duenos: f.duenos === "" ? "" : Number(f.duenos), prenda: f.prenda, mantenciones: f.mantenciones, precioEsperado: f.precioEsperado === "" ? "" : Number(f.precioEsperado) });
      const r = await llamar("solicitud", datos);
      setEstado({ enviando: false, error: "", listo: r });
    } catch (e) { setEstado({ enviando: false, error: textoError(e), listo: null }); }
  };

  if (estado.listo) {
    const c = estado.listo.cuota;
    return (
      <div className="flex flex-col gap-4">
        <p className="font-serif text-xl text-stone-900">¡Gracias! Recibimos tu solicitud.</p>
        <p className="text-sm text-stone-700">Un ejecutivo se pondrá en contacto contigo muy pronto{tipo === "visita" ? " para confirmar el día y la hora" : ""}.</p>
        {c && (
          <div className="border border-amber-300 bg-amber-50 p-4 text-sm text-stone-800">
            <p>Cuota referencial: <strong className="font-mono text-lg">{clp(c.cuota)}</strong> al mes</p>
            <p className="text-xs text-stone-600 mt-1">Financiando {clp(c.montoFinanciar)} en {f.plazo} cuotas. Es una estimación: el crédito está sujeto a evaluación y a las condiciones de la financiera.</p>
          </div>
        )}
        <button onClick={onCerrar} className={BTN_2}>Cerrar</button>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      {vehiculo && <p className="text-sm text-stone-600">{nombreVeh(vehiculo)} {vehiculo.anio} · {clp(vehiculo.precio)}</p>}
      {(tipo === "vender" || tipo === "renovar") && (
        <>
          {tipo === "renovar" && <p className="text-sm font-medium text-stone-800">Datos del auto que entregarías</p>}
          <div className="grid grid-cols-2 gap-3">
            {tipo === "vender" && <Campo etiqueta="¿Qué prefieres?"><select value={f.modalidad} onChange={(e) => set("modalidad", e.target.value)} className={INPUT}><option value="vender">Vender mi auto</option><option value="consignar">Consignarlo</option></select></Campo>}
            <div>
              <Campo etiqueta="Patente"><input value={f.patente} onChange={(e) => set("patente", e.target.value.toUpperCase())} className={`${INPUT} font-mono`} placeholder="ABCD12" required /></Campo>
              <button type="button" onClick={buscarPatente} disabled={buscandoPatente || !/^([A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(f.patente.replace(/[^A-Z0-9]/g, ""))} className="mt-1.5 text-sm text-amber-700 underline underline-offset-2 disabled:text-stone-400 disabled:no-underline">{buscandoPatente ? "Buscando…" : "Buscar los datos de mi auto"}</button>
              {msgPatente && <p className={`text-xs mt-1 ${msgPatente.ok ? "text-emerald-700" : "text-rose-700"}`}>{msgPatente.texto}</p>}
            </div>
            <Campo etiqueta="Marca"><input value={f.marca} onChange={(e) => set("marca", e.target.value)} className={INPUT} required /></Campo>
            <Campo etiqueta="Modelo"><input value={f.modelo} onChange={(e) => set("modelo", e.target.value)} className={INPUT} required /></Campo>
            <Campo etiqueta="Año"><input type="number" value={f.anio} onChange={(e) => set("anio", e.target.value)} className={INPUT} required /></Campo>
            <Campo etiqueta="Kilometraje"><input type="number" min="0" value={f.km} onChange={(e) => set("km", e.target.value)} className={INPUT} required /></Campo>
            <Campo etiqueta="Transmisión"><select value={f.transmision} onChange={(e) => set("transmision", e.target.value)} className={INPUT} required><option value="">Elige…</option><option>Mecánica</option><option>Automática</option></select></Campo>
            <Campo etiqueta="Combustible"><select value={f.combustible} onChange={(e) => set("combustible", e.target.value)} className={INPUT} required><option value="">Elige…</option><option>Bencina</option><option>Diesel</option><option>Híbrido</option><option>Eléctrico</option></select></Campo>
            <Campo etiqueta="Número de dueños"><input type="number" min="1" max="30" value={f.duenos} onChange={(e) => set("duenos", e.target.value)} className={INPUT} placeholder="Ej. 1" required /></Campo>
            <Campo etiqueta="¿Tiene prenda?"><select value={f.prenda} onChange={(e) => set("prenda", e.target.value)} className={INPUT} required><option value="">Elige…</option><option value="si">Sí</option><option value="no">No</option></select></Campo>
            <Campo etiqueta="¿Mantenciones en la marca?"><select value={f.mantenciones} onChange={(e) => set("mantenciones", e.target.value)} className={INPUT} required><option value="">Elige…</option><option value="si">Sí</option><option value="no">No</option></select></Campo>
            <Campo etiqueta="Precio esperado ($)"><InputDinero value={f.precioEsperado} onChange={(e) => set("precioEsperado", e.target.value)} className={INPUT} placeholder="Ej. 8.500.000" required /></Campo>
          </div>
          {tipo === "vender" && locales.length > 1 && <Campo etiqueta="¿En qué sucursal te atendemos?"><select value={f.localId} onChange={(e) => set("localId", e.target.value)} className={INPUT} required><option value="">Elige…</option>{locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></Campo>}
        </>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Campo etiqueta="Tu nombre"><input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} autoComplete="name" required /></Campo>
        <Campo clase="md:col-span-2" etiqueta="Teléfono" ayuda={f.codigoPais === "56" ? "Chile: 9 dígitos, por ejemplo 9 1234 5678." : "Escribe el número sin el código de área."}>
          <div className="flex flex-col sm:flex-row gap-2 min-w-0">
            <select value={f.codigoPais} onChange={(e) => set("codigoPais", e.target.value)} className={`${INPUT} sm:!w-[12rem] sm:shrink-0`} aria-label="Código de área del país" required>
              {PAISES.map((pa) => <option key={pa.id} value={pa.codigo}>{pa.nombre} (+{pa.codigo})</option>)}
            </select>
            <input type="tel" value={f.telefono} onChange={(e) => set("telefono", e.target.value)} className={`${INPUT} sm:flex-1 min-w-0 !text-base !py-3 tracking-wide`} autoComplete="tel-national" inputMode="tel" placeholder={f.codigoPais === "56" ? "9 1234 5678" : "Número"} required />
          </div>
        </Campo>
      </div>
      <Campo etiqueta={tipo === "vender" || tipo === "renovar" ? "Correo" : "Correo (opcional)"}><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} className={INPUT} autoComplete="email" required={tipo === "vender" || tipo === "renovar"} /></Campo>
      {tipo === "visita" && <Campo etiqueta="¿Cuándo te acomoda venir?" ayuda="Es una preferencia: te confirmaremos el horario."><input type="datetime-local" value={f.fechaHora} onChange={(e) => set("fechaHora", e.target.value)} className={INPUT} required /></Campo>}
      {tipo === "financiamiento" && (
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Pie que puedes dar ($)" ayuda="Si no tienes, escribe 0."><InputDinero value={f.pie} onChange={(e) => set("pie", e.target.value)} className={INPUT} required /></Campo>
          <Campo etiqueta="Plazo"><select value={f.plazo} onChange={(e) => set("plazo", e.target.value)} className={INPUT}>{PLAZOS_FINANCIAMIENTO.map((p) => <option key={p} value={p}>{p} cuotas</option>)}</select></Campo>
        </div>
      )}
      <Campo etiqueta={tipo === "consulta" ? "Tu consulta" : tipo === "vender" || tipo === "renovar" ? "Comentarios sobre tu auto (opcional)" : "Algo que quieras contarnos (opcional)"}><textarea rows={3} maxLength={500} value={f.mensaje} onChange={(e) => set("mensaje", e.target.value)} className={INPUT} /></Campo>

      {/* Campo trampa: está fuera de la pantalla; las personas no lo ven, los robots lo llenan. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>No llenar este campo<input tabIndex={-1} autoComplete="off" value={f.web} onChange={(e) => set("web", e.target.value)} /></label>
      </div>

      <label className="flex items-start gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={f.acepta} onChange={(e) => set("acepta", e.target.checked)} className="mt-1" required />
        <span>Acepto que {(empresa && empresa.nombre) || "la empresa"} use mis datos para contactarme por esta solicitud. <button type="button" onClick={() => setVerPrivacidad(!verPrivacidad)} className="underline text-stone-600">Ver cómo usamos tus datos</button></span>
      </label>
      {verPrivacidad && (
        <p className="text-xs text-stone-600 bg-stone-100 p-3">
          Usamos tu nombre, teléfono, correo y lo que nos cuentes solo para responder esta solicitud y contactarte sobre ella. No los vendemos ni los compartimos con terceros ajenos a la operación (por ejemplo, la financiera, si tú pides financiamiento). Puedes pedirnos ver, corregir o borrar tus datos escribiéndonos por WhatsApp o en el local.
        </p>
      )}
      {estado.error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={estado.enviando} className={BTN}>{estado.enviando ? "Enviando…" : tipo === "visita" ? "Pedir visita" : tipo === "financiamiento" ? "Calcular mi cuota" : tipo === "vender" || tipo === "renovar" ? "Enviar" : "Enviar consulta"}</button>
        <button type="button" onClick={onCerrar} className={BTN_2}>Cancelar</button>
      </div>
    </form>
  );
}

function Ventana({ titulo, onCerrar, children }) {
  useEffect(() => {
    const f = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-40 bg-stone-900/60 flex items-end md:items-center justify-center overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="bg-white w-full md:max-w-2xl max-h-screen overflow-y-auto p-5 md:p-6 flex flex-col gap-4 relative rounded-t-2xl md:rounded-2xl shadow-elevada" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="flex items-start justify-between gap-3"><h2 className="font-serif text-xl text-stone-900">{titulo}</h2><button onClick={onCerrar} className="text-stone-500 hover:text-stone-900 px-2" aria-label="Cerrar">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/* =========================================================
   CATÁLOGO
========================================================= */
function Tarjeta({ v, ir }) {
  return (
    <a href={`/vehiculo/${v.id}`} onClick={(e) => { e.preventDefault(); ir(`/vehiculo/${v.id}`); }} className="group bg-white border border-stone-200 rounded-2xl overflow-hidden hover:border-amber-400 hover:shadow-elevada hover:-translate-y-0.5 transition-all flex flex-col">
      <div className="relative overflow-hidden">
        <Foto vehiculoId={v.id} fotoId={v.fotos[0]} alt={`${nombreVeh(v)} ${v.anio}`} className="aspect-[4/3] group-hover:scale-[1.03] transition-transform duration-300" />
        {v.reservado && <span className="absolute top-3 left-3 bg-stone-900/90 text-white text-xs font-medium px-2.5 py-1 rounded-full">Reservado</span>}
      </div>
      <div className="p-4 flex flex-col gap-1">
        <h3 className="font-serif text-lg text-stone-900 leading-tight">{nombreVeh(v)}</h3>
        <p className="text-sm text-stone-600">{v.anio} · {km(v.km)}{v.transmision ? ` · ${v.transmision}` : ""}</p>
        <p className="text-xl font-bold tabular-nums text-stone-900 mt-2">{clp(v.precio)}</p>
      </div>
    </a>
  );
}

function Catalogo({ datos, ir }) {
  const [q, setQ] = useState("");
  const [marca, setMarca] = useState("");
  const [trans, setTrans] = useState("");
  const [tope, setTope] = useState("");
  const [orden, setOrden] = useState("nuevos");
  const marcas = useMemo(() => Array.from(new Set(datos.vehiculos.map((v) => v.marca))).sort(), [datos]);
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = datos.vehiculos.filter((v) => (!marca || v.marca === marca) && (!trans || v.transmision === trans) && (!tope || v.precio <= Number(tope)) && (!t || `${v.marca} ${v.modelo} ${v.version || ""} ${v.anio}`.toLowerCase().includes(t)));
    if (orden === "precio_asc") l.sort((a, b) => a.precio - b.precio);
    if (orden === "precio_desc") l.sort((a, b) => b.precio - a.precio);
    if (orden === "anio") l.sort((a, b) => b.anio - a.anio);
    if (orden === "km") l.sort((a, b) => a.km - b.km);
    return l;
  }, [datos, q, marca, trans, tope, orden]);
  return (
    <>
      <section className="bg-stone-900 text-stone-100">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14">
          <h1 className="font-serif text-3xl md:text-5xl leading-tight max-w-2xl">Tu próximo auto, con respaldo y financiamiento a tu medida</h1>
          <p className="text-stone-300 mt-3 max-w-xl text-sm md:text-base">Vehículos revisados e inspeccionados. Consulta, agenda una visita o cotiza tu cuota en minutos.</p>
          <div className="flex flex-wrap gap-2 mt-6"><a href="/vender" onClick={(e) => { e.preventDefault(); ir("/vender"); }} className={BTN}>Vende o consigna tu auto</a></div>
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-5">
        <div className="bg-white border border-stone-200 p-3 md:p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar marca o modelo" className={`${INPUT} col-span-2`} aria-label="Buscar" />
          <select value={marca} onChange={(e) => setMarca(e.target.value)} className={INPUT} aria-label="Marca"><option value="">Todas las marcas</option>{marcas.map((m) => <option key={m}>{m}</option>)}</select>
          <select value={trans} onChange={(e) => setTrans(e.target.value)} className={INPUT} aria-label="Transmisión"><option value="">Cualquier transmisión</option><option>Automática</option><option>Mecánica</option></select>
          <InputDinero value={tope} onChange={(e) => setTope(e.target.value)} placeholder="Precio máximo" className={INPUT} aria-label="Precio máximo" />
          <select value={orden} onChange={(e) => setOrden(e.target.value)} className={INPUT} aria-label="Ordenar"><option value="nuevos">Más recientes</option><option value="precio_asc">Menor precio</option><option value="precio_desc">Mayor precio</option><option value="anio">Año más nuevo</option><option value="km">Menor kilometraje</option></select>
        </div>
        <p className="text-sm text-stone-600">{lista.length} vehículo{lista.length === 1 ? "" : "s"}</p>
        {lista.length === 0 ? (
          <div className="bg-white border border-stone-200 p-10 text-center text-stone-600">{datos.vehiculos.length === 0 ? "Pronto tendremos nuevos vehículos. Escríbenos y te avisamos." : "No hay vehículos con esos filtros. Prueba quitando alguno."}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">{lista.map((v) => <Tarjeta key={v.id} v={v} ir={ir} />)}</div>
        )}
      </section>
    </>
  );
}

/* =========================================================
   DETALLE
========================================================= */
function Detalle({ id, ir, locales }) {
  const [estado, setEstado] = useState({ cargando: true, error: "", datos: null });
  const [foto, setFoto] = useState(0);
  const [form, setForm] = useState(null);
  useEffect(() => {
    let vivo = true;
    setEstado({ cargando: true, error: "", datos: null });
    llamar("vehiculo", { id }).then((d) => { if (vivo) { setEstado({ cargando: false, error: "", datos: d }); document.title = `${nombreVeh(d.vehiculo)} ${d.vehiculo.anio} · ${(d.empresa && d.empresa.nombre) || "Drive Futuro"}`; } })
      .catch((e) => vivo && setEstado({ cargando: false, error: e.status === 404 ? "Este vehículo ya no está disponible." : textoError(e), datos: null }));
    return () => { vivo = false; };
  }, [id]);
  if (estado.cargando) return <p className="max-w-6xl mx-auto px-4 py-10 text-stone-600">Cargando…</p>;
  if (estado.error) return (
    <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col gap-4 items-start">
      <p className="text-stone-800">{estado.error}</p>
      <a href="/" onClick={(e) => { e.preventDefault(); ir("/"); }} className={BTN}>Ver todos los vehículos</a>
    </div>
  );
  const { vehiculo: v, local, empresa } = estado.datos;
  const wa = empresa && empresa.whatsapp ? `https://wa.me/${empresa.whatsapp}?text=${encodeURIComponent(`Hola, me interesa el ${nombreVeh(v)} ${v.anio} (${clp(v.precio)}) que vi en la web.`)}` : "";
  const datosTecnicos = [["Año", v.anio], ["Kilometraje", km(v.km)], ["Transmisión", v.transmision], ["Combustible", v.combustible], ["Color", v.color]].filter(([, x]) => x);
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-6">
      <a href="/" onClick={(e) => { e.preventDefault(); ir("/"); }} className="text-sm text-stone-600 hover:underline">← Volver a los vehículos</a>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 flex flex-col gap-3">
          <div className="relative"><Foto key={v.fotos[foto]} vehiculoId={v.id} fotoId={v.fotos[foto]} alt={`${nombreVeh(v)} ${v.anio}`} className="aspect-[4/3]" />{v.reservado && <span className="absolute top-3 left-3 bg-stone-900 text-white text-sm px-3 py-1">Reservado</span>}</div>
          {v.fotos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">{v.fotos.map((f, i) => (
              <button key={f} onClick={() => setFoto(i)} className={`shrink-0 w-20 h-16 border-2 ${i === foto ? "border-amber-500" : "border-transparent"}`} aria-label={`Foto ${i + 1}`}><Foto vehiculoId={v.id} fotoId={f} className="w-full h-full" /></button>
            ))}</div>
          )}
        </div>
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl text-stone-900 leading-tight">{nombreVeh(v)} {v.anio}</h1>
            <p className="font-bold tabular-nums text-3xl text-stone-900 mt-2">{clp(v.precio)}</p>
            {v.reservado && <p className="text-sm text-stone-600 mt-1">Este vehículo está reservado. Puedes consultar por si la venta no se concreta.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => setForm("consulta")} className={BTN}>Consultar por este auto</button>
            <button onClick={() => setForm("visita")} className={BTN_2}>Agendar visita o test drive</button>
            <button onClick={() => setForm("financiamiento")} className={BTN_2}>Cotizar financiamiento</button>
            <button onClick={() => setForm("renovar")} className={BTN_2}>Cambiar mi auto por este</button>
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="px-5 py-3 text-sm text-center bg-emerald-600 text-white hover:bg-emerald-500">Escribir por WhatsApp</a>}
          </div>
          <dl className="bg-white border border-stone-200 divide-y divide-stone-100 text-sm">{datosTecnicos.map(([k, x]) => (<div key={k} className="flex justify-between px-4 py-2.5"><dt className="text-stone-500">{k}</dt><dd className="text-stone-900">{x}</dd></div>))}</dl>
          {local && <p className="text-sm text-stone-600">Lo puedes ver en <strong>{local.nombre}</strong>{local.direccion ? ` · ${local.direccion}` : ""}.</p>}
        </div>
      </div>
      <section className="bg-white border border-stone-200 p-5"><h2 className="font-serif text-lg mb-2">Descripción</h2><p className="text-sm text-stone-700 whitespace-pre-line">{v.descripcion}</p></section>
      {form && <Ventana titulo={TITULOS[form]} onCerrar={() => setForm(null)}><Formulario tipo={form} vehiculo={v} locales={locales} empresa={empresa} onCerrar={() => setForm(null)} /></Ventana>}
    </div>
  );
}

function Vender({ locales, empresa, ir }) {
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-8 flex flex-col gap-5">
      <div><h1 className="font-serif text-3xl text-stone-900">Vende o consigna tu auto</h1><p className="text-stone-600 text-sm mt-2">Cuéntanos de tu vehículo y un ejecutivo te contactará con una tasación. Sin compromiso.</p></div>
      <div className="bg-white border border-stone-200 p-5"><Formulario tipo="vender" locales={locales} empresa={empresa} onCerrar={() => ir("/")} /></div>
    </div>
  );
}

/* =========================================================
   SITIO
========================================================= */
export default function SitioPublico() {
  const [ruta, ir] = useRuta();
  const [estado, setEstado] = useState({ cargando: true, error: "", datos: null });
  useEffect(() => {
    document.title = "Vehículos · Drive Futuro";
    let vivo = true;
    llamar("catalogo").then((d) => { if (vivo) { setEstado({ cargando: false, error: "", datos: d }); document.title = `Vehículos usados · ${(d.empresa && d.empresa.nombre) || "Drive Futuro"}`; } })
      .catch((e) => vivo && setEstado({ cargando: false, error: e.message === "sin_servidor" ? "El sitio todavía no está conectado al servidor." : textoError(e), datos: null }));
    return () => { vivo = false; };
  }, []);
  const empresa = estado.datos ? estado.datos.empresa : null;
  const locales = estado.datos ? estado.datos.locales : [];
  const m = ruta.match(/^\/vehiculo\/([A-Za-z0-9-]{10,60})\/?$/);
  return (
    <Marco empresa={empresa} ir={ir}>
      {ruta.replace(/\/$/, "") === "/vender" ? <Vender locales={locales} empresa={empresa} ir={ir} />
        : m ? <Detalle id={m[1]} ir={ir} locales={locales} />
        : estado.cargando ? <p className="max-w-6xl mx-auto px-4 py-10 text-stone-600">Cargando vehículos…</p>
        : estado.error ? <p className="max-w-6xl mx-auto px-4 py-10 text-stone-700">{estado.error}</p>
        : <Catalogo datos={estado.datos} ir={ir} />}
    </Marco>
  );
}
