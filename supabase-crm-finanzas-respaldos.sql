-- Drive Futuro CRM · Finanzas: respaldos de los movimientos (facturas, boletas, comprobantes) y gastos fijos que se repiten cada mes.
-- Requiere supabase-crm-finanzas.sql. Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).

alter table fin_movimientos add column if not exists archivos jsonb not null default '[]'::jsonb;  -- [{ id, nombre, tipo, tam, v }]; el contenido va en kv_store (dval::<v>::<id>)
alter table fin_movimientos add column if not exists recurrente boolean not null default false;    -- gasto fijo: se propone repetirlo cada mes
alter table fin_movimientos add column if not exists serie_id uuid;                                -- gastos fijos de la misma serie (el primero de la serie)
create index if not exists fin_mov_serie_idx on fin_movimientos (serie_id);
