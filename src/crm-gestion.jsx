/**
 * PANEL DE GESTIÓN DEL JEFE LOCAL (CRM · entrega 3)
 * ----------------------------------------------------------------
 * - Alertas: leads sin atender, detenidos, sin dueño, tareas vencidas del equipo y reservas por vencer.
 * - Acciones en lote: reasignar varios leads a otra persona y dejar avisos a los ejecutivos.
 * - Embudo del mes, rendimiento por fuente de lead, motivos de pérdida y actividad de cada ejecutivo.
 * El servidor calcula todo (y valida que solo el supervisor del local lo use); aquí solo se muestra.
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { mesChile, edadTexto, textoVencimiento, etapaNombre } from "../supabase/functions/api/ventas-core.js";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, fechaHora, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, useCarga, mensajeError } from "./crm-ui.jsx";

/* =========================================================
   AVISO AL EJECUTIVO
========================================================= */
function AvisarModal({ api, destinatarios, para, leadId, cliente, onCerrar, onEnviado }) {
  const [dest, setDest] = useState(para || "");
  const [texto, setTexto] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setError("");
    setEnviando(true);
    try { await api("avisos.crear", { para: dest || undefined, leadId: leadId || undefined, texto }); onEnviado(); }
    catch (e) { setError(mensajeError(e)); }
    setEnviando(false);
  };
  return (
    <Modal titulo="Dejar un aviso" onCerrar={onCerrar} ancho="max-w-lg">
      {cliente && <p className="text-sm text-stone-600">Sobre el lead de <strong>{cliente}</strong>. El aviso también queda en su historial.</p>}
      <Campo etiqueta="Para">
        <select value={dest} onChange={(e) => setDest(e.target.value)} className={INPUT}>
          <option value="">Elegir ejecutivo…</option>{destinatarios.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Mensaje" ayuda={`${texto.length}/300`}>
        <textarea rows={3} maxLength={300} value={texto} onChange={(e) => setTexto(e.target.value)} className={INPUT} placeholder="Ej.: Este cliente llamó dos veces, atiéndelo hoy." autoFocus />
      </Campo>
      <p className="text-xs text-stone-500">La persona lo verá en su inicio hasta que lo marque como leído.</p>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={enviar} disabled={enviando || texto.trim().length < 3 || !dest} className={BTN_AMBAR}>{enviando ? "Enviando…" : "Enviar aviso"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/** Avisos pendientes del supervisor, en el inicio de cada ejecutivo. */
export function AvisosDelSupervisor({ api, version, abrirLead }) {
  const { datos, recargar } = useCarga(() => api("avisos.mios").catch(() => ({ avisos: [] })), [api, version]);
  const [ocupado, setOcupado] = useState("");
  if (!datos || datos.avisos.length === 0) return null;
  const leer = async (id) => { setOcupado(id); try { await api("avisos.leer", { id }); await recargar(); } catch (e) { /* queda visible */ } setOcupado(""); };
  return (
    <div className="border border-amber-300 bg-amber-50 p-4 flex flex-col gap-2">
      <p className="text-sm font-medium text-stone-900">Avisos de tu supervisor ({datos.avisos.length})</p>
      {datos.avisos.map((a) => (
        <div key={a.id} className="flex flex-wrap items-start gap-3 text-sm bg-white border border-amber-200 p-3">
          <div className="flex-1 min-w-[200px]">
            <p className="text-stone-900">{a.texto}</p>
            <p className="text-xs text-stone-500 mt-1">{a.de_nombre} · {fechaHora(a.creado_en)}{a.cliente ? ` · lead de ${a.cliente}` : ""}</p>
          </div>
          {a.lead_id && <button onClick={() => abrirLead(a.lead_id)} className={BTN}>Abrir lead</button>}
          <button disabled={ocupado === a.id} onClick={() => leer(a.id)} className={BTN_PRIMARIO}>Entendido</button>
        </div>
      ))}
    </div>
  );
}

/** Franja de alertas para el supervisor en su inicio. */
export function FranjaAlertas({ resumen, onVer }) {
  if (!resumen) return null;
  const c = resumen.conteos;
  const partes = [
    [c.sinAtender, "sin atender"], [c.detenidos, "detenidos"], [c.sinAsignar, "sin asignar"],
    [c.tareasVencidas, "tareas vencidas del equipo"], [c.reservasPorVencer, "reservas por vencer"], [c.tasacionesSinTomar, "tasaciones sin tomar"],
  ].filter(([n]) => n > 0);
  if (partes.length === 0) return null;
  return (
    <button onClick={onVer} className="text-left border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 hover:bg-rose-100">
      <strong>Requiere tu atención:</strong> {partes.map(([n, t]) => `${n} ${t}`).join(" · ")} <span className="underline ml-1">Ver el panel de gestión →</span>
    </button>
  );
}

/* =========================================================
   ALERTAS
========================================================= */
const TIPOS = [
  { id: "sinAtender", nombre: "Sin atender", color: "border-rose-400", ayuda: (c) => `Leads nuevos sin ningún contacto hace ${c.horas_sin_contacto} h o más.` },
  { id: "detenidos", nombre: "Detenidos", color: "border-amber-400", ayuda: (c) => `Leads contactados, en seguimiento o cotizados sin actividad hace ${c.dias_detenido} días o más.` },
  { id: "sinAsignar", nombre: "Sin asignar", color: "border-violet-400", ayuda: () => "Leads sin ejecutivo (por ejemplo, cuando nadie estaba habilitado para recibirlos)." },
  { id: "tareasVencidas", nombre: "Tareas vencidas", color: "border-orange-400", ayuda: () => "Llamadas y visitas del equipo cuya fecha ya pasó." },
  { id: "reservasPorVencer", nombre: "Reservas por vencer", color: "border-sky-400", ayuda: () => "Reservas que vencen en las próximas 48 horas: decide si se extienden." },
  { id: "tasacionesSinTomar", nombre: "Tasaciones sin tomar", color: "border-teal-400", ayuda: (c) => `Solicitudes de tasación que llevan ${c.horas_tasacion} h o más en la cola sin que un Tasador las tome.` },
];

function Alertas({ api, abrirLead, version, onCambio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("gestion.resumen"), [api, version]);
  const [tipo, setTipo] = useState("sinAtender");
  const [sel, setSel] = useState([]);
  const [destino, setDestino] = useState("auto");
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [avisar, setAvisar] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const { datos: equipoLeads } = useCarga(() => api("equipo").catch(() => ({ equipo: [] })), [api]);

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const c = datos.conteos;
  const destinatarios = (equipoLeads && equipoLeads.equipo) || [];
  const esLeads = ["sinAtender", "detenidos", "sinAsignar"].includes(tipo);
  const lista = datos[tipo] || [];
  const actual = TIPOS.find((t) => t.id === tipo);

  const cambiarTipo = (t) => { setTipo(t); setSel([]); setMsg({ tipo: "", texto: "" }); };
  const alternar = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const todos = () => setSel(sel.length === lista.length ? [] : lista.map((l) => l.id));

  const reasignar = async () => {
    setMsg({ tipo: "", texto: "" }); setOcupado(true);
    try {
      const r = await api("leads.reasignarLote", { ids: sel, asignarA: destino });
      const k = r.omitidos.length;
      const om = k ? ` ${k} no se ${k === 1 ? "movió" : "movieron"} (cerrado${k === 1 ? "" : "s"}, con un cierre en curso, o ya ${k === 1 ? "era" : "eran"} de esa persona).` : "";
      setMsg({ tipo: "ok", texto: `${r.reasignados} lead(s) reasignado(s).${om}` });
      setSel([]); await recargar(); onCambio();
    } catch (e) { setMsg({ tipo: "error", texto: mensajeError(e) }); }
    setOcupado(false);
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {TIPOS.map((t) => (
          <button key={t.id} onClick={() => cambiarTipo(t.id)} className={`text-left bg-white border-2 p-4 ${tipo === t.id ? t.color : "border-stone-200"} hover:border-stone-400`}>
            <p className="text-[11px] uppercase tracking-widest text-stone-400">{t.nombre}</p>
            <p className={`font-mono text-3xl mt-1 ${c[t.id] > 0 ? "text-stone-900" : "text-stone-300"}`}>{c[t.id]}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-stone-500">{actual.ayuda(datos.config)} Los plazos se cambian en Configuración. Hay {c.abiertos} leads abiertos en total.</p>

      {msg.texto && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {esLeads && sel.length > 0 && (
        <div className="bg-stone-900 text-stone-100 p-3 flex flex-wrap items-center gap-3 text-sm">
          <span>{sel.length} seleccionado(s)</span>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className="bg-white text-stone-900 border border-stone-300 px-2 py-1.5 text-sm">
            <option value="auto">Reparto automático</option>{destinatarios.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
          <button onClick={reasignar} disabled={ocupado} className={BTN_AMBAR}>{ocupado ? "Reasignando…" : "Reasignar"}</button>
          <button onClick={() => setSel([])} className="underline text-stone-300">Quitar selección</button>
        </div>
      )}

      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              {esLeads && <th className="py-3 px-3 w-8"><input type="checkbox" checked={lista.length > 0 && sel.length === lista.length} onChange={todos} aria-label="Seleccionar todos" /></th>}
              {esLeads && <><th className="py-3 px-3">Cliente</th><th className="py-3 px-3">Ejecutivo</th><th className="py-3 px-3">Etapa</th><th className="py-3 px-3">{tipo === "detenidos" ? "Sin actividad" : "Llegó"}</th><th className="py-3 px-3"></th></>}
              {tipo === "tareasVencidas" && <><th className="py-3 px-3">Tarea</th><th className="py-3 px-3">Cliente</th><th className="py-3 px-3">Ejecutivo</th><th className="py-3 px-3">Venció</th><th className="py-3 px-3"></th></>}
              {tipo === "tasacionesSinTomar" && <><th className="py-3 px-3">Tasación</th><th className="py-3 px-3">Vehículo</th><th className="py-3 px-3">Cliente</th><th className="py-3 px-3">Pidió</th><th className="py-3 px-3">Espera</th></>}
              {tipo === "reservasPorVencer" && <><th className="py-3 px-3">Vehículo</th><th className="py-3 px-3">Cliente</th><th className="py-3 px-3">Ejecutivo</th><th className="py-3 px-3">Reserva</th><th className="py-3 px-3"></th></>}
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">Nada que atender aquí. 👌</td></tr>}
            {esLeads && lista.map((l) => (
              <tr key={l.id} className="border-b border-stone-100">
                <td className="py-2.5 px-3"><input type="checkbox" checked={sel.includes(l.id)} onChange={() => alternar(l.id)} aria-label="Seleccionar" /></td>
                <td className="py-2.5 px-3"><button onClick={() => abrirLead(l.id)} className="text-stone-900 underline decoration-dotted text-left">{l.cliente}</button><div className="text-xs text-stone-500">{l.fuente || "Sin fuente"}</div></td>
                <td className={`py-2.5 px-3 ${l.ejecutivo ? "text-stone-700" : "text-rose-600"}`}>{l.ejecutivo || "Sin asignar"}</td>
                <td className="py-2.5 px-3 text-stone-700">{etapaNombre(l.etapa)}</td>
                <td className="py-2.5 px-3 text-stone-600 whitespace-nowrap">{edadTexto(tipo === "detenidos" ? l.ultima_actividad : l.creado_en)}</td>
                <td className="py-2.5 px-3 text-right">{l.asignado_a && <button onClick={() => setAvisar({ para: l.asignado_a, leadId: l.id, cliente: l.cliente })} className={BTN}>Avisar</button>}</td>
              </tr>
            ))}
            {tipo === "tareasVencidas" && lista.map((t) => (
              <tr key={t.id} className="border-b border-stone-100">
                <td className="py-2.5 px-3 text-stone-900">{t.titulo}</td><td className="py-2.5 px-3 text-stone-700">{t.cliente}</td>
                <td className="py-2.5 px-3 text-stone-700">{t.ejecutivo}</td><td className="py-2.5 px-3 text-rose-700 whitespace-nowrap">{fechaHora(t.vence_en)}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button onClick={() => abrirLead(t.lead_id)} className={BTN}>Abrir lead</button>{" "}
                  {t.asignado_a && <button onClick={() => setAvisar({ para: t.asignado_a, leadId: t.lead_id, cliente: t.cliente })} className={BTN}>Avisar</button>}
                </td>
              </tr>
            ))}
            {tipo === "tasacionesSinTomar" && lista.map((t) => (
              <tr key={t.id} className="border-b border-stone-100">
                <td className="py-2.5 px-3 font-mono text-xs text-stone-500">{t.folio}</td><td className="py-2.5 px-3 text-stone-900">{t.vehiculo}</td><td className="py-2.5 px-3 text-stone-700">{t.cliente}</td>
                <td className="py-2.5 px-3 text-stone-700">{t.solicitante}</td><td className="py-2.5 px-3 text-rose-700 whitespace-nowrap">{edadTexto(t.solicitada_en)}</td>
              </tr>
            ))}
            {tipo === "reservasPorVencer" && lista.map((r) => (
              <tr key={r.id} className="border-b border-stone-100">
                <td className="py-2.5 px-3 text-stone-900">{r.vehiculo}</td><td className="py-2.5 px-3 text-stone-700">{r.cliente}</td><td className="py-2.5 px-3 text-stone-700">{r.ejecutivo}</td>
                <td className="py-2.5 px-3 whitespace-nowrap"><span className="font-mono">{clp(r.monto)}</span> · <span className="text-sky-700">{textoVencimiento(r.vence_en)}</span></td>
                <td className="py-2.5 px-3 text-right"><button onClick={() => abrirLead(r.lead_id)} className={BTN}>Abrir lead</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {datos.conteos[tipo] > lista.length && <p className="text-xs text-stone-500">Se muestran los primeros {lista.length} de {datos.conteos[tipo]}.</p>}

      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Carga por ejecutivo</h3></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Ejecutivo</th><th className="py-3 px-4 text-right">Leads abiertos</th><th className="py-3 px-4 text-right">Sin atender</th><th className="py-3 px-4 text-right">Detenidos</th>
            <th className="py-3 px-4 text-right">Tareas vencidas</th><th className="py-3 px-4 text-right">Reservas por vencer</th><th className="py-3 px-4"></th>
          </tr></thead>
          <tbody>
            {datos.equipo.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-stone-500">No hay ejecutivos habilitados para ventas.</td></tr>}
            {datos.equipo.map((e) => {
              const n = (v) => (v > 0 ? <span className="text-rose-700 font-semibold">{v}</span> : <span className="text-stone-300">0</span>);
              return (
                <tr key={e.id || "sin"} className="border-b border-stone-100">
                  <td className={`py-2.5 px-4 ${e.id ? "text-stone-900" : "text-rose-600"}`}>{e.nombre}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{e.abiertos}</td><td className="py-2.5 px-4 text-right font-mono">{n(e.sinAtender)}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{n(e.detenidos)}</td><td className="py-2.5 px-4 text-right font-mono">{n(e.tareasVencidas)}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{n(e.reservasPorVencer)}</td>
                  <td className="py-2.5 px-4 text-right">{e.id && <button onClick={() => setAvisar({ para: e.id })} className={BTN}>Avisar</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {avisar && <AvisarModal api={api} destinatarios={destinatarios} para={avisar.para} leadId={avisar.leadId} cliente={avisar.cliente} onCerrar={() => setAvisar(null)}
        onEnviado={() => { setAvisar(null); setMsg({ tipo: "ok", texto: "Aviso enviado." }); }} />}
    </>
  );
}

/* =========================================================
   EMBUDO, FUENTES Y ACTIVIDAD
========================================================= */
function SelectorMes({ mes, setMes }) {
  return (
    <Tarjeta>
      <label className="text-sm text-stone-600 flex items-center gap-2">Mes <input type="month" value={mes} max={mesChile()} onChange={(e) => e.target.value && setMes(e.target.value)} className={`${INPUT} w-44`} /></label>
      <p className="text-xs text-stone-500 mt-2">Se miden los leads que <strong>llegaron</strong> ese mes y hasta dónde avanzaron (aunque se vendan después).</p>
    </Tarjeta>
  );
}

function Embudo({ api, version }) {
  const [mes, setMes] = useState(mesChile());
  const { cargando, error, datos } = useCarga(() => api("gestion.embudo", { mes }), [api, mes, version]);
  if (cargando && !datos) return <><SelectorMes mes={mes} setMes={setMes} /><Cargando /></>;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const COLORES = ["bg-stone-700", "bg-sky-600", "bg-violet-600", "bg-amber-500", "bg-emerald-600"];
  return (
    <>
      <SelectorMes mes={mes} setMes={setMes} />
      <Tarjeta titulo={`Embudo de ${datos.nombreMes}`} ayuda={datos.embudo.total === 0 ? "No llegaron leads este mes." : `${datos.embudo.perdidos} lead(s) se perdieron.`}>
        <div className="flex flex-col gap-3">
          {datos.embudo.pasos.map((p, i) => (
            <div key={p.id}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-stone-800">{p.nombre}</span>
                <span className="font-mono text-stone-900">{p.n}{i > 0 && <span className="text-xs text-stone-500"> · {p.pctTotal}% del total · {p.pctPaso}% del paso anterior</span>}</span>
              </div>
              <div className="h-3 bg-stone-100 mt-1"><div className={`h-3 ${COLORES[i]}`} style={{ width: `${p.pctTotal}%` }} /></div>
            </div>
          ))}
        </div>
      </Tarjeta>

      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Rendimiento por fuente</h3><p className="text-xs text-stone-500">Qué canal trae clientes que terminan comprando.</p></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Fuente</th><th className="py-3 px-4 text-right">Leads</th><th className="py-3 px-4 text-right">Cotizados</th><th className="py-3 px-4 text-right">Reservados</th>
            <th className="py-3 px-4 text-right">Vendidos</th><th className="py-3 px-4 text-right">Conversión</th><th className="py-3 px-4 text-right">Monto vendido</th>{datos.margenVisible && <th className="py-3 px-4 text-right">Margen</th>}
          </tr></thead>
          <tbody>
            {datos.fuentes.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-stone-500">Sin leads en este mes.</td></tr>}
            {datos.fuentes.map((f) => (
              <tr key={f.fuente} className="border-b border-stone-100">
                <td className="py-2.5 px-4 text-stone-900">{f.fuente}</td><td className="py-2.5 px-4 text-right font-mono">{f.leads}</td><td className="py-2.5 px-4 text-right font-mono">{f.cotizados}</td>
                <td className="py-2.5 px-4 text-right font-mono">{f.reservados}</td><td className="py-2.5 px-4 text-right font-mono">{f.vendidos}</td>
                <td className="py-2.5 px-4 text-right font-mono">{f.conversion}%</td><td className="py-2.5 px-4 text-right font-mono">{clp(f.monto)}</td>
                {datos.margenVisible && <td className="py-2.5 px-4 text-right font-mono">{f.margen == null ? "—" : clp(f.margen)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Tarjeta titulo="Por qué se pierden los leads" ayuda={`Leads marcados como perdidos en ${datos.nombreMes}.`}>
        {datos.motivos.length === 0 ? <p className="text-sm text-stone-500">No se perdió ningún lead este mes.</p> : (
          <ul className="flex flex-col gap-2">
            {datos.motivos.map((m) => {
              const max = datos.motivos[0].n;
              return (
                <li key={m.motivo} className="text-sm">
                  <div className="flex justify-between"><span className="text-stone-800">{m.motivo}</span><span className="font-mono">{m.n}</span></div>
                  <div className="h-2 bg-stone-100 mt-1"><div className="h-2 bg-stone-500" style={{ width: `${(m.n / max) * 100}%` }} /></div>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}

function Actividad({ api, version }) {
  const [mes, setMes] = useState(mesChile());
  const { cargando, error, datos } = useCarga(() => api("gestion.embudo", { mes }), [api, mes, version]);
  if (cargando && !datos) return <><SelectorMes mes={mes} setMes={setMes} /><Cargando /></>;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  return (
    <>
      <SelectorMes mes={mes} setMes={setMes} />
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-stone-200"><h3 className="font-serif text-lg text-stone-900">Actividad de {datos.nombreMes}</h3><p className="text-xs text-stone-500">Lo que hizo cada ejecutivo en el mes.</p></div>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Ejecutivo</th><th className="py-3 px-4 text-right">Leads recibidos</th><th className="py-3 px-4 text-right">Contactos</th><th className="py-3 px-4 text-right">Cotizaciones</th>
            <th className="py-3 px-4 text-right">Reservas</th><th className="py-3 px-4 text-right">Ventas</th><th className="py-3 px-4 text-right">Tareas cumplidas</th>
          </tr></thead>
          <tbody>
            {datos.equipo.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-stone-500">No hay ejecutivos habilitados para ventas.</td></tr>}
            {datos.equipo.map((e) => (
              <tr key={e.id} className="border-b border-stone-100">
                <td className="py-2.5 px-4 text-stone-900">{e.nombre}</td><td className="py-2.5 px-4 text-right font-mono">{e.leadsRecibidos}</td><td className="py-2.5 px-4 text-right font-mono">{e.contactos}</td>
                <td className="py-2.5 px-4 text-right font-mono">{e.cotizaciones}</td><td className="py-2.5 px-4 text-right font-mono">{e.reservas}</td>
                <td className="py-2.5 px-4 text-right font-mono font-semibold">{e.ventas}</td><td className="py-2.5 px-4 text-right font-mono">{e.tareasCumplidas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Contactos = llamadas, WhatsApp y visitas registradas en las fichas. Ventas = ventas aprobadas ese mes.</p>
    </>
  );
}

/* =========================================================
   ENTRADA
========================================================= */
export function Gestion({ api, abrirLead, version, onCambio }) {
  const [vista, setVista] = useState("alertas");
  return (
    <div className="flex flex-col gap-4">
      <Pestanas valor={vista} onCambio={setVista} opciones={[["alertas", "Alertas y acciones"], ["embudo", "Embudo y fuentes"], ["actividad", "Actividad del equipo"]]} />
      {vista === "alertas" && <Alertas api={api} abrirLead={abrirLead} version={version} onCambio={onCambio} />}
      {vista === "embudo" && <Embudo api={api} version={version} />}
      {vista === "actividad" && <Actividad api={api} version={version} />}
    </div>
  );
}
