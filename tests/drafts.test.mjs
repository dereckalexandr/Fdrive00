import test from "node:test";
import assert from "node:assert/strict";
import { saveDraft, loadDraft, clearDraft, isMeaningful, draftKey } from "../src/drafts.js";

function fakeStorage({ quota = Infinity } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > quota) throw new Error("QuotaExceededError"); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

const EMPTY = { fecha: "2026-10-06", marca: "", cavFileName: "", cavFileData: "", checklist: {} };

test("ida y vuelta de un borrador", () => {
  const st = fakeStorage();
  const rec = { ...EMPTY, marca: "TOYOTA" };
  assert.deepEqual(saveDraft("INSP1", "inspeccion", rec, st), { ok: true, sinArchivo: false });
  const d = loadDraft("INSP1", "inspeccion", st);
  assert.equal(d.data.marca, "TOYOTA");
  assert.ok(d.savedAt);
});

test("los borradores están separados por inspector y por tipo", () => {
  const st = fakeStorage();
  saveDraft("A", "inspeccion", { ...EMPTY, marca: "KIA" }, st);
  assert.equal(loadDraft("B", "inspeccion", st), null);
  assert.equal(loadDraft("A", "tasacion", st), null);
  assert.notEqual(draftKey("A", "inspeccion"), draftKey("A", "tasacion"));
});

test("clearDraft elimina el borrador", () => {
  const st = fakeStorage();
  saveDraft("A", "inspeccion", EMPTY, st);
  clearDraft("A", "inspeccion", st);
  assert.equal(loadDraft("A", "inspeccion", st), null);
});

test("si no cabe el PDF del CAV, guarda el resto sin el archivo", () => {
  const st = fakeStorage({ quota: 2000 });
  const rec = { ...EMPTY, marca: "TOYOTA", cavFileName: "cav.pdf", cavFileData: "x".repeat(5000) };
  assert.deepEqual(saveDraft("A", "inspeccion", rec, st), { ok: true, sinArchivo: true });
  const d = loadDraft("A", "inspeccion", st);
  assert.equal(d.data.marca, "TOYOTA");
  assert.equal(d.data.cavFileData, "");
});

test("si nada cabe, avisa sin lanzar error", () => {
  const st = fakeStorage({ quota: 5 });
  assert.deepEqual(saveDraft("A", "inspeccion", { ...EMPTY, marca: "TOYOTA" }, st), { ok: false, sinArchivo: false });
});

test("sin almacenamiento disponible no revienta", () => {
  assert.deepEqual(saveDraft("A", "x", EMPTY, null), { ok: false, sinArchivo: false });
  assert.equal(loadDraft("A", "x", null), null);
});

test("un borrador corrupto se ignora", () => {
  const st = fakeStorage();
  st.setItem(draftKey("A", "inspeccion"), "{no es json");
  assert.equal(loadDraft("A", "inspeccion", st), null);
});

test("isMeaningful ignora la fecha del día y entradas de checklist vacías", () => {
  assert.equal(isMeaningful({ ...EMPTY, fecha: "2027-01-01" }, EMPTY), false);
  assert.equal(isMeaningful({ ...EMPTY, checklist: { motor: { estado: "", observacion: "" } } }, EMPTY), false);
  assert.equal(isMeaningful({ ...EMPTY, checklist: { motor: { estado: "Bueno", observacion: "" } } }, EMPTY), true);
  assert.equal(isMeaningful({ ...EMPTY, marca: "KIA" }, EMPTY), true);
});
