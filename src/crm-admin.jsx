/**
 * PANEL DEL ADMINISTRADOR GENERAL (CRM · etapa 1)
 * ----------------------------------------------------------------
 * Usuarios, permisos, bitácora, configuración del negocio y reportes globales.
 * Todo lo que se guarda pasa por la Edge Function ("crm"), que vuelve a validar y
 * registra cada cambio en la bitácora. Aquí solo se dibuja y se pide.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import {
  ROLES, ROLES_ASIGNABLES, PERMISOS, HABILITACIONES_EJECUTIVO,
  permisosEfectivos, limpiarExtra, validarRut, formatearRut, claveValida,
} from "../supabase/functions/api/crm-core.js";

const MENSAJES = {
  crm_not_installed: "Faltan las tablas del CRM. Ejecuta el archivo supabase-crm-setup.sql en Supabase (SQL Editor) y recarga.",
  server_not_configured: "El CRM necesita Supabase configurado: no está disponible en modo de prueba local.",
  duplicado: "Ya existe un registro con ese dato (RUT o nombre repetido).",
  rut_invalido: "El RUT no es válido. Revisa el número y el dígito verificador.",
  nombre_invalido: "Escribe el nombre completo (entre 3 y 80 caracteres).",
  roles_requeridos: "Elige al menos un rol.",
  rol_invalido: "Ese rol no se puede asignar a una persona.",
  email_invalido: "El correo no tiene un formato válido.",
  clave_invalida: "La clave debe tener al menos 8 caracteres, con letras y números.",
  local_invalido: "El local elegido no existe.",
  too_many_attempts: "Demasiados intentos. Espera unos minutos.",
  forbidden: "No tienes permiso para esa operación.",
  unauthorized: "Tu sesión venció. Recarga la página para volver a ingresar.",
  no_existe: "Ese registro ya no existe.",
};
export function mensajeCrm(e) {
  return MENSAJES[e && e.message] || "No se pudo completar la operación. Inténtalo de nuevo.";
}

const crm = (op, params) => window.auth.crm(op, params);
const rolNombre = (id) => (ROLES.find((r) => r.id === id) || {}).nombre || id;
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—");
const GRUPOS = Array.from(new Set(PERMISOS.map((p) => p.grupo)));

const INPUT = "border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500";
const BTN = "px-3 py-1.5 text-sm border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50";
const BTN_PRIMARIO = "px-4 py-2 text-sm bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50";

function Aviso({ tipo = "error", children }) {
  const estilos = tipo === "error" ? "bg-rose-50 border-rose-200 text-rose-800" : tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-stone-800";
  return <div className={`border px-4 py-3 text-sm ${estilos}`}>{children}</div>;
}
const Cargando = ({ texto = "Cargando…" }) => <p className="text-sm text-stone-500">{texto}</p>;
const Tarjeta = ({ titulo, ayuda, children }) => (
  <div className="bg-white border border-stone-200 p-5">
    {titulo && <h3 className="font-serif text-lg text-stone-900">{titulo}</h3>}
    {ayuda && <p className="text-xs text-stone-500 mt-1 mb-4">{ayuda}</p>}
    {!ayuda && titulo && <div className="mb-3" />}
    {children}
  </div>
);

function useCarga(fn, deps) {
  const [estado, setEstado] = useState({ cargando: true, error: "", datos: null });
  const recargar = useCallback(async () => {
    setEstado((e) => ({ ...e, cargando: true, error: "" }));
    try { setEstado({ cargando: false, error: "", datos: await fn() }); }
    catch (e) { setEstado({ cargando: false, error: mensajeCrm(e), datos: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recargar(); }, [recargar]);
  return { ...estado, recargar };
}

/* =========================================================
   USUARIOS
========================================================= */
const FORM_VACIO = { id: null, nombre: "", rut: "", email: "", telefono: "", localId: "", roles: [], extra: { otorgar: [], quitar: [] }, claveManual: "" };

function UsuariosTab() {
  const { cargando, error, datos, recargar } = useCarga(async () => {
    const [u, l, p] = await Promise.all([crm("usuarios.list"), crm("locales.list"), crm("permisos.get")]);
    return { usuarios: u.usuarios, locales: l.locales, porRol: p.porRol };
  }, []);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [entrega, setEntrega] = useState(null); // { nombre, rut, clave, motivo }
  const [copiado, setCopiado] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [accionError, setAccionError] = useState("");

  const locales = datos ? datos.locales : [];
  const localNombre = (id) => (locales.find((l) => l.id === id) || {}).nombre || "—";

  const lista = useMemo(() => {
    if (!datos) return [];
    const q = busqueda.trim().toLowerCase();
    return datos.usuarios.filter((u) => (verInactivos || u.activo) &&
      (!q || u.nombre.toLowerCase().includes(q) || u.rut.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)));
  }, [datos, busqueda, verInactivos]);

  const abrirNuevo = () => { setForm({ ...FORM_VACIO, localId: locales.find((l) => l.activo)?.id || "" }); setFormError(""); setEntrega(null); };
  const abrirEditar = (u) => {
    setForm({ id: u.id, nombre: u.nombre, rut: u.rut, email: u.email || "", telefono: u.telefono || "", localId: u.localId || "", roles: [...u.roles], extra: limpiarExtra(u.extra), claveManual: "" });
    setFormError(""); setEntrega(null);
  };
  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const toggleRol = (r) => set("roles", form.roles.includes(r) ? form.roles.filter((x) => x !== r) : [...form.roles, r]);

  // Estado de un permiso para esta persona: "rol" (según sus roles), "otorgar" o "quitar".
  const estadoPermiso = (p) => (form.extra.otorgar.includes(p) ? "otorgar" : form.extra.quitar.includes(p) ? "quitar" : "rol");
  const ponerPermiso = (p, modo) => setForm((f) => {
    const otorgar = f.extra.otorgar.filter((x) => x !== p);
    const quitar = f.extra.quitar.filter((x) => x !== p);
    if (modo === "otorgar") otorgar.push(p);
    if (modo === "quitar") quitar.push(p);
    return { ...f, extra: { otorgar, quitar } };
  });
  const heredado = (p) => form.roles.some((r) => (datos.porRol[r] || []).includes(p));
  const efectivos = form && datos ? permisosEfectivos(form.roles, datos.porRol, form.extra) : [];

  const guardar = async () => {
    setFormError("");
    if (form.nombre.trim().length < 3) { setFormError(MENSAJES.nombre_invalido); return; }
    if (!form.id && !validarRut(form.rut)) { setFormError(MENSAJES.rut_invalido); return; }
    if (form.roles.length === 0) { setFormError(MENSAJES.roles_requeridos); return; }
    if (form.claveManual && !claveValida(form.claveManual)) { setFormError(MENSAJES.clave_invalida); return; }
    const datosUsuario = { nombre: form.nombre, rut: form.rut, email: form.email, telefono: form.telefono, localId: form.localId || null, roles: form.roles, extra: limpiarExtra(form.extra) };
    setGuardando(true);
    try {
      if (form.id) {
        await crm("usuarios.update", { id: form.id, datos: datosUsuario });
      } else {
        const r = await crm("usuarios.create", { datos: datosUsuario, clave: form.claveManual || undefined });
        setEntrega({ nombre: r.usuario.nombre, rut: formatearRut(r.usuario.rut), clave: r.claveProvisoria, motivo: "alta" });
      }
      setForm(null);
      await recargar();
    } catch (e) { setFormError(mensajeCrm(e)); }
    setGuardando(false);
  };

  const cambiarActivo = async (u) => {
    setAccionError("");
    if (u.activo && !window.confirm(`¿Desactivar a ${u.nombre}? No podrá ingresar y su sesión abierta se cerrará. Sus datos se conservan.`)) return;
    try { await crm("usuarios.setActivo", { id: u.id, activo: !u.activo }); await recargar(); }
    catch (e) { setAccionError(mensajeCrm(e)); }
  };
  const reiniciarClave = async (u) => {
    setAccionError("");
    if (!window.confirm(`¿Generar una clave provisoria nueva para ${u.nombre}? La clave actual dejará de funcionar.`)) return;
    try {
      const r = await crm("usuarios.resetClave", { id: u.id });
      setEntrega({ nombre: u.nombre, rut: formatearRut(u.rut), clave: r.claveProvisoria, motivo: "reinicio" });
      setCopiado(false);
    } catch (e) { setAccionError(mensajeCrm(e)); }
  };
  const copiar = async (texto) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch (e) { setCopiado(false); }
  };

  if (cargando && !datos) return <Cargando />;
  if (error) return <Aviso>{error}</Aviso>;

  return (
    <>
      {entrega && (
        <Aviso tipo="ok">
          <p className="font-medium mb-1">{entrega.motivo === "alta" ? "Usuario creado" : "Clave reiniciada"}: {entrega.nombre}</p>
          <p>RUT: <span className="font-mono">{entrega.rut}</span> · Clave provisoria: <span className="font-mono font-semibold text-base">{entrega.clave}</span>
            <button onClick={() => copiar(`RUT: ${entrega.rut}\nClave provisoria: ${entrega.clave}`)} className="ml-3 underline">{copiado ? "Copiado ✓" : "Copiar"}</button>
          </p>
          <p className="text-xs mt-2">Entrégasela en persona o por un canal privado. Esta clave no se vuelve a mostrar y la persona deberá cambiarla al ingresar.</p>
        </Aviso>
      )}

      <Tarjeta>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, RUT o correo" className={`${INPUT} md:flex-1`} />
          <label className="text-sm text-stone-600 flex items-center gap-2">
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Mostrar desactivados
          </label>
          <button onClick={abrirNuevo} className={BTN_PRIMARIO}>+ Nuevo usuario</button>
        </div>
      </Tarjeta>

      {form && (
        <Tarjeta titulo={form.id ? `Editar a ${form.nombre || "usuario"}` : "Nuevo usuario"}
          ayuda={form.id ? "El RUT no se puede cambiar. Los cambios de rol y permisos se aplican de inmediato." : "La persona ingresará con su RUT y la clave provisoria que se genere aquí."}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm text-stone-700 flex flex-col gap-1">Nombre completo
              <input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} /></label>
            <label className="text-sm text-stone-700 flex flex-col gap-1">RUT
              <input value={form.rut} disabled={!!form.id} onChange={(e) => set("rut", e.target.value)}
                onBlur={() => form.rut && validarRut(form.rut) && set("rut", formatearRut(form.rut))}
                placeholder="12.345.678-5" className={`${INPUT} font-mono disabled:bg-stone-100`} />
              {!form.id && form.rut && !validarRut(form.rut) && <span className="text-xs text-rose-600">RUT no válido</span>}
            </label>
            <label className="text-sm text-stone-700 flex flex-col gap-1">Correo (opcional)
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={INPUT} /></label>
            <label className="text-sm text-stone-700 flex flex-col gap-1">Teléfono (opcional)
              <input value={form.telefono} onChange={(e) => set("telefono", e.target.value)} className={INPUT} /></label>
            <label className="text-sm text-stone-700 flex flex-col gap-1">Local
              <select value={form.localId} onChange={(e) => set("localId", e.target.value)} className={INPUT}>
                <option value="">Sin local</option>
                {locales.filter((l) => l.activo || l.id === form.localId).map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.activo ? "" : " (inactivo)"}</option>)}
              </select></label>
            {!form.id && (
              <label className="text-sm text-stone-700 flex flex-col gap-1">Clave (déjala vacía para generar una automática)
                <input value={form.claveManual} onChange={(e) => set("claveManual", e.target.value)} placeholder="Automática" className={`${INPUT} font-mono`} /></label>
            )}
          </div>

          <p className="text-sm text-stone-700 mt-5 mb-2">Roles</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ROLES_ASIGNABLES.map((id) => (
              <label key={id} className={`border px-3 py-2 text-sm flex gap-2 items-start cursor-pointer ${form.roles.includes(id) ? "border-amber-500 bg-amber-50" : "border-stone-200"}`}>
                <input type="checkbox" className="mt-1" checked={form.roles.includes(id)} onChange={() => toggleRol(id)} />
                <span><span className="font-medium text-stone-900">{rolNombre(id)}</span><br /><span className="text-xs text-stone-500">{ROLES.find((r) => r.id === id).descripcion}</span></span>
              </label>
            ))}
          </div>

          {form.roles.includes("ejecutivo") && (
            <div className="mt-4 border border-stone-200 p-3">
              <p className="text-sm text-stone-700 mb-2">El Ejecutivo está habilitado para:</p>
              <div className="flex flex-wrap gap-4">
                {HABILITACIONES_EJECUTIVO.map((h) => (
                  <label key={h.permiso} className="text-sm text-stone-700 flex items-center gap-2">
                    <input type="checkbox" checked={efectivos.includes(h.permiso)} onChange={(e) => ponerPermiso(h.permiso, e.target.checked ? "otorgar" : "rol")} /> {h.nombre}
                  </label>
                ))}
              </div>
            </div>
          )}

          <details className="mt-4 border border-stone-200">
            <summary className="px-3 py-2 text-sm text-stone-700 cursor-pointer">Permisos de esta persona ({efectivos.length} activos) — ajustar uno por uno</summary>
            <div className="p-3 flex flex-col gap-4">
              <p className="text-xs text-stone-500">"Según rol" usa lo que dan sus roles. "Otorgar" lo agrega y "Quitar" lo bloquea aunque el rol lo tenga.</p>
              {GRUPOS.map((g) => (
                <div key={g}>
                  <p className="text-xs uppercase tracking-wide text-stone-400 mb-1">{g}</p>
                  {PERMISOS.filter((p) => p.grupo === g).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-1 text-sm border-b border-stone-100">
                      <span className="text-stone-800">{p.nombre}{!p.disponible && <span className="ml-2 text-[10px] uppercase text-stone-400">próximamente</span>}</span>
                      <select value={estadoPermiso(p.id)} onChange={(e) => ponerPermiso(p.id, e.target.value)} className="border border-stone-300 bg-white px-2 py-1 text-xs">
                        <option value="rol">Según rol ({heredado(p.id) ? "sí" : "no"})</option>
                        <option value="otorgar">Otorgar</option>
                        <option value="quitar">Quitar</option>
                      </select>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>

          {formError && <p className="text-sm text-rose-600 mt-4">{formError}</p>}
          <div className="flex gap-2 mt-5">
            <button onClick={guardar} disabled={guardando} className={BTN_PRIMARIO}>{guardando ? "Guardando…" : form.id ? "Guardar cambios" : "Crear usuario"}</button>
            <button onClick={() => setForm(null)} className={BTN}>Cancelar</button>
          </div>
        </Tarjeta>
      )}

      {accionError && <Aviso>{accionError}</Aviso>}

      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-3 px-4">Nombre</th><th className="py-3 px-4">RUT</th><th className="py-3 px-4">Roles</th>
              <th className="py-3 px-4">Local</th><th className="py-3 px-4">Último ingreso</th><th className="py-3 px-4">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-stone-500">{datos.usuarios.length === 0 ? "Aún no hay usuarios. Crea el primero con «Nuevo usuario»." : "Ningún usuario coincide con la búsqueda."}</td></tr>}
            {lista.map((u) => (
              <tr key={u.id} className={`border-b border-stone-100 align-top ${u.activo ? "" : "opacity-60"}`}>
                <td className="py-3 px-4 text-stone-900">{u.nombre}{!u.activo && <span className="ml-2 text-[10px] uppercase text-rose-600">desactivado</span>}
                  {u.debeCambiarClave && u.activo && <span className="ml-2 text-[10px] uppercase text-amber-600">clave provisoria</span>}
                  {u.email && <div className="text-xs text-stone-500">{u.email}</div>}</td>
                <td className="py-3 px-4 font-mono text-stone-700 whitespace-nowrap">{formatearRut(u.rut)}</td>
                <td className="py-3 px-4 text-stone-700">{u.roles.map(rolNombre).join(", ")}</td>
                <td className="py-3 px-4 text-stone-700">{localNombre(u.localId)}</td>
                <td className="py-3 px-4 text-stone-500 whitespace-nowrap">{fechaHora(u.ultimoAcceso)}</td>
                <td className="py-3 px-4"><div className="flex flex-wrap gap-2">
                  <button onClick={() => abrirEditar(u)} className={BTN}>Editar</button>
                  <button onClick={() => reiniciarClave(u)} className={BTN}>Reiniciar clave</button>
                  <button onClick={() => cambiarActivo(u)} className={BTN}>{u.activo ? "Desactivar" : "Activar"}</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Los usuarios no se eliminan: se desactivan, para conservar su historial. Los perfiles anteriores de Ejecutivo e Inspector por código siguen funcionando en sus pestañas.</p>
    </>
  );
}

/* =========================================================
   PERMISOS POR ROL
========================================================= */
function PermisosTab() {
  const { cargando, error, datos, recargar } = useCarga(() => crm("permisos.get"), []);
  const [edits, setEdits] = useState({});
  const [msg, setMsg] = useState({ tipo: "", texto: "" });

  useEffect(() => { if (datos) setEdits({}); }, [datos]);
  if (cargando && !datos) return <Cargando />;
  if (error) return <Aviso>{error}</Aviso>;

  const actuales = (rol) => edits[rol] || datos.porRol[rol];
  const sucio = (rol) => !!edits[rol];
  const toggle = (rol, p) => {
    const set = new Set(actuales(rol));
    if (set.has(p)) set.delete(p); else set.add(p);
    setEdits((e) => ({ ...e, [rol]: Array.from(set) }));
    setMsg({ tipo: "", texto: "" });
  };
  const guardar = async (rol) => {
    try { await crm("permisos.setRol", { rol, permisos: actuales(rol) }); setMsg({ tipo: "ok", texto: `Permisos de «${rolNombre(rol)}» guardados.` }); await recargar(); }
    catch (e) { setMsg({ tipo: "error", texto: mensajeCrm(e) }); }
  };
  const reiniciar = async (rol) => {
    if (!window.confirm(`¿Volver los permisos de «${rolNombre(rol)}» a los valores iniciales?`)) return;
    try { await crm("permisos.reiniciarRol", { rol }); setMsg({ tipo: "ok", texto: `«${rolNombre(rol)}» volvió a sus permisos iniciales.` }); await recargar(); }
    catch (e) { setMsg({ tipo: "error", texto: mensajeCrm(e) }); }
  };

  return (
    <>
      <Aviso tipo="info">
        Aquí defines qué puede hacer cada rol. El cambio se aplica a todas las personas con ese rol en cuestión de segundos.
        Para ajustar a UNA persona (por ejemplo, habilitar a un Ejecutivo para compras), usa «Editar» en la pestaña Usuarios.
        Los permisos marcados «próximamente» quedan definidos, pero hacen efecto cuando se construya ese perfil.
      </Aviso>
      {msg.texto && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 align-bottom">
              <th className="py-3 px-4 text-left text-xs uppercase tracking-wide text-stone-400 min-w-[220px]">Permiso</th>
              <th className="py-3 px-2 text-center text-xs text-stone-500 w-24">Administrador general<div className="text-[10px] text-stone-400 font-normal">siempre todo</div></th>
              {ROLES_ASIGNABLES.map((r) => (
                <th key={r} className="py-3 px-2 text-center text-xs text-stone-700 w-28 font-medium">
                  {rolNombre(r).replace(" (Supervisor)", "")}
                  {datos.personalizados.includes(r) && <div className="text-[10px] text-amber-600 font-normal">personalizado</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRUPOS.map((g) => (
              <React.Fragment key={g}>
                <tr className="bg-stone-50"><td colSpan={2 + ROLES_ASIGNABLES.length} className="py-2 px-4 text-xs uppercase tracking-wide text-stone-500">{g}</td></tr>
                {PERMISOS.filter((p) => p.grupo === g).map((p) => (
                  <tr key={p.id} className="border-b border-stone-100">
                    <td className="py-2 px-4 text-stone-800">{p.nombre}{!p.disponible && <span className="ml-2 text-[10px] uppercase text-stone-400">próximamente</span>}</td>
                    <td className="text-center"><input type="checkbox" checked disabled /></td>
                    {ROLES_ASIGNABLES.map((r) => (
                      <td key={r} className="text-center"><input type="checkbox" checked={actuales(r).includes(p.id)} onChange={() => toggle(r, p.id)} /></td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
            <tr>
              <td className="py-3 px-4 text-xs text-stone-500">Acciones</td><td />
              {ROLES_ASIGNABLES.map((r) => (
                <td key={r} className="py-3 px-1 text-center">
                  <div className="flex flex-col gap-1 items-center">
                    <button onClick={() => guardar(r)} disabled={!sucio(r)} className="text-xs px-2 py-1 bg-stone-900 text-white disabled:opacity-30">Guardar</button>
                    {datos.personalizados.includes(r) && <button onClick={() => reiniciar(r)} className="text-xs text-stone-500 underline">Restablecer</button>}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/* =========================================================
   BITÁCORA
========================================================= */
const ACCIONES = {
  "usuario.crear": "Creó un usuario", "usuario.editar": "Editó un usuario", "usuario.activar": "Activó un usuario",
  "usuario.desactivar": "Desactivó un usuario", "usuario.reiniciar_clave": "Reinició una clave", "usuario.cambiar_clave": "Cambió su propia clave",
  "permisos.editar_rol": "Cambió los permisos de un rol", "permisos.reiniciar_rol": "Restableció los permisos de un rol",
  "config.editar": "Cambió la configuración", "local.crear": "Creó un local", "local.editar": "Editó un local",
};
const FILTROS_BITACORA = [["", "Todo"], ["usuario.", "Usuarios"], ["permisos.", "Permisos"], ["config.", "Configuración"], ["local.", "Locales"]];
const POR_PAGINA = 50;
const corto = (v) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t && t.length > 90 ? t.slice(0, 87) + "…" : t; };

function resumenDetalle(f) {
  const d = f.detalle || {};
  if (f.accion === "usuario.crear") return `${d.nombre || ""} · RUT ${formatearRut(d.rut || "")} · ${(d.roles || []).map(rolNombre).join(", ")}`;
  if (f.accion === "usuario.editar") {
    const partes = [d.nombre];
    if (d.roles && JSON.stringify(d.roles.antes) !== JSON.stringify(d.roles.despues)) partes.push(`roles: ${(d.roles.antes || []).map(rolNombre).join(", ") || "—"} → ${(d.roles.despues || []).map(rolNombre).join(", ") || "—"}`);
    if (d.permisos_extra && JSON.stringify(d.permisos_extra.antes) !== JSON.stringify(d.permisos_extra.despues)) partes.push("permisos personalizados modificados");
    return partes.filter(Boolean).join(" · ");
  }
  if (f.accion.startsWith("usuario.")) return [d.nombre, d.rut && `RUT ${formatearRut(d.rut)}`].filter(Boolean).join(" · ");
  if (f.accion === "permisos.editar_rol") return `${rolNombre(f.entidad_id)}: +${(d.agregados || []).length} / −${(d.quitados || []).length}${(d.agregados || []).length ? ` (agregó: ${d.agregados.join(", ")})` : ""}${(d.quitados || []).length ? ` (quitó: ${d.quitados.join(", ")})` : ""}`;
  if (f.accion === "permisos.reiniciar_rol") return rolNombre(f.entidad_id);
  if (f.accion === "config.editar") return `${f.entidad_id}: ${corto(d.antes)} → ${corto(d.despues)}`;
  if (f.accion.startsWith("local.")) return d.nombre || "";
  return corto(d);
}

function BitacoraTab() {
  const [filtro, setFiltro] = useState("");
  const [desde, setDesde] = useState(0);
  const { cargando, error, datos } = useCarga(() => crm("bitacora.list", { limite: POR_PAGINA, desde, prefijo: filtro }), [filtro, desde]);

  return (
    <>
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-2">
          {FILTROS_BITACORA.map(([valor, texto]) => (
            <button key={texto} onClick={() => { setFiltro(valor); setDesde(0); }}
              className={`px-3 py-1.5 text-sm border ${filtro === valor ? "bg-stone-900 text-white border-stone-900" : "border-stone-300 text-stone-700 bg-white"}`}>{texto}</button>
          ))}
          {datos && <span className="ml-auto text-xs text-stone-500">{datos.total} registros</span>}
        </div>
      </Tarjeta>
      {error && <Aviso>{error}</Aviso>}
      {cargando && !datos && <Cargando />}
      {datos && (
        <div className="bg-white border border-stone-200 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-3 px-4">Fecha</th><th className="py-3 px-4">Quién</th><th className="py-3 px-4">Acción</th><th className="py-3 px-4">Detalle</th>
            </tr></thead>
            <tbody>
              {datos.filas.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-stone-500">Todavía no hay movimientos registrados.</td></tr>}
              {datos.filas.map((f) => (
                <tr key={f.id} className="border-b border-stone-100 align-top">
                  <td className="py-2 px-4 text-stone-500 whitespace-nowrap">{fechaHora(f.creado_en)}</td>
                  <td className="py-2 px-4 text-stone-800">{f.actor_nombre || f.actor_tipo}<div className="text-[10px] uppercase text-stone-400">{f.actor_tipo}</div></td>
                  <td className="py-2 px-4 text-stone-800 whitespace-nowrap">{ACCIONES[f.accion] || f.accion}</td>
                  <td className="py-2 px-4 text-stone-600 break-words max-w-md">{resumenDetalle(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && datos.total > POR_PAGINA && (
        <div className="flex items-center gap-3">
          <button disabled={desde === 0} onClick={() => setDesde(Math.max(0, desde - POR_PAGINA))} className={BTN}>← Más recientes</button>
          <span className="text-xs text-stone-500">{desde + 1}–{Math.min(desde + POR_PAGINA, datos.total)} de {datos.total}</span>
          <button disabled={desde + POR_PAGINA >= datos.total} onClick={() => setDesde(desde + POR_PAGINA)} className={BTN}>Más antiguos →</button>
        </div>
      )}
    </>
  );
}

/* =========================================================
   CONFIGURACIÓN DEL NEGOCIO
========================================================= */
function ListaEditor({ clave, titulo, ayuda, valores, onGuardado, onError }) {
  const [items, setItems] = useState(valores);
  const [nuevo, setNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setItems(valores), [valores]);
  const sucio = JSON.stringify(items) !== JSON.stringify(valores);
  const agregar = () => {
    const t = nuevo.trim().replace(/\s+/g, " ");
    if (!t || items.some((i) => i.toLowerCase() === t.toLowerCase())) { setNuevo(""); return; }
    setItems([...items, t]); setNuevo("");
  };
  const mover = (i, d) => { const c = [...items]; const j = i + d; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j], c[i]]; setItems(c); };
  const guardar = async () => {
    setGuardando(true);
    try { await crm("config.set", { clave, valor: items }); onGuardado(); } catch (e) { onError(mensajeCrm(e)); }
    setGuardando(false);
  };
  return (
    <Tarjeta titulo={titulo} ayuda={ayuda}>
      <ul className="flex flex-col gap-1 mb-3">
        {items.map((it, i) => (
          <li key={it} className="flex items-center gap-2 border border-stone-200 px-3 py-1.5 text-sm">
            <span className="flex-1 text-stone-800">{it}</span>
            <button onClick={() => mover(i, -1)} disabled={i === 0} className="text-stone-400 disabled:opacity-30" aria-label="Subir">↑</button>
            <button onClick={() => mover(i, 1)} disabled={i === items.length - 1} className="text-stone-400 disabled:opacity-30" aria-label="Bajar">↓</button>
            <button onClick={() => setItems(items.filter((_, k) => k !== i))} disabled={items.length <= 1} className="text-rose-500 disabled:opacity-30" aria-label="Quitar">✕</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder="Agregar…" className={`${INPUT} flex-1`} />
        <button onClick={agregar} className={BTN}>Agregar</button>
        <button onClick={guardar} disabled={!sucio || guardando} className={BTN_PRIMARIO}>{guardando ? "…" : "Guardar"}</button>
      </div>
    </Tarjeta>
  );
}

function NumeroEditor({ clave, etiqueta, valor, sufijo, paso, onGuardado, onError }) {
  const [v, setV] = useState(String(valor));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setV(String(valor)), [valor]);
  const sucio = Number(v) !== Number(valor);
  const guardar = async () => {
    setGuardando(true);
    try { await crm("config.set", { clave, valor: Number(v) }); onGuardado(); } catch (e) { onError(mensajeCrm(e)); }
    setGuardando(false);
  };
  return (
    <div className="flex items-center gap-3 py-2 border-b border-stone-100">
      <span className="flex-1 text-sm text-stone-800">{etiqueta}</span>
      <input type="number" min="0" step={paso} value={v} onChange={(e) => setV(e.target.value)} className={`${INPUT} w-28 text-right font-mono`} />
      <span className="text-sm text-stone-500 w-12">{sufijo}</span>
      <button onClick={guardar} disabled={!sucio || guardando || v === ""} className={BTN}>Guardar</button>
    </div>
  );
}

function LocalesPanel() {
  const { cargando, error, datos, recargar } = useCarga(() => crm("locales.list"), []);
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [msg, setMsg] = useState("");
  const crear = async () => {
    setMsg("");
    try { await crm("locales.create", { nombre, direccion }); setNombre(""); setDireccion(""); await recargar(); }
    catch (e) { setMsg(mensajeCrm(e)); }
  };
  const cambiarActivo = async (l) => {
    setMsg("");
    try { await crm("locales.update", { id: l.id, nombre: l.nombre, direccion: l.direccion, activo: !l.activo }); await recargar(); }
    catch (e) { setMsg(mensajeCrm(e)); }
  };
  return (
    <Tarjeta titulo="Locales" ayuda="Hoy se usa un local; el sistema ya admite varios. Cada persona pertenece a un local.">
      {cargando && !datos && <Cargando />}
      {error && <Aviso>{error}</Aviso>}
      {datos && (
        <ul className="flex flex-col gap-1 mb-4">
          {datos.locales.map((l) => (
            <li key={l.id} className={`flex items-center gap-3 border border-stone-200 px-3 py-2 text-sm ${l.activo ? "" : "opacity-60"}`}>
              <span className="flex-1"><span className="text-stone-900">{l.nombre}</span>{l.direccion && <span className="text-stone-500"> · {l.direccion}</span>}{!l.activo && <span className="ml-2 text-[10px] uppercase text-rose-600">inactivo</span>}</span>
              <button onClick={() => cambiarActivo(l)} className={BTN}>{l.activo ? "Desactivar" : "Activar"}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col md:flex-row gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del local" className={`${INPUT} md:flex-1`} />
        <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección (opcional)" className={`${INPUT} md:flex-1`} />
        <button onClick={crear} disabled={nombre.trim().length < 2} className={BTN_PRIMARIO}>Agregar local</button>
      </div>
      {msg && <p className="text-sm text-rose-600 mt-2">{msg}</p>}
    </Tarjeta>
  );
}

function ConfigTab() {
  const { cargando, error, datos, recargar } = useCarga(() => crm("config.get"), []);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const ok = async () => { setMsg({ tipo: "ok", texto: "Guardado ✓" }); await recargar(); };
  const mal = (texto) => setMsg({ tipo: "error", texto });
  if (cargando && !datos) return <Cargando />;
  if (error) return <Aviso>{error}</Aviso>;
  const c = datos.config;
  return (
    <>
      <Aviso tipo="info">Estos catálogos y metas los usarán los perfiles de Ejecutivo y Jefe Local a medida que se construyan. Cada cambio queda en la bitácora.</Aviso>
      {msg.texto && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <LocalesPanel />
      <ListaEditor clave="fuentes_lead" titulo="Fuentes de leads" ayuda="De dónde llegan los clientes interesados." valores={c.fuentes_lead} onGuardado={ok} onError={mal} />
      <ListaEditor clave="estados_lead" titulo="Etapas del embudo" ayuda="Recorrido de un lead, de izquierda a derecha. El orden importa." valores={c.estados_lead} onGuardado={ok} onError={mal} />
      <ListaEditor clave="motivos_perdida" titulo="Motivos de pérdida" ayuda="Para registrar por qué no se concretó un negocio." valores={c.motivos_perdida} onGuardado={ok} onError={mal} />
      <Tarjeta titulo="Comisiones y metas" ayuda="Valores generales. Más adelante se podrán ajustar por persona o por local.">
        <NumeroEditor clave="comision_ventas_pct" etiqueta="Comisión por ventas" valor={c.comision_ventas_pct} sufijo="%" paso="0.1" onGuardado={ok} onError={mal} />
        <NumeroEditor clave="comision_compras_pct" etiqueta="Comisión por compras" valor={c.comision_compras_pct} sufijo="%" paso="0.1" onGuardado={ok} onError={mal} />
        <NumeroEditor clave="comision_consignaciones_pct" etiqueta="Comisión por consignaciones" valor={c.comision_consignaciones_pct} sufijo="%" paso="0.1" onGuardado={ok} onError={mal} />
        <NumeroEditor clave="meta_mensual_unidades" etiqueta="Meta mensual por ejecutivo" valor={c.meta_mensual_unidades} sufijo="unid." paso="1" onGuardado={ok} onError={mal} />
      </Tarjeta>
    </>
  );
}

/* =========================================================
   REPORTES GLOBALES
========================================================= */
async function cargarActividad() {
  const filas = [];
  for (const [prefijo, tipo] of [["inspeccion::", "inspecciones"], ["tasacion::", "tasaciones"]]) {
    const r = await window.storage.list(prefijo, true);
    const keys = (r && r.keys) || [];
    for (let i = 0; i < keys.length; i += 6) {
      await Promise.all(keys.slice(i, i + 6).map(async (k) => {
        try {
          const g = await window.storage.get(k, true);
          if (!g) return;
          const d = JSON.parse(g.value);
          filas.push({ tipo, inspectorId: d.inspectorId || k.split("::")[1], nombre: d.inspectorNombre || "", fecha: d.guardadoEl || "" });
        } catch (e) { /* un registro dañado no debe romper el reporte */ }
      }));
    }
  }
  return filas;
}

function ultimosMeses(n) {
  const out = [];
  const hoy = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function ReportesTab() {
  const { cargando, error, datos } = useCarga(async () => {
    const [u, l, act] = await Promise.all([crm("usuarios.list"), crm("locales.list"), cargarActividad()]);
    let antiguos = { ejecutivos: 0, inspectores: 0 };
    try {
      const v = await window.storage.get("vendors", true);
      const i = await window.storage.get("inspectors", true);
      antiguos = { ejecutivos: v ? JSON.parse(v.value).length : 0, inspectores: i ? JSON.parse(i.value).length : 0 };
    } catch (e) { /* sin perfiles antiguos */ }
    return { usuarios: u.usuarios, locales: l.locales, actividad: act, antiguos };
  }, []);

  const resumen = useMemo(() => {
    if (!datos) return null;
    const activos = datos.usuarios.filter((u) => u.activo);
    const porRol = ROLES_ASIGNABLES.map((r) => ({ rol: r, n: activos.filter((u) => u.roles.includes(r)).length }));
    const porLocal = datos.locales.map((l) => ({ nombre: l.nombre, n: activos.filter((u) => u.localId === l.id).length }));
    const sinLocal = activos.filter((u) => !u.localId).length;

    const nombres = new Map(datos.usuarios.map((u) => [u.id, u.nombre]));
    const meses = ultimosMeses(6);
    const grafico = meses.map((m) => ({
      mes: m,
      Inspecciones: datos.actividad.filter((a) => a.tipo === "inspecciones" && a.fecha.slice(0, 7) === m).length,
      Tasaciones: datos.actividad.filter((a) => a.tipo === "tasaciones" && a.fecha.slice(0, 7) === m).length,
    }));
    const porPersona = new Map();
    for (const a of datos.actividad) {
      const nombre = a.nombre || nombres.get(a.inspectorId) || a.inspectorId;
      const p = porPersona.get(nombre) || { nombre, inspecciones: 0, tasaciones: 0, ultima: "" };
      p[a.tipo === "inspecciones" ? "inspecciones" : "tasaciones"]++;
      if (a.fecha > p.ultima) p.ultima = a.fecha;
      porPersona.set(nombre, p);
    }
    return { activos: activos.length, inactivos: datos.usuarios.length - activos.length, porRol, porLocal, sinLocal, grafico,
      personas: Array.from(porPersona.values()).sort((a, b) => b.inspecciones + b.tasaciones - (a.inspecciones + a.tasaciones)),
      totalInsp: datos.actividad.filter((a) => a.tipo === "inspecciones").length, totalTas: datos.actividad.filter((a) => a.tipo === "tasaciones").length };
  }, [datos]);

  if (cargando && !datos) return <Cargando texto="Calculando reportes…" />;
  if (error) return <Aviso>{error}</Aviso>;

  const kpi = (titulo, valor, pie) => (
    <div className="bg-white border border-stone-200 p-5">
      <p className="text-xs uppercase tracking-widest text-stone-400">{titulo}</p>
      <p className="font-mono text-3xl text-stone-900 mt-1">{valor}</p>
      {pie && <p className="text-xs text-stone-500 mt-1">{pie}</p>}
    </div>
  );

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpi("Usuarios activos", resumen.activos, resumen.inactivos ? `${resumen.inactivos} desactivados` : "")}
        {kpi("Locales", datos.locales.filter((l) => l.activo).length)}
        {kpi("Inspecciones", resumen.totalInsp, "acumuladas")}
        {kpi("Tasaciones", resumen.totalTas, "acumuladas")}
      </div>

      <Tarjeta titulo="Actividad de los últimos 6 meses" ayuda="Inspecciones y tasaciones guardadas por todo el equipo.">
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={resumen.grafico} margin={{ top: 4, right: 12, left: -16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#78716C" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#78716C" }} />
              <Tooltip contentStyle={{ border: "1px solid #E7E5E4", fontSize: 13 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Inspecciones" fill="#0284C7" />
              <Bar dataKey="Tasaciones" fill="#D97706" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Tarjeta>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Tarjeta titulo="Personas por rol" ayuda="Una persona con varios roles cuenta en cada uno.">
          <table className="w-full text-sm"><tbody>
            {resumen.porRol.map((r) => <tr key={r.rol} className="border-b border-stone-100"><td className="py-1.5 text-stone-800">{rolNombre(r.rol)}</td><td className="py-1.5 text-right font-mono">{r.n}</td></tr>)}
          </tbody></table>
        </Tarjeta>
        <Tarjeta titulo="Personas por local">
          <table className="w-full text-sm"><tbody>
            {resumen.porLocal.map((l) => <tr key={l.nombre} className="border-b border-stone-100"><td className="py-1.5 text-stone-800">{l.nombre}</td><td className="py-1.5 text-right font-mono">{l.n}</td></tr>)}
            {resumen.sinLocal > 0 && <tr className="border-b border-stone-100"><td className="py-1.5 text-stone-500">Sin local</td><td className="py-1.5 text-right font-mono">{resumen.sinLocal}</td></tr>}
          </tbody></table>
          <p className="text-xs text-stone-500 mt-3">Perfiles anteriores por código: {datos.antiguos.ejecutivos} ejecutivos y {datos.antiguos.inspectores} inspectores.</p>
        </Tarjeta>
      </div>

      <div className="bg-white border border-stone-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-3 px-4">Persona</th><th className="py-3 px-4 text-right">Inspecciones</th><th className="py-3 px-4 text-right">Tasaciones</th><th className="py-3 px-4">Última actividad</th>
          </tr></thead>
          <tbody>
            {resumen.personas.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-stone-500">Aún no hay inspecciones ni tasaciones guardadas.</td></tr>}
            {resumen.personas.map((p) => (
              <tr key={p.nombre} className="border-b border-stone-100">
                <td className="py-2 px-4 text-stone-900">{p.nombre}</td>
                <td className="py-2 px-4 text-right font-mono">{p.inspecciones}</td>
                <td className="py-2 px-4 text-right font-mono">{p.tasaciones}</td>
                <td className="py-2 px-4 text-stone-500">{fechaHora(p.ultima)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Los reportes de leads, ventas, compras, consignaciones y comisiones se sumarán aquí cuando se construyan los perfiles de Ejecutivo y Jefe Local.</p>
    </>
  );
}

/* =========================================================
   ENTRADA: el AdminDashboard muestra la pestaña elegida
========================================================= */
export const PESTANAS_CRM = [
  ["crm-usuarios", "Usuarios"],
  ["crm-permisos", "Permisos"],
  ["crm-reportes", "Reportes"],
  ["crm-bitacora", "Bitácora"],
  ["crm-config", "Configuración"],
];

export function AdminCrmPanel({ tab }) {
  return (
    <>
      {tab === "crm-usuarios" && <UsuariosTab />}
      {tab === "crm-permisos" && <PermisosTab />}
      {tab === "crm-reportes" && <ReportesTab />}
      {tab === "crm-bitacora" && <BitacoraTab />}
      {tab === "crm-config" && <ConfigTab />}
    </>
  );
}
