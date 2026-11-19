// Avisos por correo: formato del mensaje y validaciones, sin acceso a datos (lo usan el servidor y las pruebas).

export const escaparHtml = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CORREO = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
export const correoValido = (s) => typeof s === "string" && s.length <= 254 && CORREO.test(s.trim());

/** Quita direcciones inválidas y repetidas (sin distinguir mayúsculas). */
export function destinatariosValidos(lista) {
  const vistos = new Set();
  const out = [];
  for (const c of lista || []) {
    if (!correoValido(c)) continue;
    const k = c.trim().toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(c.trim());
  }
  return out;
}

/** Asunto de una sola línea y de largo razonable (nunca saltos de línea: evita inyectar encabezados). */
export const limpiarAsunto = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 150);

/**
 * Mensaje con la misma información en HTML y en texto plano. `enlace` solo se incluye si es http(s).
 * `otrosEnlaces`: botones adicionales [{ url, texto }] (por ejemplo, agregar la visita a Outlook); también solo http(s).
 */
export function plantillaCorreo({ titulo, lineas = [], enlace = "", enlaceTexto = "Abrir en la plataforma", pie = "Aviso automático de Drive Futuro.", otrosEnlaces = [] }) {
  const ls = lineas.filter((l) => l != null && String(l).trim() !== "").map(String);
  const esHttp = (u) => /^https?:\/\//i.test(u || "");
  const botones = [...(esHttp(enlace) ? [{ url: enlace, texto: enlaceTexto }] : []), ...(otrosEnlaces || []).filter((b) => b && esHttp(b.url) && b.texto)];
  const boton = (b, i) => `<a href="${escaparHtml(b.url)}" style="display:inline-block;margin:0 8px 8px 0;background:${i === 0 ? "#b45309" : "#0f6cbd"};color:#fff;padding:10px 16px;text-decoration:none;font-size:14px">${escaparHtml(b.texto)}</a>`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1917">` +
    `<h2 style="font-size:18px;margin:0 0 12px">${escaparHtml(titulo)}</h2>` +
    ls.map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5">${escaparHtml(l)}</p>`).join("") +
    (botones.length ? `<p style="margin:16px 0 8px">${botones.map(boton).join("")}</p>` : "") +
    `<p style="margin:20px 0 0;font-size:12px;color:#78716c">${escaparHtml(pie)}</p></div>`;
  const texto = [titulo, "", ...ls, ...(botones.length ? ["", ...botones.map((b) => `${b.texto}: ${b.url}`)] : []), "", pie].join("\n");
  return { html, texto };
}
