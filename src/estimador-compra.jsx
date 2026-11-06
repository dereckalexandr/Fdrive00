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
  // Pegar los datos de una ficha es pedir expresamente ese vehículo: la patente de la ficha SIEMPRE reemplaza a la escrita.
  // Si es otra patente, se parte de cero con ese vehículo (kilometraje, versión, transmisión, combustible y avisos eran del anterior).
  const cambiarPatente = (nueva) => {
    if (!nueva || nueva === patente) return false;
    const habia = !!patente;
    setPatente(nueva);
    setKm(""); setVersion(""); setTransmision(""); setCombustible(""); setPegado(""); setMsgAvisos(null); setResultadoUsado(false);
    return habia;
  };
  const aplicarDatosPatente = (texto) => {
    setPegadoPatente(texto);
    if (!texto.trim()) { setMsgPatente(null); return; }
    const p = parseDatosPatente(texto);
    if (!p.ok) { setMsgPatente({ mal: true, texto: p.error, etiquetas: p.etiquetas || [] }); return; }
    const d = p.data;
    setPegadoPatente("");
    const reemplazo = cambiarPatente(d.patente);
    const aviso = reemplazo ? "Era otra patente: se reemplazó y se limpiaron kilometraje, versión, transmisión, combustible y avisos del vehículo anterior." : "";
    if (p.soloPatente) {
      setMsgPatente({ mal: false, texto: `Patente ${d.patente} anotada. Pulsa «Buscar datos» para completar marca, modelo y año.`, avisos: aviso ? [aviso] : [] });
      return;
    }
    setMarca(titleCase(d.marca)); setModelo(titleCase(d.modelo)); setAnio(String(d.anio));
    setMsgPatente({ mal: false, texto: `Se completaron patente ${d.patente || ""}, marca, modelo y año.`, avisos: aviso ? [aviso] : [] });
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
