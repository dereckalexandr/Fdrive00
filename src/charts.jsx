/**
 * Gráficas del panel (se cargan aparte porque la librería pesa mucho; ver App.jsx).
 */
import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

/** Producción y líquido a pago por mes. `data` = [{ mes, "Producción", "Líquido a pago" }]. */
export function GraficoProduccion({ data }) {
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#78716C" }} />
          <YAxis tick={{ fontSize: 11, fill: "#78716C" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={45} />
          <Tooltip formatter={(v) => clp(v)} labelStyle={{ color: "#1C1917" }} contentStyle={{ border: "1px solid #E7E5E4", fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Producción" fill="#D97706" />
          <Bar dataKey="Líquido a pago" fill="#059669" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranking del mes por ejecutivo. `data` = [{ nombre, "Producción" }]. */
export function GraficoRanking({ data }) {
  return (
    <div style={{ width: "100%", height: Math.max(180, data.length * 46) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#78716C" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
          <YAxis type="category" dataKey="nombre" width={90} tick={{ fontSize: 12, fill: "#1C1917" }} />
          <Tooltip formatter={(v) => clp(v)} contentStyle={{ border: "1px solid #E7E5E4", fontSize: 13 }} />
          <Bar dataKey="Producción" fill="#D97706" barSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

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
