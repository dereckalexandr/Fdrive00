// Catálogo de autos para Meta: qué autos entran, columnas del formato de vehículos y de productos, CSV y las direcciones públicas
// (catálogo y fotos) contra la función real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { revisarParaCatalogo, transmisionMeta, combustibleMeta, filaVehiculoMeta, filaProductoMeta, aCsv, armarCatalogo } from "../supabase/functions/api/catalogo-core.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, manejar, entorno } from "./helpers/api-env.mjs";

const AUTO = { id: "11111111-2222-3333-4444-555555555555", marca: "Hyundai", modelo: "Tucson", version: "GL 2.0", anio: 2022, km: 48500, color: "Blanco", transmision: "Automática", combustible: "Bencina", precio_lista: 17990000, estado: "disponible", activo: true, fotos: ["f1", "f2"], patente: "ABCD12" };
const opc = { urlSitio: "https://sitio.cl", urlFoto: (v, f) => `https://api.cl?vfoto=${v}&f=${f}`, empresa: { razon_social: "Empresa SpA", domicilio: "Pericles 897", comuna: "Las Condes", region: "Metropolitana" } };

test("Qué autos entran: disponibles con precio, foto y datos; los demás con su motivo", () => {
  assert.deepEqual(revisarParaCatalogo(AUTO), { ok: true });
  assert.equal(revisarParaCatalogo({ ...AUTO, estado: "reservado" }).motivo, "Reservado");
  assert.equal(revisarParaCatalogo({ ...AUTO, estado: "preparacion" }).motivo, "En preparación");
  assert.equal(revisarParaCatalogo({ ...AUTO, precio_lista: 0 }).motivo, "Sin precio de lista");
  assert.equal(revisarParaCatalogo({ ...AUTO, fotos: [] }).motivo, "Sin fotos");
  assert.equal(revisarParaCatalogo({ ...AUTO, activo: false }).motivo, "Archivado");
  assert.deepEqual([transmisionMeta("Automática"), transmisionMeta("Mecánica"), transmisionMeta("")], ["AUTOMATIC", "MANUAL", "OTHER"]);
  assert.deepEqual([combustibleMeta("Bencina"), combustibleMeta("Diésel"), combustibleMeta("Híbrido"), combustibleMeta("Eléctrico")], ["GASOLINE", "DIESEL", "HYBRID", "ELECTRIC"]);
});

test("Formato de vehículos de Meta y de productos; CSV con comillas cuando hace falta", () => {
  const v = filaVehiculoMeta(AUTO, opc);
  assert.equal(v.vehicle_id, AUTO.id);
  assert.equal(v.title, "Hyundai Tucson GL 2.0 2022");
  assert.equal(v.url, `https://sitio.cl/vehiculo/${AUTO.id}`);
  assert.deepEqual([v["mileage.value"], v["mileage.unit"], v.price, v.state_of_vehicle, v.transmission, v.fuel_type], ["48500", "KM", "17990000 CLP", "USED", "AUTOMATIC", "GASOLINE"]);
  assert.equal(v["image[1].url"], `https://api.cl?vfoto=${AUTO.id}&f=f2`);
  assert.deepEqual([v["address.addr1"], v["address.city"], v["address.country"], v.dealer_name], ["Pericles 897", "Las Condes", "CL", "Empresa SpA"]);
  assert.match(v.description, /48\.500 km · Automática · Bencina/);
  const conAviso = filaVehiculoMeta(AUTO, { ...opc, aviso: { titulo: "Tucson impecable", descripcion: "Único dueño, mantenciones al día" } });
  assert.deepEqual([conAviso.title, conAviso.description], ["Tucson impecable", "Único dueño, mantenciones al día"]);
  const p = filaProductoMeta(AUTO, opc);
  assert.deepEqual([p.availability, p.condition, p.brand, p.image_link, p.additional_image_link], ["in stock", "used", "Hyundai", `https://api.cl?vfoto=${AUTO.id}&f=f1`, `https://api.cl?vfoto=${AUTO.id}&f=f2`]);
  const csv = aCsv([{ a: "x", b: 'dice "hola", chao' }, { a: "y", c: "z" }]);
  assert.equal(csv, 'a,b,c\nx,"dice ""hola"", chao",\ny,,z');
  const c = armarCatalogo([AUTO, { ...AUTO, id: "otro", fotos: [] }], "meta-vehiculos", opc);
  assert.equal(c.incluidos, 1);
  assert.deepEqual(c.excluidos.map((x) => x.motivo), ["Sin fotos"]);
  assert.ok(c.csv.split("\n")[0].startsWith("vehicle_id,title,description,url,make,model,year"));
});

let admin; let L1; let anun; let V1; let V2;
const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const get = async (q) => { const r = await manejar(new Request(`http://x/api?${q}`, { method: "GET" })); return { status: r.status, tipo: r.headers.get("content-type"), texto: r.status === 200 && !String(r.headers.get("content-type")).startsWith("image/") ? await r.text() : null, bytes: String(r.headers.get("content-type")).startsWith("image/") ? new Uint8Array(await r.arrayBuffer()) : null }; };
before(async () => {
  await iniciarFuncion();
  entorno.SITIO_URL = "https://fdrive02.vercel.app";
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crm(admin, "usuarios.create", { datos: { nombre: "Ana Anunciante", rut: "11.111.111-1", roles: ["anunciante"], localId: L1 }, clave: "Prueba12345" });
  nuevaIp();
  anun = (await api({ action: "userLogin", rut: "11.111.111-1", password: "Prueba12345" })).token;
  V1 = randomUUID(); V2 = randomUUID();
  db.tablas.vehiculos.push({ ...AUTO, id: V1, local_id: L1, costo: 15000000, fotos: ["fotoA1"] }, { ...AUTO, id: V2, local_id: L1, estado: "reservado", fotos: ["fotoB1"], patente: "WXYZ99" });
  db.tablas.kv_store.push({ key: `vfoto::${V1}::fotoA1`, value: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}` });
  db.tablas.kv_store.push({ key: `vfoto::${V2}::fotoB1`, value: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8]).toString("base64")}` });
  db.tablas.anuncios.push({ id: randomUUID(), vehiculo_id: V1, titulo: "Hyundai Tucson 2022 impecable", descripcion: "Único dueño", estado: "publicado" });
});

test("Direcciones públicas: el catálogo trae solo los disponibles y sin costos; las fotos solo de autos visibles", async () => {
  const c = await get("catalogo=meta-vehiculos");
  assert.equal(c.status, 200);
  assert.match(c.tipo, /text\/csv/);
  const lineas = c.texto.split("\n");
  assert.equal(lineas.length, 2, "encabezado + 1 auto (el reservado no entra)");
  assert.match(lineas[1], /Hyundai Tucson 2022 impecable/);
  assert.match(lineas[1], new RegExp(`https://fdrive02\\.vercel\\.app/vehiculo/${V1}`));
  assert.ok(!c.texto.includes("15000000"), "sin el costo");
  assert.equal((await get("catalogo=meta-productos")).status, 200);
  assert.equal((await get("catalogo=google")).status, 404);
  const f = await get(`vfoto=${V1}&f=fotoA1`);
  assert.equal(f.status, 200);
  assert.equal(f.tipo, "image/jpeg");
  assert.deepEqual([...f.bytes], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal((await get(`vfoto=${V1}&f=otra`)).status, 404);
  assert.equal((await get(`vfoto=no-es-id&f=fotoA1`)).status, 404);
  // Un auto vendido deja de mostrar sus fotos.
  db.tablas.vehiculos.find((v) => v.id === V1).estado = "vendido";
  assert.equal((await get(`vfoto=${V1}&f=fotoA1`)).status, 404);
  db.tablas.vehiculos.find((v) => v.id === V1).estado = "disponible";
});

test("Módulo Avisos: el estado del catálogo con sus direcciones y los autos que no entran", async () => {
  const r = await ve(anun, "anuncios.catalogo");
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.incluidos, 1);
  assert.deepEqual(r.excluidos.map((x) => x.motivo), ["Reservado"]);
  assert.match(r.formatos[0].url, /\?catalogo=meta-vehiculos$/);
  assert.equal(r.faltaDireccion, true);
});
