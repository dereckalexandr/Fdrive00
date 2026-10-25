// Vista «Lista» de leads: filtros, orden, selección múltiple, reasignación en lote (Jefe Local) y exportar a CSV.
import React, { useEffect, useMemo, useState } from "react";
import { INPUT, BTN, BTN_AMBAR, clp, Aviso, Tarjeta, useCarga, mensajeError } from "./crm-ui.jsx";
import { Miniatura } from "./crm-inventario.jsx";
import { cuando } from "./crm-hoy.jsx";
import { armarFilaLead, filtrarFilas, ordenarFilas, filasACsv, ORDENES_LISTA } from "../supabase/functions/api/leads-lista-core.js";
import { etapaDeOperacion } from "../supabase/functions/api/compras-core.js";
import { ETAPAS_TODAS } from "../supabase/functions/api/ventas-core.js";

const SEMAFORO = { verde: "bg-emerald-100 text-emerald-800", ambar: "bg-amber-100 text-amber-800", rojo: "bg-rose-100 text-rose-800" };
const ATENCION = [
  { id: "", nombre: "Todos" }, { id: "abiertos", nombre: "Solo abiertos" }, { id: "porAtender", nombre: "Por atender (sin contacto)" },
  { id: "sinProxima", nombre: "Sin próxima acción" }, { id: "vencida", nombre: "Próxima acción vencida" }, { id: "detenido", nombre: "Detenidos (7 días o más)" }, { id: "perdidos", nombre: "Perdidos (archivados)" },
];
const TIPOS = [{ id: "", nombre: "Todos los tipos" }, { id: "venta", nombre: "Ventas" }, { id: "compra", nombre: "Compras" }, { id: "consignacion", nombre: "Consignaciones" }];

function descargarCsv(filas) {
  const blob = new Blob(["﻿" + filasACsv(filas)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `leads-${new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ListaLeads({ api, datos, mapas, catalogos, todos, abrirLead, recargar, onCambio, onPerdidos }) {
  const [f, setF] = useState({ texto: "", tipo: "", etapa: "", asignado: "", fuente: "", atencion: "abiertos" });
  const [orden, setOrden] = useState("recientes");
  const [sel, setSel] = useState([]);
  const [destino, setDestino] = useState("auto");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const { datos: eq } = useCarga(() => (datos.puedeAsignar ? api("equipo").catch(() => ({ equipo: [] })) : Promise.resolve({ equipo: [] })), [api, datos.puedeAsignar]);
  const destinatarios = (eq && eq.equipo) || [];
  const verPerdidos = f.atencion === "perdidos";
  useEffect(() => { onPerdidos(verPerdidos); }, [verPerdidos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPerdidos(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const filas = useMemo(() => {
    const prox = datos.proximas || {};
    return datos.leads.map((lead) => armarFilaLead({ lead, cliente: mapas.c.get(lead.cliente_id), vehiculo: mapas.v.get(lead.vehiculo_id), asignado: mapas.u.get(lead.asignado_a), proxima: prox[lead.id] }));
  }, [datos, mapas]);
  const visibles = useMemo(() => ordenarFilas(filtrarFilas(filas, f), orden), [filas, f, orden]);
  const fuentes = useMemo(() => Array.from(new Set([...(catalogos.fuentes_lead || []), ...filas.map((r) => r.fuente).filter(Boolean)])), [catalogos, filas]);
  const asignados = useMemo(() => Array.from(new Map(filas.filter((r) => r.asignadoId).map((r) => [r.asignadoId, r.asignado])).entries()), [filas]);
  const idsVisibles = visibles.map((r) => r.id);
  const marcados = sel.filter((id) => idsVisibles.includes(id));
  const poner = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setSel([]); };
  const alternar = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const todosMarcados = visibles.length > 0 && marcados.length === visibles.length;
  const abiertosVisibles = visibles.filter((r) => r.abierto);

  const reasignar = async () => {
    setMsg({ tipo: "", texto: "" }); setOcupado(true);
    try {
      const r = await api("leads.reasignarLote", { ids: marcados.slice(0, 50), asignarA: destino });
      const k = r.omitidos.length;
      setMsg({ tipo: "ok", texto: `${r.reasignados} lead(s) reasignado(s).${k ? ` ${k} no se ${k === 1 ? "movió" : "movieron"} (cerrado, con un cierre en curso, de otro tipo o ya era de esa persona).` : ""}` });
      setSel([]); await recargar(); onCambio();
    } catch (e) { setMsg({ tipo: "error", texto: mensajeError(e) }); }
    setOcupado(false);
  };

  return (
    <>
      <Tarjeta>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input value={f.texto} onChange={poner("texto")} placeholder="Buscar cliente, teléfono, vehículo…" className={`${INPUT} col-span-2`} aria-label="Buscar" />
          <select value={f.tipo} onChange={poner("tipo")} className={INPUT} aria-label="Tipo">{TIPOS.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
          <select value={f.etapa} onChange={poner("etapa")} className={INPUT} aria-label="Etapa">
            <option value="">Todas las etapas</option>
            {ETAPAS_TODAS.map((e) => <option key={e.id} value={e.id}>{f.tipo ? etapaDeOperacion(f.tipo, e.id, e.nombre) : e.nombre}</option>)}
          </select>
          {todos && (
            <select value={f.asignado} onChange={poner("asignado")} className={INPUT} aria-label="Ejecutivo">
              <option value="">Todos los ejecutivos</option><option value="sin">Sin asignar</option>
              {asignados.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            </select>
          )}
          <select value={f.fuente} onChange={poner("fuente")} className={INPUT} aria-label="Fuente"><option value="">Todas las fuentes</option>{fuentes.map((x) => <option key={x}>{x}</option>)}</select>
          <select value={f.atencion} onChange={poner("atencion")} className={INPUT} aria-label="Atención">{ATENCION.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select>
          <select value={orden} onChange={(e) => setOrden(e.target.value)} className={INPUT} aria-label="Ordenar">{ORDENES_LISTA.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
          <span className="text-stone-600">{visibles.length} de {filas.length} leads</span>
          <button type="button" onClick={() => { setF({ texto: "", tipo: "", etapa: "", asignado: "", fuente: "", atencion: "abiertos" }); setSel([]); }} className="underline text-stone-500">Limpiar filtros</button>
          <button type="button" disabled={visibles.length === 0} onClick={() => descargarCsv(marcados.length ? visibles.filter((r) => marcados.includes(r.id)) : visibles)} className={`${BTN} ml-auto`}>
            Exportar a Excel (CSV){marcados.length ? ` · ${marcados.length} seleccionados` : ""}
          </button>
        </div>
      </Tarjeta>

      {msg.texto && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {datos.puedeAsignar && marcados.length > 0 && (
        <div className="bg-stone-900 text-stone-100 p-3 rounded-xl flex flex-wrap items-center gap-3 text-sm">
          <span>{marcados.length} seleccionado(s){marcados.length > 50 ? " (se mueven de a 50)" : ""}</span>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className="bg-white text-stone-900 border border-stone-300 px-2 py-1.5 text-sm rounded-lg" aria-label="Reasignar a">
            <option value="auto">Reparto automático</option>{destinatarios.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
          <button onClick={reasignar} disabled={ocupado} className={BTN_AMBAR}>{ocupado ? "Reasignando…" : "Reasignar"}</button>
          <button onClick={() => setSel([])} className="underline text-stone-300">Quitar selección</button>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              {datos.puedeAsignar && <th className="py-3 px-3 w-8"><input type="checkbox" checked={todosMarcados} onChange={() => setSel(todosMarcados ? [] : abiertosVisibles.map((r) => r.id))} aria-label="Seleccionar todos los abiertos" /></th>}
              <th className="py-3 px-3">Cliente</th><th className="py-3 px-3">Vehículo</th><th className="py-3 px-3">Etapa</th>
              {todos && <th className="py-3 px-3">Ejecutivo</th>}
              {verPerdidos ? <th className="py-3 px-3">Motivo</th> : <th className="py-3 px-3">Próxima acción</th>}<th className="py-3 px-3">{verPerdidos ? "Creado" : "Días"}</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-stone-500">Ningún lead coincide con estos filtros.</td></tr>}
            {visibles.map((r) => (
              <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                {datos.puedeAsignar && <td className="py-2.5 px-3"><input type="checkbox" disabled={!r.abierto} checked={marcados.includes(r.id)} onChange={() => alternar(r.id)} aria-label={`Seleccionar a ${r.cliente}`} /></td>}
                <td className="py-2.5 px-3">
                  <button onClick={() => abrirLead(r.id)} className="text-stone-900 underline decoration-dotted text-left">{r.cliente || "Cliente"}</button>
                  <div className="text-xs text-stone-500">{r.tipoNombre}{r.fuente ? ` · ${r.fuente}` : ""}{r.porAtender ? " · por atender" : ""}</div>
                </td>
                <td className="py-2.5 px-3 text-stone-700">
                  <div className="flex items-center gap-2">
                    {r.foto && r.vehiculoId && <Miniatura vehiculoId={r.vehiculoId} fotoId={r.foto} tam="w-9 h-9 rounded overflow-hidden shrink-0" />}
                    <div><div>{r.vehiculo || "—"}</div>{r.monto > 0 && <div className="text-xs text-stone-500 tabular-nums">{clp(r.monto)}</div>}</div>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-stone-700 whitespace-nowrap">{r.etapaNombre}</td>
                {todos && <td className={`py-2.5 px-3 ${r.asignado ? "text-stone-700" : "text-rose-600"}`}>{r.asignado || "Sin asignar"}</td>}
                {verPerdidos ? <td className="py-2.5 px-3 text-xs text-stone-600">{r.motivoPerdida || "—"}</td> : <td className={`py-2.5 px-3 text-xs ${r.proxima ? (r.proximaVencida ? "text-orange-700 font-medium" : "text-stone-600") : r.abierto ? "text-violet-700" : "text-stone-400"}`}>
                  {r.proxima ? `${r.proximaVencida ? "Venció: " : ""}${r.proxima} · ${cuando(r.proximaFecha)}` : r.abierto ? "Sin próxima acción" : "—"}
                </td>}
                <td className="py-2.5 px-3">{verPerdidos ? <span className="text-xs text-stone-500">{r.creado ? new Date(r.creado).toLocaleDateString("es-CL", { timeZone: "America/Santiago" }) : "—"}</span> : r.abierto ? <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${SEMAFORO[r.dias >= 7 ? "rojo" : r.dias >= 3 ? "ambar" : "verde"]}`}>{r.dias === 0 ? "hoy" : `${r.dias} d`}</span> : <span className="text-stone-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Por defecto se ven los leads abiertos; «Todos» suma los ganados de los últimos 30 días. Los leads perdidos no aparecen en el tablero ni aquí: quedan guardados y se consultan en Atención → «Perdidos (archivados)». El CSV respeta los filtros y la selección y se abre directo en Excel.</p>
    </>
  );
}
