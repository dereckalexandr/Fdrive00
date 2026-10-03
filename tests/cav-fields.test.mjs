// Ejecutar con:  npm test
// Los datos de personas son INVENTADOS; solo se imita la estructura de un CAV real.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCavFields } from "../src/cav-fields.js";

// Formato B (CAV real del Registro Civil): etiqueta y valor en líneas consecutivas.
const CAV_ETIQUETA_Y_VALOR_EN_LINEAS_SEPARADAS = [
  "SERVICIO DE REGISTRO", "CIVIL E IDENTIFICACIÓN", "REPUBLICA DE CHILE",
  "FOLIO :   100000000001", "Código Verificación:", "abcdef123456",
  "CERTIFICADO DE INSCRIPCION Y", "ANOTACIONES VIGENTES EN EL R. V. M.",
  "Inscripción   :  ", "ABCD.12-3",
  "DATOS DEL VEHICULO",
  "Tipo Vehículo   :  ", "STATION   WAGON   Año   :   2025",
  "Marca   :  ", "TOYOTA",
  "Modelo   :  ", "FORTUNER   OTTO   2.7   AUT",
  "Nro. Motor   :  ", "1ABC123456",
  "Nro. Chasis   :  ", "9XYZW1AB2   C0001234",
  "Color   :  ", "BLANCO",
  "Combustible   :  ", "GASOLINA",
  "PBV   :  ", "2.500,00   KILOS",
  "Instit.   aseg.   :  ", "ASEGURADORA   EJEMPLO   S.   A.",
  "Numero poliza   :  ", "1.234.567",
  "DATOS DEL PROPIETARIO",
  "Nombre   :  ", "JUAN   PEREZ   GONZALEZ",
  "R.U.N.   :  ", "12.345.678-5",
  "Fec. adquisición:  ", "01-01-2024",
  "Repertorio   :  ", "RVM EJEMPLO",
  "Número   :  ", "123456   de fecha   :   02-01-2024",
  "Sr. usuario:   Corrobore   la   exactitud   de   los   datos   identificatorios   del   vehiculo",
].join("\n");

test("formato real: valor en la línea siguiente a la etiqueta", () => {
  const f = parseCavFields(CAV_ETIQUETA_Y_VALOR_EN_LINEAS_SEPARADAS);
  assert.equal(f.inscripcion, "ABCD.12-3");
  assert.equal(f.marca, "TOYOTA");
  assert.equal(f.modelo, "FORTUNER OTTO 2.7 AUT");
  assert.equal(f.nroMotor, "1ABC123456");
  assert.equal(f.color, "BLANCO");
  assert.equal(f.propietarioNombre, "JUAN PEREZ GONZALEZ");
  assert.equal(f.propietarioRun, "12.345.678-5");
});

test("números de motor/chasis se compactan (sin espacios internos)", () => {
  const f = parseCavFields(CAV_ETIQUETA_Y_VALOR_EN_LINEAS_SEPARADAS);
  assert.equal(f.nroChasis, "9XYZW1AB2C0001234");
});

test("campos que el CAV no trae no se inventan", () => {
  const f = parseCavFields(CAV_ETIQUETA_Y_VALOR_EN_LINEAS_SEPARADAS);
  assert.equal(f.nroSerie, undefined);
  assert.equal(f.nroVin, undefined);
});

test("no confunde campos no capturados con los capturados (Número poliza, Número, Año)", () => {
  const f = parseCavFields(CAV_ETIQUETA_Y_VALOR_EN_LINEAS_SEPARADAS);
  for (const v of Object.values(f)) {
    assert.ok(!/1\.234\.567|123456 de fecha|2025/.test(v), `valor contaminado: ${v}`);
  }
});

test("formato alternativo: valor en la misma línea", () => {
  const f = parseCavFields([
    "Inscripción : ABCD.12-3",
    "Marca : TOYOTA",
    "Modelo : YARIS",
    "Nro. Motor : 1ABC123456",
    "Color : GRIS",
    "Nombre : JUAN PEREZ",
    "R.U.N. : 12.345.678-5",
  ].join("\n"));
  assert.deepEqual(f, {
    inscripcion: "ABCD.12-3", marca: "TOYOTA", modelo: "YARIS", nroMotor: "1ABC123456",
    color: "GRIS", propietarioNombre: "JUAN PEREZ", propietarioRun: "12.345.678-5",
  });
});

test("varias parejas etiqueta:valor en una línea se separan", () => {
  const f = parseCavFields("Marca : TOYOTA Modelo : YARIS Color : ROJO");
  assert.equal(f.marca, "TOYOTA");
  assert.equal(f.modelo, "YARIS");
  assert.equal(f.color, "ROJO");
});

test("un valor que contiene el texto de otra etiqueta NO se corta (COLOR VINOTINTO)", () => {
  const f = parseCavFields("Color   :  \nVINOTINTO\nNombre   :  \nMARCO MOTORISTA RUN");
  assert.equal(f.color, "VINOTINTO");
  assert.equal(f.propietarioNombre, "MARCO MOTORISTA RUN");
});

test("mayúsculas/minúsculas y tildes de la etiqueta no importan", () => {
  const f = parseCavFields("INSCRIPCIÓN : abcd.12-3\nmarca : Toyota");
  assert.equal(f.inscripcion, "abcd.12-3");
  assert.equal(f.marca, "Toyota");
});

test("títulos sin ':' no se toman como campo", () => {
  const f = parseCavFields("CERTIFICADO DE INSCRIPCION Y\nANOTACIONES VIGENTES EN EL R. V. M.");
  assert.deepEqual(f, {});
});

test("etiqueta sin valor al final del texto no revienta", () => {
  assert.deepEqual(parseCavFields("Marca   :  "), {});
});

test("texto vacío o nulo", () => {
  assert.deepEqual(parseCavFields(""), {});
  assert.deepEqual(parseCavFields(null), {});
});

test("respaldo del RUN por patrón si no hay etiqueta", () => {
  const f = parseCavFields("Propietario\nJUAN PEREZ 12.345.678-5 otra cosa");
  assert.equal(f.propietarioRun, "12.345.678-5");
});
