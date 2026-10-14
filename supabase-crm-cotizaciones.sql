-- Drive Futuro CRM · Entrega 2B: cotizaciones (con aprobación de descuentos) y reservas.
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-ventas.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

create table if not exists cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: COT-000123
  local_id uuid references locales(id) on delete set null,
  lead_id uuid not null references leads(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete set null,
  vehiculo_id uuid references vehiculos(id) on delete set null,
  vehiculo_snapshot jsonb not null default '{}'::jsonb,  -- datos del vehículo al cotizar (para el PDF)
  precio_lista bigint not null,
  descuento bigint not null default 0,
  precio_final bigint not null,
  parte_pago jsonb not null default '{}'::jsonb,
  financiamiento jsonb not null default '{}'::jsonb,
  estado text not null default 'vigente',       -- vigente | pendiente | rechazada | reservada | anulada
  vigencia_hasta timestamptz,
  solicitado_por text,                          -- quién pidió el descuento
  aprobado_por text,
  aprobado_en timestamptz,
  motivo_rechazo text,
  notas text,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists cotizaciones_lead_idx on cotizaciones (lead_id);
create index if not exists cotizaciones_local_estado_idx on cotizaciones (local_id, estado);

create table if not exists reservas (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  lead_id uuid not null references leads(id) on delete cascade,
  cotizacion_id uuid references cotizaciones(id) on delete set null,
  vehiculo_id uuid not null references vehiculos(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete set null,
  monto bigint not null,
  medio_pago text,
  notas text,
  vence_en timestamptz not null,
  estado text not null default 'activa',        -- activa | vencida | cancelada | convertida (al cerrar la venta)
  motivo text,                                  -- por qué se canceló
  creado_por text,
  creado_en timestamptz not null default now(),
  cerrado_en timestamptz
);
-- Un vehículo solo puede tener UNA reserva activa. Esto lo garantiza la base aunque dos personas reserven a la vez.
create unique index if not exists reservas_vehiculo_activa on reservas (vehiculo_id) where estado = 'activa';
create index if not exists reservas_lead_idx on reservas (lead_id);
create index if not exists reservas_local_estado_idx on reservas (local_id, estado);

alter table cotizaciones enable row level security;
alter table reservas enable row level security;
