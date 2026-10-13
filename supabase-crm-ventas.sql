-- Drive Futuro CRM · Entrega 2A: inventario, clientes, leads de venta, tareas y seguimiento.
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-setup.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

-- Inventario de vehículos (se carga a mano). `fotos` guarda solo los ids; cada foto vive en kv_store (vfoto::<vehiculo>::<id>).
create table if not exists vehiculos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  patente text not null,                       -- normalizada: "ABCD12" o "AB1234"
  marca text not null,
  modelo text not null,
  version text,
  anio integer not null,
  km integer not null default 0,
  color text,
  transmision text,
  combustible text,
  precio_lista bigint,
  costo bigint,                                -- para margen y comisiones (no lo ven todos los roles)
  estado text not null default 'disponible',   -- preparacion | disponible | reservado | vendido
  notas text,
  fotos jsonb not null default '[]'::jsonb,
  activo boolean not null default true,        -- false = archivado (no se borra, por el historial)
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
-- Una patente solo puede estar una vez entre los vehículos activos.
create unique index if not exists vehiculos_patente_activa on vehiculos (patente) where activo;
create index if not exists vehiculos_local_idx on vehiculos (local_id);

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  nombre text not null,
  rut text,
  telefono text,
  email text,
  notas text,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists clientes_rut_local on clientes (local_id, rut) where rut is not null;
create index if not exists clientes_local_idx on clientes (local_id);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  tipo text not null default 'venta',          -- venta (compra y consignación llegan en otras entregas)
  etapa text not null default 'nuevo',         -- nuevo | contactado | seguimiento | cotizado | reservado | ganado | perdido
  cliente_id uuid references clientes(id) on delete set null,
  vehiculo_id uuid references vehiculos(id) on delete set null,
  vehiculo_interes text,                       -- texto libre si aún no está en el inventario
  fuente text,
  parte_pago jsonb not null default '{}'::jsonb,     -- vehículo que el cliente entrega
  financiamiento jsonb not null default '{}'::jsonb, -- pie, banco, estado de la evaluación
  asignado_a uuid references usuarios(id) on delete set null,
  motivo_perdida text,
  notas text,
  ultimo_contacto timestamptz,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists leads_local_idx on leads (local_id);
create index if not exists leads_asignado_idx on leads (asignado_a);
create index if not exists leads_etapa_idx on leads (etapa);

-- Historial de cada lead: contactos, notas, cambios de etapa y reasignaciones.
create table if not exists lead_eventos (
  id bigserial primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  usuario_id text,
  usuario_nombre text,
  tipo text not null,                          -- nota | llamada | whatsapp | visita | etapa | asignacion | creado
  detalle text,
  creado_en timestamptz not null default now()
);
create index if not exists lead_eventos_lead_idx on lead_eventos (lead_id, creado_en desc);

create table if not exists tareas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  asignado_a uuid references usuarios(id) on delete set null,
  local_id uuid references locales(id) on delete set null,
  titulo text not null,
  tipo text not null default 'llamada',        -- llamada | whatsapp | visita | otro
  vence_en timestamptz not null,
  hecha boolean not null default false,
  hecha_en timestamptz,
  creado_por uuid,
  creado_en timestamptz not null default now()
);
create index if not exists tareas_asignado_idx on tareas (asignado_a, hecha);
create index if not exists tareas_lead_idx on tareas (lead_id);

alter table vehiculos enable row level security;
alter table clientes enable row level security;
alter table leads enable row level security;
alter table lead_eventos enable row level security;
alter table tareas enable row level security;
