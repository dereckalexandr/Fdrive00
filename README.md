# Drive Futuro — Plataforma de gestión automotriz

Aplicación React (Vite) para gestionar producción mensual de ejecutivos,
inspecciones y tasaciones de vehículos, y pre liquidaciones, con perfiles
de Administrador, Ejecutivo e Inspector.

## ⚠️ Léeme primero: almacenamiento

Este proyecto nació como un *artifact* de Claude, donde los datos se
guardaban con una API propia de Claude (`window.storage`). Esa API no
existe fuera de Claude, así que aquí fue reemplazada por dos posibles
implementaciones, intercambiables sin tocar `App.jsx`:

- **`src/storage-shim.js`** — usa `localStorage` del navegador. Sirve
  para pruebas rápidas, pero **no comparte datos entre dispositivos**.
- **`src/supabase-storage.js`** — usa **Supabase** (Postgres en la nube),
  una base de datos real. Con esto, el administrador y todos los
  ejecutivos/inspectores SÍ ven la misma información, desde cualquier
  dispositivo. **Esta es la opción recomendada para uso real.**

`src/main.jsx` detecta automáticamente cuál usar: si encuentra las
variables de entorno de Supabase (`VITE_SUPABASE_*`), usa Supabase;
si no las encuentra, cae de vuelta a `localStorage` y te avisa por la
consola del navegador.

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior
- npm (viene incluido con Node.js)

## Instalación y uso local

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar el servidor de desarrollo
npm run dev
```

Esto abrirá la app en `http://localhost:5173` (o el puerto que indique
la terminal). Ábrela en tu navegador y pruébala normalmente: crea
ejecutivos, inspectores, carga producción, genera pre liquidaciones, etc.

## Configurar Supabase (recomendado, paso a paso)

### 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea una cuenta
   (puedes usar tu cuenta de GitHub).
2. "New project" → elige tu organización → ponle un nombre (ej.
   "drive-futuro") → define una contraseña de base de datos (guárdala,
   por si la necesitas después) → elige una región cercana (ej.
   `South America (São Paulo)`) → "Create new project".
3. Espera 1-2 minutos mientras Supabase aprovisiona el proyecto.

### 2. Crear la tabla `kv_store`

1. En el menú lateral: **SQL Editor** → "New query".
2. Pega y ejecuta ("Run") lo siguiente:
   ```sql
   create table kv_store (
     key text primary key,
     value text,
     shared boolean default false,
     updated_at timestamptz default now()
   );
   ```
3. Deberías ver "Success. No rows returned".

### 3. Seguridad: RLS cerrado + Edge Function

La tabla `kv_store` queda con RLS activado y **sin políticas**: el navegador
no puede leerla ni escribirla directamente. Todo el acceso pasa por la Edge
Function `api` (`supabase/functions/api/index.ts`), que valida las sesiones
y aplica permisos por clave:

- **Administrador**: todo (menos `admin_auth`, de uso interno).
- **Ejecutivo**: solo `record::<su id>::*`; `afp_config` y `uf_valor` solo lectura.
- **Inspector**: solo `inspeccion::<su id>::*` y `tasacion::<su id>::*`; `afp_config` y `uf_valor` solo lectura.

Despliegue (una vez, y cada vez que cambies la función):

1. Crea un token en <https://supabase.com/dashboard/account/tokens> y expórtalo
   solo en tu sesión de terminal: `$env:SUPABASE_ACCESS_TOKEN = "sbp_..."`
2. `node scripts/deploy-api.mjs` — carga `ADMIN_EMAIL` y `SESSION_SECRET` (si no
   existía) y despliega la función.
3. `node scripts/set-admin-password.mjs` — define la clave maestra del administrador
   (pide la clave oculta y sube solo su hash PBKDF2 como secreto `ADMIN_PASSWORD_HASH`).
   **La clave maestra nunca debe escribirse en el código ni en el repositorio.**
4. Ejecuta `supabase-setup.sql` en el SQL Editor (crea la tabla y elimina la política abierta).

Límites conocidos: el limitador de intentos de login vive en memoria de cada
instancia de la función (mejor esfuerzo); las sesiones duran 12 h (admin) y 8 h
(ejecutivo/inspector) y se pierden al recargar la página.

### 4. Obtener las credenciales del proyecto

1. En el menú lateral: **Project Settings** (ícono de engranaje) → **API**.
2. Copia el **Project URL** y la clave **anon public** (NO la
   `service_role`, esa es solo para uso en servidor y nunca debe ir en
   el código del navegador).

### 5. Configurar las variables de entorno

**Para desarrollo local:**
1. Copia el archivo `.env.example` y renómbralo a `.env.local`.
2. Pega ahí los valores que copiaste de Supabase:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
   ```
3. Corre `npm run dev` — en la consola del navegador debería aparecer
   "Almacenamiento: Supabase" en vez del aviso de localStorage.

**Para producción en Vercel:**
1. Entra a tu proyecto en Vercel → **Settings → Environment Variables**.
2. Agrega las dos variables de arriba (mismo nombre, mismo valor).
   Selecciónalas para los tres ambientes (Production, Preview,
   Development).
3. Ve a **Deployments** → abre el último deployment → menú "···" →
   **Redeploy** (las variables de entorno solo se aplican en un
   deployment nuevo, no en los ya existentes).

### 6. Probar

1. Local: `npm run dev`, entra como administrador, crea un ejecutivo.
2. En Supabase, ve a **Table Editor → kv_store** — deberías ver una
   fila nueva con `key = "vendors"`.
3. Abre la misma URL desde **otro navegador o dispositivo** — deberías
   ver el mismo ejecutivo. Si es así, ¡la base de datos compartida ya
   está funcionando!

## Compilar para producción

```bash
npm run build
```

Esto genera una carpeta `dist/` con los archivos estáticos listos para
subir a cualquier hosting.

```bash
npm run preview
```

sirve esa carpeta `dist/` localmente para revisar que el build final
funcione antes de publicarlo.

## Autocompletado de datos desde el CAV (PDF)

Al arrastrar/cargar el PDF del CAV en el módulo de Inspección, la app
intenta leer su texto y autocompletar "Datos del vehículo" y "Datos
del propietario" (`src/cav-parser.js`).

**Limitaciones a tener en cuenta:**

- Solo funciona si el PDF tiene **texto real** (no una imagen escaneada).
  Si tus CAV suelen ser escaneados, esta extracción no va a encontrar
  nada — se necesitaría agregar reconocimiento óptico de caracteres
  (OCR), que es un paso adicional no incluido todavía.
- Las etiquetas que busca (`CAV_FIELD_DEFS` en `src/cav-fields.js`) se
  calibraron con un CAV real del Registro Civil, donde cada etiqueta y su
  valor vienen en líneas consecutivas (también se acepta el valor en la
  misma línea). Un CAV de ese formato no trae N° de serie ni VIN
  (solo chasis), así que esos campos quedan vacíos. Si otro documento no
  se detecta bien, pruébalo sin abrir la app con
  `node scripts/probar-cav.mjs "ruta.pdf" --texto` (oculta nombre y RUN
  por defecto; `--mostrar` los incluye) y agrega la variante de etiqueta
  que falte. Las pruebas automáticas están en `tests/` (`npm test`).
- Solo completa campos que estén **vacíos** — si el inspector ya
  escribió algo a mano, no lo sobrescribe.

**Si el build falla con un error relacionado a
`pdf.worker.min.mjs`:** la ruta exacta del archivo del "worker" de
`pdfjs-dist` puede variar levemente entre versiones. Revisa qué archivo
existe realmente en `node_modules/pdfjs-dist/build/` después de
`npm install`, y ajusta esa misma ruta en el import correspondiente
dentro de `src/cav-parser.js`.

## Perfil de inspector

- **Módulos plegables** con avance ("4/7") en inspección y tasación, y barra de guardado fija en el celular.
- **Borrador automático**: lo que el inspector escribe se guarda en el propio dispositivo
  (localStorage, clave `driveFuturo:draft::<id>::<inspeccion|tasacion>`) y se recupera al recargar.
  Se borra al guardar o descartar. Incluye datos del propietario, por eso vive solo en el
  navegador del inspector. Si el PDF del CAV no cabe, se guarda el resto sin el archivo.
- **Editar y eliminar** inspecciones y tasaciones propias (la Edge Function permite al
  inspector eliminar solo bajo sus prefijos `inspeccion::<id>::` y `tasacion::<id>::`).
- **Informe PDF** de cada inspección y tasación (`src/pdf-report.js`, sin librerías externas).
- **Crear tasación desde una inspección**: precarga propietario, vehículo, patente y año.
- **Fotos en la tasación**: botón (+) en cada caja de los módulos 1 a 11 (en el celular abre la cámara;
  en el computador, el selector de archivos). Cada foto se reduce en el dispositivo (JPEG, máx. 1280 px)
  y se guarda como registro aparte `foto::<inspector>::<id>`; la tasación solo guarda los ids.
  Máximo 6 por caja y 60 por tasación. Se ven al crear o editar la tasación y en el "Ver" del panel del administrador (solo lectura); **no** van
  en el PDF ni en el "Ver" del propio inspector. Al descartar un borrador, reemplazar el formulario o eliminar la tasación, sus fotos se borran.
- Si la sesión (8 h) vence, el ejecutivo/inspector reingresa en silencio con su mismo código.

## Tasación de compra (panel del administrador)

Pestaña **Tasación de compra**: estima cuánto pagar por un vehículo con los avisos de Chileautos. No guarda nada.

1. Se ingresan a mano la **patente** y el **kilometraje** (obligatorios). Marca, modelo, año y versión se escriben, se completan subiendo el CAV o con el marcador de patentechile.com (ver abajo).
2. El botón "Abrir la búsqueda en Chileautos" abre la lista ya filtrada (marca, modelo, año ±1, kilometraje **desde 0 km hasta el ingresado + 20 %** (60.000 km → 0 a 72.000 km), orden por precio más bajo y, si se eligen, **transmisión** Mecánica/Automática y **combustible** Bencina/Diesel/Híbrido/Eléctrico).
3. Un **marcador** del navegador (se arrastra una vez a la barra de favoritos) lee la página de Chileautos que el usuario tiene abierta y copia los avisos; se pegan en la app.
4. Resultado: **precio promedio** (los 5 avisos más baratos), **precio sugerido de publicación** (precio promedio + $500.000) y **precio sugerido de compra** (precio promedio − **margen bruto**). El margen bruto se elige antes de calcular en una lista ($1.500.000 a $10.000.000; parte en $2.000.000) y solo mueve el precio de compra. Las constantes están en `src/compra-calc.js` (`N_PRIMEROS`, `INCREMENTO_PUBLICACION`, `MARGENES_BRUTOS`).

Decisiones y límites (verificados en chileautos.cl):
- Chileautos y los sitios de consulta de patentes bloquean las consultas automáticas desde servidores (403 / protección anti-bots), por eso la lectura la hace el navegador del usuario y no un bot. **patentechile.com no se consulta automáticamente** (Cloudflare lo bloquea, y es un buscador de datos de dueños). En su lugar, la persona entra al sitio, busca la patente a mano y un segundo marcador (`src/patente-bookmarklet.js`) lee la ficha abierta y copia **solo patente, marca, modelo y año**: nunca nombre, RUT ni dirección del dueño (hay pruebas que lo verifican). Si no reconoce la ficha, copia solo los *nombres* de los campos de la página, sin valores, para poder ajustarlo. Ese marcador se probó con estructuras simuladas, **no contra el sitio real** (el asistente no puede abrirlo), así que puede necesitar un ajuste. Los dos marcadores comparten `src/bookmarklet-core.js`.
- Se descartan, mostrando el motivo: avisos destacados (patrocinados), sin precio, repetidos, fuera del filtro de año/km, precios simbólicos (111.111, 123.456…) y precios menores a la mitad de la mediana.
- Transmisión y combustible (opcionales): "Mecánica" se pide como `Transmisión.Manual`; "Automática" como `Automática` o `Automático`. **Los acentos importan**: `Híbrido` y `Eléctrico` sin tilde devuelven 0 avisos. Si la tarjeta de un aviso trae otra transmisión o combustible, se descarta con el motivo.
- **A Chileautos se le pide solo la primera palabra del modelo** (lo anterior al primer espacio). Los datos de patentechile o del CAV traen el modelo con motor y versión ("YARIS 1.5 GLI MT"), pero Chileautos solo conoce "Yaris", y el punto es un separador de su sintaxis: con "1.5" en el modelo ignora **todos** los filtros y muestra "Vehículos parecidos a lo que buscas". El campo Modelo de la app conserva el texto completo y la pantalla avisa qué parte se omite.
- **Excepciones** (`EXCEPCIONES_MODELO` en `src/compra-calc.js`; se pueden ampliar): estos modelos se buscan con su nombre de varias palabras en vez de la primera palabra: `Corolla Cross`, `Land Cruiser`, `Santa Fe`, `Grand Vitara`, `Yaris Sport`, `Yaris Cross` y `Tiggo 2` a `Tiggo 8` ("LAND CRUISER PRADO 4.0" → "Land Cruiser"; "TIGGO 7 PRO" → "Tiggo 7"). Se comparan sin distinguir mayúsculas ni tildes, pero se buscan con la escritura de la lista (Chileautos sí distingue tildes: "Santa Fé" → "Santa Fe"). **Conversión de series**: `CX5`, `CX 5` y `CX-5` se buscan como `CX-5` (de `CX-3` a `CX-90`); igual `X 1` → `X1` (X1–X7), `A 3` → `A3` (A1–A7), `Q 5` → `Q5` (Q1–Q8) y `Tiggo7` → `Tiggo 7`. También quedan declarados como modelos válidos de una palabra los números `1` a `9999` y los de 3 letras (`ASX`, `ZS`…), que ya se conservan por la regla general. Lo que no está en la lista se busca solo con su primera palabra.
- **Excepción por forma** (`{ secuencia: [...] }` en `EXCEPCIONES_MODELO`): una palabra de **3 letras** (`aaa` a `zzz`) seguida de un **número de 111 a 999** se busca con las dos palabras: "GLA 200 1.3" → "GLA 200", "CLA 250 AMG" → "CLA 250". Con 3 letras y un número fuera de rango (110, 1000, 99), o con letras de otro largo ("AB 200", "ABCD 200"), se usa solo la primera palabra.
- **Letras y números pegados** ("GLA200"): la primera palabra del modelo se separa con un espacio entre letras y números ("GLA200 1.3" → "GLA 200", "CLA250D AMG" → "CLA 250", "X5M" → "X5") y se vuelve a probar contra las excepciones. **Solo se usa si así calza con una excepción**; si no, el modelo queda como viene, para no romper los de una palabra con número ("NP300", "RAV4", "C3", "i10", "Q50"). Las palabras con guion ("CX-5", "T-Cross") no se separan. El campo Modelo de la app conserva lo pegado; el aviso naranja muestra cómo se busca.
- **Palabras que se omiten** (`OMITIR_EN_MODELO` en `src/compra-calc.js`): `ALL NEW` (también `ALL-NEW`) y `NEW` se quitan del modelo, en cualquier posición, antes de aplicar las demás reglas: "ALL NEW RIO 1.4" → "RIO", "NEW GLA200" → "GLA 200", "ALL NEW COROLLA CROSS" → "Corolla Cross". Solo palabras completas ("NEWMAN" no se toca); si el modelo fuera solo "NEW", se deja. El aviso naranja las lista entre lo omitido.
- **Marcas con otro nombre en Chileautos** (`MARCAS_CHILEAUTOS` en `src/compra-calc.js`): `MERCEDES BENZ`, `Mercedes-Benz` y la grafía con z (`Mercedez Benz`) se buscan como `Mercedes-Benz`, con guion, que es como la escribe Chileautos. El campo Marca de la app conserva lo pegado. Las demás marcas se envían tal cual.
- **Palabras que se suprimen de la marca** (`OMITIR_EN_MARCA` en `src/compra-calc.js`): `Motors` y `Motor` (razón social que trae patentechile): "KIA MOTORS" → "KIA", "Hyundai Motor" → "Hyundai", "Great Wall Motors" → "Great Wall". Solo palabras completas ("Motorcraft" no se toca); si la marca fuera solo "Motors", se deja. Se combina con la regla de Mercedes-Benz. Ojo: "General Motors" quedaría como "General" y "Hyundai Motors Chile" como "Hyundai Chile" (solo se quita lo pedido). El aviso naranja muestra lo omitido.
- Sintaxis de búsqueda comprobada: `?q=(And.(C.Marca.X._.Modelo.Y.)_.Ano.range(A..B)._.Kilometraje.range(K1..K2).)&sort=~Price`. Si Chileautos no reconoce el modelo muestra "Vehículos parecidos a lo que buscas" y la app lo avisa en vez de calcular.
- Si Chileautos cambia su página, hay que actualizar `src/chileautos-bookmarklet.js` (sus pruebas están en `tests/`).
- Es una estimación a partir de precios de publicación, no de ventas concretadas.

## CRM · Etapa 1: usuarios, permisos y panel del Administrador

La plataforma está creciendo hacia un CRM con 8 perfiles (Administrador general, Jefe Local, Ejecutivo, Tasador, Inspector, Validador, Anunciante, Marketing y RRSS). La etapa 1 construye la base y el panel del Administrador; los dashboards de cada perfil se agregan después, uno por uno.

**Instalar (una sola vez):**
1. Supabase → *SQL Editor* → pegar el contenido de `supabase-crm-setup.sql` → *Run*. Crea `locales`, `usuarios`, `roles_permisos`, `bitacora` y `config_negocio` con RLS activado y sin políticas (el navegador no las toca; solo la Edge Function). Es seguro volver a ejecutarlo. Crea un local inicial, "Casa matriz".
2. Redesplegar la función: `node scripts/deploy-api.mjs` (con la sesión de Supabase iniciada). No hay que cambiar secretos.

**Qué incluye (pestañas del panel de administrador, a la derecha de "Datos"):**
- **Usuarios**: alta con RUT (validado con dígito verificador), nombre, correo, teléfono, local, uno o varios roles y una clave provisoria generada (se muestra una sola vez; la persona debe cambiarla al primer ingreso). Editar, reiniciar clave, desactivar/activar. Los usuarios no se eliminan: se desactivan. El Ejecutivo se habilita aparte para **Ventas, Compras y Consignaciones**. Cada persona puede tener permisos extra o quitados uno por uno ("Según rol / Otorgar / Quitar").
- **Permisos**: matriz de permisos por rol, editable y con "Restablecer". El rol Administrador general siempre tiene todo y no se asigna a personas (hoy es la cuenta maestra por correo y clave).
- **Reportes**: usuarios por rol y por local, inspecciones y tasaciones de los últimos 6 meses y por persona. Los reportes comerciales llegarán con los perfiles de Ejecutivo y Jefe Local.
- **Bitácora**: quién hizo qué y cuándo (usuarios, permisos, configuración, locales), con antes/después. Solo se agrega, nunca se edita.
- **Configuración**: locales, fuentes de leads, motivos de pérdida, comisiones y meta mensual.

**Cómo ingresan las personas:** en la pantalla de inicio, tarjeta **Personal** (RUT + clave). Llegan a su **estación de trabajo**, que hoy muestra los módulos existentes según sus permisos (Inspecciones y tasaciones, Tasación de compra) y lista lo que viene en camino. Los perfiles anteriores de Ejecutivo e Inspector por código siguen funcionando igual.

**Seguridad (todo se valida en el servidor, no en la pantalla):**
- Las claves se guardan como hash PBKDF2; nunca en claro. Bloqueo temporal tras 10 intentos fallidos, por IP y por RUT. Las respuestas de ingreso no distinguen "RUT inexistente" de "clave mala".
- Los permisos de una persona se leen de la base **en cada petición** (caché de 15 s): al desactivarla o quitarle un permiso, pierde el acceso en segundos aunque su sesión siga abierta.
- Un usuario con `inspecciones.usar` / `tasaciones.usar` solo toca sus propias inspecciones, tasaciones y fotos. Toda la administración del CRM (acción `crm`) la puede hacer **solo la cuenta maestra** en esta etapa.
- `supabase/functions/api/crm-core.js` es la única fuente de la lista de roles y permisos (lo usan el servidor, la pantalla y las pruebas). Para agregar un permiso: súmalo a `PERMISOS` y a los roles que correspondan en `PERMISOS_POR_ROL`.
- Pruebas: `tests/crm-core.test.mjs` (reglas) y `tests/crm-api.test.mjs`, que ejecuta la función real contra una base falsa en memoria (ingreso, permisos, desactivación, bitácora, bloqueo).

## CRM · Entrega 2A: módulo comercial del Ejecutivo (ventas)

Primera parte del perfil Ejecutivo. Las cotizaciones y reservas están en la entrega 2B y el cierre, las comisiones y las metas en la 2C (más abajo).

**Instalar (una sola vez, después de `supabase-crm-setup.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-ventas.sql` → *Run*. Crea `vehiculos`, `clientes`, `leads`, `lead_eventos` y `tareas` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.

**Qué incluye** (para quien tenga permisos de leads o inventario: tarjeta **Ventas** en su estación de trabajo, y pestaña **Comercial** en el panel del administrador):
- **Inicio**: leads por atender, tareas de hoy y vencidas, leads en seguimiento y meta del mes (el avance real llega con el cierre de venta).
- **Leads** en columnas (Nuevo → Contactado → En seguimiento → Cerrado perdido); se arrastra una tarjeta, o en el celular se usa el selector de etapa. Cada lead guarda cliente, vehículo de interés (del inventario o texto libre), fuente, **vehículo en parte de pago** y **financiamiento** (pie, banco, estado de la evaluación).
- **Ficha del lead**: llamar / WhatsApp / correo con un toque, registrar contactos y notas (el primer contacto pasa el lead de "Nuevo" a "Contactado"), agendar tareas, reasignar (supervisor) e historial completo.
- **Agenda**: tareas vencidas, de hoy y próximas; el supervisor ve las de todo el local.
- **Inventario** cargado a mano: patente, marca, modelo, versión, año, km, color, transmisión, combustible, precio de lista, costo, estado (En preparación / Disponible / Reservado / Vendido), notas y hasta 6 fotos. El **costo y el margen solo los ven quienes editan el inventario**. Los vehículos no se borran: se archivan.
- **Clientes** con contacto, RUT opcional (si ya existe, el lead reutiliza al cliente).

**Reglas (todas se validan en el servidor):**
- El Ejecutivo ve y modifica **solo los leads que le asignaron** y solo si está habilitado para **Ventas** (permiso `ventas.operar`). Si se lo quitan, sigue viendo los suyos pero no los modifica. Un lead nuevo creado por un Ejecutivo queda a su nombre.
- Quien tiene `leads.local` (por ejemplo Marketing) ve los leads del local sin poder modificarlos. Quien tiene `leads.asignar` (Jefe Local) ve y modifica todo el local y reasigna.
- **Asignación mixta**: el supervisor elige a quién o deja el **reparto rotativo** (le toca a quien lleva más tiempo sin recibir un lead; solo entre personas activas y habilitadas para ventas). Si no hay nadie habilitado, el lead queda sin asignar para que el supervisor lo reparta.
- Cada persona trabaja solo con datos de **su local**. La cuenta maestra elige el local.
- Solo se puede mover a las etapas ya disponibles ("Cotizado" y "Reservado" cambian solas al cotizar y reservar; "Cerrado ganado" la pone el cierre de venta, ver 2C). Para perder un lead se exige un **motivo** (lista editable en Configuración). Un lead cerrado solo lo reabre el supervisor.
- El día de una tarea (vencida / hoy / próxima) se calcula en hora de Chile.
- Quedan en la bitácora: alta y cambios de vehículos (con precio, costo, estado y km antes/después), clientes, creación, movimiento y reasignación de leads.
- Las fotos del inventario se guardan como `vfoto::<vehículo>::<id>` en `kv_store`; las ve quien trabaja con inventario o leads y solo las sube quien edita el inventario.
- Código: reglas puras en `supabase/functions/api/ventas-core.js`, operaciones del servidor en `ventas.ts`, pantallas en `src/crm-ventas.jsx` y `src/crm-inventario.jsx`. Pruebas: `tests/ventas-core.test.mjs` y `tests/ventas-api.test.mjs` (la función real contra una base falsa).

## CRM · Entrega 2B: cotizaciones, aprobación de descuentos y reservas

**Instalar (una sola vez, después de `supabase-crm-ventas.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-cotizaciones.sql` → *Run*. Crea `cotizaciones` y `reservas` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.
Hasta que se ejecute el SQL, el resto del módulo sigue funcionando; cotizar y reservar avisan que faltan las tablas.

**Cotizar** (ficha del lead → *Nueva cotización*): vehículo del inventario, descuento, vehículo en parte de pago, financiamiento (pie, plazo, banco y cuota mensual **estimada** con tasa referencial) y observaciones. El **precio de lista lo fija el servidor** desde el inventario; la pantalla no puede cambiarlo. La cotización lleva un folio (`COT-000123`), guarda una copia de los datos del vehículo y vence a los **7 días** (configurable). Al crear la primera, el lead pasa solo a **Cotizado**.

**Aprobación de descuentos**: todo descuento lo aprueba el Jefe Local (quien tiene `leads.asignar`).
- Sin descuento, o si cotiza un supervisor: queda **vigente**. Un supervisor que se aprueba a sí mismo queda registrado a su nombre.
- Con descuento pedido por un ejecutivo: **esperando aprobación**; mientras tanto no se puede entregar el PDF ni reservar. El supervisor ve una pestaña **Aprobaciones** (con insignia), el aviso en el inicio y en la tarjeta del lead, el precio de lista, el descuento en $ y %, el precio final y el **margen** que quedaría (solo si puede ver costos). Aprueba, o rechaza con un motivo obligatorio.
- Editar una cotización aprobada **vuelve a pedir aprobación solo si cambia el descuento o el precio de lista**; cambiar la parte de pago o el financiamiento no. Una rechazada se corrige y se reenvía.

**PDF para el cliente** (*Descargar PDF*, solo si está vigente o con reserva): cliente, vehículo con **hasta 2 fotos**, precio de lista, descuento, precio final, vehículo en parte de pago, saldo a pagar, pie, monto a financiar y cuota estimada (con aviso de que es referencial), observaciones, **condiciones** (texto editable en Configuración), ejecutivo y local. El costo del vehículo **nunca** aparece en la cotización ni en el PDF.

**Reservar** (cotización vigente → *Reservar*): monto, días (3 por defecto, configurable), medio de pago y notas.
- El vehículo pasa a **Reservado**, la cotización a "con reserva" y el lead a **Reservado**, todo junto; si algo falla a medias se deshace. La base impide dos reservas activas del mismo vehículo aunque dos personas reserven a la vez.
- El estado "Reservado" **lo pone solo el sistema**: no se asigna a mano y un vehículo reservado no se puede cambiar de estado ni archivar hasta cancelar la reserva.
- **Vence sola**: cuando alguien abre el inventario, los leads o las reservas y el plazo ya pasó, la reserva se marca vencida y el vehículo vuelve a estar disponible, la cotización a vigente y el lead a Cotizado (queda en el historial y en la bitácora como acción del sistema). *No usa un proceso programado*: si nadie abre el sistema, la liberación ocurre en cuanto alguien lo abre.
- **Extender** (+2 días) y **cancelar** (con la nota de que el sistema solo *registra* el monto recibido: no mueve dinero y cualquier devolución se gestiona fuera).
- Con una reserva activa, el lead no se puede mover de etapa; sí se puede marcar como **perdido**, y eso cancela la reserva y libera el vehículo.

**Configuración** (pestaña Configuración): vigencia de la cotización (días), duración de la reserva (días) y texto de condiciones del PDF.

**Bitácora**: cotizaciones creadas y editadas (con descuento), aprobaciones y rechazos (con quién pidió y quién resolvió), anulaciones, reservas creadas, extendidas, canceladas y vencidas.

Código: reglas puras en `supabase/functions/api/ventas-core.js`, operaciones del servidor en `ventas.ts`, pantallas en `src/crm-cotizaciones.jsx` y el PDF en `src/pdf-report.js` (`buildCotizacionPdf`, que ahora admite fotos JPEG). Pruebas: `tests/cotizaciones-api.test.mjs` (la función real contra una base falsa), `tests/cotizacion-pdf.test.mjs` y las de `ventas-core`.

## CRM · Entrega 2C: cierre de venta, comisiones por tramos y metas

**Instalar (una sola vez, después de `supabase-crm-cotizaciones.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-cierres.sql` → *Run*. Agrega la columna `comision` a `usuarios` (tramos propios de cada persona) y crea la tabla `cierres`. Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.
Hasta que se ejecute el SQL el resto sigue funcionando; cerrar ventas avisa que faltan las tablas.

**Cierre de venta** (ficha del lead reservado → *Cerrar la venta*): precio final de venta, vehículo recibido en parte de pago, monto financiado con su **financiera** (Autofin, BK, Global, Dily u Otros) y la **comisión que paga la financiera**, si se vendió un **seguro**, fecha de entrega y observaciones. Reglas:
- Exige una **reserva activa** del vehículo (el flujo es cotizar → reservar → cerrar) y que el lead tenga ejecutivo asignado.
- **Todo cierre lo aprueba el Jefe Local** (pestaña *Aprobaciones*, que ahora junta descuentos y ventas). Un supervisor que cierra aprueba su propia venta, a su nombre. El supervisor ve el precio cotizado, el precio de venta, cuánto menos que la cotización, la forma de pago y el **margen**; puede aprobar o rechazar (con motivo). El ejecutivo puede **retirar** un cierre pendiente o pedirlo de nuevo si lo rechazaron.
- Al **aprobar**, todo cambia junto: el vehículo queda **Vendido**, la reserva **convertida**, la cotización **vendida** y el lead **Cerrado ganado**. Esa etapa es automática y una venta cerrada no se mueve a mano ni se puede cambiar el estado del vehículo: solo se revierte **anulando el cierre**.
- **Anular una venta** (solo supervisor, con motivo): el vehículo vuelve a Disponible, la cotización a Vigente, el lead a Cotizado, y la venta **sale de la comisión del mes** en que se aprobó. Queda en la bitácora.
- Un vehículo no se puede vender dos veces (la base impide dos cierres en curso o aprobados). Si la reserva se cancela con un cierre pendiente, el cierre se anula; una reserva con cierre pendiente no vence sola.
- Queda en la bitácora: venta solicitada, aprobada, rechazada, retirada y anulada.

**Comisiones — mismos tramos del perfil de Ejecutivo actual** (`supabase/functions/api/comisiones-core.js`; una prueba compara los tramos estándar con los de `src/App.jsx` para que no se desfasen):
- Ventas, seguros, compras e inspecciones: *unidades del mes × monto del tramo en que cae esa cantidad*. **El nuevo monto se aplica a TODAS las unidades del mes** (con 4 ventas pagan $90.000 las 4, no solo la cuarta). Estándar de ventas: 1 a 3 → $75.000; 4 a 10 → $90.000; 11 o más → $110.000.
- Créditos: suma de las comisiones que pagan las financieras × el porcentaje del tramo según cuántos créditos hubo (1–3: 15 %; 4–6: 25 %; 7 o más: 28 %).
- Una venta con **monto financiado** cuenta como crédito; una con **seguro** cuenta como seguro.
- Consignaciones: igual que en el perfil actual, la producción es la suma de márgenes netos (25 % del margen bruto); los tramos de consignaciones existen pero hoy no se aplican a ese cálculo.
- El mes de una venta es el de su **aprobación**, en hora de Chile. Solo cuentan las aprobadas.
- **Tramos propios por persona**: en *Usuarios → Editar → Comisiones por tramos* (solo la cuenta maestra), con los mismos módulos y la misma lógica de "crear perfil de ejecutivo": por módulo, estándar o personalizado. Los porcentajes se escriben como 25 y se guardan como 0,25. Se valida que no se superpongan y que solo el último quede sin tope. Editar a la persona sin tocar los tramos no los borra; enviarlos vacíos la devuelve a los estándar.
- Compras, consignaciones e inspecciones se suman cuando existan sus flujos en el CRM; mientras tanto la pantalla lo indica.

**Dónde se ve:**
- **Ejecutivo** → Inicio: *Mi comisión del mes* con barra de **meta**, desglose por concepto, tramo actual y **cuántas ventas faltan para el siguiente** (y que el nuevo valor se aplica a todas). Pestaña *Ventas*: sus ventas del mes.
- **Jefe Local** → pestaña *Ventas*: por mes, el equipo con ventas / meta, monto vendido, **margen**, comisión de cada ejecutivo (se despliega con el detalle) y la lista de ventas con *Anular*. El ejecutivo **no ve costos ni márgenes**.
- **Meta mensual** por ejecutivo (unidades) en Configuración. Los porcentajes de comisión sueltos de la entrega 2A se eliminaron: la comisión sale solo de los tramos.
- Permisos: `comisiones.propias` (ver la propia) y `comisiones.local` (ver las del equipo) ya están activos.

Código: reglas en `ventas-core.js` y `comisiones-core.js`, servidor en `ventas.ts` (`cierres.*`, `comisiones.resumen`), pantallas en `src/crm-cierres.jsx` y `src/crm-tramos.jsx`. Pruebas: `tests/cierres-api.test.mjs` (la función real contra una base falsa), `tests/comisiones-core.test.mjs` y las de `ventas-core`.

## CRM · Entrega 3: panel de gestión del Jefe Local

**Instalar (una sola vez, después de `supabase-crm-cierres.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-gestion.sql` → *Run*. Agrega la columna `ultima_actividad` a `leads` y crea la tabla `avisos` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.
Hasta que se ejecute el SQL el resto sigue funcionando; los avisos avisan que faltan las tablas y la detección de leads detenidos usa las marcas de tiempo que ya existían.

Para quien tiene `leads.asignar` (Jefe Local y la cuenta maestra): pestaña **Gestión** en el módulo de Ventas, y una franja roja en su inicio cuando hay algo que atender.

**Alertas** (se calculan en el servidor, solo con los leads del local):
- **Sin atender**: lead *nuevo* sin ningún contacto hace **4 horas** o más.
- **Detenidos**: lead contactado, en seguimiento o cotizado sin actividad hace **7 días** o más. "Actividad" es cualquier cosa registrada en la ficha (contacto, nota, cotización, reserva, tarea, cambio de etapa…); se guarda en `leads.ultima_actividad`. Los leads *reservados* no se marcan: sus reservas se vigilan por su vencimiento.
- **Sin asignar**: leads abiertos sin ejecutivo (por ejemplo, cuando nadie estaba habilitado para recibirlos).
- **Tareas vencidas del equipo** (día anterior o antes, hora de Chile) y **reservas por vencer** (próximas 48 horas), cada una con su ejecutivo y cliente.
- Los plazos de 4 horas y 7 días son los valores iniciales y se cambian en *Configuración → Alertas del panel de gestión*.
- **Carga por ejecutivo**: leads abiertos, sin atender, detenidos, tareas vencidas y reservas por vencer de cada persona, con los leads sin dueño aparte.

**Acciones sin entrar a cada ficha:**
- **Reasignar en lote** (hasta 50 leads): se eligen en la lista, y se asignan a una persona o con reparto automático (rotativo, sin repetir al dueño actual). Las **tareas pendientes** de cada lead se van con él. Se omiten, y se informa cuáles, los leads cerrados, los que ya eran de esa persona, los de otro local y **los que tienen un cierre de venta en curso o aprobado** (la comisión es de quien cerró la venta). Cada lead queda con una nota en su historial y la operación en la bitácora.
- **Avisos**: el supervisor deja un mensaje (3 a 300 caracteres) a un ejecutivo habilitado, opcionalmente sobre un lead (también queda en su historial). La persona lo ve arriba de su inicio hasta que pulsa *Entendido*. Nadie puede leer ni marcar los avisos de otra persona.

**Embudo y fuentes** (por mes): de los leads que **llegaron** ese mes, cuántos fueron contactados, cotizados, reservados y vendidos (aunque la venta ocurra después), con el porcentaje sobre el total y sobre el paso anterior; **rendimiento por fuente** (leads, cotizados, reservados, vendidos, conversión, monto vendido y margen — el margen solo lo ve quien puede ver costos) y **motivos de pérdida** de los leads perdidos ese mes.

**Actividad del equipo** (por mes): leads recibidos, contactos (llamadas, WhatsApp y visitas registradas), cotizaciones, reservas, ventas aprobadas y tareas cumplidas de cada ejecutivo.

**Escala**: las consultas por lista de identificadores (clientes, vehículos, usuarios de los leads) ahora se hacen en lotes de 80 para no armar direcciones demasiado largas con muchos leads, y los cálculos del panel traen solo los leads abiertos o del mes. Supabase entrega como máximo 1.000 filas por consulta; si un local llegara a superar ese volumen en un mes, habría que agregar los datos en la base.

Código: reglas puras (alertas, embudo, fuentes, avisos) en `ventas-core.js`; servidor en `ventas.ts` (`gestion.resumen`, `gestion.embudo`, `leads.reasignarLote`, `avisos.*`); pantallas en `src/crm-gestion.jsx`. Pruebas: `tests/gestion-api.test.mjs` (la función real contra una base falsa) y las de `ventas-core`.

## CRM · Entrega 4: perfil del Tasador

**Instalar (una sola vez, después de `supabase-crm-gestion.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-tasaciones.sql` → *Run*. Crea la tabla `tasaciones` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.
Hasta que se ejecute el SQL el resto sigue funcionando; pedir o tasar avisa que faltan las tablas.

**Permisos nuevos** (pestaña *Permisos*): `tasaciones.pedir` (Ejecutivo y Jefe Local) y `tasaciones.realizar` (Tasador). *Si antes personalizaste los permisos de esos roles, los nuevos no se agregan solos: actívalos ahí.* El Tasador queda con acceso a su módulo; el Inspector no tasa para el CRM.

**Flujo con solicitudes de los ejecutivos y tasaciones directas:**
- **Pedir** (ficha del lead → *Pedir tasación*): el ejecutivo ingresa el vehículo en parte de pago (patente, marca, modelo, año, km…) y una nota. Queda en la **cola** (*Por tomar*). Solo puede haber una tasación abierta por lead; no se pide en leads cerrados.
- **Tomar**: el primer Tasador que la toma se la queda (otro recibe "ya la tomó"). Puede **devolverla a la cola**; el supervisor puede **asignarla** a otro Tasador del local o **cancelarla**. La cuenta maestra no tasa.
- **Tasación directa** (*+ Tasación directa*): para quien llega a vender o consignar; sin lead, con nombre y teléfono opcionales. Queda tomada por quien la crea.
- **Detalle de la tasación**: vehículo editable; **estimador de Chileautos integrado** (parte con los datos del vehículo y guarda el resultado en la tasación: promedio, publicación y compra sugeridas, avisos usados y la búsqueda); **valor de compra** y **valor de venta esperado** (con margen esperado; el de venta no puede ser menor que el de compra); **inspección vinculada** (se busca por patente entre las inspecciones ya hechas y solo se muestra el vehículo, la fecha y el inspector: **nunca los datos del propietario**); hasta **6 fotos**; observaciones. Se puede guardar un borrador y luego *Completar* (después ya no se edita).

**El valor tasado es el tope del lead** (lo hace cumplir el servidor):
- Al completar, el lead guarda el vehículo en parte de pago con el **valor de compra** y el vínculo a la tasación, y queda en su historial.
- En la **cotización**, al **editar el lead** y en el **cierre de venta**, lo que se le reconoce al cliente por su vehículo **no puede superar lo tasado**. Se puede bajar (negociar), no subir. Editar los datos del lead conserva el vínculo con la tasación.
- Para subirlo hay que **pedir una nueva tasación**; al completarse, el tope pasa a ser el nuevo valor.

**Seguimiento:** el ejecutivo ve en su inicio *Mis tasaciones* (abiertas y las completadas hace menos de 3 días). El Tasador tiene *Resumen* con tasaciones hechas en el mes, **tiempo medio de respuesta** (desde que se pidió hasta que se completó), en proceso, valor de compra total y margen esperado medio. **No tiene comisión por ahora**; se mide su actividad. El supervisor ve las de todos, la cola y cuántas pasaron el plazo.

**Alerta en el panel de gestión:** *Tasaciones sin tomar* — solicitudes que llevan **8 horas** o más en la cola (se cambia en *Configuración → Alertas del panel de gestión*).

**Dónde se usa:** el Tasador tiene la tarjeta **Tasaciones** en su estación; el supervisor y la cuenta maestra, la pestaña **Tasaciones** dentro de Ventas (todas las del local, asignar, cancelar, resumen). Las fotos se guardan como `tfoto::<tasación>::<id>`: las sube quien tasa y las ven quienes piden tasaciones o miran los leads.

**Límite conocido:** la búsqueda de inspecciones recorre los registros guardados por patente con el filtro de la base y lee, como máximo, las 10 coincidencias; si una patente tuviera muchas inspecciones, solo se muestran las primeras 10.

Código: reglas en `supabase/functions/api/tasaciones-core.js`; servidor en `ventas.ts` (`tasaciones.*`); pantallas en `src/crm-tasaciones.jsx`; el estimador (`TasacionCompra` en `src/App.jsx`) ahora acepta `inicial` y `onResultado`. Pruebas: `tests/tasaciones-core.test.mjs` y `tests/tasaciones-api.test.mjs` (la función real contra una base falsa).

## CRM · Entrega 5: perfil del Inspector

**Instalar (una sola vez, después de `supabase-crm-tasaciones.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-inspecciones.sql` → *Run*. Crea la tabla `inspecciones` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.
Hasta que se ejecute el SQL el resto sigue funcionando; pedir o registrar inspecciones avisa que faltan las tablas.

**Permisos nuevos** (pestaña *Permisos*): `inspecciones.pedir` (Ejecutivo, Jefe Local y Tasador) e `inspecciones.realizar` (Inspector). *Si antes personalizaste los permisos de esos roles, los nuevos no se agregan solos: actívalos ahí.* El Jefe Local gestiona todo lo del local con su permiso de supervisor.

**Dos formas de inspeccionar:**
- **Con solicitud** (cola y agenda): un Ejecutivo, Tasador o supervisor pide la inspección desde la **ficha del lead**, el **detalle de una tasación** o la **ficha del vehículo del inventario**, indicando **fecha, hora, dirección**, con quién coordinar en el lugar y una nota. Queda en la cola *Por tomar*. El primer Inspector que la toma se la queda (otro recibe "ya la tomó"); si le queda otra a menos de 90 minutos, se le avisa del posible choque. El supervisor puede **asignarla**, **reasignarla**, **devolverla a la cola**, **reprogramarla** o **cancelarla**; quien la pidió puede reprogramarla y, mientras está sin tomar, cancelarla. Una misma patente no puede tener dos inspecciones abiertas.
- **Espontánea**: el Inspector usa su checklist de siempre (con PDF del CAV, borradores y PDF) sin que nadie se la haya pedido. Se registra sola al guardar.

**Estación del Inspector** (tarjeta *Inspecciones y tasaciones*): primero **Solicitudes y agenda** (*Mi agenda* agrupada por día con las atrasadas marcadas, *Por tomar*, *Mis inspecciones*, *Todas del local*, *Resumen y comisión*) y luego la pestaña *Inspección* con su checklist. Al pulsar *Realizar la inspección* en una solicitud agendada, el checklist se abre con la patente, marca, modelo y año ya cargados y un aviso de que responde a esa solicitud. Si la ficha se edita o se elimina, la solicitud se actualiza: al eliminar, la pedida vuelve a *Agendada* para rehacerla y la espontánea desaparece.

**Privacidad (lo hace cumplir el servidor):** los demás perfiles ven el **resultado** (*Sin observaciones / Con observaciones / Con fallas*, cuántos ítems están bien, regulares o malos), las **observaciones destacadas** y las **fotos**. **Nunca** ven el nombre ni el RUN del propietario del padrón: no se guardan en la tabla del CRM (el resumen se arma con una lista cerrada de campos y descarta todo lo demás) y la ficha completa (`inspeccion::<persona>::<id>`) solo la abre su Inspector. Las fotos para el equipo (hasta 12, reducidas en el dispositivo) se suben desde el checklist como `ifoto::<ficha>::<id>`: las sube quien inspecciona y las ven quienes piden inspecciones, miran los leads o tasan.

**Comisión del Inspector:** por tramos según las **inspecciones realizadas en el mes** (pedidas y espontáneas, las dos cuentan), con la misma regla de los demás módulos: se aplica el monto del tramo en que cae la cantidad a **todas** las del mes. Estándar: **$35.000 c/u** (tramo 1–10); el administrador define tramos propios por persona en *Usuarios → Editar → Comisiones por tramos → Inspecciones*. La pestaña *Resumen y comisión* muestra, por Inspector, realizadas, pedidas/espontáneas, con fallas, tiempo medio de respuesta (desde que se pidió hasta que se realizó), agendadas, tramo y comisión; cada Inspector ve solo lo suyo y el supervisor, a todos los del local.

**Alerta en el panel de gestión:** *Inspecciones sin tomar* — solicitudes que llevan **8 horas** o más en la cola, o cuya fecha es dentro de menos de 24 horas, sin Inspector (se cambia en *Configuración → Alertas del panel de gestión*). Cada paso importante queda en el historial del lead y en la bitácora.

**Dónde se usa:** el Inspector, en su estación; el Ejecutivo, en la ficha del lead (y en la pestaña *Inspecciones* de Ventas, *Mis solicitudes*); el Tasador, en el detalle de la tasación; el supervisor y la cuenta maestra, en la pestaña **Inspecciones** dentro de Ventas.

**Límites conocidos:** los Inspectores que ingresan con el código del panel antiguo siguen funcionando como antes, pero no participan de solicitudes ni comisión (para eso se ingresa con RUT). Si se guarda una ficha con una patente inválida, la inspección se guarda pero no se registra en el CRM hasta corregirla y volver a guardar (la pantalla lo avisa). Las fotos de una ficha descartada sin guardar se borran al descartar; si se cierra la pestaña a la mitad, pueden quedar fotos sueltas sin uso.

Código: reglas en `supabase/functions/api/inspecciones-core.js`; servidor en `ventas.ts` (`inspecciones.*`); pantallas en `src/crm-inspecciones.jsx` (y el enganche con el checklist en `InspectorDashboard`, `src/App.jsx`). Pruebas: `tests/inspecciones-core.test.mjs` y `tests/inspecciones-api.test.mjs` (la función real contra una base falsa).

## CRM · Entrega 6: perfil del Validador

**Instalar (una sola vez, después de `supabase-crm-inspecciones.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-validaciones.sql` → *Run*. Crea las tablas `validaciones` y `validacion_docs` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.
Hasta que se ejecute el SQL el resto sigue funcionando y las ventas se aprueban como antes.

**Permisos** (pestaña *Permisos*): `validacion.usar` (ahora disponible: ver el módulo) y `validacion.realizar` (tomar y revisar documentos; el Validador lo trae por defecto). *Si antes personalizaste los permisos del rol Validador, activa `validacion.realizar` ahí.*

**Revisión automática por etapa** (no se pide a mano):
- **Cierre de venta**: al pedir el cierre se crea una validación con sus documentos: los 5 del vehículo (padrón/CAV, permiso de circulación, revisión técnica, SOAP, multas y prendas) y los del cliente (cédula, domicilio, comprobante de pago); con financiamiento se suman renta y solicitud de crédito, y con parte de pago, los documentos de ese vehículo.
- **Vehículo nuevo en el inventario**: se crea la validación de sus 5 documentos. Cuando queda aprobada, **se reutiliza** en la venta de ese vehículo (esos documentos ya aparecen aprobados y no se vuelven a pedir).
- **Compra directa** (tasación directa completada): documentos del vehículo, cédula del vendedor, contrato de compraventa y comprobante de pago (opcional). Hoy es informativa: el módulo de compras llegará más adelante.

**Cola y revisión:** el Validador toma la validación de la cola (o el supervisor se la asigna, reasigna o la devuelve a la cola). Solo quien la tomó revisa. Por cada documento: **Aprobar** (exige al menos un archivo), **Observar** (falta algo; con motivo), **Rechazar** (con motivo) o **No aplica** (con motivo). Cada documento admite hasta 3 archivos (foto JPG/PNG o PDF de hasta 4 MB; las fotos se reducen en el dispositivo). Quien trabaja la venta (o el vehículo, o la compra) sube la corrección y el documento **vuelve a revisión** solo. Un documento aprobado ya no se modifica. El estado de la validación sale de sus documentos: *Por tomar → En revisión → Con observaciones / Rechazada → Aprobada* (cuando todos los requeridos están aprobados o no aplican).

**Bloqueo de la venta (lo hace cumplir el servidor):** si el local tiene al menos un Validador activo, el Jefe Local **no puede aprobar un cierre de venta** mientras su validación no esté aprobada (*"Los documentos de esta venta aún no están validados"*). Cuando el supervisor cierra su propia venta tampoco se aprueba sola: espera la validación. Los cierres pedidos antes de instalar esto reciben su validación al intentar aprobarlos. **Si el local no tiene ningún Validador, nada se frena** (para no dejar ventas atascadas). Una venta retirada, rechazada o anulada deja de aparecer en la cola de validación.

**Seguimiento:** pestaña *Resumen* con la cola, validaciones aprobadas en el mes, tiempo medio (desde que se pidió hasta que quedó aprobada), abiertas y con observaciones de cada Validador (sin comisión por ahora). **Alerta en el panel de gestión:** *Validaciones sin tomar* — llevan **8 horas** o más en la cola (se cambia en *Configuración → Alertas del panel de gestión*). Los pasos importantes quedan en el historial del lead y en la bitácora.

**Dónde se usa:** el Validador, en la tarjeta **Validaciones** de su estación; el Ejecutivo, en la ficha del lead (*Validación de documentos de la venta*, donde sube las correcciones); quien edita el inventario, en la ficha del vehículo; el Tasador, en la tasación directa; el supervisor y la cuenta maestra, en la pestaña **Validaciones** dentro de Ventas.

**Privacidad de los archivos:** se guardan como `dval::<validación>::<archivo>` en la base (la clave incluye el id de la validación, imposible de adivinar). El servidor decide quién puede registrar un archivo en cada documento; guardar o leer el contenido lo pueden hacer, a nivel de base, quienes trabajan leads, inventario, tasaciones o validaciones de su local. Para cédulas y documentos personales, limita el permiso `leads.local` (Marketing) si no corresponde que los vea.

**Límites conocidos:** los archivos de una corrección que se descarta a medias pueden quedar sueltos sin uso. Los documentos de una venta no se copian al vehículo (solo del vehículo hacia la venta). Hasta que exista el módulo de Compras y Consignaciones, esas validaciones no bloquean nada.

Código: reglas en `supabase/functions/api/validaciones-core.js`; servidor en `ventas.ts` (`validacion.*` y los enganches en `inventario.save`, `tasaciones.completar`, `cierres.crear` y `cierres.aprobar`); pantallas en `src/crm-validaciones.jsx`. Pruebas: `tests/validaciones-core.test.mjs` y `tests/validaciones-api.test.mjs` (la función real contra una base falsa).

## CRM · Entrega 7: perfil del Anunciante

**Instalar (una sola vez, después de `supabase-crm-validaciones.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-anuncios.sql` → *Run*. Crea las tablas `anuncios` y `anuncio_portales` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.

**Permiso:** `anuncios.gestionar` (ahora disponible; el rol Anunciante lo trae por defecto). *Si antes personalizaste los permisos de ese rol, actívalo en la pestaña Permisos.* Solo el Anunciante publica: el Jefe Local y la cuenta maestra **ven** todo (pestaña *Avisos* dentro de Ventas) pero no modifican avisos.

**Flujo:**
- **Por publicar** (cola): los vehículos *Disponibles* del local que aún no tienen aviso (no entran los de *En preparación*, reservados ni vendidos). **Crear aviso** arma el título y la descripción sugeridos con los datos del inventario (marca, modelo, versión, año, km, transmisión, combustible, color y precio de lista). Un vehículo tiene un solo aviso activo; al darlo de baja puede tener uno nuevo.
- **Detalle del aviso:** texto editable con botones *Copiar título* y *Copiar descripción*; las **fotos del inventario** (toca una para descargarla y subirla al portal); y una fila por portal: **Chileautos, Yapo, Facebook Marketplace, Sitio web propio, Instagram, TikTok y Otro**. En cada una se marca *publicado* (con el enlace https del aviso, salvo el sitio propio) y su **fecha de vencimiento**, y se puede **pausar**, **reactivar** o **bajar** de ese portal. El estado del aviso sale de sus portales (publicado si alguno lo está; pausado; dado de baja cuando todos están dados de baja). *Dar de baja el aviso completo* lo baja de todos los portales.
- Al publicar o confirmar con **"Ya lo actualicé"**, el aviso guarda el **precio de lista de ese momento**.

**Alertas de avisos desactualizados** (calculadas al abrir; sin tareas programadas): por cada portal con el aviso publicado o pausado se avisa si
- el precio de lista del inventario es **distinto al publicado** (hay que corregir el aviso y pulsar *Ya lo actualicé*);
- el vehículo está **reservado** (pausar) o **vendido / archivado** (dar de baja);
- el aviso **venció** o vence en **3 días o menos** (renovar).
Aparecen en *Resumen y alertas* del Anunciante y como alerta **Avisos desactualizados** en el panel de gestión del Jefe Local. No se puede marcar *publicado* un vehículo que no está disponible.

**Solo con documentos validados:** si el local tiene al menos un Validador, un vehículo entra a publicarse recién cuando su validación de documentos está **aprobada**; antes aparece como *Esperando validación*. Los vehículos anteriores a las validaciones reciben la suya la primera vez que aparecen en la cola. Sin Validadores en el local, no se bloquea nada.

**Consultas por aviso:** cada aviso muestra los leads de ese vehículo de los últimos 30 días, por portal **según la fuente del lead**. Para que cuente, la fuente debe llamarse igual que el portal (Chileautos, Yapo, Facebook Marketplace, Sitio web, Instagram, TikTok): el administrador las agrega en *Configuración → Fuentes de leads* (las fuentes que ya existen no se modifican solas). El resumen muestra además los avisos con más consultas.

**Límites conocidos:** el sistema **no publica solo** en los portales (cada uno tiene sus reglas y accesos): el Anunciante publica a mano y registra aquí el enlace. Las alertas se calculan cuando alguien abre el módulo o el panel de gestión (no hay avisos automáticos por correo o WhatsApp). El sitio web público se conectará a estos avisos cuando se construya.

Código: reglas en `supabase/functions/api/anuncios-core.js`; servidor en `ventas.ts` (`anuncios.*`); pantallas en `src/crm-anuncios.jsx`. Pruebas: `tests/anuncios-core.test.mjs` y `tests/anuncios-api.test.mjs` (la función real contra una base falsa).

## CRM · Entrega 8: perfil de Marketing y RRSS

**Instalar (una sola vez, después de `supabase-crm-anuncios.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-marketing.sql` → *Run*. Crea las tablas `campanias`, `publicaciones_rrss` y `material_vehiculo`, y agrega la columna `campania_id` a `leads` (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`.

**Permiso:** `marketing.gestionar` (ahora disponible; el rol Marketing lo trae por defecto, junto con `leads.local`). *Si antes personalizaste los permisos de ese rol, actívalo en la pestaña Permisos.* El Jefe Local y la cuenta maestra **ven** todo (pestaña *Marketing* dentro de Ventas); el Jefe Local además **aprueba o rechaza campañas** y puede pedir material.

**Calendario de contenido:** una fila por publicación con red (Instagram, Facebook, TikTok, YouTube, Google, Chileautos, Yapo, WhatsApp u otra), formato (post, reel, historia, video, carrusel), texto, fecha y hora, campaña y vehículo (opcionales). Estados: *Idea → En producción → Programada → Publicada* (o Cancelada); una publicada guarda el enlace. Una *Programada* cuya hora ya pasó se marca como **atrasada**. Se filtra por mes y por red. Solo se eliminan las ideas y las canceladas.

**Campañas con presupuesto y aprobación:**
- Se crean en *Borrador* (nombre, canal, fechas, objetivo y presupuesto).
- **Con presupuesto**: *Enviar a aprobación* → el **Jefe Local la aprueba o rechaza** (con motivo; al rechazarla Marketing la corrige y la reenvía). Al aprobar queda fijado el **presupuesto aprobado**.
- **Sin presupuesto (0)**: *Activar* la deja aprobada sola (campaña orgánica).
- Si una campaña aprobada **sube su presupuesto** por sobre lo aprobado, vuelve a pedir aprobación; no puede bajarse bajo lo ya gastado.
- Marketing anota a mano **gasto real, alcance, impresiones y clics**. El **gasto no puede superar el presupuesto aprobado**. Luego puede *Finalizar* la campaña; Marketing o el Jefe Local pueden *Cancelarla*.
- Alerta **Campañas por aprobar** en el panel de gestión del Jefe Local.

**Leads por campaña:** el formulario del lead tiene el campo opcional **Campaña** (solo ofrece las campañas aprobadas del local). La ficha del lead muestra su campaña. Editar el lead sin tocar el campo la conserva. Cada campaña muestra **leads, ventas aprobadas, monto vendido, conversión, costo por lead (gasto ÷ leads) y costo por venta (gasto ÷ ventas)** y cuánto del presupuesto lleva consumido.

**Material por vehículo:** se pide *fotos profesionales, video, reel o historias* de un vehículo (Marketing o el Jefe Local), con una nota; Marketing lo pasa a *En proceso* y a *Listo* dejando el **enlace** a la carpeta (por ejemplo, Google Drive). Un pedido por vehículo y tipo.

**Resultados:** por mes, los **leads por fuente** (cuántos se cotizaron, reservaron y vendieron, conversión y monto vendido) y el desempeño de cada campaña. **Marketing no ve costos ni márgenes** de los vehículos, solo montos vendidos.

**Privacidad:** el rol Marketing ya tenía `leads.local`, que le permite ver los leads del local (con los datos de contacto de los clientes). Si no quieres que los vea, quita ese permiso del rol en *Permisos*: el módulo de Marketing funciona igual, porque sus cifras salen del servidor.

**Límites conocidos:** los resultados (gasto, alcance, clics) se **anotan a mano**: no hay conexión automática con Meta, TikTok ni Google. Las publicaciones del calendario no se publican solas en las redes. Para que un portal aparezca en *Leads por fuente*, la fuente debe existir en *Configuración → Fuentes de leads*.

Código: reglas en `supabase/functions/api/marketing-core.js`; servidor en `ventas.ts` (`marketing.*`, el campo `campaniaId` de los leads y las campañas del catálogo); pantallas en `src/crm-marketing.jsx`. Pruebas: `tests/marketing-core.test.mjs` y `tests/marketing-api.test.mjs` (la función real contra una base falsa).

## Rendimiento y estabilidad (revisión posterior a la entrega 8)

Se midió desde dentro cuánto tarda cada pantalla (la función real contra una base falsa con 40 vehículos y 120 leads, simulando 35 ms de viaje a la base por consulta) y se encontraron cuatro causas de lentitud o pantalla en blanco; todas corregidas:

- **Pantalla en blanco:** el sitio no tenía ninguna protección contra errores de dibujo, así que un dato inesperado en una sola pantalla dejaba TODO en blanco. Ahora hay una *red de seguridad* (`src/error-boundary.jsx`): solo esa parte muestra «Esta pantalla tuvo un problema» con *Reintentar* y *Recargar*; el resto sigue funcionando. Al cambiar de pestaña se reintenta sola. Si el error es porque se publicó una versión nueva mientras la pestaña estaba abierta, avisa que hay que recargar.
- **Consultas en fila:** varias pantallas esperaban a la base 10 a 17 veces seguidas. Ahora las consultas que no dependen unas de otras se piden juntas (lista de leads, ficha del lead, panel de gestión, embudo, comisiones, reservas, cola de avisos), y las listas largas se consultan en lotes en paralelo. Además, el chequeo de reservas vencidas, que corría en casi cada pantalla, ahora le pide a la base solo las ya vencidas (normalmente ninguna) en vez de traerlas todas.
- **Sitio pesado:** el paquete principal pasó de 1,4 MB a 0,66 MB. Las gráficas (recharts) y el lector de PDF del CAV (pdf.js) se cargan recién cuando se usan.
- **Esperas infinitas y respuestas cruzadas:** las llamadas al servidor se cortan a los 45 s con un aviso claro (las de lectura se reintentan solas), y una respuesta lenta de una pantalla anterior ya no pisa a la actual.

- **Ciclo infinito de peticiones (Avisos, Marketing y otros módulos de la estación):** cuando un módulo se abría desde la estación de trabajo, la función que habla con el servidor se creaba de nuevo en cada dibujo y las pantallas volvían a pedir sus datos sin parar (medido: más de 180.000 peticiones en pocos segundos), lo que congelaba el navegador y saturaba la función. Ahora todos usan una única función estable (`apiPorDefecto`, en `src/crm-ui.jsx`) y una prueba automática (`tests/estabilidad-ui.test.mjs`) impide que el error vuelva a colarse.

**Qué más puede hacer lenta la plataforma (no depende del código):**
- *Arranque en frío:* la primera acción después de un rato sin uso tarda más (la función se reinicia).
- *Distancia entre la función y la base:* si la región donde corre la función es distinta a la de la base de datos, cada consulta cruza continentes. Se ve en el panel de Supabase (Project Settings → General → Region) y en *Edge Functions → api → Metrics*.

Para repetir la medición: `node scripts/medir-rendimiento.mjs` (muestra cuántas consultas y cuánto tarda cada pantalla con 35 ms de latencia simulada a la base).

## CRM · Entrega 9: sitio web público

**Instalar:** no hay SQL nuevo (usa las tablas que ya existen). Solo redesplegar la función (`node scripts/deploy-api.mjs`) y subir el código (`git push origin main`).

**Direcciones nuevas** (todo en el mismo proyecto de Vercel):
- `/` — **catálogo público** de vehículos.
- `/vehiculo/<id>` — detalle de un vehículo (se puede compartir el enlace).
- `/vender` — formulario para vender o consignar el auto del visitante.
- **`/plataforma` — el CRM del personal** (lo que antes estaba en la raíz). El enlace «Acceso del personal» del pie del sitio lleva ahí. *Los enlaces antiguos de ejecutivos e inspectores (`?vendor=` y `?inspector=`) siguen funcionando donde estén*, porque se reconocen por su código. **Lo que cambia: el favorito o la dirección que usas para entrar como administrador o con RUT ahora es `tudominio/plataforma`.**

**Qué vehículos se ven:** los **disponibles** y los **reservados** (estos con la etiqueta «Reservado»), activos y con precio de lista. Se ven solos: no necesitan pasar por el Anunciante. Con filtros por marca, transmisión, precio máximo y búsqueda, y orden por precio, año o kilometraje. El texto del detalle es el del aviso del Anunciante si existe; si no, uno armado con los datos del vehículo. **Nunca se muestran la patente, el costo ni las notas internas.** Las fotos son las del inventario y se piden de a una, cuando se ven en pantalla.

**Cuatro solicitudes** (sin iniciar sesión). Cada una crea un lead normal del CRM con la fuente **«Sitio web»** y lo reparte de forma rotativa entre los ejecutivos habilitados para ventas del local del vehículo (si no hay ninguno, queda sin asignar y aparece en las alertas del Jefe Local); el historial del lead dice que vino del sitio:
1. **Consultar por un vehículo** — nombre, teléfono, correo (opcional) y mensaje.
2. **Agendar una visita o test drive** — además, deja una tarea de *visita* en la agenda del ejecutivo asignado, con la fecha y hora que pidió el visitante (a confirmar).
3. **Cotizar financiamiento** — pie y plazo (12 a 72 cuotas). El lead guarda el pie como «quiere financiamiento» y el visitante ve una **cuota referencial**, siempre con el aviso de que está sujeta a evaluación. La tasa mensual se define en *Configuración → Sitio web público* (por defecto 1,5 %).
4. **Vender o consignar mi auto** — patente, marca, modelo, año y kilometraje. Crea un lead de **compra** o **consignación** (según lo que elija) y **una tasación directa en la cola del Tasador**, con el nombre y teléfono de quien ofrece el vehículo.

**Protección contra spam y abusos** (lo hace cumplir el servidor):
- **Límites por hora:** 8 solicitudes por dirección IP, 3 por teléfono y 60 por local en total (freno de emergencia). Al pasarse, se pide intentar más tarde o escribir por WhatsApp.
- **Campo trampa invisible y tiempo mínimo:** los robots llenan un campo que las personas no ven o envían en menos de 3 segundos; en ambos casos el servidor responde «ok» sin crear nada, para no darles pistas. Un formulario abierto más de 6 horas pide recargar.
- **Consentimiento:** casilla obligatoria para aceptar el uso de los datos, con un resumen de cómo se usan.
- Un mismo teléfono reutiliza al mismo cliente (no se duplican).
- Todo queda en la bitácora como «web.solicitud».

**Configuración** (*Configuración → Sitio web público*): nombre del negocio, WhatsApp (con código de país; vacío = sin botón), dirección y la tasa de la cuota referencial.

**Peso y rapidez:** quien visita el sitio descarga solo el catálogo (~60 KB comprimidos); el CRM y sus librerías pesadas se cargan solo en `/plataforma`.

**Límites conocidos:**
- *Buscadores:* el sitio se dibuja en el navegador, por lo que Google puede tardar o ver menos contenido que en un sitio prerenderizado. Se puede mejorar más adelante.
- *Anti-spam:* los límites por IP se llevan por instancia de la función (son un freno, no una garantía absoluta); el límite por teléfono y por local sí se cuenta en la base de datos. Si hubiera abuso real, el siguiente paso es agregar una verificación tipo «No soy un robot» (Cloudflare Turnstile).
- *Fotos:* son las del inventario, reducidas en el dispositivo; para un catálogo más vistoso conviene subir 4 a 6 por vehículo.
- *Cuenta de la solicitud:* los datos de contacto del visitante quedan como cliente del local; hay que atender los pedidos de borrado de datos que lleguen.

Código: reglas en `supabase/functions/api/publico-core.js`; servidor en `supabase/functions/api/publico.ts` (acción `public`, sin sesión); pantallas en `src/sitio-publico.jsx`; el enrutamiento entre el sitio y el CRM está en `src/main.jsx`. Pruebas: `tests/publico-core.test.mjs` y `tests/publico-api.test.mjs` (la función real contra una base falsa, incluidos los frenos contra spam).

## CRM · Entrega 10: compras y consignaciones

**Instalar (después de `supabase-crm-marketing.sql`):**
1. Supabase → *SQL Editor* → pegar `supabase-crm-compras.sql` → *Run*. Crea las tablas `compras` y `consignaciones`; agrega a `leads` el vehículo que ofrece el cliente (`vehiculo_ofrecido`), a `vehiculos` el `precio_piso` y el `origen`, y liga las validaciones a compras y consignaciones (RLS activado, sin políticas). Se puede repetir sin riesgo.
2. Redesplegar la función: `node scripts/deploy-api.mjs`, y subir el código (`git push origin main`).

**Habilitaciones** (en *Usuarios → Editar → Habilitaciones del Ejecutivo*): `compras.operar` y `consignaciones.operar`, igual que ventas. Una persona puede tener las tres. *Los leads se reparten, y solo los trabaja, quien tiene la habilitación de su tipo*: un lead de compra no llega a quien solo vende. Los leads de «Vende o consigna tu auto» del sitio web llegan ya como leads de compra o consignación, con el vehículo cargado.

**Tipo de lead:** al crear un lead, el ejecutivo elige qué quiere el cliente: *comprarnos un vehículo* (venta), *vendernos su vehículo* (compra) o *dejarnos su vehículo en consignación*. En los de compra y consignación se piden patente, marca, modelo, año y kilometraje del vehículo; en el embudo se ven con su etiqueta, y las etapas se muestran con sus nombres (*Oferta hecha → Oferta aceptada → Comprado*; *En validación → Consignado*).

### Compra
1. **Tasación** (en la ficha del lead): *Pedir tasación* la deja en la cola del Tasador (si el sitio web ya creó una por la misma patente, se usa esa). Una tasación de compra **no toca** la parte de pago del lead.
2. **Oferta**: con la tasación completada, el ejecutivo ofrece un monto que **nunca puede superar lo tasado**. El lead pasa a *Oferta hecha*. Un lead tiene una sola compra abierta; tras un rechazo se puede hacer otra oferta.
3. **El cliente responde**: *aceptó* (el lead pasa a *Oferta aceptada* y se crea la validación de documentos: cédula del vendedor, contrato de compraventa y los 5 documentos del vehículo) o *rechazó* (con motivo).
4. **Pago**: el ejecutivo pide aprobar el pago (monto hasta lo ofertado, medio y fecha). El **Jefe Local** lo aprueba o lo rechaza con motivo. **Con Validadores en el local, no se aprueba hasta que los documentos estén validados.** Si el supervisor registra su propia compra, se aprueba sola salvo que falten documentos.
5. **Al aprobar**: el vehículo entra al **inventario en preparación**, con el **costo realmente pagado** y como precio de lista el valor de venta esperado de la tasación; sus documentos ya revisados pasan al vehículo nuevo. El lead queda *Comprado* y la compra cuenta para la comisión del mes. Si ya hay un vehículo activo con esa patente, no se aprueba.
6. **Anular** (solo el supervisor, con motivo): saca la compra de la comisión y archiva el vehículo, siempre que aún no esté reservado ni vendido.

### Consignación
1. **Contrato** en la ficha del lead: **precio piso** (lo mínimo que quiere el dueño), **precio de publicación** (no menor que el piso) y plazo (por defecto 90 días). Se crea la validación de documentos (cédula del dueño, contrato firmado y los 5 del vehículo).
2. **El vehículo entra al inventario como disponible cuando los documentos se aprueban** (o de inmediato, si el local no tiene Validadores): con costo = piso y precio de lista = publicación. El lead queda *Consignado*.
3. **No se vende bajo el piso**: ni al publicar o editar el precio en el inventario, ni al cotizar, ni al cerrar la venta.
4. **Al venderse** (venta aprobada por el Jefe Local), la consignación queda *Vendida* y el **margen = precio de venta − piso** paga al ejecutivo de la consignación el **25 %**; el ejecutivo que vendió cobra su venta como siempre. Si la venta se anula, la consignación vuelve a estar vigente y la comisión desaparece.
5. **Plazo**: se puede **extender** (7 a 180 días, también cuando ya venció) y el vehículo se puede **devolver al dueño** (se archiva; no si está reservado o vendido). Las que vencen en 7 días o menos (o ya vencieron) aparecen como alerta del Jefe Local. No hay tareas automáticas: el vencimiento se ve al abrir.

**Comisiones:** compras por tramos de unidades del mes (estándar $100.000 de 1 a 5 y $200.000 desde la 6ª, o los tramos propios de la persona) y consignaciones al 25 % del margen sobre el piso, calculado en el mes de la venta. Aparecen en *Ventas* y en la tarjeta *Mi comisión del mes*.

**Dónde se usa:** pestaña **Compras y consignaciones** dentro de Ventas (cada ejecutivo ve las suyas; el Jefe Local, las del local, con el botón *Aprobar* para los pagos pendientes); en la **ficha del lead** están los pasos de cada compra o consignación. Alertas en el panel del Jefe Local: *Pagos de compra por aprobar* y *Consignaciones por vencer*.

**Límites conocidos:** el pago se **registra** (monto, medio y fecha); el sistema no mueve dinero ni emite el contrato legal (el contrato de compraventa o de consignación se firma aparte y se sube como documento a la validación). Al devolver o anular se archiva el vehículo; no se borra su historial. Las fotos del vehículo comprado o consignado se suben después, desde el inventario.

Código: reglas en `supabase/functions/api/compras-core.js`; servidor en `ventas.ts` (`compras.*`, `consignaciones.*` y los enganches en leads, cotizaciones, cierres, inventario, validaciones, tasaciones, comisiones y gestión); pantallas en `src/crm-compras.jsx` y `src/crm-ventas.jsx`. Pruebas: `tests/compras-core.test.mjs` y `tests/compras-api.test.mjs` (la función real contra una base falsa).

## Desplegar en un hosting público

Las opciones más simples (tienen plan gratuito y se conectan directo a
un repositorio de GitHub):

### Vercel
1. Sube este proyecto a un repositorio de GitHub.
2. Entra a [vercel.com](https://vercel.com), inicia sesión con GitHub.
3. "Add New Project" → selecciona el repositorio.
4. Vercel detecta automáticamente que es un proyecto Vite (esto además
   queda forzado explícitamente por el archivo `vercel.json` incluido,
   que fija `outputDirectory: dist` y el comando de build). Deja la
   configuración por defecto y presiona "Deploy".
5. En unos minutos tendrás una URL pública (ej. `drive-futuro.vercel.app`)
   y puedes conectar un dominio propio desde el panel del proyecto.

### Netlify
1. Sube el proyecto a GitHub.
2. Entra a [netlify.com](https://netlify.com) → "Add new site" → "Import
   an existing project" → selecciona el repositorio.
3. Build command: `npm run build` — Publish directory: `dist`.
4. "Deploy site".

## ¿Te aparece error 404 al desplegar en Vercel?

El código de este proyecto fue verificado línea por línea (sintaxis JSX,
imports, configuración) y compila sin errores. Un 404 justo después de
desplegar casi siempre es un problema de **estructura del repositorio**,
no del código. Revisa esto en orden:

1. **¿`package.json` queda en la raíz del repositorio de GitHub?**
   Si al extraer el `.zip` subiste la carpeta `drive-futuro/` completa
   (quedando `drive-futuro/drive-futuro/package.json` en el repo), Vercel
   no lo va a encontrar. Solución: sube el **contenido** de la carpeta
   `drive-futuro/` directamente a la raíz del repo (los archivos
   `package.json`, `index.html`, `src/`, etc. deben verse de inmediato
   al entrar al repositorio en GitHub, sin necesidad de abrir una
   subcarpeta más).

2. **Si prefieres mantener la subcarpeta**, en Vercel ve a: Project →
   Settings → General → "Root Directory" y apúntalo a `drive-futuro`
   (o el nombre que le hayas puesto a la carpeta).

3. **Revisa el log del deployment** en Vercel (pestaña "Deployments" →
   clic en el deployment → "Building"). Si el build falló, ahí vas a
   ver el error exacto en rojo — cópialo y compártelo si necesitas más
   ayuda.

4. **Confirma que la carpeta `src/` se subió completa a GitHub**
   (con `App.jsx`, `main.jsx`, `storage-shim.js`, `index.css`). Es común
   que al arrastrar carpetas en la interfaz web de GitHub alguna
   subcarpeta no se suba bien; si es tu caso, usa la Opción B (Git por
   línea de comandos) en vez de arrastrar archivos.

5. Verifica en Vercel que el "Framework Preset" quedó en **Vite** (no en
   "Other"). El archivo `vercel.json` incluido ya fuerza esto, pero si
   tu proyecto en Vercel se creó antes de agregar este archivo, revisa
   Settings → General → Framework Preset.

## Primer uso tras publicar

1. Abre la URL pública.
2. Entra como administrador con la clave maestra configurada en el
   código (búscala en `src/App.jsx`, constante `MASTER_ADMIN`) y
   **cámbiala antes de compartir el enlace con otras personas** —
   está visible en el código fuente, así que no es un secreto real.
3. Crea los perfiles de ejecutivos e inspectores desde el panel
   administrador; cada uno recibe un enlace/código de acceso propio.

## Reforzar la seguridad más adelante (opcional)

Con Supabase y la Edge Function, los datos quedan compartidos, persistentes y
protegidos por validación en el servidor. Refuerzos que siguen pendientes:

1. Mover los datos personales fijos que aún están en `src/App.jsx` (el RUT
   usado para los tramos personalizados) a la base de datos.
2. Agregar envío real de correos de recuperación con un servicio como
   SendGrid, Postmark o Resend (hoy la recuperación de la clave adicional
   es por código de un solo uso).
3. Persistir el contador de intentos fallidos de login en la base de datos
   (hoy vive en memoria de cada instancia de la función).

## Estructura del proyecto

```
drive-futuro/
├── index.html            # Punto de entrada HTML
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json            # Config explícita de build/output para Vercel
├── .env.example           # Variables de entorno de Supabase (plantilla)
├── src/
│   ├── main.jsx            # Monta la app; elige Supabase o localStorage
│   ├── App.jsx              # Toda la plataforma (componente principal)
│   ├── supabase-storage.js  # Almacenamiento real con Supabase
│   ├── storage-shim.js      # Respaldo con localStorage (sin Supabase)
│   ├── cav-parser.js        # Lectura y autocompletado de datos desde el CAV
│   └── index.css            # Estilos base + Tailwind
└── README.md
```

## CRM · Fichas de inspectores para el Jefe Local y el Administrador

En **Comercial → Fichas de inspectores** (sin SQL nuevo) el **Jefe Local** (las de su local) y la **cuenta maestra** (las de todos los locales) ven, en **solo lectura**, el detalle completo de cada **inspección** del Inspector (checklist ítem por ítem, ficha del vehículo, fotos, observaciones, **nombre y RUN del propietario** y descarga del **PDF con el CAV**) y cada **tasación** (valorización) que el Inspector hace en su propio checklist, con sus valores y PDF. Hay pestañas Inspecciones / Tasaciones del Inspector y un buscador por inspector, patente, vehículo o propietario.

Servidor: `inspecciones.fichas_equipo` (quiénes inspeccionan en el local) y una lectura (`get` / `list`) del almacén para las claves `inspeccion::`, `tasacion::` y `foto::` de personas del **mismo local** del Jefe Local; nunca escritura ni borrado. Solo incluye a los Inspectores del CRM (con RUT); los perfiles antiguos por código siguen en *Versión anterior → Inspectores (código)*. Esto reemplaza la regla anterior de que los datos del propietario eran solo del Inspector y el Administrador. Pruebas: `tests/inspecciones-api.test.mjs`.

## CRM · Avisos automáticos por correo

Sin SQL nuevo. Los avisos salen por **Resend** y **solo se activan si existe el secreto `RESEND_API_KEY`**; sin él, el CRM funciona igual y no envía nada. Un fallo del correo nunca frena ni deshace la operación (queda en el registro de la función).

**Activar** (en tu terminal, con la sesión de Supabase iniciada; la clave nunca se escribe en el código):
```
npx supabase secrets set RESEND_API_KEY=<tu clave> MAIL_FROM="Drive Futuro <avisos@tu-dominio.cl>" APP_URL=https://<tu-sitio>.vercel.app --project-ref lvcmstvcbbvltompunbr
```
- `MAIL_FROM`: remitente. Con un dominio verificado en Resend se puede escribir a cualquiera; sin dominio, Resend solo deja enviar `onboarding@resend.dev` a la cuenta dueña de la clave (sirve para probar).
- `APP_URL`: dirección pública del sitio, para el botón «Abrir en la plataforma» (sin ella, el correo va sin botón).

**Quién recibe qué** (nunca quien hizo la acción; solo personas activas con correo en su ficha de *Usuarios*):
| Evento | Recibe |
|---|---|
| Lead nuevo asignado o reasignado (incluye los del sitio web) | el Ejecutivo asignado |
| Solicitud en el sitio web | el Ejecutivo asignado (o los Jefes Local si no hay ejecutivos habilitados) y, si dejó correo, **confirmación al cliente** |
| Descuento por aprobar · cierre de venta por aprobar · pago de compra por aprobar | los Jefes Local del local |
| Descuento aprobado/rechazado · cierre aprobado/rechazado · pago de compra aprobado/rechazado | el Ejecutivo del lead |
| Tasación completada · inspección realizada | quien la pidió |
| Documentos validados · documento observado o rechazado | el Ejecutivo del lead |

Los textos van escapados (nada de lo que escribe una persona se interpreta como código) y los asuntos son de una sola línea. Código: `supabase/functions/api/correo.ts` (envío) y `avisos-core.js` (formato); los avisos se disparan en `ventas.ts` y `publico.ts`. Pruebas: `tests/avisos-core.test.mjs` y `tests/avisos-api.test.mjs` (envío simulado). **Límites:** no hay WhatsApp; no hay reintentos ni opción de que cada persona apague sus avisos; la confirmación al cliente usa el correo que él escribió (los frenos por IP y teléfono del sitio limitan el abuso).

## Respaldos y estado del sistema

**Respaldo** (`node scripts/respaldo.mjs`, en la terminal del proyecto, con la sesión de Supabase iniciada): copia **todas las tablas** del CRM (incluido el almacén de fichas y fotos) a `respaldos/AAAA-MM-DD_HHMM/`, un archivo `.jsonl` por tabla (una fila por línea) más `manifest.json` con el conteo de filas de cada una, comparado contra la base. Si alguna tabla queda incompleta lo dice y **no** lo registra como realizado. Conserva los 8 últimos (`--conservar=20` para más). Tarda unos 2 minutos. La carpeta `respaldos/` está en `.gitignore`: **contiene datos personales, nunca se sube**; guárdala como tal (idealmente copia también a un disco externo o nube privada). Recomendado: una vez por semana.

**Restaurar una tabla:** cada línea es la fila completa en JSON. En el SQL Editor: `insert into tabla select * from jsonb_populate_recordset(null::tabla, '[ ...filas... ]'::jsonb);` (ordenando por dependencias: locales → usuarios → clientes → vehiculos → leads → el resto). Para una pérdida total conviene pedirme que prepare el restaurador completo.

**Estado** (panel del Administrador → pestaña **Estado**): servidor y tiempo de respuesta, fecha del último respaldo (en rojo si pasó más de una semana o no hay), avisos por correo (activos, fallidos y omitidos de los últimos 7 días con el motivo), y cuántos datos hay guardados. En *Bitácora* hay filtros «Avisos» y «Respaldos».

**Alerta si se cae:** la función responde `GET .../functions/v1/api?health=1` con `{"ok":true}` solo si la base contesta (503 si no; no entrega datos). Crea un monitor gratis en UptimeRobot (o similar) de tipo *keyword* sobre esa dirección buscando `"ok":true`, cada 5 minutos, con aviso a tu correo; haz otro para la dirección del sitio. La dirección exacta está en la pestaña Estado.

Código: `scripts/respaldo.mjs`, `sistema.estado` y el chequeo de salud en `index.ts`, pantalla en `crm-admin.jsx`. Pruebas: `tests/estado-api.test.mjs`.

## Sesión que sobrevive a recargar la página

Al refrescar (F5) ya no se vuelve al ingreso: la sesión se guarda en `sessionStorage` del navegador y, al abrir la página, se confirma con el servidor (`userMe` para las personas del CRM; una consulta de prueba para la cuenta maestra; un nuevo ingreso con el código para los perfiles antiguos). También se recuerdan la pantalla (estación, ventas, marketing…) y la pestaña en que estabas.
- **Seguridad:** `sessionStorage` se borra al cerrar la pestaña o el navegador (nunca queda guardada de forma permanente) y el token sigue venciendo en el servidor (8 h personas y perfiles por código, 12 h cuenta maestra). **Salir** y cualquier sesión rechazada por el servidor la borran. Si la persona fue desactivada, o le cambiaron los permisos, al recargar se aplican los actuales (o se pide ingresar de nuevo).
- **Límite:** al cerrar la pestaña hay que ingresar otra vez; si el navegador bloquea el almacenamiento (modo privado estricto), vuelve a pedirlo al recargar.

## Campos de dinero con puntos de miles

Todo campo en pesos del CRM y del sitio público (precios, costos, descuentos, pie, reservas, ofertas, pagos, presupuestos, valores de tasación, precio piso y de publicación, comisiones fijas por tramo, precio máximo del catálogo, y los campos de las pantallas anteriores) muestra los puntos de miles mientras se escribe: `12480000` queda `12.480.000`. El cursor se mantiene donde estaba al escribir en medio del número. Por dentro el valor sigue siendo el número limpio (`12480000`), así que el servidor no cambia. Componente: `InputDinero` en `src/campo-dinero.jsx`; formato en `src/dinero.js` (pruebas en `tests/dinero.test.mjs`). Quedan como números normales los que no son dinero (año, kilometraje, días, plazos, porcentajes y el valor de la UF, que lleva decimales).

## Fichas de inspectores: fotos y ajuste de precios (Jefe Local y Administrador)

En *Comercial → Fichas de inspectores*:
- **Fotos:** cada valorización y cada inspección muestra arriba una galería con **todas las fotos tomadas por el inspector** (en la valorización, agrupadas por pieza y en tamaño grande; se abren a pantalla completa). Las fotos de las inspecciones son las «fotos para el equipo».
- **Ajustar precios:** en una valorización, el Jefe Local (de su local) y el Administrador pueden **corregir el valor comercial estimado y la valorización de cada pieza**. Se ve de inmediato el total y el valor final (valor comercial − valorizaciones) contra el anterior. El resto de la ficha (datos, estados, fotos, observaciones) **no se modifica**. Cada cambio queda guardado en la propia ficha (*Historial de ajustes*, con quién, cuándo y de cuánto a cuánto) y en la *Bitácora* (`valorizacion.ajustar`); el Inspector ve los precios corregidos al abrir su ficha.
- Servidor: `inspecciones.valorizacion_ajustar` (solo supervisor, solo valorizaciones de personas de su local, valores enteros de 0 a 10.000 millones, solo ítems que ya existen en la ficha). Pruebas: `tests/inspecciones-api.test.mjs`.
- **Límite:** si el Inspector tiene esa misma ficha abierta en su pantalla y la guarda después, sus precios antiguos pueden pisar los corregidos; conviene avisarle antes.

## Fotos del inspector desde Tasaciones

En el detalle de una tasación (*Tasaciones → Abrir*), la tarjeta **Inspección** ahora muestra, bajo la inspección vinculada, las **fotos que tomó el inspector** en esa inspección (las «fotos para el equipo»), para el Tasador, quien pidió la tasación, el Jefe Local y el Administrador. Se leen al abrir, así que si el inspector agrega fotos después, aparecen. Al buscar inspecciones de la patente (*Buscar inspecciones de …*) la lista ya sabe cuántas fotos tiene cada una. Del servidor solo salen los **identificadores de las fotos**: nunca los datos del propietario ni el PDF del CAV. Código: `tasaciones.get` y `tasaciones.inspecciones` en `ventas.ts`; pantalla en `crm-tasaciones.jsx`. Pruebas: `tests/tasaciones-api.test.mjs`.

## Estimador: quién publica cada aviso (particular o automotora)

El marcador «⭐ Copiar avisos Chileautos» ahora lee de cada tarjeta quién publica: **Particular**, o **Automotora** (con su nombre y si el vehículo es Usado o Nuevo; en Chileautos aparece como «Automotora X / Vehículo Usado»). En *Ver el detalle del cálculo* hay una columna **Vendedor** (también para los avisos descartados) y un resumen: cuántos de los avisos usados son de particulares y cuántos de automotoras, y lo mismo para los que entran al promedio. **No cambia el cálculo**: es solo información (el promedio sigue usando los mismos avisos). Se comprobó contra la página real de Chileautos (18 de 18 avisos clasificados).

**Importante:** el marcador es un favorito del navegador con el código dentro, así que hay que **reemplazarlo**: arrastra de nuevo el botón «⭐ Copiar avisos Chileautos» a la barra de favoritos (o usa «copiar el código del marcador» y pégalo en la dirección del favorito existente). Con el favorito antiguo, la tabla muestra «—» en Vendedor. Código: `src/chileautos-bookmarklet.js` (`vendedorTipo`, `vendedorNombre`, `condicion`) y la tabla en `App.jsx`. Pruebas: `tests/chileautos-bookmarklet.test.mjs` y `tests/compra-calc.test.mjs`.

## Datos del vehículo por patente (API de Boostr)

Junto a cada campo de **Patente** (estimador de *Tasación de compra*, formularios de vehículo de tasaciones, inspecciones y parte de pago, *Inventario → Nuevo vehículo*) hay un botón **Buscar datos** que completa **marca, modelo, versión y año** (y color, transmisión y combustible si el plan del proveedor los entrega). En el **sitio web**, el formulario «Vende o consigna tu auto» tiene **Buscar los datos de mi auto** (completa marca, modelo y año; el cliente agrega el kilometraje). Siempre quedan editables; si el proveedor no responde, se completan a mano (el CAV y el favorito de patentechile siguen funcionando).

- **Guardado para siempre (requiere `supabase-crm-patentes.sql`):** cada patente consultada con éxito, desde el CRM **o** desde el sitio web, queda guardada **para siempre** en la tabla `patentes_consultadas` (patente, marca, modelo completo, año, tipo, datos técnicos, de dónde vino y cuándo). La próxima vez que alguien la consulte, desde donde sea, se responde desde la base de datos: **no llama al proveedor y no usa el cupo diario**. Las guardadas responden incluso si falta la clave o se agotó el cupo. Sin la tabla, la consulta avisa en vez de gastar cupo sin guardar.
- **Cupo diario** (`BOOSTR_LIMITE_DIARIO`, por defecto 5 = plan gratuito): solo las consultas *nuevas* lo gastan, y es común al CRM y al sitio web. **El sitio web puede gastar como máximo la mitad** (mínimo 1) para que el público nunca deje sin consultas al personal; además hay un freno de 12 consultas por hora por dirección IP en el sitio y de unas 8 por minuto por persona en el CRM.
- **Servidor** (`vehiculos.patente` en `ventas.ts`, `patente` en `publico.ts`; lógica común en `patentes.ts` y reglas en `patentes-core.js`). **La clave vive solo en el servidor** (secreto `BOOSTR_API_KEY`); nunca se pide el dueño, y aunque el proveedor mandara datos de personas o el chasis, no pasan ni se guardan. El sitio web solo recibe marca, modelo y año.
- **Panel Estado:** si está activa, consultas nuevas de hoy (total y del sitio web), y cuántas patentes hay guardadas.
- **Activar:** `npx.cmd supabase secrets set BOOSTR_API_KEY=<tu clave> --project-ref lvcmstvcbbvltompunbr` (y, si contratas un plan con más consultas diarias, `BOOSTR_LIMITE_DIARIO=50`, por ejemplo) y luego `node scripts/deploy-api.mjs`.
- Pruebas: `tests/patentes-core.test.mjs`, `tests/patentes-api.test.mjs`, `tests/datos-patente.test.mjs`.
- **Pendiente de comprobar con la clave real:** los nombres de los campos extra de los planes de pago (versión, transmisión, combustible, color); el plan gratuito entrega marca, modelo, año y tipo.

## Eliminar personas del CRM

En *Usuarios* hay un botón **Eliminar** (solo la cuenta maestra), además de Desactivar. Es un borrado definitivo, por eso tiene seguros:
- La persona debe estar **desactivada** primero (así se cierra su sesión y se comprueba que nadie la necesita).
- Se muestra qué tiene asociado: si tiene **ventas, compras, consignaciones o fichas de inspección/valorizaciones del Inspector, no se puede eliminar** (se perdería el historial y las comisiones): se deja desactivada.
- Lo demás (leads, tareas, tasaciones, inspecciones pedidas, validaciones, avisos) **se conserva pero queda sin responsable**; el aviso lo indica con las cantidades.
- Hay que escribir el nombre completo para confirmar. El RUT queda libre para crear otra persona y la acción queda en la Bitácora (`usuario.eliminar`, sin claves). Servidor: `usuarios.impacto` y `usuarios.delete`; pruebas: `tests/usuarios-eliminar-api.test.mjs`.

## Sitio web · «Vende o consigna tu auto»: todo obligatorio y más datos

- **Todos los campos son obligatorios** (patente, marca, modelo, año, kilometraje, sucursal si hay más de una, nombre, teléfono, **correo** y **comentarios**), y el servidor lo vuelve a exigir.
- **Teléfono con código de área:** lista desplegable de países (Chile +56 por defecto; Argentina, Perú, Bolivia, Colombia, Brasil, México, España, EE. UU./Canadá, etc.) y el número aparte. Se guarda como número internacional (`+56987654321`); en Chile deben ser 9 dígitos (un 0 al comienzo se ignora) y en los demás países entre 6 y 12. Aplica a **todos** los formularios del sitio (consulta, visita, financiamiento y vender), y el botón de WhatsApp del CRM usa ese número tal cual.
- **Datos nuevos del dueño:** **número de dueños**, **¿tiene prenda?** (Sí/No, lista), **¿mantenciones en la marca?** (Sí/No, lista) y **precio esperado ($)** (con puntos de miles). Quedan en el lead (`vehiculo_ofrecido`), en las notas del lead y en la solicitud del Tasador. En el CRM se ven en la ficha del lead y en las secciones de **Compra** y **Consignación** (la prenda aparece en rojo); en la consignación el precio esperado se propone como precio de publicación. El ejecutivo también puede editarlos al crear o editar un lead de compra o consignación (allí son opcionales).
- Sin SQL. Pruebas: `tests/publico-core.test.mjs` y `tests/publico-api.test.mjs`.

## Reparto automático de leads (sitio web y CRM)

Cada lead nuevo se asigna solo, **de forma rotativa: le toca a quien lleva más tiempo sin recibir un lead de su grupo** (quien nunca ha recibido va primero). Solo entran las personas **activas del mismo local** con la habilitación que corresponde:
- **Ventas** (consulta, visita y financiamiento del sitio web, y leads de venta creados en el CRM) → solo ejecutivos con **Ventas**.
- **Compra** (cliente que quiere vendernos su auto) → solo con **Compras**. **Consignación** → solo con **Consignaciones**.
- **Cada grupo rota por separado**: «ventas» por un lado y «compras y consignaciones» por otro. Recibir un lead de venta no quita el turno en las compras ni al revés.
- Si nadie está habilitado para ese tipo, el lead queda **sin asignar** y se avisa a los Jefes Local (nunca va a alguien sin la habilitación).
- Lo mismo rige para el reparto al crear leads en el CRM, la reasignación automática y la reasignación en lote. Código: `grupoDeReparto` (`compras-core.js`), `ultimasAsignaciones` (`ventas.ts`) y `publico.ts`. Pruebas: `tests/reparto-leads-api.test.mjs`.

## Habilitaciones del Ejecutivo y «Cambiar mi auto por otro»

- **Ventas por defecto:** todo Ejecutivo nuevo nace con la habilitación de **Ventas** (también al sumarle el rol Ejecutivo a una persona que ya existía). En el formulario de Usuarios viene marcada; si el Administrador la desmarca a propósito, se respeta. **Compras y Consignaciones** nacen desactivadas.
- **Jefe Local → pestaña «Equipo»** (en Comercial; también la ve el Administrador): lista a los ejecutivos de su local con interruptores para **activar o quitar Compras y Consignaciones**. Los cambios aplican en segundos y quedan en la Bitácora (`usuario.habilitar`). El Jefe Local **no** puede tocar Ventas (la maneja el Administrador), ni a personas de otro local. Servidor: `equipo.habilitaciones` y `equipo.habilitar`. Pruebas: `tests/habilitaciones-api.test.mjs`.
- **Sitio web → «Cambiar mi auto por este»** (botón en la ficha de cada vehículo): el cliente indica los datos de su auto actual (patente con «Buscar datos», marca, modelo, año, kilometraje, dueños, prenda, mantenciones y precio esperado; todo obligatorio, con correo y comentarios) y el auto que le interesa. Se crea un **lead de venta** (va al reparto rotativo de **Ventas**) con su auto como **vehículo en parte de pago**, y una **tasación de su auto** ligada al lead queda en la cola de los Tasadores: al completarse, su valor queda como parte de pago y como tope en la cotización. El ejecutivo y el cliente reciben los mismos avisos por correo que en las demás solicitudes.
