-- Compra de vehículos: documentos obligatorios (con vencimiento y precio del permiso) y datos críticos del vendedor.
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo.
alter table validacion_docs add column if not exists vence_en date;      -- permiso de circulación, revisión técnica y SOAP
alter table validacion_docs add column if not exists precio bigint;      -- permiso de circulación: precio pagado
alter table clientes add column if not exists direccion text;
alter table clientes add column if not exists cuenta_corriente text;
