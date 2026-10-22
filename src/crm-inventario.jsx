/**
 * INVENTARIO DE VEHÍCULOS Y CLIENTES (CRM · entrega 2A)
 * ----------------------------------------------------------------
 * Los datos viven en Supabase (tablas vehiculos y clientes). Cada foto del inventario se
 * reduce en el dispositivo y se guarda aparte (vfoto::<vehículo>::<id>), igual que las
 * fotos de las tasaciones; el vehículo solo guarda los ids.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useMemo } from "react";
import { InputDinero } from "./campo-dinero.jsx";
import { ESTADOS_VEHICULO, TRANSMISIONES, COMBUSTIBLES, validarVehiculo, validarCliente, textoVencimiento } from "../supabase/functions/api/ventas-core.js";
import { compressImage, makePhotoId } from "./photos.js";
import { SeccionInspeccion } from "./crm-inspecciones.jsx";
import { SeccionValidacion } from "./crm-validaciones.jsx";
import { INPUT, BTN, BTN_PRIMARIO, clp, Aviso, Cargando, Campo, Modal, Tarjeta, useCarga, mensajeError, fechaCorta, BuscarPatente } from "./crm-ui.jsx";
import { aplicarCampos } from "./datos-patente.js";

const MAX_FOTOS = 6;
const fotoKey = (vehiculoId, fotoId) => `vfoto::${vehiculoId}::${fotoId}`;
const estadoNombre = (id) => (ESTADOS_VEHICULO.find((e) => e.id === id) || {}).nombre || id;
const COLOR_ESTADO = { disponible: "bg-emerald-100 text-emerald-800", reservado: "bg-amber-100 text-amber-800", vendido: "bg-stone-200 text-stone-700", preparacion: "bg-sky-100 text-sky-800" };

const cacheFotos = new Map();
function Miniatura({ vehiculoId, fotoId, grande = false, onQuitar }) {
  const [src, setSrc] = useState(cacheFotos.get(fotoId) || "");
  useEffect(() => {
    if (src) return undefined;
    let vivo = true;
    (async () => {
      const r = await window.storage.get(fotoKey(vehiculoId, fotoId), true);
      if (vivo && r && r.value) { cacheFotos.set(fotoId, r.value); setSrc(r.value); }
    })();
    return () => { vivo = false; };
  }, [vehiculoId, fotoId, src]);
  const tam = grande ? "w-24 h-24" : "w-14 h-14";
  return (
    <div className={`relative ${tam} bg-stone-200 border border-stone-300 shrink-0`}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-stone-400">…</span>}
      {onQuitar && <button type="button" onClick={onQuitar} className="absolute -top-2 -right-2 bg-rose-600 text-white w-5 h-5 text-xs rounded-full" aria-label="Quitar foto">✕</button>}
    </div>
  );
}

const VACIO = { id: null, patente: "", marca: "", modelo: "", version: "", anio: "", km: "", color: "", transmision: "", combustible: "", precioLista: "", costo: "", estado: "disponible", notas: "" };

function FormVehiculo({ api, vehiculo, puedeCosto, onCerrar, onGuardado }) {
  const [f, setF] = useState(() => (vehiculo ? {
    id: vehiculo.id, patente: vehiculo.patente, marca: vehiculo.marca, modelo: vehiculo.modelo, version: vehiculo.version || "", anio: vehiculo.anio, km: vehiculo.km,
    color: vehiculo.color || "", transmision: vehiculo.transmision || "", combustible: vehiculo.combustible || "", precioLista: vehiculo.precio_lista ?? "",
    costo: vehiculo.costo ?? "", estado: vehiculo.estado, notas: vehiculo.notas || "",
  } : VACIO));
  const [fotos, setFotos] = useState(vehiculo ? [...(vehiculo.fotos || [])] : []); // ids ya guardados
  const [nuevas, setNuevas] = useState([]); // { id, dataUrl } aún sin subir
  const [quitadas, setQuitadas] = useState([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const total = fotos.length + nuevas.length;

  const agregarFotos = async (ev) => {
    const archivos = Array.from(ev.target.files || []);
    ev.target.value = "";
    setError("");
    for (const a of archivos) {
      if (fotos.length + nuevas.length >= MAX_FOTOS) { setError(`Máximo ${MAX_FOTOS} fotos por vehículo.`); break; }
      try {
        const dataUrl = await compressImage(a);
        setNuevas((n) => (fotos.length + n.length >= MAX_FOTOS ? n : [...n, { id: makePhotoId(), dataUrl }]));
      } catch (e) { setError("No se pudo leer una de las fotos."); }
    }
  };

  const guardar = async () => {
    setError("");
    const datos = { ...f, fotos };
    if (!puedeCosto) delete datos.costo;
    const v = validarVehiculo(datos);
    if (!v.ok) { setError(mensajeError({ message: v.error })); return; }
    setGuardando(true);
    try {
      const r = await api("inventario.save", { id: f.id || undefined, datos: puedeCosto ? datos : { ...datos, costo: vehiculo ? vehiculo.costo : null } });
      const id = r.vehiculo.id;
      let ids = [...fotos];
      for (const n of nuevas) {
        const ok = await window.storage.set(fotoKey(id, n.id), n.dataUrl, true);
        if (ok) { ids.push(n.id); cacheFotos.set(n.id, n.dataUrl); }
      }
      if (nuevas.length > 0 || quitadas.length > 0) {
        await api("inventario.save", { id, datos: { ...datos, fotos: ids, costo: puedeCosto ? datos.costo : r.vehiculo.costo } });
        for (const q of quitadas) { try { await window.storage.delete(fotoKey(id, q), true); } catch (e) { /* se limpia luego */ } }
        if (ids.length < fotos.length + nuevas.length) setError("");
      }
      onGuardado();
    } catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };

  return (
    <Modal titulo={f.id ? `Editar ${f.patente}` : "Nuevo vehículo"} onCerrar={onCerrar}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Campo etiqueta="Patente"><input value={f.patente} onChange={(e) => set("patente", e.target.value.toUpperCase())} className={`${INPUT} font-mono`} placeholder="ABCD12" /></Campo>
          <BuscarPatente patente={f.patente} className="mt-1.5" onDatos={(campos) => { const r = aplicarCampos(f, campos, { pisar: true }); setF(r.valores); return r.llenados; }} />
        </div>
        <Campo etiqueta="Marca"><input value={f.marca} onChange={(e) => set("marca", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Modelo"><input value={f.modelo} onChange={(e) => set("modelo", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Versión (opcional)" className="md:col-span-2"><input value={f.version} onChange={(e) => set("version", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Año"><input type="number" value={f.anio} onChange={(e) => set("anio", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Kilometraje"><input type="number" min="0" value={f.km} onChange={(e) => set("km", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Color"><input value={f.color} onChange={(e) => set("color", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Estado">
          <select value={f.estado} disabled={f.estado === "reservado"} onChange={(e) => set("estado", e.target.value)} className={INPUT}>{ESTADOS_VEHICULO.filter((e) => e.id !== "reservado" || f.estado === "reservado").map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
        </Campo>
        <Campo etiqueta="Transmisión">
          <select value={f.transmision} onChange={(e) => set("transmision", e.target.value)} className={INPUT}><option value="">—</option>{TRANSMISIONES.map((t) => <option key={t}>{t}</option>)}</select>
        </Campo>
        <Campo etiqueta="Combustible">
          <select value={f.combustible} onChange={(e) => set("combustible", e.target.value)} className={INPUT}><option value="">—</option>{COMBUSTIBLES.map((t) => <option key={t}>{t}</option>)}</select>
        </Campo>
        <Campo etiqueta="Precio de lista ($)"><InputDinero value={f.precioLista} onChange={(e) => set("precioLista", e.target.value)} className={INPUT} /></Campo>
        {puedeCosto && <Campo etiqueta="Costo ($)" ayuda="Solo lo ven quienes editan el inventario."><InputDinero value={f.costo} onChange={(e) => set("costo", e.target.value)} className={INPUT} /></Campo>}
      </div>
      <Campo etiqueta="Notas"><textarea rows={2} value={f.notas} onChange={(e) => set("notas", e.target.value)} className={INPUT} /></Campo>

      <div>
        <p className="text-sm text-stone-700 mb-2">Fotos ({total}/{MAX_FOTOS})</p>
        <div className="flex flex-wrap gap-3">
          {fotos.map((id) => <Miniatura key={id} vehiculoId={f.id} fotoId={id} grande onQuitar={() => { setFotos(fotos.filter((x) => x !== id)); setQuitadas([...quitadas, id]); }} />)}
          {nuevas.map((n) => (
            <div key={n.id} className="relative w-24 h-24 border border-amber-400">
              <img src={n.dataUrl} alt="" className="w-full h-full object-cover" />
              <button type="button" onClick={() => setNuevas(nuevas.filter((x) => x.id !== n.id))} className="absolute -top-2 -right-2 bg-rose-600 text-white w-5 h-5 text-xs rounded-full" aria-label="Quitar foto">✕</button>
            </div>
          ))}
          {total < MAX_FOTOS && (
            <label className="w-24 h-24 border-2 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-500 text-xs cursor-pointer hover:border-amber-500 text-center">
              <span className="text-xl">＋</span>Agregar foto
              <input type="file" accept="image/*" multiple className="hidden" onChange={agregarFotos} />
            </label>
          )}
        </div>
        <p className="text-xs text-stone-500 mt-2">Las fotos se reducen en tu dispositivo antes de guardarse.</p>
      </div>

      {f.id && <SeccionValidacion api={api} origen={{ tipo: "vehiculo", id: f.id }} titulo="Documentos del vehículo" />}
      {f.id && <SeccionInspeccion api={api} origen={{ tipo: "vehiculo", id: f.id }} vehiculo={f} />}

      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={guardando} className={BTN_PRIMARIO}>{guardando ? "Guardando…" : "Guardar vehículo"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

export function Inventario({ api, onCambio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("inventario.list"), [api]);
  const [filtro, setFiltro] = useState("activos");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null); // null | "nuevo" | vehículo
  const [msg, setMsg] = useState("");

  const lista = useMemo(() => {
    if (!datos) return [];
    const t = q.trim().toLowerCase();
    return datos.vehiculos.filter((v) => {
      if (filtro === "activos" ? v.estado === "vendido" : v.estado !== filtro) return false;
      return !t || [v.patente, v.marca, v.modelo, v.version, String(v.anio)].some((x) => String(x || "").toLowerCase().includes(t));
    });
  }, [datos, filtro, q]);

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const puedeEditar = datos.puedeEditar;
  const cuenta = (id) => datos.vehiculos.filter((v) => v.estado === id).length;

  const cambiarEstado = async (v, estado) => {
    setMsg("");
    try { await api("inventario.setEstado", { id: v.id, estado }); await recargar(); onCambio && onCambio(); } catch (e) { setMsg(mensajeError(e)); }
  };
  const archivar = async (v) => {
    if (!window.confirm(`¿Archivar ${v.patente} (${v.marca} ${v.modelo})? Dejará de aparecer en el inventario; el historial se conserva.`)) return;
    try { await api("inventario.archivar", { id: v.id }); await recargar(); onCambio && onCambio(); } catch (e) { setMsg(mensajeError(e)); }
  };

  return (
    <>
      <Tarjeta>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por patente, marca, modelo o año" className={`${INPUT} md:flex-1`} />
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${INPUT} md:w-56`}>
            <option value="activos">Todo (sin vendidos)</option>
            {ESTADOS_VEHICULO.map((e) => <option key={e.id} value={e.id}>{e.nombre} ({cuenta(e.id)})</option>)}
          </select>
          {puedeEditar && <button onClick={() => setForm("nuevo")} className={BTN_PRIMARIO}>+ Nuevo vehículo</button>}
        </div>
      </Tarjeta>
      {msg && <Aviso>{msg}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-3 px-4">Vehículo</th><th className="py-3 px-4 text-right hidden md:table-cell">Km</th><th className="py-3 px-4 text-right">Precio</th>
              {puedeEditar && <th className="py-3 px-4 text-right">Margen</th>}<th className="py-3 px-4">Estado</th>{puedeEditar && <th className="py-3 px-4">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">{datos.vehiculos.length === 0 ? "El inventario está vacío." : "Ningún vehículo coincide con el filtro."}</td></tr>}
            {lista.map((v) => (
              <tr key={v.id} className="border-b border-stone-100 align-top">
                <td className="py-3 px-4">
                  <div className="flex gap-3">
                    {(v.fotos || [])[0] ? <Miniatura vehiculoId={v.id} fotoId={v.fotos[0]} /> : <div className="w-14 h-14 bg-stone-100 border border-stone-200 shrink-0" />}
                    <div>
                      <p className="text-stone-900">{v.marca} {v.modelo} <span className="text-stone-500">{v.version || ""}</span></p>
                      <p className="text-xs text-stone-500"><span className="font-mono">{v.patente}</span> · {v.anio}{v.transmision ? ` · ${v.transmision}` : ""}{v.combustible ? ` · ${v.combustible}` : ""}{v.color ? ` · ${v.color}` : ""}</p>
                      <p className="text-[11px] text-stone-400">Ingresó {fechaCorta(v.creado_en)}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-mono whitespace-nowrap hidden md:table-cell">{Number(v.km).toLocaleString("es-CL")}</td>
                <td className="py-3 px-4 text-right font-mono whitespace-nowrap">{clp(v.precio_lista)}</td>
                {puedeEditar && <td className="py-3 px-4 text-right font-mono whitespace-nowrap">{v.costo != null && v.precio_lista != null ? clp(v.precio_lista - v.costo) : "—"}</td>}
                <td className="py-3 px-4">
                  {puedeEditar ? (
                    <div>
                      <select value={v.estado} disabled={v.estado === "reservado"} title={v.estado === "reservado" ? "Para liberarlo, cancela la reserva desde el lead" : ""} onChange={(e) => cambiarEstado(v, e.target.value)} className="border border-stone-300 bg-white px-2 py-1 text-xs disabled:bg-stone-100">
                        {ESTADOS_VEHICULO.filter((e) => e.id !== "reservado" || v.estado === "reservado").map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                      </select>
                      {v.estado === "reservado" && v.reserva_vence_en && <p className="text-[11px] text-sky-700 mt-1">Reserva {textoVencimiento(v.reserva_vence_en)}</p>}
                    </div>
                  ) : <span className={`text-xs px-2 py-1 ${COLOR_ESTADO[v.estado] || ""}`}>{estadoNombre(v.estado)}{v.estado === "reservado" && v.reserva_vence_en ? ` · ${textoVencimiento(v.reserva_vence_en)}` : ""}</span>}
                </td>
                {puedeEditar && (
                  <td className="py-3 px-4"><div className="flex gap-2">
                    <button onClick={() => setForm(v)} className={BTN}>Editar</button>
                    <button onClick={() => archivar(v)} className={BTN}>Archivar</button>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <FormVehiculo api={api} vehiculo={form === "nuevo" ? null : form} puedeCosto={puedeEditar} onCerrar={() => setForm(null)} onGuardado={async () => { setForm(null); await recargar(); onCambio && onCambio(); }} />}
    </>
  );
}

/* =========================================================
   CLIENTES
========================================================= */
function FormCliente({ api, cliente, onCerrar, onGuardado }) {
  const [f, setF] = useState(cliente ? { nombre: cliente.nombre, rut: cliente.rut || "", telefono: cliente.telefono || "", email: cliente.email || "", notas: cliente.notas || "" } : { nombre: "", rut: "", telefono: "", email: "", notas: "" });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    const v = validarCliente(f);
    if (!v.ok) { setError(mensajeError({ message: v.error })); return; }
    setGuardando(true);
    try { await api("clientes.save", { id: cliente ? cliente.id : undefined, datos: f }); onGuardado(); }
    catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };
  return (
    <Modal titulo={cliente ? "Editar cliente" : "Nuevo cliente"} onCerrar={onCerrar} ancho="max-w-lg">
      <Campo etiqueta="Nombre completo"><input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} /></Campo>
      <Campo etiqueta="RUT (opcional)"><input value={f.rut} onChange={(e) => set("rut", e.target.value)} className={`${INPUT} font-mono`} placeholder="12.345.678-5" /></Campo>
      <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} className={INPUT} placeholder="+56 9 1234 5678" /></Campo>
      <Campo etiqueta="Correo"><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} className={INPUT} /></Campo>
      <Campo etiqueta="Notas"><textarea rows={2} value={f.notas} onChange={(e) => set("notas", e.target.value)} className={INPUT} /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={guardando} className={BTN_PRIMARIO}>{guardando ? "Guardando…" : "Guardar"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

export function Clientes({ api }) {
  const [q, setQ] = useState("");
  const { cargando, error, datos, recargar } = useCarga(() => api("clientes.list", { q }), [api, q]);
  const [form, setForm] = useState(null);
  return (
    <>
      <Tarjeta>
        <div className="flex flex-col md:flex-row gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, RUT, teléfono o correo" className={`${INPUT} md:flex-1`} />
          <button onClick={() => setForm("nuevo")} className={BTN_PRIMARIO}>+ Nuevo cliente</button>
        </div>
      </Tarjeta>
      {error && <Aviso>{error}</Aviso>}
      {cargando && !datos && <Cargando />}
      {datos && (
        <div className="bg-white border border-stone-200 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-3 px-4">Cliente</th><th className="py-3 px-4">RUT</th><th className="py-3 px-4">Contacto</th><th className="py-3 px-4"></th>
            </tr></thead>
            <tbody>
              {datos.clientes.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-stone-500">{q ? "Ningún cliente coincide." : "Aún no hay clientes. Se crean al registrar un lead."}</td></tr>}
              {datos.clientes.map((c) => (
                <tr key={c.id} className="border-b border-stone-100">
                  <td className="py-3 px-4 text-stone-900">{c.nombre}{c.notas && <p className="text-xs text-stone-500">{c.notas}</p>}</td>
                  <td className="py-3 px-4 font-mono text-stone-700">{c.rut || "—"}</td>
                  <td className="py-3 px-4 text-stone-700">{c.telefono || ""}{c.telefono && c.email ? " · " : ""}{c.email || ""}</td>
                  <td className="py-3 px-4 text-right"><button onClick={() => setForm(c)} className={BTN}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <FormCliente api={api} cliente={form === "nuevo" ? null : form} onCerrar={() => setForm(null)} onGuardado={async () => { setForm(null); await recargar(); }} />}
    </>
  );
}
