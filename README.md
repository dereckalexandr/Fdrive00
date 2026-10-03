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
