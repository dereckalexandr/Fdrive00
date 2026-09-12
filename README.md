# Drive Futuro — Plataforma de gestión automotriz

Aplicación React (Vite) para gestionar producción mensual de ejecutivos,
inspecciones y tasaciones de vehículos, y pre liquidaciones, con perfiles
de Administrador, Ejecutivo e Inspector.

## ⚠️ Léeme primero: limitación de almacenamiento

Este proyecto nació como un *artifact* de Claude, donde los datos se
guardaban con una API propia de Claude (`window.storage`). Esa API no
existe fuera de Claude, así que aquí fue reemplazada por un **shim**
(`src/storage-shim.js`) que usa `localStorage` del navegador.

Esto significa que, tal como está, la app funciona perfectamente para
**probarla o usarla tú solo/a en un mismo navegador**, pero:

- Los datos **no se comparten** entre distintos dispositivos o navegadores.
- El administrador y los ejecutivos/inspectores deben usar el **mismo
  navegador, en el mismo computador**, para ver los mismos datos.
- Si limpias el caché del navegador, se pierden los datos.

Para un uso real con varias personas en distintos dispositivos, necesitas
reemplazar `src/storage-shim.js` por llamadas a un backend real (ver
sección "Siguiente paso: backend real" más abajo).

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

## Siguiente paso: backend real (recomendado para producción)

Si vas a usar esta plataforma con varias personas en distintos
dispositivos (lo normal para una empresa), `localStorage` no es
suficiente. Los pasos generales son:

1. Elegir una base de datos con backend gestionado, por ejemplo
   [Supabase](https://supabase.com) (Postgres + autenticación incluida)
   o [Firebase](https://firebase.google.com).
2. Crear tablas/colecciones equivalentes a las claves que usa hoy la
   app: `vendors`, `inspectors`, `records`, `afp_config`, `uf_valor`,
   `admin_auth`, más las inspecciones y tasaciones guardadas con
   prefijo `inspeccion::` y `tasacion::`.
3. Reemplazar las funciones dentro de `src/App.jsx` que llaman a
   `window.storage.get/set/list/delete` (son fáciles de ubicar, buscan
   ese texto) por llamadas a la API de esa base de datos.
4. Mover la autenticación de administrador a ese backend, para que la
   clave nunca quede visible en el código que se descarga al navegador.
5. (Opcional) agregar envío real de correos de verificación/recuperación
   con un servicio como SendGrid, Postmark o Resend, ya que en el
   navegador no es posible enviar correos directamente.

## Estructura del proyecto

```
drive-futuro/
├── index.html          # Punto de entrada HTML
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json          # Config explícita de build/output para Vercel
├── src/
│   ├── main.jsx         # Monta la app e instala el shim de almacenamiento
│   ├── App.jsx          # Toda la plataforma (componente principal)
│   ├── storage-shim.js  # Reemplazo de window.storage usando localStorage
│   └── index.css        # Estilos base + Tailwind
└── README.md
```
# Fdrive02
