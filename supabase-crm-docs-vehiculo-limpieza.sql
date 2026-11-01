-- Documentos del vehículo (inventario), fichas que ya existen:
--   1) el informe legal de Autofact se copia desde la compra o la consignación del mismo vehículo (si allí ya estaba aprobado);
--   2) se quita el CAV (padrón) de las fichas donde nunca se cargó nada. Si tiene archivos, se deja tal cual.
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo. No borra archivos.

-- 1) Informe legal: desde la compra del vehículo...
update validacion_docs d
set estado = 'aprobado', comentario = o.comentario, revisado_por = o.revisado_por, revisado_en = o.revisado_en,
    archivos = (select coalesce(jsonb_agg(a || jsonb_build_object('v', coalesce(a->>'v', o.validacion_id::text))), '[]'::jsonb) from jsonb_array_elements(o.archivos) a),
    actualizado_en = now()
from validaciones v
join compras c on c.vehiculo_id = v.vehiculo_id
join validaciones vo on vo.compra_id = c.id
join validacion_docs o on o.validacion_id = vo.id and o.clave = 'informe_legal'
where d.validacion_id = v.id and v.tipo = 'vehiculo' and d.clave = 'informe_legal'
  and d.estado = 'pendiente' and jsonb_array_length(d.archivos) = 0
  and o.estado = 'aprobado' and jsonb_array_length(o.archivos) > 0;

-- ...y desde la consignación (para los que aún quedan pendientes).
update validacion_docs d
set estado = 'aprobado', comentario = o.comentario, revisado_por = o.revisado_por, revisado_en = o.revisado_en,
    archivos = (select coalesce(jsonb_agg(a || jsonb_build_object('v', coalesce(a->>'v', o.validacion_id::text))), '[]'::jsonb) from jsonb_array_elements(o.archivos) a),
    actualizado_en = now()
from validaciones v
join consignaciones c on c.vehiculo_id = v.vehiculo_id
join validaciones vo on vo.consignacion_id = c.id
join validacion_docs o on o.validacion_id = vo.id and o.clave = 'informe_legal'
where d.validacion_id = v.id and v.tipo = 'vehiculo' and d.clave = 'informe_legal'
  and d.estado = 'pendiente' and jsonb_array_length(d.archivos) = 0
  and o.estado = 'aprobado' and jsonb_array_length(o.archivos) > 0;

-- 2) CAV (padrón) sin ningún archivo: se quita de la ficha del vehículo.
delete from validacion_docs d
using validaciones v
where d.validacion_id = v.id and v.tipo = 'vehiculo' and d.clave = 'padron' and jsonb_array_length(d.archivos) = 0;

-- Resumen: cuántas fichas tienen el informe legal aprobado, pendiente, y cuántos CAV con archivos quedaron.
select
  (select count(*) from validacion_docs d join validaciones v on v.id = d.validacion_id where v.tipo = 'vehiculo' and d.clave = 'informe_legal' and d.estado = 'aprobado') as informe_legal_aprobado,
  (select count(*) from validacion_docs d join validaciones v on v.id = d.validacion_id where v.tipo = 'vehiculo' and d.clave = 'informe_legal' and d.estado = 'pendiente') as informe_legal_pendiente,
  (select count(*) from validacion_docs d join validaciones v on v.id = d.validacion_id where v.tipo = 'vehiculo' and d.clave = 'padron') as cav_con_archivos;
