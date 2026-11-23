-- Drive Futuro CRM · Marketing: vínculo de las campañas con Meta Ads y Google Ads (el CRM lee el gasto y los resultados).
-- Requiere supabase-crm-marketing.sql. Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra datos).

alter table campanias add column if not exists plataforma text;                          -- meta | google (vacío = campaña manual)
alter table campanias add column if not exists externo_id text;                          -- id de la campaña en la plataforma
alter table campanias add column if not exists externo jsonb not null default '{}'::jsonb;   -- nombre, estado, leads y mensajes que informa la plataforma
alter table campanias add column if not exists sync_en timestamptz;                      -- última lectura exitosa
alter table campanias add column if not exists sync_error text;                          -- último error de la lectura (vacío = sin error)
-- Una campaña de la plataforma solo puede estar vinculada a una campaña del CRM.
create unique index if not exists campanias_externo_uidx on campanias (plataforma, externo_id) where externo_id is not null;

-- ===== Parte 2 (opcional, aparte): lectura automática cada 3 horas. Pega TU secreto en lugar de PEGA_AQUI_EL_SECRETO (el mismo valor de CRON_SECRET). =====
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('ads-metricas', '0 */3 * * *', $$
--   select net.http_post(
--     url := 'https://lvcmstvcbbvltompunbr.supabase.co/functions/v1/api',
--     headers := '{"content-type":"application/json"}'::jsonb,
--     body := '{"action":"cronAds","secreto":"PEGA_AQUI_EL_SECRETO"}'::jsonb
--   );
-- $$);
