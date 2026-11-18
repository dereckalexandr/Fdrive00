-- Datos de la empresa vendedora que se imprimen en el contrato de compraventa.
-- Lo normal es editarlos en el CRM: Ventas > «Datos de la empresa» (solo el Administrador). Este SQL carga valores DE EJEMPLO
-- para que el contrato no salga en blanco; reemplázalos por los reales desde esa tarjeta. Se puede volver a ejecutar.
insert into kv_store (key, value, shared)
values ('empresa::datos', json_build_object(
  'razon_social', 'DRIVE FUTURO SPA',
  'rut', '77.123.456-9',
  'domicilio', 'Av. Vitacura 1234, oficina 501',
  'comuna', 'Vitacura',
  'region', 'Metropolitana',
  'ciudad', 'Santiago',
  'representante', 'Juan Pérez Soto',
  'rut_representante', '12.345.678-5',
  'personeria', 'la escritura ante el Registro Electrónico de Empresas y Sociedades de fecha 25-05-2022'
)::text, false)
on conflict (key) do update set value = excluded.value, updated_at = now();
