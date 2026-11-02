/**
 * Pantalla de la calculadora de sueldo (sitio de inspecciones, sección «Calculadora»).
 * Todo se calcula en el navegador con src/calculadora-sueldo.js; no se guarda ni se envía nada.
 */
import React, { useEffect, useMemo, useState } from "react";
import { PARAMETROS, AFPS, ENTRADA_VACIA, calcularLiquido, calcularDesdeLiquido, calcularSemanaCorrida } from "./calculadora-sueldo.js";
import { llamar } from "./publico-api.js";

const INPUT = "border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full rounded-md";
const clp = (n) => `$${Math.round(n).toLocaleString("es-CL")}`;
const Campo = ({ etiqueta, children, ayuda }) => (<label className="text-sm text-stone-700 flex flex-col gap-1 min-w-0">{etiqueta}{children}{ayuda && <span className="text-xs text-stone-500">{ayuda}</span>}</label>);

/** Caja de dinero: muestra los miles con punto y entrega solo el número. */
function Dinero({ valor, onCambio, ...resto }) {
  return <input inputMode="numeric" value={valor ? Number(valor).toLocaleString("es-CL") : ""} onChange={(e) => onCambio(Number(e.target.value.replace(/\D/g, "").slice(0, 11)) || 0)} placeholder="0" className={INPUT} {...resto} />;
}
function Numero({ valor, onCambio, paso = 1, ...resto }) {
  return <input type="number" min="0" step={paso} value={valor === 0 ? "" : valor} onChange={(e) => onCambio(e.target.value === "" ? 0 : Number(e.target.value))} placeholder="0" className={INPUT} {...resto} />;
}
const Titulo = ({ children }) => <p className="text-xs uppercase tracking-widest text-stone-400 mt-2 mb-1 col-span-full">{children}</p>;
const Fila = ({ etiqueta, valor, fuerte, signo }) => (
  <div className={`flex justify-between gap-3 py-1.5 ${fuerte ? "font-semibold text-stone-900 border-t border-stone-300 mt-1 pt-2" : "text-stone-700"}`}>
    <span>{etiqueta}</span><span className="font-mono tabular-nums">{signo}{clp(valor)}</span>
  </div>
);

export default function Calculadora() {
  const [modo, setModo] = useState("base"); // base: sé el sueldo base · liquido: sé cuánto quiero recibir
  const [e, setE] = useState(ENTRADA_VACIA);
  const [liquidoDeseado, setLiquidoDeseado] = useState(0);
  const [p, setP] = useState(PARAMETROS);
  const [origen, setOrigen] = useState("referencia");
  const [origenMinimo, setOrigenMinimo] = useState("referencia");
  const [calcSemana, setCalcSemana] = useState(false);
  const [sc, setSc] = useState({ comision: 0, diasHabiles: 0, diasInhabiles: 0 });
  const semana = calcularSemanaCorrida(sc);
  const set = (k, v) => setE((x) => ({ ...x, [k]: v }));
  const setPar = (k, v) => { setP((x) => ({ ...x, [k]: v })); setOrigen("manual"); if (k === "sueldoMinimo") setOrigenMinimo("manual"); };

  // UF y UTM del día (mindicador.cl, datos del Banco Central); si no responde, quedan los valores de referencia.
  useEffect(() => {
    document.title = "Calculadora de sueldo · Drive Futuro";
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    fetch("https://mindicador.cl/api", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const uf = Number(d && d.uf && d.uf.valor);
        const utm = Number(d && d.utm && d.utm.valor);
        if (uf > 1000 && utm > 10000) { setP((x) => ({ ...x, uf, utm })); setOrigen("dia"); }
      })
      .catch(() => {})
      .finally(() => clearTimeout(t));
    // Sueldo mínimo vigente: lo entrega el servidor (lo lee de páginas de referencia; si no puede, usa el último conocido).
    let vivo = true;
    llamar("calculadora.parametros")
      .then((d) => { const m = Number(d && d.sueldoMinimo); if (vivo && m >= 400000 && m <= 5000000) { setP((x) => ({ ...x, sueldoMinimo: m })); setOrigenMinimo(d.fuente === "web" ? "web" : "respaldo"); } })
      .catch(() => {});
    return () => { vivo = false; clearTimeout(t); ctl.abort(); };
  }, []);

  const resultado = useMemo(() => {
    if (modo === "base") return { ok: true, sueldoBase: e.sueldoBase, resultado: calcularLiquido(e, p) };
    return calcularDesdeLiquido(liquidoDeseado, e, p);
  }, [modo, e, p, liquidoDeseado]);
  const r = resultado.ok ? resultado.resultado : null;
  const vacio = modo === "base" ? !e.sueldoBase : !liquidoDeseado;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <h1 className="font-serif text-3xl md:text-4xl text-stone-900 leading-tight">Calculadora de sueldo</h1>
      <p className="text-stone-600 mt-2 max-w-2xl">Calcula la renta líquida y la imponible. Elige si conoces el sueldo base o el líquido que quieres recibir. Es una simulación: no reemplaza la liquidación del empleador.</p>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <form onSubmit={(ev) => ev.preventDefault()} className="lg:col-span-3 bg-white border border-stone-200 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-full flex rounded-lg border border-stone-300 overflow-hidden text-sm" role="tablist">
            {[["base", "Tengo el sueldo base"], ["liquido", "Quiero recibir un líquido"]].map(([id, nombre]) => (
              <button key={id} type="button" role="tab" aria-selected={modo === id} onClick={() => setModo(id)} className={`flex-1 px-3 py-2.5 font-medium transition-colors ${modo === id ? "bg-stone-900 text-white" : "bg-white text-stone-700 hover:bg-stone-50"}`}>{nombre}</button>
            ))}
          </div>

          {modo === "base"
            ? <div className="col-span-full"><Campo etiqueta="Sueldo base (imponible) *"><Dinero valor={e.sueldoBase} onCambio={(v) => set("sueldoBase", v)} autoFocus /></Campo></div>
            : <div className="col-span-full"><Campo etiqueta="Sueldo líquido que quieres recibir *" ayuda="Se calcula el sueldo base con el que llegas a ese líquido, con los demás datos de abajo."><Dinero valor={liquidoDeseado} onCambio={setLiquidoDeseado} autoFocus /></Campo></div>}

          <div className="col-span-full rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-xs uppercase tracking-widest text-amber-800">Valores legales vigentes</p>
              <p className="text-xs text-stone-500">{origenMinimo === "web" ? "Sueldo mínimo leído automáticamente" : origenMinimo === "manual" ? "Sueldo mínimo editado por ti" : "Sueldo mínimo: último valor conocido"} · {origen === "dia" ? "UF y UTM de hoy" : origen === "manual" ? "UF y UTM editadas" : "UF y UTM de referencia"}</p>
            </div>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 mt-2">
              <div><dt className="text-xs text-stone-500">Sueldo mínimo imponible legal</dt><dd className="font-semibold text-stone-900">{clp(p.sueldoMinimo)}</dd></div>
              <div><dt className="text-xs text-stone-500">Tope imponible ({p.topeAfpUf} UF)</dt><dd className="font-semibold text-stone-900">{clp(p.topeAfpUf * p.uf)}</dd></div>
              <div><dt className="text-xs text-stone-500">UF</dt><dd className="font-semibold text-stone-900">${Number(p.uf).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
              <div><dt className="text-xs text-stone-500">UTM</dt><dd className="font-semibold text-stone-900">{clp(p.utm)}</dd></div>
            </dl>
            {modo === "base" && <button type="button" onClick={() => set("sueldoBase", Math.round(p.sueldoMinimo))} className="mt-3 text-xs font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900">Usar el sueldo mínimo como sueldo base</button>}
          </div>

          <Titulo>Contrato</Titulo>
          <Campo etiqueta="Tipo de contrato"><select value={e.contrato} onChange={(ev) => set("contrato", ev.target.value)} className={INPUT}><option value="indefinido">Indefinido</option><option value="plazo_fijo">Plazo fijo</option></select></Campo>
          <Campo etiqueta="Gratificación legal"><select value={e.gratificacion ? "si" : "no"} onChange={(ev) => set("gratificacion", ev.target.value === "si")} className={INPUT}><option value="no">No</option><option value="si">Sí (25%, con tope legal)</option></select></Campo>
          <Campo etiqueta="Días del mes" ayuda="Cuenta fines de semana y feriados."><Numero valor={e.diasLaborales} onCambio={(v) => set("diasLaborales", v)} max="31" /></Campo>
          <Campo etiqueta="Días ausente" ayuda="Se descuentan del sueldo base."><Numero valor={e.diasAusente} onCambio={(v) => set("diasAusente", v)} max="31" /></Campo>

          <Titulo>Haberes imponibles</Titulo>
          <Campo etiqueta="Horas extra"><Numero valor={e.horasExtra} onCambio={(v) => set("horasExtra", v)} paso="0.5" /></Campo>
          <Campo etiqueta="Comisiones"><Dinero valor={e.comisiones} onCambio={(v) => set("comisiones", v)} /></Campo>
          <Campo etiqueta={<span className="flex items-center justify-between gap-2">Semana corrida<button type="button" onClick={() => setCalcSemana((v) => !v)} className="text-xs text-amber-800 underline underline-offset-2 font-medium">{calcSemana ? "Cerrar calculadora" : "Calculadora"}</button></span>}><Dinero valor={e.semanaCorrida} onCambio={(v) => set("semanaCorrida", v)} /></Campo>
          <Campo etiqueta="Bonos imponibles"><Dinero valor={e.bonos} onCambio={(v) => set("bonos", v)} /></Campo>
          {calcSemana && (
            <div className="col-span-full rounded-xl border border-emerald-300 bg-emerald-50 p-4 flex flex-col gap-3">
              <p className="font-serif text-base text-stone-900">Calculadora de semana corrida</p>
              <p className="text-xs text-stone-600">Para quien gana comisiones: la comisión del mes se reparte entre los días hábiles y se paga por cada día festivo y domingo.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Campo etiqueta="Total comisión del mes"><Dinero valor={sc.comision} onCambio={(v) => setSc((x) => ({ ...x, comision: v }))} /></Campo>
                <Campo etiqueta="Días hábiles del mes"><Numero valor={sc.diasHabiles} onCambio={(v) => setSc((x) => ({ ...x, diasHabiles: v }))} max="31" /></Campo>
                <Campo etiqueta="Días festivos y domingos"><Numero valor={sc.diasInhabiles} onCambio={(v) => setSc((x) => ({ ...x, diasInhabiles: v }))} max="31" /></Campo>
              </div>
              {e.comisiones > 0 && sc.comision !== e.comisiones && <button type="button" onClick={() => setSc((x) => ({ ...x, comision: e.comisiones }))} className="self-start text-xs text-amber-800 underline underline-offset-2">Usar las comisiones ingresadas ({clp(e.comisiones)})</button>}
              <div className="flex items-center justify-between border-t border-emerald-200 pt-3 text-sm"><span>Comisión ÷ días hábiles (redondeado)</span><span className="font-mono">{clp(semana.porDia)}</span></div>
              <div className="flex items-center justify-between border-t border-emerald-200 pt-3 text-sm"><span>Resultado (× días festivos y domingos)</span><span className="font-mono text-lg text-emerald-800">{clp(semana.semanaCorrida)}</span></div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setCalcSemana(false)} className="border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-600 rounded-md hover:bg-stone-50">Cancelar</button>
                <button type="button" onClick={() => { set("semanaCorrida", semana.semanaCorrida); setCalcSemana(false); }} className="bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium rounded-md hover:bg-emerald-700">Agregar a semana corrida</button>
              </div>
            </div>
          )}

          <Titulo>Haberes no imponibles</Titulo>
          <Campo etiqueta="Colación"><Dinero valor={e.colacion} onCambio={(v) => set("colacion", v)} /></Campo>
          <Campo etiqueta="Movilización"><Dinero valor={e.movilizacion} onCambio={(v) => set("movilizacion", v)} /></Campo>
          <Campo etiqueta="Asignación familiar" ayuda="Monto que te corresponde."><Dinero valor={e.asignacionFamiliar} onCambio={(v) => set("asignacionFamiliar", v)} /></Campo>

          <Titulo>Previsión y salud</Titulo>
          <Campo etiqueta="AFP" ayuda={(() => { const a = AFPS.find((x) => x.id === e.afp); return a && a.comision !== null ? `${p.cotizacionAfp}% + comisión de ${String(a.comision).replace(".", ",")}%` : "No se descuenta AFP"; })()}>
            <select value={e.afp} onChange={(ev) => set("afp", ev.target.value)} className={INPUT}>{AFPS.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Salud"><select value={e.salud} onChange={(ev) => set("salud", ev.target.value)} className={INPUT}><option value="fonasa">Fonasa (7%)</option><option value="isapre">Isapre (plan en UF)</option></select></Campo>
          {e.salud === "isapre" && <Campo etiqueta="Plan de salud (UF)" ayuda="Si es menor al 7% legal, se descuenta el 7%."><Numero valor={e.planSaludUf} onCambio={(v) => set("planSaludUf", v)} paso="0.01" /></Campo>}

          <Titulo>Otros</Titulo>
          <Campo etiqueta="Otros descuentos" ayuda="Anticipos, préstamos, pensión de alimentos, caja de compensación…"><Dinero valor={e.otrosDescuentos} onCambio={(v) => set("otrosDescuentos", v)} /></Campo>

          <details className="col-span-full text-sm">
            <summary className="cursor-pointer text-stone-600">Editar los valores legales</summary>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <Campo etiqueta="Valor UF"><Numero valor={p.uf} onCambio={(v) => setPar("uf", v)} paso="0.01" /></Campo>
              <Campo etiqueta="Valor UTM"><Numero valor={p.utm} onCambio={(v) => setPar("utm", v)} paso="1" /></Campo>
              <Campo etiqueta="Sueldo mínimo" ayuda={origenMinimo === "web" ? "Vigente, leído automáticamente." : origenMinimo === "manual" ? "Editado por ti." : "Último valor conocido (vigente desde mayo de 2026)."}><Numero valor={p.sueldoMinimo} onCambio={(v) => setPar("sueldoMinimo", v)} paso="1" /></Campo>
              <Campo etiqueta="Jornada semanal (horas)"><Numero valor={p.jornadaSemanal} onCambio={(v) => setPar("jornadaSemanal", v)} /></Campo>
            </div>
            <p className="text-xs text-stone-500 mt-2">Tope imponible de AFP y salud: {p.topeAfpUf} UF. Seguro de cesantía: {String(p.topeCesantiaUf).replace(".", ",")} UF. Impuesto según la tabla mensual del SII.</p>
          </details>
        </form>

        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-5 text-sm lg:sticky lg:top-4" aria-live="polite">
          {!resultado.ok && !vacio && <p className="text-rose-700">{resultado.error === "fuera_de_rango" ? "Ese líquido no se puede alcanzar con los datos ingresados." : "Escribe un líquido válido."}</p>}
          {vacio && <p className="text-stone-500">{modo === "base" ? "Escribe el sueldo base para ver el resultado." : "Escribe el líquido que quieres recibir para ver el sueldo base."}</p>}
          {r && !vacio && (
            <>
              <p className="text-xs uppercase tracking-widest text-stone-400">Sueldo líquido</p>
              <p className="font-serif text-4xl text-stone-900 mt-1">{clp(r.liquido)}</p>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="bg-stone-50 rounded-lg p-3"><p className="text-xs text-stone-500">Renta imponible</p><p className="font-semibold text-stone-900 mt-0.5">{clp(r.imponible)}</p></div>
                <div className="bg-stone-50 rounded-lg p-3"><p className="text-xs text-stone-500">Sueldo base{modo === "liquido" ? " necesario" : ""}</p><p className="font-semibold text-stone-900 mt-0.5">{clp(resultado.sueldoBase)}</p></div>
              </div>
              <div className="mt-4">
                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Haberes</p>
                <Fila etiqueta="Sueldo base" valor={r.haberes.sueldoBase} />
                {r.haberes.gratificacion > 0 && <Fila etiqueta="Gratificación" valor={r.haberes.gratificacion} />}
                {r.haberes.horasExtra > 0 && <Fila etiqueta="Horas extra" valor={r.haberes.horasExtra} />}
                {r.haberes.comisiones > 0 && <Fila etiqueta="Comisiones" valor={r.haberes.comisiones} />}
                {r.haberes.semanaCorrida > 0 && <Fila etiqueta="Semana corrida" valor={r.haberes.semanaCorrida} />}
                {r.haberes.bonos > 0 && <Fila etiqueta="Bonos imponibles" valor={r.haberes.bonos} />}
                <Fila etiqueta="Total imponible" valor={r.imponible} fuerte />
                {r.noImponibles > 0 && <Fila etiqueta="No imponibles" valor={r.noImponibles} />}
                <Fila etiqueta="Total haberes" valor={r.totalHaberes} fuerte />
              </div>
              <div className="mt-4">
                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Descuentos</p>
                <Fila etiqueta="AFP" valor={r.descuentos.afp} signo="−" />
                <Fila etiqueta="Salud" valor={r.descuentos.salud} signo="−" />
                <Fila etiqueta="Seguro de cesantía" valor={r.descuentos.cesantia} signo="−" />
                <Fila etiqueta="Impuesto único" valor={r.descuentos.impuesto} signo="−" />
                {r.descuentos.otros > 0 && <Fila etiqueta="Otros descuentos" valor={r.descuentos.otros} signo="−" />}
                <Fila etiqueta="Total descuentos" valor={r.totalDescuentos} fuerte signo="−" />
              </div>
              <p className="text-xs text-stone-500 mt-4">Base tributable: {clp(r.baseTributable)}.{r.superaTope ? ` La renta imponible supera el tope de ${clp(r.topeAfpSalud)} para AFP y salud.` : ""}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
