// Política de privacidad del sitio público (/privacidad). Texto puro: lo usan la página y las pruebas.
// Los datos del responsable salen de «Datos de la empresa» (los edita el Administrador en el CRM → Ventas).
// Marco legal: Ley N° 19.628 sobre protección de la vida privada y, desde su entrada en vigencia (1 de diciembre de 2026),
// la Ley N° 21.719 que la reemplaza y crea la Agencia de Protección de Datos Personales.

export const ACTUALIZADA = "19 de noviembre de 2026";

const limpio = (x) => String(x ?? "").replace(/\s+/g, " ").trim();

/**
 * Secciones de la política. `d` = { sitio, whatsapp, direccion, responsable: { razon_social, rut, domicilio, comuna, region, correo } }.
 * Lo que falte se reemplaza por textos genéricos (nunca queda un hueco vacío).
 */
export function seccionesPrivacidad(d = {}) {
  const r = d.responsable || {};
  const sitio = limpio(d.sitio) || "nuestro sitio";
  const razon = limpio(r.razon_social);
  const domicilio = [r.domicilio, r.comuna, r.region].map(limpio).filter(Boolean).join(", ");
  const correo = limpio(r.correo);
  const wa = limpio(d.whatsapp).replace(/\D/g, "");
  const canales = [correo ? `al correo ${correo}` : "", wa ? `por WhatsApp al +${wa}` : ""].filter(Boolean);
  const comoContactar = canales.length ? `${canales.join(", ")} o en nuestro local` : "en nuestro local";

  return [
    {
      titulo: "1. Quién es responsable de tus datos",
      parrafos: [
        razon
          ? `El responsable del tratamiento de tus datos personales es ${razon}${r.rut ? `, RUT ${limpio(r.rut)}` : ""}${domicilio ? `, con domicilio en ${domicilio}` : ""}, que opera bajo el nombre ${sitio}.`
          : `El responsable del tratamiento de tus datos personales es la empresa que opera ${sitio}.`,
        `Para cualquier consulta sobre esta política o sobre tus datos, puedes contactarnos ${comoContactar}.`,
      ],
    },
    {
      titulo: "2. Qué datos recopilamos",
      parrafos: ["Solo pedimos lo necesario para atenderte:"],
      lista: [
        "Datos de contacto: nombre, teléfono, correo electrónico y, si compras o vendes un vehículo, RUT y dirección.",
        "Lo que nos cuentas en tus solicitudes: el vehículo que te interesa, si quieres financiamiento, visitas agendadas y tus comentarios.",
        "Datos del vehículo que nos ofreces vender, consignar o dejar en parte de pago: patente, marca, modelo, año, kilometraje, fotos y documentos (por ejemplo, el certificado de anotaciones vigentes).",
        "Conversaciones por WhatsApp: tu número, el nombre de tu perfil, los mensajes, fotos y documentos que nos envías y los que te enviamos.",
        "Formularios de nuestros anuncios en Facebook, Instagram o Google: los datos que ingresas en ellos (nombre, teléfono, correo y tus respuestas), que recibimos de la plataforma para contactarte.",
        "Para concretar una compraventa: los documentos que exige la ley y, si te pagamos un vehículo, la cuenta bancaria donde recibes el pago.",
        "Datos técnicos mínimos para la seguridad del sitio, como la dirección IP, que usamos para limitar envíos abusivos y detectar robots.",
      ],
    },
    {
      titulo: "3. Para qué los usamos",
      lista: [
        "Responder tus consultas y solicitudes, y contactarte sobre ellas por teléfono, WhatsApp o correo.",
        "Cotizar vehículos, evaluar financiamiento (solo si lo pides) y tasar el vehículo que nos ofreces.",
        "Preparar y cumplir la compraventa, la consignación o la reserva que acordemos, incluidos los contratos y la transferencia del vehículo.",
        "Cumplir obligaciones legales, tributarias y contables.",
        "Proteger el sitio y nuestros sistemas contra el uso abusivo.",
      ],
      parrafos2: ["No usamos tus datos para fines distintos de estos ni tomamos decisiones automatizadas que te afecten."],
    },
    {
      titulo: "4. Por qué podemos tratarlos",
      lista: [
        "Tu consentimiento, que nos das al enviar una solicitud o escribirnos. Puedes retirarlo cuando quieras.",
        "La preparación y ejecución del contrato que celebremos contigo (cotización, reserva, compraventa o consignación).",
        "El cumplimiento de obligaciones legales, por ejemplo, las tributarias.",
        "Nuestro interés legítimo en mantener la seguridad del sitio, sin afectar tus derechos.",
      ],
    },
    {
      titulo: "5. Con quién los compartimos",
      parrafos: ["No vendemos ni arrendamos tus datos. Solo los compartimos cuando es necesario para atenderte:"],
      lista: [
        "Proveedores tecnológicos que nos prestan servicios y tratan los datos por encargo nuestro: Supabase (base de datos y servidores), Vercel (alojamiento del sitio), Meta Platforms (WhatsApp Business), Resend (envío de correos) y Cloudflare (verificación contra robots).",
        "Instituciones financieras, solo si nos pides evaluar un crédito.",
        "Notarías, el Registro Civil y otras entidades que intervienen en la transferencia de un vehículo.",
        "Autoridades, cuando una ley o una resolución judicial lo exige.",
      ],
      parrafos2: ["Algunos de estos proveedores almacenan datos en servidores fuera de Chile (por ejemplo, en Estados Unidos). Los elegimos porque ofrecen medidas de seguridad y compromisos de confidencialidad adecuados."],
    },
    {
      titulo: "6. Cuánto tiempo los guardamos",
      lista: [
        "Solicitudes y conversaciones que no terminaron en una operación: hasta 24 meses desde el último contacto.",
        "Datos de una compraventa o consignación: el tiempo que exigen las leyes tributarias y comerciales (en general, 6 años).",
        "Cuando ya no son necesarios, los eliminamos o los anonimizamos.",
      ],
    },
    {
      titulo: "7. Tus derechos",
      parrafos: ["Puedes pedirnos en cualquier momento:"],
      lista: [
        "Acceso: saber qué datos tuyos tenemos y para qué.",
        "Rectificación: corregir datos inexactos o incompletos.",
        "Supresión: que eliminemos tus datos, salvo los que la ley nos obliga a conservar.",
        "Oposición: que dejemos de usarlos para un fin determinado, como contactarte.",
        "Portabilidad: recibir tus datos en un formato de uso común.",
        "Bloqueo: que suspendamos temporalmente su uso mientras se resuelve una solicitud.",
      ],
      parrafos2: [
        `Para ejercerlos, contáctanos ${comoContactar}, indicando tu nombre y lo que necesitas. Podemos pedirte que confirmes tu identidad. Responderemos dentro del plazo legal (30 días corridos).`,
        "Si no quedas conforme con nuestra respuesta, puedes reclamar ante la Agencia de Protección de Datos Personales o ante los tribunales, según corresponda.",
      ],
    },
    {
      titulo: "8. Eliminación de tus datos",
      parrafos: [
        `Si quieres que borremos tus datos (incluidas las conversaciones por WhatsApp), contáctanos ${comoContactar} con el asunto «Eliminar mis datos» e indica el teléfono o correo con que te contactaste. Te confirmaremos cuando estén eliminados.`,
        "Si solo quieres dejar de recibir mensajes, respóndenos «No quiero recibir más mensajes» por WhatsApp y dejaremos de contactarte.",
      ],
    },
    {
      titulo: "9. Cómo protegemos tus datos",
      parrafos: ["Toda la información viaja cifrada (HTTPS). Solo el personal que te atiende puede ver tus datos, con su propia clave y permisos según su función, y las acciones importantes sobre tus datos quedan registradas."],
    },
    {
      titulo: "10. Cookies y almacenamiento en tu navegador",
      parrafos: ["El sitio no usa cookies publicitarias ni herramientas de seguimiento. Guarda en tu navegador solo lo necesario para funcionar (por ejemplo, la página que estabas viendo). La verificación contra robots de Cloudflare puede usar cookies técnicas para confirmar que eres una persona."],
    },
    {
      titulo: "11. Menores de edad",
      parrafos: ["Nuestros servicios están dirigidos a mayores de 18 años. No recopilamos a sabiendas datos de menores de edad."],
    },
    {
      titulo: "12. Cambios a esta política",
      parrafos: [`Podemos actualizar esta política. La versión vigente siempre estará en esta página, con su fecha de actualización. Última actualización: ${ACTUALIZADA}.`],
    },
  ];
}
