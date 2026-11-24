// Procesamiento de la voz al grabar notas de voz en el CRM: filtra el murmullo grave, nivela la voz (compresor), la sube
// y evita que se distorsione (limitador). Sin esto, el micrófono de un notebook queda bajo y desparejo en WhatsApp.
// Solo usa la Web Audio API del navegador; lo usan la grabadora de la pantalla y la prueba de volumen.

export const GANANCIA_VOZ = 1.6; // ≈ +4 dB después del compresor (el compresor ya sube lo bajo); deja margen antes del limitador

/** Pide el micrófono con la limpieza del propio navegador (eco, ruido y volumen automático) en mono. */
export const RESTRICCIONES_MICROFONO = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

/**
 * Cadena: fuente → dos filtros pasa-altos (100 Hz) → compresor de voz → ganancia → limitador.
 * Devuelve el nodo de salida y un analizador para mostrar el nivel mientras se graba.
 */
export function armarCadenaVoz(ctx, fuente) {
  // Dos filtros en cascada (24 dB por octava): cortan el zumbido de ventilador, mesa y red eléctrica sin tocar la voz (desde ~120 Hz).
  const pasaAltos = ctx.createBiquadFilter();
  pasaAltos.type = "highpass";
  pasaAltos.frequency.value = 100;
  const pasaAltos2 = ctx.createBiquadFilter();
  pasaAltos2.type = "highpass";
  pasaAltos2.frequency.value = 100;

  const compresor = ctx.createDynamicsCompressor();
  compresor.threshold.value = -32;
  compresor.knee.value = 24;
  compresor.ratio.value = 4;
  compresor.attack.value = 0.004;
  compresor.release.value = 0.22;

  const ganancia = ctx.createGain();
  ganancia.gain.value = GANANCIA_VOZ;

  const limitador = ctx.createDynamicsCompressor();
  limitador.threshold.value = -3;
  limitador.knee.value = 0;
  limitador.ratio.value = 20;
  limitador.attack.value = 0.001;
  limitador.release.value = 0.06;

  const analizador = ctx.createAnalyser();
  analizador.fftSize = 1024;

  fuente.connect(pasaAltos);
  pasaAltos.connect(pasaAltos2);
  pasaAltos2.connect(compresor);
  compresor.connect(ganancia);
  ganancia.connect(limitador);
  limitador.connect(analizador);
  return { salida: limitador, analizador };
}

/** Nivel actual de la señal, de 0 (silencio) a 1 (máximo), para la barra de volumen. */
export function nivelAnalizador(analizador) {
  const d = new Float32Array(analizador.fftSize);
  analizador.getFloatTimeDomainData(d);
  let pico = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pico) pico = v; }
  return Math.min(1, pico);
}
