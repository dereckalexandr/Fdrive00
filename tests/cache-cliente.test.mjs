import test from "node:test";
import assert from "node:assert/strict";
import {
  crearCache, estable, firma, claveDeCarga, esLecturaCacheable, conCache, limpiarTodo, cacheApi, cachePantallas,
  empezarAAprender, anotarLectura, lecturasAprendidas, olvidarAprendido, estaLista, esLecturaViva,
} from "../src/cache-cliente.js";

test.beforeEach(() => { limpiarTodo(); olvidarAprendido(); });

test("Qué es una lectura: las consultas sí; los cambios y lo que cambia solo, nunca", () => {
  for (const op of ["leads.list", "leads.get", "inventario.list", "catalogos", "gestion.resumen", "anuncios.cola", "cotizaciones.pendientes", "prospectos.lista", "gestion.embudo", "marketing.resultados", "usuarios.list"])
    assert.equal(esLecturaCacheable(op), true, op);
  // Cambios: tratarlos como lectura los dejaría sin ejecutar.
  for (const op of ["prospectos.estado", "leads.save", "leads.create", "tareas.hecha", "reservas.crear", "cierres.aprobar", "inventario.save", "marketing.ads.activar", "archivos.migrar", "leads.etapa"])
    assert.equal(esLecturaCacheable(op), false, op);
  // Datos vivos: nunca se guardan.
  for (const op of ["wa.lista", "wa.list", "wa.conversaciones.list", "wa.mensajes.list", "sistema.estado", "archivos.estado"]) assert.equal(esLecturaCacheable(op), false, op);
  assert.equal(esLecturaCacheable(undefined), false);
});

test("La firma no depende del orden de las llaves y distingue filtros distintos", () => {
  assert.equal(estable({ b: 1, a: [2, { d: 4, c: 3 }] }), estable({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.equal(firma("ventas", "leads.list", { todos: true, q: "a" }), firma("ventas", "leads.list", { q: "a", todos: true }));
  assert.notEqual(firma("ventas", "leads.list", { q: "a" }), firma("ventas", "leads.list", { q: "b" }));
  assert.notEqual(firma("ventas", "leads.list", {}), firma("crm", "leads.list", {}));
  assert.equal(firma("ventas", "x", undefined), firma("ventas", "x", {}));
  assert.equal(estable({ a: undefined, b: () => 1, c: 2 }), estable({ c: 2 }), "ignora lo que no viaja");
});

test("Clave de pantalla: mismo código y mismos filtros = misma clave; otro filtro u otro código = otra", () => {
  const api = () => {};
  const f1 = () => api("prospectos.lista", {});
  const f2 = () => api("leads.list", {});
  assert.equal(claveDeCarga(f1, [api, "nuevo", 3]), claveDeCarga(f1, [() => {}, "nuevo", 3]), "la función api no cuenta");
  assert.notEqual(claveDeCarga(f1, [api, "nuevo"]), claveDeCarga(f1, [api, "contactado"]));
  assert.notEqual(claveDeCarga(f1, [api]), claveDeCarga(f2, [api]));
});

test("Caché: guarda copias (nadie altera lo guardado), vence por edad y se limita por tamaño", () => {
  let t = 1000;
  const c = crearCache({ maxEdadMs: 100, max: 3, ahora: () => t });
  const original = { lista: [3, 1, 2] };
  c.set("a", original);
  original.lista.sort(); // alterar lo que se guardó no cambia la caché
  const g1 = c.get("a"); g1.valor.lista.push(99); // ni alterar lo que se entregó
  assert.deepEqual(c.get("a").valor, { lista: [3, 1, 2] });
  t += 50; assert.equal(c.get("a").edad, 50);
  t += 60; assert.equal(c.get("a"), null, "venció");
  for (const k of ["1", "2", "3", "4"]) c.set(k, k);
  assert.equal(c.tamano, 3);
  assert.equal(c.get("1"), null, "sale lo más antiguo");
  assert.equal(c.get("4").valor, "4");
});

test("Una lectura repetida no vuelve a la red, y quien la recibe puede modificarla sin afectar a los demás", async () => {
  let llamadas = 0;
  const pedir = async () => { llamadas++; return { leads: [{ id: 1 }, { id: 2 }] }; };
  const a = await conCache("ventas", "leads.list", { q: "x" }, pedir);
  a.leads.reverse();
  const b = await conCache("ventas", "leads.list", { q: "x" }, pedir);
  assert.equal(llamadas, 1);
  assert.deepEqual(b.leads.map((l) => l.id), [1, 2]);
  await conCache("ventas", "leads.list", { q: "otro" }, pedir);
  assert.equal(llamadas, 2, "otro filtro = otra consulta");
  assert.equal(estaLista("ventas", "leads.list", { q: "x" }), true);
});

test("Consultas iguales que salen a la vez se juntan en una sola", async () => {
  let llamadas = 0;
  const pedir = () => new Promise((r) => setTimeout(() => { llamadas++; r({ n: llamadas }); }, 20));
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => conCache("ventas", "inventario.list", {}, pedir)));
  assert.equal(llamadas, 1);
  assert.deepEqual([a.n, b.n, c.n], [1, 1, 1]);
  a.n = 99;
  assert.equal(b.n, 1, "cada quien recibe su copia");
});

test("Un cambio SIEMPRE se ejecuta (aunque se llame igual que una lectura) y borra todo lo guardado", async () => {
  let lecturas = 0, escrituras = 0;
  await conCache("ventas", "leads.list", {}, async () => { lecturas++; return { v: 1 }; });
  cachePantallas.set("pantalla", { dato: 1 });
  assert.deepEqual(await conCache("ventas", "prospectos.estado", { id: 1, estado: "x" }, async () => { escrituras++; return { ok: true }; }), { ok: true });
  await conCache("ventas", "prospectos.estado", { id: 1, estado: "x" }, async () => { escrituras++; return { ok: true }; });
  assert.equal(escrituras, 2, "se ejecutó las dos veces: nunca sale de la caché");
  assert.equal(cacheApi.tamano, 0);
  assert.equal(cachePantallas.tamano, 0);
  await conCache("ventas", "leads.list", {}, async () => { lecturas++; return { v: 2 }; });
  assert.equal(lecturas, 2, "después de un cambio se vuelve a pedir");
});

test("Un cambio fallido también borra la caché y el error llega a quien lo pidió", async () => {
  await conCache("ventas", "leads.list", {}, async () => ({ v: 1 }));
  await assert.rejects(() => conCache("ventas", "leads.save", {}, async () => { throw new Error("forbidden"); }), /forbidden/);
  assert.equal(cacheApi.tamano, 0);
});

test("Un error de lectura no se guarda: el siguiente intento vuelve a pedir", async () => {
  let n = 0;
  await assert.rejects(() => conCache("ventas", "leads.list", {}, async () => { n++; throw new Error("timeout"); }), /timeout/);
  const r = await conCache("ventas", "leads.list", {}, async () => { n++; return { ok: 1 }; });
  assert.equal(n, 2);
  assert.deepEqual(r, { ok: 1 });
});

test("Lecturas vivas (WhatsApp): nunca se guardan, pero tampoco vacían la caché (los sondeos no la borran)", async () => {
  let n = 0;
  await conCache("ventas", "leads.list", {}, async () => ({ v: 1 }));
  cachePantallas.set("pantalla", { dato: 1 });
  for (let i = 0; i < 3; i++) await conCache("ventas", "wa.list", {}, async () => ++n);
  await conCache("ventas", "wa.resumen", {}, async () => ++n);
  assert.equal(n, 4, "cada consulta viva va a la red");
  assert.equal(estaLista("ventas", "leads.list", {}), true, "lo guardado sigue ahí");
  assert.ok(cachePantallas.get("pantalla"));
  for (const op of ["wa.list", "wa.resumen", "wa.conversacion", "sistema.estado"]) assert.equal(esLecturaViva(op), true, op);
  // Enviar o guardar en WhatsApp SÍ es un cambio: vacía todo.
  for (const op of ["wa.enviar", "wa.leer", "wa.bot_guardar", "wa.plantilla_crear", "wa.etiquetas"]) assert.equal(esLecturaViva(op), false, op);
  await conCache("ventas", "wa.enviar", {}, async () => ({ ok: true }));
  assert.equal(estaLista("ventas", "leads.list", {}), false);
});

test("Aprender qué pide cada pestaña: anota las lecturas del primer instante y nada más", () => {
  const reloj = { fns: [], setTimeout(f) { this.fns.push(f); } };
  empezarAAprender("tabs:ventas", 1500, reloj);
  anotarLectura({ accion: "ventas", op: "leads.list", params: { todos: true } });
  anotarLectura({ accion: "ventas", op: "leads.list", params: { todos: true } }); // repetida: una sola vez
  anotarLectura({ accion: "ventas", op: "tareas.hecha", params: { id: 1 } }); // un cambio no se aprende
  anotarLectura({ accion: "ventas", op: "wa.lista", params: {} }); // lo vivo tampoco
  anotarLectura({ accion: "ventas", op: "catalogos", params: {} });
  reloj.fns[0](); // termina la ventana de aprendizaje
  const l = lecturasAprendidas("tabs:ventas");
  assert.deepEqual(l.map((x) => x.op), ["leads.list", "catalogos"]);
  anotarLectura({ accion: "ventas", op: "inventario.list", params: {} }); // fuera de la ventana: no se anota
  assert.equal(lecturasAprendidas("tabs:ventas").length, 2);
  assert.deepEqual(lecturasAprendidas("otra"), []);
});

test("Guarda contra «Illegal invocation»: el reloj por defecto no usa el setTimeout global como método de otro objeto", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/cache-cliente.js", import.meta.url), "utf8");
  assert.ok(!/reloj\s*=\s*\{\s*setTimeout\s*\}/.test(src), "en el navegador `{ setTimeout }.setTimeout(...)` lanza «Illegal invocation» y deja las pestañas sin navegar");
  assert.match(src, /reloj = \{ setTimeout: \(f, t\) => setTimeout\(f, t\) \}/);
});

test("Las lecturas con nombre propio son de verdad lecturas: ninguna escribe datos (si una llegara a escribir, la caché la dejaría sin ejecutar)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { LECTURAS_NOMBRADAS } = await import("../src/cache-cliente.js");
  const dir = new URL("../supabase/functions/api/", import.meta.url);
  const ESCRIBE = /\.(insert|update|upsert|delete)\(|guardarArchivo|borrarArchivo|audit\(|dbSet\(|migrarLote|crearValidacion|\.rpc\(/;
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(new URL(f, dir), "utf8").replace(/\r\n/g, "\n"));
  const problemas = [];
  for (const nombre of LECTURAS_NOMBRADAS) {
    let encontrada = false;
    for (const s of archivos) {
      const i = s.indexOf(`op === "${nombre}"`);
      if (i < 0) continue;
      encontrada = true;
      const resto = s.slice(i + 10);
      const sig = resto.search(/\n\s*(?:\}\s*)?if \((?:\[|op === ")/);
      const bloque = s.slice(i, i + 10 + (sig > 0 ? Math.min(sig, 3500) : 1500));
      const mala = bloque.split("\n").find((l) => ESCRIBE.test(l));
      if (mala) problemas.push(`${nombre}: ${mala.trim().slice(0, 100)}`);
    }
    if (!encontrada) problemas.push(`${nombre}: ya no existe en el servidor (quítala de LECTURAS_NOMBRADAS)`);
  }
  assert.deepEqual(problemas, []);
});

test("Las lecturas que antes vaciaban la caché ahora se reconocen (leads.hoy es la pantalla de entrada); los cambios parecidos, no", () => {
  for (const op of ["leads.hoy", "reservas.por_validar", "equipo.carga", "equipo.habilitaciones", "marketing.ads.estado", "marketing.leads.estado"]) assert.equal(esLecturaCacheable(op), true, op);
  for (const op of ["equipo.habilitar", "leads.create", "reservas.extender", "cierres.aprobar", "locales.update", "wa.plantilla_borrar", "wa.respuestas_guardar", "validacion.quitar", "marketing.ads.activar", "marketing.leads.reintentar"]) assert.equal(esLecturaCacheable(op), false, op);
});
