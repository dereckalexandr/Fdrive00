-- Tasador: precios de compra, consignación y retoma, y a qué aplica el vehículo (compra o consignación).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo.
alter table tasaciones add column if not exists valor_consignacion bigint;   -- precio de publicación sugerido si se consigna
alter table tasaciones add column if not exists valor_retoma bigint;         -- lo que se reconoce si el cliente lo entrega en parte de pago
alter table tasaciones add column if not exists aplica_para text;            -- compra | consignacion | ninguna (lo decide el Tasador)
