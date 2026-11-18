-- Drive Futuro CRM · WhatsApp Business (Cloud API de Meta): conversaciones con los clientes desde el CRM.
-- Un número de la empresa; cada conversación sigue al lead del cliente y la ve su ejecutivo (el Jefe Local ve las del local).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
-- RLS activado y SIN políticas: solo la Edge Function accede.

create table if not exists wa_conversaciones (
  id uuid primary key default gen_random_uuid(),
  telefono text not null unique,                 -- número del cliente en formato internacional, solo dígitos (56912345678)
  nombre_perfil text,                            -- nombre que el cliente tiene en su WhatsApp
  cliente_id uuid references clientes(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,       -- lead vigente del cliente: su ejecutivo atiende la conversación
  local_id uuid references locales(id) on delete set null,
  no_leidos integer not null default 0,
  ultimo_mensaje_en timestamptz,
  ultimo_entrante_en timestamptz,                -- abre la ventana de 24 h para responder sin plantilla
  ultimo_texto text,
  ultima_direccion text,                         -- entrante | saliente
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists wa_conv_lead_idx on wa_conversaciones (lead_id);
create index if not exists wa_conv_cliente_idx on wa_conversaciones (cliente_id);
create index if not exists wa_conv_local_idx on wa_conversaciones (local_id, ultimo_mensaje_en desc);

create table if not exists wa_mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references wa_conversaciones(id) on delete cascade,
  wamid text unique,                             -- id del mensaje en WhatsApp (evita duplicados si Meta reenvía el aviso)
  direccion text not null,                       -- entrante | saliente
  tipo text not null,                            -- text | image | document | audio | video | sticker | location | template | otro
  texto text,
  media jsonb,                                   -- { id, mime, nombre, tam, guardado } ; el contenido va en kv_store (wamedia::<conversación>::<mensaje>)
  plantilla text,                                -- nombre de la plantilla (mensajes salientes con plantilla)
  estado text not null default 'recibido',       -- recibido | enviado | entregado | leido | fallido
  error text,
  lead_id uuid references leads(id) on delete set null,
  usuario_id text,                               -- quién lo envió desde el CRM
  usuario_nombre text,
  wa_ts timestamptz,                             -- hora del mensaje según WhatsApp
  creado_en timestamptz not null default now()
);
create index if not exists wa_msg_conv_idx on wa_mensajes (conversacion_id, creado_en);

alter table wa_conversaciones enable row level security;
alter table wa_mensajes enable row level security;
