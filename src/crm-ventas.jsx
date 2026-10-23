/**
 * MÓDULO COMERCIAL (CRM · entrega 2A)
 * ----------------------------------------------------------------
 * Estación del Ejecutivo y herramientas del supervisor: inicio, embudo en columnas,
 * ficha de cada lead (contactos, tareas, historial), agenda, inventario y clientes.
 * Todo pasa por la acción "ventas" del servidor, que decide qué ve y qué puede hacer
 * cada persona; aquí solo se muestra u oculta lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { InputDinero } from "./campo-dinero.jsx";
import {
  ETAPAS, ETAPAS_ACTIVAS, TIPOS_CONTACTO, TIPOS_TAREA, ESTADOS_FINANCIAMIENTO,
  agruparTareas, claseTarea, textoVencimiento, contarPorEtapa, leadsPorAtender, etapaNombre, soloDigitos, validarCliente, validarLead, validarTarea,
} from "../supabase/functions/api/ventas-core.js";
import { Inventario, Clientes } from "./crm-inventario.jsx";
import { SeccionCotizaciones } from "./crm-cotizaciones.jsx";
import { SeccionCierres, AprobacionesTodo, Ventas, TarjetaComision } from "./crm-cierres.jsx";
import { Gestion, AvisosDelSupervisor, FranjaAlertas } from "./crm-gestion.jsx";
import { SeccionTasacion, MisTasaciones, ModuloTasaciones } from "./crm-tasaciones.jsx";
import { SeccionInspeccion, ModuloInspecciones } from "./crm-inspecciones.jsx";
import { SeccionValidacion, ModuloValidaciones } from "./crm-validaciones.jsx";
import { ModuloAnuncios } from "./crm-anuncios.jsx";
import { ModuloMarketing } from "./crm-marketing.jsx";
import { ErrorBoundary } from "./error-boundary.jsx";
import { HabilitacionesEquipo } from "./crm-equipo.jsx";
import { Hoy, ProximaAccionModal } from "./crm-hoy.jsx";
import { SeccionCompra, SeccionConsignacion, ModuloCompras } from "./crm-compras.jsx";
import { etapaDeOperacion, tipoLeadNombre, TIPOS_LEAD, validarVehiculoOfrecido } from "../supabase/functions/api/compras-core.js";
import {
  INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, fechaHora, hace, Aviso, Cargando, Tarjeta, Campo, Modal, Pestanas, NavegacionLateral, useGuardado, DatosDelDueno, CamposCondiciones, useCarga, mensajeError, CamposVehiculo, aVehiculoForm,
} from "./crm-ui.jsx";

const COLOR_ETAPA = {
  nuevo: "border-t-sky-500", contactado: "border-t-amber-500", seguimiento: "border-t-violet-500",
  cotizado: "border-t-teal-500", reservado: "border-t-orange-500", ganado: "border-t-emerald-600", perdido: "border-t-stone-400",
};

/** Número para wa.me: sin signos; si es chileno de 9 dígitos, antepone 56. */
const waNumero = (tel) => { const d = soloDigitos(tel); return d.length === 9 ? `56${d}` : d; };

function aInputFecha(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const enDias = (dias, hora = 10) => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(hora, 0, 0, 0); return d; };

/* =========================================================
   FICHA DE UN LEAD
========================================================= */
function NuevaTarea({ api, leadId, onCreada }) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("llamada");
  const [cuando, setCuando] = useState(aInputFecha(enDias(1)));
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const crear = async () => {
    setError("");
    const v = validarTarea({ titulo, tipo, venceEn: cuando });
    if (!v.ok) { setError(mensajeError({ message: v.error })); return; }
    setEnviando(true);
    try { await api("tareas.create", { leadId, titulo, tipo, venceEn: new Date(cuando).toISOString() }); setTitulo(""); onCreada(); }
    catch (e) { setError(mensajeError(e)); }
    setEnviando(false);
  };
  return (
    <div className="border border-stone-200 bg-white p-3 flex flex-col gap-2">
      <p className="text-sm text-stone-700">Agendar una tarea</p>
      <div className="flex flex-col md:flex-row gap-2">
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Llamar para confirmar visita" className={INPUT} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${INPUT} md:w-52`}>{TIPOS_TAREA.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" value={cuando} onChange={(e) => setCuando(e.target.value)} className={`${INPUT} md:w-60`} />
        <button type="button" onClick={() => setCuando(aInputFecha(enDias(0, new Date().getHours() + 2)))} className={BTN}>En 2 h</button>
        <button type="button" onClick={() => setCuando(aInputFecha(enDias(1)))} className={BTN}>Mañana</button>
        <button type="button" onClick={() => setCuando(aInputFecha(enDias(3)))} className={BTN}>En 3 días</button>
        <button type="button" onClick={() => setCuando(aInputFecha(enDias(7)))} className={BTN}>En 1 semana</button>
        <button onClick={crear} disabled={enviando} className={`${BTN_PRIMARIO} ml-auto`}>Agendar</button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}

function LeadFicha({ api, leadId, catalogos, onCerrar, onCambio, onEditar }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("leads.get", { id: leadId }), [api, leadId]);
  const [equipo, setEquipo] = useState([]);
  const [msg, setMsg] = useState("");
  const [tipo, setTipo] = useState("llamada");
  const [detalle, setDetalle] = useState("");
  const [motivo, setMotivo] = useState("");
  const [pidePerdida, setPidePerdida] = useState(false);
  const [siguiente, setSiguiente] = useState(false);

  const puedeAsignar = datos && datos.puedeEditar && catalogos.puedeAsignar;
  useEffect(() => {
    if (!catalogos.puedeAsignar) return;
    api("equipo").then((r) => setEquipo(r.equipo)).catch(() => {});
  }, [api, catalogos.puedeAsignar]);

  if (cargando && !datos) return <Modal titulo="Lead" onCerrar={onCerrar}><Cargando /></Modal>;
  if (error && !datos) return <Modal titulo="Lead" onCerrar={onCerrar}><Aviso>{error}</Aviso></Modal>;
  const { lead, cliente, vehiculo, asignado, eventos, tareas, puedeEditar } = datos;
  const cerrado = lead.etapa === "ganado" || lead.etapa === "perdido";
  const tipoLead = lead.tipo || "venta";
  const esVenta = tipoLead === "venta";
  const ofrecido = lead.vehiculo_ofrecido || {};

  const accion = async (fn) => { setMsg(""); try { const r = await fn(); await recargar(); onCambio(); if (r && r.pedirProximaAccion) setSiguiente(true); } catch (e) { setMsg(mensajeError(e)); } };
  const mover = (etapa) => {
    if (etapa === "perdido") { setPidePerdida(true); return; }
    accion(() => api("leads.mover", { id: lead.id, etapa }));
  };
  const registrar = () => accion(async () => { const r = await api("leads.nota", { id: lead.id, tipo, detalle }); setDetalle(""); return r; });
  const pp = lead.parte_pago || {};
  const fin = lead.financiamiento || {};

  return (
    <Modal titulo={cliente ? cliente.nombre : "Lead"} onCerrar={onCerrar} ancho="max-w-3xl">
      {msg && <Aviso>{msg}</Aviso>}
      {siguiente && <ProximaAccionModal api={api} leadId={lead.id} cliente={cliente ? cliente.nombre : "el cliente"} onCerrar={() => setSiguiente(false)} onAgendada={async () => { await recargar(); onCambio(); }} />}

      <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs px-2 py-1 border-t-2 bg-stone-100 ${COLOR_ETAPA[lead.etapa] || ""}`}>{etapaDeOperacion(tipoLead, lead.etapa, etapaNombre(lead.etapa))}</span>
          {!esVenta && <span className="text-xs px-2 py-1 bg-stone-900 text-white">{tipoLeadNombre(tipoLead).split(" (")[0]}</span>}
          {lead.motivo_perdida && <span className="text-xs text-stone-500">Motivo: {lead.motivo_perdida}</span>}
          <span className="text-xs text-stone-500">· Asignado a {asignado ? asignado.nombre : "nadie"}</span>
          {lead.fuente && <span className="text-xs text-stone-500">· Fuente: {lead.fuente}</span>}
          {datos.campania && <span className="text-xs text-stone-500">· Campaña: {datos.campania.nombre}</span>}
          {puedeEditar && <button onClick={onEditar} className={`${BTN} ml-auto`}>Editar datos</button>}
        </div>
        {cliente && (
          <div className="flex flex-wrap gap-2 text-sm">
            {cliente.telefono && <a href={`tel:${cliente.telefono}`} className={BTN}>📞 {cliente.telefono}</a>}
            {cliente.telefono && <a href={`https://wa.me/${waNumero(cliente.telefono)}`} target="_blank" rel="noreferrer" className={BTN}>WhatsApp</a>}
            {cliente.email && <a href={`mailto:${cliente.email}`} className={BTN}>✉ {cliente.email}</a>}
            {cliente.rut && <span className="px-3 py-1.5 text-sm text-stone-500">RUT {cliente.rut}</span>}
          </div>
        )}
        {!esVenta && (
          <div className="text-sm"><p className="text-xs uppercase tracking-wide text-stone-400">Vehículo que {tipoLead === "compra" ? "ofrece vender" : "deja en consignación"}</p>
            <p className="text-stone-800">{ofrecido.marca ? `${ofrecido.marca} ${ofrecido.modelo || ""} ${ofrecido.anio || ""}`.trim() : "Sin datos"}</p>
            <p className="text-xs text-stone-500">{ofrecido.patente ? `${ofrecido.patente} · ` : ""}{ofrecido.km != null ? `${Number(ofrecido.km).toLocaleString("es-CL")} km` : ""}{ofrecido.transmision ? ` · ${ofrecido.transmision}` : ""}</p></div>
        )}
        {!esVenta && <DatosDelDueno o={ofrecido} />}
        <div className={`${esVenta ? "" : "hidden"} grid grid-cols-1 md:grid-cols-3 gap-3 text-sm`}>
          <div><p className="text-xs uppercase tracking-wide text-stone-400">Vehículo de interés</p>
            <p className="text-stone-800">{vehiculo ? `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} · ${vehiculo.patente}` : lead.vehiculo_interes || "—"}</p>
            {vehiculo && <p className="text-xs text-stone-500">Precio de lista {clp(vehiculo.precio_lista)}</p>}</div>
          <div><p className="text-xs uppercase tracking-wide text-stone-400">Parte de pago</p>
            <p className="text-stone-800">{pp.tiene ? `${pp.marca || ""} ${pp.modelo || ""} ${pp.anio || ""}`.trim() || "Sí" : "No"}</p>
            {pp.tiene && <p className="text-xs text-stone-500">{pp.patente ? `${pp.patente} · ` : ""}{pp.km != null ? `${Number(pp.km).toLocaleString("es-CL")} km · ` : ""}{pp.valor != null ? `valor ${clp(pp.valor)}` : ""}</p>}</div>
          <div><p className="text-xs uppercase tracking-wide text-stone-400">Financiamiento</p>
            <p className="text-stone-800">{fin.quiere ? `Pie ${clp(fin.pie)}${fin.banco ? ` · ${fin.banco}` : ""}` : "No"}</p>
            {fin.quiere && <p className="text-xs text-stone-500">{(ESTADOS_FINANCIAMIENTO.find((e) => e.id === fin.estado) || {}).nombre}</p>}</div>
          {esVenta && pp.tiene && <div className="col-span-full"><DatosDelDueno o={pp} /></div>}
        </div>
        {lead.notas && <p className="text-sm text-stone-600 border-t border-stone-100 pt-2">{lead.notas}</p>}
      </div>

      {esVenta && <SeccionCotizaciones api={api} lead={lead} datos={datos} catalogos={catalogos} avisar={setMsg} onCambio={async () => { await recargar(); onCambio(); }} />}
      {esVenta && <SeccionTasacion api={api} lead={lead} datos={datos} catalogos={catalogos} avisar={setMsg} onCambio={async () => { await recargar(); onCambio(); }} />}
      {tipoLead === "compra" && <SeccionCompra api={api} lead={lead} datos={datos} avisar={setMsg} onCambio={async () => { await recargar(); onCambio(); }} />}
      {tipoLead === "consignacion" && <SeccionConsignacion api={api} lead={lead} datos={datos} avisar={setMsg} onCambio={async () => { await recargar(); onCambio(); }} />}
      {(puedeEditar || catalogos.veTodo) && (
        <SeccionInspeccion api={api} origen={{ tipo: "lead", id: lead.id }} cerrado={lead.etapa === "ganado" || lead.etapa === "perdido" || !puedeEditar}
          vehiculo={!esVenta ? ofrecido : pp.tiene && pp.patente ? { patente: pp.patente, marca: pp.marca, modelo: pp.modelo, anio: pp.anio, km: pp.km } : vehiculo ? { patente: vehiculo.patente, marca: vehiculo.marca, modelo: vehiculo.modelo, anio: vehiculo.anio, km: vehiculo.km } : {}} />
      )}
      <SeccionValidacion api={api} origen={{ tipo: "lead", id: lead.id }} titulo="Validación de documentos de la venta" version={datos.cierres.length} />
      {esVenta && <SeccionCierres api={api} lead={lead} datos={datos} catalogos={catalogos} avisar={setMsg} onCambio={async () => { await recargar(); onCambio(); }} />}

      {puedeEditar && (
        <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Mover a la etapa" className="md:w-56" ayuda={lead.etapa === "cotizado" || lead.etapa === "reservado" ? "Cotizado y Reservado cambian solos al cotizar o reservar." : ""}>
              <select value={lead.etapa} onChange={(e) => mover(e.target.value)} className={INPUT} disabled={cerrado && !catalogos.puedeAsignar}>
                {ETAPAS.filter((e) => (e.disponible && !e.automatica) || e.id === lead.etapa).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </Campo>
            {puedeAsignar && (
              <Campo etiqueta="Reasignar a" className="md:w-64">
                <select value="" onChange={(e) => e.target.value && accion(() => api("leads.reasignar", { id: lead.id, asignarA: e.target.value }))} className={INPUT}>
                  <option value="">Elegir persona…</option>
                  <option value="auto">Reparto automático</option>
                  {equipo.filter((p) => !asignado || p.id !== asignado.id).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
            )}
          </div>
          {pidePerdida && (
            <div className="border border-amber-300 bg-amber-50 p-3 flex flex-wrap items-end gap-3">
              <Campo etiqueta="¿Por qué se pierde?" className="md:w-72">
                <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={INPUT}>
                  <option value="">Elegir motivo…</option>{catalogos.motivos_perdida.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Campo>
              <button disabled={!motivo} onClick={() => accion(async () => { await api("leads.mover", { id: lead.id, etapa: "perdido", motivo }); setPidePerdida(false); setMotivo(""); })} className={BTN_PRIMARIO}>Marcar como perdido</button>
              <button onClick={() => setPidePerdida(false)} className={BTN}>Cancelar</button>
            </div>
          )}
        </div>
      )}

      {puedeEditar && (
        <div className="bg-white border border-stone-200 p-4 flex flex-col gap-2">
          <p className="text-sm text-stone-700">Registrar un contacto o una nota</p>
          <div className="flex flex-wrap gap-2">
            {TIPOS_CONTACTO.map((t) => (
              <button key={t.id} onClick={() => setTipo(t.id)} className={`px-3 py-1.5 text-sm border ${tipo === t.id ? "bg-stone-900 text-white border-stone-900" : "border-stone-300 bg-white text-stone-700"}`}>{t.nombre}</button>
            ))}
          </div>
          <textarea rows={2} value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder={tipo === "nota" ? "Escribe la nota…" : "¿Qué se habló? (opcional)"} className={INPUT} />
          <div><button onClick={registrar} disabled={tipo === "nota" && !detalle.trim()} className={BTN_AMBAR}>Guardar</button>
            {lead.etapa === "nuevo" && tipo !== "nota" && <span className="text-xs text-stone-500 ml-3">El primer contacto pasa el lead a «Contactado».</span>}</div>
        </div>
      )}

      {puedeEditar && <NuevaTarea api={api} leadId={lead.id} onCreada={async () => { await recargar(); onCambio(); }} />}

      {tareas.length > 0 && (
        <div className="bg-white border border-stone-200 p-4">
          <p className="text-sm text-stone-700 mb-2">Tareas</p>
          <ul className="flex flex-col gap-1">
            {tareas.map((t) => (
              <li key={t.id} className={`flex items-center gap-3 text-sm ${t.hecha ? "text-stone-400 line-through" : claseTarea(t.vence_en) === "vencida" ? "text-rose-700" : "text-stone-800"}`}>
                <input type="checkbox" checked={t.hecha} onChange={(e) => accion(() => api("tareas.hecha", { id: t.id, hecha: e.target.checked }))} />
                <span className="flex-1">{t.titulo}</span><span className="text-xs">{fechaHora(t.vence_en)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-stone-200 p-4">
        <p className="text-sm text-stone-700 mb-2">Historial</p>
        <ul className="flex flex-col gap-2">
          {eventos.length === 0 && <li className="text-sm text-stone-500">Sin movimientos todavía.</li>}
          {eventos.map((e) => (
            <li key={e.id} className="text-sm border-l-2 border-stone-200 pl-3">
              <p className="text-stone-800"><span className="text-[10px] uppercase tracking-wide text-stone-400 mr-2">{(TIPOS_CONTACTO.find((t) => t.id === e.tipo) || { nombre: { etapa: "Etapa", asignacion: "Asignación", cotizacion: "Cotización", reserva: "Reserva" }[e.tipo] || "Creado" }).nombre}</span>{e.detalle}</p>
              <p className="text-xs text-stone-400">{e.usuario_nombre || "Sistema"} · {fechaHora(e.creado_en)}</p>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/* =========================================================
   NUEVO LEAD / EDITAR LEAD
========================================================= */
const LEAD_VACIO = { vehiculoId: "", vehiculoInteres: "", fuente: "", campaniaId: "", notas: "", tienePP: false, pp: { patente: "", marca: "", modelo: "", anio: "", km: "", valor: "" }, quiereFin: false, fin: { pie: "", banco: "", estado: "por_evaluar" } };

function FormLead({ api, catalogos, lead, onCerrar, onGuardado }) {
  const editando = !!lead;
  const { datos: inv } = useCarga(() => api("inventario.list"), [api]);
  const [equipo, setEquipo] = useState([]);
  const [asignarA, setAsignarA] = useState("auto");
  const [buscar, setBuscar] = useState("");
  const [coincidencias, setCoincidencias] = useState([]);
  const [cliente, setCliente] = useState({ nombre: "", rut: "", telefono: "", email: "" });
  const [elegido, setElegido] = useState(null);
  const tiposLead = catalogos.tiposLead && catalogos.tiposLead.length ? catalogos.tiposLead : ["venta"];
  const [tipo, setTipo] = useState(lead ? lead.tipo || "venta" : tiposLead[0]);
  const [vo, setVo] = useState(() => aVehiculoForm(lead ? lead.vehiculo_ofrecido : null));
  const [f, setF] = useState(() => {
    if (!lead) return LEAD_VACIO;
    const pp = lead.parte_pago || {}; const fin = lead.financiamiento || {};
    return {
      vehiculoId: lead.vehiculo_id || "", vehiculoInteres: lead.vehiculo_interes || "", fuente: lead.fuente || "", campaniaId: lead.campania_id || "", notas: lead.notas || "",
      tienePP: !!pp.tiene, pp: { patente: pp.patente || "", marca: pp.marca || "", modelo: pp.modelo || "", anio: pp.anio ?? "", km: pp.km ?? "", valor: pp.valor ?? "" },
      quiereFin: !!fin.quiere, fin: { pie: fin.pie ?? "", banco: fin.banco || "", estado: fin.estado || "por_evaluar" },
    };
  });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { if (catalogos.puedeAsignar && !editando) api("equipo").then((r) => setEquipo(r.equipo)).catch(() => {}); }, [api, catalogos.puedeAsignar, editando]);
  useEffect(() => {
    if (editando || buscar.trim().length < 2) { setCoincidencias([]); return undefined; }
    const t = setTimeout(() => api("clientes.list", { q: buscar }).then((r) => setCoincidencias(r.clientes.slice(0, 5))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [api, buscar, editando]);

  const datosLead = () => (tipo !== "venta" ? {
    tipo, vehiculoOfrecido: vo, fuente: f.fuente, campaniaId: f.campaniaId || "", notas: f.notas, parteDePago: { tiene: false }, financiamiento: { quiere: false },
  } : {
    tipo: "venta", vehiculoId: f.vehiculoId || null, vehiculoInteres: f.vehiculoId ? "" : f.vehiculoInteres, fuente: f.fuente, campaniaId: f.campaniaId || "", notas: f.notas,
    parteDePago: f.tienePP ? { tiene: true, ...f.pp } : { tiene: false },
    financiamiento: f.quiereFin ? { quiere: true, ...f.fin } : { quiere: false },
  });

  const guardar = async () => {
    setError("");
    const v = validarLead(datosLead());
    if (!v.ok) { setError(mensajeError({ message: v.error })); return; }
    if (tipo !== "venta") { const o = validarVehiculoOfrecido(vo); if (!o.ok) { setError(mensajeError({ message: o.error })); return; } }
    if (!editando && !elegido) {
      const c = validarCliente(cliente);
      if (!c.ok) { setError(mensajeError({ message: c.error })); return; }
    }
    setGuardando(true);
    try {
      if (editando) await api("leads.update", { id: lead.id, lead: datosLead() });
      else await api("leads.create", { cliente: elegido ? { id: elegido.id } : cliente, lead: datosLead(), asignarA: catalogos.puedeAsignar ? asignarA : undefined });
      onGuardado();
    } catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };

  const disponibles = inv ? inv.vehiculos.filter((v) => v.estado === "disponible" || v.id === f.vehiculoId) : [];

  return (
    <Modal titulo={editando ? "Editar lead" : `Nuevo lead de ${tipo === "venta" ? "venta" : tipo === "compra" ? "compra" : "consignación"}`} onCerrar={onCerrar} ancho="max-w-3xl">
      {!editando && tiposLead.length > 1 && (
        <Campo etiqueta="¿Qué quiere el cliente?">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={INPUT}>{TIPOS_LEAD.filter((t) => tiposLead.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{{ venta: "Comprarnos un vehículo", compra: "Vendernos su vehículo", consignacion: "Dejarnos su vehículo en consignación" }[t.id]}</option>)}</select>
        </Campo>
      )}
      {!editando && (
        <Tarjeta titulo="Cliente">
          {elegido ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="flex-1"><strong>{elegido.nombre}</strong> · {elegido.telefono || elegido.email}</span>
              <button onClick={() => setElegido(null)} className={BTN}>Cambiar</button>
            </div>
          ) : (
            <>
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="¿Ya es cliente? Busca por nombre, RUT o teléfono" className={`${INPUT} mb-2`} />
              {coincidencias.length > 0 && (
                <ul className="border border-stone-200 mb-3">
                  {coincidencias.map((c) => (
                    <li key={c.id}><button onClick={() => { setElegido(c); setBuscar(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 border-b border-stone-100">{c.nombre} <span className="text-stone-500">· {c.telefono || c.email}{c.rut ? ` · ${c.rut}` : ""}</span></button></li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-stone-500 mb-2">Si no existe, completa sus datos:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Campo etiqueta="Nombre completo"><input value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} className={INPUT} /></Campo>
                <Campo etiqueta="RUT (opcional)"><input value={cliente.rut} onChange={(e) => setCliente({ ...cliente, rut: e.target.value })} className={`${INPUT} font-mono`} /></Campo>
                <Campo etiqueta="Teléfono"><input value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} className={INPUT} placeholder="+56 9 1234 5678" /></Campo>
                <Campo etiqueta="Correo"><input type="email" value={cliente.email} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} className={INPUT} /></Campo>
              </div>
            </>
          )}
        </Tarjeta>
      )}

      <Tarjeta titulo="Interés">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tipo === "venta" && <Campo etiqueta="Vehículo del inventario">
            <select value={f.vehiculoId} onChange={(e) => set("vehiculoId", e.target.value)} className={INPUT}>
              <option value="">Ninguno / no está en el inventario</option>
              {disponibles.map((v) => <option key={v.id} value={v.id}>{v.marca} {v.modelo} {v.anio} · {v.patente} · {clp(v.precio_lista)}</option>)}
            </select>
          </Campo>}
          {tipo === "venta" && !f.vehiculoId && <Campo etiqueta="¿Qué busca? (texto libre)"><input value={f.vehiculoInteres} onChange={(e) => set("vehiculoInteres", e.target.value)} className={INPUT} placeholder="Ej.: SUV automática hasta $12.000.000" /></Campo>}
          <Campo etiqueta="Fuente">
            <select value={f.fuente} onChange={(e) => set("fuente", e.target.value)} className={INPUT}>
              <option value="">—</option>{catalogos.fuentes_lead.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Campo>
          {(catalogos.campanias || []).length > 0 && (
            <Campo etiqueta="Campaña (opcional)" ayuda="Si el cliente llegó por una campaña de Marketing.">
              <select value={f.campaniaId} onChange={(e) => set("campaniaId", e.target.value)} className={INPUT}>
                <option value="">—</option>{catalogos.campanias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                {f.campaniaId && !catalogos.campanias.some((c) => c.id === f.campaniaId) && <option value={f.campaniaId}>(campaña ya asignada)</option>}
              </select>
            </Campo>
          )}
          {!editando && catalogos.puedeAsignar && (
            <Campo etiqueta="Asignar a">
              <select value={asignarA} onChange={(e) => setAsignarA(e.target.value)} className={INPUT}>
                <option value="auto">Reparto automático (rotativo)</option>{equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
          )}
        </div>
      </Tarjeta>

      {tipo !== "venta" && <Tarjeta titulo={tipo === "compra" ? "Vehículo que el cliente quiere vendernos" : "Vehículo que deja en consignación"} ayuda="Patente, marca, modelo, año y kilometraje son obligatorios."><CamposVehiculo v={vo} set={setVo} /><CamposCondiciones v={vo} set={setVo} /></Tarjeta>}
      {tipo === "venta" && <Tarjeta>
        <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" checked={f.tienePP} onChange={(e) => set("tienePP", e.target.checked)} /> Entrega un vehículo en parte de pago</label>
        {f.tienePP && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Campo etiqueta="Patente"><input value={f.pp.patente} onChange={(e) => set("pp", { ...f.pp, patente: e.target.value.toUpperCase() })} className={`${INPUT} font-mono`} /></Campo>
            <Campo etiqueta="Marca"><input value={f.pp.marca} onChange={(e) => set("pp", { ...f.pp, marca: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Modelo"><input value={f.pp.modelo} onChange={(e) => set("pp", { ...f.pp, modelo: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Año"><input type="number" value={f.pp.anio} onChange={(e) => set("pp", { ...f.pp, anio: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Kilometraje"><input type="number" value={f.pp.km} onChange={(e) => set("pp", { ...f.pp, km: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Valor estimado ($)"><InputDinero value={f.pp.valor} onChange={(e) => set("pp", { ...f.pp, valor: e.target.value })} className={INPUT} /></Campo>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-stone-800 mt-4"><input type="checkbox" checked={f.quiereFin} onChange={(e) => set("quiereFin", e.target.checked)} /> Necesita financiamiento</label>
        {f.quiereFin && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Campo etiqueta="Pie ($)"><InputDinero value={f.fin.pie} onChange={(e) => set("fin", { ...f.fin, pie: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Banco / financiera"><input value={f.fin.banco} onChange={(e) => set("fin", { ...f.fin, banco: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Estado de la evaluación">
              <select value={f.fin.estado} onChange={(e) => set("fin", { ...f.fin, estado: e.target.value })} className={INPUT}>{ESTADOS_FINANCIAMIENTO.filter((e) => e.id !== "no_aplica").map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
            </Campo>
          </div>
        )}
      </Tarjeta>}

      <Campo etiqueta="Notas"><textarea rows={2} value={f.notas} onChange={(e) => set("notas", e.target.value)} className={INPUT} /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={guardando} className={BTN_PRIMARIO}>{guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear lead"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* =========================================================
   EMBUDO EN COLUMNAS (KANBAN)
========================================================= */
function TarjetaLead({ lead, cliente, vehiculo, asignado, marca = {}, mostrarAsignado, onAbrir, onMover, puedeMover }) {
  const sinContacto = lead.etapa === "nuevo" && !lead.ultimo_contacto;
  return (
    <div draggable={puedeMover} onDragStart={(e) => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; }}
      className="bg-white border border-stone-200 p-3 text-sm cursor-pointer hover:border-amber-400 shadow-sm" onClick={onAbrir}>
      <p className="font-medium text-stone-900">{cliente ? cliente.nombre : "Cliente"}</p>
      <p className="text-stone-600 text-xs mt-0.5">{lead.tipo && lead.tipo !== "venta" ? <><span className="bg-stone-900 text-white px-1.5 py-0.5 mr-1">{lead.tipo === "compra" ? "Compra" : "Consignación"}</span>{lead.vehiculo_ofrecido && lead.vehiculo_ofrecido.marca ? `${lead.vehiculo_ofrecido.marca} ${lead.vehiculo_ofrecido.modelo || ""} ${lead.vehiculo_ofrecido.anio || ""}` : "Sin datos del vehículo"}</> : vehiculo ? `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}` : lead.vehiculo_interes || "Sin vehículo definido"}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-stone-500">
        {marca.pendiente && <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5">Descuento por aprobar</span>}
        {marca.cierre_pendiente && <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5">Venta por aprobar</span>}
        {marca.reserva_vence_en && <span className="bg-sky-100 text-sky-800 px-1.5 py-0.5">Reserva {textoVencimiento(marca.reserva_vence_en)}</span>}
        {sinContacto && <span className="bg-sky-100 text-sky-800 px-1.5 py-0.5">Por atender</span>}
        {lead.fuente && <span>{lead.fuente}</span>}
        <span>{hace(lead.creado_en)}</span>
        {mostrarAsignado && <span className={asignado ? "text-stone-700" : "text-rose-600"}>· {asignado ? asignado.nombre : "Sin asignar"}</span>}
      </div>
      {puedeMover && (
        <select value={lead.etapa} onClick={(e) => e.stopPropagation()} onChange={(e) => onMover(e.target.value)} className="md:hidden mt-2 w-full border border-stone-300 bg-white px-2 py-1 text-xs">
          {ETAPAS.filter((e) => (e.disponible && !e.automatica) || e.id === lead.etapa).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
      )}
    </div>
  );
}

function Leads({ api, catalogos, abrirLead, version, onCambio }) {
  const [todos, setTodos] = useState(catalogos.puedeAsignar);
  const { cargando, error, datos, recargar } = useCarga(() => api("leads.list", { todos }), [api, todos, version]);
  const [form, setForm] = useState(false);
  const [msg, setMsg] = useState("");
  const [perdiendo, setPerdiendo] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [sobre, setSobre] = useState("");
  const [siguiente, setSiguiente] = useState(null);

  const mapas = useMemo(() => {
    if (!datos) return {};
    return { c: new Map(datos.clientes.map((x) => [x.id, x])), v: new Map(datos.vehiculos.map((x) => [x.id, x])), u: new Map(datos.usuarios.map((x) => [x.id, x])) };
  }, [datos]);

  const mover = async (lead, etapa, motivoPerdida) => {
    setMsg("");
    if (etapa === lead.etapa) return;
    if (ETAPAS.find((e) => e.id === etapa && e.automatica)) { setMsg(mensajeError({ message: "etapa_automatica" })); return; }
    if (etapa === "perdido" && !motivoPerdida) { setPerdiendo(lead); return; }
    try { const r = await api("leads.mover", { id: lead.id, etapa, motivo: motivoPerdida }); await recargar(); onCambio(); if (r && r.pedirProximaAccion) setSiguiente(lead); }
    catch (e) { setMsg(mensajeError(e)); }
  };

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const porEtapa = contarPorEtapa(datos.leads);

  return (
    <>
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setForm(true)} className={BTN_AMBAR}>+ Nuevo lead</button>
          {datos.veTodo && (
            <div className="flex border border-stone-300">
              <button onClick={() => setTodos(false)} className={`px-3 py-1.5 text-sm ${!todos ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Mis leads</button>
              <button onClick={() => setTodos(true)} className={`px-3 py-1.5 text-sm ${todos ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Todo el local</button>
            </div>
          )}
          <span className="text-xs text-stone-500 ml-auto">{datos.leads.length} leads · arrastra una tarjeta para cambiar de etapa</span>
        </div>
      </Tarjeta>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-3 items-start">
        {ETAPAS_ACTIVAS.map((id) => {
          const leads = datos.leads.filter((l) => l.etapa === id);
          return (
            <div key={id} className={`bg-stone-50 border border-stone-200 border-t-4 ${COLOR_ETAPA[id]} ${sobre === id ? "ring-2 ring-amber-400" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setSobre(id); }} onDragLeave={() => setSobre("")}
              onDrop={(e) => { e.preventDefault(); setSobre(""); const lead = datos.leads.find((l) => l.id === e.dataTransfer.getData("text/plain")); if (lead) mover(lead, id); }}>
              <div className="px-3 py-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-stone-800">{etapaNombre(id)}</h3>
                <span className="text-xs bg-white border border-stone-200 px-1.5">{porEtapa[id]}</span>
              </div>
              <div className="px-2 pb-2 flex flex-col gap-2 min-h-[60px]">
                {leads.length === 0 && <p className="text-xs text-stone-400 px-1 py-3 text-center">Sin leads</p>}
                {leads.map((l) => (
                  <TarjetaLead key={l.id} lead={l} cliente={mapas.c.get(l.cliente_id)} vehiculo={mapas.v.get(l.vehiculo_id)} asignado={mapas.u.get(l.asignado_a)} marca={(datos.marcas || {})[l.id]}
                    mostrarAsignado={todos} onAbrir={() => abrirLead(l.id)} onMover={(e) => mover(l, e)} puedeMover />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-stone-500">«Cotizado» y «Reservado» cambian solas: al crear una cotización y al reservar el vehículo desde la ficha del lead. «Cerrado ganado» llega con el cierre de venta (próxima entrega).</p>

      {perdiendo && (
        <Modal titulo="Marcar como perdido" onCerrar={() => { setPerdiendo(null); setMotivo(""); }} ancho="max-w-md">
          <Campo etiqueta="¿Por qué se pierde este lead?">
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={INPUT}><option value="">Elegir motivo…</option>{catalogos.motivos_perdida.map((m) => <option key={m}>{m}</option>)}</select>
          </Campo>
          <div className="flex gap-2">
            <button disabled={!motivo} onClick={async () => { const l = perdiendo; setPerdiendo(null); const m = motivo; setMotivo(""); await mover(l, "perdido", m); }} className={BTN_PRIMARIO}>Confirmar</button>
            <button onClick={() => { setPerdiendo(null); setMotivo(""); }} className={BTN}>Cancelar</button>
          </div>
        </Modal>
      )}
      {form && <FormLead api={api} catalogos={catalogos} onCerrar={() => setForm(false)} onGuardado={async () => { setForm(false); await recargar(); onCambio(); }} />}
      {siguiente && <ProximaAccionModal api={api} leadId={siguiente.id} cliente={(mapas.c.get(siguiente.cliente_id) || {}).nombre || "el cliente"} onCerrar={() => setSiguiente(null)} onAgendada={async () => { await recargar(); onCambio(); }} />}
    </>
  );
}

/* =========================================================
   AGENDA
========================================================= */
function GrupoTareas({ titulo, color, tareas, infoLeads, onHecha, onAbrir }) {
  if (tareas.length === 0) return null;
  return (
    <Tarjeta titulo={`${titulo} (${tareas.length})`}>
      <ul className="flex flex-col divide-y divide-stone-100">
        {tareas.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
            <input type="checkbox" onChange={() => onHecha(t)} aria-label="Marcar como hecha" />
            <button onClick={() => t.lead_id && onAbrir(t.lead_id)} className="flex-1 text-left">
              <span className={`block ${color}`}>{t.titulo}</span>
              {infoLeads[t.lead_id] && <span className="text-xs text-stone-500">{infoLeads[t.lead_id].cliente} · {etapaNombre(infoLeads[t.lead_id].etapa)}</span>}
            </button>
            <span className="text-xs text-stone-500 whitespace-nowrap">{fechaHora(t.vence_en)}</span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

function Agenda({ api, catalogos, abrirLead, version, onCambio }) {
  const [todas, setTodas] = useState(false);
  const { cargando, error, datos, recargar } = useCarga(() => api("tareas.list", { todas }), [api, todas, version]);
  const [msg, setMsg] = useState("");
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const g = agruparTareas(datos.tareas);
  const hecha = async (t) => { setMsg(""); try { await api("tareas.hecha", { id: t.id, hecha: true }); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); } };
  return (
    <>
      {catalogos.veTodo && (
        <div className="flex border border-stone-300 self-start">
          <button onClick={() => setTodas(false)} className={`px-3 py-1.5 text-sm ${!todas ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Mis tareas</button>
          <button onClick={() => setTodas(true)} className={`px-3 py-1.5 text-sm ${todas ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Todo el local</button>
        </div>
      )}
      {msg && <Aviso>{msg}</Aviso>}
      {datos.tareas.length === 0 && <Tarjeta><p className="text-sm text-stone-500">No hay tareas pendientes. Agenda llamadas y visitas desde la ficha de cada lead.</p></Tarjeta>}
      <GrupoTareas titulo="Vencidas" color="text-rose-700" tareas={g.vencidas} infoLeads={datos.leads} onHecha={hecha} onAbrir={abrirLead} />
      <GrupoTareas titulo="Hoy" color="text-stone-900" tareas={g.hoy} infoLeads={datos.leads} onHecha={hecha} onAbrir={abrirLead} />
      <GrupoTareas titulo="Próximas" color="text-stone-700" tareas={g.proximas} infoLeads={datos.leads} onHecha={hecha} onAbrir={abrirLead} />
    </>
  );
}

/* =========================================================
   INICIO (la estación apenas entra)
========================================================= */
function Inicio({ api, catalogos, abrirLead, irA, version, onCambio }) {
  const { cargando, error, datos } = useCarga(async () => {
    const [l, t, r, p, c, ge] = await Promise.all([
      api("leads.list", { todos: catalogos.puedeAsignar }),
      catalogos.puedeAgenda ? api("tareas.list", { todas: catalogos.puedeAsignar }) : Promise.resolve({ tareas: [], leads: {} }),
      api("reservas.list").catch(() => ({ reservas: [] })),
      catalogos.puedeAsignar ? api("cotizaciones.pendientes").catch(() => ({ pendientes: [] })) : Promise.resolve({ pendientes: [] }),
      catalogos.puedeComision ? api("comisiones.resumen").catch(() => null) : Promise.resolve(null),
      catalogos.puedeAsignar ? api("gestion.resumen").catch(() => null) : Promise.resolve(null),
    ]);
    return { l, t, r, p, c, ge };
  }, [api, version]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const { l, t, r, p, c, ge } = datos;
  const porAtender = leadsPorAtender(l.leads);
  const g = agruparTareas(t.tareas);
  const cliente = (id) => (l.clientes.find((c) => c.id === id) || {}).nombre || "Cliente";
  const kpi = (titulo, valor, destacado, onClick) => (
    <button onClick={onClick} className={`text-left bg-white border p-4 hover:shadow-elevada hover:-translate-y-px ${destacado ? "border-amber-400 ring-1 ring-amber-200" : "border-stone-200"} hover:border-amber-500`}>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{titulo}</p>
      <p className={`text-3xl font-bold tabular-nums mt-1 ${destacado ? "text-amber-600" : "text-stone-900"}`}>{valor}</p>
    </button>
  );
  const alcance = catalogos.puedeAsignar ? "del local" : "tuyos";
  return (
    <>
      <AvisosDelSupervisor api={api} version={version} abrirLead={abrirLead} />
      {catalogos.puedePedirTasacion && <MisTasaciones api={api} version={version} abrirLead={abrirLead} />}
      <FranjaAlertas resumen={ge} onVer={() => irA("gestion")} />
      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-4">
        {catalogos.puedeAsignar && kpi("Descuentos por aprobar", p.pendientes.length, p.pendientes.length > 0, () => irA("aprobaciones"))}
        {kpi(`Leads por atender`, porAtender.length, porAtender.length > 0, () => irA("leads"))}
        {kpi("Tareas de hoy", g.hoy.length, g.hoy.length > 0, () => irA("agenda"))}
        {kpi("Tareas vencidas", g.vencidas.length, false, () => irA("agenda"))}
        {kpi("En seguimiento", l.leads.filter((x) => x.etapa === "seguimiento").length, false, () => irA("leads"))}
        {kpi("Reservas activas", r.reservas.length, false, () => irA("leads"))}
      </div>

      {r.reservas.length > 0 && (
        <Tarjeta titulo="Reservas activas" ayuda="Cuando una reserva vence, el vehículo vuelve solo a estar disponible.">
          <ul className="flex flex-col divide-y divide-stone-100">
            {r.reservas.map((x) => (
              <li key={x.id}><button onClick={() => abrirLead(x.lead_id)} className="w-full text-left py-2 text-sm hover:bg-amber-50 px-1 flex flex-wrap gap-x-3">
                <span className="text-stone-900">{x.cliente}</span><span className="text-stone-600">{x.vehiculo}</span>
                <span className="font-mono text-stone-700">{clp(x.monto)}</span><span className={Date.parse(x.vence_en) - Date.now() < 86400000 ? "text-rose-700" : "text-stone-500"}>{textoVencimiento(x.vence_en)}</span>
              </button></li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Tarjeta titulo="Por atender ahora" ayuda={`Leads nuevos ${alcance} que aún no tienen ningún contacto.`}>
          {porAtender.length === 0 ? <p className="text-sm text-stone-500">No tienes leads nuevos pendientes. 👌</p> : (
            <ul className="flex flex-col divide-y divide-stone-100">
              {porAtender.slice(0, 6).map((x) => (
                <li key={x.id}><button onClick={() => abrirLead(x.id)} className="w-full text-left py-2 text-sm hover:bg-amber-50 px-1">
                  <span className="text-stone-900">{cliente(x.cliente_id)}</span><span className="text-xs text-stone-500"> · {x.fuente || "—"} · {hace(x.creado_en)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </Tarjeta>
        <Tarjeta titulo="Para hacer hoy" ayuda="Tareas vencidas y de hoy.">
          {g.vencidas.length + g.hoy.length === 0 ? <p className="text-sm text-stone-500">Nada pendiente para hoy.</p> : (
            <ul className="flex flex-col divide-y divide-stone-100">
              {[...g.vencidas, ...g.hoy].slice(0, 6).map((x) => (
                <li key={x.id}><button onClick={() => x.lead_id && abrirLead(x.lead_id)} className="w-full text-left py-2 text-sm hover:bg-amber-50 px-1">
                  <span className={claseTarea(x.vence_en) === "vencida" ? "text-rose-700" : "text-stone-900"}>{x.titulo}</span>
                  <span className="text-xs text-stone-500"> · {t.leads[x.lead_id] ? t.leads[x.lead_id].cliente : ""} · {fechaHora(x.vence_en)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      {c && (catalogos.puedeAsignar ? (
        <Tarjeta titulo={`Ventas del equipo · ${c.nombreMes}`} ayuda="Solo cuentan las ventas aprobadas.">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span>Ventas: <strong className="font-mono">{c.totales.unidades}</strong>{c.meta > 0 ? <span className="text-stone-500"> (meta {c.meta} por ejecutivo)</span> : null}</span>
            <span>Vendido: <strong className="font-mono">{clp(c.totales.montoVendido)}</strong></span>
            <span>Comisiones del equipo: <strong className="font-mono">{clp(c.totales.produccion)}</strong></span>
            <button onClick={() => irA("ventas")} className={BTN}>Ver detalle por ejecutivo</button>
          </div>
        </Tarjeta>
      ) : <TarjetaComision resumen={c} />)}
    </>
  );
}

/* =========================================================
   ENTRADA DEL MÓDULO
========================================================= */
export function ModuloVentas({ permisos = [], esAdmin = false, renderEstimador, renderFichas }) {
  const can = (p) => esAdmin || permisos.includes(p);
  const usaLeads = can("leads.propios") || can("leads.local") || can("leads.asignar");
  const [localSel, setLocalSel] = useState("");
  const [tab, setTab] = useGuardado(esAdmin ? "ventas-admin" : "ventas", usaLeads ? "hoy" : "inventario", ["hoy", "inicio", "leads", "agenda", "ventas", "gestion", "tasaciones", "aprobaciones", "compras", "inspecciones", "fichas", "equipo", "validaciones", "anuncios", "marketing", "inventario", "clientes"]);
  const [version, setVersion] = useState(0);
  const [leadAbierto, setLeadAbierto] = useState(null);
  const [leadEditando, setLeadEditando] = useState(null);
  const subir = useCallback(() => setVersion((v) => v + 1), []);

  const api = useCallback((op, params) => window.auth.ventas(op, { ...(localSel ? { localId: localSel } : {}), ...params }), [localSel]);
  const cat = useCarga(() => api("catalogos"), [api]);
  // Con varios locales, la cuenta maestra debe elegir uno antes de ver o crear datos.
  const locales = (cat.datos && cat.datos.locales) || [];
  useEffect(() => { if (esAdmin && !localSel && locales.filter((l) => l.activo).length > 0) setLocalSel(locales.filter((l) => l.activo)[0].id); }, [esAdmin, localSel, locales]);

  // Cuántos descuentos esperan aprobación (solo para quien los aprueba): se muestra como insignia en la pestaña.
  const puedeAprobar = can("leads.asignar");
  const pend = useCarga(() => (puedeAprobar
    ? Promise.all([api("cotizaciones.pendientes").then((r) => r.pendientes.length).catch(() => 0), api("cierres.list", { estado: "pendiente" }).then((r) => r.cierres.length).catch(() => 0)]).then(([a, b]) => a + b)
    : Promise.resolve(0)), [api, version, puedeAprobar]);

  if (cat.cargando && !cat.datos) return <Cargando />;
  if (cat.error && !cat.datos) return <Aviso>{cat.error}</Aviso>;

  const catalogos = {
    ...cat.datos, puedeAsignar: can("leads.asignar"), veTodo: can("leads.asignar") || can("leads.local"), puedeAgenda: can("agenda.usar") || can("leads.asignar"),
    puedeComision: can("comisiones.propias") || can("comisiones.local") || can("leads.asignar"),
    puedePedirTasacion: can("tasaciones.pedir") || can("leads.asignar"),
    puedeInspecciones: can("inspecciones.pedir") || can("leads.asignar"),
    tiposLead: [(can("ventas.operar") || can("leads.asignar")) && "venta", (can("compras.operar") || can("leads.asignar")) && "compra", (can("consignaciones.operar") || can("leads.asignar")) && "consignacion"].filter(Boolean),
  };
  const puedeCompras = can("compras.operar") || can("consignaciones.operar") || can("leads.asignar");
  const opciones = [];
  if (usaLeads) opciones.push(["hoy", "Hoy"], ["inicio", "Inicio"], ["leads", "Leads"]);
  if (catalogos.puedeAgenda) opciones.push(["agenda", "Agenda"]);
  if (catalogos.puedeComision) opciones.push(["ventas", "Ventas"]);
  if (puedeAprobar) opciones.push(["gestion", "Gestión"], ["tasaciones", "Tasaciones"], ["aprobaciones", "Aprobaciones", pend.datos || 0]);
  if (usaLeads && puedeCompras) opciones.push(["compras", "Compras y consignaciones"]);
  if (catalogos.puedeInspecciones) opciones.push(["inspecciones", "Inspecciones"]);
  if (puedeAprobar && renderFichas) opciones.push(["fichas", "Fichas de inspectores"]);
  if (puedeAprobar) opciones.push(["equipo", "Equipo"]);
  if (puedeAprobar) opciones.push(["validaciones", "Validaciones"], ["anuncios", "Avisos"], ["marketing", "Marketing"]);
  opciones.push(["inventario", "Inventario"]);
  if (usaLeads) opciones.push(["clientes", "Clientes"]);

  // Si la pestaña recordada ya no está disponible para esta persona, se usa la primera.
  const tabVigente = opciones.some((o) => o[0] === tab) ? tab : (opciones[0] || [])[0];
  const GRUPOS = [
    { titulo: "Trabajo diario", ids: ["hoy", "inicio", "leads", "agenda", "clientes", "inventario"] },
    { titulo: "Comercial", ids: ["ventas", "gestion", "aprobaciones", "compras", "tasaciones", "inspecciones", "fichas", "equipo"] },
    { titulo: "Operación", ids: ["validaciones", "anuncios", "marketing"] },
  ];

  return (
    <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <aside className="hidden lg:block lg:sticky lg:top-4"><NavegacionLateral valor={tabVigente} onCambio={setTab} opciones={opciones} grupos={GRUPOS} /></aside>
    <div className="flex flex-col gap-5 min-w-0">
      {esAdmin && locales.length > 1 && (
        <div className="flex items-center gap-3 text-sm text-stone-700">Local:
          <select value={localSel} onChange={(e) => setLocalSel(e.target.value)} className={`${INPUT} md:w-64`}>{locales.filter((l) => l.activo).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select>
        </div>
      )}
      <div className="lg:hidden"><Pestanas valor={tabVigente} onCambio={setTab} opciones={opciones} /></div>
      <ErrorBoundary clave={tabVigente}>
      {tabVigente === "hoy" && <Hoy api={api} catalogos={catalogos} abrirLead={setLeadAbierto} version={version} onCambio={subir} />}
      {tabVigente === "inicio" && <Inicio api={api} catalogos={catalogos} abrirLead={setLeadAbierto} irA={setTab} version={version} onCambio={subir} />}
      {tabVigente === "leads" && <Leads api={api} catalogos={catalogos} abrirLead={setLeadAbierto} version={version} onCambio={subir} />}
      {tabVigente === "tasaciones" && <ModuloTasaciones api={api} permisos={permisos} esAdmin={esAdmin} renderEstimador={renderEstimador} />}
      {tabVigente === "compras" && <ModuloCompras api={api} permisos={permisos} esAdmin={esAdmin} abrirLead={setLeadAbierto} version={version} onCambio={subir} />}
      {tabVigente === "marketing" && <ModuloMarketing api={api} permisos={permisos} esAdmin={esAdmin} />}
      {tabVigente === "anuncios" && <ModuloAnuncios api={api} permisos={permisos} esAdmin={esAdmin} />}
      {tabVigente === "validaciones" && <ModuloValidaciones api={api} permisos={permisos} esAdmin={esAdmin} />}
      {tabVigente === "inspecciones" && <ModuloInspecciones api={api} permisos={permisos} esAdmin={esAdmin} />}
      {tabVigente === "fichas" && renderFichas && renderFichas()}
      {tabVigente === "equipo" && <HabilitacionesEquipo api={api} />}
      {tabVigente === "gestion" && <Gestion api={api} abrirLead={setLeadAbierto} version={version} onCambio={subir} />}
      {tabVigente === "ventas" && <Ventas api={api} catalogos={catalogos} abrirLead={setLeadAbierto} version={version} onCambio={subir} />}
      {tabVigente === "aprobaciones" && <AprobacionesTodo api={api} version={version} abrirLead={setLeadAbierto} onCambio={subir} />}
      {tabVigente === "agenda" && <Agenda api={api} catalogos={catalogos} abrirLead={setLeadAbierto} version={version} onCambio={subir} />}
      {tabVigente === "inventario" && <Inventario api={api} onCambio={subir} />}
      {tabVigente === "clientes" && <Clientes api={api} />}
      </ErrorBoundary>

      {leadAbierto && !leadEditando && (
        <LeadFicha api={api} leadId={leadAbierto} catalogos={catalogos} onCerrar={() => setLeadAbierto(null)} onCambio={subir}
          onEditar={async () => { const r = await api("leads.get", { id: leadAbierto }); setLeadEditando(r.lead); }} />
      )}
      {leadEditando && <FormLead api={api} catalogos={catalogos} lead={leadEditando} onCerrar={() => setLeadEditando(null)} onGuardado={() => { setLeadEditando(null); subir(); }} />}
    </div>
    </div>
  );
}
