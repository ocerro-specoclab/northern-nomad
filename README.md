# Northern Nomad — guía de instalación

App personal de cartera con histórico y snapshots de consenso, sincronizada entre **móvil y ordenador** gracias a Supabase, y publicada gratis en Vercel.

> No es asesoramiento financiero. Los datos de consenso se introducen a mano (yo te los busco cuando me los pidas). La app no vigila el mercado por su cuenta entre sesiones.

---

## Lo que vas a montar

1. **Supabase** — base de datos gratuita donde vive tu histórico (para que se sincronice).
2. **Vercel** — hosting gratuito que te da una URL pública (móvil + ordenador, mismo enlace).
3. **El código** — ya está todo en esta carpeta.

Tiempo estimado: 20-30 minutos la primera vez. No necesitas saber programar, solo copiar y pegar.

---

## Paso 1 — Crear la base de datos en Supabase

1. Entra en https://supabase.com y crea una cuenta gratis (con GitHub o email).
2. Pulsa **New project**. Ponle nombre (ej. `northern-nomad`), elige una contraseña para la base de datos (guárdala) y la región más cercana. Espera 1-2 min a que se cree.
3. En el menú lateral ve a **SQL Editor → New query**.
4. Abre el archivo `supabase_schema.sql` de esta carpeta, copia TODO su contenido, pégalo y pulsa **Run**. Esto crea las tablas.
5. Ve a **Project Settings → API**. Apunta dos cosas:
   - **Project URL** (algo como `https://abcdxyz.supabase.co`)
   - **anon public key** (una cadena larga que empieza por `eyJ...`)

Estas dos claves las necesitas en el Paso 3.

---

## Paso 2 — Subir el código a GitHub

Vercel despliega desde GitHub, así que primero sube el proyecto.

1. Crea una cuenta en https://github.com si no tienes.
2. Crea un repositorio nuevo (botón **New**), por ejemplo `northern-nomad`. **Déjalo privado.**
3. Sube esta carpeta. La forma más fácil sin línea de comandos: en la página del repo vacío, pulsa **uploading an existing file** y arrastra todos los archivos de esta carpeta (menos `node_modules` si existe).

> Importante: el archivo `.gitignore` ya evita que se suban las claves. Nunca subas un archivo `.env.local` con claves reales a un repo.

---

## Paso 3 — Desplegar en Vercel

1. Entra en https://vercel.com y regístrate **con tu cuenta de GitHub**.
2. Pulsa **Add New → Project** e importa el repositorio `northern-nomad`.
3. Vercel detecta que es un proyecto Vite automáticamente. Antes de desplegar, abre **Environment Variables** y añade las dos del Paso 1:
   - `VITE_SUPABASE_URL` = tu Project URL
   - `VITE_SUPABASE_ANON_KEY` = tu anon public key
4. Pulsa **Deploy**. En 1-2 minutos te da una URL tipo `https://northern-nomad-xxx.vercel.app`.

¡Esa URL es tu app! Funciona igual en el navegador del ordenador y del móvil.

---

## Paso 4 — Instalarla como "app" en el móvil

Abre la URL de Vercel en el móvil:
- **iPhone (Safari):** botón compartir → "Añadir a pantalla de inicio".
- **Android (Chrome):** menú ⋮ → "Añadir a pantalla principal".

Te queda un icono como si fuera una app nativa. Como los datos están en Supabase, lo que registres en el móvil aparece en el ordenador y al revés.

---

## Cómo usarla

1. Pestaña **Captura**: mete tus valores (símbolo, cantidad, precio de compra, precio actual, objetivo y rating). El rating y el objetivo me los pides a mí y los copias.
2. **Guardar captura**: registra el snapshot del consenso de hoy.
3. La próxima vez que metas una captura y falte un valor, la app te pregunta si lo vendiste y lo apunta en el histórico con su ganancia/pérdida.
4. Pestaña **Histórico**: ves toda la evolución (snapshots, compras, ventas).

---

## Desarrollo en local (opcional)

Si quieres probarlo en tu ordenador antes de desplegar:

```bash
npm install
cp .env.example .env.local   # y edita .env.local con tus claves reales
npm run dev
```

Abre http://localhost:5173

---

## Límites honestos de este prototipo

- **El consenso es manual.** La versión con datos automáticos (Finnhub/Yahoo) es el backend descrito en el documento de arquitectura, un paso posterior.
- **No hay alertas automáticas.** El correo diario que te avisa solo es un servicio aparte (Paso 2 del plan), no incluido aquí.
- **Sin login.** Es solo tu cartera. Cualquiera con tu URL y conocimientos podría leer/escribir; para uso personal está bien, pero no metas datos sensibles.
