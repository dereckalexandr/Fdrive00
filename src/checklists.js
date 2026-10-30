// Listas de ítems de la inspección y de la valorización del Inspector (las usan sus formularios y los PDF).

/* --- Checklist de inspección: agregar aquí nuevas secciones/ítems a futuro --- */
export const CHECKLIST_SECTIONS = [
  {
    id: "motor",
    title: "1. Motor y accesorios",
    items: [
      { id: "ruidos_anormales", label: "Ruidos anormales" },
      { id: "fugas_aceite", label: "Fugas de aceite" },
      { id: "fugas_aire", label: "Fugas de aire" },
      { id: "fugas_agua", label: "Fugas de agua" },
      { id: "fugas_bencina", label: "Fugas de bencina" },
      { id: "fugas_liquidos", label: "Fugas de líquidos" },
      { id: "necesita_afinamiento", label: "Necesita afinamiento" },
      { id: "estado_bateria", label: "Estado de la batería" },
      { id: "estado_alternador", label: "Estado del alternador" },
      { id: "estado_bobina", label: "Estado de bobina" },
      { id: "estado_distribucion", label: "Estado de distribución" },
      { id: "estado_cables", label: "Estado de cables" },
      { id: "estado_correas", label: "Estado de correas" },
      { id: "estado_sistema_cargas", label: "Estado sistema cargas" },
      { id: "estado_sistema_refrigerante", label: "Estado sistema refrigerante" },
      { id: "estado_general_motor", label: "Estado general motor" },
    ],
  },
  {
    id: "transmision",
    title: "2. Transmisión",
    items: [
      { id: "estado_caja_mecanica", label: "Estado caja mecánica" },
      { id: "estado_embrague", label: "Estado de embrague" },
      { id: "estado_caja_automatica", label: "Estado caja automática" },
      { id: "estado_homocineticas", label: "Estado Homocinéticas" },
      { id: "estado_llantas", label: "Estado de llantas" },
      { id: "estado_neumaticos", label: "Estado neumáticos" },
    ],
  },
  {
    id: "chasis",
    title: "3. Chasis",
    items: [
      { id: "sistema_frenos", label: "Sistema de frenos" },
      { id: "sistema_direccion", label: "Sistema de dirección" },
      { id: "sistema_suspension", label: "Sistema de suspensión" },
    ],
  },
  {
    id: "sistema_electrico",
    title: "4. Sistema eléctrico",
    items: [
      { id: "estado_luces", label: "Estado de luces" },
      { id: "estado_bocina", label: "Estado de bocina" },
      { id: "estado_limpia_parabrisas", label: "Estado limpia parabrisas" },
      { id: "estado_instrumentos", label: "Estado instrumentos" },
      { id: "estado_radio", label: "Estado radio" },
      { id: "estado_calefaccion_defrost", label: "Estado Calefacción y defrost" },
    ],
  },
  {
    id: "carroceria",
    title: "5. Carrocería",
    items: [
      { id: "tablero_instrumentos", label: "Tablero instrumentos" },
      { id: "tapiceria", label: "Tapicería" },
      { id: "frente_vehiculo", label: "Frente vehículo" },
      { id: "costado_piloto", label: "Costado piloto" },
      { id: "costado_copiloto", label: "Costado copiloto" },
      { id: "posterior_vehiculo", label: "Posterior vehículo" },
      { id: "parabrisas_carroceria", label: "Parabrisas" },
      { id: "vidrios_general", label: "Vidrios general" },
    ],
  },
  {
    id: "datos_identificacion",
    title: "6. Datos de identificación",
    items: [
      { id: "vin_corresponde_padron_chasis", label: "Número de VIN corresponde en padrón y chasis" },
      { id: "motor_corresponde_padron_motor", label: "Número de motor corresponde en padrón y motor" },
    ],
  },
];

export const ESTADOS_DOCUMENTO = ["Al día", "Atrasado"];
export const ESTADOS_SI_NO = ["Sí", "No"];
export const ESTADOS_CARROCERIA = ["Bueno", "Reparado", "Dañado", "Repintado", "Rayado", "Piquete", "Abollado"];
export const ESTADOS_INTERIOR = ["Bueno", "Regular", "Dañado", "No aplica"];
export const ESTADOS_VIDRIO = ["Vidrio original", "No original"];

/* --- Checklist de tasación: agregar aquí nuevas secciones/ítems a futuro --- */
export const TASACION_SECTIONS = [
  {
    id: "carroceria",
    title: "1. Carrocería",
    type: "fixed",
    estadoOptions: ESTADOS_CARROCERIA,
    items: [
      { id: "parabrisas", label: "Parabrisas" },
      { id: "capot", label: "Capot" },
      { id: "mascara", label: "Máscara" },
      { id: "foco_delantero_derecho", label: "Foco delantero derecho" },
      { id: "foco_delantero_izquierdo", label: "Foco delantero izquierdo" },
      { id: "frente", label: "Frente" },
      { id: "parachoques_delantero", label: "Parachoques delantero" },
      { id: "tapabarro_delantero_izquierdo", label: "Tapabarro delantero izquierdo" },
      { id: "puerta_delantera_izquierda", label: "Puerta delantera izquierda", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "puerta_trasera_izquierda", label: "Puerta trasera izquierda", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "tapabarro_trasero_izquierdo", label: "Tapabarro trasero izquierdo" },
      { id: "portalon", label: "Portalón" },
      { id: "luneta_trasera", label: "Luneta trasera" },
      { id: "foco_trasero_izquierdo", label: "Foco trasero izquierdo" },
      { id: "foco_trasero_derecho", label: "Foco trasero derecho" },
      { id: "frente_trasero", label: "Frente trasero" },
      { id: "parachoques_trasero", label: "Parachoques trasero" },
      { id: "tapabarro_trasero_derecho", label: "Tapabarro trasero derecho" },
      { id: "puerta_trasera_derecha", label: "Puerta trasera derecha", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "puerta_delantera_derecha", label: "Puerta delantera derecha", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "tapabarro_delantero_derecho", label: "Tapabarro delantero derecho" },
      { id: "techo_capota", label: "Techo o capota" },
      { id: "chasis_carroceria", label: "Chasis" },
      { id: "piso_base", label: "Piso o base" },
    ],
  },
  {
    id: "interior",
    title: "2. Interior",
    type: "fixed",
    estadoOptions: ESTADOS_INTERIOR,
    items: [
      { id: "tablero_tasacion", label: "Tablero" },
      { id: "tapiceria_asientos", label: "Tapicería asientos" },
      { id: "techo_interior", label: "Techo interior" },
      { id: "alfombras", label: "Alfombras" },
      { id: "revestimientos_puertas", label: "Revestimientos puertas" },
      { id: "salpicadera", label: "Salpicadera" },
    ],
  },
  {
    id: "neumaticos_tasacion",
    title: "3. Neumáticos",
    type: "fixed",
    items: [
      { id: "neum_delantero_derecho", label: "Delantero derecho" },
      { id: "neum_delantero_izquierdo", label: "Delantero izquierdo" },
      { id: "neum_trasero_derecho", label: "Trasero derecho" },
      { id: "neum_trasero_izquierdo", label: "Trasero izquierdo" },
      { id: "neum_repuesto", label: "Repuesto" },
    ],
  },
  { id: "motor_tasacion", title: "4. Sistema motor", type: "dynamic", slots: 5 },
  { id: "transmision_tasacion", title: "5. Sistema de transmisión", type: "dynamic", slots: 5 },
  { id: "frenos_tasacion", title: "6. Sistema de frenos", type: "dynamic", slots: 5 },
  { id: "electrico_tasacion", title: "7. Sistema eléctrico", type: "dynamic", slots: 5 },
  { id: "direccion_tasacion", title: "8. Sistema de dirección", type: "dynamic", slots: 5 },
  { id: "suspension_tasacion", title: "9. Sistema de suspensión", type: "dynamic", slots: 5 },
  {
    id: "documentacion",
    title: "10. Documentación",
    type: "fixed",
    items: [
      { id: "permiso_circulacion", label: "Permiso de circulación", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "revision_tecnica", label: "Revisión técnica", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "soap", label: "SOAP", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "padron", label: "Padrón", estadoOptions: ESTADOS_SI_NO },
    ],
  },
  {
    id: "aceite_bateria_vidrios",
    title: "11. Aceite y Batería",
    type: "fixed",
    items: [
      { id: "aceite", label: "Aceite" },
      { id: "bateria_tasacion", label: "Batería" },
    ],
  },
];
export function getTasacionSectionItems(section) {
  if (section.type === "dynamic") {
    return Array.from({ length: section.slots }, (_, i) => ({ id: `${section.id}_${i + 1}`, label: "", dynamic: true }));
  }
  return section.items;
}
