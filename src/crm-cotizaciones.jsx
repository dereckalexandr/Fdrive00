/**
 * COTIZACIONES, APROBACIÓN DE DESCUENTOS Y RESERVAS (CRM · entrega 2B)
 * ----------------------------------------------------------------
 * - En la ficha de cada lead: cotizar un vehículo, entregar el PDF al cliente y reservar.
 * - Todo descuento lo aprueba el Jefe Local; mientras tanto la cotización no se puede
 *   entregar ni reservar. El supervisor tiene su propia bandeja ("Aprobaciones").
 * - El servidor valida todo; aquí se muestra lo que corresponde y se avisa con claridad.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect } from "react";
import { calcularCotizacion, validarCotizacion, validarReserva, cotizacionNombre, COTIZACION_ENTREGABLE, ESTADOS_FINANCIAMIENTO, MEDIOS_PAGO, textoVencimiento } from "../supabase/functions/api/ventas-core.js";
import { buildCotizacionPdf } from "./pdf-report.js";
import { INPUT, BTN, BTN_PRIMARIO, BTN_AMBAR, clp, fechaHora, hace, Aviso, Cargando, Tarjeta, Campo, Modal, useCarga, mensajeError } from "./crm-ui.jsx";

const COLOR_COT = {
  vigente: "bg-emerald-100 text-emerald-800", pendiente: "bg-amber-100 text-amber-800", rechazada: "bg-rose-100 text-rose-800",
  reservada: "bg-sky-100 text-sky-800", anulada: "bg-stone-200 text-stone-600",
};
export const folio = (n) => `COT-${String(n || 0).padStart(6, "0")}`;
const diaChile = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const fechaDia = (iso) => new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Santiago" });

/** Genera el PDF de una cotización y lo descarga. Las fotos se leen del almacenamiento (hasta 2). */
export async function descargarCotizacionPdf(cot, { cliente, ejecutivo, local, condiciones }) {
  const snap = cot.vehiculo_snapshot || {};
  const fotos = [];
  for (const id of (snap.fotos || []).slice(0, 2)) {
    try { const r = await window.storage.get(`vfoto::${snap.vehiculo_id || cot.vehiculo_id}::${id}`, true); if (r && r.value) fotos.push(r.value); } catch (e) { /* sin foto */ }
  }
  const bytes = buildCotizacionPdf({
    numero: cot.numero, fecha: diaChile(cot.creado_en), vigenciaHasta: cot.vigencia_hasta ? diaChile(cot.vigencia_hasta) : "",
    cliente: cliente || {}, vehiculo: snap, precio_lista: cot.precio_lista, descuento: cot.descuento, parte_pago: cot.parte_pago, financiamiento: cot.financiamiento,
    notas: cot.notas, ejecutivo, local, condiciones, fotos,
  }, { fmt: clp });
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${folio(cot.numero)}_${snap.patente || "vehiculo"}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* =========================================================
   FORMULARIO DE COTIZACIÓN
========================================================= */
function FormCotizacion({ api, lead, cotizacion, catalogos, onCerrar, onGuardado }) {
  const editando = !!cotizacion;
  const { datos: inv } = useCarga(() => api("inventario.list"), [api]);
  const pp0 = (cotizacion ? cotizacion.parte_pago : lead.parte_pago) || {};
  const fin0 = (cotizacion ? cotizacion.financiamiento : lead.financiamiento) || {};
  const [vehiculoId, setVehiculoId] = useState(cotizacion ? cotizacion.vehiculo_id : lead.vehiculo_id || "");
  const [descuento, setDescuento] = useState(cotizacion ? String(cotizacion.descuento || "") : "");
  const [tienePP, setTienePP] = useState(!!pp0.tiene);
  const [pp, setPp] = useState({ patente: pp0.patente || "", marca: pp0.marca || "", modelo: pp0.modelo || "", anio: pp0.anio ?? "", km: pp0.km ?? "", valor: pp0.valor ?? "" });
  const [quiereFin, setQuiereFin] = useState(!!fin0.quiere);
  const [fin, setFin] = useState({ pie: fin0.pie ?? "", banco: fin0.banco || "", estado: fin0.estado || "por_evaluar", plazoMeses: fin0.plazo_meses ?? 36, tasaMensualPct: fin0.tasa_mensual_pct ?? "" });
  const [notas, setNotas] = useState(cotizacion ? cotizacion.notas || "" : "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const opciones = inv ? inv.vehiculos.filter((v) => v.estado === "disponible" || v.id === vehiculoId) : [];
  const veh = opciones.find((v) => v.id === vehiculoId);
  const datos = { descuento, parteDePago: tienePP ? { tiene: true, ...pp } : { tiene: false }, financiamiento: quiereFin ? { quiere: true, ...fin } : { quiere: false }, notas };
  const calc = veh ? calcularCotizacion({ precioLista: veh.precio_lista, descuento, parteDePago: datos.parteDePago, financiamiento: { ...datos.financiamiento, plazo_meses: fin.plazoMeses, tasa_mensual_pct: fin.tasaMensualPct } }) : null;
  const requiereAprobacion = Number(descuento) > 0 && !catalogos.puedeAsignar;

  const guardar = async () => {
    setError("");
    if (!veh) { setError("Elige el vehículo que se cotiza."); return; }
    const v = validarCotizacion(datos, veh.precio_lista);
    if (!v.ok) { setError(mensajeError({ message: v.error })); return; }
    setGuardando(true);
    try { onGuardado((await api("cotizaciones.save", { leadId: lead.id, id: cotizacion ? cotizacion.id : undefined, vehiculoId, datos })).cotizacion); }
    catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };

  return (
    <Modal titulo={editando ? `Editar cotización ${folio(cotizacion.numero)}` : "Nueva cotización"} onCerrar={onCerrar} ancho="max-w-3xl">
      <Tarjeta titulo="Vehículo y precio">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Campo etiqueta="Vehículo del inventario" className="md:col-span-2">
            <select value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)} className={INPUT} disabled={editando}>
              <option value="">Elegir vehículo disponible…</option>
              {opciones.map((v) => <option key={v.id} value={v.id}>{v.marca} {v.modelo} {v.anio} · {v.patente} · {clp(v.precio_lista)}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Precio de lista"><input value={veh ? clp(veh.precio_lista) : "—"} disabled className={`${INPUT} bg-stone-100 font-mono`} /></Campo>
          <Campo etiqueta="Descuento ($)" ayuda={calc && Number(descuento) > 0 ? `${calc.descuentoPct.toLocaleString("es-CL")}% del precio de lista` : ""}>
            <input type="number" min="0" value={descuento} onChange={(e) => setDescuento(e.target.value)} className={INPUT} placeholder="0" />
          </Campo>
        </div>
        {requiereAprobacion && <div className="mt-3"><Aviso tipo="info">Todo descuento lo aprueba el Jefe Local. Podrás guardar la cotización, pero <strong>no podrás entregar el PDF ni reservar</strong> hasta que lo apruebe.</Aviso></div>}
        {Number(descuento) > 0 && catalogos.puedeAsignar && <p className="text-xs text-stone-500 mt-2">Como supervisor, este descuento queda aprobado a tu nombre y registrado en la bitácora.</p>}
      </Tarjeta>

      <Tarjeta>
        <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" checked={tienePP} onChange={(e) => setTienePP(e.target.checked)} /> El cliente entrega un vehículo en parte de pago</label>
        {tienePP && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Campo etiqueta="Patente"><input value={pp.patente} onChange={(e) => setPp({ ...pp, patente: e.target.value.toUpperCase() })} className={`${INPUT} font-mono`} /></Campo>
            <Campo etiqueta="Marca"><input value={pp.marca} onChange={(e) => setPp({ ...pp, marca: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Modelo"><input value={pp.modelo} onChange={(e) => setPp({ ...pp, modelo: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Año"><input type="number" value={pp.anio} onChange={(e) => setPp({ ...pp, anio: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Kilometraje"><input type="number" value={pp.km} onChange={(e) => setPp({ ...pp, km: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Valor que se le reconoce ($)"><input type="number" value={pp.valor} onChange={(e) => setPp({ ...pp, valor: e.target.value })} className={INPUT} /></Campo>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-stone-800 mt-4"><input type="checkbox" checked={quiereFin} onChange={(e) => setQuiereFin(e.target.checked)} /> Necesita financiamiento</label>
        {quiereFin && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Campo etiqueta="Pie ($)"><input type="number" value={fin.pie} onChange={(e) => setFin({ ...fin, pie: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Plazo (meses)"><input type="number" min="1" max="120" value={fin.plazoMeses} onChange={(e) => setFin({ ...fin, plazoMeses: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Tasa mensual referencial (%)" ayuda="Opcional; solo para estimar la cuota."><input type="number" step="0.01" min="0" value={fin.tasaMensualPct} onChange={(e) => setFin({ ...fin, tasaMensualPct: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Banco / financiera"><input value={fin.banco} onChange={(e) => setFin({ ...fin, banco: e.target.value })} className={INPUT} /></Campo>
            <Campo etiqueta="Evaluación">
              <select value={fin.estado} onChange={(e) => setFin({ ...fin, estado: e.target.value })} className={INPUT}>{ESTADOS_FINANCIAMIENTO.filter((e) => e.id !== "no_aplica").map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
            </Campo>
          </div>
        )}
      </Tarjeta>

      {calc && (
        <div className="bg-white border border-stone-200 p-4 text-sm">
          <p className="text-xs uppercase tracking-wide text-stone-400 mb-2">Así queda</p>
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-stone-600">Precio final</dt><dd className="text-right font-mono text-stone-900">{clp(calc.precioFinal)}</dd>
            {tienePP && <><dt className="text-stone-600">Menos: parte de pago</dt><dd className="text-right font-mono">− {clp(calc.parte)}</dd></>}
            <dt className="text-stone-800 font-medium">Saldo a pagar</dt><dd className="text-right font-mono font-medium">{clp(calc.saldo)}</dd>
            {quiereFin && <><dt className="text-stone-600">Menos: pie</dt><dd className="text-right font-mono">− {clp(calc.pie)}</dd>
              <dt className="text-stone-800 font-medium">Monto a financiar</dt><dd className="text-right font-mono font-medium">{clp(calc.montoFinanciar)}</dd>
              <dt className="text-stone-600">Cuota mensual estimada</dt><dd className="text-right font-mono">{calc.cuota ? clp(calc.cuota) : "—"}</dd></>}
          </dl>
          {calc.excede && <p className="text-rose-600 mt-2">La parte de pago y el pie superan el precio final.</p>}
        </div>
      )}
      <Campo etiqueta="Observaciones (aparecen en el PDF)"><textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} className={INPUT} /></Campo>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={guardando} className={BTN_PRIMARIO}>{guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear cotización"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* =========================================================
   FORMULARIO DE RESERVA
========================================================= */
function FormReserva({ api, cotizacion, catalogos, onCerrar, onGuardado }) {
  const [f, setF] = useState({ monto: "", dias: catalogos.dias_reserva || 3, medioPago: "Transferencia", notas: "" });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    const v = validarReserva(f, { precioFinal: cotizacion.precio_final, diasDefecto: catalogos.dias_reserva });
    if (!v.ok) { setError(mensajeError({ message: v.error === "monto_invalido" ? "El monto debe ser mayor a 0 y no superar el precio final." : v.error })); return; }
    setGuardando(true);
    try { await api("reservas.crear", { cotizacionId: cotizacion.id, ...f }); onGuardado(); }
    catch (e) { setError(mensajeError(e)); }
    setGuardando(false);
  };
  const snap = cotizacion.vehiculo_snapshot || {};
  return (
    <Modal titulo="Reservar vehículo" onCerrar={onCerrar} ancho="max-w-lg">
      <div className="bg-white border border-stone-200 p-4 text-sm">
        <p className="text-stone-900">{snap.marca} {snap.modelo} {snap.anio} · <span className="font-mono">{snap.patente}</span></p>
        <p className="text-stone-600">Cotización {folio(cotizacion.numero)} · precio final {clp(cotizacion.precio_final)}</p>
      </div>
      <Campo etiqueta="Monto de la reserva ($)"><input type="number" min="1" value={f.monto} onChange={(e) => set("monto", e.target.value)} className={INPUT} autoFocus /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Días de reserva" ayuda={`Por defecto ${catalogos.dias_reserva || 3}.`}><input type="number" min="1" max="30" value={f.dias} onChange={(e) => set("dias", e.target.value)} className={INPUT} /></Campo>
        <Campo etiqueta="Medio de pago"><select value={f.medioPago} onChange={(e) => set("medioPago", e.target.value)} className={INPUT}>{MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}</select></Campo>
      </div>
      <Campo etiqueta="Notas (opcional)"><input value={f.notas} onChange={(e) => set("notas", e.target.value)} className={INPUT} /></Campo>
      <Aviso tipo="info">El vehículo quedará reservado y saldrá de lo disponible. Si la reserva vence o se cancela, vuelve solo a estar disponible. El sistema <strong>registra</strong> el monto recibido; no mueve dinero, y una devolución se gestiona fuera de aquí.</Aviso>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={guardando} className={BTN_AMBAR}>{guardando ? "Reservando…" : "Reservar"}</button>
        <button onClick={onCerrar} className={BTN}>Cancelar</button>
      </div>
    </Modal>
  );
}

/* =========================================================
   SECCIÓN DENTRO DE LA FICHA DEL LEAD
========================================================= */
export function SeccionCotizaciones({ api, lead, datos, catalogos, onCambio, avisar }) {
  const [form, setForm] = useState(null); // null | "nueva" | cotización a editar
  const [reservando, setReservando] = useState(null);
  const [rechazando, setRechazando] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState("");
  const { cotizaciones, reservas, puedeEditar, cliente, asignado, localNombre } = datos;
  const activa = reservas.find((r) => r.estado === "activa");
  const cerrado = lead.etapa === "ganado" || lead.etapa === "perdido";

  const correr = async (clave, fn) => {
    avisar(""); setOcupado(clave);
    try { await fn(); await onCambio(); } catch (e) { avisar(mensajeError(e)); }
    setOcupado("");
  };
  const pdf = (c) => correr(`pdf${c.id}`, () => descargarCotizacionPdf(c, { cliente, ejecutivo: asignado ? asignado.nombre : "", local: localNombre, condiciones: catalogos.condiciones_cotizacion }));

  if (cotizaciones.length === 0 && !puedeEditar) return null;
  return (
    <div className="bg-white border border-stone-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-700">Cotizaciones</p>
        {puedeEditar && !cerrado && <button onClick={() => setForm("nueva")} className={BTN_AMBAR}>+ Nueva cotización</button>}
      </div>
      {cotizaciones.length === 0 && <p className="text-sm text-stone-500">Aún no hay cotizaciones. Al crear la primera, el lead pasa a «Cotizado».</p>}

      {activa && (
        <div className="border border-sky-300 bg-sky-50 p-3 text-sm">
          <p className="text-stone-900"><strong>Reserva activa</strong> · {clp(activa.monto)}{activa.medio_pago ? ` por ${activa.medio_pago.toLowerCase()}` : ""} · {textoVencimiento(activa.vence_en)} ({fechaHora(activa.vence_en)})</p>
          {activa.notas && <p className="text-xs text-stone-600">{activa.notas}</p>}
          {puedeEditar && (
            <div className="flex flex-wrap gap-2 mt-2">
              <button disabled={!!ocupado} onClick={() => correr("ext", () => api("reservas.extender", { id: activa.id, dias: 2 }))} className={BTN}>Extender 2 días</button>
              <button disabled={!!ocupado} onClick={() => { if (window.confirm("¿Cancelar la reserva? El vehículo volverá a estar disponible. La devolución del dinero se gestiona fuera del sistema.")) correr("can", () => api("reservas.cancelar", { id: activa.id, motivo: "Cancelada por el vendedor" })); }} className={BTN}>Cancelar reserva</button>
            </div>
          )}
        </div>
      )}

      {cotizaciones.map((c) => {
        const calc = calcularCotizacion({ precioLista: c.precio_lista, descuento: c.descuento, parteDePago: c.parte_pago, financiamiento: c.financiamiento });
        const snap = c.vehiculo_snapshot || {};
        const vencida = c.vigencia_hasta && Date.parse(c.vigencia_hasta) < Date.now();
        return (
          <div key={c.id} className={`border p-3 text-sm ${c.estado === "anulada" ? "border-stone-200 opacity-60" : "border-stone-300"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-stone-500">{folio(c.numero)}</span>
              <span className="text-stone-900">{snap.marca} {snap.modelo} {snap.anio}</span>
              <span className={`text-[11px] px-2 py-0.5 ${COLOR_COT[c.estado] || ""}`}>{cotizacionNombre(c.estado)}</span>
              {vencida && c.estado === "vigente" && <span className="text-[11px] px-2 py-0.5 bg-stone-200 text-stone-700">Vencida</span>}
              <span className="ml-auto font-mono text-stone-900">{clp(c.precio_final)}</span>
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Lista {clp(c.precio_lista)}{c.descuento > 0 ? ` · descuento ${clp(c.descuento)} (${calc.descuentoPct.toLocaleString("es-CL")}%)` : ""}
              {calc.parte > 0 ? ` · parte de pago ${clp(calc.parte)}` : ""}{calc.pie > 0 ? ` · pie ${clp(calc.pie)}` : ""}{calc.cuota > 0 ? ` · cuota ≈ ${clp(calc.cuota)}` : ""}
              {c.vigencia_hasta ? ` · válida hasta ${fechaDia(c.vigencia_hasta)}` : ""}
            </p>
            {c.estado === "pendiente" && <p className="text-xs text-amber-700 mt-1">Esperando que el Jefe Local apruebe el descuento (solicitado por {c.solicitado_por || "—"}). Aún no se puede entregar ni reservar.</p>}
            {c.estado === "rechazada" && <p className="text-xs text-rose-700 mt-1">Descuento rechazado: {c.motivo_rechazo}. Edita la cotización para proponer otro descuento.</p>}
            {c.aprobado_por && c.descuento > 0 && c.estado !== "anulada" && <p className="text-xs text-stone-500 mt-1">Descuento aprobado por {c.aprobado_por}.</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {COTIZACION_ENTREGABLE.includes(c.estado) && <button disabled={!!ocupado} onClick={() => pdf(c)} className={BTN}>{ocupado === `pdf${c.id}` ? "Generando…" : "Descargar PDF"}</button>}
              {puedeEditar && c.estado === "vigente" && !activa && !cerrado && !vencida && <button onClick={() => setReservando(c)} className={BTN_PRIMARIO}>Reservar</button>}
              {puedeEditar && ["vigente", "pendiente", "rechazada"].includes(c.estado) && <button onClick={() => setForm(c)} className={BTN}>Editar</button>}
              {puedeEditar && ["vigente", "pendiente", "rechazada"].includes(c.estado) && <button disabled={!!ocupado} onClick={() => { if (window.confirm(`¿Anular la cotización ${folio(c.numero)}?`)) correr("anu", () => api("cotizaciones.anular", { id: c.id })); }} className={BTN}>Anular</button>}
              {catalogos.puedeAsignar && c.estado === "pendiente" && (
                <>
                  <button disabled={!!ocupado} onClick={() => correr("apr", () => api("cotizaciones.aprobar", { id: c.id }))} className={BTN_AMBAR}>Aprobar descuento</button>
                  <button onClick={() => { setRechazando(c); setMotivo(""); }} className={BTN}>Rechazar…</button>
                </>
              )}
            </div>
            {rechazando && rechazando.id === c.id && (
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del rechazo" className={`${INPUT} md:w-72`} />
                <button disabled={motivo.trim().length < 3 || !!ocupado} onClick={() => correr("rec", async () => { await api("cotizaciones.rechazar", { id: c.id, motivo }); setRechazando(null); })} className={BTN_PRIMARIO}>Rechazar</button>
                <button onClick={() => setRechazando(null)} className={BTN}>Cancelar</button>
              </div>
            )}
          </div>
        );
      })}

      {form && <FormCotizacion api={api} lead={lead} cotizacion={form === "nueva" ? null : form} catalogos={catalogos} onCerrar={() => setForm(null)} onGuardado={async () => { setForm(null); await onCambio(); }} />}
      {reservando && <FormReserva api={api} cotizacion={reservando} catalogos={catalogos} onCerrar={() => setReservando(null)} onGuardado={async () => { setReservando(null); await onCambio(); }} />}
    </div>
  );
}

/* =========================================================
   BANDEJA DE APROBACIONES (supervisor)
========================================================= */
export function Aprobaciones({ api, version, abrirLead, onCambio }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("cotizaciones.pendientes"), [api, version]);
  const [rechazando, setRechazando] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState("");

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const correr = async (id, fn) => { setMsg(""); setOcupado(id); try { await fn(); await recargar(); onCambio(); } catch (e) { setMsg(mensajeError(e)); } setOcupado(""); };

  return (
    <>
      <Aviso tipo="info">Aquí llegan los descuentos que piden los ejecutivos. Mientras no los apruebes, el cliente no recibe el PDF y el vehículo no se puede reservar con ese precio.</Aviso>
      {msg && <Aviso>{msg}</Aviso>}
      {datos.pendientes.length === 0 && <Tarjeta><p className="text-sm text-stone-500">No hay descuentos esperando aprobación. 👌</p></Tarjeta>}
      {datos.pendientes.map((c) => {
        const snap = c.vehiculo_snapshot || {};
        const calc = calcularCotizacion({ precioLista: c.precio_lista, descuento: c.descuento, parteDePago: c.parte_pago, financiamiento: c.financiamiento });
        return (
          <div key={c.id} className="bg-white border border-amber-300 p-4 text-sm flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-stone-500">{folio(c.numero)}</span>
              <button onClick={() => abrirLead(c.lead_id)} className="text-stone-900 font-medium underline decoration-dotted">{c.cliente}</button>
              <span className="text-stone-600">· {snap.marca} {snap.modelo} {snap.anio} ({snap.patente})</span>
              <span className="ml-auto text-xs text-stone-500">Pide {c.ejecutivo || c.solicitado_por || "—"} · {hace(c.actualizado_en || c.creado_en)}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><p className="text-[11px] uppercase text-stone-400">Precio de lista</p><p className="font-mono">{clp(c.precio_lista)}</p></div>
              <div><p className="text-[11px] uppercase text-stone-400">Descuento</p><p className="font-mono text-amber-700">{clp(c.descuento)} ({calc.descuentoPct.toLocaleString("es-CL")}%)</p></div>
              <div><p className="text-[11px] uppercase text-stone-400">Precio final</p><p className="font-mono">{clp(c.precio_final)}</p></div>
              <div><p className="text-[11px] uppercase text-stone-400">Margen</p>
                <p className="font-mono">{c.margen_final == null ? "—" : `${clp(c.margen_final)}`}</p>
                {c.margen_lista != null && <p className="text-[11px] text-stone-500">sin descuento: {clp(c.margen_lista)}</p>}</div>
            </div>
            {(calc.parte > 0 || calc.pie > 0) && <p className="text-xs text-stone-500">{calc.parte > 0 ? `Parte de pago ${clp(calc.parte)}` : ""}{calc.parte > 0 && calc.pie > 0 ? " · " : ""}{calc.pie > 0 ? `Pie ${clp(calc.pie)}` : ""}</p>}
            {c.notas && <p className="text-xs text-stone-600">Nota: {c.notas}</p>}
            <div className="flex flex-wrap gap-2 items-center">
              <button disabled={!!ocupado} onClick={() => correr(c.id, () => api("cotizaciones.aprobar", { id: c.id }))} className={BTN_AMBAR}>Aprobar descuento</button>
              {rechazando === c.id ? (
                <>
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del rechazo" className={`${INPUT} md:w-72`} />
                  <button disabled={motivo.trim().length < 3 || !!ocupado} onClick={() => correr(c.id, async () => { await api("cotizaciones.rechazar", { id: c.id, motivo }); setRechazando(""); setMotivo(""); })} className={BTN_PRIMARIO}>Rechazar</button>
                  <button onClick={() => setRechazando("")} className={BTN}>Cancelar</button>
                </>
              ) : <button onClick={() => { setRechazando(c.id); setMotivo(""); }} className={BTN}>Rechazar…</button>}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Aviso corto de reservas para el inicio y el inventario. */
export function useReservasActivas(api, version) {
  const [lista, setLista] = useState([]);
  useEffect(() => { api("reservas.list").then((r) => setLista(r.reservas)).catch(() => setLista([])); }, [api, version]);
  return lista;
}
