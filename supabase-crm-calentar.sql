-- Pista · Mantener la función «caliente» (sin arranques en frío).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (reemplaza la tarea anterior).
--
-- Cada minuto la base le pide a la función el chequeo de salud público (?health=1), en la región donde están los usuarios (São Paulo).
-- Así la primera petición de una persona no paga los ~600 ms de arrancar la función desde cero. No toca datos ni usa secretos.
-- Cuando la base pase a São Paulo, este mismo comando sigue sirviendo (la región pedida es la misma).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'calentar-funcion';

select cron.schedule('calentar-funcion', '* * * * *', $$
  select net.http_get(
    url := 'https://lvcmstvcbbvltompunbr.supabase.co/functions/v1/api?health=1',
    headers := '{"x-region": "sa-east-1"}'::jsonb,
    timeout_milliseconds := 5000
  );
$$);
