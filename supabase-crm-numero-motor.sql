-- Número de motor del vehículo (lo entrega la consulta de patente). Ejecutar una vez en el SQL Editor de Supabase.
alter table vehiculos add column if not exists numero_motor text;
