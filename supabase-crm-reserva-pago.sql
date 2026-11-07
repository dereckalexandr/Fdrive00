-- Drive Futuro CRM · Pago de la reserva: medio, fecha, cuenta de la empresa, referencia, respaldo y su validación.
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-cierre-pagos.sql).
-- Es seguro volver a ejecutarlo (no borra datos). Las reservas antiguas quedan con pago_estado vacío: no se les exige validación.

alter table reservas add column if not exists fecha_pago date;
alter table reservas add column if not exists cuenta_id uuid references cuentas_empresa(id) on delete set null;
alter table reservas add column if not exists cuenta_detalle jsonb;                     -- copia de banco/tipo/número de la cuenta al pagar
alter table reservas add column if not exists referencia text;                          -- N° de operación, de depósito, de vale vista o de cheque
alter table reservas add column if not exists archivos jsonb not null default '[]'::jsonb;   -- respaldo: [{ id, nombre, tipo, tam, v }]
alter table reservas add column if not exists pago_estado text;                         -- vacío (reserva antigua) | pendiente | validado | rechazado
alter table reservas add column if not exists pago_validado_por text;
alter table reservas add column if not exists pago_validado_en timestamptz;
alter table reservas add column if not exists pago_motivo_rechazo text;
