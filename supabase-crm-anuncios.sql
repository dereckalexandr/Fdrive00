-- Drive Futuro CRM · Entrega 7: perfil del Anunciante (avisos de los vehículos en portales, redes y sitio web).
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-validaciones.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

-- Un aviso por vehículo (texto base). Cuando se da de baja, el vehículo puede tener uno nuevo.
create table if not exists anuncios (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: AVI-000012
  local_id uuid references locales(id) on delete set null,
  vehiculo_id uuid not null references vehiculos(id) on delete cascade,
  titulo text not null,
  descripcion text not null,
  estado text not null default 'por_publicar',  -- por_publicar | publicado | pausado | baja
  anunciante_id uuid references usuarios(id) on delete set null,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  baja_en timestamptz
);
create index if not exists anuncios_local_estado_idx on anuncios (local_id, estado);
create index if not exists anuncios_vehiculo_idx on anuncios (vehiculo_id);
-- Un solo aviso activo (no dado de baja) por vehículo.
create unique index if not exists anuncios_vehiculo_activo_uidx on anuncios (vehiculo_id) where estado <> 'baja';

-- Dónde está publicado cada aviso.
create table if not exists anuncio_portales (
  id uuid primary key default gen_random_uuid(),
  anuncio_id uuid not null references anuncios(id) on delete cascade,
  portal text not null,                         -- chileautos | yapo | facebook | sitio_web | instagram | tiktok | otro
  estado text not null default 'pendiente',     -- pendiente | publicado | pausado | baja
  url text,
  precio_publicado bigint,                      -- precio que dice el aviso (para detectar que quedó desactualizado)
  publicado_en timestamptz,
  vence_en date,
  actualizado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (anuncio_id, portal)
);
create index if not exists anuncio_portales_anuncio_idx on anuncio_portales (anuncio_id);

alter table anuncios enable row level security;
alter table anuncio_portales enable row level security;
