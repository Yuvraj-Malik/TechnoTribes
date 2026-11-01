// SIMULATED agent. Used when no ANTHROPIC_API_KEY is set. It follows the
// same interface as the live agent, with scripted edits for the demo tasks
// (checkout page, order status endpoint, UPI switch) and an honest generic
// fallback for anything else. The UI labels all of its output as simulated.
import { mentions, relevantSections } from '../context.js';

const has = (text, ...words) => mentions(text, words).length === words.length;

function scenarioOf(text, departmentId) {
  if (departmentId === 'frontend' && has(text, 'tracking')) return 'tracking_page';
  if (departmentId === 'frontend' && has(text, 'checkout') && has(text, 'upi')) return 'checkout_upi';
  if (departmentId === 'frontend' && has(text, 'checkout')) return 'checkout_card';
  if (departmentId === 'backend' && has(text, 'upi')) return 'payments_upi';
  if (departmentId === 'backend' && mentions(text, ['remove', 'drop', 'delete']).length && has(text, 'table')) return 'drop_table';
  if (departmentId === 'backend' && has(text, 'status') && mentions(text, ['endpoint', 'api', 'route']).length) return 'order_status';
  return 'generic';
}

const file = (files, path) => files.find((f) => f.path === path)?.content ?? '';

// ---------------------------------------------------------------- scripted file contents
const CHECKOUT_HEAD = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CampusEats · Checkout</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <header class="topbar">
    <a class="brand" href="index.html">CampusEats</a>
    <nav>
      <a href="index.html">Menu</a>
      <a href="checkout.html">Checkout <span id="cart-count" class="pill">0</span></a>
    </nav>
  </header>

  <main class="container">
    <h1>Your order</h1>
    <ul id="cart-items" class="list"></ul>
    <p class="total">Total: <strong id="cart-total">₹0</strong></p>
`;

const CHECKOUT_CARD = `${CHECKOUT_HEAD}
    <form id="pay-form" class="card form" novalidate>
      <h2>Pay by card</h2>
      <div class="field">
        <label for="card-name">Name on card</label>
        <input id="card-name" autocomplete="cc-name" required />
      </div>
      <div class="field">
        <label for="card-number">Card number</label>
        <input id="card-number" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" required />
        <span class="error" id="card-number-error"></span>
      </div>
      <div class="row">
        <div class="field">
          <label for="card-expiry">Expiry</label>
          <input id="card-expiry" placeholder="MM/YY" autocomplete="cc-exp" required />
        </div>
        <div class="field">
          <label for="card-cvv">CVV</label>
          <input id="card-cvv" inputmode="numeric" maxlength="4" autocomplete="cc-csc" required />
        </div>
      </div>
      <button class="btn btn-block" type="submit">Pay <span id="pay-amount">₹0</span></button>
      <p class="muted small">Card details go straight to CampusPay. CampusEats never stores them.</p>
    </form>
  </main>

  <script src="js/cart.js"></script>
  <script src="js/checkout.js"></script>
</body>
</html>
`;

const CHECKOUT_CARD_JS = `// Checkout: card payment form.
renderCart();
document.getElementById('pay-amount').textContent = \`₹\${cartTotal()}\`;

function luhnOk(num) {
  const digits = num.replace(/\\s+/g, '');
  if (!/^\\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

document.getElementById('pay-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const number = document.getElementById('card-number').value;
  const error = document.getElementById('card-number-error');
  error.textContent = luhnOk(number) ? '' : 'Please check the card number.';
  if (error.textContent) return;
  // POST /api/payments { orderId, method: 'card' } -> redirect to CampusPay hosted form
  alert('Redirecting to CampusPay to complete the card payment…');
});
`;

const CHECKOUT_UPI = `${CHECKOUT_HEAD}
    <form id="pay-form" class="card form" novalidate>
      <h2>Pay with UPI</h2>
      <div class="field">
        <label for="upi-id">Your UPI ID</label>
        <input id="upi-id" placeholder="yourname@okbank" autocomplete="off" required />
        <span class="error" id="upi-id-error"></span>
      </div>
      <button class="btn btn-block" type="submit">Pay <span id="pay-amount">₹0</span> with UPI</button>
      <p class="muted small">Works with any UPI app: GPay, PhonePe, Paytm, BHIM.</p>
      <div id="upi-waiting" class="notice hidden">
        Approve the payment request in your UPI app. This page updates when it's done.
      </div>
    </form>
  </main>

  <script src="js/cart.js"></script>
  <script src="js/checkout.js"></script>
</body>
</html>
`;

const CHECKOUT_UPI_JS = `// Checkout: UPI payment (Payment method v2: UPI only).
renderCart();
document.getElementById('pay-amount').textContent = \`₹\${cartTotal()}\`;

const UPI_ID = /^[a-z0-9._-]{2,256}@[a-z]{2,64}$/i;

document.getElementById('pay-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const upiId = document.getElementById('upi-id').value.trim();
  const error = document.getElementById('upi-id-error');
  error.textContent = UPI_ID.test(upiId) ? '' : 'That does not look like a UPI ID (for example name@okbank).';
  if (error.textContent) return;
  // POST /api/payments { orderId, method: 'upi', upiId } -> { paymentId, status: 'pending' }
  // then poll GET /api/payments/:id until status is 'paid' or 'failed'.
  document.getElementById('upi-waiting').classList.remove('hidden');
});
`;

const FORM_CSS = `
/* Forms (checkout) */
.form h2 { margin-top: 0; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; flex: 1; }
.field input { padding: 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 16px; min-height: 44px; }
.row { display: flex; gap: 12px; }
.error { color: #b91c1c; font-size: 13px; min-height: 1em; }
.btn-block { width: 100%; min-height: 48px; font-size: 16px; }
.small { font-size: 13px; }
.notice { margin-top: 12px; padding: 10px; border-radius: 8px; background: #fff7ed; border: 1px solid #fed7aa; }
.hidden { display: none; }
`;

function withFormCss(css) {
  return css.includes('/* Forms (checkout) */') ? css : css.trimEnd() + '\n' + FORM_CSS;
}

const TRACKING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CampusEats · Your order</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <header class="topbar">
    <a class="brand" href="index.html">CampusEats</a>
    <nav><a href="index.html">Menu</a></nav>
  </header>
  <main class="container">
    <h1>Your order</h1>
    <ol id="steps" class="list">
      <li data-step="placed">Placed</li>
      <li data-step="preparing">Preparing</li>
      <li data-step="ready">Ready to collect</li>
      <li data-step="collected">Collected</li>
    </ol>
    <p class="muted">This page updates every 10 seconds.</p>
  </main>
  <script src="js/orders.js"></script>
</body>
</html>
`;

const TRACKING_JS = `// Order tracking: polls the order status every 10 seconds.
const orderId = new URLSearchParams(location.search).get('id');

async function refresh() {
  const res = await fetch(\`/api/orders/\${orderId}/status\`);
  if (!res.ok) return;
  const { status } = await res.json();
  document.querySelectorAll('#steps li').forEach((li) => {
    li.classList.toggle('pill', li.dataset.step === status);
  });
}

refresh();
setInterval(refresh, 10000);
`;

const STATUS_ROUTE = `
// GET /api/orders/:id/status -> { orderId, status, updatedAt }
// Lightweight endpoint for the tracking page, which polls every 10 seconds.
router.get('/:id/status', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ orderId: order.id, status: order.status, updatedAt: order.updatedAt });
});
`;

const UPI_GATEWAY = `// Payment gateway integration. UPI only (Payment method v2), via CampusPay UPI collect.
const config = require('../../config/payments.json');

const UPI_ID = /^[a-z0-9._-]{2,256}@[a-z]{2,64}$/i;

async function createPayment(order, { upiId }) {
  if (!UPI_ID.test(upiId || '')) throw new Error('A valid UPI ID is required');
  // Sends a collect request to the student's UPI app. Status starts 'pending'.
  return {
    method: 'upi',
    amountInr: order.total,
    currency: config.currency,
    provider: config.provider,
    upiId,
    status: 'pending',
  };
}

async function refund(paymentId, reason) {
  // Refunds go back to the student's UPI account within 1 to 3 working days.
  return { paymentId, status: 'refund_requested', reason };
}

module.exports = { createPayment, refund };
`;

const UPI_CONFIG = `{
  "provider": "CampusPay Gateway",
  "methods": ["upi"],
  "currency": "INR",
  "gatewayUrl": "https://sandbox.campuspay.example",
  "upiCollectExpiryMinutes": 5
}
`;

// ---------------------------------------------------------------- the agent
const wait = () => Promise.resolve();

export const mockAgent = {
  mode: 'mock',

  async checkConflicts() {
    // Guardrail matching against the context runs for every agent in tasks.ts;
    // the simulated agent adds no extra judgement of its own.
    await wait();
    return [];
  },

  async plan(input) {
    const s = scenarioOf(input.task, input.department.id);
    const sectionNames = input.sections.map((x) => x.title).join(', ');
    switch (s) {
      case 'checkout_card':
        return {
          understanding: 'Build the payment step of the checkout page: a card form under the order summary, following the Checkout page design and Component conventions.',
          steps: [
            'Replace the "Payment coming soon" placeholder in web/checkout.html with a card form (name, number, expiry, CVV) and one big Pay button.',
            'Add web/js/checkout.js: card number check and the hand-off to CampusPay (Payment API contract v' + (input.sections.find((x) => x.id === 'c-payment-api')?.version ?? 1) + ').',
            'Add form classes to web/css/styles.css (no inline styles, tap targets ≥ 44px).',
          ],
          files: ['web/checkout.html', 'web/js/checkout.js', 'web/css/styles.css'],
        };
      case 'checkout_upi':
        return {
          understanding: 'Build the payment step of the checkout page for UPI only: a UPI ID field and a Pay with UPI button, then wait for approval in the UPI app.',
          steps: [
            'Replace the payment step in web/checkout.html with a UPI ID field and one big "Pay ₹total with UPI" button. No card fields.',
            'Write web/js/checkout.js: UPI ID format check, POST /api/payments with method "upi", show the "approve in your UPI app" notice.',
            'Make sure the form classes exist in web/css/styles.css (no inline styles, tap targets ≥ 44px).',
          ],
          files: ['web/checkout.html', 'web/js/checkout.js', 'web/css/styles.css'],
        };
      case 'drop_table':
        return {
          understanding: 'Remove the payments table: a migration that drops it, and the schema without it.',
          steps: ['Add server/db/migrations/002_drop_payments.sql that drops the payments table.', 'Remove the payments table from server/db/schema.sql.'],
          files: ['server/db/migrations/002_drop_payments.sql', 'server/db/schema.sql'],
        };
      case 'tracking_page':
        return {
          understanding: 'Build the order tracking page: a 4-step progress list that polls the order status every 10 seconds.',
          steps: [
            'Add web/orders.html with the 4 steps (placed, preparing, ready, collected).',
            'Add web/js/orders.js: poll GET /api/orders/:id/status every 10 seconds and highlight the current step.',
            'Add the GET /api/orders/:id/status route to server/routes/orders.js so the page has something to poll.',
          ],
          files: ['web/orders.html', 'web/js/orders.js', 'server/routes/orders.js'],
        };
      case 'order_status':
        return {
          understanding: 'Add GET /api/orders/:id/status so the tracking page can poll the order status cheaply.',
          steps: [
            'Add the route to server/routes/orders.js returning { orderId, status, updatedAt }.',
            'Return 404 for unknown orders, same as GET /api/orders/:id.',
            'Keep status values as in the Order API contract: placed, preparing, ready, collected.',
          ],
          files: ['server/routes/orders.js'],
        };
      case 'payments_upi':
        return {
          understanding: 'Switch CampusEats payments from cards to UPI only.',
          steps: [
            'config/payments.json: allowed methods become ["upi"].',
            'server/payments/gateway.js: create UPI collect requests (validate the UPI ID) instead of card payments.',
            'Update the refund note: refunds go back to the UPI account in 1 to 3 working days.',
          ],
          files: ['config/payments.json', 'server/payments/gateway.js'],
        };
      default: {
        const target = input.files[0]?.path ?? input.fileIndex[0];
        return {
          understanding: `"${input.task}". The simulated agent has no script for this task, so it will only leave a clearly marked note.`,
          steps: [`Add a TODO note describing the task to ${target}.`, `Context considered: ${sectionNames || 'none'}.`],
          files: [target],
        };
      }
    }
  },

  async edit(input) {
    if (input.followUp) return followUpEdit(input);
    const s = scenarioOf(input.task, input.department.id);
    const css = file(input.files, 'web/css/styles.css');
    switch (s) {
      case 'checkout_card':
        return {
          edits: [
            { path: 'web/checkout.html', content: CHECKOUT_CARD },
            { path: 'web/js/checkout.js', content: CHECKOUT_CARD_JS },
            { path: 'web/css/styles.css', content: withFormCss(css) },
          ],
          summary: 'Checkout now has a card payment form under the order summary: name, card number (checked before sending), expiry and CVV, and a big "Pay ₹total" button. Card details go to CampusPay; nothing is stored. New form styles live in styles.css.',
          why: 'Students could not pay yet: checkout stopped at "Payment coming soon". This follows the Checkout page design (card form, one big Pay button, mobile-first) and the Payment API contract (hand-off to the CampusPay hosted form).',
        };
      case 'checkout_upi':
        return {
          edits: [
            { path: 'web/checkout.html', content: CHECKOUT_UPI },
            { path: 'web/js/checkout.js', content: CHECKOUT_UPI_JS },
            { path: 'web/css/styles.css', content: withFormCss(css) },
          ],
          summary: 'Checkout now takes UPI only: a UPI ID field with a format check and a big "Pay ₹total with UPI" button. After paying, students see "Approve the payment request in your UPI app". All card fields are gone.',
          why: 'Payment method changed to UPI only (Central › Payment method v2). This replaces the card form so checkout matches the new payment method and the updated Payment API contract.',
        };
      case 'drop_table': {
        const schema = file(input.files, 'server/db/schema.sql');
        return {
          edits: [
            { path: 'server/db/migrations/002_drop_payments.sql', content: '-- Payments move to the gateway; we keep no payment rows.\ndrop table payments;\n' },
            { path: 'server/db/schema.sql', content: schema.replace(/\ncreate table payments \([\s\S]*?\);\n?/, '\n') },
          ],
          summary: 'Dropped the payments table (migration 002) and removed it from the schema.',
          why: 'Payment state lives in the gateway; the table duplicates it.',
        };
      }
      case 'tracking_page': {
        const orders = file(input.files, 'server/routes/orders.js');
        return {
          edits: [
            { path: 'web/orders.html', content: TRACKING_HTML },
            { path: 'web/js/orders.js', content: TRACKING_JS },
            // Outside Frontend's area: the platform blocks this one.
            { path: 'server/routes/orders.js', content: orders.replace('\nmodule.exports = router;', `${STATUS_ROUTE}\nmodule.exports = router;`) },
          ],
          summary: 'Added the order tracking page (web/orders.html): four steps from placed to collected, refreshed every 10 seconds.',
          why: 'Central › Version 1 is done when (live order tracking) and Frontend › Order tracking page.',
        };
      }
      case 'order_status': {
        const orders = file(input.files, 'server/routes/orders.js');
        return {
          edits: [{ path: 'server/routes/orders.js', content: orders.replace('\nmodule.exports = router;', `${STATUS_ROUTE}\nmodule.exports = router;`) }],
          summary: 'Added GET /api/orders/:id/status. It returns only { orderId, status, updatedAt } and 404 for unknown orders.',
          why: 'The order tracking page polls every 10 seconds; returning the whole order each time is wasteful. A small status endpoint keeps polling cheap.',
        };
      }
      case 'payments_upi':
        return {
          edits: [
            { path: 'config/payments.json', content: UPI_CONFIG },
            { path: 'server/payments/gateway.js', content: UPI_GATEWAY },
          ],
          summary: 'Payments are now UPI only: config allows just "upi", the gateway sends a UPI collect request to the student\'s UPI ID (validated), and refunds go back to the UPI account in 1 to 3 working days.',
          why: 'CampusPay is ending card support for the campus account and most students already pay with UPI. UPI also has lower fees for small canteen orders.',
        };
      default:
        return genericEdit(input, input.task);
    }
  },

  async proposeContextUpdate(input) {
    const text = `${input.title} ${input.summary}`;
    if (input.department.id === 'backend' && has(text, 'upi')) {
      return {
        summary: 'Payments moved from cards to UPI only.',
        obsoleteTerms: ['card'],
        changes: [
          {
            sectionId: 'be-provider',
            newContent: 'CampusPay Gateway, UPI only (any UPI app: GPay, PhonePe, Paytm, BHIM) through UPI collect requests. Cards are no longer accepted. Config in config/payments.json.',
            why: 'Approved change: switch to UPI only.',
          },
          {
            sectionId: 'be-refunds',
            newContent: 'Students can cancel within 5 minutes or before the kitchen starts preparing. Refunds go back to the student\'s UPI account in 1 to 3 working days.',
            why: 'Refunds follow the payment method, which is now UPI.',
          },
        ],
      };
    }
    // Generic: record what was built in the most relevant section of this department.
    const candidates = relevantSections([...input.departmentSections, ...input.centralSections], text, input.department.id).filter((s) => s.scope === input.department.id);
    const target = candidates.find((s) => !s.tags.includes('*')) ?? candidates[0] ?? input.departmentSections[0];
    return {
      summary: input.summary,
      obsoleteTerms: [],
      changes: target ? [{
        sectionId: target.id,
        newContent: `${target.content}\nDone: ${input.summary}`,
        why: `Approved: ${input.title}.`,
      }] : [],
    };
  },

  async rewriteAffected({ changeSummary, obsoleteTerms, sections }) {
    return sections.map((s) => {
      const scripted = UPI_REWRITES[s.id];
      if (scripted && obsoleteTerms.includes('card')) return { sectionId: s.id, newContent: scripted, why: changeSummary };
      return {
        sectionId: s.id,
        newContent: `${s.content}\nUpdate: ${changeSummary} Anything here about ${obsoleteTerms.join(', ')} is outdated.`,
        why: changeSummary,
      };
    });
  },

  /**
   * Reviewer (simulated): flags a progress note that says it replaced or dropped
   * something a plan item covers. It only advises: it can add a flag, never clear one.
   */
  async review({ change, planItems }) {
    const text = `${change.title ?? ''} ${change.content ?? ''}`;
    const replaces = /\b(instead of|replaced|replacing|no longer|dropped|switched)\b/i.test(text);
    if (!replaces) return { flags: [], confident: true };
    // The plan items it touches most (department items first): shared topic words.
    const score = (s) => mentions(text, s.tags.filter((t) => t !== '*')).length;
    const flags = planItems.filter((s) => score(s) > 0)
      .sort((x, y) => score(y) - score(x) || (x.scope === 'central') - (y.scope === 'central'))
      .slice(0, 1)
      .map((s) => ({ itemId: s.id, explanation: `This note says something was replaced or dropped, and it touches "${s.title}" (${s.scope === 'central' ? 'Central' : s.scope}). A person should check it still follows the plan.` }));
    return { flags, confident: true };
  },

  /** Orchestrator (simulated): one draft task per department for a goal; scripted for the tracking demo. */
  async orchestrate({ goal, departments }) {
    if (has(goal, 'track')) {
      return {
        tasks: [
          { department: 'frontend', title: 'Build the order tracking page', description: 'web/orders.html shows the 4 order steps and refreshes every 10 seconds.', planItemIds: ['fe-tracking', 'c-core-features'] },
          { department: 'backend', title: 'Add an order status endpoint', description: 'GET /api/orders/:id/status returns { orderId, status, updatedAt } for the tracking page.', planItemIds: ['be-order-api', 'c-order-api'] },
        ].filter((t) => departments.some((d) => d.id === t.department)),
      };
    }
    return {
      tasks: departments.map((d) => ({
        department: d.id, title: `${d.name}: ${goal}`.slice(0, 120),
        description: `Do the ${d.name} part of: ${goal}. Work in ${d.paths?.join(', ') || 'your area'}.`, planItemIds: [],
      })),
    };
  },

  async adjustTask({ task, changeSummary, obsoleteTerms }) {
    if (obsoleteTerms.includes('card') && has(changeSummary, 'upi')) {
      return task.replace(/\b(a\s+)?(credit\s+|debit\s+)?cards?\b/gi, 'UPI').replace(/\s+/g, ' ').trim();
    }
    return `${task} (updated for: ${changeSummary})`;
  },

  async whatIKnow({ user, department, central, departmentSections, recentLog, task }) {
    const changes = recentLog.filter((e) => e.type === 'context.changed').slice(0, 5);
    return [
      {
        heading: 'The project',
        items: central.map((s) => `${s.title} (v${s.version}): ${firstSentence(s.content)}`),
      },
      {
        heading: `${department.name} decisions I follow`,
        items: departmentSections.map((s) => `${s.title} (v${s.version}): ${firstSentence(s.content)}`),
      },
      {
        heading: 'Recent changes that matter',
        items: changes.length ? changes.map((e) => e.summary) : ['No context changes recently.'],
      },
      {
        heading: `${user.name}'s current work`,
        items: task ? [
          `Task: "${task.text}" (status: ${task.status.replace(/_/g, ' ')}).`,
          task.plan ? `Plan: ${task.plan.understanding}` : 'No plan yet.',
          task.changedFiles.length ? `Changed so far: ${task.changedFiles.join(', ')}.` : 'No files changed yet.',
          ...(task.contextAlert && !task.contextAlert.resolution ? [`Waiting on a decision: ${task.contextAlert.relation}`] : []),
        ] : ['No active task.'],
      },
    ];
  },
};

const firstSentence = (t) => (t.split(/(?<=\.)\s|\n/)[0] ?? t).slice(0, 160);

const UPI_REWRITES = {
  'c-payment-method': 'Students pay with UPI only (any UPI app) through the CampusPay gateway at checkout. Cards are no longer accepted. No cash on delivery.',
  'c-payment-api': "POST /api/payments { orderId, method: 'upi', upiId } → { paymentId, status: 'pending' }\nThe student approves the collect request in their UPI app; the page polls GET /api/payments/:id until the status is paid or failed.\nPayment status values: pending, paid, failed, refunded.",
  'fe-checkout': 'Single page: order summary at the top, then UPI payment: a UPI ID field (name@bank) with a format check and one big "Pay ₹total with UPI" button. After paying, show "Approve the request in your UPI app" and wait for confirmation. Mobile first, tap targets at least 44px. Show errors next to the field.',
  'be-payment-api': "POST /api/payments calls server/payments/gateway.js to send a UPI collect request to the student's UPI ID and returns { paymentId, status: 'pending' }. GET /api/payments/:id returns the status. POST /api/payments/webhook marks the payment paid and the order \"preparing\".",
  'be-schema': "Tables: students, menu_items, orders, order_items, payments. payments.method is 'upi'; payments.upi_id stores the payer's UPI ID; payments.status is pending, paid, failed or refunded. Schema lives in server/db/schema.sql.",
};

function noteFor(path, text) {
  if (path.endsWith('.html')) return `<!-- TODO (simulated agent): ${text} -->\n`;
  if (path.endsWith('.css')) return `/* TODO (simulated agent): ${text} */\n`;
  if (path.endsWith('.sql')) return `-- TODO (simulated agent): ${text}\n`;
  if (path.endsWith('.json')) return '';
  return `// TODO (simulated agent): ${text}\n`;
}

function genericEdit(input, text) {
  const target = input.plan.files.find((p) => !p.endsWith('.json')) ?? input.files.find((f) => !f.path.endsWith('.json'))?.path;
  if (!target) return { edits: [], summary: 'The simulated agent found no file to change.', why: text };
  const current = file(input.files, target);
  return {
    edits: [{ path: target, content: `${current.trimEnd()}\n${noteFor(target, text)}` }],
    summary: `Simulated agent: no script exists for this request, so it added a TODO note to ${target} instead of real code. Connect a Claude API key for real edits.`,
    why: text,
  };
}

function followUpEdit(input) {
  const msg = input.followUp;
  const target = input.plan.files.find((p) => p.endsWith('.html')) ?? input.plan.files[0];
  const current = file(input.files, target);
  if (has(msg, 'back') && target.endsWith('.html') && current.includes('</main>') && !current.includes('Back to menu')) {
    return {
      edits: [{ path: target, content: current.replace('  </main>', '    <p><a href="index.html">← Back to menu</a></p>\n  </main>') }],
      summary: `${input.previousSummary ?? ''} Also added a "Back to menu" link at the bottom of the page.`.trim(),
      why: `${msg}`,
    };
  }
  const result = genericEdit(input, `follow-up: ${msg}`);
  return { ...result, summary: `${input.previousSummary ?? ''} ${result.summary}`.trim() };
}
