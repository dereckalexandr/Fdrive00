/**
 * EXTRACCIÓN AUTOMÁTICA DE DATOS DESDE EL CAV (PDF)
 * ----------------------------------------------------------------
 * Lee el texto del PDF cargado en el módulo CAV y trata de detectar
 * los datos del vehículo y del propietario, para autocompletar los
 * formularios de "Datos del vehículo" y "Datos del propietario".
 *
 * Las etiquetas de campo (`CAV_FIELD_DEFS` abajo) fueron ajustadas a
 * partir de un "Certificado de Inscripción y Anotaciones Vigentes en
 * el R.V.M." real del Registro Civil de Chile (formato: "Etiqueta :
 * Valor", una por línea). Se agregaron además variantes alternativas
 * por si otro formato de CAV usa una redacción distinta.
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

// Variantes de etiqueta conocidas/probables por campo, de más a menos
// específicas. La primera lista de cada campo son las etiquetas reales
// confirmadas en un CAV real; las siguientes son variantes de respaldo.
const CAV_FIELD_DEFS = [
  { key: "inscripcion", labels: ["INSCRIPCION", "N DE INSCRIPCION", "NUMERO DE INSCRIPCION", "PLACA PATENTE UNICA", "PLACA UNICA", "PATENTE", "PPU"] },
  { key: "marca", labels: ["MARCA"] },
  { key: "modelo", labels: ["MODELO"] },
  { key: "nroMotor", labels: ["NRO. MOTOR", "NRO MOTOR", "N DE MOTOR", "NUMERO DE MOTOR", "N MOTOR", "MOTOR N", "MOTOR"] },
  { key: "nroChasis", labels: ["NRO. CHASIS", "NRO CHASIS", "N DE CHASIS", "NUMERO DE CHASIS", "N CHASIS", "CHASIS N", "CHASIS"] },
  { key: "nroSerie", labels: ["NRO. SERIE", "NRO SERIE", "N DE SERIE", "NUMERO DE SERIE", "N SERIE", "SERIE N", "SERIE"] },
  { key: "nroVin", labels: ["NRO. VIN", "NRO VIN", "N DE VIN", "NUMERO DE VIN", "N VIN", "VIN N", "VIN"] },
  { key: "color", labels: ["COLOR PRINCIPAL", "COLOR DEL VEHICULO", "COLOR"] },
  { key: "propietarioNombre", labels: ["NOMBRE DEL PROPIETARIO", "NOMBRE O RAZON SOCIAL", "NOMBRE COMPLETO", "NOMBRE"] },
  { key: "propietarioRun", labels: ["R.U.N.", "RUN DEL PROPIETARIO", "RUN", "RUT DEL PROPIETARIO", "RUT"] },
];

const ALL_LABELS_NORM = [...new Set(CAV_FIELD_DEFS.flatMap((f) => f.labels.map(normalize)))];

function normalize(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º]/g, "")
    .toUpperCase();
}

// RUN/RUT chileno con puntos y guión obligatorios (ej. "15.376.859-5"),
// para no confundirlo con otros números largos del documento (folio,
// número de póliza, código de barras, etc.) que no llevan ese formato.
const RUN_PATTERN = /\b(\d{1,2}\.\d{3}\.\d{3}-[\dkK])\b/;

/**
 * Busca, línea por línea, los campos definidos en CAV_FIELD_DEFS.
 * Devuelve solo los campos que logró encontrar (objeto parcial).
 */
export function parseCavFields(rawText) {
  if (!rawText) return {};
  const lines = rawText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const result = {};

  for (const field of CAV_FIELD_DEFS) {
    const labelsSorted = [...field.labels].sort((a, b) => b.length - a.length);
    let matched = false;

    for (const label of labelsSorted) {
      if (matched) break;
      const labelNorm = normalize(label);

      for (const line of lines) {
        const normLine = normalize(line);
        const idx = normLine.indexOf(labelNorm);
        if (idx === -1) continue;

        // Debe ir seguida de ":" (con espacios opcionales) para ser un
        // campo real ("Inscripción : KXPT.62-7"), y no una mención suelta
        // en un título o encabezado (ej. "...INSCRIPCION Y ANOTACIONES...").
        const afterLabel = normLine.slice(idx + labelNorm.length);
        if (!/^\s*:/.test(afterLabel)) continue;

        let value = line.slice(idx + labelNorm.length);
        value = value.replace(/^[.:\-\s]+/, "").trim();

        // Si en la MISMA línea aparece otra etiqueta conocida después
        // (ej. "Tipo Vehículo : STATION WAGON Año : 2019"), cortar ahí.
        let cutAt = value.length;
        const normValue = normalize(value);
        for (const other of ALL_LABELS_NORM) {
          if (other === labelNorm) continue;
          const otherIdx = normValue.indexOf(other);
          if (otherIdx !== -1 && otherIdx < cutAt) cutAt = otherIdx;
        }
        value = value.slice(0, cutAt).trim();
        if (value.length > 80) value = value.slice(0, 80).trim();

        if (value) {
          result[field.key] = value;
          matched = true;
          break;
        }
      }
    }
  }

  // El R.U.N. se confirma además con un patrón numérico estricto,
  // por si la extracción por etiqueta no lo encontró.
  if (!result.propietarioRun) {
    const runMatch = rawText.match(RUN_PATTERN);
    if (runMatch) result.propietarioRun = runMatch[1];
  }

  return result;
}
