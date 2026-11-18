-- Drive Futuro CRM · Pagos de una compra (la empresa le paga al dueño del vehículo): uno por uno, con su fecha, medio,
-- la cuenta de la empresa DESDE la que se pagó y su respaldo.
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-cierre-pagos.sql, que crea cuentas_empresa).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

create table if not exists compra_pagos (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,
  compra_id uuid not null references compras(id) on delete cascade,
  local_id uuid references locales(id) on delete set null,
  medio text not null,                           -- transferencia | deposito | vale_vista | cheque | efectivo
  monto bigint not null check (monto > 0),
  fecha_pago date not null,
  cuenta_id uuid references cuentas_empresa(id) on delete set null,   -- cuenta de la empresa desde la que se pagó
  cuenta_detalle jsonb,                          -- copia de banco/tipo/número de la cuenta al pagar
  referencia text,                               -- N° de operación, de depósito, de vale vista o de cheque
  archivos jsonb not null default '[]'::jsonb,   -- respaldo: [{ id, nombre, tipo, tam, v }]; el contenido va en kv_store (dval::<compra>::<archivo>)
  notas text,
  estado text not null default 'vigente',        -- vigente | anulado
  registrado_por text,
  anulado_por text,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists compra_pagos_compra_idx on compra_pagos (compra_id, estado);

alter table compra_pagos enable row level security;
