import test from "node:test";
import assert from "node:assert/strict";
import { photoKey, photoPrefix, makePhotoId, fitSize, collectPhotoIds, diffIds, MAX_PHOTOS_PER_ITEM } from "../src/photos.js";
import { isMeaningful } from "../src/drafts.js";

test("la clave de la foto vive bajo el prefijo del inspector", () => {
  assert.equal(photoKey("INSP1", "abc"), "foto::INSP1::abc");
  assert.ok(photoKey("INSP1", "abc").startsWith(photoPrefix("INSP1")));
  assert.ok(!photoKey("INSP2", "abc").startsWith(photoPrefix("INSP1")));
});

test("makePhotoId genera ids únicos, sin '::' ni mayúsculas", () => {
  const ids = new Set(Array.from({ length: 500 }, () => makePhotoId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[a-z0-9]+$/);
});

test("fitSize reduce al lado mayor y no agranda", () => {
  assert.deepEqual(fitSize(4000, 3000, 1280), { width: 1280, height: 960 });
  assert.deepEqual(fitSize(3000, 4000, 1280), { width: 960, height: 1280 });
  assert.deepEqual(fitSize(800, 600, 1280), { width: 800, height: 600 });
  assert.deepEqual(fitSize(1, 5000, 1280), { width: 1, height: 1280 });
});

test("collectPhotoIds junta las fotos de todos los ítems", () => {
  const cl = { capot: { fotos: ["a", "b"] }, motor_1: { fotos: ["c"] }, puerta: { estado: "Bueno" }, x: null };
  assert.deepEqual(collectPhotoIds(cl).sort(), ["a", "b", "c"]);
  assert.deepEqual(collectPhotoIds(undefined), []);
});

test("diffIds devuelve solo las fotos que no estaban guardadas", () => {
  assert.deepEqual(diffIds(["a", "b", "c"], ["b"]), ["a", "c"]);
  assert.deepEqual(diffIds(["a"], ["a"]), []);
  assert.deepEqual(diffIds([], ["a"]), []);
});

test("el tope por ítem es razonable", () => {
  assert.ok(MAX_PHOTOS_PER_ITEM >= 3 && MAX_PHOTOS_PER_ITEM <= 10);
});

test("borrador: una lista de fotos vacía no cuenta como trabajo sin guardar", () => {
  const EMPTY = { fecha: "2026-10-07", vehiculo: "", checklist: {} };
  assert.equal(isMeaningful({ ...EMPTY, checklist: { capot: { estado: "", valor: 0, fotos: [] } } }, EMPTY), false);
  assert.equal(isMeaningful({ ...EMPTY, checklist: { capot: { estado: "", valor: 0, fotos: ["a"] } } }, EMPTY), true);
});
