/**
 * CONTRATO DE COMPRAVENTA DE VEHÍCULO (réplica del contrato de la plataforma Autofact Pro)
 * ----------------------------------------------------------------
 * Mismas 9 cláusulas del contrato oficial: venta, precio y forma de pago (con tasación fiscal), declaración jurada de libertad de gravámenes,
 * revisión del vehículo y renuncia a vicios redhibitorios, facultad de anotar la transferencia, multas, pensión de alimentos (Ley 21.389),
 * personería del representante y validez electrónica (Ley 19.799).
 * Es un BORRADOR: debe revisarlo un abogado antes de usarlo. Código puro (lo usan el servidor, la pantalla y las pruebas).
 * ----------------------------------------------------------------
 */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const UNIDADES = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
  "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIÚN", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

/** Número entero 0–999 en letras (sin «UN» final distinto: «UN» se ajusta afuera). */
function menorMil(n) {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  let t = CENTENAS[c];
  if (r === 0) return t;
  if (r < 30) return `${t ? `${t} ` : ""}${UNIDADES[r]}`;
  const d = Math.floor(r / 10);
  const u = r % 10;
  return `${t ? `${t} ` : ""}${DECENAS[d]}${u ? ` Y ${UNIDADES[u]}` : ""}`;
}

/** Pesos en letras, en mayúsculas: 22400000 → «VEINTIDÓS MILLONES CUATROCIENTOS MIL PESOS». */
export function pesosEnLetras(monto) {
  const n = Math.round(Number(monto));
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) return "";
  if (n === 0) return "CERO PESOS";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${menorMil(millones).replace(/ UN$/, " UN")} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${menorMil(miles)} MIL`);
  if (resto) partes.push(menorMil(resto));
  const exacto = n % 1_000_000 === 0 && millones ? " DE" : "";
  return `${partes.join(" ")}${exacto} PESOS`;
}

/** «2026-10-21» → «21 de OCTUBRE de 2026» (como en el contrato oficial). */
export function fechaContrato(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1].toUpperCase()} de ${m[1]}`;
}

/** Fecha corta del contrato: «2026-10-22» → «22-10-2026». */
export function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

const limpio = (x, max) => String(x === null || x === undefined ? "" : x).replace(/\s+/g, " ").trim().slice(0, max);
const entero = (x) => {
  if (x === "" || x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isInteger(n) && n >= 0 && n <= 2_000_000_000 ? n : NaN;
};

/**
 * Datos que el ejecutivo completa para el contrato (el resto sale del cierre, el cliente y el vehículo).
 * @param input { chasis, tasacionFiscal, formaPago, pagoContado (bool), kilometraje, fecha }
 */
export function validarContratoCompraventa(input) {
  const i = input || {};
  const chasis = limpio(i.chasis, 30).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (chasis.length < 6) return { ok: false, error: "chasis_invalido" };
  const fiscal = entero(i.tasacionFiscal);
  if (fiscal === null || Number.isNaN(fiscal) || fiscal < 1) return { ok: false, error: "tasacion_fiscal_invalida" };
  const km = i.kilometraje === "" || i.kilometraje === undefined || i.kilometraje === null ? null : entero(i.kilometraje);
  if (Number.isNaN(km)) return { ok: false, error: "kilometraje_invalido" };
  const formaPago = limpio(i.formaPago, 200) || null;
  return { ok: true, value: { chasis, tasacion_fiscal: fiscal, km, forma_pago: formaPago } };
}

const v = (x) => (x === null || x === undefined || x === "" ? "________" : String(x));
const mayus = (x) => (x === null || x === undefined || x === "" ? "________" : String(x).toUpperCase());

/**
 * Cláusulas del contrato.
 * @param c    { fecha (AAAA-MM-DD), ciudad,
 *               vendedor: { razon_social, rut, domicilio, comuna, region, representante, rut_representante, personeria },
 *               comprador: { nombre, rut, domicilio, comuna, region },
 *               vehiculo: { tipo, color, chasis, marca, modelo, version, anio, numero_motor, km, patente },
 *               precio, forma_pago, tasacion_fiscal }
 * @param fmt  formateador de montos en pesos
 * @returns { comparecencia: string, clausulas: [{ titulo, texto }], vendedor: string, comprador: string }
 */
export function contratoCompraventa(c, fmt) {
  const ven = c.vendedor || {};
  const com = c.comprador || {};
  const veh = c.vehiculo || {};
  const nombreVen = mayus(ven.razon_social);
  const nombreCom = mayus(com.nombre);
  const auto = [veh.marca, veh.modelo, veh.version].filter(Boolean).join(" ");
  const km = veh.km != null && veh.km !== "" ? `${Number(veh.km).toLocaleString("es-CL")} kilómetros` : "________ kilómetros";
  const lugar = (d, comuna, region) => [d && mayus(d), comuna && `COMUNA ${mayus(comuna)}`, region && `REGIÓN ${mayus(region)}`].filter(Boolean).join(", ");
  const representado = ven.representante ? `, representado por ${mayus(ven.representante)} RUT ${v(ven.rut_representante)}` : "";
  const comparecencia = `En ${mayus(c.ciudad || "Santiago")}, REPÚBLICA DE CHILE, a ${fechaContrato(c.fecha)}. Entre ${nombreVen} RUT ${v(ven.rut)} domiciliado para estos efectos en ${lugar(ven.domicilio, ven.comuna, ven.region) || "________"}${representado} como el «Vendedor» y ${nombreCom} RUT ${v(com.rut)} domiciliado para estos efectos en ${lugar(com.domicilio, com.comuna, com.region) || "________"}, como el «Comprador», y conjuntamente, las «Partes»; se ha convenido el siguiente contrato de compraventa, en adelante, el «Contrato»:`;
  const pago = c.forma_pago ? String(c.forma_pago) : `${fmt(c.precio)} AL CONTADO`;
  const clausulas = [
    { titulo: "PRIMERO", texto: `${nombreVen} vende, cede y transfiere a ${nombreCom} quien compra, acepta y adquiere para sí un vehículo tipo ${mayus(veh.tipo || "AUTOMÓVIL")} Color ${mayus(veh.color)} N° de Chasis ${mayus(veh.chasis)} marca ${mayus(auto)} año ${v(veh.anio)} con motor N° ${mayus(veh.numero_motor)} y ${km}, actual Patente e Inscripción en el Registro Nacional de Vehículos Motorizados del Registro Civil N° ${mayus(veh.patente)} en el estado en que actualmente se encuentra y que el Comprador conoce cabalmente.` },
    { titulo: "SEGUNDO", texto: `El precio de venta es la suma de ${fmt(c.precio)} (${pesosEnLetras(c.precio)}) que el Comprador paga de la siguiente forma: ${pago}, y que el Vendedor declara recibir a su entera satisfacción. La tasación fiscal es de ${fmt(c.tasacion_fiscal)} (${pesosEnLetras(c.tasacion_fiscal)}).` },
    { titulo: "TERCERO", texto: "Declara el Vendedor bajo juramento que el vehículo que vende no tiene deudas ni gravámenes de ninguna especie: como prenda, embargo o prohibición de enajenar. El Comprador declara, por su parte, que este hecho es causa determinante de esta compraventa y que ha estudiado debidamente el dominio vigente del vehículo que compra. Ambas Partes liberan al Notario que autoriza de toda responsabilidad al respecto." },
    { titulo: "CUARTO", texto: "Declara el Comprador que ha revisado detenidamente: a) el vehículo objeto de este Contrato, verificando que el VIN, el número de chasis y el número de motor coinciden con los registros oficiales del vehículo; y b) la cédula de identidad del Vendedor, verificando que esta es auténtica y no presenta adulteraciones. Por lo tanto, declara recibir el vehículo a su entera satisfacción, expresa no tener cargo alguno ni objeción que formular y renuncia expresamente a las acciones de saneamiento por vicios redhibitorios establecido en el párrafo 8 del Título XXIII del Libro IV del Código Civil." },
    { titulo: "QUINTO", texto: "El Comprador queda facultado para requerir, por sí solo, la anotación de esta transferencia en las oficinas correspondientes." },
    { titulo: "SEXTO", texto: "El Comprador acepta el presente vehículo en su situación y responsabilidad de multas, la cual consta en el Certificado de Multas de Tránsito Impagas del Servicio de Registro Civil e Identificación." },
    { titulo: "SÉPTIMO", texto: "Declaración Jurada sobre Deudas de Pensión de Alimentos. El Vendedor y Comprador declara que, a la fecha de suscripción del presente instrumento, no mantienen inscripciones vigentes en calidad de deudores en el Registro Nacional de Deudores de Pensiones de Alimentos, creado por la Ley N° 21.389." },
  ];
  if (ven.representante) {
    clausulas.push({ titulo: "OCTAVO", texto: `La personería de ${mayus(ven.representante)}, para representar a ${nombreVen}, consta de ${ven.personeria ? String(ven.personeria) : "la escritura ante el Registro Electrónico de Empresas y Sociedades dependiente del Ministerio de Economía, Fomento y Turismo de fecha ________"}.` });
  }
  clausulas.push({ titulo: ven.representante ? "NOVENO" : "OCTAVO", texto: "El presente Contrato tiene su validez como documento electrónico de acuerdo a la Ley N° 19.799, el cual ha sido firmado por ambas Partes mediante firma electrónica." });
  return { comparecencia, clausulas, vendedor: ven.representante ? mayus(ven.representante) : nombreVen, comprador: nombreCom };
}
