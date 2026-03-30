# 🥩 Karnal KDS — Panel de Producción Multi-Proveedor

Panel de producción estilo Uber Eats para Karnal. Cada proveedor ve solo sus pedidos en tiempo real.

---

## ¿Qué hace esta app?

1. Shopify recibe un pedido → envía los datos automáticamente a esta app
2. La app separa el pedido por proveedor (campo "Vendor" del producto)
3. Cada proveedor ve en su pantalla solo lo que le corresponde preparar
4. Tú en Karnal ves el panel admin con el estado consolidado de todos

---

## Deploy en Railway (15 minutos, sin código)

### Paso 1 — Crear cuenta en Railway
1. Ve a **railway.app**
2. Clic en "Start a New Project" → "Sign up with GitHub"
3. Crea una cuenta gratuita (no necesitas tarjeta de crédito para empezar)

### Paso 2 — Subir la app
1. En Railway, clic en **"New Project"**
2. Selecciona **"Deploy from GitHub repo"**
3. Sube esta carpeta como repositorio (o usa el botón de drag & drop si está disponible)

**Alternativa más simple:** usa Railway CLI
```
npm install -g @railway/cli
railway login
railway init
railway up
```

### Paso 3 — Configurar variables de entorno
En Railway → tu proyecto → **Variables**, agrega:

| Variable | Valor | Descripción |
|---|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | (lo obtienes en Shopify) | Seguridad del webhook |
| `ADMIN_KEY` | (elige una clave segura) | Contraseña del panel admin |
| `PORT` | `3000` | Puerto del servidor |

Puedes también personalizar los tokens de cada proveedor:
| `TOKEN_TORO_NEGRO` | (cadena aleatoria) | Token de acceso Toro Negro |
| `TOKEN_PROVEEDOR_2` | (cadena aleatoria) | Token de acceso Proveedor 2 |

Si no configuras los tokens, la app los genera automáticamente al arrancar (los verás en los logs de Railway).

### Paso 4 — Obtener tu URL pública
Railway te da una URL del tipo: `https://karnal-kds.up.railway.app`

Anótala — la necesitas para el siguiente paso.

---

## Configurar Shopify (5 minutos)

### Paso 1 — Etiquetar productos por proveedor
1. Ve a **Admin Shopify → Productos**
2. Clic en **"Editar productos"** (edición masiva)
3. Agrega la columna **"Proveedor"**
4. Asigna el proveedor a cada producto:
   - Carnes de Toro Negro → escribe exactamente: `Toro Negro`
   - Productos de otro proveedor → `Proveedor 2` (o el nombre que definas)

⚠️ El nombre debe coincidir exactamente con lo configurado en la app.

### Paso 2 — Crear el webhook en Shopify
1. Ve a **Admin Shopify → Configuración → Notificaciones**
2. Baja hasta **"Webhooks"**
3. Clic en **"Crear webhook"**
4. Configura:
   - **Evento:** Creación de pedido
   - **Formato:** JSON
   - **URL:** `https://TU-URL.railway.app/webhook/orders/create`
5. Copia el **"Secreto del webhook"** que aparece
6. Ve a Railway → Variables → pega ese secreto en `SHOPIFY_WEBHOOK_SECRET`

---

## URLs de acceso

Una vez desplegado:

| Panel | URL | Para quién |
|---|---|---|
| Admin Karnal | `https://tu-url.railway.app/panel/admin.html?key=TU_ADMIN_KEY` | Solo tú |
| Toro Negro | `https://tu-url.railway.app/panel/vendor.html?token=TOKEN_TORO_NEGRO` | Carniceros Toro Negro |
| Proveedor 2 | `https://tu-url.railway.app/panel/vendor.html?token=TOKEN_PROVEEDOR_2` | Proveedor 2 |

Los tokens los encuentras en:
- Los **logs de Railway** al arrancar la app (los imprime en consola)
- O en el panel admin → sección "Links de acceso por proveedor"

**Recomendación:** Guarda la URL de cada proveedor como acceso directo en el teléfono de cada uno. Es una URL simple, no necesitan instalar nada.

---

## Agregar un proveedor nuevo

Edita el archivo `src/server.js`, sección `INITIAL_VENDORS`:

```javascript
const INITIAL_VENDORS = [
  { name: 'Toro Negro',    slug: 'toro-negro',    color: '#D85A30' },
  { name: 'Nuevo Proveedor', slug: 'nuevo-proveedor', color: '#7F77DD' },
  // ... agrega los que necesites
];
```

Luego en Shopify, asigna `Nuevo Proveedor` como Vendor en los productos correspondientes.

---

## Probar antes de conectar Shopify

Desde el panel admin, botón **"+ Pedido de prueba"** — genera un pedido ficticio de Toro Negro para que puedas ver cómo funciona sin necesitar una compra real.

---

## Stack técnico
- Node.js + Express (backend liviano)
- HTML/CSS/JS vanilla (sin frameworks — carga instantánea en celulares)
- Storage en memoria (suficiente para el volumen de Karnal; migrar a SQLite si crece)
- Polling cada 8 segundos (tiempo real suficiente para producción de carnicería)

---

## Preguntas frecuentes

**¿Qué pasa si se cae el servidor?**
Railway reinicia automáticamente. Los pedidos en memoria se pierden — en producción real considera agregar persistencia con SQLite (puedo implementarlo si lo necesitas).

**¿Pueden los proveedores ver precios o datos del cliente?**
No. Solo ven número de pedido, producto, corte, gramaje y cantidad. Sin precios ni datos personales del cliente.

**¿Funciona en celular?**
Sí. El panel de proveedor está diseñado para pantallas de tablet o celular en modo landscape.

**¿Cómo le paso la URL al proveedor?**
Cópiala desde el panel admin y envíala por WhatsApp. Ellos la guardan como favorito en el navegador. No necesitan instalar nada.
