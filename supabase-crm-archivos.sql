-- Drive Futuro CRM · Fotos y documentos en Supabase Storage (en vez de texto dentro de la base).
-- Se pega UNA vez en Supabase > SQL Editor > Run. Es seguro volver a ejecutarlo (no borra nada).
--
-- Crea el bucket PRIVADO «archivos». Nadie entra directo: solo la función del servidor (service_role) sube, baja y borra,
-- y decide quién puede ver cada archivo igual que antes. Tope por archivo: 12 MB.
insert into storage.buckets (id, name, public, file_size_limit)
values ('archivos', 'archivos', false, 12582912)
on conflict (id) do update set public = false, file_size_limit = 12582912;
