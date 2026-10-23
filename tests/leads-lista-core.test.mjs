import { test } from "node:test";
import assert from "node:assert/strict";
import { armarFilaLead, filtrarFilas, ordenarFilas, filasACsv, celdaCsv } from "../supabase/functions/api/leads-lista-core.js";

const AHORA = new Date("2026-10-23T12:00:00Z");
const fila = (o = {}) => armarFilaLead({
  lead: { id: "l1", tipo: "venta", etapa: "nuevo", fuente: "Instagram", asignado_a: "u1", creado_en: "2026-10-22T10:00:00Z", etapa_desde: "2026-10-22T10:00:00Z", ...o.lead },
  cliente: { nombre: "Sofía Núñez", telefono: "912345678", email: "s@x.cl", ...o.cliente },
  vehiculo: o.vehiculo === undefined ? { id: "v1", marca: "Toyota", modelo: "Yaris", anio: 2021, precio_lista: 9890000, fotos: ["f1"] } : o.vehiculo,
  asignado: o.asignado === undefined ? { nombre: "Eva" } : o.asignado, proxima: o.proxima,
}, AHORA);

test("Fila de lead: venta, compra y estado de atención", () => {
  const v = fila();
  assert.equal(v.vehiculo, "Toyota Yaris 2021");
  assert.equal(v.monto, 9890000);
  assert.equal(v.dias, 1);
  assert.equal(v.sinProxima, true);
  assert.equal(v.porAtender, true);
  assert.equal(v.foto, "f1");
  const c = fila({ lead: { tipo: "compra", etapa: "tasacion", vehiculo_ofrecido: { marca: "Kia", modelo: "Rio", anio: 2018, precioEsperado: 5000000 } }, vehiculo: null, proxima: { titulo: "Llamar", vence_en: "2026-10-23T08:00:00Z" } });
  assert.equal(c.etapaNombre, "Tasación pedida");
  assert.equal(c.vehiculo, "Kia Rio 2018");
  assert.equal(c.monto, 5000000);
  assert.equal(c.proximaVencida, true);
  assert.equal(c.sinProxima, false);
  const g = fila({ lead: { etapa: "ganado" } });
  assert.equal(g.abierto, false);
  assert.equal(g.dias, 0);
  assert.equal(g.sinProxima, false);
});

test("Filtros de la lista", () => {
  const a = fila();
  const b = fila({ lead: { id: "l2", tipo: "compra", etapa: "contactado", fuente: "Sitio web", asignado_a: "" }, cliente: { nombre: "Pedro Pino", telefono: "987654321" }, asignado: null, vehiculo: null, proxima: { titulo: "x", vence_en: "2026-10-30T00:00:00Z" } });
  const todas = [a, b];
  const ids = (f) => filtrarFilas(todas, f).map((r) => r.id);
  assert.equal(ids({}).length, 2);
  assert.deepEqual(ids({ tipo: "compra" }), ["l2"]);
  assert.deepEqual(ids({ asignado: "sin" }), ["l2"]);
  assert.deepEqual(ids({ asignado: "u1" }), ["l1"]);
  assert.deepEqual(ids({ fuente: "Sitio web" }), ["l2"]);
  assert.deepEqual(ids({ texto: "sofia" }), ["l1"], "sin tildes");
  assert.deepEqual(ids({ texto: "98765" }), ["l2"], "por teléfono");
  assert.deepEqual(ids({ atencion: "porAtender" }), ["l1"]);
  assert.deepEqual(ids({ atencion: "sinProxima" }), ["l1"]);
  assert.deepEqual(ids({ etapa: "contactado" }), ["l2"]);
});

test("Orden de la lista", () => {
  const a = fila({ lead: { id: "a", creado_en: "2026-10-20T00:00:00Z", etapa_desde: "2026-10-10T00:00:00Z" } });
  const b = fila({ lead: { id: "b", creado_en: "2026-10-22T00:00:00Z", etapa_desde: "2026-10-22T00:00:00Z" }, cliente: { nombre: "Ana" } });
  const ids = (o) => ordenarFilas([a, b], o).map((r) => r.id);
  assert.deepEqual(ids("recientes"), ["b", "a"]);
  assert.deepEqual(ids("antiguos"), ["a", "b"]);
  assert.deepEqual(ids("detenidos"), ["a", "b"]);
  assert.deepEqual(ids("cliente"), ["b", "a"]);
});

test("CSV: separador «;», comillas y sin fórmulas", () => {
  assert.equal(celdaCsv('Dijo "hola"; chao'), '"Dijo ""hola""; chao"');
  assert.equal(celdaCsv("=SUMA(A1)"), "'=SUMA(A1)");
  assert.equal(celdaCsv("-5"), "-5");
  assert.equal(celdaCsv(null), "");
  const csv = filasACsv([fila({ cliente: { nombre: "=cmd" } })]);
  const [cab, dato] = csv.split("\r\n");
  assert.ok(cab.startsWith("Cliente;Teléfono;Correo;Tipo;Etapa"));
  assert.ok(dato.startsWith("'=cmd;912345678"));
});
