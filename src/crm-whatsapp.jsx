/**
 * WHATSAPP BUSINESS (CRM)
 * ----------------------------------------------------------------
 * - Bandeja: cada ejecutivo ve las conversaciones de SUS leads (el Jefe Local, las del local), con los no leídos primero.
 * - Conversación: leer y responder texto, fotos y PDF. Pasadas 24 horas desde el último mensaje del cliente,
 *   WhatsApp solo permite plantillas aprobadas por Meta (se eligen y completan aquí).
 * - En la ficha del lead: la misma conversación, con el teléfono del cliente.
 * El servidor valida todo; aquí solo se muestra lo que corresponde.
 * ----------------------------------------------------------------
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { compressImage } from "./photos.js";
import { MAX_BYTES_MEDIA, CATEGORIAS_PLANTILLA, validarPlantillaNueva, variablesDe, nombrePlantilla, aplicarRespuesta, validarRespuestas, MAX_RESPUESTAS } from "../supabase/functions/api/whatsapp-core.js";
import { INPUT, BTN, BTN_PRIMARIO, Aviso, Cargando, Tarjeta, Campo, useCarga, mensajeError } from "./crm-ui.jsx";

const errorWa = (e) => (e && e.message === "whatsapp_error" && e.detalle ? `WhatsApp no aceptó el mensaje: ${e.detalle}` : mensajeError(e));

/** Repite `fn` cada `ms` mientras la pestaña está visible (y una vez al volver a ella). */
export function useCadaTanto(fn, ms, activo = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!activo) return undefined;
    const tic = () => { if (!document.hidden) ref.current(); };
    const id = setInterval(tic, ms);
    const alVolver = () => { if (!document.hidden) ref.current(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, [ms, activo]);
}

const hora = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia ? d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const diaDe = (iso) => new Date(iso).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });

function Tics({ m }) {
  if (m.direccion !== "saliente") return null;
  if (m.estado === "fallido") return <span className="text-rose-600 font-semibold" title={m.error || "No se pudo entregar"}>⚠ no entregado</span>;
  if (m.estado === "leido") return <span className="text-sky-500" title="Leído">✓✓</span>;
  if (m.estado === "entregado") return <span className="text-stone-400" title="Entregado">✓✓</span>;
  return <span className="text-stone-400" title="Enviado">✓</span>;
}

/** Abre (o muestra) el archivo de un mensaje: se pide al servidor solo cuando se quiere ver. */
function ArchivoMensaje({ api, m }) {
  const [src, setSrc] = useState("");
  const [estado, setEstado] = useState("");
  const media = m.media || {};
  const esImagen = m.tipo === "image" || m.tipo === "sticker";
  const cargar = async () => {
    setEstado("cargando");
    try {
      const r = await api("wa.media", { mensajeId: m.id });
      if (esImagen) { setSrc(r.dataUrl); setEstado(""); return; }
      const blob = await (await fetch(r.dataUrl)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noreferrer";
      if (!/^(application\/pdf|image\/)/.test(blob.type)) a.download = media.nombre || "archivo";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setEstado("");
    } catch (e) { setEstado(e && e.message === "archivo_muy_grande" ? "grande" : "error"); }
  };
  if (media.muy_grande) return <p className="text-xs italic text-stone-500">Archivo muy grande para el CRM: ábrelo en el teléfono de la empresa.</p>;
  if (src) return <img src={src} alt="Foto del mensaje" className="max-w-[240px] max-h-[240px] object-contain rounded-lg cursor-zoom-in" onClick={() => window.open(src, "_blank")} />;
  const etiqueta = { image: "📷 Ver foto", sticker: "Ver sticker", document: `📄 ${media.nombre || "Abrir documento"}`, audio: "🎤 Escuchar audio", video: "🎬 Ver video" }[m.tipo] || "Abrir archivo";
  return (
    <button type="button" onClick={cargar} disabled={estado === "cargando"} className="text-sm text-sky-700 hover:underline text-left">
      {estado === "cargando" ? "Cargando…" : estado === "error" ? "No se pudo abrir (reintentar)" : estado === "grande" ? "Muy grande: ábrelo en el teléfono" : etiqueta}
    </button>
  );
}

/** Elige una plantilla aprobada, completa sus variables y la envía. */
function SelectorPlantilla({ api, onEnviar, ocupado, onCancelar }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("wa.plantillas", {}), [api]);
  const [sel, setSel] = useState("");
  const [valores, setValores] = useState([]);
  if (cargando && !datos) return <Cargando texto="Cargando plantillas…" />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const lista = datos.plantillas || [];
  const p = lista.find((x) => `${x.nombre}|${x.idioma}` === sel) || null;
  let vista = p ? p.cuerpo : "";
  if (p) p.variables.forEach((v, i) => { vista = vista.split(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`)).join(valores[i] ? valores[i] : `[${v}]`); });
  const listo = p && p.variables.every((_, i) => (valores[i] || "").trim());
  return (
    <div className="border border-emerald-200 bg-emerald-50/50 p-3 flex flex-col gap-2">
      {datos.error && <Aviso>No se pudieron cargar las plantillas de Meta: {datos.error}</Aviso>}
      {!datos.error && lista.length === 0 && <p className="text-sm text-stone-600">No hay plantillas aprobadas que se puedan completar desde el CRM. Créalas en WhatsApp Manager de Meta (solo con variables en el cuerpo) y espera su aprobación. <button type="button" onClick={() => api("wa.plantillas", { recargar: true }).then(recargar)} className="text-sky-700 hover:underline">Volver a buscar</button></p>}
      {lista.length > 0 && (
        <Campo etiqueta="Plantilla aprobada">
          <select value={sel} onChange={(e) => { setSel(e.target.value); setValores([]); }} className={INPUT}>
            <option value="">Elige una plantilla…</option>
            {lista.map((x) => <option key={`${x.nombre}|${x.idioma}`} value={`${x.nombre}|${x.idioma}`}>{x.nombre.replace(/_/g, " ")} · {x.idioma}{x.categoria ? ` · ${x.categoria.toLowerCase()}` : ""}</option>)}
          </select>
        </Campo>
      )}
      {p && (
        <>
          {p.variables.map((v, i) => (
            <Campo key={v} etiqueta={/^\d+$/.test(v) ? `Variable {{${v}}}` : v.replace(/_/g, " ")}>
              <input value={valores[i] || ""} maxLength={200} onChange={(e) => { const n = [...valores]; n[i] = e.target.value; setValores(n); }} className={INPUT} />
            </Campo>
          ))}
          <div className="bg-white border border-stone-200 p-2 text-sm whitespace-pre-wrap text-stone-800">
            {p.encabezado && <p className="font-semibold">{p.encabezado}</p>}{vista}{p.pie && <p className="text-xs text-stone-500 mt-1">{p.pie}</p>}
            {p.botones.length > 0 && <p className="text-xs text-sky-700 mt-1">{p.botones.join(" · ")}</p>}
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={!listo || ocupado} onClick={() => onEnviar({ nombre: p.nombre, idioma: p.idioma, valores: p.variables.map((_, i) => valores[i] || "") })} className={BTN_PRIMARIO}>{ocupado ? "Enviando…" : "Enviar plantilla"}</button>
        <button type="button" onClick={onCancelar} className={BTN}>Cancelar</button>
      </div>
    </div>
  );
}

const leerArchivo = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error("archivo_invalido"));
  fr.readAsDataURL(file);
});

/** Lista de respuestas rápidas del local para insertar en el mensaje (se puede buscar por título o texto). */
function SelectorRespuestas({ api, cliente, ejecutivo, onElegir, onCerrar }) {
  const { cargando, datos } = useCarga(() => api("wa.respuestas", {}), [api]);
  const [q, setQ] = useState("");
  const lista = ((datos && datos.respuestas) || []).filter((r) => { const t = q.trim().toLowerCase(); return !t || r.titulo.toLowerCase().includes(t) || r.texto.toLowerCase().includes(t); });
  return (
    <div className="border border-stone-200 bg-white shadow-sm p-2 flex flex-col gap-2 max-h-72">
      <div className="flex gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar respuesta…" className={`${INPUT} flex-1`} />
        <button type="button" onClick={onCerrar} className={BTN}>Cerrar</button>
      </div>
      {cargando && !datos && <Cargando />}
      <div className="overflow-y-auto flex flex-col">
        {lista.length === 0 && datos && <p className="text-xs text-stone-500 p-2">No hay respuestas que coincidan.</p>}
        {lista.map((r, i) => {
          const texto = aplicarRespuesta(r.texto, { cliente, ejecutivo });
          return (
            <button key={i} type="button" onClick={() => onElegir(texto)} className="text-left px-2 py-1.5 hover:bg-amber-50 border-b border-stone-100">
              <span className="block text-sm font-medium text-stone-900">{r.titulo}</span>
              <span className="block text-xs text-stone-500 truncate">{texto}</span>
            </button>
          );
        })}
      </div>
      {datos && datos.predeterminadas && <p className="text-[11px] text-stone-400 px-1">Respuestas sugeridas. {datos.puedeEditar ? "Personalízalas en WhatsApp → Respuestas rápidas." : "El Jefe Local puede personalizarlas."}</p>}
    </div>
  );
}

/**
 * Una conversación: por su id (bandeja) o por el lead (ficha del lead).
 * Se actualiza sola cada pocos segundos y queda leída al mirarla.
 */
export function ChatWhatsapp({ api, conversacionId, leadId, alto = "h-[28rem]", onCambio = () => {} }) {
  const [msg, setMsg] = useState("");
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState(null); // { nombre, tipo, dataUrl }
  const [plantilla, setPlantilla] = useState(false);
  const [respuestas, setRespuestas] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const fondo = useRef(null);
  const areaTexto = useRef(null);
  const params = conversacionId ? { id: conversacionId } : { leadId };
  const { cargando, error, datos, recargar } = useCarga(() => api("wa.conversacion", params), [api, conversacionId, leadId]);
  useCadaTanto(recargar, 8000);
  const conv = datos && datos.conversacion;
  const cuantos = datos ? datos.mensajes.length : 0;

  // Al llegar mensajes nuevos: baja al final y los marca como leídos.
  useEffect(() => { if (fondo.current) fondo.current.scrollTop = fondo.current.scrollHeight; }, [cuantos, conv && conv.id]);
  useEffect(() => {
    if (conv && conv.no_leidos > 0) api("wa.leer", { id: conv.id }).then(onCambio).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv && conv.id, conv && conv.no_leidos]);

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (!datos.configurado) return <Aviso tipo="info">WhatsApp aún no está conectado al CRM. El Administrador debe cargar las credenciales de Meta.</Aviso>;
  if (datos.sinTelefono) return <p className="text-sm text-stone-500">El cliente no tiene teléfono registrado. Agrégalo con «Editar datos» para escribirle por WhatsApp.</p>;

  const enviar = async (extra) => {
    setMsg(""); setOcupado(true);
    try {
      await api("wa.enviar", { ...params, ...extra });
      setTexto(""); setArchivo(null); setPlantilla(false);
      await recargar(); onCambio();
    } catch (e) { setMsg(errorWa(e)); }
    setOcupado(false);
  };
  const elegirArchivo = async (ev) => {
    const f = (ev.target.files || [])[0];
    ev.target.value = "";
    if (!f) return;
    setMsg("");
    try {
      const esPdf = f.type === "application/pdf";
      if (!esPdf && !/^image\/(jpeg|png)$/.test(f.type) && !f.type.startsWith("image/")) throw new Error("archivo_tipo_invalido");
      if (esPdf && f.size > MAX_BYTES_MEDIA) throw new Error("archivo_muy_grande");
      const dataUrl = esPdf ? await leerArchivo(f) : await compressImage(f);
      setArchivo({ nombre: esPdf ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg", tipo: esPdf ? "application/pdf" : "image/jpeg", dataUrl });
    } catch (e) { setMsg(mensajeError(e)); }
  };

  const mensajes = datos.mensajes;
  const abierta = datos.ventanaAbierta;
  let diaAnterior = "";

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="font-mono">{conv ? conv.telefono_visible : datos.telefono_visible}</span>
        {datos.lead && datos.lead.asignado && <span>· Atiende {datos.lead.asignado}</span>}
        {abierta
          ? <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800" title="Puedes responder libremente hasta esa hora">Responde libre hasta {hora(datos.venceVentana)}</span>
          : <span className="px-2 py-0.5 bg-amber-100 text-amber-800">Solo plantillas (sin mensaje del cliente en 24 h)</span>}
      </div>
      <div ref={fondo} className={`${alto} overflow-y-auto bg-[#efeae2] border border-stone-200 p-3 flex flex-col gap-1.5`}>
        {mensajes.length === 0 && <p className="m-auto text-sm text-stone-500 text-center max-w-xs">Aún no hay mensajes. Para escribirle primero al cliente usa una plantilla aprobada.</p>}
        {mensajes.map((m) => {
          const dia = diaDe(m.wa_ts || m.creado_en);
          const sep = dia !== diaAnterior ? dia : "";
          diaAnterior = dia;
          const sale = m.direccion === "saliente";
          return (
            <React.Fragment key={m.id}>
              {sep && <p className="self-center text-[11px] bg-white/80 text-stone-600 px-2 py-0.5 rounded my-1">{sep}</p>}
              <div className={`max-w-[85%] px-3 py-1.5 rounded-lg shadow-sm text-sm ${sale ? "self-end bg-[#d9fdd3]" : "self-start bg-white"}`}>
                {m.tipo === "template" && <p className="text-[10px] uppercase tracking-wide text-emerald-700">Plantilla · {String(m.plantilla || "").replace(/_/g, " ")}</p>}
                {m.media && <ArchivoMensaje api={api} m={m} />}
                {m.texto && <p className="whitespace-pre-wrap break-words text-stone-900">{m.texto}</p>}
                <p className="text-[10px] text-stone-500 text-right mt-0.5 flex gap-1.5 justify-end items-center">
                  {sale && m.usuario_nombre && <span>{m.usuario_nombre.split(" ")[0]}</span>}
                  <span>{hora(m.wa_ts || m.creado_en)}</span>
                  <Tics m={m} />
                </p>
                {m.estado === "fallido" && m.error && <p className="text-[11px] text-rose-700">{m.error}</p>}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      {datos.puedeEscribir && plantilla && <SelectorPlantilla api={api} ocupado={ocupado} onEnviar={(p) => enviar({ plantilla: p })} onCancelar={() => setPlantilla(false)} />}
      {datos.puedeEscribir && !plantilla && (
        abierta ? (
          <div className="flex flex-col gap-2">
            {archivo && (
              <div className="flex items-center gap-2 text-sm bg-stone-50 border border-stone-200 px-2 py-1">
                <span>{archivo.tipo === "application/pdf" ? "📄" : "📷"} {archivo.nombre}</span>
                <button type="button" onClick={() => setArchivo(null)} className="ml-auto text-rose-600 hover:underline text-xs">Quitar</button>
              </div>
            )}
            {respuestas && (
              <SelectorRespuestas api={api} cliente={(datos.cliente && datos.cliente.nombre) || ""} ejecutivo={datos.yo || ""} onCerrar={() => setRespuestas(false)}
                onElegir={(t) => { setTexto((x) => (x.trim() ? `${x.trimEnd()}\n${t}` : t)); setRespuestas(false); setTimeout(() => areaTexto.current && areaTexto.current.focus(), 0); }} />
            )}
            <div className="flex gap-2 items-end">
              <label className={`${BTN} cursor-pointer shrink-0`} title="Adjuntar foto o PDF">📎<input type="file" accept="image/*,application/pdf" onChange={elegirArchivo} className="hidden" /></label>
              <button type="button" onClick={() => setRespuestas((x) => !x)} className={`${BTN} shrink-0`} title="Respuestas rápidas">⚡</button>
              <textarea ref={areaTexto} value={texto} rows={2} maxLength={4096} placeholder={archivo ? "Texto que acompaña el archivo (opcional)" : "Escribe un mensaje…"}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (texto.trim() || archivo) && !ocupado) { e.preventDefault(); enviar(archivo ? { archivo, texto } : { texto }); } }}
                className={`${INPUT} flex-1 resize-none`} />
              <button type="button" disabled={ocupado || (!texto.trim() && !archivo)} onClick={() => enviar(archivo ? { archivo, texto } : { texto })} className={`${BTN_PRIMARIO} shrink-0`}>{ocupado ? "…" : "Enviar"}</button>
            </div>
            <div className="flex justify-between text-[11px] text-stone-500">
              <span>Enter envía · Shift + Enter, nueva línea · ⚡ respuestas rápidas</span>
              <button type="button" onClick={() => setPlantilla(true)} className="text-sky-700 hover:underline">Usar una plantilla</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-stone-600 flex-1 min-w-[14rem]">Pasaron más de 24 horas desde el último mensaje del cliente (o aún no escribe). WhatsApp solo permite enviar una plantilla aprobada; cuando responda, podrás escribir libremente.</p>
            <button type="button" onClick={() => setPlantilla(true)} className={BTN_PRIMARIO}>Enviar plantilla</button>
          </div>
        )
      )}
      {!datos.puedeEscribir && datos.configurado && <p className="text-xs text-stone-500">Solo lectura: responde quien atiende el lead.</p>}
    </div>
  );
}

/** Sección de la ficha del lead: la conversación de WhatsApp con el cliente. */
export function SeccionWhatsapp({ api, leadId, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Tarjeta titulo="WhatsApp" derecha={<button type="button" onClick={() => setAbierto((x) => !x)} className={BTN}>{abierto ? "Ocultar" : "Ver conversación"}</button>}>
      {abierto ? <ChatWhatsapp api={api} leadId={leadId} alto="h-80" onCambio={onCambio} /> : <p className="text-sm text-stone-500">Conversación con el cliente por el WhatsApp de la empresa.</p>}
    </Tarjeta>
  );
}

/** Estado de la conexión y el local de los leads nuevos (solo el Administrador). */
function ConfigWhatsapp({ api, locales }) {
  const { cargando, datos, recargar } = useCarga(() => api("wa.estado", {}), [api]);
  const [msg, setMsg] = useState("");
  if (cargando && !datos) return null;
  if (!datos || !datos.puedeConfigurar) return null;
  const s = datos.secretos || {};
  const url = "https://lvcmstvcbbvltompunbr.supabase.co/functions/v1/api?whatsapp=1";
  const guardar = async (localId) => { setMsg(""); try { await api("wa.config_save", { localId }); await recargar(); setMsg("Guardado."); } catch (e) { setMsg(mensajeError(e)); } };
  return (
    <Tarjeta titulo="Conexión con WhatsApp (Administrador)" ayuda="Las credenciales se cargan como secretos en Supabase; aquí solo se ve si están.">
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap gap-2">
          {Object.entries(s).map(([k, ok]) => <span key={k} className={`text-xs px-2 py-0.5 font-mono ${ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{ok ? "✓" : "✗"} {k}</span>)}
        </div>
        <p>URL del webhook (en Meta → WhatsApp → Configuración): <span className="font-mono text-xs bg-stone-100 px-1 select-all">{url}</span></p>
        <Campo etiqueta="Local donde entran los leads nuevos de WhatsApp">
          <select value={datos.localLeads || ""} onChange={(e) => guardar(e.target.value)} className={`${INPUT} md:w-72`}>
            <option value="">Automático (el primer local activo)</option>
            {(locales || []).filter((l) => l.activo).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </Campo>
        {msg && <p className="text-xs text-stone-600">{msg}</p>}
      </div>
    </Tarjeta>
  );
}

/** Respuestas rápidas del local (Administrador y Jefe Local): títulos y textos que el equipo inserta con ⚡. */
function AdminRespuestas({ api }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("wa.respuestas", {}), [api]);
  const [lista, setLista] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (datos) setLista(datos.respuestas.map((r) => ({ ...r }))); }, [datos]);
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  if (!lista) return null;
  const cambiar = (i, k, v) => setLista(lista.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const mover = (i, d) => { const n = [...lista]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setLista(n); };
  const guardar = async () => {
    setMsg(null);
    const v = validarRespuestas(lista);
    if (!v.ok) { setMsg({ ok: false, texto: mensajeError({ message: v.error }) }); return; }
    setOcupado(true);
    try { await api("wa.respuestas_guardar", { respuestas: v.value }); setMsg({ ok: true, texto: "Respuestas guardadas: el equipo ya las ve en el botón ⚡ de cada conversación." }); await recargar(); }
    catch (e) { setMsg({ ok: false, texto: mensajeError(e) }); }
    setOcupado(false);
  };
  return (
    <Tarjeta titulo="Respuestas rápidas" ayuda="Textos que el equipo inserta con un clic (botón ⚡) al escribir dentro de las 24 horas. Usa {cliente} y {ejecutivo}: se reemplazan por el nombre del cliente y de quien escribe. No pasan por Meta y no tienen costo."
      derecha={<button type="button" disabled={lista.length >= MAX_RESPUESTAS} onClick={() => setLista([...lista, { titulo: "", texto: "" }])} className={BTN}>+ Agregar</button>}>
      {datos.predeterminadas && <p className="text-xs text-amber-700 mb-3">Son las respuestas sugeridas: ajústalas y pulsa «Guardar» para dejarlas como las de tu local.</p>}
      <div className="flex flex-col gap-3">
        {lista.map((r, i) => (
          <div key={i} className="border border-stone-200 p-3 flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <input value={r.titulo} maxLength={40} onChange={(e) => cambiar(i, "titulo", e.target.value)} placeholder="Título (ej.: Horario de atención)" className={`${INPUT} flex-1`} />
              <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className={BTN} title="Subir">↑</button>
              <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} className={BTN} title="Bajar">↓</button>
              <button type="button" onClick={() => setLista(lista.filter((_, j) => j !== i))} className="text-xs text-rose-600 hover:underline px-1">Quitar</button>
            </div>
            <textarea rows={2} value={r.texto} maxLength={1000} onChange={(e) => cambiar(i, "texto", e.target.value)} placeholder="Texto de la respuesta…" className={INPUT} />
          </div>
        ))}
        {lista.length === 0 && <p className="text-sm text-stone-500">No hay respuestas. Agrega la primera con «+ Agregar».</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button type="button" onClick={guardar} disabled={ocupado} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : "Guardar"}</button>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</p>}
      </div>
    </Tarjeta>
  );
}

/** Modelos para partir: el usuario los ajusta antes de enviarlos a Meta. */
const MODELOS_PLANTILLA = [
  { titulo: "Seguimiento de cotización", nombre: "seguimiento_cotizacion", categoria: "MARKETING", encabezado: "", cuerpo: "Hola {{1}}, te escribo de Drive Futuro. ¿Pudiste revisar la cotización del {{2}}? Quedo atento a tus dudas.", pie: "Responde a este mensaje para hablar con tu ejecutivo", botones: ["Sí, me interesa", "Más adelante"], ejemplos: ["Pedro", "Toyota Yaris 2020"] },
  { titulo: "Recordatorio de visita", nombre: "recordatorio_visita", categoria: "UTILITY", encabezado: "Recordatorio de visita", cuerpo: "Hola {{1}}, te recordamos tu visita a Drive Futuro el {{2}}. Si necesitas cambiar la hora, responde este mensaje.", pie: "", botones: ["Confirmo", "Cambiar hora"], ejemplos: ["Pedro", "viernes 20 de noviembre a las 11:00"] },
  { titulo: "Nuevo vehículo disponible", nombre: "nuevo_vehiculo_disponible", categoria: "MARKETING", encabezado: "", cuerpo: "Hola {{1}}, llegó un {{2}} que puede interesarte. ¿Quieres que te envíe fotos y el precio?", pie: "", botones: ["Sí, envíame", "No, gracias"], ejemplos: ["Pedro", "Hyundai Tucson 2022"] },
  { titulo: "Documentos pendientes", nombre: "documentos_pendientes", categoria: "UTILITY", encabezado: "", cuerpo: "Hola {{1}}, para avanzar con tu {{2}} nos falta recibir algunos documentos. ¿Me los puedes enviar por este medio?", pie: "", botones: [], ejemplos: ["Pedro", "compra del vehículo"] },
];
const VACIA = { nombre: "", categoria: "MARKETING", encabezado: "", cuerpo: "", pie: "", botones: ["", "", ""], ejemplos: [] };
const COLOR_ESTADO = { APPROVED: "bg-emerald-100 text-emerald-800", PENDING: "bg-amber-100 text-amber-800", IN_APPEAL: "bg-amber-100 text-amber-800", REJECTED: "bg-rose-100 text-rose-800", PAUSED: "bg-stone-200 text-stone-700", DISABLED: "bg-stone-200 text-stone-700" };

/**
 * Plantillas de WhatsApp (Administrador y Jefe Local): se crean aquí y se envían a Meta para su aprobación, sin entrar a Meta.
 * Solo las aprobadas aparecen al ejecutivo para escribir primero o pasadas las 24 horas.
 */
function AdminPlantillas({ api }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("wa.plantillas_admin", {}), [api]);
  const [f, setF] = useState(null); // formulario abierto
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const errorWaLocal = (e) => (e && e.message === "whatsapp_error" && e.detalle ? `Meta rechazó la solicitud: ${e.detalle}` : mensajeError(e));

  const vars = f ? variablesDe(f.cuerpo) : [];
  const ejemplosVista = (txt) => { let t = txt; vars.forEach((v, i) => { t = t.split(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`)).join(f.ejemplos[i] || `[${v}]`); }); return t; };
  const agregarVariable = () => setF({ ...f, cuerpo: `${f.cuerpo}{{${vars.length + 1}}}` });
  const enviar = async () => {
    setMsg(null);
    const datosP = { ...f, botones: f.botones.filter((b) => b.trim()) };
    const v = validarPlantillaNueva(datosP);
    if (!v.ok) { setMsg({ ok: false, texto: mensajeError({ message: v.error }) }); return; }
    setOcupado(true);
    try {
      const r = await api("wa.plantilla_crear", { plantilla: datosP });
      setF(null);
      setMsg({ ok: true, texto: `Plantilla «${r.plantilla.nombre}» enviada a Meta. Suele quedar aprobada en minutos (a veces hasta 24 horas); cuando diga «Aprobada», los ejecutivos ya la pueden usar.` });
      await recargar();
    } catch (e) { setMsg({ ok: false, texto: errorWaLocal(e) }); }
    setOcupado(false);
  };
  const borrar = async (p) => {
    if (!window.confirm(`¿Borrar la plantilla «${p.nombre}»? Meta no deja volver a usar ese nombre por 30 días.`)) return;
    setMsg(null); setOcupado(true);
    try { await api("wa.plantilla_borrar", { nombre: p.nombre }); setMsg({ ok: true, texto: `Plantilla «${p.nombre}» borrada.` }); await recargar(); } catch (e) { setMsg({ ok: false, texto: errorWaLocal(e) }); }
    setOcupado(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta titulo="Plantillas de WhatsApp" ayuda="Mensajes aprobados por Meta para escribirle primero al cliente o cuando pasaron más de 24 horas desde su último mensaje. Se crean aquí y Meta las revisa (las de «Marketing» tienen costo por envío)."
        derecha={!f && <button type="button" onClick={() => { setMsg(null); setF({ ...VACIA, botones: ["", "", ""] }); }} className={BTN_PRIMARIO}>+ Nueva plantilla</button>}>
        {msg && <p className={`text-sm mb-3 ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</p>}
        {f && (
          <div className="border border-stone-200 bg-stone-50 p-4 flex flex-col gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-stone-600">Partir de un modelo:</span>
              {MODELOS_PLANTILLA.map((m) => <button key={m.nombre} type="button" onClick={() => setF({ ...m, botones: [...m.botones, "", "", ""].slice(0, 3) })} className={BTN}>{m.titulo}</button>)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <Campo etiqueta="Nombre (solo para identificarla)">
                  <input value={f.nombre} maxLength={60} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="seguimiento_cotizacion" className={INPUT} />
                  {f.nombre && <span className="text-xs text-stone-500">Se guardará como <span className="font-mono">{nombrePlantilla(f.nombre)}</span></span>}
                </Campo>
                <Campo etiqueta="Tipo">
                  <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className={INPUT}>{CATEGORIAS_PLANTILLA.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
                </Campo>
                <Campo etiqueta="Encabezado (opcional, en negrita)"><input value={f.encabezado} maxLength={60} onChange={(e) => setF({ ...f, encabezado: e.target.value })} className={INPUT} /></Campo>
                <Campo etiqueta="Mensaje">
                  <textarea rows={4} value={f.cuerpo} maxLength={1024} onChange={(e) => setF({ ...f, cuerpo: e.target.value })} placeholder="Hola {{1}}, ..." className={INPUT} />
                  <span className="text-xs text-stone-500">Usa <span className="font-mono">{"{{1}}"}</span>, <span className="font-mono">{"{{2}}"}</span>… donde va un dato que cambia (nombre del cliente, vehículo, fecha). <button type="button" onClick={agregarVariable} className="text-sky-700 hover:underline">Agregar variable</button></span>
                </Campo>
                {vars.map((v, i) => (
                  <Campo key={v} etiqueta={`Ejemplo para {{${v}}}`}>
                    <input value={f.ejemplos[i] || ""} maxLength={100} onChange={(e) => { const ej = [...f.ejemplos]; ej[i] = e.target.value; setF({ ...f, ejemplos: ej }); }} placeholder={i === 0 ? "Pedro" : "Toyota Yaris 2020"} className={INPUT} />
                  </Campo>
                ))}
                <Campo etiqueta="Pie (opcional, texto pequeño)"><input value={f.pie} maxLength={60} onChange={(e) => setF({ ...f, pie: e.target.value })} className={INPUT} /></Campo>
                <Campo etiqueta="Botones de respuesta rápida (opcional, hasta 3)">
                  <div className="flex flex-col gap-2">{f.botones.map((b, i) => <input key={i} value={b} maxLength={25} onChange={(e) => { const bs = [...f.botones]; bs[i] = e.target.value; setF({ ...f, botones: bs }); }} placeholder={i === 0 ? "Sí, me interesa" : ""} className={INPUT} />)}</div>
                </Campo>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-wide text-stone-500">Así lo verá el cliente</p>
                <div className="bg-[#efeae2] p-4 rounded-lg">
                  <div className="bg-white rounded-lg shadow-sm px-3 py-2 text-sm max-w-sm">
                    {f.encabezado && <p className="font-semibold mb-1">{f.encabezado}</p>}
                    <p className="whitespace-pre-wrap text-stone-900">{ejemplosVista(f.cuerpo) || <span className="text-stone-400">Escribe el mensaje…</span>}</p>
                    {f.pie && <p className="text-xs text-stone-500 mt-1">{f.pie}</p>}
                  </div>
                  {f.botones.filter((b) => b.trim()).map((b, i) => <div key={i} className="bg-white rounded-lg shadow-sm px-3 py-1.5 text-sm text-sky-700 text-center mt-1 max-w-sm">{b}</div>)}
                </div>
                <p className="text-xs text-stone-500">Consejos para que Meta la apruebe: escribe un mensaje claro y propio del negocio, sin mayúsculas exageradas ni promesas engañosas, y no empieces ni termines con una variable.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={enviar} disabled={ocupado} className={BTN_PRIMARIO}>{ocupado ? "Enviando…" : "Enviar a Meta para aprobación"}</button>
              <button type="button" onClick={() => setF(null)} className={BTN}>Cancelar</button>
            </div>
          </div>
        )}
        {cargando && !datos && <Cargando />}
        {error && !datos && <Aviso>{error}</Aviso>}
        {datos && datos.plantillas.length === 0 && <p className="text-sm text-stone-500">Aún no hay plantillas. Crea la primera con «Nueva plantilla».</p>}
        {datos && datos.plantillas.length > 0 && (
          <ul className="flex flex-col divide-y divide-stone-100">
            {datos.plantillas.map((p) => (
              <li key={`${p.nombre}-${p.idioma}`} className="py-3 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-stone-900">{p.nombre}</span>
                  <span className={`text-[11px] px-2 py-0.5 ${COLOR_ESTADO[p.estado] || "bg-stone-100 text-stone-600"}`}>{p.estadoNombre}</span>
                  <span className="text-xs text-stone-500">{p.categoria === "MARKETING" ? "Marketing" : p.categoria === "UTILITY" ? "Servicio" : p.categoria} · {p.idioma}</span>
                  <button type="button" disabled={ocupado} onClick={() => borrar(p)} className="ml-auto text-xs text-rose-600 hover:underline">Borrar</button>
                </div>
                <p className="text-sm text-stone-700 whitespace-pre-wrap">{p.encabezado ? <b>{p.encabezado} · </b> : null}{p.cuerpo}</p>
                {p.estado === "REJECTED" && <p className="text-xs text-rose-700">Meta la rechazó{p.motivo ? ` (motivo: ${p.motivo})` : ""}. Ajusta el texto y créala de nuevo con otro nombre.</p>}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}

/** Bandeja del ejecutivo: sus conversaciones (no leídas primero) y la conversación elegida al lado. */
export function BandejaWhatsapp({ api, abrirLead, locales, onCambio = () => {} }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("wa.list", {}), [api]);
  useCadaTanto(recargar, 15000);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [soloNoLeidos, setSoloNoLeidos] = useState(false);
  const [vista, setVista] = useState("conversaciones"); // conversaciones | plantillas
  const alCambiar = useCallback(() => { recargar(); onCambio(); }, [recargar, onCambio]);

  const lista = useMemo(() => {
    if (!datos) return [];
    const t = q.trim().toLowerCase();
    return datos.conversaciones
      .filter((c) => (!soloNoLeidos || c.no_leidos > 0) && (!t || [c.nombre, c.telefono, c.telefono_visible, c.ultimo_texto, c.asignado].some((x) => String(x || "").toLowerCase().includes(t))))
      .sort((a, b) => (b.no_leidos > 0) - (a.no_leidos > 0) || String(b.ultimo_mensaje_en || "").localeCompare(String(a.ultimo_mensaje_en || "")));
  }, [datos, q, soloNoLeidos]);

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const actual = sel && datos.conversaciones.find((c) => c.id === sel);
  const noLeidos = datos.conversaciones.reduce((s, c) => s + c.no_leidos, 0);

  return (
    <div className="flex flex-col gap-4">
      <ConfigWhatsapp api={api} locales={locales} />
      {(datos.puedePlantillas || datos.puedeRespuestas) && (
        <div className="flex border border-stone-300 self-start">
          <button type="button" onClick={() => setVista("conversaciones")} className={`px-3 py-1.5 text-sm ${vista === "conversaciones" ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Conversaciones</button>
          {datos.puedeRespuestas && <button type="button" onClick={() => setVista("respuestas")} className={`px-3 py-1.5 text-sm ${vista === "respuestas" ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Respuestas rápidas</button>}
          {datos.puedePlantillas && <button type="button" onClick={() => setVista("plantillas")} className={`px-3 py-1.5 text-sm ${vista === "plantillas" ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>Plantillas</button>}
        </div>
      )}
      {vista === "respuestas" && datos.puedeRespuestas ? <AdminRespuestas api={api} /> : vista === "plantillas" && datos.puedePlantillas ? <AdminPlantillas api={api} /> : <>
      {!datos.configurado && <Aviso tipo="info">WhatsApp aún no está conectado: cuando el Administrador cargue las credenciales de Meta, aquí aparecerán las conversaciones.</Aviso>}
      <div className="grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-4 items-start">
        <div className={`bg-white border border-stone-200 flex flex-col ${actual ? "hidden lg:flex" : ""}`}>
          <div className="p-3 border-b border-stone-200 flex flex-col gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, teléfono o mensaje" className={INPUT} />
            <label className="flex items-center gap-2 text-xs text-stone-600"><input type="checkbox" checked={soloNoLeidos} onChange={(e) => setSoloNoLeidos(e.target.checked)} /> Solo no leídos {noLeidos > 0 && `(${noLeidos})`}</label>
          </div>
          <div className="max-h-[34rem] overflow-y-auto">
            {lista.length === 0 && <p className="p-4 text-sm text-stone-500">{datos.conversaciones.length === 0 ? "Aún no tienes conversaciones. Cuando un cliente de tus leads escriba al WhatsApp de la empresa, aparecerá aquí." : "Ninguna coincide."}</p>}
            {lista.map((c) => (
              <button key={c.id} type="button" onClick={() => setSel(c.id)} className={`w-full text-left px-3 py-2.5 border-b border-stone-100 flex gap-2 hover:bg-stone-50 ${sel === c.id ? "bg-amber-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className={`truncate ${c.no_leidos ? "font-semibold text-stone-900" : "text-stone-800"}`}>{c.nombre}</p>
                    <span className="ml-auto text-[11px] text-stone-400 shrink-0">{hora(c.ultimo_mensaje_en)}</span>
                  </div>
                  <p className="text-xs text-stone-500 truncate">{c.ultima_direccion === "saliente" ? "Tú: " : ""}{c.ultimo_texto || "—"}</p>
                  {c.asignado && <p className="text-[11px] text-stone-400 truncate">Atiende {c.asignado}</p>}
                </div>
                {c.no_leidos > 0 && <span className="self-center text-xs bg-emerald-500 text-white rounded-full min-w-[1.4rem] text-center px-1.5 py-0.5">{c.no_leidos}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className={`${actual ? "" : "hidden lg:block"}`}>
          {actual ? (
            <Tarjeta titulo={actual.nombre} derecha={
              <div className="flex gap-2">
                <button type="button" onClick={() => setSel(null)} className={`${BTN} lg:hidden`}>← Volver</button>
                {actual.lead_id && abrirLead && <button type="button" onClick={() => abrirLead(actual.lead_id)} className={BTN}>Abrir lead</button>}
              </div>}>
              <ChatWhatsapp key={actual.id} api={api} conversacionId={actual.id} onCambio={alCambiar} />
            </Tarjeta>
          ) : <div className="bg-white border border-stone-200 p-8 text-center text-sm text-stone-500">Elige una conversación.</div>}
        </div>
      </div>
      </>}
    </div>
  );
}

