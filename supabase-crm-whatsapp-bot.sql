-- Drive Futuro CRM · Asistente de WhatsApp fuera de horario: estado de la conversación con el asistente.
-- Requiere supabase-crm-whatsapp.sql. Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
-- bot_estado = { paso, datos, intentos } (necesidad → nombre → detalle → contacto → listo); bot_actualizado = última vez que el asistente respondió.
alter table wa_conversaciones add column if not exists bot_estado jsonb;
alter table wa_conversaciones add column if not exists bot_actualizado timestamptz;
