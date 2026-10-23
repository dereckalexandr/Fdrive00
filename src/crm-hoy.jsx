/**
 * HOY · qué hacer ahora con cada lead
 * ----------------------------------------------------------------
 * Los leads abiertos ordenados por urgencia (primer contacto, acción vencida, de hoy, sin próxima acción, programados), cada uno con su
 * próxima acción y botones directos (llamar, WhatsApp, nota, hecha, agendar). Todo lead abierto debería tener un siguiente paso agendado:
 * después de registrar un contacto, cambiar de etapa o dar por hecha una tarea, se pregunta «¿cuál es el siguiente paso?».
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { GRUPOS_HOY, TIPOS_TAREA, TIPOS_CONTACTO } from "../supabase/functions/api/ventas-core.js";
import { etapaNombre } from "../supabase/functions/api/ventas-core.js";
import { etapaDeOperacion } from "../supabase/functions/api/compras-core.js";
import { INPUT, BTN, BTN_AMBAR, BTN_PRIMARIO, Aviso, Cargando, Campo, Modal, useCarga, mensajeError, apiPorDefecto, hace } from "./crm-ui.jsx";

const soloDigitos = (s) => String(s || "").replace(/\D/g, "");
const waNumero = (tel) => { const d = soloDigitos(tel); return d.length === 9 ? `56${d}` : d; };

/* ---------- fechas ---------- */
const p2 = (n) => String(n).padStart(2, "0");
const aInputFecha = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
/** A las 10:00 dentro de `dias` días; si cae domingo, pasa al lunes. */
export function fechaProxima(dias, desde = new Date()) {
  const d = new Date(desde);
  d.setDate(d.getDate() + dias);
  d.setHours(10, 0, 0, 0);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}
const cuando = (iso) => {
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  const man = new Date(hoy); man.setDate(man.getDate() + 1);
  const hora = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (mismoDia) return `hoy ${hora}`;
  if (d.toDateString() === man.toDateString()) return `mañana ${hora}`;
  return `${d.toLocaleDateString("es-CL", { weekday: "short", day: "2-digit", month: "short" })} ${hora}`;
};

/* =========================================================
   «¿Cuál es el siguiente paso?»
========================================================= */
const ATAJOS = [
  { id: "ll1", texto: "Llamar mañana", tipo: "llamada", dias: 1, titulo: (c) => `Llamar a ${c}` },
  { id: "ll2", texto: "Llamar en 2 días", tipo: "llamada", dias: 2, titulo: (c) => `Llamar a ${c}` },
  { id: "wa2", texto: "WhatsApp en 2 días", tipo: "whatsapp", dias: 2, titulo: (c) => `Escribir por WhatsApp a ${c}` },
  { id: "seg7", texto: "Seguimiento en 1 semana", tipo: "llamada", dias: 7, titulo: (c) => `Dar seguimiento a ${c}` },
];

export function ProximaAccionModal({ api = apiPorDefecto, leadId, cliente = "el cliente", titulo = "¿Cuál es el siguiente paso?", onCerrar, onAgendada }) {
  const [otra, setOtra] = useState(false);
  const [f, setF] = useState({ titulo: "", tipo: "llamada", venceEn: aInputFecha(fechaProxima(1)) });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const agendar = async (datos) => {
    setOcupado(true); setError("");
    try {
      await api("tareas.create", { leadId, titulo: datos.titulo, tipo: datos.tipo, venceEn: new Date(datos.venceEn).toISOString() });
      if (onAgendada) await onAgendada();
      onCerrar();
    } catch (e) { setError(mensajeError(e)); setOcupado(false); }
  };
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} ancho="max-w-md">
      <p className="text-sm text-stone-600">Deja agendado qué sigue con <strong>{cliente}</strong>: así ningún lead se queda esperando.</p>
      <div className="grid grid-cols-2 gap-2">
        {ATAJOS.map((a) => (
          <button key={a.id} disabled={ocupado} onClick={() => agendar({ titulo: a.titulo(cliente), tipo: a.tipo, venceEn: aInputFecha(fechaProxima(a.dias)) })} className={`${BTN} text-left py-2.5`}>
            <span className="block font-medium text-stone-900">{a.texto}</span>
            <span className="block text-xs text-stone-500">{cuando(fechaProxima(a.dias).toISOString())}</span>
          </button>
        ))}
      </div>
      {!otra ? <button onClick={() => setOtra(true)} className="text-sm text-amber-700 underline underline-offset-2 self-start">Elegir otra fecha o tipo de acción</button> : (
        <div className="flex flex-col gap-3 border border-stone-200 bg-stone-50 p-3 rounded-xl">
          <Campo etiqueta="¿Qué hay que hacer?"><input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={INPUT} placeholder="Ej. Enviar la cotización" autoFocus /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Tipo"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={INPUT}>{TIPOS_TAREA.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Cuándo"><input type="datetime-local" value={f.venceEn} onChange={(e) => setF({ ...f, venceEn: e.target.value })} className={INPUT} /></Campo>
          </div>
          <button disabled={ocupado || f.titulo.trim().length < 3 || !f.venceEn} onClick={() => agendar(f)} className={BTN_PRIMARIO}>Agendar</button>
        </div>
      )}
      {error && <Aviso>{error}</Aviso>}
      <button onClick={onCerrar} className="text-xs text-stone-500 hover:underline self-start">Ahora no (el lead quedará marcado «sin próxima acción»)</button>
    </Modal>
  );
}

/* =========================================================
   Registrar un contacto
========================================================= */
const RESULTADOS = { llamada: ["Contestó", "No contestó", "Dejé mensaje"], whatsapp: ["Escribí por WhatsApp", "Respondió", "Visto, sin respuesta"], visita: ["Vino al local", "Reagendó"] };

export function RegistrarContactoModal({ api = apiPorDefecto, lead, tipoInicial = "llamada", onCerrar, onRegistrado }) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [detalle, setDetalle] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [siguiente, setSiguiente] = useState(false);
  const guardar = async () => {
    setOcupado(true); setError("");
    try {
      const r = await api("leads.nota", { id: lead.id, tipo, detalle });
      if (onRegistrado) await onRegistrado();
      if (r.pedirProximaAccion) setSiguiente(true); else onCerrar();
    } catch (e) { setError(mensajeError(e)); setOcupado(false); }
  };
  if (siguiente) return <ProximaAccionModal api={api} leadId={lead.id} cliente={lead.cliente.nombre} onCerrar={onCerrar} onAgendada={onRegistrado} />;
  return (
    <Modal titulo={`Registrar contacto · ${lead.cliente.nombre}`} onCerrar={onCerrar} ancho="max-w-md">
      <Campo etiqueta="¿Cómo fue?"><select value={tipo} onChange={(e) => setTipo(e.target.value)} className={INPUT}>{TIPOS_CONTACTO.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
      {(RESULTADOS[tipo] || []).length > 0 && (
        <div className="flex flex-wrap gap-2">{RESULTADOS[tipo].map((r) => <button key={r} type="button" onClick={() => setDetalle(r)} className={`${BTN} ${detalle === r ? "!bg-stone-900 !text-white" : ""}`}>{r}</button>)}</div>
      )}
      <Campo etiqueta={tipo === "nota" ? "Nota" : "Detalle (opcional)"}><textarea rows={3} maxLength={500} value={detalle} onChange={(e) => setDetalle(e.target.value)} className={INPUT} autoFocus /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button disabled={ocupado || (tipo === "nota" && !detalle.trim())} onClick={guardar} className={BTN_AMBAR}>{ocupado ? "Guardando…" : "Guardar"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* =========================================================
   Vista «Hoy»
========================================================= */
const ESTILO_GRUPO = {
  sin_contacto: { barra: "border-l-rose-500", chip: "bg-rose-100 text-rose-800", punto: "bg-rose-500" },
  por_atender: { barra: "border-l-sky-500", chip: "bg-sky-100 text-sky-800", punto: "bg-sky-500" },
  vencida: { barra: "border-l-orange-500", chip: "bg-orange-100 text-orange-800", punto: "bg-orange-500" },
  hoy: { barra: "border-l-amber-400", chip: "bg-amber-100 text-amber-800", punto: "bg-amber-400" },
  sin_accion: { barra: "border-l-violet-500", chip: "bg-violet-100 text-violet-800", punto: "bg-violet-500" },
  programada: { barra: "border-l-stone-300", chip: "bg-stone-100 text-stone-600", punto: "bg-stone-300" },
};
const TEXTO_TIPO = { llamada: "Llamar", whatsapp: "WhatsApp", visita: "Visita", otro: "Acción" };

function FilaHoy({ l, mostrarAsignado, onAbrir, onContacto, onHecha, onAgendar }) {
  const est = ESTILO_GRUPO[l.grupo];
  const tel = l.cliente.telefono;
  return (
    <div className={`bg-white border border-stone-200 border-l-4 ${est.barra} rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-3 hover:shadow-suave`}>
      <button type="button" onClick={onAbrir} className="text-left min-w-0 md:w-[34%]">
        <p className="font-medium text-stone-900 truncate">{l.cliente.nombre}{l.tipo !== "venta" && <span className="ml-2 text-[10px] uppercase bg-stone-900 text-white px-1.5 py-0.5 align-middle rounded">{l.tipo === "compra" ? "Compra" : "Consignación"}</span>}</p>
        <p className="text-xs text-stone-500 truncate">{l.vehiculo || "Sin vehículo definido"}</p>
        <p className="text-[11px] text-stone-400 truncate">
          {etapaDeOperacion(l.tipo, l.etapa, etapaNombre(l.etapa))}{l.fuente ? ` · ${l.fuente}` : ""} · llegó {hace(l.creado_en)}
          {mostrarAsignado && <span className={l.asignado ? "" : "text-rose-600"}> · {l.asignado ? l.asignado.nombre : "Sin asignar"}</span>}
        </p>
      </button>

      <div className="md:flex-1 min-w-0 text-sm">
        {l.grupo === "sin_contacto" && <p className="text-rose-700 font-medium">Sin contactar hace {l.edadHoras < 48 ? `${Math.floor(l.edadHoras)} h` : `${Math.floor(l.edadHoras / 24)} d`}{l.nivelJefe && <span className="ml-2 text-[10px] uppercase bg-rose-600 text-white px-1.5 py-0.5 rounded">avisado al jefe</span>}</p>}
        {l.grupo === "por_atender" && <p className="text-sky-700 font-medium">Recién llegó: contáctalo pronto</p>}
        {l.proxima && (
          <p className={l.grupo === "vencida" ? "text-orange-700" : "text-stone-700"}>
            <span className="font-medium">{TEXTO_TIPO[l.proxima.tipo] || "Acción"}:</span> {l.proxima.titulo} <span className="text-stone-500">· {l.grupo === "vencida" ? "venció " : ""}{cuando(l.proxima.vence_en)}</span>
          </p>
        )}
        {!l.proxima && l.grupo !== "sin_contacto" && l.grupo !== "por_atender" && <p className="text-violet-700">Sin próxima acción: define el siguiente paso.</p>}
        {l.estancado && <p className="text-[11px] text-rose-600">Estancado: lleva días sin actividad.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        {tel && <a href={`tel:${tel}`} onClick={() => onContacto("llamada")} className={BTN} title="Llamar">📞 Llamar</a>}
        {tel && <a href={`https://wa.me/${waNumero(tel)}`} target="_blank" rel="noreferrer" onClick={() => onContacto("whatsapp")} className={BTN} title="WhatsApp">💬</a>}
        <button onClick={() => onContacto("nota")} className={BTN} title="Registrar nota o contacto">📝</button>
        {l.proxima && <button onClick={onHecha} className={BTN} title="Dar por hecha la próxima acción">✔ Hecha</button>}
        <button onClick={onAgendar} className={BTN} title={l.proxima ? "Agendar otra acción" : "Agendar la próxima acción"}>{l.proxima ? "＋ Agendar" : "Agendar"}</button>
      </div>
    </div>
  );
}

export function Hoy({ api = apiPorDefecto, catalogos, abrirLead, version, onCambio }) {
  const [todos, setTodos] = useState(!!(catalogos && catalogos.puedeAsignar));
  const [filtro, setFiltro] = useState("");
  const [modal, setModal] = useState(null); // { tipo: "contacto" | "agendar", lead, contacto }
  const [msg, setMsg] = useState("");
  const { cargando, error, datos, recargar } = useCarga(() => api("leads.hoy", { todos }), [api, todos, version]);

  const refrescar = async () => { await recargar(); if (onCambio) onCambio(); };
  const hecha = async (l) => {
    setMsg("");
    try {
      const r = await api("tareas.hecha", { id: l.proxima.id, hecha: true });
      await refrescar();
      if (r.pedirProximaAccion) setModal({ tipo: "agendar", lead: l });
    } catch (e) { setMsg(mensajeError(e)); }
  };

  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (!datos) return <Cargando />;
  const visibles = datos.leads.filter((l) => !filtro || l.grupo === filtro);
  const urgentes = datos.resumen.sin_contacto + datos.resumen.vencida;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-stone-200 p-4 flex flex-wrap items-center gap-3">
        <div>
          <p className="font-serif text-lg text-stone-900">Qué hacer hoy</p>
          <p className="text-xs text-stone-500">{datos.total} lead{datos.total === 1 ? "" : "s"} abierto{datos.total === 1 ? "" : "s"}{urgentes > 0 ? ` · ${urgentes} urgente${urgentes === 1 ? "" : "s"}` : " · todo al día"}</p>
        </div>
        {datos.veTodo && (
          <div className="flex border border-stone-300 rounded-lg overflow-hidden ml-auto">
            <button onClick={() => setTodos(false)} className={`px-3 py-1.5 text-sm ${!todos ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Mis leads</button>
            <button onClick={() => setTodos(true)} className={`px-3 py-1.5 text-sm ${todos ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Todo el local</button>
          </div>
        )}
        <button onClick={refrescar} className={BTN}>Actualizar</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFiltro("")} className={`px-3 py-1.5 text-sm rounded-full border ${!filtro ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-700 border-stone-300"}`}>Todos ({datos.total})</button>
        {GRUPOS_HOY.map((g) => (
          <button key={g.id} onClick={() => setFiltro(filtro === g.id ? "" : g.id)} disabled={!datos.resumen[g.id]} title={g.ayuda}
            className={`px-3 py-1.5 text-sm rounded-full border flex items-center gap-2 disabled:opacity-40 ${filtro === g.id ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-700 border-stone-300"}`}>
            <span className={`w-2 h-2 rounded-full ${ESTILO_GRUPO[g.id].punto}`} />{g.nombre} <span className="text-xs opacity-70">{datos.resumen[g.id]}</span>
          </button>
        ))}
      </div>
      {msg && <Aviso>{msg}</Aviso>}

      {datos.total === 0 ? (
        <div className="bg-white border border-stone-200 p-10 text-center text-stone-500 text-sm">No hay leads abiertos. Cuando lleguen nuevos, aparecerán aquí ordenados por urgencia.</div>
      ) : GRUPOS_HOY.filter((g) => !filtro || g.id === filtro).map((g) => {
        const filas = visibles.filter((l) => l.grupo === g.id);
        if (filas.length === 0) return null;
        return (
          <section key={g.id} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="font-serif text-base text-stone-900 flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${ESTILO_GRUPO[g.id].punto}`} />{g.nombre}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${ESTILO_GRUPO[g.id].chip}`}>{filas.length}</span>
              <span className="text-xs text-stone-500">{g.ayuda}</span>
            </div>
            {filas.map((l) => (
              <FilaHoy key={l.id} l={l} mostrarAsignado={todos} onAbrir={() => abrirLead(l.id)}
                onContacto={(tipo) => setModal({ tipo: "contacto", lead: l, contacto: tipo })} onHecha={() => hecha(l)} onAgendar={() => setModal({ tipo: "agendar", lead: l })} />
            ))}
          </section>
        );
      })}

      {modal && modal.tipo === "contacto" && <RegistrarContactoModal api={api} lead={modal.lead} tipoInicial={modal.contacto} onCerrar={() => setModal(null)} onRegistrado={refrescar} />}
      {modal && modal.tipo === "agendar" && <ProximaAccionModal api={api} leadId={modal.lead.id} cliente={modal.lead.cliente.nombre} titulo={modal.lead.proxima ? "Agendar otra acción" : "¿Cuál es el siguiente paso?"} onCerrar={() => setModal(null)} onAgendada={refrescar} />}
    </div>
  );
}
