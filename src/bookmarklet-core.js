/**
 * ARMADO DE MARCADORES (favoritos con código)
 * ----------------------------------------------------------------
 * Un marcador lee la página que el usuario tiene abierta en SU navegador, copia el
 * resultado como JSON al portapapeles y avisa con un cuadro en la página. No envía
 * nada a ningún servidor.
 *
 * `extractor(document, location)` y `mensaje(resultado)` se convierten a texto y se
 * juntan en una sola línea, así que deben ser AUTOCONTENIDAS (sin referencias a nada
 * de afuera) y SIN comentarios `//` en su interior (un comentario se comería el resto).
 * `mensaje` devuelve { texto, mal }.
 * ----------------------------------------------------------------
 */
export function armarMarcador(extractor, mensaje) {
  const cuerpo = `
var x=${extractor.toString()};
var m=${mensaje.toString()};
var r=x(document,location),j=JSON.stringify(r),i=m(r);
function aviso(t,mal){var d=document.createElement('div');d.textContent=t;d.setAttribute('style','position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;padding:12px 16px;border-radius:6px;font:14px/1.4 sans-serif;color:#fff;background:'+(mal?'#b45309':'#065f46')+';box-shadow:0 4px 14px rgba(0,0,0,.3)');document.body.appendChild(d);setTimeout(function(){d.remove()},7000)}
function listo(){aviso(i.texto,i.mal)}
function respaldo(){var t=document.createElement('textarea');t.value=j;t.setAttribute('style','position:fixed;opacity:0');document.body.appendChild(t);t.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}t.remove();if(ok)listo();else prompt('Copia este texto (Ctrl+C) y pégalo en Drive Futuro:',j)}
try{navigator.clipboard.writeText(j).then(listo,respaldo)}catch(e){respaldo()}
`;
  return "javascript:" + encodeURIComponent("(function(){" + cuerpo.replace(/\n/g, "") + "})()");
}
