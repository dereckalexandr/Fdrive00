/**
 * Piezas de interfaz compartidas por los módulos del CRM (comercial, inventario…).
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { TRANSMISIONES, COMBUSTIBLES } from "../supabase/functions/api/ventas-core.js";
import { InputDinero } from "./campo-dinero.jsx";
import { BANCOS_CHILE, TIPOS_CUENTA } from "../supabase/functions/api/validaciones-core.js";
import { camposDesdePatente, aplicarCampos, NOMBRE_CAMPO } from "./datos-patente.js";

export const INPUT = "border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full";
export const BTN = "px-3 py-1.5 text-sm font-medium border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50";
export const BTN_PRIMARIO = "px-4 py-2 text-sm font-medium bg-stone-900 text-white shadow-suave hover:bg-stone-700 disabled:opacity-50";
export const BTN_AMBAR = "px-4 py-2 text-sm bg-amber-500 text-stone-900 font-semibold shadow-suave hover:bg-amber-400 disabled:opacity-50";

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
  rut_invalido: "El RUT no es válido: revisa el número y el dígito verificador.",
  comuna_invalida: "Elige la comuna de la lista.",
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
  monto_invalido: "Revisa el monto: debe ser un número mayor a 0 y dentro del máximo permitido.",
  oferta_excede_tasacion: "La oferta no puede superar lo tasado. Si el cliente pide más, pide una nueva tasación.",
  tasacion_incompleta: "La tasación aún no está completada: espera a que el Tasador la termine.",
  tasacion_no_corresponde: "Esa tasación es de otro vehículo.",
  compra_en_curso: "Este lead ya tiene una compra en curso.",
  compra_estado_invalido: "Esa acción ya no corresponde al estado de la compra.",
  monto_excede_oferta: "Lo que se paga no puede superar lo ofertado.",
  vehiculo_ofrecido_incompleto: "Faltan datos del vehículo que ofrece el cliente: edita el lead y complétalos.",
  operacion_en_curso: "Este lead tiene una compra o consignación en curso: ciérrala o cancélala antes de darlo por perdido.",
  vehiculo_en_uso: "El vehículo ya se está usando (reservado o vendido): no se puede revertir.",
  publicacion_bajo_piso: "El precio de publicación no puede ser menor que el piso.",
  precio_invalido: "Revisa los precios: deben ser montos enteros mayores a 0.",
  plazo_invalido: "Revisa el plazo (en días).",
  consignacion_en_curso: "Este lead ya tiene una consignación en curso.",
  consignacion_estado_invalido: "Esa acción ya no corresponde al estado de la consignación.",
  bajo_precio_piso: "Ese precio queda bajo el piso que pidió el dueño del vehículo consignado.",
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
  valor_consignacion_invalido: "Escribe el precio de consignación: debe ser un monto mayor a 0.",
  valor_retoma_invalido: "Escribe el valor de retoma: debe ser un monto mayor a 0.",
  aplica_para_invalido: "Elige una opción válida: compra, consignación o no aplica.",
  aplica_para_requerido: "Indica si el vehículo aplica para compra, consignación o ninguna.",
  motivo_no_aplica_requerido: "Explica en las observaciones por qué el vehículo no aplica.",
  tasacion_no_aplica_compra: "El Tasador indicó que este vehículo no aplica para compra. Revisa el resultado de la tasación.",
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
  archivo_solo_pdf: "Este documento solo se acepta en PDF.",
  vencimiento_invalido: "Escribe una fecha de vencimiento válida.",
  precio_doc_invalido: "Escribe el precio que se pagó (puede ser 0).",
  doc_sin_datos: "Ese documento no lleva fecha de vencimiento ni precio.",
  consignacion_incompleta: "Faltan datos del dueño o documentos para registrar la consignación. Revisa la lista de requisitos.",
  compra_incompleta: "Faltan datos del vendedor o documentos para concretar la compra. Revisa la lista de requisitos de la compra.",
  nombre_apellido_requerido: "Escribe el nombre y el apellido del vendedor.",
  direccion_requerida: "Escribe la dirección del vendedor.",
  contrato_datos_incompletos: "Completa primero los datos del dueño (RUT, nombre, teléfono, correo, dirección y cuenta bancaria).",
  piso_no_aceptado: "Marca que el dueño aceptó el precio piso.",
  lead_no_editable: "La solicitud que el cliente envió por el sitio web no se puede editar.",
  lugar_requerido: "Elige dónde se hará la inspección.",
  lugar_invalido: "Ese lugar ya no está disponible. Elige otro.",
  local_sin_direccion: "Ese local no tiene dirección registrada: agrégala en Configuración → Locales o elige otra opción.",
  calle_requerida: "Escribe la calle y el número del lugar de la inspección.",
  comuna_requerida: "Escribe la comuna del lugar de la inspección.",
  banco_invalido: "Elige el banco de la lista.",
  tipo_cuenta_invalido: "Elige el tipo de cuenta de la lista.",
  numero_cuenta_invalido: "Escribe el número de cuenta: solo dígitos (entre 4 y 20).",
  rut_duplicado: "Ya hay otro cliente en este local con ese RUT.",
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
  timeout: "El servidor tardó demasiado en responder. Inténtalo de nuevo en unos segundos.",
  no_configurado: "La consulta por patente todavía no está activada. Completa los datos a mano.",
  no_encontrada: "No encontramos datos para esa patente. Completa los datos a mano.",
  cupo_agotado: "Se agotó el cupo de consultas por patente de hoy. Completa los datos a mano; mañana vuelve a funcionar.",
  demasiadas_consultas: "Hiciste muchas consultas seguidas. Espera un minuto e inténtalo de nuevo.",
  servicio_no_disponible: "El servicio de patentes no responde en este momento. Completa los datos a mano.",
  "Failed to fetch": "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
  tramos_invalidos: "Los tramos no son válidos: no pueden superponerse y solo el último puede quedar sin tope.",
};
export const mensajeError = (e) => MENSAJES[e && e.message] || `No se pudo completar la operación. Inténtalo de nuevo.${e && e.detalle ? ` (Detalle técnico: ${e.detalle})` : e && e.message ? ` (código: ${e.message}${e.status ? `, ${e.status}` : ""})` : ""}`;

export function Aviso({ tipo = "error", children }) {
  const estilos = tipo === "error" ? "bg-rose-50 border-rose-200 text-rose-800" : tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-stone-800";
  return <div className={`border px-4 py-3 text-sm rounded-xl ${estilos}`}>{children}</div>;
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
    <div className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-[2px] flex md:items-start md:justify-center md:overflow-y-auto md:py-10" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={`bg-stone-100 w-full ${ancho} md:my-auto flex flex-col max-h-screen md:max-h-none overflow-y-auto md:rounded-2xl md:shadow-elevada`}>
        <div className="bg-stone-900 text-stone-100 px-5 py-3.5 flex items-center justify-between sticky top-0 z-10">
          <h2 className="font-serif text-lg">{titulo}</h2>
          <button onClick={onCerrar} className="text-stone-300 hover:text-white hover:bg-white/10 px-2.5 py-1" aria-label="Cerrar">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/** Carga de datos con estado de espera y error. `recargar()` vuelve a pedirlos. */
export function useCarga(fn, deps) {
  const [estado, setEstado] = useState({ cargando: true, error: "", datos: null });
  const ultima = useRef(0);
  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  const recargar = useCallback(async () => {
    const mia = ++ultima.current;
    setEstado((e) => ({ ...e, cargando: true, error: "" }));
    try {
      const datos = await fn();
      // Si ya se pidió otra cosa (o la pantalla se cerró), esta respuesta se descarta.
      if (mia === ultima.current && montado.current) setEstado({ cargando: false, error: "", datos });
    } catch (e) {
      if (mia === ultima.current && montado.current) setEstado((p) => ({ cargando: false, error: mensajeError(e), datos: p.datos }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recargar(); }, [recargar]);
  return { ...estado, recargar };
}

/** Estado que sobrevive a recargar la página (sessionStorage: se borra al cerrar la pestaña). `validos` descarta valores que ya no existen. */
export function useGuardado(clave, inicial, validos) {
  const k = "df-tab-" + clave;
  const [valor, setValor] = useState(() => {
    try { const g = sessionStorage.getItem(k); if (g && (!validos || validos.includes(g))) return g; } catch (e) { /* sin almacenamiento */ }
    return inicial;
  });
  const poner = useCallback((v) => { setValor(v); try { sessionStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }, [k]);
  return [valor, poner];
}

/** Pestañas horizontales con el estilo del panel. */
export function Pestanas({ valor, onCambio, opciones }) {
  return (
    <div className="pestanas-scroll flex gap-1 overflow-x-auto whitespace-nowrap p-1 bg-white border border-stone-200 rounded-xl shadow-suave">
      {opciones.map(([id, texto, extra]) => (
        <button key={id} onClick={() => onCambio(id)} aria-current={valor === id ? "page" : undefined}
          className={`px-3.5 py-2 text-sm rounded-lg shrink-0 ${valor === id ? "bg-stone-900 text-white font-medium shadow-suave" : "text-stone-600 hover:text-stone-900 hover:bg-stone-100"}`}>
          {texto}{extra ? <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${valor === id ? "bg-amber-400 text-stone-900" : "bg-amber-100 text-amber-800"}`}>{extra}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Menú lateral agrupado (pantallas anchas). `grupos`: [{ titulo, ids }] ordenados; las opciones que no estén en ningún grupo van al final. */
export function NavegacionLateral({ valor, onCambio, opciones, grupos }) {
  const porId = Object.fromEntries(opciones.map((o) => [o[0], o]));
  const usados = new Set();
  const bloques = grupos.map((g) => ({ titulo: g.titulo, items: g.ids.filter((id) => porId[id]).map((id) => { usados.add(id); return porId[id]; }) })).filter((b) => b.items.length);
  const sueltas = opciones.filter((o) => !usados.has(o[0]));
  if (sueltas.length) bloques.push({ titulo: "Otros", items: sueltas });
  return (
    <nav className="bg-white border border-stone-200 rounded-2xl shadow-suave p-2 flex flex-col gap-3" aria-label="Secciones">
      {bloques.map((b) => (
        <div key={b.titulo}>
          <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{b.titulo}</p>
          {b.items.map(([id, texto, extra]) => (
            <button key={id} onClick={() => onCambio(id)} aria-current={valor === id ? "page" : undefined}
              className={`w-full text-left flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg ${valor === id ? "bg-stone-900 text-white font-medium shadow-suave" : "text-stone-600 hover:text-stone-900 hover:bg-stone-100"}`}>
              <span className="truncate">{texto}</span>
              {extra ? <span className={`text-xs px-1.5 py-0.5 rounded-full ${valor === id ? "bg-amber-400 text-stone-900" : "bg-amber-100 text-amber-800"}`}>{extra}</span> : null}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/* --- Datos de un vehículo (tasaciones e inspecciones) --- */
/** ¿La patente tiene el formato chileno (4 letras + 2 dígitos, o 2 letras + 4 dígitos)? */
export const patenteConFormato = (p) => /^([A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)) && String(p || "").replace(/[^A-Za-z0-9]/g, "").length === 6;

/**
 * Botón «Buscar datos» junto a una patente: pide al servidor marca, modelo y año y los entrega a `onDatos(campos)`.
 * `api` es la función del módulo (por defecto la misma de todo el CRM). Siempre quedan editables: se pide revisarlos.
 */
export function BuscarPatente({ patente, onDatos, api = apiPorDefecto, className = "" }) {
  const [estado, setEstado] = useState({ buscando: false, msg: null });
  const ok = patenteConFormato(patente);
  const buscar = async () => {
    setEstado({ buscando: true, msg: null });
    try {
      const r = await api("vehiculos.patente", { patente: String(patente).toUpperCase().replace(/[^A-Z0-9]/g, "") });
      const llenados = onDatos(camposDesdePatente(r.vehiculo)) || [];
      setEstado({ buscando: false, msg: { ok: true, texto: llenados.length ? `Se completaron: ${llenados.map((k) => NOMBRE_CAMPO[k] || k).join(", ")}. Revísalos antes de seguir.` : "Los datos de la patente coinciden con lo que ya escribiste." } });
    } catch (e) { setEstado({ buscando: false, msg: { ok: false, texto: mensajeError(e) } }); }
  };
  return (
    <div className={className}>
      <button type="button" onClick={buscar} disabled={!ok || estado.buscando} title={ok ? "Completa marca, modelo y año con los datos de la patente" : "Escribe una patente válida"} className={BTN}>{estado.buscando ? "Buscando…" : "Buscar datos"}</button>
      {estado.msg && <p className={`text-xs mt-1 ${estado.msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{estado.msg.texto}</p>}
    </div>
  );
}

export const VEH_VACIO = { patente: "", marca: "", modelo: "", version: "", anio: "", km: "", color: "", transmision: "", combustible: "" };

export function CamposVehiculo({ v, set, bloqueado = false }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div>
        <Campo etiqueta="Patente"><input value={v.patente} disabled={bloqueado} onChange={(e) => set({ ...v, patente: e.target.value.toUpperCase() })} className={`${INPUT} font-mono`} placeholder="ABCD12" /></Campo>
        {!bloqueado && <BuscarPatente patente={v.patente} className="mt-1.5" onDatos={(campos) => { const r = aplicarCampos(v, campos, { pisar: true }); set(r.valores); return r.llenados; }} />}
      </div>
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

/** Cuenta bancaria: banco y tipo de cuenta en listas, y el número en una caja. `v` = { banco, tipoCuenta, numeroCuenta }. */
export function CuentaBancaria({ v, set, disabled = false, faltan = {} }) {
  const marca = (k) => (faltan[k] ? "border-amber-500" : "");
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Campo etiqueta="Banco *">
        <select value={v.banco || ""} disabled={disabled} onChange={(e) => set({ ...v, banco: e.target.value })} className={`${INPUT} ${marca("banco")}`}>
          <option value="">Elige el banco…</option>
          {BANCOS_CHILE.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Tipo de cuenta *">
        <select value={v.tipoCuenta || ""} disabled={disabled} onChange={(e) => set({ ...v, tipoCuenta: e.target.value })} className={`${INPUT} ${marca("tipo_cuenta")}`}>
          <option value="">Elige el tipo…</option>
          {TIPOS_CUENTA.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Número de cuenta *" ayuda="Solo números, sin puntos ni guiones.">
        <input inputMode="numeric" value={v.numeroCuenta || ""} disabled={disabled} maxLength={24} placeholder="Ej. 123456789" onChange={(e) => set({ ...v, numeroCuenta: e.target.value.replace(/[^\d\s.-]/g, "") })} className={`${INPUT} font-mono ${marca("numero_cuenta")}`} />
      </Campo>
    </div>
  );
}

/** Lo que declara el dueño de un vehículo que quiere vendernos o consignar: dueños, prenda, mantenciones en la marca y precio esperado. */
export function DatosDelDueno({ o }) {
  if (!o || (o.duenos == null && !o.prenda && !o.mantenciones && o.precioEsperado == null)) return null;
  const sn = (v) => (v === "si" ? "Sí" : v === "no" ? "No" : "—");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border border-stone-200 bg-stone-50 p-3 text-sm">
      <div><p className="text-[11px] uppercase tracking-wide text-stone-400">Dueños</p><p className="text-stone-900">{o.duenos ?? "—"}</p></div>
      <div><p className="text-[11px] uppercase tracking-wide text-stone-400">Con prenda</p><p className={o.prenda === "si" ? "text-rose-700 font-medium" : "text-stone-900"}>{sn(o.prenda)}</p></div>
      <div><p className="text-[11px] uppercase tracking-wide text-stone-400">Mantenciones en la marca</p><p className="text-stone-900">{sn(o.mantenciones)}</p></div>
      <div><p className="text-[11px] uppercase tracking-wide text-stone-400">Precio esperado</p><p className="font-mono text-stone-900">{o.precioEsperado != null ? clp(o.precioEsperado) : "—"}</p></div>
    </div>
  );
}

/** Los mismos datos para editarlos en el lead (opcionales: el sitio web los pide siempre; aquí el ejecutivo los puede completar). */
export function CamposCondiciones({ v, set }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
      <Campo etiqueta="Número de dueños"><input type="number" min="1" max="30" value={v.duenos ?? ""} onChange={(e) => set({ ...v, duenos: e.target.value })} className={INPUT} /></Campo>
      <Campo etiqueta="¿Tiene prenda?"><select value={v.prenda || ""} onChange={(e) => set({ ...v, prenda: e.target.value })} className={INPUT}><option value="">—</option><option value="si">Sí</option><option value="no">No</option></select></Campo>
      <Campo etiqueta="¿Mantenciones en la marca?"><select value={v.mantenciones || ""} onChange={(e) => set({ ...v, mantenciones: e.target.value })} className={INPUT}><option value="">—</option><option value="si">Sí</option><option value="no">No</option></select></Campo>
      <Campo etiqueta="Precio esperado ($)"><InputDinero value={v.precioEsperado ?? ""} onChange={(e) => set({ ...v, precioEsperado: e.target.value })} className={`${INPUT} font-mono`} /></Campo>
    </div>
  );
}

export const aVehiculoForm = (v) => ({ ...VEH_VACIO, ...(v || {}), anio: v && v.anio != null ? v.anio : "", km: v && v.km != null ? v.km : "" });


/**
 * Función por defecto para hablar con el servidor. Debe ser SIEMPRE la misma función (no una nueva en cada dibujo):
 * si cambiara cada vez, las pantallas que la usan como dependencia volverían a pedir sus datos sin parar y el sitio se congelaría.
 */
export const apiPorDefecto = (op, params) => window.auth.ventas(op, params);
