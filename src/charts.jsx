/**
 * Gráficas del panel (se cargan aparte porque la librería pesa mucho; ver App.jsx).
 */
import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

/** Actividad de los últimos 6 meses. `data` = [{ mes, Inspecciones, Tasaciones }]. */
export function GraficoActividad({ data }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 12, left: -16, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#78716C" }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#78716C" }} />
          <Tooltip contentStyle={{ border: "1px solid #E7E5E4", fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Inspecciones" fill="#0284C7" />
          <Bar dataKey="Tasaciones" fill="#D97706" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
