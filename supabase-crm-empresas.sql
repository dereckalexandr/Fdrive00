-- Pista · FASE 1 multiempresa: tabla de empresas y «empresa_id» en todas las tablas de datos.
-- Se pega UNA vez en Supabase > SQL Editor > Run (antes haz el respaldo: node scripts/respaldo.mjs). Es seguro volver a ejecutarlo.
--
-- QUÉ HACE (todo aditivo: no borra ni cambia ningún dato ni ninguna regla existente):
--   1. Crea «empresas» (cada automotora cliente: código de ingreso, nombre, plan y estado) y registra la primera: Drive Futuro, plan Enterprise.
--   2. Agrega «empresa_id» a todas las tablas de datos. Todo lo que ya existe (y todo lo que el sistema actual siga creando) queda
--      asignado a Drive Futuro por el valor por defecto, así que el CRM funciona exactamente igual que hoy.
--   3. Crea un índice por «empresa_id» en cada tabla (lo usarán las consultas por empresa de las fases siguientes).
-- LO QUE NO HACE TODAVÍA (va con el cambio del código, Fase 2): cambiar las claves únicas globales (patente, RUT, key…) por claves por
-- empresa, quitar el valor por defecto y activar las políticas de seguridad por empresa.
-- «patentes_consultadas» queda global: es una caché de datos públicos de patentes que sirve a todas las empresas.

create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,                              -- código de ingreso (junto al RUT y la clave); en minúsculas, sin espacios
  nombre text not null,
  plan text not null default 'gratuito' check (plan in ('gratuito', 'pro', 'enterprise')),
  estado text not null default 'activa' check (estado in ('prueba', 'activa', 'suspendida')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint empresas_codigo_formato check (codigo ~ '^[a-z0-9][a-z0-9_-]{1,39}$')
);
create unique index if not exists empresas_codigo_unico on empresas (codigo);
alter table empresas enable row level security;  -- sin políticas: solo la función del servidor (service_role) accede

-- Primera empresa: Drive Futuro (Enterprise). El identificador es fijo para poder usarlo como valor por defecto.
insert into empresas (id, codigo, nombre, plan, estado)
values ('df000000-0000-4000-8000-000000000001', 'drivefuturo', 'Drive Futuro', 'enterprise', 'activa')
on conflict (id) do nothing;

do $$
declare
  t text;
  df constant uuid := 'df000000-0000-4000-8000-000000000001';
  tablas text[] := array[
    'alertas_leads', 'anuncio_portales', 'anuncios', 'avisos', 'bitacora', 'campanias', 'cierre_pagos', 'cierres', 'clientes',
    'compra_pagos', 'compras', 'config_negocio', 'consignaciones', 'cotizaciones', 'cuentas_empresa', 'fin_movimientos',
    'fin_nominas', 'fin_saldos', 'fin_trabajadores', 'inspecciones', 'kv_store', 'lead_eventos', 'leads', 'locales',
    'material_vehiculo', 'prospectos', 'publicaciones_rrss', 'reservas', 'roles_permisos', 'tareas', 'tasaciones', 'usuarios',
    'validacion_docs', 'validaciones', 'vehiculos', 'wa_conversaciones', 'wa_mensajes'
  ];
begin
  foreach t in array tablas loop
    -- Valor por defecto constante: PostgreSQL lo asigna sin reescribir la tabla (instantáneo) y las filas que ya existen quedan en Drive Futuro.
    execute format('alter table %I add column if not exists empresa_id uuid not null default %L references empresas(id)', t, df);
    execute format('create index if not exists %I on %I (empresa_id)', t || '_empresa_idx', t);
  end loop;
end $$;
