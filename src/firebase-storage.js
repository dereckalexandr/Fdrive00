/**
 * ALMACENAMIENTO REAL CON FIREBASE FIRESTORE
 * ----------------------------------------------------------------
 * Reemplaza el shim de localStorage por una base de datos real y
 * compartida (Firestore), usando exactamente la misma "forma" de API
 * que espera el resto de la app (`window.storage.get/set/list/delete`).
 * Por eso `App.jsx` no necesita ningún cambio: solo cambia qué
 * implementación se instala en `main.jsx`.
 *
 * Modelo de datos: una única colección "kv_store" donde cada
 * documento representa una clave lógica de la app (ej. "vendors",
 * "record::ABC123::2026-09"). El id del documento es la clave,
 * escapando "/" porque Firestore no lo permite en IDs.
 * ----------------------------------------------------------------
 */
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  documentId,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function hasFirebaseConfig() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

const COLLECTION = "kv_store";
const SLASH_TOKEN = "__SLASH__";

function safeId(key) {
  return String(key).replace(/\//g, SLASH_TOKEN);
}
function unsafeId(id) {
  return String(id).replace(new RegExp(SLASH_TOKEN, "g"), "/");
}

let dbInstance = null;
function getDb() {
  if (!dbInstance) {
    const app = initializeApp(firebaseConfig);
    dbInstance = getFirestore(app);
  }
  return dbInstance;
}

const firestoreStorage = {
  async get(key, shared = false) {
    try {
      const db = getDb();
      const ref = doc(db, COLLECTION, safeId(key));
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { key, value: snap.data().value, shared };
    } catch (e) {
      console.error("firestoreStorage.get error:", e);
      return null;
    }
  },

  async set(key, value, shared = false) {
    try {
      const db = getDb();
      const ref = doc(db, COLLECTION, safeId(key));
      await setDoc(ref, { value, shared, updatedAt: Date.now() });
      return { key, value, shared };
    } catch (e) {
      console.error("firestoreStorage.set error:", e);
      return null;
    }
  },

  async delete(key, shared = false) {
    try {
      const db = getDb();
      const ref = doc(db, COLLECTION, safeId(key));
      await deleteDoc(ref);
      return { key, deleted: true, shared };
    } catch (e) {
      console.error("firestoreStorage.delete error:", e);
      return null;
    }
  },

  async list(prefix = "", shared = false) {
    try {
      const db = getDb();
      const start = safeId(prefix);
      const end = start + "\uf8ff";
      const q = query(
        collection(db, COLLECTION),
        where(documentId(), ">=", start),
        where(documentId(), "<", end)
      );
      const snaps = await getDocs(q);
      const keys = [];
      snaps.forEach((s) => keys.push(unsafeId(s.id)));
      return { keys, prefix, shared };
    } catch (e) {
      console.error("firestoreStorage.list error:", e);
      return null;
    }
  },
};

export function installFirebaseStorage() {
  window.storage = firestoreStorage;
}
