import { test } from "node:test";
import assert from "node:assert/strict";
import { contratoConsignacion, fechaEnLetras, venceContrato } from "../supabase/functions/api/contrato-consignacion-core.js";
import { buildContratoConsignacionPdf } from "../src/pdf-report.js";

const fmt = (n) => `$${Number(n).toLocaleString("es-CL")}`;
const DATOS = {
  fecha: "2026-10-29", local: { nombre: "Casa matriz", direccion: "Av. Vitacura 1234, Vitacura" }, ejecutivo: "Eva Uno",
  dueno: { nombre: "Ana Pérez Soto", rut: "12.345.678-5", telefono: "+56912345678", email: "ana@correo.cl", direccion: "Los Leones 100, Providencia", banco: "BancoEstado", tipo_cuenta: "Cuenta vista", numero_cuenta: "12345678" },
  vehiculo: { patente: "LDRT75", marca: "Mini", modelo: "Cooper", anio: 2020, km: 50000, color: "Rojo" },
  precio_piso: 8100000, precio_publicacion: 9100000, plazo_dias: 60, notas: "Llaves en el local",
};

test("Contrato de consignación: fechas en letras y vencimiento", () => {
  assert.equal(fechaEnLetras("2026-10-29"), "29 de octubre de 2026");
  assert.equal(fechaEnLetras(""), "");
  assert.equal(venceContrato("2026-10-29", 60), "2026-12-28");
});

test("Contrato de consignación: trae los datos del dueño, el vehículo, los precios, el plazo y la cuenta", () => {
  const c = contratoConsignacion(DATOS, fmt);
  assert.match(c.partes, /Ana Pérez Soto.*12\.345\.678-5.*Los Leones 100/);
  assert.match(c.partes, /Casa matriz/);
  assert.equal(c.vence, "2026-12-28");
  const texto = c.clausulas.map((x) => x.texto).join(" ");
  assert.match(texto, /Mini Cooper.*patente LDRT75/);
  assert.match(texto, /precio piso es de \$8\.100\.000/);
  assert.match(texto, /precio de publicación es de \$9\.100\.000/);
  assert.match(texto, /60 días.*28 de diciembre de 2026/);
  assert.match(texto, /Cuenta vista N° 12345678 del banco BancoEstado/);
  assert.equal(c.clausulas[c.clausulas.length - 1].titulo, "OBSERVACIONES");
});

test("Contrato de consignación: el PDF se genera con la hoja de firmas", () => {
  const pdf = buildContratoConsignacionPdf(DATOS, { fmt });
  assert.ok(pdf.length > 3000);
  assert.equal(String.fromCharCode(...pdf.slice(0, 5)), "%PDF-");
});
