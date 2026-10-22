-- Patentes consultadas con la API de Boostr: se guardan PARA SIEMPRE para no volver a gastar el cupo diario.
-- Ejecutar en Supabase -> SQL Editor. Se puede repetir sin riesgo.
-- Solo guarda datos del vehículo (marca, modelo, año, tipo y datos técnicos): nunca datos de personas.

create table if not exists patentes_consultadas (
  patente          text primary key,                       -- sin puntos ni guion, en mayúsculas (ej. GPDD74)
  marca            text not null,
  modelo_completo  text not null,                          -- tal como lo entrega el proveedor (incluye la versión)
  anio             int,
  tipo             text,
  extras           jsonb not null default '{}'::jsonb,      -- color, transmisión, combustible, versión… si el plan del proveedor los entrega
  fuente           text not null default 'boostr',          -- boostr:interno (CRM) o boostr:web (sitio web)
  consultado_en    timestamptz not null default now()
);

-- Seguridad: solo la función del servidor (service role) puede leer o escribir.
alter table patentes_consultadas enable row level security;
