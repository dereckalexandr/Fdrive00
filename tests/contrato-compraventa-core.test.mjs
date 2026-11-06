import { test } from "node:test";
import assert from "node:assert/strict";
import { contratoCompraventa, pesosEnLetras, fechaContrato, validarContratoCompraventa } from "../supabase/functions/api/contrato-compraventa-core.js";
import { buildContratoCompraventaPdf } from "../src/pdf-report.js";

const fmt = (n) => `$ ${Number(n).toLocaleString("es-CL")}`;
// Datos ficticios (no son de personas reales).
const DATOS = {
  fecha: "2026-10-21", ciudad: "Santiago",
  vendedor: { razon_social: "Autos Ejemplo SpA", rut: "76.000.000-0", domicilio: "Calle Uno 100", comuna: "Santiago", region: "Metropolitana", representante: "Pedro Ejemplo Prueba", rut_representante: "11.111.111-1", personeria: "la escritura ante el Registro Electrónico de Empresas y Sociedades de fecha 01-01-2022" },
  comprador: { nombre: "Ana Modelo Ficticia", rut: "22.222.222-2", domicilio: "Calle Dos 200", comuna: "Colina", region: "Metropolitana" },
  vehiculo: { tipo: "AUTOMÓVIL", color: "Gris Metálico", chasis: "ABCDE12345F678901", marca: "Marca", modelo: "Modelo", version: "1.5 Aut", anio: 2026, numero_motor: "MOTOR 12345", km: 7000, patente: "ABCD12-3" },
  precio: 22400000, tasacion_fiscal: 22400000,
};

test("Pesos en letras", () => {
  assert.equal(pesosEnLetras(22400000), "VEINTIDÓS MILLONES CUATROCIENTOS MIL PESOS");
  assert.equal(pesosEnLetras(1000000), "UN MILLÓN DE PESOS");
  assert.equal(pesosEnLetras(2000000), "DOS MILLONES DE PESOS");
  assert.equal(pesosEnLetras(21000), "VEINTIÚN MIL PESOS");
  assert.equal(pesosEnLetras(1500), "MIL QUINIENTOS PESOS");
  assert.equal(pesosEnLetras(100), "CIEN PESOS");
  assert.equal(pesosEnLetras(101), "CIENTO UN PESOS");
  assert.equal(pesosEnLetras(9990000), "NUEVE MILLONES NOVECIENTOS NOVENTA MIL PESOS");
  assert.equal(pesosEnLetras(-5), "");
});

test("Fecha del contrato", () => assert.equal(fechaContrato("2026-10-21"), "21 de OCTUBRE de 2026"));

test("Contrato de compraventa: réplica de las 9 cláusulas del contrato oficial", () => {
  const c = contratoCompraventa(DATOS, fmt);
  assert.deepEqual(c.clausulas.map((x) => x.titulo), ["PRIMERO", "SEGUNDO", "TERCERO", "CUARTO", "QUINTO", "SEXTO", "SÉPTIMO", "OCTAVO", "NOVENO"]);
  assert.match(c.comparecencia, /AUTOS EJEMPLO SPA RUT 76\.000\.000-0.*representado por PEDRO EJEMPLO PRUEBA RUT 11\.111\.111-1.*«Vendedor».*ANA MODELO FICTICIA RUT 22\.222\.222-2/);
  assert.match(c.clausulas[0].texto, /Chasis ABCDE12345F678901 marca MARCA MODELO 1\.5 AUT año 2026 con motor N° MOTOR 12345 y 7\.000 kilómetros.*N° ABCD12-3/);
  assert.match(c.clausulas[1].texto, /\$ 22\.400\.000 \(VEINTIDÓS MILLONES CUATROCIENTOS MIL PESOS\).*AL CONTADO.*tasación fiscal es de \$ 22\.400\.000/);
  assert.match(c.clausulas[6].texto, /Ley N° 21\.389/);
  assert.match(c.clausulas[7].texto, /personería de PEDRO EJEMPLO PRUEBA, para representar a AUTOS EJEMPLO SPA/);
  assert.match(c.clausulas[8].texto, /Ley N° 19\.799/);
});

test("Sin representante la cláusula de personería se omite y la de validez pasa a OCTAVO", () => {
  const c = contratoCompraventa({ ...DATOS, vendedor: { ...DATOS.vendedor, representante: "" } }, fmt);
  assert.equal(c.clausulas.length, 8);
  assert.equal(c.clausulas[7].titulo, "OCTAVO");
});

test("Forma de pago distinta de contado y datos faltantes en blanco", () => {
  const c = contratoCompraventa({ ...DATOS, forma_pago: "$ 10.000.000 al contado y $ 12.400.000 con crédito", vendedor: {} }, fmt);
  assert.match(c.clausulas[1].texto, /paga de la siguiente forma: \$ 10\.000\.000 al contado y/);
  assert.match(c.comparecencia, /________ RUT ________/);
});

test("Validación de los datos que aporta el ejecutivo", () => {
  assert.deepEqual(validarContratoCompraventa({ chasis: "abc de-12345f678901", tasacionFiscal: "22400000" }), { ok: true, value: { chasis: "ABCDE12345F678901", tasacion_fiscal: 22400000, km: null, forma_pago: null } });
  assert.equal(validarContratoCompraventa({ chasis: "123", tasacionFiscal: 1 }).error, "chasis_invalido");
  assert.equal(validarContratoCompraventa({ chasis: "ABCDE12345F678901", tasacionFiscal: "" }).error, "tasacion_fiscal_invalida");
  assert.equal(validarContratoCompraventa({ chasis: "ABCDE12345F678901", tasacionFiscal: 5, kilometraje: "x" }).error, "kilometraje_invalido");
});

test("El PDF del contrato se genera", () => {
  const pdf = buildContratoCompraventaPdf(DATOS, { fmt });
  assert.ok(pdf.length > 3000);
  assert.equal(String.fromCharCode(...pdf.slice(0, 5)), "%PDF-");
});
