-- Drive Futuro CRM · Entrega 2C: cierre de venta, comisiones por tramos y metas.
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-cotizaciones.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

-- Tramos de comisión propios de cada persona (vacío = usa los tramos estándar de la plataforma).
alter table usuarios add column if not exists comision jsonb not null default '{}'::jsonb;

create table if not exists cierres (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: VTA-000045
  local_id uuid references locales(id) on delete set null,
  lead_id uuid not null references leads(id) on delete cascade,
  cotizacion_id uuid references cotizaciones(id) on delete set null,
  reserva_id uuid references reservas(id) on delete set null,
  vehiculo_id uuid not null references vehiculos(id) on delete restrict,
  cliente_id uuid references clientes(id) on delete set null,
  ejecutivo_id uuid references usuarios(id) on delete set null,   -- quien vendió (dueño del lead al cerrar)
  vehiculo_snapshot jsonb not null default '{}'::jsonb,
  precio_lista bigint,
  precio_cotizado bigint,                       -- precio final de la cotización aprobada
  precio_final bigint not null,                 -- precio real de venta
  costo bigint,                                 -- costo del vehículo al cerrar (para el margen)
  margen bigint,                                -- precio_final − costo
  reserva_monto bigint not null default 0,
  monto_parte_pago bigint not null default 0,
  monto_financiado bigint not null default 0,
  financiera text,
  comision_financiera bigint not null default 0, -- lo que paga la financiera: base de la comisión por créditos
  seguro boolean not null default false,         -- se vendió un seguro: cuenta para la comisión por seguros
  fecha_entrega date not null,
  estado text not null default 'pendiente',     -- pendiente | aprobada | rechazada | anulada
  mes text,                                     -- AAAA-MM (hora de Chile) en que se aprobó: define el mes de la comisión
  solicitado_por text,
  aprobado_por text,
  aprobado_en timestamptz,
  motivo_rechazo text,
  anulado_por text,
  anulado_en timestamptz,
  motivo_anulacion text,
  notas text,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
-- Un vehículo solo puede tener UN cierre en curso o aprobado: no se puede vender dos veces.
create unique index if not exists cierres_vehiculo_vigente on cierres (vehiculo_id) where estado in ('pendiente', 'aprobada');
create index if not exists cierres_mes_idx on cierres (local_id, mes, estado);
create index if not exists cierres_lead_idx on cierres (lead_id);
create index if not exists cierres_ejecutivo_idx on cierres (ejecutivo_id, mes);

alter table cierres enable row level security;
