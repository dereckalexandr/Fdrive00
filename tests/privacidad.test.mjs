// Política de privacidad (/privacidad): el texto usa los datos de la empresa que edita el Administrador, y el sitio los obtiene sin sesión.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, loginAdmin, crm } from "./helpers/api-env.mjs";
import { seccionesPrivacidad, ACTUALIZADA } from "../src/privacidad-texto.js";
import { validarEmpresa } from "../supabase/functions/api/contrato-compraventa-core.js";

const DATOS = { razonSocial: "AUTOS DE PRUEBA SPA", rut: "77.123.456-9", domicilio: "Av. Siempre Viva 742", comuna: "Providencia", region: "Metropolitana", correo: "Contacto@AutosPrueba.cl" };
let admin;
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  await crm(admin, "locales.create", { nombre: "Casa matriz" });
});

test("Texto de la política: responsable, canales de contacto, derechos y cómo pedir la eliminación", () => {
  const s = seccionesPrivacidad({ sitio: "Autos Prueba", whatsapp: "56911112222", responsable: { razon_social: "AUTOS DE PRUEBA SPA", rut: "77.123.456-9", domicilio: "Av. Siempre Viva 742", comuna: "Providencia", region: "Metropolitana", correo: "contacto@autosprueba.cl" } });
  const todo = s.map((x) => [x.titulo, ...(x.parrafos || []), ...(x.lista || []), ...(x.parrafos2 || [])].join(" ")).join(" ");
  assert.match(todo, /AUTOS DE PRUEBA SPA, RUT 77\.123\.456-9, con domicilio en Av\. Siempre Viva 742, Providencia, Metropolitana/);
  assert.match(todo, /contacto@autosprueba\.cl/);
  assert.match(todo, /\+56911112222/);
  for (const t of ["Acceso", "Rectificación", "Supresión", "Oposición", "Portabilidad", "Bloqueo"]) assert.match(todo, new RegExp(t));
  assert.ok(s.some((x) => /Eliminación de tus datos/.test(x.titulo)), "Meta pide instrucciones para eliminar los datos");
  assert.match(todo, /WhatsApp/);
  assert.match(todo, new RegExp(ACTUALIZADA));

  // Sin datos de la empresa no quedan huecos: textos genéricos.
  const vacio = seccionesPrivacidad({}).map((x) => [...(x.parrafos || []), ...(x.lista || []), ...(x.parrafos2 || [])].join(" ")).join(" ");
  assert.match(vacio, /la empresa que opera nuestro sitio/);
  assert.match(vacio, /contactarnos en nuestro local/);
  assert.doesNotMatch(vacio, /undefined|null|RUT ,/);
});

test("Correo de contacto de la empresa: opcional, validado y en minúsculas", () => {
  assert.equal(validarEmpresa({ ...DATOS, correo: "" }).value.correo, "");
  assert.equal(validarEmpresa(DATOS).value.correo, "contacto@autosprueba.cl");
  assert.equal(validarEmpresa({ ...DATOS, correo: "no-es-correo" }).error, "correo_empresa_invalido");
});

test("El sitio obtiene los datos públicos del responsable sin iniciar sesión (sin el representante ni su RUT)", async () => {
  const antes = await api({ action: "public", op: "privacidad" });
  assert.equal(antes.status, 200, JSON.stringify(antes));
  assert.equal(antes.responsable.razon_social, "", "sin datos cargados: vacío, la página usa textos genéricos");

  const g = await api({ action: "ventas", token: admin, op: "empresa.save", datos: { ...DATOS, representante: "Ana Representante", rutRepresentante: "12.345.678-5", personeria: "escritura" } });
  assert.equal(g.status, 200, JSON.stringify(g));
  const r = await api({ action: "public", op: "privacidad" });
  assert.equal(r.responsable.razon_social, "AUTOS DE PRUEBA SPA");
  assert.equal(r.responsable.rut, "77.123.456-9");
  assert.equal(r.responsable.comuna, "Providencia");
  assert.equal(r.responsable.correo, "contacto@autosprueba.cl");
  assert.ok(r.sitio);
  assert.doesNotMatch(JSON.stringify(r), /Ana Representante|12\.345\.678-5|escritura/, "no expone datos del representante");
});
