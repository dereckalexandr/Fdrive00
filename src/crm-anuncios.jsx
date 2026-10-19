/**
 * AVISOS (CRM · entrega 7)
 * ----------------------------------------------------------------
 * - Los vehículos disponibles esperan su aviso en la cola. El Anunciante lo arma (título y descripción sugeridos desde el
 *   inventario), lo publica en cada portal o red con su enlace y vencimiento, lo pausa o lo da de baja.
 * - Si el precio cambia, el vehículo se reserva o se vende, o el aviso vence, el sistema avisa que el aviso quedó desactualizado.
 * - Con Validadores en el local, un vehículo solo entra a publicarse con sus documentos aprobados.
 * - Cada aviso muestra cuántas consultas (leads) llegaron, por portal según la fuente del lead.
 * El servidor valida todo; aquí solo se muestra lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect } from "react";
import { PORTALES, portalNombre, portalEstadoNombre, anuncioNombre, urlValida } from "../supabase/functions/api/anuncios-core.js";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, hace, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, useCarga, mensajeError, apiPorDefecto } from "./crm-ui.jsx";

const COLOR = { por_publicar: "bg-amber-100 text-amber-800", publicado: "bg-emerald-100 text-emerald-800", pausado: "bg-sky-100 text-sky-800", baja: "bg-stone-200 text-stone-600", pendiente: "bg-amber-100 text-amber-800" };
const Estado = ({ id, portal = false }) => <span className={`text-[11px] px-2 py-0.5 ${COLOR[id] || ""}`}>{portal ? portalEstadoNombre(id) : anuncioNombre(id)}</span>;
const nombreVeh = (v) => (v && v.marca ? `${v.marca} ${v.modelo || ""} ${v.anio || ""} · ${v.patente}`.replace(/\s+/g, " ") : "");
const cacheFotos = new Map();

function Foto({ vehiculoId, fotoId }) {
  const [src, setSrc] = useState(cacheFotos.get(fotoId) || "");
  useEffect(() => {
    if (src) return undefined;
    let vivo = true;
    (async () => { const r = await window.storage.get(`vfoto::${vehiculoId}::${fotoId}`, true); if (vivo && r && r.value) { cacheFotos.set(fotoId, r.value); setSrc(r.value); } })();
    return () => { vivo = false; };
  }, [vehiculoId, fotoId, src]);
  return (
    <div className="w-24 h-24 bg-stone-200 border border-stone-300 shrink-0 relative">
      {src ? <a href={src} download={`foto-${fotoId}.jpg`} title="Descargar" className="block w-full h-full"><img src={src} alt="" className="w-full h-full object-cover" /></a> : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-stone-400">…</span>}
    </div>
  );
}

const copiar = async (texto, avisar) => {
  try { await navigator.clipboard.writeText(texto); avisar("Copiado al portapapeles."); } catch (e) { avisar("No se pudo copiar: selecciona el texto y cópialo a mano."); }
};

/* =========================================================
   FILA DE UN PORTAL
========================================================= */
function FilaPortal({ api, anuncio, portal, fila, puedeGestionar, onCambio, avisar }) {
  const [url, setUrl] = useState(fila ? fila.url || "" : "");
  const [vence, setVence] = useState(fila && fila.vence_en ? String(fila.vence_en).slice(0, 10) : "");
  const [ocupado, setOcupado] = useState(false);
  const estado = fila ? fila.estado : "pendiente";
  const alertas = anuncio.alertas.filter((a) => a.portal === portal.id);
  const baja = anuncio.estado === "baja";

  const poner = async (nuevo) => {
    avisar(""); setOcupado(true);
    try { await api("anuncios.portal", { id: anuncio.id, datos: { portal: portal.id, estado: nuevo, url, venceEn: vence } }); await onCambio(); } catch (e) { avisar(mensajeError(e)); }
    setOcupado(false);
  };
  const urlMal = url && !urlValida(url);

  return (
    <div className={`border p-3 text-sm ${alertas.length ? "border-orange-300 bg-orange-50/40" : "border-stone-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-stone-900">{portal.nombre}</span><Estado id={estado} portal />
        {fila && fila.precio_publicado != null && estado !== "baja" && <span className="text-xs text-stone-500">aviso a {clp(fila.precio_publicado)}</span>}
        {fila && fila.url && <a href={fila.url} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline ml-auto">Abrir el aviso ↗</a>}
      </div>
      {alertas.map((a, i) => <p key={i} className={`text-xs mt-1 ${a.grave ? "text-rose-700" : "text-orange-700"}`}>⚠ {a.texto}</p>)}
      {puedeGestionar && !baja && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {portal.url && <Campo etiqueta="Enlace del aviso" className="flex-1 min-w-[220px]"><input value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} className={`${INPUT} ${urlMal ? "border-rose-400" : ""}`} placeholder="https://…" /></Campo>}
          <Campo etiqueta="Vence (opcional)"><input type="date" value={vence} onChange={(e) => setVence(e.target.value)} className={INPUT} /></Campo>
          <div className="flex flex-wrap gap-2">
            {estado !== "publicado" && <button disabled={ocupado || (portal.url && !urlValida(url))} onClick={() => poner("publicado")} className={BTN_AMBAR}>{estado === "pausado" ? "Reactivar" : "Marcar publicado"}</button>}
            {estado === "publicado" && <button disabled={ocupado || (portal.url && !urlValida(url))} onClick={() => poner("publicado")} className={BTN_AMBAR} title="Úsalo cuando ya corregiste el aviso en el portal">Ya lo actualicé</button>}
            {estado === "publicado" && <button disabled={ocupado} onClick={() => poner("pausado")} className={BTN}>Pausar</button>}
            {fila && estado !== "baja" && <button disabled={ocupado} onClick={() => poner("baja")} className={BTN}>Bajar de este portal</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   DETALLE DE UN AVISO
========================================================= */
function AnuncioDetalle({ api, id, onCerrar, onCambio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("anuncios.get", { id }), [api, id]);
  const [t, setT] = useState(null);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (datos) setT({ titulo: datos.anuncio.titulo, descripcion: datos.anuncio.descripcion }); }, [datos]);

  if (cargando && !datos) return <Modal titulo="Aviso" onCerrar={onCerrar}><Cargando /></Modal>;
  if (error && !datos) return <Modal titulo="Aviso" onCerrar={onCerrar}><Aviso>{error}</Aviso></Modal>;
  if (!t) return null;
  const a = datos.anuncio;
  const editable = datos.puedeGestionar && a.estado !== "baja";
  const cambio = async () => { await recargar(); onCambio(); };
  const aviso = (texto) => setMsg({ tipo: texto.startsWith("Copiado") ? "ok" : "error", texto });
  const guardar = async () => {
    setMsg({ tipo: "", texto: "" }); setOcupado(true);
    try { await api("anuncios.guardar", { id: a.id, datos: t }); setMsg({ tipo: "ok", texto: "Texto guardado." }); await cambio(); } catch (e) { setMsg({ tipo: "error", texto: mensajeError(e) }); }
    setOcupado(false);
  };
  const baja = async () => {
    if (!window.confirm("¿Dar de baja este aviso en todos los portales? El vehículo podrá tener un aviso nuevo.")) return;
    setMsg({ tipo: "", texto: "" }); setOcupado(true);
    try { await api("anuncios.baja", { id: a.id }); await cambio(); } catch (e) { setMsg({ tipo: "error", texto: mensajeError(e) }); }
    setOcupado(false);
  };
  const sinGuardar = t.titulo !== a.titulo || t.descripcion !== a.descripcion;
  const c = datos.consultas;

  return (
    <Modal titulo={`Aviso ${a.folio}`} onCerrar={onCerrar} ancho="max-w-3xl">
      <div className="flex flex-wrap items-center gap-3">
        <Estado id={a.estado} /><span className="text-sm text-stone-900">{nombreVeh(a.vehiculo)}</span>
        <span className="text-sm font-mono text-stone-700 ml-auto">Precio de lista {clp(a.vehiculo.precio_lista)}</span>
      </div>
      {a.alertas.length > 0 && <Aviso>{a.alertas.map((x, i) => <p key={i}>⚠ {x.texto}</p>)}</Aviso>}
      {msg.texto && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <Tarjeta titulo="Texto del aviso" ayuda="Se arma con los datos del inventario. Edítalo y cópialo a cada portal.">
        <div className="flex flex-col gap-3">
          <Campo etiqueta="Título"><input value={t.titulo} maxLength={120} disabled={!editable} onChange={(e) => setT({ ...t, titulo: e.target.value })} className={INPUT} /></Campo>
          <Campo etiqueta="Descripción"><textarea rows={9} maxLength={2000} value={t.descripcion} disabled={!editable} onChange={(e) => setT({ ...t, descripcion: e.target.value })} className={INPUT} /></Campo>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => copiar(t.titulo, aviso)} className={BTN}>Copiar título</button>
            <button onClick={() => copiar(t.descripcion, aviso)} className={BTN}>Copiar descripción</button>
            {editable && <button disabled={ocupado || !sinGuardar} onClick={guardar} className={BTN_PRIMARIO}>Guardar texto</button>}
            {editable && datos.sugerencia && <button onClick={() => setT({ ...datos.sugerencia })} className={BTN}>Volver al texto sugerido</button>}
          </div>
        </div>
      </Tarjeta>

      <Tarjeta titulo={`Fotos del inventario (${(a.vehiculo.fotos || []).length})`} ayuda="Toca una foto para descargarla y subirla al portal.">
        <div className="flex flex-wrap gap-2">
          {(a.vehiculo.fotos || []).length === 0 ? <p className="text-sm text-stone-500">Este vehículo no tiene fotos en el inventario. Pídele a quien edita el inventario que las suba.</p>
            : a.vehiculo.fotos.map((f) => <Foto key={f} vehiculoId={a.vehiculo.id} fotoId={f} />)}
        </div>
      </Tarjeta>

      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-stone-400">Dónde está publicado</p>
        {PORTALES.map((p) => <FilaPortal key={p.id} api={api} anuncio={a} portal={p} fila={a.portales.find((x) => x.portal === p.id)} puedeGestionar={datos.puedeGestionar} onCambio={cambio} avisar={(t2) => setMsg({ tipo: "error", texto: t2 })} />)}
      </div>

      <Tarjeta titulo="Consultas de los últimos 30 días" ayuda="Leads de este vehículo, según la fuente con que se registraron (la fuente debe llamarse igual que el portal).">
        <p className="text-sm text-stone-700"><strong className="font-mono">{c.total}</strong> consulta(s){c.total > 0 ? ": " : ""}
          {Object.entries(c.porPortal).map(([p, n]) => `${portalNombre(p)} ${n}`).join(" · ")}{c.otras > 0 ? `${Object.keys(c.porPortal).length ? " · " : ""}otras fuentes ${c.otras}` : ""}</p>
      </Tarjeta>

      {editable && <div><button disabled={ocupado} onClick={baja} className={BTN}>Dar de baja el aviso completo</button></div>}
    </Modal>
  );
}

/* =========================================================
   LISTAS
========================================================= */
function Cola({ api, version, onCreado, puedeGestionar }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("anuncios.cola"), [api, version]);
  const [msg, setMsg] = useState("");
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const crear = async (v) => { setMsg(""); try { const r = await api("anuncios.crear", { vehiculoId: v.id }); onCreado(r.anuncio.id); } catch (e) { setMsg(mensajeError(e)); await recargar(); } };
  return (
    <>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Vehículo</th><th className="py-3 px-4 text-right">Precio de lista</th><th className="py-3 px-4 text-right">Fotos</th><th className="py-3 px-4">Documentos</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {datos.porCrear.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-stone-500">Todos los vehículos disponibles ya tienen su aviso. 👌</td></tr>}
            {datos.porCrear.map((x) => (
              <tr key={x.vehiculo.id} className="border-b border-stone-100">
                <td className="py-2.5 px-4 text-stone-900">{nombreVeh(x.vehiculo)}<div className="text-xs text-stone-500">{Number(x.vehiculo.km).toLocaleString("es-CL")} km{x.vehiculo.transmision ? ` · ${x.vehiculo.transmision}` : ""}</div></td>
                <td className="py-2.5 px-4 text-right font-mono">{clp(x.vehiculo.precio_lista)}</td>
                <td className="py-2.5 px-4 text-right font-mono">{(x.vehiculo.fotos || []).length}</td>
                <td className="py-2.5 px-4 text-xs">{x.bloqueado ? <span className="text-orange-700">Esperando validación{x.validacion ? ` (${x.validacion.estado === "pendiente" ? "sin tomar" : "en revisión"})` : ""}</span> : <span className="text-emerald-700">Listo para publicar</span>}</td>
                <td className="py-2.5 px-4 text-right">{puedeGestionar && <button disabled={x.bloqueado} onClick={() => crear(x.vehiculo)} className={BTN_AMBAR}>Crear aviso</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ListaAvisos({ api, version, onAbrir }) {
  const [filtro, setFiltro] = useState("");
  const { cargando, error, datos } = useCarga(() => api("anuncios.list", { estado: filtro || undefined }), [api, filtro, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-stone-600">Estado:
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${INPUT} md:w-52`}>
          <option value="">Activos</option><option value="por_publicar">Por publicar</option><option value="publicado">Publicados</option><option value="pausado">Pausados</option><option value="baja">Dados de baja</option>
        </select>
      </div>
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Aviso</th><th className="py-3 px-4">Vehículo</th><th className="py-3 px-4">Portales</th><th className="py-3 px-4 text-right">Consultas 30 d</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {datos.anuncios.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">No hay avisos con ese filtro.</td></tr>}
            {datos.anuncios.map((a) => (
              <tr key={a.id} className="border-b border-stone-100 align-top">
                <td className="py-2.5 px-4"><span className="font-mono text-xs text-stone-500">{a.folio}</span><div className="text-[11px] text-stone-400">{hace(a.creado_en)}</div></td>
                <td className="py-2.5 px-4 text-stone-900">{nombreVeh(a.vehiculo)}<div className="text-xs text-stone-500 font-mono">{clp(a.vehiculo.precio_lista)}</div></td>
                <td className="py-2.5 px-4 text-xs text-stone-700">{a.portales.filter((p) => p.estado === "publicado").map((p) => portalNombre(p.portal)).join(", ") || "—"}{a.alertas.length > 0 && <div className="text-orange-700">⚠ {a.alertas.length} por corregir</div>}</td>
                <td className="py-2.5 px-4 text-right font-mono">{a.consultas ? a.consultas.total : 0}</td>
                <td className="py-2.5 px-4"><Estado id={a.estado} /></td>
                <td className="py-2.5 px-4 text-right"><button onClick={() => onAbrir(a.id)} className={BTN}>Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Resumen({ api, version, onAbrir }) {
  const { cargando, error, datos } = useCarga(() => api("anuncios.resumen"), [api, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const e = datos.porEstado;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Por publicar", e.por_publicar], ["Publicados", e.publicado], ["Pausados", e.pausado], ["Por corregir", datos.alertas.length]].map(([t, n]) => (
          <div key={t} className="bg-white border border-stone-200 p-4"><p className="text-xs uppercase tracking-wide text-stone-400">{t}</p><p className="font-mono text-2xl text-stone-900">{n}</p></div>
        ))}
      </div>
      <Tarjeta titulo="Avisos por corregir" ayuda="Precio distinto al del inventario, vehículo reservado o vendido, o aviso vencido o por vencer.">
        {datos.alertas.length === 0 ? <p className="text-sm text-stone-500">Todo al día. 👌</p> : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {datos.alertas.map((a, i) => (
              <li key={i} className="py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-stone-500">{a.folio}</span><span className="text-stone-900">{a.vehiculo}</span>
                <span className={a.grave ? "text-rose-700" : "text-orange-700"}>{a.texto}</span>
                <button onClick={() => onAbrir(a.anuncio_id)} className={`${BTN} ml-auto`}>Abrir</button>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Tarjeta titulo="Publicados por portal">
          {Object.keys(datos.porPortal).length === 0 ? <p className="text-sm text-stone-500">Aún no hay avisos publicados.</p> : (
            <ul className="text-sm flex flex-col gap-1">{Object.entries(datos.porPortal).map(([p, n]) => <li key={p} className="flex justify-between"><span>{portalNombre(p)}</span><span className="font-mono">{n}</span></li>)}</ul>
          )}
        </Tarjeta>
        <Tarjeta titulo={`Consultas por portal · últimos ${datos.dias} días`} ayuda="Según la fuente con que se registró cada lead.">
          {Object.keys(datos.consultas.porPortal).length === 0 && datos.consultas.otras === 0 ? <p className="text-sm text-stone-500">Aún no hay consultas.</p> : (
            <ul className="text-sm flex flex-col gap-1">
              {Object.entries(datos.consultas.porPortal).map(([p, n]) => <li key={p} className="flex justify-between"><span>{portalNombre(p)}</span><span className="font-mono">{n}</span></li>)}
              {datos.consultas.otras > 0 && <li className="flex justify-between text-stone-500"><span>Otras fuentes</span><span className="font-mono">{datos.consultas.otras}</span></li>}
            </ul>
          )}
        </Tarjeta>
      </div>
      <Tarjeta titulo="Avisos con más consultas">
        {datos.consultas.top.filter((x) => x.consultas > 0).length === 0 ? <p className="text-sm text-stone-500">Aún no hay consultas.</p> : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {datos.consultas.top.filter((x) => x.consultas > 0).map((x) => (
              <li key={x.id} className="py-2 text-sm flex flex-wrap items-center gap-3"><span className="font-mono text-xs text-stone-500">{x.folio}</span><span className="text-stone-900">{x.vehiculo}</span><span className="font-mono ml-auto">{x.consultas}</span><button onClick={() => onAbrir(x.id)} className={BTN}>Abrir</button></li>
            ))}
          </ul>
        )}
      </Tarjeta>
      <p className="text-xs text-stone-500">Para medir qué portal rinde, registra los leads con una fuente que se llame igual que el portal (Chileautos, Yapo, Facebook Marketplace, Sitio web, Instagram, TikTok). El administrador las agrega en Configuración → Fuentes de leads.</p>
    </>
  );
}

/* =========================================================
   MÓDULO
========================================================= */
export function ModuloAnuncios({ api: apiProp, permisos = [], esAdmin = false }) {
  const puedeGestionar = !esAdmin && permisos.includes("anuncios.gestionar");
  const api = apiProp || apiPorDefecto;
  const [tab, setTab] = useState(puedeGestionar ? "cola" : "avisos");
  const [version, setVersion] = useState(0);
  const [abierto, setAbierto] = useState(null);
  const subir = () => setVersion((v) => v + 1);
  const res = useCarga(() => api("anuncios.resumen").then((r) => r.alertas.length).catch(() => 0), [api, version]);
  const opciones = [];
  if (puedeGestionar) opciones.push(["cola", "Por publicar"]);
  opciones.push(["avisos", "Avisos"], ["resumen", "Resumen y alertas", res.datos || 0]);
  return (
    <div className="flex flex-col gap-5">
      <Pestanas valor={tab} onCambio={setTab} opciones={opciones} />
      {tab === "cola" && <Cola api={api} version={version} puedeGestionar={puedeGestionar} onCreado={(id) => { subir(); setTab("avisos"); setAbierto(id); }} />}
      {tab === "avisos" && <ListaAvisos api={api} version={version} onAbrir={setAbierto} />}
      {tab === "resumen" && <Resumen api={api} version={version} onAbrir={setAbierto} />}
      {abierto && <AnuncioDetalle api={api} id={abierto} onCerrar={() => setAbierto(null)} onCambio={subir} />}
    </div>
  );
}
