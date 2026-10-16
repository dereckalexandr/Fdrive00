/**
 * ESTACIÓN DE TRABAJO (personas que ingresan con RUT y clave)
 * ----------------------------------------------------------------
 * Esta es la base sobre la que se irá construyendo el dash de cada perfil
 * (Ejecutivo, Jefe Local, Tasador…). Hoy muestra los módulos que ya existen según los
 * permisos de la persona y deja a la vista los que vienen en camino.
 * ----------------------------------------------------------------
 */
import React, { useState } from "react";
import { ROLES, PERMISOS, tienePermiso, validarRut, formatearRut, claveValida } from "../supabase/functions/api/crm-core.js";

const INPUT = "border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500";
const rolNombre = (id) => (ROLES.find((r) => r.id === id) || {}).nombre || id;

const ERRORES = {
  invalid_credentials: "RUT o clave incorrectos.",
  too_many_attempts: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  crm_not_installed: "El sistema de personal todavía no está listo. Avisa a tu administrador.",
  server_not_configured: "El ingreso con RUT necesita el servidor configurado.",
  clave_invalida: "La clave nueva debe tener al menos 8 caracteres, con letras y números.",
  clave_igual: "La clave nueva debe ser distinta de la actual.",
  unauthorized: "Tu sesión venció. Recarga la página para ingresar de nuevo.",
};
const mensaje = (e, porDefecto) => ERRORES[e && e.message] || porDefecto;

/** Tarjeta de la pantalla de inicio: ingreso con RUT y clave. */
export function LoginPersonal({ onEntrar }) {
  const [rut, setRut] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const entrar = async (ev) => {
    ev.preventDefault();
    setError("");
    if (!validarRut(rut)) { setError("El RUT no es válido."); return; }
    if (!clave) { setError("Escribe tu clave."); return; }
    setEnviando(true);
    try {
      const me = await window.auth.userLogin(rut, clave);
      onEntrar(me);
    } catch (e) { setError(mensaje(e, "No se pudo ingresar. Inténtalo de nuevo.")); }
    setEnviando(false);
  };

  return (
    <form onSubmit={entrar} className="bg-white border border-stone-200 p-6 flex flex-col md:flex-row md:items-end gap-4">
      <div className="md:w-1/3">
        <h2 className="font-serif text-xl text-stone-900">Personal</h2>
        <p className="text-sm text-stone-500 mt-1">Ingresa con tu RUT y la clave que te entregó el administrador.</p>
      </div>
      <label className="flex-1 text-xs text-stone-500 flex flex-col gap-1">RUT
        <input value={rut} onChange={(e) => setRut(e.target.value)} onBlur={() => validarRut(rut) && setRut(formatearRut(rut))}
          placeholder="12.345.678-5" autoComplete="username" inputMode="text" className={`${INPUT} font-mono`} />
      </label>
      <label className="flex-1 text-xs text-stone-500 flex flex-col gap-1">Clave
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" className={INPUT} />
      </label>
      <button type="submit" disabled={enviando} className="bg-stone-900 text-white px-5 py-2 text-sm hover:bg-stone-800 disabled:opacity-60">{enviando ? "Ingresando…" : "Ingresar"}</button>
      {error && <p className="text-xs text-rose-600 md:basis-full">{error}</p>}
    </form>
  );
}

/** Obligatorio en el primer ingreso (y tras un reinicio de clave): reemplaza la clave provisoria. */
export function CambioClaveObligatorio({ me, onListo, onSalir }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repite, setRepite] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const guardar = async (ev) => {
    ev.preventDefault();
    setError("");
    if (!claveValida(nueva)) { setError(ERRORES.clave_invalida); return; }
    if (nueva !== repite) { setError("Las dos claves nuevas no coinciden."); return; }
    setEnviando(true);
    try { onListo(await window.auth.userChangePassword(actual, nueva)); }
    catch (e) { setError(e && e.message === "invalid_credentials" ? "La clave actual no es correcta." : mensaje(e, "No se pudo cambiar la clave.")); }
    setEnviando(false);
  };

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-6">
      <form onSubmit={guardar} className="bg-white border border-stone-200 p-6 max-w-md w-full flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Hola, {me.nombre.split(" ")[0]}</p>
          <h1 className="font-serif text-2xl text-stone-900">Elige tu propia clave</h1>
          <p className="text-sm text-stone-500 mt-2">La clave que recibiste es provisoria. Crea una que solo tú conozcas: mínimo 8 caracteres, con letras y números.</p>
        </div>
        <label className="text-sm text-stone-700 flex flex-col gap-1">Clave provisoria (la actual)
          <input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" className={INPUT} /></label>
        <label className="text-sm text-stone-700 flex flex-col gap-1">Clave nueva
          <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" className={INPUT} /></label>
        <label className="text-sm text-stone-700 flex flex-col gap-1">Repite la clave nueva
          <input type="password" value={repite} onChange={(e) => setRepite(e.target.value)} autoComplete="new-password" className={INPUT} /></label>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={enviando} className="bg-stone-900 text-white px-4 py-2 text-sm hover:bg-stone-800 disabled:opacity-60">{enviando ? "Guardando…" : "Guardar y continuar"}</button>
          <button type="button" onClick={onSalir} className="border border-stone-300 px-4 py-2 text-sm text-stone-700">Salir</button>
        </div>
      </form>
    </div>
  );
}

// Módulos que ya existen. Cada uno se abre si la persona tiene alguno de sus permisos.
const MODULOS_ACTIVOS = [
  { id: "tasaciones", titulo: "Tasaciones", texto: "Cola de solicitudes, tasaciones directas, estimación con Chileautos, inspecciones y fotos.", permisos: ["tasaciones.realizar"] },
  { id: "validacion", titulo: "Validaciones", texto: "Cola de revisión de documentos de ventas, vehículos y compras: aprobar, observar o rechazar cada documento.", permisos: ["validacion.realizar", "validacion.usar"] },
  { id: "anuncios", titulo: "Avisos", texto: "Cola de vehículos por publicar, avisos por portal y red social, alertas de avisos desactualizados y consultas por aviso.", permisos: ["anuncios.gestionar"] },
  { id: "ventas", titulo: "Ventas", texto: "Leads, embudo en columnas, agenda, inventario y clientes.", permisos: ["leads.propios", "leads.local", "leads.asignar", "inventario.ver", "inventario.editar"] },
  { id: "inspector", titulo: "Inspecciones y tasaciones", texto: "Checklist de inspección, valorizaciones, fotos y PDF.", permisos: ["inspecciones.usar", "tasaciones.usar"] },
  { id: "compra", titulo: "Tasación de compra", texto: "Precio de compra sugerido según los avisos de Chileautos.", permisos: ["tasacion_compra.usar"] },
];

export function EstacionTrabajo({ me, onAbrir, onSalir }) {
  const abiertos = MODULOS_ACTIVOS.filter((m) => m.permisos.some((p) => tienePermiso(me.permisos, p)));
  // Lo que la persona podrá usar cuando se construya su perfil (permisos suyos aún sin módulo).
  const proximos = PERMISOS.filter((p) => !p.disponible && tienePermiso(me.permisos, p.id));

  return (
    <div className="min-h-screen bg-stone-100 pb-16">
      <div className="bg-stone-900 text-stone-100">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Estación de trabajo{me.local ? ` · ${me.local.nombre}` : ""}</p>
            <h1 className="font-serif text-2xl md:text-3xl">{me.nombre}</h1>
            <p className="text-sm text-stone-400 mt-1">{me.roles.map(rolNombre).join(" · ")}</p>
          </div>
          <button onClick={onSalir} className="self-start md:self-auto border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Salir</button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 mt-8 flex flex-col gap-6">
        {abiertos.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {abiertos.map((m) => (
              <button key={m.id} onClick={() => onAbrir(m.id)} className="text-left bg-white border border-stone-200 p-6 hover:border-amber-500 transition-colors">
                <h2 className="font-serif text-xl text-stone-900">{m.titulo}</h2>
                <p className="text-sm text-stone-500 mt-1">{m.texto}</p>
                <p className="text-sm text-amber-700 mt-4">Abrir →</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-stone-200 p-8 text-center text-stone-600 text-sm">
            Tu perfil todavía no tiene módulos disponibles. Estamos construyendo tu estación de trabajo; cuando esté lista aparecerá aquí.
          </div>
        )}

        {proximos.length > 0 && (
          <div className="bg-white border border-stone-200 p-5">
            <h3 className="font-serif text-lg text-stone-900">En construcción para tu perfil</h3>
            <p className="text-xs text-stone-500 mt-1 mb-3">Ya tienes permiso para esto; se activará cuando termine su desarrollo.</p>
            <div className="flex flex-wrap gap-2">
              {proximos.map((p) => <span key={p.id} className="text-xs border border-stone-200 bg-stone-50 text-stone-600 px-2 py-1">{p.nombre}</span>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
