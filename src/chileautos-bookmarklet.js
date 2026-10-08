/**
 * MARCADOR PARA CHILEAUTOS
 * ----------------------------------------------------------------
 * Chileautos bloquea las consultas automáticas desde servidores, pero la página
 * que TÚ tienes abierta en tu navegador ya trae todos los avisos. El marcador
 * (un favorito del navegador con código dentro) lee esa página, copia los avisos
 * al portapapeles y se pegan en la app. No envía nada a ningún servidor.
 *
 * `extractChileautosListings` debe ser AUTOCONTENIDA (sin referencias a nada de
 * afuera) y SIN comentarios `//` en su interior: se convierte a texto y se junta
 * en una sola línea para armar el marcador, y un comentario se comería el resto.
 *
 * Cómo lee la página (verificado en chileautos.cl):
 *  - cada aviso tiene un enlace /vehiculos/detalles/<slug>/<ID>/ ; la tarjeta es el
 *    ancestro más cercano que contiene un precio y no es toda la página;
 *  - los avisos pagados para aparecer arriba traen "rankingType=" en su enlace;
 *  - si no hay avisos exactos para el filtro, el sitio muestra "Vehículos parecidos
 *    a lo que buscas" y esos avisos NO corresponden a la búsqueda.
 * ----------------------------------------------------------------
 */
export function extractChileautosListings(doc, loc) {
  const toInt = (s) => parseInt(String(s || "").replace(/\D/g, ""), 10) || 0;
  const listings = [];
  const seen = {};
  const anchors = doc.querySelectorAll("a[href*='/vehiculos/detalles/']");
  for (let n = 0; n < anchors.length; n++) {
    const a = anchors[n];
    const href = a.getAttribute("href") || "";
    const m = href.match(/\/([A-Z]{2}-AD-\d+)\//);
    const id = m && m[1];
    if (!id || seen[id]) continue;
    seen[id] = true;

    let card = a;
    for (let i = 0; i < 10 && card; i++) {
      const t = card.innerText || "";
      if (/\$\s?\d/.test(t) && t.length < 700) break;
      card = card.parentElement;
    }
    const text = ((card && card.innerText) || "").replace(/\s*\n+\s*/g, " | ");
    const partes = text.split(" | ");
    const precio = text.match(/\$\s?([\d.]+)\s*CLP/);
    const km = text.match(/([\d.]+)\s*km\b/i);
    const slug = href.split("?")[0].split("/")[3] || "";
    let ti = -1;
    for (let k = 0; k < partes.length; k++) {
      if (/^(?:19|20)\d{2}\s+\S/.test(partes[k])) { ti = k; break; }
    }
    const titulo = ti >= 0 ? partes[ti] : slug;
    const version = ti >= 0 && partes[ti + 1] && !/^\$/.test(partes[ti + 1]) ? partes[ti + 1] : "";
    let transmision = "";
    let combustible = "";
    for (let k = 0; k < partes.length; k++) {
      const p = partes[k].trim();
      if (!transmision && /^(?:Manual|Autom[aá]tic[ao]|Secuencial|CVT)$/i.test(p)) transmision = p;
      if (!combustible && /^(?:Bencina|Di[eé]sel|H[ií]brido[A-Za-zÁ-ú ]*|El[eé]ctrico|Gas|GLP|GNC)$/i.test(p)) combustible = p;
    }
    const anioTxt = (ti >= 0 && titulo.match(/^((?:19|20)\d{2})/)) || slug.match(/(?:^|-)((?:19|20)\d{2})(?:-|$)/);
    const ranking = href.match(/rankingType=([A-Za-z]+)/);
    listings.push({
      id: id,
      titulo: titulo.slice(0, 90),
      version: version.slice(0, 90),
      transmision: transmision,
      combustible: combustible,
      anio: anioTxt ? parseInt(anioTxt[1], 10) : 0,
      km: km ? toInt(km[1]) : 0,
      precio: precio ? toInt(precio[1]) : 0,
      destacado: !!ranking,
      href: href.split("?")[0],
    });
  }
  const cuerpo = (doc.body && doc.body.innerText) || "";
  return {
    fuente: "chileautos",
    url: (loc && loc.href) || "",
    capturadoEl: new Date().toISOString(),
    sinResultados: /parecidos a lo que buscas/i.test(cuerpo),
    listings: listings,
  };
}

/** Código `javascript:` del marcador (copia los avisos al portapapeles y avisa en la página). */
export function buildBookmarkletHref() {
  const cuerpo = `
var x=${extractChileautosListings.toString()};
var r=x(document,location),j=JSON.stringify(r);
function aviso(t,mal){var d=document.createElement('div');d.textContent=t;d.setAttribute('style','position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;padding:12px 16px;border-radius:6px;font:14px/1.4 sans-serif;color:#fff;background:'+(mal?'#b45309':'#065f46')+';box-shadow:0 4px 14px rgba(0,0,0,.3)');document.body.appendChild(d);setTimeout(function(){d.remove()},7000)}
function listo(){aviso(r.sinResultados?'Drive Futuro: Chileautos no tiene avisos exactos para este filtro.':'Drive Futuro: '+r.listings.length+' avisos copiados. Vuelve a la app y pégalos.',r.sinResultados||!r.listings.length)}
function respaldo(){var t=document.createElement('textarea');t.value=j;t.setAttribute('style','position:fixed;opacity:0');document.body.appendChild(t);t.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}t.remove();if(ok)listo();else prompt('Copia este texto (Ctrl+C) y pégalo en Drive Futuro:',j)}
try{navigator.clipboard.writeText(j).then(listo,respaldo)}catch(e){respaldo()}
`;
  return "javascript:" + encodeURIComponent("(function(){" + cuerpo.replace(/\n/g, "") + "})()");
}
