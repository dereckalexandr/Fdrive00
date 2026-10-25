// Vista «Lista» de leads: arma una fila por lead, la filtra, la ordena y la exporta a CSV. Funciones puras (se prueban sin servidor).
import { etapaDeOperacion, tipoLeadNombre } from "./compras-core.js";
import { diasEnEtapa, etapaNombre, ETAPAS_CERRADAS } from "./ventas-core.js";

/** Una fila plana por lead, con todo lo que la lista muestra, filtra y exporta. */
export function armarFilaLead({ lead, cliente, vehiculo, asignado, proxima }, ahora = new Date()) {
  const tipo = lead.tipo || "venta";
  const ofr = lead.vehiculo_ofrecido || {};
  const vehiculoTexto = tipo === "venta"
    ? (vehiculo ? `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}` : lead.vehiculo_interes || "")
    : (ofr.marca ? `${ofr.marca} ${ofr.modelo || ""} ${ofr.anio || ""}`.trim() : "");
  const monto = tipo === "venta" ? Number(vehiculo && vehiculo.precio_lista) || 0 : Number(ofr.precioEsperado) || 0;
  const abierto = !ETAPAS_CERRADAS.includes(lead.etapa);
  const vencida = !!(proxima && Date.parse(proxima.vence_en) < ahora.getTime());
  return {
    id: lead.id, tipo, tipoNombre: tipoLeadNombre(tipo), etapa: lead.etapa, etapaNombre: etapaDeOperacion(tipo, lead.etapa, etapaNombre(lead.etapa)),
    cliente: (cliente && cliente.nombre) || "", telefono: (cliente && cliente.telefono) || "", email: (cliente && cliente.email) || "",
    vehiculo: vehiculoTexto, monto, fuente: lead.fuente || "", asignadoId: lead.asignado_a || "", asignado: (asignado && asignado.nombre) || "",
    motivoPerdida: lead.motivo_perdida || "", creado: lead.creado_en || "", dias: abierto ? diasEnEtapa(lead, ahora) : 0, abierto,
    proxima: proxima ? proxima.titulo : "", proximaFecha: proxima ? proxima.vence_en : "", proximaVencida: vencida,
    sinProxima: abierto && !proxima, porAtender: lead.etapa === "nuevo" && !lead.ultimo_contacto,
    vehiculoId: vehiculo ? vehiculo.id : "", foto: vehiculo && vehiculo.fotos ? vehiculo.fotos[0] || "" : "",
  };
}

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtros: texto (cliente, teléfono, vehículo, fuente), tipo, etapa, asignado ("sin" = sin asignar), fuente y «atención» (abiertos|porAtender|sinProxima|vencida|detenido|perdidos). */
export function filtrarFilas(filas, f = {}) {
  const q = sinTildes(f.texto).trim();
  const dig = String(f.texto || "").replace(/\D/g, "");
  return filas.filter((r) => {
    // Los leads perdidos quedan guardados pero no ensucian la lista: solo se ven al pedirlos expresamente.
    if (f.atencion === "perdidos" ? r.etapa !== "perdido" : r.etapa === "perdido") return false;
    if (f.tipo && r.tipo !== f.tipo) return false;
    if (f.etapa && r.etapa !== f.etapa) return false;
    if (f.asignado === "sin" ? r.asignadoId : (f.asignado && r.asignadoId !== f.asignado)) return false;
    if (f.fuente && r.fuente !== f.fuente) return false;
    if (f.atencion === "abiertos" && !r.abierto) return false;
    if (f.atencion === "porAtender" && !r.porAtender) return false;
    if (f.atencion === "sinProxima" && !r.sinProxima) return false;
    if (f.atencion === "vencida" && !r.proximaVencida) return false;
    if (f.atencion === "detenido" && !(r.abierto && r.dias >= 7)) return false;
    if (q) {
      const pajar = sinTildes(`${r.cliente} ${r.vehiculo} ${r.fuente} ${r.asignado} ${r.email}`);
      if (!pajar.includes(q) && !(dig.length >= 3 && r.telefono.replace(/\D/g, "").includes(dig))) return false;
    }
    return true;
  });
}

export const ORDENES_LISTA = [
  { id: "recientes", nombre: "Más recientes" },
  { id: "antiguos", nombre: "Más antiguos" },
  { id: "detenidos", nombre: "Más días en la etapa" },
  { id: "monto", nombre: "Mayor monto" },
  { id: "cliente", nombre: "Cliente (A-Z)" },
];

export function ordenarFilas(filas, orden = "recientes") {
  const c = [...filas];
  const porFecha = (a, b) => Date.parse(b.creado || 0) - Date.parse(a.creado || 0);
  if (orden === "antiguos") c.sort((a, b) => -porFecha(a, b));
  else if (orden === "detenidos") c.sort((a, b) => (b.dias - a.dias) || porFecha(a, b));
  else if (orden === "monto") c.sort((a, b) => (b.monto - a.monto) || porFecha(a, b));
  else if (orden === "cliente") c.sort((a, b) => a.cliente.localeCompare(b.cliente, "es"));
  else c.sort(porFecha);
  return c;
}

const COLUMNAS_CSV = [
  ["Cliente", (r) => r.cliente], ["Teléfono", (r) => r.telefono], ["Correo", (r) => r.email], ["Tipo", (r) => r.tipoNombre], ["Etapa", (r) => r.etapaNombre],
  ["Vehículo", (r) => r.vehiculo], ["Monto", (r) => r.monto || ""], ["Fuente", (r) => r.fuente], ["Ejecutivo", (r) => r.asignado || "Sin asignar"],
  ["Días en la etapa", (r) => (r.abierto ? r.dias : "")], ["Próxima acción", (r) => r.proxima], ["Fecha próxima acción", (r) => r.proximaFecha], ["Creado", (r) => r.creado],
];

/** Celda segura para Excel: comillas dobles y sin fórmulas (= + - @ al inicio se neutralizan). */
export function celdaCsv(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con «;» (el separador de Excel en español) y saltos CRLF. */
export function filasACsv(filas) {
  const lineas = [COLUMNAS_CSV.map(([t]) => t).join(";")];
  for (const r of filas) lineas.push(COLUMNAS_CSV.map(([, f]) => celdaCsv(f(r))).join(";"));
  return lineas.join("\r\n");
}
