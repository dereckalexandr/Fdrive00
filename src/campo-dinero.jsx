/**
 * Campo para montos en pesos: muestra los puntos de miles mientras se escribe (1.250.000) y entrega al resto del programa
 * el número "limpio" (1250000), como antes. Se usa en lugar de <input type="number"> en todo campo de dinero.
 */
import React, { useLayoutEffect, useRef } from "react";
import { soloDigitos, conMiles } from "./dinero.js";

/**
 * Se usa igual que un <input>: `value` (texto o número) y `onChange` reciben/entregan `e.target.value` con los dígitos sin puntos.
 * Acepta `className`, `disabled`, `placeholder`, `autoFocus`, `required`… Los atributos min/max/step de los campos numéricos se ignoran
 * (el servidor valida los límites).
 */
export function InputDinero({ value, onChange, className = "", min, max, step, type, ...resto }) {
  const ref = useRef(null);
  const cursor = useRef(null); // cuántos dígitos había a la izquierda del cursor antes de reformatear
  const texto = conMiles(value);

  // Tras reformatear, el cursor vuelve al mismo dígito (si no, saltaría al final al escribir en medio del número).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || cursor.current === null || document.activeElement !== el) { cursor.current = null; return; }
    let vistos = 0;
    let pos = 0;
    while (pos < el.value.length && vistos < cursor.current) { if (/\d/.test(el.value[pos])) vistos++; pos++; }
    el.setSelectionRange(pos, pos);
    cursor.current = null;
  });

  return (
    <input
      {...resto}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={texto}
      className={className}
      onChange={(e) => {
        const crudo = e.target.value;
        const antes = crudo.slice(0, e.target.selectionStart ?? crudo.length);
        cursor.current = soloDigitos(antes).length;
        if (onChange) onChange({ target: { value: soloDigitos(crudo) } });
      }}
    />
  );
}
