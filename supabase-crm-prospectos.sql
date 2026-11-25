-- Drive Futuro CRM · Prospección en Chileautos: avisos que el equipo eligió para contactar a sus dueños y convertir en leads de compra.
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
-- Solo se guarda lo del AVISO (auto, año, km, precio, tipo de vendedor y el enlace). Nunca el nombre ni el teléfono de un particular.
-- RLS activado y SIN políticas: solo la Edge Function accede.
create table if not exists prospectos (
  id uuid primary key default gen_random_uuid(),
  fuente text not null default 'chileautos',
  aviso_id text not null,                          -- identificador del aviso en Chileautos (CL-AD-1234567)
  local_id uuid references locales(id) on delete cascade,
  titulo text not null,
  version text,
  anio integer,
  km integer,
  precio bigint not null,
  transmision text,
  combustible text,
  vendedor_tipo text,                              -- particular | automotora
  vendedor_nombre text,                            -- solo de una automotora (un negocio)
  destacado boolean not null default false,        -- aviso pagado para aparecer arriba
  href text not null,                              -- /vehiculos/detalles/<slug>/<id>/
  estado text not null default 'nuevo',            -- nuevo | contactado | respondio | descartado | convertido
  notas text,
  lead_id uuid references leads(id) on delete set null,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (fuente, aviso_id, local_id)
);
create index if not exists prospectos_local_idx on prospectos (local_id, estado, creado_en desc);
alter table prospectos enable row level security;
