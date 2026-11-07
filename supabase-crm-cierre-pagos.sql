-- Drive Futuro CRM · Pagos de la venta (uno por uno, con su fecha, medio, cuenta de la empresa y respaldo) y cuentas bancarias de la empresa.
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-cierres.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

-- Cuentas bancarias de la empresa donde se reciben transferencias, depósitos y vales vista.
-- local_id vacío = sirve para todos los locales.
create table if not exists cuentas_empresa (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  banco text not null,
  tipo_cuenta text,                              -- Cuenta corriente, Cuenta vista, etc.
  numero_cuenta text not null,
  titular text,
  rut_titular text,
  alias text,                                    -- nombre corto para elegirla ("BCI principal")
  activa boolean not null default true,          -- false = ya no se ofrece, pero los pagos antiguos la conservan
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists cuentas_empresa_local_idx on cuentas_empresa (local_id, activa);

-- Cada pago de una venta. El respaldo (comprobante, foto del vale vista, recibo) queda en `archivos`; el contenido va en kv_store (dval::<cierre>::<archivo>).
create table if not exists cierre_pagos (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,
  cierre_id uuid not null references cierres(id) on delete cascade,
  local_id uuid references locales(id) on delete set null,
  medio text not null,                           -- efectivo | transferencia | deposito | vale_vista | cheque | tarjeta | credito | parte_pago
  monto bigint not null check (monto > 0),
  fecha_pago date not null,
  cuenta_id uuid references cuentas_empresa(id) on delete set null,   -- obligatoria en transferencia, depósito y vale vista
  cuenta_detalle jsonb,                          -- copia de banco/tipo/número de la cuenta al pagar (por si luego se edita)
  referencia text,                               -- N° de operación, de vale vista o de cheque
  archivos jsonb not null default '[]'::jsonb,   -- [{ id, nombre, tipo, tam }]
  notas text,
  estado text not null default 'vigente',        -- vigente | anulado
  registrado_por text,
  anulado_por text,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists cierre_pagos_cierre_idx on cierre_pagos (cierre_id, estado);

alter table cuentas_empresa enable row level security;
alter table cierre_pagos enable row level security;
