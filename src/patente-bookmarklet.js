/**
 * MARCADOR PARA PATENTECHILE.COM
 * ----------------------------------------------------------------
 * El sitio está protegido contra programas automáticos (Cloudflare), así que no se
 * consulta desde un servidor ni con un bot: la persona entra, escribe la patente y
 * ve la ficha en SU navegador. Este marcador lee esa ficha ya abierta.
 *
 * PRIVACIDAD: copia SOLO patente, marca, modelo y año. La ficha de ese sitio también
 * muestra datos de la persona dueña (nombre, RUT, dirección); el marcador nunca los
 * busca ni los copia. Si no encuentra los datos del vehículo, copia únicamente los
 * NOMBRES de los campos de la página (sin sus valores) para poder ajustarlo.
 *
 * No se pudo probar contra el sitio real (Cloudflare bloquea al asistente), así que busca
 * los datos de varias formas: "Etiqueta: valor", etiqueta y valor en líneas seguidas,
 * columnas de tabla y pares etiqueta/valor del HTML.
 *
 * `extractPatenteChile` debe ser AUTOCONTENIDA y SIN comentarios `//` en su interior
 * (ver bookmarklet-core.js).
 * ----------------------------------------------------------------
 */
import { armarMarcador } from "./bookmarklet-core.js";

export function extractPatenteChile(doc, loc) {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[:\s]+$/, "").trim();
  const CLAVES = {
    patente: ["patente", "ppu", "placa", "placa patente", "placa patente unica", "matricula"],
    marca: ["marca"],
    modelo: ["modelo"],
    anio: ["ano", "ano vehiculo", "ano de fabricacion", "ano fabricacion"],
  };
  const conocidas = [];
  Object.keys(CLAVES).forEach((k) => CLAVES[k].forEach((c) => conocidas.push(c)));
  ["version", "color", "tipo", "tipo vehiculo", "combustible", "motor", "chasis", "vin", "nombre", "rut", "run", "direccion", "comuna", "propietario", "dueno", "numero motor", "transmision", "cilindrada", "fecha"].forEach((c) => conocidas.push(c));

  const lineas = [];
  ((doc.body && doc.body.innerText) || "").split(/\n+/).forEach((l) => {
    l.split(/\t+|\s{2,}|\s\|\s/).forEach((p) => {
      const t = p.trim();
      if (t) lineas.push(t);
    });
  });
  const esEtiqueta = (t) => conocidas.indexOf(norm(t)) >= 0 || /:\s*$/.test(t);

  const desdeTexto = (claves) => {
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
      const etiqueta = m ? m[1] : l;
      if (claves.indexOf(norm(etiqueta)) < 0) continue;
      let valor = m ? m[2].trim() : "";
      if (!valor && i + 1 < lineas.length) valor = lineas[i + 1];
      valor = (valor.split(/\s{2,}|\s+(?=[A-Za-zÁ-ú]{2,20}:)/)[0] || "").trim();
      if (valor && valor.length <= 60 && !esEtiqueta(valor)) return valor;
    }
    return "";
  };

  const desdeDom = (claves) => {
    const els = doc.querySelectorAll("th, td, dt, label, strong, b, span, div, p, li");
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.children && e.children.length > 0) continue;
      const t = (e.textContent || "").trim();
      if (!t || t.length > 40 || claves.indexOf(norm(t)) < 0) continue;
      let v = e.nextElementSibling;
      if (!v && e.parentElement) v = e.parentElement.nextElementSibling;
      const valor = v ? (v.textContent || "").trim() : "";
      if (valor && valor.length <= 60 && !esEtiqueta(valor)) return valor;
    }
    return "";
  };

  const buscar = (k) => desdeTexto(CLAVES[k]) || desdeDom(CLAVES[k]);

  const replaca = /(?:^|[^A-Z0-9])([A-Z]{2}[\s.\-]?[A-Z]{2}[\s.\-]?\d{2}|[A-Z]{2}[\s.\-]?\d{4})(?![A-Z0-9])/;
  const comoPlaca = (t) => {
    const mayus = String(t || "").toUpperCase();
    const limpio = mayus.replace(/[^A-Z0-9]/g, "");
    if (/^(?:[A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(limpio)) return limpio;
    const m = mayus.match(replaca);
    return m ? m[1].replace(/[^A-Z0-9]/g, "") : "";
  };
  let patente = comoPlaca(buscar("patente"));
  if (!patente) patente = comoPlaca((loc && loc.href) || "") || comoPlaca(doc.title || "") || comoPlaca(lineas.slice(0, 15).join(" "));

  const marca = buscar("marca");
  const modelo = buscar("modelo");
  const anioTxt = buscar("anio").match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  const anio = anioTxt ? parseInt(anioTxt[1], 10) : 0;

  const resultado = {
    fuente: "patentechile",
    url: ((loc && loc.origin) || "") + ((loc && loc.pathname) || ""),
    capturadoEl: new Date().toISOString(),
    patente: patente,
    marca: marca,
    modelo: modelo,
    anio: anio,
  };
  if (!marca || !modelo || !anio) {
    const nombres = {};
    lineas.forEach((l) => {
      if (l.length <= 30 && (/:\s*$/.test(l) || conocidas.indexOf(norm(l)) >= 0)) nombres[l] = true;
    });
    resultado.etiquetas = Object.keys(nombres).slice(0, 40);
  }
  return resultado;
}

/** Texto del cuadro que aparece en la página al copiar (autocontenida, sin comentarios). */
function mensajePatente(r) {
  if (r.marca && r.modelo && r.anio) {
    return { texto: "Drive Futuro: copiado " + (r.patente ? r.patente + " · " : "") + r.marca + " " + r.modelo + " " + r.anio + ". Vuelve a la app y pégalo.", mal: false };
  }
  return { texto: "Drive Futuro: no encontré marca, modelo y año en esta página. Abre la ficha del vehículo y vuelve a pulsar el favorito.", mal: true };
}

/** Código `javascript:` del marcador. */
export function buildPatenteBookmarkletHref() {
  return armarMarcador(extractPatenteChile, mensajePatente);
}
