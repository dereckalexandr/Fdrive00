/**
 * FINANZAS → BANCOS Y CAJA → CONCILIAR CON CARTOLA
 * ----------------------------------------------------------------
 * Se sube la cartola del banco (CSV, Excel .xlsx o el «.xls» que descargan los bancos). La pantalla la lee y el servidor
 * empareja cada línea con lo registrado en la cuenta: muestra lo que cuadra, lo que está en el banco y falta en el CRM
 * (con categoría sugerida, para registrarlo de una vez) y lo que está en el CRM pero no en el banco. Compara además el
 * saldo final de la cartola con el saldo del CRM a esa fecha.
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { leerPlanilla } from "./lector-planillas.js";
import { leerCartola } from "../supabase/functions/api/conciliacion-core.js";
import { categoriasAgrupadas } from "../supabase/functions/api/finanzas-core.js";
import { INPUT, BTN, BTN_PRIMARIO, clp as clpBase, Aviso, Tarjeta, mensajeError } from "./crm-ui.jsx";

const clp = (n) => (n !== null && n !== undefined && Number(n) < 0 ? `−${clpBase(-Number(n))}` : clpBase(n));
const fechaCL = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

function Cifra({ titulo, valor, detalle, tono = "text-stone-900" }) {
  return (
    <div className="bg-white border border-stone-200 p-3 flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-stone-500">{titulo}</span>
      <span className={`text-xl font-semibold ${tono}`}>{valor}</span>
      {detalle && <span className="text-xs text-stone-500">{detalle}</span>}
    </div>
  );
}

export function Conciliacion({ api, cuenta, puedeEditar, onCerrar, onCambio }) {
  const [archivo, setArchivo] = useState("");
  const [lineas, setLineas] = useState(null); // las de la cartola, para volver a conciliar tras registrar
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [elegidas, setElegidas] = useState({}); // n → { marcada, categoria }
  const [verCuadran, setVerCuadran] = useState(false);

  const correr = async (ls) => {
    const r = await api("fin.conciliar", { cuenta: cuenta.clave, lineas: ls.map(({ fecha, descripcion, documento, monto, saldo }) => ({ fecha, descripcion, documento, monto, saldo })) });
    setRes(r);
    const sel = {};
    for (const l of r.lineas) if (l.estado === "falta") sel[l.n] = { marcada: true, categoria: l.categoria };
    setElegidas(sel);
    onCambio && onCambio();
  };

  const elegir = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    setMsg(null); setRes(null); setOcupado(true); setArchivo(file.name);
    try {
      const tabla = await leerPlanilla(file);
      const c = leerCartola(tabla, { anioRef: new Date().getFullYear() });
      if (!c.ok) throw new Error(c.error);
      setLineas(c.lineas);
      await correr(c.lineas);
    } catch (e) { setMsg({ ok: false, texto: mensajeError(e) }); }
    setOcupado(false);
  };

  const faltan = res ? res.lineas.filter((l) => l.estado === "falta") : [];
  const marcadas = faltan.filter((l) => elegidas[l.n] && elegidas[l.n].marcada);
  const registrar = async () => {
    setOcupado(true); setMsg(null);
    let ok = 0; let fallo = "";
    for (const l of marcadas) {
      const cat = elegidas[l.n].categoria;
      const tipo = l.monto > 0 ? "ingreso" : "egreso";
      try {
        await api("fin.mov_guardar", { mov: {
          tipo, categoria: cat, monto: Math.abs(l.monto), fecha: l.fecha, descripcion: (l.descripcion || "").length >= 3 ? l.descripcion : "Movimiento de la cartola",
          cuentaId: cuenta.clave, medio: "transferencia", documentoTipo: "comprobante", documentoNumero: l.documento || "", notas: "Registrado desde la conciliación bancaria",
        } });
        ok++;
      } catch (e) { fallo = `${fechaCL(l.fecha)} ${l.descripcion}: ${mensajeError(e)}`; break; }
    }
    try { await correr(lineas); } catch (e) { /* se ve al reintentar */ }
    setMsg(fallo ? { ok: false, texto: `Se registraron ${ok}. No se pudo registrar ${fallo}` } : { ok: true, texto: `Se registraron ${ok} movimientos. Adjunta sus respaldos en Movimientos si corresponde.` });
    setOcupado(false);
  };

  const r = res && res.resumen;
  return (
    <Tarjeta titulo={`Conciliar · ${cuenta.nombre}`} ayuda="Descarga la cartola desde el sitio del banco (Excel o CSV) y súbela aquí. El CRM la compara con lo registrado en esta cuenta: mismo monto y fecha cercana (hasta 4 días de diferencia)."
      derecha={<button type="button" onClick={onCerrar} className={BTN}>Cerrar</button>}>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`${BTN_PRIMARIO} cursor-pointer`}>{ocupado ? "Leyendo…" : res ? "Subir otra cartola" : "Subir cartola (Excel o CSV)"}
          <input type="file" accept=".csv,.txt,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={elegir} disabled={ocupado} className="hidden" />
        </label>
        {archivo && <span className="text-sm text-stone-600">{archivo}</span>}
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</span>}
      </div>

      {r && (
        <div className="flex flex-col gap-5 mt-4">
          <p className="text-sm text-stone-700">Cartola del {fechaCL(r.desde)} al {fechaCL(r.hasta)}: {r.lineas} movimientos.</p>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <Cifra titulo="Cuadran" valor={r.cuadran} tono="text-emerald-700" detalle="registrados en el CRM" />
            <Cifra titulo="Faltan en el CRM" valor={r.faltan} tono={r.faltan ? "text-amber-700" : "text-emerald-700"} detalle="están en el banco" />
            <Cifra titulo="No están en el banco" valor={r.sinCartola} tono={r.sinCartola ? "text-amber-700" : "text-emerald-700"} detalle="registrados en el CRM" />
            <Cifra titulo="Diferencia de saldo" valor={r.diferencia === null ? "—" : clp(r.diferencia)} tono={r.diferencia ? "text-rose-700" : "text-emerald-700"}
              detalle={r.saldoCartola === null ? "La cartola no trae saldo" : `Banco ${clp(r.saldoCartola)} · CRM ${clp(r.saldoCrm)} al ${fechaCL(r.hasta)}`} />
          </div>
          {r.diferencia === 0 && r.faltan === 0 && <Aviso tipo="ok">La cuenta está cuadrada con el banco al {fechaCL(r.hasta)}.</Aviso>}

          {faltan.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="font-medium text-stone-900">Están en el banco y faltan en el CRM</h4>
              <p className="text-xs text-stone-500">Comisiones del banco, pagos automáticos, transferencias que no se registraron… Revisa la categoría sugerida y regístralos. Si un pago de venta o compra aparece aquí, probablemente se registró con otra fecha, monto o cuenta: corrígelo en la venta o compra en vez de registrarlo de nuevo.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-stone-500"><tr>{puedeEditar && <th className="py-2 pr-2" />}<th className="text-left py-2 pr-3">Fecha</th><th className="text-left py-2 pr-3">Glosa del banco</th><th className="text-right py-2 pr-3">Monto</th>{puedeEditar && <th className="text-left py-2">Registrar como</th>}</tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {faltan.map((l) => (
                      <tr key={l.n}>
                        {puedeEditar && <td className="py-2 pr-2"><input type="checkbox" checked={!!(elegidas[l.n] && elegidas[l.n].marcada)} onChange={(e) => setElegidas({ ...elegidas, [l.n]: { ...elegidas[l.n], marcada: e.target.checked } })} /></td>}
                        <td className="py-2 pr-3 whitespace-nowrap">{fechaCL(l.fecha)}</td>
                        <td className="py-2 pr-3">{l.descripcion || "—"}{l.documento && <span className="block text-xs text-stone-500">Doc. {l.documento}</span>}</td>
                        <td className={`py-2 pr-3 text-right whitespace-nowrap font-medium ${l.monto > 0 ? "text-emerald-700" : "text-rose-700"}`}>{clp(l.monto)}</td>
                        {puedeEditar && (
                          <td className="py-2">
                            <select value={(elegidas[l.n] && elegidas[l.n].categoria) || ""} onChange={(e) => setElegidas({ ...elegidas, [l.n]: { ...elegidas[l.n], categoria: e.target.value } })} className={`${INPUT} !py-1 min-w-[14rem]`}>
                              {categoriasAgrupadas(l.monto > 0 ? "ingreso" : "egreso").map((g) => <optgroup key={g.id} label={g.nombre}>{g.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>)}
                            </select>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {puedeEditar && <button type="button" onClick={registrar} disabled={ocupado || marcadas.length === 0} className={`${BTN_PRIMARIO} self-start`}>{ocupado ? "Registrando…" : `Registrar ${marcadas.length} seleccionado${marcadas.length === 1 ? "" : "s"}`}</button>}
            </div>
          )}

          {res.sinCartola.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="font-medium text-stone-900">Registrados en el CRM y no están en el banco</h4>
              <p className="text-xs text-stone-500">Puede ser un pago aún no cobrado (cheque), uno registrado en otra cuenta o con un monto distinto, o un registro duplicado. Revísalos en Movimientos.</p>
              <div className="text-sm divide-y divide-stone-100">
                {res.sinCartola.map((m) => (
                  <div key={m.id} className="flex justify-between gap-3 py-1.5"><span><span className="text-stone-500 mr-2">{fechaCL(m.fecha)}</span><span className="font-mono text-xs text-stone-500 mr-2">{m.folio}</span>{m.descripcion}</span><span className={`whitespace-nowrap ${m.monto > 0 ? "text-emerald-700" : "text-rose-700"}`}>{clp(m.monto)}</span></div>
                ))}
              </div>
            </div>
          )}

          <div>
            <button type="button" onClick={() => setVerCuadran(!verCuadran)} className="text-sm text-stone-700 hover:underline">{verCuadran ? "Ocultar" : "Ver"} los {r.cuadran} que cuadran</button>
            {verCuadran && (
              <div className="text-sm divide-y divide-stone-100 mt-2">
                {res.lineas.filter((l) => l.estado === "cuadra").map((l) => (
                  <div key={l.n} className="flex justify-between gap-3 py-1.5"><span><span className="text-stone-500 mr-2">{fechaCL(l.fecha)}</span>{l.descripcion}<span className="block text-xs text-emerald-700">✓ {l.movimiento.folio} · {l.movimiento.descripcion}{l.movimiento.fecha !== l.fecha ? ` (registrado el ${fechaCL(l.movimiento.fecha)})` : ""}</span></span><span className="whitespace-nowrap">{clp(l.monto)}</span></div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Tarjeta>
  );
}
