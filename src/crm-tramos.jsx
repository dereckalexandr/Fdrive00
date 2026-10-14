/**
 * EDITOR DE TRAMOS DE COMISIÓN POR PERSONA
 * ----------------------------------------------------------------
 * Mismo esquema que "crear perfil de ejecutivo" del sistema anterior: por cada módulo se usan los
 * tramos estándar de la plataforma o se personalizan. En pantalla los porcentajes se escriben como
 * 25 (%) y se guardan como 0,25.
 * ----------------------------------------------------------------
 */
import React from "react";
import { MODULOS_COMISION, TRAMOS_ESTANDAR, etiquetaTramo } from "../supabase/functions/api/comisiones-core.js";

const INPUT = "border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500";
const clp = (n) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;

const textoEstandar = (m) => TRAMOS_ESTANDAR[m.key].map((t) => `${etiquetaTramo(t)}: ${m.tipo === "porcentaje" ? `${Math.round(t.rate * 100)}%` : clp(t.rate)}`).join(" · ");

export function TramosEditor({ valor, onChange }) {
  const poner = (key, filas) => { const sig = { ...valor }; if (filas.length === 0) delete sig[key]; else sig[key] = filas; onChange(sig); };
  return (
    <div className="p-3 flex flex-col gap-4">
      <p className="text-xs text-stone-500">Cada módulo usa los tramos estándar de la plataforma, salvo que lo personalices. La cantidad del mes decide el tramo y su valor se aplica a <strong>todas</strong> las unidades del mes.</p>
      {MODULOS_COMISION.map((m) => {
        const filas = valor[m.key];
        const propio = !!filas;
        return (
          <div key={m.key} className="border border-stone-200 p-3">
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input type="checkbox" checked={propio} onChange={(e) => poner(m.key, e.target.checked ? TRAMOS_ESTANDAR[m.key].map((t) => ({ min: t.min, max: t.max === null ? "" : t.max, rate: m.tipo === "porcentaje" ? Math.round(t.rate * 10000) / 100 : t.rate })) : [])} />
              <span className="font-medium">{m.label}</span> <span className="text-xs text-stone-400">({m.unidad})</span>
              {propio && <span className="text-[10px] uppercase text-amber-600">personalizado</span>}
            </label>
            {!propio && <p className="text-xs text-stone-500 mt-1">Estándar → {textoEstandar(m)}</p>}
            {propio && (
              <div className="mt-2 flex flex-col gap-2">
                {filas.map((f, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-stone-500 w-12">Desde</span>
                    <input type="number" min="1" value={f.min} onChange={(e) => poner(m.key, filas.map((x, k) => (k === i ? { ...x, min: e.target.value } : x)))} className={`${INPUT} w-20`} />
                    <span className="text-stone-500">hasta</span>
                    <input type="number" min="1" value={f.max} placeholder="sin tope" onChange={(e) => poner(m.key, filas.map((x, k) => (k === i ? { ...x, max: e.target.value } : x)))} className={`${INPUT} w-24`} />
                    <span className="text-stone-500">unidades →</span>
                    <input type="number" min="0" step={m.tipo === "porcentaje" ? "0.5" : "1000"} value={f.rate} onChange={(e) => poner(m.key, filas.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)))} className={`${INPUT} w-28 text-right font-mono`} />
                    <span className="text-stone-500">{m.tipo === "porcentaje" ? "%" : "$ c/u"}</span>
                    <button type="button" onClick={() => { const sig = filas.filter((_, k) => k !== i); poner(m.key, sig.length ? sig : []); }} className="text-rose-500 px-1" aria-label="Quitar tramo">✕</button>
                  </div>
                ))}
                <div className="flex gap-3 items-center">
                  <button type="button" onClick={() => poner(m.key, [...filas, { min: "", max: "", rate: "" }])} className="text-xs border border-stone-300 px-2 py-1 bg-white hover:bg-stone-50">+ Agregar tramo</button>
                  <button type="button" onClick={() => poner(m.key, [])} className="text-xs text-stone-500 underline">Volver a los estándar</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
