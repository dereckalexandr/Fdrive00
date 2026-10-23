-- Tablero de leads por tipo: guarda desde cuándo está cada lead en su etapa actual (para mostrar «días en la etapa» y, más adelante, alertar plazos).
-- Ejecutar en Supabase -> SQL Editor. Se puede repetir sin riesgo.

alter table leads add column if not exists etapa_desde timestamptz;

-- Los leads que ya existen parten desde su última actualización (es lo más cercano que se sabe).
update leads set etapa_desde = coalesce(actualizado_en, creado_en) where etapa_desde is null;
alter table leads alter column etapa_desde set default now();

-- Cada vez que cambia la etapa (a mano o automáticamente), se renueva la marca.
create or replace function leads_marca_cambio_de_etapa() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.etapa_desde := coalesce(new.etapa_desde, now());
  elsif new.etapa is distinct from old.etapa then
    new.etapa_desde := now();
  end if;
  return new;
end;
$$;

drop trigger if exists leads_etapa_desde on leads;
create trigger leads_etapa_desde before insert or update on leads
  for each row execute function leads_marca_cambio_de_etapa();
