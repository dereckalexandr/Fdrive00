-- Precio con financiamiento del vehículo (inventario): la diferencia con el precio de lista se informa en el sitio web como «bono financiamiento».
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo.
alter table vehiculos add column if not exists precio_financiamiento bigint;
