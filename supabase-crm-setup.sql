-- Drive Futuro CRM · Etapa 1: base relacional (locales, usuarios, permisos, bitácora, configuración).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
-- Igual que kv_store: RLS activado y SIN políticas, así el navegador no puede tocar nada.
-- Solo la Edge Function "api" (service_role) lee y escribe estas tablas.

create extension if not exists pgcrypto;

-- Locales (sucursales). Hoy hay uno; el diseño ya admite varios.
create table if not exists locales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create unique index if not exists locales_nombre_unico on locales (lower(nombre));

-- Personas que ingresan con RUT y clave.
create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  rut text not null unique,                 -- forma canónica "12345678-5"
  nombre text not null,
  email text,
  telefono text,
  clave_hash text not null,                 -- pbkdf2$...; nunca la clave en claro
  debe_cambiar_clave boolean not null default true,
  roles text[] not null default '{}',
  permisos_extra jsonb not null default '{"otorgar":[],"quitar":[]}'::jsonb,
  local_id uuid references locales(id) on delete set null,
  activo boolean not null default true,
  ultimo_acceso timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists usuarios_local_idx on usuarios (local_id);

-- Permisos de cada rol cuando el administrador los cambia (si no hay fila, rige el valor inicial del código).
create table if not exists roles_permisos (
  rol text primary key,
  permisos text[] not null default '{}',
  actualizado_en timestamptz not null default now()
);

-- Bitácora: quién hizo qué y cuándo. Solo se agrega, nunca se edita desde la aplicación.
create table if not exists bitacora (
  id bigserial primary key,
  creado_en timestamptz not null default now(),
  actor_tipo text not null,                 -- 'admin' | 'usuario' | 'sistema'
  actor_id text,
  actor_nombre text,
  accion text not null,                     -- ej. 'usuario.crear'
  entidad text,                             -- ej. 'usuario'
  entidad_id text,
  detalle jsonb not null default '{}'::jsonb
);
create index if not exists bitacora_fecha_idx on bitacora (creado_en desc);
create index if not exists bitacora_accion_idx on bitacora (accion);

-- Configuración del negocio (catálogos, comisiones, metas).
create table if not exists config_negocio (
  clave text primary key,
  valor jsonb not null,
  actualizado_en timestamptz not null default now()
);

alter table locales enable row level security;
alter table usuarios enable row level security;
alter table roles_permisos enable row level security;
alter table bitacora enable row level security;
alter table config_negocio enable row level security;

-- Local inicial (solo si todavía no hay ninguno).
insert into locales (nombre)
select 'Casa matriz'
where not exists (select 1 from locales);
