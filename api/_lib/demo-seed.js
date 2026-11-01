// Demo seed for POST /api/team/demo/setup: the CampusEats sample app (the
// sandboxed demo project), two departments, five demo people, and four days
// of context history. The founder is the project owner (a real account).
//
// Context items have a kind. Plan: goal, must_do, must_not, decision, done.
// Progress: progress (department, small features) and checkpoint (central,
// major milestones flagged by a manager and confirmed by the founder).
// `ownerId` / `by` values are person keys; 'founder' means the project owner.

export const DEPARTMENTS = [
  { slug: 'frontend', name: 'Frontend', color: '#7c3aed', paths: ['web/'], manager: 'ananya' },
  { slug: 'backend', name: 'Backend', color: '#0f766e', paths: ['server/', 'config/'], manager: 'vikram' },
];

export const PEOPLE = [
  { key: 'ananya', name: 'Ananya', role: 'admin', department: 'frontend' },
  { key: 'rohan', name: 'Rohan', role: 'worker', department: 'frontend' },
  { key: 'meera', name: 'Meera', role: 'worker', department: 'frontend' },
  { key: 'vikram', name: 'Vikram', role: 'admin', department: 'backend' },
  { key: 'arjun', name: 'Arjun', role: 'worker', department: 'backend' },
];

export const SCOPE_VERSIONS = { central: 2, frontend: 5, backend: 3 };

const once = (content, why, by, hoursAgo) => [{ content, why, by, hoursAgo }];

export const SECTIONS = [
  // ================================================================ central plan
  {
    id: 'c-goal', scope: 'central', kind: 'goal', title: 'Product goal', ownerId: 'founder',
    tags: ['*', 'goal', 'student', 'order'],
    history: once('Students order food from campus canteens on their phones between lectures and pick it up without queueing.',
      'Agreed at project kickoff.', 'founder', 96),
  },
  {
    id: 'c-target-users', scope: 'central', kind: 'goal', title: 'Target users', ownerId: 'founder',
    tags: ['user', 'student', 'mobile', 'audience'],
    history: once('College students on campus (18 to 24), ordering on their phones between lectures. Typical order is ₹40 to ₹200, several times a week. Speed matters more than choice.',
      'Agreed at project kickoff.', 'founder', 96),
  },
  {
    id: 'c-core-features', scope: 'central', kind: 'done', title: 'Version 1 is done when', ownerId: 'founder',
    tags: ['feature', 'menu', 'cart', 'checkout', 'tracking', 'order'],
    history: [
      { content: 'Students can browse the menu, add to a cart and check out.', why: 'Agreed at project kickoff.', by: 'founder', hoursAgo: 96 },
      { content: 'Students can browse the menu, add to a cart, check out and pay, and follow their order live (placed → preparing → ready → collected).',
        why: 'Students asked to know when food is ready so they do not wait at the counter.', by: 'founder', hoursAgo: 70 },
    ],
  },
  {
    id: 'c-payment-method', scope: 'central', kind: 'decision', title: 'Payment method', ownerId: 'founder',
    tags: ['payment', 'pay', 'card', 'upi', 'checkout', 'gateway', 'method'],
    guardrails: [{ phrase: 'cash', note: 'Cash on delivery is not offered. Students pay online at checkout.' }],
    history: once('Students pay by debit or credit card through the CampusPay payment gateway at checkout. No cash on delivery.',
      'CampusPay already has a contract with the university.', 'founder', 96),
  },
  {
    id: 'c-order-api', scope: 'central', kind: 'decision', title: 'Order API contract', ownerId: 'founder',
    tags: ['api', 'endpoint', 'order', 'status', 'contract', 'tracking'],
    history: once('POST /api/orders { items: [{ menuItemId, qty }] } → { orderId, total }\nGET /api/orders/:id → full order\nOrder status values: placed, preparing, ready, collected.',
      'Shared between Frontend (cart, tracking) and Backend.', 'founder', 90),
  },
  {
    id: 'c-payment-api', scope: 'central', kind: 'decision', title: 'Payment API contract', ownerId: 'founder',
    tags: ['api', 'endpoint', 'payment', 'pay', 'card', 'contract', 'webhook'],
    history: once("POST /api/payments { orderId, method: 'card' } → { paymentId, redirectUrl }\nThe browser goes to redirectUrl (CampusPay hosted card form) and comes back to /checkout?paid=1.\nPayment status values: pending, paid, failed, refunded.",
      'Shared between Frontend (checkout) and Backend.', 'founder', 90),
  },
  {
    id: 'c-tech', scope: 'central', kind: 'must_do', title: 'Tech choices', ownerId: 'founder',
    tags: ['tech', 'stack', 'framework', 'database', 'hosting'],
    guardrails: [{ phrase: 'react', note: 'The student site is plain HTML, CSS and JS with no build step.' }],
    history: once('Student site: plain HTML, CSS and JS, no build step. API: Node + Express. Database: Postgres. Hosted on the campus cloud.',
      'Keep it simple so student volunteers can maintain it.', 'founder', 96),
  },
  {
    id: 'c-no-card-data', scope: 'central', kind: 'must_not', title: 'Never handle card numbers', ownerId: 'founder',
    tags: ['payment', 'card', 'security', 'store'],
    guardrails: [{ phrase: 'card number', note: 'Card numbers never touch CampusEats servers or storage; the gateway handles them.' }],
    history: once('CampusEats never receives, stores or logs card numbers. Payment details go straight to the gateway.',
      'Keeps us out of card-data compliance scope.', 'founder', 96),
  },
  // ================================================================ central progress (checkpoints only)
  {
    id: 'c-cp-menu-cart', scope: 'central', kind: 'checkpoint', title: 'Menu and cart live', ownerId: 'founder',
    tags: ['menu', 'cart'], meta: { flaggedBy: 'ananya', department: 'frontend', confirmedBy: 'founder' },
    history: once('Students can browse the North Canteen menu and build a cart on their phones.',
      'Flagged by Ananya (Frontend) and confirmed by the founder.', 'founder', 60),
  },

  // ================================================================ frontend plan
  {
    id: 'fe-checkout', scope: 'frontend', kind: 'decision', title: 'Checkout page design', ownerId: 'ananya',
    tags: ['checkout', 'payment', 'pay', 'card', 'form', 'page', 'upi'],
    history: [
      { content: 'Checkout shows the order summary and a Pay button.', why: 'First sketch.', by: 'ananya', hoursAgo: 90 },
      { content: 'Single page: order summary at the top, then the payment form (card number, expiry, CVV, name on card), then one big "Pay ₹total" button. Mobile first, tap targets at least 44px. Show errors next to the field.',
        why: 'Design review with two student testers.', by: 'ananya', hoursAgo: 60 },
    ],
  },
  {
    id: 'fe-conventions', scope: 'frontend', kind: 'must_do', title: 'Component conventions', ownerId: 'ananya',
    tags: ['*', 'component', 'css', 'style', 'convention', 'button'],
    history: [
      { content: 'Reuse classes from web/css/styles.css (.card, .btn, .pill).', why: 'Initial convention.', by: 'ananya', hoursAgo: 96 },
      { content: 'Reuse classes from web/css/styles.css (.card, .btn, .pill). Each page keeps its JS in web/js/<page>.js.',
        why: 'Pages were sharing one big script.', by: 'ananya', hoursAgo: 26 },
    ],
  },
  {
    id: 'fe-no-frameworks', scope: 'frontend', kind: 'must_not', title: 'No UI frameworks or inline styles', ownerId: 'ananya',
    tags: ['*', 'css', 'style', 'framework'],
    guardrails: [
      { phrase: 'bootstrap', note: 'No UI frameworks or CSS libraries. Reuse web/css/styles.css.' },
      { phrase: 'tailwind', note: 'No UI frameworks or CSS libraries. Reuse web/css/styles.css.' },
      { phrase: 'inline style', note: 'No inline styles. Add a class to web/css/styles.css instead.' },
    ],
    history: [
      { content: 'No UI frameworks or CSS libraries.', why: 'Someone tried adding Bootstrap.', by: 'ananya', hoursAgo: 80 },
      { content: 'No UI frameworks or CSS libraries, and no inline styles: add a class to styles.css.',
        why: 'Inline styles made the dark-mode experiment impossible.', by: 'ananya', hoursAgo: 26 },
    ],
  },
  {
    id: 'fe-tracking', scope: 'frontend', kind: 'goal', title: 'Order tracking page', ownerId: 'ananya',
    tags: ['tracking', 'order', 'status', 'page'],
    history: once('Build web/orders.html: polls GET /api/orders/:id every 10 seconds and shows a 4-step progress bar.',
      'Follows Central › Version 1 is done when (order tracking).', 'ananya', 68),
  },
  {
    id: 'fe-done', scope: 'frontend', kind: 'done', title: 'A frontend page is done when', ownerId: 'ananya',
    tags: ['*', 'page', 'mobile'],
    history: once('It works on a 360px-wide phone, has no console errors, and every button has a tap target of at least 44px.',
      'Most students order on small Android phones.', 'ananya', 70),
  },
  // ================================================================ frontend progress
  {
    id: 'fe-p-menu', scope: 'frontend', kind: 'progress', title: 'Menu page built', ownerId: 'ananya',
    tags: ['menu', 'page'],
    history: once('web/index.html shows the North Canteen menu with an Add button per item (web/js/menu.js).',
      'Rohan finished the menu page.', 'rohan', 72),
  },
  {
    id: 'fe-p-cart', scope: 'frontend', kind: 'progress', title: 'Cart kept between pages', ownerId: 'ananya',
    tags: ['cart', 'checkout'],
    history: once('The cart is saved in localStorage (web/js/cart.js) and the checkout page lists it with the total. Payment step not built yet.',
      'Meera finished the cart.', 'meera', 62),
  },

  // ================================================================ backend plan
  {
    id: 'be-order-api', scope: 'backend', kind: 'decision', title: 'Order API', ownerId: 'vikram',
    tags: ['order', 'api', 'endpoint', 'status', 'route'],
    history: once('server/routes/orders.js. POST /api/orders creates an order (status "placed"). GET /api/orders/:id returns it. Status moves placed → preparing → ready → collected; only canteen staff move it forward.',
      'Implements the Order API contract.', 'vikram', 88),
  },
  {
    id: 'be-schema', scope: 'backend', kind: 'decision', title: 'Database schema', ownerId: 'vikram',
    tags: ['database', 'schema', 'table', 'index', 'column', 'migration', 'payment'],
    history: [
      { content: 'Tables: students, menu_items, orders, order_items.', why: 'First schema.', by: 'vikram', hoursAgo: 92 },
      { content: "Tables: students, menu_items, orders, order_items, payments. payments.method is 'card'; payments.status is pending, paid, failed or refunded. Schema lives in server/db/schema.sql.",
        why: 'Added payments table for the card gateway.', by: 'vikram', hoursAgo: 84 },
    ],
  },
  {
    id: 'be-payment-api', scope: 'backend', kind: 'decision', title: 'Payment endpoints', ownerId: 'vikram',
    tags: ['payment', 'pay', 'card', 'gateway', 'webhook', 'endpoint'],
    history: once('POST /api/payments calls server/payments/gateway.js to create a card payment and returns the hosted card form URL. POST /api/payments/webhook marks the payment paid and the order "preparing".',
      'Implements the Payment API contract.', 'vikram', 86),
  },
  {
    id: 'be-provider', scope: 'backend', kind: 'decision', title: 'Payment provider', ownerId: 'vikram',
    tags: ['payment', 'provider', 'gateway', 'card', 'upi', 'method'],
    history: [
      { content: 'CampusPay Gateway.', why: 'University contract.', by: 'vikram', hoursAgo: 96 },
      { content: 'CampusPay Gateway, cards only (Visa, Mastercard, RuPay) through its hosted card form. Config in config/payments.json.',
        why: 'Hosted form keeps card numbers away from us (Central › Never handle card numbers).', by: 'vikram', hoursAgo: 85 },
    ],
  },
  {
    id: 'be-refunds', scope: 'backend', kind: 'must_do', title: 'Refund rules', ownerId: 'vikram',
    tags: ['refund', 'cancel', 'payment', 'card'],
    guardrails: [{ phrase: 'wallet credit', note: 'Refunds go back to the original payment method, never as wallet credit.' }],
    history: once('Students can cancel within 5 minutes or before the kitchen starts preparing. Refunds go back to the original card in 5 to 7 working days.',
      'Agreed with the canteen manager.', 'vikram', 85),
  },
  {
    id: 'be-no-browser-secrets', scope: 'backend', kind: 'must_not', title: 'No gateway keys in the browser', ownerId: 'vikram',
    tags: ['payment', 'gateway', 'key', 'secret', 'security'],
    guardrails: [{ phrase: 'api key', note: 'Gateway keys stay on the server (config is server-side only).' }],
    history: once('Gateway keys and secrets live only on the server. The browser only ever gets a redirect URL or a payment id.',
      'Security review.', 'vikram', 84),
  },
  // ================================================================ backend progress
  {
    id: 'be-p-orders', scope: 'backend', kind: 'progress', title: 'Order endpoints built', ownerId: 'vikram',
    tags: ['order', 'endpoint'],
    history: once('POST /api/orders and GET /api/orders/:id are built in server/routes/orders.js, plus GET /api/menu.',
      'Arjun finished the order and menu routes.', 'arjun', 66),
  },
];

export const SAVED_CARD_JS = `// "Remember this card" on checkout.
// Stores the gateway's card token (never the card number) so returning
// students can pay with one tap.
function rememberCard(token, last4) {
  localStorage.setItem('campuseats-saved-card', JSON.stringify({ token, last4 }));
}

function savedCard() {
  try { return JSON.parse(localStorage.getItem('campuseats-saved-card') || 'null'); } catch { return null; }
}

function renderSavedCard() {
  const card = savedCard();
  const el = document.getElementById('saved-card');
  if (!el || !card) return;
  el.innerHTML = '<label><input type="radio" name="pay" checked> Pay with card ending ' + card.last4 + '</label>';
}
`;

export const SAMPLE_FILES = {
  "README.md": "# CampusEats\n\nFood ordering for a college campus. Students browse the canteen menu, add items\nto a cart, check out and track their order.\n\n- `web/`: the student-facing site (plain HTML, CSS and JS, no build step). Owned by Frontend.\n- `server/routes/`, `server/db/`: order and menu API plus database schema. Owned by Backend.\n- `server/payments/`, `config/payments.json`: payment integration. Owned by Payments.\n",
  "config/payments.json": "{\n  \"provider\": \"CampusPay Gateway\",\n  \"methods\": [\"card\"],\n  \"currency\": \"INR\",\n  \"gatewayUrl\": \"https://sandbox.campuspay.example\"\n}\n",
  "server/db/schema.sql": "-- CampusEats database schema (Postgres).\ncreate table students (\n  id          serial primary key,\n  name        text not null,\n  email       text unique not null\n);\n\ncreate table menu_items (\n  id          serial primary key,\n  name        text not null,\n  price_inr   integer not null,\n  available   boolean not null default true\n);\n\ncreate table orders (\n  id          serial primary key,\n  student_id  integer not null references students(id),\n  status      text not null default 'placed',  -- placed, preparing, ready, collected\n  total_inr   integer not null,\n  created_at  timestamptz not null default now()\n);\n\ncreate table order_items (\n  order_id     integer not null references orders(id),\n  menu_item_id integer not null references menu_items(id),\n  qty          integer not null check (qty > 0)\n);\n\ncreate table payments (\n  id          serial primary key,\n  order_id    integer not null references orders(id),\n  method      text not null,                    -- 'card'\n  status      text not null default 'pending',  -- pending, paid, failed, refunded\n  gateway_ref text\n);\n",
  "server/payments/gateway.js": "// Payment gateway integration. Cards only, via the gateway's hosted card form.\nconst config = require('../../config/payments.json');\n\nasync function createPayment(order) {\n  // Creates a card payment intent with the gateway.\n  return {\n    method: 'card',\n    amountInr: order.total,\n    currency: config.currency,\n    provider: config.provider,\n    redirectUrl: `${config.gatewayUrl}/pay?order=${order.id}`,\n  };\n}\n\nasync function refund(paymentId, reason) {\n  // Refunds go back to the original card within 5-7 working days.\n  return { paymentId, status: 'refund_requested', reason };\n}\n\nmodule.exports = { createPayment, refund };\n",
  "server/routes/menu.js": "const express = require('express');\nconst db = require('../db');\n\nconst router = express.Router();\n\n// GET /api/menu -> today's menu items\nrouter.get('/', async (_req, res) => {\n  res.json(await db.listMenuItems());\n});\n\nmodule.exports = router;\n",
  "server/routes/orders.js": "// Order API (see the shared API contract in the central context).\nconst express = require('express');\nconst db = require('../db');\n\nconst router = express.Router();\n\n// POST /api/orders  { items: [{ menuItemId, qty }] } -> { orderId, total }\nrouter.post('/', async (req, res) => {\n  const { items } = req.body;\n  if (!Array.isArray(items) || items.length === 0) {\n    return res.status(400).json({ error: 'Order needs at least one item' });\n  }\n  const order = await db.createOrder({ studentId: req.user.id, items });\n  res.status(201).json({ orderId: order.id, total: order.total });\n});\n\n// GET /api/orders/:id -> full order\nrouter.get('/:id', async (req, res) => {\n  const order = await db.getOrder(req.params.id);\n  if (!order) return res.status(404).json({ error: 'Order not found' });\n  res.json(order);\n});\n\nmodule.exports = router;\n",
  "web/checkout.html": "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <title>CampusEats · Checkout</title>\n  <link rel=\"stylesheet\" href=\"css/styles.css\" />\n</head>\n<body>\n  <header class=\"topbar\">\n    <a class=\"brand\" href=\"index.html\">CampusEats</a>\n    <nav>\n      <a href=\"index.html\">Menu</a>\n      <a href=\"checkout.html\">Checkout <span id=\"cart-count\" class=\"pill\">0</span></a>\n    </nav>\n  </header>\n\n  <main class=\"container\">\n    <h1>Your order</h1>\n    <ul id=\"cart-items\" class=\"list\"></ul>\n    <p class=\"total\">Total: <strong id=\"cart-total\">₹0</strong></p>\n\n    <!-- Payment step: not built yet. -->\n    <div class=\"card muted\">Payment coming soon.</div>\n  </main>\n\n  <script src=\"js/cart.js\"></script>\n  <script>renderCart();</script>\n</body>\n</html>\n",
  "web/index.html": "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <title>CampusEats · Menu</title>\n  <link rel=\"stylesheet\" href=\"css/styles.css\" />\n</head>\n<body>\n  <header class=\"topbar\">\n    <a class=\"brand\" href=\"index.html\">CampusEats</a>\n    <nav>\n      <a href=\"index.html\">Menu</a>\n      <a href=\"checkout.html\">Checkout <span id=\"cart-count\" class=\"pill\">0</span></a>\n    </nav>\n  </header>\n\n  <main class=\"container\">\n    <h1>Today at the North Canteen</h1>\n    <p class=\"muted\">Order ahead and skip the queue between lectures.</p>\n    <section id=\"menu\" class=\"grid\"></section>\n  </main>\n\n  <script src=\"js/cart.js\"></script>\n  <script src=\"js/menu.js\"></script>\n</body>\n</html>\n",
  "web/css/styles.css": ":root {\n  --brand: #e85d04;\n  --ink: #1f2933;\n  --muted: #6b7280;\n  --line: #e5e7eb;\n  --bg: #fffaf5;\n}\n* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; color: var(--ink); background: var(--bg); }\n.topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; background: #fff; border-bottom: 1px solid var(--line); }\n.topbar nav a { margin-left: 16px; color: var(--ink); text-decoration: none; }\n.brand { font-weight: 700; color: var(--brand); text-decoration: none; }\n.container { max-width: 760px; margin: 0 auto; padding: 20px; }\n.muted { color: var(--muted); }\n.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }\n.card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 14px; }\n.list { list-style: none; padding: 0; }\n.list li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }\n.pill { background: var(--brand); color: #fff; border-radius: 999px; padding: 0 8px; font-size: 12px; }\n.btn { background: var(--brand); color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }\n.total { font-size: 18px; }\n",
  "web/js/cart.js": "// Cart kept in localStorage so it survives page changes.\nfunction getCart() {\n  try { return JSON.parse(localStorage.getItem('campuseats-cart') || '[]'); } catch { return []; }\n}\n\nfunction saveCart(cart) {\n  localStorage.setItem('campuseats-cart', JSON.stringify(cart));\n  updateCartCount();\n}\n\nfunction addToCart(id, name, price) {\n  const cart = getCart();\n  const line = cart.find((l) => l.id === id);\n  if (line) line.qty += 1; else cart.push({ id, name, price, qty: 1 });\n  saveCart(cart);\n}\n\nfunction cartTotal() {\n  return getCart().reduce((sum, l) => sum + l.price * l.qty, 0);\n}\n\nfunction updateCartCount() {\n  const el = document.getElementById('cart-count');\n  if (el) el.textContent = getCart().reduce((n, l) => n + l.qty, 0);\n}\n\nfunction renderCart() {\n  const list = document.getElementById('cart-items');\n  const cart = getCart();\n  list.innerHTML = cart.length\n    ? cart.map((l) => `<li><span>${l.qty} × ${l.name}</span><span>₹${l.price * l.qty}</span></li>`).join('')\n    : '<li class=\"muted\">Your cart is empty. Add something from the menu.</li>';\n  document.getElementById('cart-total').textContent = `₹${cartTotal()}`;\n  updateCartCount();\n}\n",
  "web/js/menu.js": "// Canteen menu. Later this comes from GET /api/menu.\nconst MENU = [\n  { id: 1, name: 'Masala Dosa', price: 60 },\n  { id: 2, name: 'Veg Thali', price: 90 },\n  { id: 3, name: 'Paneer Wrap', price: 75 },\n  { id: 4, name: 'Cold Coffee', price: 45 },\n];\n\nfunction renderMenu() {\n  const root = document.getElementById('menu');\n  root.innerHTML = MENU.map((item) => `\n    <div class=\"card\">\n      <h3>${item.name}</h3>\n      <p class=\"muted\">₹${item.price}</p>\n      <button class=\"btn\" onclick=\"addToCart(${item.id}, '${item.name}', ${item.price})\">Add</button>\n    </div>`).join('');\n}\n\nrenderMenu();\nupdateCartCount();\n"
};
