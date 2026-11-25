/**
 * PISTA · PÁGINA DE PRESENTACIÓN (pistacrm.com)
 * ----------------------------------------------------------------
 * Landing comercial del CRM «Pista», el producto que se vende a automotoras. Se muestra en pistacrm.com y www.pistacrm.com
 * (o en la ruta «/pista» para revisarla en local). El CRM en sí se abre en app.pistacrm.com.
 * No usa Supabase: es una página estática liviana. El contacto va por correo a contacto@pistacrm.com.
 * ----------------------------------------------------------------
 */
import React, { useEffect } from "react";
import { LogotipoPista, ponerIconosPista, FUENTE_TITULOS } from "./marca-pista.jsx";

export const URL_APP_PISTA = "https://app.pistacrm.com";
const CORREO = "contacto@pistacrm.com";
const MAILTO_DEMO = `mailto:${CORREO}?subject=${encodeURIComponent("Quiero una demo de Pista")}&body=${encodeURIComponent("Hola, quiero conocer Pista para mi automotora.\n\nNombre:\nAutomotora:\nCiudad:\nTeléfono:\n")}`;
const T = { fontFamily: FUENTE_TITULOS };

const MODULOS = [
  { t: "Todos tus leads en un solo lugar", d: "Los contactos de Chileautos, WhatsApp, tu sitio web y tus campañas llegan solos al CRM y se reparten entre tus vendedores." },
  { t: "WhatsApp integrado", d: "Conversa con tus clientes desde el CRM, con etiquetas, notas de voz y un asistente que responde fuera de horario." },
  { t: "Seguimiento que no se olvida", d: "Tareas y recordatorios para cada cliente, agenda de visitas y pruebas de manejo, y una vista «Hoy» con lo urgente." },
  { t: "Compras y tasaciones", d: "Tasa autos en parte de pago con precios de mercado, registra compras, documentos e inspecciones del vehículo." },
  { t: "Inventario y avisos", d: "Tu stock con fotos, precios y estado, y un catálogo web propio que se actualiza solo." },
  { t: "Ventas, cierres y finanzas", d: "Cotizaciones, reservas, pagos y cierres de venta, con la rentabilidad de cada auto y reportes por vendedor." },
];

const PASOS = [
  { n: "1", t: "Conversamos", d: "Nos cuentas cómo vende hoy tu automotora y te mostramos Pista con tus propios casos." },
  { n: "2", t: "Te dejamos andando", d: "Cargamos tu inventario, conectamos tus canales y capacitamos a tu equipo." },
  { n: "3", t: "Vendes con orden", d: "Cada lead tiene dueño y seguimiento, y tú ves en tiempo real cómo va el negocio." },
];

export default function SitioPista() {
  useEffect(() => {
    document.title = "Pista · De lead a llaves. CRM para automotoras";
    ponerIconosPista();
  }, []);

  const BTN = "inline-block px-6 py-3 rounded-lg bg-[#FF6B1A] text-[#0E1B2C] font-semibold hover:bg-[#ff8340] transition-colors";
  const BTN_2 = "inline-block px-6 py-3 rounded-lg border border-white/30 text-white font-medium hover:bg-white/10 transition-colors";

  return (
    <div className="min-h-screen bg-white text-[#0E1B2C]" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <header className="bg-[#0E1B2C]">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <a href="/" aria-label="Pista, inicio"><LogotipoPista tono="marfil" alto={30} /></a>
          <nav className="flex items-center gap-3 text-sm">
            <a href="#funciones" className="hidden sm:inline text-white/80 hover:text-white px-2">Funciones</a>
            <a href="#como" className="hidden sm:inline text-white/80 hover:text-white px-2">Cómo empezar</a>
            <a href={URL_APP_PISTA} className="text-white border border-white/30 rounded-lg px-4 py-2 hover:bg-white/10">Ingresar</a>
          </nav>
        </div>
      </header>

      <section className="bg-[#0E1B2C] text-white relative overflow-hidden">
        <div className="absolute left-0 right-0 bottom-16 border-t-[6px] border-dashed border-[#FF6B1A]/25" aria-hidden="true" />
        <div className="max-w-6xl mx-auto px-5 pt-16 pb-28 relative">
          <p className="text-[#FF6B1A] font-semibold mb-4">CRM para automotoras</p>
          <h1 style={T} className="text-5xl sm:text-7xl font-bold leading-none tracking-tight max-w-3xl">De lead a <span className="text-[#FF6B1A]">llaves</span>.</h1>
          <p className="mt-6 text-lg text-white/80 max-w-2xl">Ningún lead se queda en los pits. Pista reúne tus leads, tu WhatsApp, tu inventario y tus ventas en una sola plataforma hecha para cómo se venden autos en Chile.</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a href={MAILTO_DEMO} className={BTN}>Agenda una demo</a>
            <a href="#funciones" className={BTN_2}>Ver funciones</a>
          </div>
        </div>
      </section>

      <section id="funciones" className="max-w-6xl mx-auto px-5 py-20">
        <h2 style={T} className="text-3xl font-bold mb-3">Todo lo que tu automotora necesita para vender</h2>
        <p className="text-slate-600 max-w-2xl mb-12">Desde que entra el lead hasta que entregas las llaves, sin planillas ni mensajes perdidos.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {MODULOS.map((m) => (
            <div key={m.t} className="border border-slate-200 rounded-xl p-6">
              <div className="w-10 h-1.5 bg-[#FF6B1A] rounded mb-4" aria-hidden="true" />
              <h3 style={T} className="font-semibold text-lg mb-2">{m.t}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{m.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="como" className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <h2 style={T} className="text-3xl font-bold mb-12">Cómo empezar</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {PASOS.map((p) => (
              <div key={p.n}>
                <div className="w-10 h-10 rounded-lg bg-[#0E1B2C] text-[#FF6B1A] font-bold flex items-center justify-center mb-4">{p.n}</div>
                <h3 style={T} className="font-semibold text-lg mb-2">{p.t}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="bg-[#0E1B2C] text-white rounded-2xl p-10 sm:p-14 flex flex-col md:flex-row md:items-center md:justify-between gap-8">
          <div>
            <h2 style={T} className="text-3xl font-bold mb-3">Pon a tu equipo en la pole</h2>
            <p className="text-white/80 max-w-xl">Escríbenos y te mostramos Pista funcionando con el día a día de tu automotora.</p>
          </div>
          <a href={MAILTO_DEMO} className={`${BTN} whitespace-nowrap`}>Agenda una demo</a>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between text-sm text-slate-500">
          <div className="flex items-center gap-3">
            <LogotipoPista tono="noche" alto={22} />
            <span style={T} className="font-bold text-[#0E1B2C]">De lead a llaves.</span>
          </div>
          <p>
            <a href={`mailto:${CORREO}`} className="hover:text-[#0E1B2C]">{CORREO}</a>
            {" · "}
            <a href={URL_APP_PISTA} className="hover:text-[#0E1B2C]">Ingresar a la plataforma</a>
            {" · "}© {new Date().getFullYear()} Pista
          </p>
        </div>
      </footer>
    </div>
  );
}
