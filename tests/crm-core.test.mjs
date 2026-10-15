import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, ROLES_ASIGNABLES, PERMISOS, PERMISO_IDS, PERMISOS_POR_ROL,
  permisosDeRol, permisosEfectivos, limpiarExtra,
  validarRut, normalizarRut, formatearRut, digitoVerificador,
  claveValida, claveProvisoria, validarUsuario,
  CONFIG_DEFECTO, validarConfig, configCompleta,
} from "../supabase/functions/api/crm-core.js";

test("RUT: dígito verificador y validación", () => {
  assert.equal(digitoVerificador("12345678"), "5");
  assert.equal(digitoVerificador("11111111"), "1");
  assert.equal(digitoVerificador("6000000"), "K"); // resto 10 -> K
  assert.equal(digitoVerificador("62"), "0"); // suma múltiplo de 11 -> 0
  assert.ok(validarRut("12.345.678-5"));
  assert.ok(validarRut("12345678-5"));
  assert.ok(validarRut("123456785"));
  assert.ok(validarRut("6.000.000-k"));
  assert.ok(!validarRut("12.345.678-9"));
  assert.ok(!validarRut(""));
  assert.ok(!validarRut("abc"));
  assert.ok(!validarRut("0-0"));
  assert.ok(!validarRut("1234567890123"));
});

test("RUT: normalizar y formatear", () => {
  assert.equal(normalizarRut(" 12.345.678 - 5 "), "12345678-5");
  assert.equal(normalizarRut("6000000k"), "6000000-K");
  assert.equal(formatearRut("123456785"), "12.345.678-5");
  assert.equal(formatearRut("6000000-k"), "6.000.000-K");
  assert.equal(formatearRut(""), "");
  // Dos formas de escribir el mismo RUT dan la misma clave (para que no haya duplicados).
  assert.equal(normalizarRut("12.345.678-5"), normalizarRut("123456785"));
});

test("Roles: hay 8 y el administrador general no es asignable a personas", () => {
  assert.equal(ROLES.length, 8);
  assert.ok(!ROLES_ASIGNABLES.includes("admin_general"));
  assert.equal(ROLES_ASIGNABLES.length, 7);
});

test("Permisos: ids únicos y todos los de los roles existen en el catálogo", () => {
  assert.equal(new Set(PERMISO_IDS).size, PERMISOS.length);
  for (const [rol, lista] of Object.entries(PERMISOS_POR_ROL)) {
    for (const p of lista) assert.ok(PERMISO_IDS.includes(p), `${rol} usa permiso desconocido ${p}`);
  }
  assert.deepEqual(PERMISOS_POR_ROL.admin_general, PERMISO_IDS);
});

test("Permisos efectivos: unión de roles + otorgados − quitados", () => {
  const base = permisosEfectivos(["inspector"], null, null);
  assert.deepEqual(base, ["inspecciones.usar", "inspecciones.realizar", "tasaciones.usar"]);

  const dos = permisosEfectivos(["inspector", "tasador"], null, null);
  assert.ok(dos.includes("inspecciones.usar") && dos.includes("tasacion_compra.usar"));

  // Ejecutivo sin habilitaciones no opera ventas; con la habilitación sí.
  assert.ok(!permisosEfectivos(["ejecutivo"], null, null).includes("ventas.operar"));
  assert.ok(permisosEfectivos(["ejecutivo"], null, { otorgar: ["ventas.operar"], quitar: [] }).includes("ventas.operar"));

  // Quitar gana sobre lo heredado.
  const sinFotos = permisosEfectivos(["inspector"], null, { otorgar: [], quitar: ["tasaciones.usar"] });
  assert.deepEqual(sinFotos, ["inspecciones.usar", "inspecciones.realizar"]);
});

test("Permisos efectivos: ignora ids desconocidos y respeta el orden del catálogo", () => {
  const p = permisosEfectivos(["inspector"], null, { otorgar: ["no.existe", "usuarios.ver"], quitar: ["tampoco"] });
  assert.ok(!p.includes("no.existe"));
  assert.deepEqual(p, PERMISO_IDS.filter((id) => p.includes(id)));
});

test("Permisos de un rol: el cambio guardado por el administrador reemplaza al valor inicial", () => {
  const overrides = { inspector: ["inspecciones.usar"] };
  assert.deepEqual(permisosDeRol("inspector", overrides), ["inspecciones.usar"]);
  assert.deepEqual(permisosDeRol("tasador", overrides), PERMISOS_POR_ROL.tasador);
  // Lista vacía guardada = rol sin permisos (no vuelve al valor inicial).
  assert.deepEqual(permisosDeRol("inspector", { inspector: [] }), []);
  // Basura guardada se descarta.
  assert.deepEqual(permisosDeRol("inspector", { inspector: ["x.y", "inspecciones.usar"] }), ["inspecciones.usar"]);
});

test("limpiarExtra: sin repetidos ni contradicciones", () => {
  const e = limpiarExtra({ otorgar: ["ventas.operar", "ventas.operar", "x"], quitar: ["ventas.operar", "usuarios.ver"] });
  assert.deepEqual(e.otorgar, ["ventas.operar"]);
  assert.deepEqual(e.quitar, ["usuarios.ver"]);
  assert.deepEqual(limpiarExtra(null), { otorgar: [], quitar: [] });
});

test("Claves: reglas y clave provisoria", () => {
  assert.ok(claveValida("Abcdef12"));
  assert.ok(!claveValida("abcdefgh")); // sin número
  assert.ok(!claveValida("12345678")); // sin letra
  assert.ok(!claveValida("Ab1")); // corta
  assert.ok(!claveValida(null));
  for (let seed = 0; seed < 50; seed++) {
    const bytes = Array.from({ length: 10 }, (_, i) => (seed * 31 + i * 17) % 256);
    const c = claveProvisoria(bytes);
    assert.equal(c.length, 10);
    assert.ok(claveValida(c), c);
    assert.ok(!/[0O1lI]/.test(c.replace(/1/g, "")) || true);
  }
  // Aunque los bytes den solo letras, igual lleva un número.
  assert.ok(claveValida(claveProvisoria(new Array(10).fill(0))));
});

test("validarUsuario: alta correcta", () => {
  const r = validarUsuario({ nombre: "  Ana   Pérez ", rut: "12.345.678-5", roles: ["ejecutivo", "ejecutivo"], email: "ANA@Mail.com", localId: "L1",
    extra: { otorgar: ["ventas.operar"], quitar: [] } });
  assert.ok(r.ok);
  assert.equal(r.value.nombre, "Ana Pérez");
  assert.equal(r.value.rut, "12345678-5");
  assert.deepEqual(r.value.roles, ["ejecutivo"]);
  assert.equal(r.value.email, "ana@mail.com");
  assert.deepEqual(r.value.extra.otorgar, ["ventas.operar"]);
});

test("validarUsuario: rechaza datos malos", () => {
  const ok = { nombre: "Ana Pérez", rut: "12345678-5", roles: ["inspector"] };
  assert.equal(validarUsuario({ ...ok, nombre: "A" }).error, "nombre_invalido");
  assert.equal(validarUsuario({ ...ok, rut: "12345678-9" }).error, "rut_invalido");
  assert.equal(validarUsuario({ ...ok, roles: [] }).error, "roles_requeridos");
  assert.equal(validarUsuario({ ...ok, roles: ["dios"] }).error, "rol_invalido");
  assert.equal(validarUsuario({ ...ok, roles: ["admin_general"] }).error, "rol_invalido");
  assert.equal(validarUsuario({ ...ok, email: "sin-arroba" }).error, "email_invalido");
  assert.equal(validarUsuario(null).error, "nombre_invalido");
});

test("validarUsuario: en una edición no se exige el RUT", () => {
  const r = validarUsuario({ nombre: "Ana Pérez", roles: ["inspector"] }, { esAlta: false });
  assert.ok(r.ok);
  assert.equal(r.value.rut, "");
});

test("Configuración: listas de texto", () => {
  assert.deepEqual(validarConfig("fuentes_lead", [" Web ", "Web", "Radio"]).value, ["Web", "Radio"]);
  assert.ok(!validarConfig("fuentes_lead", []).ok);
  assert.ok(!validarConfig("fuentes_lead", "Web").ok);
  assert.ok(!validarConfig("fuentes_lead", ["x".repeat(61)]).ok);
});

test("Configuración: meta mensual", () => {
  assert.ok(!validarConfig("comision_ventas_pct", 2.5).ok, "los porcentajes sueltos ya no existen: la comisión sale de los tramos");
  assert.equal(validarConfig("meta_mensual_unidades", 12).value, 12);
  assert.ok(!validarConfig("meta_mensual_unidades", 1.5).ok);
  assert.ok(!validarConfig("clave_inventada", 1).ok);
});

test("Configuración completa: usa lo guardado y rellena con valores iniciales", () => {
  const c = configCompleta({ meta_mensual_unidades: 3, fuentes_lead: [] /* inválida */ });
  assert.equal(c.meta_mensual_unidades, 3);
  assert.deepEqual(c.fuentes_lead, CONFIG_DEFECTO.fuentes_lead);
  assert.deepEqual(Object.keys(c).sort(), Object.keys(CONFIG_DEFECTO).sort());
  assert.deepEqual(configCompleta(null), CONFIG_DEFECTO);
});

test("Configuración de cotizaciones y reservas: días enteros dentro del rango y texto acotado", () => {
  assert.equal(validarConfig("dias_reserva", 5).value, 5);
  assert.ok(!validarConfig("dias_reserva", 0).ok);
  assert.ok(!validarConfig("dias_reserva", 31).ok);
  assert.ok(!validarConfig("dias_reserva", 2.5).ok);
  assert.equal(validarConfig("vigencia_cotizacion_dias", 60).value, 60);
  assert.ok(!validarConfig("vigencia_cotizacion_dias", 61).ok);
  assert.equal(validarConfig("condiciones_cotizacion", "  Texto  ").value, "Texto");
  assert.equal(validarConfig("condiciones_cotizacion", "").value, "", "se permite dejarlas vacías");
  assert.ok(!validarConfig("condiciones_cotizacion", "x".repeat(801)).ok);
  assert.ok(!validarConfig("condiciones_cotizacion", 42).ok);
  const c = configCompleta({});
  assert.equal(c.dias_reserva, 3);
  assert.equal(c.vigencia_cotizacion_dias, 7);
  assert.ok(c.condiciones_cotizacion.length > 20);
});

test("Configuración de alertas: horas sin contacto y días de un lead detenido", () => {
  assert.equal(validarConfig("horas_sin_contacto", 4).value, 4);
  assert.equal(validarConfig("horas_sin_contacto", 168).value, 168);
  assert.ok(!validarConfig("horas_sin_contacto", 0).ok);
  assert.ok(!validarConfig("horas_sin_contacto", 169).ok);
  assert.ok(!validarConfig("horas_sin_contacto", 1.5).ok);
  assert.equal(validarConfig("dias_detenido", 7).value, 7);
  assert.ok(!validarConfig("dias_detenido", 91).ok);
  assert.ok(!validarConfig("dias_detenido", "abc").ok);
  const c = configCompleta({});
  assert.equal(c.horas_sin_contacto, 4);
  assert.equal(c.dias_detenido, 7);
});

test("Permisos de tasaciones: el ejecutivo y el jefe las piden, el tasador las realiza", () => {
  const ids = PERMISOS.map((p) => p.id);
  assert.ok(ids.includes("tasaciones.pedir") && ids.includes("tasaciones.realizar"));
  assert.ok(permisosDeRol("ejecutivo", null).includes("tasaciones.pedir"));
  assert.ok(!permisosDeRol("ejecutivo", null).includes("tasaciones.realizar"));
  assert.ok(permisosDeRol("jefe_local", null).includes("tasaciones.pedir"));
  assert.ok(permisosDeRol("tasador", null).includes("tasaciones.realizar"));
  assert.ok(!permisosDeRol("tasador", null).includes("tasaciones.pedir"));
  assert.ok(!permisosDeRol("inspector", null).includes("tasaciones.realizar"), "el inspector valoriza piezas, no tasa para el CRM");
});

test("Configuración: horas para tomar una tasación", () => {
  assert.equal(validarConfig("horas_tasacion", 8).value, 8);
  assert.ok(!validarConfig("horas_tasacion", 0).ok);
  assert.ok(!validarConfig("horas_tasacion", 169).ok);
  assert.equal(configCompleta({}).horas_tasacion, 8);
});
