// Catálogo de autos para anuncios de Meta: el inventario disponible como archivo (CSV) que Meta lee solo desde una dirección.
// Dos formatos: «vehículos» (catálogo de vehículos de Meta, para anuncios de inventario automotriz) y «productos» (catálogo general,
// para anuncios de catálogo Advantage+; sirve en cualquier país). Reglas puras: sin base ni red.
// Google no ofrece anuncios de vehículos en Chile: no hay catálogo para Google.

export const FORMATOS_CATALOGO = [
  { id: "meta-vehiculos", nombre: "Meta · catálogo de vehículos" },
  { id: "meta-productos", nombre: "Meta · catálogo de productos (Advantage+)" },
];
export const MAX_FOTOS_CATALOGO = 10;

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const texto = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const miles = (n) => Math.round(Number(n) || 0).toLocaleString("es-CL");

/** ¿El auto puede ir al catálogo? Solo los disponibles, con precio, foto y datos básicos. Devuelve el motivo si no. */
export function revisarParaCatalogo(v) {
  if (!v || v.activo === false) return { ok: false, motivo: "Archivado" };
  if (v.estado !== "disponible") return { ok: false, motivo: v.estado === "reservado" ? "Reservado" : v.estado === "vendido" ? "Vendido" : "En preparación" };
  if (!(Number(v.precio_lista) > 0)) return { ok: false, motivo: "Sin precio de lista" };
  if (!Array.isArray(v.fotos) || v.fotos.length === 0) return { ok: false, motivo: "Sin fotos" };
  if (!v.marca || !v.modelo || !v.anio) return { ok: false, motivo: "Faltan marca, modelo o año" };
  return { ok: true };
}

export function transmisionMeta(t) {
  const x = sinTildes(t);
  return /auto|cvt|dct/.test(x) ? "AUTOMATIC" : /manual|mec/.test(x) ? "MANUAL" : "OTHER";
}
export function combustibleMeta(c) {
  const x = sinTildes(c);
  if (/hibrid|hybrid/.test(x)) return "HYBRID";
  if (/electr/.test(x)) return "ELECTRIC";
  if (/diesel|petroleo/.test(x)) return "DIESEL";
  if (/bencina|gasolina|nafta/.test(x)) return "GASOLINE";
  return "OTHER";
}

/** Título y descripción del auto: los del aviso publicado si existe; si no, armados con sus datos. */
export function textosVehiculo(v, aviso) {
  const titulo = texto((aviso && aviso.titulo) || [v.marca, v.modelo, v.version, v.anio].filter(Boolean).join(" "), 150);
  const detalle = [`${v.marca} ${v.modelo}${v.version ? ` ${v.version}` : ""} ${v.anio}`, v.km != null ? `${miles(v.km)} km` : "", v.transmision, v.combustible, v.color].filter(Boolean).join(" · ");
  const descripcion = texto((aviso && aviso.descripcion) || `${detalle}. Revisado e inspeccionado. Financiamiento y parte de pago.`, 5000);
  return { titulo, descripcion };
}

/** Una fila del catálogo de vehículos de Meta. */
export function filaVehiculoMeta(v, { urlSitio, urlFoto, aviso, empresa = {} }) {
  const { titulo, descripcion } = textosVehiculo(v, aviso);
  const fila = {
    vehicle_id: v.id, title: titulo, description: descripcion, url: `${urlSitio}/vehiculo/${v.id}`,
    make: texto(v.marca, 60), model: texto(v.modelo, 60), year: String(v.anio), trim: texto(v.version, 60),
    "mileage.value": String(Math.max(0, Math.round(Number(v.km) || 0))), "mileage.unit": "KM",
    price: `${Math.round(Number(v.precio_lista))} CLP`, state_of_vehicle: "USED", condition: "GOOD", availability: "AVAILABLE",
    body_style: "OTHER", transmission: transmisionMeta(v.transmision), fuel_type: combustibleMeta(v.combustible), exterior_color: texto(v.color, 40),
    "address.addr1": texto(empresa.domicilio, 100), "address.city": texto(empresa.comuna || empresa.ciudad, 60), "address.region": texto(empresa.region, 60), "address.country": "CL",
    dealer_name: texto(empresa.razon_social, 100),
  };
  (v.fotos || []).slice(0, MAX_FOTOS_CATALOGO).forEach((f, i) => { fila[`image[${i}].url`] = urlFoto(v.id, f); });
  return fila;
}

/** Una fila del catálogo general de productos de Meta (Advantage+). */
export function filaProductoMeta(v, { urlSitio, urlFoto, aviso }) {
  const { titulo, descripcion } = textosVehiculo(v, aviso);
  const fotos = (v.fotos || []).slice(0, MAX_FOTOS_CATALOGO).map((f) => urlFoto(v.id, f));
  return {
    id: v.id, title: titulo, description: descripcion, availability: "in stock", condition: "used", price: `${Math.round(Number(v.precio_lista))} CLP`,
    link: `${urlSitio}/vehiculo/${v.id}`, image_link: fotos[0] || "", additional_image_link: fotos.slice(1).join(","), brand: texto(v.marca, 60),
    custom_label_0: String(v.anio), custom_label_1: v.km != null ? `${miles(v.km)} km` : "", custom_label_2: texto(v.combustible, 40),
  };
}

/** CSV con las columnas de todas las filas (en el orden en que aparecen). */
export function aCsv(filas) {
  const cols = [];
  for (const f of filas) for (const k of Object.keys(f)) if (!cols.includes(k)) cols.push(k);
  const esc = (x) => { const t = String(x ?? ""); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [cols.join(","), ...filas.map((f) => cols.map((c) => esc(f[c])).join(","))].join("\n");
}

/** Contenido del catálogo en el formato pedido, más el resumen (incluidos y excluidos con su motivo). */
export function armarCatalogo(vehiculos, formato, opciones) {
  const incluidos = []; const excluidos = [];
  for (const v of vehiculos || []) {
    const r = revisarParaCatalogo(v);
    if (r.ok) incluidos.push(v); else excluidos.push({ id: v.id, nombre: [v.marca, v.modelo, v.anio, v.patente].filter(Boolean).join(" "), motivo: r.motivo });
  }
  const avisoDe = (id) => (opciones.avisos || {})[id];
  const filas = incluidos.map((v) => (formato === "meta-productos" ? filaProductoMeta(v, { ...opciones, aviso: avisoDe(v.id) }) : filaVehiculoMeta(v, { ...opciones, aviso: avisoDe(v.id) })));
  return { csv: aCsv(filas), incluidos: incluidos.length, excluidos };
}
