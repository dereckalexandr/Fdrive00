/**
 * FINANZAS → NÓMINA
 * ----------------------------------------------------------------
 * Fichas de los trabajadores y nómina de cada mes. El CRM propone cada liquidación (calculadora de sueldo: AFP, salud,
 * cesantía, impuesto único) con las comisiones del mes que ya calcula el CRM, y suma lo que paga el empleador.
 * El Administrador ajusta lo que indique el contador, guarda y registra los pagos (sueldos líquidos, Previred, impuesto único):
 * cada pago crea sus egresos en Finanzas. El Jefe Local solo mira.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useMemo } from "react";
import { InputDinero } from "./campo-dinero.jsx";
import { AFPS } from "../supabase/functions/api/calculadora-sueldo-core.js";
import { armarNomina, parametrosNomina, FICHA_VACIA, VARIABLES_VACIAS, CONCEPTOS_NOMINA, montoConcepto, validarTrabajador } from "../supabase/functions/api/nomina-core.js";
import { buildLiquidacionesPdf } from "./pdf-report.js";
import { INPUT, BTN, BTN_PRIMARIO, clp as clpBase, Aviso, Cargando, Tarjeta, Campo, Modal, useCarga, mensajeError } from "./crm-ui.jsx";

const clp = (n) => (n !== null && n !== undefined && Number(n) < 0 ? `−${clpBase(-Number(n))}` : clpBase(n));
const hoyCL = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m) => { const [a, n] = String(m).split("-"); return `${MESES[Number(n) - 1]} ${a}`; };
const fechaCL = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
function ultimosMeses() {
  let [a, m] = hoyCL().split("-").map(Number);
  const out = [];
  for (let i = 0; i < 12; i++) { out.push(`${a}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; a--; } }
  return out;
}

/** Descarga el PDF con las liquidaciones del mes (todas, o la de un trabajador). */
async function descargarLiquidaciones(api, mes, trabajadorId, nombre) {
  const r = await api("fin.nomina_liquidaciones", { mes, ...(trabajadorId ? { trabajadorId } : {}) });
  const bytes = buildLiquidacionesPdf(r.liquidaciones, { fmt: clpBase });
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  const limpio = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  a.href = url; a.download = `Liquidacion_${mes}_${trabajadorId ? limpio(nombre) : "todas"}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return r.faltaEmpresa;
}

/* ================= Ficha de un trabajador ================= */
function FormTrabajador({ api, inicial, equipo, onCerrar, onListo }) {
  const [t, setT] = useState(() => (inicial
    ? { nombre: inicial.nombre, rut: inicial.rut || "", cargo: inicial.cargo || "", usuarioId: inicial.usuario_id || "", activo: inicial.activo, ficha: { ...FICHA_VACIA, ...inicial.ficha } }
    : { nombre: "", rut: "", cargo: "", usuarioId: "", activo: true, ficha: { ...FICHA_VACIA } }));
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const setF = (k, v) => setT((x) => ({ ...x, ficha: { ...x.ficha, [k]: v } }));
  const guardar = async () => {
    setMsg("");
    const v = validarTrabajador(t);
    if (!v.ok) { setMsg(mensajeError({ message: v.error })); return; }
    setOcupado(true);
    try { await api("fin.trabajador_guardar", { trabajador: t, ...(inicial ? { id: inicial.id } : {}) }); onListo(); }
    catch (e) { setMsg(mensajeError(e)); setOcupado(false); }
  };
  return (
    <Modal titulo={inicial ? `Ficha de ${inicial.nombre}` : "Agregar trabajador"} onCerrar={onCerrar}>
      <div className="flex flex-col gap-3">
        {!inicial && equipo.length > 0 && (
          <Campo etiqueta="¿Es parte del equipo del CRM?" ayuda="Así la nómina le propone sus comisiones del mes.">
            <select value={t.usuarioId} onChange={(e) => { const u = equipo.find((x) => x.id === e.target.value); setT((x) => ({ ...x, usuarioId: e.target.value, ...(u ? { nombre: u.nombre, rut: u.rut || "" } : {}) })); }} className={INPUT}>
              <option value="">No (otra persona)</option>
              {equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </Campo>
        )}
        <div className="grid md:grid-cols-3 gap-3">
          <Campo etiqueta="Nombre"><input value={t.nombre} onChange={(e) => setT({ ...t, nombre: e.target.value })} className={INPUT} /></Campo>
          <Campo etiqueta="RUT"><input value={t.rut} onChange={(e) => setT({ ...t, rut: e.target.value })} className={INPUT} placeholder="12.345.678-9" /></Campo>
          <Campo etiqueta="Cargo"><input value={t.cargo} onChange={(e) => setT({ ...t, cargo: e.target.value })} className={INPUT} /></Campo>
          <Campo etiqueta="Fecha de ingreso"><input type="date" value={t.ficha.fechaIngreso || ""} onChange={(e) => setF("fechaIngreso", e.target.value)} className={INPUT} /></Campo>
          <Campo etiqueta="Correo (opcional)"><input type="email" value={t.ficha.correo || ""} onChange={(e) => setF("correo", e.target.value)} className={INPUT} placeholder="nombre@correo.cl" /></Campo>
          <Campo etiqueta="Sueldo base (bruto)"><InputDinero value={t.ficha.sueldoBase || ""} onChange={(e) => setF("sueldoBase", Number(e.target.value))} className={INPUT} /></Campo>
          <Campo etiqueta="Contrato">
            <select value={t.ficha.contrato} onChange={(e) => setF("contrato", e.target.value)} className={INPUT}><option value="indefinido">Indefinido</option><option value="plazo_fijo">Plazo fijo / obra</option></select>
          </Campo>
          <Campo etiqueta="Gratificación legal">
            <select value={t.ficha.gratificacion ? "si" : "no"} onChange={(e) => setF("gratificacion", e.target.value === "si")} className={INPUT}><option value="si">Sí, mensual (25% con tope)</option><option value="no">No</option></select>
          </Campo>
          <Campo etiqueta="Colación"><InputDinero value={t.ficha.colacion || ""} onChange={(e) => setF("colacion", Number(e.target.value))} className={INPUT} placeholder="0" /></Campo>
          <Campo etiqueta="Movilización"><InputDinero value={t.ficha.movilizacion || ""} onChange={(e) => setF("movilizacion", Number(e.target.value))} className={INPUT} placeholder="0" /></Campo>
          <Campo etiqueta="Asignación familiar"><InputDinero value={t.ficha.asignacionFamiliar || ""} onChange={(e) => setF("asignacionFamiliar", Number(e.target.value))} className={INPUT} placeholder="0" /></Campo>
          <Campo etiqueta="AFP">
            <select value={t.ficha.afp} onChange={(e) => setF("afp", e.target.value)} className={INPUT}>{AFPS.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Salud">
            <select value={t.ficha.salud} onChange={(e) => setF("salud", e.target.value)} className={INPUT}><option value="fonasa">Fonasa (7%)</option><option value="isapre">Isapre</option></select>
          </Campo>
          {t.ficha.salud === "isapre" && <Campo etiqueta="Plan Isapre (UF)"><input type="number" step="0.01" min="0" value={t.ficha.planSaludUf || ""} onChange={(e) => setF("planSaludUf", Number(e.target.value))} className={INPUT} /></Campo>}
        </div>
        {inicial && <label className="text-sm text-stone-700 flex items-center gap-2"><input type="checkbox" checked={!t.activo} onChange={(e) => setT({ ...t, activo: !e.target.checked })} /> Ya no trabaja en la empresa (no se incluye en las próximas nóminas)</label>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={guardar} disabled={ocupado} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={onCerrar} className={BTN}>Cancelar</button>
          {msg && <p className="text-sm text-rose-600">{msg}</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ================= Registrar un pago ================= */
function PagarConcepto({ api, mes, concepto, monto, onCerrar, onListo }) {
  const ctas = useCarga(() => api("fin.resumen", {}), [api]);
  const [fecha, setFecha] = useState(hoyCL());
  const [cuenta, setCuenta] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const opciones = ((ctas.datos && ctas.datos.cuentas) || []).filter((c) => c.activa && c.tipo === "banco");
  useEffect(() => { if (!cuenta && opciones.length) setCuenta(opciones[0].clave); }, [opciones.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pagar = async () => {
    setOcupado(true); setMsg("");
    try { await api("fin.nomina_pagar", { mes, concepto: concepto.id, fecha, cuentaId: cuenta }); onListo(); }
    catch (e) { setMsg(mensajeError(e)); setOcupado(false); }
  };
  return (
    <Modal titulo={`Registrar pago · ${concepto.nombre}`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-stone-700">Nómina de {nombreMes(mes)}: <strong>{clp(monto)}</strong>. {concepto.id === "sueldos" ? "Se crea un egreso por cada trabajador." : "Se crea un egreso."} Cuenta como gasto de {nombreMes(mes)} aunque se pague después.</p>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Fecha de pago"><input type="date" value={fecha} max={hoyCL()} onChange={(e) => setFecha(e.target.value)} className={INPUT} /></Campo>
          <Campo etiqueta="Pagado desde">
            <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={INPUT}>
              {opciones.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
              <option value="">Caja (efectivo)</option>
            </select>
          </Campo>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={pagar} disabled={ocupado} className={BTN_PRIMARIO}>{ocupado ? "Registrando…" : "Registrar pago"}</button>
          <button type="button" onClick={onCerrar} className={BTN}>Cancelar</button>
          {msg && <p className="text-sm text-rose-600">{msg}</p>}
        </div>
      </div>
    </Modal>
  );
}

/** Detalle de la liquidación de un trabajador. */
function Liquidacion({ f }) {
  const r = f.resultado;
  const L = ({ t, m, menos }) => (m ? <div className="flex justify-between gap-3"><span>{t}</span><span>{menos ? `−${clpBase(m)}` : clpBase(m)}</span></div> : null);
  return (
    <div className="grid md:grid-cols-3 gap-4 text-xs text-stone-700 bg-stone-50 p-3">
      <div><p className="font-semibold mb-1">Haberes</p>
        <L t="Sueldo base" m={r.haberes.sueldoBase} /><L t="Horas extra" m={r.haberes.horasExtra} /><L t="Comisiones" m={r.haberes.comisiones} /><L t="Semana corrida" m={r.haberes.semanaCorrida} />
        <L t="Bonos" m={r.haberes.bonos} /><L t="Gratificación" m={r.haberes.gratificacion} /><L t="Colación" m={r.haberes.colacion} /><L t="Movilización" m={r.haberes.movilizacion} /><L t="Asignación familiar" m={r.haberes.asignacionFamiliar} />
        <div className="flex justify-between gap-3 font-semibold border-t border-stone-200 mt-1 pt-1"><span>Total haberes</span><span>{clpBase(r.totalHaberes)}</span></div>
      </div>
      <div><p className="font-semibold mb-1">Descuentos</p>
        <L t="AFP" m={r.descuentos.afp} menos /><L t="Salud" m={r.descuentos.salud} menos /><L t="Seguro de cesantía" m={r.descuentos.cesantia} menos /><L t="Impuesto único" m={r.descuentos.impuesto} menos /><L t="Anticipos y otros" m={r.descuentos.otros} menos />
        <div className="flex justify-between gap-3 font-semibold border-t border-stone-200 mt-1 pt-1"><span>Líquido a pagar</span><span>{clpBase(r.liquido)}</span></div>
      </div>
      <div><p className="font-semibold mb-1">Paga el empleador</p>
        <L t="Aporte reforma de pensiones (incl. SIS)" m={f.empleador.aporte} /><L t="Seguro de cesantía" m={f.empleador.cesantia} /><L t="Mutual (accidentes)" m={f.empleador.mutual} />
        <div className="flex justify-between gap-3 font-semibold border-t border-stone-200 mt-1 pt-1"><span>Costo empresa</span><span>{clpBase(f.costoEmpresa)}</span></div>
      </div>
    </div>
  );
}

const NUM = "border border-stone-300 bg-white px-2 py-1 text-sm text-right w-[5.5rem] focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-stone-50";

/* ================= Nómina del mes ================= */
export function Nomina({ api }) {
  const meses = useMemo(ultimosMeses, []);
  const [mes, setMes] = useState(meses[0]);
  const { cargando, error, datos, recargar } = useCarga(() => api("fin.nomina", { mes }), [api, mes]);
  const tr = useCarga(() => api("fin.trabajadores", {}), [api]);
  const [filas, setFilas] = useState(null); // [{ trabajadorId, variables }]
  const [param, setParam] = useState(null);
  const [cambios, setCambios] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const [pagar, setPagar] = useState(null);
  const [ficha, setFicha] = useState(null); // null | "nuevo" | trabajador
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!datos) return;
    const base = datos.nomina || datos.propuesta;
    setFilas(base ? base.filas.map((f) => ({ trabajadorId: f.trabajadorId, variables: { ...VARIABLES_VACIAS, ...f.variables } })) : []);
    setParam(parametrosNomina(base ? base.parametros : null));
    setCambios(false);
  }, [datos]);

  const trabajadores = (datos && datos.trabajadores) || [];
  const fichaDe = (id) => trabajadores.find((t) => t.id === id);
  // Cálculo en vivo con las mismas reglas del servidor.
  const calculo = useMemo(() => {
    if (!filas || !param) return null;
    const v = armarNomina({ parametros: param, filas: filas.map((f) => { const t = fichaDe(f.trabajadorId) || {}; return { trabajadorId: f.trabajadorId, nombre: t.nombre, rut: t.rut, ficha: t.ficha, variables: f.variables }; }) });
    return v;
  }, [filas, param, datos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (!filas || !param) return null;
  const puedeEditar = datos.puedeEditar;
  const pagos = datos.pagos || {};
  const algunPago = Object.values(pagos).some((p) => p.pagado);
  const bloqueada = !puedeEditar || algunPago;
  const setVar = (id, k, v) => { setFilas(filas.map((f) => (f.trabajadorId === id ? { ...f, variables: { ...f.variables, [k]: Number(v) || 0 } } : f))); setCambios(true); };
  const fuera = trabajadores.filter((t) => t.activo && !filas.some((f) => f.trabajadorId === t.id));
  const totales = calculo && calculo.ok ? calculo.value.totales : null;
  const guardar = async () => {
    setMsg(null); setOcupado(true);
    try { await api("fin.nomina_guardar", { mes, filas, parametros: param }); setMsg({ ok: true, texto: "Nómina guardada. Ahora registra los pagos cuando se hagan." }); await recargar(); }
    catch (e) { setMsg({ ok: false, texto: mensajeError(e) }); }
    setOcupado(false);
  };
  const recargarTodo = () => { tr.recargar(); recargar(); };
  const bajar = async (trabajadorId, nombre) => {
    try {
      const falta = await descargarLiquidaciones(api, mes, trabajadorId, nombre);
      if (falta) setMsg({ ok: false, texto: "Faltan la razón social o el RUT de la empresa: complétalos en Ventas → «Datos de la empresa» para que salgan en la liquidación." });
    } catch (e) { setMsg({ ok: false, texto: mensajeError(e) }); }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-stone-600">Mes:</span>
        <select value={mes} onChange={(e) => setMes(e.target.value)} className={`${INPUT} !w-auto`}>{meses.map((m) => <option key={m} value={m}>{nombreMes(m).replace(/^./, (c) => c.toUpperCase())}</option>)}</select>
        <span className={`text-xs px-2 py-0.5 rounded-full ${datos.nomina ? (algunPago ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800") : "bg-amber-100 text-amber-800"}`}>{datos.nomina ? (algunPago ? "Con pagos registrados" : "Guardada") : "Propuesta (sin guardar)"}</span>
        {cargando && <span className="text-xs text-stone-400">Cargando…</span>}
      </div>

      {trabajadores.length === 0 ? (
        <Tarjeta titulo="Sin trabajadores">
          <p className="text-sm text-stone-600">Primero agrega las fichas de los trabajadores (sueldo base, contrato, AFP y salud). {puedeEditar ? "" : "Lo hace el Administrador."}</p>
          {puedeEditar && <button type="button" onClick={() => setFicha("nuevo")} className={`${BTN_PRIMARIO} mt-3`}>+ Agregar trabajador</button>}
        </Tarjeta>
      ) : (
        <Tarjeta titulo={`Nómina de ${nombreMes(mes)}`} ayuda="Propuesta calculada por el CRM (AFP, salud, cesantía, impuesto único y aportes del empleador). Las comisiones vienen de lo que el CRM calcula en Ventas e Inspecciones. Ajusta lo que indique el contador antes de guardar."
          derecha={puedeEditar && !bloqueada && fuera.length > 0 && (
            <select value="" onChange={(e) => { if (e.target.value) { const t = fichaDe(e.target.value); setFilas([...filas, { trabajadorId: t.id, variables: { ...VARIABLES_VACIAS, comisiones: datos.comisionesCrm[t.id] || 0 } }]); setCambios(true); } }} className={`${INPUT} !w-auto`}>
              <option value="">+ Incluir trabajador…</option>{fuera.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          )}>
          {calculo && !calculo.ok && filas.length > 0 && <Aviso>{mensajeError({ message: calculo.error })}</Aviso>}
          {filas.length === 0 ? <p className="text-sm text-stone-500">No hay trabajadores en esta nómina.</p> : calculo && calculo.ok && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="text-left py-2 pr-2">Trabajador</th><th className="text-right py-2 px-1">Comisiones</th><th className="text-right py-2 px-1">Semana corrida</th><th className="text-right py-2 px-1">Bonos</th>
                    <th className="text-right py-2 px-1">Horas extra</th><th className="text-right py-2 px-1">Días ausente</th><th className="text-right py-2 px-1">Anticipos</th>
                    <th className="text-right py-2 px-2">Líquido</th><th className="text-right py-2 px-2">Costo empresa</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {calculo.value.filas.map((f) => {
                    const v = filas.find((x) => x.trabajadorId === f.trabajadorId).variables;
                    const crm = datos.comisionesCrm[f.trabajadorId] || 0;
                    const t = fichaDe(f.trabajadorId) || {};
                    return (
                      <React.Fragment key={f.trabajadorId}>
                        <tr>
                          <td className="py-2 pr-2 min-w-[9rem]"><span className="font-medium text-stone-900">{f.nombre}</span><span className="block text-xs text-stone-500">{t.cargo || ""}{t.cargo ? " · " : ""}base {clpBase(f.ficha.sueldoBase)}</span></td>
                          <td className="py-2 px-1 text-right"><InputDinero value={v.comisiones || ""} disabled={bloqueada} onChange={(e) => setVar(f.trabajadorId, "comisiones", e.target.value)} className={NUM} placeholder="0" />
                            {crm > 0 && crm !== v.comisiones && <button type="button" disabled={bloqueada} onClick={() => setVar(f.trabajadorId, "comisiones", crm)} className="block ml-auto text-[11px] text-amber-700 hover:underline">CRM: {clpBase(crm)}</button>}</td>
                          <td className="py-2 px-1 text-right"><InputDinero value={v.semanaCorrida || ""} disabled={bloqueada} onChange={(e) => setVar(f.trabajadorId, "semanaCorrida", e.target.value)} className={NUM} placeholder="0" /></td>
                          <td className="py-2 px-1 text-right"><InputDinero value={v.bonos || ""} disabled={bloqueada} onChange={(e) => setVar(f.trabajadorId, "bonos", e.target.value)} className={NUM} placeholder="0" /></td>
                          <td className="py-2 px-1 text-right"><input type="number" min="0" value={v.horasExtra || ""} disabled={bloqueada} onChange={(e) => setVar(f.trabajadorId, "horasExtra", e.target.value)} className={`${NUM} !w-14`} placeholder="0" /></td>
                          <td className="py-2 px-1 text-right"><input type="number" min="0" max="31" value={v.diasAusente || ""} disabled={bloqueada} onChange={(e) => setVar(f.trabajadorId, "diasAusente", e.target.value)} className={`${NUM} !w-14`} placeholder="0" /></td>
                          <td className="py-2 px-1 text-right"><InputDinero value={v.otrosDescuentos || ""} disabled={bloqueada} onChange={(e) => setVar(f.trabajadorId, "otrosDescuentos", e.target.value)} className={NUM} placeholder="0" /></td>
                          <td className="py-2 px-2 text-right whitespace-nowrap font-semibold">{clpBase(f.resultado.liquido)}</td>
                          <td className="py-2 px-2 text-right whitespace-nowrap">{clpBase(f.costoEmpresa)}</td>
                          <td className="py-2 pl-2 whitespace-nowrap text-right">
                            <button type="button" onClick={() => setAbierta(abierta === f.trabajadorId ? null : f.trabajadorId)} className="text-xs text-stone-700 hover:underline">{abierta === f.trabajadorId ? "Ocultar" : "Detalle"}</button>
                            {datos.nomina && !cambios && <button type="button" onClick={() => bajar(f.trabajadorId, f.nombre)} className="block ml-auto text-xs text-sky-700 hover:underline" title="Liquidación en PDF para firmar">PDF</button>}
                            {!bloqueada && <button type="button" onClick={() => { setFilas(filas.filter((x) => x.trabajadorId !== f.trabajadorId)); setCambios(true); }} className="block ml-auto text-xs text-rose-600 hover:underline">Quitar</button>}
                          </td>
                        </tr>
                        {abierta === f.trabajadorId && <tr><td colSpan={10} className="pb-3"><Liquidacion f={f} /></td></tr>}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="font-semibold text-stone-900 border-t border-stone-300">
                  <tr><td className="py-2" colSpan={7}>Total ({totales.trabajadores}) · haberes {clpBase(totales.haberes)}</td><td className="py-2 px-2 text-right">{clpBase(totales.liquido)}</td><td className="py-2 px-2 text-right">{clpBase(totales.costoEmpresa)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-stone-700">Valores legales usados (UF, UTM, tasas del empleador)</summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              {[["uf", "UF"], ["utm", "UTM"], ["sueldoMinimo", "Sueldo mínimo"], ["aporteEmpleador", "Aporte reforma (%)"], ["cesantiaIndefinido", "Cesantía empleador, indefinido (%)"], ["cesantiaPlazoFijo", "Cesantía empleador, plazo fijo (%)"], ["mutual", "Mutual (%)"]].map(([k, t]) => (
                <Campo key={k} etiqueta={t}><input type="number" step="0.01" value={param[k]} disabled={bloqueada} onChange={(e) => { setParam({ ...param, [k]: e.target.value }); setCambios(true); }} className={INPUT} /></Campo>
              ))}
            </div>
            <p className="text-xs text-stone-500 mt-2">Valores de referencia de noviembre de 2026. El aporte de la reforma de pensiones es 3,5% de agosto de 2026 a julio de 2027 (incluye el SIS) y sube cada agosto. La mutual depende de la actividad de la empresa. Confírmalos con el contador.</p>
          </details>
          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button type="button" onClick={guardar} disabled={ocupado || bloqueada || !calculo || !calculo.ok} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : datos.nomina ? "Guardar cambios" : "Guardar nómina"}</button>
              {cambios && !bloqueada && <span className="text-xs text-amber-700">Hay cambios sin guardar.</span>}
              {datos.nomina && <button type="button" onClick={() => bajar(null)} disabled={cambios} title={cambios ? "Guarda los cambios primero" : ""} className={BTN}>Descargar liquidaciones (PDF)</button>}
              {algunPago && <span className="text-xs text-stone-500">Ya tiene pagos: para corregirla, anula esos pagos en Movimientos.</span>}
              {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</span>}
            </div>
          )}
          {!puedeEditar && datos.nomina && (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button type="button" onClick={() => bajar(null)} className={BTN}>Descargar liquidaciones (PDF)</button>
              {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</span>}
            </div>
          )}
        </Tarjeta>
      )}

      {datos.nomina && (
        <div className="grid md:grid-cols-3 gap-3">
          {CONCEPTOS_NOMINA.map((c) => {
            const p = pagos[c.id] || {};
            const monto = montoConcepto(datos.nomina.totales, c.id);
            return (
              <div key={c.id} className="bg-white border border-stone-200 p-4 flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-stone-500">{c.nombre}</span>
                <span className="text-xl font-semibold text-stone-900">{clp(p.pagado ? p.monto : monto)}</span>
                {p.pagado ? <span className="text-xs text-emerald-700">Pagado el {fechaCL(p.fecha)}{p.movimientos > 1 ? ` · ${p.movimientos} egresos` : ""}</span>
                  : monto > 0 ? <span className="text-xs text-amber-700">{c.id === "previred" ? "Pendiente (vence el 13 del mes siguiente)" : c.id === "impuesto" ? "Pendiente (se paga con el F29)" : "Pendiente"}</span>
                  : <span className="text-xs text-stone-500">No corresponde este mes</span>}
                {puedeEditar && !p.pagado && monto > 0 && <button type="button" disabled={cambios} title={cambios ? "Guarda los cambios primero" : ""} onClick={() => setPagar(c)} className={`${BTN} self-start mt-1`}>Registrar pago</button>}
              </div>
            );
          })}
        </div>
      )}

      <Tarjeta titulo="Trabajadores" ayuda="Datos fijos de cada persona. Los cambios se usan en las nóminas que se guarden desde ahora."
        derecha={puedeEditar && <button type="button" onClick={() => setFicha("nuevo")} className={BTN}>+ Agregar trabajador</button>}>
        {trabajadores.length === 0 ? <p className="text-sm text-stone-500">Aún no hay trabajadores.</p> : (
          <div className="text-sm divide-y divide-stone-100">
            {trabajadores.map((t) => (
              <div key={t.id} className={`flex flex-wrap justify-between gap-2 py-2 ${t.activo ? "" : "text-stone-400"}`}>
                <span><span className="font-medium">{t.nombre}</span>{t.cargo && <span className="text-stone-500"> · {t.cargo}</span>}{!t.activo && " · ya no trabaja"}{t.usuario_id && <span className="text-xs text-amber-700 ml-2">equipo CRM</span>}</span>
                <span className="flex items-center gap-3"><span>base {clpBase(t.ficha.sueldoBase)} · {t.ficha.contrato === "plazo_fijo" ? "plazo fijo" : "indefinido"} · {(AFPS.find((a) => a.id === t.ficha.afp) || {}).nombre} · {t.ficha.salud === "isapre" ? "Isapre" : "Fonasa"}</span>
                  {puedeEditar && <button type="button" onClick={() => setFicha(t)} className="text-xs text-stone-700 hover:underline">Editar</button>}</span>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      {ficha && <FormTrabajador api={api} inicial={ficha === "nuevo" ? null : ficha} equipo={(tr.datos && tr.datos.equipo) || []} onCerrar={() => setFicha(null)} onListo={() => { setFicha(null); recargarTodo(); }} />}
      {pagar && <PagarConcepto api={api} mes={mes} concepto={pagar} monto={montoConcepto(datos.nomina.totales, pagar.id)} onCerrar={() => setPagar(null)} onListo={() => { setPagar(null); setMsg({ ok: true, texto: "Pago registrado: ya aparece en Movimientos." }); recargar(); }} />}
    </div>
  );
}
