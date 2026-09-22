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
- **`src/firebase-storage.js`** — usa **Firebase Firestore**, una base
  de datos real en la nube. Con esto, el administrador y todos los
  ejecutivos/inspectores SÍ ven la misma información, desde cualquier
  dispositivo. **Esta es la opción recomendada para uso real.**

`src/main.jsx` detecta automáticamente cuál usar: si encuentra las
variables de entorno de Firebase (`VITE_FIREBASE_*`), usa Firestore;
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

## Configurar Firebase (recomendado, paso a paso)

### 1. Crear el proyecto en Firebase

1. Entra a [console.firebase.google.com](https://console.firebase.google.com)
   con tu cuenta de Google.
2. "Agregar proyecto" → ponle un nombre (ej. "drive-futuro") → puedes
   desactivar Google Analytics (no lo necesitas) → "Crear proyecto".

### 2. Crear la base de datos Firestore

1. En el menú lateral del proyecto: **Compilación → Firestore Database**.
2. "Crear base de datos".
3. Elige la ubicación del servidor (cualquiera cercana a Chile, ej.
   `southamerica-east1`) → Siguiente.
4. Modo de seguridad: elige **"Modo de producción"** (no "modo de
   prueba"). Vamos a configurar las reglas manualmente en el paso 5.

### 3. Registrar una app web y obtener las credenciales

1. En la página principal del proyecto (ícono de engranaje ⚙️ arriba a
   la izquierda → "Configuración del proyecto").
2. Baja hasta "Tus apps" → clic en el ícono `</>` (Web).
3. Ponle un apodo (ej. "drive-futuro-web") → "Registrar app" (no hace
   falta activar Firebase Hosting, ya usamos Vercel).
4. Firebase te muestra un bloque `firebaseConfig = { apiKey: "...", ... }`.
   **Copia esos valores**, los vas a necesitar en el paso 4.

### 4. Configurar las variables de entorno

**Para desarrollo local:**
1. Copia el archivo `.env.example` y renómbralo a `.env.local`.
2. Pega ahí los valores que copiaste de Firebase, uno por línea:
   ```
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=drive-futuro-xxxx.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=drive-futuro-xxxx
   VITE_FIREBASE_STORAGE_BUCKET=drive-futuro-xxxx.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abc123
   ```
3. Corre `npm run dev` — en la consola del navegador debería aparecer
   "Almacenamiento: Firebase Firestore" en vez del aviso de localStorage.

**Para producción en Vercel:**
1. Entra a tu proyecto en Vercel → **Settings → Environment Variables**.
2. Agrega, una por una, las mismas 6 variables de arriba (mismo nombre,
   mismo valor). Selecciónalas para los tres ambientes (Production,
   Preview, Development).
3. Ve a **Deployments** → abre el último deployment → menú "···" →
   **Redeploy** (las variables de entorno solo se aplican en un
   deployment nuevo, no en los ya existentes).

### 5. Configurar las reglas de seguridad de Firestore

Por defecto, en "modo de producción" Firestore bloquea todo acceso.
Necesitas reglas que permitan leer/escribir la colección que usa la app.

1. En Firebase Console: **Firestore Database → Reglas**.
2. Reemplaza el contenido por:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /kv_store/{document} {
         allow read, write: if true;
       }
     }
   }
   ```
3. "Publicar".

   ⚠️ **Importante sobre seguridad**: esta regla (`allow read, write: if
   true`) permite que cualquiera que conozca la URL de tu Firestore
   pueda leer y modificar los datos directamente, sin pasar por tu app
   ni por la clave de administrador. Es aceptable para partir y probar,
   pero para un uso real con datos sensibles (RUT, sueldos, AFP) el
   siguiente paso recomendado es agregar **Firebase Authentication** y
   restringir las reglas para que solo usuarios autenticados puedan
   leer/escribir. Este es un paso adicional que no cubre esta guía,
   pero es el que seguiría después de validar que todo funciona.

### 6. Probar

1. Local: `npm run dev`, entra como administrador, crea un ejecutivo.
2. Abre la consola de Firebase → Firestore Database → deberías ver la
   colección `kv_store` con un documento nuevo (la clave `vendors`).
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

Con Firebase ya conectado, los datos quedan compartidos y persistentes.
Los siguientes refuerzos quedan pendientes si más adelante quieres
subir el nivel de seguridad:

1. Agregar **Firebase Authentication** y restringir las reglas de
   Firestore a usuarios autenticados (hoy son abiertas, ver paso 5 de
   la configuración de Firebase más arriba).
2. Mover la autenticación de administrador (hoy es un hash guardado en
   Firestore, validado en el navegador) a una función de backend
   (ej. Cloud Functions de Firebase), para que la lógica de validación
   no viva en el código que descarga el navegador.
3. Agregar envío real de correos de verificación/recuperación con un
   servicio como SendGrid, Postmark o Resend (hoy la recuperación es
   por código, ya que el navegador no puede enviar correos directamente).

## Estructura del proyecto

```
drive-futuro/
├── index.html            # Punto de entrada HTML
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json            # Config explícita de build/output para Vercel
├── .env.example           # Variables de entorno de Firebase (plantilla)
├── src/
│   ├── main.jsx            # Monta la app; elige Firebase o localStorage
│   ├── App.jsx              # Toda la plataforma (componente principal)
│   ├── firebase-storage.js  # Almacenamiento real con Firestore
│   ├── storage-shim.js      # Respaldo con localStorage (sin Firebase)
│   └── index.css            # Estilos base + Tailwind
└── README.md
```
