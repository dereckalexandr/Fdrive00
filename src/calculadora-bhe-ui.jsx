/**
 * Pantalla de la calculadora de boletas de honorarios (sitio de inspecciones, sección «Calculadora BHE»).
 * Todo se calcula en el navegador con src/calculadora-bhe.js; no se guarda ni se envía nada.
 */
import React, { useEffect, useMemo, useState } from "react";
import { RETENCION_POR_ANIO, ANIO_MAX, calcularBoleta, anioPorDefecto } from "./calculadora-bhe.js";
import { PARAMETROS } from "./calculadora-sueldo.js";
import { cargarIndicadores } from "./indicadores.js";
import { Campo, Dinero, Numero, INPUT, clp } from "./calculadora-sueldo-ui.jsx";

const ANIOS = [ANIO_MAX, 2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019];
const pct = (n) => `${String(n).replace(".", ",")}%`;

function Copiar({ valor }) {
  const [hecho, setHecho] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(String(Math.round(valor))); setHecho(true); setTimeout(() => setHecho(false), 1500); } catch { /* sin permiso para copiar */ }
  };
  return <button type="button" onClick={copiar} className="text-xs text-amber-800 underline underline-offset-2">{hecho ? "Copiado" : "Copiar"}</button>;
}

function Resultado({ titulo, explicacion, fila }) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 text-sm">
      <p className="text-xs uppercase tracking-widest text-stone-400">{titulo}</p>
      <p className="text-xs text-stone-500 mt-1">{explicacion}</p>
      <div className="mt-3 divide-y divide-stone-100">
        {fila.map(([nombre, valor, fuerte]) => (
          <div key={nombre} className={`flex items-center justify-between gap-3 py-2 ${fuerte ? "font-semibold text-stone-900" : "text-stone-700"}`}>
            <span>{nombre}</span>
            <span className="flex items-center gap-3"><span className={`font-mono tabular-nums ${fuerte ? "text-lg" : ""}`}>{clp(valor)}</span><Copiar valor={valor} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CalculadoraBhe() {
  const [moneda, setMoneda] = useState("clp");
  const [monto, setMonto] = useState(0);
  const [anio, setAnio] = useState(anioPorDefecto());
  const [uf, setUf] = useState(PARAMETROS.uf);
  const [origenUf, setOrigenUf] = useState("referencia");

  useEffect(() => {
    document.title = "Calculadora de boletas de honorarios · Drive Futuro";
    const ctl = new AbortController();
    cargarIndicadores(ctl.signal).then((d) => { if (d) { setUf(d.uf); setOrigenUf("dia"); } });
    return () => ctl.abort();
  }, []);

  const r = useMemo(() => calcularBoleta({ monto, moneda, anio, uf }), [monto, moneda, anio, uf]);
  const vacio = !monto;
  const tasa = RETENCION_POR_ANIO[anio] / 100;

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <h1 className="font-serif text-3xl md:text-4xl text-stone-900 leading-tight">Calculadora de boletas de honorarios</h1>
      <p className="text-stone-600 mt-2 max-w-2xl">Calcula la retención del SII, el total de la boleta y lo que recibes. Escribe el monto acordado y mira los dos casos: que sea lo que quieres recibir (líquido) o el total de la boleta (bruto).</p>

      <form onSubmit={(ev) => ev.preventDefault()} className="mt-6 bg-white border border-stone-200 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Campo etiqueta="Moneda del monto acordado">
          <select value={moneda} onChange={(ev) => setMoneda(ev.target.value)} className={INPUT}><option value="clp">Pesos (CLP)</option><option value="uf">UF</option></select>
        </Campo>
        <Campo etiqueta="Monto acordado *" ayuda={moneda === "uf" ? "En UF, con decimales si hace falta." : undefined}>
          {moneda === "clp" ? <Dinero valor={monto} onCambio={setMonto} autoFocus /> : <Numero valor={monto} onCambio={setMonto} paso="0.01" autoFocus />}
        </Campo>
        <Campo etiqueta="Año de emisión de la boleta" ayuda={`Retención de ese año: ${pct(tasa)}.`}>
          <select value={anio} onChange={(ev) => setAnio(Number(ev.target.value))} className={INPUT}>
            {ANIOS.map((a) => <option key={a} value={a}>{a === 2019 ? "2019 o anterior" : a === ANIO_MAX ? `${a} en adelante` : a} — {pct(RETENCION_POR_ANIO[a] / 100)}</option>)}
          </select>
        </Campo>
        {moneda === "uf" && (
          <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Campo etiqueta="Valor de la UF ($)" ayuda={origenUf === "dia" ? "UF de hoy (Banco Central)." : "Valor de referencia: cámbialo si tu contrato usa otra fecha."}>
              <Numero valor={uf} onCambio={setUf} paso="0.01" />
            </Campo>
          </div>
        )}
      </form>

      <div className="mt-6" aria-live="polite">
        {vacio && <p className="text-stone-500 text-sm">Escribe el monto acordado para ver el resultado.</p>}
        {!vacio && !r.ok && <p className="text-rose-700 text-sm">{r.error === "uf_invalida" ? "Escribe un valor de UF válido." : "Escribe un monto válido."}</p>}
        {!vacio && r.ok && (
          <>
            {moneda === "uf" && <p className="text-xs text-stone-500 mb-3">{monto} UF × ${Number(uf).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = {clp(r.montoPesos)}. Las boletas del SII se emiten en pesos.</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Resultado titulo="El monto es lo que quieres recibir" explicacion={`Líquido de ${clp(r.comoLiquido.liquido)}: la boleta se emite por un total mayor.`}
                fila={[["Total de la boleta (bruto)", r.comoLiquido.bruto, true], [`Retención SII (${pct(r.tasa)})`, r.comoLiquido.retencion], ["Monto líquido a recibir", r.comoLiquido.liquido]]} />
              <Resultado titulo="El monto es el total de la boleta" explicacion={`Boleta por ${clp(r.comoBruto.bruto)}: el SII retiene el ${pct(r.tasa)}.`}
                fila={[["Total de la boleta (bruto)", r.comoBruto.bruto], [`Retención SII (${pct(r.tasa)})`, r.comoBruto.retencion], ["Monto líquido a recibir", r.comoBruto.liquido, true]]} />
            </div>
            <p className="text-xs text-stone-500 mt-4 max-w-3xl">La tasa que se aplica es la vigente en la fecha de emisión de la boleta, no la del mes en que hiciste el trabajo. La retención no es un gasto perdido: en la Operación Renta se usa primero para tus cotizaciones y tu impuesto, y solo el excedente se devuelve. Es una simulación referencial.</p>
          </>
        )}
      </div>
    </div>
  );
}
