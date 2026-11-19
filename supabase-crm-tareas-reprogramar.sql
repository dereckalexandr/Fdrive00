-- Drive Futuro CRM · Reprogramar o cancelar tareas (y las visitas con invitación de calendario).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
alter table tareas add column if not exists cancelada boolean not null default false;   -- cancelada: sale de la agenda sin contar como cumplida
alter table tareas add column if not exists motivo_cancelacion text;
alter table tareas add column if not exists reprogramada_en timestamptz;
alter table tareas add column if not exists invitacion_enviada boolean not null default false; -- el cliente recibió la invitación de calendario
alter table tareas add column if not exists invitacion_seq integer not null default 0;        -- versión de la invitación (cada cambio la sube)
