/**
 * CONTRATO DE CONSIGNACIÓN (borrador)
 * ----------------------------------------------------------------
 * Texto del contrato que firma el dueño al consignar su vehículo, con los datos del dueño, el vehículo, los precios y el plazo ya puestos.
 * Es un BORRADOR redactado por el sistema: debe revisarlo un abogado antes de usarlo. Código puro (lo usan la pantalla y las pruebas).
 * ----------------------------------------------------------------
 */

const DIA = 86_400_000;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «2026-10-29» → «29 de octubre de 2026». */
export function fechaEnLetras(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** Fecha (AAAA-MM-DD) en que vence una consignación firmada en `desde` (AAAA-MM-DD) con ese plazo en días. */
export function venceContrato(desde, dias) {
  const d = new Date(`${String(desde).slice(0, 10)}T12:00:00Z`);
  return new Date(d.getTime() + Number(dias) * DIA).toISOString().slice(0, 10);
}

const v = (x) => (x === null || x === undefined || x === "" ? "—" : String(x));

/**
 * Cláusulas del contrato.
 * @param c    { fecha (AAAA-MM-DD), local: { nombre, direccion }, ejecutivo, dueno: { nombre, rut, telefono, email, direccion, banco, tipo_cuenta, numero_cuenta },
 *               vehiculo, precio_piso, precio_publicacion, plazo_dias, notas }
 * @param fmt  formateador de montos en pesos
 * @returns { partes: string, clausulas: [{ titulo, texto }], vence: string }
 */
export function contratoConsignacion(c, fmt) {
  const d = c.dueno || {};
  const veh = c.vehiculo || {};
  const loc = c.local || {};
  const vence = venceContrato(c.fecha, c.plazo_dias);
  const auto = [veh.marca, veh.modelo, veh.version].filter(Boolean).join(" ");
  const km = veh.km != null && veh.km !== "" ? `${Number(veh.km).toLocaleString("es-CL")} km` : "—";
  const partes = `En ${loc.direccion ? `${loc.direccion}` : "las oficinas del Consignatario"}, a ${fechaEnLetras(c.fecha)}, entre ${v(d.nombre)}, cédula de identidad N° ${v(d.rut)}, domiciliado en ${v(d.direccion)}, comuna de ${v(d.comuna)}, teléfono ${v(d.telefono)}, correo ${v(d.email)}, en adelante el «Consignante»; y DRIVE FUTURO, local «${v(loc.nombre)}»${loc.direccion ? `, domiciliado en ${loc.direccion}` : ""}, representado en este acto por ${v(c.ejecutivo)}, en adelante el «Consignatario», se celebra el siguiente contrato de consignación de vehículo:`;
  const clausulas = [
    { titulo: "PRIMERO: Objeto", texto: `El Consignante entrega en consignación al Consignatario, para su exhibición y venta por cuenta del Consignante, el vehículo ${v(auto)}, año ${v(veh.anio)}, patente ${v(veh.patente)}, color ${v(veh.color)}, con ${km} (en adelante, el «Vehículo»). El Consignatario queda facultado para exhibirlo, publicarlo, promoverlo y negociar su venta dentro de las condiciones de este contrato.` },
    { titulo: "SEGUNDO: Declaraciones del Consignante", texto: "El Consignante declara ser dueño del Vehículo y estar facultado para consignarlo; que se encuentra libre de prendas, embargos, prohibiciones, gravámenes y litigios, salvo lo que haya informado por escrito al Consignatario; y que la información y los documentos entregados (certificado de anotaciones vigentes, multas, permiso de circulación, revisión técnica, SOAP, padrón e informe legal) son veraces. Responde por el saneamiento del Vehículo y por las deudas anteriores a la entrega, como multas, permisos o TAG impagos, que podrán descontarse del pago con su autorización." },
    { titulo: "TERCERO: Precios", texto: `El precio piso es de ${fmt(c.precio_piso)}: es el monto mínimo que recibirá el Consignante por la venta, y el Consignatario no podrá vender el Vehículo por un valor inferior. El precio de publicación es de ${fmt(c.precio_publicacion)}. Como remuneración por su gestión, corresponderá al Consignatario toda cantidad que el comprador pague sobre el precio piso; el Consignante no deberá pagar comisión adicional alguna.` },
    { titulo: "CUARTO: Plazo", texto: `La consignación rige por ${v(c.plazo_dias)} días corridos desde la firma de este contrato, esto es, hasta el ${fechaEnLetras(vence)}. Podrá prorrogarse por escrito de común acuerdo. Si vence el plazo sin que se haya vendido el Vehículo, el Consignatario lo devolverá al Consignante, salvo que acuerden prorrogar.` },
    { titulo: "QUINTO: Gastos", texto: "Los gastos de publicación, exhibición y limpieza del Vehículo son de cargo del Consignatario. Los gastos e impuestos de la transferencia son de cargo del comprador, salvo acuerdo distinto por escrito. El Consignante no pagará ningún cargo por mantener el Vehículo en consignación." },
    { titulo: "SEXTO: Pago al Consignante", texto: `Vendido el Vehículo y recibido íntegramente el pago del comprador, el Consignatario pagará al Consignante el precio piso, o el monto menor que el Consignante acepte por escrito, dentro de 5 días hábiles, mediante transferencia a la cuenta ${v(d.tipo_cuenta)} N° ${v(d.numero_cuenta)} del banco ${v(d.banco)}, a nombre de ${v(d.nombre)}, RUT ${v(d.rut)}.` },
    { titulo: "SÉPTIMO: Custodia y riesgos", texto: "Mientras el Vehículo esté en poder del Consignatario, este lo mantendrá bajo custodia y responderá por su pérdida o daño, salvo caso fortuito o fuerza mayor. El Consignatario podrá realizar pruebas de manejo solo con personas acompañadas por su personal, y no podrá usar el Vehículo para fines propios. El Consignante mantendrá vigente el seguro obligatorio (SOAP) y la documentación al día durante la consignación." },
    { titulo: "OCTAVO: Retiro y terminación", texto: "El Consignante podrá retirar el Vehículo antes del vencimiento avisando por escrito al Consignatario, siempre que no exista una venta o reserva en curso, y pagando los gastos de gestión debidamente acreditados que el Consignatario haya efectuado por su cuenta. Al devolverse el Vehículo, las partes firmarán un acta de devolución. Cualquiera de las partes podrá poner término al contrato si la otra incumple gravemente sus obligaciones." },
    { titulo: "NOVENO: Comunicaciones y domicilio", texto: `Las comunicaciones se harán al correo y teléfono del Consignante indicados en la comparecencia. Para todos los efectos de este contrato, las partes fijan domicilio en la ciudad donde se encuentra el local del Consignatario y se someten a la competencia de sus tribunales ordinarios de justicia.` },
    { titulo: "DÉCIMO: Ejemplares", texto: "El presente contrato se firma en dos ejemplares del mismo tenor, quedando uno en poder de cada parte." },
  ];
  if (c.notas) clausulas.push({ titulo: "OBSERVACIONES", texto: String(c.notas) });
  return { partes, clausulas, vence };
}
