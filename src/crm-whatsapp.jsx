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
import { webmOpusAOgg } from "./webm-ogg.js";
import { RESTRICCIONES_MICROFONO, armarCadenaVoz, nivelAnalizador } from "./voz-audio.js";
import { MAX_BYTES_MEDIA, TIPOS_AUDIO, CATEGORIAS_PLANTILLA, validarPlantillaNueva, variablesDe, nombrePlantilla, aplicarRespuesta, validarRespuestas, MAX_RESPUESTAS } from "../supabase/functions/api/whatsapp-core.js";
import { INPUT, BTN, BTN_PRIMARIO, Aviso, Cargando, Tarjeta, Campo, useCarga, mensajeError, hace } from "./crm-ui.jsx";

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
  const esAudio = m.tipo === "audio";
  const cargar = async () => {
    setEstado("cargando");
    try {
      const r = await api("wa.media", { mensajeId: m.id });
      // Los audios antiguos se guardaron como «data:audio/ogg; codecs=opus;base64,…»: se quitan los parámetros del tipo.
      const dataUrl = String(r.dataUrl).replace(/^data:([^;,]+)[^,]*?;base64,/, "data:$1;base64,");
      if (esImagen) { setSrc(dataUrl); setEstado(""); return; }
      if (esAudio) { setSrc(URL.createObjectURL(await (await fetch(dataUrl)).blob())); setEstado(""); return; }
      const blob = await (await fetch(dataUrl)).blob();
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
  // Nota de voz: se escucha aquí mismo. Safari antiguo no lee ogg/opus: queda el enlace para descargarla.
  if (src && esAudio) return (
    <div className="flex flex-col gap-0.5">
      <audio controls autoPlay src={src} className="w-[240px] max-w-full" />
      <a href={src} download={media.nombre || "nota-de-voz.ogg"} className="text-[11px] text-sky-700 hover:underline">Descargar audio</a>
    </div>
  );
  // Los navegadores no dejan abrir direcciones «data:» en una pestaña nueva (queda en blanco): se abre un enlace temporal «blob:».
  const abrirGrande = async () => {
    try {
      const blob = await (await fetch(src)).blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (e) { setEstado("error"); }
  };
  if (src) return <img src={src} alt="Foto del mensaje" title="Abrir en una ventana nueva" className="max-w-[240px] max-h-[240px] object-contain rounded-lg cursor-zoom-in" onClick={abrirGrande} />;
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

/* ---------- Notas de voz ---------- */
const MAX_SEG_VOZ = 300; // 5 minutos
/**
 * Formato en que este navegador graba: ogg/opus (Firefox, va directo), webm/opus (Chrome, Edge: se reempaqueta a ogg/opus
 * sin recodificar, porque WhatsApp rechaza el webm y el mp4 fragmentado de Chrome) o mp4/aac (Safari).
 */
const tipoGrabacion = () => {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Botón 🎤: graba con el micrófono y deja la nota de voz lista para enviar (el navegador pide permiso la primera vez). */
function BotonGrabar({ onListo, onError, disabled }) {
  const [grabando, setGrabando] = useState(false);
  const [seg, setSeg] = useState(0);
  const [nivel, setNivel] = useState(0);
  const [bajo, setBajo] = useState(false);
  const r = useRef({ rec: null, stream: null, ctx: null, timer: null, medidor: null, cancelar: false });
  const limpiar = () => {
    clearInterval(r.current.timer); clearInterval(r.current.medidor);
    if (r.current.stream) r.current.stream.getTracks().forEach((t) => t.stop());
    try { if (r.current.ctx) r.current.ctx.close(); } catch (e) { /* ya cerrado */ }
    r.current.stream = null; r.current.timer = null; r.current.medidor = null; r.current.ctx = null;
  };
  useEffect(() => () => {
    r.current.cancelar = true;
    try { if (r.current.rec && r.current.rec.state !== "inactive") r.current.rec.stop(); } catch (e) { /* ya detenida */ }
    limpiar();
  }, []);
  const detener = (cancelar) => {
    r.current.cancelar = !!cancelar;
    try { if (r.current.rec && r.current.rec.state !== "inactive") r.current.rec.stop(); } catch (e) { limpiar(); setGrabando(false); }
  };
  const empezar = async () => {
    const tipo = tipoGrabacion();
    if (!tipo || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError("Este navegador no puede grabar notas de voz. Usa Chrome, Edge, Firefox o Safari actualizados, o adjunta un archivo de audio con 📎."); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(RESTRICCIONES_MICROFONO); }
    catch (e) { onError("No se pudo usar el micrófono. Permite el acceso al micrófono en el candado de la barra de direcciones y vuelve a intentar."); return; }
    try {
      // La voz pasa por filtro de zumbido, compresor, ganancia y limitador (se oye más fuerte y pareja); si el navegador no puede, se graba directo.
      let ctx = null; let analizador = null; let origen = stream;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const cadena = armarCadenaVoz(ctx, ctx.createMediaStreamSource(stream));
        const destino = ctx.createMediaStreamDestination();
        destino.channelCount = 1; destino.channelCountMode = "explicit";
        cadena.salida.connect(destino);
        analizador = cadena.analizador; origen = destino.stream;
      } catch (e) { try { if (ctx) ctx.close(); } catch (e2) { /* nada */ } ctx = null; analizador = null; origen = stream; }
      const rec = new MediaRecorder(origen, { mimeType: tipo, audioBitsPerSecond: 48000 });
      const trozos = [];
      const base = tipo.split(";")[0];
      r.current = { rec, stream, ctx, timer: null, medidor: null, cancelar: false };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) trozos.push(e.data); };
      rec.onstop = async () => {
        const cancelar = r.current.cancelar;
        limpiar(); setGrabando(false);
        if (cancelar || !trozos.length) return;
        try {
          let blob = new Blob(trozos, { type: base });
          let tipoFinal = base;
          if (base === "audio/webm") {
            blob = new Blob([webmOpusAOgg(new Uint8Array(await blob.arrayBuffer()))], { type: "audio/ogg" });
            tipoFinal = "audio/ogg";
          }
          if (blob.size > MAX_BYTES_MEDIA) { onError("archivo_muy_grande"); return; }
          onListo({ nombre: `nota-de-voz.${tipoFinal === "audio/ogg" ? "ogg" : "m4a"}`, tipo: tipoFinal, dataUrl: await leerArchivo(blob) });
        } catch (e) { onError("No se pudo preparar la nota de voz. Graba de nuevo o adjunta un archivo de audio con 📎."); }
      };
      rec.start();
      setSeg(0); setNivel(0); setBajo(false); setGrabando(true);
      // Barra de volumen: si en los primeros segundos casi no hay señal, se avisa (micrófono lejos, silenciado o equivocado).
      let maximo = 0; let ticks = 0;
      if (analizador) r.current.medidor = setInterval(() => {
        const v = nivelAnalizador(analizador); maximo = Math.max(maximo, v); ticks++;
        setNivel(v); if (ticks === 25) setBajo(maximo < 0.08);
      }, 120);
      r.current.timer = setInterval(() => setSeg((s) => { if (s + 1 >= MAX_SEG_VOZ) detener(false); return s + 1; }), 1000);
    } catch (e) { stream.getTracks().forEach((t) => t.stop()); limpiar(); onError("No se pudo iniciar la grabación en este navegador."); }
  };
  if (grabando) {
    return (
      <div className="flex items-center gap-2 shrink-0 text-sm">
        <span className="text-rose-600 font-mono animate-pulse">● {mmss(seg)}</span>
        <span className="inline-block w-14 h-2 bg-stone-200 rounded overflow-hidden" title="Volumen del micrófono"><span className={`block h-full ${nivel > 0.9 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.round(Math.min(1, nivel * 1.6) * 100)}%` }} /></span>
        {bajo && <span className="text-[11px] text-amber-700">Se oye muy bajo: acércate al micrófono</span>}
        <button type="button" onClick={() => detener(false)} className={BTN} title="Terminar y dejar la nota lista para enviar">⏹ Listo</button>
        <button type="button" onClick={() => detener(true)} className="text-xs text-rose-600 hover:underline">Cancelar</button>
      </div>
    );
  }
  return <button type="button" onClick={empezar} disabled={disabled} className={`${BTN} shrink-0`} title="Grabar una nota de voz">🎤</button>;
}

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
      // Audio ya grabado (mp3, ogg, m4a, aac, amr): se envía tal cual. Los de WhatsApp web/otros formatos (webm, wav) no los acepta WhatsApp.
      const baseAudio = f.type.split(";")[0].toLowerCase();
      if (TIPOS_AUDIO.includes(baseAudio)) {
        if (f.size > MAX_BYTES_MEDIA) throw new Error("archivo_muy_grande");
        const crudo = await leerArchivo(f);
        setArchivo({ nombre: f.name, tipo: baseAudio, dataUrl: crudo.replace(/^data:[^,]*?;base64,/, `data:${baseAudio};base64,`) });
        return;
      }
      const esPdf = f.type === "application/pdf";
      if (!esPdf && !/^image\/(jpeg|png)$/.test(f.type) && !f.type.startsWith("image/")) throw new Error("archivo_tipo_invalido");
      if (esPdf && f.size > MAX_BYTES_MEDIA) throw new Error("archivo_muy_grande");
      const dataUrl = esPdf ? await leerArchivo(f) : await compressImage(f);
      setArchivo({ nombre: esPdf ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg", tipo: esPdf ? "application/pdf" : "image/jpeg", dataUrl });
    } catch (e) { setMsg(mensajeError(e)); }
  };

  const esVoz = !!archivo && TIPOS_AUDIO.includes(archivo.tipo);
  const cargaEnvio = archivo ? (esVoz ? { archivo } : { archivo, texto }) : { texto };
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
                {esVoz
                  ? <><span>🎤</span><audio controls src={archivo.dataUrl} className="h-8 flex-1 min-w-0" /></>
                  : <span>{archivo.tipo === "application/pdf" ? "📄" : "📷"} {archivo.nombre}</span>}
                <button type="button" onClick={() => setArchivo(null)} className="ml-auto text-rose-600 hover:underline text-xs">Quitar</button>
              </div>
            )}
            {respuestas && (
              <SelectorRespuestas api={api} cliente={(datos.cliente && datos.cliente.nombre) || ""} ejecutivo={datos.yo || ""} onCerrar={() => setRespuestas(false)}
                onElegir={(t) => { setTexto((x) => (x.trim() ? `${x.trimEnd()}\n${t}` : t)); setRespuestas(false); setTimeout(() => areaTexto.current && areaTexto.current.focus(), 0); }} />
            )}
            <div className="flex gap-2 items-end">
              <label className={`${BTN} cursor-pointer shrink-0`} title="Adjuntar foto, PDF o audio">📎<input type="file" accept="image/*,application/pdf,audio/*" onChange={elegirArchivo} className="hidden" /></label>
              <BotonGrabar disabled={ocupado} onListo={(a) => { setMsg(""); setArchivo(a); }} onError={(e) => setMsg(/^[a-z_]+$/.test(e) ? mensajeError(new Error(e)) : e)} />
              <button type="button" onClick={() => setRespuestas((x) => !x)} className={`${BTN} shrink-0`} title="Respuestas rápidas">⚡</button>
              <textarea ref={areaTexto} value={texto} rows={2} maxLength={4096} disabled={esVoz} placeholder={esVoz ? "La nota de voz se envía sola, sin texto" : archivo ? "Texto que acompaña el archivo (opcional)" : "Escribe un mensaje…"}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (texto.trim() || archivo) && !ocupado) { e.preventDefault(); enviar(cargaEnvio); } }}
                className={`${INPUT} flex-1 resize-none`} />
              <button type="button" disabled={ocupado || (!texto.trim() && !archivo)} onClick={() => enviar(cargaEnvio)} className={`${BTN_PRIMARIO} shrink-0`}>{ocupado ? "…" : "Enviar"}</button>
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

const HORA = "border border-stone-300 bg-white px-2 py-1 text-sm w-28"; // casilla de hora compacta (INPUT ocupa todo el ancho)
/** Traduce el error de la API de Anthropic a algo que se pueda resolver. */
const explicarErrorIa = (e) => {
  const t = String(e || "");
  if (/401|authentication|invalid x-api-key|api key/i.test(t)) return "la clave de Anthropic no es válida: créala de nuevo en la consola y cárgala otra vez como ANTHROPIC_API_KEY.";
  if (/credit balance|billing|402|too low/i.test(t)) return "no hay saldo en la cuenta de Anthropic: carga crédito en la consola (Billing).";
  if (/403|permission/i.test(t)) return "la clave no tiene permiso para usar este modelo.";
  if (/429|rate.?limit/i.test(t)) return "se superó el límite de uso de Anthropic; se resuelve solo en unos minutos.";
  if (/529|overloaded|500|502|503|timeout|timed out/i.test(t)) return "Anthropic está saturado o no respondió; vuelve a intentar en unos minutos.";
  if (/falta ANTHROPIC_API_KEY/i.test(t)) return "falta cargar la clave de Anthropic.";
  return t.slice(0, 200) || "error desconocido.";
};
const DIAS_BOT = [["lun", "Lunes"], ["mar", "Martes"], ["mie", "Miércoles"], ["jue", "Jueves"], ["vie", "Viernes"], ["sab", "Sábado"], ["dom", "Domingo"]];

/** Asistente de WhatsApp fuera de horario: se enciende y se fija el horario de atención (Administrador y Jefe Local). */
function ConfigAsistente({ api }) {
  const { cargando, datos, recargar } = useCarga(() => api("wa.bot_estado", {}), [api]);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (datos && datos.puedeConfigurar && !f) setF(JSON.parse(JSON.stringify(datos.config))); }, [datos, f]);
  if (cargando && !datos) return null;
  if (!datos || !datos.puedeConfigurar || !f) return null;
  const dia = (d, campo, valor) => setF((x) => ({ ...x, horario: { ...x.horario, [d]: { ...x.horario[d], [campo]: valor } } }));
  const guardar = async () => {
    setMsg(""); setOcupado(true);
    try { await api("wa.bot_guardar", { config: f }); await recargar(); setMsg("Guardado."); } catch (e) { setMsg(mensajeError(e)); }
    setOcupado(false);
  };
  return (
    <Tarjeta titulo="Asistente fuera de horario" ayuda="Cuando un cliente escribe con el local cerrado, el asistente le pregunta con botones qué necesita, su nombre, el detalle del auto y cuándo prefiere que lo contacten; deja el lead con el tipo correcto (venta, compra o consignación), reasignado por tipo y rotación, y avisa al ejecutivo por correo. En horario de atención no interviene.">
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.activo} onChange={(e) => setF((x) => ({ ...x, activo: e.target.checked }))} /> <b>Asistente encendido</b>
          <span className={`text-xs px-2 py-0.5 ${datos.abierto ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>Ahora: {datos.abierto ? "dentro del horario" : `fuera de horario (atendemos ${datos.proxima})`}</span>
        </label>
        <Campo etiqueta="Nombre con que se presenta el asistente" ayuda="Por ejemplo: BuyCar. Dice «Soy el asistente de BuyCar».">
          <input value={f.empresa} maxLength={60} onChange={(e) => setF((x) => ({ ...x, empresa: e.target.value }))} className={`${INPUT} md:w-72`} placeholder="Nombre de la automotora" />
        </Campo>
        <div className="border border-stone-200 rounded p-3 flex flex-col gap-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.ia.activa} onChange={(e) => setF((x) => ({ ...x, ia: { ...x.ia, activa: e.target.checked } }))} /> <b>Responder preguntas con inteligencia artificial (Claude)</b></label>
          <p className="text-xs text-stone-600">Cuando el cliente escribe una pregunta fuera de horario (por ejemplo «¿tienen un Yaris automático bajo 10 millones?»), la IA busca en el inventario disponible y le responde con precios y enlaces del sitio, anota lo que le interesa en su ficha y lo deriva a un ejecutivo si quiere negociar, reservar, pagar o tiene un reclamo. No da descuentos ni ve costos. Siempre dice que es un asistente virtual.</p>
          {!datos.ia.claveCargada && <p className="text-xs text-amber-700">Falta cargar la clave de Anthropic (ANTHROPIC_API_KEY) en Supabase: mientras tanto la IA no responde y el asistente funciona solo con el menú.</p>}
          <div className="flex flex-wrap gap-4">
            <Campo etiqueta="Tope de gasto al mes (US$)" ayuda="0 = sin tope. Al alcanzarlo la IA deja de responder hasta el mes siguiente.">
              <input type="number" min="0" step="1" value={f.ia.maxUsdMes} onChange={(e) => setF((x) => ({ ...x, ia: { ...x.ia, maxUsdMes: e.target.value } }))} className={HORA} />
            </Campo>
            <Campo etiqueta="Máx. respuestas de IA por conversación" ayuda="En 12 horas; evita conversaciones sin fin.">
              <input type="number" min="1" max="100" step="1" value={f.ia.maxPorConversacion} onChange={(e) => setF((x) => ({ ...x, ia: { ...x.ia, maxPorConversacion: e.target.value } }))} className={HORA} />
            </Campo>
          </div>
          {datos.ia.ultimo && (datos.ia.ultimo.ok
            ? <p className="text-xs text-emerald-700">✓ La IA respondió bien la última vez ({hace(datos.ia.ultimo.en)}).</p>
            : <p className="text-xs text-rose-700">⚠ La última consulta a la IA falló ({hace(datos.ia.ultimo.en)}): {explicarErrorIa(datos.ia.ultimo.error)}</p>)}
          {datos.ia.uso && <p className="text-xs text-stone-600">Este mes: {datos.ia.uso.llamadas} {datos.ia.uso.llamadas === 1 ? "consulta" : "consultas"} a la IA · gasto estimado {datos.ia.uso.usd < 0.01 ? "menos de US$ 0,01" : `US$ ${datos.ia.uso.usd.toFixed(2)}`} · modelo {datos.ia.modelo}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-stone-600">Horario de atención (hora de Chile). Fuera de estas horas actúa el asistente.</p>
          {DIAS_BOT.map(([d, nombre]) => (
            <div key={d} className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 w-28"><input type="checkbox" checked={!!f.horario[d].abierto} onChange={(e) => dia(d, "abierto", e.target.checked)} /> {nombre}</label>
              {f.horario[d].abierto
                ? <><input type="time" value={f.horario[d].desde} onChange={(e) => dia(d, "desde", e.target.value)} className={HORA} /> <span>a</span> <input type="time" value={f.horario[d].hasta} onChange={(e) => dia(d, "hasta", e.target.value)} className={HORA} /></>
                : <span className="text-xs text-stone-500">Cerrado todo el día</span>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={guardar} disabled={ocupado} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : "Guardar"}</button>
          {msg && <span className="text-xs text-stone-600">{msg}</span>}
        </div>
      </div>
    </Tarjeta>
  );
}

const ESTADO_PLANTILLA_SUGERIDA = {
  NO_CREADA: ["bg-stone-100 text-stone-700", "Aún no creada"],
  PENDING: ["bg-amber-100 text-amber-800", "En revisión por Meta (de minutos a unas horas)"],
  APPROVED: ["bg-emerald-100 text-emerald-800", "Aprobada por Meta"],
  REJECTED: ["bg-rose-100 text-rose-800", "Rechazada por Meta"],
  PAUSED: ["bg-rose-100 text-rose-800", "Pausada por Meta"],
};

/** Mensaje de bienvenida por WhatsApp a los leads de formularios (sitio web, Meta y Google): plantilla, tope diario y prueba. */
function ConfigBienvenida({ api }) {
  const { cargando, datos, recargar } = useCarga(() => api("wa.bienvenida_estado", {}), [api]);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [tel, setTel] = useState("");
  const [tipoPrueba, setTipoPrueba] = useState("consulta");
  useEffect(() => { if (datos && !f) setF(JSON.parse(JSON.stringify(datos.config))); }, [datos, f]);
  if (cargando && !datos) return null;
  if (!datos || !f) return null; // quien no puede configurarla recibe «forbidden» y no ve la tarjeta
  const sug = datos.sugerida;
  const [claseSug, textoSug] = ESTADO_PLANTILLA_SUGERIDA[sug.estado] || ["bg-stone-100 text-stone-700", sug.estado];
  const ejemplo = sug.ejemplos.reduce((t, e, i) => t.replace(`{{${i + 1}}}`, e), sug.cuerpo);
  const sv = datos.sugeridaVender;
  const [claseSv, textoSv] = ESTADO_PLANTILLA_SUGERIDA[sv.estado] || ["bg-stone-100 text-stone-700", sv.estado];
  const ejemploV = sv.ejemplos.reduce((t, e, i) => t.replace(`{{${i + 1}}}`, e), sv.cuerpo);
  const valorV = f.plantillaVender && f.plantillaVender.nombre ? `${f.plantillaVender.nombre}|${f.plantillaVender.idioma}` : "";
  const correr = async (fn, ok) => { setMsg(""); setOcupado(true); try { await fn(); await recargar(); if (ok) setMsg(ok); } catch (e) { setMsg(e && e.message === "whatsapp_error" && e.detalle ? `Meta respondió: ${e.detalle}` : mensajeError(e)); } setOcupado(false); };
  const valor = f.plantilla.nombre ? `${f.plantilla.nombre}|${f.plantilla.idioma}` : "";
  return (
    <Tarjeta titulo="Mensaje de bienvenida a leads de formularios" ayuda="Cuando entra un lead por el formulario del sitio web o por un anuncio de Meta o Google, se le envía por WhatsApp una plantilla aprobada por Meta que confirma su solicitud y cuándo lo contactará un ejecutivo. Si responde, la conversación sigue en su lead (y fuera de horario lo atiende el asistente). Un mismo teléfono lo recibe una vez cada 7 días, y no se envía a quien ya está conversando con nosotros.">
      <div className="flex flex-col gap-3 text-sm">
        <div className="border border-stone-200 rounded p-3 flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2"><b>Plantilla sugerida:</b> <span className="font-mono text-xs">{sug.nombre}</span> <span className={`text-xs px-2 py-0.5 ${claseSug}`}>{textoSug}</span></p>
          <p className="text-xs text-stone-600 bg-stone-50 border border-stone-200 p-2 whitespace-pre-wrap">{ejemplo}{"\n"}<span className="text-stone-400">{sug.pie}</span></p>
          {sug.motivo && <p className="text-xs text-rose-700">Motivo del rechazo: {sug.motivo}</p>}
          {sug.estado === "NO_CREADA" && (
            <div><button type="button" disabled={ocupado || !datos.whatsappConfigurado} onClick={() => correr(() => api("wa.plantilla_crear", { plantilla: { nombre: sug.nombre, categoria: sug.categoria, cuerpo: sug.cuerpo, pie: sug.pie, ejemplos: sug.ejemplos } }), "Plantilla enviada a Meta para su revisión.")} className={BTN}>Crear esta plantilla en Meta</button></div>
          )}
          {!datos.whatsappConfigurado && <p className="text-xs text-amber-700">WhatsApp aún no está conectado: el Administrador debe cargar las credenciales de Meta.</p>}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.activa} onChange={(e) => setF((x) => ({ ...x, activa: e.target.checked }))} /> <b>Enviar la bienvenida a los leads nuevos</b>
          {datos.enviadasHoy > 0 && <span className="text-xs text-stone-500">· hoy se enviaron {datos.enviadasHoy}</span>}
        </label>
        <Campo etiqueta="Plantilla a usar" ayuda="Solo aparecen las aprobadas por Meta que tienen exactamente 4 variables: nombre, qué recibimos, empresa y cuándo lo contactan.">
          <select value={valor} onChange={(e) => { const [nombre, idioma] = e.target.value.split("|"); setF((x) => ({ ...x, plantilla: { nombre: nombre || "", idioma: idioma || "es" } })); }} className={`${INPUT} md:w-80`}>
            <option value="">— Elige una plantilla aprobada —</option>
            {datos.plantillas.map((p) => <option key={`${p.nombre}|${p.idioma}`} value={`${p.nombre}|${p.idioma}`}>{p.nombre} ({p.idioma})</option>)}
          </select>
        </Campo>
        <div className="border border-stone-200 rounded p-3 flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2"><b>Para quienes quieren vender o consignar su auto (opcional):</b> <span className="font-mono text-xs">{sv.nombre}</span> <span className={`text-xs px-2 py-0.5 ${claseSv}`}>{textoSv}</span></p>
          <p className="text-xs text-stone-600">Menciona el auto que ofrecen, avisa de la tasación y les pide fotos. Si no eliges una, esos leads reciben la plantilla general.</p>
          <p className="text-xs text-stone-600 bg-stone-50 border border-stone-200 p-2 whitespace-pre-wrap">{ejemploV}{String.fromCharCode(10)}<span className="text-stone-400">{sv.pie}</span></p>
          {sv.motivo && <p className="text-xs text-rose-700">Motivo del rechazo: {sv.motivo}</p>}
          {sv.estado === "NO_CREADA" && (
            <div><button type="button" disabled={ocupado || !datos.whatsappConfigurado} onClick={() => correr(() => api("wa.plantilla_crear", { plantilla: { nombre: sv.nombre, categoria: sv.categoria, cuerpo: sv.cuerpo, pie: sv.pie, ejemplos: sv.ejemplos } }), "Plantilla enviada a Meta para su revisión.")} className={BTN}>Crear esta plantilla en Meta</button></div>
          )}
          <Campo etiqueta="Plantilla a usar para ellos" ayuda="Solo aparecen las aprobadas por Meta con exactamente 5 variables: nombre, vender o consignar, el auto, empresa y cuándo lo contactan.">
            <select value={valorV} onChange={(e) => { const [nombre, idioma] = e.target.value.split("|"); setF((x) => ({ ...x, plantillaVender: { nombre: nombre || "", idioma: idioma || "es" } })); }} className={`${INPUT} md:w-80`}>
              <option value="">— Usar la plantilla general —</option>
              {datos.plantillasVender.map((p) => <option key={`${p.nombre}|${p.idioma}`} value={`${p.nombre}|${p.idioma}`}>{p.nombre} ({p.idioma})</option>)}
            </select>
          </Campo>
        </div>
        <Campo etiqueta="Máximo de bienvenidas por día" ayuda="Freno de seguridad: los formularios públicos se podrían usar para molestar a un tercero.">
          <input type="number" min="1" max="1000" step="1" value={f.maxPorDia} onChange={(e) => setF((x) => ({ ...x, maxPorDia: e.target.value }))} className={HORA} />
        </Campo>
        {datos.ultimo && (datos.ultimo.ok
          ? <p className="text-xs text-emerald-700">✓ La última bienvenida se envió bien ({hace(datos.ultimo.en)}).</p>
          : <p className="text-xs text-rose-700">⚠ La última bienvenida no se envió ({hace(datos.ultimo.en)}): {datos.ultimo.error}</p>)}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={ocupado} onClick={() => correr(() => api("wa.bienvenida_guardar", { config: f }), "Guardado.")} className={BTN_PRIMARIO}>{ocupado ? "Guardando…" : "Guardar"}</button>
          {msg && <span className="text-xs text-stone-600">{msg}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
          <span className="text-xs text-stone-600">Probar con mi teléfono (llega la bienvenida de ejemplo):</span>
          <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="9 1234 5678" className={`${INPUT} w-40`} />
          <select value={tipoPrueba} onChange={(e) => setTipoPrueba(e.target.value)} className="border border-stone-300 bg-white px-2 py-1 text-sm" title="Qué bienvenida probar">
            <option value="consulta">Plantilla general</option><option value="vender">Quiere vender</option><option value="consignar">Quiere consignar</option>
          </select>
          <button type="button" disabled={ocupado || !tel.trim()} onClick={() => correr(async () => { const r = await api("wa.bienvenida_probar", { telefono: tel, tipo: tipoPrueba }); if (r.resultado !== "enviada") throw Object.assign(new Error("whatsapp_error"), { detalle: r.resultado === "plantilla" ? "La plantilla elegida no está aprobada." : r.resultado === "error" ? "WhatsApp no aceptó el mensaje (mira el aviso de arriba)." : r.resultado }); }, "Enviada: revisa tu WhatsApp.")} className={BTN}>Enviar prueba</button>
        </div>
      </div>
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
/** Etiquetas de la conversación abierta: se agregan (sugeridas o propias) y se quitan con un clic. */
function EtiquetasConversacion({ api, conv, sugeridas, onCambio }) {
  const [nueva, setNueva] = useState("");
  const [msg, setMsg] = useState("");
  const actuales = conv.etiquetas || [];
  const guardar = async (lista) => {
    setMsg("");
    try { await api("wa.etiquetas", { id: conv.id, etiquetas: lista }); setNueva(""); onCambio(); } catch (e) { setMsg(mensajeError(e)); }
  };
  const agregar = (t) => { const x = String(t || "").trim(); if (x && !actuales.some((y) => y.toLowerCase() === x.toLowerCase())) guardar([...actuales, x]); };
  const libres = (sugeridas || []).filter((s) => !actuales.some((y) => y.toLowerCase() === s.toLowerCase()));
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      {actuales.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">{t}<button type="button" onClick={() => guardar(actuales.filter((x) => x !== t))} className="text-amber-700 hover:text-rose-700" aria-label={`Quitar ${t}`}>✕</button></span>
      ))}
      {actuales.length < 5 && (
        <>
          <select value="" onChange={(e) => agregar(e.target.value)} className="text-xs border border-stone-300 bg-white px-1.5 py-0.5">
            <option value="">+ Etiqueta</option>{libres.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={nueva} maxLength={20} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(nueva); } }} placeholder="Otra…" className="text-xs border border-stone-300 px-1.5 py-0.5 w-24" />
        </>
      )}
      {msg && <span className="text-xs text-rose-600">{msg}</span>}
    </div>
  );
}

export function BandejaWhatsapp({ api, abrirLead, locales, onCambio = () => {} }) {
  const { cargando, error, datos, recargar } = useCarga(() => api("wa.list", {}), [api]);
  useCadaTanto(recargar, 15000);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [soloNoLeidos, setSoloNoLeidos] = useState(false);
  const [etiqueta, setEtiqueta] = useState("");
  const alCambiar = useCallback(() => { recargar(); onCambio(); }, [recargar, onCambio]);

  const lista = useMemo(() => {
    if (!datos) return [];
    const t = q.trim().toLowerCase();
    return datos.conversaciones
      .filter((c) => (!etiqueta || (c.etiquetas || []).includes(etiqueta)))
      .filter((c) => (!soloNoLeidos || c.no_leidos > 0) && (!t || [c.nombre, c.telefono, c.telefono_visible, c.ultimo_texto, c.asignado].some((x) => String(x || "").toLowerCase().includes(t))))
      .sort((a, b) => (b.no_leidos > 0) - (a.no_leidos > 0) || String(b.ultimo_mensaje_en || "").localeCompare(String(a.ultimo_mensaje_en || "")));
  }, [datos, q, soloNoLeidos, etiqueta]);

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const actual = sel && datos.conversaciones.find((c) => c.id === sel);
  const noLeidos = datos.conversaciones.reduce((s, c) => s + c.no_leidos, 0);

  return (
    <div className="flex flex-col gap-4">
      {!datos.configurado && <Aviso tipo="info">WhatsApp aún no está conectado: cuando el Administrador cargue las credenciales de Meta, aquí aparecerán las conversaciones.</Aviso>}
      <div className="grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-4 items-start">
        <div className={`bg-white border border-stone-200 flex flex-col ${actual ? "hidden lg:flex" : ""}`}>
          <div className="p-3 border-b border-stone-200 flex flex-col gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, teléfono o mensaje" className={INPUT} />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-stone-600"><input type="checkbox" checked={soloNoLeidos} onChange={(e) => setSoloNoLeidos(e.target.checked)} /> Solo no leídos {noLeidos > 0 && `(${noLeidos})`}</label>
              {(() => { const usadas = [...new Set(datos.conversaciones.flatMap((c) => c.etiquetas || []))].sort(); return usadas.length > 0 && (
                <select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className="text-xs border border-stone-300 bg-white px-1.5 py-0.5"><option value="">Todas las etiquetas</option>{usadas.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              ); })()}
            </div>
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
                  {c.bot && <p className="text-[11px] text-sky-700">🤖 {c.bot === "listo" ? "Asistente: datos recogidos" : "Asistente conversando con el cliente"}</p>}
                  {(c.etiquetas || []).length > 0 && <div className="flex flex-wrap gap-1 mt-0.5">{c.etiquetas.map((t) => <span key={t} className="text-[10px] bg-amber-100 text-amber-900 px-1.5 rounded-full">{t}</span>)}</div>}
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
              <EtiquetasConversacion api={api} conv={actual} sugeridas={datos.etiquetasSugeridas} onCambio={recargar} />
              <ChatWhatsapp key={actual.id} api={api} conversacionId={actual.id} onCambio={alCambiar} />
            </Tarjeta>
          ) : <div className="bg-white border border-stone-200 p-8 text-center text-sm text-stone-500">Elige una conversación.</div>}
        </div>
      </div>
    </div>
  );
}

/** Todo lo que se configura de WhatsApp, fuera de la bandeja: conexión, asistente, bienvenida, respuestas rápidas y plantillas. */
export function AjustesWhatsapp({ api, locales }) {
  const { cargando, error, datos } = useCarga(() => api("wa.list", {}), [api]);
  const [vista, setVista] = useState("general"); // general | respuestas | plantillas
  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <Aviso>{error}</Aviso>;
  const secciones = [["general", "Conexión y asistente"], datos.puedeRespuestas && ["respuestas", "Respuestas rápidas"], datos.puedePlantillas && ["plantillas", "Plantillas"]].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      {secciones.length > 1 && (
        <div className="flex border border-stone-300 self-start">
          {secciones.map(([id, t]) => <button key={id} type="button" onClick={() => setVista(id)} className={`px-3 py-1.5 text-sm ${vista === id ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}>{t}</button>)}
        </div>
      )}
      {vista === "respuestas" && datos.puedeRespuestas ? <AdminRespuestas api={api} />
        : vista === "plantillas" && datos.puedePlantillas ? <AdminPlantillas api={api} />
        : <>
          <ConfigWhatsapp api={api} locales={locales} />
          <ConfigAsistente api={api} />
          <ConfigBienvenida api={api} />
        </>}
    </div>
  );
}

