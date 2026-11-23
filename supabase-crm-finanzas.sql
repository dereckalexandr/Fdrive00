-- Drive Futuro CRM · Finanzas: gastos, otros ingresos, traspasos y saldos iniciales de las cuentas.
-- Los pagos de ventas, reservas y compras NO se copian aquí: el módulo los lee de sus tablas (cierre_pagos, reservas, compra_pagos).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
-- RLS activado y SIN políticas: solo la Edge Function accede.

create table if not exists fin_movimientos (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                     -- folio visible: FIN-00012
  local_id uuid references locales(id) on delete set null,
  tipo text not null,                            -- ingreso | egreso | traspaso
  categoria text not null,                       -- arriendo, sueldos, reparacion, aporte_capital, traspaso… (ver finanzas-core.js)
  monto bigint not null check (monto > 0),
  fecha date not null,
  descripcion text not null,
  contraparte text,                              -- proveedor, persona o institución
  documento_tipo text,                           -- factura | boleta | honorarios | comprobante | sin_documento
  documento_numero text,
  medio text,                                    -- transferencia | efectivo | tarjeta | cheque | deposito | pac
  cuenta_id text,                                -- id de cuentas_empresa, 'por_depositar' o vacío = caja (efectivo) del local
  cuenta_destino_id text,                        -- solo traspasos
  vehiculo_id uuid references vehiculos(id) on delete set null,   -- gasto de un vehículo: se suma a su costo
  notas text,
  estado text not null default 'vigente',        -- vigente | anulado
  registrado_por text,
  editado_por text,
  anulado_por text,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists fin_mov_local_fecha_idx on fin_movimientos (local_id, fecha desc);
create index if not exists fin_mov_vehiculo_idx on fin_movimientos (vehiculo_id);

-- Saldo con el que parte cada cuenta (banco, caja del local o «por depositar») desde una fecha.
create table if not exists fin_saldos (
  clave text primary key,                        -- id de la cuenta bancaria, 'caja:<local>' o 'por_depositar'
  local_id uuid references locales(id) on delete set null,
  saldo_inicial bigint not null default 0,
  desde date not null,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);

alter table fin_movimientos enable row level security;
alter table fin_saldos enable row level security;
