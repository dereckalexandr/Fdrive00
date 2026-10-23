/**
 * EQUIPO · habilitaciones de los Ejecutivos
 * ----------------------------------------------------------------
 * Todo Ejecutivo nuevo parte con Ventas. El Jefe Local (o el Administrador) activa o quita aquí Compras y Consignaciones
 * de los ejecutivos de su local: define a quiénes llegan los leads de compra y de consignación (reparto rotativo).
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { Aviso, Cargando, Tarjeta, useCarga, mensajeError, apiPorDefecto } from "./crm-ui.jsx";

const HABILITACIONES = [
  { clave: "compras", permiso: "compras.operar", nombre: "Compras", ayuda: "Recibe y trabaja a los clientes que quieren vendernos su auto." },
  { clave: "consignaciones", permiso: "consignaciones.operar", nombre: "Consignaciones", ayuda: "Recibe y trabaja a los clientes que dejan su auto en consignación." },
];

function Interruptor({ activo, deshabilitado, onCambio, etiqueta }) {
  return (
    <button type="button" role="switch" aria-checked={activo} aria-label={etiqueta} disabled={deshabilitado} onClick={() => onCambio(!activo)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${activo ? "bg-emerald-600" : "bg-stone-300"}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${activo ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function HabilitacionesEquipo({ api = apiPorDefecto }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("equipo.habilitaciones"), [api]);
  const [ocupado, setOcupado] = useState("");
  const [msg, setMsg] = useState(null);

  const cambiar = async (e, h, activo) => {
    setOcupado(`${e.id}:${h.clave}`); setMsg(null);
    try {
      await api("equipo.habilitar", { usuarioId: e.id, permiso: h.permiso, activo });
      setMsg({ ok: true, texto: `${e.nombre}: ${h.nombre} ${activo ? "activada" : "desactivada"}.` });
      await recargar();
    } catch (err) { setMsg({ ok: false, texto: mensajeError(err) }); }
    setOcupado("");
  };

  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (!datos) return <Cargando />;
  const lista = datos.ejecutivos;
  return (
    <div className="flex flex-col gap-4">
      <Tarjeta titulo="Habilitaciones de los ejecutivos" ayuda="Ventas la trae todo ejecutivo nuevo. Aquí activas Compras y Consignaciones: los leads de compra y de consignación (incluidos los del sitio web) se reparten solo entre quienes las tienen, de forma rotativa.">
        {msg && <div className="mb-3"><Aviso tipo={msg.ok ? "ok" : "error"}>{msg.texto}</Aviso></div>}
        {lista.length === 0 ? <p className="text-sm text-stone-500">No hay ejecutivos en este local.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                  <th className="py-2 pr-3">Ejecutivo</th><th className="py-2 pr-3">Ventas</th>
                  {HABILITACIONES.map((h) => <th key={h.clave} className="py-2 pr-3" title={h.ayuda}>{h.nombre}</th>)}
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => (
                  <tr key={e.id} className={`border-b border-stone-100 ${e.activo ? "" : "opacity-60"}`}>
                    <td className="py-2.5 pr-3 text-stone-900">{e.nombre}{!e.activo && <span className="ml-2 text-[10px] uppercase text-rose-600">desactivado</span>}</td>
                    <td className="py-2.5 pr-3">{e.ventas ? <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">Activa</span> : <span className="text-xs px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full" title="La maneja el Administrador">No</span>}</td>
                    {HABILITACIONES.map((h) => (
                      <td key={h.clave} className="py-2.5 pr-3">
                        <Interruptor activo={e[h.clave]} etiqueta={`${h.nombre} de ${e.nombre}`} deshabilitado={!!ocupado} onCambio={(v) => cambiar(e, h, v)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-stone-500 mt-3">Los cambios se aplican en segundos y quedan en la Bitácora. La habilitación de Ventas la modifica solo el Administrador (Usuarios → Editar).</p>
      </Tarjeta>
    </div>
  );
}
