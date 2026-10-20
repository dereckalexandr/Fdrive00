/**
 * MARKETING Y RRSS (CRM · entrega 8)
 * ----------------------------------------------------------------
 * - Calendario de contenido: ideas, producción, publicaciones programadas y publicadas, por red, con su campaña y vehículo.
 * - Campañas: con presupuesto las aprueba el Jefe Local; sin presupuesto salen solas. Marketing anota el gasto y los
 *   resultados; el CRM cuenta los leads y ventas que llegan con la campaña y calcula el costo por lead y por venta.
 * - Material por vehículo: fotos, videos y reels que se piden y se reúnen, con el enlace a la carpeta.
 * - Resultados: rendimiento por fuente y por campaña.
 * El servidor valida todo; aquí solo se muestra lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { mesChile } from "../supabase/functions/api/ventas-core.js";
import {
  CANALES, TIPOS_PUBLICACION, ESTADOS_PUBLICACION, TIPOS_MATERIAL, ESTADOS_MATERIAL, canalNombre, tipoPublicacionNombre, publicacionNombre,
  campaniaNombre, materialTipoNombre, materialEstadoNombre, validarCampania, validarPublicacion,
} from "../supabase/functions/api/marketing-core.js";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, hace, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, useCarga, mensajeError, apiPorDefecto } from "./crm-ui.jsx";

const COLOR_PUB = { idea: "bg-stone-100 text-stone-700", produccion: "bg-sky-100 text-sky-800", programada: "bg-amber-100 text-amber-800", publicada: "bg-emerald-100 text-emerald-800", cancelada: "bg-stone-200 text-stone-500" };
const COLOR_CAMP = { borrador: "bg-stone-100 text-stone-700", pendiente: "bg-amber-100 text-amber-800", aprobada: "bg-emerald-100 text-emerald-800", rechazada: "bg-rose-100 text-rose-800", finalizada: "bg-sky-100 text-sky-800", cancelada: "bg-stone-200 text-stone-500" };
const COLOR_MAT = { pendiente: "bg-amber-100 text-amber-800", en_proceso: "bg-sky-100 text-sky-800", listo: "bg-emerald-100 text-emerald-800" };
const Etiqueta = ({ clases, texto }) => <span className={`text-[11px] px-2 py-0.5 ${clases || ""}`}>{texto}</span>;
const fechaDia = (iso) => (iso ? new Date(iso).toLocaleString("es-CL", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" }) : "Sin fecha");
const fechaSimple = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "—");
const aInputLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const deInputLocal = (v) => { if (!v) return ""; const t = new Date(v); return Number.isNaN(t.getTime()) ? "" : t.toISOString(); };
const pct = (n) => (n === null || n === undefined ? "—" : `${n}%`);

/* =========================================================
   CALENDARIO
========================================================= */
function FormPublicacion({ api, pub, campanias, vehiculos, onCerrar, onGuardada }) {
  const [f, setF] = useState(() => ({
    titulo: pub ? pub.titulo : "", red: pub ? pub.red : "instagram", tipo: pub ? pub.tipo : "post", estado: pub ? pub.estado : "idea",
    fechaProgramada: pub ? aInputLocal(pub.fecha_programada) : "", texto: pub ? pub.texto || "" : "", url: pub ? pub.url || "" : "",
    campaniaId: pub ? pub.campania_id || "" : "", vehiculoId: pub ? pub.vehiculo_id || "" : "",
  }));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    setError("");
    const datos = { ...f, fechaProgramada: deInputLocal(f.fechaProgramada) };
    const val = validarPublicacion(datos);
    if (!val.ok) { setError(mensajeError({ message: val.error })); return; }
    setGuardando(true);
    try { await api("marketing.publicaciones.save", { id: pub ? pub.id : undefined, datos }); onGuardada(); } catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };
  return (
    <Modal titulo={pub ? `Publicación ${pub.folio}` : "Nueva publicación"} onCerrar={onCerrar} ancho="max-w-2xl">
      <Campo etiqueta="Título"><input value={f.titulo} maxLength={120} onChange={(e) => set("titulo", e.target.value)} className={INPUT} placeholder="Ej.: Reel Hyundai Venue 2023" /></Campo>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Campo etiqueta="Red"><select value={f.red} onChange={(e) => set("red", e.target.value)} className={INPUT}>{CANALES.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Formato"><select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} className={INPUT}>{TIPOS_PUBLICACION.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Estado"><select value={f.estado} onChange={(e) => set("estado", e.target.value)} className={INPUT}>{ESTADOS_PUBLICACION.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Fecha y hora"><input type="datetime-local" value={f.fechaProgramada} onChange={(e) => set("fechaProgramada", e.target.value)} className={INPUT} /></Campo>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Campo etiqueta="Campaña (opcional)"><select value={f.campaniaId} onChange={(e) => set("campaniaId", e.target.value)} className={INPUT}><option value="">—</option>{campanias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Vehículo (opcional)"><select value={f.vehiculoId} onChange={(e) => set("vehiculoId", e.target.value)} className={INPUT}><option value="">—</option>{vehiculos.map((v) => <option key={v.id} value={v.id}>{v.marca} {v.modelo} {v.anio} · {v.patente}</option>)}</select></Campo>
      </div>
      <Campo etiqueta="Texto de la publicación"><textarea rows={5} maxLength={2000} value={f.texto} onChange={(e) => set("texto", e.target.value)} className={INPUT} /></Campo>
      {(f.estado === "publicada" || f.url) && <Campo etiqueta="Enlace de la publicación" ayuda="Se completa al publicar."><input value={f.url} maxLength={500} onChange={(e) => set("url", e.target.value)} className={INPUT} placeholder="https://…" /></Campo>}
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2"><button onClick={guardar} disabled={guardando} className={BTN_AMBAR}>{guardando ? "Guardando…" : "Guardar"}</button><button onClick={onCerrar} className={BTN}>Cancelar</button></div>
    </Modal>
  );
}

function Calendario({ api, puedeGestionar, version, onCambio, campanias, vehiculos }) {
  const [mes, setMes] = useState(mesChile());
  const [red, setRed] = useState("");
  const [forma, setForma] = useState(undefined); // undefined = cerrada, null = nueva, objeto = editar
  const [msg, setMsg] = useState("");
  const { cargando, error, datos, recargar } = useCarga(() => api("marketing.publicaciones.list", { mes }), [api, mes, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const lista = datos.publicaciones.filter((p) => !red || p.red === red);
  const cambiarEstado = async (p, estado) => {
    setMsg("");
    let url;
    if (estado === "publicada") { url = window.prompt("Pega el enlace de la publicación (https://…). Puedes dejarlo vacío.", p.url || ""); if (url === null) return; }
    try { await api("marketing.publicaciones.estado", { id: p.id, estado, url: url || undefined }); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); }
  };
  const eliminar = async (p) => { if (!window.confirm("¿Eliminar esta publicación?")) return; try { await api("marketing.publicaciones.eliminar", { id: p.id }); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); } };
  const r = datos.resumen;
  return (
    <>
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-stone-600 flex items-center gap-2">Mes <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className={`${INPUT} w-44`} /></label>
          <select value={red} onChange={(e) => setRed(e.target.value)} className={`${INPUT} w-44`}><option value="">Todas las redes</option>{CANALES.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          <p className="text-sm text-stone-600 ml-auto">{r.porEstado.programada} programadas · {r.porEstado.publicada} publicadas · {r.porEstado.idea + r.porEstado.produccion} en idea o producción{datos.atrasadas > 0 ? <span className="text-rose-700"> · {datos.atrasadas} atrasadas</span> : null}</p>
          {puedeGestionar && <button onClick={() => setForma(null)} className={BTN_PRIMARIO}>+ Nueva publicación</button>}
        </div>
      </Tarjeta>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Cuándo</th><th className="py-3 px-4">Publicación</th><th className="py-3 px-4">Red</th><th className="py-3 px-4">Campaña / vehículo</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">No hay publicaciones en {datos.nombreMes}.</td></tr>}
            {lista.map((p) => {
              const atrasada = p.estado === "programada" && p.fecha_programada && Date.parse(p.fecha_programada) < Date.now();
              return (
                <tr key={p.id} className="border-b border-stone-100 align-top">
                  <td className={`py-2.5 px-4 whitespace-nowrap first-letter:uppercase ${atrasada ? "text-rose-700" : "text-stone-700"}`}>{fechaDia(p.fecha_programada)}{atrasada ? " · atrasada" : ""}</td>
                  <td className="py-2.5 px-4 text-stone-900">{p.titulo}<div className="text-xs text-stone-500">{p.folio} · {tipoPublicacionNombre(p.tipo)}</div></td>
                  <td className="py-2.5 px-4 text-stone-700">{canalNombre(p.red)}</td>
                  <td className="py-2.5 px-4 text-xs text-stone-600">{p.campania || "—"}{p.vehiculo ? <div>{p.vehiculo}</div> : null}</td>
                  <td className="py-2.5 px-4"><Etiqueta clases={COLOR_PUB[p.estado]} texto={publicacionNombre(p.estado)} />{p.url && <a href={p.url} target="_blank" rel="noreferrer" className="block text-xs text-sky-700 hover:underline mt-1">Ver ↗</a>}</td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    {puedeGestionar && p.estado !== "publicada" && p.estado !== "cancelada" && <button onClick={() => cambiarEstado(p, p.estado === "idea" ? "produccion" : p.estado === "produccion" ? "programada" : "publicada")} className={BTN_AMBAR}>{p.estado === "idea" ? "A producción" : p.estado === "produccion" ? "Programar" : "Marcar publicada"}</button>}{" "}
                    {puedeGestionar && <button onClick={() => setForma(p)} className={BTN}>Editar</button>}{" "}
                    {puedeGestionar && (p.estado === "idea" || p.estado === "cancelada") && <button onClick={() => eliminar(p)} className={BTN}>Eliminar</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {forma !== undefined && <FormPublicacion api={api} pub={forma} campanias={campanias} vehiculos={vehiculos} onCerrar={() => setForma(undefined)} onGuardada={async () => { setForma(undefined); await recargar(); onCambio(); }} />}
    </>
  );
}

/* =========================================================
   CAMPAÑAS
========================================================= */
function FormCampania({ api, camp, onCerrar, onGuardada }) {
  const hoy = mesChile() + "-01";
  const [f, setF] = useState(() => ({ nombre: camp ? camp.nombre : "", canal: camp ? camp.canal : "instagram", objetivo: camp ? camp.objetivo || "" : "", desde: camp ? String(camp.desde).slice(0, 10) : hoy, hasta: camp ? String(camp.hasta).slice(0, 10) : hoy, presupuesto: camp ? camp.presupuesto : 0 }));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    setError("");
    const val = validarCampania(f);
    if (!val.ok) { setError(mensajeError({ message: val.error })); return; }
    setGuardando(true);
    try { await api("marketing.campanias.save", { id: camp ? camp.id : undefined, datos: f }); onGuardada(); } catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };
  const aviso = camp && camp.estado === "aprobada" ? "Si subes el presupuesto por sobre lo aprobado, la campaña vuelve a pedir la aprobación del Jefe Local." : Number(f.presupuesto) > 0 ? "Con presupuesto, el Jefe Local debe aprobarla antes de salir." : "Sin presupuesto sale sola, sin necesitar aprobación.";
  return (
    <Modal titulo={camp ? `Campaña ${camp.folio}` : "Nueva campaña"} onCerrar={onCerrar} ancho="max-w-2xl">
      <Campo etiqueta="Nombre"><input value={f.nombre} maxLength={80} onChange={(e) => set("nombre", e.target.value)} className={INPUT} /></Campo>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Campo etiqueta="Canal"><select value={f.canal} onChange={(e) => set("canal", e.target.value)} className={INPUT}>{CANALES.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Presupuesto ($)" ayuda={aviso}><input type="number" min="0" value={f.presupuesto} onChange={(e) => set("presupuesto", e.target.value)} className={`${INPUT} font-mono`} /></Campo>
        <Campo etiqueta="Desde"><input type="date" value={f.desde} onChange={(e) => set("desde", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={f.hasta} onChange={(e) => set("hasta", e.target.value)} className={INPUT} /></Campo>
      </div>
      <Campo etiqueta="Objetivo (opcional)"><input value={f.objetivo} maxLength={200} onChange={(e) => set("objetivo", e.target.value)} className={INPUT} placeholder="Ej.: más consultas por SUV" /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2"><button onClick={guardar} disabled={guardando} className={BTN_AMBAR}>{guardando ? "Guardando…" : "Guardar"}</button><button onClick={onCerrar} className={BTN}>Cancelar</button></div>
    </Modal>
  );
}

function FormResultados({ api, camp, onCerrar, onGuardada }) {
  const [f, setF] = useState({ gasto: camp.gasto, alcance: camp.alcance, impresiones: camp.impresiones, clics: camp.clics });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    setError(""); setGuardando(true);
    try { await api("marketing.campanias.resultados", { id: camp.id, datos: f }); onGuardada(); } catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };
  return (
    <Modal titulo={`Resultados de ${camp.nombre}`} onCerrar={onCerrar} ancho="max-w-lg">
      <p className="text-sm text-stone-600">Anota lo que muestran las plataformas. Los leads y las ventas los cuenta el CRM solo. Presupuesto aprobado: <strong className="font-mono">{clp(camp.presupuesto_aprobado)}</strong>.</p>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Gasto real ($)"><input type="number" min="0" value={f.gasto} onChange={(e) => set("gasto", e.target.value)} className={`${INPUT} font-mono`} /></Campo>
        <Campo etiqueta="Alcance (personas)"><input type="number" min="0" value={f.alcance} onChange={(e) => set("alcance", e.target.value)} className={`${INPUT} font-mono`} /></Campo>
        <Campo etiqueta="Impresiones"><input type="number" min="0" value={f.impresiones} onChange={(e) => set("impresiones", e.target.value)} className={`${INPUT} font-mono`} /></Campo>
        <Campo etiqueta="Clics"><input type="number" min="0" value={f.clics} onChange={(e) => set("clics", e.target.value)} className={`${INPUT} font-mono`} /></Campo>
      </div>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2"><button onClick={guardar} disabled={guardando} className={BTN_AMBAR}>{guardando ? "Guardando…" : "Guardar resultados"}</button><button onClick={onCerrar} className={BTN}>Cancelar</button></div>
    </Modal>
  );
}

function Campanias({ api, puedeGestionar, puedeAprobar, version, onCambio }) {
  const [forma, setForma] = useState(undefined);
  const [resultados, setResultados] = useState(null);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { cargando, error, datos, recargar } = useCarga(() => api("marketing.campanias.list"), [api, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const correr = async (op, c, extra) => {
    setMsg(""); setOcupado(true);
    try { await api(op, { id: c.id, ...extra }); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); }
    setOcupado(false);
  };
  const rechazar = (c) => { const motivo = window.prompt("¿Por qué se rechaza?"); if (motivo && motivo.trim().length >= 3) correr("marketing.campanias.rechazar", c, { motivo }); };
  const pendientes = datos.campanias.filter((c) => c.estado === "pendiente");
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-stone-600">{pendientes.length > 0 && puedeAprobar ? <strong className="text-amber-800">{pendientes.length} esperando tu aprobación</strong> : "Con presupuesto necesitan la aprobación del Jefe Local; sin presupuesto salen solas."}</p>
        {puedeGestionar && <button onClick={() => setForma(null)} className={`${BTN_PRIMARIO} ml-auto`}>+ Nueva campaña</button>}
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Campaña</th><th className="py-3 px-4">Fechas</th><th className="py-3 px-4 text-right">Presupuesto / gasto</th><th className="py-3 px-4 text-right">Leads · ventas</th><th className="py-3 px-4 text-right">Costo por lead / venta</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {datos.campanias.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-stone-500">Aún no hay campañas.</td></tr>}
            {datos.campanias.map((c) => (
              <tr key={c.id} className="border-b border-stone-100 align-top">
                <td className="py-2.5 px-4 text-stone-900">{c.nombre}<div className="text-xs text-stone-500">{c.folio} · {canalNombre(c.canal)}</div></td>
                <td className="py-2.5 px-4 text-xs text-stone-600 whitespace-nowrap">{fechaSimple(c.desde)} → {fechaSimple(c.hasta)}</td>
                <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{clp(c.presupuesto)}<div className="text-xs text-stone-500">gastado {clp(c.gasto)}{c.metricas.consumo !== null ? ` (${c.metricas.consumo}%)` : ""}</div></td>
                <td className="py-2.5 px-4 text-right font-mono whitespace-nowrap">{c.metricas.leads} · {c.metricas.ventas}<div className="text-xs text-stone-500">{pct(c.metricas.conversion)} convierte</div></td>
                <td className="py-2.5 px-4 text-right font-mono text-xs whitespace-nowrap">{clp(c.metricas.costoPorLead)} / {clp(c.metricas.costoPorVenta)}</td>
                <td className="py-2.5 px-4"><Etiqueta clases={COLOR_CAMP[c.estado]} texto={campaniaNombre(c.estado)} />{c.estado === "rechazada" && c.motivo_rechazo && <div className="text-xs text-rose-700 mt-1">{c.motivo_rechazo}</div>}{c.estado === "aprobada" && c.aprobado_por && <div className="text-[11px] text-stone-400 mt-1">{c.aprobado_por}</div>}</td>
                <td className="py-2.5 px-4 text-right whitespace-nowrap">
                  {puedeAprobar && c.estado === "pendiente" && <><button disabled={ocupado} onClick={() => correr("marketing.campanias.aprobar", c)} className={BTN_AMBAR}>Aprobar</button> <button disabled={ocupado} onClick={() => rechazar(c)} className={BTN}>Rechazar</button></>}
                  {puedeGestionar && (c.estado === "borrador" || c.estado === "rechazada") && <button disabled={ocupado} onClick={() => correr("marketing.campanias.enviar", c)} className={BTN_AMBAR}>{Number(c.presupuesto) > 0 ? "Enviar a aprobación" : "Activar"}</button>}{" "}
                  {puedeGestionar && (c.estado === "aprobada" || c.estado === "finalizada") && <button onClick={() => setResultados(c)} className={BTN}>Resultados</button>}{" "}
                  {puedeGestionar && c.estado === "aprobada" && <button disabled={ocupado} onClick={() => correr("marketing.campanias.finalizar", c)} className={BTN}>Finalizar</button>}{" "}
                  {puedeGestionar && ["borrador", "pendiente", "rechazada", "aprobada"].includes(c.estado) && <button onClick={() => setForma(c)} className={BTN}>Editar</button>}{" "}
                  {(puedeGestionar || puedeAprobar) && ["borrador", "pendiente", "rechazada", "aprobada"].includes(c.estado) && <button disabled={ocupado} onClick={() => window.confirm("¿Cancelar esta campaña?") && correr("marketing.campanias.cancelar", c)} className={BTN}>Cancelar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Los leads se asocian a la campaña desde el formulario del lead (campo «Campaña»). El costo por lead y por venta usa el gasto que anotas y los leads y ventas aprobadas que cuenta el CRM.</p>
      {forma !== undefined && <FormCampania api={api} camp={forma} onCerrar={() => setForma(undefined)} onGuardada={async () => { setForma(undefined); await recargar(); onCambio(); }} />}
      {resultados && <FormResultados api={api} camp={resultados} onCerrar={() => setResultados(null)} onGuardada={async () => { setResultados(null); await recargar(); onCambio(); }} />}
    </>
  );
}

/* =========================================================
   MATERIAL POR VEHÍCULO
========================================================= */
function Material({ api, puedeGestionar, vehiculos, version, onCambio }) {
  const [f, setF] = useState({ vehiculoId: "", tipo: "reel", notas: "" });
  const [msg, setMsg] = useState("");
  const { cargando, error, datos, recargar } = useCarga(() => api("marketing.material.list"), [api, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const guardar = async (datosM) => { setMsg(""); try { await api("marketing.material.save", { datos: datosM }); await recargar(); onCambio(); return true; } catch (e) { setMsg(mensajeError(e)); return false; } };
  const pedir = async () => { if (await guardar({ ...f, estado: "pendiente" })) setF({ vehiculoId: "", tipo: "reel", notas: "" }); };
  const marcar = async (m, estado) => {
    let url = m.url || "";
    if (estado === "listo") { url = window.prompt("Pega el enlace a la carpeta o archivo con el material (https://…)", url); if (!url) return; }
    await guardar({ vehiculoId: m.vehiculo_id, tipo: m.tipo, estado, url, notas: m.notas });
  };
  const quitar = async (m) => { if (!window.confirm("¿Quitar este pedido de material?")) return; try { await api("marketing.material.eliminar", { id: m.id }); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); } };
  return (
    <>
      {datos.puedeGestionar && (
        <Tarjeta titulo="Pedir material de un vehículo" ayuda="Fotos profesionales, video, reel o historias. Marketing lo reúne y deja el enlace a la carpeta.">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <Campo etiqueta="Vehículo" className="md:col-span-2"><select value={f.vehiculoId} onChange={(e) => setF({ ...f, vehiculoId: e.target.value })} className={INPUT}><option value="">Elige…</option>{vehiculos.map((v) => <option key={v.id} value={v.id}>{v.marca} {v.modelo} {v.anio} · {v.patente}</option>)}</select></Campo>
            <Campo etiqueta="Material"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={INPUT}>{TIPOS_MATERIAL.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
            <button disabled={!f.vehiculoId} onClick={pedir} className={BTN_AMBAR}>Pedir</button>
            <Campo etiqueta="Nota (opcional)" className="md:col-span-4"><input value={f.notas} maxLength={300} onChange={(e) => setF({ ...f, notas: e.target.value })} className={INPUT} placeholder="Ej.: para la campaña de octubre, formato vertical" /></Campo>
          </div>
        </Tarjeta>
      )}
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-3 px-4">Vehículo</th><th className="py-3 px-4">Material</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4">Enlace</th><th className="py-3 px-4"></th></tr></thead>
          <tbody>
            {datos.material.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-stone-500">No hay material pedido.</td></tr>}
            {datos.material.map((m) => (
              <tr key={m.id} className="border-b border-stone-100 align-top">
                <td className="py-2.5 px-4 text-stone-900">{m.vehiculo}{m.notas && <div className="text-xs text-stone-500">{m.notas}</div>}</td>
                <td className="py-2.5 px-4 text-stone-700">{materialTipoNombre(m.tipo)}</td>
                <td className="py-2.5 px-4"><Etiqueta clases={COLOR_MAT[m.estado]} texto={materialEstadoNombre(m.estado)} /></td>
                <td className="py-2.5 px-4 text-xs">{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Abrir ↗</a> : "—"}</td>
                <td className="py-2.5 px-4 text-right whitespace-nowrap">
                  {datos.puedeGestionar && m.estado === "pendiente" && <button onClick={() => marcar(m, "en_proceso")} className={BTN}>En proceso</button>}{" "}
                  {datos.puedeGestionar && m.estado !== "listo" && <button onClick={() => marcar(m, "listo")} className={BTN_AMBAR}>Marcar listo</button>}{" "}
                  {datos.puedeGestionar && <button onClick={() => quitar(m)} className={BTN}>Quitar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* =========================================================
   RESULTADOS
========================================================= */
function Resultados({ api, version }) {
  const [mes, setMes] = useState(mesChile());
  const { cargando, error, datos } = useCarga(() => api("marketing.resultados", { mes }), [api, mes, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const t = datos.totales;
  return (
    <>
      <Tarjeta><label className="text-sm text-stone-600 flex items-center gap-2">Mes <input type="month" value={mes} max={mesChile()} onChange={(e) => e.target.value && setMes(e.target.value)} className={`${INPUT} w-44`} /></label></Tarjeta>
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Leads por fuente · {datos.nombreMes}</h3><p className="text-xs text-stone-500 mt-1">De los leads que llegaron este mes, cuántos avanzaron.</p></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-3 px-4">Fuente</th><th className="py-3 px-4 text-right">Leads</th><th className="py-3 px-4 text-right">Cotizados</th><th className="py-3 px-4 text-right">Reservados</th><th className="py-3 px-4 text-right">Vendidos</th><th className="py-3 px-4 text-right">Conversión</th><th className="py-3 px-4 text-right">Monto vendido</th></tr></thead>
          <tbody>
            {datos.fuentes.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-stone-500">Aún no hay leads este mes.</td></tr>}
            {datos.fuentes.map((f) => (
              <tr key={f.fuente} className="border-b border-stone-100"><td className="py-2.5 px-4 text-stone-900">{f.fuente}</td><td className="py-2.5 px-4 text-right font-mono">{f.leads}</td><td className="py-2.5 px-4 text-right font-mono">{f.cotizados}</td><td className="py-2.5 px-4 text-right font-mono">{f.reservados}</td><td className="py-2.5 px-4 text-right font-mono">{f.vendidos}</td><td className="py-2.5 px-4 text-right font-mono">{pct(f.conversion)}</td><td className="py-2.5 px-4 text-right font-mono">{clp(f.monto)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Campañas</h3><p className="text-xs text-stone-500 mt-1">Gasto anotado: <strong className="font-mono">{clp(t.gasto)}</strong> · leads de campañas: <strong className="font-mono">{t.leadsDeCampanias}</strong> · ventas: <strong className="font-mono">{t.ventasDeCampanias}</strong>. Incluye todas las campañas aprobadas y finalizadas, de todas las fechas.</p></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200"><th className="py-3 px-4">Campaña</th><th className="py-3 px-4 text-right">Gasto</th><th className="py-3 px-4 text-right">Leads</th><th className="py-3 px-4 text-right">Ventas</th><th className="py-3 px-4 text-right">Costo por lead</th><th className="py-3 px-4 text-right">Costo por venta</th><th className="py-3 px-4 text-right">Monto vendido</th></tr></thead>
          <tbody>
            {datos.campanias.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-stone-500">Aún no hay campañas aprobadas.</td></tr>}
            {datos.campanias.map((c) => (
              <tr key={c.id} className="border-b border-stone-100"><td className="py-2.5 px-4 text-stone-900">{c.nombre}<div className="text-xs text-stone-500">{canalNombre(c.canal)}</div></td><td className="py-2.5 px-4 text-right font-mono">{clp(c.gasto)}</td><td className="py-2.5 px-4 text-right font-mono">{c.metricas.leads}</td><td className="py-2.5 px-4 text-right font-mono">{c.metricas.ventas}</td><td className="py-2.5 px-4 text-right font-mono">{clp(c.metricas.costoPorLead)}</td><td className="py-2.5 px-4 text-right font-mono">{clp(c.metricas.costoPorVenta)}</td><td className="py-2.5 px-4 text-right font-mono">{clp(c.metricas.monto)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Publicaciones del mes: {datos.publicaciones.porEstado.publicada} publicadas, {datos.publicaciones.porEstado.programada} programadas. {Object.entries(datos.publicaciones.porRed).map(([r, n]) => `${canalNombre(r)} ${n}`).join(" · ")}</p>
    </>
  );
}

/* =========================================================
   MÓDULO
========================================================= */
export function ModuloMarketing({ api: apiProp, permisos = [], esAdmin = false }) {
  const puedeGestionar = !esAdmin && permisos.includes("marketing.gestionar");
  const puedeAprobar = esAdmin || permisos.includes("leads.asignar");
  const api = apiProp || apiPorDefecto;
  const [tab, setTab] = useState(puedeGestionar ? "calendario" : "campanias");
  const [version, setVersion] = useState(0);
  const subir = () => setVersion((v) => v + 1);
  const inv = useCarga(() => api("inventario.list").then((r) => r.vehiculos).catch(() => []), [api]);
  const camp = useCarga(() => api("marketing.campanias.list").then((r) => r.campanias).catch(() => []), [api, version]);
  const pendientes = (camp.datos || []).filter((c) => c.estado === "pendiente").length;
  const vehiculos = (inv.datos || []).filter((v) => v.estado !== "vendido");
  const campaniasActivas = (camp.datos || []).filter((c) => c.estado === "aprobada");
  const opciones = [["calendario", "Calendario"], ["campanias", "Campañas", puedeAprobar ? pendientes : 0], ["material", "Material"], ["resultados", "Resultados"]];
  return (
    <div className="flex flex-col gap-5">
      <Pestanas valor={tab} onCambio={setTab} opciones={opciones} />
      {tab === "calendario" && <Calendario api={api} puedeGestionar={puedeGestionar} version={version} onCambio={subir} campanias={campaniasActivas} vehiculos={vehiculos} />}
      {tab === "campanias" && <Campanias api={api} puedeGestionar={puedeGestionar} puedeAprobar={puedeAprobar} version={version} onCambio={subir} />}
      {tab === "material" && <Material api={api} puedeGestionar={puedeGestionar || puedeAprobar} vehiculos={vehiculos} version={version} onCambio={subir} />}
      {tab === "resultados" && <Resultados api={api} version={version} />}
    </div>
  );
}
