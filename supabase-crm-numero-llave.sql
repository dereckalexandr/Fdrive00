-- Número de llave de los vehículos comprados.
-- Cada vehículo comprado recibe, al entrar al inventario, el correlativo más bajo libre de su local.
-- Al venderse o archivarse el número se libera y lo toma el próximo vehículo comprado.
alter table vehiculos add column if not exists numero_llave integer;

-- Un número de llave no se repite dentro de un local.
create unique index if not exists vehiculos_llave_local on vehiculos (local_id, numero_llave) where numero_llave is not null;

-- Vehículos comprados que ya están en el inventario (activos y sin vender): se numeran por orden de ingreso.
with pendientes as (
  select v.id, v.local_id, row_number() over (partition by v.local_id order by v.creado_en, v.id) as n
  from vehiculos v
  where v.activo and v.estado <> 'vendido' and v.numero_llave is null and v.local_id is not null
    and exists (select 1 from compras c where c.vehiculo_id = v.id and c.estado = 'comprada')
)
update vehiculos v
set numero_llave = p.n + coalesce((select max(x.numero_llave) from vehiculos x where x.local_id = p.local_id), 0)
from pendientes p
where v.id = p.id;
