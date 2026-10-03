/**
 * EXTRACCIÓN AUTOMÁTICA DE DATOS DESDE EL CAV (PDF)
 * ----------------------------------------------------------------
 * Lee el texto del PDF cargado en el módulo CAV y trata de detectar
 * los datos del vehículo y del propietario, para autocompletar los
 * formularios de "Datos del vehículo" y "Datos del propietario".
 *
 * Las etiquetas de campo (`CAV_FIELD_DEFS` en cav-fields.js) se ajustaron a
 * un "Certificado de Inscripción y Anotaciones Vigentes en el R.V.M." real
 * del Registro Civil de Chile, donde la etiqueta y su valor vienen en líneas
 * consecutivas ("Marca :" / "TOYOTA"). También se acepta el valor en la
 * misma línea.
 *
 * ⚠️ LIMITACIÓN: solo funciona si el PDF tiene texto real (no una
 * imagen escaneada). Si el CAV es un escaneo, esta extracción no
 * encontrará nada — habría que agregar reconocimiento óptico de
 * caracteres (OCR), que es un paso adicional no incluido aquí.
 * ----------------------------------------------------------------
 */
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

/**
 * Extrae el texto de todas las páginas del PDF, PRESERVANDO las líneas
 * visuales reales (agrupando los fragmentos de texto por su posición Y
 * en la página). Esto es clave: un CAV tiene un campo por línea
 * ("Marca : JEEP"), y si perdemos esa separación de líneas, un campo
 * puede "arrastrar" texto de los campos siguientes al extraerlo.
 */
export async function extractPdfText(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const allLines = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter((it) => typeof it.str === "string" && it.str.length > 0);

    let currentY = null;
    let currentLine = [];
    for (const item of items) {
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      if (currentY === null || Math.abs(y - currentY) > 2) {
        if (currentLine.length) allLines.push(currentLine.join(" "));
        currentLine = [item.str];
        currentY = y;
      } else {
        currentLine.push(item.str);
      }
    }
    if (currentLine.length) allLines.push(currentLine.join(" "));
  }

  return allLines.join("\n");
}

// El análisis de campos vive en cav-fields.js (sin pdf.js, para poder probarlo en Node).
export { parseCavFields, CAV_FIELD_DEFS } from "./cav-fields.js";
