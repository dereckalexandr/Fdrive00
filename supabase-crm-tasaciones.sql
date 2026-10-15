-- Drive Futuro CRM · Entrega 4: perfil del Tasador (solicitudes de los ejecutivos y tasaciones directas).
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-gestion.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

create table if not exists tasaciones (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: TAS-000012
  local_id uuid references locales(id) on delete set null,
  tipo text not null default 'parte_pago',      -- parte_pago (pedida desde un lead) | directa (cliente que llega a vender o consignar)
  lead_id uuid references leads(id) on delete set null,
  solicitante_id uuid references usuarios(id) on delete set null,   -- quien la pidió (ejecutivo)
  tasador_id uuid references usuarios(id) on delete set null,       -- quien la tomó (vacío = en la cola)
  contacto jsonb not null default '{}'::jsonb,                      -- tasación directa: nombre y teléfono de quien ofrece el vehículo
  vehiculo jsonb not null default '{}'::jsonb,                      -- patente, marca, modelo, versión, año, km, color, transmisión, combustible
  patente text,
  estado text not null default 'pendiente',     -- pendiente | en_proceso | completada | cancelada
  notas_solicitud text,
  valor_compra bigint,                          -- lo que se ofrece pagar / lo que se reconoce en parte de pago
  valor_venta bigint,                           -- lo que se espera vender el vehículo
  estimacion jsonb not null default '{}'::jsonb,    -- estimación de Chileautos (promedio, precios sugeridos y avisos usados)
  inspeccion jsonb not null default '{}'::jsonb,    -- referencia a una inspección ya hecha
  fotos jsonb not null default '[]'::jsonb,         -- ids de las fotos (cada una en kv_store: tfoto::<tasación>::<id>)
  observaciones text,
  solicitada_en timestamptz not null default now(),
  tomada_en timestamptz,
  completada_en timestamptz,
  cancelada_en timestamptz,
  motivo_cancelacion text,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists tasaciones_local_estado_idx on tasaciones (local_id, estado);
create index if not exists tasaciones_lead_idx on tasaciones (lead_id);
create index if not exists tasaciones_tasador_idx on tasaciones (tasador_id, estado);
create index if not exists tasaciones_patente_idx on tasaciones (patente);

alter table tasaciones enable row level security;
