/**
 * Generación de leads · Prospección en Chileautos.
 *
 * 1) Se definen los filtros y el CRM arma la búsqueda en Chileautos (se abre en otra pestaña, con TU navegador).
 * 2) El marcador copia los avisos de esa página y se pegan aquí: se muestran en una lista que se puede filtrar y ordenar
 *    (precio, año, kilometraje, tipo de vendedor, «más barato que el promedio»).
 * 3) Los que interesan se guardan como prospectos. Se contacta al dueño por «Contactar vendedor» de Chileautos y, cuando
 *    responde y entrega sus datos, el prospecto se convierte en un lead de compra.
 * El CRM no consulta Chileautos (bloquea los servidores). Se guarda el teléfono / WhatsApp y el nombre públicos del aviso si el marcador los alcanza a leer, y se pueden anotar a mano.
 */
import React, { useState, useMemo, useRef, useEffect } from "react";
import { INPUT, BTN, BTN_PRIMARIO, Aviso, Cargando, Tarjeta, Campo, Modal, useCarga, mensajeError, clp, hace } from "./crm-ui.jsx";
import { urlBusquedaProspeccion } from "./prospeccion-url.js";
import { buildBookmarkletHref, buildBookmarkletFichaHref } from "./chileautos-bookmarklet.js";
import { parseAvisosPegados, TRANSMISIONES, COMBUSTIBLES } from "./compra-calc.js";
import {
  filtrarAvisos, ORDENES_PROSPECTO, ESTADOS_PROSPECTO, estadoProspectoNombre, marcaModeloDeTitulo, vehiculoOfrecidoDeProspecto,
  notasLeadDeProspecto, FUENTE_LEAD_CHILEAUTOS, enlaceWhatsappProspecto, parseFichaPegada,
} from "../supabase/functions/api/prospectos-core.js";

const CHICO = "border border-stone-300 bg-white px-2 py-1 text-sm";
const ENLACE = (href) => `https://www.chileautos.cl${href}`;

function Etiqueta({ vendedor, nombre }) {
  if (vendedor === "particular") return <span className="text-[11px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800">Particular</span>;
  if (vendedor === "automotora") return <span className="text-[11px] px-1.5 py-0.5 bg-stone-200 text-stone-700" title={nombre || ""}>Automotora</span>;
  return <span className="text-[11px] text-stone-400">—</span>;
}
function Diferencia({ pct }) {
  if (!pct) return <span className="text-stone-400">—</span>;
  return <span className={pct <= -10 ? "text-emerald-700 font-semibold" : pct >= 10 ? "text-rose-600" : "text-stone-600"} title="Frente a la mediana de los avisos de esta lista">{pct > 0 ? "+" : ""}{pct}%</span>;
}

/* ---------- 1 · Buscar en Chileautos y ver los avisos ---------- */
function Buscar({ api, guardados, onGuardado }) {
  const [f, setF] = useState({ marca: "", modelo: "", anioDesde: "", anioHasta: "", kmMax: "", transmision: "", combustible: "" });
  const [pegado, setPegado] = useState("");
  const [g, setG] = useState({ texto: "", precioMin: "", precioMax: "", vendedor: "particular", sinDestacados: false, orden: "bajo_mediana" });
  const [sel, setSel] = useState(() => new Set());
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const bmRef = useRef(null);
  useEffect(() => { if (bmRef.current) bmRef.current.setAttribute("href", buildBookmarkletHref()); }, []);

  const busqueda = useMemo(() => urlBusquedaProspeccion(f), [f]);
  const leido = useMemo(() => (pegado.trim() ? parseAvisosPegados(pegado) : null), [pegado]);
  const avisos = leido && leido.ok ? leido.data.listings : [];
  const lista = useMemo(() => filtrarAvisos(avisos, g), [avisos, g]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setFiltro = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const elegibles = lista.filter((a) => !guardados.has(a.id));
  const seleccionados = lista.filter((a) => sel.has(a.id) && !guardados.has(a.id));

  const copiarMarcador = async () => { try { await navigator.clipboard.writeText(buildBookmarkletHref()); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch (e) { /* sin permiso: queda el botón arrastrable */ } };
  const alternar = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todos = () => setSel((s) => (elegibles.every((a) => s.has(a.id)) ? new Set() : new Set(elegibles.map((a) => a.id))));
  const guardar = async () => {
    setMsg(null); setOcupado(true);
    try {
      const r = await api("prospectos.guardar", { avisos: seleccionados });
      setMsg({ ok: true, texto: `${r.nuevos} prospecto${r.nuevos === 1 ? "" : "s"} guardado${r.nuevos === 1 ? "" : "s"}${r.repetidos ? ` (${r.repetidos} ya estaba${r.repetidos === 1 ? "" : "n"})` : ""}. Los encuentras en «Mis prospectos».` });
      setSel(new Set()); onGuardado();
    } catch (e) { setMsg({ ok: false, texto: mensajeError(e) }); }
    setOcupado(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta titulo="1 · Define qué autos buscas" ayuda="El CRM arma la búsqueda en Chileautos con estos filtros y la abre en otra pestaña. Todos son opcionales; mientras más acotes, mejor.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Campo etiqueta="Marca"><input value={f.marca} onChange={(e) => set("marca", e.target.value)} placeholder="Toyota" className={INPUT} /></Campo>
          <Campo etiqueta="Modelo"><input value={f.modelo} onChange={(e) => set("modelo", e.target.value)} placeholder="Yaris" className={INPUT} disabled={!f.marca} /></Campo>
          <Campo etiqueta="Año desde"><input inputMode="numeric" value={f.anioDesde} onChange={(e) => set("anioDesde", e.target.value)} placeholder="2018" className={INPUT} /></Campo>
          <Campo etiqueta="Año hasta"><input inputMode="numeric" value={f.anioHasta} onChange={(e) => set("anioHasta", e.target.value)} placeholder="2023" className={INPUT} /></Campo>
          <Campo etiqueta="Kilometraje máximo"><input inputMode="numeric" value={f.kmMax} onChange={(e) => set("kmMax", e.target.value)} placeholder="80000" className={INPUT} /></Campo>
          <Campo etiqueta="Transmisión"><select value={f.transmision} onChange={(e) => set("transmision", e.target.value)} className={INPUT}><option value="">Cualquiera</option>{TRANSMISIONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Campo>
          <Campo etiqueta="Combustible"><select value={f.combustible} onChange={(e) => set("combustible", e.target.value)} className={INPUT}><option value="">Cualquiera</option>{COMBUSTIBLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Campo>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button type="button" disabled={!busqueda} onClick={() => window.open(busqueda.url, "_blank", "noopener")} className={BTN_PRIMARIO}>Abrir la búsqueda en Chileautos</button>
          {busqueda ? <span className="text-xs text-stone-600">Buscará: {busqueda.resumen}</span> : <span className="text-xs text-stone-500">Escribe al menos un filtro.</span>}
        </div>
        <p className="text-xs text-stone-500 mt-2">El precio y el tipo de vendedor (particular o automotora) se filtran después, en la lista de abajo. Si la página de Chileautos no abre con tus filtros, ajústalos ahí mismo: lo importante es que muestre la lista de resultados.</p>
      </Tarjeta>

      <Tarjeta titulo="2 · Copia los avisos con el marcador" ayuda="Chileautos no permite leer sus avisos desde un servidor, pero tu navegador sí. El marcador copia el aviso (auto, año, km, precio, tipo de vendedor, enlace y el teléfono / WhatsApp si la página lo muestra) y no envía nada a ningún servidor.">
        <ol className="text-xs text-stone-600 list-decimal pl-5 flex flex-col gap-1 mb-3">
          <li>Una sola vez: muestra la barra de favoritos (Ctrl+Shift+B) y <strong>arrastra este botón</strong> a ella.</li>
          <li>En la página de resultados de Chileautos, pulsa ese favorito: muestra «N avisos copiados». Si hay varias páginas de resultados, repite en cada una.</li>
          <li>Vuelve aquí y pega abajo (Ctrl+V).</li>
        </ol>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <a ref={bmRef} onClick={(e) => e.preventDefault()} draggable="true" className="inline-block border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 px-3 py-2 text-sm font-medium cursor-grab">⭐ Copiar avisos Chileautos</a>
          <button type="button" onClick={copiarMarcador} className="text-xs text-stone-600 hover:underline py-2">{copiado ? "Código copiado ✓" : "No puedo arrastrarlo: copiar el código del marcador"}</button>
        </div>
        <textarea value={pegado} onChange={(e) => { setPegado(e.target.value); setSel(new Set()); setMsg(null); }} rows={3} placeholder="Pega aquí lo que copió el marcador (Ctrl+V)" className={`${INPUT} font-mono text-xs`} />
        {leido && !leido.ok && <div className="mt-2"><Aviso>{leido.error}</Aviso></div>}
        {leido && leido.ok && leido.data.sinResultados && <div className="mt-2"><Aviso tipo="info">Chileautos no tiene avisos exactos para ese filtro (mostró «parecidos»): esa copia no sirve. Prueba con filtros más amplios.</Aviso></div>}
        {leido && leido.ok && !avisos.length && !leido.data.sinResultados && <div className="mt-2"><Aviso>La página no tenía avisos. Usa el marcador en la lista de resultados.</Aviso></div>}
      </Tarjeta>

      {avisos.length > 0 && (
        <Tarjeta titulo={`3 · Avisos encontrados (${lista.length} de ${avisos.length})`} ayuda="Filtra y ordena. «vs. promedio» compara cada precio con la mediana de los avisos que ves: un número negativo es más barato que el resto.">
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <Campo etiqueta="Vendedor"><select value={g.vendedor} onChange={(e) => setFiltro("vendedor", e.target.value)} className={CHICO}><option value="particular">Solo particulares</option><option value="">Todos</option><option value="automotora">Solo automotoras</option></select></Campo>
            <Campo etiqueta="Buscar en el título"><input value={g.texto} onChange={(e) => setFiltro("texto", e.target.value)} placeholder="SE, 4x4…" className={`${CHICO} w-32`} /></Campo>
            <Campo etiqueta="Precio mínimo"><input inputMode="numeric" value={g.precioMin} onChange={(e) => setFiltro("precioMin", e.target.value)} placeholder="5000000" className={`${CHICO} w-28`} /></Campo>
            <Campo etiqueta="Precio máximo"><input inputMode="numeric" value={g.precioMax} onChange={(e) => setFiltro("precioMax", e.target.value)} placeholder="9000000" className={`${CHICO} w-28`} /></Campo>
            <Campo etiqueta="Orden"><select value={g.orden} onChange={(e) => setFiltro("orden", e.target.value)} className={CHICO}>{ORDENES_PROSPECTO.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></Campo>
            <label className="flex items-center gap-1.5 text-xs text-stone-600 pb-1.5"><input type="checkbox" checked={g.sinDestacados} onChange={(e) => setFiltro("sinDestacados", e.target.checked)} /> Sin avisos pagados</label>
          </div>
          {lista.length === 0 ? <p className="text-sm text-stone-500">Ningún aviso cumple esos filtros.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-stone-500 border-b border-stone-200">
                  <th className="py-1.5 pr-2 w-8"><input type="checkbox" onChange={todos} checked={elegibles.length > 0 && elegibles.every((a) => sel.has(a.id))} aria-label="Elegir todos" /></th>
                  <th className="py-1.5 pr-2">Auto</th><th className="py-1.5 pr-2">Año</th><th className="py-1.5 pr-2 text-right">Km</th><th className="py-1.5 pr-2 text-right">Precio</th><th className="py-1.5 pr-2 text-right">Vs. promedio</th><th className="py-1.5 pr-2">Vendedor</th><th className="py-1.5 pr-2">Teléfono</th>
                </tr></thead>
                <tbody>
                  {lista.map((a) => {
                    const ya = guardados.has(a.id);
                    return (
                      <tr key={a.id} className={`border-b border-stone-100 ${ya ? "bg-stone-50 text-stone-400" : ""}`}>
                        <td className="py-1.5 pr-2"><input type="checkbox" disabled={ya} checked={sel.has(a.id)} onChange={() => alternar(a.id)} aria-label={`Elegir ${a.titulo}`} /></td>
                        <td className="py-1.5 pr-2"><a href={ENLACE(a.href)} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">{a.titulo}</a>{a.version && <span className="block text-[11px] text-stone-500">{a.version}</span>}
                          <span className="text-[11px] text-stone-500">{[a.transmision, a.combustible].filter(Boolean).join(" · ")}{a.destacado ? " · aviso pagado" : ""}{ya ? " · ya guardado" : ""}</span></td>
                        <td className="py-1.5 pr-2 font-mono">{a.anio || "—"}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{a.km ? a.km.toLocaleString("es-CL") : "—"}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{clp(a.precio)}</td>
                        <td className="py-1.5 pr-2 text-right font-mono"><Diferencia pct={a.vsMediana} /></td>
                        <td className="py-1.5 pr-2"><Etiqueta vendedor={a.vendedorTipo} nombre={a.vendedorNombre} /></td>
                        <td className="py-1.5 pr-2 font-mono text-xs">{a.telefono ? a.telefono : <span className="text-stone-300">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button type="button" disabled={ocupado || seleccionados.length === 0} onClick={guardar} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : `Guardar ${seleccionados.length || ""} como prospecto${seleccionados.length === 1 ? "" : "s"}`}</button>
            {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</span>}
          </div>
        </Tarjeta>
      )}
    </div>
  );
}

/* ---------- Convertir un prospecto en lead de compra ---------- */
function Convertir({ api, p, onCerrar, onListo }) {
  const sugerido = marcaModeloDeTitulo(p.titulo);
  const [f, setF] = useState({ nombre: p.vendedor_nombre || "", telefono: p.vendedor_telefono || "", email: "", patente: "", marca: sugerido.marca, modelo: sugerido.modelo });
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const crear = async () => {
    setMsg(""); setOcupado(true);
    try {
      const r = await api("leads.create", {
        cliente: { nombre: f.nombre, telefono: f.telefono, email: f.email },
        lead: { tipo: "compra", fuente: FUENTE_LEAD_CHILEAUTOS, notas: notasLeadDeProspecto(p), vehiculoOfrecido: vehiculoOfrecidoDeProspecto(p, f) },
      });
      await api("prospectos.convertido", { id: p.id, leadId: r.lead.id });
      onListo(r.lead);
    } catch (e) { setMsg(mensajeError(e)); setOcupado(false); }
  };
  return (
    <Modal titulo="Convertir en lead de compra" onCerrar={onCerrar}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-stone-600">Hazlo cuando el dueño respondió por Chileautos y te dio sus datos. <b>{p.titulo}</b> · {p.anio || "—"} · {clp(p.precio)}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo etiqueta="Nombre del dueño" ayuda={p.vendedor_telefono ? "Traído del aviso: confírmalo con el dueño." : undefined}><input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} /></Campo>
          <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} placeholder="9 1234 5678" className={INPUT} /></Campo>
          <Campo etiqueta="Correo (opcional)"><input value={f.email} onChange={(e) => set("email", e.target.value)} className={INPUT} /></Campo>
          <Campo etiqueta="Patente del auto" ayuda="El aviso no la trae: pídesela al dueño."><input value={f.patente} onChange={(e) => set("patente", e.target.value.toUpperCase())} placeholder="ABCD12" className={`${INPUT} font-mono`} /></Campo>
          <Campo etiqueta="Marca"><input value={f.marca} onChange={(e) => set("marca", e.target.value)} className={INPUT} /></Campo>
          <Campo etiqueta="Modelo"><input value={f.modelo} onChange={(e) => set("modelo", e.target.value)} className={INPUT} /></Campo>
        </div>
        <p className="text-xs text-stone-500">Se crea un lead de <b>compra</b> (fuente «{FUENTE_LEAD_CHILEAUTOS}») con el auto y el precio publicado, y se asigna según las reglas de siempre.</p>
        <div className="flex items-center gap-3">
          <button type="button" disabled={ocupado} onClick={crear} className={BTN_PRIMARIO}>{ocupado ? "Creando…" : "Crear el lead"}</button>
          <button type="button" onClick={onCerrar} className={BTN}>Cancelar</button>
          {msg && <span className="text-xs text-rose-600">{msg}</span>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- 2 · Los prospectos guardados ---------- */
function Telefono({ p, cambiarContacto }) {
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState(p.vendedor_telefono || "");
  const wa = enlaceWhatsappProspecto(p);
  if (editando) {
    return (
      <span className="flex items-center gap-1">
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="9 1234 5678" className={`${CHICO} w-36 font-mono`} />
        <button type="button" className={BTN} onClick={async () => { await cambiarContacto(p, { telefono: v }); setEditando(false); }}>Guardar</button>
        <button type="button" className="text-xs text-stone-500 hover:underline" onClick={() => { setV(p.vendedor_telefono || ""); setEditando(false); }}>Cancelar</button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      {p.vendedor_telefono ? <><span className="font-mono">{p.vendedor_telefono}</span>{wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 bg-emerald-600 text-white hover:bg-emerald-700">Escribir por WhatsApp</a>}<button type="button" className="text-sky-700 hover:underline" onClick={() => setEditando(true)}>Editar</button></>
        : <button type="button" className="text-sky-700 hover:underline" onClick={() => setEditando(true)}>+ Anotar teléfono (míralo en el aviso)</button>}
    </span>
  );
}

/* Teléfono desde la ficha del aviso: el marcador de ficha lee lo que la página ya muestra y se pega aquí. */
function TelefonoDeFicha({ api, lista, onListo }) {
  const [texto, setTexto] = useState("");
  const [msg, setMsg] = useState(null);
  const bmRef = useRef(null);
  useEffect(() => { if (bmRef.current) bmRef.current.setAttribute("href", buildBookmarkletFichaHref()); }, []);
  const aplicar = async (valor) => {
    setTexto(valor); setMsg(null);
    if (!valor.trim()) return;
    const r = parseFichaPegada(valor);
    if (!r.ok) { setMsg({ ok: false, texto: r.error }); return; }
    const p = lista.find((x) => x.aviso_id === r.id);
    if (!p) { setMsg({ ok: false, texto: `El aviso ${r.id} no está en tus prospectos: guárdalo primero desde «Buscar en Chileautos».` }); return; }
    try { await api("prospectos.contacto", { id: p.id, telefono: r.telefono }); setMsg({ ok: true, texto: `Teléfono ${r.telefono} guardado en «${p.titulo}».` }); setTexto(""); onListo(); }
    catch (e) { setMsg({ ok: false, texto: mensajeError(e) }); }
  };
  return (
    <Tarjeta titulo="Traer el teléfono desde la ficha del aviso" ayuda="En la lista de Chileautos no aparece el teléfono: está en la ficha de cada aviso, tras pulsar «Ver n° de teléfono». Este segundo marcador lo copia (solo lee lo que la página ya muestra; no pulsa nada por ti).">
      <ol className="text-xs text-stone-600 list-decimal pl-5 flex flex-col gap-1 mb-3">
        <li>Una sola vez: arrastra este botón a la barra de favoritos: <a ref={bmRef} onClick={(e) => e.preventDefault()} draggable="true" className="inline-block border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 px-2 py-0.5 text-xs font-medium cursor-grab">⭐ Copiar teléfono Chileautos</a></li>
        <li>Abre «Contactar en Chileautos» de un prospecto, pulsa <b>Ver n° de teléfono</b> y luego el favorito.</li>
        <li>Vuelve aquí y pega (Ctrl+V): el teléfono queda en ese prospecto.</li>
      </ol>
      <input value={texto} onChange={(e) => aplicar(e.target.value)} placeholder="Pega aquí lo que copió el marcador de ficha" className={`${INPUT} font-mono text-xs`} />
      {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</p>}
    </Tarjeta>
  );
}

function MisProspectos({ api, version, onCambio, abrirLead }) {
  const [estado, setEstado] = useState("");
  const { cargando, error, datos, recargar } = useCarga(() => api("prospectos.lista", { estado }), [api, estado, version]);
  const [convertir, setConvertir] = useState(null);
  const [msg, setMsg] = useState("");
  const cambiar = async (p, parche) => { setMsg(""); try { await api("prospectos.estado", { id: p.id, estado: p.estado, notas: p.notas || "", ...parche }); await recargar(); } catch (e) { setMsg(mensajeError(e)); } };
  const cambiarContacto = async (p, parche) => { setMsg(""); try { await api("prospectos.contacto", { id: p.id, ...parche }); await recargar(); } catch (e) { setMsg(mensajeError(e)); } };
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const lista = datos.prospectos;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => setEstado("")} className={`px-3 py-1 border ${estado === "" ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"}`}>Todos</button>
        {ESTADOS_PROSPECTO.map((e) => <button key={e.id} type="button" onClick={() => setEstado(e.id)} className={`px-3 py-1 border ${estado === e.id ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"}`}>{e.nombre} {datos.conteo[e.id] ? `(${datos.conteo[e.id]})` : ""}</button>)}
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      <TelefonoDeFicha api={api} lista={datos.prospectos} onListo={recargar} />
      {lista.length === 0 ? <p className="text-sm text-stone-500">Aún no hay prospectos{estado ? " en este estado" : ""}. Guárdalos desde «Buscar en Chileautos».</p> : (
        <div className="flex flex-col gap-2">
          {lista.map((p) => (
            <div key={p.id} className="bg-white border border-stone-200 p-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <a href={ENLACE(p.href)} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline font-medium">{p.titulo}</a>
                  {p.version && <span className="text-xs text-stone-500"> · {p.version}</span>}
                  <p className="text-xs text-stone-500">{[p.anio, p.km ? `${p.km.toLocaleString("es-CL")} km` : "", p.transmision, p.combustible].filter(Boolean).join(" · ")} · guardado {hace(p.creado_en)}</p>
                </div>
                <span className="font-mono font-semibold">{clp(p.precio)}</span>
                <Etiqueta vendedor={p.vendedor_tipo} nombre={p.vendedor_nombre} />
              </div>
              <Telefono key={p.id + (p.vendedor_telefono || "")} p={p} cambiarContacto={cambiarContacto} />
              <div className="flex flex-wrap items-center gap-2">
                {p.estado === "convertido"
                  ? <><span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800">Convertido en lead</span>{p.lead_id && abrirLead && <button type="button" onClick={() => abrirLead(p.lead_id)} className="text-xs text-sky-700 hover:underline">Ver el lead</button>}</>
                  : <>
                    <select value={p.estado} onChange={(e) => cambiar(p, { estado: e.target.value })} className={CHICO}>{ESTADOS_PROSPECTO.filter((e) => e.id !== "convertido").map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
                    <input defaultValue={p.notas || ""} maxLength={500} placeholder="Notas (qué le escribiste, qué respondió…)" onBlur={(e) => { if (e.target.value !== (p.notas || "")) cambiar(p, { notas: e.target.value }); }} className={`${CHICO} flex-1 min-w-[12rem]`} />
                    <a href={ENLACE(p.href)} target="_blank" rel="noopener noreferrer" className={BTN} title="Se abre el aviso en Chileautos: ahí está «Contactar vendedor»">Contactar en Chileautos</a>
                    <button type="button" onClick={() => setConvertir(p)} className={BTN_PRIMARIO}>Convertir en lead</button>
                  </>}
              </div>
            </div>
          ))}
        </div>
      )}
      {convertir && <Convertir api={api} p={convertir} onCerrar={() => setConvertir(null)} onListo={async (lead) => { setConvertir(null); setMsg(""); await recargar(); onCambio(); if (abrirLead) abrirLead(lead.id); }} />}
    </div>
  );
}

export function ModuloProspeccion({ api, abrirLead, version, onCambio = () => {} }) {
  const [vista, setVista] = useState("buscar");
  const { datos, recargar } = useCarga(() => api("prospectos.lista", {}), [api, version]);
  const guardados = useMemo(() => new Set(((datos && datos.prospectos) || []).map((p) => p.aviso_id)), [datos]);
  const n = datos ? datos.prospectos.length : 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl text-stone-900">Generación de leads</h2>
        <p className="text-sm text-stone-600">Encuentra autos de particulares en Chileautos, guárdalos como prospectos y conviértelos en leads de compra cuando el dueño responda.</p>
      </div>
      <div className="flex border border-stone-300 self-start">
        <button type="button" onClick={() => setVista("buscar")} className={`px-3 py-1.5 text-sm ${vista === "buscar" ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Buscar en Chileautos</button>
        <button type="button" onClick={() => setVista("mios")} className={`px-3 py-1.5 text-sm ${vista === "mios" ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Mis prospectos {n ? `(${n})` : ""}</button>
      </div>
      {vista === "buscar" ? <Buscar api={api} guardados={guardados} onGuardado={recargar} /> : <MisProspectos api={api} version={version} onCambio={() => { recargar(); onCambio(); }} abrirLead={abrirLead} />}
    </div>
  );
}
