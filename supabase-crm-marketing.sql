-- Drive Futuro CRM · Entrega 8: perfil de Marketing y RRSS (calendario de contenido, campañas con presupuesto y material por vehículo).
-- Se pega UNA vez en Supabase > SQL Editor > Run (después de supabase-crm-anuncios.sql).
-- Es seguro volver a ejecutarlo (no borra datos). RLS activado y SIN políticas: solo la Edge Function accede.

-- Campañas: presupuesto aprobado por el Jefe Local y resultados anotados a mano.
create table if not exists campanias (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: CAM-0012
  local_id uuid references locales(id) on delete set null,
  nombre text not null,
  canal text not null,                          -- instagram | facebook | tiktok | youtube | google | chileautos | yapo | whatsapp | otro
  objetivo text,
  desde date not null,
  hasta date not null,
  presupuesto bigint not null default 0,
  presupuesto_aprobado bigint not null default 0,   -- lo que el Jefe Local aprobó (0 = campaña sin costo)
  estado text not null default 'borrador',      -- borrador | pendiente | aprobada | rechazada | finalizada | cancelada
  gasto bigint not null default 0,              -- gasto real, anotado a mano
  alcance bigint not null default 0,
  impresiones bigint not null default 0,
  clics bigint not null default 0,
  motivo_rechazo text,
  aprobado_por text,
  aprobado_en timestamptz,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists campanias_local_estado_idx on campanias (local_id, estado);

-- Cada lead puede venir de una campaña (opcional).
alter table leads add column if not exists campania_id uuid references campanias(id) on delete set null;
create index if not exists leads_campania_idx on leads (campania_id);

-- Calendario de contenido en redes sociales.
create table if not exists publicaciones_rrss (
  id uuid primary key default gen_random_uuid(),
  numero bigserial not null,                    -- folio visible: POST-00012
  local_id uuid references locales(id) on delete set null,
  titulo text not null,
  red text not null,
  tipo text not null default 'post',            -- post | reel | historia | video | carrusel
  estado text not null default 'idea',          -- idea | produccion | programada | publicada | cancelada
  fecha_programada timestamptz,
  texto text,
  url text,                                     -- enlace de la publicación ya publicada
  campania_id uuid references campanias(id) on delete set null,
  vehiculo_id uuid references vehiculos(id) on delete set null,
  responsable_id uuid references usuarios(id) on delete set null,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists publicaciones_local_fecha_idx on publicaciones_rrss (local_id, fecha_programada);
create index if not exists publicaciones_vehiculo_idx on publicaciones_rrss (vehiculo_id);

-- Material (fotos, videos, reels) que se pide o se reúne de cada vehículo.
create table if not exists material_vehiculo (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references locales(id) on delete set null,
  vehiculo_id uuid not null references vehiculos(id) on delete cascade,
  tipo text not null,                           -- fotos | video | reel | historia
  estado text not null default 'pendiente',     -- pendiente | en_proceso | listo
  url text,                                     -- carpeta o enlace con el material (por ejemplo, Google Drive)
  notas text,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (vehiculo_id, tipo)
);
create index if not exists material_vehiculo_local_idx on material_vehiculo (local_id, estado);

alter table campanias enable row level security;
alter table publicaciones_rrss enable row level security;
alter table material_vehiculo enable row level security;
