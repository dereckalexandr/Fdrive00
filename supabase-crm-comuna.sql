-- Comuna del cliente (compras y consignaciones): se elige de la lista de las 346 comunas de Chile, junto a la dirección.
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo.
alter table clientes add column if not exists comuna text;
