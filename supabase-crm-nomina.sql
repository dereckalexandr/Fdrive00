-- Drive Futuro CRM · Finanzas → Nómina: fichas de los trabajadores, nómina de cada mes y su vínculo con los egresos.
-- Requiere supabase-crm-finanzas.sql. Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
-- RLS activado y SIN políticas: solo la Edge Function accede.

create table if not exists fin_trabajadores (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  usuario_id uuid references usuarios(id) on delete set null,   -- si es parte del equipo del CRM (para proponer sus comisiones)
  nombre text not null,
  rut text,
  cargo text,
  activo boolean not null default true,
  ficha jsonb not null default '{}'::jsonb,       -- sueldo base, contrato, gratificación, colación, movilización, AFP, salud…
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists fin_trabajadores_local_idx on fin_trabajadores (local_id, activo);

create table if not exists fin_nominas (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  mes text not null,                              -- AAAA-MM
  filas jsonb not null default '[]'::jsonb,       -- liquidación de cada trabajador (haberes, descuentos, líquido, aportes del empleador)
  parametros jsonb not null default '{}'::jsonb,  -- UF, UTM, sueldo mínimo, topes y tasas usadas
  totales jsonb not null default '{}'::jsonb,     -- líquido, Previred, impuesto, costo empresa
  actualizado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists fin_nominas_local_mes_uidx on fin_nominas (local_id, mes);

-- Egresos creados al pagar una nómina, y el mes al que corresponde un gasto (para el estado de resultados).
alter table fin_movimientos add column if not exists nomina_id uuid references fin_nominas(id) on delete set null;
alter table fin_movimientos add column if not exists nomina_concepto text;   -- sueldos | previred | impuesto
alter table fin_movimientos add column if not exists mes_resultado text;     -- AAAA-MM; vacío = el mes de la fecha
create index if not exists fin_mov_nomina_idx on fin_movimientos (nomina_id);

alter table fin_trabajadores enable row level security;
alter table fin_nominas enable row level security;
