-- Alertas de plazos de leads por correo: registro de lo ya avisado (cada alerta sale una sola vez por lead) y tarea programada cada 30 minutos.
-- Ejecutar en Supabase -> SQL Editor. Se puede repetir sin riesgo. La parte 2 (tarea programada) se ejecuta aparte, con tu secreto.

-- ===== Parte 1: registro de alertas enviadas =====
create table if not exists alertas_leads (
  lead_id uuid not null references leads(id) on delete cascade,
  tipo text not null,
  enviada_en timestamptz not null default now(),
  primary key (lead_id, tipo)
);
alter table alertas_leads enable row level security;

-- ===== Parte 2: tarea programada (pega TU secreto en lugar de PEGA_AQUI_EL_SECRETO; es el mismo valor que guardes como CRON_SECRET) =====
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('alertas-leads', '*/30 * * * *', $$
--   select net.http_post(
--     url := 'https://lvcmstvcbbvltompunbr.supabase.co/functions/v1/api',
--     headers := '{"content-type":"application/json"}'::jsonb,
--     body := '{"action":"cronAlertas","secreto":"PEGA_AQUI_EL_SECRETO"}'::jsonb
--   );
-- $$);
