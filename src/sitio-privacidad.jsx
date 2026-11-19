/**
 * Página «/privacidad» del sitio público: la política de privacidad, con los datos del responsable que el Administrador
 * mantiene en el CRM (Ventas → Datos de la empresa). Meta la exige para publicar la app de WhatsApp Business.
 */
import React, { useEffect, useState } from "react";
import { llamar } from "./publico-api.js";
import { seccionesPrivacidad, ACTUALIZADA } from "./privacidad-texto.js";

export default function Privacidad() {
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    let vivo = true;
    // Si el servidor no responde, la política se muestra igual con textos genéricos.
    llamar("privacidad").then((d) => { if (vivo) setDatos(d); }).catch(() => { if (vivo) setDatos({}); });
    return () => { vivo = false; };
  }, []);
  useEffect(() => { document.title = `Política de privacidad · ${(datos && datos.sitio) || "Drive Futuro"}`; }, [datos]);

  if (!datos) return <p className="max-w-3xl mx-auto px-4 py-10 text-stone-600">Cargando…</p>;
  const secciones = seccionesPrivacidad(datos);
  return (
    <article className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12 text-stone-800">
      <h1 className="font-serif text-3xl md:text-4xl text-stone-900">Política de privacidad</h1>
      <p className="text-sm text-stone-500 mt-2">Última actualización: {ACTUALIZADA}</p>
      <p className="mt-5 leading-relaxed">
        En {datos.sitio || "nuestro sitio"} cuidamos tus datos personales. Aquí te contamos qué datos recopilamos cuando visitas el sitio,
        nos envías una solicitud, nos escribes por WhatsApp o haces una operación con nosotros, para qué los usamos y cómo puedes ejercer tus derechos,
        de acuerdo con la Ley N° 19.628 sobre protección de la vida privada y la Ley N° 21.719 sobre protección de datos personales.
      </p>
      {secciones.map((s) => (
        <section key={s.titulo} className="mt-8">
          <h2 className="font-serif text-xl text-stone-900 mb-2">{s.titulo}</h2>
          {(s.parrafos || []).map((p, i) => <p key={`p${i}`} className="leading-relaxed mt-2">{p}</p>)}
          {s.lista && <ul className="list-disc pl-5 mt-2 space-y-1.5 leading-relaxed">{s.lista.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {(s.parrafos2 || []).map((p, i) => <p key={`q${i}`} className="leading-relaxed mt-3">{p}</p>)}
        </section>
      ))}
    </article>
  );
}
