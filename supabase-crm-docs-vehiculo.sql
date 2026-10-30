-- Documentos del vehículo (inventario): el certificado de multas y el informe legal de Autofact pasan a las fichas que ya existen.
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo. No borra nada: el CAV (padrón) queda con sus archivos.

-- 1) «Certificado de multas, prendas y limitaciones» pasa a llamarse «Certificado de multas» (misma clave que en compras y consignaciones).
update validacion_docs d
set clave = 'multas', nombre = 'Certificado de multas'
from validaciones v
where d.validacion_id = v.id and v.tipo = 'vehiculo' and d.clave = 'multas_prendas'
  and not exists (select 1 from validacion_docs x where x.validacion_id = d.validacion_id and x.clave = 'multas');

-- 2) Se agrega el informe legal de Autofact (pendiente de cargar) a cada ficha de documentos de vehículo que no lo tenga.
insert into validacion_docs (validacion_id, clave, nombre, grupo, requerido, orden)
select v.id, 'informe_legal', 'Informe legal de Autofact', 'vehiculo', true, 1
from validaciones v
where v.tipo = 'vehiculo'
  and not exists (select 1 from validacion_docs x where x.validacion_id = v.id and x.clave = 'informe_legal');
