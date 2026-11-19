-- Drive Futuro CRM · Visitas en el Google Calendar de la empresa: cada visita guarda el id de su evento en Google,
-- para reprogramarla o cancelarla (Google avisa al cliente y actualiza su calendario).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo.
alter table tareas add column if not exists google_event_id text;
