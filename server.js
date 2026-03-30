const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || ''; 

// ── In-memory store (reemplazar por DB en producción) ──────────────────────
const store = {
  orders: {},      // { orderId: orderObject }
  vendors: {},     // { vendorSlug: { name, token, color } }
};

// ── Vendors iniciales (editar según tus proveedores) ───────────────────────
const INITIAL_VENDORS = [
  { name: 'Toro Negro',   slug: 'toro-negro',   color: '#D85A30' },
  { name: 'Proveedor 2',  slug: 'proveedor-2',  color: '#1D9E75' },
  { name: 'Proveedor 3',  slug: 'proveedor-3',  color: '#7F77DD' },
  { name: 'Proveedor 4',  slug: 'proveedor-4',  color: '#378ADD' },
];

INITIAL_VENDORS.forEach(v => {
  const token = process.env[`TOKEN_${v.slug.toUpperCase().replace(/-/g,'_')}`]
    || crypto.randomBytes(16).toString('hex');
  store.vendors[v.slug] = { ...v, token };
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(__dirname));

// ── Helpers ────────────────────────────────────────────────────────────────
function slugify(str) {
  return (str || 'sin-proveedor')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!SHOPIFY_SECRET) return true; // dev mode
  const hash = crypto
    .createHmac('sha256', SHOPIFY_SECRET)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader || ''));
}

function parseShopifyOrder(raw) {
  const linesByVendor = {};
  (raw.line_items || []).forEach(item => {
    const vendorRaw = item.vendor || item.product_type || 'Sin proveedor';
    const slug = slugify(vendorRaw);
    if (!linesByVendor[slug]) {
      linesByVendor[slug] = { vendorName: vendorRaw, vendorSlug: slug, items: [] };
    }
    const variants = (item.variant_title || '').split(' / ').filter(Boolean);
    linesByVendor[slug].items.push({
      id: item.id,
      name: item.name.replace(/ - .*/, ''),
      corte: variants[0] || null,
      gramaje: variants[1] || null,
      qty: item.quantity,
      sku: item.sku || '',
      status: 'pendiente',
    });
  });
  return linesByVendor;
}

// ── Webhook Shopify ────────────────────────────────────────────────────────
app.post('/webhook/orders/create', (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!verifyShopifyHmac(req.body, hmac)) {
    return res.status(401).send('Unauthorized');
  }

  let raw;
  try { raw = JSON.parse(req.body.toString()); }
  catch { return res.status(400).send('Bad JSON'); }

  const orderId = String(raw.id);
  const orderNum = raw.order_number || raw.name || orderId;
  const linesByVendor = parseShopifyOrder(raw);

  const order = {
    id: orderId,
    number: `#${orderNum}`,
    createdAt: new Date().toISOString(),
    customer: `${raw.shipping_address?.first_name || raw.billing_address?.first_name || 'Cliente'} ${raw.shipping_address?.last_name || raw.billing_address?.last_name || ''}`.trim(),
    note: raw.note || '',
    vendors: linesByVendor,
  };

  store.orders[orderId] = order;

  // Auto-registrar vendors nuevos
  Object.keys(linesByVendor).forEach(slug => {
    if (!store.vendors[slug]) {
      const token = crypto.randomBytes(16).toString('hex');
      store.vendors[slug] = {
        name: linesByVendor[slug].vendorName,
        slug,
        color: '#888780',
        token,
      };
    }
  });

  console.log(`[PEDIDO] ${order.number} — ${Object.keys(linesByVendor).length} proveedor(es)`);
  res.status(200).send('OK');
});

// ── API ────────────────────────────────────────────────────────────────────

// Autenticación por token
function authVendor(req, res, next) {
  const token = req.query.token || req.headers['x-vendor-token'];
  const vendor = Object.values(store.vendors).find(v => v.token === token);
  if (!vendor) return res.status(401).json({ error: 'Token inválido' });
  req.vendor = vendor;
  next();
}

function authAdmin(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== (process.env.ADMIN_KEY || 'karnal-admin-2024')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// Pedidos para un vendor específico
app.get('/api/vendor/orders', authVendor, (req, res) => {
  const slug = req.vendor.slug;
  const result = [];

  Object.values(store.orders).forEach(order => {
    const vendorBlock = order.vendors[slug];
    if (!vendorBlock) return;
    const allDone = vendorBlock.items.every(i => i.status === 'listo');
    result.push({
      id: order.id,
      number: order.number,
      customer: order.customer,
      note: order.note,
      createdAt: order.createdAt,
      items: vendorBlock.items,
      allDone,
    });
  });

  // Ordenar: pendientes primero, luego por tiempo
  result.sort((a, b) => {
    if (a.allDone !== b.allDone) return a.allDone ? 1 : -1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  res.json({ vendor: req.vendor.name, orders: result });
});

// Actualizar estado de un ítem
app.patch('/api/vendor/orders/:orderId/items/:itemId', authVendor, (req, res) => {
  const { orderId, itemId } = req.params;
  const { status } = req.body;
  const VALID = ['pendiente', 'preparando', 'listo'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

  const order = store.orders[orderId];
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  const vendorBlock = order.vendors[req.vendor.slug];
  if (!vendorBlock) return res.status(403).json({ error: 'No tienes acceso a este pedido' });

  const item = vendorBlock.items.find(i => String(i.id) === String(itemId));
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

  item.status = status;
  res.json({ ok: true, item });
});

// Marcar todo el pedido como listo
app.patch('/api/vendor/orders/:orderId/complete', authVendor, (req, res) => {
  const order = store.orders[req.params.orderId];
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  const vendorBlock = order.vendors[req.vendor.slug];
  if (!vendorBlock) return res.status(403).json({ error: 'Sin acceso' });
  vendorBlock.items.forEach(i => i.status = 'listo');
  res.json({ ok: true });
});

// Vista admin — todos los pedidos con estado por vendor
app.get('/api/admin/orders', authAdmin, (req, res) => {
  const result = Object.values(store.orders).map(order => {
    const summary = {};
    Object.entries(order.vendors).forEach(([slug, block]) => {
      const total = block.items.length;
      const done = block.items.filter(i => i.status === 'listo').length;
      summary[slug] = { vendorName: block.vendorName, total, done, ready: done === total };
    });
    return { ...order, vendors: undefined, vendorSummary: summary };
  });
  result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders: result });
});

// Lista de vendors con sus tokens (solo admin)
app.get('/api/admin/vendors', authAdmin, (req, res) => {
  res.json({ vendors: Object.values(store.vendors) });
});

// Inyectar pedido de prueba (solo admin / dev)
app.post('/api/admin/test-order', authAdmin, (req, res) => {
  const fake = {
    id: Date.now(),
    order_number: Math.floor(1000 + Math.random() * 9000),
    name: `#${Math.floor(1000 + Math.random() * 9000)}`,
    note: 'Pedido de prueba',
    shipping_address: { first_name: 'Cliente', last_name: 'Prueba' },
    line_items: [
      { id: Date.now()+1, vendor: 'Toro Negro', name: 'Asiento - Corte bistec / 1 kg', variant_title: 'Corte bistec / 1 kg', quantity: 1, sku: 'TN-001' },
      { id: Date.now()+2, vendor: 'Toro Negro', name: 'Asado de tira - Corte 2 dedos / 800 g', variant_title: 'Corte 2 dedos / 800 g', quantity: 2, sku: 'TN-002' },
      { id: Date.now()+3, vendor: 'Toro Negro', name: 'Chorizos parrilleros', variant_title: '', quantity: 4, sku: 'TN-003' },
      ...(req.body?.extraVendor ? [
        { id: Date.now()+4, vendor: req.body.extraVendor, name: 'Producto prueba', variant_title: 'Variante A / 500 g', quantity: 1, sku: 'P2-001' }
      ] : []),
    ]
  };
  req.body = Buffer.from(JSON.stringify(fake));
  req.headers['x-shopify-hmac-sha256'] = '';

  const linesByVendor = parseShopifyOrder(fake);
  const orderId = String(fake.id);
  store.orders[orderId] = {
    id: orderId,
    number: `#${fake.order_number}`,
    createdAt: new Date().toISOString(),
    customer: 'Cliente Prueba',
    note: 'Pedido de prueba generado desde admin',
    vendors: linesByVendor,
  };
  Object.keys(linesByVendor).forEach(slug => {
    if (!store.vendors[slug]) {
      store.vendors[slug] = { name: linesByVendor[slug].vendorName, slug, color: '#888780', token: crypto.randomBytes(16).toString('hex') };
    }
  });

  res.json({ ok: true, orderId, number: store.orders[orderId].number });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🥩 Karnal KDS corriendo en puerto ${PORT}`);
  console.log(`\n── URLs de proveedores ──`);
  Object.values(store.vendors).forEach(v => {
    console.log(`  ${v.name}: /panel/vendor?token=${v.token}`);
  });
  console.log(`\n── Admin ──`);
  console.log(`  Panel admin: /panel/admin?key=${process.env.ADMIN_KEY || 'karnal-admin-2024'}`);
  console.log(`  Pedido de prueba: POST /api/admin/test-order?key=${process.env.ADMIN_KEY || 'karnal-admin-2024'}\n`);
});
