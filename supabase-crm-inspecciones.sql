-- Drive Futuro CRM · Entrega 5: perfil del Inspector (solicitudes con cola y agenda, resultado visible para el equipo).
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-tasaciones.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.
-- Los datos del propietario (nombre y RUN) NO se guardan aquí: quedan solo en la ficha del Inspector (kv_store).

create table if not exists inspecciones (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: INS-000012
  local_id uuid references locales(id) on delete set null,
  origen text not null default 'lead',          -- lead | tasacion | vehiculo | espontanea (la hizo el Inspector sin que se la pidieran)
  lead_id uuid references leads(id) on delete set null,
  tasacion_id uuid references tasaciones(id) on delete set null,
  vehiculo_id uuid references vehiculos(id) on delete set null,
  solicitante_id uuid references usuarios(id) on delete set null,   -- quien la pidió
  inspector_id uuid references usuarios(id) on delete set null,     -- quien la tomó (vacío = en la cola)
  vehiculo jsonb not null default '{}'::jsonb,                      -- patente, marca, modelo, versión, año, km...
  patente text,
  direccion text,                               -- dónde está el vehículo
  agendada_para timestamptz,                    -- fecha y hora acordadas
  contacto_lugar text,                          -- con quién coordinar en el lugar (nombre/teléfono): NO es el propietario del padrón
  estado text not null default 'pendiente',     -- pendiente | en_proceso (agendada) | completada | cancelada
  notas_solicitud text,
  inspeccion_key text,                          -- clave de la ficha completa del Inspector (kv_store)
  resultado jsonb not null default '{}'::jsonb, -- resumen visible: veredicto, conteos, observaciones destacadas
  fotos jsonb not null default '[]'::jsonb,     -- ids de las fotos (cada una en kv_store: ifoto::<ficha>::<id>)
  solicitada_en timestamptz not null default now(),
  tomada_en timestamptz,
  completada_en timestamptz,
  cancelada_en timestamptz,
  motivo_cancelacion text,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists inspecciones_local_estado_idx on inspecciones (local_id, estado);
create index if not exists inspecciones_inspector_idx on inspecciones (inspector_id, estado);
create index if not exists inspecciones_lead_idx on inspecciones (lead_id);
create index if not exists inspecciones_patente_idx on inspecciones (patente);
-- Una ficha del Inspector corresponde a una sola inspección registrada.
create unique index if not exists inspecciones_key_uidx on inspecciones (inspeccion_key) where inspeccion_key is not null;

alter table inspecciones enable row level security;
