// Prospección en Chileautos: validación de los avisos copiados (sin datos personales), filtros, orden, mediana y conversión en lead.
import test from "node:test";
import assert from "node:assert/strict";
import {
  validarAviso, validarAvisos, validarEstadoProspecto, filtrarAvisos, medianaPrecio, diferenciaConMediana, marcaModeloDeTitulo, ESTADOS_PROSPECTO,
  vehiculoOfrecidoDeProspecto, notasLeadDeProspecto, MAX_AVISOS_POR_GUARDADO, ORDENES_PROSPECTO,
} from "../supabase/functions/api/prospectos-core.js";
import { validarVehiculoOfrecido } from "../supabase/functions/api/compras-core.js";
import { urlBusquedaProspeccion } from "../src/prospeccion-url.js";
import { buildChileautosUrl } from "../src/compra-calc.js";

const aviso = (extra = {}) => ({ id: "CL-AD-1234567", titulo: "2019 Toyota Yaris", version: "1.5 SE", transmision: "Automática", combustible: "Bencina", anio: 2019, km: 60000, precio: 8_500_000, destacado: false, vendedorTipo: "particular", vendedorNombre: "", condicion: "", href: "/vehiculos/detalles/toyota-yaris-2019/CL-AD-1234567/?rankingType=Spot", ...extra });

test("Aviso: guarda lo del aviso, incluido el teléfono y nombre públicos del vendedor, y nada más (sin correo ni RUT)", () => {
  const v = validarAviso(aviso({ telefono: "+56 9 1111 2222", nombre: "Juan Pérez", email: "j@x.cl", vendedorNombre: "Juan Pérez (dueño)", rut: "1-9" }));
  assert.deepEqual(v, { aviso_id: "CL-AD-1234567", titulo: "2019 Toyota Yaris", version: "1.5 SE", anio: 2019, km: 60000, precio: 8_500_000, transmision: "Automática", combustible: "Bencina", vendedor_tipo: "particular", vendedor_nombre: "Juan Pérez (dueño)", vendedor_telefono: "+56911112222", destacado: false, href: "/vehiculos/detalles/toyota-yaris-2019/CL-AD-1234567/" });
  const txt = JSON.stringify(v);
  for (const dato of ["j@x.cl", "1-9"]) assert.ok(!txt.includes(dato), `no debe guardar «${dato}»`);
  assert.equal(validarAviso(aviso({ telefono: "9 8765 4321" })).vendedor_telefono, "+56987654321");
  assert.equal(validarAviso(aviso({ telefono: "56987654321" })).vendedor_telefono, "+56987654321");
  assert.equal(validarAviso(aviso({ telefono: "123" })).vendedor_telefono, null);
  assert.equal(validarAviso(aviso()).vendedor_telefono, null);
  // El nombre de una automotora (un negocio) sí se guarda.
  assert.equal(validarAviso(aviso({ vendedorTipo: "automotora", vendedorNombre: "Autos del Sur" })).vendedor_nombre, "Autos del Sur");
  assert.equal(validarAviso(aviso({ vendedorTipo: "otro" })).vendedor_tipo, null);
  assert.equal(validarAviso(aviso({ destacado: true })).destacado, true);
});

test("Aviso: se rechaza lo que no es de Chileautos o no trae precio; se limpian textos y números", () => {
  assert.equal(validarAviso(null), null);
  assert.equal(validarAviso(aviso({ id: "XX" })), null, "sin identificador de Chileautos");
  assert.equal(validarAviso(aviso({ href: "https://sitio-malo.cl/phishing" })), null, "enlace que no es de un aviso");
  assert.equal(validarAviso(aviso({ href: "/vehiculos/detalles/../../admin/CL-AD-1234567/" })), null);
  assert.equal(validarAviso(aviso({ precio: 0 })), null);
  assert.equal(validarAviso(aviso({ precio: "mucho" })), null);
  assert.equal(validarAviso(aviso({ id: "CL-AD-12" })), null);
  const v = validarAviso(aviso({ titulo: "  2019   Toyota\n Yaris " + "x".repeat(200), km: "60.000", precio: "$ 8.500.000", anio: 1800 }));
  assert.equal(v.titulo.length, 90);
  assert.match(v.titulo, /^2019 Toyota Yaris x/);
  assert.equal(v.km, 60000);
  assert.equal(v.precio, 8_500_000);
  assert.equal(v.anio, null, "un año imposible no se guarda");
  assert.equal(validarAviso(aviso({ href: "/vehiculos/detalles/toyota-yaris-2019/CL-AD-1234567" })).href, "/vehiculos/detalles/toyota-yaris-2019/CL-AD-1234567/");
});

test("Lista de avisos: sin repetidos, hasta 100 por vez, y dice cuántos se descartaron", () => {
  const r = validarAvisos([aviso(), aviso(), aviso({ id: "CL-AD-7654321", href: "/vehiculos/detalles/kia-rio/CL-AD-7654321/" }), { basura: true }]);
  assert.equal(r.ok, true);
  assert.equal(r.value.length, 2);
  assert.equal(r.descartados, 2);
  assert.equal(validarAvisos([]).error, "avisos_invalidos");
  assert.equal(validarAvisos("hola").error, "avisos_invalidos");
  assert.equal(validarAvisos([{ x: 1 }]).error, "avisos_invalidos");
  const muchos = Array.from({ length: 150 }, (_, i) => aviso({ id: `CL-AD-${1000000 + i}`, href: `/vehiculos/detalles/auto-${i}/CL-AD-${1000000 + i}/` }));
  const m = validarAvisos(muchos);
  assert.equal(m.value.length, MAX_AVISOS_POR_GUARDADO);
  assert.equal(m.descartados, 50);
});

test("Estado del prospecto: los de la lista; «convertido» solo lo pone la conversión; las notas se limpian", () => {
  assert.deepEqual(ESTADOS_PROSPECTO.map((e) => e.id), ["nuevo", "contactado", "respondio", "descartado", "convertido"]);
  assert.deepEqual(validarEstadoProspecto({ estado: "contactado", notas: "  Le escribí  por Chileautos " }).value, { estado: "contactado", notas: "Le escribí por Chileautos" });
  assert.deepEqual(validarEstadoProspecto({ estado: "descartado" }).value, { estado: "descartado" });
  assert.equal(validarEstadoProspecto({ estado: "descartado", notas: "" }).value.notas, null);
  assert.equal(validarEstadoProspecto({ estado: "convertido" }).error, "estado_invalido");
  assert.equal(validarEstadoProspecto({ estado: "otro" }).error, "estado_invalido");
  assert.equal(validarEstadoProspecto({ estado: "nuevo", notas: "x".repeat(900) }).value.notas.length, 500);
});

const LISTA = [
  aviso({ id: "A1", titulo: "2019 Toyota Yaris", precio: 8_000_000, km: 60000, anio: 2019 }),
  aviso({ id: "A2", titulo: "2018 Toyota Yaris", version: "1.5 XS", precio: 7_000_000, km: 90000, anio: 2018, transmision: "Manual" }),
  aviso({ id: "A3", titulo: "2021 Toyota Yaris", precio: 10_000_000, km: 20000, anio: 2021, vendedorTipo: "automotora", vendedorNombre: "Autos del Sur", destacado: true }),
  aviso({ id: "A4", titulo: "2020 Toyota Yaris Sport", precio: 9_000_000, km: 40000, anio: 2020, combustible: "Diésel" }),
  aviso({ id: "A5", titulo: "2017 Toyota Yaris", precio: 6_000_000, km: 120000, anio: 2017 }),
];

test("Filtros de la lista: precio, año, kilometraje, vendedor, transmisión, combustible, texto y avisos pagados", () => {
  const f = (filtros) => filtrarAvisos(LISTA, filtros).map((a) => a.id);
  assert.deepEqual(f({ vendedor: "particular" }), ["A5", "A2", "A1", "A4"]);
  assert.deepEqual(f({ vendedor: "automotora" }), ["A3"]);
  assert.deepEqual(f({ precioMin: "7.000.000", precioMax: 9_000_000 }), ["A2", "A1", "A4"]);
  assert.deepEqual(f({ anioDesde: 2019, anioHasta: 2020 }), ["A1", "A4"]);
  assert.deepEqual(f({ kmMax: 60000 }), ["A1", "A4", "A3"]);
  assert.deepEqual(f({ transmision: "manual" }), ["A2"]);
  assert.deepEqual(f({ combustible: "diesel" }), ["A4"], "«diesel» encuentra «Diésel»");
  assert.deepEqual(f({ texto: "sport" }), ["A4"]);
  assert.deepEqual(f({ texto: "xs" }), ["A2"], "también busca en la versión");
  assert.deepEqual(f({ sinDestacados: true }), ["A5", "A2", "A1", "A4"]);
  assert.deepEqual(f({ precioMax: "nueve" }), ["A5", "A2", "A1", "A4", "A3"], "un filtro que no es número se ignora");
  assert.deepEqual(f({}), ["A5", "A2", "A1", "A4", "A3"], "por defecto, del más barato al más caro");
  assert.deepEqual(filtrarAvisos([], {}), []);
  assert.deepEqual(filtrarAvisos(null, null), []);
});

test("Orden y comparación con el promedio: la mediana del conjunto que se ve y quién está más barato", () => {
  assert.equal(medianaPrecio(LISTA), 8_000_000);
  assert.equal(medianaPrecio([{ precio: 1 }, { precio: 3 }]), 2);
  assert.equal(medianaPrecio([]), 0);
  assert.equal(diferenciaConMediana(7_000_000, 8_000_000), -12, "12,5 % más barato, redondeado");
  assert.equal(diferenciaConMediana(0, 8_000_000), 0);
  const por = (orden) => filtrarAvisos(LISTA, { orden }).map((a) => a.id);
  assert.deepEqual(por("precio_desc"), ["A3", "A4", "A1", "A2", "A5"]);
  assert.deepEqual(por("anio_desc"), ["A3", "A4", "A1", "A2", "A5"]);
  assert.deepEqual(por("km_asc"), ["A3", "A4", "A1", "A2", "A5"]);
  assert.deepEqual(por("bajo_mediana"), ["A5", "A2", "A1", "A4", "A3"]);
  assert.deepEqual(ORDENES_PROSPECTO.map((o) => o.id), ["precio_asc", "precio_desc", "anio_desc", "km_asc", "bajo_mediana"]);
  // La diferencia se calcula sobre lo que se ve: al filtrar, la mediana cambia.
  const particulares = filtrarAvisos(LISTA, { vendedor: "particular", orden: "bajo_mediana" });
  assert.equal(particulares[0].id, "A5");
  assert.equal(particulares[0].vsMediana, Math.round(((6_000_000 - 7_500_000) / 7_500_000) * 100));
  // Acepta las dos formas de los datos: los del marcador (vendedorTipo) y los guardados (vendedor_tipo).
  assert.deepEqual(filtrarAvisos([{ id: "G1", titulo: "x", precio: 5, vendedor_tipo: "particular" }, { id: "G2", titulo: "y", precio: 6, vendedor_tipo: "automotora" }], { vendedor: "particular" }).map((a) => a.id), ["G1"]);
});

test("Marca y modelo sugeridos desde el título del aviso", () => {
  assert.deepEqual(marcaModeloDeTitulo("2019 Toyota Yaris"), { marca: "Toyota", modelo: "Yaris" });
  assert.deepEqual(marcaModeloDeTitulo("2020 Mini Cooper D HB"), { marca: "Mini", modelo: "Cooper D HB" });
  assert.deepEqual(marcaModeloDeTitulo("2018 Great Wall Wingle 5"), { marca: "Great Wall", modelo: "Wingle 5" });
  assert.deepEqual(marcaModeloDeTitulo("2017 Land Rover Defender"), { marca: "Land Rover", modelo: "Defender" });
  assert.deepEqual(marcaModeloDeTitulo("Kia"), { marca: "Kia", modelo: "" });
  assert.deepEqual(marcaModeloDeTitulo(""), { marca: "", modelo: "" });
});

test("Conversión en lead: el auto del aviso con los nombres de un lead de compra, y las notas con el enlace y el precio", () => {
  const p = { ...validarAviso(aviso({ transmision: "Manual", combustible: "Diesel" })), id: "p1" };
  const v = vehiculoOfrecidoDeProspecto(p, { patente: " abcd12 ", marca: "Toyota", modelo: "Yaris" });
  assert.deepEqual(v, { patente: "abcd12", marca: "Toyota", modelo: "Yaris", version: "1.5 SE", anio: 2019, km: 60000, transmision: "Mecánica", combustible: "Diesel", precioEsperado: 8_500_000 });
  // Lo que arma lo acepta el lead de compra (con la patente que entrega el dueño).
  assert.equal(validarVehiculoOfrecido(v).ok, true, JSON.stringify(validarVehiculoOfrecido(v)));
  assert.equal(validarVehiculoOfrecido({ ...v, patente: "" }).error, "patente_invalida", "sin patente no se puede crear el lead");
  assert.equal(vehiculoOfrecidoDeProspecto({ ...p, transmision: "Automática", combustible: "Híbrido" }, { patente: "AB1234", marca: "x", modelo: "y" }).transmision, "Automática");
  assert.equal(vehiculoOfrecidoDeProspecto({ ...p, transmision: "CVT", combustible: "Eléctrico" }, {}).transmision, "Automática");
  assert.equal(vehiculoOfrecidoDeProspecto({ ...p, transmision: null, combustible: "Gas" }, {}).transmision, undefined);
  assert.equal(vehiculoOfrecidoDeProspecto({ ...p, combustible: "Gas" }, {}).combustible, undefined);
  assert.equal(notasLeadDeProspecto(p), "Prospecto de Chileautos (particular): https://www.chileautos.cl/vehiculos/detalles/toyota-yaris-2019/CL-AD-1234567/ · precio publicado $8.500.000");
  assert.match(notasLeadDeProspecto({ ...p, vendedor_tipo: "automotora", vendedor_nombre: "Autos del Sur" }), /\(automotora Autos del Sur\)/);
});

test("Búsqueda en Chileautos: se arma con los criterios que el estimador ya verificó y la misma forma", () => {
  const r = urlBusquedaProspeccion({ marca: "Toyota", modelo: "Yaris", anioDesde: 2018, anioHasta: 2022, kmMax: 75000, transmision: "automatica", combustible: "bencina" });
  assert.equal(r.url, buildChileautosUrl({ marca: "Toyota", modelo: "Yaris", anio: 2020, km: 50000, margenAnio: 2, pctKm: 0.5, transmision: "automatica", combustible: "bencina" }), "idéntica a la del estimador para los mismos criterios");
  assert.equal(r.resumen, "Toyota Yaris · año 2018–2022 · hasta 75.000 km · Automática · Bencina");
  assert.match(urlBusquedaProspeccion({ marca: "Toyota" }).url, /^https:\/\/www\.chileautos\.cl\/vehiculos\/\?q=\(And\.\(C\.Marca\.Toyota\.\)_\.Ano\.range\(1990\.\.\d{4}\)\.\)&sort=~Price$/);
  assert.match(urlBusquedaProspeccion({ anioDesde: 2019, kmMax: 60000 }).url, /\(And\.Ano\.range\(2019\.\.\d{4}\)\._\.Kilometraje\.range\(0\.\.60000\)\.\)/);
  assert.match(urlBusquedaProspeccion({ marca: "Kia", transmision: "manual", combustible: "diesel" }).url, /Transmisi%C3%B3n\.Manual\._\.Combustible\.Diesel/);
  assert.equal(urlBusquedaProspeccion({}), null, "sin filtros no hay nada que buscar");
  assert.equal(urlBusquedaProspeccion(null), null);
  assert.ok(!/modelo/i.test(urlBusquedaProspeccion({ modelo: "Yaris" }) ? "x" : "ok"), "el modelo sin marca no se usa");
});

test("Ficha pegada: exige aviso y teléfono válidos", async () => {
  const { parseFichaPegada } = await import("../supabase/functions/api/prospectos-core.js");
  assert.deepEqual(parseFichaPegada(JSON.stringify({ fuente: "chileautos-ficha", id: "CL-AD-20389479", telefono: "965730759" })), { ok: true, id: "CL-AD-20389479", telefono: "+56965730759" });
  assert.equal(parseFichaPegada("hola").ok, false);
  assert.equal(parseFichaPegada(JSON.stringify({ fuente: "chileautos-ficha", id: "", telefono: "965730759" })).ok, false);
  assert.match(parseFichaPegada(JSON.stringify({ fuente: "chileautos-ficha", id: "CL-AD-20389479", telefono: "" })).error, /Ver n° de teléfono/);
});

test("Cola de fichas: solo los que siguen en juego y aún sin teléfono, sin los saltados", async () => {
  const { pendientesDeTelefono } = await import("../supabase/functions/api/prospectos-core.js");
  const l = [{ id: "a", estado: "nuevo" }, { id: "b", estado: "nuevo", vendedor_telefono: "+56911111111" }, { id: "c", estado: "descartado" }, { id: "d", estado: "convertido" }, { id: "e", estado: "contactado" }];
  assert.deepEqual(pendientesDeTelefono(l).map((p) => p.id), ["a", "e"]);
  assert.deepEqual(pendientesDeTelefono(l, new Set(["a"])).map((p) => p.id), ["e"]);
  assert.deepEqual(pendientesDeTelefono(null), []);
});
