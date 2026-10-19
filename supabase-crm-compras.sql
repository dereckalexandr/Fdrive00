-- Drive Futuro CRM · Entrega 10: compras y consignaciones.
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-marketing.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

-- El vehículo que ofrece el cliente en un lead de compra o consignación.
alter table leads add column if not exists vehiculo_ofrecido jsonb not null default '{}'::jsonb;

-- Un vehículo consignado conserva el precio piso del dueño y de dónde vino.
alter table vehiculos add column if not exists precio_piso bigint;
alter table vehiculos add column if not exists origen text;           -- compra | consignacion (vacío = inventario normal)

-- Compras: la automotora le compra un vehículo a un cliente.
create table if not exists compras (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: CMP-00012
  local_id uuid references locales(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  cliente_id uuid references clientes(id) on delete set null,
  ejecutivo_id uuid references usuarios(id) on delete set null,
  tasacion_id uuid references tasaciones(id) on delete set null,
  vehiculo jsonb not null default '{}'::jsonb,
  patente text,
  valor_tasado bigint,                          -- lo tasado (tope de la oferta)
  monto_oferta bigint not null,
  estado text not null default 'oferta',        -- oferta | aceptada | pago_pendiente | comprada | rechazada | anulada | cancelada
  notas text,
  motivo text,                                  -- motivo del rechazo del cliente, de una cancelación o de una anulación
  respondida_en timestamptz,
  monto_final bigint,                           -- lo que realmente se paga
  medio_pago text,
  fecha_pago date,
  notas_pago text,
  motivo_rechazo_pago text,
  solicitado_por text,
  aprobado_por text,
  aprobado_en timestamptz,
  mes text,                                     -- AAAA-MM de la aprobación (para la comisión)
  vehiculo_id uuid references vehiculos(id) on delete set null,   -- el vehículo que entró al inventario
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists compras_local_estado_idx on compras (local_id, estado);
create index if not exists compras_lead_idx on compras (lead_id);
create index if not exists compras_ejecutivo_idx on compras (ejecutivo_id, mes);
create unique index if not exists compras_lead_abierta_uidx on compras (lead_id) where estado in ('oferta', 'aceptada', 'pago_pendiente');

-- Consignaciones: el dueño deja su vehículo para que la automotora lo venda.
create table if not exists consignaciones (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: CNS-00012
  local_id uuid references locales(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  cliente_id uuid references clientes(id) on delete set null,
  ejecutivo_id uuid references usuarios(id) on delete set null,
  vehiculo jsonb not null default '{}'::jsonb,
  patente text,
  precio_piso bigint not null,                  -- lo mínimo que el dueño quiere recibir
  precio_publicacion bigint not null,           -- el precio al que se ofrece
  plazo_dias integer not null default 90,
  vence_en date,
  estado text not null default 'en_validacion', -- en_validacion | vigente | vendida | devuelta | cancelada
  notas text,
  motivo text,
  vehiculo_id uuid references vehiculos(id) on delete set null,
  activada_en timestamptz,
  cierre_id uuid references cierres(id) on delete set null,
  precio_venta bigint,
  margen bigint,
  mes text,                                     -- AAAA-MM de la venta (para la comisión)
  vendida_en timestamptz,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists consignaciones_local_estado_idx on consignaciones (local_id, estado);
create index if not exists consignaciones_lead_idx on consignaciones (lead_id);
create index if not exists consignaciones_vehiculo_idx on consignaciones (vehiculo_id);
create index if not exists consignaciones_ejecutivo_idx on consignaciones (ejecutivo_id, mes);
create unique index if not exists consignaciones_lead_abierta_uidx on consignaciones (lead_id) where estado in ('en_validacion', 'vigente');

-- Las validaciones de documentos también se ligan a una compra o consignación.
alter table validaciones add column if not exists compra_id uuid references compras(id) on delete set null;
alter table validaciones add column if not exists consignacion_id uuid references consignaciones(id) on delete set null;
create index if not exists validaciones_compra_idx on validaciones (compra_id);
create index if not exists validaciones_consignacion_idx on validaciones (consignacion_id);

alter table compras enable row level security;
alter table consignaciones enable row level security;
