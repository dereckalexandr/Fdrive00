-- Drive Futuro CRM · Entrega 6: perfil del Validador (revisión de documentos de ventas, vehículos y compras).
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-inspecciones.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.
-- Los archivos (fotos y PDF) no se guardan aquí: van en kv_store como dval::<validación>::<archivo>.

create table if not exists validaciones (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: VAL-000012
  local_id uuid references locales(id) on delete set null,
  tipo text not null,                           -- venta | vehiculo | compra
  cierre_id uuid references cierres(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  vehiculo_id uuid references vehiculos(id) on delete set null,
  tasacion_id uuid references tasaciones(id) on delete set null,
  sujeto jsonb not null default '{}'::jsonb,    -- resumen para mostrar: vehículo (patente, marca, modelo, año) y cliente
  validador_id uuid references usuarios(id) on delete set null,     -- quien la tomó (vacío = en la cola)
  estado text not null default 'pendiente',     -- pendiente | en_revision | observada | rechazada | aprobada | cancelada
  solicitada_en timestamptz not null default now(),
  tomada_en timestamptz,
  resuelta_en timestamptz,                      -- cuando quedó aprobada
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists validaciones_local_estado_idx on validaciones (local_id, estado);
create index if not exists validaciones_cierre_idx on validaciones (cierre_id);
create index if not exists validaciones_vehiculo_idx on validaciones (vehiculo_id);
create index if not exists validaciones_lead_idx on validaciones (lead_id);
create index if not exists validaciones_validador_idx on validaciones (validador_id, estado);

create table if not exists validacion_docs (
  id uuid primary key default gen_random_uuid(),
  validacion_id uuid not null references validaciones(id) on delete cascade,
  clave text not null,                          -- padron, soap, cedula_cliente...
  nombre text not null,
  grupo text not null default 'vehiculo',       -- vehiculo | cliente
  requerido boolean not null default true,
  estado text not null default 'pendiente',     -- pendiente | aprobado | observado | rechazado | no_aplica
  comentario text,
  archivos jsonb not null default '[]'::jsonb,  -- [{id, nombre, tipo, tam, v?}]
  revisado_por text,
  revisado_en timestamptz,
  orden int not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (validacion_id, clave)
);
create index if not exists validacion_docs_val_idx on validacion_docs (validacion_id);

alter table validaciones enable row level security;
alter table validacion_docs enable row level security;
