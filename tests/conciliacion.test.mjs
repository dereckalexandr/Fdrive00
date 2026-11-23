// Conciliación bancaria: lectura de cartolas (CSV, HTML «.xls», Excel .xlsx), montos y fechas en formato chileno, emparejamiento
// con los movimientos de la cuenta y la operación del servidor (resumen, saldo, lo que falta y lo que no está en la cartola).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { leerMonto, leerFecha, leerCartola, conciliar, montoEnCuenta, categoriaSugerida } from "../supabase/functions/api/conciliacion-core.js";
import { leerCsv, leerHtml, leerXlsx } from "../src/lector-planillas.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

test("Montos y fechas como vienen en las cartolas", () => {
  assert.equal(leerMonto("1.234.567"), 1234567);
  assert.equal(leerMonto("$ -45.990"), -45990);
  assert.equal(leerMonto("(12.000)"), -12000);
  assert.equal(leerMonto("1.234,56"), 1235);
  assert.equal(leerMonto("1234.5"), 1235);
  assert.equal(leerMonto("2.500-"), -2500);
  assert.equal(leerMonto(890000), 890000);
  assert.equal(leerMonto(""), null);
  assert.equal(leerMonto("Saldo"), null);
  assert.equal(leerFecha("05/11/2026"), "2026-11-05");
  assert.equal(leerFecha("5-11-26"), "2026-11-05");
  assert.equal(leerFecha("2026-11-05"), "2026-11-05");
  assert.equal(leerFecha("05/11", 2026), "2026-11-05");
  assert.equal(leerFecha(46331), "2026-11-05"); // número de serie de Excel
  assert.equal(leerFecha("31/02/2026"), null);
  assert.equal(leerFecha("Total"), null);
});

test("Cartola con columnas Cargo / Abono / Saldo y otra con una sola columna Monto: mismas líneas", () => {
  const a = leerCartola([
    ["Banco de Crédito e Inversiones"], ["Cartola de cuenta corriente N° 123"], [],
    ["Fecha", "Descripción", "N° Documento", "Cargos ($)", "Abonos ($)", "Saldo ($)"],
    ["01/11/2026", "Saldo inicial", "", "", "", "1.000.000"],
    ["03/11/2026", "TRANSF DE JUAN PEREZ", "778899", "", "4.500.000", "5.500.000"],
    ["05/11/2026", "PAGO ARRIENDO", "", "1.200.000", "", "4.300.000"],
    ["06/11/2026", "COMISION MANTENCION", "", "8.900", "", "4.291.100"],
    ["", "Total", "", "1.208.900", "4.500.000", ""],
  ]);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual(a.lineas.map((l) => [l.fecha, l.monto]), [["2026-11-03", 4500000], ["2026-11-05", -1200000], ["2026-11-06", -8900]]);
  assert.equal(a.lineas[0].documento, "778899");
  assert.equal(a.lineas[2].saldo, 4291100);
  const b = leerCartola([["Fecha Contable", "Glosa", "Monto", "Saldo Disponible"], ["03-11-2026", "TRANSF DE JUAN PEREZ", "4500000", "5500000"], ["05-11-2026", "PAGO ARRIENDO", "-1200000", "4300000"]]);
  assert.deepEqual(b.lineas.map((l) => [l.fecha, l.monto, l.descripcion]), [["2026-11-03", 4500000, "TRANSF DE JUAN PEREZ"], ["2026-11-05", -1200000, "PAGO ARRIENDO"]]);
  assert.equal(leerCartola([["Nombre", "Valor"], ["x", "1"]]).error, "cartola_sin_columnas");
  assert.equal(leerCartola([["Fecha", "Monto"], ["Total", "5"]]).error, "cartola_vacia");
});

test("Lectores: CSV con ; y comillas, tabla HTML («.xls» de banco) y Excel .xlsx", async () => {
  assert.deepEqual(leerCsv('﻿Fecha;Glosa;Monto\r\n03/11/2026;"PAGO; ARRIENDO";-1.200.000\r\n\r\n'), [["Fecha", "Glosa", "Monto"], ["03/11/2026", "PAGO; ARRIENDO", "-1.200.000"]]);
  assert.deepEqual(leerCsv("Fecha,Monto\n03/11/2026,500"), [["Fecha", "Monto"], ["03/11/2026", "500"]]);
  const html = "<html><table><tr><td>Logo</td></tr></table><table><tr><th>Fecha</th><th>Descripci&oacute;n</th><th>Cargo</th></tr><tr><td>05/11/2026</td><td>PAGO &amp; CIA</td><td>1.200</td></tr><tr><td>06/11/2026</td><td>X</td><td>5</td></tr></table></html>";
  const h = leerHtml(html);
  assert.equal(h.length, 3);
  assert.equal(h[1][1], "PAGO & CIA");

  // Un .xlsx mínimo: hoja con textos compartidos, un texto en línea, un número y una fecha como número de serie.
  const archivos = {
    "xl/workbook.xml": "<workbook/>",
    "xl/sharedStrings.xml": '<sst><si><t>Fecha</t></si><si><t>Glosa</t></si><si><r><t>Mon</t></r><r><t>to</t></r></si><si><t>PAGO ARRIENDO</t></si></sst>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2"><v>46331</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>-1200000</v></c></row>'
      + '<row r="3"><c r="A3" t="inlineStr"><is><t>06/11/2026</t></is></c><c r="C3"><v>5000</v></c></row></sheetData></worksheet>',
  };
  const x = await leerXlsx(zip(archivos));
  assert.deepEqual(x, [["Fecha", "Glosa", "Monto"], [46331, "PAGO ARRIENDO", -1200000], ["06/11/2026", "", 5000]]);
  const c = leerCartola(x);
  assert.deepEqual(c.lineas.map((l) => [l.fecha, l.monto]), [["2026-11-05", -1200000], ["2026-11-06", 5000]]);
});

/** Arma un zip (deflate) en memoria, como un .xlsx. */
function zip(archivos) {
  const enc = new TextEncoder();
  const locales = []; const centrales = []; let off = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const n = enc.encode(nombre); const datos = enc.encode(texto); const comp = deflateRawSync(datos);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(datos.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(datos.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locales.push(lh, Buffer.from(n), comp); centrales.push(ch, Buffer.from(n));
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrales);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locales, cd, fin]));
}

test("Emparejar: mismo monto y signo a pocos días; gana el mismo N° de documento; cada movimiento una sola vez", () => {
  const movs = [
    { id: "m1", tipo: "ingreso", monto: 500000, fecha: "2026-11-02", cuenta_id: "C" },
    { id: "m2", tipo: "ingreso", monto: 500000, fecha: "2026-11-03", cuenta_id: "C", documento_numero: "998" },
    { id: "m3", tipo: "egreso", monto: 1200000, fecha: "2026-11-01", cuenta_id: "C" },
    { id: "m4", tipo: "egreso", monto: 1200000, fecha: "2026-11-01", cuenta_id: "OTRA" },
    { id: "m5", tipo: "traspaso", monto: 300000, fecha: "2026-11-04", cuenta_id: null, cuenta_destino_id: "C" },
    { id: "m6", tipo: "egreso", monto: 77000, fecha: "2026-11-05", cuenta_id: "C" }, // no está en la cartola
    { id: "m7", tipo: "egreso", monto: 50000, fecha: "2026-10-01", cuenta_id: "C" }, // lejos: no empareja
  ];
  assert.equal(montoEnCuenta(movs[4], "C"), 300000);
  assert.equal(montoEnCuenta(movs[3], "C"), 0);
  const r = conciliar([
    { n: 1, fecha: "2026-11-02", monto: 500000, documento: "" },
    { n: 2, fecha: "2026-11-02", monto: 500000, documento: "000998" },
    { n: 3, fecha: "2026-11-04", monto: -1200000 },
    { n: 4, fecha: "2026-11-04", monto: 300000 },
    { n: 5, fecha: "2026-11-05", monto: -50000 },
    { n: 6, fecha: "2026-11-05", monto: -8900 },
  ], movs, "C", { desde: "2026-11-01", hasta: "2026-11-30" });
  assert.deepEqual(r.lineas.map((l) => l.movimientoId), ["m1", "m2", "m3", "m5", null, null]);
  assert.deepEqual(r.sinCartola.map((m) => m.id), ["m6"]);
  assert.equal(categoriaSugerida({ monto: -8900, descripcion: "COMISION MANTENCION CTA CTE" }), "bancos");
  assert.equal(categoriaSugerida({ monto: -45990, descripcion: "PAC MOVISTAR" }), "servicios");
  assert.equal(categoriaSugerida({ monto: -300000, descripcion: "PAGO PREVIRED" }), "sueldos");
  assert.equal(categoriaSugerida({ monto: 100000, descripcion: "ABONO" }), "otros_ingresos");
});

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
let admin; let L1; let jefe; let CTA;
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crm(admin, "usuarios.create", { datos: { nombre: "Julia Jefa", rut: "12.345.678-5", roles: ["jefe_local"], localId: L1 }, clave: "Prueba12345" });
  nuevaIp();
  jefe = (await api({ action: "userLogin", rut: "12.345.678-5", password: "Prueba12345" })).token;
  CTA = randomUUID();
  db.tablas.cuentas_empresa.push({ id: CTA, local_id: L1, banco: "Banco BCI", tipo_cuenta: "Cuenta corriente", numero_cuenta: "1234", activa: true });
});

test("Servidor: concilia la cartola con lo registrado, compara el saldo y guarda el resumen; los que faltan traen categoría sugerida", async () => {
  assert.equal((await ve(admin, "fin.saldo_guardar", { localId: L1, clave: CTA, saldoInicial: 1000000, desde: "2026-11-01" })).status, 200);
  const g = (mov) => ve(admin, "fin.mov_guardar", { localId: L1, mov: { cuentaId: CTA, medio: "transferencia", ...mov } });
  assert.equal((await g({ tipo: "egreso", categoria: "arriendo", monto: 1200000, fecha: "2026-11-05", descripcion: "Arriendo" })).status, 200);
  assert.equal((await g({ tipo: "ingreso", categoria: "otros_ingresos", monto: 4500000, fecha: "2026-11-03", descripcion: "Abono cliente" })).status, 200);
  assert.equal((await g({ tipo: "egreso", categoria: "insumos", monto: 30000, fecha: "2026-11-07", descripcion: "Insumos" })).status, 200);

  const lineas = [
    { fecha: "2026-11-03", descripcion: "TRANSF DE JUAN PEREZ", monto: 4500000, saldo: 5500000 },
    { fecha: "2026-11-05", descripcion: "PAGO ARRIENDO", monto: -1200000, saldo: 4300000 },
    { fecha: "2026-11-06", descripcion: "COMISION MANTENCION", monto: -8900, saldo: 4291100 },
  ];
  assert.equal((await ve(admin, "fin.conciliar", { localId: L1, cuenta: "no-existe", lineas })).status, 404);
  assert.equal((await ve(admin, "fin.conciliar", { localId: L1, cuenta: CTA, lineas: [] })).error, "cartola_vacia");
  const r = await ve(jefe, "fin.conciliar", { cuenta: CTA, lineas });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.resumen.cuadran, 2);
  assert.equal(r.resumen.faltan, 1);
  assert.equal(r.lineas[2].categoria, "bancos");
  assert.equal(r.resumen.sinCartola, 0); // los insumos del 07 están fuera del rango de la cartola (03 al 06)
  assert.equal(r.resumen.saldoCartola, 4291100);
  assert.equal(r.resumen.saldoCrm, 1000000 + 4500000 - 1200000);
  assert.equal(r.resumen.diferencia, -8900); // justo la comisión que falta registrar

  // Registrar la comisión que faltaba deja la cuenta cuadrada.
  assert.equal((await g({ tipo: "egreso", categoria: "bancos", monto: 8900, fecha: "2026-11-06", descripcion: "COMISION MANTENCION" })).status, 200);
  const r2 = await ve(admin, "fin.conciliar", { localId: L1, cuenta: CTA, lineas });
  assert.equal(r2.resumen.faltan, 0);
  assert.equal(r2.resumen.diferencia, 0);
  const c = await ve(jefe, "fin.conciliaciones");
  assert.equal(c.conciliaciones[CTA].diferencia, 0);
  assert.equal(c.conciliaciones[CTA].hasta, "2026-11-06");
});
