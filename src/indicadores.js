// UF y UTM del día desde mindicador.cl (datos del Banco Central). Lo usan las calculadoras del sitio de inspecciones.

/** @returns {Promise<{ uf: number, utm: number } | null>} null si no responde o la respuesta no sirve (así queda el valor de referencia). */
export async function cargarIndicadores(signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  if (signal) signal.addEventListener("abort", () => ctl.abort());
  try {
    const r = await fetch("https://mindicador.cl/api", { signal: ctl.signal });
    if (!r.ok) return null;
    const d = await r.json();
    const uf = Number(d && d.uf && d.uf.valor);
    const utm = Number(d && d.utm && d.utm.valor);
    return uf > 1000 && utm > 10000 ? { uf, utm } : null;
  } catch { return null; } finally { clearTimeout(t); }
}
