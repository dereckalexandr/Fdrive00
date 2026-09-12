/**
 * SHIM DE ALMACENAMIENTO
 * ----------------------------------------------------------------
 * La plataforma fue construida originalmente como un "artifact" de
 * Claude, donde existe una API global `window.storage` (get/set/list/delete)
 * provista por Claude para persistir datos entre sesiones.
 *
 * Esa API NO EXISTE fuera de Claude. Este archivo la reemplaza por una
 * implementación equivalente usando `localStorage`, para que la app
 * funcione al desplegarla como sitio web independiente.
 *
 * ⚠️ LIMITACIÓN IMPORTANTE:
 * localStorage es local a CADA NAVEGADOR / DISPOSITIVO. Esto significa que:
 *   - El administrador y cada ejecutivo/inspector deben usar el MISMO
 *     navegador en el MISMO dispositivo para compartir datos.
 *   - Los datos NO se sincronizan entre distintos computadores o celulares.
 *   - Si el usuario borra el caché del navegador, se pierden los datos.
 *
 * Esto es válido para pruebas, demos o uso de una sola persona, pero
 * NO reemplaza una base de datos real. Para producción con varios
 * usuarios en distintos dispositivos, reemplaza este archivo por
 * llamadas a tu propio backend (ver README.md, sección "Siguiente paso").
 * ----------------------------------------------------------------
 */

const NAMESPACE = "driveFuturo";

function fullKey(key, shared) {
  return `${NAMESPACE}:${shared ? "shared" : "private"}:${key}`;
}

function stripPrefix(fullK, shared) {
  const prefix = `${NAMESPACE}:${shared ? "shared" : "private"}:`;
  return fullK.startsWith(prefix) ? fullK.slice(prefix.length) : fullK;
}

const storageShim = {
  async get(key, shared = false) {
    try {
      const raw = window.localStorage.getItem(fullKey(key, shared));
      if (raw === null || raw === undefined) return null;
      return { key, value: raw, shared };
    } catch (e) {
      console.error("storage.get error:", e);
      return null;
    }
  },

  async set(key, value, shared = false) {
    try {
      window.localStorage.setItem(fullKey(key, shared), value);
      return { key, value, shared };
    } catch (e) {
      console.error("storage.set error:", e);
      return null;
    }
  },

  async delete(key, shared = false) {
    try {
      window.localStorage.removeItem(fullKey(key, shared));
      return { key, deleted: true, shared };
    } catch (e) {
      console.error("storage.delete error:", e);
      return null;
    }
  },

  async list(prefix = "", shared = false) {
    try {
      const searchPrefix = fullKey(prefix, shared);
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(searchPrefix)) {
          keys.push(stripPrefix(k, shared));
        }
      }
      return { keys, prefix, shared };
    } catch (e) {
      console.error("storage.list error:", e);
      return null;
    }
  },
};

export function installStorageShim() {
  if (!window.storage) {
    window.storage = storageShim;
  }
}
