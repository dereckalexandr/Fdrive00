/**
 * Piezas de interfaz compartidas por los módulos del CRM (comercial, inventario…).
 */
import React, { useState, useEffect, useCallback } from "react";
import { TRANSMISIONES, COMBUSTIBLES } from "../supabase/functions/api/ventas-core.js";

export const INPUT = "border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full";
export const BTN = "px-3 py-1.5 text-sm border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50";
export const BTN_PRIMARIO = "px-4 py-2 text-sm bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50";
export const BTN_AMBAR = "px-4 py-2 text-sm bg-amber-500 text-stone-900 font-medium hover:bg-amber-400 disabled:opacity-50";

export const clp = (n) => (n === null || n === undefined || n === "" || Number.isNaN(Number(n)) ? "—" : `$${Math.round(Number(n)).toLocaleString("es-CL")}`);
export const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—");
export const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "—");

/** "hace 3 h", "hace 2 d"… */
export function hace(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "recién";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

const MENSAJES = {
  crm_not_installed: "Faltan las tablas del módulo comercial. Ejecuta supabase-crm-ventas.sql en Supabase (SQL Editor) y recarga.",
  server_not_configured: "Este módulo necesita Supabase configurado: no está disponible en modo de prueba local.",
  forbidden: "No tienes permiso para esa operación.",
  unauthorized: "Tu sesión venció. Recarga la página para volver a ingresar.",
  no_existe: "Ese registro ya no existe o no tienes acceso a él.",
  sin_local: "Falta definir en qué local trabajas. Pídele al administrador que te asigne uno.",
  patente_invalida: "La patente no es válida (formato ABCD12 o AB1234).",
  patente_duplicada: "Ya hay un vehículo activo con esa patente.",
  marca_modelo_requeridos: "Escribe la marca y el modelo.",
  anio_invalido: "El año no es válido.",
  km_invalido: "El kilometraje no es válido.",
  precio_invalido: "Revisa los precios: deben ser números.",
  nombre_invalido: "Escribe el nombre completo.",
  rut_invalido: "El RUT no es válido.",
  telefono_invalido: "El teléfono debe tener al menos 8 dígitos.",
  email_invalido: "El correo no es válido.",
  contacto_requerido: "Ingresa al menos un teléfono o un correo.",
  parte_pago_invalida: "Revisa los datos del vehículo en parte de pago.",
  financiamiento_invalido: "Revisa los datos de financiamiento.",
  vehiculo_invalido: "Ese vehículo no pertenece a este local.",
  cliente_invalido: "Ese cliente no pertenece a este local.",
  asignado_invalido: "Esa persona no puede recibir leads de venta (revisa que esté activa y habilitada).",
  sin_candidatos: "No hay otra persona habilitada para recibir este lead.",
  etapa_no_disponible: "Esa etapa todavía no está disponible.",
  motivo_requerido: "Elige el motivo por el que se pierde.",
  lead_cerrado: "Este lead está cerrado: solo el supervisor puede reabrirlo.",
  sin_cambio: "El lead ya está en esa etapa.",
  detalle_requerido: "Escribe la nota.",
  titulo_invalido: "Escribe qué hay que hacer (mínimo 3 letras).",
  fecha_invalida: "Elige una fecha y hora válidas.",
  duplicado: "Ya existe un registro con esos datos.",
  vehiculo_sin_precio: "Ese vehículo no tiene precio de lista. Pídele a quien edita el inventario que lo cargue.",
  descuento_invalido: "El descuento no es válido: debe ser un monto entre 0 y el precio de lista.",
  pago_excede_precio: "La parte de pago más el pie superan el precio final.",
  vehiculo_no_disponible: "Ese vehículo ya no está disponible (puede que otra persona lo haya reservado).",
  cotizacion_pendiente: "El descuento aún no está aprobado por el Jefe Local.",
  cotizacion_no_vigente: "Esa cotización no está vigente (rechazada o anulada).",
  cotizacion_vencida: "La cotización venció. Edítala para renovarla y vuelve a intentar.",
  cotizacion_cerrada: "Esa cotización ya está cerrada y no se puede modificar.",
  ya_reservada: "Esa cotización ya tiene una reserva.",
  tiene_reserva: "Primero cancela la reserva de esa cotización.",
  reserva_activa: "El lead tiene una reserva activa: cancélala primero, o márcalo como perdido.",
  reserva_cerrada: "Esa reserva ya está cerrada.",
  etapa_automatica: "Esa etapa cambia sola: cotiza o reserva desde la ficha del lead.",
  estado_automatico: "El estado «Reservado» lo pone el sistema al reservar; no se asigna a mano.",
  vehiculo_reservado: "El vehículo tiene una reserva activa. Cancélala primero.",
  monto_invalido: "Revisa el monto: debe ser mayor a 0 y no superar el precio final.",
  dias_invalidos: "Los días no son válidos.",
  medio_invalido: "Elige un medio de pago de la lista.",
  lead_no_reservado: "Para cerrar la venta, el lead debe estar en «Reservado».",
  lead_sin_asignar: "Este lead no tiene ejecutivo asignado: asígnalo antes de cerrar la venta.",
  sin_reserva: "Para cerrar la venta, el vehículo debe tener una reserva activa.",
  cierre_en_curso: "Ese vehículo ya tiene un cierre de venta en curso o aprobado.",
  reserva_no_vigente: "La reserva ya no está vigente, por lo que no se puede aprobar este cierre.",
  venta_cerrada: "Esta venta está cerrada. Para revertirla, el supervisor debe anular el cierre.",
  vehiculo_vendido: "El vehículo tiene una venta aprobada. El supervisor debe anular el cierre para liberarlo.",
  precio_cierre_invalido: "Revisa el precio final de venta: debe ser un monto mayor a 0.",
  pagos_invalidos: "Revisa los montos de parte de pago y financiamiento.",
  pagos_exceden_precio: "La parte de pago más el monto financiado superan el precio final.",
  financiera_requerida: "Elige la financiera del crédito.",
  comision_invalida: "Revisa la comisión de la financiera.",
  fecha_entrega_invalida: "Elige una fecha de entrega válida.",
  mes_invalido: "El mes no es válido.",
  tasacion_en_curso: "Este lead ya tiene una tasación en curso. Espera a que se complete o cancélala.",
  tasacion_ya_tomada: "Otro Tasador ya tomó esa tasación.",
  tasacion_estado_invalido: "Esa acción ya no corresponde al estado actual de la tasación.",
  valor_compra_invalido: "Escribe el valor de compra: debe ser un monto mayor a 0.",
  valor_venta_invalido: "Escribe el valor de venta esperado: debe ser un monto mayor a 0.",
  valor_venta_menor: "El valor de venta esperado no puede ser menor que el de compra.",
  parte_pago_excede_tasacion: "El valor del vehículo en parte de pago no puede superar lo tasado. Para subirlo, pide una nueva tasación.",
  vista_invalida: "No se pudo mostrar esa lista.",
  aviso_invalido: "El aviso debe tener entre 3 y 300 caracteres.",
  destinatario_requerido: "Elige a quién va dirigido el aviso.",
  lote_invalido: "Selecciona entre 1 y 50 leads.",
  direccion_requerida: "Escribe la dirección donde está el vehículo (mínimo 5 letras).",
  origen_invalido: "No se pudo identificar de dónde nace la inspección.",
  inspeccion_en_curso: "Ese vehículo (patente) ya tiene una inspección pedida o agendada.",
  inspeccion_ya_tomada: "Otro Inspector ya tomó esa inspección.",
  inspeccion_estado_invalido: "Esa acción ya no corresponde al estado actual de la inspección.",
  inspeccion_invalida: "La ficha de la inspección no es válida.",
  estado_doc_invalido: "Elige qué hacer con el documento: aprobar, observar, rechazar o marcar que no aplica.",
  comentario_requerido: "Escribe el motivo (mínimo 3 letras).",
  archivo_invalido: "No se pudo registrar el archivo. Inténtalo de nuevo.",
  archivo_tipo_invalido: "Solo se aceptan fotos (JPG, PNG) o archivos PDF.",
  archivo_muy_grande: "El archivo es demasiado grande (máximo 4 MB). Reduce el PDF o sube una foto.",
  demasiados_archivos: "Cada documento admite hasta 3 archivos.",
  doc_cerrado: "Ese documento ya está aprobado: no se modifica.",
  doc_sin_archivo: "Para aprobar un documento debe tener al menos un archivo adjunto.",
  archivo_reutilizado: "Ese archivo viene de otra validación ya aprobada y no se puede quitar aquí.",
  validacion_estado_invalido: "Esa acción ya no corresponde al estado de la validación.",
  validacion_ya_tomada: "Otro Validador ya tomó esa validación.",
  validacion_pendiente: "Los documentos de esta venta aún no están validados. Un Validador debe aprobarlos antes de aprobar la venta.",
  titulo_aviso_invalido: "El título del aviso debe tener al menos 5 letras.",
  descripcion_invalida: "La descripción del aviso debe tener al menos 10 letras.",
  portal_invalido: "Ese portal no es válido.",
  estado_portal_invalido: "Ese estado no es válido para el portal.",
  url_invalida: "El enlace del aviso debe empezar con https:// y ser válido.",
  aviso_existente: "Ese vehículo ya tiene un aviso activo.",
  aviso_baja: "Ese aviso ya está dado de baja.",
  vehiculo_sin_validar: "Los documentos de este vehículo aún no están aprobados por un Validador.",
  nombre_campania_invalido: "El nombre de la campaña debe tener al menos 3 letras.",
  canal_invalido: "Elige un canal de la lista.",
  fechas_invertidas: "La fecha de término no puede ser anterior a la de inicio.",
  presupuesto_invalido: "El presupuesto debe ser un monto entero (0 si no tiene costo).",
  presupuesto_menor_que_gasto: "El presupuesto no puede ser menor que lo que ya se gastó.",
  gasto_invalido: "Revisa el gasto: debe ser un monto entero.",
  gasto_excede_presupuesto: "El gasto no puede superar el presupuesto aprobado. Para gastar más, sube el presupuesto y pide la aprobación del Jefe Local.",
  resultado_invalido: "Revisa los resultados: deben ser números enteros.",
  campania_estado_invalido: "Esa acción no corresponde al estado actual de la campaña.",
  campania_invalida: "Esa campaña no existe, no es de este local o aún no está aprobada.",
  titulo_publicacion_invalido: "El título de la publicación debe tener al menos 3 letras.",
  tipo_publicacion_invalido: "Elige un formato de la lista.",
  estado_publicacion_invalido: "Ese estado de publicación no es válido.",
  fecha_requerida: "Una publicación programada o publicada necesita fecha y hora.",
  publicacion_no_eliminable: "Solo se eliminan las ideas y las publicaciones canceladas.",
  tipo_material_invalido: "Elige el tipo de material.",
  estado_material_invalido: "Ese estado de material no es válido.",
  tramos_invalidos: "Los tramos no son válidos: no pueden superponerse y solo el último puede quedar sin tope.",
};
export const mensajeError = (e) => MENSAJES[e && e.message] || `No se pudo completar la operación. Inténtalo de nuevo.${e && e.detalle ? ` (Detalle técnico: ${e.detalle})` : e && e.message ? ` (código: ${e.message}${e.status ? `, ${e.status}` : ""})` : ""}`;

export function Aviso({ tipo = "error", children }) {
  const estilos = tipo === "error" ? "bg-rose-50 border-rose-200 text-rose-800" : tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-stone-800";
  return <div className={`border px-4 py-3 text-sm ${estilos}`}>{children}</div>;
}
export const Cargando = ({ texto = "Cargando…" }) => <p className="text-sm text-stone-500">{texto}</p>;

export function Tarjeta({ titulo, ayuda, children, derecha }) {
  return (
    <div className="bg-white border border-stone-200 p-5">
      {(titulo || derecha) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            {titulo && <h3 className="font-serif text-lg text-stone-900">{titulo}</h3>}
            {ayuda && <p className="text-xs text-stone-500 mt-1">{ayuda}</p>}
          </div>
          {derecha}
        </div>
      )}
      {children}
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda, className = "" }) {
  return (
    <label className={`text-sm text-stone-700 flex flex-col gap-1 ${className}`}>
      {etiqueta}
      {children}
      {ayuda && <span className="text-xs text-stone-500">{ayuda}</span>}
    </label>
  );
}

/** Ventana superpuesta; en celular ocupa toda la pantalla. */
export function Modal({ titulo, onCerrar, children, ancho = "max-w-2xl" }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-40 bg-stone-900/50 flex md:items-start md:justify-center md:overflow-y-auto md:py-10" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={`bg-stone-100 w-full ${ancho} md:my-auto flex flex-col max-h-screen md:max-h-none overflow-y-auto`}>
        <div className="bg-stone-900 text-stone-100 px-5 py-3 flex items-center justify-between sticky top-0 z-10">
          <h2 className="font-serif text-lg">{titulo}</h2>
          <button onClick={onCerrar} className="text-stone-300 hover:text-white px-2 py-1" aria-label="Cerrar">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/** Carga de datos con estado de espera y error. `recargar()` vuelve a pedirlos. */
export function useCarga(fn, deps) {
  const [estado, setEstado] = useState({ cargando: true, error: "", datos: null });
  const recargar = useCallback(async () => {
    setEstado((e) => ({ ...e, cargando: true, error: "" }));
    try { setEstado({ cargando: false, error: "", datos: await fn() }); }
    catch (e) { setEstado((p) => ({ cargando: false, error: mensajeError(e), datos: p.datos })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recargar(); }, [recargar]);
  return { ...estado, recargar };
}

/** Pestañas horizontales con el estilo del panel. */
export function Pestanas({ valor, onCambio, opciones }) {
  return (
    <div className="flex gap-1 border-b border-stone-300 overflow-x-auto whitespace-nowrap">
      {opciones.map(([id, texto, extra]) => (
        <button key={id} onClick={() => onCambio(id)} className={`px-4 py-2.5 text-sm ${valor === id ? "text-stone-900 border-b-2 border-amber-500 font-medium" : "text-stone-500 hover:text-stone-800"}`}>
          {texto}{extra ? <span className="ml-1.5 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">{extra}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* --- Datos de un vehículo (tasaciones e inspecciones) --- */
export const VEH_VACIO = { patente: "", marca: "", modelo: "", version: "", anio: "", km: "", color: "", transmision: "", combustible: "" };

export function CamposVehiculo({ v, set, bloqueado = false }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Campo etiqueta="Patente"><input value={v.patente} disabled={bloqueado} onChange={(e) => set({ ...v, patente: e.target.value.toUpperCase() })} className={`${INPUT} font-mono`} placeholder="ABCD12" /></Campo>
      <Campo etiqueta="Marca"><input value={v.marca} disabled={bloqueado} onChange={(e) => set({ ...v, marca: e.target.value })} className={INPUT} /></Campo>
      <Campo etiqueta="Modelo"><input value={v.modelo} disabled={bloqueado} onChange={(e) => set({ ...v, modelo: e.target.value })} className={INPUT} /></Campo>
      <Campo etiqueta="Versión (opcional)"><input value={v.version || ""} disabled={bloqueado} onChange={(e) => set({ ...v, version: e.target.value })} className={INPUT} /></Campo>
      <Campo etiqueta="Año"><input type="number" value={v.anio} disabled={bloqueado} onChange={(e) => set({ ...v, anio: e.target.value })} className={INPUT} /></Campo>
      <Campo etiqueta="Kilometraje"><input type="number" min="0" value={v.km} disabled={bloqueado} onChange={(e) => set({ ...v, km: e.target.value })} className={INPUT} /></Campo>
      <Campo etiqueta="Color (opcional)"><input value={v.color || ""} disabled={bloqueado} onChange={(e) => set({ ...v, color: e.target.value })} className={INPUT} /></Campo>
      <Campo etiqueta="Transmisión">
        <select value={v.transmision || ""} disabled={bloqueado} onChange={(e) => set({ ...v, transmision: e.target.value })} className={INPUT}><option value="">—</option>{TRANSMISIONES.map((t) => <option key={t}>{t}</option>)}</select>
      </Campo>
      <Campo etiqueta="Combustible">
        <select value={v.combustible || ""} disabled={bloqueado} onChange={(e) => set({ ...v, combustible: e.target.value })} className={INPUT}><option value="">—</option>{COMBUSTIBLES.map((t) => <option key={t}>{t}</option>)}</select>
      </Campo>
    </div>
  );
}

export const aVehiculoForm = (v) => ({ ...VEH_VACIO, ...(v || {}), anio: v && v.anio != null ? v.anio : "", km: v && v.km != null ? v.km : "" });

