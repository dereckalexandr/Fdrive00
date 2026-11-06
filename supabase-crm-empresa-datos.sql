-- Datos de la empresa vendedora que se imprimen en el contrato de compraventa.
-- Edita los valores entre comillas simples y ejecútalo en Supabase > SQL Editor > Run. Se puede volver a ejecutar para actualizarlos.
-- personeria: texto que sigue a "consta de" (ej. "la escritura ante el Registro Electrónico de Empresas y Sociedades de fecha 25-05-2022").
insert into kv_store (key, value, shared)
values ('empresa::datos', json_build_object(
  'razon_social', 'COMPLETAR RAZÓN SOCIAL',
  'rut', 'COMPLETAR RUT',
  'domicilio', 'COMPLETAR DIRECCIÓN',
  'comuna', 'COMPLETAR COMUNA',
  'region', 'Metropolitana',
  'ciudad', 'Santiago',
  'representante', 'COMPLETAR NOMBRE DEL REPRESENTANTE LEGAL',
  'rut_representante', 'COMPLETAR RUT DEL REPRESENTANTE',
  'personeria', 'COMPLETAR PERSONERÍA'
)::text, false)
on conflict (key) do update set value = excluded.value, updated_at = now();
