-- Cuenta bancaria del vendedor (compra) y del dueño (consignación): banco, tipo de cuenta y número, en lugar de un solo texto.
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo.
alter table clientes add column if not exists banco text;
alter table clientes add column if not exists tipo_cuenta text;
alter table clientes add column if not exists numero_cuenta text;
-- Lo que ya se había escrito en «cuenta corriente» se conserva como número (si traía solo dígitos); el banco y el tipo hay que elegirlos.
update clientes set numero_cuenta = regexp_replace(cuenta_corriente, '[^0-9]', '', 'g')
  where numero_cuenta is null and cuenta_corriente is not null and regexp_replace(cuenta_corriente, '[^0-9]', '', 'g') ~ '^[0-9]{4,20}$';
