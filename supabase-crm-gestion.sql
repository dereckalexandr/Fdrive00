-- Drive Futuro CRM · Entrega 3: panel de gestión del Jefe Local (alertas, avisos, embudo del equipo).
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-cierres.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

-- Última vez que algo ocurrió en el lead (contacto, nota, cotización, reserva…). Sirve para detectar leads detenidos.
alter table leads add column if not exists ultima_actividad timestamptz;

-- Avisos del supervisor a un ejecutivo (opcionalmente sobre un lead). El ejecutivo los ve en su inicio hasta marcarlos como leídos.
create table if not exists avisos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  para uuid not null references usuarios(id) on delete cascade,
  de_id text,
  de_nombre text,
  texto text not null,
  creado_en timestamptz not null default now(),
  leido_en timestamptz
);
create index if not exists avisos_para_idx on avisos (para, leido_en);
create index if not exists avisos_local_idx on avisos (local_id, creado_en desc);

alter table avisos enable row level security;
