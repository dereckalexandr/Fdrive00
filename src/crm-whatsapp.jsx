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
import { MAX_BYTES_MEDIA } from "../supabase/functions/api/whatsapp-core.js";
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

/**
 * Una conversación: por su id (bandeja) o por el lead (ficha del lead).
 * Se actualiza sola cada pocos segundos y queda leída al mirarla.
 */
export function ChatWhatsapp({ api, conversacionId, leadId, alto = "h-[28rem]", onCambio = () => {} }) {
  const [msg, setMsg] = useState("");
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState(null); // { nombre, tipo, dataUrl }
  const [plantilla, setPlantilla] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const fondo = useRef(null);
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
            <div className="flex gap-2 items-end">
              <label className={`${BTN} cursor-pointer shrink-0`} title="Adjuntar foto o PDF">📎<input type="file" accept="image/*,application/pdf" onChange={elegirArchivo} className="hidden" /></label>
              <textarea value={texto} rows={2} maxLength={4096} placeholder={archivo ? "Texto que acompaña el archivo (opcional)" : "Escribe un mensaje…"}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (texto.trim() || archivo) && !ocupado) { e.preventDefault(); enviar(archivo ? { archivo, texto } : { texto }); } }}
                className={`${INPUT} flex-1 resize-none`} />
              <button type="button" disabled={ocupado || (!texto.trim() && !archivo)} onClick={() => enviar(archivo ? { archivo, texto } : { texto })} className={`${BTN_PRIMARIO} shrink-0`}>{ocupado ? "…" : "Enviar"}</button>
            </div>
            <div className="flex justify-between text-[11px] text-stone-500">
              <span>Enter envía · Shift + Enter, nueva línea</span>
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

/** Bandeja del ejecutivo: sus conversaciones (no leídas primero) y la conversación elegida al lado. */
export function BandejaWhatsapp({ api, abrirLead, locales, onCambio = () => {} }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("wa.list", {}), [api]);
  useCadaTanto(recargar, 15000);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [soloNoLeidos, setSoloNoLeidos] = useState(false);
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
    </div>
  );
}

