-- Drive Futuro CRM · WhatsApp: etiquetas en las conversaciones (Caliente, Financiamiento, Parte de pago…), para ordenar y filtrar la bandeja.
-- Requiere supabase-crm-whatsapp.sql. Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).
alter table wa_conversaciones add column if not exists etiquetas jsonb not null default '[]'::jsonb;
