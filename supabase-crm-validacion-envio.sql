-- Validación de documentos de compras y consignaciones: «Enviar a validar».
-- La validación recién entra a la cola del Validador cuando el ejecutivo la envía con todo completo (enviada_en).
-- Las validaciones que ya existen se consideran enviadas, para que no desaparezcan de la cola.
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo.
alter table validaciones add column if not exists enviada_en timestamptz;
update validaciones set enviada_en = coalesce(solicitada_en, creado_en, now()) where enviada_en is null;
