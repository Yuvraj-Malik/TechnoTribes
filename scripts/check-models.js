// Checks every configured agent model with a tiny request, so you know before a demo.
//   npm run agents:check
import { chainFor, pingModel } from '../api/_lib/llm.js';

const roles = { Builder: 'builder', Critic: 'critic' };
const seen = new Set();
let anyOk = false;
for (const [label, role] of Object.entries(roles)) {
  const chain = chainFor(role, { includeUnavailable: true });
  console.log(`\n${label} tries, in order:`);
  if (!chain.length) console.log('  (nothing configured: set BUILDER_MODEL / CRITIC_MODEL / FALLBACK_MODEL and their API keys)');
  for (const s of chain) {
    if (seen.has(s.spec)) { console.log(`  ${s.spec}  (checked above)`); continue; }
    seen.add(s.spec);
    const r = await pingModel(s.spec);
    anyOk ||= r.ok;
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${s.spec}${r.ok ? `  (${r.ms} ms)` : `\n       ${r.error}`}`);
  }
}
console.log(anyOk ? '\nAt least one model answers. Agents will use the first working one in each list.' : '\nNo model answered: the agents will fall back to the simulated agent.');
