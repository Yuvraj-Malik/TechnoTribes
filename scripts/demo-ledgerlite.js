// LedgerLite demo content: the website the team builds, its context and the
// edits each developer's agent made. Used by scripts/seed-demo.js.

const STYLES_V1 = `:root { --green: #1b7f4a; --ink: #13261c; --cream: #f7f4ec; --line: #e2ddd0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: var(--ink); background: var(--cream); line-height: 1.55; }
a { color: var(--green); }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
header { display: flex; align-items: center; justify-content: space-between; padding: 18px 0; }
.logo { font-weight: 800; font-size: 20px; text-decoration: none; color: var(--ink); }
nav a { margin-left: 18px; text-decoration: none; font-weight: 600; }
.hero { padding: 56px 0 40px; }
.hero h1 { font-size: clamp(32px, 6vw, 52px); line-height: 1.1; margin: 0 0 14px; max-width: 16ch; }
.hero p { font-size: 18px; max-width: 52ch; margin: 0 0 24px; }
.btn { display: inline-block; background: var(--green); color: #fff; padding: 13px 22px; border-radius: 10px; font-weight: 700; text-decoration: none; border: 0; }
.btn.ghost { background: transparent; color: var(--green); border: 2px solid var(--green); }
footer { border-top: 1px solid var(--line); padding: 24px 0; margin-top: 56px; font-size: 14px; color: #55645a; }
`;

const FEATURES_CSS = `
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; padding: 24px 0; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 20px; }
.card h3 { margin: 0 0 6px; font-size: 18px; }
.card p { margin: 0; color: #4a5a50; }
`;

const PRICING_CSS = `
.plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; padding: 24px 0; }
.plan { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 22px; }
.plan.best { border: 2px solid var(--green); }
.price { font-size: 34px; font-weight: 800; margin: 8px 0; }
.price small { font-size: 15px; font-weight: 500; color: #55645a; }
.plan ul { padding-left: 18px; margin: 12px 0 18px; }
`;

const header = (active) => `  <header class="wrap">
    <a class="logo" href="index.html">LedgerLite</a>
    <nav><a href="index.html"${active === 'home' ? ' aria-current="page"' : ''}>Home</a><a href="pricing.html"${active === 'pricing' ? ' aria-current="page"' : ''}>Pricing</a></nav>
  </header>`;

const page = (title, active, body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${header(active)}
${body}
  <footer class="wrap">© LedgerLite · Bookkeeping made simple for Indian small businesses</footer>
  <script src="app.js"></script>
</body>
</html>
`;

const HERO = `  <main class="wrap">
    <section class="hero">
      <h1>Your books, done in minutes a week</h1>
      <p>LedgerLite keeps your sales, expenses and GST in one place, so you always know where your money is.</p>
      <a class="btn" href="#demo" data-demo>Book a free demo</a>
      <a class="btn ghost" href="pricing.html">See pricing</a>
    </section>`;

const FEATURES = `
    <section class="features" aria-label="Features">
      <div class="card"><h3>GST-ready invoices</h3><p>Create invoices that already follow GST rules and send them on WhatsApp.</p></div>
      <div class="card"><h3>Bank in sync</h3><p>Import statements from any Indian bank and match them in one click.</p></div>
      <div class="card"><h3>Reports you understand</h3><p>Profit, cash and dues in plain words, not accountant jargon.</p></div>
    </section>`;

const DEMO_JS = `// Book a demo: shows a short confirmation instead of a form for now.
document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', (e) => {
  e.preventDefault();
  b.textContent = 'Thanks! We will call you within a day';
  b.setAttribute('aria-live', 'polite');
}));
`;

const PRICING_BODY = (trial) => `  <main class="wrap">
    <section class="hero">
      <h1>Simple pricing in rupees</h1>
      <p>${trial ? 'Every plan starts with a 14-day free trial. No credit card needed.' : 'Pick a plan that fits your business. Change it any time.'}</p>
    </section>
    <section class="plans" aria-label="Plans">
      <div class="plan"><h3>Starter</h3><div class="price">₹0 <small>/ month</small></div><ul><li>50 invoices a month</li><li>1 bank account</li></ul><a class="btn ghost" href="#demo" data-demo>${trial ? 'Start 14-day trial' : 'Start free'}</a></div>
      <div class="plan best"><h3>Growth</h3><div class="price">₹499 <small>/ month</small></div><ul><li>Unlimited invoices</li><li>3 bank accounts</li><li>GST filing reports</li></ul><a class="btn" href="#demo" data-demo>${trial ? 'Start 14-day trial' : 'Book a demo'}</a></div>
      <div class="plan"><h3>Business</h3><div class="price">₹1,299 <small>/ month</small></div><ul><li>Everything in Growth</li><li>5 team members</li><li>Priority support</li></ul><a class="btn ghost" href="#demo" data-demo>Book a demo</a></div>
    </section>${trial ? `
    <p class="trial-note">After 14 days you choose a plan. If you do nothing, you move to Starter for free.</p>` : ''}
  </main>`;

/** The approved site after each merge. */
export const MAIN_V1 = {
  'web/index.html': page('LedgerLite: bookkeeping for small businesses', 'home', `${HERO}\n  </main>`),
  'web/styles.css': STYLES_V1,
  'web/app.js': DEMO_JS,
};
export const MAIN_V2 = {
  ...MAIN_V1,
  'web/index.html': page('LedgerLite: bookkeeping for small businesses', 'home', `${HERO}${FEATURES}\n  </main>`),
  'web/styles.css': STYLES_V1 + FEATURES_CSS,
};
export const MAIN_V3 = {
  ...MAIN_V2,
  'web/pricing.html': page('Pricing · LedgerLite', 'pricing', PRICING_BODY(false)),
  'web/styles.css': STYLES_V1 + FEATURES_CSS + PRICING_CSS,
};

/** Kabir's submitted change: the 14-day free trial (waiting for Arjun's review). */
export const KABIR_TRIAL = {
  'web/pricing.html': page('Pricing · LedgerLite', 'pricing', PRICING_BODY(true)),
  'web/styles.css': `${MAIN_V3['web/styles.css']}.trial-note { text-align: center; color: #4a5a50; }\n`,
};

/** Tara's work in progress: an FAQ section on the home page (touches the same files Kabir plans to). */
export const TARA_FAQ = {
  'web/index.html': MAIN_V3['web/index.html'].replace('\n  </main>', `
    <section class="faq" aria-label="Questions">
      <h2>Questions owners ask us</h2>
      <details><summary>Do I need to know accounting?</summary><p>No. You add sales and expenses; LedgerLite does the rest.</p></details>
      <details><summary>Is my data safe?</summary><p>Your data is stored in India and encrypted. Only you and the people you invite can see it.</p></details>
      <details><summary>Can my accountant use it?</summary><p>Yes. Invite them for free and they see the same books you do.</p></details>
    </section>
  </main>`),
  'web/styles.css': `${MAIN_V3['web/styles.css']}
.faq { padding: 24px 0; }
.faq details { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; margin-bottom: 10px; }
.faq summary { font-weight: 700; cursor: pointer; }
`,
};

export const BRIEF = 'LedgerLite is a bookkeeping app for small business owners in India. This project is its marketing website. Goal: get demo bookings. Every page should lead to "Book a free demo".';

/** Context sections. history = earlier versions, oldest first (the last one is current). */
export const SECTIONS = (ids, h) => [
  {
    id: 'c-audience', scope: 'central', title: 'Audience', tags: ['audience', 'copy', 'hero', 'faq', 'page', 'pricing'], ownerId: ids.owner,
    history: [
      { content: 'Small business owners.', why: 'First draft', by: ids.owner, at: h(72) },
      { content: 'Small business owners in India (shops, clinics, agencies with 1 to 20 people). Most are not accountants and read on their phones.', why: 'Our pilot users are all Indian shops and clinics, mostly on mobile', by: ids.owner, at: h(30) },
    ],
  },
  {
    id: 'c-tone', scope: 'central', title: 'Tone of voice', tags: ['copy', 'tone', 'faq', 'hero', 'text'], ownerId: ids.owner,
    history: [{ content: 'Professional and reassuring. Plain words, short sentences, no accounting jargon. Talk about outcomes ("know where your money is"), not features.', why: 'Set with the brief', by: ids.owner, at: h(72) }],
  },
  {
    id: 'c-pricing', scope: 'central', title: 'Pricing rules', tags: ['pricing', 'price', 'plan', 'trial', 'free'], ownerId: ids.owner,
    guardrails: [{ phrase: 'dollar', note: 'Prices are always shown in rupees (₹).' }, { phrase: 'card required', note: 'The free trial never asks for a credit card.' }],
    history: [
      { content: 'Three plans: Starter (free), Growth ₹499/month, Business ₹1,299/month. Prices in rupees.', why: 'Set with the pricing page', by: ids.owner, at: h(10) },
      { content: 'Three plans: Starter (free), Growth ₹499/month, Business ₹1,299/month. Prices always in rupees. Every plan starts with a 14-day free trial, no credit card needed.', why: 'Meera asked for a clear free trial; sales confirmed it', by: ids.owner, at: h(6) },
    ],
  },
  {
    id: 'web-design', scope: 'website', title: 'Design rules', tags: ['*'], ownerId: ids.admin,
    history: [{ content: 'Brand green #1b7f4a on cream #f7f4ec. One primary button style (.btn) and one outline style (.btn.ghost). Mobile first: grids stack to one column below 640px. Every page ends with a "Book a free demo" button.', why: 'Set by the website manager', by: ids.admin, at: h(70) }],
  },
  {
    id: 'web-structure', scope: 'website', title: 'Files and structure', tags: ['page', 'html', 'css', 'file', 'section'], ownerId: ids.admin,
    guardrails: [{ phrase: 'react', note: 'The marketing site is plain HTML, CSS and JS with no framework.' }],
    history: [{ content: 'Plain HTML pages in web/, one shared web/styles.css, small scripts in web/app.js. No frameworks on the marketing site.', why: 'Keep the site fast on slow mobile networks', by: ids.admin, at: h(70) }],
  },
  {
    id: 'content-copy', scope: 'content', title: 'Copy guidelines', tags: ['*'], ownerId: ids.owner,
    history: [{ content: 'Answer the question in the first sentence. Use "you" and "your business". Rupee amounts with the ₹ sign. Read every line aloud before submitting.', why: 'Content department set up', by: ids.owner, at: h(40) }],
  },
];
