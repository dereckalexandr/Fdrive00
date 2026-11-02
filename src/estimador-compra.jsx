/**
 * ESTIMADOR DE COMPRA
 * ----------------------------------------------------------------
 * Estima cuánto pagar por un vehículo con los avisos de Chileautos. Lo usan el CRM (App.jsx) y el sitio de inspecciones.
 * `apiPatente` (opcional): cómo consulta «Buscar datos» (Boostr). En el CRM usa la sesión del personal; el sitio público pasa la acción pública.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { normalizePatente, isPatenteValida, parseKm, calcularFiltros, buildChileautosUrl, parseAvisosPegados, estimarCompra, parseDatosPatente, modeloParaChileautos, detalleModeloChileautos, detalleMarcaChileautos, TRANSMISIONES, COMBUSTIBLES, MARGENES_BRUTOS, MARGEN_BRUTO_DEFECTO } from "./compra-calc.js";
import { buildBookmarkletHref } from "./chileautos-bookmarklet.js";
import { buildPatenteBookmarkletHref } from "./patente-bookmarklet.js";
import { BuscarPatente } from "./crm-ui.jsx";

const clp = (n) =>
  (n || 0).toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function TextField({ label, value, onChange, placeholder = "" }) {
  return (
    <div>
      <label className="text-xs text-stone-500 block mb-1">{label}</label>
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
    </div>
  );
}

const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());

// `inicial` (opcional): datos del vehículo con que parte, cuando se usa dentro de una tasación del CRM.
// `onResultado` (opcional): si viene, aparece el botón para guardar el resultado en esa tasación.
export default function TasacionCompra({ inicial, onResultado, apiPatente } = {}) {
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
  const datosOk = !!(marca.trim() && modelo.trim() && parseKm(anio));
  const urlBusqueda = datosOk ? buildChileautosUrl({ marca, modelo, anio, km: kmNum, margenAnio, transmision, combustible }) : null;
  const { busqueda: modeloBusqueda, omitido: modeloOmitido } = detalleModeloChileautos(modelo);
  const { busqueda: marcaBusqueda, omitido: marcaOmitida } = detalleMarcaChileautos(marca);
  const transLabel = (TRANSMISIONES.find((t) => t.value === transmision) || {}).label;
  const combLabel = (COMBUSTIBLES.find((c) => c.value === combustible) || {}).label;

  const faltantes = [];
  if (patente && !patenteOk) faltantes.push("patente válida (ej. TTHY51)");
  if (!kmNum) faltantes.push("kilometraje");
  if (!marca.trim()) faltantes.push("marca");
  if (!modelo.trim()) faltantes.push("modelo");
  if (!parseKm(anio)) faltantes.push("año");

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
    if (p.soloPatente) {
      setPegadoPatente("");
      if (!patente) { setPatente(d.patente); setMsgPatente({ mal: false, texto: `Patente ${d.patente} anotada. Pulsa «Buscar datos» para completar marca, modelo y año.`, avisos: [] }); }
      else setMsgPatente({ mal: false, texto: "Ya hay una patente escrita; no se cambió.", avisos: [] });
      return;
    }
    setPegadoPatente("");
    setMarca(titleCase(d.marca)); setModelo(titleCase(d.modelo)); setAnio(String(d.anio));
    const avisos = [];
    if (d.patente && !patente) setPatente(d.patente);
    else if (d.patente && d.patente !== patente) avisos.push(`La patente de la ficha (${d.patente}) no coincide con la que ingresaste (${patente}). Revisa que sea el vehículo correcto.`);
    setMsgPatente({ mal: false, texto: `Se completaron marca, modelo y año${d.patente && !patente ? " y la patente" : ""}.`, avisos });
  };
  const [msgAvisos, setMsgAvisos] = useState(null);
  const leerPortapapeles = async () => {
    try { return await navigator.clipboard.readText(); } catch (e) { return null; }
  };
  const pegarPatente = async () => {
    const t = await leerPortapapeles();
    if (t === null) { setMsgPatente({ mal: true, texto: "El navegador no dejó leer el portapapeles. Pega con Ctrl+V en el cuadro de abajo.", avisos: [] }); return; }
    if (!t.trim()) { setMsgPatente({ mal: true, texto: "El portapapeles está vacío. Pulsa primero el favorito en patentechile.com (o copia el texto de la ficha).", avisos: [] }); return; }
    aplicarDatosPatente(t);
  };
  const aplicarAvisos = (t) => {
    setPegado(t);
    setMsgAvisos(null);
  };
  const pegarAvisos = async () => {
    const t = await leerPortapapeles();
    if (t === null) { setMsgAvisos({ mal: true, texto: "El navegador no dejó leer el portapapeles. Pega con Ctrl+V en el cuadro de abajo." }); return; }
    if (!t.trim()) { setMsgAvisos({ mal: true, texto: "El portapapeles está vacío. Pulsa primero el favorito en la página de Chileautos." }); return; }
    aplicarAvisos(t);
  };
  // Al volver a esta pestaña desde patentechile.com o Chileautos, si el portapapeles trae lo que copia el favorito, se pega solo.
  const accionesRef = useRef({});
  accionesRef.current = { aplicarDatosPatente, aplicarAvisos };
  const ultimoAuto = useRef("");
  useEffect(() => {
    const alVolver = async () => {
      const t = await leerPortapapeles();
      if (!t || t === ultimoAuto.current) return;
      if (/^\s*\{\s*"fuente"\s*:\s*"patentechile"/.test(t)) { ultimoAuto.current = t; accionesRef.current.aplicarDatosPatente(t); }
      else if (/^\s*\{\s*"fuente"\s*:\s*"chileautos"/.test(t)) { ultimoAuto.current = t; accionesRef.current.aplicarAvisos(t); }
    };
    window.addEventListener("focus", alVolver);
    return () => window.removeEventListener("focus", alVolver);
  }, []);
  const limpiar = () => { setPegadoPatente(""); setMsgPatente(null); setPatente(""); setKm(""); setMarca(""); setModelo(""); setAnio(""); setVersion(""); setTransmision(""); setCombustible(""); setMargenBruto(MARGEN_BRUTO_DEFECTO); setPegado(""); setMsgAvisos(null); };

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Patente *</label>
            <input type="text" value={patente} onChange={(e) => setPatente(normalizePatente(e.target.value))} placeholder="Ej. TTHY51" maxLength={6}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-500" />
            {patente.length === 6 && !patenteOk && <p className="text-xs text-rose-600 mt-1">Formato no válido (4 letras y 2 números, o 2 letras y 4 números).</p>}
            <BuscarPatente patente={patente} api={apiPatente} className="mt-1.5" onDatos={(c) => {
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
        </div>

        <details className="mt-4 border border-stone-200 p-3" open>
          <summary className="cursor-pointer text-sm text-stone-700 font-medium">O completar marca, modelo y año con patentechile.com</summary>
          <div className="mt-2">
          <p className="text-xs text-stone-500 mb-2">
            Entra al sitio y busca la patente a mano. Con la ficha abierta, pulsa el favorito (o selecciona todo el texto con Ctrl+A y cópialo con Ctrl+C), vuelve aquí y pulsa «Pegar datos»: también se pegan solos al volver a esta pestaña.
            De lo pegado solo se leen patente, marca, modelo y año: nunca nombre, RUT ni dirección del dueño. El sitio puede pedir una verificación de seguridad: la completas tú.
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
          <div className="mb-2">
            <button type="button" onClick={pegarPatente} className="bg-amber-500 text-stone-900 font-semibold px-4 py-2 text-sm hover:bg-amber-400">📋 Pegar datos de patente</button>
          </div>
          <details className="mb-1"><summary className="cursor-pointer text-xs text-stone-500">¿No funciona el botón? Pega a mano</summary>
          <textarea value={pegadoPatente} onChange={(e) => aplicarDatosPatente(e.target.value)} rows={2} placeholder="Pega aquí lo que copió el favorito, el texto de la ficha (Ctrl+A, Ctrl+C en patentechile) o la patente (Ctrl+V)"
            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </details>
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
        </details>

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
        <div className="max-w-xs mb-3">
          <label className="text-xs text-stone-500 block mb-1">Búsqueda por año</label>
          <select value={margenAnio} onChange={(e) => setMargenAnio(Number(e.target.value))}
            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value={1}>Año del vehículo ±1</option>
            <option value={0}>Solo el año exacto</option>
          </select>
        </div>
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
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button type="button" onClick={pegarAvisos} className="bg-amber-500 text-stone-900 font-semibold px-4 py-2 text-sm hover:bg-amber-400">📋 Pegar avisos de Chileautos</button>
          <span className="text-xs text-stone-500">{pegado.trim() ? "Avisos pegados ✓" : "Después de pulsar el favorito en Chileautos, vuelve aquí: se pegan solos o pulsa el botón."}</span>
        </div>
        {msgAvisos && <p className={"text-xs mb-2 " + (msgAvisos.mal ? "text-rose-600" : "text-emerald-700")}>{msgAvisos.texto}</p>}
        <details className="mb-1"><summary className="cursor-pointer text-xs text-stone-500">¿No funciona el botón? Pega a mano</summary>
        <textarea value={pegado} onChange={(e) => setPegado(e.target.value)} rows={3} placeholder="Pega aquí lo que copió el marcador (Ctrl+V)"
          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </details>
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
  const eliminar = async (f) => {
    const que = f.tipo === "inspeccion" ? "esta inspección" : "esta tasación del Inspector";
    const quien = [f.data.marca, f.data.modelo, f.data.vehiculo].filter(Boolean).join(" ") + " " + (f.data.inscripcion || f.data.patente || "");
    if (!window.confirm("¿Eliminar " + que + " (" + quien.trim() + ")? Se borran la ficha y sus fotos y no se puede deshacer.")) return;
    setMsg("");
    try {
      await window.auth.ventas("inspecciones.ficha_eliminar", { key: f.key });
      setEstado((x) => ({ ...x, inspecciones: x.inspecciones.filter((v) => v.key !== f.key), valorizaciones: x.valorizaciones.filter((v) => v.key !== f.key) }));
      setAbierto(null);
      setMsg("Eliminada. Quedó registrado con tu nombre.");
    } catch (e) { setMsg(mensajeCrm(e)); }
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
          <button onClick={() => eliminar(abierto)} className="text-sm text-rose-700 hover:underline py-1.5 ml-auto">{abierto.tipo === "inspeccion" ? "Eliminar la inspección" : "Eliminar la tasación"}</button>
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
                <th className="py-2 pr-2">Propietario</th>{vista === "valorizaciones" && <th className="py-2 pr-2 text-right">Valor comercial</th>}<th className="py-2 pr-2 w-24"></th>
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
                  <td className="py-2 pr-2 text-right whitespace-nowrap"><button onClick={() => abrir(f)} className="text-xs text-amber-700 hover:underline">Ver</button><button onClick={() => eliminar(f)} className="text-xs text-rose-700 hover:underline ml-3">Eliminar</button></td>
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
