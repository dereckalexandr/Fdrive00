-- Drive Futuro: tabla kv_store con acceso SOLO desde la Edge Function "api".
-- La Edge Function usa la service_role (que ignora RLS); el navegador no
-- tiene ninguna política, así que no puede leer ni escribir la tabla.
create table if not exists kv_store (
  key text primary key,
  value text,
  shared boolean default false,
  updated_at timestamptz default now()
);

alter table kv_store enable row level security;

-- Si antes creaste la política abierta del README antiguo, elimínala:
drop policy if exists "Allow all access" on kv_store;
